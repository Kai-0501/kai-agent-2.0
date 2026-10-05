/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Verification Engine: task state machine, profile, tiers, completion gate, lazy baselines,
 * baseline-backed flaky classification, review obligations.
 * Spec: docs/specs/verification-engine.md · Decisions: docs/adr/0009, docs/adr/0016.
 */
import type { ArtifactId, FinalTaskState, TaskId } from "@kai/protocol";
import type { CriticFinding, FindingDisposition, ReviewObligation } from "./critic.js";
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
  /** User-owned. A model edit adding entries is an integrity finding (I13). */
  readonly knownFlaky?: readonly string[];
}

/** introduced_intermittent: passes on rerun now, but stable at baseline → blocks (docs/adr/0016). */
export type FailureClassification = "introduced" | "introduced_intermittent" | "pre_existing" | "flaky";

export interface CheckResult {
  readonly id: string;
  readonly tier: Tier;
  readonly status: "pass" | "fail" | "skipped" | "error";
  readonly classification?: FailureClassification;
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
  readonly integrity: readonly IntegrityFindingRecord[];
  readonly critic?: {
    readonly ran: boolean;
    readonly triggers: readonly string[];
    readonly findings: readonly CriticFinding[];
    readonly dispositions: readonly FindingDisposition[];
  };
  readonly reviewObligations: readonly ReviewObligation[];
  /** What the task was verified against: user criteria (authoritative) and model-derived additions. */
  readonly acceptance: { readonly user: readonly string[]; readonly derived: readonly string[] };
  readonly unverifiedReasons?: readonly string[];
}

export type GateOutcome =
  | { readonly verdict: "verified"; readonly evidence: EvidenceBundle }
  | { readonly verdict: "verification_failed"; readonly evidence: EvidenceBundle; readonly repairItems: readonly string[] }
  | { readonly verdict: "implemented_unverified"; readonly evidence: EvidenceBundle };

export interface VerificationEngine {
  /** The only code path that can produce a "verified" task state (AGENTS.md invariant 2). */
  runGate(taskId: TaskId, claims: readonly string[], signal: AbortSignal): Promise<GateOutcome>;
  runTier(taskId: TaskId, tier: "T2" | "T3" | "T4", signal: AbortSignal): Promise<readonly CheckResult[]>;
  discoverProfile(workspaceRoot: string): Promise<VerificationProfile>;
}
