//! Scenes changed from a joined desk (#243 SC.16, SC.17). The host's server checks each change
//! against the scenes in the host's Live State before the app sees it:
//!
//! - a change made from an older copy of the scene is refused (409 "stale") by the same revision
//!   check as every other command (`scene:<id>` in the Live State's `revisions`, `crate::http`), so
//!   two desks never overwrite each other without seeing it; deleting a scene that is gone is too;
//! - a camera desk may change only the camera boxes of an existing scene;
//! - the approval rule (the default until the owner chooses another): a new scene, or a change to a
//!   scene that is on no screen, goes in at once; a change to (or deleting) a scene that is on a
//!   screen, and any scene change while Approvals is on (Team → Approvals), waits for the main desk to
//!   accept it. In rehearsal nothing a desk changes is on air, so only a scene on a real screen
//!   waits.
//!
//! The app checks again when the change arrives and never lets a waiting change in by itself.

use serde::Deserialize;

use crate::command::RemoteCommand;
use crate::keys::Role;

/// The largest scene a desk may send (its definition; pictures and videos stay on the host).
pub const MAX_SCENE_BYTES: usize = 64 * 1024;
/// The most layers a scene sent from a desk may have.
pub const MAX_LAYERS: usize = 40;

/// Why a scene change was refused: the HTTP status, a short code the desk acts on, and the words.
#[derive(Debug, PartialEq, Eq)]
pub struct Refusal {
    pub status: u16,
    pub code: &'static str,
    pub message: String,
}

/// What happens to an accepted scene change.
#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    /// Saved at once.
    Direct,
    /// Sent to the main desk to accept; the words say why.
    Request(&'static str),
}

#[derive(Deserialize, Default)]
struct HostScenes {
    #[serde(default)]
    scenes: Vec<serde_json::Value>,
    #[serde(default)]
    program: Option<Program>,
    #[serde(default, rename = "requireApproval")]
    require_approval: bool,
    /// The church's named cameras and the router address each plays (null while the router is off).
    #[serde(default, rename = "cameraFeeds")]
    camera_feeds: Vec<CameraFeed>,
}

#[derive(Deserialize)]
struct CameraFeed {
    #[serde(default)]
    url: Option<String>,
}

/// The fields a desk may send for a scene and for each of its layers; anything else is dropped
/// (`strip`). Pictures, videos and held copies are not among them: they stay on the host.
const SCENE_FIELDS: &[&str] = &["id", "name", "background", "layers", "fadeMs"];
const LAYER_FIELDS: &[&str] = &["id", "name", "kind", "shows", "cameraUrl", "cameraFallback", "noSignal", "noSignalName", "clockShows", "until", "countdownTo", "themeId", "color", "mediaId", "mediaFile", "language", "fadeMs", "box", "crop", "opacity", "visible"];
const KINDS: &[&str] = &["feed", "color", "picture", "video", "camera", "clock", "ticker", "lowerThird", "logo"];
/// What a camera's box may show while the camera is not sending.
const NO_SIGNALS: &[&str] = &["bars", "static", "words", "none"];

/// Drop every field of a desk's scene, and of its layers, that a desk may not send.
pub fn strip(scene: &mut serde_json::Value) {
    let Some(o) = scene.as_object_mut() else { return };
    o.retain(|k, _| SCENE_FIELDS.contains(&k.as_str()));
    for layer in o.get_mut("layers").and_then(serde_json::Value::as_array_mut).into_iter().flatten() {
        if let Some(l) = layer.as_object_mut() {
            l.retain(|k, _| LAYER_FIELDS.contains(&k.as_str()));
        }
    }
}

/// A colour as #rrggbb.
fn hex(v: &str) -> bool {
    v.len() == 7 && v.starts_with('#') && v[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// The longest each word field may be.
fn longest(field: &str) -> usize {
    match field {
        "id" | "themeId" | "mediaId" => 100,
        "name" => 80,
        "cameraUrl" => 300,
        _ => 120,
    }
}

/// Why a desk's scene is not one the host can use: a background that is not transparent or one
/// #rrggbb colour, an unknown layer kind, a colour that is not #rrggbb, a word field too long or not
/// words, a box or crop that is not numbers, or a camera that is not one of the church's named
/// cameras (nor the one that layer already had). None when it is fine.
fn unsafe_scene(scene: &serde_json::Value, current: Option<&serde_json::Value>, cameras: &[&str]) -> Option<String> {
    let bg = scene.get("background").map_or(Some("#000000"), serde_json::Value::as_str);
    if !bg.is_some_and(|b| b == "transparent" || hex(b)) {
        return Some("A scene's background is transparent or one colour (#rrggbb)".into());
    }
    if scene.get("name").is_some_and(|n| n.as_str().is_none_or(|n| n.chars().count() > 80)) {
        return Some("A scene's name is at most 80 characters".into());
    }
    let had = |id: &str| current.and_then(|c| c["layers"].as_array()).and_then(|ls| ls.iter().find(|l| l["id"].as_str() == Some(id)));
    for l in scene.get("layers").and_then(serde_json::Value::as_array).into_iter().flatten() {
        let Some(o) = l.as_object() else { return Some("A layer is not a layer".into()) };
        if !o.get("kind").and_then(serde_json::Value::as_str).is_some_and(|k| KINDS.contains(&k)) {
            return Some("A layer of a kind this host does not know".into());
        }
        for (k, v) in o {
            match (k.as_str(), v) {
                ("box" | "crop", serde_json::Value::Object(b)) if b.values().all(serde_json::Value::is_number) => {}
                ("box" | "crop", _) => return Some(format!("A layer's {k} is numbers only")),
                ("opacity" | "fadeMs", v) if !v.is_number() => return Some(format!("A layer's {k} is a number")),
                ("visible", v) if !v.is_boolean() => return Some("A layer's visible is true or false".into()),
                ("noSignalName", v) if !v.is_boolean() => return Some("A layer's noSignalName is true or false".into()),
                ("noSignal", v) if !v.as_str().is_some_and(|m| NO_SIGNALS.contains(&m)) => return Some("A camera without a signal shows bars, static, words or none".into()),
                ("shows", serde_json::Value::Array(a)) if a.len() <= 10 && a.iter().all(|x| x.as_str().is_some_and(|x| x.len() <= 20)) => {}
                ("shows", _) => return Some("A layer follows at most 10 sources".into()),
                ("color", v) if !v.as_str().is_some_and(hex) => return Some("A colour is #rrggbb".into()),
                ("opacity" | "fadeMs" | "visible" | "color" | "noSignal" | "noSignalName", _) => {}
                (field, serde_json::Value::String(t)) if t.chars().count() > longest(field) => return Some(format!("A layer's {field} is at most {} characters", longest(field))),
                (_, serde_json::Value::String(_)) => {}
                (field, _) => return Some(format!("A layer's {field} is words")),
            }
        }
        if let Some(url) = o.get("cameraUrl").and_then(serde_json::Value::as_str) {
            let kept = o.get("id").and_then(serde_json::Value::as_str).and_then(had).is_some_and(|h| h["cameraUrl"].as_str() == Some(url));
            if !kept && !cameras.contains(&url) {
                return Some("That camera is not one of the church's cameras (Production → Cameras on the host)".into());
            }
        }
    }
    None
}

#[derive(Deserialize, Default)]
struct Program {
    #[serde(default)]
    rehearsal: bool,
}

fn refuse(status: u16, code: &'static str, message: impl Into<String>) -> Refusal {
    Refusal { status, code, message: message.into() }
}

/// Whether the rehearsal-proof "on a real screen" flag the host published is set.
fn on_screen(scene: &serde_json::Value) -> bool {
    scene.get("onScreen").and_then(serde_json::Value::as_bool) == Some(true)
}

/// The parts of a scene a camera desk may not change: its name, background, fade and every layer
/// that is not a camera, in order.
fn not_cameras(scene: &serde_json::Value) -> (Option<&serde_json::Value>, Option<&serde_json::Value>, Option<&serde_json::Value>, Vec<&serde_json::Value>) {
    let layers = scene.get("layers").and_then(serde_json::Value::as_array).map(|l| l.iter().filter(|x| x.get("kind").and_then(serde_json::Value::as_str) != Some("camera")).collect()).unwrap_or_default();
    (scene.get("name"), scene.get("background"), scene.get("fadeMs"), layers)
}

/// Check a scene command from a desk with `role` against the host's Live State (`live`). Not a
/// scene command: `Ok(None)`.
pub fn judge(live: Option<&str>, role: Role, cmd: &RemoteCommand) -> Result<Option<Verdict>, Refusal> {
    let (id, sent) = match cmd {
        RemoteCommand::SaveScene(s) => (s.id().to_string(), Some(&s.scene)),
        RemoteCommand::DeleteScene(d) => (d.id.clone(), None),
        _ => return Ok(None),
    };
    if let Some(scene) = sent {
        if !scene.is_object() || id.is_empty() || id.len() > 100 {
            return Err(refuse(400, "bad-scene", "That is not a scene this host can save"));
        }
        if scene.get("layers").and_then(serde_json::Value::as_array).is_some_and(|l| l.len() > MAX_LAYERS) {
            return Err(refuse(413, "bad-scene", format!("A scene can have at most {MAX_LAYERS} layers")));
        }
        if scene.to_string().len() > MAX_SCENE_BYTES {
            return Err(refuse(413, "bad-scene", "That scene is too big to send. Pictures and videos stay on the host: add them there"));
        }
    }
    let Some(host) = live.and_then(|j| serde_json::from_str::<HostScenes>(j).ok()) else {
        return Err(refuse(503, "no-live-state", "The host has not shared its scenes yet; try again in a moment"));
    };
    let current = host.scenes.iter().find(|s| s.get("id").and_then(serde_json::Value::as_str) == Some(id.as_str()));
    if let Some(scene) = sent {
        let cameras: Vec<&str> = host.camera_feeds.iter().filter_map(|c| c.url.as_deref()).collect();
        if let Some(why) = unsafe_scene(scene, current, &cameras) {
            return Err(refuse(400, "bad-scene", why));
        }
    }
    match (current, sent) {
        // Deleting a scene that is no longer there: someone deleted it first.
        (None, None) => return Err(refuse(409, "stale", "That scene is no longer on the host")),
        (None, Some(_)) if role == Role::Camera => return Err(refuse(403, "role", "A camera desk changes the cameras in scenes; it cannot make new scenes")),
        (Some(c), Some(s)) if role == Role::Camera && not_cameras(s) != not_cameras(c) => return Err(refuse(403, "role", "A camera desk may change only the camera boxes in a scene")),
        _ => {}
    }
    let rehearsal = host.program.is_some_and(|p| p.rehearsal);
    if host.require_approval && !rehearsal {
        return Ok(Some(Verdict::Request("Approvals is on at the main desk (Team → Approvals)")));
    }
    if current.is_some_and(on_screen) {
        return Ok(Some(Verdict::Request("that scene is on a screen")));
    }
    Ok(Some(Verdict::Direct))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::{SceneDelete, SceneSave};

    const LIVE: &str = r##"{"v":1,"cameraFeeds":[{"name":"choir","label":"Choir","url":"http://192.168.1.10:8889/choir/whep"}],"program":{"onAir":true,"rehearsal":false},"scenes":[
        {"id":"off","name":"Welcome","onScreen":false,"background":"#000000","layers":[{"id":"a","kind":"feed","box":{"x":0,"y":0,"w":100,"h":100}}]},
        {"id":"on","name":"Sermon","onScreen":true,"background":"#000000","layers":[{"id":"c","kind":"camera","box":{"x":0,"y":0,"w":50,"h":50}},{"id":"b","kind":"feed","shows":["bible"],"box":{"x":50,"y":0,"w":50,"h":50}}]}
    ]}"##;

    fn save(scene: serde_json::Value) -> RemoteCommand {
        RemoteCommand::SaveScene(SceneSave { scene, request: false })
    }

    fn delete(id: &str) -> RemoteCommand {
        RemoteCommand::DeleteScene(SceneDelete { id: id.into(), request: false })
    }

    fn scene_in(live: &str, id: &str) -> serde_json::Value {
        let v: serde_json::Value = serde_json::from_str(live).unwrap();
        v["scenes"].as_array().unwrap().iter().find(|s| s["id"] == id).unwrap().clone()
    }

    #[test]
    fn a_new_scene_or_one_off_screen_goes_in_and_one_on_a_screen_waits() {
        let new = save(serde_json::json!({ "id": "n1", "name": "New", "layers": [] }));
        assert_eq!(judge(Some(LIVE), Role::Screens, &new), Ok(Some(Verdict::Direct)));
        let mut off = scene_in(LIVE, "off");
        off["name"] = "Welcome again".into();
        assert_eq!(judge(Some(LIVE), Role::Screens, &save(off)), Ok(Some(Verdict::Direct)));
        let mut on = scene_in(LIVE, "on");
        on["background"] = "#101820".into();
        assert_eq!(judge(Some(LIVE), Role::Screens, &save(on)), Ok(Some(Verdict::Request("that scene is on a screen"))));
        let del_on = delete("on");
        assert!(matches!(judge(Some(LIVE), Role::Configure, &del_on), Ok(Some(Verdict::Request(_)))), "deleting a scene on a screen waits");
        let del_off = delete("off");
        assert_eq!(judge(Some(LIVE), Role::Configure, &del_off), Ok(Some(Verdict::Direct)));
        assert_eq!(judge(Some(LIVE), Role::Screens, &RemoteCommand::Next), Ok(None), "not a scene command");
    }

    #[test]
    fn with_approvals_on_every_change_waits_but_not_in_rehearsal() {
        let approvals = LIVE.replacen(r#""v":1,"#, r#""v":1,"requireApproval":true,"#, 1);
        let new = save(serde_json::json!({ "id": "n1", "layers": [] }));
        assert_eq!(judge(Some(&approvals), Role::Screens, &new), Ok(Some(Verdict::Request("Approvals is on at the main desk (Team → Approvals)"))));
        let rehearsing = approvals.replace(r#""rehearsal":false"#, r#""rehearsal":true"#);
        assert_eq!(judge(Some(&rehearsing), Role::Screens, &new), Ok(Some(Verdict::Direct)), "rehearsal changes nothing on air");
        let on = scene_in(LIVE, "on");
        assert!(matches!(judge(Some(&rehearsing), Role::Screens, &save(on)), Ok(Some(Verdict::Request(_)))), "a scene on a real screen waits even in rehearsal");
    }

    #[test]
    fn deleting_a_scene_that_is_gone_is_refused_as_stale_and_no_live_state_waits() {
        let r = judge(Some(LIVE), Role::Screens, &delete("deleted")).unwrap_err();
        assert_eq!((r.status, r.code), (409, "stale"));
        assert_eq!(judge(None, Role::Screens, &save(scene_in(LIVE, "off"))).unwrap_err().status, 503, "no Live State yet");
    }

    #[test]
    fn a_camera_desk_changes_only_camera_boxes() {
        let mut moved = scene_in(LIVE, "on");
        moved["layers"][0]["box"]["w"] = 40.into();
        moved["layers"][0]["cameraUrl"] = "http://192.168.1.10:8889/choir/whep".into();
        assert!(matches!(judge(Some(LIVE), Role::Camera, &save(moved.clone())), Ok(Some(Verdict::Request(_)))), "still waits: it is on a screen");
        let mut bible = moved.clone();
        bible["layers"][1]["box"]["w"] = 30.into();
        let r = judge(Some(LIVE), Role::Camera, &save(bible)).unwrap_err();
        assert_eq!((r.status, r.code), (403, "role"));
        let mut renamed = moved;
        renamed["name"] = "Mine".into();
        assert_eq!(judge(Some(LIVE), Role::Camera, &save(renamed)).unwrap_err().status, 403);
        let new = save(serde_json::json!({ "id": "n1", "layers": [] }));
        assert_eq!(judge(Some(LIVE), Role::Camera, &new).unwrap_err().status, 403, "no new scenes");
        let mut cam_off = scene_in(LIVE, "off");
        cam_off["layers"].as_array_mut().unwrap().push(serde_json::json!({ "id": "c2", "kind": "camera", "box": { "x": 70, "y": 4, "w": 26, "h": 26 } }));
        assert_eq!(judge(Some(LIVE), Role::Camera, &save(cam_off)), Ok(Some(Verdict::Direct)), "adding a camera box is a camera change");
    }

    #[test]
    fn a_scene_that_is_too_big_or_not_a_scene_is_refused() {
        let layers: Vec<_> = (0..=MAX_LAYERS).map(|i| serde_json::json!({ "id": i.to_string(), "kind": "color" })).collect();
        assert_eq!(judge(Some(LIVE), Role::Screens, &save(serde_json::json!({ "id": "n", "layers": layers }))).unwrap_err().status, 413);
        let huge = save(serde_json::json!({ "id": "n", "layers": [{ "id": "p", "kind": "picture", "imageUrl": "x".repeat(MAX_SCENE_BYTES) }] }));
        assert_eq!(judge(Some(LIVE), Role::Screens, &huge).unwrap_err().status, 413);
        for bad in [serde_json::json!("scene"), serde_json::json!({ "name": "no id" }), serde_json::json!({ "id": "" })] {
            assert_eq!(judge(Some(LIVE), Role::Screens, &save(bad)).unwrap_err().status, 400);
        }
    }

    #[test]
    fn a_desks_scene_is_refused_when_it_is_not_safe_and_unknown_fields_are_dropped() {
        let live = LIVE.to_string();
        let refused = |scene: serde_json::Value| judge(Some(&live), Role::Screens, &save(scene)).map_err(|r| (r.status, r.code));
        for background in ["url(http://x)", "red;background:url(http://x/a.png)", "#fff", "rgb(0,0,0)"] {
            assert_eq!(refused(serde_json::json!({ "id": "n", "background": background, "layers": [] })), Err((400, "bad-scene")), "{background}");
        }
        assert!(refused(serde_json::json!({ "id": "n", "background": "transparent", "layers": [] })).is_ok());
        let layer = |over: serde_json::Value| {
            let mut l = serde_json::json!({ "id": "l", "name": "Box", "kind": "feed", "box": { "x": 0, "y": 0, "w": 100, "h": 100 }, "opacity": 1, "visible": true });
            l.as_object_mut().unwrap().extend(over.as_object().unwrap().clone());
            serde_json::json!({ "id": "n", "background": "#000000", "layers": [l] })
        };
        for bad in [
            serde_json::json!({ "kind": "script" }),
            serde_json::json!({ "name": "y".repeat(1000) }),
            serde_json::json!({ "cameraFallback": "z".repeat(500) }),
            serde_json::json!({ "box": { "x": "0; drop" } }),
            serde_json::json!({ "color": "red;x" }),
            serde_json::json!({ "kind": "camera", "cameraUrl": "http://evil.example/whep" }),
            serde_json::json!({ "name": { "nested": true } }),
            serde_json::json!({ "kind": "camera", "noSignal": "snow" }),
            serde_json::json!({ "kind": "camera", "noSignal": true }),
            serde_json::json!({ "kind": "camera", "noSignalName": "yes" }),
        ] {
            assert_eq!(refused(layer(bad.clone())), Err((400, "bad-scene")), "{bad}");
        }
        assert!(refused(layer(serde_json::json!({ "kind": "camera", "cameraUrl": "http://192.168.1.10:8889/choir/whep" }))).is_ok(), "a named camera");
        for mode in NO_SIGNALS {
            assert!(refused(layer(serde_json::json!({ "kind": "camera", "noSignal": mode, "noSignalName": true }))).is_ok(), "{mode}");
        }
        let mut bars = layer(serde_json::json!({ "kind": "camera", "noSignal": "static", "noSignalName": false }));
        strip(&mut bars);
        assert_eq!((bars["layers"][0]["noSignal"].as_str(), bars["layers"][0]["noSignalName"].as_bool()), (Some("static"), Some(false)), "kept by strip");
        let mut extra = layer(serde_json::json!({ "onclick": "alert(1)", "imageUrl": "data:text/html,x", "held": { "reference": "fake" } }));
        extra["evil"] = "x".into();
        strip(&mut extra);
        assert_eq!(extra.as_object().unwrap().keys().collect::<Vec<_>>(), ["background", "id", "layers"]);
        let l = extra["layers"][0].as_object().unwrap();
        assert!(!l.contains_key("onclick") && !l.contains_key("imageUrl") && !l.contains_key("held"), "{l:?}");
    }
}
