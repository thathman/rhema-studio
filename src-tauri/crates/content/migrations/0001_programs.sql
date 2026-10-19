-- Services (programs) and their ordered items. Source content (Bible text)
-- stays in the read-only Bible database; items reference it by coordinates.

CREATE TABLE IF NOT EXISTS programs (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    service_date  TEXT,                                   -- ISO date, optional
    revision      INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_programs_date ON programs(service_date);

CREATE TABLE IF NOT EXISTS program_items (
    id            TEXT PRIMARY KEY,
    program_id    TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    position      INTEGER NOT NULL,
    kind          TEXT NOT NULL DEFAULT 'verse',          -- verse | song | slide | media (future)
    reference     TEXT NOT NULL,                          -- display label, e.g. "John 3:16"
    book_number   INTEGER,
    chapter       INTEGER,
    verse         INTEGER,
    notes         TEXT,
    UNIQUE(program_id, position)
);

CREATE TABLE IF NOT EXISTS audit_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entity        TEXT NOT NULL,
    entity_id     TEXT NOT NULL,
    action        TEXT NOT NULL,
    payload       TEXT,                                   -- JSON
    at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity, entity_id);
