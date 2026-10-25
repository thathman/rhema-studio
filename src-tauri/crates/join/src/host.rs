//! Talking to a host: pair with its code, ask what this computer's key may know, follow its Live
//! State. The host stays in charge: everything goes through its ordinary API, which checks the key
//! and its role.

use std::time::Duration;

use futures_util::StreamExt;
use serde::Deserialize;
use tokio::sync::watch;

/// `host:port` only: a name or address and a port, no scheme or path.
pub fn base_url(address: &str) -> Result<String, String> {
    let a = address.trim();
    let (host, port) = a.rsplit_once(':').ok_or("Give the host's address and port, e.g. 192.168.1.20:8080")?;
    let port: u16 = port.parse().map_err(|_| "The port must be a number, e.g. 8080")?;
    let host_ok = !host.is_empty() && host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '[' | ']' | ':'));
    if !host_ok || port == 0 {
        return Err("That is not an address and port, e.g. 192.168.1.20:8080".into());
    }
    Ok(format!("http://{host}:{port}"))
}

/// A plain http client: a short wait to connect, and `timeout` for the whole request when given.
pub fn client(timeout: Option<Duration>) -> Result<reqwest::Client, String> {
    let mut b = reqwest::Client::builder().connect_timeout(Duration::from_secs(5));
    if let Some(t) = timeout {
        b = b.timeout(t);
    }
    b.build().map_err(|e| e.to_string())
}

/// A host to talk to: plain http (Rhema), or https with the host's certificate pinned (Rhema
/// Companion, `pinned`).
#[derive(Clone, Debug)]
pub struct Host {
    base: String,
    #[cfg(feature = "pinned")]
    tls: Option<std::sync::Arc<rustls::ClientConfig>>,
}

impl Host {
    /// The host at `address` (host:port) over plain http.
    pub fn plain(address: &str) -> Result<Self, String> {
        Ok(Self {
            base: base_url(address)?,
            #[cfg(feature = "pinned")]
            tls: None,
        })
    }

    /// The host at `address`'s https port, accepting only a certificate the given TLS settings accept.
    #[cfg(feature = "pinned")]
    pub(crate) fn https(address: &str, tls_port: u16, tls: rustls::ClientConfig) -> Result<Self, String> {
        let plain = base_url(address)?;
        let host = plain.trim_start_matches("http://").rsplit_once(':').map_or("", |(h, _)| h);
        Ok(Self { base: format!("https://{host}:{tls_port}"), tls: Some(std::sync::Arc::new(tls)) })
    }

    /// Whether this host is reached over https with its certificate pinned.
    pub fn is_secure(&self) -> bool {
        self.base.starts_with("https://")
    }

    /// The full address of one of the host's pages ("/api/v1/me").
    pub fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base)
    }

    /// A client for this host (see `client`).
    pub fn client(&self, timeout: Option<Duration>) -> Result<reqwest::Client, String> {
        #[cfg(feature = "pinned")]
        if let Some(tls) = &self.tls {
            // Straight to the host, never through a proxy: the certificate is the host's own.
            let mut b = reqwest::Client::builder().use_preconfigured_tls((**tls).clone()).no_proxy().connect_timeout(Duration::from_secs(5));
            if let Some(t) = timeout {
                b = b.timeout(t);
            }
            return b.build().map_err(|e| e.to_string());
        }
        client(timeout)
    }

    /// What the operator is told when a request did not get through.
    pub fn unreachable(&self, e: &reqwest::Error) -> String {
        #[cfg(feature = "pinned")]
        if crate::pin::refused_certificate(e) {
            return crate::pin::NOT_THE_PAIRED_HOST.into();
        }
        format!("Could not reach the host: {e}")
    }
}

#[derive(Deserialize)]
struct PairReply {
    success: bool,
    token: Option<String>,
    error: Option<String>,
}

/// Pair with the host while its pairing window is open; the token comes back once. `role` asks
/// for a role that does less than Present (an OBS companion, #209); the host decides.
pub async fn pair(host: &Host, code: &str, name: &str, role: Option<&str>) -> Result<String, String> {
    let mut body = serde_json::json!({ "code": code.trim(), "name": name.trim() });
    if let Some(r) = role.filter(|r| *r == "obs-companion") {
        body["role"] = serde_json::Value::String(r.to_string());
    }
    let reply: PairReply = host
        .client(Some(Duration::from_secs(10)))?
        .post(host.url("/api/v1/pair"))
        .json(&body)
        .send()
        .await
        .map_err(|e| host.unreachable(&e))?
        .json()
        .await
        .map_err(|e| format!("The host's answer was not understood: {e}"))?;
    match (reply.success, reply.token) {
        (true, Some(token)) => Ok(token),
        _ => Err(reply.error.unwrap_or_else(|| "The host refused".into())),
    }
}

/// The name and role the host gives this computer's key.
pub async fn me(host: &Host, token: &str) -> Result<serde_json::Value, String> {
    let r = host.client(Some(Duration::from_secs(10)))?.get(host.url("/api/v1/me")).header("X-Rhema-Key", token).send().await.map_err(|e| host.unreachable(&e))?;
    if !r.status().is_success() {
        return Err(if r.status().as_u16() == 401 { "The host no longer knows this computer: pair again".into() } else { format!("The host answered {}", r.status()) });
    }
    r.json().await.map_err(|e| e.to_string())
}

/// What an OBS companion is told by its host (#209): the church's cameras, who reads them, and
/// its own way to read them while the host's camera router runs. A refusal while the main desk has
/// taken back control starts with "paused:".
pub async fn cameras(host: &Host, token: &str) -> Result<serde_json::Value, String> {
    let r = host.client(Some(Duration::from_secs(8)))?.get(host.url("/api/v1/cameras/watch")).header("X-Rhema-Key", token).send().await.map_err(|e| host.unreachable(&e))?;
    let status = r.status().as_u16();
    let v = r.json::<serde_json::Value>().await.unwrap_or_default();
    if (200..300).contains(&status) {
        return Ok(v);
    }
    let why = v.get("error").and_then(|e| e.as_str()).map_or_else(|| format!("The host answered {status}"), String::from);
    Err(if status == 423 { format!("paused: {why}") } else { why })
}

/// An OBS companion's tally to its host: the cameras on its OBS program and preview, and those its
/// OBS plays, for the host's Production → Cameras.
pub async fn tally(host: &Host, token: &str, tally: &serde_json::Value) -> Result<(), String> {
    let r = host.client(Some(Duration::from_secs(5)))?.post(host.url("/api/v1/cameras/tally")).header("X-Rhema-Key", token).json(tally).send().await.map_err(|e| host.unreachable(&e))?;
    if r.status().is_success() {
        return Ok(());
    }
    let status = r.status().as_u16();
    let v = r.json::<serde_json::Value>().await.unwrap_or_default();
    Err(v.get("error").and_then(|e| e.as_str()).map_or_else(|| format!("The host answered {status}"), String::from))
}

enum FollowError {
    Refused(u16),
    Lost(String),
}
use FollowError::{Lost, Refused};

/// How a followed stream ended without an error.
enum Ended {
    /// The host closed it, or this computer stopped following.
    Closed,
    /// The host changed this desk (revoked, paused, another role) and ended its stream (`rejoin`).
    Rejoin,
}

/// Follow the host's Live State until `stop` says so: `emit("join:live", snapshot)` for each one,
/// and `emit("join:state", …)` for the connection ("connected" with `secure` and what the host
/// makes of this desk now (`me`), "reconnecting" with the reason, "refused", "stopped"). Reconnects
/// by itself, waiting a little longer each time (at most 10 s); at once when the host changed this
/// desk, which ends its stream.
pub async fn follow_live(host: Host, token: String, mut stop: watch::Receiver<bool>, emit: impl Fn(&'static str, String)) {
    let mut wait = 1u64;
    loop {
        if *stop.borrow() {
            break;
        }
        let result = follow(&host, &token, &mut stop, &emit).await;
        if *stop.borrow() {
            break;
        }
        match result {
            Ok(Ended::Rejoin) => {
                wait = 1;
                continue;
            }
            Err(Refused(status)) => {
                emit("join:state", serde_json::json!({ "state": "refused", "error": format!("The host refused this computer ({status}): pair again") }).to_string());
                return;
            }
            Ok(Ended::Closed) | Err(Lost(_)) => {
                let reason = match result {
                    Err(Lost(e)) => e,
                    _ => "the host closed the connection".into(),
                };
                emit("join:state", serde_json::json!({ "state": "reconnecting", "error": reason }).to_string());
            }
        }
        tokio::select! {
            () = tokio::time::sleep(Duration::from_secs(wait)) => {}
            _ = stop.changed() => {}
        }
        wait = (wait * 2).min(10);
    }
    emit("join:state", serde_json::json!({ "state": "stopped" }).to_string());
}

async fn follow(host: &Host, token: &str, stop: &mut watch::Receiver<bool>, emit: &impl Fn(&'static str, String)) -> Result<Ended, FollowError> {
    let r = host
        .client(None)
        .map_err(Lost)?
        .get(host.url("/api/v1/live/events"))
        .header("X-Rhema-Key", token)
        .header("Accept", "text/event-stream")
        .send()
        .await
        .map_err(|e| Lost(lost_reason(host, &e)))?;
    let status = r.status().as_u16();
    if status == 401 || status == 403 {
        return Err(Refused(status));
    }
    if !r.status().is_success() {
        return Err(Lost(format!("the host answered {status}")));
    }
    // What the host makes of this desk now (it may have changed while it was away); an older host
    // or a slow answer leaves the desk as it was.
    let me = me(host, token).await.ok();
    emit("join:state", serde_json::json!({ "state": "connected", "secure": host.is_secure(), "me": me }).to_string());
    let mut body = r.bytes_stream();
    let mut buf = String::new();
    loop {
        let chunk = tokio::select! {
            c = body.next() => c,
            _ = stop.changed() => return Ok(Ended::Closed),
        };
        let Some(chunk) = chunk else { return Ok(Ended::Closed) };
        buf.push_str(&String::from_utf8_lossy(&chunk.map_err(|e| Lost(e.to_string()))?));
        // A message ends with a blank line; keep any unfinished one.
        while let Some(end) = buf.find("\n\n") {
            let message: String = buf.drain(..end + 2).collect();
            if sse_event(&message) == "rejoin" {
                return Ok(Ended::Rejoin);
            }
            if let Some(data) = sse_data(&message) {
                emit("join:live", data);
            }
        }
        // A host that sends garbage without blank lines must not grow this without bound.
        if buf.len() > 4 * 1024 * 1024 {
            return Err(Lost("the host sent a message too large".into()));
        }
    }
}

/// Why following stopped, as before for plain http; a pinned host that shows another certificate says so.
fn lost_reason(host: &Host, e: &reqwest::Error) -> String {
    #[cfg(feature = "pinned")]
    if crate::pin::refused_certificate(e) {
        return host.unreachable(e);
    }
    let _ = host;
    e.to_string()
}

/// The name of one server-sent event ("message" when it has none).
pub fn sse_event(message: &str) -> &str {
    message.lines().find_map(|l| l.strip_prefix("event:")).map_or("message", str::trim)
}

/// The data of one server-sent event named "live" (multi-line data joined), or None.
pub fn sse_data(message: &str) -> Option<String> {
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

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

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
        assert_eq!(sse_event("event: rejoin\ndata: the host changed this desk\n\n"), "rejoin");
        assert_eq!(sse_data("event: rejoin\ndata: the host changed this desk\n\n"), None, "never taken as a Live State");
        assert_eq!(sse_event(": keep-alive\n\n"), "message");
    }

    #[tokio::test]
    async fn the_host_ending_the_stream_with_rejoin_connects_again_at_once_with_what_this_desk_is_now() {
        let address = pretend_host(|path| match path {
            "/api/v1/me" => (200, r#"{"name":"Ade","role":"viewer","paused":true}"#.into()),
            _ => (200, "event: live\ndata: {\"v\":1}\n\nevent: rejoin\ndata: x\n\n".into()),
        })
        .await;
        let (tx, rx) = watch::channel(false);
        let said = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let log = said.clone();
        let started = std::time::Instant::now();
        let run = tokio::spawn(follow_live(Host::plain(&address).unwrap(), "k".into(), rx, move |e, p| log.lock().unwrap().push((e, p))));
        tokio::time::sleep(Duration::from_millis(400)).await;
        let _ = tx.send(true);
        let _ = run.await;
        let said = said.lock().unwrap().clone();
        let connected: Vec<_> = said.iter().filter(|(e, p)| *e == "join:state" && p.contains("connected")).collect();
        assert!(connected.len() >= 2, "connected again within 400 ms, not after a wait: {said:?}");
        assert!(connected[0].1.contains("\"viewer\"") && connected[0].1.contains("\"secure\":false"), "{}", connected[0].1);
        assert!(!said.iter().any(|(_, p)| p.contains("reconnecting")), "no Reconnecting flash: {said:?}");
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    /// A pretend host on 127.0.0.1: answers each request with `reply(path)` and closes.
    pub(crate) async fn pretend_host(reply: fn(&str) -> (u16, String)) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap().to_string();
        tokio::spawn(async move {
            while let Ok((mut c, _)) = listener.accept().await {
                let mut buf = Vec::new();
                let mut chunk = [0u8; 4096];
                while !String::from_utf8_lossy(&buf).contains("\r\n\r\n") {
                    let n = c.read(&mut chunk).await.unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                }
                let head = String::from_utf8_lossy(&buf).to_string();
                let path = head.split(' ').nth(1).unwrap_or("").to_string();
                let (status, body) = reply(&path);
                let _ = c.write_all(format!("HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await;
            }
        });
        address
    }

    #[tokio::test]
    async fn a_paused_companion_is_told_so_and_an_unknown_key_must_pair_again() {
        let address = pretend_host(|path| match path {
            "/api/v1/cameras/watch" => (423, r#"{"error":"The main desk has taken back control"}"#.into()),
            _ => (401, "{}".into()),
        })
        .await;
        let host = Host::plain(&address).unwrap();
        assert_eq!(cameras(&host, "k").await.unwrap_err(), "paused: The main desk has taken back control");
        assert!(me(&host, "k").await.unwrap_err().contains("pair again"));
    }

    #[tokio::test]
    async fn following_says_refused_once_when_the_host_no_longer_knows_the_key() {
        let address = pretend_host(|_| (401, "{}".into())).await;
        let (_tx, rx) = watch::channel(false);
        let said = std::sync::Mutex::new(Vec::new());
        follow_live(Host::plain(&address).unwrap(), "k".into(), rx, |event, payload| said.lock().unwrap().push((event, payload))).await;
        let said = said.into_inner().unwrap();
        assert_eq!(said.len(), 1, "{said:?}");
        assert_eq!(said[0].0, "join:state");
        assert!(said[0].1.contains("\"refused\"") && said[0].1.contains("pair again"), "{}", said[0].1);
    }
}
