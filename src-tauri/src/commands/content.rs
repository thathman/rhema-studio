#![expect(clippy::needless_pass_by_value, reason = "Tauri command extractors require pass-by-value")]

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

use rhema_content::{
    ContentDb, ContentError, Hymnbook, HymnbookInput, ImportMode, ImportReport, ItemInput, Program, ProgramWithItems,
    Revision, RevisionSummary, SongExport, SongInput, SongSummary, SongWithSections, ServiceLog, ServiceLogSummary, MediaAsset,
};

/// The content database is opened in `setup`; `None` means it failed to open
/// and every command reports that instead of crashing the app. Live
/// presentation never depends on it.
pub struct ContentState(pub Mutex<Option<ContentDb>>);

/// Structured error so the frontend can tell a revision conflict from a
/// validation problem or an unavailable database.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ContentCommandError {
    Unavailable { message: String },
    NotFound { message: String },
    Invalid { message: String },
    Conflict { message: String, expected: i64, actual: i64 },
    /// A song a saved service still uses; `titles` names the services.
    InUse { message: String, titles: Vec<String> },
    Database { message: String },
}

impl From<ContentError> for ContentCommandError {
    fn from(e: ContentError) -> Self {
        let message = e.to_string();
        match e {
            ContentError::NotFound(_) => Self::NotFound { message },
            ContentError::Invalid(_) => Self::Invalid { message },
            ContentError::Conflict { expected, actual } => Self::Conflict { message, expected, actual },
            ContentError::InUse { titles } => Self::InUse { message, titles },
            _ => Self::Database { message },
        }
    }
}

type CmdResult<T> = Result<T, ContentCommandError>;

fn with_db<T>(
    state: &State<'_, ContentState>,
    f: impl FnOnce(&ContentDb) -> rhema_content::Result<T>,
) -> CmdResult<T> {
    let guard = state.0.lock().map_err(|e| ContentCommandError::Unavailable { message: e.to_string() })?;
    let db = guard.as_ref().ok_or_else(|| ContentCommandError::Unavailable {
        message: "Content database is not available".to_string(),
    })?;
    f(db).map_err(Into::into)
}

#[tauri::command]
pub fn content_list_programs(state: State<'_, ContentState>) -> CmdResult<Vec<Program>> {
    with_db(&state, ContentDb::list_programs)
}

#[tauri::command]
pub fn content_create_program(
    state: State<'_, ContentState>,
    title: String,
    service_date: Option<String>,
) -> CmdResult<Program> {
    with_db(&state, |db| db.create_program(&title, service_date.as_deref()))
}

#[tauri::command]
pub fn content_save_service_log(state: State<'_, ContentState>, program_id: Option<String>, title: String, body: String) -> CmdResult<ServiceLogSummary> {
    with_db(&state, |db| db.save_service_log(program_id.as_deref(), &title, &body))
}

#[tauri::command]
pub fn content_list_service_logs(state: State<'_, ContentState>, query: Option<String>, limit: Option<usize>) -> CmdResult<Vec<ServiceLogSummary>> {
    with_db(&state, |db| db.list_service_logs(query.as_deref(), limit.unwrap_or(100)))
}

#[tauri::command]
pub fn content_get_service_log(state: State<'_, ContentState>, id: String) -> CmdResult<Option<ServiceLog>> {
    with_db(&state, |db| db.get_service_log(&id))
}

#[tauri::command]
pub fn content_delete_service_log(state: State<'_, ContentState>, id: String) -> CmdResult<()> {
    with_db(&state, |db| db.delete_service_log(&id))
}

#[tauri::command]
pub fn content_list_song_attachments(state: State<'_, ContentState>, song_id: String) -> CmdResult<Vec<MediaAsset>> {
    with_db(&state, |db| db.list_song_attachments(&song_id))
}

#[tauri::command]
pub fn content_add_song_attachment(state: State<'_, ContentState>, song_id: String, media_id: String) -> CmdResult<Vec<MediaAsset>> {
    with_db(&state, |db| db.add_song_attachment(&song_id, &media_id))
}

#[tauri::command]
pub fn content_remove_song_attachment(state: State<'_, ContentState>, song_id: String, media_id: String) -> CmdResult<Vec<MediaAsset>> {
    with_db(&state, |db| db.remove_song_attachment(&song_id, &media_id))
}

/// The operator's name for audit rows (Settings → your name). Empty clears it.
#[tauri::command]
pub fn content_set_actor(name: Option<String>) {
    rhema_content::set_actor(name.as_deref());
}

/// Mark the saved service as the one for the day; its snapshot is then kept.
#[tauri::command]
pub fn content_approve_program(state: State<'_, ContentState>, id: String, expected_revision: i64) -> CmdResult<Program> {
    with_db(&state, |db| db.approve_program(&id, expected_revision))
}

#[tauri::command]
pub fn content_update_program(
    state: State<'_, ContentState>,
    id: String,
    expected_revision: i64,
    title: String,
    service_date: Option<String>,
) -> CmdResult<Program> {
    with_db(&state, |db| db.update_program(&id, expected_revision, &title, service_date.as_deref()))
}

#[tauri::command]
pub fn content_get_program(state: State<'_, ContentState>, id: String) -> CmdResult<Option<ProgramWithItems>> {
    with_db(&state, |db| db.get_program(&id))
}

#[tauri::command]
pub fn content_replace_items(
    state: State<'_, ContentState>,
    program_id: String,
    expected_revision: i64,
    items: Vec<ItemInput>,
) -> CmdResult<ProgramWithItems> {
    with_db(&state, |db| db.replace_items(&program_id, expected_revision, &items))
}

#[tauri::command]
pub fn content_delete_program(state: State<'_, ContentState>, id: String, expected_revision: i64) -> CmdResult<()> {
    with_db(&state, |db| db.delete_program(&id, expected_revision))
}

// ── service history ────────────────────────────────────────────────────

#[tauri::command]
pub fn content_list_revisions(state: State<'_, ContentState>, program_id: String) -> CmdResult<Vec<RevisionSummary>> {
    with_db(&state, |db| db.list_revisions(&program_id))
}

#[tauri::command]
pub fn content_get_revision(state: State<'_, ContentState>, id: String) -> CmdResult<Option<Revision>> {
    with_db(&state, |db| db.get_revision(&id))
}

#[tauri::command]
pub fn content_restore_revision(
    state: State<'_, ContentState>,
    program_id: String,
    expected_revision: i64,
    revision_id: String,
) -> CmdResult<ProgramWithItems> {
    with_db(&state, |db| db.restore_revision(&program_id, expected_revision, &revision_id))
}

// ── songs and hymnbooks ────────────────────────────────────────────────

#[tauri::command]
pub fn content_list_songs(state: State<'_, ContentState>, query: Option<String>, limit: Option<usize>) -> CmdResult<Vec<SongSummary>> {
    with_db(&state, |db| db.list_songs(query.as_deref(), limit.unwrap_or(200).min(1000)))
}

#[tauri::command]
pub fn content_get_song(state: State<'_, ContentState>, id: String) -> CmdResult<Option<SongWithSections>> {
    with_db(&state, |db| db.get_song(&id))
}

#[tauri::command]
pub fn content_create_song(state: State<'_, ContentState>, input: SongInput) -> CmdResult<SongWithSections> {
    with_db(&state, |db| db.create_song(&input))
}

#[tauri::command]
pub fn content_update_song(
    state: State<'_, ContentState>,
    id: String,
    expected_revision: i64,
    input: SongInput,
) -> CmdResult<SongWithSections> {
    with_db(&state, |db| db.update_song(&id, expected_revision, &input))
}

#[tauri::command]
pub fn content_delete_song(state: State<'_, ContentState>, id: String, expected_revision: i64) -> CmdResult<()> {
    with_db(&state, |db| db.delete_song(&id, expected_revision))
}

#[tauri::command]
pub fn content_list_hymnbooks(state: State<'_, ContentState>) -> CmdResult<Vec<Hymnbook>> {
    with_db(&state, ContentDb::list_hymnbooks)
}

#[tauri::command]
pub fn content_upsert_hymnbook(state: State<'_, ContentState>, input: HymnbookInput) -> CmdResult<Hymnbook> {
    with_db(&state, |db| db.upsert_hymnbook(&input))
}

#[tauri::command]
pub fn content_delete_hymnbook(state: State<'_, ContentState>, id: String) -> CmdResult<()> {
    with_db(&state, |db| db.delete_hymnbook(&id))
}

#[tauri::command]
pub fn content_export_songs(state: State<'_, ContentState>, ids: Option<Vec<String>>) -> CmdResult<SongExport> {
    with_db(&state, |db| db.export_songs(ids.as_deref()))
}

#[tauri::command]
pub fn content_import_songs(state: State<'_, ContentState>, export: SongExport, mode: ImportMode) -> CmdResult<ImportReport> {
    with_db(&state, |db| db.import_songs(&export, mode))
}

/// Copy the live database to `path` (SQLite online backup; safe while open).
#[tauri::command]
pub fn content_backup(state: State<'_, ContentState>, path: String) -> CmdResult<()> {
    with_db(&state, |db| db.backup_to(Path::new(&path)))
}

#[derive(Debug, Serialize)]
pub struct RestoreReport {
    /// Where the pre-restore database was kept.
    pub snapshot: Option<String>,
    pub migrations: Vec<String>,
}

/// Replace the live database with a verified backup. The current file is
/// snapshotted first; on any failure the previous database is reopened.
#[tauri::command]
pub fn content_restore(state: State<'_, ContentState>, path: String) -> CmdResult<RestoreReport> {
    let mut guard = state.0.lock().map_err(|e| ContentCommandError::Unavailable { message: e.to_string() })?;
    let current: PathBuf = guard
        .as_ref()
        .and_then(|db| db.path().map(Path::to_path_buf))
        .ok_or_else(|| ContentCommandError::Unavailable { message: "Content database is not available".to_string() })?;
    // Close the only handle so the file can be replaced.
    *guard = None;
    match rhema_content::restore_from(&current, Path::new(&path)) {
        Ok((db, snapshot)) => {
            let migrations = db.applied_migrations().unwrap_or_default();
            *guard = Some(db);
            Ok(RestoreReport { snapshot: snapshot.map(|p| p.display().to_string()), migrations })
        }
        Err(e) => {
            match ContentDb::open(&current) {
                Ok(db) => *guard = Some(db),
                Err(reopen) => log::error!("content database could not be reopened after a failed restore: {reopen}"),
            }
            Err(e.into())
        }
    }
}

/// Where the database lives and whether it is open: for Diagnostics.
#[derive(Debug, Serialize)]
pub struct ContentStatus {
    pub available: bool,
    pub path: Option<String>,
    pub migrations: Vec<String>,
    /// Automatic copy made before the last migration, if any.
    pub last_backup: Option<String>,
}

#[tauri::command]
pub fn content_status(state: State<'_, ContentState>) -> Result<ContentStatus, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    Ok(match guard.as_ref() {
        Some(db) => ContentStatus {
            available: true,
            path: db.path().map(|p| p.display().to_string()),
            migrations: db.applied_migrations().unwrap_or_default(),
            last_backup: db.last_backup().map(|p| p.display().to_string()),
        },
        None => ContentStatus { available: false, path: None, migrations: vec![], last_backup: None },
    })
}
