-- PRODUCT + becomes WRAPPED, and moves to the end of the prep stages.
--
-- Order is now: 0 sized, 1 prepped, 2 scanned, 3 boards, 4 wrapped. Existing
-- ticks keep their meaning — a shelf ticked PRODUCT + is ticked WRAPPED now.
-- Two steps because (position_id, stage) is the primary key, and remapping
-- 1 -> 4 in place would collide with an existing 4 on the same shelf.
UPDATE shelf_stage_flags SET stage = stage + 10 WHERE stage IN (1, 2, 3, 4);

UPDATE shelf_stage_flags SET stage = CASE stage
  WHEN 11 THEN 4   -- product+  -> wrapped
  WHEN 12 THEN 1   -- prepped
  WHEN 13 THEN 2   -- scanned
  WHEN 14 THEN 3   -- boards
END WHERE stage >= 10;
