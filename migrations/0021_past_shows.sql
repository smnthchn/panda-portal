-- The shows Panda Hobby has already done, so the booth plans, schedules and
-- takings have something to hang off.
--
-- Dates are not from memory: they're the days the Events & Conventions till
-- rang anything up, which is the only record that can't disagree with the
-- sales figures we compare against.
--
-- INSERT OR IGNORE keyed on the unique slug, so re-running is harmless and a
-- fresh local database gets the same history as production.

INSERT OR IGNORE INTO conventions
  (name, slug, venue, address, starts_on, ends_on, is_published, notes)
VALUES
  ('Anime North 2025', 'anime-north-2025',
   'Toronto Congress Centre', '650 Dixon Rd, Etobicoke, ON M9W 1J1',
   '2025-05-23', '2025-05-25', 1,
   '8 booths, 10 x 10 ft each (40 x 20 ft). 869 orders, $75,856 through the convention till.'),

  ('Fan Expo 2025', 'fan-expo-2025',
   'Metro Toronto Convention Centre', '255 Front St W, Toronto, ON M5V 2W6',
   '2025-08-21', '2025-08-24', 1,
   '6 booths, 10 x 8 ft each (480 sq ft). 743 orders, $49,640 through the convention till.'),

  ('Anime North 2026', 'anime-north-2026',
   'Toronto Congress Centre', '650 Dixon Rd, Etobicoke, ON M9W 1J1',
   '2026-05-22', '2026-05-24', 1,
   '8 booths, 10 x 10 ft each (40 x 20 ft). 706 orders, $57,310 through the convention till.');

-- Hours are the first and last sale the convention till rang each day,
-- rounded to the hour and read in Toronto time — not the programme's opening
-- times. They describe when the booth was actually taking money, which is
-- what the coverage check should be judged against.
--
-- Toronto time on purpose. Grouped by UTC, Anime North's Friday evening lands
-- on Saturday and the day looks half the size it was: 110 orders instead of
-- 184. The same trap the clock report already documents.
--
-- One statement per day rather than a UNION ALL chain: D1 caps the number of
-- terms allowed in a compound SELECT and rejects the whole migration.

INSERT OR IGNORE INTO convention_days (convention_id, day_date, regular_start, regular_end)
SELECT id, '2025-05-23', '16:00', '22:00' FROM conventions WHERE slug = 'anime-north-2025';
INSERT OR IGNORE INTO convention_days (convention_id, day_date, regular_start, regular_end)
SELECT id, '2025-05-24', '10:00', '20:00' FROM conventions WHERE slug = 'anime-north-2025';
INSERT OR IGNORE INTO convention_days (convention_id, day_date, regular_start, regular_end)
SELECT id, '2025-05-25', '10:00', '17:00' FROM conventions WHERE slug = 'anime-north-2025';

INSERT OR IGNORE INTO convention_days (convention_id, day_date, regular_start, regular_end)
SELECT id, '2025-08-21', '14:00', '21:00' FROM conventions WHERE slug = 'fan-expo-2025';
INSERT OR IGNORE INTO convention_days (convention_id, day_date, regular_start, regular_end)
SELECT id, '2025-08-22', '09:00', '19:00' FROM conventions WHERE slug = 'fan-expo-2025';
INSERT OR IGNORE INTO convention_days (convention_id, day_date, regular_start, regular_end)
SELECT id, '2025-08-23', '09:00', '19:00' FROM conventions WHERE slug = 'fan-expo-2025';
INSERT OR IGNORE INTO convention_days (convention_id, day_date, regular_start, regular_end)
SELECT id, '2025-08-24', '10:00', '17:00' FROM conventions WHERE slug = 'fan-expo-2025';

INSERT OR IGNORE INTO convention_days (convention_id, day_date, regular_start, regular_end)
SELECT id, '2026-05-22', '16:00', '22:00' FROM conventions WHERE slug = 'anime-north-2026';
INSERT OR IGNORE INTO convention_days (convention_id, day_date, regular_start, regular_end)
SELECT id, '2026-05-23', '09:00', '20:00' FROM conventions WHERE slug = 'anime-north-2026';
INSERT OR IGNORE INTO convention_days (convention_id, day_date, regular_start, regular_end)
SELECT id, '2026-05-24', '09:00', '17:00' FROM conventions WHERE slug = 'anime-north-2026';
