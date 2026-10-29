# 41 — Page 8 OBS Director Operator: Online Preview, Program and Stream Safety

**Design workshop:** 29 October 2026. **Status:** **VISUAL WORKFLOW PROPOSAL ONLY — AWAITING OWNER APPROVAL.** Page 7 Camera Operator's overall camera-grid hierarchy is owner approved in [40 §7A](40-camera-operator-page-7-layout-proposal.md#7a-owner-approved--camera-grid-first-structural-hierarchy-29-october-2026). This new OBS Director page is the next proposed role workspace, **not a separately approved OBS authority expansion** or evidence of shipped browser parity.

**Architecture:** Rhema Studio's local church host owns role and command authorization. The OBS Director operates the church's **online OBS scene/program path** through the host's existing OBS/OBS Companion integration. OBS Studio Mode Preview/Program is entirely distinct from Rhema's Sanctuary/Overflow/Stage outputs. The OBS Companion running on another computer can be the actual OBS runtime/bridge; a browser role does **not** pretend to install OBS plugins, open local OBS sockets itself, or independently publish a stream. Keep [34 — browser roles](34-browser-operators-connected-development.md), [28 — unified workspaces](28-unified-workspace-contract.md), [37 — permissions](37-permissions-sidebar-and-authority-design.md) and the [owner build resumption](../OWNER-RESUME-IMPLEMENTATION-2026-10-29.md) authoritative. No new PRs or public website publishing.

## 1. Primary experience

A volunteer knows **what is currently online, what is next, what changes when they press Take, and whether the actual stream/recording is healthy**.

**Simple mental model:** `Select OBS scene → OBS Preview → Check audio/cameras and output truth → Take to OBS Program`. If OBS Studio Mode is OFF, scene switching is a **direct live switch**, so require deliberate explicit impact confirmation; never label a direct switch as private Preview.

The most important persistent difference on screen:
- **OBS Preview:** prepared OBS scene, not online.
- **OBS Program:** what OBS itself currently reports for the stream/recording (not proof a remote streaming platform has received it or viewers saw it).
- **Rhema congregation output:** independently assigned Sanctuary/Overflow scene/source, never implicitly affected by an OBS Take.
- **OBS stream health and recording:** distinct status from OBS Program name, with fresh telemetries and unknown/stale states shown honestly.

## 2. Proposed main desktop workspace (1440px)

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ [Church]  Sunday Worship         OBS DIRECTOR       OBS Connected ●  [Comms 2] [Help]       │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ OBS MODE: [Studio Mode ON]   Online: [OBS Program]    Recording: [REC ●]   Stream: [LIVE ●]│
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
│ OBS SCENES                          │ STREAM & RECORDING HEALTH                             │
│ [Sermon Pulpit]   [● Program]       │ Stream: Connected / Connecting / Failed / Unknown    │
│ [Camera 2 + Name] [◌ Preview]       │ Recording: Running / Not recording / Unknown         │
│ [Choir Worship]  [Set Preview]      │ Dropped frames / bitrate / reconnect *if reported*    │
│ [Holding / Countdown]               │ [Recording: start / stop with confirmation]          │
│ [Fullscreen Bible]                  │ [Record marker: Sermon starts] [Add marker]           │
├─────────────────────────────────────┴───────────────────────────────────────────────────────┤
│ CREW CUES · Camera 2 Ready · Director asks \"Preview choir\" [Open] [Acknowledged] [Unable]│
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ OTHER PROGRAMS (READ ONLY): Sanctuary [Camera + Bible] · Overflow [Lyrics] · Stage [Timer] │
│ These are separate outputs. OBS Take does NOT change them.                                │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

**The OBS Take button is the one dominant on-air action**. It must explicitly say OBS/online—not a generic global `Take`. Control must be disabled on rehearsal, disconnection, missing grant, unconfirmed Studio Mode, stale pending command, or incomplete required preflight, with actionable reason. Long-press or confirmation may be reserved for higher-risk operations; do not slow down normal well-scoped Studio Mode Takes unnecessarily. Actual OBS command acknowledgment/result must follow host state, not a simulated UI toggle.

## 3. Existing source code to REUSE (observed 29 Oct)

- `src/studio/production/joined-desks.tsx` exports `ObsDesk` with host-shared OBS Program, optional Studio Mode Preview, `obs_preview`, `obs_program`, `obs_take`, transitions, stream/recording health, recording start/stop and markers. During rehearsal controls are disabled. **Use this as a working foundation**, not a separate new command registry.
- `src/studio/production/obs-panel.tsx` owns a native OBS panel with separate OBS and congregation program semantics, OBS Scene list, Studio Mode behavior, current program/preview, manual OBS Take, direct-switch confirmation, OBS transition and stream/recording controls. It does not automatically prove browser preview video is supported.
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

### C. Streaming and recording control

- **Stream health is awareness first.** Report actual OBS states `Streaming`, `Disconnected`, `Reconnecting`, `Unknown` and measured dropped frames/bitrate when OBS supplies them; OBS Program being visible doesn't prove external delivery.
- Recording is a **separate state and action**; Stop Recording is high consequence: confirm `Stop recording?` and verify that OBS reported stopped. Add Marker only when OBS recording/marker API supports it, with event label and host recording/audit revision.
- Starting/stopping the live stream from a browser is **not automatically authorized merely because scene switch is allowed**. If requested later, require a distinct host-granted capability, clear confirmations and separate live operations acceptance. Existing native host may intentionally keep stream start/stop inside OBS itself.
- On loss of OBS connection, keep a last-seen Program label with freshness, disable destructive commands, show what remains known vs unknown and allow authorized host retry if supported.

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

- **Wide desktop:** largest OBS Preview/Program panels side by side, single explicit Take below; OBS scene list and stream/recording health side by side below.
- **Tablet:** keep named OBS Preview and OBS Program visual comparison readable, then scenes, transition and Take; use secondary drawer for health/details.
- **Phone:** Program awareness pinned with unmistakable `OBS ONLINE` label; separate accessible Preview pane, large scene picker, explicit named Take/confirm, concise stream/record indicators. No small destructive buttons adjacent to Take. Preview playback opt-in or one feed at a time to conserve CPU/battery.
- **Receiver failure:** Program labels and stream health remain useful without playing video. Lost heartbeat shows last-known timestamp, not green Live status.
- **Accessible:** distinct color AND text for Preview/Program/REC/Stream; keyboard Take requires explicit focus; ARIA live status announces real OBS command results. Safe 44px touch targets.

## 7. Codex acceptance scenarios

1. Studio Mode ON: choose Choir scene → OBS Preview changes, OBS Program unchanged → explicit OBS Take updates online Program, not Sanctuary/Stage/Overflow.
2. Studio Mode OFF: direct scene-switch clearly confirms named OBS Program impact; stale/changed mode invalidates pending switch.
3. Rehearsal, revoked OBS role, disconnected host or stale shared state: no live OBS command goes through.
4. OBS stream drops while Program remains `Sermon`: show Program and Stream separately; never report successful broadcast.
5. Recording Stop requires explicit confirmation, correct OBS acknowledgment, and appropriate audit; marker insert only when recording supports it.
6. Director `Preview choir` and Camera Operator `Ready` remain private cues. Neither auto-Takes.
7. Connected browser operator, separate OBS Companion and native main Studio remain one host-governed truth without sharing OBS credentials to browser.
8. 1440/768/390px and WAN-off LAN operation preserve readable state, safe actions and accurate output separation.

## 8. Owner decisions OPEN (proposals, not owner-approved)

1. **Primary visual hierarchy (recommended):** giant side-by-side OBS Preview and OBS Program first, one clearly named OBS Take under them, OBS scene list and stream/record health next, compact Director requests and read-only congregation output strip last.
2. **Scene selection default:** In Studio Mode ON, clicking an OBS scene **sets OBS Preview only**; it cannot alter OBS Program until explicit Take. With Studio Mode OFF, `Switch OBS online…` requires confirm, never a hidden one-tap direct switch.
3. **Recording:** show small persistent recording status in header but place Start/Stop recording in dedicated guarded section. Stream start/stop stays outside ordinary joined OBS role unless separately authorized.
4. **Preview video:** actual OBS Preview/Program streams only if supported by secure host backend; truthful names/status and no invented picture otherwise. Accept `Preview feed unavailable` fallback.
5. **Comms:** a compact actionable Director/Camera handoff strip, avoiding a competing full chat page.

**The owner has NOT approved Page 8 layout or expanded role powers yet.** Continue implementing already approved OBS functionality under owner resumed build/no-new-PR process while this design gets reviewed.
