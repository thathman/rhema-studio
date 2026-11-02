//! Real encodes through the system's encoder (AVFoundation, Media Foundation): a playable file with
//! the right picture and sound, and a file cut off by a crash that still plays up to its last fragment.
#![cfg(any(target_os = "macos", windows))]

use std::f32::consts::TAU;
use std::time::{Duration, Instant};

use rhema_recorder::backend::{probe, Writer};

const W: u32 = 1280;
const H: u32 = 720;

/// A moving test card: a bar sweeping across a mid-grey frame.
fn frame(i: u32) -> Vec<u8> {
    let mut f = vec![128u8; (W * H * 4) as usize];
    let x0 = (i * 20) % W;
    for y in 0..H {
        for x in x0..(x0 + 40).min(W) {
            let p = ((y * W + x) * 4) as usize;
            f[p..p + 4].copy_from_slice(&[255, 40, 40, 255]);
        }
    }
    f
}

/// `secs` of 30 fps pictures and a 1 kHz 48 kHz stereo tone, in real time, as a session would.
fn record(path: &std::path::Path, secs: u32, finish: bool) {
    let mut w = Writer::start(path, W, H, 30, 5_000_000, Some(48_000)).expect("writer starts");
    let t0 = Instant::now();
    // Stamped by frame number (a debug build cannot draw test cards in real time; the file must still be 4 s).
    let mut audio_at = 0i64;
    for i in 0..secs * 30 {
        let due = Duration::from_millis(u64::from(i) * 1000 / 30);
        if let Some(wait) = due.checked_sub(t0.elapsed()) {
            std::thread::sleep(wait);
        }
        w.set_frame(&frame(i)).expect("picture converts");
        assert!(w.tick(i64::from(i) * 1_000_000 / 30).expect("video appends"));
        // 1600 frames of audio per picture at 48 kHz / 30 fps.
        let block: Vec<f32> = (0..1600).flat_map(|n| {
            let s = 0.25 * (TAU * 1000.0 * (audio_at + n) as f32 / 48_000.0).sin();
            [s, s]
        }).collect();
        while !w.append_audio(&block, audio_at).expect("audio appends") {
            std::thread::sleep(Duration::from_millis(2));
        }
        audio_at += 1600;
    }
    if finish {
        w.finish().expect("file closes");
    } else {
        // A crash: the writer is never finished and its memory never freed.
        std::mem::forget(w);
    }
}

/// One encoder at a time, as in a real session.
static ONE: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[test]
fn a_finished_recording_plays_with_h264_picture_and_aac_sound() {
    let _one = ONE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("recording.mp4");
    record(&path, 4, true);
    let p = probe(&path);
    assert_eq!((p.video_tracks, p.audio_tracks), (1, 1), "{p:?}");
    assert_eq!((p.width, p.height), (f64::from(W), f64::from(H)));
    assert!((p.duration_s - 4.0).abs() < 0.15, "duration {p:?}");
}

#[test]
fn a_recording_cut_off_by_a_crash_still_plays_its_fragments() {
    // Run the recording in a child process that dies without closing the file.
    if let Ok(path) = std::env::var("RHEMA_REC_CRASH_FILE") {
        record(std::path::Path::new(&path), 5, false);
        std::process::abort();
    }
    let _one = ONE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("recording.mp4");
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "a_recording_cut_off_by_a_crash_still_plays_its_fragments", "--nocapture"])
        .env("RHEMA_REC_CRASH_FILE", &path)
        .status()
        .unwrap();
    assert!(!status.success(), "the child must have crashed");
    let p = probe(&path);
    assert_eq!(p.video_tracks, 1, "{p:?}");
    // Fragments are flushed every 2 s: at least the first two fragments survive a crash at 5 s.
    assert!(p.duration_s >= 2.0, "only {p:?} survived");
}

/// After a crash, the next start settles the interrupted session for History: recoverable, with
/// the length its file actually plays (the manifest had none).
#[test]
fn a_crashed_recording_is_listed_recoverable_with_the_length_it_plays() {
    if let Ok(path) = std::env::var("RHEMA_REC_CRASH_SESSION_FILE") {
        record(std::path::Path::new(&path), 5, false);
        std::process::abort();
    }
    let _one = ONE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let folder = tempfile::tempdir().unwrap();
    let dir = folder.path().join("session-1");
    let manifest = rhema_recorder::RecordingManifest {
        version: 1,
        session_id: "session-1".into(),
        state: rhema_recorder::RecorderState::Recording,
        output_id: "main".into(),
        output_name: "Sanctuary".into(),
        profile: rhema_recorder::RecorderProfile::Standard720p30,
        audio_device_id: None,
        service_run_id: None,
        program_id: None,
        rehearsal: false,
        started_at: "2026-11-02T10:00:00Z".into(),
        stopped_at: None,
        duration_ms: None,
        files: rhema_recorder::RecordingFiles { mov: None, mp4: Some(rhema_recorder::FILE_NAME.into()) },
        markers: vec![],
        frames_written: 0,
        frames_dropped: 0,
        problem: None,
    };
    rhema_recorder::manifest::write(&dir, &manifest).unwrap();
    let file = dir.join(rhema_recorder::FILE_NAME);
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "a_crashed_recording_is_listed_recoverable_with_the_length_it_plays", "--nocapture"])
        .env("RHEMA_REC_CRASH_SESSION_FILE", &file)
        .status()
        .unwrap();
    assert!(!status.success(), "the child must have crashed");
    let plays = probe(&file).duration_s;
    assert!(plays >= 2.0, "fragments survived: {plays}");

    let _recorder = rhema_recorder::Recorder::new(folder.path().to_path_buf());
    let settled = rhema_recorder::manifest::read(&dir).unwrap();
    assert_eq!(settled.state, rhema_recorder::RecorderState::Recoverable);
    let ms = settled.duration_ms.expect("its length is filled in");
    assert!((ms as f64 / 1000.0 - plays).abs() < 0.5, "{ms} ms against {plays} s");
}

#[test]
fn a_still_screen_with_continuous_sound_closes_properly() {
    // What a static slide sends: a picture now and then (bursts, a 2 s keep-alive), sound all the time.
    let _one = ONE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("recording.mp4");
    let mut w = Writer::start(&path, W, H, 30, 5_000_000, Some(48_000)).expect("writer starts");
    let t0 = Instant::now();
    let mut audio_at = 0i64;
    let mut next_pic = 0.3f64;
    let mut next_tick = 0i64;
    while audio_at < 48_000 * 8 {
        // 10 ms blocks in real time, like a sound card.
        let due = Duration::from_secs_f64(audio_at as f64 / 48_000.0);
        if let Some(wait) = due.checked_sub(t0.elapsed()) {
            std::thread::sleep(wait);
        }
        let block: Vec<f32> = (0..480).flat_map(|n| { let s = 0.25 * (TAU * 440.0 * (audio_at + n) as f32 / 48_000.0).sin(); [s, s] }).collect();
        assert!(w.append_audio(&block, audio_at).expect("audio appends"), "audio refused at {audio_at}");
        audio_at += 480;
        let now = audio_at as f64 / 48_000.0;
        if now >= next_pic {
            w.set_frame(&frame((now * 10.0) as u32)).expect("picture converts");
            next_pic += 2.0;
        }
        // The session ticks at 30 fps; before the first picture a tick writes nothing.
        // A busy encoder takes the tick later, as a session does: skipping it would leave the hole
        // that fails the file (see `a_hole_in_the_timeline_fails_but_a_late_picture_does_not`).
        while next_tick * 1_000_000 / 30 <= (now * 1e6) as i64 && w.tick(next_tick * 1_000_000 / 30).expect("video appends") {
            next_tick += 1;
        }
    }
    while next_tick * 1_000_000 / 30 <= (audio_at * 1_000_000 / 48_000) {
        if w.tick(next_tick * 1_000_000 / 30).expect("video appends") {
            next_tick += 1;
        } else {
            std::thread::sleep(Duration::from_millis(2));
        }
    }
    w.finish().expect("file closes");
    let p = probe(&path);
    assert_eq!((p.video_tracks, p.audio_tracks), (1, 1), "{p:?}");
    assert!(p.duration_s >= 7.5, "{p:?}");
}

/// What -11800/-16341 means, measured 1 Nov: a jump in the picture's timestamps fails the writer,
/// while pictures that merely arrive 3 s late, with sound still flowing, close properly. So a stall
/// costs a late frame, never the file, as long as every tick is written in order.
#[cfg(target_os = "macos")]
#[test]
fn a_hole_in_the_timeline_fails_but_a_late_picture_does_not() {
    let _one = ONE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let dir = tempfile::tempdir().unwrap();
    let run = |name: &str, skip: i64| -> Result<(), String> {
        let mut w = Writer::start(&dir.path().join(name), W, H, 30, 5_000_000, Some(48_000)).expect("writer starts");
        w.set_frame(&frame(0)).expect("picture converts");
        let t0 = Instant::now();
        let (mut tick, mut audio_at, mut skipped) = (0i64, 0i64, false);
        let block = vec![0.1f32; 960];
        while t0.elapsed() < Duration::from_secs(9) {
            let now = t0.elapsed().as_secs_f64();
            while audio_at as f64 / 48_000.0 <= t0.elapsed().as_secs_f64() {
                w.append_audio(&block, audio_at)?;
                audio_at += 480;
            }
            // Seconds 3 to 6: no pictures. Then either carry on in order, or jump over the gap.
            if !(3.0..6.0).contains(&now) {
                if now >= 6.0 && !skipped {
                    skipped = true;
                    tick += skip;
                }
                while tick as f64 / 30.0 <= t0.elapsed().as_secs_f64() + skip as f64 / 30.0 * f64::from(u8::from(skipped)) && w.tick(tick * 1_000_000 / 30)? {
                    tick += 1;
                }
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        w.finish()
    };
    run("late.mp4", 0).expect("late pictures close properly");
    assert!(run("hole.mp4", 90).is_err(), "a 3 s hole fails: if this now passes, the system's writer changed");
}

#[test]
fn a_silent_recording_of_moving_pictures_closes_properly() {
    // Recording without sound (allowSilent): no audio track at all, a new picture on every tick.
    let _one = ONE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("recording.mp4");
    let mut w = Writer::start(&path, W, H, 30, 5_000_000, None).expect("writer starts");
    let t0 = Instant::now();
    let (mut written, mut busy) = (0, 0);
    for i in 0..30 * 8u32 {
        let due = Duration::from_millis(u64::from(i) * 1000 / 30);
        if let Some(wait) = due.checked_sub(t0.elapsed()) {
            std::thread::sleep(wait);
        }
        w.set_frame(&frame(i)).expect("picture converts");
        if w.tick(i64::from(i) * 1_000_000 / 30).expect("video appends") { written += 1 } else { busy += 1 }
    }
    w.finish().expect("file closes");
    let p = probe(&path);
    assert_eq!((p.video_tracks, p.audio_tracks), (1, 0), "{p:?}");
    assert!(p.duration_s >= 7.5, "{p:?} written {written} busy {busy}");
}

#[test]
fn a_silent_recording_whose_first_picture_is_late_closes_properly() {
    // The output window needs a moment before its first frame; with no sound nothing else fills it.
    let _one = ONE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("recording.mp4");
    let mut w = Writer::start(&path, W, H, 30, 5_000_000, None).expect("writer starts");
    let t0 = Instant::now();
    for i in 0..30 * 6u32 {
        let due = Duration::from_millis(u64::from(i) * 1000 / 30);
        if let Some(wait) = due.checked_sub(t0.elapsed()) {
            std::thread::sleep(wait);
        }
        if i >= 45 {
            w.set_frame(&frame(i)).expect("picture converts");
        }
        w.tick(i64::from(i) * 1_000_000 / 30).expect("video appends");
    }
    w.finish().expect("file closes");
    let p = probe(&path);
    assert!(p.duration_s >= 5.5, "{p:?}");
}

#[cfg(target_os = "macos")]
#[test]
fn a_sound_rate_aac_cannot_take_is_refused_not_a_crash() {
    let _one = ONE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let dir = tempfile::tempdir().unwrap();
    let Err(why) = Writer::start(&dir.path().join("t.mp4"), W, H, 30, 5_000_000, Some(192_000)) else { panic!("192 kHz should be refused") };
    assert!(why.contains("192000"), "{why}");
}
