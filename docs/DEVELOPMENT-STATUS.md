# Rhema Studio — Development Status

Short, durable snapshot for resuming work. Backlog: [TASKS.md](TASKS.md). Requirements: [PRD.md](PRD.md). Release gates: [RELEASE-PLAN.md](RELEASE-PLAN.md).

**Updated:** 2026-10-21

## Integrated `main`

- Head: see `git log fork/main` (2026-10-21 20:30 WAT; every PR through #143 merged)
- Contents: see CHANGELOG.md. `studio.db` is at migration 0011 (services, item identity, songs, media, revisions, key/tempo, approval, service logs, attachments, archive/templates/approver, who saved each version).
- Branches `feature/language-integration`, `feature/rhema-studio-foundation`, `feature/rhema-studio-content`, `docs/rhema-studio-product-plan` are merged and kept (not deleted).

## Issues

Enabled 2026-10-20. #31 ST-006 acceptance pass, #32 QA-001 Windows smoke, #33 and #34 owner decisions (bundled translations; Canva relay), #35 Brand Kit/templates, #36 video, #37 lower thirds, #38 cues, #39 migration matrix.

## Open PRs

- PR #4 `feature/speech-language-openai` (retargeted to `main`): Yoruba speech language and OpenAI Whisper provider. Kept independent until provider/bundling decisions are made (ST-004).

## Active milestone

All PRD milestones through 8 have first slices merged: 2B songs, 2C service builder, 3 media (pictures, backgrounds, pages; video/lower thirds desktop-gated), 4 outputs (roles, stage, language, health, signage), 5 production (timers, cues, rehearsal), 6 design (brand kit; Canva blocked on #34), 7 collaboration (approval, package, operator name, pairing, church folder per #72; hosted sync designed, hosting choice open), 8 signage (loop, schedule, playlists, QR), 9 archive (logs). Open work is listed under "Next eligible tasks".

## Latest test results

- Frontend: 508 vitest tests pass; `tsc -b` clean; blocking ESLint subset clean; whole-repo lint now 0 errors (was 68 before #81, 7 before the lint-debt PR) and blocking in CI.
- Rust: `rhema-content` 49 tests pass; `rhema-api` 120; app `cargo check` and clippy in CI.
- Dependency licences: `scripts/check-licenses.ts` (npm production tree, 544 packages; Rust crate graph) runs in CI and passes. A test fails if code names an unlisted internet host (`src/lib/network-hosts.test.ts`).
- CI on `main`: green on the current head (every merge since PR #46 was followed by a run checked before the next merge).

## Unverified (release-acceptance blockers, not development blockers)

Gate-by-gate evidence for the newest installer: `docs/rhema-studio/19-release-candidate-evidence.md` (decision: NO-GO until desktop rows and owner sign-off).


- Every manual row of `docs/rhema-studio/08-desktop-acceptance-guide.md` (sections 1–10bq). A browser-shim walkthrough of the song editor and Present flow was done (guide §10a note); it is not desktop verification.
- Windows installer: workflow run 39571182784 built `main` at `7a0ac5c` (artifact 99,702,771 bytes, digest sha256:5b0ef3827d1c5d0dd12caa65f043f405b34caf14e8d43ace5faa78e3c323ae5f; CI run 39571181200 green on the same commit; #134 came after). Not installed or launched; not a release.
- Yoruba speech recognition and the OpenAI provider (PR #4).

## Important decisions

- Merge commits only for stacked PRs; squash never (duplicate-change risk).
- Saved service items pin their translation; active translation is for spontaneous content; override is per-session and never persisted.
- Live state has one writer per content kind (`presentVerse`, later `presentSlide`); on-air flag and content land in one store update.
- Song items in `program_items`: `kind='song'`, `reference` = song title (display), `payload` JSON `{song_id, arrangement_id, languages}`.
- Pictures are read from `<app data>/media` by the webview (fs plugin app-dir scope) and travel to output windows as data URLs inside the render data, like theme images; the file index (hash, size, dimensions) lives in `media_assets`.
- `src/dev/browser-shim.ts` stubs Tauri IPC for plain-browser dev runs (`bun run dev` + localhost); dev-only, absent from production builds. Use it for layout checks, never as acceptance evidence.

## Known risks

- **Canva (owner decision):** the Connect API's token exchange must run on a backend (client secret); a hosted or self-hosted relay is a cost/ops choice, and the integration must be a Canva-reviewed public one. See `docs/rhema-studio/11-canva-connect-findings.md`. CV-002 onwards waits for this.
- **Licensing (decided 2026-10-21, #33):** the installer keeps the upstream translations (NIV, ESV, NASB, NKJV, NLT, AMP) on the owner's statement of upstream rights and fair use; `docs/LICENSES.md` §2 records the decision and the absence of written publisher permission in the repo.

- No hands-on desktop or projector verification yet of the integrated build.
- Video in a hidden NDI-only window may be throttled to about 1 frame a second by WebView2/WebKit (row 10ab.4); visible display outputs are not affected.
- Whisper model is not bundled in the Windows installer (by design); speech is optional.

## Merged 2026-10-21 (this run)

#96 downgrade guard · #97 diagnostics redaction · #98 licence check, CHANGELOG, KNOWN-ISSUES · #99 Black/Logo/Technical quick screens · #100 remote rate limit · #101 review fixes (licence walk, SPDX precedence, clean Black) · #102 phone remote page + QR pairing · #103 one running copy · #104 last good frame · #105 network/privacy note + host guard · #106 quick screens fit 1366x768 (Back was clipped) · #107 deletes ask first · #108 draw-failure warnings · #109 common short book names ("Jn 3 16") · #110 songs as plain text/Markdown · #111 ask before closing with unsaved work; closing the main window quits (hidden NDI windows used to keep the process alive) · #112 sound player for walk-in music and backing tracks; header chips wrap at 1366 px · #113 sounds as service items (play when reached going forward; screens untouched; silent in rehearsal) · #114 more injected-failure tests (database fails on save, media list fails, sound fails) · #115 API keys, remote key and OBS password in the system keychain (one entry; verified before the file copy is blanked; file fallback without a keychain) · #116 projected end time and audited timer correction · #117 song usage report (CSV) for licence reporting · #118 rename and re-date a service (the backend existed, the app had no way to call it) · #119 named service templates, archive, approver name (migration 0010); Copy can no longer renumber the original after a failed create · #120 church-defined cues (run from Present and by id from Stream Deck/OSC) · #121 responsive readings (one slide per leader/people exchange) · #122 installer licence page, LICENSE and generated third-party notices with every licence text · #123 last 7 lint errors fixed, whole-repo lint blocking in CI · #124 end-by clock time per item · #125 slide-change latency in the logs (QA-007) · #126 church folder: versioned service packages over a shared folder/NAS (owner decision #72) · #127 a newer version in the church folder is pointed out (never auto-opened) · #128 optional hosted sync design (doc 20) · #129 consent before microphone audio first goes to Deepgram (RG-08) · #130 opt-in transcript kept with a service log (AR-004) · #131 who prepares each item and who saved each version (CL-007, migration 0011) · #132 optional "ask before showing an unapproved service" (CL-002; off by default; only the first go-live of a service, never mid-service) · #133 accessibility: automated WCAG AA check of every main screen, names for icon buttons and sliders, theme cards usable by keyboard, Show live contrast · #134 readable status colours in light mode · #135 Yorùbá book names in Quick find (from the bundled edition's own contents) · #136 macOS Cmd+Q asks about unsaved work (the framework could not hold the menu's Quit; Dock quit still cannot) · #137 team comments on items, carried in service files and the church folder, with a per-computer unread count (CL-007) · #138 backup and restore run off the main thread and outside the database lock, so a stalled USB stick or network share cannot freeze the outputs or hold up saving (QA-002) · #139 a song's backing track (an attached sound) offered in Present while the song is up (FR-06) · #140 verses heard by speech recognition wait for Show live unless Auto is turned on (upstream had it on by default, out of sight in the Standard view); Settings and the Live panel are one switch (FR-01, AI-001) · #141 Next stays on the operator's item when items are added, removed or reordered during the service (adding a verse used to make Next repeat the current item), and heard verses no longer move Next or write into an open service (RG-03) · #142 five fixes from an audit of every on-air path: opening Present or saying a translation name no longer re-renders the screen (it dropped the background and the item's translations), a translation change keeps the preview and the newest choice wins, stepping keeps the arrangement a song went live with, a deleted live song lets Next move on, Verse +/− keeps the item · #143 six fixes from a data-safety and output audit: every saved field counts as a change (video loop/sound and QR links did not), fields from newer versions are kept on save, the close question covers an unsaved song and a rundown built without a service, edits during a load count, "Save mine as a new song" on a song conflict, a theme an output uses cannot be deleted.

Found by reading PRD lines against the code (not by tests): auto-live on by default (#140), Next off by one after adding during a service (#141), five more on-air defects from an audit (#142), six data and output defects from a second audit (#143), no single-instance guard, no last-good frame, one-click log deletion, the PRD's own "Jn 3 16" example failing, the Back button clipped at 1366x768. Independent reviews of each batch found 9 more defects, all fixed.

## Every row not yet merged, and why (2026-10-21, after a full read of PRD, TASKS and RELEASE-PLAN)

| Row | What is left | Blocked by |
|---|---|---|
| ST-004 | Yorùbá speech, OpenAI provider (PR #4) | Owner: speech provider and model bundling |
| ST-006 | Operator acceptance rows 1–10bq | Real Windows desktop and projector (#31) |
| ST-009 | App identity rename with settings migration | Owner: product name / installer app ID (PRD open decision) |
| MD-002 | Sound over NDI | Audio path to the NDI sender and real receivers to test |
| OP-005 | OBS 720p30 smoke, NDI runtime drop | Real OBS/NDI hardware |
| PT-006 | Song playback / MIDI sync (a manual per-song backing track is merged, #139) | Owner: which playback source |
| CV-002, CV-003, CV-006, CV-007 | Canva connection, export/import, Autofill, update checks | Owner: Canva token relay (#34; recurring cost, Canva-reviewed public integration) |
| CL-001 | Roles and multi-user identity | Owner: who may present/approve (and the sync decision for remote users) |
| CL-002 | Approval gate merged as an opt-in setting (#132). Whether it is on by default | Owner: the default, and who may approve (with CL-001) |
| CL-005, CL-006 | Shared-folder delivery merged (#126). Hosted sync designed (doc 20) | Owner: hosting option (own computer, rented VPS, or vendor) and whether to encrypt packages |
| CL-007 | Assignments, saved-by (#131) and comments with unread counts through the church folder (#137) merged. Push notifications | Need hosted sync (later, per #72) |
| SG-003 | Giving/prayer action links | Owner: which external systems |
| AR-004 | Opt-in transcript in kept logs merged (#130). Retention policy, corrections, sermon indexing | Owner: archive consent/retention (PRD open decision) |
| AI-001, AI-002 | Human approval of heard verses merged (#140). Provider abstraction, AI suggestions beyond verse detection | Owner: speech/AI provider (PR #4) |
| QA-001 | Install, launch and smoke the installer | Real Windows machine (#32) |
| QA-002 | Stalled-drive backup/restore fixed in code (#138). Network loss, OBS drop, packet capture, pulled USB stick | Real desktop (rows 10an, 10bl) |
| QA-003 | Novice usability sessions | Real volunteers |
| QA-006 | Cloud-sync threat review | Hosted sync not built yet (#72: later); the shared-folder threat model is in 15-sync-transport-evaluation.md |
| QA-007 | Benchmarks on low-end hardware | Real low-end PCs (the latency logging they need: #125) |
| QA-010 | Backup/restore drill | Real machines (#62) |

## Next eligible tasks

Every backlog row now has its buildable part merged. What remains, by why it is not being built:

1. **Owner decisions (product direction):**
   - #72 sync approach: **decided 2026-10-21** (shared folder/NAS + versioned packages first; hosted sync later, optional). First slice merged (#126, church folder); hosted sync, CL-007 push notifications and the cloud-sync threat review follow when hosted sync is taken up.
   - #34 Canva relay (recurring cost, Canva-reviewed public integration) → CV-002, CV-003, CV-006, CV-007.
   - PR #4 speech provider and bundling → ST-004, then AR-004 opt-in transcription and AI-001/AI-002.
   - App identity for release (PRD open decision "branding/installer app-ID migration") → ST-009.
   - Who may present → CL-001 roles; whether the approval gate (#132, off by default) should be on by default → CL-002.
   - Which external giving/prayer systems to link → SG-003 action links.
   - PT-006 song-playback sync: which playback source (MIDI clock, backing tracks) to support.
2. **Engineering items held back on purpose (2026-10-21):**
   - macOS Quit from the menu: fixed in #136 (Cmd+Q now asks); quitting from the Dock or at logout still cannot be held (KNOWN-ISSUES).
   - Sound over NDI: needs an audio path from the webview to the NDI sender and real receivers to test.
   - Yoruba book names in reference search: done in #135 from the bundled edition's own names; other editions' spellings wait for a Yorùbá speaker (acceptance 10bj.2).
   - Backing tracks tied to songs: a manual per-song track is merged (#139); syncing playback (MIDI clock and the like) is PT-006, which waits on the playback-source decision.
3. **Real desktop or hardware (release gate, not development):** acceptance rows 1–10bq (#31), Windows smoke (#32), OBS 720p30 smoke (OP-005), video/NDI rates (10ab), QA-010 drill (#62), QA-007 benchmarks on low-end hardware, QA-003 novice usability sessions.
