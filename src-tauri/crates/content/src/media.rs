//! Media assets (migration 0004): the index of imported pictures, video and
//! audio. The app copies files into its media folder and hashes them; this
//! module only keeps the rows, so the index and the folder can be checked
//! against each other.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::{audit, is_valid_id, new_id, ContentDb, ContentError, Result};

pub const MEDIA_KINDS: &[&str] = &["image", "video", "audio", "document"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MediaAsset {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub file: String,
    pub hash: String,
    pub size: i64,
    pub mime: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub source: String,
    pub source_ref: String,
    pub original_path: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MediaInput {
    pub kind: String,
    pub name: String,
    pub file: String,
    pub hash: String,
    pub size: i64,
    pub mime: String,
    #[serde(default)]
    pub width: Option<i64>,
    #[serde(default)]
    pub height: Option<i64>,
    #[serde(default)]
    pub duration_ms: Option<i64>,
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default)]
    pub source_ref: String,
    #[serde(default)]
    pub original_path: String,
}

fn default_source() -> String {
    "local".into()
}

/// Payload of a `kind = 'image'` program item.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImageItemPayload {
    pub media_id: String,
    #[serde(default)]
    pub fit: Option<String>,
}

/// Payload of a `kind = 'audio'` service cue. The selected output belongs to this host only.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct AudioItemPayload {
    pub media_id: String,
    #[serde(default)]
    output_device_id: Option<String>,
    #[serde(default)]
    volume: Option<f64>,
    #[serde(default, rename = "loop")]
    loop_track: Option<bool>,
    #[serde(default)]
    fade_in_ms: Option<u32>,
    #[serde(default)]
    fade_out_ms: Option<u32>,
}

const MAX_AUDIO_FADE_MS: u32 = 30_000;

impl ContentDb {
    pub fn list_media(&self) -> Result<Vec<MediaAsset>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(&format!("SELECT {COLS} FROM media_assets ORDER BY created_at DESC, name"))?;
        let rows = stmt.query_map([], row_to_asset)?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }

    pub fn get_media(&self, id: &str) -> Result<Option<MediaAsset>> {
        let conn = self.lock()?;
        load_media(&conn, id)
    }

    pub fn find_media_by_hash(&self, hash: &str) -> Result<Option<MediaAsset>> {
        let conn = self.lock()?;
        Ok(conn
            .query_row(&format!("SELECT {COLS} FROM media_assets WHERE hash = ?1"), params![hash], row_to_asset)
            .optional()?)
    }

    /// Add a row for a file the app has already copied into its media folder.
    /// The same bytes (hash) registered twice return the existing asset.
    pub fn register_media(&self, input: &MediaInput) -> Result<MediaAsset> {
        validate_media(input)?;
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let existing: Option<String> = tx
            .query_row("SELECT id FROM media_assets WHERE hash = ?1", params![input.hash], |r| r.get(0))
            .optional()?;
        let id = if let Some(id) = existing {
            id
        } else {
            {
                let id = new_id();
                tx.execute(
                    "INSERT INTO media_assets (id, kind, name, file, hash, size, mime, width, height, duration_ms, source, source_ref, original_path)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                    params![
                        id,
                        input.kind.trim(),
                        input.name.trim(),
                        input.file.trim(),
                        input.hash.trim(),
                        input.size,
                        input.mime.trim(),
                        input.width,
                        input.height,
                        input.duration_ms,
                        input.source.trim(),
                        input.source_ref.trim(),
                        input.original_path.trim(),
                    ],
                )?;
                audit(&tx, "media", &id, "import", &serde_json::json!({ "name": input.name.trim(), "kind": input.kind.trim() }))?;
                id
            }
        };
        let asset = load_media(&tx, &id)?.ok_or_else(|| ContentError::NotFound(id.clone()))?;
        tx.commit()?;
        Ok(asset)
    }

    /// Dimensions and duration are measured by the frontend after import.
    pub fn set_media_dimensions(&self, id: &str, width: Option<i64>, height: Option<i64>, duration_ms: Option<i64>) -> Result<MediaAsset> {
        let conn = self.lock()?;
        let n = conn.execute(
            "UPDATE media_assets SET width = ?2, height = ?3, duration_ms = ?4 WHERE id = ?1",
            params![id, width, height, duration_ms],
        )?;
        if n == 0 {
            return Err(ContentError::NotFound(id.to_string()));
        }
        load_media(&conn, id)?.ok_or_else(|| ContentError::NotFound(id.to_string()))
    }

    /// Refused while a saved service shows the picture. Returns the file name
    /// to remove from the media folder.
    pub fn delete_media(&self, id: &str) -> Result<String> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let asset = load_media(&tx, id)?.ok_or_else(|| ContentError::NotFound(id.to_string()))?;
        let used = services_using_media(&tx, id)?;
        if !used.is_empty() {
            return Err(ContentError::InUse { titles: used });
        }
        tx.execute("DELETE FROM media_assets WHERE id = ?1", params![id])?;
        audit(&tx, "media", id, "delete", &serde_json::Value::Null)?;
        tx.commit()?;
        Ok(asset.file)
    }
}

const COLS: &str = "id, kind, name, file, hash, size, mime, width, height, duration_ms, source, source_ref, original_path, created_at";

fn row_to_asset(r: &rusqlite::Row<'_>) -> rusqlite::Result<MediaAsset> {
    Ok(MediaAsset {
        id: r.get(0)?,
        kind: r.get(1)?,
        name: r.get(2)?,
        file: r.get(3)?,
        hash: r.get(4)?,
        size: r.get(5)?,
        mime: r.get(6)?,
        width: r.get(7)?,
        height: r.get(8)?,
        duration_ms: r.get(9)?,
        source: r.get(10)?,
        source_ref: r.get(11)?,
        original_path: r.get(12)?,
        created_at: r.get(13)?,
    })
}

fn load_media(conn: &Connection, id: &str) -> Result<Option<MediaAsset>> {
    Ok(conn
        .query_row(&format!("SELECT {COLS} FROM media_assets WHERE id = ?1"), params![id], row_to_asset)
        .optional()?)
}

fn services_using_media(conn: &Connection, media_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT p.title FROM program_items i JOIN programs p ON p.id = i.program_id
         WHERE (i.kind IN ('image', 'audio') AND json_extract(i.payload, '$.media_id') = ?1)
            OR json_extract(i.payload, '$.background_media_id') = ?1
         UNION
         SELECT 'the song ' || s.title FROM song_attachments a JOIN songs s ON s.id = a.song_id WHERE a.media_id = ?1
         UNION
         SELECT p.title || ' (approved design)' FROM approved_design_media d JOIN programs p ON p.id = d.program_id WHERE d.media_id = ?1
         UNION
         SELECT 'slide or announcement ' || title FROM reusable_slides WHERE background_media_id = ?1
         ORDER BY 1",
    )?;
    let rows = stmt.query_map(params![media_id], |r| r.get(0))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub(crate) fn validate_media(m: &MediaInput) -> Result<()> {
    let bad = |s: String| Err(ContentError::Invalid(s));
    if !MEDIA_KINDS.contains(&m.kind.trim()) {
        return bad(format!("unknown media kind {:?}", m.kind));
    }
    if m.name.trim().is_empty() || m.name.chars().count() > crate::MAX_TITLE {
        return bad("media name must be 1–200 characters".into());
    }
    let file = m.file.trim();
    if file.is_empty() || file.contains('/') || file.contains('\\') || file.contains("..") {
        return bad(format!("media file must be a bare file name, got {file:?}"));
    }
    let hash = m.hash.trim();
    if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return bad("media hash must be a SHA-256 hex string".into());
    }
    if m.size < 0 {
        return bad("media size cannot be negative".into());
    }
    if m.mime.trim().is_empty() || !m.mime.contains('/') {
        return bad(format!("bad mime type {:?}", m.mime));
    }
    Ok(())
}

/// Called from `validate_items` for `kind = 'image'`.
pub(crate) fn validate_image_payload(i: usize, payload: Option<&str>) -> Result<ImageItemPayload> {
    let Some(raw) = payload else {
        return Err(ContentError::Invalid(format!("item {i}: image items need a payload")));
    };
    let p: ImageItemPayload = serde_json::from_str(raw).map_err(|e| ContentError::Invalid(format!("item {i}: bad image payload: {e}")))?;
    if !is_valid_id(&p.media_id) {
        return Err(ContentError::Invalid(format!("item {i}: invalid media id")));
    }
    if p.fit.as_deref().is_some_and(|f| !["cover", "contain", "stretch"].contains(&f)) {
        return Err(ContentError::Invalid(format!("item {i}: fit must be cover, contain or stretch")));
    }
    Ok(p)
}

/// Called from `validate_items` for `kind = 'audio'`.
pub(crate) fn validate_audio_payload(i: usize, payload: Option<&str>) -> Result<AudioItemPayload> {
    let Some(raw) = payload else {
        return Err(ContentError::Invalid(format!("item {i}: audio cues need a payload")));
    };
    let p: AudioItemPayload = serde_json::from_str(raw).map_err(|e| ContentError::Invalid(format!("item {i}: bad audio payload: {e}")))?;
    if !is_valid_id(&p.media_id) {
        return Err(ContentError::Invalid(format!("item {i}: invalid audio media id")));
    }
    if p.output_device_id.as_deref().is_some_and(|id| id.chars().count() > 1024 || id.chars().any(char::is_control)) {
        return Err(ContentError::Invalid(format!("item {i}: invalid audio output device id")));
    }
    if p.volume.is_some_and(|v| !v.is_finite() || !(0.0..=1.0).contains(&v)) {
        return Err(ContentError::Invalid(format!("item {i}: audio volume must be between 0 and 1")));
    }
    if p.fade_in_ms.is_some_and(|ms| ms > MAX_AUDIO_FADE_MS) || p.fade_out_ms.is_some_and(|ms| ms > MAX_AUDIO_FADE_MS) {
        return Err(ContentError::Invalid(format!("item {i}: audio fades must be between 0 and {MAX_AUDIO_FADE_MS} milliseconds")));
    }
    let _ = p.loop_track;
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ItemInput;

    fn picture(name: &str, hash_seed: u8) -> MediaInput {
        MediaInput {
            kind: "image".into(),
            name: name.into(),
            file: format!("{}.png", "a".repeat(64)),
            hash: format!("{hash_seed:02x}").repeat(32),
            size: 1234,
            mime: "image/png".into(),
            width: None,
            height: None,
            duration_ms: None,
            source: "local".into(),
            source_ref: String::new(),
            original_path: "/Users/x/Pictures/welcome.png".into(),
        }
    }

    #[test]
    fn register_dedupes_by_hash_and_lists_newest_first() {
        let db = ContentDb::open_in_memory().unwrap();
        let a = db.register_media(&picture("Welcome", 1)).unwrap();
        let again = db.register_media(&MediaInput { name: "Welcome copy".into(), ..picture("x", 1) }).unwrap();
        assert_eq!(a.id, again.id, "same bytes → same asset");
        assert_eq!(again.name, "Welcome", "the first import's name is kept");
        let b = db.register_media(&picture("Offering", 2)).unwrap();
        assert_eq!(db.list_media().unwrap().len(), 2);
        assert_eq!(db.find_media_by_hash(&b.hash).unwrap().unwrap().id, b.id);
        let sized = db.set_media_dimensions(&a.id, Some(1920), Some(1080), None).unwrap();
        assert_eq!((sized.width, sized.height), (Some(1920), Some(1080)));
        assert!(matches!(db.set_media_dimensions("nope", None, None, None), Err(ContentError::NotFound(_))));
        let events = db.audit_events("media", &a.id).unwrap();
        assert_eq!(events.iter().map(|e| e.action.as_str()).collect::<Vec<_>>(), vec!["import"]);
    }

    #[test]
    fn delete_refused_while_a_service_shows_the_picture() {
        let db = ContentDb::open_in_memory().unwrap();
        let a = db.register_media(&picture("Welcome", 3)).unwrap();
        let p = db.create_program("Sunday", None).unwrap();
        let item = ItemInput { kind: "image".into(), reference: "Welcome".into(), payload: Some(format!(r#"{{"media_id":"{}","fit":"cover"}}"#, a.id)), ..ItemInput::default() };
        db.replace_items(&p.id, 1, &[item]).unwrap();
        match db.delete_media(&a.id).unwrap_err() {
            ContentError::InUse { titles } => assert_eq!(titles, vec!["Sunday"]),
            other => panic!("{other:?}"),
        }
        let audio = ItemInput { kind: "audio".into(), reference: "Walk-in".into(), payload: Some(format!(r#"{{"media_id":"{}","volume":0.8,"loop":true}}"#, a.id)), ..ItemInput::default() };
        db.replace_items(&p.id, 2, &[audio]).unwrap();
        assert!(matches!(db.delete_media(&a.id), Err(ContentError::InUse { .. })), "audio cues also keep their local file in use");
        // A background picture on any item counts as use too.
        db.replace_items(&p.id, 3, &[ItemInput { kind: "verse".into(), reference: "John 3:16".into(), book_number: Some(43), chapter: Some(3), verse: Some(16), payload: Some(format!("{{\"background_media_id\":\"{}\"}}", a.id)), ..Default::default() }]).unwrap();
        assert!(matches!(db.delete_media(&a.id), Err(ContentError::InUse { .. })));
        db.replace_items(&p.id, 4, &[]).unwrap();
        assert_eq!(db.delete_media(&a.id).unwrap(), a.file);
        assert!(db.get_media(&a.id).unwrap().is_none());
        // Image items need a well-formed payload with a known fit.
        for bad in [None, Some("nope".to_string()), Some(r#"{"media_id":"x","fit":"zoom"}"#.to_string()), Some(r#"{"media_id":"../x"}"#.to_string())] {
            let it = ItemInput { kind: "image".into(), reference: "x".into(), payload: bad, ..ItemInput::default() };
            assert!(matches!(db.replace_items(&p.id, 5, std::slice::from_ref(&it)), Err(ContentError::Invalid(_))));
        }
    }

    #[test]
    fn audio_payload_validates_local_playback_settings() {
        let valid = r#"{"media_id":"track-1","output_device_id":"usb-output","volume":0.6,"loop":true,"fade_in_ms":500,"fade_out_ms":30000}"#;
        assert!(validate_audio_payload(0, Some(valid)).is_ok());

        for bad in [
            None,
            Some("not-json"),
            Some(r#"{"media_id":"../track"}"#),
            Some(r#"{"media_id":"track-1","output_device_id":"\u0000"}"#),
            Some(r#"{"media_id":"track-1","volume":1.01}"#),
            Some(r#"{"media_id":"track-1","fade_in_ms":30001}"#),
        ] {
            assert!(validate_audio_payload(0, bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn approved_scene_media_cannot_be_deleted_while_its_release_is_retained() {
        let db = ContentDb::open_in_memory().unwrap();
        let asset = db.register_media(&picture("Backdrop", 9)).unwrap();
        let program = db.create_program("Sunday", None).unwrap();
        db.approve_program_with_designs(
            &program.id,
            program.revision,
            &crate::ApprovedDesignSnapshot {
                version: 1,
                scenes: serde_json::json!({ "welcome": { "scene": { "id": "welcome" } } }),
                looks: serde_json::json!({}),
                media_ids: vec![asset.id.clone()],
            },
        ).unwrap();

        match db.delete_media(&asset.id).unwrap_err() {
            ContentError::InUse { titles } => assert_eq!(titles, vec!["Sunday (approved design)"]),
            other => panic!("{other:?}"),
        }
        db.delete_program(&program.id, program.revision).unwrap();
        assert_eq!(db.delete_media(&asset.id).unwrap(), asset.file);
    }

    #[test]
    fn validation() {
        let db = ContentDb::open_in_memory().unwrap();
        for (name, input) in [
            ("kind", MediaInput { kind: "gif".into(), ..picture("x", 4) }),
            ("path in file", MediaInput { file: "../x.png".into(), ..picture("x", 4) }),
            ("short hash", MediaInput { hash: "abc".into(), ..picture("x", 4) }),
            ("mime", MediaInput { mime: "png".into(), ..picture("x", 4) }),
            ("name", MediaInput { name: " ".into(), ..picture("x", 4) }),
        ] {
            assert!(matches!(db.register_media(&input), Err(ContentError::Invalid(_))), "{name}");
        }
        assert_eq!(db.list_media().unwrap().len(), 0);
    }
}
