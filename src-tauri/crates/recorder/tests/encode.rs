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

/// The file's top-level MP4 boxes, as (name, size), to show what reached the disk.
fn boxes(path: &std::path::Path) -> Vec<(String, u64)> {
    let data = std::fs::read(path).unwrap();
    let (mut at, mut out) = (0usize, Vec::new());
    while at + 8 <= data.len() {
        let size = u64::from(u32::from_be_bytes(data[at..at + 4].try_into().unwrap()));
        out.push((String::from_utf8_lossy(&data[at + 4..at + 8]).into_owned(), size));
        if size < 8 {
            break;
        }
        at += size as usize;
    }
    out
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
    eprintln!("cut-off file: {:?}", boxes(&path));
    assert_eq!(p.video_tracks, 1, "{p:?}");
    // Fragments are flushed every 2 s: at least the first two fragments survive a crash at 5 s.
    assert!(p.duration_s >= 2.0, "only {p:?} survived");
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
        while next_tick * 1_000_000 / 30 <= (now * 1e6) as i64 {
            w.tick(next_tick * 1_000_000 / 30).expect("video appends");
            next_tick += 1;
        }
    }
    w.finish().expect("file closes");
    let p = probe(&path);
    assert_eq!((p.video_tracks, p.audio_tracks), (1, 1), "{p:?}");
    assert!(p.duration_s >= 7.5, "{p:?}");
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
