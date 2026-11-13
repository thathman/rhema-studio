//! Design drafts an assistant proposes over MCP (#443 C5 slice 1,
//! `docs/contracts/mcp-design-drafts-v1.md`): read the design catalogue and what a design may hold,
//! check a proposal, and save it as a NEW draft in the canonical design store. Never a version, an
//! edit of an existing design, a pin, an approval, a Take or anything on a screen.

use serde_json::{json, Value};

use rhema_content::proposal::{self, Issue};
use rhema_content::{ContentDb, ContentError, DesignInput};

use super::{text, tool_error, Server};

pub(super) fn tools() -> Vec<Value> {
    let ro = json!({ "readOnlyHint": true, "destructiveHint": false, "openWorldHint": false });
    let design = json!({ "type": "object", "description": "A proposed design: { title, kind?, background?, pages: [ { title, layers: [ … ] } ] } (rhema_get_design_capabilities has the layer fields)." });
    vec![
        json!({ "name": "rhema_get_design_capabilities", "description": "What a design proposed here may hold, so Rhema's screens draw it exactly as the Design editor shows it: 1920×1080 pages of text (both service languages), rectangles and ellipses (solid or linear-gradient fills) and pictures from the church's media library by id, with the limits and what is refused and why.", "inputSchema": { "type": "object", "properties": {} }, "annotations": ro }),
        json!({ "name": "rhema_list_designs", "description": "The church's designs in Rhema Studio → Design (newest change first): id, title, kind, draft revision and latest saved version. No documents.", "inputSchema": { "type": "object", "properties": { "query": { "type": "string", "description": "words in the title" }, "limit": { "type": "integer", "minimum": 1, "maximum": super::MAX_LIST } } }, "annotations": ro }),
        json!({ "name": "rhema_validate_design_draft", "description": "Check a proposed design without saving it: every page and layer, the fills and fonts, both languages' words and that each picture is in the media library. Returns errors (with where each is), warnings and what would be made.", "inputSchema": { "type": "object", "properties": { "design": design }, "required": ["design"] }, "annotations": ro }),
        json!({ "name": "rhema_get_design", "description": "One design from rhema_list_designs: its title, kind, draft revision, latest version, whether an assistant may still revise it, and the editor's document (pages and layers as Rhema stores them).", "inputSchema": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] }, "annotations": ro }),
        json!({ "name": "rhema_update_design_draft", "description": "Replace a draft an assistant made with a revised proposal (same shape and checks as rhema_create_design_draft). Only a draft an assistant made over MCP that no person has saved since and that has no version yet, and only at the revision you read (else it is refused: read it again). Never a version, an approval, a service or a screen.", "inputSchema": { "type": "object", "properties": { "id": { "type": "string" }, "revision": { "type": "integer", "minimum": 1 }, "design": design }, "required": ["id", "revision", "design"] }, "annotations": { "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false } }),
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
            "ids, revisions, versions, pins, approvals, outputs or services in a proposal: an assistant only makes or revises its own drafts",
        ],
        "rules": [
            "A draft is saved in Rhema Studio → Design → My Designs. People open it, edit it, save it and make a version; only a version can be used in a service, and only an approved service reaches the screens.",
            "Nothing here can change an existing design, a service or a screen.",
            "Check with rhema_validate_design_draft, then save with rhema_create_design_draft.",
            "To change a draft you made, read it with rhema_get_design and send the whole revised proposal to rhema_update_design_draft with the revision you read. Once a person saves it or makes a version, it is theirs.",
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

/// Keys that hold an address of a file or device on this computer or network.
const ADDRESS_KEYS: [&str; 9] = ["src", "imageUrl", "videoUrl", "cameraUrl", "url", "href", "mediaFile", "file", "path"];

/// A string that is a local or embedded address, wherever it appears.
fn is_address(t: &str) -> bool {
    let l = t.trim_start().to_ascii_lowercase();
    l.starts_with("asset:") || l.starts_with("http://asset.localhost") || l.starts_with("https://asset.localhost") || l.starts_with("file:") || l.starts_with("blob:") || l.starts_with("data:")
        || l.starts_with("\\\\") || l.starts_with("~/") || l.starts_with("/users/") || l.starts_with("/home/") || l.starts_with("/volumes/") || l.starts_with("/private/")
        || (l.len() > 2 && l.as_bytes()[1] == b':' && l.as_bytes()[0].is_ascii_alphabetic() && matches!(l.as_bytes()[2], b'\\' | b'/'))
        || l.contains("url(")
}

/// The document with every local file address taken out (pictures keep their media id): this
/// computer's folders and devices are never handed to an assistant. Words in text layers stay.
fn without_local_addresses(mut v: Value) -> Value {
    fn walk(v: &mut Value) {
        match v {
            Value::Object(map) => {
                map.retain(|k, x| !x.as_str().is_some_and(|t| ADDRESS_KEYS.contains(&k.as_str()) || is_address(t)));
                map.values_mut().for_each(walk);
            }
            Value::Array(list) => {
                list.retain(|x| !x.as_str().is_some_and(is_address));
                list.iter_mut().for_each(walk);
            }
            _ => {}
        }
    }
    walk(&mut v);
    v
}

/// The most of a design's document handed to an assistant (it is sent twice: as text and structured).
const MAX_DOCUMENT_BYTES: usize = 256 * 1024;

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
        "rhema_get_design" => {
            let Some(c) = &s.content else { return Some(tool_error(s.problem.as_deref().unwrap_or("no designs"))) };
            let Some(id) = a.get("id").and_then(Value::as_str) else { return Some(tool_error("give the design's id (from rhema_list_designs)")) };
            match c.get_design(id) {
                Ok(Some(d)) => {
                    let may_revise = c.assistant_may_revise_design(&d.id).unwrap_or(false);
                    let doc = without_local_addresses(d.document);
                    let document = if doc.to_string().len() > MAX_DOCUMENT_BYTES { json!({ "omitted": "This design is too large to read here; open it in Rhema Studio → Design → My Designs." }) } else { doc };
                    text(&json!({ "id": d.id, "title": d.title, "kind": d.kind, "revision": d.revision, "latestVersion": d.latest_version, "updatedAt": d.updated_at, "archived": d.archived_at.is_some(), "assistantMayRevise": may_revise, "document": document }))
                }
                Ok(None) => tool_error("there is no design with that id"),
                Err(e) => tool_error(&format!("could not read the design: {e}")),
            }
        }
        "rhema_validate_design_draft" | "rhema_create_design_draft" | "rhema_update_design_draft" => {
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
            let input = DesignInput { title: built.title, kind: built.kind, document: built.document };
            if name == "rhema_update_design_draft" {
                let (Some(id), Some(revision)) = (a.get("id").and_then(Value::as_str), a.get("revision").and_then(Value::as_i64)) else {
                    return Some(tool_error("give the draft's id and the revision you read (rhema_get_design)"));
                };
                let saved = ContentDb::open_existing(&dir.join("studio.db")).and_then(|db| db.revise_assistant_design(id, revision, &input, &assistant(s)));
                return Some(match saved {
                    Ok(d) => {
                        eprintln!("[rhema-mcp] design draft {} revised by {}", d.id, assistant(s));
                        report["designId"] = json!(d.id);
                        report["revision"] = json!(d.revision);
                        report["next"] = json!("Revised in Rhema Studio → Design → My Designs. It is still a draft: people open it, edit and save it, and make a version before any service can use it.");
                        text(&report)
                    }
                    Err(ContentError::Conflict { actual, .. }) => tool_error(&format!("the draft changed since you read it (now revision {actual}): read it again with rhema_get_design")),
                    Err(e) => tool_error(&format!("the draft was not revised: {e}")),
                });
            }
            // A handle of its own for this one save: the server otherwise only reads.
            let saved = ContentDb::open_existing(&dir.join("studio.db")).and_then(|db| db.create_assistant_design(&input, &assistant(s)));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_addresses_never_reach_an_assistant_but_words_do() {
        let doc = json!({
            "bindings": { "p": { "kind": "picture", "mediaId": "m1", "imageUrl": "asset://localhost/%2FUsers%2Fa%2Fx.png" }, "c": { "kind": "camera", "cameraUrl": "http://192.168.3.90:8889/cam" } },
            "scene": { "nodes": [
                { "type": "text", "text": "/ Pastor Ade", "fill": "url(file:///Users/a/x.png)" },
                { "type": "image", "srcs": ["C:\\Users\\a\\x.png", "\\\\server\\share\\y.png", "data:image/png;base64,AAAA", "keep me"] },
                { "type": "image", "src": "http://asset.localhost/C%3A%5Cx.png", "note": "/Users/a/secret.png" }
            ] }
        });
        let out = without_local_addresses(doc).to_string();
        for leak in ["asset", "192.168", "file:", "Users", "server", "data:image"] {
            assert!(!out.contains(leak), "{leak} in {out}");
        }
        for kept in ["/ Pastor Ade", "keep me", "m1"] {
            assert!(out.contains(kept), "{kept} kept in {out}");
        }
    }
}
