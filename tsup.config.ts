import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/client.ts", "src/server.ts", "src/contract.ts", "src/wire.ts"],
  format: "esm",
  target: "node20",
  outDir: "dist",
  dts: true,
  sourcemap: true,
  clean: true,
  platform: "node",
  // ./client is imported by browser/webview code too (see src/client.ts), but
  // building it under platform: "node" is still correct here: it only touches
  // the global WebSocket/crypto, no node:* import, so nothing node-specific
  // leaks into that entry's output.
  external: [/^@open-panel\//, "ws", "zod"],
});
