# 05 — Domain Model and Persistence Proposal

Status: implementation reference. `src-tauri/crates/content` owns the local `studio.db`
and applies additive migrations `0001`–`0015`. The database currently covers services and
their revisions, songs and hymnbooks, imported media, attachments, service logs, approval
snapshots, reusable slides and announcements, and audit events. Settings and production
looks remain in local JSON stores. Treat code and the current migrations as the source of
truth where older proposal text below disagrees.

### Bible identity on items (implemented)
Items store `book_number` (canonical Protestant 1–66 numbering shared by every
translation in `rhema.db`, including OYCB), `chapter`, `verse`, and translation
**abbreviations** (`translation`, `secondary_translation`), never translation row ids,
which change when the Bible database is rebuilt. `NULL` translation means "follow the
operator's active translation".

Fidelity rule (implemented in `service-store.ts`): a rundown item loaded from a service
carries its stored `translation`, `secondary_translation` and `notes` verbatim and writes
them back unchanged on save, whatever the operator is presenting with. Only items that
were never saved take the translation they were added with and the current secondary.
A pinned translation that is not installed is reported (`missingTranslations`), text is
looked up in the active translation instead, and the pin survives the next save.
Changing any of these fields marks the service dirty.

Versification differences between translations are not
modelled yet; when a translation with a different versification is added, a
`versification` column keyed per translation is the planned extension.

### Audit, actor, backups (implemented)
`audit_events.actor` is `NULL` until a user model exists; no placeholder values are
written. Before applying a migration to an existing file the crate writes
`studio.db.before-<version>.bak` via SQLite's online backup API. Content writes use
transactions; service and reusable-slide edits use expected revisions and record audit
events. The Settings backup flow copies the database.

## 1. What exists today

| Data | Where | Shape |
|---|---|---|
| Bible text | `data/rhema.db` (read-only SQLite, bundled) | translations, books, verses, cross-references |
| Church content | `studio.db` (`rhema-content`) | services/items/revisions, songs/hymnbooks, media, service logs, reusable slides, audit |
| Settings and operator preferences | local app stores and `localStorage` | per-machine configuration |
| Production looks and outputs | local broadcast theme store | scenes, themes, output configuration and related snapshots |
| Live queue and runtime | in-memory stores | working state; saved services live in `studio.db` |

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
- A reusable slide or announcement is a source asset. A service occurrence stores its
  own title, words, link, background and optional source id/revision. Editing the source
  never silently changes the saved service occurrence; importing a service occurrence
  into the Library creates a separate reusable source.
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
| `reusable_slides` (migration 0015) | kind, title, body, link?, background_media_id?, revision | Reusable slide/announcement source; service occurrences keep copied payloads plus source id/revision |
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
- Migrations are additive and transactional; never edit a migration already applied to
  a user's database. Existing local stores remain outside `studio.db` until an explicit
  migration is implemented.

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
