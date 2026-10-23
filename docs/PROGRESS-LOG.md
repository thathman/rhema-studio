# Progress log

The durable record of autonomous development (owner directive, 2026-10-23). Newest first. Each entry:
main SHA checked, branch/PR, behaviour, tests, remaining work, blockers, next task, decisions. Task IDs are
the owner's (ARCH-001 to ARCH-005, COMMS-001, MCP-001 in #253); PRD and TASKS reconciliation is the owner's
periodic review, so feature PRs leave those files alone.

## 2026-10-23 — Planned time as typed (#196 R4)

- **Branch / PR:** `pt-007/duration-entry`. `run-of-show.ts`: `parseDuration` / `formatDuration` (to the second, ≤ 600 min); Prepare's planned-time field is a `DurationInput` (applied on Enter / blur, Escape undoes, a mistake is marked).
- **Tests:** `duration.test.ts` (every form, the limits, round trip). vitest 744.
## 2026-10-23 — Look and scene suggestions in AI drafts (MCP-004, #252)

- **Branch / PR:** `mcp-004/look-suggestions`. `mcp_drafts.rs`: `Looks` (built-in names plus `broadcast-themes.json` custom looks and scenes, read-only), `check_with` keeps `suggested_look` / `suggested_scene` (80 chars) and warns on unknown names; `mcp.rs`: `rhema_list_looks_and_scenes`, schema fields. Review shows them per item; `draftToRundown` does not carry them (decision: suggestions, not a data-model change).
- **Tests:** Rust `suggested_looks_and_scenes_are_kept_and_checked_against_the_church_s`; `builtin-looks.test.ts` keeps the Rust list equal to `BUILTIN_THEMES`. Desktop: `Rhema --mcp` (QA build, QA profile) over stdio: the tool is listed and names the 4 built-in looks, the profile's 7 own looks and 5 scenes; a draft with an unknown look and scene got both warnings; a known look typed in capitals was saved as the church spells it (that last part found here and fixed).

## 2026-10-23 — Cameras in scenes (OP-009, #209)

- **Branch / PR:** `op-009/whep-cameras`. `SceneLayer.cameraUrl` (WHEP), `src/lib/whep.ts` (`WhepPlayer`, `syncCameras`: receive-only, muted, retry every 4 s), drawn by `drawScene` (cover, crop); output windows signal through `whep_offer` (Rust, church-network addresses only: the windows' CSP keeps them from other hosts); browser feed pages fetch the WHEP address directly; a playing camera is drawn by the frame pacer at 30 fps on screens too.
- **Found on the desktop and fixed:** camera decoded but never drawn (animation-frame loop in a locked window; first frame not reported).
- **Tests:** Rust `cameras` (address check); `whep-cameras.test.ts` (fields, frame, player bookkeeping). Desktop: acceptance 10dc (stand-in WHEP camera). Screenshots in local `qa-screenshots/cameras/`. Real data 6/6, WebKit restored.
- **Still needs the owner:** MediaMTX and real phone cameras (#209), OBS and a Google TV.

## 2026-10-23 — Secure phone page (https) with a local CA (#251)

- **Branch / PR:** `comms-004/https-phones`. `rhema-api` `tls` (rcgen: local CA, 397-day server certificate, rustls config) and an https listener on the HTTP port + 1 (tokio-rustls + hyper-util, same router, peer address kept); `/rhema-ca.pem`; app `phone_tls` (CA in app data `tls/`, key 0600), `start_http(https)`, `tls_port` in status; Settings checkbox (off by default), pairing QR uses https when on.
- **Tests:** rhema-api `tls` and an https round trip trusting only the CA; listener restart test. Desktop: see acceptance 10cu.12. Real data 6/6, WebKit restored.

## 2026-10-23 — Voice: one consumer per remote track; where the delay builds up

- **Branch / PR:** `voice/one-consumer`. The host hub no longer plays each desk's track into a muted `<audio>` element; WebAudio is its only consumer.
- **Measured:** the delay builds up in the receiver's jitter buffer (target 40 ms, actual 323 → 1222 ms, samples dropped to catch up): playout ~10% slower than real time with the screen locked. With the extra element it grew from the start; without, a direct loop held ~121 ms for four rounds. Three-desk test unchanged (full duplex, no self-echo). Needs the unlocked two-computer rehearsal (ADR 0002 §4). Real data 6/6, WebKit restored.

## 2026-10-23 — Phone Talk (Comms C4)

- **Branch / PR:** `comms-004/phone-talk`. `remote.html` Talk: join (getUserMedia, offer to `/api/v1/voice` with the phone's key), hold to talk (pointer; release, blur, hidden page and leaving stop it), leave; a note where the page is not secure.
- **Tests:** `phone-remote.test.ts` (insecure page: note, no button). Desktop: headless Chrome with a fake microphone as the phone against the QA build (http://127.0.0.1 is a secure context): joined in ~1 s; crew marks followed press and release; a desk heard the phone only while it held Talk (first sound 0.3–0.7 s after a press, beep spacing included). The same run showed the delay build-up across processes (sound arriving seconds late): see the one-consumer fix PR and ADR 0002 §4.

## 2026-10-23 — MCP-003: prompts and draft revision (#252)

- **Branch / PR:** `mcp-003/prompts-revise`. `prompts/list`, `prompts/get` (`draft_service`, `reuse_service`, `check_service`); tools `rhema_list_service_drafts`, `rhema_update_service_draft` (`mcp_drafts::list`, `update`); Prepare shows "revised".
- **Tests:** `mcp` tests (prompts, unknown prompt / missing argument refused, read-only flags) and `mcp_drafts` (list, revise in place, bad id, removed draft). Desktop: `Rhema --mcp` over stdio from a script acting as the assistant: prompts, create, revise, unknown id refused, list; Prepare → AI drafts showed "revised" with three items. Real data 6/6, WebKit restored.

## 2026-10-23 — Production guide: when something fails (Comms C5 / #246 failure semantics)

- **Branch / PR:** `docs/when-it-fails`. A table of failures (network or listener, a joined computer, the talk channel, a stuck browser page, an NDI sender, a projector or sleeping display, Rhema itself), what keeps working, what the operator sees and what to do; each from behaviour verified on 2026-10-23.

## 2026-10-23 — Clock layer modes (#196 R2.4 / R2.6 / R2.7)

- **Branch / PR:** `arch-002/clock-modes`. `SceneLayer.clockShows` ("timer" default, "time", "until") and `until` ("HH:MM"); `untilClock` (today's, tomorrow's past 12 h), `clockText` "time"; composer "Shows" and the time field; normalize keeps valid values only.
- **Tests:** `scene-contracts.test.ts` (countdown, tomorrow, invalid, time of day, frames). Desktop: acceptance 10cx.4. Real data 6/6, WebKit restored.

## 2026-10-23 — Fixes from an independent review of the day's work

- **Branch / PR:** `review/today-fixes`.
- **Fixed:** the main desk's microphone could stay open (release during the permission prompt, double tap); talk routes per speaker/listener map, rebuilt on node change; late answers drop their peer; paired names unique and never "host" / "Main desk"; the service log records each remote command from one `remote:audit` event after it ran (no swapped names; OSC named); quick screens no second source line; browser feed clocks count by the host's time; trimmed recovery snapshots keep the live sources; snapshot saved as rehearsal starts; any orderly exit is clean (`RunEvent::Exit`); a desk closed while joining leaves.
- **Tests:** rhema-api 133 (audit event, unique names); `live-recovery.test.ts`, `source-followers.test.ts` (fails without the fix). Desktop: the host-mic release case (Desk A heard nothing, −192 dB), six concurrent commands from two devices all named right, channel and three-desk tone tests unchanged.
- **Found and recorded, not fixed:** voice delay builds up over seconds in single-window QA with a locked screen, also in a plain WebRTC loop (ADR 0002 §4); needs the two-computer rehearsal. A desk-side gain tried for it was reverted.

## 2026-10-23 — Show health (#213 P1, first slice)

- **Branch / PR:** `show-health`.
- **Behaviour:** `src/lib/show-health.ts` (`attention`, `showing`, `useFeedHealthStore`); Production → Screens rows with kind (browser feeds fixed), role, follows, showing now and signal; Needs attention list (NDI failing, NDI with no receiver, feed behind, feed with no page), real signals only.
- **Tests:** `src/studio/show-health.test.ts`; vitest green. Desktop: acceptance 10db.1. Real data 6/6, WebKit restored.
- **Not in reach yet (#213):** cameras, TV receivers, A/V alignment, LAN-off lab: need cameras / MediaMTX / a Google TV (owner).

## 2026-10-23 — Execution history: who did it, and scene takes (#246 C17)

- **Branch / PR:** `history/scenes-actors`.
- **Behaviour:** `dispatch_as` emits `remote:actor {by}` before a screen command's event (not for notices / voice); `noteRemote` appends "· by <name>"; journal kind `scene` for Takes and releases.
- **Tests:** rhema-api (actor before the command; the HTTP test sink counts commands only); `source-followers.test.ts` (SCENE lines). Desktop: acceptance 10cw.3. Real data 6/6, WebKit restored.

## 2026-10-23 — COMMS-001 C4 (part): talk channels and private calls

- **Branch / PR:** `comms-004/channels`.
- **Behaviour:** `voice_channels {listen, talk}`; host routing matrix (one gain per speaker → listener, `rewire`, `hears`); Talk to (All crew / channel / Only…) on both desks, Hear checkboxes on joined desks; crew list shows targets.
- **Tests:** rhema-api (`voice_channels` parse, 28 commands); `talk.test.tsx` (routing rule, names); in-app tone test (ADR 0002 §2a). Real data 6/6, WebKit restored.
- **Remaining C4:** phone voice (HTTPS decision), priority controls, revocation from the talk channel (revoking a key already ends its access at the next request; an open call continues until it leaves).

## 2026-10-23 — Recovery after an unexpected close (#246 live safety)

- **Branch / PR:** `live-recovery`.
- **Behaviour:** Rust `running.lock` in the app data folder (made at start, removed on the clean close path), `last_exit_unclean`; `src/lib/live-recovery.ts` keeps `recovery.json` (program, sources, outputs on, scenes, event; not in rehearsal; big pictures by name only) and offers it after an unclean exit when under 6 h old and something was up; `RecoveryBanner` (Put back / Not now); journal kind `recovery`.
- **Tests:** `app_close` lock test (Rust); `src/studio/live-recovery.test.ts` (snapshot, offer rules, put back, log). Desktop: acceptance 10da. Real data 6/6, WebKit restored.

## 2026-10-23 — ARCH-002: scene transitions

- **Branch / PR:** `arch-002/scene-fade`.
- **Behaviour:** `Scene.fadeMs` (0–3000; absent: cut) in `SceneFrame.fadeMs`; composer "Take: Cut / Fade 0.3 / 0.5 / 1 s". Output windows and the feed page snapshot the previous picture and cross-fade when the scene up changes (Take, release, another scene); Black / Logo always cut; a fade is motion (NDI pacer); a timer ends the fade when no animation frames come (covered or locked window).
- **Tests:** `scene-contracts.test.ts` (fade kept and clamped, in the frame, none for a cut); vitest green. Desktop: acceptance 10cz.1. Real data 6/6, WebKit restored.

## 2026-10-23 — Browser feed health (#246 item 9, receiver trust)

- **Branch / PR:** `arch-002/feed-health`.
- **Behaviour:** feed frames are numbered (SSE event id); `feed.html` acknowledges each drawn frame (`POST /api/v1/feed/{id}/ack?k=`, never ahead of what was sent); `FeedHub::status` / `feed_status` give pages following and the newest acknowledged frame; the output card shows the health (`useFeedHealth`, `feedHealthLabel`; "behind" after 3 s).
- **Tests:** rhema-api 131 (ids in the stream, watching count, ack only with the secret, never ahead); `browser-feeds.test.ts` (wording); vitest green.
- **Desktop:** acceptance 10cv.4. Real data 6/6, WebKit restored.
- **Next:** congregation scene transitions / presets, or #198 TV setup (QR for the feed link).

## 2026-10-23 — Browser feed QR code (#198)

- **Branch / PR:** `arch-002/feed-qr`. `FeedLink` (output editor) draws a QR code of the LAN link with the existing `qrcode` package; none when the listener is on this computer only.
- **Tests:** `src/studio/feed-link.test.tsx` (LAN link and QR; loopback: link, no QR). Not checked on the desktop: opening the QA listener to the network can raise a macOS firewall prompt.

## 2026-10-23 — COMMS-001 C3: full-duplex Push-to-Talk (LAN)

- **Branch / PR:** `comms-003/voice`. ADR 0002 (`docs/rhema-studio/23-adr-0002-comms-voice.md`).
- **Behaviour:** API: `POST /api/v1/voice` (complete SDP offer with the desk's key → the host window's answer, 10 s), `VoiceHub`, commands `voice_talk` / `voice_leave` (any paired desk). App: `voice_answer`, `join_voice`. Frontend: `src/lib/voice.ts` (host hub that mixes each desk's voice into everyone else's track and the main desk's monitor; `TalkClient` for joined desks; speaking meters; `setVoiceVolume`), `src/studio/talk.tsx` (hold-to-talk with release on up / cancel / blur / hidden; crew list), top-bar Talk on the main desk, Talk section on a joined desk, `voice` in the Live State.
- **Found on the desktop and fixed:** suspended AudioContext silenced the first desk; meters off the output path read stale; desks lingered after leaving (explicit `voice_leave`).
- **Tests:** rhema-api 132 (voice offer round trip with the key, 401, bad SDP, late answer; `voice_talk` / `voice_leave` parse); `src/studio/talk.test.tsx` (talk only while held); vitest green. In-app tone test and audio-clock latency: see ADR 0002 §5; results kept in local `qa-screenshots/voice/`.
- **Not verified:** real microphones and headsets, echo, two computers, CPU with 6+ desks; phones (need HTTPS: owner decision, ADR 0002 §3).

## 2026-10-23 — ARCH-002: clock layer in scenes

- **Branch / PR:** `arch-002/clock-layer`.
- **Behaviour:** scene layer kind `clock` (`SceneClock {mode, at, text}`; `sceneClock`/`clockText` in `lib/scenes.ts`): the frame carries the countdown's end (or the count-up's start) as wall time; outputs, browser feeds and the composer work out the time. Frames are resent only when the timer object changes (start, pause, reset, minutes), not on its ticks. A running clock asks the Rust pacer for 1 frame a second (display and NDI), since WebKit held a locked screen's timers back ~15 s (found on the desktop). Drawn straight into its box in the look's text style, sized to fill it.
- **Tests:** `scene-contracts.test.ts` (still / down / up, stops at 0:00, normalize keeps clocks, no resend on ticks); vitest 724.
- **Desktop:** see acceptance 10cx (projector canvas frames in local `qa-screenshots/clock-layer/`). Real data 6/6, WebKit restored.

## 2026-10-23 — Phone remote: live sources and notices (ARCH-001 leftover; Comms paired phones, text)

- **Branch / PR:** `arch-001/phone-sources`.
- **Behaviour:** `remote.html` reads `/api/v1/live` and `/api/v1/me` with the phone's key; lists live sources with Take off / Put back (`clear_source` / `restore_source`, the host's role checks apply); shows the notices for the phone's role (plus everyone's and its own) with Seen / Ready / Unable (`notice_ack`) and a message box to the main desk (`notice_send`). DOM built with textContent only.
- **Tests:** `src/studio/phone-remote.test.ts` loads the real page in jsdom with a mocked computer (rows, Bearer key, the four commands); rhema-api phone page test; vitest green.
- **Desktop:** acceptance 10cy (headless Chrome at 390 px against the QA build; screenshots in local `qa-screenshots/phone-remote/`). Real data 6/6, WebKit restored.
- **Blocker for phone voice (C4):** browsers give the microphone only to secure pages; the phone page is plain HTTP on the LAN. Needs an owner decision on HTTPS with a local certificate (see ADR 0002 draft in the voice PR).

## 2026-10-23 — ARCH-001 leftovers: stage follows a source; journal source tags

- **Branch / PR:** `arch-001/stage-follows`.
- **Behaviour:** the stage payload uses the output's `feedFrame` (its chosen sources, else the program); the Outputs editor offers "What this output follows" for stage outputs too. Journal entries carry `source` (program entries: their content type's name, shown as "· Hymns" in the log); a new `source` kind records a source changing beside the program (on, off, back), skipped when the source's value is the program itself.
- **Tests:** `src/studio/source-followers.test.ts` (stage following Bible vs everything, fails without the change; the log's entries and text); vitest 722.
- **Desktop (QA build, Intel Mac):** two windowed stage outputs; with the hymn on air "Pulpit stage" (following Bible) showed Romans 8:28 (KJV) and "Band stage" the hymn line; the journal read live Bible / live Hymns / Bible off / Bible back. Screenshots in the local `qa-screenshots/stage-follows/` (not committed). Real data 6/6, WebKit restored.

## 2026-10-23 — COMMS-001 C2: action requests

- **Branch / PR:** `comms-002/action-requests`.
- **Behaviour:** `NoticeIn.action {kind, value}` (API: kinds bible / scene / event only, value capped at 120); the host store keeps a checked `action` on each notice (`asAction`). Notices panel: "Ask to show a verse / take a scene / start an item" when writing; the recipient gets one button, which runs the request through the desk's own path (main desk: `activateBibleReference`, `takeScene`, event clock; joined desk: `bible_activate`, `take_scene`, `event_start` with its key, so the host's role checks apply) and answers Ready. Scene requests switch the outputs already showing a scene, else main (`sceneTargets`).
- **Tests:** rhema-api 130 (action carried, unknown kinds dropped); notices test (button only for the recipient, acts and answers Ready, scene targets); vitest 719.
- **Desktop (QA build, Intel Mac, loopback):** paired Bible and Timekeeper test keys; the Timekeeper's request to the main desk arrived with its action ("shell" kind dropped); the bell read "Notices: 2 new"; pressing "Show Romans 8:28" set the Bible source to Romans 8:28 (KJV), on, and the Live State showed "Tolu (main desk): ready"; the Timekeeper key's `bible_activate` got 403. Window capture failed in this session (bridge and API evidence only). Real data 6/6, WebKit restored.
- **Next:** ARCH-001 leftovers (stage follows a chosen source; journal source tags). Cameras (#209) wait on the owner: the first camera use asks for macOS camera permission, and MediaMTX is not installed.

## 2026-10-23 — ARCH-002 slice 2: browser feeds (#198 groundwork)

- **Branch / PR:** `arch-002/browser-feeds`.
- **Behaviour:** API: `FeedHub` (feeds by id with their secret, current frame, broadcast), `/feed/{id}?k=` (the built `feed.html` via `CommandSink::asset`), `/api/v1/feed/{id}/events?k=` (SSE), `/assets/{*path}` (built code only); app: `feeds_set`, `feed_publish`, `TauriSink::asset` (Tauri's asset resolver). Frontend: output type `browser` (`outputOnAir` everywhere), `deliver()` routes every frame (congregation, scene, stage, signage) to the feed hub for browser outputs while on; start/stop without windows; `lib/browser-feeds.ts` (secrets, registry sync, link); Outputs editor: Browser Feed option and link with Copy / New link; `feed.html` + `src/feed.ts` (same renderer: looks, scenes, stage, lower third, ticker; transparent background; no video).
- **Tests:** rhema-api 130 (feed secrets, page, assets, stream, renewal); `src/studio/browser-feeds.test.ts`; full vitest 718.
- **Desktop (QA build, Intel Mac, loopback):** the served page (200; wrong secret 403; its code from `/assets`) drew Romans 8:28 in the Lower Thirds look on a transparent background in headless Chrome at 1920×1080; a hymn going live left the Bible feed on Romans 8:28; off sent `{off:true}`. OBS and a second computer not yet tried. Note: a build started with a plain `&` was killed before bundling; QA builds must run as background tasks. Real data 6/6, WebKit restored.
- **Next:** C2 action requests.

## 2026-10-23 — COMMS-001 C1: production notices (#251)

- **Branch / PR:** `comms-001/notices`.
- **Behaviour:** commands `notice_send {text, to, priority, event}` and `notice_ack {id, state}` (all roles); `CommandDispatcher::dispatch_as` stamps the sender with the key's own name (HTTP), "a remote" otherwise; `src/stores/notices-store.ts` (last 100, 280 characters, answers once per person, `isFor`); Live State v1 carries the last 50; `src/studio/notices-panel.tsx` shared by the main desk's bell (unread count, red when urgent) and the joined desk's Notices section; never on outputs or in the journal.
- **Tests:** rhema-api 130 (sender stamping, bounds); `src/studio/notices.test.tsx`; pinned event names; full vitest 716. Desktop (QA build, Intel Mac): curl as the paired Timekeeper sent an urgent notice to the main desk; the bell showed it; a forged sender in the request was ignored (the key's name is used); Ready on the main desk reached the Live State; the service log stayed clean. Real data 6/6, WebKit restored.
- **Next:** C2 action requests (a notice that opens the item, verse or scene it is about on the recipient's desk), then the speaking/PTT phases.

## 2026-10-23 — MCP-002: AI service drafts for review

- **Branch / PR:** `mcp-002/drafts` (stacked on #262).
- **Behaviour:** `src-tauri/src/mcp_drafts.rs` (`check`: titles, dates, HH:MM, roles once each, kinds, minutes 0–240, at most 200 items, songs matched by id / exact title / other title / number, references via `mcp::find_passage`, missing placeholders; `save`: `ai-drafts/<uuid>.json`, atomic write, at most 50 waiting, client name from `initialize`); tools `rhema_validate_service_draft`, `rhema_create_service_draft` (only non-read-only tool); app commands `ai_drafts_list`, `ai_draft_delete` (UUID ids only); `src/lib/ai-drafts.ts` (`draftToRundown`); Prepare → AI drafts dialog (asks before replacing a rundown; opens unsaved).
- **Tests:** app `mcp` 6 (incl. a Thanksgiving draft against the real KJV and named mistakes); `ai-drafts.test.ts`, `ai-drafts.test.tsx`; full vitest 716.
- **Desktop end-to-end (QA build, Intel Mac, scratch QA profile):** a stdio session as "Claude" validated then created a Thanksgiving draft (Amazing Grace, the CAC hymn "Now thank we all our God", KJV Psalm 100:1-5, slides; 47 min); Prepare → AI drafts listed it and Open as a new service loaded all five items marked "AI draft · Claude" with Warm-up and Main service 10:00; nothing saved or approved. Window capture failed that run (bridge evidence only). Real data 6/6, WebKit restored.
- **Next:** Comms notices (#251) on the Host/Join channel.

## 2026-10-23 — MCP-001: the read-only Rhema MCP server (#252)

- **Main checked:** `f55eab9` (#260 merged). #261 (Bible and Screens roles) open.
- **Branch / PR:** `mcp-001/read-only`.
- **Behaviour:** `Rhema --mcp` serves MCP (JSON-RPC over stdio) before any window or single-instance handling; opt-in via `mcpEnabled`; `ContentDb::open_read_only` (read-only flag, refuses newer schemas) and the immutable Bible database; tools `rhema_get_capabilities`, `rhema_list_services`, `rhema_get_service`, `rhema_search_songs` (no lyrics), `rhema_list_translations`, `rhema_lookup_bible_reference` (numbered books normalised, ranges bounded). Settings → AI assistants (switch, configuration with this app's path, privacy note). Docs: `docs/rhema-studio/22-rhema-mcp.md`.
- **Tests:** content `read_only` 1; app `mcp` 4 (protocol and opt-in, reading services, real KJV John 3:16 and 1 Cor 13:4-7 when the Bible database is present, reference parsing); Settings section 1; full vitest 714. Real binary over stdio (QA build, scratch copy of the QA profile): off → every tool refuses with the Settings hint; on → capabilities, services, KJV Romans 8:28, OYCB Psalm 23 with Yorùbá diacritics intact, songs and hymns without lyrics. Found and fixed: a database the updated app has not opened yet is now refused with "open Rhema once" instead of a raw SQL error.
- **Next:** MCP-002 draft-writing (an AI draft in Prepare for review, provenance, missing items), then Comms notices (#251).
## 2026-10-23 — ARCH-004 slice 2: Bible and Screens operators

- **Branch / PR:** `arch-004/operator-roles` (stacked on #260).
- **Behaviour:** commands `bible_activate`, `clear_source`, `restore_source`, `take_scene {output, scene}`, `release_scene` (HTTP, OSC, dispatch, pinned names); roles `bible` and `screens` with their own refusal messages; `src/lib/bible-activate.ts` (`bibleScope` shared with Auto, `activateBibleReference` via the host's own reference parser); Live State v1 gains scenes and congregation outputs; joined desks by role (clock / Bible / scenes; Present gets all).
- **Tests:** rhema-api 129; `src/studio/operator-roles.test.tsx` (Bible rule, desks per role); full vitest 713; app crate check clean.
- **Next:** MCP-001 read-only server (#252), then Comms notices (#251) on the Host/Join channel.

## 2026-10-23 — ARCH-004 slice 1: host and join

- **Main checked:** `00e3e8c` (#256, #257, #258, #259 merged after CI and review; #256's own Rust job was held up by the package mirror, its code passed in full on #257).
- **Branch / PR:** `arch-004/host-join`.
- **Behaviour:** API crate: `LiveHub` (`publish`, `current`, broadcast), `GET /api/v1/live`, `/api/v1/live/events` (SSE, current first, 15 s keep-alive), `/api/v1/me`; paired keys only (keys off: loopback only); commands `event_next`, `event_prev`, `event_start` (HTTP, OSC, dispatch, pinned names); role `timekeeper` (event clock only) with its own refusal message. App: `publish_live_state`; `commands/join.rs` (`join_pair`, `join_me`, `join_command` with idempotency ids, `join_connect` SSE follower with reconnect backoff and a refusal state, `join_disconnect`; host:port validation; bounded buffer). Frontend: `lib/live-state.ts` (Live State v1 builder and publisher, deduplicated, 15 s refresh), `stores/join-store.ts`, settings `joinAddress`/`joinName`/`joinToken` (keychain), Timekeeper role in Settings, Production → Operators (host card, join form, joined Timekeeper desk).
- **Tests:** rhema-api 127 (role, OSC, SSE stream with auth, loopback-only open mode); app `join` 2; `src/studio/host-join.test.ts` (4); remote event names pinned; full vitest 711. Desktop (QA build, Intel Mac, isolated home, loopback): pair as Timekeeper with curl, `/me`, `/live`, the stream carrying none → Welcome → Opening prayer → Welcome while the window was hidden (found and fixed: the publisher used a timer WebKit held back; now a microtask plus the app tick), screen command refused 403, no key 401; the app joined itself via Production → Operators and its Start moved the host's clock with nothing on air. Real data 6/6 OK, WebKit restored.
- **Decisions:** Live State is a versioned JSON the server passes on unread; a joined computer drives no screens of its own; roles are permissions (Timekeeper first; Bible/worship and screens next).
- **Next:** more delegated roles (Bible operator activating the Bible source, screen operator taking scenes) on the same command path; then MCP-001.

## 2026-10-23 — ARCH-003 slice 3: the event clock (C03)

- **Branch / PR:** `arch-003/event-clock` (stacked on #257 → #256).
- **Behaviour:** `src/stores/event-clock-store.ts` (mode "screens" default / "own", `currentId`, start/next/previous; a start is a journal "event" entry; no starts in rehearsal or from quick screens; reset when another service opens). `journal.ts`: `eventStarts`, `eventTimes`, "event" kept out of screen durations, EVENT in the text log. Timing (`use-service-timing`, `stage-finish`) and item cues (`on-live-cues`) follow the event clock. Production → Timekeeper: event clock bar. QA bridge exposes `eventClock`.
- **Tests:** `src/studio/event-clock-contracts.test.ts` (4, written first); timing tests seed event entries; full vitest 706.
- **Decisions:** "Follows the screens" is the default so a one-person desk works exactly as before; item cues are event cues (same moment in the default mode).
- **Next:** merge the stack (#256, #257, #258, this); then Milestone D's scope-aware cue execution per event, or MCP-001's read-only server.

## 2026-10-23 — ARCH-002 slice 1: Congregation Scene Composer

- **Main checked:** `49b41e0`; #256 (ARCH-003 slice 2) open, its Rust job re-run after a slow package mirror (CI step limit raised to 20 min in this branch).
- **Branch / PR:** `arch-002/scene-composer` (stacked on #256).
- **Behaviour:** scene model (`src/types/scene.ts`, `src/lib/scenes.ts`: presets, normalize, copy, `sceneFrame`, `layerContent`), shared drawer `drawScene`, output window composes `payload.scene`, store `scenes` (saved), `sceneId` per output, `takeScene` / `releaseScene` / `sceneReturn`, `deleteScene` releases; Black/Logo override scenes. UI: Production → Programs (scenes list and presets, live preview with drag/resize/nudge, inspector, program bar with Take / back / Restore). Edits are drafts until Save/Take.
- **Tests:** `src/studio/scene-contracts.test.ts` (6, written after the model), Production composer test (preset → Take → release → Restore); full vitest 700; browser screenshots of the composer with Bible and hymn live side by side.
- **Decisions:** a feed layer draws its look whole, then crop/scale (keyed looks stay keyed); camera layers are labelled placeholders until #209; only congregation outputs take scenes; scene changes reach air only by Save/Take.
- **Remaining for ARCH-002:** clock and lower-third layers inside scenes, transitions, scene presets per church (save as preset), browser-source feeds, NDI/projector hardware checks (10cs).
- **Next:** the Design toolbar overflow at 1024 (sweep), then ARCH-004 groundwork or MCP-001 read-only server.

## 2026-10-23 — ARCH-003 slice 2: rehearsal sandbox, scoped cues

- **Main checked:** `49b41e0` (#255 merged after CI green and review).
- **Branch / PR:** `milestone-a/rehearsal-sandbox` (ARCH-003; ADR 0001 C02 rest, C04).
- **Behaviour:** `RehearsalReturn` adds lower third, ticker, stage message and timer to the snapshot, always restored (Show this live keeps only the program); `tickerForScreens` keeps rehearsal's ticker off signage; the journal drops entries during rehearsal except rehearsal on/off; phase runs carry `rehearsal` and wait while the app is not where they started, catching up on exit, sandbox runs stop on exit; timed moves wait in rehearsal and catch up; `CueScope` on every cue action and `cueImpact` shown under each cue and in the new-cue form.
- **Tests:** `src/studio/rehearsal-sandbox.test.ts` (4) and new runner tests (3), written first (6 failed); full vitest 693.
- **Decisions:** Show this live applies the program only; aux timers are not yet in the sandbox (rehearsal edits to them stay; small).
- **Next:** ARCH-002 Scene Composer (congregation scenes in the main app), starting with the scene model and Take on native outputs.

## 2026-10-23 — ARCH-001 slice 1: independent live sources

- **Main checked:** `f079203` (#254 merged after CI green and review).
- **Branch / PR:** `milestone-a/live-sources` (ARCH-001; ADR 0001 C05, C07, C11).
- **Behaviour:** `src/lib/live-sources.ts` (`sourceOf`, `feedFrame`); store `sources` kept by an adapter from the program (`noteSources`: what goes on air activates its source, Clear/Restore toggle it, other sources untouched, nothing in rehearsal); `BroadcastOutput.shows` (absent = legacy latest-wins); `clearSource`, `restoreSource`, `activateSource`; Black/Logo override every feed; quick screens only on legacy feeds; Auto with a non-Bible program activates the Bible source only. UI: Outputs → "What this output follows"; Present → Live → Sources strip (only when an output follows chosen sources).
- **Tests:** `src/studio/live-sources-contracts.test.ts` (11; 9 failed first), strip test; full vitest 686, typecheck, eslint.
- **Decisions:** an output *is* the feed (no new entity; NDI names and themes unchanged); songs and hymns are separate sources, a lyrics feed follows the newer; the main Clear acts on the program and turns off only that source; quick screens other than Black/Logo do not reach source-bound feeds.
- **Remaining for ARCH-001:** stage display following a chosen source; journal entries tagged with the source; remote/phone view of sources; OBS hardware check (10cr).
- **Next:** ARCH-003 rest (scoped cue steps C04, rehearsal pauses timed moves and loops), then ARCH-002 Scene Composer.

## 2026-10-23 — Milestone A, slice 1: ADR 0001 and live safety

- **Main checked:** `077d454` (CI green). Open PRs before this: #4 only (speech; CONFLICTING with main, owner decision ST-004).
- **Branch / PR:** `milestone-a/live-safety`, PR #254 (ARCH-003).
- **Behaviour:** ADR 0001 (`docs/rhema-studio/21-adr-0001-live-sources-scenes.md`). Rehearsal snapshots the real program and the rundown position and restores them on exit; `showRehearsalLive()` / "Show this live" keeps the rehearsed program behind the approval gate. Designer drafts reach outputs only with Live edit (`liveDesign`), which ends with editing.
- **Tests:** contract tests `src/studio/live-safety-contracts.test.ts` (written first; 5 failed before the change); rehearsal, approval, on-live-cue and Designer tests updated to the ratified contracts; full vitest, typecheck, eslint, CI.
- **Decisions (under the approved principles):** "Rehearsal off" restores rather than shows (C02); Live edit off by default (C01); `rehearsal.off` cue keeps its id with the new meaning.
- **Remaining:** ARCH-001 independent sources and feed binding (next, `milestone-a/live-sources`); ARCH-003 rest (scoped cues, rehearsal timers, event clock); ARCH-002 Scene Composer; ARCH-004 Host/Join; COMMS-001 after ARCH-004; MCP-001 read-only server.
- **Blockers:** Windows smoke (needs the owner's desktop); real OBS/projector checks are hardware acceptance; PR #4 provider decision.
- **Next:** ARCH-001 (independent live sources).
