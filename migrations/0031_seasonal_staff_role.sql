-- Seasonal Staff: the same job as staff on a shorter contract.
--
-- Permission resolution is a single LEFT JOIN against role_permissions, so
-- every (role, permission) pair has to exist or the role would resolve to no
-- permissions at all rather than to its defaults.
--
-- Copied from whatever staff currently allows rather than typed out, because
-- these defaults have been edited in Users & Roles since they were first
-- seeded — volunteers were given the clock, for one — and a hard-coded list
-- here would quietly reinstate the original answer instead of matching the
-- role it's meant to mirror.

INSERT OR IGNORE INTO role_permissions (role, permission, allowed)
SELECT 'seasonal', permission, allowed
FROM role_permissions
WHERE role = 'staff';
