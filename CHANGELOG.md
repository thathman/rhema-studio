# Changelog

Rhema Studio is a fork of [Rhema](https://github.com/openbezal/rhema) (MIT, upstream 0.3.2). This file records what the fork adds; the upstream history stays in its own repository. No Rhema Studio release has been published yet; everything below is **unreleased**, merged on `main`, and not yet accepted on a real desktop (see `docs/rhema-studio/08-desktop-acceptance-guide.md`).

## Unreleased

### The owner's redesign (in progress, 2026-10-22)
- New look (#194), then the owner's approved neutral design (issue #215, #218): warm stone canvas, white flat panels with a fine border, ink sidebar and live console, one deep-teal accent, brass sparingly, red only for live; IBM Plex Sans (bundled); the approved Home hero; a 194 px sidebar with the church's workspace tag (More tools removed); a top bar with Find anything, keyboard shortcuts and team activity. Accessibility pass against UI/UX Pro Max: AA contrast, 24 px targets, a skip link, reduced motion respected.
- Navigation: the sidebar (Home, Prepare, Present; Library, Design, Team, Archive; More tools, Settings, who is at the desk) and a top bar (where you are, works offline, light/dark); Cmd/Ctrl+1-7 and Cmd/Ctrl+, (#195). Library, Design, Team and Archive open the existing library, Theme Designer and More tools until they become pages.
- Design (approved design): the theme editor on a light sage stage (dark in dark mode) with light toolbars; the sections as underline tabs; "More ways to use this look" jumps to lower thirds, the ticker, the stage display and the brand kit (#240, UX-14).
- Team, Archive and Settings (approved design): Team's page head and teal hero ("One church. One shared plan.") with the church folder and phone remote; Archive's month at a glance and Past services (date tile, approval, Open) above the service log, song usage, sharing and backups; Settings' sections in a panel with the section title at the design's size (#239, UX-14).
- Library (approved design): "Everything in its place" with Import files and New song; pills for Songs & ministrations, Hymn book, Pictures & videos, Import & export; songs as cards (a flat cover by kind; hymn number, languages, authors, licence; Edit and Add to service) (#238, UX-14).
- Production (approved design): a Production page in the sidebar (⌘8) with Timekeeper (the service clock, planned vs expected, hold, other timers), Screens (every output and its state) and Show health (the readiness checks); the two-program, camera and operator tabs say they are planned (#208, #209, #197) and offer no controls (#237, UX-14).
- Prepare to the approved design: "<Sunday> run of show." with Present service; the event at a glance (date and start, planned service, warm-up, projected finish) above the service controls; phase cards; the event editor's Slides (with the preview), Confidence, Notes, Signals and Timing tabs; the show scheduler in the right column (#236, UX-14).
- Present to the approved design: "Live console" with what is on air and the view on one row and the live tools on the next; an Automated phases strip starts and stops the loops and the warm-up (the main service stays manual); phases as bands in the running order; an empty Program says "Nothing on air" (#235, UX-14).
- Present is the live console: always dark; running order, Preview and Program, one transition row, Find & cue, One-touch moments and the ticker row; fits down to 1024x600 (#199).
- Home: hero with a readiness note, stat cards, Sunday at a glance, Your attention (#200).
- Find anything (Cmd/Ctrl+K): places, design and settings sections, this service's items (previewed), and scripture, hymns and songs through Present's Quick find (#202).
- Prepare as a run of show (issue #193): the order of service, an item editor (Content, Notes & team, Timing) and the preview side by side, the sources in Add item (#204); phases (pre-service loop, warm-up, main service, post-service loop, each loop / auto once / manual) and groups with counts and minutes, a phase strip (#205); adding straight into a phase or group (#206); timing from the main service's start (warm-up start, each item's time, projected finish, running late or early) (#207). Services keep phases and groups as rows (no database change); service files with them are version 2 (#203).
- Present's running order shows the phases and groups; the item editor's Stage tab shows an item as the stage screen will (#210).
- Loops and the warm-up run by themselves once started in Present: a loop puts its items up in turn (5–60 seconds each, set in Prepare, or each item's planned length) and repeats; the warm-up runs once on its planned minutes, waiting until it is due so it ends at the service start; the main service never advances by itself. Taking anything else, Clear, Black or a quick screen stops it at once (#219, issue #193).
- A timing engine for the run of show (issue #196): the plan stays as prepared, what is expected follows what actually happened (a late start, an item over or under, the screen cleared) and the time now, and an item's "end by" is a hard stop that cuts its expected time and says so. Prepare's timing shows the expected finish against the planned one and each later item's expected start (#227); Present's service timer gives the same planned and expected end (#229, issue #196).
- Hold the service with a reason (Present → service timer → Hold): noted in the service log and shown on the stage display; loops and timed moves wait and carry on at Resume; the congregation's screen does not change (#233, issue #196).
- Other timers in Present: up to four named countdowns (e.g. Communion prep 5:00) beside the service timer, each started, paused and reset on its own; any can show on the stage display, amber in its last two minutes and red once over (#232, issue #196).
- Fixed: before the service begins, what is expected is the plan; planning in the evening for Sunday no longer shows the finish "12 h late" (Prepare, Present, the stage display) (#234).
- The stage display shows when the service ends, "Ends 10:42 · 5 min late" beside the timer, from the timing engine; Design → Stage can hide it (#230, issue #196).
- Actual times in the run of show: when the main service began against its start (and the projected finish moves with it), and for each item when it went on air and for how long against its plan, from the service log (rehearsal not counted) (#220, issue #193).
- When an item goes live: a message on the stage screen only and one cue that never changes the congregation's screen (start, start from zero or pause the timer; clear the stage message), set in the item's Timing tab and marked with a bell in the running order. It runs once per go-live, never in rehearsal (#221, issue #193).
- Timed moves: an item marked in Prepare ("Move on by itself after its planned minutes") goes to the next item of its phase on time, only while Timed moves is on in Present (off at every start, with a countdown). Never across a phase or inside a loop or warm-up that runs by itself; anything the operator does to what is live cancels the pending move (#222, issue #193).
- Loops, the warm-up and timed moves keep time while Rhema is behind other windows (OBS in front): the main window's timers are no longer suspended when hidden (macOS); the Timed moves countdown counts from when a move is set. Found in the run-of-show acceptance on the Intel Mac, which then passed end to end (#223, issue #193).
- A one-second tick from the app to the operator's window: a loop step or timed move whose timer was held back while the window was hidden happens on it. This is what keeps them on time on Windows and Linux, where the window's throttling cannot be switched off (not yet tried on Windows) (#224, issue #193).
- Ticker: saved sets of announcements, a preview before taking it live, and a still "one at a time" mode for people who find motion hard (#211, issue #187).
- Ticker cues: "Take the ticker live" and "Stop the ticker" can be steps of the church's own cues, and so run from the phone remote or OSC; taking it live again while it runs changes nothing (#225, issue #187).
- Tests have a 20 s default timeout (cold module imports could pass 5 s on a loaded machine) (#210).
- Settings is a page with its sections grouped (Bible and languages, Screens and NDI, Live behaviour, Microphone and speech, Studio connections, Appearance, Diagnostics and support) (#216).
- The Team page: your name, approvals, comments and the ways to work together (church folder, phone remote; hosting on the network planned) (#214).
- Library and Archive are pages: songs, the hymn book, pictures and videos, song files; services, the service log, songs sung, sharing and backups (#212).
- Design → Stage: the stage display's background, words colour and size, and whether it shows the timer, what is next, the item's note and the song's key and tempo; previewed with the real stage renderer, the same on a screen and over NDI (#226, DS-004).
- Design studio: every design edit on one page, with tabs for Themes (each kind of content previewed and assigned), Lower thirds, News ticker, Brand kit and Output looks (every output's theme per kind in one table); leaving with an unsaved theme asks first (#201).

### Design and outputs (owner requests, 2026-10-22)
- A look per kind of content: each output can show Bible, songs, hymns, slides and pictures in their own theme (its main theme otherwise); the Theme Designer previews each kind and assigns the theme (#189).
- Lower third designer: styles with position, size, fonts, colours, an accent bar, an entrance (at once, fade, slide up) and a picture or video behind the band; Name and title, a Scripture strip and a Lyrics strip that follow what is live (#190).
- The stage display can go out over NDI (to an NDI viewer); any screen output can open in a movable window instead of full screen, for signage on the operator's computer (#191).
- News ticker: announcements crawl along the outputs that show it (also signage, never the stage), with a tag, colours, speed, direction, a picture or video behind, Pause/Resume and its own designer; a lower third stays above it (#192, issue #187).
- NDI keeps full speed when the output window is hidden: frames are paced from Rust, only the ticker's band crosses from the page while it alone moves, and NDI compresses on its own thread (30 fps measured with an NDI receiver on the Intel Mac; it was about 1 fps) (#192).

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

### Prepare and Present (owner requests)
- Bible tab: finds Bible references only, with the Bible version and second language chosen there.
- Songs tab: choir ministrations (a Choir ministration button, a switch in the song editor, a filter).
- Slides: a background picture or video, imported right there; a video plays silently and loops behind the words.
- Hymn book: the two parts are named Main and Various.
- Production view: the Studio look (the old header and its "FREE" badge are gone).
- Quick screens: calm buttons; the one on air is red. Quick find shows examples when nothing is typed.

### Songs
- Songs can have other titles (one per line in the song editor), found by search like the title; OpenLyrics files keep them; each CAC hymn's Yorùbá title is one.

### Phone remote
- The phone shows rehearsal, the approval question and what is on air at once, also when the Rhema window is minimised or behind another app.

### Hymn book
- Prepare → Hymn book: the CAC Gospel Hymn Book in English and Yorùbá, Part 1 and Part 2 (various hymns). Find a hymn by number (245, V12) or by words in either language, preview it, add it. Choose which language shows first. Import it once from the hymn book file; it stays on this computer.

### Bible
- Quick find takes a numbered book on its own or with a chapter ("1 Samuel", "1 Kings 3"), and ordinals in words ("First Samuel 3:10", "Samuẹli Kínní 3:10").

### Prepare
- An item's minutes, prepared-by and end-by fields sit in labelled columns; nothing is cut off.

### Screens
- Quick screens (Welcome, Please stand, Technical issue…) add the Yorùbá line also when the open service's verses are in the Yorùbá Bible, not only when it is your active or second Bible.
- A song's footer line (title, copyright) never covers its last line.

### Slides
- Long text added as pages keeps each page's "(2/4)" mark after saving, and each page is labelled by its own first line.

### Home
- A service changed since it was approved says "changed since approval" on Home and in the saved list (it read "not approved yet").

### Church folder
- A service opened from the church folder and published again goes back as the next version of the same service, so the computer that made it is told about the change (before, it appeared as a separate service).

### Streaming
- NDI outputs react about three times faster: a slide change reaches the stream in about 30 ms instead of about 95 ms (measured at 720p30 on an Intel Mac).

### Getting started
- The first-run tour now teaches Rhema Studio as it is: Home, Prepare, Present and More, opening each place as it goes.

### Themes
- Bilingual screens: the Theme Designer styles both languages together or each one alone (tabs name the translations), and a "Space between languages" setting sets the gap on verses and songs.

### Search and safety
- Intel Mac: Rhema now builds and runs natively on Intel Macs. Pictures load on macOS, a first run starts in the King James Version, and the app no longer falls back to a slower internal channel at start.
- Cues: a "Show live" step finishes before the next one runs, so a following quick screen or "Rehearsal off" behaves as expected. An all-day signage window (00:00 to 00:00) keeps to its ticked days.
- Search: words with apostrophes or commas find verses, "John 3:16-18" and "Jn. 3:16" work, "Jude 5" goes to the verse, a song titled "Psalm 23" is found, and hymns 1–9 can be found by number.
- Home is more truthful: a theme font missing from this computer is reported, an unapproved service warns when "Ask before showing" is on, and deleted files are noticed each time you open Home.
- Keyboard and screen readers: typing in the Bible quick box never changes the screen, going on or off air and warnings are read out, the Production queue and search results work from the keyboard, and focus stays in place after deleting.
- When something fails: one view going wrong no longer blanks the window, importing a large video or opening from a network folder no longer freezes Rhema, a keychain that cannot be read says so with Retry, and cloud speech returns to real time after a network drop.
- Outputs: Present shows a projector closed from the computer as off, an unplugged monitor is named correctly, very long text and stage words fit, and editing a theme no longer flickers on air or mutes a video.
- Preparing a service: New service from the items on screen now saves, QR slides with only a link and long slide text save, a service from another church computer opens even when a hymn number is already used here, and OpenLyrics files keep a song's main language, key and tempo.
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
