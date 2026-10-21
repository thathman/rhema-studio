#![expect(clippy::needless_pass_by_value, reason = "Tauri command extractors require pass-by-value")]

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;

use rhema_content::{FolderEntry, MediaAsset, MediaInput, PackageReport, PublishResult, ServicePackage};

use super::content::{ContentCommandError, ContentState};

/// Where imported media files live: `<app data>/media`. Set once in `setup`.
pub struct MediaState(pub OnceLock<PathBuf>);

fn media_dir(media: &MediaState) -> CmdResult<&PathBuf> {
    media.0.get().ok_or_else(|| ContentCommandError::Unavailable { message: "Media folder is not available".into() })
}

type CmdResult<T> = Result<T, ContentCommandError>;

#[derive(Debug, Serialize)]
pub struct MediaAssetStatus {
    #[serde(flatten)]
    pub asset: MediaAsset,
    /// Absolute path of the file, for the frontend to read.
    pub path: String,
    /// False when the file is gone from the media folder.
    pub present: bool,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ImportResult {
    Imported { asset: Box<MediaAssetStatus>, duplicate: bool },
    Failed { path: String, message: String },
}

fn kind_and_mime(ext: &str) -> Option<(&'static str, &'static str)> {
    Some(match ext.to_ascii_lowercase().as_str() {
        "png" => ("image", "image/png"),
        "jpg" | "jpeg" => ("image", "image/jpeg"),
        "webp" => ("image", "image/webp"),
        "gif" => ("image", "image/gif"),
        "bmp" => ("image", "image/bmp"),
        "mp4" | "m4v" => ("video", "video/mp4"),
        "mov" => ("video", "video/quicktime"),
        "webm" => ("video", "video/webm"),
        "mp3" => ("audio", "audio/mpeg"),
        "wav" => ("audio", "audio/wav"),
        "ogg" => ("audio", "audio/ogg"),
        "m4a" | "aac" => ("audio", "audio/mp4"),
        "pdf" => ("document", "application/pdf"),
        _ => return None,
    })
}

/// A media file name is `<sha256 hex>.<ext>` and nothing else. The crate
/// validates on insert; this re-checks every name read back from the
/// database (a restored or hand-edited file could carry anything) before it
/// is joined onto the media folder.
fn safe_file_name(name: &str) -> Option<&str> {
    let (hash, ext) = name.split_once('.')?;
    let ok = hash.len() == 64
        && hash.bytes().all(|b| b.is_ascii_hexdigit())
        && !ext.is_empty()
        && ext.len() <= 8
        && ext.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit());
    ok.then_some(name)
}

/// The asset's path inside the media folder, or None when the stored name is
/// not a bare hash name (treated as missing, never touched).
fn media_path(dir: &Path, file: &str) -> Option<PathBuf> {
    safe_file_name(file).map(|f| dir.join(f))
}

fn status(dir: &Path, asset: MediaAsset) -> MediaAssetStatus {
    match media_path(dir, &asset.file) {
        Some(path) => MediaAssetStatus { present: path.is_file(), path: path.display().to_string(), asset },
        None => MediaAssetStatus { present: false, path: String::new(), asset },
    }
}

fn hash_file(path: &Path) -> Result<(String, u64), String> {
    let file = std::fs::File::open(path).map_err(|e| format!("could not read: {e}"))?;
    let mut reader = std::io::BufReader::with_capacity(1 << 20, file);
    let mut hasher = Sha256::new();
    let size = std::io::copy(&mut reader, &mut hasher).map_err(|e| format!("could not read: {e}"))?;
    Ok((format!("{:x}", hasher.finalize()), size))
}

fn import_one(db: &rhema_content::ContentDb, dir: &Path, source: &Path) -> Result<(MediaAsset, bool), String> {
    let ext = source.extension().and_then(|e| e.to_str()).unwrap_or("");
    let (kind, mime) = kind_and_mime(ext).ok_or_else(|| format!("unsupported file type .{ext}"))?;
    // Streamed: a video is never held in memory whole.
    let (hash, size) = hash_file(source)?;
    if let Some(existing) = db.find_media_by_hash(&hash).map_err(|e| e.to_string())? {
        // Same file already here; make sure it is on disk too.
        if let Some(dest) = media_path(dir, &existing.file) {
            if !dest.is_file() {
                std::fs::copy(source, &dest).map_err(|e| format!("could not restore the media file: {e}"))?;
            }
        }
        return Ok((existing, true));
    }
    let file = format!("{hash}.{}", ext.to_ascii_lowercase());
    std::fs::create_dir_all(dir).map_err(|e| format!("could not create the media folder: {e}"))?;
    let dest = dir.join(&file);
    std::fs::copy(source, &dest).map_err(|e| format!("could not copy into the media folder: {e}"))?;
    let name = source.file_stem().and_then(|s| s.to_str()).unwrap_or("Picture").to_string();
    let input = MediaInput {
        kind: kind.into(),
        name,
        file,
        hash,
        size: i64::try_from(size).unwrap_or(i64::MAX),
        mime: mime.into(),
        width: None,
        height: None,
        duration_ms: None,
        source: "local".into(),
        source_ref: String::new(),
        original_path: source.display().to_string(),
    };
    let asset = db.register_media(&input).map_err(|e| {
        let _ = std::fs::remove_file(&dest);
        e.to_string()
    })?;
    Ok((asset, false))
}

/// Copy files into the media folder (named by their SHA-256) and index them.
/// Each file succeeds or fails on its own.
// async: a large video must not block the main thread while it is hashed and copied.
#[tauri::command(async)]
pub fn media_import(state: State<'_, ContentState>, media: State<'_, MediaState>, paths: Vec<String>) -> CmdResult<Vec<ImportResult>> {
    let guard = state.0.lock().map_err(|e| ContentCommandError::Unavailable { message: e.to_string() })?;
    let db = guard.as_ref().ok_or_else(|| ContentCommandError::Unavailable { message: "Content database is not available".into() })?;
    let dir = media_dir(&media)?;
    Ok(paths
        .iter()
        .map(|p| match import_one(db, dir, Path::new(p)) {
            Ok((asset, duplicate)) => ImportResult::Imported { asset: Box::new(status(dir, asset)), duplicate },
            Err(message) => ImportResult::Failed { path: p.clone(), message },
        })
        .collect())
}

#[tauri::command]
pub fn media_list(state: State<'_, ContentState>, media: State<'_, MediaState>) -> CmdResult<Vec<MediaAssetStatus>> {
    let guard = state.0.lock().map_err(|e| ContentCommandError::Unavailable { message: e.to_string() })?;
    let db = guard.as_ref().ok_or_else(|| ContentCommandError::Unavailable { message: "Content database is not available".into() })?;
    let dir = media_dir(&media)?;
    Ok(db.list_media()?.into_iter().map(|a| status(dir, a)).collect())
}

#[tauri::command]
pub fn media_set_dimensions(
    state: State<'_, ContentState>,
    media: State<'_, MediaState>,
    id: String,
    width: Option<i64>,
    height: Option<i64>,
    duration_ms: Option<i64>,
) -> CmdResult<MediaAssetStatus> {
    let guard = state.0.lock().map_err(|e| ContentCommandError::Unavailable { message: e.to_string() })?;
    let db = guard.as_ref().ok_or_else(|| ContentCommandError::Unavailable { message: "Content database is not available".into() })?;
    Ok(status(media_dir(&media)?, db.set_media_dimensions(&id, width, height, duration_ms)?))
}

/// Remove the index row and the file. Refused while a saved service uses it.
#[tauri::command]
pub fn media_delete(state: State<'_, ContentState>, media: State<'_, MediaState>, id: String) -> CmdResult<()> {
    let guard = state.0.lock().map_err(|e| ContentCommandError::Unavailable { message: e.to_string() })?;
    let db = guard.as_ref().ok_or_else(|| ContentCommandError::Unavailable { message: "Content database is not available".into() })?;
    let file = db.delete_media(&id)?;
    if let Some(path) = media_path(media_dir(&media)?, &file) {
        let _ = std::fs::remove_file(path);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::safe_file_name;

    #[test]
    fn only_hash_names_reach_the_file_system() {
        let good = format!("{}.png", "a".repeat(64));
        assert_eq!(safe_file_name(&good), Some(good.as_str()));
        for bad in ["../x.png", "/etc/passwd", "abc.png", &format!("{}", "a".repeat(64)), &format!("{}.PNG", "a".repeat(64)), &format!("{}.p/ng", "a".repeat(64)), ""] {
            assert!(safe_file_name(bad).is_none(), "{bad}");
        }
    }
}

/// One service with the songs and pictures it uses, as a checksummed file.
#[tauri::command]
pub fn content_export_service_package(state: State<'_, ContentState>, media: State<'_, MediaState>, program_id: String) -> CmdResult<ServicePackage> {
    let guard = state.0.lock().map_err(|e| ContentCommandError::Unavailable { message: e.to_string() })?;
    let db = guard.as_ref().ok_or_else(|| ContentCommandError::Unavailable { message: "Content database is not available".into() })?;
    Ok(db.export_service_package(&program_id, media_dir(&media)?)?)
}

/// Creates a new service from a package; songs and pictures already here are reused.
#[tauri::command]
pub fn content_import_service_package(state: State<'_, ContentState>, media: State<'_, MediaState>, package: ServicePackage) -> CmdResult<PackageReport> {
    let guard = state.0.lock().map_err(|e| ContentCommandError::Unavailable { message: e.to_string() })?;
    let db = guard.as_ref().ok_or_else(|| ContentCommandError::Unavailable { message: "Content database is not available".into() })?;
    Ok(db.import_service_package(&package, media_dir(&media)?)?)
}

// ── church folder (owner decision #72: shared/NAS folder, versioned service files) ──

/// Publish the saved service into the church folder as a new versioned file.
#[tauri::command(async)]
pub fn church_folder_publish(state: State<'_, ContentState>, media: State<'_, MediaState>, folder: String, program_id: String) -> CmdResult<PublishResult> {
    // Export under the database lock, then release it before the (possibly slow) write to the NAS.
    let pkg = {
        let guard = state.0.lock().map_err(|e| ContentCommandError::Unavailable { message: e.to_string() })?;
        let db = guard.as_ref().ok_or_else(|| ContentCommandError::Unavailable { message: "Content database is not available".into() })?;
        db.export_service_package(&program_id, media_dir(&media)?)?
    };
    Ok(rhema_content::write_package_to_folder(Path::new(&folder), &pkg)?)
}

/// Service files in the church folder, newest first (damaged or half-synced ones with the reason).
#[tauri::command(async)]
pub fn church_folder_list(folder: String) -> CmdResult<Vec<FolderEntry>> {
    Ok(rhema_content::list_church_folder(Path::new(&folder))?)
}

/// Open one file from the church folder as a new service on this computer.
#[tauri::command(async)]
pub fn church_folder_open(state: State<'_, ContentState>, media: State<'_, MediaState>, folder: String, file_name: String) -> CmdResult<PackageReport> {
    let guard = state.0.lock().map_err(|e| ContentCommandError::Unavailable { message: e.to_string() })?;
    let db = guard.as_ref().ok_or_else(|| ContentCommandError::Unavailable { message: "Content database is not available".into() })?;
    Ok(db.open_from_church_folder(Path::new(&folder), &file_name, media_dir(&media)?)?)
}
