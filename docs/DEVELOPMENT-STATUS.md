# Rhema Studio — Development Status

Short, durable snapshot for resuming work. Backlog: [TASKS.md](TASKS.md). Requirements: [PRD.md](PRD.md). Release gates: [RELEASE-PLAN.md](RELEASE-PLAN.md).

**Updated:** 2026-10-20

## Integrated `main`

- Head: `38f76eb` — merge commits for PR #5 (`5d23c94`), #3 (`a3204ea`), #1 (`011b3ae`), #2 (`e66483b`), #6 songs database (`802640a`), #7 songs in the service (`351d8e2`), #8 song editor (`38f76eb`), #9 library export/import (`039602b`), #10 backup/restore (`d884791`), #11 custom slides (`570b41a`), #12 service builder (`ff09a63`), #13 verse +/− (`7c8b980`), #14 notes/readiness (`fa05eef`), #15 quick screens (`8bc82eb`).
- Contents: songs database (migration 0003, FTS search, JSON import/export), song rundown items, lyric slides and `presentSlide`, Quick find across verses/hymn numbers/songs; numbered-book search, Yoruba OYCB Bible (CC BY-SA 4.0), dual-language themes, CI; Home/Prepare/Present/More shell with Standard and Production present views; `studio.db` (migrations 0001, 0002) with saved services, optimistic concurrency, audit trail, backup-before-migrate; translation-resolution policy and atomic go-live.
- Branches `feature/language-integration`, `feature/rhema-studio-foundation`, `feature/rhema-studio-content`, `docs/rhema-studio-product-plan` are merged and kept (not deleted).

## Open PRs

- PR #4 `feature/speech-language-openai` (retargeted to `main`): Yoruba speech language and OpenAI Whisper provider. Kept independent until provider/bundling decisions are made (ST-004).

## Active milestone

**2C — Service Builder**: SV-001 custom slides merged (PR #11); SV-002 drag reorder and SV-003 copy service merged (PR #12); SV-005 and SV-006 merged. 2C remaining: SV-007 revisions/compare, SV-004 typo tolerance, duration estimates. Milestone 3: MD-005 text quick screens merged (#15); MD-001 media index and MD-002 pictures in PR (media-assets). 2B code complete pending desktop acceptance.

**2B — Songs and Hymnbooks** (`docs/rhema-studio/10-milestone-2b-songs-hymnbooks.md`). Done: crate + migration 0003 (PR #6), stores, Quick find, renderer, `presentSlide`, rundown and Present integration (PR #7). Merged: Prepare → Songs library, paste-first editor, arrangement strip, hymnbook numbers, per-item language/order controls, licence readiness line (PR #8). Merged: More → Library export/import (PR #9). Remaining for 2B: manual acceptance §10a on the desktop. Milestone 2B code is complete pending acceptance.

## Latest test results

- Frontend: 352 vitest tests in 33 files pass; `tsc -b` clean; blocking ESLint subset clean (whole-repo lint has 13 pre-existing upstream files with errors, reported but not blocking).
- Rust: `rhema-content` 31 tests pass; `rhema-api` 105; app `cargo check` and clippy in CI.
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

- No hands-on desktop or projector verification yet of the integrated build.
- Upstream lint debt in `src/components/**` and `data/` is unfixed.
- Whisper model is not bundled in the Windows installer (by design); speech is optional.

## Next eligible tasks

1. MD-001/MD-002 pictures (media-assets, #16) and MD-006 picture readiness (media-readiness) — in PR.
2. MD-003 picture as a background behind text (song/verse over a picture); MD-002 video.
3. SV-007 service revisions UI; SV-004 typo-tolerant Quick find.
3. SO-011 rehearsal notes/key/tempo (P2) when 2C's item editing lands.
