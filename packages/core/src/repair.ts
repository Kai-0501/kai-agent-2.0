/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Repair/Replan Controller: failure + approach fingerprints, loop rules D1–D8, budgets, clean replans.
 * Spec: docs/specs/repair-replan-controller.md
 */
import type { TaskId } from "@kai/protocol";

export type FailureKind = "diagnostic" | "test" | "firewall" | "edit_match" | "command" | "integrity" | "critic";

export interface FailureFingerprint {
  readonly fp: string;
  readonly kind: FailureKind;
  readonly components: readonly string[];
  readonly exact: string; // one representative verbatim message (for briefs)
}

export interface ApproachFingerprint {
  readonly fp: string;
  readonly touched: readonly string[]; // sorted "path#symbol"
  readonly shingles: ReadonlySet<string>; // 5-gram token shingles of added lines
}

export type StuckRule =
  | "D1_identical_call"
  | "D2_noop_edit"
  | "D3_same_failure_similar_fix"
  | "D4_oscillation"
  | "D5_non_convergence"
  | "D6_budget"
  | "D7_degenerate_output"
  | "D8_edit_rejection_loop";

export interface RepairBudgets {
  readonly maxAttemptsPerFailure: number; // 3
  readonly maxAttemptsPerTask: number; // 8
  readonly maxReplans: number; // 2
  readonly maxRepairTokenShare: number; // 0.4 of task.tokenBudget, if set
}

export type RepairSignal =
  | { readonly kind: "ok" }
  | { readonly kind: "notice"; readonly text: string } // e.g. identical-call notice, budget notice
  | { readonly kind: "escalate"; readonly reason: StuckRule } // Governor raises effort
  | { readonly kind: "stuck"; readonly rule: StuckRule; readonly evidence: string };

export interface RepairState {
  readonly attemptsOnFp: ReadonlyMap<string, number>;
  readonly totalAttempts: number;
  readonly replans: number;
}

export interface RepairController {
  observe(taskId: TaskId, observation: {
    readonly toolCalls: readonly { readonly name: string; readonly argsCanonical: string; readonly resultHash: string }[];
    readonly failures: readonly FailureFingerprint[]; // introduced failures after this turn (if any check ran)
    readonly approach?: ApproachFingerprint; // transactions applied this turn
  }): RepairSignal;
  state(taskId: TaskId): RepairState;
  /** Builds the deterministic replan brief and requests a fresh epoch (purpose: "replan"). */
  planReplan(taskId: TaskId): Promise<{ readonly briefText: string; readonly revertToCheckpoint?: string }>;
}
