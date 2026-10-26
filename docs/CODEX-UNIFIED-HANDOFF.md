# Codex handover — Rhema Studio unified experience (26 October 2026)

> **START HERE for the 26 October product consolidation.** This is the approved product direction and implementation coordination entrypoint, **not** evidence that the code has already changed. Read the detailed contracts linked below before implementing. Do not interpret a screenshot, unmerged PR or green CI as an accepted production feature.

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
