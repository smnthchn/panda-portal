import { readJsonBody, optionalText, BadRequest } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";

/**
 * Availability and time off.
 *
 * Availability is the recurring pattern; time off is a specific stretch of
 * dates that has to be asked for and answered. Everyone manages their own;
 * a boss can edit anyone's and decide requests.
 */

export const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const STATUSES = ["pending", "approved", "declined"];

/** Fills in the days nobody has said anything about — available, no limits. */
export function fullWeek(rows = []) {
  const byWeekday = new Map(rows.map(row => [row.weekday, row]));

  return WEEKDAY_NAMES.map((name, weekday) => {
    const row = byWeekday.get(weekday);
    return {
      weekday,
      name,
      is_available: row ? row.is_available === 1 : true,
      earliest: row?.earliest || "",
      latest: row?.latest || ""
    };
  });
}

/**
 * Whether someone can work a given shift, given their week and their time off.
 * Returns null when there's nothing to say, else a short reason.
 *
 * Approved time off is a hard clash. A pending request is worth knowing about
 * while you build, so it's reported too, in weaker words.
 */
export function availabilityConflict(week, timeOff, { date, weekday, startsAt, endsAt }) {
  const off = (timeOff || []).find(
    request => request.starts_on <= date && request.ends_on >= date
  );

  if (off?.status === "approved") return { level: "clash", reason: "on approved time off" };
  if (off?.status === "pending") return { level: "warn", reason: "has time off pending" };

  const day = (week || []).find(entry => entry.weekday === weekday);
  if (!day) return null;

  if (!day.is_available) {
    return { level: "clash", reason: `not available ${WEEKDAY_NAMES[weekday]}s` };
  }

  if (day.earliest && startsAt && startsAt < day.earliest) {
    return { level: "warn", reason: `not before ${day.earliest} on ${WEEKDAY_NAMES[weekday]}s` };
  }

  if (day.latest && endsAt && endsAt > day.latest) {
    return { level: "warn", reason: `not after ${day.latest} on ${WEEKDAY_NAMES[weekday]}s` };
  }

  return null;
}

async function loadWeek(db, employeeId) {
  const rows = await db.prepare(
    `SELECT weekday, is_available, earliest, latest
     FROM employee_availability WHERE employee_id = ?`
  ).bind(employeeId).all();

  return fullWeek(rows.results || []);
}

async function loadTimeOff(db, employeeId) {
  const rows = await db.prepare(
    `SELECT t.*, e.full_name AS decided_by_name
     FROM time_off_requests t
     LEFT JOIN employees e ON e.id = t.decided_by
     WHERE t.employee_id = ? AND t.ends_on >= date('now', '-90 days')
     ORDER BY t.starts_on DESC`
  ).bind(employeeId).all();

  return rows.results || [];
}

export async function handleMyAvailability(request, env) {
  const auth = await requireUser(request, env);
  if (!auth.ok) return auth;

  const [week, timeOff] = await Promise.all([
    loadWeek(env.DB, auth.user.id),
    loadTimeOff(env.DB, auth.user.id)
  ]);

  return { ok: true, employee: { id: auth.user.id, full_name: auth.user.full_name }, week, timeOff };
}

/** Saves a whole week at once, so a day left out means "no limits". */
async function saveWeek(db, employeeId, rows) {
  const statements = (Array.isArray(rows) ? rows : []).map(row => {
    const weekday = Number(row.weekday);

    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new BadRequest("That isn't a day of the week.");
    }

    const available = row.is_available !== false;
    const earliest = available ? optionalText(row.earliest) : null;
    const latest = available ? optionalText(row.latest) : null;

    for (const [value, label] of [[earliest, "Earliest"], [latest, "Latest"]]) {
      if (value && !HHMM.test(value)) {
        throw new BadRequest(`${label} must be a time like 09:30.`);
      }
    }

    if (earliest && latest && latest <= earliest) {
      throw new BadRequest(`${WEEKDAY_NAMES[weekday]}'s latest time must be after its earliest.`);
    }

    return db.prepare(
      `INSERT INTO employee_availability (employee_id, weekday, is_available, earliest, latest, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (employee_id, weekday) DO UPDATE SET
         is_available = excluded.is_available,
         earliest = excluded.earliest,
         latest = excluded.latest,
         updated_at = CURRENT_TIMESTAMP`
    ).bind(employeeId, weekday, available ? 1 : 0, earliest, latest);
  });

  if (statements.length) await db.batch(statements);
}

export async function handleSaveMyAvailability(request, env) {
  const auth = await requireUser(request, env);
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);
  await saveWeek(env.DB, auth.user.id, body.week);

  return { ok: true };
}

/** A boss editing someone else's week — same shape, different owner. */
export async function handleSaveStaffAvailability(request, env, staffId) {
  const auth = await requireUser(request, env, "manage_users");
  if (!auth.ok) return auth;

  const id = Number(staffId);
  const person = await env.DB.prepare(`SELECT id FROM employees WHERE id = ?`).bind(id).first();
  if (!person) throw new BadRequest("That person no longer exists.");

  const body = await readJsonBody(request);
  await saveWeek(env.DB, id, body.week);

  return { ok: true };
}

/** Anyone can ask for time off for themselves. */
export async function handleRequestTimeOff(request, env) {
  const auth = await requireUser(request, env);
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);
  const startsOn = optionalText(body.starts_on);
  const endsOn = optionalText(body.ends_on) || startsOn;

  if (!ISO_DATE.test(startsOn || "") || !ISO_DATE.test(endsOn || "")) {
    throw new BadRequest("Pick the dates you'd be away.");
  }

  if (endsOn < startsOn) {
    throw new BadRequest("The last day can't be before the first.");
  }

  // A boss asking for their own time off doesn't need to ask anyone.
  const isBoss = Boolean(auth.user.permissions.manage_users);

  const overlap = await env.DB.prepare(
    `SELECT id FROM time_off_requests
     WHERE employee_id = ? AND status != 'declined'
       AND starts_on <= ? AND ends_on >= ?`
  ).bind(auth.user.id, endsOn, startsOn).first();

  if (overlap) {
    return { ok: false, error: "You already have time off covering some of those days." };
  }

  await env.DB.prepare(
    `INSERT INTO time_off_requests
       (employee_id, starts_on, ends_on, reason, status, decided_by, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    auth.user.id,
    startsOn,
    endsOn,
    optionalText(body.reason),
    isBoss ? "approved" : "pending",
    isBoss ? auth.user.id : null,
    isBoss ? new Date().toISOString().slice(0, 19).replace("T", " ") : null
  ).run();

  return { ok: true };
}

/** Cancelling your own request, or a boss removing anyone's. */
export async function handleDeleteTimeOff(request, env, requestId) {
  const auth = await requireUser(request, env);
  if (!auth.ok) return auth;

  const id = Number(requestId);
  const row = await env.DB.prepare(
    `SELECT id, employee_id, status FROM time_off_requests WHERE id = ?`
  ).bind(id).first();

  if (!row) return { ok: false, error: "That request no longer exists." };

  const isBoss = Boolean(auth.user.permissions.manage_users);

  if (row.employee_id !== auth.user.id && !isBoss) {
    return { ok: false, error: "That isn't yours to cancel." };
  }

  // Once it's been answered, only a boss can undo it.
  if (row.status !== "pending" && !isBoss) {
    return { ok: false, error: "That's already been answered — ask a boss to change it." };
  }

  await env.DB.prepare(`DELETE FROM time_off_requests WHERE id = ?`).bind(id).run();

  return { ok: true };
}

export async function handleDecideTimeOff(request, env, requestId) {
  const auth = await requireUser(request, env, "manage_users");
  if (!auth.ok) return auth;

  const id = Number(requestId);
  const body = await readJsonBody(request);
  const status = optionalText(body.status);

  if (!STATUSES.includes(status) || status === "pending") {
    throw new BadRequest("Approve it or decline it.");
  }

  const row = await env.DB.prepare(
    `SELECT id FROM time_off_requests WHERE id = ?`
  ).bind(id).first();

  if (!row) return { ok: false, error: "That request no longer exists." };

  await env.DB.prepare(
    `UPDATE time_off_requests
     SET status = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP, decision_note = ?
     WHERE id = ?`
  ).bind(status, auth.user.id, optionalText(body.note), id).run();

  return { ok: true };
}

/** Everything a boss still has to answer. */
export async function handlePendingTimeOff(request, env) {
  const auth = await requireUser(request, env, "manage_users");
  if (!auth.ok) return auth;

  const rows = await env.DB.prepare(
    `SELECT t.*, e.full_name AS employee_name
     FROM time_off_requests t
     JOIN employees e ON e.id = t.employee_id
     WHERE t.status = 'pending'
     ORDER BY t.starts_on ASC`
  ).all();

  return { ok: true, requests: rows.results || [] };
}

/** The week and time off for one person — used by the Staff page. */
export async function loadPersonAvailability(db, employeeId) {
  const [week, timeOff] = await Promise.all([
    loadWeek(db, employeeId),
    loadTimeOff(db, employeeId)
  ]);

  return { week, timeOff };
}

/**
 * Availability for everyone at once, keyed by employee id — what the schedule
 * builder needs to flag a clash as it's being built.
 */
export async function loadTeamAvailability(db, fromDate, toDate) {
  const [weeks, timeOff] = await Promise.all([
    db.prepare(
      `SELECT employee_id, weekday, is_available, earliest, latest FROM employee_availability`
    ).all(),
    db.prepare(
      `SELECT employee_id, starts_on, ends_on, status
       FROM time_off_requests
       WHERE status != 'declined' AND ends_on >= ? AND starts_on <= ?`
    ).bind(fromDate, toDate).all()
  ]);

  const byEmployee = new Map();

  for (const row of weeks.results || []) {
    if (!byEmployee.has(row.employee_id)) byEmployee.set(row.employee_id, { rows: [], timeOff: [] });
    byEmployee.get(row.employee_id).rows.push(row);
  }

  for (const row of timeOff.results || []) {
    if (!byEmployee.has(row.employee_id)) byEmployee.set(row.employee_id, { rows: [], timeOff: [] });
    byEmployee.get(row.employee_id).timeOff.push(row);
  }

  const result = new Map();
  for (const [employeeId, entry] of byEmployee) {
    result.set(employeeId, { week: fullWeek(entry.rows), timeOff: entry.timeOff });
  }

  return result;
}
