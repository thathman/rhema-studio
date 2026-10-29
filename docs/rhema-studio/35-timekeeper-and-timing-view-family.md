# 35 — Rhema Timekeeper Desk & Synchronized Timing Views

**Design workshop:** 28 October 2026.
**Status:** The owner has approved the **functional Timekeeper product decisions** consolidated below: host-controlled automatic **and** manual reminders, configurable subtle/prominent Stage cues, one authoritative timing model with delegated role controls, private per-output view assignments and dedicated room/studio/Stage surfaces. **Specific pixel layouts, exact transitions and colors, device QA and implementation remain subject to page-by-page visual/technical acceptance; nothing here claims shipping.**
**Execution:** [Owner Finish-First](../OWNER-FINISH-FIRST-2026-10-28.md) remains in force: **ZERO new PRs**; reconcile existing backlog first; no deployment, public website work, host output mutation by mock or relaxed safety. Read [34 — Browser operators](34-browser-operators-connected-development.md), [28 — Unified workspace](28-unified-workspace-contract.md), [32 — Coverage](32-feature-coverage-inventory.md) and existing canonical timing contract #196 before any implementation.

**29 October owner execution update:** The temporary feature pause for the PR merge backlog is **lifted** by [owner resumption](../OWNER-RESUME-IMPLEMENTATION-2026-10-29.md). Preserve this document's approved Timekeeper/Stage function and privacy requirements while Codex **resumes implementing** the full platform immediately; only the PR creation and public website publishing prohibitions remain. Distinguish the still-unapproved interactive [Page 6 Stage Operator visual proposal](39-stage-operator-page-6-layout-proposal.md) from the approved passive Stage/Confidence functional family. This update supersedes the phrase below about reconciling all backlogs before new implementation.

**29 October Stage role authorization approval:** An authenticated Stage Operator can **directly send host-policy-compliant private cues to Stage Confidence monitor recipients explicitly assigned by the host**; no approval round-trip for every such message. Any **additional recipient or elevated privilege/urgency** requires separately granted host authorization or a scoped Approval Request. This does **not** allow the Stage role to change the host clock, alter automatic reminder thresholds, or send to public/OBS outputs. The recipient/priority/expiry policy remains host-owned. See [39 — Page 6 Stage authorization](39-stage-operator-page-6-layout-proposal.md#7a-owner-approved--stage-direct-send-authorization-and-escalation) and [37 — Permissions](37-permissions-sidebar-and-authority-design.md#3b-stage-operator-assigned-monitor-sends--owner-approved-29-october-2026). The individual Stage operator page layout remains a proposal.

## Owner decisions locked for implementation — 28 October 2026 (consolidated)

**This is the canonical owner-decision register for the completed Timekeeper brainstorm.** The owner directed that **all decisions discussed so far be recorded** so the team can move to the next role. This locks **function and interaction principles**, not final visual/pixel approval. "Proposed" details elsewhere in this file are offered design defaults when not explicitly settled; do not mislabel prototypes as shipped.

| Decision | Agreed behavior / guardrail |
| --- | --- |
| **Core UX** | Powerful capabilities, simple interfaces: novice sees **Current Event, Time Remaining, Now/Next**, clock freshness and one or two sensible actions; advanced scheduling and diagnostics remain contextual. Desktop, tablet and phone adapt without losing critical alerts. |
| **One host timing authority** | The main production computer owns planned/expected/actual service timing, event/aux timers and audit. Browser operators, stage TVs, backstage screens, main Live sidebar, control-room displays and countdown receivers are projections, not independent timing engines. Service remains operational offline and after a browser disconnect. |
| **Delegation / conflict policy** | Main host has ultimate authority and can reclaim/pause/revoke Timekeeper control. Host-assigned Timekeeper role may adjust authorized event timing, issue reminders, start/advance authorized event, and Hold/Resume only within current role/host rules. Server checks permissions and revisions. Conflicting host/operator changes are resolved by host-authoritative revision, and every operator sees outcome. No Timekeeper congregation-scene/OBS control. |
| **Automatic + manual reminders** | **Both** are supported. Host configures which event/category has automatic thresholds, message format, destinations, urgency and expiry. Timekeeper can send allowed manual cues when something changes. Example **10/5/2 min remaining** is configurable, not a fixed requirement or always-on rule. |
| **Stage urgency presentation** | **Both subtle, non-obscuring banners and prominent temporary messages**; host configures **per recipient/display and urgency**. Routine uses a calm banner; important increases emphasis; urgent can temporarily prioritize message while preserving a small clock or reliable auto-restore. No blank indefinitely obscured clock. Timekeeper should not need to select TV animations or templates for every send. |
| **Private destination routing** | A pastor's Stage confidence monitor, backstage room TV, studio wallboard, main operator panel and congregation/OBS outputs display **different role-filtered information**. A pastor's private cue must never appear on congregation, lobby or livestream accidentally. Each display/receiver has independent assignment, approval, audience class, permissions and view preset. |
| **Operator cue UX** | Quick **10-min / 5-min / 2-min / custom** reminder selection, real approved recipient list, clear message preview and the **host-determined** appearance before actual send; actual delivery/receiver-display status when possible, explicit error/timeout otherwise. No false acknowledgment. |
| **No duplicate or sticky alerts** | Host deduplicates automatic event-run thresholds across re-offset, reconnect and restart. Manual resend is explicit. High-priority cues may supersede routine ones; bounded priority handling, expiration and return to timing display, independent receiver outcomes and audit log are required. On Hold/Resume, prevent a burst of overdue reminders. |
| **Timekeeper workspace** | Large event timer with labelled elapsed/remaining and planned/projected times; Now/Next, at-a-glance whole-service over/under, working offset preview, reminders, Hold/Resume with reason, next-event action, upcoming schedule and optional aux clocks. Switching display of elapsed/remaining is local UI only. Hold != Pause timer != Start next != scene Take. |
| **Stage / Confidence view** | Very large legible countdown or elapsed time, optional ring, current event and discrete private timed messages; display-only. Options include digits-only, digits+cue, circular timer and countdown-to-start. Stage audience sees no backstage notes or action buttons. |
| **Backstage / Room Schedule** | Read-only schedule **Now / Next / Upcoming** with phase headings, live highlight and planned vs projected times. Can display room-authorized media/stage notes. Offer full-schedule and compact now/next presets, responsive TV sizing and automatic follow-current. |
| **Main Live timing panel** | Compact dockable awareness inside main **Running Order / Preview / Program** layout: current event, remaining, Now/Next, service over/under, Hold and cue state. It is not a new heavyweight duplicated Timekeeper workspace. |
| **Studio / Control Room TV** | Dedicated passive overview with giant event clock, Now/Next, projected finish, over/under, permitted auxiliary timers and status of private cue delivery; presets for clock/dashboard, large clock and ring+status. No operator controls. |
| **Intermission / Countdown** | Reusable service-begins, holding and next-session variants for **explicitly assigned** lobby/sanctuary/stream/room outputs, using only permitted fields. Countdown reaching zero does **not** silently Take a scene. |
| **Independent output looks** | Approved timing visual recipes live in Rhema Design and are assigned contextually via Connections/Outputs, with private Preview and scoped activation. A church brand/theme can style displays but never bypass permissions or mutate existing Live outputs simply by editing a look. |
| **Timing truth + resilience** | Show planned vs actual vs projected distinctly, warn about fixed-start conflicts when sermon overruns, recover or mark untrusted time after restarts, and show stale/disconnected states. Controller disconnect never stops host clocks; receiver reconnection resynchronizes without replaying expired cues. |
| **Production gate** | Screenshots/references and browser demos are design references only. Requires real host permission tests, real stage/TV/browser output and privacy acceptance, offline/connection failure and accessibility QA; never claim complete because a doc/PR is merged. |

### Interaction examples to keep consistent

1. Pastor's 30-minute sermon enters the last five minutes. Host policy sends a **subtle 5-minute banner** to the pastor's assigned confidence monitor, without changing the congregation screen. Timekeeper sees its recipient and true delivery state.
2. Sermon unexpectedly runs eight minutes over. **Backstage** shows projected Offering start, **control room** shows +8 min and revised finish, **Stage** shows overtime or host-authorized private cue, and **main Live** shows a compact warning. Approved plan times and any fixed next service are preserved.
3. Timekeeper sends **urgent "Please conclude in 2 minutes"** to a pastor monitor. Only that display shows a prominent temporary message; the underlying clock keeps running/visible in a smaller region or returns automatically. The backstage TV and OBS output do not show the private message.
4. Two assigned displays may render the same cue in **different permitted styles**. An urgent message preempts a routine banner; old messages expire and do not reappear after receiver reconnect.
5. Timekeeper adds five minutes while host is correcting the schedule. Host revision/authorization wins and the operator receives a clear conflict or accepted adjustment. The service plan is not silently rewritten.
6. A browser operator disconnects during worship or sermon. Native host, Stage timer and studio TV remain correct and local/offline; returning operator sees fresh canonical clocks and no duplicate automatic reminders.
7. Reminders run on the event timer; **aux timers** may be started/paused independently by authorized owners. Hold service or pause service timer does not implicitly pause every auxiliary clock or change a program scene.

### Owner sign-off boundary

**APPROVED:** the functional decisions in the table and the existing dual reminder / subtle-or-prominent Stage behavior. **AWAITING INDIVIDUAL VISUAL SIGN-OFF:** the exact Timekeeper Desk layout and the separate Stage Confidence, Backstage and Control Room presets (including specific clock sizes, colors, ring design, message durations/transitions, UX copy and screenshots). **NOT CLAIMED:** connected browser operator product, native pass/fail hardware or shipped timing view suite.

## A. Product distinction: One engine, many arrangements

Rhema Timekeeping is **one host-authoritative timing model** projected into independently authorized operator, crew and display views. It is not a fork of Ontime, a duplicated scheduler, or a separate timekeeping app. The owner supplied Ontime-style screenshots as **functional references**, showing large legible typography, colored current/next schedule, run-of-show boards, passive screen-specific layouts, elapsed/remaining, circular countdown, over/under and auxiliary timers. Borrow **information architecture and useful behaviors only**; implement Rhema's own layout, visual system, labels and source code.

There are five distinct, non-interchangeable timing concepts:
1. **Scheduled service timeline** (planned start/end, phase/event, fixed start constraints).
2. **Live event clock** (actual start, elapsed, remaining vs plan, overrun, projected finish).
3. **Service timer** (start/pause and adjustments; must not silently alter the approved schedule).
4. **Auxiliary timers** (named/owned independent clocks, e.g. stage speaker 5 min).
5. **Display countdown/holding view** (read-only rendering of the authoritative clock or scheduled next event); quiz lobby countdown is a separate timer type.

Every view reports which clock it shows and whether timing is planned, projected or observed. "Hold", "Pause timer", "Stop output", "Start next event", and "Add five minutes" are **different actions** with explicit scope. The actual expected-end calculation and role-granted modifications live on the host. Never let a browser's local wall clock become the source of truth or let a timer action implicitly Take a congregation scene.

## B. Page 4 — Timekeeper Operator (interactive desk, proposed screen)

### B1. First 3 seconds on entry
Church identity + today's service + role + **connection freshness**; giant current event **time remaining** by default with exact **elapsed** and **planned duration** context; obvious event name and current RUNNING/HOLD/PAUSED/REHEARSAL state; **Now / Next** visible without opening a dropdown; compact **expected event end** and **whole-service projected end/over-under**. If no event is active, the hero explicitly switches to **Time to next scheduled event**, not a fake remaining timer.

### B2. Layout, responsive hierarchy
- **Main hero:** live event title + large countdown/elapsed clock, restrained progress bar, service-time indicators, quiet alert at configured thresholds. Tap to change *read-only display* between remaining and elapsed without changing the underlying timer.
- **Now / Next card:** current activity with original planned start vs actual start and projections, next activity with fixed-start warning, assigned stage notes visible only if role permits.
- **Operator action row:** authorized Start/Pause service timer (clearly named), +/- timing offsets with consequence preview, `Start next event` with confirmation and actual role/host mode gating, **Hold** with reason / **Resume**. Avoid simultaneous huge dangerous buttons next to simple read actions.
- **Private reminders:** one-tap Send 10/5/2-minute reminder to configured stage/crew destination; optional custom text; actual recipient(s) and visibility before send; request/received/acknowledged status, not a false "sent" toast.
- **Run of show:** short upcoming strip by default (2–4 events) and expand to full schedule board; show projected vs planned and fixed starts, no arbitrary scroll table in the primary view.
- **Utilities:** auxiliary timers, per-event notes and named Timekeeper-specific controls behind contextual drawer; all critical alarm/connection states always discoverable.
- **Desktop:** roomy Now clock, compact Next panel and upcoming events; **tablet:** hero + two-column actions; **mobile 390px:** thumb-reachable action hierarchy, zero horizontal tables, readable digits, no hidden stale warning; **1080p studio** uses a passive view instead of auto-mirroring this interactive desk.

### B3. What the buttons mean
| Action | Exact effect |
| --- | --- |
| View remaining/elapsed | Changes only this operator's UI reading; never the clock |
| Adjust +/- N min | Proposes scoped host-authorized event/clock offset; shows impact on projected end and fixed sessions before committing; no approved Plan rewrite |
| Start/Pause *service timer* | Sends matching timer command; does not imply Hold or cue outputs |
| Hold/Resume *service flow* | Requires clear rationale for Hold, updates host state/log, affects timing/automation only according to canonical rules, not unrelated scenes |
| Start next event | Explicit authorized transition with human-visible consequence in event-following mode; not the same as `Next slide` |
| Send manual reminder | Private event-linked notice to selected authorized destination(s), with delivery/ack when available |
| Reset view | Resets the **view arrangement**, not host timers or service schedule |

**Existing baseline:** `src/studio/production/operators-panel.tsx` `ClockDesk`, `DeskTimer`, `DeskHold` and `DeskAuxTimers` already exercise some host actions. They are compact joined-desks, **not** proof of owner-approved responsive browser Timekeeper UX. `src-tauri/crates/api/src/keys.rs` permits Timekeeper event navigation, offsets, timer start/pause/adjust and hold/resume, plus scoped aux-timer rules. Do not grant scene/OBS/settings actions to Timekeeper.

## C. Reminders — OWNER-APPROVED dual model, details proposed

The main host assigns a **Reminder Policy** to each event/category or approved role configuration:
- **Automatic thresholds**, e.g. **10, 5 and 2 minutes remaining** (editable; not assumptions/mandatory defaults), based on authoritative host event timer.
- **Manual notices**, sent by the Timekeeper when the service changes unexpectedly.
- Both use **one destination and privacy policy**: stage confidence screen, specific backstage/room screen, pastor's approved personal feed, Director, Comms group, or none. **Never default private instructions to sanctuary/stream/lobby**.
- Show exactly what the recipient will see. Message and role ACL remain independent of the display's look/scene.
- Acknowledgments and `sent / delivered / seen / stale / failed` should be truthful; not all passive TVs can acknowledge. Receiver can show an expiry-limited cue; preserve per-recipient delivery truth.
- Trigger **at most once per threshold per event run/revision**. Back-and-forth time adjustments, reconnect or restart must not flood staff. Manual resend is explicit and audited.
- Hold/Resume and rehearsal rules must be deterministic; rehearsal messages never leak to live sanctuary or unauthenticated receivers.
- If notifications can't be delivered, timing continues locally; show failures on the operator desk rather than pretending success.
- Provide opt-in *host-approved* audible/vibration/time warning only where suitable and with privacy/accessibility considerations.

### C1. Stage Confidence reminder presentation — OWNER APPROVED (28 October 2026)

**Approved owner decision:** support **BOTH** (a) subtle reminder **banners** and (b) **prominent temporary messages**, with **the main host configuring the display policy and message urgency**. This decision complements the existing approved **automatic host-configured reminders + Timekeeper-initiated manual reminders**. Do not require the novice operator to set presentation mode or adjust the TV look while sending a routine reminder.

**Interaction contract / behavior to implement and validate (design refinement, not yet pixel-approved):**
- **Routine / informational:** non-obscuring banner below/alongside the current clock, preserving legible time, with speaker-safe privacy and short permitted duration.
- **Important:** higher-contrast banner or prominent but non-destructive message region, configured by host; full display takeover only if that particular destination's policy permits it.
- **Urgent:** prominent temporary message at that recipient's assigned confidence display, with conspicuous label and accessible high contrast; **keep at least a small persistent running clock or an obvious timed return**. Never show an indefinite black/blank stage view. Automatic reminders default to routine presentation unless explicitly host-configured differently.
- **Per-destination policy:** approved receiver ID, audience classification (stage/talent, control-room, backstage, etc), allowed reminder types, priority threshold, look/template, show duration/expiry, restore behavior, optional chime/vibration and whether explicitly authorized messages may displace the timer. Each destination independently chooses its look; no crew note leaks into public output.
- **Sender UX:** Timekeeper sees human-readable destination and resulting style (e.g. `Stage confidence · Subtle banner` or `Pastor monitor · Prominent 2-min cue`) before sending. Simple **10 min / 5 min / 2 min / Custom** buttons and a deliberate **Important/Urgent** affordance only when allowed by host scope. Host may override or deny unauthorized priority escalation. Preview is private, not a live output Take.
- **State machine:** `prepared → authorized/queued → transmitted → receiver-applied → expired/restored`, plus denied, offline and failed. Distinguish server ACK from actual receiver display confirmation. Capture actor, event revision, recipient group, priority, cue ID, created/delivered/displayed/expired times and source manual vs automatic. Multi-screen delivery maintains per-receiver outcomes, not one falsely global check.
- **Timing and overlap:** countdown remains host-authoritative. Expiry and return to prior confidence view are automatic and idempotent; unique cue IDs + event-run-threshold dedup for automatic sends, bounded priority queue for competing cues, host-controlled preemption (urgent before important before routine), scheduled expiry even if sender disconnects, and no re-show after receiver reconnect when cue has expired. Paused/held service does not generate repeated threshold alerts; resume is deterministic. A new urgent cue can supersede the previous cue; avoid alternating visual flashes.
- **Privacy and safety:** never send private Stage cues to congregation, livestream, foyer/public signage by default or by inheritance. Receiver ACL, role permissions and stage-message scoping are enforced on the host and in filtered state transport; browser page/UI toggles do not confer new authority. Never turn notification display into a new scene Take or an alternate privileged operator channel. Emergency notices not related to timing may need separate future policy; do not silently repurpose this mechanism as safety-critical emergency communications.
- **Accessibility:** large legible text on 16:9 confidence TV from stage distance; no flashing or color-only urgency, optional calm audible alert only when physically appropriate; readability under bilingual EN/YO strings and long church names; contrast checked with church Brand Kit.
- **Proposed default UX:** routine automatic 10/5-min cue as a short banner; 2-min cue more prominent **only when host-configured**; manual urgent message prominent and auto-restoring. Exact colors, durations, transitions and words are **pending owner visual review**.

**QA journeys:** scheduled 5-min threshold while operator browser disconnected; manual urgent reminder during sermon overrun; two simultaneous recipients with different presentation styles; queued routine cue interrupted by urgent one; Hold then Resume near a threshold; receiver Wi-Fi loss then reconnect after expiry; revocation mid-send; no cue on sanctuary/OBS public outputs; Stage clock remains legible or returns on schedule, with actual receiver display evidence.

## D. Passive timing view #1 — Stage / Confidence Timer

**Audience:** pastor, speaker, choir leader, stage manager and talent-facing screens, as configured.
**Question answered:** "How much time do I have and what is my next cue?"
**Default:** huge count-down or elapsed number, optional discreet Now event label, readable progress indicator, optional `ON AIR` only when its own accurate state is known, **private** time warnings from authorized sender. Time-of-day small and subordinate. Multiple presets: **minimal digits**, **digits+cue**, **circular ring**, **next-event countdown**. These are one renderer with different per-output looks, not separate timing engines.
**Privacy:** never show production notes, other people's Comms, internal operator controls, secrets, detailed service plan or sensitive timing edits by accident. Private speaker messages go only to explicitly assigned Stage/Confidence destination. Ring/color must never be the only signal of urgency.
**Output:** authenticated/scoped browser receiver, existing Stage/Confidence destination, native display/TV receiver where supported; host owns role/receiver permissions and revision. The display is read-only. On stale state freeze/show "Connection lost — last updated…" rather than invent progress.

## E. Passive timing view #2 — Backstage / Room Schedule Board

**Audience:** volunteers, greenroom, backstage, media room, rehearsal crew.
**Question answered:** "What is happening, what comes next, and when?"
**Default:** TV-readable **Now / Next / Upcoming** with clock top-right; scroll/fit section of planned→projected schedule with phase headings, live highlight, per-event intended duration, fixed-start boundaries, delay/overrun explanation and selected **room-authorized notes**. Offer two presets **Full Schedule** and **Now + Next**; read-only automatic follow-current scrolling. Support event grouping by pre-service/main/post without duplicating event state.
**Privacy:** separate role-/screen-ACL note fields. "Video/Stage Notes" from the reference are **not automatically public** and must not be shown on lobby or stream screens. Private backstage boards use scoped receiver pairing; a guest/public screen uses only public fields.
**Edge cases:** events with no time; skipped/ended events; added spontaneous song; updated phase; delayed fixed-time start; multiple long sessions. No redrawing flicker or unreadable tiny table at 1080p.

## F. Passive timing view #3 — Studio / Control Room Overview

**Audience:** technical director, media/control-room wall monitor.
**Question answered:** "Is our service on time, what is active, and what needs attention?"
**Default:** extra-large primary live event clock; Now/Next cards, service **planned versus expected end**, over/under, auxiliary timers by permitted owner, current Hold/Resume and warning; optional read-only list of next 3 events, status of stage reminder (queued/received), and connectivity freshness.
**View presets:** **clock + dashboard**, **large clock**, **circular timer + status**, **compact cue and schedule strip**. Avoid enormous unnecessary information on one wall. No click targets, no accidental transport, no editable settings.
**Access:** privileged production-room receiver profile, not a publicly shareable congregation link. Separate its content permission from the host operator's control permissions.

## G. Main host embedded panel + additional view variants

The **main Rhema Studio Live workspace** includes a compact dockable, glanceable Timing panel (event name, remaining, Now/Next, over/under, hold, cue indicator, go-to Timekeeper). This is *not* a second standalone Timekeeper screen and does not overwhelm the existing Running Order / Preview / Program layout. A host can perform authorized timing actions through existing scoped controls.

**Countdown / Intermission / Pre-service:** additional read-only template variants for lobby, sanctuary, room or stream holding, only when deliberately assigned. Show "Service begins in", "Next session in" or "Intermission" using the approved schedule plus permitted branding; **no internal stage cues/notes**. A content or scene trigger is explicit and follows source/Take approval; schedule reaching zero must not automatically replace a congregation scene unless that behavior has been separately armed/approved.

## H. Timing/source/output architecture & reusable design

- Render all presets from the existing **one canonical host Live/Timing State**; never create per-device timers that drift. Provide initial snapshot + monotonic revision/heartbeat + reconnect resync and consistent host/church time zone. Latency compensation is display only, bounded and marked stale.
- Treat a **timing view recipe** as a reusable, editable approved visual in Rhema **Design** (via native look/editor contract), selected contextually during service/output assignment; editing or previewing a look does **not** mutate the live displayed output.
- In **Connections/Outputs**, operator picks authorized receiver/device → assigns one timing view preset and audience classification → private Preview → host approval if required → scoped explicit Take/Activate (when needed). No arbitrary port 3000 fixture display or cookie bypass to control LAN host.
- For Android TV, browser receiver, local display, stage and OBS, reuse existing independent source/scene routing and receiver contract rather than a new insecure auto-connected server; labels must state real follow status.
- Separate permission to **view timing**, **receive private cues**, **adjust timing**, **change schedule**, and **change a scene/output**. A public/private read-only screen never acquires controller rights. Host can revoke, reclaim and redact immediately.
- Accessibility: legible at a distance, minimal high-contrast variants, color-independent statuses, font-scale settings, avoid bright flashes on stage; 16:9 and 4:3 TVs, portrait room monitors, browser tablets; do not transmit screen-specific private content to an untrusted receiver.

## I. Suggested delivery priority, not yet owner-rated for implementation

1. Timekeeper Desk (browser role + native shared component).
2. Stage / Confidence Timer.
3. Backstage / Room Schedule.
4. Main Live Timing Panel.
5. Studio / Control Room Overview.
6. Intermission/Countdown variants.

The user approved **proceeding with design exploration** of Page 4 and the first three passive views, not a waiver of the PR freeze or a claim all six will ship immediately.

## J. Owner review questions & acceptance gates

**Closed product decisions:** both Stage message presentations, automatic plus manual host-governed cues, host ultimate clock authority, and distinct timing display destinations are recorded above. **Still pending visual review:** exact clock presentation/remaining-vs-elapsed appearance, early/late colors and labels, confirmation-copy for Hold and next-event, backstage note filtering UI, display light/dark/branding variants, screen-specific message durations and transitions. These are design details, not objections to the agreed underlying functionality.

Physical/rehearsal scenarios required before SHIPPED:
- Pastor sermon expected 30 min, extends by 10; host correctly moves projections but preserves fixed 11:30 activity and never silently changes service Plan.
- Auto reminders at 10/5/2 and a manual "wrap in two minutes" reminder, correctly routed to Stage only, no duplicates after offset correction; revocation instantly prevents sending.
- Laptop browser disconnects while Stage timer and control room wall continue from host; stale receiver shows clear state and resyncs on reconnect.
- Main host can run all timing solo with no clients or WAN, Whisper/microphones unrelated to timing, reception after app restart recovers accurately with untrusted elapsed flagged.
- Pause an auxiliary timer while main service continues; Hold service while other independent clocks obey their own rules; no illegal implicit scene Take.
- Public/lobby/OBS outputs never display private crew notes, raw recipient messages, hidden service details or backstage status.
- Church-branded, novice-legible 1024x700 laptop, 390px phone, 1920x1080 and 3840x2160 TV. Real Android TV/browser/OBS/native testing; test-only fixtures do not establish device acceptance.

**Do not call this approved visual design until the owner has reviewed each actual page preset; do not call it implemented until verified on host and devices.**
