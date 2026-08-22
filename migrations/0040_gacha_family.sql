-- Gacha: the prize pool for the gacha machine, which sits on P2 at Fan Expo.
--
-- It's a family like any other for the portal's purposes — it has a tab of
-- the bring list sheet, it gets picked at the store, and the people packing
-- P2 need its list on their phone. Its contents aren't a product line,
-- though: it's a hand-picked mix across figures, plush and blind boxes, so
-- there's no Shopify query that would find it. The sheet is the list.
--
-- Where a prize is also on another shelf's bring list and the store doesn't
-- hold enough to feed both, it stays on the shelf and comes off the gacha
-- list (Sam, 22 Aug 2026) — 14 rows were cut that way on the first load.
INSERT OR IGNORE INTO groupings (name, name_key, placement, sort_order, notes, bring_list_url)
VALUES (
  'Gacha', 'gacha', 'tier', 90,
  'Prize pool for the gacha machine. No Shopify query — the sheet tab is the list.',
  'https://docs.google.com/spreadsheets/d/1H1Xib2JM5CIwemmhRgjfrF1S_oqCnFLcieDUCIAGuwY/edit#gid=0'
);

-- P2 carries it at Fan Expo 2026. A subselect, so a database without that
-- event (local dev) simply assigns nothing.
INSERT OR IGNORE INTO shelf_groupings (position_id, grouping_id, facings)
SELECT sp.id, g.id, 1
FROM shelf_positions sp
JOIN conventions c ON c.id = sp.convention_id AND c.slug = 'fan-expo'
JOIN groupings g ON g.name_key = 'gacha'
WHERE sp.code = 'P2';
