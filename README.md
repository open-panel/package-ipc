# @open-panel/ipc

The typed WebSocket IPC contract between the [OpenPanel](https://github.com/open-panel/openPanel)
daemon and its clients (desktop app, CLI): a `ws`-based server, a client built
on the standard `WebSocket` global, and the zod-validated method contract
both sides are checked against.

> **Scope note.** `IpcServer` is daemon-only plumbing — most third-party
> consumers building against OpenPanel want `@open-panel/plugin-sdk` instead.
> `IpcClient` and the contract types are useful for anyone writing an
> alternative client (a second desktop UI, a mobile companion, a script) that
> talks to a running daemon.

## Install

```bash
npm install @open-panel/ipc
```

## Subpath exports

This package is split so a browser/webview bundle never pulls in `ws`:

| Import                    | Contents                                                              | Runtime           |
| -------------------------- | ---------------------------------------------------------------------- | ------------------ |
| `@open-panel/ipc`          | Everything below (`server` included) — Node only                       | Node               |
| `@open-panel/ipc/client`   | `IpcClient` — built on the global `WebSocket`, no Node import           | Node ≥ 20 or browser |
| `@open-panel/ipc/server`   | `IpcServer` — hosts the contract over `ws`                              | Node               |
| `@open-panel/ipc/contract` | `ipcMethods`, `OpenPanelClient`, request/response/summary schemas       | Node or browser    |
| `@open-panel/ipc/wire`     | The wire-level `WireRequest`/`WireResponse`/`WireEvent` message shapes  | Node or browser    |

A desktop/webview app should import `@open-panel/ipc/client` and
`@open-panel/ipc/contract` directly rather than the root entry point.

## What's in here

- **`ipcMethods`** — every RPC method's params/result zod schemas
  (`listDevices`, `listProfiles`, `setActiveProfile`, `importProfile`, …).
  Every incoming call is validated against this before it reaches a handler.
- **`OpenPanelClient`** — the interface both `IpcServer`'s handlers and
  `IpcClient` implement; one method per entry in `ipcMethods`.
- **`IpcServer`** — hosts the daemon side over a local WebSocket.
  `start()` binds the port and resolves once it's actually held — the bind
  itself is the single-daemon-instance lock, so a second daemon discovers a
  running one via `EADDRINUSE` rather than fighting it for the device.
- **`IpcClient`** — round-trips typed requests to the daemon and exposes
  daemon-pushed events; reconnects automatically if the daemon restarts.
- **Summaries & DTOs** — `ProfileSummary`, `ActionSummary`, `PluginSummary`,
  `PluginInstallResult` and their schemas — the plain DTOs that actually
  cross the process boundary (never an internal object like a
  `ProfileRepository` or `DeckDevice`).

## Usage

Server side (daemon):

```ts
import { IpcServer } from "@open-panel/ipc/server";
import type { OpenPanelClient } from "@open-panel/ipc/contract";

const handlers: OpenPanelClient = {
  async listDevices() { return driverRegistry.listDevices(); },
  // ...one method per entry in ipcMethods
};

const server = new IpcServer(handlers, { port: 47912 });
await server.start();
```

Client side (desktop/CLI):

```ts
import { IpcClient } from "@open-panel/ipc/client";

const client = new IpcClient({ url: "ws://127.0.0.1:47912" });
client.connect();

const devices = await client.listDevices();
```

## Related packages

- [`@open-panel/shared`](https://www.npmjs.com/package/@open-panel/shared) — the `OpenPanelEvents` map this package's event stream is typed against

## License

MIT © [OpenPanel contributors](https://github.com/open-panel/package-ipc/blob/main/LICENSE)
