//! Closing the main window with an unsaved service (PRD FR-03 "explicit
//! handling of unsaved work"). The frontend reports whether there is
//! unsaved work; a close request while there is gets held once and the
//! frontend asks. A second close request always goes through, so a hung
//! page can never trap the operator. Closing the main window quits the app,
//! output windows included.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Emitter, Manager, State, Window, WindowEvent};

#[derive(Default)]
pub struct UnsavedWork(AtomicBool);

/// Whether the last run ended without closing the main window (a crash, a forced quit, power):
/// `running.lock` in the app data folder is made at start and removed on a clean close.
#[derive(Default)]
pub struct LastExit {
    pub unclean: AtomicBool,
    pub lock: std::sync::Mutex<Option<std::path::PathBuf>>,
}

/// At start: note whether the previous run left its lock behind, then make ours.
pub fn mark_running(state: &LastExit, dir: &std::path::Path) {
    let lock = dir.join("running.lock");
    state.unclean.store(lock.exists(), Ordering::SeqCst);
    if std::fs::create_dir_all(dir).is_ok() && std::fs::write(&lock, b"rhema").is_ok() {
        if let Ok(mut l) = state.lock.lock() {
            *l = Some(lock);
        }
    }
}

/// The last run ended without a clean close (the frontend then offers to put back what was on air).
#[tauri::command]
pub fn last_exit_unclean(state: State<'_, LastExit>) -> bool {
    state.unclean.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn set_unsaved_work(state: State<'_, UnsavedWork>, unsaved: bool) {
    state.0.store(unsaved, Ordering::SeqCst);
}

/// Close the main window for real (after Save and quit, or Quit without saving).
#[tauri::command]
pub fn close_main_window(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.destroy();
    }
}

/// `on_window_event` hook: hold the first close of the main window while there is unsaved work.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            // swap: the flag is cleared, so the next close request is not held.
            if window.state::<UnsavedWork>().0.swap(false, Ordering::SeqCst) {
                api.prevent_close();
                let _ = window.emit("app:close-requested", ());
            }
        }
        // Closing the main window quits Rhema. Otherwise projector and hidden
        // NDI windows kept the process alive with no way back in: a new launch
        // only focuses the (gone) main window of the running copy.
        WindowEvent::Destroyed => {
            // A clean close: no recovery offer next time.
            if let Ok(l) = window.state::<LastExit>().lock.lock() {
                if let Some(path) = l.as_ref() {
                    let _ = std::fs::remove_file(path);
                }
            }
            window.app_handle().exit(0);
        }
        _ => {}
    }
}

/// macOS: the default menu's Quit (Cmd+Q) sends `-[NSApp terminate:]`. tao
/// handles only `applicationWillTerminate`, so Tauri gets no `ExitRequested`
/// it could hold and the app quits without the unsaved-service question
/// (checked in tao 0.35.3 / tauri-runtime-wry 2.11.4). Replace that item
/// with one that closes the main window, which goes through
/// `on_window_event` like the window's close button. Quitting from the Dock
/// or at logout still goes through `terminate:` (not held; KNOWN-ISSUES).
#[cfg(target_os = "macos")]
pub fn route_quit_through_close(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};
    const QUIT_ID: &str = "rhema-quit";
    let menu = match app.menu() {
        Some(menu) => menu,
        None => Menu::default(app.handle())?,
    };
    let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() else { return Ok(()) };
    let items = app_menu.items()?;
    let Some(pos) = items.iter().rposition(|item| matches!(item, MenuItemKind::Predefined(p) if p.text().is_ok_and(|t| t.starts_with("Quit")))) else {
        return Ok(());
    };
    app_menu.remove_at(pos)?;
    let label = format!("Quit {}", app.package_info().name);
    app_menu.insert(&MenuItem::with_id(app, QUIT_ID, label, true, Some("CmdOrCtrl+Q"))?, pos)?;
    app.set_menu(menu)?;
    log::info!("[app_close] Quit (Cmd+Q) now asks about unsaved work");
    app.on_menu_event(|app, event| {
        if event.id() == QUIT_ID {
            match app.get_webview_window("main") {
                Some(main) => {
                    let _ = main.close();
                }
                None => app.exit(0),
            }
        }
    });
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_left_lock_means_the_last_run_ended_unclean() {
        let dir = std::env::temp_dir().join(format!("rhema-lastexit-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let first = LastExit::default();
        mark_running(&first, &dir);
        assert!(!first.unclean.load(Ordering::SeqCst), "a first run is clean");
        let second = LastExit::default();
        mark_running(&second, &dir); // the first never removed its lock
        assert!(second.unclean.load(Ordering::SeqCst));
        std::fs::remove_file(dir.join("running.lock")).unwrap(); // a clean close
        let third = LastExit::default();
        mark_running(&third, &dir);
        assert!(!third.unclean.load(Ordering::SeqCst));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
