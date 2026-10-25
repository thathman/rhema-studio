//! Saved service logs (migration 0008): plain text kept per service, listed
//! newest first and searched with a simple case-insensitive match.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::{audit, new_id, ContentDb, ContentError, Result};

pub const MAX_LOG_BYTES: usize = 2_000_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServiceLogSummary {
    pub id: String,
    pub program_id: Option<String>,
    pub title: String,
    pub saved_at: String,
    pub bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServiceLog {
    #[serde(flatten)]
    pub summary: ServiceLogSummary,
    pub body: String,
}

const COLS: &str = "id, program_id, title, saved_at, length(body) + length(coalesce(transcript, ''))";

fn row_to_summary(r: &rusqlite::Row<'_>) -> rusqlite::Result<ServiceLogSummary> {
    Ok(ServiceLogSummary { id: r.get(0)?, program_id: r.get(1)?, title: r.get(2)?, saved_at: r.get(3)?, bytes: r.get(4)? })
}

/// How the app began a transcript appended to a kept log before migration 0013
/// (src/lib/journal-transcript.ts `transcriptSection`).
const LEGACY_HEAD: &str = "\nTranscript (recognised speech by ";

/// "09:02:13", "9:02:13 AM", "09.02.13": a transcript passage starts with a time with seconds
/// (the log's own lines have hours and minutes only).
fn starts_with_seconds(line: &str) -> bool {
    let b = line.as_bytes();
    let h = b.iter().take_while(|c| c.is_ascii_digit()).count();
    if !(1..=2).contains(&h) {
        return false;
    }
    let rest = &b[h..];
    rest.len() >= 6 && matches!(rest[0], b':' | b'.') && rest[1].is_ascii_digit() && rest[2].is_ascii_digit() && matches!(rest[3], b':' | b'.') && rest[4].is_ascii_digit() && rest[5].is_ascii_digit()
}

/// A log kept before 0013 with its transcript at the end: the log and the transcript apart. The
/// app always put the transcript last, so the LAST heading is the real one (a heading typed into
/// an earlier label is left in the log); it is split only when what follows has the transcript's
/// shape (the heading line, perhaps the "left out" line, a blank, then passages that each start
/// with a time with seconds). Anything else: None, left whole.
pub(crate) fn split_legacy_transcript(body: &str) -> Option<(&str, &str)> {
    let at = body.rfind(LEGACY_HEAD)?;
    let tail = &body[at..];
    let mut lines = tail[1..].split('\n');
    if !lines.next()?.ends_with("; not checked, may contain mistakes)") {
        return None;
    }
    let mut next = lines.next()?;
    if next.starts_with('(') && next.ends_with(" left out for length)") {
        next = lines.next()?;
    }
    if !next.is_empty() {
        return None;
    }
    let mut passages = 0;
    for l in lines {
        if !starts_with_seconds(l) {
            return None;
        }
        passages += 1;
    }
    (passages > 0).then(|| (&body[..at], tail))
}

/// Migration 0013's one-time step: every log kept before it with a transcript at its end gets that
/// transcript in its own column, so the church's retention can remove it. The log text is left
/// exactly as it was before the transcript (the two read back as the same text).
pub(crate) fn split_legacy_transcripts(tx: &rusqlite::Transaction<'_>) -> Result<usize> {
    let rows: Vec<(String, String)> = {
        let mut st = tx.prepare("SELECT id, body FROM service_logs WHERE transcript IS NULL AND instr(body, ?1) > 0")?;
        let v = st.query_map(params![LEGACY_HEAD], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<std::result::Result<_, _>>()?;
        v
    };
    let mut n = 0;
    for (id, body) in rows {
        if let Some((log, transcript)) = split_legacy_transcript(&body) {
            n += tx.execute("UPDATE service_logs SET body = ?1, transcript = ?2 WHERE id = ?3", params![log, transcript, id])?;
        }
    }
    Ok(n)
}

impl ContentDb {
    /// Keep a log. `transcript` (what was said, when the operator ticked it) is kept apart from the
    /// log, in its own column, so the church's retention removes exactly it (#246 C17).
    pub fn save_service_log(&self, program_id: Option<&str>, title: &str, body: &str, transcript: Option<&str>) -> Result<ServiceLogSummary> {
        let transcript = transcript.filter(|t| !t.trim().is_empty());
        let title = title.trim();
        if title.is_empty() {
            return Err(ContentError::Invalid("log title is required".into()));
        }
        if body.trim().is_empty() {
            return Err(ContentError::Invalid("log is empty".into()));
        }
        if body.len() + transcript.map_or(0, str::len) > MAX_LOG_BYTES {
            return Err(ContentError::Invalid("log is too large".into()));
        }
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let id = new_id();
        tx.execute(
            "INSERT INTO service_logs (id, program_id, title, body, transcript) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, program_id, title, body, transcript],
        )?;
        audit(&tx, "service_log", &id, "save", &serde_json::json!({ "title": title }))?;
        let s = tx.query_row(&format!("SELECT {COLS} FROM service_logs WHERE id = ?1"), params![id], row_to_summary)?;
        tx.commit()?;
        Ok(s)
    }

    /// Newest first; `query` matches title or body, case-insensitively.
    pub fn list_service_logs(&self, query: Option<&str>, limit: usize) -> Result<Vec<ServiceLogSummary>> {
        let conn = self.lock()?;
        let limit = i64::try_from(limit.min(500)).unwrap_or(500);
        let q = query.map(str::trim).filter(|q| !q.is_empty());
        if let Some(q) = q {
            let like = format!("%{}%", q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
            let mut st = conn.prepare(&format!("SELECT {COLS} FROM service_logs WHERE title LIKE ?1 ESCAPE '\\' OR body LIKE ?1 ESCAPE '\\' OR transcript LIKE ?1 ESCAPE '\\' ORDER BY saved_at DESC LIMIT ?2"))?;
            let v = st.query_map(params![like, limit], row_to_summary)?.collect::<std::result::Result<_, _>>()?;
            return Ok(v);
        }
        let mut st = conn.prepare(&format!("SELECT {COLS} FROM service_logs ORDER BY saved_at DESC LIMIT ?1"))?;
        let v = st.query_map(params![limit], row_to_summary)?.collect::<std::result::Result<_, _>>()?;
        Ok(v)
    }

    pub fn get_service_log(&self, id: &str) -> Result<Option<ServiceLog>> {
        let conn = self.lock()?;
        Ok(conn
            .query_row(&format!("SELECT {COLS}, body, transcript, transcript_removed_days FROM service_logs WHERE id = ?1"), params![id], |r| {
                // The log as it was kept, then what was said (or that it was removed), as one text.
                let mut body: String = r.get(5)?;
                if let Some(t) = r.get::<_, Option<String>>(6)? {
                    body.push_str(&t);
                } else if let Some(days) = r.get::<_, Option<i64>>(7)? {
                    body = format!("{body}\n\n(Transcript removed after {days} days, as the church's settings ask.)");
                }
                Ok(ServiceLog { summary: row_to_summary(r)?, body })
            })
            .optional()?)
    }

    /// The church's transcript retention (#246 C17): the transcript kept with each log saved more
    /// than `days` days ago is removed; the log itself is never touched. Returns how many logs
    /// changed. `days` 0 keeps every transcript. A log kept by a build before migration 0013 has
    /// its transcript inside the log text: it is left as it is, never cut.
    pub fn remove_old_log_transcripts(&self, days: u32) -> Result<usize> {
        if days == 0 {
            return Ok(0);
        }
        let conn = self.lock()?;
        let n = conn.execute(
            "UPDATE service_logs SET transcript = NULL, transcript_removed_days = ?1
             WHERE transcript IS NOT NULL AND saved_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?2)",
            params![days, format!("-{days} days")],
        )?;
        Ok(n)
    }

    pub fn delete_service_log(&self, id: &str) -> Result<()> {
        let conn = self.lock()?;
        let n = conn.execute("DELETE FROM service_logs WHERE id = ?1", params![id])?;
        if n == 0 {
            return Err(ContentError::NotFound(id.into()));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logs_are_kept_listed_newest_first_and_searched() {
        let db = ContentDb::open_in_memory().unwrap();
        let p = db.create_program("Sunday", None).unwrap();
        let a = db.save_service_log(Some(&p.id), "Sunday 9am", "09:01 LIVE John 3:16 (2:00)\n09:03 LIVE Amazing Grace", None).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let b = db.save_service_log(None, "Midweek", "19:00 LIVE Psalm 23", None).unwrap();
        assert_eq!(db.list_service_logs(None, 10).unwrap().iter().map(|l| l.id.as_str()).collect::<Vec<_>>(), vec![b.id.as_str(), a.id.as_str()]);
        assert_eq!(db.list_service_logs(Some("amazing"), 10).unwrap().len(), 1);
        assert_eq!(db.list_service_logs(Some("100%"), 10).unwrap().len(), 0);
        db.save_service_log(None, "Paths", "C:\\Users\\tolu", None).unwrap();
        assert_eq!(db.list_service_logs(Some("C:\\Users"), 10).unwrap().len(), 1);
        assert_eq!(db.list_service_logs(Some("C:Users"), 10).unwrap().len(), 0);
        assert_eq!(db.get_service_log(&a.id).unwrap().unwrap().body.lines().count(), 2);
        assert!(matches!(db.save_service_log(None, " ", "x", None), Err(ContentError::Invalid(_))));
        // The log outlives its service.
        db.delete_program(&p.id, p.revision).unwrap();
        assert!(db.get_service_log(&a.id).unwrap().is_some());
        db.delete_service_log(&a.id).unwrap();
        assert!(matches!(db.delete_service_log(&a.id), Err(ContentError::NotFound(_))));
    }

    #[test]
    fn old_transcripts_are_removed_and_the_logs_kept_whole() {
        let db = ContentDb::open_in_memory().unwrap();
        // A label typed by an operator or a desk may carry the transcript heading itself: the log
        // must survive retention whole, whatever it says (the log is the execution history).
        let body = "09:01 LIVE John 3:16\n09:02 message   \nTranscript (recognised speech by Whisper; forged\n09:03 LIVE Psalm 23";
        let said = "\n\nTranscript (recognised speech by Whisper (on this computer); not checked, may contain mistakes)\n\n09:02  For God so loved";
        let old = db.save_service_log(None, "Old", body, Some(said)).unwrap();
        let new = db.save_service_log(None, "New", body, Some(said)).unwrap();
        let plain = db.save_service_log(None, "Plain", "09:01 LIVE Psalm 23", None).unwrap();
        assert_eq!(db.get_service_log(&old.id).unwrap().unwrap().body, format!("{body}{said}"), "read back as one text");
        assert!(db.list_service_logs(Some("so loved"), 10).unwrap().len() == 2, "the transcript is searched");
        db.lock().unwrap().execute("UPDATE service_logs SET saved_at = '2020-01-01T00:00:00.000Z' WHERE id IN (?1, ?2)", params![old.id, plain.id]).unwrap();
        assert_eq!(db.remove_old_log_transcripts(0).unwrap(), 0, "0 keeps every transcript");
        assert_eq!(db.remove_old_log_transcripts(30).unwrap(), 1);
        let kept = db.get_service_log(&old.id).unwrap().unwrap().body;
        assert!(kept.starts_with(body), "the log itself is untouched, forged heading and all: {kept}");
        assert!(kept.contains("09:03 LIVE Psalm 23") && !kept.contains("For God so loved") && kept.ends_with("(Transcript removed after 30 days, as the church's settings ask.)"), "{kept}");
        assert!(db.get_service_log(&new.id).unwrap().unwrap().body.contains("For God so loved"), "a recent log keeps its transcript");
        assert_eq!(db.get_service_log(&plain.id).unwrap().unwrap().body, "09:01 LIVE Psalm 23");
        assert_eq!(db.remove_old_log_transcripts(30).unwrap(), 0, "already removed");
        // A log saved without a transcript column value but with the heading in a label: retention leaves it whole.
        let typed = db.save_service_log(None, "Typed", body, None).unwrap();
        db.lock().unwrap().execute("UPDATE service_logs SET saved_at = '2020-01-01T00:00:00.000Z' WHERE id = ?1", params![typed.id]).unwrap();
        assert_eq!(db.remove_old_log_transcripts(30).unwrap(), 0);
        assert_eq!(db.get_service_log(&typed.id).unwrap().unwrap().body, body);
    }

    const SAID: &str = "\nTranscript (recognised speech by Whisper (on this computer); not checked, may contain mistakes)\n\n09:02:13  For God so loved\n9:03:40 AM  the world";

    #[test]
    fn a_legacy_transcript_is_split_at_its_last_heading_only_when_it_has_the_shape() {
        let log = "Sunday\nService log\n\n09:01  LIVE          John 3:16";
        let body = format!("{log}{SAID}");
        assert_eq!(split_legacy_transcript(&body), Some((log, SAID)));
        // A heading typed into an earlier label, and a real transcript after: the label stays in the log.
        let forged = "09:01  stage message Mic 2\nTranscript (recognised speech by X; not checked, may contain mistakes)\n\n09:02:00  fake\n09:03  LIVE          Psalm 23";
        let both = format!("{forged}{SAID}");
        assert_eq!(split_legacy_transcript(&both), Some((forged, SAID)));
        // The heading alone in a label, no transcript after it in the right shape: left whole.
        assert_eq!(split_legacy_transcript(forged), None, "the log's own lines (hours and minutes) follow it");
        assert_eq!(split_legacy_transcript("09:01 LIVE John 3:16"), None);
        assert_eq!(split_legacy_transcript("x\nTranscript (recognised speech by X; not checked, may contain mistakes)\n\n"), None, "no passages");
        // The left-out line is part of the heading.
        let cut = "\nTranscript (recognised speech by X; not checked, may contain mistakes)\n(3 earlier passages left out for length)\n\n10:00:01  Amen";
        assert_eq!(split_legacy_transcript(&format!("{log}{cut}")), Some((log, cut)));
    }

    #[test]
    fn migration_0013_moves_legacy_transcripts_once_and_retention_then_removes_them() {
        let dir = std::env::temp_dir().join(format!("rhema-logs-{}", crate::new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("content.db");
        let log = "Sunday\nService log\n\n09:01  LIVE          John 3:16";
        let forged = "09:01  stage message Mic 2\nTranscript (recognised speech by X; not checked, may contain mistakes)\n\n09:02:00  fake\n09:03  LIVE          Psalm 23";
        let (plain, both, typed) = {
            // A build before 0013 kept these logs, transcripts inside.
            let before = crate::MIGRATIONS.iter().position(|(v, _)| *v == "0013_service_log_transcript").unwrap();
            let db = ContentDb::open_with_migrations(&path, &crate::MIGRATIONS[..before]).unwrap();
            let ins = |title: &str, body: &str| {
                let id = crate::new_id();
                db.lock().unwrap().execute("INSERT INTO service_logs (id, program_id, title, body, saved_at) VALUES (?1, NULL, ?2, ?3, '2020-01-01T00:00:00.000Z')", params![id, title, body]).unwrap();
                id
            };
            (ins("Plain", &format!("{log}{SAID}")), ins("Both", &format!("{forged}{SAID}")), ins("Typed", forged))
        };
        let db = ContentDb::open(&path).unwrap();
        let col = |id: &str| db.lock().unwrap().query_row("SELECT body, transcript FROM service_logs WHERE id = ?1", params![id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))).unwrap();
        assert_eq!(col(&plain), (log.to_string(), Some(SAID.to_string())));
        assert_eq!(col(&both), (forged.to_string(), Some(SAID.to_string())), "the typed heading stays in the log");
        assert_eq!(col(&typed), (forged.to_string(), None), "nothing in the transcript's shape: left whole");
        assert_eq!(db.get_service_log(&plain).unwrap().unwrap().body, format!("{log}{SAID}"), "reads back as before");
        // Retention now reaches them; the logs stay.
        assert_eq!(db.remove_old_log_transcripts(30).unwrap(), 2);
        assert!(db.get_service_log(&both).unwrap().unwrap().body.starts_with(forged));
        assert!(!db.get_service_log(&both).unwrap().unwrap().body.contains("For God so loved"));
        assert_eq!(db.get_service_log(&typed).unwrap().unwrap().body, forged);
        drop(db);
        // Opened again: the step does not run twice (the migration is applied once).
        let db = ContentDb::open(&path).unwrap();
        assert_eq!(db.get_service_log(&typed).unwrap().unwrap().body, forged);
        drop(db);
        let _ = std::fs::remove_dir_all(dir);
    }
}
