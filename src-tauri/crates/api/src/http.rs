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
use serde::{Deserialize, Serialize};
use tokio::sync::watch;
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
}

impl Default for HttpConfig {
    fn default() -> Self {
        Self {
            port: 8080,
            host: "0.0.0.0".into(),
            keys: new_key_set(),
            pairing: new_pairing_window(),
        }
    }
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
}

/// Shared state for axum route handlers.
struct AppState<S: CommandSink> {
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
        .route("/remote", get(remote_page))
        // Undocumented alias for the path the code shipped with before #146.
        .route("/api/v1/control", post(command_handler::<S>))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(bind_addr).await.map_err(|e| {
        CommandError::DispatchFailed(format!("Failed to bind HTTP on {bind_addr}: {e}"))
    })?;

    let bound_port = listener.local_addr().map(|a| a.port()).unwrap_or(config.port);

    let (shutdown_tx, mut shutdown_rx) = watch::channel(false);

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
    })
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
}

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
    match check_key(&state.keys, presented_key(&headers)) {
        Err(reason) => {
            log::warn!("HTTP command refused: {reason}");
            return (
                StatusCode::UNAUTHORIZED,
                Json(CommandResponse { success: false, error: Some(format!("{reason} (X-Rhema-Key)")) }),
            );
        }
        Ok(Some(entry)) if !entry.role.allows(&request.command) => {
            log::warn!("HTTP command refused for {}: {} may not change settings", entry.name, entry.name);
            return (
                StatusCode::FORBIDDEN,
                Json(CommandResponse { success: false, error: Some("this device may present but not change settings".into()) }),
            );
        }
        Ok(_) => {}
    }
    if request.id.as_deref().is_some_and(|id| !state.recent.first_time(id)) {
        log::info!("HTTP command {:?} already carried out (a retry); not repeated", request.command);
        return (StatusCode::OK, Json(CommandResponse { success: true, error: None }));
    }
    match CommandDispatcher::dispatch(&request.command, &*state.sink) {
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
            self.commands.lock().unwrap().push(event.to_string());
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
