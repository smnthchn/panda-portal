-- Fan Expo 2026: what stands on each shelf, chosen from what sold.
--
-- Five families were missing from 0022 and turned up as an unclassified pile
-- worth 17% of Fan Expo takings — a sixth of the booth with nowhere to go.
-- Adding them brings the unplaced share down to 4.5%.
--
-- Perfect Grade was the embarrassing one: it had no grouping at all, so PG
-- Zaku IIs and a PG 00 Seven Sword sold at Fan Expo with no family to sit in.
-- Kotobukiya is the big one: 8.3% blended, 12.3% at Fan Expo 2024, on the
-- strength of Metal Gear, Zoids and Zone of the Enders. One Metal Gear Ray
-- took $1,440 across the two shows.

INSERT OR IGNORE INTO groupings (name, name_key, shopify_query, box_class, sort_order, notes) VALUES
  ('Perfect Grade', 'perfect grade', 'tag:''Perfect Grade''', 'oversize', 14,
   'Rides on the Master Grade shelf as the hero piece, stood upright, the way the photos have it.'),
  ('Kotobukiya & other kits', 'kotobukiya other kits',
   'tag:''Kotobukiya'' OR tag:''Zoids'' OR tag:''Metal Gear Solid'' OR tag:''Armored Core''', 'large', 15,
   'Metal Gear, Zoids, Zone of the Enders, Mega Man, Armored Core. High value per box.'),
  ('30 Minutes Missions', '30 minutes missions', 'tag:''30 Minutes Missions''', 'medium', 16,
   'Bandai 30MM. Small on its own, so it rides with Kotobukiya.'),
  ('Figure-Rise', 'figure-rise', 'tag:''Figure-Rise''', 'medium', 17,
   'Bandai character kits: Kaiju No. 8, Dragon Ball, Yu-Gi-Oh.'),
  ('Star Wars', 'star wars', 'tag:''Star Wars''', 'medium', 18,
   'Better at Fan Expo than Anime North, which is why it earns a shelf here.');

-- The placement. Shares are blended from Fan Expo 2024 and 2025 — the show
-- being planned — with Anime North kept only as a sanity check, since it is a
-- 800 sq ft booth against this one's 480 and a different crowd.
--
-- Facings are set for the smaller booth: 1 or 2 where Anime North runs 3 or 4,
-- and 3 for the small boxes that stand more across a tier.
--
-- One statement per shelf: D1 rejects a long UNION ALL chain outright.

INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 1 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'girls' WHERE c.slug = 'fan-expo' AND p.code = 'S1';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 1 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'master grade' WHERE c.slug = 'fan-expo' AND p.code = 'S2';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 1 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'perfect grade' WHERE c.slug = 'fan-expo' AND p.code = 'S2';

INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 2 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'gundam seed' WHERE c.slug = 'fan-expo' AND p.code = 'E1';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 2 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'gundam seed' WHERE c.slug = 'fan-expo' AND p.code = 'E2';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 2 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'gundam seed' WHERE c.slug = 'fan-expo' AND p.code = 'E3';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 2 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'hg universal century' WHERE c.slug = 'fan-expo' AND p.code = 'E4';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 2 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'hg other series' WHERE c.slug = 'fan-expo' AND p.code = 'E5';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 2 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'real grade' WHERE c.slug = 'fan-expo' AND p.code = 'E6';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 3 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'sd bb senshi' WHERE c.slug = 'fan-expo' AND p.code = 'E7';

INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 1 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'master grade' WHERE c.slug = 'fan-expo' AND p.code = 'N1';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 1 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'master grade' WHERE c.slug = 'fan-expo' AND p.code = 'N2';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 1 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'kotobukiya other kits' WHERE c.slug = 'fan-expo' AND p.code = 'N3';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 2 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = '30 minutes missions' WHERE c.slug = 'fan-expo' AND p.code = 'N3';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 1 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'kotobukiya other kits' WHERE c.slug = 'fan-expo' AND p.code = 'N4';

INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 1 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'girls' WHERE c.slug = 'fan-expo' AND p.code = 'W1';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 1 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'girls' WHERE c.slug = 'fan-expo' AND p.code = 'W2';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 1 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'figures' WHERE c.slug = 'fan-expo' AND p.code = 'W3';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 1 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'figures' WHERE c.slug = 'fan-expo' AND p.code = 'W4';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 2 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'figure-rise' WHERE c.slug = 'fan-expo' AND p.code = 'W5';

INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 3 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'pokemon' WHERE c.slug = 'fan-expo' AND p.code = 'C1';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 2 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'one piece' WHERE c.slug = 'fan-expo' AND p.code = 'C2';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 2 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'vehicles' WHERE c.slug = 'fan-expo' AND p.code = 'C3';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 3 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'blind box trading' WHERE c.slug = 'fan-expo' AND p.code = 'C4';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 1 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'plush' WHERE c.slug = 'fan-expo' AND p.code = 'C4';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 2 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'star wars' WHERE c.slug = 'fan-expo' AND p.code = 'C5';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 2 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'hg other series' WHERE c.slug = 'fan-expo' AND p.code = 'C6';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 3 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'tools paint' WHERE c.slug = 'fan-expo' AND p.code = 'C7';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 3 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'pokemon' WHERE c.slug = 'fan-expo' AND p.code = 'C8';
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT p.id, g.id, 2 FROM shelf_positions p JOIN conventions c ON c.id = p.convention_id
JOIN groupings g ON g.name_key = 'vehicles' WHERE c.slug = 'fan-expo' AND p.code = 'C9';
