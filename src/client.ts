import type { OpenPanelEvents } from "@open-panel/shared";
import type { IpcMethodName, OpenPanelClient } from "./contract.js";
import type { WireMessage, WireRequest } from "./wire.js";

// Web Crypto's randomUUID (global `crypto`) instead of node:crypto — this
// file must work unmodified in the browser/webview (the desktop app imports
// it directly), not just in Node (the CLI).
const randomUUID = (): string => crypto.randomUUID();

export interface IpcClientOptions {
  url: string;
  reconnectDelayMs?: number;
  /** Defaults to the runtime's global WebSocket (native in browsers and in Node >= 22). */
  WebSocketImpl?: typeof WebSocket;
}

type EventListener<K extends keyof OpenPanelEvents> = (payload: OpenPanelEvents[K]) => void;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * Desktop/CLI-side IPC client. Implements OpenPanelClient by round-tripping
 * typed requests to the daemon's IpcServer, and exposes daemon-pushed events
 * (specs.md #8). Reconnects automatically if the daemon restarts — closing
 * the desktop UI or losing the daemon connection must degrade gracefully,
 * not corrupt state.
 */
export class IpcClient implements OpenPanelClient {
  private socket: WebSocket | undefined;
  private readonly pending = new Map<string, Pending>();
  // `any`: one map holds listeners for every event name, each with its own
  // payload type — `on()` below is what keeps this type-safe at call sites.
  private readonly eventListeners = new Map<keyof OpenPanelEvents, Set<EventListener<any>>>();
  private readonly connectionListeners = new Set<(connected: boolean) => void>();
  private connected = false;
  private closed = false;

  constructor(private readonly options: IpcClientOptions) {}

  connect(): void {
    this.closed = false;
    const Impl = this.options.WebSocketImpl ?? globalThis.WebSocket;
    const socket = new Impl(this.options.url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.connected = true;
      for (const l of this.connectionListeners) l(true);
    });
    socket.addEventListener("message", (event) => this.handleMessage(String(event.data)));
    socket.addEventListener("close", () => {
      this.connected = false;
      for (const l of this.connectionListeners) l(false);
      this.rejectAllPending(new Error("IPC connection closed"));
      if (!this.closed) {
        setTimeout(() => this.connect(), this.options.reconnectDelayMs ?? 1000);
      }
    });
    socket.addEventListener("error", () => {
      // "close" always follows "error" for ws; avoid double-handling here.
    });
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
  }

  isConnected(): boolean {
    return this.connected;
  }

  onConnectionChange(listener: (connected: boolean) => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  on<K extends keyof OpenPanelEvents>(event: K, listener: EventListener<K>): () => void {
    if (!this.eventListeners.has(event)) this.eventListeners.set(event, new Set());
    this.eventListeners.get(event)!.add(listener);
    return () => this.eventListeners.get(event)?.delete(listener);
  }

  private call(method: IpcMethodName, params: unknown[]): Promise<unknown> {
    if (!this.socket || this.socket.readyState !== this.socket.OPEN) {
      return Promise.reject(new Error("IPC client is not connected"));
    }
    const id = randomUUID();
    const request: WireRequest = { kind: "request", id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket!.send(JSON.stringify(request));
    });
  }

  private handleMessage(raw: string): void {
    let message: WireMessage;
    try {
      message = JSON.parse(raw) as WireMessage;
    } catch {
      return;
    }
    if (message.kind === "response") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error.message));
      return;
    }
    if (message.kind === "event") {
      const listeners = this.eventListeners.get(message.event);
      if (listeners) for (const l of listeners) l(message.payload);
    }
  }

  private rejectAllPending(err: Error): void {
    for (const pending of this.pending.values()) pending.reject(err);
    this.pending.clear();
  }

  // --- OpenPanelClient ---
  listDevices() {
    return this.call("listDevices", []) as ReturnType<OpenPanelClient["listDevices"]>;
  }
  listProfiles() {
    return this.call("listProfiles", []) as ReturnType<OpenPanelClient["listProfiles"]>;
  }
  getActiveProfile() {
    return this.call("getActiveProfile", []) as ReturnType<OpenPanelClient["getActiveProfile"]>;
  }
  setActiveProfile(profileId: string) {
    return this.call("setActiveProfile", [profileId]) as ReturnType<
      OpenPanelClient["setActiveProfile"]
    >;
  }
  createProfile(name: string) {
    return this.call("createProfile", [name]) as ReturnType<OpenPanelClient["createProfile"]>;
  }
  renameProfile(profileId: string, name: string) {
    return this.call("renameProfile", [profileId, name]) as ReturnType<
      OpenPanelClient["renameProfile"]
    >;
  }
  deleteProfile(profileId: string) {
    return this.call("deleteProfile", [profileId]) as ReturnType<OpenPanelClient["deleteProfile"]>;
  }
  duplicateProfile(profileId: string, newName?: string) {
    return this.call("duplicateProfile", [profileId, newName]) as ReturnType<
      OpenPanelClient["duplicateProfile"]
    >;
  }
  resetProfile(profileId: string) {
    return this.call("resetProfile", [profileId]) as ReturnType<OpenPanelClient["resetProfile"]>;
  }
  exportProfile(profileId: string) {
    return this.call("exportProfile", [profileId]) as ReturnType<OpenPanelClient["exportProfile"]>;
  }
  importProfile(document: Parameters<OpenPanelClient["importProfile"]>[0]) {
    return this.call("importProfile", [document]) as ReturnType<OpenPanelClient["importProfile"]>;
  }
  addPage(profileId: string, name: string, parentButtonId?: string) {
    return this.call("addPage", [profileId, name, parentButtonId]) as ReturnType<
      OpenPanelClient["addPage"]
    >;
  }
  createFolder(profileId: string, pageId: string, position: number) {
    return this.call("createFolder", [profileId, pageId, position]) as ReturnType<
      OpenPanelClient["createFolder"]
    >;
  }
  renamePage(profileId: string, pageId: string, name: string) {
    return this.call("renamePage", [profileId, pageId, name]) as ReturnType<
      OpenPanelClient["renamePage"]
    >;
  }
  deletePage(profileId: string, pageId: string) {
    return this.call("deletePage", [profileId, pageId]) as ReturnType<
      OpenPanelClient["deletePage"]
    >;
  }
  movePage(profileId: string, pageId: string, toIndex: number) {
    return this.call("movePage", [profileId, pageId, toIndex]) as ReturnType<
      OpenPanelClient["movePage"]
    >;
  }
  setButton(
    profileId: string,
    pageId: string,
    button: Parameters<OpenPanelClient["setButton"]>[2],
  ) {
    return this.call("setButton", [profileId, pageId, button]) as ReturnType<
      OpenPanelClient["setButton"]
    >;
  }
  removeButton(profileId: string, pageId: string, position: number) {
    return this.call("removeButton", [profileId, pageId, position]) as ReturnType<
      OpenPanelClient["removeButton"]
    >;
  }
  executeAction(
    action: Parameters<OpenPanelClient["executeAction"]>[0],
    meta?: Parameters<OpenPanelClient["executeAction"]>[1],
  ) {
    return this.call("executeAction", [action, meta]) as ReturnType<
      OpenPanelClient["executeAction"]
    >;
  }
  listActions() {
    return this.call("listActions", []) as ReturnType<OpenPanelClient["listActions"]>;
  }
  listPlugins() {
    return this.call("listPlugins", []) as ReturnType<OpenPanelClient["listPlugins"]>;
  }
  installPlugin(archiveBase64: string) {
    return this.call("installPlugin", [archiveBase64]) as ReturnType<
      OpenPanelClient["installPlugin"]
    >;
  }
  uninstallPlugin(pluginId: string) {
    return this.call("uninstallPlugin", [pluginId]) as ReturnType<
      OpenPanelClient["uninstallPlugin"]
    >;
  }
  getLogs(limit?: number) {
    return this.call("getLogs", [limit]) as ReturnType<OpenPanelClient["getLogs"]>;
  }
  getDeviceImageCalibration(deviceId: string) {
    return this.call("getDeviceImageCalibration", [deviceId]) as ReturnType<
      OpenPanelClient["getDeviceImageCalibration"]
    >;
  }
  setDeviceImageMargin(deviceId: string, marginPx: number) {
    return this.call("setDeviceImageMargin", [deviceId, marginPx]) as ReturnType<
      OpenPanelClient["setDeviceImageMargin"]
    >;
  }
  setDeviceImageOffset(
    deviceId: string,
    position: number,
    offset: Parameters<OpenPanelClient["setDeviceImageOffset"]>[2],
  ) {
    return this.call("setDeviceImageOffset", [deviceId, position, offset]) as ReturnType<
      OpenPanelClient["setDeviceImageOffset"]
    >;
  }
  isDeviceCalibrating(deviceId: string) {
    return this.call("isDeviceCalibrating", [deviceId]) as ReturnType<
      OpenPanelClient["isDeviceCalibrating"]
    >;
  }
  enterDeviceCalibrationMode(deviceId: string) {
    return this.call("enterDeviceCalibrationMode", [deviceId]) as ReturnType<
      OpenPanelClient["enterDeviceCalibrationMode"]
    >;
  }
  exitDeviceCalibrationMode(deviceId: string) {
    return this.call("exitDeviceCalibrationMode", [deviceId]) as ReturnType<
      OpenPanelClient["exitDeviceCalibrationMode"]
    >;
  }
  listThemes() {
    return this.call("listThemes", []) as ReturnType<OpenPanelClient["listThemes"]>;
  }
  getTheme(themeId: string, appearance: Parameters<OpenPanelClient["getTheme"]>[1]) {
    return this.call("getTheme", [themeId, appearance]) as ReturnType<OpenPanelClient["getTheme"]>;
  }
  getThemePreference() {
    return this.call("getThemePreference", []) as ReturnType<OpenPanelClient["getThemePreference"]>;
  }
  setThemePreference(themeId: string, mode: Parameters<OpenPanelClient["setThemePreference"]>[1]) {
    return this.call("setThemePreference", [themeId, mode]) as ReturnType<
      OpenPanelClient["setThemePreference"]
    >;
  }
  listLocales() {
    return this.call("listLocales", []) as ReturnType<OpenPanelClient["listLocales"]>;
  }
  getLocale(localeId: string) {
    return this.call("getLocale", [localeId]) as ReturnType<OpenPanelClient["getLocale"]>;
  }
  getLocalePreference() {
    return this.call("getLocalePreference", []) as ReturnType<
      OpenPanelClient["getLocalePreference"]
    >;
  }
  setLocalePreference(locale: Parameters<OpenPanelClient["setLocalePreference"]>[0]) {
    return this.call("setLocalePreference", [locale]) as ReturnType<
      OpenPanelClient["setLocalePreference"]
    >;
  }
  shutdown() {
    return this.call("shutdown", []) as ReturnType<OpenPanelClient["shutdown"]>;
  }
}
