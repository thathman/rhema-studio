# Changelog

Rhema Studio is a fork of [Rhema](https://github.com/openbezal/rhema) (MIT, upstream 0.3.2). This file records what the fork adds; the upstream history stays in its own repository. No Rhema Studio release has been published yet; everything below is **unreleased**, merged on `main`, and not yet accepted on a real desktop (see `docs/rhema-studio/08-desktop-acceptance-guide.md`).

## Unreleased

- The run of show keeps its times on the right day around midnight: a 23:30 watchnight still running at 00:10 starts last night (not tonight, which made every time wrong); "end by 00:15" after a 23:50 start is that night's (not this morning's, which squeezed everything); a 00:30 warm-up arms at 23:00; times are resolved by calendar day, so a clock change keeps the local time (#250, PT-006, #196).

### The service log survives Rhema closing unexpectedly (#196, #246)
- The log (and each item's actual times) is kept as it changes and comes back by itself after a crash; nothing goes on a screen.
### Planned time typed as 35, 4:30 or 1:10:00 (#196)
- An item's planned time takes minutes, min:sec, h:mm:ss or "1h10", and is written back the same way; a mistake is marked and not applied.
### The service timer from a Timekeeper desk (#196 R5)
- A joined Timekeeper desk shows the host's timer counting and can start, pause and correct it (remote commands `timer_start`, `timer_pause`, `timer_adjust`), each logged with who.

### Running late, shared by every desk (#196)
- Prepare's ±5 min now moves the service's one running-late offset, which Production's Timekeeper and a joined Timekeeper desk move too (remote command `event_offset`). The stage finish, the Live State and every desk follow it; each change is logged with who made it.
### Priority talk; a revoked device leaves the talk channel (Rhema Comms C4, #251)
- The main desk's Talk to has **All crew, priority**: while it holds Talk, everyone else is turned down for every listener.
- Revoking a paired device in Settings → Remote drops it from the talk channel at once.
### AI drafts can suggest a look and a scene per item (MCP-004, #252)
- New MCP tool `rhema_list_looks_and_scenes`; draft items may carry `suggested_look` / `suggested_scene`, checked against the church's names and shown in Prepare → AI drafts for people to apply. They are never stored in the service.

### Cameras in scenes (OP-009, #209)
- A scene's Camera layer now plays a camera on the church network (WHEP, as MediaMTX offers each camera it relays), on screens, NDI outputs and browser feeds, with words layered over it. Only church-network addresses are used.

### Secure phone page (https) for talking from phones (#251)
- Settings → Remote → **Secure page for phones (https)**: the phone page is also served over https on the next port with a certificate this computer makes for itself, so phones can join the talk channel on the church Wi-Fi. Each phone accepts the warning once, or installs this computer's certificate (`/rhema-ca.pem`) to trust it. Off by default.

### Phones in the talk channel (Rhema Comms C4, #251)
- The phone remote can join the talk channel and hold to talk, wherever the phone's browser allows its microphone (a secure page). On the plain-http church page it says so; serving it securely is an open owner decision.

### AI assistants: planning prompts and revising drafts (MCP-003, #252)
- Rhema's MCP server offers three ready-made requests (draft a service, reuse a past one, check a service's timing and gaps), and an assistant can list its waiting drafts and revise one before the church opens it. Prepare → AI drafts shows when a draft was revised.

### Clock layer: time of day and countdown to a time (#196)
- A scene's clock can show the time of day, or count down to a set time such as the service start, besides the service timer.

### Show health in Production → Screens (#213)
- Each output shows what it is showing now and how its signal is doing; a "Needs attention" list puts the serious problems first. Browser feeds are no longer listed as displays.

### The service log names who did what (#246)
- Each command from a paired device shows its name in the service log ("next · by Femi's laptop"), and each scene taken to an output or released is a SCENE line.

### Talk channels and private calls (Rhema Comms C4, #251)
- Talk to All crew, Production, Stage & worship, or one person privately; each desk chooses which channels it hears. Switching never interrupts the connection.

### Put back what was on the screens after an unexpected close (#246)
- If Rhema closes unexpectedly mid-service, the next start offers to put back the program, the live sources, the outputs that were on with their scenes, and the event. Nothing returns until you choose; the log records it.

### Scene transitions (ARCH-002)
- A scene can come on air with a cross-fade (0.3, 0.5 or 1 s) instead of a cut, on screens, NDI and browser feeds alike; releasing it fades the same way. Black and Logo always cut. Existing scenes keep cutting.

### Browser feed health (#246, receiver trust)
- A browser feed's card says whether anyone is watching it and whether the page shows the latest frame: each page tells Rhema which frame it drew. "Behind" shows in red after 3 seconds.

### Browser feed QR code (#198)
- A browser feed's settings show a QR code of its link when the listener is on the church network, so a TV, tablet or phone opens the feed by scanning instead of typing.

### Talk: full-duplex Push-to-Talk with the crew (Rhema Comms C3, #251)
- Joined desks and the main desk can talk to each other on the church network: hold Talk, and everyone hears you; several people can talk at once. The main desk mixes the voices (each desk hears everyone but itself), with no cloud and no extra software. Who is talking shows on every desk. Crew audio never reaches the screens, PA, OBS, NDI, recordings or listening. Design and measurements: `docs/rhema-studio/23-adr-0002-comms-voice.md`.

### Clock layer in scenes (ARCH-002)
- A congregation scene can have a **Clock**: the service timer in a look's text style, filling its box, for a countdown before the service. Screens and browser feeds count it themselves (one frame a second), so it keeps time with the window covered and adds no traffic while it runs.

### Phone remote: live sources and notices (ARCH-001, Rhema Comms #251)
- The phone remote lists each live source with what it shows, and **Take off** / **Put back** for it, within its role.
- Paired phones get production notices: those for their role and everyone's, answered Seen / Ready / Unable, and a message box to the main desk. The host names the phone.

### Stage displays follow sources; the service log names sources (ARCH-001, #243)
- A stage output can follow chosen sources, like a congregation output: a pulpit monitor following the Bible keeps the verse while a hymn is up.
- The service log tags each thing put on air with its source ("· Hymns"), and records a source changing beside the program: "Bible: Romans 8:28" when a verse is activated while a song is up, "Bible off" and "Bible back" for Clear and Restore of that source.

### Action requests (Rhema Comms C2, #251)
- A notice can ask for something: to show a verse, take a scene or start a run-of-show item. The recipient gets one button for it on their desk; nothing runs until they press it, it runs with their own permissions, and pressing it answers Ready.

### Browser feeds (ARCH-002, #198)
- A new kind of output, **Browser Feed**: an output drawn by a web page on the church network, for OBS (Browser source) or a TV's browser, with no window or NDI sender on this computer. It is drawn by the same code as the other outputs, so its looks, scenes, chosen sources, lower third and ticker look the same, and a keyed look stays transparent in OBS. Outputs → edit shows its link (copy it, or make a new one, which closes the old). It needs the HTTP listener on the network; videos do not play in a browser feed.

### Production notices (Rhema Comms, #251)
- The bell in the top bar is now **production notices**: short private messages between the main desk and the computers that joined it (Production → Operators), to everyone, the main desk or a role (Timekeeper, Bible, Screens, Present), normal or urgent, tied to the event happening now. Each is answered **Seen**, **Ready** or **Unable**, and everyone sees the answers. The host stamps who sent each one from the device's own key. Notices never reach a screen, the stage, a feed or the service log; the host keeps the last 100 for the session and a reconnecting desk catches up.

### AI service drafts (#252, MCP-002)
- An assistant connected to Rhema can now propose a whole service: phases, timings, songs and hymns from your library, Scripture from your Bible editions, slides with its own words. Rhema checks every item (songs it cannot find are kept as "Missing" placeholders, never invented) and saves it as a draft. **Prepare → AI drafts** lists them; **Open as a new service** puts one in the rundown, unsaved, each item marked as the assistant's, for you to edit, source what is missing and save. Nothing is approved or shown by the assistant.

### Rhema MCP for AI assistants (#252, read-only)
- Settings → AI assistants: an assistant that supports MCP (Claude Desktop or Claude Code, for example) can read this church's services and their run of show, the song library and hymn book (titles, numbers, authors, licences; never lyrics) and the installed Bible editions, to help plan a service. Off by default; read-only (nothing it does can change a service, a song, a setting or a screen); Scripture comes only from the installed editions. The assistant starts Rhema in the background (`Rhema --mcp`); Settings shows the exact configuration to paste.

### Operator roles: Bible and Screens (ARCH-004)
- Two more roles for a joined computer (Settings → Remote control): **Bible** types a reference and activates it (every feed that follows Bible takes it; the main screens too unless a song, hymn or slide is up), steps the passage, and takes the Bible off or back; **Screens** takes a scene to a congregation output or sends it back to its own feed. Each joined desk shows only its part; **Present** shows all three.
- The same commands for Stream Deck and OSC: `/rhema/bible_activate <reference>`, `/rhema/clear_source <id>`, `/rhema/restore_source <id>`, `/rhema/take_scene <output> <scene>`, `/rhema/release_scene <output>`. Auto (heard verses) and these share one rule for when a verse may change the main screens.

### Host and join (ARCH-004, #162)
- Production → Operators: this computer can **host** the service (every control stays here, with or without anyone joined) or **join** another Rhema on the church network with its pairing code. A joined computer follows the host's screens, live sources, run of show, event clock and timing as they change, and does what its role allows.
- New role **Timekeeper** (Settings → Remote control → a paired device): it may only move the event clock (Start the next event, Back one, start a chosen event), never a screen. The same commands work from OSC (`/rhema/event_next`, `/rhema/event_prev`, `/rhema/event_start <item id>`) and the HTTP API.
- The host's Live State goes only to paired devices (with keys off, only to this computer); the joined computer's token is kept in the keychain. Losing the connection reconnects by itself and never affects the host.

### The event clock (ARCH-003, #246 C03)
- Which event is happening is now its own record, apart from what the screens show. Production → Timekeeper shows **Now** with **Start (next event)** and **Back one**, and a choice: **Follows the screens** (the default: an item's event starts when its content goes on air, as before) or **I start each event** (showing a verse, a song or a quick screen never moves the clock; the timekeeper does). Nothing here changes a screen.
- Timing (planned, expected, actual, the stage display's finish line) and each item's message and cue follow the event clock. The service log records each event start ("EVENT …") separately from what was shown; rehearsal and quick screens never start an event; opening another service starts its clock afresh.

### Congregation Scene Composer (ARCH-002)
- Production → Programs is the Scene Composer: arrange live content (each layer following its own sources, in a look from Design, or held), colours, Library pictures and camera places (cameras planned, #209) on one frame; drag to move, drag the corner to resize, arrow keys to nudge; box, crop and opacity in numbers too. Ready-made arrangements: Full screen, Bible and lyrics, Lyrics on a picture, Camera with the Bible.
- **Take** puts the scene on a congregation output (saving it first); **Back to its own feed** and **Restore** follow. Each layer keeps following its source, so the next verse or line appears in its place without another Take; OBS feeds and other outputs are untouched; Black still covers everything. Edits stay in the composer until Save or Take.

### Rehearsal as a sandbox; cues say what they touch (ARCH-003)
- Rehearsal now covers the whole desk: a lower third, ticker or stage message set in rehearsal, and anything done to the service timer, are undone when it ends (also with Show this live, which takes only the rehearsed screens live). A ticker started in rehearsal never reaches a signage screen. The service log records only that rehearsal ran.
- A loop or timed move running on air waits through rehearsal (anything shown in rehearsal no longer stops it) and carries on after, catching up a step that came due; a loop started in rehearsal ends with it.
- Every cue says what it will touch before you run it: the screens, a quick screen over them, every screen and feed (Black, Logo), the timer, the stage message, the ticker, or leaving rehearsal (#246 C04).

### Independent live sources (ARCH-001, ADR 0001)
- Bible, Songs, Hymns, Slides, Pictures and quick screens each keep their own live value. An output can follow chosen sources (Outputs → edit → "What this output follows"): a "Rhema Bible | Lower Third" NDI feed set to Bible keeps Romans 8:28, in its own look, while a hymn is on the projector, and takes the next verse as soon as it is shown. Outputs left on "Everything put on air" behave exactly as before.
- Present → Live shows the sources the feeds follow, each with its own take-off and Restore; Clear and Restore on the main controls still act on what the main screens show. Black and Logo cover every feed; Back returns each to its own source. The ticker stays independent. Rehearsal never changes a source.
- Auto (heard verses) while a song, hymn or slide is up: the verse goes to the feeds that follow Bible and waits in the preview, instead of replacing the song on the projector (#246 C11).

### Live safety (Milestone A, ADR 0001)
- Leaving rehearsal puts back exactly what was on air (and the rundown's place); nothing rehearsed reaches the screens, NDI or the service log, and go-live cues do not fire. **Show this live** (next to the Rehearsal chip) is the deliberate way to put what you rehearsed on screen; the approval question applies to it. The cue step "Rehearsal off" now means the same as the chip (#246 C02).
- Design → Themes edits stay in the Designer: the screens using the theme change only when you save, or while **Live edit** is on (it says how many screens it touches and turns off when you leave the theme) (#246 C01).
- ADR 0001 records the live model the owner ratified in #243: live sources, feeds, scenes, programs and destinations, and what Queue, Preview, Activate, Show, Hide, Hold, Clear, Restore, Take and Black mean.

### The owner's redesign (in progress, 2026-10-22)
- Design → Themes at 1024–1400 px: the preview chips (Bible, two languages, Song…) scroll inside their group instead of pushing past the zoom controls; the decorative pointer and Grid marks hide (#258; found by the responsive sweep at 1024 and 1366, UX-12).
- Design → Themes → Look opens with Visual direction: four one-click palettes from the approved design (Midnight & gold, Forest & linen, Warm editorial, Modern cobalt) that set the background, the words in both languages and the reference accent together; the chosen one shows as pressed (#249, DS-004).
- New look (#194), then the owner's approved neutral design (issue #215, #218): warm stone canvas, white flat panels with a fine border, ink sidebar and live console, one deep-teal accent, brass sparingly, red only for live; IBM Plex Sans (bundled); the approved Home hero; a 194 px sidebar with the church's workspace tag (More tools removed); a top bar with Find anything, keyboard shortcuts and team activity. Accessibility pass against UI/UX Pro Max: AA contrast, 24 px targets, a skip link, reduced motion respected.
- Navigation: the sidebar (Home, Prepare, Present; Library, Design, Team, Archive; More tools, Settings, who is at the desk) and a top bar (where you are, works offline, light/dark); Cmd/Ctrl+1-7 and Cmd/Ctrl+, (#195). Library, Design, Team and Archive open the existing library, Theme Designer and More tools until they become pages.
- Below 1180 px wide the sidebar becomes an icon rail, so Present's monitors and Prepare's order of service keep their room at 1024 px; phase names in the order of service keep their space before the item counts; dark mode has a quieter top bar and Home hero; Home's glance gives warm-up items their planned times (09:55) instead of a number (#247, UX-12).
- On a short window (under 860 px tall, e.g. a 1280×790 laptop window) Present and Prepare tighten: a one-line Automated phases strip, compact phase cards, less padding and a shorter cue row, so the monitors and the order of service keep their room; the transition row stays on one line below 1400 px (#244, UX-12).
- CI: apt installs over IPv4 only, after repeated mirror hangs on the Rust job (#245).
- The licence notices (Rhema by OpenBezal, the Yoruba Bible's CC BY-SA attribution, openbible.info, NDI) are in Settings → Help again: they lived only in More, which has had no way in since the sidebar dropped it (#218). Quitting on Production reopens on Production instead of Home. The production guide, quick start and licences page point at where things are now (Archive, Team, Production → Screens) and no longer say a stage output cannot send NDI (#248, #246 C18).
- The first-run tour shows Production (the clock, the screens, readiness) and ends on the sidebar (#242, UX-12).
- Design → Themes → Look (the approved "Edit the look"): a theme in a volunteer's terms: the scripture and lyric font, text size, space between languages, background, words and accent colours, alignment, a safe area and the output shape; the Text, Background and Layout tabs keep every detail. IBM Plex Sans is bundled for the outputs too (#241, DS-004).
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
