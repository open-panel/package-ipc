# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0]

### Added

- Typed IPC method contract (`ipcMethods`, `OpenPanelClient`) validated with
  zod on every call.
- `IpcServer` (`ws`-based, Node only) with bind-as-single-instance-lock
  semantics.
- `IpcClient` (built on the global `WebSocket`, Node or browser) with
  automatic reconnection.
- Split subpath exports (`./client`, `./server`, `./contract`, `./wire`) so a
  browser bundle never pulls in `ws`.
