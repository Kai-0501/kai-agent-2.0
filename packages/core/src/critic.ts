/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Selective, fresh-context critic (after deterministic verification passes, on risk triggers and
 * open review obligations). Blocking findings need a violated requirement or a concrete defect;
 * review obligations are discharged only by a validated review or the user.
 * Spec: docs/specs/critic.md · Decisions: docs/adr/0020, docs/adr/0016.
 */
import type { TaskId } from "@kai/protocol";
import type { SymbolCard } from "./codeintel.js";
import type { IntegrityFindingRecord } from "./integrity.js";
import type { EvidenceBundle } from "./verify.js";

export interface CriticInput {
  readonly objective: string;
  readonly acceptanceCriteria: readonly string[];
  readonly constraints: readonly string[];
  readonly diff: string;
  readonly changedSymbols: readonly SymbolCard[];
  readonly context: readonly { readonly path: string; readonly excerpt: string }[];
  readonly verification: EvidenceBundle;
  readonly integrity: readonly IntegrityFindingRecord[];
  readonly triggers: readonly string[];
  /** Required reviews first (docs/specs/critic.md#review-obligations). */
  readonly obligations: readonly ReviewObligation[];
}

export interface ReviewObligation {
  readonly id: string;
  readonly taskId: TaskId;
  readonly kind: "integrity" | "user_required_trigger";
  readonly source: string; // finding ID or trigger name
  /** Budgets, failures and profiles without structured review never change this to discharged. */
  readonly status: "open" | "discharged_critic" | "discharged_user";
}

export interface CriticFinding {
  readonly severity: "blocking" | "major" | "minor";
  readonly category: "logic" | "security" | "concurrency" | "error_handling" | "api_contract" | "tests" | "requirements" | "integrity";
  readonly path: string;
  readonly line?: number;
  readonly requirementRef?: string; // "AC2", "objective", "constraint:…", or an obligation ID
  readonly claim: string;
  readonly evidence: string; // quoted code must occur in the file, else unverified_claim
  readonly impact?: string;
  readonly reproduction?: { readonly kind: "test" | "command"; readonly command: readonly string[] }; // must FAIL now to confirm
  readonly suggestedCheck?: string; // legacy free-text alias of reproduction
}

export interface FindingDisposition {
  readonly fingerprint: string; // (path, enclosing symbol, category, normalized claim)
  readonly disposition:
    | "blocking_confirmed"
    | "blocking_validated" // exempt category with location + requirement/impact + quote
    | "advisory_preference"
    | "unverified_claim"
    | "not_reproduced"
    | "duplicate"
    | "resolved";
}

export interface Critic {
  triggers(taskId: TaskId): Promise<{ readonly required: readonly ReviewObligation[]; readonly optional: readonly string[] }>;
  review(input: CriticInput, signal: AbortSignal): Promise<{
    readonly findings: readonly CriticFinding[];
    readonly dispositions: readonly FindingDisposition[];
    readonly blocking: boolean;
    readonly obligationsDischarged: readonly string[];
  }>;
}
