# Rhema Studio brand assets

This directory contains the owner's final logo pack from `Rhema_Studio_Four_Product_Logos_FINAL.zip`. The source pack's `README.md` and `ASSET-MANIFEST.json` are preserved as `ASSET-README.md` and `ASSET-MANIFEST.json`; `src/lib/brand-files.test.ts` verifies every copied pack asset against its SHA-256 manifest entry.

`ASSET-README.md` is the source ZIP's original note, written before these files were wired into Rhema Studio. This README is the current application usage map.

The master mark keeps the supplied R and its upper-left bulge, with the two radio curves inside that bulge. It has no quotation marks. Use the SVG and PNG files as supplied; do not redraw, recolor, crop, or add effects.

## Product uses

| Surface | Visible artwork | Source file in this repository | Pack asset / platform copy |
| --- | --- | --- | --- |
| Studio desktop shell and setup | Light/dark master mark | `src/components/brand-mark.tsx`, used by `src/studio/shell/sidebar.tsx` and `src/studio/setup/setup-wizard.tsx` | `01_Master_Mark/Rhema-Studio-Master-Mark.svg` and `Rhema-Studio-Mark-Light.svg` |
| Studio loading screen and browser tab | Light/dark master mark; tab icon uses the mark | `index.html` | Same master-mark SVGs |
| Studio macOS and Windows launchers | App icon | `src-tauri/icons/icon.icns`, `icon.ico`, and generated size variants | `04_Launcher_Icons/Rhema-Studio-macOS.icns`, `Rhema-Studio-Windows.ico`; master-mark sizes |
| Standalone Companion desktop app | Master mark in the header; product name beside it | `src/studio/companion/companion-screen.tsx` (`secure` mode) and `companion.html` | Master-mark SVGs; `companion-app/src-tauri/icons/` |
| Companion macOS and Windows launchers | App icon | `companion-app/src-tauri/icons/` | Pack's master-mark sizes, `.icns`, and `.ico` |
| Studio's embedded OBS Companion view | Camera glyph, intentionally labeled “OBS companion” | `src/studio/companion/companion-screen.tsx` (non-secure mode) | Not a product-logo placement |
| Google TV Receiver launcher and connection screen | Android launcher square and landscape Receiver lockup | `android-tv/res/drawable-nodpi/icon.png`, `receiver_logo.png` | `04_Launcher_Icons/Rhema-Studio-Android-512.png`; `02_Product_Logos/Rhema-Studio-Receiver-Light-Text.png` |
| Google TV Receiver banner | Dark landscape lockup | `android-tv/res/drawable-xhdpi/banner.png` | `03_Google_TV/Rhema-Studio-Receiver-Google-TV-Dark-320x180.png` |
| Android Cam launcher | Adaptive foreground and background | `android-camera/res/drawable-nodpi/ic_launcher_fg.png`, `ic_launcher_bg.png` | `04_Launcher_Icons/Rhema-Studio-Android-Adaptive-Foreground-432.png` and `...Background-432.png` |
| Phone camera page and paired remote page | Inline light mark for dark phone UI | `src-tauri/crates/api/src/camera.html` and `remote.html` | Paths from `01_Master_Mark/Rhema-Studio-Mark-Light.svg`, embedded unchanged |
| Studio browser feed | Master mark as browser tab icon | `feed.html` | `01_Master_Mark/Rhema-Studio-Master-Mark.svg` |
| Website icon and site mark | Master mark | `web/app/icon.svg`, `web/public/brand/rhema-mark.svg` | `01_Master_Mark/Rhema-Studio-Master-Mark.svg` |
| Repository README and brand preview | Full Studio and product lockups for documentation only | `README.md`, `docs/brand/preview.html` | `02_Product_Logos/` and `03_Google_TV/` |

The pack also includes dark/light SVG and PNG product lockups for Studio, Receiver, Cam and Companion in `brand/02_Product_Logos/`, plus dark/light SVG and PNG Google TV artwork at four sizes in `brand/03_Google_TV/`. The 320×180 dark TV file is the Receiver launcher banner; the other supplied variants remain approved source art. The website header uses the master mark with a text wordmark in `web/app/_components/ui/rhema-logo.tsx`; the website icon uses the master mark. Companion currently uses the mark with its product name as text rather than the supplied full lockup. Cam's Android adaptive icon uses its supplied foreground/background; its camera page uses the inline mark, and it has no branded page header. Tauri-generated size variants not supplied directly by the pack are generated from the supplied mark. Pack contents and copied platform assets are checked by `src/lib/brand-files.test.ts`. Product names, package identifiers, and the OpenBezal MIT credit are unchanged.

## Interface fonts and local development

The brand ZIP contains logo artwork; it does not contain the interface fonts. Rhema Studio imports Geist, IBM Plex Sans, Source Serif 4, Geist Mono and Inter from `@fontsource` in `src/index.css`; Vite bundles these into `build/assets` for production. In linked worktrees that share `node_modules` through a symlink, Vite must allow the dependency directory's real path for the development app and Companion. Without that, font requests return 403 and the UI falls back to system fonts, which makes the page look off-brand even while the logo files are correct.
