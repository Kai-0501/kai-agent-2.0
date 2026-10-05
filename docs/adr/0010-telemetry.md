# ADR-0010: Token and correctness telemetry

- Status: Proposed. Amended by [ADR-0016](0016-robustness-amendments.md).
- Date: 2026-10-05
- Related: [specs/telemetry.md](../specs/telemetry.md), [evaluation/benchmark-plan.md](../evaluation/benchmark-plan.md), [ADR-0004](0004-durable-event-session-model.md)

## Context / problem

Kai's thesis is empirical: lower unnecessary token use and fewer incorrect outputs. Without
first-class measurement, any optimization is anecdotal. The founding prompt lists the required
per-turn and per-session metrics (model, reasoning effort, input, thinking, output and cached
tokens, context composition, reads and prevented duplicates, excluded bytes, savings estimates,
verification results, repairs, firewall rejections).

## Considered alternatives

1. **Logs only.** Not queryable. Aggregates are painful.
2. **OpenTelemetry as the primary store** (Cline, Goose). Good for fleets. Needs a collector, and
   is awkward for local per-session analysis and for counterfactual savings.
3. **Local structured telemetry in the session DB as the source of truth, with an optional OTel
   exporter.**

## Decision

**Option 3.**

- **`TurnRecord`** (one per model request) holds model, `thinking_level`, state mode, epoch,
  the **API-reported usage** verbatim (input, cached, thought, output, tool-use, total), latency
  (time-to-first-token and total), status, and the **context manifest**: estimated tokens per
  category (system, tools, project instructions, brief, map, symbols and excerpts, tail by tool
  type, notices, unattributed = reported − estimated).
  *Amended by [ADR-0016](0016-robustness-amendments.md) (R5):* the manifest is a **complete**
  accounting of each request (cumulative composition plus delta), including model-generated
  history (`history_model_text`, `history_function_calls`, `history_thoughts`) sized from
  **reported** output and thought tokens, plus framing. The estimator calibrates only on measured
  ingress and seed turns. Estimated savings are shown as calibrated only while accounting is
  healthy (residual ≤ 5%, no identity violations).
- **Counters per turn and session:** files and symbols read; whole-file reads; **duplicate reads
  prevented** (and estimated tokens saved); **re-reads after staleness**; tool-output bytes
  produced vs injected (spooling ratio); artifacts created and read back; firewall evaluations
  and rejections by class; edit match failures; transactions applied and rolled back;
  verification runs by tier and outcome; repair attempts; replans; critic runs and findings;
  epochs and their reasons.
- **Savings are estimated with explicit counterfactuals** and always labelled *estimated*: the
  token cost of content that would have entered context without the mechanism (raw output size,
  duplicated read size), converted with the calibrated estimator. Reported savings are never
  mixed with measured usage.
- **Cost** is computed from a versioned price table (model, tier, cached discount), and the
  table version is stored on each record.
- **Surfaces:** a live per-turn line in the CLI (tokens, cached %, thinking level, what was
  spooled or deduplicated), `kai stats` (session, task, workspace), JSONL export, and an optional
  **OTel exporter** using GenAI semantic conventions. Prompt or content capture is off by
  default.

## Rationale

The benchmark and day-to-day tuning both need the *same* numbers, from the same code path.
Storing them next to the events gives exact correlation ("this duplicate read prevention happened
on turn 14 of epoch 3") and makes ablations comparable. Counterfactual estimates are the only way
to measure "tokens that never had to be sent". Labelling them keeps them honest.

## Consequences

- The Context Compiler must emit a manifest for every request, and the provider must return
  usage for every request, including failed or partial ones.
- The estimator must be calibrated per category. The "unattributed" bucket shows calibration
  error, and a large or increasing value is a bug signal.
- Telemetry must be cheap: counters are updated in the projection transaction, with no extra
  model calls.

## Unresolved questions

1. Which price source is authoritative, given that the official pricing page was not reachable
   during research? A manual table, versioned, updated by hand.
2. Is opt-in anonymous aggregate telemetry wanted? Proposed: no in v1, local only.
