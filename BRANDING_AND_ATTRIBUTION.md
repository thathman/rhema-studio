# Rhema Studio — Branding and required attribution

**Rhema Studio** is the present product identity, developed and maintained by **Rhema Studio contributors** at [thathman/rhema-studio](https://github.com/thathman/rhema-studio).

## Original project acknowledgement (retained)

Rhema Studio is based on the original [Rhema project by OpenBezal](https://github.com/openbezal/rhema) (MIT). The upstream **Copyright (c) 2025 OpenBezal** text remains in the root [LICENSE](LICENSE) and installer notices. The full MIT licence/copyright notice must accompany copies or substantial portions of the licensed code. Renaming the product does not transfer ownership of the upstream source.

Other legal notices stay separate: Bible translations, Open Yoruba Contemporary Bible (Biblica), cross-references, NDI, fonts, MediaMTX and JavaScript/Rust dependencies are governed by their respective rights. See [docs/LICENSES.md](docs/LICENSES.md), `data/INSTALLER-LICENSE.txt` and third-party notices. Do not remove notices simply to make branding uniform.

## Visible identity

- Product name, public documentation, marketing copy and app-facing header: **Rhema Studio**.
- Current maintainers/development: **Rhema Studio contributors**.
- Original engine credit: **Based on Rhema by OpenBezal (MIT)**, in About/Notices and legal documentation.
- Selected logo: exact approved rounded-square R SVG paths, with deep teal surround and ivory R/quote detail.
- Project repository: https://github.com/thathman/rhema-studio.

A future *legal copyright holder* for Rhema Studio additions can be added once its exact authorized entity/person is confirmed. No company ownership, external domain, email, Twitter, LinkedIn, or new trademark registration is being inferred.

## Release and compatibility cautions

- Keep the existing internal Tauri bundle identifier `com.openbezal.rhema` for now **for backwards compatibility only**, not as a maintainer claim. A future identifier change requires explicit installed-data and keychain migration tests (and assessment of side-by-side upstream installs).
- Keep internal Rust crate names/compatibility APIs until tested migrations exist.
- The SVG mark has replaced sidebar/web favicon and repository icon in this source change. **Native `.ico`, `.icns` and bundled PNG app icons are still old** and must be regenerated from the exact selected vector before a branded release. Installer names, signatures and app icons require hardware verification.
- The website public domain and social/contact accounts are not yet provided. Website config uses the repository URL as a provisional project location rather than claiming the upstream domain. Only publish once authorized real destinations exist.
- Current Rhema Studio release URLs must never redirect users to old upstream installation files as though those installers were branded Rhema Studio.

This document is a brand attribution policy, **not** a replacement for the MIT licence or third-party notices.
