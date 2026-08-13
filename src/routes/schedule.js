import { readJsonBody, optionalText, requiredText, BadRequest } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { avatarUrlFor } from "./staff.js";

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

  const [shiftRows, dayRows, staffRows] = await Promise.all([
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
    ).all()
  ]);

  const allShifts = shiftRows.results || [];
  const daysByDate = new Map((dayRows.results || []).map(day => [day.day_date, day]));

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
      unassigned: shifts.filter(s => !s.employee_id).length
    };
  });

  return {
    ok: true,
    convention,
    days,
    staff: (staffRows.results || []).map(person => ({
      id: person.id,
      full_name: person.full_name,
      role: person.role,
      avatar_url: person.has_avatar ? avatarUrlFor(person.id, person.updated_at) : null
    }))
  };
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

/**
 * Copies a day's shifts onto another date — the same people, times and break
 * allotments. Refuses a target that already has shifts rather than silently
 * doubling them up.
 */
export async function handleCopyDay(request, env, conventionId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const id = Number(conventionId);
  const body = await readJsonBody(request);
  const fromDate = optionalText(body.from_date);
  const toDate = optionalText(body.to_date);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate || "") || !/^\d{4}-\d{2}-\d{2}$/.test(toDate || "")) {
    throw new BadRequest("Pick a day to copy from and a day to copy to.");
  }

  if (fromDate === toDate) {
    throw new BadRequest("That's the same day.");
  }

  const source = await env.DB.prepare(
    `SELECT title, employee_id, starts_at, ends_at, notes,
            break_allotment_minutes, break_count
     FROM convention_shifts
     WHERE convention_id = ? AND shift_date = ?
     ORDER BY starts_at ASC`
  ).bind(id, fromDate).all();

  const shifts = source.results || [];
  if (!shifts.length) {
    return { ok: false, error: "That day has no shifts to copy." };
  }

  const existing = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM convention_shifts WHERE convention_id = ? AND shift_date = ?`
  ).bind(id, toDate).first();

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
      id,
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
