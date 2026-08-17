-- Resources, board assignments and shelf photos.
--
-- Supersedes board_artwork from 0016, which paired artwork to a board by
-- matching its name. Pairing by name meant a typo in the plan silently lost
-- the artwork, and it gave nowhere to put a picture that isn't a board. The
-- library is now a plain list you upload to, rename and delete, and the plan
-- points at an entry explicitly.
--
-- 0016 shipped and was dropped the next day with no rows in it anywhere, so
-- there is nothing to carry across.

DROP TABLE IF EXISTS board_artwork;

-- The store's own library of images: board artwork, mostly. Store-wide on
-- purpose — a board is a physical sign that gets hung again at the next show,
-- so uploading it once is the whole point.
CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  image TEXT NOT NULL,
  uploaded_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (uploaded_by) REFERENCES employees(id)
);

-- Which library image is the board on one face of one shelf. A row per face
-- rather than a column per face, so a unit that grows a third board doesn't
-- need a migration.
CREATE TABLE IF NOT EXISTS shelf_board_art (
  position_id INTEGER NOT NULL,
  face TEXT NOT NULL,                    -- 'back' | 'side' | 'front'
  resource_id INTEGER NOT NULL,
  assigned_by INTEGER,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (position_id, face),
  FOREIGN KEY (position_id) REFERENCES shelf_positions(id),
  FOREIGN KEY (resource_id) REFERENCES resources(id),
  FOREIGN KEY (assigned_by) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_shelf_board_art_resource
  ON shelf_board_art (resource_id);

-- How a shelf was merchandised, photographed at the store before it was
-- packed. At the venue it's what you rebuild the shelf from.
--
-- Not the library: this is *this* shelf at *this* show, so it hangs off the
-- position, which is already per-event. Several angles per shelf, so a row
-- each rather than a column.
CREATE TABLE IF NOT EXISTS shelf_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id INTEGER NOT NULL,
  image TEXT NOT NULL,
  taken_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (position_id) REFERENCES shelf_positions(id),
  FOREIGN KEY (taken_by) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_shelf_photos_position
  ON shelf_photos (position_id);
