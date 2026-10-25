-- Reusable scene/look revisions captured when a service is approved.
-- Deleting an old service revision cascades its now-obsolete design snapshot.
CREATE TABLE IF NOT EXISTS approved_design_snapshots (
    program_id TEXT NOT NULL,
    revision   INTEGER NOT NULL,
    snapshot   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (program_id, revision),
    FOREIGN KEY (program_id, revision) REFERENCES program_revisions(program_id, revision) ON DELETE CASCADE
);

-- A revision keeps imported video/image files available even when no rundown
-- item directly references them (for example, a scene's video background).
CREATE TABLE IF NOT EXISTS approved_design_media (
    program_id TEXT NOT NULL,
    revision   INTEGER NOT NULL,
    media_id   TEXT NOT NULL,
    PRIMARY KEY (program_id, revision, media_id),
    FOREIGN KEY (program_id, revision) REFERENCES approved_design_snapshots(program_id, revision) ON DELETE CASCADE,
    FOREIGN KEY (media_id) REFERENCES media_assets(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_approved_design_media_media ON approved_design_media(media_id);
