# ADR-0021: OpenAI-compatible endpoints and the `generic` profile

- Status: Proposed
- Date: 2026-10-05
- Related: [specs/compatible-endpoints.md](../specs/compatible-endpoints.md), [specs/harness-profiles.md](../specs/harness-profiles.md), [ADR-0018](0018-providers-routes-profiles-capabilities.md), [research/extension-2026-10.md §6](../research/extension-2026-10.md#6-opencode-baseline-r19r20)

## Context / problem

Users want to run Kai against hosted compatible services and local servers (LM Studio,
llama.cpp, Ollama and similar). "Compatible" is loose: endpoints differ in streaming, tool-call
fragmentation, roles, `tool_choice`, parallel calls, usage reporting, reasoning fields and
context limits. An endpoint that returns text is not necessarily able to drive an agent.

## Considered alternatives

1. **Trust the configuration** (OpenCode loads an npm provider package named in config). Fast,
   but a config value then selects code to execute, and capabilities are assumed, not observed.
2. **Responses API as the baseline.** Few compatible servers implement it faithfully.
3. **Chat Completions baseline, Responses only when probed, bounded capability probes,
   tri-state capabilities and user-confirmed overrides** (chosen).

## Decision

- **Adapter:** `provider-compatible`, dialect `chat_completions` by default;
  `responses` only if the probe suite confirms the endpoint's contract.
- **Configuration is data, never code:** no package names, no templates, no scripts. Provider
  options pass through an **allowlist** of JSON-scalar keys. Headers come from an allowlist.
- **Network:** `https` required except for endpoints explicitly declared `loopback` or `lan`.
  Credentials are bound to the configured origin; cross-origin redirects are refused. TLS uses
  the system trust store, with an optional explicit CA file; certificate verification cannot be
  disabled. Declared local scopes are checked against the resolved address at connect time.
  These exceptions apply to the runtime's provider connection only. They never let web pages or
  the research browser reach local destinations.
- **Probes:** a fixed, bounded probe suite with disclosed cost establishes
  `supported / unsupported / unknown` per capability. Results are cached by
  `(endpointId, configRevision, adapterVersion)` and invalidated when any of them changes.
- **Tool calls are validated whole:** fragments are assembled, JSON-parsed and schema-validated
  after the stream finishes; malformed or incomplete calls never execute.
- **Limited mode:** an endpoint without reliable tool calling is `chat_only`. It cannot edit
  autonomously. A text-tool fallback exists only as an experimental, off-by-default protocol
  with its own strict grammar, validation and reliability bar.
- **Profile:** the `generic` profile ([harness-profiles](../specs/harness-profiles.md)) gives
  the same correctness protections with short prompts, simple schemas, sequential calls when
  parallelism is unknown, budgets scaled to the effective context, optional effort, and
  deterministic fallbacks.
- **Test matrix (initial):** one hosted compatible service (OpenRouter, Chat Completions) and two
  local servers (LM Studio and llama.cpp `llama-server`). Exact server versions, model IDs and
  dialects are recorded in the contract suite when it is first run. Provider nationality and
  parameter count are never capability signals.

## Rationale

Observed capabilities plus explicit unknowns are the only honest basis for an arbitrary
endpoint. Keeping config as data closes a code-execution path. Refusing autonomous editing
without reliable tool calls is cheaper than debugging prose-parsed commands.

## Consequences

- An "endpoint doctor" (CLI and app) shows probe results, latencies, reported limits and the
  reasons for any limited mode.
- Changing base URL, model, dialect or auth invalidates probes and starts a new epoch at the
  next safe boundary; provider-native replay items never cross the change.

## Unresolved questions

1. Whether the experimental text-tool protocol ever meets its reliability bar on a local model.
   It stays off until a benchmark shows it does.
