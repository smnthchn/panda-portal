-- Phone-first redesign: per-user theme, and break allotments set on the shift.

-- Which of the five palettes this person picked in Appearance.
ALTER TABLE employees ADD COLUMN theme_id TEXT NOT NULL DEFAULT 'habbo';

-- Break allotment lives on the shift, set by the boss when the schedule is
-- built. Nothing is derived from shift length at render time.
ALTER TABLE convention_shifts ADD COLUMN break_allotment_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE convention_shifts ADD COLUMN break_count INTEGER NOT NULL DEFAULT 1;
