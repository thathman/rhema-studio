# Changelog

Rhema Studio is a fork of [Rhema](https://github.com/openbezal/rhema) (MIT, upstream 0.3.2). This file records what the fork adds; the upstream history stays in its own repository. No Rhema Studio release has been published yet; everything below is **unreleased**, merged on `main`, and not yet accepted on a real desktop (see `docs/rhema-studio/08-desktop-acceptance-guide.md`).

## Unreleased

### Workspaces and safety
- Home, Prepare, Present and More; Standard and Production Present views; clear Preview vs Live; Quick Find across verses, hymn numbers and songs.
- Live safety: one writer per content kind, nothing goes on air before it has loaded, a slow lookup can never overtake a newer command, Clear/Restore, quick screens with Back, rehearsal freeze.
- Quick screens: Welcome, Please stand, Let us pray, Offering, Technical issue, the church logo and Black, each with Back; they fit on a 1366x768 screen.
- Outputs keep the last good frame if a new screen cannot be drawn, and say so.
- Deletes of service logs and media files ask first; closing with an unsaved service asks to save; one copy of Rhema runs at a time and closing its window quits it.
- Readiness on Home: Bible, theme, outputs (per output, NDI receivers, monitor disconnected or shared), missing songs/pictures/videos, fonts, signage loops, approval, unavailable content database.

### Scripture and languages
- Yoruba (Open Yoruba Contemporary Bible, CC BY-SA 4.0) and dual-language display; saved items keep their translation; missing translations are reported, never substituted; one language per output.
- References in the forms people type: "Jn 3 16", "1 Sam 3:4", "I Samuel", Mt, Mk, Lk, Php, 1 Pt and other common short names.

### Accessibility
- Icon buttons and sliders have names for screen readers; theme cards work from the keyboard; the red live buttons meet WCAG AA contrast.
- Status colours (ready, needs attention, confidence) are readable in light mode.

### Search and safety
- Your data is safer: settings and themes come back after a crash during a save, closing Rhema writes the last changes and keeps the service log, pictures and songs used on screen cannot be deleted, and the Theme Designer asks before discarding edits.
- Clear and Restore are reliable: while cleared, clicking verses only changes the preview, and the status reads "Off air · Restore shows …". Verse + never replaces a song on air, a quick screen keeps your place in a song, and Back asks for approval like any go-live.
- Fixes where the day's changes met: a heard verse never brings up the approval question; after deleting the live item, Next and Previous go to the items either side; a live song's Preview matches what is on air.
- Speech recognition keeps its transcript and warnings whichever view is open; a remote "confidence" level decides how sure a heard verse must be for Auto. The first-run tour returns you to where you were. Next chapter in the Bible panel moves on to the next book.
- Timers: planned-end and end-by times stay right after the laptop sleeps; Start the service never wipes a running timer; Reset asks first and is logged. Cue steps run one after another. Video sound plays from one congregation output.
- Remote control starts again with Rhema as you left it (a listener open to the whole network with no key waits for you). A phone press is never carried out twice when the Wi-Fi drops an answer, and the phone shows rehearsal and pending approval questions.
- A damaged settings or themes file is kept aside and reported instead of being silently replaced. Stage screens and service-file export no longer slow the outputs down.
- Keyboard: Next and Clear never act behind an open dialog or menu (a clicker still works with a popover open); Ctrl+1–4 never discards a song you are editing; Enter in Quick find always previews what you typed. Songs whose titles start with an accented letter sort with their letter.
- Opening Present, switching views, or a preacher naming a translation no longer re-renders what is on screen. Changing a live song's arrangement takes effect the next time the song starts; deleting a live song no longer traps Next; Verse +/− keeps your place.
- Next always goes to the item after the one on screen, also after adding, removing or reordering items during the service. Heard verses no longer change your place or add themselves to an open service.
- Verses heard by speech recognition wait in the preview until Show live. Auto (heard verses go straight on air) is off, also after updating; turn it on again under Live display or Settings → Display Mode if you rely on it.
- Backing up to, or restoring from, a USB stick or network share that stalls no longer freezes the app or its outputs.
- Quick find accepts the Yorùbá Bible's book names, with or without accents ("Jòhánù 3:16", "1 Ọba 3:9").
- macOS: Cmd+Q asks about unsaved service changes, like closing the window.

### Services
- Song editor: Yorùbá headings (Ègbè, Ẹsẹ̀) are recognised however typed, and a song exported as text pastes back without heading lines. Saving a live song's words takes effect the next time it starts. Church brand: Apply never deletes a theme an output uses, and a renamed brand theme keeps its name.
- Home's readiness is stricter and truer: verses saved for a translation not installed here, missing background pictures and items from a newer version are flagged; no false 'missing file' after opening from the church folder. Restoring the approved version keeps it approved. Opening a newer church-folder file names songs whose words differ from this computer's.
- Every saved detail counts as a change (video loop and sound, QR addresses); details from a newer version are kept when saving. Closing asks about an unsaved song and an unsaved rundown too. A song changed elsewhere can be kept as a new song. A theme an output uses cannot be deleted.
- A song can carry its backing track; Present offers it under Sound while the song is up (plays only when you press Play).
- Team comments on any item (never on screen); they travel with the service file, and "n new comments" shows what others wrote.
- Optional: ask before the first go-live of a service that is not approved (More; off by default; never mid-service).
- Items can say who is preparing them; History shows who saved each version.
- Church folder: publish services to a NAS or synced folder as versioned files and open the newest at church (no account, no server); a newer version of the service you opened is pointed out, never opened by itself.
- Rename and re-date a saved service; mark services as templates and start new ones from them; archive old services; approval records who approved.
- Saved services in a local SQLite database with history (last 50 versions; the approved one is kept), approval with preflight, copy, reuse items from earlier services, planned and actual timing, service log (kept and searchable), one service as a checksummed file.

### Songs
- Songs and hymnbooks with sections per language, arrangements, key and tempo, chord charts and sheets, typo-tolerant search, OpenLyrics import and export, Rhema JSON import/export.
- Songs as plain text/Markdown (Text… in the song editor); pasted lyrics may use "## Chorus", "**Verse 2**" or "[Bridge]" headings.

### Archive
- The service log is accurate: what goes on air when rehearsal ends is logged, quick screens are named, and planned vs actual lists every item (including ones never shown and ones added on the day) and anything else shown.
- Optionally keep what was said (the recognised transcript) with a service log, searchable later; off by default.
- Song usage report for licence (CCLI) reporting: songs per date range with CCLI numbers and service counts, saved as CSV.

### Slides and media
- Responsive readings: paste with L: and P: marks; one slide per exchange.
- Custom slides, announcements, QR link slides (offline), long text as one slide per paragraph; pictures and videos from a hashed media library (videos streamed, sound from the main output only); background pictures with automatic contrast; brand kit and themes with logos.

### Timing
- The service timer shows the planned end and, when running late or early, when the service now looks like ending; it can be corrected a minute at a time, noted in the service log. An item can have an "end by" time, counted down while it is in hand.

### Sound
- A sound player in Present for walk-in music and backing tracks (MP3, M4A, WAV, OGG from the media library): play, pause, 3-second fade out, stop, repeat, volume; logged; never changes a screen. Sounds can also be service items that start when Next reaches them (not in rehearsal).

### Outputs and production
- Output roles (congregation, stage, signage); stage display with messages, timer, key/tempo; signage loops with playlists and schedules; lower thirds on opted-in outputs; multiview in Outputs; NDI trouble detection with one automatic restart.
- Remote control over OSC and HTTP with macros, a this-computer-only option, an optional shared key, device pairing, revocation and roles; a phone remote page paired by scanning a QR code; per-sender rate limiting.
- Your own cues: named sequences of the same safe actions, run from Present or by id from a Stream Deck/OSC controller.
- Optional OBS connection: OBS's own recording status, start/stop, sermon marks as log lines and chapters.

### Data and operations
- Automatic copy before every database upgrade; backup and restore; older builds refuse a newer database and say why (`docs/rhema-studio/17-database-migrations.md`); settings tolerate older and damaged files; API keys, the remote key and the OBS password kept in the system keychain; diagnostics export redacts secrets; dependency licence check in CI; the installer shows a licence page and ships the MIT licence and every third-party licence text; cloud speech asks before microphone audio first goes to Deepgram; no telemetry, and a test that fails if code names an unlisted internet host (`docs/rhema-studio/18-network-and-privacy.md`).
