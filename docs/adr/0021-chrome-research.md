# ADR-0021: Provider-independent research through the installed Google Chrome

- Status: Proposed
- Date: 2026-10-05
- Related: [specs/chrome-research.md](../specs/chrome-research.md), [ADR-0012](0012-tool-surface-and-dynamic-exposure.md), [research/extension-2026-10.md §3–4](../research/extension-2026-10.md#4-chrome-automation-r13r16)
- Supersedes: the `research` capability pack of ADR-0012 (Gemini built-in `google_search`,
  `url_context`, and `web_fetch`)

## Context / problem

Kai needs current information (release notes, exact-version docs, error reports) for all three
profiles. The product requirement is to use the user's installed Google Chrome, without a paid
search API, a hosted browser, a model-native web tool or a bundled Chromium. Chrome must not be
required for ordinary coding.

## Considered alternatives

1. **Model-native search** (Gemini `google_search`, OpenAI `web_search`). Different per
   provider, unavailable on compatible endpoints, and not inspectable by Kai's shaper.
2. **A paid search API.** Excluded by the requirement.
3. **Attach to the user's running Chrome.** Chrome 136 refuses remote debugging on the default
   data directory, and taking over the user's profile would expose their cookies.
4. **Raw CDP over a pipe.** Minimal dependencies, but Kai would reimplement target management,
   navigation waiting, locators, accessibility snapshots, request routing and download control.
5. **`playwright-core` driving the installed Chrome with an app-owned profile, over the pipe
   transport, in a separate research worker process** (chosen).

## Decision

- **Transport:** `playwright-core` `chromium.launchPersistentContext(<KAI_HOME>/browser/profile-v1,
  {executablePath: <validated Chrome>, headless: true})`. Playwright launches persistent
  contexts with `--remote-debugging-pipe`, so no TCP debugging port exists. Kai never points at
  Chrome's default user data directory and never attaches to, terminates or reads the user's
  everyday Chrome.
- **Process:** a dedicated research worker process owned by the runtime holds the browser.
  Crashes are contained; the worker is restartable and killed with its process group on
  shutdown.
- **Discovery:** standard and user-selected macOS locations, validated by bundle ID, code
  signature and minimum version. Chrome absent or invalid gives a typed unavailable state;
  everything else in Kai keeps working.
- **Tools:** a three-tool `research` pack (`web_search`, `web_open`, `web_find`) shared by all
  profiles, results shaped and stored as artifacts, with stable source IDs and excerpt
  locations for citations.
- **Search engine:** Google public search in Chrome as the first `SearchEngineAdapter`. SERP
  parsing is engine-specific, uses semantic locators and versioned fixtures, and returns typed
  outcomes. A parse failure is never reported as "no results".
- **Isolation:** all browser traffic goes through a runtime-owned filtering proxy on loopback
  (per-launch credentials) that resolves DNS itself, refuses private, loopback, link-local and
  metadata addresses, and connects to the address it checked. Non-HTTP(S) schemes, downloads
  (other than bounded PDF retrieval into quarantine) and QUIC are blocked. Browser cookies,
  tokens and profile contents never reach logs, KSP or model input.
- **Human handoff:** consent pages, sign-in walls and CAPTCHAs pause only the affected research
  operation and offer a visible Kai browser window. No automated bypass and no endless retries.
- **Policy:** research is enabled once per installation by the user; routine queries then need
  no per-query approval. Offline mode forbids browsing. Research is read-oriented: no purchases,
  posts, logins to arbitrary accounts, or downloaded programs.
- **Trust:** web content is untrusted data in a dedicated wrapper. It cannot change objectives
  or permissions and cannot become a global lesson.

## Rationale

The installed Chrome renders the real web, including script-heavy documentation sites, and
needs no paid service. Playwright supplies the hard parts (navigation, locators, routing,
downloads) over a non-network transport. A filtering proxy closes the DNS-rebinding race that
request interception alone cannot.

## Consequences

- New dependency: `playwright-core` (Apache-2.0), pinned and upgraded only with the
  installed-Chrome smoke suite. Readability and PDF extraction libraries are recorded in
  `THIRD_PARTY_NOTICES.md` when vendored.
- Research operations, budgets and outcomes are events and telemetry; research tokens count in
  project resource totals.
- An installed-Chrome smoke suite on macOS is a release gate; Linux CI uses offline fixtures.

## Unresolved questions

1. Whether a separate fresh-context "research digest" call saves enough main-context tokens to
   justify its cost. Not in R1; it is a benchmark ablation.
2. Google SERP markup stability and blocking rates under normal research volume (measured by
   the smoke suite and telemetry).
