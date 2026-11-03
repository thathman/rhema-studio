//! Design drafts an assistant proposes over MCP (#443 C5 slice 1,
//! `docs/contracts/mcp-design-drafts-v1.md`): read the design catalogue and what a design may hold,
//! check a proposal, and save it as a NEW draft in the canonical design store. Never a version, an
//! edit of an existing design, a pin, an approval, a Take or anything on a screen.

use serde_json::{json, Value};

use rhema_content::proposal::{self, Issue};
use rhema_content::{ContentDb, DesignInput};

use super::{text, tool_error, Server};

pub(super) fn tools() -> Vec<Value> {
    let ro = json!({ "readOnlyHint": true, "destructiveHint": false, "openWorldHint": false });
    let design = json!({ "type": "object", "description": "A proposed design: { title, kind?, background?, pages: [ { title, layers: [ … ] } ] } (rhema_get_design_capabilities has the layer fields)." });
    vec![
        json!({ "name": "rhema_get_design_capabilities", "description": "What a design proposed here may hold, so Rhema's screens draw it exactly as the Design editor shows it: 1920×1080 pages of text (both service languages), rectangles and ellipses (solid or linear-gradient fills) and pictures from the church's media library by id, with the limits and what is refused and why.", "inputSchema": { "type": "object", "properties": {} }, "annotations": ro }),
        json!({ "name": "rhema_list_designs", "description": "The church's designs in Rhema Studio → Design (newest change first): id, title, kind, draft revision and latest saved version. No documents.", "inputSchema": { "type": "object", "properties": { "query": { "type": "string", "description": "words in the title" }, "limit": { "type": "integer", "minimum": 1, "maximum": super::MAX_LIST } } }, "annotations": ro }),
        json!({ "name": "rhema_validate_design_draft", "description": "Check a proposed design without saving it: every page and layer, the fills and fonts, both languages' words and that each picture is in the media library. Returns errors (with where each is), warnings and what would be made.", "inputSchema": { "type": "object", "properties": { "design": design }, "required": ["design"] }, "annotations": ro }),
        json!({ "name": "rhema_create_design_draft", "description": "Save a checked proposed design as a NEW draft in Rhema Studio → Design → My Designs, for people to open, edit, save and version themselves. It never changes an existing design, makes a version, approves anything, touches a service or puts anything on screen. Fails with the same errors as the check.", "inputSchema": { "type": "object", "properties": { "design": design }, "required": ["design"] }, "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false } }),
    ]
}

fn capabilities() -> Value {
    let common = json!({ "name": "optional, up to 80 characters", "x": "0–1919 px from the left", "y": "0–1079 px from the top", "width": "px (fits the page)", "opacity": "0–1, default 1" });
    json!({
        "artboard": { "width": proposal::DESIGN_WIDTH, "height": proposal::DESIGN_HEIGHT, "units": "px, top-left origin" },
        "design": { "title": "up to 200 characters", "kind": "design (default) or slide", "background": "a fill shared by every page (default solid #0b1020)", "pages": format!("1–{} pages, each {{ title (up to 80, unique), layers: 1–{} bottom first }}; at most {} layers in all", proposal::MAX_PAGES, proposal::MAX_LAYERS_PER_PAGE, proposal::MAX_LAYERS) },
        "fill": [ { "type": "solid", "color": "#rrggbb" }, { "type": "gradient", "angle": "degrees, -360–360 (0 bottom to top, 90 left to right)", "stops": "2–16 of { color: #rrggbb or #rrggbbaa, offset: 0–1, in order }" } ],
        "layers": {
            "text": { "common": common, "height": "box height px (default one line)", "text": format!("the words in the first service language, up to {} characters; \\n breaks a line", proposal::MAX_TEXT_CHARS), "textSecond": "the same words in the second service language (expected when the church has two)", "fontSize": "8–400, default 64", "fontFamily": "a font name (default Arial); the Brand Kit's fonts are in rhema_get_church_profile", "fontWeight": "\"400\"–\"900\", default \"600\"", "fontStyle": "normal or italic", "textAlign": "left, center (default) or right", "lineHeight": "0.5–3, default 1.2", "color": "#rrggbb, default #ffffff", "underline": "true or false" },
            "rect": { "common": common, "height": "px", "fill": "a fill" },
            "ellipse": { "common": common, "height": "px", "fill": "a fill" },
            "picture": { "common": common, "height": "px", "mediaId": "a picture's id from rhema_list_media; screens fill the box keeping its shape" },
        },
        "refused": [
            "lines, arrows, polygons and stars; rotation, flipping, shadow, blur, outlines and rounded corners: Rhema's screens do not draw them yet",
            "gradient or non-hex text colours",
            "pictures by address (web, file or data URLs): only the media library, by id",
            "crops and masks: people add them in the Design editor",
            "control and text-direction characters in words",
            "ids, revisions, versions, pins, approvals, outputs or services: an assistant only makes a new draft",
        ],
        "rules": [
            "A draft is saved in Rhema Studio → Design → My Designs. People open it, edit it, save it and make a version; only a version can be used in a service, and only an approved service reaches the screens.",
            "Nothing here can change an existing design, a service or a screen.",
            "Check with rhema_validate_design_draft, then save with rhema_create_design_draft.",
        ],
    })
}

/// "Yorùbá and English", "English, French": two or more service languages.
fn bilingual(s: &Server) -> bool {
    let st = s.dir.as_deref().map_or(Value::Null, super::settings);
    let langs = super::setting(&st, "machine", "setup").and_then(|v| v.get("serviceLanguages")).and_then(Value::as_str).unwrap_or("").to_lowercase();
    langs.replace(" and ", ",").split([',', '&', '/', '+']).filter(|l| !l.trim().is_empty()).count() > 1
}

fn issues(list: &[Issue]) -> Value {
    json!(list.iter().map(|i| json!({ "at": i.path, "message": i.message })).collect::<Vec<_>>())
}

fn assistant(s: &Server) -> String {
    let name = s.client["name"].as_str().unwrap_or("an AI assistant");
    let version = s.client["version"].as_str().unwrap_or("");
    if version.is_empty() { name.to_string() } else { format!("{name} {version}") }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(0))
}

/// The design tools' answers; None for a name that is not one of them.
pub(super) fn call(s: &Server, name: &str, a: &Value) -> Option<Value> {
    Some(match name {
        "rhema_get_design_capabilities" => text(&capabilities()),
        "rhema_list_designs" => {
            let Some(c) = &s.content else { return Some(tool_error(s.problem.as_deref().unwrap_or("no designs"))) };
            let limit = a.get("limit").and_then(Value::as_u64).map_or(20, |n| usize::try_from(n).unwrap_or(super::MAX_LIST).clamp(1, super::MAX_LIST));
            match c.list_designs(a.get("query").and_then(Value::as_str), None, limit) {
                Ok(list) => text(&json!({ "designs": list.iter().map(|d| json!({ "id": d.id, "title": d.title, "kind": d.kind, "revision": d.revision, "latestVersion": d.latest_version, "updatedAt": d.updated_at })).collect::<Vec<_>>() })),
                Err(e) => tool_error(&format!("could not read the designs: {e}")),
            }
        }
        "rhema_validate_design_draft" | "rhema_create_design_draft" => {
            let (Some(c), Some(dir)) = (&s.content, s.dir.as_deref()) else { return Some(tool_error(s.problem.as_deref().unwrap_or("no Rhema data on this computer yet"))) };
            // Absolute, as the app's own media folder is: a relative `--data` would store an address the editor cannot load.
            let media = std::path::absolute(dir.join("media")).unwrap_or_else(|_| dir.join("media"));
            let mut next_id = |kind: &str| format!("{kind}-{}", uuid::Uuid::new_v4());
            let built = proposal::build(a.get("design").unwrap_or(&Value::Null), bilingual(s), &|id| proposal::library_picture(c, &media, id), &mut next_id, now_ms());
            let built = match built {
                Ok(b) => b,
                Err((errors, warnings)) => {
                    eprintln!("[rhema-mcp] design proposal from {} refused: {} problem(s)", assistant(s), errors.len());
                    let report = json!({ "ok": false, "errors": issues(&errors), "warnings": issues(&warnings) });
                    if name == "rhema_validate_design_draft" {
                        return Some(text(&report));
                    }
                    let mut r = tool_error("the design was not saved: fix the errors first (they are listed with where each is)");
                    r["structuredContent"] = report;
                    return Some(r);
                }
            };
            let mut report = json!({ "ok": true, "errors": [], "warnings": issues(&built.warnings), "title": built.title, "kind": built.kind, "pages": built.pages, "layers": built.layers });
            if name == "rhema_validate_design_draft" {
                return Some(text(&report));
            }
            // A handle of its own for this one save: the server otherwise only reads.
            let saved = ContentDb::open_existing(&dir.join("studio.db")).and_then(|db| db.create_assistant_design(&DesignInput { title: built.title, kind: built.kind, document: built.document }, &assistant(s)));
            match saved {
                Ok(d) => {
                    eprintln!("[rhema-mcp] design draft {} created by {}", d.id, assistant(s));
                    report["designId"] = json!(d.id);
                    report["revision"] = json!(d.revision);
                    report["next"] = json!("Saved as a draft in Rhema Studio → Design → My Designs. People open it there, edit and save it, and make a version before any service can use it; nothing is approved or shown until they do.");
                    text(&report)
                }
                Err(e) => tool_error(&format!("the design could not be saved: {e}")),
            }
        }
        _ => return None,
    })
}
