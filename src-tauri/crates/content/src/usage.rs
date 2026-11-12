//! Song usage for licence reporting (PRD FR-09 "song usage"; CCLI-style
//! reports). `song_usage` counts saved services dated in a range (the plan);
//! `song_usage_shown` counts service runs whose journal put the song on screen.

use std::collections::{BTreeSet, HashMap, HashSet};

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::{ContentDb, ContentError, Result};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SongUsage {
    pub song_id: String,
    /// The library title, or the title saved in the service if the song was since deleted.
    pub title: String,
    pub authors: String,
    /// Whether any saved item identified this as a hymn, or the library does.
    pub hymn: bool,
    /// Numbers captured in saved service items, or current library numbers for legacy items.
    pub hymn_numbers: Vec<String>,
    pub ccli_number: Option<String>,
    pub licence: String,
    /// Distinct services that used it (a song sung twice in one service counts once).
    pub services: i64,
    pub last_date: String,
}

fn is_iso_date(s: &str) -> bool {
    s.len() == 10 && s.as_bytes().iter().enumerate().all(|(i, b)| if i == 4 || i == 7 { *b == b'-' } else { b.is_ascii_digit() })
}

impl ContentDb {
    /// Songs in services dated `from`..=`to` (ISO dates), most used first.
    /// Services without a date, and templates, are not counted.
    pub fn song_usage(&self, from: &str, to: &str) -> Result<Vec<SongUsage>> {
        if !is_iso_date(from) || !is_iso_date(to) || from > to {
            return Err(ContentError::Invalid("give a date range as YYYY-MM-DD, start first".into()));
        }
        let conn = self.lock()?;
        let mut st = conn.prepare(
            "SELECT json_extract(i.payload, '$.song_id') AS sid,
                    COALESCE(s.title, MAX(i.reference)), COALESCE(s.authors, ''), s.ccli_number, COALESCE(s.licence, 'unknown'),
                    COUNT(DISTINCT p.id), MAX(p.service_date),
                    CASE
                      WHEN MAX(CASE WHEN json_type(i.payload, '$.hymn') = 'true' THEN 1 ELSE 0 END) = 1 THEN 1
                      WHEN MAX(CASE WHEN json_type(i.payload, '$.hymn') = 'false' THEN 1 ELSE 0 END) = 1 THEN 0
                      ELSE MAX(CASE
                        WHEN EXISTS (
                          SELECT 1 FROM json_each(i.payload, '$.hymn_numbers') j
                           WHERE j.type = 'text' AND length(trim(j.value)) > 0
                        ) THEN 1
                        WHEN instr(',' || lower(COALESCE(s.tags, '')) || ',', ',cacghb,') > 0 THEN 1
                        WHEN EXISTS (SELECT 1 FROM hymn_numbers hn WHERE hn.song_id = json_extract(i.payload, '$.song_id')) THEN 1
                        ELSE 0 END)
                    END,
                    CASE WHEN EXISTS (
                      SELECT 1 FROM program_items si JOIN programs sp ON sp.id = si.program_id
                       WHERE json_extract(si.payload, '$.song_id') = json_extract(i.payload, '$.song_id')
                         AND json_type(si.payload, '$.hymn_numbers') = 'array'
                         AND sp.service_date BETWEEN ?1 AND ?2 AND sp.is_template = 0
                         AND COALESCE(json_extract(si.payload, '$.hidden'), 0) = 0
                    ) THEN COALESCE((SELECT group_concat(value, '; ') FROM (
                      SELECT DISTINCT j.value AS value
                        FROM program_items hi
                        JOIN programs hp ON hp.id = hi.program_id
                        JOIN json_each(hi.payload, '$.hymn_numbers') j
                       WHERE json_extract(hi.payload, '$.song_id') = json_extract(i.payload, '$.song_id')
                         AND COALESCE(json_type(hi.payload, '$.hymn'), '') != 'false'
                         AND hp.service_date BETWEEN ?1 AND ?2 AND hp.is_template = 0
                         AND COALESCE(json_extract(hi.payload, '$.hidden'), 0) = 0
                         AND j.type = 'text' AND length(trim(j.value)) > 0
                       ORDER BY value COLLATE NOCASE
                    )), '')
                    WHEN EXISTS (
                      SELECT 1 FROM program_items fi JOIN programs fp ON fp.id = fi.program_id
                       WHERE json_extract(fi.payload, '$.song_id') = json_extract(i.payload, '$.song_id')
                         AND json_type(fi.payload, '$.hymn') = 'false'
                         AND fp.service_date BETWEEN ?1 AND ?2 AND fp.is_template = 0
                         AND COALESCE(json_extract(fi.payload, '$.hidden'), 0) = 0
                    ) AND NOT EXISTS (
                      SELECT 1 FROM program_items ti JOIN programs tp ON tp.id = ti.program_id
                       WHERE json_extract(ti.payload, '$.song_id') = json_extract(i.payload, '$.song_id')
                         AND json_type(ti.payload, '$.hymn') = 'true'
                         AND tp.service_date BETWEEN ?1 AND ?2 AND tp.is_template = 0
                         AND COALESCE(json_extract(ti.payload, '$.hidden'), 0) = 0
                    ) THEN ''
                    ELSE COALESCE((SELECT group_concat(value, '; ') FROM (
                      SELECT DISTINCT h.code || ' ' || hn.number AS value
                        FROM hymn_numbers hn JOIN hymnbooks h ON h.id = hn.hymnbook_id
                       WHERE hn.song_id = json_extract(i.payload, '$.song_id')
                       ORDER BY value COLLATE NOCASE
                    )), '') END
               FROM program_items i
               JOIN programs p ON p.id = i.program_id
               LEFT JOIN songs s ON s.id = json_extract(i.payload, '$.song_id')
              WHERE i.kind = 'song' AND p.service_date BETWEEN ?1 AND ?2 AND sid IS NOT NULL AND p.is_template = 0
                -- A hidden item (a backup song kept in the service, skipped in Live) was not sung (#411).
                AND COALESCE(json_extract(i.payload, '$.hidden'), 0) = 0
              GROUP BY sid
              ORDER BY COUNT(DISTINCT p.id) DESC, 2 COLLATE NOCASE",
        )?;
        let rows = st.query_map(params![from, to], |r| {
            Ok(SongUsage {
                song_id: r.get(0)?,
                title: r.get(1)?,
                authors: r.get(2)?,
                ccli_number: r.get(3)?,
                licence: r.get(4)?,
                services: r.get(5)?,
                last_date: r.get(6)?,
                hymn: r.get::<_, i64>(7)? != 0,
                hymn_numbers: r.get::<_, String>(8)?.split("; ").filter(|n| !n.is_empty()).map(str::to_string).collect(),
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }
}

/// One song item of a service, as the run's plan saved it.
struct PlannedSong {
    song_id: String,
    reference: String,
    hymn: Option<bool>,
    hymn_numbers: Option<Vec<String>>,
}

fn planned_song(kind: &str, reference: &str, payload: Option<&str>) -> Option<PlannedSong> {
    if kind != "song" {
        return None;
    }
    let payload: serde_json::Value = serde_json::from_str(payload?).ok()?;
    let song_id = payload.get("song_id")?.as_str()?.to_string();
    let hymn = payload.get("hymn").and_then(serde_json::Value::as_bool);
    let hymn_numbers = payload.get("hymn_numbers").and_then(serde_json::Value::as_array).map(|numbers| {
        numbers.iter().filter_map(serde_json::Value::as_str).map(str::trim).filter(|n| !n.is_empty()).map(str::to_string).collect()
    });
    Some(PlannedSong { song_id, reference: reference.to_string(), hymn, hymn_numbers })
}

/// The ids of the items that went live (or were put back on screen after a recovery) during a run.
/// Rehearsal is never journalled, so it is not counted.
fn shown_item_ids(checkpoint: &serde_json::Value) -> HashSet<String> {
    checkpoint
        .get("entries")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter(|entry| matches!(entry.get("kind").and_then(serde_json::Value::as_str), Some("live" | "restore")))
        .filter_map(|entry| entry.get("itemId").and_then(serde_json::Value::as_str).map(str::to_string))
        .collect()
}

#[derive(Default)]
struct ShownTally {
    runs: HashSet<String>,
    last_date: String,
    reference: String,
    hymn: Option<bool>,
    numbers: BTreeSet<String>,
}

impl ContentDb {
    /// Songs **shown on screen** during service runs dated `from`..=`to` (#843 S19): each run's
    /// journal says which items went live, and the run's own plan (the saved revision it ran, or
    /// the service's items when that revision is gone) says which of them were songs. `services`
    /// is the number of runs that showed the song. A run's date is its service date, or the day
    /// it started. This is what a licence report needs; `song_usage` counts the plan instead.
    pub fn song_usage_shown(&self, from: &str, to: &str) -> Result<Vec<SongUsage>> {
        if !is_iso_date(from) || !is_iso_date(to) || from > to {
            return Err(ContentError::Invalid("give a date range as YYYY-MM-DD, start first".into()));
        }
        let conn = self.lock()?;
        let runs: Vec<(String, Option<String>, Option<i64>, String, String)> = {
            let mut st = conn.prepare(
                "SELECT run_id, program_id, program_revision, COALESCE(service_date, substr(started_at, 1, 10)) AS d, checkpoint_json
                   FROM service_runs WHERE d BETWEEN ?1 AND ?2",
            )?;
            let rows = st.query_map(params![from, to], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        let mut tally: HashMap<String, ShownTally> = HashMap::new();
        for (run_id, program_id, revision, date, checkpoint_json) in runs {
            let Ok(checkpoint) = serde_json::from_str::<serde_json::Value>(&checkpoint_json) else { continue };
            let shown = shown_item_ids(&checkpoint);
            if shown.is_empty() {
                continue;
            }
            let Some(program_id) = program_id else { continue };
            // The plan the run used: its saved revision when kept, else the service as it is now.
            let mut items: HashMap<String, PlannedSong> = HashMap::new();
            let snapshot: Option<String> = match revision {
                Some(revision) => conn
                    .query_row("SELECT items FROM program_revisions WHERE program_id = ?1 AND revision = ?2", params![program_id, revision], |r| r.get(0))
                    .optional()?,
                None => None,
            };
            if let Some(snapshot) = snapshot.and_then(|json| serde_json::from_str::<Vec<crate::ItemInput>>(&json).ok()) {
                for item in snapshot {
                    if let (Some(id), Some(song)) = (item.id.clone(), planned_song(&item.kind, &item.reference, item.payload.as_deref())) {
                        items.insert(id, song);
                    }
                }
            } else {
                let mut st = conn.prepare("SELECT id, kind, reference, payload FROM program_items WHERE program_id = ?1")?;
                let rows = st.query_map(params![program_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<String>>(3)?)))?;
                for row in rows {
                    let (id, kind, reference, payload) = row?;
                    if let Some(song) = planned_song(&kind, &reference, payload.as_deref()) {
                        items.insert(id, song);
                    }
                }
            }
            for item_id in &shown {
                let Some(song) = items.get(item_id) else { continue };
                let entry = tally.entry(song.song_id.clone()).or_default();
                entry.runs.insert(run_id.clone());
                if date > entry.last_date {
                    entry.last_date.clone_from(&date);
                }
                if entry.reference.is_empty() {
                    entry.reference.clone_from(&song.reference);
                }
                entry.hymn = match (entry.hymn, song.hymn) {
                    (Some(true), _) | (_, Some(true)) => Some(true),
                    (Some(false), _) | (_, Some(false)) => Some(false),
                    _ => None,
                };
                if let Some(numbers) = &song.hymn_numbers {
                    entry.numbers.extend(numbers.iter().cloned());
                }
            }
        }
        let mut out = Vec::with_capacity(tally.len());
        for (song_id, t) in tally {
            let library: Option<(String, String, Option<String>, String, String)> = conn
                .query_row(
                    "SELECT title, authors, ccli_number, licence, COALESCE(tags, '') FROM songs WHERE id = ?1",
                    params![song_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
                )
                .optional()?;
            let library_numbers: Vec<String> = {
                let mut st = conn.prepare(
                    "SELECT DISTINCT h.code || ' ' || hn.number FROM hymn_numbers hn JOIN hymnbooks h ON h.id = hn.hymnbook_id WHERE hn.song_id = ?1 ORDER BY 1 COLLATE NOCASE",
                )?;
                let rows = st.query_map(params![song_id], |r| r.get(0))?;
                rows.collect::<std::result::Result<_, _>>()?
            };
            let tagged_hymn = library.as_ref().is_some_and(|l| l.4.to_lowercase().split(',').any(|tag| tag.trim() == "cacghb"));
            // Numbers the service saved win; a legacy item without them falls back to the library's.
            let saved_numbers: Vec<String> = t.numbers.into_iter().collect();
            let hymn = t.hymn.unwrap_or(!saved_numbers.is_empty() || tagged_hymn || !library_numbers.is_empty());
            let hymn_numbers = if !hymn { Vec::new() } else if saved_numbers.is_empty() { library_numbers } else { saved_numbers };
            let (title, authors, ccli_number, licence) = match library {
                Some((title, authors, ccli, licence, _)) => (title, authors, ccli, licence),
                None => (t.reference, String::new(), None, "unknown".to_string()),
            };
            out.push(SongUsage {
                song_id,
                title,
                authors,
                hymn,
                hymn_numbers,
                ccli_number,
                licence,
                services: i64::try_from(t.runs.len()).unwrap_or(i64::MAX),
                last_date: t.last_date,
            });
        }
        out.sort_by(|a, b| b.services.cmp(&a.services).then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase())));
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use crate::{ContentDb, HymnbookInput, HymnNumberInput, ItemInput, SectionInput, SongInput};

    fn song(db: &ContentDb, title: &str, ccli: Option<&str>) -> String {
        let input = SongInput {
            title: title.into(),
            ccli_number: ccli.map(Into::into),
            sections: vec![SectionInput { id: None, kind: "verse".into(), label: "Verse 1".into(), texts: [("en".to_string(), "words".to_string())].into() }],
            ..SongInput::default()
        };
        db.create_song(&input).unwrap().song.id
    }

    fn service(db: &ContentDb, date: Option<&str>, songs: &[&str]) {
        let p = db.create_program("Service", date).unwrap();
        let items: Vec<ItemInput> = songs
            .iter()
            .map(|id| ItemInput { kind: "song".into(), reference: "x".into(), payload: Some(format!(r#"{{"song_id":"{id}","languages":["en"]}}"#)), ..ItemInput::default() })
            .collect();
        db.replace_items(&p.id, p.revision, &items).unwrap();
    }

    #[test]
    fn counts_services_per_song_in_the_range() {
        let db = ContentDb::open_in_memory().unwrap();
        let grace = song(&db, "Amazing Grace", Some("22025"));
        let holy = song(&db, "Holy, Holy, Holy", None);
        service(&db, Some("2026-10-04"), &[&grace, &holy, &grace]);
        service(&db, Some("2026-10-11"), &[&grace]);
        service(&db, Some("2026-11-01"), &[&holy]);
        service(&db, None, &[&holy]);

        let u = db.song_usage("2026-10-01", "2026-10-31").unwrap();
        let got: Vec<(&str, Option<&str>, i64, &str)> = u.iter().map(|s| (s.title.as_str(), s.ccli_number.as_deref(), s.services, s.last_date.as_str())).collect();
        assert_eq!(got, vec![("Amazing Grace", Some("22025"), 2, "2026-10-11"), ("Holy, Holy, Holy", None, 1, "2026-10-04")]);
        assert!(!u[0].hymn);
        assert!(db.song_usage("2026-10-31", "2026-10-01").is_err());
        assert!(db.song_usage("Oct 1", "2026-10-31").is_err());
    }

    #[test]
    fn a_hidden_backup_song_is_not_counted_as_sung() {
        let db = ContentDb::open_in_memory().unwrap();
        let grace = song(&db, "Amazing Grace", Some("22025"));
        let backup = song(&db, "Backup Song", Some("11111"));
        let p = db.create_program("Service", Some("2026-10-18")).unwrap();
        let item = |id: &str, hidden: bool| ItemInput { kind: "song".into(), reference: "x".into(), payload: Some(format!(r#"{{"song_id":"{id}","hidden":{hidden}}}"#)), ..ItemInput::default() };
        db.replace_items(&p.id, p.revision, &[item(&grace, false), item(&backup, true)]).unwrap();
        let titles: Vec<String> = db.song_usage("2026-10-01", "2026-10-31").unwrap().into_iter().map(|u| u.title).collect();
        assert_eq!(titles, vec!["Amazing Grace".to_string()]);
    }

    #[test]
    fn retains_hymn_numbers_from_the_saved_service() {
        let db = ContentDb::open_in_memory().unwrap();
        let grace = song(&db, "Amazing Grace", None);
        let p = db.create_program("Service", Some("2026-10-18")).unwrap();
        db.replace_items(
            &p.id,
            p.revision,
            &[ItemInput {
                kind: "song".into(),
                reference: "Amazing Grace".into(),
                payload: Some(format!(r#"{{"song_id":"{grace}","hymn":true,"hymn_numbers":["CAC 245"]}}"#)),
                ..ItemInput::default()
            }],
        )
        .unwrap();

        let usage = db.song_usage("2026-10-01", "2026-10-31").unwrap();
        assert!(usage[0].hymn);
        assert_eq!(usage[0].hymn_numbers, vec!["CAC 245"]);
    }

    #[test]
    fn explicit_song_snapshot_wins_over_legacy_library_fallback() {
        let db = ContentDb::open_in_memory().unwrap();
        let book = db.upsert_hymnbook(&HymnbookInput {
            id: None,
            code: "CAC".into(),
            name: "CAC Gospel Hymn Book".into(),
            language: "en".into(),
            publisher: String::new(),
            licence_note: String::new(),
        }).unwrap();
        let song_id = db.create_song(&SongInput {
            title: "Ordinary Song".into(),
            sections: vec![SectionInput { id: None, kind: "verse".into(), label: "Verse 1".into(), texts: [("en".to_string(), "words".to_string())].into() }],
            numbers: vec![HymnNumberInput { hymnbook_id: book.id, number: "245".into() }],
            ..SongInput::default()
        }).unwrap().song.id;
        service(&db, Some("2026-10-17"), &[&song_id]);
        let program = db.create_program("Service", Some("2026-10-18")).unwrap();
        db.replace_items(
            &program.id,
            program.revision,
            &[ItemInput {
                kind: "song".into(),
                reference: "Ordinary Song".into(),
                payload: Some(format!(r#"{{"song_id":"{song_id}","hymn":false,"hymn_numbers":[]}}"#)),
                ..ItemInput::default()
            }],
        ).unwrap();

        let usage = db.song_usage("2026-10-01", "2026-10-31").unwrap();
        assert!(!usage[0].hymn);
        assert_eq!(usage[0].hymn_numbers, Vec::<String>::new());
    }

    #[test]
    fn ignores_non_text_or_blank_saved_hymn_numbers() {
        let db = ContentDb::open_in_memory().unwrap();
        let ordinary = song(&db, "Ordinary Song", None);
        let p = db.create_program("Service", Some("2026-10-18")).unwrap();
        db.replace_items(
            &p.id,
            p.revision,
            &[ItemInput {
                kind: "song".into(),
                reference: "Ordinary Song".into(),
                payload: Some(format!(r#"{{"song_id":"{ordinary}","hymn_numbers":[245,null," "]}}"#)),
                ..ItemInput::default()
            }],
        ).unwrap();

        let usage = db.song_usage("2026-10-01", "2026-10-31").unwrap();
        assert!(!usage[0].hymn);
        assert_eq!(usage[0].hymn_numbers, Vec::<String>::new());
    }

    #[test]
    fn legacy_service_items_fall_back_to_library_hymn_numbers() {
        let db = ContentDb::open_in_memory().unwrap();
        let book = db.upsert_hymnbook(&HymnbookInput {
            id: None,
            code: "SSS".into(),
            name: "Sacred Songs and Solos".into(),
            language: "en".into(),
            publisher: String::new(),
            licence_note: String::new(),
        }).unwrap();
        let hymn = db.create_song(&SongInput {
            title: "Amazing Grace".into(),
            sections: vec![SectionInput { id: None, kind: "verse".into(), label: "Verse 1".into(), texts: [("en".to_string(), "words".to_string())].into() }],
            numbers: vec![HymnNumberInput { hymnbook_id: book.id, number: "245".into() }],
            ..SongInput::default()
        }).unwrap().song.id;
        service(&db, Some("2026-10-18"), &[&hymn]);

        let usage = db.song_usage("2026-10-01", "2026-10-31").unwrap();
        assert!(usage[0].hymn);
        assert_eq!(usage[0].hymn_numbers, vec!["SSS 245"]);
    }

    // ── #843 S19: counted from what the run journal says went on screen ──

    fn song_item(item_id: &str, song_id: &str, payload_extra: &str) -> ItemInput {
        ItemInput {
            id: Some(item_id.into()),
            kind: "song".into(),
            reference: format!("Saved title {item_id}"),
            payload: Some(format!(r#"{{"song_id":"{song_id}"{payload_extra}}}"#)),
            ..ItemInput::default()
        }
    }

    fn run(db: &ContentDb, run_id: &str, program: &crate::ProgramWithItems, date: Option<&str>, shown: &[&str]) {
        let entries: Vec<serde_json::Value> = shown
            .iter()
            .enumerate()
            .map(|(i, id)| serde_json::json!({ "at": 1_000 + i, "mono": i, "kind": "live", "label": "x", "itemId": id }))
            .chain(std::iter::once(serde_json::json!({ "at": 5_000, "mono": 9, "kind": "clear", "label": "x", "itemId": "never-live" })))
            .collect();
        db.checkpoint_service_run(&crate::ServiceRunCheckpoint {
            run_id: run_id.into(),
            program_id: Some(program.program.id.clone()),
            program_revision: Some(program.program.revision),
            service_date: date.map(Into::into),
            title: "Sunday".into(),
            time_zone: None,
            started_at: "2026-10-04T09:00:00Z".into(),
            checkpoint: serde_json::json!({ "version": 1, "entries": entries }),
        })
        .unwrap();
    }

    #[test]
    fn shown_usage_counts_runs_that_put_the_song_on_screen_not_the_plan() {
        let db = ContentDb::open_in_memory().unwrap();
        let grace = song(&db, "Amazing Grace", Some("22025"));
        let holy = song(&db, "Holy, Holy, Holy", None);
        let backup = song(&db, "Backup Song", Some("11111"));
        let p = db.create_program("Service", Some("2026-10-04")).unwrap();
        let saved = db.replace_items(&p.id, p.revision, &[song_item("i-grace", &grace, ""), song_item("i-holy", &holy, ""), song_item("i-backup", &backup, "")]).unwrap();
        run(&db, "run-1", &saved, Some("2026-10-04"), &["i-grace", "i-grace"]);
        run(&db, "run-2", &saved, Some("2026-10-11"), &["i-grace", "i-holy"]);
        run(&db, "run-3", &saved, Some("2026-11-01"), &["i-holy"]);

        let shown = db.song_usage_shown("2026-10-01", "2026-10-31").unwrap();
        let got: Vec<(&str, i64, &str, Option<&str>)> = shown.iter().map(|u| (u.title.as_str(), u.services, u.last_date.as_str(), u.ccli_number.as_deref())).collect();
        assert_eq!(got, vec![("Amazing Grace", 2, "2026-10-11", Some("22025")), ("Holy, Holy, Holy", 1, "2026-10-11", None)]);
        // The plan-based report counts the backup song too, which was never shown.
        assert!(db.song_usage("2026-10-01", "2026-10-31").unwrap().iter().any(|u| u.title == "Backup Song"));
        assert!(db.song_usage_shown("2026-10-31", "2026-10-01").is_err());
    }

    #[test]
    fn shown_usage_reads_the_plan_the_run_used_even_after_the_service_changed() {
        let db = ContentDb::open_in_memory().unwrap();
        let grace = song(&db, "Amazing Grace", None);
        let p = db.create_program("Service", None).unwrap();
        let saved = db.replace_items(&p.id, p.revision, &[song_item("i-grace", &grace, r#","hymn":true,"hymn_numbers":["CAC 245"]"#)]).unwrap();
        // No service date: the run counts on the day it started.
        run(&db, "run-1", &saved, None, &["i-grace"]);
        // Afterwards the song is taken out of the service.
        db.replace_items(&p.id, saved.program.revision, &[]).unwrap();

        let shown = db.song_usage_shown("2026-10-01", "2026-10-31").unwrap();
        assert_eq!(shown.len(), 1);
        assert_eq!((shown[0].services, shown[0].last_date.as_str(), shown[0].hymn), (1, "2026-10-04", true));
        assert_eq!(shown[0].hymn_numbers, vec!["CAC 245"]);
    }
}
