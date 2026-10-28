//! Service drafts an AI assistant proposed through Rhema MCP (#252), waiting in the data folder's
//! `ai-drafts` for people to review in Prepare. Listing, marking opened, putting back from a backup
//! and removing only: a draft becomes a service when someone opens it and saves it, through the
//! ordinary service commands.

use tauri::{AppHandle, Manager};

fn drafts_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("ai-drafts"))
}

/// Every waiting draft (newest first); unreadable files are skipped, never fatal.
#[tauri::command]
pub fn ai_drafts_list(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let dir = drafts_dir(&app)?;
    let Ok(entries) = std::fs::read_dir(&dir) else { return Ok(Vec::new()) };
    let mut out: Vec<serde_json::Value> = entries
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter(|e| e.metadata().is_ok_and(|m| m.len() < 2 * 1024 * 1024))
        .filter_map(|e| std::fs::read(e.path()).ok())
        .filter_map(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .filter(|v| v.get("v") == Some(&serde_json::json!(1)) && v.get("id").and_then(|i| i.as_str()).is_some())
        .collect();
    out.sort_by(|a, b| b["created_at"].as_str().unwrap_or("").cmp(a["created_at"].as_str().unwrap_or("")));
    Ok(out)
}

/// A draft people opened in Prepare (#252 UI4): it stops waiting and the assistant can no longer
/// revise it. `by`: the operator's name, when set. Returns the draft as now saved.
#[tauri::command]
pub fn ai_draft_mark_opened(app: AppHandle, id: String, by: Option<String>) -> Result<serde_json::Value, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    crate::mcp_drafts::mark_opened(&dir, &id, by.as_deref())
}

/// Drafts from a backup's installation part (#252 AccF), put back when not here already. Returns how many.
#[tauri::command]
pub fn ai_drafts_restore(app: AppHandle, drafts: Vec<serde_json::Value>) -> Result<usize, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(crate::mcp_drafts::restore(&dir, &drafts))
}

/// Remove a draft (after it was opened, or when it is not wanted).
#[tauri::command]
pub fn ai_draft_delete(app: AppHandle, id: String) -> Result<(), String> {
    // An id is a UUID: nothing else may name a file here.
    if id.len() != 36 || !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err("not a draft id".into());
    }
    let path = drafts_dir(&app)?.join(format!("{id}.json"));
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
