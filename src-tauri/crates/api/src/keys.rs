//! Who may send remote commands: a set of paired devices (and the optional
//! shared key), each stored as the SHA-256 of its token so a copied settings
//! file reveals nothing. An empty set means nothing authenticates, as the
//! app shipped. Pairing opens a six-digit window for two minutes.

use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::command::{same_key, RemoteCommand};

/// What a key may do. `Present` is the volunteer's set (move through the
/// service, show/hide, the event clock); `Configure` adds theme, opacity,
/// confidence and the on-air switch; `Timekeeper` may only move the event
/// clock (Host/Join, ARCH-004), never a screen; `Bible` activates, steps and
/// clears the Bible source only; `Screens` takes scenes to congregation outputs.
/// Existing entries without a role are `Configure`, as before.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Present,
    #[default]
    Configure,
    Timekeeper,
    Bible,
    Screens,
}

impl Role {
    #[must_use]
    pub fn allows(self, cmd: &RemoteCommand) -> bool {
        match cmd {
            // Production notices and the talk channel are for everyone on the team (Rhema Comms, #251).
            RemoteCommand::NoticeSend(_) | RemoteCommand::NoticeAck(_) | RemoteCommand::VoiceTalk(_) => true,
            RemoteCommand::EventNext | RemoteCommand::EventPrev | RemoteCommand::EventStart(_) => matches!(self, Role::Present | Role::Configure | Role::Timekeeper),
            RemoteCommand::BibleActivate(_) | RemoteCommand::VerseNext | RemoteCommand::VersePrev => matches!(self, Role::Present | Role::Configure | Role::Bible),
            RemoteCommand::ClearSource(id) | RemoteCommand::RestoreSource(id) => matches!(self, Role::Present | Role::Configure) || (self == Role::Bible && id == "bible"),
            RemoteCommand::TakeScene(_) | RemoteCommand::ReleaseScene(_) => matches!(self, Role::Present | Role::Configure | Role::Screens),
            _ if matches!(self, Role::Timekeeper | Role::Bible | Role::Screens) => false,
            RemoteCommand::Theme(_) | RemoteCommand::Opacity(_) | RemoteCommand::Confidence(_) | RemoteCommand::OnAir(_) => self == Role::Configure,
            RemoteCommand::Next
            | RemoteCommand::Prev
            | RemoteCommand::Show
            | RemoteCommand::Hide
            | RemoteCommand::SendToLive
            | RemoteCommand::BibleNext
            | RemoteCommand::BiblePrev
            | RemoteCommand::AddToQueue
            | RemoteCommand::VerseNext
            | RemoteCommand::VersePrev
            | RemoteCommand::Macro(_) => true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KeyEntry {
    /// SHA-256 hex of the token or shared key.
    pub hash: String,
    /// Shown in Settings and the log: "Tolu's phone", "Shared key".
    pub name: String,
    #[serde(default)]
    pub role: Role,
}

/// Whether a key is required is a separate switch from the list of keys:
/// revoking the last device must not reopen the surface, and a list that
/// never reached the backend must not pass as "open".
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Keys {
    /// False = accept anything (as the app shipped). True = every command needs a listed key; an empty list denies all.
    pub require_auth: bool,
    pub entries: Vec<KeyEntry>,
}

/// Shared between the app, the HTTP server and the OSC thread, so revoking
/// takes effect at once without restarting a listener.
pub type KeySet = Arc<RwLock<Keys>>;

#[must_use]
pub fn new_key_set() -> KeySet {
    Arc::new(RwLock::new(Keys::default()))
}

#[must_use]
pub fn hash_key(key: &str) -> String {
    format!("{:x}", Sha256::digest(key.as_bytes()))
}

/// Build a set from plain keys (tests and the shared key).
#[must_use]
pub fn key_set_from(keys: &[(&str, &str)]) -> KeySet {
    Arc::new(RwLock::new(Keys {
        require_auth: true,
        entries: keys.iter().map(|(k, name)| KeyEntry { hash: hash_key(k), name: (*name).to_string(), role: Role::Configure }).collect(),
    }))
}

/// `Ok(None)` when the set is empty (open); `Ok(Some(entry))` for the matching
/// key; `Err(reason)` when a key is required and missing or wrong.
pub fn check_key(keys: &KeySet, presented: Option<&str>) -> Result<Option<KeyEntry>, &'static str> {
    let keys = keys.read().unwrap_or_else(std::sync::PoisonError::into_inner);
    if !keys.require_auth {
        return Ok(None);
    }
    let Some(p) = presented else { return Err("missing key") };
    let h = hash_key(p);
    // Compare against every entry so the time does not reveal which one matched.
    let mut found: Option<KeyEntry> = None;
    for e in keys.entries.iter() {
        if same_key(&h, &e.hash) {
            found = Some(e.clone());
        }
    }
    found.map(Some).ok_or("wrong key")
}

pub const PAIRING_WINDOW: Duration = Duration::from_secs(120);
pub const PAIRING_ATTEMPTS: u8 = 3;

#[derive(Debug)]
pub struct Pairing {
    pub code: String,
    pub expires: Instant,
    pub attempts: u8,
}

pub type PairingWindow = Arc<Mutex<Option<Pairing>>>;

#[must_use]
pub fn new_pairing_window() -> PairingWindow {
    Arc::new(Mutex::new(None))
}

fn random_hex() -> String {
    format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}

/// Open (or replace) the pairing window; returns the six-digit code to show on screen.
pub fn open_pairing(window: &PairingWindow) -> String {
    let n = u32::from_le_bytes(uuid::Uuid::new_v4().as_bytes()[..4].try_into().unwrap_or([0; 4])) % 1_000_000;
    let code = format!("{n:06}");
    *window.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(Pairing { code: code.clone(), expires: Instant::now() + PAIRING_WINDOW, attempts: 0 });
    code
}

pub fn close_pairing(window: &PairingWindow) {
    *window.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = None;
}

#[derive(Debug, PartialEq, Eq)]
pub enum PairOutcome {
    /// The device is paired; give it this token once.
    Paired { token: String, entry: KeyEntry },
    NotOpen,
    WrongCode { attempts_left: u8 },
}

/// Try a code from a device. Three wrong codes or the deadline close the window.
pub fn try_pair(window: &PairingWindow, keys: &KeySet, code: &str, name: &str) -> PairOutcome {
    let mut guard = window.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let Some(p) = guard.as_mut() else { return PairOutcome::NotOpen };
    if Instant::now() > p.expires {
        *guard = None;
        return PairOutcome::NotOpen;
    }
    if !same_key(code.trim(), &p.code) {
        p.attempts += 1;
        if p.attempts >= PAIRING_ATTEMPTS {
            *guard = None;
            return PairOutcome::WrongCode { attempts_left: 0 };
        }
        return PairOutcome::WrongCode { attempts_left: PAIRING_ATTEMPTS - p.attempts };
    }
    *guard = None;
    drop(guard);
    let token = random_hex();
    let name = name.trim();
    // A newly paired device may present, not change settings, until the operator says otherwise.
    let entry = KeyEntry { hash: hash_key(&token), name: if name.is_empty() { "Paired device".into() } else { name.chars().take(60).collect() }, role: Role::Present };
    {
        let mut k = keys.write().unwrap_or_else(std::sync::PoisonError::into_inner);
        k.entries.push(entry.clone());
        k.require_auth = true;
    }
    PairOutcome::Paired { token, entry }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_set_is_open_and_keys_are_matched_by_hash() {
        let keys = new_key_set();
        assert_eq!(check_key(&keys, None), Ok(None));
        let keys = key_set_from(&[("s3cret", "Shared key"), ("tok", "Tolu's phone")]);
        assert_eq!(check_key(&keys, Some("tok")).unwrap().map(|e| e.name), Some("Tolu's phone".into()));
        assert_eq!(check_key(&keys, Some("nope")), Err("wrong key"));
        assert_eq!(check_key(&keys, None), Err("missing key"));
        assert_eq!(hash_key("a").len(), 64);
        // Required but empty: deny all, never reopen.
        keys.write().unwrap().entries.clear();
        assert_eq!(check_key(&keys, Some("tok")), Err("wrong key"));
        assert_eq!(check_key(&keys, None), Err("missing key"));
    }

    #[test]
    fn present_role_cannot_change_settings() {
        assert!(Role::Present.allows(&RemoteCommand::Next));
        assert!(Role::Present.allows(&RemoteCommand::Macro("offering".into())));
        assert!(!Role::Present.allows(&RemoteCommand::Theme("x".into())));
        assert!(!Role::Present.allows(&RemoteCommand::OnAir(false)));
        assert!(Role::Configure.allows(&RemoteCommand::OnAir(false)));
        let e: KeyEntry = serde_json::from_str(r#"{"hash":"h","name":"old"}"#).unwrap();
        assert_eq!(e.role, Role::Configure, "entries saved before roles keep full access");
    }

    #[test]
    fn timekeeper_moves_only_the_event_clock() {
        for cmd in [RemoteCommand::EventNext, RemoteCommand::EventPrev, RemoteCommand::EventStart("sermon".into())] {
            assert!(Role::Timekeeper.allows(&cmd));
            assert!(Role::Present.allows(&cmd));
            assert!(Role::Configure.allows(&cmd));
        }
        for cmd in [RemoteCommand::Next, RemoteCommand::Show, RemoteCommand::SendToLive, RemoteCommand::VerseNext, RemoteCommand::Macro("offering".into()), RemoteCommand::OnAir(true), RemoteCommand::Theme("x".into())] {
            assert!(!Role::Timekeeper.allows(&cmd), "{cmd}");
        }
        assert_eq!(serde_json::to_string(&Role::Timekeeper).unwrap(), "\"timekeeper\"");
    }

    #[test]
    fn bible_and_screens_operators_do_only_their_part() {
        let take = RemoteCommand::TakeScene(crate::command::SceneTake { output: "main".into(), scene: "s".into() });
        for cmd in [RemoteCommand::BibleActivate("John 3:16".into()), RemoteCommand::VerseNext, RemoteCommand::ClearSource("bible".into()), RemoteCommand::RestoreSource("bible".into())] {
            assert!(Role::Bible.allows(&cmd), "{cmd}");
            assert!(!Role::Screens.allows(&cmd), "{cmd}");
        }
        for cmd in [RemoteCommand::ClearSource("hymn".into()), RemoteCommand::Next, RemoteCommand::Show, take.clone(), RemoteCommand::EventNext, RemoteCommand::OnAir(false)] {
            assert!(!Role::Bible.allows(&cmd), "{cmd}");
        }
        assert!(Role::Screens.allows(&take) && Role::Screens.allows(&RemoteCommand::ReleaseScene("main".into())));
        for cmd in [RemoteCommand::Next, RemoteCommand::EventNext, RemoteCommand::BibleActivate("x".into()), RemoteCommand::Macro("x".into())] {
            assert!(!Role::Screens.allows(&cmd), "{cmd}");
        }
        assert!(Role::Present.allows(&take) && Role::Present.allows(&RemoteCommand::ClearSource("hymn".into())));
        assert!(!Role::Timekeeper.allows(&RemoteCommand::BibleActivate("x".into())));
    }

    #[test]
    fn pairing_takes_the_code_once_and_closes_after_three_wrong_tries() {
        let keys = new_key_set();
        let window = new_pairing_window();
        assert_eq!(try_pair(&window, &keys, "000000", "x"), PairOutcome::NotOpen);
        let code = open_pairing(&window);
        assert_eq!(code.len(), 6);
        let wrong = if code == "000000" { "000001" } else { "000000" };
        assert_eq!(try_pair(&window, &keys, wrong, "x"), PairOutcome::WrongCode { attempts_left: 2 });
        let PairOutcome::Paired { token, entry } = try_pair(&window, &keys, &code, "  Tolu's phone ") else { panic!("should pair") };
        assert_eq!(entry.name, "Tolu's phone");
        assert_eq!(token.len(), 64);
        let paired = check_key(&keys, Some(&token)).unwrap().unwrap();
        assert_eq!((paired.name.as_str(), paired.role), ("Tolu's phone", Role::Present));
        assert_eq!(try_pair(&window, &keys, &code, "again"), PairOutcome::NotOpen, "single use");
        let code = open_pairing(&window);
        let wrong = if code == "111111" { "111112" } else { "111111" };
        assert_eq!(try_pair(&window, &keys, wrong, "x"), PairOutcome::WrongCode { attempts_left: 2 });
        assert_eq!(try_pair(&window, &keys, wrong, "x"), PairOutcome::WrongCode { attempts_left: 1 });
        assert_eq!(try_pair(&window, &keys, wrong, "x"), PairOutcome::WrongCode { attempts_left: 0 });
        assert_eq!(try_pair(&window, &keys, &code, "x"), PairOutcome::NotOpen);
        assert_eq!(keys.read().unwrap().entries.len(), 1);
        assert!(keys.read().unwrap().require_auth);
    }
}
