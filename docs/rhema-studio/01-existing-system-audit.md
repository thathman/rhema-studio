# 01 — Existing System Audit

Date: 2026-10-19
Repository: https://github.com/thathman/rhema-studio (fork of `openbezal/rhema`)
Audited commit: `7cbb027` (`fork/main`, the PR target). Also inspected the unmerged
`codex/windows-installer-20261003` branch (`eed695a`) because it carries the Yoruba and
dual-translation work.

Everything in this document was verified by reading the code or running a command on
2026-10-19. Where something could not be verified it says so.

## 1. Summary

Rhema today is a focused, working tool: **real-time AI Bible verse detection** from a
sermon audio feed, with a verse queue, a canvas-rendered live output, a theme designer,
NDI output, and OSC/HTTP remote control. It is a Tauri v2 desktop app (React 19 +
TypeScript frontend, Rust workspace backend).

It is **not** yet a service-presentation platform. There are no songs, no service
rundowns, no custom slides, no media library, no persistence of service content, and no
user/role model. The UI is a single fixed six-panel dashboard built around the
transcript-to-detection workflow.

The codebase is in good shape for evolution: strong typing, a clean Zustand store
layer, an explicit "only `presentVerse` changes live" rule, 240 passing frontend tests,
and clear crate boundaries in Rust. The right strategy is to **wrap** the existing engine
in a new shell, not to rewrite it.

## 2. Verification results

| Check | Command | Result |
|---|---|---|
| TypeScript | `bun run typecheck` | pass |
| Frontend tests | `bunx vitest run` | 17 files, 240 tests, all pass |
| ESLint | `bun run lint` | **55 errors** (16 in `src/`, 34 in `src-tauri/` TS data scripts, 6 in `web/`, 1 in `data/`). Mostly `react-hooks` v7 rules (setState in effect, ref access in render) and `react-refresh` in `web/`. None are build-blocking. |
| Rust | `cargo check -p rhema` | Passes on Intel macOS **only** with a Homebrew ONNX Runtime: `brew install onnxruntime` then `ORT_LIB_LOCATION=$(brew --prefix onnxruntime) ORT_PREFER_DYNAMIC_LINK=1 cargo check -p rhema`. Without it `ort-sys` fails (no prebuilt x86_64 macOS binary). `cargo clippy` with the same env is clean for the app and content crates. |
| Production bundle | `bun run build` | pass (see foundation PR) |

## 3. Stack and structure (verified)

| Layer | What is actually there | Where |
|---|---|---|
| Desktop host | Tauri 2.10, single main window 1280×800 (min 1024×600), extra webview windows per output | `src-tauri/tauri.conf.json`, `src-tauri/src/commands/broadcast.rs` |
| Frontend | React 19.2, Vite 7, Tailwind v4, shadcn/ui (radix-ui), Zustand 5, lucide icons, sonner toasts, react-joyride tutorial, fabric (theme designer), fuse.js | `package.json`, `src/` (≈20k lines TS/TSX) |
| Backend | Rust workspace, 7 crates + app crate (≈73k lines incl. detection) | `src-tauri/crates/*` |
| Bible data | Bundled SQLite `data/rhema.db` with FTS5; schema in `data/schema.sql` | `rhema-bible` crate |
| Persistence | `tauri-plugin-store` JSON files: `settings.json`, `bible.json`, `broadcast-themes.json`; `localStorage` for UI theme | `src/stores/*`, `src/components/theme-provider.tsx` |
| Packaging | GitHub Actions: `build-release.yml` (3 OS matrix, unsigned), `build-windows-installer.yml` (fork addition), `deploy-web.yml` (marketing site in `web/`) | `.github/workflows/` |
| Licence | MIT, © 2025 OpenBezal | `LICENSE` |

### 3.1 Frontend architecture

- **Entry**: `src/main.tsx` resets the STT backend, hydrates settings/bible/themes, then renders `App`.
- **App**: `src/App.tsx` mounts `Dashboard`, the tutorial overlay, toasts, and two app-wide hooks (`useRemoteControl`, `useBroadcastOutputs`).
- **Layout**: `src/components/layout/dashboard.tsx` is a fixed CSS grid: transport bar, then four panels (Transcript, Preview, Live, Queue), then Search + Detections. There is no router and no navigation; everything is on one screen.
- **Stores** (`src/stores/`): `audio`, `transcript`, `bible`, `queue`, `settings`, `detection`, `broadcast`, `tutorial`. All plain Zustand; three of them hydrate from and debounce-persist to `tauri-plugin-store`.
- **Presentation rule**: `presentVerse()` in `src/hooks/use-broadcast.ts` is the only path that changes the live verse. Preview selection (`bibleStore.selectedVerse`) never writes live state. This is exactly the property Rhema Studio needs and must be preserved.
- **Output rendering**: `src/lib/verse-renderer.ts` (1.5k lines) draws a theme + verse onto a 2D canvas. The same renderer is used by the in-app `CanvasVerse` preview and by each output window (`src/broadcast-output.tsx`, loaded from `broadcast-output.html?output=<id>`). Output windows receive `broadcast:verse-update` events via `emitTo`; NDI frames are pushed from the output window's canvas through `push_ndi_frame`.
- **Remote control**: Rust OSC/HTTP → Tauri events → `useRemoteControl` → `remoteActions` registry (`src/lib/remote-actions.ts`). This registry is the right place for the new shell's Next/Previous/Show Live controls to dispatch into, so keyboard, OSC, HTTP and UI never drift.

### 3.2 Important coupling found

**Detection event listeners live inside a panel component.** `src/components/panels/transcript-panel.tsx` registers the Tauri listeners for `audio_level`, `translation_command`, `verse_detections` and `reading_mode_verse` and contains the auto-present / auto-queue logic. If the transcript panel is not mounted, detections silently stop reaching the queue and the live output. Any new shell must either keep this panel mounted or lift the listeners to app level. The foundation slice lifts them into `src/hooks/use-detection-events.ts` (mounted once in `App`) so every workspace behaves the same.

### 3.3 Rust backend

| Crate | State | Notes |
|---|---|---|
| `rhema-audio` | working | cpal capture, VAD, level meter |
| `rhema-stt` | working | Whisper (local, feature-gated), Deepgram WS+REST, OpenAI |
| `rhema-bible` | working | SQLite open, verse/chapter lookup, FTS5 search, cross-refs |
| `rhema-detection` | working | direct parser (Aho-Corasick + fuzzy), semantic (ONNX Qwen3, brute-force cosine despite the `hnsw_index.rs` name), merger, reading mode |
| `rhema-broadcast` | working | NDI 6 via `libloading`; SDK is downloaded, not vendored |
| `rhema-api` | working | axum HTTP (`/api/v1/health|status|command|control`), OSC (`/rhema/*`), with tests |
| `rhema-notes` | placeholder | empty crate |

Tauri state is a set of `Mutex<...>` managed singletons; commands are listed in `src-tauri/src/lib.rs`. There is **no persistence layer in Rust** beyond the read-only Bible DB.

## 4. Capability classification

Legend: **1** implemented and working · **2** implemented but incomplete · **3** present but unreliable · **4** not implemented · **5** requires architectural change

| Area | Class | Evidence |
|---|---|---|
| Live speech-to-text (Whisper / Deepgram / OpenAI) | 1 | `rhema-stt`, `use-transcription.ts`; models not bundled in releases (README) |
| Bible reference detection (direct) | 1 | `rhema-detection/direct`, tests |
| Semantic detection / re-ranking | 2 | works only after `bun run setup:all --with-embedding`; provenance self-check in `lib.rs` |
| Reading mode, voice translation switching | 1 | `reading_mode.rs`, `translation_command` event |
| Bible DB, FTS search, quick reference entry | 1 | `rhema-bible`, `search-panel.tsx`, `quick-search.ts` (+tests) |
| Cross-references | 1 | `crossref.rs` |
| Yoruba (OYCB) translation | 2 / unmerged | On `pr/yoruba-bible` and the Codex branch only; **not on `main`** |
| Dual-language output (primary + secondary translation) | 2 / unmerged | `pr/secondary-language-theme`, Codex branch `eed695a` |
| Numbered-book prefix fix ("1 S", "I Sam", "1st") | unmerged | `pr/missing-numbered-prefix-books` |
| Verse queue (manual + auto) | 1 | `queue-store.ts`, drag reorder with `@dnd-kit` |
| Preview / live separation | 1 | `presentVerse` is the single live writer |
| Canvas verse renderer, themes, theme designer | 1 | `verse-renderer.ts`, `theme-designer.tsx` (fabric), builtin themes, migrations |
| Multiple outputs (display windows + NDI) | 1 | `broadcast-store.ts`, `broadcast-output-control.ts`; status reconciled from OS |
| NDI output | 1 (needs runtime SDK) | `rhema-broadcast/ndi.rs`, `download-ndi-sdk.ts` |
| OSC / HTTP remote API | 1 | `rhema-api`, `documentation/remote-control.md`; `opacity` command is a no-op placeholder |
| OBS integration | 4 | none; NDI is the only path into OBS today |
| Settings persistence | 1 | three plugin-store JSON files |
| Onboarding tutorial | 1 | react-joyride, 11 steps tied to `data-tour` / `data-slot` attributes |
| Light/dark UI theme | 1 | `theme-provider.tsx` (localStorage) |
| Diagnostics export | 1 | `commands/diagnostics.rs` |
| Songs, hymns, arrangements | 4 | nothing in code |
| Service rundown / programs | 2 (since Milestone 2 PR) | services (programs) with ordered verse items can be created, saved, reopened; the queue store is the in-memory rundown with a `kind` field |
| Custom slides, announcements | 4 | — |
| Media library, video/audio playback, backgrounds | 4 | themes support a background image only |
| Lower thirds | 2 | a builtin "Lower Thirds" theme with transparent background exists; no dedicated lower-third pipeline |
| Stage / confidence view | 4 | — |
| Timers, cues, macros | 4 | — |
| Users, roles, approvals, collaboration | 4 | — |
| Digital signage, archive | 4 | — |
| Content persistence (SQLite for user content) | 2 (since Milestone 2 PR) | `rhema-content` crate: `studio.db`, embedded migrations, programs + items + audit trail. Songs/slides/media tables not yet added |
| Canva | 4 | — |
| Cloud sync | 4 | — (and must stay optional) |

## 5. Weaknesses and technical debt (verified)

1. **No navigation model.** One screen; adding workspaces needs a shell (addressed in the foundation slice).
2. **Detection wiring tied to a panel** (§3.2). Fixed in the foundation slice.
3. **Content persistence is JSON blobs.** Fine for themes and settings; unsuitable for songs, services, revisions and audit trails. See `05-domain-model.md`.
4. **`settings-dialog.tsx` is 1,161 lines and `search-panel.tsx` 878 lines.** They work, but each new feature makes them harder to change. Leave alone in this slice; split when Prepare adds content search.
5. **Lint debt**: 55 ESLint errors, mostly from the stricter `react-hooks` v7 rules. Not fixed here to keep the PR focused; tracked in the roadmap.
6. **Queue identity is by reference string** (`findLiveQueueIndex` matches `liveVerse.reference`). Works for verses; will not work once rundown items are songs or slides. The domain model introduces stable item IDs.
7. **Remote `opacity` command is a placeholder** (`use-remote-control.ts`).
8. **Four unmerged fork branches** carry overlapping work (Yoruba, dual-language themes, numbered books, and a Codex squash that includes all three plus theme styling). They need to be reconciled into `main` once; the foundation PR avoids the files they touch so either order merges cleanly.
9. **Rust cannot be built on Intel macOS** (`ort-sys` prebuilt binaries). Not a bug in the repo, but a constraint for contributors.
10. **Window title / product name are still "Rhema".** `productName` and `identifier` in `tauri.conf.json` determine the app-data directory for `tauri-plugin-store`; changing them would silently orphan existing users' settings. The foundation slice changes only visible branding and leaves these two values alone until a migration is written.

## 6. Licensing and upstream

- Upstream: `openbezal/rhema`, MIT. `LICENSE` retained verbatim. Rust crate `license = "MIT"`.
- Yoruba OYCB text: CC BY-SA 4.0 (`data/YORUBA-OYCB-LICENSE.md`, on the unmerged branches). Attribution text is included there and must be surfaced in an About screen when that branch lands.
- Cross references: openbible.info data (CC-BY). Bundled translations include copyrighted ones (NIV, ESV, NASB, NKJV, NLT, AMP) downloaded by the user's own pipeline; `data/sources/*.json` is gitignored. Distribution rights for those texts are the deploying church's responsibility and the README already says so.
- NDI SDK: downloaded at setup, not vendored; NDI's SDK licence applies to redistribution.
- No GPL code was found in `src/` or `src-tauri/`. No reason to leave MIT.

## 7. Preservation checklist

The foundation PR and every later milestone must keep these working. Each has a quick manual check.

- [ ] `presentVerse` remains the only writer of live state; preview selection never goes live.
- [ ] Detection events (`verse_detections`, `reading_mode_verse`, `translation_command`, `audio_level`) are handled regardless of which workspace is visible.
- [ ] Auto toggle still gates detection-driven presents; manual presents ignore it.
- [ ] Queue Next/Previous, Send to Live, Add to Queue, Bible Next/Previous still work from OSC and HTTP (`documentation/remote-control.md`).
- [ ] Output windows still open per output, receive `broadcast:verse-update`, and NDI start/stop still works.
- [ ] Theme designer, outputs dialog and settings dialog still open from the UI.
- [ ] Tutorial targets (`data-slot`/`data-tour` attributes) still exist in the Production view.
- [ ] Persisted files (`settings.json`, `bible.json`, `broadcast-themes.json`) keep their keys and locations.
- [ ] `bun run typecheck`, `bunx vitest run` and `bun run build` pass.
