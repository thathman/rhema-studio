# Contract — approval requests v1 (C3 slice 3)

Part of [host permissions v1](host-permissions-v1.md) (#512). **Owner:** Claude (host). **UI:** Codex (Approval Requests inbox, the requesting desk's "waiting / answered" state).

## What changes

Until now a desk's scene change that its role may only *ask* for (`scene_edits::judge` → `Verdict::Request`) went to the main desk as an event, and the request lived in the frontend file `scene-approvals.json`. Any actor string could decide it, self-approval was possible, and its audit could be rewritten. The host now records each such request in SQLite (migration `0017_approval_requests`) **before** the event goes out, and adds `requestId` and `expiresAt` to the `remote:save_scene` / `remote:delete_scene` payload.

## Model (`rhema_content::approvals`, serialised camelCase)

```ts
type ApprovalState = "submitted" | "approved" | "declined" | "requested_changes" | "applied" | "expired" | "withdrawn" | "superseded"
interface Actor { id: string; name: string }            // a key's hash, or "main-desk"
interface ApprovalRequest {
  id: string; kind: "scene_save" | "scene_delete" | string; targetId: string; baseRevision: number | null
  requester: Actor; payload: unknown; reason: string | null; state: ApprovalState
  createdAt: string; expiresAt: string; decidedBy: Actor | null; decidedAt: string | null; decisionNote: string | null
}
interface ApprovalEvent { seq: number; at: string; actor: Actor; action: string; detail: string | null }
type Decision = "approve" | "decline" | "request_changes"
```

## Rules (enforced by the host; the first two also by the schema)

| Rule | Where | Refusal `code` |
| --- | --- | --- |
| Nobody decides their own request | Rust + `CHECK (decided_by_id <> requester_id)` | `self-approval` |
| History is append-only | triggers on `approval_events` refuse UPDATE/DELETE | (database error) |
| Decide once | `UPDATE … WHERE state = 'submitted'` | `already-decided` |
| Expiry (default 24 h, max 7 days) | checked at decision and on listing | `expired` |
| Applied only if its base revision is still current | `approvals_apply` | `stale` (request becomes `superseded`) |
| Only approved requests are applied | `approvals_apply` | `not-approved` |
| Only the requester withdraws, only before a decision | `withdraw_approval_request` | `not-withdrawable` |
| A newer request from the same desk for the same target supersedes its older one | submit | — |

## Commands (Tauri)

| Command | Who | Returns |
| --- | --- | --- |
| `approvals_list({status?, requesterId?})` | main window | `ApprovalRequest[]` (newest first; overdue ones marked expired first) |
| `approvals_decide({id, decision, note?})` | **main window only** (`not-allowed` elsewhere); decider = `main-desk` | `ApprovalRequest` |
| `approvals_apply({id, currentRevision?})` | **main window only** | `ApprovalRequest` |
| `approvals_history({id})` | main window | `ApprovalEvent[]` |

Errors use the existing `ContentCommandError` shape plus the new `{ kind: "refused", code, message }`.

## For Codex

The inbox reads `approvals_list`. Decide calls `approvals_decide`; once the scene is saved, `approvals_apply` with the scene's current revision. The requesting desk's event carries `requestId`. `scene-approvals-store.ts` can then stop being the record: import its open requests once if wanted, then keep it read-only.

## Not in this slice

- Desks submitting or withdrawing other kinds of request over HTTP (`/api/v1/requests`), and showing their own requests. Today requests arrive only through the scene path.
- Grants with expiry (`access_grants`).
- The Recorder grant (slice 4).

## Rollback

- Additive migration with a backup (`studio.db.before-0017_approval_requests.bak`).
- An older build refuses a newer database by design (`NewerSchema`), so roll back by restoring that backup.
- Reverting the code alone leaves the two new tables unused.
