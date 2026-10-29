//! Durable manifests: written atomically (temp file + rename), read back for the archive list, and
//! used at host start to find recordings interrupted by a crash or power loss.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::model::{RecorderState, RecordingManifest};

pub const MANIFEST: &str = "manifest.json";

/// Write the manifest so a crash leaves either the old or the new one, never half of one.
pub fn write(dir: &Path, manifest: &RecordingManifest) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let tmp = dir.join(".manifest.json.tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(&serde_json::to_vec_pretty(manifest).map_err(std::io::Error::other)?)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, dir.join(MANIFEST))
}

pub fn read(dir: &Path) -> std::io::Result<RecordingManifest> {
    let bytes = fs::read(dir.join(MANIFEST))?;
    serde_json::from_slice(&bytes).map_err(std::io::Error::other)
}

/// Every recording under `folder` (one directory per session), newest first. Unreadable entries are skipped.
#[must_use]
pub fn list(folder: &Path) -> Vec<(PathBuf, RecordingManifest)> {
    let mut out: Vec<(PathBuf, RecordingManifest)> = fs::read_dir(folder)
        .map(|rd| {
            rd.filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .filter_map(|p| read(&p).ok().map(|m| (p, m)))
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| b.1.started_at.cmp(&a.1.started_at));
    out
}

/// At host start no session can be live, so one left `preparing`/`recording`/`finalizing` was interrupted:
/// mark it `recoverable` (its fragmented .mov is readable up to the last fragment). Returns the ids marked.
pub fn mark_interrupted(folder: &Path) -> Vec<String> {
    let mut marked = Vec::new();
    for (dir, mut m) in list(folder) {
        if matches!(m.state, RecorderState::Preparing | RecorderState::Recording | RecorderState::Finalizing) {
            m.state = RecorderState::Recoverable;
            if write(&dir, &m).is_ok() {
                marked.push(m.session_id.clone());
            }
        }
    }
    marked
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;

    fn sample(id: &str, state: RecorderState, started: &str) -> RecordingManifest {
        RecordingManifest {
            version: 1,
            session_id: id.into(),
            state,
            output_id: "main".into(),
            output_name: "Sanctuary Main".into(),
            profile: RecorderProfile::Standard720p30,
            audio_device_id: Some("Mixer".into()),
            service_run_id: None,
            program_id: None,
            rehearsal: false,
            started_at: started.into(),
            stopped_at: None,
            duration_ms: None,
            files: RecordingFiles { mov: Some("recording.mov".into()), mp4: None },
            markers: vec![],
            frames_written: 0,
            frames_dropped: 0,
            problem: None,
        }
    }

    #[test]
    fn a_manifest_round_trips_and_leaves_no_temp_file() {
        let t = tempfile::tempdir().unwrap();
        let dir = t.path().join("s1");
        let m = sample("s1", RecorderState::Saved, "2026-10-29T10:00:00Z");
        write(&dir, &m).unwrap();
        assert_eq!(read(&dir).unwrap(), m);
        assert!(!dir.join(".manifest.json.tmp").exists());
    }

    #[test]
    fn interrupted_sessions_become_recoverable_and_finished_ones_stay() {
        let t = tempfile::tempdir().unwrap();
        write(&t.path().join("a"), &sample("a", RecorderState::Recording, "2026-10-29T09:00:00Z")).unwrap();
        write(&t.path().join("b"), &sample("b", RecorderState::Finalizing, "2026-10-29T09:30:00Z")).unwrap();
        write(&t.path().join("c"), &sample("c", RecorderState::Saved, "2026-10-29T08:00:00Z")).unwrap();
        let mut marked = mark_interrupted(t.path());
        marked.sort();
        assert_eq!(marked, vec!["a".to_string(), "b".to_string()]);
        let all = list(t.path());
        assert_eq!(all.iter().map(|(_, m)| m.session_id.as_str()).collect::<Vec<_>>(), vec!["b", "a", "c"], "newest first");
        assert_eq!(read(&t.path().join("c")).unwrap().state, RecorderState::Saved);
        assert_eq!(read(&t.path().join("a")).unwrap().state, RecorderState::Recoverable);
    }
}
