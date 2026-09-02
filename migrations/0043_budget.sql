-- The event budget: what a show cost.
--
-- Labour hours come from the shifts already on the event; only the pay rates
-- are stored here, per (convention, employee), so next year's raise doesn't
-- rewrite what last year's show cost. Money is integer cents everywhere.

CREATE TABLE IF NOT EXISTS convention_pay_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  convention_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  rate_cents INTEGER NOT NULL DEFAULT 0,   -- per hour
  UNIQUE (convention_id, employee_id),
  FOREIGN KEY (convention_id) REFERENCES conventions(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

-- The booth itself: fixed rows, one per kind ('regular', 'corner',
-- 'electricity'), sparse — a row exists once the boss has typed something.
CREATE TABLE IF NOT EXISTS convention_booth_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  convention_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,          -- number of booths; unused for electricity
  price_cents INTEGER NOT NULL DEFAULT 0,  -- per booth for regular/corner
  discount_cents INTEGER NOT NULL DEFAULT 0,
  UNIQUE (convention_id, kind),
  FOREIGN KEY (convention_id) REFERENCES conventions(id)
);

-- Free-form expense lines: category is 'meal' or 'transport'.
CREATE TABLE IF NOT EXISTS convention_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  convention_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (convention_id) REFERENCES conventions(id)
);

-- The movers' clock: Start inserts a row stamped now, End closes it. A show
-- gets several rows — load-in and load-out are separate visits.
CREATE TABLE IF NOT EXISTS convention_mover_times (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  convention_id INTEGER NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  FOREIGN KEY (convention_id) REFERENCES conventions(id)
);
