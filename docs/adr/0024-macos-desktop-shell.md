# ADR-0024: macOS desktop shell and runtime hosting

- Status: Proposed
- Date: 2026-10-05
- Related: [specs/macos-client.md](../specs/macos-client.md), [ADR-0001](0001-implementation-language-runtime.md), [ADR-0002](0002-runtime-client-boundary.md), [specs/protocol.md](../specs/protocol.md)
- Supersedes (partially): ADR-0002's deferral of non-CLI clients and of the transport for them

## Context / problem

The macOS app becomes the product surface. The runtime is Node/TypeScript with native SQLite
bindings and owns the workspace, credentials, browser control and provider calls. The UI must
be a KSP client with a narrow, validated boundary. A broad UI redesign is out of scope.

## Considered alternatives

| Option | For | Against |
|---|---|---|
| **Electron** | One language; Node already inside; `utilityProcess` isolates the runtime from the renderer; mature signing and notarization tooling | Larger bundle; Chromium in the app; native modules must be built for Electron's Node ABI; Electron's Node version must satisfy ADR-0001 |
| **Tauri + Node sidecar** | Small shell; strong IPC permission model | Rust shell plus a bundled Node binary (single-executable packaging was postponed in ADR-0001); two toolchains; WebKit rendering differences |
| **Native Swift shell + Node sidecar** | Best platform integration | Two languages and a UI stack the repository does not use; a bundled Node binary anyway |

## Decision

**Electron**, with the runtime outside the renderer:

- **Main process:** windows, menus, native dialogs, notifications, `shell.openExternal` for an
  allowlist of URLs (OAuth authorization, ChatGPT usage settings), app lifecycle. It brokers a
  `MessagePort` between renderer and runtime and does not read KSP payloads.
- **Runtime:** an Electron `utilityProcess` running the Kai runtime (`@kai/runtime`). It owns
  the workspace, the stores, the credential store, provider calls and the research worker.
  Native modules are built for the Electron Node ABI.
- **Renderer:** `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, a strict
  CSP, no remote content. A preload exposes one function that hands over the KSP port. All
  messages are Zod-validated on both sides; the renderer never sees credentials.
- **Transport:** KSP over `MessagePort` (a new transport beside in-memory and stdio). The CLI
  keeps in-memory and stdio transports.
- **Platform:** Apple Silicon (`arm64`) first. Developer ID signing, hardened runtime and
  notarization are release assumptions that need the owner's Apple Developer account. No App
  Sandbox in R1, because the agent runs the user's development tools; this is disclosed.

## Rationale

Electron is the only option that keeps one language and one runtime binary, which matters more
than bundle size for a developer tool built by coding agents. `utilityProcess` gives the
process separation the KSP boundary assumes.

## Consequences

- Before Phase 11, verify: Electron's bundled Node version meets ADR-0001 (Node 24 LTS line);
  `better-sqlite3` and the keychain binding build for its ABI; required hardened-runtime
  entitlements.
- The runtime must shut down cleanly on app quit and recover on restart
  ([macos-client](../specs/macos-client.md#lifecycle)).
- A single runtime per user data directory is enforced with a lock. The CLI and the app cannot
  own the same workspace at once (`WORKSPACE_LOCKED`).

## Unresolved questions

1. Auto-update mechanism and channel (post-R1 decision).
2. Universal (`x86_64`) builds.
