-- The guide is per tier now, not per 4-tier unit.
--
-- Sam typed 18 into PBandai meaning "one tier fits 18" and the box read it as
-- a whole unit — per tier is how she thinks, so per tier is what's stored.
-- The migration-0033 seeds were per-unit numbers and convert by dividing by
-- four (25 rounds down to 6 a tier); PBandai was already per-tier and stays.
UPDATE groupings SET guide_pieces = CASE
  WHEN name_key IN ('cars', 'anime', 'star wars', 'op', '30mm', 'hg', 'hg other series') THEN 6
  WHEN name_key IN ('girls', 'armored core', 'koto', 'moderoid') THEN 5
  WHEN name_key = 'mg' THEN 3
  ELSE guide_pieces
END
WHERE guide_pieces IS NOT NULL;
