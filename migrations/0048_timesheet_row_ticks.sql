-- The boss's tick on a timesheet row: "I've looked at this one". A bookmark
-- for where a review left off, so it can be paused and picked up again; it
-- isn't an approval. row_key is shift:<clock-in stamp>, no_show:<scheduled
-- shift id> or holiday:<date>. Approve all ticks every row of the person.
CREATE TABLE IF NOT EXISTS timesheet_row_ticks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  row_key TEXT NOT NULL,
  ticked_by INTEGER NOT NULL,
  ticked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (employee_id, row_key),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (ticked_by) REFERENCES employees(id)
);
