-- Roles become: boss, staff, volunteer.
-- Visibility becomes: a default per (role, permission), plus optional
-- per-person overrides that win over the role default.

-- Old roles -> new roles. admin and manager both become boss.
UPDATE employees SET role = 'boss' WHERE role IN ('admin', 'manager');
UPDATE employees SET role = 'staff' WHERE role NOT IN ('boss', 'staff', 'volunteer');

-- Knowledge base sections were gated on the old role names.
UPDATE knowledge_base_sections SET allowed_role = 'boss' WHERE allowed_role IN ('admin', 'manager');
UPDATE knowledge_base_sections SET allowed_role = 'staff' WHERE allowed_role NOT IN ('boss', 'staff', 'volunteer');

CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  allowed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (role, permission)
);

-- Sparse: a row exists only where a person deviates from their role default.
CREATE TABLE IF NOT EXISTS employee_permission_overrides (
  employee_id INTEGER NOT NULL,
  permission TEXT NOT NULL,
  allowed INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (employee_id, permission),
  FOREIGN KEY (employee_id) REFERENCES employees(id)
);

-- Role defaults. Keep every (role, permission) pair present so permission
-- resolution can be a single LEFT JOIN.
INSERT OR IGNORE INTO role_permissions (role, permission, allowed) VALUES
  ('boss', 'portal_access', 1),
  ('boss', 'knowledge_base', 1),
  ('boss', 'employee_folder', 1),
  ('boss', 'clock', 1),
  ('boss', 'conventions', 1),
  ('boss', 'manage_conventions', 1),
  ('boss', 'manage_users', 1),

  ('staff', 'portal_access', 1),
  ('staff', 'knowledge_base', 1),
  ('staff', 'employee_folder', 1),
  ('staff', 'clock', 1),
  ('staff', 'conventions', 1),
  ('staff', 'manage_conventions', 0),
  ('staff', 'manage_users', 0),

  ('volunteer', 'portal_access', 1),
  ('volunteer', 'knowledge_base', 0),
  ('volunteer', 'employee_folder', 0),
  ('volunteer', 'clock', 0),
  ('volunteer', 'conventions', 1),
  ('volunteer', 'manage_conventions', 0),
  ('volunteer', 'manage_users', 0);

-- Carry the old per-person boolean columns forward as overrides, but only where
-- the person was denied something their new role grants by default.
INSERT OR IGNORE INTO employee_permission_overrides (employee_id, permission, allowed)
SELECT e.id, 'portal_access', 0 FROM employees e WHERE e.can_access_portal = 0;

INSERT OR IGNORE INTO employee_permission_overrides (employee_id, permission, allowed)
SELECT e.id, 'knowledge_base', 0 FROM employees e WHERE e.can_view_knowledge_base = 0;

INSERT OR IGNORE INTO employee_permission_overrides (employee_id, permission, allowed)
SELECT e.id, 'employee_folder', 0 FROM employees e WHERE e.can_view_employee_folder = 0;

INSERT OR IGNORE INTO employee_permission_overrides (employee_id, permission, allowed)
SELECT e.id, 'clock', 0 FROM employees e WHERE e.can_use_clock = 0;

-- The can_* columns on employees are superseded by the two tables above and are
-- no longer read by the worker. Left in place so nothing is lost; safe to drop
-- once you're happy with the new model.

-- Session expiry is now enforced, and expires_at needs to be in SQLite's
-- datetime() format to compare correctly. Clearing the table just forces a
-- re-login.
DELETE FROM sessions;
