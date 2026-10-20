# Rhema Studio — Development Status

Short, durable snapshot for resuming work. Backlog: [TASKS.md](TASKS.md). Requirements: [PRD.md](PRD.md). Release gates: [RELEASE-PLAN.md](RELEASE-PLAN.md).

**Updated:** 2026-10-20

## Integrated `main`

- Head: see `git log fork/main` (2026-10-21 00:12 WAT)
- Contents: songs database (migration 0003, FTS search, JSON import/export), song rundown items, lyric slides and `presentSlide`, Quick find across verses/hymn numbers/songs; numbered-book search, Yoruba OYCB Bible (CC BY-SA 4.0), dual-language themes, CI; Home/Prepare/Present/More shell with Standard and Production present views; `studio.db` (migrations 0001, 0002) with saved services, optimistic concurrency, audit trail, backup-before-migrate; translation-resolution policy and atomic go-live.
- Branches `feature/language-integration`, `feature/rhema-studio-foundation`, `feature/rhema-studio-content`, `docs/rhema-studio-product-plan` are merged and kept (not deleted).

## Issues

Enabled 2026-10-20. #31 ST-006 acceptance pass, #32 QA-001 Windows smoke, #33 and #34 owner decisions (bundled translations; Canva relay), #35 Brand Kit/templates, #36 video, #37 lower thirds, #38 cues, #39 migration matrix.

## Open PRs

- PR #4 `feature/speech-language-openai` (retargeted to `main`): Yoruba speech language and OpenAI Whisper provider. Kept independent until provider/bundling decisions are made (ST-004).

## Active milestone

**2C — Service Builder** complete in code (SV-001–SV-007; SV-004 typo tolerance open). **Milestone 5** PT-001/PT-002 merged. **Milestone 4** started with output roles and the stage display. **2C detail:** SV-001 custom slides merged (PR #11); SV-002 drag reorder and SV-003 copy service merged (PR #12); SV-005 and SV-006 merged. 2C remaining: SV-007 revisions/compare, SV-004 typo tolerance, duration estimates. Milestone 3: MD-005 text quick screens merged (#15); MD-001 media index and MD-002 pictures in PR (media-assets). 2B code complete pending desktop acceptance.

**2B — Songs and Hymnbooks** (`docs/rhema-studio/10-milestone-2b-songs-hymnbooks.md`). Done: crate + migration 0003 (PR #6), stores, Quick find, renderer, `presentSlide`, rundown and Present integration (PR #7). Merged: Prepare → Songs library, paste-first editor, arrangement strip, hymnbook numbers, per-item language/order controls, licence readiness line (PR #8). Merged: More → Library export/import (PR #9). Remaining for 2B: manual acceptance §10a on the desktop. Milestone 2B code is complete pending acceptance.

## Latest test results

- Frontend: 398 vitest tests in 51 files pass (PR #83); `tsc -b` clean; blocking ESLint subset clean; whole-repo lint now 7 errors, all upstream React hook patterns in untouched components (was 68 before #81).
- Rust: `rhema-content` 44 tests pass; `rhema-api` 115; app `cargo check` and clippy in CI.
- CI on `main`: green on `40963a9`, `802640a` (PR #6 head), `351d8e2` (PR #7 head), `38f76eb` (PR #8 head), `039602b` (PR #9 head), `d884791` (PR #10 head).

## Unverified (release-acceptance blockers, not development blockers)

- Every manual row of `docs/rhema-studio/08-desktop-acceptance-guide.md` (sections 1–10a, incl. 5.0a–5.0h). A browser-shim walkthrough of the song editor and Present flow was done (guide §10a note); it is not desktop verification.
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
- **Licensing (owner decision):** the installer's `rhema.db` bundles copyrighted translations (NIV, ESV, NASB, NKJV, NLT, AMP) inherited from upstream. `docs/LICENSES.md` records this; no public release should go out before the owner decides which texts ship.

- No hands-on desktop or projector verification yet of the integrated build.
- Upstream lint debt in `src/components/**` and `data/` is unfixed.
- Whisper model is not bundled in the Windows installer (by design); speech is optional.

## Next eligible tasks

1. #83 merged (Home offers today's approved service). Next: SG-001 screen health in readiness (missing pictures in a signage loop).
2. Non-desktop backlog after that: SG-003 QR bulletins (needs a QR encoder dependency; decide), SG-001 screen health/cache, AR-002 OBS markers (needs OBS). Blocked on owner decisions: #72 sync approach, #33 bundled translations, #34 Canva relay; PR #4 speech (ST-004).
3. Desktop-gated: MD-002 video (#36), MD-004 lower thirds (#37), OP-005 OBS/NDI stability, QA-010 drill (#62), acceptance rows 1–10x (#31), Windows smoke (#32); ST-009 app identity migration at release time.
