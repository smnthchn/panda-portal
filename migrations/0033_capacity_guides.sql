-- Capacity by guide, not by geometry.
--
-- The computed capacity (box widths against tier dimensions) never matched
-- the floor. What Sam actually packs to is a per-family guide written against
-- a 4-tier unit: "Girls fit 20, MG fit 12". So the guide is stored on the
-- family and the math is retired. NULL means no guide set yet.
ALTER TABLE groupings ADD COLUMN guide_pieces INTEGER;

-- Sam's guides, August 2026, per 4-tier unit.
UPDATE groupings SET guide_pieces = 20
 WHERE name_key IN ('girls', 'armored core', 'koto', 'moderoid');

UPDATE groupings SET guide_pieces = 25
 WHERE name_key IN ('cars', 'anime', 'star wars', 'op', '30mm', 'hg', 'hg other series');

UPDATE groupings SET guide_pieces = 12
 WHERE name_key = 'mg';
