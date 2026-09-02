-- Which labour groups the budget leaves out of the money, as a JSON array of
-- role keys (e.g. ["staff"]) — regular wages are paid show or no show, so
-- the boss can read the budget as what the event added. Hours still show;
-- only the costs drop out.
ALTER TABLE conventions ADD COLUMN budget_excluded_roles TEXT NOT NULL DEFAULT '[]';
