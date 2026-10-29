# 45 — Page 11 Main Presenter / Configure: One Live Command Desk, Privileged Settings Separate

**Workshop:** 29 October 2026. **Status: OWNER APPROVED — PAGE 11 MAIN PRESENTER / CONFIGURE STRUCTURAL HIERARCHY.** The owner answered **“yes”** to one Live service command desk with configuration, device connections, permissions and administration kept in their own authorized workspaces. Pixel styling, precise control placement, execution permissions beyond earlier grants, live host integration, native recording engine and device evidence remain separately unverified. Page 10 Viewer structure is owner-approved in [44 §9](44-viewer-operator-page-10-layout-proposal.md#9-owner-decision-29-october-2026). Page 11 completes the established page-by-page role sequence in [34](34-browser-operators-connected-development.md). Owner-directed full feature build is active, zero new PRs remain, website publishing gated. Product plans are not proof of implemented behavior.

## 1. What this page really is

**Main Presenter = trusted, bounded service-running role, controlling the service and authorized Live outputs.** **Configure = separately privileged host administration**: device connections, role/output grants, policies, settings, persistent production configuration and maintenance. The main Rhema host retains authoritative rescue/reclaim, approval and service-control capabilities as appropriate to host privileges. An authenticated joined Presenter may use *only* its actual host-enforced commands; it is **not** Configure, even when it appears to have broad service control.

**Avoid two competing full workspaces** labeled Simple/Advanced or Presenter/Production. One task-first **Live command desk** adapts permitted specialist controls contextually; persistent access/admin actions live in **Connections, Permissions, Settings**, with return-to-task context and exact role checks. Presenter/Director may have broad event/Bible/song/scene control but **must not inherit OS/network settings, unassigned output group Take, persistent Design edits, OBS online Take, or Rhema Native Record start/stop solely from the Presenter label**. Configure/host administration remains separately gated and audited.

**One human mental model:** `Check service and outputs → Prepare next moment and target in private Preview → Inspect true Current Program and affected outputs → Authorize/Take the explicitly selected target(s) → Confirm what actually happened → Record/history continues independently`.

## 2. Proposed desktop layout — one primary Live workspace

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [Church]  Sunday Worship   LIVE / REHEARSAL    Host: Connected  [Permissions Requests 3] [Comms 2] [Help]        │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ RUNNING ORDER NOW → NEXT                │ TARGET OUTPUT(s): [Sanctuary Main ▼]  [Group Take ▾ host-scoped]        │
│ Now: Sermon · 08:20 left                │ Output health: host applied / receiver confirmed / last-known time    │
│ Next: Offering · ready in 2 min        ├──────────────────────────┬──────────────────────────────────────────┤
│ [Back] [Hold*] [Advance event*]         │ PRIVATE PREVIEW          │ CURRENT PROGRAM — ACTUAL                 │
│                                        │ Camera + Bible / draft   │ Current scene / actual layers             │
│ UPCOMING 3 EVENTS                      │ NOT LIVE                │ Per-output receiver feedback              │
│ Offering · graphics prepared           │                        │                                           │
│ Announcements · pending                │                        │                                           │
│ Closing Prayer · ready                 ├──────────────────────────┴──────────────────────────────────────────┤
│                                        │ SELECTED CONTEXTUAL CONTROL                                 │
│ CREW READINESS (per role/assignment)   │ [Scripture] [Worship] [Graphic] [Scene] [Camera] [Time]     │
│ Stage: ready · Camera 2: ready          │ Select relevant current/next moment tool, not 7 open desks │
│ OBS: online stream separate            │ [Private Preview]  [TAKE SCENE TO SANCTUARY MAIN]          │
├────────────────────────────────────────┴────────────────────────────────────────────────────────────────────┤
│ APPROVAL REQUESTS: 3 pending  [Review safely]  · Director/Stage/Cam/OBS action requests [Expand]                  │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ RHEMA NATIVE RECORDER (main Live dock, separately authorized):  Sanctuary Main  00:32:14  Audio / disk / file   │
│ Host recovery / output health / Live History  [View details] [Reclaim delegated control if host]                 │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Information order:**
1. **Service identity, production mode and host/receiver safety** always visible: Live vs Rehearsal vs Offline vs stale, service revision/freshness and who has control.
2. **Now/Next + authoritative clock and Running Order** remain readable as the operator navigates; event-advance/hold only within explicit capability, never an accidental auto-Take.
3. **Named output(s), per-output Private Preview vs Actual Program** central. Single destination is default. Group only with separately granted scope, explicit preflight and per-output confirmation. OBS online Program/Stage private outputs are not congregation defaults.
4. **Contextual content/scene tools** for the selected Event/Moment and selected destination; not a dashboard packed with every specialist's whole controls at once. Canonical Library/Design picker, Bible/Worship temporary actions, Graphics and approved scene composition share their existing resources, no duplicate state.
5. **One prominent named Live action** next to impact: `Take [Scene] to Sanctuary Main` or `Show [Graphic] on Sanctuary Main`, never a generic `Go Live` ambiguous across 3 output classes.
6. **Compact Crew/Requests and approvals**, obvious but not dominating primary visual program. Permissions → Approval Requests is an actual route for typed decisions, distinct from event-linked Rhema Comms acknowledgments.
7. **Native Rhema recording status dock:** main Live owns the selected congregation-output recording. It is not a scene Take, not OBS streaming, and controlled by separate host-granted recorder authority; see [42](42-rhema-native-service-recording.md).

### 2A. The Configure experience should NOT make a separate clone of Live

**Configure/host configuration is accessible from the persistent church sidebar**, not permanently embedded in the Presenter canvas:
- **Connections**: Cameras, TV receivers, OBS Companion/remote OBS, audio device connection health, operator pairing; pairing and secret management only for authorized roles.
- **Permissions**: role/person/device access, allowed outputs and group Take grants, temporary/permanent Design saves, Approval Requests queue, delegation, revocation and audit; do not bury inside Settings.
- **Settings**: church preferences, recording audio/profile defaults, display policies, backup/restore, host/network security and development options; privileged only, not editable from normal Presenter.
- **Design/Library**: durable templates, Brand Kit, reusable content and visual engine under explicit persistent-save privileges.
- **Live Production health**: real-time diagnostics, source routers and recoverable error detail within a contextual drawer, not the main Presenter canvas.

Being the main host does not mean every Configure panel belongs in Live. An authorized host can **Reclaim delegated control** from the current Presenter/volunteer without unpairing, and the joined role sees truthfully `Control paused by main desk`. Reclaim must fail closed for stale/conflicting commands.

## 3. Example user journeys

### A. Sunday service: change from Sermon to Offering
1. Presenter sees `Now: Sermon → Next: Offering` and current planned time. Chooses **Sanctuary Main**; the actual Program remains sermon camera, while **Private Preview** shows the queued Offering visual and sound/presentation implications.
2. Presenter checks readiness cues: Camera Ready, Screens graphic Prepared, Stage/Timekeeper cues, any pending requests. A `Ready` or `Approve` acknowledgment does **not** auto-show anything.
3. Presenter explicitly `Take Offering Scene to Sanctuary Main`; host checks session/role/output, current service/event, scene approved revision, asset validity, rehearsal, and receiver impact. Host/receiver result shown honestly. **OBS Program and Stage Confidence are independent**, as is whichever congregation output was not chosen.
4. Moving event/time cursor happens **separately** from scene Take. Changing the selected Event may update contextual **Preview** but not program automatically.
5. Recording continues capturing the selected congregation output's **final composited picture** with approved church mixer audio; if the recorder is pinned to Sanctuary Main, it follows the newly taken scene without requiring OBS. Recorder status independent of screen Take.

### B. Unexpected Scripture reading, no panic
1. From Sermon Moment, contextual Bible tool opens same canonical Library/reference model. Presenter selects Isaiah 60:1 and previews target-specific EN/YO render privately.
2. On authorized `Activate Scripture Source`, the host truthfully reports the Live Bible source changed; per-output follows may make it visible in already-on-air Bible layers. This is **not** identical to `Take Bible Scene`; use distinct labels and impact preview where needed.
3. To switch composition to a full-screen Bible, deliberately `Take Bible Scene to Sanctuary Main`. Offer `Restore previous graphic/scene` only in authorized correct scope and with history revision checks.
4. The Viewer page simply follows Now/Next; Stage private message/OBS/other output don't silently inherit the Scripture.

### C. Host handles delegated operator access mid-service
1. Operator asks for a protected group Take or reusable Design save. Main Presenter sees notification and opens **Permissions → Approval Requests**, with exact typed request and pinned diff/per-output impact; a Comms `Ready` is not approval.
2. A Presenter without `ApprovePermissions` capability sees `Waiting for host` and cannot self-approve, even if they have broad `TakeScene` privileges. Authorized Configure/host approves/declines in the separate route.
3. A host can pause/reclaim a paired desk and continue local production without changing the service or unpairing; stale queued command cannot unexpectedly Take later.

### D. Fault during production — safe and actionable
1. A selected camera freezes; host shows actual camera signal age, whether camera is in current Program and which alternate scene/recovery actions are **approved**.
2. Avoid an overloading live PC: optional thumbnails/graphs auto-reduce before the actual screen compositor degrades, with measured CPU/GPU/RAM and disk reporting. A failing recorder does not stop congregation screen output; recording error is honest.
3. Lost phone/TV receiver is distinguished from host's applied Program; do not report `All screens live` on a host ACK without receiver confirmation. On reconnect the page resyncs scene revisions and applies no old pending Take.
4. No WAN is necessary for local Sunday production; OBS online stream status may go offline while congregation outputs and Rhema native recording continue.

## 4. Real permission boundaries (must enforce on Rust host)

| Capability | Presenter (delegated) | Configure / main host |
| --- | --- | --- |
| See host service / rundown / trusted Preview + Program | Within host-granted service/output scope | Authorized host-wide monitoring |
| Start/Advance/Hold event/timer | If actual specific role/capability allows | Host policy; separately check |
| Activate Bible/song, scoped Scene Take | Per granted host command/output/mode | Authorized host actions |
| Group Take across congregation outputs | **Not by default**; explicit per-output group grant and impact | Per host policy + impact confirmation |
| Approve typed permission/plan requests | **Not by role name alone** | Authorized approvers only; no self-approval |
| Permanent Library/Design Save | **Not by role name alone** | Explicit persistent edit privilege |
| Start/Stop Rhema-native congregation-output recording | **Separate recorder permission, not Presenter by implication** | Host can delegate; real recorder engine required |
| OBS online Preview/Take/stream control | **Separate OBS delegation** | Not automatically a congregation Take |
| Configure host pairing/network/access/security/settings | **No** | Explicit host/Configure only |

**Existing code nuance (observed 29 Oct):** `src-tauri/crates/api/src/keys.rs` currently grants broad core `Role::Present` commands but restricts some configure-only commands (e.g. OnAir/theme), and `Role::Present.edits_scenes()` is false. `src/studio/production/operators-panel.tsx` currently maps `present` and `configure` to similarly broad joined desk sets including Director/clock/Bible/Songs/Outputs/Scenes/Stage, but the host checks commands. Therefore **visual similarities must not imply equal authority**. Feature claims about granular recorder permits/typed approvals/group grants need actual tests, not UI button hiding. `PermissionsWorkspace` currently has real scene approval/pairing controls, not yet a complete cross-domain typed inbox.

## 5. Responsive proposals

- **Wide desktop:** three-part operating surface: Running Order/Readiness left, Preview and Current Program center, contextual inspector/right or directly beneath; one main named Take. Requests and recording status stay compact.
- **1024–1366:** service/Now Next anchored left or top, preview/program two readable panes, inspector collapses below, no lost Live target action.
- **~768 tablet:** program and preview switchable via obvious labels with easy return, Now/Next top and Output name pinned; one named Take; protected approvals open full screen/drawer without accidentally executing.
- **~390 phone:** **read/prepare first**. Named Output, current Program status, preview and per-output health, then explicit large Take action only if host grants mobile Live control. Group Take and privileged Configure are separate review flows, not tiny irreversible buttons; otherwise display `Host only` with reason. Never let an operator's thumb accidentally hit `Stop Recording` next to `Take`.
- **TV/receiver** remains read-only display, never this interactive main desk.

**Accessibility:** output name in every action; keyboard and touch controls; visible focus and secure confirm for destructive actions; status text+shape not only colored green/red; reduced motion and reader announcements distinguish Preview, host Applied, receiver Confirmed, stale and partial failure.

## 6. Implementation instructions and acceptance

Reuse actual `Live` workspace/Running Order/scene preview/program, `DirectorBoard`, `ScenesDesk`, `OutputMap`, contextual Bible/Worship/Screen controls, `PermissionsWorkspace`, `Connections`, `JoinedTalk`, notices and the planned first-party recording dock. **Do not build a second command registry, shadow Live State, new duplicate Presenter home route or alternative recording panel.** Continue existing owner finish-first resumption without new PR creation.

Acceptance:
1. Joined Presenter with only Sanctuary output scope sees a named valid Preview/Program and can Take to Sanctuary only; independent Overflow, OBS and Stage remain unchanged. Configure-only functions denied on forged requests.
2. Role host pause/reclaim takes effect immediately; a stale command queued during pause remains denied on reconnect.
3. Group Take requires separately authorized multi-target grant, per-output impact and partial result truth; no implicit fan-out.
4. Changing service event/Bible source and taking scene are visibly separate state transitions; voice/notice Ready never auto-Takes.
5. Rehearsal has a labelled sandbox; no accidental physical/live production action or recording unless an expressly permitted test recording.
6. Distinct `Approvals` request review with actual host permission, actor audit and rev-pinned diff; not every Presenter can approve.
7. Native Rhema recorder pins one selected congregation output, follows its actual scene/graphics changes, and works OBS/WAN off. Recorder authority not automatically inherited.
8. Performance under simultaneous camera+NDI/TV+Rhema Record+OBS remains within measured device constraints, with Live stability prioritized.
9. Mobile, tablet, desktop, offline LAN, receiver loss, malformed permission grants and stale revisions have truthful actionable UI and host-denied unsafe commands.

## 7. Page 11 approved hierarchy and remaining open details

1. **OWNER APPROVED — Main visual composition:** Live workspace with **Now/Next + Running Order/crew readiness**, **side-by-side Private Preview and actual Current Program for a named output**, contextual controls and one named Take, compact Approval Requests/Comms, and a separate first-party native Recording dock. **Recommended.**
2. **OWNER APPROVED — Configure separation:** use separate existing sidebar `Connections`, `Permissions`, `Settings`, `Design` and `Library` rather than making a permanent all-powerful Configure mode in the middle of Live. **Recommended.**
3. **OWNER APPROVED — Operator focus:** Single named congregation output default; explicitly host-approved group output review; obvious OBS/Stage independence. **Recommended**, consistent with earlier Screen approvals.
4. **Director/crew readiness:** compact always-discoverable status and one request strip, expandable into current Rhema Comms/Permissions, not a giant dashboard.
5. **Recovery:** main host `Reclaim Control` in connected operator context and accurate output/record health; don't add one-tap global Panic without separately approved behavior.

**Owner approved Page 11's structural hierarchy.** The layout, host scope and service-first context are ratified; fine styling, reviewer badge placement, recovery details, exact command grants and runtime QA remain open. Approval does not grant Presenter unlimited configuration, group Take, OBS or independent recorder control.


## 8. Owner sign-off — Page 11 (29 October 2026)

The owner expressly replied **“yes”** to the Page 11 hierarchy: **one main Live command desk for service operation**, with running order/clock, crew readiness, named output selection, private Preview vs actual per-output Program, contextual specialist controls and one explicit output-scoped Take; compact Comms and Approval Requests; independent first-party Rhema native recording dock/status. **Configure/host administrative capabilities belong in separate existing Connections, Permissions, Settings, Design and Library workspaces under their own authorization**, not a second all-powerful Presenter clone.

**Approval is structural, not blanket privilege:** Presenter does not automatically gain Configure, host permission approvals, recording Start/Stop, OBS streaming, library master saves or unscoped group Takes. Follow backend Rust host authorization, explicit role/output grant, revision integrity, rehearsal isolation, stale command prevention and truthful receiver acknowledgment. Preserve host reclaim and Live stability. Exact visual styling and functionality are accepted only with runtime/hardware evidence.
