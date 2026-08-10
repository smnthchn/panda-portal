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
