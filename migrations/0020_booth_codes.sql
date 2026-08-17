-- The booth's units, relabelled against the current floor plan.
--
-- The shipped template came from an older plan: the second entrance unit was
-- called O1, the overstock column ran O2/O3, and the centre's middle pair was
-- O4/O5. Nothing moved — every unit keeps its geometry — but the codes were a
-- plan or two behind, which is why a booth with an S1 had no S2 and had an O5
-- standing in the middle of the centre island.
--
--   O1 -> S2   the other entrance unit; its board is already "Entrance [L]"
--   O2 -> O1   top-right corner
--   O3 -> O2   right-hand column
--   O4 -> C5   centre, between C3 and C7
--   O5 -> C6   centre, between C4 and C8
--
-- Order matters: (convention_id, code) is unique, so each rename has to run
-- only once the code it wants has been vacated. O1 -> S2 frees O1 for O2, and
-- so on down the chain. Renaming in any other order trips the constraint.
--
-- A plan may also carry an S2 someone added by hand, because a booth with an
-- S1 and no S2 looks like it's missing a shelf. That's the same physical unit
-- as O1 entered a second time, and the unique code means it has to be folded
-- into O1 before O1 can take the name. Everything on the stand-in moves
-- across first, so nothing anyone did to it is lost.

-- Its artwork, except on a face O1 already has boarded.
UPDATE shelf_board_art
SET position_id = (
      SELECT o.id
      FROM shelf_positions s
      JOIN shelf_positions o
        ON o.convention_id = s.convention_id AND o.code = 'O1'
      WHERE s.id = shelf_board_art.position_id
    )
WHERE position_id IN (
      SELECT s.id
      FROM shelf_positions s
      JOIN shelf_positions o
        ON o.convention_id = s.convention_id AND o.code = 'O1'
      WHERE s.code = 'S2'
    )
  AND NOT EXISTS (
      SELECT 1
      FROM shelf_board_art existing
      JOIN shelf_positions s ON s.id = shelf_board_art.position_id
      JOIN shelf_positions o
        ON o.convention_id = s.convention_id AND o.code = 'O1'
      WHERE existing.position_id = o.id
        AND existing.face = shelf_board_art.face
    );

-- Its photos and its ticks.
UPDATE shelf_photos
SET position_id = (
      SELECT o.id
      FROM shelf_positions s
      JOIN shelf_positions o
        ON o.convention_id = s.convention_id AND o.code = 'O1'
      WHERE s.id = shelf_photos.position_id
    )
WHERE position_id IN (
      SELECT s.id
      FROM shelf_positions s
      JOIN shelf_positions o
        ON o.convention_id = s.convention_id AND o.code = 'O1'
      WHERE s.code = 'S2'
    );

-- Then the stand-in itself, and anything that wouldn't move because O1
-- already had it.
DELETE FROM shelf_board_art
WHERE position_id IN (
      SELECT s.id FROM shelf_positions s
      JOIN shelf_positions o ON o.convention_id = s.convention_id AND o.code = 'O1'
      WHERE s.code = 'S2');

DELETE FROM shelf_stage_flags
WHERE position_id IN (
      SELECT s.id FROM shelf_positions s
      JOIN shelf_positions o ON o.convention_id = s.convention_id AND o.code = 'O1'
      WHERE s.code = 'S2');

DELETE FROM shelf_positions
WHERE id IN (
      SELECT s.id FROM shelf_positions s
      JOIN shelf_positions o ON o.convention_id = s.convention_id AND o.code = 'O1'
      WHERE s.code = 'S2');

UPDATE shelf_positions SET code = 'S2', kind = 'shelf' WHERE code = 'O1';
UPDATE shelf_positions SET code = 'O1' WHERE code = 'O2';
UPDATE shelf_positions SET code = 'O2' WHERE code = 'O3';
UPDATE shelf_positions SET code = 'C5', wall = 'CENTER', kind = 'shelf' WHERE code = 'O4';
UPDATE shelf_positions SET code = 'C6', wall = 'CENTER', kind = 'shelf' WHERE code = 'O5';

-- C5 and C6 have just joined the centre from the end of the plan. The grid
-- groups by runs of the same section, so without this they would open a
-- second CENTER heading under the last one instead of joining it.
UPDATE shelf_positions SET sort_order = CASE code
  WHEN 'S1' THEN 0
  WHEN 'S2' THEN 1
  WHEN 'E1' THEN 2
  WHEN 'E2' THEN 3
  WHEN 'E3' THEN 4
  WHEN 'E4' THEN 5
  WHEN 'E5' THEN 6
  WHEN 'E6' THEN 7
  WHEN 'E7' THEN 8
  WHEN 'N1' THEN 9
  WHEN 'N2' THEN 10
  WHEN 'N3' THEN 11
  WHEN 'N4' THEN 12
  WHEN 'W1' THEN 13
  WHEN 'W2' THEN 14
  WHEN 'W3' THEN 15
  WHEN 'W4' THEN 16
  WHEN 'W5' THEN 17
  WHEN 'C1' THEN 18
  WHEN 'C2' THEN 19
  WHEN 'C3' THEN 20
  WHEN 'C4' THEN 21
  WHEN 'C5' THEN 22
  WHEN 'C6' THEN 23
  WHEN 'C7' THEN 24
  WHEN 'C8' THEN 25
  WHEN 'C9' THEN 26
  WHEN 'O1' THEN 27
  WHEN 'O2' THEN 28
  WHEN 'Cash' THEN 29
  WHEN 'A' THEN 30
  ELSE sort_order
END
WHERE code IN (
  'S1','S2','E1','E2','E3','E4','E5','E6','E7','N1','N2','N3','N4',
  'W1','W2','W3','W4','W5','C1','C2','C3','C4','C5','C6','C7','C8','C9',
  'O1','O2','Cash','A'
);
