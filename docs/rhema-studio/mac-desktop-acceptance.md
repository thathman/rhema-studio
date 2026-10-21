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
`main` at `9ff09db` (includes the bilingual theme controls #165 and the Studio tour #166),
is on the owner's Desktop, not published anywhere:

| File | Size | SHA-256 |
|---|---|---|
| `~/Desktop/Rhema-Intel-QA/Rhema-0.3.2-intel-x86_64.dmg` | 842 MB | `d7234fd716a5cd27281d76b061fdf919a6378c4d2cdafa3168a3e1d58029483b` |
| `~/Desktop/Rhema-Intel-QA/Rhema.app` (executable `Contents/MacOS/Rhema`) | 1.0 GB | `1029226da1c544a1b7b9000dff738d791494d4b271a8aa21ff6f1180d5b07ddc` |

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
