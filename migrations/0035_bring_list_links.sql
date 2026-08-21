-- Where a family's slice of the bring list lives.
--
-- The SKU-level bring list stays a Google Sheet — the portal stores families
-- and queries, never products, and a 2,400-row import would have changed
-- that. Each family carries a deep link to its tab of the sheet; the plan
-- shows it beside the family wherever the family appears.
ALTER TABLE groupings ADD COLUMN bring_list_url TEXT;
