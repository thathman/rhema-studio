# Rhema Studio — Product Requirements Document

**Document:** PRD v0.1 (proposed for owner review)  
**Updated:** 2026-10-20  
**Project:** [thathman/rhema-studio](https://github.com/thathman/rhema-studio)  
**Status:** Product specification; not a statement of shipped functionality  
**Product principle:** **Simple by default. Powerful when needed.**  
**Execution tracker:** [TASKS.md](TASKS.md) · **Release gates:** [RELEASE-PLAN.md](RELEASE-PLAN.md)

> **Source of truth policy.** This document defines the product outcomes and acceptance criteria. TASKS.md defines implementation units and records status. RELEASE-PLAN.md defines release eligibility. Detailed design notes reside in docs/rhema-studio/01–07 on the unmerged Studio development stack. Resolve contradictions through a reviewed PR and record decisions; do not quietly rewrite completed history.

## 1. Vision and boundaries

**Promise:** Prepare anywhere. Create beautifully. Collaborate confidently. Present reliably. Preserve what matters.

Rhema Studio is a local-first church service preparation, worship presentation, and live production platform. It evolves the upstream Rhema real-time Bible reference detection application into an end-to-end production workspace without sacrificing reliability or ease of operation. A church with one Windows laptop and a projector must be as well served as a church using OBS, NDI, stage confidence displays, and a multi-person technical team.

The core service must work without network access once its approved content and assets are local. Canva, synchronization, transcription providers, and external integrations are **optional enhancements**, never dependencies of the rendering critical path. Advanced features must be disclosed by task and role, not added as permanent clutter.

### Audience and jobs to be done

| Persona | Essential job | Frequent risk |
|---|---|---|
| First-time Sunday volunteer | Open a prepared service, see Live vs Preview, safely advance content | Accidentally broadcasting the wrong item |
| Worship leader / choir director | Find hymns by number or lyric, arrange sections, share rehearsal notes | Incorrect chorus/repeat or outdated translation |
| Pastor / ministry leader | Prepare scriptures, sermon outline, notes, timings remotely | Last-minute updates overriding live content |
| Graphics volunteer | Create consistent announcements and sermon art using Canva or native templates | Online-only image, missing font or unapproved design |
| Media / production operator | Route congregation, stage, livestream, and signage independently | One action unintentionally clearing every output |
| Production director | Rehearse, manage cues, timing, recordings, permissions, readiness | Inconsistent runtime state and opaque failures |
| Church administrator | Reuse content and archive sermons without deploying a church ERP | Content/license confusion or uncontrolled access |

### Non-goals for initial releases

No full church-management ERP (membership, accounting, attendance or giving ledger); no substitute for OBS as a full video switcher/recorder; no full DAW or advanced multitrack audio engine; no mandatory cloud account; no AI-generated Bible text as an authority; no proprietary song, Scripture or media libraries bundled without redistribution rights; no visually complex operator console as the default.

## 2. Experience model (UX-01)

**Primary navigation:** Home, Prepare, Present, More. Library, Production, Signage and Archive become context-aware sub-workspaces; avoid adding top-level destinations by default.

- **Home:** Next service, actionable readiness, recent projects, simple start/prepare entry points. Readiness is derived from actual state, not a fake score.
- **Prepare:** Single ordered Service Builder with search/add for Scripture, songs/hymns, announcements, media and cues. Editing never projects live. Display owners, review status, media availability, and service duration.
- **Present / Standard:** Clear current/next and Preview/Live, conspicuous Show Live, Next, Previous, Clear, Restore, Quick Find, meaningful warning text. At most one primary task at a time. No technical configuration required to operate an approved service.
- **Present / Production:** Same runtime and commands, with multiview, layers, output routing, timers, stage messaging, media/OBS/NDI status and authorized cues. UI complexity is independent of authorization.
- **More:** Settings, outputs, themes/Brand Kits, device pairing, signage, archived services, troubleshooting and licenses.

**Safety invariants:** selecting/preparing does not present; the operator always knows what is on air; Clear/Restore is reversible; a backstage message never appears on congregation/stream by mistake; remote edits never auto-replace an active release; a failed integration cannot crash or blank the core renderer.

**Accessibility:** keyboard operation, legible labels and feedback beyond color, touch targets >=44px, contrast checks, Yoruba combining diacritic and Unicode fidelity, responsive behavior on 1366x768 and at minimum supported window, screen-reader semantics where applicable, focus-safe shortcuts. Avoid unlabeled icons, mystery jargon and modal chains.

**Suggested usability targets (to validate, not claim):** novice opens approved service <=2 minutes; known Scripture or hymn found/previewed in <=15 seconds; wrong slide recoverable in <=2 actions; commonly used live actions accessible in <=2 clicks; scripted usability tests with real volunteers.

## 3. Functional requirements

IDs are durable; do not recycle them after implementation. Priorities: **P0** essential to dependable local presentation, **P1** essential to full worship workflow, **P2** expansion, **P3** exploratory. Priorities indicate product importance, not guaranteed delivery dates.

### FR-01 — Bible and multilingual worship (P0/P1)

- Search reference in common forms (e.g., John 3:16, Jn 3 16, 1 Sam, I Samuel), full text, saved passages, and Next/Previous verse. Operator can preview then explicitly send live.
- Support English, Yoruba, dual-language layouts, per-output language selection where configured, and stable translation identity across Bible database rebuilds; preserve metadata through service save/reopen.
- Respect canonical verse identity; do not assume every future Bible has identical versification. Warn on missing installed translation without discarding the intended pin.
- Correct Yoruba accents/combining marks in search, storage, line breaking and projection. Support responsive readings and leader/congregation portions as a later reusable item type.
- Preserve original detection/queued verse workflow. AI/STT suggestions are proposals unless the operator explicitly enables an appropriate controlled automation.

**Acceptance:** mixed-language service survives save/restart with both language pins and accurate diacritics; numbered-book references work; presenter selection does not inadvertently change outputs.

### FR-02 — Songs, hymns and worship arrangements (P1)

- Local song library with title, alternate titles, authors, copyright/CCLI info, language, tags, key/tempo optional. No bundled copyrighted lyrics without rights.
- Distinct verse/chorus/bridge/pre-chorus/tag/outro sections, named arrangements and repeat/jump controls; songs can have aligned English/Yoruba text.
- Hymnbooks map book/edition + number to a song; searches accept hymn number, phrase, title and language including diacritic-insensitive matching where appropriate.
- Add song/arrangement to service through same add-item flow as Bible passages; Preview/Live rendering reuses shared presentation and theme engine.
- Import/export plain text, Markdown and supported structured formats progressively. Show a preview and reversible import report; do not promise perfect PPT/PDF/EasyWorship/ProPresenter import.

**Acceptance:** create/edit song and arrangement, reorder sections, save/reopen, lookup by number, present and repeat chorus without losing live state.

### FR-03 — Service Builder and local persistence (P0/P1)

- Create, edit, rename, duplicate, reorder and archive programs; mixed item types with stable IDs, per-item notes and optional estimated durations.
- Local SQLite database with versioned migrations, transactionality, optimistic revision conflicts, audit events, backups and schema compatibility. Bible source database stays independently updatable and read-only.
- Explicit handling of unsaved work, multiple app instances, unsupported future kinds, corruption, missing content and failed saves.
- Distinguish source content, service-specific arrangement, renderable presentation, live runtime, immutable approved release, and append-only execution history.
- Support reusable service templates/variants (e.g., 7/9/11 AM, communion, youth). Changes to shared content must not rewrite already approved releases.

**Acceptance:** programs and metadata survive restart; concurrent stale write is rejected with recoverable conflict; no unsupported fields are silently dropped; failed DB never interrupts an already running local show.

### FR-04 — Live operation and safety (P0)

- Deliberate Preview → Show Live; large Next/Previous, Clear/Restore; quick find from Present; live-vs-selected always visibly distinct.
- Named Quick Screens: black, logo, welcome, please stand, prayer, technical issues; temporary override with safe restore to previous state.
- Freeze/hold output, last-good frame, explicit recovery path, rehearsal mode isolating external side effects.
- Operator-visible errors with specific fix actions; accidental destructive edits require appropriate safeguards.
- Single command/permission pipeline for desktop buttons, keyboard, paired mobile remote, OSC and HTTP; idempotent and revision-aware where necessary.

**Acceptance:** changing content in Prepare cannot alter on-air pixels; disconnecting browser or network does not stop live show; Clear/Restore leaves song position recoverable.

### FR-05 — Styling, Smart Media and design (P1/P2)

- Shared style system for Scripture, lyrics, announcements, sermon titles, stage confidence and independent lower thirds; background image/video and responsive text-safe areas.
- Church Brand Kit with logos, colors, fonts and ministry/service variants. Smart Media adapts content layout to text length and output dimensions; always shows preview before broadcast.
- Separate stage, congregation and streaming language/layout profiles; fallback fonts and missing-media warnings.
- Canva integration: official supported OAuth/authorization, selection or creation in Canva where APIs permit, export/import to local library, source references/revision awareness, review/approval, eligible template/Autofill later. Record rights and provenance; do not claim Canva design is editable after flattened export.
- Imported approved asset remains usable offline; no API calls during live render.

**Acceptance:** a Canva-made announcement can be safely presented with internet disconnected; template renders with readable text at target resolutions.

### FR-06 — Media and independent outputs (P0/P1)

- Local indexed media with stable identity/fingerprint, codecs/duration/dimensions/provenance, missing-file reconciliation, explicit preload and per-output readiness.
- Presentation outputs operate independently: main/projector, stream/transparent NDI lower third, stage confidence and signage. Advancing sanctuary Scripture must not clear a persistent stream overlay.
- Audio/video playback, background media, per-song track association and safe transition/fade controls. Expose output health and actual signal status where technically available.
- Preserve current NDI, Tauri display windows, theme designer, and OSC/HTTP control while migrating.
- OBS integration is an optional bounded connector for scenes, recording markers and status; Rhema must not depend on OBS to show scripture locally.

**Acceptance:** concurrent main + stage + livestream outputs behave independently; removing one output cannot wipe another; loss of a media path is reported before service.

### FR-07 — Production clock, cues and rehearsal (P1/P2)

- Run-of-show with planned vs actual durations and clear timing policies (full item duration, target item end, protect end of service).
- Monotonic clocks, countdown/up, elapsed/remaining, delayed-service projections, manual timing correction with audit.
- Macros and cues through centralized action registry; safe retries, dry-run simulation, permissions and explicit confirm for destructive/external actions.
- Stage-only messages and cues; remote screens with role-aware access. Optional music/track MIDI and external controls after foundational timing reliability.
- Rehearsal mode previews entire program without going on air or sending OBS/lighting commands unless explicitly sandboxed.

**Acceptance:** system wall-clock change cannot corrupt running countdown; stage note never leaks; cue replay is safe.

### FR-08 — Collaboration and synchronization (P1 later)

- Pastor, worship director, designer and production volunteer can prepare remotely with assignments, comments, review/approval and visible Added/Updated by attribution when authenticated identities exist.
- Distinguish editable project and immutable approved service release. Production machine verifies all release assets are local before marking Ready.
- Remote revisions never auto-activate during a service. Detect/resolve conflicts; show visual diffs and activity; preserve a local-only, portable-package, and optional self-hosted pathway.
- Role-based permissions for content editing, approving, remote presenting and device configuration; secure pairing and revocation. LAN control can function locally even when cloud sync is off.
- Synced content encrypted in transit and stored under a clear privacy/retention policy; no requirement for recurring account login to present an already prepared service.

**Acceptance:** disconnect internet midservice without interruption; reviewer approves updated package; operator explicitly accepts it; stale remote command cannot hijack live output.

### FR-09 — Signage, engagement and archive (P2)

- Assign lobby/foyer displays schedules, playlists and cached approved assets independently of live sanctuary; surface screen state and failures.
- Generate optional QR bulletins, scripture references, event details and approved congregation actions; integrate external giving/prayer systems without storing unnecessary sensitive data.
- Mark sermon/recording start/end and timestamps in OBS where available; archive service logs, recordings as references, sermon metadata, scriptures and song usage, transcripts only with appropriate notice/permission.
- Search past services and reuse approved content; retain copyright and provenance.

**Acceptance:** signage persists independently through main-service transitions; archive accurately distinguishes planned and actual program, including manually inserted items.

### FR-10 — AI assistance (P2/P3, opt-in)

- Provider-neutral help for imported lyric structuring, reference suggestions, design QA, prepared transcription, content tagging and sermon indexing.
- **Never fabricate Bible verses**: canonical text comes from installed, licensed Bible sources; AI only suggests coordinates or drafts.
- Human review before publishing or presenting; explicit confidence/source indicators, privacy consent and locally available alternatives where practical.
- Optional live speech-to-text can suggest scripture candidates but is not required for rendering; network failure fails soft.

**Acceptance:** disabling all AI providers has no impact on manual presentation, saved services, or offline media.

## 4. Nonfunctional requirements / quality attributes

| ID | Requirement | Release evidence |
|---|---|---|
| NFR-01 Reliability | Rendering path is local, survives internet loss, safe Preview/Live and stale-command handling | Fault-injection and real desktop rehearsal |
| NFR-02 Durability | Transactional saves, revisions, migration backups, import/export, corruption detection | On-disk DB tests and restore drill |
| NFR-03 Performance | No noticeable delay for local next-slide; no UI freezes during media indexing or optional AI | Measured on representative low/medium PCs, especially 720p30 broadcast |
| NFR-04 Accessibility | Keyboard, legibility, focus safety, meaningful statuses, localization-safe text | Volunteer usability and automated accessibility audits |
| NFR-05 Cross-platform | Tauri-supported platforms; Windows x64 is a priority deployment target | Real installers and smoke tests, not only Linux cargo check |
| NFR-06 Security | LAN opt-in/pairing, least privilege, authenticated writes, no exposed secrets, rate-limiting of remote commands | Threat review, permission tests |
| NFR-07 Observability | Structured diagnostics without sensitive content, error feedback, production health report | Redacted support bundle tests |
| NFR-08 Licensing | Original MIT notices kept; GPL code only after reviewed obligations; Bible/music/media usage rights documented | Dependency/content license manifest |
| NFR-09 Privacy | No hidden cloud dependency/telemetry; informed consent for transcription and remote data | Offline/network capture and privacy review |
| NFR-10 Migration | Existing saved settings and themes survive brand/product identifier migration | Backup/rollback and settings-upgrade tests |

## 5. End-to-end acceptance journeys

**J01 First-time volunteer:** open local approved service → see Ready or actionable warnings → select an item → preview only → Show Live → advance → Clear/Restore. No unexpected broadcast action.

**J02 Spontaneous worship:** live leader changes hymn or repeats chorus; operator searches by number/lyric and jumps safely without destructively editing approved program.

**J03 Multilingual sermon:** presenter calls John 3:16 then continues next verse; operator presents English/Yoruba with accurate diacritics and correct persistent per-output choices.

**J04 Design from home:** graphics volunteer uses approved Canva connection → exports artwork → submits for review → asset cached locally → display on Sunday with no internet.

**J05 Multi-output production:** sanctuary, stream lower-third, stage timers and foyer signage run independently; OBS/NDI disconnect causes warning but not local show failure.

**J06 Collaboration:** pastor changes Friday sermon → production director approves release → church downloads and verifies it → edits on Sunday never automatically supersede active release.

**J07 Failure and recovery:** DB unavailable, missing file, dead network or failed remote device; running show stays operational, warnings explain repairs, backup/standby can restore.

**J08 Archive:** sermon recording cue and service timeline produce reviewable history, linked to preserved approved release and licensing metadata.

## 6. Release criteria, instrumentation, decisions

Follow [RELEASE-PLAN.md](RELEASE-PLAN.md). No release is declared on the strength of CI alone; include the real Windows desktop presentation and output acceptance gate. Suggested measures: novice completion rate/time, operator mistakes requiring recovery, pre-service asset-readiness failures, live presentation interruptions, successful offline rehearsals, data migration/restore success and accessibility defects. Do not collect usage telemetry silently.

**Open owner/product decisions:** default distribution platforms and minimum hardware; branding/installer app-ID migration; project-vs-release approval defaults; which licensed Yoruba/English texts may ship; multi-translation versification strategy; media codecs; music-stand scope; whether Canva Autofill fits target plan tiers; optional sync hosting model and cost; licensing of future third-party code; release packaging size for speech models; archive consent/retention.

## 7. Current implementation snapshot (not shipped)

As checked on 2026-10-20, **main** is still the upstream-derived app. The following are *open, passing-CI but unmerged* PRs; treat their implementation status as **In PR**, not **Done**:

- [#3 Language integration](https://github.com/thathman/rhema-studio/pull/3) — Yoruba OYCB, numbered-book search, dual-language themes, CI.
- [#1 Studio foundation](https://github.com/thathman/rhema-studio/pull/1) — Home/Prepare/Present/More, Standard and Production views, readiness and preview/live controls; stacked on #3.
- [#2 Content persistence](https://github.com/thathman/rhema-studio/pull/2) — SQLite studio.db, service saving, revisions/conflicts, audit, item identity; stacked on #1. The initial data-fidelity review must still be checked against the latest code and desktop acceptance.
- [#4 Speech delta](https://github.com/thathman/rhema-studio/pull/4) — Yoruba speech language and OpenAI STT, separately stacked on #3; optional, live provider unverified.

**Not yet implemented:** song/hymn authoring, mixed media/slides, Canva integration, immutable releases, remote collaboration, signage, full production cues and archive.

## 8. Execution rule

Each implementation PR must cite its **FR-ID**, **task IDs**, test evidence, migration implications, and the next review gate. Do not mark a task done until merged, accepted and verified on the target branch; distinguish **code in PR**, **integration-tested**, **shipped**. Update PRD and task list together when scope changes. The source brainstorm is inspiration; this reviewable specification controls delivery.
