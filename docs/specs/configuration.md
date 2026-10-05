# Spec: Configuration, migration, identifiers and versioning

- Packages: `packages/core` (`config.ts`: schema and defaults), `packages/runtime` (loading, migration, stores)
- Decisions: [ADR-0017](../adr/0017-release-scope-macos-multi-provider.md), [ADR-0018](../adr/0018-providers-routes-profiles-capabilities.md), [ADR-0014](../adr/0014-measurement-gated-mechanisms.md); config keys from [ADR-0015](../adr/0015-user-owned-task-contract.md) and [ADR-0016](../adr/0016-robustness-amendments.md)
- Collaborators: [protocol](protocol.md), [event model](event-model.md), [credentials](credentials.md), [learning](learning-service.md), [Chrome research](chrome-research.md)

## Responsibility

Define where Kai keeps state, how configuration layers combine, how the founding Gemini-only
configuration migrates, how identifiers stay stable, and how config, protocol, database and
event versions evolve without breaking replay.

## Locations (`KAI_HOME`)

`KAI_HOME` defaults to `~/Library/Application Support/Kai` on macOS (shared by the app and the
CLI) and `$XDG_DATA_HOME/kai` elsewhere; overridable with the `KAI_HOME` environment variable
(tests use temp dirs).

| Path | Contents |
|---|---|
| `config.json` | User configuration, schema v2 |
| `app.db` | App store: accounts (SIWC registrations), endpoint probe and capability snapshot caches, OIDC discovery cache, Chrome status, settings migrations |
| `learning/learning.db`, `learning/md/` | Global learning store and its Markdown projection |
| `workspaces/<workspaceId>/kai.db`, `…/blobs/` | Per-workspace session store ([event model](event-model.md)) |
| `identity/host.json` | SIWC host identity |
| `browser/profile-v1/`, `browser/quarantine/` | Research Chrome profile and PDF quarantine |
| `locks/` | Runtime lock, credential refresh locks |
| `logs/` | Structured logs (no secrets, no file contents or prompts at info level) |

Nothing Kai-managed is written into a workspace except the committable `.kai/project.json`
and, in `--worktree` mode, the worktree itself.

## Layers and precedence

Lowest to highest: **built-in defaults → user (`config.json`) → workspace
(`.kai/project.json`) → session/task overrides (KSP) → CLI flags (development and benchmark)**.

Repository content is untrusted, so the workspace layer is **restrict-only** for safety keys:
it may lower or disable, never raise or enable.

| Key class | Workspace layer may | Workspace layer may not |
|---|---|---|
| Verification profile (`verification.*`) | Define it (user-confirmed at discovery) | — (changes by the model are integrity findings) |
| Research (`research.mode`) | Set `off` | Enable it, change domains or proxy ports |
| Learning (`learning.*`) | Disable retrieval or reflection; force `privacy: local_only` | Enable it, widen privacy |
| Routes and endpoints | Restrict to `local_only` routes | Add endpoints, credentials or routes; select a cloud route |
| Context, shaper, governor thresholds | Set within schema bounds | Disable preflight or the gate |
| Command policy | Add `deny`/`ask` rules | Add `allow` rules for deny-by-default classes |

Unknown keys fail validation with the key path and the nearest valid key. Every threshold is a
key; every mechanism has an ablation key ([ADR-0014](../adr/0014-measurement-gated-mechanisms.md)).

**Instruction precedence** (what the model is told, highest first): the user-owned
[Task Contract](task-contract.md) (objective, acceptance criteria, constraints, steering,
amendments) → applicable repository instructions from the
[instruction map](context-compiler.md#project-instructions-instruction-map-and-pre-mutation-gate)
(`instructions.fileNames`, root → leaf, the more specific file wins) → harness notices about
workspace state → learned procedures (advisory). Verification requirements, permissions and integrity policy are enforced
by the runtime regardless of any text.

## Schema v2 (overview)

```jsonc
{
  "schemaVersion": 2,
  "release": { "distribution": "personal_local" },        // build-time in app releases
  "app": { "offline": false, "locale": "en" },
  "defaults": { "routeId": "gemini.api_key", "model": "gemini-3.8-flash" },
  "routes": {
    "gemini.api_key": { "credential": "env:GEMINI_API_KEY", "profile": "gemini",
                        "gemini": { "stateMode": "chained", "serviceTier": "standard", "thinkingSummaries": "none" } },
    "openai.api_key": { "credential": "cred_Q7T1…", "profile": "openai", "openai": { "storeResponses": false } },
    "openai.chatgpt_subscription": { "profile": "openai", "selectedAccount": "acct_3f…" }
  },
  "endpoints": { /* compatible-endpoints.md */ },
  "context": { /* founding ContextBudget keys; profiles scale them */ },
  "verify": { "backgroundT2": true, "maxTargetedTests": 200, "rerunsNow": 4, "baselineRuns": 5,
              "flakyWorseningDelta": 0.4, "flakeHistoryDays": 30 },        // ADR-0016
  "critic": { "mode": "auto", "maxRiskReviewTokens": 60000,                   // risk_review only
              "integrityReviewTokens": 20000, "integrityReview": true },     // reserved, mandatory
  "instructions": { "fileNames": ["AGENTS.md", "KAI.md", "GEMINI.md"] },
  "learning": { /* learning-service.md */ },
  "research": { "mode": "ask_first_use", "queryPrivacy": "strict", "chrome": { "path": null, "minMajor": 136 } }
}
```

### One configuration per route (examples)

**Gemini (API key)** — the migrated founding setup:

```json
{ "defaults": { "routeId": "gemini.api_key", "model": "gemini-3.8-flash" },
  "routes": { "gemini.api_key": { "credential": "env:GEMINI_API_KEY", "profile": "gemini",
    "gemini": { "stateMode": "chained", "serviceTier": "standard", "thinkingSummaries": "none" } } } }
```

**OpenAI (API key)**:

```json
{ "defaults": { "routeId": "openai.api_key", "model": "<model id from provider.models>" },
  "routes": { "openai.api_key": { "credential": "cred_Q7T1…", "profile": "openai",
    "openai": { "storeResponses": false, "allowXhighReplan": false } } } }
```

**ChatGPT plan (subscription)** — no secret in config; tokens are in the Keychain:

```json
{ "release": { "distribution": "personal_local" },
  "defaults": { "routeId": "openai.chatgpt_subscription", "model": "<slug from the account catalog>" },
  "routes": { "openai.chatgpt_subscription": { "profile": "openai", "selectedAccount": "acct_3f…" } } }
```

**Local compatible endpoint** and **hosted compatible endpoint**: see
[compatible-endpoints](compatible-endpoints.md#configuration) (`compat:lmstudio-local`,
`compat:openrouter`).

## Migration from the Gemini-only config

The founding config (`~/.config/kai/config.json`, implicit schema v1, shape of the founding
`KaiConfig`) migrates to v2 on first start of a v2 runtime:

| v1 key | v2 key |
|---|---|
| `gemini.model` | `defaults.model`; `defaults.routeId = "gemini.api_key"` |
| `gemini.stateMode`, `gemini.serviceTier`, `gemini.thinkingSummaries` | `routes["gemini.api_key"].gemini.*` |
| (implicit) API key from `GEMINI_API_KEY` / keychain | `routes["gemini.api_key"].credential = "env:GEMINI_API_KEY"` (or the existing keychain item's `CredentialRef`) |
| `context.*`, `ledger.*`, `shaper.*`, `readFile.*`, `firewall.*`, `repair.*`, `tools.*`, `shell.*` | unchanged paths; new `context.*` keys ([ADR-0016](../adr/0016-robustness-amendments.md): `ingressBatchMax`, `preflightMarginMin`, `contractMaxTokens`, `instructionsMax`; ADR-0018: `safetyMargin`, `elisionBatchTokens`) added with defaults |
| `critic.mode` | unchanged; now governs the optional `risk_review` only |
| `critic.maxTokensPerTask` | `critic.maxRiskReviewTokens` (same value); `critic.integrityReviewTokens` and `critic.integrityReview` added with defaults |
| `verify.backgroundT2`, `verify.maxTargetedTests` | unchanged |
| `verify.flakyReruns` | **dropped** (a pass on rerun is not evidence; ADR-0016). `verify.rerunsNow`, `verify.baselineRuns`, `verify.flakyWorseningDelta`, `verify.flakeHistoryDays` added with defaults; `keysMoved` records the drop |
| (new) | `instructions.fileNames` with its default |
| `governor.mode` | unchanged; `fixed:<level>` values map to the canonical effort scale |
| (new) | `learning.*`, `research.*`, `endpoints`, `release`, `app` with defaults |

Procedure: read v1 → validate with the v1 schema → pure `migrateConfig(v1) → v2` → validate v2 →
write `config.json` via temp + rename → keep `config.v1.json.bak` → append `ConfigMigrated
{from: 1, to: 2, keysMoved}` to the app store. The function is idempotent (a v2 file is
returned unchanged). Workspace `.kai/project.json` files keep their v1 verification profile
(`version: 1`), which v2 reads as is.

Existing workspace stores need no event rewrite: new events are added; existing events keep
their payload versions and are read through upcasters.

## Stable identifiers

All IDs are app-owned and never reused ([event model](event-model.md#identifiers)). New:

| ID | Format | Stability |
|---|---|---|
| `ProjectId` | `prj_` + ULID | per project |
| `RouteId` | `gemini.api_key`, `openai.api_key`, `openai.chatgpt_subscription`, `compat:<endpointId>` | stable names |
| `EndpointId` | user slug `^[a-z0-9][a-z0-9-]{0,39}$` | renaming creates a new endpoint and invalidates probes |
| `ProfileId` | `gemini` / `openai` / `generic` + `@semver` in requests | versioned |
| `CapabilitySnapshotId` | `cap_` + 16 hex of the snapshot hash | content-derived |
| `CredentialRef` | `cred_` + 16 base32 | per stored credential |
| `AccountKey` | `acct_` + 16 hex of `sha256(sub ‖ workspace?)` | per ChatGPT account |
| `SkillId` / `RetroId` / `LearningJobId` | `skl_`/`ret_` + ULID; `lj_` + 24 hex (derived) | per record; job IDs deterministic |
| `SourceId` | `src_` + 8 base32 | per (task, canonical URL) |
| `ResearchOpId` | `rop_` + ULID | per research tool call |
| `RepoFingerprint` | `rf_` + 8 hex | per repository (root commit + canonical remote) |

## Versioning and downgrade

| Artifact | Version | Rule |
|---|---|---|
| Config | `schemaVersion` (2) | Forward migrations only; an older runtime refuses a newer config with `CONFIG_INVALID {newer}` and offers read-only mode |
| KSP | `PROTOCOL_VERSION` 0.2.0 | Pre-1.0: a minor bump may break; the runtime accepts the current and the previous minor; capabilities gate features ([protocol](protocol.md#versioning)) |
| SQLite stores | `schema_meta (version, min_reader, min_writer)` per store | A runtime whose version < `min_writer` opens the store **read-only**: it can show history, reports and artifacts, but appends nothing; it never runs migrations backwards |
| Event payloads | `v` per event type | Upcasters on read; stored events never rewritten. Unknown event types are shown generically and skipped by projections of older runtimes (read-only mode) |
| Learning records | `kai: skill/v1`, `retrospective/v1`, `packetVersion` | Same rules; Markdown frontmatter carries the version |
| Provider adapters, profiles, SERP adapter | semver | Pinned in `ModelRequest` / research events |

**Reproducibility pins** in every `ModelRequest`: `adapterVersion`, `routeId`, `accountScope?`,
`profileId@version`, `promptHash`, `declarationsHash`, `capabilitySnapshotId`,
`learningSnapshotHash`, `inputBlob`, `generationConfig` (as sent, after allowlisting).

## Acceptance tests

1. **Gemini-only still works after migration:** a founding v1 config with `GEMINI_API_KEY` set
   migrates to v2; the `ts-small` fixture task runs with the fake Gemini transport and produces
   the same seed bytes as the founding v1 code path for the same state; a second start leaves the
   file unchanged.
2. Unknown keys and inline secrets fail validation with the key path.
3. Restrict-only: a workspace `.kai/project.json` that sets `research.mode: "enabled"`,
   adds an endpoint or adds an `allow` rule for `git push` is rejected for those keys with a
   message; `research.mode: "off"` is applied.
4. Downgrade: a store with `min_writer` above the runtime's version opens read-only; appends
   are refused with a typed error; reports still render.
5. Every `ModelRequest` in the Phase 1 and Phase 7 fixtures contains all reproducibility pins.
