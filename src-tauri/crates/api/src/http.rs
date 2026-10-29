use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::ConnectInfo,
    http::HeaderMap,
    extract::State as AxumState,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use axum::response::sse::{Event, KeepAlive, Sse};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, watch};
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::command::RemoteCommand;
use crate::dispatch::{CommandDispatcher, CommandSink};
use crate::error::CommandError;
use crate::keys::{check_key, new_key_set, new_pairing_window, try_pair_as, KeySet, PairOutcome, PairingWindow};
use crate::peer::{check_remote_key, is_local_network_ip, OPEN_REMOTE_OUTSIDE_LOCAL_NETWORK};

/// Configuration for the HTTP API server.
#[derive(Debug, Clone)]
pub struct HttpConfig {
    pub port: u16,
    pub host: String,
    /// Paired devices and the shared key; empty means open. `/command` requires
    /// `X-Rhema-Key: <token>` (or `Authorization: Bearer <token>`) otherwise; with auth off,
    /// unpaired commands are accepted only from local/private source addresses.
    pub keys: KeySet,
    /// The pairing window `/pair` checks against.
    pub pairing: PairingWindow,
    /// The host's Live State for joined devices (Host/Join, ARCH-004).
    pub live: SharedLive,
    /// Browser feeds: outputs drawn by a web page on the LAN (OBS Browser Source, a TV's browser).
    pub feeds: SharedFeeds,
    /// Rhema Comms voice: offers waiting for the host window's answer.
    pub voice: SharedVoice,
    /// Opt-in https beside the http port, for phone pages (a phone's microphone needs a secure page).
    pub tls: Option<TlsListener>,
    /// Phone cameras and the camera router their page publishes to (#209).
    pub cameras: crate::cameras::SharedCameras,
    /// Who is connected now and when each paired desk was last seen (Production → Operators).
    pub presence: crate::presence::SharedPresence,
}

/// The https listener: its port, this computer's certificate and the local CA that signed it.
#[derive(Debug, Clone)]
pub struct TlsListener {
    pub port: u16,
    pub server: crate::tls::Pem,
    pub ca_cert: String,
}

impl Default for HttpConfig {
    fn default() -> Self {
        Self {
            port: 8080,
            host: "0.0.0.0".into(),
            keys: new_key_set(),
            pairing: new_pairing_window(),
            live: new_live_hub(),
            feeds: new_feed_hub(),
            voice: new_voice_hub(),
            tls: None,
            cameras: crate::cameras::new_camera_hub(),
            presence: crate::presence::new_presence(),
        }
    }
}

/// Browser feeds (ARCH-002): for each output of type "browser", its secret and the frame it shows
/// now, streamed to the feed page. The app keeps the list in step with its outputs; the server
/// never reads a frame.
#[derive(Debug, Default)]
pub struct FeedHub {
    feeds: std::sync::RwLock<std::collections::HashMap<String, Feed>>,
    /// Told whenever the keys change, so a page whose key was withdrawn (a revoked TV, a new link)
    /// is cut at once instead of following until it reconnects.
    changed: tokio::sync::Notify,
}

/// A feed's keys as the app keeps them (#198): the feed's own link key, and each paired TV's own
/// key with the TV's id (its address), so one TV can be revoked without a new link for everyone.
#[derive(Debug, Clone, Default)]
pub struct FeedKeys {
    pub id: String,
    pub token: String,
    pub tvs: Vec<(String, String)>,
}

/// A paired TV's own key on a feed, and how many of its pages follow the feed now.
#[derive(Debug)]
struct TvKey {
    id: String,
    token: String,
    watching: Arc<std::sync::atomic::AtomicUsize>,
}

/// Counts a TV's page while its stream is open; dropping it (the stream ended) counts it out.
struct Watching(Arc<std::sync::atomic::AtomicUsize>);

impl Watching {
    fn new(n: &Arc<std::sync::atomic::AtomicUsize>) -> Self {
        n.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Self(n.clone())
    }
}

impl Drop for Watching {
    fn drop(&mut self) {
        self.0.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
    }
}

/// A paired TV's pages following its feed now, by the TV's id (never its key).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TvWatching {
    pub id: String,
    pub watching: usize,
}

#[derive(Debug)]
struct Feed {
    token: String,
    /// Each paired TV's own key (#198, Rhema Studio Receiver sent from 1.5 on).
    tvs: Vec<TvKey>,
    /// The frame shown now, with its number.
    current: Option<(u64, String)>,
    seq: u64,
    tx: broadcast::Sender<(u64, String)>,
    /// The newest frame a page said it drew, and when (receiver trust, #246 item 9).
    acked: u64,
    acked_at: Option<std::time::Instant>,
    /// When the newest frame was published, for how long it took a page to draw it (#246 C17).
    published_at: Option<std::time::Instant>,
    /// What its pages last said about the cameras they play (#213).
    video: crate::feed_video::FeedVideo,
    /// The page's clock minus the host's (ms), the largest a page said lately, and when (#196: a TV
    /// whose clock is off by more than 2 s is worth a warning, though its timers follow the host).
    clock: Option<(i64, std::time::Instant)>,
}

/// A browser feed's health for the operator: pages following it, and whether one drew the latest frame.
#[derive(Debug, Clone, Serialize)]
pub struct FeedStatus {
    pub watching: usize,
    pub seq: u64,
    pub acked: u64,
    /// Milliseconds since a page last said it drew a frame; None if none has.
    pub acked_ago_ms: Option<u64>,
    /// Each page that reported lately: the cameras it plays, frames shown and dropped (#213).
    pub video: Vec<crate::feed_video::PageVideo>,
    /// A page's clock minus the host's (ms), when one said so in the last half minute (#196).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clock_skew_ms: Option<i64>,
    /// Each paired TV with its own key: how many of its pages follow the feed now (#198).
    pub tvs: Vec<TvWatching>,
}

impl Feed {
    fn new(token: String) -> Self {
        Self { token, tvs: Vec::new(), current: None, seq: 0, tx: broadcast::channel(16).0, acked: 0, acked_at: None, published_at: None, video: crate::feed_video::FeedVideo::default(), clock: None }
    }

    /// Whether a key opens this feed: the feed's own (`Some(None)`) or a paired TV's (`Some(Some(tv))`).
    fn admits(&self, token: &str) -> Option<Option<&TvKey>> {
        if crate::command::same_key(token, &self.token) {
            return Some(None);
        }
        self.tvs.iter().find(|t| crate::command::same_key(token, &t.token)).map(Some)
    }
}

impl FeedHub {
    /// Replace the list of feeds (id, secret) with no TV keys; frames of feeds that stay are kept.
    pub fn set(&self, list: &[(String, String)]) {
        self.set_keys(&list.iter().map(|(id, token)| FeedKeys { id: id.clone(), token: token.clone(), tvs: Vec::new() }).collect::<Vec<_>>());
    }

    /// Replace the list of feeds with their keys (#198): the feed's own and each paired TV's. Frames
    /// of feeds that stay are kept; a page whose key is no longer listed (a new link, a revoked TV)
    /// is cut at once, the others carry on.
    pub fn set_keys(&self, list: &[FeedKeys]) {
        {
            let mut feeds = self.feeds.write().unwrap_or_else(std::sync::PoisonError::into_inner);
            feeds.retain(|id, _| list.iter().any(|k| k.id == *id));
            for k in list {
                let f = feeds.entry(k.id.clone()).or_insert_with(|| Feed::new(k.token.clone()));
                f.token.clone_from(&k.token);
                let tvs = k
                    .tvs
                    .iter()
                    .map(|(id, token)| {
                        let watching = f.tvs.iter().find(|t| t.token == *token).map(|t| t.watching.clone()).unwrap_or_default();
                        TvKey { id: id.clone(), token: token.clone(), watching }
                    })
                    .collect();
                f.tvs = tvs;
            }
        }
        self.changed.notify_waiters();
    }

    /// The frame a feed shows now; unknown feeds are ignored.
    pub fn publish(&self, id: &str, json: String) {
        let mut feeds = self.feeds.write().unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(f) = feeds.get_mut(id) {
            f.seq += 1;
            f.published_at = Some(std::time::Instant::now());
            f.current = Some((f.seq, json.clone()));
            let _ = f.tx.send((f.seq, json));
        }
    }

    /// A page drew frame `seq` (only with the feed's secret; never ahead of what was sent). Err: refused.
    /// `Ok(Some(ms))`: the first page to draw the newest frame, `ms` after it was published (#246 C17).
    fn ack(&self, id: &str, token: &str, seq: u64, video: Option<(std::net::IpAddr, Vec<crate::feed_video::CameraPlayback>)>, clock: Option<i64>) -> Result<Option<u64>, ()> {
        let mut feeds = self.feeds.write().unwrap_or_else(std::sync::PoisonError::into_inner);
        let f = feeds.get_mut(id).filter(|f| f.admits(token).is_some()).ok_or(())?;
        let mut first = None;
        if seq <= f.seq && seq >= f.acked {
            if seq == f.seq && seq > f.acked {
                first = f.published_at.map(|t| u64::try_from(t.elapsed().as_millis()).unwrap_or(u64::MAX));
            }
            f.acked = seq;
            f.acked_at = Some(std::time::Instant::now());
        }
        if let Some((from, cameras)) = video {
            f.video.report(from, cameras, std::time::Instant::now());
        }
        if let Some(skew) = clock {
            // Several pages on one feed: the one furthest off is the one to warn about, until it reports again.
            let now = std::time::Instant::now();
            let keep = f.clock.filter(|(old, at)| now.duration_since(*at) < CLOCK_REPORT_FOR && old.abs() > skew.abs());
            f.clock = Some(keep.unwrap_or((skew, now)));
        }
        Ok(first)
    }

    /// How the feed is doing, for the output card.
    #[must_use]
    pub fn status(&self, id: &str) -> Option<FeedStatus> {
        let feeds = self.feeds.read().unwrap_or_else(std::sync::PoisonError::into_inner);
        let f = feeds.get(id)?;
        Some(FeedStatus {
            watching: f.tx.receiver_count(),
            seq: f.seq,
            acked: f.acked,
            acked_ago_ms: f.acked_at.map(|t| u64::try_from(t.elapsed().as_millis()).unwrap_or(u64::MAX)),
            video: f.video.pages(std::time::Instant::now()),
            clock_skew_ms: f.clock.filter(|(_, at)| at.elapsed() < CLOCK_REPORT_FOR).map(|(ms, _)| ms),
            tvs: f.tvs.iter().map(|t| TvWatching { id: t.id.clone(), watching: t.watching.load(std::sync::atomic::Ordering::Relaxed) }).collect(),
        })
    }

    /// The feed's current frame and a receiver for the next ones, if the key opens it; a paired
    /// TV's page is counted as that TV's while the stream lasts.
    fn follow(&self, id: &str, token: &str) -> Option<(Option<(u64, String)>, broadcast::Receiver<(u64, String)>, Option<Watching>)> {
        let feeds = self.feeds.read().unwrap_or_else(std::sync::PoisonError::into_inner);
        let f = feeds.get(id)?;
        let tv = f.admits(token)?;
        Some((f.current.clone(), f.tx.subscribe(), tv.map(|t| Watching::new(&t.watching))))
    }

    fn knows(&self, id: &str, token: &str) -> bool {
        self.feeds.read().unwrap_or_else(std::sync::PoisonError::into_inner).get(id).is_some_and(|f| f.admits(token).is_some())
    }

    /// Ends once this key no longer opens the feed (a revoked TV, a new link, the feed removed).
    async fn until_withdrawn(self: Arc<Self>, id: String, token: String) {
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if !self.knows(&id, &token) {
                return;
            }
            changed.await;
        }
    }

    /// The feed's frame shown now names this media file (a scene's video layer): only then may its page fetch it.
    fn shows_file(&self, id: &str, token: &str, file: &str) -> bool {
        let feeds = self.feeds.read().unwrap_or_else(std::sync::PoisonError::into_inner);
        let needle = format!("\"mediaFile\":\"{file}\"");
        feeds.get(id).is_some_and(|f| f.admits(token).is_some() && f.current.as_ref().is_some_and(|(_, json)| json.contains(&needle)))
    }
}

pub type SharedFeeds = Arc<FeedHub>;

/// How long a page's clock report counts (pages send one every few seconds).
const CLOCK_REPORT_FOR: std::time::Duration = std::time::Duration::from_secs(30);
/// How often a feed page hears from the host when nothing changes (#196): a "beat" with the host's
/// clock, so the page can tell a quiet host from a lost one and count by the host's time.
pub const FEED_BEAT: std::time::Duration = std::time::Duration::from_secs(3);

/// Rhema Comms voice (C3, ADR 0002): a desk's WebRTC offer waits here for the host window's answer.
#[derive(Debug, Default)]
pub struct VoiceHub {
    pending: std::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<String>>>,
}

impl VoiceHub {
    fn wait(&self, id: &str) -> tokio::sync::oneshot::Receiver<String> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.pending.lock().unwrap_or_else(std::sync::PoisonError::into_inner).insert(id.to_string(), tx);
        rx
    }

    fn forget(&self, id: &str) {
        self.pending.lock().unwrap_or_else(std::sync::PoisonError::into_inner).remove(id);
    }

    /// The host window's answer to an offer; false when nobody waits for it (timed out).
    pub fn answer(&self, id: &str, sdp: String) -> bool {
        let tx = self.pending.lock().unwrap_or_else(std::sync::PoisonError::into_inner).remove(id);
        tx.is_some_and(|tx| tx.send(sdp).is_ok())
    }
}

pub type SharedVoice = Arc<VoiceHub>;

#[must_use]
pub fn new_voice_hub() -> SharedVoice {
    Arc::new(VoiceHub::default())
}

#[must_use]
pub fn new_feed_hub() -> SharedFeeds {
    Arc::new(FeedHub::default())
}

/// The host's Live State (ADR 0001): the app publishes a JSON snapshot whenever it changes; joined
/// devices read it (`/api/v1/live`) or follow it (`/api/v1/live/events`, server-sent events). The
/// server reads only which service it is about (#246 C16), to refuse commands meant for another.
#[derive(Debug)]
pub struct LiveHub {
    current: std::sync::RwLock<Option<String>>,
    tx: broadcast::Sender<String>,
    revisions: std::sync::Mutex<Revisions>,
}

/// A revision for each part of the live service a joined desk can change (#196 R7, #246 T6): the
/// event clock, the running-late offset, the service timer, the hold, each live source and each
/// congregation output. It goes up whenever the host's Live State shows that part changed, and at
/// once when the server accepts a command for it, so of two desks acting on what they both saw,
/// only the first is carried out; the other is told to look again. The server keeps them and adds
/// them to the Live State it hands on (`revisions`), so a desk sends back what it saw.
#[derive(Debug, Default)]
struct Revisions {
    parts: std::collections::HashMap<String, (u64, String)>,
}

impl Revisions {
    /// What each part looks like in this Live State, to tell when it changed. Fields an older host
    /// does not send read as null, so its parts simply never move.
    fn fingerprints(v: &serde_json::Value) -> Vec<(String, String)> {
        let mut out = vec![
            ("event".to_string(), v["event"]["currentId"].to_string()),
            ("offset".to_string(), serde_json::json!([v["timing"]["offsetMinutes"], v["timing"]["offsetBy"]]).to_string()),
            ("timer".to_string(), serde_json::json!([v["timer"]["running"], v["timer"]["durationMs"], v["timer"]["revision"]]).to_string()),
            ("hold".to_string(), v["hold"].to_string()),
            // The song or hymn on the screens and where in it (desk consoles): a section step from a
            // Worship desk acts on the section it saw.
            ("lyrics".to_string(), serde_json::json!([v["lyrics"]["itemId"], v["lyrics"]["index"]]).to_string()),
            // The run of show's items (Comms C2): queueing a request acts on the list it saw, so two
            // desks answering the same request do not queue it twice. Times are not a change.
            ("queue".to_string(), serde_json::Value::Array(v["rundown"].as_array().into_iter().flatten().map(|i| i["id"].clone()).collect()).to_string()),
            // OBS's recording on or off, and its transition (#197): an OBS desk acts on what it saw.
            ("obs:record".to_string(), v["obs"]["recording"].to_string()),
            ("obs:transition".to_string(), v["obs"]["transition"].to_string()),
        ];
        // Each extra timer (#196 R2.5): started, paused, reset or changed. A running one's time
        // moves on by itself, so only a stopped one's time counts.
        for t in v["auxTimers"].as_array().into_iter().flatten() {
            if let Some(id) = t["id"].as_str() {
                let stopped_at = if t["running"].as_bool() == Some(true) { serde_json::Value::Null } else { t["elapsedMs"].clone() };
                out.push((format!("aux:{id}"), serde_json::json!([t["running"], t["durationMs"], stopped_at]).to_string()));
            }
        }
        for s in v["sources"].as_array().into_iter().flatten() {
            if let Some(id) = s["id"].as_str() {
                out.push((format!("source:{id}"), serde_json::json!([s["on"], s["revision"]]).to_string()));
            }
        }
        for o in v["outputs"].as_array().into_iter().flatten() {
            if let Some(id) = o["id"].as_str() {
                // Group Take reviews the current Program plus the output-specific rendering
                // context. A language, theme, frame, or source-subscription change must invalidate
                // that review just as a different current scene does.
                out.push((
                    format!("output:{id}"),
                    serde_json::json!([
                        o["name"],
                        o["type"],
                        o["role"],
                        o["sceneId"],
                        o["sceneRevision"],
                        o["impact"],
                    ])
                    .to_string(),
                ));
            }
        }
        // Each scene's arrangement (#243 SC.16): whether it is on a screen is not a change to it.
        for sc in v["scenes"].as_array().into_iter().flatten() {
            if let Some(id) = sc["id"].as_str() {
                out.push((format!("scene:{id}"), serde_json::json!([sc["name"], sc["background"], sc["fadeMs"], sc["layers"]]).to_string()));
            }
        }
        out
    }

    /// A new Live State: each part that looks different from the last one goes up by one. A scene
    /// that is no longer there has changed too (it was deleted), so a desk's change to it is refused.
    fn observe(&mut self, v: &serde_json::Value) {
        let now = Self::fingerprints(v);
        let gone: Vec<String> = self.parts.keys().filter(|k| k.starts_with("scene:") && !now.iter().any(|(p, _)| p == *k)).cloned().collect();
        for part in gone {
            if let Some((n, old)) = self.parts.get_mut(&part) {
                if old != "gone" {
                    *n += 1;
                    *old = "gone".into();
                }
            }
        }
        for (part, fp) in now {
            match self.parts.get_mut(&part) {
                Some((n, old)) if *old != fp => {
                    *n += 1;
                    *old = fp;
                }
                Some(_) => {}
                None => {
                    self.parts.insert(part, (1, fp));
                }
            }
        }
    }

    fn get(&self, part: &str) -> Option<u64> {
        self.parts.get(part).map(|(n, _)| *n)
    }

    /// Reserve a set of parts together, without exposing a partially advanced group to readers.
    fn bump_many(&mut self, parts: &[String]) -> bool {
        if parts.is_empty() || parts.iter().any(|part| !self.parts.contains_key(part)) {
            return false;
        }
        let mut seen = std::collections::HashSet::with_capacity(parts.len());
        for part in parts {
            if seen.insert(part) {
                if let Some((revision, _)) = self.parts.get_mut(part) {
                    *revision += 1;
                }
            }
        }
        true
    }

    fn to_json(&self) -> serde_json::Value {
        serde_json::Value::Object(self.parts.iter().map(|(k, (n, _))| (k.clone(), serde_json::json!(n))).collect())
    }
}

/// The part of the live service a remote command changes, for its revision check (see
/// `Revisions`); None for those not checked: stepping verses, activating a reference, notices and
/// talk, and anything newer this list does not name.
fn revision_part(cmd: &RemoteCommand) -> Option<String> {
    Some(match cmd {
        RemoteCommand::EventNext | RemoteCommand::EventPrev | RemoteCommand::EventStart(_) => "event".into(),
        RemoteCommand::EventOffset(_) => "offset".into(),
        RemoteCommand::TimerStart | RemoteCommand::TimerPause | RemoteCommand::TimerAdjust(_) => "timer".into(),
        RemoteCommand::Hold(_) | RemoteCommand::Resume => "hold".into(),
        RemoteCommand::ClearSource(id) | RemoteCommand::RestoreSource(id) => format!("source:{id}"),
        RemoteCommand::TakeScene(t) => format!("output:{}", t.output),
        RemoteCommand::ReleaseScene(output) => format!("output:{output}"),
        RemoteCommand::SaveScene(sc) => format!("scene:{}", sc.id()),
        RemoteCommand::DeleteScene(d) => format!("scene:{}", d.id),
        RemoteCommand::SongSection(_) => "lyrics".into(),
        RemoteCommand::AuxTimer(t) => format!("aux:{}", t.id),
        RemoteCommand::QueueRequest(_) => "queue".into(),
        RemoteCommand::ObsRecord(_) => "obs:record".into(),
        RemoteCommand::ObsTransition(_) => "obs:transition".into(),
        _ => return None,
    })
}

/// Every revision a group Take was previewed against: its scene plus each target Program.
fn group_take_revision_parts(take: &crate::command::GroupSceneTake) -> Vec<String> {
    std::iter::once(format!("scene:{}", take.scene))
        .chain(take.outputs.iter().map(|output| format!("output:{output}")))
        .collect()
}

fn command_revision_parts(cmd: &RemoteCommand) -> Vec<String> {
    match cmd {
        RemoteCommand::GroupTakeScene(take) => group_take_revision_parts(take),
        _ => revision_part(cmd).into_iter().collect(),
    }
}

fn changed_revision_parts(cmd: &RemoteCommand) -> Vec<String> {
    match cmd {
        RemoteCommand::GroupTakeScene(take) => take
            .outputs
            .iter()
            .map(|output| format!("output:{output}"))
            .collect(),
        _ => revision_part(cmd).into_iter().collect(),
    }
}

/// Validate against the current host snapshot before dispatch; the command gate repeats this check.
fn validate_group_take_live(
    live_json: Option<&str>,
    take: &crate::command::GroupSceneTake,
) -> Result<(), (StatusCode, &'static str)> {
    take.validate()
        .map_err(|why| (StatusCode::UNPROCESSABLE_ENTITY, why))?;
    let Some(live_json) = live_json else {
        return Err((
            StatusCode::CONFLICT,
            "The host Live State is not ready; refresh before a group Take",
        ));
    };
    let Ok(live) = serde_json::from_str::<serde_json::Value>(live_json) else {
        return Err((
            StatusCode::CONFLICT,
            "The host Live State could not be checked; refresh before a group Take",
        ));
    };
    let live_service = live
        .pointer("/service/id")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    if take.service.as_deref() != Some(live_service) {
        return Err((
            StatusCode::CONFLICT,
            "The host has changed services; refresh before a group Take",
        ));
    }
    if live
        .pointer("/program/rehearsal")
        .and_then(serde_json::Value::as_bool)
        == Some(true)
    {
        return Err((
            StatusCode::FORBIDDEN,
            "Group Take is unavailable during rehearsal",
        ));
    }
    let scene_exists = live
        .get("scenes")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|scenes| {
            scenes.iter().any(|scene| {
                scene.get("id").and_then(serde_json::Value::as_str) == Some(&take.scene)
            })
        });
    if !scene_exists {
        return Err((
            StatusCode::CONFLICT,
            "That scene is no longer available; refresh before a group Take",
        ));
    }
    if take
        .outputs
        .iter()
        .any(|output| !crate::keys::KeyEntry::is_congregation_output(Some(live_json), output))
    {
        return Err((
            StatusCode::FORBIDDEN,
            "Group Take is limited to current congregation outputs",
        ));
    }
    Ok(())
}

/// The one part of a Live State the server reads: `service.id` ("" when no saved service is open).
#[derive(Deserialize)]
struct LiveService {
    service: Option<ServiceId>,
}

#[derive(Deserialize)]
struct ServiceId {
    id: Option<String>,
}

/// The service a Live State is about: `Some("")` for none open, `None` when it does not say
/// (an older build), so nothing is refused for it.
fn service_of(json: &str) -> Option<String> {
    match serde_json::from_str::<LiveService>(json).ok()?.service {
        None => Some(String::new()),
        Some(s) => s.id,
    }
}

impl LiveHub {
    pub fn publish(&self, json: String) {
        // The revisions go in with it, so a desk acts on, and sends back, what it saw.
        // Keep revision observation, the readable snapshot, and its stream event under the same
        // lock. Concurrent publishers therefore cannot send an older snapshot after a newer one.
        let mut revisions = self.revisions.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let json = match serde_json::from_str::<serde_json::Value>(&json) {
            Ok(mut value) if value.is_object() => {
                revisions.observe(&value);
                if let Some(object) = value.as_object_mut() {
                    object.insert("revisions".into(), revisions.to_json());
                }
                serde_json::to_string(&value).unwrap_or(json)
            }
            _ => json,
        };
        *self.current.write().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(json.clone());
        // No one following is fine.
        let _ = self.tx.send(json);
        drop(revisions);
    }

    /// The revision of one part of the live service now (see `Revisions`), None before the host
    /// has shown it.
    #[must_use]
    pub fn revision(&self, part: &str) -> Option<u64> {
        self.revisions.lock().unwrap_or_else(std::sync::PoisonError::into_inner).get(part)
    }

    fn bump_many(&self, parts: &[String]) -> bool {
        let mut revisions = self.revisions.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let Some(current) = self.current.read().unwrap_or_else(std::sync::PoisonError::into_inner).clone() else {
            return false;
        };
        let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&current) else {
            return false;
        };
        let Some(object) = value.as_object_mut() else {
            return false;
        };
        if !revisions.bump_many(parts) {
            return false;
        }
        object.insert("revisions".into(), revisions.to_json());
        let updated = serde_json::to_string(&value).unwrap_or(current);
        *self.current.write().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(updated.clone());
        // A reserved command revision is part of the Live State immediately, including when the
        // dispatcher or a later native preflight refuses the operation. Keep the send within the
        // revision lock so concurrent Live snapshots cannot overtake it.
        let _ = self.tx.send(updated);
        drop(revisions);
        true
    }

    fn bump(&self, part: &str) {
        let _ = self.bump_many(&[part.to_string()]);
    }

    #[must_use]
    pub fn current(&self) -> Option<String> {
        self.current.read().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
    }

    /// The service the host is running now ("" for none), or None before it has said.
    #[must_use]
    pub fn service(&self) -> Option<String> {
        self.current()
            .as_deref()
            .and_then(service_of)
    }
}

pub type SharedLive = Arc<LiveHub>;

/// Production notices stay private to the people they are for (Rhema Comms, #251): a paired desk
/// gets the Live State with only the notices addressed to everyone, to its role, to its key (one
/// person), or sent by its key. Who sent a notice and whom it is for by name are decided by key ids
/// the host stamped (`fromId`, `toId`: the key's hash, "host" for the main desk), never by display
/// names, which a desk could copy; the ids themselves are taken out before a desk sees them.
/// `None` is the main desk (this computer itself), which gets them all. A state this server cannot
/// read, or one without notices, goes out as it is.
#[must_use]
pub fn notices_for(json: &str, reader: Option<&crate::keys::KeyEntry>) -> String {
    let Some(reader) = reader else { return json.to_string() };
    let Ok(mut v) = serde_json::from_str::<serde_json::Value>(json) else { return json.to_string() };
    let Some(list) = v.get_mut("notices").and_then(serde_json::Value::as_array_mut) else { return json.to_string() };
    list.retain(|n| notice_is_for(n, reader));
    for n in list.iter_mut() {
        if let Some(o) = n.as_object_mut() {
            o.remove("fromId");
            o.remove("toId");
        }
    }
    v.to_string()
}

/// The Live State as one paired desk gets it: only its notices (`notices_for`), and the scenes'
/// full definitions only for a desk that may change scenes (#243 SC.16); the others get each
/// scene's name and id, as before, which keeps a phone's copy small.
/// The desk consoles' parts of it go only to the desks they are for: the readiness board and who is
/// connected (`readiness`, `presence`) to the Present and settings desks (the director); the verses
/// heard by Auto Bible (`heard`) to them, the Bible desk and the editor.
#[must_use]
pub fn live_for(json: &str, reader: Option<&crate::keys::KeyEntry>) -> String {
    let filtered = notices_for(json, reader);
    let Some(reader) = reader else { return filtered };
    let scenes = !reader.role.edits_scenes() && filtered.contains("\"layers\"");
    let mut hidden: Vec<&str> = hidden_from(reader.role).to_vec();
    if !matches!(reader.role, crate::keys::Role::Present | crate::keys::Role::Configure | crate::keys::Role::Screens) {
        hidden.push("graphicsQueue");
    }
    if reader.role != crate::keys::Role::Screens {
        hidden.push("groupTakeResults");
    }
    hidden.retain(|k| filtered.contains(&format!("\"{k}\"")));
    let scopes_outputs = reader.role == crate::keys::Role::Screens
        && (filtered.contains("\"outputs\"") || filtered.contains("\"outputMap\""));
    let scopes_group_results =
        reader.role == crate::keys::Role::Screens && filtered.contains("\"groupTakeResults\"");
    if !scenes && hidden.is_empty() && !scopes_outputs && !scopes_group_results {
        return filtered;
    }
    let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&filtered) else { return filtered };
    if let Some(o) = v.as_object_mut() {
        for k in hidden {
            o.remove(k);
        }
    }
    if scenes {
        for scene in v.get_mut("scenes").and_then(serde_json::Value::as_array_mut).into_iter().flatten() {
            if let Some(o) = scene.as_object_mut() {
                o.retain(|k, _| matches!(k.as_str(), "id" | "name" | "onScreen"));
            }
        }
    }
    if reader.role == crate::keys::Role::Screens {
        for field in ["outputs", "outputMap"] {
            if let Some(value) = v.get_mut(field) {
                if let Some(outputs) = value.as_array_mut() {
                    outputs.retain(|output| {
                        output.get("id").and_then(serde_json::Value::as_str).is_some_and(|id| {
                            reader.output_scope.iter().any(|allowed| allowed == id)
                                && output.get("role").and_then(serde_json::Value::as_str).unwrap_or("congregation") == "congregation"
                                && crate::keys::KeyEntry::is_congregation_output(Some(&filtered), id)
                        })
                    });
                } else {
                    *value = serde_json::Value::Array(Vec::new());
                }
            }
        }
        if let Some(results) = v
            .get_mut("groupTakeResults")
            .and_then(serde_json::Value::as_array_mut)
        {
            results.retain(|result| {
                result
                    .get("outputs")
                    .and_then(serde_json::Value::as_array)
                    .is_some_and(|outputs| {
                        !outputs.is_empty()
                            && outputs.iter().all(|output| {
                                output
                                    .get("id")
                                    .and_then(serde_json::Value::as_str)
                                    .is_some_and(|id| {
                                        reader.output_scope.iter().any(|allowed| allowed == id)
                                            && reader
                                                .group_take_scope
                                                .iter()
                                                .any(|allowed| allowed == id)
                                            && crate::keys::KeyEntry::is_congregation_output(
                                                Some(&filtered),
                                                id,
                                            )
                                    })
                            })
                    })
            });
        }
    }
    v.to_string()
}

/// What of the Live State a desk with this role does not get (see `live_for`).
fn hidden_from(role: crate::keys::Role) -> &'static [&'static str] {
    use crate::keys::Role;
    match role {
        Role::Present | Role::Configure => &[],
        Role::Bible | Role::Editor => &["readiness", "presence"],
        _ => &["readiness", "presence", "heard"],
    }
}

/// Whether a reader gets who is connected (`presence`): this computer itself, and the director.
fn sees_crew(reader: Option<&crate::keys::KeyEntry>) -> bool {
    reader.is_none_or(|r| matches!(r.role, crate::keys::Role::Present | crate::keys::Role::Configure))
}

/// Who is on the team now, for a director's board (desk consoles, #197): each paired desk's name and
/// role, whether it follows the service now and when it was last seen (null: not since hosting
/// began). Never its address or key.
fn crew_rows(keys: &KeySet, presence: &crate::presence::Presence) -> serde_json::Value {
    let seen = presence.list();
    let keys = keys.read().unwrap_or_else(std::sync::PoisonError::into_inner);
    serde_json::Value::Array(
        keys.entries
            .iter()
            .take(64)
            .map(|e| {
                let s = seen.iter().find(|d| d.hash == e.hash);
                serde_json::json!({ "name": e.name, "role": e.role.as_str(), "connected": s.is_some_and(|d| d.connected), "lastSeenMs": s.map(|d| d.last_seen_ms), "paused": e.paused })
            })
            .collect(),
    )
}

/// The Live State with who is connected added, for a reader that sees it (`sees_crew`).
fn with_crew(json: String, crew: serde_json::Value) -> String {
    match serde_json::from_str::<serde_json::Value>(&json) {
        Ok(serde_json::Value::Object(mut o)) => {
            o.insert("presence".into(), crew);
            serde_json::Value::Object(o).to_string()
        }
        _ => json,
    }
}

/// The same rule as the desks' own (src/stores/notices-store.ts `isFor`): a Present-and-settings
/// desk also gets what is sent to the Present desks. A notice without ids (from before them) is
/// only for its group.
fn notice_is_for(n: &serde_json::Value, reader: &crate::keys::KeyEntry) -> bool {
    let role = reader.role.as_str();
    let mine = |field: &str| !reader.hash.is_empty() && n.get(field).and_then(serde_json::Value::as_str).is_some_and(|id| crate::command::same_key(id, &reader.hash));
    if mine("fromId") {
        return true;
    }
    match n.get("to") {
        Some(serde_json::Value::String(to)) => to == "all" || to == role || (role == "configure" && to == "present"),
        Some(serde_json::Value::Object(_)) => mine("toId"),
        _ => false,
    }
}

#[must_use]
pub fn new_live_hub() -> SharedLive {
    Arc::new(LiveHub { current: std::sync::RwLock::new(None), tx: broadcast::channel(32).0, revisions: std::sync::Mutex::new(Revisions::default()) })
}

/// Handle to a running HTTP server. Call `stop()` to shut it down.
pub struct HttpHandle {
    shutdown_tx: Option<watch::Sender<bool>>,
}

impl HttpHandle {
    /// Signal the HTTP server to stop gracefully.
    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(true);
        }
    }

    /// Check if the handle still has a shutdown sender (server not yet stopped).
    pub fn is_active(&self) -> bool {
        self.shutdown_tx.is_some()
    }
}

impl Drop for HttpHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Result of starting the HTTP server.
pub struct HttpStartResult {
    pub handle: HttpHandle,
    pub bound_port: u16,
    /// The https port, when https is on.
    pub tls_port: Option<u16>,
}

/// Shared state for axum route handlers.
struct AppState<S: CommandSink> {
    live: SharedLive,
    feeds: SharedFeeds,
    voice: SharedVoice,
    cameras: crate::cameras::SharedCameras,
    presence: crate::presence::SharedPresence,
    /// The https port once it listens: `/api/v1/health` says it, so a joining computer pairs over it.
    tls_port: std::sync::OnceLock<u16>,
    /// True once the listener is stopping: open streams end with it (stopping hosting cuts every desk).
    stopping: watch::Receiver<bool>,
    sink: Arc<S>,
    status: Arc<tokio::sync::RwLock<StatusSnapshot>>,
    keys: KeySet,
    pairing: PairingWindow,
    rate: crate::rate::RateLimiter,
    recent: RecentIds,
    /// One command at a time from its revision check to the app: two desks pressing at once are
    /// carried out one after the other, and the second is checked against the first.
    gate: std::sync::Mutex<()>,
}

/// Snapshot of the current application state, served by `GET /api/v1/status`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StatusSnapshot {
    pub on_air: bool,
    pub active_theme: Option<String>,
    pub live_verse: Option<String>,
    pub queue_length: usize,
    pub confidence_threshold: f32,
    /// Rehearsal is on: the real screens are frozen, so a phone must not read "on air" as what people see.
    #[serde(default)]
    pub rehearsal: bool,
    /// The computer is asking whether to show an unapproved service; commands wait for that answer.
    #[serde(default)]
    pub waiting_for_approval: bool,
}

/// Shared, thread-safe status snapshot that the frontend pushes updates to.
pub type SharedStatus = Arc<tokio::sync::RwLock<StatusSnapshot>>;

/// Create a new shared status snapshot with default values.
pub fn new_shared_status() -> SharedStatus {
    Arc::new(tokio::sync::RwLock::new(StatusSnapshot::default()))
}

/// Start the HTTP API server.
///
/// Binds to `config.host:config.port` and serves the `/api/v1/` endpoints.
/// Uses `tauri::async_runtime::spawn` compatible futures (runs on the Tauri-managed Tokio runtime).
///
/// # Errors
///
/// Returns `CommandError::DispatchFailed` if the TCP listener cannot bind.
pub async fn start_http_server<S>(
    config: HttpConfig,
    sink: Arc<S>,
    status: SharedStatus,
) -> Result<HttpStartResult, CommandError>
where
    S: CommandSink + 'static,
{
    let bind_addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .map_err(|e| CommandError::DispatchFailed(format!("Invalid bind address: {e}")))?;

    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);
    let ports = Arc::new(ListenPorts::default());
    let state = Arc::new(AppState {
        stopping: shutdown_rx.clone(),
        live: config.live.clone(),
        feeds: config.feeds.clone(),
        voice: config.voice.clone(),
        cameras: config.cameras.clone(),
        presence: config.presence.clone(),
        tls_port: std::sync::OnceLock::new(),
        sink,
        status,
        keys: config.keys.clone(),
        pairing: config.pairing.clone(),
        rate: crate::rate::RateLimiter::default(),
        recent: RecentIds::default(),
        gate: std::sync::Mutex::new(()),
    });

    let app = Router::new()
        .route("/api/v1/health", get(health_handler::<S>))
        .route("/api/v1/status", get(status_handler::<S>))
        .route("/api/v1/command", post(command_handler::<S>))
        .route("/api/v1/pair", post(pair_handler::<S>))
        .route("/api/v1/me", get(me_handler::<S>))
        .route("/api/v1/live", get(live_handler::<S>))
        .route("/api/v1/live/events", get(live_events_handler::<S>))
        .route("/api/v1/lookup", post(lookup_handler::<S>))
        .route("/feed/{id}", get(feed_page_handler::<S>))
        .route("/api/v1/feed/{id}/events", get(feed_events_handler::<S>))
        .route("/api/v1/voice", post(voice_handler::<S>))
        .route("/api/v1/feed/{id}/ack", post(feed_ack_handler::<S>))
        .route("/api/v1/feed/{id}/media/{file}", get(feed_media_handler::<S>))
        .route("/assets/{*path}", get(asset_handler::<S>))
        .route("/remote", get(remote_page))
        .route("/camera", get(camera_page_handler::<S>))
        .route("/api/v1/camera/{name}/whip", post(camera_whip_handler::<S>))
        .route("/api/v1/camera/{name}/whip/{session}", axum::routing::patch(camera_session_handler::<S>).delete(camera_session_handler::<S>))
        .route("/api/v1/camera/{name}/status", post(camera_status_handler::<S>))
        .route("/api/v1/cameras/watch", get(companion_cameras_handler::<S>))
        .route("/api/v1/cameras/tally", post(companion_tally_handler::<S>))
        // Undocumented alias for the path the code shipped with before #146.
        .route("/api/v1/control", post(command_handler::<S>))
        // Rhema's own pages are served from here (same origin) and its windows call through Rust, so
        // no other web page may use this API from a browser on the network (see `same_origin_only`).
        .layer(app_cors())
        .layer(axum::middleware::from_fn_with_state(ports.clone(), same_origin_only))
        .with_state(state.clone());
    // The local CA's certificate (public): a phone installs it to trust the https page.
    let app = match config.tls.as_ref() {
        Some(t) => {
            let ca = t.ca_cert.clone();
            app.route("/rhema-ca.pem", get(move || async move { ([(axum::http::header::CONTENT_TYPE, "application/x-x509-ca-cert"), (axum::http::header::CONTENT_DISPOSITION, "attachment; filename=\"rhema-ca.pem\"")], ca) }))
        }
        None => app,
    };

    let listener = tokio::net::TcpListener::bind(bind_addr).await.map_err(|e| {
        CommandError::DispatchFailed(format!("Failed to bind HTTP on {bind_addr}: {e}"))
    })?;

    let bound_port = listener.local_addr().map(|a| a.port()).unwrap_or(config.port);
    let _ = ports.http.set(bound_port);

    let tls_port = match config.tls.as_ref() {
        Some(t) => Some(serve_tls(t, &config.host, app.clone(), shutdown_tx.subscribe()).await?),
        None => None,
    };
    if let Some(p) = tls_port {
        let _ = ports.https.set(p);
        let _ = state.tls_port.set(p);
    }

    tokio::spawn(async move {
        log::info!("HTTP API server started on {bind_addr} (port {bound_port})");

        axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
            .with_graceful_shutdown(async move {
                while !*shutdown_rx.borrow_and_update() {
                    if shutdown_rx.changed().await.is_err() {
                        break;
                    }
                }
                log::info!("HTTP API server shutting down");
            })
            .await
            .unwrap_or_else(|e| log::error!("HTTP server error: {e}"));

        log::info!("HTTP API server stopped");
    });

    Ok(HttpStartResult {
        handle: HttpHandle {
            shutdown_tx: Some(shutdown_tx),
        },
        bound_port,
        tls_port,
    })
}

/// Serve the same routes over https on the TLS port until shutdown. Each connection carries its
/// peer address, as on http, so the key checks and the loopback rule behave the same.
async fn serve_tls(t: &TlsListener, host: &str, app: Router, mut shutdown_rx: watch::Receiver<bool>) -> Result<u16, CommandError> {
    let config = crate::tls::server_config(&t.server, &t.ca_cert).map_err(|e| CommandError::DispatchFailed(format!("https: {e}")))?;
    let acceptor = tokio_rustls::TlsAcceptor::from(config);
    let addr: SocketAddr = format!("{host}:{}", t.port).parse().map_err(|e| CommandError::DispatchFailed(format!("Invalid https address: {e}")))?;
    let listener = tokio::net::TcpListener::bind(addr).await.map_err(|e| CommandError::DispatchFailed(format!("Failed to bind https on {addr}: {e}")))?;
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(t.port);
    tokio::spawn(async move {
        log::info!("HTTPS (phone pages) on {addr} (port {port})");
        loop {
            let (stream, peer) = tokio::select! {
                r = listener.accept() => match r { Ok(x) => x, Err(_) => continue },
                _ = shutdown_rx.changed() => break,
            };
            let acceptor = acceptor.clone();
            let app = app.clone();
            tokio::spawn(async move {
                // A slow or failed handshake costs only its own task.
                let Ok(Ok(tls)) = tokio::time::timeout(std::time::Duration::from_secs(10), acceptor.accept(stream)).await else { return };
                let svc = tower::ServiceBuilder::new()
                    .map_request(move |mut req: axum::http::Request<hyper::body::Incoming>| {
                        req.extensions_mut().insert(ConnectInfo(peer));
                        req
                    })
                    .service(app);
                let _ = hyper_util::server::conn::auto::Builder::new(hyper_util::rt::TokioExecutor::new())
                    .serve_connection_with_upgrades(hyper_util::rt::TokioIo::new(tls), hyper_util::service::TowerToHyperService::new(svc))
                    .await;
            });
        }
        log::info!("HTTPS (phone pages) stopped");
    });
    Ok(port)
}

// --- Route handlers ---

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    version: String,
    /// The https port when this host runs it: a joining computer pairs and works over it, with this
    /// host's certificate pinned (absent: http only).
    #[serde(skip_serializing_if = "Option::is_none")]
    tls_port: Option<u16>,
}

static APP_VERSION: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// The app's version for `/api/v1/health` (this crate's own version is not the app's).
pub fn set_app_version(version: &str) {
    let _ = APP_VERSION.set(version.to_string());
}

/// The local-network health answer; public-source requests are refused.
async fn health_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
) -> axum::response::Response {
    if !is_local_network_ip(peer.ip()) {
        return StatusCode::FORBIDDEN.into_response();
    }
    Json(HealthResponse {
        status: "ok",
        service: "rhema",
        version: APP_VERSION.get().cloned().unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string()),
        tls_port: state.tls_port.get().copied(),
    })
    .into_response()
}

/// The origins of Rhema's own windows (Tauri's web view on macOS/Linux and on Windows).
const APP_ORIGINS: [&str; 3] = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"];

/// Whether a browser request from `origin` may use this API: Rhema's own windows, or a page this
/// listener served itself (the phone remote, camera and feed pages, a TV's feed), whose origin is
/// the address it was asked for (`host`). Any other web page open in a browser on the network is not.
fn origin_allowed(origin: &str, host: Option<&str>) -> bool {
    if APP_ORIGINS.iter().any(|o| o.eq_ignore_ascii_case(origin)) {
        return true;
    }
    let origin = origin.to_ascii_lowercase();
    let authority = origin.strip_prefix("http://").or_else(|| origin.strip_prefix("https://"));
    match (authority, host) {
        (Some(a), Some(h)) => !a.is_empty() && !a.contains('/') && a.eq_ignore_ascii_case(h.trim()),
        _ => false,
    }
}

/// CORS for Rhema's own windows only; a page this listener served needs none (same origin).
fn app_cors() -> CorsLayer {
    use axum::http::{header, HeaderName, HeaderValue, Method};
    CorsLayer::new()
        .allow_origin(AllowOrigin::list(APP_ORIGINS.iter().map(|o| HeaderValue::from_static(o))))
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION, HeaderName::from_static("x-rhema-key")])
}

/// The ports this server listens on, once bound: a `Host` must name one of them.
#[derive(Debug, Default)]
struct ListenPorts {
    http: std::sync::OnceLock<u16>,
    https: std::sync::OnceLock<u16>,
}

/// Whether a request's `Host` names this computer the way a page of ours can be reached: an IP
/// address (v4, or v6 in brackets), `localhost`, or a `.local` name (this computer's mDNS name), on
/// one of this server's ports. Any other name is refused: DNS rebinding points an attacker's own
/// name (evil.example) at this computer's address, and then its page's origin and the `Host` match.
/// A missing port is the scheme's default (80 / 443), which this server never listens on.
fn host_trusted(host: &str, ports: &[u16]) -> bool {
    let host = host.trim();
    let (name, port) = if let Some(rest) = host.strip_prefix('[') {
        let Some((v6, after)) = rest.split_once(']') else { return false };
        if v6.parse::<std::net::Ipv6Addr>().is_err() {
            return false;
        }
        (None, after.strip_prefix(':'))
    } else {
        match host.rsplit_once(':') {
            Some((n, p)) => (Some(n), Some(p)),
            None => (Some(host), None),
        }
    };
    let port: Option<u16> = match port {
        Some(p) => match p.parse() {
            Ok(p) => Some(p),
            Err(_) => return false,
        },
        None => None,
    };
    let name_ok = match name {
        None => true,
        Some(n) => {
            let n = n.to_ascii_lowercase();
            n.parse::<std::net::Ipv4Addr>().is_ok()
                || n == "localhost"
                || (n.len() > ".local".len() && n.ends_with(".local") && n.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.'))
        }
    };
    name_ok && port.is_some_and(|p| ports.contains(&p))
}

/// The pages a browser opens from this server (phone remote, camera, feeds) and what they load,
/// and the two answers that need no key (status: what is on air; health): their `Host` is checked
/// even without an `Origin`, since a rebound page's same-origin read sends none.
fn browser_page(path: &str) -> bool {
    matches!(path, "/remote" | "/camera" | "/api/v1/status" | "/api/v1/health") || ["/feed/", "/assets/", "/api/v1/feed/", "/api/v1/camera/"].iter().any(|p| path.starts_with(p))
}

/// Refuse a request a browser sent for another web page: its `Origin` is neither this listener's
/// own address nor Rhema Studio's window, or it reached us under a name that is not ours (DNS
/// rebinding, `host_trusted`). A browser always says the origin of a cross-site request that could
/// change something, so this also stops the ones CORS would let through unasked (a form's plain
/// POST). The pages a browser opens from here are checked by name always. Controllers that are not
/// browsers (Companion, Stream Deck, OSC bridges) send no origin and are checked by their key.
async fn same_origin_only(AxumState(ports): AxumState<Arc<ListenPorts>>, req: axum::extract::Request, next: axum::middleware::Next) -> axum::response::Response {
    let origin = req.headers().get(axum::http::header::ORIGIN).cloned();
    let host = req.headers().get(axum::http::header::HOST).and_then(|h| h.to_str().ok()).map(str::to_string).or_else(|| req.uri().authority().map(|a| a.as_str().to_string()));
    if origin.is_some() || browser_page(req.uri().path()) {
        let listening: Vec<u16> = [ports.http.get(), ports.https.get()].into_iter().flatten().copied().collect();
        if !host.as_deref().is_some_and(|h| host_trusted(h, &listening)) {
            log::warn!("HTTP request refused: asked for under another name ({host:?})");
            return (StatusCode::MISDIRECTED_REQUEST, "Rhema Studio answers only at this computer's own address").into_response();
        }
    }
    if let Some(origin) = origin {
        if !origin.to_str().is_ok_and(|o| origin_allowed(o, host.as_deref())) {
            log::warn!("HTTP request refused: from another web page ({origin:?})");
            return (StatusCode::FORBIDDEN, "Rhema Studio answers only its own pages and windows").into_response();
        }
    }
    next.run(req).await
}

/// The phone remote: one self-contained page (pair, then Next/Previous/
/// Back on air/Clear with the device's own token). Static, so serving it
/// needs no key; every command it sends is checked like any other.
async fn remote_page() -> impl IntoResponse {
    (
        [
            (axum::http::header::CACHE_CONTROL, "no-store"),
            (axum::http::header::X_FRAME_OPTIONS, "DENY"),
            (axum::http::header::CONTENT_SECURITY_POLICY, "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'"),
        ],
        axum::response::Html(include_str!("remote.html")),
    )
}

/// The current display status for local-network pages; public-source requests are refused.
async fn status_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
) -> axum::response::Response {
    if !is_local_network_ip(peer.ip()) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let snapshot = state.status.read().await;
    Json(snapshot.clone()).into_response()
}

#[derive(Deserialize)]
struct CommandRequest {
    #[serde(flatten)]
    command: RemoteCommand,
    /// One id per press (FR-04 idempotent): a retry of the same press is acknowledged, not repeated.
    #[serde(default)]
    id: Option<String>,
    /// The service the sending desk is looking at (#246 C16; "" for none). Absent (the phone page,
    /// older desks, scripts) = accepted as before.
    #[serde(default)]
    service: Option<String>,
    /// The revisions in the Live State the desk acted on (#196 R7): a command for a part of the
    /// service that has changed since is refused. Absent (the phone page, older desks, scripts) =
    /// not checked, as before.
    #[serde(default)]
    seen: Option<std::collections::HashMap<String, u64>>,
    /// An Unable answer's reason (Rhema Comms, #251): what the desk could not do and why, for
    /// whoever sent the notice. Beside the command, so an older host simply ignores it.
    #[serde(default)]
    why: Option<String>,
}

/// What a desk looking at another service is told; it refreshes its Live State.
const OTHER_SERVICE_MESSAGE: &str = "That desk is looking at a different service; it will refresh";
/// What a desk acting on what it saw is told when someone changed that part of the service first.
pub const STALE_MESSAGE: &str = "Someone changed this first \u{2014} look again";

/// Command ids seen recently, so an exact retry is not carried out twice and a reused id is refused.
#[derive(Default)]
struct RecentIds(std::sync::Mutex<std::collections::VecDeque<(String, String, std::time::Instant)>>);

#[derive(Debug, PartialEq, Eq)]
enum RecentIdStatus {
    New,
    Replay,
    Conflict,
}

impl RecentIds {
    const KEEP: std::time::Duration = std::time::Duration::from_secs(60);
    const MAX: usize = 256;

    /// Check whether this is a first request, an exact retry, or a conflicting reuse.
    fn status(&self, id: &str, fingerprint: &str) -> RecentIdStatus {
        let mut seen = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let now = std::time::Instant::now();
        while seen
            .front()
            .is_some_and(|(_, _, at)| now.duration_since(*at) > Self::KEEP)
        {
            seen.pop_front();
        }
        seen.iter()
            .find(|(saved, _, _)| saved == id)
            .map_or(RecentIdStatus::New, |(_, saved_fingerprint, _)| {
                if saved_fingerprint == fingerprint {
                    RecentIdStatus::Replay
                } else {
                    RecentIdStatus::Conflict
                }
            })
    }

    /// Remember a successfully dispatched id and its complete request identity.
    fn record(&self, id: &str, fingerprint: &str) {
        let mut seen = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let now = std::time::Instant::now();
        while seen
            .front().is_some_and(|(_, _, at)| now.duration_since(*at) > Self::KEEP)
        {
            seen.pop_front();
        }
        if let Some(index) = seen.iter().position(|(saved, _, _)| saved == id) {
            seen.remove(index);
        }
        while seen.len() >= Self::MAX {
            seen.pop_front();
        }
        seen.push_back((id.to_string(), fingerprint.to_string(), now));
    }
}

fn command_fingerprint(
    command: &RemoteCommand,
    by: &str,
    by_id: Option<&str>,
    service: Option<&str>,
    seen: Option<&std::collections::HashMap<String, u64>>,
    why: Option<&str>,
) -> String {
    use sha2::Digest;
    let seen = seen.map(|revisions| {
        revisions
            .iter()
            .map(|(part, revision)| (part.clone(), *revision))
            .collect::<std::collections::BTreeMap<_, _>>()
    });
    let payload = serde_json::to_vec(&(by, by_id, service, seen, command, why)).unwrap_or_default();
    sha2::Sha256::digest(payload)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[derive(Serialize, Default)]
struct CommandResponse {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    /// Which refusal it is, for a desk to act on: "stale" (someone changed it first: look again),
    /// "other-service" (refresh), and for a scene change "role" or "bad-scene".
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'static str>,
    /// A note on a command that was taken (a scene change sent to the main desk to accept).
    #[serde(skip_serializing_if = "Option::is_none")]
    note: Option<String>,
}

impl CommandResponse {
    fn refused(error: impl Into<String>) -> Json<Self> {
        Json(Self { success: false, error: Some(error.into()), ..Default::default() })
    }
}

/// Whether the host is in rehearsal, from its Live State (false before it has said).
fn in_rehearsal(live: Option<&str>) -> bool {
    live.and_then(|j| serde_json::from_str::<serde_json::Value>(j).ok()).and_then(|v| v.get("program")?.get("rehearsal")?.as_bool()) == Some(true)
}

/// Whether a song or hymn is on the screens (the host's Live State says which, desk consoles).
fn lyrics_up(live: Option<&str>) -> bool {
    live.and_then(|j| serde_json::from_str::<serde_json::Value>(j).ok()).is_some_and(|v| v.get("lyrics").is_some_and(|l| l.is_object()))
}

const NO_LYRICS_MESSAGE: &str = "No song or hymn is on the screens";

/// What an OBS director is told in rehearsal: OBS is the online stream (the host's own wording).
const OBS_REHEARSAL_MESSAGE: &str = "Rehearsal is on: OBS is the live stream, so Rhema Studio doesn't change it while you practise";

#[derive(Deserialize)]
struct PairRequest {
    code: String,
    #[serde(default)]
    name: String,
    /// A role that can do less than Present ("obs-companion", #209); anything else pairs as Present.
    #[serde(default)]
    role: Option<String>,
}

#[derive(Serialize)]
struct PairResponse {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// `POST /api/v1/pair {"code":"123456","name":"Tolu's phone"}` on the local network while
/// the operator has the pairing window open. The token comes back exactly once.
async fn pair_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(req): Json<PairRequest>,
) -> impl IntoResponse {
    if !is_local_network_ip(peer.ip()) {
        return (StatusCode::FORBIDDEN, Json(PairResponse { success: false, token: None, name: None, error: Some("pairing is available only on the local network".into()) }));
    }
    if !state.rate.allow(peer.ip()) {
        return (StatusCode::TOO_MANY_REQUESTS, Json(PairResponse { success: false, token: None, name: None, error: Some("too many requests; slow down".into()) }));
    }
    match try_pair_as(&state.pairing, &state.keys, &req.code, &req.name, req.role.as_deref()) {
        PairOutcome::Paired { token, entry } => {
            let payload = serde_json::json!({ "name": entry.name, "hash": entry.hash, "role": entry.role }).to_string();
            if let Err(e) = state.sink.emit_event("remote:paired", &payload) {
                // The app would never list it, so it could never be revoked: take it back and let the device retry.
                log::warn!("pairing event not delivered, token withdrawn: {e}");
                state.keys.write().unwrap_or_else(std::sync::PoisonError::into_inner).entries.retain(|k| k.hash != entry.hash);
                return (StatusCode::INTERNAL_SERVER_ERROR, Json(PairResponse { success: false, token: None, name: None, error: Some("the app did not record the device; try again".into()) }));
            }
            let _ = state.sink.emit_event("remote:pair_closed", "{}");
            (StatusCode::OK, Json(PairResponse { success: true, token: Some(token), name: Some(entry.name), error: None }))
        }
        PairOutcome::NotOpen => (StatusCode::NOT_FOUND, Json(PairResponse { success: false, token: None, name: None, error: Some("pairing is not open; press Pair a device in Settings".into()) })),
        PairOutcome::WrongCode { attempts_left } => {
            if attempts_left == 0 {
                let _ = state.sink.emit_event("remote:pair_closed", "{}");
            }
            (StatusCode::FORBIDDEN, Json(PairResponse { success: false, token: None, name: None, error: Some(format!("wrong code, {attempts_left} tries left")) }))
        }
    }
}

/// Who may read the Live State: a paired device. With keys off ("open"), only this computer
/// itself, since the Live State holds the service plan and private stage notes.
/// A paused desk still reads it: it sees what is happening while the main desk has control.
fn live_reader<S: CommandSink>(state: &AppState<S>, peer: SocketAddr, headers: &HeaderMap) -> Result<crate::keys::KeyEntry, StatusCode> {
    if !state.rate.allow(peer.ip()) {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    match check_key(&state.keys, presented_key(headers)) {
        Ok(Some(entry)) => {
            state.presence.saw(&entry, peer.ip());
            Ok(entry)
        }
        Ok(None) if peer.ip().is_loopback() => Ok(crate::keys::KeyEntry {
            hash: String::new(),
            name: "This computer".into(),
            role: crate::keys::Role::Configure,
            paused: false,
            output_scope: Vec::new(),
            group_take_scope: Vec::new(),
            record: false,
        }),
        Ok(None) => Err(StatusCode::FORBIDDEN),
        Err(_) => Err(StatusCode::UNAUTHORIZED),
    }
}

/// Whose notices a Live State reader gets: `None` for this computer itself (keys off, the main
/// desk), which sees every notice; otherwise the paired key.
fn notice_reader(entry: crate::keys::KeyEntry) -> Option<crate::keys::KeyEntry> {
    (!entry.hash.is_empty()).then_some(entry)
}

/// `GET /api/v1/me`: the name and role this key has, and whether the main desk has taken back
/// control, so a joined desk shows what it may do.
async fn me_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> axum::response::Response {
    match live_reader(&state, peer, &headers) {
        Ok(e) => {
            let live = state.live.current();
            let output_scope = if e.role == crate::keys::Role::Screens {
                serde_json::json!(e
                    .output_scope
                    .iter()
                    .filter(|id| crate::keys::KeyEntry::is_congregation_output(live.as_deref(), id))
                    .cloned()
                    .collect::<Vec<_>>())
            } else {
                serde_json::Value::Null
            };
            let group_take_scope = if e.role == crate::keys::Role::Screens {
                serde_json::json!(e
                    .group_take_scope
                    .iter()
                    .filter(|id| e.output_scope.contains(id)
                        && crate::keys::KeyEntry::is_congregation_output(live.as_deref(), id))
                    .cloned()
                    .collect::<Vec<_>>())
            } else {
                serde_json::Value::Null
            };
            Json(serde_json::json!({ "name": e.name, "role": e.role, "paused": e.paused, "outputScope": output_scope, "groupTakeScope": group_take_scope })).into_response()
        }
        Err(code) => code.into_response(),
    }
}

/// `GET /api/v1/live`: the host's Live State now (204 before the app has published one).
async fn live_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> axum::response::Response {
    let reader = match live_reader(&state, peer, &headers) {
        Ok(entry) => notice_reader(entry),
        Err(code) => return code.into_response(),
    };
    match state.live.current() {
        Some(json) => {
            let mut data = live_for(&json, reader.as_ref());
            if sees_crew(reader.as_ref()) {
                data = with_crew(data, crew_rows(&state.keys, &state.presence));
            }
            ([(axum::http::header::CONTENT_TYPE, "application/json"), (axum::http::header::CACHE_CONTROL, "no-store")], data).into_response()
        }
        None => StatusCode::NO_CONTENT.into_response(),
    }
}

/// Whether the key a stream was opened with still reads the Live State exactly as then: still
/// listed with the same name, role and control (this computer itself: keys still off). Revoking,
/// pausing or changing a desk's role ends its stream at once; a desk that may still read connects
/// again and is served by what it is now.
fn still_reads(keys: &KeySet, entry: &crate::keys::KeyEntry) -> bool {
    let keys = keys.read().unwrap_or_else(std::sync::PoisonError::into_inner);
    if entry.hash.is_empty() {
        return !keys.require_auth;
    }
    keys.require_auth && keys.entries.iter().any(|e| e == entry)
}

/// Resolves once the listener is stopping: a stream that would otherwise never end ends with it.
fn until_stopped(mut stopping: watch::Receiver<bool>) -> impl std::future::Future<Output = ()> {
    async move {
        while !*stopping.borrow_and_update() {
            if stopping.changed().await.is_err() {
                break;
            }
        }
    }
}

/// How often an open stream looks whether its key changed (revoked, paused, another role).
const KEY_CHECK: std::time::Duration = std::time::Duration::from_millis(250);

/// One open Live State stream: what it follows and who it is for.
struct LiveStream {
    rx: broadcast::Receiver<String>,
    first: Option<String>,
    entry: crate::keys::KeyEntry,
    keys: KeySet,
    /// Who is connected, for a director's board (`sees_crew`).
    presence: crate::presence::SharedPresence,
    tick: tokio::time::Interval,
    /// Counts the desk as connected (Production → Operators) until the stream ends.
    _connected: Option<crate::presence::StreamGuard>,
}

/// `GET /api/v1/live/events`: the Live State as server-sent events, the current one first, then
/// each change; a comment every 15 s keeps the connection open through idle routers. When the
/// desk's key changes (revoked, paused, given another role) the stream says `rejoin` and ends.
async fn live_events_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> axum::response::Response {
    let entry = match live_reader(&state, peer, &headers) {
        Ok(entry) => entry,
        Err(code) => return code.into_response(),
    };
    // Production → Cameras names a desk that watches a camera from this address (#209).
    if !entry.hash.is_empty() {
        state.cameras.saw_desk(peer.ip(), &entry.name);
    }
    let mut tick = tokio::time::interval(KEY_CHECK);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let open = LiveStream { rx: state.live.tx.subscribe(), first: state.live.current(), _connected: state.presence.stream_opened(&entry, peer.ip()), entry, keys: state.keys.clone(), presence: state.presence.clone(), tick };
    let stream = futures_util::stream::unfold(Some(open), |open| async move {
        let mut s = open?;
        let reader = notice_reader(s.entry.clone());
        let crew = sees_crew(reader.as_ref());
        let shape = |json: &str, keys: &KeySet, presence: &crate::presence::Presence| {
            let data = live_for(json, reader.as_ref());
            if crew { with_crew(data, crew_rows(keys, presence)) } else { data }
        };
        if let Some(json) = s.first.take() {
            let data = shape(&json, &s.keys, &s.presence);
            return Some((Ok::<_, std::convert::Infallible>(Event::default().event("live").data(data)), Some(s)));
        }
        loop {
            tokio::select! {
                r = s.rx.recv() => match r {
                    Ok(json) => {
                        let data = shape(&json, &s.keys, &s.presence);
                        return Some((Ok(Event::default().event("live").data(data)), Some(s)));
                    }
                    // Slow reader: skip to the newest; the next message is the whole state anyway.
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => return None,
                },
                _ = s.tick.tick() => {
                    if !still_reads(&s.keys, &s.entry) {
                        log::info!("Live State stream for {} ended: its key changed", s.entry.name);
                        // The last message; the stream (and the desk's place in Operators) ends with it.
                        return Some((Ok(Event::default().event("rejoin").data("the host changed this desk")), None));
                    }
                }
            }
        }
    });
    let stream = futures_util::StreamExt::take_until(stream, until_stopped(state.stopping.clone()));
    Sse::new(stream).keep_alive(KeepAlive::new().interval(std::time::Duration::from_secs(15))).into_response()
}

/// `POST /api/v1/lookup {"what": …}`: a joined desk looks something up in this computer's library
/// (desk consoles, #197): Bible translations, a chapter, a words search, songs and hymns. A paired
/// key whose role works with that content (`crate::lookup`); read only, so a paused desk may too.
async fn lookup_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(asked): Json<crate::lookup::Lookup>,
) -> axum::response::Response {
    let entry = match live_reader(&state, peer, &headers) {
        Ok(entry) => entry,
        Err(code) => return code.into_response(),
    };
    if !asked.allowed(entry.role) {
        log::info!("Lookup from {} refused: its role", entry.name);
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": crate::lookup::refusal(&asked) }))).into_response();
    }
    let Some(asked) = asked.checked() else {
        return (StatusCode::UNPROCESSABLE_ENTITY, Json(serde_json::json!({ "error": "Type a little more to look up" }))).into_response();
    };
    let sink = state.sink.clone();
    match tokio::task::spawn_blocking(move || sink.lookup(&asked)).await {
        Ok(Ok(v)) => ([(axum::http::header::CACHE_CONTROL, "no-store")], Json(v)).into_response(),
        Ok(Err(why)) => (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({ "error": why }))).into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

type Query = axum::extract::Query<std::collections::HashMap<String, String>>;

/// An OBS companion's key (#209): paired as one, and not paused. A paused companion is told so
/// (423), as a paused desk is; any other desk is refused.
fn companion_key<S: CommandSink>(state: &AppState<S>, peer: SocketAddr, headers: &HeaderMap) -> Result<crate::keys::KeyEntry, (StatusCode, &'static str)> {
    if !state.rate.allow(peer.ip()) {
        return Err((StatusCode::TOO_MANY_REQUESTS, "too many requests; slow down"));
    }
    let key = check_key(&state.keys, presented_key(headers));
    if let Ok(Some(e)) = &key {
        state.presence.saw(e, peer.ip());
    }
    match key {
        Ok(Some(e)) if e.role != crate::keys::Role::ObsCompanion => Err((StatusCode::FORBIDDEN, "This computer is not an OBS companion of this host. On the host: Settings → Remote control, set its role to OBS companion.")),
        Ok(Some(e)) if e.paused => Err((StatusCode::LOCKED, crate::keys::PAUSED_MESSAGE)),
        Ok(Some(e)) => Ok(e),
        Ok(None) | Err(_) => Err((StatusCode::UNAUTHORIZED, "The host no longer knows this computer: pair again")),
    }
}

/// `GET /api/v1/cameras/watch`: the church's cameras for an OBS companion (#209), and its own way
/// to read them while the camera router runs.
async fn companion_cameras_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> axum::response::Response {
    match companion_key(&state, peer, &headers) {
        Ok(e) => ([(axum::http::header::CACHE_CONTROL, "no-store")], Json(state.cameras.companion_view(&e.hash))).into_response(),
        Err((code, why)) => (code, Json(serde_json::json!({ "error": why }))).into_response(),
    }
}

/// `POST /api/v1/cameras/tally {"program":[…],"preview":[…],"receiving":[…]}`: which cameras are on
/// an OBS companion's program and preview, and which its OBS plays, for Production → Cameras.
async fn companion_tally_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(tally): Json<crate::cameras::Tally>,
) -> axum::response::Response {
    match companion_key(&state, peer, &headers) {
        Ok(e) if state.cameras.set_tally(&e.hash, tally) => StatusCode::NO_CONTENT.into_response(),
        // Paired a moment ago: the app has not made its reader yet.
        Ok(_) => (StatusCode::CONFLICT, Json(serde_json::json!({ "error": "The host is still setting this computer up; try again in a moment" }))).into_response(),
        Err((code, why)) => (code, Json(serde_json::json!({ "error": why }))).into_response(),
    }
}

/// `GET /feed/{id}?k=<secret>`: the browser feed page (the app's own `feed.html`).
async fn feed_page_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    axum::extract::Path(id): axum::extract::Path<String>,
    axum::extract::Query(q): Query,
) -> axum::response::Response {
    if !state.rate.allow(peer.ip()) {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    if !state.feeds.knows(&id, q.get("k").map_or("", String::as_str)) {
        return (StatusCode::FORBIDDEN, "This feed's link is not valid (copy it again from Rhema Studio → Outputs).").into_response();
    }
    match state.sink.asset("feed.html") {
        Some((bytes, _)) => ([(axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8"), (axum::http::header::CACHE_CONTROL, "no-store")], bytes).into_response(),
        None => (StatusCode::NOT_FOUND, "The feed page is not in this build.").into_response(),
    }
}

/// A media folder video's name (`<sha256 hex>.<ext>`) and its type; anything else is never served.
fn media_video(file: &str) -> Option<&'static str> {
    let (hash, ext) = file.split_once('.')?;
    if hash.len() != 64 || !hash.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        return None;
    }
    Some(match ext {
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        _ => return None,
    })
}

/// The bytes asked for by a `Range: bytes=…` header of a file `len` long, at most `MEDIA_CHUNK` of them;
/// None: the whole file; Err: a range outside the file.
fn byte_range(header: Option<&str>, len: u64) -> Result<Option<(u64, u64)>, ()> {
    let Some(spec) = header.and_then(|h| h.trim().strip_prefix("bytes=")) else {
        return Ok(None);
    };
    // One range only (a player asks for one); a list is answered with its first.
    let spec = spec.split(',').next().unwrap_or("").trim();
    let (a, b) = spec.split_once('-').ok_or(())?;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", "") => return Err(()),
        ("", n) => {
            let n: u64 = n.parse().map_err(|_| ())?;
            (len.saturating_sub(n), len.saturating_sub(1))
        }
        (s, "") => (s.parse().map_err(|_| ())?, len.saturating_sub(1)),
        (s, e) => (s.parse().map_err(|_| ())?, e.parse::<u64>().map_err(|_| ())?.min(len.saturating_sub(1))),
    };
    if len == 0 || start >= len || end < start {
        return Err(());
    }
    Ok(Some((start, end.min(start + MEDIA_CHUNK - 1))))
}

/// The most bytes one range answer carries; the player asks again for the rest.
const MEDIA_CHUNK: u64 = 4 * 1024 * 1024;

/// `GET /api/v1/feed/{id}/media/{file}?k=<secret>`: a video a scene on this feed shows, for its page
/// to play (#243 SC.9). Only with the feed's secret, only a file its current frame names, and in
/// ranges, so a TV can start and loop it without the whole file at once.
async fn feed_media_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    axum::extract::Path((id, file)): axum::extract::Path<(String, String)>,
    axum::extract::Query(q): Query,
    headers: HeaderMap,
) -> axum::response::Response {
    use axum::http::header;
    use tokio::io::{AsyncReadExt, AsyncSeekExt};
    let Some(mime) = media_video(&file) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !state.feeds.shows_file(&id, q.get("k").map_or("", String::as_str), &file) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Some(path) = state.sink.media_file(&file) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(mut f) = tokio::fs::File::open(&path).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(len) = f.metadata().await.map(|m| m.len()) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let common = [(header::CONTENT_TYPE, mime.to_string()), (header::ACCEPT_RANGES, "bytes".to_string()), (header::CACHE_CONTROL, "no-store".to_string())];
    match byte_range(headers.get(header::RANGE).and_then(|v| v.to_str().ok()), len) {
        Err(()) => (StatusCode::RANGE_NOT_SATISFIABLE, [(header::CONTENT_RANGE, format!("bytes */{len}"))]).into_response(),
        Ok(Some((start, end))) => {
            let mut buf = vec![0u8; usize::try_from(end - start + 1).unwrap_or(0)];
            if f.seek(std::io::SeekFrom::Start(start)).await.is_err() || f.read_exact(&mut buf).await.is_err() {
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
            (StatusCode::PARTIAL_CONTENT, common, [(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))], buf).into_response()
        }
        Ok(None) => {
            // The whole file, read as it is sent.
            let stream = futures_util::stream::unfold(f, |mut f| async move {
                let mut buf = vec![0u8; 64 * 1024];
                match f.read(&mut buf).await {
                    Ok(0) | Err(_) => None,
                    Ok(n) => {
                        buf.truncate(n);
                        Some((Ok::<_, std::io::Error>(axum::body::Bytes::from(buf)), f))
                    }
                }
            });
            (common, [(header::CONTENT_LENGTH, len.to_string())], axum::body::Body::from_stream(stream)).into_response()
        }
    }
}

/// `GET /assets/…`: the feed page's scripts, styles and fonts (built code only, no data).
async fn asset_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    axum::extract::Path(path): axum::extract::Path<String>,
) -> axum::response::Response {
    if path.contains("..") {
        return StatusCode::NOT_FOUND.into_response();
    }
    match state.sink.asset(&format!("assets/{path}")) {
        Some((bytes, mime)) => ([(axum::http::header::CONTENT_TYPE, mime), (axum::http::header::CACHE_CONTROL, "public, max-age=3600".to_string())], bytes).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// `GET /camera?name=<camera>&k=<secret>`: the camera page a phone opens to send its camera to the
/// router (#209). It works only on the https port, where the browser lets a page use the camera.
async fn camera_page_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    axum::extract::Query(q): Query,
) -> axum::response::Response {
    if !state.rate.allow(peer.ip()) {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    let (name, k) = (q.get("name").map_or("", String::as_str), q.get("k").map_or("", String::as_str));
    if !state.cameras.knows(name, k) {
        return (StatusCode::FORBIDDEN, "This camera link is not valid. Scan it again from Rhema Studio: Production, Cameras.").into_response();
    }
    (
        [
            (axum::http::header::CACHE_CONTROL, "no-store"),
            (axum::http::header::X_FRAME_OPTIONS, "DENY"),
            (axum::http::header::CONTENT_SECURITY_POLICY, "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; media-src 'self' blob: mediastream:; form-action 'none'; frame-ancestors 'none'"),
            (axum::http::header::HeaderName::from_static("permissions-policy"), "camera=(self), microphone=(self)"),
        ],
        axum::response::Html(include_str!("camera.html")),
    )
        .into_response()
}

/// The camera's secret (`?k=`) for its WHIP requests; refused without it.
fn camera_allowed<S: CommandSink>(state: &AppState<S>, peer: SocketAddr, name: &str, q: &std::collections::HashMap<String, String>) -> Result<(), StatusCode> {
    if !state.rate.allow(peer.ip()) {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    if state.cameras.knows(name, q.get("k").map_or("", String::as_str)) { Ok(()) } else { Err(StatusCode::FORBIDDEN) }
}

/// `POST /api/v1/camera/{name}/whip?k=<secret>`: the camera page's WHIP offer, passed to the router.
async fn camera_whip_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    axum::extract::Path(name): axum::extract::Path<String>,
    axum::extract::Query(q): Query,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> axum::response::Response {
    if let Err(code) = camera_allowed(&state, peer, &name, &q) {
        return code.into_response();
    }
    state.cameras.forward(axum::http::Method::POST, &name, None, &headers, body).await
}

/// `POST /api/v1/camera/{name}/status` with `Authorization: Bearer <the camera's secret>`: Rhema
/// Studio Cam's battery and heat, every 30 s while it sends (#213). The secret goes in a header,
/// never in the address (addresses end up in logs).
async fn camera_status_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    axum::extract::Path(name): axum::extract::Path<String>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> axum::response::Response {
    if !state.rate.allow(peer.ip()) {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    let token = headers.get(axum::http::header::AUTHORIZATION).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).unwrap_or("").trim();
    if body.len() > 4096 {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    }
    let Ok(status) = serde_json::from_slice::<crate::cameras::PhoneStatus>(&body) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if state.cameras.set_phone(&name, token, status) { StatusCode::NO_CONTENT.into_response() } else { StatusCode::FORBIDDEN.into_response() }
}

/// `PATCH` (more ICE candidates) and `DELETE` (hang up) on a camera's WHIP session.
async fn camera_session_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    method: axum::http::Method,
    axum::extract::Path((name, session)): axum::extract::Path<(String, String)>,
    axum::extract::Query(q): Query,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> axum::response::Response {
    if let Err(code) = camera_allowed(&state, peer, &name, &q) {
        return code.into_response();
    }
    state.cameras.forward(method, &name, Some(&session), &headers, body).await
}

#[derive(Deserialize)]
struct VoiceOffer {
    sdp: String,
}

/// `POST /api/v1/voice`: a paired desk joins the talk channel (Rhema Comms C3, ADR 0002). Its
/// complete WebRTC offer goes to the host window, which answers within ten seconds; the answer is
/// this request's reply. The host stamps who it is from the key: its name for people to read, and
/// its key id (`byId`), by which the talk channel routes a private call (#251), never by the name.
async fn voice_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(offer): Json<VoiceOffer>,
) -> axum::response::Response {
    if !state.rate.allow(peer.ip()) {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    // The talk channel stays open to a paused desk: only its commands wait.
    let who = match live_reader(&state, peer, &headers) {
        Ok(who) => who,
        Err(code) => return code.into_response(),
    };
    if offer.sdp.len() > 64 * 1024 || !offer.sdp.starts_with("v=0") {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let id = uuid::Uuid::new_v4().to_string();
    let rx = state.voice.wait(&id);
    if state.sink.emit_event("remote:voice_offer", &serde_json::json!({ "id": id, "by": who.name, "byId": who.hash, "sdp": offer.sdp }).to_string()).is_err() {
        state.voice.forget(&id);
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    match tokio::time::timeout(std::time::Duration::from_secs(10), rx).await {
        Ok(Ok(sdp)) => Json(serde_json::json!({ "sdp": sdp })).into_response(),
        _ => {
            state.voice.forget(&id);
            (StatusCode::GATEWAY_TIMEOUT, Json(serde_json::json!({ "error": "The host did not answer. Is Rhema Studio open there?" }))).into_response()
        }
    }
}

#[derive(Deserialize)]
struct FeedAck {
    seq: u64,
    /// The cameras the page plays, sent every few seconds while it plays any (#213); absent from older pages.
    #[serde(default)]
    video: Option<Vec<crate::feed_video::CameraPlayback>>,
    /// The page's clock minus the host's (ms), from the host's beats (#196); absent from older pages.
    #[serde(default)]
    clock: Option<i64>,
}

/// `POST /api/v1/feed/{id}/ack?k=<secret>`: the page drew frame `seq` (receiver trust).
async fn feed_ack_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    axum::extract::Path(id): axum::extract::Path<String>,
    axum::extract::Query(q): Query,
    Json(ack): Json<FeedAck>,
) -> StatusCode {
    if !state.rate.allow(peer.ip()) {
        return StatusCode::TOO_MANY_REQUESTS;
    }
    match state.feeds.ack(&id, q.get("k").map_or("", String::as_str), ack.seq, ack.video.map(|v| (peer.ip(), v)), ack.clock.map(|c| c.clamp(-86_400_000, 86_400_000))) {
        Err(()) => StatusCode::FORBIDDEN,
        Ok(first) => {
            // The first page to draw a new frame: the app logs which screen showed what, and how soon
            // (#246 C17). Once per frame; the app keeps only content changes.
            if let Some(after_ms) = first {
                let _ = state.sink.emit_event("feed:acked", &serde_json::json!({ "id": id, "seq": ack.seq, "afterMs": after_ms }).to_string());
            }
            StatusCode::NO_CONTENT
        }
    }
}

/// `GET /api/v1/feed/{id}/events?k=<secret>`: the feed's frames as server-sent events.
async fn feed_events_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    axum::extract::Path(id): axum::extract::Path<String>,
    axum::extract::Query(q): Query,
) -> axum::response::Response {
    if !state.rate.allow(peer.ip()) {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }
    let key = q.get("k").cloned().unwrap_or_default();
    let Some((first, rx, watching)) = state.feeds.follow(&id, &key) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    // Frames as they change, and a beat with the host's clock every few seconds between them (#196):
    // a page that hears neither knows it is out of date. An older page ignores the beats.
    let beat = tokio::time::interval_at(tokio::time::Instant::now() + FEED_BEAT, FEED_BEAT);
    let stream = futures_util::stream::unfold((rx, first, beat), |(mut rx, first, mut beat)| async move {
        // The frame's number is the event id: the page acknowledges it once drawn.
        if let Some((seq, json)) = first {
            return Some((Ok::<_, std::convert::Infallible>(Event::default().event("frame").id(seq.to_string()).data(json)), (rx, None, beat)));
        }
        loop {
            tokio::select! {
                r = rx.recv() => match r {
                    Ok((seq, json)) => return Some((Ok(Event::default().event("frame").id(seq.to_string()).data(json)), (rx, None, beat))),
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => return None,
                },
                _ = beat.tick() => return Some((Ok(Event::default().event("beat").data(host_now_ms().to_string())), (rx, None, beat))),
            }
        }
    });
    let stream = futures_util::StreamExt::take_until(stream, until_stopped(state.stopping.clone()));
    // A revoked TV (or a new link) is cut at once; its page then finds its link no longer works.
    let stream = futures_util::StreamExt::take_until(stream, state.feeds.clone().until_withdrawn(id, key));
    // A paired TV's page counts as watching while this stream is open.
    let stream = futures_util::StreamExt::map(stream, move |e| {
        let _ = &watching;
        e
    });
    Sse::new(stream).keep_alive(KeepAlive::new().interval(std::time::Duration::from_secs(15))).into_response()
}

/// The host's wall clock in ms since 1970, as a feed page's beat carries it.
fn host_now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
}

/// The key a request carries, from `X-Rhema-Key` or `Authorization: Bearer`.
fn presented_key(headers: &HeaderMap) -> Option<&str> {
    if let Some(v) = headers.get("x-rhema-key").and_then(|v| v.to_str().ok()) {
        return Some(v.trim());
    }
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
}

fn check_http_command_key(
    keys: &KeySet,
    headers: &HeaderMap,
    peer: SocketAddr,
) -> Result<Option<crate::keys::KeyEntry>, (StatusCode, &'static str)> {
    match check_remote_key(keys, presented_key(headers), peer.ip()) {
        Err(reason) if reason == OPEN_REMOTE_OUTSIDE_LOCAL_NETWORK => {
            log::warn!("HTTP command refused: unauthenticated request from {}", peer.ip());
            Err((StatusCode::FORBIDDEN, reason))
        }
        Err(reason) => {
            log::warn!("HTTP command refused: {reason}");
            Err((StatusCode::UNAUTHORIZED, reason))
        }
        Ok(entry) => Ok(entry),
    }
}

fn command_key_refusal(status: StatusCode, reason: &'static str) -> (StatusCode, Json<CommandResponse>) {
    let message = if status == StatusCode::FORBIDDEN { reason.to_string() } else { format!("{reason} (X-Rhema-Key)") };
    (status, CommandResponse::refused(message))
}

async fn command_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<CommandRequest>,
) -> impl IntoResponse {
    if !state.rate.allow(peer.ip()) {
        log::warn!("HTTP command refused: too many from {}", peer.ip());
        return (StatusCode::TOO_MANY_REQUESTS, CommandResponse::refused("too many commands; slow down"));
    }
    let entry = match check_http_command_key(&state.keys, &headers, peer) {
        Err((status, reason)) => return command_key_refusal(status, reason),
        Ok(entry) => entry,
    };
    if let RemoteCommand::GroupTakeScene(take) = &request.command {
        if let Err(why) = take.validate() {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                CommandResponse::refused(why),
            );
        }
    }
    let by = match entry.clone() {
        Some(entry) if entry.paused_for(&request.command) => {
            log::info!("HTTP command refused for {}: the main desk has taken back control", entry.name);
            return (StatusCode::LOCKED, CommandResponse::refused(crate::keys::PAUSED_MESSAGE));
        }
        Some(entry) if !entry.allows(&request.command) => {
            let why = if matches!(&request.command, RemoteCommand::GroupTakeScene(_)) {
                "The host has not granted group Take for all selected outputs"
            } else if entry.role.allows(&request.command) {
                "This output is not assigned to this Screens desk by the host"
            } else {
                refusal_for(entry.role, &request.command)
            };
            log::warn!("HTTP command refused for {}: {why}", entry.name);
            return (StatusCode::FORBIDDEN, CommandResponse::refused(why));
        }
        Some(entry) if entry.role == crate::keys::Role::Screens
            && crate::keys::KeyEntry::scene_output(&request.command).is_some_and(|output| {
                !crate::keys::KeyEntry::is_congregation_output(state.live.current().as_deref(), output)
            }) =>
        {
            return (StatusCode::FORBIDDEN, CommandResponse::refused("Screens desks can only take current congregation outputs"));
        }
        Some(entry)
            if entry.role == crate::keys::Role::Screens
                && crate::keys::KeyEntry::group_scene_outputs(&request.command).is_some_and(
                    |outputs| {
                        outputs.iter().any(|output| {
                            !crate::keys::KeyEntry::is_congregation_output(
                                state.live.current().as_deref(),
                                output,
                            )
                        })
                    },
                ) =>
        {
            return (
                StatusCode::FORBIDDEN,
                CommandResponse::refused(
                    "Screens group Takes can only target current congregation outputs",
                ),
            );
        }
        Some(entry) => {
            state.presence.saw(&entry, peer.ip());
            (entry.name, Some(entry.hash), entry.role)
        }
        None if matches!(&request.command, RemoteCommand::GroupTakeScene(_)) => {
            return (
                StatusCode::FORBIDDEN,
                CommandResponse::refused(
                    "Group Take requires a paired Screens desk and a separate host grant",
                ),
            );
        }
        // Rhema's own recorder needs a desk the host granted it (doc 42): never an open remote.
        None if matches!(&request.command, RemoteCommand::Record(_)) => {
            return (StatusCode::FORBIDDEN, CommandResponse::refused("Recording needs a paired desk the main desk granted the recorder"));
        }
        // An open remote (no keys) may do everything, as before, except group Take and the recorder need an identified grant.
        None => (
            "an open remote".to_string(),
            None,
            crate::keys::Role::Configure,
        ),
    };
    let (by, by_id, role) = by;
    let mut command = request.command;
    let group_take = matches!(&command, RemoteCommand::GroupTakeScene(_));
    if let RemoteCommand::GroupTakeScene(take) = &mut command {
        let Some(id) = request
            .id
            .as_deref()
            .filter(|id| !id.trim().is_empty() && id.trim() == *id && id.len() <= 128)
        else {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                CommandResponse::refused("A group Take needs a unique command id"),
            );
        };
        if request.service.is_none() {
            return (
                StatusCode::CONFLICT,
                CommandResponse::refused("Refresh the service before requesting a group Take"),
            );
        }
        take.request_id = Some(id.to_string());
        take.seen = request.seen.clone().unwrap_or_default();
        take.service = request.service.clone();
        if let Err((status, why)) = validate_group_take_live(state.live.current().as_deref(), take)
        {
            return (status, CommandResponse::refused(why));
        }
    }
    // Several services must never share state (#246 C16): a desk still showing the 9 AM service
    // cannot move the 11 AM one. Crew talk is not about a service.
    if !command.is_comms() {
        if let (Some(sent), Some(host)) = (request.service.as_deref(), state.live.service()) {
            if sent != host {
                log::info!("HTTP command from {by} refused: it is for another service");
                return (StatusCode::CONFLICT, Json(CommandResponse { success: false, error: Some(OTHER_SERVICE_MESSAGE.into()), code: Some("other-service"), note: None }));
            }
        }
    }
    // OBS is the online stream: never switched from a desk in rehearsal (the host refuses it too).
    // Nor its recording or transition (#197 Story I: rehearsal records nothing).
    if matches!(command, RemoteCommand::ObsPreview(_) | RemoteCommand::ObsTake | RemoteCommand::ObsProgram(_) | RemoteCommand::ObsRecord(_) | RemoteCommand::ObsTransition(_)) && in_rehearsal(state.live.current().as_deref()) {
        return (StatusCode::FORBIDDEN, CommandResponse::refused(OBS_REHEARSAL_MESSAGE));
    }
    // An extra timer belongs to a role (#196 R2.5): only the timekeeping desks and that role may run it.
    if let RemoteCommand::AuxTimer(t) = &command {
        if let Err(why) = crate::aux_timers::judge(state.live.current().as_deref(), role, t) {
            log::info!("HTTP extra timer command from {by} refused: {why}");
            return (StatusCode::FORBIDDEN, CommandResponse::refused(why));
        }
    }
    if matches!(command, RemoteCommand::SongSection(_)) && !lyrics_up(state.live.current().as_deref()) {
        return (StatusCode::UNPROCESSABLE_ENTITY, CommandResponse::refused(NO_LYRICS_MESSAGE));
    }
    // From here one command at a time, so two desks pressing at once are checked one after the other.
    let _turn = state
        .gate
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if group_take {
        if request.service.as_deref() != state.live.service().as_deref() {
            return (
                StatusCode::CONFLICT,
                Json(CommandResponse {
                    success: false,
                    error: Some(OTHER_SERVICE_MESSAGE.into()),
                    code: Some("other-service"),
                    note: None,
                }),
            );
        }
        let current = match check_http_command_key(&state.keys, &headers, peer) {
            Ok(current) if current.as_ref() == entry.as_ref() => current,
            Ok(_) => {
                return (
                    StatusCode::FORBIDDEN,
                    CommandResponse::refused("Group Take access changed; refresh the desk"),
                )
            }
            Err((status, reason)) => return command_key_refusal(status, reason),
        };
        if current.is_none() {
            return (
                StatusCode::FORBIDDEN,
                CommandResponse::refused(
                    "Group Take requires a paired Screens desk and a separate host grant",
                ),
            );
        }
    }
    let request_fingerprint = if let Some(id) = request.id.as_deref() {
        if id.trim().is_empty() || id.len() > 128 {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                CommandResponse::refused("Choose a valid command id"),
            );
        }
        let fingerprint = command_fingerprint(
            &command,
            &by,
            by_id.as_deref(),
            request.service.as_deref(),
            request.seen.as_ref(),
            request.why.as_deref(),
        );
        match state.recent.status(id, &fingerprint) {
            RecentIdStatus::Replay => {
                log::info!("HTTP command {command:?} already carried out (an exact retry); not repeated");
                return (
                    StatusCode::OK,
                    Json(CommandResponse {
                        success: true,
                        ..Default::default()
                    }),
                );
            }
            RecentIdStatus::Conflict => {
                return (
                    StatusCode::CONFLICT,
                    Json(CommandResponse {
                        success: false,
                        error: Some("This command id was already used for a different request".into()),
                        code: Some("id-conflict"),
                        note: None,
                    }),
                );
            }
            RecentIdStatus::New => {}
        }
        Some(fingerprint)
    } else {
        None
    };
    // Acting on what it saw (#196 R7): if someone changed that part of the service since, the desk
    // looks again rather than undo or repeat their change. A scene a desk edits is one such part.
    if group_take {
        if let RemoteCommand::GroupTakeScene(take) = &command {
            if let Err((status, why)) =
                validate_group_take_live(state.live.current().as_deref(), take)
            {
                let code = if status == StatusCode::CONFLICT {
                    Some("stale")
                } else {
                    None
                };
                return (
                    status,
                    Json(CommandResponse {
                        success: false,
                        error: Some(why.into()),
                        code,
                        note: None,
                    }),
                );
            }
            let Some(seen) = request.seen.as_ref() else {
                return (
                    StatusCode::CONFLICT,
                    Json(CommandResponse {
                        success: false,
                        error: Some(STALE_MESSAGE.into()),
                        code: Some("stale"),
                        note: None,
                    }),
                );
            };
            for part in command_revision_parts(&command) {
                if !matches!((seen.get(&part), state.live.revision(&part)), (Some(sent), Some(now)) if sent == &now)
                {
                    log::info!("HTTP group Take from {by} refused: {part} is missing or changed since (revision was {:?}, now {:?})", seen.get(&part), state.live.revision(&part));
                    return (
                        StatusCode::CONFLICT,
                        Json(CommandResponse {
                            success: false,
                            error: Some(STALE_MESSAGE.into()),
                            code: Some("stale"),
                            note: None,
                        }),
                    );
                }
            }
        }
    } else if let (Some(part), Some(seen)) = (revision_part(&command), request.seen.as_ref()) {
        if let (Some(sent), Some(now)) = (seen.get(&part), state.live.revision(&part)) {
            if *sent != now {
                log::info!("HTTP command {command:?} from {by} refused: {part} changed since (revision {sent}, now {now})");
                return (StatusCode::CONFLICT, Json(CommandResponse { success: false, error: Some(STALE_MESSAGE.into()), code: Some("stale"), note: None }));
            }
        }
    }
    // A scene from a desk (#243 SC.16, SC.17): what its role may change, and the approval rule,
    // against the host's scenes as it last published them.
    // Only the fields a desk may send for a scene go on to the checks and the app.
    if let RemoteCommand::SaveScene(sc) = &mut command {
        crate::scene_edits::strip(&mut sc.scene);
    }
    let mut note = group_take.then(|| "The host accepted this request for processing. Receiver delivery is not confirmed.".to_string());
    let mut waits = false;
    match crate::scene_edits::judge(state.live.current().as_deref(), role, &command) {
        Err(r) => {
            log::info!("HTTP scene change from {by} refused: {}", r.message);
            let status = StatusCode::from_u16(r.status).unwrap_or(StatusCode::BAD_REQUEST);
            let message = if r.code == "stale" { STALE_MESSAGE.to_string() } else { r.message };
            return (status, Json(CommandResponse { success: false, error: Some(message), code: Some(r.code), note: None }));
        }
        Ok(Some(crate::scene_edits::Verdict::Request(why))) => {
            match &mut command {
                RemoteCommand::SaveScene(s) => s.request = true,
                RemoteCommand::DeleteScene(d) => d.request = true,
                _ => {}
            }
            waits = true;
            note = Some(format!("Sent to the main desk to accept, because {why}"));
        }
        Ok(_) => {}
    }
    let why = request.why.as_deref().map(|w| w.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(200).collect::<String>()).filter(|w| !w.is_empty());
    // Reserve all target output revisions together before emitting the accepted command. The
    // frontend's native preflight must see exactly this one server-owned bump; any later change
    // moves a revision again and makes the operation stale. If dispatch fails, the extra revisions
    // are conservative: desks refresh, while no output is changed.
    let reserve_group_outputs = group_take && !waits;
    if reserve_group_outputs {
        let parts = changed_revision_parts(&command);
        if !state.live.bump_many(&parts) {
            return (
                StatusCode::CONFLICT,
                CommandResponse::refused("Output revisions are unavailable; refresh before requesting a group Take"),
            );
        }
    }
    let done = match (&command, why) {
        (RemoteCommand::NoticeAck(_), Some(why)) => CommandDispatcher::dispatch_from(&command, &WithWhy { inner: &*state.sink, why: &why }, &by, by_id.as_deref()),
        _ => CommandDispatcher::dispatch_from(&command, &*state.sink, &by, by_id.as_deref()),
    };
    match done {
        Ok(()) => {
            if let (Some(id), Some(fingerprint)) = (request.id.as_deref(), request_fingerprint.as_deref()) {
                state.recent.record(id, fingerprint);
            }
            // A change that waits for the main desk has not changed the scene yet: another desk may still act on it.
            if !waits && !reserve_group_outputs {
                for part in changed_revision_parts(&command) {
                    state.live.bump(&part);
                }
            }
            (StatusCode::OK, Json(CommandResponse { success: true, note, ..Default::default() }))
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, CommandResponse::refused(e.to_string())),
    }
}

/// Carries an Unable answer's reason to the app with the answer itself (Rhema Comms, #251).
struct WithWhy<'a> {
    inner: &'a dyn CommandSink,
    why: &'a str,
}

impl CommandSink for WithWhy<'_> {
    fn emit_event(&self, event: &str, payload: &str) -> Result<(), CommandError> {
        match serde_json::from_str::<serde_json::Value>(payload) {
            Ok(serde_json::Value::Object(mut m)) if event == "remote:notice_ack" => {
                m.insert("why".into(), self.why.into());
                self.inner.emit_event(event, &serde_json::Value::Object(m).to_string())
            }
            _ => self.inner.emit_event(event, payload),
        }
    }
    fn invoke_backend(&self, action: &str, args: &str) -> Result<(), CommandError> {
        self.inner.invoke_backend(action, args)
    }
}

/// Why a desk's role does not allow a command, in words for the person at that desk.
fn refusal_for(role: crate::keys::Role, cmd: &RemoteCommand) -> &'static str {
    use crate::keys::Role;
    // Rhema's own recorder is a separate grant, whatever the role (doc 42).
    if matches!(cmd, RemoteCommand::Record(_)) {
        return "Rhema's recorder needs a separate grant from the main desk (Permissions); no role includes it";
    }
    match role {
        Role::Timekeeper => "this device keeps time: it may move the event clock, not the screens",
        Role::Bible => "this device runs the Bible: it may activate, step and clear the Bible only",
        Role::Screens => "this device runs the congregation screens: it may take, release, make and change scenes and take the ticker and lower third off and back only",
        Role::Worship => "this device runs worship: it may show songs and hymns, step through their sections and take the lyrics off and back only",
        Role::Stage => "this device runs the stage: it may change the stage message only",
        Role::Camera => "this device runs the cameras: it may hide or show a camera and change the camera boxes in scenes only",
        Role::Obs => "this device is the OBS director: it may switch OBS scenes, choose the transition and start, stop and mark the recording only",
        Role::ObsCompanion => "this computer is an OBS companion: it reads the church's cameras into its own OBS and sends no commands",
        Role::Editor => "this device prepares: it may put a verse or a song in the main desk's Preview, add to the queue and make or change scenes, never what is live",
        Role::Viewer => "this device is view only: it follows the service and may use Talk and notices, nothing else",
        _ if matches!(cmd, RemoteCommand::ObsPreview(_) | RemoteCommand::ObsTake | RemoteCommand::ObsProgram(_) | RemoteCommand::ObsTransition(_)) => "only a desk the main desk made OBS director may switch OBS",
        _ if matches!(cmd, RemoteCommand::ObsRecord(_)) => "only a desk the main desk made OBS director may start or stop OBS's recording",
        _ if matches!(cmd, RemoteCommand::SaveScene(_) | RemoteCommand::DeleteScene(_)) => "this device may present but not make or change scenes",
        _ => "this device may present but not change settings",
    }
}

#[cfg(test)]
mod tests {

    #[test]
    fn a_retried_press_is_not_repeated() {
        let recent = RecentIds::default();
        assert_eq!(recent.status("press-1", "first"), RecentIdStatus::New);
        recent.record("press-1", "first");
        assert_eq!(recent.status("press-1", "first"), RecentIdStatus::Replay);
        assert_eq!(recent.status("press-1", "different"), RecentIdStatus::Conflict);
        assert_eq!(recent.status("press-2", "first"), RecentIdStatus::New);
    }

    #[test]
    fn refreshing_an_id_moves_it_to_the_end_of_the_bounded_retry_window() {
        let recent = RecentIds::default();
        recent.record("press-0", "old");
        recent.record("press-1", "same");
        recent.record("press-0", "new");
        for index in 0..(RecentIds::MAX - 2) {
            recent.record(&format!("press-{index}-filler"), "same");
        }
        assert_eq!(recent.status("press-0", "new"), RecentIdStatus::Replay);
        recent.record("last", "same");
        assert_eq!(recent.status("press-0", "new"), RecentIdStatus::Replay);
        assert_eq!(recent.status("press-1", "same"), RecentIdStatus::New);
    }
    use super::*;
    use crate::keys::{hash_key, key_set_from};
    use std::sync::Mutex;

    #[test]
    fn http_command_key_check_limits_open_access_and_refuses_bad_or_revoked_keys() {
        let open = new_key_set();
        let no_key = HeaderMap::new();
        let public_peer = "8.8.8.8:45000".parse().unwrap();
        let lan_peer = "192.168.1.20:45000".parse().unwrap();

        assert_eq!(check_http_command_key(&open, &no_key, public_peer).unwrap_err().0, StatusCode::FORBIDDEN);
        assert!(check_http_command_key(&open, &no_key, lan_peer).unwrap().is_none());

        let paired = key_set_from(&[("token", "Desk")]);
        let mut wrong_key = HeaderMap::new();
        wrong_key.insert("x-rhema-key", "tampered".parse().unwrap());
        assert_eq!(check_http_command_key(&paired, &wrong_key, public_peer).unwrap_err().0, StatusCode::UNAUTHORIZED);

        let mut valid_key = HeaderMap::new();
        valid_key.insert("x-rhema-key", "token".parse().unwrap());
        assert_eq!(check_http_command_key(&paired, &valid_key, public_peer).unwrap().unwrap().name, "Desk");

        let revoked = new_key_set();
        revoked.write().unwrap().require_auth = true;
        assert_eq!(check_http_command_key(&revoked, &valid_key, public_peer).unwrap_err().0, StatusCode::UNAUTHORIZED);
    }

    struct MockSink {
        commands: Mutex<Vec<String>>,
        /// The last production notice's event, as the app would receive it.
        notice: Mutex<Option<String>>,
        /// The last scene change's event payload.
        scene: Mutex<Option<String>>,
        /// The last group Take event and server-stamped metadata.
        group_take: Mutex<Option<String>>,
    }

    impl MockSink {
        fn new() -> Self {
            Self {
                commands: Mutex::new(Vec::new()),
                notice: Mutex::new(None),
                scene: Mutex::new(None),
                group_take: Mutex::new(None),
            }
        }

        fn command_count(&self) -> usize {
            self.commands.lock().unwrap().len()
        }
    }

    struct FailOnceSink {
        event_attempts: std::sync::atomic::AtomicUsize,
    }

    struct FailGroupTakeSink;

    impl CommandSink for FailGroupTakeSink {
        fn emit_event(&self, event: &str, _payload: &str) -> Result<(), CommandError> {
            if event == "remote:group_take_scene" {
                Err(CommandError::DispatchFailed("group Take dispatch failed".into()))
            } else {
                Ok(())
            }
        }

        fn invoke_backend(&self, _action: &str, _args: &str) -> Result<(), CommandError> {
            Ok(())
        }
    }

    impl CommandSink for FailOnceSink {
        fn emit_event(&self, event: &str, _payload: &str) -> Result<(), CommandError> {
            if event == "remote:event_next"
                && self.event_attempts.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0
            {
                return Err(CommandError::DispatchFailed("first dispatch fails".into()));
            }
            Ok(())
        }

        fn invoke_backend(&self, _action: &str, _args: &str) -> Result<(), CommandError> {
            Ok(())
        }
    }

    fn app_state_for_network_tests() -> Arc<AppState<MockSink>> {
        let (_shutdown, stopping) = watch::channel(false);
        Arc::new(AppState {
            live: new_live_hub(),
            feeds: new_feed_hub(),
            voice: new_voice_hub(),
            cameras: crate::cameras::new_camera_hub(),
            presence: crate::presence::new_presence(),
            tls_port: std::sync::OnceLock::new(),
            stopping,
            sink: Arc::new(MockSink::new()),
            status: new_shared_status(),
            keys: new_key_set(),
            pairing: new_pairing_window(),
            rate: crate::rate::RateLimiter::default(),
            recent: RecentIds::default(),
            gate: std::sync::Mutex::new(()),
        })
    }

    #[tokio::test]
    async fn public_sources_cannot_read_status_health_or_open_pairing() {
        let state = app_state_for_network_tests();
        let public_peer: SocketAddr = "8.8.8.8:45000".parse().unwrap();

        let health = health_handler(AxumState(state.clone()), ConnectInfo(public_peer)).await;
        assert_eq!(health.status(), StatusCode::FORBIDDEN);

        let status = status_handler(AxumState(state.clone()), ConnectInfo(public_peer)).await;
        assert_eq!(status.status(), StatusCode::FORBIDDEN);

        let pair = pair_handler(
            AxumState(state),
            ConnectInfo(public_peer),
            Json(PairRequest { code: "unused".into(), name: "Desk".into(), role: None }),
        )
        .await
        .into_response();
        assert_eq!(pair.status(), StatusCode::FORBIDDEN);
    }

    impl CommandSink for MockSink {
        fn emit_event(&self, event: &str, payload: &str) -> Result<(), CommandError> {
            if event == "remote:notice_send" {
                *self.notice.lock().unwrap() = Some(payload.to_string());
            }
            if event == "remote:save_scene" || event == "remote:delete_scene" {
                *self.scene.lock().unwrap() = Some(payload.to_string());
            }
            if event == "remote:group_take_scene" {
                *self.group_take.lock().unwrap() = Some(payload.to_string());
            }
            // Commands only: the service log's record of each (remote:audit) is not a command.
            if event != "remote:audit" {
                self.commands.lock().unwrap().push(event.to_string());
            }
            Ok(())
        }

        fn invoke_backend(&self, action: &str, _args: &str) -> Result<(), CommandError> {
            self.commands.lock().unwrap().push(action.to_string());
            Ok(())
        }

        fn lookup(&self, q: &crate::lookup::Lookup) -> Result<serde_json::Value, String> {
            match q {
                crate::lookup::Lookup::Songs { query } if query == "broken" => Err("Songs are unavailable on the host".into()),
                _ => Ok(serde_json::json!({ "asked": format!("{q:?}") })),
            }
        }
    }

    #[tokio::test]
    async fn http_server_binds_and_stops() {
        let sink = Arc::new(MockSink::new());
        let status = new_shared_status();
        let config = HttpConfig {
            port: 0,
            host: "127.0.0.1".into(),
        ..Default::default()
        };

        let mut result = start_http_server(config, sink, status)
            .await
            .expect("should bind");
        assert!(result.bound_port > 0);
        assert!(result.handle.is_active());

        result.handle.stop();
        // Give the server a moment to shut down
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(!result.handle.is_active());
    }

    /// Helper: send a raw HTTP request and return the response as a string.
    async fn raw_http_request(port: u16, method: &str, path: &str, body: Option<&str>) -> String {
        raw_http_request_with(port, method, path, body, "").await
    }

    async fn raw_http_request_with(port: u16, method: &str, path: &str, body: Option<&str>, extra_headers: &str) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let mut stream = tokio::net::TcpStream::connect(format!("127.0.0.1:{port}"))
            .await
            .expect("connect");

        let body_str = body.unwrap_or("");
        let request = if body.is_some() {
            format!(
                "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{extra_headers}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body_str}",
                body_str.len()
            )
        } else {
            format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n")
        };

        stream.write_all(request.as_bytes()).await.expect("write");

        let mut response = String::new();
        stream.read_to_string(&mut response).await.expect("read");
        response
    }

    async fn get_with(port: u16, path: &str, headers: &str, read_bytes: Option<usize>) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut stream = tokio::net::TcpStream::connect(format!("127.0.0.1:{port}")).await.expect("connect");
        stream.write_all(format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{headers}Connection: close\r\n\r\n").as_bytes()).await.expect("write");
        let mut out = Vec::new();
        match read_bytes {
            None => { stream.read_to_end(&mut out).await.expect("read"); }
            Some(n) => {
                let mut buf = [0u8; 1024];
                // Up to n bytes, or what came within 2 s of the last (the headers' length varies).
                while out.len() < n {
                    let Ok(r) = tokio::time::timeout(std::time::Duration::from_secs(2), stream.read(&mut buf)).await else { break };
                    let r = r.expect("read");
                    if r == 0 { break; }
                    out.extend_from_slice(&buf[..r]);
                }
            }
        }
        String::from_utf8_lossy(&out).into_owned()
    }

    #[tokio::test]
    async fn live_state_needs_a_paired_key_and_streams_each_change() {
        let keys: KeySet = Arc::new(std::sync::RwLock::new(crate::keys::Keys {
            require_auth: true,
            entries: vec![crate::keys::KeyEntry {
                hash: crate::keys::hash_key("tok"),
                name: "Femi's laptop".into(),
                role: crate::keys::Role::Timekeeper,
                paused: false,
                output_scope: Vec::new(),
                group_take_scope: Vec::new(),
                record: false,
            }],
        }));
        let live = new_live_hub();
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), keys, live: live.clone(), ..Default::default() };
        let result = start_http_server(config, Arc::new(MockSink::new()), new_shared_status()).await.expect("bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        assert!(get_with(port, "/api/v1/live", "", None).await.contains("401"));
        assert!(get_with(port, "/api/v1/live", "X-Rhema-Key: nope\r\n", None).await.contains("401"));
        assert!(get_with(port, "/api/v1/live", "X-Rhema-Key: tok\r\n", None).await.contains("204"));
        let me = get_with(port, "/api/v1/me", "X-Rhema-Key: tok\r\n", None).await;
        assert!(me.contains("Femi's laptop") && me.contains("timekeeper"), "{me}");

        live.publish(r#"{"v":1,"now":"Opening prayer"}"#.into());
        let now = get_with(port, "/api/v1/live", "Authorization: Bearer tok\r\n", None).await;
        assert!(now.contains("200 OK") && now.contains("Opening prayer"), "{now}");

        // The stream starts with the current state, then each change.
        let handle = tokio::spawn(async move { get_with(port, "/api/v1/live/events", "X-Rhema-Key: tok\r\n", Some(500)).await });
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        live.publish(r#"{"v":1,"now":"Sermon"}"#.into());
        let stream = handle.await.unwrap();
        assert!(stream.contains("text/event-stream"), "{stream}");
        assert!(stream.contains("event: live") && stream.contains("Opening prayer") && stream.contains("Sermon"), "{stream}");

        let mut h = result.handle;
        h.stop();
    }

    /// A paired key; its hash is its id (here a short stand-in per desk).
    fn desk(name: &str, role: crate::keys::Role) -> crate::keys::KeyEntry {
        let hash = match name.to_lowercase().as_str() {
            "ade's phone" => "h-ade",
            "femi" => "h-femi",
            _ => "h-other",
        };
        crate::keys::KeyEntry {
            hash: hash.into(),
            name: name.into(),
            role,
            paused: false,
            output_scope: Vec::new(),
            group_take_scope: Vec::new(),
            record: false,
        }
    }

    const NOTICES: &str = r#"{"v":1,"notices":[
        {"id":"all","from":"Tolu (main desk)","fromId":"host","to":"all","text":"Doors open"},
        {"id":"tk","from":"Tolu (main desk)","fromId":"host","to":"timekeeper","text":"Pastor has 5 minutes"},
        {"id":"bb","from":"Tolu (main desk)","fromId":"host","to":"bible","text":"Romans next"},
        {"id":"pr","from":"Tolu (main desk)","fromId":"host","to":"present","text":"Slides ready?"},
        {"id":"host","from":"Femi","fromId":"h-femi","to":"host","text":"Running late"},
        {"id":"ade","from":"Tolu (main desk)","fromId":"host","to":{"name":"Ade's phone"},"toId":"h-ade","text":"Mic 2 is yours"},
        {"id":"mine","from":"Ade's phone","fromId":"h-ade","to":"host","text":"Ready"}
    ]}"#;

    fn ids(json: &str) -> Vec<String> {
        let v: serde_json::Value = serde_json::from_str(json).unwrap();
        v["notices"].as_array().unwrap().iter().map(|n| n["id"].as_str().unwrap().to_string()).collect()
    }

    #[test]
    fn each_desk_gets_only_the_notices_for_it() {
        use crate::keys::Role;
        assert_eq!(ids(&notices_for(NOTICES, Some(&desk("Ade's phone", Role::Bible)))), ["all", "bb", "ade", "mine"], "a Bible desk never gets the Timekeeper's");
        assert_eq!(ids(&notices_for(NOTICES, Some(&desk("Femi", Role::Timekeeper)))), ["all", "tk", "host"], "its role's, and what it sent");
        assert_eq!(ids(&notices_for(NOTICES, Some(&desk("Laptop", Role::Configure)))), ["all", "pr"], "Present and settings also gets the Present desks'");
        assert_eq!(ids(&notices_for(NOTICES, Some(&desk("ade's PHONE", Role::Screens)))), ["all", "ade", "mine"], "by its key, whatever its role");
        assert_eq!(ids(&notices_for(NOTICES, None)).len(), 7, "the main desk sees every notice");
        // The key ids never reach a desk.
        assert!(!notices_for(NOTICES, Some(&desk("Ade's phone", Role::Bible))).contains("h-ade"));
        assert!(notices_for(NOTICES, None).contains("fromId"), "the main desk's own copy is as published");
        // Nothing else in the state changes; a state without notices goes out as it is.
        let v: serde_json::Value = serde_json::from_str(&notices_for(NOTICES, Some(&desk("x", Role::Bible)))).unwrap();
        assert_eq!(v["v"], 1);
        assert_eq!(notices_for(r#"{"v":1,"now":"Sermon"}"#, Some(&desk("x", Role::Bible))), r#"{"v":1,"now":"Sermon"}"#);
    }

    #[test]
    fn a_desk_named_like_the_main_desk_gets_none_of_its_private_notices() {
        use crate::keys::{KeyEntry, Role};
        // Paired before names were checked, or named to look like it: matched by key, not name.
        let mimic = KeyEntry {
            hash: "h-mimic".into(),
            name: "Tolu (main desk)".into(),
            role: Role::Screens,
            paused: false,
            output_scope: Vec::new(),
            group_take_scope: Vec::new(),
            record: false,
        };
        assert_eq!(ids(&notices_for(NOTICES, Some(&mimic))), ["all"]);
        let named_like_ade = KeyEntry {
            hash: "h-mimic".into(),
            name: "Ade's phone".into(),
            role: Role::Screens,
            paused: false,
            output_scope: Vec::new(),
            group_take_scope: Vec::new(),
            record: false,
        };
        assert_eq!(
            ids(&notices_for(NOTICES, Some(&named_like_ade))),
            ["all"],
            "a copied name gets neither Ade's notice nor what Ade sent"
        );
        // A key whose hash is literally "host" cannot exist (hashes are 64 hex characters), and an empty one matches nothing.
        let empty = KeyEntry {
            hash: String::new(),
            name: "x".into(),
            role: Role::Screens,
            paused: false,
            output_scope: Vec::new(),
            group_take_scope: Vec::new(),
            record: false,
        };
        assert_eq!(ids(&notices_for(NOTICES, Some(&empty))), ["all"]);
    }

    #[test]
    fn a_renamed_desk_keeps_what_it_sent_and_what_is_for_it() {
        use crate::keys::{KeyEntry, Role};
        let renamed = KeyEntry {
            hash: "h-ade".into(),
            name: "Ade at the back".into(),
            role: Role::Screens,
            paused: false,
            output_scope: Vec::new(),
            group_take_scope: Vec::new(),
            record: false,
        };
        assert_eq!(
            ids(&notices_for(NOTICES, Some(&renamed))),
            ["all", "ade", "mine"]
        );
        // Notices from before ids: only their group; a name alone reaches no one.
        let old = r#"{"v":1,"notices":[{"id":"o1","from":"Ade's phone","to":"host","text":"x"},{"id":"o2","from":"Main desk","to":{"name":"Ade's phone"},"text":"y"},{"id":"o3","from":"Main desk","to":"screens","text":"z"}]}"#;
        assert_eq!(ids(&notices_for(old, Some(&renamed))), ["o3"]);
    }

    #[tokio::test]
    async fn the_live_endpoints_filter_notices_per_key() {
        use crate::keys::{hash_key, KeyEntry, Keys, Role};
        let entry = |tok: &str, name: &str, role| KeyEntry {
            hash: hash_key(tok),
            name: name.into(),
            role,
            paused: false,
            output_scope: Vec::new(),
            group_take_scope: Vec::new(),
            record: false,
        };
        let keys: KeySet = Arc::new(std::sync::RwLock::new(Keys {
            require_auth: true,
            entries: vec![
                entry("bib", "Ade's phone", Role::Bible),
                entry("tim", "Femi", Role::Timekeeper),
            ],
        }));
        let live = new_live_hub();
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), keys, live: live.clone(), ..Default::default() };
        let sink = Arc::new(MockSink::new());
        let result = start_http_server(config, sink.clone(), new_shared_status()).await.expect("bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        live.publish(NOTICES.replace("h-ade", &hash_key("bib")).replace("h-femi", &hash_key("tim")));

        // A notice sent with a key carries that key's id, stamped by the server; the body cannot say otherwise.
        let sent = raw_http_request_with(port, "POST", "/api/v1/command", Some(r#"{"command":"notice_send","value":{"text":"Ready","to":"host","byId":"host","fromId":"host"}}"#), "X-Rhema-Key: bib\r\n").await;
        assert!(sent.contains("200 OK"), "{sent}");
        let event: serde_json::Value = serde_json::from_str(sink.notice.lock().unwrap().as_deref().unwrap()).unwrap();
        assert_eq!(event["byId"], hash_key("bib"));
        assert_eq!(event["by"], "Ade's phone");

        let bible = get_with(port, "/api/v1/live", "X-Rhema-Key: bib\r\n", None).await;
        assert!(bible.contains("Romans next") && bible.contains("Mic 2 is yours") && !bible.contains("Pastor has 5 minutes") && !bible.contains("Running late"), "{bible}");
        let time = get_with(port, "/api/v1/live", "X-Rhema-Key: tim\r\n", None).await;
        assert!(time.contains("Pastor has 5 minutes") && !time.contains("Romans next") && !time.contains("Mic 2 is yours"), "{time}");

        // The stream too: the first state and each change after it.
        let handle = tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let mut stream = tokio::net::TcpStream::connect(format!("127.0.0.1:{port}")).await.expect("connect");
            stream.write_all(b"GET /api/v1/live/events HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Rhema-Key: bib\r\nConnection: close\r\n\r\n").await.expect("write");
            let (mut out, mut buf) = (Vec::new(), [0u8; 1024]);
            while !String::from_utf8_lossy(&out).contains("Psalm 23 next") {
                let r = tokio::time::timeout(std::time::Duration::from_secs(2), stream.read(&mut buf)).await.expect("in time").expect("read");
                if r == 0 { break; }
                out.extend_from_slice(&buf[..r]);
            }
            String::from_utf8_lossy(&out).into_owned()
        });
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        live.publish(r#"{"v":1,"notices":[{"id":"t2","from":"Main desk","to":"timekeeper","text":"Wrap up now"},{"id":"b2","from":"Main desk","to":"bible","text":"Psalm 23 next"}]}"#.into());
        let stream = handle.await.unwrap();
        assert!(stream.contains("Romans next") && stream.contains("Psalm 23 next"), "{stream}");
        assert!(!stream.contains("Pastor has 5 minutes") && !stream.contains("Wrap up now"), "a Bible key never receives the Timekeeper's notices: {stream}");

        let mut h = result.handle;
        h.stop();
    }

    struct PageSink;
    impl CommandSink for PageSink {
        fn emit_event(&self, _e: &str, _p: &str) -> Result<(), CommandError> { Ok(()) }
        fn invoke_backend(&self, _a: &str, _p: &str) -> Result<(), CommandError> { Ok(()) }
        fn asset(&self, path: &str) -> Option<(Vec<u8>, String)> {
            match path {
                "feed.html" => Some((b"<html>feed page</html>".to_vec(), "text/html".into())),
                "assets/feed.js" => Some((b"console.log(1)".to_vec(), "text/javascript".into())),
                _ => None,
            }
        }
    }

    /// Plays the host window: answers each voice offer with the desk's name and key id in the SDP.
    struct VoiceSink(SharedVoice);
    impl CommandSink for VoiceSink {
        fn emit_event(&self, event: &str, payload: &str) -> Result<(), CommandError> {
            if event == "remote:voice_offer" {
                let v: serde_json::Value = serde_json::from_str(payload).unwrap();
                let (id, by, by_id) = (v["id"].as_str().unwrap().to_string(), v["by"].as_str().unwrap().to_string(), v["byId"].as_str().unwrap().to_string());
                assert!(v["sdp"].as_str().unwrap().starts_with("v=0"));
                let hub = self.0.clone();
                tokio::spawn(async move { assert!(hub.answer(&id, format!("v=0 answer for {by} key {by_id}"))) });
            }
            Ok(())
        }
        fn invoke_backend(&self, _: &str, _: &str) -> Result<(), CommandError> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn https_serves_the_same_api_trusted_through_the_local_ca() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let ca = crate::tls::make_ca().unwrap();
        let server = crate::tls::make_server(&ca, &["127.0.0.1".into()]).unwrap();
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), tls: Some(TlsListener { port: 0, server, ca_cert: ca.cert.clone() }), ..Default::default() };
        let result = start_http_server(config, Arc::new(MockSink::new()), new_shared_status()).await.expect("bind");
        let tls_port = result.tls_port.expect("https port");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        // A client that trusts only the local CA (as a phone that installed it).
        let mut roots = rustls::RootCertStore::empty();
        use rustls::pki_types::pem::PemObject;
        for c in rustls::pki_types::CertificateDer::pem_slice_iter(ca.cert.as_bytes()) {
            roots.add(c.unwrap()).unwrap();
        }
        let client = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider())).with_safe_default_protocol_versions().unwrap().with_root_certificates(roots).with_no_client_auth();
        let tcp = tokio::net::TcpStream::connect(("127.0.0.1", tls_port)).await.unwrap();
        let name = rustls::pki_types::ServerName::try_from("127.0.0.1").unwrap();
        let mut tls = tokio_rustls::TlsConnector::from(Arc::new(client)).connect(name, tcp).await.expect("the chain checks");
        tls.write_all(format!("GET /api/v1/health HTTP/1.1\r\nHost: 127.0.0.1:{tls_port}\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
        let mut out = Vec::new();
        let _ = tls.read_to_end(&mut out).await;
        let text = String::from_utf8_lossy(&out);
        assert!(text.contains("200 OK") && text.contains("rhema"), "{text}");
        // The CA's certificate is there to install, over plain http too.
        let ca_page = raw_http_request(result.bound_port, "GET", "/rhema-ca.pem", None).await;
        assert!(ca_page.contains("200 OK") && ca_page.contains("BEGIN CERTIFICATE"), "{ca_page}");
        let mut h = result.handle;
        h.stop();
    }

    #[tokio::test]
    async fn a_browser_feed_is_served_over_https_with_the_certificate_a_tv_insists_on() {
        // A Google TV (#198) opens the feed's https link and checks the certificate it is shown
        // against the fingerprint Rhema sent it; the feed routes are the same on the https port.
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let ca = crate::tls::make_ca().unwrap();
        let server = crate::tls::make_server(&ca, &["127.0.0.1".into()]).unwrap();
        let fingerprint = crate::tls::fingerprint(&server).unwrap();
        let feeds = new_feed_hub();
        feeds.set(&[("l3".into(), "s3cret".into())]);
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), feeds, tls: Some(TlsListener { port: 0, server, ca_cert: ca.cert.clone() }), ..Default::default() };
        let result = start_http_server(config, Arc::new(PageSink), new_shared_status()).await.expect("bind");
        let tls_port = result.tls_port.expect("https port");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let mut roots = rustls::RootCertStore::empty();
        use rustls::pki_types::pem::PemObject;
        for c in rustls::pki_types::CertificateDer::pem_slice_iter(ca.cert.as_bytes()) {
            roots.add(c.unwrap()).unwrap();
        }
        let client = Arc::new(rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider())).with_safe_default_protocol_versions().unwrap().with_root_certificates(roots).with_no_client_auth());
        let get = |path: &'static str| {
            let client = client.clone();
            async move {
                let tcp = tokio::net::TcpStream::connect(("127.0.0.1", tls_port)).await.unwrap();
                let mut tls = tokio_rustls::TlsConnector::from(client).connect(rustls::pki_types::ServerName::try_from("127.0.0.1").unwrap(), tcp).await.unwrap();
                use sha2::Digest;
                let shown = tls.get_ref().1.peer_certificates().unwrap()[0].clone();
                let seen: String = sha2::Sha256::digest(shown.as_ref()).iter().map(|b| format!("{b:02x}")).collect();
                tls.write_all(format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{tls_port}\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
                let mut out = Vec::new();
                let _ = tls.read_to_end(&mut out).await;
                (seen, String::from_utf8_lossy(&out).to_string())
            }
        };
        let (seen, page) = get("/feed/l3?k=s3cret").await;
        assert_eq!(seen, fingerprint, "the certificate shown is the one whose fingerprint the TV gets");
        assert!(page.contains("200 OK") && page.contains("feed page"), "{page}");
        assert!(get("/assets/feed.js").await.1.contains("console.log"));
        assert!(get("/feed/l3?k=wrong").await.1.contains("403"));
        let mut h = result.handle;
        h.stop();
    }

    #[tokio::test]
    async fn a_desk_joins_the_talk_channel_with_its_key_and_gets_the_host_answer() {
        let voice = new_voice_hub();
        let keys = new_key_set();
        keys.write().unwrap().entries.push(crate::keys::KeyEntry {
            hash: crate::keys::hash_key("k1"),
            name: "Ade bible".into(),
            role: crate::keys::Role::Bible,
            paused: false,
            output_scope: Vec::new(),
            group_take_scope: Vec::new(),
            record: false,
        });
        keys.write().unwrap().entries.push(crate::keys::KeyEntry {
            hash: crate::keys::hash_key("k2"),
            name: "\u{410}de bible".into(),
            role: crate::keys::Role::Present,
            paused: false,
            output_scope: Vec::new(),
            group_take_scope: Vec::new(),
            record: false,
        });
        keys.write().unwrap().require_auth = true;
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), keys, voice: voice.clone(), ..Default::default() };
        let result = start_http_server(config, Arc::new(VoiceSink(voice.clone())), new_shared_status()).await.expect("bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let ok = raw_http_request_with(port, "POST", "/api/v1/voice", Some(r#"{"sdp":"v=0 offer"}"#), "X-Rhema-Key: k1\r\n").await;
        assert!(ok.contains("200 OK") && ok.contains(&format!("v=0 answer for Ade bible key {}", crate::keys::hash_key("k1"))), "{ok}");
        // A desk paired under a name that looks the same (a Cyrillic "А") is a different key: the host
        // tells the two apart by it, so a private call to one never reaches the other (#251).
        let lookalike = raw_http_request_with(port, "POST", "/api/v1/voice", Some(r#"{"sdp":"v=0 offer"}"#), "X-Rhema-Key: k2\r\n").await;
        assert!(lookalike.contains(&format!("v=0 answer for \u{410}de bible key {}", crate::keys::hash_key("k2"))), "{lookalike}");
        assert_ne!(crate::keys::hash_key("k1"), crate::keys::hash_key("k2"));
        assert!(raw_http_request_with(port, "POST", "/api/v1/voice", Some(r#"{"sdp":"v=0 offer"}"#), "X-Rhema-Key: wrong\r\n").await.contains("401"));
        assert!(raw_http_request_with(port, "POST", "/api/v1/voice", Some(r#"{"sdp":"not sdp"}"#), "X-Rhema-Key: k1\r\n").await.contains("400"));
        assert!(!voice.answer("nobody-waits", "v=0".into()), "a late answer is dropped");
        let mut handle = result.handle;
        handle.stop();
    }

    /// Serves one media folder file from a temporary folder.
    struct MediaSink(std::path::PathBuf);
    impl CommandSink for MediaSink {
        fn emit_event(&self, _e: &str, _p: &str) -> Result<(), CommandError> { Ok(()) }
        fn invoke_backend(&self, _a: &str, _p: &str) -> Result<(), CommandError> { Ok(()) }
        fn media_file(&self, file: &str) -> Option<std::path::PathBuf> {
            Some(self.0.join(file))
        }
    }

    #[test]
    fn byte_ranges_follow_what_a_video_player_asks() {
        assert_eq!(byte_range(None, 100), Ok(None));
        assert_eq!(byte_range(Some("bytes=0-"), 100), Ok(Some((0, 99))));
        assert_eq!(byte_range(Some("bytes=10-19"), 100), Ok(Some((10, 19))));
        assert_eq!(byte_range(Some("bytes=90-200"), 100), Ok(Some((90, 99))));
        assert_eq!(byte_range(Some("bytes=-10"), 100), Ok(Some((90, 99))));
        assert_eq!(byte_range(Some("bytes=100-"), 100), Err(()));
        assert_eq!(byte_range(Some("bytes=5-2"), 100), Err(()));
        assert_eq!(byte_range(Some("bytes=0-"), 10 * MEDIA_CHUNK), Ok(Some((0, MEDIA_CHUNK - 1))), "a large file goes in pieces");
        assert!(media_video(&format!("{}.mp4", "a".repeat(64))).is_some());
        assert!(media_video(&format!("{}.png", "a".repeat(64))).is_none(), "videos only");
        assert!(media_video("../../etc/passwd.mp4").is_none());
        assert!(media_video(&format!("{}.mp4", "A".repeat(64))).is_none());
    }

    #[tokio::test]
    async fn a_browser_feed_plays_only_the_video_its_scene_shows() {
        let dir = std::env::temp_dir().join(format!("rhema-feed-media-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = format!("{}.mp4", "b".repeat(64));
        let other = format!("{}.mp4", "c".repeat(64));
        std::fs::write(dir.join(&file), b"0123456789").unwrap();
        std::fs::write(dir.join(&other), b"secret").unwrap();
        let feeds = new_feed_hub();
        feeds.set(&[("tv".into(), "s3cret-feed".into())]);
        feeds.publish("tv", format!(r#"{{"scene":{{"layers":[{{"kind":"video","mediaFile":"{file}"}}]}}}}"#));
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), feeds: feeds.clone(), ..Default::default() };
        let result = start_http_server(config, Arc::new(MediaSink(dir.clone())), new_shared_status()).await.expect("bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let url = |f: &str, k: &str| format!("/api/v1/feed/tv/media/{f}?k={k}");
        assert!(get_with(port, &url(&file, "wrong"), "", None).await.contains("403"));
        assert!(get_with(port, &url(&other, "s3cret-feed"), "", None).await.contains("403"), "a file the scene does not show");
        assert!(get_with(port, &url("notes.mp4", "s3cret-feed"), "", None).await.contains("404"));
        let whole = get_with(port, &url(&file, "s3cret-feed"), "", None).await;
        assert!(whole.starts_with("HTTP/1.1 200") && whole.contains("video/mp4") && whole.ends_with("0123456789"), "{whole}");
        let part = get_with(port, &url(&file, "s3cret-feed"), "Range: bytes=2-5\r\n", None).await;
        assert!(part.starts_with("HTTP/1.1 206") && part.contains("bytes 2-5/10") && part.ends_with("2345"), "{part}");
        assert!(get_with(port, &url(&file, "s3cret-feed"), "Range: bytes=20-\r\n", None).await.contains("416"));
        // Once the scene goes, so does the file.
        feeds.publish("tv", "{}".into());
        assert!(get_with(port, &url(&file, "s3cret-feed"), "", None).await.contains("403"));
        let mut h = result.handle;
        h.stop();
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Per-target acks (#246 C17): the first page to draw a new frame is reported once, with how soon.
    #[test]
    fn the_first_draw_of_a_new_frame_is_reported_once() {
        let feeds = new_feed_hub();
        feeds.set(&[("tv".into(), "s3cret".into())]);
        assert_eq!(feeds.ack("tv", "s3cret", 0, None, None), Ok(None), "nothing published yet");
        feeds.publish("tv", "{}".into());
        assert_eq!(feeds.ack("tv", "wrong", 1, None, None), Err(()), "refused without the secret");
        assert!(matches!(feeds.ack("tv", "s3cret", 1, None, None), Ok(Some(ms)) if ms < 5_000), "first draw of frame 1");
        assert_eq!(feeds.ack("tv", "s3cret", 1, None, None), Ok(None), "a page re-acking the same frame is not news");
        feeds.publish("tv", "{}".into());
        feeds.publish("tv", "{}".into());
        assert_eq!(feeds.ack("tv", "s3cret", 2, None, None), Ok(None), "an older frame than the newest");
        assert!(matches!(feeds.ack("tv", "s3cret", 3, None, None), Ok(Some(_))), "the newest frame, first drawn");
        assert_eq!(feeds.ack("tv", "s3cret", 3, None, None), Ok(None));
        // A paired TV acks with its own key (#198): its first draw counts the same.
        feeds.set_keys(&[FeedKeys { id: "tv".into(), token: "s3cret".into(), tvs: vec![("192.168.1.40:8095".into(), "tv-own-key".into())] }]);
        feeds.publish("tv", "{}".into());
        assert!(matches!(feeds.ack("tv", "tv-own-key", 4, None, None), Ok(Some(_))), "a TV's own key opens the ack too");
        assert_eq!(feeds.ack("tv", "s3cret", 4, None, None), Ok(None), "the second page on the same frame is not news");
    }

    async fn ack_clock(port: u16, clock: i64) -> String {
        raw_http_request_with(port, "POST", "/api/v1/feed/l3/ack?k=s3cret", Some(&format!(r#"{{"seq":2,"clock":{clock}}}"#)), "").await
    }

    #[tokio::test]
    async fn a_feed_page_hears_a_beat_with_the_host_clock_between_frames() {
        let feeds = new_feed_hub();
        feeds.set(&[("tv".into(), "s3cret".into())]);
        feeds.publish("tv", "{}".into());
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), feeds: feeds.clone(), ..Default::default() };
        let result = start_http_server(config, Arc::new(PageSink), new_shared_status()).await.expect("bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let before = host_now_ms();
        // The first frame, then nothing changes: a beat arrives within FEED_BEAT.
        let stream = {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            s.write_all(format!("GET /api/v1/feed/tv/events?k=s3cret HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
            let mut out = Vec::new();
            let mut buf = [0u8; 1024];
            while !String::from_utf8_lossy(&out).contains("event: beat\ndata: ") || !String::from_utf8_lossy(&out).split("event: beat\ndata: ").nth(1).is_some_and(|r| r.contains('\n')) {
                let n = tokio::time::timeout(FEED_BEAT * 2, s.read(&mut buf)).await.expect("a beat in time").unwrap();
                if n == 0 { break; }
                out.extend_from_slice(&buf[..n]);
            }
            String::from_utf8_lossy(&out).into_owned()
        };
        assert!(stream.contains("event: frame"), "{stream}");
        let beat = stream.split("event: beat\ndata: ").nth(1).and_then(|r| r.lines().next()).and_then(|n| n.trim().parse::<i64>().ok());
        assert!(beat.is_some_and(|ms| ms >= before && ms - before < 10_000), "a beat with the host's clock: {stream}");
        let mut h = result.handle;
        h.stop();
    }

    #[tokio::test]
    async fn a_browser_feed_needs_its_own_secret_and_streams_its_frames() {
        let feeds = new_feed_hub();
        feeds.set(&[("l3".into(), "s3cret".into())]);
        feeds.publish("l3", r#"{"verse":"Romans 8:28"}"#.into());
        feeds.publish("other", "{}".into()); // not a feed: ignored
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), feeds: feeds.clone(), ..Default::default() };
        let result = start_http_server(config, Arc::new(PageSink), new_shared_status()).await.expect("bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(get_with(port, "/feed/l3?k=wrong", "", None).await.contains("403"));
        assert!(get_with(port, "/feed/nope?k=s3cret", "", None).await.contains("403"));
        assert!(get_with(port, "/feed/l3?k=s3cret", "", None).await.contains("feed page"));
        assert!(get_with(port, "/assets/feed.js", "", None).await.contains("console.log"));
        assert!(get_with(port, "/assets/../secret", "", None).await.contains("404"));
        assert!(get_with(port, "/api/v1/feed/l3/events?k=wrong", "", None).await.contains("403"));
        let handle = tokio::spawn(async move { get_with(port, "/api/v1/feed/l3/events?k=s3cret", "", Some(392)).await });
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        assert_eq!(feeds.status("l3").unwrap().watching, 1, "the page following it");
        feeds.publish("l3", r#"{"verse":"Romans 8:29"}"#.into());
        let stream = handle.await.unwrap();
        assert!(stream.contains("event: frame") && stream.contains("8:28") && stream.contains("8:29"), "{stream}");
        assert!(stream.contains("id: 1") && stream.contains("id: 2"), "frames carry their number: {stream}");
        // Receiver trust: the page says which frame it drew; only with the secret, never ahead.
        let ack = |k: &'static str, seq: u64| async move { raw_http_request_with(port, "POST", &format!("/api/v1/feed/l3/ack?k={k}"), Some(&format!(r#"{{"seq":{seq}}}"#)), "").await };
        assert!(ack("wrong", 2).await.contains("403"));
        assert!(ack("s3cret", 2).await.contains("204"));
        assert!(ack("s3cret", 9).await.contains("204"));
        let st = feeds.status("l3").unwrap();
        assert_eq!((st.seq, st.acked), (2, 2), "a frame never sent is not acknowledged");
        assert!(st.acked_ago_ms.is_some());
        assert!(st.video.is_empty(), "no page said what it plays yet");
        // A page playing a camera says how it plays (#213), with its acknowledgement.
        let report = r#"{"seq":2,"video":[{"camera":"pulpit","playing":true,"fps":29.8,"decoded":900,"dropped":2,"droppedPct":0.2,"frameAgeMs":40,"width":1920,"height":1080,"jitterMs":4.5,"lossPct":0.1,"rttMs":2.0,"recvFps":60.0,"decodeFps":59.8,"firstFrameMs":640}]}"#;
        assert!(raw_http_request_with(port, "POST", "/api/v1/feed/l3/ack?k=s3cret", Some(report), "").await.contains("204"));
        assert!(raw_http_request_with(port, "POST", "/api/v1/feed/l3/ack?k=wrong", Some(report), "").await.contains("403"));
        let st = feeds.status("l3").unwrap();
        assert_eq!(st.video.len(), 1);
        assert_eq!(st.video[0].from, "127.0.0.1");
        assert_eq!((st.video[0].cameras[0].camera.as_str(), st.video[0].cameras[0].fps, st.video[0].cameras[0].dropped_pct), ("pulpit", Some(29.8), Some(0.2)));
        assert_eq!((st.video[0].cameras[0].jitter_ms, st.video[0].cameras[0].loss_pct, st.video[0].cameras[0].decode_fps, st.video[0].cameras[0].first_frame_ms), (Some(4.5), Some(0.1), Some(59.8), Some(640.0)));
        // A page says how far its clock is from the host's beats (#196): the one furthest off is kept.
        assert_eq!(st.clock_skew_ms, None, "no page said yet");
        assert!(ack_clock(port, -4200).await.contains("204"));
        assert!(ack_clock(port, 300).await.contains("204"));
        assert_eq!(feeds.status("l3").unwrap().clock_skew_ms, Some(-4200));
        // A new secret (the link was renewed) closes the old link.
        feeds.set(&[("l3".into(), "n3w".into())]);
        assert!(get_with(port, "/feed/l3?k=s3cret", "", None).await.contains("403"));
        let mut h = result.handle;
        h.stop();
    }

    #[tokio::test]
    async fn each_paired_tv_has_its_own_key_and_one_can_be_revoked_alone() {
        // #198: a TV sent the feed gets its own key; the feed's link key keeps working (OBS, a TV
        // paired before 1.5) and revoking one TV cuts only that TV, at once.
        let feeds = new_feed_hub();
        let keys = |tvs: &[(&str, &str)]| [FeedKeys { id: "hall".into(), token: "feed-key".into(), tvs: tvs.iter().map(|(a, b)| ((*a).to_string(), (*b).to_string())).collect() }];
        feeds.set_keys(&keys(&[("192.168.1.40:8095", "tv-one-key"), ("192.168.1.41:8095", "tv-two-key")]));
        feeds.publish("hall", r#"{"verse":"Psalm 23:1"}"#.into());
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), feeds: feeds.clone(), ..Default::default() };
        let result = start_http_server(config, Arc::new(PageSink), new_shared_status()).await.expect("bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        for k in ["feed-key", "tv-one-key", "tv-two-key"] {
            assert!(get_with(port, &format!("/feed/hall?k={k}"), "", None).await.contains("feed page"), "{k}");
        }
        assert!(get_with(port, "/feed/hall?k=tv-three-key", "", None).await.contains("403"));
        assert!(raw_http_request_with(port, "POST", "/api/v1/feed/hall/ack?k=tv-two-key", Some(r#"{"seq":1}"#), "").await.contains("204"));
        let follow = |k: &'static str| tokio::spawn(async move { get_with(port, &format!("/api/v1/feed/hall/events?k={k}"), "", Some(100_000)).await });
        let (one, two, link) = (follow("tv-one-key"), follow("tv-two-key"), follow("feed-key"));
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        let st = feeds.status("hall").unwrap();
        assert_eq!(st.watching, 3);
        assert_eq!(st.tvs, [TvWatching { id: "192.168.1.40:8095".into(), watching: 1 }, TvWatching { id: "192.168.1.41:8095".into(), watching: 1 }], "each TV's page, by its address");
        // Revoke TV one: its stream ends at once; the other TV and the link carry on.
        let started = std::time::Instant::now();
        feeds.set_keys(&keys(&[("192.168.1.41:8095", "tv-two-key")]));
        let cut = tokio::time::timeout(std::time::Duration::from_secs(1), one).await.expect("the revoked TV is cut at once").unwrap();
        assert!(started.elapsed() < std::time::Duration::from_secs(1));
        assert!(cut.contains("Psalm 23:1"), "{cut}");
        assert!(get_with(port, "/feed/hall?k=tv-one-key", "", None).await.contains("403"), "its link no longer works");
        assert!(get_with(port, "/api/v1/feed/hall/events?k=tv-one-key", "", None).await.contains("403"));
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let st = feeds.status("hall").unwrap();
        assert_eq!(st.watching, 2);
        assert_eq!(st.tvs, [TvWatching { id: "192.168.1.41:8095".into(), watching: 1 }]);
        feeds.publish("hall", r#"{"verse":"Psalm 23:2"}"#.into());
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        // A new link for the feed: pages on the old link key are cut, the paired TV keeps its own key.
        feeds.set_keys(&[FeedKeys { id: "hall".into(), token: "new-feed-key".into(), tvs: vec![("192.168.1.41:8095".into(), "tv-two-key".into())] }]);
        let old_link = tokio::time::timeout(std::time::Duration::from_secs(1), link).await.expect("the old link is cut").unwrap();
        assert!(old_link.contains("Psalm 23:2"));
        assert!(get_with(port, "/feed/hall?k=tv-two-key", "", None).await.contains("feed page"));
        assert!(!two.is_finished(), "the other TV still follows");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert_eq!(feeds.status("hall").unwrap().tvs[0].watching, 1);
        two.abort();
        let mut h = result.handle;
        h.stop();
    }

    /// A stand-in camera router: records each request and answers like MediaMTX's WHIP.
    async fn fake_router() -> (u16, Arc<Mutex<Vec<String>>>) {
        let seen: Arc<Mutex<Vec<String>>> = Arc::default();
        let log = seen.clone();
        let app = Router::new().fallback(move |method: axum::http::Method, uri: axum::http::Uri, headers: HeaderMap, body: String| {
            let log = log.clone();
            async move {
                let h = |n: &str| headers.get(n).and_then(|v| v.to_str().ok()).unwrap_or("-").to_string();
                log.lock().unwrap().push(format!("{method} {} auth={} type={} if-match={} body={body}", uri.path(), h("authorization"), h("content-type"), h("if-match")));
                if method == axum::http::Method::POST {
                    (StatusCode::CREATED, [("content-type", "application/sdp"), ("location", "/pulpit/whip/5e55-10n"), ("etag", "\"x1\""), ("www-authenticate", "Basic realm=\"mediamtx\"")], "v=0 answer".to_string()).into_response()
                } else {
                    StatusCode::NO_CONTENT.into_response()
                }
            }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (port, seen)
    }

    #[tokio::test]
    async fn a_camera_page_publishes_through_rhema_with_its_secret_only() {
        let cameras = crate::cameras::new_camera_hub();
        cameras.set(&[("pulpit".into(), "0123456789abcdef".into())]);
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), cameras: cameras.clone(), ..Default::default() };
        let result = start_http_server(config, Arc::new(MockSink::new()), new_shared_status()).await.expect("bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let send = |method: &'static str, path: &'static str, body: &'static str, extra: &'static str| async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            s.write_all(format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            let mut out = String::new();
            s.read_to_string(&mut out).await.unwrap();
            out
        };

        // The page itself: only with the camera's secret.
        assert!(send("GET", "/camera?name=pulpit&k=0123456789abcdef", "", "").await.contains("200 OK"));
        assert!(send("GET", "/camera?name=pulpit&k=wrong", "", "").await.contains("403"));
        assert!(send("GET", "/camera?name=choir&k=0123456789abcdef", "", "").await.contains("403"));

        // Router off: the page hears so.
        let off = send("POST", "/api/v1/camera/pulpit/whip?k=0123456789abcdef", "v=0 offer", "Content-Type: application/sdp\r\n").await;
        assert!(off.contains("503"), "{off}");

        let (router, seen) = fake_router().await;
        cameras.set_router(Some(crate::cameras::RouterTarget { base: format!("http://127.0.0.1:{router}"), srt_port: 8890, srt_passphrase: "Passphrase0123456789".into() }));
        // Without the secret nothing reaches the router.
        assert!(send("POST", "/api/v1/camera/pulpit/whip", "v=0 offer", "Content-Type: application/sdp\r\n").await.contains("403"));
        assert!(send("POST", "/api/v1/camera/pulpit/whip?k=wrong", "v=0 offer", "Content-Type: application/sdp\r\n").await.contains("403"));
        assert!(send("DELETE", "/api/v1/camera/pulpit/whip/5e55-10n?k=wrong", "", "").await.contains("403"));
        assert!(seen.lock().unwrap().is_empty());

        // The offer goes on with Rhema's sign-in; the answer and the session address come back.
        let ok = send("POST", "/api/v1/camera/pulpit/whip?k=0123456789abcdef", "v=0 offer", "Content-Type: application/sdp\r\n").await;
        assert!(ok.contains("201 Created") && ok.contains("v=0 answer"), "{ok}");
        assert!(ok.to_ascii_lowercase().contains("location: /api/v1/camera/pulpit/whip/5e55-10n"), "{ok}");
        assert!(ok.to_ascii_lowercase().contains("etag: \"x1\""), "{ok}");
        assert!(!ok.to_ascii_lowercase().contains("www-authenticate"), "the phone is never asked to sign in: {ok}");
        let patch = send("PATCH", "/api/v1/camera/pulpit/whip/5e55-10n?k=0123456789abcdef", "a=candidate:1", "Content-Type: application/trickle-ice-sdpfrag\r\nIf-Match: \"x1\"\r\n").await;
        assert!(patch.contains("204"), "{patch}");
        assert!(send("DELETE", "/api/v1/camera/pulpit/whip/5e55-10n?k=0123456789abcdef", "", "").await.contains("204"));
        assert!(send("DELETE", "/api/v1/camera/pulpit/whip/bad%2Fid?k=0123456789abcdef", "", "").await.contains("404"));

        let seen = seen.lock().unwrap().clone();
        let basic = "Basic Y2FtLXB1bHBpdDowMTIzNDU2Nzg5YWJjZGVm"; // cam-pulpit:<its secret>: each camera signs in as itself
        assert_eq!(seen, vec![
            format!("POST /pulpit/whip auth={basic} type=application/sdp if-match=- body=v=0 offer"),
            format!("PATCH /pulpit/whip/5e55-10n auth={basic} type=application/trickle-ice-sdpfrag if-match=\"x1\" body=a=candidate:1"),
            format!("DELETE /pulpit/whip/5e55-10n auth={basic} type=- if-match=- body="),
        ]);

        // The Cam app's battery and heat: with the camera's secret in a header only.
        let report = r#"{"battery":54,"charging":true,"temperature":33.5,"thermal":0,"cooling":false}"#;
        assert!(send("POST", "/api/v1/camera/pulpit/status", report, "Content-Type: application/json\r\nAuthorization: Bearer wrong\r\n").await.contains("403"));
        assert!(send("POST", "/api/v1/camera/pulpit/status?k=0123456789abcdef", report, "Content-Type: application/json\r\n").await.contains("403"), "never the secret in the address");
        assert!(send("POST", "/api/v1/camera/pulpit/status", "not json", "Authorization: Bearer 0123456789abcdef\r\n").await.contains("400"));
        assert!(send("POST", "/api/v1/camera/pulpit/status", report, "Content-Type: application/json\r\nAuthorization: Bearer 0123456789abcdef\r\n").await.contains("204"));
        assert_eq!(cameras.phone("pulpit").map(|p| (p.status.battery, p.status.charging)), Some((Some(54.0), true)));
        // A removed camera's link stops at once.
        cameras.set(&[]);
        assert!(send("POST", "/api/v1/camera/pulpit/whip?k=0123456789abcdef", "v=0 offer", "Content-Type: application/sdp\r\n").await.contains("403"));
        let mut h = result.handle;
        h.stop();
    }

    #[tokio::test]
    async fn open_keys_show_the_live_state_to_this_computer_only() {
        let live = new_live_hub();
        live.publish("{}".into());
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), live, ..Default::default() };
        let result = start_http_server(config, Arc::new(MockSink::new()), new_shared_status()).await.expect("bind");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        // The test connects from 127.0.0.1: allowed. A LAN peer gets 403 (live_reader).
        assert!(get_with(result.bound_port, "/api/v1/live", "", None).await.contains("200 OK"));
        let mut h = result.handle;
        h.stop();
    }

    #[tokio::test]
    async fn health_endpoint_returns_ok() {
        let sink = Arc::new(MockSink::new());
        let status = new_shared_status();
        let config = HttpConfig {
            port: 0,
            host: "127.0.0.1".into(),
        ..Default::default()
        };

        let result = start_http_server(config, sink, status)
            .await
            .expect("should bind");
        let port = result.bound_port;

        // Give server a moment to start accepting
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let resp = raw_http_request(port, "GET", "/api/v1/health", None).await;
        assert!(resp.contains("200 OK"), "Expected 200, got: {resp}");
        assert!(resp.contains("\"status\":\"ok\""));
        assert!(resp.contains("\"service\":\"rhema\""));

        let mut handle = result.handle;
        handle.stop();
    }

    #[tokio::test]
    async fn status_endpoint_returns_snapshot() {
        let sink = Arc::new(MockSink::new());
        let status = new_shared_status();

        // Pre-populate status
        {
            let mut s = status.write().await;
            s.on_air = true;
            s.confidence_threshold = 0.75;
        }

        let config = HttpConfig {
            port: 0,
            host: "127.0.0.1".into(),
        ..Default::default()
        };

        let result = start_http_server(config, sink, status)
            .await
            .expect("should bind");
        let port = result.bound_port;

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let resp = raw_http_request(port, "GET", "/api/v1/status", None).await;
        assert!(resp.contains("200 OK"), "Expected 200, got: {resp}");
        assert!(resp.contains("\"on_air\":true"));
        assert!(resp.contains("\"confidence_threshold\":0.75"));

        let mut handle = result.handle;
        handle.stop();
    }

    /// The path asserted here is the one `documentation/remote-control.md`
    /// publishes. Issue #146 shipped because this test asserted the path the
    /// router happened to mount instead, so the two could drift apart and
    /// still pass.
    #[tokio::test]
    async fn a_retried_press_reaches_the_app_once_and_old_clients_still_work() {
        let sink = Arc::new(MockSink::new());
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), ..Default::default() };
        let result = start_http_server(config, sink.clone(), new_shared_status()).await.expect("should bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let press = r#"{"command":"next","id":"press-7"}"#;
        for _ in 0..2 {
            let r = raw_http_request(port, "POST", "/api/v1/command", Some(press)).await;
            assert!(r.contains("200 OK"), "Expected 200, got: {r}");
        }
        let old = raw_http_request(port, "POST", "/api/v1/command", Some(r#"{"command":"next"}"#)).await;
        assert!(old.contains("200 OK"), "a client without ids still works: {old}");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert_eq!(sink.command_count(), 2, "the retried press once, the old client's once");
        let mut handle = result.handle;
        handle.stop();
    }

    #[tokio::test]
    async fn a_failed_dispatch_can_be_retried_without_advancing_live_revision() {
        let sink = Arc::new(FailOnceSink { event_attempts: std::sync::atomic::AtomicUsize::new(0) });
        let live = new_live_hub();
        live.publish(r#"{"event":{"mode":"own","currentId":"prayer"}}"#.into());
        let initial_revision = live.revision("event").unwrap();
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), live: live.clone(), ..Default::default() };
        let result = start_http_server(config, sink.clone(), new_shared_status()).await.expect("should bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let press = r#"{"command":"event_next","id":"retry-after-failure"}"#;

        let first = raw_http_request(port, "POST", "/api/v1/command", Some(press)).await;
        assert!(first.contains("500 Internal Server Error"), "failed dispatch should be reported: {first}");
        assert_eq!(live.revision("event"), Some(initial_revision), "failure must not make other desks stale");

        let retry = raw_http_request(port, "POST", "/api/v1/command", Some(press)).await;
        assert!(retry.contains("200 OK"), "a retry should be dispatched successfully: {retry}");
        assert_eq!(sink.event_attempts.load(std::sync::atomic::Ordering::SeqCst), 2, "the failed request must not be mistaken for an already carried-out press");
        assert_eq!(live.revision("event"), Some(initial_revision + 1), "only successful dispatch advances the revision");

        let duplicate = raw_http_request(port, "POST", "/api/v1/command", Some(press)).await;
        assert!(
            duplicate.contains("200 OK"),
            "a successful retry remains idempotent: {duplicate}"
        );
        assert_eq!(
            sink.event_attempts
                .load(std::sync::atomic::Ordering::SeqCst),
            2,
            "a completed press is not dispatched twice"
        );
        let conflicting = raw_http_request(
            port,
            "POST",
            "/api/v1/command",
            Some(r#"{"command":"hold","value":"Wait","id":"retry-after-failure"}"#),
        )
        .await;
        assert!(
            conflicting.contains("409 Conflict") && conflicting.contains("id-conflict"),
            "the same id cannot acknowledge a different command: {conflicting}"
        );
        assert_eq!(
            sink.event_attempts
                .load(std::sync::atomic::Ordering::SeqCst),
            2,
            "a conflicting id reuse is not dispatched"
        );
        let mut handle = result.handle;
        handle.stop();
    }

    /// An OBS companion (#209): pairs as one, reads the cameras with its own sign-in, reports its
    /// tally; a paused companion and any other desk are refused.
    #[tokio::test]
    async fn an_obs_companion_reads_the_cameras_with_its_own_sign_in() {
        use crate::keys::{hash_key, KeyEntry, Keys, Role};
        let sink = Arc::new(MockSink::new());
        let entry = |tok: &str, name: &str, role| KeyEntry {
            hash: hash_key(tok),
            name: name.into(),
            role,
            paused: false,
            output_scope: Vec::new(),
            group_take_scope: Vec::new(),
            record: false,
        };
        let keys: KeySet = Arc::new(std::sync::RwLock::new(Keys {
            require_auth: true,
            entries: vec![
                entry("comp", "Media desk", Role::ObsCompanion),
                entry("pres", "Phone", Role::Present),
            ],
        }));
        let cameras = crate::cameras::new_camera_hub();
        cameras.set(&[("pulpit".into(), "0123456789abcdef0123".into())]);
        cameras.sync_readers(&[(hash_key("comp"), "Media desk".into())]);
        cameras.set_router(Some(crate::cameras::RouterTarget { base: "http://127.0.0.1:8889".into(), srt_port: 8890, srt_passphrase: "Passphrase0123456789".into() }));
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), keys: keys.clone(), cameras: cameras.clone(), ..Default::default() };
        let result = start_http_server(config, sink, new_shared_status()).await.expect("should bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let comp = "X-Rhema-Key: comp\r\n";
        let watch = get_with(port, "/api/v1/cameras/watch", comp, None).await;
        assert!(watch.contains("200 OK") && watch.contains(r#""user":"read-"#) && watch.contains(r#""name":"pulpit""#), "{watch}");
        assert!(!watch.contains("0123456789abcdef0123"), "never the camera's publishing secret: {watch}");
        let phone = get_with(port, "/api/v1/cameras/watch", "X-Rhema-Key: pres\r\n", None).await;
        assert!(phone.contains("403") && phone.contains("OBS companion"), "{phone}");
        assert!(get_with(port, "/api/v1/cameras/watch", "X-Rhema-Key: nope\r\n", None).await.contains("401"));
        let tally = raw_http_request_with(port, "POST", "/api/v1/cameras/tally", Some(r#"{"program":["pulpit"],"preview":[],"receiving":["pulpit"]}"#), comp).await;
        assert!(tally.contains("204"), "{tally}");
        cameras.set_watch(vec![crate::cameras::CameraWatch { name: "pulpit".into(), live: true, ..Default::default() }]);
        assert_eq!(cameras.watch()[0].obs[0].desk, "Media desk");
        assert!(cameras.watch()[0].obs[0].program);
        keys.write().unwrap().entries[0].paused = true;
        let paused = get_with(port, "/api/v1/cameras/watch", comp, None).await;
        assert!(paused.contains("423") && paused.contains("taken back control"), "{paused}");
        let mut handle = result.handle;
        handle.stop();
    }

    /// Pairing as an OBS companion gives that role (less than Present); asking for more gives Present.
    #[tokio::test]
    async fn a_device_pairs_as_an_obs_companion_or_as_present() {
        let sink = Arc::new(MockSink::new());
        let keys = crate::keys::new_key_set();
        let pairing = crate::keys::new_pairing_window();
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), keys: keys.clone(), pairing: pairing.clone(), ..Default::default() };
        let result = start_http_server(config, sink, new_shared_status()).await.expect("should bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let code = crate::keys::open_pairing(&pairing);
        let r = raw_http_request_with(port, "POST", "/api/v1/pair", Some(&format!(r#"{{"code":"{code}","name":"OBS computer","role":"obs-companion"}}"#)), "").await;
        assert!(r.contains("200 OK"), "{r}");
        let code = crate::keys::open_pairing(&pairing);
        let r = raw_http_request_with(port, "POST", "/api/v1/pair", Some(&format!(r#"{{"code":"{code}","name":"Sneaky","role":"configure"}}"#)), "").await;
        assert!(r.contains("200 OK"), "{r}");
        let roles: Vec<crate::keys::Role> = keys.read().unwrap().entries.iter().map(|e| e.role).collect();
        assert_eq!(roles, vec![crate::keys::Role::ObsCompanion, crate::keys::Role::Present]);
        let mut handle = result.handle;
        handle.stop();
    }

    /// Host authority (#243): the main desk takes back control of Desk C without unpairing it.
    #[tokio::test]
    async fn a_paused_desk_is_refused_commands_but_still_reads_and_talks() {
        let sink = Arc::new(MockSink::new());
        let keys = crate::keys::key_set_from(&[("tok", "Desk C")]);
        let live = new_live_hub();
        live.publish(r#"{"v":1,"service":{"id":"s1","title":"9 AM"}}"#.into());
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), keys: keys.clone(), live, ..Default::default() };
        let result = start_http_server(config, sink.clone(), new_shared_status()).await.expect("should bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let key = "X-Rhema-Key: tok\r\n";
        assert!(raw_http_request_with(port, "POST", "/api/v1/command", Some(r#"{"command":"next"}"#), key).await.contains("200 OK"));

        keys.write().unwrap().entries[0].paused = true;
        let refused = raw_http_request_with(port, "POST", "/api/v1/command", Some(r#"{"command":"event_next"}"#), key).await;
        assert!(refused.contains("423") && refused.contains("The main desk has taken back control"), "{refused}");
        let me = get_with(port, "/api/v1/me", key, None).await;
        assert!(me.contains(r#""paused":true"#), "{me}");
        let read = get_with(port, "/api/v1/live", key, None).await;
        assert!(read.contains("200 OK") && read.contains("9 AM"), "a paused desk still sees the service: {read}");
        let talk = raw_http_request_with(port, "POST", "/api/v1/command", Some(r#"{"command":"voice_talk","value":true}"#), key).await;
        assert!(talk.contains("200 OK"), "the talk channel keeps working: {talk}");
        let notice = raw_http_request_with(port, "POST", "/api/v1/command", Some(r#"{"command":"notice_send","value":{"text":"Ready when you are"}}"#), key).await;
        assert!(notice.contains("200 OK"), "notices keep working: {notice}");

        keys.write().unwrap().entries[0].paused = false;
        assert!(raw_http_request_with(port, "POST", "/api/v1/command", Some(r#"{"command":"event_next"}"#), key).await.contains("200 OK"), "control given back");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert_eq!(sink.command_count(), 4, "next, talk, notice, then event_next once given back");
        let mut handle = result.handle;
        handle.stop();
    }

    /// Scenes from a joined desk (#243 SC.16, SC.17): saved at once, sent to the main desk to accept,
    /// or refused when made from an older copy; full scenes only for desks that change them.
    #[tokio::test]
    async fn a_desk_saves_scenes_through_the_host_with_its_revision() {
        use crate::keys::{hash_key, KeyEntry, Keys, Role};
        let sink = Arc::new(MockSink::new());
        let entry = |tok: &str, name: &str, role| KeyEntry {
            hash: hash_key(tok),
            name: name.into(),
            role,
            paused: false,
            output_scope: Vec::new(),
            group_take_scope: Vec::new(),
            record: false,
        };
        let keys: KeySet = Arc::new(std::sync::RwLock::new(Keys {
            require_auth: true,
            entries: vec![
                entry("scr", "Screens desk", Role::Screens),
                entry("bib", "Bible desk", Role::Bible),
                entry("obs", "OBS desk", Role::Obs),
            ],
        }));
        let live = new_live_hub();
        let state = |welcome: &str| format!(r#"{{"v":1,"program":{{"onAir":true,"rehearsal":false}},"scenes":[{{"id":"off","name":"{welcome}","onScreen":false,"layers":[]}},{{"id":"on","name":"Sermon","onScreen":true,"layers":[{{"id":"b","kind":"feed"}}]}}]}}"#);
        live.publish(state("Welcome"));
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), keys, live: live.clone(), ..Default::default() };
        let result = start_http_server(config, sink.clone(), new_shared_status()).await.expect("should bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let send = |body: String, key: &'static str| async move { raw_http_request_with(port, "POST", "/api/v1/command", Some(&body), key).await };
        let scr = "X-Rhema-Key: scr\r\n";
        let (off, on) = (live.revision("scene:off").unwrap(), live.revision("scene:on").unwrap());

        let direct = send(format!(r#"{{"command":"save_scene","value":{{"scene":{{"id":"off","name":"Welcome 2","layers":[]}}}},"seen":{{"scene:off":{off}}}}}"#), scr).await;
        assert!(direct.contains("200 OK") && !direct.contains("note"), "{direct}");
        let sent: serde_json::Value = serde_json::from_str(sink.scene.lock().unwrap().as_deref().unwrap()).unwrap();
        assert_eq!((sent["request"].as_bool(), sent["by"].as_str(), sent["byId"].as_str()), (Some(false), Some("Screens desk"), Some(hash_key("scr").as_str())));
        // A second desk still on the old copy is refused, as for any other command.
        let stale = send(format!(r#"{{"command":"save_scene","value":{{"scene":{{"id":"off","layers":[]}}}},"seen":{{"scene:off":{off}}}}}"#), scr).await;
        assert!(stale.contains("409") && stale.contains(r#""code":"stale""#) && stale.contains("Someone changed this first"), "{stale}");
        // The main desk saving the scene moves its revision too.
        live.publish(state("Welcome 3"));
        let now = live.revision("scene:off").unwrap();
        assert!(now > off + 1, "the server's accept and the host's change");

        let waits = send(format!(r#"{{"command":"save_scene","value":{{"scene":{{"id":"on","name":"Sermon","layers":[]}},"request":false}},"seen":{{"scene:on":{on}}}}}"#), scr).await;
        assert!(waits.contains("200 OK") && waits.contains("Sent to the main desk to accept, because that scene is on a screen"), "{waits}");
        let sent: serde_json::Value = serde_json::from_str(sink.scene.lock().unwrap().as_deref().unwrap()).unwrap();
        assert_eq!(sent["request"].as_bool(), Some(true), "a desk cannot say it needs no approval");
        assert_eq!(live.revision("scene:on"), Some(on), "a change that waits has not changed the scene");

        // A scene deleted on the main desk: a change from before is refused.
        live.publish(r#"{"v":1,"program":{"onAir":true,"rehearsal":false},"scenes":[]}"#.into());
        let gone = send(format!(r#"{{"command":"save_scene","value":{{"scene":{{"id":"on","layers":[]}}}},"seen":{{"scene:on":{on}}}}}"#), scr).await;
        assert!(gone.contains("409") && gone.contains(r#""code":"stale""#), "{gone}");
        live.publish(state("Welcome"));
        let bible = send(r#"{"command":"save_scene","value":{"scene":{"id":"n","layers":[]}}}"#.into(), "X-Rhema-Key: bib\r\n").await;
        assert!(bible.contains("403") && bible.contains("activate, step and clear the Bible only"), "{bible}");

        // The Bible desk gets each scene's name; the screens desk gets the whole scene to edit.
        let read = |key: &'static str| async move { get_with(port, "/api/v1/live", key, None).await };
        let b = read("X-Rhema-Key: bib\r\n").await;
        assert!(b.contains("Sermon") && !b.contains("layers"), "{b}");
        assert!(read(scr).await.contains(r#""layers""#));

        // OBS through the host, never in rehearsal; and only for the OBS director.
        assert!(send(r#"{"command":"obs_take"}"#.into(), "X-Rhema-Key: obs\r\n").await.contains("200 OK"));
        assert!(send(r#"{"command":"obs_take"}"#.into(), scr).await.contains("403"));
        live.publish(r#"{"v":1,"program":{"onAir":true,"rehearsal":true},"scenes":[]}"#.into());
        let rehearsal = send(r#"{"command":"obs_program","value":"Wide"}"#.into(), "X-Rhema-Key: obs\r\n").await;
        assert!(rehearsal.contains("403") && rehearsal.contains("Rehearsal is on"), "{rehearsal}");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert_eq!(sink.command_count(), 3, "two scene saves and one OBS take reached the app");
        let mut handle = result.handle;
        handle.stop();
    }

    /// Several services never share state (#246 C16): a desk looking at another service is refused.
    #[tokio::test]
    async fn a_command_for_another_service_is_refused_and_untagged_ones_still_work() {
        let sink = Arc::new(MockSink::new());
        let live = new_live_hub();
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), live: live.clone(), ..Default::default() };
        let result = start_http_server(config, sink.clone(), new_shared_status()).await.expect("should bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let send = |body: &'static str| async move { raw_http_request(port, "POST", "/api/v1/command", Some(body)).await };
        assert!(send(r#"{"command":"next","service":"s9"}"#).await.contains("200 OK"), "before the host has said which service, nothing is refused");

        live.publish(r#"{"v":1,"service":{"id":"s11","title":"11 AM","revision":4}}"#.into());
        let other = send(r#"{"command":"next","service":"s9"}"#).await;
        assert!(other.contains("409") && other.contains("That desk is looking at a different service; it will refresh"), "{other}");
        assert!(send(r#"{"command":"next","service":"s11"}"#).await.contains("200 OK"));
        assert!(send(r#"{"command":"next"}"#).await.contains("200 OK"), "the phone page and older desks send no service");
        assert!(send(r#"{"command":"voice_talk","value":false,"service":"s9"}"#).await.contains("200 OK"), "crew talk is not about a service");

        live.publish(r#"{"v":1,"service":null}"#.into());
        assert!(send(r#"{"command":"next","service":""}"#).await.contains("200 OK"), "no service open on either");
        assert!(send(r#"{"command":"next","service":"s11"}"#).await.contains("409"));
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert_eq!(sink.command_count(), 5);
        let mut handle = result.handle;
        handle.stop();
    }

    #[test]
    fn the_service_is_read_from_the_live_state_and_the_command_field_is_optional() {
        assert_eq!(service_of(r#"{"v":1,"service":{"id":"s1","title":"x","revision":2}}"#).as_deref(), Some("s1"));
        assert_eq!(service_of(r#"{"v":1,"service":null}"#).as_deref(), Some(""));
        assert_eq!(service_of(r#"{"v":1,"service":{"title":"from an older build"}}"#), None);
        assert_eq!(service_of("not json"), None);
        let old: CommandRequest = serde_json::from_str(r#"{"command":"next","id":"p1"}"#).unwrap();
        assert_eq!((old.command, old.service), (RemoteCommand::Next, None));
        let tagged: CommandRequest = serde_json::from_str(r#"{"command":"bible_activate","value":"John 3:16","service":"s1"}"#).unwrap();
        assert_eq!((tagged.command, tagged.service.as_deref()), (RemoteCommand::BibleActivate("John 3:16".into()), Some("s1")));
    }

    #[tokio::test]
    async fn command_endpoint_requires_the_key_when_one_is_set() {
        let sink = Arc::new(MockSink::new());
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), keys: crate::keys::key_set_from(&[("s3cret", "Shared key")]), ..Default::default() };
        let result = start_http_server(config, sink.clone(), new_shared_status()).await.expect("should bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let body = r#"{"command":"next"}"#;
        let no_key = raw_http_request(port, "POST", "/api/v1/command", Some(body)).await;
        assert!(no_key.contains("401"), "Expected 401, got: {no_key}");
        let wrong = raw_http_request_with(port, "POST", "/api/v1/command", Some(body), "X-Rhema-Key: nope\r\n").await;
        assert!(wrong.contains("401"), "Expected 401, got: {wrong}");
        assert_eq!(sink.command_count(), 0);
        let header = raw_http_request_with(port, "POST", "/api/v1/command", Some(body), "X-Rhema-Key: s3cret\r\n").await;
        assert!(header.contains("200 OK"), "Expected 200, got: {header}");
        let bearer = raw_http_request_with(port, "POST", "/api/v1/command", Some(body), "Authorization: Bearer s3cret\r\n").await;
        assert!(bearer.contains("200 OK"), "Expected 200, got: {bearer}");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert_eq!(sink.command_count(), 2);
        // Health stays open so a controller can find the app.
        assert!(raw_http_request(port, "GET", "/api/v1/health", None).await.contains("200 OK"));
        let mut handle = result.handle;
        handle.stop();
    }

    #[tokio::test]
    async fn only_a_desk_granted_the_recorder_may_record_and_never_in_open_mode() {
        use crate::keys::{KeyEntry, Keys, Role};
        let sink = Arc::new(MockSink::new());
        let entry = |token: &str, name: &str, role: Role, record: bool| KeyEntry { hash: hash_key(token), name: name.into(), role, paused: false, output_scope: Vec::new(), group_take_scope: Vec::new(), record };
        let keys: KeySet = Arc::new(std::sync::RwLock::new(Keys {
            require_auth: true,
            entries: vec![entry("rec", "Media desk", Role::Viewer, true), entry("obs", "OBS desk", Role::Obs, false), entry("cfg", "Admin", Role::Configure, false)],
        }));
        let live = new_live_hub();
        live.publish(r#"{"v":1,"program":{"onAir":true,"rehearsal":false}}"#.into());
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), keys: keys.clone(), live, ..Default::default() };
        let result = start_http_server(config, sink.clone(), new_shared_status()).await.expect("should bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let send = |key: &'static str| async move { raw_http_request_with(port, "POST", "/api/v1/command", Some(r#"{"command":"record","value":{"action":"start"}}"#), key).await };
        // OBS director and Configure have no recorder authority without the grant.
        for key in ["X-Rhema-Key: obs\r\n", "X-Rhema-Key: cfg\r\n"] {
            let refused = send(key).await;
            assert!(refused.contains("403") && refused.contains("needs a separate grant"), "{refused}");
        }
        assert_eq!(sink.command_count(), 0);
        // The granted desk (a Viewer otherwise) reaches the host's recorder.
        let granted = send("X-Rhema-Key: rec\r\n").await;
        assert!(granted.contains("200 OK"), "{granted}");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert_eq!(sink.commands.lock().unwrap().as_slice(), ["recorder"]);
        // Open mode (no keys at all) gives nobody the recorder.
        {
            let mut k = keys.write().unwrap();
            k.require_auth = false;
            k.entries.clear();
        }
        let open = send("").await;
        assert!(open.contains("403"), "{open}");
        assert_eq!(sink.command_count(), 1);
        let mut handle = result.handle;
        handle.stop();
    }

    #[tokio::test]
    async fn pair_endpoint_hands_out_a_token_that_then_works() {
        let sink = Arc::new(MockSink::new());
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), keys: crate::keys::key_set_from(&[("s3cret", "Shared key")]), ..Default::default() };
        let pairing = config.pairing.clone();
        let result = start_http_server(config, sink.clone(), new_shared_status()).await.expect("should bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let closed = raw_http_request(port, "POST", "/api/v1/pair", Some(r#"{"code":"000000","name":"x"}"#)).await;
        assert!(closed.contains("404"), "{closed}");
        let code = crate::keys::open_pairing(&pairing);
        let wrong = raw_http_request(port, "POST", "/api/v1/pair", Some(r#"{"code":"not-it","name":"x"}"#)).await;
        assert!(wrong.contains("403") && wrong.contains("2 tries left"), "{wrong}");
        let ok = raw_http_request(port, "POST", "/api/v1/pair", Some(&format!(r#"{{"code":"{code}","name":"Tolu's phone"}}"#))).await;
        assert!(ok.contains("200 OK"), "{ok}");
        let body = ok.split("\r\n\r\n").nth(1).unwrap_or("");
        let v: serde_json::Value = serde_json::from_str(body.trim()).unwrap();
        let token = v["token"].as_str().unwrap().to_string();
        assert_eq!(token.len(), 64);
        let events = sink.commands.lock().unwrap().clone();
        assert!(events.iter().any(|e| e == "remote:paired") && events.last().map(String::as_str) == Some("remote:pair_closed"), "{events:?}");
        let cmd = raw_http_request_with(port, "POST", "/api/v1/command", Some(r#"{"command":"next"}"#), &format!("X-Rhema-Key: {token}\r\n")).await;
        assert!(cmd.contains("200 OK"), "{cmd}");
        // A paired device presents; it does not change settings. The shared key (configure) does.
        let theme = raw_http_request_with(port, "POST", "/api/v1/command", Some(r#"{"command":"theme","value":"Dark"}"#), &format!("X-Rhema-Key: {token}\r\n")).await;
        assert!(theme.contains("403"), "{theme}");
        let shared = raw_http_request_with(port, "POST", "/api/v1/command", Some(r#"{"command":"theme","value":"Dark"}"#), "X-Rhema-Key: s3cret\r\n").await;
        assert!(shared.contains("200 OK"), "{shared}");
        let mut handle = result.handle;
        handle.stop();
    }

    #[tokio::test]
    async fn a_flood_from_one_sender_is_refused_with_429() {
        let sink = Arc::new(MockSink::new());
        let result = start_http_server(HttpConfig { port: 0, host: "127.0.0.1".into(), ..Default::default() }, sink.clone(), new_shared_status()).await.expect("should bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let mut statuses = Vec::new();
        for _ in 0..30 {
            let resp = raw_http_request(port, "POST", "/api/v1/command", Some(r#"{"command":"next"}"#)).await;
            statuses.push(if resp.contains("200 OK") { 200 } else if resp.contains("429") { 429 } else { 0 });
        }
        assert!(statuses.iter().filter(|s| **s == 200).count() >= 20, "{statuses:?}");
        assert!(statuses.contains(&429), "{statuses:?}");
        assert!(!statuses.contains(&0), "{statuses:?}");
        let mut handle = result.handle;
        handle.stop();
    }

    #[tokio::test]
    async fn the_phone_remote_page_is_served_without_a_key() {
        let sink = Arc::new(MockSink::new());
        let result = start_http_server(HttpConfig { port: 0, host: "127.0.0.1".into(), ..Default::default() }, sink, new_shared_status()).await.expect("should bind");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let resp = raw_http_request(result.bound_port, "GET", "/remote", None).await;
        assert!(resp.contains("200 OK"), "{resp}");
        assert!(resp.contains("/api/v1/pair") && resp.contains("frame-ancestors 'none'"), "page and its CSP");
        let mut handle = result.handle;
        handle.stop();
    }

    #[tokio::test]
    async fn command_endpoint_dispatches_command() {
        let sink = Arc::new(MockSink::new());
        let status = new_shared_status();
        let config = HttpConfig {
            port: 0,
            host: "127.0.0.1".into(),
        ..Default::default()
        };

        let result = start_http_server(config, sink.clone(), status)
            .await
            .expect("should bind");
        let port = result.bound_port;

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let body = r#"{"command":"next"}"#;
        let resp = raw_http_request(port, "POST", "/api/v1/command", Some(body)).await;
        assert!(resp.contains("200 OK"), "Expected 200, got: {resp}");
        assert!(resp.contains("\"success\":true"));

        // Give dispatch a moment
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(sink.command_count() > 0, "Sink should have received command");

        let mut handle = result.handle;
        handle.stop();
    }

    #[tokio::test]
    async fn control_alias_still_dispatches() {
        let sink = Arc::new(MockSink::new());
        let status = new_shared_status();
        let config = HttpConfig {
            port: 0,
            host: "127.0.0.1".into(),
        ..Default::default()
        };

        let result = start_http_server(config, sink.clone(), status)
            .await
            .expect("should bind");
        let port = result.bound_port;

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let body = r#"{"command":"next"}"#;
        let resp = raw_http_request(port, "POST", "/api/v1/control", Some(body)).await;
        assert!(resp.contains("200 OK"), "Expected 200, got: {resp}");
        assert!(resp.contains("\"success\":true"));

        let mut handle = result.handle;
        handle.stop();
    }

    #[tokio::test]
    async fn command_endpoint_dispatches_send_to_live() {
        let sink = Arc::new(MockSink::new());
        let status = new_shared_status();
        let config = HttpConfig {
            port: 0,
            host: "127.0.0.1".into(),
        ..Default::default()
        };

        let result = start_http_server(config, sink.clone(), status)
            .await
            .expect("should bind");
        let port = result.bound_port;

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let body = r#"{"command":"send_to_live"}"#;
        let resp = raw_http_request(port, "POST", "/api/v1/command", Some(body)).await;
        assert!(resp.contains("200 OK"), "Expected 200, got: {resp}");
        assert!(resp.contains("\"success\":true"));

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(sink.command_count() > 0, "Sink should have received command");

        let mut handle = result.handle;
        handle.stop();
    }

    #[tokio::test]
    async fn port_conflict_returns_error() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();

        let sink = Arc::new(MockSink::new());
        let status = new_shared_status();
        let config = HttpConfig {
            port,
            host: "127.0.0.1".into(),
            ..Default::default()
        };

        let result = start_http_server(config, sink, status).await;
        assert!(result.is_err());
    }

    // --- Revisions and races between desks (#196 R7, #246 T6) ---

    #[test]
    fn each_part_of_the_service_has_a_revision_that_moves_only_when_it_changes() {
        let live = new_live_hub();
        let state = |current: &str, scene: &str, hold: &str| format!(r#"{{"v":1,"event":{{"mode":"own","currentId":{current}}},"outputs":[{{"id":"main","sceneId":{scene}}}],"hold":{hold},"sources":[{{"id":"bible","on":true,"revision":3}}],"timer":{{"running":false,"durationMs":0,"elapsedMs":0}}}}"#);
        live.publish(state("null", "null", "null"));
        let first = ["event", "output:main", "hold", "source:bible", "timer", "offset"].map(|p| live.revision(p));
        assert!(first.iter().all(Option::is_some), "{first:?}");
        // The same again (the heartbeat), even with the timer counting on: nothing moves.
        live.publish(state("null", "null", "null").replace(r#""elapsedMs":0"#, r#""elapsedMs":900"#));
        assert_eq!(["event", "output:main", "hold", "source:bible", "timer", "offset"].map(|p| live.revision(p)), first);
        live.publish(state(r#""sermon""#, r#""pulpit""#, "null"));
        assert_eq!(live.revision("event"), first[0].map(|n| n + 1));
        assert_eq!(live.revision("output:main"), first[1].map(|n| n + 1));
        assert_eq!(live.revision("hold"), first[2], "the hold did not change");
        // What a desk reads carries them.
        let served: serde_json::Value = serde_json::from_str(&live.current().unwrap()).unwrap();
        assert_eq!(served["revisions"]["event"].as_u64(), live.revision("event"));
        assert_eq!(served["event"]["currentId"], "sermon", "the Live State itself is as the app sent it");
        // An accepted command moves its part at once, before the app's next Live State.
        live.bump("hold");
        assert_eq!(live.revision("hold"), first[2].map(|n| n + 1));
        let after_bump: serde_json::Value = serde_json::from_str(&live.current().unwrap()).unwrap();
        assert_eq!(after_bump["revisions"]["hold"].as_u64(), live.revision("hold"), "accepted revisions are immediately visible in the Live State");
        assert_eq!(live.revision("camera:nowhere"), None);
        live.bump("camera:nowhere");
        assert_eq!(live.revision("camera:nowhere"), None, "a part the host never showed is not checked");
        // Not JSON (a test, a broken build): passed on as it is.
        live.publish("not json".into());
        assert_eq!(live.current().as_deref(), Some("not json"));
    }

    #[test]
    fn group_output_revisions_are_reserved_and_published_together_with_the_current_service() {
        let live = new_live_hub();
        let mut events = live.tx.subscribe();
        live.publish(serde_json::json!({
            "v": 1,
            "service": { "id": "service-a", "title": "Sunday" },
            "outputs": [
                { "id": "main", "name": "Sanctuary", "sceneId": null },
                { "id": "overflow", "name": "Overflow", "sceneId": null }
            ]
        }).to_string());
        let first: serde_json::Value = serde_json::from_str(&events.try_recv().unwrap()).unwrap();
        assert_eq!(live.service().as_deref(), Some("service-a"));

        let parts = ["output:main".to_string(), "output:overflow".to_string()];
        let before_main = live.revision(&parts[0]).unwrap();
        let before_overflow = live.revision(&parts[1]).unwrap();
        assert!(live.bump_many(&parts));

        let reserved_json = events.try_recv().unwrap();
        assert!(matches!(events.try_recv(), Err(broadcast::error::TryRecvError::Empty)));
        let reserved: serde_json::Value = serde_json::from_str(&reserved_json).unwrap();
        assert_eq!(reserved["revisions"]["output:main"].as_u64(), Some(before_main + 1));
        assert_eq!(reserved["revisions"]["output:overflow"].as_u64(), Some(before_overflow + 1));
        assert_eq!(live.current().as_deref(), Some(reserved_json.as_str()));
        assert_eq!(reserved["service"]["id"], first["service"]["id"]);

        live.publish(serde_json::json!({
            "v": 1,
            "service": { "id": "service-b", "title": "Evening" },
            "outputs": []
        }).to_string());
        let next_json = events.try_recv().unwrap();
        let next: serde_json::Value = serde_json::from_str(&next_json).unwrap();
        assert_eq!(live.service().as_deref(), Some("service-b"));
        assert_eq!(live.current().as_deref(), Some(next_json.as_str()));
        assert_eq!(next["service"]["id"], "service-b");
    }

    #[test]
    fn the_commands_that_change_live_state_name_their_part() {
        let part = |json: &str| revision_part(&serde_json::from_str::<RemoteCommand>(json).unwrap());
        assert_eq!(part(r#"{"command":"take_scene","value":{"output":"main","scene":"s"}}"#).as_deref(), Some("output:main"));
        assert_eq!(part(r#"{"command":"release_scene","value":"main"}"#).as_deref(), Some("output:main"));
        assert_eq!(part(r#"{"command":"clear_source","value":"ticker"}"#).as_deref(), Some("source:ticker"));
        assert_eq!(part(r#"{"command":"restore_source","value":"bible"}"#).as_deref(), Some("source:bible"));
        assert_eq!(part(r#"{"command":"hold","value":"Waiting"}"#).as_deref(), Some("hold"));
        assert_eq!(part(r#"{"command":"resume"}"#).as_deref(), Some("hold"));
        for timer in [r#"{"command":"timer_start"}"#, r#"{"command":"timer_pause"}"#, r#"{"command":"timer_adjust","value":1}"#] {
            assert_eq!(part(timer).as_deref(), Some("timer"));
        }
        for event in [r#"{"command":"event_next"}"#, r#"{"command":"event_prev"}"#, r#"{"command":"event_start","value":"x"}"#] {
            assert_eq!(part(event).as_deref(), Some("event"));
        }
        assert_eq!(part(r#"{"command":"event_offset","value":5}"#).as_deref(), Some("offset"));
        for unchecked in [r#"{"command":"verse_next"}"#, r#"{"command":"bible_activate","value":"John 3:16"}"#, r#"{"command":"notice_ack","value":{"id":"n","state":"seen"}}"#, r#"{"command":"next"}"#] {
            assert_eq!(part(unchecked), None, "{unchecked}");
        }
    }

    /// The host app as far as these tests need it: it carries out each command a little after the
    /// server hands it on (as the window does), keeps a service log line for each, and publishes its
    /// Live State again.
    struct HostSim {
        live: SharedLive,
        model: Arc<Mutex<Model>>,
    }

    #[derive(Default, Clone)]
    struct Model {
        scene: Option<String>,
        scene_revision: u64,
        hold: Option<String>,
        bible_on: bool,
        bible_revision: u64,
        /// The service log: one line per command carried out.
        journal: Vec<String>,
    }

    impl Model {
        fn live_state(&self) -> String {
            serde_json::json!({
                "v": 1, "service": { "id": "s1", "title": "9 AM" }, "event": { "mode": "own", "currentId": null },
                "outputs": [{ "id": "main", "name": "Main", "sceneId": self.scene, "sceneRevision": self.scene_revision }],
                "sources": [{ "id": "bible", "reference": "John 3:16", "on": self.bible_on, "revision": self.bible_revision }],
                "hold": self.hold.as_ref().map(|r| serde_json::json!({ "reason": r, "since": 1 })),
            })
            .to_string()
        }
    }

    impl HostSim {
        fn new(start: Model) -> Arc<Self> {
            let live = new_live_hub();
            live.publish(start.live_state());
            Arc::new(Self { live, model: Arc::new(Mutex::new(start)) })
        }
    }

    impl CommandSink for HostSim {
        fn emit_event(&self, event: &str, payload: &str) -> Result<(), CommandError> {
            let p: serde_json::Value = serde_json::from_str(payload).unwrap_or_default();
            let (model, live, event) = (self.model.clone(), self.live.clone(), event.to_string());
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(3));
                let mut m = model.lock().unwrap();
                let by = p["by"].as_str().unwrap_or("?").to_string();
                match event.as_str() {
                    "remote:take_scene" => { m.scene = p["scene"].as_str().map(String::from); m.scene_revision += 1; }
                    "remote:release_scene" => { m.scene = None; m.scene_revision += 1; }
                    "remote:clear_source" => { m.bible_on = false; }
                    "remote:restore_source" => { m.bible_on = true; }
                    // The hold store logs its own line (src/stores/hold-store.ts).
                    "remote:hold" => if m.hold.is_none() { m.hold = Some(p["reason"].as_str().unwrap_or("").to_string()); m.journal.push(format!("{by}: hold")); },
                    "remote:resume" => if m.hold.take().is_some() { m.journal.push(format!("{by}: resumed")); },
                    // The app's log line for each other command (use-remote-control.ts).
                    "remote:audit" => m.journal.push(format!("{} · by {by}", p["command"].as_str().unwrap_or("?"))),
                    _ => {}
                }
                live.publish(m.live_state());
            });
            Ok(())
        }
        fn invoke_backend(&self, _: &str, _: &str) -> Result<(), CommandError> {
            Ok(())
        }
    }

    const DESKS: [(&str, &str); 6] = [("ka", "Desk A"), ("kb", "Desk B"), ("kc", "Desk C"), ("kd", "Desk D"), ("ke", "Desk E"), ("kf", "Desk F")];

    async fn sim_server(host: &Arc<HostSim>) -> (u16, HttpHandle) {
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), keys: crate::keys::key_set_from(&DESKS), live: host.live.clone(), ..Default::default() };
        let result = start_http_server(config, host.clone(), new_shared_status()).await.expect("should bind");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        (result.bound_port, result.handle)
    }

    /// What a desk saw: the revisions in the Live State it read.
    async fn read_revisions(port: u16, key: &str) -> serde_json::Value {
        let r = get_with(port, "/api/v1/live", &format!("X-Rhema-Key: {key}\r\n"), None).await;
        let body = r.split("\r\n\r\n").nth(1).expect("a body");
        serde_json::from_str::<serde_json::Value>(body).expect("the Live State")["revisions"].clone()
    }

    /// Send one command as a desk and return the HTTP status and the body.
    async fn press(port: u16, key: &str, command: serde_json::Value) -> (u16, String) {
        let r = raw_http_request_with(port, "POST", "/api/v1/command", Some(&command.to_string()), &format!("X-Rhema-Key: {key}\r\n")).await;
        let status = r.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
        (status, r.split("\r\n\r\n").nth(1).unwrap_or("").to_string())
    }

    /// Every desk presses at the same moment, each with what it saw.
    async fn all_at_once(port: u16, presses: Vec<(&'static str, serde_json::Value)>) -> Vec<(u16, String)> {
        let barrier = Arc::new(tokio::sync::Barrier::new(presses.len()));
        let tasks: Vec<_> = presses
            .into_iter()
            .map(|(key, cmd)| {
                let barrier = barrier.clone();
                tokio::spawn(async move {
                    barrier.wait().await;
                    press(port, key, cmd).await
                })
            })
            .collect();
        let mut out = Vec::new();
        for t in tasks {
            out.push(t.await.expect("the press"));
        }
        out
    }

    async fn settle() {
        tokio::time::sleep(std::time::Duration::from_millis(80)).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn two_desks_taking_a_scene_at_once_one_wins_and_the_other_looks_again() {
        let host = HostSim::new(Model::default());
        let (port, mut handle) = sim_server(&host).await;
        let seen = read_revisions(port, "ka").await;
        let take = |scene: &str| serde_json::json!({ "command": "take_scene", "value": { "output": "main", "scene": scene }, "seen": seen, "service": "s1" });
        let results = all_at_once(port, vec![("ka", take("pulpit")), ("kb", take("choir"))]).await;
        let won: Vec<_> = results.iter().filter(|(s, _)| *s == 200).collect();
        let lost: Vec<_> = results.iter().filter(|(s, _)| *s == 409).collect();
        assert_eq!((won.len(), lost.len()), (1, 1), "{results:?}");
        assert!(lost[0].1.contains("Someone changed this first") && lost[0].1.contains(r#""code":"stale""#), "{}", lost[0].1);
        settle().await;
        let m = host.model.lock().unwrap().clone();
        let winner = if results[0].0 == 200 { "pulpit" } else { "choir" };
        assert_eq!(m.scene.as_deref(), Some(winner), "the output shows the scene that was accepted");
        assert_eq!(m.scene_revision, 1, "taken once");
        assert_eq!(m.journal.len(), 1, "one log line for the one take: {:?}", m.journal);
        // The other desk looks again and its take now goes through.
        let fresh = read_revisions(port, "kb").await;
        let (status, _) = press(port, "kb", serde_json::json!({ "command": "take_scene", "value": { "output": "main", "scene": "choir" }, "seen": fresh })).await;
        assert_eq!(status, 200);
        settle().await;
        let m = host.model.lock().unwrap().clone();
        assert_eq!((m.scene.as_deref(), m.journal.len()), (Some("choir"), 2));
        handle.stop();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn a_take_and_a_release_at_once_leave_one_consistent_output() {
        for round in 0..5 {
            let host = HostSim::new(Model { scene: Some("welcome".into()), scene_revision: 1, ..Model::default() });
            let (port, mut handle) = sim_server(&host).await;
            let seen = read_revisions(port, "ka").await;
            let results = all_at_once(port, vec![
                ("ka", serde_json::json!({ "command": "take_scene", "value": { "output": "main", "scene": "pulpit" }, "seen": seen })),
                ("kb", serde_json::json!({ "command": "release_scene", "value": "main", "seen": seen })),
            ])
            .await;
            assert_eq!(results.iter().filter(|(s, _)| *s == 200).count(), 1, "round {round}: {results:?}");
            settle().await;
            let m = host.model.lock().unwrap().clone();
            let expected = if results[0].0 == 200 { Some("pulpit") } else { None };
            assert_eq!(m.scene.as_deref(), expected, "round {round}");
            assert_eq!((m.scene_revision, m.journal.len()), (2, 1), "round {round}: {:?}", m.journal);
            handle.stop();
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn hold_and_resume_from_many_desks_at_once_is_carried_out_once() {
        let host = HostSim::new(Model { hold: Some("Waiting for the pastor".into()), ..Model::default() });
        let (port, mut handle) = sim_server(&host).await;
        let seen = read_revisions(port, "ka").await;
        // Three desks resume, three hold again with another reason, all from the same Live State.
        let presses = DESKS
            .iter()
            .enumerate()
            .map(|(i, (key, _))| (*key, if i % 2 == 0 { serde_json::json!({ "command": "resume", "seen": seen }) } else { serde_json::json!({ "command": "hold", "value": "Mic check", "seen": seen }) }))
            .collect();
        let results = all_at_once(port, presses).await;
        let accepted: Vec<usize> = results.iter().enumerate().filter(|(_, (s, _))| *s == 200).map(|(i, _)| i).collect();
        assert_eq!(accepted.len(), 1, "{results:?}");
        assert!(results.iter().all(|(s, _)| *s == 200 || *s == 409), "{results:?}");
        settle().await;
        let m = host.model.lock().unwrap().clone();
        if accepted[0] % 2 == 0 {
            assert_eq!((m.hold.as_deref(), m.journal.len()), (None, 1), "resumed once: {:?}", m.journal);
        } else {
            // A hold while held changes nothing (the hold store keeps the first one) and logs nothing.
            assert_eq!((m.hold.as_deref(), m.journal.len()), (Some("Waiting for the pastor"), 0), "{:?}", m.journal);
        }
        handle.stop();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn many_desks_clearing_and_restoring_a_source_at_once_one_goes_through() {
        let host = HostSim::new(Model { bible_on: true, bible_revision: 4, ..Model::default() });
        let (port, mut handle) = sim_server(&host).await;
        let seen = read_revisions(port, "ka").await;
        let presses = DESKS.iter().enumerate().map(|(i, (key, _))| (*key, serde_json::json!({ "command": if i % 2 == 0 { "clear_source" } else { "restore_source" }, "value": "bible", "seen": seen }))).collect();
        let results = all_at_once(port, presses).await;
        assert_eq!(results.iter().filter(|(s, _)| *s == 200).count(), 1, "{results:?}");
        settle().await;
        assert_eq!(host.model.lock().unwrap().journal.len(), 1, "one log line for the one accepted");
        handle.stop();
    }

    #[tokio::test]
    async fn without_revisions_commands_work_as_before_and_a_retry_is_never_called_stale() {
        let host = HostSim::new(Model::default());
        let (port, mut handle) = sim_server(&host).await;
        // The phone page, Companion and older desks send none: not checked.
        assert_eq!(press(port, "ka", serde_json::json!({ "command": "take_scene", "value": { "output": "main", "scene": "a" } })).await.0, 200);
        assert_eq!(press(port, "kb", serde_json::json!({ "command": "take_scene", "value": { "output": "main", "scene": "b" } })).await.0, 200);
        settle().await;
        let seen = read_revisions(port, "ka").await;
        let take = serde_json::json!({ "command": "take_scene", "value": { "output": "main", "scene": "c" }, "seen": seen, "id": "press-1" });
        assert_eq!(press(port, "ka", take.clone()).await.0, 200);
        // The same press again (its answer was lost): already done, not "someone changed this".
        assert_eq!(press(port, "ka", take).await.0, 200);
        // A part the desk did not see (an older host's Live State had no revisions): not checked.
        assert_eq!(press(port, "kb", serde_json::json!({ "command": "resume", "seen": {} })).await.0, 200);
        // Commands that are not checked carry on whatever was seen.
        assert_eq!(press(port, "kb", serde_json::json!({ "command": "verse_next", "seen": { "event": 0 } })).await.0, 200);
        settle().await;
        let m = host.model.lock().unwrap().clone();
        assert_eq!((m.scene.as_deref(), m.scene_revision), (Some("c"), 3));
        handle.stop();
    }

    struct Recorder(Mutex<Vec<(String, String)>>);
    impl CommandSink for Recorder {
        fn emit_event(&self, event: &str, payload: &str) -> Result<(), CommandError> {
            self.0.lock().unwrap().push((event.into(), payload.into()));
            Ok(())
        }
        fn invoke_backend(&self, _: &str, _: &str) -> Result<(), CommandError> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn an_unable_answer_carries_its_reason_to_the_app() {
        let sink = Arc::new(Recorder(Mutex::new(Vec::new())));
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), ..Default::default() };
        let result = start_http_server(config, sink.clone(), new_shared_status()).await.expect("should bind");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let port = result.bound_port;
        let unable = r#"{"command":"notice_ack","value":{"id":"n1","state":"unable"},"why":"  that verse\nwas not found "}"#;
        assert!(raw_http_request(port, "POST", "/api/v1/command", Some(unable)).await.contains("200 OK"));
        // An answer without a reason, and a reason beside another command, change nothing.
        assert!(raw_http_request(port, "POST", "/api/v1/command", Some(r#"{"command":"notice_ack","value":{"id":"n1","state":"seen"}}"#)).await.contains("200 OK"));
        assert!(raw_http_request(port, "POST", "/api/v1/command", Some(r#"{"command":"event_next","why":"x"}"#)).await.contains("200 OK"));
        let events = sink.0.lock().unwrap().clone();
        let v = |i: usize| serde_json::from_str::<serde_json::Value>(&events[i].1).unwrap();
        assert_eq!(events[0].0, "remote:notice_ack");
        assert_eq!((v(0)["state"].as_str(), v(0)["why"].as_str()), (Some("unable"), Some("that verse was not found")));
        assert!(v(1).get("why").is_none());
        assert!(events.iter().all(|(_, p)| !p.contains(r#""why":"x""#)), "{events:?}");
        let mut handle = result.handle;
        handle.stop();
    }

    /// Send exactly this request (with `{port}` filled in) and read the whole answer.
    async fn raw(port: u16, request: &str) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut stream = tokio::net::TcpStream::connect(format!("127.0.0.1:{port}")).await.expect("connect");
        stream.write_all(request.replace("{port}", &port.to_string()).as_bytes()).await.expect("write");
        let mut out = Vec::new();
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), stream.read_to_end(&mut out)).await;
        String::from_utf8_lossy(&out).into_owned()
    }

    #[test]
    fn the_origins_a_browser_may_call_from() {
        assert!(origin_allowed("http://192.168.1.20:8080", Some("192.168.1.20:8080")), "a page this listener served");
        assert!(origin_allowed("https://192.168.1.20:8081", Some("192.168.1.20:8081")), "the same over https (a TV's feed)");
        assert!(origin_allowed("HTTP://Studio.local:8080", Some("studio.local:8080")));
        for app in ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"] {
            assert!(origin_allowed(app, None), "{app}");
        }
        for (o, h) in [
            ("http://evil.example", Some("192.168.1.20:8080")),
            ("http://192.168.1.20:9999", Some("192.168.1.20:8080")),
            ("http://192.168.1.20:8080.evil.example", Some("192.168.1.20:8080")),
            ("http://192.168.1.20:8080/x", Some("192.168.1.20:8080")),
            ("null", Some("192.168.1.20:8080")),
            ("http://192.168.1.20:8080", None),
            ("file://", Some("x")),
            ("http://", Some("")),
            ("tauri://localhost.evil", None),
        ] {
            assert!(!origin_allowed(o, h), "{o} for {h:?}");
        }
    }

    #[test]
    fn only_this_computers_own_names_on_its_ports_are_trusted() {
        let ports = [8080, 8081];
        for ok in ["192.168.1.20:8080", "192.168.1.20:8081", "127.0.0.1:8080", "[::1]:8080", "[fe80::1]:8081", "localhost:8080", "Studio-Mac.local:8080", "LOCALHOST:8081"] {
            assert!(host_trusted(ok, &ports), "{ok}");
        }
        for bad in ["evil.example:8080", "evil.example", "192.168.1.20", "192.168.1.20:9090", "192.168.1.20:x", "[::1]", "[nonsense]:8080", "local:8080", ".local:8080", "evil.local.example:8080", "localhost.evil:8080", "", "1.2.3.4.5:8080"] {
            assert!(!host_trusted(bad, &ports), "{bad}");
        }
        assert!(browser_page("/feed/l3") && browser_page("/remote") && browser_page("/camera") && browser_page("/assets/feed.js") && browser_page("/api/v1/feed/l3/events") && browser_page("/api/v1/camera/pulpit/whip"));
        assert!(browser_page("/api/v1/status") && browser_page("/api/v1/health"));
        assert!(!browser_page("/api/v1/command") && !browser_page("/api/v1/live") && !browser_page("/remotes"));
    }

    #[tokio::test]
    async fn a_rebound_name_is_refused_and_the_address_works() {
        let sink = Arc::new(MockSink::new());
        let feeds = new_feed_hub();
        feeds.set(&[("l3".into(), "s3cret".into())]);
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), keys: key_set_from(&[("tok", "Laptop")]), feeds, ..Default::default() };
        let result = start_http_server(config, sink.clone(), new_shared_status()).await.expect("bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let post = |host: &str, origin: &str| format!("POST /api/v1/command HTTP/1.1\r\nHost: {host}\r\nOrigin: {origin}\r\nX-Rhema-Key: tok\r\nContent-Type: application/json\r\nContent-Length: 18\r\nConnection: close\r\n\r\n{{\"command\":\"next\"}}");
        // DNS rebinding: the attacker's name points at this computer; origin and host agree.
        let rebound = raw(port, &post("evil.example:{port}", "http://evil.example:{port}")).await;
        assert!(rebound.starts_with("HTTP/1.1 421"), "{rebound}");
        assert_eq!(sink.command_count(), 0);
        // This computer's address with its own page's origin: works.
        assert!(raw(port, &post("127.0.0.1:{port}", "http://127.0.0.1:{port}")).await.starts_with("HTTP/1.1 200"));
        assert_eq!(sink.command_count(), 1);
        // The phone and feed pages by address work; by another name they are refused, origin or not.
        assert!(raw(port, "GET /remote HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n").await.starts_with("HTTP/1.1 200"));
        // What is on air and the health answer need no key: by address yes, by a rebound name no.
        for path in ["/api/v1/status", "/api/v1/health"] {
            assert!(raw(port, &format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{{port}}\r\nConnection: close\r\n\r\n")).await.starts_with("HTTP/1.1 200"), "{path}");
        }
        for path in ["/remote", "/feed/l3?k=s3cret", "/api/v1/feed/l3/events?k=s3cret", "/camera?name=pulpit&k=x", "/api/v1/status", "/api/v1/health"] {
            let r = raw(port, &format!("GET {path} HTTP/1.1\r\nHost: evil.example:{{port}}\r\nConnection: close\r\n\r\n")).await;
            assert!(r.starts_with("HTTP/1.1 421"), "{path}: {r}");
        }
        // A controller that is not a browser (no origin) keeps working by key, whatever name it used.
        assert!(raw(port, &post("studio.lan:{port}", "").replace("Origin: \r\n", "")).await.starts_with("HTTP/1.1 200"));
        let mut h = result.handle;
        h.stop();
    }

    #[tokio::test]
    async fn another_web_page_on_the_network_cannot_send_commands_through_a_browser() {
        let sink = Arc::new(MockSink::new());
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), keys: key_set_from(&[("tok", "Laptop")]), ..Default::default() };
        let result = start_http_server(config, sink.clone(), new_shared_status()).await.expect("bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let post = |origin: &str| format!("POST /api/v1/command HTTP/1.1\r\nHost: 127.0.0.1:{{port}}\r\n{origin}X-Rhema-Key: tok\r\nContent-Type: application/json\r\nContent-Length: 18\r\nConnection: close\r\n\r\n{{\"command\":\"next\"}}");
        // A page from somewhere else, even with a key it got hold of: refused, nothing done.
        for origin in ["Origin: http://evil.example\r\n", "Origin: null\r\n", "Origin: http://127.0.0.1:1\r\n"] {
            let r = raw(port, &post(origin)).await;
            assert!(r.starts_with("HTTP/1.1 403"), "{origin}: {r}");
        }
        // Its plain form post (no preflight) is refused the same way.
        let form = raw(port, "POST /api/v1/command HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://evil.example\r\nContent-Type: text/plain\r\nContent-Length: 18\r\nConnection: close\r\n\r\n{\"command\":\"next\"}").await;
        assert!(form.starts_with("HTTP/1.1 403"), "{form}");
        assert_eq!(sink.command_count(), 0);
        // Reading the Live State or the feed stream from another page: refused too.
        let read = raw(port, "GET /api/v1/live HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://evil.example\r\nX-Rhema-Key: tok\r\nConnection: close\r\n\r\n").await;
        assert!(read.starts_with("HTTP/1.1 403"), "{read}");
        // A browser's preflight for another page gets no permission.
        let pre = raw(port, "OPTIONS /api/v1/command HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://evil.example\r\nAccess-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: content-type, x-rhema-key\r\nConnection: close\r\n\r\n").await;
        assert!(pre.starts_with("HTTP/1.1 403") && !pre.to_lowercase().contains("access-control-allow-origin"), "{pre}");
        // The phone page this listener served (same origin), Rhema's own window, and a controller
        // that is not a browser (no origin) all work.
        assert!(raw(port, &post("Origin: http://127.0.0.1:{port}\r\n")).await.starts_with("HTTP/1.1 200"));
        let app = raw(port, &post("Origin: tauri://localhost\r\n")).await;
        assert!(app.starts_with("HTTP/1.1 200") && app.to_lowercase().contains("access-control-allow-origin: tauri://localhost"), "{app}");
        assert!(raw(port, &post("")).await.starts_with("HTTP/1.1 200"));
        let pre = raw(port, "OPTIONS /api/v1/command HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://tauri.localhost\r\nAccess-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: content-type, x-rhema-key\r\nConnection: close\r\n\r\n").await;
        assert!(pre.starts_with("HTTP/1.1 200") && pre.to_lowercase().contains("access-control-allow-origin: http://tauri.localhost"), "{pre}");
        assert_eq!(sink.command_count(), 3);
        // Rhema's pages themselves load without an origin, as a browser asks for a page.
        assert!(raw(port, "GET /remote HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n").await.starts_with("HTTP/1.1 200"));
        let mut h = result.handle;
        h.stop();
    }

    #[tokio::test]
    async fn the_pages_rhema_serves_still_reach_it_from_their_own_origin() {
        // The feed page (OBS, a TV), its frames, acks and media, all from the page's own address.
        let feeds = new_feed_hub();
        feeds.set(&[("l3".into(), "s3cret".into())]);
        feeds.publish("l3", r#"{"verse":null}"#.into());
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), feeds, ..Default::default() };
        let result = start_http_server(config, Arc::new(PageSink), new_shared_status()).await.expect("bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let page = raw(port, "GET /feed/l3?k=s3cret HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n").await;
        assert!(page.starts_with("HTTP/1.1 200"), "{page}");
        let script = raw(port, "GET /assets/feed.js HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://127.0.0.1:{port}\r\nConnection: close\r\n\r\n").await;
        assert!(script.starts_with("HTTP/1.1 200"), "{script}");
        let ack = raw(port, "POST /api/v1/feed/l3/ack?k=s3cret HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: 9\r\nConnection: close\r\n\r\n{\"seq\":1}").await;
        assert!(!ack.starts_with("HTTP/1.1 403"), "{ack}");
        let events = get_with(port, "/api/v1/feed/l3/events?k=s3cret", &format!("Origin: http://127.0.0.1:{port}\r\n"), Some(200)).await;
        assert!(events.contains("text/event-stream"), "same origin: {events}");
        let foreign = raw(port, "GET /api/v1/feed/l3/events?k=s3cret HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://evil.example\r\nConnection: close\r\n\r\n").await;
        assert!(foreign.starts_with("HTTP/1.1 403"), "{foreign}");
        let mut h = result.handle;
        h.stop();
    }

    #[tokio::test]
    async fn pausing_revoking_or_changing_a_desk_ends_its_live_stream_at_once() {
        use crate::keys::{KeyEntry, Keys, Role};
        let desk = KeyEntry {
            hash: hash_key("tok"),
            name: "Desk C".into(),
            role: Role::Present,
            paused: false,
            output_scope: Vec::new(),
            group_take_scope: Vec::new(),
            record: false,
        };
        let keys: KeySet = Arc::new(std::sync::RwLock::new(Keys {
            require_auth: true,
            entries: vec![desk.clone()],
        }));
        let live = new_live_hub();
        live.publish(r#"{"v":1,"now":"Sermon"}"#.into());
        let presence = crate::presence::new_presence();
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), keys: keys.clone(), live, presence: presence.clone(), ..Default::default() };
        let result = start_http_server(config, Arc::new(MockSink::new()), new_shared_status()).await.expect("bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let follow = || tokio::spawn(async move { get_with(port, "/api/v1/live/events", "X-Rhema-Key: tok\r\n", None).await });
        let ended = |h: tokio::task::JoinHandle<String>| async move { tokio::time::timeout(std::time::Duration::from_secs(3), h).await.expect("the stream ended at once").unwrap() };

        // Connected: listed as connected on the host card.
        let stream = follow();
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        assert_eq!(presence.list().iter().map(|d| (d.name.as_str(), d.connected, d.address.as_str())).collect::<Vec<_>>(), [("Desk C", true, "127.0.0.1")]);
        // Paused: the stream ends with "rejoin"; the desk may connect again and still reads (paused).
        keys.write().unwrap().entries[0].paused = true;
        let out = ended(stream).await;
        assert!(out.contains("Sermon") && out.contains("event: rejoin"), "{out}");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(!presence.list()[0].connected, "no longer connected once its stream ended");
        assert!(get_with(port, "/api/v1/live", "X-Rhema-Key: tok\r\n", None).await.contains("200 OK"), "a paused desk still sees the service");
        // Another role: ends too (it is served by its new role when it comes back).
        let stream = follow();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        keys.write().unwrap().entries[0].role = Role::Screens;
        assert!(ended(stream).await.contains("event: rejoin"));
        // Nothing changed for this desk (the list pushed again as it was): the stream stays open.
        let stream = follow();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        let same = keys.read().unwrap().entries.clone();
        keys.write().unwrap().entries = same;
        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
        assert!(!stream.is_finished(), "an unchanged key keeps its stream");
        // A scope change is also an immediate rejoin, so the desk receives only its new output list.
        let stream = follow();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        keys.write().unwrap().entries[0].output_scope = vec!["sanctuary".into()];
        assert!(ended(stream).await.contains("event: rejoin"));
        let stream = follow();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        keys.write().unwrap().entries[0].output_scope = vec!["overflow".into()];
        assert!(ended(stream).await.contains("event: rejoin"));
        // Revoked: ends, and it cannot come back.
        let stream = follow();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        keys.write().unwrap().entries.clear();
        assert!(ended(stream).await.contains("event: rejoin"));
        assert!(get_with(port, "/api/v1/live/events", "X-Rhema-Key: tok\r\n", None).await.contains("401"));
        let mut h = result.handle;
        h.stop();
    }

    #[tokio::test]
    async fn stopping_hosting_ends_every_open_stream() {
        let live = new_live_hub();
        live.publish(r#"{"v":1}"#.into());
        let feeds = new_feed_hub();
        feeds.set(&[("l3".into(), "s3cret".into())]);
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), keys: key_set_from(&[("tok", "Laptop")]), live, feeds, ..Default::default() };
        let result = start_http_server(config, Arc::new(MockSink::new()), new_shared_status()).await.expect("bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let desk = tokio::spawn(async move { get_with(port, "/api/v1/live/events", "X-Rhema-Key: tok\r\n", None).await });
        let tv = tokio::spawn(async move { get_with(port, "/api/v1/feed/l3/events?k=s3cret", "", None).await });
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        let mut h = result.handle;
        h.stop();
        for s in [desk, tv] {
            let out = tokio::time::timeout(std::time::Duration::from_secs(3), s).await.expect("ended with the listener").unwrap();
            assert!(out.contains("text/event-stream"), "{out}");
        }
    }

    #[tokio::test]
    async fn health_says_the_https_port_so_a_joining_computer_pairs_over_it() {
        let ca = crate::tls::make_ca().unwrap();
        let server = crate::tls::make_server(&ca, &["127.0.0.1".into()]).unwrap();
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), tls: Some(TlsListener { port: 0, server, ca_cert: ca.cert.clone() }), ..Default::default() };
        let result = start_http_server(config, Arc::new(MockSink::new()), new_shared_status()).await.expect("bind");
        let tls_port = result.tls_port.expect("https port");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let health = raw_http_request(result.bound_port, "GET", "/api/v1/health", None).await;
        assert!(health.contains(&format!("\"tls_port\":{tls_port}")), "{health}");
        let mut h = result.handle;
        h.stop();
        let plain = start_http_server(HttpConfig { port: 0, host: "127.0.0.1".into(), ..Default::default() }, Arc::new(MockSink::new()), new_shared_status()).await.expect("bind");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(!raw_http_request(plain.bound_port, "GET", "/api/v1/health", None).await.contains("tls_port"), "no https: not said");
        let mut h = plain.handle;
        h.stop();
    }

    fn console_keys() -> KeySet {
        use crate::keys::{hash_key, KeyEntry, Keys, Role};
        let entry = |tok: &str, name: &str, role| KeyEntry {
            hash: hash_key(tok),
            name: name.into(),
            role,
            paused: false,
            output_scope: Vec::new(),
            group_take_scope: Vec::new(),
            record: false,
        };
        Arc::new(std::sync::RwLock::new(Keys {
            require_auth: true,
            entries: vec![entry("dir", "Director", Role::Present), entry("bib", "Bible desk", Role::Bible), entry("wor", "Worship desk", Role::Worship), entry("stg", "Stage desk", Role::Stage), entry("vie", "Pastor's phone", Role::Viewer)],
        }))
    }

    #[test]
    fn the_console_parts_go_only_to_their_desks() {
        use crate::keys::Role;
        let json = r#"{"v":1,"readiness":{"ready":false,"checks":[]},"heard":[{"reference":"John 3:16"}],"auxTimers":[],"outputMap":[],"lyrics":null,"graphicsQueue":{"planState":"approved","items":[]},"notices":[]}"#;
        let get = |role: Role| -> serde_json::Value { serde_json::from_str(&live_for(json, Some(&desk("Desk", role)))).unwrap() };
        for role in [Role::Present, Role::Configure] {
            let v = get(role);
            assert!(v.get("readiness").is_some() && v.get("heard").is_some(), "{role:?}");
            assert!(v.get("graphicsQueue").is_some(), "{role:?} gets the Screens graphics plan");
        }
        assert!(get(Role::Screens).get("graphicsQueue").is_some(), "Screens desk gets the upcoming graphics projection");
        for role in [Role::Bible, Role::Editor] {
            let v = get(role);
            assert!(v.get("readiness").is_none() && v.get("heard").is_some(), "{role:?}");
            assert!(v.get("graphicsQueue").is_none(), "{role:?} does not get Screens-specific details");
        }
        for role in [Role::Worship, Role::Stage, Role::Screens, Role::Timekeeper, Role::Camera, Role::Obs, Role::Viewer] {
            let v = get(role);
            assert!(v.get("readiness").is_none() && v.get("heard").is_none() && v.get("presence").is_none(), "{role:?}");
            assert_eq!(v.get("graphicsQueue").is_some(), role == Role::Screens, "{role:?} graphics queue access");
            assert!(v.get("auxTimers").is_some() && v.get("outputMap").is_some(), "{role:?} still gets the timers and the output map");
        }
        // A presence list a host's app sent itself never reaches a desk that may not see it.
        let spoofed = r#"{"v":1,"presence":[{"name":"x"}],"notices":[]}"#;
        assert!(!live_for(spoofed, Some(&desk("Desk", Role::Stage))).contains("presence"));
        assert_eq!(live_for(json, None), json, "this computer itself gets all of it");
        assert!(sees_crew(None) && sees_crew(Some(&desk("D", Role::Present))) && sees_crew(Some(&desk("D", Role::Configure))));
        assert!(!sees_crew(Some(&desk("D", Role::Bible))) && !sees_crew(Some(&desk("D", Role::Viewer))));
    }

    #[test]
    fn screens_live_state_contains_only_assigned_current_congregation_outputs() {
        use crate::keys::{KeyEntry, Role};
        let entry = KeyEntry {
            hash: "screen-key".into(),
            name: "Screens desk".into(),
            role: Role::Screens,
            paused: false,
            output_scope: vec!["sanctuary".into(), "stage".into()],
            group_take_scope: Vec::new(),
            record: false,
        };
        let json = r#"{"v":1,"outputs":[{"id":"sanctuary","name":"Sanctuary"},{"id":"overflow","name":"Overflow"},{"id":"stage","name":"Stage","role":"stage"},{"id":"lobby","name":"Lobby","role":"signage"}],"outputMap":[{"id":"sanctuary","name":"Sanctuary","role":"congregation"},{"id":"overflow","name":"Overflow","role":"congregation"},{"id":"stage","name":"Stage","role":"stage"},{"id":"lobby","name":"Lobby","role":"signage"}]}"#;
        let live: serde_json::Value = serde_json::from_str(&live_for(json, Some(&entry))).unwrap();
        let ids: Vec<_> = live["outputs"].as_array().unwrap().iter().filter_map(|output| output["id"].as_str()).collect();
        assert_eq!(ids, ["sanctuary"], "unassigned and protected outputs are not sent to the desk");
        let map_ids: Vec<_> = live["outputMap"].as_array().unwrap().iter().filter_map(|output| output["id"].as_str()).collect();
        assert_eq!(map_ids, ["sanctuary"], "the status map is scoped too");

        let map_only: serde_json::Value = serde_json::from_str(&live_for(
            r#"{"outputMap":[{"id":"sanctuary","role":"congregation"}]}"#,
            Some(&entry),
        )).unwrap();
        assert!(map_only["outputMap"].as_array().unwrap().is_empty(), "a map without a current output inventory fails closed");

        let malformed_map: serde_json::Value = serde_json::from_str(&live_for(
            r#"{"outputMap":{"sanctuary":{"role":"congregation"}}}"#,
            Some(&entry),
        )).unwrap();
        assert!(malformed_map["outputMap"].as_array().unwrap().is_empty(), "a non-array map is never passed through unfiltered");
    }

    #[test]
    fn group_take_results_are_only_visible_to_screens_with_every_target_granted() {
        use crate::keys::{KeyEntry, Role};
        let json = r#"{"v":1,"outputs":[{"id":"sanctuary","name":"Sanctuary"},{"id":"overflow","name":"Overflow"}],"groupTakeResults":[{"requestId":"r1","scene":"sermon","outputs":[{"id":"sanctuary","name":"Sanctuary","status":"host-applied"},{"id":"overflow","name":"Overflow","status":"host-applied"}]}]}"#;
        let mut screens = KeyEntry {
            hash: "screen-key".into(),
            name: "Screens desk".into(),
            role: Role::Screens,
            paused: false,
            output_scope: vec!["sanctuary".into(), "overflow".into()],
            group_take_scope: vec!["sanctuary".into(), "overflow".into()],
            record: false,
        };
        let allowed: serde_json::Value =
            serde_json::from_str(&live_for(json, Some(&screens))).unwrap();
        assert_eq!(allowed["groupTakeResults"].as_array().unwrap().len(), 1);

        screens.group_take_scope.pop();
        let partial: serde_json::Value =
            serde_json::from_str(&live_for(json, Some(&screens))).unwrap();
        assert!(partial["groupTakeResults"].as_array().unwrap().is_empty());

        let present: serde_json::Value =
            serde_json::from_str(&live_for(json, Some(&desk("Present", Role::Present)))).unwrap();
        assert!(present.get("groupTakeResults").is_none());
    }

    #[test]
    fn the_crew_list_names_desks_and_roles_but_never_addresses_or_keys() {
        let keys = console_keys();
        let presence = crate::presence::new_presence();
        let bible = keys.read().unwrap().entries[1].clone();
        let _open = presence.stream_opened(&bible, "192.168.1.40".parse().unwrap());
        let crew = crew_rows(&keys, &presence);
        let text = crew.to_string();
        assert!(!text.contains("192.168") && !text.contains(&bible.hash), "{text}");
        let rows = crew.as_array().unwrap();
        assert_eq!(rows.len(), 5);
        assert_eq!((rows[1]["name"].as_str(), rows[1]["role"].as_str(), rows[1]["connected"].as_bool()), (Some("Bible desk"), Some("bible"), Some(true)));
        assert_eq!((rows[0]["connected"].as_bool(), rows[0]["lastSeenMs"].is_null()), (Some(false), true), "never seen since hosting began");
        let with = with_crew(r#"{"v":1}"#.into(), crew);
        assert!(with.contains(r#""presence":[{"#));
        assert_eq!(with_crew("not json".into(), serde_json::json!([])), "not json");
    }

    #[test]
    fn a_section_step_acts_on_the_section_it_saw() {
        let mut r = Revisions::default();
        let state = |index: u32| serde_json::json!({ "lyrics": { "itemId": "s1", "index": index, "title": "Amazing Grace" } });
        r.observe(&state(0));
        let lyrics = r.get("lyrics").unwrap();
        r.observe(&state(0));
        assert_eq!(r.get("lyrics"), Some(lyrics), "the same section is not a change");
        r.observe(&state(2));
        assert_eq!(r.get("lyrics"), Some(lyrics + 1));
        assert_eq!(revision_part(&RemoteCommand::SongSection(1.into())).as_deref(), Some("lyrics"));
    }

    #[test]
    fn an_extra_timer_command_acts_on_the_timer_it_saw() {
        let mut r = Revisions::default();
        let timer = |running: bool, elapsed: u64| serde_json::json!({ "auxTimers": [{ "id": "t1", "label": "Communion", "durationMs": 300000, "elapsedMs": elapsed, "running": running }] });
        r.observe(&timer(true, 1000));
        let n = r.get("aux:t1").unwrap();
        r.observe(&timer(true, 5000));
        assert_eq!(r.get("aux:t1"), Some(n), "a running timer counting on is not a change");
        r.observe(&timer(false, 6000));
        assert_eq!(r.get("aux:t1"), Some(n + 1), "paused");
        r.observe(&timer(false, 0));
        assert_eq!(r.get("aux:t1"), Some(n + 2), "reset");
        assert_eq!(revision_part(&RemoteCommand::AuxTimer(crate::command::AuxTimerIn { id: "t1".into(), action: "start".into() })).as_deref(), Some("aux:t1"));
    }

    #[tokio::test]
    async fn section_steps_are_checked_for_role_and_staleness() {
        let sink = Arc::new(MockSink::new());
        let live = new_live_hub();
        let state = |lyrics: &str| format!(r#"{{"v":1,"program":{{"onAir":true,"rehearsal":false}},"lyrics":{lyrics}}}"#);
        live.publish(state(r#"{"itemId":"s1","index":0}"#));
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), keys: console_keys(), live: live.clone(), ..Default::default() };
        let result = start_http_server(config, sink.clone(), new_shared_status()).await.expect("should bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let send = |body: String, key: &'static str| async move { raw_http_request_with(port, "POST", "/api/v1/command", Some(&body), key).await };
        let (wor, stg, bib, dir) = ("X-Rhema-Key: wor\r\n", "X-Rhema-Key: stg\r\n", "X-Rhema-Key: bib\r\n", "X-Rhema-Key: dir\r\n");
        // Two desks on the same section: only the first step is carried out.
        let seen = live.revision("lyrics").unwrap();
        let step = format!(r#"{{"command":"song_section","value":1,"seen":{{"lyrics":{seen}}}}}"#);
        assert!(send(step.clone(), wor).await.contains("200 OK"));
        let again = send(step, dir).await;
        assert!(again.contains("409") && again.contains(r#""code":"stale""#), "{again}");
        assert!(send(r#"{"command":"song_section","value":1}"#.into(), bib).await.contains("403"), "the Bible desk does not step songs");
        assert!(send(r#"{"command":"song_section","value":1}"#.into(), stg).await.contains("403"));
        assert!(send(r#"{"command":"song_section","value":-1}"#.into(), "X-Rhema-Key: vie\r\n").await.contains("403"));
        // With no song up there is nothing to step.
        live.publish(state("null"));
        let none = send(r#"{"command":"song_section","value":-1}"#.into(), wor).await;
        assert!(none.contains("422") && none.contains("No song or hymn"), "{none}");
        assert_eq!(sink.commands.lock().unwrap().clone(), ["remote:song_section"]);
    }

    #[test]
    fn the_queue_and_obs_parts_move_only_when_they_change() {
        let mut r = Revisions::default();
        let state = |ids: &[&str], recording: serde_json::Value, transition: &str| serde_json::json!({
            "rundown": ids.iter().map(|id| serde_json::json!({ "id": id, "reference": id, "time": { "plan": [1, 2] } })).collect::<Vec<_>>(),
            "obs": { "connected": true, "recording": recording, "transition": transition },
        });
        r.observe(&state(&["a", "b"], serde_json::json!(false), "Fade"));
        let (q, rec, tr) = (r.get("queue").unwrap(), r.get("obs:record").unwrap(), r.get("obs:transition").unwrap());
        let mut moved = state(&["a", "b"], serde_json::json!(false), "Fade");
        moved["rundown"][0]["time"] = serde_json::json!({ "plan": [5, 9] });
        r.observe(&moved);
        assert_eq!((r.get("queue"), r.get("obs:record"), r.get("obs:transition")), (Some(q), Some(rec), Some(tr)), "times moving on are not a change");
        r.observe(&state(&["new", "a", "b"], serde_json::json!(true), "Cut"));
        assert_eq!((r.get("queue"), r.get("obs:record"), r.get("obs:transition")), (Some(q + 1), Some(rec + 1), Some(tr + 1)));
        use crate::command::{ObsRecordIn, QueueIn, QueueKind, RecordAction};
        assert_eq!(revision_part(&RemoteCommand::QueueRequest(QueueIn { kind: QueueKind::Song, value: "x".into() })).as_deref(), Some("queue"));
        assert_eq!(revision_part(&RemoteCommand::ObsRecord(ObsRecordIn { action: RecordAction::Marker, label: None })).as_deref(), Some("obs:record"));
        assert_eq!(revision_part(&RemoteCommand::ObsTransition("Cut".into())).as_deref(), Some("obs:transition"));
    }

    #[tokio::test]
    async fn round_two_commands_are_checked_for_role_staleness_and_rehearsal() {
        use crate::keys::{hash_key, KeyEntry, Keys, Role};
        let sink = Arc::new(MockSink::new());
        let entry = |tok: &str, name: &str, role| KeyEntry {
            hash: hash_key(tok),
            name: name.into(),
            role,
            paused: false,
            output_scope: Vec::new(),
            group_take_scope: Vec::new(),
            record: false,
        };
        let keys: KeySet = Arc::new(std::sync::RwLock::new(Keys {
            require_auth: true,
            entries: vec![
                entry("dir", "Director", Role::Present),
                entry("phn", "Ade's phone", Role::Present),
                entry("edt", "Editor", Role::Editor),
                entry("wor", "Worship desk", Role::Worship),
                entry("obs", "OBS desk", Role::Obs),
                entry("scr", "Screens desk", Role::Screens),
                entry("vie", "Pastor's phone", Role::Viewer),
            ],
        }));
        let live = new_live_hub();
        let state = |rehearsal: bool, recording: bool| format!(r#"{{"v":1,"program":{{"onAir":true,"rehearsal":{rehearsal}}},"rundown":[{{"id":"a","reference":"Welcome"}}],"obs":{{"connected":true,"recording":{recording},"transition":"Fade"}},"sources":[{{"id":"ticker","on":true,"revision":1}},{{"id":"lowerThird","on":true,"revision":1}}]}}"#);
        live.publish(state(false, false));
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), keys, live: live.clone(), ..Default::default() };
        let result = start_http_server(config, sink.clone(), new_shared_status()).await.expect("should bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let send = |body: String, tok: &'static str| async move { raw_http_request_with(port, "POST", "/api/v1/command", Some(&body), &format!("X-Rhema-Key: {tok}\r\n")).await };

        // Queue a request: the desks that add to the queue, once for the list they saw.
        let q = live.revision("queue").unwrap();
        let queue = format!(r#"{{"command":"queue_request","value":{{"kind":"song","value":"Amazing Grace"}},"seen":{{"queue":{q}}}}}"#);
        assert!(send(queue.clone(), "phn").await.contains("200 OK"), "a phone queues the song it was asked for");
        let twice = send(queue, "dir").await;
        assert!(twice.contains("409") && twice.contains(r#""code":"stale""#), "a second desk answering the same request looks again: {twice}");
        let q = live.revision("queue").unwrap();
        assert!(send(format!(r#"{{"command":"queue_request","value":{{"kind":"bible","value":"Romans 8:28"}},"seen":{{"queue":{q}}}}}"#), "edt").await.contains("200 OK"), "the editor queues");
        for tok in ["wor", "obs", "scr", "vie"] {
            assert!(send(r#"{"command":"queue_request","value":{"kind":"bible","value":"John 3:16"}}"#.into(), tok).await.contains("403"), "{tok}");
        }
        assert!(send(r#"{"command":"queue_request","value":{"kind":"scene","value":"s1"}}"#.into(), "dir").await.contains("422"), "only a verse or a song");

        // OBS's recording and transition: the OBS director only, on what it saw, never in rehearsal.
        let rec = live.revision("obs:record").unwrap();
        let start = format!(r#"{{"command":"obs_record","value":{{"action":"start"}},"seen":{{"obs:record":{rec}}}}}"#);
        assert!(send(start.clone(), "obs").await.contains("200 OK"));
        let again = send(start, "obs").await;
        assert!(again.contains("409") && again.contains(r#""code":"stale""#), "{again}");
        let refused = send(r#"{"command":"obs_record","value":{"action":"stop"}}"#.into(), "dir").await;
        assert!(refused.contains("403") && refused.contains("OBS director"), "{refused}");
        let tr = live.revision("obs:transition").unwrap();
        assert!(send(format!(r#"{{"command":"obs_transition","value":"Cut","seen":{{"obs:transition":{tr}}}}}"#), "obs").await.contains("200 OK"));
        assert!(send(r#"{"command":"obs_transition","value":"Cut"}"#.into(), "scr").await.contains("403"));
        live.publish(state(true, true));
        for body in [r#"{"command":"obs_record","value":{"action":"stop"}}"#, r#"{"command":"obs_record","value":{"action":"marker","label":"Sermon"}}"#, r#"{"command":"obs_transition","value":"Fade"}"#] {
            let r = send(body.into(), "obs").await;
            assert!(r.contains("403") && r.contains("Rehearsal is on"), "{body}: {r}");
        }

        // The screens desk takes the ticker and the lower third off and back; not the Bible.
        live.publish(state(false, true));
        let t = live.revision("source:ticker").unwrap();
        assert!(send(format!(r#"{{"command":"clear_source","value":"ticker","seen":{{"source:ticker":{t}}}}}"#), "scr").await.contains("200 OK"));
        let late = send(format!(r#"{{"command":"restore_source","value":"ticker","seen":{{"source:ticker":{t}}}}}"#), "dir").await;
        assert!(late.contains("409"), "{late}");
        assert!(send(r#"{"command":"restore_source","value":"lowerThird"}"#.into(), "scr").await.contains("200 OK"));
        assert!(send(r#"{"command":"clear_source","value":"bible"}"#.into(), "scr").await.contains("403"));
        // Repeat chorus: a section step for the worship desk, refused with no song up.
        let none = send(r#"{"command":"song_section","value":"chorus"}"#.into(), "wor").await;
        assert!(none.contains("422") && none.contains("No song or hymn"), "{none}");

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert_eq!(sink.commands.lock().unwrap().clone(), ["remote:queue_request", "remote:queue_request", "remote:obs_record", "remote:obs_transition", "remote:clear_source", "remote:restore_source"]);
        let mut handle = result.handle;
        handle.stop();
    }

    #[tokio::test]
    async fn screens_http_takes_require_assigned_current_congregation_outputs() {
        use crate::keys::{hash_key, KeyEntry, Keys, Role};
        let sink = Arc::new(MockSink::new());
        let keys: KeySet = Arc::new(std::sync::RwLock::new(Keys {
            require_auth: true,
            entries: vec![
                KeyEntry {
                    hash: hash_key("scoped"),
                    name: "Screens desk".into(),
                    role: Role::Screens,
                    paused: false,
                    output_scope: vec!["sanctuary".into(), "stage".into(), "lobby".into()],
                    group_take_scope: Vec::new(),
                    record: false,
                },
                KeyEntry {
                    hash: hash_key("legacy"),
                    name: "Legacy Screens".into(),
                    role: Role::Screens,
                    paused: false,
                    output_scope: Vec::new(),
                    group_take_scope: Vec::new(),
                    record: false,
                },
            ],
        }));
        let live = new_live_hub();
        live.publish(r#"{"v":1,"program":{"onAir":true,"rehearsal":false},"outputs":[{"id":"sanctuary","name":"Sanctuary"},{"id":"stage","name":"Stage","role":"stage"},{"id":"lobby","name":"Lobby","role":"signage"}]}"#.into());
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), keys, live: live.clone(), ..Default::default() };
        let result = start_http_server(config, sink.clone(), new_shared_status()).await.expect("bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let take = |output: &str| serde_json::json!({ "command": "take_scene", "value": { "output": output, "scene": "sermon" } });

        assert_eq!(press(port, "scoped", take("sanctuary")).await.0, 200);
        assert_eq!(press(port, "scoped", take("overflow")).await.0, 403, "unassigned output denied");
        assert_eq!(press(port, "scoped", take("stage")).await.0, 403, "stage output denied even if a stale scope names it");
        assert_eq!(press(port, "scoped", take("lobby")).await.0, 403, "signage output denied even if a stale scope names it");
        assert_eq!(press(port, "legacy", take("sanctuary")).await.0, 403, "legacy role without reviewed scope fails closed");
        assert_eq!(sink.command_count(), 1, "refused targets never dispatch");

        let me = get_with(port, "/api/v1/me", "X-Rhema-Key: scoped\r\n", None).await;
        assert!(me.contains(r#""outputScope":["sanctuary"]"#), "{me}");
        let state = get_with(port, "/api/v1/live", "X-Rhema-Key: scoped\r\n", None).await;
        assert!(state.contains("Sanctuary") && !state.contains("Stage") && !state.contains("Lobby"), "{state}");
        let mut handle = result.handle;
        handle.stop();
    }

    #[tokio::test]
    async fn screens_group_take_is_one_scoped_revision_checked_and_idempotent_request() {
        use crate::keys::{hash_key, KeyEntry, Keys, Role};

        let sink = Arc::new(MockSink::new());
        let keys: KeySet = Arc::new(std::sync::RwLock::new(Keys {
            require_auth: true,
            entries: vec![
                KeyEntry {
                    hash: hash_key("group"),
                    name: "Screens desk".into(),
                    role: Role::Screens,
                    paused: false,
                    output_scope: vec![
                        "lobby".into(),
                        "overflow".into(),
                        "sanctuary".into(),
                        "stage".into(),
                    ],
                    group_take_scope: vec![
                        "lobby".into(),
                        "overflow".into(),
                        "sanctuary".into(),
                        "stage".into(),
                    ],
                    record: false,
                },
                KeyEntry {
                    hash: hash_key("individual-only"),
                    name: "Individual Screens desk".into(),
                    role: Role::Screens,
                    paused: false,
                    output_scope: vec!["overflow".into(), "sanctuary".into()],
                    group_take_scope: Vec::new(),
                    record: false,
                },
            ],
        }));
        let live = new_live_hub();
        let initial = serde_json::json!({
            "v": 1,
            "service": { "id": "service-1", "title": "Sunday" },
            "program": { "onAir": true, "rehearsal": false },
            "scenes": [{ "id": "sermon", "name": "Sermon", "layers": [] }],
            "outputs": [
                { "id": "sanctuary", "name": "Sanctuary", "type": "ndi", "role": "congregation", "sceneId": null,
                  "impact": { "language": "both", "aspectRatio": "16:9", "themeId": "default", "themeFor": {}, "shows": [], "themeNames": { "default": "Default" }, "themeRevisions": { "default": 1 } } },
                { "id": "overflow", "name": "Overflow", "type": "display", "role": "congregation", "sceneId": null,
                  "impact": { "language": "both", "aspectRatio": "16:9", "themeId": "default", "themeFor": {}, "shows": [], "themeNames": { "default": "Default" }, "themeRevisions": { "default": 1 } } },
                { "id": "stage", "name": "Stage", "role": "stage", "sceneId": null },
                { "id": "lobby", "name": "Lobby", "role": "signage", "sceneId": null }
            ]
        });
        live.publish(initial.to_string());
        let config = HttpConfig {
            port: 0,
            host: "127.0.0.1".into(),
            keys,
            live: live.clone(),
            ..Default::default()
        };
        let result = start_http_server(config, sink.clone(), new_shared_status())
            .await
            .unwrap();
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let old_seen = read_revisions(port, "group").await;
        let request = |id: &str, outputs: Vec<&str>, seen: Option<serde_json::Value>| {
            let mut body = serde_json::json!({
                "command": "group_take_scene",
                "value": { "outputs": outputs, "scene": "sermon" },
                "service": "service-1",
                "id": id,
            });
            if let Some(seen) = seen {
                body["seen"] = seen;
            }
            body
        };

        assert_eq!(
            press(
                port,
                "individual-only",
                request(
                    "no-grant",
                    vec!["sanctuary", "overflow"],
                    Some(old_seen.clone())
                )
            )
            .await
            .0,
            403
        );
        assert_eq!(
            press(
                port,
                "group",
                request(
                    "protected-stage",
                    vec!["sanctuary", "stage"],
                    Some(old_seen.clone())
                )
            )
            .await
            .0,
            403
        );
        assert_eq!(
            press(
                port,
                "group",
                request(
                    "protected-lobby",
                    vec!["sanctuary", "lobby"],
                    Some(old_seen.clone())
                )
            )
            .await
            .0,
            403
        );
        assert_eq!(
            press(
                port,
                "group",
                request(
                    "duplicate",
                    vec!["sanctuary", "sanctuary"],
                    Some(old_seen.clone())
                )
            )
            .await
            .0,
            422
        );
        assert_eq!(
            press(
                port,
                "group",
                request("single", vec!["sanctuary"], Some(old_seen.clone()))
            )
            .await
            .0,
            422
        );
        assert_eq!(
            press(
                port,
                "group",
                request("missing-seen", vec!["sanctuary", "overflow"], None)
            )
            .await
            .0,
            409
        );
        let mut missing_service = request(
            "missing-service",
            vec!["sanctuary", "overflow"],
            Some(old_seen.clone()),
        );
        missing_service.as_object_mut().unwrap().remove("service");
        assert_eq!(press(port, "group", missing_service).await.0, 409);
        let mut rehearsal = initial.clone();
        rehearsal["program"]["rehearsal"] = serde_json::json!(true);
        live.publish(rehearsal.to_string());
        let rehearsal_seen = read_revisions(port, "group").await;
        assert_eq!(
            press(
                port,
                "group",
                request(
                    "during-rehearsal",
                    vec!["sanctuary", "overflow"],
                    Some(rehearsal_seen)
                )
            )
            .await
            .0,
            403
        );
        live.publish(initial.to_string());

        let mut changed_output = initial.clone();
        changed_output["outputs"][0]["impact"]["language"] = serde_json::json!("first");
        live.publish(changed_output.to_string());
        assert_eq!(
            press(
                port,
                "group",
                request(
                    "stale-output",
                    vec!["sanctuary", "overflow"],
                    Some(old_seen.clone())
                )
            )
            .await
            .0,
            409
        );
        let changed_scene = serde_json::json!({
            "v": 1,
            "service": { "id": "service-1", "title": "Sunday" },
            "program": { "onAir": true, "rehearsal": false },
            "scenes": [{ "id": "sermon", "name": "Sermon updated", "layers": [] }],
            "outputs": [
                { "id": "sanctuary", "name": "Sanctuary", "sceneId": "sermon" },
                { "id": "overflow", "name": "Overflow", "sceneId": null },
                { "id": "stage", "name": "Stage", "role": "stage", "sceneId": null },
                { "id": "lobby", "name": "Lobby", "role": "signage", "sceneId": null }
            ]
        });
        live.publish(changed_scene.to_string());
        assert_eq!(
            press(
                port,
                "group",
                request("stale-scene", vec!["sanctuary", "overflow"], Some(old_seen))
            )
            .await
            .0,
            409
        );

        let current_seen = read_revisions(port, "group").await;
        let me = get_with(port, "/api/v1/me", "X-Rhema-Key: group\r\n", None).await;
        assert!(
            me.contains(r#""groupTakeScope":["overflow","sanctuary"]"#),
            "{me}"
        );
        let accepted = request("group-1", vec!["sanctuary", "overflow"], Some(current_seen.clone()));
        assert_eq!(press(port, "group", accepted.clone()).await.0, 200);
        assert_eq!(
            live.revision("scene:sermon"), current_seen["scene:sermon"].as_u64(),
            "acceptance reserves output revisions without changing the reviewed scene"
        );
        for id in ["sanctuary", "overflow"] {
            let part = format!("output:{id}");
            assert_eq!(
                live.revision(&part),
                current_seen[&part].as_u64().and_then(|revision| revision.checked_add(1)),
                "the API reserves exactly one revision for {id} before dispatch"
            );
        }
        let published_reservation = read_revisions(port, "group").await;
        for id in ["sanctuary", "overflow"] {
            let part = format!("output:{id}");
            assert_eq!(published_reservation[&part].as_u64(), live.revision(&part));
        }
        assert_eq!(
            press(port, "group", accepted).await.0,
            200,
            "a retry gets the accepted result without dispatching again"
        );
        for id in ["sanctuary", "overflow"] {
            let part = format!("output:{id}");
            assert_eq!(
                live.revision(&part),
                current_seen[&part].as_u64().and_then(|revision| revision.checked_add(1)),
                "an exact retry does not reserve another revision for {id}"
            );
            assert_eq!(published_reservation[&part].as_u64(), live.revision(&part));
        }
        assert_eq!(sink.command_count(), 1);
        let payload: serde_json::Value =
            serde_json::from_str(&sink.group_take.lock().unwrap().clone().unwrap()).unwrap();
        assert_eq!(
            payload["outputs"],
            serde_json::json!(["sanctuary", "overflow"])
        );
        assert_eq!(payload["scene"], "sermon");
        assert_eq!(payload["requestId"], "group-1");
        assert_eq!(payload["service"], "service-1");
        assert_eq!(payload["byId"], crate::keys::hash_key("group"));
        assert!(payload["seen"]["scene:sermon"].is_number());

        let mut handle = result.handle;
        handle.stop();
    }

    #[tokio::test]
    async fn failed_group_take_dispatch_publishes_the_reserved_output_revisions() {
        use crate::keys::{hash_key, KeyEntry, Keys, Role};

        let sink = Arc::new(FailGroupTakeSink);
        let keys: KeySet = Arc::new(std::sync::RwLock::new(Keys {
            require_auth: true,
            entries: vec![KeyEntry {
                hash: hash_key("group"),
                name: "Screens desk".into(),
                role: Role::Screens,
                paused: false,
                output_scope: vec!["overflow".into(), "sanctuary".into()],
                group_take_scope: vec!["overflow".into(), "sanctuary".into()],
                record: false,
            }],
        }));
        let live = new_live_hub();
        live.publish(serde_json::json!({
            "v": 1,
            "service": { "id": "service-1", "title": "Sunday" },
            "program": { "onAir": true, "rehearsal": false },
            "scenes": [{ "id": "sermon", "name": "Sermon", "layers": [] }],
            "outputs": [
                { "id": "sanctuary", "name": "Sanctuary", "type": "ndi", "role": "congregation", "sceneId": null,
                  "impact": { "language": "both", "aspectRatio": "16:9", "themeId": "default", "themeFor": {}, "shows": [], "themeNames": { "default": "Default" }, "themeRevisions": { "default": 1 } } },
                { "id": "overflow", "name": "Overflow", "type": "display", "role": "congregation", "sceneId": null,
                  "impact": { "language": "both", "aspectRatio": "16:9", "themeId": "default", "themeFor": {}, "shows": [], "themeNames": { "default": "Default" }, "themeRevisions": { "default": 1 } } },
            ]
        }).to_string());
        let config = HttpConfig {
            port: 0,
            host: "127.0.0.1".into(),
            keys,
            live: live.clone(),
            ..Default::default()
        };
        let result = start_http_server(config, sink, new_shared_status()).await.unwrap();
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let reviewed = read_revisions(port, "group").await;
        let mut request = serde_json::json!({
            "command": "group_take_scene",
            "value": { "outputs": ["sanctuary", "overflow"], "scene": "sermon" },
            "service": "service-1",
            "id": "failed-group-take",
            "seen": reviewed.clone(),
        });
        assert_eq!(press(port, "group", request.clone()).await.0, 500);

        let refreshed = read_revisions(port, "group").await;
        for id in ["sanctuary", "overflow"] {
            let part = format!("output:{id}");
            assert_eq!(
                refreshed[&part].as_u64(),
                reviewed[&part].as_u64().and_then(|revision| revision.checked_add(1)),
                "the failed reservation remains visible so a desk can safely refresh"
            );
        }
        request["id"] = serde_json::json!("stale-after-failure");
        assert_eq!(press(port, "group", request).await.0, 409);

        let mut handle = result.handle;
        handle.stop();
    }

    #[tokio::test]
    async fn a_desk_looks_in_the_host_library_only_as_its_role_allows() {
        let sink = Arc::new(MockSink::new());
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), keys: console_keys(), ..Default::default() };
        let result = start_http_server(config, sink.clone(), new_shared_status()).await.expect("should bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let ask = |body: &'static str, key: &'static str| async move { raw_http_request_with(port, "POST", "/api/v1/lookup", Some(body), key).await };
        let search = r#"{"what":"search","query":"so loved","translation":1}"#;
        let ok = ask(search, "X-Rhema-Key: bib\r\n").await;
        assert!(ok.contains("200 OK") && ok.contains("so loved"), "{ok}");
        assert!(ask(search, "X-Rhema-Key: wor\r\n").await.contains("403"), "the worship desk does not search the Bible");
        assert!(ask(search, "X-Rhema-Key: vie\r\n").await.contains("403"), "view only looks nothing up");
        assert!(ask(search, "").await.contains("401"), "never without a key");
        assert!(ask(search, "X-Rhema-Key: nope\r\n").await.contains("401"));
        assert!(ask(r#"{"what":"songs","query":"CAC 245"}"#, "X-Rhema-Key: wor\r\n").await.contains("CAC 245"));
        assert!(ask(r#"{"what":"songs","query":"x"}"#, "X-Rhema-Key: bib\r\n").await.contains("403"));
        assert!(ask(r#"{"what":"search","query":"a","translation":1}"#, "X-Rhema-Key: bib\r\n").await.contains("422"));
        let down = ask(r#"{"what":"songs","query":"broken"}"#, "X-Rhema-Key: dir\r\n").await;
        assert!(down.contains("503") && down.contains("Songs are unavailable"), "{down}");
        assert!(sink.commands.lock().unwrap().is_empty(), "a lookup is never a command");
    }

    #[tokio::test]
    async fn the_director_reads_who_is_connected_and_others_do_not() {
        let live = new_live_hub();
        live.publish(r#"{"v":1,"readiness":{"ready":true,"checks":[]},"notices":[]}"#.into());
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), keys: console_keys(), live: live.clone(), ..Default::default() };
        let result = start_http_server(config, Arc::new(MockSink::new()), new_shared_status()).await.expect("should bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let dir = get_with(port, "/api/v1/live", "X-Rhema-Key: dir\r\n", None).await;
        assert!(dir.contains(r#""presence":["#) && dir.contains("Stage desk") && dir.contains(r#""readiness""#), "{dir}");
        let stage = get_with(port, "/api/v1/live", "X-Rhema-Key: stg\r\n", None).await;
        assert!(!stage.contains("presence") && !stage.contains("readiness"), "{stage}");
    }
}
