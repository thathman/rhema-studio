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

const COLS: &str = "id, program_id, title, saved_at, length(body)";

fn row_to_summary(r: &rusqlite::Row<'_>) -> rusqlite::Result<ServiceLogSummary> {
    Ok(ServiceLogSummary { id: r.get(0)?, program_id: r.get(1)?, title: r.get(2)?, saved_at: r.get(3)?, bytes: r.get(4)? })
}

impl ContentDb {
    pub fn save_service_log(&self, program_id: Option<&str>, title: &str, body: &str) -> Result<ServiceLogSummary> {
        let title = title.trim();
        if title.is_empty() {
            return Err(ContentError::Invalid("log title is required".into()));
        }
        if body.trim().is_empty() {
            return Err(ContentError::Invalid("log is empty".into()));
        }
        if body.len() > MAX_LOG_BYTES {
            return Err(ContentError::Invalid("log is too large".into()));
        }
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let id = new_id();
        tx.execute(
            "INSERT INTO service_logs (id, program_id, title, body) VALUES (?1, ?2, ?3, ?4)",
            params![id, program_id, title, body],
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
            let mut st = conn.prepare(&format!("SELECT {COLS} FROM service_logs WHERE title LIKE ?1 ESCAPE '\\' OR body LIKE ?1 ESCAPE '\\' ORDER BY saved_at DESC LIMIT ?2"))?;
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
            .query_row(&format!("SELECT {COLS}, body FROM service_logs WHERE id = ?1"), params![id], |r| {
                Ok(ServiceLog { summary: row_to_summary(r)?, body: r.get(5)? })
            })
            .optional()?)
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
        let a = db.save_service_log(Some(&p.id), "Sunday 9am", "09:01 LIVE John 3:16 (2:00)\n09:03 LIVE Amazing Grace").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let b = db.save_service_log(None, "Midweek", "19:00 LIVE Psalm 23").unwrap();
        assert_eq!(db.list_service_logs(None, 10).unwrap().iter().map(|l| l.id.as_str()).collect::<Vec<_>>(), vec![b.id.as_str(), a.id.as_str()]);
        assert_eq!(db.list_service_logs(Some("amazing"), 10).unwrap().len(), 1);
        assert_eq!(db.list_service_logs(Some("100%"), 10).unwrap().len(), 0);
        db.save_service_log(None, "Paths", "C:\\Users\\tolu").unwrap();
        assert_eq!(db.list_service_logs(Some("C:\\Users"), 10).unwrap().len(), 1);
        assert_eq!(db.list_service_logs(Some("C:Users"), 10).unwrap().len(), 0);
        assert_eq!(db.get_service_log(&a.id).unwrap().unwrap().body.lines().count(), 2);
        assert!(matches!(db.save_service_log(None, " ", "x"), Err(ContentError::Invalid(_))));
        // The log outlives its service.
        db.delete_program(&p.id, p.revision).unwrap();
        assert!(db.get_service_log(&a.id).unwrap().is_some());
        db.delete_service_log(&a.id).unwrap();
        assert!(matches!(db.delete_service_log(&a.id), Err(ContentError::NotFound(_))));
    }
}
