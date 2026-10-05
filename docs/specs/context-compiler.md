# Spec: Context Compiler

- Package: `packages/core` (`context/`)
- Decisions: [ADR-0005](../adr/0005-context-compiler-and-epochs.md), amended by [ADR-0016](../adr/0016-robustness-amendments.md) and [ADR-0018](../adr/0018-providers-routes-profiles-capabilities.md) (profiles, optional continuation, local replay, route switches); [ADR-0015](../adr/0015-user-owned-task-contract.md)
- Collaborators: [Task Contract](task-contract.md), [Read Ledger](read-ledger.md), [Artifact Store](artifact-store.md), [Repo Index](repo-index.md), [Patch Engine](patch-engine.md) (instruction gate), [Gemini Provider](gemini-provider.md), [OpenAI Responses provider](openai-responses-provider.md), [compatible endpoints](compatible-endpoints.md), [harness profiles](harness-profiles.md), [learning](learning-service.md), [Chrome research](chrome-research.md), [Reasoning Governor](reasoning-governor.md), [Telemetry](telemetry.md)

## Responsibility

Decide **exactly what the model sees**, under a strict token budget, at three points:

1. **Seed compilation**: the first request of every epoch, built from durable state.
2. **Ingress admission**: everything appended to the epoch afterwards (tool results, notices,
   user messages).
3. **Request preflight**: before **every** request, project the complete size of the request
   that is about to be sent, and reshape or roll the epoch over *before* a limit is crossed.

It also owns **epoch boundary decisions**, the **instruction map** (which project instruction
files apply where), and **complete request accounting**: a manifest that attributes every token
of every request to a category, including model-generated history.

It also owns **provider and route switches** at safe points
([below](#provider-and-route-switches)).

Model-facing wording (system prompt, tool rendering, notice role) comes from the active
[harness profile](harness-profiles.md); budgets come from the profile's context sizing over the
route's capability snapshot. The compiler itself is profile-neutral and branches only on
capabilities.

**Not responsible for:** executing tools (the Tool Registry), deciding effort (the Governor),
talking to the API (the provider adapter), or enforcing instructions at write time (the Patch
Engine's instruction gate, which uses this component's instruction map).

## Interfaces

```ts
interface ContextCompiler {
  /** Build the seed for a new epoch. Pure function of durable state + budget. */
  compileSeed(input: SeedInput): Promise<CompiledSeed>;
  /** Shape and admit new content into the current epoch (not yet sent). */
  admit(items: IngressItem[], epoch: EpochState): Promise<AdmittedItems>;
  /** Before EVERY request: project the full request size; reshape or roll over if needed. */
  preflight(input: PreflightInput): PreflightResult;
  /** After a response: decide whether the next request should start a new epoch. */
  epochDecision(state: EpochState, signals: EpochSignals): EpochDecision;
  /** Instruction files that apply to a path (root → leaf), from the instruction map. */
  applicableInstructions(path: string): InstructionFileRef[];
}

interface SeedInput {
  taskId: TaskId;
  epochId: EpochId;
  reason: EpochReason;
  budget: ContextBudget;             // profile.contextSizing(snapshot, config)
  snapshot: CapabilitySnapshot;      // route + model + account effective support (ADR-0018)
  profile: HarnessProfileRef;        // id@version; renders prompt, tools, notice role
  continuation: "provider_chain" | "local_replay";
  learning?: { snapshotHash: ContentHash; cards: LearnedCard[] };   // pinned per task
  toolLoadout: ToolDeclaration[];    // core + active packs, rendered by the profile
  carriedResults?: AdmittedItems;    // pending results when rolling over mid-batch (→ <last_results>)
}

interface CompiledSeed {
  systemInstruction: string;         // stable within epoch
  tools: ToolDeclaration[];          // stable within epoch
  input: CanonicalStep[];            // instructions, brief, map, relevant code, last results, directive
  manifest: ContextManifest;
  briefBlob: ContentHash;
}

type IngressItem =
  | { kind: "tool_result"; toolCallId: ToolCallId; name: string; outcome: ToolOutcome<unknown> }
  | { kind: "notice"; noticeType: NoticeType; key: string; text: string }
  | { kind: "user"; text: string };

interface AdmittedItems { steps: CanonicalStep[]; manifestDelta: ContextManifest }

interface InstructionFileRef { path: string; scopeDir: string; hash: ContentHash; estTokens: number }

type EpochDecision =
  | { action: "continue" }
  | { action: "new_epoch"; reason: EpochReason };
```

Manifest, preflight and accounting types are defined in
[§Request preflight](#request-preflight) and [§Complete request accounting](#complete-request-accounting).

## Seed layout (fixed order, for implicit-cache stability)

```
system_instruction:   [profile system prompt]                    ← stable across epochs and sessions
tools:                [core + active packs, rendered by profile] ← stable within epoch
input[0] user_input:  <project_instructions> root + applicable nested instruction files </project_instructions>
input[1] user_input:  <task_contract version="N"> user-owned requirements, verbatim </task_contract>
input[2] user_input:  <learned_procedures advisory="true"> ≤ 3 cards </learned_procedures>   (optional; pinned per task)
input[3] user_input:  <epoch_brief> working state (model-authored), files, verification, failures </epoch_brief>
input[4] user_input:  <repo_map budget="…"> … </repo_map>
input[5] user_input:  <relevant_code> symbol cards + excerpts </relevant_code>
input[6] user_input:  <last_results> shaped results not yet delivered </last_results>   (optional)
input[7] user_input:  <directive> what to do now </directive>
```

The system prompt and tools are byte-identical across epochs unless the loadout changes, so even
a new chain may hit the implicit cache for that prefix (to be measured, G5). The learned
procedures section is identical for every epoch of a task because the learning snapshot is
pinned at task start ([learning](learning-service.md#retrieval)); it sits after the contract so a
learning change never invalidates the cached system and tool prefix, and it is labelled as
advice below the contract and repository instructions. "System instruction" maps to Gemini
`system_instruction`, Responses `instructions`, or a Chat Completions `system`/`developer`
message ([compatible endpoints](compatible-endpoints.md)).

## Budget model

`ContextBudget` defaults for `gemini-3.8-flash`, all configurable. For other models, the active
profile derives the budget from the capability snapshot with the
[context sizing formula](harness-profiles.md#context-sizing); the Gemini row of that formula
reproduces this table, and small windows scale every number down (including
`ingressBatchMax`). A window whose usable size is below 10k tokens is `chat_only`.

| Parameter | Default | Notes |
|---|---|---|
| `seedTarget` | 24k tokens | Total seed size the compiler aims for |
| `reserveOutput` | 8k | Kept free for thinking and output; subtracted first |
| `epochSoftLimit` | 64k (projected input) | Roll over at the next safe point |
| `epochHardLimit` | 160k (projected input) | **No request is sent above this** (preflight) |
| `emergencyLimit` | model input limit − `reserveOutput` | Never planned. An alarm, and a hard assertion in preflight |
| `ingressBatchMax` | 12k | Total shaped ingress allowed in one request, however many tool calls produced it |
| `preflightMarginMin` | 10% of pending ingress | Lower bound on the estimation safety margin |
| `contractMaxTokens` | 3k | Contract rendering cap; prompt and acceptance entries are never cut |
| `instructionsMax` | 6k | Seed budget for project instruction files (see the instruction map) |
| `repoMap` | 2k–6k; cold start 8k (see allocation) | Aider's 1k default is too small for cold starts |
| `relevantCode` | remainder | |
| `inlineToolResultMax` | 2k tokens | Per item; above this, the Result Shaper spools |
| `noticeMax` | 300 tokens per notice | Instruction deliveries are exempt (never truncated) |

**Allocation algorithm for the seed:**
1. Fixed costs: system + tools (measured, then cached by hash).
2. **Project instructions** (≤ `instructionsMax`; see below). They are never truncated mid-file.
3. **Task contract** (pinned, ≤ `contractMaxTokens`): entries verbatim, in order.
4. **Pinned brief sections** (never dropped): current plan, open failures (exact), next action.
   If the pinned sections alone exceed 40% of `seedTarget`, compress lists (keep newest and
   highest-severity) and emit telemetry.
5. Optional brief sections in priority order: decisions, notes and interpretations, files
   modified, files read (as symbol cards), attempted approaches. Each is truncated from oldest
   to newest.
6. Repo map: `min(repoMapMax = 6k, max(repoMapMin = 2k, 0.25 × remaining))`. On a **cold
   start** (the ledger is empty for this task, so the model knows no files yet), use
   `min(repoMapColdStart = 8k, 0.5 × remaining)` instead.
7. Last results (when rolling over mid-batch): shaped to fit the remainder, with anything cut
   spooled to an artifact and referenced.
8. Relevant code: greedy by **value density** (relevance score ÷ estimated tokens) until the
   remaining budget is used up. Every item is either a symbol card (cheap) or an excerpt
   (definition body or a ±N-line window).
9. Directive: always included (≤ 300 tokens).

Learned procedure cards (≤ `learning.retrieval.maxTokens`, default 600) are allocated after the
contract and before the brief's optional sections; they are dropped whole, never truncated, when
the budget is short.

## Project instructions: instruction map and pre-mutation gate

Nested instruction files must reach Gemini **before** it changes anything in their scope, not
after a tool happens to touch the directory.

**Instruction map.** At workspace open, Kai scans for instruction files named in
`instructions.fileNames` (default `AGENTS.md`, `KAI.md`, `GEMINI.md`). The scan uses
`git ls-files` plus untracked, non-ignored files, so it is cheap and needs no full index. Each
file's scope is its directory subtree. The map records `{path, scopeDir, hash, estTokens}`
(`InstructionsIndexed`) and is refreshed by the watcher (`InstructionFilesChanged`).
`applicableInstructions(path)` returns every file whose `scopeDir` is an ancestor-or-self of
`path`, ordered root → leaf. Deeper files are more specific (the usual `AGENTS.md` convention).

**Seed inclusion.** The seed's `<project_instructions>` section contains the root files plus
every nested file applicable to the paths the task is known to involve: paths named in contract
entries, `update_plan.scope`, files modified so far, open-failure locations and relevant-code
paths. When these exceed `instructionsMax`, the most specific files for scope and modified paths
are included first, and the rest are listed by path and size. Instruction text is never
truncated. Each included file is recorded as a ledger delivery (kind `instructions`, with its
hash).

**Read-time delivery (optimization).** When a read or search result touches a subtree whose
applicable instruction file has not been delivered in this epoch, the file is appended as a
`jit_instructions` notice. This is exempt from `noticeMax`, and it usually avoids a gate
rejection later.

**Pre-mutation gate (guarantee).** The Patch Engine refuses any transaction, and the shell runner
any mutating command, that would touch a path whose applicable instruction files are not all
delivered in the current epoch at their current hash. The refusal **delivers the missing
instruction text** and asks the model to reconsider and resend
([patch-engine](patch-engine.md#instruction-gate)). Nothing is written until the model has seen
the rules for that path.

**Authority.** The instruction files as committed at task start are part of the user-owned
[Task Contract](task-contract.md) and can be cited. Edits the model makes to instruction files
during the task do not change the contract.

## Relevant code selection

Candidate sources, each giving a raw score:

| Signal | Weight (initial) |
|---|---|
| Symbols and paths named in **contract entries** (prompt, acceptance, steering) | 1.0 |
| Locations in **open failures** (diagnostics, stack frames, failing test files) | 1.0 |
| Files and symbols in the declared `scope` (`update_plan`) | 0.8 |
| Symbols edited in this task (current definitions) | 0.8 |
| Callers and callees of the above (index refs, depth 1) | 0.5 |
| PageRank score from the repo map's personalized ranking | 0.3 |
| Recently read in the previous epoch (ledger), still unchanged | 0.3 |

The combined score is the sum. **Excerpts** are preferred for failure locations and edited
symbols. **Symbol cards** are used for everything else. An item already included in full in the
brief is never duplicated. All weights are config values, tuned by benchmark.

## Epoch brief schema

The brief is serialized compactly (markdown-like sections with stable headings). It is built from
projections. **No LLM call** unless noted. User-owned and model-authored content are rendered
under **separate, labelled headings**, and model-authored content never appears inside
`<task_contract>`.

```ts
interface EpochBrief {
  contract: { version: number; entries: ContractEntry[] };          // USER-OWNED, verbatim (rendered as <task_contract>)
  workingState: {                                                    // MODEL-AUTHORED (rendered as <working_state author="model">)
    plan: PlanItem[];
    decisions: { decision: string; rationale: string }[];
    notes: string[];
    interpretations: string[];
    proposedCriteria: string[];                                      // non-authoritative, additive only
  };
  filesModified: { path: string; diffStat: string; intents: string[] }[]; // transactions (+ model-authored instruction strings, labelled)
  filesRead: { path: string; hash: ContentHash; symbols: SymbolCard[]; stale: boolean }[]; // ledger
  verification: { lastVerdict?: TaskState; checks: { id: string; status: string }[] };
  openFailures: { fp: string; exact: string; location?: string; attempts: number }[];
  attemptedApproaches: { attemptNo: number; summary: string; outcome: string }[]; // attempts projection
  recoveryNotes?: string[];                                          // e.g. transactions rolled back by crash recovery
  nextAction: string;                                                // plan's first non-done step, or the replan directive
  decisionDigest?: string;                                           // LLM-generated (model-authored) ONLY if decisions/notes are empty and the epoch had ≥ N edits
}
```

- `attemptedApproaches[].summary` is built from the transaction `instruction` strings and the
  touched symbols of each attempt (deterministic).
- `decisionDigest` runs at most once per epoch boundary, at `thinking_level: low`, with ≤ 600
  output tokens. Its input is the epoch's model text turns and transaction instructions only, and
  it never sees raw tool outputs. It is model-authored and rendered as such. Its cost is recorded
  as a context-management cost.

## Ingress admission

For each `IngressItem`, in order:
1. **Tool results:** already shaped by the tool (ledger stubs, Result Shaper summaries). The
   compiler enforces `inlineToolResultMax` per item. If a tool returns too much (a bug or an
   unforeseen case), the compiler spools it and logs a `shaper_bypass` counter.
2. **Notices:** de-duplicated by `(noticeType, key)` within the epoch. A repeated identical
   notice is not re-sent. Each is truncated to `noticeMax`, except instruction deliveries.
3. **Read-time instruction delivery** (see the instruction map).
4. **User messages** (steering) are admitted verbatim. They have already been appended to the Task
   Contract by the protocol handler.
5. **Web content** from research tools arrives already shaped and wrapped in
   `<web_content trust="untrusted">` ([Chrome research](chrome-research.md#trust-and-injection))
   and is counted as `tail_web`.
6. Estimate tokens per category and emit a **pending** manifest delta. Nothing is sent until
   preflight approves.

## Request preflight

The previous response's reported size is not enough to decide whether the *next* request fits.
Many individually capped tool results, plus the model's own previous output, can push the next
request over the limit. Preflight projects the **complete** next request before it is sent.

```ts
interface PreflightInput {
  epoch: EpochState;
  pending: AdmittedItems;                 // everything that would be sent next
  lastResponse?: { outputTokens: number; thoughtTokens: number };   // REPORTED, for carried history
  budget: ContextBudget;
  stateMode: "chained" | "stateless";
}
interface PreflightResult {
  projectedInputTokens: number;
  breakdown: { priorInput: number; carriedOutput: number; carriedThoughts: number; pendingIngress: number; framing: number; margin: number };
  action: "send" | "send_then_rollover" | "reshape" | "rollover_now";
  reshaped?: AdmittedItems;               // when action = "reshape"
}
```

**Projection.**
- **Chained:** `projected = priorInput + carriedOutput + carriedThoughts + est(pending) +
  framing + margin`, where:
  - `priorInput` is the last request's **reported** `total_input_tokens`;
  - `carriedOutput` is the last response's **reported** output tokens (model text and
    function-call arguments become history);
  - `carriedThoughts` is the last response's reported thought tokens, only if the provider
    capability `chainedInputIncludesPriorThoughts` is true (open question G10);
  - `framing` is the calibrated per-step overhead;
  - `margin = max(preflightMarginMin × est(pending), p95 absolute ingress-estimate error over the
    last 50 measured turns)`.
- **Stateless (local replay):** `projected` = the composition of the full request to be sent
  (history categories sized from reported numbers, ingress estimated) plus margin.
- **Routes that do not report usage** (some compatible endpoints): reported terms are
  unavailable, so every category, including model-generated history, is **estimated** with the
  conservative unknown-tokenizer ratio (`chars / 2.5`), the margin uses the larger safety margin
  of [context sizing](harness-profiles.md#context-sizing), and accounting is shown as
  `uncalibrated`. The projection is still made before every request; it is just more
  conservative.
- A provider error for context length means the projection was wrong: scale the route's ratios
  by 1.15 (OpenAI) or 1.2 (compatible), start a new epoch with the pending results carried, and
  retry once ([OpenAI](openai-responses-provider.md#errors-and-retries),
  [compatible](compatible-endpoints.md#request-and-stream-handling)).

**Decision, in order:**
1. **Batch cap.** If `est(pending) > ingressBatchMax`, **reshape**. Re-shape the largest tool
   results first with tighter caps (inline → summary + artifact; summaries down to a floor of 200
   tokens each, with the rest spooled), then drop optional notices (budget and progress notices).
   **Never** drop or truncate: instruction deliveries, `NOT APPLIED` reasons, verification
   failures, stale-file notices, user messages. Recompute.
2. If `projected ≤ epochSoftLimit` → **send**.
3. If `epochSoftLimit < projected ≤ epochHardLimit` → **send_then_rollover**: send now, and start
   a new epoch at the next safe point.
4. If `projected > epochHardLimit` → try **reshape** (pending items only). If it still exceeds the
   hard limit → **rollover_now**: do not send into this chain. Start a new epoch, and pass the
   pending items as `carriedResults` into the new seed's `<last_results>` section, which is
   compiled under `seedTarget` and therefore fits by construction.
5. **Hard assertion:** a request with `projected > emergencyLimit` is never sent, whatever the
   path (this guards against estimator failure). It forces `rollover_now` and raises an alarm.

Preflight runs before **every** model request: worker turns, seeds, critic calls, the decision
digest and replans. Each decision is recorded as a `PreflightDecision` event. In stateless mode,
batched elision (below) is applied before step 4's reshape.

## Complete request accounting

Every token of every request must be attributed. Otherwise calibration attributes the growth of
model-generated history to source-code or tool-result estimates, and the savings dashboard
reports fiction.

**Categories** (`ContextCategory`). The release extension adds `learned_procedures` (seed) and
`tail_web` (ingress). Provider-native replay items are counted by kind: reasoning items
(Gemini thought steps, OpenAI reasoning items with encrypted content) under `history_thoughts`,
replayed assistant messages under `history_model_text`, replayed calls under
`history_function_calls`.

| Group | Categories | Size source |
|---|---|---|
| Prefix | `system`, `tools` | Estimated, calibrated on seed turns |
| Seed | `project_instructions`, `task_contract`, `learned_procedures`, `brief`, `repo_map`, `relevant_code`, `last_results`, `directive` | Estimated, calibrated on seed turns |
| Ingress | `tail_read`, `tail_search`, `tail_edit_result`, `tail_shell`, `tail_test`, `tail_artifact`, `tail_plan`, `tail_web`, `jit_instructions`, `notices`, `user` | Estimated, calibrated on **measured ingress** |
| **Model-generated history** | `history_model_text`, `history_function_calls` (names and arguments, e.g. the `new_string` of a `replace`), `history_thoughts` (thought steps and signatures, when carried) | **Reported** totals (previous responses' output and thought tokens). The split between text and function calls is estimated by character share and labelled as such |
| Overhead | `framing` (step and role wrappers) | Estimated per step, calibrated |

**Manifest.**

```ts
interface CategoryCount { tokens: number; source: "reported" | "estimated" }
interface ContextManifest {
  delta: Partial<Record<ContextCategory, CategoryCount>>;        // added since the previous request
  composition: Partial<Record<ContextCategory, CategoryCount>>;  // everything this request contains (cumulative in the epoch)
  reportedInputTokens?: number;                                   // filled in after the response
  residual?: number;                                              // reported − Σ composition
}
```

**Accounting identity (chained mode).** For request *t* > 0 in an epoch:

```
reportedInput(t) = reportedInput(t−1) + reportedOutput(t−1) [+ reportedThoughts(t−1) if carried] + ingress(t) + framing(t)
measuredIngress(t) = reportedInput(t) − reportedInput(t−1) − reportedOutput(t−1) [− reportedThoughts(t−1)]
```

- The **estimator is calibrated only** on `(est(ingress(t)) + framing, measuredIngress(t))`
  pairs, and on seed turns (`reportedInput(seed)` vs. the estimated seed categories).
  Model-generated history is **never** sized by character ratios when a reported number exists,
  so it cannot distort calibration.
- A **negative or implausible `measuredIngress`** (e.g. output was not carried as assumed) marks
  the identity as **violated** for that provider and model. It is reported in `kai doctor`, and
  the capability flags `chainedInputIncludesPriorOutput` and `chainedInputIncludesPriorThoughts`
  are re-probed (open question G10).
- **Stateless mode (local replay):** the request is fully client-built, so composition is
  computed directly. History categories use the reported numbers of the responses being
  replayed. The residual is `reported − Σ composition`.
- **Unknown usage:** when a route reports no input usage, `reportedInputTokens` and `residual` are
  `null` (never `0`), the identity cannot be checked, and savings stay `uncalibrated` for that
  route ([telemetry](telemetry.md)).

**Trusting the savings dashboard.** Estimated savings (ledger, spooling, tool exposure) are shown
as **calibrated** only when accounting is healthy: over the trailing 20 requests, mean
`|residual| / reportedInput ≤ 5%`, and no identity violations. Otherwise they are labelled
**uncalibrated** in the CLI and `kai stats`, and they are **excluded** from benchmark headline
numbers ([telemetry](telemetry.md#accuracy-guards)).

## Epoch decisions

`epochDecision` is evaluated **after each model response's tool calls have executed and their
results have been shaped, and before the next request**. This is the only *safe point*: no tool
is mid-execution and no transaction is half-applied. When a new epoch starts there, the shaped
results of the last response are **not** sent to the abandoned chain. They are passed as
`carriedResults` into the new seed's `<last_results>` section. A new chain has no pending
`function_call` steps for `function_result` steps to pair with, so they are sent as text, not as
`function_result` steps.

Rules, in order (preflight may additionally force `rollover_now` at the same safe point):
0. A provider, route, account, endpoint-configuration or model switch is pending →
   `new_epoch(model_switch)` ([switches](#provider-and-route-switches)).
1. A replan was requested → `new_epoch(replan)`.
2. A previous preflight returned `send_then_rollover`, or the reported input exceeded
   `epochHardLimit` (estimator failure) → `new_epoch(soft_limit | hard_limit)`.
3. A phase transition was recorded (`update_plan.phase` changed explore/plan → implement, or
   verification failed after `complete_task` and the Repair Controller asks for a fresh
   approach) → `new_epoch(phase)`.
4. Reported input > `epochSoftLimit` **and** the last turn was not mid-transaction →
   `new_epoch(soft_limit)`.
5. Resume after idle > 30 min, external changes to files read in this epoch, or crash recovery
   ran → `new_epoch(resume)`.
6. Otherwise `continue`.

Before a planned (soft or phase) boundary, if the model has not called `update_plan` in the last
K = 8 turns, the compiler adds a one-line notice: *"Context will be refreshed soon; record
decisions and notes with update_plan."* The boundary is applied at the next safe point.

## Token estimation

```ts
interface TokenEstimator {
  estimate(text: string, category: ContextCategory): number;
  /** Calibrate ONLY on measured ingress or seed turns, never on model-generated history. */
  calibrate(sample: { kind: "seed" | "ingress"; estimated: Partial<Record<ContextCategory, number>>; measured: number }): void;
}
```
- Base estimate: `ceil(chars / ratio[contentType])`, where content types are `code`, `prose`,
  `json` and `numbered_code`, with initial ratios `3.2`, `4.0`, `3.0` and `2.9`. Categories map
  to content types, and ratios are learned per content type, which is more stable than per
  category. Ratios are kept **per route and model**, because tokenizers differ; a route without
  reported usage keeps the conservative ratio (`chars / 2.5`).
- **Calibration:** exponential moving average updates of the ratios from the samples above,
  weighted by each content type's share of the sample. Track the relative error of
  `measuredIngress` predictions as an accuracy metric. The target is under 5% after 20 turns.
- Optional: plug in the `gemma3` SentencePiece tokenizer from `@google/genai` (experimental)
  once it is validated against reported usage for `gemini-3.8-flash`.

## Continuation modes

| Mode | Used by | Request contains |
|---|---|---|
| `provider_chain` | Gemini chained (default), OpenAI API key with `store: true` | Only the new steps plus the provider continuation handle |
| `local_replay` | Gemini stateless, **ChatGPT subscription (always)**, OpenAI API key with `store: false` (default), compatible endpoints | The seed plus the full epoch tail every request |

The provider continuation is **optional** ([ADR-0018](../adr/0018-providers-routes-profiles-capabilities.md)):
a `completed` event may carry none, and the compiler then stays in `local_replay`. "Chained" in
the preflight and accounting sections means `provider_chain`; "stateless" means
`local_replay`.

## Stateless mode differences (local replay)

- Each request = seed (byte-identical) + full tail of the epoch.
- **Batched elision:** when the estimated prunable tail (tool results older than the newest 3
  turns, excluding plan, edit results and instruction deliveries) exceeds 20k tokens, replace them
  with one-line stubs (`[result elided; art_x / ledger turn 9]`) in one batch, and emit
  `ContextElided`. Never elide a function call without its result, or the reverse (OpenHands'
  View invariants). Elided instruction deliveries would re-arm the instruction gate, so they are
  never elided.
- Thought steps with signatures from previous turns are always included unchanged (an API
  requirement), and are counted under `history_thoughts`.
- The same holds for every **provider-native replay item** (OpenAI reasoning items with
  `encrypted_content` and message `phase` fields, compatible `reasoning_content` when the
  endpoint requires it). Items are tagged `(provider, routeId, accountScope, model)` and sent only
  when every tag matches the request; otherwise they are dropped (and the epoch restarts if the
  provider requires them). The elision batch threshold scales for small windows
  (`clamp(0.15·U, 2k, 20k)`, [context sizing](harness-profiles.md#context-sizing)).

## Provider and route switches

A change of provider, route, ChatGPT account, compatible-endpoint configuration or model happens
only at a **safe point** (no tool executing, no transaction half-applied):

1. Record `ProviderSwitched {taskId, fromRoute, toRoute, fromModel, toModel, reason}`.
2. Keep all authoritative state: the Task Contract, plan, decisions, ledger, transactions,
   verification evidence, repair fingerprints, research sources and the learning snapshot.
3. Drop every provider-native replay item and continuation handle from the old route; **never**
   transplant opaque reasoning or continuation handles across providers, routes or accounts.
4. Start a new epoch (`model_switch`) with the new profile's prompt, tool rendering and
   budgets; pending results are carried into `<last_results>`.
5. A switch from a `local_only` route to a `cloud` route requires the user's explicit
   confirmation naming the privacy change; Kai never does it on its own, including on quota
   exhaustion ([credentials](credentials.md#rules)).

## Events emitted

`EpochStarted`, `EpochBriefBuilt`, `ToolLoadoutChanged`, `PromptVersioned`, `ContextElided`,
`InstructionsIndexed`, `InstructionFilesChanged`, `PreflightDecision`,
`LearnedProceduresSelected`, `ProviderSwitched`, and the complete `inputManifest` part of
`ModelRequest`.

## Failure handling

- Missing index or LSP: the repo map degrades to a directory tree plus file sizes (budget 1k),
  and relevant code falls back to grep hits.
- The brief exceeds the budget even after compression: drop optional sections, keep pinned ones,
  and emit `brief_overflow` telemetry. If the contract plus pinned sections alone exceed the seed
  target, raise the seed target to `pinned + 4k` for this epoch and alarm.
- The estimator is badly off (relative ingress error > 20%): fall back to conservative ratios
  (`chars / 2.5`) and double the preflight margin until calibrated.
- The instruction map scan fails: fail closed. Treat every directory as having unknown
  instructions, deliver all instruction files found by a slower full scan before the first
  mutation, and alarm.

## Acceptance tests

1. **Determinism:** the same durable state gives a byte-identical seed (excluding timestamps).
2. **Stability:** within an epoch, the system and tools bytes are unchanged across turns.
3. **Budget:** over 50 fixture states, seed size ≤ `seedTarget` + 5%. The contract and pinned
   sections are always present.
4. **Epoch rules:** a simulated usage sequence triggers boundaries at the right points.
5. **Brief fidelity:** every modified file, open failure and recorded decision in projections
   appears in the brief (property test). Contract entries appear verbatim, and model-authored
   text never appears inside `<task_contract>`.
6. **Preflight, batch:** 12 parallel tool calls each returning a maximal shaped result (2k)
   → `est(pending) = 24k > ingressBatchMax` → reshaped to ≤ 12k. No `NOT APPLIED` reason or
   instruction delivery is cut.
7. **Preflight, hard limit:** `priorInput = 150k`, `carriedOutput = 6k`, `pending = 9k` →
   projected > 160k → `rollover_now`. The new seed contains the pending results in
   `<last_results>`, and the request sent is ≤ `seedTarget`. No request in the test exceeds
   `epochHardLimit`.
8. **Accounting identity:** with a fake provider whose reported input includes prior output, a
   20-turn session yields residual < 5%. A large `replace` (20k-character `new_string`) shows up
   under `history_function_calls`, not under `tail_*`. The estimator ratios are unaffected by
   that turn.
9. **Identity violation:** a fake provider that does *not* carry prior output → negative
   `measuredIngress` → identity violation flagged, and savings shown as `uncalibrated`.
10. **Instruction map:** a nested `services/payments/AGENTS.md` is in the seed when the contract
    mentions `services/payments`. When it is not mentioned, the first edit under that directory
    is refused with the file's text, and the resend succeeds (with the Patch Engine).
11. **Small window:** a scripted turn returning 6 large tool results against a 32k fake endpoint
    without reported usage never produces a request above its limit; accounting is labelled
    `uncalibrated`, and `reportedInputTokens` is `null`, never `0`.
12. **Switch:** a task switched from `openai.chatgpt_subscription` to `gemini.api_key` mid-task
    sends no OpenAI reasoning item to Gemini; the new seed contains the contract, the brief and
    all open failures.
13. **Learned procedures:** a skill version created while a task runs does not appear in that
    task's later seeds; the learned section is byte-identical across its epochs.
