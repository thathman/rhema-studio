# Rhema Studio — branding and the required attribution

**Rhema Studio** is the product, developed and maintained by **Rhema Studio contributors** at
[thathman/rhema-studio](https://github.com/thathman/rhema-studio). The family: **Rhema Studio** (the
desktop app and every operator screen), **Rhema Studio Receiver** (Google TV), **Rhema Studio Cam**
(Android camera) and **Rhema Studio Companion** (companion / remote control).

## The original project (kept)

Rhema Studio is built on the original [Rhema by OpenBezal](https://github.com/openbezal/rhema) (MIT).
Rhema Studio itself is GPL-3.0-or-later (owner decision with legal sign-off, 29 October 2026). The
upstream **Copyright (c) 2025 OpenBezal** and the MIT permission notice stay, word for word, inside the
root [LICENSE](LICENSE) and in `data/INSTALLER-LICENSE.txt`, and ship with the app
(`licenses/LICENSE.txt`). The About panel (Settings → Help, and the macOS app menu's About) says
"Built on Rhema by OpenBezal (MIT licence, © 2025 OpenBezal)". Renaming the product does not transfer
ownership of the upstream code. A test (`src/lib/brand-files.test.ts`) fails if the LICENSE text or the
About credit goes missing.

Other notices stay separate: Bible translations (Open Yoruba Contemporary Bible, Biblica), cross-references,
NDI, fonts, MediaMTX and the JavaScript/Rust dependencies keep their own terms. See
[docs/LICENSES.md](docs/LICENSES.md). Do not remove a notice to make branding uniform.

## The logo

Only the owner's approved pack, byte for byte: [`brand/`](brand/README.md) (black or white rounded square
with the approved R and the opening quotation marks). No recolouring (no teal mark), no redrawing.

## What stays as it was, for compatibility

- The app identifier `com.openbezal.rhema`, its data and WebKit folders, and the keychain entries.
- The product name in `tauri.conf.json` ("Rhema"): it names `Rhema.app`, its binary path (AI assistants
  are set up with `/Applications/Rhema.app/Contents/MacOS/Rhema --mcp`), the Windows install folder and
  registry key, and the Linux package. The macOS menu bar and app menu say Rhema Studio (`bundleName`).
- Android packages `com.openbezal.rhema.receiver` and `com.openbezal.rhema.camera`, the `rhema-camera://`
  link, the companion's `com.openbezal.rhema.companion`.
- Crate and binary names, mDNS service types (`_rhema-tv._tcp`, `_rhema-host._tcp`), the " · Rhema"
  suffix a TV announces and "Rhema · <computer>" a host announces, the `X-Rhema-Key` header, `/rhema/…`
  OSC addresses, HTTP API paths, file formats, environment variables.
- NDI sender names and ready-made feed names ("Rhema Bible | Full", "Rhema Output"…), OBS input names
  ("Pulpit (Rhema camera)") and output window titles: OBS scenes and captures find them by name.

No company, domain, e-mail or social account is claimed for Rhema Studio until the owner supplies one.
