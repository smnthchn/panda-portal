-- Perfect Grade goes up top, not on a shelf.
--
-- 0027 moved it onto the Master Grade shelf when S2 stopped selling, on the
-- strength of an older note about it standing at the end of the MG run as the
-- hero piece. That note is out of date: with only a handful of PG kits, the
-- boxes are far too big to earn tier space, and they go on top of the shelves
-- with the other oversized stock.
--
-- Six PG SKUs are in stock, which is the "two or three" case rather than enough
-- to build a run around.

UPDATE groupings SET placement = 'up_top' WHERE name_key = 'perfect grade';

DELETE FROM shelf_grouping_tiers
WHERE grouping_id = (SELECT id FROM groupings WHERE name_key = 'perfect grade');

DELETE FROM shelf_groupings
WHERE grouping_id = (SELECT id FROM groupings WHERE name_key = 'perfect grade');
