#![expect(clippy::needless_pass_by_value, reason = "Tauri command extractors require pass-by-value")]

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

use rhema_content::{
    ContentDb, ContentError, Hymnbook, HymnbookInput, ImportMode, ImportReport, ItemInput, Program, ProgramWithItems,
    Revision, RevisionSummary, SongExport, SongInput, SongSummary, SongWithSections, SongUsage, ServiceLog, ServiceLogSummary, MediaAsset,
};

/// The content database is opened in `setup`; `None` means it failed to open
/// and every command reports that instead of crashing the app. Live
/// presentation never depends on it.
pub struct ContentState(pub Mutex<Option<ContentDb>>);

/// Structured error so the frontend can tell a revision conflict from a
/// validation problem or an unavailable database.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ContentCommandError {
    Unavailable { message: String },
    NotFound { message: String },
    Invalid { message: String },
    Conflict { message: String, expected: i64, actual: i64 },
    /// A song a saved service still uses; `titles` names the services.
    InUse { message: String, titles: Vec<String> },
    Database { message: String },
}

impl From<ContentError> for ContentCommandError {
    fn from(e: ContentError) -> Self {
        let message = e.to_string();
        match e {
            ContentError::NotFound(_) => Self::NotFound { message },
            ContentError::Invalid(_) => Self::Invalid { message },
            ContentError::Conflict { expected, actual } => Self::Conflict { message, expected, actual },
            ContentError::InUse { titles } => Self::InUse { message, titles },
            _ => Self::Database { message },
        }
    }
}

type CmdResult<T> = Result<T, ContentCommandError>;

fn with_db<T>(
    state: &State<'_, ContentState>,
    f: impl FnOnce(&ContentDb) -> rhema_content::Result<T>,
) -> CmdResult<T> {
    let guard = state.0.lock().map_err(|e| ContentCommandError::Unavailable { message: e.to_string() })?;
    let db = guard.as_ref().ok_or_else(|| ContentCommandError::Unavailable {
        message: "Content database is not available".to_string(),
    })?;
    f(db).map_err(Into::into)
}

#[tauri::command]
pub fn content_list_programs(state: State<'_, ContentState>) -> CmdResult<Vec<Program>> {
    with_db(&state, ContentDb::list_programs)
}

#[tauri::command]
pub fn content_create_program(
    state: State<'_, ContentState>,
    title: String,
    service_date: Option<String>,
) -> CmdResult<Program> {
    with_db(&state, |db| db.create_program(&title, service_date.as_deref()))
}

#[tauri::command]
pub fn content_save_service_log(state: State<'_, ContentState>, program_id: Option<String>, title: String, body: String, transcript: Option<String>) -> CmdResult<ServiceLogSummary> {
    with_db(&state, |db| db.save_service_log(program_id.as_deref(), &title, &body, transcript.as_deref()))
}

/// Song usage between two ISO dates, for licence (CCLI) reports.
#[tauri::command]
pub fn content_song_usage(state: State<'_, ContentState>, from: String, to: String) -> CmdResult<Vec<SongUsage>> {
    with_db(&state, |db| db.song_usage(&from, &to))
}

#[tauri::command]
pub fn content_list_service_logs(state: State<'_, ContentState>, query: Option<String>, limit: Option<usize>) -> CmdResult<Vec<ServiceLogSummary>> {
    with_db(&state, |db| db.list_service_logs(query.as_deref(), limit.unwrap_or(100)))
}

#[tauri::command]
pub fn content_get_service_log(state: State<'_, ContentState>, id: String) -> CmdResult<Option<ServiceLog>> {
    with_db(&state, |db| db.get_service_log(&id))
}

/// Remove the transcripts of kept logs older than `days` days (the church's retention; 0 keeps them).
#[tauri::command]
pub fn content_remove_old_log_transcripts(state: State<'_, ContentState>, days: u32) -> CmdResult<usize> {
    with_db(&state, |db| db.remove_old_log_transcripts(days))
}

#[tauri::command]
pub fn content_delete_service_log(state: State<'_, ContentState>, id: String) -> CmdResult<()> {
    with_db(&state, |db| db.delete_service_log(&id))
}

#[tauri::command]
pub fn content_list_song_attachments(state: State<'_, ContentState>, song_id: String) -> CmdResult<Vec<MediaAsset>> {
    with_db(&state, |db| db.list_song_attachments(&song_id))
}

#[tauri::command]
pub fn content_add_song_attachment(state: State<'_, ContentState>, song_id: String, media_id: String) -> CmdResult<Vec<MediaAsset>> {
    with_db(&state, |db| db.add_song_attachment(&song_id, &media_id))
}

#[tauri::command]
pub fn content_remove_song_attachment(state: State<'_, ContentState>, song_id: String, media_id: String) -> CmdResult<Vec<MediaAsset>> {
    with_db(&state, |db| db.remove_song_attachment(&song_id, &media_id))
}

/// The operator's name for audit rows (Settings → your name). Empty clears it.
#[tauri::command]
pub fn content_set_actor(name: Option<String>) {
    rhema_content::set_actor(name.as_deref());
}

/// Mark the saved service as the one for the day; its snapshot is then kept.
#[tauri::command]
pub fn content_approve_program(state: State<'_, ContentState>, id: String, expected_revision: i64) -> CmdResult<Program> {
    with_db(&state, |db| db.approve_program(&id, expected_revision))
}

/// The words of each song as the service was approved (#193), for Present to keep showing them.
#[tauri::command]
pub fn content_approved_songs(state: State<'_, ContentState>, program_id: String) -> CmdResult<Vec<rhema_content::SongWithSections>> {
    with_db(&state, |db| db.approved_songs(&program_id))
}

#[tauri::command]
pub fn content_update_program(
    state: State<'_, ContentState>,
    id: String,
    expected_revision: i64,
    title: String,
    service_date: Option<String>,
) -> CmdResult<Program> {
    with_db(&state, |db| db.update_program(&id, expected_revision, &title, service_date.as_deref()))
}

/// Archive (hide from the picker, keep) or bring back a service.
#[tauri::command]
pub fn content_set_program_archived(state: State<'_, ContentState>, id: String, archived: bool) -> CmdResult<Program> {
    with_db(&state, |db| db.set_program_archived(&id, archived))
}

/// Mark a service as a template for new services, or not.
#[tauri::command]
pub fn content_set_program_template(state: State<'_, ContentState>, id: String, template: bool) -> CmdResult<Program> {
    with_db(&state, |db| db.set_program_template(&id, template))
}

#[tauri::command]
pub fn content_get_program(state: State<'_, ContentState>, id: String) -> CmdResult<Option<ProgramWithItems>> {
    with_db(&state, |db| db.get_program(&id))
}

#[tauri::command]
pub fn content_replace_items(
    state: State<'_, ContentState>,
    program_id: String,
    expected_revision: i64,
    items: Vec<ItemInput>,
) -> CmdResult<ProgramWithItems> {
    with_db(&state, |db| db.replace_items(&program_id, expected_revision, &items))
}

#[tauri::command]
pub fn content_delete_program(state: State<'_, ContentState>, id: String, expected_revision: i64) -> CmdResult<()> {
    with_db(&state, |db| db.delete_program(&id, expected_revision))
}

// ── service history ────────────────────────────────────────────────────

#[tauri::command]
pub fn content_list_revisions(state: State<'_, ContentState>, program_id: String) -> CmdResult<Vec<RevisionSummary>> {
    with_db(&state, |db| db.list_revisions(&program_id))
}

#[tauri::command]
pub fn content_get_revision(state: State<'_, ContentState>, id: String) -> CmdResult<Option<Revision>> {
    with_db(&state, |db| db.get_revision(&id))
}

#[tauri::command]
pub fn content_restore_revision(
    state: State<'_, ContentState>,
    program_id: String,
    expected_revision: i64,
    revision_id: String,
) -> CmdResult<ProgramWithItems> {
    with_db(&state, |db| db.restore_revision(&program_id, expected_revision, &revision_id))
}

// ── songs and hymnbooks ────────────────────────────────────────────────

#[tauri::command]
pub fn content_list_songs(state: State<'_, ContentState>, query: Option<String>, limit: Option<usize>, tag: Option<String>, with_tag: Option<bool>) -> CmdResult<Vec<SongSummary>> {
    let tag = tag.as_deref().map(|t| (t, with_tag.unwrap_or(true)));
    with_db(&state, |db| db.list_songs_tagged(query.as_deref(), limit.unwrap_or(200).min(5000), tag))
}

#[tauri::command]
pub fn content_get_song(state: State<'_, ContentState>, id: String) -> CmdResult<Option<SongWithSections>> {
    with_db(&state, |db| db.get_song(&id))
}

#[tauri::command]
pub fn content_create_song(state: State<'_, ContentState>, input: SongInput) -> CmdResult<SongWithSections> {
    with_db(&state, |db| db.create_song(&input))
}

#[tauri::command]
pub fn content_update_song(
    state: State<'_, ContentState>,
    id: String,
    expected_revision: i64,
    input: SongInput,
) -> CmdResult<SongWithSections> {
    with_db(&state, |db| db.update_song(&id, expected_revision, &input))
}

#[tauri::command]
pub fn content_delete_song(state: State<'_, ContentState>, id: String, expected_revision: i64) -> CmdResult<()> {
    with_db(&state, |db| db.delete_song(&id, expected_revision))
}

#[tauri::command]
pub fn content_list_hymnbooks(state: State<'_, ContentState>) -> CmdResult<Vec<Hymnbook>> {
    with_db(&state, ContentDb::list_hymnbooks)
}

#[tauri::command]
pub fn content_upsert_hymnbook(state: State<'_, ContentState>, input: HymnbookInput) -> CmdResult<Hymnbook> {
    with_db(&state, |db| db.upsert_hymnbook(&input))
}

#[tauri::command]
pub fn content_delete_hymnbook(state: State<'_, ContentState>, id: String) -> CmdResult<()> {
    with_db(&state, |db| db.delete_hymnbook(&id))
}

#[tauri::command]
pub fn content_export_songs(state: State<'_, ContentState>, ids: Option<Vec<String>>) -> CmdResult<SongExport> {
    with_db(&state, |db| db.export_songs(ids.as_deref()))
}

#[tauri::command]
pub fn content_import_songs(state: State<'_, ContentState>, export: SongExport, mode: ImportMode) -> CmdResult<ImportReport> {
    with_db(&state, |db| db.import_songs(&export, mode))
}

/// A whole hymnbook (the CAC Gospel Hymn Book): hymns matched by their number in the book.
#[tauri::command]
pub fn content_import_hymnbook(state: State<'_, ContentState>, parts: Vec<rhema_content::HymnbookImport>) -> CmdResult<ImportReport> {
    with_db(&state, |db| db.import_hymnbooks(&parts))
}

/// A fresh file name in the system temp folder (local disk).
fn local_temp(label: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
    std::env::temp_dir().join(format!("rhema-{label}-{}-{nanos}.db", std::process::id()))
}

fn copy_error(what: &str, e: &std::io::Error) -> ContentCommandError {
    ContentCommandError::Database { message: format!("{what}: {e}") }
}

/// Copy the live database to `path` (SQLite online backup; safe while open).
///
/// QA-002/NFR-01: the backup is written to local disk while the database
/// lock is held (fast), and only then copied to the chosen place with the
/// lock released, off the main thread. A USB stick or network drive that
/// stalls or disappears can then neither freeze the windows (outputs
/// included) nor hold up saving. The copy lands as `<path>.part` first and
/// is renamed when complete, so a dropped drive never leaves a file that
/// looks like a whole backup.
///
/// `installation`: this computer's settings and looks (#298 E6, JSON from the app with no
/// secrets), kept inside the same file so one backup brings back the whole installation.
#[tauri::command(async)]
pub fn content_backup(state: State<'_, ContentState>, path: String, installation: Option<String>) -> CmdResult<()> {
    let local = local_temp("backup");
    let result = with_db(&state, |db| db.backup_to(&local))
        .and_then(|()| match installation.as_deref() {
            Some(json) => rhema_content::write_installation(&local, json).map_err(ContentCommandError::from),
            None => Ok(()),
        })
        .and_then(|()| copy_into_place(&local, &path).map_err(|e| copy_error("Could not write the backup there", &e)));
    let _ = std::fs::remove_file(&local);
    result
}

/// Copy `from` to `<to>.part`, flush it to the device, then rename it to
/// `to`; on failure no `.part` is left behind. The flush comes before the
/// rename so a write-cached USB stick pulled out cannot end up with a
/// truncated file under the finished name.
fn copy_into_place(from: &Path, to: &str) -> std::io::Result<()> {
    let part = PathBuf::from(format!("{to}.part"));
    let write = || -> std::io::Result<()> {
        let mut src = std::fs::File::open(from)?;
        let mut dst = std::fs::File::create(&part)?;
        std::io::copy(&mut src, &mut dst)?;
        dst.sync_all()?;
        drop(dst);
        std::fs::rename(&part, to)
    };
    write().inspect_err(|_| {
        let _ = std::fs::remove_file(&part);
    })
}

#[cfg(test)]
mod backup_copy_tests {
    use super::copy_into_place;

    #[test]
    fn whole_file_or_nothing() {
        let dir = std::env::temp_dir().join(format!("rhema-copy-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let from = dir.join("local.db");
        std::fs::write(&from, b"backup bytes").unwrap();
        let to = dir.join("usb.db");
        copy_into_place(&from, to.to_str().unwrap()).unwrap();
        assert_eq!(std::fs::read(&to).unwrap(), b"backup bytes");
        assert!(!dir.join("usb.db.part").exists());
        // A drive that is gone: an error, and nothing half-written left behind.
        let gone = dir.join("missing-drive").join("usb.db");
        assert!(copy_into_place(&from, gone.to_str().unwrap()).is_err());
        assert!(!dir.join("missing-drive").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

#[derive(Debug, Serialize)]
pub struct RestoreReport {
    /// Where the pre-restore database was kept (with this computer's settings and looks, when the
    /// app sent them, so restoring the snapshot undoes the restore).
    pub snapshot: Option<String>,
    pub migrations: Vec<String>,
    /// The backup's settings and looks (JSON) for the app to put in place; `None` when it has none.
    pub installation: Option<String>,
}

/// What a backup file would bring in (services, songs, the newest service), read from a local
/// copy so a USB stick or NAS is touched once (off the main thread). Nothing on this computer changes.
#[tauri::command(async)]
pub fn content_inspect_backup(path: String) -> CmdResult<rhema_content::BackupSummary> {
    let local = local_temp("inspect");
    std::fs::copy(&path, &local).map_err(|e| {
        let _ = std::fs::remove_file(&local);
        copy_error("Could not read the backup", &e)
    })?;
    let summary = rhema_content::inspect_backup(&local).map_err(ContentCommandError::from);
    let _ = std::fs::remove_file(&local);
    summary
}

/// Replace the live database with a verified backup. The current file is
/// snapshotted first; on any failure the previous database is reopened.
///
/// The backup is first copied to local disk without the lock (it may be on a
/// slow or failing drive), off the main thread; the restore itself then
/// reads only the local copy.
///
/// `current`: this computer's settings and looks as they are now (JSON, no secrets), kept in the
/// snapshot with the services and songs, so the whole restore can be undone from that one file.
#[tauri::command(async)]
pub fn content_restore(state: State<'_, ContentState>, path: String, current: Option<String>) -> CmdResult<RestoreReport> {
    let local = local_temp("restore");
    std::fs::copy(&path, &local).map_err(|e| {
        let _ = std::fs::remove_file(&local);
        copy_error("Could not read the backup", &e)
    })?;
    let installation = rhema_content::read_installation(&local).ok().flatten();
    let report = restore_local(&state, &local).map(|mut r| {
        if let (Some(snapshot), Some(json)) = (r.snapshot.as_deref(), current.as_deref()) {
            if let Err(e) = rhema_content::write_installation(Path::new(snapshot), json) {
                log::warn!("content_restore: the settings and looks were not kept in the snapshot: {e}");
            }
        }
        r.installation = installation;
        r
    });
    let _ = std::fs::remove_file(&local);
    report
}

fn restore_local(state: &State<'_, ContentState>, path: &Path) -> CmdResult<RestoreReport> {
    let mut guard = state.0.lock().map_err(|e| ContentCommandError::Unavailable { message: e.to_string() })?;
    let current: PathBuf = guard
        .as_ref()
        .and_then(|db| db.path().map(Path::to_path_buf))
        .ok_or_else(|| ContentCommandError::Unavailable { message: "Content database is not available".to_string() })?;
    // Close the only handle so the file can be replaced.
    *guard = None;
    match rhema_content::restore_from(&current, path) {
        Ok((db, snapshot)) => {
            let migrations = db.applied_migrations().unwrap_or_default();
            *guard = Some(db);
            Ok(RestoreReport { snapshot: snapshot.map(|p| p.display().to_string()), migrations, installation: None })
        }
        Err(e) => {
            match ContentDb::open(&current) {
                Ok(db) => *guard = Some(db),
                Err(reopen) => log::error!("content database could not be reopened after a failed restore: {reopen}"),
            }
            Err(e.into())
        }
    }
}

/// Where the database lives and whether it is open: for Diagnostics.
#[derive(Debug, Serialize)]
pub struct ContentStatus {
    pub available: bool,
    pub path: Option<String>,
    pub migrations: Vec<String>,
    /// Automatic copy made before the last migration, if any.
    pub last_backup: Option<String>,
    /// Why the database could not be opened, in words for the operator.
    pub error: Option<String>,
}

/// The reason the content database failed to open at start-up, if it did.
pub struct ContentOpenError(pub Mutex<Option<String>>);

#[tauri::command]
pub fn content_status(state: State<'_, ContentState>, open_error: State<'_, ContentOpenError>) -> Result<ContentStatus, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    Ok(match guard.as_ref() {
        Some(db) => ContentStatus {
            available: true,
            path: db.path().map(|p| p.display().to_string()),
            migrations: db.applied_migrations().unwrap_or_default(),
            last_backup: db.last_backup().map(|p| p.display().to_string()),
            error: None,
        },
        None => ContentStatus {
            available: false,
            path: None,
            migrations: vec![],
            last_backup: None,
            error: open_error.0.lock().ok().and_then(|e| e.clone()),
        },
    })
}
