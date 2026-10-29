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
    /// Where a file of the media folder is (`<hash>.<ext>`, already checked), for a browser feed
    /// that plays a scene's video layer (#243 SC.9). None where there is none.
    fn media_file(&self, _file: &str) -> Option<std::path::PathBuf> {
        None
    }
    /// Answer a joined desk's lookup in this computer's library (`crate::lookup`), already checked
    /// for its role. An error is said to the desk as it is.
    fn lookup(&self, _q: &crate::lookup::Lookup) -> Result<serde_json::Value, String> {
        Err("this host cannot look that up".into())
    }
}

/// A sink that adds `"by"` (the sender) to every frontend event it carries.
struct Signed<'a> {
    inner: &'a dyn CommandSink,
    by: &'a str,
    by_id: Option<&'a str>,
    group_take: Option<&'a crate::command::GroupSceneTake>,
}

impl CommandSink for Signed<'_> {
    fn emit_event(&self, event: &str, payload: &str) -> Result<(), CommandError> {
        match serde_json::from_str::<serde_json::Value>(payload) {
            Ok(serde_json::Value::Object(mut m)) => {
                m.insert("by".into(), self.by.into());
                if event == "remote:group_take_scene" {
                    if let Some(take) = self.group_take {
                        m.insert(
                            "requestId".into(),
                            serde_json::json!(take.request_id.as_deref()),
                        );
                        m.insert("seen".into(), serde_json::json!(&take.seen));
                        m.insert("service".into(), serde_json::json!(take.service.as_deref()));
                        m.insert("byId".into(), serde_json::json!(self.by_id));
                    }
                }
                self.inner
                    .emit_event(event, &serde_json::Value::Object(m).to_string())
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
        Self::dispatch_from(cmd, sink, by, None)
    }

    /// Like `dispatch_as`, with the sending key's id (its hash) for a production notice and the
    /// talk channel: the host keeps it on the notice as `fromId`, and knows each talker by it, so
    /// "sent by this desk" and "this desk's voice" are decided by the key, never by a name a desk
    /// could copy. Only the server sets it; nothing in a request can.
    pub fn dispatch_from(cmd: &RemoteCommand, sink: &dyn CommandSink, by: &str, by_id: Option<&str>) -> Result<(), CommandError> {
        let by: String = by.chars().take(60).collect();
        match cmd {
            RemoteCommand::NoticeSend(n) => sink.emit_event("remote:notice_send", &serde_json::json!({
                "byId": by_id,
                "text": n.text.chars().take(280).collect::<String>(), "to": match &n.to {
                    None => serde_json::json!("all"),
                    Some(crate::command::NoticeTo::Group(g)) => serde_json::json!(g),
                    Some(crate::command::NoticeTo::Named { name }) => serde_json::json!({ "name": name.trim().chars().take(60).collect::<String>() }),
                },
                "priority": if n.priority.as_deref() == Some("urgent") { "urgent" } else { "normal" }, "event": n.event, "by": by,
                "action": n.action.as_ref().filter(|a| matches!(a.kind.as_str(), "bible" | "song" | "scene" | "event" | "camera" | "wrap")).map(|a| serde_json::json!({ "kind": a.kind, "value": a.value.chars().take(120).collect::<String>() })),
            }).to_string()),
            RemoteCommand::NoticeAck(a) => sink.emit_event("remote:notice_ack", &serde_json::json!({ "id": a.id, "state": a.state, "by": by }).to_string()),
            // The talk channel knows each desk by its key id (`byId`), never by its name (#251).
            RemoteCommand::VoiceTalk(on) => sink.emit_event("remote:voice_talk", &serde_json::json!({ "on": on, "by": by, "byId": by_id }).to_string()),
            RemoteCommand::VoiceLeave => sink.emit_event("remote:voice_leave", &serde_json::json!({ "by": by, "byId": by_id }).to_string()),
            RemoteCommand::EventOffset(m) => sink.emit_event("remote:event_offset", &serde_json::json!({ "minutes": (*m).clamp(-30, 30), "by": by }).to_string()),
            RemoteCommand::TimerStart => sink.emit_event("remote:timer_start", &serde_json::json!({ "by": by }).to_string()),
            RemoteCommand::TimerPause => sink.emit_event("remote:timer_pause", &serde_json::json!({ "by": by }).to_string()),
            RemoteCommand::TimerAdjust(m) => sink.emit_event("remote:timer_adjust", &serde_json::json!({ "minutes": (*m).clamp(-10, 10), "by": by }).to_string()),
            // The reason is a short line for the stage and the log (80 characters, one line).
            RemoteCommand::Hold(r) => sink.emit_event("remote:hold", &serde_json::json!({ "reason": r.as_deref().unwrap_or("").split_whitespace().collect::<Vec<_>>().join(" ").chars().take(80).collect::<String>(), "by": by }).to_string()),
            RemoteCommand::Resume => sink.emit_event("remote:resume", &serde_json::json!({ "by": by }).to_string()),
            RemoteCommand::AuxTimer(t) => sink.emit_event("remote:aux_timer", &serde_json::json!({ "id": t.id.chars().take(100).collect::<String>(), "action": t.action, "by": by }).to_string()),
            // A scene from a joined desk (#243 SC.16) names the sending key, so a change that waits for
            // the main desk is a request from that desk, which it then sees answered. The host logs
            // what it did with it itself.
            RemoteCommand::SaveScene(s) => sink.emit_event("remote:save_scene", &serde_json::json!({ "scene": s.scene, "request": s.request, "baseRevision": s.base_revision, "by": by, "byId": by_id }).to_string()),
            RemoteCommand::DeleteScene(d) => sink.emit_event("remote:delete_scene", &serde_json::json!({ "id": d.id.chars().take(100).collect::<String>(), "request": d.request, "baseRevision": d.base_revision, "by": by, "byId": by_id }).to_string()),
            // Levels: at most 32 people, each name short and each level at most 100 (percent).
            RemoteCommand::VoiceChannels(c) => sink.emit_event("remote:voice_channels", &serde_json::json!({ "listen": c.listen.iter().take(8).map(|s| s.chars().take(80).collect::<String>()).collect::<Vec<_>>(), "talk": c.talk.chars().take(84).collect::<String>(), "levels": c.levels.iter().take(32).map(|(k, v)| (k.chars().take(84).collect::<String>(), serde_json::json!((*v).min(100)))).collect::<serde_json::Map<_, _>>(), "by": by, "byId": by_id }).to_string()),
            // Rhema's own recorder runs on the host: the backend does it, with who asked (doc 42).
            RemoteCommand::Record(r) => {
                let label = r.label.as_deref().unwrap_or("").split_whitespace().collect::<Vec<_>>().join(" ").chars().take(60).collect::<String>();
                let done = sink.invoke_backend("recorder", &serde_json::json!({ "action": r.action.as_str(), "label": label, "by": by }).to_string());
                if done.is_ok() {
                    let _ = sink.emit_event("remote:audit", &serde_json::json!({ "command": cmd.to_string(), "by": by }).to_string());
                }
                done
            }
            other => {
                // Who sent it rides along in the command's own event, so the host can say who
                // activated a source ("Bible · Romans 8:28 · by Femi's laptop").
                let group_take = match other { RemoteCommand::GroupTakeScene(take) => Some(take), _ => None };
                let done = Self::dispatch(other, &Signed { inner: sink, by: &by, by_id, group_take });
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
            RemoteCommand::NoticeSend(_) | RemoteCommand::NoticeAck(_) | RemoteCommand::VoiceTalk(_) | RemoteCommand::VoiceLeave | RemoteCommand::VoiceChannels(_) | RemoteCommand::SaveScene(_) | RemoteCommand::DeleteScene(_) | RemoteCommand::EventOffset(_) | RemoteCommand::TimerStart | RemoteCommand::TimerPause | RemoteCommand::TimerAdjust(_) | RemoteCommand::Hold(_) | RemoteCommand::Resume | RemoteCommand::AuxTimer(_) | RemoteCommand::Record(_) => Self::dispatch_as(cmd, sink, "a remote"),
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
            // The translation a Bible desk chose rides along only when it named one (older hosts' events are unchanged).
            RemoteCommand::BibleActivate(r) => sink.emit_event("remote:bible_activate", &match r.translation() {
                Some(t) => serde_json::json!({ "reference": r.reference(), "translation": t }),
                None => serde_json::json!({ "reference": r.reference() }),
            }.to_string()),
            RemoteCommand::BiblePreview(reference) => sink.emit_event("remote:bible_preview", &serde_json::json!({ "reference": reference.chars().take(120).collect::<String>() }).to_string()),
            RemoteCommand::SongShow(title) => sink.emit_event("remote:song_show", &serde_json::json!({ "title": title.chars().take(120).collect::<String>() }).to_string()),
            RemoteCommand::SongPreview(title) => sink.emit_event("remote:song_preview", &serde_json::json!({ "title": title.chars().take(120).collect::<String>() }).to_string()),
            // One section at a time, either way; or the chorus again.
            RemoteCommand::SongSection(crate::command::SectionMove::Step(n)) => sink.emit_event("remote:song_section", &serde_json::json!({ "step": (*n).signum() }).to_string()),
            RemoteCommand::SongSection(crate::command::SectionMove::To(crate::command::SectionTarget::Chorus)) => sink.emit_event("remote:song_section", &serde_json::json!({ "to": "chorus" }).to_string()),
            RemoteCommand::QueueRequest(q) => sink.emit_event("remote:queue_request", &serde_json::json!({ "kind": q.kind.as_str(), "value": q.value.trim().chars().take(120).collect::<String>() }).to_string()),
            // A marker's name is one short line (60 characters), as the main desk's own.
            RemoteCommand::ObsRecord(r) => sink.emit_event("remote:obs_record", &serde_json::json!({ "action": r.action.as_str(), "label": r.label.as_deref().unwrap_or("").split_whitespace().collect::<Vec<_>>().join(" ").chars().take(60).collect::<String>() }).to_string()),
            RemoteCommand::ObsTransition(name) => sink.emit_event("remote:obs_transition", &serde_json::json!({ "name": name.chars().take(200).collect::<String>() }).to_string()),
            RemoteCommand::ClearSource(id) => sink.emit_event("remote:clear_source", &serde_json::json!({ "id": id }).to_string()),
            RemoteCommand::RestoreSource(id) => sink.emit_event("remote:restore_source", &serde_json::json!({ "id": id }).to_string()),
            RemoteCommand::TakeScene(t) => sink.emit_event("remote:take_scene", &serde_json::json!({ "output": t.output, "scene": t.scene }).to_string()),
            RemoteCommand::GroupTakeScene(t) => sink.emit_event("remote:group_take_scene", &serde_json::json!({ "outputs": t.outputs, "scene": t.scene }).to_string()),
            RemoteCommand::ReleaseScene(output) => sink.emit_event("remote:release_scene", &serde_json::json!({ "output": output }).to_string()),
            // One line of at most 120 characters, as the main desk's own stage message box.
            RemoteCommand::StageMessage(text) => sink.emit_event("remote:stage_message", &serde_json::json!({ "text": text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(120).collect::<String>() }).to_string()),
            RemoteCommand::ObsPreview(scene) => sink.emit_event("remote:obs_preview", &serde_json::json!({ "scene": scene.chars().take(200).collect::<String>() }).to_string()),
            RemoteCommand::ObsTake => sink.emit_event("remote:obs_take", "{}"),
            RemoteCommand::ObsProgram(scene) => sink.emit_event("remote:obs_program", &serde_json::json!({ "scene": scene.chars().take(200).collect::<String>() }).to_string()),
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
    fn hold_and_resume_carry_who_and_a_short_reason() {
        let sink = MockSink::new();
        CommandDispatcher::dispatch_as(&RemoteCommand::Hold(Some(format!("  waiting   for\nthe pastor {}", "x".repeat(200)))), &sink, "Timekeeper desk").unwrap();
        let (event, payload) = sink.last_event();
        assert_eq!(event, "remote:hold");
        let v: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(v["by"], "Timekeeper desk");
        let reason = v["reason"].as_str().unwrap();
        assert_eq!(reason.chars().count(), 80, "at most 80 characters");
        assert!(reason.starts_with("waiting for the pastor x"), "one line: {reason}");
        CommandDispatcher::dispatch_as(&RemoteCommand::Hold(None), &sink, "Timekeeper desk").unwrap();
        assert_eq!(sink.last_event(), ("remote:hold".to_string(), r#"{"by":"Timekeeper desk","reason":""}"#.to_string()));
        CommandDispatcher::dispatch(&RemoteCommand::Resume, &sink).unwrap();
        assert_eq!(sink.last_event(), ("remote:resume".to_string(), r#"{"by":"a remote"}"#.to_string()));
        assert_eq!(sink.event_count(), 3, "the host logs these itself: no separate audit line");
    }

    #[test]
    fn an_extra_timer_goes_to_the_host_with_who_sent_it() {
        let sink = MockSink::new();
        let cmd = RemoteCommand::AuxTimer(crate::command::AuxTimerIn { id: "x".repeat(150), action: "start".into() });
        CommandDispatcher::dispatch_from(&cmd, &sink, "Worship desk", Some("k1")).unwrap();
        let (event, payload) = sink.last_event();
        assert_eq!(event, "remote:aux_timer");
        let v: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!((v["action"].as_str(), v["by"].as_str(), v["id"].as_str().map(str::len)), (Some("start"), Some("Worship desk"), Some(100)));
        assert_eq!(serde_json::from_str::<RemoteCommand>(r#"{"command":"aux_timer","value":{"id":"a","action":"pause"}}"#).unwrap(), RemoteCommand::AuxTimer(crate::command::AuxTimerIn { id: "a".into(), action: "pause".into() }));
    }

    #[test]
    fn dispatch_operator_commands_emit_events() {
        let sink = MockSink::new();
        for (cmd, name, has) in [
            (RemoteCommand::BibleActivate("Romans 8:28".into()), "remote:bible_activate", "Romans 8:28"),
            (RemoteCommand::BiblePreview("Romans 8:28".into()), "remote:bible_preview", "Romans 8:28"),
            (RemoteCommand::SongShow("Amazing Grace".into()), "remote:song_show", "Amazing Grace"),
            (RemoteCommand::SongPreview("Great Is Thy Faithfulness".into()), "remote:song_preview", "Great Is Thy Faithfulness"),
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
    fn desk_console_commands_emit_their_events() {
        let sink = MockSink::new();
        let chosen = RemoteCommand::BibleActivate(crate::command::BibleRef::With { reference: "John 3:16".into(), translation: Some("YOR".into()) });
        CommandDispatcher::dispatch(&chosen, &sink).unwrap();
        assert_eq!(sink.last_event(), ("remote:bible_activate".to_string(), r#"{"reference":"John 3:16","translation":"YOR"}"#.to_string()));
        CommandDispatcher::dispatch(&RemoteCommand::BibleActivate("John 3:16".into()), &sink).unwrap();
        assert_eq!(sink.last_event().1, r#"{"reference":"John 3:16"}"#, "a plain reference is as before");
        CommandDispatcher::dispatch(&RemoteCommand::SongSection(5.into()), &sink).unwrap();
        assert_eq!(sink.last_event(), ("remote:song_section".to_string(), r#"{"step":1}"#.to_string()), "one section at a time");
        CommandDispatcher::dispatch(&RemoteCommand::SongSection((-3).into()), &sink).unwrap();
        assert_eq!(sink.last_event().1, r#"{"step":-1}"#);
        let chorus = RemoteCommand::SongSection(crate::command::SectionMove::To(crate::command::SectionTarget::Chorus));
        CommandDispatcher::dispatch(&chorus, &sink).unwrap();
        assert_eq!(sink.last_event(), ("remote:song_section".to_string(), r#"{"to":"chorus"}"#.to_string()), "repeat chorus");
    }

    #[test]
    fn round_two_console_commands_emit_their_events_with_who_and_a_log_line() {
        use crate::command::{ObsRecordIn, QueueIn, QueueKind, RecordAction};
        let sink = MockSink::new();
        let q = RemoteCommand::QueueRequest(QueueIn { kind: QueueKind::Bible, value: format!("  Romans 8:28 {}", "x".repeat(200)) });
        CommandDispatcher::dispatch_as(&q, &sink, "Ade's phone").unwrap();
        let all = sink.events.lock().unwrap().clone();
        let v: serde_json::Value = serde_json::from_str(&all[all.len() - 2].1).unwrap();
        assert_eq!((all[all.len() - 2].0.as_str(), v["kind"].as_str(), v["by"].as_str()), ("remote:queue_request", Some("bible"), Some("Ade's phone")));
        assert!(v["value"].as_str().unwrap().starts_with("Romans 8:28") && v["value"].as_str().unwrap().chars().count() == 120);
        assert_eq!(all[all.len() - 1].0, "remote:audit", "in the service log with who");
        let mark = RemoteCommand::ObsRecord(ObsRecordIn { action: RecordAction::Marker, label: Some(format!(" Sermon \n starts {}", "y".repeat(100))) });
        CommandDispatcher::dispatch_as(&mark, &sink, "OBS desk").unwrap();
        let all = sink.events.lock().unwrap().clone();
        let v: serde_json::Value = serde_json::from_str(&all[all.len() - 2].1).unwrap();
        assert_eq!((all[all.len() - 2].0.as_str(), v["action"].as_str()), ("remote:obs_record", Some("marker")));
        let label = v["label"].as_str().unwrap();
        assert!(label.starts_with("Sermon starts y") && label.chars().count() == 60, "{label}");
        CommandDispatcher::dispatch(&RemoteCommand::ObsRecord(ObsRecordIn { action: RecordAction::Stop, label: None }), &sink).unwrap();
        assert_eq!(sink.last_event().1, r#"{"action":"stop","label":""}"#);
        CommandDispatcher::dispatch(&RemoteCommand::ObsTransition("Stinger".into()), &sink).unwrap();
        assert_eq!(sink.last_event(), ("remote:obs_transition".to_string(), r#"{"name":"Stinger"}"#.to_string()));
    }

    #[test]
    fn scene_edits_name_the_desk_and_the_new_commands_emit_events() {
        let sink = MockSink::new();
        let save = RemoteCommand::SaveScene(crate::command::SceneSave { scene: serde_json::json!({ "id": "s1", "name": "Sermon" }), request: true, base_revision: None });
        CommandDispatcher::dispatch_from(&save, &sink, "Ade screens", Some("k1")).unwrap();
        let (event, payload) = sink.last_event();
        assert_eq!(event, "remote:save_scene");
        let v: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!((v["scene"]["name"].as_str(), v["request"].as_bool(), v["by"].as_str(), v["byId"].as_str()), (Some("Sermon"), Some(true), Some("Ade screens"), Some("k1")));
        assert_eq!(sink.event_count(), 1, "the host logs scene edits itself: no separate audit line");
        let del = RemoteCommand::DeleteScene(crate::command::SceneDelete { id: "s1".into(), request: false, base_revision: None });
        CommandDispatcher::dispatch(&del, &sink).unwrap();
        let v: serde_json::Value = serde_json::from_str(&sink.last_event().1).unwrap();
        assert_eq!((sink.last_event().0.as_str(), v["id"].as_str(), v["by"].as_str()), ("remote:delete_scene", Some("s1"), Some("a remote")));
        CommandDispatcher::dispatch(&RemoteCommand::StageMessage(format!("  Wrap \n up {}", "x".repeat(200))), &sink).unwrap();
        let (event, payload) = sink.last_event();
        let text = serde_json::from_str::<serde_json::Value>(&payload).unwrap()["text"].as_str().unwrap().to_string();
        assert_eq!(event, "remote:stage_message");
        assert!(text.starts_with("Wrap up x") && text.chars().count() == 120, "{text}");
        for (cmd, name) in [(RemoteCommand::ObsPreview("Sermon".into()), "remote:obs_preview"), (RemoteCommand::ObsTake, "remote:obs_take"), (RemoteCommand::ObsProgram("Wide".into()), "remote:obs_program")] {
            CommandDispatcher::dispatch_as(&cmd, &sink, "OBS desk").unwrap();
            let all = sink.events.lock().unwrap().clone();
            assert_eq!(all[all.len() - 2].0, name);
            assert_eq!(all[all.len() - 1].0, "remote:audit", "an OBS switch from a desk is in the service log with who");
        }
    }

    #[test]
    fn notices_carry_who_sent_them() {
        let sink = MockSink::new();
        let n = RemoteCommand::NoticeSend(crate::command::NoticeIn { text: "x".repeat(400), to: Some(crate::command::NoticeTo::Group("present".into())), priority: Some("urgent".into()), event: Some("sermon".into()), action: Some(crate::command::NoticeAction { kind: "bible".into(), value: "Romans 8:28".into() }) });
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
        for kind in ["song", "camera", "wrap"] {
            let asks = RemoteCommand::NoticeSend(crate::command::NoticeIn { text: "x".into(), to: None, priority: None, event: None, action: Some(crate::command::NoticeAction { kind: kind.into(), value: "Amazing Grace".into() }) });
            CommandDispatcher::dispatch_as(&asks, &sink, "x").unwrap();
            assert_eq!(serde_json::from_str::<serde_json::Value>(&sink.last_event().1).unwrap()["action"]["kind"], kind, "a song or hymn, camera ready and a wrap-up warning");
        }
        let named = RemoteCommand::NoticeSend(crate::command::NoticeIn { text: "Mic 2 is yours".into(), to: Some(crate::command::NoticeTo::Named { name: " Ade's phone ".into() }), priority: None, event: None, action: None });
        CommandDispatcher::dispatch_as(&named, &sink, "Main").unwrap();
        assert_eq!(serde_json::from_str::<serde_json::Value>(&sink.last_event().1).unwrap()["to"], serde_json::json!({ "name": "Ade's phone" }), "one desk by name");
        assert!(serde_json::from_str::<serde_json::Value>(&sink.last_event().1).unwrap()["byId"].is_null(), "no key, no id");
        CommandDispatcher::dispatch_from(&named, &sink, "Ade's phone", Some("abc123")).unwrap();
        assert_eq!(serde_json::from_str::<serde_json::Value>(&sink.last_event().1).unwrap()["byId"], "abc123", "the sending key's id, from the server");
        // The talk channel: every voice event names the key, so the host routes by it, not by the name.
        let levels = [("Ade".to_string(), 30u8), ("to:host".to_string(), 250u8)].into_iter().collect();
        let ch = RemoteCommand::VoiceChannels(crate::command::VoiceChannelsIn { listen: vec![], talk: "to:Ade's phone".into(), levels });
        CommandDispatcher::dispatch_from(&ch, &sink, "Ade's phone", Some("abc123")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&sink.last_event().1).unwrap();
        assert_eq!(v["levels"], serde_json::json!({ "Ade": 30, "to:host": 100 }), "each person's level, at most 100");
        for cmd in [RemoteCommand::VoiceTalk(true), RemoteCommand::VoiceLeave, ch] {
            CommandDispatcher::dispatch_from(&cmd, &sink, "Ade's phone", Some("abc123")).unwrap();
            let v: serde_json::Value = serde_json::from_str(&sink.last_event().1).unwrap();
            assert_eq!((v["by"].as_str(), v["byId"].as_str()), (Some("Ade's phone"), Some("abc123")), "{cmd}");
        }
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
