# Rhema Studio — production operator guide

For the person running outputs, OBS and the stage screen. The volunteer guide (`docs/QUICK-START.md`) covers the Standard view; this page covers everything behind it.

## Outputs (Production → Screens → Open outputs, or Settings → Outputs)

- Each output is a window on a monitor or an NDI sender, with its own theme and a role:
  - **Congregation**: the themed frame (verses, lyrics, slides, pictures, quick screens).
  - **Stage**: plain high-contrast text — the live words in every language, NEXT, the operator's note, key and tempo for a song, the timer, and any message you send.
  - **Signage**: library pictures on a loop (so many seconds each) for a foyer screen, optionally only on set days and times (local clock; outside the window the theme background shows). Nothing in the service changes it: going live, Clear, rehearsal and theme edits leave it alone.
- Removing one output never touches another. Home lists every output as on/off and warns when only the stage is on.
- A theme's **logo** draws in a corner; it is hidden on transparent (OBS) themes unless you tick "Show on transparent".

## OBS and NDI

- **OBS connection (optional):** Settings → Remote control → "Connect to OBS" with OBS's address, port (4455) and WebSocket password (OBS → Tools → WebSocket Server Settings). The Present header then shows OBS's own recording state and time ("OBS ● REC 00:12:31" or "not recording"; never guessed). From its menu: start or stop recording (each asks twice), and mark "Sermon start", "Sermon end" or anything else: the mark goes into the service log with the recording time, and into the recording as a chapter on OBS 30.2+ recording to Hybrid MP4. If OBS is closed, Rhema retries every 15 seconds; nothing else depends on it.

- Use a transparent theme (for example the Lower Thirds builtin) on an NDI output for keying. Pictures and quick screens key like verses; background pictures fill the frame, so use them only on the congregation output.
- **Browser Feed** (a kind of output, ARCH-002): a web page on the church network instead of a window or NDI sender. Start the HTTP listener on the network (Settings → Remote control), add an output of kind Browser Feed, copy its link from the output's settings and paste it into OBS (Browser source, 1920×1080) or open it in a TV's browser; turn the output on. It shows exactly what the output would: its looks, scene, sources, lower third and ticker; transparent where the look is keyed. Anyone with the link can watch it on the network: **New link** closes the old one. Videos do not play in a browser feed.
- **What this output follows** (ADR 0001): "Everything put on air" (the default) shows the latest thing shown, as the projector does. "Only these" makes a feed that follows chosen sources: Bible, Songs, Hymns, Slides, Pictures. Each source keeps its own live value, so a Bible feed for OBS keeps the verse while a hymn is on the projector and changes the moment the next verse is shown; no one has to pick destinations. Give it a lower-third look for Bible under "Looks by kind". Black and Logo cover every feed. Present → Live → Sources lists what the feeds hold, with a take-off and Restore for each.
- NDI frames come from the output window's canvas. A stage output sends NDI too (the stage view is drawn on the canvas, #191), so an NDI viewer on the platform can be the stage display.
- Health: Home → outputs line (for an NDI output it also says how many receivers are connected, so "nobody receiving yet" means OBS has not picked the source up), Present header "n/m outputs on". If NDI frames stop reaching the network, a warning names the output, readiness shows "not sending", and the app restarts the sender once a minute at most; after that turn the output off and on yourself.

## Remote control (Settings → Remote)

OSC addresses and HTTP commands do exactly what the buttons do, with the same safety rules (nothing goes on air before it has loaded):

| Action | OSC | HTTP `{"command": …}` |
|---|---|---|
| Next / Previous item or slide | `/rhema/next`, `/rhema/prev` | `next`, `prev` |
| Show the preview live | `/rhema/send_to_live` | `send_to_live` |
| Continue the reading | `/rhema/verse_next`, `/rhema/verse_prev` | `verse_next`, `verse_prev` |
| Step the Bible panel (preview only) | `/rhema/bible_next`, `/rhema/bible_prev` | `bible_next`, `bible_prev` |
| Output on / off | `/rhema/show`, `/rhema/hide`, `/rhema/on_air <bool>` | `show`, `hide`, `on_air` |
| Run a macro | `/rhema/macro "service-start"` | `macro` with `"value": "service-start"` |
| Theme, opacity, confidence | `/rhema/theme <name>`, `/rhema/opacity <0–1>`, `/rhema/confidence <0–1>` | `theme`, `opacity`, `confidence` |

`confidence` sets how sure speech recognition must be before Auto puts a heard verse on air (default 0.8); below it the verse waits in the preview.

Macro ids: `service-start`, `offering`, `prayer`, `service-end`, plus your own: Present → Cues → New cue… builds one from the same actions (Next, Clear, quick screens, timer, stage message, rehearsal off) in the order you choose; it is saved on this computer and its id (from its name, e.g. `baptism`) is shown under it for a Stream Deck or OSC controller. Present → Cues shows each macro's steps.

**Phone remote:** start the HTTP API with "Accept commands from other devices on this network" ticked, press "Pair a device", and scan the QR code with a phone on the same Wi-Fi. It opens a page with big Next, Previous, Back on air and Clear buttons and what is on air (or that rehearsal is on, or that the computer is waiting for an approval answer); press Pair once. If the Wi-Fi drops an answer the phone tries again by itself and the computer never does one press twice; "No answer…" means check the screen before pressing again. Without the camera, open the address shown under the code and type the six digits. The phone stays paired until it is revoked. What the phone shows (on air, rehearsal, waiting for approval) follows the computer within a second, also when the Rhema window is minimised or behind another app.

**Who can send these:** anyone on the network while a listener runs, unless you set a key or pair devices in Settings → Remote. Pairing: start the HTTP API, press "Pair a device", and on the phone or controller send the six-digit code once to `/api/v1/pair`; it receives its own token (HTTP header `X-Rhema-Key`, or first OSC argument) and can be revoked on its own later. Start a listener just before the service and stop it after (a listener left running starts again, the same way, the next time Rhema starts, unless it accepted other devices with no key or paired device: that one waits for you, with a message); if the controller software runs on this laptop, untick "Accept commands from other devices on this network" so only this computer is accepted. Details: `docs/rhema-studio/13-remote-control-threat-notes.md`.

## Sound (walk-in music, backing tracks)

**Backing track for a song.** In the song editor, add the track (MP3, M4A, WAV, OGG) under "Chord charts, sheets and backing tracks". In Present, while that song is on air or is the item you are on, the Sound button lists "Backing track for <song>" above the other sounds. It plays only when you press Play; screens are not changed.

Import MP3, M4A, WAV or OGG files in Prepare → Media (they are listed under Sounds). In Present, the ♪ button in the header lists them: Play, Pause/Resume, Fade out (3 seconds), Stop, Repeat and Volume. One sound plays at a time, on this computer's sound output; no screen changes, and NDI carries no sound. Each Play is a line in the service log. Rehearsal mode does not silence the ♪ button: Play there is always a deliberate press.

A sound can also be a service item (Prepare → Media → Sounds → Add): when Next reaches it, the sound starts and every screen keeps what it shows; Next then carries on to the item after it. It plays only when reached going forward: Previous steps over sound items, and Next at the end of the service does not replay a last sound. The rundown shows "playing" next to it. In rehearsal a sound item does not play (Present says so).

## Lower thirds

Present → Lower third: a name and an optional title, shown as a band near the bottom of the outputs where "Show lower thirds" is on (Outputs → edit; usually the NDI stream with a transparent theme). It stays up through Next, Clear and new items until you press Hide. The projector shows it only if you turn it on for the projector; stage and signage screens never show it.

## Videos

Prepare → Pictures → "Import pictures or videos…" takes MP4, MOV, M4V and WebM (MP4 with H.264 plays everywhere). A video item plays on every congregation output, streamed from the media folder; **sound comes from the main output only**, so two screens never echo. Per item: Loop (otherwise it holds the last frame) and Sound. NDI carries the picture, not the sound; an NDI-only output in a hidden window may send fewer frames per second on some systems (check before relying on it). Very large videos make the "service as a file" export large, because the file travels inside it.

## QR links on screen

Prepare → Slides → "QR link": type a full `https://…` address (giving, sign-up, the bulletin). The code is drawn in the app, offline, on a white panel with the address printed beside it, so people see where it goes; nothing is tracked. Only plain http(s) links are accepted. The preview shows the words; the code appears on the outputs.

## Scenes for the congregation (Production → Programs)

- A scene places live content, colours, Library pictures and camera places on one frame. Each live layer follows chosen sources (Bible, Songs, Hymns, Slides, Pictures) or whatever is on air, in a look from Design (or the output's own looks). **Hold what it shows now** keeps a layer on one verse while the rest follows; **Follow live again** releases it.
- Arrange: drag a layer to move it, drag its corner to resize, arrow keys to nudge (Shift for 5%). Box, crop and opacity can be typed. Layers draw bottom first; reorder them in the list.
- **Take** puts the scene on the chosen congregation output (it saves first). **Back to its own feed** returns the output to full frame; **Restore** takes the scene again. Taking a scene changes no other output (OBS feeds stay as they are), and a new verse never changes which scene is up. Black and Logo cover every screen and feed, scenes included.
- Edits stay in the composer until Save or Take. Cameras are planned (#209): a camera layer keeps the camera's place and shows the background there until then.

## Operators: host and join (Production → Operators)

- **Host:** the computer that runs the service keeps every control. Start the HTTP listener on the network (Settings → Remote control), then **Pair a device** and give the code to the operator. Set each paired device's role there: **Timekeeper** moves only the event clock; **Bible** activates a typed reference and steps it (the main screens take it only when no song, hymn or slide is up there; the Bible feeds always do); **Screens** takes scenes to congregation outputs; **Present** does all of these and moves through the service; **Present and settings** adds settings.
- **Join:** on the other computer, Production → Operators → Join a host: the host's address and port (shown in Settings → Remote control on the host), the code and a name. The joined desk shows what is on the host's screens, the live sources, the run of show with **Now**, and the expected end; a Timekeeper starts the next event, goes back one or starts any event. Nothing there changes a screen.
- **Notices** (the bell on the main desk; Notices on a joined desk): a short private message to everyone, the main desk or a role, optionally urgent, tied to the event happening now. Answer **Seen**, **Ready** or **Unable**; the sender and everyone else see the answer. Nothing here reaches a screen or the service log.
- **Action requests** (a notice that asks for something): under the message choose **Ask to show a verse** (type the reference), **Ask to take a scene** or **Ask to start an item**. The recipient gets one button for it ("Show Romans 8:28", "Take Camera + lyrics", "Start Sermon"); nothing happens until they press it, then it answers Ready. It runs with the recipient's own permissions: a Timekeeper's desk can start an item, not show a verse. A scene request switches the outputs already showing a scene (else the main output).
- If the network drops, the joined computer says *Reconnecting…* and catches up by itself; the host carries on. **Leave** stops following; **Forget this host** also drops its key (revoke the device on the host to be sure).

## Timing and the stage

The service timer (Present header) also shows, once items have planned minutes and the timer runs, the planned end time and, when the service is a minute or more off plan, when it now looks like ending ("Planned end 12:30 · now about 12:41"). If the timer was started late, "Correct the timer" moves it by a minute either way; each correction is a line in the service log.

An item can also have an **end by** time (Prepare, beside its planned minutes: "sermon ends by 12:15"). While it is the item in hand, the timer chip shows "by 12:15 · 6 min", amber in the last two minutes and red once the time has passed.


- **Timer**: monotonic (ignores clock changes); amber under two minutes, red when over. Planned minutes per item give "n min late/early".
- **The event clock** (Production → Timekeeper): which event of the run of show is happening, kept apart from the screens. **Follows the screens** (default): an item's event starts when its content goes on air. **I start each event**: only Start / Back one move it, so a timekeeper can run the times while others show verses and songs out of order. Timing, the stage finish line and each item's message and cue follow it; the service log records each event start.
- **Message stage**: a framed banner on stage outputs only. Clear it from the same control.
- **Rehearsal**: freezes every output at what it shows. Turning it off puts back the program, lower third, ticker, stage message and service timer as they were (nothing rehearsed is shown or logged); **Show this live** leaves rehearsal and puts the rehearsed screens on air (the approval question applies), everything else still coming back. A loop or timed move running on air waits through rehearsal and carries on after.
- **Design → Themes → Live edit**: off by default, so editing a theme the screens use changes nothing on air until you save. On, the screens using that theme follow your edits (the header says how many); it turns off when you leave the theme.

## Data safety

- Every save of a service is a version (Prepare → History): compare and restore; a restore is itself a new version. **Approve** (Prepare, next to Save) pins the saved version as the one for the day: History marks it, it is never pruned, and Home warns when the service has changed since.
- Archive: **Save this service as a file** carries one service with its songs and pictures to another computer (checksummed; a damaged file is refused), and **Back up now / Restore** for the whole database. A restore refuses files that are not a Rhema Studio database and keeps the previous database as a snapshot next to it. Library: export/import songs (Rhema JSON, OpenLyrics).
- Before any upgrade the app copies the database to `studio.db.before-<migration>.bak`.

## Church folder (prepare at home, present at church)

Archive → Church folder → Choose folder…: a NAS share, or a folder kept in step by Google Drive, OneDrive, Dropbox or Syncthing, chosen on every computer. In Prepare, **Publish** puts the saved service there as a new file named with its date, version and a short checksum (`Sunday 2026-10-25 v7 3f9a0c21b7d4.rhema-service.json`); older versions stay. Approving and publishing again makes a new file that says so. On Home, **Church folder** lists the newest version of each service (approved at home or not, opened here or not); **Open** adds it on this computer with its songs and pictures. Approve it again here before Sunday. If someone publishes a newer version later, Prepare says "A newer version (v8) is in the church folder" above the service you opened, and Home marks the row "newer than the copy opened here"; **Open the newer one** adds it as its own service and keeps yours. Nothing is replaced by itself. A file still syncing shows as "damaged … may still be syncing" and cannot be opened until it is complete.

## Keeping what was said (optional)

When speech recognition ran during the service, Archive → Service log offers "Include what was said". Ticked, the recognised passages (with times) are added to the log you keep or save; Earlier logs can then find a service by a phrase from the sermon. It is machine output, not checked; keep it only if the speakers know it is recorded. Off by default, every time.

## Song usage (licence reports)

Archive → Song usage: choose a date range (default: the last six months), Show, then Save as CSV… The report counts saved services dated in the range (a song sung twice in one service counts once), with each song's CCLI number, licence and last use, ready to copy into a CCLI (or other licensing body) report. Services without a date are not counted, so give each service its date.

## Speech recognition and Auto

While Rhema listens, verses it hears in the sermon appear in the preview and the detections list; the operator presents them. With a service open, a heard verse that is already in the service makes that item flash; it does not move Next and is not added to the service (add it from the detections list if you want it kept). Without a service open, heard verses collect in the list as before. **Auto** (the switch on the Live panel in Present → Production, or Settings → Display Mode → Heard verses) makes heard verses replace what is on screen without Show live. It starts off, also after updating from a build where it was on by default: turn it on again if your church relies on it; while it is on and Rhema is listening, Present shows "Auto-live on" in the header, and clicking it turns Auto off.

## Translations

Quick find takes a full reference, a book or chapter alone ("1 Samuel", "1 Kings 3", "Psalm 23": that chapter's first verse comes first, above any word matches), and ordinals in words ("First Samuel 3:10", and the Yorùbá order "Samuẹli Kínní 3:10", "Ọba Kejì 2:9").

Quick find understands the Yorùbá Bible's own book names as well as the English ones, with or without accents: "Johanu 3:16", "Jòhánù 3 16", "1 Ọba 3:9", "Ìṣe àwọn Aposteli 2:38" (or just "Ise 2:38"). The names are the ones printed in the bundled Yorùbá edition; other Yorùbá Bibles may spell some books differently (for example "Johannu").

- A saved item goes live in the translation it was saved with; spontaneous verses follow your active translations. The Present header chip switches to "Override" to show everything in the current translation. A missing translation is reported, never substituted.

## Hymn book (CAC Gospel Hymn Book)

Prepare → **Hymn book** lists the Christ Apostolic Church Gospel Hymn Book in English and Yorùbá, apart from the Songs library: **Part 1** (1–1000) and **Part 2 · Various** (V1–V50). Find a hymn by number (`245`; `V12` or `v012` for Part 2) or by words in either language; click to preview; **Add** puts it in the service. "First: Yorùbá / English" is remembered and sets the order of new items; each item's EN · YO chips still change it in the rundown.

- **Import:** the first time, **Import the hymn book…** and choose `hymns_combined.json`. The hymns are kept in this computer's database only; they are not part of the app or its repository. **Import the file again…** updates them in place (by number), so services that use them keep working; a number already used by one of your own songs in a "CAC" hymnbook is left alone and reported.
- **On screen** a hymn is a bilingual song: each verse with its chorus, both languages styled by the theme's first/second language settings, the footer "<title> · CAC Gospel Hymn Book 245". An output set to one language shows only that one. Quick find also finds `CAC 245`.
- Hymns never appear in the Songs tab, its count or its export.

## Who did what

Team → Your name is optional and local. When set it is written on every change (saves, approvals, imports) in the content database's audit table and at the top of the saved service log.

## Diagnostics

Settings → Diagnostics → Save logs. Each output also logs how long screens take to appear: a "[latency]" summary every 20 changes (median and slowest, from send to drawn) and a warning for any change over 100 ms, so a slow computer shows up in the saved logs. The content database path and applied migrations are shown in More → Library.
