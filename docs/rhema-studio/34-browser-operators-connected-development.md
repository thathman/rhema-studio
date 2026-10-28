# 34 — LAN Browser Operators, Connected Development Mode, and Role Workspace Redesign
**Owner directive:** 28 October 2026
**Authority:** Approved product direction and implementation/acceptance contract; **not** evidence of implemented or shipped browser functionality.
**Execution:** Read `docs/OWNER-FINISH-FIRST-2026-10-28.md` first. **ZERO NEW PRs** remains in force. Finish the existing integration backlog before new feature implementation, except work essential to an existing integration or a directly reported owner fix. This document adds to the already-approved Connected Apps / Comms / Collaboration scope; it does **not** waive the freeze, relax security, authorize deployment, or replace existing Live-output safeguards.

## 1. Owner decision and user promise

A church volunteer must be able to use a current laptop, tablet or phone with a modern browser, connect to the church's existing LAN/Wi-Fi, open a trustworthy URL served by the **Rhema Studio host**, pair/identify themselves, and receive a **complete, role-scoped operator application**, without installing Rhema Studio desktop. The experience must reuse the same plans, library, Live State, Comms, device state and authorized commands as the native app—not a second database, a website with decorative controls, or merely today's miniature `/remote` page.

The full *role* is available in the browser, **not** the host computer's privileged runtime. A browser operator can perform all tasks the role's server-enforced permissions allow, but cannot become the main host, run NDI drivers / MediaMTX / local OBS on their device, mutate host settings, publish a website, or bypass approval or Take gates. Computer-specific operations remain on the host or on a separately installed OBS Companion where hardware integration genuinely requires it.

The local production computer is authoritative for Live, outputs and persistent data; it remains operable with **zero operators, zero WAN, a crashed browser, and a lost Wi-Fi connection**. Future planning from home uses a separate, explicitly approved secure sync/relay model; **do not expose the LAN listener to the public Internet**.

### Current code facts (not a claim of browser parity)
- `vite.config.ts`: development UI on port 3000; `src/main.tsx` loads `src/dev/browser-shim.ts` outside Tauri. The shim returns canned KJV/OYCB, in-memory songs/services and placeholder native operations; it is **not connected** to the production Rust/database/media/remote systems.
- `src-tauri/crates/api/src/http.rs`: current native LAN HTTP server defaults to port 8080 with role-authorized `/api/v1/pair`, `/me`, `/live`, `/live/events`, `/lookup`, `/command`, `/voice`, feeds, camera and companion endpoints, plus a minimal `/remote` page. The code rejects foreign web origins; do not relax this to allow arbitrary websites.
- `src/lib/remote-roles.ts` and `src-tauri/crates/api/src/keys.rs` already specify Timekeeper, Bible, Worship, Screens, Stage, Camera, OBS director, OBS Companion, Editor, Viewer, Present and Configure. `src/studio/production/operators-panel.tsx` and `desk-consoles.tsx` have partial desktop joined-desk UIs. No complete responsive role-based browser app is currently shipped.
- `companion-app/vite.config.ts` uses port 3001; `web/package.json` uses 3029 for the marketing/docs site. They must not be confused with the church-hosted operator app.

## 2. Network entry and sessions

**Preferred operator address (illustrative, not currently implemented):**
`https://<host-address>:<https-port>/operator` — for example `https://rhema-church.local:8081/operator`, when local naming and HTTPS trust work. The host should show a real, copyable address, QR and numeric/manual IP fallback; never promise the sample hostname resolves at every church. HTTPS port is HTTP port + 1 when explicitly enabled; verify the effective runtime ports, not hard-coded documentation.

Entry UX: Discover/enter the host → verify host identity (certificate trust/fingerprint and church name) → identify this operator → pair with a time-limited code shown/approved on the host → host grants a role → open the corresponding workspace. Existing paired sessions can reconnect. Display connection and permission state without suggesting unauthorized power. For shared devices allow lock, sign out and switch operator. Revoke/role-change/pause on the host must take effect immediately. Never silently default a **browser** pairing to broad Present/Configure power; least-privileged pending/view-only until host grants the actual role (coordinate with legacy pairing compatibility and tests).

**Authentication design requirements:** strong, revocable per-operator/device sessions; short-lived HTTP-only Secure SameSite cookies or an equivalent reviewed same-origin session design; CSRF protection on mutations; Origin/Host/DNS-rebinding protections; strict Content Security Policy; rate limits; credential secrecy (no feed/command bearer token in URL, log, analytics, localStorage or screenshot); least-privilege endpoint DTOs and field-level filtering. A pairing code alone must not grant elevated actions. Keep the existing Rust `Role::allows` as the host's source of truth; frontend menus are merely a convenience. Make host reclaim and live-approval boundaries explicit.

Do not use plain HTTP for microphone/camera APIs; make the secure-local CA installation/trust experience understandable and provide a no-mic fallback when necessary. Do not insert a generic `Access-Control-Allow-Origin: *`, copy a production token into Vite, or proxy unauthenticated calls from any device on the network. Serve the operator shell and APIs on the **same native host origin** in production; use a deliberate, *loopback-only* development proxy for local developer tests.

Discovery should tolerate mDNS-blocked guest Wi-Fi/VLANs through typed IP/host address. Show guidance when the host is on a different subnet; no automatic public tunnel. If a dedicated app server or path is needed, reuse the host's existing hardened listener rather than another ungoverned network-facing process. Cache non-secret static assets for smooth loading without claiming controls work during a disconnection.

## 3. One application model; two platform adapters

Refactor common React domain/UI state only where needed so `native Tauri host` and `browser operator` share components, data contracts, styling and tests. Do **not** fake the Tauri global in Connected Mode.

Provide explicit environment adapters behind tested contracts:
- `TauriHostClient`: existing native IPC for owner-level host operations.
- `LanOperatorClient`: authenticated same-origin HTTPS API + SSE (and appropriately permissioned realtime voice/video) for operator functions.
- `BrowserSimulatorClient`: current deterministic, clearly labelled mocked frontend UX mode, with fixture isolation.
Each view declares required capabilities and degraded behavior. Unavailable features must show a precise reason/action (not a dead button or a silent `null` success).

Host Live State is a projection, not an editable store. Use role-filtered snapshots/events, monotonic revision/sequence IDs, heartbeats/reconnect/backoff, missing-sequence resync, stale/offline banners, initial state on reconnect, and explicit acknowledgment/rejection of server-authorized actions. Preserve Preview vs Program vs an output-specific Take. Never update local UI as if an irreversible Take succeeded before the host verifies it. Multiple operators can share one show concurrently; protect draft/service edits with revision/optimistic concurrency checks and clear conflict resolution, recording *who changed what*.

Add only the minimum authenticated APIs required for each vertical slice, building on existing `/api/v1/me`, `/live`, `/live/events`, `/lookup`, `/command`, `/voice`. Proposed **new** resource/API surfaces (names subject to source review): session bootstrap/logout + role/capabilities; permitted service/phase/event/notes/draft reads and revision-safe writes; assigned tasks/notices; library lookups and authorized drafts; audit/history; output read-only preview/health. Keep native settings, system file paths, secrets, machine diagnostics and other privileged resources off the browser API. A browser must never be able to issue a generic Tauri command or invoke arbitrary host filesystem operations.

Separate the **operator application UI** from output feeds: `/operator` is interactive and permissioned; `/feed/{id}` remains read-only output rendering with its independent feed token and cannot acquire operator authority. The current `/remote` can become a Quick Remote mode or redirect to the role app after safe compatibility work; preserve legacy pairings and links.

## 4. Connected Development Mode (the original user request)

**Goal:** Make `localhost:3000` usable for real end-to-end UX checks against an authorized *development host*, without turning it into a remote production console.

- Keep `bun run dev` as the fast, deterministic **SIMULATED** React browser mode. Display a visible `SIMULATED · No native host` status and identify fixture data. It must never look identical to a connected production session.
- Add an explicit, opt-in `CONNECTED DEVELOPMENT` launch path and runbook (e.g. a documented `dev:connected` command **only after implementation**). Require a local native host started with dedicated developer authorization, a loopback-only proxy, signed-in test operator credentials, and a test church database or safely restricted copy. Do not silently bind development to `0.0.0.0` or change production CORS policies.
- Show a clear `SIMULATED` / `CONNECTED DEVELOPMENT` / `LIVE HOST` source-of-truth indicator with host name, connectivity, role, last update and data origin; diagnose unavailable backend without filling blank fields from fixtures.
- Default connected development to a **dry-run/sandbox output policy**: actual Program/NDI/cameras/OBS/remote external actions blocked until deliberately armed on a designated test host by the host operator. A browser must not bypass the native approval policy even after arming. Do not modify production/live church data.
- Exercise actual read paths (services/library/versions/outputs), draft persistence and conflict handling, role-specific prepare actions, Preview, Comms, authorized command rejection, session expiry and reconnect; explicitly mark anything still simulated. Synthetic QA content must remain visibly synthetic.
- Use targeted tests for adapters/API/permissions, then exact-head integration/browser checks at coherent merge checkpoints. Keep physical device/offline/NDI/OBS/Take acceptance as separate requirements; passing simulated UI or Vite build does **not** mean `DONE`.

**Exit criterion:** a developer can open localhost:3000 in simulated mode; independently opt into connected development, see authenticated, authoritative test services/content and correct permissions; recover from host disconnect; and cannot accidentally transmit to real outputs or read unauthorized data.

## 5. Browser operator information architecture and roles

Use one Rhema visual language shared with the owner-approved unified desktop redesign: restrained editorial layout; contextual tools; crisp action hierarchy; dark/light; robust 1024px laptop, tablet landscape/portrait and mobile widths. Do **not** simply shrink the giant host app or clone a universal control-room grid. Role changes the workspace defaults, permitted navigation and task emphasis, not underlying source of truth.

**Common role app shell:** Church identity and service/date; clear role/device label and session switch/lock; current LIVE / REHEARSAL / OFFLINE / STALE signal; next/current event and safely filtered Program preview; notification/Comms access; responsive sidebar/bottom navigation; Help/connection health; visible host approval/reclaim state. A role home opens with **what I need to do next**, not the list of every tool.

Role coverage baseline (verify server `Role::allows` and adjust proposed functionality rather than expanding rights implicitly):
| Role | Full browser workspace scope |
|---|---|
| **Bible** | Reference/keyword search from host editions; current service readings; separate private Preview; EN/YO/dual language selection where authorized; Activate/step/clear Bible; proof of output language/followers |
| **Worship** | Assigned songs/hymns, hymnbook numbers, arrangements/sections, lyric/language preview, Show/Preview/step/repeat/clear/restore; cues and requested content |
| **Timekeeper** | Current/next event, planned/actual/remaining, service clock, delay/offset, timers, Hold/Resume with reasons, private Stage/timekeeper messages; no congregation screen authority |
| **Screens / graphics** | Output map and followers, authorized scene Take/release, scoped output previews, lower thirds/ticker availability, proposed scene edits and host approval; never casually publish a draft |
| **Stage** | Confidence monitor (read-only), next cues/time, own stage messages, private notices/Comms; no congregation screen authority |
| **Camera** | Available cameras and genuine receive/preview/program tally, health, relevant scene framing/availability changes, readiness acknowledgments; never claim capture controls the host cannot provide |
| **OBS director** | Host OBS connection status; online Program/Preview, permitted scene/transition/record controls, cue/stream state, distinct sanctuary vs online status; no implicit congregation Take |
| **Editor** | Assigned service/draft contributions, Bible/song/library references, scenes/draft revisions, comments and submit-for-approval; no direct live change |
| **Viewer** | Read-only show/rundown, permission-filtered preview, notices and Talk, no hidden write capability |
| **Present / Configure** | Dense but usable command workspace with Running Order / Preview / Program and explicit Take, relevant specialist tools, main-host reclaim/approval policy; Configure is still restricted by host security and never equals arbitrary Rust access |
| **OBS Companion** | Separate native OBS bridge still required to operate *local* OBS; a browser control/monitor workspace may exist for authorized host OBS operations but cannot install OBS sources or read SRT into another machine's OBS without the Companion runtime |

All roles receive private **Rhema Comms** capabilities permitted by server ACL: event-linked notices, acknowledgments, action requests and WebRTC talk with real microphone permission, talk indicators, role/channels, multi-speaker behavior per ADR. No cross-role leakage of stage/private notes or unapproved drafts. Do not mistake `viewer` for unauthorized.

### Page 1 — Welcome / Connect / Your Workspace — OWNER APPROVED DIRECTION (28 October 2026)

**Approved by owner at conceptual/flow level:** `Welcome → Connect → Your Workspace`. This is the entire first-time pathway; a valid returning session goes **directly to the assigned workspace**, with no repeat pairing and no separate generic operator dashboard. The role's own workspace contains its useful task-at-hand Home, so novice operators are not forced to navigate the full host application.

**Branding approved:** the **church's verified identity comes first**: its logo, church name, safe Brand Kit palette/typography and, where applicable, campus/location; **Rhema Studio** appears discreetly as a trusted platform identifier (e.g. footer or "Powered by Rhema Studio"). Do not re-create the church website inside this entry flow. Before the host can be discovered or authenticated, show an unmistakable but neutral Rhema fallback rather than pretend to know the church identity. Fetch/present canonical church branding from the authenticated host; reject untrusted remote asset URLs, scripts and unsafe styling. Provide graceful fallbacks for missing logo, very long names, poor contrast and an unreliable connection. Support authorized multisite/campus selection only where host identity and permissions require it.

**Novice-first approved UX principles:** one dominant **Connect to Church** action; automatic host discovery when available; obvious "Enter address" and QR fallback without technical jargon; brief code pairing and host-granted role; clear connected/awaiting approval/host not found/expired/revoked/paused signals in human language; no user-facing selection of elevated permissions. Contextual explanations, not a full-screen tutorial. Large touch targets, mobile/tablet/desktop layout, accessible contrast and keyboard navigation. Optional theme choice must not obscure the church's identity.

After pairing, the host determines the role. The UI confirms it succinctly (e.g. "You're helping with Bible readings"), then opens that role's own screen. A Bible operator sees "Find Scripture" and the next assigned reading, not a generic menu of every desk; others likewise receive their own relevant actions, relevant Program/Preview truth and Comms.

**Status distinction:** `FLOW + CHURCH-FIRST BRAND DIRECTION: OWNER APPROVED`; `PIXEL DESIGN / STATES / LAN IMPLEMENTATION: NOT YET REVIEWED OR VERIFIED`. This approval must not be misreported as a signed-off screenshot, full production authentication implementation, or real LAN acceptance. The previously defined owner sign-off remains necessary for actual layout, responsive states and interactions.

**Explicit future scope exclusion:** a separate church website is a possible future owner-led project **after Rhema Studio is completed**. Do not design, scaffold, build, issue-track, estimate, PR, deploy, or otherwise include church website work in the present Rhema backlog. The *operator entry screen* is branded by the church but is **not** the church website. Do not confuse this with the existing Rhema product marketing/documentation website.

### Bible Operator — OWNER-APPROVED AUTHORITY MODEL (28 October 2026)

**Decision approved during Bible operator page brainstorming:** support **both** direct Scripture activation and prepare-for-approval, with the active mode **assigned by the main host for each operator/session**. Do not ask the volunteer to choose or grant their own authority. Keep one stable Bible workspace with the same Search → Private Preview → role-authorized final action structure. In direct mode label the final action **Activate Scripture**; in approval mode **Request Activation** (or equivalent plain-language wording), which queues a request for authorized host acceptance, not a silent Live Take. The server enforces this permission; do not merely hide a button or equate an existing broad `bible` role with new fine-grained approval permissions. If the existing role/command ACL lacks this split, implement a backward-compatible host-granted authority scope or server-confirmed workflow and update security tests.

**Truthful feedback for both:** distinguish `Prepared here`, `Request sent / awaiting host`, `Host approved`, `Bible source activated`, and `Actually visible on subscribed congregation output(s)`. If no output currently follows Bible, say so explicitly: source activation must not be misrepresented as congregation visibility. The current independent Preview/Program/Take approval, current scene revision, audience-language configurations and rehearsal guards remain authoritative; a Bible activation must not force an output Take or turn every screen to Scripture. An operator cannot bypass host revoke/pause/reclaim and must see stale/offline status.

**Still exploratory, not owner-accepted page design:** top-of-screen actual Live Bible, obvious Scripture search, planned next reading, private passage Preview, contextual single action, Prev/Next verse, language choices as permitted, heard-verse suggestions, Comms and an advanced tools disclosure. This is design brainstorming; do not mark a visual layout or full browser functionality as signed off.

### Worship Operator — OWNER-APPROVED TEMPORARY WORKING SEQUENCE (28 October 2026)

**Decision approved during Worship Operator page brainstorming:** an authorized **Worship Operator** may rearrange, insert, repeat, or skip songs/sections in **their temporary working sequence during the service**, without requiring Editor or Presenter privileges. This allows spontaneous worship-leading changes while preserving the approved canonical service Plan. **Persistent changes** to the approved service's worship set, song arrangements, library content, scheduled events, or running order require appropriately authorized **Editor/Presenter** permission and existing revision/approval safeguards.

**Clear state separation:** distinguish `approved service plan` → `operator working sequence` → `private Preview` → `activated Lyrics source` → `actual outputs subscribed to Lyrics`. Editing/reordering the working sequence must **never** silently change a currently active verse, current output, committed service plan, or another operator's view. The working sequence is session/service-scoped, remains available when switching songs, and can be discarded/reset back to the approved set with a clear action. Decide persistence/recovery of temporary changes as a separate implementation detail; do **not** silently save them to the permanent service.

**Role/security requirements:** enforce on the host the distinction between temporary sequencing and approved-plan edits. Existing `worship` server permissions currently cover song show, preview and section navigation, **not** general service-plan editing; do not widen these accidentally. Direct Lyric activation vs prepare-for-host-approval may reuse the Bible Operator pattern, but **that specific Worship authority model and the full visual page remain proposed**, not owner-approved by this temporary-sequence decision alone. Keep Live/rehearsal/host reclaim/approved revision gates intact.

**Novice-friendly UX:** the Worship workspace should foreground current Live lyrics, searchable hymns/songs, private Preview and simple Next/Previous/Chorus actions; put `Adjust this set` as contextual controls with an unmistakable `Temporary for this service` indicator. Make `Save to service plan` unavailable to ordinary Worship role and clearly route authorized users through the approved workflow. No confusing shared editing or surprise on-screen Take.

**Acceptance example:** Worship operator changes the temporary order from `Song A → Song B` to `Song B → Song A`, then repeats the chorus twice. Main host still sees the untouched approved service order; currently Live lyrics do not change until the normal authorized source/section activation, and a reconnect does not falsely claim the temporary order was saved as the approved plan.

### Bible Operator — detailed brainstorm preservation and host audio (28 October 2026)

**Purpose:** preserve the full working design discussion for Codex and future page-by-page owner visual review. Distinguish **owner-approved authority/novice-first principles** above from **exploratory UI interaction choices** below, which are not yet pixel-design approvals or proof of implementation.

**Bible page proposed design, all subject to owner visual acceptance:** one church-branded novice-friendly role page with authoritative **Currently Live** Bible and explicit actual audience/output-following status, prominent fast typed or natural-language Scripture reference/keyword search (with book abbreviations and safe suggestions), next planned reading one-tap, **Private Preview** isolated from Program, primary button matching host-set **Activate Scripture** versus **Request Activation**, per-verse/range jump and Next/Previous via a **Scripture Rail**, a collapsible **Recently Shown** list with "Prepare previous", plus noninterruptive detected/heard Bible reference suggestions and relevant Rhema Comms action requests. Hide translation management, full chapter/advanced search and system options under contextual tools, not primary nav. Maintain operator focus when spontaneous sermon requests arrive: detection and incoming notices never overwrite a passage the operator is editing or change Live.

**Pagination and bilingual proposed behavior:** a single prepared passage (e.g. Psalm 119:1–16) can render as one verse, multiple verses or automatically fitted/readable segments **per subscribed output**, preserving verse references, approved looks, correct English/Yorùbá texts and diacritics. Do not truncate a longer translation or silently substitute missing Yorùbá verses. The operator must be able to move to an arbitrary verse, not only adjacent verses. The **source** and its audience-specific scene renderer are separate; a Bible activation never automatically Takes the sanctuary/online scene. Favor a readable default Live text panel with optional truthful miniature visual representation of subscribed audience output(s); that specific presentation choice remains **open for owner review**. Clearing a Bible source is a separate, safe action and does not black out unrelated scenes.

**Audio architecture recommended and explained to the owner:** collect the pastor's speech **at the main Rhema production host**, preferably via a clean pastor-focused mixer feed into a selected USB audio interface (or an authorized built-in input). Host runs one capture → speech-to-text → Scripture-detection pipeline, distributes role-filtered Scripture suggestion events to paired browsers. Operator laptops **do not need to capture sermon audio**. Their own microphones may separately serve the permitted Rhema Comms PTT channel. Distinguish OBS livestream audio from sermon detection capture. Existing `src-tauri/src/commands/audio.rs` and `stt.rs` provide local audio input and selectable Deepgram/Whisper processing; browser distribution, actual hardware performance, configured consent and fallback behavior **still need implementation/QA**. Prefer offline local Whisper when available; do not assume a downloaded speech model is installed or transmit cloud audio without explicit consent. Keep the main host listening if an operator browser disconnects; detect lost/recovered audio and notify the operator without false suggestions.

**Spontaneous-sermon acceptance scenarios to implement and visually review:** unexpected Isaiah 60:1 request; jump from verse 1 to verse 8; return to a previously live passage; switch to Yorùbá (and bilingual output) without redoing search; private "Prepare Romans 8:28" Comms cue; stale operator Wi-Fi; uncertain spoken reference not automatically activated; long passages with independent screen pagination; no current screen subscribing to Bible; request awaiting host action; rehearsal and operator revoke mid-control. Preserve each as a checklist; none is accepted as fully working by this document.

### Timekeeper Page 4 + timing view family — OWNER CONFIRMED CONCEPT (28 October 2026)

The owner confirmed **BOTH automatic host-configured time reminders and manual Timekeeper reminders**, plus a first-class **Rhema-native family of timing and schedule displays** for operator, main presenter, room/backstage, stage/confidence and control-room/studio TV receivers where relevant. This **product direction** is approved; the exact layouts, appearance, actions and individual view acceptances are not. The operator desk stays interactive and novices-first; passive TV/room/stage variants have scoped display-only access to the SAME host timing state. Use the owner's Ontime-style screenshots as functional inspiration only, not code/brand/copy targets. All detailed page-by-page exploration, scope, security and acceptance scenarios are preserved in **[35 — Timekeeper Desk & Synchronized Timing Views](35-timekeeper-and-timing-view-family.md)**. Continue the existing finish-first PR freeze.

### Timekeeper Operator — Page 4 next owner brainstorm (NOT approved yet)

Proposed novice-first split: giant live current-event timer, small planned vs elapsed/remaining and expected end; clear run-of-show **Now / Next** cards; gentle timing thresholds and overrun; accessible limited **Start/Pause**, **+/- time** and **Start next event** controls; conspicuous **Hold / Resume** with an explained reason; named auxiliary timers; private Stage/pastor notices via Comms; church-clock alignment; stale/host-disconnected and clock-skew alerts. **Do not** make any timing action change congregation/OBS output directly. Respect event-clock-following-screen mode and the host's authority, fixed starts, pauses, service schedule, and prior time-change audit. Keep advanced schedule edits in Prepare/authorized hosts; show no false display control. Test a ten-minute sermon overrun, post-connection time reconciliation, early finish, fixed-start service conflicts and operator handoff. This is a proposed page for user review, not an owner-approved layout.

### Operator design review protocol: one page at a time, with owner sign-off

**We have NOT completed the operator visual redesign together. Do not silently invent final approved page designs or count a generic console as accepted.** Implement shared safety/data foundations first, then present an individually reviewable page specification/screenshot/interactive demo to the owner for each step. Record feedback and approval, then continue to the next page. No automatic completion of 12 pages because their route exists.

Review sequence (role-specific responsive shell belongs to the first operator page and is reused, **not** a generic stopover dashboard):
1. **Welcome / Connect / Your Workspace** (approved conceptual flow; church-branded entry): host discovery, QR/code, pending grant, certificate trust, reconnect, expired/revoked/paused.
2. **Bible operator + common role shell**: next task and service, search, sources/translations, private preview, live actions, bilingual behavior, role/session/Comms entry, permission clarity.
3. **Worship operator**: song/hymn lookup, sequence and arrangement, lyric preview, section transport.
4. **Timekeeper operator**: at-a-glance clocks, event progress, Hold/Resume/offset, alerts.
5. **Screens / graphics operator**: output map, scoped Preview/Take, scenes/draft staging, host approval.
6. **Stage operator**: confidence view, next cues, private messages and safety.
7. **Camera operator**: incoming camera grid, true signal/tally/quality, routing requests.
8. **OBS director operator**: preview/program status, online show, camera/record/transition.
9. **Editor / contributor operator**: assigned service plan, moments, drafts, comments and approval.
10. **Viewer operator**: deliberate read-only follow experience, clear no-control boundaries.
11. **Main Presenter / Configure operator**: capable but comprehensible full console, separately gated settings.
12. **Shared Comms, account/session settings, permission/accessibility and error/reconnect states**: refine all roles and complete real multi-operator journeys.

Each page review must show: purpose and primary action; role-based navigation and deliberate omissions; 1440 desktop, 1024 laptop, 768 tablet, ~390 mobile; empty/loading/stale/error/unauthorized/rehearsal/live states; keyboard/touch targets and screen-reader labels; single-language and bilingual fixtures where relevant; confirmation/undo for hazardous actions; observable host results; what explicitly does **not** change Live. A screenshot, mock, code stub or generic tests alone is not acceptance. Ask the owner to approve each page design before marking `VISUAL ACCEPTED`.

## 6. Execution plan and acceptance

**Wave 0 — immediately, during PR freeze (no new PR):** preserve this requirement and audit existing Host/Join/Remote/Comms/connected-device branches. Label already-open relevant PRs for reconciliation; do not open replacement PRs. Lead may delegate bounded *read-only* `api-security`, `web-platform` and `operator-ux` discovery to up to three subagents with explicit evidence and one writer on shared files. Report what is already merged vs missing. Integration freeze precedence remains absolute.

**Wave 1 — after the backlog is controlled:** real Connected Development Mode / explicit environment adapter, test-host bootstrap and diagnostic banner; ship no new LAN surface to production during this purely local QA phase. Use targeted tests and controlled test data.

**Wave 2 — LAN operator vertical slice:** serve production-built responsive operator shell on the native host's same HTTPS origin; join/session/role/revocation, filtered initial Live State/SSE/reconnect, role-scoped navigation, Comms. Complete **one real Bible operator journey**: scan/find host → pair/grant Bible role → lookup installed Scripture → private Preview → authorized host action → visible host/outputs acknowledgment → revoke/pause. Include unauthorized and disconnect cases.

**Wave 3 — extend browser parity:** Worship, Timekeeper, Screens, Stage, Camera, OBS, Editor, Present/Configure, Viewer; role-specific resource APIs as needed; per-output scene/render parity and editor approval; multiple simultaneous devices. Use existing roles/command handlers, not duplicative state engines.

**Wave 4 — owner-led visual review and completion:** page-by-page redesign above. Record APPROVED / REVISE / NOT REVIEWED individually. Iterate under no-new-PR policy unless owner lifts it. Do not sacrifice previously approved main-app redesign or major fixes.

**Technical release gates:** exact server-side RBAC and data redaction; pairing/revocation and cookie/CSRF; same-origin/DNS-rebinding; browser HTTPS and mic; concurrent edits and actor audit; Live output approval/Take and rehearsal isolation; reconnect/stale behavior; offline host with no browsers; output/device acceptance; performance on weak church Wi-Fi; cross-device accessibility and visual approval. Simulated ≠ connected ≠ native tested ≠ physically accepted ≠ shipped.

**Owner reporting:** append to the existing finish-first wave summary: `BROWSER OPERATORS: SPECIFIED / BUILT / INTEGRATED / ROLE QA / VISUAL ACCEPTED`; `CONNECTED DEV: SIMULATED / CONNECTED VERIFIED / SAFETY GATED`; one row per role/page. Do not say full browser operator support exists until the real role journeys run successfully on the LAN and the owner has signed off.

## 7. Scope and precedence links

- `docs/CODEX-UNIFIED-HANDOFF.md` and `docs/rhema-studio/32-feature-coverage-inventory.md` remain the complete product contracts.
- `docs/rhema-studio/28-unified-workspace-contract.md`: six main desktop destinations and the authoritative Preview/Program contract.
- `docs/rhema-studio/30-connected-devices-qa-contract.md`, `16-remote-pairing-design.md`, `23-adr-0002-comms-voice.md`, `24-adr-0003-mcp.md`: use existing network, Comms and permission designs, preserving role boundaries.
- `docs/OWNER-FINISH-FIRST-2026-10-28.md`: owner freeze, integration order, no new PR, safe focused testing and final acceptance; this document is an additional product requirement and cannot silently cancel that execution policy.
