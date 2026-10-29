# Codex handover — Rhema Studio unified experience (26 October 2026)

> **START HERE for the 26 October product consolidation.** This is the approved product direction and implementation coordination entrypoint, **not** evidence that the code has already changed. Read the detailed contracts linked below before implementing. Do not interpret a screenshot, unmerged PR or green CI as an accepted production feature.

## Complete scope index (added after coverage audit)

The handover is intentionally an architecture document; **do not assume that features only summarized or linked here are optional**. Read the [complete feature coverage and preservation checklist](rhema-studio/32-feature-coverage-inventory.md) as the second required document after this handover. It includes owner-approved **Rhema Comms full-duplex simultaneous push-to-talk with speaking indicators and paired phones**, private Notices and event-linked Action Requests (#251); complete MCP service draft authoring (#252), Internet sermon quiz with timed lobby and leaderboard (#425), rehearsal isolation (#246), output-scoped group/individual Takes, licensing, signage, collaborative sync and the three connected apps. Each entry distinguishes requirements from verified implementation. The owner approved these features in earlier sessions; absence of detailed repetition in docs 28–31 is not permission to remove them.

## Latest owner addition (28 October): LAN browser operators + connected development

**Read [34 — LAN Browser Operators, Connected Development Mode and Role Workspace Redesign](rhema-studio/34-browser-operators-connected-development.md) before touching Host/Join, HTTP/HTTPS, operator views or the browser shim.** The church LAN must eventually serve a complete **permission-scoped operator app** to laptops, tablets and phones **without installing Rhema desktop**; retain one local-first host and the server-authoritative Role/Live/Take boundaries. Add explicitly opt-in, authenticated and test-host-only Connected Development Mode alongside clearly marked simulated browser UI. Redesign **each operator workspace page by page** with the owner's individual visual review; do not treat an existing compact joined-desk console as approved. These are product requirements, **not shipped status**.

**Execution precedence remains [owner Finish-First / ZERO NEW PR](OWNER-FINISH-FIRST-2026-10-28.md).** Finish backlog reconciliation first; then use already approved integration paths for the complete browser operator journeys. No new PRs, unauthenticated LAN exposure, production deployment or silent Live output changes are authorized by this addition.

## Timekeeper / timing suite owner decisions (28 October)

The [canonical consolidated Timekeeper decision register and detailed view family](rhema-studio/35-timekeeper-and-timing-view-family.md) is mandatory when working on timing, Stage Confidence, room schedules, main Live timing or studio TV/receiver outputs. Approved requirements: one authoritative host timing engine; novice-first Timekeeper browser/native role desk; host-governed automatic plus manual reminders; configurable subtle banner and prominent temporary message per urgency/receiver; delegated Timekeeper authority with host reclaim/revision safety; private audience-specific read-only Stage, Backstage and Control Room displays; compact Live dock; countdown/intermission views; explicit output assignment, Preview/Take, privacy, failures, deduplication, stale/fixed-start handling. **Functional direction approved; individual final page visual acceptance and real hardware tests still required.** This work remains subject to the current backlog-clearance/no-new-PR order.

## Proposed operator page layouts (Pages 1–5; NOT visually signed off)

The owner asked that proposed operator page designs be **saved to the repo in addition to approved functional requirements**. Read **[36 — Operator Page Layout Proposals](rhema-studio/36-operator-page-layout-proposals.md)** for current Page 1 Connect, Page 2 Bible, Page 3 Worship, Page 4 Timekeeper and Page 5 Screens & Graphics UI hierarchy, text wireframes, interaction examples, role-responsive behaviors and outstanding sign-off questions. Page 5 includes the individual vs explicit group Take UI, per-output impact/recovery, Preview vs Program, contextual graphics picker and scoped lower-third/ticker controls. **Wireframes are proposals**; authority constraints from 34 and timing constraints from 35 are ratified. Do not claim design approval, implementation completion or authorization for new PRs.

## Latest owner route decision — main Studio Permissions (28 October)

**Owner explicitly requested a visible `Permissions` destination in the MAIN studio sidebar**, near Connections. The current paired-role dropdown buried in Settings is not sufficient. Follow [37 — Permissions Sidebar and Authority Design](rhema-studio/37-permissions-sidebar-and-authority-design.md) and preserve existing role/server ACL safety. The route is an independent host-focused utility surface and does not replace Connections discovery/pairing, Prepare assignments, or the six main task workspaces. First implement real effective role/device visibility and safe host-controlled pause/revoke; add granular capabilities and group/individual Take/Screens design persistence only with actual host-side enforcement and reviewed migration. No connected browser can self-elevate. Approved **navigation/product direction**; exact page pixel layout and permanent design-edit defaults remain open. Still obey finish-first / ZERO NEW PR unless owner overrides separately.

**Approval Requests (owner addition, 28 October):** Include a prominent **Approval Requests** tab/inbox with a pending-count badge **inside the new main-sidebar Permissions route**, not a separate hidden settings page. It must accept typed host-scoped requests from delegated operators, pin impact/revision/target, provide secure Approve/Decline/Request Changes, preserve durable pending/decision/audit state and distinguish `Approved` from actual source activation/scene Take and receiver confirmation. Reconcile existing service `approved_revision` and Comms Notices as separate primitives, not fake unified approval. [Detailed contract / proposed wireframe](rhema-studio/37-permissions-sidebar-and-authority-design.md#3a-approval-requests--owner-approved-first-class-area-28-october-2026). Implement only under existing finish-first/no-new-PR process; docs do not mean shipped.

## Screens & Graphics editing policy — owner approved 29 October

**[Canonical Page 5 decisions §5G](rhema-studio/36-operator-page-layout-proposals.md#5g-screens-editing-and-persistence--owner-approved-29-october-2026) are now ratified.** Screens volunteers may make **temporary, service-only graphics/scene edits by default** (within host-assigned role and output scope), and those drafts must survive app/host restart, browser reconnect and reopening the same service. **Permanent reusable Design/Scene saves must require a specifically host-delegated permission or an approved request in Permissions → Approval Requests**, with revisions, diff, subject and audit; approval never silently changes Live. Don't treat `Screens` existing generic `save_scene` permission as proof that new persistence ACL is implemented: provide genuine host-side distinction, migration and recovery tests before shipping. The **compact 2–3 Upcoming Graphics strip with View all is now approved**; its exact placement, detailed appearance, and quick-editor pixels remain proposals. Continue finish-first and ZERO NEW PRs.

**Graphics Queue layout approval (29 October):** Page 5 Screens & Graphics must show a **compact, always-visible Upcoming Graphics strip with the next 2–3 items** and an explicit **View all / Expand** action to the full queue; collapse restores the focused workspace. Queue is derived from service events/moments, not an independent running order; status and destinations are truthful; no auto-Show/Take, no Preview focus steal or per-output permission bypass. On small viewports use 2 readable items. See [Page 5 §5H](rhema-studio/36-operator-page-layout-proposals.md#5h-additional-page-5-layout-ideas--proposed-not-yet-individually-owner-approved). The compact-strip interaction is approved; exact final pixel styling still awaits review. Finish-first / ZERO NEW PR stays in effect.

## 1. Product statement

**Rhema Studio is one church production system**, not a collection of separate tools. It lets a volunteer **Prepare a service → Run it Live → Review its History**, while Library and Design supply reusable content and visuals. One main computer can do **everything alone**, completely offline for the live sanctuary/OBS/stage pipeline, while authorized volunteers and receivers join when available.

**Six primary destinations** (replace the present eight-plus legacy mental models):

1. **Home** — `{Church Name} WORKSPACE`, onboarding/readiness, today's work, draft resume.
2. **Prepare** — service/run of show, phases, events, child moments, timing, contributions, approval and safe preview.
3. **Live** — one canonical operator console for both legacy Present **and** Production; Running Order/Preview/Program/Take, scene/audio/camera/timekeeper/detections/tools in contextual panels, output health and delegated authority. No Standard/Advanced dashboards.
4. **Library** — reusable church *content*: Bible editions/saved passages, Songs, Hymnbooks/CAC numbering, Reusable Slides/Announcements, Media (images/video/audio), Collections; independent of any service. Import/export content here.
5. **Design** — one reusable *visual* template/design/Brand Kit catalog and Avnac/Saraswati-powered editor, contextual selection everywhere; no disconnected eight-tab design tools.
6. **History** — completed services, plan-vs-actual, source/scene/output execution, operator audit, song usage and reports. Not backup management.

Global utilities (not competing primary workspaces): **Connections**, **Profile**, **Settings**, **Help**, first-install Setup. Team as a separate workspace dissolves into Profile, Prepare comments/assignments/approvals, Live Comms, and Connections permissions; functions are retained, not deleted.

### Non-negotiable architecture

- **One authoritative Plan, Live State and Execution History**, never conflate them.
- **Named independent Live Bible, Hymns, Songs, Ticker, Slides, Timers and camera sources.** Activating a verse once updates subscribed feed variants; no destination-selection checkbox for each verse. Congregation and OBS compose **independent** scenes from shared clean source cameras (#243 owner ratification).
- **Safe lifecycle:** Choose → Configure → Save Draft → Preview → Approve/Pin → explicitly Activate Source / Take Scene / scoped Apply; editing reusable source or designer properties **never** changes an active output without deliberate on-air authorization (#383 #398 #442).
- **One main host** works with no cloud/account/volunteers. Local camera router, NDI, WebRTC/Google TV and OBS remain entirely LAN-capable without WAN. **Rhema Engage** is the consciously separate *internet-required* participant quiz service (#425/PR #426), not a dependency of core presentation.
- **Language is content + output policy, not a separate operating mode.** Single or bilingual EN/Yorùbá flow through the same event/library/editor; per-output independently renders available primary/secondary/both (#446).
- **Design and content are distinct yet connected:** Library stores content; Design stores templates/My Designs/Brand Kit; service Event/Moment binds content, design revision, cue and output intent. One canvas/editor; no cloned design stores (#443 #448).
- **Source vs composition:** Avnac supplies editable design scene graph and native editor; Rhema owns live media source routing and Take authority. Cameras are not static screenshot layers; media stays locally cached. Canva is no longer the editor dependency.

## 2. Read order, authority and detailed deliverables

1. [RFC #243](https://github.com/thathman/rhema-studio/issues/243) **latest owner ratification**, especially removal of per-destination Bible Take.
2. [Architecture contract #246](https://github.com/thathman/rhema-studio/issues/246), service events [#409](https://github.com/thathman/rhema-studio/issues/409), safe preview/source/scene [#410](https://github.com/thathman/rhema-studio/issues/410), QA [#411](https://github.com/thathman/rhema-studio/issues/411).
3. [UX integration #442](https://github.com/thathman/rhema-studio/issues/442) and product audit [#381](https://github.com/thathman/rhema-studio/issues/381), behavioral audit [#382](https://github.com/thathman/rhema-studio/issues/382).
4. [Unified workspaces + route migration](rhema-studio/28-unified-workspace-contract.md), [Native Design/Content/Language](rhema-studio/29-editor-language-library-contract.md), [Connected Devices & real QA](rhema-studio/30-connected-devices-qa-contract.md), [Delivery & migration dependency matrix](rhema-studio/31-codex-delivery-matrix.md).
5. Scoped execution issues: **#444 Prepare**, **#445 Receiver/Cam/Companion**, **#446 bilingual**, **#447 Library/Team/Settings/History**, **#448 Avnac slides/dynamic designs**, with upstream engine epic [#443](https://github.com/thathman/rhema-studio/issues/443).
6. Related approved work: onboarding #298, neutral visual system #215, UX polish #299, Connections #401, offline 120-look pack #400, optional camera/output receivers #197/#198/#208/#209/#213, timers #196, service grouping #193; MCP service draft #252 and separate optional Comms #251.

**Precedence:** latest explicit owner decisions > ratified architectural contracts (#243/#246) > these new consolidated docs and issue acceptance > older exploratory screen plans > stale October 20 PRD navigation examples. In case of conflicts, record an ADR/issue comment explaining the change; never silently erase history.

## 3. Verified repository baseline and active work snapshot

Checked **2026-10-26**: `main` HEAD = `6eaa7ddc01543b19cb5db568aa1f47a7ceeae457`. This document is a snapshot: recheck HEAD, open PRs and CI **at work start and before every merge**.

Relevant open PRs on that check:
- #414 scene/queue safety, #420 approved revision pinning, #415 hymn picker, #416–#419 related content/Stage fixes, #421 slide preview, #428 Take truth, #430 **draft** Event foundation.
- #435 bundles 120-look gallery, #436 output editor, #437 Connections, #439 reusable slides, #438 **hardware/test** automation, #422 branding, #431 production safety.
- #426 draft Rhema Engage cloud, requires deployment/network/device QA.
- #352 and #367 are **website-publishing PRs**: do not merge incidentally. #278 is an older documentation reconciliation, #4 is separate speech provider work.
- **No new consolidated navigation or cross-app redesign is merged merely because these PRs exist.** Do not duplicate the work; inspect commit diffs and integrate through focused branches after understanding dependencies.

Older `docs/PRD.md` is **v0.1 dated Oct 20** and still recommends Home/Prepare/Present/More, while `docs/TASKS.md` rev 0.45 and `docs/DEVELOPMENT-STATUS.md` are dated Oct 22. These are historical references and need a careful reconciliation PR (tracked #413), not unsupported status rewrites. Do not mark plans `MERGED`, `ACCEPTED` or `SHIPPED` without repository and hardware evidence.

## 4. Codex operating protocol

1. Inspect `main`, every relevant PR branch and existing routes, states, migration/tests/CI. Produce a concise factual baseline: Implemented in main / In PR / Not implemented / Blocked / Device-unverified, with proof paths.
2. Map every old user route, settings tab, content action and direct link to the new canonical destinations. Preserve aliases/deep links and existing saved data. Compare single-host and volunteer paths.
3. Prioritize **P0 source/scene/revision safety and Add-order corruption** (#383/#384/#398) before visually refactoring. Review the PRs listed above; repair failures with focused regression tests.
4. Implement **one flow at a time** with shared adapters and small PRs. Avoid the temptation to create new standalone panels, duplicated stores or multiple editors. Never remove a feature because an old route was retired.
5. Keep a scenario checklist in each PR: actions, state before/after, error states, offline impact, operator permissions, accessibility, migration test, and **actual on-screen output result**.
6. User-directed routine code work may proceed under existing repository merge policy; **do not** auto-publish a website, deploy public internet services, ship production releases, modify real church data, or run destructive migrations without explicit approval.
7. Update PRD/TASKS/status **only with verified evidence**, preserving their history; update onboarding, docs, manuals (#413), setup directions and screenshots as routes change.
8. Claim hardware/performance validation only after a real run with named machine/TV/phones, observed FPS/latency, failures and reproducible logs.

## 5. Definition of done

A novice can, on **one laptop**, create a 15-minute Opening Prayer event (camera + person lower third), bilingual Worship, a sermon with multiple live Bible moments and independent OBS/sanctuary designs, an Announcement ticker, and a post-service Recall Quiz; move events across phases and back to a flat view; attach shared Library and Design entries; run safely using one Live console; recover from camera/TV/OBS failure; and inspect accurate History. A joined Timekeeper/Bible/Camera/Stage/OBS operator must be **optional**, authorized and able to hand control back. Every role must consume the same underlying Plan/Live/History and one content/design repository.

Test English-only, Yorùbá-only and dual-language paths, 120-look gallery usability, 1024×700/1366×768/1920×1080, safe-output Take, accessibility, offline cold-start and real connected hardware where available. If a piece cannot be verified, log the blocker explicitly; never call it done by assumption.
