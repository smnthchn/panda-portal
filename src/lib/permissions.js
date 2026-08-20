export const ROLES = ["boss", "staff", "seasonal", "volunteer"];

export const ROLE_LABELS = {
  boss: "Boss",
  staff: "Staff",
  seasonal: "Seasonal Staff",
  volunteer: "Volunteer"
};

/**
 * Higher rank sees everything a lower rank sees. Used for knowledge base and
 * checklist gating.
 *
 * Seasonal staff sit level with staff on purpose: they're the same job on a
 * shorter contract, so a staff-only checklist or document is theirs to read
 * too. The role exists to say who's seasonal on the roster, not to fence them
 * off. Equal ranks are fine here — nothing is ever gated on "seasonal" itself,
 * so the comparison is only ever asking whether they reach staff.
 */
const ROLE_RANK = {
  volunteer: 0,
  seasonal: 1,
  staff: 1,
  boss: 2
};

export const PERMISSIONS = [
  { key: "portal_access", label: "Sign in to the portal" },
  { key: "knowledge_base", label: "View Knowledge Base" },
  { key: "employee_folder", label: "View My Folder" },
  { key: "clock", label: "Use the Clock" },
  { key: "conventions", label: "View Conventions" },
  { key: "manage_conventions", label: "Create & edit Conventions" },
  { key: "manage_users", label: "Manage Users & Roles" }
];

export const PERMISSION_KEYS = PERMISSIONS.map(p => p.key);

/**
 * Permissions a boss must always keep, so the last admin can't lock themselves
 * (or everyone else) out of the portal.
 */
export const BOSS_LOCKED_PERMISSIONS = ["portal_access", "manage_users"];

export function isValidRole(role) {
  return ROLES.includes(role);
}

export function roleOutranks(role, requiredRole) {
  return (ROLE_RANK[role] ?? -1) >= (ROLE_RANK[requiredRole] ?? 99);
}

/**
 * Resolves effective permissions for one employee: the role default, overridden
 * per-person where an override row exists.
 *
 * Returns { permissions: {key: bool}, overrides: {key: bool} }.
 */
export async function loadEffectivePermissions(db, employeeId, role) {
  const rows = await db.prepare(
    `SELECT rp.permission,
            rp.allowed AS role_allowed,
            eo.allowed AS override_allowed
     FROM role_permissions rp
     LEFT JOIN employee_permission_overrides eo
       ON eo.permission = rp.permission AND eo.employee_id = ?
     WHERE rp.role = ?`
  ).bind(employeeId, role).all();

  const permissions = {};
  const overrides = {};

  for (const key of PERMISSION_KEYS) {
    permissions[key] = false;
  }

  for (const row of rows.results || []) {
    const effective = row.override_allowed === null || row.override_allowed === undefined
      ? row.role_allowed
      : row.override_allowed;

    permissions[row.permission] = effective === 1;

    if (row.override_allowed !== null && row.override_allowed !== undefined) {
      overrides[row.permission] = row.override_allowed === 1;
    }
  }

  return { permissions, overrides };
}
