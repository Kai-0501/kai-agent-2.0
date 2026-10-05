# ADR-0012: Tool surface and dynamic tool exposure

- Status: Proposed
- Date: 2026-10-05
- Related: [specs/tool-surface.md](../specs/tool-surface.md), [research/gemini-api.md §7–9](../research/gemini-api.md#7-function-calling-and-tool-control), [research/synthesis.md §2.2](../research/synthesis.md#22-dynamic-tool-exposure-is-worth-less-than-it-sounds)
- Partially superseded by: [ADR-0021](0021-chrome-research.md) (the `research` pack) and [ADR-0023](0023-audit-corrections.md) (`update_plan` can no longer set the objective or acceptance criteria)

## Context / problem

The founding prompt asks for a small core tool set plus capability loading, so that not every
tool schema is exposed on every turn, and asks whether this gives meaningful savings with
Gemini's current API. The research found:

1. A Gemini-CLI-sized roster is about 8–10k tokens per request, mostly cache-billed when
   chained.
2. Changing declarations mid-chain may invalidate the cached prefix (unverified, G2).
3. `allowed_tools` can restrict *calls* without changing *declarations*.
4. Tool shapes close to Gemini CLI's `gemini-3` family are in-distribution for Gemini.

## Considered alternatives

1. **Expose everything every turn.** Simplest, about 8–10k tokens per request, more distractor
   tools.
2. **Per-turn dynamic tool sets** (a router picks tools each turn). Smallest declarations, but
   churns the prefix and adds a routing step that can itself be wrong.
3. **A stable small core, plus capability packs that change at epoch boundaries, plus
   `allowed_tools` for phase restriction.**
4. **A single meta-tool** ("call any tool by name with JSON args"). Smallest declarations, but
   loses typed schemas and is badly out-of-distribution.

## Decision

**Option 3.**

**Core tools (always declared; target ≤ 3.5k tokens in total):**

| Tool | Shape origin | Kai behaviour |
|---|---|---|
| `read_file(file_path, start_line?, end_line?)` | Gemini CLI | Ledger-aware. Large files without a range return an **outline** (symbol map) instead of the full content |
| `read_symbol(name, file_path?)` | Kai (Serena concept) | Returns the definition source of a symbol plus a short reference summary |
| `grep_search(pattern, dir_path?, include_pattern?, …)` | Gemini CLI | ripgrep, capped and grouped |
| `glob(pattern, dir_path?)` | Gemini CLI | |
| `replace(file_path, old_string, new_string, instruction, allow_multiple?)` | Gemini CLI | Transactional, firewall-validated ([ADR-0007](0007-editing-protocol.md)) |
| `write_file(file_path, content)` | Gemini CLI | Transactional. New files; flagged full rewrites |
| `run_shell_command(command, description?, timeout_s?, background?)` | Gemini CLI | Policy-gated; output spooled to artifacts |
| `read_artifact(artifact_id, query?, start_line?, end_line?)` | Kai | Narrow reads and greps into spooled output |
| `update_plan(...)` | Kai (cf. `write_todos`) | Structured working state: plan, decisions, notes, acceptance criteria, scope |
| `complete_task(summary, claims[])` | Kai (cf. `complete_task`) | Triggers the verification gate; does not end the task by itself |

**Capability packs** (declared only when active):

| Pack | Tools | Activation |
|---|---|---|
| `code_intel` | `find_references`, `go_to_definition`, `type_of` (hover), `workspace_symbols`, `rename_symbol` | Automatically when an LSP server is healthy for a task language |
| `api_reality` | `inspect_api(package, symbol?)`, `dependency_info(package)` | Automatically when the task touches third-party imports, or on request |
| `tests` | `run_tests(selector?)` (structured results), `justify_test_change(...)` | Implementation, repair and verification phases |
| `vcs` | `git_diff`, `git_log`, `git_blame` | On request |
| `research` (off by default; needs user permission) | Gemini built-in `google_search`, `url_context`, plus `web_fetch` | On request plus permission |
| `multi_file_patch` (experimental) | `apply_patch` (Codex grammar) | Benchmark-gated |

**Activation mechanics.** Packs are added or removed **only at epoch boundaries** in chained
mode, unless the provider capability `toolChangesWithinChainAreCacheSafe` is true. The system
prompt lists the available packs in one line each. The model asks for one through
`update_plan({request_capabilities: [{pack, reason}]})`, so no extra core tool is needed. The
request is honoured at the next epoch boundary, or immediately if that capability is true. The
Context Compiler may also start an early epoch when a requested pack is inactive and the current
epoch is already past half its budget.

**Phase restriction.** `tool_choice.allowed_tools` restricts calls in specific phases. Example:
during a critic-requested review, only read tools are allowed. During verification-only turns,
edit tools are disallowed.

## Rationale

This captures most of the benefit (a small, in-distribution, low-distractor core) without prefix
churn or a routing model. The honest expectation is a **modest** token saving and a possible
gain in tool-choice accuracy. Both are measured by an ablation (`--tools=all` vs `--tools=core`)
([benchmark plan](../evaluation/benchmark-plan.md)).

## Consequences

- Declarations are part of the epoch seed and are versioned as events (`ToolLoadoutChanged`),
  which makes requests reproducible (Pi's approach).
- Tool descriptions are written concisely, following the Gemini-3 family's slimmer style, with a
  token budget per declaration enforced in CI.
- MCP servers, if ever supported, are allowlisted packs. They are never auto-declared.

## Unresolved questions

1. G1/G2 (re-sending and changing tools in a chain).
2. Whether `read_symbol` should be merged into `read_file` (e.g. `read_file(file_path, symbol)`)
   to stay closer to Gemini CLI's shape. Benchmark both.
3. Whether `complete_task`'s claims list helps verification or just costs output tokens.
