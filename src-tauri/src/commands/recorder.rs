//! Native service recording (C1, `docs/contracts/recorder-v1.md` §4). Only the main desk window may
//! start, stop or mark; frames reach the recorder through `push_ndi_frame` / `push_ndi_region`, and
//! only from the pinned output's own window.

use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use rhema_broadcast::ndi::NdiRuntime;
use rhema_recorder::{ProblemCode, Recorder, RecorderMarker, RecorderProblem, RecorderStartRequest, RecorderState, RecorderStatus, RecordingManifest};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use super::broadcast::window_label;

/// Set once the app data folder is known (`<app data>/recordings`).
pub struct RecorderHost(pub OnceLock<Recorder>);

type Res<T> = Result<T, RecorderProblem>;

fn recorder(host: &RecorderHost) -> Res<&Recorder> {
    host.0.get().ok_or_else(|| RecorderProblem::new(ProblemCode::WriteFailed, "The recordings folder is not available."))
}

fn main_desk_only(window: &WebviewWindow) -> Res<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(RecorderProblem::new(ProblemCode::NotAllowed, "Recording is started and stopped from the main desk."))
    }
}

/// What the output's window will send: the NDI size while NDI runs on it (one readback feeds both), else the profile's.
fn frame_size(ndi: &Mutex<NdiRuntime>, req: &RecorderStartRequest) -> (u32, u32) {
    let ndi = ndi.lock().ok().and_then(|n| n.current_info(&req.output_id));
    ndi.map_or_else(|| { let (w, h, _) = req.profile.size(); (w, h) }, |i| (i.width, i.height))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecorderPreflight {
    ok: bool,
    problems: Vec<RecorderProblem>,
    width: u32,
    height: u32,
    disk_free_bytes: Option<u64>,
    audio_devices: Vec<String>,
}

#[tauri::command]
pub fn recorder_preflight(app: AppHandle, host: State<'_, RecorderHost>, ndi: State<'_, Mutex<NdiRuntime>>, request: RecorderStartRequest) -> Res<RecorderPreflight> {
    let rec = recorder(&host)?;
    let mut problems = rec.preflight(&request);
    if window_label(&request.output_id).ok().and_then(|l| app.get_webview_window(&l)).is_none() {
        problems.push(RecorderProblem::new(ProblemCode::OutputWindowMissing, "Open this screen first: Rhema records what its window shows."));
    }
    let (width, height) = frame_size(&ndi, &request);
    Ok(RecorderPreflight { ok: problems.is_empty(), problems, width, height, disk_free_bytes: rhema_recorder::disk_free(rec.folder()), audio_devices: rhema_recorder::audio::devices() })
}

#[tauri::command]
pub fn recorder_start(app: AppHandle, window: WebviewWindow, request: RecorderStartRequest) -> Res<RecorderStatus> {
    main_desk_only(&window)?;
    start_session(&app, &request)
}

#[tauri::command]
pub fn recorder_stop(app: AppHandle, window: WebviewWindow) -> Res<RecorderStatus> {
    main_desk_only(&window)?;
    stop_session(&app)
}

fn start_session(app: &AppHandle, request: &RecorderStartRequest) -> Res<RecorderStatus> {
    let host = app.state::<RecorderHost>();
    let rec = recorder(&host)?;
    let label = window_label(&request.output_id).map_err(|e| RecorderProblem::new(ProblemCode::OutputNotRecordable, e))?;
    if app.get_webview_window(&label).is_none() {
        return Err(RecorderProblem::new(ProblemCode::OutputWindowMissing, "Open this screen first: Rhema records what its window shows."));
    }
    let ndi = app.state::<Mutex<NdiRuntime>>();
    let (width, height) = frame_size(&ndi, request);
    let status = rec.start(request, width, height)?;
    log::info!("recorder: started {} on output {} at {width}x{height}", status.session_id.as_deref().unwrap_or("?"), request.output_id);
    // The output's window starts handing its frames to the host (if NDI isn't already making it).
    let _ = app.emit_to(tauri::EventTarget::webview_window(label.as_str()), "broadcast:record-tee", tee(true, width, height, status.video.fps));
    spawn_status_beat(app.clone(), status.session_id.clone());
    let _ = app.emit_to("main", "recorder:status", &status);
    Ok(status)
}

fn stop_session(app: &AppHandle) -> Res<RecorderStatus> {
    let host = app.state::<RecorderHost>();
    let rec = recorder(&host)?;
    let output = rec.pinned_output();
    let status = rec.stop()?;
    log::info!("recorder: {:?} {}", status.state, status.file.path.as_deref().unwrap_or(""));
    if let Some(label) = output.and_then(|o| window_label(&o).ok()) {
        let _ = app.emit_to(tauri::EventTarget::webview_window(label.as_str()), "broadcast:record-tee", tee(false, 0, 0, 0));
    }
    let _ = app.emit_to("main", "recorder:status", &status);
    Ok(status)
}

/// A desk the host granted the recorder (the control server checked `KeyEntry::record`): start
/// with the main desk's last setup, stop, or mark. `args`: `{action, label, by}`.
pub fn remote(app: &AppHandle, args: &str) -> Res<()> {
    let v: serde_json::Value = serde_json::from_str(args).map_err(|_| RecorderProblem::new(ProblemCode::NotAllowed, "bad recorder request"))?;
    let by = v.get("by").and_then(serde_json::Value::as_str).unwrap_or("a desk");
    match v.get("action").and_then(serde_json::Value::as_str) {
        Some("start") => {
            let host = app.state::<RecorderHost>();
            let request = recorder(&host)?.last_request().ok_or_else(|| {
                RecorderProblem::new(ProblemCode::NotRecording, "Start the first recording at the main desk: a desk reuses its screen and sound choices.")
            })?;
            log::info!("recorder: start asked by {by}");
            start_session(app, &request).map(drop)
        }
        Some("stop") => {
            log::info!("recorder: stop asked by {by}");
            stop_session(app).map(drop)
        }
        Some("marker") => {
            let host = app.state::<RecorderHost>();
            let label = v.get("label").and_then(serde_json::Value::as_str).filter(|l| !l.is_empty()).unwrap_or("Marker");
            recorder(&host)?.marker(label, by, None, None).map(drop)
        }
        _ => Err(RecorderProblem::new(ProblemCode::NotAllowed, "unknown recorder action")),
    }
}

#[tauri::command]
pub fn recorder_marker(window: WebviewWindow, host: State<'_, RecorderHost>, label: String, service_run_id: Option<String>, item_id: Option<String>) -> Res<RecorderMarker> {
    main_desk_only(&window)?;
    recorder(&host)?.marker(&label, "main desk", service_run_id, item_id)
}

#[tauri::command]
pub fn recorder_status(host: State<'_, RecorderHost>) -> Res<RecorderStatus> {
    Ok(recorder(&host)?.status())
}

#[tauri::command]
pub fn recorder_list(host: State<'_, RecorderHost>, rehearsal: bool) -> Res<Vec<RecordingManifest>> {
    Ok(recorder(&host)?.list(rehearsal))
}

fn tee(active: bool, width: u32, height: u32, fps: u32) -> serde_json::Value {
    serde_json::json!({ "active": active, "width": width, "height": height, "fps": fps })
}

/// `recorder:status` to the main window once a second while this session runs.
fn spawn_status_beat(app: AppHandle, session_id: Option<String>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        let Some(rec) = app.try_state::<RecorderHost>().and_then(|h| h.0.get().map(|r| r.status())) else { return };
        if rec.session_id != session_id || !matches!(rec.state, RecorderState::Recording | RecorderState::Failed) || app.get_webview_window("main").is_none() {
            return;
        }
        let _ = app.emit_to("main", "recorder:status", &rec);
    });
}
