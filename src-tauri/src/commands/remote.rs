use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager, State};

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
        entries.push(KeyEntry { hash: hash_key(&s), name: "Shared key".into(), role: Role::Configure, paused: false });
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

    fn media_file(&self, file: &str) -> Option<std::path::PathBuf> {
        let media = self.app.try_state::<super::media::MediaState>()?;
        super::media::media_file_path(media.inner(), file)
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
    /// The https port for phone pages, when https is on.
    tls_port: Option<u16>,
    /// SHA-256 of the https certificate, sent to a Rhema Receiver TV with a feed's https link (#198).
    tls_fingerprint: Option<String>,
    /// Phone cameras and the camera router (#209); kept across restarts of the listener.
    cameras: rhema_api::SharedCameras,
    /// The church name (Brand Kit) this host announces itself by (#197).
    church: String,
    /// This host's announcement on the network, while the listener is reachable from it (#197).
    advert: Option<super::host_advert::Advertising>,
}

impl HttpRuntime {
    pub fn new() -> Self {
        Self {
            handle: None,
            bound_port: None,
            tls_port: None,
            tls_fingerprint: None,
            lan: false,
            status: new_shared_status(),
            live: new_live_hub(),
            feeds: new_feed_hub(),
            voice: new_voice_hub(),
            cameras: rhema_api::new_camera_hub(),
            church: String::new(),
            advert: None,
        }
    }

    /// Announce this host on the network as it is now (#197): started, moved to another port or
    /// renamed → announced again; stopped or on this computer only → no longer announced.
    fn refresh_advert(&mut self) {
        let bind = if self.lan { "0.0.0.0" } else { "127.0.0.1" };
        let plan = self.bound_port.and_then(|port| super::host_advert::host_advert(bind, port, self.tls_port, &self.church, &super::host_advert::computer_name()));
        if self.advert.as_ref().map(|a| &a.plan) == plan.as_ref() {
            return;
        }
        if let Some(old) = self.advert.take() {
            super::host_advert::stop(old);
        }
        if let Some(plan) = plan {
            match super::host_advert::start(plan) {
                Ok(ad) => {
                    log::info!("Announcing this host on the network as \"{}\"", ad.plan.instance);
                    self.advert = Some(ad);
                }
                // Joining computers can still type the address.
                Err(e) => log::warn!("Could not announce this host on the network: {e}"),
            }
        }
    }

    /// The camera list and router target the camera page's requests are checked against.
    pub fn cameras(&self) -> rhema_api::SharedCameras {
        self.cameras.clone()
    }

    pub fn shared_status(&self) -> SharedStatus {
        self.status.clone()
    }

    /// The https port and its certificate's fingerprint, while https runs: what Show on a Google
    /// TV needs (#198); None means a TV cannot be sent a feed.
    pub fn tv_pin(&self) -> Option<(u16, String)> {
        self.tls_port.zip(self.tls_fingerprint.clone())
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
    https: Option<bool>,
) -> Result<u16, String> {
    let (status, live, feeds, voice, cameras, already_running) = {
        let runtime = state.lock().map_err(|e| e.to_string())?;
        (runtime.shared_status(), runtime.live.clone(), runtime.feeds.clone(), runtime.voice.clone(), runtime.cameras(), runtime.handle.is_some())
    };

    if already_running {
        return Err("HTTP API server is already running".into());
    }

    let port = port.unwrap_or(8080);
    // https beside it (the next port) for phone pages, when asked; a failure leaves http alone.
    let tls = if https.unwrap_or(false) {
        match phone_tls(&app, port.saturating_add(1)) {
            Ok(t) => Some(t),
            Err(e) => {
                log::warn!("https for phone pages not started: {e}");
                None
            }
        }
    } else {
        None
    };
    let fingerprint = tls.as_ref().and_then(|t| rhema_api::tls::fingerprint(&t.server).ok());
    let config = HttpConfig {
        port,
        host: bind_host(lan).into(),
        keys: remote.keys.clone(),
        pairing: remote.pairing.clone(),
        live,
        feeds,
        voice,
        tls,
        cameras,
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
        runtime.tls_port = result.tls_port;
        runtime.tls_fingerprint = result.tls_port.and(fingerprint);
        runtime.lan = bind_host(lan) != "127.0.0.1";
        runtime.refresh_advert();
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
            runtime.tls_port = None;
            runtime.tls_fingerprint = None;
            runtime.refresh_advert();
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
        tls_port: runtime.tls_port,
    })
}

/// The church name this host announces itself by on the network (#197); announced again at once
/// when it changes while hosting.
#[tauri::command]
pub fn host_set_name(state: State<'_, Mutex<HttpRuntime>>, name: String) -> Result<(), String> {
    let mut runtime = state.lock().map_err(|e| e.to_string())?;
    runtime.church = name.chars().take(120).collect();
    runtime.refresh_advert();
    Ok(())
}

/// When the app quits: stop announcing this host, so joining computers stop listing it.
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<Mutex<HttpRuntime>>() {
        if let Ok(mut runtime) = state.lock() {
            if let Some(ad) = runtime.advert.take() {
                super::host_advert::stop(ad);
            }
        }
    }
}

/// The local CA (made once, kept in the app's data folder, its key readable only by this user) and
/// a certificate for this computer's current addresses, for the https listener (#251).
fn phone_tls(app: &AppHandle, port: u16) -> Result<rhema_api::TlsListener, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("tls");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let (cert_path, key_path) = (dir.join("rhema-ca.pem"), dir.join("rhema-ca.key"));
    let (ca, new_ca) = match (std::fs::read_to_string(&cert_path), std::fs::read_to_string(&key_path)) {
        (Ok(cert), Ok(key)) => (rhema_api::tls::Pem { cert, key }, false),
        _ => {
            let ca = rhema_api::tls::make_ca()?;
            std::fs::write(&cert_path, &ca.cert).map_err(|e| e.to_string())?;
            write_private(&key_path, &ca.key)?;
            (ca, true)
        }
    };
    let mut names = vec!["127.0.0.1".to_string(), "localhost".to_string()];
    if let Some(ip) = remote_lan_address() {
        names.insert(0, ip);
    }
    let server = server_cert(&dir, &ca, &names, new_ca, now_secs())?;
    Ok(rhema_api::TlsListener { port, server, ca_cert: ca.cert })
}

/// A server certificate expires after 397 days; a new one is made after this many.
const SERVER_CERT_DAYS: u64 = 365;

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// This computer's https certificate, kept while its addresses stay the same (for about a year), so
/// a Google TV that was sent this certificate's fingerprint with its feed (#198) still opens it after
/// Rhema restarts, and a phone that accepted the warning once is not asked again. A new address,
/// a new CA or an old certificate gets a new one (a TV then needs its feed sent again; so does its
/// link, which has the address in it).
fn server_cert(dir: &std::path::Path, ca: &rhema_api::tls::Pem, names: &[String], new_ca: bool, now: u64) -> Result<rhema_api::tls::Pem, String> {
    let (cert_path, key_path, about_path) = (dir.join("rhema-server.pem"), dir.join("rhema-server.key"), dir.join("rhema-server.txt"));
    // "<made at, unix seconds>\n<names, one per line>"
    let about = |made: u64| format!("{made}\n{}", names.join("\n"));
    if !new_ca {
        if let (Ok(cert), Ok(key), Ok(saved)) = (std::fs::read_to_string(&cert_path), std::fs::read_to_string(&key_path), std::fs::read_to_string(&about_path)) {
            let made = saved.lines().next().and_then(|l| l.trim().parse::<u64>().ok());
            if let Some(made) = made.filter(|m| *m <= now && now - m < SERVER_CERT_DAYS * 86_400) {
                if saved == about(made) && rhema_api::tls::fingerprint(&rhema_api::tls::Pem { cert: cert.clone(), key: String::new() }).is_ok() {
                    return Ok(rhema_api::tls::Pem { cert, key });
                }
            }
        }
    }
    let server = rhema_api::tls::make_server(ca, names)?;
    // Not kept is only a new certificate at the next start, as before.
    let kept = std::fs::write(&cert_path, &server.cert).and_then(|()| std::fs::write(&about_path, about(now)));
    if kept.is_err() || write_private(&key_path, &server.key).is_err() {
        log::warn!("Could not keep the https certificate; a new one is made at the next start");
        let _ = std::fs::remove_file(&about_path);
    }
    Ok(server)
}

fn write_private(path: &std::path::Path, text: &str) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path).map_err(|e| e.to_string())?;
        f.write_all(text.as_bytes()).map_err(|e| e.to_string())
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, text).map_err(|e| e.to_string())
    }
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
    /// The https port for phone pages, when https is on.
    pub tls_port: Option<u16>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_https_certificate_is_kept_while_the_addresses_stay_the_same() {
        let dir = std::env::temp_dir().join(format!("rhema-tls-test-{}-{}", std::process::id(), now_secs()));
        std::fs::create_dir_all(&dir).unwrap();
        let ca = rhema_api::tls::make_ca().unwrap();
        let names = vec!["192.168.1.20".to_string(), "127.0.0.1".to_string(), "localhost".to_string()];
        let day = 86_400;
        let t0 = 1_800_000_000;
        let first = server_cert(&dir, &ca, &names, false, t0).unwrap();
        let fp = |p: &rhema_api::tls::Pem| rhema_api::tls::fingerprint(p).unwrap();
        // Restarted the next day: the same certificate and key, so a TV's fingerprint still matches.
        let again = server_cert(&dir, &ca, &names, false, t0 + day).unwrap();
        assert_eq!(fp(&again), fp(&first));
        assert_eq!(again.key, first.key);
        assert!(rhema_api::tls::server_config(&again, &ca.cert).is_ok());
        // Another address, a new CA, or a year old: a new one.
        let moved = server_cert(&dir, &ca, &["192.168.1.21".to_string(), "127.0.0.1".into(), "localhost".into()], false, t0 + 2 * day).unwrap();
        assert_ne!(fp(&moved), fp(&first));
        let back = server_cert(&dir, &ca, &names, false, t0 + 3 * day).unwrap();
        assert_ne!(fp(&back), fp(&moved), "the address came back: made again for it");
        assert_ne!(fp(&server_cert(&dir, &ca, &names, true, t0 + 4 * day).unwrap()), fp(&back));
        let latest = server_cert(&dir, &ca, &names, false, t0 + 5 * day).unwrap();
        assert_ne!(fp(&server_cert(&dir, &ca, &names, false, t0 + 5 * day + SERVER_CERT_DAYS * day).unwrap()), fp(&latest));
        // A clock set back before it was made: a new one, never one "from the future".
        let now = server_cert(&dir, &ca, &names, false, t0 + 900 * day).unwrap();
        assert_ne!(fp(&server_cert(&dir, &ca, &names, false, t0).unwrap()), fp(&now));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
