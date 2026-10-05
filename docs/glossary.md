# Glossary

| Term | Meaning |
|---|---|
| **Kai Runtime** | The process that owns the workspace (files, git, processes, credentials), the Session Store, and all model calls. In v1 it is hosted in-process by the CLI. |
| **KSP (Kai Session Protocol)** | The typed JSON-RPC protocol between the runtime and clients, with a `seq`-cursored event stream ([spec](specs/protocol.md)). |
| **Session** | A sequence of tasks in one workspace, with one event log stream. |
| **Task** | One user request and its follow-ups, until a final verdict. It has a state (`open`, `in_progress`, `implemented_unverified`, `verifying`, `verification_failed`, `verified`, `blocked`, `cancelled`). |
| **Turn** | One model request and its response. |
| **Epoch** | A contiguous run of turns sharing one append-only context: one `previous_interaction_id` chain in chained mode. It starts with a **seed** ([ADR-0005](adr/0005-context-compiler-and-epochs.md)). |
| **Seed** | The first request of an epoch, compiled by the Context Compiler under a budget: system, tools, project instructions, epoch brief, repo map, relevant code, directive. |
| **Epoch brief** | The structured, mostly deterministic summary of task state that opens each epoch (objective, plan, decisions, files read and modified, verification, failures, attempts, next action). |
| **Ingress** | Anything appended to an epoch after the seed: shaped tool results, notices, user messages. |
| **Harness notice** | A short `<kai_notice>` message from Kai to the model (stale files, verification results, budgets). |
| **Chained / stateless mode** | Gemini Interactions state modes: server-held history via `previous_interaction_id` (`store: true`), or full client-sent history (`store: false`). |
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
