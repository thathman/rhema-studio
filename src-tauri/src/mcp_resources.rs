//! Read-only MCP resources (#252, MCP-006): the same church data the tools read, as documents an
//! assistant (or the person, from the assistant's attach menu) can open by address: `rhema://services`,
//! `rhema://services/{id}`, `rhema://songs`, `rhema://translations`, `rhema://looks`,
//! `rhema://drafts` and `rhema://drafts/{id}`; and (gap batch, #252 RS1-RS12) `rhema://church`,
//! `rhema://outputs`, `rhema://media`, `rhema://songs/{id}` and `rhema://services/{id}/approved`.
//! Nothing here writes. Behind the same "AI assistants" switch as the tools, and no song lyrics,
//! ever: songs are titles, kinds, languages and arrangement names. No secrets either: no feed or
//! camera links, keys or passwords, no logo.

use serde_json::{json, Value};

use super::{Server, HYMN_TAG};

const MIME: &str = "application/json";
/// Concrete services and drafts listed by `resources/list` (the rest are reachable by template).
const MAX_LISTED: usize = 50;
const MAX_SONGS: usize = 5000;
const MAX_MEDIA: usize = 2000;

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
        entry("rhema://church", "church", "The church", "The church's name, time zone, campus and service languages, its Brand Kit (colour and font names, ministry looks) and its cameras by name."),
        entry("rhema://outputs", "outputs", "Screens and feeds", "Each output and feed: name, kind, role, language, what it follows and its scene. No links or keys."),
        entry("rhema://media", "media", "Media library", "Pictures, videos, sounds and documents by name and kind."),
    ]
}

/// The church (#252 RS1, RS9): name, time zone, campus, service languages, Brand Kit colours and
/// fonts (never the logo), and cameras by name and label (never their links).
pub(super) fn church(s: &Server) -> Result<Value, Refused> {
    let st = s.dir.as_deref().map(super::settings).unwrap_or(Value::Null);
    let kit = super::setting(&st, "church", "brandKit").cloned().unwrap_or(Value::Null);
    let setup = super::setting(&st, "machine", "setup").cloned().unwrap_or(Value::Null);
    let word = |v: &Value, max: usize| v.as_str().map(|x| x.trim().chars().take(max).collect::<String>()).filter(|x| !x.is_empty());
    let colours = |c: &Value| {
        let mut out = serde_json::Map::new();
        for k in ["primary", "accent", "text", "background"] {
            if let Some(v) = word(&c[k], 40) {
                out.insert(k.into(), json!(v));
            }
        }
        Value::Object(out)
    };
    let (zone, from) = match word(&setup["timeZone"], 60) {
        Some(z) => (Some(z), "the church's setup"),
        None => (computer_time_zone(), "this computer's clock"),
    };
    let cameras: Vec<Value> = s.dir.as_deref().map(crate::mcp_drafts::Looks::read).unwrap_or_default().cameras.iter().map(|c| json!({ "name": c.name, "label": c.label })).collect();
    Ok(json!({
        "name": s.church,
        "timeZone": zone, "timeZoneFrom": from,
        "campus": word(&setup["campus"], 80),
        "serviceLanguages": word(&setup["serviceLanguages"], 120),
        "brandKit": {
            "colours": colours(&kit["colors"]),
            "fonts": { "heading": word(&kit["fonts"]["heading"], 80), "body": word(&kit["fonts"]["body"], 80) },
            "ministryLooks": kit["variants"].as_array().map(|a| a.iter().take(20).filter_map(|v| Some(json!({ "name": word(&v["name"], 60)?, "colours": colours(&v["colors"]) }))).collect::<Vec<_>>()).unwrap_or_default(),
        },
        "cameras": cameras,
    }))
}

/// This computer's IANA time zone, when it can tell (TZ, or where /etc/localtime points).
fn computer_time_zone() -> Option<String> {
    if let Some(tz) = std::env::var("TZ").ok().map(|t| t.trim_start_matches(':').to_string()).filter(|t| t.contains('/')) {
        return Some(tz);
    }
    let link = std::fs::read_link("/etc/localtime").ok()?;
    link.to_str()?.split_once("zoneinfo/").map(|(_, z)| z.to_string())
}

/// The screens and feeds (#252 RS8): what each is and what it follows, from the saved outputs.
/// Never a feed's link secret, a TV's address or a screen's monitor.
pub(super) fn outputs(s: &Server) -> Result<Value, Refused> {
    let v: Value = s.dir.as_deref().and_then(|d| std::fs::read_to_string(d.join("broadcast-themes.json")).ok()).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
    let scene = |id: &Value| v["scenes"].as_array().and_then(|a| a.iter().find(|x| x["id"] == *id)).and_then(|x| x["name"].as_str()).map(String::from);
    let text = |x: &Value, max: usize| x.as_str().map(|t| t.chars().take(max).collect::<String>());
    let outputs: Vec<Value> = v["outputs"].as_array().map(|a| a.iter().take(50).map(|o| {
        let kind = o["type"].as_str().unwrap_or("display");
        let follows: Vec<String> = o["shows"].as_array().map(|x| x.iter().filter_map(|k| text(k, 20)).collect()).unwrap_or_default();
        let mut row = json!({
            "id": text(&o["id"], 80), "name": text(&o["name"], 80),
            "kind": match kind { "ndi" => "NDI feed", "browser" => "browser feed", _ => "screen" },
            "role": text(&o["role"], 20).unwrap_or_else(|| "congregation".into()),
            "language": text(&o["language"], 10).unwrap_or_else(|| "both".into()),
            "follows": if follows.is_empty() { json!("whatever is put live") } else { json!(follows) },
            "scene": o.get("sceneId").and_then(scene),
            "lowerThirds": o["lowerThirds"] == true, "ticker": o["ticker"] == true,
        });
        if kind == "ndi" {
            row["ndiName"] = json!(text(&o["ndi"]["sourceName"], 80));
        }
        row
    }).collect()).unwrap_or_default();
    Ok(json!({ "outputs": outputs, "note": if outputs.is_empty() { "No outputs saved yet: Rhema has its main screen." } else { "" } }))
}

/// The media library by name and kind (#252 RS11): enough to name a picture or video, nothing more.
pub(super) fn media(s: &Server) -> Result<Value, Refused> {
    let c = s.content.as_ref().ok_or_else(|| refused(FAILED, s.problem.clone().unwrap_or_else(|| "no media".into())))?;
    let list = c.list_media().map_err(|e| refused(FAILED, format!("could not read the media library: {e}")))?;
    Ok(json!({ "media": list.iter().take(MAX_MEDIA).map(|m| json!({ "id": m.id, "name": m.name, "kind": m.kind })).collect::<Vec<_>>(), "truncated": list.len() > MAX_MEDIA }))
}

/// One song (#252 RS5, RS11): arrangements as section labels in order, languages, key and tempo,
/// copyright, CCLI number and licence with a warning when it needs checking. No lyrics.
pub(super) fn song(s: &Server, id: &str) -> Result<Value, Refused> {
    let c = s.content.as_ref().ok_or_else(|| refused(NOT_FOUND, "Song not found"))?;
    let x = c.get_song(id).map_err(|e| refused(FAILED, format!("could not read the song: {e}")))?.ok_or_else(|| refused(NOT_FOUND, "Song not found"))?;
    let label = |sid: &str| x.sections.iter().find(|sec| sec.id == sid).map(|sec| if sec.label.trim().is_empty() { sec.kind.clone() } else { sec.label.clone() }).unwrap_or_default();
    let mut languages: Vec<&str> = x.sections.iter().flat_map(|sec| sec.texts.keys().map(String::as_str)).collect();
    languages.sort_unstable();
    languages.dedup();
    let hymn = x.song.tags.split(',').any(|t| t.trim().eq_ignore_ascii_case(HYMN_TAG));
    Ok(json!({
        "id": x.song.id, "title": x.song.title, "otherTitles": x.song.alternate_titles, "kind": if hymn { "hymn" } else { "song" },
        "numbers": x.numbers.iter().map(|n| format!("{} {}", n.hymnbook_code, n.number)).collect::<Vec<_>>(),
        "authors": x.song.authors, "primaryLanguage": x.song.primary_language, "languages": languages,
        "key": x.song.key, "tempo": x.song.tempo,
        "arrangements": x.arrangements.iter().map(|a| json!({ "id": a.id, "name": a.name, "default": a.is_default, "order": a.sequence.iter().map(|sid| label(sid)).collect::<Vec<_>>() })).collect::<Vec<_>>(),
        "copyright": x.song.copyright, "ccliNumber": x.song.ccli_number, "licence": x.song.licence, "licenceNote": x.song.licence_note,
        "licenceWarning": crate::mcp_drafts::licence_warning(&x.song),
    }))
}

/// The people preparing an item (#252 RS12): its assignees, or its one "prepared by" line.
pub(super) fn assignees(payload: &Value) -> Option<Value> {
    let names: Vec<String> = match payload.get("assignees").and_then(Value::as_array) {
        Some(a) => a.iter().filter_map(Value::as_str).map(|n| n.chars().take(60).collect()).take(20).collect(),
        None => payload.get("prepared_by").and_then(Value::as_str).map(|n| vec![n.chars().take(60).collect()]).unwrap_or_default(),
    };
    let names: Vec<String> = names.into_iter().filter(|n: &String| !n.trim().is_empty()).collect();
    (!names.is_empty()).then(|| json!(names))
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
        { "uriTemplate": "rhema://services/{id}/approved", "name": "approved-service", "title": "A service's approved release", "description": "The version of a service people approved (not the working copy), as rhema://services/{id}.", "mimeType": MIME },
        { "uriTemplate": "rhema://songs/{id}", "name": "song", "title": "A song's arrangements and licence", "description": "One song or hymn by id: arrangements by section label, languages, key, copyright, CCLI number and licence. No lyrics.", "mimeType": MIME },
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
    let parts: Vec<&str> = path.split('/').collect();
    if parts.iter().skip(1).any(|p| p.is_empty()) {
        return Err(not_found());
    }
    let (what, id, sub) = (parts[0], parts.get(1).copied(), parts.get(2).copied());
    if parts.len() > 3 || (sub.is_some() && (what, sub) != ("services", Some("approved"))) {
        return Err(not_found());
    }
    let doc = match (what, id) {
        ("services", Some(id)) if sub.is_some() => {
            let c = s.content.as_ref().ok_or_else(not_found)?;
            let r = super::approved_release(c, id).map_err(|e| refused(NOT_FOUND, e))?.ok_or_else(not_found)?;
            json!({ "id": r.program.id, "title": r.summary.title, "date": r.summary.service_date, "release": "approved", "revision": r.summary.revision, "approvedAt": r.program.approved_at, "approvedBy": r.program.approved_by, "changedSinceApproval": r.program.revision != r.summary.revision, "phases": run_of_show(&r.items) })
        }
        ("church", None) => church(s)?,
        ("outputs", None) => outputs(s)?,
        ("media", None) => media(s)?,
        ("songs", Some(id)) => song(s, id).map_err(|e| if e.code == NOT_FOUND { not_found() } else { e })?,
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
        if let Some(people) = assignees(&payload) {
            row["assignees"] = people;
        }
        let groups = phase["groups"].as_array_mut().expect("groups");
        match groups.last_mut() {
            Some(g) => g["items"].as_array_mut().expect("items").push(row),
            None => phase["items"].as_array_mut().expect("items").push(row),
        }
    }
    phases
}
