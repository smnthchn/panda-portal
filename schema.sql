CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  location TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  can_access_portal INTEGER NOT NULL DEFAULT 1,
  can_view_knowledge_base INTEGER NOT NULL DEFAULT 1,
  can_view_employee_folder INTEGER NOT NULL DEFAULT 1,
  can_use_clock INTEGER NOT NULL DEFAULT 1,
  google_drive_folder_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS knowledge_base_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  folder_id TEXT NOT NULL,
  allowed_role TEXT NOT NULL DEFAULT 'staff',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS clock_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  payroll_id TEXT,
  pin_code TEXT,
  clock_user_status TEXT,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);