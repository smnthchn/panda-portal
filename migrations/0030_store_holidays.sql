-- Which holidays the store actually closes for.
--
-- The dates themselves are worked out in `src/lib/holidays.js` — they only move
-- with the calendar. What isn't a fact about the calendar is whether Panda Hobby
-- opens that day, so that's the only thing kept here.
--
-- Sparse on purpose, the same way `employee_availability` is: a row exists only
-- where the boss has actually decided. No row means the day is still an open
-- question, which the schedule says out loud rather than guessing "open".
--
-- opens_at/closes_at are the short hours a day sometimes gets — open on Canada
-- Day but only till five. NULL on an open day means the usual hours for that
-- weekday.

CREATE TABLE IF NOT EXISTS store_holidays (
  holiday_date TEXT PRIMARY KEY,
  is_closed    INTEGER NOT NULL DEFAULT 1,
  opens_at     TEXT,
  closes_at    TEXT,
  note         TEXT,
  decided_by   INTEGER REFERENCES employees(id),
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
