# ADR-0016: Provider adapters, credential routes, harness profiles and capability snapshots

- Status: Proposed
- Date: 2026-10-05
- Related: [ADR-0011](0011-provider-extensibility-boundary.md), [ADR-0003](0003-gemini-provider-strategy.md), [specs/harness-profiles.md](../specs/harness-profiles.md), [specs/credentials.md](../specs/credentials.md), [specs/context-compiler.md](../specs/context-compiler.md), [research/extension-2026-10.md](../research/extension-2026-10.md)
- Supersedes (partially): ADR-0011's fixed `ReasoningEffort` enum as a universal contract,
  its mandatory `continuation` in turn completion, and its all-numeric `TurnUsage`

## Context / problem

ADR-0011 defined one `ModelProvider` port with canonical steps and capability flags. Three
things now vary independently and must not be conflated:

- the **wire protocol** (Gemini Interactions, OpenAI Responses, Chat Completions),
- **who pays and how Kai is authorized** (Gemini API key, OpenAI API key, ChatGPT subscription
  OAuth, endpoint key, intentional no-auth local),
- the **model-facing behaviour** (prompts, tool rendering, reasoning policy, replay, critic and
  stopping policy).

Two ADR-0011 assumptions also fail for the new routes: not every model has a
`minimal|low|medium|high` reasoning control (some have more levels, some none), and not every
route returns a continuation handle or complete numeric usage.

## Considered alternatives

1. **One provider class per vendor that also owns prompts and policy.** Duplicates the harness
   per vendor and lets vendor behaviour leak into core decisions.
2. **A single generic harness tuned for the weakest endpoint.** The lowest-common-denominator
   problem ADR-0011 rejected.
3. **Four separate concepts with explicit boundaries** (chosen).

## Decision

| Concept | Owns | Lives in | Never owns |
|---|---|---|---|
| **Provider adapter** | Wire protocol, streaming, native items, error mapping, probes | `provider-gemini`, `provider-openai`, `provider-compatible` | Prompts, policy, credentials storage |
| **Credential route** | How a request is authorized and billed: credential reference, refresh, quota state, usage class | `runtime` (CredentialStore + route state machine) | Model behaviour |
| **Harness profile** | Model-facing behaviour: prompt templates, tool rendering and aliases, effort policy and native mapping, replay rules, context sizing, critic and stopping policy | `profiles` package (data plus pure functions over core types) | Wire protocol, trust decisions |
| **Capability snapshot** | The effective support of *this model on this endpoint through this route for this account*, with `supported / unsupported / unknown` per feature, provenance and an ID | Recorded by the adapter, stored as an event | Anything not observed or explicitly overridden |

**Trusted runtime stays shared:** the Context Compiler, Read Ledger, Result Shaper, Patch
Engine, Firewall, Verification Engine, Integrity Guard, Repair Controller, event log, learning
and research are the same code for every profile. A profile can tune *how* the model is asked;
it can never relax *what* is accepted.

**Canonical effort.** The Governor emits an `EffortIntent` on the ordinal scale
`none < minimal < low < medium < high < xhigh`. The capability snapshot declares the native
control: `{control: "none"}` or an ordered list of native levels mapped onto the scale. The
profile maps intent to the nearest supported native level (ties go up for `replan`, `critic`
and high-risk work, down otherwise) and records `requested` and `applied` effort. A model with
no control records `applied: "uncontrolled"`.

**Continuation is optional.** `ProviderTurnEvent.completed.continuation` is present only when
the route supports provider-side continuation. The Context Compiler runs in
`provider_chain` mode (Gemini chained, OpenAI API key with stored responses) or
`local_replay` mode (Gemini stateless, ChatGPT subscription, compatible endpoints).

**Usage fields may be unknown.** Every reported usage field is `number | null`; `null` means
the route did not report it. Totals over unknown fields are reported as "partial", never as
zero. Reported and estimated numbers stay separate (invariant 10).

**Provider-native replay items** (Gemini thought signatures, OpenAI encrypted reasoning items
and phase metadata, compatible `reasoning_content`) are stored verbatim as blobs tagged with
`(provider, route, account scope, model)`. They are replayed only into requests with the same
tag and are dropped at any provider, route or account change.

**Selection.** The runtime picks a default profile per route (`gemini` route → `gemini`,
OpenAI routes → `openai`, compatible endpoints → `generic`). A user may override it only if the
profile's `appliesTo(snapshot)` predicate accepts the snapshot. Core never branches on profile,
provider or model names; it calls the profile interface and reads capability flags
(invariant 7).

## Rationale

Separating the four concepts lets the same Gemini model run through a different route (for
example a future Vertex route) without touching prompts, and lets the OpenAI profile serve both
API-key and subscription routes while keeping their request rules distinct. Tri-state
capabilities make "we don't know" explicit, which is what a user-configured endpoint needs.

## Consequences

- `ModelRequest` events pin `adapterVersion`, `routeId`, `profileId@version`, `capabilitySnapshotId`
  and `learningSnapshotHash`, so requests remain reproducible (invariant 8).
- The scaffold gains `profiles.ts`, `credentials.ts`, an extended `provider.ts`, and
  `provider-openai` / `provider-compatible` packages.
- Gemini behaviour does not change: the `gemini` profile reproduces the founding prompt, tools
  and governor table.

## Unresolved questions

1. Whether profile prompt templates should be per model family inside a profile (for example two
   OpenAI reasoning families). Proposed: allowed as profile *variants*, selected by capability
   predicates, never by name matching in core.
