//! An assistant's proposed design becomes a new editable draft in the canonical store, and nothing
//! else (#443 C5 slice 1). `fixtures/mcp-design-draft.json` is the document this builds from
//! `fixtures/mcp-design-proposal.json`; `mcp-design-draft.render.test.ts` opens it with the editor's
//! adapter and draws it with the output renderer, so the two stay one contract.
//! `UPDATE_GOLDEN=1 cargo test -p rhema-content --test mcp_design_draft` rewrites it.

use std::path::{Path, PathBuf};

use rhema_content::proposal::{build, library_picture, Built, Issue, Picture};
use rhema_content::{ContentDb, DesignInput, MediaInput};
use serde_json::{json, Value};

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
}

fn proposal() -> Value {
    serde_json::from_str(&std::fs::read_to_string(fixture("mcp-design-proposal.json")).unwrap()).unwrap()
}

fn choir(id: &str) -> Result<Picture, String> {
    if id == "m-choir" {
        Ok(Picture { url: "asset://localhost/%2Fmedia%2Fchoir.png".into(), width: Some(1600.0), height: Some(900.0) })
    } else {
        Err(format!("\"{id}\" is not a picture in the church's media library"))
    }
}

fn counted() -> impl FnMut(&str) -> String {
    let mut n = 0;
    move |kind| {
        n += 1;
        format!("{kind}-{n}")
    }
}

fn try_build(p: &Value, bilingual: bool) -> Result<Built, (Vec<Issue>, Vec<Issue>)> {
    build(p, bilingual, &choir, &mut counted(), 1_700_000_000_000)
}

fn errors(p: &Value) -> Vec<Issue> {
    match try_build(p, true) {
        Ok(_) => panic!("expected errors for {p}"),
        Err((e, _)) => e,
    }
}

fn has(errors: &[Issue], path: &str, words: &str) -> bool {
    errors.iter().any(|e| e.path == path && e.message.contains(words))
}

#[test]
fn a_bilingual_three_page_announcement_builds_the_golden_document() {
    let built = try_build(&proposal(), true).unwrap_or_else(|(e, _)| panic!("{e:?}"));
    assert_eq!((built.pages, built.layers, built.kind.as_str()), (3, 6, "design"));
    assert_eq!(built.warnings, Vec::<Issue>::new());
    let golden = fixture("mcp-design-draft.json");
    let text = serde_json::to_string_pretty(&built.document).unwrap() + "\n";
    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        std::fs::write(&golden, &text).unwrap();
    }
    assert_eq!(std::fs::read_to_string(&golden).unwrap(), text, "the golden document changed: rerun with UPDATE_GOLDEN=1 and check the render test");
    // Pages are direct groups under the root, in order, named as the pages.
    let doc = &built.document;
    let root = &doc["scene"]["nodes"]["root"];
    assert_eq!(root["children"].as_array().unwrap().len(), 3);
    for (i, page) in doc["pages"].as_array().unwrap().iter().enumerate() {
        assert_eq!(root["children"][i], page["nodeId"]);
        assert_eq!(doc["scene"]["nodes"][page["nodeId"].as_str().unwrap()]["name"], page["title"]);
    }
    // Every layer has a binding; the picture is the library's, by id, at its local address.
    let picture = doc["bindings"].as_object().unwrap().values().find(|b| b["kind"] == "picture").unwrap();
    assert_eq!((picture["mediaId"].as_str(), picture["imageUrl"].as_str()), (Some("m-choir"), Some("asset://localhost/%2Fmedia%2Fchoir.png")));
}

#[test]
fn a_missing_second_language_is_a_warning_and_a_one_language_church_is_not_asked() {
    let mut p = proposal();
    p["pages"][0]["layers"][1].as_object_mut().unwrap().remove("textSecond");
    let built = try_build(&p, true).unwrap_or_else(|(e, _)| panic!("{e:?}"));
    assert_eq!(built.warnings.len(), 1);
    assert_eq!(built.warnings[0].path, "pages[0].layers[1].textSecond");
    assert_eq!(try_build(&p, false).unwrap_or_else(|(e, _)| panic!("{e:?}")).warnings, Vec::<Issue>::new());
}

#[test]
fn what_outputs_cannot_draw_is_refused_by_name_never_dropped() {
    let mut p = proposal();
    let layers = p["pages"][0]["layers"].as_array_mut().unwrap();
    layers.push(json!({ "type": "star", "x": 0, "y": 0, "width": 10, "height": 10 }));
    layers.push(json!({ "type": "rect", "x": 0, "y": 0, "width": 10, "height": 10, "fill": { "type": "solid", "color": "#ffffff" }, "rotation": 15, "shadow": { "blur": 4 }, "stroke": "#000000" }));
    layers.push(json!({ "type": "text", "x": 0, "y": 0, "width": 400, "text": "Hi", "color": { "type": "gradient" } }));
    layers.push(json!({ "type": "ellipse", "x": 0, "y": 0, "width": 10, "height": 10, "fill": { "type": "pattern" } }));
    layers.push(json!({ "type": "rect", "x": 0, "y": 0, "width": 10, "height": 10, "fill": { "type": "gradient", "angle": 0, "stops": [{ "color": "red", "offset": 0 }, { "color": "#000000", "offset": 1 }] } }));
    let e = errors(&p);
    assert!(has(&e, "pages[0].layers[2].type", "use text, rect, ellipse or picture"), "{e:?}");
    assert!(has(&e, "pages[0].layers[3].rotation", "rotation"), "{e:?}");
    assert!(has(&e, "pages[0].layers[3].shadow", "shadow"), "{e:?}");
    assert!(has(&e, "pages[0].layers[3].stroke", "outlines"), "{e:?}");
    assert!(has(&e, "pages[0].layers[4].color", "text colour must be #rrggbb"), "{e:?}");
    assert!(has(&e, "pages[0].layers[5].fill.type", "solid\" or \"gradient"), "{e:?}");
    assert!(has(&e, "pages[0].layers[6].fill.stops[0]", "#rrggbb"), "{e:?}");
}

#[test]
fn unknown_fields_inside_fills_and_gradient_stops_are_refused() {
    let mut p = proposal();
    p["pages"][0]["layers"][0]["fill"]["shadow"] = json!({ "blur": 4 });
    p["background"]["stops"][0]["url"] = json!("file:///tmp/secret.png");
    let e = errors(&p);
    assert!(has(&e, "pages[0].layers[0].fill.shadow", "unknown fields are refused"), "{e:?}");
    assert!(has(&e, "background.stops[0].url", "unknown fields are refused"), "{e:?}");
}

#[test]
fn addresses_markup_and_hidden_characters_are_refused() {
    let mut p = proposal();
    let layers = p["pages"][2]["layers"].as_array_mut().unwrap();
    layers.push(json!({ "type": "picture", "x": 0, "y": 0, "width": 10, "height": 10, "src": "https://example.com/x.png" }));
    layers.push(json!({ "type": "picture", "x": 0, "y": 0, "width": 10, "height": 10, "mediaId": "file:///etc/passwd" }));
    layers.push(json!({ "type": "text", "x": 0, "y": 0, "width": 400, "text": "Give at \u{202E}moc.evil\u{202C}" }));
    layers.push(json!({ "type": "text", "x": 0, "y": 0, "width": 400, "text": "bell\u{7}" }));
    layers.push(json!({ "type": "text", "x": 0, "y": 0, "width": 400, "text": "<script>alert(1)</script>", "fontFamily": "x;}body{background:url(https://evil)" }));
    let e = errors(&p);
    assert!(has(&e, "pages[2].layers[2].src", "media library"), "{e:?}");
    assert!(has(&e, "pages[2].layers[2].mediaId", "needs the mediaId"), "{e:?}");
    assert!(has(&e, "pages[2].layers[3].mediaId", "not a picture in the church's media library"), "{e:?}");
    assert!(has(&e, "pages[2].layers[4].text", "text-direction"), "{e:?}");
    assert!(has(&e, "pages[2].layers[5].text", "control"), "{e:?}");
    assert!(has(&e, "pages[2].layers[6].fontFamily", "font family"), "{e:?}");
    // Words that only look like markup are words: drawn as typed, never interpreted.
    assert!(!e.iter().any(|i| i.path == "pages[2].layers[6].text"), "{e:?}");
}

#[test]
fn malformed_or_oversized_proposals_and_pinning_fields_are_refused() {
    assert!(has(&errors(&json!("a poster please")), "", "give a design"));
    assert!(has(&errors(&json!({ "title": "x", "pages": [] })), "pages", "1 to 12 pages"));
    let mut p = proposal();
    p["designRef"] = json!({ "id": "d", "version": 3 });
    p["approved"] = json!(true);
    p["pages"][1]["layers"] = json!([]);
    p["pages"][0]["layers"][0]["x"] = json!(5000);
    p["pages"][0]["layers"][1]["text"] = json!("x".repeat(2001));
    let e = errors(&p);
    assert!(has(&e, "designRef", "only makes a new draft"), "{e:?}");
    assert!(has(&e, "approved", "only makes a new draft"), "{e:?}");
    assert!(has(&e, "pages[1].layers", "1 to 40 layers"), "{e:?}");
    assert!(has(&e, "pages[0].layers[0].x", "from 0 to 1919"), "{e:?}");
    assert!(has(&e, "pages[0].layers[1].text", "2000 characters"), "{e:?}");
    let big = json!({ "title": "x", "pages": [{ "title": "p", "layers": [{ "type": "text", "x": 0, "y": 0, "width": 10, "text": "y".repeat(300_000) }] }] });
    assert!(has(&errors(&big), "", "limited to 256 KB"));
    let many: Vec<Value> = (0..13).map(|i| json!({ "title": format!("p{i}"), "layers": [{ "type": "text", "x": 0, "y": 0, "width": 10, "text": "y" }] })).collect();
    assert!(has(&errors(&json!({ "title": "x", "pages": many })), "pages", "1 to 12 pages"));
}

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("rhema-mcp-design-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("media")).unwrap();
    dir
}

#[test]
fn the_draft_is_saved_beside_the_running_app_as_a_new_unversioned_design_by_the_assistant() {
    let dir = temp("save");
    let db_path = dir.join("studio.db");
    let app = ContentDb::open(&db_path).unwrap();
    let theirs = app.create_design(&DesignInput { title: "Sunday look".into(), kind: "design".into(), document: try_build(&proposal(), false).unwrap().document }).unwrap();
    app.create_design_version(&theirs.id, theirs.revision, None, "Ada").unwrap();
    let service = app.create_program("Sunday", None).unwrap();
    std::fs::write(dir.join("media/choir.png"), b"png").unwrap();
    let pic = app
        .register_media(&MediaInput { kind: "image".into(), name: "Choir".into(), file: "choir.png".into(), hash: "a".repeat(64), size: 3, mime: "image/png".into(), width: Some(1600), height: Some(900), duration_ms: None, source: "local".into(), source_ref: String::new(), original_path: String::new() })
        .unwrap();

    // The MCP server's own handle, while the app keeps its own open.
    let mcp = ContentDb::open_existing(&db_path).unwrap();
    let mut p = proposal();
    p["pages"][2]["layers"][0]["mediaId"] = json!(pic.id);
    let media = dir.join("media");
    let built = build(&p, true, &|id| library_picture(&mcp, &media, id), &mut counted(), 0).unwrap_or_else(|(e, _)| panic!("{e:?}"));
    let url = built.document["bindings"].as_object().unwrap().values().find(|b| b["kind"] == "picture").unwrap()["imageUrl"].as_str().unwrap().to_string();
    assert!(url.starts_with("asset://localhost/") && url.ends_with("choir.png"), "{url}");
    let saved = mcp.create_assistant_design(&DesignInput { title: built.title, kind: built.kind, document: built.document }, "Claude Desktop 1.2").unwrap();

    // The app sees it: a draft at revision 1, no version, by the assistant.
    let listed = app.list_designs(None, None, 50).unwrap();
    let row = listed.iter().find(|d| d.id == saved.id).unwrap();
    assert_eq!((row.revision, row.latest_version, row.title.as_str()), (1, None, "Harvest Thanksgiving announcement"));
    assert_eq!(app.get_design(&saved.id).unwrap().unwrap().document, saved.document);
    let audit = app.audit_events("design", &saved.id).unwrap();
    assert_eq!(audit.len(), 1);
    assert_eq!(audit[0].actor.as_deref(), Some("Claude Desktop 1.2 (AI assistant, MCP)"));
    let payload: Value = serde_json::from_str(audit[0].payload.as_deref().unwrap()).unwrap();
    assert_eq!((payload["source"].as_str(), payload["assistant"].as_str()), (Some("mcp"), Some("Claude Desktop 1.2")));
    // Nothing else changed: the other design, its version, the service.
    let after = app.get_design(&theirs.id).unwrap().unwrap();
    assert_eq!((after.revision, after.latest_version, after.document), (theirs.revision, Some(1), theirs.document));
    assert_eq!(app.get_program(&service.id).unwrap().unwrap().program.revision, service.revision);
    assert_eq!(app.list_design_versions(&saved.id).unwrap().len(), 0);

    // A picture whose file is gone cannot be used.
    std::fs::remove_file(dir.join("media/choir.png")).unwrap();
    assert!(library_picture(&mcp, &media, &pic.id).unwrap_err().contains("missing from the media folder"));
}

#[test]
fn the_writing_handle_never_creates_or_migrates_a_database() {
    let dir = temp("schema");
    assert!(ContentDb::open_existing(&dir.join("studio.db")).is_err(), "no file: refused, not created");
    assert!(!dir.join("studio.db").exists());
    let db_path = dir.join("studio.db");
    drop(ContentDb::open(&db_path).unwrap());
    rusqlite::Connection::open(&db_path).unwrap().execute("INSERT INTO schema_migrations (version) VALUES ('9999_from_the_future')", []).unwrap();
    let err = ContentDb::open_existing(&db_path).unwrap_err().to_string();
    assert!(err.to_lowercase().contains("newer"), "{err}");
}

/// The limits at their edges, built and kept as a second golden the render test opens with the
/// editor's adapter, so a Rust check looser than `designToScene` cannot slip in unseen.
fn edges() -> Value {
    let emoji = |n: usize| "🙏".repeat(n);
    json!({ "title": "Edges", "background": { "type": "gradient", "angle": -360, "stops": [{ "color": "#00000000", "offset": 0 }, { "color": "#ffffff80", "offset": 0 }, { "color": "#123456", "offset": 1 }] }, "pages": [
        { "title": emoji(40), "layers": [
            { "type": "text", "x": 0, "y": 0, "width": 1920, "height": 1080, "text": emoji(1000), "textSecond": emoji(1000), "fontFamily": "Noto Sans, Arial", "fontSize": 8, "lineHeight": 3 },
            { "type": "text", "x": 1919, "y": 1079, "width": 1, "height": 1, "text": "x", "textSecond": "y", "fontSize": 400, "lineHeight": 0.5, "fontWeight": "900", "fontStyle": "italic", "textAlign": "right", "underline": true },
            { "type": "ellipse", "x": 0, "y": 0, "width": 1, "height": 1, "opacity": 0, "fill": { "type": "gradient", "angle": -45.5, "stops": [{ "color": "#ff0000", "offset": 0 }, { "color": "#00ff00", "offset": 1 }] } }
        ] }
    ] })
}

#[test]
fn the_limits_at_their_edges_build_the_edges_golden_and_one_past_them_is_refused() {
    let built = try_build(&edges(), true).unwrap_or_else(|(e, _)| panic!("{e:?}"));
    let golden = fixture("mcp-design-draft-edges.json");
    let text = serde_json::to_string_pretty(&built.document).unwrap() + "\n";
    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        std::fs::write(&golden, &text).unwrap();
    }
    assert_eq!(std::fs::read_to_string(&golden).unwrap(), text);
    // One past each, as the editor's adapter counts (UTF-16 units), and a font name it refuses.
    let mut p = edges();
    p["pages"][0]["title"] = json!("🙏".repeat(41));
    p["pages"][0]["layers"][0]["text"] = json!("🙏".repeat(1001));
    p["pages"][0]["layers"][1]["fontFamily"] = json!("Noto देवनागरी");
    let e = errors(&p);
    assert!(has(&e, "pages[0].title", "80 characters"), "{e:?}");
    assert!(has(&e, "pages[0].layers[0].text", "2000 characters"), "{e:?}");
    assert!(has(&e, "pages[0].layers[1].fontFamily", "font family"), "{e:?}");
}

#[test]
fn only_a_present_library_picture_can_be_used() {
    let dir = temp("kinds");
    let db = ContentDb::open(&dir.join("studio.db")).unwrap();
    let media = |kind: &str, file: &str| MediaInput { kind: kind.into(), name: file.into(), file: file.into(), hash: "b".repeat(64), size: 1, mime: "video/mp4".into(), width: None, height: None, duration_ms: None, source: "local".into(), source_ref: String::new(), original_path: String::new() };
    std::fs::write(dir.join("media/loop.mp4"), b"v").unwrap();
    let video = db.register_media(&media("video", "loop.mp4")).unwrap();
    assert!(library_picture(&db, &dir.join("media"), &video.id).unwrap_err().contains("not a picture"));
    assert!(library_picture(&db, &dir.join("media"), "nope").unwrap_err().contains("not a picture in the church's media library"));

    #[cfg(unix)]
    {
        let outside = dir.join("outside.png");
        std::fs::write(&outside, b"private file").unwrap();
        std::os::unix::fs::symlink(&outside, dir.join("media/escape.png")).unwrap();
        let escaped = db.register_media(&MediaInput {
            kind: "image".into(), name: "Escaping image".into(), file: "escape.png".into(),
            hash: "c".repeat(64), size: 12, mime: "image/png".into(), width: None, height: None,
            duration_ms: None, source: "local".into(), source_ref: String::new(), original_path: String::new(),
        }).unwrap();
        assert!(library_picture(&db, &dir.join("media"), &escaped.id).unwrap_err().contains("missing from the media folder"));
    }
}

#[test]
fn an_assistant_revises_only_its_own_untouched_unversioned_draft_at_the_revision_it_read() {
    let dir = temp("revise");
    let db = ContentDb::open(&dir.join("studio.db")).unwrap();
    let doc = || try_build(&proposal(), false).unwrap().document;
    let input = |title: &str| DesignInput { title: title.into(), kind: "design".into(), document: doc() };
    let refused = |r: rhema_content::Result<rhema_content::DesignDocument>| match r {
        Err(rhema_content::ContentError::Refused { code, .. }) => code,
        other => panic!("expected a refusal, got {other:?}"),
    };

    // Its own draft: revised at the revision it read, recorded as the assistant's.
    let draft = db.create_assistant_design(&input("First idea"), "Claude").unwrap();
    assert!(db.assistant_may_revise_design(&draft.id).unwrap());
    let revised = db.revise_assistant_design(&draft.id, 1, &input("Second idea"), "Claude").unwrap();
    assert_eq!((revised.revision, revised.title.as_str(), revised.latest_version), (2, "Second idea", None));
    // An old revision is a conflict, never an overwrite.
    assert!(matches!(db.revise_assistant_design(&draft.id, 1, &input("Late"), "Claude"), Err(rhema_content::ContentError::Conflict { expected: 1, actual: 2 })));

    // A person saves it: it is theirs now.
    db.save_design_draft(&draft.id, 2, &input("Ada's edit")).unwrap();
    assert!(!db.assistant_may_revise_design(&draft.id).unwrap());
    assert_eq!(refused(db.revise_assistant_design(&draft.id, 3, &input("Again"), "Claude")), "not_assistant_draft");
    assert_eq!(db.get_design(&draft.id).unwrap().unwrap().title, "Ada's edit");

    // A version made: refused. A design made in the app: refused.
    let versioned = db.create_assistant_design(&input("Versioned"), "Claude").unwrap();
    db.create_design_version(&versioned.id, 1, None, "Ada").unwrap();
    assert_eq!(refused(db.revise_assistant_design(&versioned.id, 1, &input("x"), "Claude")), "not_assistant_draft");
    let theirs = db.create_design(&input("Sunday look")).unwrap();
    assert!(!db.assistant_may_revise_design(&theirs.id).unwrap());
    assert_eq!(refused(db.revise_assistant_design(&theirs.id, 1, &input("x"), "Claude")), "not_assistant_draft");
}
