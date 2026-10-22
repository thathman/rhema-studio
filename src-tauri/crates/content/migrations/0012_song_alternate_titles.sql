-- FR-02 'title, alternate titles': other names a song is known by (a hymn's
-- Yorùbá title, a first line people use as its name), one per line. Searched
-- with the title.
ALTER TABLE songs ADD COLUMN alternate_titles TEXT NOT NULL DEFAULT '';
