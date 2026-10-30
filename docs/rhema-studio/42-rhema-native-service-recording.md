# 42 — OWNER DECISION: Rhema Studio Is the Native Service Recording Application

**Owner direction:** 29 October 2026. **Status:** **OWNER APPROVED — RHEMA-NATIVE RECORDING OF A SELECTED CONGREGATION OUTPUT**; the video source choice is now **settled**. A macOS engine and basic Live/History controls exist in the current source. Selected-output fidelity, sustained capture, target-device recovery playback, performance, Windows support and the remaining ISO/multitrack features still need implementation or acceptance. This supersedes the earlier assumption that OBS recording is required. The owner first said "I want Rhema studio to be the recording app," then explicitly confirmed **"yes... recording congregation output"**.

**Priority:** First-party, reliable, **offline-capable** service recording must be provided by Rhema Studio itself. The OBS integration remains a separate optional online program / livestream integration and is **not a prerequisite for starting, continuing or finalizing a Rhema recording**. The output to pastor/Stage, Sanctuary and Overflow remains independent and is not implicitly changed by record or OBS actions. The approved mode is not evidence that selected-output fidelity, offline behavior or real-device acceptance has been completed.

## 1. Critical separation: independent programs and controls

| Domain | Owns | Must remain independent of |
| --- | --- | --- |
| **Rhema Recording** | Named native record program; selected video composition(s), approved audio mix, capture/encode/local file storage, recording markers, crash-safe session recovery, archive | OBS availability, internet/WAN, congregation Take and Stage/Comms messages |
| **OBS Director** | OBS Studio Mode Preview / Program, online scenes/transitions, OBS stream health, OBS Companion bridge when another OBS machine is used | Rhema's primary recording lifecycle and native local archive |
| **Screens & Graphics** | Named Sanctuary/Overflow/other congregation output Scenes, source activation, graphics, per-output Take and receiver truth | OBS online Program and Rhema Record control |
| **Timekeeper / Stage** | Authoritative clock, dedicated private stage timing/cues | Public output, record audio, private cue capture |
| **History / Library** | Service metadata, actual run journal, recording archive/index, permitted playback/export | Silent public upload or mutation of source/plan |

### OWNER APPROVED — Initial recording video source is the congregation output (29 October 2026)

**Recording mode for the first release is `Record selected congregation output`, not `Record OBS Program`, `Record raw camera`, or a separate independent recording composition.** The owner explicitly selected this mode. The operator chooses **one real, named congregation output** (usually the church-designated primary Sanctuary output when configured) in Rhema Live before recording. Do not hard-code Sanctuary or change to another output merely because the operator views or Takes something else. A church without a configured default selects its destination explicitly; if output is missing/unauthorized/unavailable, surface a clear preflight error.

- **What the recording contains:** the **final rendered congregation picture** as that output is actually commanded during the service: camera/video layers, selected scenes and scene transitions, activated Scripture and lyrics in that output's language/look, lower thirds, title slides, tickers and timed graphics, intentional blank/holding visuals, and other expressly audience-visible layers. If another congregation display has a distinct EN/YO layout, its contents do **not** get blended with the selected one. Use this output's exact authorized source subscriptions and revisions.
- **How to capture:** tee/subscribe to the **authoritative finalized compositor frames for the selected congregation output**, using an efficient safe path into the host encoder. **Do not require an external HDMI capture card, screen scraping, OBS Browser Source, OBS instance, NDI receiver loopback, or human-facing display mirroring** simply to record. When the actual receiver has lag/dropped frames, label separately **host-recorded output vs receiver-confirmed state**; do not claim the recorder caught a failure on a remote physical screen unless telemetry proves it. The recording should reproduce the host's target congregation output picture and transitions, with observed dropped-frame/error reporting.
- **Track the output's actual Live changes:** explicit authorized scene Takes and source/layer Show/Hide/activation on this **same** output flow into the recording continuously. A new scene or Bible verse on **another** congregation output, OBS Program, Stage/Backstage, or an operator's **Private Preview** does not enter the recording and does not switch the recording source.
- **Audio** is not assumed to be in the rendered video frames: synchronize one **approved clean house/mixer audio input** with the selected output video, with explicit device routing/meter and no private Comms or Stage talkback. If the congregation output carries intentionally routed media audio, the recording mix must respect the church's defined audio policy without duplicate/echoed capture; no silent guess that every TV output provides the full sermon audio.
- **Recording start/stop is independent of screen Take:** starting a recording does not create/change/Take any congregation scene or start OBS. The recorder remains **pinned to the selected output ID for the whole session** even if the user switches the active operator UI selection. Source replacement mid-session would be an *additional explicit stop/new-session or reviewed change*, not accidental following of a control-selection dropdown. Disconnecting a TV/receiver does not necessarily stop host-side recording if the congregation program can still render; report receiver health independently.
- **Respect privacy:** only what is legitimately on the chosen congregation output plus approved church audio is eligible. Never capture the Stage confidence monitor, private timekeeper messages, director/operator controls, raw room camera monitors, or OBS-only captions simply because they share the same service moment. Protect recording archive ACL.
- **One congregation output per primary recording session initially.** Simultaneous different-language congregation outputs, isolated camera ISO, independent audio stems, custom record-only scenes and edit-suite capabilities are separate later design/engine decisions, not part of this approval.

**Source acceptance example:** Sanctuary Main shows camera → Psalm 100 in its approved Yoruba/English view → Pastor lower third → Offering slide. A `Rhema Recording: Sanctuary Main` contains that same host-rendered visual sequence with clean mixed sermon audio; Overflow stays on a distinct hymn, Stage shows a private countdown, and OBS displays a separate online shot, **none of which appear in the recording** unless an authorized change puts them onto Sanctuary Main. If Sanctuary is intentionally black, its actual black output is recorded; do not silently substitute another scene.

**Codex must validate** final compositor frame access, video/media synchronization, visual effects, frame timing, output-specific language/layout, privacy, offline operation and sustained resource budget with real output hardware before claiming exact fidelity. This is an **approved product mode**; implementation and acceptance status are tracked in §5.



## 2. Main Live workspace — first-class recording dock

The layout below is an approved design direction, not a screenshot or a claim about the current UI. The source currently has a compact Live dock and a History archive; pause and user-selected recording folders are not available.

```text
RHEMA STUDIO · LIVE
┌────────────────────────────────────────────────────────────────────────┐
│ RECORD · Rhema native recorder                           ● Ready       │
│ Video: [Congregation output · Sanctuary Main ▼]                       │
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
- **One primary recording session, capturing one explicitly selected named congregation output**, first; audio from a separately approved house/mixer route. Multiple simultaneous congregation-output recordings, ISO-camera capture, independent audio stems, a custom record-only Scene, instant replay and editing are **unapproved later capabilities**.

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

| Wave | Observable user outcome | Acceptance gate |
| --- | --- | --- |
| 0 — Audit and engine choice | Capture/encode/audio constraints, dependency/license/install size, performance budget and concrete native recording source proven feasible | Hardware proof / actual constraints, no guessed engine |
| 1 — Basic local recording | Rhema host captures **one selected named congregation output's final composited frames** plus approved clean mixer audio into a recoverable local file **with OBS OFF and WAN OFF** | Start → camera/Scripture/lyrics/graphic transitions → stop → play synchronized file, 30+ min; exact selected-output language/look and no other output |
| 2 — Service integration | Live Record dock with pinned congregation-output ID, marker timestamps, event linkage, file archive/history, permissioned start/stop, status/space/error | All authorized Show/Hide/scene Takes to **recorded output** appear; private Preview, other congregation outputs, OBS and Stage never leak |
| 3 — Resilience | Recover interrupted segments, low disk/fault handling, permissions, reroute/audio recovery, user-friendly repair and export | Power/crash and drive fault tests; Live remains functioning |
| 4 — Combined load | Rhema recording + independent Sanctuary/Overflow/Stage output + cameras + OBS streaming + browser operators all active | CPU/GPU/RAM/dropped frame/sync/receiver measurements on target hardware; no Live regressions |

### Current implementation and acceptance status (30 October 2026)

The source now contains a **macOS native recording implementation** in the active draft PR #538. It includes an AVAssetWriter H.264/AAC writer, CPAL input capture, a frame tee from the selected output webview, main-desk controls, status and markers, local session manifests, interrupted-session recovery, and History listing/open/reveal. This replaces the earlier “NOT IMPLEMENTED / MUST BUILD” source status. It does **not** mean the approved mode has passed acceptance.

| Wave | Source / automated evidence | Still required before acceptance |
| --- | --- | --- |
| 0 — Audit and engine choice | A macOS AVAssetWriter + CPAL path is implemented and has Rust unit coverage. | Verify device routing, codec behavior, installation and resource limits on the supported church hardware. |
| 1 — Basic local recording | The native QA journey exercises host-authorized start, explicit silent mode, capture of the synthetic `QA LIVE BASELINE` slide from a hidden congregation renderer, a marker, stop/finalize, History listing, and AVFoundation decoding of the saved MP4. This is a software integration smoke check only. | Use a real named congregation output and approved clean mixer input with OBS and WAN off; verify live content, language/look, A/V sync, and a sustained 30+ minute recording. |
| 2 — Service integration | Source includes the Live dock, pinned output ID, marker command, archive/history linkage, host-side congregation-role check, local open/reveal, and an explicit host-granted Recorder permission separate from operator roles. | Verify authorized scene/source changes enter the selected output recording; private Preview, other outputs, Stage, and OBS remain excluded; exercise real permissioned operation. |
| 3 — Resilience | Rust tests cover interrupted-session recovery and archive path containment. | Perform app-crash/restart, power-loss, disk-full, drive removal, write-permission and audio-device-loss journeys on supported hardware; confirm Live continues safely. |
| 4 — Combined load | No target-load measurements are claimed. | Measure recording with congregation outputs, Stage, cameras, OBS streaming and browser operators active; review CPU/GPU/RAM, sync, dropped frames and receiver state. |

The native QA journey captures a synthetic slide with no audio and checks whether the MP4 has a decodable video track at the selected profile size. It cannot establish the approved mixer's signal quality, physical display fidelity, remote receiver behavior, WAN-off operation, long-session stability or crash/power-loss recovery. The current host has no external congregation display or mixer available, so those gates remain open.

## 6. Scope boundary / open owner choices

**Approved:** first-party, OBS-independent, offline Rhema recording of **one explicitly selected real congregation output's final composited video**, following all authorized Live source/scene/graphic changes on that **named** output; separate approved clean church audio; first-class Live controls; local files/History; safety/recovery and no private output leakage. The active draft PR implements a macOS host tee into AVAssetWriter with local session metadata, History controls and a separate explicit Recorder grant path for paired desks. The implementation is not yet verified against a real output, approved audio route, sustained service, or failure on target hardware. **Remaining open engineering and acceptance work:** supported OS coverage, hardware encoder/resource behavior, approved mixer routing, paired-desk permission acceptance, physical fidelity, recovery and fault drills, offline verification, and combined-load measurements. **No separate record-only scene in initial mode.**

**Owner's Page 8 correction has priority over earlier Page 8 OBS recording proposals.** Keep OBS streaming as a separate integration until independently changed.
