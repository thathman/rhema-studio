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
/// confidence, the on-air switch and editing scenes; `Timekeeper` may only move the event
/// clock, the service timer and a hold (Host/Join, ARCH-004), never a screen; `Bible` activates, steps and
/// clears the Bible source only; `Screens` takes, makes and changes congregation scenes. The
/// specialist roles (#215 G10, #243 VL.5): `Worship` shows songs and hymns and takes the lyrics off
/// and back; `Stage` writes the stage message; `Camera` hides a camera from scenes and changes the
/// camera boxes of scenes; `Obs` (OBS director) switches OBS scenes through the host's OBS
/// connection, which no other joined desk may do. `ObsCompanion` (#209) is a computer that runs OBS
/// only: it reads the church's cameras from the camera router into its own OBS and reports which are
/// on its program; it sends no service command (only the notices and the talk channel, as everyone).
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
    Worship,
    Stage,
    Camera,
    Obs,
    #[serde(rename = "obs-companion")]
    ObsCompanion,
}

impl Role {
    /// As saved and as notices address it: "present", "configure", "timekeeper", "bible", "screens",
    /// "worship", "stage", "camera", "obs", "obs-companion".
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Present => "present",
            Role::Configure => "configure",
            Role::Timekeeper => "timekeeper",
            Role::Bible => "bible",
            Role::Screens => "screens",
            Role::Worship => "worship",
            Role::Stage => "stage",
            Role::Camera => "camera",
            Role::Obs => "obs",
            Role::ObsCompanion => "obs-companion",
        }
    }

    /// Whether this desk may change scenes, and so gets their full definitions in the Live State:
    /// the settings desk and the screens operator wholly, a camera desk its camera boxes only.
    #[must_use]
    pub fn edits_scenes(self) -> bool {
        matches!(self, Role::Configure | Role::Screens | Role::Camera)
    }

    #[must_use]
    pub fn allows(self, cmd: &RemoteCommand) -> bool {
        match cmd {
            // Production notices and the talk channel are for everyone on the team (Rhema Comms, #251).
            RemoteCommand::NoticeSend(_) | RemoteCommand::NoticeAck(_) | RemoteCommand::VoiceTalk(_) | RemoteCommand::VoiceLeave | RemoteCommand::VoiceChannels(_) => true,
            RemoteCommand::EventNext | RemoteCommand::EventPrev | RemoteCommand::EventStart(_) | RemoteCommand::EventOffset(_) | RemoteCommand::TimerStart | RemoteCommand::TimerPause | RemoteCommand::TimerAdjust(_) | RemoteCommand::Hold(_) | RemoteCommand::Resume => matches!(self, Role::Present | Role::Configure | Role::Timekeeper),
            RemoteCommand::BibleActivate(_) | RemoteCommand::BiblePreview(_) | RemoteCommand::VerseNext | RemoteCommand::VersePrev => matches!(self, Role::Present | Role::Configure | Role::Bible),
            // Songs and hymns are the main screens' content: the Present desks and the worship desk.
            RemoteCommand::SongShow(_) | RemoteCommand::SongPreview(_) => matches!(self, Role::Present | Role::Configure | Role::Worship),
            RemoteCommand::ClearSource(id) | RemoteCommand::RestoreSource(id) => match self {
                Role::Present | Role::Configure => true,
                Role::Bible => id == "bible",
                Role::Worship => id == "song" || id == "hymn",
                Role::Stage => id == "stage",
                // Hiding a camera from scenes (it is not framed yet) and showing it again.
                Role::Camera => id.starts_with("camera:"),
                _ => false,
            },
            RemoteCommand::TakeScene(_) | RemoteCommand::ReleaseScene(_) => matches!(self, Role::Present | Role::Configure | Role::Screens),
            // Making and changing scenes (#243 SC.16): the host still decides whether a change goes in
            // at once or waits for the main desk (crate::scene_edits); a camera desk only its camera boxes.
            RemoteCommand::SaveScene(_) => self.edits_scenes(),
            RemoteCommand::DeleteScene(_) => matches!(self, Role::Configure | Role::Screens),
            RemoteCommand::StageMessage(_) => matches!(self, Role::Present | Role::Configure | Role::Stage),
            // OBS is the online stream: only a desk the main desk made OBS director switches it.
            RemoteCommand::ObsPreview(_) | RemoteCommand::ObsTake | RemoteCommand::ObsProgram(_) => self == Role::Obs,
            // An extra timer (#196 R2.5): the timekeeping desks, or the role the timer belongs to; the
            // server checks the owner against the host's Live State (crate::aux_timers).
            RemoteCommand::AuxTimer(_) => self != Role::ObsCompanion,
            _ if !matches!(self, Role::Present | Role::Configure) => false,
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
    /// The main desk has taken back control (#243): this key's commands are refused until the host
    /// gives control back, but it still reads the Live State and keeps the talk channel and
    /// notices. Absent (entries saved before this) = not paused.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub paused: bool,
}

/// What a paused desk is told when it sends a command.
pub const PAUSED_MESSAGE: &str = "The main desk has taken back control";

impl KeyEntry {
    /// True when the main desk has taken back control and this is a service command (not crew talk).
    #[must_use]
    pub fn paused_for(&self, cmd: &RemoteCommand) -> bool {
        self.paused && !cmd.is_comms()
    }
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
        entries: keys.iter().map(|(k, name)| KeyEntry { hash: hash_key(k), name: (*name).to_string(), role: Role::Configure, paused: false }).collect(),
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
    try_pair_as(window, keys, code, name, None)
}

/// The role a device may ask for while pairing: only one that can do less than Present, so the
/// code alone never gives more. An OBS companion (#209) asks to be one; anything else is Present.
#[must_use]
pub fn role_asked(asked: Option<&str>) -> Role {
    match asked {
        Some("obs-companion") => Role::ObsCompanion,
        _ => Role::Present,
    }
}

/// `try_pair` with the role the device asked for (see `role_asked`).
pub fn try_pair_as(window: &PairingWindow, keys: &KeySet, code: &str, name: &str, asked: Option<&str>) -> PairOutcome {
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
    let mut k = keys.write().unwrap_or_else(std::sync::PoisonError::into_inner);
    // A newly paired device may present, not change settings, until the operator says otherwise
    // (an OBS companion asks for less, and gets it).
    let entry = KeyEntry { hash: hash_key(&token), name: unique_name(name, &k.entries), role: role_asked(asked), paused: false };
    k.entries.push(entry.clone());
    k.require_auth = true;
    drop(k);
    PairOutcome::Paired { token, entry }
}

/**
 * A paired device's name, unique among the paired devices: the talk channel and the service log
 * know devices by name. "host" and "Main desk" are the main computer's, so a device asking for
 * them gets "<name> (device)"; a taken name gets " 2", " 3"…
 */
fn unique_name(asked: &str, entries: &[KeyEntry]) -> String {
    let mut base: String = asked.trim().chars().take(52).collect();
    if base.is_empty() {
        base = "Paired device".into();
    }
    // Never a name that reads as the main desk ("Main desk", "Tolu (main desk)"): a desk is told
    // apart by its key, but people read names.
    let lower = base.to_lowercase();
    if let Some(stem) = lower.strip_suffix("(main desk)") {
        let stem = base[..stem.len()].trim_end().to_string();
        base = if stem.is_empty() { "Main desk (device)".into() } else { format!("{stem} (device)") };
    } else if ["host", "main desk"].contains(&lower.as_str()) {
        base = format!("{base} (device)");
    }
    let taken = |n: &str| entries.iter().any(|e| e.name.eq_ignore_ascii_case(n));
    if !taken(&base) {
        return base;
    }
    (2..).map(|i| format!("{base} {i}")).find(|n| !taken(n)).unwrap_or(base)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paired_names_are_unique_and_never_the_main_desk() {
        let e = |n: &str| KeyEntry { hash: n.into(), name: n.into(), role: Role::Present, paused: false };
        let have = [e("Femi's laptop"), e("Femi's laptop 2"), e("Phone")];
        assert_eq!(unique_name("Femi's laptop", &have), "Femi's laptop 3");
        assert_eq!(unique_name("  phone ", &have), "phone 2");
        assert_eq!(unique_name("host", &have), "host (device)");
        assert_eq!(unique_name("Main Desk", &have), "Main Desk (device)");
        assert_eq!(unique_name("Tolu (Main Desk)", &have), "Tolu (device)", "never the main desk's label");
        assert_eq!(unique_name(" (main desk) ", &have), "Main desk (device)");
        assert_eq!(unique_name("", &have), "Paired device");
        assert_eq!(unique_name("Ade", &have), "Ade");
    }

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
        for cmd in [RemoteCommand::EventNext, RemoteCommand::EventPrev, RemoteCommand::EventStart("sermon".into()), RemoteCommand::EventOffset(5), RemoteCommand::TimerStart, RemoteCommand::TimerAdjust(1)] {
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
    fn hold_and_resume_are_for_the_timekeeper_present_and_configure_only() {
        for cmd in [RemoteCommand::Hold(Some("Waiting for the pastor".into())), RemoteCommand::Hold(None), RemoteCommand::Resume] {
            for role in [Role::Timekeeper, Role::Present, Role::Configure] {
                assert!(role.allows(&cmd), "{role:?} {cmd}");
            }
            for role in [Role::Bible, Role::Screens] {
                assert!(!role.allows(&cmd), "{role:?} {cmd}");
            }
        }
        let paused = KeyEntry { hash: "h".into(), name: "Desk C".into(), role: Role::Timekeeper, paused: true };
        assert!(paused.paused_for(&RemoteCommand::Hold(None)) && paused.paused_for(&RemoteCommand::Resume));
    }

    #[test]
    fn bible_and_screens_operators_do_only_their_part() {
        let take = RemoteCommand::TakeScene(crate::command::SceneTake { output: "main".into(), scene: "s".into() });
        for cmd in [RemoteCommand::BibleActivate("John 3:16".into()), RemoteCommand::BiblePreview("John 3:16".into()), RemoteCommand::VerseNext, RemoteCommand::ClearSource("bible".into()), RemoteCommand::RestoreSource("bible".into())] {
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
        // The lower third and the stage message as sources (#243): taken off and back by the Present desks only.
        for id in ["lowerThird", "stage"] {
            for cmd in [RemoteCommand::ClearSource(id.into()), RemoteCommand::RestoreSource(id.into())] {
                assert!(Role::Present.allows(&cmd) && Role::Configure.allows(&cmd), "{cmd}");
                assert!(!Role::Bible.allows(&cmd) && !Role::Screens.allows(&cmd) && !Role::Timekeeper.allows(&cmd), "{cmd}");
            }
        }
        assert!(!Role::Timekeeper.allows(&RemoteCommand::BibleActivate("x".into())));
        // A song or hymn asked for (Comms C2): the Present desks only.
        for cmd in [RemoteCommand::SongShow("Amazing Grace".into()), RemoteCommand::SongPreview("Amazing Grace".into())] {
            assert!(Role::Present.allows(&cmd) && Role::Configure.allows(&cmd), "{cmd}");
            assert!(!Role::Bible.allows(&cmd) && !Role::Screens.allows(&cmd) && !Role::Timekeeper.allows(&cmd), "{cmd}");
        }
    }

    #[test]
    fn the_specialist_desks_do_only_their_part() {
        let save = RemoteCommand::SaveScene(crate::command::SceneSave { scene: serde_json::json!({ "id": "s1" }), request: false });
        let delete = RemoteCommand::DeleteScene(crate::command::SceneDelete { id: "s1".into(), request: false });
        let obs = [RemoteCommand::ObsPreview("Sermon".into()), RemoteCommand::ObsTake, RemoteCommand::ObsProgram("Wide".into())];
        let take = RemoteCommand::TakeScene(crate::command::SceneTake { output: "main".into(), scene: "s".into() });
        // Worship: songs and hymns, and taking the lyrics off and back; nothing else on a screen.
        for cmd in [RemoteCommand::SongShow("Amazing Grace".into()), RemoteCommand::SongPreview("x".into()), RemoteCommand::ClearSource("song".into()), RemoteCommand::RestoreSource("hymn".into())] {
            assert!(Role::Worship.allows(&cmd), "{cmd}");
        }
        for cmd in [RemoteCommand::ClearSource("bible".into()), RemoteCommand::BibleActivate("x".into()), RemoteCommand::Next, RemoteCommand::EventNext, take.clone(), save.clone(), RemoteCommand::StageMessage("x".into())] {
            assert!(!Role::Worship.allows(&cmd), "{cmd}");
        }
        // Stage: the stage message only.
        for cmd in [RemoteCommand::StageMessage("Wrap up".into()), RemoteCommand::ClearSource("stage".into()), RemoteCommand::RestoreSource("stage".into())] {
            assert!(Role::Stage.allows(&cmd) && Role::Present.allows(&cmd) && Role::Configure.allows(&cmd), "{cmd}");
        }
        for cmd in [RemoteCommand::ClearSource("lowerThird".into()), RemoteCommand::SongShow("x".into()), RemoteCommand::Next, take.clone(), RemoteCommand::Hold(None)] {
            assert!(!Role::Stage.allows(&cmd), "{cmd}");
        }
        assert!(!Role::Bible.allows(&RemoteCommand::StageMessage("x".into())) && !Role::Screens.allows(&RemoteCommand::StageMessage("x".into())));
        // Camera: hide or show a camera in scenes, and the camera boxes of a scene (checked by the host).
        for cmd in [RemoteCommand::ClearSource("camera:pulpit".into()), RemoteCommand::RestoreSource("camera:pulpit".into()), save.clone()] {
            assert!(Role::Camera.allows(&cmd), "{cmd}");
        }
        for cmd in [delete.clone(), take.clone(), RemoteCommand::ClearSource("bible".into()), RemoteCommand::Next] {
            assert!(!Role::Camera.allows(&cmd), "{cmd}");
        }
        // Scenes are made and changed by the screens and settings desks; never Present, Bible, Timekeeper.
        for role in [Role::Screens, Role::Configure] {
            assert!(role.allows(&save) && role.allows(&delete), "{role:?}");
        }
        for role in [Role::Present, Role::Bible, Role::Timekeeper, Role::Worship, Role::Stage, Role::Obs] {
            assert!(!role.allows(&save) && !role.allows(&delete), "{role:?}");
        }
        // OBS: the OBS director only; not even the settings desk switches the stream from another computer.
        for cmd in &obs {
            assert!(Role::Obs.allows(cmd), "{cmd}");
            for role in [Role::Present, Role::Configure, Role::Timekeeper, Role::Bible, Role::Screens, Role::Worship, Role::Stage, Role::Camera] {
                assert!(!role.allows(cmd), "{role:?} {cmd}");
            }
        }
        for cmd in [RemoteCommand::Next, take, RemoteCommand::BibleActivate("x".into()), RemoteCommand::OnAir(true), RemoteCommand::Macro("x".into())] {
            assert!(!Role::Obs.allows(&cmd), "{cmd}");
        }
        // Everyone keeps the notices and the talk channel.
        let notice = RemoteCommand::NoticeSend(crate::command::NoticeIn { text: "ready".into(), to: None, priority: None, event: None, action: None });
        for role in [Role::Worship, Role::Stage, Role::Camera, Role::Obs] {
            assert!(role.allows(&notice) && role.allows(&RemoteCommand::VoiceTalk(true)), "{role:?}");
        }
        for (role, name) in [(Role::Worship, "worship"), (Role::Stage, "stage"), (Role::Camera, "camera"), (Role::Obs, "obs")] {
            assert_eq!(role.as_str(), name);
            assert_eq!(serde_json::to_string(&role).unwrap(), format!("\"{name}\""));
            assert_eq!(serde_json::from_str::<Role>(&format!("\"{name}\"")).unwrap(), role);
        }
        assert!(Role::Camera.edits_scenes() && Role::Screens.edits_scenes() && Role::Configure.edits_scenes());
        assert!(!Role::Present.edits_scenes() && !Role::Bible.edits_scenes() && !Role::Obs.edits_scenes());
    }

    #[test]
    fn an_obs_companion_reads_cameras_and_sends_no_service_command() {
        let c = Role::ObsCompanion;
        assert_eq!(c.as_str(), "obs-companion");
        assert_eq!(serde_json::to_string(&c).unwrap(), "\"obs-companion\"");
        assert_eq!(serde_json::from_str::<Role>("\"obs-companion\"").unwrap(), c);
        assert!(!c.edits_scenes());
        let take = RemoteCommand::TakeScene(crate::command::SceneTake { output: "main".into(), scene: "s".into() });
        for cmd in [RemoteCommand::Next, RemoteCommand::Show, take, RemoteCommand::ObsTake, RemoteCommand::ObsProgram("Wide".into()), RemoteCommand::BibleActivate("x".into()), RemoteCommand::EventNext, RemoteCommand::ClearSource("camera:pulpit".into()), RemoteCommand::OnAir(true), RemoteCommand::Macro("x".into())] {
            assert!(!c.allows(&cmd), "{cmd}");
        }
        assert!(c.allows(&RemoteCommand::VoiceTalk(true)), "it stays on Talk, as everyone");
        // Pairing gives a device at most Present; asking to be a companion gives less.
        assert_eq!(role_asked(Some("obs-companion")), Role::ObsCompanion);
        for asked in [None, Some("configure"), Some("obs"), Some("present"), Some("")] {
            assert_eq!(role_asked(asked), Role::Present, "{asked:?}");
        }
        let (keys, window) = (new_key_set(), new_pairing_window());
        let code = open_pairing(&window);
        let PairOutcome::Paired { entry, .. } = try_pair_as(&window, &keys, &code, "OBS computer", Some("obs-companion")) else { panic!("should pair") };
        assert_eq!(entry.role, Role::ObsCompanion);
    }

    #[test]
    fn a_paused_desk_keeps_talking_but_sends_no_service_command() {
        let e = KeyEntry { hash: "h".into(), name: "Desk C".into(), role: Role::Present, paused: true };
        for cmd in [RemoteCommand::Next, RemoteCommand::EventNext, RemoteCommand::BibleActivate("John 3:16".into()), RemoteCommand::ReleaseScene("main".into())] {
            assert!(e.paused_for(&cmd), "{cmd}");
        }
        let notice = RemoteCommand::NoticeSend(crate::command::NoticeIn { text: "ready".into(), to: None, priority: None, event: None, action: None });
        for cmd in [RemoteCommand::VoiceTalk(true), RemoteCommand::VoiceLeave, notice, RemoteCommand::NoticeAck(crate::command::NoticeAckIn { id: "n1".into(), state: "seen".into() })] {
            assert!(!e.paused_for(&cmd), "{cmd}");
        }
        let given_back = KeyEntry { paused: false, ..e };
        assert!(!given_back.paused_for(&RemoteCommand::Next));
    }

    #[test]
    fn paused_round_trips_and_old_entries_are_not_paused() {
        let old: KeyEntry = serde_json::from_str(r#"{"hash":"h","name":"old","role":"present"}"#).unwrap();
        assert!(!old.paused, "entries saved before this are not paused");
        assert_eq!(serde_json::to_string(&old).unwrap(), r#"{"hash":"h","name":"old","role":"present"}"#, "not paused writes nothing new");
        let paused = KeyEntry { paused: true, ..old };
        let back: KeyEntry = serde_json::from_str(&serde_json::to_string(&paused).unwrap()).unwrap();
        assert_eq!(back, paused);
        let from_app: KeyEntry = serde_json::from_str(r#"{"hash":"h","name":"Desk C","role":"bible","paused":true}"#).unwrap();
        assert!(from_app.paused && from_app.role == Role::Bible);
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
