# Rhema Studio — Development Status

Short, durable snapshot for resuming work. Backlog: [TASKS.md](TASKS.md). Requirements: [PRD.md](PRD.md). Release gates: [RELEASE-PLAN.md](RELEASE-PLAN.md).

**Updated:** 2026-10-20

## Integrated `main`

- Head: `e66483b` — merge commits for PR #5 (`5d23c94`), #3 (`a3204ea`), #1 (`011b3ae`), #2 (`e66483b`) on top of `7cbb027`.
- Contents: numbered-book search, Yoruba OYCB Bible (CC BY-SA 4.0), dual-language themes, CI; Home/Prepare/Present/More shell with Standard and Production present views; `studio.db` (migrations 0001, 0002) with saved services, optimistic concurrency, audit trail, backup-before-migrate; translation-resolution policy and atomic go-live.
- Branches `feature/language-integration`, `feature/rhema-studio-foundation`, `feature/rhema-studio-content`, `docs/rhema-studio-product-plan` are merged and kept (not deleted).

## Open PRs

- PR #4 `feature/speech-language-openai` (retargeted to `main`): Yoruba speech language and OpenAI Whisper provider. Kept independent until provider/bundling decisions are made (ST-004).

## Active milestone

**2B — Songs and Hymnbooks** (`docs/rhema-studio/10-milestone-2b-songs-hymnbooks.md`). Sequence: crate + migration 0003 → stores and Quick find → renderer and `presentSlide` → Prepare Songs tab and editor → rundown and Present integration → import/export.

## Latest test results

- Frontend: 300 vitest tests in 23 files pass; `tsc -b` clean; blocking ESLint subset clean (whole-repo lint has 13 pre-existing upstream files with errors, reported but not blocking).
- Rust: `rhema-content` 15 tests pass; app `cargo check` and clippy in CI.
- CI on `main` `e66483b`: see the latest run on the Actions tab; recorded in this file's next revision.

## Unverified (release-acceptance blockers, not development blockers)

- Every manual row of `docs/rhema-studio/08-desktop-acceptance-guide.md` (sections 1–10, incl. 5.0a–5.0h).
- Windows installer (run 39382133331, content branch at `1684859`) built and inspected, not installed or launched.
- Yoruba speech recognition and the OpenAI provider (PR #4).

## Important decisions

- Merge commits only for stacked PRs; squash never (duplicate-change risk).
- Saved service items pin their translation; active translation is for spontaneous content; override is per-session and never persisted.
- Live state has one writer per content kind (`presentVerse`, later `presentSlide`); on-air flag and content land in one store update.
- Song items in `program_items`: `kind='song'`, `reference` = song title (display), `payload` JSON `{song_id, arrangement_id, languages}`.

## Known risks

- No hands-on desktop or projector verification yet of the integrated build.
- Upstream lint debt in `src/components/**` and `data/` is unfixed.
- Whisper model is not bundled in the Windows installer (by design); speech is optional.

## Next eligible tasks

1. SO-002 song CRUD (crate + migration 0003 + Tauri commands) — in progress.
2. SO-003/SO-004/SO-005/SO-006 editor, arrangements, hymnbooks, multilingual lyrics.
3. SO-007 search, SO-009 rundown integration, SO-010 renderer and live safety, SO-008 import/export.
