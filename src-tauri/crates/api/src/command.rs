use serde::{Deserialize, Serialize};
use std::fmt;

/// Unified command type for all remote control protocols (OSC, HTTP).
///
/// Both OSC messages and HTTP JSON requests parse into this enum.
/// The `CommandDispatcher` then routes each variant to the appropriate
/// backend action or frontend event.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "command", content = "value", rename_all = "snake_case")]
pub enum RemoteCommand {
    Next,
    Prev,
    Show,
    Hide,
    Theme(String),
    Opacity(f32),
    Confidence(f32),
    OnAir(bool),
    SendToLive,
    BibleNext,
    BiblePrev,
    AddToQueue,
    /// Present the verse after the one on the live output (continues a reading).
    VerseNext,
    VersePrev,
    /// Run a named macro (a short sequence of ordinary actions) by id.
    Macro(String),
    /// The event clock (ADR 0001, C03): start the next run-of-show event, go back one, or start
    /// one by its item id. None of them changes a screen.
    EventNext,
    EventPrev,
    EventStart(String),
    /// Running late (+) or early (−), in minutes, added to the service's shared offset (#196).
    /// Only what is expected moves; the plan and the screens stay as they are.
    EventOffset(i32),
    /// The service timer, from a Timekeeper desk (#196 R5): start, pause, or correct it by whole
    /// minutes (at most 10 a step). Never a screen.
    TimerStart,
    TimerPause,
    TimerAdjust(i32),
    /// Hold the service with an optional reason ("Waiting for the pastor"), or resume it, from a
    /// Timekeeper desk (#196 R3): logged with who, on the stage display; loops and timed moves
    /// wait until Resume. Never a congregation screen.
    Hold(Option<String>),
    Resume,
    /// Activate the Bible source with a typed reference ("Romans 8:28", "jn 3 16"): every feed that
    /// follows Bible takes it; the main screens too unless a song, hymn or slide is up (ADR 0001).
    /// A Bible desk may name the translation it chose (`{"reference": …, "translation": "KJV"}`);
    /// a plain reference is in the host's own, as before.
    BibleActivate(BibleRef),
    /// Put a typed reference in the host's Preview only (an action request answered with Preview,
    /// Rhema Comms C2): nothing goes live until the main desk shows it.
    BiblePreview(String),
    /// A song or hymn from the host's library, by its title (an action request, Comms C2): shown
    /// live from its first slide, or put in the host's Preview only.
    SongShow(String),
    SongPreview(String),
    /// Step the song or hymn on the screens to its next (+1) or previous (−1) section, from a Worship
    /// desk: only within that song, never on to the next item of the service. `"chorus"` goes to
    /// the chorus again (repeat chorus): the last one sung, else the song's first.
    SongSection(SectionMove),
    /// Take one live source off its feeds ("bible", "song", "hymn", "slide", "picture"), or put it back.
    ClearSource(String),
    RestoreSource(String),
    /// Put a scene on a congregation output, or send the output back to its own feed.
    TakeScene(SceneTake),
    ReleaseScene(String),
    /// Make or change a scene from a joined desk (#243 SC.16): the whole scene as the desk has it.
    /// The host checks the revision the desk saw, the desk's role and its approval rule
    /// (`crate::scene_edits`), and makes it right with its own rules before it is saved.
    SaveScene(SceneSave),
    DeleteScene(SceneDelete),
    /// The message on the stage display (one short line; "" clears it). Never the congregation.
    StageMessage(String),
    /// OBS through the host's own OBS connection (OBS director only): a scene to OBS's Preview,
    /// Take the Preview, or (without Studio Mode) switch OBS's program. Never in rehearsal.
    ObsPreview(String),
    ObsTake,
    ObsProgram(String),
    /// Rhema Comms (#251): a private production notice to everyone or a role, and its answer.
    /// The host stamps who sent it from the device's key; nothing here reaches a screen.
    NoticeSend(NoticeIn),
    NoticeAck(NoticeAckIn),
    /// Rhema Comms voice (C3): this desk holds Talk (true) or let go (false). Everyone sees it.
    VoiceTalk(bool),
    /// This desk left the talk channel; the host drops its connection at once.
    VoiceLeave,
    /// Talk channels (Comms C4): which channels this desk listens to, and whom it talks to.
    VoiceChannels(VoiceChannelsIn),
    /// An extra timer (#196 R2.5) from a joined desk: start, pause or reset the timer with this id.
    /// The host's server checks the timer's owner first (`crate::aux_timers`). Never a screen.
    AuxTimer(AuxTimerIn),
    /// Queue a verse or a song asked for (Comms C2, #251) from a joined desk or a phone: into the
    /// host's run of show for later. Nothing is shown and the main desk's Preview does not change.
    QueueRequest(QueueIn),
    /// OBS's recording, from the OBS director's desk through the host's OBS connection: start, stop,
    /// or a marker (a line in the service log, and a chapter where OBS has them). Never in rehearsal.
    ObsRecord(ObsRecordIn),
    /// Choose OBS's scene transition (OBS director): how OBS's next switch looks. Never in rehearsal.
    ObsTransition(String),
}

/// Where a section step goes: one section on or back, or the chorus again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SectionMove {
    Step(i32),
    To(SectionTarget),
}

/// A section to go to by name: the chorus (the only one for now).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SectionTarget {
    Chorus,
}

impl From<i32> for SectionMove {
    fn from(n: i32) -> Self {
        SectionMove::Step(n)
    }
}

/// A verse or a song to queue: its kind and the reference or title, as the request had it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QueueIn {
    pub kind: QueueKind,
    pub value: String,
}

/// Only a verse or a song can be queued; anything else does not parse.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QueueKind {
    Bible,
    Song,
}

impl QueueKind {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            QueueKind::Bible => "bible",
            QueueKind::Song => "song",
        }
    }
}

/// What to do with OBS's recording, and a marker's name (optional; the host names it otherwise).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ObsRecordIn {
    pub action: RecordAction,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecordAction {
    Start,
    Stop,
    Marker,
}

impl RecordAction {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            RecordAction::Start => "start",
            RecordAction::Stop => "stop",
            RecordAction::Marker => "marker",
        }
    }
}

/// Which extra timer, and what to do: "start", "pause" or "reset".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuxTimerIn {
    pub id: String,
    pub action: String,
}

/// A reference to activate, with the translation a Bible desk chose (its abbreviation, as the host
/// lists them), or a plain reference (older desks, OSC, the phone page).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum BibleRef {
    Plain(String),
    With {
        reference: String,
        #[serde(default)]
        translation: Option<String>,
    },
}

impl BibleRef {
    #[must_use]
    pub fn reference(&self) -> &str {
        match self {
            BibleRef::Plain(r) | BibleRef::With { reference: r, .. } => r,
        }
    }

    /// The translation asked for: short, letters, digits and a few marks only (an abbreviation).
    #[must_use]
    pub fn translation(&self) -> Option<String> {
        match self {
            BibleRef::With { translation: Some(t), .. } => Some(t.trim().chars().filter(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | ' ')).take(16).collect::<String>()).filter(|t| !t.is_empty()),
            _ => None,
        }
    }
}

impl From<&str> for BibleRef {
    fn from(r: &str) -> Self {
        BibleRef::Plain(r.to_string())
    }
}

impl From<String> for BibleRef {
    fn from(r: String) -> Self {
        BibleRef::Plain(r)
    }
}

impl fmt::Display for BibleRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.translation() {
            Some(t) => write!(f, "{} {t}", self.reference()),
            None => write!(f, "{}", self.reference()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VoiceChannelsIn {
    /// Channels heard besides All crew: "production", "stage".
    #[serde(default)]
    pub listen: Vec<String>,
    /// "all", "production", "stage", or "to:<name>" for one person.
    pub talk: String,
    /// How loud this desk hears each person, in percent (0–100), by the name it sees ("to:host" for
    /// the main desk); anyone not listed is heard in full. The host mixes what each desk hears, so it
    /// applies them there. Absent from older desks.
    #[serde(default)]
    pub levels: std::collections::BTreeMap<String, u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NoticeIn {
    pub text: String,
    /// "all", "host", a role ("timekeeper", "bible", "screens", "present"), or one desk by name.
    #[serde(default)]
    pub to: Option<NoticeTo>,
    /// "normal" or "urgent".
    #[serde(default)]
    pub priority: Option<String>,
    /// The run-of-show event it is about, if any.
    #[serde(default)]
    pub event: Option<String>,
    /// An action request (Comms C2): what the recipient is asked to get ready. It is only opened
    /// on their desk for them to act on; nothing runs by itself.
    #[serde(default)]
    pub action: Option<NoticeAction>,
}

/// Who a notice is for: a group ("all", "host" or a role), or one desk or person by its paired
/// name (`{"name": "Ade's phone"}`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum NoticeTo {
    Group(String),
    Named { name: String },
}

impl fmt::Display for NoticeTo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            NoticeTo::Group(g) => write!(f, "{g}"),
            NoticeTo::Named { name } => write!(f, "{name}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NoticeAction {
    /// "bible" (a reference), "song" (a song or hymn title), "scene" (a scene id), "event" (a
    /// run-of-show item id), "camera" (a camera's name: is it framed? the answer is Ready or Unable)
    /// or "wrap" (a wrap-up warning: the line to put on the stage display).
    pub kind: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NoticeAckIn {
    pub id: String,
    /// "seen", "ready" or "unable".
    pub state: String,
}

/// A scene sent from a joined desk to be saved: the scene, checked and made safe on the host. Like
/// every command, it carries the revisions the desk saw (`seen`, "scene:<id>"), so a change made
/// from an older copy is refused (`crate::http`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SceneSave {
    pub scene: serde_json::Value,
    /// Set by the host's server only, never by a desk: the change waits for the main desk to accept it.
    #[serde(default, skip_deserializing)]
    pub request: bool,
}

/// A scene to delete, by id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SceneDelete {
    pub id: String,
    /// As for `SceneSave`: set by the host's server only.
    #[serde(default, skip_deserializing)]
    pub request: bool,
}

impl SceneSave {
    /// The scene's id, as the desk sent it ("" when it has none).
    #[must_use]
    pub fn id(&self) -> &str {
        self.scene.get("id").and_then(serde_json::Value::as_str).unwrap_or("")
    }
}

/// Which scene goes on which output (ids, as the host's Live State lists them).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SceneTake {
    pub output: String,
    pub scene: String,
}

impl RemoteCommand {
    /// Crew talk, not a service command (Rhema Comms, #251): notices, their answers and the talk
    /// channel. These keep working for a desk the main desk has taken back control from.
    #[must_use]
    pub fn is_comms(&self) -> bool {
        matches!(self, RemoteCommand::NoticeSend(_) | RemoteCommand::NoticeAck(_) | RemoteCommand::VoiceTalk(_) | RemoteCommand::VoiceLeave | RemoteCommand::VoiceChannels(_))
    }
}

impl fmt::Display for RemoteCommand {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RemoteCommand::Next => write!(f, "next"),
            RemoteCommand::Prev => write!(f, "prev"),
            RemoteCommand::Show => write!(f, "show"),
            RemoteCommand::Hide => write!(f, "hide"),
            RemoteCommand::Theme(name) => write!(f, "theme({name})"),
            RemoteCommand::Opacity(val) => write!(f, "opacity({val:.2})"),
            RemoteCommand::Confidence(val) => write!(f, "confidence({val:.2})"),
            RemoteCommand::OnAir(active) => write!(f, "on_air({active})"),
            RemoteCommand::SendToLive => write!(f, "send_to_live"),
            RemoteCommand::BibleNext => write!(f, "bible_next"),
            RemoteCommand::BiblePrev => write!(f, "bible_prev"),
            RemoteCommand::AddToQueue => write!(f, "add_to_queue"),
            RemoteCommand::VerseNext => write!(f, "verse_next"),
            RemoteCommand::VersePrev => write!(f, "verse_prev"),
            RemoteCommand::Macro(id) => write!(f, "macro({id})"),
            RemoteCommand::EventNext => write!(f, "event_next"),
            RemoteCommand::EventPrev => write!(f, "event_prev"),
            RemoteCommand::EventStart(id) => write!(f, "event_start({id})"),
            RemoteCommand::EventOffset(m) => write!(f, "event_offset({m:+})"),
            RemoteCommand::TimerStart => write!(f, "timer_start"),
            RemoteCommand::TimerPause => write!(f, "timer_pause"),
            RemoteCommand::TimerAdjust(m) => write!(f, "timer_adjust({m:+})"),
            RemoteCommand::Hold(None) => write!(f, "hold"),
            RemoteCommand::Hold(Some(r)) => write!(f, "hold({r})"),
            RemoteCommand::Resume => write!(f, "resume"),
            RemoteCommand::BibleActivate(r) => write!(f, "bible_activate({r})"),
            RemoteCommand::BiblePreview(r) => write!(f, "bible_preview({r})"),
            RemoteCommand::SongShow(t) => write!(f, "song_show({t})"),
            RemoteCommand::SongPreview(t) => write!(f, "song_preview({t})"),
            RemoteCommand::SongSection(SectionMove::Step(n)) => write!(f, "song_section({n:+})"),
            RemoteCommand::SongSection(SectionMove::To(SectionTarget::Chorus)) => write!(f, "song_section(chorus)"),
            RemoteCommand::ClearSource(id) => write!(f, "clear_source({id})"),
            RemoteCommand::RestoreSource(id) => write!(f, "restore_source({id})"),
            RemoteCommand::TakeScene(t) => write!(f, "take_scene({} → {})", t.scene, t.output),
            RemoteCommand::ReleaseScene(o) => write!(f, "release_scene({o})"),
            RemoteCommand::SaveScene(s) => write!(f, "save_scene({})", s.id()),
            RemoteCommand::DeleteScene(d) => write!(f, "delete_scene({})", d.id),
            RemoteCommand::StageMessage(m) => write!(f, "stage_message({m})"),
            RemoteCommand::ObsPreview(scene) => write!(f, "obs_preview({scene})"),
            RemoteCommand::ObsTake => write!(f, "obs_take"),
            RemoteCommand::ObsProgram(scene) => write!(f, "obs_program({scene})"),
            RemoteCommand::NoticeSend(n) => write!(f, "notice_send(to {})", n.to.as_ref().map_or_else(|| "all".to_string(), ToString::to_string)),
            RemoteCommand::NoticeAck(a) => write!(f, "notice_ack({} {})", a.id, a.state),
            RemoteCommand::VoiceTalk(on) => write!(f, "voice_talk({on})"),
            RemoteCommand::VoiceLeave => write!(f, "voice_leave"),
            RemoteCommand::VoiceChannels(c) => write!(f, "voice_channels({} {:?})", c.talk, c.listen),
            RemoteCommand::AuxTimer(t) => write!(f, "aux_timer({} {})", t.action, t.id),
            RemoteCommand::QueueRequest(q) => write!(f, "queue_request({} {})", q.kind.as_str(), q.value),
            RemoteCommand::ObsRecord(r) => write!(f, "obs_record({})", r.action.as_str()),
            RemoteCommand::ObsTransition(t) => write!(f, "obs_transition({t})"),
        }
    }
}

/// Constant-time equality for shared keys: the time taken does not depend
/// on where the first differing byte is, so a sender on the LAN cannot
/// guess the key byte by byte from response timing.
#[must_use]
pub fn same_key(presented: &str, expected: &str) -> bool {
    let (a, b) = (presented.as_bytes(), expected.as_bytes());
    let mut diff = u8::from(a.len() != b.len());
    for i in 0..a.len().max(b.len()) {
        diff |= a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(0);
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Serde serialization tests ---

    #[test]
    fn serialize_and_parse_macro() {
        assert_eq!(serde_json::to_value(&RemoteCommand::Macro("service-start".into())).unwrap(), serde_json::json!({"command": "macro", "value": "service-start"}));
        let cmd: RemoteCommand = serde_json::from_str(r#"{"command":"macro","value":"offering"}"#).unwrap();
        assert_eq!(cmd, RemoteCommand::Macro("offering".into()));
    }

    #[test]
    fn serialize_and_parse_verse_next_prev() {
        assert_eq!(serde_json::to_value(&RemoteCommand::VerseNext).unwrap(), serde_json::json!({"command": "verse_next"}));
        assert_eq!(serde_json::to_value(&RemoteCommand::VersePrev).unwrap(), serde_json::json!({"command": "verse_prev"}));
        let cmd: RemoteCommand = serde_json::from_str(r#"{"command":"verse_next"}"#).unwrap();
        assert_eq!(cmd, RemoteCommand::VerseNext);
        assert_eq!(RemoteCommand::VersePrev.to_string(), "verse_prev");
    }

    #[test]
    fn serialize_next() {
        let json = serde_json::to_value(&RemoteCommand::Next).unwrap();
        assert_eq!(json, serde_json::json!({"command": "next"}));
    }

    #[test]
    fn serialize_prev() {
        let json = serde_json::to_value(&RemoteCommand::Prev).unwrap();
        assert_eq!(json, serde_json::json!({"command": "prev"}));
    }

    #[test]
    fn serialize_show() {
        let json = serde_json::to_value(&RemoteCommand::Show).unwrap();
        assert_eq!(json, serde_json::json!({"command": "show"}));
    }

    #[test]
    fn serialize_hide() {
        let json = serde_json::to_value(&RemoteCommand::Hide).unwrap();
        assert_eq!(json, serde_json::json!({"command": "hide"}));
    }

    #[test]
    fn serialize_theme() {
        let json = serde_json::to_value(&RemoteCommand::Theme("Dark".into())).unwrap();
        assert_eq!(json, serde_json::json!({"command": "theme", "value": "Dark"}));
    }

    #[test]
    fn serialize_opacity() {
        let json = serde_json::to_value(&RemoteCommand::Opacity(0.75)).unwrap();
        assert_eq!(json, serde_json::json!({"command": "opacity", "value": 0.75}));
    }

    #[test]
    fn serialize_confidence() {
        let json = serde_json::to_value(&RemoteCommand::Confidence(0.75)).unwrap();
        assert_eq!(json, serde_json::json!({"command": "confidence", "value": 0.75}));
    }

    #[test]
    fn serialize_on_air() {
        let json = serde_json::to_value(&RemoteCommand::OnAir(true)).unwrap();
        assert_eq!(json, serde_json::json!({"command": "on_air", "value": true}));
    }

    #[test]
    fn serialize_send_to_live() {
        let json = serde_json::to_value(&RemoteCommand::SendToLive).unwrap();
        assert_eq!(json, serde_json::json!({"command": "send_to_live"}));
    }

    #[test]
    fn serialize_bible_next() {
        let json = serde_json::to_value(&RemoteCommand::BibleNext).unwrap();
        assert_eq!(json, serde_json::json!({"command": "bible_next"}));
    }

    #[test]
    fn serialize_bible_prev() {
        let json = serde_json::to_value(&RemoteCommand::BiblePrev).unwrap();
        assert_eq!(json, serde_json::json!({"command": "bible_prev"}));
    }

    #[test]
    fn serialize_add_to_queue() {
        let json = serde_json::to_value(&RemoteCommand::AddToQueue).unwrap();
        assert_eq!(json, serde_json::json!({"command": "add_to_queue"}));
    }

    // --- Serde deserialization tests ---

    #[test]
    fn deserialize_next() {
        let cmd: RemoteCommand = serde_json::from_str(r#"{"command":"next"}"#).unwrap();
        assert_eq!(cmd, RemoteCommand::Next);
    }

    #[test]
    fn deserialize_theme() {
        let cmd: RemoteCommand =
            serde_json::from_str(r#"{"command":"theme","value":"Minimal"}"#).unwrap();
        assert_eq!(cmd, RemoteCommand::Theme("Minimal".into()));
    }

    #[test]
    fn deserialize_confidence() {
        let cmd: RemoteCommand =
            serde_json::from_str(r#"{"command":"confidence","value":0.75}"#).unwrap();
        assert_eq!(cmd, RemoteCommand::Confidence(0.75));
    }

    #[test]
    fn deserialize_send_to_live() {
        let cmd: RemoteCommand = serde_json::from_str(r#"{"command":"send_to_live"}"#).unwrap();
        assert_eq!(cmd, RemoteCommand::SendToLive);
    }

    #[test]
    fn deserialize_bible_next() {
        let cmd: RemoteCommand = serde_json::from_str(r#"{"command":"bible_next"}"#).unwrap();
        assert_eq!(cmd, RemoteCommand::BibleNext);
    }

    #[test]
    fn deserialize_bible_prev() {
        let cmd: RemoteCommand = serde_json::from_str(r#"{"command":"bible_prev"}"#).unwrap();
        assert_eq!(cmd, RemoteCommand::BiblePrev);
    }

    #[test]
    fn deserialize_add_to_queue() {
        let cmd: RemoteCommand = serde_json::from_str(r#"{"command":"add_to_queue"}"#).unwrap();
        assert_eq!(cmd, RemoteCommand::AddToQueue);
    }

    // --- Round-trip tests ---

    #[test]
    fn roundtrip_all_variants() {
        let variants = vec![
            RemoteCommand::Next,
            RemoteCommand::Prev,
            RemoteCommand::Show,
            RemoteCommand::Hide,
            RemoteCommand::Theme("Classic Dark".into()),
            RemoteCommand::Opacity(0.5),
            RemoteCommand::Confidence(0.9),
            RemoteCommand::OnAir(false),
            RemoteCommand::SendToLive,
            RemoteCommand::BibleNext,
            RemoteCommand::BiblePrev,
            RemoteCommand::AddToQueue,
        ];

        for cmd in variants {
            let json = serde_json::to_string(&cmd).unwrap();
            let deserialized: RemoteCommand = serde_json::from_str(&json).unwrap();
            assert_eq!(cmd, deserialized, "Round-trip failed for {cmd}");
        }
    }

    // --- Display tests ---

    #[test]
    fn display_next() {
        assert_eq!(RemoteCommand::Next.to_string(), "next");
    }

    #[test]
    fn display_prev() {
        assert_eq!(RemoteCommand::Prev.to_string(), "prev");
    }

    #[test]
    fn display_theme() {
        assert_eq!(
            RemoteCommand::Theme("X".into()).to_string(),
            "theme(X)"
        );
    }

    #[test]
    fn display_opacity() {
        assert_eq!(RemoteCommand::Opacity(0.75).to_string(), "opacity(0.75)");
    }

    #[test]
    fn display_confidence() {
        assert_eq!(
            RemoteCommand::Confidence(0.80).to_string(),
            "confidence(0.80)"
        );
    }

    #[test]
    fn display_on_air() {
        assert_eq!(RemoteCommand::OnAir(true).to_string(), "on_air(true)");
        assert_eq!(RemoteCommand::OnAir(false).to_string(), "on_air(false)");
    }

    #[test]
    fn display_send_to_live() {
        assert_eq!(RemoteCommand::SendToLive.to_string(), "send_to_live");
    }

    #[test]
    fn display_bible_next() {
        assert_eq!(RemoteCommand::BibleNext.to_string(), "bible_next");
    }

    #[test]
    fn display_bible_prev() {
        assert_eq!(RemoteCommand::BiblePrev.to_string(), "bible_prev");
    }

    #[test]
    fn display_add_to_queue() {
        assert_eq!(RemoteCommand::AddToQueue.to_string(), "add_to_queue");
    }

    // --- Exhaustive match test ---

    #[test]
    fn enum_has_exactly_15_variants() {
        // This test ensures all 12 variants are covered.
        // If a new variant is added, this match will fail to compile.
        let cmds: Vec<RemoteCommand> = vec![
            RemoteCommand::Next,
            RemoteCommand::Prev,
            RemoteCommand::Show,
            RemoteCommand::Hide,
            RemoteCommand::Theme(String::new()),
            RemoteCommand::Opacity(0.0),
            RemoteCommand::Confidence(0.0),
            RemoteCommand::OnAir(false),
            RemoteCommand::SendToLive,
            RemoteCommand::BibleNext,
            RemoteCommand::BiblePrev,
            RemoteCommand::AddToQueue,
            RemoteCommand::VerseNext,
            RemoteCommand::VersePrev,
            RemoteCommand::Macro("x".into()),
            RemoteCommand::EventNext,
            RemoteCommand::EventPrev,
            RemoteCommand::EventStart("x".into()),
            RemoteCommand::EventOffset(5),
            RemoteCommand::TimerStart,
            RemoteCommand::TimerPause,
            RemoteCommand::TimerAdjust(-1),
            RemoteCommand::Hold(Some("Waiting for the pastor".into())),
            RemoteCommand::Resume,
            RemoteCommand::BibleActivate("John 3:16".into()),
            RemoteCommand::BiblePreview("John 3:16".into()),
            RemoteCommand::SongShow("Amazing Grace".into()),
            RemoteCommand::SongPreview("Amazing Grace".into()),
            RemoteCommand::SongSection(1.into()),
            RemoteCommand::ClearSource("bible".into()),
            RemoteCommand::RestoreSource("bible".into()),
            RemoteCommand::TakeScene(SceneTake { output: "main".into(), scene: "s".into() }),
            RemoteCommand::ReleaseScene("main".into()),
            RemoteCommand::SaveScene(SceneSave { scene: serde_json::json!({ "id": "s1" }), request: false }),
            RemoteCommand::DeleteScene(SceneDelete { id: "s1".into(), request: false }),
            RemoteCommand::StageMessage("Wrap up".into()),
            RemoteCommand::ObsPreview("Sermon".into()),
            RemoteCommand::ObsTake,
            RemoteCommand::ObsProgram("Wide".into()),
            RemoteCommand::NoticeSend(NoticeIn { text: "Pulpit mic is ready".into(), to: None, priority: None, event: None, action: None }),
            RemoteCommand::NoticeAck(NoticeAckIn { id: "n1".into(), state: "seen".into() }),
            RemoteCommand::VoiceTalk(true),
            RemoteCommand::VoiceLeave,
            RemoteCommand::VoiceChannels(VoiceChannelsIn { listen: vec!["stage".into()], talk: "production".into(), levels: Default::default() }),
            RemoteCommand::AuxTimer(AuxTimerIn { id: "t".into(), action: "start".into() }),
            RemoteCommand::QueueRequest(QueueIn { kind: QueueKind::Bible, value: "Romans 8:28".into() }),
            RemoteCommand::ObsRecord(ObsRecordIn { action: RecordAction::Marker, label: None }),
            RemoteCommand::ObsTransition("Fade".into()),
        ];

        for cmd in &cmds {
            match cmd {
                RemoteCommand::Next => {}
                RemoteCommand::Prev => {}
                RemoteCommand::Show => {}
                RemoteCommand::Hide => {}
                RemoteCommand::Theme(_) => {}
                RemoteCommand::Opacity(_) => {}
                RemoteCommand::Confidence(_) => {}
                RemoteCommand::OnAir(_) => {}
                RemoteCommand::SendToLive => {}
                RemoteCommand::VerseNext => {}
                RemoteCommand::VersePrev => {}
                RemoteCommand::Macro(_) => {}
                RemoteCommand::BibleNext => {}
                RemoteCommand::BiblePrev => {}
                RemoteCommand::AddToQueue => {}
                RemoteCommand::EventNext | RemoteCommand::EventPrev | RemoteCommand::EventStart(_) | RemoteCommand::EventOffset(_) | RemoteCommand::TimerStart | RemoteCommand::TimerPause | RemoteCommand::TimerAdjust(_) | RemoteCommand::Hold(_) | RemoteCommand::Resume => {}
                RemoteCommand::BibleActivate(_) | RemoteCommand::BiblePreview(_) | RemoteCommand::SongShow(_) | RemoteCommand::SongPreview(_) | RemoteCommand::SongSection(_) | RemoteCommand::ClearSource(_) | RemoteCommand::RestoreSource(_) | RemoteCommand::TakeScene(_) | RemoteCommand::ReleaseScene(_) => {}
                RemoteCommand::SaveScene(_) | RemoteCommand::DeleteScene(_) | RemoteCommand::StageMessage(_) | RemoteCommand::ObsPreview(_) | RemoteCommand::ObsTake | RemoteCommand::ObsProgram(_) => {}
                RemoteCommand::NoticeSend(_) | RemoteCommand::NoticeAck(_) | RemoteCommand::VoiceTalk(_) | RemoteCommand::VoiceLeave | RemoteCommand::VoiceChannels(_) => {}
                RemoteCommand::AuxTimer(_) => {}
                RemoteCommand::QueueRequest(_) | RemoteCommand::ObsRecord(_) | RemoteCommand::ObsTransition(_) => {}
            }
        }

        assert_eq!(cmds.len(), 48);
        assert_eq!(serde_json::from_str::<RemoteCommand>(r#"{"command":"timer_adjust","value":1}"#).unwrap(), RemoteCommand::TimerAdjust(1));
        assert_eq!(serde_json::from_str::<RemoteCommand>(r#"{"command":"timer_start"}"#).unwrap(), RemoteCommand::TimerStart);
        let off: RemoteCommand = serde_json::from_str(r#"{"command":"event_offset","value":-5}"#).unwrap();
        assert_eq!(off, RemoteCommand::EventOffset(-5));
        let ch: RemoteCommand = serde_json::from_str(r#"{"command":"voice_channels","value":{"listen":["stage"],"talk":"to:Ade bible"}}"#).unwrap();
        assert!(matches!(ch, RemoteCommand::VoiceChannels(VoiceChannelsIn { ref talk, ref levels, .. }) if talk == "to:Ade bible" && levels.is_empty()), "levels are optional (older desks)");
        // Per-person levels (#251): percent by name; anything else in them refuses the command.
        let lv: RemoteCommand = serde_json::from_str(r#"{"command":"voice_channels","value":{"listen":[],"talk":"all","levels":{"Ade":0,"to:host":40}}}"#).unwrap();
        assert!(matches!(lv, RemoteCommand::VoiceChannels(VoiceChannelsIn { ref levels, .. }) if levels.get("Ade") == Some(&0) && levels.get("to:host") == Some(&40)));
        assert!(serde_json::from_str::<RemoteCommand>(r#"{"command":"voice_channels","value":{"talk":"all","levels":{"Ade":"loud"}}}"#).is_err());
        assert!(serde_json::from_str::<RemoteCommand>(r#"{"command":"voice_channels","value":{"talk":"all","levels":{"Ade":900}}}"#).is_err());
        let talk: RemoteCommand = serde_json::from_str(r#"{"command":"voice_talk","value":true}"#).unwrap();
        assert_eq!(talk, RemoteCommand::VoiceTalk(true));
        let leave: RemoteCommand = serde_json::from_str(r#"{"command":"voice_leave"}"#).unwrap();
        assert_eq!(leave, RemoteCommand::VoiceLeave);
        let n: RemoteCommand = serde_json::from_str(r#"{"command":"notice_send","value":{"text":"Wrap up in 5","to":"present","priority":"urgent"}}"#).unwrap();
        assert!(matches!(n, RemoteCommand::NoticeSend(NoticeIn { ref to, .. }) if *to == Some(NoticeTo::Group("present".into()))));
        let named: RemoteCommand = serde_json::from_str(r#"{"command":"notice_send","value":{"text":"Mic 2 is yours","to":{"name":"Ade's phone"}}}"#).unwrap();
        assert!(matches!(named, RemoteCommand::NoticeSend(NoticeIn { ref to, .. }) if *to == Some(NoticeTo::Named { name: "Ade's phone".into() })));
        assert_eq!(named.to_string(), "notice_send(to Ade's phone)");
        let take: RemoteCommand = serde_json::from_str(r#"{"command":"take_scene","value":{"output":"main","scene":"s1"}}"#).unwrap();
        assert_eq!(take, RemoteCommand::TakeScene(SceneTake { output: "main".into(), scene: "s1".into() }));
    }

    #[test]
    fn hold_and_resume_parse_with_or_without_a_reason() {
        assert_eq!(serde_json::from_str::<RemoteCommand>(r#"{"command":"hold","value":"Waiting for the pastor"}"#).unwrap(), RemoteCommand::Hold(Some("Waiting for the pastor".into())));
        assert_eq!(serde_json::from_str::<RemoteCommand>(r#"{"command":"hold"}"#).unwrap(), RemoteCommand::Hold(None));
        assert_eq!(serde_json::from_str::<RemoteCommand>(r#"{"command":"hold","value":null}"#).unwrap(), RemoteCommand::Hold(None));
        assert_eq!(serde_json::from_str::<RemoteCommand>(r#"{"command":"resume"}"#).unwrap(), RemoteCommand::Resume);
        assert_eq!(serde_json::to_value(&RemoteCommand::Resume).unwrap(), serde_json::json!({"command": "resume"}));
        assert_eq!(serde_json::to_value(&RemoteCommand::Hold(Some("x".into()))).unwrap(), serde_json::json!({"command": "hold", "value": "x"}));
        assert!(serde_json::from_str::<RemoteCommand>(r#"{"command":"hold","value":5}"#).is_err());
        assert_eq!(RemoteCommand::Hold(Some("tech".into())).to_string(), "hold(tech)");
        assert_eq!(RemoteCommand::Hold(None).to_string(), "hold");
        assert!(!RemoteCommand::Hold(None).is_comms() && !RemoteCommand::Resume.is_comms(), "a paused desk cannot hold the service");
    }

    #[test]
    fn scene_edits_parse_and_a_desk_cannot_say_they_need_no_approval() {
        let save: RemoteCommand = serde_json::from_str(r#"{"command":"save_scene","value":{"scene":{"id":"s1","name":"Sermon"},"request":false}}"#).unwrap();
        let RemoteCommand::SaveScene(ref s) = save else { panic!("save_scene") };
        assert_eq!((s.id(), s.request), ("s1", false));
        let asked: RemoteCommand = serde_json::from_str(r#"{"command":"save_scene","value":{"scene":{"id":"s1"},"request":true}}"#).unwrap();
        assert!(matches!(asked, RemoteCommand::SaveScene(SceneSave { request: false, .. })), "only the host's server sets request");
        assert_eq!(save.to_string(), "save_scene(s1)");
        let del: RemoteCommand = serde_json::from_str(r#"{"command":"delete_scene","value":{"id":"s1"}}"#).unwrap();
        assert_eq!(del, RemoteCommand::DeleteScene(SceneDelete { id: "s1".into(), request: false }));
        assert_eq!(serde_json::from_str::<RemoteCommand>(r#"{"command":"stage_message","value":"Wrap up"}"#).unwrap(), RemoteCommand::StageMessage("Wrap up".into()));
        assert_eq!(serde_json::from_str::<RemoteCommand>(r#"{"command":"obs_take"}"#).unwrap(), RemoteCommand::ObsTake);
        assert_eq!(serde_json::from_str::<RemoteCommand>(r#"{"command":"obs_preview","value":"Sermon"}"#).unwrap(), RemoteCommand::ObsPreview("Sermon".into()));
        assert_eq!(RemoteCommand::ObsProgram("Wide".into()).to_string(), "obs_program(Wide)");
        assert!(serde_json::from_str::<RemoteCommand>(r#"{"command":"save_scene","value":{"name":"x"}}"#).is_err(), "a scene is needed");
    }

    #[test]
    fn desk_console_commands_parse_and_a_plain_reference_still_works() {
        let plain: RemoteCommand = serde_json::from_str(r#"{"command":"bible_activate","value":"John 3:16"}"#).unwrap();
        assert_eq!(plain, RemoteCommand::BibleActivate("John 3:16".into()));
        let with: RemoteCommand = serde_json::from_str(r#"{"command":"bible_activate","value":{"reference":"John 3:16","translation":"YOR"}}"#).unwrap();
        let RemoteCommand::BibleActivate(ref r) = with else { panic!("bible_activate") };
        assert_eq!((r.reference(), r.translation().as_deref()), ("John 3:16", Some("YOR")));
        assert_eq!(with.to_string(), "bible_activate(John 3:16 YOR)");
        let odd = BibleRef::With { reference: "Ps 23".into(), translation: Some(" <b>KJV</b>\n".into()) };
        assert_eq!(odd.translation().as_deref(), Some("bKJVb"), "letters and digits only, never markup");
        assert_eq!(BibleRef::With { reference: "Ps 23".into(), translation: Some("  ".into()) }.translation(), None);
        assert_eq!(serde_json::from_str::<RemoteCommand>(r#"{"command":"song_section","value":-1}"#).unwrap(), RemoteCommand::SongSection((-1).into()));
        assert!(serde_json::from_str::<RemoteCommand>(r#"{"command":"song_section","value":"next"}"#).is_err());
        assert_eq!(RemoteCommand::SongSection(1.into()).to_string(), "song_section(+1)");
    }

    #[test]
    fn round_two_console_commands_parse_and_anything_else_is_refused() {
        // Repeat chorus is a section step by name.
        let chorus: RemoteCommand = serde_json::from_str(r#"{"command":"song_section","value":"chorus"}"#).unwrap();
        assert_eq!(chorus, RemoteCommand::SongSection(SectionMove::To(SectionTarget::Chorus)));
        assert_eq!(chorus.to_string(), "song_section(chorus)");
        assert_eq!(serde_json::to_value(&chorus).unwrap(), serde_json::json!({ "command": "song_section", "value": "chorus" }));
        assert!(serde_json::from_str::<RemoteCommand>(r#"{"command":"song_section","value":"bridge"}"#).is_err(), "only the chorus by name");
        // Queue a request: a verse or a song only.
        let q: RemoteCommand = serde_json::from_str(r#"{"command":"queue_request","value":{"kind":"song","value":"Amazing Grace"}}"#).unwrap();
        assert_eq!(q, RemoteCommand::QueueRequest(QueueIn { kind: QueueKind::Song, value: "Amazing Grace".into() }));
        assert_eq!(q.to_string(), "queue_request(song Amazing Grace)");
        for odd in [r#"{"command":"queue_request","value":{"kind":"scene","value":"s1"}}"#, r#"{"command":"queue_request","value":{"kind":"bible"}}"#, r#"{"command":"queue_request","value":"Romans 8:28"}"#] {
            assert!(serde_json::from_str::<RemoteCommand>(odd).is_err(), "{odd}");
        }
        // OBS's recording and transition.
        let start: RemoteCommand = serde_json::from_str(r#"{"command":"obs_record","value":{"action":"start"}}"#).unwrap();
        assert_eq!(start, RemoteCommand::ObsRecord(ObsRecordIn { action: RecordAction::Start, label: None }));
        let mark: RemoteCommand = serde_json::from_str(r#"{"command":"obs_record","value":{"action":"marker","label":"Sermon"}}"#).unwrap();
        assert!(matches!(mark, RemoteCommand::ObsRecord(ObsRecordIn { action: RecordAction::Marker, label: Some(ref l) }) if l == "Sermon"));
        assert_eq!(mark.to_string(), "obs_record(marker)");
        assert!(serde_json::from_str::<RemoteCommand>(r#"{"command":"obs_record","value":{"action":"pause"}}"#).is_err());
        assert_eq!(serde_json::from_str::<RemoteCommand>(r#"{"command":"obs_transition","value":"Fade"}"#).unwrap(), RemoteCommand::ObsTransition("Fade".into()));
        for cmd in [q, start, mark, RemoteCommand::ObsTransition("Cut".into())] {
            assert!(!cmd.is_comms(), "{cmd}: a service command, refused for a paused desk");
        }
    }

    #[test]
    fn same_key_compares_whole_strings() {
        assert!(same_key("s3cret", "s3cret"));
        assert!(!same_key("s3cret", "s3cres"));
        assert!(!same_key("s3cret", "s3cret1"));
        assert!(!same_key("", "x"));
        assert!(same_key("", ""));
    }
}
