# Contract — host permissions v1 (C3)

**Owner:** Claude (host/API). **UI consumer:** Codex (Permissions workspace, Approval Requests inbox, "Your access").
Implements the C3 row of [OWNER-DUAL-AGENT-DELIVERY](../OWNER-DUAL-AGENT-DELIVERY-2026-10-29.md) and the host side of
[37 — permissions and authority](../rhema-studio/37-permissions-sidebar-and-authority-design.md). Delivered in slices, each its own PR.

## 1. Audit (fork/main d9e21894)

| Path | As built | Status |
| --- | --- | --- |
| Tauri app commands (`src-tauri/src/lib.rs` handler, `capabilities/*.json`) | Every one of ~147 commands callable from `main` **and every `broadcast-*` output window**; only `app_close` checked the caller | **Fail-open → fixed in slice 1** |
| HTTP `/api/v1/command` (`crates/api/src/http.rs`) | Key → `KeyEntry::allows` → `Role::allows`; Screens output/group scopes; service and revision (`seen`) checks; idempotent ids | **Shipped**, with fail-open spots below |
| Open mode (`require_auth=false`) | Any LAN peer acts as **Configure** (only group Take refused) | **Owner decision (#496):** an explicit opt-in behind typing `ALLOW UNAUTHENTICATED LAN CONTROL`; kept as is |
| Keys without a role | Frontend sends `viewer` (#519); the host's own default for a stored entry with no role is `Viewer` too | **Fixed (slice 2)** |
| Revision check | Skipped when the client omits `seen` (except group Take) | By design for simple controllers (Stream Deck, OSC) that cannot know revisions; desks send `seen`. Making it mandatory is an owner decision, not a fix |
| OSC (`osc.rs`, `coerce.rs::parse_osc`) | Same key, pause, role and Screens-scope checks as HTTP. It can only send simple presenting commands (next/prev, show/hide, take/release scene, theme, opacity…): no OBS, scene save/delete or timers, so HTTP's rehearsal-OBS and scene-approval checks have nothing to guard there. Actor was recorded as "OSC" | **Fixed in this PR:** journalled as the key's device name and hash |
| Key store | SHA-256 hashes + role + scopes in the frontend plugin-store, pushed with `remote_set_keys`; no expiry, no issued-at, no audit of grant changes | Partial (slice 3) |
| Scene-edit approvals (`src/stores/scene-approvals-store.ts`) | Client JSON file; any actor string decides; self-approval possible; no expiry; client-rewritable audit | **Not host-authoritative** (slice 3) |
| Program approval (`crates/content/src/revisions.rs`) | SQLite, optimistic revision check, `approved_by` = local operator name | Shipped (local desk only) |
| Native recording | `recorder_*` main-window only (#510); no remote grant | Slice 4 adds the explicit Recorder grant |

## 2. Slices

1. **Window command guard (this PR).** `src-tauri/src/window_acl.rs` wraps the generated handler: `main` may call any app command; `broadcast-*` only `get_ndi_status, push_ndi_frame, push_ndi_region, set_output_pace, whep_offer, recorder_status`; any other label nothing. Refusal: the invoke rejects with `"'<command>' is not available in this window"` and a `warn` log line. Plugin commands stay governed by `capabilities/*.json`.
2. **Remaining fail-open default.** Open mode stays as the owner designed it (explicit typed opt-in, #496). A stored key without a role must become Viewer until re-granted: today `settings-store.ts` sends `role ?? "configure"` (a locked frontend file: Codex, or Claude with a lock). The Permissions page then shows "needs a role".
3. **Host-authoritative grants and Approval Requests (SQLite, migration 0017).** Tables `access_grants` (key hash, role, output/group scopes, issued_at, expires_at, revoked_at, granted_by) and `approval_requests` (id, kind, target + base revision, requester key, payload JSON, state `submitted|approved|declined|requested_changes|applied|expired|withdrawn|superseded`, decided_by, decided_at, expires_at) plus append-only `approval_events`. Rules: no self-approval (decider key ≠ requester key, enforced in SQL and Rust); decide-once (`UPDATE … WHERE state='submitted'`); expiry checked at decision and apply time; revision re-checked at apply. HTTP `POST /api/v1/requests`, `POST /api/v1/requests/{id}/decision`, `GET /api/v1/requests?mine`. Scene-edit requests move from `scene-approvals.json` to this table (one-time import, then the file is read-only).
4. **Recorder grant.** Capability `record` on a grant (not implied by Obs/Screens/Present/Stage); `POST /api/v1/command` actions `record.start|stop|marker` dispatch to the same `rhema-recorder` session; every start/stop in `approval_events`-style audit.

Each slice: Rust tests for every denial, the native QA journey where a window or device is involved, and an additive migration with rollback notes.

## 3. Slice 1 contract

- **Model:** `may_call(label, command) -> bool`; default deny.
- **Denials:** an output window calling e.g. `remote_set_keys`, `remote_pair_start`, `start_http`, `feeds_set`, `publish_live_state`, `media_delete`, `recorder_start` is refused; an unknown label is refused everything.
- **Compatibility:** the output page (`src/broadcast-output.tsx` and what it imports) uses only the allowed commands (checked against the built bundle). A new command an output window needs must be added to `OUTPUT_WINDOW_COMMANDS` in the same PR.
- **Rollback:** revert the PR; no data or migration.
- **Licence:** no new dependency.

## 4. Tests

- Unit: `window_acl` — main may call anything; output windows only their five(+recorder) commands; unknown labels nothing.
- Native: QA build — from an output window, `remote_set_keys` and `start_http` are refused while frames/pace still work; the main window is unaffected; existing native journeys (CI `desktop-qa.yml`) pass.
