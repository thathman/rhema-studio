//! Typed approval requests (migration 0017; C3, `docs/contracts/host-permissions-v1.md`).
//!
//! A desk submits a change it may not make on its own; someone else decides it, once, before it
//! expires; the host applies it only if what it was based on has not moved since. Every step is in
//! `approval_events`, which the schema keeps append-only.

use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::{new_id, ContentDb, ContentError, Result};

/// Longest a request may wait for a decision (a week); the default is a day.
pub const MAX_TTL_SECS: i64 = 7 * 24 * 3600;
pub const DEFAULT_TTL_SECS: i64 = 24 * 3600;
const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/// Who did something: a key's hash (or `main-desk`) and the name it showed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Actor {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequestInput {
    /// What is asked, e.g. `scene_save`, `scene_delete`.
    pub kind: String,
    pub target_id: String,
    /// The target's revision the request was made against (re-checked when applied).
    pub base_revision: Option<i64>,
    #[serde(default)]
    pub payload: serde_json::Value,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub ttl_secs: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub id: String,
    pub kind: String,
    pub target_id: String,
    pub base_revision: Option<i64>,
    pub requester: Actor,
    pub payload: serde_json::Value,
    pub reason: Option<String>,
    pub state: String,
    pub created_at: String,
    pub expires_at: String,
    pub decided_by: Option<Actor>,
    pub decided_at: Option<String>,
    pub decision_note: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Approve,
    Decline,
    RequestChanges,
}

impl Decision {
    const fn state(self) -> &'static str {
        match self {
            Self::Approve => "approved",
            Self::Decline => "declined",
            Self::RequestChanges => "requested_changes",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalEvent {
    pub seq: i64,
    pub at: String,
    pub actor: Actor,
    pub action: String,
    pub detail: Option<String>,
}

fn refused(code: &'static str, message: impl Into<String>) -> ContentError {
    ContentError::Refused { code, message: message.into() }
}

fn clean(s: &str, max: usize) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max).collect()
}

fn checked_actor(a: &Actor) -> Result<Actor> {
    let id = a.id.trim();
    if id.is_empty() || id.len() > 128 {
        return Err(ContentError::Invalid("actor id".into()));
    }
    Ok(Actor { id: id.to_string(), name: clean(&a.name, 80) })
}

fn event(tx: &Transaction<'_>, request_id: &str, actor: &Actor, action: &str, detail: Option<&str>) -> Result<()> {
    tx.execute(
        "INSERT INTO approval_events (request_id, actor_id, actor_name, action, detail) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![request_id, actor.id, actor.name, action, detail],
    )?;
    Ok(())
}

fn load(tx: &rusqlite::Connection, id: &str) -> Result<Option<ApprovalRequest>> {
    Ok(tx
        .query_row(
            "SELECT id, kind, target_id, base_revision, requester_id, requester_name, payload, reason, state, created_at,
                    expires_at, decided_by_id, decided_by_name, decided_at, decision_note
             FROM approval_requests WHERE id = ?1",
            [id],
            row_to_request,
        )
        .optional()?)
}

fn row_to_request(r: &rusqlite::Row<'_>) -> rusqlite::Result<ApprovalRequest> {
    let decided: (Option<String>, Option<String>) = (r.get(11)?, r.get(12)?);
    Ok(ApprovalRequest {
        id: r.get(0)?,
        kind: r.get(1)?,
        target_id: r.get(2)?,
        base_revision: r.get(3)?,
        requester: Actor { id: r.get(4)?, name: r.get(5)? },
        payload: serde_json::from_str(&r.get::<_, String>(6)?).unwrap_or_default(),
        reason: r.get(7)?,
        state: r.get(8)?,
        created_at: r.get(9)?,
        expires_at: r.get(10)?,
        decided_by: decided.0.map(|id| Actor { id, name: decided.1.unwrap_or_default() }),
        decided_at: r.get(13)?,
        decision_note: r.get(14)?,
    })
}

/// A submitted request past its time becomes `expired` (with its event). True if it did.
fn expire_if_due(tx: &Transaction<'_>, id: &str) -> Result<bool> {
    let n = tx.execute(&format!("UPDATE approval_requests SET state = 'expired' WHERE id = ?1 AND state = 'submitted' AND expires_at <= {NOW}"), [id])?;
    if n > 0 {
        event(tx, id, &Actor { id: "host".into(), name: "Rhema Studio".into() }, "expired", None)?;
    }
    Ok(n > 0)
}

impl ContentDb {
    /// Submit a request. A newer one from the same person for the same target supersedes theirs.
    pub fn submit_approval_request(&self, requester: &Actor, input: &ApprovalRequestInput) -> Result<ApprovalRequest> {
        let requester = checked_actor(requester)?;
        let kind = clean(&input.kind, 40);
        let target = input.target_id.trim();
        if kind.is_empty() || target.is_empty() || target.len() > 128 {
            return Err(ContentError::Invalid("a request needs a kind and a target".into()));
        }
        let payload = if input.payload.is_null() { serde_json::json!({}) } else { input.payload.clone() };
        if payload.to_string().len() > 256 * 1024 {
            return Err(ContentError::Invalid("request too large".into()));
        }
        let ttl = input.ttl_secs.unwrap_or(DEFAULT_TTL_SECS).clamp(0, MAX_TTL_SECS);
        let reason = input.reason.as_deref().map(|r| clean(r, 300)).filter(|r| !r.is_empty());
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let older: Vec<String> = {
            let mut st = tx.prepare("SELECT id FROM approval_requests WHERE requester_id = ?1 AND target_id = ?2 AND kind = ?3 AND state = 'submitted'")?;
            let ids = st.query_map(params![requester.id, target, kind], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
            ids
        };
        let id = new_id();
        for old in &older {
            tx.execute("UPDATE approval_requests SET state = 'superseded' WHERE id = ?1", [old])?;
            event(&tx, old, &requester, "superseded", Some(&id))?;
        }
        tx.execute(
            "INSERT INTO approval_requests (id, kind, target_id, base_revision, requester_id, requester_name, payload, reason, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+' || ?9 || ' seconds'))",
            params![id, kind, target, input.base_revision, requester.id, requester.name, payload.to_string(), reason, ttl],
        )?;
        event(&tx, &id, &requester, "submitted", reason.as_deref())?;
        let saved = load(&tx, &id)?.ok_or_else(|| ContentError::NotFound(id.clone()))?;
        tx.commit()?;
        Ok(saved)
    }

    /// Decide a submitted request. Refused: deciding your own (`self-approval`), deciding twice
    /// (`already-decided`), deciding after it expired (`expired`).
    pub fn decide_approval_request(&self, id: &str, decider: &Actor, decision: Decision, note: Option<&str>) -> Result<ApprovalRequest> {
        let decider = checked_actor(decider)?;
        let note = note.map(|n| clean(n, 300)).filter(|n| !n.is_empty());
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let current = load(&tx, id)?.ok_or_else(|| ContentError::NotFound(id.to_string()))?;
        if current.requester.id == decider.id {
            return Err(refused("self-approval", "A request cannot be decided by the person who sent it."));
        }
        if expire_if_due(&tx, id)? {
            tx.commit()?;
            return Err(refused("expired", "This request expired before it was decided."));
        }
        // Decide once: only a request still `submitted` changes; a second decider changes nothing.
        let n = tx.execute(
            &format!(
                "UPDATE approval_requests SET state = ?2, decided_by_id = ?3, decided_by_name = ?4, decided_at = {NOW}, decision_note = ?5
                 WHERE id = ?1 AND state = 'submitted'"
            ),
            params![id, decision.state(), decider.id, decider.name, note],
        )?;
        if n == 0 {
            return Err(refused("already-decided", format!("This request is already {}.", current.state.replace('_', " "))));
        }
        event(&tx, id, &decider, decision.state(), note.as_deref())?;
        let saved = load(&tx, id)?.ok_or_else(|| ContentError::NotFound(id.to_string()))?;
        tx.commit()?;
        Ok(saved)
    }

    /// Record that an approved request was carried out. `current_revision` is the target's revision
    /// now: if it differs from the one the request was based on (`stale`), the request is superseded
    /// instead and nothing is applied. Strict: a request made before the target existed (no base)
    /// is stale once the target exists, so leaving the base out never skips the check.
    pub fn apply_approval_request(&self, id: &str, by: &Actor, current_revision: Option<i64>) -> Result<ApprovalRequest> {
        let by = checked_actor(by)?;
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let current = load(&tx, id)?.ok_or_else(|| ContentError::NotFound(id.to_string()))?;
        if current.state != "approved" {
            return Err(refused("not-approved", format!("Only an approved request can be applied; this one is {}.", current.state.replace('_', " "))));
        }
        if current.base_revision != current_revision {
            tx.execute("UPDATE approval_requests SET state = 'superseded' WHERE id = ?1", [id])?;
            event(&tx, id, &by, "superseded", Some("the target changed after the request was made"))?;
            tx.commit()?;
            return Err(refused("stale", "What this request was based on has changed since; it was not applied."));
        }
        tx.execute("UPDATE approval_requests SET state = 'applied' WHERE id = ?1", [id])?;
        event(&tx, id, &by, "applied", None)?;
        let saved = load(&tx, id)?.ok_or_else(|| ContentError::NotFound(id.to_string()))?;
        tx.commit()?;
        Ok(saved)
    }

    /// The requester takes back a request nobody has decided yet.
    pub fn withdraw_approval_request(&self, id: &str, requester: &Actor) -> Result<ApprovalRequest> {
        let requester = checked_actor(requester)?;
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let n = tx.execute("UPDATE approval_requests SET state = 'withdrawn' WHERE id = ?1 AND state = 'submitted' AND requester_id = ?2", params![id, requester.id])?;
        if n == 0 {
            return Err(refused("not-withdrawable", "Only the person who sent a request can withdraw it, and only before it is decided."));
        }
        event(&tx, id, &requester, "withdrawn", None)?;
        let saved = load(&tx, id)?.ok_or_else(|| ContentError::NotFound(id.to_string()))?;
        tx.commit()?;
        Ok(saved)
    }

    /// Requests, newest first: those in `state` (all when `None`), or only `requester_id`'s.
    /// Overdue ones are marked expired first, so nobody is shown something they can still decide.
    pub fn list_approval_requests(&self, state: Option<&str>, requester_id: Option<&str>) -> Result<Vec<ApprovalRequest>> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let due: Vec<String> = {
            let mut st = tx.prepare(&format!("SELECT id FROM approval_requests WHERE state = 'submitted' AND expires_at <= {NOW}"))?;
            let ids = st.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
            ids
        };
        for id in &due {
            expire_if_due(&tx, id)?;
        }
        let list = {
            let mut st = tx.prepare(
                "SELECT id, kind, target_id, base_revision, requester_id, requester_name, payload, reason, state, created_at,
                        expires_at, decided_by_id, decided_by_name, decided_at, decision_note
                 FROM approval_requests WHERE (?1 IS NULL OR state = ?1) AND (?2 IS NULL OR requester_id = ?2)
                 ORDER BY created_at DESC LIMIT 500",
            )?;
            let rows = st.query_map(params![state, requester_id], row_to_request)?.collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        tx.commit()?;
        Ok(list)
    }

    /// Everything that happened to one request, in order.
    pub fn approval_history(&self, id: &str) -> Result<Vec<ApprovalEvent>> {
        let conn = self.lock()?;
        let mut st = conn.prepare("SELECT seq, at, actor_id, actor_name, action, detail FROM approval_events WHERE request_id = ?1 ORDER BY seq")?;
        let rows = st
            .query_map([id], |r| Ok(ApprovalEvent { seq: r.get(0)?, at: r.get(1)?, actor: Actor { id: r.get(2)?, name: r.get(3)? }, action: r.get(4)?, detail: r.get(5)? }))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn who(id: &str) -> Actor {
        Actor { id: id.into(), name: format!("{id}'s desk") }
    }

    fn ask(db: &ContentDb, by: &str, target: &str, base: Option<i64>, ttl: Option<i64>) -> ApprovalRequest {
        db.submit_approval_request(&who(by), &ApprovalRequestInput { kind: "scene_save".into(), target_id: target.into(), base_revision: base, payload: serde_json::json!({ "name": "Sermon" }), reason: Some("new  lower third".into()), ttl_secs: ttl })
            .unwrap()
    }

    fn code(e: ContentError) -> &'static str {
        match e {
            ContentError::Refused { code, .. } => code,
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn a_request_is_decided_once_by_someone_else_and_then_applied() {
        let db = ContentDb::open_in_memory().unwrap();
        let r = ask(&db, "screens", "scene-1", Some(3), None);
        assert_eq!((r.state.as_str(), r.reason.as_deref()), ("submitted", Some("new lower third")));
        assert_eq!(code(db.decide_approval_request(&r.id, &who("screens"), Decision::Approve, None).unwrap_err()), "self-approval");
        let d = db.decide_approval_request(&r.id, &who("main-desk"), Decision::Approve, Some("ok")).unwrap();
        assert_eq!((d.state.as_str(), d.decided_by.as_ref().map(|a| a.id.as_str())), ("approved", Some("main-desk")));
        assert_eq!(code(db.decide_approval_request(&r.id, &who("pastor"), Decision::Decline, None).unwrap_err()), "already-decided");
        let a = db.apply_approval_request(&r.id, &who("main-desk"), Some(3)).unwrap();
        assert_eq!(a.state, "applied");
        let steps: Vec<String> = db.approval_history(&r.id).unwrap().into_iter().map(|e| e.action).collect();
        assert_eq!(steps, ["submitted", "approved", "applied"]);
    }

    #[test]
    fn the_schema_itself_refuses_self_approval() {
        let db = ContentDb::open_in_memory().unwrap();
        let r = ask(&db, "screens", "scene-1", None, None);
        let conn = db.lock().unwrap();
        let direct = conn.execute("UPDATE approval_requests SET state = 'approved', decided_by_id = 'screens' WHERE id = ?1", [&r.id]);
        assert!(direct.is_err(), "a CHECK constraint must refuse it even past the code");
    }

    #[test]
    fn history_cannot_be_edited_or_erased() {
        let db = ContentDb::open_in_memory().unwrap();
        let r = ask(&db, "screens", "scene-1", None, None);
        let conn = db.lock().unwrap();
        assert!(conn.execute("UPDATE approval_events SET action = 'approved' WHERE request_id = ?1", [&r.id]).is_err());
        assert!(conn.execute("DELETE FROM approval_events WHERE request_id = ?1", [&r.id]).is_err());
    }

    #[test]
    fn an_expired_request_cannot_be_decided() {
        let db = ContentDb::open_in_memory().unwrap();
        let r = ask(&db, "screens", "scene-1", None, Some(0));
        assert_eq!(code(db.decide_approval_request(&r.id, &who("main-desk"), Decision::Approve, None).unwrap_err()), "expired");
        assert_eq!(db.list_approval_requests(None, None).unwrap()[0].state, "expired");
        let steps: Vec<String> = db.approval_history(&r.id).unwrap().into_iter().map(|e| e.action).collect();
        assert_eq!(steps, ["submitted", "expired"]);
    }

    #[test]
    fn a_stale_approval_is_superseded_not_applied() {
        let db = ContentDb::open_in_memory().unwrap();
        let r = ask(&db, "screens", "scene-1", Some(3), None);
        db.decide_approval_request(&r.id, &who("main-desk"), Decision::Approve, None).unwrap();
        assert_eq!(code(db.apply_approval_request(&r.id, &who("main-desk"), Some(4)).unwrap_err()), "stale");
        assert_eq!(db.list_approval_requests(Some("superseded"), None).unwrap().len(), 1);
        assert_eq!(code(db.apply_approval_request(&r.id, &who("main-desk"), Some(4)).unwrap_err()), "not-approved");
    }

    #[test]
    fn a_request_without_a_base_is_stale_once_the_target_exists() {
        let db = ContentDb::open_in_memory().unwrap();
        let r = ask(&db, "screens", "scene-new", None, None);
        db.decide_approval_request(&r.id, &who("main-desk"), Decision::Approve, None).unwrap();
        assert_eq!(code(db.apply_approval_request(&r.id, &who("main-desk"), Some(1)).unwrap_err()), "stale");
        let fresh = ask(&db, "screens", "scene-new2", None, None);
        db.decide_approval_request(&fresh.id, &who("main-desk"), Decision::Approve, None).unwrap();
        assert_eq!(db.apply_approval_request(&fresh.id, &who("main-desk"), None).unwrap().state, "applied", "still new: applies");
    }

    #[test]
    fn a_newer_request_supersedes_the_same_persons_older_one_and_only_the_requester_withdraws() {
        let db = ContentDb::open_in_memory().unwrap();
        let first = ask(&db, "screens", "scene-1", None, None);
        let other = ask(&db, "worship", "scene-1", None, None);
        let second = ask(&db, "screens", "scene-1", None, None);
        let states = |id: &str| db.list_approval_requests(None, None).unwrap().into_iter().find(|r| r.id == id).unwrap().state;
        assert_eq!((states(&first.id).as_str(), states(&other.id).as_str(), states(&second.id).as_str()), ("superseded", "submitted", "submitted"));
        assert_eq!(code(db.withdraw_approval_request(&second.id, &who("worship")).unwrap_err()), "not-withdrawable");
        assert_eq!(db.withdraw_approval_request(&second.id, &who("screens")).unwrap().state, "withdrawn");
        assert_eq!(db.list_approval_requests(Some("submitted"), Some("worship")).unwrap().len(), 1);
    }

    #[test]
    fn bad_input_is_refused() {
        let db = ContentDb::open_in_memory().unwrap();
        let blank = ApprovalRequestInput { kind: String::new(), target_id: "t".into(), base_revision: None, payload: serde_json::Value::Null, reason: None, ttl_secs: None };
        assert!(db.submit_approval_request(&who("screens"), &blank).is_err());
        assert!(db.submit_approval_request(&who(" "), &ApprovalRequestInput { kind: "x".into(), ..blank }).is_err());
    }
}
