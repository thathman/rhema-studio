//! Settings and themes live in JSON files read by the store plugin, which
//! treats an unreadable file as empty: the app would start on defaults with
//! no word (paired phones, keys, cues and custom themes gone) and the first
//! change would save defaults over the damaged file. Before anything loads,
//! a file that does not parse is set aside under a dated name and the
//! window is told (RG-05, J07). A good file is copied to `<name>.last-good`
//! at each start, so a file cut off by a crash mid-save (the store plugin
//! overwrites in place) comes back as it was when the app last started.

use std::path::Path;
use std::sync::Mutex;

use tauri::State;

/// Files set aside at startup: (original name, new name, recovered from the last good copy).
#[derive(Default)]
pub struct DamagedStoreFiles(pub Mutex<Vec<(String, String, bool)>>);

fn is_store_object(bytes: &[u8]) -> bool {
    serde_json::from_slice::<serde_json::Value>(bytes).is_ok_and(|v| v.is_object())
}

pub const STORE_FILES: [&str; 2] = ["settings.json", "broadcast-themes.json"];

/// Rename each damaged store file in `dir` to `<name>.damaged-<unix seconds>` and put the
/// last good copy back when there is one; copy each good file to `<name>.last-good`.
pub fn set_aside_damaged(dir: &Path, now_secs: u64) -> Vec<(String, String, bool)> {
    let mut moved = Vec::new();
    for name in STORE_FILES {
        let path = dir.join(name);
        let last_good = dir.join(format!("{name}.last-good"));
        let Ok(bytes) = std::fs::read(&path) else { continue };
        // The store keeps an object; anything else (cut off, or not an object) would be read as empty.
        if is_store_object(&bytes) {
            if let Err(e) = std::fs::write(&last_good, &bytes) {
                log::warn!("could not keep a last good copy of {name}: {e}");
            }
            continue;
        }
        let aside = format!("{name}.damaged-{now_secs}");
        if let Err(e) = std::fs::rename(&path, dir.join(&aside)) {
            log::error!("damaged {name} could not be set aside: {e}");
            continue;
        }
        let recovered = std::fs::read(&last_good).is_ok_and(|b| is_store_object(&b)) && std::fs::copy(&last_good, &path).is_ok();
        moved.push((name.to_string(), aside, recovered));
    }
    moved
}

/// What was set aside this run (shown once by the window).
#[tauri::command]
pub fn damaged_store_files(state: State<'_, DamagedStoreFiles>) -> Vec<(String, String, bool)> {
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
        // Parses, but is not what the store keeps: set aside too.
        let other = dir.join("other");
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(other.join("settings.json"), b"[]").unwrap();
        assert_eq!(set_aside_damaged(&other, 1).len(), 1);
        let moved = set_aside_damaged(&dir, 1_700_000_000);
        assert_eq!(moved, vec![("settings.json".to_string(), "settings.json.damaged-1700000000".to_string(), false)]);
        assert!(dir.join("settings.json.damaged-1700000000").exists());
        assert!(!dir.join("settings.json").exists());
        assert!(dir.join("broadcast-themes.json").exists());
        // The good file was kept as the last good copy; cut off next time, it comes back from it.
        assert!(dir.join("broadcast-themes.json.last-good").exists());
        std::fs::write(dir.join("broadcast-themes.json"), b"{\"customThemes\": [").unwrap();
        let moved = set_aside_damaged(&dir, 1_700_000_001);
        assert_eq!(moved, vec![("broadcast-themes.json".to_string(), "broadcast-themes.json.damaged-1700000001".to_string(), true)]);
        assert_eq!(std::fs::read(dir.join("broadcast-themes.json")).unwrap(), b"{}");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
