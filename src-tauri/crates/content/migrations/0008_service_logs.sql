-- Saved service logs (AR-003): the text the operator kept after a service,
-- so "what did we show on 12 October?" has an answer after a restart.
CREATE TABLE IF NOT EXISTS service_logs (
    id          TEXT PRIMARY KEY,
    program_id  TEXT,                                   -- may outlive the program
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    saved_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_service_logs_saved ON service_logs(saved_at DESC);
