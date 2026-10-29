# Contract — Rhema native recorder v1 (C1)

**Owner:** Claude (engine). **UI consumer:** Codex (Live → Record dock). **Status:** draft for review with PR `claude/recording-v1`.
Implements [42 — Rhema native service recording](../rhema-studio/42-rhema-native-service-recording.md): one pinned, named
congregation output's final composited picture plus one approved mixer audio input, recorded by the host, with OBS closed and no WAN.

## 1. Audit of the current implementation (fork/main 32bfb3c0)

| Path | What exists | Status for recording |
| --- | --- | --- |
| `src/broadcast-output.tsx` `BroadcastCanvas` / `paintFrame` | One 2D canvas per output window; scene, verse, lower third, ticker, fades; cameras (WHEP `<video>`) and videos are **drawn into** the canvas | **Shipped** — this canvas is the output's final composited picture |
| `src/broadcast-output.tsx` `pushNdiFrame` | `getImageData` → raw-body `invoke("push_ndi_frame")` / `push_ndi_region`, only while NDI is on for that output | **Partial** — the only frame path into Rust; NDI-only |
| `src-tauri/src/commands/broadcast.rs` `push_ndi_frame`, `push_ndi_region`, `set_output_pace` | Receive RGBA, hand to `rhema-broadcast` NDI sender; per-output pacer thread | **Shipped** for NDI |
| `src-tauri/crates/audio` `capture::start` | cpal input, **mono 16 kHz i16** for speech | **Not suitable** — the recorder needs full-rate stereo |
| Media audio (`output-video.ts`, `sound-store.ts`) | Plays inside webviews, not reachable from Rust | **Not recorded in v1** (see §7) |
| Encoders / muxers | None in the tree | **Not built** |
| OBS `StartRecord` (`obs-store.ts`, `ObsRecord` remote command) | Records **OBS's** program | **Not a native recorder** — stays as "OBS-only recording" |
| Browser-feed / Google TV outputs | Drawn on the remote device | **Cannot be recorded by the host** (no host frames) — refused |

## 2. Design

```
output window (pinned output only)            Rust host
canvas ──getImageData──► invoke push_ndi_frame / ──► host ─┬─► Recorder session (only if the caller is
        (one readback)          push_ndi_region            │    broadcast-<pinnedId> itself)
                                (raw body, headers)        └─► NDI sender (if NDI runs on that output)
mixer input (cpal, native rate, stereo f32) ───────────────────► Recorder session
Recorder writer thread ─► macOS: AVAssetWriter (VideoToolbox H.264 + AAC) → fragmented recording.mp4
```

- **One readback per frame.** While NDI and a recording share an output, the same RGBA frame feeds both. The recording size equals the NDI size in that case.
- **Pinned output.** A session takes frames only when the `x-ndi-output` header equals its `output_id` **and** the calling webview is that output's own window (`broadcast-<id>`): no other output, Stage, preview or operator window can pass its picture off as the recorded one, even by forging the header.
- **The output window.** `broadcast:record-tee {active,width,height,fps}` tells the pinned window to send frames while NDI is off; it also asks `recorder_status` on load, so a reloaded window resumes. NDI health is only reported for real NDI.
- **Clock.** Video and audio are stamped on one host monotonic clock (`Instant` since session start); the writer session starts at 0. The output window sends a picture when it changes (and a keep-alive at least every 2 s); the file is **constant frame rate**: every tick of the profile rate writes the latest picture, in order, with no hole in the timeline (a hole of ~0.5 s makes fragmented MPEG-4 fail to close, -11800/-16341). A tick the encoder cannot take yet is retried, never left out; `framesDropped` counts ticks written more than 2 s late (stale repeats on an overloaded computer). **Stop** writes every tick due up to the moment Stop was asked (retrying a busy encoder for up to 3 s); any it still cannot write are added to `framesDropped` and reported as a problem saying how many seconds are missing, never a silently shorter file.
- **Crash safety.** `recording.mp4` is written as fragmented MPEG-4 (a fragment every 2 s), so a file cut off by a crash or power loss plays up to its last fragment (tested by killing a recording process). No export step: the file is the deliverable. A `manifest.json` (atomic write: temp + rename) records state transitions; on host start, sessions left in `recording`/`finalizing` become `recoverable`.
- **Platforms.** macOS backend now (`crates/recorder/src/macos.rs`; OS codecs: no third-party codec licences, hardware encode). Windows (Media Foundation SinkWriter) is the next backend in the same place; until then preflight reports `unsupported_platform`.

## 3. Typed model (Rust `rhema-recorder`, serialised camelCase)

```ts
type RecorderState = "idle" | "preparing" | "recording" | "finalizing" | "saved" | "recoverable" | "failed"
type RecorderProfile = "standard_720p30" | "hd_1080p30"          // v1; 1080p only where measured fast enough
interface RecorderStartRequest {
  outputId: string                 // pinned for the whole session
  outputName: string
  outputRole: "congregation"       // anything else is refused (stage, signage, browser feeds)
  audioDeviceId: string | null     // the approved mixer input; null = record without audio only if allowSilent
  allowSilent?: boolean
  profile: RecorderProfile
  serviceRunId?: string            // links to service_runs.run_id (History)
  programId?: string
  rehearsal: boolean               // test recordings go under recordings/rehearsal
}
interface RecorderStatus {
  state: RecorderState
  sessionId: string | null
  outputId: string | null
  startedAt: string | null         // ISO
  elapsedMs: number
  video: { width: number; height: number; fps: number; framesWritten: number; framesDropped: number; lastFrameAgoMs: number | null }
  audio: { deviceId: string | null; receiving: boolean; peakDb: number | null; samplesWritten: number }
  file: { path: string | null; bytes: number; diskFreeBytes: number | null; lastWriteOk: boolean }
  problem: RecorderProblem | null
}
type RecorderProblem =
  | { code: "unsupported_platform" | "output_not_recordable" | "output_window_missing" | "no_frames" | "audio_missing"
           | "audio_device_lost" | "disk_low" | "disk_full" | "write_failed" | "encoder_failed" | "already_recording"
           | "not_recording" | "not_allowed" | "frame_size_changed"; message: string }
interface RecorderMarker { atMs: number; label: string; actor: string; serviceRunId?: string; itemId?: string }
interface RecordingManifest {           // <folder>/<sessionId>/manifest.json
  version: 1; sessionId: string; state: RecorderState; outputId: string; outputName: string; profile: RecorderProfile
  audioDeviceId: string | null; serviceRunId?: string; programId?: string; rehearsal: boolean
  startedAt: string; stoppedAt?: string; durationMs?: number; files: { mp4?: string }
  markers: RecorderMarker[]; framesWritten: number; framesDropped: number; problem?: RecorderProblem
}
```

## 4. Commands and events (Tauri, main desk only in v1)

| Command | Effect |
| --- | --- |
| `recorder_preflight({request})` → `{ ok, problems[], width, height, diskFreeBytes, audioDevices[] }` | No side effects; `width`/`height` = the NDI size if NDI runs on that output, else the profile's |
| `recorder_start({request})` → `RecorderStatus` | Main desk only. Refuses a closed output window. `preparing` → `recording`; emits `broadcast:record-tee` to the output's window |
| `recorder_marker({label, serviceRunId?, itemId?})` → `RecorderMarker` | Main desk only. Appended to the manifest at session time; never sent to OBS |
| `recorder_stop()` → `RecorderStatus` | Main desk only. `finalizing` → `saved`, or `recoverable`/`failed` with the reason |
| `recorder_status()` / event `recorder:status` to `main` (1 Hz while recording, and once on stop) | Truthful state; a REC badge must come from this, never a UI flag |
| `recorder_list({rehearsal})` → `RecordingManifest[]` | Newest first, read from manifests |
| `push_ndi_frame` / `push_ndi_region` (existing) | Now also the recorder's input (see §2) |

Errors are `RecorderProblem` (`{code, message}`), message written for the operator.

**Never:** starting a recording does not Take, change a scene, start OBS or change any output; stopping does not either. Remote/joined desks cannot start/stop in v1 (a separate explicit **Recorder** grant comes with C3 host permissions; Obs/Screens/Present/Stage roles confer nothing).

## 5. State machine and failures

`idle → preparing → recording → finalizing → saved`; `recording → failed` (encoder or disk error: frames stop being accepted; on stop the file so far is closed if it can be (`saved` with the problem kept) or left as fragments (`recoverable`)); host restart while `recording`/`finalizing` → `recoverable`. Disk free is checked at preflight (refuse < 2 GB) and every 5 s while recording (`disk_low` < 1 GB; `disk_full` below 200 MB closes the file properly and keeps it). Audio device loss → `audio_device_lost` problem, video continues, silence is not invented. No frames for 5 s → `no_frames` problem (the output window closed or stopped painting). **A recorder failure never stops or slows Live outputs:** the tee drops recorder frames (counted) rather than blocking the output window or NDI.

## 6. Performance budget (to be measured, not assumed)

The frame readback (`getImageData`) is the dominant cost: ~70 ms per 1080p frame on the Intel Mac (comment in `broadcast-output.tsx`), so **`standard_720p30` is the v1 default**; `hd_1080p30` is offered only where preflight measures the readback fast enough. Encoding uses VideoToolbox (hardware). A later optimisation can replace the readback with WebCodecs `VideoFrame` capture. CPU/RAM/dropped-frame figures go in the PR once measured.

## 7. Scope limits in v1

- One session, one congregation output, one stereo mixer input. No ISO cameras, multi-output, stems, pause, record-only scenes.
- Media sound played by a video item is **not** captured separately; churches record the mixer, which carries the room/PA mix (doc 42 §1 audio policy: no silent guess, no double capture).
- macOS backend only; other platforms report `unsupported_platform` at preflight.
- History linkage is by `serviceRunId` in the manifest; a database index (additive migration) follows once Codex's History UI needs queries.

## 8. Licensing

AVFoundation, VideoToolbox, AudioToolbox and CoreMedia are macOS system frameworks (no redistribution, no codec licence fees for the app). Rust bindings: `objc2-av-foundation`, `objc2-core-media`, `objc2-core-video` (MIT/Apache-2.0, same objc2 0.6 family already in `Cargo.lock`). No FFmpeg/GStreamer/GPL code. `cpal` (Apache-2.0) is already used by `rhema-audio`.

## 9. Rollback

Additive only: a new crate, six new commands, a new event and a new folder under app data. No migration. Reverting the PR removes them; `push_ndi_frame` returns to NDI-only; recordings already made stay on disk as ordinary MP4 files.

## 10. Tests

- Rust unit: state machine, manifest atomic write and recovery, tee routing by output id (frames from other outputs ignored), disk thresholds.
- Rust integration (macOS): synthesize 1080p/720p frames + a 1 kHz tone for 5 s → finalize → open with `AVURLAsset`: H.264 video track at the requested size, AAC stereo audio track, duration within 100 ms, audio/video start aligned.
- Native QA journey (later): real output window with a scene change and verse, OBS closed, play the file back.
