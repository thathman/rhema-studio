//! Read-only MCP resources (#252, MCP-006): the same church data the tools read, as documents an
//! assistant (or the person, from the assistant's attach menu) can open by address: `rhema://services`,
//! `rhema://services/{id}`, `rhema://songs`, `rhema://translations`, `rhema://looks`,
//! `rhema://drafts` and `rhema://drafts/{id}`. Nothing here writes. Behind the same "AI assistants"
//! switch as the tools, and no song lyrics, ever: songs are titles, kinds and languages.

use serde_json::{json, Value};

use super::{Server, HYMN_TAG};

const MIME: &str = "application/json";
/// Concrete services and drafts listed by `resources/list` (the rest are reachable by template).
const MAX_LISTED: usize = 50;
const MAX_SONGS: usize = 5000;

/// JSON-RPC error codes: -32002 is MCP's "resource not found"; -32001 (server-defined) is "access off".
pub(super) const ACCESS_OFF: i64 = -32001;
pub(super) const NOT_FOUND: i64 = -32002;
const FAILED: i64 = -32603;

pub(super) struct Refused {
    pub code: i64,
    pub message: String,
}

fn refused(code: i64, message: impl Into<String>) -> Refused {
    Refused { code, message: message.into() }
}

fn entry(uri: &str, name: &str, title: &str, description: &str) -> Value {
    json!({ "uri": uri, "name": name, "title": title, "description": description, "mimeType": MIME })
}

/// The fixed resources: listed even with access off (they hold no church data until read).
fn fixed() -> Vec<Value> {
    vec![
        entry("rhema://services", "services", "Services", "The church's saved services and templates (not archived), newest first: id, title, date, whether approved."),
        entry("rhema://songs", "songs", "Songs and hymns", "Every song and hymn in the library by title, other titles, kind (song or hymn), numbers and languages. No lyrics."),
        entry("rhema://translations", "translations", "Bible editions", "The Bible editions installed on this computer: abbreviation, title, language."),
        entry("rhema://looks", "looks", "Looks and scenes", "The church's looks (built-in and its own) and congregation scenes, by name."),
        entry("rhema://drafts", "drafts", "AI drafts", "The service drafts waiting for the church to review in Prepare → AI drafts."),
    ]
}

/// `resources/list`: the fixed resources, then (with access on) each service and waiting draft.
pub(super) fn list(s: &Server) -> Value {
    let mut resources = fixed();
    if s.enabled {
        if let Some(c) = &s.content {
            for p in services(c).iter().take(MAX_LISTED) {
                let when = p.service_date.as_deref().map(|d| format!(" ({d})")).unwrap_or_default();
                resources.push(entry(&format!("rhema://services/{}", p.id), &format!("service-{}", p.id), &format!("{}{when}", p.title), "This service's run of show: phases, groups and items with planned minutes and end-by times."));
            }
        }
        if let Some(dir) = s.dir.as_deref() {
            for d in crate::mcp_drafts::list(dir).iter().take(MAX_LISTED) {
                let id = d["id"].as_str().unwrap_or("");
                resources.push(entry(&format!("rhema://drafts/{id}"), &format!("draft-{id}"), &format!("AI draft: {}", d["title"].as_str().unwrap_or("")), "A draft waiting for review, as saved, with its revision."));
            }
        }
    }
    json!({ "resources": resources })
}

/// `resources/templates/list`: one service or one draft by id.
pub(super) fn templates() -> Value {
    json!({ "resourceTemplates": [
        { "uriTemplate": "rhema://services/{id}", "name": "service", "title": "A service's run of show", "description": "One service by id (from rhema://services): its phases, groups and items with kind, title or reference, planned minutes and end-by times. No lyrics.", "mimeType": MIME },
        { "uriTemplate": "rhema://drafts/{id}", "name": "draft", "title": "An AI draft", "description": "One waiting draft by id (from rhema://drafts), with the revision to name when revising it.", "mimeType": MIME },
    ] })
}

fn services(c: &rhema_content::ContentDb) -> Vec<rhema_content::Program> {
    let mut list = c.list_programs().unwrap_or_default();
    list.retain(|p| p.archived_at.is_none());
    list.sort_by(|x, y| y.service_date.cmp(&x.service_date).then(y.updated_at.cmp(&x.updated_at)));
    list
}

/// `resources/read`: the resource as one JSON text, or why not.
pub(super) fn read(s: &Server, uri: &str) -> Result<Value, Refused> {
    if !s.enabled {
        return Err(refused(ACCESS_OFF, "Rhema's AI assistant access is off. Turn it on in Rhema → Settings → AI assistants (MCP), then ask again."));
    }
    let not_found = || refused(NOT_FOUND, "Resource not found");
    let path = uri.strip_prefix("rhema://").ok_or_else(not_found)?;
    let (what, id) = match path.split_once('/') {
        Some((w, id)) if !id.is_empty() && !id.contains('/') => (w, Some(id)),
        Some(_) => return Err(not_found()),
        None => (path, None),
    };
    let doc = match (what, id) {
        ("services", None) => {
            let c = s.content.as_ref().ok_or_else(|| refused(FAILED, s.problem.clone().unwrap_or_else(|| "no services".into())))?;
            json!({ "services": services(c).iter().take(200).map(|p| json!({ "id": p.id, "uri": format!("rhema://services/{}", p.id), "title": p.title, "date": p.service_date, "template": p.is_template, "approved": p.approved_revision.is_some(), "approvedRevision": p.approved_revision })).collect::<Vec<_>>() })
        }
        ("services", Some(id)) => {
            let c = s.content.as_ref().ok_or_else(not_found)?;
            let p = c.get_program(id).map_err(|e| refused(FAILED, format!("could not read the service: {e}")))?.ok_or_else(not_found)?;
            json!({ "id": p.program.id, "title": p.program.title, "date": p.program.service_date, "revision": p.program.revision, "template": p.program.is_template, "approvedRevision": p.program.approved_revision, "phases": run_of_show(&p.items) })
        }
        ("songs", None) => {
            let c = s.content.as_ref().ok_or_else(|| refused(FAILED, s.problem.clone().unwrap_or_else(|| "no songs".into())))?;
            let list = c.list_songs(None, MAX_SONGS + 1).map_err(|e| refused(FAILED, format!("could not read the songs: {e}")))?;
            // Summaries carry a first line (lyrics): only these fields go out.
            let songs: Vec<Value> = list.iter().take(MAX_SONGS).map(|x| {
                let hymn = x.tags.split(',').any(|t| t.trim().eq_ignore_ascii_case(HYMN_TAG));
                json!({ "id": x.id, "title": x.title, "otherTitles": x.alternate_titles, "kind": if hymn { "hymn" } else { "song" }, "numbers": x.numbers, "languages": x.languages })
            }).collect();
            json!({ "songs": songs, "truncated": list.len() > MAX_SONGS })
        }
        ("translations", None) => {
            let list = s.bible.as_ref().and_then(|b| b.list_translations().ok()).unwrap_or_default();
            json!({ "translations": list.iter().map(|t| json!({ "abbreviation": t.abbreviation, "title": t.title, "language": t.language })).collect::<Vec<_>>() })
        }
        ("looks", None) => {
            let l = s.dir.as_deref().map(crate::mcp_drafts::Looks::read).unwrap_or_default();
            json!({ "looks": l.looks, "scenes": l.scenes })
        }
        ("drafts", None) => json!({ "drafts": s.dir.as_deref().map(crate::mcp_drafts::list).unwrap_or_default() }),
        ("drafts", Some(id)) => crate::mcp_drafts::get(s.dir.as_deref().ok_or_else(not_found)?, id).map_err(|_| not_found())?,
        _ => return Err(not_found()),
    };
    Ok(json!({ "contents": [{ "uri": uri, "mimeType": MIME, "text": serde_json::to_string_pretty(&doc).unwrap_or_default() }] }))
}

/// The flat rundown (phase and group headers between items) as phases → groups → items. Items before
/// the first phase sit in an unnamed phase; items before a phase's first group are its own items.
/// Only kind, title or reference, song id, translation, planned minutes and end by: no lyrics, no slide text.
fn run_of_show(items: &[rhema_content::ProgramItem]) -> Vec<Value> {
    let mut phases: Vec<Value> = Vec::new();
    let new_phase = |name: Value| json!({ "name": name, "items": [], "groups": [] });
    for it in items {
        let payload: Value = it.payload.as_deref().and_then(|p| serde_json::from_str(p).ok()).unwrap_or(Value::Null);
        if it.kind == "phase" {
            let mut p = new_phase(json!(it.reference));
            for k in ["rule", "role", "starts_at"] {
                if let Some(v) = payload.get(k).filter(|v| v.is_string()) {
                    p[k] = v.clone();
                }
            }
            phases.push(p);
            continue;
        }
        if phases.is_empty() {
            phases.push(new_phase(Value::Null));
        }
        let phase = phases.last_mut().expect("a phase");
        if it.kind == "group" {
            phase["groups"].as_array_mut().expect("groups").push(json!({ "name": it.reference, "items": [] }));
            continue;
        }
        let mut row = json!({ "kind": it.kind });
        if it.kind == "verse" {
            row["reference"] = json!(it.reference);
            row["translation"] = json!(it.translation);
        } else {
            row["title"] = json!(it.reference);
        }
        if let Some(id) = payload.get("song_id").and_then(Value::as_str) {
            row["songId"] = json!(id);
        }
        if let Some(m) = payload.get("planned_minutes").and_then(Value::as_f64) {
            row["plannedMinutes"] = json!(m);
        }
        if let Some(e) = payload.get("end_by").and_then(Value::as_str) {
            row["endBy"] = json!(e);
        }
        let groups = phase["groups"].as_array_mut().expect("groups");
        match groups.last_mut() {
            Some(g) => g["items"].as_array_mut().expect("items").push(row),
            None => phase["items"].as_array_mut().expect("items").push(row),
        }
    }
    phases
}
