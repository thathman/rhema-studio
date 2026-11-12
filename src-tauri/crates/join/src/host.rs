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

/// A host's stream says something at least every 15 s; silence this long means the host has hung.
const STREAM_SILENCE: Duration = Duration::from_secs(if cfg!(test) { 1 } else { 45 });

/// A plain http client: a short wait to connect, and `timeout` for the whole request when given;
/// with none (a stream that never ends), a limit on how long it may go silent.
pub fn client(timeout: Option<Duration>) -> Result<reqwest::Client, String> {
    // Paired-desk credentials use a custom header, which reqwest does not strip on every redirect.
    // Never forward a key to a different host after the operator paired with this one.
    // Straight to the host on this network, never through a system proxy: a proxied request is
    // refused by the host's local-only routes (#412), and a key must not pass through a proxy.
    let b = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5));
    match timeout {
        Some(t) => b.timeout(t),
        None => b.read_timeout(STREAM_SILENCE),
    }
    .build()
    .map_err(|e| e.to_string())
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
            let b = reqwest::Client::builder()
                .use_preconfigured_tls((**tls).clone())
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(5));
            return match timeout {
                Some(t) => b.timeout(t),
                None => b.read_timeout(STREAM_SILENCE),
            }
            .build()
            .map_err(|e| e.to_string());
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

/// Look something up in the host's library (desk consoles, #197): `{"what": "search", …}` as the
/// host's `/api/v1/lookup` takes it. The host checks this desk's role; its refusal is said as it is.
pub async fn lookup(host: &Host, token: &str, asked: &serde_json::Value) -> Result<serde_json::Value, String> {
    let r = host.client(Some(Duration::from_secs(8)))?.post(host.url("/api/v1/lookup")).header("X-Rhema-Key", token).json(asked).send().await.map_err(|e| host.unreachable(&e))?;
    let status = r.status().as_u16();
    let v = r.json::<serde_json::Value>().await.unwrap_or_default();
    if (200..300).contains(&status) {
        return Ok(v);
    }
    if status == 404 {
        return Err("The host is an older Rhema Studio that cannot be searched from here: update it".into());
    }
    Err(v.get("error").and_then(|e| e.as_str()).map_or_else(|| format!("The host answered {status}"), String::from))
}

/// Read only this paired desk's durable approval requests from the host.
pub async fn requests(host: &Host, token: &str) -> Result<serde_json::Value, String> {
    let r = host.client(Some(Duration::from_secs(8)))?.get(host.url("/api/v1/requests")).header("X-Rhema-Key", token).send().await.map_err(|e| host.unreachable(&e))?;
    let status = r.status().as_u16();
    let body = r.json::<serde_json::Value>().await.unwrap_or_default();
    if (200..300).contains(&status) {
        if body.get("requests").and_then(serde_json::Value::as_array).is_some() { return Ok(body); }
        return Err("The host returned an invalid request list.".into());
    }
    let why = body.get("error").and_then(|e| e.as_str()).map_or_else(|| format!("The host answered {status}"), String::from);
    Err(match status {
        401 => "The host no longer knows this computer: pair again".into(),
        404 => "The host is an older Rhema Studio that does not share approval request status: update it".into(),
        423 => format!("paused: {why}"),
        _ => why,
    })
}

/// Withdraw one of this desk's own undecided requests. The host remains authoritative.
pub async fn withdraw_request(host: &Host, token: &str, id: &str) -> Result<serde_json::Value, String> {
    if id.is_empty() || id.len() > 128 || !id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_')) {
        return Err("That request ID is not valid. Refresh the request list.".into());
    }
    let path = format!("/api/v1/requests/{id}/withdraw");
    let r = host.client(Some(Duration::from_secs(8)))?.post(host.url(&path)).header("X-Rhema-Key", token).json(&serde_json::json!({})).send().await.map_err(|e| host.unreachable(&e))?;
    let status = r.status().as_u16();
    let body = r.json::<serde_json::Value>().await.unwrap_or_default();
    if (200..300).contains(&status) { return Ok(body); }
    let why = body.get("error").and_then(|e| e.as_str()).map_or_else(|| format!("The host answered {status}"), String::from);
    Err(match status {
        401 => "The host no longer knows this computer: pair again".into(),
        404 => "The host no longer has that request. Refresh the list.".into(),
        409 => format!("stale: {why}"),
        423 => format!("paused: {why}"),
        _ => why,
    })
}

/// A plan id the host could accept (`rhema_api::plans`): letters, digits, `-` and `_`, at most 64.
fn plan_id_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
}

/// The host's refusal of a plan request, said so a joined Editor desk can act on it (#847). The
/// desk's client reads the prefix: `forbidden:` (403, this role does not work on the plan),
/// `paused:` (423), `missing:` (404), `conflict:<actual revision>:` (409, someone saved since this
/// desk opened it) and `refused:` (409 without a revision). Anything else is said as it is.
fn plan_failure(status: u16, body: &serde_json::Value) -> String {
    let why = body.get("error").and_then(|e| e.as_str()).map_or_else(|| format!("The host answered {status}"), String::from);
    match status {
        401 => "The host no longer knows this computer: pair again".into(),
        403 => format!("forbidden: {why}"),
        404 => "missing: The host has no such service plan (or is an older Rhema Studio that does not share plans): refresh the list".into(),
        409 => match body.get("actual").and_then(serde_json::Value::as_i64) {
            Some(actual) => format!("conflict:{actual}: {why}"),
            None => format!("refused: {why}"),
        },
        423 => format!("paused: {why}"),
        _ => why,
    }
}

/// One plan call to the host, with this desk's key; the host checks the role and the revision.
async fn plan_call(host: &Host, token: &str, method: reqwest::Method, path: &str, body: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    let mut request = host.client(Some(Duration::from_secs(10)))?.request(method, host.url(path)).header("X-Rhema-Key", token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let r = request.send().await.map_err(|e| host.unreachable(&e))?;
    let status = r.status().as_u16();
    let body = r.json::<serde_json::Value>().await.unwrap_or_default();
    if (200..300).contains(&status) {
        return Ok(body);
    }
    Err(plan_failure(status, &body))
}

const NOT_A_PLAN_ID: &str = "missing: That is not a service plan id: refresh the list";

/// The service plans in use on the host (C5, `docs/contracts/plan-drafts-v1.md`): Editor,
/// Configure and Present desks may read them.
pub async fn plans(host: &Host, token: &str) -> Result<serde_json::Value, String> {
    let list = plan_call(host, token, reqwest::Method::GET, "/api/v1/plans", None).await?;
    if list.is_array() { Ok(list) } else { Err("The host returned an invalid plan list.".into()) }
}

/// One service plan, `{ program, items }`, with the revision a draft must be saved against.
pub async fn plan(host: &Host, token: &str, id: &str) -> Result<serde_json::Value, String> {
    if !plan_id_ok(id) {
        return Err(NOT_A_PLAN_ID.into());
    }
    plan_call(host, token, reqwest::Method::GET, &format!("/api/v1/plans/{id}"), None).await
}

/// Save this desk's draft of a plan, only if the host still has it at `expected_revision`. A save
/// never approves: the main desk's approved revision stays what Live uses.
pub async fn save_plan(host: &Host, token: &str, id: &str, expected_revision: i64, items: &serde_json::Value) -> Result<serde_json::Value, String> {
    if !plan_id_ok(id) {
        return Err(NOT_A_PLAN_ID.into());
    }
    if !items.is_array() {
        return Err("A plan's items are a list".into());
    }
    let body = serde_json::json!({ "expectedRevision": expected_revision, "items": items });
    plan_call(host, token, reqwest::Method::PUT, &format!("/api/v1/plans/{id}"), Some(body)).await
}

/// Ask the main desk to approve exactly `revision` of a plan: an approval request on the host.
pub async fn submit_plan(host: &Host, token: &str, id: &str, revision: i64, note: Option<&str>) -> Result<serde_json::Value, String> {
    if !plan_id_ok(id) {
        return Err(NOT_A_PLAN_ID.into());
    }
    let mut body = serde_json::json!({ "revision": revision });
    if let Some(note) = note.map(str::trim).filter(|n| !n.is_empty()) {
        body["note"] = serde_json::Value::String(note.to_string());
    }
    plan_call(host, token, reqwest::Method::POST, &format!("/api/v1/plans/{id}/submit"), Some(body)).await
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
pub async fn follow_live(host: Host, token: String, stop: watch::Receiver<bool>, emit: impl Fn(&'static str, String)) {
    follow_moving(host, token, stop, emit, || async { None }).await;
}

/// The longest a look for the host elsewhere keeps the old address from being tried again.
const LOOK_FOR: Duration = Duration::from_secs(8);

/// Look for the host elsewhere after this many failed tries in a row, and again each time as many more fail.
const LOOK_EVERY: u32 = 3;

/// `follow_live`, and when the host stays out of reach, ask `find_moved` whether it answers at
/// another address now (its address changed): if so, carry on there and say `join:moved`.
pub async fn follow_moving<F, Fut>(mut host: Host, token: String, mut stop: watch::Receiver<bool>, emit: impl Fn(&'static str, String), find_moved: F)
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Option<(String, Host)>>,
{
    let mut wait = 1u64;
    let mut failed = 0u32;
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
                failed = 0;
                continue;
            }
            Err(Refused(status)) => {
                emit("join:state", serde_json::json!({ "state": "refused", "error": format!("The host refused this computer ({status}): pair again") }).to_string());
                return;
            }
            Ok(Ended::Closed) | Err(Lost(_)) => {
                let closed = matches!(result, Ok(Ended::Closed));
                let reason = match result {
                    Err(Lost(e)) => e,
                    _ => "the host closed the connection".into(),
                };
                emit("join:state", serde_json::json!({ "state": "reconnecting", "error": reason }).to_string());
                // Closed by the host: it was there a moment ago.
                failed = if closed { 1 } else { failed + 1 };
                if failed.is_multiple_of(LOOK_EVERY) {
                    let found = tokio::select! {
                        f = tokio::time::timeout(LOOK_FOR, find_moved()) => f.ok().flatten(),
                        _ = stop.changed() => None,
                    };
                    // Stopped meanwhile: this computer may be following another host by now.
                    if let Some((address, moved)) = found.filter(|_| !*stop.borrow()) {
                        host = moved;
                        wait = 1;
                        failed = 0;
                        emit("join:moved", serde_json::json!({ "address": address }).to_string());
                        continue;
                    }
                }
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
    let asked = host.client(None).map_err(Lost)?.get(host.url("/api/v1/live/events")).header("X-Rhema-Key", token).header("Accept", "text/event-stream").send();
    // Disconnecting works even while a hung host keeps this waiting.
    let r = tokio::select! {
        r = asked => r.map_err(|e| Lost(lost_reason(host, &e)))?,
        _ = stop.changed() => return Ok(Ended::Closed),
    };
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
    async fn approval_requests_are_read_and_withdrawn_only_through_the_host_api() {
        let address = pretend_host(|path| match path {
            "/api/v1/requests" => (200, r#"{"requests":[{"id":"request-1","state":"submitted"}]}"#.into()),
            "/api/v1/requests/request-1/withdraw" => (200, r#"{"id":"request-1","state":"withdrawn"}"#.into()),
            "/api/v1/requests/decided/withdraw" => (409, r#"{"error":"Only the person who sent a request can withdraw it, and only before it is decided."}"#.into()),
            "/api/v1/requests/missing/withdraw" => (404, r#"{"error":"No such request"}"#.into()),
            _ => (401, "{}".into()),
        }).await;
        let host = Host::plain(&address).unwrap();
        assert_eq!(requests(&host, "k").await.unwrap()["requests"][0]["state"], "submitted");
        assert_eq!(withdraw_request(&host, "k", "request-1").await.unwrap()["state"], "withdrawn");
        assert!(withdraw_request(&host, "k", "decided").await.unwrap_err().starts_with("stale:"));
        assert!(withdraw_request(&host, "k", "missing").await.unwrap_err().contains("no longer has that request"));
        assert!(withdraw_request(&host, "k", "../pair").await.unwrap_err().contains("not valid"));
    }

    #[tokio::test]
    async fn a_plan_is_read_saved_and_submitted_through_the_host_and_its_refusals_are_kept_apart() {
        let address = pretend_host(|path| match path {
            "/api/v1/plans" => (200, r#"[{"id":"p1","title":"Sunday","revision":3}]"#.into()),
            "/api/v1/plans/p1" => (200, r#"{"program":{"id":"p1","revision":4},"items":[]}"#.into()),
            "/api/v1/plans/p1/submit" => (200, r#"{"id":"request-1","kind":"plan_approve","baseRevision":4,"state":"submitted"}"#.into()),
            "/api/v1/plans/moved" | "/api/v1/plans/moved/submit" => (409, r#"{"error":"The plan changed since you opened it","expected":3,"actual":5}"#.into()),
            "/api/v1/plans/decided/submit" => (409, r#"{"error":"Already decided"}"#.into()),
            "/api/v1/plans/theirs" => (403, r#"{"error":"This desk's role does not work on the service plan"}"#.into()),
            "/api/v1/plans/held" => (423, r#"{"error":"The main desk has taken back control"}"#.into()),
            _ => (404, String::new()),
        })
        .await;
        let host = Host::plain(&address).unwrap();
        let items = serde_json::json!([{ "kind": "verse", "reference": "John 3:16" }]);
        assert_eq!(plans(&host, "k").await.unwrap()[0]["id"], "p1");
        assert_eq!(plan(&host, "k", "p1").await.unwrap()["program"]["revision"], 4);
        assert_eq!(save_plan(&host, "k", "p1", 3, &items).await.unwrap()["program"]["revision"], 4);
        assert_eq!(submit_plan(&host, "k", "p1", 4, Some(" ready ")).await.unwrap()["state"], "submitted");
        assert_eq!(save_plan(&host, "k", "moved", 3, &items).await.unwrap_err(), "conflict:5: The plan changed since you opened it");
        assert!(submit_plan(&host, "k", "moved", 3, None).await.unwrap_err().starts_with("conflict:5:"));
        assert_eq!(submit_plan(&host, "k", "decided", 3, None).await.unwrap_err(), "refused: Already decided");
        assert_eq!(save_plan(&host, "k", "theirs", 3, &items).await.unwrap_err(), "forbidden: This desk's role does not work on the service plan");
        assert!(save_plan(&host, "k", "held", 3, &items).await.unwrap_err().starts_with("paused: "));
        assert!(plan(&host, "k", "gone").await.unwrap_err().starts_with("missing: "));
        assert!(plan(&host, "k", "../pair").await.unwrap_err().starts_with("missing: "), "never sent: not a plan id");
        assert!(save_plan(&host, "k", "p1", 3, &serde_json::json!({})).await.is_err(), "items are a list");
    }

    #[test]
    fn a_plan_refusal_keeps_the_hosts_words_and_the_revision_it_has_now() {
        let said = |status, body: &str| plan_failure(status, &serde_json::from_str(body).unwrap_or_default());
        assert!(said(401, "{}").contains("pair again"));
        assert_eq!(said(409, r#"{"error":"moved","actual":7}"#), "conflict:7: moved");
        assert_eq!(said(422, r#"{"error":"a plan holds at most 500 items"}"#), "a plan holds at most 500 items");
        assert_eq!(said(503, "{}"), "The host answered 503");
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

    #[tokio::test]
    async fn a_paired_key_is_not_forwarded_through_a_redirect() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let destination = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let destination_address = destination.local_addr().unwrap();
        let redirector = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let redirect_address = redirector.local_addr().unwrap();
        let redirect_task = tokio::spawn(async move {
            let (mut stream, _) = redirector.accept().await.unwrap();
            let mut request = [0u8; 2048];
            let _ = stream.read(&mut request).await;
            let response = format!(
                "HTTP/1.1 302 Found\r\nLocation: http://{destination_address}/capture\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            stream.write_all(response.as_bytes()).await.unwrap();
        });

        let response = client(Some(Duration::from_secs(2)))
            .unwrap()
            .get(format!("http://{redirect_address}/receivers"))
            .header("X-Rhema-Key", "paired-secret")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::FOUND);
        assert!(tokio::time::timeout(Duration::from_millis(100), destination.accept()).await.is_err());
        redirect_task.await.unwrap();
    }
}
