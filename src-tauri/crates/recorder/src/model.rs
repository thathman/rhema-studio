//! The recorder's public data model (docs/contracts/recorder-v1.md §3), serialised camelCase for the UI.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecorderState {
    Idle,
    Preparing,
    Recording,
    Finalizing,
    Saved,
    Recoverable,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecorderProfile {
    #[serde(rename = "standard_720p30")]
    Standard720p30,
    #[serde(rename = "hd_1080p30")]
    Hd1080p30,
}

impl RecorderProfile {
    /// Picture size and frame rate the file is written at.
    #[must_use]
    pub const fn size(self) -> (u32, u32, u32) {
        match self {
            Self::Standard720p30 => (1280, 720, 30),
            Self::Hd1080p30 => (1920, 1080, 30),
        }
    }

    /// Average video bitrate (bits/s): plenty for slides and a camera, small enough for a long service.
    #[must_use]
    pub const fn video_bitrate(self) -> u32 {
        match self {
            Self::Standard720p30 => 5_000_000,
            Self::Hd1080p30 => 8_000_000,
        }
    }
}

/// What the start request names. Only a congregation output may be recorded (doc 42 §1).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecorderStartRequest {
    pub output_id: String,
    pub output_name: String,
    pub output_role: String,
    pub audio_device_id: Option<String>,
    #[serde(default)]
    pub allow_silent: bool,
    pub profile: RecorderProfile,
    #[serde(default)]
    pub service_run_id: Option<String>,
    #[serde(default)]
    pub program_id: Option<String>,
    #[serde(default)]
    pub rehearsal: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProblemCode {
    UnsupportedPlatform,
    OutputNotRecordable,
    OutputWindowMissing,
    NoFrames,
    AudioMissing,
    AudioDeviceLost,
    DiskLow,
    DiskFull,
    WriteFailed,
    EncoderFailed,
    AlreadyRecording,
    NotRecording,
    /// Only the main desk may start or stop a recording (a separate Recorder grant comes with host permissions, C3).
    NotAllowed,
    /// Frames arrive at a different size from the one the file was started at (NDI was changed mid-recording).
    FrameSizeChanged,
    /// A warning, never a refusal: the computer is so loaded the screen and encoder may fall behind.
    ComputerBusy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecorderProblem {
    pub code: ProblemCode,
    pub message: String,
}

impl RecorderProblem {
    #[must_use]
    pub fn new(code: ProblemCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoStatus {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub frames_written: u64,
    pub frames_dropped: u64,
    pub last_frame_ago_ms: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStatus {
    pub device_id: Option<String>,
    pub receiving: bool,
    pub peak_db: Option<f32>,
    pub samples_written: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    pub path: Option<String>,
    pub bytes: u64,
    pub disk_free_bytes: Option<u64>,
    pub last_write_ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecorderStatus {
    pub state: RecorderState,
    pub session_id: Option<String>,
    pub output_id: Option<String>,
    pub started_at: Option<String>,
    pub elapsed_ms: u64,
    pub video: VideoStatus,
    pub audio: AudioStatus,
    pub file: FileStatus,
    pub problem: Option<RecorderProblem>,
}

impl RecorderStatus {
    #[must_use]
    pub fn idle() -> Self {
        Self {
            state: RecorderState::Idle,
            session_id: None,
            output_id: None,
            started_at: None,
            elapsed_ms: 0,
            video: VideoStatus::default(),
            audio: AudioStatus::default(),
            file: FileStatus::default(),
            problem: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecorderMarker {
    pub at_ms: u64,
    pub label: String,
    pub actor: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingFiles {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mov: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mp4: Option<String>,
}

/// `<folder>/<sessionId>/manifest.json`: the durable record of one recording.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingManifest {
    pub version: u32,
    pub session_id: String,
    pub state: RecorderState,
    pub output_id: String,
    pub output_name: String,
    pub profile: RecorderProfile,
    pub audio_device_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub program_id: Option<String>,
    pub rehearsal: bool,
    pub started_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stopped_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    pub files: RecordingFiles,
    pub markers: Vec<RecorderMarker>,
    pub frames_written: u64,
    pub frames_dropped: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub problem: Option<RecorderProblem>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_names_match_the_contract() {
        assert_eq!(serde_json::to_string(&RecorderProfile::Standard720p30).unwrap(), "\"standard_720p30\"");
        assert_eq!(serde_json::to_string(&RecorderProfile::Hd1080p30).unwrap(), "\"hd_1080p30\"");
        assert_eq!(serde_json::to_string(&ProblemCode::FrameSizeChanged).unwrap(), "\"frame_size_changed\"");
        assert_eq!(serde_json::to_string(&RecorderState::Recoverable).unwrap(), "\"recoverable\"");
    }
}
