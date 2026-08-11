-- The official page for this specific event. Doubles as a link for staff and as
-- the source the AI lookup is pinned to — without it, a lookup for "Fan Expo"
-- can wander onto the Chicago edition's pages.

ALTER TABLE conventions ADD COLUMN website_url TEXT;
