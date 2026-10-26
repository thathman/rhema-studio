# Rhema Studio brand asset map

The owner-supplied four-product pack in `brand/` is the source of truth. Keep its source files unchanged. `brand/ASSET-MANIFEST.json` records the SHA-256 hashes; `src/lib/brand-files.test.ts` checks every source file and the platform copies listed below.

| Surface | Source asset | Consumer and treatment |
| --- | --- | --- |
| Studio startup/loading screen | `brand/02_Product_Logos/Rhema-Studio-Dark-Text.png` and `Rhema-Studio-Light-Text.png` | `index.html`; light and dark page variants |
| Studio Setup and expanded sidebar | The same Studio dark/light wordmarks | `src/components/product-lockup.tsx`; `setup-wizard.tsx` and `shell/sidebar.tsx` |
| Studio compact sidebar, browser tab and desktop launcher | Master mark; size-specific Windows, macOS and Android launcher files | `BrandMark`, `public/rhema.svg`, and `src-tauri/icons/`; the compact rail uses the mark alone |
| Standalone Rhema Studio Companion | Companion dark/light wordmarks when paired; master mark for the installed app icon | Shared Companion screen in `src/studio/companion/companion-screen.tsx`; `companion-app/src-tauri/icons/` |
| Embedded OBS-only Companion view | Camera glyph | The local, unpaired OBS-only view stays compact; it does not use the standalone Companion lockup |
| Google TV Receiver | Receiver light wordmark, flat 16:9 Receiver banner, Android launcher icon | `android-tv/res/drawable-nodpi/receiver_logo.png`, `drawable-xhdpi/banner.png`, and `drawable-nodpi/icon.png` |
| Rhema Studio Cam | Cam light wordmark and the supplied adaptive launcher foreground/background | `android-camera/res/drawable-nodpi/cam_wordmark.png`, `ic_launcher_fg.png`, and `ic_launcher_bg.png`; the full-screen viewfinder stays clear |
| Phone camera and remote-control pages | Reversed light master mark | Inline SVG paths in `src-tauri/crates/api/src/camera.html` and `remote.html` |
| Public website | Studio light/dark wordmarks and master mark | `web/public/brand/` and `web/app/`; this is source integration only, not a deployment |

The pack does not contain photographs, video footage, or interface font files. The wordmark SVGs retain editable text with Inter/Arial fallback; interface fonts are supplied by the app dependencies. Keep the font-serving allowance in both Vite configurations so a linked worktree can load those fonts during local development.

Presentation slides, lower thirds and service themes use the church's selected design. App logos and launcher icons are not automatically placed on congregation or OBS output.
