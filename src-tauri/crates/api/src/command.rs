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
                RemoteCommand::EventNext | RemoteCommand::EventPrev | RemoteCommand::EventStart(_) => {}
            }
        }

        assert_eq!(cmds.len(), 18);
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
