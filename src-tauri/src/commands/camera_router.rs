//! The camera router (OP-009, #209): MediaMTX, shipped inside Rhema, takes each phone or IP camera
//! once and gives it to everything that wants it: Rhema's screens and TVs (WebRTC/WHEP) and OBS
//! (RTSP). Everything stays on the church network; nothing here talks to the internet.
//!
//! Rhema writes the router's settings into its data folder each time it starts it, runs it, puts
//! its messages in Rhema's log, starts it again if it stops by itself (waiting longer each time),
//! and stops it when Rhema closes. Publishing needs the church's camera password (kept in the
//! system keychain with the other secrets); watching is open on the church network for now, the
//! same as a TV or OBS reading any local camera.

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

/// The name cameras publish as; the password is the church's own.
pub const PUBLISH_USER: &str = "rhema";

/// A password Rhema made: letters and digits only (it goes into the router's settings and into
/// camera-app addresses), long enough not to be guessed.
fn valid_password(p: &str) -> bool {
    (16..=128).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// The router's settings. Publishing needs `rhema` and the password; watching is open; the status
/// API answers this computer only. HLS, recording playback, metrics and MoQ are off: nothing uses
/// them, and each would open another port. RTSP uses TCP only, so it opens no UDP ports beside
/// the remote-control ones (OSC listens on UDP 8000 by default).
pub fn config_yaml(ports: &Ports, lan_ip: Option<&str>, password: &str) -> Result<String, String> {
    if !valid_password(password) {
        return Err("The camera password is not one Rhema made".into());
    }
    let hosts = lan_ip.filter(|ip| ip.parse::<std::net::Ipv4Addr>().is_ok()).map(|ip| format!("\"{ip}\"")).unwrap_or_default();
    Ok(format!(
        r#"# Written by Rhema each time it starts the camera router; changes here are replaced.
logLevel: info
logDestinations: [stdout]
readTimeout: 10s
writeTimeout: 10s
authMethod: internal
authInternalUsers:
  - user: any
    pass:
    ips: []
    permissions:
      - action: read
  - user: {PUBLISH_USER}
    pass: "{password}"
    ips: []
    permissions:
      - action: publish
  - user: any
    pass:
    ips: ["127.0.0.1", "::1"]
    permissions:
      - action: api
api: true
apiAddress: 127.0.0.1:{api}
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
    password: String,
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

fn spawn(binary: &Path, config: &Path, router: &CameraRouter, generation: u64) -> Result<Child, String> {
    let mut cmd = Command::new(binary);
    cmd.arg(config).current_dir(config.parent().unwrap_or(Path::new("."))).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
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
            match spawn(&binary, &config, &router, generation) {
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

/// Start the camera router with the church's camera password (from the keychain). Starting it
/// again with the same password leaves it running; a new password restarts it.
#[tauri::command]
pub fn camera_router_start(app: AppHandle, router: State<'_, CameraRouter>, http: State<'_, Mutex<HttpRuntime>>, password: String) -> Result<(), String> {
    let binary = locate().ok_or("The camera router is not installed with this copy of Rhema.")?;
    {
        let s = router.lock();
        if s.want && s.child.is_some() && s.password == password {
            return Ok(());
        }
    }
    router.stop();
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("camera-router");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let config = dir.join("mediamtx.yml");
    let lan = super::remote::remote_lan_address();
    write_private(&config, &config_yaml(&PORTS, lan.as_deref(), &password)?)?;
    let generation = {
        let mut s = router.lock();
        s.generation += 1;
        s.want = true;
        s.password.clone_from(&password);
        s.last_error = None;
        s.restarts = 0;
        let child = spawn(&binary, &config, &router, s.generation)?;
        s.child = Some(child);
        s.started_at = Some(Instant::now());
        s.generation
    };
    http.lock().map_err(|e| e.to_string())?.cameras().set_router(Some(rhema_api::RouterTarget { base: format!("http://127.0.0.1:{}", PORTS.webrtc), user: PUBLISH_USER.into(), pass: password }));
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
    pub publish_user: &'static str,
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
    let (wanted, running, restarts, error) = {
        let mut s = router.lock();
        let running = s.child.as_mut().is_some_and(|c| matches!(c.try_wait(), Ok(None)));
        // An old error is not news once the router has run steadily again.
        let steady = running && s.started_at.is_some_and(|t| t.elapsed() >= Duration::from_secs(10));
        (s.want, running, s.restarts, if steady { None } else { s.last_error.clone() })
    };
    let paths = if running {
        let url = format!("http://127.0.0.1:{}/v3/paths/list", PORTS.api);
        match reqwest::Client::builder().timeout(Duration::from_millis(1500)).build().map_err(|e| e.to_string())?.get(url).send().await {
            Ok(r) => r.json::<serde_json::Value>().await.map(|v| parse_paths(&v)).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    } else {
        Vec::new()
    };
    Ok(RouterStatus { installed: locate().is_some(), running, wanted, lan_address: super::remote::remote_lan_address(), ports: PORTS, publish_user: PUBLISH_USER, restarts, error, paths })
}

#[derive(serde::Deserialize)]
pub struct CameraEntry {
    name: String,
    token: String,
}

/// The cameras the operator added and the secrets in their camera-page links.
#[tauri::command]
pub fn cameras_set(http: State<'_, Mutex<HttpRuntime>>, cameras: Vec<CameraEntry>) -> Result<(), String> {
    let hub = http.lock().map_err(|e| e.to_string())?.cameras();
    hub.set(&cameras.into_iter().map(|c| (c.name, c.token)).collect::<Vec<_>>());
    Ok(())
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

    const PASS: &str = "Zx9fK2mQ7tLw4pRb8nVc";

    #[test]
    fn the_config_has_the_fixed_ports_and_only_what_is_used() {
        let y = config_yaml(&PORTS, Some("192.168.1.20"), PASS).unwrap();
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
        let y = config_yaml(&PORTS, Some("192.168.1.20"), PASS).unwrap();
        assert!(y.lines().any(|l| l == "webrtcAdditionalHosts: [\"192.168.1.20\"]"), "{y}");
        let none = config_yaml(&PORTS, None, PASS).unwrap();
        assert!(none.lines().any(|l| l == "webrtcAdditionalHosts: []"));
        let odd = config_yaml(&PORTS, Some("bad\"]\nhost"), PASS).unwrap();
        assert!(odd.lines().any(|l| l == "webrtcAdditionalHosts: []"), "only an IPv4 address goes in");
    }

    #[test]
    fn publishing_needs_the_password_watching_is_open_status_is_local() {
        let y = config_yaml(&PORTS, None, PASS).unwrap();
        let users: Vec<&str> = y.split("  - user: ").skip(1).collect();
        assert_eq!(users.len(), 3, "{y}");
        assert!(users[0].starts_with("any") && users[0].contains("ips: []") && users[0].contains("- action: read") && !users[0].contains("publish"));
        assert!(users[1].starts_with("rhema") && users[1].contains(&format!("pass: \"{PASS}\"")) && users[1].contains("- action: publish") && !users[1].contains("read"));
        assert!(users[2].starts_with("any") && users[2].contains("ips: [\"127.0.0.1\", \"::1\"]") && users[2].contains("- action: api"));
        assert!(y.contains("authMethod: internal"));
    }

    #[test]
    fn only_a_password_rhema_made_is_accepted() {
        for bad in ["", "short", "has space in it 1234", "quote\"inside123456", &"a".repeat(129)] {
            assert!(config_yaml(&PORTS, None, bad).is_err(), "{bad}");
        }
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
