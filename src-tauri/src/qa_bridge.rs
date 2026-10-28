//! QA bridge for desktop acceptance runs on a real machine (built only with
//! the `qa-bridge` cargo feature, active only when `RHEMA_QA_DIR` is set).
//!
//! A test runner drops `<window-label>__<name>.js` files into
//! `$RHEMA_QA_DIR/in`; each is evaluated in that window of the running app
//! (the real webview, real backend, real output windows) and removed. Scripts
//! report back by emitting `qa:report` with `{ name, body }`, written to
//! `$RHEMA_QA_DIR/out/<name>.json`. Nothing is listened for otherwise, and a
//! normal build does not contain this module.

use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::{AppHandle, Listener, Manager};

/// Start the bridge if `RHEMA_QA_DIR` is set.
pub fn spawn(app: &AppHandle) {
    let Ok(dir) = std::env::var("RHEMA_QA_DIR") else { return };
    let dir = PathBuf::from(dir);
    let (inbox, outbox) = (dir.join("in"), dir.join("out"));
    if std::fs::create_dir_all(&inbox).is_err() || std::fs::create_dir_all(&outbox).is_err() {
        log::error!("[qa] cannot create {}", dir.display());
        return;
    }
    log::warn!("[qa] bridge active on {}", dir.display());

    let out = outbox.clone();
    app.listen_any("qa:report", move |event| {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(event.payload()) else { return };
        let name: String = v.get("name").and_then(|n| n.as_str()).unwrap_or("report").chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
        let body = v.get("body").cloned().unwrap_or(serde_json::Value::Null);
        let _ = std::fs::write(out.join(format!("{name}.json")), serde_json::to_vec_pretty(&body).unwrap_or_default());
    });

    let handle = app.clone();
    std::thread::spawn(move || loop {
        run_inbox(&handle, &inbox);
        std::thread::sleep(Duration::from_millis(250));
    });
}

fn run_inbox(app: &AppHandle, inbox: &Path) {
    let Ok(entries) = std::fs::read_dir(inbox) else { return };
    let mut files: Vec<PathBuf> = entries.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().is_some_and(|x| x == "js")).collect();
    files.sort();
    for path in files {
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()).map(str::to_owned) else { continue };
        let Ok(script) = std::fs::read_to_string(&path) else { continue };
        let _ = std::fs::remove_file(&path);
        let label = stem.split("__").next().unwrap_or("main");
        match app.get_webview_window(label) {
            Some(w) => {
                if let Err(e) = w.eval(format!("window.__RHEMA_QA__ = true;\n{script}")) {
                    log::error!("[qa] eval in {label} failed: {e}");
                }
            }
            None => log::error!("[qa] no window {label} for {stem}"),
        }
    }
}
