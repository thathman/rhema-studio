-- Library collections (#853 G9): user-made groups of library items, such as
-- "Christmas", "Communion" or "Youth Sunday". A collection holds references,
-- never copies: removing a collection or an item from it leaves the song,
-- slide, picture or design in the library. An item deleted from the library
-- stays listed as missing until it is removed from the collection.
CREATE TABLE IF NOT EXISTS library_collections (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_library_collections_name ON library_collections(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS library_collection_items (
    collection_id TEXT NOT NULL REFERENCES library_collections(id) ON DELETE CASCADE,
    item_kind     TEXT NOT NULL CHECK (item_kind IN ('song', 'slide', 'media', 'design')),
    item_id       TEXT NOT NULL,
    position      INTEGER NOT NULL,
    added_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (collection_id, item_kind, item_id)
);
CREATE INDEX IF NOT EXISTS idx_library_collection_items_item ON library_collection_items(item_kind, item_id);
