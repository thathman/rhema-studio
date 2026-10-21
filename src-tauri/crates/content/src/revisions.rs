//! Service history (migration 0005): one snapshot per save, restorable.

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::{audit, load_items, load_program, new_id, ContentDb, ContentError, ItemInput, ProgramItem, ProgramWithItems, Result};

/// Snapshots kept per service; older ones are dropped on the next save.
pub const KEEP_REVISIONS: i64 = 50;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RevisionSummary {
    pub id: String,
    pub program_id: String,
    pub revision: i64,
    pub title: String,
    pub service_date: Option<String>,
    pub item_count: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Revision {
    #[serde(flatten)]
    pub summary: RevisionSummary,
    pub items: Vec<ItemInput>,
}

fn snapshot_item(it: &ProgramItem) -> ItemInput {
    ItemInput {
        id: Some(it.id.clone()),
        kind: it.kind.clone(),
        reference: it.reference.clone(),
        book_number: it.book_number,
        chapter: it.chapter,
        verse: it.verse,
        translation: it.translation.clone(),
        secondary_translation: it.secondary_translation.clone(),
        notes: it.notes.clone(),
        payload: it.payload.clone(),
    }
}

/// Record the program's current state as a revision. Called inside the
/// transaction of every write that changes a program.
pub(crate) fn snapshot(tx: &Transaction<'_>, program_id: &str) -> Result<()> {
    // Tests open databases at older schema versions; before 0005 there is nothing to write to.
    let has_table: i64 = tx.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'program_revisions'", [], |r| r.get(0))?;
    if has_table == 0 {
        return Ok(());
    }
    let Some(program) = load_program(tx, program_id)? else { return Ok(()) };
    let items: Vec<ItemInput> = load_items(tx, program_id)?.iter().map(snapshot_item).collect();
    let json = serde_json::to_string(&items).map_err(|e| ContentError::Invalid(e.to_string()))?;
    tx.execute(
        "INSERT OR REPLACE INTO program_revisions (id, program_id, revision, title, service_date, items, item_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![new_id(), program_id, program.revision, program.title, program.service_date, json, i64::try_from(items.len()).unwrap_or(i64::MAX)],
    )?;
    // The approved snapshot (0007) is never pruned; older files have no such column.
    let keep_approved = if crate::has_approval_column(tx) { "AND revision != COALESCE((SELECT approved_revision FROM programs WHERE id = ?1), -1)" } else { "" };
    tx.execute(
        &format!(
            "DELETE FROM program_revisions WHERE program_id = ?1 AND revision <= (
            SELECT revision FROM program_revisions WHERE program_id = ?1 ORDER BY revision DESC LIMIT 1 OFFSET ?2) {keep_approved}"
        ),
        params![program_id, KEEP_REVISIONS],
    )?;
    Ok(())
}

const COLS: &str = "id, program_id, revision, title, service_date, item_count, created_at";

fn row_to_summary(r: &rusqlite::Row<'_>) -> rusqlite::Result<RevisionSummary> {
    Ok(RevisionSummary {
        id: r.get(0)?,
        program_id: r.get(1)?,
        revision: r.get(2)?,
        title: r.get(3)?,
        service_date: r.get(4)?,
        item_count: r.get(5)?,
        created_at: r.get(6)?,
    })
}

fn load_revision(conn: &Connection, id: &str) -> Result<Option<Revision>> {
    let row: Option<(RevisionSummary, String)> = conn
        .query_row(&format!("SELECT {COLS}, items FROM program_revisions WHERE id = ?1"), params![id], |r| {
            Ok((row_to_summary(r)?, r.get::<_, String>(7)?))
        })
        .optional()?;
    match row {
        None => Ok(None),
        Some((summary, json)) => {
            let items: Vec<ItemInput> = serde_json::from_str(&json).map_err(|e| ContentError::Corrupt(format!("revision {id}: {e}")))?;
            Ok(Some(Revision { summary, items }))
        }
    }
}

impl ContentDb {
    /// Newest first.
    pub fn list_revisions(&self, program_id: &str) -> Result<Vec<RevisionSummary>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(&format!("SELECT {COLS} FROM program_revisions WHERE program_id = ?1 ORDER BY revision DESC"))?;
        let rows = stmt.query_map(params![program_id], row_to_summary)?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn get_revision(&self, id: &str) -> Result<Option<Revision>> {
        let conn = self.lock()?;
        load_revision(&conn, id)
    }

    /// Put a snapshot's items back as the service's current items. This is a
    /// normal save: it needs the current revision, bumps it, and is itself
    /// snapshotted, so the state before the restore stays in the history.
    /// Mark the current revision as the one approved for the service. Its
    /// snapshot is kept however many saves follow; a later save does not
    /// clear the approval, it just makes the service "changed since approval".
    pub fn approve_program(&self, program_id: &str, expected_revision: i64) -> Result<crate::Program> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        crate::check_revision(&tx, program_id, expected_revision)?;
        let has_snapshot: i64 = tx.query_row(
            "SELECT COUNT(*) FROM program_revisions WHERE program_id = ?1 AND revision = ?2",
            params![program_id, expected_revision],
            |r| r.get(0),
        )?;
        if has_snapshot == 0 {
            snapshot(&tx, program_id)?;
        }
        tx.execute(
            "UPDATE programs SET approved_revision = ?2, approved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
            params![program_id, expected_revision],
        )?;
        if crate::has_archive_column(&tx) {
            tx.execute("UPDATE programs SET approved_by = ?2 WHERE id = ?1", params![program_id, crate::actor()])?;
        }
        audit(&tx, "program", program_id, "approve", &serde_json::json!({ "revision": expected_revision }))?;
        let program = load_program(&tx, program_id)?.ok_or_else(|| ContentError::NotFound(program_id.into()))?;
        tx.commit()?;
        Ok(program)
    }

    pub fn restore_revision(&self, program_id: &str, expected_revision: i64, revision_id: &str) -> Result<ProgramWithItems> {
        let revision = {
            let conn = self.lock()?;
            load_revision(&conn, revision_id)?.ok_or_else(|| ContentError::NotFound(revision_id.to_string()))?
        };
        if revision.summary.program_id != program_id {
            return Err(ContentError::Invalid("that revision belongs to another service".into()));
        }
        let restored = self.replace_items(program_id, expected_revision, &revision.items)?;
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        audit(&tx, "program", program_id, "restore_revision", &serde_json::json!({ "from_revision": revision.summary.revision }))?;
        tx.commit()?;
        Ok(restored)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn verse(reference: &str, b: i64, c: i64, v: i64) -> ItemInput {
        ItemInput { reference: reference.into(), book_number: Some(b), chapter: Some(c), verse: Some(v), ..ItemInput::default() }
    }

    #[test]
    fn every_save_is_a_revision_and_restore_brings_items_back() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Sunday", Some("2026-10-25")).unwrap();
        db.replace_items(&p.id, 1, &[verse("John 3:16", 43, 3, 16), verse("Psalms 23:1", 19, 23, 1)]).unwrap(); // rev 2
        db.replace_items(&p.id, 2, &[verse("Romans 8:28", 45, 8, 28)]).unwrap(); // rev 3
        db.update_program(&p.id, 3, "Sunday evening", None).unwrap(); // rev 4
        let revs = db.list_revisions(&p.id).unwrap();
        assert_eq!(revs.iter().map(|r| (r.revision, r.item_count)).collect::<Vec<_>>(), vec![(4, 1), (3, 1), (2, 2), (1, 0)]);
        assert_eq!(revs[0].title, "Sunday evening");
        let two = db.get_revision(&revs[2].id).unwrap().unwrap();
        assert_eq!(two.items.iter().map(|i| i.reference.as_str()).collect::<Vec<_>>(), vec!["John 3:16", "Psalms 23:1"]);

        let restored = db.restore_revision(&p.id, 4, &revs[2].id).unwrap();
        assert_eq!(restored.program.revision, 5);
        assert_eq!(restored.items.iter().map(|i| i.reference.as_str()).collect::<Vec<_>>(), vec!["John 3:16", "Psalms 23:1"]);
        assert_eq!(restored.items[0].id, two.items[0].id.clone().unwrap(), "ids come back with the snapshot");
        assert_eq!(db.list_revisions(&p.id).unwrap()[0].revision, 5, "the restore is itself a revision");
        assert!(matches!(db.restore_revision(&p.id, 4, &revs[2].id), Err(ContentError::Conflict { .. })));
        let other = db.create_program("Other", None).unwrap();
        assert!(matches!(db.restore_revision(&other.id, 1, &revs[2].id), Err(ContentError::Invalid(_))));
        assert!(db.audit_events("program", &p.id).unwrap().iter().any(|e| e.action == "restore_revision"));
    }

    #[test]
    fn only_the_last_fifty_revisions_are_kept() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Busy", None).unwrap();
        for (rev, n) in (1..).zip(0..60) {
            db.replace_items(&p.id, rev, &[verse(&format!("Gen 1:{}", n + 1), 1, 1, n + 1)]).unwrap();
        }
        let revs = db.list_revisions(&p.id).unwrap();
        assert_eq!(i64::try_from(revs.len()).unwrap(), KEEP_REVISIONS);
        assert_eq!(revs[0].revision, 61);
        assert_eq!(revs.last().unwrap().revision, 12);
    }

    #[test]
    fn deleting_a_service_drops_its_history() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("x", None).unwrap();
        db.replace_items(&p.id, 1, &[verse("John 3:16", 43, 3, 16)]).unwrap();
        db.delete_program(&p.id, 2).unwrap();
        assert_eq!(db.list_revisions(&p.id).unwrap().len(), 0);
    }

    #[test]
    fn approval_pins_a_revision_that_survives_saves_and_pruning() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Sunday", None).unwrap();
        let item = |r: &str| ItemInput { kind: "verse".into(), reference: r.into(), book_number: Some(43), chapter: Some(3), verse: Some(16), ..Default::default() };
        let p = db.replace_items(&p.id, p.revision, &[item("John 3:16")]).unwrap().program;
        let approved = db.approve_program(&p.id, p.revision).unwrap();
        assert_eq!((approved.approved_revision, approved.revision), (Some(p.revision), p.revision));
        assert!(approved.approved_at.is_some());
        assert!(matches!(db.approve_program(&p.id, p.revision + 7), Err(ContentError::Conflict { .. })));
        // Many later saves: the approval stays, the approved snapshot is never pruned.
        let mut cur = approved;
        for i in 0..(KEEP_REVISIONS + 10) {
            cur = db.replace_items(&cur.id, cur.revision, &[item(&format!("Psalm {i}:1"))]).unwrap().program;
        }
        assert_eq!(cur.approved_revision, Some(p.revision));
        let revs = db.list_revisions(&p.id).unwrap();
        let kept = revs.iter().find(|r| r.revision == p.revision).expect("approved snapshot kept");
        assert!(revs.len() <= usize::try_from(KEEP_REVISIONS).unwrap() + 1);
        let back = db.restore_revision(&p.id, cur.revision, &kept.id).unwrap();
        assert_eq!(back.items[0].reference, "John 3:16");
        assert_eq!(back.program.approved_revision, Some(p.revision)); // still points at the approved content's revision
    }

    #[test]
    fn the_operator_name_is_recorded_on_audit_rows() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Sunday", None).unwrap();
        crate::set_actor(Some("  Tolu  "));
        let approved = db.approve_program(&p.id, p.revision).unwrap();
        crate::set_actor(None);
        assert_eq!(approved.approved_by.as_deref(), Some("Tolu"), "CL-002: who approved it");
        let events = db.audit_events("program", &p.id).unwrap();
        let approve = events.iter().find(|e| e.action == "approve").unwrap();
        assert_eq!(approve.actor.as_deref(), Some("Tolu"));
        let _ = db.update_program(&p.id, p.revision, "Sunday 9am", None).unwrap();
        assert_eq!(db.audit_events("program", &p.id).unwrap().last().unwrap().actor, None);
    }
}
