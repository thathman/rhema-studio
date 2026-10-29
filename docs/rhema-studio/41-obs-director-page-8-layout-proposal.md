# 41 — Page 8 OBS Director Operator: Online Preview, Program and Stream Safety

**Design workshop:** 29 October 2026. **Status:** **VISUAL WORKFLOW PROPOSAL ONLY — AWAITING OWNER APPROVAL.** **OWNER CORRECTION (29 Oct): Rhema Studio itself must be the native recording application, independently of OBS.** Read mandatory [42 — Rhema Native Service Recording](42-rhema-native-service-recording.md). The OBS Director page must not own the church's main recording lifecycle. This supersedes the earlier assumption that OBS recording is the default workflow. Page 7 Camera Operator's overall camera-grid hierarchy is owner approved in [40 §7A](40-camera-operator-page-7-layout-proposal.md#7a-owner-approved--camera-grid-first-structural-hierarchy-29-october-2026). This new OBS Director page is the next proposed role workspace, **not a separately approved OBS authority expansion** or evidence of shipped browser parity.

**Architecture:** Rhema Studio's local church host owns role and command authorization. The OBS Director operates the church's **online OBS scene/program path** through the host's existing OBS/OBS Companion integration. OBS Studio Mode Preview/Program is entirely distinct from Rhema's Sanctuary/Overflow/Stage outputs. The OBS Companion running on another computer can be the actual OBS runtime/bridge; a browser role does **not** pretend to install OBS plugins, open local OBS sockets itself, or independently publish a stream. Keep [34 — browser roles](34-browser-operators-connected-development.md), [28 — unified workspaces](28-unified-workspace-contract.md), [37 — permissions](37-permissions-sidebar-and-authority-design.md) and the [owner build resumption](../OWNER-RESUME-IMPLEMENTATION-2026-10-29.md) authoritative. No new PRs or public website publishing.

**Owner follow-up — congregation output is recording source (29 October 2026):** Rhema-native service recording will capture **the final host-composited Live picture of one explicitly selected named congregation output**, plus approved clean church audio, as specified in [42](42-rhema-native-service-recording.md#owner-approved--initial-recording-video-source-is-the-congregation-output-29-october-2026). It does **not** take OBS Program, OBS Preview, raw camera ISO or an independent record-only Scene by default. Keep OBS Director focused on independent online Program and streaming, with a read-only Rhema recording status. The new Page 8 OBS screen layout itself awaits owner visual acceptance.

## 1. Primary experience

A volunteer knows **what is currently on OBS online Program, what is next, what changes when they press an OBS Take, and whether OBS's stream connection is healthy**. **Rhema native recording is independent and controlled from main Live's Record dock**. OBS's own legacy recording status may be informational/advanced only, never mistaken for Rhema recording.

**Simple mental model:** `Select OBS scene → OBS Preview → Check audio/cameras and output truth → Take to OBS Program`. If OBS Studio Mode is OFF, scene switching is a **direct live switch**, so require deliberate explicit impact confirmation; never label a direct switch as private Preview.

The most important persistent difference on screen:
- **OBS Preview:** prepared OBS scene, not online.
- **OBS Program:** what OBS itself currently reports for the online livestream path (not proof a remote streaming platform has received it or viewers saw it). The church's primary video recording uses **Rhema's independently configured recording program**.
- **Rhema congregation output:** independently assigned Sanctuary/Overflow scene/source, never implicitly affected by an OBS Take.
- **OBS stream health:** separate from OBS Program name; fresh telemetry and unknown/stale states are shown honestly. A small independent **Rhema REC** chip may reflect the host recorder's status, never OBS's own legacy recording flag.

## 2. Proposed main desktop workspace (1440px)

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ [Church]  Sunday Worship         OBS DIRECTOR       OBS Connected ●  [Comms 2] [Help]       │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ OBS MODE: [Studio Mode ON]    Online: [OBS Program]   Stream: [LIVE ●]  Rhema REC: [● ↗ Live]│
├─────────────────────────────────────┬───────────────────────────────────────────────────────┤
│ OBS PRIVATE PREVIEW                 │ OBS PROGRAM — CURRENT ONLINE PRODUCTION              │
│ [actual OBS preview stream,         │ [actual OBS program frame, if supported;             │
│  or honestly labelled state]        │  otherwise status + last acknowledged data]           │
│ Scene: Camera 2 + Lower Third       │ Scene: Sermon Pulpit                                 │
│ NOT LIVE                            │ OBS applied · Stream active? Receiver telemetry      │
├─────────────────────────────────────┴───────────────────────────────────────────────────────┤
│ TRANSITION [Fade ▾] [Duration if OBS reports/supports]  [TAKE OBS PREVIEW TO ONLINE PROGRAM]│
│ Studio Mode OFF → [Review direct switch] → confirm target / ON-AIR IMPACT                 │
├─────────────────────────────────────┬───────────────────────────────────────────────────────┤
│ OBS SCENES                          │ OBS STREAM HEALTH · RHEMA RECORDING STATUS            │
│ [Sermon Pulpit]   [● Program]       │ Stream: Connected / Connecting / Failed / Unknown    │
│ [Camera 2 + Name] [◌ Preview]       │ Rhema REC: status from native recorder; link to Live │
│ [Choir Worship]  [Set Preview]      │ Dropped frames / bitrate / reconnect *if reported*    │
│ [Holding / Countdown]               │ OBS recording: optional legacy/advanced only         │
│ [Fullscreen Bible]                  │ Rhema marker: use main Live Record dock / History     │
├─────────────────────────────────────┴───────────────────────────────────────────────────────┤
│ CREW CUES · Camera 2 Ready · Director asks \"Preview choir\" [Open] [Acknowledged] [Unable]│
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ OTHER PROGRAMS (READ ONLY): Sanctuary [Camera + Bible] · Overflow [Lyrics] · Stage [Timer] │
│ These are separate outputs. OBS Take does NOT change them.                                │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

**The OBS Take button is the one dominant on-air action**. It must explicitly say OBS/online—not a generic global `Take`. Control must be disabled on rehearsal, disconnection, missing grant, unconfirmed Studio Mode, stale pending command, or incomplete required preflight, with actionable reason. Long-press or confirmation may be reserved for higher-risk operations; do not slow down normal well-scoped Studio Mode Takes unnecessarily. Actual OBS command acknowledgment/result must follow host state, not a simulated UI toggle.

## 3. Existing source code to REUSE (observed 29 Oct)

- `src/studio/production/joined-desks.tsx` exports `ObsDesk` with host-shared OBS Program, optional Studio Mode Preview, `obs_preview`, `obs_program`, `obs_take`, transitions, stream health **and legacy OBS recording start/stop/markers**. During rehearsal controls are disabled. **Use the streaming/switching portion as a working foundation**; separate OBS-only legacy recording controls from the future native Rhema Recorder under [42](42-rhema-native-service-recording.md), without abruptly deleting an existing recording fallback.
- `src/studio/production/obs-panel.tsx` owns a native OBS panel with separate OBS and congregation program semantics, OBS Scene list, Studio Mode behavior, current program/preview, manual OBS Take, direct-switch confirmation, OBS transition and OBS stream/legacy recorder status. The application must introduce **Rhema native recording** separately, not rely on this. It does not automatically prove browser preview video is supported.
- `src/lib/remote-roles.ts` lists existing `obs` role as switching scenes through host OBS, Preview/Take when supported, never in rehearsal. Host Rust `Role::allows` still governs allowed commands. Main `Configure` roles do not allow accidental OBS administrative access by mere UI.
- Existing separate `OBS Companion` is not the same as an OBS browser operator. The companion's role is to bridge independently installed OBS on another device. Do not collapse or claim a browser replaces that functionality.

## 4. Intended everyday workflows

### A. Transition from Pastor to Choir on the online stream

1. OBS Operator sees OBS Program `Sermon Pulpit`, OBS Preview `Choir Worship` (Studio Mode ON). Camera Operator's separate `Ready` is visible as a private cue, **not** proof the OBS Preview feed renders correctly.
2. Inspect actual OBS Preview if this host can deliver media safely, else clearly show `Preview feed not supported` with OBS scene name/status, not a fake thumbnail. OBS Program remains factual.
3. Select an available OBS transition (e.g. Fade) from OBS's actual list; transition duration only if supported by host/OBS and verified.
4. Press `Take Choir Worship to OBS Program`. The host re-checks role, OBS mode, current Preview and revisions, rehearsal, connection state. An explicit Take then reports OBS command accepted versus OBS Program updated. If stream disconnected, say Program changed but stream not healthy.
5. Congregation Sanctuary/Overflow and Stage screens remain unchanged; the camera/OBS feed changes only its authorized output path.

### B. Studio Mode is OFF

- No fake `Preview` action and no `Take Preview` button. Scene list becomes `Switch OBS Online…` with an explicit named-scene impact review and deliberate confirmation. The user must understand this immediately changes OBS Program.
- If Studio Mode changes while the browser is viewing, invalidate stale pending confirmations and re-fetch current mode/Program. Do not execute a previous action against a different live state.
- Don't force Studio Mode ON from a joined browser unless a separate explicit role-approved host command exists; direct-switch mode must be safe and truthful.

### C. Streaming and Rhema-native recording separation

- **OBS stream health is awareness first.** Report OBS states `Streaming`, `Disconnected`, `Reconnecting`, `Unknown` and measured dropped frames/bitrate if OBS supplies them; OBS Program displayed does not prove external delivery.
- **Rhema's built-in local recorder is the church's primary recording system** and does not depend on OBS being connected. The actual Start/Stop/markers/audio/storage/record file/archive controls belong in the main **Live → Record** dock and resulting History, as specified in [42 — Native Recording](42-rhema-native-service-recording.md). The OBS Director page may show a small **read-only Rhema REC status and link**, using the real native host recorder state.
- **OBS recording is legacy/optional OBS-specific compatibility only.** The existing OBS `StartRecord/StopRecord/CreateRecordChapter` APIs may remain clearly labeled in Advanced while Rhema native recording is implemented and safely adopted. They must never masquerade as Rhema's native recorder. Do not remove working OBS fallback until Rhema has proven recording on target machines.
- Recording control permissions are independent from OBS Director switch rights. Being an OBS Director **does not automatically grant Rhema native recording Start/Stop**, nor should stopping OBS stream stop Rhema recording. Host may grant separate bounded Recorder permission later.
- Starting/stopping the live OBS stream from a browser is **not automatically authorized merely because OBS scene switching is allowed**. Require a distinct grant/confirmed command if that feature is added.
- On loss of OBS connection, keep last-seen OBS Program label with freshness, disable OBS control, but **Rhema recording must continue normally** when its own sources, encoder and local disk remain healthy. When Rhema recording fails, do not imply that OBS must stop streaming.

### D. Director and Camera Operator handoffs

- Director privately requests `Preview Choir camera for next song` with current service moment. OBS Director opens the cue, selects the OBS scene, and prepares OBS Preview.
- Camera Operator reports `Choir framed / Ready`; that human signal does not automatically Take, switch, or prove OBS Program is active.
- OBS Director uses explicit authorized Take when appropriate, then sends truthful `OBS Program changed` status to Director; Comms Ready acknowledgment and actual OBS receipt remain separate. Requests don't bypass rehearsals or access grants.

## 5. UI and permissions details

- Keep **OBS source scenes**, online program and stream health separate from physical sanctuary outputs. The *Other Programs* strip is **read-only awareness**, never secretly synchronizing congregation with OBS.
- All role commands are sent via the authenticated local host; the browser does not get OBS password, secret WebSocket tokens or administrative access to OBS Companion settings.
- Main host may pause/reclaim role, and revocation must immediately stop future sends. Stage/private notices never leak into stream/OBS graphics due to this operator page.
- If a scene contains cameras, audio or graphics that are unavailable, show warnings but never invent an auto-replacement that could take live without permission. Actual OBS and host ability to restore/rollback must be verified before making one-tap Restore promises.
- Distinguish `Rehearsal mode` safe preview from actual OBS Studio Mode Preview. A rehearsal sandbox cannot silently actuate OBS Program or recording.
- Browser video preview is optional until a secure/supported actual OBS preview feed is implemented. A placeholder is not a live media monitor.

## 6. Responsive page direction

- **Wide desktop:** largest OBS Preview/Program panels side by side, single explicit Take below; OBS scenes and stream health below; only a small native Rhema REC status/link, without duplicate recording transport.
- **Tablet:** keep named OBS Preview and OBS Program visual comparison readable, then scenes, transition and Take; use secondary drawer for health/details.
- **Phone:** Program awareness pinned with unmistakable `OBS ONLINE` label; separate accessible Preview pane, large scene picker, explicit named Take/confirm, concise stream/record indicators. No small destructive buttons adjacent to Take. Preview playback opt-in or one feed at a time to conserve CPU/battery.
- **Receiver failure:** Program labels and stream health remain useful without playing video. Lost heartbeat shows last-known timestamp, not green Live status.
- **Accessible:** distinct color AND text for Preview/Program/REC/Stream; keyboard Take requires explicit focus; ARIA live status announces real OBS command results. Safe 44px touch targets.

## 7. Codex acceptance scenarios

1. Studio Mode ON: choose Choir scene → OBS Preview changes, OBS Program unchanged → explicit OBS Take updates online Program, not Sanctuary/Stage/Overflow.
2. Studio Mode OFF: direct scene-switch clearly confirms named OBS Program impact; stale/changed mode invalidates pending switch.
3. Rehearsal, revoked OBS role, disconnected host or stale shared state: no live OBS command goes through.
4. OBS stream drops while Program remains `Sermon`: show Program and Stream separately; never report successful broadcast, and verify that independent Rhema-native recording is unaffected when recording sources remain healthy.
5. The OBS Director cannot implicitly stop the **Rhema** recording by switching scenes, losing OBS or clicking a status chip. Native recording start/stop/markers are independently authorized in Live Record. If legacy OBS-specific recorder controls remain, they are clearly labeled OBS-only and guarded.
6. Director `Preview choir` and Camera Operator `Ready` remain private cues. Neither auto-Takes.
7. Connected browser operator, separate OBS Companion and native main Studio remain one host-governed truth without sharing OBS credentials to browser.
8. 1440/768/390px and WAN-off LAN operation preserve readable state, safe actions and accurate output separation.

## 8. Owner decisions OPEN (proposals, not owner-approved)

1. **Primary visual hierarchy (recommended):** giant side-by-side OBS Preview and OBS Program first, one clearly named OBS Take under them, OBS scene list and stream/record health next, compact Director requests and read-only congregation output strip last.
2. **Scene selection default:** In Studio Mode ON, clicking an OBS scene **sets OBS Preview only**; it cannot alter OBS Program until explicit Take. With Studio Mode OFF, `Switch OBS online…` requires confirm, never a hidden one-tap direct switch.
3. **Recording (OWNER DIRECTION RESOLVED):** the primary recorder is **Rhema Studio native**, not OBS. Show a small **read-only Rhema REC status chip** here and link to the main Live Record dock when authorized. Do not show OBS recording Start/Stop as the default workflow; legacy OBS recording can be clearly marked Advanced/Fallback until the native replacement is validated. Stream start/stop remains separately permissioned.
4. **Preview video:** actual OBS Preview/Program streams only if supported by secure host backend; truthful names/status and no invented picture otherwise. Accept `Preview feed unavailable` fallback.
5. **Comms:** a compact actionable Director/Camera handoff strip, avoiding a competing full chat page.

**The owner has NOT approved Page 8 layout or expanded role powers yet.** Continue implementing already approved OBS functionality under owner resumed build/no-new-PR process while this design gets reviewed.
