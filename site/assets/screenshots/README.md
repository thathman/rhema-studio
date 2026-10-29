# Public app screenshot provenance

These screenshots are unaltered 1440 × 900 viewport captures of the Rhema Studio frontend from source commit `4ed4c6066429e274c5d7b38b9f221b96ac2c0f71`, captured on October 29, 2026.

The app was started with the repository's Vite development server and its browser-shim mode. Every capture visibly includes the app's `SIMULATED · No native host · sample data` status. The shim supplies sample Bible/song/service data and keeps edits in memory; these screenshots are not from a Tauri desktop host.

| File | Captured view | Sample state and limit |
| --- | --- | --- |
| `home.png` | Home | No service open; readiness and attention content is the current frontend's sample state. |
| `prepare-preview.png` | Prepare | A locally created synthetic service with Psalm 23:1 selected. Preview says “Only you see this.” The service was not persisted by a native host. |
| `live-preview-program.png` | Live | The same sample verse is in private Preview; Program is empty and the screen status says no output is on a screen. No receiver is attached. |
| `library-songs.png` | Library | Synthetic Amazing Grace and Blessed Assurance examples. This is not a church's saved or licensed content set. |
| `design-themes.png` | Design → Themes | Built-in theme editor with synthetic bilingual sample text. This is not the embedded Avnac slide editor. |

No screenshot is published for History because the browser-shim route failed to render when its recent-run sample data was null. The current site also has no browser role or device screenshots: those connected views are not ready for honest capture here, and the available emulator sessions are not evidence of physical-device acceptance.

These files show current frontend layouts only. They do not establish native saving/reopening, role authorization on a connected host, screen rendering, output acknowledgements, audio/video recording, crash recovery, offline acceptance, or physical device compatibility. Do not remove, crop away, or cover the visible simulation status in these public captures.
