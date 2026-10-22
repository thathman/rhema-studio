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
| 10m.1 | Two congregation outputs; set one to "First language only" and the other to "Second language only" (More → Outputs → edit). Go live with a verse that has a second translation, then a bilingual song. | The first output shows only English, the second only Yoruba, same passage and slide; the operator preview still shows both. | Verified on the Intel Mac |
| 10m.2 | Go live with a verse that has no second translation on the "Second language only" output. | The verse is shown in its first language; the output never goes blank. | Verified on the Intel Mac |
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
| 10p.1 | Save a service, press Approve. Home. | Approve shows "Approved" (disabled); Home readiness: "Service approved as saved". | Verified on the Intel Mac |
| 10p.2 | Change an item, save. Home, then History. | Prepare: "Approve again"; Home: "Service changed since it was approved" (warn); History lists the approved version with "· approved". | Verified on the Intel Mac |
| 10p.3 | Save 55 more times (or script it), then open History. | The approved version is still listed; the oldest unapproved ones are gone. | Verified on the Intel Mac |
| 10p.4 | Add a picture item, delete its file from the media folder on disk, press Approve. | "Not approved … missing from the media folder: <name>"; the service stays unapproved until the file is back or the item removed. | Verified on the Intel Mac |

### 10q. Operator name on audit rows (CL-001)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10q.1 | More → Your name "Tolu". Approve a service. Save the service log. Restart the app. | The log's first line ends "operator: Tolu"; the name is still there after restart; `audit_events.actor` for the approve row is "Tolu" (inspect the database with sqlite3). | Verified on the Intel Mac |

### 10r. Earlier logs (AR-003)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10r.1 | After showing a few items, Library → Keep this log. Restart the app. Library → Earlier logs, search a reference you showed. | The log is listed with today's date; the search finds it; its download button saves the same text. | Verified on the Intel Mac |

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
| 10u.1 | Settings → Remote: start HTTP, press "Pair a device". From a phone on the LAN: `curl -X POST http://<laptop>:8080/api/v1/pair -d '{"code":"<code>","name":"Tolu phone"}'`. | The reply carries a 64-character token; the laptop toasts "Tolu phone paired"; the code disappears; the device is listed. | Verified on the Intel Mac |
| 10u.2 | Send `next` with `X-Rhema-Key: <token>`; then Revoke the device; send again. Restart the app; check the list. | First request works; after revoke 401 at once (no restart); the device list survives restart; the token is never shown again. | Verified on the Intel Mac |
| 10u.3 | Press "Pair a device", send three wrong codes. | 403 with tries left, then the window closes (404 "pairing is not open"); the on-screen code remains until cancelled or two minutes pass. | Verified on the Intel Mac |

### 10v. Device roles (OP-006)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10v.1 | With a paired device (10u) send `{"command":"theme","value":"Dark"}` and `{"command":"next"}` with its token. Change it to "Present and change settings" in Settings, send theme again. | First theme request: 403 "may present but not change settings"; next works; after the change, theme works at once. Restart the app: the role is kept. | Verified on the Intel Mac |
| 10v.2 | Revoke the last paired device with no shared key set. Send `next` with no key. Untick "Require a key or a paired device", send again. | 401 while the switch is on with no keys; accepted after unticking; the switch state survives restart. | Verified on the Intel Mac |

### 10w. Signage loop (SG-001)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10w.1 | Add an output with role Signage, tick three pictures, 5 seconds each, put it on a second monitor. Go live with a verse, Clear, toggle Rehearsal, edit the theme. | The foyer screen cycles the three pictures every 5 s and never shows the verse, a blank, or the draft theme. The output card reads "Signage loop · 3 pictures". | Unverified |
| 10w.2 | Delete one of the three pictures' files from the media folder. | That slot shows the theme background for its 5 s; the loop continues. | Unverified |
| 10w.3 | Tick "Only at set times", Sun 08:00–13:00; set the laptop clock to Sunday 12:59 then 13:00. | Pictures until 12:59; the theme background from 13:00 within a second; back to pictures when the clock returns. | Unverified |

### 10x. Today's service on Home (CL-006)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10x.1 | Two services dated today, one approved. Close the open service, go Home. | A highlighted row names the approved one ("Today's service, approved") with Open; the saved list shows "· approved" on it. Open it, then Present. | Verified on the Intel Mac |
| 10w.4 | With a signage output whose loop has a picture whose file was deleted, go Home. | Readiness warns "<output>: 1 of n signage pictures is missing" with Open outputs; an empty loop warns "has no pictures". | Unverified |
| 10w.5 | Two playlists on a signage output: "Sunday" (Sun 08:00–13:00, pictures A, B) and "Rest of the week" (no times, picture C). Set the clock to Sunday 10:00, then Monday 10:00. | A/B alternate on Sunday morning; C shows at other times; the switch happens within a second of the clock change. | Unverified |

### 10y. QR link slide (SG-003)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10y.1 | Prepare → Slides → QR link; title "Give online", link `https://church.example/give`. Add, go live. Scan with a phone from the back of the room. Save, reopen the service, go live again. | A white panel with a large code on the left and the title and address on the right; the phone opens exactly that address; it survives save/reopen. `javascript:` or a bare domain is refused in the composer. | Verified on the Intel Mac |

### 10z. Long text as pages (MD-003)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10z.1 | Prepare → Slides: paste three paragraphs, one of them nine lines long. | "Add as 4 slides" appears; it adds four items labelled "(1/4)" … "(4/4)" in order; each shows at full size with no shrinking; Next steps through them. | Verified on the Intel Mac |

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
| 10ab.1 | Prepare → Pictures → "Import pictures or videos…" an MP4 (H.264/AAC). Add it to the service; the library tile shows its first frame with ▶. | Imported once (same hash = no copy); the preview shows "▶ name" (video plays only on outputs). | Unverified |
| 10ab.2 | Main projector output and a second display output on. Show the video live. | It plays on both screens, smoothly, filling as the Fit says; sound comes from the main output only; Next moves on and the video stops; Clear stops it; Restore starts it again from the beginning. | Unverified |
| 10ab.3 | Loop on → it repeats; Loop off → it holds the last frame. Sound off → silent everywhere. Save, reopen the service: both settings kept. | As described. | Unverified |
| 10ab.4 | NDI output on, received in OBS, video live. Repeat with an NDI-only (hidden window) output that is not the main output. | OBS shows the video moving at the NDI rate; no audio over NDI (not implemented). **Known risk:** WebView2/WebKit may throttle timers in a hidden window to about 1 Hz, so an NDI-only output could send roughly one frame a second; record the rate seen. | Unverified |
| 10ab.6 | Import a 2 GB video. | The app stays responsive during the copy (the import is hashed and copied as a stream, off the main thread); memory does not climb by the file's size. | Unverified |
| 10ab.5 | Delete the video file from the media folder, then show it live; separately, import a file the webview cannot decode (e.g. HEVC on Windows without the codec). | Missing: warning, the screen keeps what it had. Undecodable: that screen shows "▶ name", Present shows "could not play … Try an MP4 (H.264) file." | Unverified |

### 10ac. Lower thirds (MD-004)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ac.1 | Outputs: turn on "Show lower thirds" for the NDI stream (transparent theme), leave it off for the projector. Present → Lower third: "Pastor Tolu" / "Senior Pastor" → Show. | The band appears on the stream (keyable in OBS over the camera), not on the projector or the stage screen. | Verified on the Intel Mac |
| 10ac.2 | With the band up: show a verse, Next, Clear, Restore, a video, a quick screen. | The band stays on the stream through all of it, above everything; the projector never shows it. | Unverified |
| 10ac.3 | Hide. Then turn lower thirds off for the stream while a band is up. | Hide removes it at once; switching the output off removes it from that output at once. | Verified on the Intel Mac |
### 10ad. Monitors (OP-004)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ad.1 | Projector output on its monitor. Unplug the projector cable. | Within about five seconds: "<output>: its monitor was disconnected" toast; Home readiness warns with Open outputs. Plug it back: the warning clears (turn the output on again if the OS closed the window). | Unverified |
| 10ad.2 | Set two display outputs to the same monitor. | Home warns "<A> and <B> use the same monitor". | Unverified |

### 10af. Reuse from an earlier service (AR-003)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10af.1 | Open this Sunday's service. Prepare → Reuse → find last Sunday → tick the welcome slide, a song and a verse → Add. | The three items are appended in last Sunday's order; previews work (verse text filled in); last Sunday's service is unchanged; a verse already in the rundown is reported, not duplicated. Save and reopen: the copies are independent items. | Verified on the Intel Mac |

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
| 10ai.1 | A verse live on the projector (themed background) and the stream (transparent theme). Press Black, then Logo, then Technical issue, then Back. | Black: projector solid black, stream shows nothing over the camera. Logo: each output shows its own theme's logo large and centred (nothing on a theme without a logo; on the stream only if "Show on transparent" is on). Technical issue: the two lines (and Yorùbá when a Yorùbá Bible is in use). Back: the verse returns. | Verified on the Intel Mac |
### 10aj. Remote command rate limit (NFR-06)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10aj.1 | With HTTP remote on, run `for i in $(seq 40); do curl -s -o /dev/null -w "%{http_code} " -X POST -H 'Content-Type: application/json' -d '{"command":"next"}' http://<host>:<port>/api/v1/command; done` from another computer (add the key header if one is set). | Roughly the first 20 answer 200, the rest 429; the app log shows "too many from <address>"; a phone on another address still works at once; after a second's pause the first computer works again. | Verified on the Intel Mac |

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
| 10al.1 | With Rhema running (minimise it, and start the HTTP API), launch Rhema again from the Start menu or desktop icon. | No second window or second tray icon appears; the running copy's main window comes forward (restored if minimised). The remote API keeps working; no "port in use" error. | Verified on the Intel Mac |

### 10am. Last good frame (FR-04)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10am.1 | Put a verse live on a projector and NDI. In the app data `media` folder, replace a background picture used by another theme with a text file renamed `.png`; switch the output to that theme. | If the picture cannot be drawn, the projector and NDI keep the verse as it was (no black or blank frame) and Present says the output "could not draw the new screen". Switching back to a good theme recovers at once. The Rhema window itself keeps working. | Unverified |

### 10an. No hidden network traffic (NFR-09)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10an.1 | Start a packet capture on the presentation computer (Wireshark). Open Rhema with speech off, OBS off, no NDI outputs and no remote listener; present a service with verses, songs, pictures and a video for ten minutes. | No connections to the internet at all from Rhema (local NDI/mDNS only if NDI is on). | Verified on the Intel Mac |
| 10an.2 | Unplug the network cable / turn Wi-Fi off and present the same service. | Everything works; no errors or waits. | Unverified |

### 10ao. Deletes ask first (FR-04)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ao.1 | More → Library → Earlier logs: press the bin next to a log. Then Prepare → Media: press the bin next to an unused picture. | Nothing is deleted on the first press; "Delete"/"Remove" and "Keep" appear in its place. Keep restores the bin; Delete/Remove deletes. | Verified on the Intel Mac |

### 10ap. Songs as text (FR-02)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ap.1 | Open a saved song with a verse, a chorus and a bridge; press **Text…** and save. Open the file in Notepad/TextEdit. | A title line, authors and copyright, then each section under "## Verse 1", "## Chorus"… in the song's main language. | Unverified |
| 10ap.2 | New song: paste that file's contents, Make sections. Then paste lyrics copied from a chord site with `[Verse 1]` / `[Chorus]` headings. | The first gives the same sections without the title block; the second gives a verse and a chorus. | Unverified |

### 10aq. Closing with unsaved work, and closing quits (FR-03)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10aq.1 | Open a saved service, add an item (do not save), close the Rhema window. | "Save changes before closing?" with Keep working, Close without saving, Save and close. Keep working leaves everything as it was; closing again asks again. | Verified on the Intel Mac |
| 10aq.2 | Close again and choose Save and close; reopen Rhema and the service. | The added item is there. | Verified on the Intel Mac |
| 10aq.3 | With unsaved changes, close the window, and while the question shows, close it again (or the page has frozen). | The second close quits without asking (never trapped). | Unverified |
| 10aq.4 | With a projector output and an NDI-only output on, close the Rhema window (nothing unsaved). Then start Rhema again. | Every output window closes and Rhema exits (nothing left in Task Manager / Activity Monitor); the new start opens normally. | Unverified |
| 10aq.5 | macOS: with unsaved changes press Cmd+Q (and separately choose Rhema → Quit Rhema). | The same "Save changes before closing?" question as closing the window. Quitting from the Dock icon still quits without asking (known issue). | Unverified (the menu item is installed: startup log line seen on a Mac debug build 2026-10-21; the keystroke was not sent) |

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
| 10as.1 | Service: Welcome slide, a sound (Prepare → Media → Sounds → Add), Announcements. Present the Welcome slide, then Next. | The sound starts; projector and NDI still show Welcome (still marked live in the rundown); the sound item shows "playing"; Preview reads "♪ name". | Verified on the Intel Mac |
| 10as.2 | Next (Announcements), Fade out, then Previous. | Announcements goes up while the sound keeps playing; after the fade, Previous goes straight back to Welcome without starting the sound again. | Verified on the Intel Mac |
| 10as.4 | Make the sound the last item and step onto it; let it finish; press Next again. | Nothing restarts it. | Verified on the Intel Mac |
| 10as.3 | Rehearsal on; step onto the sound item. | No sound; Present says it was not played in rehearsal. | Verified on the Intel Mac |

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
| 10au.2 | Press "+1 min" then "−1 min"; save the service log. | Elapsed time moves by a minute each way (never below zero); the log has two "timer" lines. | Verified on the Intel Mac |

### 10av. Song usage report (FR-09)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10av.1 | Save three dated services that use some of the same songs (one song twice in one service) and one undated service. More → Library → Song usage → Show for a range covering them. | Each song once, most used first, with its CCLI number (or "public domain"); the song used twice in one service counts 1 for that service; the undated service is not counted. | Verified on the Intel Mac |
| 10av.2 | Save as CSV… and open it in a spreadsheet. | Columns Title, Authors, CCLI song number, Licence, Services, Last used; titles with commas stay in one cell. | Unverified |

### 10aw. Rename and re-date a service (FR-03)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10aw.1 | Prepare: open a saved service, add an item (do not save), press the pencil, change the title and date, Save title and date. | The service list shows the new title and date; the added item is still there and still unsaved; Save then works. | Verified on the Intel Mac |
| 10aw.2 | Rename an approved service. | Home shows it as changed since approval (the record changed); approve again to pin it. | Verified on the Intel Mac |

### 10ax. Templates and archive (FR-03)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ax.1 | Open a service with a few items; pencil → tick Template. New service → Start from → that template; title "Sunday 1 Nov", date; Create. | The new service opens with the same items; the template is unchanged (open it again: same items, still marked template); Home's list and "today's service" never offer the template. | Verified on the Intel Mac |
| 10ax.2 | Pencil → Archive this service. | It disappears from the picker and Home; "Show archived (1)" brings it back into the picker; its history and logs are intact; pencil → Bring back restores it. | Verified on the Intel Mac |
| 10ax.4 | More → Your name = "Tolu"; Prepare → Approve. | The Approve button's tooltip and Home read "Approved by Tolu …". | Verified on the Intel Mac |
| 10ax.3 | Start an older build (before 0010) on this database. | It refuses with "used by a newer Rhema Studio" (downgrade guard) and leaves the file alone. | Unverified |

### 10ay. Your own cues (PT-003)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ay.1 | Present → Cues → New cue…: name "Baptism", steps Rehearsal off, Quick screen: Black, Start the timer; Save cue. Run it. | Rehearsal goes off, the screens go black (Back returns), the timer runs; the cue shows "remote: /rhema/macro baptism". | Verified on the Intel Mac |
| 10ay.2 | Restart Rhema; send `/rhema/macro baptism` from a Stream Deck/OSC tool (with the key if one is set). | The cue is still there and runs from the controller. | Verified on the Intel Mac |
| 10ay.3 | Delete the cue (bin → Delete). | It is gone; the built-in cues cannot be deleted. | Verified on the Intel Mac |

### 10az. Responsive reading (FR-01, SV-005)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10az.1 | Prepare → Slides → Responsive reading; paste Psalm 136:1–3 with L: and P: marks; Add. | One slide per exchange, each reading "Leader: …" then "All: …"; Next steps through them in order. | Verified on the Intel Mac |
| 10az.2 | Paste the same text without marks. | The composer says no parts are marked and how to mark them. | Verified on the Intel Mac |

### 10ba. End-by time for an item (FR-07)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ba.1 | Prepare: give the sermon item "end by" 3 minutes from now; save, reopen. Present it. | The rundown shows "by HH:MM"; the time survives reopening; the timer chip shows "by HH:MM · 3 min", amber at 2 minutes, red "past HH:MM by 1 min" after. | Verified on the Intel Mac |

### 10bb. Slide-change latency in the logs (QA-007)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10bb.1 | On the target (low-end) PC with a projector output, step through 40 verses and songs; Settings → Diagnostics → Save logs. | "[latency] output main: 20 screen changes, median … ms, slowest … ms" lines (one per 20 real changes of screen; resends are not counted; picture slides are timed when the picture is drawn); record the numbers in the evidence sheet (QA-007). Any change over 100 ms appears as its own warning. | Unverified |

### 10bc. Church folder (owner decision #72)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10bc.1 | Home laptop and church laptop both choose the same NAS share (or synced folder) in More → Library. At home: save and approve a service; Prepare → Publish; Publish again. | Before approving: one file "<title> <date> v<n> <checksum>.rhema-service.json". After approving and pressing Publish: a second file (the approval is new content). Pressing again: "already in the church folder". | Verified on the Intel Mac |
| 10bc.2 | At home: change the service, save, Publish. | A second file with the next version number; the first is untouched. | Verified on the Intel Mac |
| 10bc.3 | At church: Home → Church folder. | One row for the service: the newest version, "1 older version", "approved by …" for the approved one only if the newest is the approved revision. | Verified on the Intel Mac |
| 10bc.4 | Open it. | It opens in Prepare with its songs and pictures; it is not approved here until Approve is pressed; the row then says "opened here". Nothing happened before Open was pressed. | Verified on the Intel Mac |
| 10bc.5 | Copy a large service into the synced folder and look at Home while it is still syncing; disconnect the NAS. | The syncing file is listed as damaged/may still be syncing and cannot be opened; with the NAS gone, the card says the folder is not available; the show is unaffected. | Unverified |

### 10bd. Newer version in the church folder (CL-005, FR-08)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10bd.1 | At church: open v7 from the church folder. At home: change, save, approve, Publish (v8). At church: Home, then Prepare with v7 open. | Home's row shows v8 "newer than the copy opened here"; Prepare shows "A newer version (v8, approved) is in the church folder. This one is v7." Nothing changed by itself; v7 is still open and unchanged. | Verified on the Intel Mac |
| 10bd.2 | Press "Open the newer one". | v8 opens as its own service (v7 kept); the notice goes away; approve v8 here. | Verified on the Intel Mac |

### 10be. Consent before cloud speech (RG-08, NFR-09)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10be.1 | Fresh settings, Deepgram key entered, provider Cloud (Deepgram). Start listening in the transcript panel. | A dialog "Send the microphone to Deepgram?" explains what is sent; nothing is sent until Agree (packet capture: no connection to api.deepgram.com before Agree). | Unverified |
| 10be.2 | Agree. Then Present header. | Listening starts; the chip reads "Listening (Deepgram)"; Settings → Speech Recognition shows "Agreed on …" with Withdraw. | Unverified |
| 10be.3 | Withdraw, start again, choose "Use local recognition instead". | Provider switches to Whisper and listening starts locally (if the model is installed); no dialog for local recognition. | Unverified |

### 10bf. Transcript in a kept log (AR-004)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10bf.1 | Listen for a few minutes (Whisper or Deepgram), present some items, then More → Library → Service log. | "Include what was said (n recognised passages)" appears, unticked, with the notice. Keep this log without ticking: the kept log has no transcript. | Unverified |
| 10bf.2 | Tick it and Keep this log; search Earlier logs for a phrase that was said. | The log ends with "Transcript (recognised speech by …; not checked…)" and timed passages; the search finds it. Reopening Library shows the box unticked again. | Unverified |

### 10bg. Who prepares, who saved (CL-007)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10bg.1 | More → Your name = "Tolu". Prepare: set "prepared by" = "Ade (music)" on a song; Save; open History. | The rundown shows "· Ade (music)" on the song; History's newest version reads "… · Tolu". | Verified on the Intel Mac |
| 10bg.2 | Publish to the church folder and open it on another computer. | The song still shows "· Ade (music)". | Unverified |

### 10bh. Approval before go-live (CL-002, opt-in)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10bh.1 | More → tick "Ask before showing an unapproved service". Open a service that is not approved; Show live (also try the on-air switch and a Stream Deck/OSC go-live). | "This service is not approved" appears; nothing reaches the screen. Not now leaves the output as it was. | Unverified |
| 10bh.2 | Show live again → Present anyway. Then edit an item, save, and press Next. | The held item goes live at once. Next after the edit is never held. | Verified on the Intel Mac |
| 10bh.4 | Gate on, unapproved service: Start the service (Welcome), then Next; press the clicker three times while the question shows, then Present anyway. | The question appears at the first item, the rundown does not move while it shows, and the first item (not the third) goes live. Later Clear then Next is never held. | Verified on the Intel Mac |
| 10bh.5 | Gate on, unapproved service in rehearsal with a song slide up: turn rehearsal off. | The question appears and the congregation screens stay as they were until Present anyway. | Unverified |
| 10bh.3 | Approve the service, restart, Show live. Turn rehearsal on with another unapproved service; Show live; use Black. | No question for the approved service, in rehearsal, or for quick screens. | Unverified |

### 10bi. Screen reader and keyboard names (QA-003, RG-09)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10bi.1 | With Narrator (Windows) on, Tab through Present (Production view): the Bible panel's translation picker, chapter arrows and a verse's add button. | Each is announced by purpose ("Bible translation", "Next chapter", "Add John 3:16 to the service"), not just "button". | Unverified |
| 10bi.2 | More → Themes: Tab to a theme card, press Enter; Tab to its options. | The card is announced as "Select theme …", Enter selects it, and its options button becomes visible when focused. | Unverified |
| 10bi.3 | Windows display scaling 150%: Present at 1366x768. | Show live, Next, Clear, Back and the quick screens stay visible and readable. | Unverified |

### 10bj. Yorùbá book names in Quick find (ST-001, FR-01)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10bj.1 | Present → Quick find: type "Jòhánù 3:16", then "Johanu 3 16", then "1 Ọba 3:9" and "Ise 2:38". | Each previews the right verse (John 3:16, 1 Kings 3:9, Acts 2:38) in the active translation. | Verified on the Intel Mac |
| 10bj.2 | A Yorùbá speaker types the book names they actually use for ten common books. | Each finds the right book; note any spelling that does not, for the alias list. | Unverified |

### 10bk. Team comments (CL-007)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10bk.1 | Computer A, More → Your name = "Pastor Ade". Prepare: select an item, write a comment, press Enter; Save; Publish to the church folder. | The comment shows with name and time; the row shows a speech-bubble count; nothing appears on any output. | Verified on the Intel Mac |
| 10bk.2 | Computer B, More → Your name = "Tolu": open that service from the church folder. | "1 new comment" in the service bar; the list shows "Pastor Ade on …" and the text. Mark as read hides it until someone else comments again. | Verified on the Intel Mac |
| 10bk.3 | Computer B adds a reply, saves, publishes; computer A opens the newer version. | A sees "1 new comment" (Tolu's), not its own. | Verified on the Intel Mac |
| 10bk.4 | Computer B: Mark as read, then open the same service again from the church folder (a new copy); duplicate it. | No comment shows as new in either copy until someone writes a new one. | Unverified |

### 10bl. Backup to a drive that disappears (QA-002, NFR-01)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10bl.1 | Put something on a projector output. More → Library → Back up now to a USB stick (or a network share); pull the stick (or unplug the network) while it is writing. | Present, the outputs and Save keep working; the backup reports that it could not be written; the stick holds no file named like a finished backup (at most nothing, never a half file under the backup's name). | Unverified |
| 10bl.2 | Restore from a backup on a network share that is then disconnected mid-read. | The app keeps working; restore reports it could not read the backup; the current services are unchanged. | Unverified |

### 10bm. A song's backing track (FR-06, SO-011)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10bm.1 | Song editor: add an MP3 under "Chord charts, sheets and backing tracks"; save. Put the song in the service. | The file is listed with the song. | Unverified |
| 10bm.2 | Present: go to the song (Next or Show live), open the Sound button. | "Backing track for <song>" lists the file; Play starts it on this computer's sound output; the screens do not change; Fade out and Stop work. Nothing plays until Play is pressed. | Unverified |
| 10bm.3 | Go to a verse item; open the Sound button. | No backing-track list (only the library's sounds). | Verified on the Intel Mac |

### 10bn. Heard verses wait for the operator (FR-01, AI-001)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10bn.1 | New installation (no earlier settings). Put something on air, start listening, read "John 3:16" aloud. | The verse appears in the preview and the detections list; what is on screen does not change until Show live. Production view → Live panel: Auto is off. | Unverified |
| 10bn.2 | Turn Auto on; Standard view. | "Auto-live on" appears in the header while listening; a heard verse now replaces what is on screen. Clicking the chip turns Auto off. | Unverified |
| 10bn.3 | Computer that used an earlier build (Auto was on by default). Update; start listening. | Auto is off until turned on again (Live panel in Production view, or Settings → Display Mode → Heard verses); after turning it on and restarting, it stays on. | Unverified |
| 10bn.4 | Settings → Display Mode → Heard verses: choose Auto, then look at the Live panel in Production view; switch it off there and look at Settings. | Both show the same setting. | Unverified |

### 10bo. Next stays where the operator is (RG-03)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10bo.1 | Present a service, go to item 4 with Next. From Quick find add a verse; then remove item 1 in Prepare; then drag item 2 below item 5. Press Next after each. | Next always shows the item after the one on screen. | Verified on the Intel Mac |
| 10bo.2 | Service open, listening, on item 6. Read aloud the verse that is item 2, then a verse that is not in the service. Press Next. | Item 2 flashes; nothing is added to the service, the service is not marked unsaved; Next shows item 7. | Unverified |
| 10bo.4 | Present on item 6; delete item 6 in the rundown; press Next. | Item 7 (the one that followed) goes live, not item 1. | Verified on the Intel Mac |
| 10bo.3 | No service open (Clear service), listening: read two verses aloud. | They collect in the rundown list as in the original Rhema. | Unverified |

### 10bp. Live safety audit fixes (RG-03, FR-01, PRD §2)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10bp.1 | Present a verse item that has a background picture. Go to Prepare and back to Present; switch Standard/Production. | The picture stays on air; nothing on screen changes. | Verified on the Intel Mac |
| 10bp.2 | A verse on air in KJV, Auto off, listening: say "read it in NIV". Then change the translation yourself. | The spoken change does not alter the screen (the preview may switch); your own change does, keeping the background. | Unverified |
| 10bp.3 | A song live on its 2nd slide; in Prepare change its arrangement; press Next twice. | Next continues the arrangement that was live (slide 3, then 4); entering the song again uses the new arrangement. | Verified on the Intel Mac |
| 10bp.4 | A song live from an unsaved rundown; delete the song in the library; press Next. | The next item goes live (no repeated "no longer in the library" warning). | Unverified |
| 10bp.5 | Present item 5 (a verse); press Verse +; press Next. | Item 6 goes live (not item 1); a background on item 5 stays during Verse +. | Verified on the Intel Mac |

### 10bq. Data and output audit fixes (FR-03, RG-05, FR-06)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10bq.1 | Saved service: tick Loop on a video item (or untick Sound, or change a QR slide's address). | The service shows unsaved; closing asks. | Verified on the Intel Mac |
| 10bq.2 | Edit a song in the song editor without saving; close the Rhema window. Also: Clear service, add two items in Prepare, close the window. | Both times "Save changes before closing?" names what is unsaved. | Unverified |
| 10bq.3 | Open a song on two computers sharing a church folder… or in two editors via a backup; save on one, then save on the other. | The second shows the conflict and "Save mine as a new song", which keeps the edits as "<title> (my version)". | Unverified |
| 10bq.4 | Give the NDI/stream output a custom lower-third theme; delete that theme in the theme library. | Refused: "<theme> is used by <output>"; the output keeps its theme. | Verified on the Intel Mac |
| 10bq.5 | Rename the service and at once reorder an item; close the window. | Closing asks (the reorder was not lost). | Verified on the Intel Mac |
| 10bq.6 | Open a saved service, Close service (the rundown stays), quit Rhema. Then reopen, Close service, remove one item, quit. | First time: no question. Second time: "The service on screen has not been saved". | Verified on the Intel Mac |

### 10br. Keyboard and language audit fixes (RG-09, RG-06)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10br.1 | Song editor open with unsaved changes; press Ctrl+3 (Cmd+3). | Stays in the editor with "Save or close the song you are editing first." | Verified on the Intel Mac |
| 10br.2 | Present: open the Outputs dialog (or the Cues menu); press → / ← / Esc inside it; then PageDown. | The arrows and Esc do not change the screen behind it. PageDown and PageUp (a presenter clicker's keys) still step, by design (`present-keys.ts`). | Verified on the Intel Mac |
| 10br.3 | Quick find: type "john 3 16" quickly and press Enter at once. | The preview shows John 3:16 (not 3:1). | Verified on the Intel Mac |
| 10br.4 | With KJV + Yorùbá active add John 3:16, save, switch to NIV, present the item. | KJV + Yorùbá (as saved), also before reopening the service. | Verified on the Intel Mac |
| 10br.5 | With more than 50 songs, add "Àánú" (typed normally). Open the song library. | It is listed among the A's. | Verified on the Intel Mac |

### 10bs. Startup and performance audit fixes (RG-05, NFR-03)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10bs.1 | Quit Rhema; cut settings.json in the app folder in half; start Rhema. | A warning says settings were reset and names the kept file (settings.json.damaged-…); that file is still there. | Verified on the Intel Mac |
| 10bs.2 | Give the stage output a theme with a large photo; start the timer; watch the outputs and Activity Monitor/Task Manager. | No stutter; the stage screen shows as before. | Unverified |
| 10bs.3 | Export a service file that contains a video, while something is on air. | The output and NDI keep moving while it saves. | Unverified |
| 10bs.4 | Delete the service that was open last time (or restore an older backup); restart twice. | "That service no longer exists" at most once. | Verified on the Intel Mac |

### 10bt. Remote control audit fixes (FR-04, OP-006)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10bt.1 | Settings → Remote: untick "other devices", start HTTP on 9090; quit and start Rhema. Then tick "other devices" with no key and no paired device, start HTTP, restart; then pair a phone and restart. | Local only: running again on 9090, box still unticked. Network with no key: not restarted, with a message. With a paired phone: running again, the phone works without opening Settings. | Unverified |
| 10bt.2 | Phone remote: walk to the edge of the Wi-Fi and press Next once. | The service steps once, even if the phone shows "Sending…" or "No answer…"; never twice for one press. | Unverified |
| 10bt.3 | Turn rehearsal on; look at the phone. Then with the approval question showing, look again. | "Rehearsal: the screens are frozen" / "The computer is asking whether to show this service". After Clear, the phone says "Nothing on screen". | Verified on the Intel Mac |

### 10bu. Readiness and church-folder audit fixes (FR-08, CL-002, CL-005)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10bu.1 | Open a service saved for a translation this computer lacks; look at Home. Delete the file of a song's background picture; look again. | "Some verses are saved for … not installed here" and the missing-file warning; not "Ready to present". | Unverified |
| 10bu.2 | Open a never-approved service, change an item without saving; look at Home. | "Service not approved yet" (not "changed since it was approved"). | Verified on the Intel Mac |
| 10bu.3 | Approve a service, change it, save; History → restore the approved version; look at Home. | "Service approved as saved". | Verified on the Intel Mac |
| 10bu.4 | Computer A publishes v1 (with a song); computer B opens it. A fixes a lyric, publishes v2; B opens the newer one. | B is told its copy of that song was kept; the song on B is unchanged; Home shows no false missing pictures. | Unverified |

### 10bv. Timers, cues and video sound audit fixes (FR-07, PT-003, MD-002)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10bv.1 | Start the timer; after 5 minutes run "Start the service" again (Cues or the phone). | The timer keeps running from where it was. | Verified on the Intel Mac |
| 10bv.2 | With the timer past 1 minute press Reset; then press it again. Look at the service log. | The first press asks "Reset 5:12?"; the second resets; the log has "timer reset (it had run 5:12)". | Verified on the Intel Mac |
| 10bv.3 | A cue "Next then Offering": run it, then press Back. | The next item went live, then the Offering screen; Back returns to that next item. | Verified on the Intel Mac |
| 10bv.4 | Set an item's "end by" to a time 30 minutes away; close the laptop lid for 10 minutes; open it. | The countdown shows about 20 minutes left within seconds. | Unverified |
| 10bv.5 | Make the main output a Stage output and a second output Congregation; present a video with sound. | Sound plays (from the congregation output). | Unverified |

### 10bw. Service log audit fixes (AR-001, FR-09)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10bw.1 | Service open with 4 items; show items 1 and 3; add a verse from Quick find and show it; show a Bible-panel verse that is not in the service; Welcome with nothing live; Black. More → Library → Save the log. | Planned vs actual lists all 4 items in order (item 2 and 4 "not shown"), the added verse "[added during the service]", "Also shown" with the Bible-panel verse; the timeline has "quick screen Welcome" and "quick screen Black screen". | Unverified |
| 10bw.2 | Item A live; rehearsal on; present B; rehearsal off. Save the log. | After "rehearsal off" the log has "LIVE B". | Verified on the Intel Mac |

### 10bx. Editors and outputs audit fixes (SO-003, CV-004, OP-001)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10bx.1 | Song editor: paste "Ẹsẹ̀ 1 / line / blank / Ègbè / line". Export the song as text, paste it into a new song. | Two sections, verse and chorus; no "Ègbè" or "## …" line in the words. | Unverified |
| 10bx.2 | A song live on its 2nd slide; in the song editor delete its first verse and save; press Next twice. | Next continues the song as it was live; the change shows when the song is next started. | Verified on the Intel Mac |
| 10bx.3 | Church brand: add a look, set the stream output to its Announcements theme, remove the look, Apply. | The stream output keeps that theme (now your own); nothing goes opaque. | Unverified |
| 10bx.4 | Rename a Church brand theme; Apply the brand again. | The new name stays. | Unverified |

### 10by. Detection, tour and settings audit fixes (FR-10, ST-002)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10by.1 | Start listening in Production, switch to Standard and Home; speak for a minute; unplug the microphone. | The transcript keeps growing (Library → Service log offers it); the "Audio source disconnected" warning appears. | Unverified |
| 10by.2 | First launch: finish (or skip) the tour. | Back where you were (Home), and Present opens in Standard with its keys. | Verified on the Intel Mac |
| 10by.3 | Bible panel: Genesis 50, press → (or Next chapter). | Exodus 1, not an empty Genesis 51. | Verified on the Intel Mac |
| 10by.4 | While listening, open Settings → Audio or Speech. | "Rhema is listening now. Changes here apply when you stop and start listening again." | Unverified |
| 10by.5 | Auto on; send /rhema/confidence 0.95; say a verse loosely. | It appears in the preview but does not replace the screen. | Unverified |

### 10bz. Regression audit fixes (interacting changes)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10bz.1 | "Ask before showing" on, service not approved, Auto on: Welcome, then read a verse aloud. | No approval question appears by itself; the verse waits in the preview. Next then asks as usual. | Unverified |
| 10bz.2 | Rundown A B C D with C live; delete C; press Previous; delete again and press Next. | Previous shows B (not A); Next shows the item after the deleted one. | Verified on the Intel Mac |
| 10bz.3 | A song live; edit and save its words; click a slide of it in Present and Show live. | Preview and the screen show the words as the song went live. | Verified on the Intel Mac |
| 10bz.4 | Present a new verse item, save the service, change the translation. | The verse on air keeps the translation it was saved with. | Verified on the Intel Mac |
| 10bz.5 | Black screen test at 8:30 with an empty rundown; build and run the service; save the log. | No item is marked "added during the service" unless it really was. | Verified on the Intel Mac |

### 10ca. Clear, Restore, Back and quick screens (tenth audit)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ca.1 | Song on slide 2; Clear; click any verse in the Bible panel; Restore. | Slide 2 of the song returns; Next then shows slide 3. | Verified on the Intel Mac |
| 10ca.2 | Song live; press Verse + (Shift+→). | The screen keeps the song; only the Bible panel moves. | Verified on the Intel Mac |
| 10ca.3 | Song on slide 2; Please stand; Next. | Slide 3 of the song. | Verified on the Intel Mac |
| 10ca.4 | Quick screen over a verse; Clear; Back. | The verse returns but stays off air until Restore. | Verified on the Intel Mac |
| 10ca.5 | "Ask before showing" on, unapproved service, rehearsal: verse, Black, rehearsal off, Back. | The approval question appears; nothing changes until answered. | Verified on the Intel Mac |
| 10ca.7 | Song on slide 2; Clear; look at the status chip at the top of Present. | It reads "Off air · Restore shows" and the song slide. | Verified on the Intel Mac |
| 10ca.6 | Rundown has John 3:1; put John 3:16 on air from the Bible panel. | The John 3:1 row is not marked LIVE. | Unverified |

### 10cb. Data safety (eleventh audit)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10cb.1 | Change a setting (say the operator name) and close Rhema straight away; reopen. | The change is kept. | Verified on the Intel Mac |
| 10cb.2 | Go live with something, then close Rhema normally; reopen and look under More → Library → Earlier logs. | The service log of that run is there. | Verified on the Intel Mac |
| 10cb.3 | Add a picture to the service on screen without saving; Prepare → Pictures → Remove it. Also a picture in a screen loop, and a file attached to a song. | Refused, naming where it is used; the file stays. | Verified on the Intel Mac |
| 10cb.4 | Add a song to the service on screen without saving; open it in the editor and Delete. | Refused: used in the service on screen. | Verified on the Intel Mac |
| 10cb.5 | Change a theme in the Designer; press Escape, Close, or pick another theme. Then close Rhema with a changed theme. | Rhema asks before discarding; the close question lists the theme. | Verified on the Intel Mac |
| 10cb.6 | Quit Rhema; damage `settings.json` in the app folder (cut it short); start Rhema. | It says the settings were put back as they were at the last start; they are. | Verified on the Intel Mac |

### 10cc. Prepare fixes (twelfth audit)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10cc.1 | Open a saved service; close it with X (the rundown stays); New service → Create. | The new service is saved with those items; the old one is unchanged. | Verified on the Intel Mac |
| 10cc.2 | Prepare → Slides → QR link with only a web address; Add; Save. | Saved. | Verified on the Intel Mac |
| 10cc.3 | Add a slide whose text is one 250-character paragraph with no title; Save. | Saved; the rundown shows the start of the text, the screen shows all of it. | Verified on the Intel Mac |
| 10cc.4 | On two computers enter the same hymn with the same hymnbook number; publish a service using it from one and open it on the other. | The service opens; the song arrives without the number. A library import of the same song says one hymn number was left off. | Unverified |
| 10cc.5 | Export a Yorùbá-first song with a key and tempo as OpenLyrics; import it. | Yorùbá is still the main language; key and tempo kept. | Unverified |
| 10cc.6 | Song editor: tempo 72.5. | "Tempo is whole beats per minute"; nothing is saved until fixed. | Verified on the Intel Mac |

### 10cd. Outputs (thirteenth audit)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10cd.1 | Open a projector; close the Outputs dialog; close the projector window from the OS (Alt+F4). | Within a few seconds Present and Home show it off. | Unverified |
| 10cd.2 | Three monitors: operator, projector, stage. Unplug the projector. | The warning names the projector output, not the stage one; reopening the stage output opens it on the stage screen. | Unverified |
| 10cd.3 | Present a very long passage (several verses) in Classic Dark. | Text at the smallest size; never jumps back to full size and runs off. | Unverified |
| 10cd.4 | Stage output on air; present a long verse or a three-verse passage. | The singers see every line from the first; smaller text for long lines. | Unverified |
| 10cd.5 | Open the Designer on the main output's theme and change a colour; present the next verse; change the colour again. | The screen keeps showing the edited theme; no flipping. Close without saving: the saved theme returns. | Verified on the Intel Mac |
| 10cd.6 | Main output set to stage; play a video with sound on another congregation output; edit that output's theme. | The sound continues. | Unverified |

### 10ce. Failures (fourteenth audit)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ce.1 | Import a multi-GB video in Prepare → Pictures; while it copies, go to Present and step through songs and verses. | Present keeps working; outputs change as usual. | Unverified |
| 10ce.2 | Church folder on a network share: start opening a service, then pull the network cable. | Rhema stays responsive; the open fails with a message. | Unverified |
| 10ce.3 | macOS: after an update, deny (or ignore) the keychain prompt at start. | A warning says the saved keys could not be read, with Retry; Retry after allowing brings the keys back and the remote listens with its key. | Unverified |
| 10ce.4 | Cloud speech listening; turn Wi-Fi off for 20 seconds, then on. | "Hybrid mode" shows; within about a minute real-time transcription returns. | Unverified |
| 10ce.5 | Without the Whisper model, choose on-computer speech and Start. | The message says how to fix it in plain words (cloud speech or reinstall). | Unverified |

### 10cf. Keyboard and screen reader (fifteenth audit)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10cf.1 | Present → Production, output on air: type "John 3" in the Bible quick box and press the arrow keys. | The caret moves in the box; nothing goes on air. | Verified on the Intel Mac |
| 10cf.2 | With a screen reader (NVDA or VoiceOver): Show live, then Clear; present a picture whose file is missing. | "On air: …", "Off air" and the warning are read out. | Unverified |
| 10cf.3 | Production view with only the keyboard: Tab to a queue item and press Enter; Tab to its remove button. | Enter shows it live; the buttons appear and are named. | Unverified |
| 10cf.4 | Screen reader on the Preview and Live panels. | Each reads what it shows (the reference and words). | Unverified |
| 10cf.5 | Delete a rundown item, an arrangement step, and a cue (Keep, then Delete) using only the keyboard. | Focus lands on the next item's control, never on the page. | Unverified |

### 10cg. Home and Settings (sixteenth audit)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10cg.1 | Give the main output's theme a font that is not installed (type a made-up name); open Home. | Home warns that the theme font is not installed. | Verified on the Intel Mac |
| 10cg.2 | More → turn on "Ask before showing"; open a service never approved; open Home. | A warning says the first go-live will stop and ask. | Verified on the Intel Mac |
| 10cg.3 | Open Home with a picture item; delete that file from the media folder; go to Present and back to Home. | "1 picture … missing its file". | Verified on the Intel Mac |
| 10cg.4 | Settings → Remote while the phone remote is running. | It shows running at once (Stop), never "Start" first. | Unverified |

### 10ch. Search (seventeenth audit)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ch.1 | Quick find: "the Lord's my shepherd", then "shepherd, I shall not want". | Psalm 23 verses are listed. | Verified on the Intel Mac |
| 10ch.2 | Bible quick box and Quick find: "John 3:16-18", "John 3:16, 18", "Jn. 3:16". | John 3:16 each time. | Verified on the Intel Mac |
| 10ch.3 | "Jude 5", "Phm 6", "3 John 4". | Jude 1:5, Philemon 1:6, 3 John 1:4. | Verified on the Intel Mac |
| 10ch.4 | Songs: a song titled "Psalm 23"; search "Psalm 23" in the library and Quick find. | The song is found. | Verified on the Intel Mac |
| 10ch.5 | Quick find: "5" with hymn 5 in a hymnbook. | Hymn 5 is listed. | Verified on the Intel Mac |

### 10ci. Cues and signage (eighteenth audit)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ci.1 | Custom cue "Show live, Quick screen: Offering"; put a verse in Preview; run the cue; then Back. | The verse airs, Offering covers it, Back returns to the verse. | Verified on the Intel Mac |
| 10ci.2 | In rehearsal, cue "Show live, Rehearsal off" with "Ask before showing" on and the service unapproved. | The approval question appears before the congregation sees anything. | Verified on the Intel Mac |
| 10ci.3 | Signage playlist: only Sunday, 00:00 to 00:00, plus a fallback playlist with no schedule. | Sunday loop on Sundays only; the fallback the rest of the week. | Unverified |

### 10cj. Styling each language of a bilingual screen

| # | Steps | Expected | Result |
|---|---|---|---|
| 10cj.1 | Theme Designer → Verse text. Tabs read Both, First · (main translation), Second · (the one under it). | The tabs name the translations in use. | Verified on the Intel Mac (2026-10-21) |
| 10cj.2 | Both tab: change the font size and colour. Show a bilingual verse and a bilingual song. | Both languages change together. | Unverified |
| 10cj.3 | Second tab: make the Yorùbá (second) text smaller and another colour. | Only the second language changes; "Match the first language again" undoes it. | Size and colour verified on the Intel Mac; reset unverified |
| 10cj.4 | "Space between languages" (Verse text, or Layout → Element spacing): 0, then 150. | The gap between the languages closes, then widens, on verses and songs; small previews scale it. | Verses verified on the Intel Mac (0 and 150); songs by test |
| 10cj.5 | Theme Designer toolbar: Preview "One language", "Two languages", "Song". | The preview shows Genesis 1:1 in one language, in English and Yorùbá, or a bilingual song slide; second-language styling is visible while editing. | Unverified (the switch is in place on the Mac; the preview draws only while Rhema is on the visible desktop) |

### 10ck. First-run tour (Studio)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10ck.1 | Fresh install (or Settings → restart the tour). | The tour starts on Home: "Four places", readiness, screens; then Prepare (service, add items, running order), Present Standard (run the service, what people see, Next/Clear/Restore, find anything, quick screens, listening), and More. Each step opens its workspace first. | Partly verified on the Intel Mac: all 13 targets exist in their workspaces and steps 1–4 ran (Home → Prepare); the rest needs the window on screen |
| 10ck.2 | Skip, or finish the tour. | Back where you started; it does not start again; Settings can restart it. | Unverified |

### 10cl. A copy goes back as a newer version (CL-005, CL-007)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10cl.1 | Computer A publishes v11. Computer B opens it from the church folder, changes it, saves, publishes. | The folder has v12 of the same service (one row on Home, "1 older version"), not a new service at B's own numbering. | Verified on the Intel Mac (two profiles) |
| 10cl.2 | On A, open the service in Prepare. | "A newer version (v12) is in the church folder. This one is v11." Nothing changes by itself. | Verified on the Intel Mac |

### 10cm. CAC hymn book (SO-005, SO-006)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10cm.1 | Prepare → Hymn book → Import the hymn book… → choose `hymns_combined.json`. | "Hymn book imported: 1050 hymns"; Part 1 lists 1–1000, Part 2 lists V1–V50, each with its English title and Yorùbá first line. The Songs tab does not list them. | Verified on the Intel Mac |
| 10cm.2 | Type 245, then V12, then 012, then words in Yorùbá. | 245 alone; V12 switches to Part 2; 012 finds 12; words find hymns in either language. | Checked in the browser build |
| 10cm.3 | First: English; Add hymn 245; preview; go live; set an output to "Second language only". | The item shows EN, YO; the screen shows English then Yorùbá with the footer "… · CAC Gospel Hymn Book 245" below the words; the second-only output shows only Yorùbá. | Verified on the Intel Mac |
| 10cm.4 | Save the service; Import the file again; open the service; save. | "Hymn book updated: 1050 hymns"; the service opens and saves; a number already used by the church's own song in a "CAC" book is left alone. | Verified on the Intel Mac (own-song case: crate test) |

### 10cn. Numbered books and the item fields (owner reports)

| # | Steps | Expected | Result |
|---|---|---|---|
| 10cn.1 | Quick find: "1 Samuel", "1 Samuel 3", "1 kings", "First Samuel 3:10", "Ọba Kejì 2:9". | Each puts the right book and chapter (verse 1, or the verse given) first, above any word matches. | Checked in the browser build |
| 10cn.2 | Prepare: click an item to edit it. | Minutes, Prepared by and End by sit in labelled columns; nothing is cut off; the comment box's hint is a line under it. | Checked in the browser build |

