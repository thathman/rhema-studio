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
                    body.push_str(&format!("\n\n(Transcript removed after {days} days, as the church's settings ask.)"));
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
        // A log kept before the transcript had its own column is never cut.
        let legacy = db.save_service_log(None, "Legacy", &format!("{body}{said}"), None).unwrap();
        db.lock().unwrap().execute("UPDATE service_logs SET saved_at = '2020-01-01T00:00:00.000Z' WHERE id = ?1", params![legacy.id]).unwrap();
        assert_eq!(db.remove_old_log_transcripts(30).unwrap(), 0);
        assert_eq!(db.get_service_log(&legacy.id).unwrap().unwrap().body, format!("{body}{said}"));
    }
}
