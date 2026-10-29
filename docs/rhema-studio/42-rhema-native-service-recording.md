# 42 — OWNER DECISION: Rhema Studio Is the Native Service Recording Application

**Owner direction:** 29 October 2026. **Status:** **APPROVED PRODUCT OWNERSHIP AND CORE CAPABILITY**; technical media engine, exact recording formats, codec choices, ISO multitrack capability, finished UI styling and real-device performance **remain to be engineered and validated**. This supersedes the earlier assumption that **OBS recording** is the default or required service recorder. Owner's wording: "I want Rhema studio to be the recording app."

**Priority:** First-party, reliable, **offline-capable** service recording must be provided by Rhema Studio itself. The OBS integration remains a separate optional online program / livestream integration and is **not a prerequisite for starting, continuing or finalizing a Rhema recording**. The output to pastor/Stage, Sanctuary and Overflow remains independent and is not implicitly changed by record or OBS actions. This is a product instruction for Codex, not a claim the native recorder exists yet.

## 1. Critical separation: independent programs and controls

| Domain | Owns | Must remain independent of |
| --- | --- | --- |
| **Rhema Recording** | Named native record program; selected video composition(s), approved audio mix, capture/encode/local file storage, recording markers, crash-safe session recovery, archive | OBS availability, internet/WAN, congregation Take and Stage/Comms messages |
| **OBS Director** | OBS Studio Mode Preview / Program, online scenes/transitions, OBS stream health, OBS Companion bridge when another OBS machine is used | Rhema's primary recording lifecycle and native local archive |
| **Screens & Graphics** | Named Sanctuary/Overflow/other congregation output Scenes, source activation, graphics, per-output Take and receiver truth | OBS online Program and Rhema Record control |
| **Timekeeper / Stage** | Authoritative clock, dedicated private stage timing/cues | Public output, record audio, private cue capture |
| **History / Library** | Service metadata, actual run journal, recording archive/index, permitted playback/export | Silent public upload or mutation of source/plan |

**Default model proposed for implementation:** `Rhema Record Program` is a named recording destination in Rhema's output/program architecture, able to **follow an explicitly selected service Program composition** by default without taking over the congregation output. It must be possible to configure a **separate recording scene/composition** as an advanced option, so the archive can differ from Sanctuary or OBS when the church intends it. This output routing detail is a *design proposal* to implement within the approved first-party recorder capability; verify it against existing Scenes/output renderer and host performance before treating all modes as feasible on every machine.

## 2. Main Live workspace — first-class recording dock

```text
RHEMA STUDIO · LIVE
┌────────────────────────────────────────────────────────────────────────┐
│ RECORD · Rhema native recorder                           ● Ready       │
│ Video: [Record Program / follow Sanctuary Main ▼]                      │
│ Audio: [Approved church mixer / mic feed ▼]    Meter [■■■■■░░]          │
│ Profile: [Standard HD ▼]                 Local folder [Choose ▾]         │
│ [● START RECORDING]     Disk: 124 GB available    Preflight: ready       │
└────────────────────────────────────────────────────────────────────────┘

After start:
┌────────────────────────────────────────────────────────────────────────┐
│ ● RECORDING  00:32:14   [Add marker] [Pause*] [Stop recording…]        │
│ Sermon · Video 1080p30* · Audio receiving · Writing to local disk      │
│ File status: 4 segments secured · Disk remaining · Last write healthy │
└────────────────────────────────────────────────────────────────────────┘
```

**The screen is a conceptual requirement, not a completed mock/implementation.** `1080p30`, `Pause`, recording profiles and source selection are implementation options subject to resource/format decisions. A recording may continue even if this panel is closed or another operator opens a different screen. Host retains authority when paired browser operator disconnects.

**Core recording UX requirements:**
- Deliberate `Start Recording` with preflight for chosen video/audio routing, write permission, adequate disk space, expected audio activity, actual capture and encoder readiness. Avoid requiring OBS connection.
- Truthful states: `Ready`, `Preparing`, `Recording`, `Stopping / Finalizing`, `Saved`, `Recoverable after interruption`, `Failed`, `Disk low`, `Video unavailable`, `Audio missing`; show true elapsed, dropped frames/resource health, file write status and actionable problems. Do not display a green REC badge from a UI flag alone.
- Stop is explicit with a named confirmation and a `Finalizing…` state until files can be reopened. Close/exit should warn if a real recording is active. Main host restart recovery discovers any interrupted sessions.
- `Add marker` stores timestamp relative to **Rhema recording session** plus current service, event/moment, actor, clock reference, source revision and authorized note. Do **not** depend on OBS chapter API. Markers are optionally embedded on export if supported.
- Recordings are saved locally under the selected church data/recordings folder, indexed by stable service and recording IDs, with authorized rename/preview/open-folder/export/archive and storage quota/retention policy; **no automatic internet upload**.
- A church may intentionally start/stop independently of service event progression; **no auto-start, auto-stop or hidden Take** unless a specific host-configured automation is approved later. Rehearsal/test recordings are labeled and isolated from a production archive.
- **One primary recording session first** with a clearly determined destination and approved audio mix. Multiple simultaneous recording outputs, isolated per-camera ISO recording, independent audio stems, instant replay, video editing and live streaming *inside Rhema* are **proposals/future capabilities, not automatically included in this owner decision**.

## 3. Native recording engine — Codex architecture instructions

1. **Audit first:** current Rhema scene renderer, browser/NDI/TV frame production, local camera router/MediaMTX feeds, audio inputs via the Rust/CPAL capture crate, sound-device configuration, CPU/GPU availability, operating systems/installers, existing Tauri/Rust services, disk and licenses. Determine a real synchronized audio+video capture source and exactly what Rhema can encode without OBS. **No assumption that the existing OBS `StartRecord` command provides native recording.**
2. Build a **host-owned recording service** with independent lifecycle and persistence; avoid recording in a web component or depending on a paired browser. Implement a stable capture → compositing/render → audio/video synchronization → encode → crash-recoverable local writer → metadata/journal/archive path, respecting selected destination. Use the existing authoritative Live frame/scene graph and audio source routing rather than a duplicate event simulation.
3. **Reuse production paths without destabilizing Live:** choose a supported capture/encoder backend (e.g. hardware-accelerated encoding where reliable, compatible software fallback and a well-supported media library/toolchain **only after actual platform/license/install verification**). Avoid unbounded CPU frame copies or launching one encoder per display by default. Profile real CPU/GPU/RAM, audio sync, disk bandwidth and latency with congregation screens, multiple cameras and OBS streaming concurrently.
4. **Crash and disk safety:** write bounded, recoverable recording segments or an equivalently interruption-tolerant container and durable index/checkpoints; finalize and offer a broadly playable MP4 export/remux **without falsely promising a completed MP4 if power fails during finalization**. Prevent disk-full crashes from taking down Live; stop/mark affected recording honestly and recover existing segments. Handle write permission loss, unplugged drive, audio device change, encoder error and host restart with correct failure states. Write final record metadata atomically; never leak private Stage/Comms cues into the capture.
5. **Audio is essential, not optional UI decoration:** let the host select an approved church mixer/USB interface or routed audio source, show signal/mute/levels and detect missing/silent channels, support explicit stereo recording and synchronized video/audio. Do not automatically capture production talkback or private volunteers' microphones, only approved sources. Avoid double-echo by accidentally combining PA and OBS loopback.
6. **Independent permissions:** main host may start/stop; any delegated Recorder permission must be explicit, scoped and server-enforced. Being `OBS director`, `Camera`, `Screens` or `Stage` does **not** implicitly confer Rhema recorder authority. A connected browser can monitor recorder state and may control only when expressly granted; no credentials/paths beyond allowed scope. Audit user, host, session, service, timestamps, recording format and state transitions.
7. **Graceful priorities:** a live service must not fail because its recorder is expensive or loses a disk. Before recording, warn or require a lower-cost profile on constrained hardware; if degraded, protect current Live/receivers/camera routing and log missing frames rather than hiding problems. Provide safe fallback for recording-only loss. No performance claim before measurement.

## 4. How Page 8 OBS Director changes

[41 — OBS Director Page 8](41-obs-director-page-8-layout-proposal.md) must be updated to remove OBS recording as its default first-class lifecycle. The OBS Director page stays focused on **online OBS Preview/Program, explicit OBS Take/direct switching, streaming connection health, scenes and Director/Camera handoffs**. It may show a small **read-only `Rhema REC` status chip** sourced from host native recorder, with a link to main Live's recorder if authorized. It does not implicitly Start/Stop Rhema recordings, and OBS's independent legacy recording controls may only remain as **clearly labeled optional/advanced OBS-specific compatibility tools** after they are separated from Rhema's primary recording UI.

**During transition:** Do not silently remove the currently functioning OBS recording commands before a validated Rhema native recorder exists. Label them `OBS-only recording` and preserve as explicit fallback/legacy integration, without misreporting OBS recording as Rhema-native recording. Migrate status, tests and operating guides carefully; don't leave churches with no working recording option while implementing this feature. New native recording supersedes OBS-only workflow once fully verified.

## 5. Integration acceptance and safe build phases

| Wave | Observable user outcome | Gate |
| --- | --- | --- |
| 0 — Audit and engine choice | Capture/encode/audio constraints, dependency/license/install size, performance budget and concrete native recording source proven feasible | Hardware proof / actual constraints, no guessed engine |
| 1 — Basic local recording | Rhema native host records one chosen Rhema program with synchronized church mixer audio to recoverable local file **with OBS OFF and WAN OFF** | Start → capture → stop → open file and play audio+video, 30+ min; correct program picture |
| 2 — Service integration | Live Record dock, marker timestamp, event linkage, file archive/history, permissioned start/stop, recording status/space/error | Program changes reflected as intended; no Stage/Comms leak |
| 3 — Resilience | Recover interrupted segments, low disk/fault handling, permissions, reroute/audio recovery, user-friendly repair and export | Power/crash and drive fault tests; Live remains functioning |
| 4 — Combined load | Rhema recording + independent Sanctuary/Overflow/Stage output + cameras + OBS streaming + browser operators all active | CPU/GPU/RAM/dropped frame/sync/receiver measurements on target hardware; no Live regressions |

**Missing feature status today:** Verified source snapshot before this decision contains an `OBS StartRecord/StopRecord/CreateRecordChapter` path in `src/stores/obs-store.ts`, remote OBS recording commands in `src/studio/production/joined-desks.tsx`, and OBS status/control in `src/studio/production/obs-panel.tsx`. Rust `crates/audio` captures audio for existing work and `src-tauri/crates/content/src/media.rs` indexes imported media; these are **not a proven standalone synchronized audio/video recording engine**. Treat native recording as **NOT IMPLEMENTED / MUST BUILD**, not as shipped merely because OBS can record.

## 6. Scope boundary / open owner choices

**Approved:** first-party, OBS-independent, offline local service recording owned by Rhema with service-context awareness, first-class Live controls, files/history, safety/recovery and no accidental public content. **Proposed defaults for implementation review:** record a designated Rhema Program (often following main sermon/congregation composition), use one approved clean audio mix, offer crash-safe segments plus playable export, and start with one finished recording path. **Open choices:** record independent program vs follow selected output as default, quality target and OS support, operator control grant preset, and whether full ISO camera/audio multitrack recording belongs in v1. Codex should avoid speculative implementation, audit real render/audio APIs and drive the smallest safe native full recording slice.

**Owner's Page 8 correction has priority over earlier Page 8 OBS recording proposals.** Keep OBS streaming as a separate integration until independently changed.
