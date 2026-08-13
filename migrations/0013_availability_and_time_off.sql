-- When people can work, and when they've asked not to.
--
-- Availability is the recurring pattern — "I can't do Mondays", "Tuesdays
-- after 5". Time off is a specific stretch of dates that has to be asked for
-- and answered. Both are read by the schedule builder, so a clash shows up
-- while the schedule is being built rather than after it's published.

CREATE TABLE IF NOT EXISTS employee_availability (
  employee_id INTEGER NOT NULL,
  weekday INTEGER NOT NULL,              -- 0 = Sunday
  is_available INTEGER NOT NULL DEFAULT 1,
  earliest TEXT,                          -- optional "not before"
  latest TEXT,                            -- optional "not after"
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (employee_id, weekday),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS time_off_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | declined
  decided_by INTEGER,
  decided_at TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (decided_by) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_time_off_employee ON time_off_requests (employee_id);
CREATE INDEX IF NOT EXISTS idx_time_off_dates ON time_off_requests (starts_on, ends_on);
