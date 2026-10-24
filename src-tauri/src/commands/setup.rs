//! The setup's Finish step (#298): where this computer keeps its services and songs, and whether
//! a folder (the church folder) can really be written to. Nothing here changes a file the church
//! keeps: the folder test makes a new file of its own and deletes it again.

#![expect(clippy::needless_pass_by_value, reason = "Tauri command extractors require pass-by-value")]

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::Manager;

/// The database file in the data folder, as opened at start-up (lib.rs).
const DATABASE_FILE: &str = "studio.db";

/// The data folder and the database file in it, for the operator to note down or back up.
#[derive(Debug, Serialize)]
pub struct DataPaths {
    pub folder: String,
    pub database: String,
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| format!("Could not find this computer's data folder: {e}"))
}

#[tauri::command]
pub fn setup_data_paths(app: tauri::AppHandle) -> Result<DataPaths, String> {
    let dir = data_dir(&app)?;
    Ok(DataPaths { database: dir.join(DATABASE_FILE).display().to_string(), folder: dir.display().to_string() })
}

/// Show the database file in Finder / Explorer (the folder itself if the file is not there yet).
/// Only this folder: the window cannot ask to reveal anything else.
#[tauri::command]
pub fn setup_show_data_folder(app: tauri::AppHandle) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let db = dir.join(DATABASE_FILE);
    let target = if db.exists() { db } else { dir };
    tauri_plugin_opener::reveal_item_in_dir(&target).map_err(|e| format!("Could not show the data folder: {e}"))
}

/// Can Rhema write in `dir`? Writes a small file under a new name (created only if no file has
/// that name, so nothing is ever overwritten), flushes it to the device, reads it back and deletes
/// it. `stamp` makes the name unique.
pub fn check_writable(dir: &Path, stamp: u128) -> Result<(), String> {
    let meta = std::fs::metadata(dir).map_err(|e| format!("The folder cannot be reached: {e}"))?;
    if !meta.is_dir() {
        return Err("That is a file, not a folder.".into());
    }
    let probe = dir.join(format!(".rhema-write-test-{}-{stamp}.tmp", std::process::id()));
    // A file already under that name is someone else's: refused, and never touched.
    let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&probe).map_err(|e| format!("Rhema could not write there: {e}"))?;
    let written = (|| -> std::io::Result<()> {
        f.write_all(b"Rhema checks this folder can be written to. Safe to delete.\n")?;
        f.sync_all()?;
        if std::fs::read(&probe)?.is_empty() {
            return Err(std::io::Error::other("the file came back empty"));
        }
        Ok(())
    })();
    drop(f);
    // Our own file goes again, even when writing it failed half-way.
    let removed = std::fs::remove_file(&probe);
    written.map_err(|e| format!("Rhema could not write there: {e}"))?;
    removed.map_err(|e| format!("Rhema wrote a test file but could not delete it ({}): {e}", probe.display()))
}

/// The Finish step's "Test the church folder". Off the main thread: a network share can be slow.
#[tauri::command]
pub async fn setup_test_folder(path: String) -> Result<(), String> {
    let trimmed = path.trim().to_string();
    if trimmed.is_empty() {
        return Err("No folder is chosen.".into());
    }
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_nanos());
    tokio::task::spawn_blocking(move || check_writable(Path::new(&trimmed), stamp))
        .await
        .map_err(|e| format!("Could not test the folder: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::check_writable;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("rhema-setup-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_writable_folder_passes_and_is_left_as_it_was() {
        let dir = temp_dir("ok");
        std::fs::write(dir.join("service.rhema"), b"keep me").unwrap();
        assert_eq!(check_writable(&dir, 1), Ok(()));
        let left: Vec<_> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(left, vec![std::ffi::OsString::from("service.rhema")]);
        assert_eq!(std::fs::read(dir.join("service.rhema")).unwrap(), b"keep me");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn never_overwrites_a_file_that_has_the_test_name() {
        let dir = temp_dir("taken");
        let taken = dir.join(format!(".rhema-write-test-{}-7.tmp", std::process::id()));
        std::fs::write(&taken, b"not ours").unwrap();
        assert!(check_writable(&dir, 7).is_err());
        // Refused before writing: the other file is neither changed nor deleted.
        assert_eq!(std::fs::read(&taken).unwrap(), b"not ours");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_missing_folder_or_a_file_fails_in_words() {
        let dir = temp_dir("missing");
        let gone = dir.join("not-there");
        assert!(check_writable(&gone, 1).unwrap_err().contains("cannot be reached"));
        let file = dir.join("a-file");
        std::fs::write(&file, b"x").unwrap();
        assert_eq!(check_writable(&file, 1), Err("That is a file, not a folder.".into()));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_read_only_folder_fails() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("readonly");
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o555)).unwrap();
        // Root can write anywhere; the check only means something for an ordinary user.
        let can_write_anyway = std::fs::write(dir.join("probe"), b"x").is_ok();
        if !can_write_anyway {
            assert!(check_writable(&dir, 1).unwrap_err().contains("could not write"));
        }
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
