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
| Keys without a role | Sent to Rust as `configure` (`settings-store.ts`) | Fail-open (slice 2) |
| Revision check | Skipped when the client omits `seen` (except group Take) | Fail-open (slice 2) |
| OSC (`osc.rs`) | Same key check, but skips service, revision, scene-approval and rehearsal-OBS checks; actor recorded as "OSC" | Partial (slice 2) |
| Key store | SHA-256 hashes + role + scopes in the frontend plugin-store, pushed with `remote_set_keys`; no expiry, no issued-at, no audit of grant changes | Partial (slice 3) |
| Scene-edit approvals (`src/stores/scene-approvals-store.ts`) | Client JSON file; any actor string decides; self-approval possible; no expiry; client-rewritable audit | **Not host-authoritative** (slice 3) |
| Program approval (`crates/content/src/revisions.rs`) | SQLite, optimistic revision check, `approved_by` = local operator name | Shipped (local desk only) |
| Native recording | `recorder_*` main-window only (#510); no remote grant | Slice 4 adds the explicit Recorder grant |

## 2. Slices

1. **Window command guard (this PR).** `src-tauri/src/window_acl.rs` wraps the generated handler: `main` may call any app command; `broadcast-*` only `get_ndi_status, push_ndi_frame, push_ndi_region, set_output_pace, whep_offer, recorder_status`; any other label nothing. Refusal: the invoke rejects with `"'<command>' is not available in this window"` and a `warn` log line. Plugin commands stay governed by `capabilities/*.json`.
2. **Close the fail-open defaults (HTTP + OSC).** Open mode stays as the owner designed it (explicit typed opt-in, #496). A stored key without a role = Viewer until re-granted (Rust default + the settings store, coordinated with Codex); `seen` required for every state-changing command once the client sends revisions (a one-release compatibility flag, then mandatory); OSC runs the same service/revision/approval checks and records the device name. Needs a settings migration note for Codex (the Permissions page must show "needs a role").
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
