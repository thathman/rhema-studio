-- Reusable slide and announcement sources. Service items keep their own
-- content snapshot; source edits never rewrite a saved service.
CREATE TABLE reusable_slides (
    id                  TEXT PRIMARY KEY,
    kind                TEXT NOT NULL CHECK (kind IN ('slide', 'announcement')),
    title               TEXT NOT NULL DEFAULT '',
    body                TEXT NOT NULL DEFAULT '',
    link                TEXT,
    background_media_id TEXT,
    revision            INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_reusable_slides_title ON reusable_slides(title COLLATE NOCASE);
CREATE INDEX idx_reusable_slides_background ON reusable_slides(background_media_id);
