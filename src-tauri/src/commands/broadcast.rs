#![expect(clippy::needless_pass_by_value, reason = "Tauri command extractors require pass-by-value")]

use std::sync::Mutex;

use serde::Serialize;
use tauri::State;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use rhema_broadcast::ndi::{FrameRegion, NdiRuntime, NdiSessionInfo, NdiStartRequest};

/// Map `output_id` to its Tauri window label (`broadcast-{id}`).
///
/// Output ids are caller-supplied and end up in the window label and URL, so
/// they are restricted to a safe charset. The capability files grant
/// permissions to `broadcast-*`, which covers every label produced here.
pub(crate) fn window_label(output_id: &str) -> Result<String, String> {
    let valid = !output_id.is_empty()
        && output_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !valid {
        return Err(format!("invalid broadcast output id: {output_id:?}"));
    }
    Ok(format!("broadcast-{output_id}"))
}

/// Map `output_id` to broadcast-output.html URL with query param.
fn window_url(output_id: &str) -> String {
    format!("broadcast-output.html?output={output_id}")
}

#[derive(Serialize)]
pub struct MonitorInfo {
    pub name: String,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub fn list_monitors(app: tauri::AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let monitors = app.available_monitors().map_err(|e| {
        log::error!("list_monitors: available_monitors failed: {e}");
        e.to_string()
    })?;
    log::info!("list_monitors: {} monitor(s) detected", monitors.len());
    Ok(monitors
        .iter()
        .map(|m| {
            let size = m.size();
            MonitorInfo {
                name: m.name().cloned().unwrap_or_else(|| "Unknown".to_string()),
                width: size.width,
                height: size.height,
            }
        })
        .collect())
}

/// Ensure the broadcast window for a given output exists (creates hidden if not).
///
/// Async on purpose: on Windows, building a webview window from a synchronous
/// command deadlocks — the command blocks the thread the window creation
/// needs to dispatch to, and `build()` never returns.
#[tauri::command]
pub async fn ensure_broadcast_window(
    app: tauri::AppHandle,
    output_id: String,
    title: Option<String>,
) -> Result<(), String> {
    let label = window_label(&output_id)?;
    if app.get_webview_window(&label).is_some() {
        return Ok(());
    }
    WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::App(window_url(&output_id).into()),
    )
    .title(title.unwrap_or_else(|| "Rhema Output".to_string()))
    .inner_size(1920.0, 1080.0)
    .visible(false)
        // An output keeps drawing while hidden (NDI) or covered: without this,
        // macOS throttles its timers to about once a second, so a ticker,
        // a lower third's entrance or a video reach NDI at 1 fps.
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
    .skip_taskbar(true)
    .focused(false)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Async on purpose — see [`ensure_broadcast_window`]: sync window creation
/// deadlocks on Windows.
/// Put the window over `monitor` (before it goes full screen on macOS).
fn place_on_monitor(window: &tauri::WebviewWindow, monitor: &tauri::Monitor) -> Result<(), String> {
    let pos = monitor.position();
    let size = monitor.size();
    #[cfg(target_os = "macos")]
    {
        // Leave full screen first (a reused window may be full screen on another
        // screen), then place it in points: macOS mixes scales across screens
        // (a Retina laptop at 2, a projector at 1), so physical pixels are
        // converted with the wrong screen's factor.
        let _ = window.set_fullscreen(false);
        let scale = monitor.scale_factor();
        let at: tauri::LogicalPosition<f64> = pos.to_logical(scale);
        let fits: tauri::LogicalSize<f64> = size.to_logical(scale);
        window.set_position(tauri::Position::Logical(at)).map_err(|e| {
            log::error!("open_broadcast_window: set_position failed: {e}");
            e.to_string()
        })?;
        window.set_size(tauri::Size::Logical(fits)).map_err(|e| {
            log::error!("open_broadcast_window: set_size failed: {e}");
            e.to_string()
        })?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        window
            .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: pos.x,
                y: pos.y,
            }))
            .map_err(|e| {
                log::error!("open_broadcast_window: set_position failed: {e}");
                e.to_string()
            })?;
        window
            .set_size(tauri::Size::Physical(tauri::PhysicalSize {
                width: size.width,
                height: size.height,
            }))
            .map_err(|e| {
                log::error!("open_broadcast_window: set_size failed: {e}");
                e.to_string()
            })?;
    }
    Ok(())
}

/// A movable window (960×540 points) in the middle of `monitor`, out of full screen.
fn place_windowed(window: &tauri::WebviewWindow, monitor: &tauri::Monitor) -> Result<(), String> {
    let _ = window.set_fullscreen(false);
    let scale = monitor.scale_factor();
    let at: tauri::LogicalPosition<f64> = monitor.position().to_logical(scale);
    let fits: tauri::LogicalSize<f64> = monitor.size().to_logical(scale);
    let (w, h) = (960.0_f64.min(fits.width), 540.0_f64.min(fits.height));
    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize::new(w, h)))
        .and_then(|()| {
            window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
                at.x + (fits.width - w) / 2.0,
                at.y + (fits.height - h) / 2.0,
            )))
        })
        .map_err(|e| {
            log::error!("open_broadcast_window: placing the window failed: {e}");
            e.to_string()
        })
}

#[tauri::command]
pub async fn open_broadcast_window(
    app: tauri::AppHandle,
    output_id: String,
    monitor_index: usize,
    title: Option<String>,
    windowed: Option<bool>,
) -> Result<(), String> {
    // A window the operator can move and resize (signage on their own screen), not a full-screen projector.
    let windowed = windowed.unwrap_or(false);
    log::info!("open_broadcast_window: output={output_id}, monitor_index={monitor_index}");
    let label = window_label(&output_id)?;
    let monitors = app.available_monitors().map_err(|e| {
        log::error!("open_broadcast_window: available_monitors failed: {e}");
        e.to_string()
    })?;
    let monitor = monitors.get(monitor_index).ok_or_else(|| {
        let msg = format!(
            "Monitor index {monitor_index} out of range ({} available)",
            monitors.len()
        );
        log::error!("open_broadcast_window: {msg}");
        msg
    })?;

    let pos = monitor.position();
    let size = monitor.size();
    log::info!(
        "open_broadcast_window: target monitor pos=({},{}) size={}x{} scale={}",
        pos.x,
        pos.y,
        size.width,
        size.height,
        monitor.scale_factor()
    );

    // Reuse the window if it already exists (e.g. hidden for NDI), otherwise
    // create it hidden and without geometry: the builder's position/inner_size
    // take logical pixels, so passing the monitor's physical values gets
    // re-multiplied by the scale factor on scaled displays (Windows commonly
    // runs 125-150%), pushing the window off the target monitor. Physical
    // setters after the fact are unambiguous on both paths.
    let window = if let Some(window) = app.get_webview_window(&label) {
        log::info!("open_broadcast_window: reusing existing window '{label}'");
        window
    } else {
        log::info!("open_broadcast_window: creating window '{label}'");
        WebviewWindowBuilder::new(
            &app,
            &label,
            WebviewUrl::App(window_url(&output_id).into()),
        )
        .title(title.unwrap_or_else(|| "Rhema Output".to_string()))
        .visible(false)
        // An output keeps drawing while hidden (NDI) or covered: without this,
        // macOS throttles its timers to about once a second, so a ticker,
        // a lower third's entrance or a video reach NDI at 1 fps.
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        .always_on_top(false)
        .skip_taskbar(false)
        .focused(false)
        .decorations(windowed)
        // macOS makes a window full screen on the screen it is created on (the
        // operator's), and a full-screen window ignores later moves: there it
        // goes full screen only after it is on the target monitor (below).
        .fullscreen(!windowed && !cfg!(target_os = "macos"))
        .minimizable(windowed)
        .build()
        .map_err(|e| {
            log::error!("open_broadcast_window: window build failed: {e}");
            e.to_string()
        })?
    };

    if windowed {
        place_windowed(&window, monitor)?;
    } else {
        place_on_monitor(&window, monitor)?;
    }
    let _ = window.set_decorations(windowed);
    // A window created hidden for NDI has skip_taskbar(true); make sure the
    // visible projector is reachable from the taskbar either way.
    let _ = window.set_skip_taskbar(false);
    window.show().map_err(|e| {
        log::error!("open_broadcast_window: show failed: {e}");
        e.to_string()
    })?;
    // On the target monitor now: full screen there (macOS; elsewhere it was built full screen).
    #[cfg(target_os = "macos")]
    if !windowed {
        if let Err(e) = window.set_fullscreen(true) {
            log::warn!("open_broadcast_window: set_fullscreen failed: {e}");
        }
    }
    let _ = window.set_focus();
    if let (Ok(p), Some(m)) = (window.outer_position(), window.current_monitor().ok().flatten()) {
        log::info!("open_broadcast_window: '{label}' is at ({},{}) on {:?}", p.x, p.y, m.name());
    }
    log::info!("open_broadcast_window: '{label}' shown at ({},{}) {}x{}", pos.x, pos.y, size.width, size.height);

    Ok(())
}

/// Async on purpose — `Window::hide`/`close` also round-trip through the
/// main thread and can deadlock in a sync command on Windows.
#[tauri::command]
pub async fn close_broadcast_window(
    app: tauri::AppHandle,
    output_id: String,
    runtime: State<'_, Mutex<NdiRuntime>>,
) -> Result<(), String> {
    let label = window_label(&output_id)?;
    if let Some(window) = app.get_webview_window(&label) {
        let ndi_active = runtime
            .lock()
            .map_err(|e| e.to_string())?
            .is_active(&output_id);
        if ndi_active {
            log::info!("close_broadcast_window: NDI active for '{output_id}', hiding window instead of closing");
            window.hide().map_err(|e| {
                log::error!("close_broadcast_window: hide failed: {e}");
                e.to_string()
            })?;
        } else {
            log::info!("close_broadcast_window: closing '{output_id}' window");
            window.close().map_err(|e| {
                log::error!("close_broadcast_window: close failed: {e}");
                e.to_string()
            })?;
        }
    } else {
        log::info!("close_broadcast_window: no '{output_id}' window to close");
    }
    Ok(())
}

#[tauri::command]
pub fn start_ndi(
    output_id: String,
    runtime: State<'_, Mutex<NdiRuntime>>,
    request: NdiStartRequest,
) -> Result<NdiSessionInfo, String> {
    let mut runtime = runtime.lock().map_err(|e| e.to_string())?;
    runtime.start(output_id, request).map_err(|e| {
        log::error!("start_ndi failed: {e}");
        e.to_string()
    })
}

#[tauri::command]
pub fn stop_ndi(output_id: String, runtime: State<'_, Mutex<NdiRuntime>>) -> Result<(), String> {
    let mut runtime = runtime.lock().map_err(|e| e.to_string())?;
    runtime.stop(&output_id);
    Ok(())
}

#[derive(Serialize)]
pub struct NdiStatusResponse {
    pub active: bool,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// Receivers connected right now; `None` when the runtime cannot say.
    pub receivers: Option<i32>,
    /// Frames sent since it started: two readings give the frames a second really sent.
    #[serde(rename = "framesSent")]
    pub frames_sent: Option<u64>,
}

#[tauri::command]
pub fn get_ndi_status(
    output_id: String,
    runtime: State<'_, Mutex<NdiRuntime>>,
) -> Result<Option<NdiStatusResponse>, String> {
    let runtime = runtime.lock().map_err(|e| e.to_string())?;
    match runtime.current_info(&output_id) {
        Some(info) => Ok(Some(NdiStatusResponse {
            active: true,
            width: info.width,
            height: info.height,
            fps: info.fps,
            receivers: runtime.receivers(&output_id),
            frames_sent: runtime.frames_sent(&output_id),
        })),
        None => Ok(None),
    }
}

/// One NDI frame: the RGBA bytes as the raw request body (no base64, no JSON:
/// at 720p that was ~5 MB of text per frame), the output and size in headers.
/// Stays synchronous so frames reach the sender in order.
#[tauri::command]
pub fn push_ndi_frame(
    webview: tauri::Webview,
    runtime: State<'_, Mutex<NdiRuntime>>,
    recorder: State<'_, super::recorder::RecorderHost>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let header = |name: &str| -> Result<String, String> {
        request.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_owned).ok_or_else(|| format!("missing {name}"))
    };
    let output_id = header("x-ndi-output")?;
    let width: u32 = header("x-ndi-width")?.parse().map_err(|_| "bad x-ndi-width".to_string())?;
    let height: u32 = header("x-ndi-height")?.parse().map_err(|_| "bad x-ndi-height".to_string())?;
    let tauri::ipc::InvokeBody::Raw(rgba) = request.body() else {
        return Err("expected the frame as raw bytes".into());
    };
    check_frame_len(rgba.len(), width, height)?;
    // One readback feeds both: the recorder (only from the output's own window, so no Stage or
    // preview window can pass its picture off as this output's) and NDI.
    let recorded = own_window(&webview, &output_id) && recorder.0.get().is_some_and(|r| r.push_frame(&output_id, width, height, rgba));
    let mut runtime = runtime.lock().map_err(|e| e.to_string())?;
    if recorded && !runtime.is_active(&output_id) {
        return Ok(());
    }
    runtime.send_frame_rgba(&output_id, width, height, rgba).map_err(|e| e.to_string())
}

fn own_window(webview: &tauri::Webview, output_id: &str) -> bool {
    window_label(output_id).is_ok_and(|l| webview.label() == l)
}

/// Like [`push_ndi_frame`] for one region of the frame (headers `x-ndi-x`,
/// `x-ndi-y`, `x-ndi-width`, `x-ndi-height`): the rest stays as last sent.
#[tauri::command]
pub fn push_ndi_region(
    webview: tauri::Webview,
    runtime: State<'_, Mutex<NdiRuntime>>,
    recorder: State<'_, super::recorder::RecorderHost>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let header = |name: &str| -> Result<u32, String> {
        request.headers().get(name).and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok()).ok_or_else(|| format!("missing or bad {name}"))
    };
    let output_id = request.headers().get("x-ndi-output").and_then(|v| v.to_str().ok()).ok_or("missing x-ndi-output")?.to_owned();
    let region = FrameRegion { x: header("x-ndi-x")?, y: header("x-ndi-y")?, width: header("x-ndi-width")?, height: header("x-ndi-height")? };
    let tauri::ipc::InvokeBody::Raw(rgba) = request.body() else {
        return Err("expected the region as raw bytes".into());
    };
    let recorded = own_window(&webview, &output_id)
        && region.x == 0
        && recorder.0.get().is_some_and(|r| r.push_region(&output_id, region.y, region.width, region.height, rgba));
    let mut runtime = runtime.lock().map_err(|e| e.to_string())?;
    if recorded && !runtime.is_active(&output_id) {
        return Ok(());
    }
    runtime.send_region_rgba(&output_id, region, rgba).map_err(|e| e.to_string())
}

/// Running frame pacers, by output id (each a flag that stops its thread).
#[derive(Default)]
pub struct OutputPacers(Mutex<std::collections::HashMap<String, std::sync::Arc<std::sync::atomic::AtomicBool>>>);

/// Send `broadcast:pace` to an output's window `fps` times a second (0 stops).
/// The window draws a frame on each: a hidden (NDI) window's own timers are
/// throttled by `WebKit` to about one a second, events from here are not.
#[tauri::command]
pub fn set_output_pace(app: tauri::AppHandle, pacers: State<'_, OutputPacers>, output_id: String, fps: u32) -> Result<(), String> {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::{Duration, Instant};
    use tauri::Emitter;
    let label = window_label(&output_id)?;
    let mut running = pacers.0.lock().map_err(|e| e.to_string())?;
    if let Some(stop) = running.remove(&output_id) {
        stop.store(true, Ordering::Relaxed);
    }
    if fps == 0 {
        return Ok(());
    }
    let stop = std::sync::Arc::new(AtomicBool::new(false));
    running.insert(output_id, stop.clone());
    let period = Duration::from_secs_f64(1.0 / f64::from(fps.clamp(1, 60)));
    std::thread::spawn(move || {
        let mut next = Instant::now();
        // Stops when told to, or when the window is gone.
        while !stop.load(Ordering::Relaxed) && app.get_webview_window(&label).is_some() {
            // The webview window itself: a bare label also reaches it as a window and as a webview (each frame two or three times).
            let _ = app.emit_to(tauri::EventTarget::webview_window(label.as_str()), "broadcast:pace", ());
            next += period;
            let now = Instant::now();
            if next > now {
                std::thread::sleep(next - now);
            } else {
                next = now;
            }
        }
    });
    Ok(())
}

/// A frame is exactly width × height RGBA pixels.
fn check_frame_len(len: usize, width: u32, height: u32) -> Result<(), String> {
    let expected = (width as usize).checked_mul(height as usize).and_then(|p| p.checked_mul(4)).ok_or("frame too large")?;
    if len == expected {
        Ok(())
    } else {
        Err(format!("frame is {len} bytes, expected {expected} for {width}x{height}"))
    }
}

#[cfg(test)]
mod tests {
    use super::{check_frame_len, window_label};

    #[test]
    fn a_frame_must_be_exactly_its_pixels() {
        assert!(check_frame_len(1280 * 720 * 4, 1280, 720).is_ok());
        assert!(check_frame_len(1280 * 720 * 4 - 1, 1280, 720).is_err());
        assert!(check_frame_len(0, u32::MAX, u32::MAX).is_err());
    }

    #[test]
    fn window_label_formats_valid_ids() {
        assert_eq!(window_label("main").unwrap(), "broadcast-main");
        assert_eq!(
            window_label("3f2a9c10-4b7e-4d2a-9c51-8e6f0a1b2c3d").unwrap(),
            "broadcast-3f2a9c10-4b7e-4d2a-9c51-8e6f0a1b2c3d"
        );
        assert_eq!(window_label("out_2").unwrap(), "broadcast-out_2");
    }

    #[test]
    fn window_label_rejects_unsafe_ids() {
        assert!(window_label("").is_err());
        assert!(window_label("has space").is_err());
        assert!(window_label("dot.dot").is_err());
        assert!(window_label("query?x=1").is_err());
        assert!(window_label("slash/id").is_err());
    }
}
