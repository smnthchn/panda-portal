import { requireUser } from "../lib/auth.js";
import { readJsonBody } from "../lib/http.js";
import { pairClockEvents } from "./clock.js";

/* ---------- The event budget: labour, booth, expenses, movers ---------- */

const EXPENSE_CATEGORIES = ["meal", "transport"];

// Staff and Seasonal are the two subtotals the boss reads; everyone else with
// shifts still appears, after them.
const ROLE_ORDER = ["staff", "seasonal", "volunteer", "boss"];

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

/**
 * Scheduled hours per person, from the event's shifts — the budget reads the
 * schedule, not the punch log, because the schedule is what was agreed to and
 * exists before the show does. Break allotments come off. Shifts nobody is
 * assigned to are summed into one unpaid "Unassigned" line rather than
 * dropped: they're planned labour someone will still have to cover.
 */
export function labourRows(shiftRows) {
  const people = new Map();

  for (const shift of shiftRows) {
    const start = toMinutes(shift.starts_at);
    const end = toMinutes(shift.ends_at);
    if (start === null || end === null) continue;

    const minutes = Math.max(0, end - start - (shift.break_allotment_minutes || 0));
    const key = shift.employee_id ?? "unassigned";

    if (!people.has(key)) {
      people.set(key, {
        employee_id: shift.employee_id ?? null,
        full_name: shift.full_name || "Unassigned shifts",
        role: shift.employee_id ? shift.role : null,
        minutes: 0
      });
    }
    people.get(key).minutes += minutes;
  }

  return [...people.values()].sort((a, b) => {
    if (!a.employee_id !== !b.employee_id) return a.employee_id ? -1 : 1;
    const roleGap = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
    return roleGap || a.full_name.localeCompare(b.full_name);
  });
}

/**
 * The stretch of local dates the event's labour happened on: every scheduled
 * shift date plus the event's own dates (setup included) — a prep shift days
 * before doors is still the show's labour. Null when nothing is dated yet.
 */
export function eventWindow(convention, shiftRows) {
  const dates = shiftRows.map(s => s.shift_date).filter(Boolean);
  for (const d of [convention.starts_on, convention.ends_on, convention.setup_on]) {
    if (d) dates.push(d);
  }
  if (!dates.length) return null;
  dates.sort();
  return { from: dates[0], to: dates[dates.length - 1] };
}

async function conventionIdBySlug(env, slug) {
  const row = await env.DB.prepare(
    `SELECT id FROM conventions WHERE slug = ?`
  ).bind(slug).first();
  return row ? row.id : null;
}

export async function handleBudget(request, env, slug) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const convention = await env.DB.prepare(
    `SELECT id, name, slug, starts_on, ends_on, setup_on,
            mover_rate_cents, budget_excluded_roles
     FROM conventions WHERE slug = ?`
  ).bind(slug).first();

  if (!convention) return { ok: false, error: "Convention not found." };

  const [shiftRows, rateRows, boothRows, expenseRows, moverRows] = await Promise.all([
    env.DB.prepare(
      `SELECT s.employee_id, s.starts_at, s.ends_at, s.break_allotment_minutes,
              e.full_name, e.role
       FROM convention_shifts s
       LEFT JOIN employees e ON e.id = s.employee_id
       WHERE s.convention_id = ?`
    ).bind(convention.id).all(),
    env.DB.prepare(
      `SELECT employee_id, rate_cents FROM convention_pay_rates WHERE convention_id = ?`
    ).bind(convention.id).all(),
    env.DB.prepare(
      `SELECT id, label, qty, price_cents, discount_cents
       FROM convention_booth_costs WHERE convention_id = ? ORDER BY id`
    ).bind(convention.id).all(),
    env.DB.prepare(
      `SELECT id, category, label, amount_cents
       FROM convention_expenses WHERE convention_id = ? ORDER BY id`
    ).bind(convention.id).all(),
    env.DB.prepare(
      `SELECT id, started_at, ended_at
       FROM convention_mover_times WHERE convention_id = ? ORDER BY started_at`
    ).bind(convention.id).all()
  ]);

  // The hours the budget prices are the timesheets' — the punch log, with the
  // boss's corrections — not the schedule. Every crew punch across the event's
  // window is fetched (a day of slack each side, since punches are UTC and the
  // dates are local); the browser pairs are already made here, and the client
  // trims to local dates the way Timesheets does. People who never punch
  // (volunteers) fall back to their scheduled hours client-side.
  const scheduled = labourRows(shiftRows.results || []);
  const crewIds = [...new Set((shiftRows.results || []).filter(s => s.employee_id).map(s => s.employee_id))];
  const window = eventWindow(convention, shiftRows.results || []);

  const punchShifts = new Map();
  if (window && crewIds.length) {
    const placeholders = crewIds.map(() => "?").join(",");
    const events = await env.DB.prepare(
      `SELECT employee_id, event_type, created_at FROM clock_events
       WHERE employee_id IN (${placeholders})
         AND created_at >= datetime(?, '-1 day')
         AND created_at < datetime(?, '+2 days')
       ORDER BY id`
    ).bind(...crewIds, window.from, window.to).all();

    const byEmployee = new Map();
    for (const event of events.results || []) {
      if (!byEmployee.has(event.employee_id)) byEmployee.set(event.employee_id, []);
      byEmployee.get(event.employee_id).push(event);
    }
    for (const [employeeId, list] of byEmployee) {
      punchShifts.set(employeeId, pairClockEvents(list).map(s => ({
        in_at: s.in_at,
        net_minutes: s.net_minutes
      })));
    }
  }

  const rates = new Map((rateRows.results || []).map(r => [r.employee_id, r.rate_cents]));
  const labour = scheduled.map(row => ({
    ...row,
    scheduled_minutes: row.minutes,
    punch_shifts: row.employee_id ? (punchShifts.get(row.employee_id) || []) : [],
    rate_cents: row.employee_id ? (rates.get(row.employee_id) || 0) : null
  }));

  let excludedRoles = [];
  try { excludedRoles = JSON.parse(convention.budget_excluded_roles) || []; } catch {}

  return {
    ok: true,
    convention: { ...convention, budget_excluded_roles: excludedRoles },
    labour,
    window,
    booth: boothRows.results || [],
    expenses: expenseRows.results || [],
    movers: moverRows.results || []
  };
}

export async function handleSetPayRate(request, env, slug) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const conventionId = await conventionIdBySlug(env, slug);
  if (!conventionId) return { ok: false, error: "Convention not found." };

  const body = await readJsonBody(request);
  const employeeId = Number(body.employee_id);
  const rate = Number(body.rate_cents);

  if (!Number.isInteger(employeeId) || !Number.isInteger(rate) || rate < 0 || rate > 100000) {
    return { ok: false, error: "That rate didn't look right." };
  }

  await env.DB.prepare(
    `INSERT INTO convention_pay_rates (convention_id, employee_id, rate_cents)
     VALUES (?, ?, ?)
     ON CONFLICT (convention_id, employee_id) DO UPDATE SET rate_cents = excluded.rate_cents`
  ).bind(conventionId, employeeId, rate).run();

  return { ok: true };
}

/**
 * Which labour groups the budget leaves out of the money — regular wages are
 * paid show or no show, so leaving Staff out reads the budget as what the
 * event added. Hours still show; only the costs drop out.
 */
export async function handleSetExcludedRoles(request, env, slug) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const conventionId = await conventionIdBySlug(env, slug);
  if (!conventionId) return { ok: false, error: "Convention not found." };

  const body = await readJsonBody(request);
  const roles = Array.isArray(body.roles) ? body.roles : null;

  if (!roles || !roles.every(r => ROLE_ORDER.includes(r))) {
    return { ok: false, error: "Those roles didn't look right. Reload and try again." };
  }

  await env.DB.prepare(
    `UPDATE conventions SET budget_excluded_roles = ? WHERE id = ?`
  ).bind(JSON.stringify([...new Set(roles)]), conventionId).run();

  return { ok: true };
}

export async function handleSetMoverRate(request, env, slug) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const conventionId = await conventionIdBySlug(env, slug);
  if (!conventionId) return { ok: false, error: "Convention not found." };

  const body = await readJsonBody(request);
  const rate = Number(body.rate_cents);

  if (!Number.isInteger(rate) || rate < 0 || rate > 10000000) {
    return { ok: false, error: "That rate didn't look right." };
  }

  await env.DB.prepare(
    `UPDATE conventions SET mover_rate_cents = ? WHERE id = ?`
  ).bind(rate, conventionId).run();

  return { ok: true };
}

/** Shared validation for a booth line's fields. Returns the clean values or null. */
function boothLineFields(body) {
  const label = String(body.label || "").trim();
  const qty = Number(body.qty);
  const price = Number(body.price_cents);
  const discount = Number(body.discount_cents);

  const numbersOk = [qty, price, discount].every(n => Number.isInteger(n) && n >= 0 && n <= 100000000);
  if (!label || label.length > 120 || !numbersOk) return null;

  return { label, qty, price, discount };
}

export async function handleAddBoothCost(request, env, slug) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const conventionId = await conventionIdBySlug(env, slug);
  if (!conventionId) return { ok: false, error: "Convention not found." };

  const fields = boothLineFields(await readJsonBody(request));
  if (!fields) return { ok: false, error: "A booth line needs a name, and numbers that add up." };

  const result = await env.DB.prepare(
    `INSERT INTO convention_booth_costs (convention_id, label, qty, price_cents, discount_cents)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(conventionId, fields.label, fields.qty, fields.price, fields.discount).run();

  return { ok: true, id: result.meta.last_row_id };
}

export async function handleUpdateBoothCost(request, env, id) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const fields = boothLineFields(await readJsonBody(request));
  if (!fields) return { ok: false, error: "A booth line needs a name, and numbers that add up." };

  await env.DB.prepare(
    `UPDATE convention_booth_costs
     SET label = ?, qty = ?, price_cents = ?, discount_cents = ?
     WHERE id = ?`
  ).bind(fields.label, fields.qty, fields.price, fields.discount, Number(id)).run();

  return { ok: true };
}

export async function handleDeleteBoothCost(request, env, id) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  await env.DB.prepare(
    `DELETE FROM convention_booth_costs WHERE id = ?`
  ).bind(Number(id)).run();

  return { ok: true };
}

export async function handleAddExpense(request, env, slug) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const conventionId = await conventionIdBySlug(env, slug);
  if (!conventionId) return { ok: false, error: "Convention not found." };

  const body = await readJsonBody(request);
  const category = String(body.category || "");
  const label = String(body.label || "").trim();
  const amount = Number(body.amount_cents);

  if (!EXPENSE_CATEGORIES.includes(category) || !label || label.length > 120
      || !Number.isInteger(amount) || amount < 0 || amount > 100000000) {
    return { ok: false, error: "An expense needs a name and an amount." };
  }

  const result = await env.DB.prepare(
    `INSERT INTO convention_expenses (convention_id, category, label, amount_cents)
     VALUES (?, ?, ?, ?)`
  ).bind(conventionId, category, label, amount).run();

  return { ok: true, id: result.meta.last_row_id };
}

export async function handleDeleteExpense(request, env, id) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  await env.DB.prepare(
    `DELETE FROM convention_expenses WHERE id = ?`
  ).bind(Number(id)).run();

  return { ok: true };
}

/**
 * The movers' clock is one open row at a time: Start refuses while a visit is
 * running, End refuses while none is — matching two buttons that mean "they
 * just arrived" and "they just left".
 */
export async function handleMoverStart(request, env, slug) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const conventionId = await conventionIdBySlug(env, slug);
  if (!conventionId) return { ok: false, error: "Convention not found." };

  const open = await env.DB.prepare(
    `SELECT id FROM convention_mover_times
     WHERE convention_id = ? AND ended_at IS NULL`
  ).bind(conventionId).first();

  if (open) return { ok: false, error: "The movers are already on the clock — end that visit first." };

  await env.DB.prepare(
    `INSERT INTO convention_mover_times (convention_id) VALUES (?)`
  ).bind(conventionId).run();

  return { ok: true };
}

export async function handleMoverEnd(request, env, slug) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const conventionId = await conventionIdBySlug(env, slug);
  if (!conventionId) return { ok: false, error: "Convention not found." };

  const open = await env.DB.prepare(
    `SELECT id FROM convention_mover_times
     WHERE convention_id = ? AND ended_at IS NULL`
  ).bind(conventionId).first();

  if (!open) return { ok: false, error: "The movers aren't on the clock." };

  await env.DB.prepare(
    `UPDATE convention_mover_times SET ended_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(open.id).run();

  return { ok: true };
}

const UTC_STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Fixes a visit's stamps after the fact — the buttons log "now", but nobody
 * stands at the portal the second the truck pulls up. A closed visit keeps
 * both stamps; a running one only accepts its start (End is how it closes,
 * so it can't grow a second open row by being reopened here).
 */
export async function handleUpdateMoverTime(request, env, id) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const row = await env.DB.prepare(
    `SELECT id, ended_at FROM convention_mover_times WHERE id = ?`
  ).bind(Number(id)).first();

  if (!row) return { ok: false, error: "Couldn't find that visit any more. Reload and try again." };

  const body = await readJsonBody(request);
  const startedAt = String(body.started_at || "");
  const endedAt = row.ended_at ? String(body.ended_at || "") : null;

  if (!UTC_STAMP.test(startedAt) || (row.ended_at && !UTC_STAMP.test(endedAt))) {
    return { ok: false, error: "Those times didn't look right. Reload and try again." };
  }

  if (endedAt && endedAt <= startedAt) {
    return { ok: false, error: "The end has to be after the start." };
  }

  await env.DB.prepare(
    `UPDATE convention_mover_times SET started_at = ?, ended_at = ? WHERE id = ?`
  ).bind(startedAt, endedAt, row.id).run();

  return { ok: true };
}

export async function handleDeleteMoverTime(request, env, id) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  await env.DB.prepare(
    `DELETE FROM convention_mover_times WHERE id = ?`
  ).bind(Number(id)).run();

  return { ok: true };
}
