/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Verification Engine: task state machine, profile, tiers, completion gate, lazy baselines.
 * Flakiness is ESTABLISHED-ONLY: "passed on rerun" is never evidence by itself.
 * Spec: docs/specs/verification-engine.md · Decisions: docs/adr/0009, amended by docs/adr/0016.
 */
import type { ArtifactId, BlockedReason, ContentHash, FailureClassification, FinalTaskState, RunCounts, TaskId } from "@kai/protocol";
import type { CriticFinding, FindingDisposition, IntegrityVerdict } from "./critic.js";
import type { IntegrityFindingRecord } from "./integrity.js";

export type Tier = "T0" | "T1" | "T2" | "T3" | "T4";

export interface CheckSpec {
  readonly id: string; // "typecheck", "lint", "unit", "format"
  readonly tier: "T2" | "T3" | "T4";
  readonly command: readonly string[]; // argv; "{files}" placeholder allowed for file-scoped checks
  readonly scope: "project" | "changed_files" | "related_tests";
  readonly parser?: string;
  readonly cwd?: string;
  readonly required: boolean;
}

export type RelatedTestsStrategy =
  | { readonly kind: "runner_native"; readonly command: readonly string[] }
  | { readonly kind: "import_graph" }
  | { readonly kind: "naming"; readonly patterns: readonly string[] };

/** Persisted (committable) at .kai/project.json after the user confirms discovery. */
export interface VerificationProfile {
  readonly version: 1;
  readonly languages: readonly ("typescript" | "javascript" | "python")[];
  readonly checks: readonly CheckSpec[];
  readonly relatedTests?: readonly RelatedTestsStrategy[];
  readonly timeouts: { readonly defaultS: number };
  readonly t4Policy: "always" | "risk_medium_plus" | "risk_high" | "never";
  readonly ignorePaths?: readonly string[];
  readonly firewall?: { readonly allowUnresolved?: readonly string[] };
  readonly baselineSetup?: readonly string[];
  /** User-approved exceptions only; model edits to this list are Integrity Guard I13. */
  readonly knownFlaky?: readonly KnownFlakyEntry[];
}

export interface KnownFlakyEntry {
  readonly testId: string;
  readonly reason: string;
  readonly addedBy: "user";
  readonly addedAt: string;
  readonly expires?: string; // default: 90 days
}

export interface CheckResult {
  readonly id: string;
  readonly tier: Tier;
  readonly status: "pass" | "fail" | "skipped" | "error";
  readonly classification?: FailureClassification;
  /** Shown in the report (e.g. "now 1/5 failed, baseline 0/5"). */
  readonly runs?: { readonly now: RunCounts; readonly baseline?: RunCounts };
  readonly artifactId?: ArtifactId;
  readonly summary: string;
  readonly fingerprints: readonly string[];
  /** Evidence for intermittency decisions. */
  readonly reruns?: { readonly now: readonly ("pass" | "fail")[]; readonly baseline: readonly ("pass" | "fail")[] };
}

export interface EvidenceBundle {
  readonly taskId: TaskId;
  readonly finalState: FinalTaskState;
  readonly checks: readonly CheckResult[];
  readonly diffStat: { readonly files: number; readonly insertions: number; readonly deletions: number };
  /** What the task was graded against (user-owned). */
  readonly contract: { readonly version: number; readonly hash: ContentHash };
  readonly criteriaCoverage?: readonly { readonly entryId: string; readonly checks: readonly string[] }[];
  readonly integrity: readonly IntegrityFindingRecord[];
  readonly critic?: {
    readonly riskReview: { readonly ran: boolean; readonly skippedReason?: string; readonly triggers: readonly string[]; readonly findings: readonly CriticFinding[]; readonly dispositions: readonly FindingDisposition[] };
    readonly integrityReview?: { readonly ran: boolean; readonly verdicts: readonly IntegrityVerdict[] };
  };
  readonly blockedReason?: BlockedReason;
  readonly unverifiedReasons?: readonly string[];
}

export type GateOutcome =
  | { readonly verdict: "verified"; readonly evidence: EvidenceBundle }
  | { readonly verdict: "verification_failed"; readonly evidence: EvidenceBundle; readonly repairItems: readonly string[] }
  | { readonly verdict: "implemented_unverified"; readonly evidence: EvidenceBundle }
  /** e.g. unresolved mandatory integrity review in a headless run. Never `verified`. */
  | { readonly verdict: "blocked"; readonly reason: BlockedReason; readonly evidence: EvidenceBundle }
  /** Interactive: waiting on a user decision (integrity approval or verification exception). */
  | { readonly verdict: "needs_approval"; readonly requests: readonly { readonly kind: "integrity" | "verification_exception"; readonly findingOrTestId: string }[]; readonly evidence: EvidenceBundle };

export interface VerificationEngine {
  /** The only code path that can produce a "verified" task state (AGENTS.md invariant 2). */
  runGate(taskId: TaskId, claims: readonly string[], signal: AbortSignal): Promise<GateOutcome>;
  runTier(taskId: TaskId, tier: "T2" | "T3" | "T4", signal: AbortSignal): Promise<readonly CheckResult[]>;
  discoverProfile(workspaceRoot: string): Promise<VerificationProfile>;
}
