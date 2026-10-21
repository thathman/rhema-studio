//! Settings and themes live in JSON files read by the store plugin, which
//! treats an unreadable file as empty: the app would start on defaults with
//! no word (paired phones, keys, cues and custom themes gone) and the first
//! change would save defaults over the damaged file. Before anything loads,
//! a file that does not parse is set aside under a dated name and the
//! window is told (RG-05, J07).

use std::path::Path;
use std::sync::Mutex;

use tauri::State;

/// Files set aside at startup: (original name, new name).
#[derive(Default)]
pub struct DamagedStoreFiles(pub Mutex<Vec<(String, String)>>);

pub const STORE_FILES: [&str; 2] = ["settings.json", "broadcast-themes.json"];

/// Rename each damaged store file in `dir` to `<name>.damaged-<unix seconds>`; returns what was moved.
pub fn set_aside_damaged(dir: &Path, now_secs: u64) -> Vec<(String, String)> {
    let mut moved = Vec::new();
    for name in STORE_FILES {
        let path = dir.join(name);
        let Ok(bytes) = std::fs::read(&path) else { continue };
        if serde_json::from_slice::<serde_json::Value>(&bytes).is_ok() {
            continue;
        }
        let aside = format!("{name}.damaged-{now_secs}");
        match std::fs::rename(&path, dir.join(&aside)) {
            Ok(()) => moved.push((name.to_string(), aside)),
            Err(e) => log::error!("damaged {name} could not be set aside: {e}"),
        }
    }
    moved
}

/// What was set aside this run (shown once by the window).
#[tauri::command]
pub fn damaged_store_files(state: State<'_, DamagedStoreFiles>) -> Vec<(String, String)> {
    state.0.lock().map(|mut v| std::mem::take(&mut *v)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::set_aside_damaged;

    #[test]
    fn damaged_files_are_set_aside_and_good_ones_left() {
        let dir = std::env::temp_dir().join(format!("rhema-store-check-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("settings.json"), b"{\"operatorName\": \"Tolu\"").unwrap(); // cut off
        std::fs::write(dir.join("broadcast-themes.json"), b"{}").unwrap();
        let moved = set_aside_damaged(&dir, 1_700_000_000);
        assert_eq!(moved, vec![("settings.json".to_string(), "settings.json.damaged-1700000000".to_string())]);
        assert!(dir.join("settings.json.damaged-1700000000").exists());
        assert!(!dir.join("settings.json").exists());
        assert!(dir.join("broadcast-themes.json").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
