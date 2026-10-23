//! Service drafts from an AI assistant (Rhema MCP, #252, MCP-002). The assistant proposes a run of
//! show; this checks every item against the church's own library and installed Bible editions and,
//! when asked, saves it as a **draft file** in the data folder's `ai-drafts`. Nothing here writes
//! the services database: people open a draft in Prepare, edit it and save it themselves.

use std::path::Path;

use rhema_bible::BibleDb;
use rhema_content::ContentDb;
use serde_json::{json, Value};

use crate::mcp::find_passage;

pub const DRAFTS_DIR: &str = "ai-drafts";
const MAX_ITEMS: usize = 200;
const MAX_WAITING: usize = 50;
const ROLES: [&str; 4] = ["pre", "warmup", "main", "post"];
const RULES: [&str; 3] = ["loop", "auto_once", "manual"];
const HYMN_TAG: &str = "cacghb";

fn clock(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 5 && b[2] == b':' && s[..2].parse::<u8>().is_ok_and(|h| h < 24) && s[3..].parse::<u8>().is_ok_and(|m| m < 60)
}

fn short(v: Option<&Value>, max: usize) -> Option<String> {
    v.and_then(Value::as_str).map(str::trim).filter(|x| !x.is_empty()).map(|x| x.chars().take(max).collect())
}

/// The outcome of checking a proposed service: the draft as Rhema would store it (when it can be
/// stored), what was found or is missing, and anything that must be fixed first.
pub struct Checked {
    pub draft: Option<Value>,
    pub report: Value,
}

/// Check a proposed service. Songs and hymns are matched to the library by id or exact title (or a
/// hymn number); Scripture is looked up in the installed editions; anything not found is kept as
/// a "missing" item for people to source, never invented.
pub fn check(content: Option<&ContentDb>, bible: Option<&BibleDb>, input: &Value) -> Checked {
    let mut errors: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let title = short(input.get("title"), 120).unwrap_or_default();
    if title.is_empty() {
        errors.push("the draft needs a title".into());
    }
    let date = short(input.get("date"), 10);
    if let Some(d) = &date {
        let ok = d.len() == 10 && d.as_bytes()[4] == b'-' && d.as_bytes()[7] == b'-' && d.chars().filter(char::is_ascii_digit).count() == 8;
        if !ok {
            errors.push(format!("date \"{d}\" is not YYYY-MM-DD"));
        }
    }
    let phases_in = input.get("phases").and_then(Value::as_array).cloned().unwrap_or_default();
    if phases_in.is_empty() {
        errors.push("the draft needs at least one phase (e.g. the main service) with items".into());
    }
    let mut count = 0usize;
    let mut minutes = 0f64;
    let mut found = 0usize;
    let mut missing = Vec::new();
    let mut roles_seen = Vec::new();
    let mut phases = Vec::new();
    for (pi, p) in phases_in.iter().enumerate() {
        let name = short(p.get("name"), 80).unwrap_or_else(|| format!("Part {}", pi + 1));
        let role = short(p.get("role"), 10).filter(|r| ROLES.contains(&r.as_str()));
        let rule = short(p.get("rule"), 10).filter(|r| RULES.contains(&r.as_str())).unwrap_or_else(|| match role.as_deref() {
            Some("pre" | "post") => "loop".into(),
            Some("warmup") => "auto_once".into(),
            _ => "manual".into(),
        });
        if let Some(r) = &role {
            if roles_seen.contains(r) {
                errors.push(format!("two phases have the role \"{r}\""));
            }
            roles_seen.push(r.clone());
        }
        let starts_at = short(p.get("starts_at"), 5);
        if let Some(t) = &starts_at {
            if !clock(t) {
                errors.push(format!("{name}: start time \"{t}\" is not HH:MM"));
            }
        }
        let mut items = Vec::new();
        for (ii, it) in p.get("items").and_then(Value::as_array).cloned().unwrap_or_default().iter().enumerate() {
            count += 1;
            if count > MAX_ITEMS {
                break;
            }
            let at = format!("{name}, item {}", ii + 1);
            let kind = short(it.get("kind"), 10).unwrap_or_default();
            let planned = it.get("planned_minutes").and_then(Value::as_f64);
            if let Some(m) = planned {
                if !(0.0..=240.0).contains(&m) {
                    errors.push(format!("{at}: planned minutes must be 0 to 240"));
                } else {
                    minutes += m;
                }
            }
            let notes = short(it.get("notes"), 500);
            let base = json!({ "planned_minutes": planned, "notes": notes });
            let item = match kind.as_str() {
                "song" | "hymn" => {
                    let wanted = short(it.get("title"), 120).unwrap_or_default();
                    match find_song(content, it, &kind) {
                        Some(song) => {
                            found += 1;
                            json!({ "kind": "song", "song": song, "status": "found" })
                        }
                        None if wanted.is_empty() && short(it.get("song_id"), 64).is_none() => {
                            errors.push(format!("{at}: a {kind} needs a title or a song_id"));
                            continue;
                        }
                        None => {
                            missing.push(format!("{kind} \"{wanted}\""));
                            json!({ "kind": "missing", "wanted": kind, "title": wanted, "status": "missing" })
                        }
                    }
                }
                "bible" => {
                    let reference = short(it.get("reference"), 80).unwrap_or_default();
                    let translation = short(it.get("translation"), 12).unwrap_or_default();
                    match bible.ok_or_else(|| "no Bible editions found".to_string()).and_then(|b| find_passage(b, &reference, &translation)) {
                        Ok(passage) => {
                            found += 1;
                            let first = &passage.rows[0];
                            json!({ "kind": "verse", "reference": passage.reference(), "translation": passage.translation, "book_number": passage.book_number, "book_name": passage.book_name, "chapter": passage.chapter, "verse": first.verse, "verses": passage.rows.len(), "status": "found" })
                        }
                        Err(e) => {
                            errors.push(format!("{at}: \"{reference}\": {e}"));
                            continue;
                        }
                    }
                }
                "slide" => {
                    let t = short(it.get("title"), 120).unwrap_or_default();
                    let text = short(it.get("text"), 2000).unwrap_or_default();
                    if t.is_empty() && text.is_empty() {
                        errors.push(format!("{at}: a slide needs a title or text"));
                        continue;
                    }
                    json!({ "kind": "slide", "title": t, "text": text, "status": "found" })
                }
                other => {
                    errors.push(format!("{at}: kind \"{other}\" must be song, hymn, bible or slide"));
                    continue;
                }
            };
            let mut item = item;
            for (k, v) in base.as_object().unwrap() {
                if !v.is_null() {
                    item[k] = v.clone();
                }
            }
            items.push(item);
        }
        let mut phase = json!({ "name": name, "rule": rule, "items": items });
        if let Some(r) = role {
            phase["role"] = json!(r);
        }
        if let Some(t) = starts_at.filter(|t| clock(t)) {
            phase["starts_at"] = json!(t);
        }
        phases.push(phase);
    }
    if count > MAX_ITEMS {
        errors.push(format!("at most {MAX_ITEMS} items"));
    }
    if !roles_seen.iter().any(|r| r == "main") && !phases.is_empty() {
        warnings.push("no phase has the role \"main\": Rhema times the service from the main phase's start time".into());
    }
    if let Some(main) = phases.iter().find(|p| p["role"] == "main") {
        if main.get("starts_at").is_none() {
            warnings.push("the main phase has no start time: give it one (HH:MM) for planned times".into());
        }
    }
    let assumptions: Vec<String> = input.get("assumptions").and_then(Value::as_array).map(|a| a.iter().filter_map(|x| short(Some(x), 300)).take(20).collect()).unwrap_or_default();
    let ok = errors.is_empty();
    let report = json!({ "ok": ok, "errors": errors, "warnings": warnings, "items": count.min(MAX_ITEMS), "found": found, "missing": missing, "plannedMinutes": minutes });
    let draft = ok.then(|| json!({ "title": title, "date": date, "assumptions": assumptions, "phases": phases }));
    Checked { draft, report }
}

fn find_song(content: Option<&ContentDb>, it: &Value, kind: &str) -> Option<Value> {
    let db = content?;
    let summary = |x: &rhema_content::SongSummary| json!({ "id": x.id, "title": x.title, "primary_language": x.primary_language, "languages": x.languages, "hymn": x.tags.split(',').any(|t| t.trim().eq_ignore_ascii_case(HYMN_TAG)) });
    if let Some(id) = short(it.get("song_id"), 64) {
        return db.get_song(&id).ok().flatten().map(|s| {
            let mut languages: Vec<String> = s.sections.iter().flat_map(|x| x.texts.keys().cloned()).collect();
            languages.sort();
            languages.dedup();
            json!({ "id": s.song.id, "title": s.song.title, "primary_language": s.song.primary_language, "languages": languages, "hymn": s.song.tags.split(',').any(|t| t.trim().eq_ignore_ascii_case(HYMN_TAG)) })
        });
    }
    let wanted = short(it.get("title"), 120)?;
    let tag = if kind == "hymn" { Some((HYMN_TAG, true)) } else { None };
    let list = db.list_songs_tagged(Some(&wanted), 20, tag).ok()?;
    let lower = wanted.to_lowercase();
    list.iter()
        .find(|x| x.title.to_lowercase() == lower || x.alternate_titles.iter().any(|t| t.to_lowercase() == lower) || x.numbers.iter().any(|n| n.to_lowercase() == lower))
        .map(summary)
}

/// Save a checked draft for people to review: `ai-drafts/<id>.json`. Refuses when 50 already wait.
pub fn save(data_dir: &Path, draft: &Value, client: &Value) -> Result<String, String> {
    let dir = data_dir.join(DRAFTS_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not make the drafts folder: {e}"))?;
    let waiting = std::fs::read_dir(&dir).map(|r| r.filter_map(Result::ok).filter(|e| e.path().extension().is_some_and(|x| x == "json")).count()).unwrap_or(0);
    if waiting >= MAX_WAITING {
        return Err(format!("{MAX_WAITING} drafts are already waiting: review or remove some in Rhema → Prepare → AI drafts first"));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let mut doc = draft.clone();
    doc["v"] = json!(1);
    doc["id"] = json!(id);
    doc["status"] = json!("awaiting review");
    doc["created_at"] = json!(chrono_now());
    doc["client"] = client.clone();
    let tmp = dir.join(format!(".{id}.tmp"));
    std::fs::write(&tmp, serde_json::to_vec_pretty(&doc).map_err(|e| e.to_string())?).map_err(|e| format!("could not save the draft: {e}"))?;
    std::fs::rename(&tmp, dir.join(format!("{id}.json"))).map_err(|e| format!("could not save the draft: {e}"))?;
    Ok(id)
}

fn is_draft_id(id: &str) -> bool {
    id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// The drafts waiting for review (newest first): what an assistant needs to find its own.
pub fn list(data_dir: &Path) -> Vec<Value> {
    let Ok(entries) = std::fs::read_dir(data_dir.join(DRAFTS_DIR)) else { return Vec::new() };
    let mut out: Vec<Value> = entries
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter(|e| e.metadata().is_ok_and(|m| m.len() < 2 * 1024 * 1024))
        .filter_map(|e| std::fs::read(e.path()).ok())
        .filter_map(|b| serde_json::from_slice::<Value>(&b).ok())
        .filter(|v| v.get("v") == Some(&json!(1)) && v.get("id").and_then(Value::as_str).is_some_and(is_draft_id))
        .map(|v| {
            let items: usize = v["phases"].as_array().map_or(0, |p| p.iter().map(|ph| ph["items"].as_array().map_or(0, Vec::len)).sum());
            json!({ "id": v["id"], "title": v["title"], "date": v["date"], "items": items, "created_at": v["created_at"], "updated_at": v["updated_at"], "by": v["client"]["name"], "status": v["status"] })
        })
        .collect();
    out.sort_by(|a, b| b["created_at"].as_str().unwrap_or("").cmp(a["created_at"].as_str().unwrap_or("")));
    out
}

/// Replace a waiting draft with a revised one (same id, still for people to review). Refuses a
/// draft that is not there any more (people removed it); what people saved from it is a service of
/// its own and is never touched.
pub fn update(data_dir: &Path, id: &str, draft: &Value, client: &Value) -> Result<(), String> {
    if !is_draft_id(id) {
        return Err("not a draft id (rhema_list_service_drafts lists them)".into());
    }
    let dir = data_dir.join(DRAFTS_DIR);
    let path = dir.join(format!("{id}.json"));
    let old: Value = std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or_else(|| "that draft is not waiting any more (people may have removed it): create a new one".to_string())?;
    let mut doc = draft.clone();
    doc["v"] = json!(1);
    doc["id"] = json!(id);
    doc["status"] = json!("awaiting review");
    doc["created_at"] = old["created_at"].clone();
    doc["updated_at"] = json!(chrono_now());
    doc["client"] = client.clone();
    let tmp = dir.join(format!(".{id}.tmp"));
    std::fs::write(&tmp, serde_json::to_vec_pretty(&doc).map_err(|e| e.to_string())?).map_err(|e| format!("could not save the draft: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("could not save the draft: {e}"))
}

/// RFC 3339 UTC, without a date crate.
fn chrono_now() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (days, rem) = (secs / 86_400, secs % 86_400);
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn bible() -> Option<BibleDb> {
        BibleDb::open(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../data/rhema.db")).ok()
    }

    #[test]
    fn a_thanksgiving_service_is_checked_item_by_item() {
        let dir = std::env::temp_dir().join(format!("rhema-drafts-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("studio.db");
        {
            let db = ContentDb::open(&path).unwrap();
            let input: rhema_content::SongInput = serde_json::from_value(json!({ "title": "Great Is Thy Faithfulness", "authors": "Thomas Chisholm", "sections": [{ "kind": "verse", "label": "V1", "texts": { "en": "Great is Thy faithfulness" } }] })).unwrap();
            db.create_song(&input).unwrap();
        }
        let content = ContentDb::open_read_only(&path).unwrap();
        let b = bible();
        let input = json!({
            "title": "Thanksgiving Service", "date": "2026-11-29",
            "assumptions": ["Pastor preaches 35 minutes"],
            "phases": [
                { "name": "Warm-up", "role": "warmup", "items": [{ "kind": "slide", "title": "Welcome", "text": "Thanksgiving Sunday", "planned_minutes": 5 }] },
                { "name": "Main service", "role": "main", "starts_at": "10:00", "items": [
                    { "kind": "song", "title": "great is thy faithfulness", "planned_minutes": 6 },
                    { "kind": "hymn", "title": "A hymn we do not have", "planned_minutes": 4 },
                    { "kind": "bible", "reference": "Psalm 100:1-5", "translation": "KJV", "planned_minutes": 3, "notes": "Read responsively" }
                ] }
            ]
        });
        let c = check(Some(&content), b.as_ref(), &input);
        if b.is_none() {
            return; // the Bible database is not in every checkout
        }
        assert_eq!(c.report["ok"], true, "{}", c.report);
        assert_eq!(c.report["missing"], json!(["hymn \"A hymn we do not have\""]));
        assert_eq!(c.report["plannedMinutes"], 18.0);
        let draft = c.draft.unwrap();
        let main = &draft["phases"][1];
        assert_eq!(main["rule"], "manual");
        assert_eq!(main["starts_at"], "10:00");
        assert_eq!(main["items"][0]["song"]["title"], "Great Is Thy Faithfulness");
        assert_eq!(main["items"][1]["kind"], "missing");
        assert_eq!(main["items"][2]["reference"], "Psalms 100:1-5");
        assert_eq!(main["items"][2]["verses"], 5);
        assert_eq!(draft["phases"][0]["rule"], "auto_once");
        let id = save(&dir, &draft, &json!({ "name": "Claude" })).unwrap();
        let saved: Value = serde_json::from_slice(&std::fs::read(dir.join(DRAFTS_DIR).join(format!("{id}.json"))).unwrap()).unwrap();
        assert_eq!(saved["status"], "awaiting review");
        assert_eq!(saved["client"]["name"], "Claude");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_waiting_draft_is_listed_and_revised_in_place() {
        let dir = std::env::temp_dir().join(format!("rhema-drafts-rev-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let draft = json!({ "title": "Sunday", "phases": [{ "name": "Main", "items": [{ "kind": "slide", "title": "Welcome" }] }] });
        let id = save(&dir, &draft, &json!({ "name": "Claude" })).unwrap();
        let listed = list(&dir);
        assert_eq!((listed.len(), listed[0]["id"].as_str(), listed[0]["items"].as_u64(), listed[0]["by"].as_str()), (1, Some(id.as_str()), Some(1), Some("Claude")));
        let revised = json!({ "title": "Sunday (revised)", "phases": [{ "name": "Main", "items": [{ "kind": "slide", "title": "Welcome" }, { "kind": "slide", "title": "Notices" }] }] });
        update(&dir, &id, &revised, &json!({ "name": "Claude" })).unwrap();
        let listed = list(&dir);
        assert_eq!((listed.len(), listed[0]["title"].as_str(), listed[0]["items"].as_u64()), (1, Some("Sunday (revised)"), Some(2)), "same draft, revised");
        assert!(listed[0]["updated_at"].is_string() && listed[0]["created_at"].is_string());
        assert!(update(&dir, "../../etc/passwd", &revised, &json!({})).is_err(), "only draft ids");
        std::fs::remove_file(dir.join(DRAFTS_DIR).join(format!("{id}.json"))).unwrap(); // people removed it
        assert!(update(&dir, &id, &revised, &json!({})).unwrap_err().contains("not waiting any more"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn mistakes_are_named_and_nothing_is_invented() {
        let c = check(None, bible().as_ref(), &json!({ "title": "", "date": "29/11/2026", "phases": [
            { "name": "Main", "role": "main", "starts_at": "25:00", "items": [
                { "kind": "bible", "reference": "Hezekiah 3:1" }, { "kind": "dance" }, { "kind": "slide" }, { "kind": "song", "title": "x", "planned_minutes": 900 }
            ] },
            { "name": "Again", "role": "main", "items": [] }
        ] }));
        assert_eq!(c.report["ok"], false);
        assert!(c.draft.is_none());
        let errors = c.report["errors"].to_string();
        for e in ["needs a title", "YYYY-MM-DD", "not HH:MM", "dance", "slide needs", "0 to 240", "two phases have the role"] {
            assert!(errors.contains(e), "{e} in {errors}");
        }
        assert!(chrono_now().ends_with('Z'));
    }
}
