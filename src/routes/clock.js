import { requireUser } from "../lib/auth.js";
import { readJsonBody } from "../lib/http.js";

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
  if (open.breakStart) {
    if (outAt) breakMinutes += minutesBetween(open.breakStart, outAt);
    open.breaks.push({ start_at: open.breakStart, end_at: null });
  }

  const total = outAt ? minutesBetween(open.in_at, outAt) : null;

  return {
    in_at: open.in_at,
    out_at: outAt,
    breaks: open.breaks,
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

  // A fixed-up clock-out is inserted long after its shift's other punches, so
  // row ids don't tell the story — timestamps do.
  const ordered = [...events].sort((a, b) => a.created_at.localeCompare(b.created_at));

  for (const event of ordered) {
    if (event.event_type === "clock_in") {
      if (open) shifts.push(finishShift(open, null));
      open = { in_at: event.created_at, break_minutes: 0, breakStart: null, breaks: [] };
    } else if (!open) {
      continue;
    } else if (event.event_type === "break_start") {
      if (!open.breakStart) open.breakStart = event.created_at;
    } else if (event.event_type === "break_end") {
      if (open.breakStart) {
        open.break_minutes += minutesBetween(open.breakStart, event.created_at);
        open.breaks.push({ start_at: open.breakStart, end_at: event.created_at });
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

const UTC_STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Boss-only repair of a shift's punches: clock-in, every break, and clock-out
 * move together in one save. The shift is identified by its recorded clock-in
 * stamp (`in_at`); `new_in_at`, `breaks` and `out_at` are where its punches
 * should be. Breaks can be corrected or added, never removed — the body
 * carries at least the pairs the shift already has, in order; extras become
 * new punch rows. Each correction is an update to the punch's own row (a
 * missing clock-out or break-end is inserted), stamped with who fixed it, so
 * the punch log stays the story.
 */
export async function handleClockFix(request, env) {
  const auth = await requireUser(request, env, "manage_users");
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);
  const employeeId = Number(body.employee_id);
  const inAt = String(body.in_at || "");
  const newInAt = String(body.new_in_at || body.in_at || "");
  const outAt = String(body.out_at || "");
  const breaks = Array.isArray(body.breaks) ? body.breaks : [];

  const stampsOk = [inAt, newInAt, outAt].every(s => UTC_STAMP.test(s))
    && breaks.every(b => b && UTC_STAMP.test(String(b.start_at || "")) && UTC_STAMP.test(String(b.end_at || "")));

  if (!Number.isInteger(employeeId) || !stampsOk) {
    return { ok: false, error: "That fix didn't look right. Reload and try again." };
  }

  const clockIn = await env.DB.prepare(
    `SELECT id FROM clock_events
     WHERE employee_id = ? AND event_type = 'clock_in' AND created_at = ?
     LIMIT 1`
  ).bind(employeeId, inAt).first();

  if (!clockIn) {
    return { ok: false, error: "Couldn't find that shift's clock-in any more. Reload and try again." };
  }

  const nextIn = await env.DB.prepare(
    `SELECT created_at FROM clock_events
     WHERE employee_id = ? AND event_type = 'clock_in' AND created_at > ?
     ORDER BY created_at LIMIT 1`
  ).bind(employeeId, inAt).first();

  // The last punch before this shift — usually the previous shift's clock-out.
  // The moved clock-in can't back over it.
  const previous = await env.DB.prepare(
    `SELECT created_at FROM clock_events
     WHERE employee_id = ? AND created_at < ?
     ORDER BY created_at DESC LIMIT 1`
  ).bind(employeeId, inAt).first();

  // This shift's other punches: everything up to the next clock-in.
  const rows = await (nextIn
    ? env.DB.prepare(
        `SELECT id, event_type, created_at FROM clock_events
         WHERE employee_id = ? AND created_at > ? AND created_at < ?
         ORDER BY created_at`
      ).bind(employeeId, inAt, nextIn.created_at)
    : env.DB.prepare(
        `SELECT id, event_type, created_at FROM clock_events
         WHERE employee_id = ? AND created_at > ?
         ORDER BY created_at`
      ).bind(employeeId, inAt)
  ).all();

  // Pair the recorded break rows the same way the report does, so the pair
  // the boss edited is the pair whose rows move.
  const recordedPairs = [];
  let openStart = null;
  for (const row of rows.results || []) {
    if (row.event_type === "break_start" && !openStart) openStart = row;
    else if (row.event_type === "break_end" && openStart) {
      recordedPairs.push({ start: openStart, end: row });
      openStart = null;
    }
  }
  if (openStart) recordedPairs.push({ start: openStart, end: null });

  // A break can be corrected or added, never removed from here.
  if (breaks.length < recordedPairs.length) {
    return { ok: false, error: "This shift's breaks changed under you. Reload and try again." };
  }

  const existingOut = (rows.results || []).find(r => r.event_type === "clock_out") || null;

  // The editor works in whole minutes, but recorded punches carry seconds. A
  // punch sent back at its own minute is untouched: it keeps its recorded
  // stamp (seconds and all) and its row is never rewritten — so two punches
  // seconds apart in the same minute don't collapse into a tie that the
  // ordering check would refuse on a save that never meant to move them.
  const effective = (recorded, sent) =>
    recorded && sent === recorded.slice(0, 16) + ":00" ? recorded : sent;

  const effIn = effective(inAt, newInAt);
  const effBreaks = breaks.map((sent, i) => {
    const pair = recordedPairs[i];
    return {
      start: effective(pair && pair.start.created_at, String(sent.start_at)),
      end: effective(pair && pair.end && pair.end.created_at, String(sent.end_at))
    };
  });
  const effOut = effective(existingOut && existingOut.created_at, outAt);

  // One non-decreasing line: in, break pairs, out. Ties are allowed — the
  // minute-grained editor can't always split two same-minute punches apart.
  const sequence = [effIn];
  for (const b of effBreaks) sequence.push(b.start, b.end);
  sequence.push(effOut);
  for (let i = 1; i < sequence.length; i++) {
    if (sequence[i] < sequence[i - 1]) {
      return { ok: false, error: "Those times are out of order — each punch has to be after the one before it." };
    }
  }

  if (nextIn && effOut >= nextIn.created_at) {
    return { ok: false, error: "That would run into the next shift. Pick an earlier time." };
  }

  if (previous && effIn <= previous.created_at) {
    return { ok: false, error: "That would run into the shift before. Pick a later clock-in." };
  }

  const note = `Fixed by ${auth.user.full_name}`;
  const statements = [];
  const moveRow = (row, to) => {
    if (row.created_at === to) return;
    statements.push(env.DB.prepare(
      `UPDATE clock_events SET created_at = ?, notes = ? WHERE id = ?`
    ).bind(to, note, row.id));
  };

  moveRow({ id: clockIn.id, created_at: inAt }, effIn);
  effBreaks.forEach((sent, i) => {
    const pair = recordedPairs[i];
    if (!pair) {
      // An added break: both punches are new rows.
      statements.push(env.DB.prepare(
        `INSERT INTO clock_events (employee_id, event_type, created_at, notes)
         VALUES (?, 'break_start', ?, ?)`
      ).bind(employeeId, sent.start, note));
      statements.push(env.DB.prepare(
        `INSERT INTO clock_events (employee_id, event_type, created_at, notes)
         VALUES (?, 'break_end', ?, ?)`
      ).bind(employeeId, sent.end, note));
      return;
    }
    moveRow(pair.start, sent.start);
    if (pair.end) {
      moveRow(pair.end, sent.end);
    } else {
      statements.push(env.DB.prepare(
        `INSERT INTO clock_events (employee_id, event_type, created_at, notes)
         VALUES (?, 'break_end', ?, ?)`
      ).bind(employeeId, sent.end, note));
    }
  });

  if (existingOut) {
    moveRow(existingOut, effOut);
  } else {
    statements.push(env.DB.prepare(
      `INSERT INTO clock_events (employee_id, event_type, created_at, notes)
       VALUES (?, 'clock_out', ?, ?)`
    ).bind(employeeId, effOut, note));

    // Closing someone's trailing open shift has to flip their live status too,
    // or their next "Clock In" gets rejected as already clocked in.
    if (!nextIn) {
      statements.push(env.DB.prepare(
        `UPDATE clock_profiles SET clock_user_status = 'out' WHERE employee_id = ?`
      ).bind(employeeId));
    }
  }

  if (statements.length) await env.DB.batch(statements);
  return { ok: true };
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
