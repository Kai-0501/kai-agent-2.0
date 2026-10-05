# Comparison matrix

A compact side-by-side view of the studied harnesses. Details and permalinks are in
[`upstream/`](upstream/). "Kai" columns state what Kai adopts (✅), adapts (🔧) or rejects (❌).

## 1. Architecture and runtime

| | Architecture | Language / runtime | Session model | Extensibility | License |
|---|---|---|---|---|---|
| **T3 Code** | Control surface: WebSocket server wraps other agents' CLIs. Web, desktop and mobile clients | TS, Node, Effect, SQLite | Normalized event store with sequence cursors. Snapshot + stream | Provider adapters per wrapped agent; ACP | MIT |
| **Pi** | Minimal loop + session manager; interactive, JSON, RPC and SDK modes | TS, Node ≥ 22 | JSONL tree; context from active branch; prompt and tools versioned in log | Extensions, skills, prompt templates, packages | MIT |
| **Aider** | Chat coder with an edit-format family; repo map | Python | Git commits + markdown chat log | Few hooks; model settings | Apache-2.0 |
| **OpenCode** | Server + TUI, desktop and web clients; session processor | TS, Bun, Effect, AI SDK, SQLite (drizzle) | SQLite sessions and messages; git-dir snapshots | Plugins, MCP, agents, skills | MIT |
| **Cline** | SDK layers (shared → llms → agents → core) + VS Code, CLI hub, desktop | TS, Bun, Node | Persisted task history; git checkpoints with private index | Hooks, plugins, MCP | Apache-2.0 |
| **OpenHands SDK** | Event-sourced conversation; workspaces local, Docker or remote; agent server | Python | Append-only event log + condensation tombstones + View | Tools, MCP, skills, critics, security analyzers | MIT |
| **Goose** | State-machine agent; everything is an MCP extension | Rust, Electron | Session store; compaction ops | MCP-first, recipes, scheduler | Apache-2.0 |
| **SWE-agent** | ACI tool bundles + configurable history processors | Python, Docker | Trajectory files | Tool bundles via YAML | MIT |
| **mini-swe-agent** | ~100-line loop, bash only | Python | Linear message list = trajectory | Subclassing | MIT |
| **Gemini CLI** | Interactive CLI; core services; routing | TS, Node, `@google/genai` 1.30 (`generateContent`) | Chat recording JSON; git checkpointing | MCP, skills, extensions, hooks | Apache-2.0 |
| **Codex CLI** | Rust core + app-server protocol + TUI | Rust | Rollout files; app-server threads | MCP, plugins | Apache-2.0 |
| **Serena** | MCP server of LSP-backed symbol tools | Python | — | Language servers | GPL-3.0+ app / MIT SolidLSP |

## 2. Context, tool loop and editing

| | Context management | Tool loop | Editing |
|---|---|---|---|
| **T3 Code** | Delegated to wrapped agent; textual handoff summaries | Delegated | Delegated |
| **Pi** | 2,000-line / 50 KB truncation; compaction when window − 16k reserve is exceeded, keeping ~20k recent; on-demand skills | Small loop with steering and follow-up queues | Multi `{oldText,newText}` per call, matched against the original, exact |
| **Aider** | **Repo map**: tree-sitter tags → PageRank → token-budget binary search; history summarization | Text-parsed edits; reflection loop (≤ 3) | SEARCH/REPLACE (exact → whitespace → `...` → fuzzy ≥ 0.8), udiff, whole, architect |
| **OpenCode** | Prune old tool outputs (protect 40k, minimum 20k); overflow compaction | Function calling via AI SDK | `edit`/`write`, or `apply_patch` for GPT |
| **Cline** | **Retroactive duplicate-read removal**; truncation keeps the first message; 48k-char output caps | Function calling + approvals | Search/replace |
| **OpenHands SDK** | Condenser: forget the first half + LLM summary; soft and hard triggers | Step loop, parallel tool executor | `str_replace_editor`; **Gemini preset** with Gemini-CLI-shaped tools |
| **Goose** | Spill > 200k chars to file; compaction at 80%; tool-pair summaries; per-turn budget block | State machine ops | Developer extension text editor |
| **SWE-agent** | History processors (last-N observations, closed windows) | Text or function actions | **Lint-gated windowed edit (reject before write)** |
| **mini-swe-agent** | None (linear) | bash via `subprocess.run` | sed/heredoc through bash |
| **Gemini CLI** | Compression at 50% (keep 30%); masking (protect 50k, minimum 30k); distillation to disk; **JIT subdirectory GEMINI.md** | Function calling, loop detection, LLM routing | `replace` exact → flexible → regex → fuzzy → LLM correction; **omission-placeholder detector** |
| **Codex CLI** | Truncation markers; compaction | Function calling; exec policy; sandbox | **`apply_patch`** (no fuzzy matching) |
| **Serena** | — | — | **Symbol-addressed edits** (replace body, insert before/after, rename) |

## 3. Verification, strengths and weaknesses

| | Verification | Strengths | Weaknesses (for Kai's goals) |
|---|---|---|---|
| **T3 Code** | None (delegated) | Clean ownership boundary; typed contracts; cursors; git-ref checkpoints | Large multi-surface scope; Effect learning curve |
| **Pi** | None built in | Small, readable; reproducible requests (prompt and tools in log) | LCD provider layer; no ledger, map or verification |
| **Aider** | Auto-lint (tree-sitter + flake8) + optional tests, *after* write | Best repo map; edit-format research | Fuzzy apply; lint after write; text-parsed edits |
| **OpenCode** | Post-edit LSP diagnostics (after write) | Broad LSP registry; permissions; pruning thresholds | Fixed high thinking for Gemini; no completion gate |
| **Cline** | User review; `attempt_completion` | Checkpoints with untracked files; OTel; UX transparency | History rewriting busts caches; self-declared completion |
| **OpenHands SDK** | Optional critics (deterministic and LLM) | Event-sourcing rigor; View invariants | LLM-summary memory; Python remote stack |
| **Goose** | None | MCP ecosystem; OTel GenAI conventions | Plugin sprawl; Gemini not first-class |
| **SWE-agent** | Lint gate + review on submit | Interface-design evidence | Research-oriented; heavier config |
| **mini-swe-agent** | None | **Strong solve rate with ~zero harness**; ideal baseline | No efficiency or correctness discipline |
| **Gemini CLI** | Loop detection; no completion gate | Gemini-tuned tools and prompts; many Gemini-specific mitigations | `generateContent`; fixed HIGH thinking; fuzzy and LLM edit correction; compression at 50% of 1M |
| **Codex CLI** | Sandbox + exec policy (safety, not correctness) | Robust patch grammar; mature sandboxing | GPT-specific patch format |
| **Serena** | Diagnostics after symbolic edits | Right abstraction (symbols) | GPL application; Python; MCP-only |

## 4. Kai's decisions per concept

| Concept | Source | Kai | Where |
|---|---|---|---|
| Workspace-owning runtime + typed protocol + sequence cursors | T3 Code | ✅ | [ADR-0002](../adr/0002-runtime-client-boundary.md) |
| Multi-surface clients in v1 | T3 Code | ❌ (postponed) | [IMPLEMENTATION_PLAN](../../IMPLEMENTATION_PLAN.md) |
| Small explicit loop; steering queue | Pi | ✅ | [ARCHITECTURE](../../ARCHITECTURE.md) |
| Prompt and tool loadout versioned as events | Pi | ✅ | [event model](../specs/event-model.md) |
| Append-only log; context = projection; tombstone markers | OpenHands | ✅ | [ADR-0004](../adr/0004-durable-event-session-model.md) |
| LLM summary as main compaction memory | Pi, OpenHands, Gemini CLI | 🔧 deterministic brief + small LLM part | [context compiler](../specs/context-compiler.md) |
| Repo map (tags → PageRank → budget fit) | Aider | ✅ (TS reimplementation) | [repo index](../specs/repo-index.md) |
| Fuzzy / LLM-corrected edit application | Aider, Gemini CLI | ❌ | [ADR-0007](../adr/0007-editing-protocol.md) |
| Strictness ladder without fuzzy | Codex | ✅ | [patch engine](../specs/patch-engine.md) |
| Reject-before-write with error delta | SWE-agent | ✅ (generalized) | [firewall](../specs/hallucination-firewall.md) |
| Post-write LSP diagnostics | OpenCode | 🔧 pre-write overlay + delta | [firewall](../specs/hallucination-firewall.md) |
| LSP navigation tools | OpenCode, Serena | 🔧 symbol-addressed, capability pack | [tool surface](../specs/tool-surface.md) |
| Gemini-3 tool names and shapes | Gemini CLI, OpenHands | ✅ | [ADR-0012](../adr/0012-tool-surface-and-dynamic-exposure.md) |
| Omission-placeholder detection | Gemini CLI | ✅ | [firewall](../specs/hallucination-firewall.md) |
| JIT subdirectory instructions | Gemini CLI | ✅ | [context compiler](../specs/context-compiler.md) |
| Spill large output to file | Goose, Gemini CLI | ✅ with structured summaries, lower threshold | [artifact store](../specs/artifact-store.md) |
| Retroactive duplicate-read removal | Cline | 🔧 ingress-time ledger instead | [read ledger](../specs/read-ledger.md) |
| Git checkpoints with private index under own refs | Cline, T3 Code, OpenCode | ✅ | [ADR-0013](../adr/0013-workspace-safety-and-checkpoints.md) |
| OTel export | Cline, Goose | 🔧 optional exporter; SQLite is the source of truth | [ADR-0010](../adr/0010-telemetry.md) |
| Identical-call and content-repetition loop detection | Goose, Gemini CLI | ✅ cheap layer | [repair controller](../specs/repair-replan-controller.md) |
| LLM-based loop detection | Gemini CLI | ❌ (fingerprints instead) | [repair controller](../specs/repair-replan-controller.md) |
| Critics | OpenHands | 🔧 selective, evidence-cited | [critic](../specs/critic.md) |
| MCP-first core | Goose | ❌ (later, allowlisted pack) | [ADR-0012](../adr/0012-tool-surface-and-dynamic-exposure.md) |
| Bash-only minimal harness | mini-swe-agent | Baseline A, not the design | [benchmark plan](../evaluation/benchmark-plan.md) |
| `apply_patch` | Codex | 🔧 optional pack, benchmark first | [ADR-0007](../adr/0007-editing-protocol.md) |
| Lowest-common-denominator provider layer | Pi, OpenCode, Cline, Goose | ❌ for Gemini | [ADR-0003](../adr/0003-gemini-provider-strategy.md) |
