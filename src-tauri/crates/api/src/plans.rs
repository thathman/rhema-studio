//! Service plans from a paired desk on the LAN (C5 slice 1, `docs/contracts/plan-drafts-v1.md`): an
//! Editor reads the plan, saves a draft at the revision it opened and submits that revision for the
//! main desk's review. Nothing here approves, takes or changes Live: the approved plan stays pinned
//! until the main desk approves the submitted revision itself. The app answers (`CommandSink::plans`).

use serde::Deserialize;

use crate::keys::Role;

/// Most items a desk may save in one plan (the services store refuses more anyway).
pub const MAX_ITEMS: usize = 500;

/// One plan request, after the HTTP layer read the route and body.
#[derive(Debug, Clone, PartialEq)]
pub enum PlanRequest {
    /// Plans in use (not archived, not templates), newest service date first.
    List,
    /// One plan with its items and approved revision.
    Get { id: String },
    /// Save the desk's draft: only if the plan is still at `expected_revision`.
    Save { id: String, expected_revision: i64, items: Vec<serde_json::Value> },
    /// Ask the main desk to approve exactly `revision` (it must be the current one).
    Submit { id: String, revision: i64, note: Option<String> },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBody {
    pub expected_revision: i64,
    pub items: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitBody {
    pub revision: i64,
    #[serde(default)]
    pub note: Option<String>,
}

/// Who asked: the authenticated key, device name, and server-assigned role. The role is retained
/// for response shaping; callers must never accept it from the request body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Desk {
    pub id: String,
    pub name: String,
    pub role: Role,
}

/// Whether a service may be addressed by the LAN plan endpoints.
#[must_use]
pub fn is_available(archived_at: Option<&str>, is_template: bool) -> bool {
    archived_at.is_none() && !is_template
}

/// Present may read a current plan for running context, but receives no private item notes.
/// The serialized host response is used so this stays in the API layer without depending on the
/// content crate's internal models.
pub fn redact_notes_for_role(plan: &mut serde_json::Value, role: Role) {
    if role != Role::Present {
        return;
    }
    let Some(items) = plan.get_mut("items").and_then(serde_json::Value::as_array_mut) else {
        return;
    };
    for item in items {
        if let Some(fields) = item.as_object_mut() {
            fields.insert("notes".into(), serde_json::Value::Null);
        }
    }
}

/// Why the host refused: each becomes an HTTP status the desk can act on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlanError {
    NotFound,
    /// Someone saved since this desk opened it: reopen, never overwrite (409).
    Conflict { expected: i64, actual: i64 },
    Invalid(String),
    Unavailable(String),
}

impl PlanRequest {
    /// Reading: the desks that prepare or run the service. Saving and submitting: the Editor and
    /// the settings desk. Never Bible, Worship, Screens, Stage, Camera, OBS, Timekeeper or Viewer.
    #[must_use]
    pub fn allowed(&self, role: Role) -> bool {
        match self {
            PlanRequest::List | PlanRequest::Get { .. } => matches!(role, Role::Editor | Role::Configure | Role::Present),
            PlanRequest::Save { .. } | PlanRequest::Submit { .. } => matches!(role, Role::Editor | Role::Configure),
        }
    }

    /// The request made safe to pass on, or why not.
    pub fn checked(self) -> Result<Self, PlanError> {
        let id_ok = |id: &str| !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        match &self {
            PlanRequest::Get { id } | PlanRequest::Save { id, .. } | PlanRequest::Submit { id, .. } if !id_ok(id) => Err(PlanError::NotFound),
            PlanRequest::Save { items, .. } if items.len() > MAX_ITEMS => Err(PlanError::Invalid(format!("a plan holds at most {MAX_ITEMS} items"))),
            PlanRequest::Save { expected_revision, .. } | PlanRequest::Submit { revision: expected_revision, .. } if *expected_revision < 1 => {
                Err(PlanError::Invalid("send the revision you opened".into()))
            }
            PlanRequest::Submit { id, revision, note } => Ok(PlanRequest::Submit {
                id: id.clone(),
                revision: *revision,
                note: note.as_deref().map(str::trim).filter(|n| !n.is_empty()).map(|n| n.chars().take(500).collect()),
            }),
            _ => Ok(self),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_preparing_desks_read_and_only_editor_and_settings_write() {
        let save = PlanRequest::Save { id: "p1".into(), expected_revision: 3, items: vec![] };
        let submit = PlanRequest::Submit { id: "p1".into(), revision: 3, note: None };
        for role in [Role::Editor, Role::Configure] {
            assert!(PlanRequest::List.allowed(role) && save.allowed(role) && submit.allowed(role), "{role:?}");
        }
        assert!(PlanRequest::Get { id: "p1".into() }.allowed(Role::Present));
        assert!(!save.allowed(Role::Present) && !submit.allowed(Role::Present));
        for role in [Role::Viewer, Role::Bible, Role::Worship, Role::Screens, Role::Stage, Role::Camera, Role::Obs, Role::ObsCompanion, Role::Timekeeper] {
            assert!(!PlanRequest::List.allowed(role) && !save.allowed(role) && !submit.allowed(role), "{role:?}");
        }
    }

    #[test]
    fn a_request_is_checked_before_it_reaches_the_store() {
        assert_eq!(PlanRequest::Get { id: "../etc".into() }.checked(), Err(PlanError::NotFound));
        assert!(matches!(PlanRequest::Save { id: "p1".into(), expected_revision: 0, items: vec![] }.checked(), Err(PlanError::Invalid(_))));
        assert!(matches!(PlanRequest::Save { id: "p1".into(), expected_revision: 2, items: vec![serde_json::Value::Null; MAX_ITEMS + 1] }.checked(), Err(PlanError::Invalid(_))));
        assert_eq!(
            PlanRequest::Submit { id: "p1".into(), revision: 4, note: Some("  ready for Sunday  ".into()) }.checked(),
            Ok(PlanRequest::Submit { id: "p1".into(), revision: 4, note: Some("ready for Sunday".into()) })
        );
    }

    #[test]
    fn archived_services_and_templates_are_not_available_to_lan_plan_actions() {
        assert!(is_available(None, false));
        assert!(!is_available(Some("2026-10-29T00:00:00Z"), false));
        assert!(!is_available(None, true));
    }

    #[test]
    fn present_get_response_redacts_notes_without_changing_editor_responses() {
        let mut present = serde_json::json!({
            "program": {"id": "sunday"},
            "items": [{"id": "moment-1", "notes": "private pastoral note", "reference": "John 3:16"}]
        });
        redact_notes_for_role(&mut present, Role::Present);
        assert_eq!(present.pointer("/items/0/notes"), Some(&serde_json::Value::Null));
        assert!(!present.to_string().contains("private pastoral note"));

        let mut editor = serde_json::json!({
            "program": {"id": "sunday"},
            "items": [{"id": "moment-1", "notes": "private pastoral note", "reference": "John 3:16"}]
        });
        redact_notes_for_role(&mut editor, Role::Editor);
        assert_eq!(
            editor.pointer("/items/0/notes").and_then(serde_json::Value::as_str),
            Some("private pastoral note")
        );
    }
}
