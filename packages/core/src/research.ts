/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Research service port, tool shapes, source records and typed outcomes. The browser side
 * (Chrome discovery, pipe transport, filtering proxy, SERP parsing, extraction) is implemented by
 * @kai/research-chrome behind BrowserPort; core never imports it.
 * Spec: docs/specs/chrome-research.md · Decision: docs/adr/0023.
 */
import type { ArtifactId, ChromeStatus, ContentHash, LineRange, ResearchOpId, SourceId, TaskId } from "@kai/protocol";

/** Tool arguments of the `research` pack (one registry for every profile). */
export interface ResearchToolArgs {
  web_search: { query: string; gap: string; site?: string; freshness?: "any" | "year" | "month" | "week" };
  web_open: { source: string; section?: string; fresh?: boolean };
  web_find: { source: string; query: string };
}

export type ResultKind = "organic" | "ad" | "ai_overview" | "other";

export interface DatedValue {
  readonly value: string; // ISO date or date-time
  readonly source: "meta" | "jsonld" | "time_element" | "url_path";
}

export interface SourceRecord {
  readonly id: SourceId; // stable per (task, canonicalUrl)
  readonly taskId: TaskId;
  readonly firstOpId: ResearchOpId;
  readonly canonicalUrl: string;
  readonly resolvedUrl?: string;
  readonly title?: string;
  readonly siteName?: string;
  readonly lang?: string;
  readonly engine?: {
    readonly id: "google_web";
    readonly adapterVersion: string;
    readonly query: string;
    readonly rank: number;
    readonly kind: ResultKind;
    readonly snippet?: string; // search-engine text: never evidence
    readonly serpDateText?: string; // unverified
  };
  readonly status: "snippet_only" | "fetched" | "partial" | "blocked" | "unsupported" | "failed";
  readonly outcomeDetail?: string;
  readonly contentType?: string;
  readonly contentHash?: ContentHash;
  readonly artifactId?: ArtifactId; // kind "web"
  readonly lines?: number;
  readonly sections?: readonly { readonly path: string; readonly range: LineRange }[];
  readonly dates: { readonly published?: DatedValue; readonly updated?: DatedValue; readonly event?: DatedValue; readonly retrievedAt?: string };
  readonly extraction?: { readonly method: "readability" | "aria" | "pdfjs" | "none"; readonly warnings: readonly string[] };
  readonly fromCache?: { readonly cachedAt: string };
}

/** Typed outcomes; a parse failure is never "no_results". */
export type ResearchOutcome =
  | { readonly outcome: "ok" }
  | { readonly outcome: "no_results" }
  | { readonly outcome: "consent_required" }
  | { readonly outcome: "captcha" }
  | { readonly outcome: "sign_in_wall" }
  | { readonly outcome: "parse_failed"; readonly adapterVersion: string }
  | { readonly outcome: "unexpected_page" }
  | { readonly outcome: "http_error"; readonly status: number }
  | { readonly outcome: "timeout" }
  | { readonly outcome: "unsupported"; readonly content: string }
  | { readonly outcome: "partial" }
  | { readonly outcome: "blocked_destination" }
  | { readonly outcome: "query_rejected"; readonly rule: QueryGuardRule }
  | { readonly outcome: "budget_exhausted"; readonly budget: keyof ResearchBudgets }
  | { readonly outcome: "browser_unavailable"; readonly status: ChromeStatus }
  | { readonly outcome: "browser_crashed" }
  | { readonly outcome: "offline_mode" }
  | { readonly outcome: "research_off" };

export type QueryGuardRule = "secret" | "local_path" | "private_host" | "code_block" | "too_long" | "workspace_identifiers" | "url_secret";

export interface ResearchPolicy {
  readonly mode: "off" | "ask_first_use" | "enabled";
  readonly offline: boolean;
  readonly queryPrivacy: "strict" | "standard";
  readonly blockedDomains: readonly string[];
  readonly preferredDomains: readonly string[];
  readonly allowedPorts: readonly number[]; // [80, 443]
  readonly visualFallback: "user_only" | "model";
  readonly locale: string;
}

/** Initial hypotheses, calibrated by the benchmark (docs/specs/chrome-research.md#budgets-initial-hypotheses-calibrated-by-the-benchmark). */
export interface ResearchBudgets {
  readonly searchNavMs: number; // 15_000
  readonly openNavMs: number; // 20_000
  readonly extractMs: number; // 5_000
  readonly resultsPerSearch: number; // 8
  readonly searchOutputTokens: number; // 600
  readonly openOutputTokens: number; // 1_200
  readonly findOutputTokens: number; // 800
  readonly searchesPerTask: number; // 10
  readonly opensPerTask: number; // 25
  readonly outputTokensPerTask: number; // 25_000
  readonly wallMsPerTask: number; // 480_000
  readonly storedPageChars: number; // 400_000
  readonly pdfMaxBytes: number; // 15 MB
  readonly maxPagesPerTask: number; // 2
  readonly maxPagesTotal: number; // 4
  readonly engineCooldownMin: number; // 15
  readonly cacheTtlHours: number; // 24
}

export interface Citation {
  readonly sourceId: SourceId;
  readonly range: LineRange;
}

export type CitationCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "unknown_source" | "not_fetched" | "range_out_of_bounds" | "range_not_delivered" };

/** Core port implemented by @kai/research-chrome (runs in the research worker process). */
export interface BrowserPort {
  status(): Promise<ChromeStatus>;
  search(req: { readonly query: string; readonly site?: string; readonly freshness?: ResearchToolArgs["web_search"]["freshness"]; readonly locale: string }, signal: AbortSignal): Promise<{
    readonly outcome: ResearchOutcome;
    readonly results: readonly { readonly rank: number; readonly kind: ResultKind; readonly title: string; readonly url: string; readonly snippet?: string; readonly dateText?: string }[];
    readonly adapterVersion: string;
  }>;
  open(req: { readonly url: string; readonly expand: boolean }, signal: AbortSignal): Promise<{
    readonly outcome: ResearchOutcome;
    readonly text?: string; // redacted, sanitized, ≤ storedPageChars
    readonly sections?: readonly { readonly path: string; readonly range: LineRange }[];
    readonly meta: Omit<SourceRecord, "id" | "taskId" | "firstOpId" | "status" | "artifactId" | "engine">;
  }>;
  handoff(opId: ResearchOpId, action: "open" | "skip"): Promise<void>;
  shutdown(deadlineMs: number): Promise<void>;
}

/** Runtime service the tools call; owns policy, budgets, QueryGuard, sources and citations. */
export interface ResearchService {
  readonly policy: ResearchPolicy;
  readonly budgets: ResearchBudgets;
  search(taskId: TaskId, args: ResearchToolArgs["web_search"], signal: AbortSignal): Promise<{ readonly outcome: ResearchOutcome; readonly resultForModel: string; readonly sources: readonly SourceId[] }>;
  open(taskId: TaskId, args: ResearchToolArgs["web_open"], signal: AbortSignal): Promise<{ readonly outcome: ResearchOutcome; readonly resultForModel: string; readonly source?: SourceRecord }>;
  find(taskId: TaskId, args: ResearchToolArgs["web_find"], signal: AbortSignal): Promise<{ readonly outcome: ResearchOutcome; readonly resultForModel: string }>;
  validateCitation(taskId: TaskId, citation: Citation): CitationCheck;
}
