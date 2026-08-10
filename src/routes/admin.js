import { readJsonBody, optionalText, requiredText, BadRequest } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import {
  ROLES,
  ROLE_LABELS,
  PERMISSIONS,
  PERMISSION_KEYS,
  BOSS_LOCKED_PERMISSIONS,
  isValidRole
} from "../lib/permissions.js";

function assertRole(role) {
  if (!isValidRole(role)) {
    throw new BadRequest(`Role must be one of: ${ROLES.join(", ")}.`);
  }
  return role;
}

function assertPermission(permission) {
  if (!PERMISSION_KEYS.includes(permission)) {
    throw new BadRequest("Unknown permission.");
  }
  return permission;
}

/**
 * Builds the full Users & Roles payload: every person with their effective
 * access, the role defaults behind it, and which values are per-person
 * overrides.
 */
export async function handleAdminUsers(request, env) {
  const auth = await requireUser(request, env, "manage_users");
  if (!auth.ok) return auth;

  const [employees, rolePerms, overrides] = await Promise.all([
    env.DB.prepare(
      `SELECT id, email, full_name, role, is_active, location, google_drive_folder_id, created_at
       FROM employees
       ORDER BY is_active DESC, full_name ASC`
    ).all(),
    env.DB.prepare(`SELECT role, permission, allowed FROM role_permissions`).all(),
    env.DB.prepare(`SELECT employee_id, permission, allowed FROM employee_permission_overrides`).all()
  ]);

  const roleDefaults = {};
  for (const role of ROLES) {
    roleDefaults[role] = {};
    for (const key of PERMISSION_KEYS) {
      roleDefaults[role][key] = false;
    }
  }
  for (const row of rolePerms.results || []) {
    if (roleDefaults[row.role]) {
      roleDefaults[row.role][row.permission] = row.allowed === 1;
    }
  }

  const overridesByEmployee = {};
  for (const row of overrides.results || []) {
    overridesByEmployee[row.employee_id] ??= {};
    overridesByEmployee[row.employee_id][row.permission] = row.allowed === 1;
  }

  const users = (employees.results || []).map(employee => {
    const employeeOverrides = overridesByEmployee[employee.id] || {};
    const defaults = roleDefaults[employee.role] || {};
    const effective = {};

    for (const key of PERMISSION_KEYS) {
      effective[key] = employeeOverrides[key] ?? defaults[key] ?? false;
    }

    return {
      ...employee,
      is_active: employee.is_active === 1,
      permissions: effective,
      overrides: employeeOverrides
    };
  });

  return {
    ok: true,
    users,
    roles: ROLES.map(role => ({ key: role, label: ROLE_LABELS[role] })),
    permissions: PERMISSIONS,
    roleDefaults,
    lockedRolePermissions: { boss: BOSS_LOCKED_PERMISSIONS },
    currentUserId: auth.user.id
  };
}

export async function handleCreateUser(request, env) {
  const auth = await requireUser(request, env, "manage_users");
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);

  const email = requiredText(body.email, "Email").toLowerCase();
  const fullName = requiredText(body.full_name, "Full name");
  const role = assertRole(optionalText(body.role) || "volunteer");

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new BadRequest("That doesn't look like a valid email address.");
  }

  const existing = await env.DB.prepare(
    `SELECT id FROM employees WHERE lower(email) = ?`
  ).bind(email).first();

  if (existing) {
    throw new BadRequest("Someone with that email already exists.");
  }

  await env.DB.prepare(
    `INSERT INTO employees (email, full_name, role, location, google_drive_folder_id, is_active)
     VALUES (?, ?, ?, ?, ?, 1)`
  ).bind(
    email,
    fullName,
    role,
    optionalText(body.location),
    optionalText(body.google_drive_folder_id)
  ).run();

  return { ok: true };
}

export async function handleUpdateUser(request, env, userId) {
  const auth = await requireUser(request, env, "manage_users");
  if (!auth.ok) return auth;

  const id = Number(userId);
  const body = await readJsonBody(request);

  const employee = await env.DB.prepare(
    `SELECT id, role, is_active FROM employees WHERE id = ?`
  ).bind(id).first();

  if (!employee) {
    throw new BadRequest("That person no longer exists.");
  }

  const isSelf = id === auth.user.id;
  const role = body.role === undefined ? employee.role : assertRole(optionalText(body.role));
  const isActive = body.is_active === undefined ? employee.is_active === 1 : body.is_active === true;

  if (isSelf && role !== "boss") {
    throw new BadRequest("You can't change your own role away from Boss.");
  }

  if (isSelf && !isActive) {
    throw new BadRequest("You can't deactivate your own account.");
  }

  // Don't allow the last active Boss to be demoted or switched off.
  if (employee.role === "boss" && (role !== "boss" || !isActive)) {
    const otherBosses = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM employees
       WHERE role = 'boss' AND is_active = 1 AND id != ?`
    ).bind(id).first();

    if ((otherBosses?.count || 0) === 0) {
      throw new BadRequest("There must be at least one active Boss.");
    }
  }

  // The UI sends partial patches (just a role, just an active toggle), so only
  // touch the columns actually present in the body.
  const updates = ["role = ?", "is_active = ?"];
  const values = [role, isActive ? 1 : 0];

  if (body.full_name !== undefined) {
    updates.push("full_name = ?");
    values.push(requiredText(body.full_name, "Full name"));
  }

  for (const field of ["location", "google_drive_folder_id"]) {
    if (body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(optionalText(body[field]));
    }
  }

  await env.DB.prepare(
    `UPDATE employees
     SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(...values, id).run();

  // A deactivated account shouldn't keep an open session.
  if (!isActive) {
    await env.DB.prepare(`DELETE FROM sessions WHERE employee_id = ?`).bind(id).run();
  }

  return { ok: true };
}

/**
 * Sets or clears one per-person override.
 * body.allowed: true = always allow, false = always deny, null = inherit role.
 */
export async function handleSetUserPermission(request, env, userId) {
  const auth = await requireUser(request, env, "manage_users");
  if (!auth.ok) return auth;

  const id = Number(userId);
  const body = await readJsonBody(request);
  const permission = assertPermission(optionalText(body.permission));

  const employee = await env.DB.prepare(
    `SELECT id, role FROM employees WHERE id = ?`
  ).bind(id).first();

  if (!employee) {
    throw new BadRequest("That person no longer exists.");
  }

  if (id === auth.user.id && BOSS_LOCKED_PERMISSIONS.includes(permission) && body.allowed === false) {
    throw new BadRequest("You can't remove your own portal or user-management access.");
  }

  if (body.allowed === null || body.allowed === undefined) {
    await env.DB.prepare(
      `DELETE FROM employee_permission_overrides WHERE employee_id = ? AND permission = ?`
    ).bind(id, permission).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO employee_permission_overrides (employee_id, permission, allowed, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (employee_id, permission)
       DO UPDATE SET allowed = excluded.allowed, updated_at = CURRENT_TIMESTAMP`
    ).bind(id, permission, body.allowed === true ? 1 : 0).run();
  }

  return { ok: true };
}

/** Sets one role default. */
export async function handleSetRolePermission(request, env) {
  const auth = await requireUser(request, env, "manage_users");
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);
  const role = assertRole(optionalText(body.role));
  const permission = assertPermission(optionalText(body.permission));
  const allowed = body.allowed === true;

  if (role === "boss" && BOSS_LOCKED_PERMISSIONS.includes(permission) && !allowed) {
    throw new BadRequest("Boss must keep portal and user-management access.");
  }

  await env.DB.prepare(
    `INSERT INTO role_permissions (role, permission, allowed)
     VALUES (?, ?, ?)
     ON CONFLICT (role, permission)
     DO UPDATE SET allowed = excluded.allowed`
  ).bind(role, permission, allowed ? 1 : 0).run();

  return { ok: true };
}
