-- PRD FR-03: archive a service (hidden from the picker, kept with its
-- history and logs) and mark a service as a template (the starting point for
-- new services: 9 am, 11 am, communion, youth).
ALTER TABLE programs ADD COLUMN archived_at TEXT;
ALTER TABLE programs ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0;
-- CL-002: who approved it (the operator name on this computer, as on audit rows).
ALTER TABLE programs ADD COLUMN approved_by TEXT;
