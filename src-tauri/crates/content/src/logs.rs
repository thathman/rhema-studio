//! Saved service logs (migration 0008): plain text kept per service, listed
//! newest first and searched with a simple case-insensitive match.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::{audit, new_id, ContentDb, ContentError, Result};

pub const MAX_LOG_BYTES: usize = 2_000_000;
pub const MAX_RUN_CHECKPOINT_BYTES: usize = 2_000_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServiceLogSummary {
    pub id: String,
    pub program_id: Option<String>,
    pub title: String,
    pub saved_at: String,
    pub bytes: i64,
    #[serde(default)]
    pub run_id: Option<String>,
    #[serde(default)]
    pub finished_at: Option<String>,
    #[serde(default)]
    pub time_zone: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServiceLog {
    #[serde(flatten)]
    pub summary: ServiceLogSummary,
    pub body: String,
}

/// Immutable service context plus the latest durable journal checkpoint.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServiceRun {
    pub run_id: String,
    pub program_id: Option<String>,
    pub program_revision: Option<i64>,
    pub service_date: Option<String>,
    pub title: String,
    pub time_zone: Option<String>,
    pub started_at: String,
    pub updated_at: String,
    pub finished_at: Option<String>,
    pub status: String,
    pub checkpoint: serde_json::Value,
}

/// History row for a durable run. Large journal checkpoints are loaded only
/// when the operator opens a specific run.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServiceRunSummary {
    pub run_id: String,
    pub program_id: Option<String>,
    pub program_revision: Option<i64>,
    pub service_date: Option<String>,
    pub title: String,
    pub time_zone: Option<String>,
    pub started_at: String,
    pub updated_at: String,
    pub finished_at: Option<String>,
    pub status: String,
}

/// Input to a durable service-run checkpoint. These context fields are
/// captured once; subsequent calls with the same run ID may only change the
/// `checkpoint` value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServiceRunCheckpoint {
    pub run_id: String,
    pub program_id: Option<String>,
    pub program_revision: Option<i64>,
    pub service_date: Option<String>,
    pub title: String,
    pub time_zone: Option<String>,
    pub started_at: String,
    pub checkpoint: serde_json::Value,
}

const COLS: &str = "id, program_id, title, saved_at, length(body) + length(coalesce(transcript, '')), run_id, finished_at, time_zone";
const RUN_COLS: &str = "run_id, program_id, program_revision, service_date, title, time_zone, started_at, updated_at, finished_at, status, checkpoint_json";
const RUN_SUMMARY_COLS: &str = "run_id, program_id, program_revision, service_date, title, time_zone, started_at, updated_at, finished_at, status";

fn row_to_summary(r: &rusqlite::Row<'_>) -> rusqlite::Result<ServiceLogSummary> {
    Ok(ServiceLogSummary {
        id: r.get(0)?,
        program_id: r.get(1)?,
        title: r.get(2)?,
        saved_at: r.get(3)?,
        bytes: r.get(4)?,
        run_id: r.get(5)?,
        finished_at: r.get(6)?,
        time_zone: r.get(7)?,
    })
}

fn row_to_run(r: &rusqlite::Row<'_>) -> rusqlite::Result<ServiceRun> {
    let checkpoint_json: String = r.get(10)?;
    let checkpoint = serde_json::from_str(&checkpoint_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(10, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(ServiceRun {
        run_id: r.get(0)?,
        program_id: r.get(1)?,
        program_revision: r.get(2)?,
        service_date: r.get(3)?,
        title: r.get(4)?,
        time_zone: r.get(5)?,
        started_at: r.get(6)?,
        updated_at: r.get(7)?,
        finished_at: r.get(8)?,
        status: r.get(9)?,
        checkpoint,
    })
}

fn row_to_run_summary(r: &rusqlite::Row<'_>) -> rusqlite::Result<ServiceRunSummary> {
    Ok(ServiceRunSummary {
        run_id: r.get(0)?,
        program_id: r.get(1)?,
        program_revision: r.get(2)?,
        service_date: r.get(3)?,
        title: r.get(4)?,
        time_zone: r.get(5)?,
        started_at: r.get(6)?,
        updated_at: r.get(7)?,
        finished_at: r.get(8)?,
        status: r.get(9)?,
    })
}

fn service_run_by_id(conn: &rusqlite::Connection, run_id: &str) -> Result<Option<ServiceRun>> {
    Ok(conn.query_row(&format!("SELECT {RUN_COLS} FROM service_runs WHERE run_id = ?1"), params![run_id], row_to_run).optional()?)
}

fn service_log_summary_by_run_id(conn: &rusqlite::Connection, run_id: &str) -> Result<Option<ServiceLogSummary>> {
    Ok(conn.query_row(&format!("SELECT {COLS} FROM service_logs WHERE run_id = ?1"), params![run_id], row_to_summary).optional()?)
}

fn validate_run_input(run_id: &str, title: &str, started_at: &str, program_revision: Option<i64>, checkpoint: &serde_json::Value) -> Result<(String, String, String)> {
    let run_id = run_id.trim();
    let title = title.trim();
    let started_at = started_at.trim();
    if run_id.is_empty() || run_id.len() > 200 {
        return Err(ContentError::Invalid("run ID is required and must be at most 200 bytes".into()));
    }
    if title.is_empty() {
        return Err(ContentError::Invalid("service run title is required".into()));
    }
    if title.len() > 200 {
        return Err(ContentError::Invalid("service run title is too long".into()));
    }
    if started_at.is_empty() {
        return Err(ContentError::Invalid("service run start time is required".into()));
    }
    if program_revision.is_some_and(|revision| revision < 1) {
        return Err(ContentError::Invalid("service revision must be positive".into()));
    }
    if serde_json::to_vec(checkpoint).map_err(|error| ContentError::Invalid(format!("invalid service run checkpoint: {error}")))?.len() > MAX_RUN_CHECKPOINT_BYTES {
        return Err(ContentError::Invalid("service run checkpoint is too large".into()));
    }
    Ok((run_id.to_owned(), title.to_owned(), started_at.to_owned()))
}

fn normalized_optional(value: Option<&str>) -> Option<String> {
    value.map(str::trim).filter(|value| !value.is_empty()).map(str::to_owned)
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

    /// Persist the captured context and latest run checkpoint. The context is
    /// immutable for a run ID; retries may update only the checkpoint. A run
    /// recovered from an interruption becomes active again on its next saved
    /// checkpoint.
    pub fn checkpoint_service_run(&self, input: &ServiceRunCheckpoint) -> Result<ServiceRun> {
        let (run_id, title, started_at) = validate_run_input(&input.run_id, &input.title, &input.started_at, input.program_revision, &input.checkpoint)?;
        let program_id = normalized_optional(input.program_id.as_deref());
        let service_date = normalized_optional(input.service_date.as_deref());
        let time_zone = normalized_optional(input.time_zone.as_deref());
        let checkpoint_json = serde_json::to_string(&input.checkpoint).map_err(|error| ContentError::Invalid(format!("invalid service run checkpoint: {error}")))?;
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        if let Some(existing) = tx.query_row(&format!("SELECT {RUN_COLS} FROM service_runs WHERE run_id = ?1"), params![run_id], row_to_run).optional()? {
            if existing.program_id != program_id
                || existing.program_revision != input.program_revision
                || existing.service_date != service_date
                || existing.title != title
                || existing.time_zone != time_zone
                || existing.started_at != started_at
            {
                return Err(ContentError::Invalid("service run context cannot change after it is captured".into()));
            }
            if existing.status == "finished" {
                return Err(ContentError::Invalid("a finished service run cannot accept another checkpoint".into()));
            }
            let resumed = existing.status == "interrupted";
            tx.execute(
                "UPDATE service_runs SET checkpoint_json = ?1, status = 'active', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE run_id = ?2",
                params![checkpoint_json, run_id],
            )?;
            if resumed {
                audit(&tx, "service_run", &run_id, "resume", &serde_json::json!({ "status": "active" }))?;
            }
        } else {
            tx.execute(
                "INSERT INTO service_runs (run_id, program_id, program_revision, service_date, title, time_zone, started_at, checkpoint_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![run_id, program_id, input.program_revision, service_date, title, time_zone, started_at, checkpoint_json],
            )?;
            audit(&tx, "service_run", &run_id, "start", &serde_json::json!({ "program_id": program_id, "program_revision": input.program_revision, "title": title }))?;
        }
        let run = tx.query_row(&format!("SELECT {RUN_COLS} FROM service_runs WHERE run_id = ?1"), params![run_id], row_to_run)?;
        tx.commit()?;
        Ok(run)
    }

    /// Mark an uncleanly restored run as interrupted. Repeating the command is
    /// safe and does not create duplicate audit entries.
    pub fn interrupt_service_run(&self, run_id: &str) -> Result<ServiceRun> {
        let run_id = run_id.trim();
        if run_id.is_empty() {
            return Err(ContentError::Invalid("run ID is required".into()));
        }
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let mut run = tx
            .query_row(&format!("SELECT {RUN_COLS} FROM service_runs WHERE run_id = ?1"), params![run_id], row_to_run)
            .optional()?
            .ok_or_else(|| ContentError::NotFound(format!("service run {run_id}")))?;
        match run.status.as_str() {
            "finished" => return Err(ContentError::Invalid("a finished service run cannot be interrupted".into())),
            "active" => {
                tx.execute(
                    "UPDATE service_runs SET status = 'interrupted', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE run_id = ?1",
                    params![run_id],
                )?;
                audit(&tx, "service_run", run_id, "interrupt", &serde_json::Value::Null)?;
                run = tx.query_row(&format!("SELECT {RUN_COLS} FROM service_runs WHERE run_id = ?1"), params![run_id], row_to_run)?;
            }
            "interrupted" => {}
            _ => return Err(ContentError::Invalid("service run has an unknown status".into())),
        }
        tx.commit()?;
        Ok(run)
    }

    pub fn get_service_run(&self, run_id: &str) -> Result<Option<ServiceRun>> {
        let conn = self.lock()?;
        service_run_by_id(&conn, run_id)
    }

    /// Newest-updated first, with the checkpoint left out of each row.
    pub fn list_service_runs(&self, program_id: Option<&str>, limit: usize) -> Result<Vec<ServiceRunSummary>> {
        let conn = self.lock()?;
        let limit = i64::try_from(limit.min(500)).unwrap_or(500);
        let program_id = normalized_optional(program_id);
        if let Some(program_id) = program_id {
            let mut st = conn.prepare(&format!("SELECT {RUN_SUMMARY_COLS} FROM service_runs WHERE program_id = ?1 ORDER BY updated_at DESC LIMIT ?2"))?;
            return Ok(st.query_map(params![program_id, limit], row_to_run_summary)?.collect::<std::result::Result<_, _>>()?);
        }
        let mut st = conn.prepare(&format!("SELECT {RUN_SUMMARY_COLS} FROM service_runs ORDER BY updated_at DESC LIMIT ?1"))?;
        let rows = st.query_map(params![limit], row_to_run_summary)?.collect::<std::result::Result<_, _>>()?;
        Ok(rows)
    }

    /// The service running now: the newest `active` run checkpointed within `fresh_hours`. A run a
    /// crash left active days ago is not "now", so a recording never files under last week's service.
    pub fn current_service_run(&self, fresh_hours: u32) -> Result<Option<ServiceRunSummary>> {
        let conn = self.lock()?;
        Ok(conn.query_row(
            &format!("SELECT {RUN_SUMMARY_COLS} FROM service_runs WHERE status = 'active'
                      AND updated_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?1) ORDER BY updated_at DESC LIMIT 1"),
            params![format!("-{fresh_hours} hours")],
            row_to_run_summary,
        ).optional()?)
    }

    /// Finalize a run once. The body is the user's explicit journal record;
    /// transcripts are stored only when explicitly supplied. A retry returns
    /// the already saved row and never replaces its content.
    pub fn finalize_service_run(&self, run_id: &str, body: &str, finished_at: &str, transcript: Option<&str>) -> Result<ServiceLogSummary> {
        let run_id = run_id.trim();
        let body = body.trim();
        let finished_at = finished_at.trim();
        let transcript = transcript.filter(|value| !value.trim().is_empty());
        if run_id.is_empty() {
            return Err(ContentError::Invalid("run ID is required".into()));
        }
        if body.is_empty() {
            return Err(ContentError::Invalid("service run log is empty".into()));
        }
        if finished_at.is_empty() {
            return Err(ContentError::Invalid("service run finish time is required".into()));
        }
        if body.len() + transcript.map_or(0, str::len) > MAX_LOG_BYTES {
            return Err(ContentError::Invalid("service run log is too large".into()));
        }
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        if let Some(existing) = service_log_summary_by_run_id(&tx, run_id)? {
            tx.commit()?;
            return Ok(existing);
        }
        let run = tx
            .query_row(&format!("SELECT {RUN_COLS} FROM service_runs WHERE run_id = ?1"), params![run_id], row_to_run)
            .optional()?
            .ok_or_else(|| ContentError::NotFound(format!("service run {run_id}")))?;
        if run.status == "finished" {
            return Err(ContentError::Invalid("service run is already finished and cannot be finalized again".into()));
        }
        let id = new_id();
        let inserted = tx.execute(
            "INSERT INTO service_logs (id, program_id, title, body, transcript, run_id, finished_at, time_zone) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT(run_id) WHERE run_id IS NOT NULL DO NOTHING",
            params![id, run.program_id, run.title, body, transcript, run_id, finished_at, run.time_zone],
        )?;
        let summary = service_log_summary_by_run_id(&tx, run_id)?.ok_or_else(|| ContentError::Invalid("service run log could not be finalized".into()))?;
        if inserted > 0 {
            tx.execute(
                "UPDATE service_runs SET status = 'finished', finished_at = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE run_id = ?2",
                params![finished_at, run_id],
            )?;
            audit(&tx, "service_run", run_id, "finish", &serde_json::json!({ "log_id": summary.id }))?;
            audit(&tx, "service_log", &summary.id, "save", &serde_json::json!({ "title": run.title, "run_id": run_id }))?;
        }
        tx.commit()?;
        Ok(summary)
    }

    /// Newest first; `query` matches title or body, case-insensitively.
    pub fn list_service_logs(&self, query: Option<&str>, limit: usize) -> Result<Vec<ServiceLogSummary>> {
        self.list_service_logs_for_program(query, None, limit)
    }

    /// Newest first; `query` matches title or body, case-insensitively. An
    /// optional service ID scopes the list without changing legacy callers.
    pub fn list_service_logs_for_program(&self, query: Option<&str>, program_id: Option<&str>, limit: usize) -> Result<Vec<ServiceLogSummary>> {
        let conn = self.lock()?;
        let limit = i64::try_from(limit.min(500)).unwrap_or(500);
        let q = query.map(str::trim).filter(|q| !q.is_empty());
        let program_id = normalized_optional(program_id);
        if let Some(q) = q {
            let like = format!("%{}%", q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
            if let Some(program_id) = program_id {
                let mut st = conn.prepare(&format!("SELECT {COLS} FROM service_logs WHERE program_id = ?1 AND (title LIKE ?2 ESCAPE '\\' OR body LIKE ?2 ESCAPE '\\' OR transcript LIKE ?2 ESCAPE '\\') ORDER BY saved_at DESC LIMIT ?3"))?;
                return Ok(st.query_map(params![program_id, like, limit], row_to_summary)?.collect::<std::result::Result<_, _>>()?);
            }
            let mut st = conn.prepare(&format!("SELECT {COLS} FROM service_logs WHERE title LIKE ?1 ESCAPE '\\' OR body LIKE ?1 ESCAPE '\\' OR transcript LIKE ?1 ESCAPE '\\' ORDER BY saved_at DESC LIMIT ?2"))?;
            return Ok(st.query_map(params![like, limit], row_to_summary)?.collect::<std::result::Result<_, _>>()?);
        }
        if let Some(program_id) = program_id {
            let mut st = conn.prepare(&format!("SELECT {COLS} FROM service_logs WHERE program_id = ?1 ORDER BY saved_at DESC LIMIT ?2"))?;
            return Ok(st.query_map(params![program_id, limit], row_to_summary)?.collect::<std::result::Result<_, _>>()?);
        }
        let mut st = conn.prepare(&format!("SELECT {COLS} FROM service_logs ORDER BY saved_at DESC LIMIT ?1"))?;
        let rows = st.query_map(params![limit], row_to_summary)?.collect::<std::result::Result<_, _>>()?;
        Ok(rows)
    }

    pub fn get_service_log(&self, id: &str) -> Result<Option<ServiceLog>> {
        let conn = self.lock()?;
        Ok(conn
            .query_row(&format!("SELECT {COLS}, body, transcript, transcript_removed_days FROM service_logs WHERE id = ?1"), params![id], |r| {
                // The log as it was kept, then what was said (or that it was removed), as one text.
                let mut body: String = r.get(8)?;
                if let Some(t) = r.get::<_, Option<String>>(9)? {
                    body.push_str(&t);
                } else if let Some(days) = r.get::<_, Option<i64>>(10)? {
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
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let log = tx
            .query_row("SELECT run_id, title FROM service_logs WHERE id = ?1", params![id], |r| Ok((r.get::<_, Option<String>>(0)?, r.get::<_, String>(1)?)))
            .optional()?
            .ok_or_else(|| ContentError::NotFound(id.into()))?;
        tx.execute("DELETE FROM service_logs WHERE id = ?1", params![id])?;
        audit(&tx, "service_log", id, "delete", &serde_json::json!({ "title": log.1 }))?;
        if let Some(run_id) = log.0 {
            tx.execute("DELETE FROM service_runs WHERE run_id = ?1", params![run_id])?;
            audit(&tx, "service_run", &run_id, "delete", &serde_json::json!({ "service_log_id": id }))?;
        }
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone)]
    struct TestRunContext {
        program_id: Option<String>,
        program_revision: Option<i64>,
        service_date: Option<String>,
        title: String,
        time_zone: Option<String>,
        started_at: String,
    }

    fn checkpoint_input(run_id: &str, context: &TestRunContext, checkpoint: serde_json::Value) -> ServiceRunCheckpoint {
        ServiceRunCheckpoint {
            run_id: run_id.to_owned(),
            program_id: context.program_id.clone(),
            program_revision: context.program_revision,
            service_date: context.service_date.clone(),
            title: context.title.clone(),
            time_zone: context.time_zone.clone(),
            started_at: context.started_at.clone(),
            checkpoint,
        }
    }

    #[test]
    fn the_current_run_is_the_newest_active_one_checkpointed_recently() {
        let db = ContentDb::open_in_memory().unwrap();
        assert_eq!(db.current_service_run(12).unwrap(), None);
        let ctx = TestRunContext { program_id: None, program_revision: None, service_date: None, title: "Sunday".into(), time_zone: None, started_at: "2026-11-01T09:00:00Z".into() };
        db.checkpoint_service_run(&checkpoint_input("old", &ctx, serde_json::json!({}))).unwrap();
        db.checkpoint_service_run(&checkpoint_input("today", &ctx, serde_json::json!({}))).unwrap();
        db.lock().unwrap().execute("UPDATE service_runs SET updated_at = '2020-01-01T00:00:00.000Z' WHERE run_id = 'old'", []).unwrap();
        assert_eq!(db.current_service_run(12).unwrap().map(|r| r.run_id), Some("today".into()));
        db.interrupt_service_run("today").unwrap();
        assert_eq!(db.current_service_run(12).unwrap(), None, "a stale active run is not the current service");
    }

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
    fn service_runs_keep_context_checkpoint_recovery_and_finalize_once() {
        let db = ContentDb::open_in_memory().unwrap();
        let program = db.create_program("Sunday Service", Some("2026-11-01")).unwrap();
        let other = db.create_program("Midweek", None).unwrap();
        let context = TestRunContext {
            program_id: Some(program.id.clone()),
            program_revision: Some(program.revision),
            service_date: program.service_date.clone(),
            title: "Sunday Service".into(),
            time_zone: Some("Africa/Lagos".into()),
            started_at: "2026-11-01T08:00:00Z".into(),
        };
        let first_checkpoint = serde_json::json!({ "entries": [{ "event": "started", "at": "2026-11-01T08:00:00Z" }] });
        let input = checkpoint_input("run-1", &context, first_checkpoint.clone());
        let started = db.checkpoint_service_run(&input).unwrap();
        assert_eq!(started.status, "active");
        assert_eq!(started.program_id.as_deref(), Some(program.id.as_str()));
        assert_eq!(started.program_revision, Some(program.revision));
        assert_eq!(started.service_date.as_deref(), Some("2026-11-01"));
        assert_eq!(started.time_zone.as_deref(), Some("Africa/Lagos"));
        assert_eq!(started.checkpoint, first_checkpoint);

        let second_checkpoint = serde_json::json!({ "entries": [{ "event": "started" }, { "event": "scripture", "reference": "John 3:16" }] });
        let second_input = checkpoint_input("run-1", &context, second_checkpoint.clone());
        let updated = db.checkpoint_service_run(&second_input).unwrap();
        assert_eq!(updated.run_id, started.run_id, "checkpoint retry/upsert keeps the stable run ID");
        assert_eq!(updated.checkpoint, second_checkpoint);
        assert!(matches!(
            db.checkpoint_service_run(&ServiceRunCheckpoint { title: "Renamed service".into(), ..second_input.clone() }),
            Err(ContentError::Invalid(message)) if message.contains("context cannot change")
        ));
        assert!(matches!(
            db.checkpoint_service_run(&ServiceRunCheckpoint { service_date: Some("2026-11-08".into()), ..second_input.clone() }),
            Err(ContentError::Invalid(message)) if message.contains("context cannot change")
        ));
        assert_eq!(db.list_service_runs(Some(&program.id), 10).unwrap().len(), 1);
        assert_eq!(
            db.list_service_runs(Some(&other.id), 10).unwrap(),
            Vec::<ServiceRunSummary>::new()
        );

        let interrupted = db.interrupt_service_run("run-1").unwrap();
        assert_eq!(interrupted.status, "interrupted");
        assert_eq!(db.interrupt_service_run("run-1").unwrap().status, "interrupted", "repeated recovery marking is safe");
        assert_eq!(db.list_service_runs(Some(&program.id), 10).unwrap()[0].status, "interrupted", "interrupted runs remain visible in History");
        assert_eq!(db.get_service_run("run-1").unwrap().unwrap().checkpoint, second_input.checkpoint, "opening a run restores its captured checkpoint without resuming it");
        let resumed_checkpoint = serde_json::json!({ "entries": [{ "event": "started" }, { "event": "resumed", "gap": "unknown" }] });
        let resumed_input = checkpoint_input("run-1", &context, resumed_checkpoint);
        assert_eq!(db.checkpoint_service_run(&resumed_input).unwrap().status, "active");

        let manual = db.save_service_log(Some(&other.id), "Manual", "17:00 note", None).unwrap();
        assert_eq!(manual.run_id, None, "manual logs remain unassociated");
        let finished = db.finalize_service_run("run-1", "08:00 Started\n08:30 John 3:16", "2026-11-01T10:00:00Z", None).unwrap();
        assert_eq!(finished.program_id.as_deref(), Some(program.id.as_str()), "program ID comes from the immutable captured context");
        assert_eq!(finished.title, "Sunday Service", "title comes from the captured context");
        assert_eq!(finished.run_id.as_deref(), Some("run-1"));
        assert_eq!(finished.finished_at.as_deref(), Some("2026-11-01T10:00:00Z"));
        assert_eq!(finished.time_zone.as_deref(), Some("Africa/Lagos"));
        assert_eq!(db.get_service_run("run-1").unwrap().unwrap().status, "finished");
        assert_eq!(db.get_service_log(&finished.id).unwrap().unwrap().body, "08:00 Started\n08:30 John 3:16");
        let transcript: Option<String> = db.lock().unwrap().query_row("SELECT transcript FROM service_logs WHERE id = ?1", params![finished.id], |row| row.get(0)).unwrap();
        assert_eq!(transcript, None, "a transcript is never added without explicit opt-in");
        assert_eq!(db.list_service_logs_for_program(None, Some(&program.id), 10).unwrap().len(), 1);

        let run_audits_before_retry = db.audit_events("service_run", "run-1").unwrap().len();
        let retry = db.finalize_service_run("run-1", "changed body must not overwrite the saved record", "2026-11-01T10:01:00Z", Some("unrequested transcript" )).unwrap();
        assert_eq!(retry.id, finished.id, "retry returns the same row");
        assert_eq!(db.get_service_log(&finished.id).unwrap().unwrap().body, "08:00 Started\n08:30 John 3:16", "retry never replaces final content");
        assert_eq!(db.audit_events("service_log", &finished.id).unwrap().len(), 1, "finalization audit runs once");
        assert_eq!(db.audit_events("service_run", "run-1").unwrap().len(), run_audits_before_retry, "retry does not duplicate run audit entries");
        assert!(matches!(db.checkpoint_service_run(&second_input), Err(ContentError::Invalid(_))));
        assert!(matches!(db.interrupt_service_run("run-1"), Err(ContentError::Invalid(_))));
        db.delete_service_log(&finished.id).unwrap();
        assert!(db.get_service_log(&finished.id).unwrap().is_none());
        assert!(db.get_service_run("run-1").unwrap().is_none(), "deleting a run's log removes its checkpoint too");
        assert_eq!(db.audit_events("service_run", "run-1").unwrap().last().unwrap().action, "delete");
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
        let legacy_summary = db.get_service_log(&plain).unwrap().unwrap().summary;
        assert_eq!(legacy_summary.run_id, None, "legacy/manual logs acquire no invented run ID");
        assert_eq!(legacy_summary.finished_at, None);
        assert_eq!(legacy_summary.time_zone, None);
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
