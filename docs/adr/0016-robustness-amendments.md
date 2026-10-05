# ADR-0016: Robustness amendments from design review 1

- Status: Proposed
- Date: 2026-10-05
- Amends: [ADR-0005](0005-context-compiler-and-epochs.md), [ADR-0007](0007-editing-protocol.md), [ADR-0009](0009-verification-architecture.md), [ADR-0010](0010-telemetry.md), [ADR-0004](0004-durable-event-session-model.md)
- Related: [ADR-0015](0015-user-owned-task-contract.md) (review finding 1)

## Context / problem

A design review of the founding architecture found six further gaps where an efficiency or
correctness mechanism could be defeated:

| # | Finding | Where the gap was |
|---|---|---|
| R2 | A newly introduced intermittent bug could end `verified`: a failure that passed on rerun was labelled "flaky", and flaky failures did not block | ADR-0009, verification spec |
| R3 | Multi-file "atomicity" relied on in-process rollback. No durable prepared record of before/after images existed before the first rename, so a crash between renames had no defined recovery | ADR-0007, patch-engine and event-model specs |
| R4 | Epoch decisions used the *previous* request's reported size. Many individually capped tool results could together push the *next* request over the hard limit | ADR-0005, context-compiler spec |
| R5 | The context manifest covered seeds and incoming tool results, but not accumulated model output and function-call arguments, so calibration could misattribute that growth | ADR-0010, context-compiler and telemetry specs |
| R6 | Nested instruction files arrived only when a tool touched their directory, so the first edit there could run before its instructions reached Gemini | ADR-0005, tool-surface and context-compiler specs |
| R7 | Critic budget exhaustion allowed `verified`, while the Integrity Guard required critic review or user approval for some test changes. The two rules conflicted | Critic and integrity-guard specs |

## Considered alternatives

For each finding, the options considered were: (a) document the limitation, (b) add an LLM
check, or (c) add a deterministic mechanism. In every case, (c) was cheap enough and closed the
gap without new model calls, so it was chosen. The details are in the specs.

## Decision

- **R2. Flakiness must be established, not inferred from one rerun.** A failure is treated as
  non-blocking flakiness only if (i) baseline runs at the task-start checkpoint show both passes
  and failures, or the baseline-only flake history does, without a material worsening; or (ii)
  the test is on the user-owned `knownFlaky` list, or the user approved an exception. A failure
  that appears now while the baseline passed every run is **`introduced_intermittent`**, and it
  blocks. Baseline impossible → introduced (fail closed).
  ([verification-engine](../specs/verification-engine.md#lazy-baseline-classification))
- **R3. Write-ahead journaled transactions.** Before any file is touched, a
  `TransactionPrepared` record holding every file's full before- and after-images is made durable
  (blobs fsynced, `synchronous=FULL` commit). Then: stage temp files, verify hashes, swap, and
  write the commit marker. Startup recovery is deterministic and idempotent: roll forward if
  every file is in its after-state, abort if none was swapped, roll back a mixed state, and block
  for the user when a file was changed by someone else. It is tested with a crash-injection
  matrix (K1–K8).
  ([patch-engine](../specs/patch-engine.md#commit-protocol-write-ahead-journal))
- **R4. Request preflight.** Before *every* request, project its complete size: prior reported
  input, plus carried model output (and thoughts if applicable), plus the pending ingress batch,
  plus framing and a calibrated margin. Enforce an `ingressBatchMax`. Reshape, or roll over to a
  new epoch, **before** sending. No request is ever sent above the hard limit.
  ([context-compiler](../specs/context-compiler.md#request-preflight))
- **R5. Complete request accounting.** Manifests carry cumulative composition and per-request
  deltas for **every** category, including `history_model_text`, `history_function_calls`,
  `history_thoughts` and `framing`. Model-generated history is sized from **reported** usage. The
  estimator is calibrated only on measured ingress (from the chained-mode accounting identity)
  and on seed turns. Estimated savings are shown as calibrated only while accounting is healthy.
  ([context-compiler](../specs/context-compiler.md#complete-request-accounting), [telemetry](../specs/telemetry.md#accuracy-guards))
- **R6. Instruction map plus pre-mutation instruction gate.** All instruction files are discovered
  at workspace open. The applicable ones are included in seeds for known paths. The Patch Engine,
  and the shell runner for mutating commands, refuse to act on a path until every applicable
  instruction file has been delivered in the current epoch at its current hash. The refusal
  delivers the text, so the model reconsiders before anything is written.
  ([context-compiler](../specs/context-compiler.md#project-instructions-instruction-map-and-pre-mutation-gate), [patch-engine](../specs/patch-engine.md#instruction-gate))
- **R7. Two critic modes with separate obligations.** `risk_review` is optional and skippable
  when its budget runs out. `integrity_review` is mandatory when the Integrity Guard requires it,
  and has a **reserved** budget that risk review cannot consume. If it cannot complete, the
  finding is **unresolved**, which blocks `verified` until the user approves; headless tasks end
  `blocked` (`integrity_review_required`).
  ([critic](../specs/critic.md#modes-and-budgets), [test-integrity-guard](../specs/test-integrity-guard.md#justification-and-review))

The amended ADRs carry an "Amended by ADR-0016" note at each affected decision point.

## Rationale

Each fix makes a gate fail closed in the scenario the review identified, using deterministic
mechanisms. Token cost does not increase measurably:
- preflight saves tokens by preventing oversized requests;
- the instruction gate costs one extra turn at most once per instruction file per epoch;
- baseline reruns run only on failing tests;
- the journal costs disk I/O, not tokens.

## Consequences

- **Fewer `verified` outcomes in headless runs.** Introduced intermittent failures now go to
  repair and can end `verification_failed`. Unresolved integrity reviews end `blocked`
  (`integrity_review_required`). These are correct outcomes, and the benchmark reports `blocked`
  separately from `verification_failed`.
- **PREPARE latency:** one `synchronous=FULL` commit plus blob fsyncs per transaction (expected
  in the low milliseconds on SSDs). This is measured.
- **Gate verification time:** reruns plus baseline runs of failing tests. These are bounded by
  `verify.rerunsNow` and `verify.baselineRuns`, and only run on failure.
- **Implementation order:** preflight and accounting belong in Phase 3 together with the
  compiler. The instruction map and its gate also belong in Phase 3, since the gate guards the
  edit path that exists from Phase 1. The journal and startup recovery start in Phase 1
  (invariant J1 holds from the first write). Phase 4 extends them to overlay multi-edit
  transactions, adds `RecoveryConflict` resolution, and runs the full crash matrix. Critic
  modes belong in Phase 6 ([IMPLEMENTATION_PLAN](../../IMPLEMENTATION_PLAN.md)).

## Unresolved questions

1. G10: whether chained `total_input_tokens` includes prior output and thoughts as assumed. The
   accounting identity detects a mismatch and re-probes.
2. Default `verify.baselineRuns` (5) trades gate time against false `introduced` labels on rarely
   flaky tests. Calibrate it on the corpus.
3. Should the instruction gate also cover *read* access to sensitive subtrees (instructions that
   say "never read X")? Currently `.kaiignore` covers that need.
