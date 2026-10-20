-- A snapshot of a service's items after every save, so an operator can see
-- what changed and go back. The last 50 per service are kept.

CREATE TABLE IF NOT EXISTS program_revisions (
    id           TEXT PRIMARY KEY,
    program_id   TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    revision     INTEGER NOT NULL,                     -- programs.revision after the write
    title        TEXT NOT NULL,
    service_date TEXT,
    items        TEXT NOT NULL,                        -- JSON array of ItemInput-shaped rows
    item_count   INTEGER NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(program_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_program_revisions_program ON program_revisions(program_id, revision DESC);
