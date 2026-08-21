-- People on the booth map.
--
-- The five standing positions — entrance, stager, cashier, and the aisle
-- coverage — exist for loss prevention as much as service, and they move when
-- the layout moves. So they're planned on the same map the shelves are: a
-- circle per person, placed per event.
CREATE TABLE IF NOT EXISTS booth_people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  convention_id INTEGER NOT NULL,
  label TEXT NOT NULL,                   -- 'Entrance', 'Cash', or a name

  -- Feet from the booth's top-left, like the shelves.
  x REAL NOT NULL DEFAULT 0.5,
  y REAL NOT NULL DEFAULT 0.5,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (convention_id) REFERENCES conventions(id)
);

CREATE INDEX IF NOT EXISTS idx_booth_people_convention
  ON booth_people (convention_id);
