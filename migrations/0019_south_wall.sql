-- SOUTH -> SOUTH WALL, so it reads like the three sides it sits beside.
--
-- The second statement is for a plan that somehow missed 0018; it costs
-- nothing and saves a section stranded under a heading that isn't a choice.

UPDATE shelf_positions SET wall = 'SOUTH WALL' WHERE wall = 'SOUTH';
UPDATE shelf_positions SET wall = 'SOUTH WALL' WHERE wall = 'ENTRANCE';
