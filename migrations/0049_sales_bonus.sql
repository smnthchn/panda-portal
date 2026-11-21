-- Sales bonus (docs/bonus-plan.md). One row per goal: a Monday-to-Friday week
-- or a weekend. Money is in cents. goal_cents is NULL until the boss sets it.
-- base_cents is what the whole goal pays when it is met, before it is split
-- between the people on it; each further step_size_cents of sales pays
-- another step_bonus_cents. last_year_cents is the same days' sales last year
-- and is only ever shown to the boss. sales_cents is the last figure read from
-- Shopify, kept so a page doesn't ask Shopify on every view.
CREATE TABLE IF NOT EXISTS bonus_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('weekday', 'weekend')),
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  goal_cents INTEGER,
  base_cents INTEGER NOT NULL,
  step_size_cents INTEGER NOT NULL DEFAULT 50000,
  step_bonus_cents INTEGER NOT NULL DEFAULT 2500,
  last_year_cents INTEGER,
  sales_cents INTEGER,
  sales_checked_at TEXT,
  updated_by INTEGER,
  updated_at TEXT,
  UNIQUE (kind, starts_on),
  FOREIGN KEY (updated_by) REFERENCES employees(id)
);

-- Who shares each kind of goal. The bonus is split evenly between them.
CREATE TABLE IF NOT EXISTS bonus_people (
  kind TEXT NOT NULL CHECK (kind IN ('weekday', 'weekend')),
  employee_id INTEGER NOT NULL,
  PRIMARY KEY (kind, employee_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

-- Days someone on a goal did NOT work. Everyone counts as having worked until
-- the boss unticks them, so only the exceptions are stored. A person shares
-- in a bonus only for the days they worked.
CREATE TABLE IF NOT EXISTS bonus_absences (
  block_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  employee_id INTEGER NOT NULL,
  marked_by INTEGER,
  marked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (block_id, day, employee_id),
  FOREIGN KEY (block_id) REFERENCES bonus_blocks(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (marked_by) REFERENCES employees(id)
);

-- November and December 2026. Weekday goals are last year minus 10%; the
-- first weekend is $6,000; the later weekends aren't decided yet. Weekdays
-- pay $20 a day and weekends $60 a day.
INSERT OR IGNORE INTO bonus_blocks (kind, starts_on, ends_on, goal_cents, base_cents, last_year_cents) VALUES
  ('weekend', '2026-11-21', '2026-11-22', 600000, 12000, 621078),
  ('weekday', '2026-11-23', '2026-11-27', 540000, 10000, 599807),
  ('weekend', '2026-11-28', '2026-11-29', NULL, 12000, 649752),
  ('weekday', '2026-11-30', '2026-12-04', 484000, 10000, 537979),
  ('weekend', '2026-12-05', '2026-12-06', NULL, 12000, 482749),
  ('weekday', '2026-12-07', '2026-12-11', 589000, 10000, 654583),
  ('weekend', '2026-12-12', '2026-12-13', NULL, 12000, 748888),
  ('weekday', '2026-12-14', '2026-12-18', 677000, 10000, 752684),
  ('weekend', '2026-12-19', '2026-12-20', NULL, 12000, 864695),
  ('weekday', '2026-12-21', '2026-12-24', 1162000, 8000, 1290788),
  ('weekend', '2026-12-26', '2026-12-27', NULL, 12000, 1028869),
  ('weekday', '2026-12-28', '2026-12-31', 904000, 8000, 1004058);

-- Who is on each goal, by staff ID (employees.id on the live portal): staff 5
-- on weekdays, staff 4 and 6 on weekends. No names here on purpose. On a
-- local or test database those IDs can be other people or nobody; the boss
-- sets the lists on the Sales bonus page either way.
INSERT OR IGNORE INTO bonus_people (kind, employee_id)
SELECT 'weekday', id FROM employees WHERE id = 5 AND is_active = 1;

INSERT OR IGNORE INTO bonus_people (kind, employee_id)
SELECT 'weekend', id FROM employees WHERE id IN (4, 6) AND is_active = 1;
