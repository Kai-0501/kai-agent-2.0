# ADR-0002: Runtime/client boundary

- Status: Proposed
- Date: 2026-10-05
- Related: [research/upstream/t3code.md](../research/upstream/t3code.md), [specs/protocol.md](../specs/protocol.md), [ADR-0004](0004-durable-event-session-model.md)
- Partially superseded by: [ADR-0024](0024-macos-desktop-shell.md) (the macOS app is an R1 client; KSP gains a `MessagePort` transport)

## Context / problem

A coding agent touches the filesystem, git, processes, terminals, credentials and the network.
Long-term, Kai may have desktop and web or remote clients. The founding prompt asks whether a
T3 Code-style split, where the machine that owns the workspace runs everything and clients talk
to it over a typed RPC and event protocol, is right, while warning against bloating v1 for
hypothetical clients.

## Considered alternatives

1. **Monolithic CLI.** The UI calls internal functions directly. Simplest today, but every
   later client means refactoring. It also lets UI concerns leak into the runtime.
2. **Daemon from day one** (T3 Code, OpenCode). A separate long-running process with WebSocket
   transport, auth and a client runtime. Right for multi-client products, but it adds lifecycle,
   auth and reconnect work before there is a second client.
3. **Protocol from day one, deployment topology later.** The runtime is a library that exposes
   *only* a typed JSON-RPC-shaped interface: requests, plus a cursored event stream. v1's CLI
   hosts it **in-process** over an in-memory transport. A stdio or WebSocket transport is added
   when a second client exists.
4. **Adopt ACP (Agent Client Protocol) as the protocol.** Zed's ACP (`@agentclientprotocol/sdk`,
   v1 schema, Apache-2.0) is supported by T3 Code and OpenHands Agent Canvas, which would give
   free integration. However, ACP is shaped around generic agent sessions, and some of its
   capabilities assume the *client* owns the filesystem (`fs/read_text_file`,
   `fs/write_text_file`). That conflicts with Kai's need to own reads (the ledger) and writes
   (the firewall).

## Decision

**Option 3, with ACP as a later adapter.**

- The **Kai Runtime** owns the repository and worktrees, git, process execution, credentials,
  the Session Store, the model provider and all agent subsystems. **Clients never touch the
  workspace directly.**
- The **Kai Session Protocol (KSP)** lives in `packages/protocol`: JSON-RPC 2.0 semantics,
  Zod-typed requests and responses, and a **server-push event stream with a monotonically
  increasing `seq`**. Clients get a snapshot at `seq = N` and then events with `seq > N` (T3
  Code's cursor model).
- v1 transports: **in-memory** (CLI hosts the runtime in-process) and **stdio JSON-lines**
  (headless and automation, e.g. the benchmark harness). WebSocket or Unix socket comes with the
  first non-CLI client.
- An **ACP adapter** (`packages/acp-adapter`) maps ACP `session/new`, `session/prompt`,
  `session/update`, `session/request_permission` and `session/cancel` onto KSP. It never
  delegates filesystem ownership to the client. This is post-v1.
- Capability negotiation: `initialize` returns `{protocolVersion, capabilities}`. Clients must
  handle missing capabilities.

## Rationale

Defining the boundary is cheap if done first and expensive to retrofit. Deploying it as a
separate daemon is expensive and not needed yet. Option 3 keeps ownership discipline: every UI
action is a protocol call, so headless runs, the benchmark harness and future clients all use the
same path. The cursored event stream also serves telemetry and replay.

## Consequences

- All UI state is derived from KSP events. The CLI cannot "peek" into runtime internals. This is
  enforced with lint rules: `packages/cli` may import only `packages/protocol` and the runtime
  factory.
- Permission prompts are protocol round-trips (`permission.request` → `permission.respond`), so
  a headless run must supply a policy (auto-deny, auto-allow by rule, or fail).
- Long-running work (verification, background processes) must be cancellable and observable over
  the protocol.

## Unresolved questions

1. When a second client exists, should the runtime be a per-workspace daemon or a per-user
   multi-workspace daemon? T3 Code's "environment" is per machine.
2. Auth for remote transports (token pairing, as in T3 Code). Out of scope until remote clients
   exist.
3. How close KSP method names should stay to ACP, to keep the adapter thin.
