//! The camera router (OP-009, #209): MediaMTX, shipped inside Rhema, takes each phone or IP camera
//! once and gives it to everything that wants it: Rhema's screens and TVs (WebRTC/WHEP) and OBS
//! (RTSP). Everything stays on the church network; nothing here talks to the internet.
//!
//! Rhema writes the router's settings into its data folder each time it starts it, runs it, puts
//! its messages in Rhema's log, starts it again if it stops by itself (waiting longer each time),
//! and stops it when Rhema closes. Each camera publishes as its own user (`cam-<name>`, with its
//! link's secret), to its own name only; watching is open on the church network for now, the same
//! as a TV or OBS reading any local camera. The router's control API answers only Rhema: a user
//! and password made afresh each run, kept in memory and handed to the router in its environment
//! (the settings file holds a throwaway value in its place), never written to a file or the log.

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
    /// RTMP and SRT for camera apps (Moblin, StreamCaster) and encoders.
    pub rtmp: u16,
    pub srt: u16,
    /// The router's own status (which cameras are sending, who watches), this computer only.
    pub api: u16,
}

pub const PORTS: Ports = Ports { webrtc: 8889, webrtc_udp: 8189, rtsp: 8554, rtmp: 1935, srt: 8890, api: 9997 };

/// The router's control-API user; its password is made afresh each time the router starts. It is
/// the first user in the settings, so the router takes its password from this variable.
const API_USER: &str = "rhema-api";
const API_PASS_ENV: &str = "MTX_AUTHINTERNALUSERS_0_PASS";

/// A secret Rhema made: letters and digits only (it goes into the router's settings and into
/// camera-app addresses), long enough not to be guessed.
fn valid_secret(p: &str) -> bool {
    (16..=128).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// A new secret for the router's control API (64 hex characters from the system's random source).
fn new_api_password() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

/// The router's settings. Each camera (name, secret) may publish to its own name only, as
/// `cam-<name>`; watching is open; the control API answers only `rhema-api`, from this computer,
/// and no browser page (no allowed CORS origin). Its real password goes to the router in
/// `API_PASS_ENV`; `api_placeholder` (random, thrown away) stands in the file so it is never empty. HLS, recording
/// playback, metrics, pprof and MoQ are off: nothing uses them, and each would open another port.
/// RTSP uses TCP only, so it opens no UDP ports beside the remote-control ones (OSC listens on UDP
/// 8000 by default).
pub fn config_yaml(ports: &Ports, lan_ip: Option<&str>, cameras: &[(String, String)], api_placeholder: &str) -> Result<String, String> {
    if !valid_secret(api_placeholder) {
        return Err("The router's API password is not one Rhema made".into());
    }
    let hosts = lan_ip.filter(|ip| ip.parse::<std::net::Ipv4Addr>().is_ok()).map(|ip| format!("\"{ip}\"")).unwrap_or_default();
    let prefix = rhema_api::PUBLISH_PREFIX;
    let publishers: String = cameras
        .iter()
        .filter(|(name, token)| rhema_api::valid_camera_name(name) && valid_secret(token))
        .map(|(name, token)| format!("  - user: \"{prefix}{name}\"\n    pass: \"{token}\"\n    ips: []\n    permissions:\n      - action: publish\n        path: \"{name}\"\n"))
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
{publishers}api: true
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
    /// Its settings file and the LAN address it was started with, to rewrite when cameras change.
    config: Option<PathBuf>,
    lan: Option<String>,
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

fn spawn(binary: &Path, config: &Path, router: &CameraRouter, generation: u64, api_password: &str) -> Result<Child, String> {
    let mut cmd = Command::new(binary);
    cmd.arg(config).env(API_PASS_ENV, api_password).current_dir(config.parent().unwrap_or(Path::new("."))).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
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
            let api_password = s.api_password.clone();
            match spawn(&binary, &config, &router, generation, &api_password) {
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
pub fn camera_router_start(app: AppHandle, router: State<'_, CameraRouter>, http: State<'_, Mutex<HttpRuntime>>) -> Result<(), String> {
    let binary = locate().ok_or("The camera router is not installed with this copy of Rhema.")?;
    if router.lock().want {
        return Ok(());
    }
    let hub = http.lock().map_err(|e| e.to_string())?.cameras();
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("camera-router");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let config = dir.join("mediamtx.yml");
    let lan = super::remote::remote_lan_address();
    let api_password = new_api_password();
    write_config(&config, &config_yaml(&PORTS, lan.as_deref(), &hub.list(), &new_api_password())?)?;
    let generation = {
        let mut s = router.lock();
        s.generation += 1;
        s.want = true;
        s.config = Some(config.clone());
        s.lan = lan;
        s.last_error = None;
        s.restarts = 0;
        let child = spawn(&binary, &config, &router, s.generation, &api_password)?;
        s.api_password = api_password;
        s.child = Some(child);
        s.started_at = Some(Instant::now());
        s.generation
    };
    hub.set_router(Some(rhema_api::RouterTarget { base: format!("http://127.0.0.1:{}", PORTS.webrtc) }));
    log::info!("camera router started ({}), WebRTC on port {}, RTSP on {}", binary.display(), PORTS.webrtc, PORTS.rtsp);
    supervise(router.inner().clone(), binary, config, generation);
    Ok(())
}

#[tauri::command]
pub fn camera_router_stop(router: State<'_, CameraRouter>, http: State<'_, Mutex<HttpRuntime>>) -> Result<(), String> {
    router.stop();
    http.lock().map_err(|e| e.to_string())?.cameras().set_router(None);
    log::info!("camera router stopped");
    Ok(())
}

/// One camera as the router sees it.
#[derive(Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RouterPath {
    pub name: String,
    /// A camera is sending to it now.
    pub live: bool,
    /// How it sends (e.g. webRTCSession, rtmpConn, srtConn).
    pub source: Option<String>,
    /// Screens, TVs and OBS watching it now.
    pub readers: usize,
    /// Its codecs (e.g. H264).
    pub tracks: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouterStatus {
    pub installed: bool,
    pub running: bool,
    /// Turned on (it may be between restarts).
    pub wanted: bool,
    pub lan_address: Option<String>,
    pub ports: Ports,
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
                Some(RouterPath { live: p.get("ready").and_then(serde_json::Value::as_bool).unwrap_or(false), readers: p.get("readers").and_then(|r| r.as_array()).map_or(0, Vec::len), name, source, tracks })
            })
            .collect()
    })
}

#[tauri::command]
pub async fn camera_router_status(router: State<'_, CameraRouter>) -> Result<RouterStatus, String> {
    let (wanted, running, restarts, error, api_password) = {
        let mut s = router.lock();
        let running = s.child.as_mut().is_some_and(|c| matches!(c.try_wait(), Ok(None)));
        // An old error is not news once the router has run steadily again.
        let steady = running && s.started_at.is_some_and(|t| t.elapsed() >= Duration::from_secs(10));
        (s.want, running, s.restarts, if steady { None } else { s.last_error.clone() }, s.api_password.clone())
    };
    let paths = if running {
        let url = format!("http://127.0.0.1:{}/v3/paths/list", PORTS.api);
        match reqwest::Client::builder().timeout(Duration::from_millis(1500)).build().map_err(|e| e.to_string())?.get(url).basic_auth(API_USER, Some(&api_password)).send().await {
            Ok(r) => r.json::<serde_json::Value>().await.map(|v| parse_paths(&v)).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    } else {
        Vec::new()
    };
    Ok(RouterStatus { installed: locate().is_some(), running, wanted, lan_address: super::remote::remote_lan_address(), ports: PORTS, restarts, error, paths })
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
    let s = router.lock();
    let Some(config) = s.config.clone().filter(|_| s.want) else { return Ok(()) };
    write_config(&config, &config_yaml(&PORTS, s.lan.as_deref(), &now, &new_api_password())?)?;
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
        let y = config_yaml(&PORTS, Some("192.168.1.20"), &cams(), API).unwrap();
        for line in ["webrtcAddress: :8889", "webrtcLocalUDPAddress: :8189", "rtspAddress: :8554", "rtmpAddress: :1935", "srtAddress: :8890", "apiAddress: 127.0.0.1:9997", "rtspTransports: [tcp]"] {
            assert!(y.lines().any(|l| l == line), "{line} in\n{y}");
        }
        for off in ["hls: false", "playback: false", "metrics: false", "pprof: false", "moq: false", "webrtcICEServers2: []"] {
            assert!(y.lines().any(|l| l == off), "{off}");
        }
        assert!(!y.contains("stun:"), "no internet STUN server");
    }

    #[test]
    fn phones_and_tvs_are_told_this_computers_lan_address() {
        let y = config_yaml(&PORTS, Some("192.168.1.20"), &cams(), API).unwrap();
        assert!(y.lines().any(|l| l == "webrtcAdditionalHosts: [\"192.168.1.20\"]"), "{y}");
        let none = config_yaml(&PORTS, None, &cams(), API).unwrap();
        assert!(none.lines().any(|l| l == "webrtcAdditionalHosts: []"));
        let odd = config_yaml(&PORTS, Some("bad\"]\nhost"), &cams(), API).unwrap();
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
        let u = users(&config_yaml(&PORTS, None, &cams(), API).unwrap());
        assert_eq!(u.len(), 4, "{u:?}");
        assert_eq!(u[1], ("any".into(), String::new(), "[]".into(), vec![("read".into(), String::new())]), "watching is open");
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
        let y = config_yaml(&PORTS, None, &cams(), API).unwrap();
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

    #[test]
    fn the_api_password_is_new_each_run_and_long() {
        let (a, b) = (new_api_password(), new_api_password());
        assert_ne!(a, b);
        assert!(valid_secret(&a) && a.len() == 64, "{a}");
    }

    #[test]
    fn bad_names_and_short_secrets_never_reach_the_router() {
        let y = config_yaml(&PORTS, None, &[("any".into(), TOK.into()), ("Bad".into(), TOK.into()), ("x".into(), "short".into()), ("ok".into(), format!("{TOK}\"\n  - user: any"))], API).unwrap();
        let u = users(&y);
        assert_eq!(u.iter().map(|x| x.0.as_str()).collect::<Vec<_>>(), vec!["rhema-api", "any", "\"cam-any\""], "a camera called any is cam-any, never the router's anyone");
        for bad in ["", "short", "has space in it 1234", "quote\"inside123456", &"a".repeat(129)] {
            assert!(config_yaml(&PORTS, None, &[], bad).is_err(), "{bad}");
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
            RouterPath { name: "pulpit".into(), live: true, source: Some("webRTCSession".into()), readers: 2, tracks: vec!["H264".into()] },
            RouterPath { name: "choir".into(), live: false, source: None, readers: 0, tracks: vec![] },
        ]);
        assert!(parse_paths(&serde_json::json!({})).is_empty());
    }
}
