use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager, State};

use rhema_api::{
    close_pairing, hash_key, new_closed_key_set, new_key_set, new_pairing_window, open_pairing, CommandError, CommandSink, HttpConfig, HttpHandle, KeyEntry, KeySet, Role,
    OscConfig, OscHandle, PairingWindow, SceneTakeRefusal, SceneTakeRevisions, SharedFeeds, SharedVoice, new_voice_hub, SharedLive, SharedStatus, new_feed_hub, new_live_hub, new_shared_status, start_http_server, start_osc_listener,
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
        Self { keys: new_closed_key_set(), pairing: new_pairing_window() }
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
            record: false,
        });
    }
    let n = entries.len();
    let previous = remote.keys.read().map_err(|e| e.to_string())?.entries.clone();
    {
        let mut k = remote.keys.write().map_err(|e| e.to_string())?;
        // A missing switch means a key is required (#412): open access is only ever chosen explicitly.
        k.require_auth = require_auth.unwrap_or(true) || n > 0;
        k.entries = entries;
    }
    let current = remote.keys.read().map_err(|e| e.to_string())?.entries.clone();
    // The recorder grant is its own authority (doc 42): every change to it is logged.
    for now in &current {
        let before = previous.iter().find(|p| p.hash == now.hash).is_some_and(|p| p.record);
        if now.record != before {
            log::info!("Recorder {} for remote device '{}'", if now.record { "granted" } else { "taken back" }, now.name);
        }
    }
    for gone in previous.iter().filter(|p| p.record && !current.iter().any(|c| c.hash == p.hash)) {
        log::info!("Recorder taken back: remote device '{}' removed", gone.name);
    }
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

    fn plans(&self, by: &rhema_api::Desk, q: &rhema_api::PlanRequest) -> Result<serde_json::Value, rhema_api::PlanError> {
        answer_plan(&self.app, by, q)
    }

    fn requests(&self, by: &rhema_api::Desk, q: &rhema_api::RequestQuery) -> Result<serde_json::Value, rhema_api::PlanError> {
        answer_requests(&self.app, by, q)
    }

    fn approved_scene_take(&self, service: Option<&str>, scene: &str, outputs: &[String]) -> Result<(), SceneTakeRefusal> {
        approved_scene_take(&self.app, service, scene, outputs).map(|_| ())
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
            // Rhema's own recorder, for a desk the host granted it (checked by the control server).
            "recorder" => super::recorder::remote(&self.app, args).map_err(|p| CommandError::DispatchFailed(p.message)),
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

/// A paired desk's plan request (C5, `docs/contracts/plan-drafts-v1.md`), already checked for its role.
/// A save keeps the approved revision pinned; a submit asks the main desk to approve exactly the
/// revision the desk saw. The main desk hears of both; neither changes Live.
fn answer_plan(app: &AppHandle, by: &rhema_api::Desk, q: &rhema_api::PlanRequest) -> Result<serde_json::Value, rhema_api::PlanError> {
    use rhema_api::{PlanError, PlanRequest};
    use rhema_content::{ContentError, ProgramWithItems};
    let failed = |e: ContentError| match e {
        ContentError::NotFound(_) => PlanError::NotFound,
        ContentError::Conflict { expected, actual } => PlanError::Conflict { expected, actual },
        ContentError::Invalid(m) => PlanError::Invalid(m),
        e @ (ContentError::InUse { .. } | ContentError::Refused { .. }) => PlanError::Invalid(e.to_string()),
        e => PlanError::Unavailable(e.to_string()),
    };
    let unavailable = || PlanError::Unavailable("Services are not available on the host".into());
    let content = app.try_state::<super::content::ContentState>().ok_or_else(unavailable)?;
    let guard = content.0.lock().map_err(|_| unavailable())?;
    let db = guard.as_ref().ok_or_else(unavailable)?;
    let read_active_plan = |id: &str| -> Result<ProgramWithItems, PlanError> {
        let plan = db.get_program(id).map_err(failed)?.ok_or(PlanError::NotFound)?;
        if !rhema_api::plans::is_available(
            plan.program.archived_at.as_deref(),
            plan.program.is_template,
        ) {
            return Err(PlanError::NotFound);
        }
        Ok(plan)
    };
    fn json<T: serde::Serialize>(v: &T) -> Result<serde_json::Value, PlanError> {
        serde_json::to_value(v).map_err(|e| PlanError::Unavailable(e.to_string()))
    }
    match q {
        PlanRequest::List => {
            let plans: Vec<_> = db.list_programs().map_err(failed)?.into_iter().filter(|p| p.archived_at.is_none() && !p.is_template).collect();
            json(&plans)
        }
        PlanRequest::Get { id } => {
            let mut response = json(&read_active_plan(id)?)?;
            rhema_api::plans::redact_notes_for_role(&mut response, by.role);
            Ok(response)
        }
        PlanRequest::Save { id, expected_revision, items } => {
            // Archived services and templates are not LAN editing targets. The ContentState lock
            // above stays held through the revision-checked save, so archive/template changes on
            // this host cannot race this eligibility check.
            let _current = read_active_plan(id)?;
            let items: Vec<rhema_content::ItemInput> = items
                .iter()
                .cloned()
                .map(serde_json::from_value)
                .collect::<Result<_, _>>()
                .map_err(|e| PlanError::Invalid(format!("an item is not one Rhema knows: {e}")))?;
            // Recorded as the desk, marked by its key (never just the name it was paired with), so a desk
            // named like an operator here can neither pass as that operator nor touch their comments.
            let actor = format!("{} (desk {})", by.name, by.id.get(..12).unwrap_or(by.id.as_str()));
            let saved = rhema_content::as_actor(&actor, || db.replace_items(id, *expected_revision, &items)).map_err(failed)?;
            log::info!("Plan {id} saved at revision {} by {actor}", saved.program.revision);
            let _ = app.emit_to("main", "remote:plan_saved", serde_json::json!({ "id": id, "revision": saved.program.revision, "by": by.name }));
            json(&saved)
        }
        PlanRequest::Submit { id, revision, note } => {
            let current = read_active_plan(id)?;
            if current.program.revision != *revision {
                return Err(PlanError::Conflict { expected: *revision, actual: current.program.revision });
            }
            let request = db
                .submit_approval_request(
                    &rhema_content::Actor { id: by.id.clone(), name: by.name.clone() },
                    &rhema_content::ApprovalRequestInput {
                        kind: "plan_approve".into(),
                        target_id: id.clone(),
                        base_revision: Some(*revision),
                        payload: serde_json::json!({ "title": current.program.title, "revision": revision, "items": current.items.len() }),
                        reason: note.clone(),
                        ttl_secs: None,
                    },
                )
                .map_err(failed)?;
            log::info!("Plan {id} revision {revision} submitted for review by {}", by.name);
            let _ = app.emit_to("main", "remote:plan_submitted", serde_json::json!({ "id": id, "revision": revision, "requestId": request.id, "by": by.name }));
            json(&request)
        }
    }
}

/// A paired desk's own approval requests (#410), by the key it is paired with: newest first, with
/// where each stands and the main desk's note; or withdrawing one it sent that nobody has decided.
/// The main desk hears of a withdrawal so its Requests inbox can drop it.
fn answer_requests(app: &AppHandle, by: &rhema_api::Desk, q: &rhema_api::RequestQuery) -> Result<serde_json::Value, rhema_api::PlanError> {
    use rhema_api::{PlanError, RequestQuery};
    use rhema_content::ContentError;
    let unavailable = || PlanError::Unavailable("Requests are not available on the host".into());
    let content = app.try_state::<super::content::ContentState>().ok_or_else(unavailable)?;
    let guard = content.0.lock().map_err(|_| unavailable())?;
    let db = guard.as_ref().ok_or_else(unavailable)?;
    let row = |r: &rhema_content::ApprovalRequest| serde_json::json!({
        "id": r.id, "kind": r.kind, "targetId": r.target_id, "baseRevision": r.base_revision, "state": r.state,
        "reason": r.reason, "createdAt": r.created_at, "expiresAt": r.expires_at, "decidedAt": r.decided_at,
        "decidedBy": r.decided_by.as_ref().map(|a| a.name.clone()), "decisionNote": r.decision_note,
    });
    match q {
        RequestQuery::Mine => {
            let mine = db.list_approval_requests(None, Some(&by.id)).map_err(|e| PlanError::Unavailable(e.to_string()))?;
            Ok(serde_json::json!({ "requests": mine.iter().take(100).map(row).collect::<Vec<_>>() }))
        }
        RequestQuery::Withdraw(id) => {
            let done = db.withdraw_approval_request(id, &rhema_content::Actor { id: by.id.clone(), name: by.name.clone() }).map_err(|e| match e {
                ContentError::NotFound(_) => PlanError::NotFound,
                ContentError::Refused { message, .. } => PlanError::Refused(message),
                ContentError::Invalid(m) => PlanError::Invalid(m),
                other => PlanError::Unavailable(other.to_string()),
            })?;
            log::info!("Approval request {} withdrawn by {}", done.id, by.name);
            let _ = app.emit_to("main", "remote:request_withdrawn", serde_json::json!({ "id": done.id, "kind": done.kind, "by": by.name }));
            Ok(row(&done))
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
    /// While https runs: certificates for addresses this computer moved to (`follow_address`).
    tls_leaves: Option<rhema_api::TlsLeaves>,
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
            tls_leaves: None,
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

    pub fn feeds(&self) -> SharedFeeds {
        self.feeds.clone()
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

/// Start this run's live revisions past every earlier run's (`reserve_revision_floor`).
pub fn start_revisions(app: &AppHandle, dir: &std::path::Path) {
    let now_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
    match rhema_api::reserve_revision_floor(&dir.join("live-revisions"), now_ms) {
        Ok(floor) => {
            if let Ok(runtime) = app.state::<Mutex<HttpRuntime>>().lock() {
                runtime.live.start_revisions_from(floor);
            }
        }
        // `approval_authority` then refuses scene approvals on this run; the show itself goes on.
        Err(e) => log::error!("could not reserve live revisions; scene approvals are off for this run: {e}"),
    }
}

/// Whether this process is the host that may issue and judge scene approvals: its server is bound,
/// so desks reach this one, and its revisions are reserved, so no other run shares them. A second
/// copy that lost the port has a Live State of its own and is neither.
pub(crate) fn approval_authority(app: &AppHandle) -> (bool, bool) {
    let Some(state) = app.try_state::<Mutex<HttpRuntime>>() else { return (false, false) };
    let Ok(runtime) = state.lock() else { return (false, false) };
    runtime.approval_authority()
}

impl HttpRuntime {
    /// `handle` and `bound_port` are set only after `start_http_server` has bound, and cleared on stop.
    fn approval_authority(&self) -> (bool, bool) {
        (self.handle.is_some() && self.bound_port.is_some(), self.live.revisions_reserved())
    }
}

/// The host's own revision of one part of the live service (`scene:<id>`), None before it was shown.
pub(crate) fn current_revision(app: &AppHandle, part: &str) -> Option<u64> {
    let state = app.try_state::<Mutex<HttpRuntime>>()?;
    let runtime = state.lock().ok()?;
    runtime.live.revision(part)
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
    let leaves = tls.as_ref().map(|t| t.leaves.clone());
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

    let sink = Arc::new(TauriSink { app: app.clone() });
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
        runtime.tls_leaves = result.tls_port.and(leaves.clone());
        runtime.tls_ca_fingerprint = result.tls_port.and(ca_fingerprint);
        runtime.lan = bind_host(lan) != "127.0.0.1";
        runtime.refresh_advert();
    }

    if let Some(leaves) = leaves.filter(|_| result.tls_port.is_some()) {
        follow_address(app, leaves);
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
            runtime.tls_leaves = None;
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

/// The local CA (made once, kept in the app's data folder, its key readable only by this user), and
/// whether it was made now.
fn local_ca(dir: &std::path::Path) -> Result<(rhema_api::tls::Pem, bool), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let (cert_path, key_path) = (dir.join("rhema-ca.pem"), dir.join("rhema-ca.key"));
    match (std::fs::read_to_string(&cert_path), std::fs::read_to_string(&key_path)) {
        (Ok(cert), Ok(key)) => Ok((rhema_api::tls::Pem { cert, key }, false)),
        _ => {
            let ca = rhema_api::tls::make_ca()?;
            std::fs::write(&cert_path, &ca.cert).map_err(|e| e.to_string())?;
            write_private(&key_path, &ca.key)?;
            Ok((ca, true))
        }
    }
}

/// What this computer's https certificate is for: its network address, when it has one, and itself.
fn cert_names(lan: Option<String>) -> Vec<String> {
    lan.into_iter().chain(["127.0.0.1".to_string(), "localhost".to_string()]).collect()
}

/// The local CA and a certificate for this computer's current addresses, for the https listener (#251).
fn phone_tls(app: &AppHandle, port: u16) -> Result<rhema_api::TlsListener, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("tls");
    let (ca, new_ca) = local_ca(&dir)?;
    let server = server_cert(&dir, &ca, &cert_names(remote_lan_address()), new_ca, now_secs())?;
    Ok(rhema_api::TlsListener { port, server, ca_cert: ca.cert, leaves: rhema_api::TlsLeaves::default() })
}

/// While https runs, this computer's network address is watched: a new one gets its own certificate at
/// once, with no restart. Connections open now carry on, and whoever still dials the old address keeps
/// the certificate it knows. With no network nothing changes.
fn follow_address(app: AppHandle, leaves: rhema_api::TlsLeaves) {
    tauri::async_runtime::spawn(async move {
        let mut was = remote_lan_address();
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            let Some(state) = app.try_state::<Mutex<HttpRuntime>>() else { return };
            let running = state.lock().is_ok_and(|r| r.tls_leaves.as_ref().is_some_and(|l| l.same(&leaves)));
            if !running {
                return;
            }
            let Some(now) = remote_lan_address().filter(|ip| was.as_ref() != Some(ip)) else { continue };
            let Ok(ip) = now.parse::<std::net::IpAddr>() else { continue };
            let made = app.path().app_data_dir().map_err(|e| e.to_string()).map(|d| d.join("tls")).and_then(|dir| {
                let (ca, _) = local_ca(&dir)?;
                let server = address_cert(&dir, &ca, &cert_names(Some(now.clone())), now_secs())?;
                leaves.add(ip, &server, &ca.cert)?;
                rhema_api::tls::fingerprint(&server)
            });
            match made {
                Ok(fingerprint) => {
                    log::info!("https: this computer's address is now {now}; it has its own certificate");
                    if let Ok(mut r) = state.lock() {
                        r.tls_fingerprint = Some(fingerprint);
                    }
                    was = Some(now);
                }
                // Tried again in a moment; the old certificate is served meanwhile.
                Err(e) => log::warn!("https: no certificate for the new address yet: {e}"),
            }
        }
    });
}

/// A server certificate expires after 397 days; a new one is made after this many.
const SERVER_CERT_DAYS: u64 = 365;

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

const SERVER_CERT: &str = "rhema-server";

/// A certificate kept in `dir` as `<stem>.pem/.key/.txt`, if it is for exactly these names and not old.
fn read_cert(dir: &std::path::Path, stem: &str, names: &[String], now: u64) -> Option<rhema_api::tls::Pem> {
    let cert = std::fs::read_to_string(dir.join(format!("{stem}.pem"))).ok()?;
    let key = std::fs::read_to_string(dir.join(format!("{stem}.key"))).ok()?;
    // "<made at, unix seconds>\n<names, one per line>"
    let saved = std::fs::read_to_string(dir.join(format!("{stem}.txt"))).ok()?;
    let made = saved.lines().next()?.trim().parse::<u64>().ok().filter(|m| *m <= now && now - m < SERVER_CERT_DAYS * 86_400)?;
    (saved == format!("{made}\n{}", names.join("\n")) && rhema_api::tls::fingerprint(&rhema_api::tls::Pem { cert: cert.clone(), key: String::new() }).is_ok()).then_some(rhema_api::tls::Pem { cert, key })
}

fn write_cert(dir: &std::path::Path, stem: &str, names: &[String], now: u64, server: &rhema_api::tls::Pem) {
    let about_path = dir.join(format!("{stem}.txt"));
    // Not kept is only a new certificate at the next start, as before.
    let kept = std::fs::write(dir.join(format!("{stem}.pem")), &server.cert).and_then(|()| std::fs::write(&about_path, format!("{now}\n{}", names.join("\n"))));
    if kept.is_err() || write_private(&dir.join(format!("{stem}.key")), &server.key).is_err() {
        log::warn!("Could not keep the https certificate; a new one is made at the next start");
        let _ = std::fs::remove_file(&about_path);
    }
}

/// Where the certificate for one network address is kept, while another is in use.
fn address_stem(ip: &str) -> Option<String> {
    ip.parse::<std::net::IpAddr>().ok().filter(|ip| !ip.is_loopback()).map(|ip| format!("{SERVER_CERT}-{}", ip.to_string().replace(':', "-")))
}

/// The certificate for an address this computer moved to while running, with the one Rhema started
/// with (which the camera router also serves) left as it is. The same address again gets the same
/// certificate, so what was pinned to it still opens.
fn address_cert(dir: &std::path::Path, ca: &rhema_api::tls::Pem, names: &[String], now: u64) -> Result<rhema_api::tls::Pem, String> {
    if let Some(same) = read_cert(dir, SERVER_CERT, names, now) {
        return Ok(same);
    }
    let stem = names.first().and_then(|ip| address_stem(ip)).ok_or("not a network address")?;
    if let Some(kept) = read_cert(dir, &stem, names, now) {
        return Ok(kept);
    }
    let server = rhema_api::tls::make_server(ca, names)?;
    write_cert(dir, &stem, names, now, &server);
    Ok(server)
}

/// This computer's https certificate, kept for each address (for about a year), so a Google TV that
/// was sent its fingerprint with its feed (#198) still opens it after Rhema restarts or the address
/// comes back, and a phone that accepted the warning once is not asked again. An address never seen,
/// a new CA or an old certificate gets a new one (a TV then needs its feed sent again; so does its
/// link, which has the address in it).
fn server_cert(dir: &std::path::Path, ca: &rhema_api::tls::Pem, names: &[String], new_ca: bool, now: u64) -> Result<rhema_api::tls::Pem, String> {
    if new_ca {
        // Nothing the old CA signed stays.
        for f in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
            if f.file_name().to_string_lossy().starts_with(&format!("{SERVER_CERT}-")) {
                let _ = std::fs::remove_file(f.path());
            }
        }
    } else {
        if let Some(same) = read_cert(dir, SERVER_CERT, names, now) {
            return Ok(same);
        }
        // Another address's certificate is about to be replaced: keep it for when that address returns.
        let saved = std::fs::read_to_string(dir.join(format!("{SERVER_CERT}.txt"))).unwrap_or_default();
        if let Some(stem) = saved.lines().nth(1).and_then(address_stem) {
            for ext in ["pem", "key", "txt"] {
                let _ = std::fs::copy(dir.join(format!("{SERVER_CERT}.{ext}")), dir.join(format!("{stem}.{ext}")));
            }
        }
    }
    let kept = if new_ca { None } else { names.first().and_then(|ip| address_stem(ip)).and_then(|stem| read_cert(dir, &stem, names, now)) };
    let server = match kept {
        Some(server) => server,
        None => rhema_api::tls::make_server(ca, names)?,
    };
    write_cert(dir, SERVER_CERT, names, now, &server);
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
pub fn publish_live_state(app: AppHandle, state: State<'_, Mutex<HttpRuntime>>, json: String) -> Result<(), String> {
    // Bounded: a snapshot is a few kilobytes; anything near this is a bug, not a service.
    if json.len() > 2 * 1024 * 1024 {
        return Err("live state too large".into());
    }
    // A recording's output that became a stage screen stops recording before it draws one (doc 42).
    super::recorder::guard_pinned_output(&app, &json);
    // Automatic Timekeeper reminders run on the host's own clock (doc 35 C).
    super::reminders::observe(&app, &json);
    let live = state.lock().map_err(|e| e.to_string())?.live.clone();
    live.publish(json);
    Ok(())
}

/// One output or scene id from the main desk for a scene Take: as sent, short and not blank.
fn scene_take_of(window: &tauri::WebviewWindow, output: String, scene: String) -> Result<rhema_api::command::SceneTake, SceneTakeRefusal> {
    if window.label() != "main" {
        return Err(SceneTakeRefusal::NOT_MAIN_DESK);
    }
    let valid = |id: &str| !id.is_empty() && id.trim() == id && id.len() <= 128;
    if !valid(&output) || !valid(&scene) {
        return Err(SceneTakeRefusal::INVALID);
    }
    Ok(rhema_api::command::SceneTake { output, scene })
}

/// What an approved service pinned for a scene Take (#410): the scene and each output's look as
/// approved, with the approval they came from. The app applies these, never the saved scene as it is now.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovedSceneTake {
    pub program_id: String,
    pub revision: i64,
    pub approved_at: Option<String>,
    pub approved_by: Option<String>,
    pub scene: serde_json::Value,
    pub outputs: serde_json::Map<String, serde_json::Value>,
}

/// The approved-service rule for every scene Take, from the main desk, a joined desk or a group
/// Take (#410). No service open, or one never approved: `None`, the saved scene may be taken. An
/// approved service: only its pinned scene, and only to outputs whose look was pinned with it;
/// anything missing or incomplete is refused (`not-approved`), never filled in from what is saved now.
pub(crate) fn approved_scene_take_in(db: &rhema_content::ContentDb, service: Option<&str>, scene: &str, outputs: &[String]) -> Result<Option<ApprovedSceneTake>, SceneTakeRefusal> {
    let Some(service) = service.filter(|s| !s.is_empty()) else { return Ok(None) };
    let program = db.get_program(service).map_err(|_| SceneTakeRefusal::UNAVAILABLE)?.ok_or(SceneTakeRefusal::STALE)?.program;
    let Some(revision) = program.approved_revision else { return Ok(None) };
    let designs = db.approved_designs(service, revision).map_err(|_| SceneTakeRefusal::UNAVAILABLE)?.ok_or(SceneTakeRefusal::NOT_APPROVED)?;
    let pinned = designs.scenes.get(scene).ok_or(SceneTakeRefusal::NOT_APPROVED)?;
    let pinned_scene = pinned
        .get("scene")
        .filter(|s| s.get("id").and_then(serde_json::Value::as_str) == Some(scene) && s.get("layers").is_some_and(serde_json::Value::is_array))
        .ok_or(SceneTakeRefusal::NOT_APPROVED)?;
    let mut looks = serde_json::Map::new();
    for output in outputs {
        let look = pinned
            .get("outputs")
            .and_then(|o| o.get(output))
            .filter(|a| a.get("themes").is_some_and(serde_json::Value::is_object) && a.get("logoUrl").is_some())
            .ok_or(SceneTakeRefusal::NOT_APPROVED)?;
        looks.insert(output.clone(), look.clone());
    }
    Ok(Some(ApprovedSceneTake {
        program_id: program.id,
        revision,
        approved_at: program.approved_at,
        approved_by: program.approved_by,
        scene: pinned_scene.clone(),
        outputs: looks,
    }))
}

/// `approved_scene_take_in` against this computer's services. A service open with no database to
/// check it against is refused, not assumed unapproved.
fn approved_scene_take(app: &AppHandle, service: Option<&str>, scene: &str, outputs: &[String]) -> Result<Option<ApprovedSceneTake>, SceneTakeRefusal> {
    if service.unwrap_or("").is_empty() {
        return Ok(None);
    }
    let content = app.try_state::<super::content::ContentState>().ok_or(SceneTakeRefusal::UNAVAILABLE)?;
    let guard = content.0.lock().map_err(|_| SceneTakeRefusal::UNAVAILABLE)?;
    approved_scene_take_in(guard.as_ref().ok_or(SceneTakeRefusal::UNAVAILABLE)?, service, scene, outputs)
}

/// What the main desk reviews in Preview before Take (#410): the output's and scene's revisions,
/// the service open and its approved revision (`approved`, null when not approved).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct LocalTakeSeen {
    pub output: u64,
    pub scene: u64,
    #[serde(default)]
    pub service: Option<String>,
    #[serde(default)]
    pub approved: Option<i64>,
}

/// A main-desk Take the host accepted: the output's new revision, and the pinned scene and look
/// to apply when the service is approved.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct LocalTakeAccepted {
    pub revision: u64,
    pub approved: Option<ApprovedSceneTake>,
}

/// What the main desk reviews in Preview before Take (#410). Main window only; no server or
/// network needed. A scene an approved service cannot take is refused here already.
#[tauri::command]
pub fn live_take_revisions(window: tauri::WebviewWindow, app: AppHandle, state: State<'_, Mutex<HttpRuntime>>, output: String, scene: String) -> Result<LocalTakeSeen, SceneTakeRefusal> {
    let take = scene_take_of(&window, output, scene)?;
    let live = state.lock().map_err(|_| SceneTakeRefusal::UNAVAILABLE)?.live.clone();
    let revisions = live.scene_take_revisions(&take)?;
    let service = live.service();
    let approved = approved_scene_take(&app, service.as_deref(), &take.scene, std::slice::from_ref(&take.output))?.map(|a| a.revision);
    Ok(LocalTakeSeen { output: revisions.output, scene: revisions.scene, service, approved })
}

/// The main desk's single-output scene Take (#410), checked and accepted by this host against what
/// Preview reviewed (`live_take_revisions`): the revisions, the same service and the same approval.
/// The app then applies the pinned scene and look it returns (or the saved scene, unapproved), and
/// only a receiver's acknowledgement says it was drawn.
#[tauri::command]
pub fn local_scene_take(window: tauri::WebviewWindow, app: AppHandle, state: State<'_, Mutex<HttpRuntime>>, output: String, scene: String, seen: LocalTakeSeen) -> Result<LocalTakeAccepted, SceneTakeRefusal> {
    let take = scene_take_of(&window, output, scene)?;
    let live = state.lock().map_err(|_| SceneTakeRefusal::UNAVAILABLE)?.live.clone();
    let accepted = local_take_check(&live, &seen, |service| approved_scene_take(&app, service, &take.scene, std::slice::from_ref(&take.output)), &take);
    match &accepted {
        Ok(a) => log::info!("scene Take {} -> {} accepted at output revision {} ({})", take.scene, take.output, a.revision, if a.approved.is_some() { "approved snapshot" } else { "unapproved service" }),
        Err(why) => log::info!("scene Take {} -> {} refused: {}", take.scene, take.output, why.code),
    }
    accepted
}

/// What the main window applies for a scene Take a joined desk or group Take was accepted for
/// (#410): the approved service's pinned scene and looks for these outputs, `None` when the
/// service open is not approved, or the refusal. The same rule the server checked before accepting.
#[tauri::command]
pub fn scene_take_approval(window: tauri::WebviewWindow, app: AppHandle, state: State<'_, Mutex<HttpRuntime>>, scene: String, outputs: Vec<String>) -> Result<Option<ApprovedSceneTake>, SceneTakeRefusal> {
    if outputs.is_empty() || outputs.len() > 32 {
        return Err(SceneTakeRefusal::INVALID);
    }
    for output in &outputs {
        scene_take_of(&window, output.clone(), scene.clone())?;
    }
    let service = state.lock().map_err(|_| SceneTakeRefusal::UNAVAILABLE)?.live.service();
    approved_scene_take(&app, service.as_deref(), &scene, &outputs)
}

/// The order of a main-desk Take's checks: same service, same approval, then the revisions, which
/// move only when everything before them holds.
fn local_take_check(
    live: &rhema_api::LiveHub,
    seen: &LocalTakeSeen,
    approval: impl FnOnce(Option<&str>) -> Result<Option<ApprovedSceneTake>, SceneTakeRefusal>,
    take: &rhema_api::command::SceneTake,
) -> Result<LocalTakeAccepted, SceneTakeRefusal> {
    let service = live.service();
    if seen.service != service {
        return Err(SceneTakeRefusal::STALE);
    }
    let approved = approval(service.as_deref())?;
    if approved.as_ref().map(|a| a.revision) != seen.approved {
        return Err(SceneTakeRefusal::STALE);
    }
    let revision = live.accept_scene_take(take, SceneTakeRevisions { output: seen.output, scene: seen.scene })?;
    Ok(LocalTakeAccepted { revision, approved })
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

    fn pinned_manifest() -> rhema_content::ApprovedDesignSnapshot {
        let look = serde_json::json!({ "themes": { "t1": { "id": "t1", "name": "Approved gold" } }, "logoUrl": null });
        rhema_content::ApprovedDesignSnapshot {
            version: 1,
            scenes: serde_json::json!({
                "sermon": { "scene": { "id": "sermon", "name": "Sermon", "layers": [{ "id": "approved" }] }, "outputs": { "main": look, "lobby": { "logoUrl": null } } },
                "broken": { "outputs": { "main": look } },
            }),
            looks: serde_json::json!({}),
            media_ids: vec![],
            moments: serde_json::Value::Null,
        }
    }

    /// #410: one rule for every scene Take in an approved service. Only the pinned scene, only to
    /// outputs pinned with it, always as pinned; a gap in the approval refuses, never falls back.
    #[test]
    fn an_approved_service_takes_only_its_pinned_scene_and_look() {
        let db = rhema_content::ContentDb::open_in_memory().unwrap();
        let take = |service: &str, scene: &str, outputs: &[&str]| {
            approved_scene_take_in(&db, Some(service), scene, &outputs.iter().map(ToString::to_string).collect::<Vec<_>>())
        };
        let open = db.create_program("Rehearsal", None).unwrap();
        assert_eq!(take(&open.id, "anything", &["main"]), Ok(None), "an unapproved service takes the saved scene");
        assert_eq!(approved_scene_take_in(&db, None, "sermon", &["main".into()]), Ok(None), "no service open");

        let p = db.create_program("9 AM", None).unwrap();
        let p = db.approve_program_with_designs(&p.id, p.revision, &pinned_manifest()).unwrap();
        // The service is edited after approval: the approved revision still decides what is taken.
        db.update_program(&p.id, p.revision, "9 AM (edited)", None).unwrap();
        let approved = take(&p.id, "sermon", &["main"]).unwrap().expect("pinned");
        assert_eq!(approved.revision, p.approved_revision.unwrap());
        assert_eq!(approved.scene["layers"][0]["id"], "approved", "the pinned scene, not the saved one");
        assert_eq!(approved.outputs["main"]["themes"]["t1"]["name"], "Approved gold", "the output's pinned look");
        assert_eq!(approved.outputs.len(), 1);

        for (scene, outputs, why) in [
            ("choir", &["main"][..], "a scene not pinned"),
            ("sermon", &["overflow"][..], "an output not captured at approval"),
            ("sermon", &["main", "overflow"][..], "a group with one output not captured"),
            ("sermon", &["lobby"][..], "an incomplete look"),
            ("broken", &["main"][..], "a pin without its scene"),
        ] {
            assert_eq!(take(&p.id, scene, outputs), Err(SceneTakeRefusal::NOT_APPROVED), "{why}");
        }
        assert_eq!(take("gone", "sermon", &["main"]), Err(SceneTakeRefusal::STALE), "a service this host does not have");

        let old = db.create_program("Approved before snapshots", None).unwrap();
        db.approve_program(&old.id, old.revision).unwrap();
        assert_eq!(take(&old.id, "sermon", &["main"]), Err(SceneTakeRefusal::NOT_APPROVED), "no manifest: fail closed");
    }

    /// #410: the main desk's Take is accepted only for the service and approval Preview reviewed,
    /// and the output's revision moves only when it is.
    #[test]
    fn a_main_desk_take_checks_service_and_approval_before_moving_the_output() {
        type Case = (LocalTakeSeen, Result<Option<ApprovedSceneTake>, SceneTakeRefusal>, &'static str);
        let live = rhema_api::new_live_hub();
        live.publish(r#"{"v":1,"service":{"id":"s1"},"outputs":[{"id":"main","name":"Main"},{"id":"overflow","name":"Overflow"}],"scenes":[{"id":"sermon","name":"Sermon","layers":[]}]}"#.into());
        let take = rhema_api::command::SceneTake { output: "main".into(), scene: "sermon".into() };
        let r = live.scene_take_revisions(&take).unwrap();
        let seen = |service: Option<&str>, approved: Option<i64>| LocalTakeSeen { output: r.output, scene: r.scene, service: service.map(String::from), approved };
        let pinned = |revision: i64| ApprovedSceneTake { program_id: "s1".into(), revision, approved_at: None, approved_by: None, scene: serde_json::json!({ "id": "sermon" }), outputs: serde_json::Map::new() };
        let overflow = live.revision("output:overflow");

        let refused: [Case; 5] = [
            (seen(Some("s2"), None), Ok(None), "another service was reviewed"),
            (seen(None, None), Ok(None), "no service was reviewed"),
            (seen(Some("s1"), None), Ok(Some(pinned(5))), "approved since Preview"),
            (seen(Some("s1"), Some(4)), Ok(Some(pinned(5))), "approved again since Preview"),
            (seen(Some("s1"), Some(5)), Err(SceneTakeRefusal::NOT_APPROVED), "not pinned"),
        ];
        for (seen, approval, why) in refused {
            assert!(local_take_check(&live, &seen, |_| approval.clone(), &take).is_err(), "{why}");
            assert_eq!(live.revision("output:main"), Some(r.output), "{why}: nothing moved");
        }

        let ok = local_take_check(&live, &seen(Some("s1"), Some(5)), |s| { assert_eq!(s, Some("s1")); Ok(Some(pinned(5))) }, &take).unwrap();
        assert_eq!((ok.revision, ok.approved.map(|a| a.revision)), (r.output + 1, Some(5)));
        assert_eq!(live.revision("output:overflow"), overflow, "only the named output");

        // Unapproved service: the saved scene, on what was reviewed.
        let r = live.scene_take_revisions(&take).unwrap();
        let ok = local_take_check(&live, &LocalTakeSeen { output: r.output, scene: r.scene, service: Some("s1".into()), approved: None }, |_| Ok(None), &take).unwrap();
        assert_eq!((ok.revision, ok.approved), (r.output + 1, None));
    }

    #[test]
    fn a_copy_that_never_bound_the_port_is_not_the_approval_authority() {
        let runtime = HttpRuntime::new();
        assert_eq!(runtime.approval_authority(), (false, false));
        runtime.live.start_revisions_from(1);
        assert_eq!(runtime.approval_authority(), (false, true), "revisions alone are not authority");
    }

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
            record: false,
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
            record: false,
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
            record: false,
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
        assert_eq!(fp(&back), fp(&first), "the address came back: what was pinned to it opens again");
        // Moved while running: its own certificate, kept apart from the one Rhema started with.
        let other = vec!["10.0.0.7".to_string(), "127.0.0.1".into(), "localhost".into()];
        let running = address_cert(&dir, &ca, &other, t0 + 3 * day).unwrap();
        assert_eq!(fp(&address_cert(&dir, &ca, &other, t0 + 3 * day).unwrap()), fp(&running));
        assert_eq!(fp(&address_cert(&dir, &ca, &names, t0 + 3 * day).unwrap()), fp(&back), "the address it started with");
        assert_eq!(fp(&server_cert(&dir, &ca, &names, false, t0 + 3 * day).unwrap()), fp(&back));
        assert_eq!(fp(&server_cert(&dir, &ca, &other, false, t0 + 3 * day).unwrap()), fp(&running), "restarted there: the same one");
        assert_eq!(fp(&server_cert(&dir, &ca, &names, false, t0 + 3 * day).unwrap()), fp(&back));
        assert_ne!(fp(&server_cert(&dir, &ca, &names, true, t0 + 4 * day).unwrap()), fp(&back));
        let latest = server_cert(&dir, &ca, &names, false, t0 + 5 * day).unwrap();
        assert_ne!(fp(&server_cert(&dir, &ca, &names, false, t0 + 5 * day + SERVER_CERT_DAYS * day).unwrap()), fp(&latest));
        // A clock set back before it was made: a new one, never one "from the future".
        let now = server_cert(&dir, &ca, &names, false, t0 + 900 * day).unwrap();
        assert_ne!(fp(&server_cert(&dir, &ca, &names, false, t0).unwrap()), fp(&now));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
