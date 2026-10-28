# 31 — Codex execution plan, branch conflict matrix and traceable acceptance

**Coordination plan dated October 26, 2026, at base main `6eaa7ddc`.** It does not change shipped behavior. Re-fetch latest HEAD/PR statuses before implementation. Entry: [CODEX handover](../CODEX-UNIFIED-HANDOFF.md).

## 1. Do NOT make one giant rewrite PR

The planned end-state spans shell routes, saved data, presentation commands, Android streaming UI, native design and MCP. Ship narrow vertical slices that keep one-laptop services working after each merge, with explicit migration, rollback and regression gates. Do not build a parallel new app or a second service/Library/Design store.

### Work-package ordering (concurrent only where contracts allow)

| Stage | Scope | Issue source | Existing work to inspect | Evidence before marking complete |
| --- | --- | --- | --- | --- |
| **0 Baseline** | Read main, all 2026-10-25/26 PRs, actual UI, type/schema/CI; baseline real device status; document route inventory | #381 #382 #413 | #278 docs PR | HEAD/PR map, screenshots, CI and actual-tested inventory |
| **1 P0 safety** | Scene Save/Live isolation; pin approved designs; reliable queue inserts and Take commit after render; authorization/ack | #383 #384 #398 #392 #410 #442 | #414 #420 #428 #431 | failing regressions then passing CI, preview/stage/OBS/congregation live no unexpected changes |
| **2 Shared service event model** | Phase→Event→Moment timekeeper, schemas, old item compatibility, approved revisions | #409 #193 #196 | **#430 draft** | save/reopen, event with multiple moments, clock unaffected by Bible/scene change |
| **3 Prepare interaction** | Nearby +Add Event, compact palette, correct nested placement, sortable phase/group/event, grouped/simple view, undo, local draft | #444 #442 | #415 #414 #430 #439 | all drag targets + keyboard, 20x view flip, original order/timing roundtrip |
| **4 Library/content** | Real content browser, persistent reusable slide/media/song/hymn, cross-context picker, collections, source version isolation | #447 #402 #395 #385–#390 | #415–#419 #439 | browse/edit without Live Take; Add returns to original event and preserves hymn identity |
| **5 One Live console** | Merge Present+Production views/commands, optional panels, one timing authority, host/delegated roles, accurate status | #442 #243 #246 #410 #197 | #431 #436 #437 #438 | solo service + optional operator, independent OBS/congregation/stage, keyboard map parity |
| **6 Design native engine** | Bundle gallery, engine integration, shared edit/revision/picker, static and dynamic nodes, themes/overlays/Stage/ticker | #443 #448 #400 #442 | #435 #439 #420 | editable multi-page render, Draft != Live, per-source subscription, isolated safe changes |
| **7 Bilingual** | One language policy for content/arrangement/output/layout, independent per-program variants | #446 #243 | existing src/lib/output-language.ts, src/lib/translation-policy.ts | EN/YO/Both across Library, Prepare, TV, OBS, Stage; full repro and missing language |
| **8 Canonical nav + support** | Home/Prepare/Live/Library/Design/History; contextual Team; Profile/Connections/Settings; deep links; readiness | #447 #442 #298 #401 #413 | #437 #299 and current shell-store | every old route has target, same data, no hidden capability or settings duplication |
| **9 Connected device UX** | Standalone Companion, Receiver, Cam redesign and source integration | #445 #198 #209 #208 | shared Connections #437, brand #422, existing Android/Tauri modules | real LAN pairing/streams/OBS/TV with outage/fps proof |
| **10 MCP/AI + Engage boundaries** | Draft-only MCP slide/service authoring; review quiz host/cloud separately; no AI/quiz required for live reliability | #252 #443 #425 | **#426 draft Engage** | AI creates editable draft, human Take; quiz internet with mobile data and independently functioning offline host |
| **11 Acceptance + Docs** | Full journey, migration/restore/rollback, thermal/soak/latency, manuals, attribution and truthful status reconciliation | #411 #413 #31 #32 #62 | #438 QA and docs PRs #278/#352 | hardware evidence + owner acceptance; not just CI |

**Sequencing clarification:** Stage 7 language *contract and tests* should inform stage 6 editor design upfront. Do not wait until the engine is written to decide how language-bound dynamic text is stored.

## 2. Existing PR conflict and ownership check

At baseline Oct 26:
- **#414** queue insertion and scene on-air bugs, **#420** approved scene pinning, **#428** Take only after success, **#431** production live warnings. Do not reimplement these blindly under a consolidated Live PR.
- **#430 draft** begins event domain migration; plan Prepare and drag/drop against that evolving shape rather than a second domain.
- **#415** hymn detail / Add, **#416** repeats, **#417** hymn identity, **#418–419** stage, **#421** stale slide preview, **#427** search retry and **#429** comment history. These affect shared Library/service editor behavior.
- **#435** packs 120 looks, **#436** output editor, **#437** Connections, **#439** reusable slides. Consolidation must **integrate** their work, not create second look gallery, Connections hub or slide store.
- **#438** full journey QA, **#422** brand pack, **#426 draft** Engage (requires cloud/device testing), **#433** and **#424** historical timing test clock overlap—compare and deduplicate safely.
- **#352/#367** website changes publish the site when merged; do not use these as merge dependencies for UI refactor. **#4** speech provider unrelated. **#278** older docs reconciliation should be reconciled before rewriting status files.

For every PR: record affected files, current base, tests, review conflicts, feature flags/migrations, expected UX scenario and merge order. Use one owning issue per independent behavior; cross-reference others instead of duplicate PRs.

## 3. Task taxonomy and data ownership

**Canonical IDs / stable refs**:
- Church, Operator, RolePermission, Device/Connection, Service, Phase, Event, Moment, ContentAsset, LanguageVariant, DesignDocument+Revision, Template, Scene+Revision, Output, LiveSource, LiveCommand, Timer, ExecutionHistory.
- Contextual editor/picker returns a **stable identifier + revision + invoking context + target event/output**; navigating across routes does not reset selection or silently mutate active Live.
- Local data migration must map existing queue item IDs, song arrangements, hymn IDs, Bible pinned translation and old theme/output settings without losing unknown compatible serialized data.

**Authoritative owners**:
- **Library** owns song/hymn/media/content asset data.
- **Design** owns editable document/layer/template versions and Brand Kit.
- **Prepare** owns approved service/phase/event/moment links and schedule.
- **Live** owns runtime source bus, preview, scenes/program output intents and explicit Take.
- **Connections** owns persistent pairing/roles and device health.
- **History** records what happened as applied/failed/acknowledged, not a fabricated summary.
- **Settings** owns persistent nonlive preferences/credentials/backup.
- **Cloud Engage** owns internet quiz rooms and participant scores; never a dependency for local Sunday display.

Avoid two-way shadow copy stores and "editing a live object" by reference. Stable version IDs and typed overrides are required.

## 4. Minimum end-to-end user journeys (automate where practical)

**J1 — Novice Prepare:** fresh install → enter church brand/skip advanced settings → Home with readiness → click Prepare → automatically save local draft → +Add Opening Prayer 15 min with speaker and camera+name lower third → worship song/hymn bilingual → Bible reading → Sermon 40 min with several moments and separate camera/Scripture scenes → announcement camera+ticker → add Recall quiz with timed lobby → review/approve. Enter correct parents and content, no long tabs/multiple editors.

**J2 — Library / Design reuse:** from event, open same Library picker and find CAC hymn by number/title, preview in isolation, choose pinned arrangement EN/YO; open Design gallery 120-look filters and choose/duplicate a camera+Bible and lower-third recipe; native editor changes background and dynamic fields, Save Draft; verify no live output changes. Return to exactly same event. Reopen service after restart and verify references.

**J3 — Phases and drag/drop:** create Pre-service loop/Main Service/Post-service, move songs and a sermon moment across boundaries via pointer and keyboard, undo, repeat grouped/simple toggle 20 times; compare IDs/order/time/output/loop behavior after save/reopen.

**J4 — Solo show, independent programs:** start on one main desk with no joined volunteers; approve service, arm detections only as authorized; Bible activates Romans 8:28 once. Congregation Google TV renders live camera+EN/YO, OBS 720p30 online program independently Pulpit camera+EN Bible lower-third; Stage shows timer and private notes. Independent source/scene activation and operator Take; console shows truthful program vs preview and route scopes.

**J5 — Connected volunteers:** another operator joins as Bible, an optional Timekeeper/Stage person joins, and OBS Companion runs on different computer. Explicit pairing/permissions, main can reclaim; unauthorized commands fail and are journaled, no mandatory roles.

**J6 — Disruption and recovery:** with WAN **off**, main/TV/OBS/2 phone angles cold boot and work; cut phone camera, drop host/TV, revoke Companion, restart MediaMTX; trusted fallbacks, status/fps measurements, recover without source leaks or unauthorised scene Take. Quiz internet participant session separately pauses/fails gracefully when WAN absent.

**J7 — Execution History & backup:** inspect operator, event actual duration, source activation, output ack vs failure; export song use report; church-timezone archive, then backup/restore under Settings Data & Sync and reload approved plan without corruption.

**J8 — MCP/Design:** authorized AI tool creates an editable sermon title, speaker overlay, camera+Bible scene using native Avnac/Rhema document; human previews, edits, approves; AI direct live Take denied. Test offline manual editor still works.

## 5. Definition of evidence

| Evidence class | What it proves | What it does not prove |
| --- | --- | --- |
| Source check | Implementation location and plausible contract | That UI interaction/device actually works |
| Unit/integration tests | Deterministic logic, serialization, component commands | Actual volunteer UX or hardware decoding |
| Tauri/E2E desktop tests | End-to-end state and user interactions | Physical Google TV/camera FPS or independent OBS hardware |
| Real device rehearsal | Actual pairing, latency, frame delivery, fault recovery | All devices/church networks universally behave the same |
| Owner acceptance | Workflow makes sense to church volunteers | Unverified claims of 1080p60 or every manufacturer support |

Always record **Verified Implemented in Main / In PR (draft or review) / Not Implemented / Blocked / Tested Device / Owner Accepted / Released** separately. Green CI is never synonymous with shipped.

## 6. Migration, rollback and compliance checklist per PR

- Old saved service, stage/NDI/output configuration, church profile, theme ID, library media paths, bilingual pinned translations and arranged hymns roundtrip before/after.
- API/remote device protocol versions and backward compatibility (Receiver, Cam, Companion) documented; install upgrade test; no accidental package identity changes.
- Backup/snapshot strategy before schema rewrites; additive migrations and rollback/compatibility adapter; no live real-church data mutation in test.
- Security: role scope, secrets never in URLs/logging for admin controls, revocation, certificate handling, camera viewer privacy, no private stage fields to public receiver.
- Offline operations unaffected by Avnac/MCP or Engage availability; license/source notices preserved.
- Visual QA at 1024×700, 1366×768, 1920×1080, mobile touch and TV remote; keyboard/focus/error-state tests; preview vs live parity; no-purple brand direction.
- Measured performance (CPU/GPU/ram, decoding FPS/latency) and failure recovery for connected products where relevant.
- Documentation, contextual help, route map and updated screenshots in the same PR as behavior changes. Avoid stale PRD state claims.

**Implementation action:** read [handover](../CODEX-UNIFIED-HANDOFF.md), inventory current main + PRs, write a short verified delta against this matrix, then begin highest-risk regression work. This file specifies acceptance/coordination, not permission to merge/deploy.
