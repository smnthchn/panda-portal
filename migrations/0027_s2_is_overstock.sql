-- S2 can't be reached either, so it stops being a selling shelf.
--
-- It keeps its S2 code on purpose: unlike the centre pair, the floor already
-- calls it S2 and renaming it would cost more than the tidy naming is worth.
-- Only what it counts as changes.
--
-- That takes the booth to 24 sellable units, which is the denominator every
-- allocation is worked out against.

UPDATE shelf_positions SET kind = 'other'
WHERE code = 'S2'
  AND convention_id IN (SELECT id FROM conventions WHERE slug = 'fan-expo');

-- Master Grade was on N1, N2 and S2; it keeps the first two. Perfect Grade was
-- on S2 alone, so it would be left with nowhere to stand.
--
-- It moves to the Master Grade shelf rather than being left unplaced, because
-- that isn't a guess: PG has six SKUs in stock and has always stood upright at
-- the end of the MG run as the hero piece. One facing, as it had on S2.
DELETE FROM shelf_groupings
WHERE position_id IN (
  SELECT id FROM shelf_positions
  WHERE code = 'S2' AND convention_id IN (SELECT id FROM conventions WHERE slug = 'fan-expo')
);

DELETE FROM shelf_grouping_tiers
WHERE position_id IN (
  SELECT id FROM shelf_positions
  WHERE code = 'S2' AND convention_id IN (SELECT id FROM conventions WHERE slug = 'fan-expo')
);

INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 1
FROM shelf_positions p
JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'perfect grade'
WHERE c.slug = 'fan-expo' AND p.code = 'N2';
