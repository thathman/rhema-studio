-- #851 G7: archive a design from My Designs (hidden from the default list and the Prepare picker,
-- kept with its versions, restorable). Additive and nullable: NULL means not archived, so every
-- existing design stays exactly as it was.
ALTER TABLE design_documents ADD COLUMN archived_at TEXT;
