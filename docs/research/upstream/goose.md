# Goose

- **Repository:** [block/goose](https://github.com/block/goose) @ `fb7d185b` (2026-10-05)
- **License:** Apache-2.0
- **Language/runtime:** Rust (`crates/goose`, `goose-cli`, `goose-providers`, `goose-mcp`, `goose-context-management`, …) with an Electron desktop UI. MCP via `rmcp`.
- **Studied as:** an alternative architecture, MCP-native and Rust-based.

## Architecture

Goose is a general-purpose agent (not only for coding) whose capabilities come from
**extensions, which are MCP servers**: built-in "platform extensions" plus any external MCP
server. The agent is a state machine of composable operations
([`agents/state_machine/`](https://github.com/block/goose/tree/fb7d185b0581e8a64d2ea3404dcfdd32a0aea782/crates/goose/src/agents/state_machine):
`ops_llm`, `ops_toolcalling`, `ops_compaction`, `ops_tool_pair_compaction`, `ops_retry`,
`ops_maxturns`, `ops_tool_approval`, …). It also supports recipes (declarative workflows), a
scheduler and subagents.

## Context management

- **Large tool responses spill to a file.** Text content over 200,000 characters is written to a
  temporary file, and the model receives *"The response returned from the tool call was larger …
  and is stored in the file which you can use other tools to examine or search in: <path>"*
  ([`large_response_handler.rs` L5](https://github.com/block/goose/blob/fb7d185b0581e8a64d2ea3404dcfdd32a0aea782/crates/goose/src/agents/large_response_handler.rs#L5)).
  The idea is right, but the threshold is very high and there is no structured summary.
- **Auto-compaction at 80%** of the context limit
  ([`goose-context-management/src/lib.rs` L32](https://github.com/block/goose/blob/fb7d185b0581e8a64d2ea3404dcfdd32a0aea782/crates/goose-context-management/src/lib.rs#L32)),
  plus **tool-pair summarization** in batches of 10
  ([`context_mgmt/mod.rs`](https://github.com/block/goose/blob/fb7d185b0581e8a64d2ea3404dcfdd32a0aea782/crates/goose/src/context_mgmt/mod.rs)).
- **A per-turn context block (MOIM)** with the current time, working directory, compaction
  status and a **turn budget** signal: *"As the budget gets low, become more direct: reduce
  exploration, batch necessary tool calls"*
  ([`agents/moim.rs`](https://github.com/block/goose/blob/fb7d185b0581e8a64d2ea3404dcfdd32a0aea782/crates/goose/src/agents/moim.rs)).
  Telling the model its remaining budget is a cheap way to shape its behaviour.

## Tool loop and safety

- A tool monitor detects **identical repeated tool calls** (same name and same parameters)
  ([`tool_monitor.rs`](https://github.com/block/goose/blob/fb7d185b0581e8a64d2ea3404dcfdd32a0aea782/crates/goose/src/tool_monitor.rs)).
- Tool inspection and approval routing, malware checks on extensions, permission modes.
- Telemetry uses **OpenTelemetry GenAI semantic conventions**, with message-content capture
  behind `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`
  ([`gen_ai_telemetry.rs`](https://github.com/block/goose/blob/fb7d185b0581e8a64d2ea3404dcfdd32a0aea782/crates/goose/src/agents/gen_ai_telemetry.rs)).

## Gemini support

The Google provider uses `v1beta/models/{model}:streamGenerateContent?alt=sse`, and its default
model is still `gemini-2.5-pro`
([`goose-providers/src/google.rs`](https://github.com/block/goose/blob/fb7d185b0581e8a64d2ea3404dcfdd32a0aea782/crates/goose-providers/src/google.rs)).
Gemini is not first-class.

## Editing and verification

Editing is done by the developer extension's text-editor tools. There is no deterministic
verification gate.

## Is Rust or MCP-first a better foundation for Kai?

- **Rust.** It gives single-binary distribution and performance. But there is **no first-party
  Gemini Rust SDK**, so Kai would hand-maintain a fast-changing API (the Interactions schema
  changed incompatibly in May 2026), and the LSP and tree-sitter tooling Kai needs is at least
  as mature in TypeScript. **Rejected** for v1 ([ADR-0001](../../adr/0001-implementation-language-runtime.md)).
- **MCP-first.** Making every capability an MCP server maximizes extensibility but makes the
  tool surface open-ended. That is the "plugin sprawl" Kai's non-goals rule out, and it is the
  main cause of oversized tool rosters. **Rejected** for core tools. MCP is a *later* capability
  pack behind an allowlist.

## Adopt

1. **Spill-to-artifact for large outputs.** Kai lowers the threshold drastically, adds
   structured parsers, and makes artifacts addressable by ID
   ([spec](../../specs/artifact-store.md)).
2. **A per-turn budget signal** in Kai's harness notices (remaining repair budget, epoch budget).
3. **Identical-call detection** as the cheapest layer of loop detection.
4. **OpenTelemetry GenAI semantic conventions** as Kai's optional export format.

## Reject

- MCP-first core, recipes, the scheduler, subagents, and general-purpose non-coding scope.
