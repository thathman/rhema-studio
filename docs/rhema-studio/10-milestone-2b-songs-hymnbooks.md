# 10 — Milestone 2B: Songs and Hymnbooks (specification)

Status: **historical design specification (2026-10-20).** Songs and hymnbooks are
implemented on `main`; this document records the original model and is not a current
delivery checklist. Current delivery and acceptance status is tracked in
[`TASKS.md`](../TASKS.md) and [`DEVELOPMENT-STATUS.md`](../DEVELOPMENT-STATUS.md).

## 1. Goal

A volunteer with no training can add a hymn in under two minutes, find it by number
or a line of its lyrics during a service, and put it on screen in English, Yoruba or
both, through the same Preview → Take live path verses use today.

Out of scope for 2B: chords/keys display, CCLI reporting uploads, cloud sync, media
backgrounds per song, stage display, multi-user editing. Song *text* is local only.

## 2. Vocabulary

| Term | Meaning |
|---|---|
| Song | One work: title, authors, copyright, lyrics in one or more languages. |
| Section | A labelled block of lyrics: Verse 1, Chorus, Bridge, Pre-chorus, Tag, Ending, Intro, Other. |
| Section text | The lyrics of one section in one language. A section has one text per language. |
| Arrangement | A named ordered list of sections (V1 C V2 C B C). A song has at least one, "Default". |
| Hymnbook | A named collection (e.g. "Sacred Songs and Solos", "Yoruba Baptist Hymnal") mapping hymn numbers to songs. |
| Hymn number | A song's number in one hymnbook. The same song may have numbers in several books. |
| Hymn identity | The service item's saved distinction and number snapshot; the reusable library content remains a song. |
| Slide | What goes on screen: one section (or a split of a long section) in the chosen language(s). |

## 3. Data model (`studio.db`, migration `0003_songs`)

All ids `TEXT` UUID v4 (as in 0001). Timestamps ISO-8601 UTC. Every table that is
edited carries `revision INTEGER NOT NULL DEFAULT 1` and goes through the same
optimistic-concurrency rule as programs.

```sql
CREATE TABLE songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,                 -- display title, language-neutral or primary
  title_sort TEXT NOT NULL,            -- lowercase, articles stripped, for ordering
  authors TEXT NOT NULL DEFAULT '',    -- "Fanny Crosby; William Doane" (semicolon list; no authors table in 2B)
  copyright TEXT NOT NULL DEFAULT '',  -- free text as printed in the hymnal
  ccli_number TEXT,                    -- nullable; digits only when present
  licence TEXT NOT NULL DEFAULT 'unknown', -- 'public_domain' | 'ccli' | 'custom' | 'unknown'
  licence_note TEXT NOT NULL DEFAULT '',   -- e.g. "Used by permission, church licence 123456"
  primary_language TEXT NOT NULL DEFAULT 'en', -- BCP-47: 'en', 'yo'
  tags TEXT NOT NULL DEFAULT '',       -- comma list; free text in 2B
  notes TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE song_sections (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,           -- authoring order, UNIQUE(song_id, position)
  kind TEXT NOT NULL,                  -- 'verse'|'chorus'|'bridge'|'prechorus'|'tag'|'ending'|'intro'|'other'
  label TEXT NOT NULL,                 -- "Verse 1", "Chorus"; derived default, editable
  UNIQUE(song_id, position)
);

CREATE TABLE song_section_texts (
  section_id TEXT NOT NULL REFERENCES song_sections(id) ON DELETE CASCADE,
  language TEXT NOT NULL,              -- 'en', 'yo'
  body TEXT NOT NULL,                  -- plain text, newline = line break, blank line = slide split hint
  PRIMARY KEY (section_id, language)
);

CREATE TABLE song_arrangements (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                  -- "Default", "Short", "Sunday evening"
  sequence TEXT NOT NULL,              -- JSON array of section ids; sections may repeat
  is_default INTEGER NOT NULL DEFAULT 0,
  UNIQUE(song_id, name)
);

CREATE TABLE hymnbooks (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,           -- short: "SSS", "YBH"
  name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  publisher TEXT NOT NULL DEFAULT '',
  licence_note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE hymn_numbers (
  hymnbook_id TEXT NOT NULL REFERENCES hymnbooks(id) ON DELETE CASCADE,
  number TEXT NOT NULL,                -- TEXT: "245", "245a", "12b"
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  PRIMARY KEY (hymnbook_id, number)
);

CREATE VIRTUAL TABLE song_search USING fts5(
  song_id UNINDEXED, title, authors, lyrics, numbers,
  tokenize = 'unicode61 remove_diacritics 2'
);
-- Maintained by the crate on every song write (delete + insert; no triggers across
-- JSON). remove_diacritics 2 lets "Olorun" match "Ọlọ́run".
```

Program items (existing `program_items`) gain nothing new in the schema: a song item
is `kind = 'song'`, keeps its stable library `song_id` in the JSON payload, and uses
`reference` for its display title. The nullable `payload TEXT` column added in 0003
holds arrangement and language choices. New hymn items also save optional `hymn: true`
and `hymn_numbers: [...]` snapshots in that JSON. Older service files without those
fields remain readable; views can resolve identity from the linked library song.
These are additive payload fields, not a schema migration, and never replace or
renumber `song_id`.

Deleting a song that a saved service references: refuse with `Conflict`-style error
listing the services ("Used in: Sunday 25 Oct, …"). No cascading edits of services.

## 4. Rust crate API (`rhema-content`)

```rust
pub struct SongInput { title, authors, copyright, ccli_number, licence, licence_note,
                       primary_language, tags, notes, sections: Vec<SectionInput>,
                       arrangements: Vec<ArrangementInput> }
pub struct SectionInput { id: Option<String>, kind, label, texts: BTreeMap<String /*lang*/, String> }
pub struct ArrangementInput { id: Option<String>, name, sequence: Vec<String>, is_default: bool }

impl ContentDb {
  fn list_songs(&self, query: Option<&str>, limit) -> Vec<SongSummary>   // FTS when query given
  fn search_songs(&self, q: &str) -> Vec<SongHit>   // "245", "SSS 245", "amazing grace", "ọlọ́run mi"
  fn get_song(&self, id) -> Option<SongWithSections>
  fn create_song(&self, SongInput) -> SongWithSections
  fn update_song(&self, id, expected_revision, SongInput) -> SongWithSections   // sections keep ids
  fn delete_song(&self, id, expected_revision) -> Result<(), ContentError>     // refuses when referenced
  fn list_hymnbooks / upsert_hymnbook / set_hymn_number(book, number, song) / clear_hymn_number
  fn export_songs(&self, ids: Option<&[String]>) -> SongExport   // JSON, version 1
  fn import_songs(&self, SongExport, mode: Skip|Replace|Duplicate) -> ImportReport
}
```

Validation (same style as `validate_items`): title 1..200 chars, ≤ 60 sections,
section body ≤ 4000 chars, language tag `^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$`,
ccli digits only ≤ 12, arrangement sequence ids must belong to the song, at most one
default arrangement, hymn number `^[0-9]{1,5}[a-z]?$`.

Audit: `audit_events` rows for song create/update/delete and import, `actor` NULL.

Tauri commands mirror these as `content_song_*` with the existing
`ContentCommandError` shape.

## 5. Search

One Quick find box serves verses and songs. Resolution order:

1. Looks like a scripture reference (existing parser, numbered books) → verses.
2. `^(?:([A-Za-z]{1,6})\s*)?#?(\d{1,5}[a-z]?)$` → hymn number, optionally with book code;
   bare number searches all hymnbooks.
3. Otherwise FTS over title, authors, lyrics (prefix match on the last token).

Results show: title, hymnbook codes+numbers, first line, language badges (EN/YO),
licence badge (PD / CCLI / custom / unknown). Enter previews, "Add" appends to the
rundown with the default arrangement and the service's current language choice.

## 6. UI

### 6.1 Prepare → Songs tab
- Left: search box and results. Right: song editor.
- "New song" opens a **paste-first** editor: one big text area labelled
  "Paste the words. Put a blank line between verses. Write 'Chorus' on its own line
  above the chorus." A parser turns it into sections (labels recognised:
  verse/chorus/bridge/tag/ending and Yoruba equivalents: "Ẹsẹ 1", "Ẹgbẹ́ orin"). The
  result is shown as cards the volunteer can relabel from a dropdown. No markup to learn.
- Each section card has an EN and a YO text area side by side (second language
  collapsible). A song with Yoruba only is fine.
- Metadata is one short form: Title, Authors, Hymnbook + number (repeatable row),
  Copyright, CCLI number, Licence (Public domain / CCLI / Custom / Unknown), Notes.
  Unknown licence shows a soft warning, not a block.
- Save uses the service-store pattern: dirty tracking, conflict → Reload, no silent loss.

### 6.2 Arrangement editor
- A horizontal strip of section chips (V1, C, V2, …) representing the sequence.
  Drag chips to reorder; click "+" on a section in the palette to append it; "×" on a
  chip removes that occurrence. Keyboard: arrow keys move focus, Space picks up/drops.
- Arrangements are named; "Default" is created automatically as authoring order
  with the chorus repeated after each verse when exactly one chorus exists
  (the common hymnal case; editable).
- Implemented with `@dnd-kit/react`, which the repo already depends on (the rundown
  uses it); no new dependency.

### 6.3 Service Builder (existing rundown)
- Song items render as a card: title, hymn number, arrangement name, language
  badges, slide count. Clicking expands to the slide list.
- Per-item controls: arrangement dropdown, languages (EN / YO / both), notes.
- Stored as `kind='song'` + payload. Unsupported-kind handling stays for anything else.

### 6.4 Present
- Standard view: Next/Prev step through slides within the song, then onto the next
  item. The big Next button shows the next section label ("Next: Chorus").
- Production view: the queue panel shows the song's slides as a sub-list; a slide
  click presents it.
- Take live / Clear / Restore unchanged. Remote `next`/`prev` step slides.

## 7. Presentation through the existing engine

`presentVerse()` stays the only writer for verses. Add a sibling `presentSlide()`
that is the only writer for lyric slides, both ending in `setLiveVerse`-equivalent
state. `VerseRenderData` is generalised to:

```ts
export type RenderData =
  | { kind: "verse"; reference; segments; translationLines? }       // existing shape, unchanged
  | { kind: "lyric"; title: string; sectionLabel: string; lines: string[]; secondaryLines?: string[]; footer?: string }
```

`kind` is optional on the verse variant so every existing caller and test keeps
working. The renderer draws `lyric` with `theme.verseText` for `lines`,
`theme.secondaryVerseText ?? verseText` for `secondaryLines`, and `theme.reference`
style for the title/section label at the reference position. `footer` carries the
copyright line (title, authors, CCLI, licence note) when the song's licence requires
it; a theme flag `showCopyrightFooter` (default on for CCLI/custom) controls it.
Dual-language themes therefore work for songs with no theme changes.

Slide splitting: a section's text is split on blank lines first; if any resulting
slide exceeds `theme.maxLyricLines` (default 6) it is split evenly. EN/YO slides are
aligned by section, never by line count: a slide shows the whole section in both
languages, split only when both exceed the limit.

Broadcast outputs (display, NDI) and OBS need no change: they consume the rendered
frame.

## 8. Persistence, import and export

- Local only, in `studio.db`, under the existing backup/migration machinery
  (`studio.db.before-0003.bak` on first run).
- **Export**: Library → Import & export → Save songs to a file: a single `rhema-songs-v1.json`
  (songs, sections, texts, arrangements, hymnbooks, numbers). Optional subset.
- **Import**:
  - `rhema-songs-v1.json` (round trip; modes Skip existing / Replace / Duplicate).
  - OpenLyrics XML (the open interchange format used by OpenLP and others): title,
    authors, copyright, ccliNo, verses with `name` (v1, c, b) and `lang` → sections
    and texts. Unknown elements ignored and reported, never silently dropped.
  - Plain text paste (the editor in 6.1).
- Import never overwrites without the Replace mode and shows a report
  (added / skipped / replaced / errors) before committing in one transaction.

## 9. Copyright and licensing

- Every song carries `copyright`, `ccli_number`, `licence`, `licence_note`. They
  are shown in the editor, in the rundown card tooltip, and (when required) as the
  slide footer. Export includes them verbatim.
- The app never claims a licence it cannot know: "Unknown" is a real state. The
  readiness list on Home gains an info line "N songs in today's service have unknown
  licence" with a link to the editor. No blocking.
- Hymnbooks record publisher and a licence note. Public-domain hymnals (e.g. most
  pre-1929 English texts) may be marked so once by the church; the app does not
  decide.
- Bundled content: none. 2B ships no song texts.

## 10. Acceptance tests (to be written first)

Rust (`crates/content`, temp files):
1. create → get round trip with EN+YO texts and two arrangements; ids stable on update.
2. update with stale revision → `Conflict{expected, actual}`.
3. delete a song used by a service → refused with the service titles; after removing
   the item, delete succeeds and FTS row is gone.
4. FTS: "amazing" finds by title; "wretch like me" by lyrics; "Ọlọ́run" and "olorun"
   both find a Yoruba song; "245" finds by number; "SSS 245" only in that book.
5. migration 0003 on a 0002 file: backup created once, programs intact, songs usable.
6. import JSON: Skip/Replace/Duplicate modes; import is atomic on error.
7. import OpenLyrics sample with `lang="yo"` verses → sections carry both languages.
8. validation: bad language tag, sequence referencing another song's section,
   two default arrangements, hymn number "abc" → `Invalid` with the item index.

Frontend (vitest):
9. paste parser: blank-line split, "Chorus" label, "Ẹgbẹ́ orin" label, numbered verses.
10. slide splitting: 6-line limit, blank-line hints, EN/YO aligned per section.
11. `toItemInputs`/`toQueueItems` with `kind='song'`: payload survives open/save/reopen;
    a song item whose song was deleted is set aside, not dropped.
12. `rundownSignature` changes when arrangement or languages change.
13. Quick find resolver: reference vs hymn number vs lyric text, including "1 John 1:1"
    (a reference, not hymn 1).
14. presentSlide: refuses an empty slide, dual-language render data when both texts
    exist, footer present for CCLI songs and absent for public domain.
15. Standard view Next at the last slide advances to the next rundown item; Prev at
    the first slide goes to the previous item's last slide.

Manual (added to `08-desktop-acceptance-guide.md` when 2B lands):
16. Volunteer test: a person who has never used the app adds a hymn from a printed
    hymnal, with chorus, in under two minutes, without help.
17. Service with verse → song (EN+YO) → verse, driven only by the Next button and by
    OSC `/rhema/next`.
18. OBS receives lyric slides with the footer; transparent theme keys correctly.

## 11. Sequencing

1. Migration 0003 + crate API + tests (1–8).
2. Stores and resolver + tests (9–13).
3. Render data `kind` + renderer + `presentSlide` + tests (14–15).
4. Prepare → Songs tab, paste-first editor, arrangement strip.
5. Service Builder and Present integration.
6. Import/export (JSON, OpenLyrics).
7. Manual acceptance (16–18), then PR against `main`.

Each step is its own PR on top of the previous; none merges before its tests pass
in CI and the owner approves.
