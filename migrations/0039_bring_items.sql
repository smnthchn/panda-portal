-- The bring list's items, in the portal so they can be ticked off as they're
-- picked. The Google Sheet stays the planning surface (cuts, quantities, the
-- TCG cull); this is a per-event snapshot of the decided rows, imported from
-- it, because several people picking at once need per-item ticks that record
-- who and when — which a view-only sheet can't do.
--
-- A tick is one row's picked_by/picked_at, so two people picking different
-- items can't overwrite each other — same reasoning as shelf_stage_flags.
CREATE TABLE IF NOT EXISTS bring_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  convention_id INTEGER NOT NULL,
  grouping_id INTEGER,                    -- NULL: the ungrouped Up Top / side-hang blocks
  label TEXT NOT NULL DEFAULT '',         -- Sam's product-line label, the unit of movement
  sku TEXT NOT NULL,
  title TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,         -- how many to pull, from the sheet's bring qty
  placement TEXT NOT NULL DEFAULT 'tier',
  picked_by INTEGER,
  picked_at TEXT,
  FOREIGN KEY (convention_id) REFERENCES conventions(id),
  FOREIGN KEY (grouping_id) REFERENCES groupings(id),
  FOREIGN KEY (picked_by) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_bring_items_grouping
  ON bring_items (convention_id, grouping_id);
