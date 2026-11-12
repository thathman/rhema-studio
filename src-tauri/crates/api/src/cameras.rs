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
//! A TV's feed page or a joined desk reads a camera through Rhema too (`relay_offer`): knowing a
//! camera's name is not enough, the reader shows its own key, and losing that key cuts it off.
//! Each relayed session carries its own tag in its address, so cutting off one reader leaves another
//! at the same address playing.
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

/// Rhema's own router user for a screen or desk it has checked (`relay_offer`); only Rhema knows its
/// secret, made afresh each time the router starts.
pub const RELAY_USER: &str = "rhema-relay";

/// The query name carrying a relayed session's tag: the router lists a session's query, so Rhema can
/// tell two readers at one address apart.
const RELAY_TAG: &str = "rhema_relay";

/// A relayed session the router does not list after this has ended (or its offer never got there;
/// longer than `relay_offer`'s 15 s timeout, so an offer on its way is not forgotten).
const RELAY_ENDED: Duration = Duration::from_secs(30);

/// Where an OBS companion reads a camera: its own name for the companion (`companion/pulpit`), so
/// the router lets only companions in and asks for the encrypted link's passphrase.
pub const COMPANION_PATH: &str = "companion/";

/// A companion's tally older than this is not shown (its OBS or the companion went away).
const TALLY_FRESH: Duration = Duration::from_secs(15);

/// A phone's battery and heat report older than this is not shown (it reports every 30 s, #213).
const PHONE_FRESH: Duration = Duration::from_secs(95);

/// A picture size and bitrate the host suggests to Rhema Studio Cam for one camera (#838): the
/// most the phone should send, e.g. for a TV whose player is slow at a high bitrate. The phone
/// applies it as a ceiling over its own choice (and may be told not to follow it).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct QualitySuggestion {
    /// Its id as the host's settings keep it ("tv720").
    pub id: &'static str,
    /// The tallest picture (720 = 1280×720).
    pub height: u32,
    /// The highest bitrate, Mbit/s.
    pub mbps: u32,
    /// In words, for the phone to show.
    pub words: &'static str,
}

/// The qualities the host can suggest, by id (as `src/lib/cameras.ts` lists them); anything else
/// (absent, "phone") leaves it to the phone.
#[must_use]
pub fn quality_suggestion(id: &str) -> Option<QualitySuggestion> {
    Some(match id {
        "tv720" => QualitySuggestion { id: "tv720", height: 720, mbps: 4, words: "TV-friendly 720p, lower bitrate" },
        "hd1080" => QualitySuggestion { id: "hd1080", height: 1080, mbps: 8, words: "1080p, moderate bitrate" },
        "light" => QualitySuggestion { id: "light", height: 720, mbps: 2, words: "Light 720p for a busy network" },
        _ => return None,
    })
}

/// What the host says about a camera besides its secret: the name the operator gave it, shown on the
/// phone (#850), and the quality it suggests (#838).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CameraInfo {
    pub label: String,
    pub quality: Option<QualitySuggestion>,
    /// No quality was chosen (the app sent none): TV-friendly while a paired Google TV plays the
    /// camera (`TvHold`), otherwise the phone's own. "phone" is a choice, never automatic.
    pub auto: bool,
}

impl CameraInfo {
    /// The label (at most 40 characters, no control characters) and a known quality id, or none;
    /// no id at all is automatic.
    #[must_use]
    pub fn new(label: &str, quality: Option<&str>) -> Self {
        Self { label: label.chars().filter(|c| !c.is_control()).take(40).collect::<String>().trim().to_string(), quality: quality.and_then(quality_suggestion), auto: quality.is_none() }
    }
}

/// How long a paired Google TV must keep playing an automatic camera before it is suggested
/// TV-friendly 720p (a quick cut through its scene changes nothing).
pub const TV_QUALITY_AFTER: Duration = Duration::from_secs(2);
/// How long after the last TV stops playing it the camera goes back to the phone's own quality.
/// Long, so a cut away and back does not restart the phone's stream twice (it changes size only
/// while on no Program, and a size change restarts its stream).
pub const TV_QUALITY_HOLD: Duration = Duration::from_secs(60);

/// Whether an automatic camera is TV-friendly now: on after `TV_QUALITY_AFTER` on a TV, off only
/// `TV_QUALITY_HOLD` after it was last on one (#838, 12 Nov: a TV fell to 5-9 fps at the phone's
/// 1080p 14 Mbit/s and held 28-29.5 fps at 720p 4 Mbit/s).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TvHold {
    /// Since when a TV has played it without a break.
    on_since: Option<Instant>,
    /// When a TV last played it.
    last_on: Option<Instant>,
    /// TV-friendly was reached and not yet let go.
    active: bool,
}

impl TvHold {
    /// A TV plays the camera now (`on`), or not, at `now`.
    pub fn note(&mut self, on: bool, now: Instant) {
        if on {
            let since = *self.on_since.get_or_insert(now);
            self.last_on = Some(now);
            if now.saturating_duration_since(since) >= TV_QUALITY_AFTER {
                self.active = true;
            }
        } else {
            self.on_since = None;
        }
        self.active = self.on(now);
    }

    /// TV-friendly at `now`.
    #[must_use]
    pub fn on(&self, now: Instant) -> bool {
        self.active && self.last_on.is_some_and(|t| now.saturating_duration_since(t) < TV_QUALITY_HOLD)
    }
}

/// Where the router listens for WHIP, and the encrypted reading link companions use.
#[derive(Clone)]
pub struct RouterTarget {
    /// e.g. `http://127.0.0.1:8889`
    pub base: String,
    /// The router's SRT port (8890).
    pub srt_port: u16,
    /// The passphrase of companions' SRT link, made afresh each time the router starts.
    pub srt_passphrase: String,
    /// `RELAY_USER`'s password.
    pub relay_secret: String,
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
    /// In words: "Media desk (OBS companion)", "Rhema Studio screens on this computer", "A screen or TV at 192.168.1.40".
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
#[derive(Debug, Clone, serde::Serialize, PartialEq, Default)]
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
    /// The phone's own battery and heat (Rhema Studio Cam reports them every 30 s, #213); None
    /// when it has not reported lately (another camera app, an older Cam, or it went quiet).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone: Option<PhoneReport>,
    /// The quality id the host suggests to its phone now ("tv720"; None: the phone's own, #838).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggest: Option<&'static str>,
    /// An automatic camera is TV-friendly now because a paired Google TV plays it (or did, within
    /// `TV_QUALITY_HOLD`).
    pub auto_tv: bool,
}

/// What Rhema Studio Cam says about its phone (`POST /api/v1/camera/<name>/status`).
#[derive(Debug, Clone, Copy, Default, serde::Deserialize, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PhoneStatus {
    /// Battery level, 0–100.
    pub battery: Option<f64>,
    /// Plugged in.
    pub charging: bool,
    /// Battery temperature (°C).
    pub temperature: Option<f64>,
    /// Android's thermal status: 0 none, 1 light, 2 moderate, 3 severe, 4 critical, 5 emergency, 6 shutdown.
    pub thermal: Option<u8>,
    /// The app sends a smaller or slower picture to cool the phone.
    pub cooling: bool,
}

impl PhoneStatus {
    /// Only sensible values.
    #[must_use]
    pub fn clean(mut self) -> Self {
        self.battery = self.battery.filter(|b| b.is_finite() && (0.0..=100.0).contains(b));
        self.temperature = self.temperature.filter(|t| t.is_finite() && (-40.0..=120.0).contains(t));
        self.thermal = self.thermal.filter(|t| *t <= 6);
        self
    }
}

/// A phone's last report, for the operator.
#[derive(Debug, Clone, Copy, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PhoneReport {
    #[serde(flatten)]
    pub status: PhoneStatus,
    /// Milliseconds since it came.
    pub ago_ms: u64,
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

/// Who a relayed camera reader was let in as: a paired key (its hash, "" while keys are off) or a
/// feed page or TV (feed id and the key it showed).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum RelayHolder {
    Key(String),
    Feed(String, String),
}

/// One relayed reader: who was let in, to which camera.
#[derive(Debug, Clone)]
struct RelaySession {
    holder: RelayHolder,
    name: String,
    at: Instant,
}

/// The cameras the operator added (name and the secret in its camera-page link) and the running
/// router, if any. The app keeps both in step; a removed camera's link stops working at once.
#[derive(Default)]
pub struct CameraHub {
    cameras: RwLock<HashMap<String, String>>,
    router: RwLock<Option<RouterTarget>>,
    /// Who was let in to read cameras, by session tag (`relay_offer`).
    relayed: RwLock<HashMap<String, RelaySession>>,
    /// Paired OBS companions' sign-ins, by key hash (#209).
    readers: RwLock<HashMap<String, Reader>>,
    /// The router's cameras as it last answered (the app looks every few seconds while it runs).
    watch: RwLock<Vec<CameraWatch>>,
    /// Each companion's last tally, by key hash, with its name and when it came.
    tallies: RwLock<HashMap<String, (String, Instant, Tally)>>,
    /// Paired desks by the address they follow the host from, to name who watches a camera.
    desks: RwLock<HashMap<IpAddr, String>>,
    /// Each phone's last battery and heat report, by camera name (#213).
    phones: RwLock<HashMap<String, (Instant, PhoneStatus)>>,
    /// Each camera's label and suggested quality, by name (#838, #850).
    info: RwLock<HashMap<String, CameraInfo>>,
    /// Whether each camera is on a Google TV, held against flapping (automatic quality).
    tv_holds: RwLock<HashMap<String, TvHold>>,
    /// The app has given the camera list at least once since Rhema started: until then an unknown
    /// camera may only not be loaded yet, so a phone is not told it was removed (#836).
    loaded: std::sync::atomic::AtomicBool,
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
        let map: HashMap<String, String> = list.iter().filter(|(n, t)| valid_camera_name(n) && t.len() >= 16).cloned().collect();
        // A removed camera's phone report goes with it.
        self.phones.write().unwrap_or_else(PoisonError::into_inner).retain(|n, _| map.contains_key(n));
        self.tv_holds.write().unwrap_or_else(PoisonError::into_inner).retain(|n, _| map.contains_key(n));
        *self.cameras.write().unwrap_or_else(PoisonError::into_inner) = map;
        self.loaded.store(true, std::sync::atomic::Ordering::Release);
    }

    /// Each camera's label and suggested quality (#838, #850); bad names are dropped.
    pub fn set_info(&self, list: Vec<(String, CameraInfo)>) {
        *self.info.write().unwrap_or_else(PoisonError::into_inner) = list.into_iter().filter(|(n, _)| valid_camera_name(n)).collect();
    }

    /// Whether the app has given the camera list since Rhema started (#836).
    #[must_use]
    pub fn loaded(&self) -> bool {
        self.loaded.load(std::sync::atomic::Ordering::Acquire)
    }

    /// Whether the router is receiving this camera now: connected and something arrived within 3 s
    /// (its last look, every 2 s while it runs). False while the router is off.
    #[must_use]
    pub fn receiving(&self, name: &str) -> bool {
        self.router().is_some() && self.watch.read().unwrap_or_else(PoisonError::into_inner).iter().any(|w| w.name == name && w.live && !w.frozen)
    }

    /// The quality suggested for a camera now: the operator's choice, or for an automatic camera
    /// TV-friendly 720p while its `TvHold` is on (none: the phone's own).
    #[must_use]
    pub fn suggestion(&self, name: &str, now: Instant) -> Option<QualitySuggestion> {
        let info = self.info.read().unwrap_or_else(PoisonError::into_inner).get(name).cloned().unwrap_or_default();
        if !info.auto {
            return info.quality;
        }
        let on_tv = self.tv_holds.read().unwrap_or_else(PoisonError::into_inner).get(name).is_some_and(|h| h.on(now));
        if on_tv { quality_suggestion("tv720") } else { None }
    }

    /// Whether a paired Google TV plays this camera now (`FeedHub::on_tv`), noted at each tally.
    pub fn note_on_tv(&self, name: &str, on: bool, now: Instant) {
        if !valid_camera_name(name) {
            return;
        }
        self.tv_holds.write().unwrap_or_else(PoisonError::into_inner).entry(name.to_string()).or_default().note(on, now);
    }

    /// What the phone is told about itself besides its tally (#838, #850): the host's name for it,
    /// whether Rhema receives its picture, and the quality the host suggests (absent: the phone's
    /// own). Old Cams read only the tally's two fields, so these are extra and optional.
    #[must_use]
    pub fn phone_answer(&self, name: &str) -> serde_json::Map<String, serde_json::Value> {
        let info = self.info.read().unwrap_or_else(PoisonError::into_inner).get(name).cloned().unwrap_or_default();
        let mut o = serde_json::Map::new();
        if !info.label.is_empty() {
            o.insert("name".into(), info.label.into());
        }
        o.insert("receiving".into(), self.receiving(name).into());
        if let Some(q) = self.suggestion(name, Instant::now()) {
            o.insert("suggest".into(), serde_json::json!({ "id": q.id, "height": q.height, "mbps": q.mbps, "words": q.words }));
        }
        o
    }

    /// A camera's phone reported its battery and heat, signed in with the camera's own secret
    /// (`Authorization: Bearer <secret>`). False (and nothing kept) for a wrong secret.
    pub fn set_phone(&self, name: &str, token: &str, status: PhoneStatus) -> bool {
        if !self.knows(name, token) {
            return false;
        }
        self.phones.write().unwrap_or_else(PoisonError::into_inner).insert(name.to_string(), (Instant::now(), status.clean()));
        true
    }

    /// A camera's phone report, while fresh.
    #[must_use]
    pub fn phone(&self, name: &str) -> Option<PhoneReport> {
        let phones = self.phones.read().unwrap_or_else(PoisonError::into_inner);
        let (at, status) = phones.get(name)?;
        let age = at.elapsed();
        (age < PHONE_FRESH).then(|| PhoneReport { status: *status, ago_ms: u64::try_from(age.as_millis()).unwrap_or(u64::MAX) })
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
        let now = Instant::now();
        for cam in &mut list {
            cam.phone = self.phone(&cam.name);
            cam.suggest = self.suggestion(&cam.name, now).map(|q| q.id);
            cam.auto_tv = self.info.read().unwrap_or_else(PoisonError::into_inner).get(&cam.name).is_some_and(|i| i.auto) && cam.suggest.is_some();
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

    /// Whether a paired OBS companion has `name` in Program now (its tally at most 15 s old).
    #[must_use]
    pub fn on_program(&self, name: &str) -> bool {
        self.tallies.read().unwrap_or_else(PoisonError::into_inner).values().any(|(_, at, t)| at.elapsed() < TALLY_FRESH && t.program.iter().any(|n| n == name))
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
    /// Pass the WHEP offer of a screen or desk Rhema has checked to the router, as `RELAY_USER` with
    /// the reader's own address, so Production → Cameras still names it, and a tag of its own, so
    /// `relay_kick_unheld` can cut this session and no other.
    /// Only the signalling passes through Rhema; the video flows from the router to the reader.
    pub async fn relay_offer(&self, name: &str, holder: RelayHolder, peer: IpAddr, body: Bytes) -> Response {
        if !self.cameras.read().unwrap_or_else(PoisonError::into_inner).contains_key(name) {
            return StatusCode::NOT_FOUND.into_response();
        }
        let Some(router) = self.router() else {
            return (StatusCode::SERVICE_UNAVAILABLE, "The camera router is off").into_response();
        };
        if body.len() > MAX_BODY {
            return StatusCode::PAYLOAD_TOO_LARGE.into_response();
        }
        let Ok(client) = reqwest::Client::builder().connect_timeout(Duration::from_secs(3)).timeout(Duration::from_secs(15)).build() else {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        };
        let tag = uuid::Uuid::new_v4().simple().to_string();
        // Before the offer: a session the router has made is never without its holder.
        self.relayed.write().unwrap_or_else(PoisonError::into_inner).insert(tag.clone(), RelaySession { holder, name: name.to_string(), at: Instant::now() });
        let sent = client.post(format!("{}/{name}/whep?{RELAY_TAG}={tag}", router.base)).basic_auth(RELAY_USER, Some(&router.relay_secret)).header("x-forwarded-for", peer.to_string()).header("content-type", "application/sdp").body(body.to_vec()).send().await;
        let Ok(resp) = sent else {
            self.relayed.write().unwrap_or_else(PoisonError::into_inner).remove(&tag);
            return (StatusCode::BAD_GATEWAY, "The camera router did not answer").into_response();
        };
        let status = resp.status();
        if !status.is_success() {
            self.relayed.write().unwrap_or_else(PoisonError::into_inner).remove(&tag);
        }
        // The router refusing Rhema's sign-in is Rhema's fault: never ask the reader to sign in.
        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            log::warn!("camera {name}: the router refused Rhema's relay");
            return StatusCode::BAD_GATEWAY.into_response();
        }
        let answer = resp.bytes().await.unwrap_or_default();
        (StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY), [(axum::http::header::CONTENT_TYPE, "application/sdp")], answer).into_response()
    }

    /// A relayed reader held by `holder`, as `relay_offer` records one (tests without a router).
    #[cfg(test)]
    pub(crate) fn relay_hold_for_test(&self, tag: &str, holder: RelayHolder, name: &str) {
        self.relayed.write().unwrap_or_else(PoisonError::into_inner).insert(tag.to_string(), RelaySession { holder, name: name.to_string(), at: Instant::now() });
    }

    /// How many relayed readers of this camera are still allowed.
    #[must_use]
    pub fn relay_readers(&self, name: &str) -> usize {
        self.relayed.read().unwrap_or_else(PoisonError::into_inner).values().filter(|s| s.name == name).count()
    }

    /// Forget readers no longer allowed to read that camera; how many went.
    pub fn relay_prune(&self, allowed: impl Fn(&RelayHolder, &str) -> bool) -> usize {
        let mut relayed = self.relayed.write().unwrap_or_else(PoisonError::into_inner);
        let before = relayed.len();
        relayed.retain(|_, s| allowed(&s.holder, &s.name));
        before - relayed.len()
    }

    /// The relay's sessions in the router's list (`/v3/webrtc/sessions/list`) that nobody allowed holds
    /// now: their ids. Sessions that are not the relay's (this computer's screens) are not looked at.
    #[must_use]
    pub fn relay_unheld(&self, list: &serde_json::Value) -> Vec<String> {
        let relayed = self.relayed.read().unwrap_or_else(PoisonError::into_inner);
        let text = |c: &serde_json::Value, k: &str| c.get(k).and_then(serde_json::Value::as_str).unwrap_or("").to_string();
        list.get("items").and_then(serde_json::Value::as_array).into_iter().flatten()
            .filter(|c| text(c, "user") == RELAY_USER)
            .filter(|c| relay_tag(&text(c, "query")).and_then(|tag| relayed.get(tag)).is_none_or(|s| s.name != text(c, "path")))
            .filter_map(|c| c.get("id")?.as_str().map(str::to_string))
            .collect()
    }

    /// Forget sessions the router no longer lists (a reader that left; the router restarted), so
    /// reconnecting readers do not pile up here. Only with an answer from the router.
    pub fn relay_forget_ended(&self, list: &serde_json::Value) {
        let Some(items) = list.get("items").and_then(serde_json::Value::as_array) else { return };
        let listed: Vec<&str> = items.iter().filter_map(|c| relay_tag(c.get("query")?.as_str()?)).collect();
        self.relayed.write().unwrap_or_else(PoisonError::into_inner).retain(|tag, s| s.at.elapsed() < RELAY_ENDED || listed.contains(&tag.as_str()));
    }

    /// Disconnect the relay's sessions nobody allowed holds now, through the router's control API (`api`
    /// is its address with `/v3`), and tidy the list. Another reader at the same address carries on.
    pub async fn relay_kick_unheld(&self, client: &reqwest::Client, api: &str, user: &str, password: &str, list: &serde_json::Value) {
        for id in self.relay_unheld(list) {
            let kicked = client.post(format!("{api}/webrtc/sessions/kick/{id}")).basic_auth(user, Some(password)).send().await;
            log::info!("camera router: a screen or desk that may no longer read a camera was disconnected ({})", kicked.map_or_else(|e| e.to_string(), |r| r.status().to_string()));
        }
        self.relay_forget_ended(list);
    }

    pub(crate) async fn forward(&self, method: Method, name: &str, session: Option<&str>, headers: &HeaderMap, body: Bytes) -> Response {
        let Some(token) = self.cameras.read().unwrap_or_else(PoisonError::into_inner).get(name).cloned() else {
            return StatusCode::FORBIDDEN.into_response();
        };
        let Some(router) = self.router() else {
            return (StatusCode::SERVICE_UNAVAILABLE, "The camera router is off. Turn it on in Rhema Studio: Production, Cameras.").into_response();
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
            return (StatusCode::BAD_GATEWAY, "The camera router refused this camera. Try again in a moment; if it keeps happening, turn the router off and on in Rhema Studio.").into_response();
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

/// A relayed session's tag in the query the router lists.
fn relay_tag(query: &str) -> Option<&str> {
    query.split('&').find_map(|q| q.strip_prefix(RELAY_TAG)?.strip_prefix('='))
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
        RouterTarget { base: "http://127.0.0.1:8889".into(), srt_port: 8890, srt_passphrase: "Passphrase0123456789".into(), relay_secret: "Relaysecret0123456789".into() }
    }

    #[tokio::test]
    async fn two_readers_at_one_address_are_told_apart_and_ended_sessions_are_forgotten() {
        let hub = CameraHub::default();
        hub.set(&[("pulpit".into(), "0123456789abcdef".into())]);
        let tag = |t: &str| format!("{RELAY_TAG}={t}");
        let session = |at| RelaySession { holder: RelayHolder::Key(if at == 0 { "a".into() } else { "b".into() }), name: "pulpit".into(), at: Instant::now() };
        hub.relayed.write().unwrap().extend([("t1".to_string(), session(0)), ("t2".to_string(), session(1))]);
        let list = serde_json::json!({ "items": [
            { "id": "one", "user": RELAY_USER, "path": "pulpit", "remoteAddr": "192.168.1.40:5000", "query": tag("t1") },
            { "id": "two", "user": RELAY_USER, "path": "pulpit", "remoteAddr": "192.168.1.40:5001", "query": tag("t2") },
            { "id": "wrong-camera", "user": RELAY_USER, "path": "choir", "remoteAddr": "192.168.1.40:5002", "query": tag("t2") },
            { "id": "no-tag", "user": RELAY_USER, "path": "pulpit", "remoteAddr": "192.168.1.40:5003", "query": "" },
            { "id": "this-computer", "user": "", "path": "pulpit", "remoteAddr": "127.0.0.1:5004", "query": "" },
        ]});
        assert_eq!(hub.relay_unheld(&list), ["wrong-camera", "no-tag"]);
        assert_eq!(hub.relay_prune(|h, _| h == &RelayHolder::Key("b".into())), 1);
        assert_eq!(hub.relay_unheld(&list), ["one", "wrong-camera", "no-tag"], "only the reader that lost its key");
        // No answer from the router: nothing is forgotten; an offer on its way is not either.
        hub.relay_forget_ended(&serde_json::Value::Null);
        hub.relay_forget_ended(&serde_json::json!({ "items": [] }));
        assert_eq!(hub.relay_readers("pulpit"), 1);
        hub.relayed.write().unwrap().get_mut("t2").unwrap().at = Instant::now().checked_sub(RELAY_ENDED).unwrap();
        hub.relay_forget_ended(&list);
        assert_eq!(hub.relay_readers("pulpit"), 1, "still in the router's list");
        hub.relay_forget_ended(&serde_json::json!({ "items": [] }));
        assert_eq!(hub.relay_readers("pulpit"), 0, "the reader left");
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
        assert!(hub.on_program("pulpit") && !hub.on_program("choir"), "Program only, not Preview");
        assert_eq!(w[1].obs, vec![ObsTally { desk: "Media desk".into(), program: false, preview: true, receiving: true }]);
        // Unpaired: its tally goes with it.
        hub.sync_readers(&[]);
        assert!(hub.watch().iter().all(|c| c.obs.is_empty()));
        assert!(!hub.on_program("pulpit"), "an unpaired companion's tally counts for nothing");
    }

    #[test]
    fn a_phone_reports_its_battery_with_its_own_secret_only() {
        let hub = CameraHub::default();
        hub.set(&[("pulpit".into(), "0123456789abcdef".into()), ("choir".into(), "fedcba9876543210".into())]);
        hub.set_watch(vec![CameraWatch { name: "pulpit".into(), live: true, ..CameraWatch::default() }]);
        let s = PhoneStatus { battery: Some(18.0), charging: false, temperature: Some(41.5), thermal: Some(3), cooling: true };
        assert!(!hub.set_phone("pulpit", "fedcba9876543210", s), "another camera's secret");
        assert!(!hub.set_phone("pulpit", "", s));
        assert!(hub.watch()[0].phone.is_none());
        assert!(hub.set_phone("pulpit", "0123456789abcdef", s));
        let p = hub.watch()[0].phone.expect("its report");
        assert_eq!(p.status, s);
        assert!(p.ago_ms < 1000);
        let json = serde_json::to_value(hub.watch()[0].clone()).unwrap();
        assert_eq!((json["phone"]["battery"].as_f64(), json["phone"]["thermal"].as_u64(), json["phone"]["cooling"].as_bool()), (Some(18.0), Some(3), Some(true)));
        // Odd values are dropped, not kept.
        assert!(hub.set_phone("pulpit", "0123456789abcdef", PhoneStatus { battery: Some(250.0), temperature: Some(f64::NAN), thermal: Some(9), ..PhoneStatus::default() }));
        let p = hub.phone("pulpit").unwrap().status;
        assert_eq!((p.battery, p.temperature, p.thermal), (None, None, None));
        // Removing the camera drops its report.
        hub.set(&[("choir".into(), "fedcba9876543210".into())]);
        assert!(hub.phone("pulpit").is_none());
    }

    #[test]
    fn a_phone_is_told_its_name_whether_it_is_received_and_the_suggested_quality() {
        let hub = CameraHub::default();
        assert!(!hub.loaded(), "nothing loaded yet: an unknown camera may just not be listed yet");
        hub.set_info(vec![
            ("pulpit".into(), CameraInfo::new("  Pulpit\u{7} wide ", Some("tv720"))),
            ("choir".into(), CameraInfo::new("Choir", Some("nonsense"))),
            ("Bad".into(), CameraInfo::new("x", None)),
        ]);
        hub.set(&[("pulpit".into(), "0123456789abcdef".into()), ("choir".into(), "fedcba9876543210".into())]);
        assert!(hub.loaded());
        let a = hub.phone_answer("pulpit");
        assert_eq!(a["name"], "Pulpit wide");
        assert_eq!(a["suggest"], serde_json::json!({ "id": "tv720", "height": 720, "mbps": 4, "words": "TV-friendly 720p, lower bitrate" }));
        assert_eq!(a["receiving"], false, "the router is off");
        assert!(hub.phone_answer("choir").get("suggest").is_none(), "an unknown quality leaves it to the phone");
        assert!(hub.phone_answer("Bad").get("name").is_none());
        hub.set_router(Some(target()));
        hub.set_watch(vec![CameraWatch { name: "pulpit".into(), live: true, ..CameraWatch::default() }, CameraWatch { name: "choir".into(), live: true, frozen: true, ..CameraWatch::default() }]);
        assert!(hub.receiving("pulpit"));
        assert!(!hub.receiving("choir"), "connected but nothing arriving is not receiving");
        assert_eq!(hub.phone_answer("pulpit")["receiving"], true);
        assert_eq!(CameraInfo::new(&"x".repeat(60), None).label.len(), 40);
    }

    #[test]
    fn an_automatic_camera_is_tv_friendly_after_two_seconds_on_a_tv_and_for_a_minute_after() {
        let hub = CameraHub::default();
        hub.set_info(vec![
            ("pulpit".into(), CameraInfo::new("Pulpit", None)),
            ("choir".into(), CameraInfo::new("Choir", Some("phone"))),
            ("wide".into(), CameraInfo::new("Wide", Some("hd1080"))),
        ]);
        let t0 = Instant::now();
        let at = |s: u64| t0 + Duration::from_secs(s);
        assert_eq!(hub.suggestion("pulpit", t0), None, "automatic, on no TV: the phone's own");
        for name in ["pulpit", "choir", "wide"] {
            hub.note_on_tv(name, true, t0);
        }
        assert_eq!(hub.suggestion("pulpit", at(1)), None, "not yet: a quick cut changes nothing");
        for name in ["pulpit", "choir", "wide"] {
            hub.note_on_tv(name, true, at(2));
        }
        assert_eq!(hub.suggestion("pulpit", at(2)).map(|q| q.id), Some("tv720"));
        assert_eq!(hub.suggestion("choir", at(2)), None, "The phone decides, chosen: never overridden");
        assert_eq!(hub.suggestion("wide", at(2)).map(|q| q.id), Some("hd1080"), "a chosen quality wins");
        // The TV cuts away: held for a minute, so the phone does not restart twice.
        hub.note_on_tv("pulpit", false, at(4));
        assert_eq!(hub.suggestion("pulpit", at(61)).map(|q| q.id), Some("tv720"));
        hub.note_on_tv("pulpit", false, at(62));
        assert_eq!(hub.suggestion("pulpit", at(62)), None, "off TVs for a minute: back to the phone's own");
    }

    #[test]
    fn a_tv_coming_back_within_the_minute_keeps_it_and_a_short_glimpse_never_turns_it_on() {
        let t0 = Instant::now();
        let at = |s: u64| t0 + Duration::from_secs(s);
        let mut h = TvHold::default();
        h.note(true, t0);
        h.note(false, at(1));
        h.note(true, at(2));
        assert!(!h.on(at(3)), "on, off, on: the two seconds start again");
        h.note(true, at(4));
        assert!(h.on(at(4)));
        h.note(false, at(30));
        h.note(true, at(50));
        h.note(false, at(52));
        assert!(h.on(at(100)), "back on a TV within the minute: the minute counts from then");
        assert!(!h.on(at(112)));
        assert!(!TvHold::default().on(t0), "no TV ever: never");
    }

    #[test]
    fn the_panel_is_told_the_suggestion_and_whether_a_tv_made_it() {
        let hub = CameraHub::default();
        hub.set_info(vec![("pulpit".into(), CameraInfo::new("Pulpit", None)), ("wide".into(), CameraInfo::new("Wide", Some("light")))]);
        hub.set_watch(vec![CameraWatch { name: "pulpit".into(), ..CameraWatch::default() }, CameraWatch { name: "wide".into(), ..CameraWatch::default() }]);
        let now = Instant::now();
        hub.note_on_tv("pulpit", true, now.checked_sub(Duration::from_secs(3)).unwrap_or(now));
        hub.note_on_tv("pulpit", true, now);
        let w = hub.watch();
        assert_eq!((w[0].suggest, w[0].auto_tv), (Some("tv720"), true));
        assert_eq!((w[1].suggest, w[1].auto_tv), (Some("light"), false));
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
