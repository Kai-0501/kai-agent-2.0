# Spec: Gemini Provider

- Package: `packages/provider-gemini`
- Decisions: [ADR-0003](../adr/0003-gemini-provider-strategy.md), [ADR-0011](../adr/0011-provider-extensibility-boundary.md)
- Research: [gemini-api.md](../research/gemini-api.md)

## Responsibility

Map Kai's canonical turn requests onto the **Gemini Interactions API** through the first-party
`@google/genai` SDK. Stream responses back as canonical events. Expose Gemini-specific
capabilities: chained state, thinking levels, `allowed_tools`, built-in tools, service tiers,
usage including cached and thought tokens. **Discover and record** model capabilities at runtime.

**Not responsible for:** context selection, tool execution, or deciding thinking levels. It
*clamps* levels to supported values and never picks them.

## Interfaces

```ts
interface GeminiProvider extends ModelProvider {
  id: "gemini";
  describe(model: ModelId): Promise<GeminiModelCapabilities>;
  runTurn(req: ProviderTurnRequest, signal: AbortSignal): AsyncIterable<ProviderTurnEvent>;
}

interface ProviderTurnRequest {
  turnId: TurnId;
  model: ModelId;                          // "gemini-3.8-flash"
  stateMode: "chained" | "stateless";
  continuation?: StateHandle;              // { provider:"gemini", interactionId } when chained mid-epoch
  systemInstruction: string;
  tools: ToolDeclaration[];
  input: CanonicalStep[];                  // chained: only new steps; stateless: full epoch
  effort: ReasoningEffort;                 // from the Governor
  allowedTools?: string[];                 // phase restriction
  maxOutputTokens?: number;
  providerOptions?: GeminiOptions;
}

interface GeminiOptions {
  provider: "gemini";
  serviceTier?: "standard" | "flex" | "priority";
  thinkingSummaries?: "auto" | "none";     // default "none"
  builtInTools?: ("google_search" | "url_context" | "code_execution")[];
  labels?: Record<string, string>;
}

type ProviderTurnEvent =
  | { type: "text_delta"; text: string }
  | { type: "thought_summary_delta"; text: string }
  | { type: "tool_call_started"; providerCallId: string; name: string }
  | { type: "tool_call_args_delta"; providerCallId: string; delta: string }
  | { type: "tool_call"; providerCallId: string; name: string; args: unknown }      // complete; safe to execute
  | { type: "opaque_reasoning"; payload: unknown }                                  // thought step with signature (stateless replay)
  | { type: "completed"; status: TurnStatus; usage: TurnUsage; continuation: StateHandle; rawRef?: ContentHash }
  | { type: "error"; kind: ProviderErrorKind; retryable: boolean; message: string };

interface TurnUsage {               // reported, verbatim from Interactions `usage`
  inputTokens: number; cachedTokens: number; thoughtTokens: number;
  outputTokens: number; toolUseTokens: number; totalTokens: number;
}
type TurnStatus = "completed" | "requires_action" | "incomplete" | "failed" | "cancelled" | "budget_exceeded";
```

## Mapping (canonical → Interactions)

| Canonical | Interactions |
|---|---|
| `systemInstruction` | `system_instruction` |
| `ToolDeclaration {name, description, parametersJsonSchema}` | `{type:"function", name, description, parameters}` |
| `effort` (`minimal\|low\|medium\|high`) | `generation_config.thinking_level` after clamping to `caps.thinkingLevels` |
| `allowedTools` | `generation_config.tool_choice = {allowed_tools: {mode: "auto", tools}}` |
| `maxOutputTokens` | `generation_config.max_output_tokens` |
| `user_text`, `harness_notice` | `{type:"user_input", content:[{type:"text", text}]}` (notices keep their `<kai_notice>` wrapper) |
| `function_result {providerCallId, name, result, isError}` | `{type:"function_result", call_id, name, result, is_error}` |
| (stateless) `model_text`, `function_call`, `opaque_reasoning` | the original `model_output`, `function_call` and `thought` steps, **verbatim** from the stored raw response |
| `continuation.interactionId` (chained) | `previous_interaction_id` |
| `stateMode: "stateless"` | `store: false` |
| `labels` | `labels` (`kai_session`, `kai_epoch`, `kai_turn`) |

**Never set:** `temperature`, `top_p` (deprecated; Google advises keeping 1.0 for Gemini 3),
`cached_content` (deprecated in Interactions).

## Streaming

- Call `client.interactions.create({..., stream: true})` and iterate the SSE events.
- Text `step.delta` → `text_delta`. Thought summaries → `thought_summary_delta` (only when
  enabled). Argument deltas → `tool_call_args_delta` (for UI). On `step.stop` of a
  `function_call` step → `tool_call` with fully parsed `args`.
- `interaction.completed` → `completed`, with `usage`, `status`, the new `interactionId`, and the
  full raw `Interaction` stored as a blob (`rawRef`) for stateless replay and debugging.
- **Degenerate-output guard:** while streaming text, track repeated 50-char chunks (Gemini CLI's
  heuristic). If any chunk repeats 10 times or more in the current output, **abort the stream**,
  emit `error {kind: "degenerate_output", retryable: true}`, and let the Repair Controller decide
  (usually: retry once at a different thinking level, or start a new epoch).
- Output-length guard: if `status: incomplete` with a `continuation_token`, continue
  automatically *only if* the partial output is still within budget. Otherwise surface it.

## Capability probing

At first use per (model, SDK version), and cached in the DB:

```ts
interface GeminiModelCapabilities extends ModelCapabilities {
  thinkingLevels: ("minimal" | "low" | "medium" | "high")[];  // G4
  chainedRequiresToolsEachTurn: boolean;                      // G1
  toolChangesWithinChainAreCacheSafe: boolean | "unknown";    // G2 (default "unknown" → treat as false)
  statelessSupported: boolean;
  inputTokenLimit: number;    // from models.get: input_token_limit
  outputTokenLimit: number;
}
```

- `models.get` provides the token limits.
- Thinking levels: send minimal 1-token requests at each level. A 400 `INVALID_ARGUMENT` marks a
  level unsupported. This costs about 4 tiny requests, once.
- Chained behaviour (G1): one probe chain with and without re-sent tools, comparing
  `total_input_tokens` deltas. **Only in `kai doctor --probe` and the contract test suite**,
  not at normal startup. The runtime default until probed is "re-send tools and system every
  turn".

## Error handling and retries

| Condition | Action |
|---|---|
| 429 / RESOURCE_EXHAUSTED | Backoff 2^n s with jitter, max 5 tries, honour `Retry-After`. Telemetry `rate_limited` |
| 500 / 503 / network reset **before any function call was emitted** | Retry the same request (max 3) |
| Stream dies **after** a function call was emitted | Do not retry blindly. Fetch the interaction by ID (`interactions.get`) if `store=true`. Else treat the partial calls as not executed and retry once |
| 400 referencing thought signatures (stateless) | Rebuild the input from stored raw steps. If it recurs, switch this epoch to chained mode (if allowed) and start a new epoch |
| 400 invalid tool schema | Fail fast (a Kai bug). The CI schema tests should prevent it |
| `previous_interaction_id` not found or expired | Start a new epoch (seed from durable state) |
| `status: failed` | `error {kind:"model_failed"}`; the Repair Controller decides |
| `status: budget_exceeded` | Surface to the user; stop the task (`blocked`) |

Every attempt is recorded (`ModelError` events), including the usage of failed attempts when it
is reported.

## Privacy

- On first run, and in `kai doctor`: *"Gemini chained mode stores interactions on Google
  servers (55 days paid tier / 1 day free tier by default). Use `kai config set
  gemini.stateMode stateless` to opt out."*
- Workspace config may force `stateless`, e.g. for proprietary code policy.

## Configuration

| Key | Default |
|---|---|
| `gemini.model` | `gemini-3.8-flash` |
| `gemini.stateMode` | `chained` |
| `gemini.apiKey` | from the `GEMINI_API_KEY` env var or the OS keychain. Never written to the DB or to logs |
| `gemini.serviceTier` | `standard` (benchmark runs may use `flex`) |
| `gemini.thinkingSummaries` | `none` (`auto` with `--debug`) |
| `gemini.sdkVersion` | pinned in `package.json`; upgraded only with contract tests |

## Contract tests (live, gated by a `GEMINI_API_KEY` CI secret)

1. Basic streamed text turn: usage fields present, `interactionId` returned.
2. Function call round-trip in **chained** mode, then in **stateless** mode (signature replay).
3. Parallel function calls: all calls are surfaced, and results are accepted in any order with
   matching `call_id`s.
4. `allowed_tools` restricts calls (the model cannot call a declared-but-disallowed tool).
5. Each thinking level accepted or rejected as probed. `total_thought_tokens` is monotone-ish
   across levels on a fixed reasoning prompt (sanity check, not strict).
6. G1, G2 and G3 measurements are logged to a report artifact. They are not assertions.

## Unit tests (offline)

A **recorded-fixture transport** replays SSE streams captured by the contract tests, so the
mapping, streaming, guards and retries are tested without network access.
