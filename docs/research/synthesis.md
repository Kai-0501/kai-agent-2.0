# Synthesis: what the research changes

This note checks the founding hypothesis against the evidence, and records where the evidence
changed the design that the founding prompt implied.

## 1. The founding hypothesis

> Pi for the runtime and session model, Aider for repo maps and editing, T3 Code for client/server,
> OpenHands for durable events and context projection, OpenCode for LSP, permissions and providers,
> Cline for observability and checkpoints.

| Pairing | Verdict | Why |
|---|---|---|
| **Pi → runtime and session model** | ✅ **for the loop**, 🔧 for sessions | Pi's loop is the right size and shape. Its JSONL tree is more than v1 needs, and its compaction memory is an LLM summary. Kai takes the loop's simplicity and Pi's reproducibility idea (prompt and tools versioned in the log), and uses **OpenHands' event-sourcing** for durable state. |
| **Aider → repo maps, relevance, budgeted context** | ✅ **for the repo map**, ❌ **for editing** | The tags → PageRank → budget-fit map is still the best mechanism found. Aider's *editing* is optimized for text-parsed formats and fuzzy application, both wrong for Gemini function calling and for correctness. Editing comes from **SWE-agent (reject-before-write)**, **Codex (strict matching ladder)** and **Gemini CLI (tool shapes)**. |
| **T3 Code → client/server and typed remote sessions** | ✅ **for the boundary**, ❌ **for v1 scope** | The ownership rule ("execution stays in the environment that owns the workspace"), the typed contract package and sequence cursors are right. Multi-surface clients, relays and Effect are postponed or rejected. |
| **OpenHands → durable history, context as projection** | ✅ | Strongest match in the hypothesis. Kai adds one twist: with Gemini chained state, the projection is mostly *seeded* at epoch boundaries and *gated* at ingress, instead of being recomputed every turn (see §2.1). |
| **OpenCode → code intelligence, LSP, permissions, providers** | ✅ LSP and permissions, ❌ providers | OpenCode's LSP registry and post-edit diagnostics are good precedents. Kai moves diagnostics **before** the write. OpenCode's provider layer (AI SDK, fixed `thinkingLevel: "high"`) is the opposite of a Gemini-native provider. |
| **Cline → observability and checkpoints** | ✅ checkpoints and OTel adapter, 🔧 context | Private-index git checkpoints and adapter-based telemetry are adopted. Cline's retroactive duplicate-read removal proves the waste is real, but Kai fixes it at ingress to keep caches valid. |

**Missing from the hypothesis.** The two most important additions came from projects that were not
on the list:

1. **Gemini CLI**, because Google's own harness shows which tool shapes Gemini expects (a separate
   `gemini-3` tool family) and which Gemini failure modes need engineering (omission
   placeholders, degenerate loops). OpenHands' Gemini preset independently confirms the
   tool-shape finding.
2. **SWE-agent's lint-gated edit**, the cleanest precedent for the Hallucination Firewall:
   reject the change before it lands, report only *introduced* errors, show original and
   proposed code together.

**The baseline nobody mentioned.** mini-swe-agent (bash only, linear history, >74% on SWE-bench
Verified) shows that harness complexity does not automatically raise solve rate. Kai's claim must
be measured as *efficiency and trustworthiness at equal or better solve rate*, against a
mini-swe-agent-style baseline.

## 2. Where the evidence changed the implied design

### 2.1 "Construct each model turn from a strict token budget" conflicts with Gemini caching

Recompiling the whole context every turn means the prefix changes every turn. That defeats
implicit caching, and with `previous_interaction_id` the server-held history *cannot* be edited
anyway. Read naively, the founding requirement would make Kai **more** expensive than a naive
harness on long tasks.

**Resolution: epoch-based compilation.** The Context Compiler works at two points:
- **Epoch seed.** It builds the first request of an epoch from durable state under a strict
  budget, with stable ordering (system → tools → project instructions → brief → map → relevant
  code).
- **Ingress.** Within an epoch, nothing enters the chain without going through the Read Ledger
  (de-duplication), the Artifact Store (spooling) and the budget monitor.

When the epoch's accumulated input crosses a soft budget, or the work changes phase (plan →
implement → replan), Kai starts a **new epoch** from a freshly compiled seed. This gives
cache-friendly append-only behaviour inside an epoch and hard control over context growth and
stale assumptions across epochs ([ADR-0005](../adr/0005-context-compiler-and-epochs.md)).

### 2.2 Dynamic tool exposure is worth less than it sounds

A full Gemini-CLI-sized roster is about 8–10k tokens, mostly cache-billed when chained
([gemini-api.md §8](gemini-api.md#8-how-much-do-tool-declarations-cost)). Swapping declarations
mid-chain may also break the cache (open question G2). Kai therefore uses:
- a **small, stable core** (10 tools, target ≤ 3.5k tokens),
- **capability packs** that change only at epoch boundaries, and
- `allowed_tools` for phase-specific *restriction* (it costs no tokens and keeps the prefix
  stable).

The expected gain is mainly **fewer wrong tool choices**. It is benchmarked as an ablation and
is not a headline claim ([ADR-0012](../adr/0012-tool-surface-and-dynamic-exposure.md)).

### 2.3 Read Ledger "cached summaries" must not cost more than they save

Summarizing every file the model reads with an extra model call would spend tokens to save
tokens, and would add a hallucination channel (a wrong summary is worse than none). Kai's ledger
stores **deterministic symbol cards** (signatures, docstrings, line ranges from the index), and
uses only **notes the model writes itself** through `update_plan`. No background summarization
calls ([spec](../specs/read-ledger.md)).

### 2.4 The firewall must not block legitimate multi-step refactors

"Reject any patch that introduces an unresolved symbol" would block correct work: renaming a
function across files necessarily passes through a broken state. Kai splits checks into
**blocking, hallucination-class** checks (parse errors, omission placeholders, references to
symbols that exist *nowhere*, imports of nonexistent modules or packages, members missing on a
resolved type) and **non-blocking feedback** (type mismatches and the like). Checks run on the
**whole transaction** (all edits in one model response). Symbols defined anywhere in the
transaction or earlier in the task count as existing, and an explicit, logged waiver exists
([spec](../specs/hallucination-firewall.md)).

### 2.5 Deterministic checks need a latency budget

LSP diagnostics on a large TypeScript project can take seconds. The firewall has a per-check
time budget. If it is exceeded, Kai falls back to the tree-sitter tier and finishes the LSP check
asynchronously, before the next model request. A typical wrong model turn costs 5–20 s and
thousands of tokens, so a 1–3 s check is a good trade. A 60 s full typecheck after every edit is
not. Full typechecks and tests run at the **verification gate**, not after every edit
([verification spec](../specs/verification-engine.md)).

### 2.6 The critic is the most expensive mechanism, so it is the most selective

A fresh-context critic re-reads the diff and context and costs a substantial fraction of a full
task. It runs only **after deterministic verification passes**, only on **risk triggers**, gets
a compact evidence bundle (not the worker's history), and must cite file and line evidence for
every blocking finding ([spec](../specs/critic.md)).

### 2.7 Loop detection should use verification evidence, not conversation similarity

Gemini CLI's LLM-based loop check is general-purpose. For coding, Kai has a far stronger signal:
**failure fingerprints** (normalized diagnostics and test failures) combined with **approach
fingerprints** (the touched symbols and diff shingles of each attempt). "Same failure after a
similar fix" is deterministic, cheap and precise ([spec](../specs/repair-replan-controller.md)).

### 2.8 A large context window is not a reason to keep long sessions

Gemini CLI compresses at 50% of the window (≈500k tokens for a 1M model). For cost and for
stale-assumption control, Kai's default epoch soft limit is **64k observed input tokens** (to be
calibrated by the benchmark). The 1M window is emergency capacity, as the founding prompt says.

## 3. What is new in Kai relative to all studied harnesses

None of the studied harnesses combine these, and several are absent everywhere:

1. **Ingress-time read de-duplication with range and hash granularity**, aware of what is
   visible in the current epoch.
2. **Pre-write, transaction-scoped validation** that separates hallucination-class errors from
   ordinary type errors and suggests real symbols ("did you mean `getUserById`
   (src/users.ts:42)?").
3. **An API Reality Checker** that answers library-API questions from installed declarations
   (`.d.ts`, `.pyi`, source) through LSP probe files before the model guesses.
4. **A verification state machine where model completion claims are only inputs**, with
   baseline-aware failure classification (pre-existing vs introduced).
5. **A test and verification integrity guard** covering skips, assertion weakening and
   suppression comments.
6. **An adaptive per-request `thinking_level`** driven by phase, risk and observed failure.
7. **Epoch briefs built deterministically from projections.**
8. **Per-turn context composition accounting**, reconciled against API-reported usage, so token
   claims are measured rather than asserted.

## 4. Risks to the thesis

| Risk | Mitigation |
|---|---|
| Harness overhead (latency, engineering) exceeds gains on easy tasks | Every mechanism has a cheap fast path and an ablation flag. The benchmark includes easy tasks. |
| Gemini behaves worse with unfamiliar tool results (ledger stubs, firewall rejections) | Keep result formats short, explicit and actionable. Measure first-retry success after a rejection. |
| Strict edit matching raises turn count | Track match-failure rate. Fall back to an *opt-in* whitespace-insensitive mode if needed. Never fuzzy. |
| Epoch resets lose subtle context | Epoch briefs include ledger-backed file lists and model-written notes. Measure post-epoch rework (re-reads of the same files). |
| API churn (Interactions changed in May 2026) | Provider isolates the SDK. Contract tests run against the live API. Pin the SDK version. |
