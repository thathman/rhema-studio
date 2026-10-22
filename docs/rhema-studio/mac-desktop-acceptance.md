# Intel Mac desktop acceptance (issue #161)

Real native runs of Rhema Studio on the owner's Intel Mac, 2026-10-21. Intel
(`x86_64-apple-darwin`) only; no Apple Silicon build or test was made.

**Verdict for Intel Mac QA only: GO for the owner's own evaluation, with the
unverified rows below still open.** This is not a release decision (RELEASE-PLAN
gates, signing and notarisation remain).

## Machine

| | |
|---|---|
| Model / CPU | MacBook Pro, Intel Core i7-8569U @ 2.80 GHz, 8 threads, 16 GB |
| macOS | 15.7.7 (24G720), `uname -m` x86_64 |
| Graphics / displays | Intel Iris Plus 655; one display (built-in 2560×1600 Retina) |
| Audio | MacBook Pro microphone and speakers; an iPhone microphone (Continuity) |
| Toolchain | Rust 1.98.1 (x86_64-apple-darwin), Bun 1.3.14, Apple clang 17 (Command Line Tools) |
| Native deps | ONNX Runtime 1.29.0 (Homebrew), NDI runtime from `sdk/ndi/macos/libndi.dylib` (universal), Whisper model `ggml-large-v3-turbo-q8_0.bin` |
| Other software | OBS 32.2.2 with DistroAV (NDI) and obs-websocket |

## Build

From `main` at `0a0d63b` plus this branch's fixes, in a separate worktree:

```
ORT_LIB_LOCATION=/usr/local/opt/onnxruntime/lib ORT_PREFER_DYNAMIC_LINK=1 \
  bun x tauri build --target x86_64-apple-darwin --config src-tauri/tauri.mac-intel.conf.json
scripts/macos-bundle-dylibs.sh Rhema.app Rhema-0.3.2-intel-x86_64.dmg
```

- `tauri.mac-intel.conf.json` adds the Whisper model and the NDI runtime to the
  bundle's resources (they are found at `Resources/models/…` and
  `Resources/sdk/…`). It builds the `.app` only; the script makes the `.dmg`.
- `scripts/macos-bundle-dylibs.sh` copies ONNX Runtime and the Homebrew libraries
  it pulls in (86 files: abseil, protobuf, re2, onnx) into
  `Contents/Frameworks`, points the executable at them, re-signs ad hoc and
  fails if anything still links outside the bundle and the OS.
- Signing is ad hoc (`-`, as in `tauri.conf.json`). The app is not notarised:
  on another Mac, Gatekeeper asks before the first open (Control-click → Open).
  Notarisation needs the owner's Apple Developer identity and is not done here.
- Artifact paths, sizes and checksums: see "Artifacts" at the end.

## How the tests were run

- **Isolated profile.** Every test run used a scratch `HOME`, so settings,
  `studio.db`, media and logs lived in a scratch folder. The real folder
  `~/Library/Application Support/com.openbezal.rhema` was backed up first
  (`…/com.openbezal.rhema.qa-backup-20261021`) and was byte-for-byte unchanged
  afterwards (SHA-256 of every file compared). No keychain entry was written:
  the test profile held no keys, and the keychain entry is shared with the real
  app, so no key was entered.
- **WebKit storage does not follow `HOME`.** WebKit wrote to the real
  `~/Library/WebKit/com.openbezal.rhema` during the runs. It was restored from
  the pre-test copy afterwards (the real app had not run in between).
- **Driving the real app.** This session has no permission to send clicks or
  keys to other apps (Accessibility is off, and was not turned on). A QA build
  (`cargo` feature `qa-bridge`, `src-tauri/src/qa_bridge.rs`) evaluates test
  scripts inside the running app's own windows: real webview, real Rust
  backend, real output windows. Scripts press the real buttons (`.click()`),
  type into real inputs, or call the same actions the buttons call, and read
  results back. A normal build does not contain the bridge.
  `scripts/mac-qa/qa.py` sends a script; `scripts/mac-qa/grab.sh` saves what an
  output window draws (its canvas).
- **Evidence.** Output frames below are the projector window's own canvas
  (1920×1080), not screen photographs. Full-screen captures were not kept: the
  screen also showed other work.

## Results

V = verified on this Mac. U = unverified (not possible here; reason given). F = failed, then fixed on this branch and re-verified.

| Area (guide §) | Step | Result |
|---|---|---|
| Launch | The native x86_64 app starts, Home shows readiness: "Bible library loaded (8 translations)", theme Classic Dark | V |
| Launch | Webview IPC uses Tauri's custom protocol | F → V: the CSP's `connect-src` lacked `ipc: http://ipc.localhost`, so every call fell back to postMessage ("IPC custom protocol failed" at each start). Added; no warning after |
| 1.1 | 8 translations incl. OYCB (Yorùbá) | V |
| 1.2 | Quick find "John 3:16" + Enter previews, not live | V (Enter left the screen unchanged; preview John 3:16) |
| 1.2 | First run is in KJV | F → V: the default was "translation id 1", which is AMP in the bundled library (KJV is id 4), so every new install started in the Amplified Bible. KJV is now chosen by name on a first run |
| 1.3 | "1 Cor 13:4", "2 Sam 7:12", "3 John 1:2" | V |
| 1.4 | "Johanu 3:16" → John 3:16; OYCB text with ẹ, ọ, ṣ and tone marks renders on the output | V ([frame](mac-acceptance/john-3-16-yoruba-kjv.jpg)) |
| 1.6 | A verse past the chapter end (John 3:99) | V: the screen kept what was live; "John 3:99 not shown: no text in KJV." |
| 2.3 | Primary OYCB, secondary KJV on a verse item | V: Yorùbá first, KJV below ([frame](mac-acceptance/john-3-16-yoruba-kjv.jpg)) |
| 2.4 | Theme designer secondary-text edit | U (owner request: separate controls for each language; follow-up PR) |
| 10a | Song with English and Yorùbá lyrics, hymnbook SSS, number 245 | V: both languages on screen ([verse](mac-acceptance/song-verse1-bilingual.jpg), [chorus](mac-acceptance/song-chorus-bilingual.jpg)) |
| 10a | Find by "SSS 245", "245", a Yorùbá word ("iyanu"), "amazing grace" | V |
| 10b | Custom slide (title + two lines) | V ([frame](mac-acceptance/custom-slide.jpg)) |
| 10c | Service "QA Sunday" with slide, song, bilingual verse, Psalm 23:1 and a picture; Save | V (revision 5 in `studio.db`, five items, a note) |
| 5 | Preview → Show live → Next (song slide 2) → Next (next item) → Clear → Restore | V: on-air state and position correct at each step; Previous back into the song lands on its last slide |
| 10g | Picture item (import, add, present) | F → V: "the picture file is missing" although it was there. The file plugin's `read-app-specific-dirs-recursive` grants read commands but no folder, and `fs:default`'s Linux rule denies `$APPLOCALDATA/**`, which on macOS is the app data folder. The capability now grants `$APPDATA/media/**` only. The Linux deny rule is dropped: on Linux the two folders are the same too, so it would block the media folder, and nothing outside `media/` is readable now, so the webview data stays out of reach. Picture shown on the output after the fix |
| 10j | Stage display output (second output window) | V: stage text "Welcome / Two minutes left / Tea after the service… / NEXT: Amazing Grace" (live item, private message, next) |
| 10o, 8 | HTTP remote bound to 127.0.0.1 only; `/health`, `/status`, commands `next`, `hide`, `show` | V (`lsof`: listening on 127.0.0.1 only). `/health` reported "0.1.0" (the API crate's version): F → V, reports the app version 0.3.2 |
| 7, 10aa | NDI sender from the bundled runtime, 1080p24 and 720p30 | V: frames received by a test receiver built on the NDI SDK (1280×720), Rhema counted 1 receiver; off again afterwards |
| 7 | OBS receiving the NDI source; OBS connection and chapter marks | U: would add a source to the owner's OBS scenes and store the OBS password in the shared keychain |
| 4 | Save, quit, relaunch: service reopens with items, note and picture; outputs and remote settings kept; remote listener restarts on its own | V |
| 10aq | Closing with unsaved changes asks; "Save and close" saves and quits; the service log is kept on close | V (the close request was sent as the window's close button sends it; Rust's hold was not exercised) |
| 10aq | Cmd+Q and the Quit menu route through the same question | U: needs a key press or menu click from outside the app |
| 9 / RG-05 | `settings.json` cut short while closed → restored from the last good copy, with a warning | V |
| ST-008 | `studio.db` created and migrated to 0011 on a fresh profile | V |
| 6, 10x | Speech recognition (Whisper on this computer, Deepgram) and verse detection from speech | U: needs the microphone permission prompt answered by the owner; cloud speech needs a key in the shared keychain |
| 10ab | Video items | U: no test video and no ffmpeg on this Mac |
| 10ar, 10as | Sound items and sound player | U: would play audio aloud on the owner's Mac during testing |
| 10ad | Second monitor, unplugging a monitor | U: one display only |
| 10at | Secrets in the keychain | U: deliberately not exercised (shared entry) |

## Second pass: more guide rows (2026-10-21, same Mac and method)

| Guide row | Result |
|---|---|
| 10f.1 (quick screens, Back) | V: Welcome live → Black → Please stand → Back returned Welcome, on air |
| 10i.1 partly (timer starts and runs) | V: 30-min presets and Start in the Present header; the chip and the stage both count. Clock change and colours: U |
| 10j.1 / 10j.2 partly (stage) | V: stage shows the live item (or "Nothing live" after Clear), the timer and NEXT; the stage message appears on the stage only (first pass) |
| 10k.1 / 10k.2 (rehearsal) | V: with rehearsal on the projector kept "Welcome" while the operator went to the next item; rehearsal off sent it at once |
| 10p (approval gate, opt-in) | V: an edit after approval, then Next with "Ask before showing" on: held with "This service is not approved … Nothing has gone on screen"; Present anyway put it on |
| 10aj.1 (remote rate limit) | V: 60 fast commands from this computer: 28 accepted, 32 refused (429); accepted again after a pause |
| 10al.1 (one running copy) | V: launching again left one process (single instance) |
| 10u.1 (pair a device) | V: Pair a device gave a code; `POST /api/v1/pair` with it returned a 64-character token; "Tolu phone paired" toast; the device listed (role "present") |
| 10u.2 (key, revoke, restart) | V: `next` with the device's key 200, without a key 401; after Revoke 401 at once; the device list survived a restart |
| 10u.3 (wrong codes) | V: three wrong codes 403 ("2 / 1 / 0 tries left"), then 404 "pairing is not open" |
| 10v.1 (roles) | V: "theme" from a present-only device refused ("may present but not change settings"); after changing it to configure, accepted at once and after a restart |
| 10v.2 (no keys left) | V: with no devices and the switch on, 401; after unticking "Require a key or a paired device", 200; the switch state survived a restart |
| 10m.1 (one language per output) | V: projector set to "First language only", NDI stream to "Second language only": for John 3:16 (OYCB + KJV) the stream drew only KJV (frame checked) and the projector frame carried only the Yorùbá |
| 10m.2 | V: Psalm 23:1 with no second translation on the second-only stream: shown in its first language, never blank. (A saved item with no second translation follows the operator's second translation when one is set: by design, per the translation policy) |
| 10ac.1 (lower thirds) | V: "Pastor Tolu / Senior Pastor" on the stream (lower thirds on), not on the projector (off) |
| 10ac.2 partly | V: the band stayed through Next |
| 10ac.3 | V: Hide removed it at once; turning lower thirds off for the stream while a band was up removed it at once |
| Projector with the display asleep | Observed: with the Mac's display asleep macOS reports no monitors; turning a projector output on then fails with "Monitor index 0 out of range (0 available)" and the output stays off; the NDI stream needs no monitor and kept working |
| 10q.1 (operator name) | V: More → Your name "Tolu"; approving a service wrote `audit_events.actor` "Tolu"; the kept service log's first line was "QA Today Morning — operator: Tolu"; the name was still there after a restart |
| 10x.1 (today's approved service) | V: two services dated today, one approved; with no service open, Home highlighted "QA Today Morning · Today's service, approved" with Open |
| 10af.1 (reuse) | V: Prepare → Reuse → QA Sunday, ticked Welcome, Amazing Grace and John 3:16 → "Add 3": "2 items added; 1 verse was already in the service"; appended in QA Sunday's order; a reused Psalm 23:1 had its text filled in; QA Sunday unchanged; saved copies have their own ids |
| 10ao.1 (deletes ask first) | V: the bin next to a kept log and next to an unused picture deleted nothing on the first press; Keep brought the bin back; Delete/Remove then deleted. A picture services use was refused, naming them ("qa-picture is used in: QA Sunday, …") |
| 10av.1 (song usage) | V: three dated September services and one undated: "Great Is Thy Faithfulness, Lord · 12345 · 3", then "Amazing Grace · public domain · 2" (used twice in one service, counted once); the undated service not counted |
| 10ap, 10av.2 | Not run: both end in the system Save dialog, which the test harness does not drive (the text and CSV formats are covered by unit tests) |
| 10bj.1 (Yorùbá book names) | V: Quick find "Jòhánù 3:16", "Jòhánù 3 16", "johanu 3:16" → John 3:16; "1 Ọba 3:9" → 1 Kings 3:9; "Ise 2:38" → Acts 2:38 (KJV, the active translation) |
| 10aw.1 (rename, re-date) | V: with an unsaved added item, the new title and date were listed at once; the item stayed, still unsaved; Save then worked |
| 10aw.2 (rename an approved service) | F → V: the Approve button said "Changed since approval (v2 approved, now v3)" but Home said "Dated today, not approved yet" and the list dropped the mark. Fixed in #169: Home now says "Dated today, changed since approval" and the list "· changed since approval"; approving again shows "Today's service, approved" |
| 10ax.1 (templates) | V: "QA Usage 3" marked Template; New service from it ("Sunday 1 Nov", 1 Nov) opened with the same items; the template unchanged and still a template; Home never listed it |
| 10ax.2 (archive) | V: archived service gone from the picker and Home; "Show archived (1)"; its history intact; Bring back restored it |
| 10ax.4 (approved by) | V: the Approve button's tooltip read "Approved by Tolu Wed 23:00" |
| 10z.1 (long text as pages) | F → V: "Add as 4 slides" added four pages and Next stepped through them; a six-line page showed at full size on the stream. But every page was labelled by page 1's first line, and saving dropped the "(1/4)"…"(4/4)" marks. Fixed in #170: each page is labelled by its own text with its mark, the same after save and reopen |
| 10y.1 (QR link) | V: `javascript:alert(1)` and `church.example/give` refused ("Only a full http(s) address…", Add disabled); "Give online" with `https://church.example/give` added; on air, a white panel with the code left and the title and address right; the stream frame's code decodes to exactly that address; it survived save and reopen |
| 10bg.1 (prepared by) | V: "Ade (music)" on a song showed "· Ade (music)" in the rundown; History's newest version was saved by "Tolu" |
| 10r.1 (earlier logs) | V: a kept log was listed after a restart with today's date; searching "Psalm 23" found it; "Revelation 22" found none. (Its download button ends in the system Save dialog: not run) |
| 10az.1–2 (responsive reading) | V: L:/P: marks gave "Add as 3 slides", each "Leader: … / All: …", Next in order; unmarked text: "No parts marked yet: start the leader's lines with L: …" and Add disabled |
| 10ba.1 (end by) | F → V: "by 01:29" in the rundown and after reopening; chip "by 01:29 · 3 min", amber at 2 min, red "past 01:29 by …" after. Past the time it rounded up ("by 2 min" at 1 min 21 s): fixed in #175 (whole minutes). In the hidden test window the chip refreshed up to ~20 s late (timers throttled) |
| 10au.2 (timer correction) | V: +1 min moved elapsed 0:01 → 1:03, −1 min back, a second −1 stopped at zero; each press logged "timer corrected by ±1 min" |
| 10ay.1–3 (own cues) | V: New cue "Baptism" (Rehearsal off, Quick screen: Black, Start the timer) saved with "remote: /rhema/macro baptism"; Run: rehearsal off, black screen, Back returned to the song. After a restart the cue was there and an OSC `/rhema/macro baptism` ran it (log: "remote: macro baptism", "rehearsal off", "quick: Black screen"). Bin → Delete removed it; the four built-in cues have no bin |
| 10cm.1 (hymn book import) | V: Prepare → Hymn book → the file through the tab's file input: "Hymn book imported: 1050 hymns"; "1000 hymns in Part 1 · 50 in Part 2" |
| 10cm.3 (hymn on screen) | V: First: English, Add 245: item EN, YO. On the stream (both): four English lines, then the four Yorùbá in their own style, footer "Come, O Thou all-victorious Lord · CAC Gospel Hymn Book 245" under the words, nothing overlapping (screenshot 2026-10-22-hb-both). Stream set to "Second language only": only the Yorùbá |
| 10cm.4 (import again) | V: "Hymn book updated: 1050 hymns"; the service using 245 reopened, saved after an edit and presented. (The church's own song in the book is left alone: crate test) |
| 10bo.1 (Next after edits) | V: on the 4th item, Next showed the item after the one on screen after adding an item, after removing item 1, and after dragging item 2 below item 5 |
| 10bo.4 (delete the live item) | V: deleting the item on screen, then Next, showed the one that followed ("Give online"), not item 1 |
| 10ca.1, 10ca.7 (Clear and Restore) | V: hymn 245 on verse 2; Clear: the chip read "Off air · Restore shows Come, O Thou all-victorious Lord · Verse 2"; a Bible verse picked; Restore brought verse 2 back; Next showed verse 3 |
| 10ca.3 (quick screen then Next) | V: Please stand over verse 3, then Next: verse 4 |
| 10ca.4 (Back while off air) | V: Black over verse 4, Clear, Back: verse 4 returned off air; Restore put it on air |
| 10ai.1 (Black, Logo, Technical issue, Back) | F → V on the stream (projector needs a display): Black solid black (opaque stream theme); Logo the theme background only (theme without a logo); Back returned John 3:16. Technical issue showed English only although the service's verse was in the Yorùbá Bible (operator set-up KJV only): fixed in #176, Yorùbá also counts when the open service's verses are saved in a Yorùbá Bible (unit test; not re-run on the Mac) |
| 10ca.2 (Verse + with a song on air) | V: hymn 245 verse 1 stayed on screen; the Bible panel moved from 3:16 to 3:17 |
| 10ca.5 (approval on Back) | V: "Ask before showing" on, unapproved service, rehearsal: John 3:16, Black, rehearsal off, Back: the go-live was held with the question for "QA Reuse Target"; the screen stayed black until answered |
| 10ar.1–3 (sound player), partly | V (app volume 5%, 3 a.m.; WAV and M4A, no MP3 encoder here): Play, then another Play replaced it; Pause/Resume kept the place; the volume carried to the next Play; no screen changed; a "sound" log line per Play. Not concluded: the 3-second fade and Repeat (the hidden test window throttles the timers that drive them). Noted: a WAV and an M4A with the same file name appear as two identical rows |
| 10as.1–3 (sound as a service item) | V: Welcome, then Next onto the sound: it played, the screen kept Welcome (still the live item), the rundown marked the sound "PLAYING"; Next: Announcements while the sound played on; after Fade out, Previous went to Welcome without replaying; rehearsal: "Rehearsal: qa-tone-long was not played. Use the ♪ button to play it on purpose." |
| 10cb.1 (setting kept on a quick close) | V: the name changed, then the close request sent at once: on disk at once ("Tolu Second Close") |
| 10cb.2 (log kept on close) | V: something went live, then close: the run's log was kept ("QA Slides 2 — 22/10/2026" under Earlier logs) |
| 10cb.3 (picture in the unsaved service on screen) | V: Remove refused: "in use: the service on screen"; the file stayed |
| 10cb.4 (song in the unsaved service on screen) | V: Delete refused: "in use: the service on screen"; the song stayed |
| 10cb.6 (damaged settings) | V: settings.json cut to 120 bytes: "Settings (…) could not be read; they were put back as they were when Rhema last started …"; the damaged file kept beside it |
| 10cc.2 (QR link, address only) | F → V: saved, but listed as "Slide"; #177 names it by its address ("church.example/bulletin") |
| 10cc.3 (long untitled slide) | V: a 238-character paragraph saved; the rundown shows its first 200 characters, the slide keeps all of it |
| 10cg.1 (theme font not installed) | V: main output on a theme using "Zzq Made Up Font": Home "1 theme font is not installed · QA Missing Font: Zzq Made Up Font. The screen will use a fallback font." |
| 10cg.2 (approval warning) | V: "Ask before showing" on, a never-approved service: Home "Service not approved yet" |
| 10cg.3 (missing picture file) | V: a saved picture item's file deleted from the media folder; Present, then Home: "1 picture, video or sound in the service is missing its file" |
| 10an.1 (no hidden traffic) | V: `lsof` on the running app showed one socket, the remote listener on 127.0.0.1, and no outgoing connections (speech, OBS and NDI off). 10an.2 (network off): U |

## Church folder between two computers (CL-005, CL-006: 10bc, 10bd)

Two profiles on this Mac as the home and church laptops, a local folder as the shared folder:

| Guide row | Result |
|---|---|
| 10bc.1 | V: Publish wrote "QA Sunday 2026-10-25 v8 <checksum>"; after Approve, Publish wrote a second v8 file; Publish again: "already in the church folder" |
| 10bc.2 | V: a change, Save, Publish wrote v9; the earlier files untouched |
| 10bc.3 | V: church Home → Church folder: one row "v9 · 5 items · not approved · 2 older versions" (v8 was the approved one) |
| 10bc.4 | V: Open brought it in as a new service with its items, not approved here; the row then says "opened here" |
| 10bc.5 | U: needs a real sync client or NAS |
| 10bd.1 | V: after home published v10 (approved): church Home "v10 · approved · newer than the copy opened here"; Prepare: "A newer version (v10, approved) is in the church folder. This one is v9." The open v9 copy unchanged |
| 10bd.2 | V: "Open the newer one" opened v10 as its own service; v9 kept |
| 10bk.1 | V: Pastor Ade's comment on John 3:16 saved and published; no output shows it |
| 10bk.2 | V: Tolu opening it saw "1 new comment" ("Pastor Ade on John 3:16 · Please read this slowly"); Mark as read cleared it |
| 10bk.3 | F → V: Tolu's reply was published as "v3" under his own copy's id, so the folder showed it as a separate service and Pastor Ade was never told. A copy opened from the folder now publishes as a newer version of the same service (v12 after v11), and the computer that made it is told: "A newer version (v12) is in the church folder. This one is v11." Opening it: "1 new comment", Tolu's only |

## Slide-change latency (QA-007, NFR-03)

Measured by the output windows' own send-to-drawn log (#125), 20 changes per line, Next/Previous across slides, songs, verses and a picture, on this i7-8569U (not a low-end PC):

| Output | Median | Slowest |
|---|---|---|
| Projector window, 1920×1080 | 6–10 ms | 73 ms |
| NDI 1280×720 @ 30, before this change | 90–99 ms | 110 ms |
| NDI 1280×720 @ 30, frames sent as raw bytes | 27–29 ms | 60 ms |

The NDI time was mostly turning each frame (3.7 MB of pixels) into base64 text in the output window; the frame now goes as the raw request body. A receiver built on the NDI SDK got 31 frames in 5 s at 1280×720 (6 before, with the same still content and keep-alive).

## Injected failures (QA-002)

| Case | Result |
|---|---|
| Import a 300 MB video from a USB stick (disk image) and pull it at 0.7–4.4 s, seven times | V: each import reports "could not read: Input/output error"; nothing is registered and no file is left in the media folder; the app answered other requests within 0.4 s throughout (the import no longer holds the database, #157). The pulls all landed while the file was read for its checksum; the copy phase (written beside and renamed) was not hit |
| Back up to a stick that has been pulled (10bl.1) | V: "Could not write the backup there"; creating and saving a service and quick screens keep working |
| Restore from a stick that has been pulled (10bl.2) | V (drill R5): "Could not read the backup"; services unchanged |
| A backup or service file cut short, or a tampered service file | V (drill R5): refused, nothing changed |
| Network cable / Wi-Fi off during a service (10an.2), OBS dropping | U: would change the owner's network or OBS |

## Backup and restore drill (QA-010)

Run the same day with two isolated profiles (production and standby) and a disk image as the USB stick: R1–R5 all pass; see `14-backup-restore-rehearsal.md`. Approval is not carried in a service file (only in a database backup).

## Fixed on this branch

1. **Intel macOS build failed.** Tauri passes `bundle.macOS.minimumSystemVersion`
   (default 10.13) as the deployment target, and whisper.cpp uses
   `std::filesystem` (macOS 10.15), so `tauri build --target x86_64-apple-darwin`
   stopped in `ggml-backend-reg.cpp`. Set to 10.15 (Tauri 2's own minimum).
2. **Pictures never loaded on macOS** (and the media folder was unreadable on
   every platform through the file plugin): capability fixed as above.
3. **IPC fell back to postMessage** on every start: CSP fixed.
4. **New installs started in the Amplified Bible**, not KJV.
5. **`/api/v1/health` reported 0.1.0.**

## Observations (not defects)

- OYCB's book names are stored in English in the bundled library, so a
  Yorùbá-only screen is headed "JOHN 3:16".
- The queue adds new items at the top and keeps one item per verse whatever its
  translation (a second translation is set on the item, as above).
- A still slide goes out over NDI on each change plus a keep-alive every
  2 seconds, so a receiver sees about 0.5 frames per second until something
  changes.
- The first-run walkthrough still points at the classic dashboard (owner
  request: rewrite it for the Studio workspaces; follow-up PR).

## Artifacts

The current clean build (no QA bridge: the binary has no bridge code), built from
`main` at `4a8b4fb` (everything through #177: hymn book, numbered books in Quick find, the item fields, the song footer, end-by rounding, Yorùbá quick screens, QR slide names),
is on the owner's Desktop, not published anywhere:

| File | Size | SHA-256 |
|---|---|---|
| `~/Desktop/Rhema-Intel-QA/latest-2026-10-22/Rhema-0.3.2-intel-x86_64.dmg` | 841 MB | `3a7b604f02dd4f85c023049edd53b29e210bd0a5b77545a815d3a6515f78def1` |
| `~/Desktop/Rhema-Intel-QA/latest-2026-10-22/Rhema.app` (executable `Contents/MacOS/Rhema`) | 1.0 GB | `4cc1904f881a50fa3b5cdbcc0c3721d94377cd836dfa0822faa79a16a0a4fdc1` |

The older copy in `~/Desktop/Rhema-Intel-QA/` (from `e343c52`) is the one the owner was running; it is left alone.

- Mach-O x86_64 only; signature ad hoc, identifier `com.openbezal.rhema`;
  `spctl` rejects it (not notarised), as expected for a local build.
- The bundle carries the Bible library (8 translations), licences, the Whisper
  model, the NDI runtime and ONNX Runtime with its libraries.
- **It uses the normal app identity**, so opening it uses the owner's real
  Rhema data (`~/Library/Application Support/com.openbezal.rhema`) and runs any
  pending migrations (a backup is taken before migrating). The existing
  `/Applications/Rhema.app` was not replaced. The pre-test backup of the data
  is at `~/Library/Application Support/com.openbezal.rhema.qa-backup-20261021`.
- A clean smoke launch on an isolated profile started without errors and
  without the IPC fallback warning.
