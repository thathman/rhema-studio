//! Phone cameras (OP-009, #209): a phone opens Rhema's camera page (`/camera`, over https because
//! a browser gives a page the camera only on a secure page) and publishes to the camera router
//! (the MediaMTX bundled with Rhema) with WHIP. The page cannot post to the router itself (plain
//! http from an https page, and the router wants Rhema's publish password), so its WHIP requests
//! come here and are passed on to the router on this computer. Only the signalling passes
//! through Rhema; the video flows straight from the phone to the router.
//!
//! Each camera publishes as its own router user (`cam-<name>`, its link's secret as the password),
//! allowed to send to its own name only; a new link or removing the camera closes that door.
//!
//! An OBS companion (a computer that runs OBS only, #209) reads every camera over SRT, encrypted,
//! as its own router user (`read-<8 characters of its key>`, a secret made afresh each time Rhema
//! starts), from the camera's companion name (`companion/<name>`), which nobody else may read.
//! Unpairing or pausing the companion removes that user and disconnects its OBS.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, PoisonError, RwLock};
use std::time::{Duration, Instant};

use axum::body::Bytes;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};

/// A WHIP offer or ICE patch is a few kilobytes; anything near this is not one.
const MAX_BODY: usize = 64 * 1024;

/// A camera's router user is this and its name (never `any`, which the router reads as "anyone").
pub const PUBLISH_PREFIX: &str = "cam-";

/// A companion's router user is this and the start of its key's hash (#209).
pub const READ_PREFIX: &str = "read-";

/// Where an OBS companion reads a camera: its own name for the companion (`companion/pulpit`), so
/// the router lets only companions in and asks for the encrypted link's passphrase.
pub const COMPANION_PATH: &str = "companion/";

/// A companion's tally older than this is not shown (its OBS or the companion went away).
const TALLY_FRESH: Duration = Duration::from_secs(15);

/// Where the router listens for WHIP, and the encrypted reading link companions use.
#[derive(Clone)]
pub struct RouterTarget {
    /// e.g. `http://127.0.0.1:8889`
    pub base: String,
    /// The router's SRT port (8890).
    pub srt_port: u16,
    /// The passphrase of companions' SRT link, made afresh each time the router starts.
    pub srt_passphrase: String,
}

// Never print the passphrase.
impl std::fmt::Debug for RouterTarget {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RouterTarget").field("base", &self.base).field("srt_port", &self.srt_port).finish_non_exhaustive()
    }
}

/// Who reads a camera now, as Production → Cameras names them (#209).
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Watcher {
    /// "companion" (an OBS companion computer), "obs" (OBS or another player, by RTSP), "screen"
    /// (a Rhema screen, desk or TV, by WebRTC) or "player" (anything else).
    pub kind: String,
    /// In words: "Media desk (OBS companion)", "Rhema screens on this computer", "A screen or TV at 192.168.1.40".
    pub name: String,
    /// Read over the network (not on this computer): it counts toward the network estimate.
    pub remote: bool,
}

/// What an OBS companion last said about one camera (its tally).
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ObsTally {
    /// The companion's name, as it paired.
    pub desk: String,
    /// On that OBS's program (what its stream and recording show), or in its preview (Studio Mode).
    pub program: bool,
    pub preview: bool,
    /// Added to that OBS, and OBS says it is playing.
    pub receiving: bool,
}

/// One camera as the router sees it, with who reads it (#209).
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CameraWatch {
    pub name: String,
    /// A camera is sending to it now.
    pub live: bool,
    /// How it sends (e.g. webRTCSession, rtmpConn, srtConn).
    pub source: Option<String>,
    /// Screens, TVs, OBS and companions reading it now.
    pub readers: usize,
    /// Its codecs (e.g. H264).
    pub tracks: Vec<String>,
    /// Its picture size, when the router knows it.
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// What it sends, measured between two looks (kilobits a second).
    pub kbps: Option<u32>,
    /// The same, in bytes a second (#213 signal truth).
    pub bytes_per_sec: Option<u64>,
    /// How long ago the router last received anything from it (ms): the bytes it counts grew then.
    /// None until a second look, or when the router does not count them.
    pub data_age_ms: Option<u64>,
    /// Connected but sending nothing: the router has it as live, yet nothing arrived for over 3 s.
    pub frozen: bool,
    pub watchers: Vec<Watcher>,
    /// What each OBS companion said about it.
    pub obs: Vec<ObsTally>,
}

/// One companion's report: the cameras on its OBS program and preview, and those OBS plays.
#[derive(Debug, Clone, Default, serde::Deserialize, PartialEq, Eq)]
pub struct Tally {
    #[serde(default)]
    pub program: Vec<String>,
    #[serde(default)]
    pub preview: Vec<String>,
    #[serde(default)]
    pub receiving: Vec<String>,
}

impl Tally {
    /// Only camera names, at most 64 of each.
    fn clean(mut self) -> Self {
        for list in [&mut self.program, &mut self.preview, &mut self.receiving] {
            list.retain(|n| valid_camera_name(n));
            list.truncate(64);
        }
        self
    }
}

/// A companion's sign-in at the router.
#[derive(Clone, PartialEq, Eq)]
struct Reader {
    name: String,
    user: String,
    pass: String,
}

/// A new reading secret: 64 hex characters from the system's random source.
fn new_read_secret() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

/// The cameras the operator added (name and the secret in its camera-page link) and the running
/// router, if any. The app keeps both in step; a removed camera's link stops working at once.
#[derive(Default)]
pub struct CameraHub {
    cameras: RwLock<HashMap<String, String>>,
    router: RwLock<Option<RouterTarget>>,
    /// Paired OBS companions' sign-ins, by key hash (#209).
    readers: RwLock<HashMap<String, Reader>>,
    /// The router's cameras as it last answered (the app looks every few seconds while it runs).
    watch: RwLock<Vec<CameraWatch>>,
    /// Each companion's last tally, by key hash, with its name and when it came.
    tallies: RwLock<HashMap<String, (String, Instant, Tally)>>,
    /// Paired desks by the address they follow the host from, to name who watches a camera.
    desks: RwLock<HashMap<IpAddr, String>>,
}

// Never print a camera's secret (HttpConfig is Debug).
impl std::fmt::Debug for CameraHub {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let n = self.cameras.read().unwrap_or_else(PoisonError::into_inner).len();
        let on = self.router.read().unwrap_or_else(PoisonError::into_inner).is_some();
        let readers = self.readers.read().unwrap_or_else(PoisonError::into_inner).len();
        f.debug_struct("CameraHub").field("cameras", &n).field("router", &on).field("readers", &readers).finish()
    }
}

pub type SharedCameras = Arc<CameraHub>;

#[must_use]
pub fn new_camera_hub() -> SharedCameras {
    Arc::new(CameraHub::default())
}

/// A camera's name as the router knows it (its path): lower-case letters, digits, `-` and `_`.
#[must_use]
pub fn valid_camera_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 40 && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_') && !name.starts_with(['-', '_'])
}

impl CameraHub {
    /// Replace the list of cameras (name, secret); bad names and short secrets are dropped.
    pub fn set(&self, list: &[(String, String)]) {
        let map = list.iter().filter(|(n, t)| valid_camera_name(n) && t.len() >= 16).cloned().collect();
        *self.cameras.write().unwrap_or_else(PoisonError::into_inner) = map;
    }

    /// The router started (Some) or stopped (None).
    pub fn set_router(&self, target: Option<RouterTarget>) {
        *self.router.write().unwrap_or_else(PoisonError::into_inner) = target;
    }

    /// The paired OBS companions now (key hash, name): each gets a router user, kept while it stays
    /// paired and unpaused, so its OBS addresses stay the same. Returns the users that went (unpaired,
    /// paused or no longer a companion), to disconnect.
    pub fn sync_readers(&self, companions: &[(String, String)]) -> Vec<String> {
        let mut readers = self.readers.write().unwrap_or_else(PoisonError::into_inner);
        let gone: Vec<String> = readers.iter().filter(|(hash, _)| !companions.iter().any(|(h, _)| h == *hash)).map(|(_, r)| r.user.clone()).collect();
        readers.retain(|hash, _| companions.iter().any(|(h, _)| h == hash));
        for (hash, name) in companions {
            if let Some(r) = readers.get_mut(hash) {
                r.name.clone_from(name);
                continue;
            }
            // `read-` and the first 8 characters of its key's hash; longer in the unlikely case two start the same.
            let taken: Vec<String> = readers.values().map(|r| r.user.clone()).collect();
            let user = (8..=hash.len().max(8)).map(|n| format!("{READ_PREFIX}{}", &hash[..n.min(hash.len())])).find(|u| !taken.contains(u)).unwrap_or_else(|| format!("{READ_PREFIX}{}", new_read_secret()));
            readers.insert(hash.clone(), Reader { name: name.clone(), user, pass: new_read_secret() });
        }
        let mut tallies = self.tallies.write().unwrap_or_else(PoisonError::into_inner);
        tallies.retain(|hash, _| readers.contains_key(hash));
        gone
    }

    /// The companions' router users (user, secret), for the router's settings.
    #[must_use]
    pub fn reader_list(&self) -> Vec<(String, String)> {
        let mut v: Vec<(String, String)> = self.readers.read().unwrap_or_else(PoisonError::into_inner).values().map(|r| (r.user.clone(), r.pass.clone())).collect();
        v.sort();
        v
    }

    /// The companion a router user belongs to, by name.
    #[must_use]
    pub fn reader_name(&self, user: &str) -> Option<String> {
        self.readers.read().unwrap_or_else(PoisonError::into_inner).values().find(|r| r.user == user).map(|r| r.name.clone())
    }

    /// The router's cameras as it last answered (the app's look every few seconds).
    pub fn set_watch(&self, list: Vec<CameraWatch>) {
        *self.watch.write().unwrap_or_else(PoisonError::into_inner) = list;
    }

    /// The router's cameras with each companion's tally (a tally older than 15 s is left out).
    #[must_use]
    pub fn watch(&self) -> Vec<CameraWatch> {
        let mut list = self.watch.read().unwrap_or_else(PoisonError::into_inner).clone();
        let tallies = self.tallies.read().unwrap_or_else(PoisonError::into_inner);
        let mut fresh: Vec<&(String, Instant, Tally)> = tallies.values().filter(|(_, at, _)| at.elapsed() < TALLY_FRESH).collect();
        fresh.sort_by(|a, b| a.0.cmp(&b.0));
        for cam in &mut list {
            cam.obs = fresh
                .iter()
                .filter_map(|(desk, _, t)| {
                    let has = |l: &[String]| l.iter().any(|n| n == &cam.name);
                    let o = ObsTally { desk: desk.clone(), program: has(&t.program), preview: has(&t.preview), receiving: has(&t.receiving) };
                    (o.program || o.preview || o.receiving).then_some(o)
                })
                .collect();
        }
        list
    }

    /// A companion's tally arrived (by its key hash); one that is not a paired companion is ignored.
    pub fn set_tally(&self, hash: &str, tally: Tally) -> bool {
        let Some(name) = self.readers.read().unwrap_or_else(PoisonError::into_inner).get(hash).map(|r| r.name.clone()) else { return false };
        self.tallies.write().unwrap_or_else(PoisonError::into_inner).insert(hash.to_string(), (name, Instant::now(), tally.clean()));
        true
    }

    /// A paired desk follows the host from this address (to name it among a camera's watchers).
    pub fn saw_desk(&self, ip: IpAddr, name: &str) {
        let mut desks = self.desks.write().unwrap_or_else(PoisonError::into_inner);
        if desks.get(&ip).is_none_or(|n| n != name) {
            if desks.len() > 256 {
                desks.clear();
            }
            desks.insert(ip, name.to_string());
        }
    }

    /// The paired desk last seen at this address.
    #[must_use]
    pub fn desk_at(&self, ip: IpAddr) -> Option<String> {
        self.desks.read().unwrap_or_else(PoisonError::into_inner).get(&ip).cloned()
    }

    /// What an OBS companion is told (by its key hash): the cameras, and its own way to read them
    /// (the SRT port, its user and secret, the link's passphrase) while the router runs. Only the
    /// companion's own sign-in, never another's.
    #[must_use]
    pub fn companion_view(&self, hash: &str) -> serde_json::Value {
        let router = self.router();
        let reader = self.readers.read().unwrap_or_else(PoisonError::into_inner).get(hash).cloned();
        let watched = self.watch();
        let mut names: Vec<String> = self.cameras.read().unwrap_or_else(PoisonError::into_inner).keys().cloned().collect();
        names.sort();
        let cameras: Vec<CameraWatch> = names.into_iter().map(|name| watched.iter().find(|w| w.name == name).cloned().unwrap_or(CameraWatch { name, ..CameraWatch::default() })).collect();
        let srt = match (&router, &reader) {
            (Some(r), Some(me)) => serde_json::json!({ "port": r.srt_port, "passphrase": r.srt_passphrase, "user": me.user, "pass": me.pass, "path": COMPANION_PATH }),
            _ => serde_json::Value::Null,
        };
        serde_json::json!({ "router": router.is_some(), "srt": srt, "cameras": cameras })
    }

    #[must_use]
    pub fn list(&self) -> Vec<(String, String)> {
        let mut v: Vec<(String, String)> = self.cameras.read().unwrap_or_else(PoisonError::into_inner).iter().map(|(n, t)| (n.clone(), t.clone())).collect();
        v.sort();
        v
    }

    pub(crate) fn knows(&self, name: &str, token: &str) -> bool {
        self.cameras.read().unwrap_or_else(PoisonError::into_inner).get(name).is_some_and(|t| crate::command::same_key(token, t))
    }

    fn router(&self) -> Option<RouterTarget> {
        self.router.read().unwrap_or_else(PoisonError::into_inner).clone()
    }

    /// Pass one WHIP request (POST the offer; PATCH ICE; DELETE to hang up) to the router, signed
    /// in as that camera, and hand back its answer. The session address in `Location` is rewritten to
    /// this route so the page's next request comes here too.
    pub(crate) async fn forward(&self, method: Method, name: &str, session: Option<&str>, headers: &HeaderMap, body: Bytes) -> Response {
        let Some(token) = self.cameras.read().unwrap_or_else(PoisonError::into_inner).get(name).cloned() else {
            return StatusCode::FORBIDDEN.into_response();
        };
        let Some(router) = self.router() else {
            return (StatusCode::SERVICE_UNAVAILABLE, "The camera router is off. Turn it on in Rhema: Production, Cameras.").into_response();
        };
        if body.len() > MAX_BODY {
            return StatusCode::PAYLOAD_TOO_LARGE.into_response();
        }
        if session.is_some_and(|s| s.is_empty() || s.len() > 128 || !s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')) {
            return StatusCode::NOT_FOUND.into_response();
        }
        let url = match session {
            Some(s) => format!("{}/{name}/whip/{s}", router.base),
            None => format!("{}/{name}/whip", router.base),
        };
        let Ok(client) = reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(3)).timeout(std::time::Duration::from_secs(15)).build() else {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        };
        let Ok(m) = reqwest::Method::from_bytes(method.as_str().as_bytes()) else {
            return StatusCode::METHOD_NOT_ALLOWED.into_response();
        };
        let mut req = client.request(m, url).basic_auth(format!("{PUBLISH_PREFIX}{name}"), Some(&token)).body(body.to_vec());
        for h in ["content-type", "if-match"] {
            if let Some(v) = headers.get(h).and_then(|v| v.to_str().ok()) {
                req = req.header(h, v);
            }
        }
        let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                log::warn!("camera {name}: the router did not answer: {e}");
                return (StatusCode::BAD_GATEWAY, "The camera router did not answer. Is it running?").into_response();
            }
        };
        let status = resp.status().as_u16();
        // The router refused the camera's sign-in (it may still be taking in a new link): say so
        // plainly, and never ask the phone to sign in itself.
        if status == 401 || status == 403 {
            log::warn!("camera {name}: the router refused its sign-in");
            return (StatusCode::BAD_GATEWAY, "The camera router refused this camera. Try again in a moment; if it keeps happening, turn the router off and on in Rhema.").into_response();
        }
        let mut out = HeaderMap::new();
        for h in ["content-type", "etag", "accept-patch"] {
            if let Some(v) = resp.headers().get(h).and_then(|v| HeaderValue::from_bytes(v.as_bytes()).ok()) {
                out.insert(h, v);
            }
        }
        if let Some(loc) = resp.headers().get("location").and_then(|v| v.to_str().ok()).and_then(|l| rewrite_location(name, l)) {
            if let Ok(v) = HeaderValue::from_str(&loc) {
                out.insert("location", v);
            }
        }
        let code = StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY);
        let bytes = resp.bytes().await.unwrap_or_default();
        (code, out, bytes).into_response()
    }
}

/// The router's session address (`/pulpit/whip/<id>`, or a full URL ending so) as this route.
fn rewrite_location(name: &str, location: &str) -> Option<String> {
    let path = location.split_once("://").map_or(location, |(_, rest)| rest.find('/').map_or("", |i| &rest[i..]));
    let id = path.strip_prefix(&format!("/{name}/whip/"))?;
    let id = id.split(['?', '#']).next().unwrap_or("");
    (!id.is_empty()).then(|| format!("/api/v1/camera/{name}/whip/{id}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn camera_names_are_router_paths() {
        for ok in ["pulpit", "choir-2", "wide_left", "a", "1"] {
            assert!(valid_camera_name(ok), "{ok}");
        }
        for no in ["", "Pulpit", "pul pit", "../x", "-x", "a/b", "x?y", &"a".repeat(41)] {
            assert!(!valid_camera_name(no), "{no}");
        }
    }

    #[test]
    fn the_session_address_points_back_through_rhema() {
        assert_eq!(rewrite_location("pulpit", "/pulpit/whip/0f3c-aa").as_deref(), Some("/api/v1/camera/pulpit/whip/0f3c-aa"));
        assert_eq!(rewrite_location("pulpit", "http://127.0.0.1:8889/pulpit/whip/abc?x=1").as_deref(), Some("/api/v1/camera/pulpit/whip/abc"));
        assert_eq!(rewrite_location("pulpit", "/choir/whip/abc"), None, "another camera's session");
        assert_eq!(rewrite_location("pulpit", "/pulpit/whip/"), None);
    }

    fn target() -> RouterTarget {
        RouterTarget { base: "http://127.0.0.1:8889".into(), srt_port: 8890, srt_passphrase: "Passphrase0123456789".into() }
    }

    #[test]
    fn each_companion_has_its_own_reader_kept_while_it_stays_paired() {
        let hub = CameraHub::default();
        let a = "a1b2c3d4".repeat(8);
        let b = "a1b2c3d4ffff".to_string() + &"0".repeat(52);
        assert!(hub.sync_readers(&[(a.clone(), "Media desk".into()), (b.clone(), "Balcony".into())]).is_empty());
        let list = hub.reader_list();
        assert_eq!(list.len(), 2);
        let users: Vec<&str> = list.iter().map(|(u, _)| u.as_str()).collect();
        assert!(users.contains(&"read-a1b2c3d4"), "{users:?}");
        assert!(users.iter().any(|u| u.starts_with("read-a1b2c3d4f")), "two keys starting the same get different users: {users:?}");
        assert!(list.iter().all(|(_, p)| p.len() == 64 && p.bytes().all(|c| c.is_ascii_hexdigit())));
        assert_ne!(list[0].1, list[1].1);
        assert_eq!(hub.reader_name("read-a1b2c3d4").as_deref(), Some("Media desk"));
        // The same companions again: the same users and secrets (OBS keeps its addresses).
        let before = hub.reader_list();
        assert!(hub.sync_readers(&[(a.clone(), "Media desk".into()), (b.clone(), "Balcony 2".into())]).is_empty());
        assert_eq!(hub.reader_list(), before);
        // Unpaired (or paused): its user goes, to be disconnected.
        let gone = hub.sync_readers(&[(b.clone(), "Balcony".into())]);
        assert_eq!(gone, vec!["read-a1b2c3d4".to_string()]);
        assert_eq!(hub.reader_list().len(), 1);
        assert_eq!(hub.reader_name("read-a1b2c3d4"), None);
        // Paired again later: a new secret.
        hub.sync_readers(&[(a.clone(), "Media desk".into()), (b, "Balcony".into())]);
        assert!(!before.contains(hub.reader_list().iter().find(|(u, _)| u == "read-a1b2c3d4").unwrap()));
        assert!(!format!("{hub:?}").contains(&hub.reader_list()[0].1), "a reader's secret is never printed");
    }

    #[test]
    fn a_companion_sees_its_own_sign_in_only_and_only_while_the_router_runs() {
        let hub = CameraHub::default();
        hub.set(&[("pulpit".into(), "0123456789abcdef".into()), ("choir".into(), "0123456789abcdef".into())]);
        let a = "a".repeat(64);
        let b = "b".repeat(64);
        hub.sync_readers(&[(a.clone(), "Media desk".into()), (b.clone(), "Balcony".into())]);
        let off = hub.companion_view(&a);
        assert_eq!(off["router"], false);
        assert!(off["srt"].is_null(), "no address while the router is off");
        assert_eq!(off["cameras"].as_array().unwrap().iter().map(|c| c["name"].as_str().unwrap()).collect::<Vec<_>>(), vec!["choir", "pulpit"]);
        hub.set_router(Some(target()));
        let on = hub.companion_view(&a);
        assert_eq!(on["srt"]["user"], "read-aaaaaaaa");
        assert_eq!(on["srt"]["port"], 8890);
        assert_eq!(on["srt"]["path"], "companion/");
        assert_eq!(on["srt"]["passphrase"], "Passphrase0123456789");
        let text = on.to_string();
        let theirs = hub.reader_list().into_iter().find(|(u, _)| u == "read-bbbbbbbb").unwrap().1;
        assert!(!text.contains(&theirs), "never another companion's secret");
        assert!(!text.contains("0123456789abcdef"), "never a camera's publishing secret");
        // A key that is not a companion gets no sign-in.
        assert!(hub.companion_view(&"c".repeat(64))["srt"].is_null());
        assert!(!format!("{:?}", target()).contains("Passphrase"), "the passphrase is never printed");
    }

    #[test]
    fn a_companions_tally_names_it_on_the_camera_until_it_goes_quiet() {
        let hub = CameraHub::default();
        let a = "a".repeat(64);
        hub.sync_readers(&[(a.clone(), "Media desk".into())]);
        hub.set_watch(vec![CameraWatch { name: "pulpit".into(), live: true, ..CameraWatch::default() }, CameraWatch { name: "choir".into(), live: true, ..CameraWatch::default() }]);
        assert!(!hub.set_tally(&"z".repeat(64), Tally { program: vec!["pulpit".into()], ..Tally::default() }), "only a paired companion");
        assert!(hub.set_tally(&a, Tally { program: vec!["pulpit".into(), "../bad".into()], preview: vec!["choir".into()], receiving: vec!["pulpit".into(), "choir".into()] }));
        let w = hub.watch();
        assert_eq!(w[0].obs, vec![ObsTally { desk: "Media desk".into(), program: true, preview: false, receiving: true }]);
        assert_eq!(w[1].obs, vec![ObsTally { desk: "Media desk".into(), program: false, preview: true, receiving: true }]);
        // Unpaired: its tally goes with it.
        hub.sync_readers(&[]);
        assert!(hub.watch().iter().all(|c| c.obs.is_empty()));
    }

    #[test]
    fn short_secrets_and_bad_names_never_open_a_camera() {
        let hub = CameraHub::default();
        hub.set(&[("pulpit".into(), "0123456789abcdef".into()), ("choir".into(), "short".into()), ("Bad Name".into(), "0123456789abcdef".into())]);
        assert!(hub.knows("pulpit", "0123456789abcdef"));
        assert!(!hub.knows("pulpit", "0123456789abcdeX"));
        assert!(!hub.knows("choir", "short"));
        assert!(!hub.knows("Bad Name", "0123456789abcdef"));
        let shown = format!("{hub:?}");
        assert!(!shown.contains("0123456789abcdef"), "{shown}");
    }
}
