-- Files that belong with a song (chord chart, sheet music): links from a
-- song to a media asset. Removing the song or the asset removes the link.
CREATE TABLE IF NOT EXISTS song_attachments (
    song_id   TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    media_id  TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (song_id, media_id)
);
