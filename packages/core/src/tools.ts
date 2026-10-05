/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Tool registry, core tools and capability packs (Gemini-CLI "gemini-3" shapes where semantics match).
 * Spec: docs/specs/tool-surface.md · Decisions: docs/adr/0012, amended by docs/adr/0015.
 */
import type { ArtifactId, EpochId, SessionId, TaskId, TurnId } from "@kai/protocol";
import type { ResearchToolArgs } from "./research.js";
import type { TurnCounters } from "./telemetry.js";

export type CoreToolName =
  | "read_file"
  | "read_symbol"
  | "grep_search"
  | "glob"
  | "replace"
  | "write_file"
  | "run_shell_command"
  | "read_artifact"
  | "update_plan"
  | "complete_task";

export type PackId = "code_intel" | "api_reality" | "tests" | "vcs" | "research" | "multi_file_patch";

/**
 * Argument shapes of the core tools (Zod schemas generate the JSON Schema in the implementation).
 * Profiles render these (descriptions, schema dialect, aliases); aliases resolve to these names
 * before validation and authorization (docs/specs/harness-profiles.md#tool-rendering).
 */
export interface CoreToolArgs {
  read_file: { file_path: string; start_line?: number; end_line?: number; refresh?: boolean };
  read_symbol: { name: string; file_path?: string; include_references?: boolean };
  grep_search: {
    pattern: string;
    dir_path?: string;
    include_pattern?: string;
    exclude_pattern?: string;
    names_only?: boolean;
    max_matches_per_file?: number;
    total_max_matches?: number;
  };
  glob: { pattern: string; dir_path?: string };
  replace: { file_path: string; old_string: string; new_string: string; instruction: string; allow_multiple?: boolean };
  write_file: { file_path: string; content: string; instruction?: string };
  run_shell_command: { command: string; description?: string; timeout_s?: number; background?: boolean };
  read_artifact: { artifact_id: string; query?: string; start_line?: number; end_line?: number };
  /**
   * Model-authored WORKING STATE only. Deliberately no `objective` / `acceptance_criteria`: those live
   * in the user-owned Task Contract. The schema is strict, so passing them fails validation.
   */
  update_plan: {
    plan?: { step: string; status: "todo" | "doing" | "done" | "dropped" }[];
    decisions?: { decision: string; rationale: string }[];
    notes?: (string | { text: string; sources?: string[]; time_sensitive?: boolean })[]; // sources = "src_x L1-9" citations
    /** How the model reads ambiguous requirements. Commentary; never authoritative. */
    interpretations?: string[];
    /** Extra checks the model commits to. Additive only; never relaxes a requirement. */
    proposed_criteria?: string[];
    scope?: { paths: string[]; symbols?: string[] };
    new_symbols?: string[];
    request_capabilities?: { pack: PackId; reason: string }[];
    phase?: "explore" | "plan" | "implement" | "verify";
  };
  complete_task: { summary: string; claims?: string[] };
}

/** Pack tools whose argument shapes matter for correctness rules. */
export interface PackToolArgs extends ResearchToolArgs {
  /** `tests` pack. `reason` carries no authority; only a valid contract citation backs a change. */
  justify_test_change: {
    test_id_or_path: string;
    reason: string;
    contract_citation?: { entry_id: string; quote: string };
  };
}

export interface ToolContext {
  readonly sessionId: SessionId;
  readonly taskId: TaskId;
  readonly epochId: EpochId;
  readonly turnId: TurnId;
  readonly workspaceRoot: string;
}

export interface ToolOutcome<R> {
  readonly ok: boolean;
  /** What goes into the function_result after shaping. */
  readonly resultForModel: string | Readonly<Record<string, unknown>>;
  /** Maps to Gemini function_result.is_error. */
  readonly isError?: boolean;
  readonly artifacts?: readonly ArtifactId[];
  readonly counters?: Partial<TurnCounters>;
  /** Structured result for events and UI; never sent to the model. */
  readonly data?: R;
}

export interface ToolDefinition<A, R> {
  readonly name: string;
  readonly pack: "core" | PackId;
  readonly description: string; // concise; CI enforces a per-tool token budget
  /** Placeholder for the Zod schema in the implementation. */
  readonly argsSchema: unknown;
  readonly mutating: boolean;
  readonly readOnlyParallelSafe: boolean;
  execute(args: A, ctx: ToolContext, signal: AbortSignal): Promise<ToolOutcome<R>>;
}

/** Execution order: read-only calls concurrently; all edits as one transaction; shell sequentially. */
export interface ToolRegistry {
  declarationsFor(packs: readonly PackId[]): readonly { name: string; pack: "core" | PackId }[];
  executeBatch(
    calls: readonly { readonly providerCallId: string; readonly name: string; readonly args: unknown }[],
    ctx: ToolContext,
    signal: AbortSignal,
  ): Promise<readonly { readonly providerCallId: string; readonly name: string; readonly outcome: ToolOutcome<unknown> }[]>;
}
