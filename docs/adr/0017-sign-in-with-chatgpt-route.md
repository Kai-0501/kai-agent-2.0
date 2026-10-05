# ADR-0017: Sign in with ChatGPT as an explicit credential route

- Status: Proposed
- Date: 2026-10-05
- Related: [specs/chatgpt-sign-in.md](../specs/chatgpt-sign-in.md), [specs/credentials.md](../specs/credentials.md), [specs/openai-responses-provider.md](../specs/openai-responses-provider.md), [research/extension-2026-10.md §2](../research/extension-2026-10.md#2-sign-in-with-chatgpt-for-open-source-and-local-apps-r2r10)

## Context / problem

Users with an eligible ChatGPT plan want Kai to run on that plan instead of a metered API key.
OpenAI documents a self-serve flow for open-source and locally running apps: dynamic agent
registration, OAuth with PKCE and OIDC, plan-usage scopes, and inference at
`api.openai.com/v1/responses` with preview limitations. Other tools reach the same capability by
reusing another application's OAuth client ID and calling private ChatGPT backend routes.

## Considered alternatives

1. **Reuse an existing app's client ID and a private backend route** (observed in OpenCode).
   Rejected: it impersonates another application and depends on undocumented routes.
2. **Scrape or automate the ChatGPT website.** Rejected outright.
3. **API keys only.** Simple, but ignores a documented, supported route.
4. **The documented open-source SIWC flow as a separate credential route** (chosen).

## Decision

- **Route:** `openai.chatgpt_subscription`, separate from `openai.api_key`. Both use the
  `provider-openai` adapter and the `openai` profile; the request builder and capability
  snapshot differ per route.
- **Eligibility gate:** the route is enabled only when `release.distribution` is
  `personal_local` (the default for source builds), `open_source` (requires an owner-chosen
  open-source licence; not set by this ticket) or `commercial_approved` (requires an
  OpenAI-issued client registration recorded in config). Kai currently assumes **personal local
  use only**. No licence is changed on the owner's behalf.
- **Identity:** a stable, opaque **host identity** (`ext_agent_host_id`) is generated once per
  installation and persisted before the first sign-in. It is distinct from any OAuth client
  registration and contains no user data.
- **Registration:** first sign-in for an account uses `client_id=dynamic_agent_client` with
  `agent_name_hint="Kai"` and the host identity. The **issued** client ID from the callback is
  persisted with the account before the code exchange and reused for refresh, revocation and
  later sign-ins to that account.
- **Authorization:** authorization code flow, PKCE `S256`, fresh `state`, `nonce` and verifier
  per attempt, a 10-minute attempt expiry, and an exact `http://127.0.0.1:<port>/callback`
  redirect served by the runtime. The browser step uses the user's default browser, never Kai's
  automated Chrome research profile.
- **Consent is two-part:** identity (`openid profile email`) and plan usage
  (`offline_access resource.invoke chatgpt.tokens.use.direct`, `resource=https://api.openai.com/v1`).
  Inference is enabled only if the **granted** scope contains `chatgpt.tokens.use.direct`.
  Identity alone authorizes nothing. Plan usage does not import ChatGPT conversations,
  memories or account context.
- **Validation:** the ID token's signature (JWKS from discovery, asymmetric algorithms only),
  issuer, audience (the issued client ID), expiry and nonce are checked before the account is
  accepted.
- **Storage:** tokens live only in the runtime's `CredentialStore` (macOS Keychain). KSP
  messages, events, logs and renderer state carry an opaque credential reference and a
  route state, never token material.
- **Refresh:** single-flight per account, across processes. Rotated refresh tokens are persisted
  before the new access token is used.
- **Sign-out:** stop requests, attempt revocation, clear tokens, keep the host identity and the
  account→client mapping. If revocation cannot be confirmed, the UI says so.
- **Quota:** plan usage is reported as its own usage class. On
  `subscription_sharing_usage_limit_exceeded` Kai pauses the task with state intact and offers an
  explicit route switch or a later resume. It never switches routes, never manufactures a reset
  time and never treats plan usage as zero resource use.

## Rationale

The documented flow gives Kai a supported, revocable, per-installation registration and keeps
billing explicit. Treating the subscription as a credential route, not a model or a profile,
keeps the preview's request limits contained in one builder and makes the route switchable at
safe boundaries.

## Consequences

- The runtime hosts a short-lived loopback HTTP listener during sign-in.
- Live auth tests need a real eligible account and run only in a gated suite; they are not part
  of CI and are never reported as passing without that environment.
- Open questions O1–O9 in the research note each have a bounded contract test; until resolved,
  the conservative defaults listed there apply.

## Unresolved questions

1. Whether a commercial or paid Kai distribution will be approved by OpenAI (owner action).
2. Exact branding assets (logo files) from the quickstart page, to be retrieved during Phase 11.
