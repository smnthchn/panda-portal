-- A pasted Google Maps link for the address, a link to the venue's own hall/floor
-- map, and the load-in window (which is usually a couple of hours on setup day).

ALTER TABLE conventions ADD COLUMN map_url TEXT;
ALTER TABLE conventions ADD COLUMN venue_map_url TEXT;
ALTER TABLE conventions ADD COLUMN load_in_start TEXT;
ALTER TABLE conventions ADD COLUMN load_in_end TEXT;
