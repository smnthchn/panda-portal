-- Conventions: event details, shift schedule and checklists live here.
-- Long-form documents stay in Drive, linked per convention.

CREATE TABLE IF NOT EXISTS conventions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  venue TEXT,
  address TEXT,
  starts_on TEXT,
  ends_on TEXT,
  booth_number TEXT,
  notes TEXT,
  drive_folder_id TEXT,
  booth_layout_file_id TEXT,
  is_published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- employee_id NULL means the slot is posted but nobody is assigned yet.
CREATE TABLE IF NOT EXISTS convention_shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  convention_id INTEGER NOT NULL,
  employee_id INTEGER,
  title TEXT NOT NULL,
  shift_date TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (convention_id) REFERENCES conventions(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_shifts_convention ON convention_shifts (convention_id);
CREATE INDEX IF NOT EXISTS idx_shifts_employee ON convention_shifts (employee_id);

CREATE TABLE IF NOT EXISTS convention_checklists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  convention_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  visible_to TEXT NOT NULL DEFAULT 'all',
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (convention_id) REFERENCES conventions(id)
);

CREATE INDEX IF NOT EXISTS idx_checklists_convention ON convention_checklists (convention_id);

CREATE TABLE IF NOT EXISTS convention_checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checklist_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  done_by INTEGER,
  done_at TEXT,
  FOREIGN KEY (checklist_id) REFERENCES convention_checklists(id),
  FOREIGN KEY (done_by) REFERENCES employees(id)
);

CREATE INDEX IF NOT EXISTS idx_checklist_items_checklist ON convention_checklist_items (checklist_id);
