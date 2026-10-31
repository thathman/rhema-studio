//! Rhema Studio's native service recorder (C1; contract `docs/contracts/recorder-v1.md`).
//!
//! One session records one pinned congregation output: the output window's final frames, handed to
//! the host through the same single readback that feeds NDI, plus the approved mixer input. Video and
//! audio are stamped on one host clock. A failure here never blocks a Live output: frames that cannot
//! be written are dropped and counted.

pub mod audio;
pub mod manifest;
pub mod model;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(windows)]
pub mod windows;

/// This computer's encoder: one `Writer`, `Awake` and `probe` per system.
#[cfg(target_os = "macos")]
pub use macos as backend;
#[cfg(windows)]
pub use self::windows as backend;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime};

use crossbeam_channel::{Receiver, Sender};

pub use model::*;

/// Refuse to start below this much free space; warn below `DISK_LOW`; close the file below `DISK_FULL`.
pub const DISK_START_MIN: u64 = 2 << 30;
pub const DISK_LOW: u64 = 1 << 30;
pub const DISK_FULL: u64 = 200 << 20;
/// Frames waiting for the encoder before new ones are dropped (each is a whole picture).
const VIDEO_QUEUE: usize = 3;
/// No frame for this long: the output window stopped painting or closed.
const NO_FRAMES_AFTER: Duration = Duration::from_secs(5);
pub const FILE_NAME: &str = "recording.mp4";

enum Msg {
    Video(Vec<u8>),
    Audio(Vec<f32>, i64),
    Stop,
}

#[derive(Default)]
struct Shared {
    frames_written: AtomicU64,
    frames_dropped: AtomicU64,
    video_queued: AtomicUsize,
    samples_written: AtomicU64,
    peak_bits: AtomicU32,
    /// Milliseconds since the start of the last audio block / frame, plus one (0 = none yet).
    last_audio_ms: AtomicU64,
    last_frame_ms: AtomicU64,
    problem: Mutex<Option<RecorderProblem>>,
    /// The writer takes nothing more (it failed, or closed the file on a full disk).
    writer_gone: AtomicBool,
}

impl Shared {
    fn set_problem(&self, p: RecorderProblem) {
        log::warn!("recorder: {}", p.message);
        *self.problem.lock().unwrap_or_else(PoisonError::into_inner) = Some(p);
    }
    fn problem(&self) -> Option<RecorderProblem> {
        self.problem.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }
}

struct Session {
    dir: PathBuf,
    manifest: RecordingManifest,
    width: u32,
    height: u32,
    fps: u32,
    t0: Instant,
    tx: Sender<Msg>,
    shared: Arc<Shared>,
    writer: JoinHandle<Result<(), String>>,
    /// The last whole frame, so a region update (a ticker band) is recorded as a full picture.
    frame: Vec<u8>,
    audio: Option<audio::Capture>,
}

pub struct Recorder {
    folder: PathBuf,
    session: Mutex<Option<Session>>,
    /// What the last session ended as, until the next one starts.
    last: Mutex<RecorderStatus>,
    /// The main desk's last recording setup: what a granted remote desk's "start" reuses (it never
    /// chooses the screen or the sound input itself).
    last_request: Mutex<Option<RecorderStartRequest>>,
}

impl Recorder {
    /// Recordings go under `folder` (rehearsals under `folder/rehearsal`). Anything a crash left
    /// mid-recording is marked recoverable now, since no session can be running yet.
    #[must_use]
    pub fn new(folder: PathBuf) -> Self {
        for f in [folder.clone(), folder.join("rehearsal")] {
            let marked = manifest::mark_interrupted(&f);
            if !marked.is_empty() {
                log::warn!("recorder: {} interrupted recording(s) marked recoverable: {marked:?}", marked.len());
            }
        }
        Self { folder, session: Mutex::new(None), last: Mutex::new(RecorderStatus::idle()), last_request: Mutex::new(None) }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Session>> {
        self.session.lock().unwrap_or_else(PoisonError::into_inner)
    }

    #[must_use]
    pub fn folder(&self) -> &Path {
        &self.folder
    }

    /// The setup of the last recording that started.
    #[must_use]
    pub fn last_request(&self) -> Option<RecorderStartRequest> {
        self.last_request.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    /// The output the running session is pinned to.
    #[must_use]
    pub fn pinned_output(&self) -> Option<String> {
        self.lock().as_ref().map(|s| s.manifest.output_id.clone())
    }

    /// Why `req` could not start now (empty = it can). No side effects.
    #[must_use]
    pub fn preflight(&self, req: &RecorderStartRequest) -> Vec<RecorderProblem> {
        let mut problems = Vec::new();
        if !cfg!(any(target_os = "macos", windows)) {
            problems.push(RecorderProblem::new(ProblemCode::UnsupportedPlatform, "Recording in Rhema is available on macOS and Windows; use OBS recording on this computer for now."));
        }
        if self.lock().is_some() {
            problems.push(RecorderProblem::new(ProblemCode::AlreadyRecording, "A recording is already running."));
        }
        if req.output_role != "congregation" {
            problems.push(RecorderProblem::new(ProblemCode::OutputNotRecordable, "Only a congregation screen can be recorded (never Stage, Comms or a preview)."));
        }
        if req.audio_device_id.is_none() && !req.allow_silent {
            problems.push(RecorderProblem::new(ProblemCode::AudioMissing, "Choose the sound desk input, or confirm recording without sound."));
        }
        if let Some(free) = disk_free(&self.folder) {
            if free < DISK_START_MIN {
                problems.push(RecorderProblem::new(ProblemCode::DiskLow, format!("Only {} free; recording needs at least 2 GB.", gb(free))));
            }
        }
        problems
    }

    /// Start recording `req.output_id` at `width`×`height` (what its window will send).
    pub fn start(&self, req: &RecorderStartRequest, width: u32, height: u32) -> Result<RecorderStatus, RecorderProblem> {
        if let Some(p) = self.preflight(req).into_iter().next() {
            return Err(p);
        }
        let fps = req.profile.size().2;
        let started_at = iso_utc(SystemTime::now());
        let stamp = started_at.trim_end_matches('Z').replace([':', '-'], "").replace('T', "_");
        let session_id = format!("{stamp}-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);
        let dir = if req.rehearsal { self.folder.join("rehearsal") } else { self.folder.clone() }.join(&session_id);
        std::fs::create_dir_all(&dir).map_err(|e| RecorderProblem::new(ProblemCode::WriteFailed, format!("Cannot create {}: {e}", dir.display())))?;
        let mut m = RecordingManifest {
            version: 1,
            session_id,
            state: RecorderState::Preparing,
            output_id: req.output_id.clone(),
            output_name: req.output_name.clone(),
            profile: req.profile,
            audio_device_id: req.audio_device_id.clone(),
            service_run_id: req.service_run_id.clone(),
            program_id: req.program_id.clone(),
            rehearsal: req.rehearsal,
            started_at,
            stopped_at: None,
            duration_ms: None,
            files: RecordingFiles { mov: None, mp4: Some(FILE_NAME.into()) },
            markers: Vec::new(),
            frames_written: 0,
            frames_dropped: 0,
            problem: None,
        };
        manifest::write(&dir, &m).map_err(|e| RecorderProblem::new(ProblemCode::WriteFailed, e.to_string()))?;
        let fail = |p: RecorderProblem| {
            let _ = std::fs::remove_dir_all(&dir);
            Err(p)
        };

        let shared = Arc::new(Shared::default());
        let (tx, rx) = crossbeam_channel::unbounded::<Msg>();
        // The session clock and the audio rate, set once the file's timeline has started at zero.
        let clock: Arc<OnceLock<(Instant, u32)>> = Arc::new(OnceLock::new());

        let audio = match &req.audio_device_id {
            None => None,
            Some(device) => {
                let (tx_a, sh_a, sh_lost, clock_a) = (tx.clone(), shared.clone(), shared.clone(), clock.clone());
                let mut placer = AudioPlacer::default();
                let capture = audio::start(
                    device,
                    move |block| {
                        let Some((t0, rate)) = clock_a.get() else { return };
                        let now = t0.elapsed();
                        let frames = (block.len() / 2) as i64;
                        // The block's first sample was captured about one block before the callback.
                        let host = (now.as_secs_f64() * f64::from(*rate)) as i64 - frames;
                        let peak = block.iter().fold(0f32, |m, s| m.max(s.abs()));
                        sh_a.peak_bits.store(peak.to_bits(), Ordering::Relaxed);
                        sh_a.last_audio_ms.store(now.as_millis() as u64 + 1, Ordering::Relaxed);
                        if let Some(at) = placer.place(host, frames, *rate) {
                            let _ = tx_a.send(Msg::Audio(block.to_vec(), at));
                        }
                    },
                    move |e| sh_lost.set_problem(RecorderProblem::new(ProblemCode::AudioDeviceLost, format!("The sound input stopped ({e}). Video keeps recording."))),
                );
                match capture {
                    Ok(c) => Some(c),
                    Err(e) => return fail(RecorderProblem::new(ProblemCode::AudioMissing, e)),
                }
            }
        };
        let audio_rate = audio.as_ref().map(|c| c.rate);

        let (ready_tx, ready_rx) = crossbeam_channel::bounded::<Result<Instant, String>>(1);
        let writer = {
            let (path, shared, folder, bitrate) = (dir.join(FILE_NAME), shared.clone(), self.folder.clone(), req.profile.video_bitrate());
            std::thread::Builder::new()
                .name("recorder-writer".into())
                .spawn(move || run_writer(&path, (width, height, fps, bitrate), audio_rate, &rx, &shared, &ready_tx, &folder))
                .map_err(|e| RecorderProblem::new(ProblemCode::EncoderFailed, e.to_string()))
        };
        let writer = match writer {
            Ok(w) => w,
            Err(p) => return fail(p),
        };
        let t0 = match ready_rx.recv_timeout(Duration::from_secs(10)) {
            Ok(Ok(t0)) => t0,
            other => {
                let e = match other {
                    Ok(Err(e)) => e,
                    _ => "the encoder did not start in time".into(),
                };
                drop(audio);
                let _ = tx.send(Msg::Stop);
                let _ = writer.join();
                return fail(RecorderProblem::new(ProblemCode::EncoderFailed, format!("The encoder did not start: {e}")));
            }
        };
        // The file's timeline starts at zero at `t0`, for pictures and sound.
        let _ = clock.set((t0, audio_rate.unwrap_or(0)));
        m.state = RecorderState::Recording;
        let _ = manifest::write(&dir, &m);
        let session = Session { dir, manifest: m, width, height, fps, t0, tx, shared, writer, frame: Vec::new(), audio };
        let status = status_of(&session, &self.folder);
        *self.lock() = Some(session);
        *self.last_request.lock().unwrap_or_else(PoisonError::into_inner) = Some(req.clone());
        Ok(status)
    }

    /// A whole frame from output `output_id`'s window. `false`: no session is recording that output.
    pub fn push_frame(&self, output_id: &str, width: u32, height: u32, rgba: &[u8]) -> bool {
        let mut guard = self.lock();
        let Some(s) = guard.as_mut().filter(|s| s.manifest.output_id == output_id) else { return false };
        if width != s.width || height != s.height || rgba.len() != width as usize * height as usize * 4 {
            if s.shared.frames_dropped.fetch_add(1, Ordering::Relaxed) == 0 || s.shared.problem().is_none() {
                s.shared.set_problem(RecorderProblem::new(
                    ProblemCode::FrameSizeChanged,
                    format!("The screen now sends {width}×{height}, but this recording is {}×{}: its pictures are being skipped. Stop and start the recording again.", s.width, s.height),
                ));
            }
            return true;
        }
        s.frame.clear();
        s.frame.extend_from_slice(rgba);
        send_frame(s);
        true
    }

    /// Rows `y..y+height` of the frame changed (a ticker band); the rest is as last sent.
    pub fn push_region(&self, output_id: &str, y: u32, width: u32, height: u32, rgba: &[u8]) -> bool {
        let mut guard = self.lock();
        let Some(s) = guard.as_mut().filter(|s| s.manifest.output_id == output_id) else { return false };
        let row = s.width as usize * 4;
        let start = y as usize * row;
        if s.frame.is_empty() || width != s.width || rgba.len() != height as usize * row || start + rgba.len() > s.frame.len() {
            return true;
        }
        s.frame[start..start + rgba.len()].copy_from_slice(rgba);
        send_frame(s);
        true
    }

    /// Mark a moment (a sermon start, a hymn). Kept in the manifest; never sent to OBS.
    pub fn marker(&self, label: &str, actor: &str, service_run_id: Option<String>, item_id: Option<String>) -> Result<RecorderMarker, RecorderProblem> {
        let mut guard = self.lock();
        let s = guard.as_mut().ok_or_else(|| RecorderProblem::new(ProblemCode::NotRecording, "Nothing is recording."))?;
        let marker = RecorderMarker { at_ms: s.t0.elapsed().as_millis() as u64, label: label.trim().chars().take(120).collect(), actor: actor.into(), service_run_id, item_id };
        s.manifest.markers.push(marker.clone());
        manifest::write(&s.dir, &s.manifest).map_err(|e| RecorderProblem::new(ProblemCode::WriteFailed, e.to_string()))?;
        Ok(marker)
    }

    /// Stop and close the file: saved when it closed properly, recoverable when only its fragments remain.
    pub fn stop(&self) -> Result<RecorderStatus, RecorderProblem> {
        // Out of the lock first: frames for NDI keep flowing while the file closes.
        let s = self.lock().take().ok_or_else(|| RecorderProblem::new(ProblemCode::NotRecording, "Nothing is recording."))?;
        let Session { dir, mut manifest, t0, tx, shared, writer, width, height, fps, audio, .. } = s;
        drop(audio);
        manifest.state = RecorderState::Finalizing;
        let _ = manifest::write(&dir, &manifest);
        let _ = tx.send(Msg::Stop);
        let result = writer.join().unwrap_or_else(|_| Err("the writer stopped unexpectedly".into()));
        manifest.stopped_at = Some(iso_utc(SystemTime::now()));
        manifest.duration_ms = Some(t0.elapsed().as_millis() as u64);
        manifest.frames_written = shared.frames_written.load(Ordering::Relaxed);
        manifest.frames_dropped = shared.frames_dropped.load(Ordering::Relaxed);
        manifest.problem = shared.problem();
        let file = dir.join(FILE_NAME);
        manifest.state = match result {
            Ok(()) => RecorderState::Saved,
            Err(e) => {
                manifest.problem = Some(RecorderProblem::new(ProblemCode::EncoderFailed, format!("The file did not close properly: {e}")));
                if std::fs::metadata(&file).is_ok_and(|m| m.len() > 0) {
                    RecorderState::Recoverable
                } else {
                    RecorderState::Failed
                }
            }
        };
        manifest::write(&dir, &manifest).map_err(|e| RecorderProblem::new(ProblemCode::WriteFailed, e.to_string()))?;
        let status = RecorderStatus {
            state: manifest.state,
            session_active: false,
            session_id: Some(manifest.session_id.clone()),
            output_id: Some(manifest.output_id.clone()),
            started_at: Some(manifest.started_at.clone()),
            elapsed_ms: manifest.duration_ms.unwrap_or(0),
            video: VideoStatus { width, height, fps, frames_written: manifest.frames_written, frames_dropped: manifest.frames_dropped, last_frame_ago_ms: None },
            audio: AudioStatus { device_id: manifest.audio_device_id.clone(), receiving: false, peak_db: None, samples_written: shared.samples_written.load(Ordering::Relaxed) },
            file: FileStatus { path: Some(file.to_string_lossy().into_owned()), bytes: std::fs::metadata(&file).map_or(0, |x| x.len()), disk_free_bytes: disk_free(&dir), last_write_ok: manifest.state == RecorderState::Saved },
            problem: manifest.problem.clone(),
        };
        *self.last.lock().unwrap_or_else(PoisonError::into_inner) = status.clone();
        Ok(status)
    }

    /// The truthful state right now (a REC indicator must come from this).
    #[must_use]
    pub fn status(&self) -> RecorderStatus {
        match self.lock().as_ref() {
            Some(s) => status_of(s, &self.folder),
            None => self.last.lock().unwrap_or_else(PoisonError::into_inner).clone(),
        }
    }

    /// Finished and interrupted recordings, newest first.
    #[must_use]
    pub fn list(&self, rehearsal: bool) -> Vec<RecordingManifest> {
        let f = if rehearsal { self.folder.join("rehearsal") } else { self.folder.clone() };
        manifest::list(&f).into_iter().map(|(_, m)| m).collect()
    }

    /// A session's folder, if `session_id` names one (never a path).
    #[must_use]
    pub fn session_dir(&self, session_id: &str, rehearsal: bool) -> Option<PathBuf> {
        if session_id.is_empty() || session_id.contains(['/', '\\', '.']) {
            return None;
        }
        let f = if rehearsal { self.folder.join("rehearsal") } else { self.folder.clone() };
        Some(f.join(session_id)).filter(|d| d.join(manifest::MANIFEST).exists())
    }

    /// A saved or recoverable local MP4 that the desktop may open or reveal to the operator.
    /// The path is resolved from a listed session and a fixed filename, then canonicalized so a
    /// modified manifest, directory symlink, or file symlink cannot escape this archive.
    pub fn archive_file_path(&self, session_id: &str, rehearsal: bool) -> Result<PathBuf, RecorderProblem> {
        let record = self
            .list(rehearsal)
            .into_iter()
            .find(|record| record.session_id == session_id)
            .ok_or_else(|| RecorderProblem::new(ProblemCode::NotRecording, "That recording is no longer in this archive."))?;
        if !matches!(record.state, RecorderState::Saved | RecorderState::Recoverable) || record.files.mp4.as_deref() != Some(FILE_NAME) {
            return Err(RecorderProblem::new(ProblemCode::WriteFailed, "This recording does not have an available MPEG-4 file."));
        }

        let archive = if rehearsal { self.folder.join("rehearsal") } else { self.folder.clone() };
        let archive = archive.canonicalize().map_err(|e| RecorderProblem::new(ProblemCode::WriteFailed, format!("The recordings folder is unavailable: {e}")))?;
        let directory = self
            .session_dir(session_id, rehearsal)
            .and_then(|path| path.canonicalize().ok())
            .filter(|path| path.parent() == Some(archive.as_path()))
            .ok_or_else(|| RecorderProblem::new(ProblemCode::WriteFailed, "The recording folder is unavailable or outside its archive."))?;
        let file = directory
            .join(FILE_NAME)
            .canonicalize()
            .map_err(|e| RecorderProblem::new(ProblemCode::WriteFailed, format!("The recording file is unavailable: {e}")))?;
        if file.parent() != Some(directory.as_path()) {
            return Err(RecorderProblem::new(ProblemCode::WriteFailed, "The recording file is outside its archive folder."));
        }
        let metadata = std::fs::metadata(&file).map_err(|e| RecorderProblem::new(ProblemCode::WriteFailed, format!("The recording file is unavailable: {e}")))?;
        if !metadata.is_file() || metadata.len() == 0 {
            return Err(RecorderProblem::new(ProblemCode::WriteFailed, "The recording file is empty or unavailable."));
        }
        Ok(file)
    }
}

fn send_frame(s: &Session) {
    if s.shared.writer_gone.load(Ordering::Relaxed) || s.shared.video_queued.load(Ordering::Relaxed) >= VIDEO_QUEUE {
        s.shared.frames_dropped.fetch_add(1, Ordering::Relaxed);
        return;
    }
    s.shared.last_frame_ms.store(s.t0.elapsed().as_millis() as u64 + 1, Ordering::Relaxed);
    s.shared.video_queued.fetch_add(1, Ordering::Relaxed);
    let _ = s.tx.send(Msg::Video(s.frame.clone()));
}

fn status_of(s: &Session, folder: &Path) -> RecorderStatus {
    let sh = &s.shared;
    let elapsed = s.t0.elapsed();
    let elapsed_ms = elapsed.as_millis() as u64;
    let ago = |stamp: u64| (stamp > 0).then(|| elapsed_ms.saturating_sub(stamp - 1));
    let last_frame_ago = ago(sh.last_frame_ms.load(Ordering::Relaxed));
    let receiving = s.manifest.audio_device_id.is_some() && ago(sh.last_audio_ms.load(Ordering::Relaxed)).is_some_and(|a| a < 1500);
    let file = s.dir.join(FILE_NAME);
    let disk_free_bytes = disk_free(folder);
    let mut problem = sh.problem();
    if problem.is_none() {
        if Duration::from_millis(last_frame_ago.unwrap_or(elapsed_ms)) >= NO_FRAMES_AFTER {
            problem = Some(RecorderProblem::new(ProblemCode::NoFrames, "No picture from the screen for 5 seconds: is its window open?"));
        } else if s.manifest.audio_device_id.is_some() && !receiving && elapsed > Duration::from_secs(3) {
            problem = Some(RecorderProblem::new(ProblemCode::AudioMissing, "No sound arriving from the sound desk input."));
        } else if disk_free_bytes.is_some_and(|f| f < DISK_LOW) {
            problem = Some(RecorderProblem::new(ProblemCode::DiskLow, "Less than 1 GB free: the recording will close before the disk fills."));
        }
    }
    let gone = sh.writer_gone.load(Ordering::Relaxed);
    RecorderStatus {
        state: if gone { RecorderState::Failed } else { RecorderState::Recording },
        session_active: true,
        session_id: Some(s.manifest.session_id.clone()),
        output_id: Some(s.manifest.output_id.clone()),
        started_at: Some(s.manifest.started_at.clone()),
        elapsed_ms,
        video: VideoStatus {
            width: s.width,
            height: s.height,
            fps: s.fps,
            frames_written: sh.frames_written.load(Ordering::Relaxed),
            frames_dropped: sh.frames_dropped.load(Ordering::Relaxed),
            last_frame_ago_ms: last_frame_ago,
        },
        audio: AudioStatus {
            device_id: s.manifest.audio_device_id.clone(),
            receiving,
            peak_db: receiving.then(|| 20.0 * f32::from_bits(sh.peak_bits.load(Ordering::Relaxed)).max(1e-6).log10()),
            samples_written: sh.samples_written.load(Ordering::Relaxed),
        },
        file: FileStatus { path: Some(file.to_string_lossy().into_owned()), bytes: std::fs::metadata(&file).map_or(0, |m| m.len()), disk_free_bytes, last_write_ok: !gone },
        problem,
    }
}

#[cfg(any(target_os = "macos", windows))]
fn run_writer(
    path: &Path,
    (width, height, fps, bitrate): (u32, u32, u32, u32),
    audio_rate: Option<u32>,
    rx: &Receiver<Msg>,
    shared: &Shared,
    ready: &Sender<Result<Instant, String>>,
    folder: &Path,
) -> Result<(), String> {
    // Awake for the whole recording: a napping app's frame ticks stall (see `Awake`).
    let _awake = backend::Awake::hold();
    let t0 = Instant::now();
    let mut writer = match backend::Writer::start(path, width, height, fps, bitrate, audio_rate) {
        Ok(w) => {
            let _ = ready.send(Ok(t0));
            w
        }
        Err(e) => {
            shared.writer_gone.store(true, Ordering::Relaxed);
            let _ = ready.send(Err(e.clone()));
            return Err(e);
        }
    };
    let mut failed: Option<String> = None;
    let mut last_disk_check = Instant::now();
    // Constant frame rate: on every tick the latest picture is written (a still slide repeats).
    let period_us = 1_000_000 / i64::from(fps.max(1));
    let mut tick: i64 = 0;
    // The encoder could not take the next tick yet (or there is no picture yet): try it again shortly.
    let mut retry = false;
    // When Stop was asked (µs into the session): every tick due until then is still written.
    let mut stop_at: Option<i64> = None;
    loop {
        let due = t0 + Duration::from_micros((tick * period_us) as u64);
        let wait = due.saturating_duration_since(Instant::now());
        match rx.recv_timeout(if retry { wait.max(Duration::from_millis(5)) } else { wait }) {
            Ok(Msg::Video(frame)) => {
                shared.video_queued.fetch_sub(1, Ordering::Relaxed);
                if failed.is_none() {
                    if let Err(e) = writer.set_frame(&frame) {
                        failed = Some(e);
                    }
                }
            }
            Ok(Msg::Audio(samples, at)) => {
                if failed.is_none() {
                    match writer.append_audio(&samples, at) {
                        Ok(true) => _ = shared.samples_written.fetch_add((samples.len() / 2) as u64, Ordering::Relaxed),
                        Ok(false) => {}
                        Err(e) => failed = Some(e),
                    }
                }
            }
            Ok(Msg::Stop) | Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                stop_at = Some(t0.elapsed().as_micros() as i64);
                break;
            }
            Err(crossbeam_channel::RecvTimeoutError::Timeout) => {}
        }
        let now_us = t0.elapsed().as_micros() as i64;
        if failed.is_none() && now_us >= tick * period_us {
            // Every tick is written, in order, with the latest picture: a hole in the timeline (a busy
            // computer, a burst the encoder could not take) makes fragmented MPEG-4 fail to close
            // (-11800/-16341). A tick written more than 2 s late counts as dropped: a stale repeat.
            let current = now_us / period_us;
            let written = write_due(&mut tick, current, |t| {
                let ok = writer.tick(t * period_us)?;
                if ok && now_us - t * period_us > 2_000_000 {
                    shared.frames_dropped.fetch_add(1, Ordering::Relaxed);
                }
                Ok(ok)
            });
            match written {
                Ok((n, again)) => {
                    shared.frames_written.fetch_add(n, Ordering::Relaxed);
                    retry = again;
                }
                Err(e) => failed = Some(e),
            }
        }
        if let Some(e) = &failed {
            if !shared.writer_gone.swap(true, Ordering::Relaxed) {
                shared.set_problem(RecorderProblem::new(ProblemCode::EncoderFailed, format!("Recording stopped writing ({e}). What was recorded so far is kept.")));
            }
        } else if last_disk_check.elapsed() >= Duration::from_secs(5) {
            last_disk_check = Instant::now();
            if disk_free(folder).is_some_and(|f| f < DISK_FULL) {
                shared.writer_gone.store(true, Ordering::Relaxed);
                shared.set_problem(RecorderProblem::new(ProblemCode::DiskFull, "The disk is nearly full: the recording was closed and saved up to here."));
                break;
            }
        }
    }
    if let (None, Some(stop_us)) = (&failed, stop_at) {
        // Stop while the encoder is behind: write the backlog up to the moment Stop was asked, so the
        // end of the service is not cut off. If the encoder cannot take it within 3 s, say exactly
        // how much is missing rather than closing a shorter file silently.
        match drain(&mut tick, stop_us / period_us, Duration::from_secs(3), |t| writer.tick(t * period_us)) {
            Ok((n, 0)) => _ = shared.frames_written.fetch_add(n, Ordering::Relaxed),
            Ok((n, left)) => {
                shared.frames_written.fetch_add(n, Ordering::Relaxed);
                shared.frames_dropped.fetch_add(left, Ordering::Relaxed);
                shared.set_problem(RecorderProblem::new(
                    ProblemCode::EncoderFailed,
                    format!("The computer could not write the last {left} frames in time: the recording ends {:.1} s before Stop was pressed.", left as f64 / f64::from(fps.max(1))),
                ));
            }
            Err(e) => failed = Some(e),
        }
    }
    match failed {
        Some(e) => Err(e),
        None => writer.finish(),
    }
}

/// Write ticks up to `last`, retrying a busy encoder every 5 ms until `within` has passed:
/// `(written, left unwritten)`.
fn drain(tick: &mut i64, last: i64, within: Duration, mut write: impl FnMut(i64) -> Result<bool, String>) -> Result<(u64, u64), String> {
    let until = Instant::now() + within;
    let mut written = 0;
    loop {
        let (n, retry) = write_due(tick, last, &mut write)?;
        written += n;
        if !retry {
            return Ok((written, 0));
        }
        if Instant::now() >= until {
            return Ok((written, u64::try_from(last - *tick + 1).unwrap_or(0)));
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
fn run_writer(
    _: &Path,
    _: (u32, u32, u32, u32),
    _: Option<u32>,
    _: &Receiver<Msg>,
    shared: &Shared,
    ready: &Sender<Result<Instant, String>>,
    _: &Path,
) -> Result<(), String> {
    shared.writer_gone.store(true, Ordering::Relaxed);
    let _ = ready.send(Err("unsupported platform".into()));
    Err("unsupported platform".into())
}

/// Write ticks `*tick..=current` in order. Stops at the first one the encoder cannot take yet and
/// leaves `*tick` on it, so it is written next time rather than left out: `(written, retry)`.
fn write_due(tick: &mut i64, current: i64, mut write: impl FnMut(i64) -> Result<bool, String>) -> Result<(u64, bool), String> {
    let mut n = 0;
    while *tick <= current {
        if !write(*tick)? {
            return Ok((n, true));
        }
        n += 1;
        *tick += 1;
    }
    Ok((n, false))
}

/// Puts each captured audio block on the file's timeline. Counting samples keeps audio gapless; the
/// host clock keeps it in step with the pictures. When the two disagree by more than 50 ms (the sound
/// card's clock drifts against the computer's over a long service) the count is re-anchored: a short
/// gap if audio fell behind, a dropped block if it ran ahead (a file's samples must never overlap).
#[derive(Default)]
struct AudioPlacer {
    next: Option<i64>,
}

impl AudioPlacer {
    fn place(&mut self, host: i64, frames: i64, rate: u32) -> Option<i64> {
        let tolerance = i64::from(rate) / 20;
        let at = match self.next {
            None => host.max(0),
            Some(next) if host > next + tolerance => host,
            Some(next) if host < next - tolerance => return None,
            Some(next) => next,
        };
        self.next = Some(at + frames);
        Some(at)
    }
}

/// RGBA pixels (tightly packed) to NV12 with no row padding, BT.709 limited range, the colours a video
/// player assumes at HD sizes: a full-size Y plane, then one U,V pair per 2×2 block. `width` and
/// `height` are even. Alpha is ignored: the output window is opaque.
pub fn rgba_to_nv12(src: &[u8], dst: &mut [u8], width: usize, height: usize) {
    let (luma, chroma) = dst.split_at_mut(width * height);
    let (w4, row) = (width * 4, width);
    for (s, d) in src.chunks_exact(w4).zip(luma.chunks_exact_mut(row)) {
        for (p, y) in s.chunks_exact(4).zip(d) {
            let (r, g, b) = (i32::from(p[0]), i32::from(p[1]), i32::from(p[2]));
            *y = ((47 * r + 157 * g + 16 * b + 128) >> 8) as u8 + 16;
        }
    }
    for (rows, d) in src.chunks_exact(w4 * 2).zip(chroma.chunks_exact_mut(row)) {
        let (top, bottom) = rows.split_at(w4);
        for ((a, b), uv) in top.chunks_exact(8).zip(bottom.chunks_exact(8)).zip(d.chunks_exact_mut(2)) {
            let avg = |i: usize| (i32::from(a[i]) + i32::from(a[i + 4]) + i32::from(b[i]) + i32::from(b[i + 4]) + 2) >> 2;
            let (r, g, b) = (avg(0), avg(1), avg(2));
            uv[0] = (((-26 * r - 86 * g + 112 * b + 128) >> 8) + 128) as u8;
            uv[1] = (((112 * r - 102 * g - 10 * b + 128) >> 8) + 128) as u8;
        }
    }
}

/// Copy `width`×`height` RGBA pixels (tightly packed) into a BGRA buffer with `dst_stride` bytes a row.
#[cfg_attr(windows, allow(dead_code))] // macOS's picture format
pub(crate) fn rgba_into_bgra(src: &[u8], dst: &mut [u8], width: usize, height: usize, dst_stride: usize) {
    let row = width * 4;
    for (s, d) in src.chunks_exact(row).take(height).zip(dst.chunks_mut(dst_stride)) {
        for (sp, dp) in s.chunks_exact(4).zip(d[..row].chunks_exact_mut(4)) {
            dp[0] = sp[2];
            dp[1] = sp[1];
            dp[2] = sp[0];
            dp[3] = 255;
        }
    }
}

/// Free bytes on the volume holding `path` (its nearest existing ancestor).
#[must_use]
pub fn disk_free(path: &Path) -> Option<u64> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let existing = path.ancestors().find(|p| p.exists())?;
        let c = std::ffi::CString::new(existing.as_os_str().as_bytes()).ok()?;
        let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
        if unsafe { libc::statvfs(c.as_ptr(), &mut st) } != 0 {
            return None;
        }
        #[allow(clippy::unnecessary_cast)]
        Some(st.f_bavail as u64 * st.f_frsize as u64)
    }
    #[cfg(windows)]
    {
        let existing = path.ancestors().find(|p| p.exists())?;
        let mut free = 0u64;
        unsafe { ::windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(&::windows::core::HSTRING::from(existing), Some(&mut free), None, None) }.ok()?;
        Some(free)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
        None
    }
}

fn gb(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / f64::from(1u32 << 30))
}

/// `2026-10-29T10:04:05Z` for a moment (UTC; History shows it in the church's time zone).
#[must_use]
pub fn iso_utc(t: SystemTime) -> String {
    let secs = t.duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_secs()) as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Civil from days (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_dates_are_right() {
        assert_eq!(iso_utc(SystemTime::UNIX_EPOCH), "1970-01-01T00:00:00Z");
        assert_eq!(iso_utc(SystemTime::UNIX_EPOCH + Duration::from_secs(951_782_400)), "2000-02-29T00:00:00Z");
        assert_eq!(iso_utc(SystemTime::UNIX_EPOCH + Duration::from_secs(1_793_268_245)), "2026-10-29T10:04:05Z");
    }

    #[test]
    fn rgba_becomes_opaque_bgra_in_padded_rows() {
        let src = [1, 2, 3, 0, 4, 5, 6, 128];
        let mut dst = [9u8; 12];
        rgba_into_bgra(&src, &mut dst, 1, 2, 6);
        assert_eq!(dst, [3, 2, 1, 255, 9, 9, 6, 5, 4, 255, 9, 9]);
    }

    #[test]
    fn nv12_has_the_broadcast_levels_for_known_colours() {
        let convert = |c: [u8; 4]| {
            let src: Vec<u8> = c.iter().copied().cycle().take(16).collect();
            let mut dst = [0u8; 6];
            rgba_to_nv12(&src, &mut dst, 2, 2);
            dst
        };
        assert_eq!(convert([0, 0, 0, 255]), [16, 16, 16, 16, 128, 128], "black");
        assert_eq!(convert([255, 255, 255, 255]), [235, 235, 235, 235, 128, 128], "white");
        let red = convert([255, 0, 0, 255]);
        assert_eq!(red[0], 63, "BT.709 red luma");
        assert!((i32::from(red[4]) - 102).abs() <= 1 && (i32::from(red[5]) - 240).abs() <= 1, "red chroma {red:?}");
    }

    #[test]
    fn nv12_averages_chroma_per_block_and_keeps_luma_per_pixel() {
        // Left column white, right column black.
        let src = [255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255];
        let mut dst = [0u8; 6];
        rgba_to_nv12(&src, &mut dst, 2, 2);
        assert_eq!(dst, [235, 16, 235, 16, 128, 128]);
    }

    #[test]
    fn audio_stays_gapless_until_it_drifts_past_50ms() {
        let mut p = AudioPlacer::default();
        assert_eq!(p.place(-100, 480, 48_000), Some(0), "never before zero");
        assert_eq!(p.place(500, 480, 48_000), Some(480), "jitter: keep counting");
        assert_eq!(p.place(960 + 2401, 480, 48_000), Some(3361), "fell behind: re-anchor with a gap");
        assert_eq!(p.place(3841 - 2401, 480, 48_000), None, "ran ahead: drop rather than overlap");
        assert_eq!(p.place(3841, 480, 48_000), Some(3841));
    }

    pub(crate) fn req(role: &str, audio: Option<&str>, silent: bool) -> RecorderStartRequest {
        RecorderStartRequest {
            output_id: "main".into(),
            output_name: "Sanctuary".into(),
            output_role: role.into(),
            audio_device_id: audio.map(Into::into),
            allow_silent: silent,
            profile: RecorderProfile::Standard720p30,
            service_run_id: None,
            program_id: None,
            rehearsal: true,
        }
    }

    #[test]
    fn only_a_congregation_output_with_sound_or_an_explicit_silent_choice_may_start() {
        let t = tempfile::tempdir().unwrap();
        let r = Recorder::new(t.path().to_path_buf());
        let codes = |q: &RecorderStartRequest| {
            r.preflight(q).into_iter().map(|p| p.code).filter(|c| !matches!(c, ProblemCode::UnsupportedPlatform | ProblemCode::DiskLow)).collect::<Vec<_>>()
        };
        assert_eq!(codes(&req("stage", None, true)), vec![ProblemCode::OutputNotRecordable]);
        assert_eq!(codes(&req("congregation", None, false)), vec![ProblemCode::AudioMissing]);
        assert!(codes(&req("congregation", None, true)).is_empty());
    }

    #[test]
    fn saved_and_recoverable_archive_files_resolve_to_their_fixed_local_mp4() {
        let t = tempfile::tempdir().unwrap();
        let r = Recorder::new(t.path().to_path_buf());
        for (id, state, rehearsal) in [
            ("saved-service", RecorderState::Saved, false),
            ("recoverable-rehearsal", RecorderState::Recoverable, true),
        ] {
            let folder = if rehearsal { t.path().join("rehearsal") } else { t.path().to_path_buf() };
            let dir = folder.join(id);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join(FILE_NAME), b"fragmented media").unwrap();
            manifest::write(
                &dir,
                &RecordingManifest {
                    version: 1,
                    session_id: id.into(),
                    state,
                    output_id: "sanctuary".into(),
                    output_name: "Sanctuary".into(),
                    profile: RecorderProfile::Standard720p30,
                    audio_device_id: None,
                    service_run_id: None,
                    program_id: None,
                    rehearsal,
                    started_at: "2026-10-30T10:00:00Z".into(),
                    stopped_at: None,
                    duration_ms: Some(1_000),
                    files: RecordingFiles { mov: None, mp4: Some(FILE_NAME.into()) },
                    markers: vec![],
                    frames_written: 30,
                    frames_dropped: 0,
                    problem: None,
                },
            )
            .unwrap();

            assert_eq!(r.archive_file_path(id, rehearsal).unwrap(), dir.join(FILE_NAME).canonicalize().unwrap());
        }
    }

    #[cfg(unix)]
    #[test]
    fn archive_file_resolution_rejects_symlinks_outside_the_recordings_folder() {
        use std::os::unix::fs::symlink;

        let t = tempfile::tempdir().unwrap();
        let r = Recorder::new(t.path().to_path_buf());
        let outside = t.path().join("outside.mp4");
        std::fs::write(&outside, b"outside recording").unwrap();
        let dir = t.path().join("session-escape");
        std::fs::create_dir_all(&dir).unwrap();
        symlink(&outside, dir.join(FILE_NAME)).unwrap();
        manifest::write(
            &dir,
            &RecordingManifest {
                version: 1,
                session_id: "session-escape".into(),
                state: RecorderState::Saved,
                output_id: "sanctuary".into(),
                output_name: "Sanctuary".into(),
                profile: RecorderProfile::Standard720p30,
                audio_device_id: None,
                service_run_id: None,
                program_id: None,
                rehearsal: false,
                started_at: "2026-10-30T10:00:00Z".into(),
                stopped_at: None,
                duration_ms: Some(1_000),
                files: RecordingFiles { mov: None, mp4: Some(FILE_NAME.into()) },
                markers: vec![],
                frames_written: 30,
                frames_dropped: 0,
                problem: None,
            },
        )
        .unwrap();

        assert!(r.archive_file_path("session-escape", false).is_err());
    }

    #[test]
    fn a_busy_encoder_never_leaves_a_hole_in_the_timeline() {
        // The loop woke late (ticks 0..=9 due at once) and the encoder takes only some of each burst.
        let mut written = Vec::new();
        let mut tick = 0;
        let mut calls = 0;
        for current in [9, 9, 9, 12, 12].into_iter().chain(std::iter::repeat(20).take(20)) {
            let _ = write_due(&mut tick, current, |t| {
                calls += 1;
                let ready = calls % 3 != 0;
                if ready {
                    written.push(t);
                }
                Ok(ready)
            })
            .unwrap();
        }
        assert_eq!(written, (0..=20).collect::<Vec<_>>());
        assert_eq!(write_due(&mut tick, 25, |_| Err("writer failed".into())), Err("writer failed".into()));
    }

    #[test]
    fn stop_during_a_backlog_writes_the_tail_or_says_what_is_missing() {
        // Stop asked at tick 30 while ticks 10..=30 are still unwritten and the encoder refuses at first.
        let mut written = Vec::new();
        let mut tick = 10;
        let mut calls = 0;
        let (n, left) = drain(&mut tick, 30, Duration::from_secs(1), |t| {
            calls += 1;
            let ready = calls % 4 != 0;
            if ready {
                written.push(t);
            }
            Ok(ready)
        })
        .unwrap();
        assert_eq!((n, left), (21, 0));
        assert_eq!(written, (10..=30).collect::<Vec<_>>(), "the whole tail, in order");
        // An encoder that never takes it again: the missing frames are counted, not hidden.
        let mut tick = 10;
        let (n, left) = drain(&mut tick, 30, Duration::from_millis(30), |t| Ok(t < 25)).unwrap();
        assert_eq!((n, left), (15, 6));
        assert_eq!(drain(&mut 0, 5, Duration::from_millis(30), |_| Err("writer failed".into())), Err("writer failed".into()));
    }

    #[test]
    fn nothing_is_taken_while_nothing_records() {
        let t = tempfile::tempdir().unwrap();
        let r = Recorder::new(t.path().to_path_buf());
        assert!(!r.push_frame("main", 2, 2, &[0; 16]));
        assert!(r.marker("x", "desk", None, None).is_err());
        assert_eq!(r.stop().unwrap_err().code, ProblemCode::NotRecording);
        assert!(r.session_dir("../etc", false).is_none());
    }

    #[test]
    fn a_failed_writer_session_remains_active_until_stop_closes_it() {
        let t = tempfile::tempdir().unwrap();
        let shared = Arc::new(Shared::default());
        shared.writer_gone.store(true, Ordering::Relaxed);
        shared.set_problem(RecorderProblem::new(ProblemCode::EncoderFailed, "writer stopped"));
        let (tx, _rx) = crossbeam_channel::unbounded();
        let writer = std::thread::spawn(|| Ok(()));
        let session = Session {
            dir: t.path().to_path_buf(),
            manifest: RecordingManifest {
                version: 1,
                session_id: "failed-session".into(),
                state: RecorderState::Recording,
                output_id: "sanctuary".into(),
                output_name: "Sanctuary".into(),
                profile: RecorderProfile::Standard720p30,
                audio_device_id: None,
                service_run_id: None,
                program_id: None,
                rehearsal: false,
                started_at: iso_utc(SystemTime::now()),
                stopped_at: None,
                duration_ms: None,
                files: RecordingFiles { mov: None, mp4: Some(FILE_NAME.into()) },
                markers: Vec::new(),
                frames_written: 0,
                frames_dropped: 0,
                problem: None,
            },
            width: 1280,
            height: 720,
            fps: 30,
            t0: Instant::now(),
            tx,
            shared,
            writer,
            frame: Vec::new(),
            audio: None,
        };

        let status = status_of(&session, t.path());
        assert_eq!(status.state, RecorderState::Failed);
        assert!(status.session_active, "Stop still needs to remove this live Session");
    }
}
