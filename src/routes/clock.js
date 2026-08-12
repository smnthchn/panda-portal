import { requireUser } from "../lib/auth.js";

// event type -> [status required to do it, status it leaves you in]
const TRANSITIONS = {
  clock_in: { from: ["out"], to: "in", error: "User is already clocked in." },
  clock_out: { from: ["in"], to: "out", error: "User is not currently clocked in." },
  break_start: { from: ["in"], to: "break", error: "User must be clocked in before starting a break." },
  break_end: { from: ["break"], to: "in", error: "User is not currently on break." }
};

/** Returns the clock profile for an employee, creating an idle one if missing. */
async function getOrCreateProfile(db, employeeId) {
  const existing = await db.prepare(
    `SELECT id, payroll_id, clock_user_status
     FROM clock_profiles
     WHERE employee_id = ?`
  ).bind(employeeId).first();

  if (existing) {
    return existing;
  }

  await db.prepare(
    `INSERT INTO clock_profiles (employee_id, clock_user_status)
     VALUES (?, 'out')`
  ).bind(employeeId).run();

  return db.prepare(
    `SELECT id, payroll_id, clock_user_status
     FROM clock_profiles
     WHERE employee_id = ?`
  ).bind(employeeId).first();
}

export async function handleClockStatus(request, env) {
  const auth = await requireUser(request, env, "clock");
  if (!auth.ok) return auth;

  const profile = await getOrCreateProfile(env.DB, auth.user.id);

  const lastEvent = await env.DB.prepare(
    `SELECT event_type, created_at
     FROM clock_events
     WHERE employee_id = ?
     ORDER BY id DESC
     LIMIT 1`
  ).bind(auth.user.id).first();

  return {
    ok: true,
    employee: {
      id: auth.user.id,
      full_name: auth.user.full_name,
      email: auth.user.email,
      role: auth.user.role
    },
    profile,
    last_event: lastEvent || null
  };
}

/* ---------- Hours (paired from the punch log) ---------- */

/** SQLite's CURRENT_TIMESTAMP is UTC with no marker; make Date.parse treat it so. */
function toMs(dt) {
  return Date.parse(dt.includes("T") ? dt : dt.replace(" ", "T") + "Z");
}

function minutesBetween(a, b) {
  return (toMs(b) - toMs(a)) / 60000;
}

function finishShift(open, outAt) {
  // A break that was never ended runs until clock-out. On a shift with no
  // clock-out there's nothing to measure, so it contributes nothing.
  let breakMinutes = open.break_minutes;
  if (open.breakStart && outAt) breakMinutes += minutesBetween(open.breakStart, outAt);

  const total = outAt ? minutesBetween(open.in_at, outAt) : null;

  return {
    in_at: open.in_at,
    out_at: outAt,
    break_minutes: Math.round(breakMinutes),
    net_minutes: total === null ? null : Math.max(0, Math.round(total - breakMinutes))
  };
}

/**
 * Walks one employee's punches (ascending) and pairs them into shifts.
 *
 * The state machine in TRANSITIONS keeps live data well-formed, but this stays
 * defensive about history: a clock-in while a shift is still open closes the
 * old one with no clock-out (net_minutes null — flagged in the UI, never
 * counted), and events before any clock-in are ignored.
 */
export function pairClockEvents(events) {
  const shifts = [];
  let open = null;

  for (const event of events) {
    if (event.event_type === "clock_in") {
      if (open) shifts.push(finishShift(open, null));
      open = { in_at: event.created_at, break_minutes: 0, breakStart: null };
    } else if (!open) {
      continue;
    } else if (event.event_type === "break_start") {
      if (!open.breakStart) open.breakStart = event.created_at;
    } else if (event.event_type === "break_end") {
      if (open.breakStart) {
        open.break_minutes += minutesBetween(open.breakStart, event.created_at);
        open.breakStart = null;
      }
    } else if (event.event_type === "clock_out") {
      shifts.push(finishShift(open, event.created_at));
      open = null;
    }
  }

  if (open) shifts.push(finishShift(open, null));
  return shifts;
}

export async function handleClockHistory(request, env) {
  const auth = await requireUser(request, env, "clock");
  if (!auth.ok) return auth;

  // ~9 weeks; the front end groups by week. The window could clip an ancient
  // unfinished shift's clock-in, which then just doesn't appear — fine.
  const events = await env.DB.prepare(
    `SELECT event_type, created_at
     FROM clock_events
     WHERE employee_id = ? AND created_at >= datetime('now', '-63 days')
     ORDER BY id`
  ).bind(auth.user.id).all();

  return { ok: true, shifts: pairClockEvents(events.results || []) };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function handleClockReport(request, env) {
  const auth = await requireUser(request, env, "manage_users");
  if (!auth.ok) return auth;

  const url = new URL(request.url);
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";

  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || to < from) {
    return { ok: false, error: "Pick a valid date range." };
  }

  // created_at is UTC but the picked dates are local, so fetch a day of slack
  // on each side; the front end trims to the exact local-date range.
  const events = await env.DB.prepare(
    `SELECT ce.employee_id, e.full_name, ce.event_type, ce.created_at
     FROM clock_events ce
     JOIN employees e ON e.id = ce.employee_id
     WHERE ce.created_at >= datetime(?, '-1 day')
       AND ce.created_at < datetime(?, '+2 days')
     ORDER BY ce.id`
  ).bind(from, to).all();

  const byEmployee = new Map();
  for (const event of events.results || []) {
    if (!byEmployee.has(event.employee_id)) {
      byEmployee.set(event.employee_id, {
        id: event.employee_id,
        full_name: event.full_name,
        events: []
      });
    }
    byEmployee.get(event.employee_id).events.push(event);
  }

  return {
    ok: true,
    employees: [...byEmployee.values()]
      .map(({ id, full_name, events: list }) => ({ id, full_name, shifts: pairClockEvents(list) }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name))
  };
}

export async function handleClockEvent(request, env, eventType) {
  const auth = await requireUser(request, env, "clock");
  if (!auth.ok) return auth;

  const transition = TRANSITIONS[eventType];
  if (!transition) {
    return { ok: false, error: "Unknown clock action." };
  }

  const profile = await getOrCreateProfile(env.DB, auth.user.id);
  const status = profile.clock_user_status || "out";

  if (!transition.from.includes(status)) {
    return { ok: false, error: transition.error };
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO clock_events (employee_id, event_type) VALUES (?, ?)`
    ).bind(auth.user.id, eventType),
    env.DB.prepare(
      `UPDATE clock_profiles SET clock_user_status = ? WHERE employee_id = ?`
    ).bind(transition.to, auth.user.id)
  ]);

  return { ok: true, status: transition.to };
}
