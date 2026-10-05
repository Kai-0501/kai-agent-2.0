/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Reasoning Governor (per-request effort) and Risk Assessor.
 * Spec: docs/specs/reasoning-governor.md
 */
import type { ReasoningEffort } from "@kai/protocol";
import type { TaskContract } from "./contract.js";

export type RequestPurpose = "work" | "replan" | "critic" | "decision_digest" | "probe";
export type Phase = "explore" | "plan" | "implement" | "repair" | "verify";

export interface LastTurnSummary {
  readonly toolKinds: readonly ("read" | "search" | "edit" | "shell" | "test" | "plan" | "complete")[];
  readonly editRejected?: "match" | "firewall" | "stale";
  readonly sameRejectionCount?: number;
  readonly verificationFailed?: boolean;
  readonly progress: boolean;
}

export interface RiskAssessment {
  readonly level: "low" | "medium" | "high";
  readonly score: number; // 0..100
  readonly reasons: readonly string[];
  readonly trivial: boolean; // enables "minimal" effort
}

export interface GovernorInput {
  readonly purpose: RequestPurpose;
  readonly phase: Phase;
  readonly risk: RiskAssessment;
  readonly lastTurn?: LastTurnSummary;
  readonly repair?: { readonly failureFp: string; readonly attemptsOnFp: number; readonly totalAttempts: number; readonly stuck: boolean };
  readonly epochTurnIndex: number;
  readonly lastTurnWasCleanSuccess: boolean; // for de-escalation
}

export interface GovernorDecision {
  readonly effort: ReasoningEffort;
  readonly rule: string; // "R1".."R12" + modifiers, e.g. "R9+deescalate"
  readonly inputsDigest: string;
}

export interface ReasoningGovernor {
  decide(input: GovernorInput): GovernorDecision;
}

export interface DiffSummary {
  readonly filesChanged: number;
  readonly linesChanged: number;
  readonly paths: readonly string[];
  readonly exportedSignaturesChanged: number;
  readonly dependenciesAdded: readonly string[];
  readonly touchesCiOrInfra: boolean;
}

export interface RiskAssessor {
  /** Scores user-owned contract text only, never the model's plan. */
  initial(task: { readonly contract: TaskContract; readonly mentionedPaths: readonly string[] }): RiskAssessment;
  update(current: RiskAssessment, diff: DiffSummary, history: { readonly replans: number; readonly attempts: number }): RiskAssessment;
}
