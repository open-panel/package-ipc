// Node-only barrel (pulls in the "ws" server). Browser/webview code (the
// desktop app) should import "@open-panel/ipc/client" and
// "@open-panel/ipc/contract" directly to avoid bundling Node-only transport.
export * from "./contract.js";
export * from "./wire.js";
export * from "./server.js";
export * from "./client.js";
