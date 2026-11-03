//! End to end (#443 C5 slice 1): the real `Rhema --mcp` server over stdio, against a data folder
//! the app made, makes an editable design draft and nothing else.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use rhema_content::{ContentDb, DesignInput, MediaInput};
use serde_json::{json, Value};

struct Mcp {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    id: i64,
}

impl Mcp {
    fn start(dir: &Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_Rhema")).args(["--mcp", "--data"]).arg(dir).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Self { child, stdin, stdout, id: 0 }
    }

    fn line(&mut self, line: &str) -> Value {
        writeln!(self.stdin, "{line}").unwrap();
        self.stdin.flush().unwrap();
        let mut out = String::new();
        self.stdout.read_line(&mut out).unwrap();
        serde_json::from_str(&out).unwrap()
    }

    fn rpc(&mut self, method: &str, params: Value) -> Value {
        self.id += 1;
        self.line(&json!({ "jsonrpc": "2.0", "id": self.id, "method": method, "params": params }).to_string())
    }

    fn tool(&mut self, name: &str, arguments: Value) -> Value {
        self.rpc("tools/call", json!({ "name": name, "arguments": arguments }))["result"].clone()
    }
}

impl Drop for Mcp {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn settings(dir: &Path, on: bool) {
    let s = json!({ "settingsLayout": 2, "machine": { "mcpEnabled": on, "setup": { "serviceLanguages": "Yorùbá and English" } }, "church": { "brandKit": { "churchName": "Grace Chapel" } } });
    std::fs::write(dir.join("settings.json"), s.to_string()).unwrap();
}

fn proposal(media_id: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("crates/content/tests/fixtures/mcp-design-proposal.json");
    let mut p: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    p["pages"][2]["layers"][0]["mediaId"] = json!(media_id);
    p
}

fn temp() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("rhema-mcp-e2e-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("media")).unwrap();
    dir
}

#[test]
fn an_opted_in_assistant_makes_an_editable_design_draft_and_nothing_else() {
    let dir = temp();
    let db = dir.join("studio.db");
    // What the church already has: a design with a version a service may use, a service, a picture.
    let app = ContentDb::open(&db).unwrap();
    let theirs = app.create_design(&DesignInput { title: "Sunday look".into(), kind: "design".into(), document: json!({ "scene": { "version": 1, "root": "root", "artboard": { "width": 1920, "height": 1080 }, "nodes": { "root": { "type": "group", "children": [] } } }, "bindings": {} }) }).unwrap();
    app.create_design_version(&theirs.id, theirs.revision, None, "Ada").unwrap();
    let service = app.create_program("Sunday", None).unwrap();
    std::fs::write(dir.join("media/choir.png"), b"png").unwrap();
    let pic = app
        .register_media(&MediaInput { kind: "image".into(), name: "Choir".into(), file: "choir.png".into(), hash: "a".repeat(64), size: 3, mime: "image/png".into(), width: Some(1600), height: Some(900), duration_ms: None, source: "local".into(), source_ref: String::new(), original_path: String::new() })
        .unwrap();
    let designs_before = app.list_designs(None, None, 100).unwrap().len();
    settings(&dir, false);

    let mut mcp = Mcp::start(&dir);
    let init = mcp.rpc("initialize", json!({ "protocolVersion": "2025-06-18", "clientInfo": { "name": "E2E Assistant", "version": "9.1" } }));
    assert_eq!(init["result"]["serverInfo"]["name"], "rhema-studio");
    let names: Vec<String> = mcp.rpc("tools/list", json!({}))["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect();
    for n in ["rhema_get_design_capabilities", "rhema_list_designs", "rhema_validate_design_draft", "rhema_create_design_draft"] {
        assert!(names.iter().any(|x| x == n), "{n} listed");
    }

    // Access off: refused, nothing saved.
    let off = mcp.tool("rhema_create_design_draft", json!({ "design": proposal(&pic.id) }));
    assert_eq!(off["isError"], true);
    assert!(off["content"][0]["text"].as_str().unwrap().contains("access is off"));

    // Turned on in Settings: the very next call is answered.
    settings(&dir, true);
    let caps = mcp.tool("rhema_get_design_capabilities", json!({}));
    assert_eq!(caps["isError"], false);
    assert_eq!(caps["structuredContent"]["artboard"]["width"], 1920.0);

    // A malformed message, and a malicious or broken proposal: plain errors, nothing saved.
    assert_eq!(mcp.line("{not json")["error"]["code"], -32700);
    let mut bad = proposal(&pic.id);
    bad["pages"][0]["layers"][1]["text"] = json!("Give at \u{202E}moc.live\u{202C}");
    bad["pages"][1]["layers"].as_array_mut().unwrap().push(json!({ "type": "picture", "x": 0, "y": 0, "width": 10, "height": 10, "src": "https://example.com/a.png" }));
    bad["pages"][2]["layers"][0]["mediaId"] = json!("../../etc/passwd");
    bad["designRef"] = json!({ "id": theirs.id, "version": 1 });
    let checked = mcp.tool("rhema_validate_design_draft", json!({ "design": bad }));
    assert_eq!(checked["structuredContent"]["ok"], false);
    let at: Vec<&str> = checked["structuredContent"]["errors"].as_array().unwrap().iter().map(|e| e["at"].as_str().unwrap()).collect();
    for path in ["designRef", "pages[0].layers[1].text", "pages[1].layers[2].src", "pages[2].layers[0].mediaId"] {
        assert!(at.contains(&path), "{path} in {at:?}");
    }
    let refused = mcp.tool("rhema_create_design_draft", json!({ "design": bad }));
    assert_eq!(refused["isError"], true);
    assert_eq!(mcp.tool("rhema_create_design_draft", json!({ "design": "a poster" }))["isError"], true);
    assert_eq!(app.list_designs(None, None, 100).unwrap().len(), designs_before, "nothing saved");

    // A valid one: checked, then saved as a new draft the app's My Designs lists.
    let ok = mcp.tool("rhema_validate_design_draft", json!({ "design": proposal(&pic.id) }));
    assert_eq!((ok["structuredContent"]["ok"].as_bool(), ok["structuredContent"]["pages"].as_u64(), ok["structuredContent"]["layers"].as_u64()), (Some(true), Some(3), Some(6)));
    let made = mcp.tool("rhema_create_design_draft", json!({ "design": proposal(&pic.id) }));
    assert_eq!(made["isError"], false, "{made}");
    let id = made["structuredContent"]["designId"].as_str().unwrap().to_string();
    assert!(!made.to_string().contains(dir.to_str().unwrap()), "the picture's local address is never handed out");
    let listed = mcp.tool("rhema_list_designs", json!({ "query": "Harvest" }));
    assert_eq!(listed["structuredContent"]["designs"][0]["id"], id.as_str());
    assert_eq!(listed["structuredContent"]["designs"][0]["latestVersion"], Value::Null);

    // As the app reads it: a draft at revision 1, no version, by that assistant, editable pages.
    let draft = app.get_design(&id).unwrap().unwrap();
    assert_eq!((draft.revision, draft.latest_version, draft.kind.as_str()), (1, None, "design"));
    assert_eq!(draft.document["pages"].as_array().unwrap().len(), 3);
    let picture = draft.document["bindings"].as_object().unwrap().values().find(|b| b["kind"] == "picture").unwrap();
    assert_eq!(picture["mediaId"], pic.id.as_str());
    assert!(picture["imageUrl"].as_str().unwrap().starts_with("asset://localhost/") || picture["imageUrl"].as_str().unwrap().starts_with("http://asset.localhost/"));
    let audit = app.audit_events("design", &id).unwrap();
    assert_eq!(audit[0].actor.as_deref(), Some("E2E Assistant 9.1 (AI assistant, MCP)"));
    // Nothing else changed.
    let after = app.get_design(&theirs.id).unwrap().unwrap();
    assert_eq!((after.revision, after.latest_version), (theirs.revision, Some(1)));
    assert_eq!(app.get_program(&service.id).unwrap().unwrap().program.revision, service.revision);
    assert_eq!(app.list_design_versions(&id).unwrap().len(), 0);

    // A database a newer Rhema wrote: this server does not write to it.
    drop(app);
    let newer: Vec<rhema_content::Migration> = rhema_content::MIGRATIONS.iter().copied().chain([("9999_from_the_future", "SELECT 1;")]).collect();
    drop(ContentDb::open_with_migrations(&db, &newer).unwrap());
    let stale = mcp.tool("rhema_create_design_draft", json!({ "design": proposal(&pic.id) }));
    assert_eq!(stale["isError"], true);
    assert!(stale["content"][0]["text"].as_str().unwrap().to_lowercase().contains("newer"), "{stale}");
    let count = ContentDb::open_with_migrations(&db, &newer).unwrap().list_designs(None, None, 100).unwrap().len();
    assert_eq!(count, designs_before + 1);
}
