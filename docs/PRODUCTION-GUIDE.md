# Rhema Studio — production operator guide

For the person running outputs, OBS and the stage screen. The volunteer guide (`docs/QUICK-START.md`) covers the Standard view; this page covers everything behind it.

## Outputs (More → Outputs)

- Each output is a window on a monitor or an NDI sender, with its own theme and a role:
  - **Congregation**: the themed frame (verses, lyrics, slides, pictures, quick screens).
  - **Stage**: plain high-contrast text — the live words in every language, NEXT, the operator's note, key and tempo for a song, the timer, and any message you send.
- Removing one output never touches another. Home lists every output as on/off and warns when only the stage is on.
- A theme's **logo** draws in a corner; it is hidden on transparent (OBS) themes unless you tick "Show on transparent".

## OBS and NDI

- Use a transparent theme (for example the Lower Thirds builtin) on an NDI output for keying. Pictures and quick screens key like verses; background pictures fill the frame, so use them only on the congregation output.
- NDI frames come from the output window's canvas; a stage output does not send NDI.
- Health: Home → outputs line, Present header "n/m outputs on".

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

Macro ids: `service-start`, `offering`, `prayer`, `service-end`. Present → Cues shows each macro's steps.

**Who can send these:** anyone on the network while a listener runs; nothing asks for a password. Start a listener just before the service and stop it after; if the controller software runs on this laptop, untick "Accept commands from other devices on this network" so only this computer is accepted. Details: `docs/rhema-studio/13-remote-control-threat-notes.md`.

## Timing and the stage

- **Timer**: monotonic (ignores clock changes); amber under two minutes, red when over. Planned minutes per item give "n min late/early".
- **Message stage**: a framed banner on stage outputs only. Clear it from the same control.
- **Rehearsal**: freezes every output at what it shows; turn it off to push the current content everywhere.

## Data safety

- Every save of a service is a version (Prepare → History): compare and restore; a restore is itself a new version. **Approve** (Prepare, next to Save) pins the saved version as the one for the day: History marks it, it is never pruned, and Home warns when the service has changed since.
- More → Library: **Save this service as a file** carries one service with its songs and pictures to another computer (checksummed; a damaged file is refused). Export/import songs (Rhema JSON, OpenLyrics), and **Back up now / Restore** for the whole database. A restore refuses files that are not a Rhema Studio database and keeps the previous database as a snapshot next to it.
- Before any upgrade the app copies the database to `studio.db.before-<migration>.bak`.

## Translations

- A saved item goes live in the translation it was saved with; spontaneous verses follow your active translations. The Present header chip switches to "Override" to show everything in the current translation. A missing translation is reported, never substituted.

## Who did what

More → Your name is optional and local. When set it is written on every change (saves, approvals, imports) in the content database's audit table and at the top of the saved service log.

## Diagnostics

Settings → Diagnostics → Save logs. The content database path and applied migrations are shown in More → Library.
