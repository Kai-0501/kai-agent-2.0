/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Hallucination Firewall: pre-write validation of proposed code against repository reality.
 * Blocks hallucination-class findings; reports everything else as an introduced-diagnostics delta.
 * Spec: docs/specs/hallucination-firewall.md
 */
import type { LineRange, TaskId } from "@kai/protocol";
import type { Overlay, ProposedTransaction } from "./patch.js";

export type CheckId =
  | "F0_path"
  | "F1_parse"
  | "F2_placeholder"
  | "F3_import"
  | "F4_symbol"
  | "F5_dependency"
  | "F6_member"
  | "F7_scope"
  | "F8_integrity"
  | "F9_secret";

/** Classes that block (they almost never represent legitimate intermediate states). */
export type HallucinationClass =
  | "unknown_identifier"
  | "missing_export"
  | "missing_module"
  | "missing_member"
  | "wrong_arity"
  | "not_callable"
  | "missing_namespace_member"
  | "parse_error"
  | "omission_placeholder";

export interface Finding {
  readonly check: CheckId;
  readonly severity: "block" | "warn" | "info";
  readonly hallucinationClass?: HallucinationClass;
  readonly path: string;
  readonly range?: LineRange;
  readonly code?: string; // e.g. "TS2339"
  readonly message: string; // model-facing, one line
  readonly suggestions?: readonly string[]; // did-you-mean: "findById(id: UserId) [src/users/service.ts:51]"
  readonly evidence?: string; // ≤ 10 lines of proposed code around the location
}

export interface FirewallReport {
  readonly verdict: "pass" | "pass_with_warnings" | "reject";
  readonly findings: readonly Finding[];
  readonly checksRun: readonly { readonly id: CheckId; readonly ms: number; readonly degraded?: boolean }[];
}

/** Only users or the project profile create waivers; the model cannot. */
export interface Waiver {
  readonly pattern: string; // path glob or symbol name
  readonly createdBy: "user" | "profile";
  readonly reason: string;
}

export interface FirewallContext {
  readonly taskId: TaskId;
  readonly overlay: Overlay;
  readonly baseline: (path: string) => string | null;
  readonly promissorySymbols: ReadonlySet<string>;
  readonly scope?: { readonly paths: readonly string[]; readonly symbols?: readonly string[] };
  readonly waivers: readonly Waiver[];
  readonly timeBudgetMs: number; // default 2500 (TS) / 3500 (Python)
}

export interface HallucinationFirewall {
  evaluate(txn: ProposedTransaction, ctx: FirewallContext, signal: AbortSignal): Promise<FirewallReport>;
}
