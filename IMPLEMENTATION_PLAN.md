# Implementation plan

This plan is written to be handed to a coding agent together with
[`AGENTS.md`](AGENTS.md), [`ARCHITECTURE.md`](ARCHITECTURE.md) and the
[specs](docs/specs/). It is ordered by dependency. Each phase ends with a **vertical slice**:
something a user or the benchmark can run end-to-end.

## Architecture tickets vs implementation

| Work | Status |
|---|---|
| Founding architecture (Gemini-first harness): ADRs 0001–0014, 17 specs, scaffold | Done (design only) |
| **Design-review amendments**: ADRs 0015–0016, Task Contract spec, amended specs and scaffold | Done (design only) |
| **Release extension** (this ticket): ADRs 0017–0024, 9 new specs, reconciled specs, research report, evaluation plan, scaffold types | Done (design only) |
| Phases 0–12 below | **Not started.** Each phase is a separate, executable implementation ticket |

All six release features (macOS app, Sign in with ChatGPT, the `openai` profile, compatible
endpoints, the `generic` profile, Chrome research) and shared learning are in the **R1 release**
([ADR-0017](docs/adr/0017-release-scope-macos-multi-provider.md)). Phases sequence them; none
is deferred to an open-ended "later". Their *default-on* settings follow the benchmark
([ADR-0014](docs/adr/0014-measurement-gated-mechanisms.md)), and the [release gates](#r1-release-gates)
say what must be shown before release.

**Ground rules for every phase**
- Read the relevant spec(s) and ADR(s) before writing code. If you need to deviate, update the
  spec (and write a superseding ADR for decision-level changes) in the same PR.
- Every new mechanism ships with its **config key, ablation flag, telemetry counters and tests**
  ([ADR-0014](docs/adr/0014-measurement-gated-mechanisms.md)).
- Keep `pnpm check` (lint, typecheck, unit tests) green on every commit.
- No live API calls in unit tests. Use the fake provider or recorded fixtures. Live suites run
  only in their own scripts and environments, and are **never reported as passing** without
  them: `test:contract` (`GEMINI_API_KEY`), `test:contract:openai` (`OPENAI_API_KEY`),
  `test:contract:compat` (the endpoint matrix), `test:live-auth` (macOS, an eligible ChatGPT
  account, a browser), `test:smoke:chrome` (macOS with Google Chrome), `test:smoke:app` (macOS).

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
- A **fake provider** (scripted turns) for tests ([ADR-0011](docs/adr/0011-provider-extensibility-boundary.md)),
  with configurable **capability snapshots**: no effort control, unknown usage fields, small
  context windows, no continuation ([ADR-0018](docs/adr/0018-providers-routes-profiles-capabilities.md)).
  Loop and controller tests use these from day one, so the generic cases are not retrofitted.
- **Config schema v2** with `KAI_HOME`, layered loading with restrict-only workspace keys, and the
  v1 → v2 **migration** ([configuration](docs/specs/configuration.md)).
- The `CredentialStore` port with `env_only` and in-memory test implementations
  ([credentials](docs/specs/credentials.md)); the Keychain implementation comes in Phase 7.
- The `HarnessProfile` port with the `gemini` profile reproducing the founding prompt contract.

**Acceptance**
- `pnpm i && pnpm check` passes in CI on both OSes.
- The config schema prints with `kai config schema`. Unknown keys fail validation with a clear
  message.
- A founding v1 config migrates to v2 idempotently (configuration acceptance test 1, minus the
  task run, which follows in Phase 1).

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
  the `ModelRequest` event and compare with the recorded SDK payload). `ModelRequest` carries
  all reproducibility pins (route, profile, capability snapshot, prompt and declarations
  hashes).
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
- `packages/bench`: the task format loader (including **project families**), a container
  runner, arm adapters **A0 (mini-swe-agent + Gemini)** and **B (Kai via stdio KSP)** with the
  route as a parameter, the evaluator (hidden tests, regression), and the offline metrics
  (tokens by reported/estimated/unknown, cost for metered routes, resolve, repeated reads from
  transcripts, first-edit compile replay).
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
   `<last_results>` / `carriedResults`, the `update_plan` integration, local replay with batched
   elision and tagged provider-native replay items, continuation-optional handling, and
   per-route estimator ratios with the unknown-usage fallback.
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
- Preflight tests with the fake 32k, no-usage snapshot: zero over-limit requests, and accounting
  labelled `uncalibrated` rather than reported as zero.

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
   reproductions, dispositions and deduplication, incremental re-review; skippable on
   exhaustion) and mandatory `integrity_review` (reserved
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

## Phase 7: Routes and profiles: OpenAI API key and compatible endpoints (L). *Slice F: "the same task verifies on Gemini, OpenAI and a local 32k endpoint with identical gate checks"*

**Build**
1. **Profiles package** ([harness-profiles](docs/specs/harness-profiles.md)): `gemini`,
   `openai`, `generic`; prompt templates and contract checks, tool rendering and aliases,
   effort mapping and hysteresis, context sizing, review and stop policies.
2. **`provider-openai`, API-key route** ([openai-responses-provider](docs/specs/openai-responses-provider.md)):
   allowlist builder, input-item mapping, verbatim native replay, streaming with
   terminal-event success, catalog, model-facts table, probes, error mapping; recorded SSE
   fixtures; live `test:contract:openai`.
3. **`provider-compatible`** ([compatible-endpoints](docs/specs/compatible-endpoints.md)): config
   validation, URL and scope rules, redirects and TLS, Chat Completions mapping, whole-call
   validation, probes P0–P9 with disclosure, snapshot cache and invalidation, `chat_only` mode,
   `kai endpoint doctor`; live `test:contract:compat` against the matrix.
4. **Keychain `CredentialStore`** and `credentials.*` KSP methods; route state machines;
   `task.resume`, `task.switchRoute` with safe-point switching.

**Acceptance**
- Spec acceptance tests pass for the three specs and [credentials](docs/specs/credentials.md).
- The `ts-small` fixture task ends `verified` through fake Gemini, fake OpenAI and a fake 32k
  compatible endpoint with the **same required checks** at the gate.
- Benchmark v0-alpha on B-oa and B-gn produces the first regression-matrix report.

---

## Phase 8: Sign in with ChatGPT (M). *Slice G: "a plan-backed task pauses honestly at the limit and resumes on the user's choice"*

**Build** ([chatgpt-sign-in](docs/specs/chatgpt-sign-in.md))
1. Host identity, distribution gate, OIDC discovery cache, loopback listener, attempt state,
   authorization URL, callback validation, token exchange, ID-token validation, granted-scope
   check, account registrations.
2. Single-flight refresh across processes, sign-out with revocation, account selection and
   switching.
3. The subscription request builder and catalog in `provider-openai`; quota and usage-unavailable
   handling; plan-usage reporting.
4. A fake authorization server and fake Responses server for offline tests.

**Acceptance**
- All offline acceptance tests in the spec pass (state, nonce, issuer, audience, denial,
  plan-permission denial, cancellation, expiry, account mismatch, refresh race, revocation,
  secret hygiene) and the OpenAI provider's subscription tests (golden request, resume from
  local replay, mid-stream quota).
- `test:live-auth` runs on macOS with an eligible account and records O1–O8 answers in
  `docs/evaluation/reports/`; until then the route ships disabled with a visible reason.

---

## Phase 9: Chrome research (L). *Slice H: "every profile researches a changed flag through Chrome and cites it"*

**Build** ([chrome-research](docs/specs/chrome-research.md))
1. `research-chrome` worker: discovery and validation, profile lock and orphan cleanup, launch
   over the pipe, filtering proxy, lifecycle, crash handling, handoff relaunch.
2. `google_web` SERP adapter with semantic parsing, typed outcomes and versioned fixtures (`en`,
   `de`, `ja`).
3. Extraction ladder (readability, ARIA fallback, PDF via pdf.js), section index, web
   artifacts, source records, cache.
4. `ResearchService`: policy and one-time permission, offline mode, QueryGuard, budgets and
   notices, tools `web_search`/`web_open`/`web_find`, citation validation, events and telemetry.

**Acceptance**
- Offline acceptance tests 1–14 pass in Linux CI (test Chromium + fixture server + real proxy).
- `test:smoke:chrome` passes on macOS for all three profiles; no TCP debugging port; loopback
  canary unreachable; clean shutdown.

---

## Phase 10: Shared learning (L). *Slice I: "the second comparable project is cheaper with identical checks; a harmful lesson is rejected"*

**Build** ([learning-service](docs/specs/learning-service.md))
1. Projects and finalization (`project.*`), evidence packet builder with redaction, outbox and
   idempotent delivery, global learning store and rebuild.
2. Deterministic extractors, the bounded retrospective (reflection templates per profile,
   `read_evidence`, `submit_retrospective`), permitted-route selection and deferral.
3. Policy linter, scope clamp, merge, skill lifecycle with contradictions, expiry and rollback.
4. Deterministic retrieval, snapshot pinning, seed rendering, followed-signal detection.
5. Markdown projection with imports, rejection and startup sweep; CLI controls (`kai learning …`).

**Acceptance**
- Spec acceptance tests 1–14 pass.
- A first learning evaluation on 2 training families runs end to end and reports overhead and
  observed savings (labelled observational).

---

## Phase 11: macOS app (L). *Slice J: "a user completes a task end to end in the app on any route"*

**Build** ([macos-client](docs/specs/macos-client.md))
1. Verify Electron prerequisites (bundled Node major, native module builds, entitlements).
2. Electron main, sandboxed renderer, preload, `MessagePortTransport`, runtime in a
   `utilityProcess`, runtime lock, lifecycle and crash restart.
3. Flows 1–8 (workspace, models and accounts with official SIWC branding, endpoint doctor, task
   and evidence, Chrome readiness and handoff, citations, learning, usage).
4. `arm64` packaging; signing and notarization when the owner's Apple Developer account is
   available.

**Acceptance**
- App acceptance tests 1–6 pass; `test:smoke:app` passes on macOS.

---

## Phase 12: Calibration and R1 hardening (M)

**Build**
- Corpus v0 (60 tasks, 20% frozen held-out) plus the new slices (`review_bait`,
  `small_context`, `research_needed`, `intermittent_bait`) and learning families (6 held-out,
  4 training); arms A0, A1, B, B-oa, B-gn, O, A1-oa; all ablations; calibration sweeps.
- Choose defaults per the benchmark. Disable by default any mechanism that fails
  [ADR-0014](docs/adr/0014-measurement-gated-mechanisms.md); the feature stays in the release.
- Crash and recovery suite for all stores (including the nightly block-level crash-simulation
  harness for the transaction journal), `kai gc`, retention, `kai doctor` checks (accounting
  health and identity violations, LSP health, profile sanity, G10 probe, route and endpoint
  health), and user docs.

## R1 release gates

All must hold; each report states the setup and confidence intervals, and says plainly when a
target was not met.

| Gate | Criterion |
|---|---|
| **Core** (founding v1 criteria) | On the held-out set vs A0: ≥ 25% lower median cost per resolved task, resolve rate not worse than −2 pp, lower invented-symbol escape and premature-completion rates. These are hypotheses; if not met, the report says so and the next steps follow the data |
| **Profiles** | Regression matrix passes for `openai` and `generic`; the over-review hypothesis result is reported with seeded-defect recall; zero over-limit requests on `small_context` |
| **Sign in with ChatGPT** | Offline suite passes; `test:live-auth` passed on macOS with an eligible account, or the route ships disabled with the reason shown; distribution gate verified |
| **Endpoints** | Contract matrix recorded with exact versions (unavailable targets listed as not run); `chat_only` behaviour verified |
| **Research** | Offline suite passes; installed-Chrome smoke suite passes on macOS for all three profiles; loopback canary unreachable |
| **Learning** | The learning evaluation meets the predeclared quality bar with net resource reduction including overhead; otherwise learning ships with retrieval **off** by default and the report says why |
| **App** | App acceptance tests and `test:smoke:app` pass; signed and notarized, or released as a developer build with that stated |
| **Safety** | Credential-free and no-secrets-in-store property tests pass; crash-point recovery tests pass for transactions and the learning outbox |

---

## Release acceptance traceability

Every scenario required for R1 maps to numbered acceptance tests in a spec (offline unless
marked *live*). "AT n" means acceptance test *n* in that spec.

| Required scenario | Covered by | Phase |
|---|---|---|
| Gemini-only configuration still works after migration | [configuration](docs/specs/configuration.md#acceptance-tests) AT1 | 0–1 |
| Gemini, ChatGPT and a local endpoint share editing and verification protections and scoped learning | [verification-engine](docs/specs/verification-engine.md#acceptance-tests) AT12; Phase 7 acceptance (same required checks on three routes); [harness-profiles](docs/specs/harness-profiles.md#acceptance-tests) AT2; [learning](docs/specs/learning-service.md#acceptance-tests) AT7 | 7, 10 |
| A later similar project reuses a procedure with equal acceptance coverage and net savings; a test-skipping skill is rejected | [learning](docs/specs/learning-service.md#acceptance-tests) AT3, AT4; [learning evaluation](docs/evaluation/benchmark-plan.md#learning-evaluation) | 10, 12 |
| Wrong or stale learning is scoped, invalidated or rolled back without editing past evidence | [learning](docs/specs/learning-service.md#acceptance-tests) AT5, AT6, AT7 | 10 |
| Duplicate finalization and crashes cannot duplicate jobs or corrupt projections | [learning](docs/specs/learning-service.md#acceptance-tests) AT1, AT2, AT14 | 10 |
| OAuth state/nonce/identity mismatch, denied plan consent, account switching, refresh races, revocation | [chatgpt-sign-in](docs/specs/chatgpt-sign-in.md#acceptance-tests) AT2–AT10; *live* `test:live-auth` | 8 |
| Mid-stream quota failure | [openai-responses-provider](docs/specs/openai-responses-provider.md#acceptance-tests) AT5; [credentials](docs/specs/credentials.md#acceptance-tests) AT4 | 8 |
| Subscription requests exclude unsupported fields and resume from local replay | [openai-responses-provider](docs/specs/openai-responses-provider.md#acceptance-tests) AT1–AT3; compile-time `SubscriptionAllowlistCheck` in the scaffold | 8 |
| A no-reasoning, small-context endpoint works with valid tools; malformed or incomplete calls never execute; missing usage stays unknown | [compatible-endpoints](docs/specs/compatible-endpoints.md#acceptance-tests-offline-fake-servers) AT1, AT2, AT4; [telemetry](docs/specs/telemetry.md#acceptance-tests) AT7; [context-compiler](docs/specs/context-compiler.md#acceptance-tests) AT11 | 7 |
| Endpoint changes invalidate probes; provider-native replay never crosses boundaries | [compatible-endpoints](docs/specs/compatible-endpoints.md#acceptance-tests-offline-fake-servers) AT5, AT6; [context-compiler](docs/specs/context-compiler.md#acceptance-tests) AT12 | 7 |
| ChatGPT stops optional nitpicking once requirements and required review are met; real integrity or security defects still block | [harness-profiles](docs/specs/harness-profiles.md#acceptance-tests) AT6–AT8; [critic](docs/specs/critic.md#acceptance-tests) AT2, AT5, AT6, AT8, AT9; `review_bait` slice | 6, 7, 12 |
| All three profiles research current information through installed Chrome | [chrome-research](docs/specs/chrome-research.md#acceptance-tests) *live* smoke suite (per profile); [research evaluation](docs/evaluation/benchmark-plan.md#research-evaluation) | 9, 12 |
| Missing Chrome limits research only; coding still works | [chrome-research](docs/specs/chrome-research.md#acceptance-tests) AT14 | 9 |
| SERP changes, CAPTCHA, stale dates, conflicting sources, broken pages, disconnected Chrome give honest, recoverable results | [chrome-research](docs/specs/chrome-research.md#acceptance-tests) AT1–AT6 | 9 |
| Web injection cannot change permissions or objectives, leak private data, or install a global lesson | [chrome-research](docs/specs/chrome-research.md#acceptance-tests) AT7–AT9; [learning](docs/specs/learning-service.md#acceptance-tests) AT11 | 9, 10 |
| Routine enabled search needs no per-query approval; offline mode prevents browsing | [chrome-research](docs/specs/chrome-research.md#acceptance-tests) AT10, AT11 | 9 |
| Citations resolve to retrieved excerpts; research and learning overhead appear in telemetry | [chrome-research](docs/specs/chrome-research.md#acceptance-tests) AT12, AT13; [learning](docs/specs/learning-service.md#acceptance-tests) AT13; [telemetry](docs/specs/telemetry.md#acceptance-tests) AT8 | 9, 10 |
| Audit corrections ([ADR-0015](docs/adr/0015-user-owned-task-contract.md), [ADR-0016](docs/adr/0016-robustness-amendments.md)): user-owned Task Contract, established-only flakiness, write-ahead journal, request preflight, complete manifests, instructions before mutation, mandatory `integrity_review` | [task-contract](docs/specs/task-contract.md#acceptance-tests) AT1–AT6; [verification-engine](docs/specs/verification-engine.md#acceptance-tests) AT4–AT7, AT10; [patch-engine](docs/specs/patch-engine.md#acceptance-tests) AT7–AT9; [context-compiler](docs/specs/context-compiler.md#acceptance-tests) AT6–AT10; [telemetry](docs/specs/telemetry.md#acceptance-tests) AT3, AT4; [critic](docs/specs/critic.md#acceptance-tests) AT5–AT7; [test-integrity-guard](docs/specs/test-integrity-guard.md#acceptance-tests) AT3, AT7, AT8 | 1, 3, 4, 6 |
| No secrets cross KSP or reach stores | [credentials](docs/specs/credentials.md#acceptance-tests) AT1; [protocol](docs/specs/protocol.md#acceptance-tests) AT6; [macos-client](docs/specs/macos-client.md#acceptance-tests) AT2 | 7, 8, 11 |

## Suggested vertical-slice order for the first weeks

1. Phase 0 plus Phase 1 items 1–3 (store, protocol, provider with contract tests). This
   de-risks the API early. Use the fake provider's small-context and no-effort snapshots from
   the start.
2. Phase 1 items 4–6. Demo slice A.
3. Phase 2 with only 4 tasks at first, so numbers exist before any optimization.
4. Phase 3 Artifact Store first. It is the cheapest big win and has no dependency on the index.

**Dependencies of the release phases:** Phase 7 needs Phase 3 (preflight, local replay) and
Phase 4 (gate). Phase 8 needs Phase 7 (Responses adapter, Keychain). Phase 9 needs Phase 3
(artifacts, ledger) and can run in parallel with Phases 7–8. Phase 10 needs Phases 2 and 4
(telemetry, verdicts) and benefits from Phase 9 (research provenance). Phase 11 needs the KSP
surface of Phases 7–10 but its shell and flows 1 and 4 can start after Phase 4.

## Postponed (deliberately)

| Item | Why postponed | Revisit when |
|---|---|---|
| Daemon + WebSocket transport, remote clients and auth | R1 clients are local (app via `MessagePort`, CLI) ([ADR-0024](docs/adr/0024-macos-desktop-shell.md)) | A remote or multi-user client is planned |
| ACP adapter | Nice-to-have integration | After R1, if editors and T3 Code integration are wanted |
| Web, mobile, Windows and Linux desktop UIs | R1 product surface is macOS | After R1 |
| OS sandbox (bwrap/Seatbelt) | Large. The policy plus process groups cover R1 | Before untrusted or multi-user use |
| Model-native hosted tools (Gemini `google_search`, OpenAI `web_search`) as product features | Research is provider-independent through Chrome ([ADR-0023](docs/adr/0023-chrome-research.md)) | Only as benchmark context |
| A fresh-context "research digest" call | Unmeasured extra LLM call | If the research evaluation shows main-context savings above its cost |
| Embeddings / semantic search (code or skills) | Unproven over structural plus lexical search | If retrieval misses show up in benchmark failure analysis |
| Text-tool fallback for edits on endpoints without tool calling | Reliability bar not met | If an endpoint shows ≥ 95% valid calls over ≥ 200 probes |
| MCP servers | Plugin sprawl risk | Allowlisted packs, after R1 |
| Go/Rust/Java LSP and grammars | R1 is TS/JS and Python | Corpus v1 |
| `multi_file_patch`, `symbol_edit` as defaults | Out-of-distribution, unproven | When ablations show wins |
| Explicit caching (`cachedContents`) | Interactions uses implicit caching. Unclear ROI | If G5 measurements show large cross-epoch prefix reuse |
| Multi-agent / subagents | Non-goal | Not planned |
| Session branching (tree) | Linear plus fork-by-copy is enough | When the UI supports it |
| Auto-update, `x86_64` builds | Not needed for the first release | After R1 |
