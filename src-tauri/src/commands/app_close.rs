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
        WindowEvent::Destroyed => window.app_handle().exit(0),
        _ => {}
    }
}
