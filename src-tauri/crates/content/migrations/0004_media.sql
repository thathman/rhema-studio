-- Media assets: pictures (and later video/audio) the church imported.
-- Files live under <app data>/media/<hash>.<ext>; the row is the index.
-- `hash` (SHA-256 of the bytes) is the stable identity: moving or re-importing
-- the same picture never creates a second asset.

CREATE TABLE IF NOT EXISTS media_assets (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL,                      -- image | video | audio
    name          TEXT NOT NULL,                      -- display name, from the original file name
    file          TEXT NOT NULL,                      -- file name inside the media folder
    hash          TEXT NOT NULL UNIQUE,
    size          INTEGER NOT NULL,
    mime          TEXT NOT NULL,
    width         INTEGER,
    height        INTEGER,
    duration_ms   INTEGER,
    source        TEXT NOT NULL DEFAULT 'local',      -- local | canva (later)
    source_ref    TEXT NOT NULL DEFAULT '',
    original_path TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
