//! Song attachments (migration 0009): chord charts and sheet music as media
//! assets linked to a song. The files live in the media folder like
//! pictures; this is only the link.

use rusqlite::params;

use crate::{audit, ContentDb, ContentError, MediaAsset, Result};

impl ContentDb {
    pub fn list_song_attachments(&self, song_id: &str) -> Result<Vec<MediaAsset>> {
        let conn = self.lock()?;
        let mut st = conn.prepare(
            "SELECT m.id, m.kind, m.name, m.file, m.hash, m.size, m.mime, m.width, m.height, m.duration_ms, m.source, m.source_ref, m.original_path, m.created_at
             FROM song_attachments a JOIN media_assets m ON m.id = a.media_id
             WHERE a.song_id = ?1 ORDER BY a.position, m.name",
        )?;
        let v = st
            .query_map(params![song_id], |r| {
                Ok(MediaAsset {
                    id: r.get(0)?, kind: r.get(1)?, name: r.get(2)?, file: r.get(3)?, hash: r.get(4)?, size: r.get(5)?, mime: r.get(6)?,
                    width: r.get(7)?, height: r.get(8)?, duration_ms: r.get(9)?, source: r.get(10)?, source_ref: r.get(11)?, original_path: r.get(12)?, created_at: r.get(13)?,
                })
            })?
            .collect::<std::result::Result<_, _>>()?;
        Ok(v)
    }

    /// Links an existing asset to a song; a second call is a no-op.
    pub fn add_song_attachment(&self, song_id: &str, media_id: &str) -> Result<Vec<MediaAsset>> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let song_exists: i64 = tx.query_row("SELECT COUNT(*) FROM songs WHERE id = ?1", params![song_id], |r| r.get(0))?;
        if song_exists == 0 {
            return Err(ContentError::NotFound(format!("song {song_id}")));
        }
        let media_exists: i64 = tx.query_row("SELECT COUNT(*) FROM media_assets WHERE id = ?1", params![media_id], |r| r.get(0))?;
        if media_exists == 0 {
            return Err(ContentError::NotFound(format!("file {media_id}")));
        }
        tx.execute(
            "INSERT OR IGNORE INTO song_attachments (song_id, media_id, position)
             VALUES (?1, ?2, (SELECT COALESCE(MAX(position), -1) + 1 FROM song_attachments WHERE song_id = ?1))",
            params![song_id, media_id],
        )?;
        audit(&tx, "song", song_id, "attach", &serde_json::json!({ "media_id": media_id }))?;
        tx.commit()?;
        drop(conn);
        self.list_song_attachments(song_id)
    }

    pub fn remove_song_attachment(&self, song_id: &str, media_id: &str) -> Result<Vec<MediaAsset>> {
        {
            let mut conn = self.lock()?;
            let tx = conn.transaction()?;
            tx.execute("DELETE FROM song_attachments WHERE song_id = ?1 AND media_id = ?2", params![song_id, media_id])?;
            audit(&tx, "song", song_id, "detach", &serde_json::json!({ "media_id": media_id }))?;
            tx.commit()?;
        }
        self.list_song_attachments(song_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{MediaInput, SongInput};

    fn song() -> SongInput {
        serde_json::from_value(serde_json::json!({
            "title": "Amazing Grace", "primary_language": "en",
            "sections": [{ "kind": "verse", "label": "Verse 1", "texts": { "en": "Amazing grace" } }],
            "arrangements": [], "numbers": []
        }))
        .unwrap()
    }

    fn doc(db: &ContentDb, name: &str, hash: &str) -> MediaAsset {
        db.register_media(&MediaInput {
            kind: "document".into(), name: name.into(), file: format!("{hash}.pdf"), hash: hash.into(), size: 3, mime: "application/pdf".into(),
            width: None, height: None, duration_ms: None, source: "local".into(), source_ref: String::new(), original_path: String::new(),
        })
        .unwrap()
    }

    #[test]
    fn attachments_link_files_to_a_song_and_follow_deletes() {
        let db = ContentDb::open_in_memory().unwrap();
        let s = db.create_song(&song()).unwrap();
        let chart = doc(&db, "Amazing Grace chords.pdf", &"a".repeat(64));
        let sheet = doc(&db, "Amazing Grace sheet.pdf", &"b".repeat(64));
        assert_eq!(db.add_song_attachment(&s.song.id, &chart.id).unwrap().len(), 1);
        assert_eq!(db.add_song_attachment(&s.song.id, &chart.id).unwrap().len(), 1, "second add is a no-op");
        let both = db.add_song_attachment(&s.song.id, &sheet.id).unwrap();
        assert_eq!(both.iter().map(|m| m.name.as_str()).collect::<Vec<_>>(), vec!["Amazing Grace chords.pdf", "Amazing Grace sheet.pdf"]);
        assert!(matches!(db.add_song_attachment("nope", &chart.id), Err(ContentError::NotFound(_))));
        assert!(matches!(db.add_song_attachment(&s.song.id, "nope"), Err(ContentError::NotFound(_))));
        assert_eq!(db.remove_song_attachment(&s.song.id, &sheet.id).unwrap().len(), 1);
        // Deleting the file drops the link; deleting the song drops the rest.
        db.delete_media(&chart.id).unwrap();
        assert_eq!(db.list_song_attachments(&s.song.id).unwrap().len(), 0);
        db.add_song_attachment(&s.song.id, &sheet.id).unwrap();
        db.delete_song(&s.song.id, s.song.revision).unwrap();
        let n: i64 = db.lock().unwrap().query_row("SELECT COUNT(*) FROM song_attachments", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }
}
