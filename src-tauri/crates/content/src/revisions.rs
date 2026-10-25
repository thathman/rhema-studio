//! Service history (migration 0005): one snapshot per save, restorable.

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use crate::{audit, load_items, load_program, new_id, ContentDb, ContentError, ItemInput, ProgramItem, ProgramWithItems, Result, SongWithSections};

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
    /// Who saved this version (operator name on that computer), when known (migration 0011).
    #[serde(default)]
    pub saved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Revision {
    #[serde(flatten)]
    pub summary: RevisionSummary,
    pub items: Vec<ItemInput>,
}

/// Immutable scene/look manifest captured alongside an approved service revision.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ApprovedDesignSnapshot {
    pub version: u32,
    pub scenes: serde_json::Value,
    pub looks: serde_json::Value,
    pub media_ids: Vec<String>,
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
        params![new_id(), program_id, program.revision, program.title, program.service_date, json, i64::try_from(items.iter().filter(|i| !crate::HEADER_KINDS.contains(&i.kind.trim())).count()).unwrap_or(i64::MAX)],
    )?;
    if has_saved_by(tx) {
        tx.execute("UPDATE program_revisions SET saved_by = ?3 WHERE program_id = ?1 AND revision = ?2", params![program_id, program.revision, crate::actor()])?;
    }
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

fn has_saved_by(conn: &Connection) -> bool {
    conn.prepare("SELECT 1 FROM pragma_table_info('program_revisions') WHERE name = 'saved_by'")
        .and_then(|mut st| st.exists([]))
        .unwrap_or(false)
}

/// Summary columns; an older schema (a backup being checked) reads `saved_by` as unknown.
fn cols(conn: &Connection) -> String {
    format!("id, program_id, revision, title, service_date, item_count, created_at, {}", if has_saved_by(conn) { "saved_by" } else { "NULL" })
}

fn row_to_summary(r: &rusqlite::Row<'_>) -> rusqlite::Result<RevisionSummary> {
    Ok(RevisionSummary {
        id: r.get(0)?,
        program_id: r.get(1)?,
        revision: r.get(2)?,
        title: r.get(3)?,
        service_date: r.get(4)?,
        item_count: r.get(5)?,
        created_at: r.get(6)?,
        saved_by: r.get(7)?,
    })
}

fn load_revision(conn: &Connection, id: &str) -> Result<Option<Revision>> {
    let row: Option<(RevisionSummary, String)> = conn
        .query_row(&format!("SELECT {}, items FROM program_revisions WHERE id = ?1", cols(conn)), params![id], |r| {
            Ok((row_to_summary(r)?, r.get::<_, String>(8)?))
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
        let mut stmt = conn.prepare(&format!("SELECT {} FROM program_revisions WHERE program_id = ?1 ORDER BY revision DESC", cols(&conn)))?;
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
        // An approval through the legacy API cannot claim the design snapshot
        // of an earlier approval is still current for this revision.
        tx.execute("DELETE FROM approved_design_snapshots WHERE program_id = ?1 AND revision = ?2", params![program_id, expected_revision])?;
        tx.execute(
            "UPDATE programs SET approved_revision = ?2, approved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
            params![program_id, expected_revision],
        )?;
        if crate::has_archive_column(&tx) {
            tx.execute("UPDATE programs SET approved_by = ?2 WHERE id = ?1", params![program_id, crate::actor()])?;
        }
        pin_songs(&tx, program_id)?;
        audit(&tx, "program", program_id, "approve", &serde_json::json!({ "revision": expected_revision }))?;
        let program = load_program(&tx, program_id)?.ok_or_else(|| ContentError::NotFound(program_id.into()))?;
        tx.commit()?;
        Ok(program)
    }

    /// Approve the service and its referenced scenes/looks as one transaction.
    pub fn approve_program_with_designs(&self, program_id: &str, expected_revision: i64, designs: &ApprovedDesignSnapshot) -> Result<crate::Program> {
        if designs.version != 1 || !designs.scenes.is_object() || !designs.looks.is_object() {
            return Err(ContentError::Invalid("approved designs must be a version 1 scene/look manifest".into()));
        }
        let encoded = serde_json::to_string(designs).map_err(|e| ContentError::Invalid(e.to_string()))?;
        if encoded.len() > 32 * 1024 * 1024 {
            return Err(ContentError::Invalid("approved design snapshot exceeds 32 MiB".into()));
        }
        let mut seen = HashSet::new();
        for id in &designs.media_ids {
            if id.trim().is_empty() || id.len() > 128 || id.chars().any(char::is_control) || !seen.insert(id) {
                return Err(ContentError::Invalid("approved design media ids must be unique, non-empty ids".into()));
            }
        }

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
        for id in &designs.media_ids {
            let found: i64 = tx.query_row("SELECT COUNT(*) FROM media_assets WHERE id = ?1", params![id], |r| r.get(0))?;
            if found == 0 {
                return Err(ContentError::Invalid(format!("approved design references missing media {id}")));
            }
        }
        tx.execute(
            "INSERT INTO approved_design_snapshots (program_id, revision, snapshot) VALUES (?1, ?2, ?3)
             ON CONFLICT(program_id, revision) DO UPDATE SET snapshot = excluded.snapshot, created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
            params![program_id, expected_revision, encoded],
        )?;
        tx.execute("DELETE FROM approved_design_media WHERE program_id = ?1 AND revision = ?2", params![program_id, expected_revision])?;
        for id in &designs.media_ids {
            tx.execute("INSERT INTO approved_design_media (program_id, revision, media_id) VALUES (?1, ?2, ?3)", params![program_id, expected_revision, id])?;
        }
        tx.execute(
            "UPDATE programs SET approved_revision = ?2, approved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
            params![program_id, expected_revision],
        )?;
        if crate::has_archive_column(&tx) {
            tx.execute("UPDATE programs SET approved_by = ?2 WHERE id = ?1", params![program_id, crate::actor()])?;
        }
        pin_songs(&tx, program_id)?;
        audit(&tx, "program", program_id, "approve", &serde_json::json!({
            "revision": expected_revision,
            "designVersion": designs.version,
            "sceneCount": designs.scenes.as_object().map_or(0, serde_json::Map::len),
            "lookCount": designs.looks.as_object().map_or(0, serde_json::Map::len),
            "mediaCount": designs.media_ids.len(),
        }))?;
        let program = load_program(&tx, program_id)?.ok_or_else(|| ContentError::NotFound(program_id.into()))?;
        tx.commit()?;
        Ok(program)
    }

    /// The design manifest captured for one exact approved service revision.
    pub fn approved_designs(&self, program_id: &str, revision: i64) -> Result<Option<ApprovedDesignSnapshot>> {
        let conn = self.lock()?;
        let raw: Option<String> = conn.query_row(
            "SELECT snapshot FROM approved_design_snapshots WHERE program_id = ?1 AND revision = ?2",
            params![program_id, revision],
            |r| r.get(0),
        ).optional()?;
        raw.map(|value| serde_json::from_str(&value).map_err(|e| ContentError::Corrupt(format!("approved designs for {program_id} v{revision}: {e}")))).transpose()
    }

    /// The words of each song as the service was approved (#193): what Present shows for the
    /// service's songs unless the operator chooses the library's newer words. Empty for a service
    /// never approved here (or approved by a build before pins).
    pub fn approved_songs(&self, program_id: &str) -> Result<Vec<SongWithSections>> {
        let conn = self.lock()?;
        if !has_pin_table(&conn)? {
            return Ok(Vec::new());
        }
        let mut stmt = conn.prepare("SELECT song FROM approved_songs WHERE program_id = ?1 ORDER BY song_id")?;
        let rows = stmt.query_map(params![program_id], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for raw in rows {
            // A pin this build cannot read is left out: the library's words are shown instead.
            if let Ok(song) = serde_json::from_str::<SongWithSections>(&raw?) {
                out.push(song);
            }
        }
        Ok(out)
    }

    pub fn restore_revision(&self, program_id: &str, expected_revision: i64, revision_id: &str) -> Result<ProgramWithItems> {
        let revision = {
            let conn = self.lock()?;
            load_revision(&conn, revision_id)?.ok_or_else(|| ContentError::NotFound(revision_id.to_string()))?
        };
        if revision.summary.program_id != program_id {
            return Err(ContentError::Invalid("that revision belongs to another service".into()));
        }
        let mut restored = self.replace_items(program_id, expected_revision, &revision.items)?;
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        audit(&tx, "program", program_id, "restore_revision", &serde_json::json!({ "from_revision": revision.summary.revision }))?;
        // Bringing back the approved version brings back its approval: the items are the
        // approved ones (CL-002), so the service is not left "changed since approval".
        if crate::has_approval_column(&tx)
            && tx.execute(
                "UPDATE programs SET approved_revision = ?3 WHERE id = ?1 AND approved_revision = ?2",
                params![program_id, revision.summary.revision, restored.program.revision],
            )? > 0
        {
            let copied = tx.execute(
                "INSERT INTO approved_design_snapshots (program_id, revision, snapshot)
                 SELECT program_id, ?3, snapshot FROM approved_design_snapshots WHERE program_id = ?1 AND revision = ?2",
                params![program_id, revision.summary.revision, restored.program.revision],
            )?;
            if copied > 0 {
                tx.execute(
                    "INSERT INTO approved_design_media (program_id, revision, media_id)
                     SELECT program_id, ?3, media_id FROM approved_design_media WHERE program_id = ?1 AND revision = ?2",
                    params![program_id, revision.summary.revision, restored.program.revision],
                )?;
            }
            restored.program.approved_revision = Some(restored.program.revision);
        }
        tx.commit()?;
        Ok(restored)
    }
}

/// The pinned songs live in a table made when first needed rather than by a migration, so a
/// database stays openable by builds from before pins (they ignore the table; a migration would
/// make them refuse the file as newer).
const PIN_TABLE: &str = "CREATE TABLE IF NOT EXISTS approved_songs (
    program_id    TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    song_id       TEXT NOT NULL,
    song_revision INTEGER NOT NULL,
    song          TEXT NOT NULL,
    pinned_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (program_id, song_id)
)";

fn has_pin_table(conn: &Connection) -> Result<bool> {
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'approved_songs'", [], |r| r.get(0))?;
    Ok(n > 0)
}

/// Approving pins each song of the service at its current words (#193): a song edited in the
/// library afterwards shows as changed since approval, and the approved words are kept.
fn pin_songs(tx: &Transaction<'_>, program_id: &str) -> Result<()> {
    tx.execute_batch(PIN_TABLE)?;
    tx.execute("DELETE FROM approved_songs WHERE program_id = ?1", params![program_id])?;
    let ids: Vec<String> = {
        let mut stmt = tx.prepare(
            "SELECT DISTINCT json_extract(payload, '$.song_id') FROM program_items
             WHERE program_id = ?1 AND kind = 'song' AND json_valid(payload) AND json_extract(payload, '$.song_id') IS NOT NULL",
        )?;
        let rows = stmt.query_map(params![program_id], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
        rows
    };
    for id in ids {
        let Some(song) = crate::songs::load_song(tx, &id)? else { continue };
        let json = serde_json::to_string(&song).map_err(|e| ContentError::Invalid(e.to_string()))?;
        tx.execute(
            "INSERT INTO approved_songs (program_id, song_id, song_revision, song) VALUES (?1, ?2, ?3, ?4)",
            params![program_id, id, song.song.revision, json],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn verse(reference: &str, b: i64, c: i64, v: i64) -> ItemInput {
        ItemInput { reference: reference.into(), book_number: Some(b), chapter: Some(c), verse: Some(v), ..ItemInput::default() }
    }

    #[test]
    fn restoring_the_approved_version_keeps_it_approved() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Sunday", None).unwrap();
        let saved = db.replace_items(&p.id, 1, &[verse("John 3:16", 43, 3, 16)]).unwrap(); // rev 2
        let designs = ApprovedDesignSnapshot { version: 1, scenes: serde_json::json!({ "welcome": { "scene": "pinned" } }), looks: serde_json::json!({ "look-a": { "color": "#fff" } }), media_ids: vec![] };
        db.approve_program_with_designs(&p.id, saved.program.revision, &designs).unwrap();
        let changed = db.replace_items(&p.id, 2, &[verse("Romans 8:28", 45, 8, 28)]).unwrap(); // rev 3
        assert_ne!(changed.program.approved_revision, Some(changed.program.revision));
        let approved = db.list_revisions(&p.id).unwrap().into_iter().find(|r| r.revision == 2).unwrap();
        let restored = db.restore_revision(&p.id, 3, &approved.id).unwrap(); // rev 4, the approved items
        assert_eq!(restored.program.approved_revision, Some(restored.program.revision));
        assert_eq!(db.approved_designs(&p.id, restored.program.revision).unwrap(), Some(designs));
        assert_eq!(db.get_program(&p.id).unwrap().unwrap().program.approved_revision, Some(restored.program.revision));
        // Restoring some other version does not approve it.
        let other = db.list_revisions(&p.id).unwrap().into_iter().find(|r| r.revision == 3).unwrap();
        let back = db.restore_revision(&p.id, restored.program.revision, &other.id).unwrap();
        assert_ne!(back.program.approved_revision, Some(back.program.revision));
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
        // The approved items are back, so the approval moves to that revision (same content).
        assert_eq!(back.program.approved_revision, Some(back.program.revision));
    }

    #[test]
    fn approved_designs_are_bound_to_the_approved_service_revision() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Sunday", None).unwrap();
        let saved = db.replace_items(&p.id, p.revision, &[verse("John 3:16", 43, 3, 16)]).unwrap();
        let approved_designs = ApprovedDesignSnapshot {
            version: 1,
            scenes: serde_json::json!({ "scene-a": { "id": "scene-a", "updatedAt": 17 } }),
            looks: serde_json::json!({ "look-a": { "id": "look-a", "updatedAt": 4 } }),
            media_ids: vec![],
        };

        let approved = db.approve_program_with_designs(&p.id, saved.program.revision, &approved_designs).unwrap();
        assert_eq!(approved.approved_revision, Some(saved.program.revision));
        assert_eq!(db.approved_designs(&p.id, saved.program.revision).unwrap(), Some(approved_designs.clone()));

        let changed = db.replace_items(&p.id, approved.revision, &[verse("John 3:17", 43, 3, 17)]).unwrap();
        assert_eq!(db.approved_designs(&p.id, saved.program.revision).unwrap(), Some(approved_designs));
        assert!(matches!(db.approve_program_with_designs(&p.id, approved.revision - 1, &ApprovedDesignSnapshot { version: 1, scenes: serde_json::json!({}), looks: serde_json::json!({}), media_ids: vec![] }), Err(ContentError::Conflict { .. })));
        assert_eq!(changed.program.approved_revision, Some(saved.program.revision));
    }

    #[test]
    fn the_operator_name_is_recorded_on_audit_rows() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Sunday", None).unwrap();
        crate::set_actor(Some("  Tolu  "));
        let approved = db.approve_program(&p.id, p.revision).unwrap();
        crate::set_actor(Some("Tolu"));
        let renamed = db.update_program(&p.id, approved.revision, "Sunday (Tolu)", None).unwrap();
        crate::set_actor(None);
        let saved_by: Vec<_> = db.list_revisions(&p.id).unwrap().into_iter().map(|r| (r.revision, r.saved_by)).collect();
        assert_eq!(saved_by.first(), Some(&(renamed.revision, Some("Tolu".to_string()))), "CL-007: who saved each version");
        assert_eq!(approved.approved_by.as_deref(), Some("Tolu"), "CL-002: who approved it");
        let events = db.audit_events("program", &p.id).unwrap();
        let approve = events.iter().find(|e| e.action == "approve").unwrap();
        assert_eq!(approve.actor.as_deref(), Some("Tolu"));
        let _ = db.update_program(&p.id, renamed.revision, "Sunday 9am", None).unwrap();
        assert_eq!(db.audit_events("program", &p.id).unwrap().last().unwrap().actor, None);
    }

    #[test]
    fn approving_pins_each_song_and_a_later_edit_leaves_the_pin() {
        use crate::{SectionInput, SongInput};
        let db = ContentDb::open_in_memory().unwrap();
        let words = |w: &str| SongInput {
            title: "Amazing Grace".into(),
            sections: vec![SectionInput { id: None, kind: "verse".into(), label: "Verse 1".into(), texts: [("en".to_string(), w.to_string())].into() }],
            ..SongInput::default()
        };
        let song = db.create_song(&words("Amazing grace")).unwrap();
        let p = db.create_program("Sunday", None).unwrap();
        // Never approved: no pins (and no table yet).
        assert_eq!(db.approved_songs(&p.id).unwrap().len(), 0);
        let item = ItemInput { kind: "song".into(), reference: "Amazing Grace".into(), payload: Some(format!(r#"{{"song_id":"{}","languages":["en"],"title_slide":true}}"#, song.song.id)), ..ItemInput::default() };
        let saved = db.replace_items(&p.id, 1, &[item.clone(), item]).unwrap();
        db.approve_program(&p.id, saved.program.revision).unwrap();
        let pins = db.approved_songs(&p.id).unwrap();
        assert_eq!(pins.len(), 1, "one pin per song, however often it is sung");
        assert_eq!((pins[0].song.revision, pins[0].sections[0].texts["en"].as_str()), (1, "Amazing grace"));
        // The song is edited after approval: the pin keeps the approved words.
        let edited = db.update_song(&song.song.id, 1, &words("Amazing grace, how sweet")).unwrap();
        assert_eq!(edited.song.revision, 2);
        let pins = db.approved_songs(&p.id).unwrap();
        assert_eq!((pins[0].song.revision, pins[0].sections[0].texts["en"].as_str()), (1, "Amazing grace"));
        // Approving again pins the new words.
        db.approve_program(&p.id, saved.program.revision).unwrap();
        assert_eq!(db.approved_songs(&p.id).unwrap()[0].song.revision, 2);
        // Deleting the service drops its pins.
        let rev = db.get_program(&p.id).unwrap().unwrap().program.revision;
        db.delete_program(&p.id, rev).unwrap();
        let conn = db.lock().unwrap();
        let left: i64 = conn.query_row("SELECT COUNT(*) FROM approved_songs", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }
}
