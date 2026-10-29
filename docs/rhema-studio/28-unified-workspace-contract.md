# 28 — Unified workspaces, navigation and interactive route contract

**Design intent, 2026-10-26. Not an as-built claim.** Owner decisions from review of Home, Prepare, legacy Present/Production, Library, Design, Team, Archive, Settings screenshots. See [handover](../CODEX-UNIFIED-HANDOFF.md), #442, #444, #447.

**OWNER FOLLOW-UP — RECORD THE CONGREGATION OUTPUT (29 OCTOBER):** In the first native recording mode, choose **one actual named congregation display/output** (Sanctuary Main if that is the church-configured primary; otherwise choose explicitly) and capture that output's host-authoritative **final composited Live visuals** with one approved clean church/mixer audio feed. Include all its Live scene/source changes, Scripture/lyrics, overlays/transitions, not other output states, private Preview, Stage, Comms or OBS Program. A recording session's source ID remains pinned; changing the UI's selected management output never reroutes an ongoing recording. The recorder is a safe independent consumer of the congregation compositor, not a hidden Take or physically capturing the TV. [Canonical owner mode](42-rhema-native-service-recording.md#owner-approved--initial-recording-video-source-is-the-congregation-output-29-october-2026).

**OWNER UPDATE — NATIVE SERVICE RECORDING (29 OCTOBER):** Rhema Studio is the **primary native local recording application**, independent of OBS. Main **Live → Record** gets a first-class Start/Stop/status/markers/audio/file-health dock; service recordings appear in **History**. OBS Director remains focused on independent online streaming Program/Preview, with at most a read-only `Rhema REC` indicator and Advanced OBS-only legacy recording. Recording a service must work with OBS off and WAN off. All access, output selection, local storage, crash safety and resource/load protection follow [42 — Rhema native service recording](42-rhema-native-service-recording.md). This owner decision supersedes any earlier suggestion that OBS recording is the required service recorder. Technical format/output/ISO options await implementation review.

## Owner amendment — Permissions is a first-class sidebar route (28 October 2026)

**APPROVED NAVIGATION DECISION:** Add a visible **Permissions** route to the main Rhema Studio sidebar under **Your Church**, adjacent to Connections. It is an explicit utility workspace for role/grant management and access review, alongside (not inside) the six core creative/service destinations Home, Prepare, Live, Library, Design and History. **Connections** owns discovering/pairing/health, **Permissions** owns who can do what, **Prepare** owns assignments, and **Settings** retains technical network configuration rather than a second competing ACL editor. Host-controlled, server-enforced delegation of Bible source modes, Timekeeper reminders, Screens individual/group Takes and context-scoped asset edits must use one authorization truth. See **[37 — Permissions sidebar and authority design](37-permissions-sidebar-and-authority-design.md)** for proposed wireframes, role/capability granularity, privacy, migration and acceptance. This is the ratified route direction, not evidence the route exists in running React code.

**Owner addition (28 October):** The new main-sidebar **Permissions** route must include **Approval Requests** as a prominent actionable area. Authorized host/reviewers can examine requests from delegated Bible, Worship, Screens/Graphics, Editors and other scoped operators; show current revision, exact output/service impact, decision and eventual executed/receiver-confirmed outcome, without confusing `Approved` with `Live`. Existing Prepare approvals and Live/Comms cues are contextual links to the **same host-governed request records**, not a competing inbox. See [37 — Permissions approval inbox and role policy](37-permissions-sidebar-and-authority-design.md#3a-approval-requests--owner-approved-first-class-area-28-october-2026). This is a requirement, not shipped status.

## Canonical structure: one task, one owner

| Main destination | Focus | First-time user entry | Advanced/contextual tools |
| --- | --- | --- | --- |
| Home | What is happening at church today? | Church name workspace, next service, Resume draft, readiness with exact fix links | diagnostics and service history |
| Prepare | What will happen, in what order, with which content and cues? | Running Order and obvious **+ Add Event** | sections/loop, event/moment editor, Team assignment, timekeeper, service review and sync |
| Live | What is Preview, what is really Program and where is it visible? | One console: Running Order, Preview, Live Program, explicit Take | dockable Bible/lyrics/detection, clocks/cues/audio, Scene/Camera/OBS, Stage, ticker/lower-third, operator controls/Comms, Show Health |
| Library | What reusable content does the church own? | Search all; Songs & Hymns, Bible, Media, Slides/Announcements, Collections | import/export content, source/usage/version detail |
| Design | How do saved content and sources look? | searchable full-size Templates, My Designs, Brand Kit | Avnac native canvas, lower third/ticker/stage/timer/camera-scene **as design types**, Used On as detail |
| History | What actually happened? | Completed services and plan-vs-actual event chronology | who changed/activated what, source/scene/output acknowledgments, licensed song-use and after-action reports |

**Global utilities** reached through Desk/Profile menu or contextual shortcut: Connections, Settings, Profile, Help, Onboarding. Optional operator layout presets (Main Desk, Bible, Worship, Timekeeper, Congregation, OBS) are *views of the same authoritative Live state*, not separate app modes or required roles.

### Legacy route behavior (compatibility table)

| Old surface | Target | Preservation / migration rule |
| --- | --- | --- |
| Present Standard | Live / canonical console | Always maintain keyboard bindings and source/scene Preview/Take verbs |
| Present Advanced | Live / optional transcript/detections/diagnostics drawers | Never drop old capabilities or a separate hidden queue; one stable command path |
| Production Operators | Connections / People & Devices + Live delegated roles | Retain revocation, role scopes, host reclaim |
| Production Cameras | Live Cameras + Connections pairing setup | Same router, linked source identifiers and camera monitoring |
| Production OBS | Live OBS and Companion dashboard | Respect independent online program; no editing congregation scene by OBS cut |
| Production Scenes / Screens / Outputs | Live Scene/Output setup + Design shared picker | Existing NDI/browser/stage/signage outputs, per-kind look and language overrides survive |
| Design Themes/Library | Design Templates / My Designs | Do not confuse Design Templates with Content Library |
| Design Lower thirds/Ticker/Stage/Countdown | Design editable recipe, or inline editor at moment/scene/output point of use | No immediate mutation of on-air global styling when browsing/editing |
| Design Brand Kit | Design / Brand Kit | Single tokens church logo, typography, palette; overrides traceable |
| Design Used on… | Design / item details | True reference graph, revision/affected outputs |
| Team | Prepare / people/approval/comments; Live Comms; Connections roles; Profile | All saved comments/permissions/history remain discoverable |
| Archive | History for records; Settings Data & Sync for backups, service import/export in Prepare | Keep storage format; old routes alias with notification, not 404 |
| Settings Heard Verses | Live → Bible & Detection for operating mode; Settings Audio/Speech for provider/mic/keys | Automatic update of Live Bible may change screens that follow it; say so |
| Settings Remote Control / devices | Connections | Keep protocol/ACL/keychain canonical; legacy deep-links still route to the right device |
| Library Songs/Hymns/Media/Files | Library categories + import/export | Reuse canonical CRUD; remove side effects of preview/add |
| Prepare flat vs phased view | Simple list ↔ Grouped by phase | View change never starts phases/deletes headers; explicit Remove Phases for structural mutation |
| Old Home local workspace card | ChurchName WORKSPACE + useful readiness | Remove redundant permanent local-only callout while retaining truthful offline status in relevant diagnosis |

**Explicit migration work:** `src/studio/shell-store.ts` still encodes `Workspace` present/production/team/archive and `PresentView = standard/production`. Build compatibility routing/migration for saved shell preferences and deep links. The code is not a blank slate. New primary nav must preserve old saved links as redirects without silently overwriting preferences or deleting state.

## Prepare should be event-first, without forcing a file-first workflow

In the ordered service, show the current service name/date/time, save/approval status, and a large, nearby **Add Event** next to the running order. Hide New/Duplicate/Import/Delete service under selector/actions. The first click Add Event in an empty installation creates a **local draft** if necessary. A user can add content before supplying a formal service title; warn before leaving unsaved or unapproved drafts, never imply items are already published.

**Canonical shape (see #409):** Service → Phase (optional grouping/loop) → Event (Opening Prayer, Praise & Worship, Bible Reading, Sermon, Announcements, Offering, Quiz, custom) → ordered Moments (content, scene/camera/overlay/timer/cue) with roles/durations/notes/approvals.

**Event composer:** select type, inline create/edit, attach source library items and design revisions from one contextual picker, choose output intent, preview. A Sermon is one 40-min event with many independently cueable visual moments; its clock is not reset by a verse change. Scene layout does not automatically Take to Live. Prayer can show speaker name + camera + 15-min timer; announcements can show camera + ticker; post-service quiz is internet participant session, not a media slide pasted into service.

**Add flow:** click nearby `+` → compact palette/search → choose type/asset → close picker → create in *selected* parent/position → select by stable ID → open details → preserve focus/undo. Opening from a phase selects that phase; opening from an Event selects that Event's child moment. If invoked from standalone Library, ask/remember target service/event rather than silently placing item at root. Existing Bible/Songs/Hymns/Slides/Media/Reuse all remain available.

**Phases:** Simple List vs Grouped by Phase changes **view only**. Show clear control to switch both directions (including keyboard). Provide explicit Create Phase, Reorder Phase, Remove Phase actions with consequences. Header and loop metadata persist regardless of view; collapsing a phase must never hide items from underlying service or start/stop clocks.

**Drag/drop:** transactional command `move(id, destinationParentId, beforeId|end)` (illustrative) supporting within/between phase/event, collapsed destination reveal, keyboard reorder and undo, valid insertion indicator, no cross-entity drops that lose scene/timing. Never derive membership solely from visible indices; test stale IDs and save/reopen.

## Live = one professional but approachable console

- Persistent authoritative `Running Order | Preview | Program` (on compact screens preserve clear preview/live distinction with intentional controls); next event/timer displayed.
- **Actions:** Activate a Source (Bible/Song/Hymn/Ticker/etc.) vs Take an independently composed Scene to *a scoped Program/output*; Hide/Clear/Hold/Restore precise semantics per #246. No false "nothing here takes live" wording.
- **Optional tools** in drawers/docks: Find Anything, Bible & hearing, Lyrics/Hymns, Timekeeper, Cues, Audio, lower thirds, ticker, Camera, OBS, Stage, Signage, Rhema Comms (once scoped), Connections/health.
- A specialist uses saved panel layout and permissions on the same state; main host can do all operations and reclaim. Avoid two primary layouts labeled Standard and Advanced. One stable keyboard map and collision rules with text fields.
- Never silently substitute demo Genesis content for a service item; preview and live state distinguish sample, draft, approved and actually on-air.
- **Timer ownership:** service schedule, event clock, auxiliary timer, visual countdown and quiz lobby are different timer *types* with named authoritative owners; they may be rendered on stage/program but are not five independent conflicting clocks. Event elapsed time does not implicitly Take public graphics.
- Bible detection modes: Wait for Preview, explicitly armed Live Bible auto-activation and additional scoped rules; name real side effects when active scenes subscribe, never claim feeds-only = not visible. Provider/microphone remains Settings.
- Live output editor is contextual: add destination (TV/OBS/Stage/etc), choose what scenes/sources it follows, appearance/language and role; technical transport in Advanced. Receiver code pairing flows via Connections.

## Library and Design boundaries

**Library is persistent and primary.** It organizes reusable songs and choir ministrations, numbered CAC hymnbooks, Bible translations/saved passages, images/videos/audio, slide/announcement documents, and curated collections. Editing canonical source content is separate from editing a per-service occurrence; version compatibility and approval pins must prevent a newly edited song from unexpectedly rewriting Sunday's approved service. Previewing Library **never Takes Live**. Shared content picker used from Prepare/Live/Design must preserve return route, event ID, placement, version and desired action.

**Design holds visual templates, saved visual documents, Brand Kit and reusable scene/overlay recipes.** Replace eight top-level tabs with purpose/category filters. Start with a large preview/gallery (120 Worship Expressions looks included once installed), launch focused Avnac editor with Fit-to-Window canvas and context inspector, **Save Draft**; a contextual Use action binds it to chosen event/scene/output. No vague "Use" vs "Use and edit" different hidden side effects. Used On is details metadata, not standalone destination.

## Team, History, Settings and onboarding

- **Team in place:** person/role identity in Profile; permissions, join/revoke in Connections; assignments, discussion and approval in Prepare; on-air communication and timekeeping in Live. Shared plans from home sync *approved data before Sunday* without cloud dependence once show starts.
- **History:** automatically journal attempts/acknowledgments, actor, source/scene, output and actual times, with distinction between intentional "not checked" and zero/none. Show completed service events vs actual timing, worship usage, after-action notes. Use configured church timezone; retain archived data. No global backup actions on a history dashboard.
- **Settings:** Church/Profile, Audio/Speech, Connections, AI/MCP, Data & Sync, Preferences, Diagnostics/About/Open Source Licenses. One canonical setting owner. Contextual action takes user directly to relevant setting, then back. Preview/rehearsal/live scope labeled where settings affect output.
- **Home/onboarding:** first install collects church name/brand kit/operator/keys/remote capability as relevant and provides honest readiness; Home title always `{Church Name} WORKSPACE`. No always-on "local workspace" notice. A volunteer can skip advanced configuration and complete solo service.

## Cross-route behavioral acceptance

1. Create service (or local draft) without lengthy setup; Add Event and insert in correct phase; keyboard reorder; Simple/Grouped parity 20x.
2. Add CAC hymn with aligned bilingual lyrics from Library, edit a service occurrence, preview each output independently, preserve numbering and alignment.
3. Edit reusable lower third / running ticker while on-air: draft preview does NOT mutate current programs; explicit Take/Apply only.
4. Connect Google TV, OBS companion and camera from one Connections hub; context-return to original workflow; one host can control independently.
5. Closing/restarting app preserves service, theme references, content and routes; old workspace IDs redirect. Public outputs do not see private stage notes.
6. Complete History correctly reports attempted, accepted, rendered and acknowledged actions including failures; backups live in Data & Sync.
7. Accessibility: proper focus return from modal/drawer, hit targets, keyboard and 10-foot remote, 1024×700 / 1366×768 / 1920×1080; both light/dark and no purple default gradients.

See #444 (Prepare), #447 (canonical navigation), #442 (design and live integration), #411 (real journeys).
