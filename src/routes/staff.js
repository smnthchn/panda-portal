import { readJsonBody, optionalText, BadRequest } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { ROLES, ROLE_LABELS } from "../lib/permissions.js";
import { loadPersonAvailability } from "./availability.js";

/* ---------- Avatars ---------- */

const AVATAR_TYPES = ["image/webp", "image/png", "image/jpeg"];

// The browser shrinks to 256px before uploading, which lands well under this.
// The cap is here so a bad client can't push a multi-megabyte row into D1.
const MAX_AVATAR_BYTES = 400 * 1024;

/**
 * Validates an uploaded avatar data URI and splits it into its parts.
 * Throws BadRequest on anything that isn't a plain base64 image — the string
 * ends up in an <img src>, so a stray `svg+xml` would be script execution.
 */
export function parseAvatarDataUri(value) {
  const text = String(value || "").trim();
  const match = /^data:([a-z/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(text);

  if (!match) {
    throw new BadRequest("That image didn't upload cleanly. Try another file.");
  }

  const [, mimeType, base64] = match;

  if (!AVATAR_TYPES.includes(mimeType)) {
    throw new BadRequest("Avatars have to be a PNG, JPEG or WebP image.");
  }

  // 4 base64 chars carry 3 bytes; padding trims one byte each.
  const padding = (base64.match(/=*$/) || [""])[0].length;
  const bytes = (base64.length * 3) / 4 - padding;

  if (bytes > MAX_AVATAR_BYTES) {
    throw new BadRequest("That image is too big even after shrinking. Try a smaller one.");
  }

  return { mimeType, base64, bytes };
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Anyone signed in can see a colleague's face; nobody else can. */
export async function handleGetAvatar(request, env, staffId) {
  const auth = await requireUser(request, env);
  if (!auth.ok) return new Response("Not found", { status: 404 });

  const row = await env.DB.prepare(
    `SELECT avatar FROM employees WHERE id = ?`
  ).bind(Number(staffId)).first();

  if (!row?.avatar) return new Response("Not found", { status: 404 });

  let parsed;
  try {
    parsed = parseAvatarDataUri(row.avatar);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  return new Response(base64ToBytes(parsed.base64), {
    headers: {
      "Content-Type": parsed.mimeType,
      // Cache-busted by the ?v= the client appends, so this can be long.
      "Cache-Control": "private, max-age=86400",
      "Content-Security-Policy": "default-src 'none'; sandbox"
    }
  });
}

export async function handleSetAvatar(request, env, staffId) {
  const auth = await requireUser(request, env, "manage_users");
  if (!auth.ok) return auth;

  const id = Number(staffId);
  const body = await readJsonBody(request);

  const person = await env.DB.prepare(`SELECT id FROM employees WHERE id = ?`).bind(id).first();
  if (!person) throw new BadRequest("That person no longer exists.");

  // A null avatar clears it — that's how Remove works. Otherwise store a
  // string rebuilt from the validated parts rather than the raw input.
  let avatar = null;
  if (body.avatar !== null && body.avatar !== undefined) {
    const { mimeType, base64 } = parseAvatarDataUri(body.avatar);
    avatar = `data:${mimeType};base64,${base64}`;
  }

  await env.DB.prepare(
    `UPDATE employees SET avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(avatar, id).run();

  return { ok: true, avatar_url: avatar ? avatarUrlFor(id, new Date().toISOString()) : null };
}

/** Where the browser fetches a person's avatar, cache-busted by last edit. */
export function avatarUrlFor(id, updatedAt) {
  const version = String(updatedAt || "").replace(/\D/g, "").slice(0, 14);
  return `/api/avatar/${id}?v=${version}`;
}

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
              started_on, notes, google_drive_folder_id,
              avatar IS NOT NULL AS has_avatar, updated_at
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
      avatar_url: person.has_avatar ? avatarUrlFor(person.id, person.updated_at) : null,
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
            started_on, notes, google_drive_folder_id, created_at,
            avatar IS NOT NULL AS has_avatar, updated_at
     FROM employees WHERE id = ?`
  ).bind(id).first();

  if (!person) {
    return { ok: false, error: "That person no longer exists." };
  }

  const [shiftRows, openRows, availability] = await Promise.all([
    // LEFT JOIN: a store shift has no convention, and dropping those here
    // would quietly hide half of someone's week.
    env.DB.prepare(
      `SELECT s.id, s.title, s.shift_date, s.starts_at, s.ends_at,
              s.break_allotment_minutes, s.break_count,
              c.name AS convention_name, c.slug AS convention_slug
       FROM convention_shifts s
       LEFT JOIN conventions c ON c.id = s.convention_id
       WHERE s.employee_id = ?
       ORDER BY s.shift_date DESC, s.starts_at DESC
       LIMIT 40`
    ).bind(id).all(),

    // Shifts nobody is on yet, so a person can be dropped straight into one.
    env.DB.prepare(
      `SELECT s.id, s.title, s.shift_date, s.starts_at, s.ends_at,
              c.name AS convention_name
       FROM convention_shifts s
       LEFT JOIN conventions c ON c.id = s.convention_id
       WHERE s.employee_id IS NULL AND s.shift_date >= date('now')
       ORDER BY s.shift_date ASC, s.starts_at ASC
       LIMIT 50`
    ).all(),

    loadPersonAvailability(env.DB, id)
  ]);

  return {
    ok: true,
    person: {
      ...person,
      is_active: person.is_active === 1,
      avatar_url: person.has_avatar ? avatarUrlFor(person.id, person.updated_at) : null
    },
    shifts: shiftRows.results || [],
    openShifts: openRows.results || [],
    availability: availability.week,
    timeOff: availability.timeOff,
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
