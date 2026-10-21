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
| 8.3 | `curl -X POST http://127.0.0.1:<port>/api/v1/command -H 'content-type: application/json' -d '{"command":"next"}'` | Rundown advances and output updates. Same for `prev`, `show`, `hide`, `send_to_live`, `bible_next`, `bible_prev`, `add_to_queue`, `verse_next`, `verse_prev`, and `{"command":"macro","value":"service-start"}` / OSC `/rhema/macro "offering"`. |
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

## 10b. Custom slides (Milestone 2C)

| # | Do | Expect |
|---|---|---|
| 10b.1 | Prepare → Slides. Type a title and three lines. | Preview updates as you type; Add to service puts it at the end of the rundown. |
| 10b.2 | Click the slide in the rundown; edit the text in place. Save the service, restart, reopen. | Edits persist; the slide reopens with title and lines. |
| 10b.3 | Present: Next from a verse onto the slide and on to a song; Previous back. Two slides with the same title. | Each slide is its own step; LIVE marks the right one; "Next" marker follows. |
| 10b.4 | Preview a slide, Show live; Clear; Restore. | Live matches preview; Restore brings the slide back. |
| 10b.5 | Dual-language theme and a transparent OBS theme. | Title in the reference style, lines in the verse style; keys correctly. |

## 10c. Service builder (Milestone 2C)

| # | Do | Expect |
|---|---|---|
| 10c.1 | Prepare: drag a rundown row by its grip to a new place; then use the arrow buttons. | Both reorder; the service shows unsaved; Save persists the order. |
| 10c.2 | With a saved service open, click Copy, accept "(copy)". Change the copy, save. Reopen the original. | Original unchanged; both listed; the copy's items have their own identity (edits never cross). |
| 10c.3 | Try Copy with unsaved changes. | Disabled with "save or discard changes first". |

## 10d. Continue the reading (Verse + / Verse −)

| # | Do | Expect |
|---|---|---|
| 10d.1 | Present John 3:16 from a service item saved for OYCB while KJV is active. Press Shift+→ three times, then Shift+←. | 3:17, 3:18, 3:19 then 3:18, all in OYCB, each on air in one step. |
| 10d.2 | Present the last verse of a chapter; Verse +. Present 1:1 of a book; Verse −. Present the last verse of a book; Verse +. | Next chapter's first verse; a warning "starts at 1:1" with the output unchanged; a warning "ends at …" with the output unchanged. |
| 10d.3 | OSC `/rhema/verse_next` and HTTP `{"command":"verse_next"}`. | Same as the button. |
| 10d.4 | Clear, then Verse +. | Goes back on air with the next verse (Restore still brings the previous one). |

## 10e. Notes and readiness

| # | Do | Expect |
|---|---|---|
| 10e.1 | Prepare: select an item, type a note ("read slowly"). Save, restart, reopen. Present. | Note under the item in Present; never on the output; survives restart. |
| 10e.2 | Add a song to a service, save, then delete the song from the library on another copy of the database (or restore an older backup). Open Home. | Readiness warns "1 song in the service is not in the library" with an Open Prepare fix; the item is marked in the rundown. |

## 10f. Quick screens

| # | Do | Expect |
|---|---|---|
| 10f.1 | With a verse live, press Please stand, then Let us pray, then Back. | Each screen on air at once (no blank frame); Back returns the verse, on air. |
| 10f.2 | Clear, then Welcome, then Back. | Welcome on air; Back goes off air again with the verse kept for Restore. |
| 10f.3 | Please stand, then Next. | The next item goes live; Back is disabled (the operator moved on). |
| 10f.4 | Transparent OBS theme. | The quick screen text keys like a verse; the header chip reads "LIVE · Please stand". |
| 10f.5 | Set OYCB as the secondary Bible with a dual-language theme; press Please stand. | "Please stand" with "Ẹ jọ̀wọ́ ẹ dìde" under it in the secondary style; tone marks render. With KJV only, English alone. |

## 10g. Pictures (media library)

| # | Do | Expect |
|---|---|---|
| 10g.1 | Prepare → Pictures → Import pictures… pick two JPG/PNG files, one of them twice. | Thumbnails appear; the duplicate is reported "already here" and stored once; files are in `<app data>/media/` named by hash. |
| 10g.2 | Add a picture to the service, choose "Show it all". Save, restart, reopen. Present it with Next. | Full-frame picture on the output (letterboxed for "Show it all"); on air in one step; LIVE marks the item. |
| 10g.3 | Delete the media file from the folder by hand. Open Home, then try to present the item. | Library shows "missing"; presenting reports the missing file and leaves the output alone. |
| 10g.4 | Try to remove a picture that a saved service uses. | Refused, naming the service. |
| 10g.5 | NDI/OBS output with a picture live. | Receivers show the picture (not a flat frame) within a second. |
| 10g.6 | Prepare: select a verse item, choose a background picture. Present it; then a song with the same background. | Words over the picture in the theme's text box; both the main window and NDI show the picture under the text; preview matches live. |

## 10h. Service history

| # | Do | Expect |
|---|---|---|
| 10h.1 | Save a service three times with different items. Prepare → History. | Three versions, newest first, the top one marked current. |
| 10h.2 | Pick the oldest; read the summary; Restore. | "Brings back / Removes / moved" lines match; after restore the rundown is the old one and a new, fourth version exists. |
| 10h.3 | With a verse live, restore an older version. | The output does not change; only the rundown does. |
| 10h.4 | Edit without saving, open History. | Restore disabled with "save or discard first". |

## 10i. Service timer

| # | Do | Expect |
|---|---|---|
| 10i.1 | Present header → Timer → 30 min → Start. Change the computer's clock by an hour (Settings → Date & Time). | The countdown keeps counting correctly; it never jumps. |
| 10i.2 | Pause, wait, Resume; let it run past zero. | Paused time is not counted; at under two minutes the chip turns amber, past zero it reads "−m:ss over" in red. |
| 10i.3 | Leave Planned blank, Start. | Counts up. Nothing about the timer appears on any output. |
| 10i.4 | Prepare: give three items 5, 10 and 5 planned minutes. Start the timer, present item 2 after 20 minutes. | Prepare header reads "20 min planned"; timer chip reads "5 min late" (red); presenting earlier reads "n min early" (green). |

## 10j. Stage display

| # | Do | Expect |
|---|---|---|
| 10j.1 | More → Outputs → add an output, "Who sees it" = Stage, pick the stage monitor, turn it on. | A black, high-contrast screen: nothing live, "NEXT: <first item>". |
| 10j.2 | Present a bilingual song slide; set an operator note on it; start the timer. | Stage shows both language lines, "Note: …", the timer (amber under 2 min, red OVER), and NEXT. The congregation output is unchanged. |
| 10j.3 | Clear. Restore. Change the rundown order in Prepare. | Stage follows each change within a second. |
| 10j.4 | Restart the app with the stage output saved; also open an output saved before this version. | The stage output comes back as stage; the older output is a congregation output. |
| 10j.5 | Present header → Message stage → "Wrap up". Then Clear it. | A framed amber banner on the stage screen only; gone when cleared; the congregation output never shows it. |

## 10k. Rehearsal

| # | Do | Expect |
|---|---|---|
| 10k.1 | With the projector showing a verse and NDI into OBS, turn Rehearsal on. Present three other items, a quick screen, Clear, Restore. | Projector, OBS and the stage screen never change; the app's Live panel and rundown behave normally; the header reads REHEARSAL. |
| 10k.2 | Turn Rehearsal off. | Every output shows the current content at once. |

## 10l. Cues

| # | Do | Expect |
|---|---|---|
| 10l.1 | Present → Cues → Start the service → Run (with rehearsal on and the timer paused). | Rehearsal off, Welcome on air, timer counting from zero; the steps were listed before Run. |
| 10l.2 | Cues → End the service → Run, twice. | Screen cleared, timer paused, stage message gone; the second run changes nothing. |

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
sections 1–10l, NDI/OBS, OSC/HTTP against a running app, Yoruba speech, Windows
launch. The Windows artifact's *contents* can be inspected without Windows (see the
report), but launching it cannot.

### 10m. One language per output (OP-003)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10m.1 | Two congregation outputs; set one to "First language only" and the other to "Second language only" (More → Outputs → edit). Go live with a verse that has a second translation, then a bilingual song. | The first output shows only English, the second only Yoruba, same passage and slide; the operator preview still shows both. | Unverified |
| 10m.2 | Go live with a verse that has no second translation on the "Second language only" output. | The verse is shown in its first language; the output never goes blank. | Unverified |
### 10n. One service as a file (CL-003)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10n.1 | Save a service with a verse, a song with a background picture and a picture item. More → Library → "Save this service as a file…". Copy the file to a second computer (or restore an empty database) and "Open a service file…". | The service opens in Prepare with all three items; the song and picture are in the library; the picture shows on the preview. | Unverified |
| 10n.2 | Edit one character in the file's `payload` and open it. | "Nothing was added … the file is damaged (checksum does not match)". No new service. | Unverified |
| 10n.3 | Open the same file twice. | Two services with the same title; one copy of the song and picture. | Unverified |

### 10o. Remote control bound to this computer only (QA-006)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10o.1 | Settings → Remote: untick "Accept commands from other devices on this network", start HTTP. From another device on the LAN, `curl http://<laptop-ip>:8080/...`; from the laptop, `curl http://127.0.0.1:8080/...`. | The LAN request is refused (connection refused); the local one works. Re-tick, restart: both work. | Unverified |
### 10p. Approve a service (CL-002)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10p.1 | Save a service, press Approve. Home. | Approve shows "Approved" (disabled); Home readiness: "Service approved as saved". | Unverified |
| 10p.2 | Change an item, save. Home, then History. | Prepare: "Approve again"; Home: "Service changed since it was approved" (warn); History lists the approved version with "· approved". | Unverified |
| 10p.3 | Save 55 more times (or script it), then open History. | The approved version is still listed; the oldest unapproved ones are gone. | Unverified |
| 10p.4 | Add a picture item, delete its file from the media folder on disk, press Approve. | "Not approved … missing from the media folder: <name>"; the service stays unapproved until the file is back or the item removed. | Unverified |

### 10q. Operator name on audit rows (CL-001)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10q.1 | More → Your name "Tolu". Approve a service. Save the service log. Restart the app. | The log's first line ends "operator: Tolu"; the name is still there after restart; `audit_events.actor` for the approve row is "Tolu" (inspect the database with sqlite3). | Unverified |

### 10r. Earlier logs (AR-003)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10r.1 | After showing a few items, Library → Keep this log. Restart the app. Library → Earlier logs, search a reference you showed. | The log is listed with today's date; the search finds it; its download button saves the same text. | Unverified |

### 10s. Remote control key (OP-006)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10s.1 | Settings → Remote: key "abc", start HTTP and OSC. `curl -X POST :8080/api/v1/command -d '{"command":"next"}'` without and with `-H "X-Rhema-Key: abc"`; send `/rhema/next` from TouchOSC without and with the string argument "abc". | Without the key: HTTP 401, OSC ignored, nothing changes on screen; with it: Next happens. Restart the app: the key is still in Settings. | Unverified |

### 10t. Chord charts and sheets on a song (SO-011)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10t.1 | Open a saved song in the editor → "Add a file…" → a PDF. Click its name. Remove it. Delete the song's PDF from More → Pictures (if listed) or re-import the same PDF. | The PDF opens in the system viewer; the list updates; re-importing the same file does not duplicate it (same hash). Nothing about it ever reaches an output. | Unverified |

### 10u. Pair and revoke a device (OP-006)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10u.1 | Settings → Remote: start HTTP, press "Pair a device". From a phone on the LAN: `curl -X POST http://<laptop>:8080/api/v1/pair -d '{"code":"<code>","name":"Tolu phone"}'`. | The reply carries a 64-character token; the laptop toasts "Tolu phone paired"; the code disappears; the device is listed. | Unverified |
| 10u.2 | Send `next` with `X-Rhema-Key: <token>`; then Revoke the device; send again. Restart the app; check the list. | First request works; after revoke 401 at once (no restart); the device list survives restart; the token is never shown again. | Unverified |
| 10u.3 | Press "Pair a device", send three wrong codes. | 403 with tries left, then the window closes (404 "pairing is not open"); the on-screen code remains until cancelled or two minutes pass. | Unverified |

### 10v. Device roles (OP-006)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10v.1 | With a paired device (10u) send `{"command":"theme","value":"Dark"}` and `{"command":"next"}` with its token. Change it to "Present and change settings" in Settings, send theme again. | First theme request: 403 "may present but not change settings"; next works; after the change, theme works at once. Restart the app: the role is kept. | Unverified |
| 10v.2 | Revoke the last paired device with no shared key set. Send `next` with no key. Untick "Require a key or a paired device", send again. | 401 while the switch is on with no keys; accepted after unticking; the switch state survives restart. | Unverified |

### 10w. Signage loop (SG-001)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10w.1 | Add an output with role Signage, tick three pictures, 5 seconds each, put it on a second monitor. Go live with a verse, Clear, toggle Rehearsal, edit the theme. | The foyer screen cycles the three pictures every 5 s and never shows the verse, a blank, or the draft theme. The output card reads "Signage loop · 3 pictures". | Unverified |
| 10w.2 | Delete one of the three pictures' files from the media folder. | That slot shows the theme background for its 5 s; the loop continues. | Unverified |
| 10w.3 | Tick "Only at set times", Sun 08:00–13:00; set the laptop clock to Sunday 12:59 then 13:00. | Pictures until 12:59; the theme background from 13:00 within a second; back to pictures when the clock returns. | Unverified |

### 10x. Today's service on Home (CL-006)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10x.1 | Two services dated today, one approved. Close the open service, go Home. | A highlighted row names the approved one ("Today's service, approved") with Open; the saved list shows "· approved" on it. Open it, then Present. | Unverified |
| 10w.4 | With a signage output whose loop has a picture whose file was deleted, go Home. | Readiness warns "<output>: 1 of n signage pictures is missing" with Open outputs; an empty loop warns "has no pictures". | Unverified |
| 10w.5 | Two playlists on a signage output: "Sunday" (Sun 08:00–13:00, pictures A, B) and "Rest of the week" (no times, picture C). Set the clock to Sunday 10:00, then Monday 10:00. | A/B alternate on Sunday morning; C shows at other times; the switch happens within a second of the clock change. | Unverified |

### 10y. QR link slide (SG-003)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10y.1 | Prepare → Slides → QR link; title "Give online", link `https://church.example/give`. Add, go live. Scan with a phone from the back of the room. Save, reopen the service, go live again. | A white panel with a large code on the left and the title and address on the right; the phone opens exactly that address; it survives save/reopen. `javascript:` or a bare domain is refused in the composer. | Unverified |

### 10z. Long text as pages (MD-003)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10z.1 | Prepare → Slides: paste three paragraphs, one of them nine lines long. | "Add as 4 slides" appears; it adds four items labelled "(1/4)" … "(4/4)" in order; each shows at full size with no shrinking; Next steps through them. | Unverified |

### 10aa. NDI stream trouble (OP-005)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10aa.1 | NDI output on and received in OBS. Break the sender (e.g. rename/remove the NDI runtime library while running, or stop the NDI session from a debugger) so frame pushes fail. | Within a few frames: a warning toast "<output>: NDI stopped sending, restarting it", Home readiness shows "<output> · on · stream · not sending: …", and the app restarts the sender once; if the restart fails, an error toast says to turn the output on again. The app never freezes or blanks the projector. | Unverified |
| 10aa.2 | Make the sender work again (restore the runtime, turn the output on). | "NDI is sending again"; the readiness line clears. A second failure within a minute does not auto-restart again. | Unverified |
| 10aa.3 | Close OBS while NDI is on. | Nothing changes on the laptop (the sender keeps sending); reopening OBS picks the source up. | Unverified |
| 10aa.4 | NDI output on, OBS closed; then open OBS and add the source; then close OBS. | Home outputs line reads "Stream · on · stream · nobody receiving yet (open the source in OBS)", then "· 1 receiving", then back to "nobody receiving yet" within a second or two of each change (while the Outputs dialog or Home is open). | Unverified |

### 10ab. Video items (MD-002)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ab.1 | Prepare → Pictures → "Import pictures or videos…" an MP4 (H.264/AAC). Add it to the service; the library tile shows its first frame with ▶. | Imported once (same hash = no copy); Program preview shows "▶ name" (video plays only on outputs). | Unverified |
| 10ab.2 | Main projector output and a second display output on. Show the video live. | It plays on both screens, smoothly, filling as the Fit says; sound comes from the main output only; Next moves on and the video stops; Clear stops it; Restore starts it again from the beginning. | Unverified |
| 10ab.3 | Loop on → it repeats; Loop off → it holds the last frame. Sound off → silent everywhere. Save, reopen the service: both settings kept. | As described. | Unverified |
| 10ab.4 | NDI output on, received in OBS, video live. Repeat with an NDI-only (hidden window) output that is not the main output. | OBS shows the video moving at the NDI rate; no audio over NDI (not implemented). **Known risk:** WebView2/WebKit may throttle timers in a hidden window to about 1 Hz, so an NDI-only output could send roughly one frame a second; record the rate seen. | Unverified |
| 10ab.6 | Import a 2 GB video. | The app stays responsive during the copy (the import is hashed and copied as a stream, off the main thread); memory does not climb by the file's size. | Unverified |
| 10ab.5 | Delete the video file from the media folder, then show it live; separately, import a file the webview cannot decode (e.g. HEVC on Windows without the codec). | Missing: warning, the screen keeps what it had. Undecodable: that screen shows "▶ name", Present shows "could not play … Try an MP4 (H.264) file." | Unverified |

### 10ac. Lower thirds (MD-004)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ac.1 | Outputs: turn on "Show lower thirds" for the NDI stream (transparent theme), leave it off for the projector. Present → Lower third: "Pastor Tolu" / "Senior Pastor" → Show. | The band appears on the stream (keyable in OBS over the camera), not on the projector or the stage screen. | Unverified |
| 10ac.2 | With the band up: show a verse, Next, Clear, Restore, a video, a quick screen. | The band stays on the stream through all of it, above everything; the projector never shows it. | Unverified |
| 10ac.3 | Hide. Then turn lower thirds off for the stream while a band is up. | Hide removes it at once; switching the output off removes it from that output at once. | Unverified |
### 10ad. Monitors (OP-004)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ad.1 | Projector output on its monitor. Unplug the projector cable. | Within about five seconds: "<output>: its monitor was disconnected" toast; Home readiness warns with Open outputs. Plug it back: the warning clears (turn the output on again if the OS closed the window). | Unverified |
| 10ad.2 | Set two display outputs to the same monitor. | Home warns "<A> and <B> use the same monitor". | Unverified |

### 10af. Reuse from an earlier service (AR-003)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10af.1 | Open this Sunday's service. Prepare → Reuse → find last Sunday → tick the welcome slide, a song and a verse → Add. | The three items are appended in last Sunday's order; previews work (verse text filled in); last Sunday's service is unchanged; a verse already in the rundown is reported, not duplicated. Save and reopen: the copies are independent items. | Unverified |

### 10ae. Multiview (OP-004)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ae.1 | Projector (both languages), stream (first language only, lower thirds on), stage, signage loop. Go live with a bilingual verse and show a lower third; open Outputs (Present header chip). | Each card shows what that output shows: the projector both languages without the band, the stream English only with the band, the stage card "Stage display", the signage card its current picture. Cards of outputs that are off are dimmed and empty. | Unverified |
### 10ag. OBS connection (AR-002)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ag.1 | OBS 30+ with WebSocket server on and a password. Settings → Remote control → Connect to OBS with address, port and password; then a wrong password. | Right password: "Connected", Present shows "OBS: not recording". Wrong password: "Not connected: wrong OBS WebSocket password", retries every 15 s. | Unverified |
| 10ag.2 | Present → OBS chip → Start recording… → Start. Mark "Sermon start", wait, "Sermon end". Stop recording… → Stop. | OBS records; the chip shows OBS's time; the service log has both marks with recording times; on OBS 30.2+ Hybrid MP4 the file has two chapters; on older OBS a one-time note says chapters need 30.2. | Unverified |
| 10ag.3 | Close OBS while connected; reopen it. | Chip goes "not connected" within seconds (never shows REC from memory); reconnects by itself within 15 s of OBS coming back. | Unverified |
| 10ag.4 | OBS on another computer on the network (its IP in Settings). | Same as 10ag.1–2. | Unverified |

### 10ah. Downgrade (QA-005, RG-05)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ah.1 | With a current build, save a service. Install an older build (one with fewer migrations) and start it. | Home: "Saved services and songs are unavailable" with "last used by a newer Rhema Studio …"; Library repeats it; Scripture works; `studio.db` is unchanged. Following `17-database-migrations.md` → Downgrade restores the pre-upgrade copy and the older build opens it. | Unverified |

### 10ai. Black, Logo and Technical-issue screens (FR-04)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ai.1 | A verse live on the projector (themed background) and the stream (transparent theme). Press Black, then Logo, then Technical issue, then Back. | Black: projector solid black, stream shows nothing over the camera. Logo: each output shows its own theme's logo large and centred (nothing on a theme without a logo; on the stream only if "Show on transparent" is on). Technical issue: the two lines (and Yorùbá when a Yorùbá Bible is in use). Back: the verse returns. | Unverified |
### 10aj. Remote command rate limit (NFR-06)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10aj.1 | With HTTP remote on, run `for i in $(seq 40); do curl -s -o /dev/null -w "%{http_code} " -X POST -H 'Content-Type: application/json' -d '{"command":"next"}' http://<host>:<port>/api/v1/command; done` from another computer (add the key header if one is set). | Roughly the first 20 answer 200, the rest 429; the app log shows "too many from <address>"; a phone on another address still works at once; after a second's pause the first computer works again. | Unverified |

### 10ak. Phone remote with QR pairing (OP-006)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ak.1 | Settings → Remote: tick "Accept commands from other devices", start HTTP, press Pair a device. Scan the QR code with a phone on the same Wi-Fi; press Pair. | The page opens with the code filled in (and gone from the address bar); after Pair it shows Next/Previous/Back on air/Clear and the device appears in Paired devices. | Unverified |
| 10ak.2 | Present a service; use the phone's Next, Previous, Clear, Back on air. | Each acts like the desktop button within a moment; the phone's status shows On air/Off air and the live reference. | Unverified |
| 10ak.3 | Revoke the phone in Settings, then press Next on it. | Nothing moves; the phone says it is no longer paired and shows the pairing form. | Unverified |
| 10ak.4 | Stop HTTP, untick "Accept commands from other devices", start HTTP, close and reopen Settings, press Pair a device. | No QR code is shown (the running server accepts only this computer), even though the reopened tickbox shows ticked. | Unverified |
| 10ak.5 | On a laptop with a VPN on (or cable and Wi-Fi on different networks), pair a device. | If the address under the code is not one the phone can reach, typing the right one in "This computer's address" and leaving the field redraws the code; scanning it works. | Unverified |

### 10al. One running copy (FR-03)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10al.1 | With Rhema running (minimise it, and start the HTTP API), launch Rhema again from the Start menu or desktop icon. | No second window or second tray icon appears; the running copy's main window comes forward (restored if minimised). The remote API keeps working; no "port in use" error. | Unverified |

### 10am. Last good frame (FR-04)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10am.1 | Put a verse live on a projector and NDI. In the app data `media` folder, replace a background picture used by another theme with a text file renamed `.png`; switch the output to that theme. | If the picture cannot be drawn, the projector and NDI keep the verse as it was (no black or blank frame) and Present says the output "could not draw the new screen". Switching back to a good theme recovers at once. The Rhema window itself keeps working. | Unverified |

### 10an. No hidden network traffic (NFR-09)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10an.1 | Start a packet capture on the presentation computer (Wireshark). Open Rhema with speech off, OBS off, no NDI outputs and no remote listener; present a service with verses, songs, pictures and a video for ten minutes. | No connections to the internet at all from Rhema (local NDI/mDNS only if NDI is on). | Unverified |
| 10an.2 | Unplug the network cable / turn Wi-Fi off and present the same service. | Everything works; no errors or waits. | Unverified |

### 10ao. Deletes ask first (FR-04)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ao.1 | More → Library → Earlier logs: press the bin next to a log. Then Prepare → Media: press the bin next to an unused picture. | Nothing is deleted on the first press; "Delete"/"Remove" and "Keep" appear in its place. Keep restores the bin; Delete/Remove deletes. | Unverified |

### 10ap. Songs as text (FR-02)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ap.1 | Open a saved song with a verse, a chorus and a bridge; press **Text…** and save. Open the file in Notepad/TextEdit. | A title line, authors and copyright, then each section under "## Verse 1", "## Chorus"… in the song's main language. | Unverified |
| 10ap.2 | New song: paste that file's contents, Make sections. Then paste lyrics copied from a chord site with `[Verse 1]` / `[Chorus]` headings. | The first gives the same sections without the title block; the second gives a verse and a chorus. | Unverified |

### 10aq. Closing with unsaved work, and closing quits (FR-03)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10aq.1 | Open a saved service, add an item (do not save), close the Rhema window. | "Save changes before closing?" with Keep working, Close without saving, Save and close. Keep working leaves everything as it was; closing again asks again. | Unverified |
| 10aq.2 | Close again and choose Save and close; reopen Rhema and the service. | The added item is there. | Unverified |
| 10aq.3 | With unsaved changes, close the window, and while the question shows, close it again (or the page has frozen). | The second close quits without asking (never trapped). | Unverified |
| 10aq.4 | With a projector output and an NDI-only output on, close the Rhema window (nothing unsaved). Then start Rhema again. | Every output window closes and Rhema exits (nothing left in Task Manager / Activity Monitor); the new start opens normally. | Unverified |

### 10ar. Sound player (MD-002)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ar.1 | Prepare → Media: import an MP3 and an M4A. Present → ♪: Play the MP3, then Play the M4A. | Sound from the computer's speakers/desk; the second replaces the first; the chip shows the name and time left; no screen changes. | Unverified |
| 10ar.2 | Pause, Resume, set Volume to half, Fade out. | Pause/Resume continue from the same point; the fade lasts about 3 seconds to silence, then the chip is idle; the next Play uses half volume. | Unverified |
| 10ar.3 | Turn Repeat on and let a short sound reach its end; then More → Library → Save the log. | It starts again; the log has a "sound" line with the name for each Play. | Unverified |
| 10ar.4 | With OBS on and a service open, look at the Present header at 1366x768. | Every chip is visible; they wrap onto a second row if needed; Standard/Production stays on screen. | Unverified |

### 10as. Sound as a service item (MD-002)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10as.1 | Service: Welcome slide, a sound (Prepare → Media → Sounds → Add), Announcements. Present the Welcome slide, then Next. | The sound starts; projector and NDI still show Welcome (still marked live in the rundown); the sound item shows "playing"; Preview reads "♪ name". | Unverified |
| 10as.2 | Next (Announcements), Fade out, then Previous. | Announcements goes up while the sound keeps playing; after the fade, Previous goes straight back to Welcome without starting the sound again. | Unverified |
| 10as.4 | Make the sound the last item and step onto it; let it finish; press Next again. | Nothing restarts it. | Unverified |
| 10as.3 | Rehearsal on; step onto the sound item. | No sound; Present says it was not played in rehearsal. | Unverified |

### 10at. Secrets in the system keychain (RG-08)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10at.1 | Start this build over settings from an older build that had a Deepgram key, a remote key and an OBS password. Open `settings.json` in the app data folder. | The three values are empty in the file and `secretsInKeychain` is `true`; Windows Credential Manager (Generic credentials) / macOS Keychain Access shows one "Rhema Studio" entry (`settings-secrets`). The values still work (OBS connects, remote key accepted). On macOS after an update, at most one keychain permission prompt. | Unverified |
| 10at.2 | Restart Rhema. | Everything still works without re-entering anything. | Unverified |
| 10at.3 | Settings → Diagnostics → Save logs after a session that logged an error mentioning the remote key. | The key appears as [redacted]. | Unverified |

### 10au. Projected end and timer correction (FR-07)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10au.1 | Give three items 10 planned minutes each; start the timer and present the first item; wait 12 minutes and present the second. | The timer popover shows "Planned end" 30 minutes after the start and "now about" 2 minutes later, in red; the chip says "2 min late". | Unverified |
| 10au.2 | Press "+1 min" then "−1 min"; save the service log. | Elapsed time moves by a minute each way (never below zero); the log has two "timer" lines. | Unverified |

### 10av. Song usage report (FR-09)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10av.1 | Save three dated services that use some of the same songs (one song twice in one service) and one undated service. More → Library → Song usage → Show for a range covering them. | Each song once, most used first, with its CCLI number (or "public domain"); the song used twice in one service counts 1 for that service; the undated service is not counted. | Unverified |
| 10av.2 | Save as CSV… and open it in a spreadsheet. | Columns Title, Authors, CCLI song number, Licence, Services, Last used; titles with commas stay in one cell. | Unverified |

### 10aw. Rename and re-date a service (FR-03)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10aw.1 | Prepare: open a saved service, add an item (do not save), press the pencil, change the title and date, Save title and date. | The service list shows the new title and date; the added item is still there and still unsaved; Save then works. | Unverified |
| 10aw.2 | Rename an approved service. | Home shows it as changed since approval (the record changed); approve again to pin it. | Unverified |

### 10ax. Templates and archive (FR-03)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ax.1 | Open a service with a few items; pencil → tick Template. New service → Start from → that template; title "Sunday 1 Nov", date; Create. | The new service opens with the same items; the template is unchanged (open it again: same items, still marked template); Home's list and "today's service" never offer the template. | Unverified |
| 10ax.2 | Pencil → Archive this service. | It disappears from the picker and Home; "Show archived (1)" brings it back into the picker; its history and logs are intact; pencil → Bring back restores it. | Unverified |
| 10ax.4 | More → Your name = "Tolu"; Prepare → Approve. | The Approve button's tooltip and Home read "Approved by Tolu …". | Unverified |
| 10ax.3 | Start an older build (before 0010) on this database. | It refuses with "used by a newer Rhema Studio" (downgrade guard) and leaves the file alone. | Unverified |

### 10ay. Your own cues (PT-003)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ay.1 | Present → Cues → New cue…: name "Baptism", steps Rehearsal off, Quick screen: Black, Start the timer; Save cue. Run it. | Rehearsal goes off, the screens go black (Back returns), the timer runs; the cue shows "remote: /rhema/macro baptism". | Unverified |
| 10ay.2 | Restart Rhema; send `/rhema/macro baptism` from a Stream Deck/OSC tool (with the key if one is set). | The cue is still there and runs from the controller. | Unverified |
| 10ay.3 | Delete the cue (bin → Delete). | It is gone; the built-in cues cannot be deleted. | Unverified |
