//! Songs, hymnbooks and the lyric search index (migration 0003).
//!
//! Same rules as programs: every write is one transaction with an audit row,
//! updates take the caller's expected revision, section and arrangement ids
//! are stable across saves, and the full-text index is rebuilt for the song
//! on every write so it can never drift from the rows.

use std::collections::{BTreeMap, HashSet};

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::{audit, is_valid_id, new_id, ContentDb, ContentError, Result};

pub const SECTION_KINDS: &[&str] = &["verse", "chorus", "bridge", "prechorus", "tag", "ending", "intro", "other"];
pub const LICENCES: &[&str] = &["public_domain", "ccli", "custom", "unknown"];
pub const MAX_SECTIONS: usize = 60;
pub const MAX_SECTION_BODY: usize = 4000;
pub const MAX_ARRANGEMENT_STEPS: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Song {
    pub id: String,
    pub title: String,
    pub authors: String,
    pub copyright: String,
    pub ccli_number: Option<String>,
    pub licence: String,
    pub licence_note: String,
    pub primary_language: String,
    pub tags: String,
    pub notes: String,
    /// Musical key, e.g. "G", "Bb", "F#m". Free text, for the band.
    pub key: String,
    /// Beats per minute, for the band.
    pub tempo: Option<i64>,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SongSection {
    pub id: String,
    pub kind: String,
    pub label: String,
    /// language tag → lyrics
    pub texts: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Arrangement {
    pub id: String,
    pub name: String,
    pub sequence: Vec<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HymnNumber {
    pub hymnbook_id: String,
    pub hymnbook_code: String,
    pub number: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SongWithSections {
    pub song: Song,
    pub sections: Vec<SongSection>,
    pub arrangements: Vec<Arrangement>,
    pub numbers: Vec<HymnNumber>,
}

/// What a list or search shows: enough to pick a song without loading it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SongSummary {
    pub id: String,
    pub title: String,
    pub authors: String,
    pub licence: String,
    pub primary_language: String,
    pub languages: Vec<String>,
    /// "SSS 245", "YBH 12a"
    pub numbers: Vec<String>,
    pub first_line: String,
    pub revision: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Hymnbook {
    pub id: String,
    pub code: String,
    pub name: String,
    pub language: String,
    pub publisher: String,
    pub licence_note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct SectionInput {
    #[serde(default)]
    pub id: Option<String>,
    pub kind: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub texts: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ArrangementInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub sequence: Vec<String>,
    #[serde(default)]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HymnNumberInput {
    pub hymnbook_id: String,
    pub number: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SongInput {
    pub title: String,
    #[serde(default)]
    pub authors: String,
    #[serde(default)]
    pub copyright: String,
    #[serde(default)]
    pub ccli_number: Option<String>,
    #[serde(default = "default_licence")]
    pub licence: String,
    #[serde(default)]
    pub licence_note: String,
    #[serde(default = "default_language")]
    pub primary_language: String,
    #[serde(default)]
    pub tags: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub tempo: Option<i64>,
    pub sections: Vec<SectionInput>,
    /// Empty = keep a generated "Default" arrangement (authoring order, chorus
    /// after each verse when there is exactly one chorus).
    #[serde(default)]
    pub arrangements: Vec<ArrangementInput>,
    #[serde(default)]
    pub numbers: Vec<HymnNumberInput>,
}

fn default_licence() -> String {
    "unknown".into()
}
fn default_language() -> String {
    "en".into()
}

impl Default for SongInput {
    fn default() -> Self {
        Self {
            title: String::new(),
            authors: String::new(),
            copyright: String::new(),
            ccli_number: None,
            licence: default_licence(),
            licence_note: String::new(),
            primary_language: default_language(),
            tags: String::new(),
            notes: String::new(),
            key: String::new(),
            tempo: None,
            sections: vec![],
            arrangements: vec![],
            numbers: vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HymnbookInput {
    #[serde(default)]
    pub id: Option<String>,
    pub code: String,
    pub name: String,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub publisher: String,
    #[serde(default)]
    pub licence_note: String,
}

/// `rhema-songs-v1.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SongExport {
    pub version: u32,
    pub hymnbooks: Vec<Hymnbook>,
    pub songs: Vec<SongWithSections>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ImportMode {
    /// Keep the existing song when the id is already present.
    Skip,
    /// Overwrite the existing song's content, keeping its id.
    Replace,
    /// Always create a new song with fresh ids.
    Duplicate,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportReport {
    pub added: usize,
    pub replaced: usize,
    pub skipped: usize,
    pub hymnbooks_added: usize,
    /// Hymn numbers left off because another song here already has them.
    #[serde(default)]
    pub numbers_skipped: usize,
}

/// Payload of a `kind = 'song'` program item.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SongItemPayload {
    pub song_id: String,
    #[serde(default)]
    pub arrangement_id: Option<String>,
    #[serde(default)]
    pub languages: Vec<String>,
}

impl ContentDb {
    // ── songs ────────────────────────────────────────────────────────────

    /// All songs by title, or the search results for `query`.
    pub fn list_songs(&self, query: Option<&str>, limit: usize) -> Result<Vec<SongSummary>> {
        let conn = self.lock()?;
        let ids = if let Some(q) = query.map(str::trim).filter(|q| !q.is_empty()) {
            search_ids(&conn, q, limit)?
        } else {
            let mut stmt = conn.prepare("SELECT id FROM songs ORDER BY title_sort LIMIT ?1")?;
            let rows = stmt.query_map(params![to_i64(limit)?], |r| r.get::<_, String>(0))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        ids.iter().map(|id| load_summary(&conn, id)).collect()
    }

    pub fn get_song(&self, id: &str) -> Result<Option<SongWithSections>> {
        let conn = self.lock()?;
        load_song(&conn, id)
    }

    pub fn create_song(&self, input: &SongInput) -> Result<SongWithSections> {
        validate_song(input)?;
        let id = new_id();
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        insert_song_row(&tx, &id, input)?;
        write_song_children(&tx, &id, input, &HashSet::new())?;
        reindex(&tx, &id)?;
        audit(&tx, "song", &id, "create", &serde_json::json!({ "title": input.title.trim() }))?;
        let song = load_song(&tx, &id)?.ok_or_else(|| ContentError::NotFound(id.clone()))?;
        tx.commit()?;
        Ok(song)
    }

    /// Sections and arrangements keep their ids when the input names them.
    pub fn update_song(&self, id: &str, expected_revision: i64, input: &SongInput) -> Result<SongWithSections> {
        validate_song(input)?;
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        check_song_revision(&tx, id, expected_revision)?;
        update_song_row(&tx, id, input)?;
        let existing = existing_child_ids(&tx, id)?;
        write_song_children(&tx, id, input, &existing)?;
        reindex(&tx, id)?;
        audit(&tx, "song", id, "update", &serde_json::json!({ "title": input.title.trim() }))?;
        let song = load_song(&tx, id)?.ok_or_else(|| ContentError::NotFound(id.to_string()))?;
        tx.commit()?;
        Ok(song)
    }

    /// Refused while any saved service uses the song; the error names them.
    pub fn delete_song(&self, id: &str, expected_revision: i64) -> Result<()> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        check_song_revision(&tx, id, expected_revision)?;
        let used_in = services_using(&tx, id)?;
        if !used_in.is_empty() {
            return Err(ContentError::InUse { titles: used_in });
        }
        tx.execute("DELETE FROM songs WHERE id = ?1", params![id])?;
        tx.execute("DELETE FROM song_search WHERE song_id = ?1", params![id])?;
        audit(&tx, "song", id, "delete", &serde_json::Value::Null)?;
        tx.commit()?;
        Ok(())
    }

    // ── hymnbooks ────────────────────────────────────────────────────────

    pub fn list_hymnbooks(&self) -> Result<Vec<Hymnbook>> {
        let conn = self.lock()?;
        load_hymnbooks(&conn)
    }

    /// Create, or update the book with the given id. Codes are unique.
    pub fn upsert_hymnbook(&self, input: &HymnbookInput) -> Result<Hymnbook> {
        validate_hymnbook(input)?;
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let id = upsert_hymnbook_tx(&tx, input)?;
        // Numbers are indexed with their book code, so a code change reindexes.
        let song_ids: Vec<String> = {
            let mut stmt = tx.prepare("SELECT DISTINCT song_id FROM hymn_numbers WHERE hymnbook_id = ?1")?;
            let rows = stmt.query_map(params![id], |r| r.get(0))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        for song_id in &song_ids {
            reindex(&tx, song_id)?;
        }
        let book = load_hymnbooks(&tx)?
            .into_iter()
            .find(|b| b.id == id)
            .ok_or_else(|| ContentError::NotFound(id.clone()))?;
        tx.commit()?;
        Ok(book)
    }

    /// Removes the book and its numbers; songs stay.
    pub fn delete_hymnbook(&self, id: &str) -> Result<()> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let song_ids: Vec<String> = {
            let mut stmt = tx.prepare("SELECT DISTINCT song_id FROM hymn_numbers WHERE hymnbook_id = ?1")?;
            let rows = stmt.query_map(params![id], |r| r.get(0))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        let n = tx.execute("DELETE FROM hymnbooks WHERE id = ?1", params![id])?;
        if n == 0 {
            return Err(ContentError::NotFound(id.to_string()));
        }
        for song_id in &song_ids {
            reindex(&tx, song_id)?;
        }
        audit(&tx, "hymnbook", id, "delete", &serde_json::Value::Null)?;
        tx.commit()?;
        Ok(())
    }

    // ── import / export ──────────────────────────────────────────────────

    /// Everything, or only `ids`. Hymnbooks are always included so numbers resolve.
    pub fn export_songs(&self, ids: Option<&[String]>) -> Result<SongExport> {
        let conn = self.lock()?;
        let all: Vec<String> = {
            let mut stmt = conn.prepare("SELECT id FROM songs ORDER BY title_sort")?;
            let rows = stmt.query_map([], |r| r.get(0))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        let wanted: Vec<String> = match ids {
            Some(ids) => all.into_iter().filter(|id| ids.contains(id)).collect(),
            None => all,
        };
        let mut songs = Vec::with_capacity(wanted.len());
        for id in &wanted {
            if let Some(s) = load_song(&conn, id)? {
                songs.push(s);
            }
        }
        Ok(SongExport { version: 1, hymnbooks: load_hymnbooks(&conn)?, songs })
    }

    /// One transaction: any invalid song aborts the whole import.
    pub fn import_songs(&self, export: &SongExport, mode: ImportMode) -> Result<ImportReport> {
        if export.version != 1 {
            return Err(ContentError::Invalid(format!("unsupported export version {}", export.version)));
        }
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let mut report = ImportReport::default();

        // Hymnbooks match by code; a book's id in the file maps to the local id.
        let mut book_ids: BTreeMap<String, String> = BTreeMap::new();
        let local_books = load_hymnbooks(&tx)?;
        for book in &export.hymnbooks {
            let local = local_books.iter().find(|b| b.code.eq_ignore_ascii_case(&book.code));
            let id = if let Some(b) = local {
                b.id.clone()
            } else {
                let input = HymnbookInput {
                    id: None,
                    code: book.code.clone(),
                    name: book.name.clone(),
                    language: book.language.clone(),
                    publisher: book.publisher.clone(),
                    licence_note: book.licence_note.clone(),
                };
                validate_hymnbook(&input)?;
                report.hymnbooks_added += 1;
                upsert_hymnbook_tx(&tx, &input)?
            };
            book_ids.insert(book.id.clone(), id);
        }

        for (i, s) in export.songs.iter().enumerate() {
            let input = to_input(s, &book_ids);
            validate_song(&input).map_err(|e| ContentError::Invalid(format!("song {i} ({}): {e}", s.song.title)))?;
            let exists = is_valid_id(&s.song.id)
                && tx
                    .query_row("SELECT 1 FROM songs WHERE id = ?1", params![s.song.id], |_| Ok(()))
                    .optional()?
                    .is_some();
            match (mode, exists) {
                (ImportMode::Skip, true) => report.skipped += 1,
                (ImportMode::Replace, true) => {
                    let mut input = input.clone();
                    let before = input.numbers.len();
                    input.numbers.retain(|n| number_holder(&tx, &n.hymnbook_id, &n.number).ok().flatten().is_none_or(|(holder, _)| holder == s.song.id));
                    report.numbers_skipped += before - input.numbers.len();
                    update_song_row(&tx, &s.song.id, &input)?;
                    let existing = existing_child_ids(&tx, &s.song.id)?;
                    write_song_children(&tx, &s.song.id, &input, &existing)?;
                    reindex(&tx, &s.song.id)?;
                    audit(&tx, "song", &s.song.id, "import_replace", &serde_json::json!({ "title": input.title }))?;
                    report.replaced += 1;
                }
                (ImportMode::Duplicate, _) | (_, false) => {
                    let id = if mode == ImportMode::Duplicate || !is_valid_id(&s.song.id) { new_id() } else { s.song.id.clone() };
                    // Fresh child ids (the file's may collide with local rows);
                    // arrangements refer to sections by index instead.
                    // A new song cannot take a hymn number another song here holds
                    // (the same hymn entered on two computers has two ids): left off and counted.
                    let mut numbers = input.numbers.clone();
                    numbers.retain(|n| number_holder(&tx, &n.hymnbook_id, &n.number).ok().flatten().is_none());
                    report.numbers_skipped += input.numbers.len() - numbers.len();
                    let fresh = SongInput {
                        sections: input.sections.iter().map(|x| SectionInput { id: None, ..x.clone() }).collect(),
                        arrangements: remap_arrangements(&input),
                        numbers,
                        ..input.clone()
                    };
                    insert_song_row(&tx, &id, &fresh)?;
                    write_song_children(&tx, &id, &fresh, &HashSet::new())?;
                    reindex(&tx, &id)?;
                    audit(&tx, "song", &id, "import", &serde_json::json!({ "title": fresh.title }))?;
                    report.added += 1;
                }
            }
        }
        tx.commit()?;
        Ok(report)
    }
}

/// Section ids in an arrangement refer to the input's sections by position when
/// the sections get fresh ids: encode as `#<index>` so `write_song_children`
/// can resolve them after insert.
fn remap_arrangements(input: &SongInput) -> Vec<ArrangementInput> {
    input
        .arrangements
        .iter()
        .map(|a| ArrangementInput {
            id: None,
            name: a.name.clone(),
            is_default: a.is_default,
            sequence: a
                .sequence
                .iter()
                .map(|sid| match input.sections.iter().position(|s| s.id.as_deref() == Some(sid)) {
                    Some(i) => format!("#{i}"),
                    None => sid.clone(),
                })
                .collect(),
        })
        .collect()
}

fn to_input(s: &SongWithSections, book_ids: &BTreeMap<String, String>) -> SongInput {
    SongInput {
        title: s.song.title.clone(),
        authors: s.song.authors.clone(),
        copyright: s.song.copyright.clone(),
        ccli_number: s.song.ccli_number.clone(),
        licence: s.song.licence.clone(),
        licence_note: s.song.licence_note.clone(),
        primary_language: s.song.primary_language.clone(),
        tags: s.song.tags.clone(),
        notes: s.song.notes.clone(),
        key: s.song.key.clone(),
        tempo: s.song.tempo,
        sections: s
            .sections
            .iter()
            .map(|x| SectionInput { id: Some(x.id.clone()), kind: x.kind.clone(), label: x.label.clone(), texts: x.texts.clone() })
            .collect(),
        arrangements: s
            .arrangements
            .iter()
            .map(|a| ArrangementInput { id: Some(a.id.clone()), name: a.name.clone(), sequence: a.sequence.clone(), is_default: a.is_default })
            .collect(),
        numbers: s
            .numbers
            .iter()
            .filter_map(|n| book_ids.get(&n.hymnbook_id).map(|id| HymnNumberInput { hymnbook_id: id.clone(), number: n.number.clone() }))
            .collect(),
    }
}

// ── SQL helpers ─────────────────────────────────────────────────────────

fn to_i64(n: usize) -> Result<i64> {
    i64::try_from(n).map_err(|e| ContentError::Invalid(e.to_string()))
}

fn check_song_revision(tx: &Transaction<'_>, id: &str, expected: i64) -> Result<()> {
    let actual: Option<i64> = tx.query_row("SELECT revision FROM songs WHERE id = ?1", params![id], |r| r.get(0)).optional()?;
    match actual {
        None => Err(ContentError::NotFound(id.to_string())),
        Some(actual) if actual != expected => Err(ContentError::Conflict { expected, actual }),
        Some(_) => Ok(()),
    }
}

fn insert_song_row(tx: &Transaction<'_>, id: &str, s: &SongInput) -> Result<()> {
    tx.execute(
        "INSERT INTO songs (id, title, title_sort, authors, copyright, ccli_number, licence, licence_note,
                            primary_language, tags, notes, key, tempo)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            id,
            s.title.trim(),
            title_sort(&s.title),
            s.authors.trim(),
            s.copyright.trim(),
            s.ccli_number.as_deref().map(str::trim).filter(|c| !c.is_empty()),
            s.licence.trim(),
            s.licence_note.trim(),
            s.primary_language.trim(),
            s.tags.trim(),
            s.notes.trim(),
            s.key.trim(),
            s.tempo,
        ],
    )?;
    Ok(())
}

fn update_song_row(tx: &Transaction<'_>, id: &str, s: &SongInput) -> Result<()> {
    tx.execute(
        "UPDATE songs SET title = ?2, title_sort = ?3, authors = ?4, copyright = ?5, ccli_number = ?6,
                          licence = ?7, licence_note = ?8, primary_language = ?9, tags = ?10, notes = ?11,
                          key = ?12, tempo = ?13,
                          revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![
            id,
            s.title.trim(),
            title_sort(&s.title),
            s.authors.trim(),
            s.copyright.trim(),
            s.ccli_number.as_deref().map(str::trim).filter(|c| !c.is_empty()),
            s.licence.trim(),
            s.licence_note.trim(),
            s.primary_language.trim(),
            s.tags.trim(),
            s.notes.trim(),
            s.key.trim(),
            s.tempo,
        ],
    )?;
    Ok(())
}

fn existing_child_ids(tx: &Transaction<'_>, song_id: &str) -> Result<HashSet<String>> {
    let mut ids = HashSet::new();
    for sql in [
        "SELECT id FROM song_sections WHERE song_id = ?1",
        "SELECT id FROM song_arrangements WHERE song_id = ?1",
    ] {
        let mut stmt = tx.prepare(sql)?;
        for row in stmt.query_map(params![song_id], |r| r.get::<_, String>(0))? {
            ids.insert(row?);
        }
    }
    Ok(ids)
}

/// Replace sections, texts, arrangements and numbers. Ids named in the input
/// that belong to this song are kept; everything else is new; rows not in
/// the input are deleted (texts and arrangements are rewritten wholesale,
/// which is cheap at this size).
fn write_song_children(tx: &Transaction<'_>, song_id: &str, s: &SongInput, existing: &HashSet<String>) -> Result<()> {
    // Sections: free positions, upsert, delete leftovers.
    tx.execute("UPDATE song_sections SET position = -(position + 1) WHERE song_id = ?1", params![song_id])?;
    let mut section_ids = Vec::with_capacity(s.sections.len());
    for (pos, sec) in s.sections.iter().enumerate() {
        let id = match &sec.id {
            Some(id) if existing.contains(id) => id.clone(),
            Some(id) if is_valid_id(id) && !existing.contains(id) && mode_allows_client_id(tx, id)? => id.clone(),
            _ => new_id(),
        };
        let label = if sec.label.trim().is_empty() { default_label(&sec.kind, pos, &s.sections) } else { sec.label.trim().to_string() };
        if existing.contains(&id) {
            tx.execute(
                "UPDATE song_sections SET position = ?3, kind = ?4, label = ?5 WHERE id = ?1 AND song_id = ?2",
                params![id, song_id, to_i64(pos)?, sec.kind.trim(), label],
            )?;
            tx.execute("DELETE FROM song_section_texts WHERE section_id = ?1", params![id])?;
        } else {
            tx.execute(
                "INSERT INTO song_sections (id, song_id, position, kind, label) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, song_id, to_i64(pos)?, sec.kind.trim(), label],
            )?;
        }
        for (lang, body) in &sec.texts {
            let body = body.trim_matches('\n');
            if body.trim().is_empty() {
                continue;
            }
            tx.execute(
                "INSERT INTO song_section_texts (section_id, language, body) VALUES (?1, ?2, ?3)",
                params![id, lang.trim(), body],
            )?;
        }
        section_ids.push(id);
    }
    tx.execute("DELETE FROM song_sections WHERE song_id = ?1 AND position < 0", params![song_id])?;

    // Arrangements: rewrite. Empty input → one generated Default.
    tx.execute("DELETE FROM song_arrangements WHERE song_id = ?1", params![song_id])?;
    let generated;
    let arrangements: &[ArrangementInput] = if s.arrangements.is_empty() {
        generated = vec![ArrangementInput {
            id: None,
            name: "Default".into(),
            sequence: default_sequence(&s.sections, &section_ids),
            is_default: true,
        }];
        &generated
    } else {
        &s.arrangements
    };
    let resolve = |sid: &str| -> Result<String> {
        // "#<index>" refers to the input section at that index (import path).
        if let Some(idx) = sid.strip_prefix('#') {
            let i: usize = idx.parse().map_err(|_| ContentError::Invalid(format!("bad section ref {sid:?}")))?;
            return section_ids.get(i).cloned().ok_or_else(|| ContentError::Invalid(format!("bad section ref {sid:?}")));
        }
        if let Some(i) = s.sections.iter().position(|x| x.id.as_deref() == Some(sid)) {
            return Ok(section_ids[i].clone());
        }
        if section_ids.iter().any(|x| x == sid) {
            return Ok(sid.to_string()); // generated Default uses the stored ids directly
        }
        Err(ContentError::Invalid(format!("arrangement refers to section {sid:?} which is not in this song")))
    };
    let mut any_default = false;
    for a in arrangements {
        let sequence: Vec<String> = a.sequence.iter().map(|x| resolve(x)).collect::<Result<_>>()?;
        let id = match &a.id {
            Some(id) if existing.contains(id) || is_valid_id(id) => id.clone(),
            _ => new_id(),
        };
        let is_default = a.is_default || (!any_default && arrangements.len() == 1);
        any_default |= is_default;
        tx.execute(
            "INSERT INTO song_arrangements (id, song_id, name, sequence, is_default) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, song_id, a.name.trim(), serde_json::to_string(&sequence).map_err(|e| ContentError::Invalid(e.to_string()))?, i64::from(is_default)],
        )?;
    }
    if !any_default {
        tx.execute(
            "UPDATE song_arrangements SET is_default = 1 WHERE id = (SELECT id FROM song_arrangements WHERE song_id = ?1 ORDER BY rowid LIMIT 1)",
            params![song_id],
        )?;
    }

    write_numbers(tx, song_id, &s.numbers)
}

/// (song id, title) of the song holding `number` in the book, if any.
fn number_holder(tx: &Transaction<'_>, hymnbook_id: &str, number: &str) -> Result<Option<(String, String)>> {
    Ok(tx
        .query_row(
            "SELECT s.id, s.title FROM hymn_numbers h JOIN songs s ON s.id = h.song_id WHERE h.hymnbook_id = ?1 AND h.number = ?2",
            params![hymnbook_id, number.trim().to_lowercase()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?)
}

/// Hymn numbers are rewritten wholesale; a number another song holds in the
/// same book is refused by title.
fn write_numbers(tx: &Transaction<'_>, song_id: &str, numbers: &[HymnNumberInput]) -> Result<()> {
    tx.execute("DELETE FROM hymn_numbers WHERE song_id = ?1", params![song_id])?;
    for n in numbers {
        let book_exists: bool = tx
            .query_row("SELECT 1 FROM hymnbooks WHERE id = ?1", params![n.hymnbook_id], |_| Ok(()))
            .optional()?
            .is_some();
        if !book_exists {
            return Err(ContentError::Invalid(format!("hymnbook {:?} does not exist", n.hymnbook_id)));
        }
        if let Some((holder, title)) = number_holder(tx, &n.hymnbook_id, &n.number)? {
            if holder != song_id {
                return Err(ContentError::Invalid(format!("hymn number {} is already used by {title:?} in that book", n.number.trim())));
            }
        }
        tx.execute(
            "INSERT OR REPLACE INTO hymn_numbers (hymnbook_id, number, song_id) VALUES (?1, ?2, ?3)",
            params![n.hymnbook_id, n.number.trim().to_lowercase(), song_id],
        )?;
    }
    Ok(())
}

/// A client-generated section id is adopted only if no other song owns it.
fn mode_allows_client_id(tx: &Transaction<'_>, id: &str) -> Result<bool> {
    Ok(tx
        .query_row("SELECT 1 FROM song_sections WHERE id = ?1", params![id], |_| Ok(()))
        .optional()?
        .is_none())
}

/// "Verse 1", "Chorus", "Chorus 2" — numbered within kind only when repeated.
fn default_label(kind: &str, pos: usize, all: &[SectionInput]) -> String {
    let kind = kind.trim();
    let name = match kind {
        "verse" => "Verse",
        "chorus" => "Chorus",
        "bridge" => "Bridge",
        "prechorus" => "Pre-chorus",
        "tag" => "Tag",
        "ending" => "Ending",
        "intro" => "Intro",
        _ => "Section",
    };
    let same: Vec<usize> = all.iter().enumerate().filter(|(_, s)| s.kind.trim() == kind).map(|(i, _)| i).collect();
    if same.len() > 1 || kind == "verse" {
        let n = same.iter().position(|&i| i == pos).unwrap_or(0) + 1;
        format!("{name} {n}")
    } else {
        name.to_string()
    }
}

/// Authoring order; when exactly one chorus exists it follows every verse.
pub fn default_sequence(sections: &[SectionInput], ids: &[String]) -> Vec<String> {
    let choruses: Vec<usize> = sections.iter().enumerate().filter(|(_, s)| s.kind.trim() == "chorus").map(|(i, _)| i).collect();
    if choruses.len() != 1 {
        return ids.to_vec();
    }
    let chorus = &ids[choruses[0]];
    let mut seq = Vec::with_capacity(ids.len() * 2);
    for (i, s) in sections.iter().enumerate() {
        if i == choruses[0] {
            // Only emit the chorus here if nothing before it was a verse.
            if !sections[..i].iter().any(|x| x.kind.trim() == "verse") {
                seq.push(chorus.clone());
            }
            continue;
        }
        seq.push(ids[i].clone());
        if s.kind.trim() == "verse" {
            seq.push(chorus.clone());
        }
    }
    seq
}

fn services_using(conn: &Connection, song_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT p.title FROM program_items i JOIN programs p ON p.id = i.program_id
         WHERE i.kind = 'song' AND json_extract(i.payload, '$.song_id') = ?1
         ORDER BY p.service_date DESC, p.title",
    )?;
    let rows = stmt.query_map(params![song_id], |r| r.get(0))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

fn upsert_hymnbook_tx(tx: &Transaction<'_>, b: &HymnbookInput) -> Result<String> {
    let id = match &b.id {
        Some(id) if is_valid_id(id) => id.clone(),
        _ => new_id(),
    };
    let exists: bool = tx.query_row("SELECT 1 FROM hymnbooks WHERE id = ?1", params![id], |_| Ok(())).optional()?.is_some();
    let clash: Option<String> = tx
        .query_row("SELECT id FROM hymnbooks WHERE lower(code) = lower(?1) AND id <> ?2", params![b.code.trim(), id], |r| r.get(0))
        .optional()?;
    if clash.is_some() {
        return Err(ContentError::Invalid(format!("hymnbook code {:?} is already used", b.code.trim())));
    }
    if exists {
        tx.execute(
            "UPDATE hymnbooks SET code = ?2, name = ?3, language = ?4, publisher = ?5, licence_note = ?6 WHERE id = ?1",
            params![id, b.code.trim(), b.name.trim(), b.language.trim(), b.publisher.trim(), b.licence_note.trim()],
        )?;
        audit(tx, "hymnbook", &id, "update", &serde_json::json!({ "code": b.code.trim() }))?;
    } else {
        tx.execute(
            "INSERT INTO hymnbooks (id, code, name, language, publisher, licence_note) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, b.code.trim(), b.name.trim(), b.language.trim(), b.publisher.trim(), b.licence_note.trim()],
        )?;
        audit(tx, "hymnbook", &id, "create", &serde_json::json!({ "code": b.code.trim() }))?;
    }
    Ok(id)
}

fn load_hymnbooks(conn: &Connection) -> Result<Vec<Hymnbook>> {
    let mut stmt = conn.prepare("SELECT id, code, name, language, publisher, licence_note FROM hymnbooks ORDER BY code")?;
    let rows = stmt.query_map([], |r| {
        Ok(Hymnbook { id: r.get(0)?, code: r.get(1)?, name: r.get(2)?, language: r.get(3)?, publisher: r.get(4)?, licence_note: r.get(5)? })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

fn load_song_row(conn: &Connection, id: &str) -> Result<Option<Song>> {
    Ok(conn
        .query_row(
            "SELECT id, title, authors, copyright, ccli_number, licence, licence_note, primary_language, tags, notes,
                    revision, created_at, updated_at, key, tempo FROM songs WHERE id = ?1",
            params![id],
            |r| {
                Ok(Song {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    authors: r.get(2)?,
                    copyright: r.get(3)?,
                    ccli_number: r.get(4)?,
                    licence: r.get(5)?,
                    licence_note: r.get(6)?,
                    primary_language: r.get(7)?,
                    tags: r.get(8)?,
                    notes: r.get(9)?,
                    revision: r.get(10)?,
                    created_at: r.get(11)?,
                    updated_at: r.get(12)?,
                    key: r.get(13)?,
                    tempo: r.get(14)?,
                })
            },
        )
        .optional()?)
}

fn load_sections(conn: &Connection, song_id: &str) -> Result<Vec<SongSection>> {
    let mut sections: Vec<SongSection> = {
        let mut stmt = conn.prepare("SELECT id, kind, label FROM song_sections WHERE song_id = ?1 ORDER BY position")?;
        let rows = stmt.query_map(params![song_id], |r| Ok(SongSection { id: r.get(0)?, kind: r.get(1)?, label: r.get(2)?, texts: BTreeMap::new() }))?;
        rows.collect::<std::result::Result<_, _>>()?
    };
    let mut stmt = conn.prepare(
        "SELECT t.section_id, t.language, t.body FROM song_section_texts t
         JOIN song_sections s ON s.id = t.section_id WHERE s.song_id = ?1",
    )?;
    for row in stmt.query_map(params![song_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))? {
        let (sid, lang, body) = row?;
        if let Some(sec) = sections.iter_mut().find(|s| s.id == sid) {
            sec.texts.insert(lang, body);
        }
    }
    Ok(sections)
}

fn load_numbers(conn: &Connection, song_id: &str) -> Result<Vec<HymnNumber>> {
    let mut stmt = conn.prepare(
        "SELECT h.hymnbook_id, b.code, h.number FROM hymn_numbers h JOIN hymnbooks b ON b.id = h.hymnbook_id
         WHERE h.song_id = ?1 ORDER BY b.code, h.number",
    )?;
    let rows = stmt.query_map(params![song_id], |r| Ok(HymnNumber { hymnbook_id: r.get(0)?, hymnbook_code: r.get(1)?, number: r.get(2)? }))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

fn load_song(conn: &Connection, id: &str) -> Result<Option<SongWithSections>> {
    let Some(song) = load_song_row(conn, id)? else { return Ok(None) };
    let sections = load_sections(conn, id)?;
    let arrangements = {
        let mut stmt = conn.prepare("SELECT id, name, sequence, is_default FROM song_arrangements WHERE song_id = ?1 ORDER BY is_default DESC, name")?;
        let rows = stmt.query_map(params![id], |r| {
            let raw: String = r.get(2)?;
            Ok(Arrangement {
                id: r.get(0)?,
                name: r.get(1)?,
                sequence: serde_json::from_str(&raw).unwrap_or_default(),
                is_default: r.get::<_, i64>(3)? != 0,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()?
    };
    let numbers = load_numbers(conn, id)?;
    Ok(Some(SongWithSections { song, sections, arrangements, numbers }))
}

fn load_summary(conn: &Connection, id: &str) -> Result<SongSummary> {
    // ponytail: one song per query batch; fine for a church library (thousands, not millions).
    let song = load_song_row(conn, id)?.ok_or_else(|| ContentError::NotFound(id.to_string()))?;
    let sections = load_sections(conn, id)?;
    let mut languages: Vec<String> = sections.iter().flat_map(|s| s.texts.keys().cloned()).collect::<HashSet<_>>().into_iter().collect();
    languages.sort();
    let first_line = sections
        .first()
        .and_then(|s| s.texts.get(&song.primary_language).or_else(|| s.texts.values().next()))
        .and_then(|b| b.lines().find(|l| !l.trim().is_empty()))
        .unwrap_or("")
        .trim()
        .to_string();
    let numbers = load_numbers(conn, id)?.into_iter().map(|n| format!("{} {}", n.hymnbook_code, n.number)).collect();
    Ok(SongSummary {
        id: song.id,
        title: song.title,
        authors: song.authors,
        licence: song.licence,
        primary_language: song.primary_language,
        languages,
        numbers,
        first_line,
        revision: song.revision,
        updated_at: song.updated_at,
    })
}

// ── search ──────────────────────────────────────────────────────────────

/// Rebuild the song's FTS row from its current rows.
fn reindex(tx: &Transaction<'_>, song_id: &str) -> Result<()> {
    tx.execute("DELETE FROM song_search WHERE song_id = ?1", params![song_id])?;
    let Some(song) = load_song_row(tx, song_id)? else { return Ok(()) };
    let sections = load_sections(tx, song_id)?;
    let lyrics: String = sections.iter().flat_map(|s| s.texts.values()).map(|b| fold(b)).collect::<Vec<_>>().join("\n");
    let numbers: String = load_numbers(tx, song_id)?
        .into_iter()
        .map(|n| format!("{} {} {}{}", n.hymnbook_code, n.number, n.hymnbook_code, n.number))
        .collect::<Vec<_>>()
        .join(" ");
    tx.execute(
        "INSERT INTO song_search (song_id, title, authors, lyrics, numbers) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![song_id, fold(&song.title), fold(&song.authors), lyrics, numbers],
    )?;
    Ok(())
}

/// Yoruba letters with dots and tone marks fold to their base letter so
/// "olorun" finds "Ọlọ́run". The original text keeps its marks; only the
/// index is folded. Combining marks (U+0300..U+036F) are dropped.
pub fn fold(s: &str) -> String {
    s.chars()
        .filter_map(|c| match c {
            '\u{0300}'..='\u{036F}' => None,
            // Letters with the accent built in (how they are usually typed), as well as the
            // separate marks above, and the Yoruba underdot letters.
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'ā' | 'ǎ' => Some('a'),
            'À' | 'Á' | 'Â' | 'Ã' | 'Ä' | 'Ā' | 'Ǎ' => Some('A'),
            'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ě' | 'ẹ' => Some('e'),
            'È' | 'É' | 'Ê' | 'Ë' | 'Ē' | 'Ě' | 'Ẹ' => Some('E'),
            'ì' | 'í' | 'î' | 'ï' | 'ī' | 'ǐ' => Some('i'),
            'Ì' | 'Í' | 'Î' | 'Ï' | 'Ī' | 'Ǐ' => Some('I'),
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ō' | 'ǒ' | 'ọ' => Some('o'),
            'Ò' | 'Ó' | 'Ô' | 'Õ' | 'Ö' | 'Ō' | 'Ǒ' | 'Ọ' => Some('O'),
            'ù' | 'ú' | 'û' | 'ü' | 'ū' | 'ǔ' => Some('u'),
            'Ù' | 'Ú' | 'Û' | 'Ü' | 'Ū' | 'Ǔ' => Some('U'),
            'ń' | 'ǹ' | 'ñ' | 'ṅ' => Some('n'),
            'Ń' | 'Ǹ' | 'Ñ' | 'Ṅ' => Some('N'),
            'ḿ' => Some('m'),
            'Ḿ' => Some('M'),
            'ṣ' => Some('s'),
            'Ṣ' => Some('S'),
            _ => Some(c),
        })
        .collect()
}

/// `"SSS 245"`, `"245"`, `"#245"`, `"245a"` → (book code, number).
pub fn parse_hymn_number(q: &str) -> Option<(Option<String>, String)> {
    let q = q.trim();
    let (code, rest) = match q.find(|c: char| !c.is_ascii_alphabetic()) {
        Some(0) => (None, q),
        Some(i) if i <= 6 => (Some(q[..i].to_uppercase()), q[i..].trim_start()),
        _ => return None,
    };
    let rest = rest.strip_prefix('#').unwrap_or(rest).trim_start();
    let digits_end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
    if digits_end == 0 || digits_end > 5 {
        return None;
    }
    let suffix = &rest[digits_end..];
    if !(suffix.is_empty() || (suffix.len() == 1 && suffix.chars().all(|c| c.is_ascii_lowercase()))) {
        return None;
    }
    Some((code, rest.to_lowercase()))
}

/// Each token quoted (so punctuation never reaches the FTS parser); the last
/// token matches as a prefix.
pub fn fts_query(q: &str) -> String {
    let tokens: Vec<String> = fold(q).split_whitespace().map(|t| format!("\"{}\"", t.replace('"', "\"\""))).collect();
    let n = tokens.len();
    tokens.into_iter().enumerate().map(|(i, t)| if i + 1 == n { format!("{t}*") } else { t }).collect::<Vec<_>>().join(" ")
}

fn search_ids(conn: &Connection, q: &str, limit: usize) -> Result<Vec<String>> {
    let limit = to_i64(limit)?;
    if let Some((code, number)) = parse_hymn_number(q) {
        let mut stmt = conn.prepare(
            "SELECT h.song_id FROM hymn_numbers h JOIN hymnbooks b ON b.id = h.hymnbook_id JOIN songs s ON s.id = h.song_id
             WHERE h.number = ?1 AND (?2 IS NULL OR upper(b.code) = ?2) ORDER BY b.code, s.title_sort LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![number, code, limit], |r| r.get::<_, String>(0))?;
        let ids: Vec<String> = rows.collect::<std::result::Result<_, _>>()?;
        // "Psalm 23", "Hymn 245": a word that is no hymnbook's code here is part of a title.
        let is_book = match &code {
            Some(c) => conn.query_row("SELECT 1 FROM hymnbooks WHERE upper(code) = ?1", params![c], |_| Ok(())).optional()?.is_some(),
            None => false,
        };
        if !ids.is_empty() || is_book {
            return Ok(ids);
        }
        // A bare number that matches no hymn may be part of a title ("Psalm 23").
    }
    let query = fts_query(q);
    if query.is_empty() {
        return Ok(vec![]);
    }
    let mut stmt = conn.prepare(
        "SELECT song_id FROM song_search WHERE song_search MATCH ?1
         ORDER BY bm25(song_search, 0.0, 10.0, 4.0, 1.0, 2.0) LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![query, limit], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

// ── validation ──────────────────────────────────────────────────────────

fn title_sort(title: &str) -> String {
    let t = fold(title).to_lowercase();
    let t = t.trim();
    for article in ["the ", "a ", "an "] {
        if let Some(rest) = t.strip_prefix(article) {
            return rest.trim().to_string();
        }
    }
    t.to_string()
}

/// `^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$`
pub fn is_language_tag(tag: &str) -> bool {
    let mut parts = tag.split('-');
    let Some(first) = parts.next() else { return false };
    if !(2..=3).contains(&first.len()) || !first.chars().all(|c| c.is_ascii_lowercase()) {
        return false;
    }
    parts.all(|p| (2..=8).contains(&p.len()) && p.chars().all(|c| c.is_ascii_alphanumeric()))
}

fn validate_song(s: &SongInput) -> Result<()> {
    let bad = |m: String| Err(ContentError::Invalid(m));
    let title = s.title.trim();
    if title.is_empty() {
        return bad("title is required".into());
    }
    if title.chars().count() > crate::MAX_TITLE {
        return bad(format!("title longer than {} characters", crate::MAX_TITLE));
    }
    if !LICENCES.contains(&s.licence.trim()) {
        return bad(format!("unknown licence {:?}", s.licence));
    }
    if let Some(c) = s.ccli_number.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
        if c.len() > 12 || !c.chars().all(|ch| ch.is_ascii_digit()) {
            return bad(format!("CCLI number must be digits only, got {c:?}"));
        }
    }
    if !is_language_tag(s.primary_language.trim()) {
        return bad(format!("invalid language tag {:?}", s.primary_language));
    }
    if s.sections.len() > MAX_SECTIONS {
        return bad(format!("more than {MAX_SECTIONS} sections"));
    }
    if s.notes.chars().count() > crate::MAX_NOTES {
        return bad(format!("notes longer than {} characters", crate::MAX_NOTES));
    }
    if s.key.trim().chars().count() > 12 {
        return bad("key must be short, like G or F#m".into());
    }
    if s.tempo.is_some_and(|t| !(20..=300).contains(&t)) {
        return bad("tempo must be between 20 and 300 bpm".into());
    }
    let mut ids = HashSet::new();
    for (i, sec) in s.sections.iter().enumerate() {
        if !SECTION_KINDS.contains(&sec.kind.trim()) {
            return bad(format!("section {i}: unknown kind {:?}", sec.kind));
        }
        if sec.label.chars().count() > 60 {
            return bad(format!("section {i}: label longer than 60 characters"));
        }
        for (lang, body) in &sec.texts {
            if !is_language_tag(lang.trim()) {
                return bad(format!("section {i}: invalid language tag {lang:?}"));
            }
            if body.chars().count() > MAX_SECTION_BODY {
                return bad(format!("section {i}: {lang} text longer than {MAX_SECTION_BODY} characters"));
            }
        }
        if let Some(id) = &sec.id {
            if !is_valid_id(id) {
                return bad(format!("section {i}: invalid id {id:?}"));
            }
            if !ids.insert(id.clone()) {
                return bad(format!("section {i}: duplicate id {id:?}"));
            }
        }
    }
    let mut defaults = 0;
    let mut names = HashSet::new();
    for (i, a) in s.arrangements.iter().enumerate() {
        let name = a.name.trim();
        if name.is_empty() || name.chars().count() > 60 {
            return bad(format!("arrangement {i}: name must be 1–60 characters"));
        }
        if !names.insert(name.to_lowercase()) {
            return bad(format!("arrangement {i}: duplicate name {name:?}"));
        }
        if a.sequence.len() > MAX_ARRANGEMENT_STEPS {
            return bad(format!("arrangement {i}: more than {MAX_ARRANGEMENT_STEPS} steps"));
        }
        for sid in &a.sequence {
            let known = sid.starts_with('#') || s.sections.iter().any(|x| x.id.as_deref() == Some(sid));
            if !known {
                return bad(format!("arrangement {i}: refers to section {sid:?} which is not in this song"));
            }
        }
        if let Some(id) = &a.id {
            if !is_valid_id(id) {
                return bad(format!("arrangement {i}: invalid id {id:?}"));
            }
        }
        defaults += i32::from(a.is_default);
    }
    if defaults > 1 {
        return bad("more than one default arrangement".into());
    }
    let mut seen_numbers = HashSet::new();
    for (i, n) in s.numbers.iter().enumerate() {
        if !is_valid_id(&n.hymnbook_id) {
            return bad(format!("number {i}: invalid hymnbook id"));
        }
        let Some((None, _)) = parse_hymn_number(n.number.trim()) else {
            return bad(format!("number {i}: hymn number must be digits with an optional letter, got {:?}", n.number));
        };
        if !seen_numbers.insert((n.hymnbook_id.clone(), n.number.trim().to_lowercase())) {
            return bad(format!("number {i}: duplicate hymn number"));
        }
    }
    Ok(())
}

fn validate_hymnbook(b: &HymnbookInput) -> Result<()> {
    let code = b.code.trim();
    if code.is_empty() || code.len() > 6 || !code.chars().all(|c| c.is_ascii_alphabetic()) {
        return Err(ContentError::Invalid(format!("hymnbook code must be 1–6 letters, got {code:?}")));
    }
    let name = b.name.trim();
    if name.is_empty() || name.chars().count() > crate::MAX_TITLE {
        return Err(ContentError::Invalid("hymnbook name is required".into()));
    }
    if !is_language_tag(b.language.trim()) {
        return Err(ContentError::Invalid(format!("invalid language tag {:?}", b.language)));
    }
    Ok(())
}

/// Called from `validate_items` for `kind = 'song'`.
pub(crate) fn validate_song_payload(i: usize, payload: Option<&str>) -> Result<SongItemPayload> {
    let Some(raw) = payload else {
        return Err(ContentError::Invalid(format!("item {i}: song items need a payload")));
    };
    let p: SongItemPayload = serde_json::from_str(raw).map_err(|e| ContentError::Invalid(format!("item {i}: bad song payload: {e}")))?;
    if !is_valid_id(&p.song_id) {
        return Err(ContentError::Invalid(format!("item {i}: invalid song id")));
    }
    if p.arrangement_id.as_deref().is_some_and(|a| !is_valid_id(a)) {
        return Err(ContentError::Invalid(format!("item {i}: invalid arrangement id")));
    }
    if p.languages.iter().any(|l| !is_language_tag(l)) {
        return Err(ContentError::Invalid(format!("item {i}: invalid language in payload")));
    }
    Ok(p)
}

/// Song items must point at songs that exist (and arrangements of that song).
pub(crate) fn check_song_items_exist(tx: &Transaction<'_>, items: &[crate::ItemInput]) -> Result<()> {
    for (i, it) in (1_usize..).zip(items).filter(|(_, it)| it.kind.trim() == "song") {
        let p = validate_song_payload(i, it.payload.as_deref())?;
        let exists: bool = tx.query_row("SELECT 1 FROM songs WHERE id = ?1", params![p.song_id], |_| Ok(())).optional()?.is_some();
        if !exists {
            return Err(ContentError::Invalid(format!("item {i}: song {:?} does not exist", p.song_id)));
        }
        if let Some(a) = &p.arrangement_id {
            let ok: bool = tx
                .query_row("SELECT 1 FROM song_arrangements WHERE id = ?1 AND song_id = ?2", params![a, p.song_id], |_| Ok(()))
                .optional()?
                .is_some();
            if !ok {
                return Err(ContentError::Invalid(format!("item {i}: arrangement {a:?} does not belong to the song")));
            }
        }
    }
    Ok(())
}

/// Sort keys written before accented letters were folded (`À` sorted after
/// `z`, hiding such songs from the first page of the library): brought up to
/// date when the database opens. Only rows whose key differs are written.
pub(crate) fn refresh_title_sort(conn: &rusqlite::Connection) -> rusqlite::Result<usize> {
    let has_songs: i64 = conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'songs'", [], |r| r.get(0))?;
    if has_songs == 0 {
        return Ok(0);
    }
    let stale: Vec<(String, String)> = {
        let mut stmt = conn.prepare("SELECT id, title, title_sort FROM songs")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?;
        rows.filter_map(std::result::Result::ok)
            .filter(|(_, title, sort)| &title_sort(title) != sort)
            .map(|(id, title, _)| (id, title_sort(&title)))
            .collect()
    };
    for (id, sort) in &stale {
        conn.execute("UPDATE songs SET title_sort = ?2 WHERE id = ?1", rusqlite::params![id, sort])?;
    }
    Ok(stale.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ItemInput;

    fn sec(kind: &str, en: &str, yo: Option<&str>) -> SectionInput {
        let mut texts = BTreeMap::new();
        texts.insert("en".to_string(), en.to_string());
        if let Some(yo) = yo {
            texts.insert("yo".to_string(), yo.to_string());
        }
        SectionInput { kind: kind.into(), texts, ..SectionInput::default() }
    }

    fn amazing_grace() -> SongInput {
        SongInput {
            title: "Amazing Grace".into(),
            authors: "John Newton".into(),
            licence: "public_domain".into(),
            sections: vec![
                sec("verse", "Amazing grace, how sweet the sound\nthat saved a wretch like me", Some("Oore-ọ̀fẹ́ ìyanu, ohùn dídùn")),
                sec("verse", "'Twas grace that taught my heart to fear", None),
            ],
            ..SongInput::default()
        }
    }

    fn with_chorus() -> SongInput {
        SongInput {
            title: "Blessed Assurance".into(),
            authors: "Fanny Crosby; Phoebe Knapp".into(),
            licence: "public_domain".into(),
            sections: vec![
                sec("verse", "Blessed assurance, Jesus is mine", None),
                sec("chorus", "This is my story, this is my song", None),
                sec("verse", "Perfect submission, perfect delight", None),
            ],
            ..SongInput::default()
        }
    }

    #[test]
    fn stale_sort_keys_are_refreshed_on_open() {
        let db = ContentDb::open_in_memory().unwrap();
        let mut input = amazing_grace();
        input.title = "Àánú".into();
        let s = db.create_song(&input).unwrap();
        let conn = db.lock().unwrap();
        // As an earlier build stored it: the built-in accent kept, so it sorted after "z".
        conn.execute("UPDATE songs SET title_sort = 'àánú' WHERE id = ?1", [&s.song.id]).unwrap();
        assert_eq!(refresh_title_sort(&conn).unwrap(), 1);
        let sort: String = conn.query_row("SELECT title_sort FROM songs WHERE id = ?1", [&s.song.id], |r| r.get(0)).unwrap();
        assert_eq!(sort, "aanu");
        assert_eq!(refresh_title_sort(&conn).unwrap(), 0, "nothing left to change");
    }

    #[test]
    fn create_get_round_trip_with_two_languages_and_stable_ids() {
        let db = ContentDb::open_in_memory().unwrap();
        let s = db.create_song(&amazing_grace()).unwrap();
        assert_eq!(s.song.revision, 1);
        assert_eq!(s.sections.len(), 2);
        assert_eq!(s.sections[0].label, "Verse 1");
        assert_eq!(s.sections[0].texts["yo"], "Oore-ọ̀fẹ́ ìyanu, ohùn dídùn");
        assert_eq!(s.arrangements.len(), 1);
        assert!(s.arrangements[0].is_default);
        assert_eq!(s.arrangements[0].sequence, vec![s.sections[0].id.clone(), s.sections[1].id.clone()]);
        let got = db.get_song(&s.song.id).unwrap().unwrap();
        assert_eq!(got, s);

        // Update: reorder sections, keep ids, add a second arrangement.
        let mut input = amazing_grace();
        input.sections = vec![
            SectionInput { id: Some(s.sections[1].id.clone()), ..input.sections[1].clone() },
            SectionInput { id: Some(s.sections[0].id.clone()), ..input.sections[0].clone() },
        ];
        input.arrangements = vec![
            ArrangementInput { id: Some(s.arrangements[0].id.clone()), name: "Default".into(), sequence: vec![s.sections[0].id.clone()], is_default: true },
            ArrangementInput { id: None, name: "Short".into(), sequence: vec![s.sections[1].id.clone(), s.sections[1].id.clone()], is_default: false },
        ];
        let u = db.update_song(&s.song.id, 1, &input).unwrap();
        assert_eq!(u.song.revision, 2);
        assert_eq!(u.sections.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), vec![s.sections[1].id.as_str(), s.sections[0].id.as_str()]);
        assert_eq!(u.sections[0].label, "Verse 1", "labels renumber by new order");
        assert_eq!(u.arrangements[0].id, s.arrangements[0].id);
        assert_eq!(u.arrangements[1].name, "Short");
        assert_eq!(u.arrangements[1].sequence.len(), 2);
        let events = db.audit_events("song", &s.song.id).unwrap();
        assert_eq!(events.iter().map(|e| e.action.as_str()).collect::<Vec<_>>(), vec!["create", "update"]);
    }

    #[test]
    fn default_arrangement_repeats_single_chorus_after_each_verse() {
        let db = ContentDb::open_in_memory().unwrap();
        let s = db.create_song(&with_chorus()).unwrap();
        let [v1, c, v2] = [&s.sections[0].id, &s.sections[1].id, &s.sections[2].id];
        assert_eq!(s.sections[1].label, "Chorus");
        assert_eq!(s.sections[2].label, "Verse 2");
        assert_eq!(s.arrangements[0].sequence, vec![v1.clone(), c.clone(), v2.clone(), c.clone()]);
    }

    #[test]
    fn key_and_tempo_round_trip_and_validate() {
        let db = ContentDb::open_in_memory().unwrap();
        let s = db.create_song(&SongInput { key: " G ".into(), tempo: Some(72), ..amazing_grace() }).unwrap();
        assert_eq!((s.song.key.as_str(), s.song.tempo), ("G", Some(72)));
        let back = db.import_songs(&db.export_songs(None).unwrap(), ImportMode::Duplicate).unwrap();
        assert_eq!(back.added, 1);
        assert_eq!(db.list_songs(Some("amazing"), 5).unwrap().len(), 2);
        assert!(matches!(db.create_song(&SongInput { tempo: Some(1000), ..amazing_grace() }), Err(ContentError::Invalid(_))));
        assert!(matches!(db.create_song(&SongInput { key: "x".repeat(13), ..amazing_grace() }), Err(ContentError::Invalid(_))));
    }

    #[test]
    fn stale_revision_conflicts() {
        let db = ContentDb::open_in_memory().unwrap();
        let s = db.create_song(&amazing_grace()).unwrap();
        db.update_song(&s.song.id, 1, &amazing_grace()).unwrap();
        let err = db.update_song(&s.song.id, 1, &amazing_grace()).unwrap_err();
        assert!(matches!(err, ContentError::Conflict { expected: 1, actual: 2 }));
        assert!(matches!(db.delete_song(&s.song.id, 1), Err(ContentError::Conflict { .. })));
        assert!(matches!(db.update_song("nope", 1, &amazing_grace()), Err(ContentError::NotFound(_))));
    }

    #[test]
    fn delete_refused_while_a_service_uses_the_song_then_succeeds() {
        let db = ContentDb::open_in_memory().unwrap();
        let s = db.create_song(&amazing_grace()).unwrap();
        let p = db.create_program("Sunday 25 Oct", Some("2026-10-25")).unwrap();
        let payload = serde_json::json!({ "song_id": s.song.id, "arrangement_id": s.arrangements[0].id, "languages": ["en", "yo"] }).to_string();
        let item = ItemInput { kind: "song".into(), reference: "Amazing Grace".into(), payload: Some(payload), ..ItemInput::default() };
        let saved = db.replace_items(&p.id, 1, &[item]).unwrap();
        assert_eq!(saved.items[0].kind, "song");
        assert!(saved.items[0].payload.as_deref().unwrap().contains(&s.song.id));

        let err = db.delete_song(&s.song.id, 1).unwrap_err();
        match err {
            ContentError::InUse { titles } => assert_eq!(titles, vec!["Sunday 25 Oct"]),
            other => panic!("expected InUse, got {other:?}"),
        }
        assert!(db.get_song(&s.song.id).unwrap().is_some());

        db.replace_items(&p.id, 2, &[]).unwrap();
        db.delete_song(&s.song.id, 1).unwrap();
        assert!(db.get_song(&s.song.id).unwrap().is_none());
        assert!(db.list_songs(Some("amazing"), 10).unwrap().is_empty(), "FTS row gone");
    }

    #[test]
    fn song_items_must_reference_existing_songs_and_arrangements() {
        let db = ContentDb::open_in_memory().unwrap();
        let s = db.create_song(&amazing_grace()).unwrap();
        let p = db.create_program("p", None).unwrap();
        let mk = |payload: &str| ItemInput { kind: "song".into(), reference: "x".into(), payload: Some(payload.into()), ..ItemInput::default() };
        for bad in [
            ItemInput { kind: "song".into(), reference: "x".into(), payload: None, ..ItemInput::default() },
            mk("not json"),
            mk(r#"{"song_id":"missing-song"}"#),
            mk(&format!(r#"{{"song_id":"{}","arrangement_id":"other"}}"#, s.song.id)),
            mk(&format!(r#"{{"song_id":"{}","languages":["English"]}}"#, s.song.id)),
        ] {
            assert!(matches!(db.replace_items(&p.id, 1, std::slice::from_ref(&bad)), Err(ContentError::Invalid(_))), "{bad:?}");
        }
        assert!(db.replace_items(&p.id, 1, &[mk(&format!(r#"{{"song_id":"{}"}}"#, s.song.id))]).is_ok());
    }

    #[test]
    fn search_by_title_lyrics_diacritics_and_number() {
        let db = ContentDb::open_in_memory().unwrap();
        let sss = db.upsert_hymnbook(&HymnbookInput { id: None, code: "SSS".into(), name: "Sacred Songs and Solos".into(), language: "en".into(), publisher: String::new(), licence_note: String::new() }).unwrap();
        let ybh = db.upsert_hymnbook(&HymnbookInput { id: None, code: "ybh".into(), name: "Yoruba Baptist Hymnal".into(), language: "yo".into(), publisher: String::new(), licence_note: String::new() }).unwrap();
        let mut ag = amazing_grace();
        ag.numbers = vec![HymnNumberInput { hymnbook_id: sss.id.clone(), number: "245".into() }];
        let ag = db.create_song(&ag).unwrap();
        let mut ba = with_chorus();
        ba.numbers = vec![HymnNumberInput { hymnbook_id: ybh.id.clone(), number: "245".into() }, HymnNumberInput { hymnbook_id: sss.id.clone(), number: "12a".into() }];
        let ba = db.create_song(&ba).unwrap();
        let yoruba = db
            .create_song(&SongInput {
                title: "Ọlọ́run mi".into(),
                primary_language: "yo".into(),
                sections: vec![SectionInput { kind: "verse".into(), texts: BTreeMap::from([("yo".to_string(), "Ọlọ́run mi, mo yìn ọ́".to_string())]), ..SectionInput::default() }],
                ..SongInput::default()
            })
            .unwrap();

        let ids = |q: &str| db.list_songs(Some(q), 10).unwrap().into_iter().map(|s| s.id).collect::<Vec<_>>();
        assert_eq!(ids("amazing"), vec![ag.song.id.clone()]);
        assert_eq!(ids("wretch like me"), vec![ag.song.id.clone()]);
        assert_eq!(ids("Ọlọ́run"), vec![yoruba.song.id.clone()]);
        assert_eq!(ids("olorun"), vec![yoruba.song.id.clone()]);
        assert_eq!(ids("crosby"), vec![ba.song.id.clone()]);
        assert_eq!(ids("245"), vec![ag.song.id.clone(), ba.song.id.clone()], "bare number: all books, by code");
        assert_eq!(ids("SSS 245"), vec![ag.song.id.clone()]);
        assert_eq!(ids("ybh245"), vec![ba.song.id.clone()]);
        assert_eq!(ids("#12a"), vec![ba.song.id.clone()]);
        assert_eq!(ids("SSS 999"), Vec::<String>::new());
        assert_eq!(ids("bless"), vec![ba.song.id.clone()], "prefix on last token");
        assert_eq!(ids("\"); DROP TABLE songs; --"), Vec::<String>::new());

        let summary = &db.list_songs(Some("amazing"), 10).unwrap()[0];
        assert_eq!(summary.numbers, vec!["SSS 245"]);
        assert_eq!(summary.languages, vec!["en", "yo"]);
        assert_eq!(summary.first_line, "Amazing grace, how sweet the sound");
        assert_eq!(db.list_songs(None, 10).unwrap().iter().map(|s| s.title.as_str()).collect::<Vec<_>>(), vec!["Amazing Grace", "Blessed Assurance", "Ọlọ́run mi"]);

        // A number taken in the same book is refused; numbers rewrite on update.
        let mut clash = amazing_grace();
        clash.title = "Other".into();
        clash.numbers = vec![HymnNumberInput { hymnbook_id: sss.id.clone(), number: "245".into() }];
        assert!(matches!(db.create_song(&clash), Err(ContentError::Invalid(_))));
        // Renaming a book's code reindexes the numbers.
        db.upsert_hymnbook(&HymnbookInput { id: Some(sss.id.clone()), code: "SS".into(), name: "Sacred Songs".into(), language: "en".into(), publisher: String::new(), licence_note: String::new() }).unwrap();
        assert_eq!(ids("SS 245"), vec![ag.song.id.clone()]);
        assert_eq!(ids("SSS 245"), Vec::<String>::new());
        db.delete_hymnbook(&sss.id).unwrap();
        assert_eq!(ids("245"), vec![ba.song.id.clone()]);
        assert!(db.get_song(&ag.song.id).unwrap().is_some(), "songs survive a deleted book");
    }

    #[test]
    fn a_word_and_a_number_that_is_no_hymnbook_searches_titles() {
        let db = ContentDb::open_in_memory().unwrap();
        let mut psalm = amazing_grace();
        psalm.title = "Psalm 23".into();
        db.create_song(&psalm).unwrap();
        assert_eq!(db.list_songs(Some("Psalm 23"), 5).unwrap().len(), 1);
        // A real hymnbook code still means a number in that book (none here: nothing).
        db.upsert_hymnbook(&HymnbookInput { id: None, code: "SSS".into(), name: "Sacred Songs and Solos".into(), language: "en".into(), publisher: String::new(), licence_note: String::new() }).unwrap();
        assert_eq!(db.list_songs(Some("SSS 23"), 5).unwrap().len(), 0);
    }

    #[test]
    fn a_hymn_number_already_used_here_is_left_off_not_refused() {
        // The same hymn entered on two computers: two ids, one number.
        let book = || HymnbookInput { id: None, code: "SSS".into(), name: "Sacred Songs and Solos".into(), language: "en".into(), publisher: String::new(), licence_note: String::new() };
        let a = ContentDb::open_in_memory().unwrap();
        let b = ContentDb::open_in_memory().unwrap();
        for db in [&a, &b] {
            let sss = db.upsert_hymnbook(&book()).unwrap();
            let mut ag = amazing_grace();
            ag.numbers = vec![HymnNumberInput { hymnbook_id: sss.id, number: "245".into() }];
            db.create_song(&ag).unwrap();
        }
        let r = b.import_songs(&a.export_songs(None).unwrap(), ImportMode::Skip).unwrap();
        assert_eq!((r.added, r.numbers_skipped), (1, 1));
        assert_eq!(b.list_songs(Some("SSS 245"), 5).unwrap().len(), 1, "the number stays with the song that had it");
    }

    #[test]
    fn import_modes_and_atomicity() {
        let db = ContentDb::open_in_memory().unwrap();
        let sss = db.upsert_hymnbook(&HymnbookInput { id: None, code: "SSS".into(), name: "Sacred Songs and Solos".into(), language: "en".into(), publisher: String::new(), licence_note: String::new() }).unwrap();
        let mut ag = amazing_grace();
        ag.numbers = vec![HymnNumberInput { hymnbook_id: sss.id.clone(), number: "245".into() }];
        let ag = db.create_song(&ag).unwrap();
        db.create_song(&with_chorus()).unwrap();
        let export = db.export_songs(None).unwrap();
        assert_eq!((export.version, export.songs.len(), export.hymnbooks.len()), (1, 2, 1));
        let subset = db.export_songs(Some(std::slice::from_ref(&ag.song.id))).unwrap();
        assert_eq!(subset.songs.len(), 1);

        // Fresh database: everything imported, hymnbook recreated and numbers kept.
        let fresh = ContentDb::open_in_memory().unwrap();
        let r = fresh.import_songs(&export, ImportMode::Skip).unwrap();
        assert_eq!((r.added, r.hymnbooks_added), (2, 1));
        let got = fresh.get_song(&ag.song.id).unwrap().unwrap();
        assert_eq!(got.numbers[0].number, "245");
        assert_eq!(got.sections.len(), 2);
        assert_eq!(got.arrangements[0].sequence.len(), 2);
        assert_eq!(fresh.list_songs(Some("SSS 245"), 5).unwrap().len(), 1);

        // Same file again: Skip, Replace, Duplicate.
        assert_eq!(fresh.import_songs(&export, ImportMode::Skip).unwrap().skipped, 2);
        let mut changed = export.clone();
        changed.songs[0].song.title = "Amazing Grace (edited)".into();
        let r = fresh.import_songs(&changed, ImportMode::Replace).unwrap();
        assert_eq!(r.replaced, 2);
        assert_eq!(fresh.get_song(&ag.song.id).unwrap().unwrap().song.title, "Amazing Grace (edited)");
        let r = fresh.import_songs(&export, ImportMode::Duplicate).unwrap();
        assert_eq!(r.added, 2);
        assert_eq!(fresh.list_songs(None, 50).unwrap().len(), 4);
        let dup = fresh.list_songs(Some("amazing"), 10).unwrap();
        assert_eq!(dup.len(), 2);
        let dup_full = fresh.get_song(dup.iter().find(|s| s.id != ag.song.id).unwrap().id.as_str()).unwrap().unwrap();
        assert_eq!(dup_full.arrangements[0].sequence, dup_full.sections.iter().map(|s| s.id.clone()).collect::<Vec<_>>(), "duplicate's arrangement points at its own sections");
        assert!(dup_full.numbers.is_empty(), "the original keeps SSS 245");
        assert_eq!(fresh.get_song(&ag.song.id).unwrap().unwrap().numbers.len(), 1);

        // Atomic: an invalid song in the middle aborts the whole import.
        let empty = ContentDb::open_in_memory().unwrap();
        let mut broken = export.clone();
        broken.songs[1].song.licence = "stolen".into();
        assert!(matches!(empty.import_songs(&broken, ImportMode::Skip), Err(ContentError::Invalid(_))));
        assert_eq!(empty.list_songs(None, 10).unwrap().len(), 0);
        assert_eq!(empty.list_hymnbooks().unwrap().len(), 0);
        broken.version = 2;
        assert!(matches!(empty.import_songs(&broken, ImportMode::Skip), Err(ContentError::Invalid(_))));
    }

    #[test]
    fn validation() {
        let db = ContentDb::open_in_memory().unwrap();
        let ok = amazing_grace();
        let cases: Vec<(&str, SongInput)> = vec![
            ("empty title", SongInput { title: "  ".into(), ..ok.clone() }),
            ("bad licence", SongInput { licence: "free".into(), ..ok.clone() }),
            ("ccli letters", SongInput { ccli_number: Some("12a".into()), ..ok.clone() }),
            ("bad language", SongInput { primary_language: "English".into(), ..ok.clone() }),
            ("bad kind", SongInput { sections: vec![sec("stanza", "x", None)], ..ok.clone() }),
            ("bad text lang", SongInput { sections: vec![SectionInput { kind: "verse".into(), texts: BTreeMap::from([("Yoruba".to_string(), "x".to_string())]), ..SectionInput::default() }], ..ok.clone() }),
            ("foreign section in arrangement", SongInput { arrangements: vec![ArrangementInput { name: "A".into(), sequence: vec!["someone-elses".into()], ..ArrangementInput::default() }], ..ok.clone() }),
            ("two defaults", SongInput {
                sections: vec![SectionInput { id: Some("s1".into()), ..sec("verse", "x", None) }],
                arrangements: vec![
                    ArrangementInput { name: "A".into(), sequence: vec!["s1".into()], is_default: true, id: None },
                    ArrangementInput { name: "B".into(), sequence: vec!["s1".into()], is_default: true, id: None },
                ],
                ..ok.clone()
            }),
            ("hymn number abc", SongInput { numbers: vec![HymnNumberInput { hymnbook_id: "book".into(), number: "abc".into() }], ..ok.clone() }),
            ("missing book", SongInput { numbers: vec![HymnNumberInput { hymnbook_id: "no-such-book".into(), number: "1".into() }], ..ok.clone() }),
            ("long body", SongInput { sections: vec![sec("verse", &"x".repeat(4001), None)], ..ok.clone() }),
        ];
        for (name, input) in cases {
            assert!(matches!(db.create_song(&input), Err(ContentError::Invalid(_))), "{name}");
        }
        assert!(db.list_songs(None, 10).unwrap().is_empty(), "nothing partially written");
        assert!(matches!(db.upsert_hymnbook(&HymnbookInput { id: None, code: "S S".into(), name: "x".into(), language: "en".into(), publisher: String::new(), licence_note: String::new() }), Err(ContentError::Invalid(_))));
    }

    #[test]
    fn helpers() {
        assert_eq!(parse_hymn_number("245"), Some((None, "245".into())));
        assert_eq!(parse_hymn_number("SSS 245"), Some((Some("SSS".into()), "245".into())));
        assert_eq!(parse_hymn_number("sss245a"), Some((Some("SSS".into()), "245a".into())));
        assert_eq!(parse_hymn_number("#12"), Some((None, "12".into())));
        assert_eq!(parse_hymn_number("amazing grace"), None);
        assert_eq!(parse_hymn_number("245 grace"), None);
        assert_eq!(parse_hymn_number("1 John 1:1"), None);
        assert_eq!(parse_hymn_number("123456"), None);
        assert_eq!(fold("Ọlọ́run Ṣe"), "Olorun Se");
        // Typed with the accent built into the letter (NFC) or as separate marks (NFD): the same.
        assert_eq!(fold("Àánú"), "Aanu");
        assert_eq!(fold("A\u{300}a\u{301}nu\u{301}"), "Aanu");
        assert_eq!(title_sort("Àánú Ọlọ́run"), "aanu olorun");
        assert_eq!(fts_query("amazing gra"), "\"amazing\" \"gra\"*");
        assert_eq!(fts_query("say \"hi\""), "\"say\" \"\"\"hi\"\"\"*");
        assert!(is_language_tag("en") && is_language_tag("yo") && is_language_tag("en-GB"));
        assert!(!is_language_tag("English") && !is_language_tag("e") && !is_language_tag("en-"));
        assert_eq!(title_sort("The Old Rugged Cross"), "old rugged cross");
    }

    #[test]
    fn migration_0003_on_a_0002_file_keeps_programs_and_backs_up_once() {
        let dir = std::env::temp_dir().join(format!("rhema-songs-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("studio.db");
        let pid = {
            let db = ContentDb::open_with_migrations(&path, &crate::MIGRATIONS[..2]).unwrap();
            let p = db.create_program("Old", None).unwrap();
            // The 0002 schema has no payload column: write the item the old way.
            db.lock()
                .unwrap()
                .execute(
                    "INSERT INTO program_items (id, program_id, position, kind, reference, book_number, chapter, verse, translation)
                     VALUES ('old-item', ?1, 0, 'verse', 'John 3:16', 43, 3, 16, 'KJV')",
                    params![p.id],
                )
                .unwrap();
            p.id
        };
        let db = ContentDb::open(&path).unwrap();
        assert!(db.applied_migrations().unwrap().iter().any(|m| m == "0003_songs"));
        let backup = db.last_backup().unwrap().to_path_buf();
        assert!(backup.to_string_lossy().contains("before-0003_songs"));
        let got = db.get_program(&pid).unwrap().unwrap();
        assert_eq!(got.items[0].translation.as_deref(), Some("KJV"));
        assert_eq!(got.items[0].payload, None);
        let s = db.create_song(&amazing_grace()).unwrap();
        assert_eq!(db.list_songs(Some("grace"), 5).unwrap()[0].id, s.song.id);
        drop(db);
        let db = ContentDb::open(&path).unwrap();
        assert!(db.last_backup().is_none());
        assert_eq!(db.get_song(&s.song.id).unwrap().unwrap().sections.len(), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
