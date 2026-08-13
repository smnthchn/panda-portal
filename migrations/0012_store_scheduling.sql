-- Day-to-day scheduling for ordinary store days.
--
-- Shifts were only ever a convention thing, so a normal Tuesday had nowhere
-- to record who's working. Rather than a second kind of shift — which would
-- fork the roster, the clock, the staff page and the dashboard — a shift now
-- simply doesn't have to belong to an event. NULL convention_id means the
-- store. SQLite can't drop a NOT NULL in place, so the table is rebuilt.

CREATE TABLE convention_shifts_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  convention_id INTEGER,
  employee_id INTEGER,
  title TEXT NOT NULL,
  shift_date TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  break_allotment_minutes INTEGER NOT NULL DEFAULT 0,
  break_count INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (convention_id) REFERENCES conventions(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

INSERT INTO convention_shifts_new
  (id, convention_id, employee_id, title, shift_date, starts_at, ends_at,
   notes, created_at, break_allotment_minutes, break_count)
SELECT
   id, convention_id, employee_id, title, shift_date, starts_at, ends_at,
   notes, created_at, break_allotment_minutes, break_count
FROM convention_shifts;

DROP TABLE convention_shifts;

ALTER TABLE convention_shifts_new RENAME TO convention_shifts;

CREATE INDEX IF NOT EXISTS idx_shifts_convention ON convention_shifts (convention_id);
CREATE INDEX IF NOT EXISTS idx_shifts_employee ON convention_shifts (employee_id);
CREATE INDEX IF NOT EXISTS idx_shifts_date ON convention_shifts (shift_date);

-- The store's usual hours, one row per weekday (0 = Sunday). These drive the
-- same coverage check the convention builder does, so a Saturday with nobody
-- on the till reads the same as a show day with a hole in it.
CREATE TABLE IF NOT EXISTS store_hours (
  weekday INTEGER PRIMARY KEY,
  opens_at TEXT,
  closes_at TEXT,
  is_closed INTEGER NOT NULL DEFAULT 0
);
