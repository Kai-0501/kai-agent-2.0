# ADR-0020: OpenAI Responses adapter and the `openai` harness profile

- Status: Proposed
- Date: 2026-10-05
- Related: [specs/openai-responses-provider.md](../specs/openai-responses-provider.md), [specs/harness-profiles.md](../specs/harness-profiles.md), [specs/critic.md](../specs/critic.md), [ADR-0018](0018-providers-routes-profiles-capabilities.md), [ADR-0019](0019-sign-in-with-chatgpt-route.md)

## Context / problem

ChatGPT/OpenAI models become first-class. They speak the Responses API natively (typed output
items, function call items paired by `call_id`, reasoning items with encrypted content, effort
controls that vary by model). The owner observes that these models spend efficiently but tend to
over-review work that already satisfies its requirements. Two routes reach them: API key and
ChatGPT subscription, with different request rules.

## Considered alternatives

1. **Use Chat Completions for OpenAI too.** Loses reasoning items, encrypted replay and native
   item pairing; rejected for first-class support.
2. **One request builder for both routes.** Would send fields the subscription route rejects.
3. **A Responses adapter with per-route request builders, plus an `openai` profile with
   calibrated reasoning, critic and stopping policies** (chosen).

## Decision

- **Adapter:** `provider-openai` maps canonical requests to Responses input items. Each route has
  an **allowlist** request builder: a field is sent only if the route's builder lists it and the
  capability snapshot supports it. The subscription builder always sends `store: false`,
  `stream: true`, `instructions` (never a `system` item) and the full required history; it never
  sends `previous_response_id`, `max_output_tokens`, `temperature` or the other omitted fields.
  The API-key builder may use `store: true` with `previous_response_id` when the user allows
  provider-side storage; otherwise it uses local replay too.
- **Native items are preserved:** output items (messages with any `phase` field, function calls,
  reasoning items with `encrypted_content`) are stored verbatim and replayed in order, with
  each `function_call_output` paired to its `call_id`. They never pass through lossy text.
- **Stream success** is a terminal `response.completed` event. `response.incomplete`,
  `response.failed`, an error event or a disconnect make the turn unsuccessful even if text or
  partial items arrived; no tool call from an unsuccessful turn is executed.
- **Model catalog** is discovered per account and route, not hard-coded.
- **The `openai` profile** treats "over-review" as a hypothesis to measure, and encodes:
  - effort mapped to each model's native levels; higher effort permitted for architecture,
    ambiguous correctness, migrations and hard repairs when it lowers total project work;
  - concise, acceptance-focused prompts and a short, stable tool surface;
  - critic findings that must cite a violated requirement or a concrete defect with location,
    impact and evidence; **blocking** vs **advisory** separation; deduplication across rounds;
  - a stopping rule: required checks pass and no required review is unresolved → stop. Optional
    review is bounded to one round; advisory findings never start a repair loop;
  - explicit reopen conditions (failing check, reproduced defect, changed requirement,
    security, concurrency, API-contract or integrity evidence). The profile never tells the
    model to agree regardless of evidence.

## Rationale

Allowlist builders make the preview's rules a tested artifact instead of a set of deletes.
Verbatim native replay is the only safe way to carry encrypted reasoning through stateless
requests. Encoding stop and reopen conditions precisely targets the observed over-review without
weakening genuine review.

## Consequences

- A golden-request test per route asserts the exact field set (no unsupported field ever leaves
  the builder).
- The regression matrix compares the `openai` and `gemini` profiles on the same corpus slices
  ([harness-profiles](../specs/harness-profiles.md#regression-matrix)).
- Stateless subscription requests are larger than chained ones; the Context Compiler's preflight
  and batched elision apply ([context-compiler](../specs/context-compiler.md)).

## Unresolved questions

Open questions O4–O8 in [the research note](../research/extension-2026-10.md#open-questions)
(catalog shape, encrypted reasoning on the subscription route, tool packaging, `phase`, cache
keys).
