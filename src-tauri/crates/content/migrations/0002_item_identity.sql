-- Translation identity on items and (nullable) actor on audit rows.
--
-- `translation` / `secondary_translation` hold translation abbreviations
-- (e.g. "KJV", "OYCB"), never database row ids, which change when the Bible
-- database is rebuilt. NULL means "follow the operator's active translation".
-- `book_number` stays the canonical Protestant 1..66 numbering the Bible
-- database uses for every translation (the OYCB import maps onto it).
--
-- `actor` is NULL until a user model exists. No placeholder values.

ALTER TABLE program_items ADD COLUMN translation TEXT;
ALTER TABLE program_items ADD COLUMN secondary_translation TEXT;
ALTER TABLE audit_events ADD COLUMN actor TEXT;
