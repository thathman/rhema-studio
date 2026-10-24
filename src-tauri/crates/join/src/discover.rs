//! Finding Rhema hosts (and Rhema Receiver TVs) on the network by mDNS (#197, #198). Only an
//! address comes from here: pairing still needs the code on the host's screen, and nothing a
//! computer announces is trusted.

use std::collections::BTreeMap;
use std::net::Ipv4Addr;
use std::time::{Duration, Instant};

use serde::Serialize;

/// What a Rhema host calls itself on the network (mDNS / Bonjour).
pub const HOST_SERVICE: &str = "_rhema-host._tcp.local.";

/// A Rhema host or Rhema Receiver TV found on the network: its name and its address (ip:port).
#[derive(Serialize, Debug, PartialEq)]
pub struct Found {
    pub name: String,
    pub address: String,
}

/// What a search heard: service name → port and IPv4 addresses.
pub type Heard = BTreeMap<String, (u16, Vec<Ipv4Addr>)>;

/// The church-network address: a private one (192.168…, 10…, 172.16–31…) first, else a link-local
/// one (169.254…). Anything else is not on this LAN and is left out.
pub fn lan_ip(ips: &[Ipv4Addr]) -> Option<Ipv4Addr> {
    ips.iter().filter(|ip| ip.is_private()).min().or_else(|| ips.iter().filter(|ip| ip.is_link_local()).min()).copied()
}

/// What a search heard, as a list sorted by name. Left out: anything with no LAN IPv4 address, or
/// whose port `port_ok` refuses. The same address heard twice is listed once.
pub fn found(seen: Heard, port_ok: impl Fn(u16) -> bool, name: fn(&str) -> String) -> Vec<Found> {
    let mut list: Vec<Found> = seen
        .into_iter()
        .filter(|(_, (port, _))| port_ok(*port))
        .filter_map(|(full, (port, ips))| lan_ip(&ips).map(|ip| Found { name: name(&full), address: format!("{ip}:{port}") }))
        .collect();
    list.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then_with(|| a.address.cmp(&b.address)));
    let mut addresses = std::collections::HashSet::new();
    list.retain(|f| addresses.insert(f.address.clone()));
    list
}

/// Listen for one kind of service for a moment (blocking; run off the async threads): what was
/// heard, by service name.
pub fn browse(service: &str, window: Duration, what: &str) -> Result<Heard, String> {
    let daemon = mdns_sd::ServiceDaemon::new().map_err(|e| format!("Could not look for {what} on the network: {e}"))?;
    let events = daemon.browse(service).map_err(|e| format!("Could not look for {what} on the network: {e}"))?;
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
    Ok(seen)
}

/// A host's name as it announces it: its service name without the service type, with any escaped
/// characters plain again ("CAC Ibadan._rhema-host._tcp.local." → "CAC Ibadan").
pub fn host_name(fullname: &str) -> String {
    let name = fullname.strip_suffix(HOST_SERVICE).unwrap_or(fullname).trim_end_matches('.');
    name.replace("\\.", ".").replace("\\\\", "\\")
}

/// The hosts a search heard: any port (a host chooses its own), never port 0.
pub fn found_hosts(seen: Heard) -> Vec<Found> {
    found(seen, |port| port != 0, host_name)
}

/// Find the Rhema hosts on this network, so a joining computer can pick one instead of typing its
/// address. Takes about two and a half seconds.
pub async fn discover_hosts() -> Result<Vec<Found>, String> {
    tokio::task::spawn_blocking(|| browse(HOST_SERVICE, Duration::from_millis(2500), "Rhema hosts").map(found_hosts))
        .await
        .map_err(|e| format!("Could not look for Rhema hosts on the network: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_private_then_link_local_addresses_are_kept() {
        let ip = |s: &str| s.parse::<Ipv4Addr>().unwrap();
        assert_eq!(lan_ip(&[ip("8.8.8.8"), ip("169.254.1.1"), ip("192.168.1.9")]), Some(ip("192.168.1.9")));
        assert_eq!(lan_ip(&[ip("8.8.8.8"), ip("169.254.1.1")]), Some(ip("169.254.1.1")));
        assert_eq!(lan_ip(&[ip("8.8.8.8")]), None);
        assert_eq!(lan_ip(&[ip("127.0.0.1"), ip("0.0.0.0"), ip("224.0.0.251")]), None);
        assert_eq!(lan_ip(&[]), None);
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
}
