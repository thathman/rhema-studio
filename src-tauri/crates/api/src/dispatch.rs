use crate::command::RemoteCommand;
use crate::error::CommandError;

/// Trait abstracting how commands reach the application.
///
/// Frontend-bound commands (queue navigation, theme, opacity, on-air) go through
/// `emit_event` which maps to Tauri event emission. Backend-bound commands
/// (show/hide broadcast windows, confidence threshold) go through `invoke_backend`.
///
/// This trait keeps the `rhema-api` crate free of any `tauri` dependency,
/// following the pattern established by `rhema-stt` and `rhema-detection`.
pub trait CommandSink: Send + Sync {
    fn emit_event(&self, event: &str, payload: &str) -> Result<(), CommandError>;
    fn invoke_backend(&self, action: &str, args: &str) -> Result<(), CommandError>;
    /// A file of the app's own built frontend (`feed.html`, `assets/…`) and its type, for the
    /// browser feed page (ARCH-002). None where there is none (tests, development).
    fn asset(&self, _path: &str) -> Option<(Vec<u8>, String)> {
        None
    }
}

/// A sink that adds `"by"` (the sender) to every frontend event it carries.
struct Signed<'a> {
    inner: &'a dyn CommandSink,
    by: &'a str,
}

impl CommandSink for Signed<'_> {
    fn emit_event(&self, event: &str, payload: &str) -> Result<(), CommandError> {
        match serde_json::from_str::<serde_json::Value>(payload) {
            Ok(serde_json::Value::Object(mut m)) => {
                m.insert("by".into(), self.by.into());
                self.inner.emit_event(event, &serde_json::Value::Object(m).to_string())
            }
            _ => self.inner.emit_event(event, payload),
        }
    }
    fn invoke_backend(&self, action: &str, args: &str) -> Result<(), CommandError> {
        self.inner.invoke_backend(action, args)
    }
}

/// Routes `RemoteCommand` variants to the correct sink method.
///
/// Frontend-bound (`emit_event`): Next, Prev, Theme, Opacity, `OnAir`,
/// `SendToLive`, `BibleNext`, `BiblePrev`, `AddToQueue`
/// Backend-bound (`invoke_backend`): Show, Hide, Confidence
pub struct CommandDispatcher;

impl CommandDispatcher {
    /// Like `dispatch`, naming who sent it (the paired device's name): in production notices and
    /// their answers (Rhema Comms, #251), and as `"by"` in every other command's event.
    pub fn dispatch_as(cmd: &RemoteCommand, sink: &dyn CommandSink, by: &str) -> Result<(), CommandError> {
        let by: String = by.chars().take(60).collect();
        match cmd {
            RemoteCommand::NoticeSend(n) => sink.emit_event("remote:notice_send", &serde_json::json!({
                "text": n.text.chars().take(280).collect::<String>(), "to": n.to.as_deref().unwrap_or("all"),
                "priority": if n.priority.as_deref() == Some("urgent") { "urgent" } else { "normal" }, "event": n.event, "by": by,
                "action": n.action.as_ref().filter(|a| matches!(a.kind.as_str(), "bible" | "scene" | "event")).map(|a| serde_json::json!({ "kind": a.kind, "value": a.value.chars().take(120).collect::<String>() })),
            }).to_string()),
            RemoteCommand::NoticeAck(a) => sink.emit_event("remote:notice_ack", &serde_json::json!({ "id": a.id, "state": a.state, "by": by }).to_string()),
            RemoteCommand::VoiceTalk(on) => sink.emit_event("remote:voice_talk", &serde_json::json!({ "on": on, "by": by }).to_string()),
            RemoteCommand::VoiceLeave => sink.emit_event("remote:voice_leave", &serde_json::json!({ "by": by }).to_string()),
            RemoteCommand::EventOffset(m) => sink.emit_event("remote:event_offset", &serde_json::json!({ "minutes": (*m).clamp(-30, 30), "by": by }).to_string()),
            RemoteCommand::TimerStart => sink.emit_event("remote:timer_start", &serde_json::json!({ "by": by }).to_string()),
            RemoteCommand::TimerPause => sink.emit_event("remote:timer_pause", &serde_json::json!({ "by": by }).to_string()),
            RemoteCommand::TimerAdjust(m) => sink.emit_event("remote:timer_adjust", &serde_json::json!({ "minutes": (*m).clamp(-10, 10), "by": by }).to_string()),
            RemoteCommand::VoiceChannels(c) => sink.emit_event("remote:voice_channels", &serde_json::json!({ "listen": c.listen.iter().take(8).map(|s| s.chars().take(80).collect::<String>()).collect::<Vec<_>>(), "talk": c.talk.chars().take(84).collect::<String>(), "by": by }).to_string()),
            other => {
                // Who sent it rides along in the command's own event, so the host can say who
                // activated a source ("Bible · Romans 8:28 · by Femi's laptop").
                let done = Self::dispatch(other, &Signed { inner: sink, by: &by });
                // The service log's record of it, with who sent it (#246 C17): one self-contained
                // event, so concurrent requests can never swap their names.
                if done.is_ok() {
                    let _ = sink.emit_event("remote:audit", &serde_json::json!({ "command": other.to_string(), "by": by }).to_string());
                }
                done
            }
        }
    }

    pub fn dispatch(
        cmd: &RemoteCommand,
        sink: &dyn CommandSink,
    ) -> Result<(), CommandError> {
        match cmd {
            RemoteCommand::NoticeSend(_) | RemoteCommand::NoticeAck(_) | RemoteCommand::VoiceTalk(_) | RemoteCommand::VoiceLeave | RemoteCommand::VoiceChannels(_) | RemoteCommand::EventOffset(_) | RemoteCommand::TimerStart | RemoteCommand::TimerPause | RemoteCommand::TimerAdjust(_) => Self::dispatch_as(cmd, sink, "a remote"),
            RemoteCommand::Next => sink.emit_event("remote:next", "{}"),
            RemoteCommand::Prev => sink.emit_event("remote:prev", "{}"),
            RemoteCommand::Theme(name) => {
                let payload = serde_json::json!({ "name": name }).to_string();
                sink.emit_event("remote:theme", &payload)
            }
            RemoteCommand::Opacity(val) => {
                let payload = serde_json::json!({ "value": val }).to_string();
                sink.emit_event("remote:opacity", &payload)
            }
            RemoteCommand::OnAir(active) => {
                let payload = serde_json::json!({ "active": active }).to_string();
                sink.emit_event("remote:on_air", &payload)
            }
            RemoteCommand::SendToLive => sink.emit_event("remote:send_to_live", "{}"),
            RemoteCommand::BibleNext => sink.emit_event("remote:bible_next", "{}"),
            RemoteCommand::BiblePrev => sink.emit_event("remote:bible_prev", "{}"),
            RemoteCommand::AddToQueue => sink.emit_event("remote:add_to_queue", "{}"),
            RemoteCommand::VerseNext => sink.emit_event("remote:verse_next", "{}"),
            RemoteCommand::VersePrev => sink.emit_event("remote:verse_prev", "{}"),
            RemoteCommand::Macro(id) => {
                let payload = serde_json::json!({ "id": id }).to_string();
                sink.emit_event("remote:macro", &payload)
            }
            RemoteCommand::EventNext => sink.emit_event("remote:event_next", "{}"),
            RemoteCommand::EventPrev => sink.emit_event("remote:event_prev", "{}"),
            RemoteCommand::EventStart(id) => {
                let payload = serde_json::json!({ "id": id }).to_string();
                sink.emit_event("remote:event_start", &payload)
            }
            RemoteCommand::BibleActivate(reference) => sink.emit_event("remote:bible_activate", &serde_json::json!({ "reference": reference }).to_string()),
            RemoteCommand::ClearSource(id) => sink.emit_event("remote:clear_source", &serde_json::json!({ "id": id }).to_string()),
            RemoteCommand::RestoreSource(id) => sink.emit_event("remote:restore_source", &serde_json::json!({ "id": id }).to_string()),
            RemoteCommand::TakeScene(t) => sink.emit_event("remote:take_scene", &serde_json::json!({ "output": t.output, "scene": t.scene }).to_string()),
            RemoteCommand::ReleaseScene(output) => sink.emit_event("remote:release_scene", &serde_json::json!({ "output": output }).to_string()),
            RemoteCommand::Show => sink.invoke_backend("show_broadcast", "{}"),
            RemoteCommand::Hide => sink.invoke_backend("hide_broadcast", "{}"),
            RemoteCommand::Confidence(val) => {
                let payload = serde_json::json!({ "value": val }).to_string();
                sink.invoke_backend("set_confidence", &payload)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Mock sink that records all calls for assertion.
    struct MockSink {
        events: Mutex<Vec<(String, String)>>,
        backend_calls: Mutex<Vec<(String, String)>>,
    }

    impl MockSink {
        fn new() -> Self {
            Self {
                events: Mutex::new(Vec::new()),
                backend_calls: Mutex::new(Vec::new()),
            }
        }

        fn event_count(&self) -> usize {
            self.events.lock().unwrap().len()
        }

        fn backend_count(&self) -> usize {
            self.backend_calls.lock().unwrap().len()
        }

        fn last_event(&self) -> (String, String) {
            self.events.lock().unwrap().last().unwrap().clone()
        }

        fn last_backend(&self) -> (String, String) {
            self.backend_calls.lock().unwrap().last().unwrap().clone()
        }
    }

    impl CommandSink for MockSink {
        fn emit_event(&self, event: &str, payload: &str) -> Result<(), CommandError> {
            self.events
                .lock()
                .unwrap()
                .push((event.to_string(), payload.to_string()));
            Ok(())
        }

        fn invoke_backend(&self, action: &str, args: &str) -> Result<(), CommandError> {
            self.backend_calls
                .lock()
                .unwrap()
                .push((action.to_string(), args.to_string()));
            Ok(())
        }
    }

    /// Sink that always returns errors, for error propagation testing.
    struct ErrorSink;

    impl CommandSink for ErrorSink {
        fn emit_event(&self, _event: &str, _payload: &str) -> Result<(), CommandError> {
            Err(CommandError::DispatchFailed("test error".into()))
        }

        fn invoke_backend(&self, _action: &str, _args: &str) -> Result<(), CommandError> {
            Err(CommandError::DispatchFailed("test error".into()))
        }
    }

    // --- Frontend-bound command tests ---

    #[test]
    fn dispatch_next_emits_event() {
        let sink = MockSink::new();
        CommandDispatcher::dispatch(&RemoteCommand::Next, &sink).unwrap();
        assert_eq!(sink.event_count(), 1);
        assert_eq!(sink.backend_count(), 0);
        assert_eq!(sink.last_event().0, "remote:next");
    }

    #[test]
    fn dispatch_prev_emits_event() {
        let sink = MockSink::new();
        CommandDispatcher::dispatch(&RemoteCommand::Prev, &sink).unwrap();
        assert_eq!(sink.event_count(), 1);
        assert_eq!(sink.backend_count(), 0);
        assert_eq!(sink.last_event().0, "remote:prev");
    }

    #[test]
    fn dispatch_theme_emits_event_with_name() {
        let sink = MockSink::new();
        CommandDispatcher::dispatch(&RemoteCommand::Theme("Dark Mode".into()), &sink).unwrap();
        assert_eq!(sink.event_count(), 1);
        assert_eq!(sink.backend_count(), 0);
        let (event, payload) = sink.last_event();
        assert_eq!(event, "remote:theme");
        assert!(payload.contains("Dark Mode"));
    }

    #[test]
    fn dispatch_opacity_emits_event_with_value() {
        let sink = MockSink::new();
        CommandDispatcher::dispatch(&RemoteCommand::Opacity(0.75), &sink).unwrap();
        assert_eq!(sink.event_count(), 1);
        assert_eq!(sink.backend_count(), 0);
        let (event, payload) = sink.last_event();
        assert_eq!(event, "remote:opacity");
        assert!(payload.contains("0.75"));
    }

    #[test]
    fn dispatch_on_air_emits_event_with_active() {
        let sink = MockSink::new();
        CommandDispatcher::dispatch(&RemoteCommand::OnAir(true), &sink).unwrap();
        assert_eq!(sink.event_count(), 1);
        assert_eq!(sink.backend_count(), 0);
        let (event, payload) = sink.last_event();
        assert_eq!(event, "remote:on_air");
        assert!(payload.contains("true"));
    }

    // The event name is the whole contract with the frontend listener — no
    // compiler or type checker crosses that boundary, so each one is pinned
    // here as a literal and again in src/lib/remote-events.ts.

    #[test]
    fn dispatch_send_to_live_emits_event() {
        let sink = MockSink::new();
        CommandDispatcher::dispatch(&RemoteCommand::SendToLive, &sink).unwrap();
        assert_eq!(sink.event_count(), 1);
        assert_eq!(sink.backend_count(), 0);
        assert_eq!(sink.last_event().0, "remote:send_to_live");
    }

    #[test]
    fn dispatch_macro_emits_event_with_id() {
        let sink = MockSink::new();
        CommandDispatcher::dispatch(&RemoteCommand::Macro("offering".into()), &sink).unwrap();
        let (name, payload) = sink.last_event();
        assert_eq!(name, "remote:macro");
        assert!(payload.contains("offering"));
    }

    #[test]
    fn dispatch_event_clock_emits_events() {
        let sink = MockSink::new();
        CommandDispatcher::dispatch(&RemoteCommand::EventNext, &sink).unwrap();
        assert_eq!(sink.last_event().0, "remote:event_next");
        CommandDispatcher::dispatch(&RemoteCommand::EventPrev, &sink).unwrap();
        assert_eq!(sink.last_event().0, "remote:event_prev");
        CommandDispatcher::dispatch(&RemoteCommand::EventStart("sermon".into()), &sink).unwrap();
        let (name, payload) = sink.last_event();
        assert_eq!(name, "remote:event_start");
        assert!(payload.contains("sermon"));
        CommandDispatcher::dispatch_as(&RemoteCommand::EventOffset(90), &sink, "Timekeeper").unwrap();
        let (name, payload) = sink.last_event();
        assert_eq!(name, "remote:event_offset");
        assert_eq!(payload, r#"{"by":"Timekeeper","minutes":30}"#, "one step is at most 30 minutes, with who sent it");
        CommandDispatcher::dispatch_as(&RemoteCommand::TimerAdjust(-25), &sink, "Timekeeper").unwrap();
        assert_eq!(sink.last_event(), ("remote:timer_adjust".to_string(), r#"{"by":"Timekeeper","minutes":-10}"#.to_string()));
    }

    #[test]
    fn dispatch_operator_commands_emit_events() {
        let sink = MockSink::new();
        for (cmd, name, has) in [
            (RemoteCommand::BibleActivate("Romans 8:28".into()), "remote:bible_activate", "Romans 8:28"),
            (RemoteCommand::ClearSource("bible".into()), "remote:clear_source", "bible"),
            (RemoteCommand::RestoreSource("hymn".into()), "remote:restore_source", "hymn"),
            (RemoteCommand::TakeScene(crate::command::SceneTake { output: "main".into(), scene: "split".into() }), "remote:take_scene", "split"),
            (RemoteCommand::ReleaseScene("main".into()), "remote:release_scene", "main"),
        ] {
            CommandDispatcher::dispatch(&cmd, &sink).unwrap();
            let (event, payload) = sink.last_event();
            assert_eq!(event, name);
            assert!(payload.contains(has), "{payload}");
        }
    }

    #[test]
    fn notices_carry_who_sent_them() {
        let sink = MockSink::new();
        let n = RemoteCommand::NoticeSend(crate::command::NoticeIn { text: "x".repeat(400), to: Some("present".into()), priority: Some("urgent".into()), event: Some("sermon".into()), action: Some(crate::command::NoticeAction { kind: "bible".into(), value: "Romans 8:28".into() }) });
        CommandDispatcher::dispatch_as(&n, &sink, "Femi's laptop").unwrap();
        let (event, payload) = sink.last_event();
        assert_eq!(event, "remote:notice_send");
        let v: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(v["by"], "Femi's laptop");
        // A screen command is recorded for the service log after it, with who sent it, in one event.
        let before = sink.events.lock().unwrap().len();
        CommandDispatcher::dispatch_as(&RemoteCommand::BibleActivate("Psalm 23:1".into()), &sink, "Femi's laptop").unwrap();
        let ev = sink.events.lock().unwrap()[before..].to_vec();
        assert_eq!(ev[0].0, "remote:bible_activate");
        // The command itself names who sent it, so the host can record who activated the Bible.
        let cmd: serde_json::Value = serde_json::from_str(&ev[0].1).unwrap();
        assert_eq!((cmd["reference"].as_str(), cmd["by"].as_str()), (Some("Psalm 23:1"), Some("Femi's laptop")));
        assert_eq!(ev[1].0, "remote:audit");
        let audit: serde_json::Value = serde_json::from_str(&ev[1].1).unwrap();
        assert_eq!((audit["command"].as_str(), audit["by"].as_str()), (Some("bible_activate(Psalm 23:1)"), Some("Femi's laptop")));
        CommandDispatcher::dispatch_as(&RemoteCommand::VerseNext, &sink, "Femi's laptop").unwrap();
        let all = sink.events.lock().unwrap().clone();
        assert_eq!(all[all.len() - 2], ("remote:verse_next".to_string(), r#"{"by":"Femi's laptop"}"#.to_string()));
        assert_eq!(v["to"], "present");
        assert_eq!(v["priority"], "urgent");
        assert_eq!(v["text"].as_str().unwrap().chars().count(), 280);
        assert_eq!(v["action"], serde_json::json!({ "kind": "bible", "value": "Romans 8:28" }));
        let odd = RemoteCommand::NoticeSend(crate::command::NoticeIn { text: "x".into(), to: None, priority: None, event: None, action: Some(crate::command::NoticeAction { kind: "shell".into(), value: "rm".into() }) });
        CommandDispatcher::dispatch_as(&odd, &sink, "x").unwrap();
        assert!(serde_json::from_str::<serde_json::Value>(&sink.last_event().1).unwrap()["action"].is_null(), "unknown action kinds are dropped");
        CommandDispatcher::dispatch(&RemoteCommand::NoticeAck(crate::command::NoticeAckIn { id: "n1".into(), state: "ready".into() }), &sink).unwrap();
        let (event, payload) = sink.last_event();
        assert_eq!(event, "remote:notice_ack");
        assert!(payload.contains("a remote") && payload.contains("ready"));
    }

    #[test]
    fn dispatch_verse_next_prev_emit_events() {
        let sink = MockSink::new();
        CommandDispatcher::dispatch(&RemoteCommand::VerseNext, &sink).unwrap();
        assert_eq!(sink.last_event().0, "remote:verse_next");
        CommandDispatcher::dispatch(&RemoteCommand::VersePrev, &sink).unwrap();
        assert_eq!(sink.last_event().0, "remote:verse_prev");
    }

    #[test]
    fn dispatch_bible_next_emits_event() {
        let sink = MockSink::new();
        CommandDispatcher::dispatch(&RemoteCommand::BibleNext, &sink).unwrap();
        assert_eq!(sink.event_count(), 1);
        assert_eq!(sink.backend_count(), 0);
        assert_eq!(sink.last_event().0, "remote:bible_next");
    }

    #[test]
    fn dispatch_bible_prev_emits_event() {
        let sink = MockSink::new();
        CommandDispatcher::dispatch(&RemoteCommand::BiblePrev, &sink).unwrap();
        assert_eq!(sink.event_count(), 1);
        assert_eq!(sink.backend_count(), 0);
        assert_eq!(sink.last_event().0, "remote:bible_prev");
    }

    #[test]
    fn dispatch_add_to_queue_emits_event() {
        let sink = MockSink::new();
        CommandDispatcher::dispatch(&RemoteCommand::AddToQueue, &sink).unwrap();
        assert_eq!(sink.event_count(), 1);
        assert_eq!(sink.backend_count(), 0);
        assert_eq!(sink.last_event().0, "remote:add_to_queue");
    }

    // --- Backend-bound command tests ---

    #[test]
    fn dispatch_show_invokes_backend() {
        let sink = MockSink::new();
        CommandDispatcher::dispatch(&RemoteCommand::Show, &sink).unwrap();
        assert_eq!(sink.backend_count(), 1);
        assert_eq!(sink.event_count(), 0);
        assert_eq!(sink.last_backend().0, "show_broadcast");
    }

    #[test]
    fn dispatch_hide_invokes_backend() {
        let sink = MockSink::new();
        CommandDispatcher::dispatch(&RemoteCommand::Hide, &sink).unwrap();
        assert_eq!(sink.backend_count(), 1);
        assert_eq!(sink.event_count(), 0);
        assert_eq!(sink.last_backend().0, "hide_broadcast");
    }

    #[test]
    fn dispatch_confidence_invokes_backend_with_value() {
        let sink = MockSink::new();
        CommandDispatcher::dispatch(&RemoteCommand::Confidence(0.75), &sink).unwrap();
        assert_eq!(sink.backend_count(), 1);
        assert_eq!(sink.event_count(), 0);
        let (action, args) = sink.last_backend();
        assert_eq!(action, "set_confidence");
        assert!(args.contains("0.75"));
    }

    // --- Routing exclusivity tests ---

    #[test]
    fn frontend_commands_never_invoke_backend() {
        let frontend_cmds = vec![
            RemoteCommand::Next,
            RemoteCommand::Prev,
            RemoteCommand::Theme("test".into()),
            RemoteCommand::Opacity(0.5),
            RemoteCommand::OnAir(false),
            RemoteCommand::SendToLive,
            RemoteCommand::BibleNext,
            RemoteCommand::BiblePrev,
            RemoteCommand::AddToQueue,
            RemoteCommand::VerseNext,
            RemoteCommand::VersePrev,
            RemoteCommand::Macro("service-start".into()),
        ];

        for cmd in &frontend_cmds {
            let sink = MockSink::new();
            CommandDispatcher::dispatch(cmd, &sink).unwrap();
            assert_eq!(
                sink.backend_count(),
                0,
                "{cmd} should not call invoke_backend"
            );
            assert_eq!(sink.event_count(), 1, "{cmd} should call emit_event once");
        }
    }

    #[test]
    fn backend_commands_never_emit_events() {
        // Unchanged by the four commands added for #144 — all of them are
        // frontend-bound, so none belongs in this list.
        let backend_cmds = vec![
            RemoteCommand::Show,
            RemoteCommand::Hide,
            RemoteCommand::Confidence(0.5),
        ];

        for cmd in &backend_cmds {
            let sink = MockSink::new();
            CommandDispatcher::dispatch(cmd, &sink).unwrap();
            assert_eq!(sink.event_count(), 0, "{cmd} should not call emit_event");
            assert_eq!(
                sink.backend_count(),
                1,
                "{cmd} should call invoke_backend once"
            );
        }
    }

    // --- Error propagation tests ---

    #[test]
    fn emit_event_error_propagates() {
        let sink = ErrorSink;
        let result = CommandDispatcher::dispatch(&RemoteCommand::Next, &sink);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("test error"));
    }

    #[test]
    fn invoke_backend_error_propagates() {
        let sink = ErrorSink;
        let result = CommandDispatcher::dispatch(&RemoteCommand::Show, &sink);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("test error"));
    }
}
