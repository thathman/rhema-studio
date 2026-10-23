//! The Rhema MCP server (issue #252, MCP-001): AI assistants that speak the Model Context Protocol
//! can read this church's services, songs, hymns and the installed Bible editions to plan a service.
//!
//! Started by the assistant as a subprocess: `Rhema --mcp` (stdio, one JSON-RPC message per line).
//! Read-only: the databases are opened read-only and nothing here can change a service, a screen or
//! a setting. Opt-in: every tool answers "turn it on first" until Settings → AI assistants allows
//! it. Scripture text comes only from the installed editions; song lyrics are not handed out.

use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};

use rhema_bible::BibleDb;
use rhema_content::ContentDb;
use serde_json::{json, Value};

const APP_ID: &str = "com.openbezal.rhema";
const HYMN_TAG: &str = "cacghb";
const MAX_LIST: usize = 50;

fn arg(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

/// The app's data folder, as Tauri resolves it for this identifier (or `--data <dir>`).
fn data_dir() -> Option<PathBuf> {
    if let Some(d) = arg("--data") {
        return Some(PathBuf::from(d));
    }
    let home = std::env::var_os("HOME").map(PathBuf::from);
    if cfg!(target_os = "macos") {
        return home.map(|h| h.join("Library/Application Support").join(APP_ID));
    }
    if cfg!(target_os = "windows") {
        return std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join(APP_ID));
    }
    std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).or_else(|| home.map(|h| h.join(".local/share"))).map(|d| d.join(APP_ID))
}

/// The bundled Bible database (or `--bible <file>`): next to the app's resources, or the source tree in development.
fn bible_path() -> Option<PathBuf> {
    if let Some(p) = arg("--bible") {
        return Some(PathBuf::from(p));
    }
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let candidates = [dir.join("../Resources/rhema.db"), dir.join("rhema.db"), dir.join("resources/rhema.db"), PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../data/rhema.db")];
    candidates.into_iter().find(|p| p.exists())
}

/// The Rhema settings file, for the opt-in switch and the church's name.
fn settings(dir: &Path) -> Value {
    std::fs::read_to_string(dir.join("settings.json")).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null)
}

struct Server {
    /// Where drafts are saved (`ai-drafts`), if the data folder is known.
    dir: Option<PathBuf>,
    /// The assistant, as it named itself in `initialize`, for the drafts' provenance.
    client: Value,
    content: Option<ContentDb>,
    bible: Option<BibleDb>,
    enabled: bool,
    church: String,
    problem: Option<String>,
}

impl Server {
    fn open() -> Self {
        let dir = data_dir();
        let s = dir.as_deref().map(settings).unwrap_or(Value::Null);
        let enabled = s.get("mcpEnabled").and_then(Value::as_bool).unwrap_or(false);
        let church = s.pointer("/brandKit/churchName").and_then(Value::as_str).unwrap_or("").trim().to_string();
        let mut problem = None;
        let content = dir.as_ref().map(|d| d.join("studio.db")).filter(|p| p.exists()).and_then(|p| match ContentDb::open_read_only(&p) {
            Ok(db) => Some(db),
            Err(e) => {
                problem = Some(format!("services and songs could not be read: {e}"));
                None
            }
        });
        if content.is_none() && problem.is_none() {
            problem = Some("no Rhema services found on this computer yet".into());
        }
        let bible = bible_path().and_then(|p| BibleDb::open(&p).ok());
        Self { dir, client: Value::Null, content, bible, enabled, church, problem }
    }
}

fn text(v: &Value) -> Value {
    json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(v).unwrap_or_default() }], "structuredContent": v, "isError": false })
}

fn tool_error(message: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": message }], "isError": true })
}

fn tools() -> Value {
    let ro = json!({ "readOnlyHint": true, "destructiveHint": false, "openWorldHint": false });
    json!([
        { "name": "rhema_get_capabilities", "description": "What this Rhema Studio offers an assistant: the church, the installed Bible editions, how many services and songs there are, and the rules (read-only; Scripture only from the installed editions; song lyrics are not given out).", "inputSchema": { "type": "object", "properties": {} }, "annotations": ro },
        { "name": "rhema_list_services", "description": "The church's saved services (and service templates), newest first: id, title, date, number of items, approved revision.", "inputSchema": { "type": "object", "properties": { "templates_only": { "type": "boolean", "description": "Only service templates." }, "include_archived": { "type": "boolean" } } }, "annotations": ro },
        { "name": "rhema_get_service", "description": "One service's run of show in order: its phases (pre-service loop, warm-up, main service with its start time, post-service loop) and groups, and each item's kind, title or reference, planned minutes and notes.", "inputSchema": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] }, "annotations": ro },
        { "name": "rhema_search_songs", "description": "Search the church's song library and hymn book by title, other titles, hymn number or a line: title, other titles, numbers, authors, licence, languages. Lyrics are not returned.", "inputSchema": { "type": "object", "properties": { "query": { "type": "string" }, "kind": { "type": "string", "enum": ["any", "song", "hymn"] }, "limit": { "type": "integer", "minimum": 1, "maximum": MAX_LIST } }, "required": ["query"] }, "annotations": ro },
        { "name": "rhema_list_translations", "description": "The Bible editions installed on this computer (abbreviation, title, language).", "inputSchema": { "type": "object", "properties": {} }, "annotations": ro },
        { "name": "rhema_validate_service_draft", "description": "Check a proposed service without saving it: every song and hymn is matched to the church's library (by id, exact title, other title or hymn number), every Scripture reference is looked up in the installed editions, and anything not found is listed as missing. Returns errors to fix, warnings, the planned minutes and what was found.", "inputSchema": { "type": "object", "properties": { "draft": draft_schema() }, "required": ["draft"] }, "annotations": ro },
        { "name": "rhema_create_service_draft", "description": "Save a checked proposed service as a draft for the church to review in Rhema → Prepare → AI drafts. It does not change any saved service, approve anything or put anything on screen; people open it, edit it and save it themselves. Fails with the same errors as the check.", "inputSchema": { "type": "object", "properties": { "draft": draft_schema() }, "required": ["draft"] }, "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false } },
        { "name": "rhema_lookup_bible_reference", "description": "The exact text of a Bible reference from an installed edition (e.g. \"Romans 8:28\", \"1 Corinthians 13:4-7\", \"Psalm 23\"). Always use this for Scripture; never quote verses from memory.", "inputSchema": { "type": "object", "properties": { "reference": { "type": "string" }, "translation": { "type": "string", "description": "An installed abbreviation, e.g. KJV; default: the first English edition." } }, "required": ["reference"] }, "annotations": ro }
    ])
}

/// The shape of a proposed service (one JSON Schema for both draft tools).
fn draft_schema() -> Value {
    json!({
        "type": "object",
        "required": ["title", "phases"],
        "properties": {
            "title": { "type": "string" },
            "date": { "type": "string", "description": "YYYY-MM-DD" },
            "assumptions": { "type": "array", "items": { "type": "string" }, "description": "What you assumed (length of the sermon, who leads), for the church to check." },
            "phases": { "type": "array", "items": {
                "type": "object", "required": ["name", "items"],
                "properties": {
                    "name": { "type": "string" },
                    "role": { "type": "string", "enum": ["pre", "warmup", "main", "post"], "description": "pre-service loop, warm-up (timed to end at the start), main service, post-service loop" },
                    "rule": { "type": "string", "enum": ["loop", "auto_once", "manual"] },
                    "starts_at": { "type": "string", "description": "HH:MM; give it for the main service" },
                    "items": { "type": "array", "items": {
                        "type": "object", "required": ["kind"],
                        "properties": {
                            "kind": { "type": "string", "enum": ["song", "hymn", "bible", "slide"] },
                            "title": { "type": "string", "description": "song or hymn title (or hymn number), or a slide's title" },
                            "song_id": { "type": "string", "description": "from rhema_search_songs" },
                            "reference": { "type": "string", "description": "for bible: e.g. Romans 8:28" },
                            "translation": { "type": "string" },
                            "text": { "type": "string", "description": "a slide's words (announcements, prayer points); never song lyrics" },
                            "planned_minutes": { "type": "number" },
                            "notes": { "type": "string" }
                        }
                    } }
                }
            } }
        }
    })
}

fn call(s: &Server, name: &str, a: &Value) -> Value {
    if !s.enabled {
        return tool_error("Rhema's AI assistant access is off. Turn it on in Rhema → Settings → AI assistants (MCP), then ask again.");
    }
    let str_arg = |k: &str| a.get(k).and_then(Value::as_str).map(str::trim).unwrap_or("");
    match name {
        "rhema_get_capabilities" => {
            let services = s.content.as_ref().and_then(|c| c.list_programs().ok()).map_or(0, |p| p.len());
            let songs = s.content.as_ref().and_then(|c| c.list_songs(None, 100_000).ok()).map_or(0, |p| p.len());
            let translations = s.bible.as_ref().and_then(|b| b.list_translations().ok()).unwrap_or_default();
            text(&json!({
                "church": s.church, "readOnly": true, "services": services, "songsAndHymns": songs,
                "translations": translations.iter().map(|t| json!({ "abbreviation": t.abbreviation, "title": t.title, "language": t.language })).collect::<Vec<_>>(),
                "rules": ["Nothing here can change a saved service, a song, a screen or a setting.", "A proposed service is saved only as a draft that people review, edit and save in Prepare.", "Quote Scripture only from rhema_lookup_bible_reference.", "Song lyrics are not given out; refer to songs by title and number, and list songs you cannot find."],
                "problem": s.problem,
            }))
        }
        "rhema_list_services" => {
            let Some(c) = &s.content else { return tool_error(s.problem.as_deref().unwrap_or("no services")) };
            match c.list_programs() {
                Ok(mut list) => {
                    let templates = a.get("templates_only").and_then(Value::as_bool).unwrap_or(false);
                    let archived = a.get("include_archived").and_then(Value::as_bool).unwrap_or(false);
                    list.retain(|p| (!templates || p.is_template) && (archived || p.archived_at.is_none()));
                    list.sort_by(|x, y| y.service_date.cmp(&x.service_date).then(y.updated_at.cmp(&x.updated_at)));
                    text(&json!({ "services": list.iter().take(200).map(|p| json!({ "id": p.id, "title": p.title, "date": p.service_date, "items": p.item_count, "template": p.is_template, "approvedRevision": p.approved_revision })).collect::<Vec<_>>() }))
                }
                Err(e) => tool_error(&format!("could not read services: {e}")),
            }
        }
        "rhema_get_service" => {
            let Some(c) = &s.content else { return tool_error(s.problem.as_deref().unwrap_or("no services")) };
            match c.get_program(str_arg("id")) {
                Ok(Some(p)) => text(&json!({ "id": p.program.id, "title": p.program.title, "date": p.program.service_date, "revision": p.program.revision, "runOfShow": p.items.iter().map(run_of_show_row).collect::<Vec<_>>() })),
                Ok(None) => tool_error("no service with that id (use rhema_list_services)"),
                Err(e) => tool_error(&format!("could not read the service: {e}")),
            }
        }
        "rhema_search_songs" => {
            let Some(c) = &s.content else { return tool_error(s.problem.as_deref().unwrap_or("no songs")) };
            let query = str_arg("query");
            if query.is_empty() {
                return tool_error("give a title, a number or a few words");
            }
            let limit = a.get("limit").and_then(Value::as_u64).map_or(20, |n| (n as usize).clamp(1, MAX_LIST));
            let tag = match str_arg("kind") {
                "hymn" => Some((HYMN_TAG, true)),
                "song" => Some((HYMN_TAG, false)),
                _ => None,
            };
            match c.list_songs_tagged(Some(query), limit, tag) {
                Ok(list) => text(&json!({ "songs": list.iter().map(|x| {
                    let hymn = x.tags.split(',').any(|t| t.trim().eq_ignore_ascii_case(HYMN_TAG));
                    json!({ "id": x.id, "title": x.title, "otherTitles": x.alternate_titles, "kind": if hymn { "hymn" } else { "song" }, "numbers": x.numbers, "authors": x.authors, "licence": x.licence, "languages": x.languages })
                }).collect::<Vec<_>>() })),
                Err(e) => tool_error(&format!("could not search: {e}")),
            }
        }
        "rhema_list_translations" => match s.bible.as_ref().map(BibleDb::list_translations) {
            Some(Ok(list)) => text(&json!({ "translations": list.iter().map(|t| json!({ "abbreviation": t.abbreviation, "title": t.title, "language": t.language })).collect::<Vec<_>>() })),
            _ => tool_error("no Bible editions found"),
        },
        "rhema_validate_service_draft" | "rhema_create_service_draft" => {
            let checked = crate::mcp_drafts::check(s.content.as_ref(), s.bible.as_ref(), a.get("draft").unwrap_or(&Value::Null));
            if name == "rhema_validate_service_draft" {
                return text(&checked.report);
            }
            let (Some(draft), Some(dir)) = (checked.draft, s.dir.as_deref()) else {
                let mut r = tool_error("the draft was not saved: fix the errors first (rhema_validate_service_draft lists them)");
                r["structuredContent"] = checked.report;
                return r;
            };
            match crate::mcp_drafts::save(dir, &draft, &s.client) {
                Ok(id) => {
                    let mut report = checked.report;
                    report["draftId"] = json!(id);
                    report["next"] = json!("The church opens it in Rhema → Prepare → AI drafts, edits it and saves it; nothing is approved or shown until they do.");
                    text(&report)
                }
                Err(e) => tool_error(&e),
            }
        }
        "rhema_lookup_bible_reference" => {
            let Some(b) = &s.bible else { return tool_error("no Bible editions found") };
            lookup(b, str_arg("reference"), str_arg("translation"))
        }
        _ => tool_error("unknown tool"),
    }
}

fn run_of_show_row(it: &rhema_content::ProgramItem) -> Value {
    let payload: Value = it.payload.as_deref().and_then(|p| serde_json::from_str(p).ok()).unwrap_or(Value::Null);
    let mut row = json!({ "kind": it.kind, "title": it.reference });
    if let Some(m) = payload.get("planned_minutes").and_then(Value::as_f64) {
        row["plannedMinutes"] = json!(m);
    }
    for k in ["rule", "role", "starts_at", "end_by"] {
        if let Some(v) = payload.get(k).filter(|v| v.is_string()) {
            row[k] = v.clone();
        }
    }
    if let Some(n) = it.notes.as_deref().filter(|n| !n.trim().is_empty()) {
        row["notes"] = json!(n.chars().take(500).collect::<String>());
    }
    row
}

/// "Romans 8:28", "1 Corinthians 13:4-7", "jn 3 16", "Psalm 23" → (book words, chapter, first verse, last verse).
fn parse_reference(input: &str) -> Option<(String, i32, Option<(i32, i32)>)> {
    let words: Vec<&str> = input.split_whitespace().collect();
    if words.len() < 2 {
        return None;
    }
    let last = *words.last()?;
    let (book_words, cv) = if last.chars().all(|c| c.is_ascii_digit()) && words.len() >= 3 && words[words.len() - 2].chars().all(|c| c.is_ascii_digit()) {
        (&words[..words.len() - 2], format!("{}:{}", words[words.len() - 2], last))
    } else {
        (&words[..words.len() - 1], last.to_string())
    };
    if book_words.is_empty() {
        return None;
    }
    let (ch, vs) = match cv.split_once([':', '.']) {
        Some((c, v)) => (c, Some(v)),
        None => (cv.as_str(), None),
    };
    let chapter: i32 = ch.parse().ok().filter(|c| (1..=150).contains(c))?;
    let verses = match vs {
        None => None,
        Some(v) => {
            let (a, b) = v.split_once(['-', '–']).unwrap_or((v, v));
            let a: i32 = a.trim().parse().ok().filter(|n| *n >= 1)?;
            let b: i32 = b.trim().parse().ok().filter(|n| *n >= a)?;
            Some((a, b.min(a + 49)))
        }
    };
    Some((book_words.join(" "), chapter, verses))
}

/// A passage found in an installed edition.
pub(crate) struct Passage {
    pub translation: String,
    pub book_name: String,
    pub book_number: i32,
    pub chapter: i32,
    pub verses: Option<(i32, i32)>,
    pub rows: Vec<rhema_bible::Verse>,
}

impl Passage {
    pub fn reference(&self) -> String {
        match self.verses {
            Some((a, z)) if a == z => format!("{} {}:{a}", self.book_name, self.chapter),
            Some((a, z)) => format!("{} {}:{a}-{z}", self.book_name, self.chapter),
            None => format!("{} {}", self.book_name, self.chapter),
        }
    }
}

/// A typed reference in an installed edition (the first English one by default), or why not.
pub(crate) fn find_passage(b: &BibleDb, reference: &str, translation: &str) -> Result<Passage, String> {
    let (book, chapter, verses) = parse_reference(reference).ok_or("not a Bible reference (e.g. \"Romans 8:28\", \"Psalm 23\")")?;
    let translations = b.list_translations().map_err(|_| "no Bible editions found")?;
    let t = if translation.is_empty() {
        translations.iter().find(|t| t.language == "en").or(translations.first())
    } else {
        translations.iter().find(|t| t.abbreviation.eq_ignore_ascii_case(translation))
    };
    let t = t.ok_or("that edition is not installed (use rhema_list_translations)")?;
    let books = b.list_books(t.id).unwrap_or_default();
    // "I Corinthians", "1 Cor", "First Corinthians" are one book: a leading numeral word becomes a digit.
    let key = |s: &str| {
        let lower = s.to_lowercase();
        let mut words = lower.split_whitespace();
        let first = words.next().unwrap_or("");
        let lead = match first.trim_end_matches('.') {
            "i" | "1" | "1st" | "first" => Some("1"),
            "ii" | "2" | "2nd" | "second" => Some("2"),
            "iii" | "3" | "3rd" | "third" => Some("3"),
            _ => None,
        };
        let rest: String = words.collect::<Vec<_>>().join("");
        match lead {
            Some(d) if !rest.is_empty() => format!("{d}{}", rest.replace('.', "")),
            _ => lower.replace(['.', ' '], ""),
        }
    };
    let want = key(&book);
    let found = books.iter().find(|x| key(&x.name) == want || key(&x.abbreviation) == want).or_else(|| books.iter().find(|x| key(&x.name).starts_with(&want) && want.len() >= 2));
    let found = found.ok_or("no such book in that edition")?;
    let rows = match verses {
        Some((a, z)) => b.get_verse_range(t.id, found.book_number, chapter, a, z),
        None => b.get_chapter(t.id, found.book_number, chapter),
    }
    .map_err(|e| format!("could not read the Bible: {e}"))?;
    if rows.is_empty() {
        return Err("that chapter or verse is not in this edition".into());
    }
    Ok(Passage { translation: t.abbreviation.clone(), book_name: found.name.clone(), book_number: found.book_number, chapter, verses, rows })
}

fn lookup(b: &BibleDb, reference: &str, translation: &str) -> Value {
    match find_passage(b, reference, translation) {
        Ok(p) => text(&json!({ "reference": p.reference(), "translation": p.translation, "verses": p.rows.iter().map(|x| json!({ "verse": x.verse, "text": x.text })).collect::<Vec<_>>() })),
        Err(e) => tool_error(&e),
    }
}

/// One JSON-RPC message in, at most one out (None for notifications).
fn handle(s: &mut Server, msg: &Value) -> Option<Value> {
    let id = msg.get("id").cloned()?;
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    let result = match method {
        "initialize" => {
            if let Some(c) = params.get("clientInfo") {
                s.client = json!({ "name": c.get("name").and_then(Value::as_str).unwrap_or("an assistant").chars().take(60).collect::<String>(), "version": c.get("version").and_then(Value::as_str).unwrap_or("").chars().take(30).collect::<String>() });
            }
            json!({
            "protocolVersion": params.get("protocolVersion").and_then(Value::as_str).unwrap_or("2025-06-18"),
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": "rhema-studio", "title": "Rhema Studio", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Access to this church's Rhema Studio: read its services, songs and hymns and the installed Bible editions, and propose a service as a draft for the church to review (check it with rhema_validate_service_draft, then rhema_create_service_draft). Quote Scripture only from rhema_lookup_bible_reference; refer to songs by title and number (lyrics are not available); list songs you cannot find rather than inventing them."
            })
        }
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools() }),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            call(s, name, params.get("arguments").unwrap_or(&Value::Null))
        }
        _ => return Some(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "method not found" } })),
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

/// Serve MCP on stdin/stdout until stdin closes. Logs go to stderr only.
pub fn serve() {
    let mut server = Server::open();
    eprintln!("[rhema-mcp] ready (enabled: {}, services: {}, bible: {})", server.enabled, server.content.is_some(), server.bible.is_some());
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        // A message over 1 MB is not a planning request.
        let reply = if line.len() > 1_000_000 {
            Some(json!({ "jsonrpc": "2.0", "id": Value::Null, "error": { "code": -32600, "message": "message too large" } }))
        } else {
            match serde_json::from_str::<Value>(&line) {
                Ok(msg) => handle(&mut server, &msg),
                Err(_) => Some(json!({ "jsonrpc": "2.0", "id": Value::Null, "error": { "code": -32700, "message": "parse error" } })),
            }
        };
        if let Some(r) = reply {
            if writeln!(out, "{r}").and_then(|()| out.flush()).is_err() {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn off() -> Server {
        Server { dir: None, client: Value::Null, content: None, bible: None, enabled: false, church: String::new(), problem: None }
    }

    #[test]
    fn references_people_type() {
        assert_eq!(parse_reference("Romans 8:28"), Some(("Romans".into(), 8, Some((28, 28)))));
        assert_eq!(parse_reference("1 Corinthians 13:4-7"), Some(("1 Corinthians".into(), 13, Some((4, 7)))));
        assert_eq!(parse_reference("jn 3 16"), Some(("jn".into(), 3, Some((16, 16)))));
        assert_eq!(parse_reference("Psalm 23"), Some(("Psalm".into(), 23, None)));
        assert_eq!(parse_reference("Psalm 119:1-200").unwrap().2, Some((1, 50)), "ranges are bounded");
        for bad in ["Romans", "8:28", "Romans x:y", "Romans 8:9-3", ""] {
            assert!(parse_reference(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn speaks_mcp_and_stays_off_until_allowed() {
        let mut s = off();
        let init = handle(&mut s, &json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18" } })).unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-06-18");
        assert!(init["result"]["capabilities"]["tools"].is_object());
        assert!(handle(&mut s, &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).is_none(), "notifications get no reply");
        let list = handle(&mut s, &json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })).unwrap();
        let names: Vec<&str> = list["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert!(names.contains(&"rhema_lookup_bible_reference") && names.contains(&"rhema_get_service"));
        // Everything reads, except saving a draft for review (it writes only a draft file).
        assert!(list["result"]["tools"].as_array().unwrap().iter().all(|t| (t["annotations"]["readOnlyHint"] == true) != (t["name"] == "rhema_create_service_draft")));
        let call = handle(&mut s, &json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "rhema_list_services", "arguments": {} } })).unwrap();
        assert_eq!(call["result"]["isError"], true);
        assert!(call["result"]["content"][0]["text"].as_str().unwrap().contains("Settings → AI assistants"));
        let unknown = handle(&mut s, &json!({ "jsonrpc": "2.0", "id": 4, "method": "resources/write" })).unwrap();
        assert_eq!(unknown["error"]["code"], -32601);
    }

    #[test]
    fn scripture_comes_from_the_installed_edition() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../data/rhema.db");
        let Ok(b) = BibleDb::open(&path) else { return }; // the Bible database is not in every checkout
        let r = lookup(&b, "John 3:16", "KJV");
        assert_eq!(r["isError"], false, "{r}");
        assert_eq!(r["structuredContent"]["reference"], "John 3:16");
        assert!(r["structuredContent"]["verses"][0]["text"].as_str().unwrap().contains("God so loved the world"));
        let range = lookup(&b, "1 Cor 13:4-7", "KJV");
        assert_eq!(range["structuredContent"]["verses"].as_array().unwrap().len(), 4, "{range}");
        assert_eq!(lookup(&b, "Hezekiah 1:1", "KJV")["isError"], true, "no such book");
        assert_eq!(lookup(&b, "John 3:16", "XYZ")["isError"], true, "not installed");
    }

    #[test]
    fn reads_services_and_songs_without_lyrics() {
        let dir = std::env::temp_dir().join(format!("rhema-mcp-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("studio.db");
        {
            let db = ContentDb::open(&path).unwrap();
            db.create_program("Thanksgiving Service", Some("2026-11-01")).unwrap();
        }
        let s = Server { dir: None, client: Value::Null, content: Some(ContentDb::open_read_only(&path).unwrap()), bible: None, enabled: true, church: "CAC".into(), problem: None };
        let r = call(&s, "rhema_list_services", &json!({}));
        assert_eq!(r["isError"], false);
        assert_eq!(r["structuredContent"]["services"][0]["title"], "Thanksgiving Service");
        let id = r["structuredContent"]["services"][0]["id"].as_str().unwrap().to_string();
        let one = call(&s, "rhema_get_service", &json!({ "id": id }));
        assert_eq!(one["structuredContent"]["title"], "Thanksgiving Service");
        assert_eq!(call(&s, "rhema_get_service", &json!({ "id": "nope" }))["isError"], true);
        assert_eq!(call(&s, "rhema_search_songs", &json!({ "query": "" }))["isError"], true);
        assert_eq!(call(&s, "rhema_lookup_bible_reference", &json!({ "reference": "John 3:16" }))["isError"], true, "no Bible here");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
