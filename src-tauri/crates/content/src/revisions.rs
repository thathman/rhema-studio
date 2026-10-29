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

fn has_design_table(conn: &Connection) -> Result<bool> {
    Ok(conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'approved_design_snapshots'", [], |r| r.get::<_, i64>(0))? > 0)
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
        // A legacy caller cannot refresh a design-aware release without its manifest.
        // Re-approving that exact release is a no-op; preserve its content/design pins.
        if has_design_table(&tx)? {
            let captured: i64 = tx.query_row("SELECT COUNT(*) FROM approved_design_snapshots WHERE program_id = ?1 AND revision = ?2", params![program_id, expected_revision], |r| r.get(0))?;
            if captured > 0 {
                return load_program(&tx, program_id)?.ok_or_else(|| ContentError::NotFound(program_id.into()));
            }
        }
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
        let program_state: Option<(i64, Option<i64>)> = tx.query_row(
            "SELECT revision, approved_revision FROM programs WHERE id = ?1",
            params![program_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).optional()?;
        let Some((actual_revision, current_approved_revision)) = program_state else {
            return Err(ContentError::NotFound(program_id.to_string()));
        };
        if actual_revision != expected_revision {
            // The caller may be retrying a refresh whose successful response was lost.
            // Accept only the exact manifest stored as the immediately following approved
            // revision; all other stale approvals remain conflicts.
            if let Some(program) = approved_refresh_retry(&tx, program_id, expected_revision, actual_revision, current_approved_revision, designs)? {
                check_design_pins(&tx, program_id, designs)?;
                tx.commit()?;
                return Ok(program);
            }
            return Err(ContentError::Conflict { expected: expected_revision, actual: actual_revision });
        }
        // Refresh is a new release identity even when the service rows did not change.
        // Legacy approvals have no design manifest yet, but still need a new revision
        // so adding their first pins cannot rewrite the historical approval.
        let existing_snapshot: Option<String> = tx.query_row(
            "SELECT snapshot FROM approved_design_snapshots WHERE program_id = ?1 AND revision = ?2",
            params![program_id, expected_revision],
            |row| row.get(0),
        ).optional()?;
        if current_approved_revision == Some(expected_revision) {
            if let Some(raw) = &existing_snapshot {
                let captured: ApprovedDesignSnapshot = serde_json::from_str(raw).map_err(|e| {
                    ContentError::Corrupt(format!("approved designs for {program_id} v{expected_revision}: {e}"))
                })?;
                if &captured == designs {
                    check_design_pins(&tx, program_id, designs)?;
                    let program = load_program(&tx, program_id)?.ok_or_else(|| ContentError::NotFound(program_id.into()))?;
                    tx.commit()?;
                    return Ok(program);
                }
            }
        }
        let is_refresh = existing_snapshot.is_some() || current_approved_revision == Some(expected_revision);
        let expected_revision = if is_refresh {
            tx.execute("UPDATE programs SET revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1", params![program_id])?;
            snapshot(&tx, program_id)?;
            expected_revision + 1
        } else { expected_revision };
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
        check_design_pins(&tx, program_id, designs)?;
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
        if !has_design_table(&conn)? { return Ok(None); }
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
        let current = self.get_program(program_id)?.ok_or_else(|| ContentError::NotFound(program_id.to_string()))?;
        let mut items = revision.items;
        for item in &mut items {
            let old = current.items.iter().find(|candidate| item.id.as_deref() == Some(candidate.id.as_str()));
            item.payload = crate::preserve_comment_history(old.and_then(|it| it.payload.as_deref()), item.payload.as_deref())?;
        }
        let mut restored = self.restore_items_with_history(program_id, expected_revision, &items)?;
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

/// Return the program only for an exact retry of the immediately committed design refresh.
fn approved_refresh_retry(
    tx: &Transaction<'_>,
    program_id: &str,
    expected_revision: i64,
    actual_revision: i64,
    current_approved_revision: Option<i64>,
    designs: &ApprovedDesignSnapshot,
) -> Result<Option<crate::Program>> {
    let Some(retry_revision) = expected_revision
        .checked_add(1)
        .filter(|revision| actual_revision == *revision && current_approved_revision == Some(*revision))
    else {
        return Ok(None);
    };
    let raw: Option<String> = tx
        .query_row(
            "SELECT snapshot FROM approved_design_snapshots WHERE program_id = ?1 AND revision = ?2",
            params![program_id, retry_revision],
            |row| row.get(0),
        )
        .optional()?;
    let Some(raw) = raw else {
        return Ok(None);
    };
    let captured: ApprovedDesignSnapshot = serde_json::from_str(&raw).map_err(|e| {
        ContentError::Corrupt(format!("approved designs for {program_id} v{retry_revision}: {e}"))
    })?;
    if &captured != designs {
        return Ok(None);
    }
    load_program(tx, program_id)?
        .map(Some)
        .ok_or_else(|| ContentError::NotFound(program_id.into()))
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

/// Every design version this approval pins (a scene's `design`, an item's `designRef`) must be a
/// whole positive version this computer holds, so the approved service reopens exactly as approved,
/// offline, and never with another version (docs/contracts/design-documents-v1.md, Pinning).
fn check_design_pins(tx: &Transaction<'_>, program_id: &str, designs: &ApprovedDesignSnapshot) -> Result<()> {
    let mut pins: Vec<(String, serde_json::Value)> = designs.scenes.as_object().into_iter().flatten()
        .filter_map(|(name, scene)| scene.get("design").map(|pin| (format!("scene {name}"), pin.clone())))
        .collect();
    let mut stmt = tx.prepare(
        "SELECT reference, json_extract(payload, '$.designRef') FROM program_items
         WHERE program_id = ?1 AND json_valid(payload) AND json_type(payload, '$.designRef') IS NOT NULL ORDER BY position",
    )?;
    let items = stmt.query_map(params![program_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, rusqlite::types::Value>(1)?)))?;
    for item in items {
        let (reference, raw) = item?;
        let pin = match raw {
            rusqlite::types::Value::Text(text) => serde_json::from_str(&text).unwrap_or(serde_json::Value::Null),
            _ => serde_json::Value::Null,
        };
        pins.push((format!("item \"{reference}\""), pin));
    }
    for (place, pin) in pins {
        let id = pin.get("id").and_then(serde_json::Value::as_str).filter(|id| {
            !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        });
        let version = pin.get("version").and_then(serde_json::Value::as_i64).filter(|v| *v > 0);
        let (Some(id), Some(version)) = (id, version) else {
            return Err(ContentError::Invalid(format!("{place} pins a design without a whole version number")));
        };
        let held: i64 = tx.query_row("SELECT COUNT(*) FROM design_versions WHERE design_id = ?1 AND version = ?2", params![id, version], |r| r.get(0))?;
        if held == 0 {
            return Err(ContentError::Invalid(format!("{place} pins design {id} v{version}, which this computer does not have")));
        }
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
    fn approval_refuses_a_pin_to_a_design_version_this_computer_lacks() {
        let db = ContentDb::open_in_memory().unwrap();
        let doc = serde_json::json!({
            "scene": { "version": 1, "root": "root", "artboard": { "width": 1920, "height": 1080 },
                       "nodes": { "root": { "type": "group", "children": [] } } },
            "bindings": {}, "meta": {},
        });
        let design = db.create_design(&crate::designs::DesignInput { title: "Welcome".into(), kind: "design".into(), document: doc }).unwrap();
        db.create_design_version(&design.id, design.revision, None, "tester").unwrap();
        let scenes = |version: serde_json::Value| serde_json::json!({ "s": { "design": { "id": design.id, "version": version } } });
        let manifest = |scenes| ApprovedDesignSnapshot { version: 1, scenes, looks: serde_json::json!({}), media_ids: vec![] };

        let p = db.create_program("Pinned", None).unwrap();
        let held = db.approve_program_with_designs(&p.id, p.revision, &manifest(scenes(serde_json::json!(1)))).unwrap();
        assert_eq!(held.approved_revision, Some(held.revision));

        for (version, says) in [(serde_json::json!(2), "does not have"), (serde_json::json!("1"), "whole version"), (serde_json::json!(1.5), "whole version")] {
            let err = db.approve_program_with_designs(&p.id, held.revision, &manifest(scenes(version))).unwrap_err();
            assert!(matches!(&err, ContentError::Invalid(m) if m.contains("scene s") && m.contains(says)), "{err:?}");
        }

        let q = db.create_program("Moment", None).unwrap();
        let payload = format!(r#"{{"title":"Welcome","body":"","link":"","designRef":{{"id":"{}","version":3}}}}"#, design.id);
        let q = db.replace_items(&q.id, q.revision, &[ItemInput { kind: "slide".into(), reference: "Welcome".into(), payload: Some(payload), ..ItemInput::default() }]).unwrap();
        let err = db.approve_program_with_designs(&q.program.id, q.program.revision, &manifest(serde_json::json!({}))).unwrap_err();
        assert!(matches!(&err, ContentError::Invalid(m) if m.contains("item \"Welcome\"") && m.contains("v3")), "{err:?}");
        assert_eq!(db.get_program(&q.program.id).unwrap().unwrap().program.approved_revision, None);

        // A repeated or retried approval never reports success once a pinned version is gone
        // (e.g. a partial restore).
        let same = manifest(scenes(serde_json::json!(1)));
        let p = db.get_program(&p.id).unwrap().unwrap().program;
        let approved = db.approve_program_with_designs(&p.id, p.revision, &same).unwrap();
        {
            let conn = db.lock().unwrap();
            conn.execute_batch(&format!("DROP TRIGGER design_versions_immutable_delete; DELETE FROM design_versions WHERE design_id = '{}';", design.id)).unwrap();
        }
        let err = db.approve_program_with_designs(&p.id, approved.revision, &same).unwrap_err();
        assert!(matches!(&err, ContentError::Invalid(m) if m.contains("does not have")), "{err:?}");
    }

    #[test]
    fn legacy_approval_cannot_remove_a_design_aware_release_manifest() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Synthetic legacy caller", None).unwrap();
        let designs = ApprovedDesignSnapshot { version: 1, scenes: serde_json::json!({}), looks: serde_json::json!({}), media_ids: vec![] };
        let approved = db.approve_program_with_designs(&p.id, p.revision, &designs).unwrap();
        assert_eq!(db.approve_program(&p.id, approved.revision).unwrap(), approved);
        assert_eq!(db.approved_designs(&p.id, approved.revision).unwrap(), Some(designs));
    }

    #[test]
    fn explicit_design_refresh_keeps_the_previous_release_and_rejects_stale_approval() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Synthetic refresh", None).unwrap();
        let before = ApprovedDesignSnapshot { version: 1, scenes: serde_json::json!({"s": {"revision": 1}}), looks: serde_json::json!({}), media_ids: vec![] };
        let first = db.approve_program_with_designs(&p.id, p.revision, &before).unwrap();
        let after = ApprovedDesignSnapshot { scenes: serde_json::json!({"s": {"revision": 2}}), ..before.clone() };
        let refreshed = db.approve_program_with_designs(&p.id, first.revision, &after).unwrap();
        assert!(refreshed.revision > first.revision);
        assert_eq!(db.approved_designs(&p.id, first.revision).unwrap(), Some(before.clone()));
        assert_eq!(db.approved_designs(&p.id, refreshed.revision).unwrap(), Some(after.clone()));

        // A lost response after the refresh must not turn an exact retry into a conflict.
        let revisions_after_refresh = db.list_revisions(&p.id).unwrap();
        let approvals_after_refresh = db.audit_events("program", &p.id).unwrap().iter().filter(|e| e.action == "approve").count();
        let retried = db.approve_program_with_designs(&p.id, first.revision, &after).unwrap();
        assert_eq!(retried, refreshed);
        assert_eq!(db.list_revisions(&p.id).unwrap(), revisions_after_refresh);
        assert_eq!(db.audit_events("program", &p.id).unwrap().iter().filter(|e| e.action == "approve").count(), approvals_after_refresh);

        let later_edit = db.update_program(&p.id, refreshed.revision, "Concurrent draft edit", None).unwrap();
        let late_retry = db.approve_program_with_designs(&p.id, first.revision, &after);
        assert!(matches!(late_retry, Err(ContentError::Conflict { expected, actual }) if expected == first.revision && actual == later_edit.revision));
        assert_eq!(db.get_program(&p.id).unwrap().unwrap().program.title, "Concurrent draft edit");

        assert!(matches!(db.approve_program_with_designs(&p.id, first.revision, &before), Err(ContentError::Conflict { .. })));
    }

    #[test]
    fn refreshing_a_legacy_approval_creates_a_new_revision() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Synthetic legacy refresh", None).unwrap();
        let legacy = db.approve_program(&p.id, p.revision).unwrap();
        assert!(db.approved_designs(&p.id, legacy.revision).unwrap().is_none());

        let designs = ApprovedDesignSnapshot {
            version: 1,
            scenes: serde_json::json!({"scene": {"revision": 2}}),
            looks: serde_json::json!({}),
            media_ids: vec![],
        };
        let refreshed = db.approve_program_with_designs(&p.id, legacy.revision, &designs).unwrap();

        assert_eq!(refreshed.revision, legacy.revision + 1);
        assert_eq!(refreshed.approved_revision, Some(refreshed.revision));
        assert!(db.approved_designs(&p.id, legacy.revision).unwrap().is_none());
        assert_eq!(db.approved_designs(&p.id, refreshed.revision).unwrap(), Some(designs));
    }

    #[test]
    fn repeating_the_same_approval_request_is_idempotent() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Synthetic repeated approval", None).unwrap();
        let designs = ApprovedDesignSnapshot {
            version: 1,
            scenes: serde_json::json!({"scene": {"revision": 2}}),
            looks: serde_json::json!({}),
            media_ids: vec![],
        };
        let first = db.approve_program_with_designs(&p.id, p.revision, &designs).unwrap();
        let repeated = db.approve_program_with_designs(&p.id, p.revision, &designs).unwrap();

        assert_eq!(repeated, first);
        assert_eq!(db.approved_designs(&p.id, first.revision).unwrap(), Some(designs));
    }

    #[test]
    fn approval_pins_designs_without_changing_saved_content_or_songs() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Synthetic service", None).unwrap();
        let designs = ApprovedDesignSnapshot {
            version: 1, scenes: serde_json::json!({"scene": {"scene": {"updatedAt": 1}}}),
            looks: serde_json::json!({"look": {"updatedAt": 1}}), media_ids: vec![],
        };
        db.approve_program_with_designs(&p.id, p.revision, &designs).unwrap();
        let edited = db.update_program(&p.id, p.revision, "Draft edit", None).unwrap();
        assert_eq!(db.approved_designs(&p.id, p.revision).unwrap(), Some(designs));
        assert_eq!(db.get_program(&p.id).unwrap().unwrap().program.approved_revision, Some(p.revision));
        assert!(db.approved_designs(&p.id, edited.revision).unwrap().is_none());
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
    fn repeated_scripture_occurrences_keep_distinct_identity_and_approved_settings() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Sunday", None).unwrap();
        let reading = |id: &str, translation: &str, notes: &str, scene: &str| ItemInput {
            id: Some(id.into()),
            kind: "verse".into(),
            reference: "John 3:16".into(),
            book_number: Some(43),
            chapter: Some(3),
            verse: Some(16),
            translation: Some(translation.into()),
            notes: Some(notes.into()),
            payload: Some(serde_json::json!({"scene_id": scene}).to_string()),
            ..ItemInput::default()
        };
        let planned = [
            reading("opening-reading", "KJV", "Opening prayer", "prayer-scene"),
            reading("sermon-reading", "OYCB", "Sermon", "sermon-scene"),
        ];
        let saved = db.replace_items(&p.id, p.revision, &planned).unwrap();
        assert_eq!(saved.items.iter().map(|item| item.id.as_str()).collect::<Vec<_>>(), vec!["opening-reading", "sermon-reading"]);
        assert!(saved.items.iter().all(|item| (item.book_number, item.chapter, item.verse) == (Some(43), Some(3), Some(16))));

        let approved = db.approve_program(&p.id, saved.program.revision).unwrap();
        let changed = db.replace_items(&p.id, approved.revision, &[]).unwrap();
        let approved_revision = db.list_revisions(&p.id).unwrap().into_iter().find(|revision| revision.revision == approved.revision).unwrap();
        let snapshot = db.get_revision(&approved_revision.id).unwrap().unwrap();
        assert_eq!(snapshot.items.iter().map(|item| (item.id.as_deref(), item.translation.as_deref(), item.notes.as_deref())).collect::<Vec<_>>(), vec![
            (Some("opening-reading"), Some("KJV"), Some("Opening prayer")),
            (Some("sermon-reading"), Some("OYCB"), Some("Sermon")),
        ]);
        assert!(snapshot.items[0].payload.as_deref().unwrap().contains("prayer-scene"));
        assert!(snapshot.items[1].payload.as_deref().unwrap().contains("sermon-scene"));

        let restored = db.restore_revision(&p.id, changed.program.revision, &approved_revision.id).unwrap();
        assert_eq!(restored.items.iter().map(|item| item.id.as_str()).collect::<Vec<_>>(), vec!["opening-reading", "sermon-reading"]);
        assert_eq!(restored.items.iter().map(|item| item.translation.as_deref()).collect::<Vec<_>>(), vec![Some("KJV"), Some("OYCB")]);
        assert_eq!(restored.program.approved_revision, Some(restored.program.revision));
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
    fn a_desk_saving_over_the_lan_is_recorded_as_that_desk() {
        let _actor_guard = crate::TEST_ACTOR_LOCK.lock().unwrap();
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Sunday", None).unwrap();
        crate::set_actor(Some("Tolu"));
        let saved = crate::as_actor("Ada's laptop (Editor)", || db.replace_items(&p.id, p.revision, &[])).unwrap();
        let latest = db.list_revisions(&p.id).unwrap().into_iter().next().unwrap();
        assert_eq!((latest.revision, latest.saved_by.as_deref()), (saved.program.revision, Some("Ada's laptop (Editor)")));
        assert_eq!(crate::actor().as_deref(), Some("Tolu"), "the desk's name lasts only for its call");
        crate::set_actor(None);
    }

    #[test]
    fn the_operator_name_is_recorded_on_audit_rows() {
        let _actor_guard = crate::TEST_ACTOR_LOCK.lock().unwrap();
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
    fn restoring_an_older_revision_preserves_comment_tombstones() {
        let _actor_guard = crate::TEST_ACTOR_LOCK.lock().unwrap();
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Sunday", None).unwrap();
        let original = ItemInput {
            id: Some("i1".into()),
            kind: "verse".into(),
            reference: "John 3:16".into(),
            book_number: Some(43),
            chapter: Some(3),
            verse: Some(16),
            payload: Some(serde_json::json!({
                "comments": [{ "id": "comment-1", "by": "Ade", "at": "2026-10-21T10:00:00Z", "text": "Read slowly" }]
            }).to_string()),
            ..ItemInput::default()
        };
        crate::set_actor(Some("Ade"));
        let saved = db.replace_items(&p.id, p.revision, &[original]).unwrap();
        let old = db.list_revisions(&p.id).unwrap().into_iter().find(|r| r.revision == saved.program.revision).unwrap();
        let removed = ItemInput {
            id: Some("i1".into()),
            kind: "verse".into(),
            reference: "John 3:16".into(),
            book_number: Some(43),
            chapter: Some(3),
            verse: Some(16),
            payload: Some(serde_json::json!({
                "comments": [{ "id": "comment-1", "by": "Ade", "at": "2026-10-21T10:00:00Z", "text": "Read slowly", "deleted_by": "Ade", "deleted_at": "2026-10-21T11:00:00Z" }]
            }).to_string()),
            ..ItemInput::default()
        };
        let current = db.replace_items(&p.id, saved.program.revision, &[removed]).unwrap();
        let restored = db.restore_revision(&p.id, current.program.revision, &old.id).unwrap();
        crate::set_actor(None);
        let payload: serde_json::Value = serde_json::from_str(restored.items[0].payload.as_deref().unwrap()).unwrap();
        assert_eq!(payload["comments"][0]["deleted_by"], "Ade");
        assert_eq!(payload["comments"][0]["deleted_at"], "2026-10-21T11:00:00Z");
    }

    #[test]
    fn restoring_an_older_revision_keeps_comments_added_after_it() {
        let _actor_guard = crate::TEST_ACTOR_LOCK.lock().unwrap();
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Sunday", None).unwrap();
        let item = ItemInput {
            id: Some("i1".into()),
            kind: "verse".into(),
            reference: "John 3:16".into(),
            book_number: Some(43),
            chapter: Some(3),
            verse: Some(16),
            ..ItemInput::default()
        };
        let saved = db.replace_items(&p.id, p.revision, std::slice::from_ref(&item)).unwrap();
        let old = db.list_revisions(&p.id).unwrap().into_iter().find(|r| r.revision == saved.program.revision).unwrap();
        crate::set_actor(Some("Tolu"));
        let later = ItemInput {
            payload: Some(serde_json::json!({
                "comments": [{ "id": "comment-later", "by": "Tolu", "at": "2026-10-21T12:00:00Z", "text": "Keep the ending quiet" }]
            }).to_string()),
            ..item.clone()
        };
        let current = db.replace_items(&p.id, saved.program.revision, &[later]).unwrap();
        let restored = db.restore_revision(&p.id, current.program.revision, &old.id).unwrap();
        crate::set_actor(None);
        let payload: serde_json::Value = serde_json::from_str(restored.items[0].payload.as_deref().unwrap()).unwrap();
        assert_eq!(payload["comments"][0]["id"], "comment-later");
        assert_eq!(payload["comments"][0]["text"], "Keep the ending quiet");
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
