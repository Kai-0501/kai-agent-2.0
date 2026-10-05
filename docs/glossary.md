# Glossary

| Term | Meaning |
|---|---|
| **Kai Runtime** | The process that owns the workspace (files, git, processes, credentials), the Session Store, and all model calls. In v1 it is hosted in-process by the CLI. |
| **KSP (Kai Session Protocol)** | The typed JSON-RPC protocol between the runtime and clients, with a `seq`-cursored event stream ([spec](specs/protocol.md)). |
| **Session** | A sequence of tasks in one workspace, with one event log stream. |
| **Task** | One user request and its follow-ups, until a final verdict. Its requirements live in the Task Contract. It has a state (`open`, `in_progress`, `implemented_unverified`, `verifying`, `verification_failed`, `verified`, `blocked`, `cancelled`). |
| **Turn** | One model request and its response. |
| **Epoch** | A contiguous run of turns sharing one append-only context: one `previous_interaction_id` chain in chained mode. It starts with a **seed** ([ADR-0005](adr/0005-context-compiler-and-epochs.md)). |
| **Seed** | The first request of an epoch, compiled by the Context Compiler under a budget: system, tools, project instructions, epoch brief, repo map, relevant code, directive. |
| **Epoch brief** | The structured, mostly deterministic summary of task state that opens each epoch: the user-owned task contract (verbatim), then the model-authored working state (plan, decisions, notes), files read and modified, verification, failures, attempts and the next action. |
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
| **Lazy baseline** | Re-running failing checks (several times) on the task-start checkpoint to classify failures as introduced (including intermittent), pre-existing or baseline-flaky. |
| **Failure fingerprint** | A normalized, line-insensitive hash of a failure (diagnostic, test, firewall, command). |
| **Approach fingerprint** | Touched symbols plus diff shingles of a repair attempt, used to detect "same fix again". |
| **Replan** | A fresh epoch with a replan brief (the task contract, state, failed approaches, exact failures) and a read-only first turn. |
| **Capability pack** | An optional group of tools (`code_intel`, `api_reality`, `tests`, `vcs`, `research`, `multi_file_patch`) declared only when active. |
| **Reported vs estimated** | Token numbers from the API's usage, vs Kai's own estimates and counterfactuals. Never mixed. |
| **Task Contract** | The user's requirements for a task, stored verbatim and append-only (prompt, explicit acceptance items, steering messages, amendments, approvals, plus the task-start instruction files). Only user actions can amend it. It is the only authority for objective and acceptance ([spec](specs/task-contract.md)). |
| **Contract citation** | A verbatim quote of a contract entry, checked deterministically for existence and relatedness. The only model-supplied input that can back a test or verification change. |
| **Model-authored working state** | Plans, decisions, notes, interpretations and proposed criteria written via `update_plan`. Useful context, never authority. |
| **Request preflight** | The check before every model request that projects its complete size (prior input, carried model output, the pending batch, margin) and reshapes or rolls over to a new epoch so no request exceeds the hard limit. |
| **Complete request accounting** | A manifest that attributes every input token of a request to a category, including model-generated history sized from reported usage, reconciled by the chained-mode accounting identity. |
| **Instruction map / instruction gate** | The up-front index of project instruction files and their directory scopes, and the Patch Engine rule that no mutation proceeds until every applicable instruction file has been delivered in the current epoch. |
| **Write-ahead journal** | The durable `TransactionPrepared` record (full before- and after-images of every file) committed before any file is touched, enabling deterministic crash recovery (roll forward, abort, roll back, or conflict). |
| **Baseline-flaky / introduced intermittent** | A failure whose flakiness is established at the task-start baseline (non-blocking) vs. one that appears now while the baseline always passed (blocking, likely a race). |
| **Risk review / integrity review** | The critic's optional, skippable review of risky changes vs. its mandatory review of contract-backed high-severity test changes, which has a reserved budget. |
| **Ablation flag** | A config switch that disables a mechanism, so the benchmark can measure its effect ([ADR-0014](adr/0014-measurement-gated-mechanisms.md)). |
