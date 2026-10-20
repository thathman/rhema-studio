//! Rhema Studio content database.
//!
//! One SQLite file (`studio.db`) in the app data directory holds user content:
//! services (programs), their ordered items, and an append-only audit trail.
//! The Bible text stays in the separate read-only Bible database; items refer
//! to it by canonical book number, chapter and verse plus a translation
//! abbreviation.
//!
//! Guarantees:
//! - Migrations are embedded, applied in order, each in its own transaction.
//!   A file-backed database with pending migrations is backed up first.
//! - Every mutation is transactional and recorded in `audit_events`.
//! - Writes that change a program take the caller's expected revision and
//!   fail with [`ContentError::Conflict`] instead of overwriting newer data.
//! - Item ids are stable across saves: unchanged and reordered items keep
//!   their id; only removed items disappear.
//! - A corrupt file fails to open rather than opening half-working.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
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
    #[error("conflict: expected revision {expected}, database has revision {actual}")]
    Conflict { expected: i64, actual: i64 },
    #[error("database integrity check failed: {0}")]
    Corrupt(String),
    #[error("lock poisoned")]
    Poisoned,
}

pub type Result<T> = std::result::Result<T, ContentError>;

pub type Migration = (&'static str, &'static str);

pub const MIGRATIONS: &[Migration] = &[
    ("0001_programs", include_str!("../migrations/0001_programs.sql")),
    ("0002_item_identity", include_str!("../migrations/0002_item_identity.sql")),
];

/// The only item kind this version can read and write. Future kinds arrive
/// with a migration and a renderer; until then they are rejected on write
/// and surfaced untouched on read.
pub const SUPPORTED_KINDS: &[&str] = &["verse"];

pub const MAX_TITLE: usize = 200;
pub const MAX_REFERENCE: usize = 200;
pub const MAX_NOTES: usize = 4000;
pub const MAX_ITEMS: usize = 2000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Program {
    pub id: String,
    pub title: String,
    pub service_date: Option<String>,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
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
    pub translation: Option<String>,
    pub secondary_translation: Option<String>,
    pub notes: Option<String>,
}

/// An item as the frontend sends it. `id` is kept when it names an existing
/// item of the same program (or is a fresh client-generated id); positions
/// come from array order.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ItemInput {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default = "default_kind")]
    pub kind: String,
    pub reference: String,
    #[serde(default)]
    pub book_number: Option<i64>,
    #[serde(default)]
    pub chapter: Option<i64>,
    #[serde(default)]
    pub verse: Option<i64>,
    #[serde(default)]
    pub translation: Option<String>,
    #[serde(default)]
    pub secondary_translation: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

fn default_kind() -> String {
    "verse".to_string()
}

impl Default for ItemInput {
    fn default() -> Self {
        Self {
            id: None,
            kind: default_kind(),
            reference: String::new(),
            book_number: None,
            chapter: None,
            verse: None,
            translation: None,
            secondary_translation: None,
            notes: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProgramWithItems {
    pub program: Program,
    pub items: Vec<ProgramItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuditEvent {
    pub id: i64,
    pub entity: String,
    pub entity_id: String,
    pub action: String,
    pub payload: Option<String>,
    pub actor: Option<String>,
    pub at: String,
}

pub struct ContentDb {
    conn: Mutex<Connection>,
    path: Option<PathBuf>,
    /// Backup written before the last migration run, if any.
    last_backup: Option<PathBuf>,
}

impl std::fmt::Debug for ContentDb {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ContentDb").field("path", &self.path).finish_non_exhaustive()
    }
}

impl ContentDb {
    pub fn open(path: &Path) -> Result<Self> {
        Self::open_with_migrations(path, MIGRATIONS)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?, None, MIGRATIONS)
    }

    /// Open with an explicit migration list. Tests use it to simulate an
    /// older database and then reopen with the full list.
    pub fn open_with_migrations(path: &Path, migrations: &[Migration]) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn, Some(path.to_path_buf()), migrations)
    }

    fn init(conn: Connection, path: Option<PathBuf>, migrations: &[Migration]) -> Result<Self> {
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;")?;
        let mut db = Self { conn: Mutex::new(conn), path, last_backup: None };
        db.check_integrity()?;
        db.migrate(migrations)?;
        Ok(db)
    }

    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    pub fn last_backup(&self) -> Option<&Path> {
        self.last_backup.as_deref()
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>> {
        self.conn.lock().map_err(|_| ContentError::Poisoned)
    }

    /// `PRAGMA quick_check` on open: a damaged file is refused, not half-used.
    fn check_integrity(&self) -> Result<()> {
        let conn = self.lock()?;
        let verdict: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        if verdict == "ok" {
            Ok(())
        } else {
            Err(ContentError::Corrupt(verdict))
        }
    }

    fn migrate(&mut self, migrations: &[Migration]) -> Result<()> {
        let pending: Vec<&Migration> = {
            let conn = self.lock()?;
            conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations (
                    version TEXT PRIMARY KEY,
                    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                )",
                [],
            )?;
            let applied: HashSet<String> = {
                let mut stmt = conn.prepare("SELECT version FROM schema_migrations")?;
                let rows = stmt.query_map([], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
                rows
            };
            migrations.iter().filter(|(v, _)| !applied.contains(*v)).collect()
        };
        if pending.is_empty() {
            return Ok(());
        }
        // An existing file that is about to change shape gets a backup first.
        let has_prior_schema = {
            let conn = self.lock()?;
            let n: i64 = conn.query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0))?;
            n > 0
        };
        if has_prior_schema {
            if let Some(path) = self.path.clone() {
                let backup = backup_path(&path, pending[0].0);
                self.backup_to(&backup)?;
                log::info!("[content] backed up {} to {} before migrating", path.display(), backup.display());
                self.last_backup = Some(backup);
            }
        }
        let mut conn = self.lock()?;
        for (version, sql) in pending {
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.execute("INSERT INTO schema_migrations (version) VALUES (?1)", params![version])?;
            tx.commit()?;
            log::info!("[content] applied migration {version}");
        }
        Ok(())
    }

    /// Copy the whole database to `dest` using SQLite's online backup API
    /// (safe while open, consistent with WAL).
    pub fn backup_to(&self, dest: &Path) -> Result<()> {
        let conn = self.lock()?;
        let mut out = Connection::open(dest)?;
        let backup = rusqlite::backup::Backup::new(&conn, &mut out)?;
        backup.run_to_completion(256, std::time::Duration::from_millis(5), None)?;
        Ok(())
    }

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
        let title = validate_title(title)?;
        validate_date(service_date)?;
        let id = new_id();
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO programs (id, title, service_date) VALUES (?1, ?2, ?3)",
            params![id, title, service_date],
        )?;
        audit(&tx, "program", &id, "create", &serde_json::json!({ "title": title, "service_date": service_date }))?;
        let program = load_program(&tx, &id)?.ok_or_else(|| ContentError::NotFound(id.clone()))?;
        tx.commit()?;
        Ok(program)
    }

    /// Rename / redate. `expected_revision` must match or the call conflicts.
    pub fn update_program(
        &self,
        id: &str,
        expected_revision: i64,
        title: &str,
        service_date: Option<&str>,
    ) -> Result<Program> {
        let title = validate_title(title)?;
        validate_date(service_date)?;
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        check_revision(&tx, id, expected_revision)?;
        tx.execute(
            "UPDATE programs SET title = ?2, service_date = ?3,
                    revision = revision + 1,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![id, title, service_date],
        )?;
        audit(&tx, "program", id, "update", &serde_json::json!({ "title": title, "service_date": service_date }))?;
        let program = load_program(&tx, id)?.ok_or_else(|| ContentError::NotFound(id.to_string()))?;
        tx.commit()?;
        Ok(program)
    }

    pub fn get_program(&self, id: &str) -> Result<Option<ProgramWithItems>> {
        let conn = self.lock()?;
        let Some(program) = load_program(&conn, id)? else {
            return Ok(None);
        };
        let items = load_items(&conn, id)?;
        Ok(Some(ProgramWithItems { program, items }))
    }

    /// Save the whole rundown. Item ids are preserved where the input names an
    /// existing item of this program; new items get a fresh (or the supplied)
    /// id; items missing from the input are deleted. Positions follow input
    /// order. The program revision is bumped once.
    pub fn replace_items(
        &self,
        program_id: &str,
        expected_revision: i64,
        items: &[ItemInput],
    ) -> Result<ProgramWithItems> {
        validate_items(items)?;
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        check_revision(&tx, program_id, expected_revision)?;

        let existing: HashSet<String> = {
            let mut stmt = tx.prepare("SELECT id FROM program_items WHERE program_id = ?1")?;
            let rows = stmt
                .query_map(params![program_id], |r| r.get(0))?
                .collect::<std::result::Result<_, _>>()?;
            rows
        };
        let incoming_ids: Vec<String> = items
            .iter()
            .map(|it| match &it.id {
                Some(id) if is_valid_id(id) => id.clone(),
                _ => new_id(),
            })
            .collect();

        // Free every position first so reordering cannot trip the
        // UNIQUE(program_id, position) constraint mid-update.
        tx.execute(
            "UPDATE program_items SET position = -(position + 1) WHERE program_id = ?1",
            params![program_id],
        )?;

        let mut added = 0usize;
        let mut kept = 0usize;
        {
            let mut update = tx.prepare(
                "UPDATE program_items SET position = ?3, kind = ?4, reference = ?5, book_number = ?6,
                        chapter = ?7, verse = ?8, translation = ?9, secondary_translation = ?10, notes = ?11
                 WHERE id = ?1 AND program_id = ?2",
            )?;
            let mut insert = tx.prepare(
                "INSERT INTO program_items
                 (id, program_id, position, kind, reference, book_number, chapter, verse,
                  translation, secondary_translation, notes)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            )?;
            for (position, (item, id)) in items.iter().zip(&incoming_ids).enumerate() {
                let position = i64::try_from(position).map_err(|e| ContentError::Invalid(e.to_string()))?;
                let args = params![
                    id,
                    program_id,
                    position,
                    item.kind.trim(),
                    item.reference.trim(),
                    item.book_number,
                    item.chapter,
                    item.verse,
                    item.translation.as_deref().map(str::trim),
                    item.secondary_translation.as_deref().map(str::trim),
                    item.notes.as_deref(),
                ];
                if existing.contains(id) {
                    update.execute(args)?;
                    kept += 1;
                } else {
                    insert.execute(args)?;
                    added += 1;
                }
            }
        }
        // Anything still at a negative position was not in the input.
        let removed = tx.execute(
            "DELETE FROM program_items WHERE program_id = ?1 AND position < 0",
            params![program_id],
        )?;

        tx.execute(
            "UPDATE programs SET revision = revision + 1,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![program_id],
        )?;
        audit(
            &tx,
            "program",
            program_id,
            "replace_items",
            &serde_json::json!({ "count": items.len(), "kept": kept, "added": added, "removed": removed }),
        )?;
        let program = load_program(&tx, program_id)?.ok_or_else(|| ContentError::NotFound(program_id.to_string()))?;
        let items = load_items(&tx, program_id)?;
        tx.commit()?;
        Ok(ProgramWithItems { program, items })
    }

    pub fn delete_program(&self, id: &str, expected_revision: i64) -> Result<()> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        check_revision(&tx, id, expected_revision)?;
        tx.execute("DELETE FROM programs WHERE id = ?1", params![id])?;
        audit(&tx, "program", id, "delete", &serde_json::Value::Null)?;
        tx.commit()?;
        Ok(())
    }

    pub fn audit_events(&self, entity: &str, entity_id: &str) -> Result<Vec<AuditEvent>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT id, entity, entity_id, action, payload, actor, at
             FROM audit_events WHERE entity = ?1 AND entity_id = ?2 ORDER BY id",
        )?;
        let rows = stmt.query_map(params![entity, entity_id], |r| {
            Ok(AuditEvent {
                id: r.get(0)?,
                entity: r.get(1)?,
                entity_id: r.get(2)?,
                action: r.get(3)?,
                payload: r.get(4)?,
                actor: r.get(5)?,
                at: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }
}

// ── helpers ─────────────────────────────────────────────────────────────

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Client ids are accepted when they look like ids, not free text.
fn is_valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn backup_path(path: &Path, version: &str) -> PathBuf {
    let name = path
        .file_name()
        .map_or_else(|| "studio.db".to_string(), |n| n.to_string_lossy().into_owned());
    path.with_file_name(format!("{name}.before-{version}.bak"))
}

fn load_program(conn: &Connection, id: &str) -> Result<Option<Program>> {
    Ok(conn
        .query_row(
            "SELECT p.id, p.title, p.service_date, p.revision, p.created_at, p.updated_at,
                    (SELECT COUNT(*) FROM program_items i WHERE i.program_id = p.id)
             FROM programs p WHERE p.id = ?1",
            params![id],
            row_to_program,
        )
        .optional()?)
}

fn load_items(conn: &Connection, program_id: &str) -> Result<Vec<ProgramItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, program_id, position, kind, reference, book_number, chapter, verse,
                translation, secondary_translation, notes
         FROM program_items WHERE program_id = ?1 ORDER BY position",
    )?;
    let rows = stmt.query_map(params![program_id], |r| {
        Ok(ProgramItem {
            id: r.get(0)?,
            program_id: r.get(1)?,
            position: r.get(2)?,
            kind: r.get(3)?,
            reference: r.get(4)?,
            book_number: r.get(5)?,
            chapter: r.get(6)?,
            verse: r.get(7)?,
            translation: r.get(8)?,
            secondary_translation: r.get(9)?,
            notes: r.get(10)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
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

fn check_revision(tx: &Transaction<'_>, program_id: &str, expected: i64) -> Result<()> {
    let actual: Option<i64> = tx
        .query_row("SELECT revision FROM programs WHERE id = ?1", params![program_id], |r| r.get(0))
        .optional()?;
    match actual {
        None => Err(ContentError::NotFound(program_id.to_string())),
        Some(actual) if actual != expected => Err(ContentError::Conflict { expected, actual }),
        Some(_) => Ok(()),
    }
}

fn audit(tx: &Transaction<'_>, entity: &str, entity_id: &str, action: &str, payload: &serde_json::Value) -> Result<()> {
    // `actor` (added in 0002) stays NULL until there is a real user model, so
    // the insert names only the columns every schema version has.
    tx.execute(
        "INSERT INTO audit_events (entity, entity_id, action, payload) VALUES (?1, ?2, ?3, ?4)",
        params![entity, entity_id, action, payload.to_string()],
    )?;
    Ok(())
}

fn validate_title(title: &str) -> Result<&str> {
    let t = title.trim();
    if t.is_empty() {
        return Err(ContentError::Invalid("title is required".into()));
    }
    if t.chars().count() > MAX_TITLE {
        return Err(ContentError::Invalid(format!("title longer than {MAX_TITLE} characters")));
    }
    Ok(t)
}

/// `YYYY-MM-DD`, and a real calendar date.
pub fn validate_date(date: Option<&str>) -> Result<()> {
    let Some(d) = date else { return Ok(()) };
    let bad = || ContentError::Invalid(format!("service_date must be a real YYYY-MM-DD date, got {d:?}"));
    let b = d.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return Err(bad());
    }
    let num = |s: &str| s.parse::<u32>().map_err(|_| bad());
    let (y, m, day) = (num(&d[0..4])?, num(&d[5..7])?, num(&d[8..10])?);
    if !(1..=12).contains(&m) || !(1900..=2200).contains(&y) {
        return Err(bad());
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let max = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => if leap { 29 } else { 28 },
    };
    if day == 0 || day > max {
        return Err(bad());
    }
    Ok(())
}

fn validate_items(items: &[ItemInput]) -> Result<()> {
    if items.len() > MAX_ITEMS {
        return Err(ContentError::Invalid(format!("more than {MAX_ITEMS} items")));
    }
    let mut seen = HashSet::new();
    for (i, it) in items.iter().enumerate() {
        let kind = it.kind.trim();
        if !SUPPORTED_KINDS.contains(&kind) {
            return Err(ContentError::Invalid(format!("item {i}: unsupported kind {kind:?}")));
        }
        let reference = it.reference.trim();
        if reference.is_empty() {
            return Err(ContentError::Invalid(format!("item {i} has no reference")));
        }
        if reference.chars().count() > MAX_REFERENCE {
            return Err(ContentError::Invalid(format!("item {i}: reference longer than {MAX_REFERENCE} characters")));
        }
        if it.notes.as_deref().is_some_and(|n| n.chars().count() > MAX_NOTES) {
            return Err(ContentError::Invalid(format!("item {i}: notes longer than {MAX_NOTES} characters")));
        }
        if kind == "verse" {
            let in_range = |v: Option<i64>, lo: i64, hi: i64| v.is_some_and(|n| (lo..=hi).contains(&n));
            if !in_range(it.book_number, 1, 99) || !in_range(it.chapter, 1, 200) || !in_range(it.verse, 1, 200) {
                return Err(ContentError::Invalid(format!("item {i}: verse items need book, chapter and verse")));
            }
        }
        for t in [&it.translation, &it.secondary_translation].into_iter().flatten() {
            let t = t.trim();
            if t.is_empty() || t.len() > 32 || !t.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                return Err(ContentError::Invalid(format!("item {i}: invalid translation code {t:?}")));
            }
        }
        if let Some(id) = &it.id {
            if !is_valid_id(id) {
                return Err(ContentError::Invalid(format!("item {i}: invalid id {id:?}")));
            }
            if !seen.insert(id.clone()) {
                return Err(ContentError::Invalid(format!("item {i}: duplicate id {id:?}")));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn verse(reference: &str, b: i64, c: i64, v: i64) -> ItemInput {
        ItemInput {
            reference: reference.into(),
            book_number: Some(b),
            chapter: Some(c),
            verse: Some(v),
            ..ItemInput::default()
        }
    }

    fn with_id(mut it: ItemInput, id: &str) -> ItemInput {
        it.id = Some(id.into());
        it
    }

    /// A fresh temp directory per test; removed on drop.
    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("rhema-content-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn db(&self) -> PathBuf {
            self.0.join("studio.db")
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    // ── in-memory: logic ────────────────────────────────────────────────

    #[test]
    fn migrations_apply_once_and_in_order() {
        let db = ContentDb::open_in_memory().unwrap();
        assert_eq!(db.applied_migrations().unwrap(), vec!["0001_programs", "0002_item_identity"]);
    }

    #[test]
    fn create_list_get() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Sunday", Some("2026-10-25")).unwrap();
        assert_eq!((p.revision, p.item_count), (1, 0));
        assert_eq!(db.list_programs().unwrap()[0].title, "Sunday");
        assert_eq!(db.get_program(&p.id).unwrap().unwrap().items.len(), 0);
        assert!(db.get_program("nope").unwrap().is_none());
    }

    #[test]
    fn replace_items_orders_bumps_revision_and_audits() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Sunday", None).unwrap();
        let saved = db.replace_items(&p.id, 1, &[verse("Psalms 23:1", 19, 23, 1), verse("John 3:16", 43, 3, 16)]).unwrap();
        assert_eq!(saved.program.revision, 2);
        assert_eq!(saved.items.iter().map(|i| i.position).collect::<Vec<_>>(), vec![0, 1]);
        let again = db.replace_items(&p.id, 2, &[verse("Romans 8:28", 45, 8, 28)]).unwrap();
        assert_eq!((again.program.revision, again.items.len(), again.program.item_count), (3, 1, 1));
        let events = db.audit_events("program", &p.id).unwrap();
        assert_eq!(events.iter().map(|e| e.action.as_str()).collect::<Vec<_>>(), vec!["create", "replace_items", "replace_items"]);
        assert!(events.iter().all(|e| e.actor.is_none()));
        assert!(events[2].payload.as_deref().unwrap().contains("\"removed\":2"));
    }

    #[test]
    fn stale_revision_conflicts_and_changes_nothing() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Sunday", None).unwrap();
        db.replace_items(&p.id, 1, &[verse("John 3:16", 43, 3, 16)]).unwrap(); // now revision 2
        let err = db.replace_items(&p.id, 1, &[verse("Romans 8:28", 45, 8, 28)]).unwrap_err();
        assert!(matches!(err, ContentError::Conflict { expected: 1, actual: 2 }));
        let got = db.get_program(&p.id).unwrap().unwrap();
        assert_eq!(got.program.revision, 2);
        assert_eq!(got.items[0].reference, "John 3:16");
        assert!(matches!(db.update_program(&p.id, 1, "x", None).unwrap_err(), ContentError::Conflict { .. }));
        assert!(matches!(db.delete_program(&p.id, 1).unwrap_err(), ContentError::Conflict { .. }));
        assert!(db.get_program(&p.id).unwrap().is_some());
    }

    #[test]
    fn item_ids_are_stable_across_reorder_and_edit() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Sunday", None).unwrap();
        let first = db
            .replace_items(&p.id, 1, &[with_id(verse("A 1:1", 1, 1, 1), "client-a"), verse("B 2:2", 2, 2, 2), verse("C 3:3", 3, 3, 3)])
            .unwrap();
        let ids: Vec<String> = first.items.iter().map(|i| i.id.clone()).collect();
        assert_eq!(ids[0], "client-a");

        // Reorder C, A, B and edit A's notes; drop nothing.
        let reordered = db
            .replace_items(
                &p.id,
                2,
                &[
                    with_id(verse("C 3:3", 3, 3, 3), &ids[2]),
                    with_id(ItemInput { notes: Some("intro".into()), ..verse("A 1:1", 1, 1, 1) }, &ids[0]),
                    with_id(verse("B 2:2", 2, 2, 2), &ids[1]),
                ],
            )
            .unwrap();
        let new_ids: Vec<String> = reordered.items.iter().map(|i| i.id.clone()).collect();
        assert_eq!(new_ids, vec![ids[2].clone(), ids[0].clone(), ids[1].clone()]);
        assert_eq!(reordered.items[1].notes.as_deref(), Some("intro"));
        assert_eq!(reordered.items.iter().map(|i| i.position).collect::<Vec<_>>(), vec![0, 1, 2]);

        // Remove B, add D: A and C keep ids, D is new.
        let pruned = db
            .replace_items(&p.id, 3, &[with_id(verse("A 1:1", 1, 1, 1), &ids[0]), with_id(verse("C 3:3", 3, 3, 3), &ids[2]), verse("D 4:4", 4, 4, 4)])
            .unwrap();
        assert_eq!(pruned.items[0].id, ids[0]);
        assert_eq!(pruned.items[1].id, ids[2]);
        assert!(!ids.contains(&pruned.items[2].id));
        // An id from another program is never adopted silently.
        let other = db.create_program("Other", None).unwrap();
        let cross = db.replace_items(&other.id, 1, &[with_id(verse("A 1:1", 1, 1, 1), &ids[0])]).unwrap_err();
        assert!(matches!(cross, ContentError::Database(_)), "duplicate primary key must be rejected, got {cross:?}");
        assert_eq!(db.get_program(&p.id).unwrap().unwrap().items.len(), 3);
    }

    #[test]
    fn validation() {
        let db = ContentDb::open_in_memory().unwrap();
        assert!(matches!(db.create_program("  ", None), Err(ContentError::Invalid(_))));
        assert!(matches!(db.create_program(&"x".repeat(201), None), Err(ContentError::Invalid(_))));
        for bad in ["25/10/2026", "2026-13-01", "2026-02-30", "2027-02-29", "2026-04-31", "abcd-ef-gh"] {
            assert!(matches!(db.create_program("x", Some(bad)), Err(ContentError::Invalid(_))), "{bad}");
        }
        assert!(db.create_program("x", Some("2028-02-29")).is_ok()); // leap year
        let p = db.create_program("p", None).unwrap();
        let invalid = [
            ItemInput { reference: " ".into(), ..verse("", 1, 1, 1) },
            ItemInput { kind: "song".into(), ..verse("Song", 1, 1, 1) },
            ItemInput { book_number: None, ..verse("John 3:16", 43, 3, 16) },
            ItemInput { verse: Some(0), ..verse("John 3:0", 43, 3, 16) },
            ItemInput { translation: Some("K J V".into()), ..verse("John 3:16", 43, 3, 16) },
            ItemInput { id: Some("../x".into()), ..verse("John 3:16", 43, 3, 16) },
            ItemInput { notes: Some("n".repeat(4001)), ..verse("John 3:16", 43, 3, 16) },
        ];
        for it in invalid {
            assert!(matches!(db.replace_items(&p.id, 1, std::slice::from_ref(&it)), Err(ContentError::Invalid(_))), "{it:?}");
        }
        let dup = [with_id(verse("A 1:1", 1, 1, 1), "same"), with_id(verse("B 1:1", 1, 1, 1), "same")];
        assert!(matches!(db.replace_items(&p.id, 1, &dup), Err(ContentError::Invalid(_))));
        assert_eq!(db.get_program(&p.id).unwrap().unwrap().program.revision, 1);
        assert!(matches!(db.replace_items("missing", 1, &[]), Err(ContentError::NotFound(_))));
    }

    #[test]
    fn translation_identity_is_stored() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("p", None).unwrap();
        let it = ItemInput { translation: Some("KJV".into()), secondary_translation: Some("OYCB".into()), ..verse("John 3:16", 43, 3, 16) };
        let saved = db.replace_items(&p.id, 1, &[it]).unwrap();
        assert_eq!(saved.items[0].translation.as_deref(), Some("KJV"));
        assert_eq!(saved.items[0].secondary_translation.as_deref(), Some("OYCB"));
    }

    #[test]
    fn delete_cascades_items() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("x", None).unwrap();
        db.replace_items(&p.id, 1, &[verse("John 3:16", 43, 3, 16)]).unwrap();
        db.delete_program(&p.id, 2).unwrap();
        assert!(db.get_program(&p.id).unwrap().is_none());
        assert!(matches!(db.delete_program(&p.id, 2), Err(ContentError::NotFound(_))));
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

    // ── on disk: persistence, migration, recovery ──────────────────────

    #[test]
    fn file_survives_close_and_reopen() {
        let tmp = TempDir::new();
        let id = {
            let db = ContentDb::open(&tmp.db()).unwrap();
            let p = db.create_program("Sunday", Some("2026-10-25")).unwrap();
            db.replace_items(&p.id, 1, &[verse("John 3:16", 43, 3, 16), verse("Psalms 23:1", 19, 23, 1)]).unwrap();
            p.id
        };
        let db = ContentDb::open(&tmp.db()).unwrap();
        let got = db.get_program(&id).unwrap().unwrap();
        assert_eq!(got.program.revision, 2);
        assert_eq!(got.items.iter().map(|i| i.reference.as_str()).collect::<Vec<_>>(), vec!["John 3:16", "Psalms 23:1"]);
        assert_eq!(db.applied_migrations().unwrap().len(), MIGRATIONS.len());
        assert!(db.last_backup().is_none(), "no pending migrations, so no backup");
        assert_eq!(db.audit_events("program", &id).unwrap().len(), 2);
    }

    #[test]
    fn older_file_is_backed_up_then_migrated() {
        let tmp = TempDir::new();
        let id = {
            let db = ContentDb::open_with_migrations(&tmp.db(), &MIGRATIONS[..1]).unwrap();
            assert_eq!(db.applied_migrations().unwrap(), vec!["0001_programs"]);
            // 0001 schema has no translation column: insert through SQL the old way.
            let p = db.create_program("Old", None).unwrap();
            p.id
        };
        let db = ContentDb::open(&tmp.db()).unwrap();
        assert_eq!(db.applied_migrations().unwrap(), vec!["0001_programs", "0002_item_identity"]);
        let backup = db.last_backup().expect("backup before migrating an existing file").to_path_buf();
        assert!(backup.exists());
        assert!(backup.to_string_lossy().contains("before-0002_item_identity"));
        // The backup is a valid pre-migration database with the data.
        let old = Connection::open(&backup).unwrap();
        let n: i64 = old.query_row("SELECT COUNT(*) FROM programs WHERE id = ?1", params![id], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        let cols: i64 = old.query_row("SELECT COUNT(*) FROM pragma_table_info('program_items') WHERE name = 'translation'", [], |r| r.get(0)).unwrap();
        assert_eq!(cols, 0);
        // And the live database now accepts translation identity.
        let saved = db.replace_items(&id, 1, &[ItemInput { translation: Some("OYCB".into()), ..verse("Johanu 3:16", 43, 3, 16) }]).unwrap();
        assert_eq!(saved.items[0].translation.as_deref(), Some("OYCB"));
        // Reopening again does not back up again.
        drop(db);
        let db = ContentDb::open(&tmp.db()).unwrap();
        assert!(db.last_backup().is_none());
    }

    #[test]
    fn failed_save_leaves_file_unchanged_after_reopen() {
        let tmp = TempDir::new();
        let id = {
            let db = ContentDb::open(&tmp.db()).unwrap();
            let p = db.create_program("Sunday", None).unwrap();
            db.replace_items(&p.id, 1, &[verse("John 3:16", 43, 3, 16)]).unwrap();
            // Second item invalid: whole save must roll back.
            let err = db.replace_items(&p.id, 2, &[verse("Romans 8:28", 45, 8, 28), ItemInput { book_number: None, ..verse("x", 1, 1, 1) }]).unwrap_err();
            assert!(matches!(err, ContentError::Invalid(_)));
            // Stale revision too.
            assert!(matches!(db.replace_items(&p.id, 1, &[verse("Romans 8:28", 45, 8, 28)]), Err(ContentError::Conflict { .. })));
            p.id
        };
        let db = ContentDb::open(&tmp.db()).unwrap();
        let got = db.get_program(&id).unwrap().unwrap();
        assert_eq!(got.program.revision, 2);
        assert_eq!(got.items.len(), 1);
        assert_eq!(got.items[0].reference, "John 3:16");
    }

    #[test]
    fn two_handles_on_one_file_see_each_others_commits_and_conflict() {
        let tmp = TempDir::new();
        let a = ContentDb::open(&tmp.db()).unwrap();
        let b = ContentDb::open(&tmp.db()).unwrap();
        let p = a.create_program("Shared", None).unwrap();
        b.replace_items(&p.id, 1, &[verse("John 3:16", 43, 3, 16)]).unwrap();
        // `a` still believes revision 1: it must not overwrite b's save.
        assert!(matches!(a.replace_items(&p.id, 1, &[verse("Romans 8:28", 45, 8, 28)]), Err(ContentError::Conflict { expected: 1, actual: 2 })));
        assert_eq!(a.get_program(&p.id).unwrap().unwrap().items[0].reference, "John 3:16");
    }

    #[test]
    fn corrupt_file_is_refused() {
        let tmp = TempDir::new();
        {
            let db = ContentDb::open(&tmp.db()).unwrap();
            db.create_program("x", None).unwrap();
        }
        // Overwrite the body with garbage but keep the SQLite header so it is
        // recognised as a database and fails quick_check (or fails to read).
        let mut bytes = std::fs::read(tmp.db()).unwrap();
        for b in bytes.iter_mut().skip(100) {
            *b = 0xFF;
        }
        std::fs::write(tmp.db(), bytes).unwrap();
        let _ = std::fs::remove_file(tmp.0.join("studio.db-wal"));
        let err = ContentDb::open(&tmp.db()).unwrap_err();
        assert!(matches!(err, ContentError::Corrupt(_) | ContentError::Database(_)), "{err:?}");
    }

    #[test]
    fn manual_backup_is_a_complete_copy() {
        let tmp = TempDir::new();
        let db = ContentDb::open(&tmp.db()).unwrap();
        let p = db.create_program("Sunday", None).unwrap();
        db.replace_items(&p.id, 1, &[verse("John 3:16", 43, 3, 16)]).unwrap();
        let dest = tmp.0.join("copy.db");
        db.backup_to(&dest).unwrap();
        let copy = ContentDb::open(&dest).unwrap();
        assert_eq!(copy.get_program(&p.id).unwrap().unwrap().items.len(), 1);
    }
}
