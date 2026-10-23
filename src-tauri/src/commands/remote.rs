use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, State};

use rhema_api::{
    close_pairing, hash_key, new_key_set, new_pairing_window, open_pairing, CommandError, CommandSink, HttpConfig, HttpHandle, KeyEntry, KeySet, Role,
    OscConfig, OscHandle, PairingWindow, SharedFeeds, SharedVoice, new_voice_hub, SharedLive, SharedStatus, new_feed_hub, new_live_hub, new_shared_status, start_http_server, start_osc_listener,
};

/// Who may send remote commands, shared by both listeners so a revoke takes
/// effect at once. The frontend owns the list (settings) and pushes it here.
pub struct RemoteKeys {
    pub keys: KeySet,
    pub pairing: PairingWindow,
}

impl RemoteKeys {
    #[must_use]
    pub fn new() -> Self {
        Self { keys: new_key_set(), pairing: new_pairing_window() }
    }
}

impl Default for RemoteKeys {
    fn default() -> Self {
        Self::new()
    }
}

/// Replace the accepted keys: the shared key (if any) plus every paired
/// device. `require_auth` is the operator's switch; it is forced on while
/// any key exists, and when on with no keys every command is refused.
#[tauri::command]
pub fn remote_set_keys(remote: State<'_, RemoteKeys>, shared: Option<String>, devices: Vec<KeyEntry>, require_auth: Option<bool>) -> Result<usize, String> {
    let mut entries: Vec<KeyEntry> = devices.into_iter().filter(|d| d.hash.len() == 64).collect();
    if let Some(s) = shared.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        entries.push(KeyEntry { hash: hash_key(&s), name: "Shared key".into(), role: Role::Configure });
    }
    let n = entries.len();
    let mut k = remote.keys.write().map_err(|e| e.to_string())?;
    k.require_auth = require_auth.unwrap_or(false) || n > 0;
    k.entries = entries;
    Ok(n)
}

/// Open the two-minute pairing window; returns the code to show on screen.
#[tauri::command]
pub fn remote_pair_start(remote: State<'_, RemoteKeys>) -> String {
    open_pairing(&remote.pairing)
}

/// This computer's address on the local network, for the pairing QR code.
/// A UDP "connect" only picks the outgoing interface; nothing is sent.
/// None without a network route (then the operator types the address).
#[tauri::command]
pub fn remote_lan_address() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:9").ok()?;
    let ip = socket.local_addr().ok()?.ip();
    (!ip.is_loopback() && !ip.is_unspecified()).then(|| ip.to_string())
}

#[tauri::command]
pub fn remote_pair_cancel(remote: State<'_, RemoteKeys>) {
    close_pairing(&remote.pairing);
}

/// Tauri-aware implementation of `CommandSink`.
///
/// Routes frontend-bound commands as Tauri events (`app.emit()`)
/// and backend-bound commands as Tauri command invocations.
struct TauriSink {
    app: AppHandle,
}

impl CommandSink for TauriSink {
    fn asset(&self, path: &str) -> Option<(Vec<u8>, String)> {
        let asset = self.app.asset_resolver().get(path.to_string())?;
        Some((asset.bytes().to_vec(), asset.mime_type().to_string()))
    }

    fn emit_event(&self, event: &str, payload: &str) -> Result<(), CommandError> {
        self.app
            .emit(event, payload.to_string())
            .map_err(|e| CommandError::DispatchFailed(format!("Tauri emit failed: {e}")))
    }

    fn invoke_backend(&self, action: &str, args: &str) -> Result<(), CommandError> {
        match action {
            "show_broadcast" => {
                log::info!("Remote control: show broadcast");
                self.app
                    .emit("remote:show", "{}")
                    .map_err(|e| CommandError::DispatchFailed(e.to_string()))
            }
            "hide_broadcast" => {
                log::info!("Remote control: hide broadcast");
                self.app
                    .emit("remote:hide", "{}")
                    .map_err(|e| CommandError::DispatchFailed(e.to_string()))
            }
            "set_confidence" => {
                self.app
                    .emit("remote:confidence", args.to_string())
                    .map_err(|e| CommandError::DispatchFailed(e.to_string()))
            }
            _ => Err(CommandError::DispatchFailed(format!(
                "Unknown backend action: {action}"
            ))),
        }
    }
}

// --- OSC Runtime ---

/// Managed state for the OSC runtime.
pub struct OscRuntime {
    handle: Option<OscHandle>,
    bound_port: Option<u16>,
}

impl OscRuntime {
    pub fn new() -> Self {
        Self {
            handle: None,
            bound_port: None,
        }
    }
}

impl Default for OscRuntime {
    fn default() -> Self {
        Self::new()
    }
}

/// Start the OSC listener on the given port.
#[tauri::command]
pub async fn start_osc(
    app: AppHandle,
    state: State<'_, Mutex<OscRuntime>>,
    remote: State<'_, RemoteKeys>,
    port: Option<u16>,
    lan: Option<bool>,
) -> Result<u16, String> {
    let mut runtime = state.lock().map_err(|e| e.to_string())?;

    if runtime.handle.is_some() {
        return Err("OSC listener is already running".into());
    }

    let config = OscConfig {
        port: port.unwrap_or(8000),
        host: bind_host(lan).into(),
        keys: remote.keys.clone(),
    };

    let sink = Arc::new(TauriSink { app });
    let result = start_osc_listener(config, sink).map_err(|e| e.to_string())?;

    let bound_port = result.bound_port;
    runtime.handle = Some(result.handle);
    runtime.bound_port = Some(bound_port);

    log::info!("OSC listener started on port {bound_port}");
    Ok(bound_port)
}

/// Stop the OSC listener.
#[tauri::command]
pub async fn stop_osc(state: State<'_, Mutex<OscRuntime>>) -> Result<(), String> {
    let mut runtime = state.lock().map_err(|e| e.to_string())?;

    match runtime.handle.take() {
        Some(mut handle) => {
            handle.stop();
            runtime.bound_port = None;
            log::info!("OSC listener stopped");
            Ok(())
        }
        None => Err("OSC listener is not running".into()),
    }
}

/// Get the current OSC listener status.
#[tauri::command]
pub async fn get_osc_status(
    state: State<'_, Mutex<OscRuntime>>,
) -> Result<OscStatus, String> {
    let runtime = state.lock().map_err(|e| e.to_string())?;

    Ok(OscStatus {
        running: runtime.handle.as_ref().is_some_and(rhema_api::OscHandle::is_active),
        port: runtime.bound_port,
    })
}

#[derive(serde::Serialize)]
pub struct OscStatus {
    pub running: bool,
    pub port: Option<u16>,
}

// --- HTTP Runtime ---

/// Managed state for the HTTP API runtime.
pub struct HttpRuntime {
    handle: Option<HttpHandle>,
    bound_port: Option<u16>,
    /// Listening on the whole network (not only 127.0.0.1), as started.
    lan: bool,
    status: SharedStatus,
    /// The Live State joined devices follow (Host/Join); kept across restarts of the listener.
    live: SharedLive,
    /// Browser feeds (outputs of type "browser"); kept across restarts of the listener.
    feeds: SharedFeeds,
    /// Rhema Comms voice offers waiting for this window's answer.
    voice: SharedVoice,
}

impl HttpRuntime {
    pub fn new() -> Self {
        Self {
            handle: None,
            bound_port: None,
            lan: false,
            status: new_shared_status(),
            live: new_live_hub(),
            feeds: new_feed_hub(),
            voice: new_voice_hub(),
        }
    }

    pub fn shared_status(&self) -> SharedStatus {
        self.status.clone()
    }
}

impl Default for HttpRuntime {
    fn default() -> Self {
        Self::new()
    }
}

/// Start the HTTP API server on the given port.
#[tauri::command]
pub async fn start_http(
    app: AppHandle,
    state: State<'_, Mutex<HttpRuntime>>,
    remote: State<'_, RemoteKeys>,
    port: Option<u16>,
    lan: Option<bool>,
) -> Result<u16, String> {
    let (status, live, feeds, voice, already_running) = {
        let runtime = state.lock().map_err(|e| e.to_string())?;
        (runtime.shared_status(), runtime.live.clone(), runtime.feeds.clone(), runtime.voice.clone(), runtime.handle.is_some())
    };

    if already_running {
        return Err("HTTP API server is already running".into());
    }

    let config = HttpConfig {
        port: port.unwrap_or(8080),
        host: bind_host(lan).into(),
        keys: remote.keys.clone(),
        pairing: remote.pairing.clone(),
        live,
        feeds,
        voice,
    };

    let sink = Arc::new(TauriSink { app });
    let result = start_http_server(config, sink, status)
        .await
        .map_err(|e| e.to_string())?;

    let bound_port = result.bound_port;

    {
        let mut runtime = state.lock().map_err(|e| e.to_string())?;
        runtime.handle = Some(result.handle);
        runtime.bound_port = Some(bound_port);
        runtime.lan = bind_host(lan) != "127.0.0.1";
    }

    log::info!("HTTP API server started on port {bound_port}");
    Ok(bound_port)
}

/// Stop the HTTP API server.
#[tauri::command]
pub async fn stop_http(state: State<'_, Mutex<HttpRuntime>>) -> Result<(), String> {
    let mut runtime = state.lock().map_err(|e| e.to_string())?;

    match runtime.handle.take() {
        Some(mut handle) => {
            handle.stop();
            runtime.bound_port = None;
            log::info!("HTTP API server stopped");
            Ok(())
        }
        None => Err("HTTP API server is not running".into()),
    }
}

/// Get the current HTTP API server status.
#[tauri::command]
pub async fn get_http_status(
    state: State<'_, Mutex<HttpRuntime>>,
) -> Result<HttpStatus, String> {
    let runtime = state.lock().map_err(|e| e.to_string())?;

    Ok(HttpStatus {
        running: runtime.handle.as_ref().is_some_and(rhema_api::HttpHandle::is_active),
        lan: runtime.lan,
        port: runtime.bound_port,
    })
}

/// The app's Live State for joined devices (a JSON snapshot; the server passes it on unread).
#[tauri::command]
pub fn publish_live_state(state: State<'_, Mutex<HttpRuntime>>, json: String) -> Result<(), String> {
    // Bounded: a snapshot is a few kilobytes; anything near this is a bug, not a service.
    if json.len() > 2 * 1024 * 1024 {
        return Err("live state too large".into());
    }
    let live = state.lock().map_err(|e| e.to_string())?.live.clone();
    live.publish(json);
    Ok(())
}

#[derive(serde::Deserialize)]
pub struct FeedEntry {
    id: String,
    token: String,
}

/// The browser feeds (outputs of type "browser") and their secrets, kept in step with the outputs.
#[tauri::command]
pub fn feeds_set(state: State<'_, Mutex<HttpRuntime>>, feeds: Vec<FeedEntry>) -> Result<(), String> {
    let hub = state.lock().map_err(|e| e.to_string())?.feeds.clone();
    hub.set(&feeds.into_iter().filter(|f| f.token.len() >= 16).map(|f| (f.id, f.token)).collect::<Vec<_>>());
    Ok(())
}

/// The frame a browser feed shows now (the same payload an output window gets).
#[tauri::command]
pub fn feed_publish(state: State<'_, Mutex<HttpRuntime>>, id: String, json: String) -> Result<(), String> {
    // Theme pictures travel inside the frame; anything near this is a bug, not a service.
    if json.len() > 24 * 1024 * 1024 {
        return Err("feed frame too large".into());
    }
    let hub = state.lock().map_err(|e| e.to_string())?.feeds.clone();
    hub.publish(&id, json);
    Ok(())
}

/// Update the status snapshot from the frontend.
#[tauri::command]
pub async fn update_remote_status(
    state: State<'_, Mutex<HttpRuntime>>,
    on_air: Option<bool>,
    active_theme: Option<String>,
    live_verse: Option<String>,
    queue_length: Option<usize>,
    confidence_threshold: Option<f32>,
    rehearsal: Option<bool>,
    waiting_for_approval: Option<bool>,
) -> Result<(), String> {
    let status = {
        let runtime = state.lock().map_err(|e| e.to_string())?;
        runtime.shared_status()
    };

    let mut snapshot = status.write().await;
    if let Some(v) = on_air {
        snapshot.on_air = v;
    }
    if let Some(v) = active_theme {
        snapshot.active_theme = Some(v);
    }
    // Always sent: None means nothing is on screen (it used to keep the last verse after Clear).
    snapshot.live_verse = live_verse;
    if let Some(v) = queue_length {
        snapshot.queue_length = v;
    }
    if let Some(v) = confidence_threshold {
        snapshot.confidence_threshold = v;
    }
    if let Some(v) = rehearsal {
        snapshot.rehearsal = v;
    }
    if let Some(v) = waiting_for_approval {
        snapshot.waiting_for_approval = v;
    }

    Ok(())
}

#[derive(serde::Serialize)]
pub struct HttpStatus {
    pub running: bool,
    pub port: Option<u16>,
    /// Reachable from other devices (bound to 0.0.0.0).
    pub lan: bool,
}

/// Where the listeners bind: the whole network (default, what existing setups
/// expect) or this computer only. Keys and pairing are the other gate
/// (`RemoteKeys`). See docs/rhema-studio/13-remote-control-threat-notes.md.
fn bind_host(lan: Option<bool>) -> &'static str {
    if lan.unwrap_or(true) { "0.0.0.0" } else { "127.0.0.1" }
}

/// The command an AI assistant runs to reach Rhema's MCP server (this app, with `--mcp`).
#[tauri::command]
pub fn mcp_server_command() -> Result<String, String> {
    std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).map_err(|e| e.to_string())
}

/// The host window's answer to a desk's talk-channel offer (Rhema Comms C3, ADR 0002).
#[tauri::command]
pub fn voice_answer(state: State<'_, Mutex<HttpRuntime>>, id: String, sdp: String) -> Result<bool, String> {
    if sdp.len() > 64 * 1024 {
        return Err("answer too large".into());
    }
    let hub = state.lock().map_err(|e| e.to_string())?.voice.clone();
    Ok(hub.answer(&id, sdp))
}

/// A browser feed's health (receiver trust): pages following it and the newest frame one drew.
#[tauri::command]
pub fn feed_status(state: State<'_, Mutex<HttpRuntime>>, id: String) -> Result<Option<rhema_api::FeedStatus>, String> {
    let hub = state.lock().map_err(|e| e.to_string())?.feeds.clone();
    Ok(hub.status(&id))
}
