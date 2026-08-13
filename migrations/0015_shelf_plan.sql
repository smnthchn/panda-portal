-- The booth shelf plan: what stands where, what's on it, what signage it
-- needs, and how far through prep each unit is. Replaces the Google Sheet.

CREATE TABLE IF NOT EXISTS shelf_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  convention_id INTEGER NOT NULL,
  code TEXT NOT NULL,                    -- 'E4'
  wall TEXT NOT NULL,                    -- 'EAST WALL'
  wall_note TEXT,
  product TEXT,
  unit_type TEXT,                        -- tier count of the unit, not SKU size
  signage TEXT,                          -- comma-separated: fb,sb,bc,fc,sc
  board_name TEXT,                       -- board names, ' & '-separated
  kind TEXT NOT NULL DEFAULT 'shelf',    -- 'shelf' | 'other'
  sort_order INTEGER NOT NULL DEFAULT 0,

  -- Baseline geometry in feet from the booth's top-left.
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  w REAL NOT NULL DEFAULT 1.6667,
  h REAL NOT NULL DEFAULT 4.1667,

  -- Arrange overrides, kept separate from the baseline so a later change to
  -- the source dimensions isn't silently ignored. NULL means "use baseline".
  move_x REAL,
  move_y REAL,
  move_w REAL,
  move_h REAL,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (convention_id) REFERENCES conventions(id),
  UNIQUE (convention_id, code)
);

CREATE INDEX IF NOT EXISTS idx_shelf_positions_convention
  ON shelf_positions (convention_id);

-- One row per ticked stage rather than five columns or a bitfield: several
-- people tick boxes at once during setup, and a row write can't lose someone
-- else's tick the way a read-modify-write of a whole record would.
CREATE TABLE IF NOT EXISTS shelf_stage_flags (
  position_id INTEGER NOT NULL,
  stage INTEGER NOT NULL,                -- 0 sized, 1 product+, 2 prepped, 3 scanned, 4 boards
  done_by INTEGER,
  done_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (position_id, stage),
  FOREIGN KEY (position_id) REFERENCES shelf_positions(id),
  FOREIGN KEY (done_by) REFERENCES employees(id)
);
