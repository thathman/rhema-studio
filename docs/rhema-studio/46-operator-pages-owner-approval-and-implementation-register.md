# 46 — Operator Pages 1–11: Owner Decision and Implementation Acceptance Register

**CURRENT EXECUTION POLICY (29 October):** [Owner PR Workflow](../OWNER-PR-WORKFLOW-2026-10-29.md) authorizes new reviewable development PRs with a 3-active target/5 normal working limit and prompt merges. The older ZERO NEW PR instruction in this register is superseded; keep website PRs #352/#367 held. Design signoff is not implementation.



**Updated:** 29 October 2026. **Status:** DESIGN DECISION REGISTER, **not** a shipped-feature report. The owner expressly approved the **overall structural/interaction hierarchies** for Pages **5–11** in sequence and previously made multiple binding functional decisions for Pages **1–4**. **Do not rewrite “function approved / visual details proposed” as “pixel-perfect accepted.”** Real host/web/device implementation remains separately verified. Source contracts: [34 — Browser Operators](34-browser-operators-connected-development.md), [36 — Original Pages 1–5 workshop](36-operator-page-layout-proposals.md), [37 — Permissions](37-permissions-sidebar-and-authority-design.md), [29 — Editor Language Library](29-editor-language-library-contract.md).

## 1. The complete page map and precise decision state

| Page | Workspace | Owner decision state as of 29 October | Canonical design source |
| --- | --- | --- | --- |
| **1** | Welcome → Connect → Your Workspace | Proposed page layout; approved architectural direction for authenticated paired browser roles and real host linkage. **Pixel-level page not explicitly signed off in this sequence.** | [36 — Page 1](36-operator-page-layout-proposals.md#page-1--welcome--connect--your-workspace), [34](34-browser-operators-connected-development.md) |
| **2** | Bible Operator | Approved functional distinction of private Prepare/Preview versus host-permitted source activation and eventual named-output effect. **No explicit whole-page pixel sign-off recorded here.** | [36 — Page 2](36-operator-page-layout-proposals.md#page-2--bible-operator), [34](34-browser-operators-connected-development.md) |
| **3** | Worship Operator | Approved service-scoped temporary sequence/reorder/insert/repeat/skip without rewriting canonical approved plan. **No explicit whole-page pixel sign-off recorded here.** | [36 — Page 3](36-operator-page-layout-proposals.md#page-3--worship-operator), [34](34-browser-operators-connected-development.md) |
| **4** | Timekeeper | Owner-approved one authoritative host clock, manual and automatic reminders, private Stage/Backstage/Control Room timing display model. **Exact visual pixels not signed off.** | [35](35-timekeeper-and-timing-view-family.md), [36 — Page 4](36-operator-page-layout-proposals.md#page-4--timekeeper-operator--timing-displays) |
| **5** | Screens & Graphics | **OWNER APPROVED structural hierarchy:** named output, **Private Preview versus Current Program**, contextual Graphic Controls, compact 2–3 Upcoming queue, private Director requests; explicit group Take / graphics lifecycle owner-approved. | [38](38-screens-graphics-final-visual-review-candidate.md), [36 §5](36-operator-page-layout-proposals.md) |
| **6** | Stage Operator | **OWNER APPROVED structural hierarchy and assigned-recipient direct-send permissions:** private target, host clock beside actual receiver, composer, compact Director/Timekeeper requests; host-scope policy/extra-recipient approvals. | [39 §7A–7B](39-stage-operator-page-6-layout-proposal.md) |
| **7** | Camera Operator | **OWNER APPROVED structural hierarchy:** live camera grid, selected camera, separate health/Ready/OBS-congregation tally, contextual recovery, compact framing requests. | [40 §7A](40-camera-operator-page-7-layout-proposal.md) |
| **8** | OBS Director | **OWNER APPROVED REVISED streaming-only hierarchy:** OBS Preview and online Program, explicit OBS Take, scene list, stream health, Comms, congregation read-only, **Rhema native recorder read-only status**. | [41 §9–10](41-obs-director-page-8-layout-proposal.md), [42](42-rhema-native-service-recording.md) |
| **9** | Editor Operator | **OWNER APPROVED structural hierarchy:** My Assignments/Running Order → Event/Moment contextual editor → Private Preview/Review/Comments; **Save Draft** separate from **Submit for Review**. | [43 §9](43-editor-operator-page-9-layout-proposal.md) |
| **10** | Viewer | **OWNER APPROVED structural hierarchy:** Now/Next, authoritative clock, compact Running Order, role-filtered crew notices and permitted Comms; no production mutations. | [44 §9](44-viewer-operator-page-10-layout-proposal.md) |
| **11** | Main Presenter / Configure | **OWNER APPROVED structural hierarchy:** one Live command desk; named output Preview/Program + explicit Take, running order/crew, compact requests, native recording awareness. **Configure** remains in separate authorized Connections/Permissions/Settings/Design/Library routes, not a second Live clone. | [45 §8](45-main-presenter-configure-page-11-layout-proposal.md) |

**Across all pages:** Approval here means **information architecture and key behavior** rather than final typography/colors, responsive pixel details, working audio/video preview streams, access-grant changes or physical acceptance. Treat each page’s detailed still-open choices as proposals. If an older proposal says `awaiting approval` in a prior paragraph but a later explicit `owner approved` sign-off exists, **the later approval governs the exact ratified structural scope**; stale boilerplate is not a blocker to implementation.

## 2. Owner-approved adjacent work not to forget

1. **Local-first core:** Church service can run without WAN; browser LAN operators are secure, paired and host-authoritative; remote collaborative planning from home syncs approved versions before service.
2. **Native Design + Library:** use canonical Library data, embedded Avnac-based native Design engine/versioning, contextual Add/Use/Edit, design-to-service moment binding; source-bound EN/YO or bilingual output variants must not fragment content.
3. **Comms:** private event-linked Director/operator notices, Ack/Ready/Unable, actual role-based PTT/talk sessions, channel policy; Comms Ready not an ACL approval or physical program confirmation.
4. **Permissions:** first-class main-sidebar Permissions with **Approval Requests** as actionable typed inbox, actor/revision/impact details and approved scopes; host enforcement, not disabled-looking buttons.
5. **Rhema Native Recording:** **Rhema** locally records one **explicitly selected named congregation output's final composited Live visuals** and separately approved house audio, pinned for the session; OBS and WAN not needed. OBS Director still handles online streaming and OBS online Program only. Native recorder requires real video/audio engine, safe disk/crash handling, service markers and History; **NOT proven implemented yet**.
6. **Connected equipment and apps:** Rhema Cam, camera router/receivers, Google TV, OBS Companion, private Stage displays and independently routed congregation screens are real devices/services, not mockup-only controls.

## 3. Codex implementation contract and acceptance sequence

**Do not restart the design workshop or wait for further UI approvals before coding the independently approved features.** Owner explicitly ended the PR-merge work pause in [29 October Resume Order](../OWNER-RESUME-IMPLEMENTATION-2026-10-29.md); keep **bounded active development PRs** and leave website-publication PRs #352/#367 held. Use owner-required scoped subagents, one integrator and an existing approved integration workflow. Review current `main` before coding; re-use live components rather than building shadow versions of the product.

**Implement and prove by end-to-end service journeys rather than by isolated page count:**
- **Church host connect and roles:** local main host + actual LAN paired browser on laptop/phone with secure identity, scope and revocation; no fake disconnected sample data represented as Live.
- **Service preparation → accepted revision:** plan Event/Moment, Bible/Hymn, named output/look/Language, draft/Preview, comments, typed approval and explicit approved version adopted. Host operates even when WAN absent.
- **Live control and outputs:** Presenter/role prepares private Preview, makes named scoped Take, gets real host-accepted versus receiver-confirmed feedback. Group Takes require independent host grant, preflight, partial failure and recovery. No accidental cross-output fanout.
- **All specialist roles:** Bible, Worship, Timekeeper, Screens, Stage, Camera, OBS, Editor, Viewer and Presenter/Configure perform their authorized sequence; deliberate no unauthorized source/Plan/Live/OBS/Stage/recording control. Comms/requests and time remain scoped and meaningful.
- **Native recording:** selected congregation output video + approved mixed house audio, **with OBS closed and WAN off**; render scene changes, Scripture/lyrics, graphics and transitions; create a playable synchronized file and service markers, then recover disk/encoder failure without sacrificing Live.
- **Physical acceptance:** actual screen receiver, connected camera, OBS Companion and native host, along with 1440/768/390 browser states, each have truthfully recorded results; simulated/UI-only proofs cannot count as physical QA.

For each slice report **main SHA**, source files changed, tests actually run, proven working steps, exact missing backend/device evidence, delegated subagent handoffs, and next active milestone. A green CI or an approved layout does **not** establish the entire service journey is ready.

## 4. Next implementation priority

**Finish integrated core service workflows and physical acceptance, not another separate operator-screen redesign.** Suggested first complete rehearsal: service draft → review → host approves → Running Order → bilingual Preview on Sanctuary/Overflow → named-output Take → Graphics/Stage/Comms → independent OBS online Preview/Program → **native congregation recording** → History and safe recovery. Build a compact status matrix for these paths; only label `Verified` after live or realistic integration evidence.

**Page 11 conclusion:** one Main Presenter Live desk is the approved command center; privileged Configure actions remain their respective sidebar routes. There are no newly authorized cross-domain permissions, deployments or public website releases from the approval.
