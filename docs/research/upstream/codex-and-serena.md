# Supplementary: Codex CLI and Serena

These two projects were not on the required list. Each has the best available implementation of
one mechanism Kai needs.

## Codex CLI

- **Repository:** [openai/codex](https://github.com/openai/codex) @ `7f892275` (2026-10-04)
- **License:** Apache-2.0
- **Language/runtime:** Rust (`codex-rs/`), with a TypeScript SDK.

### `apply_patch`

[`codex-rs/apply-patch/`](https://github.com/openai/codex/tree/7f892275e31002f0422477c6219189284560e689/codex-rs/apply-patch/src)
implements a file-oriented patch envelope: `*** Begin Patch`, then `*** Add File:`,
`*** Update File:` (optionally `*** Move to:`) or `*** Delete File:`, with `@@` context-anchor
lines and `+`/`-` lines, and finally `*** End Patch`. Hunks are located by
[`seek_sequence`](https://github.com/openai/codex/blob/7f892275e31002f0422477c6219189284560e689/codex-rs/apply-patch/src/seek_sequence.rs)
with decreasing strictness: exact, then ignoring trailing whitespace, then ignoring leading and
trailing whitespace, with special handling for end-of-file anchors. **No fuzzy edit-distance
matching.** A streaming parser makes it possible to show the patch while it is being generated.

**Assessment for Kai.** This is the best multi-file atomic edit format available, but GPT models
were trained on it and Gemini models were not. OpenCode only exposes it to GPT models (see
[opencode.md](opencode.md)). Kai keeps it as an **optional `multi_file_patch` capability pack**
for large multi-file changes and benchmarks it against batched `replace` on Gemini before
promoting it. Its **matching-strictness ladder** (no fuzzy step) is adopted for Kai's `replace`.

### Exec policy and sandboxing

- [`codex-rs/execpolicy/`](https://github.com/openai/codex/tree/7f892275e31002f0422477c6219189284560e689/codex-rs/execpolicy/src)
  is a rule-based command policy (parse the command, match rules, decide allow/prompt/forbid).
- [`codex-rs/linux-sandbox/`](https://github.com/openai/codex/tree/7f892275e31002f0422477c6219189284560e689/codex-rs/linux-sandbox/src)
  uses bubblewrap (`bwrap`), and Codex uses Seatbelt on macOS.

**Kai:** a rule-based command policy is a v1 requirement. OS-level sandboxing is postponed (see
[ADR-0013](../../adr/0013-workspace-safety-and-checkpoints.md)), but the process runner is
designed so a `bwrap` or Seatbelt wrapper can be inserted later.

### App-server protocol

`codex-rs/app-server-protocol` is a typed JSON-RPC protocol between the Codex agent and clients.
T3 Code drives Codex through it. This is further evidence that a typed client/runtime protocol is
standard practice.

## Serena

- **Repository:** [oraios/serena](https://github.com/oraios/serena) @ `a8059c11` (2026-10-05)
- **License:** split per component, see [`LICENSE`](https://github.com/oraios/serena/blob/a8059c11ea4cb319359b2f95bb4ef92b792bce8d/LICENSE).
  The **Serena application is GPL-3.0-or-later** ("Starting with the v2 licensing transition";
  not retroactive). The **SolidLSP** LSP client library (`src/solidlsp/`) is **MIT**.
- **Language/runtime:** Python. An MCP server exposing semantic code tools.

### Symbolic tools

[`src/serena/tools/symbol_tools.py`](https://github.com/oraios/serena/blob/a8059c11ea4cb319359b2f95bb4ef92b792bce8d/src/serena/tools/symbol_tools.py):
`get_symbols_overview`, `find_symbol`, `find_referencing_symbols`, `find_implementations`,
`find_declaration`, `get_diagnostics_for_file`/`_symbol`, `replace_symbol_body`,
`insert_after_symbol`/`insert_before_symbol`, `rename_symbol`, `safe_delete_symbol`. Editing
tools derive from `EditingToolWithDiagnostics`, which returns diagnostics after each edit.

**Assessment for Kai.** Addressing code **by symbol rather than by position or text** is the right
abstraction for "search → resolve symbols → inspect narrow ranges". Kai adopts the *concept* for
its `read_symbol` core tool and `code_intel` pack (references, implementations, rename). Symbol
*body replacement* is evaluated as an optional edit tool. It is AST-aware and avoids anchor
ambiguity, but it is out-of-distribution for Gemini, so it must win in benchmarks before
becoming a default.

**License.** **Do not copy from `src/serena/`** (GPL-3.0-or-later). SolidLSP is MIT, but Kai's
LSP client is TypeScript and is written from the LSP specification and the MIT
`vscode-languageserver-protocol` packages ([ADR-0008](../../adr/0008-code-intelligence-lsp.md)).
