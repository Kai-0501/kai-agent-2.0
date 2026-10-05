/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Selective, fresh-context critic (after deterministic verification passes, on risk triggers only).
 * Spec: docs/specs/critic.md
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
}

export interface CriticFinding {
  readonly severity: "blocking" | "major" | "minor";
  readonly category: "logic" | "security" | "concurrency" | "error_handling" | "api_contract" | "tests" | "requirements";
  readonly path: string;
  readonly line?: number;
  readonly claim: string;
  readonly evidence: string; // quoted code must occur in the file, else downgraded to unverified_claim
  readonly suggestedCheck?: string;
  readonly unverifiedClaim?: boolean;
}

export interface Critic {
  triggers(taskId: TaskId): Promise<readonly string[]>; // empty → do not run
  review(input: CriticInput, signal: AbortSignal): Promise<{ readonly findings: readonly CriticFinding[]; readonly blocking: boolean }>;
}
