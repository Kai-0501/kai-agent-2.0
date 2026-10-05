# ADR-0003: Gemini provider strategy

- Status: Proposed
- Date: 2026-10-05
- Related: [research/gemini-api.md](../research/gemini-api.md), [specs/gemini-provider.md](../specs/gemini-provider.md), [ADR-0005](0005-context-compiler-and-epochs.md), [ADR-0011](0011-provider-extensibility-boundary.md)
- Amended by: [ADR-0018](0018-providers-routes-profiles-capabilities.md) (Gemini becomes one of three routes with its own `gemini` profile; behaviour unchanged) and [ADR-0023](0023-chrome-research.md) (built-in search tools are not used for research)

## Context / problem

Gemini 3.8 Flash (`gemini-3.8-flash`) is Kai's first-class model. Google offers two first-party
surfaces: the **Interactions API** (GA 2026-06-22, recommended for new work, with typed steps,
server-side state, implicit caching and `thinking_level`) and the older **`generateContent`**
(explicit caching, `media_resolution`, broader platform reach). Most open harnesses reach Gemini
through a lowest-common-denominator layer (AI SDK, LiteLLM, OpenAI-compatible) and hard-code
`thinkingLevel: high`.

## Considered alternatives

1. **OpenAI-compatible endpoint.** Rejected. It loses typed steps, `previous_interaction_id`,
   `thinking_level`, `allowed_tools`, cached and thought token accounting and thought signature
   handling.
2. **`generateContent` only** (Gemini CLI, Pi, Goose). Proven, but not Google's forward path.
   Stateless only, so Kai would manage thought signatures itself. No server state.
3. **Interactions, stateless only** (`store: false`). Full client control and privacy. Larger
   requests. Kai manages signatures.
4. **Interactions, chained only.** Cheapest requests, best cache use. Append-only server history
   and 55-day default retention.
5. **Interactions with chained state per epoch, stateless as a supported mode, and a
   `generateContent` transport seam.**

## Decision

**Option 5.**

- **Transport.** `@google/genai` `client.interactions.create({..., stream: true})`, pinned
  exactly.
- **Default state mode: `chained`.** Within an epoch, each request passes
  `previous_interaction_id` and only the new steps (function results and harness notices). Each
  new epoch starts a **new chain** from a seed compiled by the Context Compiler.
- **Supported state mode: `stateless`** (`store: false`). The provider sends the full compiled
  step list, including returned `thought` steps with signatures, which are stored as opaque
  provider payloads in the event log. Selected by config (`gemini.stateMode = "stateless"`) for
  privacy, or automatically when the API rejects chaining.
- **Every request sets `generation_config.thinking_level` explicitly**, using the Reasoning
  Governor's level clamped to the model's *probed* supported set.
- **Tools.** Function declarations come from Kai's tool registry (JSON Schema from Zod).
  `tool_choice.allowed_tools` restricts tools by phase. Gemini built-in tools (`google_search`,
  `url_context`, `code_execution`) are available only through an opt-in capability pack.
- **Usage.** Every `interaction.completed` usage block is recorded verbatim (input, cached,
  thought, output and tool-use tokens) in the event log and in telemetry.
- **Capability probing.** At first use per model, a cheap probe establishes the supported
  thinking levels, chained-mode behaviour (whether tools and system must be re-sent: open
  question G1), and whether `store:false` works. Results are cached with the SDK version and
  model ID.
- **`generateContent` transport seam.** The provider has an internal `GeminiTransport`
  interface. v1 ships only `InteractionsTransport`. A `GenerateContentTransport` can be added for
  Vertex or for explicit-cache experiments without changing anything outside the provider.
- **Explicit caching (`cachedContents`) is out of scope for v1.**
- **Temperature and top_p are not set** (Google's Gemini 3 guidance; both are deprecated in
  Interactions).
- **Retries.** Exponential backoff with jitter on 429, 500 and 503, honouring `Retry-After`.
  A stream that dies mid-call is retried only if no function call from it was executed. A turn
  with `status: incomplete` and a `continuation_token` is continued, not restarted.
- **Labels.** Each request carries `labels: {kai_session, kai_epoch, kai_turn}` for
  correlation, with no PII.

## Rationale

Interactions is Google's recommended and best-instrumented surface, and its typed steps map
directly onto Kai's event model. Chained mode gives cheap requests and implicit caching and keeps
thought signatures server-side. Its one drawback, server history Kai cannot edit, is neutralized
by keeping chains short and starting fresh epochs ([ADR-0005](0005-context-compiler-and-epochs.md)).
Stateless mode keeps the privacy option real.

## Consequences

- **Privacy disclosure.** Kai must tell users that, by default, Google stores interactions for
  55 days (paid tier) or 1 day (free tier), and how to switch to stateless mode. This appears on
  first run and in `kai doctor`.
- The provider must persist enough per step (IDs, signatures, raw steps) to rebuild a stateless
  request from the event log at any time. That also gives crash recovery when a chain is lost.
- API churn is contained in `packages/provider-gemini` and caught by **live contract tests**
  (gated by an API key secret) that run before any SDK upgrade.
- Vertex users are not supported in v1, unless Interactions on Vertex is confirmed.

## Unresolved questions

See [gemini-api.md open questions G1–G9](../research/gemini-api.md#open-questions). The most
consequential:
- **G1/G2:** tool re-sending and tool changes within a chain. These determine whether
  capability packs can change mid-epoch.
- **G4:** whether `minimal` is supported for `gemini-3.8-flash`.
- **G9:** whether stateless mode is as good in quality and latency.
