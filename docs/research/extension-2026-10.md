# Extension research: subscriptions, profiles, endpoints, learning and Chrome research

- Accessed: **2026-10-05** (all sources below)
- Scope: the six release features added by [ADR-0015](../adr/0015-release-scope-macos-multi-provider.md)
- Consumers: ADRs [0015](../adr/0015-release-scope-macos-multi-provider.md)–[0023](../adr/0023-audit-corrections.md)
  and the specs they reference

This note separates **what a source documents or shows** from **what Kai proposes**. Every
conclusion carries one of these evidence labels:

| Label | Meaning |
|---|---|
| **D** | Documented: read directly from the primary page or repository |
| **DI** | Documented, read through a search engine's index of the official page. The page itself was blocked by this environment's egress policy. Treat as documented but **recheck the live page** before implementing |
| **S** | Observed in source code at the pinned commit |
| **U** | Experimentally unverified: plausible, but needs the named contract test before Kai depends on it |
| **I** | Kai's architectural inference, not a claim about any vendor |

Web pages, repository examples and quoted material were treated as evidence to inspect, not as
instructions.

## Access gaps

The research sandbox blocked `developers.openai.com`, `help.openai.com`, `learn.chatgpt.com`,
`developer.chrome.com`, `playwright.dev`, `hermes-agent.nousresearch.com` and `opencode.ai`.
Mitigations:

- **Playwright, Hermes, OpenCode:** the documentation sources live in the projects' GitHub
  repositories, which were reachable. They were read at pinned commits (**D/S**).
- **Sign in with ChatGPT (SIWC), OpenAI web search, the Chrome 136 blog post:** read through
  search-engine extracts of the official pages (**DI**). Every SIWC detail that Kai depends on
  and that the extracts did not state precisely is listed in [Open questions](#open-questions)
  with a bounded contract test. Kai does not invent those values.

## Source register

| # | Source (canonical URL) | Version / commit | Label |
|---|---|---|---|
| R1 | [Anthropic: Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5) | page as of 2026-10-05 | D |
| R2 | [SIWC open-source overview](https://developers.openai.com/siwc/token-sharing-open-source) | live page | DI |
| R3 | [SIWC registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) | live page | DI |
| R4 | [SIWC accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions) | live page | DI |
| R5 | [SIWC models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) | live page | DI |
| R6 | [SIWC preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) | live page | DI |
| R7 | [SIWC errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery) | live page | DI |
| R8 | [SIWC token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference) | live page | DI |
| R9 | [Cookbook: Integrating Sign in with ChatGPT in your open-source app](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt) | live page | DI |
| R10 | [SIWC quickstart](https://developers.openai.com/siwc/quickstart) (branding, labels) | live page | DI |
| R11 | [Sign in with ChatGPT terms](https://openai.com/policies/sign-in-with-chatgpt-terms/) | not retrieved | gap |
| R12 | [OpenAI: Web search tool](https://developers.openai.com/api/docs/guides/tools-web-search) | live page | DI |
| R13 | [Chrome: Changes to remote debugging switches](https://developer.chrome.com/blog/remote-debugging-port) | published 2025-03-17 | DI |
| R14 | [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/); pipe transport in [`devtools_pipe.h`](https://chromium.googlesource.com/chromium/src/+/main/components/devtools/devtools_pipe/devtools_pipe.h) | main | DI |
| R15 | Playwright [`docs/src/browsers.md`](https://github.com/microsoft/playwright/blob/66096ef78a256261037cba207e27a1c9735acf4c/docs/src/browsers.md) and [`docs/src/api/class-browsertype.md`](https://github.com/microsoft/playwright/blob/66096ef78a256261037cba207e27a1c9735acf4c/docs/src/api/class-browsertype.md) (sources of playwright.dev [browsers](https://playwright.dev/docs/browsers) and [BrowserType](https://playwright.dev/docs/api/class-browsertype)) | `66096ef7` (2026-10-05), `playwright-core` 1.64.0-next | D |
| R16 | Playwright [`server/chromium/chromium.ts`](https://github.com/microsoft/playwright/blob/66096ef78a256261037cba207e27a1c9735acf4c/packages/playwright-core/src/server/chromium/chromium.ts#L357-L358), [`server/registry/index.ts`](https://github.com/microsoft/playwright/blob/66096ef78a256261037cba207e27a1c9735acf4c/packages/playwright-core/src/server/registry/index.ts#L601) | `66096ef7` | S |
| R17 | Hermes Agent [`features/skills.md`](https://github.com/NousResearch/hermes-agent/blob/7157422022ff06f3e632d1dd394ee1253b17ad37/website/docs/user-guide/features/skills.md) (source of [hermes skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/)) | `71574220` (2026-10-05) | D |
| R18 | Hermes Agent [`features/memory.md`](https://github.com/NousResearch/hermes-agent/blob/7157422022ff06f3e632d1dd394ee1253b17ad37/website/docs/user-guide/features/memory.md) (source of [hermes memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/)) and [`features/curator.md`](https://github.com/NousResearch/hermes-agent/blob/7157422022ff06f3e632d1dd394ee1253b17ad37/website/docs/user-guide/features/curator.md) | `71574220` | D |
| R19 | OpenCode [`docs/providers.mdx`](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/web/src/content/docs/providers.mdx) and [`docs/skills.mdx`](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/web/src/content/docs/skills.mdx) (sources of [opencode providers](https://opencode.ai/docs/providers) and [skills](https://opencode.ai/docs/skills)) | `907b3bc5` (2026-10-02, default-branch head on 2026-10-05) | D |
| R20 | OpenCode [`plugin/openai/codex.ts`](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/opencode/src/plugin/openai/codex.ts#L10-L13) | `907b3bc5` | S |
| R21 | [OpenCode v2 providers](https://opencode.ai/v2/docs/providers) | not retrievable; no v2 docs directory at `907b3bc5` | gap |

## 1. Prompting Claude Opus 5.5 (R1)

Relevant because an Opus-class agent implements this design, and because the guide documents
harness patterns that also apply to Kai's own loop.

| Finding | Label | Consequence for Kai |
|---|---|---|
| Effort is the main reasoning control; level names do not mean the same amount of thinking across models; test levels against evals instead of carrying values over | D | Kai's canonical effort must not be a universal enum. Profiles map intent to each model's native levels, and the benchmark calibrates per model ([ADR-0016](../adr/0016-providers-routes-profiles-capabilities.md)) |
| Changing top-level effort between requests invalidates the prompt cache; per-message effort keeps it | D | Effort changes are a cache-relevant event. Profiles declare whether native effort changes are cache-safe; the Governor batches changes (I) |
| Treat a text-only end of turn as a report, not proof of completion; keep a checklist; continue at most two or three times automatically | D | Matches Kai's "no tool call" notice and the two-text-turn `blocked` rule. Kai keeps completion tied to the Verification Engine |
| Mark pasted text with ID-tagged blocks; tool results and web pages are injection vectors | D | Same channel discipline as Kai's `<kai_notice>`. Web content gets its own untrusted wrapper ([chrome-research](../specs/chrome-research.md)) |
| "Once you have answered something, treat that answer as done" reduces re-examination, but can suppress self-correction; leave it out where later steps can reveal mistakes | D | The OpenAI profile's stopping policy names exactly what is settled and what reopens it, instead of a blanket "don't revisit" rule ([harness-profiles](../specs/harness-profiles.md)) |

## 2. Sign in with ChatGPT for open-source and local apps (R2–R10)

### Observed contract

| Topic | What the sources say | Label |
|---|---|---|
| Eligibility | Plan usage is available to **open-source projects, personal projects that run locally, and selected private apps**. Commercial or remotely hosted apps are in a limited trial and request a client ID through an interest form. Identity-only sign-in is offered to selected commercial partners | DI |
| Privacy | The external app receives name, email and profile picture for identity. Subscription sharing does **not** give access to ChatGPT conversations or memory | DI |
| Host identity | Choose and persist a stable `ext_agent_host_id` per host **before the first sign-in**. It must be opaque, not an email or user ID | DI |
| First registration | `client_id=dynamic_agent_client`, plus `ext_agent_host_id` and `agent_name_hint` (the app's real name). `dynamic_agent_client` is the registration entry point, **not** the client ID to save or use for token exchange | DI |
| Issued client | The callback returns the issued `client_id`. Save it with the registration for that ChatGPT account **before exchanging the code**, and reuse it for later sign-ins to the same account | DI |
| Redirect | Loopback redirect on `127.0.0.1`. No client secret | DI |
| Attempt security | PKCE `S256` (challenge in the URL, verifier only in the token request); fresh `state`, OIDC `nonce` and verifier **per attempt**; validate the ID token before accepting the profile | DI |
| Endpoints | Issuer `https://auth.openai.com`; authorize `https://auth.openai.com/api/accounts/authorize`; token `https://auth.openai.com/api/accounts/oauth/token`; discovery at `/.well-known/openid-configuration` (gives the JWKS and `revocation_endpoint`) | DI |
| Scopes | Identity: `openid profile email`. Plan usage: `offline_access resource.invoke chatgpt.tokens.use.direct`, with `resource=https://api.openai.com/v1` | DI |
| Token response | `access_token`, `refresh_token`, `id_token`, `token_type`, `expires_in`, `scope`, `earliest_refresh_at`. Check the **granted** `scope` for `chatgpt.tokens.use.direct` before inference. Access tokens carry `sub` and `aud` (`https://api.openai.com/v1`) | DI |
| Refresh | Standard refresh near expiry: form POST `grant_type=refresh_token`, the **issued** `client_id`, the refresh token and `resource=https://api.openai.com/v1`; omit `scope` to keep the grant. **Serialize refreshes per session** | DI |
| Sign-out | Stop requests; try to revoke the renewable session at `revocation_endpoint` (form POST `token=<refresh>`, `token_type_hint=refresh_token`, issued `client_id`); empty HTTP 200 means success, also for an already-invalid token; then clear access, refresh and ID tokens. Keep the account→client mapping and the host ID | DI |
| Model catalog | Request the selected account's catalog with the same access token from the models endpoint, keep entries with `visibility` = `list`, show `display_name`, send `slug` as `model` | DI |
| Inference | `POST https://api.openai.com/v1/responses` with the OAuth bearer token. HTTP requests **must** set `store: false` and `stream: true`. Send the needed context in `input` each time; use `instructions` or developer messages, because explicit `system` items are rejected | DI |
| Omitted fields | `background`, `conversation`, `max_output_tokens`, `max_tool_calls`, `metadata`, `moderation`, `multi_agent`, `prompt`, `prompt_cache_retention`, `safety_identifier`, `temperature`, `top_logprobs`, `top_p`, `truncation`, `user`; and `previous_response_id` over HTTP | DI |
| Tools | Function and custom tools work top-level, in namespaces, or through `additional_tools` input items. `web_search` works and returns sources. Not supported: image generation, file search, Code Interpreter, native computer use, hosted MCP/connectors, Responses `tool_search`; `programmatic_tool_calling` is not accepted top-level | DI |
| Quota | `429 subscription_sharing_usage_limit_exceeded`: pause plan-backed requests and link to ChatGPT Settings → Usage. Do **not** assume the whole plan is empty or infer a reset time, because an app-specific limit can apply. `503 subscription_sharing_usage_unavailable`: availability could not be checked | DI |
| Branding | Button label "Continue with ChatGPT" (or "Sign in with ChatGPT"), placed with other sign-in options; logo assets on the quickstart page | DI (assets not retrieved) |

### Changes from the ticket's description

- The ticket summarized the HTTP route as using "store and stream". The current documentation
  requires **`store: false`** with **`stream: true`**. The request builder follows the current
  documentation ([openai-responses-provider](../specs/openai-responses-provider.md)).
- The documentation adds two constraints the ticket did not list: explicit `system` input items
  are rejected (Kai sends its system prompt as `instructions`), and an app-specific limit can
  cause the quota error even when the plan has allowance left (Kai never shows a reset time it
  cannot know).

### Kai's distribution status (I)

The repository has **no licence** (README: "To be decided by the repository owner"). Under the
documented eligibility:

- **Personal local use by the owner** fits "personal projects that run locally". This is the
  only route Kai assumes today.
- **Public open-source distribution** requires the owner to choose an open-source licence. This
  ticket does not change the licence.
- **A paid or hosted version** requires OpenAI's approval through the interest form. It is not
  assumed.

The route is gated by a `release.distribution` setting so a build cannot silently enable the
subscription route for an ineligible distribution ([ADR-0017](../adr/0017-sign-in-with-chatgpt-route.md)).

### What Kai must not copy

OpenCode's ChatGPT login (R20) sends the **Codex CLI's OAuth client ID**, uses
`http://localhost:1455/auth/callback`, requests `openid profile email offline_access`, and calls
`https://chatgpt.com/backend-api/codex/responses` (**S**). That is another application's client
registration and a private backend route. Kai uses only the documented open-source flow above:
its own dynamic registration, a `127.0.0.1` redirect, and `api.openai.com/v1/responses`.

## 3. OpenAI web search as a capability reference (R12)

| Observable capability | Label | Kai counterpart (own design, not a claim about ChatGPT internals) |
|---|---|---|
| Agentic search where the model decides whether to keep searching | DI | The model calls `web_search` within research budgets |
| `web_search_call.action` is `search`, `open_page` or `find_in_page`; the last two in reasoning models | DI | `web_search`, `web_open`, `web_find` |
| `filters.allowed_domains` / `blocked_domains` (up to 100, no scheme, subdomains included) | DI | `site` argument and research-policy domain lists |
| `sources` lists every URL consulted; `url_citation` annotations carry URL, title and location | DI | Source records with stable IDs; citations point to retrieved excerpt ranges |

## 4. Chrome automation (R13–R16)

| Finding | Label |
|---|---|
| From **Chrome 136**, `--remote-debugging-port` and `--remote-debugging-pipe` are ignored for the **default** data directory. They must be combined with `--user-data-dir` pointing to a non-default directory. Motivation: cookie theft through remote debugging; a non-default directory uses a different encryption key. Google recommends Chrome for Testing for automation | DI |
| Playwright drives branded Chrome through `channel: "chrome"` (Stable and Beta supported by the current Playwright version) or `executablePath`; it does not install Chrome by default; enterprise policies may block control | D (R15) |
| Branded Chrome uses the **new headless** mode, which behaves like headed Chrome; this differs from the headless shell Playwright uses by default | D (R15) |
| `launchPersistentContext(userDataDir)`: browsers refuse two instances on the same directory. "Automating the default Chrome user profile is not supported"; use a separate directory | D (R15) |
| Playwright launches persistent contexts with `--user-data-dir=<dir>` and **`--remote-debugging-pipe`**, so no TCP debugging port is opened | S (R16 L357–358) |
| Playwright's default macOS path for the `chrome` channel is `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` | S (R16 L601) |
| The DevTools pipe passes file descriptors to the browser; it is not reachable from the network | DI (R14) |

**Decision input (I):** `playwright-core` with the installed Chrome, an app-owned profile
directory and the pipe transport gives Kai semantic locators, accessibility snapshots, request
routing and download control without writing a CDP client. Raw CDP would save one dependency but
not simplify the required operations ([ADR-0021](../adr/0021-chrome-research.md)).

## 5. Hermes procedural learning (R17–R18)

| Mechanism | Detail | Label |
|---|---|---|
| Skills as procedural memory | `SKILL.md` with YAML frontmatter (`name`, `description`, `version`, `platforms`, `metadata.hermes.{tags, category, requires_toolsets, fallback_for_toolsets}`); body sections *When to Use, Procedure, Pitfalls, Verification* | D |
| Progressive disclosure | Level 0 `skills_list()` (~3k tokens of names and descriptions), level 1 `skill_view(name)`, level 2 reference files | D |
| Agent-written skills | The agent creates and patches skills with `skill_manage` after non-trivial workflows, dead ends, or user corrections. "Lessons, not logs": a rule plus one clause of why; no incident narration | D |
| Background review | After a turn (by nudge intervals), a forked review replays the conversation (warm cache on the same model) or a **digest** on a cheaper model, and writes memory or skills. Capped by `max_input_tokens` (default 75% of the review model's window, max 600k). Can be disabled | D |
| Write approval | Off by default; when on, writes are staged for approve or reject | D |
| Memory | `MEMORY.md` (2,200 chars) and `USER.md` (1,375 chars), injected as a **frozen snapshot** at session start to keep the prefix cache stable | D |
| Curator | Deterministic `active → stale (14 d) → archived (30 d)` transitions; optional LLM consolidation; backups; an append-only audit ledger with per-mutation rollback; never auto-deletes | D |

**What Kai adopts (I):** skills as small procedural documents, "lessons, not logs", frozen
snapshots for cache stability, staleness and archival, an audit ledger with rollback, and an
explicit evidence bar for writes.

**What Kai changes (I):**
1. **No conversation replay for reflection.** Hermes replays the conversation or a digest of it.
   Kai builds a deterministic **evidence packet** from events and projections and reads
   artifacts selectively. That is the only way reflection stays cheap relative to the project.
2. **Project boundary, not turn boundary.** Kai reflects once per finalized project, so lessons
   are judged on verified outcomes, not on in-progress turns.
3. **Outcome-gated promotion.** Hermes writes freely by default. Kai lets low-impact lessons in
   without popups, but only as *provisional* and scoped. Promotion to *validated* needs repeated
   non-inferior outcomes, and policy-class lessons (checks, permissions, integrity) are never
   automatic.
4. **No mandatory index in every turn.** Kai retrieves at most 3 cards under a hard budget,
   deterministically, instead of listing all skills.

## 6. OpenCode baseline (R19–R20)

| Capability | OpenCode at `907b3bc5` | Label |
|---|---|---|
| Custom OpenAI-compatible providers | `provider.<id>` with `npm: "@ai-sdk/openai-compatible"`, `options.baseURL`, per-model `limit.context` / `limit.output`; local servers such as llama.cpp, LM Studio, Ollama | D |
| ChatGPT plan login | `/connect` → "ChatGPT Plus/Pro" opens a browser login; see §2 for the route it uses | D, S |
| Skills | `SKILL.md` folders discovered in `.opencode/skills`, `.claude/skills`, `.agents/skills` (project and global); loaded on demand by a `skill` tool; frontmatter `name`, `description`, `license`, `compatibility`, `metadata` | D |
| Learning loop | None documented: skills are authored, not learned from outcomes | D (absence in docs) |
| Verification | Post-write LSP diagnostics only (see [upstream/opencode.md](upstream/opencode.md)) | S |

**Consequence (I):** custom endpoints and skills are table stakes, not differentiation. Kai's
falsifiable claims are about verified completion, invented-API prevention, repair cycles,
inspectable replay and measured procedural savings
([harness-profiles §Comparison](../specs/harness-profiles.md#comparison-with-opencode)). The
benchmark adds an OpenCode arm where feasible ([benchmark plan](../evaluation/benchmark-plan.md)).

## 7. Desktop packaging (I)

No external source was required. The decision in [ADR-0022](../adr/0022-macos-desktop-shell.md)
rests on the repository's own constraints: a Node/TypeScript runtime ([ADR-0001](../adr/0001-implementation-language-runtime.md)),
native SQLite bindings, a KSP boundary ([ADR-0002](../adr/0002-runtime-client-boundary.md)),
and no Rust or Swift code today. Electron's bundled Node version, its hardened-runtime
entitlements and its `utilityProcess` behaviour are listed as items to verify when Phase 11
starts.

## Open questions

Each has a bounded test. Until the test passes, the dependent feature uses the conservative
default shown.

| ID | Question | Test | Default until answered |
|---|---|---|---|
| **O1** | Is an ephemeral loopback port accepted in `redirect_uri` for the dynamic registration, or must the port be fixed? | Live auth suite: two sign-ins with different ephemeral ports | Ephemeral port; if rejected, a fixed configurable port with a collision error |
| **O2** | Exact callback parameter name of the issued client ID, and the ID token's `aud` value (issued client ID expected) | Live auth suite: record the callback query keys and the decoded ID token claims (no token values logged) | Reject the sign-in if the issued client ID is missing or `aud` does not contain it |
| **O3** | Which claim identifies the ChatGPT account and workspace (third-party code reads `https://api.openai.com/auth` → `chatgpt_account_id`; not confirmed in the official extracts) | Live auth suite: claim inventory | Account key = `sub` + workspace claim if present; otherwise `sub` alone, labelled "workspace unknown" |
| **O4** | Exact models endpoint path and parameters for the plan catalog | Live auth suite: list models | `GET https://api.openai.com/v1/models`; keep entries with `visibility == "list"`; fail visibly on an unexpected shape |
| **O5** | Is `include: ["reasoning.encrypted_content"]` accepted on the subscription route, and must reasoning items be replayed? | Live inference suite: two-turn tool loop with and without replayed reasoning items | Request encrypted reasoning; if rejected, replay without it and record `reasoningReplay: "unsupported"` |
| **O6** | Which tool packaging does the subscription route accept for Kai's function tools: top-level, one namespace, or `additional_tools` items? | Live inference suite: one call per packaging | Top-level functions; fall back to one `kai` namespace on a schema error |
| **O7** | Do assistant message items carry a `phase` field that must be replayed? | Live inference suite: inspect output items | Replay output items verbatim, including unknown fields |
| **O8** | Are `prompt_cache_key` and `parallel_tool_calls` accepted on the subscription route? | Live inference suite | Omit both (allowlist builder) |
| **O9** | Exact terms text for distribution and paid versions (R11 not retrieved) | Owner reads the terms before any public release | Personal local use only |
| **O10** | Chrome code-signing Team ID and minimum supported Chrome version for the pinned Playwright | Installed-Chrome smoke suite on macOS | Accept bundle ID `com.google.Chrome` with a valid Apple signature and version ≥ 136 |
