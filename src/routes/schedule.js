import { readJsonBody, optionalText, requiredText, BadRequest } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { avatarUrlFor } from "./staff.js";
import { loadTeamAvailability, availabilityConflict } from "./availability.js";
import { holidaysBetween } from "../lib/holidays.js";

/**
 * The schedule builder: a convention's shifts laid out day by day, with the
 * one question a boss actually has while building — is the booth covered for
 * the whole time the doors are open — answered on screen.
 */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function toMinutes(hhmm) {
  if (!HHMM.test(String(hhmm || ""))) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function toHhmm(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Overlapping and touching shifts collapse into one covered stretch. */
export function mergeIntervals(shifts) {
  const spans = shifts
    .map(s => ({ start: toMinutes(s.starts_at), end: toMinutes(s.ends_at) }))
    .filter(s => s.start !== null && s.end !== null && s.end > s.start)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }

  return merged;
}

/**
 * The holes in booth coverage inside the hours the hall is open — including
 * a late start and an early finish, which are the two that actually bite.
 * Returns [] when there's nothing to compare against.
 */
export function coverageGaps(shifts, hallStart, hallEnd) {
  if (hallStart === null || hallEnd === null || hallEnd <= hallStart) return [];

  const gaps = [];
  let cursor = hallStart;

  for (const span of mergeIntervals(shifts)) {
    if (span.end <= hallStart || span.start >= hallEnd) continue;
    if (span.start > cursor) gaps.push({ from: toHhmm(cursor), to: toHhmm(span.start) });
    cursor = Math.max(cursor, span.end);
    if (cursor >= hallEnd) break;
  }

  if (cursor < hallEnd) gaps.push({ from: toHhmm(cursor), to: toHhmm(hallEnd) });

  return gaps;
}

/** Every date this event touches: its run, its setup day, and any day already worked. */
function scheduleDates(convention, shiftDates) {
  const dates = new Set(shiftDates);

  if (convention.setup_on) dates.add(convention.setup_on);

  if (convention.starts_on) {
    const end = convention.ends_on || convention.starts_on;
    for (let d = new Date(`${convention.starts_on}T00:00:00Z`);
         d <= new Date(`${end}T00:00:00Z`);
         d.setUTCDate(d.getUTCDate() + 1)) {
      dates.add(d.toISOString().slice(0, 10));
    }
  }

  return [...dates].sort();
}

export async function handleScheduleView(request, env, slug) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const convention = await env.DB.prepare(
    `SELECT id, name, slug, booth_number, starts_on, ends_on, setup_on FROM conventions WHERE slug = ?`
  ).bind(slug).first();

  if (!convention) return { ok: false, error: "Convention not found." };

  const [shiftRows, dayRows, staffRows, availability] = await Promise.all([
    env.DB.prepare(
      `SELECT s.*, e.full_name AS employee_name, e.role AS employee_role,
              e.avatar IS NOT NULL AS has_avatar, e.updated_at AS employee_updated_at
       FROM convention_shifts s
       LEFT JOIN employees e ON e.id = s.employee_id
       WHERE s.convention_id = ?
       ORDER BY s.shift_date ASC, s.starts_at ASC`
    ).bind(convention.id).all(),

    env.DB.prepare(
      `SELECT * FROM convention_days WHERE convention_id = ? ORDER BY day_date ASC`
    ).bind(convention.id).all(),

    env.DB.prepare(
      `SELECT id, full_name, role, avatar IS NOT NULL AS has_avatar, updated_at
       FROM employees WHERE is_active = 1 ORDER BY full_name ASC`
    ).all(),

    loadTeamAvailability(
      env.DB,
      convention.setup_on && convention.setup_on < convention.starts_on
        ? convention.setup_on
        : convention.starts_on || "0000-01-01",
      convention.ends_on || convention.starts_on || "9999-12-31"
    )
  ]);

  const allShifts = shiftRows.results || [];
  const daysByDate = new Map((dayRows.results || []).map(day => [day.day_date, day]));
  const staff = (staffRows.results || []).map(person => ({
    id: person.id,
    full_name: person.full_name,
    role: person.role,
    avatar_url: person.has_avatar ? avatarUrlFor(person.id, person.updated_at) : null
  }));

  const days = scheduleDates(convention, allShifts.map(s => s.shift_date)).map(date => {
    const shifts = allShifts.filter(s => s.shift_date === date);
    const hours = daysByDate.get(date) || null;

    // Coverage is measured against the doors being open, not against setup.
    const hallStart = hours ? toMinutes(hours.regular_start) : null;
    const hallEnd = hours ? toMinutes(hours.regular_end) : null;
    const merged = mergeIntervals(shifts);

    return {
      date,
      hall: hours
        ? {
            regular_start: hours.regular_start,
            regular_end: hours.regular_end,
            early_start: hours.early_start,
            setup_start: hours.setup_start,
            notes: hours.notes
          }
        : null,
      shifts: shifts.map(shift => ({
        id: shift.id,
        title: shift.title,
        employee_id: shift.employee_id,
        employee_name: shift.employee_name,
        employee_role: shift.employee_role,
        avatar_url: shift.has_avatar
          ? avatarUrlFor(shift.employee_id, shift.employee_updated_at)
          : null,
        shift_date: shift.shift_date,
        starts_at: shift.starts_at,
        ends_at: shift.ends_at,
        notes: shift.notes,
        break_allotment_minutes: shift.break_allotment_minutes || 0,
        break_count: shift.break_count || 1
      })),
      covered: merged.length
        ? { from: toHhmm(merged[0].start), to: toHhmm(merged[merged.length - 1].end) }
        : null,
      gaps: coverageGaps(shifts, hallStart, hallEnd),
      unassigned: shifts.filter(s => !s.employee_id).length,
      unavailable: unavailableOn(availability, staff, date)
    };
  });

  return { ok: true, convention, days, staff };
}

function assertTime(value, field) {
  const text = optionalText(value);
  if (!HHMM.test(String(text || ""))) {
    throw new BadRequest(`${field} must be a time like 09:30.`);
  }
  return text;
}

function breakFields(body) {
  const raw = Number(body.break_allotment_minutes);
  return {
    minutes: Number.isFinite(raw) ? Math.max(0, Math.min(240, Math.round(raw))) : 0,
    count: Number(body.break_count) === 2 ? 2 : 1
  };
}

/** Edits a shift in place — who, what, when, and its break allotment. */
export async function handleUpdateShift(request, env, shiftId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const id = Number(shiftId);
  const body = await readJsonBody(request);

  const shift = await env.DB.prepare(
    `SELECT id, convention_id, shift_date FROM convention_shifts WHERE id = ?`
  ).bind(id).first();

  if (!shift) return { ok: false, error: "That shift no longer exists." };

  const startsAt = assertTime(body.starts_at, "Start time");
  const endsAt = assertTime(body.ends_at, "End time");

  if (toMinutes(endsAt) <= toMinutes(startsAt)) {
    throw new BadRequest("The shift's end time must be after its start time.");
  }

  const employeeId = body.employee_id ? Number(body.employee_id) : null;

  if (employeeId) {
    const clash = await env.DB.prepare(
      `SELECT id FROM convention_shifts
       WHERE employee_id = ? AND shift_date = ? AND id != ?
         AND starts_at < ? AND ends_at > ?`
    ).bind(employeeId, shift.shift_date, id, endsAt, startsAt).first();

    if (clash) {
      return { ok: false, error: "They're already on an overlapping shift that day." };
    }
  }

  const { minutes, count } = breakFields(body);

  await env.DB.prepare(
    `UPDATE convention_shifts
     SET title = ?, employee_id = ?, starts_at = ?, ends_at = ?, notes = ?,
         break_allotment_minutes = ?, break_count = ?
     WHERE id = ?`
  ).bind(
    requiredText(body.title, "Shift name"),
    employeeId,
    startsAt,
    endsAt,
    optionalText(body.notes),
    minutes,
    count,
    id
  ).run();

  return { ok: true };
}

/** Creates a shift. A null convention_id is an ordinary store shift. */
export async function handleCreateShiftAnywhere(request, env) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);
  const startsAt = assertTime(body.starts_at, "Start time");
  const endsAt = assertTime(body.ends_at, "End time");

  if (toMinutes(endsAt) <= toMinutes(startsAt)) {
    throw new BadRequest("The shift's end time must be after its start time.");
  }

  const shiftDate = optionalText(body.shift_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(shiftDate || "")) {
    throw new BadRequest("Shift date must be a date like 2026-09-14.");
  }

  const conventionId = body.convention_id ? Number(body.convention_id) : null;
  const employeeId = body.employee_id ? Number(body.employee_id) : null;

  if (employeeId) {
    const clash = await env.DB.prepare(
      `SELECT id FROM convention_shifts
       WHERE employee_id = ? AND shift_date = ? AND starts_at < ? AND ends_at > ?`
    ).bind(employeeId, shiftDate, endsAt, startsAt).first();

    if (clash) {
      return { ok: false, error: "They're already on an overlapping shift that day." };
    }
  }

  const { minutes, count } = breakFields(body);

  await env.DB.prepare(
    `INSERT INTO convention_shifts
       (convention_id, employee_id, title, shift_date, starts_at, ends_at, notes,
        break_allotment_minutes, break_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    conventionId,
    employeeId,
    requiredText(body.title, "Shift name"),
    shiftDate,
    startsAt,
    endsAt,
    optionalText(body.notes),
    minutes,
    count
  ).run();

  return { ok: true };
}

/**
 * Copies a day's shifts onto another date — the same people, times and break
 * allotments. Refuses a target that already has shifts rather than silently
 * doubling them up. Works for a convention day or a store day.
 */
export async function handleCopyDay(request, env) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);
  const fromDate = optionalText(body.from_date);
  const toDate = optionalText(body.to_date);
  const conventionId = body.convention_id ? Number(body.convention_id) : null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate || "") || !/^\d{4}-\d{2}-\d{2}$/.test(toDate || "")) {
    throw new BadRequest("Pick a day to copy from and a day to copy to.");
  }

  if (fromDate === toDate) {
    throw new BadRequest("That's the same day.");
  }

  // `convention_id = ?` never matches NULL, so store days need IS NULL.
  const scope = conventionId === null
    ? { clause: "convention_id IS NULL", args: [] }
    : { clause: "convention_id = ?", args: [conventionId] };

  const source = await env.DB.prepare(
    `SELECT title, employee_id, starts_at, ends_at, notes,
            break_allotment_minutes, break_count
     FROM convention_shifts
     WHERE ${scope.clause} AND shift_date = ?
     ORDER BY starts_at ASC`
  ).bind(...scope.args, fromDate).all();

  const shifts = source.results || [];
  if (!shifts.length) {
    return { ok: false, error: "That day has no shifts to copy." };
  }

  const existing = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM convention_shifts WHERE ${scope.clause} AND shift_date = ?`
  ).bind(...scope.args, toDate).first();

  if ((existing?.n || 0) > 0) {
    return { ok: false, error: "That day already has shifts. Clear them first, or pick another day." };
  }

  await env.DB.batch(shifts.map(shift =>
    env.DB.prepare(
      `INSERT INTO convention_shifts
         (convention_id, employee_id, title, shift_date, starts_at, ends_at, notes,
          break_allotment_minutes, break_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      conventionId,
      shift.employee_id,
      shift.title,
      toDate,
      shift.starts_at,
      shift.ends_at,
      shift.notes,
      shift.break_allotment_minutes,
      shift.break_count
    )
  ));

  return { ok: true, copied: shifts.length };
}

/* ---------- The store week ---------- */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Monday of the week containing a date, in UTC so no timezone drift. */
function weekStart(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Who can't work a given day, and why — so the builder can say so at the
 * moment you're picking someone rather than after the schedule is out.
 */
function unavailableOn(availability, staff, date) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const out = {};

  for (const person of staff) {
    const entry = availability.get(person.id);
    if (!entry) continue;

    const conflict = availabilityConflict(entry.week, entry.timeOff, { date, weekday });
    if (conflict) out[person.id] = conflict;
  }

  return out;
}

/**
 * What the screen needs to say about a holiday: what it's called, and whether
 * anyone has decided about it yet. `decided` is the load-bearing bit — an
 * undecided holiday is a question the schedule asks, not a day it assumes is
 * open. A saved decision on a date that isn't a listed holiday still shows,
 * labelled with its own note, so nothing written here can go missing.
 */
function holidayPayload(date, named, row) {
  if (!named && !row) return null;

  return {
    date,
    name: named?.name || row?.note || "Special hours",
    statutory: Boolean(named?.statutory),
    decided: Boolean(row),
    is_closed: row ? Boolean(row.is_closed) : null,
    opens_at: row?.opens_at || null,
    closes_at: row?.closes_at || null,
    note: row?.note || null
  };
}

/**
 * A week of ordinary store days: who's on, and whether the shop is covered
 * for the hours it's open. Convention shifts are shown alongside but not
 * edited here — those belong to the event's own builder.
 */
export async function handleStoreSchedule(request, env) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const url = new URL(request.url);
  const param = url.searchParams.get("week") || "";
  const from = weekStart(/^\d{4}-\d{2}-\d{2}$/.test(param) ? param : new Date().toISOString().slice(0, 10));
  const to = addDays(from, 6);

  const prevFrom = addDays(from, -7);

  const [shiftRows, hoursRows, staffRows, availability, holidayRows, prevCount] =
    await Promise.all([
      env.DB.prepare(
        `SELECT s.*, e.full_name AS employee_name, e.role AS employee_role,
                e.avatar IS NOT NULL AS has_avatar, e.updated_at AS employee_updated_at,
                c.name AS convention_name, c.slug AS convention_slug
         FROM convention_shifts s
         LEFT JOIN employees e ON e.id = s.employee_id
         LEFT JOIN conventions c ON c.id = s.convention_id
         WHERE s.shift_date >= ? AND s.shift_date <= ?
         ORDER BY s.shift_date ASC, s.starts_at ASC`
      ).bind(from, to).all(),

      env.DB.prepare(`SELECT * FROM store_hours`).all(),

      env.DB.prepare(
        `SELECT id, full_name, role, avatar IS NOT NULL AS has_avatar, updated_at
         FROM employees WHERE is_active = 1 ORDER BY full_name ASC`
      ).all(),

      loadTeamAvailability(env.DB, from, to),

      env.DB.prepare(
        `SELECT * FROM store_holidays WHERE holiday_date >= ? AND holiday_date <= ?`
      ).bind(from, to).all(),

      // Only store shifts count — an event week isn't a week you'd copy forward.
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM convention_shifts
         WHERE convention_id IS NULL AND shift_date >= ? AND shift_date <= ?`
      ).bind(prevFrom, addDays(prevFrom, 6)).first()
    ]);

  const allShifts = shiftRows.results || [];
  const hoursByWeekday = new Map((hoursRows.results || []).map(row => [row.weekday, row]));
  const decisions = new Map((holidayRows.results || []).map(row => [row.holiday_date, row]));
  const named = new Map(holidaysBetween(from, to).map(h => [h.date, h]));
  const staff = (staffRows.results || []).map(person => ({
    id: person.id,
    full_name: person.full_name,
    role: person.role,
    avatar_url: person.has_avatar ? avatarUrlFor(person.id, person.updated_at) : null
  }));

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(from, i);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const usual = hoursByWeekday.get(weekday) || null;
    const holiday = holidayPayload(date, named.get(date), decisions.get(date));

    // A holiday the boss has answered outranks the usual week: closed shuts the
    // day, and short hours replace it. An unanswered one changes nothing yet.
    const closed = holiday?.decided && holiday.is_closed
      ? true
      : Boolean(usual?.is_closed);

    const hours = closed
      ? null
      : holiday?.decided && holiday.opens_at && holiday.closes_at
        ? { opens_at: holiday.opens_at, closes_at: holiday.closes_at }
        : usual?.opens_at && usual?.closes_at
          ? { opens_at: usual.opens_at, closes_at: usual.closes_at }
          : null;

    const shifts = allShifts.filter(s => s.shift_date === date);
    const storeShifts = shifts.filter(s => !s.convention_id);
    const eventShifts = shifts.filter(s => s.convention_id);

    const open = closed ? null : toMinutes(hours?.opens_at);
    const close = closed ? null : toMinutes(hours?.closes_at);
    const merged = mergeIntervals(storeShifts);

    return {
      date,
      weekday,
      weekday_name: WEEKDAYS[weekday],
      closed,
      closed_for_holiday: Boolean(closed && holiday?.decided && holiday.is_closed),
      holiday,
      hours,
      shifts: storeShifts.map(shiftPayload),
      event_shifts: eventShifts.map(shift => ({
        ...shiftPayload(shift),
        convention_name: shift.convention_name,
        convention_slug: shift.convention_slug
      })),
      covered: merged.length
        ? { from: toHhmm(merged[0].start), to: toHhmm(merged[merged.length - 1].end) }
        : null,
      gaps: closed ? [] : coverageGaps(storeShifts, open, close),
      unavailable: unavailableOn(availability, staff, date)
    };
  });

  return {
    ok: true,
    week_start: from,
    week_end: to,
    prev_week: prevFrom,
    next_week: addDays(from, 7),
    // Between them these decide whether filling from last week is even on offer.
    week_shifts: days.reduce((n, day) => n + day.shifts.length, 0),
    prev_week_shifts: prevCount?.n || 0,
    days,
    store_hours: WEEKDAYS.map((name, weekday) => {
      const row = hoursByWeekday.get(weekday);
      return {
        weekday,
        name,
        opens_at: row?.opens_at || "",
        closes_at: row?.closes_at || "",
        is_closed: Boolean(row?.is_closed)
      };
    }),
    staff
  };
}

function shiftPayload(shift) {
  return {
    id: shift.id,
    title: shift.title,
    employee_id: shift.employee_id,
    employee_name: shift.employee_name,
    employee_role: shift.employee_role,
    avatar_url: shift.has_avatar
      ? avatarUrlFor(shift.employee_id, shift.employee_updated_at)
      : null,
    shift_date: shift.shift_date,
    starts_at: shift.starts_at,
    ends_at: shift.ends_at,
    notes: shift.notes,
    break_allotment_minutes: shift.break_allotment_minutes || 0,
    break_count: shift.break_count || 1
  };
}

/** The store's usual week. Saved as a whole so a blank day means closed. */
export async function handleSaveStoreHours(request, env) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);
  const rows = Array.isArray(body.hours) ? body.hours : [];

  const statements = rows.map(row => {
    const weekday = Number(row.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new BadRequest("That isn't a day of the week.");
    }

    const closed = row.is_closed === true;
    const opensAt = closed ? null : optionalText(row.opens_at);
    const closesAt = closed ? null : optionalText(row.closes_at);

    if (!closed && opensAt && closesAt && toMinutes(closesAt) <= toMinutes(opensAt)) {
      throw new BadRequest(`${WEEKDAYS[weekday]} closes before it opens.`);
    }

    return env.DB.prepare(
      `INSERT INTO store_hours (weekday, opens_at, closes_at, is_closed)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (weekday) DO UPDATE SET
         opens_at = excluded.opens_at,
         closes_at = excluded.closes_at,
         is_closed = excluded.is_closed`
    ).bind(weekday, opensAt, closesAt, closed ? 1 : 0);
  });

  if (statements.length) await env.DB.batch(statements);

  return { ok: true };
}

/**
 * Lifts a whole week of store shifts onto the next one. Every shift moves by
 * exactly seven days, so Tuesday's people land on Tuesday and the store hours
 * they were built against still apply.
 *
 * Event shifts are left where they are — they belong to the event, and a show
 * doesn't recur a week later. Like Copy this day, it refuses a target that
 * already has shifts rather than doubling them up.
 */
export async function handleCopyWeek(request, env) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);
  const rawFrom = optionalText(body.from_week);
  const rawTo = optionalText(body.to_week);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawFrom || "") || !/^\d{4}-\d{2}-\d{2}$/.test(rawTo || "")) {
    throw new BadRequest("Pick a week to copy from and a week to copy to.");
  }

  const from = weekStart(rawFrom);
  const to = weekStart(rawTo);

  if (from === to) throw new BadRequest("That's the same week.");

  // Whole weeks only, so every shift shifts by the same number of days and
  // keeps its weekday. Anything else would land Saturday's crew on a Tuesday.
  const offset = Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000
  );

  const source = await env.DB.prepare(
    `SELECT title, employee_id, shift_date, starts_at, ends_at, notes,
            break_allotment_minutes, break_count
     FROM convention_shifts
     WHERE convention_id IS NULL AND shift_date >= ? AND shift_date <= ?
     ORDER BY shift_date ASC, starts_at ASC`
  ).bind(from, addDays(from, 6)).all();

  const shifts = source.results || [];
  if (!shifts.length) {
    return { ok: false, error: "That week has no store shifts to copy." };
  }

  const existing = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM convention_shifts
     WHERE convention_id IS NULL AND shift_date >= ? AND shift_date <= ?`
  ).bind(to, addDays(to, 6)).first();

  if ((existing?.n || 0) > 0) {
    return {
      ok: false,
      error: "That week already has store shifts. Clear them first, or pick another week."
    };
  }

  await env.DB.batch(shifts.map(shift =>
    env.DB.prepare(
      `INSERT INTO convention_shifts
         (convention_id, employee_id, title, shift_date, starts_at, ends_at, notes,
          break_allotment_minutes, break_count)
       VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      shift.employee_id,
      shift.title,
      addDays(shift.shift_date, offset),
      shift.starts_at,
      shift.ends_at,
      shift.notes,
      shift.break_allotment_minutes,
      shift.break_count
    )
  ));

  return { ok: true, copied: shifts.length };
}

/**
 * Records whether the store opens on a holiday. Saved as one row per date;
 * clearing it puts the day back to being an open question rather than
 * quietly asserting the store is open.
 */
export async function handleSaveHoliday(request, env) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);
  const date = optionalText(body.holiday_date);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
    throw new BadRequest("That isn't a date like 2026-12-25.");
  }

  if (body.clear === true) {
    await env.DB.prepare(`DELETE FROM store_holidays WHERE holiday_date = ?`).bind(date).run();
    return { ok: true };
  }

  const closed = body.is_closed !== false;
  const opensAt = closed ? null : optionalText(body.opens_at);
  const closesAt = closed ? null : optionalText(body.closes_at);

  // Short hours are both ends or neither — one alone can't say when to open.
  if (Boolean(opensAt) !== Boolean(closesAt)) {
    throw new BadRequest("Give both a start and a finish for the short hours, or leave both blank.");
  }

  if (opensAt && closesAt && toMinutes(closesAt) <= toMinutes(opensAt)) {
    throw new BadRequest("That day closes before it opens.");
  }

  await env.DB.prepare(
    `INSERT INTO store_holidays
       (holiday_date, is_closed, opens_at, closes_at, note, decided_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (holiday_date) DO UPDATE SET
       is_closed  = excluded.is_closed,
       opens_at   = excluded.opens_at,
       closes_at  = excluded.closes_at,
       note       = excluded.note,
       decided_by = excluded.decided_by,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(date, closed ? 1 : 0, opensAt, closesAt, optionalText(body.note), auth.user.id).run();

  return { ok: true };
}
