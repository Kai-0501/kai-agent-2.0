# Spec: Token and Correctness Telemetry

- Package: `packages/core` (`telemetry/`)
- Decision: [ADR-0010](../adr/0010-telemetry.md); amended by [ADR-0018](../adr/0018-providers-routes-profiles-capabilities.md) (unknown usage, usage classes) and [ADR-0022](../adr/0022-shared-procedural-learning.md) (project resource ledger)

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
  model: string; provider: string; routeId: RouteId; profile: string /* id@version */;
  usageClass: "api_metered" | "subscription_allowance" | "local_compute" | "none";
  continuation: "provider_chain" | "local_replay";
  purpose: RequestPurpose; effort: { requested: EffortLevel; applied: EffortLevel | "uncontrolled" };
  governorRule: string;
  usage: TurnUsage;                    // REPORTED: input, cached, reasoning, output, toolUse, total; each number | null
  latency: { ttftMs?: number; totalMs: number };
  status: TurnStatus;
  manifest: ContextManifest;           // COMPLETE accounting: delta + composition per category, each labelled
                                       // reported|estimated, incl. model-generated history; residual vs reported
  preflight: { projected: number; action: string };   // ESTIMATED projection that gated this request
  toolCalls: { name: string; ok: boolean; resultEstTokens: number }[];
  counters: TurnCounters;
  costUsd: { value: number; priceTableVersion: string } | null;   // api_metered with a known price only
}

interface TurnUsage {                  // REPORTED; null = the route did not report the field
  inputTokens: number | null; cachedTokens: number | null; reasoningTokens: number | null;
  outputTokens: number | null; toolUseTokens: number | null; totalTokens: number | null;
  reasoningIncludedInOutput: boolean;  // from the snapshot, so totals never double-count
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
  usageTotals: UsageTotals; costUsd: number | null;  // totals carry per-field "partial" flags
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

**Unknown is not zero.** A sum over turns where some turns did not report a field is shown as
`≥ N (partial: k of m turns unreported)`. Estimated tokens are shown beside it, labelled
*estimated*, and never substituted into a reported column.

## Project resource ledger

Each finalized project gets `ProjectResourceTotals`, the basis of learning measurement
([learning](learning-service.md#measurement)):

```ts
interface ProjectResourceTotals {
  byPurpose: Record<"work" | "critic" | "retry" | "replan" | "decision_digest" | "research"
                    | "reflection" | "probe", UsageTotals>;
  byUsageClass: Record<"api_metered" | "subscription_allowance" | "local_compute", UsageTotals>;
  estimated: { learnedProceduresTokens: number; researchResultTokens: number; seedTokens: number }; // ESTIMATED
  wallClockMs: number; toolTimeMs: number; verificationTimeMs: number; researchTimeMs: number;
  costUsd: number | null;              // metered routes only
  verifiedTasks: number; tasks: number;
}
interface UsageTotals { reported: Record<keyof Omit<TurnUsage, "reasoningIncludedInOutput">, number>;
                        unreportedTurns: Record<keyof Omit<TurnUsage, "reasoningIncludedInOutput">, number>;
                        calls: number }
```

- **Failed attempts count.** Retries, failed streams and abandoned turns are attributed to
  `retry` with whatever usage was reported.
- **Token totals are not billing cost** across providers; cost appears only for
  `api_metered` routes with a price table. Subscription usage is reported as plan usage in
  tokens, never as `$0`.

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
  (unknown fields print `?`, e.g. `in ? (est 18.9k)` on a route without usage).
- **macOS app** usage panels per task and project ([macos-client](macos-client.md#8-usage-reporting)).
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
7. A route that reports no cached tokens produces `cachedTokens: null` per turn and a
   `partial` total; no zero is written. A route that reports no input usage shows savings as
   `uncalibrated`.
8. Project totals for a fixture project include critic, retry, research and reflection usage
   under their purposes, and subscription usage under `subscription_allowance` with
   `costUsd: null`.
