-- Setup day and store close day are tracked separately from the show's own
-- start/end dates, since they usually fall outside them.

ALTER TABLE conventions ADD COLUMN setup_on TEXT;
ALTER TABLE conventions ADD COLUMN store_close_on TEXT;
