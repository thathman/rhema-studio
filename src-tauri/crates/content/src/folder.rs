//! The church folder (owner decision #72): a shared or synced folder (a NAS
//! share, Google Drive, `OneDrive`, Syncthing) where prepared services are
//! published as versioned service packages and opened at church. Files only:
//! no accounts, no server, and nothing is ever opened or replaced without
//! the operator choosing it.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;

use crate::{ContentDb, ContentError, PackagePayload, PackageReport, Result, ServicePackage};

pub const PACKAGE_SUFFIX: &str = ".rhema-service.json";
/// Larger files are listed as unreadable rather than loaded (a service with many videos).
const MAX_PACKAGE_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_FILES: usize = 500;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PublishResult {
    pub path: String,
    pub file_name: String,
    /// This revision was already in the folder; nothing was written.
    pub already: bool,
    /// The published file's checksum and version, so the app can remember what it put there.
    pub sha256: String,
    pub source_id: Option<String>,
    pub revision: Option<i64>,
    /// Another computer had already published this service at or after this version:
    /// the file was numbered after the highest one there (this revision), and those
    /// versions' changes are not in it.
    pub numbered_after: Option<i64>,
}

/// One service package found in the folder.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct FolderEntry {
    pub path: String,
    pub file_name: String,
    /// Seconds since the epoch the file was last written (by this or another computer).
    pub modified: i64,
    pub sha256: String,
    pub title: String,
    pub service_date: Option<String>,
    pub source_id: Option<String>,
    pub revision: Option<i64>,
    pub approved_revision: Option<i64>,
    pub approved_by: Option<String>,
    pub item_count: usize,
    /// Why the file cannot be opened (damaged, wrong version, too large); None when it is fine.
    pub error: Option<String>,
}

/// "Sunday Service 2026-10-25 v7 3f9a0c21b7d4.rhema-service.json": readable,
/// sortable, and ending in the start of the content checksum, so every
/// different content (a new revision, a new approval, the same title made
/// on another computer) gets its own file and identical content is never
/// written twice. Publishing never replaces a different file.
pub fn package_file_name(title: &str, service_date: Option<&str>, revision: i64, sha256: &str) -> String {
    let tag: String = sha256.chars().take(12).collect();
    let mut base: String = title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if base.is_empty() {
        base = "Service".into();
    }
    base = base.chars().take(80).collect();
    match service_date {
        Some(d) => format!("{base} {d} v{revision} {tag}{PACKAGE_SUFFIX}"),
        None => format!("{base} v{revision} {tag}{PACKAGE_SUFFIX}"),
    }
}

fn folder_dir(folder: &Path) -> Result<&Path> {
    if folder.as_os_str().is_empty() || !folder.is_dir() {
        return Err(ContentError::Invalid("the church folder is not available (check that the NAS or synced folder is connected)".into()));
    }
    Ok(folder)
}

fn read_package(path: &Path) -> std::result::Result<(ServicePackage, PackagePayload), String> {
    let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    if size > MAX_PACKAGE_BYTES {
        return Err("too large to open".into());
    }
    let raw = std::fs::read(path).map_err(|e| e.to_string())?;
    let pkg: ServicePackage = serde_json::from_slice(&raw).map_err(|_| "not a Rhema service file".to_string())?;
    if pkg.version != crate::PACKAGE_VERSION {
        return Err(format!("made by a different version (package v{})", pkg.version));
    }
    if crate::package_sha256(pkg.payload.as_bytes()) != pkg.sha256 {
        return Err("damaged (checksum does not match); it may still be syncing".into());
    }
    let payload: PackagePayload = serde_json::from_str(&pkg.payload).map_err(|e| format!("unreadable: {e}"))?;
    Ok((pkg, payload))
}

/// Service files in the folder, newest first. Damaged or half-synced files are
/// listed with the reason, never opened.
pub fn list_church_folder(folder: &Path) -> Result<Vec<FolderEntry>> {
    let dir = folder_dir(folder)?;
    let paths: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| ContentError::Invalid(format!("cannot read the church folder: {e}")))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.is_file() && p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.ends_with(PACKAGE_SUFFIX) && !n.starts_with('.')))
        .collect();
    let stamp = |p: &Path| -> (u64, i64) {
        let m = std::fs::metadata(p).ok();
        let modified = m
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .and_then(|d| i64::try_from(d.as_secs()).ok())
            .unwrap_or(0);
        (m.map_or(0, |m| m.len()), modified)
    };
    // The newest files are kept when there are too many.
    let mut stamped: Vec<(PathBuf, u64, i64)> = paths.into_iter().map(|p| { let (len, m) = stamp(&p); (p, len, m) }).collect();
    stamped.sort_by_key(|s| std::cmp::Reverse(s.2));
    stamped.truncate(MAX_FILES);
    let cache = LIST_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut out: Vec<FolderEntry> = stamped
        .iter()
        .map(|(path, len, modified)| {
            // A file already read with the same size and time is not read again (a NAS full of video packages).
            if let Some((l, m, e)) = cache.lock().unwrap_or_else(std::sync::PoisonError::into_inner).get(path) {
                if l == len && m == modified {
                    return e.clone();
                }
            }
            let entry = read_entry(path, *modified);
            cache.lock().unwrap_or_else(std::sync::PoisonError::into_inner).insert(path.clone(), (*len, *modified, entry.clone()));
            entry
        })
        .collect();
    out.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| b.file_name.cmp(&a.file_name)));
    Ok(out)
}

/// Entries already read, by path, with the size and time they had then.
type ListCache = Mutex<HashMap<PathBuf, (u64, i64, FolderEntry)>>;
static LIST_CACHE: OnceLock<ListCache> = OnceLock::new();

fn read_entry(path: &Path, modified: i64) -> FolderEntry {
            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
            let base = FolderEntry {
                path: path.to_string_lossy().into_owned(),
                file_name: file_name.clone(),
                modified,
                sha256: String::new(),
                title: file_name.trim_end_matches(PACKAGE_SUFFIX).to_string(),
                service_date: None,
                source_id: None,
                revision: None,
                approved_revision: None,
                approved_by: None,
                item_count: 0,
                error: None,
            };
            match read_package(path) {
                Ok((pkg, p)) => FolderEntry {
                    sha256: pkg.sha256,
                    title: p.title,
                    service_date: p.service_date,
                    source_id: p.source_id,
                    revision: p.revision,
                    approved_revision: p.approved_revision,
                    approved_by: p.approved_by,
                    item_count: p.items.len(),
                    ..base
                },
                Err(error) => FolderEntry { error: Some(error), ..base },
            }
}

/// Write an exported package into the folder (no database needed, so the
/// caller can release the database before the slow network write). The
/// name carries the content checksum: the same name means the same content,
/// so an existing file is left as it is.
pub fn write_package_to_folder(folder: &Path, pkg: &ServicePackage) -> Result<PublishResult> {
    let dir = folder_dir(folder)?;
    let p: PackagePayload = serde_json::from_str(&pkg.payload).map_err(|e| ContentError::Invalid(e.to_string()))?;
    let file_name = package_file_name(&p.title, p.service_date.as_deref(), p.revision.unwrap_or(0), &pkg.sha256);
    let path = dir.join(&file_name);
    let result = |already: bool| PublishResult { path: path.to_string_lossy().into_owned(), file_name: file_name.clone(), already, sha256: pkg.sha256.clone(), source_id: p.source_id.clone(), revision: p.revision, numbered_after: None };
    if path.exists() {
        return Ok(result(true));
    }
    let json = serde_json::to_vec(pkg).map_err(|e| ContentError::Invalid(e.to_string()))?;
    // A hidden, unique temporary name, then rename: a reader (or a sync tool)
    // never sees half a file, and two computers publishing at once never share
    // a temporary file. A rename onto a same-named file replaces identical content.
    let tmp = dir.join(format!(".{file_name}.{}.part", uuid::Uuid::new_v4().simple()));
    let written = std::fs::write(&tmp, &json).and_then(|()| std::fs::rename(&tmp, &path));
    if let Err(e) = written {
        let _ = std::fs::remove_file(&tmp);
        return Err(ContentError::Invalid(format!("could not write to the church folder: {e}")));
    }
    Ok(result(false))
}

/// Version numbers stay unique per service in the folder: when another computer has
/// already published this service at the same or a later version (with other
/// content), this file is numbered after the highest one, and the result says so.
/// Identical content already there is left as it is.
pub fn publish_numbered(folder: &Path, pkg: &ServicePackage) -> Result<PublishResult> {
    let p: PackagePayload = serde_json::from_str(&pkg.payload).map_err(|e| ContentError::Invalid(e.to_string()))?;
    let entries = list_church_folder(folder)?;
    if entries.iter().any(|e| e.sha256 == pkg.sha256) {
        return write_package_to_folder(folder, pkg);
    }
    let highest = entries.iter().filter(|e| e.error.is_none() && e.source_id.is_some() && e.source_id == p.source_id).filter_map(|e| e.revision).max();
    match (highest, p.revision) {
        (Some(top), Some(rev)) if rev <= top => {
            let renumbered = pkg.renumbered(None, top + 1 - rev)?;
            let mut r = write_package_to_folder(folder, &renumbered)?;
            r.numbered_after = Some(top);
            Ok(r)
        }
        _ => write_package_to_folder(folder, pkg),
    }
}

impl ContentDb {
    /// Export and write in one call (tests and simple callers; the app's
    /// command exports under the database lock and writes after releasing it).
    pub fn publish_to_church_folder(&self, program_id: &str, media_dir: &Path, folder: &Path) -> Result<PublishResult> {
        folder_dir(folder)?;
        let pkg = self.export_service_package(program_id, media_dir)?;
        write_package_to_folder(folder, &pkg)
    }

    /// Open a file from the folder as a new service on this computer (checked before anything is written).
    pub fn open_from_church_folder(&self, folder: &Path, file_name: &str, media_dir: &Path) -> Result<PackageReport> {
        let pkg = read_church_folder_package(folder, file_name)?;
        self.import_service_package(&pkg, media_dir)
    }
}

/// Read and check one service file from the church folder (no database needed, so callers
/// can do the slow network read before taking the database lock).
pub fn read_church_folder_package(folder: &Path, file_name: &str) -> Result<ServicePackage> {
    let dir = folder_dir(folder)?;
    // Only a plain file name inside the folder: never a path elsewhere on the computer.
    if file_name.contains(['/', '\\', ':', '\0']) || file_name.starts_with('.') || !file_name.ends_with(PACKAGE_SUFFIX) {
        return Err(ContentError::Invalid("not a service file in the church folder".into()));
    }
    let (pkg, _) = read_package(&dir.join(file_name)).map_err(|e| ContentError::Invalid(format!("{file_name}: {e}")))?;
    Ok(pkg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ItemInput;

    fn temp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("rhema-folder-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn file_names_are_readable_versioned_and_safe() {
        let sha = "3f9a0c21b7d4e5f60718293a4b5c6d7e8f9012345678901234567890abcdef12";
        assert_eq!(package_file_name("Sunday Service", Some("2026-10-25"), 7, sha), "Sunday Service 2026-10-25 v7 3f9a0c21b7d4.rhema-service.json");
        assert_eq!(package_file_name("../Ìsìn: 9/11 *", None, 1, sha), "Ìsìn 9 11 v1 3f9a0c21b7d4.rhema-service.json");
        assert_eq!(package_file_name("???", None, 2, sha), "Service v2 3f9a0c21b7d4.rhema-service.json");
    }

    #[test]
    fn a_copy_published_again_is_a_newer_version_of_the_same_service() {
        let home = ContentDb::open_in_memory().unwrap();
        let church = ContentDb::open_in_memory().unwrap();
        let (folder, media_a, media_b) = (temp_dir("lineage"), temp_dir("lin-a"), temp_dir("lin-b"));
        let p = home.create_program("Sunday", Some("2026-10-25")).unwrap();
        let verse = ItemInput { kind: "verse".into(), reference: "John 3:16".into(), book_number: Some(43), chapter: Some(3), verse: Some(16), ..ItemInput::default() };
        let mut rev = home.replace_items(&p.id, p.revision, std::slice::from_ref(&verse)).unwrap().program.revision;
        for _ in 0..3 {
            rev = home.replace_items(&p.id, rev, std::slice::from_ref(&verse)).unwrap().program.revision;
        }
        let first = home.publish_to_church_folder(&p.id, &media_a, &folder).unwrap();
        assert_eq!(first.revision, Some(rev));
        // The church opens it (its own numbering starts again), changes it and publishes.
        let opened = church.open_from_church_folder(&folder, &first.file_name, &media_b).unwrap();
        let copy = opened.program.program;
        let changed = church.replace_items(&copy.id, copy.revision, &[verse.clone(), ItemInput { reference: "Psalm 23:1".into(), book_number: Some(19), chapter: Some(23), verse: Some(1), ..verse.clone() }]).unwrap();
        let lineage = crate::Lineage { source_id: p.id.clone(), revision_offset: rev - copy.revision };
        let pkg = church.export_service_package(&copy.id, &media_b).unwrap().with_lineage(&lineage).unwrap();
        let theirs = write_package_to_folder(&folder, &pkg).unwrap();
        assert_eq!(theirs.source_id.as_deref(), Some(p.id.as_str()), "the same service, not a new one");
        assert_eq!(theirs.revision, Some(rev + (changed.program.revision - copy.revision)), "numbered after the version it was opened from");
        let entries = list_church_folder(&folder).unwrap();
        assert_eq!(entries.iter().filter(|e| e.source_id.as_deref() == Some(p.id.as_str())).count(), 2);
        assert!(theirs.revision > first.revision);
        // Home meanwhile edits its own copy to the same number and publishes: numbered after theirs, and told.
        let mine = home.replace_items(&p.id, rev, std::slice::from_ref(&verse)).unwrap().program.revision;
        assert_eq!(Some(mine), theirs.revision, "same number on both computers");
        let home_pkg = home.export_service_package(&p.id, &media_a).unwrap();
        let published = publish_numbered(&folder, &home_pkg).unwrap();
        assert_eq!(published.revision, Some(mine + 1));
        assert_eq!(published.numbered_after, theirs.revision);
        // The same content again: left as it is.
        let again = publish_numbered(&folder, &home_pkg.renumbered(None, 1).unwrap()).unwrap();
        assert!(again.already);
    }

    #[test]
    fn publish_versions_list_and_open_without_overwriting() {
        let home = ContentDb::open_in_memory().unwrap();
        let church = ContentDb::open_in_memory().unwrap();
        let (folder, media_a, media_b) = (temp_dir("shared"), temp_dir("media-a"), temp_dir("media-b"));
        let p = home.create_program("Sunday", Some("2026-10-25")).unwrap();
        let verse = ItemInput { kind: "verse".into(), reference: "John 3:16".into(), book_number: Some(43), chapter: Some(3), verse: Some(16), ..ItemInput::default() };
        let saved = home.replace_items(&p.id, p.revision, std::slice::from_ref(&verse)).unwrap();

        let unapproved = home.publish_to_church_folder(&p.id, &media_a, &folder).unwrap();
        assert!(!unapproved.already);
        // Approving does not change the revision, but it is new content: a new file.
        let approved = home.approve_program(&p.id, saved.program.revision).unwrap();
        let first = home.publish_to_church_folder(&p.id, &media_a, &folder).unwrap();
        assert!(!first.already);
        assert_ne!(first.file_name, unapproved.file_name);
        assert_eq!(home.publish_to_church_folder(&p.id, &media_a, &folder).unwrap(), PublishResult { already: true, ..first.clone() }, "identical content is not written twice");
        std::fs::remove_file(&unapproved.path).unwrap();
        // Same title, date and revision made on another computer: its own file, never skipped.
        let other = ContentDb::open_in_memory().unwrap();
        let op = other.create_program("Sunday", Some("2026-10-25")).unwrap();
        other.replace_items(&op.id, op.revision, &[ItemInput { reference: "Psalm 23".into(), book_number: Some(19), chapter: Some(23), verse: Some(1), ..verse.clone() }]).unwrap();
        let theirs = other.publish_to_church_folder(&op.id, &media_a, &folder).unwrap();
        assert!(!theirs.already);
        assert_ne!(theirs.file_name, first.file_name);
        std::fs::remove_file(&theirs.path).unwrap();
        let changed = home.replace_items(&p.id, approved.revision, &[verse.clone(), verse]).unwrap();
        let second = home.publish_to_church_folder(&p.id, &media_a, &folder).unwrap();
        assert_ne!(first.file_name, second.file_name);
        std::fs::write(folder.join("Half.rhema-service.json"), b"{\"version\":1,\"payload\":\"{}\",\"sha256\":\"x\"}").unwrap();
        std::fs::write(folder.join(".Other.rhema-service.json.part"), b"partial").unwrap();

        let listed = list_church_folder(&folder).unwrap();
        assert_eq!(listed.len(), 3, "the hidden part file is not listed");
        let ok: Vec<_> = listed.iter().filter(|e| e.error.is_none()).collect();
        assert_eq!(ok.len(), 2);
        let v1 = ok.iter().find(|e| e.file_name == first.file_name).unwrap();
        assert_eq!((v1.source_id.as_deref(), v1.revision, v1.approved_revision, v1.item_count), (Some(p.id.as_str()), Some(approved.revision), Some(approved.revision), 1));
        let v2 = ok.iter().find(|e| e.file_name == second.file_name).unwrap();
        assert_eq!((v2.revision, v2.item_count), (Some(changed.program.revision), 2));
        assert!(listed.iter().any(|e| e.error.as_deref().is_some_and(|m| m.contains("checksum"))));

        let opened = church.open_from_church_folder(&folder, &second.file_name, &media_b).unwrap();
        assert_eq!(opened.program.items.len(), 2);
        assert_eq!(opened.program.program.approved_revision, None, "approval is given again at church");
        assert!(church.open_from_church_folder(&folder, "../secret.rhema-service.json", &media_b).is_err());
        assert!(church.open_from_church_folder(&folder, "C:x.rhema-service.json", &media_b).is_err());
        assert!(church.open_from_church_folder(&folder, "Half.rhema-service.json", &media_b).is_err());
        assert!(list_church_folder(&folder.join("missing")).is_err());
    }
}
