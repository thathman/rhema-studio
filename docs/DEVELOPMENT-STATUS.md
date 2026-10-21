# Rhema Studio — Development Status

Short, durable snapshot for resuming work. Backlog: [TASKS.md](TASKS.md). Requirements: [PRD.md](PRD.md). Release gates: [RELEASE-PLAN.md](RELEASE-PLAN.md).

**Updated:** 2026-10-21

## Integrated `main`

- Head: see `git log fork/main` (2026-10-21 04:32 WAT)
- Contents: songs database (migration 0003, FTS search, JSON import/export), song rundown items, lyric slides and `presentSlide`, Quick find across verses/hymn numbers/songs; numbered-book search, Yoruba OYCB Bible (CC BY-SA 4.0), dual-language themes, CI; Home/Prepare/Present/More shell with Standard and Production present views; `studio.db` (migrations 0001, 0002) with saved services, optimistic concurrency, audit trail, backup-before-migrate; translation-resolution policy and atomic go-live.
- Branches `feature/language-integration`, `feature/rhema-studio-foundation`, `feature/rhema-studio-content`, `docs/rhema-studio-product-plan` are merged and kept (not deleted).

## Issues

Enabled 2026-10-20. #31 ST-006 acceptance pass, #32 QA-001 Windows smoke, #33 and #34 owner decisions (bundled translations; Canva relay), #35 Brand Kit/templates, #36 video, #37 lower thirds, #38 cues, #39 migration matrix.

## Open PRs

- PR #4 `feature/speech-language-openai` (retargeted to `main`): Yoruba speech language and OpenAI Whisper provider. Kept independent until provider/bundling decisions are made (ST-004).

## Active milestone

All PRD milestones through 8 have first slices merged: 2B songs, 2C service builder, 3 media (pictures, backgrounds, pages; video/lower thirds desktop-gated), 4 outputs (roles, stage, language, health, signage), 5 production (timers, cues, rehearsal), 6 design (brand kit; Canva blocked on #34), 7 collaboration (approval, package, operator name, pairing; sync blocked on #72), 8 signage (loop, schedule, playlists, QR), 9 archive (logs). Open work is listed under "Next eligible tasks".

## Latest test results

- Frontend: 419 vitest tests in 58 files pass (420 on the multiview PR); `tsc -b` clean; blocking ESLint subset clean; whole-repo lint now 7 errors, all upstream React hook patterns in untouched components (was 68 before #81).
- Rust: `rhema-content` 44 tests pass; `rhema-api` 115; app `cargo check` and clippy in CI.
- CI on `main`: green on the current head (every merge since PR #46 was followed by a run checked before the next merge).

## Unverified (release-acceptance blockers, not development blockers)

- Every manual row of `docs/rhema-studio/08-desktop-acceptance-guide.md` (sections 1–10z). A browser-shim walkthrough of the song editor and Present flow was done (guide §10a note); it is not desktop verification.
- Windows installer (run 39382133331, content branch at `1684859`) built and inspected, not installed or launched.
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

## Next eligible tasks

1. OP-004 multiview — in PR (#93). Then AR-003 series reuse (add items from a past service), AR-002 OBS recording markers via obs-websocket (needs OBS to verify).
2. Blocked on owner decisions: #72 sync approach (CL-005/006 remote delivery), #34 Canva relay (CV-002…); PR #4 speech (ST-004; AR-004 and AI-001 follow it).
3. Desktop or hardware only: video/NDI rates and codecs (10ab), lower-third keying (10ac), monitors (10ad), OBS 720p30 smoke (OP-005), PT-006 MIDI, QA-010 drill (#62), QA-007 benchmarks, acceptance rows 1–10ae (#31), Windows smoke (#32); ST-009 app identity migration at release time.
