import { WebSocketServer, type WebSocket } from "ws";
import type { OpenPanelEvents } from "@open-panel/shared";
import { ipcMethods, type IpcMethodName, type OpenPanelClient } from "./contract.js";
import type { WireEvent, WireMessage, WireRequest, WireResponse } from "./wire.js";

export interface IpcServerOptions {
  port: number;
  host?: string;
  logger?: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
  };
}

/**
 * Hosts the daemon side of the IPC contract over a local WebSocket. Every
 * incoming call is validated against `ipcMethods` before it ever reaches a
 * handler — desktop/CLI input is untrusted (specs.md Rule 5), and a bad
 * message must never crash the daemon (Rule 6).
 */
export class IpcServer {
  private wss: WebSocketServer | undefined;
  private readonly clients = new Set<WebSocket>();

  constructor(
    private readonly handlers: OpenPanelClient,
    private readonly options: IpcServerOptions,
  ) {}

  /**
   * Binds the IPC port. Resolves once the port is actually held, rejects if it
   * is not — most importantly with EADDRINUSE, which is how a second daemon
   * discovers that one is already running.
   *
   * This must be awaited, and must be the first thing a daemon does: the bind
   * is the single-instance lock. A server whose bind failed silently would
   * leave a daemon alive with no IPC port but with the HID handles open,
   * fighting the real one for the device.
   */
  start(): Promise<void> {
    const wss = new WebSocketServer({
      port: this.options.port,
      host: this.options.host ?? "127.0.0.1",
    });
    this.wss = wss;
    const listening = new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        wss.off("listening", onListening);
        // Never bound, so stop() has nothing to close and would only report the
        // bind failure a second time.
        this.wss = undefined;
        // Nothing is bound, so there is nothing to close and no caller left to
        // report a later error to — but ws keeps this listener attached, and
        // an unhandled 'error' on the server would become an uncaughtException.
        wss.on("error", (later) =>
          this.options.logger?.warn("ipc server error", { error: String(later) }),
        );
        reject(err);
      };
      const onListening = () => {
        wss.off("error", onError);
        wss.on("error", (err) =>
          this.options.logger?.warn("ipc server error", { error: String(err) }),
        );
        resolve();
      };
      wss.once("error", onError);
      wss.once("listening", onListening);
    });
    this.wss.on("connection", (socket) => {
      this.clients.add(socket);
      this.options.logger?.info("ipc client connected", { clients: this.clients.size });
      socket.on("message", (data) => void this.handleMessage(socket, data.toString()));
      socket.on("close", () => {
        this.clients.delete(socket);
        this.options.logger?.info("ipc client disconnected", { clients: this.clients.size });
      });
      socket.on("error", (err) =>
        this.options.logger?.warn("ipc socket error", { error: String(err) }),
      );
    });
    return listening;
  }

  async stop(): Promise<void> {
    for (const client of this.clients) client.terminate();
    this.clients.clear();
    await new Promise<void>((resolve, reject) => {
      if (!this.wss) return resolve();
      this.wss.close((err) => (err ? reject(err) : resolve()));
    });
  }

  /** Push a typed event to every connected client (specs.md #8 OpenPanelEvents). */
  emit<K extends keyof OpenPanelEvents>(event: K, payload: OpenPanelEvents[K]): void {
    const message: WireEvent<K> = { kind: "event", event, payload };
    const raw = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(raw);
    }
  }

  private async handleMessage(socket: WebSocket, raw: string): Promise<void> {
    let message: WireMessage;
    try {
      message = JSON.parse(raw) as WireMessage;
    } catch {
      this.options.logger?.warn("ipc received invalid JSON, ignoring");
      return;
    }
    if (message.kind !== "request") return;
    await this.handleRequest(socket, message);
  }

  private async handleRequest(socket: WebSocket, request: WireRequest): Promise<void> {
    const spec = ipcMethods[request.method as IpcMethodName];
    const respond = (response: WireResponse) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(response));
    };

    if (!spec) {
      respond({
        kind: "response",
        id: request.id,
        ok: false,
        error: { message: `Unknown method: ${request.method}` },
      });
      return;
    }

    const parsedParams = spec.params.safeParse(request.params);
    if (!parsedParams.success) {
      respond({
        kind: "response",
        id: request.id,
        ok: false,
        error: { message: `Invalid params for ${request.method}: ${parsedParams.error.message}` },
      });
      return;
    }

    try {
      const handler = this.handlers[request.method as IpcMethodName] as (
        ...args: unknown[]
      ) => Promise<unknown>;
      const result = await handler.apply(this.handlers, parsedParams.data as unknown[]);
      respond({ kind: "response", id: request.id, ok: true, result: result ?? null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.options.logger?.warn("ipc handler threw", { method: request.method, error: message });
      respond({ kind: "response", id: request.id, ok: false, error: { message } });
    }
  }
}
