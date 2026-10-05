/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Token & correctness telemetry. REPORTED (API usage) and ESTIMATED (Kai counterfactuals) are never mixed.
 * Estimated savings are shown as calibrated only while complete request accounting is healthy.
 * Spec: docs/specs/telemetry.md · Decisions: docs/adr/0010, amended by docs/adr/0016.
 */
import type { EpochId, FinalTaskState, ReasoningEffort, SessionId, TaskId, TurnId } from "@kai/protocol";
import type { ContextManifest, PreflightResult } from "./context.js";
import type { RequestPurpose } from "./governor.js";
import type { TurnStatus, TurnUsage } from "./provider.js";

export interface TurnCounters {
  // reads
  readonly readsTotal: number;
  readonly readsStubbed: number;
  readonly readsPartial: number;
  readonly readsDiff: number;
  readonly forcedRereads: number;
  readonly wholeFileReads: number;
  readonly outlineReads: number;
  readonly estTokensSavedByLedger: number; // ESTIMATED
  // spooling
  readonly toolOutputBytes: number;
  readonly toolOutputBytesInjected: number;
  readonly estTokensSpooled: number; // ESTIMATED
  readonly artifactsCreated: number;
  readonly artifactReads: number;
  // edits & firewall
  readonly txnApplied: number;
  readonly txnRejected: number;
  readonly rejectReasons: Readonly<Record<string, number>>;
  readonly firewallBlocks: Readonly<Record<string, number>>;
  readonly firewallWarns: Readonly<Record<string, number>>;
  readonly blindEdits: number;
  readonly wastefulRewrites: number;
  readonly introducedDiagnostics: number;
  readonly resolvedDiagnostics: number;
  // verification & repair
  readonly verificationRuns: Readonly<Record<string, number>>;
  readonly repairAttempts: number;
  readonly stuckDetections: number;
  readonly replans: number;
  readonly integrityFindings: number;
  // context management
  readonly epochStarted: boolean;
  readonly contextMgmtTokens: number; // REPORTED usage of digest/critic calls
  readonly preflightReshapes: number;
  readonly preflightRollovers: number;
  readonly instructionDeliveries: number;
  readonly instructionGateRejections: number;
}

export interface TurnRecord {
  readonly turnId: TurnId;
  readonly sessionId: SessionId;
  readonly taskId?: TaskId;
  readonly epochId: EpochId;
  readonly ts: string;
  readonly model: string;
  readonly provider: string;
  readonly stateMode: "chained" | "stateless";
  readonly purpose: RequestPurpose;
  readonly effort: ReasoningEffort;
  readonly governorRule: string;
  readonly usage: TurnUsage; // REPORTED
  readonly latency: { readonly ttftMs?: number; readonly totalMs: number };
  readonly status: TurnStatus;
  /** COMPLETE accounting (delta + composition), each category labelled reported | estimated; residual vs reported. */
  readonly manifest: ContextManifest;
  /** ESTIMATED projection that gated this request. */
  readonly preflight: { readonly projected: number; readonly action: PreflightResult["action"] };
  readonly toolCalls: readonly { readonly name: string; readonly ok: boolean; readonly resultEstTokens: number }[];
  readonly counters: TurnCounters;
  readonly costUsd: { readonly value: number; readonly priceTableVersion: string };
}

export interface TaskSummary {
  readonly taskId: TaskId;
  readonly finalState: FinalTaskState;
  readonly turns: number;
  readonly epochs: number;
  readonly usageTotals: TurnUsage; // REPORTED
  readonly costUsd: number;
  readonly estTokensSaved: { readonly ledger: number; readonly spooling: number; readonly toolExposureGross: number }; // ESTIMATED
  /** Gates estTokensSaved: displayed as calibrated only when healthy (trailing 20 requests, mean |residual| ≤ 5%, no identity violations). */
  readonly accounting: { readonly healthy: boolean; readonly meanAbsResidualPct: number; readonly identityViolations: number };
  readonly correctness: {
    readonly firstTxnCleanRate: number;
    readonly inventedSymbolRate: number; // hallucination-class findings per 100 changed lines
    readonly firewallRejects: number;
    readonly prematureCompletions: number;
    readonly integrityIncidents: number;
    readonly integrityUnresolved: number;
    readonly criticBlocking: number;
    readonly introducedIntermittent: number;
    readonly recoveries: { readonly rolledForward: number; readonly rolledBack: number; readonly aborted: number; readonly conflicts: number };
  };
  readonly wallClockMs: number;
}
