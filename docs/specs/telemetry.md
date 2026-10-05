# Spec: Token and Correctness Telemetry

- Package: `packages/core` (`telemetry/`)
- Decision: [ADR-0010](../adr/0010-telemetry.md)

## Responsibility

Measure, per turn, task and session, **what Kai costs and what it prevents**, with a strict
separation of **reported** numbers (from the API) and **estimated** numbers (Kai's
counterfactuals). Feed the CLI, `kai stats`, exports and the benchmark harness from one code
path.

## Records

```ts
interface TurnRecord {
  turnId: TurnId; sessionId: SessionId; taskId?: TaskId; epochId: EpochId;
  ts: string;
  model: string; provider: string; stateMode: "chained" | "stateless";
  purpose: RequestPurpose; effort: ReasoningEffort; governorRule: string;
  usage: TurnUsage;                    // REPORTED: input, cached, thought, output, toolUse, total
  latency: { ttftMs?: number; totalMs: number };
  status: TurnStatus;
  manifest: ContextManifest;           // ESTIMATED per category; plus unattributed vs reported
  toolCalls: { name: string; ok: boolean; resultEstTokens: number }[];
  counters: TurnCounters;
  costUsd: { value: number; priceTableVersion: string };   // derived from usage
}

interface TurnCounters {
  // reads
  readsTotal: number; readsStubbed: number; readsPartial: number; readsDiff: number;
  forcedRereads: number; wholeFileReads: number; outlineReads: number;
  estTokensSavedByLedger: number;                         // ESTIMATED
  // output spooling
  toolOutputBytes: number; toolOutputBytesInjected: number;
  estTokensSpooled: number;                               // ESTIMATED
  artifactsCreated: number; artifactReads: number;
  // edits & firewall
  txnApplied: number; txnRejected: number; rejectReasons: Record<string, number>;
  firewallBlocks: Record<string, number>; firewallWarns: Record<string, number>;
  blindEdits: number; wastefulRewrites: number;
  introducedDiagnostics: number; resolvedDiagnostics: number;
  // verification & repair
  verificationRuns: Record<string, number>;               // by tier
  repairAttempts: number; stuckDetections: number; replans: number;
  integrityFindings: number;
  // context mgmt
  epochStarted: boolean; contextMgmtTokens: number;       // REPORTED usage of digest/critic calls attributed to context mgmt
}

interface TaskSummary {
  taskId: TaskId; finalState: TaskState;
  turns: number; epochs: number;
  usageTotals: TurnUsage; costUsd: number;
  estTokensSaved: { ledger: number; spooling: number; toolExposure: number };   // ESTIMATED
  correctness: {
    firstTxnCleanRate: number;          // share of transactions with 0 introduced errors
    inventedSymbolRate: number;         // hallucination-class findings per 100 changed lines
    firewallRejects: number; prematureCompletions: number;
    integrityIncidents: number; criticBlocking: number;
  };
  wallClockMs: number;
}
```

## Counterfactual estimates (always labelled ESTIMATED)

| Saving | Counterfactual |
|---|---|
| Ledger | Tokens of content that a stub, partial or diff replaced: the full requested range's estimated tokens minus what was actually sent |
| Spooling | Tokens of raw output (capped at the model input limit) minus shaped tokens |
| Tool exposure | Estimated tokens of inactive pack declarations × requests in which they were inactive. Reported separately as *gross*, since caching would have discounted much of it |
| Epochs | **Not estimated** (too speculative). Measured only by benchmark A/B |

## Surfaces

- **CLI live line** after each turn:
  `t14 · e3 · low · in 18.2k (cache 71%) · think 0.4k · out 0.6k · reads 3 (1 stub) · spooled 46k→1.1k · ✓ txn`
- **`kai stats`** for a task, session or workspace: totals, per-category context composition
  (stacked), top token consumers (tools), correctness counters, and cost.
- **Export:** `kai stats --export jsonl` writes TurnRecords and TaskSummaries. The benchmark
  harness reads the same records.
- **OpenTelemetry (optional):** one span per turn with GenAI semantic convention attributes
  (`gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, plus
  `kai.*` attributes for cached, thought, manifest and counters). Content capture is off.

## Accuracy guards

- `unattributed / reported` per turn is tracked. A rolling mean above 10% raises a warning in
  `kai doctor`, since the estimator needs calibration.
- Cost uses a **versioned price table** stored in the repository
  (`packages/core/src/telemetry/prices.ts`) with the source URL and the date checked. Reports
  show the table version.

## Acceptance tests

1. A fake provider with fixed usage gives exact reported totals, and the cost matches the table.
2. A ledger stub increments `readsStubbed`, and the estimated saving equals the estimated tokens
   of the range.
3. Spooling a 1 MB output records the produced and injected bytes, and the ratio is computed.
4. `kai stats` output is stable (snapshot) for a recorded session fixture.
