# ADR-0022: Shared procedural learning service

- Status: Proposed
- Date: 2026-10-05
- Related: [specs/learning-service.md](../specs/learning-service.md), [ADR-0004](0004-durable-event-session-model.md), [ADR-0014](0014-measurement-gated-mechanisms.md), [research/extension-2026-10.md §5](../research/extension-2026-10.md#5-hermes-procedural-learning-r17r18)

## Context / problem

Comparable projects repeat the same discovery work: finding the right symbols, rediscovering the
targeted test command, retrying commands that never work in this repository, misusing an
installed library version, reading oversized test output. Hermes shows that small procedural
documents ("skills") written after work can be reused cheaply. The goal here is narrower and
measurable: **lower total resource use per successfully completed comparable project, at
unchanged or better quality**. Skipping checks or thinking less is not automatically an
improvement.

## Considered alternatives

1. **Per-turn background review that replays the conversation** (Hermes default). Captures much,
   but replaying a coding project costs a large share of the project itself and judges lessons
   before outcomes are known.
2. **A growing global Markdown memory injected into every turn.** Cheap to build, and grows into
   a mandatory per-turn tax with unscoped, unverified advice.
3. **Embedding-based retrieval over transcripts.** Adds a model and an index whose benefit Kai
   has not measured.
4. **One runtime-owned service: deterministic evidence packets at project finalization, one
   bounded retrospective call, scoped versioned skills with an outcome-gated lifecycle, and
   deterministic retrieval under a hard budget** (chosen).

## Decision

- **Boundary:** learning runs after a **project finalization event** (explicit user completion,
  cancellation, or an observable rule such as an idle timeout after all tasks reached a final
  state). A model saying "done" is not such an event. Task-level evidence stays queryable.
- **Stores:** a separate **global learning store** (`<KAI_HOME>/learning/learning.db`,
  append-only `learning_events` plus projections). Workspace stores stay per workspace. The two
  are linked by a **durable outbox** in the workspace store and **idempotent job IDs** derived
  from `(projectId, finalizationGeneration, jobKind)`. Kai does not pretend two SQLite files
  share a transaction: the outbox row commits with the finalization event; delivery is
  at-least-once; the job ID makes its effect exactly-once.
- **Pipeline:** (1) deterministic evidence packet from events, projections and telemetry;
  (2) one bounded retrospective call on a permitted route, reading artifacts only through a
  read-only, budgeted evidence tool; (3) an immutable Markdown retrospective; (4) skill
  proposals validated by a deterministic policy linter, then merged into versioned skills.
- **Skill lifecycle:** `candidate → provisional → validated → retired`, with versions,
  provenance, scope, prerequisites, evidence references, contradictions and rollback.
  Automatic promotion stops at `provisional` for single-project evidence; `validated` needs
  repeated in-scope evidence with non-inferior outcomes, or a controlled evaluation.
- **Policy-class lessons are never automatic.** A proposal that would change permissions,
  verification requirements, test-integrity policy, user objectives or trusted runtime code is
  rejected by the linter. It can only become a user-directed configuration change.
- **Retrieval:** deterministic (SQLite FTS5 plus structured filters on language, framework
  versions, repository fingerprint and profile scope). At most 3 procedure cards and
  600 estimated tokens per seed, rendered as advisory content below user, repository and
  verification constraints. The **learning snapshot** used by a task is pinned by hash in the
  event log.
- **Markdown is a projection:** retrospectives and skills are rendered to human-readable files
  under `<KAI_HOME>/learning/md/`. User edits are imported as new versions after validation;
  corrupted or conflicting files are regenerated from the store and the edit is kept as a
  rejected import.
- **Privacy:** learning data lives outside worktrees. Secrets are redacted with the artifact
  redactor. Skills are scoped (`repo`, `stack`, `language`, `global`) and carry a privacy class;
  repository-private details never leave their repository scope. A local-only project's
  retrospective runs only on a local route; nothing is uploaded to a cloud model without the
  user's route choice.
- **Controls:** inspect, edit, disable, delete, export, reset and rollback, without approval
  pop-ups for routine low-impact lessons.
- **Measurement:** learning overhead (reflection calls, retrieval tokens, maintenance) is part of
  project resource totals. Savings are observations until a held-out evaluation with learning on
  vs off shows them ([benchmark plan](../evaluation/benchmark-plan.md#learning-evaluation)).

## Rationale

Reflecting once per finalized project, from a deterministic packet, keeps the overhead small
relative to the work and ties lessons to verified outcomes. A separate store matches the
app-wide scope without coupling workspace transactions to it. Outcome-gated promotion and the
policy linter stop the obvious failure mode ("these tests usually pass, so skip them").

## Consequences

- New KSP methods (`project.*`, `learning.*`) and events in both stores.
- Learning has an ablation flag (`learning.enabled`, `learning.retrieval`) and full telemetry
  ([ADR-0014](0014-measurement-gated-mechanisms.md)).
- If reflection is unavailable (no permitted route, quota), the packet is persisted and the
  review queued. Project completion is never blocked on learning.

## Unresolved questions

1. Whether embeddings improve retrieval enough to justify their cost. Not in R1; revisit if
   retrieval misses show up in the learning evaluation.
2. Thresholds for promotion and contradiction (initial values in the spec) need calibration.
