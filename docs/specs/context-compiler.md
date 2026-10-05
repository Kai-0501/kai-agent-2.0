# Spec: Context Compiler

- Package: `packages/core` (`context/`)
- Decision: [ADR-0005](../adr/0005-context-compiler-and-epochs.md)
- Amended by: [ADR-0016](../adr/0016-providers-routes-profiles-capabilities.md) (profiles, optional continuation, local replay) and [ADR-0023](../adr/0023-audit-corrections.md) (request preflight, complete manifests, instructions before mutation)
- Collaborators: [Read Ledger](read-ledger.md), [Artifact Store](artifact-store.md), [Repo Index](repo-index.md), [Gemini Provider](gemini-provider.md), [OpenAI Responses provider](openai-responses-provider.md), [compatible endpoints](compatible-endpoints.md), [harness profiles](harness-profiles.md), [learning](learning-service.md), [Chrome research](chrome-research.md), [Reasoning Governor](reasoning-governor.md), [Telemetry](telemetry.md)

## Responsibility

Decide **exactly what the model sees**, under a strict token budget, at two points:

1. **Seed compilation**: the first request of every epoch, built from durable state.
2. **Ingress admission**: everything appended to the epoch afterwards (tool results, notices).
3. **Request preflight**: before *every* request, the complete pending request must fit the
   route's effective limit ([below](#request-preflight)).

It also owns **epoch boundary decisions**, **provider and route switches**, and the **context
manifest**, a per-category token accounting of every request, including model-produced
content that is replayed or chained.

Model-facing wording (system prompt, tool rendering, notice role) comes from the active
[harness profile](harness-profiles.md); budgets come from the profile's context sizing over the
capability snapshot. The compiler itself is profile-neutral.

**Not responsible for:** executing tools (the Tool Registry), deciding thinking levels (the
Governor), or talking to the API (the Provider).

## Interfaces

```ts
interface ContextCompiler {
  /** Build the seed for a new epoch. Pure function of durable state + budget. */
  compileSeed(input: SeedInput): Promise<CompiledSeed>;
  /** Shape and admit new content into the current epoch. */
  admit(items: IngressItem[], epoch: EpochState): Promise<AdmittedItems>;
  /** Decide whether the next request should start a new epoch. */
  epochDecision(state: EpochState, signals: EpochSignals): EpochDecision;
}

interface SeedInput {
  taskId: TaskId;
  epochId: EpochId;
  reason: EpochReason;
  budget: ContextBudget;             // profile.contextSizing(snapshot, config)
  snapshot: CapabilitySnapshot;      // route + model + account effective support
  profile: HarnessProfileRef;        // id@version; renders prompt, tools, notices
  continuation: "provider_chain" | "local_replay";
  learning?: { snapshotHash: ContentHash; cards: LearnedCard[] };   // pinned per task
  toolLoadout: ToolDeclaration[];    // core + active packs, rendered by the profile
}

interface CompiledSeed {
  systemInstruction: string;         // stable within epoch
  tools: ToolDeclaration[];          // stable within epoch
  input: CanonicalStep[];            // project instructions, brief, map, relevant code, directive
  manifest: ContextManifest;
  briefBlob: ContentHash;
}

type IngressItem =
  | { kind: "tool_result"; toolCallId: ToolCallId; name: string; outcome: ToolOutcome<unknown> }
  | { kind: "notice"; noticeType: NoticeType; text: string }
  | { kind: "user"; text: string };

interface AdmittedItems { steps: CanonicalStep[]; manifestDelta: ContextManifest }

interface ContextManifest {
  // ESTIMATED tokens per category for this request's *new* content (seed: everything)
  categories: Partial<Record<ContextCategory, number>>;
  // ESTIMATED size of the whole request as sent (cumulative epoch content + new content)
  estimatedRequestTokens: number;
  reportedInputTokens?: number | null; // REPORTED after the response; null = route did not report
  unattributed?: number | null;        // reported − estimated; null when reported is unknown
}

type ContextCategory =
  | "system" | "tools" | "project_instructions" | "learned_procedures" | "brief" | "repo_map"
  | "relevant_code" | "last_results" | "directive"
  | "tail_read" | "tail_search" | "tail_edit_result" | "tail_shell" | "tail_test"
  | "tail_artifact" | "tail_plan" | "tail_web" | "notices" | "user"
  // model-produced content that occupies the context (chained or replayed):
  | "assistant_text" | "function_call_args" | "replay_native";

type EpochDecision =
  | { action: "continue" }
  | { action: "new_epoch"; reason: EpochReason };
```

## Seed layout (fixed order, for implicit-cache stability)

```
system_instruction:   [profile system prompt]                    ← stable across epochs and sessions
tools:                [core + active packs, rendered by profile] ← stable within epoch
input[0] user_input:  <project_instructions> AGENTS.md / KAI.md (root only; nested files are JIT)
input[1] user_input:  <learned_procedures advisory="true"> ≤ 3 cards </learned_procedures>   (optional; pinned per task)
input[2] user_input:  <epoch_brief> … </epoch_brief>
input[3] user_input:  <repo_map budget="…"> … </repo_map>
input[4] user_input:  <relevant_code> symbol cards + excerpts </relevant_code>
input[5] user_input:  <last_results> shaped results of the previous epoch's final tool calls </last_results>   (optional)
input[6] user_input:  <directive> what to do now </directive>
```

The system prompt and tools are byte-identical across epochs unless the loadout changes, so even
a new chain may hit the implicit cache for that prefix (to be measured, G5). The learned
procedures section is identical for every epoch of a task because the learning snapshot is
pinned at task start ([learning](learning-service.md#retrieval)); it sits after the project
instructions so a learning change never invalidates the cached system and tool prefix. "System
instruction" maps to Gemini `system_instruction`, Responses `instructions`, or a Chat
Completions `system`/`developer` message ([compatible endpoints](compatible-endpoints.md)).

## Budget model

`ContextBudget` defaults for `gemini-3.8-flash`, all configurable. For other models, the active
profile derives the budget from the capability snapshot with the
[context sizing formula](harness-profiles.md#context-sizing); the Gemini row of that formula
reproduces this table exactly, and small windows scale every number down (a window whose usable
size is below 10k tokens is `chat_only`).

| Parameter | Default | Notes |
|---|---|---|
| `seedTarget` | 24k tokens | Total seed size the compiler aims for |
| `reserveOutput` | 8k | Kept free for thinking and output; subtracted first |
| `epochSoftLimit` | 64k (observed `total_input_tokens`) | Triggers a new epoch at the next safe point |
| `epochHardLimit` | 160k | Forces a new epoch |
| `emergencyLimit` | model input limit − `reserveOutput` − safety margin | Never sent: the [preflight](#request-preflight) prevents it |
| `repoMap` | 2k–6k; cold start 8k (see allocation) | Aider's 1k default is too small for cold starts |
| `relevantCode` | remainder | |
| `inlineToolResultMax` | 2k tokens | Above this, the Result Shaper spools |
| `safetyMargin` | max(512, 3% of the window); unknown tokenizer: max(1,024, 8%) | Headroom for estimator error in the [preflight](#request-preflight) |
| `elisionBatchTokens` | 20k (scaled for small windows) | Minimum prunable tail before a batched elision |
| `noticeMax` | 300 tokens per notice | |

**Allocation algorithm for the seed:**
1. Fixed costs: system + tools + project instructions (measured, then cached by hash).
2. **Pinned brief sections** (never dropped): objective, user acceptance criteria, derived
   criteria, constraints, current plan, open failures (exact), open review obligations, next
   action. If the pinned sections alone exceed 40% of
   `seedTarget`, compress lists (keep newest and highest-severity) and emit telemetry.
3. Optional brief sections in priority order: decisions, notes, files modified, files read (as
   symbol cards), attempted approaches. Each is truncated from oldest to newest.
4. Repo map: `min(repoMapMax = 6k, max(repoMapMin = 2k, 0.25 × remaining))`. On a **cold
   start** (the ledger is empty for this task, so the model knows no files yet), use
   `min(repoMapColdStart = 8k, 0.5 × remaining)` instead.
5. Relevant code: greedy by **value density** (relevance score ÷ estimated tokens) until the
   remaining budget is used up. Every item is either a symbol card (cheap) or an excerpt
   (definition body or a ±N-line window).
6. Directive: always included (≤ 300 tokens).

## Relevant code selection

Candidate sources, each giving a raw score:

| Signal | Weight (initial) |
|---|---|
| Symbols and paths named in the objective, user messages or acceptance criteria | 1.0 |
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
projections. **No LLM call** unless noted.

```ts
interface EpochBrief {
  objective: string;                         // tasks.objective (user-owned; changed only by task.amend)
  acceptanceCriteria: string[];              // user-owned (TaskCreated / TaskAmended), never model-edited
  derivedCriteria: string[];                 // model-proposed via update_plan; additive only, labelled
  constraints: string[];                     // user directives + project rules found
  plan: PlanItem[];                          // update_plan state
  decisions: { decision: string; rationale: string }[];   // update_plan (model-authored)
  notes: string[];                           // update_plan (model-authored)
  filesModified: { path: string; diffStat: string; intents: string[] }[]; // transactions + instructions
  filesRead: { path: string; hash: ContentHash; symbols: SymbolCard[]; stale: boolean }[]; // ledger
  verification: { lastVerdict?: TaskState; checks: { id: string; status: string }[] };
  openFailures: { fp: string; exact: string; location?: string; attempts: number }[];
  attemptedApproaches: { attemptNo: number; summary: string; outcome: string }[]; // attempts projection
  nextAction: string;                        // plan's first non-done step, or the replan directive
  decisionDigest?: string;                   // LLM-generated ONLY if decisions/notes are empty and the epoch had ≥ N edits
}
```

- `attemptedApproaches[].summary` is built from the transaction `instruction` strings and the
  touched symbols of each attempt (deterministic).
- `decisionDigest` runs at most once per epoch boundary, at effort `low` (mapped by the profile), with ≤ 600
  output tokens. Its input is the epoch's model text turns and transaction instructions only, and
  it never sees raw tool outputs. Its cost is recorded as a context-management cost.

## Ingress admission

For each `IngressItem`, in order:
1. **Tool results:** already shaped by the tool (ledger stubs, Result Shaper summaries). The
   compiler enforces `inlineToolResultMax`. If a tool returns too much (a bug or an unforeseen
   case), the compiler spools it and logs a `shaper_bypass` counter.
2. **Notices:** de-duplicated by `(noticeType, key)` within the epoch. A repeated identical
   notice is not re-sent. Each is truncated to `noticeMax`.
3. **JIT project instructions:** when a tool result touches a path under a directory with an
   unseen `AGENTS.md`/`KAI.md`/`GEMINI.md`, append it as a notice once per epoch.
4. **Instructions before the first affected mutation** ([ADR-0023](../adr/0023-audit-corrections.md)):
   before a transaction or a mutating shell command whose targets (edit paths, or the command's
   `cwd` and path arguments) lie under a directory whose applicable instruction files have not
   been delivered in this epoch, the mutation is **withheld**: every edit call in the response
   returns `NOT APPLIED — new instructions apply to <dir>/; reconsider and resend if still
   appropriate`, the instructions are admitted as a `jit_instructions` notice, and
   `InstructionsWithheldMutation` is recorded. The model's next response decides whether to
   resend, change the plan or ask the user. Each directory is withheld at most once per epoch.
5. **Web content** from research tools arrives already shaped and wrapped in
   `<web_content trust="untrusted">` ([Chrome research](chrome-research.md#trust-and-injection));
   it is counted as `tail_web`.
6. Estimate tokens per category, update the epoch's running estimate, and emit a manifest delta.
   The running estimate also adds the response's **model-produced content** that stays in
   context: `assistant_text`, `function_call_args`, and `replay_native` items (reasoning items,
   thought signatures) in local replay mode.

## Request preflight

Before **every** model request (seed or continuation), the compiler assembles the complete
pending request as the adapter will send it and estimates it:

```
estimatedRequestTokens = system + declarations + seed + accumulated tail (local replay: every
                         replayed item, including assistant_text, function_call_args and
                         replay_native; provider chain: the server-side total observed last turn)
                       + pending ingress (all batched tool results and notices of this turn)
limit = snapshot.inputLimit − budget.reserveOutput − budget.safetyMargin
```

- The estimate uses the route's calibrated ratios; for an **unknown tokenizer** it uses the
  conservative ratio (`chars / 2.5`) and the larger safety margin
  ([harness profiles](harness-profiles.md#context-sizing)).
- If `estimatedRequestTokens > limit`, apply in order until it fits:
  1. **re-shape** the pending tool results with half the inline and shaped caps (full outputs
     stay in artifacts);
  2. **batched elision** of prunable tail content (local replay mode, [below](#local-replay-mode));
  3. **new epoch** with the pending results rendered into `<last_results>` (shaped to fit);
  4. if the seed alone does not fit: drop optional brief sections and the repo map, then
     relevant code; if pinned sections alone exceed the limit, the task becomes `blocked
     {context_exhausted}` with the measured sizes. **An over-limit request is never sent.**
- Each preflight records `RequestPreflighted {turnId, estimatedRequestTokens, limit, actions[]}`.
- A provider error for context length means the estimate was wrong: the route's ratio is scaled
  by 1.15 (OpenAI) or 1.2 (compatible), a new epoch starts, and the request is retried once
  ([OpenAI](openai-responses-provider.md#errors-and-retries), [compatible](compatible-endpoints.md#request-and-stream-handling)).

## Epoch decisions

`epochDecision` is evaluated **after each model response's tool calls have executed and their
results have been shaped, and before the next request**. This is the only *safe point*: no tool
is mid-execution and no transaction is half-applied. When a new epoch starts there, the shaped
results of the last response are **not** sent to the abandoned chain. They are rendered into the
new seed as a `<last_results>` section, placed just before the directive. A new chain has no
pending `function_call` steps for `function_result` steps to pair with, so they are sent as text,
not as `function_result` steps.

Rules, in order:
0. A provider, route, account or model switch is pending → `new_epoch(model_switch)`
   ([switches](#provider-and-route-switches)).
1. A replan was requested → `new_epoch(replan)`.
2. Input tokens > `epochHardLimit` → `new_epoch(hard_limit)`. "Input tokens" means the reported
   value, or the preflight's estimated request size when the route did not report usage.
3. A phase transition was recorded (`update_plan.phase` changed explore/plan → implement, or
   verification failed after `complete_task` and the Repair Controller asks for a fresh
   approach) → `new_epoch(phase)`.
4. Input tokens (as in rule 2) > `epochSoftLimit` **and** the last turn was not mid-transaction → `new_epoch(soft_limit)`.
5. Resume after idle > 30 min, or external changes to files read in this epoch → `new_epoch(resume)`.
6. Otherwise `continue`.

Before a planned (soft or phase) boundary, if the model has not called `update_plan` in the last
K = 8 turns, the compiler adds a one-line notice: *"Context will be refreshed soon; record
decisions and notes with update_plan."* The boundary is applied at the next safe point.

## Token estimation

```ts
interface TokenEstimator {
  estimate(text: string, category: ContextCategory): number;
  calibrate(observed: { manifest: ContextManifest; reportedInputTokens: number }): void;
}
```
- Base estimate: `ceil(chars / ratio[category])` with initial ratios
  `code: 3.2, prose: 4.0, json: 3.0, numbered_code: 2.9`. Ratios are kept **per route and
  model** (tokenizers differ). A route that has not reported usage for ≥ 5 turns uses the
  conservative ratio `chars / 2.5` for every category and is treated as an *unknown tokenizer*
  by the preflight.
- **Calibration:** after each response, distribute
  `reported − estimated` over the categories of the new content using exponential moving average
  updates of `ratio[category]`. Track `|unattributed| / reported` as an accuracy metric. The
  target is under 5% after 20 turns.
- Optional: plug in the `gemma3` SentencePiece tokenizer from `@google/genai` (experimental)
  once it is validated against reported usage for `gemini-3.8-flash`.

## Continuation modes

| Mode | Used by | Request contains |
|---|---|---|
| `provider_chain` | Gemini chained (default), OpenAI API key with `store: true` | Only the new steps plus the provider continuation handle |
| `local_replay` | Gemini stateless, **ChatGPT subscription (always)**, OpenAI API key with `store: false` (default), compatible endpoints | The seed plus the full epoch tail every request |

The provider continuation is **optional** ([ADR-0016](../adr/0016-providers-routes-profiles-capabilities.md)):
a `completed` event may carry none, and the compiler then stays in `local_replay`. Every epoch
can be rebuilt from durable state in either mode, which is what makes epochs resumable after a
crash or a route switch.

## Local replay mode

- Each request = seed (byte-identical) + full tail of the epoch, including the stored
  model-produced items.
- **Batched elision:** when the estimated prunable tail (tool results older than the newest 3
  turns, excluding plan and edit results) exceeds `elisionBatchTokens` (20k; scaled by the
  profile for small windows: `clamp(0.15·U, 2k, 20k)`), replace them with one-line stubs
  (`[result elided; art_x / ledger turn 9]`) in one batch, and emit `ContextElided`. Never elide
  a function call without its result, or the reverse (OpenHands' View invariants). Elision is
  batched because it changes the replayed prefix and busts provider caches.
- **Provider-native replay items** (Gemini thought steps with signatures, OpenAI reasoning items
  with `encrypted_content` and message `phase` fields, compatible `reasoning_content` when
  required) are included verbatim and in order. They are tagged `(provider, routeId,
  accountScope, model)` and sent only when every tag matches the request; otherwise they are
  dropped (and the epoch restarts if the provider requires them).

## Provider and route switches

A change of provider, route, ChatGPT account, compatible endpoint configuration or model happens
only at a **safe point** (no tool executing, no transaction half-applied):

1. Record `ProviderSwitched {taskId, fromRoute, toRoute, fromModel, toModel, reason}`.
2. Keep all authoritative state: task, user criteria, plan, decisions, ledger, transactions,
   verification evidence, repair fingerprints, research sources, learning snapshot.
3. Drop every `replay_native` item and continuation handle from the old route; **never**
   transplant opaque reasoning or continuation handles across providers, routes or accounts.
4. Start a new epoch (`model_switch`) with the new profile's prompt, tool rendering and
   budgets; the brief carries the evidence; the ledger treats the new epoch as unseen content.
5. A switch from a `local_only` route to a `cloud` route requires the user's explicit
   confirmation naming the privacy change; Kai never does it on its own, including on quota
   exhaustion ([credentials](credentials.md#rules)).

## Events emitted

`EpochStarted`, `EpochBriefBuilt`, `ToolLoadoutChanged`, `PromptVersioned`, `ContextElided`,
`RequestPreflighted`, `InstructionsWithheldMutation`, `LearnedProceduresSelected`,
`ProviderSwitched`, and the `inputManifest` part of `ModelRequest`.

## Failure handling

- Missing index or LSP: the repo map degrades to a directory tree plus file sizes (budget
  1k), and relevant code falls back to grep hits.
- The brief exceeds the budget even after compression: drop optional sections, keep pinned ones,
  and emit `brief_overflow` telemetry. If pinned sections alone exceed the seed target, raise the
  seed target to `pinned + 4k` for this epoch and alarm.
- The estimator is badly off (unattributed > 20%): fall back to conservative ratios
  (`chars / 2.5`) until calibrated.

## Acceptance tests

1. **Determinism:** the same durable state gives a byte-identical seed (excluding timestamps).
2. **Stability:** within an epoch, the system and tools bytes are unchanged across turns.
3. **Budget:** over 50 fixture states, seed size ≤ `seedTarget` + 5%, and pinned sections are
   always present.
4. **Epoch rules:** a simulated usage sequence triggers boundaries at the right points.
5. **Brief fidelity:** every modified file, open failure and recorded decision in projections
   appears in the brief (property test).
6. **Manifest reconciliation:** with a fake provider reporting known token counts, unattributed
   converges below 5%.
7. **Preflight:** a scripted turn returning 6 large tool results against a 32k fake endpoint
   never produces a request above the limit; the actions taken are recorded in order
   (re-shape, elide, new epoch).
8. **Complete manifest:** in local replay mode, the sum of manifest categories over an epoch
   (including `assistant_text`, `function_call_args`, `replay_native`) is within 5% of the
   serialized request size estimate.
9. **Instructions before mutation:** an edit under `packages/api/` with an unseen
   `packages/api/AGENTS.md` is withheld once with the instructions delivered; the resent edit
   applies; no file changed before the resend.
10. **Switch:** a task switched from `openai.chatgpt_subscription` to `gemini.api_key` mid-task
    sends no OpenAI reasoning item to Gemini; the new seed contains the brief and all open
    failures.
11. **Unknown usage:** with a route that reports no usage, `reportedInputTokens` and
    `unattributed` are `null`, never `0`, and the epoch rules use the estimated request size.
