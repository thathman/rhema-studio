#![expect(clippy::needless_pass_by_value, reason = "Tauri command extractors require pass-by-value")]

use std::sync::Mutex;
use tauri::State;

use rhema_content::{ContentDb, NewProgramItem, Program, ProgramWithItems};

/// The content database is opened in `setup`; `None` means it failed to open
/// and every command reports that instead of crashing the app. Live
/// presentation never depends on it.
pub struct ContentState(pub Mutex<Option<ContentDb>>);

fn with_db<T>(
    state: &State<'_, ContentState>,
    f: impl FnOnce(&ContentDb) -> rhema_content::Result<T>,
) -> Result<T, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let db = guard
        .as_ref()
        .ok_or_else(|| "Content database is not available".to_string())?;
    f(db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn content_list_programs(state: State<'_, ContentState>) -> Result<Vec<Program>, String> {
    with_db(&state, ContentDb::list_programs)
}

#[tauri::command]
pub fn content_create_program(
    state: State<'_, ContentState>,
    title: String,
    service_date: Option<String>,
) -> Result<Program, String> {
    with_db(&state, |db| db.create_program(&title, service_date.as_deref()))
}

#[tauri::command]
pub fn content_update_program(
    state: State<'_, ContentState>,
    id: String,
    title: String,
    service_date: Option<String>,
) -> Result<Program, String> {
    with_db(&state, |db| db.update_program(&id, &title, service_date.as_deref()))
}

#[tauri::command]
pub fn content_get_program(
    state: State<'_, ContentState>,
    id: String,
) -> Result<Option<ProgramWithItems>, String> {
    with_db(&state, |db| db.get_program(&id))
}

#[tauri::command]
pub fn content_replace_items(
    state: State<'_, ContentState>,
    program_id: String,
    items: Vec<NewProgramItem>,
) -> Result<ProgramWithItems, String> {
    with_db(&state, |db| db.replace_items(&program_id, &items))
}

#[tauri::command]
pub fn content_delete_program(state: State<'_, ContentState>, id: String) -> Result<(), String> {
    with_db(&state, |db| db.delete_program(&id))
}
