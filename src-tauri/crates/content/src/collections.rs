//! Library collections (#853 G9, migration 0019): user-made groups of library
//! items. A collection holds references (kind + id), never copies, so removing
//! a collection, or an item from one, never removes anything from the library.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::{audit, is_valid_id, new_id, ContentDb, ContentError, Result};

pub const MAX_COLLECTION_NAME: usize = 120;
pub const MAX_COLLECTION_ITEMS: i64 = 2000;
const ITEM_KINDS: [&str; 4] = ["song", "slide", "media", "design"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CollectionSummary {
    pub id: String,
    pub name: String,
    pub item_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CollectionItem {
    /// `song`, `slide`, `media` or `design`.
    pub kind: String,
    pub item_id: String,
    /// The library item's current title, or `None` when it is no longer in the library.
    pub title: Option<String>,
    /// For a song: whether it has hymn numbers (a hymn). For media: image, video or audio.
    pub detail: Option<String>,
    pub position: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Collection {
    pub summary: CollectionSummary,
    pub items: Vec<CollectionItem>,
}

fn validate_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(ContentError::Invalid("give the collection a name".into()));
    }
    if name.chars().count() > MAX_COLLECTION_NAME {
        return Err(ContentError::Invalid(format!("a collection name is at most {MAX_COLLECTION_NAME} characters")));
    }
    Ok(name.to_string())
}

fn validate_kind(kind: &str) -> Result<()> {
    if ITEM_KINDS.contains(&kind) {
        Ok(())
    } else {
        Err(ContentError::Invalid(format!("a collection holds songs, slides, media or designs, not '{kind}'")))
    }
}

fn load_summary(conn: &Connection, id: &str) -> Result<Option<CollectionSummary>> {
    Ok(conn
        .query_row(
            "SELECT c.id, c.name, (SELECT COUNT(*) FROM library_collection_items i WHERE i.collection_id = c.id), c.created_at, c.updated_at
               FROM library_collections c WHERE c.id = ?1",
            params![id],
            row_to_summary,
        )
        .optional()?)
}

fn row_to_summary(r: &rusqlite::Row<'_>) -> rusqlite::Result<CollectionSummary> {
    Ok(CollectionSummary { id: r.get(0)?, name: r.get(1)?, item_count: r.get(2)?, created_at: r.get(3)?, updated_at: r.get(4)? })
}

/// Whether the library has this item now (an add must name something real).
fn item_exists(conn: &Connection, kind: &str, item_id: &str) -> Result<bool> {
    let table = match kind {
        "song" => "songs",
        "slide" => "reusable_slides",
        "media" => "media_assets",
        "design" => "design_documents",
        _ => return Ok(false),
    };
    let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {table} WHERE id = ?1"), params![item_id], |r| r.get(0))?;
    Ok(n > 0)
}

fn touch(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("UPDATE library_collections SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1", params![id])?;
    Ok(())
}

impl ContentDb {
    /// Every collection, by name.
    pub fn list_collections(&self) -> Result<Vec<CollectionSummary>> {
        let conn = self.lock()?;
        let mut st = conn.prepare(
            "SELECT c.id, c.name, (SELECT COUNT(*) FROM library_collection_items i WHERE i.collection_id = c.id), c.created_at, c.updated_at
               FROM library_collections c ORDER BY c.name COLLATE NOCASE, c.id",
        )?;
        let rows = st.query_map([], row_to_summary)?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// One collection with its items in order, each with the library's current title.
    pub fn get_collection(&self, id: &str) -> Result<Option<Collection>> {
        let conn = self.lock()?;
        let Some(summary) = load_summary(&conn, id)? else { return Ok(None) };
        let mut st = conn.prepare(
            "SELECT i.item_kind, i.item_id,
                    CASE i.item_kind
                      WHEN 'song' THEN (SELECT title FROM songs WHERE id = i.item_id)
                      WHEN 'slide' THEN (SELECT CASE WHEN trim(title) != '' THEN title ELSE substr(body, 1, 80) END FROM reusable_slides WHERE id = i.item_id)
                      WHEN 'media' THEN (SELECT name FROM media_assets WHERE id = i.item_id)
                      WHEN 'design' THEN (SELECT title FROM design_documents WHERE id = i.item_id)
                    END,
                    CASE i.item_kind
                      WHEN 'song' THEN (SELECT CASE WHEN EXISTS (SELECT 1 FROM hymn_numbers hn WHERE hn.song_id = i.item_id) THEN 'hymn' ELSE 'song' END FROM songs WHERE id = i.item_id)
                      WHEN 'slide' THEN (SELECT kind FROM reusable_slides WHERE id = i.item_id)
                      WHEN 'media' THEN (SELECT kind FROM media_assets WHERE id = i.item_id)
                      ELSE NULL
                    END,
                    i.position
               FROM library_collection_items i
              WHERE i.collection_id = ?1
              ORDER BY i.position, i.added_at",
        )?;
        let items = st
            .query_map(params![id], |r| {
                Ok(CollectionItem { kind: r.get(0)?, item_id: r.get(1)?, title: r.get(2)?, detail: r.get(3)?, position: r.get(4)? })
            })?
            .collect::<std::result::Result<_, _>>()?;
        Ok(Some(Collection { summary, items }))
    }

    pub fn create_collection(&self, name: &str) -> Result<CollectionSummary> {
        let name = validate_name(name)?;
        let id = new_id();
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        tx.execute("INSERT INTO library_collections (id, name) VALUES (?1, ?2)", params![id, name])?;
        audit(&tx, "library_collection", &id, "create", &serde_json::json!({ "name": name }))?;
        let saved = load_summary(&tx, &id)?.ok_or_else(|| ContentError::NotFound(id.clone()))?;
        tx.commit()?;
        Ok(saved)
    }

    pub fn rename_collection(&self, id: &str, name: &str) -> Result<CollectionSummary> {
        let name = validate_name(name)?;
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let n = tx.execute(
            "UPDATE library_collections SET name = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
            params![id, name],
        )?;
        if n == 0 {
            return Err(ContentError::NotFound(id.to_string()));
        }
        audit(&tx, "library_collection", id, "rename", &serde_json::json!({ "name": name }))?;
        let saved = load_summary(&tx, id)?.ok_or_else(|| ContentError::NotFound(id.to_string()))?;
        tx.commit()?;
        Ok(saved)
    }

    /// Remove the collection only; every item stays in the library.
    pub fn delete_collection(&self, id: &str) -> Result<()> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let n = tx.execute("DELETE FROM library_collections WHERE id = ?1", params![id])?;
        if n == 0 {
            return Err(ContentError::NotFound(id.to_string()));
        }
        audit(&tx, "library_collection", id, "delete", &serde_json::json!({}))?;
        tx.commit()?;
        Ok(())
    }

    /// Add a library item at the end. Adding one already there changes nothing.
    pub fn add_to_collection(&self, id: &str, kind: &str, item_id: &str) -> Result<Collection> {
        validate_kind(kind)?;
        if !is_valid_id(item_id) {
            return Err(ContentError::Invalid("not a library item id".into()));
        }
        {
            let mut conn = self.lock()?;
            let tx = conn.transaction()?;
            if load_summary(&tx, id)?.is_none() {
                return Err(ContentError::NotFound(id.to_string()));
            }
            if !item_exists(&tx, kind, item_id)? {
                return Err(ContentError::NotFound(format!("{kind} {item_id}")));
            }
            let (count, next): (i64, i64) = tx.query_row(
                "SELECT COUNT(*), COALESCE(MAX(position), -1) + 1 FROM library_collection_items WHERE collection_id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            let present: bool = tx
                .query_row(
                    "SELECT 1 FROM library_collection_items WHERE collection_id = ?1 AND item_kind = ?2 AND item_id = ?3",
                    params![id, kind, item_id],
                    |_| Ok(true),
                )
                .optional()?
                .unwrap_or(false);
            if !present {
                if count >= MAX_COLLECTION_ITEMS {
                    return Err(ContentError::Invalid(format!("a collection holds at most {MAX_COLLECTION_ITEMS} items")));
                }
                tx.execute(
                    "INSERT INTO library_collection_items (collection_id, item_kind, item_id, position) VALUES (?1, ?2, ?3, ?4)",
                    params![id, kind, item_id, next],
                )?;
                touch(&tx, id)?;
                audit(&tx, "library_collection", id, "add_item", &serde_json::json!({ "kind": kind, "item_id": item_id }))?;
            }
            tx.commit()?;
        }
        self.get_collection(id)?.ok_or_else(|| ContentError::NotFound(id.to_string()))
    }

    /// Take an item out of the collection; the library keeps it.
    pub fn remove_from_collection(&self, id: &str, kind: &str, item_id: &str) -> Result<Collection> {
        validate_kind(kind)?;
        {
            let mut conn = self.lock()?;
            let tx = conn.transaction()?;
            if load_summary(&tx, id)?.is_none() {
                return Err(ContentError::NotFound(id.to_string()));
            }
            let n = tx.execute(
                "DELETE FROM library_collection_items WHERE collection_id = ?1 AND item_kind = ?2 AND item_id = ?3",
                params![id, kind, item_id],
            )?;
            if n > 0 {
                touch(&tx, id)?;
                audit(&tx, "library_collection", id, "remove_item", &serde_json::json!({ "kind": kind, "item_id": item_id }))?;
            }
            tx.commit()?;
        }
        self.get_collection(id)?.ok_or_else(|| ContentError::NotFound(id.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use crate::{ContentDb, ContentError, ReusableSlideInput, SectionInput, SongInput};

    fn song(db: &ContentDb, title: &str) -> String {
        db.create_song(&SongInput {
            title: title.into(),
            sections: vec![SectionInput { id: None, kind: "verse".into(), label: "Verse 1".into(), texts: [("en".to_string(), "words".to_string())].into() }],
            ..SongInput::default()
        })
        .unwrap()
        .song
        .id
    }

    fn slide(db: &ContentDb, title: &str) -> String {
        db.create_reusable_slide(&ReusableSlideInput { kind: "announcement".into(), title: title.into(), body: "Friday 6 pm".into(), ..ReusableSlideInput::default() }).unwrap().id
    }

    #[test]
    fn migration_0019_creates_empty_collection_tables() {
        let db = ContentDb::open_in_memory().unwrap();
        assert!(db.applied_migrations().unwrap().contains(&"0019_library_collections".to_string()));
        assert_eq!(db.list_collections().unwrap().len(), 0);
    }

    #[test]
    fn a_collection_groups_songs_and_slides_in_order_by_reference() {
        let db = ContentDb::open_in_memory().unwrap();
        let grace = song(&db, "Amazing Grace");
        let notice = slide(&db, "Carol service");
        let christmas = db.create_collection("  Christmas  ").unwrap();
        assert_eq!(christmas.name, "Christmas");

        db.add_to_collection(&christmas.id, "song", &grace).unwrap();
        db.add_to_collection(&christmas.id, "slide", &notice).unwrap();
        // Adding again changes nothing.
        let got = db.add_to_collection(&christmas.id, "song", &grace).unwrap();
        let rows: Vec<(&str, Option<&str>, Option<&str>)> = got.items.iter().map(|i| (i.kind.as_str(), i.title.as_deref(), i.detail.as_deref())).collect();
        assert_eq!(rows, vec![("song", Some("Amazing Grace"), Some("song")), ("slide", Some("Carol service"), Some("announcement"))]);
        assert_eq!(db.list_collections().unwrap()[0].item_count, 2);

        // A rename keeps the items; removing one keeps the song in the library.
        let renamed = db.rename_collection(&christmas.id, "Advent and Christmas").unwrap();
        assert_eq!(renamed.name, "Advent and Christmas");
        let after = db.remove_from_collection(&christmas.id, "song", &grace).unwrap();
        assert_eq!(after.items.len(), 1);
        assert!(db.get_song(&grace).unwrap().is_some());
    }

    #[test]
    fn deleting_a_collection_keeps_its_items_and_a_deleted_item_reads_as_missing() {
        let db = ContentDb::open_in_memory().unwrap();
        let grace = song(&db, "Amazing Grace");
        let notice = slide(&db, "Harvest");
        let c = db.create_collection("Harvest").unwrap();
        db.add_to_collection(&c.id, "song", &grace).unwrap();
        db.add_to_collection(&c.id, "slide", &notice).unwrap();

        let revision = db.get_reusable_slide(&notice).unwrap().unwrap().revision;
        db.delete_reusable_slide(&notice, revision).unwrap();
        let got = db.get_collection(&c.id).unwrap().unwrap();
        assert_eq!(got.items[1].title, None, "a removed library item is listed as missing, not hidden");

        db.delete_collection(&c.id).unwrap();
        assert!(db.get_collection(&c.id).unwrap().is_none());
        assert!(db.get_song(&grace).unwrap().is_some(), "the song stays in the library");
        let orphans: i64 = db.lock().unwrap().query_row("SELECT COUNT(*) FROM library_collection_items", [], |r| r.get(0)).unwrap();
        assert_eq!(orphans, 0);
    }

    #[test]
    fn refuses_unknown_kinds_missing_items_blank_names_and_unknown_collections() {
        let db = ContentDb::open_in_memory().unwrap();
        let c = db.create_collection("Communion").unwrap();
        assert!(matches!(db.create_collection("   "), Err(ContentError::Invalid(_))));
        assert!(matches!(db.create_collection(&"x".repeat(121)), Err(ContentError::Invalid(_))));
        assert!(matches!(db.add_to_collection(&c.id, "program", "abc"), Err(ContentError::Invalid(_))));
        assert!(matches!(db.add_to_collection(&c.id, "song", "no-such-song"), Err(ContentError::NotFound(_))));
        assert!(matches!(db.add_to_collection(&c.id, "song", "bad id; drop"), Err(ContentError::Invalid(_))));
        assert!(matches!(db.add_to_collection("no-such-collection", "song", "abc"), Err(ContentError::NotFound(_))));
        assert!(matches!(db.rename_collection("no-such-collection", "x"), Err(ContentError::NotFound(_))));
        assert!(matches!(db.delete_collection("no-such-collection"), Err(ContentError::NotFound(_))));
    }
}
