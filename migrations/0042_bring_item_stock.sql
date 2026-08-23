-- What the store holds of each bring item, from the sheet's stock column.
--
-- On a shelf's pick list the bring quantity is usually "all of it", so the
-- number that helps someone at the bins is how many there are to find.
-- Gacha is the exception — its prizes are a portion of a larger stock — so
-- it keeps showing the bring quantity. A snapshot, like sku_count: the
-- worker has no Shopify access, so it's refreshed from the sheet.
ALTER TABLE bring_items ADD COLUMN stock INTEGER;
