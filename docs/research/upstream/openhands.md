# OpenHands

- **Repositories:**
  - [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) @ `64f12b3a` (2026-10-05). Now **"Agent Canvas"**: *"the self-hosted developer control center for coding agents and automations"* that runs OpenHands, Claude Code, Codex, Gemini or any ACP agent.
  - [OpenHands/software-agent-sdk](https://github.com/OpenHands/software-agent-sdk) @ `de30ec01` (2026-10-05). The agent core: `openhands-sdk`, `openhands-tools`, `openhands-workspace` and `openhands-agent-server`.
- **License:** MIT (both)
- **Language/runtime:** Python (SDK), TypeScript (Agent Canvas UI).
- **Studied as:** inspiration for durable event history and for projecting model context from that history.

## Event-sourced conversation

From the condenser README
([`context/condenser/README.md`](https://github.com/OpenHands/software-agent-sdk/blob/de30ec0111fc1c1435a1639d4ec27aead297d5b8/openhands-sdk/openhands/sdk/context/condenser/README.md)):

> "at the heart is an append-only event log. Events capture almost every non-environment state
> change, and the agent takes events from this log that subclass `LLMConvertibleEvent` and
> converts them to messages … even if we lose the environment the agent ran in, we have an almost
> perfect record of what transpired."

- **Condensation events are tombstones.** Because the log is append-only, forgetting is
  expressed as a `Condensation` event that says which events to forget and what summary to
  insert. It is "similar to tombstones in Apache systems like Cassandra and Kafka".
- **The View is the projection.** `View` applies condensations to produce the list of events
  currently visible to the LLM, and enforces structural properties: tool calls and results stay
  paired, and summaries go only where they are valid.
- **Soft and hard triggers.** Resource limits are *soft*: if condensation would break message
  structure, skip it and retry next step. Context-window errors are *hard*: force a full
  forget-and-summarize reset.
- **The default strategy** replaces the first half of events with one LLM summary, at regular
  intervals. The README explicitly reasons about cost: "condensation destroys the prompt cache,
  but doing so regularly keeps the cost of rebuilding the prompt cache low."

## Tool loop and tools

The SDK `Agent` runs a step loop with parallel tool execution
([`agent/parallel_executor.py`](https://github.com/OpenHands/software-agent-sdk/blob/de30ec0111fc1c1435a1639d4ec27aead297d5b8/openhands-sdk/openhands/sdk/agent/parallel_executor.py)).
`openhands-tools` provides `terminal`, `file_editor` (Claude-style `str_replace_editor`),
`apply_patch`, `glob`, `grep`, `task_tracker`, `browser_use`, `delegate`, and a
**`gemini` tool set**:

> "Gemini-style file editing tools … designed to match the tool interface used by gemini-cli:
> read_file, write_file, edit, list_directory"
> ([`tools/gemini/__init__.py`](https://github.com/OpenHands/software-agent-sdk/blob/de30ec0111fc1c1435a1639d4ec27aead297d5b8/openhands-tools/openhands/tools/gemini/__init__.py)),

wired up as a preset (`preset/gemini.py`). This is independent confirmation that tool shapes
should follow the model's training distribution.

## Critic and security

- **Critics**
  ([`sdk/critic/`](https://github.com/OpenHands/software-agent-sdk/tree/de30ec0111fc1c1435a1639d4ec27aead297d5b8/openhands-sdk/openhands/sdk/critic)):
  `AgentFinishedCritic`, `EmptyPatchCritic` (deterministic: the patch must be non-empty),
  `PassCritic`, and an `APIBasedCritic`. `IterativeRefinementConfig` retries the task while the
  critic score is below a threshold, for up to `max_iterations`.
- **Security analyzers** with risk levels and a confirmation policy: an LLM risk analyzer, a
  shell AST parser, ensembles, and defense-in-depth.

## Verification

There is no deterministic verification state machine in the core loop. The agent runs tests if it
chooses to, and critics provide optional post-hoc scoring.

## Adopt

1. **The append-only event log is the source of truth. Model context is a projection (View).**
   This is the conceptual core of Kai's session model
   ([ADR-0004](../../adr/0004-durable-event-session-model.md)).
2. **Context operations as events, the tombstone way.** Kai records `EpochStarted`,
   `EpochBriefBuilt` and `ContextElided` events. Nothing is deleted.
3. **Soft and hard trigger semantics** for context management.
4. **Structural invariants on the projection**: never separate a function call from its result,
   and never put a summary inside a tool pair.
5. **Cheap deterministic critics first** (empty patch, no-op completion), with LLM critics only
   when risk justifies them ([critic spec](../../specs/critic.md)).

## Reject or adapt

- **An LLM summary of the first half as the main memory.** Kai's epoch brief is mostly derived
  deterministically from projections ([spec](../../specs/context-compiler.md)).
- **Score-threshold iterative refinement driven by an LLM critic.** Kai's critic is
  *selective* and *evidence-oriented*: findings must cite code locations. It runs only
  after deterministic verification passes and only on risk triggers.
- **Python runtime and a remote workspace/agent-server stack** for v1. Kai is local-first and
  in TypeScript.
