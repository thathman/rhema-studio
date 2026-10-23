//! Joining another Rhema on the church network (Host/Join, ARCH-004): pair with its code, follow
//! its Live State, and send the commands this computer's key allows. The host stays in charge:
//! everything here goes through its ordinary command API, which checks the key and its role.

use std::sync::Mutex;
use std::time::Duration;

use futures_util::StreamExt;
use serde::Deserialize;
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

/// Send one command (the host checks the key's role); `id` makes a retry harmless.
#[tauri::command]
pub async fn join_command(address: String, token: String, command: serde_json::Value) -> Result<(), String> {
    let url = format!("{}/api/v1/command", base_url(&address)?);
    let mut body = command;
    if let Some(o) = body.as_object_mut() {
        o.insert("id".into(), serde_json::Value::String(uuid::Uuid::new_v4().to_string()));
    }
    let r = client(Some(Duration::from_secs(10)))?.post(url).header("X-Rhema-Key", token).json(&body).send().await.map_err(|e| format!("Could not reach the host: {e}"))?;
    if r.status().is_success() {
        return Ok(());
    }
    let msg = r.json::<serde_json::Value>().await.ok().and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from));
    Err(msg.unwrap_or_else(|| "The host refused".into()))
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

#[cfg(test)]
mod tests {
    use super::*;

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
    fn only_live_events_with_data_are_taken() {
        assert_eq!(sse_data("event: live\ndata: {\"v\":1}\n\n").as_deref(), Some("{\"v\":1}"));
        assert_eq!(sse_data("event: live\ndata: line 1\ndata: line 2\n\n").as_deref(), Some("line 1\nline 2"));
        assert_eq!(sse_data(": keep-alive\n\n"), None);
        assert_eq!(sse_data("event: other\ndata: x\n\n"), None);
    }
}
