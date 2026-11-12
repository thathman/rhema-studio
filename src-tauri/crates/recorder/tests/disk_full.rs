//! A disk that fills mid-recording, on a real filesystem: the recorder closes the file on its own,
//! says why in plain words, and leaves a playable MP4 and its manifest.
//!
//! Ignored by default: it fills a whole volume. Run it only on a small dedicated disk image:
//!
//! ```sh
//! hdiutil create -size 2600m -fs APFS -volname RhemaDiskFull -type SPARSE ~/RhemaQA/diskfull.sparseimage
//! hdiutil attach ~/RhemaQA/diskfull.sparseimage
//! RHEMA_DISKFULL_DIR=/Volumes/RhemaDiskFull/rec cargo test -p rhema-recorder --test disk_full -- --ignored --nocapture
//! hdiutil detach /Volumes/RhemaDiskFull
//! ```
#![cfg(target_os = "macos")]

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use rhema_recorder::{disk_free, manifest, FrameTiming, ProblemCode, Recorder, RecorderProfile, RecorderStartRequest, RecorderState, FILE_NAME};

/// What the filler leaves free: under `DISK_FULL` (200 MB), with room to close the file.
const LEAVE_FREE: u64 = 150 << 20;
/// The test refuses any volume bigger than this, so it can never fill the computer's own disk.
const MAX_VOLUME: u64 = 8 << 30;

fn volume_size(path: &Path) -> u64 {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    assert_eq!(unsafe { libc::statvfs(c.as_ptr(), std::ptr::addr_of_mut!(st)) }, 0, "statvfs {}", path.display());
    u64::from(st.f_blocks) * st.f_frsize
}

/// The filler file, deleted when dropped (a failed assertion included) so the volume is freed.
struct Filler(PathBuf);
impl Drop for Filler {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Real bytes (zeros allocate blocks on APFS) until `LEAVE_FREE` is left on `dir`'s volume.
fn fill(dir: &Path) -> Filler {
    let path = dir.join("filler.bin");
    let mut f = std::fs::File::create(&path).unwrap();
    let chunk = vec![0u8; 8 << 20];
    loop {
        let free = disk_free(dir).unwrap();
        if free <= LEAVE_FREE {
            break;
        }
        let n = usize::try_from((free - LEAVE_FREE).min(chunk.len() as u64)).unwrap();
        // The recording is writing too: a full disk here just means the filler is done.
        if f.write_all(&chunk[..n]).is_err() || f.sync_data().is_err() {
            break;
        }
    }
    Filler(path)
}

/// A moving bar on grey, `i` steps along: what the output window would send.
fn picture(base: &[u8], step: u32, width: u32, height: u32) -> Vec<u8> {
    let mut frame = base.to_vec();
    let left = (step * 16) % width;
    for line in 0..height {
        let row = (line * width) as usize * 4;
        for col in left..(left + 32).min(width) {
            let at = row + col as usize * 4;
            frame[at..at + 4].copy_from_slice(&[230, 40, 40, 255]);
        }
    }
    frame
}

#[test]
#[ignore = "fills a whole volume: run on a dedicated disk image with RHEMA_DISKFULL_DIR set"]
fn a_disk_filling_mid_recording_closes_a_playable_file_and_says_so() {
    let Ok(dir) = std::env::var("RHEMA_DISKFULL_DIR") else {
        eprintln!("RHEMA_DISKFULL_DIR not set: skipped");
        return;
    };
    let dir = PathBuf::from(dir);
    std::fs::create_dir_all(&dir).unwrap();
    let size = volume_size(&dir);
    assert!(size <= MAX_VOLUME, "{} is on a {} MB volume: use a small dedicated disk image", dir.display(), size >> 20);
    let free = disk_free(&dir).unwrap();
    assert!(free >= rhema_recorder::DISK_START_MIN, "only {} MB free: the image must allow a start", free >> 20);

    let rec = Recorder::new(dir.clone());
    let req = RecorderStartRequest {
        output_id: "sanctuary".into(),
        output_name: "Sanctuary".into(),
        output_role: "congregation".into(),
        audio_device_id: None,
        allow_silent: true,
        profile: RecorderProfile::Standard720p30,
        service_run_id: None,
        program_id: None,
        rehearsal: false,
    };
    let (w, h, fps) = RecorderProfile::Standard720p30.size();
    let started = rec.start(&req, w, h).expect("recording starts");
    let session_id = started.session_id.clone().unwrap();
    eprintln!("started {session_id} with {} MB free", free >> 20);

    let pushing = AtomicBool::new(true);
    let base = vec![128u8; (w * h * 4) as usize];
    let (filler, ended) = std::thread::scope(|scope| {
        scope.spawn(|| {
            let t0 = Instant::now();
            let mut i = 0u32;
            while pushing.load(Ordering::Relaxed) {
                let due = Duration::from_millis(u64::from(i) * 1000 / u64::from(fps));
                if let Some(wait) = due.checked_sub(t0.elapsed()) {
                    std::thread::sleep(wait);
                }
                rec.push_frame("sanctuary", w, h, &picture(&base, i, w, h), FrameTiming::default());
                i += 1;
            }
        });
        std::thread::sleep(Duration::from_secs(4));
        let filler = fill(&dir);
        eprintln!("filled: {} MB left, status {:?}", disk_free(&dir).unwrap() >> 20, rec.status().state);
        // What the host's status beat does once a second; the writer looks at the disk every 5 s.
        // Frames keep arriving throughout, as the output window keeps drawing.
        let (until, mut told, mut ended) = (Instant::now() + Duration::from_secs(15), false, None);
        while ended.is_none() && Instant::now() < until {
            std::thread::sleep(Duration::from_secs(1));
            let state = rec.status().state;
            assert!(matches!(state, RecorderState::Recording | RecorderState::Finalizing), "never shown as failed: {state:?}");
            ended = rec.end_if_disk_full_then(|ended| told = ended.output_id.as_deref() == Some("sanctuary"));
        }
        std::thread::sleep(Duration::from_secs(3));
        pushing.store(false, Ordering::Relaxed);
        assert!(told, "the recorded output's window is told to stop sending");
        (filler, ended.expect("the recording ended on its own once the disk filled"))
    });

    eprintln!("ended: {ended:#?}");
    let status = rec.status();
    assert_eq!((status.session_id.as_deref(), status.state), (Some(session_id.as_str()), ended.state), "the ended status stays until the next start");
    assert!(!status.session_active, "{status:?}");
    assert_eq!(status.state, RecorderState::Saved, "{status:?}");
    let problem = status.problem.clone().expect("a problem is reported");
    assert_eq!(problem.code, ProblemCode::DiskFull, "{problem:?}");
    assert!(problem.message.contains("disk is nearly full"), "said in plain words: {}", problem.message);
    assert!(status.file.bytes > 0, "{status:?}");
    assert!(status.file.last_write_ok, "{status:?}");
    // Nothing is left to stop.
    assert_eq!(rec.stop().unwrap_err().code, ProblemCode::NotRecording);

    let session = dir.join(&session_id);
    let m = manifest::read(&session).expect("manifest written");
    eprintln!("manifest: {m:#?}");
    assert_eq!(m.state, RecorderState::Saved);
    assert_eq!(m.problem.map(|p| p.code), Some(ProblemCode::DiskFull));
    assert!(m.frames_written > 0);
    let file = session.join(FILE_NAME);
    let bytes = std::fs::metadata(&file).unwrap().len();
    let p = rhema_recorder::backend::probe(&file);
    eprintln!("file {} ({bytes} bytes): {p:?}", file.display());
    assert!(bytes > 0);
    assert_eq!((p.video_tracks, p.audio_tracks), (1, 0), "{p:?}");
    assert!(p.duration_s >= 4.0, "plays up to the full disk: {p:?}");
    let listed_ms = m.duration_ms.expect("its length");
    assert!((Duration::from_millis(listed_ms).as_secs_f64() - p.duration_s).abs() < 1.0, "History's length {listed_ms} ms matches the file's {p:?}");
    // History lists it as saved, and a restart does not turn it into a recoverable one.
    drop(rec);
    let again = Recorder::new(dir.clone());
    let listed = again.list(false).into_iter().find(|m| m.session_id == session_id).expect("listed");
    assert_eq!(listed.state, RecorderState::Saved);

    drop(filler);
    println!("DISKFULL_FILE={}", file.display());
}
