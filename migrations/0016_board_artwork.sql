-- Board artwork: what each printed sign actually looks like.
--
-- A board is a physical thing the store owns and hangs again at the next
-- show, so the artwork belongs to the store rather than to one event. It's
-- keyed by the board's name, which is what the booth plan already carries in
-- its Board name cell — upload the artwork once and every event whose plan
-- names that board has it.
--
-- name_key is the name folded to lower case with its spacing collapsed, so
-- "Gundam Back" and "gundam  back" are the same board. name keeps whatever
-- spelling was typed first, for display.
--
-- Stored as a data URI in a column, the same bargain as staff avatars: the
-- browser shrinks the picture before upload and the team is small, so this
-- beats standing up object storage. Served from /api/board-art/:id behind a
-- login rather than inlined into JSON.

CREATE TABLE IF NOT EXISTS board_artwork (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  image TEXT NOT NULL,
  uploaded_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (uploaded_by) REFERENCES employees(id)
);
