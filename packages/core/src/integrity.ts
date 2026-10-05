/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Test (and verification) Integrity Guard: detect weakening of tests, checks and suppressions.
 * Spec: docs/specs/test-integrity-guard.md
 */
import type { TaskId, TransactionId } from "@kai/protocol";

export type IntegrityDetectorId =
  | "I1_test_deleted"
  | "I2_assertion_removed"
  | "I3_skip_added"
  | "I4_focus_added"
  | "I5_expectation_changed"
  | "I6_assertion_weakened"
  | "I7_trivialized"
  | "I8_timeout_inflated"
  | "I9_snapshot_updated"
  | "I10_fixture_mutated"
  | "I11_mocked_sut"
  | "I12_suppression_added"
  | "I13_check_disabled"
  | "I14_exception_swallowed";

export interface IntegrityFindingRecord {
  readonly detector: IntegrityDetectorId;
  /** block: must be fixed · flag: needs a valid justification · info: reported only. */
  readonly action: "block" | "flag" | "info";
  readonly severity: "low" | "medium" | "high";
  readonly path: string;
  readonly detail: string;
  readonly txnId?: TransactionId;
  readonly justification?: { readonly by: "model" | "user"; readonly reason: string; readonly requirementRef?: string; readonly status: "valid" | "needs_review" | "invalid" };
}

export interface TestIntegrityGuard {
  /** Per-transaction (firewall F8) cheap AST checks on changed test-surface files. */
  checkTransaction(changes: readonly { readonly path: string; readonly before: string | null; readonly after: string | null }[]): readonly IntegrityFindingRecord[];
  /** Gate step 7: re-analyze the whole task diff vs the task-start checkpoint. */
  reviewTask(taskId: TaskId): Promise<readonly IntegrityFindingRecord[]>;
  recordJustification(taskId: TaskId, target: string, reason: string, requirementRef?: string): IntegrityFindingRecord["justification"];
}
