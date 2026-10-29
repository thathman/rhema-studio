-- A service run is a durable, local record of the service context and its
-- latest journal checkpoint. Legacy/manual service logs remain unassociated.
CREATE TABLE IF NOT EXISTS service_runs (
    run_id            TEXT PRIMARY KEY,
    program_id        TEXT,
    program_revision  INTEGER,
    service_date      TEXT,
    title             TEXT NOT NULL,
    time_zone         TEXT,
    started_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    finished_at       TEXT,
    status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'interrupted', 'finished')),
    checkpoint_json   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(checkpoint_json))
);
CREATE INDEX IF NOT EXISTS idx_service_runs_status_updated ON service_runs(status, updated_at DESC);

-- A final service log is unique per run. NULL remains valid for existing
-- manually kept logs and older app versions.
ALTER TABLE service_logs ADD COLUMN run_id TEXT;
ALTER TABLE service_logs ADD COLUMN finished_at TEXT;
ALTER TABLE service_logs ADD COLUMN time_zone TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_logs_run_id ON service_logs(run_id) WHERE run_id IS NOT NULL;
