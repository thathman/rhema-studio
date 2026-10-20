-- Musical key and tempo for the band (shown on the stage display, never to the congregation).
ALTER TABLE songs ADD COLUMN key TEXT NOT NULL DEFAULT '';
ALTER TABLE songs ADD COLUMN tempo INTEGER;
