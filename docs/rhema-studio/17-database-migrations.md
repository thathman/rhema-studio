# Content database: migrations, upgrades and downgrades

`studio.db` lives in the app data folder (More → Library shows the path). The Bible database (`rhema.db`) is separate, read-only and ships with the app; nothing here touches it.

## Migrations in order

| Version | What it adds | Data risk |
|---|---|---|
| 0001_programs | Services and their items, audit log | — |
| 0002_item_identity | Translation identity per item; nullable actor on audit rows | none (new nullable columns) |
| 0003_songs | Songs, sections per language, arrangements, hymnbooks and numbers, song search index, item payloads | none (new tables, one new nullable column) |
| 0004_media | Media index (pictures, videos) keyed by SHA-256 | none |
| 0005_revisions | A snapshot of each service after every save (last 50; the approved one is kept) | none |
| 0006_song_key_tempo | Song key and tempo | none (defaults) |
| 0007_approval | Approved revision and time on services | none (nullable) |
| 0008_service_logs | Saved service logs | none |
| 0009_song_attachments | Song ↔ file links (chord charts, sheets) | none |

Every migration only adds tables or nullable/defaulted columns; none rewrites or deletes existing rows. Applied SQL files are never edited; a change is always a new migration.

## Upgrade

On open, the app checks the file (`PRAGMA quick_check`; a damaged file is refused, not half-used), then applies the migrations it is missing in order, each in its own transaction. **Before the first pending migration it copies the whole file** to `studio.db.before-<version>.bak` next to it (SQLite online backup). More → Library shows that copy's path. The crate test `every_older_schema_upgrades_and_restores` opens a file at every older version and checks it upgrades with its data.

## Downgrade (going back to an older Rhema Studio)

An older build refuses a file that a newer build has migrated (it finds migration versions it does not know), so the newer data is never half-read or overwritten. Home shows "Saved services and songs are unavailable" with the reason, and Library repeats it; Scripture and everything that does not need the content database keep working.

To go back:

1. Close the app.
2. In the app data folder, keep the current `studio.db` (rename it, e.g. `studio.db.newer`).
3. Rename the matching `studio.db.before-<version>.bak` to `studio.db`, where `<version>` is the first migration the older build does not know.
4. Start the older build. Work saved with the newer build after the upgrade is not in that copy; re-enter it, or move back to the newer build (which still has `studio.db.newer`).

More → Library → "Restore from a backup…" does the same from inside the app for any backup file, and keeps the replaced database as a snapshot first.

## Settings

Settings (`settings.json`, the app's key-value store) are read field by field; a value of the wrong shape (from an older, newer or damaged file) is skipped and the default kept (`src/stores/settings-store.ts`, tests in `settings-store.test.ts`). Newer fields are ignored by older builds.
- From the keychain build (#115) on, API keys, the remote-control key and the OBS password live in the system keychain and are blank in `settings.json` (`secretsInKeychain: true`). An older build reads the blank values: re-enter the keys there, or copy them from the "Rhema Studio" / `settings-secrets` entry in Windows Credential Manager or Keychain Access (a small JSON object).
