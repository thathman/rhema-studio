//! Joining another Rhema on the church network (Host/Join, ARCH-004): pair with its code, follow
//! its Live State, and send the commands this computer's key allows. The host stays in charge:
//! everything here goes through its ordinary command API, which checks the key and its role.

use std::collections::BTreeMap;
use std::net::Ipv4Addr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::watch;

/// The one connection to a host, if any.
#[derive(Default)]
pub struct JoinRuntime {
    stop: Mutex<Option<watch::Sender<bool>>>,
}

/// `host:port` only: a name or address and a port, no scheme or path.
fn base_url(address: &str) -> Result<String, String> {
    let a = address.trim();
    let (host, port) = a.rsplit_once(':').ok_or("Give the host's address and port, e.g. 192.168.1.20:8080")?;
    let port: u16 = port.parse().map_err(|_| "The port must be a number, e.g. 8080")?;
    let host_ok = !host.is_empty() && host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '[' | ']' | ':'));
    if !host_ok || port == 0 {
        return Err("That is not an address and port, e.g. 192.168.1.20:8080".into());
    }
    Ok(format!("http://{host}:{port}"))
}

fn client(timeout: Option<Duration>) -> Result<reqwest::Client, String> {
    let mut b = reqwest::Client::builder().connect_timeout(Duration::from_secs(5));
    if let Some(t) = timeout {
        b = b.timeout(t);
    }
    b.build().map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct PairReply {
    success: bool,
    token: Option<String>,
    error: Option<String>,
}

/// Pair with the host while its pairing window is open; the token comes back once.
#[tauri::command]
pub async fn join_pair(address: String, code: String, name: String) -> Result<String, String> {
    let url = format!("{}/api/v1/pair", base_url(&address)?);
    let reply: PairReply = client(Some(Duration::from_secs(10)))?
        .post(url)
        .json(&serde_json::json!({ "code": code.trim(), "name": name.trim() }))
        .send()
        .await
        .map_err(|e| format!("Could not reach the host: {e}"))?
        .json()
        .await
        .map_err(|e| format!("The host's answer was not understood: {e}"))?;
    match (reply.success, reply.token) {
        (true, Some(token)) => Ok(token),
        _ => Err(reply.error.unwrap_or_else(|| "The host refused".into())),
    }
}

/// The name and role the host gives this computer's key.
#[tauri::command]
pub async fn join_me(address: String, token: String) -> Result<serde_json::Value, String> {
    let url = format!("{}/api/v1/me", base_url(&address)?);
    let r = client(Some(Duration::from_secs(10)))?.get(url).header("X-Rhema-Key", token).send().await.map_err(|e| format!("Could not reach the host: {e}"))?;
    if !r.status().is_success() {
        return Err(if r.status().as_u16() == 401 { "The host no longer knows this computer: pair again".into() } else { format!("The host answered {}", r.status()) });
    }
    r.json().await.map_err(|e| e.to_string())
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

/// What the desk is told when the host refuses. Two refusals start with a word the desk acts on:
/// "paused:" (the main desk has taken back control, #243) and "other-service:" (the desk is looking
/// at a different service and refreshes, #246 C16).
fn refusal(status: u16, error: Option<String>) -> String {
    let msg = error.unwrap_or_else(|| "The host refused".into());
    match status {
        423 => format!("paused: {msg}"),
        409 => format!("other-service: {msg}"),
        _ => msg,
    }
}

/// Send one command (the host checks the key's role and the service).
#[tauri::command]
pub async fn join_command(address: String, token: String, command: serde_json::Value, service: Option<String>) -> Result<(), String> {
    let url = format!("{}/api/v1/command", base_url(&address)?);
    let body = command_body(command, service);
    let r = client(Some(Duration::from_secs(10)))?.post(url).header("X-Rhema-Key", token).json(&body).send().await.map_err(|e| format!("Could not reach the host: {e}"))?;
    if r.status().is_success() {
        return Ok(());
    }
    let status = r.status().as_u16();
    let msg = r.json::<serde_json::Value>().await.ok().and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from));
    Err(refusal(status, msg))
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
    let url = format!("{}/api/v1/live/events", base_url(&address)?);
    let (tx, mut rx) = watch::channel(false);
    if let Some(old) = state.stop.lock().map_err(|e| e.to_string())?.replace(tx) {
        let _ = old.send(true);
    }
    tauri::async_runtime::spawn(async move {
        let mut wait = 1u64;
        loop {
            if *rx.borrow() {
                break;
            }
            let result = follow(&app, &url, &token, &mut rx).await;
            if *rx.borrow() {
                break;
            }
            match result {
                Err(Refused(status)) => {
                    let _ = app.emit("join:state", serde_json::json!({ "state": "refused", "error": format!("The host refused this computer ({status}): pair again") }).to_string());
                    return;
                }
                Ok(()) | Err(Lost(_)) => {
                    let reason = match result { Err(Lost(e)) => e, _ => "the host closed the connection".into() };
                    let _ = app.emit("join:state", serde_json::json!({ "state": "reconnecting", "error": reason }).to_string());
                }
            }
            tokio::select! {
                () = tokio::time::sleep(Duration::from_secs(wait)) => {}
                _ = rx.changed() => {}
            }
            wait = (wait * 2).min(10);
        }
        let _ = app.emit("join:state", serde_json::json!({ "state": "stopped" }).to_string());
    });
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

enum FollowError {
    Refused(u16),
    Lost(String),
}
use FollowError::{Lost, Refused};

async fn follow(app: &AppHandle, url: &str, token: &str, stop: &mut watch::Receiver<bool>) -> Result<(), FollowError> {
    let r = client(None).map_err(Lost)?.get(url).header("X-Rhema-Key", token).header("Accept", "text/event-stream").send().await.map_err(|e| Lost(e.to_string()))?;
    let status = r.status().as_u16();
    if status == 401 || status == 403 {
        return Err(Refused(status));
    }
    if !r.status().is_success() {
        return Err(Lost(format!("the host answered {status}")));
    }
    let _ = app.emit("join:state", serde_json::json!({ "state": "connected" }).to_string());
    let mut body = r.bytes_stream();
    let mut buf = String::new();
    loop {
        let chunk = tokio::select! {
            c = body.next() => c,
            _ = stop.changed() => return Ok(()),
        };
        let Some(chunk) = chunk else { return Ok(()) };
        buf.push_str(&String::from_utf8_lossy(&chunk.map_err(|e| Lost(e.to_string()))?));
        // A message ends with a blank line; keep any unfinished one.
        while let Some(end) = buf.find("\n\n") {
            let message: String = buf.drain(..end + 2).collect();
            if let Some(data) = sse_data(&message) {
                let _ = app.emit("join:live", data);
            }
        }
        // A host that sends garbage without blank lines must not grow this without bound.
        if buf.len() > 4 * 1024 * 1024 {
            return Err(Lost("the host sent a message too large".into()));
        }
    }
}

/// The data of one server-sent event named "live" (multi-line data joined), or None.
fn sse_data(message: &str) -> Option<String> {
    let mut event = "message";
    let mut data: Vec<&str> = Vec::new();
    for line in message.lines() {
        if let Some(v) = line.strip_prefix("event:") {
            event = v.trim();
        } else if let Some(v) = line.strip_prefix("data:") {
            data.push(v.strip_prefix(' ').unwrap_or(v));
        }
    }
    (event == "live" && !data.is_empty()).then(|| data.join("\n"))
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

/// Give a Rhema Receiver a feed to show (#198): its address and the code on its screen, so only
/// someone who can see the TV assigns it. The TV keeps showing it after a restart.
#[tauri::command]
pub async fn tv_show(address: String, code: String, url: String) -> Result<String, String> {
    let r = client(Some(Duration::from_secs(10)))?
        .post(format!("{}/show", tv_url(&address)?))
        .json(&serde_json::json!({ "code": code.trim(), "url": url }))
        .send()
        .await
        .map_err(|_| "Could not reach the TV: is Rhema Receiver open on it, on the same network?".to_string())?;
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
        Err("This TV's Rhema Receiver is too old to be checked: install version 1.1 or newer on it.".into())
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
        .map_err(|_| "Could not reach the TV: is it on, with Rhema Receiver open, on the same network?".to_string())?;
    let not_found = r.status() == reqwest::StatusCode::NOT_FOUND;
    let reply: TvStatusReply = r.json().await.map_err(|e| format!("The TV's answer was not understood: {e}"))?;
    tv_status_from(reply, not_found)
}

/// What Rhema Receiver calls itself on the network (#198), so Rhema can find TVs by themselves.
const TV_SERVICE: &str = "_rhema-tv._tcp.local.";

/// A Rhema Receiver found on the network: the TV's name and the address to send a screen to.
#[derive(Serialize, Debug, PartialEq)]
pub struct FoundTv {
    name: String,
    address: String,
}

/// The TV's own name: its service name without the service type ("Hall TV._rhema-tv._tcp.local.").
fn tv_name(fullname: &str) -> String {
    fullname.strip_suffix(TV_SERVICE).unwrap_or(fullname).trim_end_matches('.').to_string()
}

/// The address people would type: a private LAN address first, never loopback or link-local.
fn tv_ip(ips: &[Ipv4Addr]) -> Option<Ipv4Addr> {
    let usable = ips.iter().filter(|ip| !ip.is_loopback() && !ip.is_link_local() && !ip.is_unspecified() && !ip.is_multicast());
    usable.clone().filter(|ip| ip.is_private()).min().or_else(|| usable.min()).copied()
}

/// What the search heard (service name → port and IPv4 addresses), as a list sorted by name.
/// A TV with no usable IPv4 address is left out; the same address heard twice is listed once.
fn found_tvs(seen: BTreeMap<String, (u16, Vec<Ipv4Addr>)>) -> Vec<FoundTv> {
    let mut tvs: Vec<FoundTv> = seen
        .into_iter()
        .filter(|(_, (port, _))| *port != 0)
        .filter_map(|(full, (port, ips))| tv_ip(&ips).map(|ip| FoundTv { name: tv_name(&full), address: format!("{ip}:{port}") }))
        .collect();
    tvs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then_with(|| a.address.cmp(&b.address)));
    let mut addresses = std::collections::HashSet::new();
    tvs.retain(|tv| addresses.insert(tv.address.clone()));
    tvs
}

/// Listen for Rhema Receivers for a moment (blocking; run off the async threads).
fn browse_tvs(window: Duration) -> Result<Vec<FoundTv>, String> {
    let daemon = mdns_sd::ServiceDaemon::new().map_err(|e| format!("Could not look for TVs on the network: {e}"))?;
    let events = daemon.browse(TV_SERVICE).map_err(|e| format!("Could not look for TVs on the network: {e}"))?;
    let deadline = Instant::now() + window;
    let mut seen = BTreeMap::new();
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        match events.recv_timeout(left) {
            Ok(mdns_sd::ServiceEvent::ServiceResolved(s)) => {
                seen.insert(s.fullname.clone(), (s.port, s.get_addresses_v4().into_iter().collect()));
            }
            Ok(mdns_sd::ServiceEvent::ServiceRemoved(_, full)) => {
                seen.remove(&full);
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    let _ = daemon.shutdown();
    Ok(found_tvs(seen))
}

/// Find the Rhema Receivers on this network (#198), so nobody has to type a TV's address. Takes
/// about two and a half seconds; the code on the TV's screen is still needed to show anything.
#[tauri::command]
pub async fn tv_discover() -> Result<Vec<FoundTv>, String> {
    tokio::task::spawn_blocking(|| browse_tvs(Duration::from_millis(2500)))
        .await
        .map_err(|e| format!("Could not look for TVs on the network: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(refusal(423, Some("The main desk has taken back control".into())), "paused: The main desk has taken back control");
        assert_eq!(refusal(409, Some("That desk is looking at a different service; it will refresh".into())), "other-service: That desk is looking at a different service; it will refresh");
        assert_eq!(refusal(403, Some("this device keeps time".into())), "this device keeps time");
        assert_eq!(refusal(500, None), "The host refused");
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
        seen.insert("No address._rhema-tv._tcp.local.".to_string(), (8095, vec![ip("127.0.0.1")]));
        seen.insert("Same TV again._rhema-tv._tcp.local.".to_string(), (8095, vec![ip("192.168.3.37")]));
        seen.insert("No port._rhema-tv._tcp.local.".to_string(), (0, vec![ip("192.168.3.40")]));
        assert_eq!(
            found_tvs(seen),
            vec![
                FoundTv { name: "hall.tv".into(), address: "10.0.0.9:8095".into() },
                FoundTv { name: "Same TV again".into(), address: "192.168.3.37:8095".into() },
            ]
        );
    }

    #[test]
    fn tv_discovery_prefers_a_private_address_and_keeps_public_ones_as_a_last_resort() {
        let ip = |s: &str| s.parse::<Ipv4Addr>().unwrap();
        assert_eq!(tv_ip(&[ip("8.8.8.8"), ip("192.168.1.9")]), Some(ip("192.168.1.9")));
        assert_eq!(tv_ip(&[ip("8.8.8.8")]), Some(ip("8.8.8.8")));
        assert_eq!(tv_ip(&[ip("127.0.0.1"), ip("169.254.1.1"), ip("0.0.0.0")]), None);
        assert_eq!(tv_ip(&[]), None);
    }

    #[test]
    fn tv_discovery_names_come_from_the_service_name() {
        assert_eq!(tv_name("Living Room._rhema-tv._tcp.local."), "Living Room");
        assert_eq!(tv_name("odd name"), "odd name");
    }
}
