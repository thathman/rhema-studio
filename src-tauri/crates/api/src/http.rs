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
use tower_http::cors::CorsLayer;

use crate::command::RemoteCommand;
use crate::dispatch::{CommandDispatcher, CommandSink};
use crate::error::CommandError;
use crate::keys::{check_key, new_key_set, new_pairing_window, try_pair, KeySet, PairOutcome, PairingWindow};

/// Configuration for the HTTP API server.
#[derive(Debug, Clone)]
pub struct HttpConfig {
    pub port: u16,
    pub host: String,
    /// Paired devices and the shared key; empty means open. `/command` requires
    /// `X-Rhema-Key: <token>` (or `Authorization: Bearer <token>`) otherwise.
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
        }
    }
}

/// Browser feeds (ARCH-002): for each output of type "browser", its secret and the frame it shows
/// now, streamed to the feed page. The app keeps the list in step with its outputs; the server
/// never reads a frame.
#[derive(Debug, Default)]
pub struct FeedHub {
    feeds: std::sync::RwLock<std::collections::HashMap<String, Feed>>,
}

#[derive(Debug)]
struct Feed {
    token: String,
    /// The frame shown now, with its number.
    current: Option<(u64, String)>,
    seq: u64,
    tx: broadcast::Sender<(u64, String)>,
    /// The newest frame a page said it drew, and when (receiver trust, #246 item 9).
    acked: u64,
    acked_at: Option<std::time::Instant>,
}

/// A browser feed's health for the operator: pages following it, and whether one drew the latest frame.
#[derive(Debug, Clone, Serialize)]
pub struct FeedStatus {
    pub watching: usize,
    pub seq: u64,
    pub acked: u64,
    /// Milliseconds since a page last said it drew a frame; None if none has.
    pub acked_ago_ms: Option<u64>,
}

impl FeedHub {
    /// Replace the list of feeds (id, secret); frames of feeds that stay are kept.
    pub fn set(&self, list: &[(String, String)]) {
        let mut feeds = self.feeds.write().unwrap_or_else(std::sync::PoisonError::into_inner);
        feeds.retain(|id, f| list.iter().any(|(i, t)| i == id && *t == f.token));
        for (id, token) in list {
            feeds.entry(id.clone()).or_insert_with(|| Feed { token: token.clone(), current: None, seq: 0, tx: broadcast::channel(16).0, acked: 0, acked_at: None });
        }
    }

    /// The frame a feed shows now; unknown feeds are ignored.
    pub fn publish(&self, id: &str, json: String) {
        let mut feeds = self.feeds.write().unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(f) = feeds.get_mut(id) {
            f.seq += 1;
            f.current = Some((f.seq, json.clone()));
            let _ = f.tx.send((f.seq, json));
        }
    }

    /// A page drew frame `seq` (only with the feed's secret; never ahead of what was sent).
    fn ack(&self, id: &str, token: &str, seq: u64) -> bool {
        let mut feeds = self.feeds.write().unwrap_or_else(std::sync::PoisonError::into_inner);
        let Some(f) = feeds.get_mut(id).filter(|f| crate::command::same_key(token, &f.token)) else {
            return false;
        };
        if seq <= f.seq && seq >= f.acked {
            f.acked = seq;
            f.acked_at = Some(std::time::Instant::now());
        }
        true
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
        })
    }

    /// The feed's current frame and a receiver for the next ones, if the secret matches.
    fn follow(&self, id: &str, token: &str) -> Option<(Option<(u64, String)>, broadcast::Receiver<(u64, String)>)> {
        let feeds = self.feeds.read().unwrap_or_else(std::sync::PoisonError::into_inner);
        let f = feeds.get(id)?;
        crate::command::same_key(token, &f.token).then(|| (f.current.clone(), f.tx.subscribe()))
    }

    fn knows(&self, id: &str, token: &str) -> bool {
        self.feeds.read().unwrap_or_else(std::sync::PoisonError::into_inner).get(id).is_some_and(|f| crate::command::same_key(token, &f.token))
    }
}

pub type SharedFeeds = Arc<FeedHub>;

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
    service: std::sync::RwLock<Option<String>>,
    tx: broadcast::Sender<String>,
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
        *self.service.write().unwrap_or_else(std::sync::PoisonError::into_inner) = service_of(&json);
        *self.current.write().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(json.clone());
        // No one following is fine.
        let _ = self.tx.send(json);
    }

    #[must_use]
    pub fn current(&self) -> Option<String> {
        self.current.read().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
    }

    /// The service the host is running now ("" for none), or None before it has said.
    #[must_use]
    pub fn service(&self) -> Option<String> {
        self.service.read().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
    }
}

pub type SharedLive = Arc<LiveHub>;

#[must_use]
pub fn new_live_hub() -> SharedLive {
    Arc::new(LiveHub { current: std::sync::RwLock::new(None), service: std::sync::RwLock::new(None), tx: broadcast::channel(32).0 })
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
    sink: Arc<S>,
    status: Arc<tokio::sync::RwLock<StatusSnapshot>>,
    keys: KeySet,
    pairing: PairingWindow,
    rate: crate::rate::RateLimiter,
    recent: RecentIds,
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

    let state = Arc::new(AppState {
        live: config.live.clone(),
        feeds: config.feeds.clone(),
        voice: config.voice.clone(),
        cameras: config.cameras.clone(),
        sink,
        status,
        keys: config.keys.clone(),
        pairing: config.pairing.clone(),
        rate: crate::rate::RateLimiter::default(),
        recent: RecentIds::default(),
    });

    let app = Router::new()
        .route("/api/v1/health", get(health_handler))
        .route("/api/v1/status", get(status_handler::<S>))
        .route("/api/v1/command", post(command_handler::<S>))
        .route("/api/v1/pair", post(pair_handler::<S>))
        .route("/api/v1/me", get(me_handler::<S>))
        .route("/api/v1/live", get(live_handler::<S>))
        .route("/api/v1/live/events", get(live_events_handler::<S>))
        .route("/feed/{id}", get(feed_page_handler::<S>))
        .route("/api/v1/feed/{id}/events", get(feed_events_handler::<S>))
        .route("/api/v1/voice", post(voice_handler::<S>))
        .route("/api/v1/feed/{id}/ack", post(feed_ack_handler::<S>))
        .route("/assets/{*path}", get(asset_handler::<S>))
        .route("/remote", get(remote_page))
        .route("/camera", get(camera_page_handler::<S>))
        .route("/api/v1/camera/{name}/whip", post(camera_whip_handler::<S>))
        .route("/api/v1/camera/{name}/whip/{session}", axum::routing::patch(camera_session_handler::<S>).delete(camera_session_handler::<S>))
        // Undocumented alias for the path the code shipped with before #146.
        .route("/api/v1/control", post(command_handler::<S>))
        .layer(CorsLayer::permissive())
        .with_state(state);
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

    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);
    let tls_port = match config.tls.as_ref() {
        Some(t) => Some(serve_tls(t, &config.host, app.clone(), shutdown_tx.subscribe()).await?),
        None => None,
    };

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
}

static APP_VERSION: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// The app's version for `/api/v1/health` (this crate's own version is not the app's).
pub fn set_app_version(version: &str) {
    let _ = APP_VERSION.set(version.to_string());
}

async fn health_handler() -> impl IntoResponse {
    Json(HealthResponse {
        status: "ok",
        service: "rhema",
        version: APP_VERSION.get().cloned().unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string()),
    })
}

/// The phone remote: one self-contained page (pair, then Next/Previous/
/// Back on air/Clear with the device's own token). Static, so serving it
/// needs no key; every command it sends is checked like any other.
async fn remote_page() -> impl IntoResponse {
    (
        [
            (axum::http::header::CACHE_CONTROL, "no-store"),
            (axum::http::header::X_FRAME_OPTIONS, "DENY"),
            (axum::http::header::CONTENT_SECURITY_POLICY, "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'"),
        ],
        axum::response::Html(include_str!("remote.html")),
    )
}

async fn status_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
) -> impl IntoResponse {
    let snapshot = state.status.read().await;
    Json(snapshot.clone())
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
}

/// What a desk looking at another service is told; it refreshes its Live State.
const OTHER_SERVICE_MESSAGE: &str = "That desk is looking at a different service; it will refresh";

/// Command ids seen recently, so a retried press is not carried out twice.
#[derive(Default)]
struct RecentIds(std::sync::Mutex<std::collections::VecDeque<(String, std::time::Instant)>>);

impl RecentIds {
    const KEEP: std::time::Duration = std::time::Duration::from_secs(60);
    const MAX: usize = 256;

    /// True the first time an id is seen within the last minute.
    fn first_time(&self, id: &str) -> bool {
        let Ok(mut seen) = self.0.lock() else { return true };
        let id: String = id.chars().take(64).collect();
        let now = std::time::Instant::now();
        while seen.front().is_some_and(|(_, at)| now.duration_since(*at) > Self::KEEP) || seen.len() >= Self::MAX {
            seen.pop_front();
        }
        if seen.iter().any(|(s, _)| *s == id) {
            return false;
        }
        seen.push_back((id, now));
        true
    }
}

#[derive(Serialize)]
struct CommandResponse {
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Deserialize)]
struct PairRequest {
    code: String,
    #[serde(default)]
    name: String,
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

/// `POST /api/v1/pair {"code":"123456","name":"Tolu's phone"}` while the
/// operator has the pairing window open. The token comes back exactly once.
async fn pair_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(req): Json<PairRequest>,
) -> impl IntoResponse {
    if !state.rate.allow(peer.ip()) {
        return (StatusCode::TOO_MANY_REQUESTS, Json(PairResponse { success: false, token: None, name: None, error: Some("too many requests; slow down".into()) }));
    }
    match try_pair(&state.pairing, &state.keys, &req.code, &req.name) {
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
        Ok(Some(entry)) => Ok(entry),
        Ok(None) if peer.ip().is_loopback() => Ok(crate::keys::KeyEntry { hash: String::new(), name: "This computer".into(), role: crate::keys::Role::Configure, paused: false }),
        Ok(None) => Err(StatusCode::FORBIDDEN),
        Err(_) => Err(StatusCode::UNAUTHORIZED),
    }
}

/// `GET /api/v1/me`: the name and role this key has, and whether the main desk has taken back
/// control, so a joined desk shows what it may do.
async fn me_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> axum::response::Response {
    match live_reader(&state, peer, &headers) {
        Ok(e) => Json(serde_json::json!({ "name": e.name, "role": e.role, "paused": e.paused })).into_response(),
        Err(code) => code.into_response(),
    }
}

/// `GET /api/v1/live`: the host's Live State now (204 before the app has published one).
async fn live_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> axum::response::Response {
    if let Err(code) = live_reader(&state, peer, &headers) {
        return code.into_response();
    }
    match state.live.current() {
        Some(json) => ([(axum::http::header::CONTENT_TYPE, "application/json"), (axum::http::header::CACHE_CONTROL, "no-store")], json).into_response(),
        None => StatusCode::NO_CONTENT.into_response(),
    }
}

/// `GET /api/v1/live/events`: the Live State as server-sent events, the current one first, then
/// each change; a comment every 15 s keeps the connection open through idle routers.
async fn live_events_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> axum::response::Response {
    if let Err(code) = live_reader(&state, peer, &headers) {
        return code.into_response();
    }
    let rx = state.live.tx.subscribe();
    let first = state.live.current();
    let stream = futures_util::stream::unfold((rx, first), |(mut rx, first)| async move {
        if let Some(json) = first {
            return Some((Ok::<_, std::convert::Infallible>(Event::default().event("live").data(json)), (rx, None)));
        }
        loop {
            match rx.recv().await {
                Ok(json) => return Some((Ok(Event::default().event("live").data(json)), (rx, None))),
                // Slow reader: skip to the newest; the next message is the whole state anyway.
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    });
    Sse::new(stream).keep_alive(KeepAlive::new().interval(std::time::Duration::from_secs(15))).into_response()
}

type Query = axum::extract::Query<std::collections::HashMap<String, String>>;

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
        return (StatusCode::FORBIDDEN, "This feed's link is not valid (copy it again from Rhema → Outputs).").into_response();
    }
    match state.sink.asset("feed.html") {
        Some((bytes, _)) => ([(axum::http::header::CONTENT_TYPE, "text/html; charset=utf-8"), (axum::http::header::CACHE_CONTROL, "no-store")], bytes).into_response(),
        None => (StatusCode::NOT_FOUND, "The feed page is not in this build.").into_response(),
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
        return (StatusCode::FORBIDDEN, "This camera link is not valid. Scan it again from Rhema: Production, Cameras.").into_response();
    }
    (
        [
            (axum::http::header::CACHE_CONTROL, "no-store"),
            (axum::http::header::X_FRAME_OPTIONS, "DENY"),
            (axum::http::header::CONTENT_SECURITY_POLICY, "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; media-src 'self' blob: mediastream:; form-action 'none'; frame-ancestors 'none'"),
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
/// this request's reply. The host stamps who it is from the key.
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
    let name = match live_reader(&state, peer, &headers) {
        Ok(who) => who.name,
        Err(code) => return code.into_response(),
    };
    if offer.sdp.len() > 64 * 1024 || !offer.sdp.starts_with("v=0") {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let id = uuid::Uuid::new_v4().to_string();
    let rx = state.voice.wait(&id);
    if state.sink.emit_event("remote:voice_offer", &serde_json::json!({ "id": id, "by": name, "sdp": offer.sdp }).to_string()).is_err() {
        state.voice.forget(&id);
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    match tokio::time::timeout(std::time::Duration::from_secs(10), rx).await {
        Ok(Ok(sdp)) => Json(serde_json::json!({ "sdp": sdp })).into_response(),
        _ => {
            state.voice.forget(&id);
            (StatusCode::GATEWAY_TIMEOUT, Json(serde_json::json!({ "error": "The host did not answer. Is Rhema open there?" }))).into_response()
        }
    }
}

#[derive(Deserialize)]
struct FeedAck {
    seq: u64,
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
    if state.feeds.ack(&id, q.get("k").map_or("", String::as_str), ack.seq) { StatusCode::NO_CONTENT } else { StatusCode::FORBIDDEN }
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
    let Some((first, rx)) = state.feeds.follow(&id, q.get("k").map_or("", String::as_str)) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let stream = futures_util::stream::unfold((rx, first), |(mut rx, first)| async move {
        // The frame's number is the event id: the page acknowledges it once drawn.
        if let Some((seq, json)) = first {
            return Some((Ok::<_, std::convert::Infallible>(Event::default().event("frame").id(seq.to_string()).data(json)), (rx, None)));
        }
        loop {
            match rx.recv().await {
                Ok((seq, json)) => return Some((Ok(Event::default().event("frame").id(seq.to_string()).data(json)), (rx, None))),
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => return None,
            }
        }
    });
    Sse::new(stream).keep_alive(KeepAlive::new().interval(std::time::Duration::from_secs(15))).into_response()
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

async fn command_handler<S: CommandSink + 'static>(
    AxumState(state): AxumState<Arc<AppState<S>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(request): Json<CommandRequest>,
) -> impl IntoResponse {
    if !state.rate.allow(peer.ip()) {
        log::warn!("HTTP command refused: too many from {}", peer.ip());
        return (StatusCode::TOO_MANY_REQUESTS, Json(CommandResponse { success: false, error: Some("too many commands; slow down".into()) }));
    }
    let by = match check_key(&state.keys, presented_key(&headers)) {
        Err(reason) => {
            log::warn!("HTTP command refused: {reason}");
            return (
                StatusCode::UNAUTHORIZED,
                Json(CommandResponse { success: false, error: Some(format!("{reason} (X-Rhema-Key)")) }),
            );
        }
        Ok(Some(entry)) if entry.paused_for(&request.command) => {
            log::info!("HTTP command refused for {}: the main desk has taken back control", entry.name);
            return (StatusCode::LOCKED, Json(CommandResponse { success: false, error: Some(crate::keys::PAUSED_MESSAGE.into()) }));
        }
        Ok(Some(entry)) if !entry.role.allows(&request.command) => {
            let why = match entry.role {
                crate::keys::Role::Timekeeper => "this device keeps time: it may move the event clock, not the screens",
                crate::keys::Role::Bible => "this device runs the Bible: it may activate, step and clear the Bible only",
                crate::keys::Role::Screens => "this device runs the congregation screens: it may take and release scenes only",
                _ => "this device may present but not change settings",
            };
            log::warn!("HTTP command refused for {}: {why}", entry.name);
            return (
                StatusCode::FORBIDDEN,
                Json(CommandResponse { success: false, error: Some(why.into()) }),
            );
        }
        Ok(Some(entry)) => entry.name,
        Ok(None) => "an open remote".to_string(),
    };
    // Several services must never share state (#246 C16): a desk still showing the 9 AM service
    // cannot move the 11 AM one. Crew talk is not about a service.
    if !request.command.is_comms() {
        if let (Some(sent), Some(host)) = (request.service.as_deref(), state.live.service()) {
            if sent != host {
                log::info!("HTTP command from {by} refused: it is for another service");
                return (StatusCode::CONFLICT, Json(CommandResponse { success: false, error: Some(OTHER_SERVICE_MESSAGE.into()) }));
            }
        }
    }
    if request.id.as_deref().is_some_and(|id| !state.recent.first_time(id)) {
        log::info!("HTTP command {:?} already carried out (a retry); not repeated", request.command);
        return (StatusCode::OK, Json(CommandResponse { success: true, error: None }));
    }
    match CommandDispatcher::dispatch_as(&request.command, &*state.sink, &by) {
        Ok(()) => (
            StatusCode::OK,
            Json(CommandResponse {
                success: true,
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(CommandResponse {
                success: false,
                error: Some(e.to_string()),
            }),
        ),
    }
}

#[cfg(test)]
mod tests {

    #[test]
    fn a_retried_press_is_not_repeated() {
        let recent = RecentIds::default();
        assert!(recent.first_time("press-1"));
        assert!(!recent.first_time("press-1"), "the same press again (a retry)");
        assert!(recent.first_time("press-2"), "a new press");
    }
    use super::*;
    use std::sync::Mutex;

    struct MockSink {
        commands: Mutex<Vec<String>>,
    }

    impl MockSink {
        fn new() -> Self {
            Self {
                commands: Mutex::new(Vec::new()),
            }
        }

        fn command_count(&self) -> usize {
            self.commands.lock().unwrap().len()
        }
    }

    impl CommandSink for MockSink {
        fn emit_event(&self, event: &str, _payload: &str) -> Result<(), CommandError> {
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
        stream.write_all(format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n{headers}Connection: close\r\n\r\n").as_bytes()).await.expect("write");
        let mut out = Vec::new();
        match read_bytes {
            None => { stream.read_to_end(&mut out).await.expect("read"); }
            Some(n) => {
                let mut buf = [0u8; 1024];
                while out.len() < n {
                    let r = tokio::time::timeout(std::time::Duration::from_secs(2), stream.read(&mut buf)).await.expect("in time").expect("read");
                    if r == 0 { break; }
                    out.extend_from_slice(&buf[..r]);
                }
            }
        }
        String::from_utf8_lossy(&out).into_owned()
    }

    #[tokio::test]
    async fn live_state_needs_a_paired_key_and_streams_each_change() {
        let keys: KeySet = Arc::new(std::sync::RwLock::new(crate::keys::Keys { require_auth: true, entries: vec![crate::keys::KeyEntry { hash: crate::keys::hash_key("tok"), name: "Femi's laptop".into(), role: crate::keys::Role::Timekeeper, paused: false }] }));
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
        let handle = tokio::spawn(async move { get_with(port, "/api/v1/live/events", "X-Rhema-Key: tok\r\n", Some(400)).await });
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        live.publish(r#"{"v":1,"now":"Sermon"}"#.into());
        let stream = handle.await.unwrap();
        assert!(stream.contains("text/event-stream"), "{stream}");
        assert!(stream.contains("event: live") && stream.contains("Opening prayer") && stream.contains("Sermon"), "{stream}");

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

    /// Plays the host window: answers each voice offer with the desk's name in the SDP.
    struct VoiceSink(SharedVoice);
    impl CommandSink for VoiceSink {
        fn emit_event(&self, event: &str, payload: &str) -> Result<(), CommandError> {
            if event == "remote:voice_offer" {
                let v: serde_json::Value = serde_json::from_str(payload).unwrap();
                let (id, by) = (v["id"].as_str().unwrap().to_string(), v["by"].as_str().unwrap().to_string());
                assert!(v["sdp"].as_str().unwrap().starts_with("v=0"));
                let hub = self.0.clone();
                tokio::spawn(async move { assert!(hub.answer(&id, format!("v=0 answer for {by}"))) });
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
        tls.write_all(b"GET /api/v1/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").await.unwrap();
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
    async fn a_desk_joins_the_talk_channel_with_its_key_and_gets_the_host_answer() {
        let voice = new_voice_hub();
        let keys = new_key_set();
        keys.write().unwrap().entries.push(crate::keys::KeyEntry { hash: crate::keys::hash_key("k1"), name: "Ade bible".into(), role: crate::keys::Role::Bible, paused: false });
        keys.write().unwrap().require_auth = true;
        let config = HttpConfig { port: 0, host: "127.0.0.1".into(), keys, voice: voice.clone(), ..Default::default() };
        let result = start_http_server(config, Arc::new(VoiceSink(voice.clone())), new_shared_status()).await.expect("bind");
        let port = result.bound_port;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let ok = raw_http_request_with(port, "POST", "/api/v1/voice", Some(r#"{"sdp":"v=0 offer"}"#), "X-Rhema-Key: k1\r\n").await;
        assert!(ok.contains("200 OK") && ok.contains("v=0 answer for Ade bible"), "{ok}");
        assert!(raw_http_request_with(port, "POST", "/api/v1/voice", Some(r#"{"sdp":"v=0 offer"}"#), "X-Rhema-Key: wrong\r\n").await.contains("401"));
        assert!(raw_http_request_with(port, "POST", "/api/v1/voice", Some(r#"{"sdp":"not sdp"}"#), "X-Rhema-Key: k1\r\n").await.contains("400"));
        assert!(!voice.answer("nobody-waits", "v=0".into()), "a late answer is dropped");
        let mut handle = result.handle;
        handle.stop();
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
        // A new secret (the link was renewed) closes the old link.
        feeds.set(&[("l3".into(), "n3w".into())]);
        assert!(get_with(port, "/feed/l3?k=s3cret", "", None).await.contains("403"));
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
            s.write_all(format!("{method} {path} HTTP/1.1\r\nHost: x\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
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
        cameras.set_router(Some(crate::cameras::RouterTarget { base: format!("http://127.0.0.1:{router}") }));
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
}
