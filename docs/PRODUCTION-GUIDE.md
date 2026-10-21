# Rhema Studio — production operator guide

For the person running outputs, OBS and the stage screen. The volunteer guide (`docs/QUICK-START.md`) covers the Standard view; this page covers everything behind it.

## Outputs (More → Outputs)

- Each output is a window on a monitor or an NDI sender, with its own theme and a role:
  - **Congregation**: the themed frame (verses, lyrics, slides, pictures, quick screens).
  - **Stage**: plain high-contrast text — the live words in every language, NEXT, the operator's note, key and tempo for a song, the timer, and any message you send.
  - **Signage**: library pictures on a loop (so many seconds each) for a foyer screen, optionally only on set days and times (local clock; outside the window the theme background shows). Nothing in the service changes it: going live, Clear, rehearsal and theme edits leave it alone.
- Removing one output never touches another. Home lists every output as on/off and warns when only the stage is on.
- A theme's **logo** draws in a corner; it is hidden on transparent (OBS) themes unless you tick "Show on transparent".

## OBS and NDI

- **OBS connection (optional):** Settings → Remote control → "Connect to OBS" with OBS's address, port (4455) and WebSocket password (OBS → Tools → WebSocket Server Settings). The Present header then shows OBS's own recording state and time ("OBS ● REC 00:12:31" or "not recording"; never guessed). From its menu: start or stop recording (each asks twice), and mark "Sermon start", "Sermon end" or anything else: the mark goes into the service log with the recording time, and into the recording as a chapter on OBS 30.2+ recording to Hybrid MP4. If OBS is closed, Rhema retries every 15 seconds; nothing else depends on it.

- Use a transparent theme (for example the Lower Thirds builtin) on an NDI output for keying. Pictures and quick screens key like verses; background pictures fill the frame, so use them only on the congregation output.
- NDI frames come from the output window's canvas; a stage output does not send NDI.
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

Macro ids: `service-start`, `offering`, `prayer`, `service-end`, plus your own: Present → Cues → New cue… builds one from the same actions (Next, Clear, quick screens, timer, stage message, rehearsal off) in the order you choose; it is saved on this computer and its id (from its name, e.g. `baptism`) is shown under it for a Stream Deck or OSC controller. Present → Cues shows each macro's steps.

**Phone remote:** start the HTTP API with "Accept commands from other devices on this network" ticked, press "Pair a device", and scan the QR code with a phone on the same Wi-Fi. It opens a page with big Next, Previous, Back on air and Clear buttons and what is on air; press Pair once. Without the camera, open the address shown under the code and type the six digits. The phone stays paired until it is revoked.

**Who can send these:** anyone on the network while a listener runs, unless you set a key or pair devices in Settings → Remote. Pairing: start the HTTP API, press "Pair a device", and on the phone or controller send the six-digit code once to `/api/v1/pair`; it receives its own token (HTTP header `X-Rhema-Key`, or first OSC argument) and can be revoked on its own later. Start a listener just before the service and stop it after; if the controller software runs on this laptop, untick "Accept commands from other devices on this network" so only this computer is accepted. Details: `docs/rhema-studio/13-remote-control-threat-notes.md`.

## Sound (walk-in music, backing tracks)

Import MP3, M4A, WAV or OGG files in Prepare → Media (they are listed under Sounds). In Present, the ♪ button in the header lists them: Play, Pause/Resume, Fade out (3 seconds), Stop, Repeat and Volume. One sound plays at a time, on this computer's sound output; no screen changes, and NDI carries no sound. Each Play is a line in the service log. Rehearsal mode does not silence the ♪ button: Play there is always a deliberate press.

A sound can also be a service item (Prepare → Media → Sounds → Add): when Next reaches it, the sound starts and every screen keeps what it shows; Next then carries on to the item after it. It plays only when reached going forward: Previous steps over sound items, and Next at the end of the service does not replay a last sound. The rundown shows "playing" next to it. In rehearsal a sound item does not play (Present says so).

## Lower thirds

Present → Lower third: a name and an optional title, shown as a band near the bottom of the outputs where "Show lower thirds" is on (Outputs → edit; usually the NDI stream with a transparent theme). It stays up through Next, Clear and new items until you press Hide. The projector shows it only if you turn it on for the projector; stage and signage screens never show it.

## Videos

Prepare → Pictures → "Import pictures or videos…" takes MP4, MOV, M4V and WebM (MP4 with H.264 plays everywhere). A video item plays on every congregation output, streamed from the media folder; **sound comes from the main output only**, so two screens never echo. Per item: Loop (otherwise it holds the last frame) and Sound. NDI carries the picture, not the sound; an NDI-only output in a hidden window may send fewer frames per second on some systems (check before relying on it). Very large videos make the "service as a file" export large, because the file travels inside it.

## QR links on screen

Prepare → Slides → "QR link": type a full `https://…` address (giving, sign-up, the bulletin). The code is drawn in the app, offline, on a white panel with the address printed beside it, so people see where it goes; nothing is tracked. Only plain http(s) links are accepted. The preview shows the words; the code appears on the outputs.

## Timing and the stage

The service timer (Present header) also shows, once items have planned minutes and the timer runs, the planned end time and, when the service is a minute or more off plan, when it now looks like ending ("Planned end 12:30 · now about 12:41"). If the timer was started late, "Correct the timer" moves it by a minute either way; each correction is a line in the service log.

An item can also have an **end by** time (Prepare, beside its planned minutes: "sermon ends by 12:15"). While it is the item in hand, the timer chip shows "by 12:15 · 6 min", amber in the last two minutes and red once the time has passed.


- **Timer**: monotonic (ignores clock changes); amber under two minutes, red when over. Planned minutes per item give "n min late/early".
- **Message stage**: a framed banner on stage outputs only. Clear it from the same control.
- **Rehearsal**: freezes every output at what it shows; turn it off to push the current content everywhere.

## Data safety

- Every save of a service is a version (Prepare → History): compare and restore; a restore is itself a new version. **Approve** (Prepare, next to Save) pins the saved version as the one for the day: History marks it, it is never pruned, and Home warns when the service has changed since.
- More → Library: **Save this service as a file** carries one service with its songs and pictures to another computer (checksummed; a damaged file is refused). Export/import songs (Rhema JSON, OpenLyrics), and **Back up now / Restore** for the whole database. A restore refuses files that are not a Rhema Studio database and keeps the previous database as a snapshot next to it.
- Before any upgrade the app copies the database to `studio.db.before-<migration>.bak`.

## Church folder (prepare at home, present at church)

More → Library → Church folder → Choose folder…: a NAS share, or a folder kept in step by Google Drive, OneDrive, Dropbox or Syncthing, chosen on every computer. In Prepare, **Publish** puts the saved service there as a new file named with its date, version and a short checksum (`Sunday 2026-10-25 v7 3f9a0c21b7d4.rhema-service.json`); older versions stay. Approving and publishing again makes a new file that says so. On Home, **Church folder** lists the newest version of each service (approved at home or not, opened here or not); **Open** adds it on this computer with its songs and pictures. Approve it again here before Sunday. If someone publishes a newer version later, Prepare says "A newer version (v8) is in the church folder" above the service you opened, and Home marks the row "newer than the copy opened here"; **Open the newer one** adds it as its own service and keeps yours. Nothing is replaced by itself. A file still syncing shows as "damaged … may still be syncing" and cannot be opened until it is complete.

## Song usage (licence reports)

More → Library → Song usage: choose a date range (default: the last six months), Show, then Save as CSV… The report counts saved services dated in the range (a song sung twice in one service counts once), with each song's CCLI number, licence and last use, ready to copy into a CCLI (or other licensing body) report. Services without a date are not counted, so give each service its date.

## Translations

- A saved item goes live in the translation it was saved with; spontaneous verses follow your active translations. The Present header chip switches to "Override" to show everything in the current translation. A missing translation is reported, never substituted.

## Who did what

More → Your name is optional and local. When set it is written on every change (saves, approvals, imports) in the content database's audit table and at the top of the saved service log.

## Diagnostics

Settings → Diagnostics → Save logs. Each output also logs how long screens take to appear: a "[latency]" summary every 20 changes (median and slowest, from send to drawn) and a warning for any change over 100 ms, so a slow computer shows up in the saved logs. The content database path and applied migrations are shown in More → Library.
