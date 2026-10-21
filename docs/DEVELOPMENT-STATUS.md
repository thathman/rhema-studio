# Rhema Studio — Development Status

Short, durable snapshot for resuming work. Backlog: [TASKS.md](TASKS.md). Requirements: [PRD.md](PRD.md). Release gates: [RELEASE-PLAN.md](RELEASE-PLAN.md).

**Updated:** 2026-10-21

## Integrated `main`

- Head: see `git log fork/main` (2026-10-21 07:10 WAT; every PR through #115 merged)
- Contents: songs database (migration 0003, FTS search, JSON import/export), song rundown items, lyric slides and `presentSlide`, Quick find across verses/hymn numbers/songs; numbered-book search, Yoruba OYCB Bible (CC BY-SA 4.0), dual-language themes, CI; Home/Prepare/Present/More shell with Standard and Production present views; `studio.db` (migrations 0001, 0002) with saved services, optimistic concurrency, audit trail, backup-before-migrate; translation-resolution policy and atomic go-live.
- Branches `feature/language-integration`, `feature/rhema-studio-foundation`, `feature/rhema-studio-content`, `docs/rhema-studio-product-plan` are merged and kept (not deleted).

## Issues

Enabled 2026-10-20. #31 ST-006 acceptance pass, #32 QA-001 Windows smoke, #33 and #34 owner decisions (bundled translations; Canva relay), #35 Brand Kit/templates, #36 video, #37 lower thirds, #38 cues, #39 migration matrix.

## Open PRs

- PR #4 `feature/speech-language-openai` (retargeted to `main`): Yoruba speech language and OpenAI Whisper provider. Kept independent until provider/bundling decisions are made (ST-004).

## Active milestone

All PRD milestones through 8 have first slices merged: 2B songs, 2C service builder, 3 media (pictures, backgrounds, pages; video/lower thirds desktop-gated), 4 outputs (roles, stage, language, health, signage), 5 production (timers, cues, rehearsal), 6 design (brand kit; Canva blocked on #34), 7 collaboration (approval, package, operator name, pairing; sync blocked on #72), 8 signage (loop, schedule, playlists, QR), 9 archive (logs). Open work is listed under "Next eligible tasks".

## Latest test results

- Frontend: 444 vitest tests pass; `tsc -b` clean; blocking ESLint subset clean; whole-repo lint now 7 errors, all upstream React hook patterns in untouched components (was 68 before #81).
- Rust: `rhema-content` 45 tests pass; `rhema-api` 120; app `cargo check` and clippy in CI.
- Dependency licences: `scripts/check-licenses.ts` (npm production tree, 544 packages; Rust crate graph) runs in CI and passes. A test fails if code names an unlisted internet host (`src/lib/network-hosts.test.ts`).
- CI on `main`: green on the current head (every merge since PR #46 was followed by a run checked before the next merge).

## Unverified (release-acceptance blockers, not development blockers)

Gate-by-gate evidence for the newest installer: `docs/rhema-studio/19-release-candidate-evidence.md` (decision: NO-GO until desktop rows and owner sign-off).


- Every manual row of `docs/rhema-studio/08-desktop-acceptance-guide.md` (sections 1–10at). A browser-shim walkthrough of the song editor and Present flow was done (guide §10a note); it is not desktop verification.
- Windows installer: workflow run 39546898905 built `main` at `0305327` (artifact `rhema-windows-x64-installer`, 99,250,688 bytes, artifact digest sha256:febc816174afe10380868be117d6d8a37ab81b5eb467aad1cd04e7d18d8c78ed, kept 14 days; CI run 39546870731 green on the same commit). Earlier: run 39541733204 at `7bf70ee`. Not installed or launched; not a release.
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
- Upstream lint debt: 7 React hook patterns in untouched components (ST-010).
- Whisper model is not bundled in the Windows installer (by design); speech is optional.

## Merged 2026-10-21 (this run)

#96 downgrade guard · #97 diagnostics redaction · #98 licence check, CHANGELOG, KNOWN-ISSUES · #99 Black/Logo/Technical quick screens · #100 remote rate limit · #101 review fixes (licence walk, SPDX precedence, clean Black) · #102 phone remote page + QR pairing · #103 one running copy · #104 last good frame · #105 network/privacy note + host guard · #106 quick screens fit 1366x768 (Back was clipped) · #107 deletes ask first · #108 draw-failure warnings · #109 common short book names ("Jn 3 16") · #110 songs as plain text/Markdown · #111 ask before closing with unsaved work; closing the main window quits (hidden NDI windows used to keep the process alive) · #112 sound player for walk-in music and backing tracks; header chips wrap at 1366 px · #113 sounds as service items (play when reached going forward; screens untouched; silent in rehearsal) · #114 more injected-failure tests (database fails on save, media list fails, sound fails) · #115 API keys, remote key and OBS password in the system keychain (one entry; verified before the file copy is blanked; file fallback without a keychain).

Found by reading PRD lines against the code (not by tests): no single-instance guard, no last-good frame, one-click log deletion, the PRD's own "Jn 3 16" example failing, the Back button clipped at 1366x768. Independent reviews of each batch found 9 more defects, all fixed.

## Next eligible tasks

Every backlog row now has its buildable part merged. What remains, by why it is not being built:

1. **Owner decisions (product direction):**
   - #72 sync approach → CL-005 remote drafts/approvals, CL-006 remote delivery, CL-007 team comments, QA-006 cloud-sync review.
   - #34 Canva relay (recurring cost, Canva-reviewed public integration) → CV-002, CV-003, CV-006, CV-007.
   - PR #4 speech provider and bundling → ST-004, then AR-004 opt-in transcription and AI-001/AI-002.
   - App identity for release (PRD open decision "branding/installer app-ID migration") → ST-009.
   - Who may present and whether approval must gate going live → CL-001 roles, CL-002 "approval required before go-live".
   - Which external giving/prayer systems to link → SG-003 action links.
   - PT-006 song-playback sync: which playback source (MIDI clock, backing tracks) to support.
2. **Real desktop or hardware (release gate, not development):** acceptance rows 1–10at (#31), Windows smoke (#32), OBS 720p30 smoke (OP-005), video/NDI rates (10ab), QA-010 drill (#62), QA-007 benchmarks on low-end hardware, QA-003 novice usability sessions.
