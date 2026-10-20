//! A portable service package: one service with the songs and pictures it
//! uses, as a single JSON file with a checksum. Made at home, opened at
//! church, no internet involved.

use std::collections::HashMap;
use std::path::Path;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{ContentDb, ContentError, ImportMode, ItemInput, MediaInput, ProgramWithItems, Result, SongExport};

pub const PACKAGE_VERSION: u32 = 1;

/// The file on disk. `payload` is the JSON of [`PackagePayload`] as a string
/// so the checksum is over exact bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServicePackage {
    pub version: u32,
    pub payload: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackagePayload {
    pub title: String,
    pub service_date: Option<String>,
    pub items: Vec<ItemInput>,
    pub songs: SongExport,
    pub media: Vec<PackagedMedia>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackagedMedia {
    /// The id the items in this package refer to.
    pub id: String,
    pub kind: String,
    pub name: String,
    pub file: String,
    pub hash: String,
    pub mime: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    /// The bytes, base64.
    pub data: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PackageReport {
    pub program: ProgramWithItems,
    pub songs_added: usize,
    pub songs_skipped: usize,
    pub media_added: usize,
    pub media_reused: usize,
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn payload_ids(payload: Option<&str>, key: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(payload?).ok()?;
    v.get(key)?.as_str().map(str::to_owned)
}

fn rewrite_payload(payload: Option<&str>, key: &str, map: &HashMap<String, String>) -> Option<String> {
    let raw = payload?;
    let mut v: serde_json::Value = serde_json::from_str(raw).ok()?;
    let old = v.get(key)?.as_str()?.to_owned();
    let new = map.get(&old)?;
    v[key] = serde_json::Value::String(new.clone());
    Some(v.to_string())
}

impl ContentDb {
    /// Everything needed to present `program_id` on another computer.
    /// Fails if a picture the service uses is missing from `media_dir`.
    pub fn export_service_package(&self, program_id: &str, media_dir: &Path) -> Result<ServicePackage> {
        let p = self.get_program(program_id)?.ok_or_else(|| ContentError::NotFound(program_id.into()))?;
        let items: Vec<ItemInput> = p
            .items
            .iter()
            .map(|i| ItemInput {
                id: None,
                kind: i.kind.clone(),
                reference: i.reference.clone(),
                book_number: i.book_number,
                chapter: i.chapter,
                verse: i.verse,
                translation: i.translation.clone(),
                secondary_translation: i.secondary_translation.clone(),
                notes: i.notes.clone(),
                payload: i.payload.clone(),
            })
            .collect();
        let mut song_ids: Vec<String> = items.iter().filter_map(|i| payload_ids(i.payload.as_deref(), "song_id")).collect();
        song_ids.sort();
        song_ids.dedup();
        let songs = self.export_songs(Some(&song_ids))?;
        let mut media_ids: Vec<String> = items
            .iter()
            .flat_map(|i| [payload_ids(i.payload.as_deref(), "media_id"), payload_ids(i.payload.as_deref(), "background_media_id")])
            .flatten()
            .collect();
        media_ids.sort();
        media_ids.dedup();
        let mut media = Vec::new();
        for id in media_ids {
            let a = self.get_media(&id)?.ok_or_else(|| ContentError::NotFound(format!("picture {id}")))?;
            let bytes = std::fs::read(media_dir.join(&a.file)).map_err(|e| ContentError::Invalid(format!("picture \"{}\" is missing from this computer ({e})", a.name)))?;
            media.push(PackagedMedia {
                id: a.id, kind: a.kind, name: a.name, file: a.file, hash: a.hash, mime: a.mime,
                width: a.width, height: a.height, duration_ms: a.duration_ms, data: B64.encode(bytes),
            });
        }
        let payload = serde_json::to_string(&PackagePayload { title: p.program.title, service_date: p.program.service_date, items, songs, media })
            .map_err(|e| ContentError::Invalid(e.to_string()))?;
        let sha256 = sha256_hex(payload.as_bytes());
        Ok(ServicePackage { version: PACKAGE_VERSION, payload, sha256 })
    }

    /// Creates a new service from a package. Songs already here (same id)
    /// are kept as they are; pictures are matched by content hash. Nothing
    /// is written when the checksum or a picture's hash does not match.
    pub fn import_service_package(&self, pkg: &ServicePackage, media_dir: &Path) -> Result<PackageReport> {
        if pkg.version != PACKAGE_VERSION {
            return Err(ContentError::Invalid(format!("this file is a version {} package; this app reads version {PACKAGE_VERSION}", pkg.version)));
        }
        if sha256_hex(pkg.payload.as_bytes()) != pkg.sha256 {
            return Err(ContentError::Invalid("the file is damaged (checksum does not match)".into()));
        }
        let payload: PackagePayload = serde_json::from_str(&pkg.payload).map_err(|e| ContentError::Invalid(format!("unreadable package: {e}")))?;
        // Verify every picture before touching anything.
        let mut decoded = Vec::with_capacity(payload.media.len());
        for m in &payload.media {
            let bytes = B64.decode(&m.data).map_err(|_| ContentError::Invalid(format!("picture \"{}\" is damaged", m.name)))?;
            if sha256_hex(&bytes) != m.hash {
                return Err(ContentError::Invalid(format!("picture \"{}\" is damaged (hash does not match)", m.name)));
            }
            if !m.file.starts_with(&m.hash) || m.file.contains('/') || m.file.contains('\\') || m.file.contains("..") {
                return Err(ContentError::Invalid(format!("picture \"{}\" has an unexpected file name", m.name)));
            }
            decoded.push(bytes);
        }
        let songs = self.import_songs(&payload.songs, ImportMode::Skip)?;
        // Arrangement ids are not stable across import (a song's generated
        // Default has none), so match by position, else fall back to the
        // song's default order rather than failing the whole service.
        let mut arrangement_map = HashMap::new();
        for packaged in &payload.songs.songs {
            let Some(cur) = self.get_song(&packaged.song.id)? else { continue };
            let fallback = cur.arrangements.iter().find(|a| a.is_default).or(cur.arrangements.first()).map(|a| a.id.clone());
            for (pos, old) in packaged.arrangements.iter().enumerate() {
                let new = cur.arrangements.get(pos).map(|a| a.id.clone()).or_else(|| fallback.clone());
                if let Some(new) = new {
                    arrangement_map.insert(old.id.clone(), new);
                }
            }
        }
        let mut media_map = HashMap::new();
        let (mut media_added, mut media_reused) = (0, 0);
        for (m, bytes) in payload.media.iter().zip(decoded) {
            let id = if let Some(existing) = self.find_media_by_hash(&m.hash)? {
                media_reused += 1;
                existing.id
            } else {
                std::fs::create_dir_all(media_dir).map_err(|e| ContentError::Invalid(e.to_string()))?;
                let dest = media_dir.join(&m.file);
                if !dest.exists() {
                    std::fs::write(&dest, &bytes).map_err(|e| ContentError::Invalid(format!("could not save picture \"{}\": {e}", m.name)))?;
                }
                media_added += 1;
                self.register_media(&MediaInput {
                    kind: m.kind.clone(), name: m.name.clone(), file: m.file.clone(), hash: m.hash.clone(), size: i64::try_from(bytes.len()).map_err(|_| ContentError::Invalid("picture too large".into()))?, mime: m.mime.clone(),
                    width: m.width, height: m.height, duration_ms: m.duration_ms, source: "package".into(), source_ref: String::new(), original_path: String::new(),
                })?.id
            };
            media_map.insert(m.id.clone(), id);
        }
        let items: Vec<ItemInput> = payload
            .items
            .into_iter()
            .map(|mut i| {
                for (key, map) in [("media_id", &media_map), ("background_media_id", &media_map), ("arrangement_id", &arrangement_map)] {
                    if let Some(p) = rewrite_payload(i.payload.as_deref(), key, map) {
                        i.payload = Some(p);
                    }
                }
                i.id = None;
                i
            })
            .collect();
        let program = self.create_program(&payload.title, payload.service_date.as_deref())?;
        let program = self.replace_items(&program.id, program.revision, &items)?;
        Ok(PackageReport { program, songs_added: songs.added, songs_skipped: songs.skipped, media_added, media_reused })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SongInput;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("rhema-package-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn song() -> SongInput {
        serde_json::from_value(serde_json::json!({
            "title": "Amazing Grace", "primary_language": "en",
            "sections": [{ "kind": "verse", "label": "Verse 1", "texts": { "en": "Amazing grace" } }],
            "arrangements": [], "numbers": []
        }))
        .unwrap()
    }

    #[test]
    fn package_round_trips_into_a_fresh_database_with_pictures_matched_by_hash() {
        let home = ContentDb::open_in_memory().unwrap();
        let home_media = temp_dir("home");
        let s = home.create_song(&song()).unwrap();
        let bytes = b"not really a png";
        let hash = sha256_hex(bytes);
        std::fs::write(home_media.join(format!("{hash}.png")), bytes).unwrap();
        let pic = home
            .register_media(&MediaInput {
                kind: "image".into(), name: "Welcome.png".into(), file: format!("{hash}.png"), hash: hash.clone(), size: i64::try_from(bytes.len()).unwrap(), mime: "image/png".into(),
                width: Some(2), height: Some(2), duration_ms: None, source: "local".into(), source_ref: String::new(), original_path: String::new(),
            })
            .unwrap();
        let p = home.create_program("Sunday", Some("2026-10-25")).unwrap();
        let items = vec![
            ItemInput { kind: "verse".into(), reference: "John 3:16".into(), book_number: Some(43), chapter: Some(3), verse: Some(16), translation: Some("KJV".into()), ..Default::default() },
            ItemInput { kind: "song".into(), reference: "Amazing Grace".into(), payload: Some(serde_json::json!({ "song_id": s.song.id, "arrangement_id": s.arrangements[0].id, "languages": ["en"], "background_media_id": pic.id }).to_string()), ..Default::default() },
            ItemInput { kind: "image".into(), reference: "Welcome.png".into(), payload: Some(serde_json::json!({ "media_id": pic.id, "fit": "cover" }).to_string()), ..Default::default() },
        ];
        home.replace_items(&p.id, p.revision, &items).unwrap();
        let pkg = home.export_service_package(&p.id, &home_media).unwrap();
        assert_eq!(pkg.version, 1);
        assert_eq!(pkg.sha256, sha256_hex(pkg.payload.as_bytes()));

        // Church laptop: empty database, empty media folder.
        let church = ContentDb::open_in_memory().unwrap();
        let church_media = temp_dir("church");
        let r = church.import_service_package(&pkg, &church_media).unwrap();
        assert_eq!((r.songs_added, r.songs_skipped, r.media_added, r.media_reused), (1, 0, 1, 0));
        assert_eq!(r.program.program.title, "Sunday");
        assert_eq!(r.program.items.len(), 3);
        assert!(church_media.join(format!("{hash}.png")).exists());
        let new_pic = church.find_media_by_hash(&hash).unwrap().unwrap();
        let image_payload: serde_json::Value = serde_json::from_str(r.program.items[2].payload.as_deref().unwrap()).unwrap();
        assert_eq!(image_payload["media_id"], new_pic.id);
        let song_payload: serde_json::Value = serde_json::from_str(r.program.items[1].payload.as_deref().unwrap()).unwrap();
        assert_eq!(song_payload["background_media_id"], new_pic.id);
        assert_eq!(song_payload["song_id"], s.song.id);
        let imported_song = church.get_song(&s.song.id).unwrap().unwrap();
        assert_eq!(song_payload["arrangement_id"], imported_song.arrangements[0].id);
        assert!(church.get_song(&s.song.id).unwrap().is_some());

        // Importing again keeps the song and picture, adds a second service.
        let r2 = church.import_service_package(&pkg, &church_media).unwrap();
        assert_eq!((r2.songs_added, r2.songs_skipped, r2.media_added, r2.media_reused), (0, 1, 0, 1));
        assert_eq!(church.list_programs().unwrap().len(), 2);
    }

    #[test]
    fn damaged_or_foreign_packages_change_nothing() {
        let db = ContentDb::open_in_memory().unwrap();
        let media = temp_dir("damaged");
        let p = db.create_program("Sunday", None).unwrap();
        let good = db.export_service_package(&p.id, &media).unwrap();
        let tampered = ServicePackage { payload: good.payload.replace("Sunday", "Monday"), ..good.clone() };
        assert!(matches!(db.import_service_package(&tampered, &media), Err(ContentError::Invalid(m)) if m.contains("checksum")));
        let future = ServicePackage { version: 2, ..good.clone() };
        assert!(matches!(db.import_service_package(&future, &media), Err(ContentError::Invalid(_))));
        assert_eq!(db.list_programs().unwrap().len(), 1);
        // A picture whose bytes do not match its hash is refused before anything is written.
        let mut payload: PackagePayload = serde_json::from_str(&good.payload).unwrap();
        payload.media.push(PackagedMedia { id: "m".into(), kind: "image".into(), name: "x.png".into(), file: "abc.png".into(), hash: "abc".into(), mime: "image/png".into(), width: None, height: None, duration_ms: None, data: B64.encode(b"bytes") });
        let s = serde_json::to_string(&payload).unwrap();
        let bad_pic = ServicePackage { version: 1, sha256: sha256_hex(s.as_bytes()), payload: s };
        assert!(matches!(db.import_service_package(&bad_pic, &media), Err(ContentError::Invalid(m)) if m.contains("damaged")));
        assert_eq!(db.list_programs().unwrap().len(), 1);
        assert_eq!(db.list_media().unwrap().len(), 0);
    }
}
