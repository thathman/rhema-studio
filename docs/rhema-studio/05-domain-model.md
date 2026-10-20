# 05 — Domain Model and Persistence Proposal

Status: proposal. Not implemented in the foundation PR. The foundation PR keeps the
existing JSON-blob persistence untouched.

## 1. What exists today

| Data | Where | Shape |
|---|---|---|
| Bible text | `data/rhema.db` (read-only SQLite, bundled) | `translations`, `books`, `verses`, `cross_references`, `embedding_status` |
| Settings | `settings.json` via `tauri-plugin-store` | flat key/value |
| Translation choice | `bible.json` | two keys |
| Themes + outputs | `broadcast-themes.json` | `customThemes[]`, `outputs[]`, `activeThemeId`, `autoLive` |
| UI theme | `localStorage` | one key |
| Queue | memory only | lost on restart |

There is no user content database. That is the gap.

## 2. The five layers (must not be conflated)

```
Source content   Song, Hymn, BiblePassage, MediaAsset, SlideTemplate
      │ referenced by
Arrangement      ProgramItem: which content, in what order, with which sections,
                 theme override, notes — for one specific service
      │ compiled into
Presentation     Slide[] (rendered units: verse, lyric section, image, video cue)
      │ loaded by
Runtime          live slide, next slide, output assignment, timers, cue state
      │ recorded as
Service history  what actually went live, when, by whom
```

- Editing a **song** never changes a past **service**.
- A **program item** points at content by id and version; it does not copy the text
  (except as a frozen snapshot in a Release, see §5).
- **Runtime** is memory plus a crash-recovery journal; it is never the source of truth.
- **History** is append-only.

## 3. Entities

Identifiers are UUID v7 (`TEXT`), timestamps are ISO-8601 UTC. `created_by` / `updated_by`
reference `users.id` and may be `local` until the team model exists.

| Entity | Key fields | Notes |
|---|---|---|
| `song` | title, authors[], ccli_number?, copyright, default_key, language, tags | Source content |
| `song_section` | song_id, label (V1/C/B), order, lyrics (markdown-ish), secondary_lyrics? | Yoruba/English pairs live here |
| `song_arrangement` | song_id, name, sequence[] of section ids | "Sunday short" vs "full" |
| `hymnbook` / `hymn` | book code, number → song_id | Hymn-number search |
| `bible_passage` | translation_id(s), book, chapter, verse_start, verse_end | Source reference, text comes from `rhema.db` |
| `custom_slide` | title, body, template_id?, media_asset_id? | Announcements |
| `media_asset` | kind (image/video/audio), path, hash, duration?, width/height, source (local/canva), source_ref | Local file reference; hash detects moved/missing files |
| `theme` | existing `BroadcastTheme` JSON | Migrated from `broadcast-themes.json` |
| `brand_kit` | name, colours[], fonts[], logo asset ids | Planned |
| `program` | title, service_date, template_id?, status (draft/approved), revision | A service |
| `program_item` | program_id, order, kind, content_id, arrangement_id?, theme_id?, notes, duration_estimate | Arrangement layer |
| `release` | program_id, revision, snapshot (JSON), assets manifest, approved_by, approved_at | Frozen, validated package |
| `cue` / `timer` | program_item_id?, kind, params | Production |
| `output_profile` | name, outputs[] JSON | Replaces `outputs` in JSON |
| `stage_view` | name, layout JSON | Planned |
| `user`, `role`, `permission` | — | Planned; local-only default user until then |
| `audit_event` | actor, entity, entity_id, action, before/after (JSON), at | Append-only |
| `service_log` | release_id, at, item_id, action (live/clear/next), actor | History layer |

## 4. Storage decision

**Add one SQLite database for user content (`studio.db`) in the Tauri app-data
directory, owned by a new Rust crate `rhema-content`.** Reasons:

- `rusqlite` is already a dependency (Bible DB) — no new native dependency.
- Transactions, foreign keys and migrations are solved problems in SQLite; JSON blobs
  have none of them.
- Portable: one file per church, easy backup, easy "export service package".
- Keeps the Bible DB read-only and separately replaceable.

Not chosen: a second JSON store per entity (no transactions, no revisions), an embedded
document DB (new dependency, no benefit), cloud-first (violates offline requirement).

### Migrations

- `migrations/NNNN_name.sql` embedded with `include_str!`, applied in order inside one
  transaction each, recorded in `schema_migrations(version, applied_at)`.
- Never edit an applied migration; add a new one.
- The first migration imports `broadcast-themes.json` (themes, outputs) into tables and
  leaves the JSON file in place as a fallback for one release.

### Revisions and undo

- Content tables carry `revision INTEGER`; every write bumps it and inserts into
  `audit_event` with the before/after JSON. Undo = apply `before`.
- Programs keep full revisions: `program_revision(program_id, revision, snapshot JSON)`
  so "actual vs planned" is a diff of two snapshots.

### Validation

- Rust-side validation on write (required fields, referential integrity via FK, media
  path exists or is flagged `missing`).
- A **readiness report** function walks a release and lists missing assets, missing
  fonts, unsupported media, empty items. Home shows it.

## 5. Project vs Release vs Runtime

| | Project (program) | Release | Runtime |
|---|---|---|---|
| Mutable | yes, by anyone with edit rights | no | memory + journal |
| Stored | `program*` tables | `release` row + assets folder | `runtime-journal.json` |
| Used by | Prepare | Present loads this | Present executes |
| Sync | can arrive from remote | can arrive from remote; never auto-loaded while live | local only |

"Approve service" = validate project → write release → copy/verify assets locally.
Present shows "Updated release available" and the operator chooses when to switch.
This satisfies Scenario F (remote update cannot silently replace live content) and
Scenario E (release + assets are local).

## 6. Frontend contract

Rust exposes typed commands (`content_list_songs`, `content_save_program`, …) returning
`Result<T, ContentError>`; the frontend mirrors types in `src/types/content.ts`. Stores
stay Zustand; they become caches over the DB rather than owners of truth.

The queue store evolves into the rundown store by adding `kind` to items with a default
of `"verse"`; nothing else changes in the first step.
