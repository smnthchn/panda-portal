-- Sales bonus pay moves to one rate for everyone (docs/bonus-plan.md):
-- a set amount for each day a person worked in a goal that was met, the same
-- on any day, and not split between the people working that day. The steps
-- past the goal are still a pot, shared by days worked.
--
-- day_rate_cents is that per-person, per-day amount. base_cents (what the
-- whole goal used to pay before it was split) is no longer read.
-- $20 a day for every goal, the first weekend included: it was live under the
-- old rule for a few hours, but no staff had been told or had looked yet.
ALTER TABLE bonus_blocks ADD COLUMN day_rate_cents INTEGER NOT NULL DEFAULT 2000;

-- Someone working a day of a goal they aren't usually on, such as weekend
-- staff helping on a weekday sale day. The regulars are in bonus_people and
-- count as working unless unticked (bonus_absences); these are the additions.
CREATE TABLE IF NOT EXISTS bonus_extra_days (
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
