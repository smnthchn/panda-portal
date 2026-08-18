-- Groupings: the product families that go on a shelf.
--
-- A grouping is what the merchandising photos show — one rack is HG Universal
-- Century, one is Gundam SEED, one is Girls, one is Plush. The family is the
-- store's and outlives any show; what changes per show is how many shelves it
-- gets and how deep each SKU is faced.
--
-- So the family lives here, store-wide, next to Resources, and the assignment
-- to a position lives per event alongside the plan.

CREATE TABLE IF NOT EXISTS groupings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,

  -- How to find this family's SKUs in Shopify. Their tags are structured
  -- enough to be a filter on their own: "tag:'High Grade' AND
  -- tag:'Universal Century'". Kept as the query rather than a copied list of
  -- SKUs, so a new kit joins its family the moment it's tagged.
  shopify_query TEXT,

  -- Roughly how wide one box stands, which is what decides how many face out
  -- across a tier. Set per family because it's a property of the product, not
  -- of the shelf it lands on.
  box_class TEXT NOT NULL DEFAULT 'medium',   -- small | medium | large | oversize

  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Which family is on which shelf at one show, and how deep it's faced there.
--
-- A row per (position, grouping) rather than a column on the position: a wide
-- unit can carry two families, and the photos show that happening — the SEED
-- rack runs MG down one half and HG down the other.
--
-- `facings` is the per-SKU depth on this shelf at this show. It is the dial
-- that moves between shows: 3 or 4 at Anime North becomes 1 or 2 at Fan Expo.
CREATE TABLE IF NOT EXISTS shelf_groupings (
  position_id INTEGER NOT NULL,
  grouping_id INTEGER NOT NULL,
  facings INTEGER NOT NULL DEFAULT 2,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (position_id, grouping_id),
  FOREIGN KEY (position_id) REFERENCES shelf_positions(id),
  FOREIGN KEY (grouping_id) REFERENCES groupings(id)
);

CREATE INDEX IF NOT EXISTS idx_shelf_groupings_grouping
  ON shelf_groupings (grouping_id);

-- The families read off the Anime North 2026 merchandising photos. Queries
-- are written against the tags the catalogue actually carries, checked
-- against it rather than invented: Gundam grades are tags, and so are series,
-- Girl, Blind Box, Nendoroid and Vehicles.
INSERT OR IGNORE INTO groupings (name, name_key, shopify_query, box_class, sort_order, notes) VALUES
  ('HG Universal Century', 'hg universal century',
   'tag:''High Grade'' AND tag:''Universal Century''', 'medium', 0,
   'One rack on its own, sorted by HG kit number.'),
  ('HG other series', 'hg other series',
   'tag:''High Grade'' AND -tag:''Universal Century'' AND -tag:''Gundam Seed''', 'medium', 1,
   'Wing, G, AGE, 00, Iron Blooded Orphans, Turn A.'),
  ('Gundam SEED', 'gundam seed',
   'tag:''Gundam Seed''', 'medium', 2,
   'Kept together across grades: MG and RG on one half, HG on the other.'),
  ('Master Grade', 'master grade',
   'tag:''Master Grade''', 'large', 3,
   'Three facings, with a Perfect Grade stood upright at the end as the hero piece.'),
  ('Real Grade', 'real grade',
   'tag:''Real Grade''', 'medium', 4,
   'Earned the most per shelf of any grade at Anime North 2025.'),
  ('SD / BB Senshi', 'sd bb senshi',
   'tag:''SD''', 'small', 5,
   'Densest gunpla rack: small square boxes, five or six across.'),
  ('Pokemon', 'pokemon',
   'tag:''Pokemon''', 'small', 6,
   'High units, low value. Traffic rather than revenue.'),
  ('One Piece', 'one piece',
   'tag:''One Piece''', 'medium', 7,
   'Grand Ship Collection in number order, plus Chopper Robo.'),
  ('Vehicles', 'vehicles',
   'tag:''Vehicles'' OR tag:''Initial D'' OR tag:''Race Car''', 'medium', 8,
   'Aoshima Snap Kit, Initial D and MF Ghost, Tamiya scale cars, bikes, Macross.'),
  ('Girls', 'girls',
   'tag:''Girl'' OR tag:''Megami Device'' OR tag:''Frame Arms Girl'' OR tag:''Mecha Musume''', 'large', 9,
   'Second biggest earner after Gundam, and 3.4x better at Anime North than Fan Expo.'),
  ('Figures', 'figures',
   'tag:''Figure'' OR tag:''Pop Up Parade'' OR tag:''Nendoroid''', 'large', 10,
   'Arranged large to small. Premium scale figures get a rack of their own.'),
  ('Blind box & trading', 'blind box trading',
   'tag:''Blind Box'' OR tag:''Trading Figure''', 'small', 11,
   'Re-Ment, Miniverse. High volume, low value.'),
  ('Plush', 'plush', 'tag:''Plushies''', 'oversize', 12,
   'Big plush rides the top shelf. The tag is Plushies, not Plush — the singular returns nothing.'),
  ('Tools & paint', 'tools paint',
   'product_type:''Tools'' OR product_type:''Paint''', 'small', 13,
   'GodHand nippers carried this; small but reliable.');
