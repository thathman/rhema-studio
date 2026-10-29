# 38 — Screens & Graphics Operator: Consolidated Page 5 Visual Review Candidate

**CURRENT PR EXECUTION POLICY (29 October):** The owner rescinded the blanket PR creation freeze. [New development PRs are allowed in a small continuously merged queue](../OWNER-PR-WORKFLOW-2026-10-29.md), subject to existing Live/security/review gates. Website-publishing PRs #352/#367 remain held. Any older PR-freeze phrase in this page is historical.

**Date:** 29 October 2026  
**Review state:** **OWNER APPROVED — OVERALL PAGE HIERARCHY AND WORKFLOW (29 October 2026).** The owner answered **“Yes”** when asked to approve the consolidated Page 5 hierarchy: side-by-side Private Preview/Current Program; pinned output selection; contextual Graphic Controls below; compact Upcoming Graphics strip; compact private Director Requests; explicit group impact review. This is structural/interaction acceptance, **not** pixel-perfect typography, styling or animation approval, and **not** proof that all commands, host APIs or real receivers have been implemented/tested. This consolidates previously approved functionality in [34](34-browser-operators-connected-development.md), [36](36-operator-page-layout-proposals.md) and [37](37-permissions-sidebar-and-authority-design.md).

**Process:** Owner [Resume Implementation Order (29 October)](../OWNER-RESUME-IMPLEMENTATION-2026-10-29.md) **lifts the feature-work pause** and restores active full-building. **new feature PRs allowed under the owner small-queue policy** remains, and #352/#367 website-publishing PRs remain held. Codex should implement this approved structural layout, reuse existing modules and produce runtime/device evidence without creating a new PR.

## 1. Product statement and visual intent

**One operator task:** `Choose destination → Prepare / edit privately → know the real current Program → Show graphic or Take scene explicitly → confirm actual effect`. Make a volunteer confident that changing a lower-third title cannot accidentally change a camera, OBS stream, another sanctuary screen or the pastor's private Stage display.

**Visual language:** native Rhema Studio's church-first branding; restrained professional broadcast control surface with high-contrast dark Preview and Program canvases, soft neutral light/dark app shell, a single primary action, ample touch targets and calm semantic status colors. Avoid a wall of tabs, nested dialogs, scene-graph terminology, full design canvas always open, oversized badges or decorative dashboards. Use exact host/receiver status words; demo fixture labels must never say real "Live" when simulated.

**What the screen is NOT:** a second complete Studio, a separate Design Library application, an OBS mixing console, or an auto-publishing playlist.

## 2. The final page composition for owner review (1440px)

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Verified Church Logo / Church Name  · Sunday Worship     SCREENS & GRAPHICS     Host connected · LIVE        [Comms 1]  │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ DESTINATION · [● Sanctuary Main] [○ Overflow Hall] [○ Other authorized]  [Group Take ▾ requires host grant] [Output health]│
├────────────────────────────┬───────────────────────────────────────┬──────────────────────────────────────────────────────────┤
│ CURRENT DESTINATION        │ PRIVATE PREVIEW                       │ CURRENT PROGRAM (ACTUAL)                                 │
│ Sanctuary Main             │ sermon camera + prepared Pastor name   │ sermon camera, actual Pastor name not yet shown           │
│ Congregation · EN/YO       │ NOT LIVE                               │ Host applied / TV receiver confirmed (or explicit stale)  │
│ Receiver connection        │ safe to edit; render this output look │ Current scene, source follow policy, layer state          │
│ Your role: Scoped screens  │                                       │                                                          │
├────────────────────────────┴───────────────────────────────────────┴──────────────────────────────────────────────────────────┤
│ WORKING VISUAL:  [Graphic ▾]  Lower third  · "Pastor name"    [Change design] [Edit content] [View layers]                │
│ [Name / Title fields]   Entrance [From approved design / Fade]    Display for [From design / Until I hide it]              │
│ [Save temporary draft]  [Restore previous lower third]    [Hide from Sanctuary]  [Show graphic on SANCTUARY MAIN]        │
│  (alternative action: Take selected SCENE to SANCTUARY MAIN; explicit group impact review when applicable)               │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ UPCOMING GRAPHICS                                                  next 2–3 items                       [View all ▾]      │
│ 01  Pastor Lower Third · Sermon · Ready · Sanctuary   02 Offering · Prepared  03 Announcement · Draft                     │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ DIRECTOR REQUEST (1): "Prepare guest speaker lower third" · Sermon · Sanctuary   [Open & Prepare] [Acknowledge] [Unable]  │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Last operation: [prepared only / command accepted / receiver confirmed / denied]    [History] [Advanced view when needed] │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Priority:** A selected destination (or explicit multi-target group) is always visible next to Show/Take. The operator must distinguish:
- **Private Preview:** an editable draft rendered to look like the target screen. It can be edited without touching Live.
- **Current Program:** authoritative host/receiver-known appearance for the destination, not an echo of Preview. Label `Applied by host` separately from `Receiver confirmed`; on stale connection show last-known timestamp.
- **Working Graphic controls:** only relevant fields for Lower Third, Ticker, Countdown, visual source or Scene. Contextual `Change design` opens shared canonical Design picker; `Edit content` uses Library objects when appropriate.
- **Upcoming Graphics:** visible, compact queue of next 2–3 actual service-linked moments, expandable without navigation/focus loss, not another independent schedule.
- **Director Requests:** compact private cue card, no monopoly of screen space. Expanded queue and Comms remain accessible in drawers.
- **Access and approvals:** permission denial leads to scoped request in main Permissions → Approval Requests; this is not a synonym for Comms Ready.

## 3. Exact simple volunteer paths

### A. Show Pastor name on Sanctuary only
1. Select `Sanctuary Main` (single-output is default). Current Program shows the sermon camera.
2. Choose `Add Graphic → Lower Third → Pastor` or select a prepared service-linked item. Select design from shared Library/Design; edit text in a **service-only temporary draft**.
3. Private Preview reflects the sanctuary's aspect ratio, language, look and camera subscription. Program stays unchanged.
4. `Show graphic on Sanctuary Main` is a distinct, authenticated operation (not `Take Scene`). Apply the selected design transition and duration policy, then report host and per-receiver truth. Camera and Bible stay.
5. `Hide lower third from Sanctuary` removes only the applied overlay instance. `Restore previous` targets only the last valid same-output overlay history with impact confirmation when significant.

### B. Group Take of a composed scene
1. Enter `Group Take` from explicitly visible affordance; host grant required. If not authorized show `Request group access`, never a fake Take.
2. Select named authorized congregation outputs (e.g. Sanctuary + Overflow). Do not silently include OBS, Stage, pastor screen, signage or lobby.
3. Render **per-output** Private Preview and Current Program/impact; list language/Look/followers and stale/receiver health for each.
4. Confirm `Take scene to 2 outputs` only after preflight. Show per-output `Applied`, `Awaiting receiver`, `Failed` and targeted retry/restore; never blanket success on partial failure. After operation or reconnection return to single-target default.

### C. Director request linked to a service moment
1. Private typed `Prepare guest speaker lower third` arrives with requester, event, destination, urgency and approved design reference.
2. Operator chooses `Open & Prepare` without losing other draft or changing Program. `Acknowledge`, `Preparing`, `Ready` remain private statuses.
3. Director sees `Ready` (not Live), then sends `Request Show`.
4. Screens Operator explicitly confirms authorized `Show on Sanctuary`. Only a Director with a **separate host-granted direct action scope** can Show on their own without operator confirmation.
5. Approvals for grants, permanent designs or other protected actions use the centralized Permissions inbox, not a generic notice ACK.

### D. Graphics lifecycle defaults (OWNER APPROVED)
- Existing graphic transition: `Use approved design`. New original designs: **gentle Fade**, Cut/Slide contextual choices. Overlay transitions don't switch full Scenes/OBS.
- Duration: **Use approved design duration** when provided; otherwise **Until I hide it**. Explicit timed presets including 5s/10s/20s/30s and custom duration may be offered. The main host owns expiries; no stale timer may hide a newer graphic instance. Automatic Hide never removes another layer.
- Restore: `Restore previous graphic` affects the selected named output/layer only. Significant impact uses private preview/confirmation. `Restore scene` and `Discard draft` are different actions.
- Temporary service-scoped edits are permitted to Screens by default inside assigned scope; persistent reusable Design/scene saves require host-granted permission or a **specific approved request**. Saved temporary drafts survive same-service browser disconnect, native restart and host crash without accidentally becoming Live.

## 4. Contextual controls by type (no disconnected subsections)

| Graphic context | Visible simple controls | Advanced drawer only |
| --- | --- | --- |
| Lower Third | Person/title, choose approved look, transition, duration, Preview, Show/Hide, previous graphic | Position, typography, keyed motion, persistent version |
| News Ticker | Select item(s), style, loop/pause/stop, Preview, authorized Start/Stop | Data bindings, crawl speed, output-specific clipping |
| Countdown | Named host time source, approved visual, preview, Show/Hide | Timer-source rules, stage versus congregation privacy/receiver policy |
| Camera + Scripture Scene | Choose authorized camera/source composition, language/look, Preview, destination, Take Scene | Full layer composition/native design editor/restore-fallback |
| Saved Design / Slide | Content binding, design variant, Preview, target, Show/Take as appropriate | Native editable document and version management |

Don't make every user understand `Library` versus `Design` versus `Scene` versus `Output`; context picker joins those canonical domains, while preserving their distinct underlying data and revision authority. A graphics overlay action cannot mutate a globally shared ticker or other outputs without disclosing and enforcing the actual scope.

## 5. Screen states and responsive design

**Common statuses:** `Live`, `Rehearsal`, `Host offline`, `Permission revoked`, `Draft saved`, `Needs approval`, `Host applied`, `Receiver confirmed`, `Output disconnected`, `Stale preview`, `Group partial failure`. Program and Preview remain visually/verbally distinct in all states.

- **1440–1920px:** output rail or selector + Preview and Program side by side; contextual tools below/aside; always-discoverable upcoming strip and one compact Director cue. Avoid oversized repeated monitor cards and excessive badges.
- **~1024–1366px:** destination remains pinned; Preview/Program keep legible aspect ratio; inspector collapses to one relevant panel; queue shows 2–3 depending space.
- **~768px:** selected destination on top; Preview and Program are named switchable panes with instant clear toggle to compare; controls below; up to two queue items. Preserve one obvious Show/Take.
- **~390px:** a single target, status + Program identity, explicit Preview, contextual graphic controls, sticky `Show to [named output]` button, two-item queue, request badge opens drawer. Group take review is a dedicated full-width confirmation view, never a tiny grid. No accidental tap on Hide adjacent to Take.
- **Read-only TV:** no editor, sensitive cues, operator controls or admin Permissions route.

**Accessibility:** 44px+ touch targets, keyboard and screen-reader focus, visible output name and impact, color-independent status, reduced-motion, no toast-only error delivery, exact changes labelled. Live/Program is always legible when preview/drawer opens.

## 6. Design acceptance script (owner and implementation)

1. Solo host with no volunteers: user can prepare and safely run a sermon scene with one congregation output and independently verify OBS and Stage unchanged.
2. Joined Screens volunteer: preps Pastor lower third in service-only draft; changes title, Fade and timer; **Program remains intact until named-output Show**; verify only Sanctuary changes and auto-hide removes only overlay.
3. Save/close/reopen same service: private draft intact; canonical reusable library unchanged. `Save reusable` without permission routes to a typed approval request.
4. Group Take with explicit grant: two differently configured language/aspect outputs show correct target-specific previews; unauthorized/stale group requests denied; partial receiver failure reported per output.
5. `Upcoming Graphics`: 2–3 item strip with View all; linked to event/moment; no auto Take and no focus steal during service advance.
6. Director asks `Prepare`: operator privately prepares and marks Ready, Director requests Show, Screens confirms. `Ready` never changes Program.
7. `Restore previous graphic` never restores a whole scene or changes unrelated outputs; significant-impact preview appears when required.
8. Offline LAN host/receiver, browser reconnect, revoked session, host restart and real device are tested without false `Live` claims.

**Current implementation gap inspection (29 October morning, observed current main):**
- Native [PermissionsWorkspace](../../src/studio/permissions/permissions-workspace.tsx) exists with paired-device output-scoped Screens controls and durable **scene edit** approvals, but is **not yet the full typed approval inbox**.
- [UpcomingGraphics component](../../src/studio/production/desk-consoles.tsx) exists with compact three-item view/full expansion and no auto Take; source status needs verification per real service.
- [Remote roles](../../src/lib/remote-roles.ts) explicitly describe *single* assigned output Scene Takes and **Group Take unavailable**. Group operation must not be falsely shown as operational.
- [Joined Screens editor](../../src/studio/production/joined-desks.tsx) still calls general `save_scene`; host-authoritative service-only temp draft versus permanently persisted reusable Design versions remains to be verified/implemented.
- Review/CI/source alone does not prove real phone/TV/OBS physical parity.

**Codex instruction:** **Owner has approved the page composition**. Resume feature implementation now under [29 October order](../OWNER-RESUME-IMPLEMENTATION-2026-10-29.md), reuse/refactor these existing modules, do not build parallel editors/queues/permission stores, and ensure every enabled action has real role-scoped host API and true per-output physical status. Preserve [36 §5G–I](36-operator-page-layout-proposals.md). **Do not claim pixel-level approval or production/device completion** before separate visual and runtime verification.

## 7. Visual-review outcomes to record

Owner may mark this page candidate:
- **APPROVED AS PRESENTED:** freeze composition and responsive treatment; implement and validate before claiming done.
- **APPROVED WITH SPECIFIC CHANGES:** list exact differences and commit revised candidate.
- **REVISE:** preserve functional approvals; revise screen hierarchy without undoing already ratified behavior.

**As of 29 October 2026: OWNER APPROVED THE STRUCTURAL HIERARCHY AND KEY INTERACTION FLOW. Detailed pixel styling, exact breakpoints/touch composition and physical/runtime acceptance remain open.**
