import { readJsonBody, optionalText, BadRequest } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { ROLES, ROLE_LABELS } from "../lib/permissions.js";

/**
 * The people side of the portal: who works here, how to reach them, what
 * Drive folder is theirs, and which shifts they're on.
 *
 * Access — roles and permission overrides — stays in Users & Roles. This is
 * the person, not their login.
 */

const PROFILE_FIELDS = ["phone", "location", "started_on", "notes", "google_drive_folder_id"];

export async function handleStaffList(request, env) {
  const auth = await requireUser(request, env, "manage_users");
  if (!auth.ok) return auth;

  const [people, shiftCounts] = await Promise.all([
    env.DB.prepare(
      `SELECT id, full_name, email, role, is_active, phone, location,
              started_on, notes, google_drive_folder_id
       FROM employees
       ORDER BY is_active DESC, full_name ASC`
    ).all(),

    // Shifts still to come, so the list shows who's already committed.
    env.DB.prepare(
      `SELECT employee_id, COUNT(*) AS upcoming
       FROM convention_shifts
       WHERE employee_id IS NOT NULL AND shift_date >= date('now')
       GROUP BY employee_id`
    ).all()
  ]);

  const upcomingById = new Map(
    (shiftCounts.results || []).map(row => [row.employee_id, row.upcoming])
  );

  return {
    ok: true,
    staff: (people.results || []).map(person => ({
      ...person,
      is_active: person.is_active === 1,
      upcoming_shifts: upcomingById.get(person.id) || 0
    })),
    roles: ROLES.map(role => ({ key: role, label: ROLE_LABELS[role] })),
    currentUserId: auth.user.id
  };
}

export async function handleStaffDetail(request, env, staffId) {
  const auth = await requireUser(request, env, "manage_users");
  if (!auth.ok) return auth;

  const id = Number(staffId);

  const person = await env.DB.prepare(
    `SELECT id, full_name, email, role, is_active, phone, location,
            started_on, notes, google_drive_folder_id, created_at
     FROM employees WHERE id = ?`
  ).bind(id).first();

  if (!person) {
    return { ok: false, error: "That person no longer exists." };
  }

  const [shiftRows, openRows] = await Promise.all([
    env.DB.prepare(
      `SELECT s.id, s.title, s.shift_date, s.starts_at, s.ends_at,
              s.break_allotment_minutes, s.break_count,
              c.name AS convention_name, c.slug AS convention_slug
       FROM convention_shifts s
       JOIN conventions c ON c.id = s.convention_id
       WHERE s.employee_id = ?
       ORDER BY s.shift_date DESC, s.starts_at DESC
       LIMIT 40`
    ).bind(id).all(),

    // Shifts nobody is on yet, so a person can be dropped straight into one.
    env.DB.prepare(
      `SELECT s.id, s.title, s.shift_date, s.starts_at, s.ends_at,
              c.name AS convention_name
       FROM convention_shifts s
       JOIN conventions c ON c.id = s.convention_id
       WHERE s.employee_id IS NULL AND s.shift_date >= date('now')
       ORDER BY s.shift_date ASC, s.starts_at ASC
       LIMIT 50`
    ).all()
  ]);

  return {
    ok: true,
    person: { ...person, is_active: person.is_active === 1 },
    shifts: shiftRows.results || [],
    openShifts: openRows.results || [],
    roles: ROLES.map(role => ({ key: role, label: ROLE_LABELS[role] })),
    isSelf: id === auth.user.id
  };
}

/** Updates the profile side of a person. Role and active live in Users & Roles. */
export async function handleUpdateStaff(request, env, staffId) {
  const auth = await requireUser(request, env, "manage_users");
  if (!auth.ok) return auth;

  const id = Number(staffId);
  const body = await readJsonBody(request);

  const person = await env.DB.prepare(`SELECT id FROM employees WHERE id = ?`).bind(id).first();
  if (!person) {
    throw new BadRequest("That person no longer exists.");
  }

  const updates = [];
  const values = [];

  if (body.full_name !== undefined) {
    const name = optionalText(body.full_name);
    if (!name) throw new BadRequest("Full name can't be blank.");
    updates.push("full_name = ?");
    values.push(name);
  }

  // The email is the Google account they sign in with, so a typo locks them
  // out — it's validated and kept unique the same way creating a person is.
  if (body.email !== undefined) {
    const email = optionalText(body.email)?.toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new BadRequest("That doesn't look like a valid email address.");
    }

    const clash = await env.DB.prepare(
      `SELECT id FROM employees WHERE lower(email) = ? AND id != ?`
    ).bind(email, id).first();

    if (clash) throw new BadRequest("Someone else already uses that email.");

    updates.push("email = ?");
    values.push(email);
  }

  if (body.started_on !== undefined) {
    const startedOn = optionalText(body.started_on);
    if (startedOn && !/^\d{4}-\d{2}-\d{2}$/.test(startedOn)) {
      throw new BadRequest("Start date must be a date like 2026-09-14.");
    }
  }

  for (const field of PROFILE_FIELDS) {
    if (body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(optionalText(body[field]));
    }
  }

  if (!updates.length) return { ok: true };

  await env.DB.prepare(
    `UPDATE employees SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(...values, id).run();

  return { ok: true };
}

/**
 * Puts a person on a shift, or takes them off it. Assigning from the staff
 * side is the same write the schedule page makes — one column, one owner.
 */
export async function handleAssignShift(request, env, shiftId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const id = Number(shiftId);
  const body = await readJsonBody(request);
  const employeeId = body.employee_id === null || body.employee_id === undefined
    ? null
    : Number(body.employee_id);

  const shift = await env.DB.prepare(
    `SELECT id, shift_date, starts_at, ends_at FROM convention_shifts WHERE id = ?`
  ).bind(id).first();

  if (!shift) {
    return { ok: false, error: "That shift no longer exists." };
  }

  if (employeeId !== null) {
    const person = await env.DB.prepare(
      `SELECT id, full_name FROM employees WHERE id = ? AND is_active = 1`
    ).bind(employeeId).first();

    if (!person) {
      return { ok: false, error: "That person isn't an active member of staff." };
    }

    // Two shifts at once is a scheduling mistake, not something to record.
    const clash = await env.DB.prepare(
      `SELECT id FROM convention_shifts
       WHERE employee_id = ? AND shift_date = ? AND id != ?
         AND starts_at < ? AND ends_at > ?`
    ).bind(employeeId, shift.shift_date, id, shift.ends_at, shift.starts_at).first();

    if (clash) {
      return { ok: false, error: `${person.full_name} is already on an overlapping shift that day.` };
    }
  }

  await env.DB.prepare(
    `UPDATE convention_shifts SET employee_id = ? WHERE id = ?`
  ).bind(employeeId, id).run();

  return { ok: true };
}
