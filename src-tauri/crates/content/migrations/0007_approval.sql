-- An explicit "this is the version for Sunday": the program revision that
-- was approved (its snapshot lives in program_revisions) and when.
ALTER TABLE programs ADD COLUMN approved_revision INTEGER;
ALTER TABLE programs ADD COLUMN approved_at TEXT;
