//! The church folder (owner decision #72): a shared or synced folder (a NAS
//! share, Google Drive, `OneDrive`, Syncthing) where prepared services are
//! published as versioned service packages and opened at church. Files only:
//! no accounts, no server, and nothing is ever opened or replaced without
//! the operator choosing it.

use std::path::{Path, PathBuf};

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

/// "Sunday Service 2026-10-25 v7.rhema-service.json": readable, sortable, and
/// a new name for every saved revision, so publishing never overwrites.
pub fn package_file_name(title: &str, service_date: Option<&str>, revision: i64) -> String {
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
        Some(d) => format!("{base} {d} v{revision}{PACKAGE_SUFFIX}"),
        None => format!("{base} v{revision}{PACKAGE_SUFFIX}"),
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
    let mut paths: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| ContentError::Invalid(format!("cannot read the church folder: {e}")))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.is_file() && p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.ends_with(PACKAGE_SUFFIX) && !n.starts_with('.')))
        .collect();
    paths.sort();
    paths.truncate(MAX_FILES);
    let mut out: Vec<FolderEntry> = paths
        .iter()
        .map(|path| {
            let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
            let modified = std::fs::metadata(path)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .and_then(|d| i64::try_from(d.as_secs()).ok())
                .unwrap_or(0);
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
        })
        .collect();
    out.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| b.file_name.cmp(&a.file_name)));
    Ok(out)
}

impl ContentDb {
    /// Publish the saved service as a new versioned file in the folder. A
    /// revision already there is not written again; nothing is overwritten.
    pub fn publish_to_church_folder(&self, program_id: &str, media_dir: &Path, folder: &Path) -> Result<PublishResult> {
        let dir = folder_dir(folder)?;
        let program = self.get_program(program_id)?.ok_or_else(|| ContentError::NotFound(program_id.into()))?.program;
        let file_name = package_file_name(&program.title, program.service_date.as_deref(), program.revision);
        let path = dir.join(&file_name);
        if path.exists() {
            return Ok(PublishResult { path: path.to_string_lossy().into_owned(), file_name, already: true });
        }
        let pkg = self.export_service_package(program_id, media_dir)?;
        let json = serde_json::to_vec(&pkg).map_err(|e| ContentError::Invalid(e.to_string()))?;
        // Write under a hidden name first, then rename: a reader (or a sync
        // tool) never sees a half-written file under the real name.
        let tmp = dir.join(format!(".{file_name}.part"));
        std::fs::write(&tmp, &json).map_err(|e| ContentError::Invalid(format!("could not write to the church folder: {e}")))?;
        std::fs::rename(&tmp, &path).map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            ContentError::Invalid(format!("could not write to the church folder: {e}"))
        })?;
        Ok(PublishResult { path: path.to_string_lossy().into_owned(), file_name, already: false })
    }

    /// Open a file from the folder as a new service on this computer (checked before anything is written).
    pub fn open_from_church_folder(&self, folder: &Path, file_name: &str, media_dir: &Path) -> Result<PackageReport> {
        let dir = folder_dir(folder)?;
        // Only a plain file name inside the folder: never a path elsewhere on the computer.
        if file_name.contains(['/', '\\']) || file_name.starts_with('.') || !file_name.ends_with(PACKAGE_SUFFIX) {
            return Err(ContentError::Invalid("not a service file in the church folder".into()));
        }
        let (pkg, _) = read_package(&dir.join(file_name)).map_err(|e| ContentError::Invalid(format!("{file_name}: {e}")))?;
        self.import_service_package(&pkg, media_dir)
    }
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
        assert_eq!(package_file_name("Sunday Service", Some("2026-10-25"), 7), "Sunday Service 2026-10-25 v7.rhema-service.json");
        assert_eq!(package_file_name("../Ìsìn: 9/11 *", None, 1), "Ìsìn 9 11 v1.rhema-service.json");
        assert_eq!(package_file_name("???", None, 2), "Service v2.rhema-service.json");
    }

    #[test]
    fn publish_versions_list_and_open_without_overwriting() {
        let home = ContentDb::open_in_memory().unwrap();
        let church = ContentDb::open_in_memory().unwrap();
        let (folder, media_a, media_b) = (temp_dir("shared"), temp_dir("media-a"), temp_dir("media-b"));
        let p = home.create_program("Sunday", Some("2026-10-25")).unwrap();
        let verse = ItemInput { kind: "verse".into(), reference: "John 3:16".into(), book_number: Some(43), chapter: Some(3), verse: Some(16), ..ItemInput::default() };
        let saved = home.replace_items(&p.id, p.revision, std::slice::from_ref(&verse)).unwrap();
        // (The approver's name is the shared operator setting, tested in revisions.rs; not asserted here to stay parallel-safe.)
        let approved = home.approve_program(&p.id, saved.program.revision).unwrap();

        let first = home.publish_to_church_folder(&p.id, &media_a, &folder).unwrap();
        assert!(!first.already);
        assert_eq!(home.publish_to_church_folder(&p.id, &media_a, &folder).unwrap(), PublishResult { already: true, ..first.clone() });
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
        assert!(church.open_from_church_folder(&folder, "Half.rhema-service.json", &media_b).is_err());
        assert!(list_church_folder(&folder.join("missing")).is_err());
    }
}
