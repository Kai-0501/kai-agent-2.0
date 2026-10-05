# Glossary

| Term | Meaning |
|---|---|
| **Kai Runtime** | The process that owns the workspace (files, git, processes, credentials), the stores, the research browser and all model calls. The macOS app hosts it in an Electron `utilityProcess`; the CLI hosts it in-process. |
| **KSP (Kai Session Protocol)** | The typed JSON-RPC protocol between the runtime and clients, with a `seq`-cursored event stream ([spec](specs/protocol.md)). |
| **Session** | A sequence of tasks in one workspace, with one event log stream. |
| **Task** | One user request and its follow-ups, until a final verdict. It has a state (`open`, `in_progress`, `implemented_unverified`, `verifying`, `verification_failed`, `verified`, `blocked`, `cancelled`). |
| **Turn** | One model request and its response. |
| **Epoch** | A contiguous run of turns sharing one append-only context: one `previous_interaction_id` chain in chained mode. It starts with a **seed** ([ADR-0005](adr/0005-context-compiler-and-epochs.md)). |
| **Seed** | The first request of an epoch, compiled by the Context Compiler under a budget: system, tools, project instructions, epoch brief, repo map, relevant code, directive. |
| **Epoch brief** | The structured, mostly deterministic summary of task state that opens each epoch (objective, plan, decisions, files read and modified, verification, failures, attempts, next action). |
| **Ingress** | Anything appended to an epoch after the seed: shaped tool results, notices, user messages. |
| **Harness notice** | A short `<kai_notice>` message from Kai to the model (stale files, verification results, budgets). |
| **Chained / stateless mode** | Gemini Interactions state modes: server-held history via `previous_interaction_id` (`store: true`), or full client-sent history (`store: false`). Generalized as the `provider_chain` and `local_replay` continuation modes. |
| **Read Ledger** | The record of exactly which source ranges, at which content hashes, the model has seen, per epoch ([spec](specs/read-ledger.md)). |
| **Stub** | A short ledger reply in place of content already visible in the current epoch. |
| **Artifact** | A stored, addressable (`art_xxxxxxxx`) complete tool output. |
| **Result Shaper** | Turns raw tool output into a bounded, parsed summary with excerpts and an artifact reference. |
| **Repo map** | A token-budgeted, signature-only map of the most relevant definitions, ranked by personalized PageRank. |
| **Symbol card** | A deterministic 25–60-token summary of a symbol: name, kind, signature, doc line, location, reference count. |
| **Transaction** | All edit calls of one model response, applied to an overlay, validated together, committed atomically or rejected together. |
| **Overlay** | An in-memory view of proposed file contents, used for validation before anything is written. |
| **Hallucination class** | Findings that almost never represent legitimate intermediate states: unknown identifiers, missing members or exports or modules, wrong arity, parse errors, omission placeholders. These block a transaction. |
| **Promissory symbol** | A symbol the model has declared it will create (`update_plan.new_symbols`). It is treated as existing until the verification gate, where it must exist. |
| **Workspace checkpoint** | A snapshot of the working tree under `refs/kai/checkpoints/...`, made with a private git index. Not the same as an epoch brief. |
| **Verification profile** | Per-project commands and policies for checks (`.kai/project.json`). |
| **Tiers T0–T4** | Apply-level, file-diagnostics, affected checks, targeted tests, and broad tests ([ADR-0009](adr/0009-verification-architecture.md)). |
| **Completion gate** | The verification pipeline triggered by `complete_task`. The only path to `verified`. |
| **Lazy baseline** | Re-running a failing check on the task-start checkpoint to classify failures as introduced, pre-existing or flaky. |
| **Failure fingerprint** | A normalized, line-insensitive hash of a failure (diagnostic, test, firewall, command). |
| **Approach fingerprint** | Touched symbols plus diff shingles of a repair attempt, used to detect "same fix again". |
| **Replan** | A fresh epoch with a replan brief (objective, state, failed approaches, exact failures) and a read-only first turn. |
| **Capability pack** | An optional group of tools (`code_intel`, `api_reality`, `tests`, `vcs`, `research`, `multi_file_patch`) declared only when active. |
| **Reported vs estimated** | Token numbers from the API's usage, vs Kai's own estimates and counterfactuals. Never mixed. |
| **Ablation flag** | A config switch that disables a mechanism, so the benchmark can measure its effect ([ADR-0014](adr/0014-measurement-gated-mechanisms.md)). |
| **Provider adapter** | The wire-protocol layer for one API family: `provider-gemini` (Interactions), `provider-openai` (Responses), `provider-compatible` (Chat Completions, Responses when probed). |
| **Credential route** | How a request is authorized and accounted: `gemini.api_key`, `openai.api_key`, `openai.chatgpt_subscription`, `compat:<endpoint>`. Has a live `RouteState` and a usage class ([credentials](specs/credentials.md)). |
| **Usage class** | `api_metered`, `subscription_allowance`, `local_compute`. Never mixed in totals; subscription usage is never shown as zero cost. |
| **Harness profile** | Model-facing behaviour on the shared runtime: prompts, tool rendering, effort policy, replay, context sizing, critic and stopping policy. `gemini`, `openai`, `generic` ([spec](specs/harness-profiles.md)). |
| **Capability snapshot** | The effective, tri-state (`supported`/`unsupported`/`unknown`) capabilities of one model on one endpoint, route and account, with provenance and a content-derived ID. |
| **Effort intent** | The Governor's canonical effort on the scale `none < minimal < low < medium < high < xhigh`, mapped by the profile to a model's native levels; recorded as requested and applied. |
| **Local replay / provider chain** | Continuation modes: send the whole epoch every request (local replay), or only new items plus a provider handle (provider chain). |
| **Replay item (provider-native)** | An opaque provider item (thought signature, encrypted reasoning, `reasoning_content`) stored verbatim and replayed only to the same provider, route, account and model. |
| **Request preflight** | The check that the complete pending request fits the effective input limit before it is sent ([context compiler](specs/context-compiler.md#request-preflight)). |
| **Derived criteria** | Additional checks the model proposes with `update_plan`; additive only. The user's objective and acceptance criteria are immutable except via `task.amend`. |
| **Review obligation** | A required review (from integrity escalations or user-required triggers) that only a validated critic review or the user can discharge; budgets never discharge it. |
| **Prepared manifest** | The durable record of a multi-file transaction's intended before/after state, committed before any rename, used for crash recovery. |
| **Sign in with ChatGPT (SIWC)** | OpenAI's documented OAuth flow letting eligible ChatGPT plans authorize plan-backed API requests in open-source and local apps ([spec](specs/chatgpt-sign-in.md)). |
| **Host identity** | The opaque, per-installation `ext_agent_host_id` sent at SIWC registration; distinct from the issued OAuth client ID. |
| **Compatible endpoint** | A user-configured hosted or local server speaking an OpenAI-compatible dialect, probed before agent use ([spec](specs/compatible-endpoints.md)). |
| **Chat-only mode** | The limited mode for endpoints without reliable tool calling or with too little context: no autonomous editing. |
| **Project** | A user-named unit of work above tasks; its finalization triggers learning ([learning](specs/learning-service.md#project-lifecycle)). |
| **Evidence packet** | The deterministic, redacted summary of a finalized project generation used for the retrospective. |
| **Retrospective** | The immutable record (and Markdown rendering) of one project reflection. |
| **Skill** | A small, scoped, versioned procedural document learned from projects, with lifecycle `candidate → provisional → validated → retired`. |
| **Learning snapshot** | The set of skill versions eligible for a task, pinned by hash at task start. |
| **Research service** | The runtime service that drives the installed Chrome (app-owned profile, pipe transport, filtering proxy) for `web_search`, `web_open`, `web_find` ([spec](specs/chrome-research.md)). |
| **Source record / citation** | A research source with a stable `src_` ID, provenance and dates; a citation `[src_x Lx-y]` must resolve to an excerpt that was delivered to the model. |
| **Human handoff** | A visible Kai browser window for consent pages, CAPTCHAs or sign-in walls; only the affected research operation pauses. |
| **KAI_HOME** | Kai's app data directory (`~/Library/Application Support/Kai` on macOS) holding the app store, learning store, workspace stores, browser profile and identity. |

