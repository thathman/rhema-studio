# Rhema Studio — rights and licence inventory

**Updated:** 2026-10-20 · Task QA-004 · Evidence gathered from `package.json`, `node_modules/*/package.json`, `cargo metadata`, `LICENSE`, `data/YORUBA-OYCB-LICENSE.md`, `src-tauri/tauri.conf.json` and the README. Nothing here changes a licence; it records what ships and what still needs an owner decision.

## 1. The application

| Item | Licence | Notes |
|---|---|---|
| Rhema (upstream, OpenBezal) | MIT, © 2025 OpenBezal | `LICENSE` at the repo root is kept verbatim; More → About and the README carry the attribution. |
| Rhema Studio additions (this fork) | MIT, same file | No separate licence; every contribution is under the repo's MIT licence. |

## 2. Bundled content

| Content | Licence / terms | Where it ships | Status |
|---|---|---|---|
| Open Yoruba Contemporary Bible (OYCB), © 2009, 2017 Biblica, Inc. | CC BY-SA 4.0 | `rhema.db` (31,087 verses); licence text at `resources/licenses/YORUBA-OYCB-LICENSE.md`, attribution in More → About | **Compliant**: attribution, licence copy and change note shipped. Any derivative must stay CC BY-SA 4.0. |
| KJV | Public domain outside the UK (Crown patent in the UK) | `rhema.db` | Fine. |
| NIV, ESV, NASB, NKJV, NLT, AMP | **Copyrighted** (Biblica, Crossway, Lockman, Thomas Nelson, Tyndale, Lockman). Upstream obtains them with `data/download-biblegateway.py`; their publishers' terms generally allow personal use and limited quotation, not redistribution of the full text. | `rhema.db` inside the installer (the Windows artifact built on 2026-10-20 contains them) | **Owner decision (2026-10-21, issue #33): ship them as upstream does.** The owner states that the original app came with distribution rights and that the use falls under fair use. Engineering note kept for the record: this repository holds no written permission from the publishers, upstream obtains the texts with `data/download-biblegateway.py`, and fair use is a US doctrine that rarely covers distributing a complete translation. If a publisher objects, the remedy is a build without that translation; no code depends on any one of them. |
| SpaRV, FreJND, PorBLivre (upstream's extra translations) | Public domain / open (per upstream) | may be in `rhema.db` depending on the build | Verify each source's statement before a release that includes them. |
| openbible.info cross-references | CC BY 4.0 (openbible.info) | `rhema.db` | Attribution in More → About (PR about-notices) and the README. |
| Song texts | None bundled | — | The song library is church content; each song carries `copyright`, `ccli_number`, `licence` and `licence_note`, and Home flags songs with no licence recorded. The app never claims a licence it does not know. |
| Quick screens, custom slides, pictures | Church content | — | Pictures are imported by the church; the app records the original path and content hash only. |
| Whisper speech model | MIT (whisper.cpp / OpenAI Whisper weights, MIT) | not bundled in the installer; downloaded on demand | Fine. |
| ONNX embedding model (optional re-ranking) | depends on the model chosen by `data/precompute-embeddings*.py` | optional, not in the installer | Record the model card's licence when the feature is enabled for a release. |
| Fonts: Geist, Geist Mono, Inter, Source Serif 4 | SIL OFL 1.1 | bundled via `@fontsource` | Fine (OFL permits bundling; reserved font names unchanged). |

## 3. Third-party components

### 3.1 NDI

| Component | Terms | Notes |
|---|---|---|
| NDI 6 SDK runtime (`Processing.NDI.Lib.x64.dll`, 29.8 MB in the Windows installer) | NewTek/Vizrt NDI SDK licence (proprietary; redistribution of the runtime library is permitted under the SDK licence with the required notice) | `data/download-ndi-sdk.ts` fetches it; loaded at runtime via `libloading`. NDI® trademark notice and SDK licence reference in More → About (PR about-notices); the installer's licence screen still shows only MIT (**to do** in the packaging workflow). |

### 3.2 Rust crates (direct dependencies, from `cargo metadata`)

All permissive. `whisper-rs` is Unlicense; `aho-corasick` is Unlicense OR MIT; everything else is MIT, Apache-2.0, ISC or Zlib (dual-licensed where shown):
aho-corasick 1.1.4, async-trait 0.1.91, axum 0.8.9 (MIT), base64 0.13.1, bytemuck 1.25.2, cpal 0.15.3 (Apache-2.0), crossbeam-channel 0.5.16, dotenvy 0.15.7 (MIT), fontdb 0.24.0 (MIT), futures-util 0.3.33, libloading 0.7.4 (ISC), log 0.4.33, lru 0.12.5 (MIT), ndarray 0.16.1, ort 2.0.0-rc.13, regex 1.13.1, reqwest 0.12.28, rosc 0.11.4, rusqlite 0.34.0 (MIT; bundles SQLite, public domain), serde 1.0.229, serde_json 1.0.151, sha2 0.10.9, sysinfo 0.33.1 (MIT), tauri 2.11.5 and plugins (dialog, fs, global-shortcut, log, store), thiserror 1.0.69, tokenizers 0.22.2 (Apache-2.0), tokio 1.53.1 (MIT), tokio-tungstenite 0.26.2 (MIT), tower-http 0.6.11 (MIT), url 2.5.8, uuid 1.24.0, whisper-rs 0.16.0 (Unlicense; wraps whisper.cpp, MIT).

ONNX Runtime (via `ort`) is MIT; on Intel macOS it is linked dynamically from Homebrew for development only.

### 3.3 JavaScript packages (direct dependencies, from `package.json`)

MIT unless noted: @chenglou/pretext, @dnd-kit/react, @tailwindcss/vite, @tauri-apps/* (Apache-2.0 OR MIT), @vitejs/plugin-react, class-variance-authority (Apache-2.0), clsx, cmdk, fabric, fuse.js (Apache-2.0), lucide-react (ISC), radix-ui, react, react-dom, react-joyride, shadcn, sonner, tailwind-merge, tailwindcss, tw-animate-css, typescript (Apache-2.0), vite, zustand; fonts @fontsource* (OFL-1.1). Dev-only: eslint and plugins, prettier, vitest, bun-types, @types/* (all MIT).

No GPL/AGPL/LGPL code is in the direct dependency set. Transitive dependencies were not audited one by one; `cargo deny` / `license-checker` can be added to CI when a release candidate is cut.

## 4. Open items before a public release

1. ~~Owner decision: which Bible texts ship in the installer.~~ Decided 2026-10-21 (issue #33): as upstream, on the owner's stated rights; see §2 for the record.
2. Add the openbible.info and NDI® notices to the installer's licence screen (About has them).
3. Add an automated licence check (`cargo deny check licenses`, `bunx license-checker --production`) to the release workflow, with an allow-list matching this document.
4. Keep this file current: any new dependency or bundled asset gets a row here in the same PR.

- `tauri-plugin-opener` 2 (Rust) / `@tauri-apps/plugin-opener` (JS): MIT OR Apache-2.0. Opens a song attachment in the computer's own viewer; scoped to the media folder.
