# Spec: Task Contract (user-owned requirements)

- Package: `packages/core` (`contract/`)
- Decision: [ADR-0015](../adr/0015-user-owned-task-contract.md)
- Collaborators: [Context Compiler](context-compiler.md), [Verification Engine](verification-engine.md), [Test Integrity Guard](test-integrity-guard.md), [Critic](critic.md), [Repair/Replan Controller](repair-replan-controller.md), [protocol](protocol.md)

## Problem

If the model can edit the objective or acceptance criteria, and its own descriptions of its edits
count as justification for changing tests, then Gemini can rewrite the exam before grading itself.
The requirements must have a single, **user-owned** source of truth that the model can read but
never change. Anything the model writes about requirements is commentary.

## Responsibility

- Record the **Task Contract** when a task is submitted: the user's requirements, **verbatim**,
  plus the repository's instruction files, with hashes.
- Accept **amendments only from user actions**. Every amendment is appended, and nothing is ever
  overwritten. Instruction files that change on disk during a task are recorded, but they do not
  amend the contract (see [Events](#events)).
- Give a deterministic **citation check**: does a quoted span exist verbatim in the contract,
  and is it related to a given change?
- Be the **only** source of objective and acceptance criteria for epoch briefs, replan briefs,
  the critic, the verification report and integrity decisions.

**Not responsible for:** interpreting requirements. Interpretation is the model's job. It records
interpretations as model-authored notes, and those never gain authority.

## Authority levels

Every requirement-like statement in Kai has exactly one authority level. Only the first two can
authorize anything.

| Level | Source | Can the model change it? | Can it authorize relaxing a test or check? |
|---|---|---|---|
| **User contract** | `task.submit` prompt and `acceptance`; user steering messages; `task.amend`; user approvals in permission requests | **No** | **Yes**, through a verified citation (below) |
| **Repository instructions** | `AGENTS.md`, `KAI.md`, `GEMINI.md` (root and nested), `.kai/project.json` | No. Changing these files is a verification-config change (Test Integrity Guard I13) | Yes, through citation, but only as committed on disk at task start |
| **Model-authored working state** | `update_plan` (plan, decisions, notes, interpretations, proposed criteria, scope), transaction `instruction`s, `complete_task` claims, test-change `reason` text | Yes | **Never** |

## Data model

```ts
interface TaskContract {
  taskId: TaskId;
  version: number;                       // 1 at submission; +1 per user amendment
  entries: ContractEntry[];              // append-only
  instructionFiles: { path: string; hash: ContentHash; scopeDir: string }[];  // snapshot at task start
  hash: ContentHash;                     // hash over entries + instructionFiles (changes per version)
}

interface ContractEntry {
  id: string;                            // "c1", "c2", ... stable; used in citations
  kind: "prompt" | "acceptance" | "steering" | "amendment" | "approval";
  text: string;                          // VERBATIM user text, never summarized or rewritten
  by: "user";                            // the only allowed value
  source: { protocolMethod: string; seq: number };   // where it came from (audit)
  supersedes?: string[];                 // amendment entries may say which entries they replace (user's choice)
}

interface ContractCitation {
  entryId: string;                       // or an instruction file path
  quote: string;                         // must occur verbatim (whitespace-normalized) in the entry
}
```

Notes:
- **Acceptance criteria are never extracted by a model.** If the user gives an explicit
  `acceptance` list, each item is an `acceptance` entry. Otherwise the prompt itself is the
  acceptance authority, and the brief shows it verbatim.
- **Steering messages are user text**, so they are appended as `steering` entries. A user saying
  "actually, the test is wrong, change it" is therefore a citable authority.
- **Approvals** given in permission requests (e.g. approving a flagged test change) are appended
  as `approval` entries, quoting the approved item.

## Events

- `TaskContractRecorded {taskId, contract}`, at `task.submit`, in the same transaction as
  `TaskCreated`.
- `TaskContractAmended {taskId, version, entry, by: "user"}`, from `task.steer`, `task.amend`
  or `permission.respond` approvals. **Only the protocol handlers for user actions can emit it.**
  It is enforced in code: the event constructor requires a `UserActionToken` that only the KSP
  request handlers can mint, and the Turn Loop and tool executors never get one.
- `InstructionFilesChanged {paths, hashes}`, when repository instruction files change on disk
  during a task. These are recorded, but **do not amend the contract**, because a change made by
  the model itself would be self-authorization. The user is asked to confirm whether a change
  made outside Kai applies to the running task.

## How other subsystems use it

| Subsystem | Use |
|---|---|
| **Context Compiler** | The epoch brief starts with a `<task_contract>` section: the entries **verbatim**, in order (capped at `contractMaxTokens`, default 3k; beyond that, the oldest steering entries collapse to "see contract entry cN" pointers, while the prompt and acceptance entries are always kept whole). Model-authored state follows under a separate `<working_state author="model">` heading. |
| **`update_plan`** | Cannot set the objective or acceptance criteria. It can add `interpretations` and `proposed_criteria`, which are model-authored and non-authoritative ([tool-surface](tool-surface.md#update_plan-kai)). |
| **Verification Engine** | Evidence is reported against contract entries. Proposed criteria are listed as "model-proposed (not required)". |
| **Test Integrity Guard** | A test-change justification is **contract-backed** only if it carries a valid `ContractCitation` that passes the relatedness check below. Transaction `instruction`s, plan text and notes are never evidence. |
| **Critic** | Receives the contract, not model restatements of it. Its `requirements` findings are checked against contract entries. |
| **Repair/Replan** | The replan brief's objective and acceptance sections are copied from the contract. |

## Citation check (deterministic)

`verifyCitation(contract, citation, change)` returns `valid | not_found | unrelated`:

1. **Existence.** After whitespace normalization, `citation.quote` must be a substring of the
   cited entry's `text`, or of the cited instruction file at its task-start hash, and must be at
   least 12 characters long.
2. **Relatedness.** The quote must share at least one *significant token* with the change. A
   significant token is an identifier or word of 4 or more characters, excluding stop-words and
   test-framework words. It must appear in at least one of: the test's name or `describe` path,
   the test file path, the changed assertion's expression, or the production symbols changed by
   the task whose behaviour the test exercises (from the index call graph).
3. Otherwise → `unrelated` (or `not_found`).

The check is heuristic in step 2, but it can only use **user text** as the authority. A model
that quotes unrelated user text fails step 2. A model that quotes related user text has quoted
the user's actual requirement. High-severity changes still need an independent review in
addition to the citation ([test-integrity-guard](test-integrity-guard.md#justification-and-review)).

## Protocol

- `task.submit {prompt, acceptance?}` creates the contract (version 1).
- `task.amend {taskId, text, supersedes?}`: user-only. Appends an `amendment` entry.
- `task.steer {taskId, message}` appends a `steering` entry and also delivers the message to the
  model.
- The `SessionSnapshot` and `TaskReport` include the contract (version, entries, hash), so the
  user always sees what the task was graded against.

## Acceptance tests

1. No code path reachable from the Turn Loop or tool executors can emit `TaskContractAmended`.
   This is a type-level test (the `UserActionToken` cannot be constructed outside the protocol
   handlers) plus a runtime test.
2. `update_plan` with an `objective` field is rejected by schema. With `proposed_criteria`, the
   brief shows them under the model-authored section, and the contract is unchanged.
3. A justification citing a transaction `instruction` string (not in the contract) → `not_found`.
4. A justification quoting the user's prompt sentence that names the changed function →
   `valid`. Quoting an unrelated sentence from the prompt → `unrelated`.
5. A steering message "the expected value in the date test is wrong; it should be UTC" → a
   `steering` entry, and a later `I5_expectation_changed` on that test with this quote → valid.
6. The model editing `AGENTS.md` during the task → `InstructionFilesChanged` is recorded, the
   contract still holds the task-start version, and I13 is flagged.
