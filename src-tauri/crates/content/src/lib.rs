//! Rhema Studio content database.
//!
//! One SQLite file (`studio.db`) in the app data directory holds user content:
//! services (programs), their ordered items, and an append-only audit trail.
//! The Bible text stays in the separate read-only Bible database; items refer
//! to it by book/chapter/verse.
//!
//! Migrations are embedded and applied in order inside a transaction each.
//! Never edit an applied migration; add a new one.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[non_exhaustive]
#[derive(Debug, Error)]
pub enum ContentError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid: {0}")]
    Invalid(String),
    #[error("lock poisoned")]
    Poisoned,
}

pub type Result<T> = std::result::Result<T, ContentError>;

const MIGRATIONS: &[(&str, &str)] = &[(
    "0001_programs",
    include_str!("../migrations/0001_programs.sql"),
)];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Program {
    pub id: String,
    pub title: String,
    pub service_date: Option<String>,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
    /// Number of items; filled by list/get so the UI can show it without a second query.
    pub item_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProgramItem {
    pub id: String,
    pub program_id: String,
    pub position: i64,
    pub kind: String,
    pub reference: String,
    pub book_number: Option<i64>,
    pub chapter: Option<i64>,
    pub verse: Option<i64>,
    pub notes: Option<String>,
}

/// An item as the frontend sends it; ids and positions are assigned on save.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NewProgramItem {
    #[serde(default = "default_kind")]
    pub kind: String,
    pub reference: String,
    pub book_number: Option<i64>,
    pub chapter: Option<i64>,
    pub verse: Option<i64>,
    pub notes: Option<String>,
}

fn default_kind() -> String {
    "verse".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProgramWithItems {
    pub program: Program,
    pub items: Vec<ProgramItem>,
}

pub struct ContentDb {
    conn: Mutex<Connection>,
}

impl std::fmt::Debug for ContentDb {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ContentDb").finish_non_exhaustive()
    }
}

impl ContentDb {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>> {
        self.conn.lock().map_err(|_| ContentError::Poisoned)
    }

    fn migrate(&self) -> Result<()> {
        let mut conn = self.lock()?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            )",
            [],
        )?;
        for (version, sql) in MIGRATIONS {
            let applied: Option<String> = conn
                .query_row(
                    "SELECT version FROM schema_migrations WHERE version = ?1",
                    params![version],
                    |r| r.get(0),
                )
                .optional()?;
            if applied.is_some() {
                continue;
            }
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.execute(
                "INSERT INTO schema_migrations (version) VALUES (?1)",
                params![version],
            )?;
            tx.commit()?;
            log::info!("[content] applied migration {version}");
        }
        Ok(())
    }

    /// Applied migration versions, oldest first.
    pub fn applied_migrations(&self) -> Result<Vec<String>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare("SELECT version FROM schema_migrations ORDER BY version")?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    // ── Programs ────────────────────────────────────────────────────────

    pub fn list_programs(&self) -> Result<Vec<Program>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT p.id, p.title, p.service_date, p.revision, p.created_at, p.updated_at,
                    (SELECT COUNT(*) FROM program_items i WHERE i.program_id = p.id)
             FROM programs p
             ORDER BY p.service_date IS NULL, p.service_date DESC, p.updated_at DESC",
        )?;
        let rows = stmt.query_map([], row_to_program)?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn create_program(&self, title: &str, service_date: Option<&str>) -> Result<Program> {
        let title = title.trim();
        if title.is_empty() {
            return Err(ContentError::Invalid("title is required".into()));
        }
        validate_date(service_date)?;
        let id = uuid::Uuid::new_v4().to_string();
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO programs (id, title, service_date) VALUES (?1, ?2, ?3)",
            params![id, title, service_date],
        )?;
        audit(&tx, "program", &id, "create", &serde_json::json!({ "title": title, "service_date": service_date }))?;
        tx.commit()?;
        drop(conn);
        self.get_program(&id)?
            .map(|p| p.program)
            .ok_or_else(|| ContentError::NotFound(id))
    }

    pub fn update_program(&self, id: &str, title: &str, service_date: Option<&str>) -> Result<Program> {
        let title = title.trim();
        if title.is_empty() {
            return Err(ContentError::Invalid("title is required".into()));
        }
        validate_date(service_date)?;
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let changed = tx.execute(
            "UPDATE programs SET title = ?2, service_date = ?3,
                    revision = revision + 1,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![id, title, service_date],
        )?;
        if changed == 0 {
            return Err(ContentError::NotFound(id.to_string()));
        }
        audit(&tx, "program", id, "update", &serde_json::json!({ "title": title, "service_date": service_date }))?;
        tx.commit()?;
        drop(conn);
        self.get_program(id)?
            .map(|p| p.program)
            .ok_or_else(|| ContentError::NotFound(id.to_string()))
    }

    pub fn get_program(&self, id: &str) -> Result<Option<ProgramWithItems>> {
        let conn = self.lock()?;
        let program = conn
            .query_row(
                "SELECT p.id, p.title, p.service_date, p.revision, p.created_at, p.updated_at,
                        (SELECT COUNT(*) FROM program_items i WHERE i.program_id = p.id)
                 FROM programs p WHERE p.id = ?1",
                params![id],
                row_to_program,
            )
            .optional()?;
        let Some(program) = program else {
            return Ok(None);
        };
        let mut stmt = conn.prepare(
            "SELECT id, program_id, position, kind, reference, book_number, chapter, verse, notes
             FROM program_items WHERE program_id = ?1 ORDER BY position",
        )?;
        let items = stmt
            .query_map(params![id], |r| {
                Ok(ProgramItem {
                    id: r.get(0)?,
                    program_id: r.get(1)?,
                    position: r.get(2)?,
                    kind: r.get(3)?,
                    reference: r.get(4)?,
                    book_number: r.get(5)?,
                    chapter: r.get(6)?,
                    verse: r.get(7)?,
                    notes: r.get(8)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(Some(ProgramWithItems { program, items }))
    }

    /// Replace every item of a program in one transaction and bump its revision.
    /// This is the whole-rundown save the Prepare workspace performs.
    pub fn replace_items(&self, program_id: &str, items: &[NewProgramItem]) -> Result<ProgramWithItems> {
        for (i, item) in items.iter().enumerate() {
            if item.reference.trim().is_empty() {
                return Err(ContentError::Invalid(format!("item {i} has no reference")));
            }
            if item.kind.trim().is_empty() {
                return Err(ContentError::Invalid(format!("item {i} has no kind")));
            }
        }
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let exists: Option<String> = tx
            .query_row("SELECT id FROM programs WHERE id = ?1", params![program_id], |r| r.get(0))
            .optional()?;
        if exists.is_none() {
            return Err(ContentError::NotFound(program_id.to_string()));
        }
        tx.execute("DELETE FROM program_items WHERE program_id = ?1", params![program_id])?;
        {
            let mut insert = tx.prepare(
                "INSERT INTO program_items
                 (id, program_id, position, kind, reference, book_number, chapter, verse, notes)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            )?;
            for (position, item) in items.iter().enumerate() {
                insert.execute(params![
                    uuid::Uuid::new_v4().to_string(),
                    program_id,
                    i64::try_from(position).map_err(|e| ContentError::Invalid(e.to_string()))?,
                    item.kind.trim(),
                    item.reference.trim(),
                    item.book_number,
                    item.chapter,
                    item.verse,
                    item.notes,
                ])?;
            }
        }
        tx.execute(
            "UPDATE programs SET revision = revision + 1,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![program_id],
        )?;
        audit(&tx, "program", program_id, "replace_items", &serde_json::json!({ "count": items.len() }))?;
        tx.commit()?;
        drop(conn);
        self.get_program(program_id)?
            .ok_or_else(|| ContentError::NotFound(program_id.to_string()))
    }

    pub fn delete_program(&self, id: &str) -> Result<()> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let changed = tx.execute("DELETE FROM programs WHERE id = ?1", params![id])?;
        if changed == 0 {
            return Err(ContentError::NotFound(id.to_string()));
        }
        audit(&tx, "program", id, "delete", &serde_json::Value::Null)?;
        tx.commit()?;
        Ok(())
    }

    /// Number of audit rows for an entity; used by tests and diagnostics.
    pub fn audit_count(&self, entity: &str, entity_id: &str) -> Result<i64> {
        let conn = self.lock()?;
        Ok(conn.query_row(
            "SELECT COUNT(*) FROM audit_events WHERE entity = ?1 AND entity_id = ?2",
            params![entity, entity_id],
            |r| r.get(0),
        )?)
    }
}

fn row_to_program(r: &rusqlite::Row<'_>) -> rusqlite::Result<Program> {
    Ok(Program {
        id: r.get(0)?,
        title: r.get(1)?,
        service_date: r.get(2)?,
        revision: r.get(3)?,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
        item_count: r.get(6)?,
    })
}

fn audit(tx: &Transaction<'_>, entity: &str, entity_id: &str, action: &str, payload: &serde_json::Value) -> Result<()> {
    tx.execute(
        "INSERT INTO audit_events (entity, entity_id, action, payload) VALUES (?1, ?2, ?3, ?4)",
        params![entity, entity_id, action, payload.to_string()],
    )?;
    Ok(())
}

/// Accept `YYYY-MM-DD` only; the UI uses a native date input which produces exactly that.
fn validate_date(date: Option<&str>) -> Result<()> {
    let Some(d) = date else { return Ok(()) };
    let ok = d.len() == 10
        && d.bytes().enumerate().all(|(i, b)| match i {
            4 | 7 => b == b'-',
            _ => b.is_ascii_digit(),
        });
    if ok {
        Ok(())
    } else {
        Err(ContentError::Invalid(format!("service_date must be YYYY-MM-DD, got {d:?}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn verse(reference: &str, b: i64, c: i64, v: i64) -> NewProgramItem {
        NewProgramItem {
            kind: "verse".into(),
            reference: reference.into(),
            book_number: Some(b),
            chapter: Some(c),
            verse: Some(v),
            notes: None,
        }
    }

    #[test]
    fn migrations_apply_once() {
        let db = ContentDb::open_in_memory().unwrap();
        assert_eq!(db.applied_migrations().unwrap(), vec!["0001_programs".to_string()]);
        db.migrate().unwrap();
        assert_eq!(db.applied_migrations().unwrap().len(), 1);
    }

    #[test]
    fn create_list_get() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Sunday", Some("2026-10-25")).unwrap();
        assert_eq!(p.revision, 1);
        assert_eq!(p.item_count, 0);
        let all = db.list_programs().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].title, "Sunday");
        let got = db.get_program(&p.id).unwrap().unwrap();
        assert!(got.items.is_empty());
        assert!(db.get_program("nope").unwrap().is_none());
    }

    #[test]
    fn replace_items_is_ordered_and_bumps_revision() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Sunday", None).unwrap();
        let saved = db
            .replace_items(&p.id, &[verse("Psalms 23:1", 19, 23, 1), verse("John 3:16", 43, 3, 16)])
            .unwrap();
        assert_eq!(saved.program.revision, 2);
        assert_eq!(saved.items.iter().map(|i| i.position).collect::<Vec<_>>(), vec![0, 1]);
        assert_eq!(saved.items[1].reference, "John 3:16");

        let again = db.replace_items(&p.id, &[verse("Romans 8:28", 45, 8, 28)]).unwrap();
        assert_eq!(again.program.revision, 3);
        assert_eq!(again.items.len(), 1);
        assert_eq!(again.program.item_count, 1);
        // create + 2 saves
        assert_eq!(db.audit_count("program", &p.id).unwrap(), 3);
    }

    #[test]
    fn validation_and_not_found() {
        let db = ContentDb::open_in_memory().unwrap();
        assert!(matches!(db.create_program("  ", None), Err(ContentError::Invalid(_))));
        assert!(matches!(db.create_program("x", Some("25/10/2026")), Err(ContentError::Invalid(_))));
        assert!(matches!(db.replace_items("missing", &[]), Err(ContentError::NotFound(_))));
        let p = db.create_program("x", None).unwrap();
        let bad = NewProgramItem { kind: "verse".into(), reference: " ".into(), book_number: None, chapter: None, verse: None, notes: None };
        assert!(matches!(db.replace_items(&p.id, &[bad]), Err(ContentError::Invalid(_))));
        // a failed save leaves the program untouched
        assert_eq!(db.get_program(&p.id).unwrap().unwrap().program.revision, 1);
    }

    #[test]
    fn delete_cascades_items() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("x", None).unwrap();
        db.replace_items(&p.id, &[verse("John 3:16", 43, 3, 16)]).unwrap();
        db.delete_program(&p.id).unwrap();
        assert!(db.get_program(&p.id).unwrap().is_none());
        assert!(db.list_programs().unwrap().is_empty());
        assert!(matches!(db.delete_program(&p.id), Err(ContentError::NotFound(_))));
    }

    #[test]
    fn list_orders_dated_first_then_newest() {
        let db = ContentDb::open_in_memory().unwrap();
        db.create_program("undated", None).unwrap();
        db.create_program("early", Some("2026-01-04")).unwrap();
        db.create_program("late", Some("2026-12-25")).unwrap();
        let titles: Vec<_> = db.list_programs().unwrap().into_iter().map(|p| p.title).collect();
        assert_eq!(titles, vec!["late", "early", "undated"]);
    }
}
