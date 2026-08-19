-- C5 and C6 are overstock, and always were.
--
-- They sit in the middle of the centre run with shelving on both sides, so
-- nobody can reach them while the show is on. They were O4/O5 on the original
-- floor plan and became C5/C6 in the Aug 2026 rename, which is the thing that
-- was wrong — a centre code says "shoppable" and these are not.
--
-- Their geometry is untouched: they stay exactly where they are on the booth
-- map. What changes is the code, the section they group under in the grid, and
-- the fact that they no longer count as selling shelves.

UPDATE shelf_positions SET
  code = 'O3',
  kind = 'other',
  wall = 'OVERSTOCK & OTHER',
  sort_order = 30
WHERE code = 'C5';

UPDATE shelf_positions SET
  code = 'O4',
  kind = 'other',
  wall = 'OVERSTOCK & OTHER',
  sort_order = 31
WHERE code = 'C6';

-- The grid groups by runs of the same wall rather than by wall, so a unit whose
-- section changed but whose place in the order didn't would open a second
-- OVERSTOCK & OTHER heading instead of joining the one already there. A sits
-- after the pair.
UPDATE shelf_positions SET sort_order = 32
WHERE code = 'A' AND wall = 'OVERSTOCK & OTHER';

-- An overstock unit holds boxes, not a display. Star Wars and HG other series
-- were on these two and now have nowhere to stand — that space has to be
-- reallocated rather than quietly disappearing.
DELETE FROM shelf_groupings
WHERE position_id IN (SELECT id FROM shelf_positions WHERE code IN ('O3', 'O4'));

DELETE FROM shelf_grouping_tiers
WHERE position_id IN (SELECT id FROM shelf_positions WHERE code IN ('O3', 'O4'));
