# Cline

- **Repository:** [cline/cline](https://github.com/cline/cline) @ `68b24a92` (2026-10-05)
- **License:** Apache-2.0
- **Language/runtime:** TypeScript, Bun toolchain, Node ≥ 22 runtime. VS Code extension (`apps/vscode`), CLI with a `cline-hub` daemon (`apps/cli`), and a layered SDK (`sdk/packages/{shared,llms,agents,core}`). Providers through the AI SDK.
- **Studied as:** inspiration for observability, checkpoints and user-facing execution telemetry.

## Architecture

Cline has been restructured into an SDK with strict layering
([`sdk/ARCHITECTURE.md`](https://github.com/cline/cline/blob/68b24a92b71ee98c3e8ea4aca7a7a1c0f97a43b8/sdk/ARCHITECTURE.md)):
`shared` (contracts) ← `llms` (providers) ← `agents` (a **stateless** loop: iteration, tool
orchestration, events, hooks) ← `core` (stateful orchestration, storage, host lifecycle) ← host
apps. Its design rule that *"`agents` should not own persistent storage"* is a clean separation
worth copying.

## Context management

- **Duplicate file read removal.** Older reads of the same file are retroactively replaced with
  *"[[NOTE] This file read has been removed to save space in the context window. Refer to the
  latest file read for the most up to date version of this file.]"*
  ([`responses.ts` L11](https://github.com/cline/cline/blob/68b24a92b71ee98c3e8ea4aca7a7a1c0f97a43b8/apps/vscode/src/core/prompts/responses.ts#L11)).
  This proves duplicate reads are a real, measurable waste. Rewriting earlier history, however,
  invalidates prompt caches from that point onward.
- **Truncation that keeps the first user message** plus a truncation notice (same file).
- **Output limits:** 48k characters for command, read and search outputs, at most 2,000 lines,
  and at most 2,000 characters per line
  ([`output-limits.ts`](https://github.com/cline/cline/blob/68b24a92b71ee98c3e8ea4aca7a7a1c0f97a43b8/sdk/packages/core/src/extensions/tools/executors/output-limits.ts)).
- Compaction strategies `basic | agentic | custom` and modes `auto | manual |
  overflow_recovery`, all with telemetry events
  ([`core-events.ts`](https://github.com/cline/cline/blob/68b24a92b71ee98c3e8ea4aca7a7a1c0f97a43b8/sdk/packages/core/src/services/telemetry/core-events.ts)).

## Checkpoints

[`checkpoint-hooks.ts`](https://github.com/cline/cline/blob/68b24a92b71ee98c3e8ea4aca7a7a1c0f97a43b8/sdk/packages/core/src/hooks/checkpoint-hooks.ts)
snapshots the workspace, **including untracked files**, using git plumbing with a **separate,
persistent `GIT_INDEX_FILE`** in a per-session scratch directory. Keeping the index between turns
lets git's stat cache skip re-hashing unchanged untracked files, so each checkpoint is cheap. The
user's real index is never touched. Stale scratch directories are reaped after 14 days.

## Observability

- Telemetry is an adapter interface with an **OpenTelemetry** implementation
  (`OpenTelemetryAdapter`, `OpenTelemetryProvider`) and a logger sink
  ([`services/telemetry/`](https://github.com/cline/cline/tree/68b24a92b71ee98c3e8ea4aca7a7a1c0f97a43b8/sdk/packages/core/src/services/telemetry)).
- Usage per request includes cache-read and cache-write tokens and cost.
- Compaction executed/skipped/"budget emergency" events, git snapshot observations correlated
  to model request IDs, and command timeout events.
- The user-facing UI shows each tool call, diff and approval. That transparency is a major
  reason for Cline's popularity.

## Tool loop, editing, verification

A conventional tool loop with human approval gates (Plan/Act modes in the extension). Edits are
search/replace on files. There is no deterministic verification gate: the model decides when it
is done (`attempt_completion`), subject to user review.

## Adopt

1. **Layering:** a stateless loop package with no storage, under a stateful core. This matches
   Kai's split between the `Turn Loop` and the `Session Store` and `Context Compiler`.
2. **Git-plumbing checkpoints with a private index** that include untracked files, as Kai's
   workspace checkpoint mechanism, under Kai-owned refs (see also [T3 Code](t3code.md)).
3. **Telemetry as an adapter**, with an optional OpenTelemetry exporter and a local store as the
   source of truth ([ADR-0010](../../adr/0010-telemetry.md)).
4. **Explicit telemetry events for context operations** (compaction, emergencies), so the cost
   of context management is itself measured.

## Reject or adapt

- **Retroactive duplicate-read removal.** Kai prevents duplicates **at ingress** with the Read
  Ledger instead, which keeps the cached prefix stable and costs nothing to revert
  ([spec](../../specs/read-ledger.md)).
- **Completion as a model claim.** Kai's `complete_task` triggers verification and does not end
  the task by itself.
- **Approval prompts as the main safety mechanism.** Kai keeps approvals for risky commands, but
  correctness comes from deterministic gates, not from asking the user to eyeball diffs.
