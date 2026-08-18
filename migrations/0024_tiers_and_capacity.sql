-- Tiers, and what fits on one.
--
-- Groupings answered "which family stands on this unit". They didn't answer the
-- question the spreadsheet actually answered: how many of that family do we
-- pack? That needs three things this migration adds — how many SKUs the family
-- has to choose from, how tall and wide one box is, and which tiers of the unit
-- it occupies.
--
-- Capacity warns, it never blocks. An over-full tier goes amber and says so;
-- nothing is refused.

-- ---------------------------------------------------------------------------
-- What a family has to choose from, and how big one box is
-- ---------------------------------------------------------------------------

-- A snapshot, not a live figure. The count is the *pool* the family is picked
-- from, not what gets brought: the catalogue holds ~4,700 in-stock SKUs across
-- these families and the booth shows around 250. Refreshed by hand against
-- Shopify, which is why the date it was taken is kept beside it.
ALTER TABLE groupings ADD COLUMN sku_count INTEGER;
ALTER TABLE groupings ADD COLUMN sku_count_at TEXT;

-- box_class already says how wide one box stands. Height is the other half:
-- tiers within one unit are not the same height — a blind-box unit is four
-- short tiers over two taller ones — so a tall box does not fit everywhere.
ALTER TABLE groupings ADD COLUMN box_height_in REAL NOT NULL DEFAULT 12;

-- Not everything lives on a tier.
--   tier    — merchandised onto tiers, the normal case
--   side    — zip-tied to the side of a unit: tools, TCG, action bases when
--             space is short. Needs a bring quantity, not a placement.
--   up_top  — the big expensive boxes that sit on top of the shelves. There are
--             only ever one or two of each, and in a tier they would eat a run.
ALTER TABLE groupings ADD COLUMN placement TEXT NOT NULL DEFAULT 'tier';

-- ---------------------------------------------------------------------------
-- The tiers of a unit
-- ---------------------------------------------------------------------------

-- The unit type already names the tier count ('4 Tier'), but it also carries
-- names that don't ('SD', 'Blindbox'), so the number is stored rather than
-- parsed at every read. Shelves are adjustable — SIZED means the unit was built
-- to this count — so tier height falls out of the count and the usable height.
ALTER TABLE shelf_positions ADD COLUMN tier_count INTEGER NOT NULL DEFAULT 4;
ALTER TABLE shelf_positions ADD COLUMN usable_height_in REAL NOT NULL DEFAULT 72;

UPDATE shelf_positions SET tier_count = CASE
  WHEN kind = 'other' THEN 0
  WHEN unit_type LIKE '_ Tier' THEN CAST(substr(unit_type, 1, 1) AS INTEGER)
  ELSE 4
END;

-- Sparse, like employee_availability: a row only where a tier is not the even
-- split of the unit's usable height. A blind-box unit's two tall bottom tiers
-- get rows; the four short ones above them don't need any.
CREATE TABLE IF NOT EXISTS shelf_tiers (
  position_id INTEGER NOT NULL,
  tier_index INTEGER NOT NULL,          -- 1 is the TOP tier, at eye level
  height_in REAL NOT NULL,
  PRIMARY KEY (position_id, tier_index),
  FOREIGN KEY (position_id) REFERENCES shelf_positions(id)
);

-- Which tiers a family occupies on a unit. A row per tier rather than a range,
-- because a family can skip one: small easy-to-pocket stock is kept in the top
-- three or four tiers so nobody is bending over an open bag.
CREATE TABLE IF NOT EXISTS shelf_grouping_tiers (
  position_id INTEGER NOT NULL,
  grouping_id INTEGER NOT NULL,
  tier_index INTEGER NOT NULL,
  PRIMARY KEY (position_id, grouping_id, tier_index),
  FOREIGN KEY (position_id) REFERENCES shelf_positions(id),
  FOREIGN KEY (grouping_id) REFERENCES groupings(id)
);

CREATE INDEX IF NOT EXISTS idx_shelf_grouping_tiers_position
  ON shelf_grouping_tiers (position_id);

-- ---------------------------------------------------------------------------
-- The families, corrected
-- ---------------------------------------------------------------------------

-- No paint goes to a booth. The family was 'Tools & paint' filtered on
-- product_type Paint, which swept in 1,342 in-stock paint SKUs that have never
-- been on a shelf. Tools are the real family, and they are zip-tied to the side
-- of a unit rather than given a tier.
UPDATE groupings SET
  name = 'Tools',
  name_key = 'tools',
  shopify_query = 'vendor:''GodHand'' OR title:*nipper* OR title:*tweezer* OR title:*knife* OR title:*sanding* OR title:*Gunprimer*',
  placement = 'side',
  box_class = 'small',
  box_height_in = 8,
  notes = 'Zip-tied to the side of a unit. Bring all nippers — they come in cases of 6, so in multiples of 6. About 20 in stock means bring them all; 40+ means check the comparable items, ~18 if they are stocked too and 30+ if not. Sets sell, so bring sets where they exist. Plus tweezers, knives, sanding paper and sponges, and Gunprimer Razer, balancers and their other sanding products when in stock.'
WHERE name_key = 'tools paint';

-- Markers are the only thing from the paint wall that goes. Individual markers
-- are hard to display, so it is the black, grey and brown panel liners (fine
-- tip and pour type) plus sets — and the sets stay Gundam-branded, because
-- nobody recognises the AK ones. The AK Precision Panel Liners drop out of this
-- query on their own: they are titled Liner but not Marker.
INSERT OR IGNORE INTO groupings (name, name_key, shopify_query, box_class, box_height_in, placement, sort_order, notes)
VALUES ('Markers', 'markers',
  '(title:*Liner* OR title:*Set*) AND title:*Marker*',
  'small', 6, 'tier', 20,
  'Black, grey and brown panel liners, and Gundam marker sets. No paint of any kind. Mark Setter, Mark Softer and cement are worth adding when there is stock.');

-- Frame Arms — the Kotobukiya mecha line, not Frame Arms Girl — sold one or two
-- pieces off two tiers, so the line goes entirely and the space is reallocated.
-- Frame Arms Girl carries the plain 'Frame Arms' tag too (39 of the 50), so
-- excluding it here also stops those kits being counted twice: they belong to
-- Girls, and that is where they stay.
UPDATE groupings SET
  shopify_query = '(tag:''Kotobukiya'' OR tag:''Zoids'' OR tag:''Metal Gear Solid'' OR tag:''Armored Core'') AND -tag:''Frame Arms'''
WHERE name_key = 'kotobukiya other kits';

-- ---------------------------------------------------------------------------
-- The snapshot: in-stock SKUs per family, and how tall one box stands
-- ---------------------------------------------------------------------------
--
-- Counts taken from Shopify on 18 Aug 2026, each family's own query with
-- `AND inventory_total:>0`. Box heights are the assumption to check first if a
-- tier's fit looks wrong — they are the one number here nobody measured.

UPDATE groupings SET sku_count_at = '2026-08-18';

UPDATE groupings SET sku_count =  79, box_height_in = 12.5 WHERE name_key = 'hg universal century';
UPDATE groupings SET sku_count = 128, box_height_in = 12.5 WHERE name_key = 'hg other series';
UPDATE groupings SET sku_count =  86, box_height_in = 12.5 WHERE name_key = 'gundam seed';
UPDATE groupings SET sku_count = 123, box_height_in = 16   WHERE name_key = 'master grade';
UPDATE groupings SET sku_count =  33, box_height_in = 12.5 WHERE name_key = 'real grade';
UPDATE groupings SET sku_count =  65, box_height_in = 7    WHERE name_key = 'sd bb senshi';
UPDATE groupings SET sku_count = 268, box_height_in = 8    WHERE name_key = 'pokemon';
UPDATE groupings SET sku_count = 172, box_height_in = 10   WHERE name_key = 'one piece';
UPDATE groupings SET sku_count = 191, box_height_in = 10   WHERE name_key = 'vehicles';
UPDATE groupings SET sku_count = 383, box_height_in = 12   WHERE name_key = 'girls';
UPDATE groupings SET sku_count = 471, box_height_in = 12   WHERE name_key = 'figures';
UPDATE groupings SET sku_count = 118, box_height_in = 4    WHERE name_key = 'blind box trading';
UPDATE groupings SET sku_count =  71, box_height_in = 16   WHERE name_key = 'plush';
UPDATE groupings SET sku_count =   6, box_height_in = 20   WHERE name_key = 'perfect grade';
UPDATE groupings SET sku_count = 200, box_height_in = 13   WHERE name_key = 'kotobukiya other kits';
UPDATE groupings SET sku_count = 175, box_height_in = 8    WHERE name_key = '30 minutes missions';
UPDATE groupings SET sku_count =  48, box_height_in = 12.5 WHERE name_key = 'figure-rise';
UPDATE groupings SET sku_count =  24, box_height_in = 12   WHERE name_key = 'star wars';
UPDATE groupings SET sku_count = 176                       WHERE name_key = 'tools';
UPDATE groupings SET sku_count =  26                       WHERE name_key = 'markers';

-- Blind-box units run four short tiers over two taller ones at the bottom, and
-- the stock rides high on purpose: small and easy to pocket, so it stays out of
-- reach of an open bag. C4 is the blind-box unit at Fan Expo.
UPDATE shelf_positions SET tier_count = 6
WHERE code = 'C4'
  AND convention_id IN (SELECT id FROM conventions WHERE slug = 'fan-expo');

INSERT OR IGNORE INTO shelf_tiers (position_id, tier_index, height_in)
SELECT p.id, t.tier_index, t.height_in
FROM shelf_positions p
JOIN conventions c ON c.id = p.convention_id
JOIN (SELECT 5 AS tier_index, 16.0 AS height_in
      UNION ALL SELECT 6, 16.0) t
WHERE c.slug = 'fan-expo' AND p.code = 'C4';
