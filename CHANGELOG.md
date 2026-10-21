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

### Services
- Optional: ask before the first go-live of a service that is not approved (More; off by default; never mid-service).
- Items can say who is preparing them; History shows who saved each version.
- Church folder: publish services to a NAS or synced folder as versioned files and open the newest at church (no account, no server); a newer version of the service you opened is pointed out, never opened by itself.
- Rename and re-date a saved service; mark services as templates and start new ones from them; archive old services; approval records who approved.
- Saved services in a local SQLite database with history (last 50 versions; the approved one is kept), approval with preflight, copy, reuse items from earlier services, planned and actual timing, service log (kept and searchable), one service as a checksummed file.

### Songs
- Songs and hymnbooks with sections per language, arrangements, key and tempo, chord charts and sheets, typo-tolerant search, OpenLyrics import and export, Rhema JSON import/export.
- Songs as plain text/Markdown (Text… in the song editor); pasted lyrics may use "## Chorus", "**Verse 2**" or "[Bridge]" headings.

### Archive
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
