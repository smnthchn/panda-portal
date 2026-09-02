-- What the movers charge an hour, in cents — one number per event, priced
-- against the Movers card's clocked hours on the Budget page.
ALTER TABLE conventions ADD COLUMN mover_rate_cents INTEGER NOT NULL DEFAULT 0;
