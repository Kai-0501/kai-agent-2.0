/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Token & correctness telemetry. REPORTED (API usage) and ESTIMATED (Kai counterfactuals) are never mixed.
 * Spec: docs/specs/telemetry.md · Decision: docs/adr/0010.
 */
import type { AppliedEffort, EffortLevel, EpochId, FinalTaskState, RouteId, SessionId, TaskId, TurnId, UsageClass } from "@kai/protocol";
import type { ContextManifest, ContinuationMode } from "./context.js";
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
  readonly routeId: RouteId;
  readonly profile: string; // "<id>@<version>"
  readonly usageClass: UsageClass;
  readonly continuation: ContinuationMode;
  readonly purpose: RequestPurpose;
  readonly effort: { readonly requested: EffortLevel; readonly applied: AppliedEffort };
  readonly governorRule: string;
  readonly usage: TurnUsage; // REPORTED; fields may be null (unknown, never zero)
  readonly latency: { readonly ttftMs?: number; readonly totalMs: number };
  readonly status: TurnStatus;
  readonly manifest: ContextManifest; // ESTIMATED per category
  readonly toolCalls: readonly { readonly name: string; readonly ok: boolean; readonly resultEstTokens: number }[];
  readonly counters: TurnCounters;
  /** Only for api_metered routes with a known price; plan usage is never $0. */
  readonly costUsd: { readonly value: number; readonly priceTableVersion: string } | null;
}

type UsageField = "inputTokens" | "cachedTokens" | "reasoningTokens" | "outputTokens" | "toolUseTokens" | "totalTokens";

/** Sum of REPORTED fields plus how many turns did not report each field ("partial"). */
export interface UsageTotals {
  readonly reported: Readonly<Record<UsageField, number>>;
  readonly unreportedTurns: Readonly<Record<UsageField, number>>;
  readonly calls: number;
}

export type ResourcePurpose = "work" | "critic" | "retry" | "replan" | "decision_digest" | "research" | "reflection" | "probe";

/** Project resource ledger (docs/specs/telemetry.md#project-resource-ledger). */
export interface ProjectResourceTotals {
  readonly byPurpose: Readonly<Partial<Record<ResourcePurpose, UsageTotals>>>;
  readonly byUsageClass: Readonly<Partial<Record<Exclude<UsageClass, "none">, UsageTotals>>>;
  readonly estimated: { readonly learnedProceduresTokens: number; readonly researchResultTokens: number; readonly seedTokens: number }; // ESTIMATED
  readonly wallClockMs: number;
  readonly toolTimeMs: number;
  readonly verificationTimeMs: number;
  readonly researchTimeMs: number;
  readonly costUsd: number | null;
  readonly verifiedTasks: number;
  readonly tasks: number;
}

export interface TaskSummary {
  readonly taskId: TaskId;
  readonly finalState: FinalTaskState;
  readonly turns: number;
  readonly epochs: number;
  readonly usageTotals: UsageTotals; // REPORTED, with partial counts
  readonly costUsd: number | null;
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
