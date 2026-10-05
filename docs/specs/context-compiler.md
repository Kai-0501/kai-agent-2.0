# Spec: Context Compiler

- Package: `packages/core` (`context/`)
- Decision: [ADR-0005](../adr/0005-context-compiler-and-epochs.md)
- Collaborators: [Read Ledger](read-ledger.md), [Artifact Store](artifact-store.md), [Repo Index](repo-index.md), [Gemini Provider](gemini-provider.md), [Reasoning Governor](reasoning-governor.md), [Telemetry](telemetry.md)

## Responsibility

Decide **exactly what the model sees**, under a strict token budget, at two points:

1. **Seed compilation**: the first request of every epoch, built from durable state.
2. **Ingress admission**: everything appended to the epoch afterwards (tool results, notices).

It also owns **epoch boundary decisions** and the **context manifest**, a per-category token
accounting of every request.

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
  budget: ContextBudget;             // from config, possibly adjusted by the governor
  providerCaps: ModelCapabilities;
  toolLoadout: ToolDeclaration[];    // core + active packs
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
  // estimated tokens per category for this request's *new* content (seed: everything)
  categories: Partial<Record<ContextCategory, number>>;
  reportedInputTokens?: number;      // filled in after the response arrives
  unattributed?: number;             // reported − (cumulative estimated)
}

type ContextCategory =
  | "system" | "tools" | "project_instructions" | "brief" | "repo_map" | "relevant_code"
  | "directive" | "tail_read" | "tail_search" | "tail_edit_result" | "tail_shell"
  | "tail_test" | "tail_artifact" | "tail_plan" | "notices" | "user";

type EpochDecision =
  | { action: "continue" }
  | { action: "new_epoch"; reason: EpochReason };
```

## Seed layout (fixed order, for implicit-cache stability)

```
system_instruction:   [Kai system prompt]                        ← stable across epochs and sessions
tools:                [core + active packs]                      ← stable within epoch
input[0] user_input:  <project_instructions> AGENTS.md / KAI.md (root only; nested files are JIT)
input[1] user_input:  <epoch_brief> … </epoch_brief>
input[2] user_input:  <repo_map budget="…"> … </repo_map>
input[3] user_input:  <relevant_code> symbol cards + excerpts </relevant_code>
input[4] user_input:  <last_results> shaped results of the previous epoch's final tool calls </last_results>   (optional)
input[5] user_input:  <directive> what to do now </directive>
```

The system prompt and tools are byte-identical across epochs unless the loadout changes, so even
a new chain may hit the implicit cache for that prefix (to be measured, G5).

## Budget model

`ContextBudget` defaults for `gemini-3.8-flash`, all configurable:

| Parameter | Default | Notes |
|---|---|---|
| `seedTarget` | 24k tokens | Total seed size the compiler aims for |
| `reserveOutput` | 8k | Kept free for thinking and output; subtracted first |
| `epochSoftLimit` | 64k (observed `total_input_tokens`) | Triggers a new epoch at the next safe point |
| `epochHardLimit` | 160k | Forces a new epoch |
| `emergencyLimit` | model input limit − `reserveOutput` | Never planned; an alarm if reached |
| `repoMap` | 2k–6k; cold start 8k (see allocation) | Aider's 1k default is too small for cold starts |
| `relevantCode` | remainder | |
| `inlineToolResultMax` | 2k tokens | Above this, the Result Shaper spools |
| `noticeMax` | 300 tokens per notice | |

**Allocation algorithm for the seed:**
1. Fixed costs: system + tools + project instructions (measured, then cached by hash).
2. **Pinned brief sections** (never dropped): objective, acceptance criteria, constraints,
   current plan, open failures (exact), next action. If the pinned sections alone exceed 40% of
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
  objective: string;                         // tasks.objective
  acceptanceCriteria: string[];              // from user + update_plan
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
- `decisionDigest` runs at most once per epoch boundary, at `thinking_level: low`, with ≤ 600
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
4. Estimate tokens per category, update the epoch's running estimate, and emit a manifest delta.

## Epoch decisions

`epochDecision` is evaluated **after each model response's tool calls have executed and their
results have been shaped, and before the next request**. This is the only *safe point*: no tool
is mid-execution and no transaction is half-applied. When a new epoch starts there, the shaped
results of the last response are **not** sent to the abandoned chain. They are rendered into the
new seed as a `<last_results>` section, placed just before the directive. A new chain has no
pending `function_call` steps for `function_result` steps to pair with, so they are sent as text,
not as `function_result` steps.

Rules, in order:
1. A replan was requested → `new_epoch(replan)`.
2. Reported input tokens > `epochHardLimit` → `new_epoch(hard_limit)`.
3. A phase transition was recorded (`update_plan.phase` changed explore/plan → implement, or
   verification failed after `complete_task` and the Repair Controller asks for a fresh
   approach) → `new_epoch(phase)`.
4. Reported input > `epochSoftLimit` **and** the last turn was not mid-transaction → `new_epoch(soft_limit)`.
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
  `code: 3.2, prose: 4.0, json: 3.0, numbered_code: 2.9`.
- **Calibration:** after each response, distribute
  `reported − estimated` over the categories of the new content using exponential moving average
  updates of `ratio[category]`. Track `|unattributed| / reported` as an accuracy metric. The
  target is under 5% after 20 turns.
- Optional: plug in the `gemma3` SentencePiece tokenizer from `@google/genai` (experimental)
  once it is validated against reported usage for `gemini-3.8-flash`.

## Stateless mode differences

- Each request = seed (byte-identical) + full tail of the epoch.
- **Batched elision:** when the estimated prunable tail (tool results older than the newest 3
  turns, excluding plan and edit results) exceeds 20k tokens, replace them with one-line stubs
  (`[result elided; art_x / ledger turn 9]`) in one batch, and emit `ContextElided`. Never elide
  a function call without its result, or the reverse (OpenHands' View invariants).
- Thought steps with signatures from previous turns are always included unchanged (an API
  requirement).

## Events emitted

`EpochStarted`, `EpochBriefBuilt`, `ToolLoadoutChanged`, `PromptVersioned`, `ContextElided`, and
the `inputManifest` part of `ModelRequest`.

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
