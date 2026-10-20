# Rhema Studio — Development Status

Short, durable snapshot for resuming work. Backlog: [TASKS.md](TASKS.md). Requirements: [PRD.md](PRD.md). Release gates: [RELEASE-PLAN.md](RELEASE-PLAN.md).

**Updated:** 2026-10-20

## Integrated `main`

- Head: `351d8e2` — merge commits for PR #5 (`5d23c94`), #3 (`a3204ea`), #1 (`011b3ae`), #2 (`e66483b`), #6 songs database (`802640a`), #7 songs in the service (`351d8e2`).
- Contents: songs database (migration 0003, FTS search, JSON import/export), song rundown items, lyric slides and `presentSlide`, Quick find across verses/hymn numbers/songs; numbered-book search, Yoruba OYCB Bible (CC BY-SA 4.0), dual-language themes, CI; Home/Prepare/Present/More shell with Standard and Production present views; `studio.db` (migrations 0001, 0002) with saved services, optimistic concurrency, audit trail, backup-before-migrate; translation-resolution policy and atomic go-live.
- Branches `feature/language-integration`, `feature/rhema-studio-foundation`, `feature/rhema-studio-content`, `docs/rhema-studio-product-plan` are merged and kept (not deleted).

## Open PRs

- PR #4 `feature/speech-language-openai` (retargeted to `main`): Yoruba speech language and OpenAI Whisper provider. Kept independent until provider/bundling decisions are made (ST-004).

## Active milestone

**2B — Songs and Hymnbooks** (`docs/rhema-studio/10-milestone-2b-songs-hymnbooks.md`). Done: crate + migration 0003 (PR #6), stores, Quick find, renderer, `presentSlide`, rundown and Present integration (PR #7). In PR: Prepare → Songs library, paste-first editor, arrangement strip, hymnbook numbers, per-item language/order controls, licence readiness line. Remaining: import/export UI (JSON + OpenLyrics via DOMParser), manual acceptance §10a.

## Latest test results

- Frontend: 329 vitest tests in 28 files pass; `tsc -b` clean; blocking ESLint subset clean (whole-repo lint has 13 pre-existing upstream files with errors, reported but not blocking).
- Rust: `rhema-content` 25 tests pass; app `cargo check` and clippy in CI.
- CI on `main`: green on `40963a9`, `802640a` (PR #6 head), `351d8e2` (PR #7 head).

## Unverified (release-acceptance blockers, not development blockers)

- Every manual row of `docs/rhema-studio/08-desktop-acceptance-guide.md` (sections 1–10a, incl. 5.0a–5.0h). A browser-shim walkthrough of the song editor and Present flow was done (guide §10a note); it is not desktop verification.
- Windows installer (run 39382133331, content branch at `1684859`) built and inspected, not installed or launched.
- Yoruba speech recognition and the OpenAI provider (PR #4).

## Important decisions

- Merge commits only for stacked PRs; squash never (duplicate-change risk).
- Saved service items pin their translation; active translation is for spontaneous content; override is per-session and never persisted.
- Live state has one writer per content kind (`presentVerse`, later `presentSlide`); on-air flag and content land in one store update.
- Song items in `program_items`: `kind='song'`, `reference` = song title (display), `payload` JSON `{song_id, arrangement_id, languages}`.
- `src/dev/browser-shim.ts` stubs Tauri IPC for plain-browser dev runs (`bun run dev` + localhost); dev-only, absent from production builds. Use it for layout checks, never as acceptance evidence.

## Known risks

- No hands-on desktop or projector verification yet of the integrated build.
- Upstream lint debt in `src/components/**` and `data/` is unfixed.
- Whisper model is not bundled in the Windows installer (by design); speech is optional.

## Next eligible tasks

1. SO-008 import/export UI (More → Library: `rhema-songs-v1.json` export, JSON and OpenLyrics import with a report).
2. ST-008 explicit database backup/restore UX.
3. Milestone 2C: SV-001 custom slides, SV-002 unified add/reorder flow.
