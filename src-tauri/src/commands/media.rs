#![expect(clippy::needless_pass_by_value, reason = "Tauri command extractors require pass-by-value")]

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;

use rhema_content::{MediaAsset, MediaInput};

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
        _ => return None,
    })
}

fn status(dir: &Path, asset: MediaAsset) -> MediaAssetStatus {
    let path = dir.join(&asset.file);
    MediaAssetStatus { present: path.is_file(), path: path.display().to_string(), asset }
}

fn import_one(db: &rhema_content::ContentDb, dir: &Path, source: &Path) -> Result<(MediaAsset, bool), String> {
    let ext = source.extension().and_then(|e| e.to_str()).unwrap_or("");
    let (kind, mime) = kind_and_mime(ext).ok_or_else(|| format!("unsupported file type .{ext}"))?;
    let bytes = std::fs::read(source).map_err(|e| format!("could not read: {e}"))?;
    let hash = format!("{:x}", Sha256::digest(&bytes));
    if let Some(existing) = db.find_media_by_hash(&hash).map_err(|e| e.to_string())? {
        // Same picture already here; make sure the file is too.
        let dest = dir.join(&existing.file);
        if !dest.is_file() {
            std::fs::write(&dest, &bytes).map_err(|e| format!("could not restore the media file: {e}"))?;
        }
        return Ok((existing, true));
    }
    let file = format!("{hash}.{}", ext.to_ascii_lowercase());
    std::fs::create_dir_all(dir).map_err(|e| format!("could not create the media folder: {e}"))?;
    let dest = dir.join(&file);
    std::fs::write(&dest, &bytes).map_err(|e| format!("could not copy into the media folder: {e}"))?;
    let name = source.file_stem().and_then(|s| s.to_str()).unwrap_or("Picture").to_string();
    let input = MediaInput {
        kind: kind.into(),
        name,
        file,
        hash,
        size: i64::try_from(bytes.len()).unwrap_or(i64::MAX),
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
#[tauri::command]
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
    let _ = std::fs::remove_file(media_dir(&media)?.join(file));
    Ok(())
}
