//! Rhema Studio Companion (#209): a small app for a computer that runs OBS only. One window (join the
//! church's Rhema, its cameras, add them to this computer's OBS), an icon in the menu bar or
//! notification area that keeps it running when the window is closed, and nothing else: no
//! speech, Bible, NDI, models or content database. Its settings and the host it paired with are
//! its own (in the com.openbezal.rhema.companion data folder), never the studio app's.
#![allow(clippy::needless_pass_by_value, reason = "Tauri commands take their arguments by value")]

mod host;
mod tray;

use tauri::Manager;

/// Given at login when "Start with the computer" is on: start in the tray, window closed.
pub const STARTED_HIDDEN: &str = "--hidden";

/// The app's version as the church's other software counts it (A.B.C.D); Cargo and Tauri take three parts.
pub const VERSION: &str = "1.1.0.0";

/// Bring the window forward (from the tray, a second launch, or the Dock).
pub fn show(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// The settings store sends this computer's phone-remote keys at start (the studio's listener
/// takes them); the companion has no listener, so there is nothing to update.
#[tauri::command]
fn remote_set_keys() {}

/// Saved keys (the host's pairing key, the OBS password) in the system's credential store, under
/// this app's own name.
const KEYCHAIN_NAME: &str = "Rhema Studio Companion";

#[tauri::command(async)]
fn secrets_get() -> Result<Option<String>, String> {
    rhema_join::secrets::get(KEYCHAIN_NAME)
}

#[tauri::command(async)]
fn secrets_set(json: String) -> Result<bool, String> {
    rhema_join::secrets::set(KEYCHAIN_NAME, &json)
}

#[tauri::command]
fn companion_version() -> &'static str {
    VERSION
}

/// Start the app.
///
/// # Panics
/// When Tauri cannot start (no window system, a broken bundle).
pub fn run() {
    tauri::Builder::default()
        // First: a second launch exits at once and brings this copy's window forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show(app)))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: Some("rhema-companion".into()) }),
                ])
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::default().build())
        // Off until the operator turns it on (tray menu or the window).
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![STARTED_HIDDEN])))
        .manage(host::Link::default())
        .setup(|app| {
            tray::build(app.handle())?;
            if !std::env::args().any(|a| a == STARTED_HIDDEN) {
                show(app.handle());
            }
            log::info!("Rhema Studio Companion {VERSION} started");
            Ok(())
        })
        // Closing the window keeps the companion running in the tray: OBS keeps its cameras current.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            host::join_host_certificate,
            host::join_paired_host,
            host::join_pair,
            host::join_me,
            host::join_cameras,
            host::join_tally,
            host::join_connect,
            host::join_disconnect,
            host::host_discover,
            tray::autostart_get,
            tray::autostart_set,
            secrets_get,
            secrets_set,
            remote_set_keys,
            companion_version,
        ])
        .build(tauri::generate_context!())
        .expect("Rhema Studio Companion could not start")
        .run(|app, event| {
            // The Dock icon clicked while the window is closed (macOS).
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
