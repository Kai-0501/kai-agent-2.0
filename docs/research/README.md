# Research

This directory holds the primary-source research behind Kai Agent's architecture. Every
architectural decision in [`docs/adr/`](../adr/) cites one or more notes here.

## Method

Research was done on **2026-10-05**. For every upstream project we shallow-cloned the default
branch and read the source directly, rather than relying on marketing pages or on prior model
knowledge. Claims in these notes are tied to a specific commit so they can be re-checked later.

Google's documentation site (`ai.google.dev`) and Google Cloud docs were **not reachable** from
the research sandbox (blocked by the network egress policy). Gemini API facts were therefore
established from, in order of authority:

1. The first-party SDK source: [`googleapis/js-genai`](https://github.com/googleapis/js-genai)
   and [`googleapis/python-genai`](https://github.com/googleapis/python-genai). The Interactions
   types in these repositories are generated from the API definition and are the most precise
   source available.
2. The live API discovery document
   (`https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta`, revision
   `20261004`).
3. The official cookbook, [`google-gemini/cookbook`](https://github.com/google-gemini/cookbook).
4. Google's own Gemini harness, [`google-gemini/gemini-cli`](https://github.com/google-gemini/gemini-cli).
5. Web search results quoting `ai.google.dev` pages. These are marked as secondary and anything
   that depends on them is listed as an open question in
   [`gemini-api.md`](gemini-api.md#open-questions).

## Source snapshot

| Project | Repository (canonical) | Commit | Date | License |
|---|---|---|---|---|
| T3 Code | [pingdotgg/t3code](https://github.com/pingdotgg/t3code) | `cf3e714b` | 2026-10-05 | MIT |
| Pi | [earendil-works/pi](https://github.com/earendil-works/pi) (formerly `badlogic/pi-mono`) | `a37306d4` | 2026-10-05 | MIT |
| Aider | [Aider-AI/aider](https://github.com/Aider-AI/aider) | `5dc9490b` | 2026-05-22 | Apache-2.0 |
| OpenCode | [anomalyco/opencode](https://github.com/anomalyco/opencode) (formerly `sst/opencode`) | `907b3bc5` | 2026-10-02 | MIT |
| Cline | [cline/cline](https://github.com/cline/cline) | `68b24a92` | 2026-10-05 | Apache-2.0 |
| OpenHands (Agent Canvas) | [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) | `64f12b3a` | 2026-10-05 | MIT |
| OpenHands Software Agent SDK | [OpenHands/software-agent-sdk](https://github.com/OpenHands/software-agent-sdk) | `de30ec01` | 2026-10-05 | MIT |
| Goose | [block/goose](https://github.com/block/goose) | `fb7d185b` | 2026-10-05 | Apache-2.0 |
| SWE-agent | [SWE-agent/SWE-agent](https://github.com/SWE-agent/SWE-agent) | `3ea751c0` | 2026-07-16 | MIT |
| mini-swe-agent | [SWE-agent/mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent) | `04d809ce` | 2026-09-03 | MIT |
| Gemini CLI | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) | `fb972b2f` | 2026-10-02 | Apache-2.0 |
| Codex CLI | [openai/codex](https://github.com/openai/codex) | `7f892275` | 2026-10-04 | Apache-2.0 |
| Serena | [oraios/serena](https://github.com/oraios/serena) | `a8059c11` | 2026-10-05 | GPL-3.0-or-later (app) / MIT (SolidLSP) |
| Google GenAI JS SDK | [googleapis/js-genai](https://github.com/googleapis/js-genai) | `f6b85db4` (v2.27.0) | 2026-10-02 | Apache-2.0 |
| Google GenAI Python SDK | [googleapis/python-genai](https://github.com/googleapis/python-genai) | `618f0aa8` | 2026-10-02 | Apache-2.0 |
| Gemini cookbook | [google-gemini/cookbook](https://github.com/google-gemini/cookbook) | `3f6cdf04` | 2026-10-01 | Apache-2.0 |

Gemini CLI, Codex and Serena were not on the required list. They were added because they turned
out to hold the best available mechanism for specific Kai problems: Gemini-tuned tool shapes and
Gemini-specific failure handling (Gemini CLI), patch grammar and command policy (Codex), and
LSP-backed symbolic tools (Serena).

## Contents

| Note | What it covers |
|---|---|
| [gemini-api.md](gemini-api.md) | Gemini 3.8 Flash, Interactions API, state, caching, thinking levels, usage accounting, function calling, streaming, open questions |
| [comparison-matrix.md](comparison-matrix.md) | Side-by-side comparison of all studied harnesses |
| [synthesis.md](synthesis.md) | Review of the original "Pi + Aider + T3Code + OpenHands + OpenCode + Cline" hypothesis; what Kai adopts, adapts and rejects |
| [upstream/t3code.md](upstream/t3code.md) | Client/server control surface, typed RPC contract, event store, git-ref checkpoints |
| [upstream/pi.md](upstream/pi.md) | Minimal agent loop, JSONL session tree, compaction as an appended entry |
| [upstream/aider.md](upstream/aider.md) | Tree-sitter repo map with PageRank, edit formats, lint/test reflection loop |
| [upstream/opencode.md](upstream/opencode.md) | LSP integration, permissions, pruning and compaction, git-dir snapshots |
| [upstream/cline.md](upstream/cline.md) | Duplicate-read removal, git checkpoints with a separate index, OpenTelemetry |
| [upstream/openhands.md](upstream/openhands.md) | Append-only event log, condensation tombstones, View projection, critic |
| [upstream/goose.md](upstream/goose.md) | MCP-native extensions, large-response spill to file, per-turn context block |
| [upstream/swe-agent.md](upstream/swe-agent.md) | Agent-computer interface, lint-gated edits; mini-swe-agent's bash-only baseline |
| [upstream/gemini-cli.md](upstream/gemini-cli.md) | Google's own Gemini harness: Gemini-3 tool family, masking, distillation, loop detection |
| [upstream/codex-and-serena.md](upstream/codex-and-serena.md) | `apply_patch` grammar, exec policy, sandboxing; LSP symbol tools and their license |

## Licensing summary

Kai Agent will be implemented from scratch. We take **ideas**, not code. Where a specific
algorithm is close to an upstream implementation, the spec says so and names the license:

- MIT and Apache-2.0 projects (all except Serena's application code) permit reuse with
  attribution. Apache-2.0 additionally requires preserving `NOTICE` content and stating changes
  when code is copied. Copying is still discouraged, because Kai's data model differs enough that
  transplanted code would carry assumptions we do not want.
- **Serena's application code is GPL-3.0-or-later.** Do not copy from `src/serena/`. Its
  `src/solidlsp/` LSP client library is MIT, but it is Python and Kai is TypeScript, so in
  practice nothing is reused.
- Tree-sitter grammars and their `tags.scm` queries are usually MIT. The license of each
  grammar must be checked when it is vendored (see
  [ADR-0006](../adr/0006-repository-indexing.md)).
