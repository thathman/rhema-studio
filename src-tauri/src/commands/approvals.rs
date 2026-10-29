//! Approval requests on the host (C3 slice 3, `docs/contracts/host-permissions-v1.md`). Desks submit
//! through the control server (a scene change their role may only ask for is recorded here before
//! the main desk hears of it); the main desk decides with these commands. The rules (nobody decides
//! their own request, decide once, expiry, stale requests are not applied) are the database's.

use rhema_content::{Actor, ApprovalEvent, ApprovalRequest, ApprovalRequestInput, ContentDb, Decision};
use tauri::{Manager, State, WebviewWindow};

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
pub fn approvals_decide(window: WebviewWindow, state: State<'_, ContentState>, id: String, decision: Decision, note: Option<String>) -> CmdResult<ApprovalRequest> {
    main_window_only(&window)?;
    with_db(&state, |db| db.decide_approval_request(&id, &main_desk(), decision, note.as_deref()))
}

/// The main desk carried out an approved request; `current_revision` is the target's revision now.
#[tauri::command]
pub fn approvals_apply(window: WebviewWindow, state: State<'_, ContentState>, id: String, current_revision: Option<i64>) -> CmdResult<ApprovalRequest> {
    main_window_only(&window)?;
    with_db(&state, |db| db.apply_approval_request(&id, &main_desk(), current_revision))
}

#[tauri::command]
pub fn approvals_history(state: State<'_, ContentState>, id: String) -> CmdResult<Vec<ApprovalEvent>> {
    with_db(&state, |db| db.approval_history(&id))
}

/// The request a desk's scene event asks for: only `remote:save_scene` / `remote:delete_scene`
/// carrying `request: true` (the control server's verdict that this role may only ask).
fn scene_request(event: &str, v: &serde_json::Value) -> Option<(Actor, ApprovalRequestInput)> {
    let kind = match event {
        "remote:save_scene" => "scene_save",
        "remote:delete_scene" => "scene_delete",
        _ => return None,
    };
    if v.get("request").and_then(serde_json::Value::as_bool) != Some(true) {
        return None;
    }
    let text = |k: &str| v.get(k).and_then(serde_json::Value::as_str);
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

/// A desk's scene change that must wait for the main desk is recorded as a host request first, and
/// its id added to the event, so the decision is the host's. Returns the payload to emit; if the
/// database is unavailable the event goes on as before.
pub fn record_scene_request(app: &tauri::AppHandle, event: &str, payload: &str) -> String {
    let Ok(mut v) = serde_json::from_str::<serde_json::Value>(payload) else { return payload.to_string() };
    let Some((requester, input)) = scene_request(event, &v) else { return payload.to_string() };
    let saved = app.try_state::<ContentState>().and_then(|s| {
        let guard = s.0.lock().ok()?;
        let db: &ContentDb = guard.as_ref()?;
        db.submit_approval_request(&requester, &input).map_err(|e| log::warn!("approval request not recorded: {e}")).ok()
    });
    if let Some(r) = saved {
        v["requestId"] = serde_json::Value::String(r.id);
        v["expiresAt"] = serde_json::Value::String(r.expires_at);
    }
    v.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
