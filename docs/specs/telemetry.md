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
  manifest: ContextManifest;           // COMPLETE accounting: delta + composition per category, each labelled
                                       // reported|estimated, incl. model-generated history; residual vs reported
  preflight: { projected: number; action: string };   // ESTIMATED projection that gated this request
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
  preflightReshapes: number; preflightRollovers: number;
  instructionDeliveries: number; instructionGateRejections: number;
}

interface TaskSummary {
  taskId: TaskId; finalState: TaskState;
  turns: number; epochs: number;
  usageTotals: TurnUsage; costUsd: number;
  estTokensSaved: { ledger: number; spooling: number; toolExposureGross: number };   // ESTIMATED
  accounting: { healthy: boolean; meanAbsResidualPct: number; identityViolations: number }; // gates the line above
  correctness: {
    firstTxnCleanRate: number;          // share of transactions with 0 introduced errors
    inventedSymbolRate: number;         // hallucination-class findings per 100 changed lines
    firewallRejects: number; prematureCompletions: number;
    integrityIncidents: number; integrityUnresolved: number; criticBlocking: number;
    introducedIntermittent: number;     // intermittent failures classified as introduced
    recoveries: { rolledForward: number; rolledBack: number; aborted: number; conflicts: number };
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

- **Complete request accounting** ([context-compiler](context-compiler.md#complete-request-accounting)):
  every request's manifest attributes all of `reportedInputTokens` to categories, including
  model-generated history (`history_model_text`, `history_function_calls`, `history_thoughts`),
  which is sized from **reported** output and thought tokens, never from character ratios. The
  per-request `residual = reported − Σ composition` is stored.
- **Savings are gated on accounting health.** Estimated savings are displayed and exported as
  **calibrated** only when, over the trailing 20 requests, mean `|residual| / reportedInput ≤ 5%`
  and there were no accounting-identity violations. Otherwise every estimated-savings figure is
  labelled `uncalibrated` in the CLI, `kai stats` and exports, and the benchmark excludes it from
  headline numbers. Reported usage is always shown, because it is exact.
- `kai doctor` reports accounting health, identity violations, and the estimator's ingress error.
- Cost uses a **versioned price table** stored in the repository
  (`packages/core/src/telemetry/prices.ts`) with the source URL and the date checked. Reports
  show the table version.

## Acceptance tests

1. A fake provider with fixed usage gives exact reported totals, and the cost matches the table.
2. A ledger stub increments `readsStubbed`, and the estimated saving equals the estimated tokens
   of the range.
3. With a fake provider that violates the accounting identity, `kai stats` shows savings as
   `uncalibrated`, and the benchmark export omits them from the headline table.
4. A turn whose response contained a 20k-character `replace` argument attributes the next
   request's growth to `history_function_calls` (reported), not to ingress categories.
5. Spooling a 1 MB output records the produced and injected bytes, and the ratio is computed.
6. `kai stats` output is stable (snapshot) for a recorded session fixture.
