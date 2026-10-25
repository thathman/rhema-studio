-- #246 C17 transcript retention: what was said, kept with a service log only when the operator
-- ticked it, lives in its own column so retention removes exactly that and never touches the log
-- itself (the execution history). transcript_removed_days: the retention that removed it (NULL:
-- not removed). Older builds read only the columns they name and ignore these.
ALTER TABLE service_logs ADD COLUMN transcript TEXT;
ALTER TABLE service_logs ADD COLUMN transcript_removed_days INTEGER;
