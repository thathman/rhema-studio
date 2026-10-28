# ADR 0005 — Settings: three parts, the settings file, secrets and backups

- **Status:** Accepted for what is built (#298 M11 and E6, PR #346, on `main` since 2026-10-24).
  Dropping the top-level copies (§4) is proposed only and waits for the owner.
- **Scope:** the settings of one Rhema install (`settings.json` in the app data folder), how they
  are split, read, written, kept secret and carried in a backup. Outputs, looks and scenes
  (`broadcast-themes.json`), the Bible choice (`bible.json`) and crash recovery (`recovery.json`)
  are other files; they are named here only where a backup carries them.
- **Code:** `src/stores/settings-store.ts` (the parts, reading, writing, secrets, backup and
  restore), `src/lib/setup-readiness.ts` (`SetupProfile`, `normalizeSetup`),
  `src/lib/installation-export.ts` (the installation in a backup), `src/stores/tutorial-store.ts`,
  `src-tauri/src/commands/secrets.rs` (the keychain), `src-tauri/src/commands/store_check.rs`
  (damaged files), `src-tauri/src/mcp.rs` and `src-tauri/src/commands/diagnostics.rs` (other readers
  of the file).

## 1. Context

Until #298 every setting sat at the top of `settings.json` in one flat list: the church's Brand
Kit next to this computer's ports next to the operator's name. Three needs pulled them apart:

- a computer that joins a host should be able to take the **church's** look without losing its
  **own** screens, ports and keys (#298 E4);
- a backup should bring back an installation on a new computer, but never carry what lets someone
  in (#298 E6, M9);
- a volunteer's own choices (their name, what they have read) should not be mistaken for the
  church's or the computer's.

At the same time churches run more than one build: an older Rhema may open the same data folder
after an update is rolled back (QA-005, RG-05). Nothing may be lost either way.

## 2. Decision: every saved setting belongs to exactly one part

`SETTINGS_SECTIONS` lists the parts. `settings-sections.test.ts` checks that every setting the
store has is in exactly one part, or is in `RUNTIME_ONLY_SETTINGS` (worked out while Rhema runs,
never saved: today only `settingsSaveFailed`).

| Part | What it is | Settings |
| --- | --- | --- |
| **church** | The church's own; the same on every computer. | `brandKit`, `customMacros` (the church's cues), `requireApproval`, `hymnFirstLanguage` |
| **machine** | This computer: its setup and name, sound, ports, connections and saved keys. | `setup` (the `SetupProfile`, below), `churchFolder`, `openedPackages`, `openedFrom`, `mcpEnabled`, `remoteSecret`, `joinAddress`, `joinName`, `joinToken`, `hostLookSeen`, `talkInputId`, `talkOutputId`, `remoteDevices`, `remoteAuthRequired`, `remoteListeners`, `obs`, `cameras`, `cameraRouterAuto`, `capacityLimits`, `deepgramApiKey`, `openaiApiKey`, `claudeApiKey`, `audioDeviceId`, `gain`, `sttProvider`, `cloudSpeechConsentAt` |
| **operator** | The person at this desk. | `operatorName`, `onboardingComplete`, `commentsSeen`, `timekeeperCountdown`, `autoMode`, `confidenceThreshold`, `cooldownMs` |

`setup` (`SetupProfile`, `version: 1`) holds where the first-install setup was left
(`dismissedAt`, `stepsDone`, `lastStep`, `mode`), this computer's `deviceName` and `deviceId` (made
once, never changed), `campus`, `serviceLanguages`, `timeZone`, `lastBackupAt`, and Home's reminder
(`homeCardHidden`, `remindAfter`). It sits in the machine part as one value; campus and service
languages are therefore this computer's, not shared by a host (see §7).

The parts are a way of reading and writing the same settings. In memory the store is still one
flat zustand store; `settingsSection(state, part)` gives one part's values and `sectionOf(key)`
names a key's part.

## 3. The file

`persistAll` writes, on every change (debounced 250 ms; closing the app waits for it):

```json
{
  "church":   { "brandKit": { … }, "customMacros": [ … ], … },
  "machine":  { "setup": { … }, "obs": { "host": "127.0.0.1", "port": 4455, "password": "", … }, … },
  "operator": { "operatorName": "Tolu", … },
  "brandKit": { … },
  "operatorName": "Tolu",
  "…": "every setting again, at the top",
  "settingsLayout": 2,
  "secretsInKeychain": true
}
```

- **The three parts**, each written whole from the store.
- **A top-level copy of every setting**, the same value as in its part. An older Rhema knows only
  the flat layout; with the copies it still reads every setting, and what it changes it writes
  there.
- **`settingsLayout: 2`** says the file has the parts (layout 1 is the flat file, which has no
  marker). Reading does not depend on it: the parts are used when they are there.
- **`secretsInKeychain`** says the saved keys are in the system keychain (§5).

## 4. Reading: field by field, never trusting the shape

`hydrateSettings` reads once at start, before the store saves anything:

1. Each part is taken only if it is an object (a part that is a list, a number or missing is
   ignored, and its settings are read from the top).
2. For each known setting, **the top-level copy wins**; the part's value is used when there is no
   top-level copy. An older build that changed a setting changed only the top-level copy, so that
   is the newer value. A file with only the parts (none written so far, but allowed) also loads.
3. Each value goes through `readSetting`: `acceptable(key, value)` checks its shape (a string where a
   string is due, a port between 1 and 65535, a whole number of chime minutes from 0 to 30, a list of
   strings…). A value of the wrong shape is skipped and the default stays; the other settings
   still load. `customMacros` and `cameras` are checked entry by entry, so one damaged cue or camera
   does not cost the others. `setup` is rebuilt field by field by `normalizeSetup`: a missing or
   wrong field takes its default, an unknown step id is dropped.
4. Keys this build does not know are left alone in the file (the store plugin only replaces the
   keys it is given). A newer build's extra setting therefore survives at the top level when this
   build saves, but **not inside a part**, because each part is written whole.
5. Reading writes nothing, with one exception: a secret still in the file (an older build put it
   there, or the keychain was missing then) triggers one save, which moves it into the keychain.
6. Hydration attaches the save subscription only after reading succeeded, so a failed read never
   saves defaults over the file.

Other readers follow the same order or close to it: Rhema MCP (`mcp.rs`, `setting()`) and the
diagnostics export (`configured_secrets`, which looks in the machine part and at the top) read both
layouts. `tutorial-store.ts` reads and writes `onboardingComplete` in the operator part when there is
one, else at the top. It looks at the part first, the reverse of the store, but the store's next save
writes both copies, so they agree again.

**Dropping the top-level copies (proposed).** The copies double the file and keep layout 1 alive.
They can go once no older build is in use at any church running this one: then a save writes only
the parts, and reading keeps its fallback to the top for files that were never saved again. This is
the owner's call; until then every new setting is written in both places.

## 5. Secrets: in the system keychain, not the file

- **Which:** `deepgramApiKey`, `openaiApiKey`, `claudeApiKey`, `remoteSecret`, the OBS password
  (`obs.password`) and `joinToken` (`SECRET_NAMES`).
- **Where:** one keychain entry (service "Rhema Studio", account "settings-secrets"), holding a JSON
  object of the secrets that are set. One entry means one permission prompt where the system asks
  before an app reads the keychain (macOS after an update).
- **Write:** the entry is written and read back; only when it reads back the same are the file's
  copies blanked (in the parts and at the top) and `secretsInKeychain` set. An empty set deletes
  the entry, but only an entry this session wrote or read.
- **Keychain unreadable** (locked, or access refused): Rhema never overwrites the entry; new keys
  typed meanwhile stay in the file; a lasting warning offers **Retry** (`retryKeychain`), after
  which keys typed meanwhile move into the keychain.
- **No keychain** on the system: the file keeps the values, as before.
- **Not secrets in this sense:** paired devices (`remoteDevices`) are saved as the SHA-256 of each
  token, never the token. A camera's link token (`cameras[].token`) is in the settings file, not
  the keychain; it is a link secret, so it is never in a backup (§6).
- A diagnostics export redacts every configured secret (6 characters or longer) it finds in either
  layout.

## 6. Backups: the installation, never what lets someone in

**Back up now** (Archive → Backups, or the setup summary) copies the database and adds an
**installation export** (`InstallationExport`, `kind: "rhema-installation"`, `v: 1`) in its own
`installation_export` table of the backup copy, never of the live database:

- `settings`: `settingsForBackup`, in the three parts, without the settings in `NOT_IN_BACKUP`, with
  the OBS password blank and each camera's link token blank;
- `looks`: `looksForBackup` from the outputs file: your own themes, the outputs (without their
  browser-feed link tokens), lower-third, ticker and stage looks, ticker items and presets, scenes
  (never a rehearsal scene) and scene presets, and the Auto choices.

**Never in a backup** (`NOT_IN_BACKUP`, and the blanking above):

| What | Why |
| --- | --- |
| Cloud keys (`deepgramApiKey`, `openaiApiKey`, `claudeApiKey`), the remote key (`remoteSecret`), the OBS password, the join token | Secrets. |
| Paired phones and desks (`remoteDevices`) and the host this computer joins (`joinAddress`, `joinName`, `joinToken`) | Each pairing belongs to one computer. |
| Remote listeners and the key rule (`remoteListeners`, `remoteAuthRequired`), the AI assistant switch (`mcpEnabled`), cloud speech consent (`cloudSpeechConsentAt`) | What lets others in, or sends audio out, is turned on by each computer's operator there (#298 M9). |
| Camera link tokens, browser-feed link tokens | Link secrets: an old link must not open again from a backup. |

**Restore** (Bring in a previous installation, after the operator saw **what would change here**
and confirmed; refused while an output is on) puts a backup's settings back the way the file is
read: part by part, value by value through `readSetting`, a damaged value skipped. Everything in
`NOT_IN_BACKUP` stays as it is on this computer, and so do:

- `setup.deviceId` (this install's identity);
- each camera's link token (a camera this computer does not have gets a new one);
- the OBS password, but only when the backup names the same OBS host and port; a different OBS comes
  back turned off and with no password, so this computer's password is never sent to another host;
- browser-feed tokens of the outputs this computer has.

Before anything changes, the current database and installation go into the pre-restore snapshot;
restoring that snapshot is **Undo this restore**. An older backup has no installation export and
restores services and songs only.

## 7. The church part and the host

A joined desk is offered only the host's **church look**: its Brand Kit and the themes made from it
(`church-look.ts`, on the Live State). It merges only on confirmation and touches nothing else. The
rest of the church part (`customMacros`, `requireApproval`, `hymnFirstLanguage`) is not shared by a
host yet; each computer keeps its own. Campus and service languages are in `setup` (machine), so
they are not shared either.

## 8. Damaged files

Before anything loads, `store_check.rs` checks `settings.json` (and `broadcast-themes.json`). A file
that does not parse as a JSON object is set aside as `settings.json.damaged-<seconds>` and the last
good copy (`settings.json.last-good`, copied at every start from a good file) is put back; the window
is told. A save that fails sets `settingsSaveFailed`, which the setup's "Settings are saved" check
shows.

## 9. Rules for changing settings

1. **A new setting goes in exactly one part** (the test fails otherwise). Ask: is it the church's
   on every computer, this computer's, or this person's? If it lets others in, it is the machine's.
2. **Its default is today's behaviour**, so an older file without it behaves as before.
3. **Give it an `acceptable()` case** for its shape; a setting without one is taken as it is, which
   is only safe for values the UI cannot crash on. A list of objects is checked entry by entry.
4. **Never rename or repurpose a key.** Add a new one and read the old one as a fallback, as the
   parts read the top level.
5. **Keep writing the top-level copy** until the owner drops it (§4).
6. **A secret** joins `SECRET_NAMES` and `NOT_IN_BACKUP`, and the diagnostics redaction. **A link
   secret** or anything that lets someone in joins `NOT_IN_BACKUP`.
7. **Restore treats it like reading**: if it names this computer (an id, a device, a path that
   only exists here), keep this computer's value on restore, as `deviceId` and camera tokens are.
8. **Bump `SETTINGS_LAYOUT`** only when the file's shape changes so that a reader of layout 2
   would misread it; say what changed in this ADR.

## 10. Consequences

- Old files load unchanged and are rewritten in the new layout on the first change; an older build
  opened afterwards still reads everything.
- The file is about twice as large while the top-level copies stay.
- A backup is now enough to set up a replacement computer, apart from keys, pairings and what lets
  others in, which are entered again there on purpose.
- Tests: `src/stores/settings-sections.test.ts` (one part per setting; an old flat file loads,
  migrates and reloads with nothing lost; the top-level copy wins; damaged values; backup without
  secrets; restore keeps keys, devices, id and camera links; the OBS rule),
  `settings-store.test.ts`, `settings-secrets.test.ts`, `src/lib/installation-export.test.ts`,
  `src/studio/setup/restore-view.test.tsx`, and the Rust tests in `rhema-content`, `mcp.rs` and
  `diagnostics.rs`. Desktop acceptance: `08-desktop-acceptance-guide.md` §10ev (10ev.11 is the
  old-file check); not yet run on the desktop.
