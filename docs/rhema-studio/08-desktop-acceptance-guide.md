# 08 — Desktop Acceptance Guide (integration gate)

Status of this guide: **a manual checklist**. Every step below is to be performed by a
person on a real desktop build. Nothing here has been marked as passed by automation.
Section 11 lists exactly what *has* been verified by automation and what has not.

Build under test: the stacked branches at the heads recorded in
`09-integration-merge-plan.md`. Run from source with `bun tauri dev`, or from the
packaged installer (Windows: artifact of the *Build Windows Installer* workflow).

Record results as a table: step id, pass/fail, build SHA, OS, date, tester, notes.

## 0. Before you start

| Id | Step | Expected |
|---|---|---|
| 0.1 | Launch the app on a machine that has never run it (or move `studio.db` aside). | Window title is "Rhema Studio". Home workspace opens. No crash dialog. |
| 0.2 | Open More → About. | Shows version, OYCB attribution: "The original work by Biblica, Inc. is available for free at www.biblica.com and open.bible", CC BY-SA 4.0 and that changes were made. |
| 0.3 | Look in the app data folder (`~/Library/Application Support/com.openbezal.rhema/` on macOS, `%APPDATA%\com.openbezal.rhema\` on Windows). | `studio.db` exists after first launch. No `.bak` on a fresh install. |

## 1. English and Yoruba Bible presentation

| Id | Step | Expected |
|---|---|---|
| 1.1 | Home → readiness list. | "Bible library loaded (N translations)" with N ≥ 2 and OYCB listed in Settings → Bible. |
| 1.2 | Present → Quick find: type `John 3:16`, press Enter. | KJV text appears in preview. Not live yet. |
| 1.3 | Quick find: type `1 Cor 13:4`, `2 Sam 7:12`, `3 John 1:2`. | Numbered-prefix books resolve. No "not found". |
| 1.4 | Quick find: type `Johanu 3:16` with OYCB active (Settings → Bible → primary = OYCB). | Yoruba text with diacritics renders correctly (ẹ, ọ, ṣ, tone marks). |
| 1.5 | Switch primary back to KJV. Re-run 1.2. | English again; no stale Yoruba text in preview. |
| 1.6 | Present a verse that does not exist in a translation (e.g. a verse past the end of a chapter). | Live output keeps the previous verse; nothing blank is shown. |

## 2. Dual-language themes

| Id | Step | Expected |
|---|---|---|
| 2.1 | Settings → Bible: primary KJV, secondary OYCB. Outputs → pick a dual-language theme. Show a verse live. | Both languages on the output; secondary styled by the theme's secondary text style. |
| 2.2 | Set secondary to "none". Show the same verse. | Single language; layout does not leave an empty gap. |
| 2.3 | Set primary OYCB, secondary KJV. | Order flips: Yoruba first. |
| 2.4 | Open the theme designer, edit the secondary text size, save, show live. | Change is visible on the output without restart. |

## 3. Home, Prepare and Present workspaces

| Id | Step | Expected |
|---|---|---|
| 3.1 | Press ⌘1/⌘2/⌘3/⌘4 (Ctrl on Windows). | Home, Prepare, Present, More. Rail highlights the active one. |
| 3.2 | Quit and relaunch. | Last workspace and Standard/Production choice are restored. |
| 3.3 | Home: with no output on a screen, read the readiness list. | "No output is on a screen yet" with an "Open outputs" button that opens the Outputs dialog. |
| 3.4 | Prepare: Quick find a verse → Add. Add three more. Drag to reorder. Remove one. | Rundown shows items in the order you set; new items append at the end, not the top. |
| 3.5 | Present → Standard view: buttons Previous, Next, Show live, Clear, Restore are visible with their hints. | Buttons disabled when there is nothing to act on (e.g. Clear while nothing is live). |
| 3.6 | Present → Production view. | The full dashboard (transcript, detections, queue, live output panel) appears. Switching back to Standard keeps the rundown. |
| 3.7 | Start the tutorial from More. | Tutorial switches to Present → Production and the overlay does not block clicks after it ends. |

## 4. Save, reopen, restart

| Id | Step | Expected |
|---|---|---|
| 4.1 | Prepare: with 4 verses on screen, New service "Sunday", date set → Create. | Toast "Service created and saved". Save button reads "Saved". |
| 4.2 | Add a verse. | Save button reads "Save"; the service selector is disabled with the tooltip "Save or discard changes before switching". |
| 4.3 | Remove that verse again. | Save button returns to "Saved" (dirty cleared because the rundown matches what is saved). |
| 4.4 | Add a verse, press Save. | "Service saved". |
| 4.5 | Quit the app fully. Relaunch. | Home lists "Sunday". The last service is reopened into an empty rundown with the same items in the same order. Text is filled in for preview. |
| 4.6 | With primary = OYCB, create service "Yoruba evening" with two verses, save. Switch primary to KJV. Reopen "Yoruba evening". | Service bar shows "Saved as OYCB · shows in OYCB". Preview text in the rundown is Yoruba. Press Save after adding an English verse: reopen shows the two original items still marked OYCB and the new one KJV. |
| 4.7 | Set secondary = OYCB, add a verse to a service and save. Reopen. | Item keeps secondary OYCB (visible in the item tooltip or by re-saving and checking the database with `sqlite3 studio.db "select reference, translation, secondary_translation from program_items"`). |
| 4.8 | Make a change, then try to open another service / New service / Delete. | Each refuses with "Save or discard your changes first"; nothing is lost. Close (X) asks to discard. |
| 4.9 | Open the same service in two running instances (copy the app, or run `bun tauri dev` twice with the same data dir). Save in A, then save in B. | B gets "Not saved: this service changed elsewhere" with a Reload button. A's data is intact. |
| 4.10 | Delete a service. | Removed from Home and the selector; the rundown on screen stays until cleared. |

## 5. Preview versus Live safety

| Id | Step | Expected |
|---|---|---|
| 5.0a | **Translation consistency.** Open "Yoruba evening" (saved as OYCB) with primary = KJV. Click an item (preview). Press Show live. | Preview is labelled OYCB and shows Yoruba. Live shows Yoruba, not English. The Present header chip reads "Saved translations". |
| 5.0b | Press Next through the service. Then Quick find `Romans 8:28` (spontaneous), Enter, Show live. | Service items go live in OYCB. The spontaneous verse goes live in KJV, matching its preview label. |
| 5.0c | Click the "Saved translations" chip to turn on the override. Press Next. | Chip reads "Override: KJV"; the service item now goes live in KJV; the service bar says "override: shows in KJV". Click again to turn it off. |
| 5.0d | Open a service whose items were saved with a translation not installed on this machine (copy a `studio.db` from a machine with NIV, or edit `program_items.translation` to `NIV` with sqlite3). Press Next. | Nothing goes live. The Present header shows "John 3:16 not shown: it was saved for NIV, which is not installed…". With the override on, it goes live in the active translation. |
| 5.0e | **Atomic go-live.** Show a verse live. Press Clear. Press Next. Watch the output closely (record it with OBS at 60 fps if possible). | The output stays blank until the new verse is ready, then shows the new verse. The old verse never flashes first. |
| 5.0f | Press Clear. Quit the app, make `rhema.db` unreadable or rename it, relaunch, open the service, press Next. | Output stays cleared; the header warning says the verse was not shown. Restore still brings back the last verse that was live before Clear. |
| 5.0g | Send 10 OSC `/rhema/next` messages in under a second. | Output ends on the 10th item's verse; no earlier verse appears after it. Same with 10 HTTP `next` commands. |
| 5.0h | Press Next, then Esc within 100 ms (or send `/rhema/next` then `/rhema/hide`). | Output stays cleared; the verse that was loading does not appear afterwards. |
| 5.1 | Output on air. Quick find a verse, press Enter (preview). | Output unchanged. |
| 5.2 | Press Show live. | Output shows the preview verse. |
| 5.3 | Press Esc (Clear). | Output blank/background only. Restore enabled. |
| 5.4 | Press Shift+Esc (Restore). | Previous verse returns. |
| 5.5 | Click into Quick find, type a few letters, then press ←, → and Esc while the field still has focus. | Nothing presents, clears, or navigates: shortcuts are ignored while typing. |
| 5.6 | Toggle On air off from the transport bar, then press Next. | Output stays off; the app state advances only when On air is on again. |

## 6. Verse detection while navigating

| Id | Step | Expected |
|---|---|---|
| 6.1 | Production view: start Listening (local Whisper). Read "John chapter three verse sixteen" aloud. | Detection appears in the Detections panel within a few seconds. Auto off: preview updates, live does not. |
| 6.2 | Turn Auto on, say "Romans eight twenty-eight". | Goes live automatically. |
| 6.3 | While Listening, use Next/Prev in the Standard view and switch Home ↔ Present. | Detections keep arriving; no duplicate listeners (each detection appears once), no console errors about listeners after switching workspaces. |
| 6.4 | Say "Psalm twenty-three" (chapter only), then "verse four". | Queue item for Psalm 23:1 is refined to 23:4 rather than duplicated. |
| 6.5 | With OYCB primary and speech language Yoruba (PR #4 only), say a reference in Yoruba. | Detection works or fails gracefully: no crash, a clear "no match" state. |

## 7. OBS and NDI

| Id | Step | Expected |
|---|---|---|
| 7.1 | Outputs → add an NDI output, name "Rhema", on air. In OBS add an NDI source. | "Rhema" appears in OBS's NDI source list; verse changes appear within a second. |
| 7.2 | Switch theme to one with a transparent background. | OBS shows alpha (key) correctly per the output's alpha mode. |
| 7.3 | Change resolution/frame rate on the NDI output while on air. | Sender restarts cleanly; OBS reconnects. |
| 7.4 | Display output on a second monitor: on air, then unplug/replug the monitor. | Output window recovers or is clearly reported as off in the Outputs dialog; no crash. |
| 7.5 | OBS window capture of a display output window. | Full-screen window with no chrome. |

## 8. Remote actions (OSC and HTTP)

Enable both in Settings → Remote and note the ports there.

| Id | Step | Expected |
|---|---|---|
| 8.1 | `curl http://127.0.0.1:<port>/api/v1/health` | 200 OK. |
| 8.2 | `curl http://127.0.0.1:<port>/api/v1/status` | JSON with live state. |
| 8.3 | `curl -X POST http://127.0.0.1:<port>/api/v1/command -H 'content-type: application/json' -d '{"command":"next"}'` | Rundown advances and output updates. Same for `prev`, `show`, `hide`, `send_to_live`, `bible_next`, `bible_prev`, `add_to_queue`. |
| 8.4 | OSC: send `/rhema/next`, `/rhema/prev`, `/rhema/show`, `/rhema/hide`, `/rhema/on_air` (bool), `/rhema/theme` (string). | Each acts exactly as the matching button. |
| 8.5 | Send `/rhema/next` from a remote while the operator is typing in Quick find. | Remote action still works (keyboard guard applies to keys, not remote). |
| 8.6 | Send a malformed command. | 4xx with a message; app unaffected. |

## 9. Database error recovery

| Id | Step | Expected |
|---|---|---|
| 9.1 | Quit. Make `studio.db` read-only (`chmod 444`). Launch. | App starts. Home shows services (reads work). Save shows "Could not save service" with a database message. Nothing else breaks; presenting still works. Restore permissions. |
| 9.2 | Quit. Replace `studio.db` with a text file. Launch. | App starts; log says "Content database unavailable". Service bar shows "Content database is not available". Quick find and presenting work. Replace the file with the real one; relaunch restores services. |
| 9.3 | Quit. Copy `studio.db` from a pre-0002 build (or recreate with only migration 0001 using the Rust test helper). Launch. | `studio.db.before-0002.bak` is created next to it; services open; a second launch creates no new `.bak`. |
| 9.4 | Delete `studio.db` while the app is running, then save. | Error toast; the rundown stays on screen; relaunch creates a fresh database. |
| 9.5 | Restore from `.bak`: quit, copy the `.bak` over `studio.db`, launch. | Services from the backup appear. |

| 9.4 | More → Library → Back up now… Save to the Desktop. Add a service, save it. More → Library → Restore from a backup… → pick the Desktop file. | Confirmation first; after restore the added service is gone, the rundown is cleared, the song list reloads; toast names the snapshot `studio.db.before-restore-<stamp>.bak`. |
| 9.5 | Restore from a text file renamed `.db`, and from a non-Rhema SQLite file. | "Nothing was changed" with a reason; services and songs still there. |
| 9.6 | Open a service, change something, do not save. Try Restore. | Button disabled with "save or close the open service first". |

## 10. Windows installer (when the artifact exists)

| Id | Step | Expected |
|---|---|---|
| 10.1 | Run the `.exe` from the workflow artifact on a clean Windows 10/11 VM. | Installs without a SmartScreen hard block (unsigned: "More info → Run anyway" is expected). |
| 10.2 | Launch. | App starts; Home lists translations including OYCB. |
| 10.3 | Look in the install folder. | `resources\rhema.db`, `resources\licenses\YORUBA-OYCB-LICENSE.md`, `resources\sdk\ndi\windows\Processing.NDI.Lib.x64.dll` present. |
| 10.4 | Run sections 1, 3, 4, 7 and 8 on Windows. | As above. Note Yoruba font rendering specifically (Segoe UI covers Yoruba diacritics; check tone marks). |

## 10a. Songs and hymnbooks (Milestone 2B)

| # | Do | Expect |
|---|---|---|
| 10a.1 | Prepare → Songs → New song. Paste a printed hymn's words (blank line between verses, "Chorus" on its own line). Click Make sections. | Sections appear as Verse 1, Chorus, Verse 2… Relabel from the dropdown. Under two minutes for a volunteer who has never used the app. |
| 10a.2 | Add Yorùbá words to Verse 1 only. Save. | Song shows EN and YO badges in the library. |
| 10a.3 | Hymnbook numbers → New hymnbook (code SSS) → add number 245. Save. Quick find "245" and "SSS 245" in Present. | Both find the song. "1 John 1:1" still finds the verse. |
| 10a.4 | Change the order: drag a chip; then focus a chip and use ← → and Delete. Save, reopen the editor. | Order persists; drag and keyboard both reorder; removing a chip never deletes words. |
| 10a.5 | Add the song to a service between two verses. Save the service, restart the app, reopen. | Song item back with its languages and order. |
| 10a.6 | Present (Standard): Next from the verse into the song, through every slide, into the next verse. Repeat with OSC `/rhema/next`. | Next steps slides, then items; "Next: Chorus" hint; Previous enters the song at its last slide. |
| 10a.7 | Song with EN+YO on a dual-language theme. | Both languages on one slide, aligned per section; a section missing YO shows a warning chip and EN only. |
| 10a.8 | Click a slide in the rundown (preview), then Show live. Clear, then Restore. | Live matches preview exactly; Clear keeps the slide for Restore; no stale frame. |
| 10a.9 | Set the song's licence to CCLI with a number; present. OBS with a transparent theme. | Copyright line under the words; keys correctly in OBS. |
| 10a.10 | Delete a song that is in a saved service. | Refused, naming the service. After removing the item and saving, delete succeeds. |

Browser check performed on the dev server (not the desktop app, songs-editor PR): paste → sections, keyboard reorder, save, library search, add to service, bilingual preview, Next through slides, missing-language warning, footer, Clear/Restore all behaved as specified. Drag reorder could not be exercised by the automated browser (synthetic pointer); verify by hand in 10a.4.

## 11. What automation has and has not verified

Verified by automation on the exact heads in `09-integration-merge-plan.md`:

- Frontend unit tests (275), including service store round trips: bilingual
  open/save/reopen under a different active translation, uninstalled translation
  warning, conflict handling, save races, unsaved-change protection.
- Rust content crate tests (15) on real temporary files: reopen, backup then migrate,
  rollback on failed save, two-handle conflict, corrupt file refused.
- TypeScript build, lint on Studio paths, `cargo check` and clippy on Linux.
- A real desktop launch on an Intel Mac: database created at the real app-data path,
  migrations applied once, restart does not re-migrate, integrity check passes.

Not verified by automation (needs the checklist above): every interactive step in
sections 1–10a, NDI/OBS, OSC/HTTP against a running app, Yoruba speech, Windows
launch. The Windows artifact's *contents* can be inspected without Windows (see the
report), but launching it cannot.
