//! The icon in the menu bar (macOS) or notification area (Windows): Open, Start with the computer
//! (off until turned on), Quit. The companion keeps running there when its window is closed.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_autostart::ManagerExt;

/// The menu's "Start with the computer" tick, kept in step when the window changes it.
struct StartTick(CheckMenuItem<Wry>);

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let on = app.autolaunch().is_enabled().unwrap_or(false);
    let open = MenuItem::with_id(app, "open", "Open Rhema Studio Companion", true, None::<&str>)?;
    let start = CheckMenuItem::with_id(app, "start", "Start with the computer", true, on, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Rhema Studio Companion", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &start, &PredefinedMenuItem::separator(app)?, &quit])?;
    app.manage(StartTick(start));
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Rhema Studio Companion")
        .menu(&menu)
        // Windows: a click opens the window, the menu is on the right button. macOS: the menu on a click, as menu bar icons do.
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => crate::show(app),
            "start" => {
                let want = app.try_state::<StartTick>().and_then(|t| t.0.is_checked().ok()).unwrap_or(false);
                let _ = set_start(app, want);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                if !cfg!(target_os = "macos") {
                    crate::show(tray.app_handle());
                }
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Start with the computer, or not; the tray's tick follows what the system now has.
fn set_start(app: &AppHandle, on: bool) -> Result<bool, String> {
    let launch = app.autolaunch();
    let done = if on { launch.enable() } else { launch.disable() };
    let now = launch.is_enabled().unwrap_or(false);
    if let Some(t) = app.try_state::<StartTick>() {
        let _ = t.0.set_checked(now);
    }
    done.map_err(|e| format!("Could not change whether Rhema Studio Companion starts with the computer: {e}"))?;
    log::info!("Start with the computer: {now}");
    Ok(now)
}

/// Whether the companion starts with the computer (off until the operator turns it on).
#[tauri::command]
pub fn autostart_get(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Turn starting with the computer on or off; says what the system now has.
#[tauri::command]
pub fn autostart_set(app: AppHandle, on: bool) -> Result<bool, String> {
    set_start(&app, on)
}
