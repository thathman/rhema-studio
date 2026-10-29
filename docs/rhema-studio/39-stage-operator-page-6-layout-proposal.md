# 39 — Page 6 Stage Operator: Private Confidence and Cue Control (Visual Brainstorm Proposal)

**Workshop date:** 29 October 2026. **State:** **OWNER-APPROVED ROLE PERMISSION DECISION; PAGE 6 VISUAL LAYOUT STILL PROPOSED.** The owner approved direct Stage Operator sending to their **host-assigned private Stage monitors** when each cue complies with host policy; additional destinations or elevated privileges require separate authorization. The Stage UI remains a design proposal until individually accepted and tested.

**Previously owner-approved functional authority:** [35 — Timekeeper and Timing Display Family](35-timekeeper-and-timing-view-family.md) already governs one authoritative host clock, automatic + manual reminders, per-display subtle/prominent Stage urgency, independent filtered Stage/Backstage/Control Room screen contents, offline behavior and private routing. [34 — Browser Operators](34-browser-operators-connected-development.md) defines Stage role as a scoped operator desk with private Stage messages and Comms, **not** congregation/OBS Take. [37 — Permissions](37-permissions-sidebar-and-authority-design.md) governs who may send/approve/receive. [Owner resumed major feature implementation](../OWNER-RESUME-IMPLEMENTATION-2026-10-29.md): no longer wait on PR consolidation or Page 6 design to build independently approved capabilities; zero-new-PR and safety gates remain.

## 1. One essential separation

**Stage Operator desk = interactive control page**, used by authorized stage manager, backstage volunteer, or director to send private on-stage messages, see what approved Stage monitors currently show and coordinate cues.

**Stage / Confidence view = passive audience-facing receiver**, used by pastor/speaker/choir. It has **no** editing tools, director Comms inbox, operator settings or private notes for unrelated recipients. The Stage Operator should see a small **private Preview** and a truthful **what the chosen receiver currently shows** panel, not force the pastor to see the operator's full desk.

**Timekeeper = authoritative timer control/delegation**; Stage Operator may *observe* the actual clock but does not gain automatic permission to alter minutes, start next event, Hold service, run OBS, switch congregation scenes, or modify timing/reminder policies. Direct Stage messages need host-scoped permission. Director/Timekeeper-requested cues may appear as linked private tasks and remain separately authorized.

## 2. Proposed 1440px Stage Operator desk

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [Verified church logo]  Sunday Worship      STAGE OPERATOR      Host LIVE · Stage connected  [Comms / requests]│
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ PRIVATE DISPLAY: [Pastor Confidence ▼] [Choir Confidence] [Backstage (read-only)]  [Receiver health]           │
├───────────────────────────────────────────────────────────┬──────────────────────────────────────────────────┤
│ CURRENT EVENT / AUTHORITATIVE TIME                        │ CURRENT STAGE DISPLAY (ACTUAL, PER RECEIVER)      │
│ Sermon  · 08:20 remaining · elapsed 21:40 / plan 30:00     │ 08:20 · SERMON                                    │
│ Now: Pastor preaching · Next: Offering                    │ Current private message if any + expiry/freshness │
│ Read-only timing; source: host                            │ Receiver confirmed / host sent / offline         │
├───────────────────────────────────────────────────────────┴──────────────────────────────────────────────────┤
│ STAGE CUE COMPOSER                                                                                           │
│ [Routine cue ▾] [10 min remaining] [5 min] [2 min] [Custom short text] [Recent approved]                      │
│ Text: "Please conclude in 2 minutes"    Recipient: Pastor Confidence  Priority: [Routine / Important / Urgent]│
│ PRIVATE PREVIEW: [shows clock + unobtrusive banner OR approved prominent message, without altering receiver]  │
│ [Save draft / Prepare]                          [Send private cue to PASTOR CONFIDENCE] [Hide current cue]    │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ UPCOMING STAGE CUES: Director → Choir "Standby" [Acknowledge]  | Timekeeper → Pastor "2 minutes" [Pending]     │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ CUE HISTORY / DELIVERY TRUTH · sent by · receiver applied · expired · failed · restored [View history]         │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Information hierarchy:** (1) named private display and host health, (2) authoritative event clock / Now & Next, (3) actual receiver image/status, (4) simple send-message composer/Preview, (5) incoming Director/Timekeeper requests and acknowledgment, (6) detailed cue history. No broad top-level "Stage Templates / Timers / Alerts / View Settings / Design" tabs; contextual advanced look-editor opens canonical Design Library with clear return path, requiring appropriate privilege.

## 3. Three example flows to review

### A. Routine cue — choir standby

1. Select `Choir Confidence` from host-authorized private Stage receiver list, not all connected screens.
2. Choose `Stand by for next song` from approved preset (or type short text within role permissions).
3. Private Preview shows how the **chosen choir receiver** renders it (language, Brand Kit style, normal priority, expiry). Actual Program stays unchanged.
4. Press explicitly named `Send private cue to Choir Confidence`. Host enforces recipient and priority before sending. Show `Host accepted → Receiver confirmed`, or truthful failure. Automatic expiry and return to clock are host-owned.
5. If recipient does not support that message, request help or show `Unavailable`, not a fake success.

### B. Sermon overrun — urgent pastor message

1. Existing Timekeeper/host has announced a 2-minute reminder, or authorized Stage Operator chooses short urgent custom message within host limits.
2. Destination is specifically `Pastor Confidence`. Urgency appearance is decided by recipient's **host-approved** policy, not by a browser-selected red theme.
3. Private Preview explicitly shows whether cue appears as subtle banner or prominent temporary message; clock remains visible or returns on expiry.
4. Host sends and records per-receiver status; any earlier routine banner may be superseded by urgent cue using host-managed priority/dedup/expiration policy.
5. No public congregation/OBS/lobby feed or backstage screen receives the pastor-only message. If pastor monitor disconnects, call out `Not confirmed` and offer Comms escalation—do not assume seen.

### C. Director-to-Stage private request

1. Director privately asks `Stage: tell choir to prepare for the next song` with service moment and recipient.
2. Stage Operator sees linked request card: `Acknowledge`, `Open and Prepare`, `Unable`, `Send` (if role has permission). `Acknowledged` does not mean `delivered`.
3. After Send, Director sees `Prepared / Sent by host / Confirmed by receiver / Failed` separately. Crew response `Ready` in Rhema Comms is not permission approval and never auto-publishes a cue.
4. A delayed stale request for a prior event is marked stale/superseded before possible Send; a new event requires current context/reviewer check.

## 4. Proposed context controls and safety

| Context | Primary simple controls | Advanced/policy boundaries |
| --- | --- | --- |
| **Stage Confidence monitor** | Current event, remaining time, current actual message, preview next, send, hide | Display setup/look through authorized Connections + Design; no clock rewrite |
| **Choir/speaker monitor** | Recipient, preset or custom private cue, urgency within policy, preview, send, delivery | Separate recipient filtering; no sharing one recipient's private text |
| **Backstage room schedule** | Read-only Now / Next / upcoming status and room-authorized note preview | Not a second Stage cue bus unless host specifically enables room messages; never public by inheritance |
| **Incoming requests** | Acknowledge, Prepare, Ready/Unable, named recipient Show/Send | Permission/Approval Requests distinct from Comms Ready; host authorizes each delivery |
| **Urgent message** | Clearly preview prominence and expiry, host-authorized send | Host config controls priority, dedup, destination, expiry and return to clock |
| **Failure/recovery** | Stale/offline/failed/expired, retry when valid | Idempotent request IDs; no replaying expired alerts after restart/reconnect; source of truth host |

**Do not put Stage operator controls directly on the passive confidence monitor.** Only controls in the paired Stage operator's secure browser/native desk.

**Privacy by design:** Stage confidence monitor, backstage room TV and control room each have their own **audience-class ACL**, separate output tokens/sessions and filtered fields. Raw pastor notes, staff messages, secrets and production requests are never pushed to general public/signage/OBS streams. Names, duration, urgency and audience preview remain visible before an authorized send.

**Host timing, not Stage timing:** only one authoritative event clock; hide/expiry and automatic reminder threshold dedup continue when Stage browser disconnects. A Stage operator cannot advance event or Hold timer unless separately delegated an explicitly named Timekeeper capability; default role never inherits it.

## 5. Proposed responsive composition

- **1440px:** event clock + actual selected Stage display side-by-side; contextual cue composer and private Preview under the pair; compact pending cue strip below.
- **1024px:** keep clock and selected receiver together with a smaller preview; cue composer becomes one full-width section with one clear Send.
- **768px tablet:** selected receiver and current authoritative timer at top; receiver / Draft Preview switch clearly labelled; queue/cue card below; no microscopic preview cards.
- **390px phone:** selected recipient, large current timer and actual receiver-status summary, prepared message text, explicit `Preview cue` and sticky `Send private cue to [named monitor]`; incoming Comms requests accessible via separate drawer with count, not covering Send. Avoid a generic `Go Live` label.
- **Passive Stage TV:** entirely different **read-only** profile, giant time, optional urgent banner or message; no private Comms/operator navigation or technical output management.

## 6. Simulated and real state distinction

For a design demo, sample `08:20 remaining` or `Pastor Confidence` must be labeled `Demo`; never render it as real receiver data. Real implementation requires true host timestamp, current event, output/receiver status, message revision, posted cue actor and reliable receipt as available. A host send ACK is not proof a pastor actually looked at the screen; label `Receiver confirmed display` only when supported by receiver telemetry.

**Current code baseline (observed 29 October):** `src/studio/production/joined-desks.tsx` includes a small `StageDesk` with text field, `stage_message`, `clear_source` and `restore_source` controls. It states that Stage messages are private and not shown to the congregation. The full recipient-specific Stage compositor, host-governed urgency and Stage/Timekeeper/Director multi-actor request lifecycle are not proven implemented by that simple desk. [35](35-timekeeper-and-timing-view-family.md) is the authoritative functional contract for passive Stage and timing displays.

## 7. Owner design decisions still OPEN

These are **proposals**, not owner approval:
**RESOLVED BY OWNER — 29 October 2026:** Questions **1 and 2** are now approved: Stage Operators **send compliant private cues directly to the Stage monitors the host has assigned them**, with no per-message approval required inside that scope. **Any additional destination (including backstage rooms) or privilege (including elevated urgency not permitted by host policy) requires explicit host authorization** using a reviewed delegation or a specific Approval Request. Being a Stage Operator does NOT implicitly grant every private receiver, Stage design administration, Timekeeper clock control, public output Take or OBS access. See §7A below.

**Still OPEN for Page 6 visual review:**
1. **Monitoring feedback:** Should the Stage operator see a real receiver thumbnail when available, alongside an honest `Estimated preview` fallback? **Recommended:** yes; never fake on-air or actual-human acknowledgment.
2. **Cue placement:** Keep a compact Director/Timekeeper Requests strip below the composer, expandable when needed; avoid a duplicated full Comms workspace.
3. **Default cue composition:** Which 2–4 quick cues should appear first for a novice? Candidate `Stand by`, `Please begin`, `5 minutes remaining`, `Please conclude`; host/role may configure church-specific wording; avoid making every participant see all messages.
4. **Current monitor awareness:** should the Stage Operator see the current live cue **and its remaining expiry**, with a Restore Clock/Hide action? Suggested yes, based on real host state.

### 7A. OWNER APPROVED — Stage direct-send authorization and escalation

**Authority rule:** A joined Stage Operator, once paired, authenticated and given the Stage role, may **directly send host-policy-compliant private cues to that operator's individually assigned Stage Confidence recipient IDs**. This is a **bounded direct-send permission**, not an open broadcast tool.

- For an **assigned recipient**, allow Send without asking the main host to reapprove every routine message. Host checks requester and device session, Stage role, service/event scope where applicable, receiver ID, allowed cue categories, priority ceiling, content/length limitations, expiry policy, current host state and rate limits **at the moment of Send**. The volunteer sees exact destination and host-determined presentation before confirming.
- For an **unassigned receiver** or extra audience (e.g. backstage room, a different pastor/choir monitor, control-room display), provide `Request access` / `Request to send to [named receiver]` linking to **Permissions → Approval Requests**. An authorized host may explicitly grant a scoped and expiring additional destination where approved. Do not expose public/lobby/congregation/OBS destinations as an ordinary Stage message target, even via broad role selection.
- For **higher urgency / protected priority / nonstandard message type** that the Stage operator's current host policy does not allow, prevent direct sending and require explicit delegated privilege or a specific approval request tied to recipient, priority, message/version, reason and duration. When there is no safe authorized path, show `Not permitted`; never optimistically send.
- The main host can revoke, pause or reclaim permissions immediately. **A message already delivered is not automatically erased on role revocation** unless explicitly authorized/host policy requires it; further sends fail closed and host can Hide/Override. Don't turn Stage cue requests into uncontrolled emergency alert pathways.
- Direct Send is **not** Stage scene Take, timer adjustment, global design update or permission administration. **Read-only pastor confidence receiver** never gets buttons to Send, Approve or Manage devices.
- **Audit + truth:** record paired operator, receiver ID, cue content/revision or permitted redacted hash, priority, requested/accepted/display-ack/expired times, any recipient-side failure and whether a request/grant was used. Server ACK ≠ confirmed receiver rendered ≠ pastor/choir saw/read it. Never reveal other recipients' private messages in shared role state.
- **Host controls lifecycle:** display expiry, routine/urgent priority, deduplication and idempotent reconnection behavior remain on the host. An operator browser crashing cannot leave an expired banner stuck or replay an old cue; pending fresh requests remain visible after reconnect. Avoid timer clock drift by using the authoritative host.

**Example operator messaging:**

```text
TO: Pastor Confidence #1  [Assigned by host]
Message: Please conclude in 2 minutes
Priority: Routine              [Within your assigned allowance]
[Private Preview]  →  [Send to Pastor Confidence #1]
Host accepted → Receiver displayed at 11:42 (if acknowledged)

TO: Backstage Room Screen       [Not assigned]
Message: Choir ready
[Request destination access] → Permissions → Approval Requests
No Send until the host approves or explicitly delegates that scope.
```

**Acceptance gates for Codex:** authorized Stage sends direct; unassigned destination denied server-side even if client UI is forged; urgency above grant blocked; prior authorization invalidated after revoke; only named receiver gets cue; 2+ monitors with independent state; host/network loss and reconnect do not replay expired cue; Stage passive display has no controls; delivery audit shows actual receiver ACK vs unconfirmed; no public/OBS/Stage cross-class leaks.

**This approval governs authority and message-send UX only.** Exact Page 6 pixel layout, quick cue defaults, cue preview proportions, receiver thumbnail fallback and Comms strip remain pending visual review.

## 8. Next visual approval

When the owner confirms Page 6 structure, record `OWNER APPROVED — STRUCTURAL HIERARCHY` and update [34](34-browser-operators-connected-development.md), AGENTS and Codex handoff. Until then **Stage Operator Page 6 visual layout is a proposal only**; the direct-send host-assigned-recipient **permissions in §7A are already owner-approved**. Codex may implement already-approved Stage timing and privacy features under the owner resumed-build instruction but must not claim this new layout has owner sign-off.
