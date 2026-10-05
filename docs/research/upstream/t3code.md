# T3 Code

- **Repository:** [pingdotgg/t3code](https://github.com/pingdotgg/t3code) @ `cf3e714b` (2026-10-05)
- **License:** MIT
- **Language/runtime:** TypeScript, Node.js WebSocket server, built on [Effect](https://effect.website). Web (Vite/React), Electron desktop, React Native mobile. SQLite persistence.
- **Studied as:** inspiration for the client/server control surface and typed remote sessions.

## What it is

T3 Code is an **"agent harness control surface"**, not an agent. Its README says it controls
Codex, Claude Code, Cursor, Grok Build, OpenCode and Antigravity, and the
[AGENTS.md](https://github.com/pingdotgg/t3code/blob/cf3e714b0f58e29c8fa8660db50d2187e3263b65/AGENTS.md)
puts it this way: *"A Node WebSocket server wraps provider CLIs and agents … and serves web,
desktop, and mobile clients."* It does **no** context management, editing or verification of its
own. Those belong to the wrapped agents.

## Architecture worth studying

**The workspace-owning server is the boundary.** From
[`docs/internals/overview.md`](https://github.com/pingdotgg/t3code/blob/cf3e714b0f58e29c8fa8660db50d2187e3263b65/docs/internals/overview.md):
*"T3 Code keeps execution in the environment that owns the workspace. Web, desktop, and mobile
clients control it over authenticated RPC. A remote client must never substitute its own
filesystem, provider credentials, or machine state for the environment's."* Provider processes,
terminals, Git and project files belong to the server. Shared client logic lives in
`packages/client-runtime`.

**Typed contract package.** Everything that crosses the wire is typed in
[`packages/contracts`](https://github.com/pingdotgg/t3code/tree/cf3e714b0f58e29c8fa8660db50d2187e3263b65/packages/contracts/src)
using Effect Schema. Clients and servers are *independently versioned*, and capabilities are
negotiated through an environment descriptor, never by assuming a coordinated release.

**Event store with sequence cursors.** Orchestration V2
([`docs/orchestration-v2/core-graph-and-data-model.md`](https://github.com/pingdotgg/t3code/blob/cf3e714b0f58e29c8fa8660db50d2187e3263b65/docs/orchestration-v2/core-graph-and-data-model.md))
models `Project → AppThread → Run → ExecutionNode` and stores normalized events with a
store-assigned, monotonically increasing `sequence`. Clients *"read snapshot at sequence N →
stream committed V2 events where sequence > N"*. Raw provider frames are diagnostics, not durable
state.

**App IDs are identity, provider IDs are references.**
([`entity-ids-and-correlation.md`](https://github.com/pingdotgg/t3code/blob/cf3e714b0f58e29c8fa8660db50d2187e3263b65/docs/orchestration-v2/entity-ids-and-correlation.md)):
*"Provider ids are evidence. App ids are identity."*

**Hidden git-ref checkpoints.**
[`CheckpointStore.ts`](https://github.com/pingdotgg/t3code/blob/cf3e714b0f58e29c8fa8660db50d2187e3263b65/apps/server/src/checkpointing/CheckpointStore.ts)
captures and restores workspace state under `refs/t3/checkpoints/…` and computes diffs between
checkpoints. No copies of the tree are made, and the user's branch history is not polluted.

**Context handoffs are honest.**
[`docs/internals/context-handoffs.md`](https://github.com/pingdotgg/t3code/blob/cf3e714b0f58e29c8fa8660db50d2187e3263b65/docs/internals/context-handoffs.md):
switching providers produces *textual summaries* that "do not claim native provider context
parity".

**Engineering culture.** The AGENTS.md "note from Theo" is a useful design principle: *"Do not
introduce machinery because it looks architecturally impressive. Understand the real constraint,
then fight for the smallest model that makes the correct behavior unsurprising."*

## Context management, tool loop, edits, verification, compaction

None of its own. T3 Code delegates all of these to the wrapped agent. Its value to Kai is
entirely the **control-plane architecture**.

## Adopt

1. **The runtime owns the workspace.** Kai's runtime owns the repository, git, processes,
   credentials, the event store and the model calls. Clients only render and send commands
   ([ADR-0002](../../adr/0002-runtime-client-boundary.md)).
2. **A single typed protocol package** shared by runtime and clients, with capability
   negotiation.
3. **Snapshot plus sequence-cursored event stream** for clients, so reconnects and late joiners
   are cheap.
4. **App-owned IDs**, with provider IDs (Gemini `interaction.id`, function-call IDs) stored as
   references.
5. **Hidden git-ref workspace checkpoints** (`refs/kai/checkpoints/…`).

## Reject or postpone

- **Multi-surface v1** (web + desktop + mobile + relay/tunnel). Kai v1 ships a CLI/TUI only. The
  protocol makes other clients possible later without paying for them now.
- **Effect as a foundation.** It is powerful, but it raises the barrier for the next implementer
  and adds a large conceptual surface. Kai uses plain TypeScript with explicit interfaces
  ([ADR-0001](../../adr/0001-implementation-language-runtime.md)).
- **Wrapping other agents' CLIs.** Kai *is* the agent. The provider-adapter idea transfers to
  Kai's *model* providers, not to wrapping harnesses.
- **The execution-graph complexity** (subagents, approvals and plans as graph nodes). Kai v1 has
  no subagents. Its only secondary model invocations are the critic and replan passes, modelled
  as ordinary events.
