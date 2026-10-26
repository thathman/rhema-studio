//! Reusable slide and announcement sources (migration 0015).

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::{audit, is_valid_id, new_id, ContentDb, ContentError, Result};

pub const MAX_SLIDE_BODY: usize = 8000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReusableSlide {
    pub id: String,
    /// `slide` or `announcement`.
    pub kind: String,
    pub title: String,
    pub body: String,
    pub link: Option<String>,
    pub background_media_id: Option<String>,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ReusableSlideInput {
    pub kind: String,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub link: Option<String>,
    #[serde(default)]
    pub background_media_id: Option<String>,
}

impl ContentDb {
    /// Reusable slides by title/body, or all by title.
    pub fn list_reusable_slides(
        &self,
        query: Option<&str>,
        limit: usize,
    ) -> Result<Vec<ReusableSlide>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM reusable_slides WHERE (?1 = '' OR instr(lower(title || ' ' || body), lower(?1)) > 0) ORDER BY title COLLATE NOCASE, id LIMIT ?2"))?;
        let query = query.unwrap_or_default().trim();
        let rows = stmt.query_map(
            params![query, i64::try_from(limit.min(5000)).unwrap_or(5000)],
            row_to_slide,
        )?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn get_reusable_slide(&self, id: &str) -> Result<Option<ReusableSlide>> {
        let conn = self.lock()?;
        load_slide(&conn, id)
    }

    pub fn create_reusable_slide(&self, input: &ReusableSlideInput) -> Result<ReusableSlide> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        validate_input(&tx, input)?;
        let id = new_id();
        let (title, body, link, background) = normalized_input(input);
        tx.execute(
            "INSERT INTO reusable_slides (id, kind, title, body, link, background_media_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, input.kind.trim(), title, body, link, background],
        )?;
        audit(
            &tx,
            "reusable_slide",
            &id,
            "create",
            &serde_json::json!({ "title": title, "kind": input.kind.trim() }),
        )?;
        let saved = load_slide(&tx, &id)?.ok_or_else(|| ContentError::NotFound(id.clone()))?;
        tx.commit()?;
        Ok(saved)
    }

    /// Update only the reusable source. Existing service occurrences retain their copied payload.
    pub fn update_reusable_slide(
        &self,
        id: &str,
        expected_revision: i64,
        input: &ReusableSlideInput,
    ) -> Result<ReusableSlide> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        check_slide_revision(&tx, id, expected_revision)?;
        validate_input(&tx, input)?;
        let (title, body, link, background) = normalized_input(input);
        tx.execute(
            "UPDATE reusable_slides SET kind = ?2, title = ?3, body = ?4, link = ?5, background_media_id = ?6, revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
            params![id, input.kind.trim(), title, body, link, background],
        )?;
        audit(
            &tx,
            "reusable_slide",
            id,
            "update",
            &serde_json::json!({ "title": title, "kind": input.kind.trim() }),
        )?;
        let saved = load_slide(&tx, id)?.ok_or_else(|| ContentError::NotFound(id.to_string()))?;
        tx.commit()?;
        Ok(saved)
    }

    /// Refuse removal while the current saved services still link to this source.
    pub fn delete_reusable_slide(&self, id: &str, expected_revision: i64) -> Result<()> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        check_slide_revision(&tx, id, expected_revision)?;
        let in_use = services_using_slide(&tx, id)?;
        if !in_use.is_empty() {
            return Err(ContentError::InUse { titles: in_use });
        }
        tx.execute("DELETE FROM reusable_slides WHERE id = ?1", params![id])?;
        audit(
            &tx,
            "reusable_slide",
            id,
            "delete",
            &serde_json::Value::Null,
        )?;
        tx.commit()?;
        Ok(())
    }
}

const COLUMNS: &str =
    "id, kind, title, body, link, background_media_id, revision, created_at, updated_at";

fn row_to_slide(r: &rusqlite::Row<'_>) -> rusqlite::Result<ReusableSlide> {
    Ok(ReusableSlide {
        id: r.get(0)?,
        kind: r.get(1)?,
        title: r.get(2)?,
        body: r.get(3)?,
        link: r.get(4)?,
        background_media_id: r.get(5)?,
        revision: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

fn load_slide(conn: &Connection, id: &str) -> Result<Option<ReusableSlide>> {
    Ok(conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM reusable_slides WHERE id = ?1"),
            params![id],
            row_to_slide,
        )
        .optional()?)
}

fn check_slide_revision(tx: &Transaction<'_>, id: &str, expected: i64) -> Result<()> {
    let actual: Option<i64> = tx
        .query_row(
            "SELECT revision FROM reusable_slides WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()?;
    match actual {
        None => Err(ContentError::NotFound(id.to_string())),
        Some(actual) if actual != expected => Err(ContentError::Conflict { expected, actual }),
        Some(_) => Ok(()),
    }
}

fn normalized_input(
    input: &ReusableSlideInput,
) -> (String, String, Option<String>, Option<String>) {
    (
        input.title.trim().to_string(),
        input.body.trim().to_string(),
        input
            .link
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .and_then(|s| Url::parse(s).ok().map(|u| u.to_string())),
        input
            .background_media_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
    )
}

fn validate_input(conn: &Connection, input: &ReusableSlideInput) -> Result<()> {
    let invalid = |message: String| Err(ContentError::Invalid(message));
    if !["slide", "announcement"].contains(&input.kind.trim()) {
        return invalid("slide kind must be slide or announcement".into());
    }
    let title = input.title.trim();
    let body = input.body.trim();
    let link = input
        .link
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if title.chars().count() > crate::MAX_TITLE {
        return invalid(format!(
            "slide title cannot exceed {} characters",
            crate::MAX_TITLE
        ));
    }
    if body.chars().count() > MAX_SLIDE_BODY {
        return invalid(format!(
            "slide text cannot exceed {MAX_SLIDE_BODY} characters"
        ));
    }
    if title.is_empty() && body.is_empty() && link.is_none() {
        return invalid("a slide needs a title, text or link".into());
    }
    if let Some(raw) = link {
        if raw.len() > 300 {
            return invalid("slide link cannot exceed 300 characters".into());
        }
        let Ok(url) = Url::parse(raw) else {
            return invalid("slide link must be a full http(s) address".into());
        };
        if !["http", "https"].contains(&url.scheme())
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return invalid("slide link must be a safe http(s) address without credentials".into());
        }
    }
    if let Some(id) = input
        .background_media_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if !is_valid_id(id) {
            return invalid("invalid background media id".into());
        }
        let kind: Option<String> = conn
            .query_row(
                "SELECT kind FROM media_assets WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .optional()?;
        if !matches!(kind.as_deref(), Some("image" | "video")) {
            return invalid("slide background must be an imported picture or video".into());
        }
    }
    Ok(())
}

fn services_using_slide(conn: &Connection, id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT p.title FROM program_items i JOIN programs p ON p.id = i.program_id
         WHERE i.kind = 'slide' AND CASE WHEN json_valid(i.payload) THEN json_extract(i.payload, '$.source_asset_id') END = ?1 ORDER BY p.title COLLATE NOCASE",
    )?;
    let rows = stmt.query_map(params![id], |r| r.get(0))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

#[cfg(test)]
mod tests {
    use crate::{ContentDb, ContentError, ItemInput, ReusableSlideInput};

    fn slide(title: &str, body: &str) -> ReusableSlideInput {
        ReusableSlideInput {
            kind: "slide".into(),
            title: title.into(),
            body: body.into(),
            link: None,
            background_media_id: None,
        }
    }

    #[test]
    fn reusable_slides_create_search_update_with_revision_and_audit() {
        let db = ContentDb::open_in_memory().unwrap();
        assert!(db.list_reusable_slides(None, 50).unwrap().is_empty());

        let created = db
            .create_reusable_slide(&slide("Welcome", "Glad you are here"))
            .unwrap();
        assert_eq!(created.revision, 1);
        assert_eq!(
            db.get_reusable_slide(&created.id).unwrap().unwrap(),
            created
        );
        assert_eq!(
            db.list_reusable_slides(Some("glad"), 50).unwrap()[0].id,
            created.id
        );

        let updated = db
            .update_reusable_slide(&created.id, 1, &slide("Welcome team", "Sunday gathering"))
            .unwrap();
        assert_eq!(updated.revision, 2);
        assert_eq!(updated.title, "Welcome team");
        assert!(matches!(
            db.update_reusable_slide(&created.id, 1, &slide("Stale", "Edit")),
            Err(ContentError::Conflict {
                expected: 1,
                actual: 2
            })
        ));
        assert_eq!(
            db.audit_events("reusable_slide", &created.id)
                .unwrap()
                .iter()
                .map(|e| e.action.as_str())
                .collect::<Vec<_>>(),
            ["create", "update"]
        );
    }

    #[test]
    fn invalid_reusable_slide_content_is_rejected() {
        let db = ContentDb::open_in_memory().unwrap();
        assert!(matches!(
            db.create_reusable_slide(&slide("", "")),
            Err(ContentError::Invalid(_))
        ));
        let mut bad_link = slide("Giving", "Visit this page");
        bad_link.link = Some("javascript:alert(1)".into());
        assert!(matches!(
            db.create_reusable_slide(&bad_link),
            Err(ContentError::Invalid(_))
        ));
    }

    #[test]
    fn cannot_remove_reusable_slide_still_used_by_a_saved_service() {
        let db = ContentDb::open_in_memory().unwrap();
        let source = db
            .create_reusable_slide(&slide("Offering", "Give as the Lord leads"))
            .unwrap();
        let programs = ["Sunday 9am", "Sunday 11am"]
            .map(|title| {
                let program = db.create_program(title, None).unwrap();
                let item = ItemInput {
                    kind: "slide".into(),
                    reference: "Offering".into(),
                    payload: Some(
                        serde_json::json!({
                            "title": "Offering",
                            "body": "Give as the Lord leads",
                            "source_asset_id": source.id,
                            "source_revision": source.revision,
                        })
                        .to_string(),
                    ),
                    ..ItemInput::default()
                };
                db.replace_items(&program.id, program.revision, &[item])
                    .unwrap();
                program.id
            });

        let revised = db
            .update_reusable_slide(
                &source.id,
                source.revision,
                &slide("Offering revised", "New source wording"),
            )
            .unwrap();
        for program_id in &programs {
            let service = db.get_program(program_id).unwrap().unwrap();
            let payload: serde_json::Value =
                serde_json::from_str(service.items[0].payload.as_deref().unwrap()).unwrap();
            assert_eq!(payload["body"], "Give as the Lord leads");
            assert_eq!(payload["source_revision"], 1);
        }

        assert!(matches!(
            db.delete_reusable_slide(&source.id, revised.revision),
            Err(ContentError::InUse { titles })
                if titles == ["Sunday 11am", "Sunday 9am"]
        ));
    }

    #[test]
    fn background_media_cannot_be_removed_while_a_reusable_slide_uses_it() {
        let db = ContentDb::open_in_memory().unwrap();
        let media = db
            .register_media(&crate::MediaInput {
                kind: "image".into(),
                name: "Blue background".into(),
                file: "background.png".into(),
                hash: "ab".repeat(32),
                size: 1,
                mime: "image/png".into(),
                width: None,
                height: None,
                duration_ms: None,
                source: "local".into(),
                source_ref: String::new(),
                original_path: String::new(),
            })
            .unwrap();
        let mut input = slide("Welcome", "Good morning");
        input.background_media_id = Some(media.id.clone());
        db.create_reusable_slide(&input).unwrap();
        assert!(
            matches!(db.delete_media(&media.id), Err(ContentError::InUse { titles }) if titles.iter().any(|title| title.contains("Welcome")))
        );
    }
}
