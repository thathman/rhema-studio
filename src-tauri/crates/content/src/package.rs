//! A portable service package: one service with the songs and pictures it
//! uses, as a single JSON file with a checksum. Made at home, opened at
//! church, no internet involved.

use std::collections::HashMap;
use std::path::Path;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{ContentDb, ContentError, ImportMode, ItemInput, MediaInput, ProgramWithItems, Result, SongExport, SongWithSections};
use std::collections::HashSet;

/// The newest service-file version this app reads (and writes when a service has phases or groups).
/// Version 1 files (no headers) are still written for plain services so older apps can open them.
pub const PACKAGE_VERSION: u32 = 2;

/// The version a service file is written as: 2 only when it has phase or group headers.
pub fn package_version_for(items: &[ItemInput]) -> u32 {
    if items.iter().any(|i| crate::HEADER_KINDS.contains(&i.kind.trim())) { 2 } else { 1 }
}

/// The file on disk. `payload` is the JSON of [`PackagePayload`] as a string
/// so the checksum is over exact bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServicePackage {
    pub version: u32,
    pub payload: String,
    pub sha256: String,
}

/// Where a service published from a copy belongs: the service it was first
/// published as (its `source_id` on the computer that made it), and how far
/// this computer's revision numbers are from that service's.
#[derive(Debug, Clone, Deserialize)]
pub struct Lineage {
    pub source_id: String,
    /// Added to this computer's revision (and approved revision) to number the file.
    pub revision_offset: i64,
}

impl ServicePackage {
    /// The same service under the identity and numbering it has in the church
    /// folder, so a copy opened on another computer and published again is a
    /// newer version of the same service, not a new service at "v3" (CL-005).
    pub fn with_lineage(&self, lineage: &Lineage) -> Result<ServicePackage> {
        self.renumbered(Some(&lineage.source_id), lineage.revision_offset)
    }

    /// The same content under another source and/or with its revision (and approved revision) moved by `offset`.
    pub fn renumbered(&self, source_id: Option<&str>, offset: i64) -> Result<ServicePackage> {
        let mut p: PackagePayload = serde_json::from_str(&self.payload).map_err(|e| ContentError::Invalid(e.to_string()))?;
        if let Some(id) = source_id {
            p.source_id = Some(id.to_string());
        }
        p.revision = p.revision.map(|r| r + offset);
        p.approved_revision = p.approved_revision.map(|r| r + offset);
        let payload = serde_json::to_string(&p).map_err(|e| ContentError::Invalid(e.to_string()))?;
        let sha256 = sha256_hex(payload.as_bytes());
        Ok(ServicePackage { version: self.version, payload, sha256 })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackagePayload {
    pub title: String,
    pub service_date: Option<String>,
    pub items: Vec<ItemInput>,
    pub songs: SongExport,
    pub media: Vec<PackagedMedia>,
    /// Where it came from (owner decision #72: versioned service packages in a
    /// shared folder). Optional, so older files and older readers still work.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    /// The saved revision of the source service this package is.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<i64>,
    /// The revision approved at the source, and by whom, when it was approved.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approved_revision: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approved_by: Option<String>,
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
    /// Songs already on this computer whose words or orders differ from the file's. This
    /// computer's copy is kept (no silent overwrite, CL-005); the titles are reported.
    #[serde(default)]
    pub songs_differ: Vec<String>,
    pub media_added: usize,
    pub media_reused: usize,
}

/// Same words, sections and orders (ids aside), so nothing in the file is lost by keeping ours.
fn same_song_content(a: &SongWithSections, b: &SongWithSections) -> bool {
    let sections = |s: &SongWithSections| s.sections.iter().map(|x| (x.kind.clone(), x.label.clone(), x.texts.clone())).collect::<Vec<_>>();
    let orders = |s: &SongWithSections| {
        s.arrangements
            .iter()
            .map(|a| (a.name.trim().to_lowercase(), a.sequence.iter().map(|id| s.sections.iter().position(|x| &x.id == id)).collect::<Vec<_>>()))
            .collect::<Vec<_>>()
    };
    a.song.title == b.song.title && sections(a) == sections(b) && orders(a) == orders(b)
}

fn media_input(m: &PackagedMedia, bytes: &[u8]) -> Result<MediaInput> {
    Ok(MediaInput {
        kind: m.kind.clone(), name: m.name.clone(), file: m.file.clone(), hash: m.hash.clone(),
        size: i64::try_from(bytes.len()).map_err(|_| ContentError::Invalid("picture too large".into()))?, mime: m.mime.clone(),
        width: m.width, height: m.height, duration_ms: m.duration_ms, source: "package".into(), source_ref: String::new(), original_path: String::new(),
    })
}

/// SHA-256 of a package payload, as the package's `sha256` holds it.
pub fn package_sha256(bytes: &[u8]) -> String {
    sha256_hex(bytes)
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
        let version = package_version_for(&items);
        let payload = serde_json::to_string(&PackagePayload {
            title: p.program.title,
            service_date: p.program.service_date,
            items,
            songs,
            media,
            source_id: Some(p.program.id),
            revision: Some(p.program.revision),
            approved_revision: p.program.approved_revision,
            approved_by: p.program.approved_by,
        })
            .map_err(|e| ContentError::Invalid(e.to_string()))?;
        let sha256 = sha256_hex(payload.as_bytes());
        Ok(ServicePackage { version, payload, sha256 })
    }

    /// Creates a new service from a package. Songs already here (same id)
    /// are kept as they are; pictures are matched by content hash. Nothing
    /// is written when the checksum or a picture's hash does not match.
    /// Arrangement ids from the file mapped to this computer's (see the comment inside).
    fn arrangement_map(&self, songs: &[SongWithSections]) -> Result<HashMap<String, String>> {
        // Arrangement ids are not always stable across import (a song's generated
        // Default has none): match the same id, then the same name, then the
        // position, else fall back to the song's default order rather than failing.
        let mut arrangement_map = HashMap::new();
        for packaged in songs {
            let Some(cur) = self.get_song(&packaged.song.id)? else { continue };
            let fallback = cur.arrangements.iter().find(|a| a.is_default).or(cur.arrangements.first()).map(|a| a.id.clone());
            for (pos, old) in packaged.arrangements.iter().enumerate() {
                let new = cur
                    .arrangements
                    .iter()
                    .find(|a| a.id == old.id)
                    .or_else(|| cur.arrangements.iter().find(|a| a.name.trim().eq_ignore_ascii_case(old.name.trim())))
                    .or_else(|| cur.arrangements.get(pos))
                    .map(|a| a.id.clone())
                    .or_else(|| fallback.clone());
                if let Some(new) = new {
                    arrangement_map.insert(old.id.clone(), new);
                }
            }
        }
        Ok(arrangement_map)
    }

    pub fn import_service_package(&self, pkg: &ServicePackage, media_dir: &Path) -> Result<PackageReport> {
        if !(1..=PACKAGE_VERSION).contains(&pkg.version) {
            return Err(ContentError::Invalid(format!("this file is a version {} package; this app reads versions 1 to {PACKAGE_VERSION}", pkg.version)));
        }
        if sha256_hex(pkg.payload.as_bytes()) != pkg.sha256 {
            return Err(ContentError::Invalid("the file is damaged (checksum does not match)".into()));
        }
        let payload: PackagePayload = serde_json::from_str(&pkg.payload).map_err(|e| ContentError::Invalid(format!("unreadable package: {e}")))?;
        // Every check that can fail runs here, before anything is written:
        // a tampered file that passes its own checksum must still change nothing.
        crate::validate_items(&payload.items)?;
        let packaged_songs: HashSet<&str> = payload.songs.songs.iter().map(|s| s.song.id.as_str()).collect();
        let packaged_media: HashSet<&str> = payload.media.iter().map(|m| m.id.as_str()).collect();
        for (i, item) in payload.items.iter().enumerate() {
            if let Some(id) = payload_ids(item.payload.as_deref(), "song_id") {
                if !packaged_songs.contains(id.as_str()) {
                    return Err(ContentError::Invalid(format!("item {}: its song is not in the file", i + 1)));
                }
            }
            for key in ["media_id", "background_media_id"] {
                if let Some(id) = payload_ids(item.payload.as_deref(), key) {
                    if !packaged_media.contains(id.as_str()) {
                        return Err(ContentError::Invalid(format!("item {}: its picture is not in the file", i + 1)));
                    }
                }
            }
        }
        let mut decoded = Vec::with_capacity(payload.media.len());
        for m in &payload.media {
            let bytes = B64.decode(&m.data).map_err(|_| ContentError::Invalid(format!("picture \"{}\" is damaged", m.name)))?;
            if sha256_hex(&bytes) != m.hash {
                return Err(ContentError::Invalid(format!("picture \"{}\" is damaged (hash does not match)", m.name)));
            }
            let ext = m.file.strip_prefix(m.hash.as_str()).and_then(|rest| rest.strip_prefix('.'));
            // Lowercase, as files are named here (an upper-case one would show as missing forever).
            let ext_ok = ext.is_some_and(|e| (1..=8).contains(&e.len()) && e.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()));
            if m.hash.len() != 64 || !m.hash.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) || !ext_ok {
                return Err(ContentError::Invalid(format!("picture \"{}\" has an unexpected file name", m.name)));
            }
            crate::validate_media(&media_input(m, &bytes)?)?;
            decoded.push(bytes);
        }
        // Songs already here, as they are before the import, to tell which differ from the file.
        let mut before = HashMap::new();
        for packaged in &payload.songs.songs {
            if let Some(cur) = self.get_song(&packaged.song.id)? {
                before.insert(packaged.song.id.clone(), cur);
            }
        }
        let songs = self.import_songs(&payload.songs, ImportMode::Skip)?;
        let songs_differ: Vec<String> = payload
            .songs
            .songs
            .iter()
            .filter(|p| before.get(&p.song.id).is_some_and(|cur| !same_song_content(cur, p)))
            .map(|p| p.song.title.clone())
            .collect();
        let arrangement_map = self.arrangement_map(&payload.songs.songs)?;
        let mut media_map = HashMap::new();
        let (mut media_added, mut media_reused) = (0, 0);
        for (m, bytes) in payload.media.iter().zip(decoded) {
            std::fs::create_dir_all(media_dir).map_err(|e| ContentError::Invalid(e.to_string()))?;
            let id = if let Some(existing) = self.find_media_by_hash(&m.hash)? {
                media_reused += 1;
                // Same picture, but the file may have gone from this computer: the package has the bytes.
                let dest = media_dir.join(&existing.file);
                if !dest.exists() {
                    std::fs::write(&dest, &bytes).map_err(|e| ContentError::Invalid(format!("could not save picture \"{}\": {e}", m.name)))?;
                }
                existing.id
            } else {
                let dest = media_dir.join(&m.file);
                if !dest.exists() {
                    std::fs::write(&dest, &bytes).map_err(|e| ContentError::Invalid(format!("could not save picture \"{}\": {e}", m.name)))?;
                }
                media_added += 1;
                self.register_media(&media_input(m, &bytes)?)?.id
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
        let program = match self.replace_items(&program.id, program.revision, &items) {
            Ok(p) => p,
            Err(e) => {
                // Never leave an empty service behind.
                let _ = self.delete_program(&program.id, program.revision);
                return Err(e);
            }
        };
        Ok(PackageReport { program, songs_added: songs.added, songs_skipped: songs.skipped, songs_differ, media_added, media_reused })
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
        assert!(r2.songs_differ.is_empty(), "same words: nothing to report");

        // Home fixes a lyric and sends a newer version: the church keeps its copy and is told.
        let mut payload: PackagePayload = serde_json::from_str(&pkg.payload).unwrap();
        payload.songs.songs[0].sections[0].texts.insert("en".into(), "Amazing grace, how sweet the sound".into());
        let text = serde_json::to_string(&payload).unwrap();
        let v2 = ServicePackage { version: 1, sha256: sha256_hex(text.as_bytes()), payload: text };
        let r3 = church.import_service_package(&v2, &church_media).unwrap();
        assert_eq!(r3.songs_differ, vec!["Amazing Grace".to_string()]);
        assert_eq!(church.get_song(&s.song.id).unwrap().unwrap().sections[0].texts["en"], "Amazing grace", "no silent overwrite");
    }

    #[test]
    fn damaged_or_foreign_packages_change_nothing() {
        let db = ContentDb::open_in_memory().unwrap();
        let media = temp_dir("damaged");
        let p = db.create_program("Sunday", None).unwrap();
        let good = db.export_service_package(&p.id, &media).unwrap();
        let tampered = ServicePackage { payload: good.payload.replace("Sunday", "Monday"), ..good.clone() };
        assert!(matches!(db.import_service_package(&tampered, &media), Err(ContentError::Invalid(m)) if m.contains("checksum")));
        let future = ServicePackage { version: PACKAGE_VERSION + 1, ..good.clone() };
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

    #[test]
    fn a_service_with_phases_goes_as_version_2_and_comes_back_with_them() {
        let home = ContentDb::open_in_memory().unwrap();
        let media = temp_dir("phases");
        let p = home.create_program("Sunday", None).unwrap();
        let rows = vec![
            ItemInput { kind: "phase".into(), reference: "Main service".into(), payload: Some(r#"{"rule":"manual","role":"main","starts_at":"10:00"}"#.into()), ..Default::default() },
            ItemInput { kind: "group".into(), reference: "Word".into(), ..Default::default() },
            ItemInput { kind: "verse".into(), reference: "John 3:16".into(), book_number: Some(43), chapter: Some(3), verse: Some(16), ..Default::default() },
        ];
        home.replace_items(&p.id, p.revision, &rows).unwrap();
        let pkg = home.export_service_package(&p.id, &media).unwrap();
        assert_eq!(pkg.version, 2);
        let away = ContentDb::open_in_memory().unwrap();
        let report = away.import_service_package(&pkg, &temp_dir("phases-away")).unwrap();
        let opened = away.get_program(&report.program.program.id).unwrap().unwrap();
        assert_eq!(opened.items.iter().map(|i| (i.kind.as_str(), i.reference.as_str())).collect::<Vec<_>>(), vec![("phase", "Main service"), ("group", "Word"), ("verse", "John 3:16")]);
        assert_eq!(opened.program.item_count, 1);
        // A plain service still goes as version 1, for older apps.
        let plain = home.create_program("Plain", None).unwrap();
        home.replace_items(&plain.id, plain.revision, &rows[2..]).unwrap();
        assert_eq!(home.export_service_package(&plain.id, &media).unwrap().version, 1);
    }

    /// A file whose checksum is valid but whose content breaks the rules must change nothing at all.
    #[test]
    fn a_consistent_but_wrong_package_changes_nothing() {
        let db = ContentDb::open_in_memory().unwrap();
        let media = temp_dir("wrong");
        let s = db.create_song(&song()).unwrap();
        let p = db.create_program("Sunday", None).unwrap();
        db.replace_items(&p.id, p.revision, &[ItemInput { kind: "song".into(), reference: "Amazing Grace".into(), payload: Some(serde_json::json!({ "song_id": s.song.id, "arrangement_id": s.arrangements[0].id, "languages": ["en"] }).to_string()), ..Default::default() }]).unwrap();
        let good = db.export_service_package(&p.id, &media).unwrap();
        let seal = |payload: &PackagePayload| {
            let s = serde_json::to_string(payload).unwrap();
            ServicePackage { version: 1, sha256: sha256_hex(s.as_bytes()), payload: s }
        };
        let base: PackagePayload = serde_json::from_str(&good.payload).unwrap();
        let bytes = b"png bytes";
        let hash = sha256_hex(bytes);
        let pic = |file: String, kind: &str, mime: &str| PackagedMedia { id: "pm".into(), kind: kind.into(), name: "x.png".into(), file, hash: hash.clone(), mime: mime.into(), width: None, height: None, duration_ms: None, data: B64.encode(bytes) };

        let church = ContentDb::open_in_memory().unwrap();
        let church_media = temp_dir("wrong-church");
        let snapshot = |db: &ContentDb| (db.list_programs().unwrap().len(), db.list_songs(None, 50).unwrap().len(), db.list_media().unwrap().len(), std::fs::read_dir(&church_media).unwrap().count());
        let before = snapshot(&church);

        // Bad media kind, mime, and file names.
        for (file, kind, mime) in [
            (format!("{hash}.png"), "picture", "image/png"),
            (format!("{hash}.png"), "image", "png"),
            (hash.clone(), "image", "image/png"),
            (format!("{hash}\u{0}.png"), "image", "image/png"),
            (format!("{hash}.png:stream"), "image", "image/png"),
            (format!("{hash}.{}", "x".repeat(9)), "image", "image/png"),
        ] {
            let mut pl = base.clone();
            pl.media.push(pic(file, kind, mime));
            assert!(matches!(church.import_service_package(&seal(&pl), &church_media), Err(ContentError::Invalid(_))));
            assert_eq!(snapshot(&church), before);
        }
        // An item whose song or picture is not in the file; an item of an unknown kind.
        let mut pl = base.clone();
        pl.items[0].payload = Some(serde_json::json!({ "song_id": "not-in-file", "arrangement_id": "a", "languages": ["en"] }).to_string());
        assert!(matches!(church.import_service_package(&seal(&pl), &church_media), Err(ContentError::Invalid(m)) if m.contains("song is not in the file")));
        let mut pl = base.clone();
        pl.items.push(ItemInput { kind: "image".into(), reference: "x".into(), payload: Some(serde_json::json!({ "media_id": "ghost", "fit": "cover" }).to_string()), ..Default::default() });
        assert!(matches!(church.import_service_package(&seal(&pl), &church_media), Err(ContentError::Invalid(m)) if m.contains("picture is not in the file")));
        let mut pl = base.clone();
        pl.items.push(ItemInput { kind: "video".into(), reference: "x".into(), ..Default::default() });
        assert!(matches!(church.import_service_package(&seal(&pl), &church_media), Err(ContentError::Invalid(_))));
        assert_eq!(snapshot(&church), before);

        // And the good one still works, and restores a reused picture whose file went missing.
        let mut pl = base.clone();
        pl.media.push(pic(format!("{hash}.png"), "image", "image/png"));
        pl.items.push(ItemInput { kind: "image".into(), reference: "x".into(), payload: Some(serde_json::json!({ "media_id": "pm", "fit": "cover" }).to_string()), ..Default::default() });
        let r = church.import_service_package(&seal(&pl), &church_media).unwrap();
        assert_eq!((r.media_added, r.media_reused), (1, 0));
        std::fs::remove_file(church_media.join(format!("{hash}.png"))).unwrap();
        let r2 = church.import_service_package(&seal(&pl), &church_media).unwrap();
        assert_eq!((r2.media_added, r2.media_reused), (0, 1));
        assert!(church_media.join(format!("{hash}.png")).exists());
    }
}
