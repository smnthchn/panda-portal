-- C9 is a 3 ft unit and was drawn as a full-length one.
--
-- Four units are typed '3 ft' — C2, C9, E7, N1 — but only E7 and N1 carried the
-- short footprint, so the map showed three short blocks (E7, N1 and O1) and C9
-- was not among them. Its type was right and its geometry was wrong.
--
-- The short units are 38" on the plan, which is the 36" shelf plus the wheel
-- clearance that stops units sitting flush. That leaves 34" of usable run once
-- the 1" corner poles are in the way, against 46" on a full-length unit — so
-- this is not cosmetic: it is a third less space for anything standing there.
--
-- C9 runs along the bottom of the centre, so the short side comes off its
-- length and the unit keeps its left edge. Nothing else moves and nothing
-- overlaps; it leaves a foot of floor.

UPDATE shelf_positions
SET w = 38.0 / 12.0
WHERE code = 'C9'
  AND convention_id IN (SELECT id FROM conventions WHERE slug = 'fan-expo');
