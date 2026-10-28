//! The OBS companion (#209): a computer that runs OBS only. Rhema shows one small screen there
//! (join the host, the church's cameras, add them to this computer's OBS) and loads nothing it
//! does not need: the Bible search models stay unloaded until the computer is the full studio again.

use std::path::Path;

/// Whether this computer is an OBS companion, from its settings file (`companionMode` in the
/// machine part, or at the top in a file an older layout wrote).
#[must_use]
pub fn companion_mode(data_dir: &Path) -> bool {
    let s = crate::mcp::settings(data_dir);
    crate::mcp::setting(&s, "machine", "companionMode").and_then(serde_json::Value::as_bool).unwrap_or(false)
}

/// Start Rhema again (after this computer became, or stopped being, an OBS companion), closing
/// what an orderly exit closes first: the camera router, the listeners, the "still running" mark.
#[tauri::command]
pub fn app_restart(app: tauri::AppHandle) {
    log::info!("Rhema starts again (OBS companion mode changed)");
    super::camera_router::shutdown(&app);
    super::remote::shutdown(&app);
    super::app_close::clear_running(&app);
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn companion_mode_is_read_from_the_machine_part_or_the_top() {
        let dir = std::env::temp_dir().join(format!("rhema-companion-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!companion_mode(&dir), "no settings file: the full studio");
        for (json, want) in [
            (r#"{"machine":{"companionMode":true},"companionMode":true,"settingsLayout":2}"#, true),
            (r#"{"companionMode":true}"#, true),
            (r#"{"machine":{"companionMode":false}}"#, false),
            (r#"{"machine":{"companionMode":"yes"}}"#, false),
            ("not json", false),
        ] {
            std::fs::write(dir.join("settings.json"), json).unwrap();
            assert_eq!(companion_mode(&dir), want, "{json}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
