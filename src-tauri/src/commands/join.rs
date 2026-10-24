//! Joining another Rhema on the church network (Host/Join, ARCH-004): pair with its code, follow
//! its Live State, and send the commands this computer's key allows. The host stays in charge:
//! everything here goes through its ordinary command API, which checks the key and its role.

use std::collections::BTreeMap;
use std::net::Ipv4Addr;
use std::sync::Mutex;
use std::time::Duration;

use rhema_join::discover::{browse, found, Found};
use rhema_join::host::{base_url, client, Host};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::watch;

/// The one connection to a host, if any.
#[derive(Default)]
pub struct JoinRuntime {
    stop: Mutex<Option<watch::Sender<bool>>>,
}

/// Pair with the host while its pairing window is open; the token comes back once. `role` asks
/// for a role that does less than Present (an OBS companion, #209); the host decides.
#[tauri::command]
pub async fn join_pair(address: String, code: String, name: String, role: Option<String>) -> Result<String, String> {
    rhema_join::host::pair(&Host::plain(&address)?, &code, &name, role.as_deref()).await
}

/// The name and role the host gives this computer's key.
#[tauri::command]
pub async fn join_me(address: String, token: String) -> Result<serde_json::Value, String> {
    rhema_join::host::me(&Host::plain(&address)?, &token).await
}

/// What an OBS companion is told by its host (#209): the church's cameras, who reads them, and
/// its own way to read them while the host's camera router runs.
#[tauri::command]
pub async fn join_cameras(address: String, token: String) -> Result<serde_json::Value, String> {
    rhema_join::host::cameras(&Host::plain(&address)?, &token).await
}

/// An OBS companion's tally to its host: the cameras on its OBS program and preview, and those its
/// OBS plays, for the host's Production → Cameras.
#[tauri::command]
pub async fn join_tally(address: String, token: String, tally: serde_json::Value) -> Result<(), String> {
    rhema_join::host::tally(&Host::plain(&address)?, &token, &tally).await
}

/// The body of one command: a fresh `id` (a retry is harmless) and, when known, the service this
/// desk is looking at (#246 C16), so the host refuses it if it has moved to another one.
fn command_body(command: serde_json::Value, service: Option<String>) -> serde_json::Value {
    let mut body = command;
    if let Some(o) = body.as_object_mut() {
        o.insert("id".into(), serde_json::Value::String(uuid::Uuid::new_v4().to_string()));
        if let Some(s) = service {
            o.insert("service".into(), serde_json::Value::String(s));
        }
    }
    body
}

/// What the desk is told when the host refuses. Three refusals start with a word the desk acts on:
/// "paused:" (the main desk has taken back control, #243), "other-service:" (the desk is looking
/// at a different service and refreshes, #246 C16) and "stale:" (someone changed that part of the
/// service first: look again, #196 R7). An older host's 409 has no code and is the other service.
fn refusal(status: u16, error: Option<String>, code: Option<&str>) -> String {
    let msg = error.unwrap_or_else(|| "The host refused".into());
    match (status, code) {
        (423, _) => format!("paused: {msg}"),
        (409, Some("stale")) => format!("stale: {msg}"),
        (409, _) => format!("other-service: {msg}"),
        _ => msg,
    }
}

/// Send one command (the host checks the key's role and the service). A command the host took may
/// come back with a note for the desk (a scene change sent to the main desk to accept).
#[tauri::command]
pub async fn join_command(address: String, token: String, command: serde_json::Value, service: Option<String>) -> Result<Option<String>, String> {
    let url = format!("{}/api/v1/command", base_url(&address)?);
    let body = command_body(command, service);
    let r = client(Some(Duration::from_secs(10)))?.post(url).header("X-Rhema-Key", token).json(&body).send().await.map_err(|e| format!("Could not reach the host: {e}"))?;
    let status = r.status();
    let v = r.json::<serde_json::Value>().await.unwrap_or_default();
    let text = |k: &str| v.get(k).and_then(|e| e.as_str()).map(String::from);
    if status.is_success() {
        return Ok(text("note"));
    }
    Err(refusal(status.as_u16(), text("error"), text("code").as_deref()))
}

/// Join the host's talk channel (Rhema Comms C3): send this desk's complete WebRTC offer, get the
/// host's answer.
#[tauri::command]
pub async fn join_voice(address: String, token: String, sdp: String) -> Result<String, String> {
    let url = format!("{}/api/v1/voice", base_url(&address)?);
    let r = client(Some(Duration::from_secs(15)))?.post(url).header("X-Rhema-Key", token).json(&serde_json::json!({ "sdp": sdp })).send().await.map_err(|e| format!("Could not reach the host: {e}"))?;
    let ok = r.status().is_success();
    let v = r.json::<serde_json::Value>().await.unwrap_or_default();
    if ok {
        return v.get("sdp").and_then(|s| s.as_str()).map(String::from).ok_or_else(|| "The host sent no answer".into());
    }
    Err(v.get("error").and_then(|e| e.as_str()).map_or_else(|| "The host refused the talk channel".into(), String::from))
}

/// Follow the host's Live State: "join:live" carries each snapshot, "join:state" the connection
/// ("connected", "reconnecting" with the reason, "refused", "stopped"). Reconnects by itself.
#[tauri::command]
pub fn join_connect(app: AppHandle, state: State<'_, JoinRuntime>, address: String, token: String) -> Result<(), String> {
    let host = Host::plain(&address)?;
    let (tx, rx) = watch::channel(false);
    if let Some(old) = state.stop.lock().map_err(|e| e.to_string())?.replace(tx) {
        let _ = old.send(true);
    }
    tauri::async_runtime::spawn(rhema_join::host::follow_live(host, token, rx, move |event, payload| {
        let _ = app.emit(event, payload);
    }));
    Ok(())
}

/// Stop following the host.
#[tauri::command]
pub fn join_disconnect(state: State<'_, JoinRuntime>) -> Result<(), String> {
    if let Some(stop) = state.stop.lock().map_err(|e| e.to_string())?.take() {
        let _ = stop.send(true);
    }
    Ok(())
}

/// The port Rhema Receiver (the Google TV app, #198) listens on for a screen to show.
const TV_PORT: u16 = 8095;

/// A TV's address as shown on its screen; the port may be left out.
fn tv_url(address: &str) -> Result<String, String> {
    let a = address.trim();
    base_url(&if a.contains(':') { a.to_string() } else { format!("{a}:{TV_PORT}") })
}

#[derive(Deserialize)]
struct TvReply {
    ok: bool,
    name: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct TvChallengeReply {
    ok: bool,
    /// 2 from Rhema Receiver 1.3: it takes only the encrypted /show (none before).
    v: Option<u32>,
    y: Option<String>,
    proof: Option<String>,
    error: Option<String>,
}

const OLD_RECEIVER: &str = "Update Rhema Studio Receiver on the TV (1.3 or later): this one cannot take Rhema Studio's secure link, so the feed link was not sent.";
/// Rhema sends a TV only its https link, so the link and the page stay private on the network.
const NO_TLS: &str = "Turn on the secure page in Settings → Remote control (Secure page for phones, https), then stop and start the listener: Rhema Studio sends a TV only its secure link. The feed link was not sent.";
const NOT_THIS_TV: &str = "That code is not the one on this TV's screen, or this is not a real Rhema Studio Receiver. Check the code on the TV and try again; the feed link was not sent.";

fn tv_unreachable(_: reqwest::Error) -> String {
    "Could not reach the TV: is Rhema Studio Receiver open on it, on the same network?".to_string()
}

/// The TV's IPv4 address and port exactly as Rhema reaches it: the TV's proof names this address.
async fn tv_target(address: &str) -> Result<std::net::SocketAddrV4, String> {
    let base = tv_url(address)?;
    let not_found = || format!("No TV found at {}", address.trim());
    let host_port = base.trim_start_matches("http://").to_string();
    let mut found = tokio::net::lookup_host(host_port).await.map_err(|_| not_found())?;
    found.find_map(|a| if let std::net::SocketAddr::V4(v4) = a { Some(v4) } else { None }).ok_or_else(not_found)
}

/// Give a Rhema Receiver a feed to show (#198): its address and the code on its screen, so only
/// someone who can see the TV assigns it. The TV keeps showing it after a restart. The link must be
/// the feed's https one, on this Rhema's https port: the TV opens it only from a computer with this
/// Rhema's certificate.
#[tauri::command]
pub async fn tv_show(http: State<'_, Mutex<super::remote::HttpRuntime>>, address: String, code: String, url: String) -> Result<String, String> {
    let pin = http.lock().map_err(|e| e.to_string())?.tv_pin();
    let fingerprint = secure_feed(&url, pin)?;
    show_on_tv(&address, &code, &url, &fingerprint).await
}

/// The certificate fingerprint to send with a feed link: only for https on the running https port
/// (`pin` is that port and its certificate's fingerprint, None when https is off).
fn secure_feed(url: &str, pin: Option<(u16, String)>) -> Result<String, String> {
    let (port, fingerprint) = pin.ok_or(NO_TLS)?;
    let u = reqwest::Url::parse(url).map_err(|_| NO_TLS)?;
    if u.scheme() != "https" || u.port() != Some(port) || !u.path().starts_with("/feed/") {
        return Err(NO_TLS.into());
    }
    Ok(fingerprint)
}

/// First the code check (`tv_proof`): the link goes only to a TV that proved it shows this code,
/// and travels encrypted with that check's key, with the certificate the TV must see.
async fn show_on_tv(address: &str, code: &str, url: &str, cert_fingerprint: &str) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err(NO_TLS.into());
    }
    let target = tv_target(address).await?.to_string();
    let base = format!("http://{target}");
    // Straight to the TV, never through a proxy: the proof is for the address Rhema reaches.
    let http = reqwest::Client::builder().no_proxy().connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(10)).build().map_err(|e| e.to_string())?;
    let desk = super::tv_proof::Desk::start(code.trim())?;
    let r = http.post(format!("{base}/challenge")).json(&serde_json::json!({ "x": desk.public_hex() })).send().await.map_err(tv_unreachable)?;
    if r.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(OLD_RECEIVER.into());
    }
    let reply: TvChallengeReply = r.json().await.map_err(|e| format!("The TV's answer was not understood: {e}"))?;
    if !reply.ok {
        return Err(reply.error.unwrap_or_else(|| "The TV refused".into()));
    }
    if reply.v.unwrap_or(1) < 2 {
        return Err(OLD_RECEIVER.into());
    }
    let keys = desk.finish(reply.y.as_deref().unwrap_or_default(), &target, reply.proof.as_deref().unwrap_or_default()).ok_or(NOT_THIS_TV)?;
    let sealed = keys.seal(serde_json::json!({ "url": url, "certFingerprint": cert_fingerprint }).to_string().as_bytes())?;
    let r = http
        .post(format!("{base}/show"))
        .json(&sealed)
        .send()
        .await
        .map_err(tv_unreachable)?;
    let reply: TvReply = r.json().await.map_err(|e| format!("The TV's answer was not understood: {e}"))?;
    if reply.ok { Ok(reply.name.unwrap_or_default()) } else { Err(reply.error.unwrap_or_else(|| "The TV refused".into())) }
}

#[derive(Deserialize)]
struct TvStatusReply {
    ok: bool,
    name: Option<String>,
    feed: Option<String>,
    problem: Option<String>,
    error: Option<String>,
}

/// What a Rhema Receiver says it shows (#213 Check TV): the feed's id, never its secret link.
#[derive(Serialize, Debug, PartialEq)]
pub struct TvStatus {
    name: String,
    feed: Option<String>,
    problem: Option<String>,
}

/// A receiver's answer in plain words; a receiver before 1.1 has no status to give (404).
fn tv_status_from(reply: TvStatusReply, not_found: bool) -> Result<TvStatus, String> {
    if reply.ok {
        Ok(TvStatus { name: reply.name.unwrap_or_default(), feed: reply.feed.filter(|f| !f.is_empty()), problem: reply.problem.filter(|p| !p.is_empty()) })
    } else if not_found {
        Err("This TV's Rhema Studio Receiver is too old to be checked: install version 1.1 or newer on it.".into())
    } else {
        Err(reply.error.unwrap_or_else(|| "The TV did not say".into()))
    }
}

/// Ask a Rhema Receiver what it is showing (#213): its name, the feed and any problem on its screen.
#[tauri::command]
pub async fn tv_status(address: String) -> Result<TvStatus, String> {
    let r = client(Some(Duration::from_secs(5)))?
        .get(format!("{}/status", tv_url(&address)?))
        .send()
        .await
        .map_err(|_| "Could not reach the TV: is it on, with Rhema Studio Receiver open, on the same network?".to_string())?;
    let not_found = r.status() == reqwest::StatusCode::NOT_FOUND;
    let reply: TvStatusReply = r.json().await.map_err(|e| format!("The TV's answer was not understood: {e}"))?;
    tv_status_from(reply, not_found)
}

/// What Rhema Receiver calls itself on the network (#198), so Rhema can find TVs by themselves.
const TV_SERVICE: &str = "_rhema-tv._tcp.local.";

/// The TV's own name: its service name without the service type and the " · Rhema" the receiver adds
/// ("Hall TV · Rhema._rhema-tv._tcp.local." → "Hall TV"). Android TV already announces the plain name
/// for its own remote service and refuses a second service with the same name.
fn tv_name(fullname: &str) -> String {
    let name = fullname.strip_suffix(TV_SERVICE).unwrap_or(fullname).trim_end_matches('.');
    name.strip_suffix(" · Rhema").unwrap_or(name).to_string()
}

/// The TVs a search heard: only those on Rhema Receiver's port.
fn found_tvs(seen: BTreeMap<String, (u16, Vec<Ipv4Addr>)>) -> Vec<Found> {
    found(seen, |port| port == TV_PORT, tv_name)
}

/// Listen for Rhema Receivers for a moment (blocking; run off the async threads).
fn browse_tvs(window: Duration) -> Result<Vec<Found>, String> {
    browse(TV_SERVICE, window, "TVs").map(found_tvs)
}

/// Find the Rhema Receivers on this network (#198), so nobody has to type a TV's address. Takes
/// about two and a half seconds; the code on the TV's screen is still needed to show anything.
#[tauri::command]
pub async fn tv_discover() -> Result<Vec<Found>, String> {
    tokio::task::spawn_blocking(|| browse_tvs(Duration::from_millis(2500)))
        .await
        .map_err(|e| format!("Could not look for TVs on the network: {e}"))?
}

/// Find the Rhema hosts on this network (#197), so a joining computer can pick one instead of
/// typing its address. Takes about two and a half seconds. Only the address comes from here:
/// pairing still needs the code on the host's screen, and the host checks it.
#[tauri::command]
pub async fn host_discover() -> Result<Vec<Found>, String> {
    rhema_join::discover::discover_hosts().await
}

#[cfg(test)]
mod tests {
    use super::*;
    // Moved to the shared crate with Rhema Studio Companion (#209); still checked here as this app uses them.
    use rhema_join::discover::{found_hosts, lan_ip as tv_ip};
    use rhema_join::host::sse_data;

    #[test]
    fn a_tv_says_which_feed_it_shows_and_an_old_one_says_it_cannot() {
        let reply = |v: serde_json::Value| serde_json::from_value::<TvStatusReply>(v).unwrap();
        assert_eq!(
            tv_status_from(reply(serde_json::json!({ "ok": true, "name": "Foyer TV", "feed": "foyer" })), false),
            Ok(TvStatus { name: "Foyer TV".into(), feed: Some("foyer".into()), problem: None })
        );
        assert_eq!(tv_status_from(reply(serde_json::json!({ "ok": true, "name": "TV" })), false).unwrap().feed, None, "nothing shown yet");
        let old = tv_status_from(reply(serde_json::json!({ "ok": false, "error": "Rhema Receiver only takes POST /show" })), true).unwrap_err();
        assert!(old.contains("1.1"), "{old}");
    }

    #[test]
    fn a_tv_address_may_leave_out_the_port() {
        assert_eq!(tv_url("192.168.3.37").unwrap(), "http://192.168.3.37:8095");
        assert_eq!(tv_url(" 192.168.3.37:9000 ").unwrap(), "http://192.168.3.37:9000");
        assert!(tv_url("http://x").is_err());
    }

    #[test]
    fn addresses_are_host_and_port_only() {
        assert_eq!(base_url("192.168.1.20:8080").unwrap(), "http://192.168.1.20:8080");
        assert_eq!(base_url(" studio.local:9000 ").unwrap(), "http://studio.local:9000");
        for bad in ["192.168.1.20", "http://x:80", "x:80/path", ":8080", "x:0", "x:port", "a b:80"] {
            assert!(base_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_command_carries_its_service_when_known() {
        let tagged = command_body(serde_json::json!({ "command": "event_next" }), Some("s1".into()));
        assert_eq!((tagged["command"].as_str(), tagged["service"].as_str()), (Some("event_next"), Some("s1")));
        assert_eq!(tagged["id"].as_str().map(str::len), Some(36));
        let untagged = command_body(serde_json::json!({ "command": "event_next" }), None);
        assert!(untagged.get("service").is_none(), "an unknown service is left out, as before");
        assert_eq!(command_body(serde_json::json!({ "command": "next" }), Some(String::new()))["service"], "", "no service open is said as \"\"");
    }

    #[test]
    fn paused_and_other_service_refusals_are_marked_for_the_desk() {
        assert_eq!(refusal(423, Some("The main desk has taken back control".into()), None), "paused: The main desk has taken back control");
        assert_eq!(refusal(409, Some("That desk is looking at a different service; it will refresh".into()), Some("other-service")), "other-service: That desk is looking at a different service; it will refresh");
        assert_eq!(refusal(409, Some("That desk is looking at a different service; it will refresh".into()), None), "other-service: That desk is looking at a different service; it will refresh", "an older host");
        assert_eq!(refusal(409, Some("Someone changed this first \u{2014} look again".into()), Some("stale")), "stale: Someone changed this first \u{2014} look again");
        assert_eq!(refusal(403, Some("this device keeps time".into()), None), "this device keeps time");
        assert_eq!(refusal(500, None, None), "The host refused");
    }

    #[test]
    fn only_live_events_with_data_are_taken() {
        assert_eq!(sse_data("event: live\ndata: {\"v\":1}\n\n").as_deref(), Some("{\"v\":1}"));
        assert_eq!(sse_data("event: live\ndata: line 1\ndata: line 2\n\n").as_deref(), Some("line 1\nline 2"));
        assert_eq!(sse_data(": keep-alive\n\n"), None);
        assert_eq!(sse_data("event: other\ndata: x\n\n"), None);
    }

    #[test]
    fn tv_discovery_lists_named_tvs_with_their_lan_address() {
        let ip = |s: &str| s.parse::<Ipv4Addr>().unwrap();
        let mut seen = BTreeMap::new();
        seen.insert("Sanctuary TV._rhema-tv._tcp.local.".to_string(), (8095, vec![ip("169.254.3.4"), ip("192.168.3.37")]));
        seen.insert("hall.tv._rhema-tv._tcp.local.".to_string(), (8095, vec![ip("10.0.0.9")]));
        seen.insert("Loopback._rhema-tv._tcp.local.".to_string(), (8095, vec![ip("127.0.0.1")]));
        seen.insert("Public._rhema-tv._tcp.local.".to_string(), (8095, vec![ip("8.8.8.8")]));
        seen.insert("Same TV again._rhema-tv._tcp.local.".to_string(), (8095, vec![ip("192.168.3.37")]));
        seen.insert("Other port._rhema-tv._tcp.local.".to_string(), (9000, vec![ip("192.168.3.40")]));
        seen.insert("No port._rhema-tv._tcp.local.".to_string(), (0, vec![ip("192.168.3.41")]));
        seen.insert("Link-local only._rhema-tv._tcp.local.".to_string(), (8095, vec![ip("169.254.7.7")]));
        assert_eq!(
            found_tvs(seen),
            vec![
                Found { name: "hall.tv".into(), address: "10.0.0.9:8095".into() },
                Found { name: "Link-local only".into(), address: "169.254.7.7:8095".into() },
                Found { name: "Same TV again".into(), address: "192.168.3.37:8095".into() },
            ]
        );
    }

    #[test]
    fn tv_discovery_keeps_only_private_then_link_local_addresses() {
        let ip = |s: &str| s.parse::<Ipv4Addr>().unwrap();
        assert_eq!(tv_ip(&[ip("8.8.8.8"), ip("169.254.1.1"), ip("192.168.1.9")]), Some(ip("192.168.1.9")));
        assert_eq!(tv_ip(&[ip("8.8.8.8"), ip("169.254.1.1")]), Some(ip("169.254.1.1")));
        assert_eq!(tv_ip(&[ip("8.8.8.8")]), None);
        assert_eq!(tv_ip(&[ip("127.0.0.1"), ip("0.0.0.0"), ip("224.0.0.251")]), None);
        assert_eq!(tv_ip(&[]), None);
    }

    /// A pretend receiver on 127.0.0.1 for `show_on_tv`: answers /challenge as told and records each
    /// request (path and body), so a test can see whether the feed link ever reached it.
    async fn pretend_tv(answer: fn(&str, &str) -> (u16, serde_json::Value)) -> (String, std::sync::Arc<Mutex<Vec<(String, String)>>>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap().to_string();
        let seen = std::sync::Arc::new(Mutex::new(Vec::new()));
        let (log, me) = (seen.clone(), address.clone());
        tokio::spawn(async move {
            while let Ok((mut c, _)) = listener.accept().await {
                let mut buf = Vec::new();
                let mut chunk = [0u8; 4096];
                let (head, body) = loop {
                    let n = c.read(&mut chunk).await.unwrap();
                    buf.extend_from_slice(&chunk[..n]);
                    let text = String::from_utf8_lossy(&buf).to_string();
                    if let Some((head, body)) = text.split_once("\r\n\r\n") {
                        let len = head.lines().find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap())).unwrap_or(0);
                        if body.len() >= len || n == 0 {
                            break (head.to_string(), body.to_string());
                        }
                    }
                };
                let path = head.split(' ').nth(1).unwrap_or("").to_string();
                log.lock().unwrap().push((path.clone(), body.clone()));
                let (status, reply) = if path == "/challenge" { answer(&body, &me) } else { (200, serde_json::json!({ "ok": true, "name": "Hall TV" })) };
                let out = reply.to_string();
                let _ = c.write_all(format!("HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{out}", out.len()).as_bytes()).await;
            }
        });
        (address, seen)
    }

    fn tv_answers_with(code: &'static str) -> fn(&str, &str) -> (u16, serde_json::Value) {
        fn answer(code: &str, body: &str, me: &str) -> (u16, serde_json::Value) {
            let x = serde_json::from_str::<serde_json::Value>(body).unwrap()["x"].as_str().unwrap().to_string();
            let (y, proof, _) = super::super::tv_proof::tests::tv_answer(&x, code, me, &tv_y()).unwrap();
            (200, serde_json::json!({ "ok": true, "v": 2, "y": y, "proof": proof }))
        }
        match code {
            "111111" => |b, me| answer("111111", b, me),
            _ => |b, me| answer("999999", b, me),
        }
    }

    /// The pretend TV's fixed exponent, so a test can work out the key it used.
    fn tv_y() -> num_bigint::BigUint {
        num_bigint::BigUint::from(123_456_789u64) << 300usize
    }

    const FEED: &str = "https://192.168.3.10:8081/feed/abc?k=secret";
    const PIN: &str = "abecce707af4a66a8aa18ce9624ebead97a8f362335dd688e9d5899af9428a19";

    #[tokio::test]
    async fn tv_show_sends_the_link_only_after_the_tv_proves_the_code() {
        let (address, seen) = pretend_tv(tv_answers_with("111111")).await;
        assert_eq!(show_on_tv(&address, " 111111 ", FEED, PIN).await.unwrap(), "Hall TV");
        let seen = seen.lock().unwrap().clone();
        assert_eq!(seen.iter().map(|(p, _)| p.as_str()).collect::<Vec<_>>(), ["/challenge", "/show"]);
        assert!(!seen[0].1.contains("111111"), "the code itself is never sent");
        let show: serde_json::Value = serde_json::from_str(&seen[1].1).unwrap();
        assert!(show.get("url").is_none() && show.get("code").is_none() && !seen[1].1.contains("192.168"), "nothing readable: {show}");
        // The TV opens it with the key of that exchange: the link and the certificate to insist on.
        let x = serde_json::from_str::<serde_json::Value>(&seen[0].1).unwrap()["x"].as_str().unwrap().to_string();
        let (_, _, enc) = super::super::tv_proof::tests::tv_answer(&x, "111111", &address, &tv_y()).unwrap();
        let opened = super::super::tv_proof::tests::tv_open(&enc, show["nonce"].as_str().unwrap(), show["data"].as_str().unwrap()).expect("sealed for this TV");
        assert_eq!(serde_json::from_str::<serde_json::Value>(&opened).unwrap(), serde_json::json!({ "url": FEED, "certFingerprint": PIN }));
    }

    #[tokio::test]
    async fn tv_show_sends_only_a_secure_link() {
        let (address, seen) = pretend_tv(tv_answers_with("111111")).await;
        assert_eq!(show_on_tv(&address, "111111", "http://192.168.3.10:8080/feed/abc?k=secret", PIN).await.unwrap_err(), NO_TLS);
        assert!(seen.lock().unwrap().is_empty(), "the TV was not even asked");
        // The command's check: https on the running https port, for a feed; nothing when https is off.
        let pin = || Some((8081u16, PIN.to_string()));
        assert_eq!(secure_feed(FEED, pin()).unwrap(), PIN);
        assert_eq!(secure_feed(FEED, None).unwrap_err(), NO_TLS);
        assert_eq!(secure_feed("http://192.168.3.10:8081/feed/abc?k=secret", pin()).unwrap_err(), NO_TLS);
        assert_eq!(secure_feed("https://192.168.3.10:9443/feed/abc?k=secret", pin()).unwrap_err(), NO_TLS);
        assert_eq!(secure_feed("https://192.168.3.10:8081/remote", pin()).unwrap_err(), NO_TLS);
        assert_eq!(secure_feed("not a link", pin()).unwrap_err(), NO_TLS);
        assert!(NO_TLS.starts_with("Turn on the secure page in Settings → Remote control"));
    }

    #[tokio::test]
    async fn tv_show_never_sends_the_link_when_the_proof_fails() {
        // A TV with another code, or a pretend TV that accepts anything.
        let (address, seen) = pretend_tv(tv_answers_with("999999")).await;
        assert_eq!(show_on_tv(&address, "111111", FEED, PIN).await.unwrap_err(), NOT_THIS_TV);
        let (address2, seen2) = pretend_tv(|_, _| (200, serde_json::json!({ "ok": true, "v": 2, "y": "2", "proof": "00" }))).await;
        assert_eq!(show_on_tv(&address2, "111111", FEED, PIN).await.unwrap_err(), NOT_THIS_TV);
        let (address3, seen3) = pretend_tv(|_, _| (200, serde_json::json!({ "ok": true, "v": 2 }))).await;
        assert_eq!(show_on_tv(&address3, "111111", FEED, PIN).await.unwrap_err(), NOT_THIS_TV);
        for log in [seen, seen2, seen3] {
            let log = log.lock().unwrap();
            assert_eq!(log.iter().map(|(p, _)| p.as_str()).collect::<Vec<_>>(), ["/challenge"]);
            assert!(log.iter().all(|(_, body)| !body.contains("/feed/")), "the link never left Rhema");
        }
    }

    #[tokio::test]
    async fn tv_show_refuses_an_old_receiver_without_the_code_check() {
        let (address, seen) = pretend_tv(|_, _| (404, serde_json::json!({ "ok": false, "error": "Rhema Receiver only takes POST /show and GET /status" }))).await;
        assert_eq!(show_on_tv(&address, "111111", FEED, PIN).await.unwrap_err(), OLD_RECEIVER);
        assert_eq!(seen.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn tv_show_refuses_receiver_1_2_which_takes_the_link_in_clear_text() {
        // 1.2 does the code check but answers without "v": the link is never sent to it.
        fn answer_1_2(body: &str, me: &str) -> (u16, serde_json::Value) {
            let x = serde_json::from_str::<serde_json::Value>(body).unwrap()["x"].as_str().unwrap().to_string();
            let (y, proof, _) = super::super::tv_proof::tests::tv_answer(&x, "111111", me, &tv_y()).unwrap();
            (200, serde_json::json!({ "ok": true, "y": y, "proof": proof }))
        }
        let (address, seen) = pretend_tv(answer_1_2).await;
        assert_eq!(show_on_tv(&address, "111111", FEED, PIN).await.unwrap_err(), OLD_RECEIVER);
        assert_eq!(seen.lock().unwrap().iter().map(|(p, _)| p.clone()).collect::<Vec<_>>(), ["/challenge"]);
    }

    #[test]
    fn host_discovery_lists_hosts_on_any_port_with_their_lan_address() {
        let ip = |s: &str| s.parse::<Ipv4Addr>().unwrap();
        let mut seen = BTreeMap::new();
        seen.insert("CAC Ibadan._rhema-host._tcp.local.".to_string(), (8080, vec![ip("169.254.3.4"), ip("192.168.1.20")]));
        seen.insert("Rhema · Studio-Mac._rhema-host._tcp.local.".to_string(), (9000, vec![ip("10.0.0.9")]));
        seen.insert("St\\. Mary's._rhema-host._tcp.local.".to_string(), (8080, vec![ip("172.16.0.5")]));
        seen.insert("Loopback._rhema-host._tcp.local.".to_string(), (8080, vec![ip("127.0.0.1")]));
        seen.insert("Public._rhema-host._tcp.local.".to_string(), (8080, vec![ip("8.8.8.8")]));
        seen.insert("Same host again._rhema-host._tcp.local.".to_string(), (8080, vec![ip("192.168.1.20")]));
        seen.insert("No port._rhema-host._tcp.local.".to_string(), (0, vec![ip("192.168.1.41")]));
        assert_eq!(
            found_hosts(seen),
            vec![
                Found { name: "CAC Ibadan".into(), address: "192.168.1.20:8080".into() },
                Found { name: "Rhema · Studio-Mac".into(), address: "10.0.0.9:9000".into() },
                Found { name: "St. Mary's".into(), address: "172.16.0.5:8080".into() },
            ]
        );
    }

    /// Real network (multicast on this computer): an announced host is found by host_discover's
    /// search, then gone once it stops. Run by hand: `cargo test ... -- --ignored announced_host`.
    #[test]
    #[ignore = "uses the real network"]
    fn announced_host_is_found_then_gone() {
        let plan = super::super::host_advert::host_advert("0.0.0.0", 18_080, Some(18_081), "Rhema Test Church", "test").unwrap();
        let ad = super::super::host_advert::start(plan).unwrap();
        let seen = browse(super::super::host_advert::HOST_SERVICE, Duration::from_millis(3000), "hosts").unwrap();
        let hosts = found_hosts(seen);
        assert!(hosts.iter().any(|h| h.name == "Rhema Test Church" && h.address.ends_with(":18080")), "{hosts:?}");
        super::super::host_advert::stop(ad);
        let hosts = found_hosts(browse(super::super::host_advert::HOST_SERVICE, Duration::from_millis(2500), "hosts").unwrap());
        assert!(!hosts.iter().any(|h| h.name == "Rhema Test Church"), "{hosts:?}");
    }

    #[test]
    fn tv_discovery_names_come_from_the_service_name() {
        assert_eq!(tv_name("Living Room._rhema-tv._tcp.local."), "Living Room");
        assert_eq!(tv_name("odd name"), "odd name");
        assert_eq!(tv_name("Bedroom TV · Rhema._rhema-tv._tcp.local."), "Bedroom TV");
    }
}
