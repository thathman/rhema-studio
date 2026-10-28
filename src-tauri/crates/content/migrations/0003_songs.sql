-- Songs, sections, lyrics per language, arrangements, hymnbooks and numbers.
-- Song text is user content and lives here, local only. No song text ships
-- with the app.

CREATE TABLE IF NOT EXISTS songs (
    id               TEXT PRIMARY KEY,
    title            TEXT NOT NULL,
    title_sort       TEXT NOT NULL,                     -- lowercase, leading article stripped
    authors          TEXT NOT NULL DEFAULT '',          -- "Fanny Crosby; William Doane"
    copyright        TEXT NOT NULL DEFAULT '',
    ccli_number      TEXT,                              -- digits only when present
    licence          TEXT NOT NULL DEFAULT 'unknown',   -- public_domain | ccli | custom | unknown
    licence_note     TEXT NOT NULL DEFAULT '',
    primary_language TEXT NOT NULL DEFAULT 'en',        -- BCP-47 tag: en, yo
    tags             TEXT NOT NULL DEFAULT '',          -- comma list
    notes            TEXT NOT NULL DEFAULT '',
    revision         INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_songs_title_sort ON songs(title_sort);

CREATE TABLE IF NOT EXISTS song_sections (
    id        TEXT PRIMARY KEY,
    song_id   TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL,                         -- authoring order
    kind      TEXT NOT NULL,                            -- verse|chorus|bridge|prechorus|tag|ending|intro|other
    label     TEXT NOT NULL,                            -- "Verse 1", "Chorus"
    UNIQUE(song_id, position)
);

CREATE TABLE IF NOT EXISTS song_section_texts (
    section_id TEXT NOT NULL REFERENCES song_sections(id) ON DELETE CASCADE,
    language   TEXT NOT NULL,
    body       TEXT NOT NULL,                           -- newline = line break, blank line = slide split
    PRIMARY KEY (section_id, language)
);

CREATE TABLE IF NOT EXISTS song_arrangements (
    id         TEXT PRIMARY KEY,
    song_id    TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    sequence   TEXT NOT NULL,                           -- JSON array of section ids; repeats allowed
    is_default INTEGER NOT NULL DEFAULT 0,
    UNIQUE(song_id, name)
);

CREATE TABLE IF NOT EXISTS hymnbooks (
    id           TEXT PRIMARY KEY,
    code         TEXT NOT NULL UNIQUE,                  -- "SSS", "YBH"
    name         TEXT NOT NULL,
    language     TEXT NOT NULL DEFAULT 'en',
    publisher    TEXT NOT NULL DEFAULT '',
    licence_note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS hymn_numbers (
    hymnbook_id TEXT NOT NULL REFERENCES hymnbooks(id) ON DELETE CASCADE,
    number      TEXT NOT NULL,                          -- "245", "245a"
    song_id     TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    PRIMARY KEY (hymnbook_id, number)
);

CREATE INDEX IF NOT EXISTS idx_hymn_numbers_song ON hymn_numbers(song_id);

-- Full-text index maintained by the crate on every song write.
-- remove_diacritics 2 lets "olorun" match "Ọlọ́run" on the folded column.
CREATE VIRTUAL TABLE IF NOT EXISTS song_search USING fts5(
    song_id UNINDEXED, title, authors, lyrics, numbers,
    tokenize = 'unicode61 remove_diacritics 2'
);

-- Song items in a service: kind = 'song', reference = title for display,
-- payload = {"song_id", "arrangement_id", "languages"}.
ALTER TABLE program_items ADD COLUMN payload TEXT;
