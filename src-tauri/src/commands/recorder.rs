//! Native service recording (C1, `docs/contracts/recorder-v1.md` §4). Only the main desk window may
//! start, stop or mark; frames reach the recorder through `push_ndi_frame` / `push_ndi_region`, and
//! only from the pinned output's own window.

use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use rhema_api::KeyEntry;
use rhema_broadcast::ndi::NdiRuntime;
use rhema_recorder::{windows_busy_warning, ProblemCode, Recorder, RecorderMarker, RecorderProblem, RecorderStartRequest, RecorderState, RecorderStatus, RecordingManifest};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use super::broadcast::window_label;
use super::content::ContentState;

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

/// The serialized role is supplied by the caller, so replace it with the role in the host's
/// current Live snapshot. Missing or unrecognized outputs receive an invalid role and fail closed.
fn host_scoped_request(request: RecorderStartRequest, live_state: Option<&str>) -> RecorderStartRequest {
    let output_role = if KeyEntry::is_congregation_output(live_state, &request.output_id) {
        "congregation"
    } else {
        ""
    };
    RecorderStartRequest { output_role: output_role.to_string(), ..request }
}

/// Whether a newly published Live State shows the recording's output is no longer a congregation
/// output (made Stage or signage, or removed). Only a state that lists outputs can say so: one
/// without them (the app window reloading) never stops a recording.
fn output_left_congregation(live_state: &str, pinned: &str) -> bool {
    let lists_outputs = serde_json::from_str::<serde_json::Value>(live_state)
        .ok()
        .and_then(|v| v.get("outputs").and_then(serde_json::Value::as_array).map(|a| !a.is_empty()))
        .unwrap_or(false);
    lists_outputs && !KeyEntry::is_congregation_output(Some(live_state), pinned)
}

/// Each Live State the app publishes (doc 42): a recording whose output stopped being a congregation
/// output is stopped at once, keeping what was recorded, because that output's window may now draw
/// a stage screen's private notes, which must never go into the church's recording.
pub fn guard_pinned_output(app: &AppHandle, live_state: &str) {
    let Some(host) = app.try_state::<RecorderHost>() else { return };
    let Some(rec) = host.0.get() else { return };
    let Some(pinned) = rec.pinned_output() else { return };
    if !output_left_congregation(live_state, &pinned) {
        return;
    }
    log::warn!("recorder: output {pinned} is no longer a congregation output; stopping the recording");
    let stopped = rec.stop();
    let _ = app.emit_to("main", "recorder:output_left", serde_json::json!({ "outputId": pinned, "stopped": stopped.is_ok() }));
}

/// Run recorder startup only after the host confirms the named output is a current congregation output.
fn start_for_current_congregation<T>(
    request: RecorderStartRequest,
    live_state: Option<&str>,
    start: impl FnOnce(RecorderStartRequest) -> Res<T>,
) -> Res<T> {
    let request = host_scoped_request(request, live_state);
    if request.output_role != "congregation" {
        return Err(RecorderProblem::new(ProblemCode::OutputNotRecordable, "Only a current congregation output can be recorded."));
    }
    start(request)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecorderPreflight {
    ok: bool,
    problems: Vec<RecorderProblem>,
    /// Worth telling the operator; Start still works (`computer_busy`).
    warnings: Vec<RecorderProblem>,
    width: u32,
    height: u32,
    disk_free_bytes: Option<u64>,
    audio_devices: Vec<String>,
}

/// Windows does not provide the Unix load average used by the recorder crate. Sample system CPU
/// usage over sysinfo's required interval and keep the same warning-only behavior for recording.
#[cfg(windows)]
async fn windows_busy_warning_from_system() -> Option<RecorderProblem> {
    let mut system = sysinfo::System::new();
    system.refresh_cpu_usage();
    tokio::time::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL.max(Duration::from_millis(250))).await;
    system.refresh_cpu_usage();
    windows_busy_warning(system.global_cpu_usage())
}

#[tauri::command]
pub async fn recorder_preflight(app: AppHandle, host: State<'_, RecorderHost>, ndi: State<'_, Mutex<NdiRuntime>>, request: RecorderStartRequest) -> Res<RecorderPreflight> {
    let rec = recorder(&host)?;
    let live_state = super::remote::current_live_state(&app);
    let request = host_scoped_request(request, live_state.as_deref());
    let mut problems = rec.preflight(&request);
    if window_label(&request.output_id).ok().and_then(|l| app.get_webview_window(&l)).is_none() {
        problems.push(RecorderProblem::new(ProblemCode::OutputWindowMissing, "Open this screen first: Rhema records what its window shows."));
    }
    let (width, height) = frame_size(&ndi, &request);
    let mut warnings = rec.warnings();
    #[cfg(windows)]
    if let Some(warning) = windows_busy_warning_from_system().await {
        warnings.push(warning);
    }
    Ok(RecorderPreflight { ok: problems.is_empty(), problems, warnings, width, height, disk_free_bytes: rhema_recorder::disk_free(rec.folder()), audio_devices: rhema_recorder::audio::devices() })
}

// Both wait on the file (a stop up to a minute): off the main thread, or Live freezes meanwhile.
#[tauri::command(async)]
pub fn recorder_start(app: AppHandle, window: WebviewWindow, request: RecorderStartRequest) -> Res<RecorderStatus> {
    main_desk_only(&window)?;
    start_session(&app, request)
}

#[tauri::command(async)]
pub fn recorder_stop(app: AppHandle, window: WebviewWindow) -> Res<RecorderStatus> {
    main_desk_only(&window)?;
    stop_session(&app)
}

/// Main desk and granted desks alike: only a current congregation output is recorded (the host's Live
/// state decides, not the caller).
fn start_session(app: &AppHandle, request: RecorderStartRequest) -> Res<RecorderStatus> {
    let request = in_run(request, current_run(app));
    let host = app.state::<RecorderHost>();
    let ndi = app.state::<Mutex<NdiRuntime>>();
    let live_state = super::remote::current_live_state(app);
    let output_id = request.output_id.clone();
    let output_label = window_label(&output_id).map_err(|e| RecorderProblem::new(ProblemCode::OutputNotRecordable, e))?;
    let mut dimensions = (0, 0);
    let dimensions_out = &mut dimensions;
    let status = start_for_current_congregation(request, live_state.as_deref(), |request| {
        let rec = recorder(&host)?;
        if app.get_webview_window(&output_label).is_none() {
            return Err(RecorderProblem::new(ProblemCode::OutputWindowMissing, "Open this screen first: Rhema records what its window shows."));
        }
        // Read once the output is reserved: `start_ndi` refuses a change of size from then on.
        rec.start_sized(&request, || {
            *dimensions_out = frame_size(&ndi, &request);
            *dimensions_out
        })
    })?;
    let (width, height) = dimensions;
    log::info!("recorder: started {} on output {} at {width}x{height}", status.session_id.as_deref().unwrap_or("?"), output_id);
    // The output's window starts handing its frames to the host (if NDI isn't already making it).
    let _ = app.emit_to(tauri::EventTarget::webview_window(output_label.as_str()), "broadcast:record-tee", tee(true, width, height, status.video.fps));
    spawn_status_beat(app.clone(), status.session_id.clone());
    let _ = app.emit_to("main", "recorder:status", &status);
    Ok(status)
}

/// The app is quitting: close the file properly rather than leave it to be recovered, even one
/// still starting. A start never holds this for longer than the wait; its file is recovered if so.
pub fn shutdown(app: &AppHandle) {
    if let Some(host) = app.try_state::<RecorderHost>() {
        if let Ok(rec) = recorder(&host) {
            match rec.shut_down(Duration::from_secs(10)) {
                Some(Ok(status)) => log::info!("recorder: closed on quit: {:?}", status.state),
                Some(Err(p)) => log::warn!("recorder: could not close on quit: {}", p.message),
                None => {}
            }
        }
    }
}

fn stop_session(app: &AppHandle) -> Res<RecorderStatus> {
    let host = app.state::<RecorderHost>();
    let rec = recorder(&host)?;
    let output = rec.pinned_output();
    // Told before another start can begin, so this can't switch off the next recording's frames.
    let status = rec.stop_then(|| {
        if let Some(label) = output.and_then(|o| window_label(&o).ok()) {
            let _ = app.emit_to(tauri::EventTarget::webview_window(label.as_str()), "broadcast:record-tee", tee(false, 0, 0, 0));
        }
    })?;
    log::info!("recorder: {:?} {}", status.state, status.file.path.as_deref().unwrap_or(""));
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
            // The last setup's service may be last week's: this recording files under the service running now.
            let request = RecorderStartRequest { service_run_id: None, program_id: None, ..request };
            log::info!("recorder: start asked by {by}");
            start_session(app, request).map(drop)
        }
        Some("stop") => {
            log::info!("recorder: stop asked by {by}");
            stop_session(app).map(drop)
        }
        Some("marker") => {
            let host = app.state::<RecorderHost>();
            let label = v.get("label").and_then(serde_json::Value::as_str).filter(|l| !l.is_empty()).unwrap_or("Marker");
            recorder(&host)?.marker(label, by, current_run(app).map(|r| r.0), None).map(drop)
        }
        _ => Err(RecorderProblem::new(ProblemCode::NotAllowed, "unknown recorder action")),
    }
}

#[tauri::command]
pub fn recorder_marker(app: AppHandle, window: WebviewWindow, host: State<'_, RecorderHost>, label: String, service_run_id: Option<String>, item_id: Option<String>) -> Res<RecorderMarker> {
    main_desk_only(&window)?;
    let service_run_id = service_run_id.or_else(|| current_run(&app).map(|r| r.0));
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

/// Open only a saved/recoverable recording resolved from Rhema's archive, never an arbitrary path.
#[tauri::command]
pub fn recorder_open_file(window: WebviewWindow, host: State<'_, RecorderHost>, session_id: String, rehearsal: bool) -> Res<()> {
    main_desk_only(&window)?;
    let file = recorder(&host)?.archive_file_path(&session_id, rehearsal)?;
    tauri_plugin_opener::open_path(&file, None::<&str>)
        .map_err(|e| RecorderProblem::new(ProblemCode::WriteFailed, format!("Could not open the recording: {e}")))
}

/// Show only a saved/recoverable recording resolved from Rhema's archive in its native file browser.
#[tauri::command]
pub fn recorder_reveal_file(window: WebviewWindow, host: State<'_, RecorderHost>, session_id: String, rehearsal: bool) -> Res<()> {
    main_desk_only(&window)?;
    let file = recorder(&host)?.archive_file_path(&session_id, rehearsal)?;
    tauri_plugin_opener::reveal_item_in_dir(&file)
        .map_err(|e| RecorderProblem::new(ProblemCode::WriteFailed, format!("Could not show the recording: {e}")))
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

/// The service running now (with its plan), so recordings and markers file under it in History.
/// `None` when no service is running or the services store is unavailable.
fn current_run(app: &AppHandle) -> Option<(String, Option<String>)> {
    let state = app.state::<ContentState>();
    let guard = state.0.lock().ok()?;
    let run = guard.as_ref()?.current_service_run(12).ok()??;
    Some((run.run_id, run.program_id))
}

/// A run the caller named wins; otherwise the recording joins the service running now.
fn in_run(request: RecorderStartRequest, now: Option<(String, Option<String>)>) -> RecorderStartRequest {
    match (request.service_run_id.is_some(), now) {
        (false, Some((run, program))) => RecorderStartRequest {
            service_run_id: Some(run),
            // The host's current run and program are one authoritative pair. Do not let a stale
            // program selected in the UI split the recording's History link across services.
            program_id: program,
            ..request
        },
        _ => request,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rhema_recorder::RecorderProfile;

    fn request(output_id: &str, output_role: &str) -> RecorderStartRequest {
        RecorderStartRequest {
            output_id: output_id.into(),
            output_name: output_id.into(),
            output_role: output_role.into(),
            audio_device_id: None,
            allow_silent: true,
            profile: RecorderProfile::Standard720p30,
            service_run_id: None,
            program_id: None,
            rehearsal: false,
        }
    }

    #[test]
    fn a_recording_files_under_the_service_running_now_unless_the_caller_named_one() {
        let now = Some(("run-today".to_string(), Some("plan-today".to_string())));
        let stale_ui_plan = RecorderStartRequest { program_id: Some("old-plan".into()), ..request("sanctuary", "congregation") };
        let joined = in_run(stale_ui_plan, now.clone());
        assert_eq!((joined.service_run_id.as_deref(), joined.program_id.as_deref()), (Some("run-today"), Some("plan-today")));
        let named = in_run(RecorderStartRequest { service_run_id: Some("run-x".into()), ..request("sanctuary", "congregation") }, now);
        assert_eq!((named.service_run_id.as_deref(), named.program_id), (Some("run-x"), None));
        assert_eq!(in_run(request("sanctuary", "congregation"), None).service_run_id, None);
    }

    #[test]
    fn a_recording_stops_when_its_output_is_no_longer_a_congregation_output() {
        let as_stage = r#"{"outputs":[{"id":"sanctuary","role":"stage"}]}"#;
        assert!(output_left_congregation(as_stage, "sanctuary"), "made a stage screen");
        assert!(output_left_congregation(r#"{"outputs":[{"id":"overflow"}]}"#, "sanctuary"), "removed");
        assert!(!output_left_congregation(r#"{"outputs":[{"id":"sanctuary"},{"id":"stage","role":"stage"}]}"#, "sanctuary"), "still congregation");
        assert!(!output_left_congregation(r#"{"v":1}"#, "sanctuary"), "a state without outputs never stops it");
        assert!(!output_left_congregation(r#"{"outputs":[]}"#, "sanctuary"), "nor one with none listed yet");
        assert!(!output_left_congregation("not json", "sanctuary"));
    }

    #[test]
    fn caller_cannot_make_a_stage_output_recordable_by_claiming_congregation_role() {
        let live = r#"{"outputs":[{"id":"sanctuary","role":"congregation"},{"id":"stage","role":"stage"}]}"#;
        let mut start_called = false;
        let result = start_for_current_congregation(request("stage", "congregation"), Some(live), |_| {
            start_called = true;
            Ok(())
        });
        assert_eq!(result.unwrap_err().code, ProblemCode::OutputNotRecordable);
        assert!(!start_called, "a forged Stage target must not reach recorder startup");
    }

    #[test]
    fn caller_cannot_make_a_congregation_output_unrecordable_by_changing_its_role_claim() {
        let live = r#"{"outputs":[{"id":"sanctuary","role":"congregation"}]}"#;
        let mut scoped_role = String::new();
        let result = start_for_current_congregation(request("sanctuary", "stage"), Some(live), |trusted| {
            scoped_role = trusted.output_role;
            Ok(())
        });
        assert!(result.is_ok());
        assert_eq!(scoped_role, "congregation");
    }

    #[test]
    fn absent_or_unknown_host_output_state_fails_closed() {
        let absent_request = request("sanctuary", "congregation");
        assert!(start_for_current_congregation(absent_request, None, |_| Ok(())).is_err());
        assert!(start_for_current_congregation(request("sanctuary", "congregation"), Some(r#"{"outputs":[]}"#), |_| Ok(())).is_err());
    }

}

/// The sender that keeps the awake thread waiting; dropping it ends the hold.
static AWAKE: std::sync::Mutex<Option<std::sync::mpsc::Sender<()>>> = std::sync::Mutex::new(None);

/// Keeps this computer and its screens awake while the service is live (#411 timing hunt): with no
/// input during a long sermon the Mac idle-slept, and the service timer, the extra timers and the
/// finished items' times all lost the time it slept (its clock stops then), so the pastor saw too
/// much time left; a sleeping display also stops the output windows drawing. The same hold the
/// recorder takes, on a thread of its own that waits until it is released.
#[tauri::command]
pub fn keep_awake(on: bool) {
    let mut held = AWAKE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    if !on {
        *held = None;
        return;
    }
    if held.is_some() {
        return;
    }
    #[cfg(any(target_os = "macos", windows))]
    {
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        std::thread::spawn(move || {
            let _awake = rhema_recorder::backend::Awake::hold();
            let _ = rx.recv();
        });
        *held = Some(tx);
    }
}
