/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Test (and verification) Integrity Guard: detect weakening of tests, checks and suppressions.
 * Only the user-owned Task Contract (a validated citation) or a user approval can authorize a
 * flagged change; the model's own text never does.
 * Spec: docs/specs/test-integrity-guard.md · Decisions: docs/adr/0015, docs/adr/0016.
 */
import type { TaskId, TransactionId } from "@kai/protocol";
import type { CitationResult, ContractCitation } from "./contract.js";

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

/** Deterministic (no LLM): contract_backed only if the citation check returns "valid". */
export type JustificationStatus = "contract_backed" | "unbacked";

export interface Justification {
  readonly status: JustificationStatus;
  /** Model free text: kept for the report, carries no authority. */
  readonly reason: string;
  readonly citation?: ContractCitation;
  readonly citationCheck?: CitationResult;
}

/** How a finding was resolved (docs/specs/test-integrity-guard.md#justification-and-review). */
export type IntegrityResolution =
  | { readonly state: "resolved"; readonly by: "contract" } // low-severity flag + contract_backed
  | { readonly state: "resolved"; readonly by: "critic"; readonly verdictId: string } // integrity_review "consistent", quotes validated
  | { readonly state: "resolved"; readonly by: "user"; readonly approvalEntryId: string } // contract `approval` entry
  | { readonly state: "pending_review" } // high-severity + contract_backed, mandatory review not yet run
  | { readonly state: "unresolved"; readonly cause: "unbacked" | "inconsistent" | "review_unavailable" | "review_disabled" | "budget_exhausted" }
  | { readonly state: "must_fix" }; // block findings: only a user override lifts them

export interface IntegrityFindingRecord {
  readonly id: string;
  readonly detector: IntegrityDetectorId;
  /** block: must be fixed · flag: resolved per the matrix · info: reported only. */
  readonly action: "block" | "flag" | "info";
  readonly severity: "low" | "high";
  readonly path: string;
  readonly detail: string;
  readonly txnId?: TransactionId;
  readonly justification?: Justification;
  readonly resolution: IntegrityResolution;
}

export interface TestIntegrityGuard {
  /** Per-transaction (firewall F8) cheap AST checks on changed test-surface files. */
  checkTransaction(changes: readonly { readonly path: string; readonly before: string | null; readonly after: string | null }[]): readonly IntegrityFindingRecord[];
  /** Gate step 7: re-analyze the whole task diff vs the task-start checkpoint, then resolve per the matrix. */
  reviewTask(taskId: TaskId): Promise<readonly IntegrityFindingRecord[]>;
  /** justify_test_change: runs the contract's citation check; never trusts `reason`. */
  recordJustification(taskId: TaskId, target: string, reason: string, citation?: ContractCitation): Justification;
  /** High-severity contract-backed findings that need the mandatory integrity review. */
  pendingMandatoryReview(taskId: TaskId): readonly IntegrityFindingRecord[];
}
