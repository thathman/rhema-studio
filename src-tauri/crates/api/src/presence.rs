//! Who is connected to this host now (Production → Operators): each paired key's last request, the
//! address it came from, and how many Live State streams it holds open. Only paired keys are kept,
//! by their hash; nothing here decides what a key may do.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, PoisonError, RwLock};

use serde::Serialize;

use crate::keys::KeyEntry;

#[derive(Debug, Clone)]
struct Seen {
    name: String,
    address: IpAddr,
    /// Unix milliseconds of its last request (or when its last stream closed).
    last_ms: u64,
    streams: u32,
}

/// One paired desk as the host card shows it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeskPresence {
    /// The key's hash: how the app matches it to its paired device.
    pub hash: String,
    pub name: String,
    pub address: String,
    /// Follows the Live State now (an open stream).
    pub connected: bool,
    /// Unix milliseconds; now while it is connected.
    pub last_seen_ms: u64,
}

#[derive(Debug, Default)]
pub struct Presence {
    seen: RwLock<HashMap<String, Seen>>,
}

pub type SharedPresence = Arc<Presence>;

#[must_use]
pub fn new_presence() -> SharedPresence {
    Arc::new(Presence::default())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

/// Keeps a desk counted as connected while its Live State stream is open.
#[derive(Debug)]
pub struct StreamGuard {
    presence: SharedPresence,
    hash: String,
}

impl Drop for StreamGuard {
    fn drop(&mut self) {
        let mut seen = self.presence.seen.write().unwrap_or_else(PoisonError::into_inner);
        if let Some(s) = seen.get_mut(&self.hash) {
            s.streams = s.streams.saturating_sub(1);
            s.last_ms = now_ms();
        }
    }
}

impl Presence {
    /// A request from a paired key (ignored for this computer itself, which has no key).
    pub fn saw(&self, entry: &KeyEntry, address: IpAddr) {
        self.touch(entry, address, 0);
    }

    fn touch(&self, entry: &KeyEntry, address: IpAddr, more_streams: u32) {
        if entry.hash.is_empty() {
            return;
        }
        let mut seen = self.seen.write().unwrap_or_else(PoisonError::into_inner);
        // Bounded: a host has a handful of desks; a list this long is old keys, not desks.
        if seen.len() > 512 && !seen.contains_key(&entry.hash) {
            seen.retain(|_, s| s.streams > 0);
        }
        let s = seen.entry(entry.hash.clone()).or_insert_with(|| Seen { name: entry.name.clone(), address, last_ms: 0, streams: 0 });
        s.name.clone_from(&entry.name);
        s.address = address;
        s.last_ms = now_ms();
        s.streams += more_streams;
    }

    /// A Live State stream opened; it counts until the guard is dropped.
    #[must_use]
    pub fn stream_opened(self: &Arc<Self>, entry: &KeyEntry, address: IpAddr) -> Option<StreamGuard> {
        if entry.hash.is_empty() {
            return None;
        }
        self.touch(entry, address, 1);
        Some(StreamGuard { presence: self.clone(), hash: entry.hash.clone() })
    }

    /// Every desk seen since the listener started, the connected ones first, then the most recent.
    #[must_use]
    pub fn list(&self) -> Vec<DeskPresence> {
        let now = now_ms();
        let seen = self.seen.read().unwrap_or_else(PoisonError::into_inner);
        let mut out: Vec<DeskPresence> = seen
            .iter()
            .map(|(hash, s)| DeskPresence { hash: hash.clone(), name: s.name.clone(), address: s.address.to_string(), connected: s.streams > 0, last_seen_ms: if s.streams > 0 { now } else { s.last_ms } })
            .collect();
        out.sort_by(|a, b| b.connected.cmp(&a.connected).then(b.last_seen_ms.cmp(&a.last_seen_ms)).then_with(|| a.name.cmp(&b.name)));
        out
    }

    /// Forget everything (the listener stopped: nobody is connected any more).
    pub fn clear(&self) {
        self.seen.write().unwrap_or_else(PoisonError::into_inner).clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::Role;

    fn key(hash: &str, name: &str) -> KeyEntry {
        KeyEntry {
            hash: hash.into(),
            name: name.into(),
            role: Role::Present,
            paused: false,
            output_scope: Vec::new(),
            group_take_scope: Vec::new(),
            record: false,
        }
    }

    #[test]
    fn a_desk_is_connected_while_its_stream_is_open_then_remembered_when_last_seen() {
        let p = new_presence();
        let ip: IpAddr = "192.168.1.30".parse().unwrap();
        p.saw(&key("aa", "Femi's laptop"), ip);
        let guard = p.stream_opened(&key("bb", "Ade's phone"), "192.168.1.31".parse().unwrap()).unwrap();
        let list = p.list();
        assert_eq!(list.iter().map(|d| (d.name.as_str(), d.connected)).collect::<Vec<_>>(), [("Ade's phone", true), ("Femi's laptop", false)]);
        assert_eq!(list[1].address, "192.168.1.30");
        assert!(list[0].last_seen_ms >= list[1].last_seen_ms);
        drop(guard);
        assert!(!p.list().iter().any(|d| d.connected), "the stream closed");
        assert_eq!(p.list().len(), 2, "still remembered, with when it was last seen");
        // This computer itself (no key) is never listed.
        p.saw(&key("", "This computer"), "127.0.0.1".parse().unwrap());
        assert!(p.stream_opened(&key("", "This computer"), "127.0.0.1".parse().unwrap()).is_none());
        assert_eq!(p.list().len(), 2);
        p.clear();
        assert!(p.list().is_empty());
    }

    #[test]
    fn two_streams_from_one_key_count_until_both_close_and_a_rename_shows() {
        let p = new_presence();
        let ip: IpAddr = "10.0.0.5".parse().unwrap();
        let a = p.stream_opened(&key("cc", "Desk"), ip).unwrap();
        let b = p.stream_opened(&key("cc", "Desk C"), ip).unwrap();
        drop(a);
        assert!(p.list()[0].connected);
        assert_eq!(p.list()[0].name, "Desk C");
        drop(b);
        assert!(!p.list()[0].connected);
    }
}
