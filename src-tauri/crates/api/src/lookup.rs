//! Looking things up in the host's own library from a joined desk (desk consoles, #197): its Bible
//! translations, a chapter for a passage preview, a words search, and its songs and hymns. Read only:
//! nothing here changes the service or a screen. Each lookup needs a paired key whose role works
//! with that content (`Lookup::allowed`); the app answers it (`CommandSink::lookup`).

use serde::Deserialize;

use crate::keys::Role;

/// The most results a desk is sent for one search.
pub const MAX_RESULTS: usize = 25;

/// One lookup, as a desk sends it (`{"what": "search", "query": "love", "translation": 1}`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "what", rename_all = "snake_case")]
pub enum Lookup {
    /// The host's Bible translations: id, abbreviation, name, language.
    Translations,
    /// One chapter of one book in one translation (a passage preview).
    Chapter { translation: i64, book: i32, chapter: i32 },
    /// Verses with these words in one translation.
    Search { query: String, translation: i64 },
    /// Songs and hymns by title, words or hymn number ("CAC 245"); empty: the first by title.
    Songs { #[serde(default)] query: String },
}

impl Lookup {
    /// Whether a desk with this role may look this up: the Bible for the Bible desk, the songs for
    /// the worship desk, both for the Present desks and the editor (who prepares). Never the others.
    #[must_use]
    pub fn allowed(&self, role: Role) -> bool {
        match self {
            Lookup::Translations | Lookup::Chapter { .. } | Lookup::Search { .. } => matches!(role, Role::Present | Role::Configure | Role::Bible | Role::Editor),
            Lookup::Songs { .. } => matches!(role, Role::Present | Role::Configure | Role::Worship | Role::Editor),
        }
    }

    /// The lookup made safe to pass on: a query of one short line, a book and chapter in range.
    /// None when there is nothing sensible to look up.
    #[must_use]
    pub fn checked(self) -> Option<Self> {
        let line = |q: &str| q.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(120).collect::<String>();
        match self {
            Lookup::Chapter { translation, book, chapter } => ((1..=200).contains(&book) && (1..=200).contains(&chapter)).then_some(Lookup::Chapter { translation, book, chapter }),
            Lookup::Search { query, translation } => {
                let query = line(&query);
                (query.chars().count() >= 2).then_some(Lookup::Search { query, translation })
            }
            Lookup::Songs { query } => Some(Lookup::Songs { query: line(&query) }),
            Lookup::Translations => Some(Lookup::Translations),
        }
    }
}

/// Why a desk was refused a lookup, in words for the person at that desk.
#[must_use]
pub fn refusal(lookup: &Lookup) -> &'static str {
    match lookup {
        Lookup::Songs { .. } => "this device may not look in the host's song library",
        _ => "this device may not look in the host's Bible",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_desk_looks_only_in_its_own_library() {
        let bible = [Lookup::Translations, Lookup::Chapter { translation: 1, book: 43, chapter: 3 }, Lookup::Search { query: "love".into(), translation: 1 }];
        let songs = Lookup::Songs { query: "CAC 245".into() };
        for role in [Role::Bible, Role::Present, Role::Configure, Role::Editor] {
            assert!(bible.iter().all(|l| l.allowed(role)), "{role:?}");
        }
        for role in [Role::Worship, Role::Stage, Role::Screens, Role::Timekeeper, Role::Camera, Role::Obs, Role::ObsCompanion, Role::Viewer] {
            assert!(bible.iter().all(|l| !l.allowed(role)), "{role:?}");
        }
        for role in [Role::Worship, Role::Present, Role::Configure, Role::Editor] {
            assert!(songs.allowed(role), "{role:?}");
        }
        for role in [Role::Bible, Role::Stage, Role::Screens, Role::Timekeeper, Role::Camera, Role::Obs, Role::ObsCompanion, Role::Viewer] {
            assert!(!songs.allowed(role), "{role:?}");
        }
    }

    #[test]
    fn lookups_parse_and_are_made_safe() {
        let l: Lookup = serde_json::from_str(r#"{"what":"search","query":"  God   so\nloved ","translation":2}"#).unwrap();
        assert_eq!(l.checked(), Some(Lookup::Search { query: "God so loved".into(), translation: 2 }));
        assert_eq!(Lookup::Search { query: "a".into(), translation: 1 }.checked(), None, "one letter finds everything");
        let long = Lookup::Songs { query: "x".repeat(500) }.checked();
        assert!(matches!(long, Some(Lookup::Songs { ref query }) if query.len() == 120));
        assert_eq!(serde_json::from_str::<Lookup>(r#"{"what":"songs"}"#).unwrap(), Lookup::Songs { query: String::new() });
        assert_eq!(Lookup::Chapter { translation: 1, book: 0, chapter: 1 }.checked(), None);
        assert_eq!(Lookup::Chapter { translation: 1, book: 43, chapter: 999 }.checked(), None);
        assert!(serde_json::from_str::<Lookup>(r#"{"what":"delete_everything"}"#).is_err());
        assert!(serde_json::from_str::<Lookup>(r#"{"what":"chapter","translation":"KJV","book":1,"chapter":1}"#).is_err());
    }
}
