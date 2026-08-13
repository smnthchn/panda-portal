import { requireUser } from "../lib/auth.js";
import { pairClockEvents } from "./clock.js";
import { avatarUrlFor } from "./staff.js";

/**
 * Everything the home screen needs in one request: what today is, your shift,
 * your clock state, who else is on, and the hall hours if there's a show.
 *
 * The day is decided here, not in the browser, so the screen can't disagree
 * with the schedule. The client passes its own local date because the worker
 * runs in UTC and the store is in Toronto — an evening here is tomorrow there.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Days either side of today that still count as "an event is coming". */
const NUDGE_WINDOW_DAYS = 3;

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000
  );
}

function initialsOf(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/** "HH:MM" -> minutes since midnight, for laying out the hours bar. */
function toMinutes(hhmm) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

/**
 * The day's hours as proportional segments: setup, early access, then open.
 * Early access ends when doors open, and setup ends when the first of those
 * begins, so each segment's width is real time rather than a fixed fraction.
 */
export function segmentsFor(day) {
  if (!day) return null;

  const open = toMinutes(day.regular_start);
  const close = toMinutes(day.regular_end);
  if (open === null || close === null || close <= open) return null;

  const early = toMinutes(day.early_start);
  const setup = toMinutes(day.setup_start);

  const spanStart = setup ?? early ?? open;
  const total = close - spanStart;
  if (total <= 0) return null;

  const pct = (from, to) => ((to - from) / total) * 100;
  const segments = [];

  if (setup !== null && setup < (early ?? open)) {
    segments.push({ kind: "set", label: "SET", width: pct(setup, early ?? open) });
  }

  if (early !== null && early < open) {
    segments.push({ kind: "vip", label: "VIP", width: pct(early, open) });
  }

  segments.push({ kind: "open", label: "OPEN", width: pct(open, close) });

  return { segments, span_start: spanStart, span_end: close };
}

/** Names and roles for whoever turns up on today's roster. */
async function peopleById(db, employeeIds) {
  if (!employeeIds.length) return new Map();

  const placeholders = employeeIds.map(() => "?").join(",");
  const rows = await db.prepare(
    `SELECT id, full_name, role, avatar IS NOT NULL AS has_avatar, updated_at
     FROM employees WHERE id IN (${placeholders})`
  ).bind(...employeeIds).all();

  return new Map((rows.results || []).map(row => [row.id, row]));
}

/**
 * Live in / break / out, read off the last punch rather than the cached
 * status on clock_profiles — the log is the source of truth, and a person
 * with punches but no profile row still has a real state.
 */
export function liveStatusFromEvents(events) {
  const list = events || [];
  const last = list[list.length - 1];
  if (!last) return "out";

  if (last.event_type === "clock_in" || last.event_type === "break_end") return "in";
  if (last.event_type === "break_start") return "break";
  return "out";
}

/**
 * One row per person on today: their shift if they have one, their live
 * status, and — for someone whose shift has started but who never clocked
 * in — a late flag, which is the one thing worth chasing.
 *
 * `status` is decided here rather than in the browser so the badge and the
 * punch log can't disagree.
 */
export function buildRoster(shifts, eventsByEmployee, people, openShiftFor, nowMinutes = null) {
  const minutesNow = nowMinutes ?? new Date().getHours() * 60 + new Date().getMinutes();
  const byEmployee = new Map();

  for (const shift of shifts) {
    if (!shift.employee_id || byEmployee.has(shift.employee_id)) continue;
    byEmployee.set(shift.employee_id, {
      employee_id: shift.employee_id,
      name: shift.employee_name,
      role: shift.employee_role,
      title: shift.title,
      starts_at: shift.starts_at,
      ends_at: shift.ends_at,
      event_name: shift.convention_name
    });
  }

  // Anyone who punched in without a shift on the books still belongs here.
  for (const employeeId of eventsByEmployee.keys()) {
    if (byEmployee.has(employeeId)) continue;
    const person = people.get(employeeId);
    if (!person) continue;

    byEmployee.set(employeeId, {
      employee_id: employeeId,
      name: person.full_name,
      role: person.role,
      title: null,
      starts_at: null,
      ends_at: null,
      event_name: null
    });
  }

  return [...byEmployee.values()]
    .map(person => {
      const events = eventsByEmployee.get(person.employee_id);
      const live = liveStatusFromEvents(events);
      const open = openShiftFor(person.employee_id);
      const punchedToday = Boolean(events && events.length);
      const startMinutes = toMinutes(person.starts_at);

      let status;
      if (live === "break") status = "break";
      else if (live === "in") status = "in";
      else if (punchedToday) status = "done";
      else if (startMinutes !== null && minutesNow > startMinutes + 15) status = "late";
      else status = "upcoming";

      const record = people.get(person.employee_id);

      return {
        ...person,
        initials: initialsOf(person.name),
        avatar_url: record?.has_avatar
          ? avatarUrlFor(person.employee_id, record.updated_at)
          : null,
        status,
        clocked_in: status === "in" || status === "break",
        clocked_in_at: open ? open.in_at : null
      };
    })
    .sort((a, b) => (a.starts_at || "99:99").localeCompare(b.starts_at || "99:99"));
}

/** The convention whose run covers today, else the next one starting soon. */
async function findRelevantConvention(db, today) {
  const soon = addDays(today, NUDGE_WINDOW_DAYS);

  return db.prepare(
    `SELECT * FROM conventions
     WHERE is_published = 1
       AND starts_on IS NOT NULL
       AND (
         (starts_on <= ? AND COALESCE(ends_on, starts_on) >= ?)
         OR (starts_on > ? AND starts_on <= ?)
       )
     ORDER BY starts_on ASC
     LIMIT 1`
  ).bind(today, today, today, soon).first();
}

export async function handleDashboard(request, env) {
  const auth = await requireUser(request, env, "portal_access");
  if (!auth.ok) return auth;

  const url = new URL(request.url);
  const param = url.searchParams.get("today") || "";
  const today = ISO_DATE.test(param) ? param : new Date().toISOString().slice(0, 10);

  const user = auth.user;
  const canManage = Boolean(user.permissions.manage_conventions);
  const usesClock = Boolean(user.permissions.clock);

  const convention = await findRelevantConvention(env.DB, today);
  const isEventDay =
    convention &&
    convention.starts_on <= today &&
    (convention.ends_on || convention.starts_on) >= today;

  const [dayRow, shiftRows, clockRows] = await Promise.all([
    isEventDay
      ? env.DB.prepare(
          `SELECT * FROM convention_days WHERE convention_id = ? AND day_date = ?`
        ).bind(convention.id, today).first()
      : Promise.resolve(null),

    // Every shift dated today, whatever event it belongs to — a setup or
    // tear-down shift lands on a day that isn't part of the show's run.
    env.DB.prepare(
      `SELECT s.*, e.full_name AS employee_name, e.role AS employee_role,
              c.name AS convention_name
       FROM convention_shifts s
       LEFT JOIN employees e ON e.id = s.employee_id
       LEFT JOIN conventions c ON c.id = s.convention_id
       WHERE s.shift_date = ?
       ORDER BY s.starts_at ASC`
    ).bind(today).all(),

    // Everyone's punches for today (local), so the roster can show live
    // status. Two days of slack covers the UTC/local offset either way.
    env.DB.prepare(
      `SELECT employee_id, event_type, created_at
       FROM clock_events
       WHERE created_at >= datetime(?, '-1 day') AND created_at < datetime(?, '+2 days')
       ORDER BY created_at`
    ).bind(today, today).all()
  ]);

  const shifts = shiftRows.results || [];

  // Live clock state per person, from the punch log.
  const eventsByEmployee = new Map();
  for (const event of clockRows.results || []) {
    if (!eventsByEmployee.has(event.employee_id)) eventsByEmployee.set(event.employee_id, []);
    eventsByEmployee.get(event.employee_id).push(event);
  }

  const openShiftFor = (employeeId) => {
    const paired = pairClockEvents(eventsByEmployee.get(employeeId) || []);
    return paired.find(s => !s.out_at) || null;
  };

  const myShift = shifts.find(s => s.employee_id === user.id) || null;

  // Who the boss should see today: everyone with a shift, plus anyone who
  // clocked in without one — on a store day that's the whole team, since
  // shifts only exist against conventions.
  // The signed-in user is always in here, shift or not, so the header can
  // show their own avatar on a day they aren't working.
  const people = await peopleById(env.DB, [
    ...new Set([
      user.id,
      ...shifts.filter(s => s.employee_id).map(s => s.employee_id),
      ...eventsByEmployee.keys()
    ])
  ]);

  const roster = buildRoster(shifts, eventsByEmployee, people, openShiftFor);

  // Boss coverage metrics: when the booth is staffed, end to end.
  const coverage = shifts.length
    ? {
        from: shifts.reduce((a, s) => (s.starts_at < a ? s.starts_at : a), shifts[0].starts_at),
        to: shifts.reduce((a, s) => (s.ends_at > a ? s.ends_at : a), shifts[0].ends_at),
        count: shifts.length
      }
    : null;

  const myOpenShift = usesClock ? openShiftFor(user.id) : null;

  const profile = usesClock
    ? await env.DB.prepare(
        `SELECT clock_user_status FROM clock_profiles WHERE employee_id = ?`
      ).bind(user.id).first()
    : null;

  // For the store-day nudge: how many shifts you have across the whole run.
  const myEventShifts = convention
    ? await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM convention_shifts
         WHERE convention_id = ? AND employee_id = ?`
      ).bind(convention.id, user.id).first()
    : null;

  return {
    ok: true,
    today,
    user: {
      id: user.id,
      full_name: user.full_name,
      initials: initialsOf(user.full_name),
      role: user.role,
      theme_id: user.theme_id || "habbo",
      avatar_url: people.get(user.id)?.has_avatar
        ? avatarUrlFor(user.id, people.get(user.id).updated_at)
        : null
    },
    day_type: isEventDay ? "event" : "store",
    clock: usesClock
      ? {
          status: profile?.clock_user_status || "out",
          since: myOpenShift ? myOpenShift.in_at : null,
          break_minutes_used: myOpenShift ? myOpenShift.break_minutes : 0
        }
      : null,
    my_shift: myShift
      ? {
          title: myShift.title,
          starts_at: myShift.starts_at,
          ends_at: myShift.ends_at,
          notes: myShift.notes,
          break_allotment_minutes: myShift.break_allotment_minutes || 0,
          break_count: myShift.break_count || 1
        }
      : null,
    event: convention
      ? {
          slug: convention.slug,
          name: convention.name,
          booth_number: convention.booth_number,
          starts_on: convention.starts_on,
          ends_on: convention.ends_on || convention.starts_on,
          day_index: isEventDay ? daysBetween(convention.starts_on, today) + 1 : null,
          day_count:
            daysBetween(convention.starts_on, convention.ends_on || convention.starts_on) + 1,
          days_away: isEventDay ? 0 : daysBetween(today, convention.starts_on),
          my_shift_count: myEventShifts?.n || 0
        }
      : null,
    hall: dayRow
      ? {
          regular_start: dayRow.regular_start,
          regular_end: dayRow.regular_end,
          early_start: dayRow.early_start,
          setup_start: dayRow.setup_start,
          notes: dayRow.notes,
          ...(segmentsFor(dayRow) || {})
        }
      : null,
    roster,
    coverage,
    can_manage: canManage
  };
}
