//! A host says on the church network that it is there (#197), so a joining computer can pick it
//! from a list instead of typing its address. Only the address is found this way: pairing still
//! needs the code on the host's screen, and nothing a computer announces is trusted.

use std::net::IpAddr;
use std::time::Duration;

/// What a Rhema host calls itself on the network (mDNS / Bonjour), as Rhema Studio Companion looks for it.
pub use rhema_join::discover::HOST_SERVICE;

/// What this computer would announce: the name people see, the network host name, the http port
/// and the TXT record (`v=1`, and `tls=<port>` when https for phone pages is on).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostAdvert {
    pub instance: String,
    pub host: String,
    pub port: u16,
    pub txt: Vec<(String, String)>,
}

/// The announcement for a listener bound to `bind_host`, or None when nobody else could reach it:
/// a listener on this computer only (127.0.0.1) is never announced. The name is the church's
/// (Brand Kit), else "Rhema · <this computer>".
pub fn host_advert(bind_host: &str, port: u16, tls_port: Option<u16>, church: &str, computer: &str) -> Option<HostAdvert> {
    let loopback = bind_host.eq_ignore_ascii_case("localhost") || bind_host.parse::<IpAddr>().map_or(true, |ip| ip.is_loopback());
    if loopback || port == 0 {
        return None;
    }
    let computer = clean(computer.trim().trim_end_matches('.').trim_end_matches(".local"));
    let church = clean(church);
    let instance = if !church.is_empty() {
        church
    } else if !computer.is_empty() {
        format!("Rhema · {computer}")
    } else {
        "Rhema".to_string()
    };
    let label: String = computer.to_ascii_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let label = label.trim_matches('-');
    // Not the computer's own name: the system already answers for that one.
    let host = if label.is_empty() { "rhema-host.local.".to_string() } else { format!("rhema-{}.local.", &label[..label.len().min(50)]) };
    let mut txt = vec![("v".to_string(), "1".to_string())];
    if let Some(t) = tls_port.filter(|t| *t != 0) {
        txt.push(("tls".to_string(), t.to_string()));
    }
    Some(HostAdvert { instance: shorten(&instance, 63), host, port, txt })
}

/// A plain one-line name: no dots (they split names on the network), no control characters, single spaces.
fn clean(name: &str) -> String {
    name.chars().filter(|c| *c != '.' && !c.is_control()).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ")
}

/// At most `max` bytes, cut on a character boundary (a network name label is 63 bytes at most).
fn shorten(s: &str, max: usize) -> String {
    let mut end = s.len().min(max);
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].trim_end().to_string()
}

/// This computer's network name, for the announcement when no church name is set.
pub fn computer_name() -> String {
    sysinfo::System::host_name().unwrap_or_default()
}

/// An announcement on the air; dropping it does not stop it, `stop` does.
pub struct Advertising {
    daemon: mdns_sd::ServiceDaemon,
    fullname: String,
    pub plan: HostAdvert,
}

/// Start announcing `plan` on every network this computer is on.
pub fn start(plan: HostAdvert) -> Result<Advertising, String> {
    let daemon = mdns_sd::ServiceDaemon::new().map_err(|e| e.to_string())?;
    let txt: Vec<(&str, &str)> = plan.txt.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    let info = mdns_sd::ServiceInfo::new(HOST_SERVICE, &plan.instance, &plan.host, "", plan.port, &txt[..])
        .map_err(|e| e.to_string())?
        .enable_addr_auto();
    let fullname = info.get_fullname().to_string();
    if let Err(e) = daemon.register(info) {
        let _ = daemon.shutdown();
        return Err(e.to_string());
    }
    Ok(Advertising { daemon, fullname, plan })
}

/// Say goodbye on the network (so lists drop this host at once) and stop.
pub fn stop(ad: Advertising) {
    if let Ok(done) = ad.daemon.unregister(&ad.fullname) {
        let _ = done.recv_timeout(Duration::from_millis(300));
    }
    let _ = ad.daemon.shutdown();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_listener_on_this_computer_only_is_never_announced() {
        for host in ["127.0.0.1", "127.0.0.2", "::1", "localhost", "LOCALHOST", "not an address", ""] {
            assert_eq!(host_advert(host, 8080, None, "CAC Ibadan", "studio"), None, "{host}");
        }
        assert_eq!(host_advert("0.0.0.0", 0, None, "CAC", "studio"), None, "no port, nothing to find");
        assert!(host_advert("0.0.0.0", 8080, None, "CAC", "studio").is_some());
        assert!(host_advert("192.168.1.20", 8080, None, "CAC", "studio").is_some());
    }

    #[test]
    fn the_church_name_is_used_else_rhema_and_this_computer() {
        let name = |church: &str, computer: &str| host_advert("0.0.0.0", 8080, None, church, computer).unwrap().instance;
        assert_eq!(name("  CAC   Ibadan ", "Studio-Mac.local"), "CAC Ibadan");
        assert_eq!(name("St. Mary's", "x"), "St Mary's", "no dots in a network name");
        assert_eq!(name("", "Studio-Mac.local"), "Rhema · Studio-Mac");
        assert_eq!(name(" ", "Studio-Mac.local."), "Rhema · Studio-Mac");
        assert_eq!(name("", ""), "Rhema");
        let long = name(&"Ẹ".repeat(40), "x");
        assert!(long.len() <= 63 && long.chars().all(|c| c == 'Ẹ'), "cut on a character: {long}");
    }

    #[test]
    fn the_announcement_carries_the_port_version_and_https_port() {
        let ad = host_advert("0.0.0.0", 8080, Some(8081), "CAC", "Studio Mac.local").unwrap();
        assert_eq!(ad.port, 8080);
        assert_eq!(ad.txt, vec![("v".into(), "1".into()), ("tls".into(), "8081".into())]);
        assert_eq!(ad.host, "rhema-studio-mac.local.", "its own host name, not the computer's");
        assert_eq!(host_advert("0.0.0.0", 9000, None, "CAC", "").unwrap().txt, vec![("v".into(), "1".into())]);
        assert_eq!(host_advert("0.0.0.0", 9000, None, "CAC", "").unwrap().host, "rhema-host.local.");
    }
}
