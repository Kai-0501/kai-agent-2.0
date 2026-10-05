# Spec: Hallucination Firewall

- Package: `packages/core` (`firewall/`). Language-specific checks are implemented in `packages/code-intel` behind core interfaces.
- Decisions: [ADR-0007](../adr/0007-editing-protocol.md), [ADR-0008](../adr/0008-code-intelligence-lsp.md)
- Research: [SWE-agent lint-gated edit](../research/upstream/swe-agent.md), [Gemini CLI omission detector](../research/upstream/gemini-cli.md), [synthesis §2.4–2.5](../research/synthesis.md#24-the-firewall-must-not-block-legitimate-multi-step-refactors)

## Responsibility

Before an edit transaction reaches the worktree, check the **proposed code** against
**objective repository reality** and **reject** changes that contain hallucination-class
defects. Report everything else as immediate, precise feedback.

**Not responsible for:** proving the change correct (that is verification), style (the linter),
or running tests.

## Design principles

1. **Delta, not absolute.** Only findings *introduced* by the transaction count. Pre-existing
   errors are not the model's fault and must not block it (SWE-agent's rule).
2. **Transaction scope.** All edits of one model response are evaluated together, so a symbol
   defined in one edit and used in another is fine.
3. **Block only on hallucination-class findings.** These almost never represent a legitimate
   intermediate state. Everything else is feedback.
4. **Every rejection must be actionable**: the location, what is wrong, and what *does* exist
   ("did you mean").
5. **Bounded latency**, with graceful degradation to cheaper tiers.

## Interface

```ts
interface HallucinationFirewall {
  evaluate(txn: ProposedTransaction, ctx: FirewallContext, signal: AbortSignal): Promise<FirewallReport>;
}
interface FirewallContext {
  taskId: TaskId;
  overlay: Overlay;                          // proposed contents
  baseline: (path: string) => string | null; // pre-transaction contents
  promissorySymbols: Set<string>;            // update_plan.new_symbols + symbols defined earlier in the task
  scope?: { paths: string[]; symbols?: string[] };
  waivers: Waiver[];                         // explicit, logged overrides
  timeBudgetMs: number;                      // default 2500 total
}
interface FirewallReport {
  verdict: "pass" | "pass_with_warnings" | "reject";
  findings: Finding[];
  checksRun: { id: CheckId; ms: number; degraded?: boolean }[];
}
interface Finding {
  check: CheckId;
  severity: "block" | "warn" | "info";
  path: string;
  range?: LineRange;
  code?: string;                 // e.g. "TS2339", "F-PLACEHOLDER"
  message: string;               // model-facing, one line
  suggestions?: string[];        // did-you-mean symbol cards (path:line signature)
  evidence?: string;             // ≤ 10 lines of proposed code around the location
}
type CheckId = "F0_path" | "F1_parse" | "F2_placeholder" | "F3_import" | "F4_symbol"
             | "F5_dependency" | "F6_member" | "F7_scope" | "F8_integrity" | "F9_secret";
```

## Check pipeline

Checks run cheapest first. Blocking findings from F0–F2 short-circuit the more expensive LSP
checks.

| Check | What | Method | Default severity |
|---|---|---|---|
| **F0 path** | Target inside the workspace; not in `.git/`, `.kai/` internals, or a policy-protected path; not a generated or vendored file per profile | Path rules | block |
| **F1 parse** | Introduces syntax errors | tree-sitter on proposed vs baseline: `ERROR`/`MISSING` node count per file; block if the count increases. Confirmed when available by the language's own parser: LSP **syntactic** diagnostics for TS (fast, no type checking), and `ast.parse` in a persistent Python worker for Python. Kai does not use the TypeScript compiler's JS API ([ADR-0001](../adr/0001-implementation-language-runtime.md)) | block |
| **F2 placeholder** | Omission placeholders in `new_string`/`content` that were not in the replaced text: comments or lines like `// ... rest of code`, `# unchanged`, `/* existing implementation */`, bare `...` lines in non-Python code, `pass  # TODO implement` replacing a non-empty body | Pattern set (Gemini CLI's prefixes plus Kai's), comment-aware via tree-sitter | block |
| **F3 import** | New import of a module that does not resolve: a relative path that does not exist; a bare package not installed (`node_modules`, site-packages) **and** not in the manifest; a named import not exported by the target module | Index `imports` + `exportsOf` + package resolution; LSP TS2307/TS2305/TS2724, Pyright `reportMissingImports` | block (missing module or package); block (missing export, unless it is in `promissorySymbols` or defined in the txn) |
| **F4 symbol** | Introduced reference to an identifier defined nowhere: not in scope, not in the index, not a global or builtin, not defined in the txn, not promissory | LSP diagnostics delta (TS2304/2552, Pyright `reportUndefinedVariable`) when available; else index `definedAnywhere` on identifiers in **call or new expressions** within changed ranges (tree-sitter) | block with LSP; **warn** with index-only fallback |
| **F5 dependency** | A manifest gains a new dependency, or code imports a package absent from the lockfile | Manifest and lockfile diff | warn plus risk +20; block if the package is not resolvable in the registry cache (when available offline) |
| **F6 member** | Access to a property or method that does not exist on a resolved type, or a wrong call arity against real declarations | LSP delta: TS2339/2551/2554/2555/2349, Pyright `reportAttributeAccessIssue`/`reportCallIssue` | **block** when the receiver type comes from an external package or a project symbol not edited in this txn; **warn** when the receiver's type is itself being changed in the txn (likely an in-progress refactor) |
| **F7 scope** | Files outside the declared `scope` (if one was declared); deletion of more than 40 lines of non-test code with intent words absent from `instruction`; formatting-only churn in untouched regions | Diff analysis | warn (scope); info (churn) |
| **F8 integrity** | Test, verification or suppression changes | Delegated to the [Test Integrity Guard](test-integrity-guard.md) | per guard: block (`.only`), warn or flag (others) |
| **F9 secret** | Introduces a likely secret (high-entropy string with key or token naming, known token prefixes) | Pattern plus entropy | warn |

Everything else from LSP (type mismatches, unused variables, lints) is **reported as an
introduced-diagnostics delta** in the edit result. It is never blocking.

## Hallucination-class diagnostic table

Maintained per language server in `packages/code-intel/src/lsp/classes.ts`:

| Server | Codes / rules → class |
|---|---|
| TypeScript (tsserver) | 2304, 2552 → `unknown_identifier`; 2305, 2614, 2724 → `missing_export`; 2307 → `missing_module`; 2339, 2551 → `missing_member`; 2554, 2555 → `wrong_arity`; 2349 → `not_callable`; 2694 → `missing_namespace_member` |
| Pyright / basedpyright | `reportUndefinedVariable` → `unknown_identifier`; `reportAttributeAccessIssue` → `missing_member`; `reportMissingImports`, `reportMissingModuleSource` → `missing_module`; `reportCallIssue` → `wrong_arity`; `reportPrivateImportUsage` → warn |
| gopls (later) | `undefined:` → `unknown_identifier`; `has no field or method` → `missing_member`; `could not import` → `missing_module` |
| rust-analyzer (later) | E0425 → `unknown_identifier`; E0599, E0609 → `missing_member`; E0432, E0433 → `missing_module` |

## Delta computation

- Diagnostics are fingerprinted as `(path, class or code, normalized message, symbol name)`.
  Line numbers are excluded and numbers and quoted literals are normalized.
- `introduced = after − before`, computed on the edited files plus up to **N = 10 dependents**
  (files that import a changed exported symbol, ranked by reference count), opened in the
  overlay.
- The **before** diagnostics come from the LSP snapshot for the same documents. They are cached
  per file hash, so the second transaction on a file pays nothing for "before".

## Latency and degradation

| Budget | Default |
|---|---|
| Total firewall budget | 2,500 ms (TS), 3,500 ms (Python) |
| F0–F2 + F3 (index-based) | ≤ 150 ms typical |
| LSP settle | 150 ms quiet window, 1,500 ms cap (TS) / 2,500 ms (Python) |

If LSP misses the budget: decide with F0–F3 plus the **index-only F4 (warn)**, mark
`degraded: true`, and **continue collecting** LSP diagnostics asynchronously. If they arrive
before the next model request and contain introduced hallucination-class findings, the
transaction is **not rolled back automatically**. A `kai_notice type="late_diagnostics"` is
injected at high priority, and the findings become repair items. (Automatic rollback of applied
code would surprise both the model and the user.)

## Promissory symbols and waivers

- Symbols declared in `update_plan.new_symbols`, or defined in the same transaction or earlier in
  the task, are treated as existing.
- **References to promissory symbols that are still undefined at the verification gate** fail
  verification (`unfulfilled_promise`).
- A **waiver** is created only by the user (via the protocol), or by the project profile
  (`firewall.allowUnresolved: ["generated/*", "window.__APP__"]`). The model cannot waive
  findings. It can only declare promissory symbols, and those must be fulfilled.

## Model-facing rejection format

```
NOT APPLIED — the edit introduces references that do not exist:
• src/users/handlers.ts:42  UserService.findByEmail — no such method on UserService (TS2339).
  Real methods: findById(id: UserId), findOne(where: UserWhere), create(input: CreateUserInput)
  [src/users/service.ts:51,63,77]
• src/users/handlers.ts:3  import { hashPassword } from "../crypto" — "../crypto" exports: hash, verify, randomToken
Nothing was written. Fix these and resend the edit (all edits in this response were rejected).
```

The format is short (≤ 400 tokens), lists real alternatives, and states clearly that nothing was
applied. Per SWE-agent, it also says not to resend the identical edit.

## Telemetry

`firewall_evals`, `firewall_rejects` by class, `firewall_warns` by class, `degraded_evals`,
`late_diagnostics`, latency p50 and p95 per check, `retry_success_after_reject` (whether the
next transaction on the same files passes), and **`invented_symbol_rate`**: hallucination-class
findings per 100 changed lines. These are the benchmark's correctness metrics.

## Acceptance tests (fixtures in TS and Python)

1. A call to a nonexistent method on a project class → reject, with the real methods listed.
2. Import of a nonexistent named export → reject, with the actual exports listed.
3. A rename refactor across 3 files in one response → pass.
4. The same refactor split across two responses with `new_symbols` declared → pass both. With
   the second response never sent → the gate fails `unfulfilled_promise`.
5. `// ... existing code ...` inside `new_string` → reject F2.
6. A file with a pre-existing type error, edited elsewhere → pass (delta).
7. A slow LSP (simulated 5 s) → degraded pass, with a late diagnostics notice before the next
   request.
8. A type mismatch introduced → pass_with_warnings, with the delta shown in the result.
