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
}

/// Routes `RemoteCommand` variants to the correct sink method.
///
/// Frontend-bound (`emit_event`): Next, Prev, Theme, Opacity, `OnAir`,
/// `SendToLive`, `BibleNext`, `BiblePrev`, `AddToQueue`
/// Backend-bound (`invoke_backend`): Show, Hide, Confidence
pub struct CommandDispatcher;

impl CommandDispatcher {
    pub fn dispatch(
        cmd: &RemoteCommand,
        sink: &dyn CommandSink,
    ) -> Result<(), CommandError> {
        match cmd {
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
