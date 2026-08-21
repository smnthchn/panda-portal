-- How many physical copies of a board the store owns. Hand-typed on the
-- Resources page; NULL means nobody has said. Shown beside the board's name
-- wherever the board appears, so "can C3 have one too?" is answerable from
-- the plan.
ALTER TABLE resources ADD COLUMN qty INTEGER;
