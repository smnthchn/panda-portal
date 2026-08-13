-- Where to actually park. The venue address gets you to the building; the
-- loading dock or the staff lot is usually somewhere else entirely, so it
-- needs its own pin rather than a sentence in the notes.

ALTER TABLE conventions ADD COLUMN parking_map_url TEXT;
