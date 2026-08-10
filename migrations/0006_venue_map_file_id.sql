-- The venue map is a Drive file, embedded the same way as the booth layout,
-- not an external link. Replaces the venue_map_url column added in 0005, which
-- never held any data.

ALTER TABLE conventions ADD COLUMN venue_map_file_id TEXT;
ALTER TABLE conventions DROP COLUMN venue_map_url;
