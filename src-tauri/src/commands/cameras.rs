//! Cameras on the church network (OP-009, #209): a scene's camera layer plays a WHEP stream, the
//! standard WebRTC playback that MediaMTX offers for each camera it relays. The output windows
//! cannot reach other addresses (the app's content policy); this posts their offer for them, only
//! to addresses on the church network, and returns the camera's answer. The video itself flows
//! directly between the camera relay and the window.

use std::time::Duration;

/// Only cameras on the church network: http(s) to a private, link-local or loopback address, or
/// a `.local` / `localhost` name. Nothing on the internet.
pub fn church_network_url(url: &str) -> Result<reqwest::Url, String> {
    let u = reqwest::Url::parse(url.trim()).map_err(|_| "That is not a stream address (e.g. http://192.168.1.10:8889/pulpit/whep)".to_string())?;
    if !matches!(u.scheme(), "http" | "https") {
        return Err("The stream address must start with http:// or https://".into());
    }
    let host = u.host_str().unwrap_or("").trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    let ok = match host.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(ip)) => ip.is_private() || ip.is_loopback() || ip.is_link_local(),
        Ok(std::net::IpAddr::V6(ip)) => ip.is_loopback() || (ip.segments()[0] & 0xfe00) == 0xfc00 || (ip.segments()[0] & 0xffc0) == 0xfe80,
        Err(_) => host == "localhost" || host.ends_with(".local"),
    };
    if ok { Ok(u) } else { Err("Only cameras on the church network (a local address such as 192.168.x.x, or a .local name)".into()) }
}

/// Send a window's WebRTC offer to the camera's WHEP address; the answer comes back.
#[tauri::command]
pub async fn whep_offer(url: String, sdp: String) -> Result<String, String> {
    let u = church_network_url(&url)?;
    if sdp.len() > 64 * 1024 || !sdp.starts_with("v=0") {
        return Err("not a WebRTC offer".into());
    }
    let r = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?
        .post(u)
        .header(reqwest::header::CONTENT_TYPE, "application/sdp")
        .body(sdp)
        .send()
        .await
        .map_err(|e| format!("The camera did not answer: {e}"))?;
    let status = r.status();
    let body = r.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() || !body.starts_with("v=0") {
        return Err(format!("The camera refused ({status})"));
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_cameras_on_the_church_network() {
        for ok in ["http://192.168.1.10:8889/pulpit/whep", "http://10.0.0.5:8889/a/whep", "https://172.20.1.2/x", "http://127.0.0.1:8899/cam/whep", "http://camera-box.local:8889/choir/whep", "http://[fe80::1]:8889/x"] {
            assert!(church_network_url(ok).is_ok(), "{ok}");
        }
        for no in ["http://8.8.8.8/whep", "https://example.com/whep", "ftp://192.168.1.10/x", "file:///etc/passwd", "not a url", "http://172.32.0.1/x"] {
            assert!(church_network_url(no).is_err(), "{no}");
        }
    }
}
