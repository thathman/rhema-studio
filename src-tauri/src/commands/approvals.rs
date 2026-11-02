//! Approval requests on the host (C3 slice 3, `docs/contracts/host-permissions-v1.md`). Desks submit
//! through the control server (a scene change their role may only ask for is recorded here before
//! the main desk hears of it); the main desk decides with these commands. The rules (nobody decides
//! their own request, decide once, expiry, stale requests are not applied) are the database's.

use rhema_content::{Actor, ApprovalEvent, ApprovalRequest, ApprovalRequestInput, ContentDb, Decision};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use super::content::{with_db, CmdResult, ContentCommandError, ContentState};

/// The main desk as an approver: one identity, whoever is at it (its operator name is shown).
fn main_desk() -> Actor {
    Actor { id: "main-desk".into(), name: "Main desk".into() }
}

fn main_window_only(window: &WebviewWindow) -> CmdResult<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(ContentCommandError::Refused { message: "Requests are decided at the main desk.".into(), code: "not-allowed" })
    }
}

#[tauri::command]
pub fn approvals_list(state: State<'_, ContentState>, status: Option<String>, requester_id: Option<String>) -> CmdResult<Vec<ApprovalRequest>> {
    with_db(&state, |db| db.list_approval_requests(status.as_deref(), requester_id.as_deref()))
}

#[tauri::command]
pub fn approvals_decide(app: AppHandle, window: WebviewWindow, state: State<'_, ContentState>, id: String, decision: Decision, note: Option<String>) -> CmdResult<ApprovalRequest> {
    main_window_only(&window)?;
    request_authority(&app, &with_db(&state, |db| db.approval_request(&id))?)?;
    with_db(&state, |db| db.decide_approval_request(&id, &main_desk(), decision, note.as_deref()))
}

/// Approval changes are accepted only on the authoritative host (`remote::approval_authority`).
fn check_host_bound(bound: bool) -> Result<(), &'static str> {
    if !bound {
        return Err("This copy of Rhema Studio is not hosting, so it cannot handle approvals. Start hosting here, or use the copy that is.");
    }
    Ok(())
}

fn check_revision_floor(reserved: bool) -> Result<(), &'static str> {
    if !reserved {
        return Err("Rhema Studio could not reserve its revision numbers in its data folder, so scene approvals are off until it restarts. Check the disk.");
    }
    Ok(())
}

fn check_authority(bound: bool, reserved: bool) -> Result<(), &'static str> {
    check_host_bound(bound)?;
    check_revision_floor(reserved)
}

/// Every approval mutation belongs to the copy whose listener successfully bound. Scene approvals
/// additionally require their cross-process revision floor so stale scene requests fail closed.
fn check_request_authority(kind: &str, bound: bool, reserved: bool) -> Result<(), &'static str> {
    check_host_bound(bound)?;
    if matches!(kind, "scene_save" | "scene_delete") {
        check_revision_floor(reserved)?;
    }
    Ok(())
}

fn request_authority(app: &AppHandle, request: &ApprovalRequest) -> CmdResult<()> {
    let (bound, reserved) = super::remote::approval_authority(app);
    check_request_authority(&request.kind, bound, reserved)
        .map_err(|message| ContentCommandError::Refused { message: message.into(), code: "not-authority" })
}

/// The revision a scene request is judged against, read by the host and never taken from the caller.
/// Deleting a scene on a screen would clear that screen, so it is refused until the screen has moved on.
fn scene_apply_revision(kind: &str, target: &str, live: Option<&str>, revision: impl Fn(&str) -> Option<u64>) -> CmdResult<Option<i64>> {
    let Some(on_screen) = rhema_api::scene_edits::scene_on_screen(live, target) else {
        return Err(ContentCommandError::Refused { message: "The host has not shared its scenes yet; try again in a moment.".into(), code: "no-live-state" });
    };
    if kind == "scene_delete" && on_screen {
        return Err(ContentCommandError::Refused { message: "That scene is still on a screen; move each output to another scene first.".into(), code: "on-screen" });
    }
    Ok(revision(&format!("scene:{target}")).and_then(|r| i64::try_from(r).ok()))
}

/// The main desk carries out an approved request. For a plan the host reads the plan itself. For a
/// scene the host checks the scene has not changed and marks the request applied; the returned
/// request's payload is what the main desk then saves, because the scene library lives in that
/// window. `current_revision` counts only for other kinds.
// ponytail: applied is recorded just before the window saves, so a crash in that instant asks the desk to resend; a host-owned scene store closes it.
#[tauri::command]
pub fn approvals_apply(app: AppHandle, window: WebviewWindow, state: State<'_, ContentState>, id: String, current_revision: Option<i64>) -> CmdResult<ApprovalRequest> {
    main_window_only(&window)?;
    let request = with_db(&state, |db| db.approval_request(&id))?;
    request_authority(&app, &request)?;
    let current_revision = match request.kind.as_str() {
        "scene_save" | "scene_delete" => {
            let live = super::remote::current_live_state(&app);
            scene_apply_revision(&request.kind, &request.target_id, live.as_deref(), |part| super::remote::current_revision(&app, part))?
        }
        _ => current_revision,
    };
    if request.kind == "stage_send" {
        // Still a stage display now, or the message goes nowhere.
        let live = super::remote::current_live_state(&app);
        if !stage_display_now(live.as_deref(), &request.target_id) {
            return Err(ContentCommandError::Refused { message: "That stage display is no longer on the host.".into(), code: "gone" });
        }
    }
    let applied = with_db(&state, |db| db.apply_approval_request(&id, &main_desk(), current_revision))?;
    if applied.kind == "stage_send" {
        // Delivered as any stage message for one display; the window shows it there.
        let p = &applied.payload;
        let _ = app.emit_to("main", "remote:stage_send", serde_json::json!({ "target": p["target"], "text": p["text"], "by": applied.requester.name, "approvedBy": "Main desk" }).to_string());
    }
    Ok(applied)
}

/// Whether `target` is one of the host's stage outputs in its Live State now.
fn stage_display_now(live: Option<&str>, target: &str) -> bool {
    live.and_then(|j| serde_json::from_str::<serde_json::Value>(j).ok())
        .and_then(|v| v.get("outputs").and_then(serde_json::Value::as_array).cloned())
        .is_some_and(|outs| outs.iter().any(|o| o.get("id").and_then(serde_json::Value::as_str) == Some(target) && o.get("role").and_then(serde_json::Value::as_str) == Some("stage")))
}

#[tauri::command]
pub fn approvals_history(state: State<'_, ContentState>, id: String) -> CmdResult<Vec<ApprovalEvent>> {
    with_db(&state, |db| db.approval_history(&id))
}

/// The request a desk's scene event asks for: only `remote:save_scene` / `remote:delete_scene`
/// carrying `request: true` (the control server's verdict that this role may only ask).
fn scene_request(event: &str, v: &serde_json::Value) -> Option<(Actor, ApprovalRequestInput)> {
    let text = |k: &str| v.get(k).and_then(serde_json::Value::as_str);
    // A Stage desk's message for a stage display not assigned to it (doc 35, page 6).
    if event == "remote:stage_send_request" {
        let requester = Actor { id: text("byId").unwrap_or("unknown-desk").to_string(), name: text("by").unwrap_or("A desk").to_string() };
        return Some((
            requester,
            ApprovalRequestInput {
                kind: "stage_send".into(),
                target_id: text("target").unwrap_or_default().to_string(),
                base_revision: None,
                payload: serde_json::json!({ "target": text("target"), "text": text("text") }),
                reason: text("why").map(str::to_string),
                ttl_secs: Some(10 * 60),
            },
        ));
    }
    let kind = match event {
        "remote:save_scene" => "scene_save",
        "remote:delete_scene" => "scene_delete",
        _ => return None,
    };
    if v.get("request").and_then(serde_json::Value::as_bool) != Some(true) {
        return None;
    }
    let target = text("id").or_else(|| v.pointer("/scene/id").and_then(serde_json::Value::as_str)).unwrap_or_default();
    let requester = Actor { id: text("byId").unwrap_or("unknown-desk").to_string(), name: text("by").unwrap_or("A desk").to_string() };
    Some((
        requester,
        ApprovalRequestInput {
            kind: kind.into(),
            target_id: target.to_string(),
            // Set by the control server (never by the desk): what the scene was when this was asked.
            base_revision: v.get("baseRevision").and_then(serde_json::Value::as_i64),
            payload: v.clone(),
            reason: text("why").map(str::to_string),
            ttl_secs: None,
        },
    ))
}

/// Add persisted host request metadata before a desk's scene-change event can be emitted.
pub(super) fn record_scene_request_with(
    event: &str,
    payload: &str,
    persist: impl FnOnce(&Actor, &ApprovalRequestInput) -> Result<(String, String), String>,
) -> Result<String, String> {
    let mut v = match serde_json::from_str::<serde_json::Value>(payload) {
        Ok(value) => value,
        Err(error) if matches!(event, "remote:save_scene" | "remote:delete_scene" | "remote:stage_send_request") => {
            log::warn!("approval request not recorded: invalid scene request payload: {error}");
            return Err("The host could not read the approval request.".into());
        }
        Err(_) => return Ok(payload.to_string()),
    };
    let Some((requester, input)) = scene_request(event, &v) else { return Ok(payload.to_string()) };
    let (request_id, expires_at) = persist(&requester, &input)?;
    v["requestId"] = serde_json::Value::String(request_id);
    v["expiresAt"] = serde_json::Value::String(expires_at);
    Ok(v.to_string())
}

/// A desk's scene change that must wait for the main desk is recorded on the host first. Any
/// missing or failed database path returns an error so the caller cannot emit an untracked request.
pub fn record_scene_request(app: &tauri::AppHandle, event: &str, payload: &str) -> Result<String, String> {
    record_scene_request_with(event, payload, |requester, input| {
        let (bound, reserved) = super::remote::approval_authority(app);
        check_authority(bound, reserved).map_err(|why| {
            log::warn!("approval request not recorded: {why}");
            why.to_string()
        })?;
        let Some(state) = app.try_state::<ContentState>() else {
            return Err("The host approval database is unavailable.".into());
        };
        let guard = state.0.lock().map_err(|error| {
            log::warn!("approval request not recorded: content database lock unavailable: {error}");
            "The host could not save the approval request.".to_string()
        })?;
        let db: &ContentDb = guard.as_ref().ok_or_else(|| {
            log::warn!("approval request not recorded: content database is not open");
            "The host approval database is unavailable.".to_string()
        })?;
        db.submit_approval_request(requester, input)
            .map(|saved| (saved.id, saved.expires_at))
            .map_err(|error| {
                log::warn!("approval request not recorded: {error}");
                "The host could not save the approval request.".to_string()
            })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stage_message_for_an_unassigned_display_is_recorded_as_a_request() {
        let payload = serde_json::json!({ "target": "choir", "text": "Two minutes", "by": "Stage desk", "byId": "k1", "why": "Choir needs it" }).to_string();
        let mut seen = None;
        let out = record_scene_request_with("remote:stage_send_request", &payload, |who, input| {
            seen = Some((who.clone(), input.kind.clone(), input.target_id.clone(), input.payload.clone(), input.reason.clone()));
            Ok(("r1".into(), "2026-11-02T22:10:00Z".into()))
        })
        .unwrap();
        let (who, kind, target, body, why) = seen.expect("persisted before anything is emitted");
        assert_eq!((who.id.as_str(), kind.as_str(), target.as_str(), why.as_deref()), ("k1", "stage_send", "choir", Some("Choir needs it")));
        assert_eq!(body, serde_json::json!({ "target": "choir", "text": "Two minutes" }), "only what is delivered on approval");
        assert!(out.contains(r#""requestId":"r1""#), "{out}");
        // A failed save never lets the request go untracked.
        assert!(record_scene_request_with("remote:stage_send_request", &payload, |_, _| Err("db down".into())).is_err());
    }

    #[test]
    fn an_approved_stage_message_goes_only_to_a_stage_display_still_there() {
        let live = r#"{"outputs":[{"id":"main","role":"congregation"},{"id":"choir","role":"stage"}]}"#;
        assert!(stage_display_now(Some(live), "choir"));
        assert!(!stage_display_now(Some(live), "main"), "never a congregation screen");
        assert!(!stage_display_now(Some(live), "gone"));
        assert!(!stage_display_now(None, "choir"));
    }

    #[test]
    fn only_a_bound_host_with_reserved_revisions_handles_scene_approvals() {
        assert!(check_authority(true, true).is_ok());
        assert!(check_authority(false, true).unwrap_err().contains("not hosting"), "a second copy that lost the port");
        assert!(check_authority(true, false).unwrap_err().contains("reserve"), "revisions another run might share");
        assert!(check_authority(false, false).is_err());
    }

    #[test]
    fn every_approval_mutation_requires_the_bound_host_and_scenes_require_reserved_revisions() {
        assert!(check_request_authority("plan_approve", true, false).is_ok(), "plan approvals need the bound host, not scene revision numbers");
        assert!(check_request_authority("plan_approve", false, true).unwrap_err().contains("not hosting"));
        assert!(check_request_authority("scene_save", true, false).unwrap_err().contains("reserve"));
        assert!(check_request_authority("scene_delete", true, true).is_ok());
        assert!(check_request_authority("scene_delete", false, true).unwrap_err().contains("not hosting"));
    }

    #[test]
    fn only_a_scene_change_the_server_marked_as_a_request_becomes_one() {
        let save = serde_json::json!({ "scene": { "id": "s1", "revision": 99, "name": "Sermon" }, "request": true, "baseRevision": 4, "by": "Screens desk", "byId": "abc" });
        let (who, input) = scene_request("remote:save_scene", &save).unwrap();
        assert_eq!((who.id.as_str(), who.name.as_str()), ("abc", "Screens desk"));
        assert_eq!((input.kind.as_str(), input.target_id.as_str(), input.base_revision), ("scene_save", "s1", Some(4)));
        let delete = serde_json::json!({ "id": "s2", "request": true, "by": "Worship", "byId": "def" });
        assert_eq!(scene_request("remote:delete_scene", &delete).unwrap().1.target_id, "s2");
        assert!(scene_request("remote:save_scene", &serde_json::json!({ "scene": { "id": "s1" }, "request": false })).is_none(), "saved directly: no request");
        assert!(scene_request("remote:next", &save).is_none());
    }

    #[test]
    fn the_main_desk_decides_a_desks_request_and_cannot_be_the_requester() {
        let db = ContentDb::open_in_memory().unwrap();
        let save = serde_json::json!({ "scene": { "id": "s1", "revision": 4 }, "request": true, "by": "Screens desk", "byId": "abc" });
        let (who, input) = scene_request("remote:save_scene", &save).unwrap();
        let r = db.submit_approval_request(&who, &input).unwrap();
        let decided = db.decide_approval_request(&r.id, &main_desk(), Decision::Approve, None).unwrap();
        assert_eq!(decided.decided_by.map(|a| a.id), Some("main-desk".to_string()));
        // A forged request that claims to come from the main desk can never be approved by it.
        let forged = serde_json::json!({ "scene": { "id": "s1" }, "request": true, "by": "Main desk", "byId": "main-desk" });
        let (who, input) = scene_request("remote:save_scene", &forged).unwrap();
        let r = db.submit_approval_request(&who, &input).unwrap();
        assert!(db.decide_approval_request(&r.id, &main_desk(), Decision::Approve, None).is_err());
    }

    #[test]
    fn a_scene_request_is_applied_only_against_the_hosts_own_revision() {
        let db = ContentDb::open_in_memory().unwrap();
        let live = serde_json::json!({ "scenes": [{ "id": "s1", "name": "Sermon" }] }).to_string();
        let live = Some(live.as_str());
        let submit = |base: i64| {
            let save = serde_json::json!({ "scene": { "id": "s1" }, "request": true, "baseRevision": base, "by": "Screens", "byId": "abc" });
            let (who, input) = scene_request("remote:save_scene", &save).unwrap();
            let r = db.submit_approval_request(&who, &input).unwrap();
            db.decide_approval_request(&r.id, &main_desk(), Decision::Approve, None).unwrap().id
        };
        let unchanged = submit(4);
        let now = scene_apply_revision("scene_save", "s1", live, |part| (part == "scene:s1").then_some(4)).unwrap();
        assert_eq!(db.apply_approval_request(&unchanged, &main_desk(), now).unwrap().state, "applied");
        let changed = submit(4);
        let now = scene_apply_revision("scene_save", "s1", live, |_| Some(5)).unwrap();
        assert!(db.apply_approval_request(&changed, &main_desk(), now).is_err(), "the scene moved on");
        assert_eq!(db.approval_request(&changed).unwrap().state, "superseded");
    }

    #[test]
    fn deleting_a_scene_on_a_screen_or_with_no_live_state_is_refused() {
        let code = |r: CmdResult<Option<i64>>| match r {
            Err(ContentCommandError::Refused { code, .. }) => code,
            other => panic!("not refused: {other:?}"),
        };
        assert_eq!(code(scene_apply_revision("scene_delete", "s1", None, |_| None)), "no-live-state");
        let live = serde_json::json!({ "scenes": [{ "id": "s1", "onScreen": true }, { "id": "s2", "onScreen": false }] }).to_string();
        assert_eq!(code(scene_apply_revision("scene_delete", "s1", Some(&live), |_| Some(1))), "on-screen");
        assert_eq!(scene_apply_revision("scene_delete", "s2", Some(&live), |_| Some(1)).unwrap(), Some(1));
        assert_eq!(scene_apply_revision("scene_save", "s1", Some(&live), |_| Some(1)).unwrap(), Some(1), "a change may wait on a screen, then be saved");
    }

    #[test]
    fn failed_persistence_refuses_to_produce_an_emittable_request() {
        let payload = serde_json::json!({ "scene": { "id": "s1" }, "request": true, "by": "Screens", "byId": "screens-1" }).to_string();
        let result = record_scene_request_with("remote:save_scene", &payload, |_, _| {
            Err("database unavailable".to_string())
        });
        assert_eq!(result, Err("database unavailable".to_string()));
    }

    #[test]
    fn malformed_scene_request_payload_is_refused() {
        let result = record_scene_request_with("remote:save_scene", "{", |_, _| {
            panic!("malformed requests must not reach persistence")
        });
        assert_eq!(result, Err("The host could not read the approval request.".to_string()));
    }
}
