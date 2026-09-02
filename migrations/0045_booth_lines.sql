-- Booth costs become free-form lines. The fixed kinds (regular / corner /
-- electricity) assumed every booth of a shape shared one rate, and Fan Expo
-- promptly charged two booths differently — so a line is now a label the
-- boss names, times a count, minus a discount. SQLite can't drop the
-- UNIQUE(convention_id, kind) in place, so the table is rebuilt (the way
-- migration 0012 rebuilt shifts).

CREATE TABLE convention_booth_costs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  convention_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  price_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (convention_id) REFERENCES conventions(id)
);

-- Electricity had no count; its line total was price − discount, which a
-- qty of 1 preserves exactly.
INSERT INTO convention_booth_costs_new
  (convention_id, label, qty, price_cents, discount_cents)
SELECT
  convention_id,
  CASE kind
    WHEN 'regular' THEN 'Regular'
    WHEN 'corner' THEN 'Corner'
    WHEN 'electricity' THEN 'Electricity'
    ELSE kind
  END,
  CASE WHEN kind = 'electricity' THEN 1 ELSE qty END,
  price_cents,
  discount_cents
FROM convention_booth_costs;

DROP TABLE convention_booth_costs;
ALTER TABLE convention_booth_costs_new RENAME TO convention_booth_costs;
