-- After-action notes per service run (#854 G10; doc 28 History). The run's
-- captured context and checkpoint stay as they were; only the notes are
-- writable, and writing them does not move `updated_at` (which marks the
-- last checkpoint and decides whether a run is still current).
ALTER TABLE service_runs ADD COLUMN after_action_notes TEXT;
ALTER TABLE service_runs ADD COLUMN notes_updated_at TEXT;
