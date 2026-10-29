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

#[derive(Debug, PartialEq, Eq)]
enum RemoteAccessChange {
    Revoked,
    RoleChanged {
        from: Role,
        to: Role,
    },
    OutputScopeChanged {
        added: Vec<String>,
        removed: Vec<String>,
    },
    GroupTakeScopeChanged {
        added: Vec<String>,
        removed: Vec<String>,
    },
}

/// Changes suitable for a local audit log. Credentials and operator-entered device names stay out.
fn remote_access_changes(previous: &[KeyEntry], current: &[KeyEntry]) -> Vec<RemoteAccessChange> {
    previous
        .iter()
        .flat_map(
            |old| match current.iter().find(|new| new.hash == old.hash) {
                Some(new) => {
                    let mut changes = Vec::new();
                    if new.role != old.role {
                        changes.push(RemoteAccessChange::RoleChanged {
                            from: old.role,
                            to: new.role,
                        });
                    }
                    if new.output_scope != old.output_scope {
                        changes.push(RemoteAccessChange::OutputScopeChanged {
                            added: new
                                .output_scope
                                .iter()
                                .filter(|id| !old.output_scope.contains(id))
                                .cloned()
                                .collect(),
                            removed: old
                                .output_scope
                                .iter()
                                .filter(|id| !new.output_scope.contains(id))
                                .cloned()
                                .collect(),
                        });
                    }
                    if new.group_take_scope != old.group_take_scope {
                        changes.push(RemoteAccessChange::GroupTakeScopeChanged {
                            added: new
                                .group_take_scope
                                .iter()
                                .filter(|id| !old.group_take_scope.contains(id))
                                .cloned()
                                .collect(),
                            removed: old
                                .group_take_scope
                                .iter()
                                .filter(|id| !new.group_take_scope.contains(id))
                                .cloned()
                                .collect(),
                        });
                    }
                    changes
                }
                None => vec![RemoteAccessChange::Revoked],
            },
        )
        .collect()
}

fn normalize_scope(scope: Vec<String>) -> Vec<String> {
    let mut scope: Vec<_> = scope
        .into_iter()
        .filter(|id| !id.trim().is_empty() && id.trim() == id && id.len() <= 128)
        .collect();
    scope.sort();
    scope.dedup();
    scope
}

fn normalize_key_entries(devices: Vec<KeyEntry>) -> Vec<KeyEntry> {
    devices
        .into_iter()
        .filter(|device| device.hash.len() == 64)
        .map(|mut device| {
            device.output_scope = normalize_scope(device.output_scope);
            device.group_take_scope = if device.role == Role::Screens {
                normalize_scope(device.group_take_scope)
                    .into_iter()
                    .filter(|id| device.output_scope.contains(id))
                    .collect()
            } else {
                Vec::new()
            };
            device
        })
        .collect()
}

/// Replace the accepted keys: the shared key (if any) plus every paired
/// device. `require_auth` is the operator's switch; it is forced on while
/// any key exists, and when on with no keys every command is refused.
/// An OBS companion unpaired, paused or given another role loses its camera reading at once (#209).
#[tauri::command]
pub fn remote_set_keys(
    app: AppHandle,
    remote: State<'_, RemoteKeys>,
    shared: Option<String>,
    devices: Vec<KeyEntry>,
    require_auth: Option<bool>,
) -> Result<usize, String> {
    let mut entries = normalize_key_entries(devices);
    if let Some(s) = shared
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        entries.push(KeyEntry {
            hash: hash_key(&s),
            name: "Shared key".into(),
            role: Role::Configure,
            paused: false,
            output_scope: Vec::new(),
            group_take_scope: Vec::new(),
        });
    }
    let n = entries.len();
    let previous = remote.keys.read().map_err(|e| e.to_string())?.entries.clone();
    {
        let mut k = remote.keys.write().map_err(|e| e.to_string())?;
        k.require_auth = require_auth.unwrap_or(false) || n > 0;
        k.entries = entries;
    }
    let current = remote.keys.read().map_err(|e| e.to_string())?.entries.clone();
    for change in remote_access_changes(&previous, &current) {
        match change {
            RemoteAccessChange::RoleChanged { from, to } => log::info!(
                "Remote device role changed: {} → {}",
                from.as_str(),
                to.as_str()
            ),
            RemoteAccessChange::OutputScopeChanged { added, removed } => log::info!(
                "Remote device output scope changed: added {:?}, removed {:?}",
                added,
                removed
            ),
            RemoteAccessChange::GroupTakeScopeChanged { added, removed } => log::info!(
                "Remote device group Take scope changed: added {:?}, removed {:?}",
                added,
                removed
            ),
            RemoteAccessChange::Revoked => log::info!("Remote access credential revoked"),
        }
    }
    super::camera_router::desks_changed(&app);
    Ok(n)
}

/// The effective authentication switch and number of accepted credentials, for Show Health.
#[derive(serde::Serialize)]
pub struct RemoteAuthStatus {
    pub required: bool,
    pub credential_count: usize,
}

fn remote_auth_status(keys: &KeySet) -> Result<RemoteAuthStatus, String> {
    let keys = keys.read().map_err(|e| e.to_string())?;
    Ok(RemoteAuthStatus {
        required: keys.require_auth,
        credential_count: keys.entries.len(),
    })
}

#[tauri::command]
pub fn get_remote_auth_status(remote: State<'_, RemoteKeys>) -> Result<RemoteAuthStatus, String> {
    remote_auth_status(&remote.keys)
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

/// Persist host approvals before exposing remote scene-change events to the frontend. This keeps
/// an event with `request: true` from appearing successful when its durable request was not saved.
fn emit_recorded_event(
    event: &str,
    payload: &str,
    record: impl FnOnce(&str, &str) -> Result<String, String>,
    emit: impl FnOnce(&str, &str) -> Result<(), CommandError>,
) -> Result<(), CommandError> {
    let recorded = record(event, payload).map_err(CommandError::DispatchFailed)?;
    emit(event, &recorded)
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

    fn lookup(&self, q: &rhema_api::Lookup) -> Result<serde_json::Value, String> {
        answer_lookup(&self.app, q)
    }

    fn emit_event(&self, event: &str, payload: &str) -> Result<(), CommandError> {
        // A scene change that must wait for the main desk becomes a host approval request first.
        emit_recorded_event(
            event,
            payload,
            |event, payload| super::approvals::record_scene_request(&self.app, event, payload),
            |event, payload| self.app.emit(event, payload).map_err(|e| CommandError::DispatchFailed(format!("Tauri emit failed: {e}"))),
        )
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

/// A joined desk's lookup in this computer's library (desk consoles, #197), its role already checked
/// by the server: the Bible translations this computer has, a chapter, a words search, or songs and
/// hymns (the hymn book too: a number like "CAC 245" finds its hymn). Read only.
fn answer_lookup(app: &AppHandle, q: &rhema_api::Lookup) -> Result<serde_json::Value, String> {
    use rhema_api::lookup::MAX_RESULTS;
    use rhema_api::Lookup;
    let json = |v: Result<serde_json::Value, serde_json::Error>| v.map_err(|e| e.to_string());
    match q {
        Lookup::Songs { query } => {
            let content = app.try_state::<super::content::ContentState>().ok_or("Songs are not available on the host")?;
            let guard = content.0.lock().map_err(|e| e.to_string())?;
            let db = guard.as_ref().ok_or("Songs are not available on the host")?;
            let songs = db.list_songs_tagged(Some(query.as_str()).filter(|q| !q.is_empty()), MAX_RESULTS, None).map_err(|e| e.to_string())?;
            json(Ok(serde_json::json!({ "songs": songs.iter().map(|s| serde_json::json!({
                "id": s.id, "title": s.title, "numbers": s.numbers, "firstLine": s.first_line.chars().take(120).collect::<String>(),
                "hymn": s.tags.split(',').any(|t| t.trim().eq_ignore_ascii_case("cacghb")),
            })).collect::<Vec<_>>() })))
        }
        _ => {
            let state = app.try_state::<Mutex<crate::state::AppState>>().ok_or("The Bible is not available on the host")?;
            let app_state = state.lock().map_err(|e| e.to_string())?;
            let db = app_state.bible_db.as_ref().ok_or("The Bible is not available on the host")?;
            let verses = |v: Vec<rhema_bible::Verse>| serde_json::json!({ "verses": v.into_iter().take(200).map(|v| serde_json::json!({ "book": v.book_number, "bookName": v.book_name, "chapter": v.chapter, "verse": v.verse, "text": v.text, "translation": v.translation_id })).collect::<Vec<_>>() });
            match q {
                Lookup::Translations => {
                    let list = db.list_translations().map_err(|e| e.to_string())?;
                    json(Ok(serde_json::json!({ "active": app_state.active_translation_id, "translations": list.iter().filter(|t| t.is_downloaded).map(|t| serde_json::json!({ "id": t.id, "abbreviation": t.abbreviation, "name": t.title, "language": t.language })).collect::<Vec<_>>() })))
                }
                Lookup::Chapter { translation, book, chapter } => Ok(verses(db.get_chapter(*translation, *book, *chapter).map_err(|e| e.to_string())?)),
                Lookup::Search { query, translation } => Ok(verses(db.search_verses(query, *translation, MAX_RESULTS).map_err(|e| e.to_string())?)),
                Lookup::Songs { .. } => unreachable!("answered above"),
            }
        }
    }
}

// --- OSC Runtime ---

/// Managed state for the OSC runtime.
pub struct OscRuntime {
    handle: Option<OscHandle>,
    bound_port: Option<u16>,
    lan: bool,
}

impl OscRuntime {
    pub fn new() -> Self {
        Self {
            handle: None,
            bound_port: None,
            lan: false,
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
    http: State<'_, Mutex<HttpRuntime>>,
    remote: State<'_, RemoteKeys>,
    port: Option<u16>,
    lan: Option<bool>,
) -> Result<u16, String> {
    let mut runtime = state.lock().map_err(|e| e.to_string())?;

    if runtime.handle.is_some() {
        return Err("OSC listener is already running".into());
    }

    let lan = lan.unwrap_or(true);
    let live = http.lock().map_err(|e| e.to_string())?.live.clone();
    let config = OscConfig {
        port: port.unwrap_or(8000),
        host: bind_host(Some(lan)).into(),
        keys: remote.keys.clone(),
        live,
    };

    let sink = Arc::new(TauriSink { app });
    let result = start_osc_listener(config, sink).map_err(|e| e.to_string())?;

    let bound_port = result.bound_port;
    runtime.handle = Some(result.handle);
    runtime.bound_port = Some(bound_port);
    runtime.lan = lan;

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
            runtime.lan = false;
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
        lan: runtime.lan,
    })
}

#[derive(serde::Serialize)]
pub struct OscStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub lan: bool,
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
    /// SHA-256 of this computer's local CA, which Rhema Studio Companion pins when it pairs (#209).
    tls_ca_fingerprint: Option<String>,
    /// Phone cameras and the camera router (#209); kept across restarts of the listener.
    cameras: rhema_api::SharedCameras,
    /// Who is connected and when each desk was last seen (Production → Operators); cleared on stop.
    presence: rhema_api::SharedPresence,
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
            tls_ca_fingerprint: None,
            lan: false,
            status: new_shared_status(),
            live: new_live_hub(),
            feeds: new_feed_hub(),
            voice: new_voice_hub(),
            cameras: rhema_api::new_camera_hub(),
            presence: rhema_api::new_presence(),
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

/// Snapshot the host's current output configuration for commands that must authorize a named
/// destination. A missing runtime, poisoned lock, or absent Live snapshot leaves the caller with
/// no authority to act on an output.
pub(crate) fn current_live_state(app: &AppHandle) -> Option<String> {
    let state = app.try_state::<Mutex<HttpRuntime>>()?;
    let runtime = state.lock().ok()?;
    runtime.live.current()
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
    let (status, live, feeds, voice, cameras, presence, already_running) = {
        let runtime = state.lock().map_err(|e| e.to_string())?;
        (runtime.shared_status(), runtime.live.clone(), runtime.feeds.clone(), runtime.voice.clone(), runtime.cameras(), runtime.presence.clone(), runtime.handle.is_some())
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
    let ca_fingerprint = tls.as_ref().and_then(|t| rhema_api::tls::fingerprint(&rhema_api::tls::Pem { cert: t.ca_cert.clone(), key: String::new() }).ok());
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
        presence,
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
        runtime.tls_ca_fingerprint = result.tls_port.and(ca_fingerprint);
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
            runtime.tls_ca_fingerprint = None;
            runtime.presence.clear();
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
        tls_certificate: runtime.tls_ca_fingerprint.clone(),
    })
}

/// What Production → Operators shows about hosting: whether the listener runs and for whom, this
/// computer's addresses on the church network, its https port and certificate check, and each
/// paired desk with whether it is connected now and when it was last seen.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostStatus {
    pub running: bool,
    pub lan: bool,
    pub port: Option<u16>,
    pub tls_port: Option<u16>,
    /// The local CA's fingerprint (https on): each joined computer shows the same.
    pub ca_fingerprint: Option<String>,
    /// "192.168.1.20:8080", one per network this computer is on (wired, Wi-Fi).
    pub addresses: Vec<String>,
    pub desks: Vec<rhema_api::DeskPresence>,
}

/// This computer's IPv4 addresses on its networks (private first, then link-local); never loopback.
fn lan_addresses() -> Vec<std::net::Ipv4Addr> {
    let mut ips: Vec<std::net::Ipv4Addr> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|i| match i.ip() {
            std::net::IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_unspecified() && (v4.is_private() || v4.is_link_local()) => Some(v4),
            _ => None,
        })
        .collect();
    ips.sort_by_key(|ip| (ip.is_link_local(), *ip));
    ips.dedup();
    ips
}

#[tauri::command]
pub fn host_status(state: State<'_, Mutex<HttpRuntime>>, remote: State<'_, RemoteKeys>) -> Result<HostStatus, String> {
    // Only desks that still have a key here: a revoked one is gone from the card at once.
    let listed: Vec<String> = remote.keys.read().map_err(|e| e.to_string())?.entries.iter().map(|e| e.hash.clone()).collect();
    let runtime = state.lock().map_err(|e| e.to_string())?;
    let running = runtime.handle.as_ref().is_some_and(rhema_api::HttpHandle::is_active);
    let addresses = match (running && runtime.lan, runtime.bound_port) {
        (true, Some(port)) => lan_addresses().into_iter().map(|ip| format!("{ip}:{port}")).collect(),
        _ => Vec::new(),
    };
    Ok(HostStatus {
        running,
        lan: runtime.lan,
        port: runtime.bound_port,
        tls_port: runtime.tls_port,
        ca_fingerprint: runtime.tls_ca_fingerprint.clone(),
        addresses,
        desks: if running { runtime.presence.list().into_iter().filter(|d| listed.contains(&d.hash)).collect() } else { Vec::new() },
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

fn valid_group_take_aspect_ratio(value: &str) -> bool {
    let mut parts = value.split(':');
    matches!(
        (parts.next(), parts.next(), parts.next()),
        (Some(width), Some(height), None)
            if width.parse::<u32>().is_ok_and(|dimension| dimension > 0)
                && height.parse::<u32>().is_ok_and(|dimension| dimension > 0)
    )
}

fn group_take_output_revision_is_reserved(reviewed: u64, current: u64) -> bool {
    reviewed.checked_add(1) == Some(current)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupTakeHostCheck {
    pub service: String,
    pub scene_updated_at: u64,
    pub revisions: std::collections::HashMap<String, u64>,
    pub outputs: std::collections::HashMap<String, GroupTakeOutputCheck>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupTakeOutputCheck {
    pub name: String,
    #[serde(rename = "type")]
    pub output_type: String,
    pub role: String,
    pub scene_id: Option<String>,
    pub scene_revision: Option<u64>,
    pub language: String,
    pub aspect_ratio: String,
    pub theme_id: String,
    pub theme_for: std::collections::BTreeMap<String, String>,
    pub shows: Vec<String>,
    pub theme_names: std::collections::BTreeMap<String, String>,
    pub theme_revisions: std::collections::BTreeMap<String, u64>,
}

/// Recheck the accepted Screens command against current host authority and revisions immediately
/// before the single atomic store update. The event's identity and requested targets are server
/// stamped; this command never accepts a client supplied grant.
#[tauri::command]
pub fn remote_group_take_preflight(
    state: State<'_, Mutex<HttpRuntime>>,
    remote: State<'_, RemoteKeys>,
    by_id: String,
    scene: String,
    outputs: Vec<String>,
    service: String,
    seen: std::collections::HashMap<String, u64>,
) -> Result<GroupTakeHostCheck, String> {
    if by_id.len() != 64 || !by_id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("The requesting desk could not be verified".into());
    }
    if scene.trim().is_empty() || scene.trim() != scene || scene.len() > 128 {
        return Err("Choose a valid scene before a group Take".into());
    }
    if !(2..=32).contains(&outputs.len())
        || outputs
            .iter()
            .any(|id| id.trim().is_empty() || id.trim() != id || id.len() > 128)
    {
        return Err("A group Take needs between two and 32 valid outputs".into());
    }
    let unique: std::collections::HashSet<_> = outputs.iter().collect();
    if unique.len() != outputs.len() {
        return Err("A group Take cannot include an output more than once".into());
    }

    {
        let keys = remote.keys.read().map_err(|e| e.to_string())?;
        let entry = keys
            .entries
            .iter()
            .find(|entry| entry.hash == by_id)
            .ok_or_else(|| "The requesting desk is no longer paired".to_string())?;
        if entry.role != Role::Screens || entry.paused {
            return Err("The requesting desk no longer has Screens control".into());
        }
        if outputs
            .iter()
            .any(|id| !entry.output_scope.contains(id) || !entry.group_take_scope.contains(id))
        {
            return Err("The host no longer grants group Take for every selected output".into());
        }
    }

    let live = state.lock().map_err(|e| e.to_string())?.live.clone();
    if live.service().as_deref() != Some(service.as_str()) {
        return Err("The host has changed services; refresh before a group Take".into());
    }
    let current = live
        .current()
        .ok_or_else(|| "The host Live State is not ready".to_string())?;
    let value: serde_json::Value = serde_json::from_str(&current)
        .map_err(|_| "The host Live State could not be checked".to_string())?;
    let snapshot_service = value
        .pointer("/service/id")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    if snapshot_service != service {
        return Err("The host Live State changed services; refresh before a group Take".into());
    }
    if value
        .pointer("/program/rehearsal")
        .and_then(serde_json::Value::as_bool)
        == Some(true)
    {
        return Err("Group Take is unavailable during rehearsal".into());
    }
    let scene_exists = value
        .get("scenes")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|scenes| {
            scenes.iter().any(|candidate| {
                candidate.get("id").and_then(serde_json::Value::as_str) == Some(scene.as_str())
            })
        });
    if !scene_exists {
        return Err("That scene is no longer available; refresh before a group Take".into());
    }
    let scene_updated_at = value
        .get("scenes")
        .and_then(serde_json::Value::as_array)
        .and_then(|scenes| {
            scenes.iter().find(|candidate| {
                candidate.get("id").and_then(serde_json::Value::as_str) == Some(scene.as_str())
            })
        })
        .and_then(|candidate| candidate.get("updatedAt"))
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| "The scene revision is unavailable; refresh before a group Take".to_string())?;
    if outputs
        .iter()
        .any(|id| !KeyEntry::is_congregation_output(Some(&current), id))
    {
        return Err("Group Take is limited to current congregation outputs".into());
    }

    let scene_part = format!("scene:{scene}");
    let scene_seen = seen
        .get(&scene_part)
        .ok_or_else(|| "Scene revision is missing; refresh before a group Take".to_string())?;
    if live.revision(&scene_part) != Some(*scene_seen) {
        return Err("The scene changed since review; refresh before a group Take".into());
    }
    let mut revisions = std::collections::HashMap::with_capacity(outputs.len() + 1);
    revisions.insert(scene_part, *scene_seen);
    let live_outputs = value
        .get("outputs")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "The host output list is unavailable; refresh before a group Take".to_string())?;
    let mut output_checks = std::collections::HashMap::with_capacity(outputs.len());
    for id in outputs {
        let part = format!("output:{id}");
        let seen_revision = seen.get(&part).ok_or_else(|| {
            format!("Output {id} revision is missing; refresh before a group Take")
        })?;
        let current_revision = live.revision(&part).ok_or_else(|| {
            format!("Output {id} revision is unavailable; refresh before a group Take")
        })?;
        if !group_take_output_revision_is_reserved(*seen_revision, current_revision) {
            return Err(format!(
                "Output {id} changed since review; refresh before a group Take"
            ));
        }
        revisions.insert(part, current_revision);
        let output = live_outputs
            .iter()
            .find(|candidate| candidate.get("id").and_then(serde_json::Value::as_str) == Some(id.as_str()))
            .ok_or_else(|| format!("Output {id} is no longer available; refresh before a group Take"))?;
        let name = output
            .get("name")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| format!("Output {id} name is unavailable; refresh before a group Take"))?
            .to_string();
        let output_type = output
            .get("type")
            .and_then(serde_json::Value::as_str)
            .filter(|value| matches!(*value, "display" | "ndi" | "browser"))
            .ok_or_else(|| format!("Output {id} type is unavailable; refresh before a group Take"))?
            .to_string();
        let role = output
            .get("role")
            .and_then(serde_json::Value::as_str)
            .filter(|value| *value == "congregation")
            .ok_or_else(|| format!("Output {id} is no longer a congregation output"))?
            .to_string();
        let impact = output
            .get("impact")
            .ok_or_else(|| format!("Output {id} impact is unavailable; refresh before a group Take"))?;
        let language = impact
            .get("language")
            .and_then(serde_json::Value::as_str)
            .filter(|value| matches!(*value, "both" | "first" | "second"))
            .ok_or_else(|| format!("Output {id} language is unavailable; refresh before a group Take"))?
            .to_string();
        let aspect_ratio = impact
            .get("aspectRatio")
            .and_then(serde_json::Value::as_str)
            .filter(|value| valid_group_take_aspect_ratio(value))
            .ok_or_else(|| format!("Output {id} frame format is unavailable; refresh before a group Take"))?
            .to_string();
        let theme_id = impact
            .get("themeId")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("Output {id} look is unavailable; refresh before a group Take"))?
            .to_string();
        let theme_for = impact
            .get("themeFor")
            .cloned()
            .and_then(|value| serde_json::from_value(value).ok())
            .ok_or_else(|| format!("Output {id} content looks are unavailable; refresh before a group Take"))?;
        let shows = impact
            .get("shows")
            .and_then(serde_json::Value::as_array)
            .filter(|values| values.iter().all(serde_json::Value::is_string))
            .map(|values| values.iter().filter_map(serde_json::Value::as_str).map(str::to_string).collect())
            .ok_or_else(|| format!("Output {id} subscriptions are unavailable; refresh before a group Take"))?;
        let theme_names = impact
            .get("themeNames")
            .cloned()
            .and_then(|value| serde_json::from_value(value).ok())
            .ok_or_else(|| format!("Output {id} look names are unavailable; refresh before a group Take"))?;
        let theme_revisions = impact
            .get("themeRevisions")
            .cloned()
            .and_then(|value| serde_json::from_value(value).ok())
            .ok_or_else(|| format!("Output {id} look revisions are unavailable; refresh before a group Take"))?;
        output_checks.insert(id.clone(), GroupTakeOutputCheck {
            name,
            output_type,
            role,
            scene_id: output.get("sceneId").and_then(serde_json::Value::as_str).map(str::to_string),
            scene_revision: output.get("sceneRevision").and_then(serde_json::Value::as_u64),
            language,
            aspect_ratio,
            theme_id,
            theme_for,
            shows,
            theme_names,
            theme_revisions,
        });
    }

    Ok(GroupTakeHostCheck { service, scene_updated_at, revisions, outputs: output_checks })
}

#[derive(serde::Deserialize)]
pub struct FeedEntry {
    id: String,
    token: String,
    /// Each paired TV's own key (#198), by the TV's address; absent from an older window.
    #[serde(default)]
    tvs: Vec<FeedTvEntry>,
}

#[derive(serde::Deserialize)]
pub struct FeedTvEntry {
    id: String,
    token: String,
}

/// The keys `feeds_set` hands the server: keys shorter than 16 characters are never accepted.
fn feed_keys(feeds: Vec<FeedEntry>) -> Vec<rhema_api::FeedKeys> {
    feeds
        .into_iter()
        .filter(|f| f.token.len() >= 16)
        .map(|f| rhema_api::FeedKeys { id: f.id, token: f.token, tvs: f.tvs.into_iter().filter(|t| t.token.len() >= 16).map(|t| (t.id, t.token)).collect() })
        .collect()
}

/// The browser feeds (outputs of type "browser") and their secrets, with each paired TV's own key,
/// kept in step with the outputs. A key no longer listed stops working at once.
#[tauri::command]
pub fn feeds_set(state: State<'_, Mutex<HttpRuntime>>, feeds: Vec<FeedEntry>) -> Result<(), String> {
    let hub = state.lock().map_err(|e| e.to_string())?.feeds.clone();
    hub.set_keys(&feed_keys(feeds));
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
    /// The fingerprint of this computer's certificate (its local CA) while https runs: Rhema
    /// Companion shows the same one when it pairs, and pins it (#209).
    pub tls_certificate: Option<String>,
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
    fn approval_persistence_failure_prevents_scene_event_emission() {
        let mut emitted = false;
        let result = emit_recorded_event(
            "remote:save_scene",
            r#"{"request":true,"scene":{"id":"s1"}}"#,
            |_, _| Err("database unavailable".to_string()),
            |_, _| {
                emitted = true;
                Ok(())
            },
        );
        assert!(result.is_err());
        assert!(!emitted);
    }

    #[test]
    fn group_take_aspect_ratio_accepts_only_positive_dimensions() {
        assert!(valid_group_take_aspect_ratio("16:9"));
        assert!(valid_group_take_aspect_ratio("4:3"));
        assert!(!valid_group_take_aspect_ratio("0:9"));
        assert!(!valid_group_take_aspect_ratio("16:0"));
        assert!(!valid_group_take_aspect_ratio("16:9:4"));
        assert!(!valid_group_take_aspect_ratio("wide"));
    }

    #[test]
    fn group_take_preflight_accepts_only_the_single_reserved_output_revision() {
        assert!(group_take_output_revision_is_reserved(7, 8));
        assert!(!group_take_output_revision_is_reserved(7, 7));
        assert!(!group_take_output_revision_is_reserved(7, 9));
        assert!(!group_take_output_revision_is_reserved(u64::MAX, u64::MAX));
    }

    #[test]
    fn remote_auth_health_reports_only_effective_gate_and_credential_count() {
        let keys = new_key_set();
        assert_eq!(
            remote_auth_status(&keys).unwrap().credential_count,
            0
        );
        keys.write().unwrap().require_auth = true;
        keys.write().unwrap().entries.push(KeyEntry {
            hash: "private-hash".into(),
            name: "private label".into(),
            role: Role::Present,
            paused: false,
            output_scope: Vec::new(),
            group_take_scope: Vec::new(),
        });
        let status = remote_auth_status(&keys).unwrap();
        assert!(status.required);
        assert_eq!(status.credential_count, 1);
    }

    #[test]
    fn remote_access_audit_changes_exclude_names_and_credential_hashes() {
        let entry = |hash: char, name: &str, role| KeyEntry {
            hash: hash.to_string().repeat(64),
            name: name.into(),
            role,
            paused: false,
            output_scope: Vec::new(),
            group_take_scope: Vec::new(),
        };
        let previous = [
            entry('a', "Private phone label", Role::Configure),
            KeyEntry { output_scope: vec!["sanctuary".into()], ..entry('b', "Another device", Role::Screens) },
            entry('d', "Revoked device", Role::Present),
        ];
        let current = [
            entry('a', "Private phone label", Role::Screens),
            KeyEntry { output_scope: vec!["overflow".into()], ..entry('b', "Another device", Role::Screens) },
            entry('c', "New device", Role::Present),
        ];

        assert_eq!(
            remote_access_changes(&previous, &current),
            [
                RemoteAccessChange::RoleChanged {
                    from: Role::Configure,
                    to: Role::Screens,
                },
                RemoteAccessChange::OutputScopeChanged { added: vec!["overflow".into()], removed: vec!["sanctuary".into()] },
                RemoteAccessChange::Revoked,
            ]
        );
        assert!(remote_access_changes(&current, &current).is_empty());
    }

    #[test]
    fn group_take_grants_are_normalized_and_audited_separately() {
        let mut device = KeyEntry {
            hash: "a".repeat(64),
            name: "Screens desk".into(),
            role: Role::Screens,
            paused: false,
            output_scope: vec!["sanctuary".into(), "sanctuary".into()],
            group_take_scope: vec!["sanctuary".into(), "overflow".into(), "overflow".into()],
        };
        let prior = normalize_key_entries(vec![device.clone()]);
        assert_eq!(prior[0].output_scope, ["sanctuary"]);
        assert_eq!(prior[0].group_take_scope, ["sanctuary"]);

        device.output_scope.push("overflow".into());
        device.group_take_scope.push("overflow".into());
        let next = normalize_key_entries(vec![device]);
        assert_eq!(next[0].group_take_scope, ["overflow", "sanctuary"]);
        assert_eq!(
            remote_access_changes(&prior, &next),
            [
                RemoteAccessChange::OutputScopeChanged {
                    added: vec!["overflow".into()],
                    removed: vec![]
                },
                RemoteAccessChange::GroupTakeScopeChanged {
                    added: vec!["overflow".into()],
                    removed: vec![]
                },
            ]
        );
        assert!(normalize_key_entries(vec![KeyEntry {
            role: Role::Viewer,
            ..next[0].clone()
        }])[0]
            .group_take_scope
            .is_empty());
    }

    #[test]
    fn feed_keys_keep_each_tv_key_and_drop_short_ones() {
        let feeds: Vec<FeedEntry> = serde_json::from_value(serde_json::json!([
            { "id": "hall", "token": "feed-key-0123456789", "tvs": [{ "id": "192.168.1.40:8095", "token": "tv-key-0123456789ab" }, { "id": "192.168.1.41:8095", "token": "short" }] },
            { "id": "old", "token": "feed-key-from-before" },
            { "id": "bad", "token": "short" },
        ]))
        .unwrap();
        let keys = feed_keys(feeds);
        assert_eq!(keys.len(), 2);
        assert_eq!(keys[0].tvs, [("192.168.1.40:8095".to_string(), "tv-key-0123456789ab".to_string())]);
        assert!(keys[1].tvs.is_empty(), "an older window sends no TV keys");
    }

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
