-- Editable Avnac design documents (C2; doc 29: one canonical design store). `document` is the
-- editor's draft; each version is an immutable copy a service or scene can pin by number.
CREATE TABLE IF NOT EXISTS design_documents (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '',
    kind        TEXT NOT NULL DEFAULT 'design',
    document    TEXT NOT NULL,
    revision    INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_design_documents_title ON design_documents(title COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS design_versions (
    design_id   TEXT NOT NULL,
    version     INTEGER NOT NULL,
    from_revision INTEGER NOT NULL,
    title       TEXT NOT NULL,
    document    TEXT NOT NULL,
    note        TEXT,
    saved_by    TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (design_id, version)
);

CREATE TRIGGER IF NOT EXISTS design_versions_immutable_update BEFORE UPDATE ON design_versions
BEGIN SELECT RAISE(ABORT, 'design versions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS design_versions_immutable_delete BEFORE DELETE ON design_versions
BEGIN SELECT RAISE(ABORT, 'design versions are immutable'); END;
