# ADR-0004: Durable event and session model

- Status: Proposed
- Date: 2026-10-05
- Related: [specs/event-model.md](../specs/event-model.md), [research/upstream/openhands.md](../research/upstream/openhands.md), [research/upstream/pi.md](../research/upstream/pi.md), [ADR-0010](0010-telemetry.md)

## Context / problem

Kai's token-efficiency mechanisms (aggressive epochs, ingress gating) are only safe if nothing is
ever *lost*. Its correctness mechanisms (verification, repair fingerprints, the critic) need an
exact record of what was read, proposed, applied and verified. The model's context window must
not be the system of record.

## Considered alternatives

1. **Conversation transcript as state** (most CLIs). Compaction destroys information. There is no
   structured query for "which files did the model read".
2. **JSONL session tree** (Pi). Simple, append-only, human-readable. Weak for queries (ledger
   lookups, telemetry aggregates). Concurrency and atomic multi-record updates are awkward.
3. **Append-only event log in SQLite plus projections** (OpenHands' concepts, T3 Code's storage).
   Durable, queryable, transactional. Less human-readable, so a JSONL export is provided.
4. **Event sourcing with no projections** (recompute everything from events on every query).
   Pure, but too slow for per-turn ledger checks.

## Decision

**Option 3.**

- **One SQLite database per workspace**, under the user data directory
  (`$XDG_DATA_HOME/kai/workspaces/<repo-id>/kai.db`, where `repo-id` is a hash of the canonical
  repository root and its first commit). WAL mode. Nothing is written inside the repository
  except an optional committed `.kai/project.json` and scoped instruction files.
- **The `events` table is append-only.** Each row has `seq` (global, monotonically increasing),
  `session_id`, `task_id`, `epoch_id`, `turn_id`, `type`, `ts`, `payload` (JSON validated by Zod
  per type), and `blob_refs`. Events are **never updated or deleted** during a session's life.
  Retention and garbage collection are separate, explicit maintenance operations.
- **Projections are tables updated in the same transaction as the event that changes them**:
  `ledger_reads`, `artifacts`, `transactions`, `diagnostics_snapshots`, `verification_runs`,
  `attempts`, `turn_usage`, `tasks`. A projection can be rebuilt from events (`kai db rebuild`),
  and this is a tested invariant.
- **Blobs** (file snapshots, tool outputs, large payloads) are content-addressed (SHA-256) in a
  `blobs/` directory next to the DB, zstd-compressed. Events refer to them by hash.
- **Model context is a projection.** Only the Context Compiler turns durable state into model
  input. Every model request is recorded as a `ModelRequest` event that stores the exact compiled
  input or a manifest pointing to blobs, the tool declarations hash and the generation config, so
  any request can be reproduced byte-for-byte.
- **Context operations are append-only markers**, the tombstone approach from OpenHands:
  `EpochStarted`, `EpochBriefBuilt`, `ContextElided` (stateless mode only). Nothing in the log is
  removed when context shrinks.
- **Sessions are linear in v1.** A fork copies events up to a `seq` into a new session with
  `parent_session_id` and `forked_from_seq`. In-place branching (Pi's tree) is postponed.

## Rationale

SQLite gives atomic multi-table updates, which an event plus its projection rows need, fast
indexed lookups for the ledger, and zero operational burden. Append-only events plus rebuildable
projections give OpenHands-grade durability with interactive-speed reads.

## Consequences

- Event schemas are versioned. Each payload carries `v`, and migrations upcast old payloads on
  read.
- The DB can grow large on long sessions, mostly from blobs. Blobs are deduplicated by hash, and
  the event log stores references, not copies.
- The protocol event stream ([ADR-0002](0002-runtime-client-boundary.md)) is a filtered view of
  the same `seq`, so clients and storage agree on ordering.
- Concurrency: one runtime process writes a workspace DB at a time, enforced with a lock file
  plus SQLite `BEGIN IMMEDIATE`.

## Unresolved questions

1. Retention defaults for blobs. Proposed: keep 30 days, or the last 20 sessions, configurable.
2. Should the event log be optionally committed or exported per task for team review? It might
   contain secrets from tool output, so it needs redaction first.
3. Is a per-user DB with workspace partitioning better for cross-repository statistics?
