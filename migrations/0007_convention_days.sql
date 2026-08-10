-- Hours of operation vary per day of an event, so each day carries its own
-- setup / early access / regular windows. All three are optional — a day might
-- have no early access, and the last day usually has shorter regular hours.
--
-- This is distinct from the convention-level setup_on + load_in window, which is
-- the move-in day before the show opens.

CREATE TABLE IF NOT EXISTS convention_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  convention_id INTEGER NOT NULL,
  day_date TEXT NOT NULL,
  setup_start TEXT,
  setup_end TEXT,
  early_start TEXT,
  early_end TEXT,
  regular_start TEXT,
  regular_end TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (convention_id, day_date),
  FOREIGN KEY (convention_id) REFERENCES conventions(id)
);

CREATE INDEX IF NOT EXISTS idx_convention_days_convention
  ON convention_days (convention_id);
