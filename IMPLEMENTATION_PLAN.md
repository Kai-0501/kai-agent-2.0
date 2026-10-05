# Implementation plan

This plan is written to be handed to a coding agent (e.g. Cursor) together with
[`AGENTS.md`](AGENTS.md), [`ARCHITECTURE.md`](ARCHITECTURE.md) and the
[specs](docs/specs/). It is ordered by dependency. Each phase ends with a **vertical slice**:
something a user or the benchmark can run end-to-end.

**Ground rules for every phase**
- Read the relevant spec(s) and ADR(s) before writing code. If you need to deviate, update the
  spec (and write a superseding ADR for decision-level changes) in the same PR.
- Every new mechanism ships with its **config key, ablation flag, telemetry counters and tests**
  ([ADR-0014](docs/adr/0014-measurement-gated-mechanisms.md)).
- Keep `pnpm check` (lint, typecheck, unit tests) green on every commit.
- No live API calls in unit tests. Use the fake provider or recorded fixtures. Live contract
  tests run only with `GEMINI_API_KEY` and only in the `test:contract` script.

Sizes: **S** ≈ a focused day, **M** ≈ several days, **L** ≈ one to two weeks of agent-assisted
work. These are relative sizes for planning order, not commitments.

---

## Phase 0: Foundations (S)

**Build**
- pnpm workspace with the packages from the [scaffold](packages/): `protocol`, `core`,
  `provider-gemini`, `code-intel`, plus new `runtime` and `cli`. The scaffold's type-only
  modules (marked with a `SCAFFOLD` header) become real modules as each phase needs them. Remove
  the header from a file once it contains a real implementation. Replace hand-written protocol
  types with Zod schemas.
- TypeScript strict config (already in `tsconfig.base.json`), Biome, vitest, and CI (GitHub
  Actions: install → `pnpm check` on Linux and macOS, Node 24).
- `packages/core/src/config`: a typed config with Zod, layered loading (defaults → user →
  workspace → flags), and a documented key registry.
- Logging: structured JSON logs to a file in the data dir, never to stdout in protocol mode.
- A **fake provider** (scripted turns) for tests ([ADR-0011](docs/adr/0011-provider-extensibility-boundary.md)).

**Acceptance**
- `pnpm i && pnpm check` passes in CI on both OSes.
- The config schema prints with `kai config schema`. Unknown keys fail validation with a clear
  message.

---

## Phase 1: Walking skeleton (L). *Slice A: "Gemini edits a file end-to-end, fully recorded"*

**Build** (in this order)
1. **Session Store** ([event-model](docs/specs/event-model.md)): SQLite (WAL), `events`, blobs,
   the projections `tasks`, `task_contracts`, `inflight_transactions`, `turn_usage`,
   `artifacts` (minimal), the rebuild command, the `synchronous=FULL` journal-commit path, and
   startup recovery (journal first, then dangling tool calls).
2. **KSP** ([protocol](docs/specs/protocol.md)): Zod schemas, in-memory and stdio transports,
   `initialize`, `workspace.open`, `session.*`, `task.submit/steer/amend/cancel/report`,
   `recovery.resolve`, and `subscribe` with snapshot + `seq`. The **`UserActionToken`** is
   mintable only in user-action handlers.
   - **Task Contract** ([task-contract](docs/specs/task-contract.md)): recorded verbatim at
     `task.submit`, amended only by user actions, rendered in the seed. This comes before any
     tool that could otherwise let the model state requirements.
3. **Gemini Provider** ([gemini-provider](docs/specs/gemini-provider.md)): Interactions
   streaming, **chained and stateless** modes, usage capture, raw response blobs, retries,
   thinking-level clamping, capability probing (`models.get` + level probe), the fixture
   transport, and **live contract tests 1–6**.
4. **Turn Loop** (ARCHITECTURE §5) with a fixed `thinking_level` (config) and no epochs yet: a
   single chain per task.
5. **Core tools v0**: `read_file` (ranges, numbered lines, no ledger yet), `grep_search`
   (ripgrep), `glob`, `replace` (exact match only, unique, no firewall yet) and `write_file`,
   **both through the write-ahead journal** (PREPARE → STAGE → VERIFY → SWAP → COMMIT, plus
   startup recovery; [patch-engine](docs/specs/patch-engine.md#commit-protocol-write-ahead-journal)),
   because invariant J1 holds from the first write. Also `run_shell_command` (process group,
   timeout, naive head+tail truncation, a deny-list policy for the obvious classes),
   `update_plan` (model-authored working state; **no** objective or acceptance fields), and
   `complete_task` (sets `implemented_unverified`; no gate yet).
6. **CLI**: `kai run "<prompt>"` (interactive streaming), `kai run --headless --json`
   (stdio), the per-turn telemetry line (reported usage only), and `kai doctor` (key present,
   model reachable, privacy notice).

**Acceptance**
- On fixture repository `fixtures/ts-small` (created in this phase: a small TS library with
  vitest tests): *"add a `slugify` util with tests and export it from index.ts"* completes in
  both state modes. The final diff typechecks (checked manually in
  this phase).
- Every model request is reproducible from the event log (test: re-serialize the request from
  the `ModelRequest` event and compare with the recorded SDK payload).
- Contract tests pass against the live API. G1/G3/G4 measurements are written to
  `docs/evaluation/reports/contract-<date>.md`.
- `kai db rebuild` gives identical projections.
- Journal crash cases K2–K6 from the patch-engine matrix pass for single- and multi-file
  `write_file` transactions.
- No code path from the Turn Loop or tools can amend the Task Contract (task-contract
  acceptance test 1).

---

## Phase 2: Measurement first (M). *Slice: "baseline numbers exist"*

**Build** ([benchmark plan](docs/evaluation/benchmark-plan.md), [corpus](docs/evaluation/corpus.md))
- `packages/bench`: the task format loader, a container runner, arm adapters **A0
  (mini-swe-agent + Gemini)** and **B (Kai via stdio KSP)**, the evaluator (hidden tests,
  regression), and the offline metrics (tokens, cost, resolve, repeated reads from transcripts,
  first-edit compile replay).
- **Corpus v0-alpha:** 12 tasks (4 SWE-bench Verified Python, 8 curated TS covering
  `invented_api_trap`, `big_output`, `reread_pressure`, `trivial`).
- Report generator (markdown + JSON).

**Acceptance**
- `pnpm bench --arms A0,B --tasks v0-alpha --runs 3` produces a report with CIs.
- Baseline numbers for A0 and the Phase 1 skeleton are committed to `docs/evaluation/reports/`.

---

## Phase 3: Token discipline (L). *Slice B: "a big-output, re-read-heavy task costs a fraction of baseline"*

**Build**
1. **Artifact Store + Result Shaper** ([artifact-store](docs/specs/artifact-store.md)): blobs,
   parsers (vitest, jest, node:test, pytest, tsc, pyright, eslint, ruff, generic), shaping,
   redaction, and `read_artifact`. Background processes.
2. **Read Ledger** ([read-ledger](docs/specs/read-ledger.md)): entries, `check` (stub, partial,
   diff), staleness on watcher and hash checks, `edit_echo`, line remapping, the `refresh` flag,
   and counters.
3. **Context Compiler** ([context-compiler](docs/specs/context-compiler.md)): seed layout and
   budget allocation (repo map placeholder: directory tree until Phase 5), ingress admission,
   **request preflight** (batch cap, projection with carried output, reshape, rollover;
   never above the hard limit), **complete request accounting** (all categories including
   model-generated history, the accounting identity, calibration on measured ingress only),
   **epochs** (all rules), the **deterministic epoch brief** with the verbatim contract,
   `<last_results>` / `carriedResults`, the `update_plan` integration, and stateless batched
   elision.
4. **Instruction map and gate**: instruction-file discovery at workspace open, seed inclusion
   for known paths, read-time delivery, and the **pre-mutation instruction gate** in the
   `replace`/`write_file` path and for mutating shell commands
   ([patch-engine](docs/specs/patch-engine.md#instruction-gate)).
5. Telemetry v1 ([telemetry](docs/specs/telemetry.md)): full `TurnRecord` and counters, `kai
   stats`, the price table, and savings **gated on accounting health**.

**Acceptance**
- Unit and acceptance tests from the specs above pass (including context-compiler tests 6–10).
- Over the whole benchmark run, **no request exceeds `epochHardLimit`** (asserted from
  `PreflightDecision` and `ModelRequest` events).
- Accounting is healthy (mean `|residual|/reported ≤ 5%` over trailing 20 requests) on the
  benchmark sessions. Otherwise savings are reported as uncalibrated, and the phase is not done.
- Benchmark (v0-alpha, plus `nested_instructions` and `large_batch` tasks): **lower median
  tokens per resolved task than the Phase 1 skeleton and A0, at non-inferior resolve rate**. The
  duplicate-read rate is about 0, the spooling ratio is reported, and there are **zero
  instruction violations caused by edits made before their instructions were delivered**.

---

## Phase 4: Transactions and verification (L). *Slice C: "a task ends `verified` with evidence, or honestly does not"*

**Build**
1. **Patch Engine** ([patch-engine](docs/specs/patch-engine.md)): overlay transactions per model
   response, the matching ladder with candidates, ledger version checks, the journaled commit
   for multi-edit transactions (extending Phase 1), `RecoveryConflict` handling with
   `recovery.resolve`, the user rollback API as a journaled transaction, reverse patches, and
   result formats.
2. **Workspace safety** ([ADR-0013](docs/adr/0013-workspace-safety-and-checkpoints.md)): git-ref
   checkpoints with a private index, restore, the command policy on parsed argv, env
   sanitization, and `--worktree` mode.
3. **Firewall, cheap tier**: F0 (path), F1 (tree-sitter parse delta. This brings in
   `web-tree-sitter` with TS, JS and Python grammars from the index work), F2 (placeholders), F7
   (scope), F9 (secrets).
4. **Verification Engine** ([verification-engine](docs/specs/verification-engine.md)): profile
   discovery and persistence, tiers T2–T4, the gate, the state machine (including `blocked`
   reasons), **baseline classification with established-only flakiness** (now-reruns, baseline
   runs, baseline-only flake history, user-owned `knownFlaky`, `introduced_intermittent`), the
   evidence bundle against the contract, and background T2 notices.
5. **Test Integrity Guard** ([test-integrity-guard](docs/specs/test-integrity-guard.md)):
   detectors I1–I14 (TS and Python), `justify_test_change` with **contract citations** and the
   deterministic citation check, the resolution matrix, and the gate integration. Until the
   critic's `integrity_review` arrives in Phase 6, every high-severity finding needs **user
   approval**. Headless runs end `blocked` (`integrity_review_required`).

**Acceptance**
- All acceptance tests in the specs above pass, including the **full crash-injection matrix
  K1–K8** and the introduced-race fixture (verification test 4).
- Benchmark adds `test_temptation`, `requirement_drift`, `intermittent_bug` and
  `no_tests_repo` tasks: **zero unresolved test-weakening changes in final diffs that Kai marked
  `verified`**, and **zero `verified` tasks with an introduced intermittent failure**. The
  premature-completion rate is lower than A0's.

---

## Phase 5: Code intelligence and the Hallucination Firewall (L). *Slice D: "an invented method is rejected before it is written, with the real alternatives"*

**Build**
1. **Repo Index** ([repo-index](docs/specs/repo-index.md)): the index tables, incremental
   updates, symbol cards, outlines, the PageRank **repo map** (replacing the Phase 3
   placeholder), the resolution API, and `read_symbol`. `read_file` outlines for large files.
2. **LSP Manager** ([ADR-0008](docs/adr/0008-code-intelligence-lsp.md)): the
   `vscode-jsonrpc` client, the TS and Python servers, overlay sync, pull and push diagnostics
   with settle and timeout, deltas, dependent-file opening, crash restarts, and the
   hallucination-class table.
3. **Firewall, full**: F3 (imports), F4 (symbols), F5 (dependencies), F6 (members), F8
   (integrity hook), degradation and late diagnostics, promissory symbols, waivers, and the
   rejection format.
4. **API Reality Checker** ([api-reality-checker](docs/specs/api-reality-checker.md)): the
   source ladder, cache, probes, `api_reality` pack, and `ApiFacts` cards in seeds.
5. The **`code_intel` pack** (references, definition, type_of, workspace_symbols,
   rename_symbol as a transaction).

**Acceptance**
- Firewall fixture tests 1–8 pass for TS and Python. p95 firewall latency is ≤ 2.5 s on the
  medium fixture.
- Benchmark adds `api_drift`, `interface_misread` and `cross_file_refactor`: the
  **invented-symbol escape rate** (in final diffs) is lower than A0's, and the **first-edit
  compile rate** is higher. Firewall false-positive blocks (rejections later waived or proven
  wrong by review) are under 5% of rejections.

---

## Phase 6: Control loops (M). *Slice E: "a stuck task replans cleanly and either succeeds or stops honestly"*

**Build**
1. **Reasoning Governor + Risk Assessor** ([reasoning-governor](docs/specs/reasoning-governor.md)).
2. **Repair/Replan Controller** ([repair-replan-controller](docs/specs/repair-replan-controller.md)),
   with fingerprints, rules D1–D8, budgets, the replan brief, and a read-only first replan turn.
3. Provider **degenerate-output guard** wiring into D7.
4. **Critic** ([critic](docs/specs/critic.md)), with **two modes and separate budgets**:
   optional `risk_review` (triggers, evidence bundle, `submit_review`, evidence validation,
   incremental re-review; skippable on exhaustion) and mandatory `integrity_review` (reserved
   budget, `submit_integrity_verdicts`, quote validation; unavailable → unresolved → not
   `verified`). Contract-backed high-severity integrity findings route to `integrity_review`.
5. **Capability pack activation** at epoch boundaries ([ADR-0012](docs/adr/0012-tool-surface-and-dynamic-exposure.md)),
   plus `allowed_tools` phase restrictions.

**Acceptance**
- Spec acceptance tests pass, including scripted stuck scenarios with the fake provider, and
  critic tests 4–7 (risk budget exhaustion never removes a mandatory integrity review).
- Benchmark adds `repair_loop_bait` and `long_horizon`: **thought tokens per resolved task drop
  versus `--governor=fixed:high`** at non-inferior resolve rate. Replan success rate is
  reported.

---

## Phase 7: Calibration and v1 hardening (M)

**Build**
- Corpus v0 (60 tasks, 20% frozen held-out), the A1 arm (Gemini CLI headless), all ablations,
  and calibration sweeps.
- Choose defaults per the benchmark. Remove or disable any mechanism that fails
  [ADR-0014](docs/adr/0014-measurement-gated-mechanisms.md).
- Crash and recovery test suite (including the nightly block-level crash-simulation harness),
  `kai gc`, retention, `kai doctor` checks (accounting health and identity violations, LSP
  health, profile sanity, G10 probe), and user docs.

**Acceptance (v1 release criteria)**
- On the held-out set versus A0: **≥ 25% lower median cost per resolved task**, **resolve rate
  not worse than −2 pp**, and **lower invented-symbol escape and premature-completion rates**,
  with CIs reported. These targets are hypotheses. If they are not met, the report says so, and
  the next steps follow the data.

---

## Suggested vertical-slice order for the first weeks

1. Phase 0 plus Phase 1 items 1–3 (store, protocol, provider with contract tests). This
   de-risks the API early.
2. Phase 1 items 4–6. Demo slice A.
3. Phase 2 with only 4 tasks at first, so numbers exist before any optimization.
4. Phase 3 Artifact Store first. It is the cheapest big win and has no dependency on the index.

## Postponed (deliberately)

| Item | Why postponed | Revisit when |
|---|---|---|
| Daemon + WebSocket transport, remote auth | No second client yet ([ADR-0002](docs/adr/0002-runtime-client-boundary.md)) | A desktop or web client is planned |
| ACP adapter | Nice-to-have integration | After v1, if editors and T3 Code integration are wanted |
| Desktop/web/mobile UI | v1 is CLI-first | After v1 |
| OS sandbox (bwrap/Seatbelt) | Large. The policy plus process groups cover v1 | Before untrusted or multi-user use |
| Other model providers | Gemini-first. The fake provider validates the boundary | When a concrete need arises |
| MCP servers | Plugin sprawl risk | Allowlisted packs, after v1 |
| Go/Rust/Java LSP and grammars | v1 is TS/JS and Python | Corpus v1 |
| `multi_file_patch`, `symbol_edit` as defaults | Out-of-distribution for Gemini, unproven | When ablations show wins |
| Explicit caching (`cachedContents`) | Interactions uses implicit caching. Unclear ROI | If G5 measurements show large cross-epoch prefix reuse |
| Embeddings / semantic search | Unproven over structural plus lexical search | If retrieval misses show up in benchmark failure analysis |
| Multi-agent / subagents | Non-goal | Not planned |
| Windows | Process and shell differences | After v1 |
| Session branching (tree) | Linear plus fork-by-copy is enough | When the UI supports it |
