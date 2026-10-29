# 40 — Page 7 Camera Operator: Live Camera Grid, Readiness and Handoffs

**CURRENT PR EXECUTION POLICY (29 October):** The owner rescinded the blanket PR creation freeze. [New development PRs are allowed in a small continuously merged queue](../OWNER-PR-WORKFLOW-2026-10-29.md), subject to existing Live/security/review gates. Website-publishing PRs #352/#367 remain held. Any older PR-freeze phrase in this page is historical.

**Workshop date:** 29 October 2026. **State:** **OWNER APPROVED — PAGE 7 OVERALL CAMERA-GRID HIERARCHY; detailed camera permissions, pixels and runtime acceptance still open.** The owner answered **“yes”** to a camera-grid-first Camera Operator workspace, larger selected-camera preview, separate source health versus OBS/congregation output tally, Ready/Unable controls and compact Director requests beneath. This approval covers information architecture and interaction direction, **not** permission expansion, host implementation or device verification. Product-wide feature development is **active** under [owner resume order](../OWNER-RESUME-IMPLEMENTATION-2026-10-29.md), **new PRs now allowed** remains in force, and website publishing remains gated.

Read [34 — Browser operator roles](34-browser-operators-connected-development.md), [32 — Feature inventory](32-feature-coverage-inventory.md), [28 — Unified workspaces](28-unified-workspace-contract.md), [37 — Permissions](37-permissions-sidebar-and-authority-design.md), [39 — Stage UI](39-stage-operator-page-6-layout-proposal.md). For feature code, audit actual host/backend and native UI before adding duplicates.

## 1. Camera Operator's one core responsibility

**Know each camera's real health and picture; prepare good framing and availability; tell Director when each angle is ready; handle authorized recovery without unintentionally altering OBS or congregation output.**

A Camera Operator might manage:
- Phone cameras connected using Rhema Cam (church LAN; phones can be used without OBS running on the source device);
- Existing dedicated cameras connected through the church's approved local transport/router (SRT/RTSP/NDI or a supported adapter);
- Multiple simultaneously active cameras used in Rhema scenes, independent OBS scenes and receiver feeds;
- Framing requests sent via Director → operator Comms, and availability/fallback state.

**Three operations MUST be distinct:**
1. `Inspect camera` / `Mark camera Ready`: private monitoring and crew acknowledgment, never a Take.
2. `Make camera available / Hide from scenes`: changes camera source availability across actual subscribed scenes (existing implementation may affect **all** scenes using the source); high-impact action requires precise disclosed impact and server authorization.
3. `Show this camera on a named output` or `Switch OBS Program`: these are **separate** Screens/Director/OBS host-authorized commands, not granted simply because the Camera role can frame an angle.

Do not show fake real-time preview or tally. For remote browser operator, actual media preview may require a separately secured, compatible low-latency stream and should be labeled `Unavailable` if no real feed is accessible.

## 2. Proposed first-screen layout (1440 desktop)

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [Church identity] · Sunday Worship       CAMERA OPERATOR   [Host Connected] [Comms 2] [Help]    │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ CAMERAS                                     [All (4)] [Attention (1)] [On-air (1)] [Add camera → Connections]*│
│ ┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐ ┌─────────────┐│
│ │ CAMERA 1 — PULPIT    │ │ CAMERA 2 — WIDE      │ │ PHONE 3 — CHOIR      │ │ CAMERA 4    ││
│ │ [actual live thumb]  │ │ [actual live thumb]  │ │ [actual preview]     │ │ [Unavailable]││
│ │ Sending · 1080p/30   │ │ Sending · 1080p/30   │ │ Sending / Wi-Fi ?    │ │ Frozen       ││
│ │ Ready / Needs setup  │ │ Ready                 │ │ Director: frame choir │ │ Needs help   ││
│ │ OBS Program? YES     │ │ OBS Preview? YES      │ │ Not on any output    │ │ Check signal ││
│ └──────────────────────┘ └──────────────────────┘ └──────────────────────┘ └─────────────┘│
├──────────────────────────────────────────────────┬───────────────────────────────────────────────┤
│ SELECTED CAMERA: PHONE 3 — CHOIR                 │ WHERE IS THIS CAMERA?                        │
│ BIG ACTUAL PREVIEW / Frame guides               │ Host is receiving: YES                       │
│ Source transport · age/fps/quality              │ OBS Program: NO · OBS Preview: NO             │
│ Camera controls (only if supported):            │ Sanctuary: NOT CURRENTLY SHOWN                │
│ [Ready] [Unable] [Retry]                         │ Overflow: NOT CURRENTLY SHOWN                 │
│ [Hide from scenes — requires impact review]     │ Stage: private/no implicit camera control    │
├──────────────────────────────────────────────────┴───────────────────────────────────────────────┤
│ DIRECTOR REQUESTS (2) — \"Frame choir from left\"  [Acknowledge] [Ready] [Unable] [Comms]          │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ RECOVERY / CAMERA HISTORY [Last signal] [Last operator change] [View details]                    │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

`Add camera` should route to **Connections / Cameras** only for authorized users; do not grant pairing or credentials/configure powers by including it in Camera Operator navigation. The grid itself is the default working page, not yet another separate "Cameras Library".

**Suggested hierarchy:** (A) camera grid + truthful health/tally, (B) selected camera larger private viewer/framing, (C) "where is it used" map, (D) Ready/Unavailable and scoped recovery, (E) compact Director requests with Comms acknowledgment. Keep extra analytics beneath contextual details rather than blocking the operator.

## 3. Camera grid cards — what is factual versus inferred

Each tile should show, when actually provided by the host:
- Name, source kind (Rhema Cam / connected camera / OBS companion feed), thumbnail and `Last frame at`;
- **Connection state** `Sending` vs `Waiting` vs `Frozen` (connected but no fresh frames) vs `Disconnected` vs `Hidden` vs `Router unavailable`;
- If telemetry is available, `1920×1080`, measured FPS, bandwidth/data age, audio track flag, quality/frozen warnings; never fabricate metrics for devices unable to report them;
- **Tally categories** must use exact provenance: `Live in OBS Program`, `Selected in OBS Preview`, `Visible on Sanctuary/Overflow`, `Included in prepared Scene` and `Available but not shown`. These are independent! A camera included in a scene is not necessarily physically on-air; being on OBS Program does not prove it is on Sanctuary, and vice versa;
- `Ready` is a **human framing/readiness acknowledgment** separate from `Sending`/source health; a good transport does not make a performer framed correctly;
- Display reliability of receiver/output acknowledgment separately from source health. When out of date show exact stale status or last-known time.

**Privacy:** any camera preview obtained over LAN must be authorized. A volunteer may have Camera monitoring rights without Church Camera device administration, audio recording, stream publishing, source removal, or host/global scene-write permissions.

## 4. Camera operator workflows

### A. Director says `Frame the pastor`

1. **Director → Comms** sends event-linked request identifying `Camera 1 / Pulpit`, framing instructions and optional needed-by time. This is a private Action Request, **not** an automatic scene Take.
2. Camera Operator opens selected tile with larger private preview and framing aids; if camera is external and lacks digital PTZ control, the operator must adjust the physical camera or coordinate with its owner; **do not render a fake pan/tilt/zoom control**.
3. Operator marks `Ready` or `Unable` (with optional reason). Director sees result and current stream health. Marking Ready **never switches OBS Program, a receiver, or congregation scene**.
4. Director or properly authorized Screens/OBS Operator performs the relevant actual scene Take; Camera Operator gets a truthful per-destination tally update.

### B. Phone angle loses connection

1. Tile goes `Frozen` or `Not sending` based on real router freshness and actual frame age—not generic `Connected`.
2. Operator sees actions genuinely available: `Retry` camera feed, `Open Camera Health`, `Ask mobile camera operator`, `Request backup`. `Switch to backup` only when the host/device supports it and role has delegated control.
3. Host protects active physical outputs using approved fallback/last-frame policy; do not silently replace a live congregation scene or external OBS Program by clicking a camera card.
4. Operator reports `Unable · Phone needs to reconnect` to Director; when recovered, report `Sending` and `Ready` separately. No false `restored on air` without receiver/OBS truth.

### C. Remove one camera from active scenes

**This is especially high-impact in existing code.** Current Camera Desk offers `Hide from scenes` as a role action, which can affect **every scene that references that camera**. Before any such action, show `This camera is used by [named scenes and outputs]` with a readable impact preview, authorized host scope and a recovery `Show in scenes`. Do not quietly interpret it as hide only the selected thumbnail. A safer per-output/revision-scoped `Temporarily exclude in [named scene]` may be proposed as a separate authorized action; do not assume the old global source command already implements that granularity.

### D. Pair and deploy Rhema Cam

From **Connections**, an authorized host sets up camera identity, church LAN access and a QR/pairing flow; Rhema Cam on phone actually sends media. Camera Operator may **view** status and assigned framing instructions, but may not rotate secret tokens or add cameras unless specifically delegated. Phone capture controls live on the mobile camera app, not as an unverified browser imitation. The companion on a separate OBS machine receives sources under its own authenticated bridge; it never silently grants Stage/public output scope.

## 5. Responsive layout direction

- **1920/1440:** four-ish camera tiles per row; prioritize readable thumbnails, labels and tallies; one expanded selected camera with "used on" display; Director cue strip always discoverable.
- **1024:** 2–3 columns; selected tile opens an expanded panel under grid; keep camera output provenance and urgent signal warnings next to the selected preview.
- **768 tablet:** two-column source grid, select one to show actual larger video, detail and actions; Director requests in compact drawer without hiding camera stream.
- **390 phone:** one or two camera tiles, large selected live image, clear source health and named output tally; camera Ready / Unable accessible; destructive/global Hide requires full-screen impact review. Avoid multiple stream decodes on low-memory phone: single active preview when necessary, frozen thumbnails labeled and refreshed with safe lifecycle.
- **Offline LAN:** still use church host and authorized local camera transport; WAN not required. On disconnect, display stale last-known state and hide controls until authenticated host resumes. Host retains all necessary studio ability without Camera Operator present.

## 6. Current implementation baseline to preserve / audit (29 Oct)

**Verified repository source references, not claims of completed operator browser UI:**
- `src/studio/production/joined-desks.tsx` exports a small `CameraDesk` that lists camera sources and `Sending / Frozen / Not sending / Router off / Hidden` state, offers `clear_source / restore_source` to Hide/Show camera **from scenes**, and says Director framing requests arrive via Notices. Its existing permissions are coarse.
- `src/studio/production/cameras-panel.tsx` already provides a native camera card with a `CameraThumb` for live WHEP feed, QR link to connected phone, router health and `Waiting / Frozen / Sending`, frame/measurements, watchers, and observed usage on screens and OBS. **Reuse it**; do not create a second disconnected camera registry.
- `src/studio/production/camera-controls.tsx` already has per-camera `Retry`, `Switch to backup`, `Freeze/Unfreeze` paths in native production. Some controls affect all screens with that camera. Only surface authorized actual host API actions to a browser Camera role; not every existing native host control is automatically remote-delegable.
- `src/lib/remote-roles.ts` describes the current Camera role as answering Ready, Hiding/Showing source and changing camera boxes in scenes. Server-side host role policy in Rust must remain authoritative.
- Real camera frame previews, source provenance, OBS Program and physical receiver status must be independently verified via test evidence; never label a synthetic thumbnail `LIVE`.

**Build priority:** Reuse existing Router/MediaMTX status, scene/source usage and Camera Thumb across native host and authenticated LAN browser role, preserving one source of truth. Complete the end-to-end Camera Operator journey rather than building a disconnected analytics interface.

## 7. Acceptance scenarios for Codex

1. One authenticated Camera Operator on church LAN sees only assigned cameras; 2 phone cameras + dedicated camera + frozen phone source render correct statuses and *real* thumbnails where supported.
2. A Director requests `Frame choir`; Camera Operator acknowledges, checks actual stream, marks Ready; no accidental Take on OBS, Stage, Sanctuary or Overflow. Director sees Ready and actual stream health as separate facts.
3. Switch OBS Preview to camera (by authorized OBS role only) does not produce a `Congregation on air` badge; switching congregation scene leaves OBS Program independent.
4. One camera freezes while used on Sanctuary; host correctly displays fallback/recovery, camera tile says Frozen, camera operator uses allowed Retry or requests assistance; never falsely reports receiver success.
5. `Hide from scenes` displays impact of all affected scenes and requires appropriate host permission; revoke mid-command, stale service context or missing assets fail closed.
6. Reconnect, host restart and WAN-off maintain correct state; Stage/private cues and public outputs do not leak into camera preview/Comms.
7. Desktop 1440, tablet 768, phone ~390 render readable camera grid and avoid unbounded N×high-resolution live video decoding.

## 7A. OWNER APPROVED — Camera-grid-first structural hierarchy (29 October 2026)

**Explicit owner response: “yes”** to the proposed Page 7 Camera Operator screen composition:

1. **Camera grid is the default page, not a separate camera library.** Show assigned camera tiles with real media previews when available, exact source identity, `Sending / Frozen / Waiting / Hidden / Disconnected` state and any truly measured health. Selecting a tile only changes the operator's focus, **never takes a scene Live**.
2. **Selected camera gets a larger, private viewer** and contextual framing/health area; on phones use a single actively decoded stream where necessary to avoid overloading the device. Do not fabricate thumbnails or PTZ capability.
3. **Keep output/tally information separate from camera availability.** Show OBS Program, OBS Preview and each authorized physical screen independently; distinguish `camera signal healthy`, `human marked Ready` and `actually visible on an output`. No false combined “Live” badge.
4. Provide clear **Ready / Unable** controls for a permitted framing request, and show retry/backup/freeze/source-visibility actions only when genuinely available and explicitly authorized. Existing `Hide from scenes` may affect many scenes; an **impact review** is required before a potentially broad change.
5. Keep **Director Requests in a compact, private, event-linked strip below** selected-camera controls; `Frame camera` → Acknowledge → Ready/Unable, with real host acknowledgment. Marking Ready does not alter OBS or congregation outputs.

**Structural signoff only:** exact grid breakpoint, number of thumbnails decoded concurrently, card borders, tally visual language, initial selection rule, source-control entitlement details, PTZ models and physical media QA are **not approved by this answer**. Backend Camera role policy, host session/output ACL, rehearsal isolation and device telemetry must be implemented and verified before claims of completion. Page 8 OBS Director is separate and has its own permissions and actual online Program/Preview.

## 8. Open design decisions for owner review (NOT approved)

1. **RESOLVED / OWNER APPROVED:** Camera grid → selected larger actual preview/health → separate output tally → Ready/Unable + authorized recovery → compact Director Requests. See §7A; only exact layout pixels and other choices below remain open.
2. **Initial camera selection:** default `Needs Attention` when there is a failing camera, otherwise a selected authorized camera with a factual `On Air` indicator; preserve previous operator selection until explicit change; never auto-cut/auto-Take based on a selection.
3. **Preview density:** decode high-quality video only for selected camera; lightweight/stale-labeled thumbnails for others on phone/low-resource devices. On desktop adapt to physical capacity.
4. **Camera control authority:** preserve existing role actions but require explicit impact review for global source Hide/Show; advanced remote PTZ, backup/freeze/unfreeze only when the host truly supports and delegates them.
5. **Request handling:** use private event-linked Director `Frame [camera]` request plus `Acknowledge / Ready / Unable`, not a new generic chat workflow. Keep Comms linked to the same source and cue.

**Owner approved the broad Page 7 camera-grid-first hierarchy (§7A).** Other detailed choices remain for separate approval; visual pixels, permissions and physical media proof are not yet signed off. Codex should implement the structurally approved direction using existing camera modules without creating duplicate registries or unauthorized Live controls.
