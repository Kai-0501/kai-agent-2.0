# Spec: Read Ledger

- Package: `packages/core` (`ledger/`)
- Collaborators: [Context Compiler](context-compiler.md), [Patch Engine](patch-engine.md), [Repo Index](repo-index.md), [event model](../specs/event-model.md)
- Research: [Cline's duplicate-read removal](../research/upstream/cline.md), [synthesis §2.3](../research/synthesis.md#23-read-ledger-cached-summaries-must-not-cost-more-than-they-save)

## Responsibility

Know **exactly which source content the model has seen**: which file, which version (hash),
which line ranges or symbols, in which epoch and turn. Use that knowledge to:

1. **prevent re-ingesting unchanged content** that is still visible in the current epoch,
2. **detect staleness**: the model's view of a region no longer matches the file,
3. **support edit version checks** (the [Patch Engine](patch-engine.md) asks whether the model
   saw the current text of the region it is editing), and
4. **feed epoch briefs** with the files read, as deterministic symbol cards.

**Not responsible for:** summarizing files with an LLM (rejected, see the research synthesis), or
deciding *whether* a read is wise (the model decides; the ledger only makes repeats cheap).

## Data model

```ts
interface LedgerEntry {
  sessionId: SessionId;
  epochId: EpochId;
  turnId: TurnId;
  path: string;                 // workspace-relative, normalized
  contentHash: ContentHash;     // hash of the full file at read time
  range: LineRange | "outline"; // inclusive 1-based lines, or an outline delivery
  symbol?: string;              // when served via read_symbol
  delivery: "full" | "range" | "outline" | "stub" | "diff" | "edit_echo" | "instructions";
  estTokens: number;
  seq: number;
}

interface FileView {            // derived: what the model believes a file looks like
  path: string;
  segments: { range: LineRange; fileHash: ContentHash; regionTextBlob: ContentHash; epochId: EpochId; turnId: TurnId }[];
}
```

`regionTextBlob` refers to a (deduplicated) blob holding the **exact text the model received**
for that range. Storing the text rather than only a hash makes **sub-range** comparisons
possible: Kai can check any lines inside a segment, after line remapping, against the current
file. Unrelated changes elsewhere in the file, or elsewhere in the same segment, do not
invalidate the model's view of the lines that matter.

Sources of ledger entries:
- `read_file` and `read_symbol` deliveries (`full`, `range`, `outline`),
- `edit_echo`: the hunk the Patch Engine returns after an applied edit. The model saw the new
  text, so the ledger records it at the new hash,
- excerpts in an epoch seed (`relevant_code`), recorded with the seed's turn,
- `read_artifact` ranges, keyed by artifact ID instead of path. This includes `web` artifacts
  delivered by `web_open`/`web_find`, so citations can be checked against what was actually
  delivered ([Chrome research](chrome-research.md#citations)),
- `instructions`: a project instruction file delivered in the seed, as a read-time notice, or in
  an instruction-gate refusal. Recorded with its hash. The Patch Engine's
  [instruction gate](patch-engine.md#instruction-gate) asks `instructionsDelivered` before every
  mutation.

## Operations

```ts
interface ReadLedger {
  /** Called by read tools before reading from disk. */
  check(req: { path: string; range?: LineRange; symbol?: string; epochId: EpochId; currentHash: ContentHash }): LedgerCheck;
  /** Record a delivery (after shaping). */
  record(entry: Omit<LedgerEntry, "seq">): void;
  /** For the Patch Engine: did the model see the current text of these lines (match ± context)? */
  regionSeen(path: string, range: LineRange, currentLines: readonly string[]): RegionSeen;
  /** Called on file change notifications (watcher, Kai writes, hash checks). */
  onFileChanged(path: string, newHash: ContentHash, cause: "kai_write" | "external" | "formatter"): StaleRegion[];
  /** For briefs: files read in a task, with symbol cards and staleness. */
  filesRead(taskId: TaskId): FileReadSummary[];
  /** Instruction gate: was this instruction file delivered in this epoch at this hash? */
  instructionsDelivered(path: string, hash: ContentHash, epochId: EpochId): boolean;
}

type LedgerCheck =
  | { action: "serve" }                                              // never seen, or not visible in this epoch
  | { action: "stub"; seenAt: TurnId; range: LineRange }             // identical content already visible
  | { action: "serve_partial"; missing: LineRange[]; seen: LineRange[] } // only the unseen sub-ranges are needed
  | { action: "serve_diff"; since: TurnId; diff: string; estTokens: number }; // changed since seen; small diff
type RegionSeen = "seen_current" | "seen_stale" | "never_seen";
```

## Algorithms

**Visibility.** In chained mode, content delivered in epoch *E* is visible for the rest of *E*.
In local replay mode (stateless) it is visible unless a `ContextElided` event covers that turn. Content from
earlier epochs is **not visible**; the brief carries only symbol cards and notes.

**`check` decision:**
1. Find visible entries for `path` in the current epoch whose `range` overlaps the request.
2. If an entry covers the requested range and its stored text for that range equals the current
   text → `stub`.
3. If entries cover part of the range with current text → `serve_partial`. The tool returns only
   the missing sub-ranges, plus a one-line note naming the already-visible ones. This only
   applies if the missing part is at least 30% of the request; otherwise the whole range is
   served, because fragmenting costs more than it saves.
4. If entries cover the range but the text changed, and the unified diff of the region is smaller
   than 40% of the region's size → `serve_diff`. Otherwise → `serve`, with a staleness note.
5. Otherwise → `serve`.
6. `refresh: true` → always `serve` (counted as `forced_reread`).

**`regionSeen` (edit version check).** The Patch Engine passes the matched lines **plus 3
context lines on each side** (clamped to the file), the same context window `apply_patch` uses.
- `seen_current`: some visible segment covers those lines and its stored text equals the
  current text.
- `seen_stale`: a visible segment covers them but the text differs. The model is editing from an
  outdated view of the edit's surroundings, even if its `old_string` still matches.
- `never_seen`: no visible segment covers them.

**Staleness propagation.** On `onFileChanged`, every visible segment of the path whose stored
text no longer matches the current text (compared per line after remapping) becomes **stale**
for the lines that differ:
- `cause = kai_write`: the edit echo already updated the model's view of the edited region. Only
  *other* regions that shifted or changed (e.g. a formatter ran) are reported.
- `cause = external` or `formatter`: the Context Compiler queues a `stale_files` notice before
  the next request, listing the path and stale ranges. If total stale content is 400 tokens or
  less, the notice includes the **new text** directly (it saves a round-trip). Otherwise it
  includes only ranges.

**Line shifts.** When Kai's own edits shift line numbers below the edit, the ledger **remaps**
the stored segments using the transaction's hunk offsets. An unchanged region that moved is still
"seen". It is not stale; it just has new line numbers.

**Outline deliveries** record the outline's symbol table. A later `read_symbol` for a symbol in
the outline is not a duplicate: the outline has signatures only, not bodies.

## Defaults

| Setting | Default |
|---|---|
| `ledger.enabled` | true (ablation: `--no-ledger`) |
| `ledger.partialMinFraction` | 0.3 |
| `ledger.diffMaxFraction` | 0.4 |
| `ledger.inlineStaleMaxTokens` | 400 |

## Events and telemetry

Events: `SourceRead` (every delivery, including stubs), `ExternalChangeDetected`.

Counters: `reads_total`, `reads_stubbed`, `est_tokens_saved_by_stub`, `reads_partial`,
`reads_diff`, `forced_rereads`, `stale_notices`, `whole_file_reads`, `outline_reads`,
`blind_edits` (edits to never-seen regions, from the Patch Engine).

Duplicate-read *rate* for the benchmark: the share of delivered source tokens whose
(path, region, hash) was already visible in the same epoch. With the ledger enabled it should be
close to 0. Remaining duplicates come only from `refresh`.

## Failure handling

- If the ledger is unsure (missing hash, file unreadable), it returns `serve`. Correctness over
  savings.
- Hash computation for large files (over 2 MB): such files are never served whole. Outline only,
  and range reads hash only the region.

## Acceptance tests

1. Read the same range twice in one epoch → the second is a stub, with token savings recorded.
2. Read A:1–100, then A:50–150 → the second serves only 101–150, with a note.
3. Read lines 40–95, then an external edit changes line 62 → the next request carries a
   `stale_files` notice naming line 62. A replace whose `old_string` is line 61 (unchanged, but
   within 3 lines of the changed line 62) is rejected by the Patch Engine as `seen_stale`, with
   the current text. A replace on line 45 (far from the change) is accepted.
4. Kai's edit inserts 5 lines at line 10 → earlier segments below shift by 5 and remain
   `seen_current`.
5. New epoch → the same read is served in full (not visible), and is not counted as a duplicate.
