# ADR-0005: Context compiler and context epochs

- Status: Proposed
- Date: 2026-10-05
- Related: [specs/context-compiler.md](../specs/context-compiler.md), [specs/read-ledger.md](../specs/read-ledger.md), [specs/artifact-store.md](../specs/artifact-store.md), [research/synthesis.md §2.1](../research/synthesis.md#21-construct-each-model-turn-from-a-strict-token-budget-conflicts-with-gemini-caching)

## Context / problem

Kai must give Gemini *the smallest high-quality context necessary*. The naive reading, "recompile
the entire context from a budget on every turn", conflicts with how Gemini is billed and cached:

- implicit caching rewards an unchanged prefix, and
- with `previous_interaction_id` the server holds history Kai cannot edit.

On the other hand, letting a chain grow until the 1M window fills (Gemini CLI compresses at 50%)
accumulates cost, stale file views and abandoned hypotheses.

## Considered alternatives

1. **Full per-turn recompilation** (stateless, rebuilt every turn). Maximum control. Destroys
   cache reuse beyond the stable prefix and sends large requests. Too expensive.
2. **Append-forever with threshold compaction** (most CLIs). Cache-friendly, but context is
   uncontrolled and compaction is an all-or-nothing LLM summary that comes late (50–80% of the
   window).
3. **Epochs: budgeted seed plus ingress control** (chosen). Append-only within an epoch;
   deliberate resets at budget or phase boundaries; seeds compiled from durable state.
4. **Sliding windows and observation masking** (SWE-agent, OpenCode pruning). Useful in
   stateless mode as a batched optimization. Cannot be applied to chained server state.

## Decision

**Epoch-based context compilation.**

1. **An epoch** is a contiguous run of model turns that share one append-only context. In
   chained mode it is one `previous_interaction_id` chain.
2. **Seed compilation.** At epoch start, the Context Compiler builds the first request under a
   strict token budget, in this **fixed, cache-friendly order**:
   `system instruction → tool declarations → project instructions → epoch brief → repository map
   → relevant code (symbol cards and excerpts) → current directive`. A reserve for thinking and
   output is subtracted from the budget first.
3. **Ingress control within an epoch.** Every tool result passes through the **Result Shaper**
   (Artifact Store spooling, structured summaries) and the **Read Ledger** (de-duplication and
   staleness notices) before it is appended. Harness notices (verification results, stale-file
   notices, budget signals) are short and are appended, never inserted earlier.
4. **Epoch boundaries** (whichever comes first):
   - observed `total_input_tokens` of the last request exceeds the **soft epoch limit** (default
     64k, configurable, to be calibrated by the benchmark);
   - **phase transition** (exploration/planning → implementation, after a plan is accepted;
     any → replan);
   - **replan** triggered by the Repair/Replan Controller (always a fresh epoch);
   - **resume after idleness** longer than the implicit-cache horizon (default 30 min), or after
     external workspace changes to files read in the epoch;
   - **hard limit** (default 160k): a forced boundary even mid-phase;
   - a model or provider switch, or a new user task.
5. **The epoch brief is mostly deterministic.** It is assembled from projections: objective and
   acceptance criteria, constraints, plan, decisions and notes the model recorded through
   `update_plan`, files read (ledger, with symbol cards), files modified (diff stat plus each
   transaction's `instruction`), verification state, known failures (exact, fingerprinted),
   attempted approaches, and the next action. **Only** if the model has not recorded its
   decisions does an LLM "decision digest" run, at `thinking_level: low` with a token cap
   (≤ 600 output tokens).
6. **The emergency window.** The model's full input limit (1,048,576 tokens) is never a target.
   Exceeding the hard limit is a telemetry alarm.
7. **Stateless mode.** The same compiler runs every turn, but it keeps the seed byte-identical
   and appends the tail. Old tool results are elided **in batches** only (minimum gain ≥ 20k
   estimated tokens, the OpenCode/Gemini CLI threshold logic), each recorded as a
   `ContextElided` event, to limit cache invalidation.

## Rationale

This uses Gemini's server state for what it is good at (cheap, cached, append-only short runs)
and keeps Kai in control of what accumulates. Epoch resets double as **stale-assumption resets**,
which the founding prompt asked for. Deterministic briefs are cheaper and more reliable than LLM
summaries: they cannot invent file state.

## Consequences

- Each epoch start pays one cache miss on the seed (estimated 8–20k tokens). Epochs must
  therefore not be too short. The benchmark sweeps the soft limit (32k/64k/128k).
- The model must be told what epochs are. The system prompt explains that the brief is
  authoritative, that earlier turns are not visible, and how to re-read files.
- `update_plan` becomes important. Decisions the model does not record may not survive an epoch.
  The Context Compiler adds a one-line notice asking the model to record decisions before a
  planned boundary.
- Telemetry must attribute tokens to each seed category and each ingress category
  ([ADR-0010](0010-telemetry.md)).

## Unresolved questions

1. Optimal soft limit per task type. To be calibrated.
2. Whether changing tool declarations at an epoch boundary is free (it is a new chain, so it
   should be).
3. Whether an explicit cache of the stable prefix (system + tools + project instructions + map)
   across epochs is worth adding via `generateContent` (G5 and evaluation).
