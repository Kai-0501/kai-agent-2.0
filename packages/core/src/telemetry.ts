/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Token & correctness telemetry. REPORTED (API usage) and ESTIMATED (Kai counterfactuals) are never mixed.
 * Spec: docs/specs/telemetry.md · Decision: docs/adr/0010.
 */
import type { EpochId, FinalTaskState, ReasoningEffort, SessionId, TaskId, TurnId } from "@kai/protocol";
import type { ContextManifest } from "./context.js";
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
  readonly manifest: ContextManifest; // ESTIMATED per category
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
  readonly correctness: {
    readonly firstTxnCleanRate: number;
    readonly inventedSymbolRate: number; // hallucination-class findings per 100 changed lines
    readonly firewallRejects: number;
    readonly prematureCompletions: number;
    readonly integrityIncidents: number;
    readonly criticBlocking: number;
  };
  readonly wallClockMs: number;
}
