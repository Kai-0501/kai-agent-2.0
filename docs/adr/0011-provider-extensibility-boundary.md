# ADR-0011: Provider extensibility boundary

- Status: Proposed
- Date: 2026-10-05
- Related: [ADR-0003](0003-gemini-provider-strategy.md), [specs/gemini-provider.md](../specs/gemini-provider.md), [specs/reasoning-governor.md](../specs/reasoning-governor.md)
- Partially superseded by: [ADR-0018](0018-providers-routes-profiles-capabilities.md) (effort scale, optional continuation, unknown usage fields, credential routes and harness profiles)

## Context / problem

Gemini is first-class. Later providers may include OpenAI (Responses API), Anthropic (Messages),
xAI, OpenRouter and local OpenAI-compatible servers. Most harnesses normalize every provider into
one message model and lose provider-native features in the process. That is the
lowest-common-denominator (LCD) problem. Kai must stay open to other providers without
compromising Gemini.

## Considered alternatives

1. **An LCD chat-message interface** (Pi's `ai`, AI SDK, LiteLLM). Easy to add providers.
   Flattens Gemini's typed steps, server state and thinking levels.
2. **Gemini types as Kai's internal types.** Maximum Gemini fidelity. Couples the whole runtime
   to one vendor's schema, which changed incompatibly in May 2026.
3. **Kai-owned canonical turn types, rich enough for the best provider, plus capability
   descriptors and typed provider-specific options.** Each provider maps from canonical to native
   and declares what it supports.

## Decision

**Option 3.**

```ts
interface ModelProvider {
  readonly id: ProviderId;                       // "gemini", later "openai", ...
  describe(model: ModelId): Promise<ModelCapabilities>;
  runTurn(req: ProviderTurnRequest, signal: AbortSignal): AsyncIterable<ProviderTurnEvent>;
}
```

- **Canonical types** (owned by `packages/core`): `TurnInput` (an ordered list of `CanonicalStep`:
  `user_text`, `harness_notice`, `function_result`, plus, for replay, `model_text`,
  `function_call` and `opaque_reasoning`), `ToolDeclaration` (name, description, JSON Schema),
  `ReasoningEffort` (`minimal | low | medium | high`), `ToolRestriction` (`allowedTools`),
  `StateHandle` (opaque provider continuation, e.g. a Gemini interaction ID), and
  `ProviderTurnEvent` (text deltas, function calls, usage, status, errors).
- **Opaque provider payloads** (Gemini thought signatures, OpenAI encrypted reasoning) are
  carried as `opaque_reasoning { provider, payload }` steps. Core stores and replays them and
  never interprets them.
- **`ModelCapabilities`** declares: state modes (`chained`, `stateless`), supported effort levels
  and how they map to native settings, parallel tool calls, `allowedTools` support, usage fields
  available (cached, reasoning), input limit, output limit, built-in tools, and whether tool
  changes within a chain are cache-safe. Core logic branches on **capabilities**, never on
  provider names (T3 Code's rule).
- **Typed provider options:** `ProviderTurnRequest.providerOptions` is a discriminated union
  (`{provider: "gemini", serviceTier?, thinkingSummaries?, labels?, builtInTools?}`), so
  provider-specific features stay typed without leaking into core.
- **Effort mapping** lives in the provider. The Reasoning Governor outputs a canonical
  `ReasoningEffort`, and the provider maps and clamps it (Gemini: `thinking_level`; OpenAI:
  `reasoning.effort`; Anthropic: thinking budget or effort).

## Rationale

The canonical step model is a superset shaped by the richest provider (Gemini Interactions
steps) rather than the poorest (chat completions). Capability flags make degradation explicit
for weaker providers instead of silently dropping features for Gemini.

## Consequences

- Adding a provider means writing a mapper, a capability descriptor and contract tests. Core does
  not change.
- Some Kai features depend on capabilities. Chained epochs need `chained`; otherwise the compiler
  runs in stateless mode. Cached-token telemetry needs a cached usage field.
- Cross-provider switches inside a task are allowed only at epoch boundaries, because epoch seeds
  are provider-neutral and compiled from durable state. This is T3 Code's "explicit handoff
  artifact" idea in Kai's form.

## Unresolved questions

1. Should a second provider be implemented in v1 just to validate the boundary? Proposed: a
   **fake provider** (scripted, for tests) validates it in v1. A real second provider is
   postponed.
2. Can a local OpenAI-compatible model serve as a cheap critic or summarizer? Benchmark later.
