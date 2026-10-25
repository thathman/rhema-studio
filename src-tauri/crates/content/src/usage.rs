//! Song usage for licence reporting (PRD FR-09 "song usage"; CCLI-style
//! reports): how many saved services dated in a range used each song.

use rusqlite::params;
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
                    MAX(CASE
                      WHEN json_extract(i.payload, '$.hymn') = 1 THEN 1
                      WHEN EXISTS (SELECT 1 FROM json_each(i.payload, '$.hymn_numbers')) THEN 1
                      WHEN instr(',' || lower(COALESCE(s.tags, '')) || ',', ',cacghb,') > 0 THEN 1
                      WHEN EXISTS (SELECT 1 FROM hymn_numbers hn WHERE hn.song_id = json_extract(i.payload, '$.song_id')) THEN 1
                      ELSE 0 END),
                    COALESCE(
                      NULLIF((SELECT group_concat(value, '; ') FROM (
                        SELECT DISTINCT j.value AS value
                          FROM program_items hi
                          JOIN programs hp ON hp.id = hi.program_id
                          JOIN json_each(hi.payload, '$.hymn_numbers') j
                         WHERE json_extract(hi.payload, '$.song_id') = json_extract(i.payload, '$.song_id')
                           AND hp.service_date BETWEEN ?1 AND ?2 AND hp.is_template = 0 AND j.type = 'text'
                         ORDER BY value COLLATE NOCASE
                      )), ''),
                      NULLIF((SELECT group_concat(value, '; ') FROM (
                        SELECT DISTINCT h.code || ' ' || hn.number AS value
                          FROM hymn_numbers hn JOIN hymnbooks h ON h.id = hn.hymnbook_id
                         WHERE hn.song_id = json_extract(i.payload, '$.song_id')
                         ORDER BY value COLLATE NOCASE
                      )), ''), ''
                    )
               FROM program_items i
               JOIN programs p ON p.id = i.program_id
               LEFT JOIN songs s ON s.id = json_extract(i.payload, '$.song_id')
              WHERE i.kind = 'song' AND p.service_date BETWEEN ?1 AND ?2 AND sid IS NOT NULL AND p.is_template = 0
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
}
