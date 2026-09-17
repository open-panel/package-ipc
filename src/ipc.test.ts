import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceInfo } from "@open-panel/shared";
import { IpcServer } from "./server.js";
import { IpcClient } from "./client.js";
import type { OpenPanelClient } from "./contract.js";

const mockDevice: DeviceInfo = {
  id: "d1",
  driverId: "mock",
  vendor: "OpenPanel",
  product: "Mock",
  capabilities: {
    buttons: 15,
    hasDisplay: false,
    supportsButtonImages: true,
    supportsButtonLabels: true,
    hasEncoders: false,
    hasTouchscreen: false,
    supportsImageCalibration: false,
  },
  state: "connected",
};

function buildHandlers(overrides: Partial<OpenPanelClient> = {}): OpenPanelClient {
  const notImplemented = () => Promise.reject(new Error("not implemented"));
  return {
    listDevices: async () => [mockDevice],
    listProfiles: async () => [],
    getActiveProfile: async () => undefined,
    setActiveProfile: notImplemented,
    createProfile: notImplemented,
    renameProfile: notImplemented,
    deleteProfile: notImplemented,
    duplicateProfile: notImplemented,
    resetProfile: notImplemented,
    exportProfile: notImplemented,
    importProfile: notImplemented,
    addPage: notImplemented,
    renamePage: notImplemented,
    deletePage: notImplemented,
    setButton: notImplemented,
    removeButton: notImplemented,
    executeAction: notImplemented,
    listActions: async () => [],
    listPlugins: async () => [],
    getLogs: async () => [],
    ...overrides,
  } as OpenPanelClient;
}

describe("IpcServer/IpcClient", () => {
  let server: IpcServer;
  let client: IpcClient;
  const port = 45123;

  beforeEach(async () => {
    server = new IpcServer(buildHandlers(), { port });
    await server.start();
    client = new IpcClient({ url: `ws://127.0.0.1:${port}` });
    client.connect();
    await new Promise<void>((resolve) =>
      client.onConnectionChange((connected) => connected && resolve()),
    );
  });

  afterEach(async () => {
    client.close();
    await server.stop();
  });

  it("round-trips a typed request/response", async () => {
    const devices = await client.listDevices();
    expect(devices).toEqual([mockDevice]);
  });

  it("rejects the call when the daemon handler throws, without crashing the server", async () => {
    await server.stop();
    server = new IpcServer(
      buildHandlers({ createProfile: async () => Promise.reject(new Error("disk full")) }),
      { port },
    );
    await server.start();

    // The client auto-reconnects (specs.md #8) — wait for that before calling,
    // otherwise the in-flight call races the stale socket's own close event.
    await new Promise<void>((resolve) => {
      const off = client.onConnectionChange((connected) => {
        if (connected) {
          off();
          resolve();
        }
      });
    });

    await expect(client.createProfile("x")).rejects.toThrow(/disk full/);
    // server is still usable afterwards
    await expect(client.listDevices()).resolves.toEqual([mockDevice]);
  });

  it("delivers server-pushed events to subscribed listeners", async () => {
    const received = vi.fn();
    client.on("deviceConnected", received);

    server.emit("deviceConnected", mockDevice);

    await vi.waitFor(() => expect(received).toHaveBeenCalledWith(mockDevice));
  });

  it("rejects calls with invalid parameter types instead of forwarding them to the handler", async () => {
    // @ts-expect-error intentionally wrong arg type to exercise boundary validation
    await expect(client.renameProfile(123, "x")).rejects.toThrow(/Invalid params/);
  });

  // The bind is the daemon's single-instance lock: a second daemon has to find
  // out here, before it opens the HID handles, that one is already running.
  it("rejects start() when the port is already taken", async () => {
    const second = new IpcServer(buildHandlers(), { port });
    await expect(second.start()).rejects.toThrow(/EADDRINUSE/);
    // The failed server must not leave an unhandled 'error' behind, and stopping
    // it must not touch the socket the first server still owns.
    await expect(second.stop()).resolves.toBeUndefined();
    await expect(client.listDevices()).resolves.toEqual([mockDevice]);
  });
});
