-- Pay-period approval. A row is one approval of one person's period; an
-- unlock stamps the row rather than deleting it, so the table is the log of
-- every approve and unlock. Only one live (not unlocked) approval per person
-- per period. The fingerprint is the approved shifts, so a punch landing in
-- the period afterwards shows up as "changed since approved".
CREATE TABLE IF NOT EXISTS timesheet_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  net_minutes INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  approved_by INTEGER NOT NULL,
  approved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unlocked_by INTEGER,
  unlocked_at TEXT,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (approved_by) REFERENCES employees(id),
  FOREIGN KEY (unlocked_by) REFERENCES employees(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS timesheet_approvals_live
  ON timesheet_approvals (employee_id, period_start)
  WHERE unlocked_at IS NULL;

-- A flag the boss has looked at and decided is fine ("no break taken, that's
-- right", "called in sick"). Sparse: a row only where someone dismissed one.
-- flag_key names the flag and what it's about, e.g. missed_break:<clock-in>.
-- A stat-holiday eligibility flag is decided rather than dismissed: outcome is
-- 'counts' or 'not' there, NULL for an ordinary dismissal.
CREATE TABLE IF NOT EXISTS timesheet_flag_dismissals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  flag_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  outcome TEXT,
  dismissed_by INTEGER NOT NULL,
  dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (employee_id, flag_key),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (dismissed_by) REFERENCES employees(id)
);

-- Staff answering a flag on their own hours ("forgot to clock out, left at
-- 7:30"). One answer per flag; answering again replaces it. suggested_at is
-- a UTC stamp for a missing clock-out or break end, which the boss can apply
-- in one tap. Only the boss ever changes punches.
CREATE TABLE IF NOT EXISTS timesheet_flag_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  flag_key TEXT NOT NULL,
  note TEXT NOT NULL,
  suggested_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (employee_id, flag_key),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);
