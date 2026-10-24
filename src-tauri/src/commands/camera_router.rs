//! The camera router (OP-009, #209): MediaMTX, shipped inside Rhema, takes each phone or IP camera
//! once and gives it to everything that wants it: Rhema's screens and TVs (WebRTC/WHEP) and OBS
//! (RTSP). Everything stays on the church network; nothing here talks to the internet.
//!
//! Rhema writes the router's settings into its data folder each time it starts it, runs it, puts
//! its messages in Rhema's log, starts it again if it stops by itself (waiting longer each time),
//! and stops it when Rhema closes. Each camera publishes as its own user (`cam-<name>`, with its
//! link's secret), to its own name only; watching a camera's own name is open on the church network
//! for now, the same as a TV or OBS reading any local camera. The router's control API answers only
//! Rhema: a user and password made afresh each run, kept in memory and handed to the router in its
//! environment (the settings file holds a throwaway value in its place), never written to a file or
//! the log.
//!
//! An OBS companion (a computer that runs OBS only, #209) reads each camera from its companion name
//! (`companion/<name>`, which the router fills from the camera on this computer while someone reads
//! it) over SRT, encrypted with a passphrase made afresh each time the router starts (in its
//! environment, like the API password), signed in as its own user (`read-<8 characters of its key>`).
//! Nobody else may read the companion names, so unpairing or pausing a companion (its user goes and
//! its OBS is disconnected) really shuts it out.

use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, State};

use super::remote::HttpRuntime;

/// The router's ports: fixed, so OBS and the TVs keep the same addresses from week to week.
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ports {
    /// WebRTC (WHIP to publish, WHEP to watch), plain http.
    pub webrtc: u16,
    /// WebRTC media (ICE over UDP).
    pub webrtc_udp: u16,
    /// RTSP for OBS (Media Source).
    pub rtsp: u16,
    /// RTSP over TLS: the Rhema Camera app sends here (#209), while Rhema has its https certificate.
    pub rtsps: u16,
    /// RTMP and SRT for camera apps (Moblin, StreamCaster) and encoders.
    pub rtmp: u16,
    pub srt: u16,
    /// The router's own status (which cameras are sending, who watches), this computer only.
    pub api: u16,
}

pub const PORTS: Ports = Ports { webrtc: 8889, webrtc_udp: 8189, rtsp: 8554, rtsps: 8322, rtmp: 1935, srt: 8890, api: 9997 };

/// Rhema's https certificate and key (made for the secure phone pages, kept in `<data folder>/tls`,
/// #251/#336). The router serves RTSPS with the same certificate, so the Rhema Camera app pins the
/// fingerprint Rhema already shows its TVs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RtspsCert {
    pub cert: PathBuf,
    pub key: PathBuf,
}

/// The certificate files in Rhema's tls folder, once Rhema has made them (secure phone pages turned
/// on at least once); None before, and the router then has no RTSPS.
pub fn rtsps_cert(tls_dir: &Path) -> Option<RtspsCert> {
    let (cert, key) = (tls_dir.join("rhema-server.pem"), tls_dir.join("rhema-server.key"));
    (cert.is_file() && key.is_file()).then_some(RtspsCert { cert, key })
}

/// SHA-256 of the certificate the router serves for RTSPS (what the Rhema Camera link carries).
pub fn rtsps_fingerprint(tls: &RtspsCert) -> Option<String> {
    let cert = std::fs::read_to_string(&tls.cert).ok()?;
    rhema_api::tls::fingerprint(&rhema_api::tls::Pem { cert, key: String::new() }).ok()
}

/// The router's settings with RTSPS added after the RTSP lines (#209): with Rhema's certificate,
/// RTSP is also offered over TLS for the Rhema Camera app, while plain RTSP stays for OBS as
/// before; without it (or with a path that cannot be written safely), RTSP only.
pub fn with_rtsps(yaml: String, ports: &Ports, tls: Option<&RtspsCert>) -> String {
    let lines = match tls.and_then(|t| yaml_path(&t.cert).zip(yaml_path(&t.key))) {
        Some((cert, key)) => format!("rtspEncryption: \"optional\"\nrtspsAddress: :{}\nrtspServerKey: {key}\nrtspServerCert: {cert}\n", ports.rtsps),
        None => "rtspEncryption: \"no\"\n".into(),
    };
    let anchor = format!("rtspAddress: :{}\n", ports.rtsp);
    match yaml.find(&anchor) {
        Some(at) => format!("{}{lines}{}", &yaml[..at + anchor.len()], &yaml[at + anchor.len()..]),
        None => yaml,
    }
}

/// A file path as a single-quoted YAML string; None for one that cannot be written safely.
fn yaml_path(p: &Path) -> Option<String> {
    let s = p.to_str()?;
    (!s.is_empty() && !s.contains(['\n', '\r'])).then(|| format!("'{}'", s.replace('\'', "''")))
}

/// The router's control-API user; its password is made afresh each time the router starts. It is
/// the first user in the settings, so the router takes its password from this variable.
const API_USER: &str = "rhema-api";
const API_PASS_ENV: &str = "MTX_AUTHINTERNALUSERS_0_PASS";
/// The companions' SRT passphrase, for every name (no SRT reader without it).
const SRT_READ_PASS_ENV: &str = "MTX_PATHDEFAULTS_SRTREADPASSPHRASE";

/// The camera names `any` may read (a camera's own name, never `companion/…`).
const CAMERA_PATHS: &str = "~^[a-z0-9][a-z0-9_-]*$";

/// A secret Rhema made: letters and digits only (it goes into the router's settings and into
/// camera-app addresses), long enough not to be guessed.
fn valid_secret(p: &str) -> bool {
    (16..=128).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// A new secret for the router's control API (64 hex characters from the system's random source).
fn new_api_password() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

/// A new passphrase for the companions' SRT link (32 hex characters; SRT takes 10 to 79).
fn new_srt_passphrase() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// The router's settings. Each camera (name, secret) may publish to its own name only, as
/// `cam-<name>`; watching a camera's own name is open; each OBS companion (user, secret) may read the
/// companion names only (`companion/<name>`, filled from the camera here over RTSP while it is read,
/// SRT with the passphrase in the router's environment); the control API answers only `rhema-api`, from this computer,
/// and no browser page (no allowed CORS origin). Its real password goes to the router in
/// `API_PASS_ENV`; `api_placeholder` (random, thrown away) stands in the file so it is never empty. HLS, recording
/// playback, metrics, pprof and MoQ are off: nothing uses them, and each would open another port.
/// RTSP uses TCP only, so it opens no UDP ports beside the remote-control ones (OSC listens on UDP
/// 8000 by default).
pub fn config_yaml(ports: &Ports, lan_ip: Option<&str>, cameras: &[(String, String)], readers: &[(String, String)], api_placeholder: &str) -> Result<String, String> {
    if !valid_secret(api_placeholder) {
        return Err("The router's API password is not one Rhema Studio made".into());
    }
    let hosts = lan_ip.filter(|ip| ip.parse::<std::net::Ipv4Addr>().is_ok()).map(|ip| format!("\"{ip}\"")).unwrap_or_default();
    let prefix = rhema_api::PUBLISH_PREFIX;
    let publishers: String = cameras
        .iter()
        .filter(|(name, token)| rhema_api::valid_camera_name(name) && valid_secret(token))
        .map(|(name, token)| format!("  - user: \"{prefix}{name}\"\n    pass: \"{token}\"\n    ips: []\n    permissions:\n      - action: publish\n        path: \"{name}\"\n"))
        .collect();
    let companion = rhema_api::COMPANION_PATH;
    let reading: String = readers
        .iter()
        .filter(|(user, pass)| valid_reader(user) && valid_secret(pass))
        .map(|(user, pass)| format!("  - user: \"{user}\"\n    pass: \"{pass}\"\n    ips: []\n    permissions:\n      - action: read\n        path: \"~^{companion}\"\n"))
        .collect();
    Ok(format!(
        r#"# Written by Rhema each time it starts the camera router; changes here are replaced.
logLevel: info
logDestinations: [stdout]
readTimeout: 10s
writeTimeout: 10s
authMethod: internal
authInternalUsers:
  - user: {API_USER}
    pass: "{api_placeholder}"
    ips: ["127.0.0.1", "::1"]
    permissions:
      - action: api
  - user: any
    pass:
    ips: []
    permissions:
      - action: read
        path: "{CAMERA_PATHS}"
{publishers}{reading}api: true
apiAddress: 127.0.0.1:{api}
apiAllowOrigins: []
metrics: false
pprof: false
playback: false
rtsp: true
rtspTransports: [tcp]
rtspAddress: :{rtsp}
rtmp: true
rtmpAddress: :{rtmp}
hls: false
webrtc: true
webrtcAddress: :{webrtc}
webrtcAllowOrigins: ["*"]
webrtcLocalUDPAddress: :{udp}
webrtcIPsFromInterfaces: true
webrtcAdditionalHosts: [{hosts}]
webrtcICEServers2: []
srt: true
srtAddress: :{srt}
moq: false
pathDefaults:
  source: publisher
paths:
  "~^{companion}([a-z0-9][a-z0-9_-]*)$":
    source: rtsp://127.0.0.1:{rtsp}/$G1
    sourceOnDemand: true
  all_others:
"#,
        api = ports.api,
        rtsp = ports.rtsp,
        rtmp = ports.rtmp,
        webrtc = ports.webrtc,
        udp = ports.webrtc_udp,
        srt = ports.srt,
    ))
}

/// A companion's router user as Rhema makes it: `read-` and hex characters.
fn valid_reader(user: &str) -> bool {
    user.strip_prefix(rhema_api::READ_PREFIX).is_some_and(|rest| (8..=64).contains(&rest.len()) && rest.bytes().all(|b| b.is_ascii_hexdigit()))
}

const EXE: &str = if cfg!(windows) { "mediamtx.exe" } else { "mediamtx" };

/// Where the router is: shipped beside Rhema's own program (a release build), else a developer's
/// copy in ~/.local/mediamtx; None when neither is there ("Camera router not installed").
pub fn find_binary(exe_dir: Option<&Path>, home: Option<&Path>) -> Option<PathBuf> {
    let beside = exe_dir.map(|d| d.join(EXE));
    let dev = home.map(|h| h.join(".local").join("mediamtx").join(EXE));
    [beside, dev].into_iter().flatten().find(|p| p.is_file())
}

fn locate() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf));
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
    find_binary(exe_dir.as_deref(), home.as_deref())
}

/// How long to wait before starting the router again after it stopped by itself the n-th time
/// in a row: 1, 2, 4, 8, 16, then 30 seconds.
pub fn backoff(failures: u32) -> Duration {
    Duration::from_secs(1u64 << failures.min(5)).min(Duration::from_secs(30))
}

#[derive(Default)]
struct RouterState {
    /// The operator wants it on (Rhema keeps it running while this is set).
    want: bool,
    /// Each start gets a new number; an older supervisor seeing a newer one stops.
    generation: u64,
    child: Option<Child>,
    /// This run's control-API password (memory only).
    api_password: String,
    /// This run's companions' SRT passphrase (memory only).
    srt_passphrase: String,
    /// Its settings file and the LAN address it was started with, to rewrite when cameras change.
    config: Option<PathBuf>,
    lan: Option<String>,
    /// Rhema's tls folder, where the RTSPS certificate is looked for each time the settings are written.
    tls_dir: Option<PathBuf>,
    /// The certificate in the settings written last (None: no RTSPS).
    tls: Option<RtspsCert>,
    started_at: Option<Instant>,
    restarts: u32,
    last_error: Option<String>,
}

/// The running router, managed by Tauri.
#[derive(Default, Clone)]
pub struct CameraRouter(Arc<Mutex<RouterState>>);

impl CameraRouter {
    fn lock(&self) -> std::sync::MutexGuard<'_, RouterState> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Stop it now (the operator turned it off, or Rhema is closing).
    pub fn stop(&self) {
        let mut s = self.lock();
        s.want = false;
        s.generation += 1;
        s.started_at = None;
        if let Some(mut child) = s.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn spawn(binary: &Path, config: &Path, router: &CameraRouter, generation: u64, api_password: &str, srt_passphrase: &str) -> Result<Child, String> {
    let mut cmd = Command::new(binary);
    cmd.arg(config).env(API_PASS_ENV, api_password).env(SRT_READ_PASS_ENV, srt_passphrase).current_dir(config.parent().unwrap_or(Path::new("."))).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // No console window beside Rhema.
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd.spawn().map_err(|e| format!("The camera router could not start: {e}"))?;
    // Its messages go to Rhema's log; the last error is kept for the Cameras panel.
    for out in [child.stdout.take().map(|o| Box::new(o) as Box<dyn std::io::Read + Send>), child.stderr.take().map(|e| Box::new(e) as Box<dyn std::io::Read + Send>)].into_iter().flatten() {
        let router = router.clone();
        std::thread::spawn(move || {
            for line in std::io::BufReader::new(out).lines().map_while(Result::ok) {
                log::info!(target: "camera-router", "{line}");
                if line.contains(" ERR ") || line.starts_with("ERR") {
                    let mut s = router.lock();
                    if s.generation == generation {
                        s.last_error = Some(plain_error(&line));
                    }
                }
            }
        });
    }
    Ok(child)
}

/// The router's error line, in words an operator can act on.
fn plain_error(line: &str) -> String {
    let msg = line.split(" ERR ").nth(1).unwrap_or(line).trim().trim_start_matches("ERR:").trim();
    if msg.contains("address already in use") {
        let port = msg.split(':').filter_map(|p| p.split_whitespace().next()?.parse::<u16>().ok()).next();
        return match port {
            Some(p) => format!("Port {p} is already in use; another camera router (or MediaMTX) may be running on this computer. Close it, then turn the router on again."),
            None => "A port the camera router needs is already in use; another camera router may be running on this computer.".into(),
        };
    }
    msg.chars().take(240).collect()
}

/// Keep the router running while it is wanted: if it stops by itself, start it again after a
/// growing pause. A run of a minute or more counts as healthy and resets the pause.
fn supervise(router: CameraRouter, binary: PathBuf, config: PathBuf, generation: u64) {
    tauri::async_runtime::spawn(async move {
        let mut failures = 0u32;
        loop {
            let alive = {
                let mut s = router.lock();
                if !s.want || s.generation != generation {
                    return;
                }
                match s.child.as_mut().map(Child::try_wait) {
                    Some(Ok(None)) => true,
                    Some(Ok(Some(status))) => {
                        log::warn!("camera router stopped by itself ({status})");
                        if s.started_at.is_some_and(|t| t.elapsed() >= Duration::from_secs(60)) {
                            failures = 0;
                        }
                        s.child = None;
                        s.started_at = None;
                        false
                    }
                    Some(Err(_)) | None => false,
                }
            };
            if alive {
                tokio::time::sleep(Duration::from_millis(500)).await;
                continue;
            }
            tokio::time::sleep(backoff(failures)).await;
            failures = failures.saturating_add(1);
            let mut s = router.lock();
            if !s.want || s.generation != generation {
                return;
            }
            let (api_password, srt_passphrase) = (s.api_password.clone(), s.srt_passphrase.clone());
            match spawn(&binary, &config, &router, generation, &api_password, &srt_passphrase) {
                Ok(child) => {
                    s.child = Some(child);
                    s.started_at = Some(Instant::now());
                    s.restarts += 1;
                    log::info!("camera router started again (restart {})", s.restarts);
                }
                Err(e) => s.last_error = Some(e),
            }
        }
    });
}

fn write_private(path: &Path, text: &str) -> Result<(), String> {
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

/// Replace the settings file in one step, so the router (which reloads it when it changes) never
/// reads half of it.
fn write_config(path: &Path, text: &str) -> Result<(), String> {
    let tmp = path.with_extension("yml.new");
    write_private(&tmp, text)?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Start the camera router for the cameras added now (it follows later changes by itself; see
/// `cameras_set`). Starting it while it runs leaves it as it is.
#[tauri::command]
pub fn camera_router_start(app: AppHandle, router: State<'_, CameraRouter>, http: State<'_, Mutex<HttpRuntime>>, keys: State<'_, super::remote::RemoteKeys>) -> Result<(), String> {
    let binary = locate().ok_or("The camera router is not installed with this copy of Rhema Studio.")?;
    if router.lock().want {
        return Ok(());
    }
    let hub = http.lock().map_err(|e| e.to_string())?.cameras();
    hub.sync_readers(&companions(&keys.keys));
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("camera-router");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let config = dir.join("mediamtx.yml");
    let lan = super::remote::remote_lan_address();
    let (api_password, srt_passphrase) = (new_api_password(), new_srt_passphrase());
    let tls_dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("tls");
    let tls = rtsps_cert(&tls_dir);
    write_config(&config, &with_rtsps(config_yaml(&PORTS, lan.as_deref(), &hub.list(), &hub.reader_list(), &new_api_password())?, &PORTS, tls.as_ref()))?;
    let generation = {
        let mut s = router.lock();
        s.generation += 1;
        s.want = true;
        s.config = Some(config.clone());
        s.lan = lan;
        s.tls_dir = Some(tls_dir);
        s.tls = tls;
        s.last_error = None;
        s.restarts = 0;
        let child = spawn(&binary, &config, &router, s.generation, &api_password, &srt_passphrase)?;
        s.api_password = api_password;
        s.srt_passphrase.clone_from(&srt_passphrase);
        s.child = Some(child);
        s.started_at = Some(Instant::now());
        s.generation
    };
    hub.set_router(Some(rhema_api::RouterTarget { base: format!("http://127.0.0.1:{}", PORTS.webrtc), srt_port: PORTS.srt, srt_passphrase }));
    log::info!("camera router started ({}), WebRTC on port {}, RTSP on {}, SRT on {}{}", binary.display(), PORTS.webrtc, PORTS.rtsp, PORTS.srt, if router.lock().tls.is_some() { format!(", RTSPS on {}", PORTS.rtsps) } else { String::new() });
    supervise(router.inner().clone(), binary, config, generation);
    look_regularly(router.inner().clone(), hub, generation);
    Ok(())
}

/// The paired OBS companions that may read now (key hash, name): not paused.
fn companions(keys: &rhema_api::KeySet) -> Vec<(String, String)> {
    let k = keys.read().unwrap_or_else(PoisonError::into_inner);
    k.entries.iter().filter(|e| e.role == rhema_api::Role::ObsCompanion && !e.paused).map(|e| (e.hash.clone(), e.name.clone())).collect()
}

/// The paired desks changed (Settings → Remote control, Operators): each OBS companion keeps its
/// router user; one unpaired, paused or given another role loses it and its OBS is disconnected.
pub fn desks_changed(app: &AppHandle) {
    let (Some(router), Some(http), Some(keys)) = (app.try_state::<CameraRouter>(), app.try_state::<Mutex<HttpRuntime>>(), app.try_state::<super::remote::RemoteKeys>()) else { return };
    let Ok(hub) = http.lock().map(|h| h.cameras()) else { return };
    let gone = hub.sync_readers(&companions(&keys.keys));
    let s = router.lock();
    let Some(config) = s.config.clone().filter(|_| s.want) else { return };
    if gone.is_empty() && !readers_differ(&config, &hub.reader_list()) {
        return;
    }
    // Keep the RTSPS lines (the Rhema Camera app) when only the companions' sign-ins change.
    match config_yaml(&PORTS, s.lan.as_deref(), &hub.list(), &hub.reader_list(), &new_api_password()).and_then(|y| write_config(&config, &with_rtsps(y, &PORTS, s.tls.as_ref()))) {
        Ok(()) => log::info!("camera router: OBS companions now {}", hub.reader_list().len()),
        Err(e) => log::warn!("camera router: the companions' sign-ins were not updated: {e}"),
    }
    if gone.is_empty() {
        return;
    }
    let api_password = s.api_password.clone();
    tauri::async_runtime::spawn(async move {
        // As for a camera: the router takes in its new settings first, so the companion cannot sign in again.
        tokio::time::sleep(Duration::from_millis(1500)).await;
        disconnect_readers(&gone, &api_password).await;
    });
}

/// Whether the settings file lacks one of these companions (a new one paired since it was written).
fn readers_differ(config: &Path, readers: &[(String, String)]) -> bool {
    let text = std::fs::read_to_string(config).unwrap_or_default();
    readers.iter().any(|(user, pass)| !text.contains(&format!("user: \"{user}\"\n    pass: \"{pass}\"")))
}

/// Disconnect these companions' OBS (their SRT connections), through the router's control API.
async fn disconnect_readers(users: &[String], api_password: &str) {
    let Ok(client) = reqwest::Client::builder().timeout(Duration::from_secs(3)).build() else { return };
    let base = format!("http://127.0.0.1:{}/v3", PORTS.api);
    let Ok(r) = client.get(format!("{base}/srt/conns/list")).basic_auth(API_USER, Some(api_password)).send().await else { return };
    let Ok(list) = r.json::<serde_json::Value>().await else { return };
    for id in conns_of(&list, users) {
        match client.post(format!("{base}/srt/conns/kick/{id}")).basic_auth(API_USER, Some(api_password)).send().await {
            Ok(r) if r.status().is_success() => log::info!("camera router: an OBS companion that was unpaired or paused was disconnected"),
            Ok(r) => log::warn!("camera router: an unpaired companion was not disconnected ({})", r.status()),
            Err(e) => log::warn!("camera router: an unpaired companion was not disconnected: {e}"),
        }
    }
}

/// The SRT connections (ids) signed in as one of these users.
fn conns_of(list: &serde_json::Value, users: &[String]) -> Vec<String> {
    list.get("items").and_then(|v| v.as_array()).map_or_else(Vec::new, |items| {
        items.iter().filter(|c| c.get("user").and_then(|u| u.as_str()).is_some_and(|u| users.iter().any(|x| x == u))).filter_map(|c| c.get("id")?.as_str().map(str::to_string)).collect()
    })
}

/// While the router runs, ask it every two seconds which cameras send and who reads them, for
/// Production → Cameras and the OBS companions (camera_router_status reads the answer).
fn look_regularly(router: CameraRouter, hub: rhema_api::SharedCameras, generation: u64) {
    tauri::async_runtime::spawn(async move {
        let Ok(client) = reqwest::Client::builder().timeout(Duration::from_millis(1500)).build() else { return };
        let mut before: std::collections::HashMap<String, (u64, Instant)> = std::collections::HashMap::new();
        loop {
            let (password, running) = {
                let mut s = router.lock();
                if !s.want || s.generation != generation {
                    hub.set_watch(Vec::new());
                    return;
                }
                (s.api_password.clone(), s.child.as_mut().is_some_and(|c| matches!(c.try_wait(), Ok(None))))
            };
            if running {
                let base = format!("http://127.0.0.1:{}/v3", PORTS.api);
                let get = |what: &'static str| {
                    let req = client.get(format!("{base}/{what}")).basic_auth(API_USER, Some(&password));
                    async move { match req.send().await { Ok(r) => r.json::<serde_json::Value>().await.unwrap_or_default(), Err(_) => serde_json::Value::Null } }
                };
                let (paths, srt, rtsp, webrtc) = tokio::join!(get("paths/list"), get("srt/conns/list"), get("rtsp/sessions/list"), get("webrtc/sessions/list"));
                if paths.is_object() {
                    let mut sessions = parse_sessions("srt", &srt);
                    sessions.extend(parse_sessions("rtsp", &rtsp));
                    sessions.extend(parse_sessions("webrtc", &webrtc));
                    let local = local_addresses(super::remote::remote_lan_address().as_deref());
                    let now = Instant::now();
                    let watch = build_watch(&paths, &sessions, &Names { reader: &|u| hub.reader_name(u), desk: &|ip| hub.desk_at(ip) }, &local, &mut before, now);
                    hub.set_watch(watch);
                }
            } else {
                hub.set_watch(Vec::new());
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });
}

#[tauri::command]
pub fn camera_router_stop(router: State<'_, CameraRouter>, http: State<'_, Mutex<HttpRuntime>>) -> Result<(), String> {
    router.stop();
    http.lock().map_err(|e| e.to_string())?.cameras().set_router(None);
    log::info!("camera router stopped");
    Ok(())
}

/// One camera as the router sees it, with who reads it and what each OBS companion said.
pub type RouterPath = rhema_api::CameraWatch;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouterStatus {
    pub installed: bool,
    pub running: bool,
    /// Turned on (it may be between restarts).
    pub wanted: bool,
    pub lan_address: Option<String>,
    pub ports: Ports,
    /// SHA-256 of the certificate the router serves for RTSPS, while it does (the Rhema Camera link's `fp`).
    pub rtsps_fingerprint: Option<String>,
    pub restarts: u32,
    pub error: Option<String>,
    pub paths: Vec<RouterPath>,
}

/// The router's `/v3/paths/list`, read leniently (fields differ a little between versions).
pub fn parse_paths(json: &serde_json::Value) -> Vec<RouterPath> {
    json.get("items").and_then(|v| v.as_array()).map_or_else(Vec::new, |items| {
        items
            .iter()
            .filter_map(|p| {
                let name = p.get("name")?.as_str()?.to_string();
                let source = p.get("source").and_then(|s| s.get("type")).and_then(|t| t.as_str()).map(str::to_string);
                let tracks = p.get("tracks").and_then(|t| t.as_array()).map_or_else(Vec::new, |t| t.iter().filter_map(|x| x.as_str().map(str::to_string)).collect());
                // The picture's size, from the first video track that says (v1.21's tracks2).
                let size = p.get("tracks2").and_then(|t| t.as_array()).and_then(|t| {
                    t.iter().find_map(|x| {
                        let props = x.get("codecProps")?;
                        let dim = |k: &str| props.get(k).and_then(serde_json::Value::as_u64).and_then(|n| u32::try_from(n).ok()).filter(|n| *n > 0);
                        Some((dim("width")?, dim("height")?))
                    })
                });
                let live = p.get("ready").or_else(|| p.get("online")).and_then(serde_json::Value::as_bool).unwrap_or(false);
                Some(RouterPath { live, readers: p.get("readers").and_then(|r| r.as_array()).map_or(0, Vec::len), name, source, tracks, width: size.map(|s| s.0), height: size.map(|s| s.1), ..RouterPath::default() })
            })
            .collect()
    })
}

/// One reader or sender connected to the router (from its srt, rtsp and webrtc lists).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Session {
    /// "srt", "rtsp" or "webrtc".
    pub kind: &'static str,
    pub path: String,
    /// Reading (true) or sending.
    pub reading: bool,
    pub user: String,
    pub ip: Option<std::net::IpAddr>,
}

/// The router's list of one kind of connection, read leniently.
pub fn parse_sessions(kind: &'static str, json: &serde_json::Value) -> Vec<Session> {
    json.get("items").and_then(|v| v.as_array()).map_or_else(Vec::new, |items| {
        items
            .iter()
            .filter_map(|c| {
                let text = |k: &str| c.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
                let path = text("path");
                (!path.is_empty()).then(|| Session { kind, reading: text("state") == "read", user: text("user"), ip: ip_of(&text("remoteAddr")), path })
            })
            .collect()
    })
}

/// The address in "192.168.1.30:51234" or "[::1]:5000".
fn ip_of(remote: &str) -> Option<std::net::IpAddr> {
    remote.parse::<std::net::SocketAddr>().map(|a| a.ip()).ok().or_else(|| remote.parse().ok()).map(|ip: std::net::IpAddr| match ip {
        std::net::IpAddr::V6(v6) => v6.to_ipv4_mapped().map_or(ip, std::net::IpAddr::V4),
        v4 => v4,
    })
}

/// This computer's own addresses: what it reads itself does not cross the network.
pub fn local_addresses(lan: Option<&str>) -> Vec<std::net::IpAddr> {
    let mut v: Vec<std::net::IpAddr> = vec![std::net::Ipv4Addr::LOCALHOST.into(), std::net::Ipv6Addr::LOCALHOST.into()];
    v.extend(lan.and_then(|l| l.parse::<std::net::IpAddr>().ok()));
    v
}

/// How Rhema names who reads: a companion by its router user, a desk by the address it follows
/// the host from.
pub struct Names<'a> {
    pub reader: &'a dyn Fn(&str) -> Option<String>,
    pub desk: &'a dyn Fn(std::net::IpAddr) -> Option<String>,
}

/// The cameras as Production → Cameras shows them: each camera's own name (never a companion name)
/// with who reads it, over the network or on this computer, and what it sends (from the bytes it
/// sent since the last look, kept in `before`). One local RTSP reader of a camera is the router
/// filling its companion name, not a person: it is left out while that name is in use.
pub fn build_watch(paths: &serde_json::Value, sessions: &[Session], names: &Names<'_>, local: &[std::net::IpAddr], before: &mut std::collections::HashMap<String, (u64, Instant)>, now: Instant) -> Vec<RouterPath> {
    let companion = rhema_api::COMPANION_PATH;
    let all = parse_paths(paths);
    let inbound = |name: &str| -> Option<u64> {
        let p = paths.get("items")?.as_array()?.iter().find(|p| p.get("name").and_then(|n| n.as_str()) == Some(name))?;
        p.get("inboundBytes").or_else(|| p.get("bytesReceived"))?.as_u64()
    };
    let mut out = Vec::new();
    for mut cam in all.iter().filter(|p| !p.name.starts_with(companion)).cloned() {
        let relay = all.iter().any(|p| p.name == format!("{companion}{}", cam.name) && p.live);
        let is_local = |ip: Option<std::net::IpAddr>| ip.is_none_or(|ip| local.contains(&ip));
        let (mut local_obs, mut local_screens) = (0usize, 0usize);
        let mut watchers = Vec::new();
        for s in sessions.iter().filter(|s| s.reading && s.path == cam.name) {
            let here = is_local(s.ip);
            let at = s.ip.map(|ip| ip.to_string()).unwrap_or_default();
            match (s.kind, here) {
                ("rtsp", true) => local_obs += 1,
                ("webrtc", true) => local_screens += 1,
                ("webrtc", false) => watchers.push(rhema_api::Watcher { kind: "screen".into(), name: s.ip.and_then(names.desk).map_or_else(|| format!("A screen or TV at {at}"), |d| format!("{d} (Rhema Studio desk)")), remote: true }),
                ("rtsp", false) => watchers.push(rhema_api::Watcher { kind: "obs".into(), name: s.ip.and_then(names.desk).map_or_else(|| format!("OBS or a player at {at}"), |d| format!("OBS or a player on {d}")), remote: true }),
                _ => watchers.push(rhema_api::Watcher { kind: "player".into(), name: if here { "A player on this computer".into() } else { format!("A player at {at}") }, remote: !here }),
            }
        }
        if relay {
            local_obs = local_obs.saturating_sub(1);
        }
        for s in sessions.iter().filter(|s| s.reading && s.path == format!("{companion}{}", cam.name)) {
            let here = is_local(s.ip);
            let name = (names.reader)(&s.user).map_or_else(|| "An OBS companion".to_string(), |n| format!("{n} (OBS companion)"));
            watchers.push(rhema_api::Watcher { kind: "companion".into(), name, remote: !here });
        }
        let one_each = watchers.len();
        let count = |n: usize, one: &str| if n == 1 { one.to_string() } else { format!("{one} ({n})") };
        if local_obs > 0 {
            watchers.insert(0, rhema_api::Watcher { kind: "obs".into(), name: count(local_obs, "OBS on this computer"), remote: false });
        }
        if local_screens > 0 {
            watchers.insert(0, rhema_api::Watcher { kind: "screen".into(), name: count(local_screens, "Rhema Studio screens on this computer"), remote: false });
        }
        cam.readers = local_obs + local_screens + one_each;
        cam.watchers = watchers;
        // What it sends: the bytes it received since the last look.
        if let Some(bytes) = inbound(&cam.name) {
            if let Some((was, at)) = before.get(&cam.name) {
                let secs = now.duration_since(*at).as_secs_f64();
                if secs >= 0.5 && bytes >= *was {
                    cam.kbps = u32::try_from(((bytes - was) as f64 * 8.0 / 1000.0 / secs).round() as u64).ok();
                }
            }
            before.insert(cam.name.clone(), (bytes, now));
        }
        if !cam.live {
            cam.kbps = None;
        }
        out.push(cam);
    }
    out
}

#[tauri::command]
pub async fn camera_router_status(router: State<'_, CameraRouter>, http: State<'_, Mutex<HttpRuntime>>) -> Result<RouterStatus, String> {
    let (wanted, running, restarts, error, tls) = {
        let mut s = router.lock();
        let running = s.child.as_mut().is_some_and(|c| matches!(c.try_wait(), Ok(None)));
        // An old error is not news once the router has run steadily again.
        let steady = running && s.started_at.is_some_and(|t| t.elapsed() >= Duration::from_secs(10));
        (s.want, running, s.restarts, if steady { None } else { s.last_error.clone() }, s.tls.clone())
    };
    // Read from the file each time: the router follows a renewed certificate by itself.
    let rtsps_fingerprint = if running { tls.as_ref().and_then(rtsps_fingerprint) } else { None };
    // The router's last answer (it is asked every two seconds while it runs; see look_regularly).
    let paths = if running { http.lock().map_err(|e| e.to_string())?.cameras().watch() } else { Vec::new() };
    Ok(RouterStatus { installed: locate().is_some(), running, wanted, lan_address: super::remote::remote_lan_address(), ports: PORTS, rtsps_fingerprint, restarts, error, paths })
}

#[derive(serde::Deserialize)]
pub struct CameraEntry {
    name: String,
    token: String,
}

/// The cameras the operator added and the secrets in their camera-page links. While the router
/// runs its settings follow (it reloads them by itself), and a camera that was removed or given a
/// new link is disconnected, so a phone already sending with the old link stops.
#[tauri::command]
pub fn cameras_set(router: State<'_, CameraRouter>, http: State<'_, Mutex<HttpRuntime>>, cameras: Vec<CameraEntry>) -> Result<(), String> {
    let hub = http.lock().map_err(|e| e.to_string())?.cameras();
    let before = hub.list();
    hub.set(&cameras.into_iter().map(|c| (c.name, c.token)).collect::<Vec<_>>());
    let now = hub.list();
    let gone = closed_cameras(&before, &now);
    let mut s = router.lock();
    let Some(config) = s.config.clone().filter(|_| s.want) else { return Ok(()) };
    // Secure phone pages may have been turned on since the router started: RTSPS follows.
    s.tls = s.tls_dir.as_deref().and_then(rtsps_cert);
    write_config(&config, &with_rtsps(config_yaml(&PORTS, s.lan.as_deref(), &now, &hub.reader_list(), &new_api_password())?, &PORTS, s.tls.as_ref()))?;
    if !gone.is_empty() {
        let api_password = s.api_password.clone();
        tauri::async_runtime::spawn(async move {
            // Give the router a moment to take in its new settings, so the camera cannot sign in again.
            tokio::time::sleep(Duration::from_millis(1500)).await;
            for name in gone {
                disconnect(&name, &api_password).await;
            }
        });
    }
    Ok(())
}

/// Cameras whose old link no longer works: removed, or given a new secret.
fn closed_cameras(before: &[(String, String)], now: &[(String, String)]) -> Vec<String> {
    before.iter().filter(|b| !now.contains(b)).map(|(name, _)| name.clone()).collect()
}

/// The router's endpoint that disconnects a sender of this kind (`/v3/paths/get` source type).
fn kick_path(source_type: &str) -> Option<&'static str> {
    Some(match source_type {
        "webRTCSession" => "webrtc/sessions",
        "rtmpConn" => "rtmp/conns",
        "rtmpsConn" => "rtmps/conns",
        "rtspSession" => "rtsp/sessions",
        "rtspsSession" => "rtsps/sessions",
        "srtConn" => "srt/conns",
        _ => return None,
    })
}

/// Disconnect whoever sends to this camera's name now (through the router's control API).
async fn disconnect(name: &str, api_password: &str) {
    let Ok(client) = reqwest::Client::builder().timeout(Duration::from_secs(3)).build() else { return };
    let base = format!("http://127.0.0.1:{}/v3", PORTS.api);
    let Ok(r) = client.get(format!("{base}/paths/get/{name}")).basic_auth(API_USER, Some(api_password)).send().await else { return };
    let Ok(path) = r.json::<serde_json::Value>().await else { return };
    let source = path.get("source");
    let (Some(kind), Some(id)) = (source.and_then(|s| s.get("type")).and_then(|t| t.as_str()).and_then(kick_path), source.and_then(|s| s.get("id")).and_then(|i| i.as_str())) else { return };
    match client.post(format!("{base}/{kind}/kick/{id}")).basic_auth(API_USER, Some(api_password)).send().await {
        Ok(r) if r.status().is_success() => log::info!("camera {name}: its sender was disconnected (removed or given a new link)"),
        Ok(r) => log::warn!("camera {name}: the router did not disconnect its sender ({})", r.status()),
        Err(e) => log::warn!("camera {name}: the router did not disconnect its sender: {e}"),
    }
}

/// Rhema is closing: the router goes with it.
pub fn shutdown(app: &AppHandle) {
    if let Some(router) = app.try_state::<CameraRouter>() {
        router.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const API: &str = "Zx9fK2mQ7tLw4pRb8nVc";
    const TOK: &str = "0123456789abcdef0123456789abcdef";

    fn cams() -> Vec<(String, String)> {
        vec![("pulpit".into(), TOK.into()), ("choir".into(), "fedcba9876543210fedcba9876543210".into())]
    }

    #[test]
    fn the_config_has_the_fixed_ports_and_only_what_is_used() {
        let y = config_yaml(&PORTS, Some("192.168.1.20"), &cams(), &[], API).unwrap();
        assert_eq!(PORTS.rtsps, 8322);
        for line in ["webrtcAddress: :8889", "webrtcLocalUDPAddress: :8189", "rtspAddress: :8554", "rtmpAddress: :1935", "srtAddress: :8890", "apiAddress: 127.0.0.1:9997", "rtspTransports: [tcp]"] {
            assert!(y.lines().any(|l| l == line), "{line} in\n{y}");
        }
        for off in ["hls: false", "playback: false", "metrics: false", "pprof: false", "moq: false", "webrtcICEServers2: []"] {
            assert!(y.lines().any(|l| l == off), "{off}");
        }
        assert!(!y.contains("stun:"), "no internet STUN server");
    }

    #[test]
    fn rtsps_uses_rhemas_own_certificate_and_keeps_plain_rtsp_for_obs() {
        let tls = RtspsCert { cert: PathBuf::from("/data/tls/rhema-server.pem"), key: PathBuf::from("/data/tls/rhema-server.key") };
        let y = with_rtsps(config_yaml(&PORTS, None, &cams(), &[], API).unwrap(), &PORTS, Some(&tls));
        for line in ["rtspEncryption: \"optional\"", "rtspsAddress: :8322", "rtspServerKey: '/data/tls/rhema-server.key'", "rtspServerCert: '/data/tls/rhema-server.pem'", "rtspAddress: :8554", "rtspTransports: [tcp]"] {
            assert!(y.lines().any(|l| l == line), "{line} in\n{y}");
        }
        // Without the certificate (secure phone pages never turned on): plain RTSP only, as before.
        let plain = with_rtsps(config_yaml(&PORTS, None, &cams(), &[], API).unwrap(), &PORTS, None);
        assert!(plain.lines().any(|l| l == "rtspEncryption: \"no\""), "{plain}");
        assert!(!plain.contains("rtspsAddress") && !plain.contains("rtspServerKey"));
        // A path the YAML could misread: quotes doubled; a line break means no RTSPS at all.
        let odd = RtspsCert { cert: PathBuf::from("/Users/o'neil/tls/rhema-server.pem"), key: PathBuf::from("/Users/o'neil/tls/rhema-server.key") };
        assert!(with_rtsps(config_yaml(&PORTS, None, &cams(), &[], API).unwrap(), &PORTS, Some(&odd)).lines().any(|l| l == "rtspServerCert: '/Users/o''neil/tls/rhema-server.pem'"));
        let broken = RtspsCert { cert: PathBuf::from("/x\nrtspEncryption: no/c.pem"), key: PathBuf::from("/x/c.key") };
        let b = with_rtsps(config_yaml(&PORTS, None, &cams(), &[], API).unwrap(), &PORTS, Some(&broken));
        assert!(b.lines().any(|l| l == "rtspEncryption: \"no\"") && !b.contains("rtspsAddress"), "{b}");
    }

    #[test]
    fn the_rtsps_certificate_is_rhemas_https_one_and_its_fingerprint() {
        let dir = std::env::temp_dir().join(format!("rhema-rtsps-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(rtsps_cert(&dir), None, "not made yet");
        let ca = rhema_api::tls::make_ca().unwrap();
        let server = rhema_api::tls::make_server(&ca, &["192.168.1.20".into()]).unwrap();
        std::fs::write(dir.join("rhema-server.pem"), &server.cert).unwrap();
        assert_eq!(rtsps_cert(&dir), None, "the key too");
        std::fs::write(dir.join("rhema-server.key"), &server.key).unwrap();
        let tls = rtsps_cert(&dir).unwrap();
        assert_eq!(tls.cert, dir.join("rhema-server.pem"));
        assert_eq!(tls.key, dir.join("rhema-server.key"));
        // The same fingerprint a Google TV is sent (#198): the leaf certificate's SHA-256.
        assert_eq!(rtsps_fingerprint(&tls), Some(rhema_api::tls::fingerprint(&server).unwrap()));
        std::fs::write(dir.join("rhema-server.pem"), "nonsense").unwrap();
        assert_eq!(rtsps_fingerprint(&tls), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn phones_and_tvs_are_told_this_computers_lan_address() {
        let y = config_yaml(&PORTS, Some("192.168.1.20"), &cams(), &[], API).unwrap();
        assert!(y.lines().any(|l| l == "webrtcAdditionalHosts: [\"192.168.1.20\"]"), "{y}");
        let none = config_yaml(&PORTS, None, &cams(), &[], API).unwrap();
        assert!(none.lines().any(|l| l == "webrtcAdditionalHosts: []"));
        let odd = config_yaml(&PORTS, Some("bad\"]\nhost"), &cams(), &[], API).unwrap();
        assert!(odd.lines().any(|l| l == "webrtcAdditionalHosts: []"), "only an IPv4 address goes in");
    }

    /// The router's users, as (user, pass, ips, [(action, path)]).
    fn users(y: &str) -> Vec<(String, String, String, Vec<(String, String)>)> {
        let block = &y[y.find("authInternalUsers:\n").unwrap()..y.find("\napi: true").unwrap()];
        block.split("  - user: ").skip(1).map(|u| {
            let field = |k: &str| u.lines().find_map(|l| l.trim().strip_prefix(k)).unwrap_or("").trim().to_string();
            let mut perms = Vec::new();
            for l in u.lines() {
                if let Some(a) = l.trim().strip_prefix("- action: ") { perms.push((a.to_string(), String::new())); }
                if let Some(p) = l.trim().strip_prefix("path: ") { perms.last_mut().unwrap().1 = p.to_string(); }
            }
            (u.lines().next().unwrap().trim().to_string(), field("pass:"), field("ips:"), perms)
        }).collect()
    }

    #[test]
    fn each_camera_publishes_as_itself_to_its_own_name_only() {
        let u = users(&config_yaml(&PORTS, None, &cams(), &[], API).unwrap());
        assert_eq!(u.len(), 4, "{u:?}");
        assert_eq!(u[1], ("any".into(), String::new(), "[]".into(), vec![("read".into(), format!("\"{CAMERA_PATHS}\""))]), "watching a camera's own name is open");
        assert_eq!(u[2], ("\"cam-pulpit\"".into(), format!("\"{TOK}\""), "[]".into(), vec![("publish".into(), "\"pulpit\"".into())]));
        assert_eq!(u[3].0, "\"cam-choir\"");
        assert_eq!(u[3].3, vec![("publish".into(), "\"choir\"".into())]);
        // Nobody else may publish: no other publish permission, and none without a path.
        let publishers: Vec<_> = u.iter().filter(|x| x.3.iter().any(|(a, _)| a == "publish")).collect();
        assert_eq!(publishers.len(), 2);
        assert!(publishers.iter().all(|x| x.0 != "any" && x.3.iter().all(|(_, p)| !p.is_empty())));
    }

    #[test]
    fn only_rhema_reaches_the_control_api_never_a_browser_page() {
        let y = config_yaml(&PORTS, None, &cams(), &[], API).unwrap();
        let u = users(&y);
        // No anonymous user holds api (or any other admin action).
        for (user, _, _, perms) in &u {
            if user == "any" {
                assert!(perms.iter().all(|(a, _)| a == "read"), "{perms:?}");
            }
        }
        let admin: Vec<_> = u.iter().filter(|x| x.3.iter().any(|(a, _)| matches!(a.as_str(), "api" | "metrics" | "pprof" | "playback"))).collect();
        assert_eq!(admin.len(), 1);
        assert_eq!(admin[0].0, "rhema-api");
        // First in the list, so MTX_AUTHINTERNALUSERS_0_PASS gives it the real password; the
        // file's value is a throwaway, never empty (an empty password would let anyone in).
        assert_eq!(u[0].0, "rhema-api");
        assert_eq!(API_PASS_ENV, "MTX_AUTHINTERNALUSERS_0_PASS");
        assert_eq!(admin[0].1, format!("\"{API}\""));
        assert_eq!(admin[0].2, "[\"127.0.0.1\", \"::1\"]");
        assert_eq!(admin[0].3, vec![("api".into(), String::new())]);
        // No CORS origin is allowed: a page in a browser on this computer cannot read or call it.
        assert!(y.lines().any(|l| l == "apiAllowOrigins: []"), "{y}");
        assert!(y.lines().any(|l| l == "apiAddress: 127.0.0.1:9997"));
    }

    const READER: &str = "read-a1b2c3d4";
    const RTOK: &str = "99998888777766665555444433332222";

    #[test]
    fn each_obs_companion_reads_only_the_companion_names() {
        let y = config_yaml(&PORTS, None, &cams(), &[(READER.into(), RTOK.into())], API).unwrap();
        let u = users(&y);
        let reader = u.iter().find(|x| x.0 == format!("\"{READER}\"")).expect("the companion's user");
        assert_eq!(reader.1, format!("\"{RTOK}\""));
        assert_eq!(reader.3, vec![("read".into(), "\"~^companion/\"".into())], "read only, companion names only");
        // Anyone may read a camera's own name (as before), never a companion name: `any` reads
        // names that are camera names only, which never hold a slash.
        let any = u.iter().find(|x| x.0 == "any").unwrap();
        assert_eq!(any.3, vec![("read".into(), "\"~^[a-z0-9][a-z0-9_-]*$\"".into())]);
        // The companion name is filled from the camera on this computer, only while someone reads it.
        assert!(y.contains("paths:\n  \"~^companion/([a-z0-9][a-z0-9_-]*)$\":\n    source: rtsp://127.0.0.1:8554/$G1\n    sourceOnDemand: true\n  all_others:\n"), "{y}");
        // The SRT passphrase is in the router's environment, never in the file.
        assert_eq!(SRT_READ_PASS_ENV, "MTX_PATHDEFAULTS_SRTREADPASSPHRASE");
        assert!(!y.to_lowercase().contains("passphrase"), "{y}");
        let p = new_srt_passphrase();
        assert!((10..=79).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_hexdigit()) && p != new_srt_passphrase());
    }

    #[test]
    fn a_reader_rhema_did_not_make_never_reaches_the_router() {
        let bad = [("any".into(), RTOK.into()), ("read-xyz".into(), RTOK.into()), ("cam-pulpit".into(), RTOK.into()), (READER.into(), "short".into()), ("read-a1b2c3d4\"\n  - user: any".into(), RTOK.into())];
        let u = users(&config_yaml(&PORTS, None, &[], &bad, API).unwrap());
        assert_eq!(u.iter().map(|x| x.0.as_str()).collect::<Vec<_>>(), vec!["rhema-api", "any"]);
    }

    #[test]
    fn an_unpaired_companions_obs_is_found_by_its_user() {
        let list = serde_json::json!({ "items": [
            { "id": "c1", "user": READER, "path": "companion/pulpit", "state": "read" },
            { "id": "c2", "user": "read-ffffffff", "path": "companion/choir", "state": "read" },
            { "id": "c3", "user": "", "path": "pulpit", "state": "publish" },
            { "id": "c4", "user": READER, "path": "companion/choir", "state": "read" }] });
        assert_eq!(conns_of(&list, &[READER.to_string()]), vec!["c1".to_string(), "c4".to_string()]);
        assert!(conns_of(&serde_json::json!({}), &[READER.to_string()]).is_empty());
    }

    #[test]
    fn each_camera_names_who_reads_it_and_what_it_sends() {
        let paths = |bytes: u64| serde_json::json!({ "items": [
            { "name": "pulpit", "ready": true, "source": { "type": "webRTCSession" }, "tracks": ["H264"], "tracks2": [{ "codec": "H264", "codecProps": { "width": 1280, "height": 720 } }], "inboundBytes": bytes, "readers": [{}, {}, {}, {}, {}] },
            { "name": "companion/pulpit", "ready": true, "source": { "type": "rtspSource" }, "tracks": ["H264"], "readers": [{}] },
            { "name": "choir", "ready": false, "source": null, "tracks": [], "readers": [] }] });
        let sess = |kind, path: &str, user: &str, addr: &str| Session { kind, path: path.into(), reading: true, user: user.into(), ip: ip_of(addr) };
        let sessions = vec![
            sess("rtsp", "pulpit", "", "127.0.0.1:50001"), // the router filling companion/pulpit
            sess("rtsp", "pulpit", "", "127.0.0.1:50002"), // OBS on this computer
            sess("webrtc", "pulpit", "", "192.168.1.20:6000"), // a screen here (the LAN address)
            sess("webrtc", "pulpit", "", "[::ffff:192.168.1.40]:6001"), // a TV
            sess("webrtc", "pulpit", "", "192.168.1.31:6002"), // a joined desk
            sess("srt", "companion/pulpit", READER, "192.168.1.50:7000"),
            Session { kind: "webrtc", path: "pulpit".into(), reading: false, user: "cam-pulpit".into(), ip: ip_of("192.168.1.60:5") },
        ];
        let reader = |u: &str| (u == READER).then(|| "Media desk".to_string());
        let desk = |ip: std::net::IpAddr| (ip.to_string() == "192.168.1.31").then(|| "Balcony laptop".to_string());
        let names = Names { reader: &reader, desk: &desk };
        let local = local_addresses(Some("192.168.1.20"));
        let mut before = std::collections::HashMap::new();
        let t0 = Instant::now();
        let w = build_watch(&paths(1_000_000), &sessions, &names, &local, &mut before, t0);
        assert_eq!(w.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), vec!["pulpit", "choir"], "a companion name is not a camera");
        let p = &w[0];
        let named: Vec<(&str, &str, bool)> = p.watchers.iter().map(|x| (x.kind.as_str(), x.name.as_str(), x.remote)).collect();
        assert_eq!(named, vec![
            ("screen", "Rhema Studio screens on this computer", false),
            ("obs", "OBS on this computer", false),
            ("screen", "A screen or TV at 192.168.1.40", true),
            ("screen", "Balcony laptop (Rhema Studio desk)", true),
            ("companion", "Media desk (OBS companion)", true),
        ]);
        assert_eq!(p.readers, 5, "the router filling the companion name is not counted");
        assert_eq!((p.width, p.height), (Some(1280), Some(720)));
        assert_eq!(p.kbps, None, "not known until the second look");
        let w = build_watch(&paths(1_500_000), &sessions, &names, &local, &mut before, t0 + Duration::from_secs(2));
        assert_eq!(w[0].kbps, Some(2000), "500 kB in 2 s is 2000 kbit/s");
        assert_eq!(w[1].kbps, None);
        assert!(w[1].watchers.is_empty());
    }

    /// For checking the router by hand (#209 acceptance 10fc): writes this code's settings, with
    /// the ports moved by RHEMA_ROUTER_PORT_OFFSET so a running router is not disturbed, to the file
    /// RHEMA_ROUTER_TEST_CONFIG. Run with `cargo test … print_router_config -- --ignored`.
    #[test]
    #[ignore = "writes a router settings file for a test by hand"]
    fn print_router_config() {
        let out = std::env::var("RHEMA_ROUTER_TEST_CONFIG").expect("RHEMA_ROUTER_TEST_CONFIG");
        let off: u16 = std::env::var("RHEMA_ROUTER_PORT_OFFSET").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
        let ports = Ports { webrtc: PORTS.webrtc + off, webrtc_udp: PORTS.webrtc_udp + off, rtsp: PORTS.rtsp + off, rtsps: PORTS.rtsps + off, rtmp: PORTS.rtmp + off, srt: PORTS.srt + off, api: PORTS.api + off };
        let cams: Vec<(String, String)> = std::env::var("RHEMA_ROUTER_CAMERAS").unwrap_or_default().split(',').filter_map(|c| c.split_once(':')).map(|(n, t)| (n.to_string(), t.to_string())).collect();
        let readers: Vec<(String, String)> = std::env::var("RHEMA_ROUTER_READERS").unwrap_or_default().split(',').filter_map(|c| c.split_once(':')).map(|(n, t)| (n.to_string(), t.to_string())).collect();
        std::fs::write(out, config_yaml(&ports, None, &cams, &readers, API).unwrap()).unwrap();
    }

    #[test]
    fn the_api_password_is_new_each_run_and_long() {
        let (a, b) = (new_api_password(), new_api_password());
        assert_ne!(a, b);
        assert!(valid_secret(&a) && a.len() == 64, "{a}");
    }

    #[test]
    fn bad_names_and_short_secrets_never_reach_the_router() {
        let y = config_yaml(&PORTS, None, &[("any".into(), TOK.into()), ("Bad".into(), TOK.into()), ("x".into(), "short".into()), ("ok".into(), format!("{TOK}\"\n  - user: any"))], &[], API).unwrap();
        let u = users(&y);
        assert_eq!(u.iter().map(|x| x.0.as_str()).collect::<Vec<_>>(), vec!["rhema-api", "any", "\"cam-any\""], "a camera called any is cam-any, never the router's anyone");
        for bad in ["", "short", "has space in it 1234", "quote\"inside123456", &"a".repeat(129)] {
            assert!(config_yaml(&PORTS, None, &[], &[], bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_removed_camera_or_a_new_link_closes_the_old_one() {
        let before = cams();
        let mut now = before.clone();
        now[0].1 = "11112222333344445555666677778888".into();
        now.remove(1);
        now.push(("wide".into(), TOK.into()));
        assert_eq!(closed_cameras(&before, &now), vec!["pulpit".to_string(), "choir".to_string()]);
        assert!(closed_cameras(&before, &before).is_empty());
    }

    #[test]
    fn each_kind_of_sender_has_its_disconnect() {
        assert_eq!(kick_path("webRTCSession"), Some("webrtc/sessions"));
        assert_eq!(kick_path("rtmpConn"), Some("rtmp/conns"));
        assert_eq!(kick_path("srtConn"), Some("srt/conns"));
        assert_eq!(kick_path("rtspSession"), Some("rtsp/sessions"));
        assert_eq!(kick_path("hlsSource"), None);
    }

    #[test]
    fn the_router_beside_rhema_comes_first_then_the_developer_copy() {
        let root = std::env::temp_dir().join(format!("rhema-router-{}", std::process::id()));
        let (app, home) = (root.join("app"), root.join("home"));
        let dev = home.join(".local").join("mediamtx");
        std::fs::create_dir_all(&app).unwrap();
        std::fs::create_dir_all(&dev).unwrap();
        assert_eq!(find_binary(Some(&app), Some(&home)), None, "not installed");
        std::fs::write(dev.join(EXE), b"x").unwrap();
        assert_eq!(find_binary(Some(&app), Some(&home)), Some(dev.join(EXE)));
        std::fs::write(app.join(EXE), b"x").unwrap();
        assert_eq!(find_binary(Some(&app), Some(&home)), Some(app.join(EXE)));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn restarts_wait_longer_each_time_up_to_half_a_minute() {
        let waits: Vec<u64> = (0..8).map(|n| backoff(n).as_secs()).collect();
        assert_eq!(waits, vec![1, 2, 4, 8, 16, 30, 30, 30]);
    }

    #[test]
    fn a_busy_port_is_said_plainly() {
        let e = plain_error("2026/10/23 22:17:20 ERR listen tcp :8889: bind: address already in use");
        assert!(e.starts_with("Port 8889 is already in use"), "{e}");
    }

    #[test]
    fn the_router_status_lists_each_camera() {
        // As MediaMTX v1.21 answers /v3/paths/list.
        let v: serde_json::Value = serde_json::from_str(r#"{"itemCount":2,"pageCount":1,"items":[
            {"name":"pulpit","confName":"all_others","source":{"type":"webRTCSession","id":"1"},"ready":true,"tracks":["H264"],"readers":[{"type":"webRTCSession","id":"2"},{"type":"rtspSession","id":"3"}]},
            {"name":"choir","confName":"all_others","source":null,"ready":false,"tracks":[],"readers":[]}]}"#).unwrap();
        assert_eq!(parse_paths(&v), vec![
            RouterPath { name: "pulpit".into(), live: true, source: Some("webRTCSession".into()), readers: 2, tracks: vec!["H264".into()], ..RouterPath::default() },
            RouterPath { name: "choir".into(), live: false, source: None, readers: 0, tracks: vec![], ..RouterPath::default() },
        ]);
        assert!(parse_paths(&serde_json::json!({})).is_empty());
    }
}
