# Spec: Artifact Store and Result Shaper

- Package: `packages/core` (`artifacts/`, `shaper/`)
- Research: [Goose's large-response spill](../research/upstream/goose.md), [Gemini CLI's masking and distillation](../research/upstream/gemini-cli.md)

## Responsibility

- **Store complete outputs** (shell, compiler, test, build, logs, large search results, diffs)
  as addressable, durable **artifacts**, so no information is lost.
- **Shape** what the model receives: a concise structured summary plus narrow, relevant
  excerpts, within a token budget, with explicit statements of what was omitted.
- Let the model **read or search** any artifact on demand (`read_artifact`).

**Not responsible for:** deciding pass or fail of verification (the Verification Engine consumes
parsed results), or redacting secrets (redaction is applied by the process runner before storage;
see failure handling).

## Data model

```ts
interface Artifact {
  id: ArtifactId;               // "art_" + 8 base32 chars, shown to the model
  sessionId: SessionId;
  kind: "shell" | "test" | "build" | "typecheck" | "lint" | "search" | "diff" | "log" | "web";
  command?: string[];           // argv for process outputs
  exitCode?: number;
  durationMs?: number;
  bytes: number;
  lines: number;
  blob: ContentHash;            // full content (stdout+stderr interleaved, with stream markers)
  parsed?: ParsedOutput;        // structured result, if a parser matched
  createdSeq: number;
}

type ParsedOutput =
  | { type: "test_run"; runner: string; passed: number; failed: number; skipped: number;
      failures: { testId: string; file?: string; line?: number; message: string; excerptRange: LineRange }[] }
  | { type: "diagnostics"; tool: string;
      items: { file: string; line: number; col?: number; code?: string; severity: "error" | "warning"; message: string }[] }
  | { type: "generic"; errorLines: number[]; salientRanges: LineRange[] };
```

## Result Shaper pipeline

```
raw output ──► store blob (always) ──► detect parser ──► parse (bounded time)
         └──────────────► size check ──► inline (≤ inlineMax)                 ──► function_result
                                   └──► summary + excerpts + artifact id      ──► function_result
```

1. **Always store first** (blob plus `Artifact` row). The artifact exists even when the output
   is shown inline. This keeps the record complete and makes later `read_artifact` calls cheap.
2. **Parser detection** by argv and output signature. v1 parsers:
   - test runners: **vitest, jest, node:test (TAP), pytest, go test, cargo test**;
   - typecheckers and compilers: **tsc, pyright, mypy, go build/vet, cargo/rustc**;
   - linters: **eslint (stylish and JSON), ruff, biome**;
   - **generic**: lines matching error patterns (`error`, `Error:`, `FAILED`, `Traceback`,
     `panic:`, `Exception`, `✗`, `✕`, `npm ERR!`), stack frames, plus head and tail.
3. **Inline** if the estimated tokens are at most `inlineMax` (default 2,000). Otherwise **shape**:
   - header: `exit 1 · 2.3s · 48,213 lines · 3.1 MB · art_7k2m`,
   - parsed summary, e.g. `vitest: 412 passed, 3 failed, 2 skipped`, then one line per failure
     (`FAIL src/a.test.ts > parses dates — expected '2024-01-01' to equal '2024-01-02'
     (a.test.ts:41)`), capped at 10 failures with a `+N more` count,
   - excerpts: for each of the top-K failures (K = 3), the assertion message plus the first
     relevant stack frames in the workspace (frames inside `node_modules` and `site-packages` are
     collapsed), ±3 lines,
   - for generic output: the first error region ±5 lines, the last 20 lines, and an error-line
     count,
   - footer: `Full output: read_artifact("art_7k2m", query="…")`.
   - Hard cap: the shaped result is at most `shapedMax` (default 1,200 tokens).
4. **De-duplicate repeated lines** (e.g. 500 identical warnings): collapse to
   `[×500] warning: …`.
5. **Strip ANSI** and progress-bar carriage-return frames before storing the *shaped* text. The
   blob keeps raw bytes.

## `read_artifact` semantics

- `query` (regex): matching lines with ±3 lines of context, merged and capped at 1,500 tokens,
  with the total match count.
- `start_line`/`end_line`: the slice with line numbers, capped at 1,500 tokens.
- With neither: the shaped summary again (cheap; useful after an epoch boundary).
- Ledger semantics apply: an identical artifact slice already visible in this epoch gets a stub.

## Live and background processes

- Output streams to the blob while the process runs. The UI tails it through
  `stream.delta`-like progress events, and the model sees nothing until exit or timeout.
- On **timeout**, the process group is killed, and the result says
  `TIMED OUT after 120s (killed)` plus the shaped partial output.
- **Background** processes return immediately with `started pid 4123 · art_x (live)`. Later
  `read_artifact` calls read the live tail. The process is killed at session end.

## Defaults

| Setting | Default |
|---|---|
| `shaper.inlineMax` | 2,000 estimated tokens |
| `shaper.shapedMax` | 1,200 |
| `shaper.maxFailuresListed` | 10 |
| `shaper.excerptFailures` | 3 |
| `artifact.retentionDays` | 30 |
| `shaper.enabled` | true (ablation `--no-spooling` inlines up to the model limit, using simple head/tail truncation as baseline behaviour) |

## Events and telemetry

Events: `ProcessStarted`, `ProcessExited`, and `ToolCallCompleted.artifactIds`.

Counters: `tool_output_bytes_total`, `tool_output_bytes_injected`, `est_tokens_spooled`
(would-have-been-injected minus injected), `artifacts_created`, `artifact_reads`,
`artifact_read_tokens`, and `parser_hits` by parser.

The **spooling ratio** (injected ÷ produced) is a headline efficiency metric. The
**artifact-readback rate** shows whether summaries were sufficient: a high readback rate on a
parser means its summary is missing what the model needs.

## Failure handling

- A parser throws or times out (over 200 ms): fall back to the generic shaper and count
  `parser_errors`.
- Binary output: store it, and report `binary output (N bytes), not shown`.
- **Secret redaction:** before storage, mask values of environment variables that were
  sanitized from the process environment, plus common token patterns (`ghp_…`, `AIza…`,
  `sk-…`, PEM blocks). Redaction is applied to the blob, so secrets never reach disk or the model.

## Acceptance tests

1. A 50 MB build log with 3 errors is shaped to ≤ 1,200 tokens, and includes all 3 error
   messages and their file locations.
2. Vitest JSON or default reporter output with 2 failures produces the parsed `test_run`, and
   the failures' assertion messages are verbatim.
3. `read_artifact(query)` finds a string that occurs only past line 40,000.
4. A timeout kills the whole process tree (`sh -c "sleep 1000 & sleep 1000"`).
5. A secret printed by a command never appears in the blob or in the model input.
