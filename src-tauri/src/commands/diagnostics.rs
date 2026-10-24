//! Assembling a log excerpt a user can send us.
//!
//! Filtering happens here rather than in the frontend so that tens of
//! megabytes never cross the IPC boundary, and so the log directory can be
//! read without granting the webview any new filesystem scope.

#![expect(clippy::needless_pass_by_value, reason = "Tauri command extractors require pass-by-value")]

use std::path::{Path, PathBuf};

use tauri::Manager;

/// Log-file basename configured on the plugin's `LogDir` target in `lib.rs`.
/// Rotated archives are `rhema_<date>.log` alongside it.
const LOG_STEM: &str = "rhema";

/// Width of the `[YYYY-MM-DD][HH:MM:SS.mmm]` stamp the formatter writes.
const TIMESTAMP_LEN: usize = 26;

/// Timestamp prefix written by our formatter: `[YYYY-MM-DD][HH:MM:SS.mmm]`.
/// Anything not starting with this is a continuation of the line before it.
fn parse_line_timestamp(line: &str) -> Option<(i64, u32, u32, u32, u32, u32)> {
    let bytes = line.as_bytes();
    if bytes.len() < 24 || bytes[0] != b'[' {
        return None;
    }
    let date = line.get(1..11)?;
    if bytes.get(11) != Some(&b']') || bytes.get(12) != Some(&b'[') {
        return None;
    }
    let time = line.get(13..21)?;

    let mut date_parts = date.split('-');
    let year: i64 = date_parts.next()?.parse().ok()?;
    let month: u32 = date_parts.next()?.parse().ok()?;
    let day: u32 = date_parts.next()?.parse().ok()?;

    let mut time_parts = time.split(':');
    let hour: u32 = time_parts.next()?.parse().ok()?;
    let minute: u32 = time_parts.next()?.parse().ok()?;
    let second: u32 = time_parts.next()?.parse().ok()?;

    Some((year, month, day, hour, minute, second))
}

/// Seconds since the Unix epoch for a UTC calendar timestamp.
///
/// Days-from-civil, from Howard Hinnant's `chrono` algorithms — valid for any
/// proleptic Gregorian date, and it keeps `time` out of this crate's
/// dependencies for what is a handful of arithmetic.
fn to_unix_seconds(year: i64, month: u32, day: u32, hour: u32, minute: u32, second: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let m = i64::from(month);
    let d = i64::from(day);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    days * 86_400 + i64::from(hour) * 3600 + i64::from(minute) * 60 + i64::from(second)
}

fn line_epoch_seconds(line: &str) -> Option<i64> {
    let (year, month, day, hour, minute, second) = parse_line_timestamp(line)?;
    Some(to_unix_seconds(year, month, day, hour, minute, second))
}

/// Keep every line at or after `cutoff`.
///
/// A line with no timestamp belongs to the record above it — multi-line error
/// `Display` output and panic backtraces both look like this — so it inherits
/// that record's verdict instead of being dropped. Leading orphan lines (a
/// file that begins mid-record) are skipped, since nothing dates them.
fn filter_since(contents: &str, cutoff: Option<i64>) -> Vec<&str> {
    let Some(cutoff) = cutoff else {
        return contents.lines().collect();
    };
    let mut kept = Vec::new();
    let mut keeping = false;
    for line in contents.lines() {
        match line_epoch_seconds(line) {
            Some(ts) => {
                keeping = ts >= cutoff;
                if keeping {
                    kept.push(line);
                }
            }
            None => {
                if keeping {
                    kept.push(line);
                }
            }
        }
    }
    kept
}

/// The active log plus its rotated archives, oldest first.
///
/// Archives are named `rhema_<YYYY-MM-DD_HH-MM-SS>.log`, so a lexical sort of
/// the archive names is chronological; the live file is always newest.
fn log_files(dir: &Path) -> Vec<PathBuf> {
    let mut archives: Vec<PathBuf> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                return false;
            };
            name.starts_with(concat!("rhema", "_")) && std::path::Path::new(name)
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("log"))
        })
        .collect();
    archives.sort();

    let live = dir.join(format!("{LOG_STEM}.log"));
    if live.is_file() {
        archives.push(live);
    }
    archives
}

fn header(
    version: &str,
    window: &str,
    files_scanned: usize,
    first: Option<&str>,
    last: Option<&str>,
) -> String {
    format!(
        "==== Rhema diagnostic log ====\n\
         app version : {version}\n\
         platform    : {} {}\n\
         window      : {window}\n\
         files read  : {files_scanned}\n\
         first entry : {}\n\
         last entry  : {}\n\
         timestamps are UTC. this file contains short fragments of speech\n\
         picked up by transcription.\n\
         ==============================\n\n",
        std::env::consts::OS,
        std::env::consts::ARCH,
        first.unwrap_or("(none in range)"),
        last.unwrap_or("(none in range)"),
    )
}

/// Values from the settings file that must never leave the computer in a
/// diagnostics file: API keys, the remote-control key, the OBS password.
fn configured_secrets(settings_json: &str) -> Vec<String> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(settings_json) else { return vec![] };
    // Both layouts: the keys in the file's "machine" part (#298), and at the top in an older file.
    let mut out: Vec<String> = Vec::new();
    for place in [v.get("machine"), Some(&v)].into_iter().flatten() {
        out.extend(["deepgramApiKey", "openaiApiKey", "claudeApiKey", "remoteSecret", "joinToken"].iter().filter_map(|k| place.get(*k).and_then(|x| x.as_str())).map(str::to_string));
        if let Some(p) = place.get("obs").and_then(|o| o.get("password")).and_then(|x| x.as_str()) {
            out.push(p.to_string());
        }
    }
    // Short values would redact ordinary words; a real key or password worth hiding is longer.
    out.retain(|s| s.trim().len() >= 6);
    out
}

/// Replace configured secrets and common credential shapes with [redacted].
/// Defence in depth: the app does not log these, but a diagnostics file is
/// meant to be sent to someone else.
fn redact(text: &str, secrets: &[String]) -> String {
    let mut out = text.to_string();
    for s in secrets {
        out = out.replace(s.as_str(), "[redacted]");
    }
    // Header- and query-style credentials: keep the name, drop the value.
    let mut result = String::with_capacity(out.len());
    for line in out.split_inclusive('\n') {
        result.push_str(&redact_line(line));
    }
    result
}

fn redact_line(line: &str) -> String {
    const MARKERS: [&str; 6] = ["X-Rhema-Key:", "x-rhema-key:", "Authorization: Bearer ", "authorization: bearer ", "api_key=", "token="];
    let mut out = line.to_string();
    for m in MARKERS {
        let mut from = 0;
        while let Some(pos) = out[from..].find(m) {
            let start = from + pos + m.len();
            let rest = &out[start..];
            let skip = rest.len() - rest.trim_start().len();
            let value_end = rest[skip..].find(|c: char| c.is_whitespace() || c == '&' || c == '"' || c == ',').map_or(rest.len(), |e| e + skip);
            // Always resume on a char boundary: after the replacement, or right after the marker.
            from = if value_end > skip {
                out.replace_range(start + skip..start + value_end, "[redacted]");
                start + skip + "[redacted]".len()
            } else {
                start + skip
            };
            if from >= out.len() {
                break;
            }
        }
    }
    out
}

/// Collect the log for the requested window as one text blob.
///
/// `since_minutes` of `None` means everything still on disk.
#[tauri::command(async)]
pub fn export_diagnostics(
    app: tauri::AppHandle,
    since_minutes: Option<u64>,
    // The secrets the app holds in memory (most now live in the system
    // keychain, not the settings file); redacted like the file's.
    extra: Option<Vec<String>>,
) -> Result<String, String> {
    let dir = app.path().app_log_dir().map_err(|e| {
        log::error!("export_diagnostics: no log dir: {e}");
        format!("Could not locate the log directory: {e}")
    })?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    #[expect(clippy::cast_possible_wrap, reason = "seconds since 1970 fit in i64 for millennia")]
    let cutoff = since_minutes.map(|mins| now as i64 - (mins as i64) * 60);

    let files = log_files(&dir);
    let mut body = String::new();
    for path in &files {
        match std::fs::read_to_string(path) {
            Ok(contents) => {
                for line in filter_since(&contents, cutoff) {
                    body.push_str(line);
                    body.push('\n');
                }
            }
            Err(e) => {
                log::warn!("export_diagnostics: skipping {}: {e}", path.display());
            }
        }
    }

    let first = body.lines().find(|l| line_epoch_seconds(l).is_some());
    let last = body.lines().rfind(|l| line_epoch_seconds(l).is_some());
    let window = since_minutes.map_or_else(
        || "everything on disk".to_string(),
        |mins| format!("last {mins} minutes"),
    );

    // Sanitize before anything leaves the app (release gate RG-08).
    let mut secrets = app
        .path()
        .app_data_dir()
        .ok()
        .and_then(|d| std::fs::read_to_string(d.join("settings.json")).ok())
        .map(|s| configured_secrets(&s))
        .unwrap_or_default();
    secrets.extend(extra.unwrap_or_default().into_iter().filter(|s| s.trim().len() >= 6));
    let body = redact(&body, &secrets);

    let head = header(
        app.package_info().version.to_string().as_str(),
        &window,
        files.len(),
        first.map(|l| &l[..l.len().min(TIMESTAMP_LEN)]),
        last.map(|l| &l[..l.len().min(TIMESTAMP_LEN)]),
    );

    log::info!(
        "export_diagnostics: {} lines from {} file(s), window={window}",
        body.lines().count(),
        files.len()
    );
    Ok(head + &body)
}

#[cfg(test)]
mod tests {
    use super::*;

    const T1: &str = "[2026-08-19][10:00:00.000][rhema][INFO] one";
    const T2: &str = "[2026-08-19][10:30:00.000][rhema][INFO] two";
    const T3: &str = "[2026-08-19][11:00:00.000][rhema][INFO] three";

    fn epoch(h: u32, m: u32) -> i64 {
        to_unix_seconds(2026, 8, 19, h, m, 0)
    }

    #[test]
    fn configured_secrets_and_credential_shapes_are_redacted() {
        let settings = r#"{"deepgramApiKey":"dg-123456789","remoteSecret":"s3cret-key","obs":{"enabled":true,"password":"obs-pass-99"},"openaiApiKey":"","gain":1}"#;
        let secrets = configured_secrets(settings);
        assert_eq!(secrets, vec!["dg-123456789", "s3cret-key", "obs-pass-99"]);
        let log = "[2026-10-21][10:00:00.000][rhema][INFO] using dg-123456789 for speech\n\
                   [2026-10-21][10:00:01.000][rhema][WARN] request X-Rhema-Key: s3cret-key refused\n\
                   [2026-10-21][10:00:02.000][rhema][INFO] GET /x?token=abcdef&next=1 Authorization: Bearer zzz999\n\
                   [2026-10-21][10:00:03.000][rhema][INFO] obs password obs-pass-99 rejected\n";
        let out = redact(log, &secrets);
        for s in ["dg-123456789", "s3cret-key", "abcdef", "zzz999", "obs-pass-99"] {
            assert!(!out.contains(s), "{s} leaked: {out}");
        }
        assert!(out.contains("token=[redacted]&next=1"));
        assert!(out.contains("X-Rhema-Key: [redacted] refused"));
        assert_eq!(out.lines().count(), 4);
        // Short values are not treated as secrets; a bad settings file yields none.
        assert!(configured_secrets(r#"{"remoteSecret":"abc"}"#).is_empty());
        // A file with the three parts (#298 M11): the keys are in "machine".
        let parts = r#"{"settingsLayout":2,"machine":{"deepgramApiKey":"dg-987654321","obs":{"password":"obs-pass-77"},"joinToken":"join-token-55"},"church":{"brandKit":{}}}"#;
        assert_eq!(configured_secrets(parts), vec!["dg-987654321", "join-token-55", "obs-pass-77"]);
        assert!(configured_secrets("not json").is_empty());
        // A marker with no value next to multi-byte text must not panic.
        assert_eq!(redact_line("token=&é ẹ́ token=,ọ́"), "token=&é ẹ́ token=,ọ́");
        assert_eq!(redact_line("token=Ọlọ́run"), "token=[redacted]");
    }

    #[test]
    fn parses_our_timestamp_format() {
        assert_eq!(line_epoch_seconds(T1), Some(epoch(10, 0)));
    }

    #[test]
    fn unix_conversion_matches_known_epochs() {
        assert_eq!(to_unix_seconds(1970, 1, 1, 0, 0, 0), 0);
        assert_eq!(to_unix_seconds(2000, 1, 1, 0, 0, 0), 946_684_800);
        assert_eq!(to_unix_seconds(2026, 8, 19, 12, 34, 56), 1_787_142_896);
    }

    #[test]
    fn none_cutoff_keeps_everything() {
        let text = format!("{T1}\n{T2}\n{T3}");
        assert_eq!(filter_since(&text, None).len(), 3);
    }

    #[test]
    fn cutoff_is_inclusive_and_drops_older_lines() {
        let text = format!("{T1}\n{T2}\n{T3}");
        let kept = filter_since(&text, Some(epoch(10, 30)));
        assert_eq!(kept, vec![T2, T3], "the boundary line itself must be kept");
    }

    #[test]
    fn everything_older_than_the_cutoff_yields_nothing() {
        let text = format!("{T1}\n{T2}");
        assert!(filter_since(&text, Some(epoch(23, 0))).is_empty());
    }

    #[test]
    fn continuation_lines_follow_the_record_above_them() {
        // A panic backtrace under a kept record stays; one under a dropped
        // record goes with it.
        let text = format!("{T1}\n   at old_frame\n{T3}\n   at new_frame\n   at deeper_frame");
        let kept = filter_since(&text, Some(epoch(11, 0)));
        assert_eq!(kept, vec![T3, "   at new_frame", "   at deeper_frame"]);
    }

    #[test]
    fn leading_orphan_lines_are_dropped_when_filtering() {
        // A file that begins mid-record has nothing dating those first lines.
        let text = format!("   dangling continuation\n{T3}");
        assert_eq!(filter_since(&text, Some(epoch(10, 0))), vec![T3]);
    }

    #[test]
    fn malformed_lines_do_not_panic_or_parse() {
        for line in [
            "",
            "[",
            "[not-a-date][10:00:00.000][x][INFO] hi",
            "[2026-08-19] 10:00:00 missing bracket",
            "[2026-08-19][aa:bb:cc.ddd][x][INFO] hi",
            "plain text",
        ] {
            assert!(line_epoch_seconds(line).is_none(), "{line:?} parsed");
        }
    }

    #[test]
    fn header_states_version_platform_and_utc() {
        let head = header("0.2.0", "last 60 minutes", 2, Some(T1), Some(T3));
        assert!(head.contains("0.2.0"));
        assert!(head.contains(std::env::consts::OS));
        assert!(head.contains("last 60 minutes"));
        assert!(head.contains("UTC"));
        assert!(
            head.contains("fragments of speech"),
            "users must be told the file carries speech content"
        );
    }

    #[test]
    fn archives_are_ordered_before_the_live_log() {
        let dir = std::env::temp_dir().join(format!("rhema-diag-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for name in [
            "rhema.log",
            "rhema_2026-08-19_09-00-00.log",
            "rhema_2026-08-19_08-00-00.log",
            "unrelated.txt",
        ] {
            std::fs::write(dir.join(name), "x").unwrap();
        }

        let names: Vec<String> = log_files(&dir)
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            names,
            vec![
                "rhema_2026-08-19_08-00-00.log",
                "rhema_2026-08-19_09-00-00.log",
                "rhema.log",
            ]
        );

        std::fs::remove_dir_all(&dir).unwrap();
    }


    #[test]
    fn header_shows_whole_timestamps() {
        let head = header("0.2.0", "last 60 minutes", 1, Some(T1), Some(T3));
        assert!(
            head.contains("[2026-08-19][10:00:00.000]"),
            "the stamp must not be cut mid-millisecond: {head}"
        );
    }
}
