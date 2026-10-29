//! Editable Avnac design documents (migration 0018; C2, `docs/contracts/design-documents-v1.md`).
//!
//! One canonical store (doc 29): the draft is what the editor saves, with the same stale-revision
//! check as every other source here; a version is an immutable copy that services and scenes pin by
//! number. Nothing in this module reaches an output: saving a design is never a Take.

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::{audit, new_id, ContentDb, ContentError, Result};

/// A design with its images inline must still open quickly; big media belongs in the media library.
pub const MAX_DESIGN_BYTES: usize = 4 * 1024 * 1024;
const KINDS: [&str; 4] = ["design", "scene", "template", "slide"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesignDocument {
    pub id: String,
    pub title: String,
    /// `design`, `scene`, `template` or `slide`: where the Library shows it, not a different model.
    pub kind: String,
    /// The editor's document: `{ scene, bindings, meta }` (`src/design-engine/rhema-scene.ts`).
    pub document: serde_json::Value,
    pub revision: i64,
    /// Highest version made from this design; `None` until the first.
    pub latest_version: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesignSummary {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub revision: i64,
    pub latest_version: Option<i64>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesignVersion {
    pub design_id: String,
    pub version: i64,
    /// The draft revision this version copied.
    pub from_revision: i64,
    pub title: String,
    pub document: serde_json::Value,
    pub note: Option<String>,
    pub saved_by: String,
    pub created_at: String,
}

/// A service item that pins a version of a design (`payload.designRef`), for "Used On".
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesignUse {
    pub program_id: String,
    pub title: String,
    pub service_date: Option<String>,
    pub revision: i64,
    /// The revision Live uses: an approved service keeps the version it was approved with.
    pub approved_revision: Option<i64>,
    pub item_id: String,
    pub reference: String,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DesignInput {
    pub title: String,
    #[serde(default = "default_kind")]
    pub kind: String,
    pub document: serde_json::Value,
}

fn default_kind() -> String {
    "design".into()
}

impl ContentDb {
    /// Designs by title (no documents: a list of hundreds stays light), newest change first.
    pub fn list_designs(&self, query: Option<&str>, kind: Option<&str>, limit: usize) -> Result<Vec<DesignSummary>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT id, title, kind, revision, (SELECT MAX(version) FROM design_versions v WHERE v.design_id = d.id), updated_at
             FROM design_documents d WHERE (?1 = '' OR instr(lower(title), lower(?1)) > 0) AND (?2 = '' OR kind = ?2)
             ORDER BY updated_at DESC, id LIMIT ?3",
        )?;
        let rows = stmt.query_map(
            params![query.unwrap_or_default().trim(), kind.unwrap_or_default(), i64::try_from(limit.min(5000)).unwrap_or(5000)],
            |r| Ok(DesignSummary { id: r.get(0)?, title: r.get(1)?, kind: r.get(2)?, revision: r.get(3)?, latest_version: r.get(4)?, updated_at: r.get(5)? }),
        )?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn get_design(&self, id: &str) -> Result<Option<DesignDocument>> {
        load_design(&*self.lock()?, id)
    }

    pub fn create_design(&self, input: &DesignInput) -> Result<DesignDocument> {
        let (title, kind, document) = validate(input)?;
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let id = new_id();
        tx.execute("INSERT INTO design_documents (id, title, kind, document) VALUES (?1, ?2, ?3, ?4)", params![id, title, kind, document])?;
        audit(&tx, "design", &id, "create", &serde_json::json!({ "title": title, "kind": kind }))?;
        let saved = load_design(&tx, &id)?.ok_or_else(|| ContentError::NotFound(id.clone()))?;
        tx.commit()?;
        Ok(saved)
    }

    /// Save the editor's draft. A desk that opened an older revision gets `Conflict`, never a
    /// silent overwrite of someone else's newer save. Versions already made are unchanged.
    pub fn save_design_draft(&self, id: &str, expected_revision: i64, input: &DesignInput) -> Result<DesignDocument> {
        let (title, kind, document) = validate(input)?;
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        check_revision(&tx, id, expected_revision)?;
        tx.execute(
            "UPDATE design_documents SET title = ?2, kind = ?3, document = ?4, revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
            params![id, title, kind, document],
        )?;
        audit(&tx, "design", id, "update", &serde_json::json!({ "title": title }))?;
        let saved = load_design(&tx, id)?.ok_or_else(|| ContentError::NotFound(id.to_string()))?;
        tx.commit()?;
        Ok(saved)
    }

    /// Freeze the current draft as the next numbered version (only the revision the caller saw).
    pub fn create_design_version(&self, id: &str, expected_revision: i64, note: Option<&str>, saved_by: &str) -> Result<DesignVersion> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        check_revision(&tx, id, expected_revision)?;
        let note = note.map(str::trim).filter(|n| !n.is_empty()).map(|n| n.chars().take(500).collect::<String>());
        tx.execute(
            "INSERT INTO design_versions (design_id, version, from_revision, title, document, note, saved_by)
             SELECT id, COALESCE((SELECT MAX(version) FROM design_versions WHERE design_id = ?1), 0) + 1, revision, title, document, ?2, ?3
             FROM design_documents WHERE id = ?1",
            params![id, note, saved_by.trim()],
        )?;
        let version: i64 = tx.query_row("SELECT MAX(version) FROM design_versions WHERE design_id = ?1", params![id], |r| r.get(0))?;
        audit(&tx, "design", id, "version", &serde_json::json!({ "version": version, "note": note }))?;
        let saved = load_version(&tx, id, version)?.ok_or_else(|| ContentError::NotFound(id.to_string()))?;
        tx.commit()?;
        Ok(saved)
    }

    pub fn get_design_version(&self, id: &str, version: i64) -> Result<Option<DesignVersion>> {
        load_version(&*self.lock()?, id, version)
    }

    /// Versions newest first, without their documents.
    pub fn list_design_versions(&self, id: &str) -> Result<Vec<DesignVersion>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(&format!("SELECT {VERSION_COLUMNS} FROM design_versions WHERE design_id = ?1 ORDER BY version DESC"))?;
        let rows = stmt.query_map(params![id], |r| row_to_version(r).map(|v| DesignVersion { document: serde_json::Value::Null, ..v }))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// A new editable design from a draft or one of its versions ("Edit a copy" of a template).
    pub fn duplicate_design(&self, id: &str, version: Option<i64>, title: Option<&str>) -> Result<DesignDocument> {
        let (src_title, kind, document) = {
            let conn = self.lock()?;
            match version {
                Some(v) => load_version(&conn, id, v)?.map(|s| (s.title, None, s.document)),
                None => load_design(&conn, id)?.map(|d| (d.title, Some(d.kind), d.document)),
            }
            .ok_or_else(|| ContentError::NotFound(id.to_string()))?
        };
        let kind = match kind.as_deref() {
            Some("template") | None => "design".to_string(),
            Some(k) => k.to_string(),
        };
        let title = title.map(str::trim).filter(|t| !t.is_empty()).map_or_else(|| format!("{src_title} (copy)"), str::to_string);
        self.create_design(&DesignInput { title, kind, document })
    }

    /// The services whose items pin a version of this design (`payload.designRef`), newest service
    /// first. Scenes live in the desk's scene store, so the UI adds those it holds.
    pub fn design_used_on(&self, id: &str) -> Result<Vec<DesignUse>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT p.id, p.title, p.service_date, p.revision, p.approved_revision, i.id, i.reference, json_extract(i.payload, '$.designRef.version')
             FROM program_items i JOIN programs p ON p.id = i.program_id
             WHERE json_valid(i.payload) AND json_extract(i.payload, '$.designRef.id') = ?1
               AND json_type(i.payload, '$.designRef.version') = 'integer' AND json_extract(i.payload, '$.designRef.version') > 0
             ORDER BY p.service_date IS NULL, p.service_date DESC, p.updated_at DESC, i.position",
        )?;
        let rows = stmt.query_map(params![id], |r| {
            Ok(DesignUse { program_id: r.get(0)?, title: r.get(1)?, service_date: r.get(2)?, revision: r.get(3)?, approved_revision: r.get(4)?, item_id: r.get(5)?, reference: r.get(6)?, version: r.get(7)? })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    /// Only a design nobody can have pinned: one with versions stays (they are immutable).
    pub fn delete_design(&self, id: &str, expected_revision: i64) -> Result<()> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        check_revision(&tx, id, expected_revision)?;
        let versions: i64 = tx.query_row("SELECT COUNT(*) FROM design_versions WHERE design_id = ?1", params![id], |r| r.get(0))?;
        if versions > 0 {
            return Err(ContentError::Refused { code: "has-versions", message: "This design has saved versions a service may use; it is kept.".into() });
        }
        tx.execute("DELETE FROM design_documents WHERE id = ?1", params![id])?;
        audit(&tx, "design", id, "delete", &serde_json::Value::Null)?;
        tx.commit()?;
        Ok(())
    }
}

/// The host checks the shape it relies on and the size; the editor owns the rest of the document.
fn validate(input: &DesignInput) -> Result<(String, String, String)> {
    let invalid = |m: &str| Err(ContentError::Invalid(m.into()));
    let title = input.title.trim();
    if title.is_empty() || title.chars().count() > 200 {
        return invalid("a design needs a title of up to 200 characters");
    }
    let kind = input.kind.trim();
    if !KINDS.contains(&kind) {
        return invalid("design kind must be design, scene, template or slide");
    }
    let doc = &input.document;
    let scene = doc.get("scene");
    let ok = scene.and_then(|s| s.get("nodes")).is_some_and(serde_json::Value::is_object)
        && scene.and_then(|s| s.get("root")).is_some_and(serde_json::Value::is_string)
        && scene.and_then(|s| s.get("artboard")).is_some_and(serde_json::Value::is_object)
        && doc.get("bindings").is_none_or(serde_json::Value::is_object);
    if !ok {
        return invalid("a design document needs a scene (artboard, root, nodes) and bindings by node");
    }
    let nodes = scene.and_then(|s| s.get("nodes")).and_then(serde_json::Value::as_object);
    let root = scene.and_then(|s| s.get("root")).and_then(serde_json::Value::as_str).unwrap_or_default();
    if let Some(nodes) = nodes {
        check_tree(nodes, root)?;
    }
    if let Some(bindings) = doc.get("bindings").and_then(serde_json::Value::as_object) {
        let nodes = scene.and_then(|s| s.get("nodes")).and_then(serde_json::Value::as_object);
        if let Some(missing) = bindings.keys().find(|k| !nodes.is_some_and(|n| n.contains_key(*k))) {
            return Err(ContentError::Invalid(format!("binding \"{missing}\" has no node in the design")));
        }
    }
    let text = serde_json::to_string(doc).map_err(|e| ContentError::Invalid(e.to_string()))?;
    if text.len() > MAX_DESIGN_BYTES {
        return invalid("this design is over 4 MB: put large pictures in the media library and use them from there");
    }
    Ok((title.to_string(), kind.to_string(), text))
}

/// The node tree the editor and the scene adapter walk: the root exists, every group's children
/// exist, and no node is reached twice (a cycle, or one node under two groups) — otherwise opening
/// it would silently drop layers or never end.
fn check_tree(nodes: &serde_json::Map<String, serde_json::Value>, root: &str) -> Result<()> {
    let invalid = |m: String| Err(ContentError::Invalid(m));
    if !nodes.contains_key(root) {
        return invalid(format!("the design's root \"{root}\" is not one of its nodes"));
    }
    if nodes[root].get("type").and_then(serde_json::Value::as_str) != Some("group") {
        return invalid(format!("the design's root \"{root}\" must be a group"));
    }
    let mut seen = std::collections::HashSet::new();
    let mut stack = vec![root];
    while let Some(id) = stack.pop() {
        if !seen.insert(id) {
            return invalid(format!("node \"{id}\" is reached twice in the design (a group inside itself or under two groups)"));
        }
        let Some(node) = nodes.get(id) else {
            return invalid(format!("a group lists \"{id}\", which is not one of the design's nodes"));
        };
        let is_group = node.get("type").and_then(serde_json::Value::as_str) == Some("group");
        if is_group || node.get("children").is_some() {
            let Some(children) = node.get("children").and_then(serde_json::Value::as_array) else {
                return invalid(format!("group \"{id}\" needs a list of children"));
            };
            for child in children {
                let Some(child) = child.as_str() else { return invalid(format!("group \"{id}\" lists a child that is not a node id")) };
                stack.push(child);
            }
        }
    }
    Ok(())
}

const DESIGN_COLUMNS: &str =
    "id, title, kind, document, revision, (SELECT MAX(version) FROM design_versions v WHERE v.design_id = d.id), created_at, updated_at";
const VERSION_COLUMNS: &str = "design_id, version, from_revision, title, document, note, saved_by, created_at";

fn json(text: &str) -> serde_json::Value {
    serde_json::from_str(text).unwrap_or(serde_json::Value::Null)
}

fn load_design(conn: &Connection, id: &str) -> Result<Option<DesignDocument>> {
    Ok(conn
        .query_row(&format!("SELECT {DESIGN_COLUMNS} FROM design_documents d WHERE id = ?1"), params![id], |r| {
            Ok(DesignDocument { id: r.get(0)?, title: r.get(1)?, kind: r.get(2)?, document: json(&r.get::<_, String>(3)?), revision: r.get(4)?, latest_version: r.get(5)?, created_at: r.get(6)?, updated_at: r.get(7)? })
        })
        .optional()?)
}

fn row_to_version(r: &rusqlite::Row<'_>) -> rusqlite::Result<DesignVersion> {
    Ok(DesignVersion { design_id: r.get(0)?, version: r.get(1)?, from_revision: r.get(2)?, title: r.get(3)?, document: json(&r.get::<_, String>(4)?), note: r.get(5)?, saved_by: r.get(6)?, created_at: r.get(7)? })
}

fn load_version(conn: &Connection, id: &str, version: i64) -> Result<Option<DesignVersion>> {
    Ok(conn.query_row(&format!("SELECT {VERSION_COLUMNS} FROM design_versions WHERE design_id = ?1 AND version = ?2"), params![id, version], row_to_version).optional()?)
}

fn check_revision(tx: &Transaction<'_>, id: &str, expected: i64) -> Result<()> {
    let actual: Option<i64> = tx.query_row("SELECT revision FROM design_documents WHERE id = ?1", params![id], |r| r.get(0)).optional()?;
    match actual {
        None => Err(ContentError::NotFound(id.to_string())),
        Some(actual) if actual != expected => Err(ContentError::Conflict { expected, actual }),
        Some(_) => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(text: &str) -> serde_json::Value {
        serde_json::json!({
            "scene": { "version": 1, "root": "root", "artboard": { "width": 1920, "height": 1080 },
                       "nodes": { "root": { "type": "group", "children": ["verse"] }, "verse": { "type": "rect", "text": text } } },
            "bindings": { "verse": { "kind": "feed", "shows": ["bible"] } },
            "meta": { "id": "sermon", "name": "Sermon" },
        })
    }

    fn input(text: &str) -> DesignInput {
        DesignInput { title: "Sermon".into(), kind: "scene".into(), document: doc(text) }
    }

    #[test]
    fn saves_reopens_and_refuses_a_stale_draft() {
        let db = ContentDb::open_in_memory().unwrap();
        let d = db.create_design(&input("one")).unwrap();
        assert_eq!((d.revision, d.latest_version), (1, None));
        assert_eq!(db.get_design(&d.id).unwrap().unwrap().document, doc("one"));
        let d2 = db.save_design_draft(&d.id, 1, &input("two")).unwrap();
        assert_eq!(d2.revision, 2);
        // A second desk that opened revision 1 cannot overwrite revision 2.
        assert!(matches!(db.save_design_draft(&d.id, 1, &input("three")), Err(ContentError::Conflict { expected: 1, actual: 2 })));
        assert_eq!(db.get_design(&d.id).unwrap().unwrap().document, doc("two"));
        assert_eq!(db.list_designs(Some("serm"), Some("scene"), 10).unwrap().len(), 1);
        assert_eq!(
            db.list_designs(None, Some("template"), 10).unwrap(),
            Vec::<DesignSummary>::new()
        );
    }

    #[test]
    fn versions_are_frozen_copies_a_service_can_pin() {
        let db = ContentDb::open_in_memory().unwrap();
        let d = db.create_design(&input("first")).unwrap();
        let v1 = db.create_design_version(&d.id, 1, Some("Sunday"), "Femi").unwrap();
        assert_eq!((v1.version, v1.from_revision, v1.saved_by.as_str()), (1, 1, "Femi"));
        db.save_design_draft(&d.id, 1, &input("later edit")).unwrap();
        // Editing the draft never changes what version 1 shows.
        assert_eq!(db.get_design_version(&d.id, 1).unwrap().unwrap().document, doc("first"));
        assert!(matches!(db.create_design_version(&d.id, 1, None, "Femi"), Err(ContentError::Conflict { .. })));
        let v2 = db.create_design_version(&d.id, 2, None, "Femi").unwrap();
        assert_eq!(v2.version, 2);
        assert_eq!(db.list_design_versions(&d.id).unwrap().iter().map(|v| v.version).collect::<Vec<_>>(), vec![2, 1]);
        assert_eq!(db.get_design(&d.id).unwrap().unwrap().latest_version, Some(2));
        // The database itself refuses to rewrite or remove a version.
        let conn = db.lock().unwrap();
        assert!(conn.execute("UPDATE design_versions SET document = '{}'", []).is_err());
        assert!(conn.execute("DELETE FROM design_versions", []).is_err());
    }

    #[test]
    fn a_design_with_versions_is_kept_and_a_copy_is_editable() {
        let db = ContentDb::open_in_memory().unwrap();
        let t = db.create_design(&DesignInput { kind: "template".into(), ..input("look") }).unwrap();
        db.create_design_version(&t.id, 1, None, "").unwrap();
        assert!(matches!(db.delete_design(&t.id, 1), Err(ContentError::Refused { code: "has-versions", .. })));
        let copy = db.duplicate_design(&t.id, Some(1), None).unwrap();
        assert_eq!((copy.title.as_str(), copy.kind.as_str(), copy.revision), ("Sermon (copy)", "design", 1));
        assert_eq!(copy.document, doc("look"));
        db.delete_design(&copy.id, 1).unwrap();
        assert!(db.get_design(&copy.id).unwrap().is_none());
    }

    #[test]
    fn used_on_lists_the_services_that_pin_a_version() {
        let db = ContentDb::open_in_memory().unwrap();
        let d = db.create_design(&input("lower third")).unwrap();
        db.create_design_version(&d.id, 1, None, "").unwrap();
        let other = db.create_design(&input("other")).unwrap();
        let p = db.create_program("Sunday", Some("2026-11-01")).unwrap();
        let moment = |reference: &str, design: &str, version: i64| crate::ItemInput {
            id: None,
            kind: "slide".into(),
            reference: reference.into(),
            book_number: None,
            chapter: None,
            verse: None,
            translation: None,
            secondary_translation: None,
            notes: None,
            payload: Some(serde_json::json!({ "title": reference, "designRef": { "id": design, "version": version } }).to_string()),
        };
        // Pins written by hand or by an older build: a string, a zero, a missing or fractional version
        // is not a pin. It never counts as "version 0" and never breaks the list for the good ones.
        let malformed = |reference: &str, design_ref: serde_json::Value| crate::ItemInput {
            payload: Some(serde_json::json!({ "title": reference, "designRef": design_ref }).to_string()),
            ..moment(reference, &d.id, 1)
        };
        let saved = db
            .replace_items(&p.id, p.revision, &[
                moment("Welcome", &d.id, 1),
                moment("Notices", &other.id, 1),
                malformed("Text version", serde_json::json!({ "id": d.id, "version": "2" })),
                malformed("Zero", serde_json::json!({ "id": d.id, "version": 0 })),
                malformed("No version", serde_json::json!({ "id": d.id })),
                malformed("Half", serde_json::json!({ "id": d.id, "version": 1.5 })),
            ])
            .unwrap();
        let uses = db.design_used_on(&d.id).unwrap();
        assert_eq!(uses.len(), 1);
        assert_eq!((uses[0].program_id.as_str(), uses[0].reference.as_str(), uses[0].version, uses[0].revision), (p.id.as_str(), "Welcome", 1, saved.program.revision));
        assert_eq!(db.design_used_on("nobody").unwrap(), Vec::<DesignUse>::new());
    }

    #[test]
    fn refuses_a_document_it_cannot_reopen() {
        let db = ContentDb::open_in_memory().unwrap();
        let bad = |document: serde_json::Value| db.create_design(&DesignInput { title: "x".into(), kind: "design".into(), document });
        assert!(matches!(bad(serde_json::json!({ "png": "data:image/png;base64,AAAA" })), Err(ContentError::Invalid(_))));
        let mut orphan = doc("x");
        orphan["bindings"]["ghost"] = serde_json::json!({ "kind": "clock" });
        assert!(matches!(bad(orphan), Err(ContentError::Invalid(m)) if m.contains("ghost")));
        let mut huge = doc("x");
        huge["scene"]["nodes"]["verse"]["text"] = serde_json::Value::String("a".repeat(MAX_DESIGN_BYTES));
        assert!(matches!(bad(huge), Err(ContentError::Invalid(_))));
        assert!(matches!(db.create_design(&DesignInput { kind: "poster".into(), ..input("x") }), Err(ContentError::Invalid(_))));
        // A tree the editor could not walk: a missing root, a missing child, a cycle, a node under two groups.
        let refused = |edit: &dyn Fn(&mut serde_json::Value)| {
            let mut d = doc("x");
            edit(&mut d);
            matches!(bad(d), Err(ContentError::Invalid(_)))
        };
        assert!(refused(&|d| d["scene"]["root"] = "nowhere".into()));
        assert!(refused(&|d| d["scene"]["nodes"]["root"]["children"] = serde_json::json!(["verse", "ghost"])));
        assert!(refused(&|d| d["scene"]["nodes"]["root"]["children"] = serde_json::json!(["root"])));
        assert!(refused(&|d| {
            d["scene"]["nodes"]["g"] = serde_json::json!({ "type": "group", "children": ["verse"] });
            d["scene"]["nodes"]["root"]["children"] = serde_json::json!(["verse", "g"]);
        }));
        assert!(refused(&|d| d["scene"]["nodes"]["root"]["children"] = serde_json::json!("verse")));
        assert!(refused(&|d| {
            d["scene"]["nodes"]["g"] = serde_json::json!({ "type": "group" });
            d["scene"]["nodes"]["root"]["children"] = serde_json::json!(["verse", "g"]);
        }), "a group with no children list");
        assert!(refused(&|d| d["scene"]["root"] = "verse".into()), "a root that is not a group");
    }
}
