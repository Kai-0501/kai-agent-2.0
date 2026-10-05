# ADR-0017: Release scope: macOS app, three model routes, shared learning, Chrome research

- Status: Proposed
- Date: 2026-10-05
- Related: [research/extension-2026-10.md](../research/extension-2026-10.md), [ADR-0002](0002-runtime-client-boundary.md), [ADR-0011](0011-provider-extensibility-boundary.md), [ADR-0012](0012-tool-surface-and-dynamic-exposure.md), ADRs [0018](0018-providers-routes-profiles-capabilities.md)–[0016](0016-robustness-amendments.md)
- Supersedes: the release non-goals in README.md and ARCHITECTURE.md §11 ("desktop/web UI",
  "providers other than Gemini", "autonomous browsing"), and the matching rows of
  IMPLEMENTATION_PLAN.md §Postponed

## Context / problem

The founding design was a Gemini-first CLI harness. It deferred a desktop UI, other providers
and browsing. The owner's product requirements now ask for a **local macOS coding-agent app**
with six features in the next release:

1. app-wide procedural learning that lowers total resource use per comparable project without
   lowering quality,
2. official Sign in with ChatGPT and eligible subscription inference,
3. a first-class ChatGPT/OpenAI harness profile,
4. user-configured OpenAI-compatible endpoints (hosted and local),
5. a capable generic harness profile for those endpoints,
6. provider-independent web search and page reading through the user's installed Google Chrome.

Gemini stays first-class through its native API. The trusted core (event log, Patch Engine,
Verification Engine, Context Compiler, KSP) must not be weakened by any of this.

## Considered alternatives

1. **Keep the deferrals; add features after v1.** Contradicts the product requirements.
2. **Add features as independent plugins** (OpenCode's shape: npm provider packages, skills
   folders, a web tool). Fast, but each plugin would need its own path around the ledger,
   the shaper and the verification gate, which breaks invariants 2–4.
3. **Extend the existing runtime with bounded subsystems that reuse the trusted core**, and
   ship the CLI and the macOS app as two KSP clients of the same runtime.

## Decision

**Option 3.** The release ("R1") contains all six features. Internal phases may sequence them,
but none is in an indefinite "later" list.

- **Product surface:** a macOS app ([ADR-0024](0024-macos-desktop-shell.md)). The CLI remains
  for development, headless runs and the benchmark. Both are KSP clients.
- **Model access** is split into provider adapters, credential routes, harness profiles and
  capability snapshots ([ADR-0018](0018-providers-routes-profiles-capabilities.md)). Three
  profiles ship: `gemini` (first-class), `openai` (first-class, API key and ChatGPT
  subscription routes; [ADR-0019](0019-sign-in-with-chatgpt-route.md),
  [ADR-0020](0020-openai-responses-and-profile.md)) and `generic` (OpenAI-compatible
  endpoints; [ADR-0021](0021-openai-compatible-endpoints.md)).
- **Learning** is one runtime-owned service with its own store, shared by all routes
  ([ADR-0022](0022-shared-procedural-learning.md)).
- **Research** is one runtime-owned service that drives the installed Chrome, shared by all
  profiles ([ADR-0023](0023-chrome-research.md)). It replaces the `research` pack of
  [ADR-0012](0012-tool-surface-and-dynamic-exposure.md), which used Gemini built-in tools.
- **Audit corrections** found in review of the founding specs (the user-owned Task Contract,
  [ADR-0015](0015-user-owned-task-contract.md), and the robustness amendments,
  [ADR-0016](0016-robustness-amendments.md)) apply to every route and profile, because the new
  routes multiply their impact.

Still out of scope for R1: multi-user or remote clients, OS sandboxing of commands, MCP,
Windows and Linux desktop builds, a broad UI redesign, unrestricted browser automation, and
model-native hosted tools as a dependency.

## Rationale

Every new feature either produces model input (profiles, learning, research) or consumes model
output (routes). Routing all of it through the Context Compiler, the Result Shaper, the Patch
Engine and the Verification Engine is what keeps Kai's two goals measurable across providers.
Plugins would have been cheaper to start and much harder to keep honest.

## Consequences

- README, ARCHITECTURE, IMPLEMENTATION_PLAN and AGENTS are rewritten around the release scope.
- New invariants: credentials never cross KSP; learned advice never outranks user, repository or
  verification constraints; web content never becomes instructions or global policy
  ([AGENTS.md](../../AGENTS.md)).
- The benchmark grows learning, profile and research comparisons
  ([benchmark plan](../evaluation/benchmark-plan.md)).
- The release needs macOS signing, a credential store and installed-Chrome smoke tests, which
  cannot run in Linux CI. These are separate, explicitly gated suites.

## Unresolved questions

1. Licence and distribution model. The owner decides; the subscription route's eligibility
   depends on it ([ADR-0019](0019-sign-in-with-chatgpt-route.md)).
2. Whether a later release adds Linux or Windows desktop builds.
