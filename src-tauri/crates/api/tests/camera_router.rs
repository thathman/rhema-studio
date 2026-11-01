//! The camera relay against the real router (MediaMTX, the build Rhema ships): many readers at one
//! address, each cut off by itself. The readers are simulated: real offers and real router sessions,
//! with no video reaching a real TV or phone. Set `RHEMA_MEDIAMTX` to the router's program, or keep a
//! developer copy in ~/.local/mediamtx; without either the test says so and passes, unless
//! `RHEMA_REQUIRE_ROUTER` is set (as CI does).

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use rhema_api::http::prune_camera_readers;
use rhema_api::{hash_key, new_camera_hub, new_feed_hub, new_key_set, new_shared_status, start_http_server, CommandError, CommandSink, FeedKeys, HttpConfig, KeyEntry, Role, RouterTarget};

const TOKEN: &str = "0123456789abcdef0123456789abcdef";
const API_PASS: &str = "Apipassword0123456789";
const RELAY_PASS: &str = "Relaysecret0123456789";
const FEED_KEY: &str = "fedcba9876543210";
const SCENE: &str = r#"{"scene":{"layers":[{"cameraUrl":"http://192.168.1.20:8889/pulpit/whep"}]}}"#;
/// What a browser offers to read H.264, without the media ever flowing.
const OFFER: &str = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\nc=IN IP4 0.0.0.0\r\na=mid:0\r\na=ice-ufrag:abcdabcd\r\na=ice-pwd:abcdabcdabcdabcdabcdabcd\r\na=ice-options:trickle\r\na=fingerprint:sha-256 AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB\r\na=setup:actpass\r\na=recvonly\r\na=rtcp-mux\r\na=rtpmap:96 H264/90000\r\na=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f\r\n";

fn router_program() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/mediamtx/mediamtx"));
    std::env::var_os("RHEMA_MEDIAMTX").map(PathBuf::from).or(home).filter(|p| p.is_file())
}

fn free_tcp() -> u16 {
    TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

fn free_udp() -> u16 {
    UdpSocket::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

/// The router, killed when the test ends however it ends.
struct Router(Child);

impl Drop for Router {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// The users as `config_yaml` writes them (camera_router.rs): nothing reads without a sign-in but
/// this computer, the relay reads for those Rhema checked.
fn start_router(dir: &std::path::Path, program: &std::path::Path, api: u16, webrtc: u16, rtsp: u16, udp: u16) -> Router {
    let yaml = format!(
        r#"logLevel: warn
logDestinations: [stdout]
authMethod: internal
authInternalUsers:
  - user: rhema-api
    pass: "{API_PASS}"
    ips: ["127.0.0.1", "::1"]
    permissions:
      - action: api
  - user: any
    pass:
    ips: ["127.0.0.1", "::1"]
    permissions:
      - action: read
        path: "~^[a-z0-9][a-z0-9_-]*$"
  - user: rhema-relay
    pass: "{RELAY_PASS}"
    ips: []
    permissions:
      - action: read
        path: "~^[a-z0-9][a-z0-9_-]*$"
  - user: "cam-pulpit"
    pass: "{TOKEN}"
    ips: []
    permissions:
      - action: publish
        path: "pulpit"
api: true
apiAddress: 127.0.0.1:{api}
metrics: false
pprof: false
playback: false
rtsp: true
rtspTransports: [tcp]
rtspAddress: 127.0.0.1:{rtsp}
rtmp: false
hls: false
webrtc: true
webrtcAddress: 127.0.0.1:{webrtc}
webrtcTrustedProxies: ["127.0.0.1"]
webrtcLocalUDPAddress: :{udp}
webrtcHandshakeTimeout: 60s
webrtcICEServers2: []
srt: false
moq: false
paths:
  all_others:
"#
    );
    let config = dir.join("mediamtx.yml");
    std::fs::write(&config, yaml).unwrap();
    Router(Command::new(program).arg(&config).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().expect("the router starts"))
}

fn base64(input: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    input.chunks(3).flat_map(|c| {
        let n = u32::from(c[0]) << 16 | u32::from(*c.get(1).unwrap_or(&0)) << 8 | u32::from(*c.get(2).unwrap_or(&0));
        (0..4).map(move |i| if i <= c.len() { T[(n >> (18 - i * 6) & 63) as usize] as char } else { '=' })
    }).collect()
}

/// A camera sending to the router over RTSP: a stream of H.264 packets until `stop`.
fn publish(rtsp: u16, stop: Arc<AtomicBool>) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut s = TcpStream::connect(("127.0.0.1", rtsp)).expect("the router's RTSP port");
        let url = format!("rtsp://127.0.0.1:{rtsp}/pulpit");
        let auth = format!("Authorization: Basic {}\r\n", base64(format!("cam-pulpit:{TOKEN}").as_bytes()));
        let sdp = "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=x\r\nt=0 0\r\nm=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\na=fmtp:96 packetization-mode=1;sprop-parameter-sets=Z0LAH9oBQBabARAAAAMAEAAAAwMvGDKg,aM48gA==\r\na=control:trackID=0\r\n";
        let mut ask = |line: String, headers: String, body: &str| -> String {
            let len = if body.is_empty() { String::new() } else { format!("Content-Length: {}\r\n", body.len()) };
            write!(s, "{line} RTSP/1.0\r\nCSeq: 1\r\n{auth}{headers}{len}\r\n{body}").unwrap();
            let mut got = Vec::new();
            let mut b = [0u8; 2048];
            while !got.windows(4).any(|w| w == b"\r\n\r\n") {
                let n = s.read(&mut b).unwrap();
                assert!(n > 0, "the router hung up");
                got.extend_from_slice(&b[..n]);
            }
            let text = String::from_utf8_lossy(&got).to_string();
            assert!(text.starts_with("RTSP/1.0 200"), "{text}");
            text
        };
        ask(format!("ANNOUNCE {url}"), "Content-Type: application/sdp\r\n".into(), sdp);
        let setup = ask(format!("SETUP {url}/trackID=0"), "Transport: RTP/AVP/TCP;unicast;interleaved=0-1;mode=record\r\n".into(), "");
        let session = setup.lines().find_map(|l| l.strip_prefix("Session:")).unwrap().split(';').next().unwrap().trim().to_string();
        ask(format!("RECORD {url}"), format!("Session: {session}\r\n"), "");
        let (t0, mut seq) = (Instant::now(), 0u16);
        while !stop.load(Ordering::Relaxed) {
            seq = seq.wrapping_add(1);
            let ts = (t0.elapsed().as_secs_f64() * 90_000.0) as u32;
            let mut rtp = vec![0x80, 0xE0];
            rtp.extend(seq.to_be_bytes());
            rtp.extend(ts.to_be_bytes());
            rtp.extend(1234u32.to_be_bytes());
            rtp.push(0x65);
            rtp.extend([0x88u8; 50]);
            let mut frame = vec![b'$', 0];
            frame.extend(u16::try_from(rtp.len()).unwrap().to_be_bytes());
            frame.extend(rtp);
            if s.write_all(&frame).is_err() {
                return;
            }
            std::thread::sleep(Duration::from_millis(40));
        }
    })
}

struct Sink;

impl CommandSink for Sink {
    fn emit_event(&self, _: &str, _: &str) -> Result<(), CommandError> {
        Ok(())
    }
    fn invoke_backend(&self, _: &str, _: &str) -> Result<(), CommandError> {
        Ok(())
    }
}

fn key(token: &str, role: Role) -> KeyEntry {
    KeyEntry { hash: hash_key(token), name: token.into(), role, paused: false, output_scope: Vec::new(), group_take_scope: Vec::new(), record: false }
}

struct Rig {
    client: reqwest::Client,
    http: u16,
    api: String,
    webrtc: u16,
}

impl Rig {
    async fn sessions(&self) -> Vec<String> {
        let list = self.list().await;
        list["items"].as_array().unwrap().iter().map(|s| s["id"].as_str().unwrap().to_string()).collect()
    }

    async fn list(&self) -> serde_json::Value {
        serde_json::from_slice(&self.client.get(format!("{}/webrtc/sessions/list", self.api)).basic_auth("rhema-api", Some(API_PASS)).send().await.unwrap().bytes().await.unwrap()).unwrap()
    }

    /// A desk's offer through Rhema, with its key.
    async fn desk(&self, token: &str) -> u16 {
        self.client.post(format!("http://127.0.0.1:{}/api/v1/cameras/pulpit/whep", self.http)).header("x-rhema-key", token).header("content-type", "application/sdp").body(OFFER).send().await.unwrap().status().as_u16()
    }

    /// A TV's offer through Rhema, with its feed key.
    async fn tv(&self) -> u16 {
        self.client.post(format!("http://127.0.0.1:{}/api/v1/feed/tv/camera/pulpit/whep?k={FEED_KEY}", self.http)).header("content-type", "application/sdp").body(OFFER).send().await.unwrap().status().as_u16()
    }

    /// The router's session made by this offer.
    async fn opened(&self, offer: impl std::future::Future<Output = u16>) -> String {
        let before = self.sessions().await;
        assert_eq!(offer.await, 201, "the reader may read");
        self.sessions().await.into_iter().find(|s| !before.contains(s)).expect("the router made a session")
    }
}

/// The real router with a camera sending, Rhema's real server in front of it, and keys for `tokens`.
struct Setup {
    _dir: tempfile::TempDir,
    _router: Router,
    stop: Arc<AtomicBool>,
    camera: std::thread::JoinHandle<()>,
    keys: rhema_api::KeySet,
    feeds: rhema_api::SharedFeeds,
    cameras: rhema_api::SharedCameras,
    handle: rhema_api::HttpHandle,
    rig: Rig,
}

async fn setup(tokens: &[&str]) -> Option<Setup> {
    let Some(program) = router_program() else {
        assert!(std::env::var_os("RHEMA_REQUIRE_ROUTER").is_none(), "no router program to test against");
        eprintln!("skipped: no camera router on this computer");
        return None;
    };
    let dir = tempfile::tempdir().unwrap();
    let (api, webrtc, rtsp, udp) = (free_tcp(), free_tcp(), free_tcp(), free_udp());
    let router = start_router(dir.path(), &program, api, webrtc, rtsp, udp);
    tokio::time::sleep(Duration::from_millis(800)).await;
    let stop = Arc::new(AtomicBool::new(false));
    let camera = publish(rtsp, stop.clone());

    let keys = new_key_set();
    {
        let mut k = keys.write().unwrap();
        k.require_auth = true;
        k.entries = tokens.iter().map(|t| key(t, Role::Present)).collect();
    }
    let feeds = new_feed_hub();
    feeds.set_keys(&[FeedKeys { id: "tv".into(), token: FEED_KEY.into(), tvs: Vec::new() }]);
    feeds.publish("tv", SCENE.into());
    let cameras = new_camera_hub();
    cameras.set(&[("pulpit".into(), TOKEN.into()), ("choir".into(), TOKEN.into())]);
    cameras.set_router(Some(RouterTarget { base: format!("http://127.0.0.1:{webrtc}"), srt_port: 0, srt_passphrase: "Passphrase0123456789".into(), relay_secret: RELAY_PASS.into() }));
    let server = start_http_server(HttpConfig { port: 0, host: "127.0.0.1".into(), keys: keys.clone(), feeds: feeds.clone(), cameras: cameras.clone(), ..Default::default() }, Arc::new(Sink), new_shared_status()).await.expect("Rhema's server starts");
    let rig = Rig { client: reqwest::Client::builder().timeout(Duration::from_secs(10)).build().unwrap(), http: server.bound_port, api: format!("http://127.0.0.1:{api}/v3"), webrtc };

    // The camera is on the air once the router will answer an offer.
    let t0 = Instant::now();
    loop {
        let path: serde_json::Value = serde_json::from_slice(&rig.client.get(format!("{}/paths/list", rig.api)).basic_auth("rhema-api", Some(API_PASS)).send().await.unwrap().bytes().await.unwrap()).unwrap();
        if path["items"].as_array().is_some_and(|i| i.iter().any(|p| p["name"] == "pulpit" && p["ready"] == true)) {
            break;
        }
        assert!(t0.elapsed() < Duration::from_secs(10), "the camera never came on: {path}");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Some(Setup { _dir: dir, _router: router, stop, camera, keys, feeds, cameras, handle: server.handle, rig })
}

#[tokio::test]
async fn a_new_network_address_interrupts_nobody() {
    let Some(s) = setup(&["steady"]).await else { return };
    let desk = s.rig.opened(s.rig.desk("steady")).await;
    let tv = s.rig.opened(s.rig.tv()).await;
    // What `follow_address` changes: the address this computer's own readers may use.
    let config = s._dir.path().join("mediamtx.yml");
    let yaml = std::fs::read_to_string(&config).unwrap();
    let new = config.with_extension("yml.new");
    std::fs::write(&new, yaml.replace(r#"ips: ["127.0.0.1", "::1"]
    permissions:
      - action: read"#, r#"ips: ["127.0.0.1", "::1", "10.0.0.7"]
    permissions:
      - action: read"#)).unwrap();
    std::fs::rename(&new, &config).unwrap();
    tokio::time::sleep(Duration::from_millis(2500)).await;
    let left = s.rig.sessions().await;
    assert!(left.contains(&desk) && left.contains(&tv), "{left:?}");
    assert!(!s.camera.is_finished(), "the camera's RTSP connection was dropped");
    s.stop.store(true, Ordering::Relaxed);
}

fn rss_kb(pid: u32) -> u64 {
    let out = Command::new("ps").args(["-o", "rss=", "-p", &pid.to_string()]).output().unwrap();
    String::from_utf8_lossy(&out.stdout).trim().parse().unwrap_or(0)
}

fn open_files(pid: u32) -> usize {
    let out = Command::new("lsof").args(["-n", "-P", "-p", &pid.to_string()]).output().unwrap();
    String::from_utf8_lossy(&out.stdout).lines().count()
}

/// Readers come and go for `RHEMA_SOAK_SECS` (by hand with `--ignored`): some are revoked, some simply
/// abandon their session. Prints memory and open files of the router and of Rhema's server here.
#[tokio::test]
#[ignore = "takes as long as it is asked to"]
async fn soak_readers_coming_and_going() {
    let secs: u64 = std::env::var("RHEMA_SOAK_SECS").ok().and_then(|s| s.parse().ok()).unwrap_or(600);
    let s = setup(&["leaver"]).await.expect("a router program");
    let (router, me) = (s._router.0.id(), std::process::id());
    let (t0, mut next, mut opened, mut refused, mut peak) = (Instant::now(), Duration::ZERO, 0u64, 0u64, 0usize);
    let mut round = 0u64;
    while t0.elapsed() < Duration::from_secs(secs) {
        round += 1;
        // One reader each round: every other one is revoked, the rest abandon their session.
        match s.rig.desk("leaver").await {
            201 => opened += 1,
            _ => refused += 1,
        }
        if round % 2 == 0 {
            let entry = key("leaver", Role::Present);
            s.keys.write().unwrap().entries.retain(|e| e.hash != entry.hash);
            prune_camera_readers(&s.cameras, &s.keys, &s.feeds);
            s.keys.write().unwrap().entries.push(entry);
        }
        let list = s.rig.list().await;
        s.cameras.relay_kick_unheld(&s.rig.client, &s.rig.api, "rhema-api", API_PASS, &list).await;
        peak = peak.max(s.cameras.relay_readers("pulpit"));
        if t0.elapsed() >= next {
            eprintln!("t={:>5}s router rss={}KB files={} | rhema rss={}KB files={} | opened={opened} refused={refused} held={} sessions={}", t0.elapsed().as_secs(), rss_kb(router), open_files(router), rss_kb(me), open_files(me), s.cameras.relay_readers("pulpit"), list["items"].as_array().map_or(0, Vec::len));
            next += Duration::from_secs(60);
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    eprintln!("done: opened={opened} refused={refused} peak held={peak}");
    assert!(!s.camera.is_finished(), "the camera's connection was dropped");
    s.stop.store(true, Ordering::Relaxed);
}

/// For a real browser (run by hand with `--ignored`): holds the relay open on the port it writes to
/// `RHEMA_HOLD_DIR/port`, and revokes key `revoked` when that folder gets a file `revoke`.
#[tokio::test]
#[ignore = "waits for a browser driven by hand"]
async fn hold_the_relay_for_a_browser() {
    let dir = PathBuf::from(std::env::var_os("RHEMA_HOLD_DIR").expect("RHEMA_HOLD_DIR"));
    let s = setup(&["revoked", "steady"]).await.expect("a router program");
    std::fs::write(dir.join("port"), s.rig.http.to_string()).unwrap();
    while !dir.join("done").exists() {
        if dir.join("revoke").exists() {
            s.keys.write().unwrap().entries.retain(|e| e.hash != hash_key("revoked"));
        }
        if prune_camera_readers(&s.cameras, &s.keys, &s.feeds) > 0 {
            let list = s.rig.list().await;
            s.cameras.relay_kick_unheld(&s.rig.client, &s.rig.api, "rhema-api", API_PASS, &list).await;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    s.stop.store(true, Ordering::Relaxed);
}

#[tokio::test]
async fn one_reader_is_cut_off_and_the_others_at_its_address_keep_playing() {
    let Some(Setup { _dir, _router, stop, camera, keys, feeds, cameras, handle, rig }) = setup(&["revoked", "demoted", "paused", "steady"]).await else { return };

    // Everyone reads one camera from one address; this computer's own screen reads with no sign-in.
    let revoked = rig.opened(rig.desk("revoked")).await;
    let demoted = rig.opened(rig.desk("demoted")).await;
    let paused = rig.opened(rig.desk("paused")).await;
    let steady = rig.opened(rig.desk("steady")).await;
    let reconnected = rig.opened(rig.desk("steady")).await;
    let tv = rig.opened(rig.tv()).await;
    let screen = rig.opened(async {
        rig.client.post(format!("http://127.0.0.1:{}/pulpit/whep", rig.webrtc)).header("content-type", "application/sdp").body(OFFER).send().await.unwrap().status().as_u16()
    }).await;
    let mut alive = vec![revoked.clone(), demoted.clone(), paused.clone(), steady.clone(), reconnected.clone(), tv.clone(), screen.clone()];
    alive.sort();
    let mut now = rig.sessions().await;
    now.sort();
    assert_eq!(now, alive);

    // One change, one look at the router, as the app's loop does; how long until that session is gone.
    let sweep = |gone: String, expect: u16| {
        let (rig, cameras, keys, feeds) = (&rig, cameras.clone(), keys.clone(), feeds.clone());
        async move {
            let t = Instant::now();
            assert!(prune_camera_readers(&cameras, &keys, &feeds) >= usize::from(expect > 0), "the reader's right went");
            let list = rig.list().await;
            cameras.relay_kick_unheld(&rig.client, &rig.api, "rhema-api", API_PASS, &list).await;
            let left = rig.sessions().await;
            assert!(!left.contains(&gone), "{gone} still reads: {left:?}");
            eprintln!("cut off in {} ms, {} sessions left", t.elapsed().as_millis(), left.len());
            left
        }
    };

    // A revoked key: its session stops, every other carries on, and it cannot come back.
    keys.write().unwrap().entries.retain(|e| e.hash != hash_key("revoked"));
    let left = sweep(revoked.clone(), 1).await;
    for other in [&demoted, &paused, &steady, &reconnected, &tv, &screen] {
        assert!(left.contains(other), "{other} was cut off with it");
    }
    assert_eq!(rig.desk("revoked").await, 401);

    // A new role that reads no cameras.
    keys.write().unwrap().entries.iter_mut().find(|e| e.hash == hash_key("demoted")).unwrap().role = Role::Viewer;
    let left = sweep(demoted.clone(), 1).await;
    assert_eq!(rig.desk("demoted").await, 403);
    for other in [&paused, &steady, &reconnected, &tv, &screen] {
        assert!(left.contains(other), "{other} was cut off with it");
    }

    // Control taken back, as with an OBS companion.
    keys.write().unwrap().entries.iter_mut().find(|e| e.hash == hash_key("paused")).unwrap().paused = true;
    let left = sweep(paused.clone(), 1).await;
    assert_eq!(rig.desk("paused").await, 403);
    assert!(left.contains(&steady) && left.contains(&reconnected) && left.contains(&tv), "{left:?}");

    // The output's scene moves to another camera: the TV stops reading this one, the desks do not.
    feeds.publish("tv", r#"{"scene":{"layers":[{"cameraUrl":"http://192.168.1.20:8889/choir/whep"}]}}"#.into());
    let left = sweep(tv.clone(), 1).await;
    assert_eq!(rig.tv().await, 403);
    assert!(left.contains(&steady) && left.contains(&reconnected) && left.contains(&screen), "{left:?}");

    // Back in the scene, then the TV is unpaired from the output (a new link).
    feeds.publish("tv", SCENE.into());
    let tv = rig.opened(rig.tv()).await;
    feeds.set_keys(&[FeedKeys { id: "tv".into(), token: "0000111122223333".into(), tvs: Vec::new() }]);
    let left = sweep(tv, 1).await;
    assert_eq!(rig.tv().await, 403);
    assert!(left.contains(&steady) && left.contains(&reconnected) && left.contains(&screen), "{left:?}");

    // Only allowed sessions and this computer's screen remain, with the allowed key's two readers intact.
    assert_eq!(cameras.relay_readers("pulpit"), 2);
    stop.store(true, Ordering::Relaxed);
    let _ = camera.join();
    let mut h = handle;
    h.stop();
}
