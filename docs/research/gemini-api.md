# Gemini API research (as of 2026-10-05)

This note records what Kai Agent can rely on from Google's Gemini API, and what it cannot yet
rely on. The prompt that started this project made several assumptions about the API. They are
checked one by one in the [hypothesis check](#hypothesis-check-against-the-founding-prompt).

**Source quality legend.** Every claim is labelled:
- **[SDK]** the first-party SDK source, which is generated from the API definition. Most reliable.
- **[DISC]** the live discovery document (`v1beta` revision `20261004`).
- **[COOK]** the official cookbook.
- **[CLI]** Google's Gemini CLI implementation.
- **[WEB]** a web-search snippet quoting `ai.google.dev` or a third party. `ai.google.dev` was
  blocked from the research sandbox, so these could not be read in full. Treat them as unverified.

SDK permalinks below use js-genai commit `f6b85db4` (v2.27.0, 2026-10-02):
`https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/…`, shortened
here to `js-genai:<path>`.

## 1. The model: `gemini-3.8-flash`

| Fact | Evidence |
|---|---|
| Model ID `gemini-3.8-flash` exists in the Interactions `Model` enum. | **[SDK]** [`js-genai:src/gaos/models/interactions/model.ts`](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/src/gaos/models/interactions/model.ts) |
| Google describes it as "Our most intelligent model for sustained frontier performance in agentic and coding tasks". The same text is attached to 3.5, 3.6 and 3.7 Flash. | **[SDK]** [`python-genai:google/genai/_gaos/types/interactions/model.py`](https://github.com/googleapis/python-genai/blob/618f0aa89c7fa61be973fabfa5747fb93a21b1bf/google/genai/_gaos/types/interactions/model.py) |
| Added to the SDKs in python-genai 2.22.0 (2026-09-02). | **[SDK]** [python-genai CHANGELOG](https://github.com/googleapis/python-genai/blob/618f0aa89c7fa61be973fabfa5747fb93a21b1bf/CHANGELOG.md) |
| The cookbook uses `gemini-3.8-flash` as the default model in its getting-started, thinking and caching notebooks. | **[COOK]** [`quickstarts/Get_started.ipynb`](https://github.com/google-gemini/cookbook/blob/3f6cdf049c3efee9b91c26ab2cb8fe4395c6603c/quickstarts/Get_started.ipynb) |
| 1,048,576 input tokens and 65,536 output tokens; released 2026-09-02; GA in the Gemini API. | **[WEB]** [ai.google.dev models page](https://ai.google.dev/gemini-api/docs/models) (search snippet) |
| Introductory price $0.75 / $3.75 per 1M input/output tokens until 2026-12-31, then $1.50 / $7.50. | **[WEB]** third-party summaries ([benchlm.ai](https://benchlm.ai/google/api-pricing)). Must be checked against the official pricing page before cost numbers are reported. |
| Reported benchmark scores: Terminal-Bench 2.1 90.8%, SWE-Bench Pro 61.6%. | **[WEB]** third-party ([datalearner](https://www.datalearner.com/en/ai-models/pretrained-models/gemini-3-8-flash)). Not relied on. |

**Implication.** The model is strong at agentic coding. Kai is not trying to make a weak model
usable. It is trying to remove waste and enforce verification around a capable but
overconfident and token-hungry model.

## 2. Interactions API, the primary interface

| Fact | Evidence |
|---|---|
| The Interactions API is called through `client.interactions.create(...)` in both SDKs. | **[SDK]** samples, e.g. [`js-genai:sdk-samples/interactions_basic.ts`](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/sdk-samples/interactions_basic.ts) |
| The cookbook calls it "the default API for the Gemini SDK" and moved all quickstarts to it. `generateContent` versions live on an archive branch. | **[COOK]** [`Get_started_interactions_api.ipynb`](https://github.com/google-gemini/cookbook/blob/3f6cdf049c3efee9b91c26ab2cb8fe4395c6603c/quickstarts/Get_started_interactions_api.ipynb) |
| It reached general availability on 2026-06-22. | **[WEB]** [API Evangelist](https://apievangelist.com/2026/06/22/google-makes-the-interactions-api-the-front-door-to-gemini/) |
| The schema changed incompatibly as recently as May 2026 (`outputs` became typed `steps`). | **[SDK]** python-genai 2.0.0 "BREAKING CHANGES – Interactions Only" ([CHANGELOG](https://github.com/googleapis/python-genai/blob/618f0aa89c7fa61be973fabfa5747fb93a21b1bf/CHANGELOG.md)). The python README still shows `interaction.outputs`, so docs lag the API. |
| The SDK samples state "Interactions API is not yet supported on Vertex". Cloud docs now have an Interactions developer guide for the Gemini Enterprise Agent Platform, so this may have changed. | **[SDK]** [`interactions_function_calling_server_state.ts`](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/sdk-samples/interactions_function_calling_server_state.ts); **[WEB]** [Cloud developer guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/interactions/developer-guide) |

### 2.1 Request shape (`CreateModelInteraction`)

From **[SDK]** [`create-model-interaction.ts`](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/src/gaos/models/interactions/create-model-interaction.ts):

| Field | Meaning for Kai |
|---|---|
| `model` | `gemini-3.8-flash` |
| `input` | `string \| Content \| Content[] \| Step[]`. Kai sends `Step[]`: `user_input`, `function_result`, and in stateless mode the previous `model_output`, `thought` and `function_call` steps. |
| `system_instruction` | A plain string. |
| `tools` | `Tool[]`. A function tool is `{type:"function", name, description, parameters}` where `parameters` is **JSON Schema** (typed `any`). Built-in tools include `google_search`, `code_execution`, `url_context`, `file_search`, `google_maps`, `computer_use` and remote MCP servers. |
| `generation_config` | `thinking_level`, `thinking_summaries`, `tool_choice`, `max_output_tokens`, `stop_sequences`, `seed`. `temperature` and `top_p` are marked **deprecated**. |
| `previous_interaction_id` | Chains to server-held state. |
| `store` | Defaults to true. `false` makes the call stateless. |
| `stream` | Server-sent events. |
| `continuation_token` | Resumes a long decode when status is `incomplete`. Added in v2.27.0 (2026-10-02). |
| `service_tier` | `flex \| standard \| priority \| deferred`. |
| `cached_content` | **Deprecated** in Interactions. Explicit caches are a `generateContent` feature. |
| `labels` | User metadata. Useful for tagging requests with Kai session and turn IDs. |

### 2.2 Response shape (`Interaction`)

From **[SDK]** [`interaction.ts`](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/src/gaos/models/interactions/interaction.ts):

- `id` is what the next turn passes as `previous_interaction_id`.
- `status` is one of `in_progress | requires_action | completed | failed | cancelled | incomplete | budget_exceeded | queued`.
- `steps: Step[]` is a typed union: `thought` (with `signature` and optional `summary`),
  `function_call` (`id`, `name`, `arguments`), `model_output` (`content[]`, optional `error`),
  and built-in tool call/result steps.
  See [`step.ts`](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/src/gaos/models/interactions/step.ts).
- `usage` (see §5) and `output_text`, a convenience field the SDK adds.

A function result is sent back as a `function_result` step with `call_id`, `name`, `result`
(string, object, or a list of text/image sub-contents) and an optional `is_error`
([`function-result-step.ts`](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/src/gaos/models/interactions/function-result-step.ts)).
`is_error` lets Kai mark tool failures structurally instead of in prose.

### 2.3 Streaming

`stream: true` returns SSE events. The samples show `step.delta` events with typed deltas
(`text`, `arguments`, `thought_signature`, …) and a terminal `interaction.completed` event that
carries the full `Interaction`, including `id`, `status`, `usage` and `continuation_token`
**[SDK]** ([`interactions_streaming.ts`](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/sdk-samples/interactions_streaming.ts),
[`interactions_continuation.ts`](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/sdk-samples/interactions_continuation.ts)).
Function-call arguments arrive as `arguments` deltas, so Kai can show tool-call progress live
but must only execute a call once its step has stopped (`step.stop`).

## 3. State: server-side chaining vs. stateless replay

| Fact | Evidence |
|---|---|
| **Chained mode.** Pass `previous_interaction_id` and send only the new input. The server reconstructs history, including thought signatures. | **[SDK]** [`interactions_function_calling_server_state.ts`](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/sdk-samples/interactions_function_calling_server_state.ts) |
| **Stateless mode.** Set `store: false` and send the whole `Step[]` history each time, including the model's own returned steps. | **[SDK]** [`interactions_stateless.ts`](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/sdk-samples/interactions_stateless.ts), [`interactions_function_calling_client_state.ts`](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/sdk-samples/interactions_function_calling_client_state.ts) |
| `store=false` cannot be combined with `previous_interaction_id` or background execution. | **[WEB]** [Interactions overview](https://ai.google.dev/gemini-api/docs/interactions-overview) (search snippet) |
| Stored interactions are retained **55 days on the paid tier and 1 day on the free tier**. Paid projects can shorten this to 7, 14 or 28 days in AI Studio. | **[WEB]** same page (search snippet) |
| The Interactions API does not support automatic function calling. The client runs tools. | **[COOK]** [`Get_started.ipynb`](https://github.com/google-gemini/cookbook/blob/3f6cdf049c3efee9b91c26ab2cb8fe4395c6603c/quickstarts/Get_started.ipynb) §Function calling |

**Implication.** Chained mode is cheap per request and keeps thought signatures on the server,
but **server-held history is append-only from Kai's side**. Kai cannot remove a stale file read
or an oversized tool result from a chain. That single fact shapes the Context Compiler design:
control what *enters* a chain, and start a new chain (an *epoch*) when the accumulated history is
no longer worth carrying ([ADR-0005](../adr/0005-context-compiler-and-epochs.md)).

The 55-day default retention is a privacy issue for proprietary code. Kai must say so clearly
and offer stateless mode as a supported configuration, not a degraded fallback
([ADR-0003](../adr/0003-gemini-provider-strategy.md)).

## 4. Caching

| Fact | Evidence |
|---|---|
| "With the Interactions API, context caching is handled automatically via **implicit caching**. When you use `previous_interaction_id` … the server can reuse cached content from previous turns." | **[COOK]** [`Get_started.ipynb` §Context caching](https://github.com/google-gemini/cookbook/blob/3f6cdf049c3efee9b91c26ab2cb8fe4395c6603c/quickstarts/Get_started.ipynb) |
| Implicit caching is on by default for Gemini 2.5 and newer, in both stateful and stateless modes. Chaining "allows the system to more easily utilize implicit caching". | **[WEB]** [Interactions overview](https://ai.google.dev/gemini-api/docs/interactions-overview) (search snippet) |
| Explicit caching (`client.caches.create`, TTL, model-specific, storage cost) is still available, but only through `generateContent`. `cached_content` is deprecated on Interactions. | **[COOK]** [`Caching.ipynb`](https://github.com/google-gemini/cookbook/blob/3f6cdf049c3efee9b91c26ab2cb8fe4395c6603c/quickstarts/Caching.ipynb); **[SDK]** `create-model-interaction.ts` |
| Usage reports cached tokens (`total_cached_tokens`, `cached_tokens_by_modality`). | **[SDK]** [`usage.ts`](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/src/gaos/models/interactions/usage.ts) |

**Implications.**
1. Implicit caching rewards a **stable prefix**: system instruction, then tool declarations, then
   project instructions, then the epoch seed. The Context Compiler must keep that order fixed
   within an epoch and must not rewrite earlier content. Rewriting history (Cline's duplicate-read
   replacement, OpenHands' condensation) throws the cache away. That is acceptable only in
   batches ([OpenHands condenser README](https://github.com/OpenHands/software-agent-sdk/blob/de30ec0111fc1c1435a1639d4ec27aead297d5b8/openhands-sdk/openhands/sdk/context/condenser/README.md)
   makes the same argument).
2. Cached tokens are cheaper but **still occupy the context and still bill**. A large window
   with a high cache hit rate is not free, and it does not fix stale assumptions. Caching
   complements the Context Compiler. It does not replace it.
3. Explicit caching is **out of scope for v1**. It would only pay off if the same large prefix
   (repo map plus project instructions) were reused across many separate epochs within its TTL.
   This is measurable later ([evaluation plan](../evaluation/benchmark-plan.md)).

## 5. Token accounting

Interactions `usage` **[SDK]** ([`usage.ts`](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/src/gaos/models/interactions/usage.ts)):

| Field | Meaning |
|---|---|
| `total_input_tokens` | Prompt tokens (context) |
| `total_cached_tokens` | Portion of the prompt served from cache |
| `total_thought_tokens` | Thinking tokens |
| `total_output_tokens` | Generated tokens |
| `total_tool_use_tokens` | Tokens in tool-use prompts (built-in tools) |
| `total_tokens` | Total for the interaction |
| `*_by_modality` | Per-modality breakdowns |

`generateContent`'s `usageMetadata` has the equivalents (`promptTokenCount`,
`cachedContentTokenCount`, `thoughtsTokenCount`, `candidatesTokenCount`,
`toolUsePromptTokenCount`). There, the prompt count includes cached tokens and the total is the
sum of prompt, tool-use, thoughts and candidates **[DISC]** **[SDK]**
([`types.ts` L3742–3763](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/src/types.ts#L3742-L3763)).

**Local token estimation.** The JS SDK has an experimental `LocalTokenizer` (SentencePiece). Its
model map ([`src/cross/tokenizer/_loader.ts`](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/src/cross/tokenizer/_loader.ts))
covers Gemini 2.x and `gemini-3-pro-preview` (all mapped to the `gemma3` vocabulary) but does
**not** list `gemini-3.8-flash`. The vocabulary is downloaded from `raw.githubusercontent.com` on
first use. The Context Compiler therefore uses a **calibrated estimator**: per-category
characters-per-token ratios, corrected continuously against the `total_input_tokens` the API
reports. The `gemma3` tokenizer can be an optional higher-accuracy estimator once it is checked
against reported usage ([spec](../specs/context-compiler.md#token-estimation)).

## 6. Thinking (reasoning effort)

| Fact | Evidence |
|---|---|
| Interactions `generation_config.thinking_level`: `"minimal" \| "low" \| "medium" \| "high"`. | **[SDK]** [`thinking-level.ts`](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/src/gaos/models/interactions/thinking-level.ts) |
| `thinking_summaries: "auto" \| "none"` controls whether thought summaries are returned. | **[SDK]** [`thinking-summaries.ts`](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/src/gaos/models/interactions/thinking-summaries.ts) |
| "While thinking is always on, you can configure the amount of thinking … using thinking levels (`minimal`, `low`, `medium`, `high`)". The cookbook table lists **High (default)**. Minimal is "roughly equivalent to off". | **[COOK]** [`Get_started_thinking.ipynb`](https://github.com/google-gemini/cookbook/blob/3f6cdf049c3efee9b91c26ab2cb8fe4395c6603c/quickstarts/Get_started_thinking.ipynb) |
| A Vertex guide for 3.8 Flash reportedly lists LOW/MEDIUM/HIGH with default MEDIUM. This **conflicts** with the SDK enum, which includes `minimal`. | **[WEB]** [Cloud 3.8 Flash guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-flash) (search snippet) |
| `generateContent` keeps the older `thinkingBudget` (token count, `-1` = automatic) next to `thinkingLevel`. | **[SDK]** [`types.ts` L2939](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/src/types.ts#L2939-L2948) |
| Gemini CLI hard-codes `thinkingLevel: HIGH` in its default model configs. OpenCode does the same for every non-legacy Gemini model. | **[CLI]** [`defaultModelConfigs.ts`](https://github.com/google-gemini/gemini-cli/blob/fb972b2f87fe7d5b06d37eac711490162d98de2c/packages/core/src/config/defaultModelConfigs.ts); [OpenCode `transform.ts` L1286](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/opencode/src/provider/transform.ts#L1286) |

**Implications.** The founding prompt is right that harnesses tend to run Gemini at maximum
effort all the time. Gemini CLI and OpenCode, two widely used harnesses, both do. Kai sets `thinking_level` explicitly on **every**
request through the Reasoning Governor ([spec](../specs/reasoning-governor.md)), and finds out
which levels a model accepts **at runtime** rather than hard-coding the enum. That resolves the
`minimal` discrepancy.

## 7. Function calling and tool control

| Fact | Evidence |
|---|---|
| Interactions `tool_choice` takes a mode or `{allowed_tools: {mode, tools: string[]}}`. | **[SDK]** [`tool-choice-config.ts`](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/src/gaos/models/interactions/tool-choice-config.ts), [`allowed-tools.ts`](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/src/gaos/models/interactions/allowed-tools.ts) |
| `generateContent` modes are `AUTO`, `ANY`, `NONE` and `VALIDATED`. `VALIDATED` means "either function calls or natural language, but calls must match the declarations". `allowedFunctionNames` restricts calls. | **[SDK]** [`types.ts` L456–477](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/src/types.ts#L456-L477) |
| Thought signatures **must** be passed back during function calling with Gemini 3 models, or the request fails with a 4xx. This includes `minimal` thinking. Parallel calls carry the signature on the first call. | **[WEB]** [Thought signatures doc](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures) (search snippet). A forum report describes Gemini 3 Flash *preview* sometimes omitting signatures on parallel calls ([discuss.ai.google.dev](https://discuss.ai.google.dev/t/gemini-3-flash-preview-inconsistent-thought-signature-generation-in-parallel-function-calls-causes-400-errors-and-potential-silent-data-loss/118936)). |
| In Interactions, signatures live on `thought` steps, and chained mode handles them server-side. | **[SDK]** [`thought-step.ts`](https://github.com/googleapis/js-genai/blob/f6b85db43db2cb88705f60af9c394fee308ac497/src/gaos/models/interactions/thought-step.ts); **[COOK]** "managed automatically by the SDK" |
| Gemini 3 guidance: drop explicit low temperatures and keep the default of 1.0 "to avoid potential looping issues or performance degradation". | **[COOK]** `Get_started.ipynb` §Migrating from Gemini 2.5 |

**Implications for dynamic tool exposure.** `allowed_tools` lets Kai restrict which tools may be
*called* without changing which tools are *declared*. That keeps the cached prefix stable, so it
is the right way to restrict tools by phase (for example, read-only tools while reviewing). It
saves **no tokens**. Token savings only come from declaring fewer tools, and changing declarations
mid-chain may break the cached prefix. See §8 and
[ADR-0012](../adr/0012-tool-surface-and-dynamic-exposure.md).

## 8. How much do tool declarations cost?

We measured the declaration sizes of real harnesses (characters of serialized declaration JSON;
Gemini text averages roughly 3.5–4 characters per token):

| Harness | Tool set | Size |
|---|---|---|
| Gemini CLI, `gemini-3` tool family, 19 core tools | [`coreToolsModelSnapshots.test.ts.snap`](https://github.com/google-gemini/gemini-cli/blob/fb972b2f87fe7d5b06d37eac711490162d98de2c/packages/core/src/tools/definitions/__snapshots__/coreToolsModelSnapshots.test.ts.snap) | ≈33.7k chars ≈ 8–10k tokens |
| Gemini CLI, legacy family | same | ≈35.4k chars |
| OpenCode, all tool description `.txt` files (descriptions only, no schemas) | [`packages/opencode/src/tool/*.txt`](https://github.com/anomalyco/opencode/tree/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/opencode/src/tool) | ≈15.1k chars |

Gemini CLI keeps a **separate, slimmer tool family for Gemini 3**. Its `replace` declaration is
≈2.0k characters for Gemini 3 against ≈4.5k for the legacy family
([`modelFamilyService.ts`](https://github.com/google-gemini/gemini-cli/blob/fb972b2f87fe7d5b06d37eac711490162d98de2c/packages/core/src/tools/definitions/modelFamilyService.ts)).

**Conclusion.** A full general-purpose tool roster costs about 8–10k tokens per request. With
implicit caching most of that is billed at the cached rate, but it is still context and still a
source of wrong tool choices. A deliberately small core (~10 tools, targeting ≤3.5k tokens) saves
roughly 5k tokens per uncached request against a Gemini-CLI-sized roster. The main benefit we
expect is **fewer distractor tools**, not raw cost. Capability packs only make a large token
difference once optional tool groups (MCP servers, web, VCS) would otherwise be declared. Kai
treats dynamic exposure as a modest, measurable optimization and does not build heavy machinery
for it ([ADR-0012](../adr/0012-tool-surface-and-dynamic-exposure.md)).

## 9. Tool shapes are part of model behaviour

Evidence that Gemini models do measurably better with tool interfaces close to those they were
trained with:

- Gemini CLI keeps model-family-specific tool declarations (`default-legacy` vs `gemini-3`) and
  snapshot-tests them per model.
- OpenHands ships a dedicated **Gemini preset** that swaps its Claude-style `file_editor` for
  "Gemini-style" tools that "match the tool interface used by gemini-cli": `read_file`,
  `write_file`, `edit`, `list_directory`
  ([`openhands-tools/openhands/tools/gemini/__init__.py`](https://github.com/OpenHands/software-agent-sdk/blob/de30ec0111fc1c1435a1639d4ec27aead297d5b8/openhands-tools/openhands/tools/gemini/__init__.py)).
- OpenCode swaps `edit`/`write` for `apply_patch` on GPT models, the format Codex models were
  trained on ([`registry.ts` L297–300](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/opencode/src/tool/registry.ts#L297-L300)).

**Implication.** Kai's core tools use **Gemini CLI's `gemini-3` names and argument shapes**
wherever the semantics agree: `read_file(file_path, start_line, end_line)`,
`replace(file_path, old_string, new_string, allow_multiple, instruction)`,
`grep_search(pattern, …)`, `glob`, `write_file`, `run_shell_command`. Kai-specific behaviour
(ledger stubs, artifact spooling, firewall rejections) goes into tool *results*, not unfamiliar
tool *shapes* ([spec](../specs/tool-surface.md)).

## 10. Known Gemini failure modes reported in the field

Secondary sources, used only to choose what to test for:

- **Repetition and degenerate loops** in long generations and in agent loops, for example
  ["Infinite loop bug while using the Gemini 3"](https://discuss.ai.google.dev/t/infinite-loop-bug-while-using-the-gemini-3/119986)
  and ["Gemini 3.8 Flash in Antigravity: … Command Looping, Quota Drain"](https://discuss.ai.google.dev/t/gemini-3-8-flash-in-antigravity-severe-latency-command-looping-quota-drain-api-503-billing-issues/183550).
  Gemini CLI built a dedicated `LoopDetectionService` (repeated tool calls, repeated content
  chunks, plus an LLM-based check) for this
  ([source](https://github.com/google-gemini/gemini-cli/blob/fb972b2f87fe7d5b06d37eac711490162d98de2c/packages/core/src/services/loopDetectionService.ts)).
- **Inventing files, paths and data** when lookups fail
  ([forum report](https://discuss.ai.google.dev/t/gemini-3-flash-preview-truncated-garbage-output-hallucination-and-incomplete-tool-calls-in-production-testing/114198)).
- **Omission placeholders** ("rest of code unchanged …"). Gemini CLI has a dedicated detector
  ([`omissionPlaceholderDetector.ts`](https://github.com/google-gemini/gemini-cli/blob/fb972b2f87fe7d5b06d37eac711490162d98de2c/packages/core/src/tools/omissionPlaceholderDetector.ts))
  and states the rule in its `replace` declaration.

These map directly onto Kai's Repair/Replan Controller, Hallucination Firewall and stream-level
loop abort ([failure modes](../failure-modes.md)).

## Hypothesis check against the founding prompt

| Founding assumption | Verdict |
|---|---|
| "Gemini 3.8 Flash" is the current coding/agent model | **Confirmed.** `gemini-3.8-flash`, GA. |
| Interactions API "or its current successor" | **Confirmed.** Interactions is GA and is now Google's recommended interface. |
| Stateful interactions are useful | **Confirmed with a caveat.** They are useful *within an epoch*. Server state is append-only from the client's side and retained 55 days by default. |
| Context caching helps | **Partly.** Implicit caching is automatic in Interactions. Explicit caching is a `generateContent`-only feature and is deferred. |
| Thinking/reasoning effort controls exist | **Confirmed.** `thinking_level` (`minimal`…`high`). The supported set per model must be discovered at runtime. |
| Token accounting is available | **Confirmed.** Input, cached, thought, output and tool-use tokens per interaction. |
| Function calling plus streaming | **Confirmed.** Typed steps, SSE deltas, `allowed_tools`, `is_error`. No automatic function calling, which is what Kai wants anyway. |
| Avoid an OpenAI-compatible shim | **Strongly confirmed.** A shim would lose typed steps, `previous_interaction_id`, `thinking_level`, `allowed_tools`, cached and thought token accounting, and thought-signature handling. |

## Open questions

These must be resolved with **contract tests against the live API** in Phase 1
([implementation plan](../../IMPLEMENTATION_PLAN.md)). The Gemini provider exposes each one as a
capability flag so the rest of Kai does not depend on the answer.

| # | Question | Why it matters | Default until known |
|---|---|---|---|
| G1 | In chained mode, must `tools` and `system_instruction` be re-sent each turn? If they are re-sent, are they double-counted? | Token accounting and correctness | Re-send on every request, and compare the reported `total_input_tokens` with and without |
| G2 | Does changing `tools` within a chain invalidate the implicit cache? | Capability-pack design | Change tool declarations only at epoch boundaries |
| G3 | Does changing `thinking_level` within a chain affect caching? | Governor granularity | Assume no effect, and measure |
| G4 | Exactly which `thinking_level` values does `gemini-3.8-flash` accept on the Developer API? | Governor mapping | Probe at startup, cache the result, and clamp unsupported levels to the nearest supported one |
| G5 | Implicit cache minimum prefix size, TTL and discount for 3.8 Flash | Epoch length tuning | Measure `total_cached_tokens` / `total_input_tokens` |
| G6 | Is Interactions now available on Vertex / Gemini Enterprise with feature parity? | Enterprise deployment | Developer API only in v1. A `generateContent` transport seam exists. |
| G7 | Rate limits and 503 behaviour for 3.8 Flash at agentic request rates | Retry policy | Exponential backoff with jitter. Surface quota state in telemetry. |
| G8 | Are thought summaries billed, and are they worth keeping? | Telemetry cost | `thinking_summaries: "none"` by default. `"auto"` in debug mode. |
| G9 | Does `store: false` change model quality or latency? | Privacy-mode viability | Benchmark both modes |
