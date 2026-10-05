# Pi (pi-mono)

- **Repository:** [earendil-works/pi](https://github.com/earendil-works/pi) (cloned via the former name `badlogic/pi-mono`) @ `a37306d4` (2026-10-05)
- **License:** MIT
- **Language/runtime:** TypeScript, Node.js ≥ 22.19. Packages include `ai` (multi-provider), `agent` (loop), `coding-agent` (CLI/TUI/RPC/SDK), `durable`, `protocol`, `server`, `client`, `telemetry`.
- **Studied as:** inspiration for a small, understandable agent runtime and session/event model.

## Philosophy

"Pi is a minimal, extensible agent harness … Pi ships with powerful defaults but skips features
like sub-agents and plan mode"
([README](https://github.com/earendil-works/pi/blob/a37306d437c528c355357bc9123524de2bf67267/README.md)).
Extensions, skills and prompt templates add behaviour. Interactive, print/JSON, RPC (JSONL over
stdio) and an in-process SDK all share the same agent and session mechanisms
([`how-pi-works.md`](https://github.com/earendil-works/pi/blob/a37306d437c528c355357bc9123524de2bf67267/packages/coding-agent/docs/how-pi-works.md)).

## Tool loop

[`packages/agent/src/agent-loop.ts`](https://github.com/earendil-works/pi/blob/a37306d437c528c355357bc9123524de2bf67267/packages/agent/src/agent-loop.ts)
(~940 lines): build the request from the system prompt, the active branch, the tools and the
model settings. Stream the assistant response, execute tool calls, record the results, and repeat
while tool results or queued messages need another response. **Steering** messages enter after
the current assistant turn; **follow-up** messages enter after the run finishes. The loop is
small, readable and well-factored.

## Context management

- Model context is **reconstructed from the active branch** of the session tree. Skill
  instructions are loaded **on demand**, an early form of dynamic capability loading.
- Built-in tools truncate output at **2,000 lines or 50 KB**, whichever comes first
  ([`tools/truncate.ts`](https://github.com/earendil-works/pi/blob/a37306d437c528c355357bc9123524de2bf67267/packages/coding-agent/src/core/tools/truncate.ts)).
- A cache warmer refreshes provider prompt caches only when the expected saving clears a
  threshold
  ([`cache-warmer.ts`](https://github.com/earendil-works/pi/blob/a37306d437c528c355357bc9123524de2bf67267/packages/coding-agent/src/core/cache-warmer.ts)).
  This applies to explicit-TTL caches (Anthropic-style). It is not needed for Gemini's implicit
  caching.
- No read de-duplication and no repository map.

## Editing

The `edit` tool takes `{path, edits: [{oldText, newText}]}`. Each `oldText` must be unique, and
all edits are matched **against the original file, not incrementally**, with no overlapping
edits ([`tools/edit.ts`](https://github.com/earendil-works/pi/blob/a37306d437c528c355357bc9123524de2bf67267/packages/coding-agent/src/core/tools/edit.ts)).
That makes multi-site edits to one file atomic and order-independent, which is good
transactional design. It returns a display diff, a unified patch and the first changed line. It
also tolerates common model formatting mistakes (edits sent as a JSON string, or a single edit
object instead of an array).

## Verification

None built in. It is left to extensions and the user.

## Sessions and compaction

- **JSONL session files forming a tree** (`id`/`parentId`). Branching happens in place, and the
  active branch supplies history
  ([`session-format.md`](https://github.com/earendil-works/pi/blob/a37306d437c528c355357bc9123524de2bf67267/packages/coding-agent/docs/session-format.md)).
- **System prompt and tool loadout are versioned in the session.** System messages patch prompt
  `sections` and record `toolsAdded`/`toolsRemoved`, so replaying them reproduces exactly what
  the model saw.
- **Compaction is an appended entry.** When `contextTokens > contextWindow − reserveTokens`
  (default reserve 16,384), Pi summarizes everything before a cut point that keeps about 20k
  recent tokens. It appends a `CompactionEntry {summary, firstKeptEntryId, tokensBefore,
  details: {readFiles, modifiedFiles}}`, and the original entries stay in the file
  ([`compaction.md`](https://github.com/earendil-works/pi/blob/a37306d437c528c355357bc9123524de2bf67267/packages/coding-agent/docs/compaction.md)).
  The summary format is Goal / Constraints & Preferences / Progress / Key Decisions / Next Steps
  / Critical Context, with file lists appended. It never cuts between a tool call and its result.

## Provider layer

`packages/ai` normalizes ~40 providers into one message model. The Google provider uses
`generateContent` and carries `thoughtSignature` through
([`api/google-generative-ai.ts`](https://github.com/earendil-works/pi/blob/a37306d437c528c355357bc9123524de2bf67267/packages/ai/src/api/google-generative-ai.ts)).
This breadth is exactly the lowest-common-denominator layer Kai should avoid for its primary
model.

## Adopt

1. **A small, explicit agent loop** with steering and follow-up queues. Kai's Turn Loop should
   be readable in one sitting.
2. **Context reconstructed from durable state**, with compaction and epoch markers *appended*,
   never destructive.
3. **Version the prompt and tool loadout as events**, so every model request is reproducible
   from the log ([event model](../../specs/event-model.md)).
4. **Multi-edit-per-call matched against the original file** for Kai's batched `replace`
   semantics within one transaction.
5. **One runtime behind several modes** (interactive, headless JSON, RPC, SDK).

## Reject or adapt

- **Lowest-common-denominator provider abstraction** for Gemini. Kai's Gemini provider is native
  ([ADR-0003](../../adr/0003-gemini-provider-strategy.md)).
- **An LLM summary as the only compaction memory.** Kai builds most of the epoch brief
  *deterministically* from projections (files read, files modified, verification state,
  failures, attempts), and uses the model only for decisions and intent that cannot be derived.
- **Tree-structured sessions in v1.** Branching is valuable, but Kai v1 only needs linear
  sessions with fork-by-copy. The event schema keeps `parent_session_id` so trees can come later.
- **Extension-first everything.** Kai's correctness gates are core invariants, not optional
  plug-ins.
