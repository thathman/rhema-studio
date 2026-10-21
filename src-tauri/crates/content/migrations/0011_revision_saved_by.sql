-- CL-007 / FR-08 'visible Updated by attribution': who saved each version
-- (the operator name set on that computer, as on audit rows).
ALTER TABLE program_revisions ADD COLUMN saved_by TEXT;
