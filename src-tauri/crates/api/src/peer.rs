//! Source-address boundaries for unauthenticated remote access.

use std::net::IpAddr;

use crate::keys::{check_key, KeyEntry, KeySet};

use std::sync::atomic::{AtomicU64, Ordering};

static REFUSED: AtomicU64 = AtomicU64::new(0);
static LAST_REFUSED_MS: AtomicU64 = AtomicU64::new(0);

/// Count one remote request refused for its key (missing, wrong or revoked, or key-less from outside
/// the local network or through a proxy), for Show Health (#412): an old controller that sends no key
/// shows up there, not only in the log. Show Health shows it only while recent.
pub fn note_refused() {
    REFUSED.fetch_add(1, Ordering::Relaxed);
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
    LAST_REFUSED_MS.store(now, Ordering::Relaxed);
}

/// Requests refused for their key since the keys last changed, and when the last one was (Unix ms, 0 = never).
#[must_use]
pub fn refused() -> (u64, u64) {
    (REFUSED.load(Ordering::Relaxed), LAST_REFUSED_MS.load(Ordering::Relaxed))
}

/// New keys or a new setting: earlier refusals no longer say anything about the controllers now.
pub fn reset_refused() {
    REFUSED.store(0, Ordering::Relaxed);
    LAST_REFUSED_MS.store(0, Ordering::Relaxed);
}

/// Open remote commands are permitted only from the host's local/private networks.
pub const OPEN_REMOTE_OUTSIDE_LOCAL_NETWORK: &str =
    "unauthenticated remote commands are limited to the local network";

/// Whether an address is loopback, RFC1918, IPv4 link-local, IPv6 ULA, or IPv6 link-local.
/// Addresses outside those local/private ranges must present a paired key.
#[must_use]
pub fn is_local_network_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            ip.is_loopback() || ip.is_private() || matches!(ip.octets(), [169, 254, _, _])
        }
        IpAddr::V6(ip) => {
            let first = ip.segments()[0];
            ip.is_loopback() || first & 0xfe00 == 0xfc00 || first & 0xffc0 == 0xfe80
        }
    }
}

/// Check a remote command key and limit legacy open access to local/private peers.
/// Authenticated peers keep the existing behavior, including direct connections outside a LAN.
pub fn check_remote_key(
    keys: &KeySet,
    presented: Option<&str>,
    peer: IpAddr,
) -> Result<Option<KeyEntry>, &'static str> {
    let entry = check_key(keys, presented)?;
    if entry.is_none() && !is_local_network_ip(peer) {
        return Err(OPEN_REMOTE_OUTSIDE_LOCAL_NETWORK);
    }
    Ok(entry)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_loopback_private_and_link_local_addresses() {
        for address in [
            "127.0.0.1",
            "10.0.0.2",
            "172.16.4.9",
            "192.168.1.24",
            "169.254.8.3",
            "::1",
            "fc00::1",
            "fd12:3456::8",
            "fe80::a",
        ] {
            assert!(is_local_network_ip(address.parse().unwrap()), "{address}");
        }
    }

    #[test]
    fn public_addresses_are_not_open_remote_peers() {
        for address in [
            "8.8.8.8",
            "1.1.1.1",
            "100.64.0.1",
            "100.127.255.254",
            "2001:4860:4860::8888",
        ] {
            assert!(!is_local_network_ip(address.parse().unwrap()), "{address}");
        }
        let keys = crate::keys::new_key_set();
        assert_eq!(
            check_remote_key(&keys, None, "8.8.8.8".parse().unwrap()),
            Err(OPEN_REMOTE_OUTSIDE_LOCAL_NETWORK)
        );
        assert_eq!(
            check_remote_key(&keys, None, "192.168.1.20".parse().unwrap()),
            Ok(None)
        );
    }

    #[test]
    fn paired_tokens_still_authenticate_a_public_peer() {
        let keys = crate::keys::key_set_from(&[("token", "Desk")]);
        assert_eq!(
            check_remote_key(&keys, Some("token"), "8.8.8.8".parse().unwrap())
                .unwrap()
                .unwrap()
                .name,
            "Desk"
        );
        assert_eq!(
            check_remote_key(&keys, Some("tampered"), "8.8.8.8".parse().unwrap()),
            Err("wrong key")
        );
    }
}
