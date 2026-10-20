# Rhema Studio — Master Task Backlog

**Backlog revision:** 0.7 · **Updated:** 2026-10-20 · **Authoritative requirements:** [PRD.md](PRD.md) · **Release gates:** [RELEASE-PLAN.md](RELEASE-PLAN.md)

## Operating rules

- Each task has a stable **ID**, requirement **FR-ID**, **priority** (P0–P3), **dependencies**, and verifiable **done criteria**. Break large tasks into linked GitHub issues when implementation begins. Never use an issue number as the stable requirement/task ID.
- **States:** `BACKLOG` (not started); `DESIGN` (analysis/spec only); `IN PR` (code exists, not merged); `MERGED` (merged, not yet accepted); `ACCEPTED` (merged + tests/manual gate passed); `SHIPPED` (included in released build); `BLOCKED`. No automatic status inflation from passing CI.
- Task owners initially **Unassigned**; implementing engineer becomes responsible after issue assignment. Product acceptance belongs to repository owner. No arbitrary due dates.
- Every issue/PR should include: task IDs, affected FRs, change scope, migration/security/license notes, tests and screenshots, performance and offline impact, rollback plan, acceptance checklist.
- Do not conflate **in PR** with **done**. GitHub Issues are not yet provisioned. This file is the master queue until issues are created; issue links should be added here as they are established.
- Track separate **code quality** vs **volunteer UX acceptance**. An intuitive app is not established merely by unit tests.

## Current active work

| Task | P | State | Depends on | Evidence / next gate |
|---|---|---|---|---|
| ST-001 Integrate numbered-book search, OYCB source and dual-language display | P0 | MERGED | — | [PR #3](https://github.com/thathman/rhema-studio/pull/3) merged `a3204ea`; real Yoruba projector/font check still open (ST-006) |
| ST-002 Establish Home/Prepare/Present/More shell and two Present views | P0 | MERGED | ST-001 (stack) | [PR #1](https://github.com/thathman/rhema-studio/pull/1) merged `011b3ae`; operator rehearsal still open (ST-006) |
| ST-003 Add versioned SQLite studio.db, migration/recovery/audit, persistent service editing | P0 | MERGED | ST-002 (stack) | [PR #2](https://github.com/thathman/rhema-studio/pull/2) merged `e66483b`; manual checklist `docs/rhema-studio/08-desktop-acceptance-guide.md` not yet performed |
| ST-004 Yoruba speech and OpenAI speech provider delta | P2 | IN PR | ST-001 | [PR #4](https://github.com/thathman/rhema-studio/pull/4); decide bundling, live provider tests |
| ST-005 Verify translation/secondary/notes round-trip in latest PR #2 | P0 | MERGED | ST-003 | Fixed in PR #2 (`9c7c1c2`): items keep saved translation/secondary/notes; 7 store tests incl. bilingual reopen/save/reopen. Manual step 4.6–4.7 in the acceptance guide still open |
| ST-006 End-to-end operator acceptance on real desktop and projectors | P0 | BACKLOG | ST-001,ST-002,ST-003 | Checklist written (`08-desktop-acceptance-guide.md`); Windows installer built (run 39382133331) and contents inspected, not launched. No manual pass performed yet |
| ST-007 Verify PR dependency merge sequence and CI after retargets | P0 | MERGED | ST-005 | Executed 2026-10-20: #5 `5d23c94` → #3 `a3204ea` → #1 `011b3ae` → #2 `e66483b`, merge commits, no duplicates (`git diff` content-branch..main = docs only). CI on `main` recorded in DEVELOPMENT-STATUS.md. Branches kept; PR #4 retargeted to `main` |
| ST-008 Ship explicit database backup/restore UX and verified recovery exercise | P0 | IN PR | ST-003 | content-backup-restore PR: More → Library → Back up now / Restore from a backup; crate `verify_backup` + `restore_from` (snapshot first, bad files refused, reopen on failure, older backups migrate); 2 crate tests; guide §9.4–9.6. Recovery rehearsal on a real machine (QA-010) still open |
| ST-009 Migrate product identity and settings safely | P2 | BACKLOG | ST-003 | Existing configurations survive app-ID rename, migration/rollback tested |
| ST-010 Correct typecheck coverage and control lint debt | P1 | MERGED / BACKLOG | ST-001 | `tsc -b` in CI (merged); lint debt documented (13 upstream files), not reduced |
| ST-011 Translation-resolution policy and atomic live activation | P0 | MERGED | ST-003,ST-005 | PR #2 (`af950eb`): item's saved translations win unless overridden; missing translation reported, never substituted; Next/Prev/Show live/OSC/HTTP go on air only with the verse; Clear cancels in-flight presents. 26 tests. Manual steps 5.0a–5.0h open |

## Milestone 2B — Songs and Hymnbooks

| Task | P | State | Depends on | Done criteria |
|---|---|---|---|---|
| SO-001 Specify versioned song/section/arrangement/hymnbook schema | P1 | MERGED | ST-003,ST-005 | Spec `docs/rhema-studio/10-milestone-2b-songs-hymnbooks.md`; schema shipped as migration 0003 in PR #6 (`802640a`) |
| SO-002 Song CRUD and history | P1 | MERGED (crate) / IN PR (editor) | SO-001 | PR #6 crate; songs-editor PR: Prepare → Songs library, New/Edit/Delete with conflict and in-use messages, unsaved-change guard |
| SO-003 Section editor (verse/chorus/bridge/tag) | P1 | IN PR | SO-002 | songs-editor PR: paste-first parser → section cards, kind dropdown, relabel, move/remove, EN/YO side by side, validation list |
| SO-004 Named service-specific arrangements | P1 | IN PR | SO-003 | songs-editor PR: arrangement strip (drag, ← → Delete, buttons), named orders, default flag, per-item order and language choice in the rundown |
| SO-005 Hymnbook catalogs and number lookup | P1 | MERGED (crate) / IN PR (UI) | SO-002 | PR #6 crate; PR #7 Quick find; songs-editor PR: hymnbook creation and number rows in the editor |
| SO-006 Multilingual lyrics | P1 | IN PR | SO-003,ST-001 | songs-core PR: per-language section texts, slides aligned per section, missing-language warning on the slide and in Present, diacritic-folded search |
| SO-007 Search library | P1 | MERGED (crate) / IN PR (UI) | SO-002,SO-005 | PR #6: FTS5 over title/authors/lyrics + numbers; songs-core PR: one Quick find box for verses, hymn numbers and songs |
| SO-008 Import/export | P1 | MERGED (crate) / IN PR (UI) | SO-001,SO-003 | PR #6 crate; songs-import-export PR: More → Library dialog, export to `rhema-songs-<date>.json`, import JSON (skip/replace/duplicate) and OpenLyrics .xml (DOMParser, per-language verses, verseOrder, songbooks, report of ignored parts) |
| SO-009 Add songs to unified service rundown | P1 | IN PR | SO-004,ST-003 | songs-core PR: song rundown items (`kind='song'` + payload) save/reopen, Add from Quick find, slide sub-list, reorder/remove |
| SO-010 Song/lyric renderer and Live safety | P0 | IN PR | SO-009,ST-002 | songs-core PR: `presentSlide` (atomic go-live, Clear cancels, no stale frame), lyric lines + secondary language + copyright footer in the renderer, Next/Prev step slides then items, Show live from a previewed slide; 12 tests |
| SO-011 Rehearsal notes, key, tempo, attachments | P2 | BACKLOG | SO-004 | Notes never leak to congregation; imported media rights tracked |

## Milestone 2C — Mixed content and service planning

| Task | P | State | Depends on | Done criteria |
|---|---|---|---|---|
| SV-001 Custom slide schema/editor and text rendering | P1 | BACKLOG | ST-003 | Create/reuse, save/reopen, theme safe area, explicit Preview/Live |
| SV-002 Unified add/reorder/edit flow across Bible/song/slide | P1 | BACKLOG | SO-009,SV-001 | One search bar and consistent add action; stable item identity |
| SV-003 Service templates and multi-service variants | P1 | BACKLOG | SV-002 | Duplicate/adjust 7/9/11 AM without unintended shared mutations |
| SV-004 Quick Find for Bible, hymn, song, media | P1 | BACKLOG | SO-007,SV-002 | Keyboard-safe, typo-tolerant, predictable candidate ranking |
| SV-005 Next/Previous Verse and responsive readings | P1 | BACKLOG | ST-001,SV-002 | Versification-safe navigation; leader/congregation format |
| SV-006 Program notes, review readiness and duration estimates | P1 | BACKLOG | SV-002 | Clear missing/unfinished tasks, no false readiness |
| SV-007 Persistent revisions, visual compare and revert | P1 | BACKLOG | ST-003,SV-002 | Auditable service history; reversible without affecting live |

## Milestone 3 — Media and visuals

| Task | P | State | Depends on | Done criteria |
|---|---|---|---|---|
| MD-001 Media asset schema, import, hash, provenance | P1 | BACKLOG | ST-003 | Index local assets; dedup/missing-file handling, rights |
| MD-002 Playback (image/video/audio), aspect and timing | P1 | BACKLOG | MD-001,SV-002 | Supported codecs matrix; graceful unsupported/missing media |
| MD-003 Backgrounds, safe text and lyric scrolling | P1 | BACKLOG | MD-002,SO-010 | Per-slide preview, readability, no display disruption |
| MD-004 Independently addressable transparent lower-third layer | P1 | BACKLOG | MD-001 | Congregation vs OBS output independent; alpha verified |
| MD-005 Quick Screens and persistent overlays | P1 | BACKLOG | ST-002,MD-002 | Logo/Black/Welcome/Stand/Pray, restore previous live |
| MD-006 Local cache manifest, integrity/readiness | P0 | BACKLOG | MD-001,SV-002 | Missing file/font reported before live, release works offline |
| MD-007 Adaptive Smart Media rendering | P2 | BACKLOG | MD-003 | Text fits styles/output without masking content or violating branding |

## Milestone 4 — Multi-output, stage and monitoring

| Task | P | State | Depends on | Done criteria |
|---|---|---|---|---|
| OP-001 Output profile model, routing and migration | P1 | BACKLOG | MD-004 | Profiles for projector/stage/OBS; original settings migrate safely |
| OP-002 Stage confidence screen and private messages | P1 | BACKLOG | OP-001 | Current/next, count, no congregation leak |
| OP-003 Independent language/style per output | P1 | BACKLOG | OP-001,SO-006 | EN/YO variants projected independently with matched passage |
| OP-004 Multiview and device health | P1 | BACKLOG | OP-001 | Show actual/preview outputs, disconnected/error status |
| OP-005 NDI/OBS and external output stability | P0 | BACKLOG | OP-001 | Real OBS 720p30 smoke, NDI recovery, app survives drop |
| OP-006 Paired mobile/LAN control with roles | P1 | BACKLOG | OP-001 | Secure pairing, revocation, authorization, no cloud dependency |

## Milestone 5 — Timers, cues, rehearsal

| Task | P | State | Depends on | Done criteria |
|---|---|---|---|---|
| PT-001 Monotonic timer engine | P1 | BACKLOG | SV-002 | Wall-clock changes do not alter elapsed time |
| PT-002 Service timing policies and over/under | P1 | BACKLOG | PT-001 | Policy changes explained; calculated planned/actual |
| PT-003 Cue/macro typed action registry | P1 | BACKLOG | OP-001 | Idempotent, permission-aware, safe retry and operator preview |
| PT-004 Stage timer messages, visual cues | P1 | BACKLOG | PT-002,OP-002 | Stage-only alerts and controls |
| PT-005 Rehearsal/dry-run isolation | P0 | BACKLOG | PT-003 | Cannot inadvertently affect congregation, OBS or real devices |
| PT-006 Song-playback/MIDI synchronization | P2 | BACKLOG | PT-003,MD-002 | Explicit integration opt-in, loss of sync degrades safely |

## Milestone 6 — Canva and Church Brand Kit

| Task | P | State | Depends on | Done criteria |
|---|---|---|---|---|
| CV-001 Validate current Canva Connect API scopes, plan eligibility, rate limits | P1 | BACKLOG | MD-001 | Document actual permissible API flow; no assumed live editor |
| CV-002 Secure Canva account connection and disconnection | P1 | BACKLOG | CV-001 | OAuth token safety, consent, refresh/revoke, offline behavior |
| CV-003 Select/edit-in-Canva/export and local import | P1 | BACKLOG | CV-002,MD-006 | Track source design/export version, review, local cache |
| CV-004 Church Brand Kit and ministry variants | P1 | BACKLOG | MD-003 | Fonts/colors/logos reproducible across items |
| CV-005 Native reusable announcement templates | P1 | BACKLOG | CV-004,SV-001 | Data fields validated, review, local rendering |
| CV-006 Canva Autofill eligibility and templating | P2 | BACKLOG | CV-003,CV-005 | Only eligible APIs/plans, meaningful errors, no mandatory dependency |
| CV-007 Approval and update-check workflow | P2 | BACKLOG | CV-003,CL-002 | New export cannot replace currently live art |

## Milestone 7 — Remote collaboration, approval and sync

| Task | P | State | Depends on | Done criteria |
|---|---|---|---|---|
| CL-001 Accounts, roles and local identity/actor audit | P1 | BACKLOG | ST-003 | Added/updated by with real actor, permissions test |
| CL-002 Immutable approved release snapshot | P0 | BACKLOG | SV-002,MD-006 | Complete content+media manifest, explicit go-live release |
| CL-003 Local portable service package | P1 | BACKLOG | CL-002 | Export/import checksum verified without internet |
| CL-004 Sync transport evaluation and threat model | P1 | BACKLOG | CL-001,CL-002 | Self-hosted vs optional hosted assessed and priced; no lock-in |
| CL-005 Sync drafts, approvals, presence and conflict resolution | P1 | BACKLOG | CL-004 | Edited remotely, reviewed locally, no silent overwrite |
| CL-006 Release delivery and activation at church | P0 | BACKLOG | CL-003,CL-005 | All assets preflight; active runtime pinned offline |
| CL-007 Team assignments, comments, visual diff/notifications | P2 | BACKLOG | CL-005 | Ownership, activity audit, unread actionable changes |

## Milestones 8–9 — Signage, engagement, archive, AI

| Task | P | State | Depends on | Done criteria |
|---|---|---|---|---|
| SG-001 Signage player and screen identity | P2 | BACKLOG | OP-001,MD-006 | Independent cache and device health |
| SG-002 Scheduled announcements/playlists | P2 | BACKLOG | SG-001 | Date/time and timezone tested, no effect on sanctuary |
| SG-003 QR digital bulletins and optional action links | P2 | BACKLOG | SV-002 | Link safety, privacy, consent, offline fallback |
| AR-001 Runtime journal/service event log | P1 | BACKLOG | CL-002,PT-001 | Actual vs planned with operator events |
| AR-002 OBS recording markers and sermon metadata | P2 | BACKLOG | AR-001,OP-005 | No fake recorded status; failures visible |
| AR-003 Searchable archive and series reuse | P2 | BACKLOG | AR-001 | Find sermon/song/Scripture, respect rights |
| AR-004 Opt-in transcription and archive indexing | P2 | BACKLOG | AR-003 | Provider-consent, corrections and privacy |
| AI-001 Provider abstraction, privacy and human approval | P2 | BACKLOG | AR-004 | Offline mode unaffected; no AI output auto-live |
| AI-002 Assisted Bible suggestion / sermon-follow | P3 | BACKLOG | AI-001,ST-001 | Retrieve text from licensed local corpus only; approval and provenance |

## Cross-cutting quality, safety and release tasks

| Task | P | State | Depends on | Done criteria |
|---|---|---|---|---|
| QA-001 Windows x64 signed/unsigned packaging and hands-on smoke | P0 | BACKLOG | ST-007 | Artifact installs/launches, data stays, projectors + NDI verified |
| QA-002 Offline and injected-failure test suite | P0 | BACKLOG | OP-005,SV-002 | No live outage under network/API failure |
| QA-003 Accessibility and novice-volunteer usability | P0 | BACKLOG | ST-002 | Keyboard, contrast, novice timed exercises with recorded findings |
| QA-004 Rights and dependency license inventory | P0 | BACKLOG | ST-001 | Upstream MIT notices, Yoruba terms, media/lyrics provenance |
| QA-005 Settings and database migration/rollback matrix | P0 | BACKLOG | ST-003 | Upgrades, corrupt files, backup restore, app identity |
| QA-006 Security threat review of LAN, external cues and cloud sync | P1 | BACKLOG | OP-006,CL-004 | Pairing/auth, permissions, secrets, revocation, secure defaults |
| QA-007 Performance benchmarks on representative low-end hardware | P1 | BACKLOG | SO-010,MD-002 | 720p30 practical OBS target, slide action latency logged |
| QA-008 Technical docs, troubleshooting, volunteer handbook | P1 | BACKLOG | QA-003 | 1-page quick start, stage/production guides, diagnostics |
| QA-009 CI status gates and no-skipped-test claims | P0 | MERGED | ST-001,ST-003 | PR CI runs are real; document limits and Windows manual builds |
| QA-010 Backup/restore incident rehearsal | P0 | BACKLOG | ST-008 | Recover approved last-good content on standby machine |

## Roll-up / near-term sequence

1. **Integration gate:** ST-005 → ST-006 → ST-007 (PR #3, #1, #2; #4 separate). Verify actual desktop and Windows before approval. Avoid accidental squash/stack duplication.
2. **Content foundation:** ST-008, SO-001 → SO-010, SV-001 → SV-005. No complicated media project before a real song-to-Live flow works.
3. **Production reliability:** MD-001 → MD-006, OP-001 → OP-005, PT-001 → PT-005. Parallelize visuals only across non-conflicting boundaries.
4. **Design and remote prep:** CV-001 → CV-005, CL-001 → CL-006; a Canva export and approved service must be fully usable offline.
5. **Expansion:** signage, engagement, archive, AI. Only promote into a release after the gates in RELEASE-PLAN.md.

**Changes to task status:** maintain a brief revision history below (date, task IDs, PR/issue, verified evidence). Start with explicit PR links and no speculative completion claims.

## Revision history

- **2026-10-20 (rev 0.7):** PR #9 merged `039602b`; content-backup-restore PR opened (ST-008 IN PR).
- **2026-10-20 (rev 0.6):** PR #8 merged `38f76eb`; songs-import-export PR opened (SO-008 UI IN PR).
- **2026-10-20 (rev 0.5):** PR #7 merged `351d8e2`; songs-editor PR opened (SO-002 editor, SO-003, SO-004, SO-005 UI IN PR). Browser-shim check of the editor and Present flow recorded in guide §10a.
- **2026-10-20 (rev 0.4):** PR #6 (songs database) merged `802640a`; songs-core PR opened (SO-006/007/009/010 IN PR, SO-002/005/008 crate parts MERGED).
- **2026-10-20 (rev 0.3):** Integration executed: PRs #5, #3, #1, #2 merged into `main` (`e66483b`). ST-001/002/003/005/007/011, QA-009 → MERGED (not ACCEPTED: manual desktop gate ST-006 open). Milestone 2B started (SO-002…). Status snapshots live in `docs/DEVELOPMENT-STATUS.md`.
- **2026-10-20:** Initial canonical backlog created from owner-confirmed product direction and existing seven Studio design documents. No tasks newly implemented by this documentation-only change.
