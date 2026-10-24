# Rhema Studio brand files

These are the owner's approved logo files (the "LOGOS ONLY" pack), copied **byte for byte**. Every file
here matches its SHA-256 in `pack-manifest.json` (the pack's own manifest), and `src/lib/brand-files.test.ts`
checks that, and that each platform copy (Tauri icons, Android resources, `public/rhema.svg`) is the same
bytes as its source here. Only the files the apps and docs use were copied.

## The family

| Product | Where it runs | Name on screen |
|---|---|---|
| Rhema Studio | the desktop app and every operator screen | **Rhema Studio** |
| Rhema Studio Receiver | the Google TV app (`android-tv/`) | **Rhema Studio Receiver** |
| Rhema Studio Cam | the Android phone camera app (`android-camera/`) | **Rhema Studio Cam** |
| Rhema Studio Companion | the companion / remote control app (`companion-app/`) | **Rhema Studio Companion** |

The mark is a black rounded square with the approved R and the opening double quotation marks; the reversed
version is a white square. In the app the mark is black or white only: no teal, no tint, no gradient.

## Rules

- Use these files as they are. Never redraw, recolour, re-letter, crop into the mark or add effects.
  Scaling a PNG down for a size the pack does not have is fine (the Tauri icon sizes the pack lacks were
  made by `npx tauri icon` from `Rhema-Studio-Mark-1024.png`).
- On a light surface use the black mark; on a dark one the reversed (light) mark.
- The pack's SVG lockups set the words in Inter as `<text>`; Rhema Studio does not depend on that font.
  In the app the words are written in the app's own font beside the mark SVG; elsewhere use the PNG lockups.
- Keep the required credit wherever the product is described: **Built on Rhema by OpenBezal (MIT licence,
  © 2025 OpenBezal)**. `LICENSE` keeps the original MIT text and copyright. The current maintainers are
  **Rhema Studio contributors**.
- Identifiers stay as they were (`com.openbezal.rhema*`, crate and binary names, `rhema-camera://`,
  mDNS service types, the `X-Rhema-Key` header): installed apps update in place and saved settings load.

## Files

| File | Used for |
|---|---|
| `01_Master_Mark/Rhema-Studio-Mark-1024.png` | Source for the other Tauri icon sizes (`npx tauri icon`): Windows Store, iOS/Android folders. |
| `01_Master_Mark/Rhema-Studio-Mark-128.png` | src-tauri/icons/128x128.png. |
| `01_Master_Mark/Rhema-Studio-Mark-16.png` | 16 px mark (small favicons). |
| `01_Master_Mark/Rhema-Studio-Mark-256.png` | src-tauri/icons/128x128@2x.png. |
| `01_Master_Mark/Rhema-Studio-Mark-32.png` | src-tauri/icons/32x32.png. |
| `01_Master_Mark/Rhema-Studio-Mark-512.png` | src-tauri/icons/icon.png. |
| `01_Master_Mark/Rhema-Studio-Mark-64.png` | src-tauri/icons/64x64.png. |
| `01_Master_Mark/Rhema-Studio-Mark-Black.svg` | The mark: black rounded square, white R and opening quotes. Light surfaces; favicons of the app, feed and phone pages; public/rhema.svg is a copy. |
| `01_Master_Mark/Rhema-Studio-Mark-Light-256.png` | Reversed mark, 256 px (docs, previews). |
| `01_Master_Mark/Rhema-Studio-Mark-Light.svg` | The reversed mark: white square, black R. Dark surfaces: the ink sidebar, the dark About and setup screens, the phone remote and camera pages (inlined as is). |
| `02_Product_Logos/Rhema-Studio-Cam-Dark-Text.png` | Rhema Studio Cam lockup, dark words. |
| `02_Product_Logos/Rhema-Studio-Cam-White-Text.png` | Rhema Studio Cam lockup, white words. |
| `02_Product_Logos/Rhema-Studio-Companion-Dark-Text.png` | Rhema Studio Companion lockup, dark words. |
| `02_Product_Logos/Rhema-Studio-Companion-White-Text.png` | Rhema Studio Companion lockup, white words. |
| `02_Product_Logos/Rhema-Studio-Dark-Text.png` | Rhema Studio lockup, dark words (light backgrounds): README, docs. |
| `02_Product_Logos/Rhema-Studio-Receiver-Dark-Text.png` | Rhema Studio Receiver lockup, dark words. |
| `02_Product_Logos/Rhema-Studio-Receiver-White-Text.png` | Rhema Studio Receiver lockup, white words: the TV app's idle/code screen (android-tv/res/drawable-nodpi/receiver_logo.png). |
| `02_Product_Logos/Rhema-Studio-White-Text.png` | Rhema Studio lockup, white words (dark backgrounds). |
| `03_Google_TV/Rhema-Studio-Receiver-TV-1920x1080.png` | Google TV landscape logo, full HD (store listing, previews). |
| `03_Google_TV/Rhema-Studio-Receiver-TV-320x180.png` | Google TV launcher banner (android-tv/res/drawable-xhdpi/banner.png). |
| `03_Google_TV/Rhema-Studio-Receiver-TV-640x360.png` | Google TV landscape logo, 640×360 (previews). |
| `04_Launcher_Assets/Android-Adaptive-Foreground-1024.png` | Android adaptive icon foreground: Rhema Studio Cam (android-camera/res/drawable-nodpi/ic_launcher_fg.png, on white). |
| `04_Launcher_Assets/Android-Cam-Launcher-512.png` | Cam launcher, 512 px (previews; the app uses the adaptive foreground). |
| `04_Launcher_Assets/Companion-Launcher-512.png` | Companion launcher, 512 px, for companion-app/ (built on its own branch). |
| `04_Launcher_Assets/Desktop-Launcher-512.png` | Desktop launcher, 512 px. |
| `04_Launcher_Assets/Receiver-Square-Launcher-512.png` | Receiver square launcher icon (android-tv/res/drawable-nodpi/icon.png). |
| `04_Launcher_Assets/Rhema-Studio-icon.icns` | macOS app icon (src-tauri/icons/icon.icns). |
| `04_Launcher_Assets/Rhema-Studio-icon.ico` | Windows app icon (src-tauri/icons/icon.ico). |

A preview of the whole family is in [`docs/brand/preview.html`](../docs/brand/preview.html).
