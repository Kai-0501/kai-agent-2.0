# Spec: OpenAI Responses provider (API key and ChatGPT subscription routes)

- Package: `packages/provider-openai`
- Decisions: [ADR-0018](../adr/0018-openai-responses-and-profile.md), [ADR-0016](../adr/0016-providers-routes-profiles-capabilities.md), [ADR-0017](../adr/0017-sign-in-with-chatgpt-route.md)
- Research: [extension research §2](../research/extension-2026-10.md#2-sign-in-with-chatgpt-for-open-source-and-local-apps-r2r10)
- Collaborators: [credentials](credentials.md), [harness profiles](harness-profiles.md), [Context Compiler](context-compiler.md), [telemetry](telemetry.md)

## Responsibility

Map Kai's canonical turn requests to the **OpenAI Responses API**, stream results back as
canonical events, preserve **native output items** for replay, discover the **model catalog**
and record a **capability snapshot** per (route, account, model). Apply **route-specific request
rules** through allowlist builders.

**Not responsible for:** prompts and policy (the `openai` profile), credentials (the route), or
context selection (the Context Compiler).

## Route request rules

| Field | `openai.api_key` | `openai.chatgpt_subscription` |
|---|---|---|
| Endpoint | `POST https://api.openai.com/v1/responses` | same, OAuth bearer from the route |
| `model` | configured or catalog | **catalog slug only** (`visibility == "list"`) |
| `instructions` | system prompt | system prompt (explicit `system` items are rejected) |
| `input` | items | items, **full required history every request** |
| `stream` | `true` | **`true` (required)** |
| `store` | `openai.storeResponses` (default `false`) | **`false` (required)** |
| `previous_response_id` | only if `store: true` and continuing an epoch | **never** |
| `include` | `["reasoning.encrypted_content"]` when `store: false` and the model reasons | same (O5; dropped if rejected) |
| `tools` | function tools, top-level | function tools; packaging per snapshot (top-level, one `kai` namespace, or `additional_tools` items; O6) |
| `tool_choice` | `auto`, or `allowed_tools` for phase restriction | `auto`; `allowed_tools` only if the snapshot says supported |
| `parallel_tool_calls` | `true` unless the profile disables it | omitted unless supported (O8) |
| `reasoning` | `{effort: <native>}` when the model has a control; `summary` only with `--debug` | same |
| `max_output_tokens` | profile reserve | **omitted** |
| `prompt_cache_key` | `kai:<sessionId>:<epochId>` | omitted unless supported (O8) |
| `metadata` | `{kai_session, kai_epoch, kai_turn}` | **omitted** |
| `service_tier` | config (benchmark may use `flex`) | omitted |
| `temperature`, `top_p`, `top_logprobs`, `truncation`, `user`, `safety_identifier`, `background`, `conversation`, `prompt`, `prompt_cache_retention`, `moderation`, `max_tool_calls`, `multi_agent` | never set | **never set** (documented as unsupported) |

**Allowlist builder.** Each route has a frozen list of top-level keys it may emit. The builder
constructs the body from that list only and then drops any key whose capability is
`unsupported`. A property test generates random configs and capability snapshots and asserts
no disallowed key ever appears. A schema error from the API on an allowlisted key marks that
capability `unsupported` in the snapshot (with the error code as provenance) and retries once
without it; a second failure is a hard error.

## Mapping (canonical → Responses input items)

| Canonical step | Responses item |
|---|---|
| `systemInstruction` | top-level `instructions` |
| `user_text` | `{type: "message", role: "user", content: [{type: "input_text", text}]}` |
| `harness_notice` | `{type: "message", role: "developer", content: [{type: "input_text", text: "<kai_notice …>…</kai_notice>"}]}` (the `openai` profile renders notices as developer messages; the `generic` profile uses `user`) |
| `function_result` | `{type: "function_call_output", call_id, output}`; `output` is the shaped text; errors start with `ERROR:` / `NOT APPLIED` as in the founding formats |
| `replay_native` (reasoning, message, function_call items from earlier turns) | the stored output items **verbatim**, in their original order, including unknown fields such as `phase` (O7) and `encrypted_content` |
| `ToolDeclaration` | `{type: "function", name, description, parameters, strict: false}` (profile may emit strict-compatible schemas when the snapshot marks strict mode supported) |

Every `function_call` replayed must be followed by its `function_call_output` with the same
`call_id` before the next user or developer message; the Context Compiler's elision never
separates them ([context-compiler](context-compiler.md#local-replay-mode)).

Replay items are tagged `{provider: "openai", routeId, accountScope, model}` and are dropped by
the compiler when any tag differs from the request's.

## Streaming

Events (recorded as SSE fixtures by the contract suite; names per the Responses streaming
reference at the pinned SDK or HTTP version):

| Server event | Canonical event |
|---|---|
| `response.output_text.delta` | `text_delta` |
| `response.reasoning_summary_text.delta` | `thought_summary_delta` (only when summaries were requested) |
| `response.output_item.added` (function call) | `tool_call_started` |
| `response.function_call_arguments.delta` | `tool_call_args_delta` (UI only) |
| `response.output_item.done` | item buffered (function call: arguments parsed and validated later) |
| `response.completed` | `completed {status: "completed", usage, continuation?, rawRef}` → then buffered `tool_call` events are released |
| `response.incomplete` | `completed {status: "incomplete", reason}`; buffered calls are **discarded** |
| `response.failed`, `error` | `error {kind, retryable}`; buffered calls discarded |
| connection closed before a terminal event | `error {kind: "stream_interrupted", retryable: true}`; buffered calls discarded |

**Success requires the terminal `response.completed` event.** Text that arrived before a
failure is shown in the UI as *interrupted* and stored in the failed attempt's blob, but it is
not appended to the epoch and no tool call from that attempt executes.

## Model catalog and capability snapshot

- **Subscription route:** `GET https://api.openai.com/v1/models` with the route's bearer token
  (O4), keep entries with `visibility == "list"`, show `display_name`, send `slug`. Cached per
  `accountScope` for 1 h; refreshed on `model_not_found` or on demand. Kai ships no fixed picker.
- **API-key route:** `GET /v1/models`, filtered to models the `openai` profile's
  `appliesTo` accepts (Responses support, function calling).
- **Limits and effort levels:** from a versioned `model-facts` table in this package (each row
  cites its official source URL and access date), overridden by catalog fields when present,
  then by user overrides. Unknown limits use the conservative default (input 128k, output
  16k) and are labelled `limitsSource: "default_conservative"`.
- **Probes** (`kai doctor --probe`, the app's provider screen, and the contract suite only;
  never at normal startup): one tiny request per native effort level, one function-call
  round trip, encrypted-reasoning replay (O5), tool packaging (O6), `phase` presence (O7),
  `prompt_cache_key`/`parallel_tool_calls` acceptance (O8). Probes on the subscription route
  disclose that they use plan allowance.

```ts
interface OpenAICapabilitySnapshot extends CapabilitySnapshot {
  provider: "openai";
  routeId: "openai.api_key" | "openai.chatgpt_subscription";
  responsesFeatures: {
    previousResponseId: Support;      // subscription: "unsupported"
    encryptedReasoning: Support;      // O5
    toolPackaging: "top_level" | "namespace" | "additional_tools" | "unknown"; // O6
    allowedToolsChoice: Support;
    parallelToolCalls: Support;
    promptCacheKey: Support;
    maxOutputTokens: Support;         // subscription: "unsupported"
    phaseField: Support;              // O7
  };
}
```

## Usage mapping

| Responses `usage` | `TurnUsage` (reported; `null` if absent) |
|---|---|
| `input_tokens` | `inputTokens` |
| `input_tokens_details.cached_tokens` | `cachedTokens` |
| `output_tokens` | `outputTokens` (**includes** reasoning: the snapshot sets `reasoningIncludedInOutput: true` so totals never double-count) |
| `output_tokens_details.reasoning_tokens` | `reasoningTokens` |
| `total_tokens` | `totalTokens` |

The usage class comes from the route (`api_metered` or `subscription_allowance`). Cost is
computed only for `api_metered` with the versioned price table.

## Errors and retries

| Condition | Action |
|---|---|
| 401 | Route refresh (single-flight), retry once; second 401 → `reauth_required` |
| 403 / `model_not_found` | Refresh catalog; if the model is gone → task `blocked {model_unavailable}` with the catalog shown |
| 429 `subscription_sharing_usage_limit_exceeded` | Route → `quota_exhausted`; task `blocked {route}`; no retry, no switch |
| 503 `subscription_sharing_usage_unavailable` | Retry 3× (2, 8, 30 s); then route → `usage_unavailable`, task `blocked {route}` |
| 429 rate limit (API key) | Backoff with jitter, honour `Retry-After`, max 5 |
| 429 `insufficient_quota` (API key) | Task `blocked {route}`; no switch |
| 400 context length | Preflight underestimated: recalibrate the estimator ratio for the route (×1.15), start a new epoch, retry once |
| 400 unknown parameter / unsupported value | Mark the capability `unsupported`, retry once without it (allowlist rule) |
| 400 other | Fail fast (`invalid_request`, a Kai bug); recorded with the request blob |
| 5xx, network before the terminal event | Retry the identical request up to 2× (no tool from the failed attempt ran) |
| `response.incomplete` (`max_output_tokens`) | Notice *"Your response hit the output limit. Make smaller edits per response."* and retry once |
| `response.incomplete` (`content_filter`) or `response.failed` | `model_failed`; the Repair Controller decides |

Every attempt is a `ModelRequest`/`ModelError` pair. Usage of a failed attempt is recorded if the
server reported it, otherwise as unknown, and counted under purpose `retry`.

## Privacy

`store: false` is the default on both routes, so OpenAI does not retain responses for
continuation. The app states which route and account a task uses, and that plan usage counts
against the user's ChatGPT plan and app-specific limits.

## Acceptance tests

Offline (recorded SSE fixtures and a fake HTTP server):

1. **Golden subscription request:** a 3-turn epoch with tool results builds a body whose key set
   equals the subscription allowlist; contains `store: false`, `stream: true`, `instructions`,
   full history; contains none of `previous_response_id`, `max_output_tokens`, `temperature`,
   `metadata`, `truncation`, `user`.
2. **Allowlist property test** over random configs and snapshots (no disallowed key, ever).
3. **Resume from local replay:** kill the runtime after turn 3; restart; the rebuilt request for
   turn 4 equals the original turn-4 request (byte-identical `input` from stored items).
4. **Encrypted reasoning pairing:** reasoning and function-call items are replayed in order with
   matching `function_call_output`; changing `accountScope` drops the reasoning items.
5. **Mid-stream quota failure:** the fake server streams text deltas and a function call, then
   returns the quota error → no tool executes, the UI shows the text as interrupted, route
   `quota_exhausted`, task `blocked {route}`, no request to any other route.
6. **Failure after text** (connection reset before `response.completed`) → retry of the identical
   request; the first attempt's text is not in the epoch.
7. **Incomplete** (`max_output_tokens`, API-key route) → notice and one retry.
8. **Unsupported parameter discovery:** a 400 for `prompt_cache_key` marks it `unsupported` and
   the retry omits it.
9. **Usage unknowns:** a response without `input_tokens_details` records `cachedTokens: null`;
   the task summary shows cached usage as *partial*.

Live (gated `test:contract:openai` with `OPENAI_API_KEY`; `test:live-auth` for the subscription
route): streamed text turn, function round trip, effort levels, O4–O8 measurements.
