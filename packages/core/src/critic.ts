/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Fresh-context critic with two modes:
 * - risk_review: OPTIONAL, risk-triggered, own budget; skipping it never blocks `verified`.
 * - integrity_review: MANDATORY for contract-backed high-severity integrity findings, RESERVED budget;
 *   if it cannot resolve a finding, the task cannot be `verified` (user approves, or `blocked`).
 * Spec: docs/specs/critic.md · Decisions: docs/adr/0009, amended by docs/adr/0016.
 */
import type { ContractEntry, TaskId } from "@kai/protocol";
import type { SymbolCard } from "./codeintel.js";
import type { TaskContract } from "./contract.js";
import type { IntegrityFindingRecord } from "./integrity.js";
import type { TurnUsage } from "./provider.js";
import type { EvidenceBundle } from "./verify.js";

export type CriticMode = "risk_review" | "integrity_review";

/** No worker history in either mode. Requirements come from the contract, never from model restatements. */
export interface RiskReviewInput {
  readonly contract: TaskContract;
  readonly diff: string;
  readonly changedSymbols: readonly SymbolCard[];
  readonly context: readonly { readonly path: string; readonly excerpt: string }[];
  readonly verification: EvidenceBundle;
  readonly integrity: readonly IntegrityFindingRecord[];
  readonly triggers: readonly string[];
}

export interface IntegrityReviewInput {
  readonly findings: readonly IntegrityFindingRecord[]; // contract-backed, high-severity
  readonly testDiff: string;
  readonly citedEntries: readonly ContractEntry[];
  readonly changedProductionSymbols: readonly { readonly card: SymbolCard; readonly diff: string }[];
}

export interface CriticFinding {
  readonly severity: "blocking" | "major" | "minor";
  readonly category: "logic" | "security" | "concurrency" | "error_handling" | "api_contract" | "tests" | "requirements";
  readonly path: string;
  readonly line?: number;
  readonly claim: string;
  readonly evidence: string; // quoted code must occur in the file, else downgraded to unverified_claim
  readonly contractEntryId?: string; // required for "requirements"
  readonly suggestedCheck?: string;
  readonly unverifiedClaim?: boolean;
}

export interface IntegrityVerdict {
  readonly findingId: string;
  readonly verdict: "consistent" | "inconsistent";
  readonly contractQuote: string; // must occur verbatim in a cited entry
  readonly codeQuote: string; // must occur in the test diff or changed production code
  readonly reasoning: string;
  /** Set by deterministic validation; a "consistent" verdict that fails it counts as unavailable. */
  readonly validated: boolean;
}

export type RiskReviewOutcome =
  | { readonly status: "completed"; readonly findings: readonly CriticFinding[]; readonly blocking: boolean; readonly usage: TurnUsage }
  | { readonly status: "skipped"; readonly reason: "no_triggers" | "mode_off" | "budget_exhausted" | "provider_error"; readonly unreviewedTriggers: readonly string[] };

export type IntegrityReviewOutcome =
  | { readonly status: "completed"; readonly verdicts: readonly IntegrityVerdict[]; readonly usage: TurnUsage }
  /** Never "skipped": every finding in the batch stays unresolved and the user decides. */
  | { readonly status: "unavailable"; readonly reason: "disabled" | "budget_exhausted" | "provider_error" | "invalid_output" };

export interface Critic {
  riskTriggers(taskId: TaskId): Promise<readonly string[]>; // empty → risk review does not run
  riskReview(input: RiskReviewInput, signal: AbortSignal): Promise<RiskReviewOutcome>;
  /** Runs regardless of critic.mode; draws only from the reserved integrity budget. */
  integrityReview(input: IntegrityReviewInput, signal: AbortSignal): Promise<IntegrityReviewOutcome>;
}
