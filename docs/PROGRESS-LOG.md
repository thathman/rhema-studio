# Progress log

The durable record of autonomous development (owner directive, 2026-10-23). Newest first. Each entry:
main SHA checked, branch/PR, behaviour, tests, remaining work, blockers, next task, decisions. Task IDs are
the owner's (ARCH-001 to ARCH-005, COMMS-001, MCP-001 in #253); PRD and TASKS reconciliation is the owner's
periodic review, so feature PRs leave those files alone.

## 2026-10-23 — ARCH-004 slice 1: host and join

- **Main checked:** `00e3e8c` (#256, #257, #258, #259 merged after CI and review; #256's own Rust job was held up by the package mirror, its code passed in full on #257).
- **Branch / PR:** `arch-004/host-join`.
- **Behaviour:** API crate: `LiveHub` (`publish`, `current`, broadcast), `GET /api/v1/live`, `/api/v1/live/events` (SSE, current first, 15 s keep-alive), `/api/v1/me`; paired keys only (keys off: loopback only); commands `event_next`, `event_prev`, `event_start` (HTTP, OSC, dispatch, pinned names); role `timekeeper` (event clock only) with its own refusal message. App: `publish_live_state`; `commands/join.rs` (`join_pair`, `join_me`, `join_command` with idempotency ids, `join_connect` SSE follower with reconnect backoff and a refusal state, `join_disconnect`; host:port validation; bounded buffer). Frontend: `lib/live-state.ts` (Live State v1 builder and publisher, deduplicated, 15 s refresh), `stores/join-store.ts`, settings `joinAddress`/`joinName`/`joinToken` (keychain), Timekeeper role in Settings, Production → Operators (host card, join form, joined Timekeeper desk).
- **Tests:** rhema-api 127 (role, OSC, SSE stream with auth, loopback-only open mode); app `join` 2; `src/studio/host-join.test.ts` (4); remote event names pinned; full vitest 710. Desktop check in the QA app: see the PR.
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
