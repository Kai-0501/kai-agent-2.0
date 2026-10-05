/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Task Contract: user-owned requirements, verbatim and append-only. The model can read it but never
 * change it, and model-authored text never authorizes weakening tests or checks.
 * Spec: docs/specs/task-contract.md · Decision: docs/adr/0015-user-owned-task-contract.md
 */
import type { ContentHash, ContractEntry, TaskContractView, TaskId } from "@kai/protocol";

declare const userActionBrand: unique symbol;

/**
 * Capability proving that a call originates from a user action (a KSP user-action handler:
 * task.submit, task.steer, task.amend, permission.respond, recovery.resolve).
 * Implementation rule: only the protocol handler module can construct it (module-private factory).
 * The Turn Loop, tools and providers never receive one, so they cannot amend the contract.
 */
export interface UserActionToken {
  readonly [userActionBrand]: true;
  readonly protocolMethod: string;
  readonly seq: number;
}

export type TaskContract = TaskContractView;

/** A verbatim quote of user-owned text offered as authority for a change. */
export interface ContractCitation {
  /** A contract entry id, or "instructions:<path>" for a task-start instruction file. */
  readonly entryId: string;
  readonly quote: string;
}

/** What the citation is supposed to authorize (for the relatedness check). */
export interface CitationSubject {
  readonly testName?: string;
  readonly testPath?: string;
  readonly assertionExpression?: string;
  readonly changedProductionSymbols: readonly string[];
}

export type CitationResult =
  | { readonly status: "valid"; readonly entry: ContractEntry | { readonly instructionsPath: string; readonly hash: ContentHash } }
  | { readonly status: "not_found"; readonly reason: string }
  | { readonly status: "unrelated"; readonly reason: string };

export interface TaskContractStore {
  /** task.submit: records version 1 (in the same transaction as TaskCreated). */
  record(token: UserActionToken, taskId: TaskId, input: { readonly prompt: string; readonly acceptance?: readonly string[] }): TaskContract;
  /** task.steer / task.amend / permission approvals: appends an entry; never overwrites. */
  amend(
    token: UserActionToken,
    taskId: TaskId,
    entry: { readonly kind: "steering" | "amendment" | "approval"; readonly text: string; readonly supersedes?: readonly string[] },
  ): TaskContract;
  current(taskId: TaskId): TaskContract;
  /** Deterministic: verbatim existence (≥ 12 chars, whitespace-normalized) + relatedness via significant tokens. */
  verifyCitation(taskId: TaskId, citation: ContractCitation, subject: CitationSubject): CitationResult;
}
