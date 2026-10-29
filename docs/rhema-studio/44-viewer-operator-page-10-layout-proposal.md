# 44 — Page 10 Viewer Operator: Follow the Service (Read-Only Production Awareness)

**Workshop date:** 29 October 2026. **State:** **PAGE 10 STRUCTURAL/UI PROPOSAL — NOT OWNER-APPROVED**. Page 9 Editor's three-part hierarchy and separate Save Draft / Submit for Review were owner-approved in [43 §9](43-editor-operator-page-9-layout-proposal.md#9-owner-page-9-sign-off--approved-29-october-2026). Next in [34](34-browser-operators-connected-development.md) is **Viewer** (then Page 11 main Presenter/Configure). This document proposes a simpler browser/mobile joined experience, not a new church website or another control application. Existing owner resume-build/no-new-PR and security requirements remain.

## 1. Viewer role promise

**Viewer = follow the service and privately coordinate when permitted, without managing the production.** Use cases: usher captain, prayer coordinator, backstage runner, welcome team lead, non-technical church worker, invited staff member. They need correct Now/Next and schedule, visible service progress, relevant safely filtered announcements and crew Comms.

This is **read-only with respect to Live show state**, not necessarily a silent spectator: Viewer may use **authorized Rhema Comms push-to-talk / notices and acknowledgment** within the host's channel and recipient policies. Such communication **does not** confer Stage cue Send, Screens graphics Show, OBS Take, Camera scene controls, Timekeeper control, Editor draft edits, recorder start/stop or global scene/output management.

Avoid the name `Watch` if it suggests a public congregational livestream app: call the operator route `Viewer` / `Follow Service`. Audience-facing church website/mobile app is a separate product, not the default joined operator desk.

## 2. Proposed Page 10 main screen (desktop)

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ [Church identity]    SUNDAY WORSHIP · FOLLOW SERVICE    [Host Connected] [Role: Viewer]      │
├──────────────────────────────────────────────┬──────────────────────────────────────────────┤
│ NOW & NEXT                                   │ SHOW STATUS / CLOCK                           │
│ ● LIVE · Sermon                              │ [00:08:20 remaining] · Host-authoritative     │
│ Pastor preaching · start time / elapsed      │ Current: Sermon · Next: Offering              │
│ Next: Offering · expected start 10:48        │ Screen: Sanctuary "Sermon camera" (if allowed) │
│ Following: Announcements                    │ "On congregation output" / last seen         │
├──────────────────────────────────────────────┴──────────────────────────────────────────────┤
│ RUN OF SHOW                                                                               │
│ ✓ Opening Prayer    ✓ Worship    ● Sermon    ◯ Offering    ◯ Announcements    ◯ Closing  │
│ [View full service order ▾]    [Show planned times]    [My relevant cues]                  │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ CREW MESSAGES FOR ME (2)                                                                 │
│ Director → Ushers: "Prepare offering baskets"  [Acknowledge] [Reply]  PRIVATE              │
│ Welcome Lead → Ushers: "Guests at west entrance"   [Reply]   PRIVATE                     │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ RHEMA COMMS  [Talk allowed: Ushers channel] [Hold to talk] [Who's talking / mute / privacy]│
│                   [No permissions to control any Live output]                             │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Visual hierarchy:** (1) active service and host freshness, (2) **Now / Next and large trustworthy clock**, (3) compact service Running Order or timeline, (4) relevant private crew notices with scoped Acknowledge/Reply, (5) quick authorized Rhema Comms. Avoid a dense dashboard, fake stream preview, Production Settings or one button per source.

**Information controls:** A Viewer may only see output/source names, receiver status and event details **the host explicitly authorizes for their audience class**. Never default to unrestricted pastor confidence notes, volunteer-private prayer requests, credentials, Design/approval diffs, private phone camera feeds or detailed production topology. If not authorized to see any screen state, show `Service event in progress`, not a misleading proxy of Program.

## 3. Viewer-specific flows

### A. Ushers follow offering
1. Paired authorized Viewer opens on phone; main `NOW: Sermon, NEXT: Offering` is visible with current host event clock and clear `Live / Rehearsal` state. Service start / end timing comes from host, with explicit timezone/freshness.
2. The next event/card advances when the host actually progresses, not when the viewer scrolls or taps. A row tap opens **read-only details** such as event title, approved plan time and crew-visible notes, never a Start Event.
3. Director sends a private event-linked `Prepare offering baskets`. Viewer can `Acknowledge` or `Reply` **only** when host message policy allows. Reply is a crew communication action, not approval, stage message or operator control. Director sees `Acknowledged` separately from `Completed`.
4. If service pauses/late, the page follows host timing; Viewer has no buttons to change clock or end event.

### B. Read-only Viewer during disconnected host
1. Browser loses church LAN connection, status becomes `Disconnected · last updated [clock]`. Run of Show is a *cached last-known* snapshot clearly marked stale, not a live countdown.
2. Disable message send/Talk/ACK until a real secure channel resumes. The church's actual Live service continues independently on the host.
3. After reconnection, resync the current service revision, event cursor and permitted notices; prevent duplicate ACKs. If role revoked, sign out or show `Permission changed` without private residual content.

### C. Viewer receives a private crew cue
- Cards belong only to Viewer-assigned Comms channels/recipients and the relevant service event. Speaker/Director names display as allowed, with priority/expiry, exact requested action, and a clear `Acknowledge` / `Reply`.
- Avoid actions such as `Take scene`, `Show Camera`, `Send to Stage`, `Approve request` or `Stop recording`. Such an instruction from someone in text is still not a permitted command. Any `Open relevant screen` link is **view-only**, and private content is filtered at the host, not only hidden from UI.
- Crew Talk supports original Rhema Comms full-duplex *held* push-to-talk where approved, channel and speaking state, no involuntary mic activation, permissions respected, stop on button release/focus loss/disconnect.

## 4. What makes Viewer different from other pages

| Role | Primary task | Controls |
| --- | --- | --- |
| Timekeeper | Actual host show clock and timing reminders | Time and host-granted reminder actions |
| Stage Operator | Send permitted private performer cues | Assigned private Stage monitors only |
| Editor | Prepare assigned drafts and submit review | Draft/editor actions; never Live |
| Camera | Source quality/framing readiness | Camera Ready/Unable; separately granted source recovery |
| Screens | Take/Show named congregation output graphics | Explicit host-scoped physical Program |
| OBS Director | Online stream Program/Preview | Explicit OBS Take only with scope |
| **Viewer (Page 10)** | See Now/Next, Run of Show and relevant private crew cues | **No production mutations**; limited Comms Talk/notices/ack when authorized |

**Output preview vs state:** This page is not a new live video stream. A real video thumbnail is optional later if separately authorized and supported. Present read-only authenticated output names/status when actually available; never fabricate video or claim a physical receiver has shown a frame solely from host intent. Limit bandwidth and CPU on mobile. `Current event` is not necessarily exactly `what's visible on a congregation output`.

## 5. Mobile and tablet behavior

- **Desktop:** two compact Now/Next and Clock cards at top, full Run of Show strip, actionable private notice list, small Comms control at bottom or rail.
- **Tablet:** clock and Now/Next stay above service timeline, notices below. An event may open a non-editable detail drawer.
- **Phone (~390px):** large `NOW` / `NEXT` card, readable host-clock, 2–3 upcoming events, compact `View full service order`, pinned `Talk` control **only when allowed**. Incoming private notification badge and drawer without blocking event/timing. No cluttered card carousels or global output nav.
- **Accessibility:** color + text for Live/Rehearsal/Stale, large tap targets and keyboard/screen-reader reading order. Do not rely on screen color to imply "Live".
- **Special statuses:** Host paused controls, LAN offline, service not started, service changed, show ended, pending crew notice, session expired, role revoked. Only honest host-timed updates.

## 6. Existing code (observed 29 October) — reuse

- `src/studio/production/operators-panel.tsx` maps `viewer: []` for full specialist desks, but all joined roles still see host `On the screens` status, `RunOfShowView`, `JoinedTalk` and `NoticesPanel`. **Build a compact viewer-first composition from these existing components**, not another shadow source of service truth.
- `src/lib/remote-roles.ts` declares `viewer` / `View only` with `Follows the service and the run of show, and can use Talk and notices. Changes nothing.`
- `src/lib/live-state.ts` carries host Live State, run of show, current event, timing, notices and filtered voice; host role-specific payload filtering and freshness must be confirmed rather than assumed by mere presence of client code.
- [23 — Comms voice](23-adr-0002-comms-voice.md) requires full-duplex held push-to-talk, real speaker state and channel rights. [34 — Browser Operators](34-browser-operators-connected-development.md) sets secure sessions/host ACL, source filtering, trusted connection, identity and talk policy.
- **Not a completed browser Viewer design:** Existing joined common panel is denser than the proposed Viewer-specific Now/Next presentation. A source snapshot or design document does not confirm actual mobile readability, privacy or browser parity.

## 7. Acceptance scenarios for Codex

1. Viewer paired to live host reads correct current service/event, Now/Next, expected/planned times and authorized output state; never sees production Take/Save/Record actions.
2. Viewer click on current or upcoming event opens only read-only detail; no underlying state mutation or elevation of another operator's role.
3. Scoped Director/crew message routes privately; viewer acknowledges/replies within host policy; no accidental auto-execution. Unauthorized channel/message is omitted server-side.
4. Allowed PTT is held-to-talk and releases on pointer/keyboard up, window blur or disconnect; Viewer without Comms rights sees disabled and understandable controls.
5. Viewer loses network; timing becomes visibly stale, send controls disabled, recovered host snapshot resyncs correctly. Permission revoke immediately blocks and removes private content.
6. Multiple language/output variants and pastor notes: viewer sees only authorized general service detail, not Stage/private layers or another operator's confidential payload.
7. Mobile 390, tablet 768 and desktop 1440 maintain large event/clock and quick crew notices, no "technical production dashboard" overflow.

## 8. Proposed owner decision — not yet approved

**Proposed Page 10 structural hierarchy:** `Now & Next + large trusted service clock → compact Running Order / upcoming events → private role-filtered crew requests/notices → optionally permitted Rhema Comms`. The whole page is **read-only as to production state**, with explicitly allowed personal Comms/ACK as a separate capability. No default video playback or congregation-public website. On mobile, prioritize Now/Next and clock above every other panel.

**Open nuances:** whether to show optional *named congregation output state* to every Viewer or only specifically assigned groups; whether small preview thumbnails are ever useful; default density of full cuesheet; which crew roles get Comms by default. Do not imply any of these privileges or UX pixels are approved without explicit owner signoff.
