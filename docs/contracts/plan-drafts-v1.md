# Contract — plan drafts from LAN desks v1 (C5 slice 1)

**Owner:** Claude (host API, store). **UI:** Codex (Page 9 Editor: Save Draft / Submit for Review; main desk Approval Requests inbox). Docs [34 §2–4](../rhema-studio/34-browser-operators-connected-development.md), [43 §9](../rhema-studio/43-editor-operator-page-9-layout-proposal.md), C3 [approval requests](approval-requests-v1.md).

## Audit (main before this PR)

| Piece | Where | Status |
| --- | --- | --- |
| Service plan with revision check | `ContentDb::replace_items(id, expected_revision, items)` | shipped (main desk only) |
| Approved revision pinned for Live | `approve_program[_with_designs]`, `programs.approved_revision` | shipped |
| Who saved each revision | `program_revisions.saved_by` (0011), from the operator name on this computer | shipped; a desk's save would have been recorded as the local operator |
| Approval requests (no self-approval, expiry, stale) | `approval_requests` (0017) | shipped; only scene requests reach it |
| A desk reading or saving a plan | — | **not built** (this PR) |
| Planning from home (WAN) | — | **not built; needs the owner's approval of a secure sync/relay model** (doc 34 §1: never expose the LAN listener to the Internet) |

## HTTP (paired key; JSON)

Request bodies are camelCase; `Program`, `ProgramItem` and `ItemInput` keep the services store's existing snake_case fields (`approved_revision`, `book_number`, …), the same as the Tauri `content_*` commands. `ApprovalRequest` is camelCase as in the approvals contract.

| Route | Roles | Result |
| --- | --- | --- |
| `GET /api/v1/plans` | Editor, Configure, Present | `Program[]` in use (not archived, not templates) |
| `GET /api/v1/plans/{id}` | Editor, Configure, Present | `{ program, items }` (`program.revision`, `program.approved_revision`) |
| `PUT /api/v1/plans/{id}` `{ expectedRevision, items: ItemInput[] }` | Editor, Configure | `{ program, items }` at the next revision |
| `POST /api/v1/plans/{id}/submit` `{ revision, note? }` | Editor, Configure | `ApprovalRequest` (`kind: "plan_approve"`, `baseRevision: revision`) |

Refusals: no key `401`; another role `403`; paused key `423` for PUT/submit (it still reads); unknown plan `404`; bad item or revision `< 1` or more than 500 items `422`; **stale revision `409 { expected, actual }`**: reopen, never overwrite; services store unavailable `503`. Bible, Worship, Screens, Stage, Camera, OBS, Timekeeper and Viewer desks get nothing.

## Rules

- A save never approves: `approved_revision` (what Live uses) is unchanged until the main desk approves.
- A submit pins the exact revision the desk saw: it is refused (`409`) if the plan has moved since.
- The revision and audit rows record the **desk's name** (`as_actor`), not the operator signed in at the host.
- The main desk hears `remote:plan_saved {id, revision, by}` and `remote:plan_submitted {id, revision, requestId, by}`. Nothing here emits a Live command.
- No self-approval: the requester is the desk's key hash; the main desk decides as `main-desk` (0017 rules).

## Main desk (Codex)

The inbox lists `plan_approve` requests from `approvals_list`. **Approve** = `approvals_decide(id, "approve")`. Then use the existing Prepare approval (`content_approve_program_with_designs(programId, request.baseRevision, …)`, which freezes designs as today); if it returns `conflict`, the plan moved: tell the reviewer. Last, call `approvals_apply(id, currentRevision = request.baseRevision)` to close the request. The host never approves a plan by itself, so the design snapshot stays the main desk's.

## Not in this slice

Comments and per-item assignment (Page 9 left column), design drafts over HTTP (after #523), the home relay (owner decision), and redaction of private stage notes for Present desks (they already see the plan at the main desk).

## Rollback

Revert the PR: no migration, no data change.
