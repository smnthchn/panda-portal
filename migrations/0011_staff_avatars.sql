-- Staff avatars: each person's own illustration, stored as a data URI.
--
-- The team is a handful of people and the images are shrunk to 256px in the
-- browser before upload, so a column here beats standing up object storage.
-- They're served from /api/avatar/:id with cache headers, never inlined into
-- JSON, so a dashboard payload doesn't carry every face on the team.

ALTER TABLE employees ADD COLUMN avatar TEXT;
