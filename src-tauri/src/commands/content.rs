#![expect(clippy::needless_pass_by_value, reason = "Tauri command extractors require pass-by-value")]

use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

use rhema_content::{
    ContentDb, ContentError, Hymnbook, HymnbookInput, ImportMode, ImportReport, ItemInput, Program, ProgramWithItems,
    SongExport, SongInput, SongSummary, SongWithSections,
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

/// Where the database lives and whether it is open: for Diagnostics.
#[derive(Debug, Serialize)]
pub struct ContentStatus {
    pub available: bool,
    pub path: Option<String>,
    pub migrations: Vec<String>,
}

#[tauri::command]
pub fn content_status(state: State<'_, ContentState>) -> Result<ContentStatus, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    Ok(match guard.as_ref() {
        Some(db) => ContentStatus {
            available: true,
            path: db.path().map(|p| p.display().to_string()),
            migrations: db.applied_migrations().unwrap_or_default(),
        },
        None => ContentStatus { available: false, path: None, migrations: vec![] },
    })
}
