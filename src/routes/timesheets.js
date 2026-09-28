import { requireUser } from "../lib/auth.js";
import { readJsonBody, optionalText } from "../lib/http.js";
import { holidaysBetween } from "../lib/holidays.js";
import { pairClockEvents } from "./clock.js";

/*
 * Pay periods: the 1st–15th and the 16th–month end, in Toronto time.
 *
 * Unlike the old date-range report, the period is decided here rather than in
 * the browser, because approval locks it: which shifts are "in" a period has
 * to be one answer, not whatever the viewing device's clock thinks. A shift
 * belongs to the Toronto date it clocked in on.
 */

const TZ = "America/Toronto";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LONG_SHIFT_MINUTES = 16 * 60;

// People who are paid by the hour; the only ones a no-show is flagged for.
// Anyone else with punches still appears, they just aren't chased.
const HOURLY_ROLES = ["staff", "seasonal"];

const pad = n => String(n).padStart(2, "0");

const torontoFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

/** A UTC "YYYY-MM-DD HH:MM:SS" stamp -> its Toronto date and minute of the day. */
export function torontoParts(utcStamp) {
  const ms = Date.parse(utcStamp.includes("T") ? utcStamp : utcStamp.replace(" ", "T") + "Z");
  const parts = Object.fromEntries(torontoFormat.formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

function nowUtcStamp() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The pay period containing a date: { start, end }, both inclusive. */
export function payPeriodFor(isoDate) {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  const prefix = `${year}-${pad(month)}`;
  return day <= 15
    ? { start: `${prefix}-01`, end: `${prefix}-15` }
    : { start: `${prefix}-16`, end: `${prefix}-${pad(lastDayOfMonth(year, month))}` };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** { start, end } -> "Sep 1–15, 2026", for messages. */
export function periodName(period) {
  const start = period.start || period.period_start;
  const end = period.end || period.period_end;
  return `${MONTHS[Number(start.slice(5, 7)) - 1]} ${Number(start.slice(8, 10))}–${Number(end.slice(8, 10))}, ${start.slice(0, 4)}`;
}

/** The period `steps` periods away (negative steps back). */
export function stepPeriod(period, steps) {
  let current = period;
  for (let i = 0; i < Math.abs(steps); i++) {
    const d = new Date(`${(steps > 0 ? current.end : current.start)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + (steps > 0 ? 1 : -1));
    current = payPeriodFor(d.toISOString().slice(0, 10));
  }
  return current;
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

/** Stable text for a person's period; the approval's fingerprint is its hash. */
export function periodSignature(person) {
  return [
    ...person.shifts.map(s => `${s.in_at}|${s.out_at || ""}|${s.break_minutes}|${s.breaks.length}`),
    ...person.holidays.map(h => `H${h.date}|${h.minutes}|${h.status}`)
  ].join(";");
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The lookback for public holiday pay (Ontario ESA): the four work weeks
 * before the work week containing the holiday. Sam's work week is Monday to
 * Sunday, like the schedule screen. Labour Day 2026 is a Monday, so its own
 * week starts that day and the lookback is Aug 10 - Sep 6.
 */
export function holidayWindow(holidayDate) {
  const dow = new Date(`${holidayDate}T00:00:00Z`).getUTCDay();
  const monday = addDays(holidayDate, -((dow + 6) % 7));
  return { start: addDays(monday, -28), end: addDays(monday, -1) };
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/*
 * Flags. `fix` flags make the hours wrong or uncountable and can only be
 * cleared by fixing the punches; `check` flags are often fine and can be
 * dismissed with a reason; `wait` clears itself at clock-out; `unlock` means
 * approved hours moved underneath the approval. Nothing is approved while any
 * is open.
 */
export const FLAG_TYPES = {
  working: { kind: "wait", label: "Still clocked in" },
  no_clock_out: { kind: "fix", label: "No clock-out" },
  open_break: { kind: "fix", label: "Break never ended" },
  long_shift: { kind: "check", label: "Shift over 16 hours" },
  missed_break: { kind: "check", label: "Scheduled break not taken" },
  no_show: { kind: "check", label: "Scheduled, no punches" },
  holiday_check: { kind: "decide", label: "Stat holiday pay: may not qualify" },
  changed: { kind: "unlock", label: "Changed since approved" }
};

// The flags staff see on their own Clock page and can answer.
export const STAFF_FLAG_TYPES = ["no_clock_out", "open_break", "long_shift", "missed_break", "no_show"];

function flag(type, key, detail) {
  return { type, key, kind: FLAG_TYPES[type].kind, label: FLAG_TYPES[type].label, detail };
}

/**
 * Builds one pay period's timesheets from raw rows. Pure, so it's tested
 * without a database; the handler only fetches and hands over.
 *
 * - events: every punch (employee_id, event_type, created_at, notes) around
 *   the period, reaching back over any stat holiday's lookback window.
 * - scheduled: assigned shifts, from the start of any holiday's lookback to
 *   a couple of weeks past the period (for the first shift after a holiday).
 * - employees: id, full_name, role for anyone who might appear.
 * - dismissals: { employee_id, flag_key, reason, outcome, dismissed_by_name, dismissed_at }.
 * - responses: staff answers { employee_id, flag_key, note, suggested_at, created_at }.
 * - approvals: live approvals for this period, with fingerprint.
 * - now: the current UTC stamp, to tell "still working" from "forgot".
 * - signatureHashes: Map employee_id -> hash of the current signature,
 *   computed by the caller (hashing is async; this stays sync).
 */
export function buildPeriod({ period, events, scheduled, employees, dismissals, approvals, now, responses = [], signatureHashes = new Map() }) {
  const nowLocal = torontoParts(now);
  const holidayList = holidaysBetween(period.start, period.end).filter(h => h.statutory);
  const statHolidays = new Map(holidayList.map(h => [h.date, h.name]));
  const inPeriod = date => date >= period.start && date <= period.end;

  const eventsBy = new Map();
  for (const e of events) {
    if (!eventsBy.has(e.employee_id)) eventsBy.set(e.employee_id, []);
    eventsBy.get(e.employee_id).push(e);
  }

  const scheduledBy = new Map();
  for (const s of scheduled) {
    if (!scheduledBy.has(s.employee_id)) scheduledBy.set(s.employee_id, []);
    scheduledBy.get(s.employee_id).push(s);
  }

  const dismissed = new Map(dismissals.map(d => [`${d.employee_id}:${d.flag_key}`, d]));
  const answered = new Map(responses.map(r => [`${r.employee_id}:${r.flag_key}`, r]));
  const withResponse = (personId, f) => {
    const r = answered.get(`${personId}:${f.key}`);
    if (r) f.response = { note: r.note, suggested_at: r.suggested_at || null, at: r.created_at };
    return f;
  };
  const shiftOver = s => s.shift_date < nowLocal.date
    || (s.shift_date === nowLocal.date && toMinutes(s.ends_at) <= nowLocal.minutes);
  const approvalBy = new Map(approvals.map(a => [a.employee_id, a]));

  const people = [];
  for (const person of employees) {
    const list = eventsBy.get(person.id) || [];
    const allShifts = pairClockEvents(list);
    const lastShift = allShifts[allShifts.length - 1];
    const ownScheduledAll = (scheduledBy.get(person.id) || []).slice().sort((a, b) => a.shift_date.localeCompare(b.shift_date));
    const ownScheduled = ownScheduledAll.filter(s => inPeriod(s.shift_date));
    const flags = [];

    const shifts = allShifts
      .map(shift => ({ shift, local: torontoParts(shift.in_at) }))
      .filter(({ local }) => inPeriod(local.date))
      .map(({ shift, local }) => {
        const date = local.date;
        const shiftFlags = [];
        const anchor = shift.in_at;

        // Fixes are the notes on the punches inside this shift.
        const endStamp = shift.out_at || shift.in_at;
        const fixes = [...new Set(
          list.filter(e => e.notes && e.created_at >= shift.in_at && e.created_at <= endStamp).map(e => e.notes)
        )];

        // Of this person's scheduled shifts that day, the one this punch
        // belongs to is the one it overlaps most (or the only one).
        const sameDay = ownScheduled.filter(s => s.shift_date === date);
        let match = null;
        if (sameDay.length) {
          const inMin = local.minutes;
          const outMin = shift.out_at ? torontoParts(shift.out_at).minutes : inMin;
          const overlap = s => Math.min(outMin, toMinutes(s.ends_at)) - Math.max(inMin, toMinutes(s.starts_at));
          match = [...sameDay].sort((a, b) => overlap(b) - overlap(a))[0];
        }

        if (!shift.out_at) {
          const working = shift === lastShift && date === nowLocal.date;
          shiftFlags.push(working
            ? flag("working", `working:${anchor}`, "Can't approve until they clock out.")
            : flag("no_clock_out", `no_clock_out:${anchor}`, "Tap the shift and add the clock-out."));
        } else {
          if (shift.breaks.some(b => !b.end_at)) {
            shiftFlags.push(flag("open_break", `open_break:${anchor}`, "Tap the shift and add when the break ended."));
          }
          const span = (Date.parse(shift.out_at.replace(" ", "T") + "Z") - Date.parse(shift.in_at.replace(" ", "T") + "Z")) / 60000;
          if (span >= LONG_SHIFT_MINUTES) {
            shiftFlags.push(flag("long_shift", `long_shift:${anchor}`, "Usually a clock-out pressed the next morning."));
          }
          if (match && match.break_allotment_minutes > 0 && shift.breaks.length === 0) {
            shiftFlags.push(flag("missed_break", `missed_break:${anchor}`,
              `The shift had a ${match.break_allotment_minutes}-minute break scheduled.`));
          }
        }

        for (const f of shiftFlags) {
          const d = dismissed.get(`${person.id}:${f.key}`);
          if (d && f.kind === "check") f.dismissed = { reason: d.reason, by: d.dismissed_by_name, at: d.dismissed_at };
          withResponse(person.id, f);
          flags.push({ ...f, date });
        }

        return {
          ...shift,
          date,
          stat_holiday: statHolidays.get(date) || null,
          fixes,
          scheduled: match
            ? { id: match.id, title: match.title, starts_at: match.starts_at, ends_at: match.ends_at, convention: match.convention_name || null }
            : null,
          flags: shiftFlags,
          // Every staff answer about this shift, kept after the flag it
          // answered is fixed and gone, so the reason stays on the record.
          staff_notes: responses
            .filter(r => r.employee_id === person.id && r.flag_key.slice(r.flag_key.indexOf(":") + 1) === anchor)
            .map(r => ({
              flag_type: r.flag_key.split(":")[0],
              note: r.note,
              suggested_at: r.suggested_at || null,
              at: r.created_at
            }))
        };
      });

    // A scheduled shift nobody punched for, once it has finished. Only
    // chased for hourly roles: the boss and volunteers don't clock.
    const noShows = [];
    if (HOURLY_ROLES.includes(person.role)) {
      const workedDates = new Set(shifts.map(s => s.date));
      for (const s of ownScheduled) {
        if (workedDates.has(s.shift_date)) continue;
        if (!shiftOver(s)) continue;
        const f = flag("no_show", `no_show:${s.id}`, s.title);
        const d = dismissed.get(`${person.id}:${f.key}`);
        if (d) f.dismissed = { reason: d.reason, by: d.dismissed_by_name, at: d.dismissed_at };
        withResponse(person.id, f);
        flags.push({ ...f, date: s.shift_date });
        noShows.push({ id: s.id, date: s.shift_date, title: s.title, starts_at: s.starts_at, ends_at: s.ends_at });
      }
    }

    // Stat holiday pay, as hours: what they worked in the holiday's four-week
    // lookback, divided by 20. Hourly roles only. The last-and-first rule is
    // checked against the schedule: missing the last scheduled shift before
    // or the first after (or it not having happened yet) holds the hours on a
    // flag until the boss decides. Having no scheduled shift on a side isn't
    // treated as missing one, since the schedule may simply not be built yet.
    const holidays = [];
    if (HOURLY_ROLES.includes(person.role)) {
      const workedOn = new Set(allShifts.map(s => torontoParts(s.in_at).date));
      for (const h of holidayList) {
        const window = holidayWindow(h.date);
        const lookbackMinutes = allShifts
          .filter(s => {
            const d = torontoParts(s.in_at).date;
            return d >= window.start && d <= window.end;
          })
          .reduce((sum, s) => sum + (s.net_minutes || 0), 0);
        if (!lookbackMinutes) continue;

        const before = [...ownScheduledAll].reverse().find(s => s.shift_date < h.date);
        const after = ownScheduledAll.find(s => s.shift_date > h.date);
        const problems = [];
        if (before && !workedOn.has(before.shift_date)) {
          problems.push(`No punches on their last scheduled shift before (${before.shift_date}).`);
        }
        if (after && !shiftOver(after)) {
          problems.push(`Their first scheduled shift after (${after.shift_date}) hasn't happened yet.`);
        } else if (after && !workedOn.has(after.shift_date)) {
          problems.push(`No punches on their first scheduled shift after (${after.shift_date}).`);
        }

        let holidayStatus = "counts";
        if (problems.length) {
          const f = flag("holiday_check", `holiday_check:${h.date}`, `${h.name}: ${problems.join(" ")}`);
          const d = dismissed.get(`${person.id}:${f.key}`);
          if (d && d.outcome) {
            f.dismissed = { reason: d.reason, by: d.dismissed_by_name, at: d.dismissed_at, outcome: d.outcome };
            holidayStatus = d.outcome === "counts" ? "counts" : "not";
          } else {
            holidayStatus = "held";
          }
          flags.push({ ...f, date: h.date });
        }

        holidays.push({
          date: h.date,
          name: h.name,
          window_start: window.start,
          window_end: window.end,
          lookback_minutes: lookbackMinutes,
          minutes: Math.round(lookbackMinutes / 20),
          status: holidayStatus
        });
      }
    }

    if (!shifts.length && !noShows.length && !holidays.length && !approvalBy.has(person.id)) continue;

    const approval = approvalBy.get(person.id) || null;
    if (approval && signatureHashes.has(person.id) && signatureHashes.get(person.id) !== approval.fingerprint) {
      flags.push(flag("changed", `changed:${approval.id}`,
        "Punches in this period changed after you approved it. Unlock and approve again."));
    }

    // Worked hours split into regular and holiday-day (premium) hours; the
    // stat holiday hours go on top. Total = all three, nothing counted twice.
    const workedMinutes = shifts.reduce((sum, s) => sum + (s.net_minutes || 0), 0);
    const premiumMinutes = shifts.filter(s => s.stat_holiday).reduce((sum, s) => sum + (s.net_minutes || 0), 0);
    const holidayMinutes = holidays.filter(h => h.status === "counts").reduce((sum, h) => sum + h.minutes, 0);
    const open = flags.filter(f => !f.dismissed);

    let status;
    if (approval) status = open.some(f => f.type === "changed") ? "changed" : "approved";
    else status = open.length ? "flagged" : "ready";

    people.push({
      id: person.id,
      full_name: person.full_name,
      role: person.role,
      shifts,
      no_shows: noShows,
      flags,
      open_flags: open.length,
      holidays,
      worked_minutes: workedMinutes,
      regular_minutes: workedMinutes - premiumMinutes,
      premium_minutes: premiumMinutes,
      holiday_minutes: holidayMinutes,
      total_minutes: workedMinutes + holidayMinutes,
      break_minutes: shifts.reduce((sum, s) => sum + (s.out_at ? s.break_minutes : 0), 0),
      days_worked: new Set(shifts.map(s => s.date)).size,
      status,
      approval: approval
        ? { id: approval.id, by: approval.approved_by_name, at: approval.approved_at, net_minutes: approval.net_minutes }
        : null
    });
  }

  people.sort((a, b) => a.full_name.localeCompare(b.full_name));
  return people;
}

/* ---------- Loading ---------- */

function parsePeriodParam(value, now) {
  const date = ISO_DATE.test(value || "") ? value : torontoParts(now).date;
  return payPeriodFor(date);
}

/** Everything buildPeriod needs, fetched for one period (optionally one person). */
async function loadPeriod(db, period, now, employeeId = null) {
  const onePerson = employeeId !== null;

  // A stat holiday reaches back over its four-week lookback, and forward to
  // the first shift after it.
  const windows = holidaysBetween(period.start, period.end).filter(h => h.statutory).map(h => holidayWindow(h.date));
  const from = windows.reduce((min, w) => (w.start < min ? w.start : min), period.start);
  const scheduledTo = addDays(period.end, 14);

  const [events, scheduled, dismissals, approvals, responses] = await Promise.all([
    db.prepare(
      `SELECT employee_id, event_type, created_at, notes
       FROM clock_events
       WHERE created_at >= datetime(?, '-1 day') AND created_at < datetime(?, '+2 days')
         ${onePerson ? "AND employee_id = ?" : ""}
       ORDER BY created_at`
    ).bind(...[from, period.end, ...(onePerson ? [employeeId] : [])]).all(),
    // LEFT JOIN: a store shift has no convention.
    db.prepare(
      `SELECT s.id, s.employee_id, s.title, s.shift_date, s.starts_at, s.ends_at,
              s.break_allotment_minutes, c.name AS convention_name
       FROM convention_shifts s
       LEFT JOIN conventions c ON c.id = s.convention_id
       WHERE s.employee_id IS NOT NULL AND s.shift_date >= ? AND s.shift_date <= ?
         ${onePerson ? "AND s.employee_id = ?" : ""}`
    ).bind(...[from, scheduledTo, ...(onePerson ? [employeeId] : [])]).all(),
    db.prepare(
      `SELECT d.employee_id, d.flag_key, d.reason, d.outcome, d.dismissed_at, e.full_name AS dismissed_by_name
       FROM timesheet_flag_dismissals d
       JOIN employees e ON e.id = d.dismissed_by`
    ).all(),
    db.prepare(
      `SELECT a.id, a.employee_id, a.net_minutes, a.fingerprint, a.approved_at, e.full_name AS approved_by_name
       FROM timesheet_approvals a
       JOIN employees e ON e.id = a.approved_by
       WHERE a.period_start = ? AND a.unlocked_at IS NULL`
    ).bind(period.start).all(),
    db.prepare(
      `SELECT employee_id, flag_key, note, suggested_at, created_at FROM timesheet_flag_responses`
    ).all()
  ]);

  const eventRows = events.results || [];
  const scheduledRows = scheduled.results || [];
  const approvalRows = approvals.results || [];

  // Anyone with punches, a scheduled shift, or an approval in the period.
  const ids = new Set([
    ...eventRows.map(e => e.employee_id),
    ...scheduledRows.map(s => s.employee_id),
    ...approvalRows.map(a => a.employee_id)
  ]);
  if (onePerson) ids.add(employeeId);

  const employees = ids.size
    ? (await db.prepare(
        `SELECT id, full_name, role FROM employees WHERE id IN (${[...ids].map(() => "?").join(",")})`
      ).bind(...ids).all()).results || []
    : [];

  const raw = {
    period,
    events: eventRows,
    scheduled: scheduledRows,
    employees,
    dismissals: dismissals.results || [],
    approvals: approvalRows,
    responses: responses.results || [],
    now
  };

  // Hash each person's current shifts so an approval can notice a change.
  const people = buildPeriod(raw);
  const signatureHashes = new Map();
  for (const person of people) {
    signatureHashes.set(person.id, await sha256(periodSignature(person)));
  }

  return { people: buildPeriod({ ...raw, signatureHashes }), signatureHashes };
}

export async function handleTimesheetPeriod(request, env) {
  const auth = await requireUser(request, env, "manage_users");
  if (!auth.ok) return auth;

  const url = new URL(request.url);
  const now = nowUtcStamp();
  const period = parsePeriodParam(url.searchParams.get("date"), now);
  const { people } = await loadPeriod(env.DB, period, now);

  // Every approve and unlock for this period, newest first — the export's log.
  const log = await env.DB.prepare(
    `SELECT a.employee_id, p.full_name, a.net_minutes, a.approved_at, ab.full_name AS approved_by,
            a.unlocked_at, ub.full_name AS unlocked_by
     FROM timesheet_approvals a
     JOIN employees p ON p.id = a.employee_id
     JOIN employees ab ON ab.id = a.approved_by
     LEFT JOIN employees ub ON ub.id = a.unlocked_by
     WHERE a.period_start = ?
     ORDER BY a.approved_at DESC`
  ).bind(period.start).all();

  return {
    ok: true,
    period,
    previous: stepPeriod(period, -1),
    next: stepPeriod(period, 1),
    today: torontoParts(now).date,
    stat_holidays: holidaysBetween(period.start, period.end).filter(h => h.statutory),
    people,
    log: log.results || []
  };
}

/**
 * Approves one person, or everyone in the period with nothing open
 * (`all_ready: true`). The server rebuilds the period itself rather than
 * trusting what the screen showed, so a punch that landed since the page
 * loaded can't slip through.
 */
export async function handleApproveTimesheet(request, env) {
  const auth = await requireUser(request, env, "manage_users");
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);
  const now = nowUtcStamp();
  if (!ISO_DATE.test(String(body.period_start || ""))) {
    return { ok: false, error: "Pick a pay period." };
  }
  const period = payPeriodFor(body.period_start);
  const allReady = body.all_ready === true;
  const employeeId = allReady ? null : Number(body.employee_id);
  if (!allReady && !Number.isInteger(employeeId)) {
    return { ok: false, error: "Pick who to approve." };
  }

  const { people, signatureHashes } = await loadPeriod(env.DB, period, now, employeeId);
  const targets = allReady ? people.filter(p => p.status === "ready") : people.filter(p => p.id === employeeId);

  if (!allReady) {
    const person = targets[0];
    if (!person) return { ok: false, error: "Nothing to approve for them in this period." };
    if (person.status === "approved") return { ok: false, error: "Already approved." };
    if (person.status !== "ready") {
      return { ok: false, error: `${person.full_name} still has ${person.open_flags} flag${person.open_flags === 1 ? "" : "s"} to sort out.` };
    }
  }

  if (!targets.length) return { ok: true, approved: [] };

  await env.DB.batch(targets.map(p => env.DB.prepare(
    `INSERT INTO timesheet_approvals
       (employee_id, period_start, period_end, net_minutes, fingerprint, approved_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(p.id, period.start, period.end, p.total_minutes, signatureHashes.get(p.id), auth.user.id)));

  return { ok: true, approved: targets.map(p => p.full_name) };
}

export async function handleUnlockTimesheet(request, env) {
  const auth = await requireUser(request, env, "manage_users");
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);
  const employeeId = Number(body.employee_id);
  if (!Number.isInteger(employeeId) || !ISO_DATE.test(String(body.period_start || ""))) {
    return { ok: false, error: "That unlock didn't look right. Reload and try again." };
  }
  const period = payPeriodFor(body.period_start);

  const result = await env.DB.prepare(
    `UPDATE timesheet_approvals
     SET unlocked_at = CURRENT_TIMESTAMP, unlocked_by = ?
     WHERE employee_id = ? AND period_start = ? AND unlocked_at IS NULL`
  ).bind(auth.user.id, employeeId, period.start).run();

  if (!result.meta?.changes) return { ok: false, error: "That period isn't approved." };
  return { ok: true };
}

export async function handleDismissFlag(request, env) {
  const auth = await requireUser(request, env, "manage_users");
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);
  const employeeId = Number(body.employee_id);
  const key = String(body.flag_key || "");
  const type = key.split(":")[0];
  const reason = optionalText(body.reason);

  if (!Number.isInteger(employeeId) || !FLAG_TYPES[type]) {
    return { ok: false, error: "That flag didn't look right. Reload and try again." };
  }
  const kind = FLAG_TYPES[type].kind;
  if (kind !== "check" && kind !== "decide") {
    return { ok: false, error: "This one needs fixing, not dismissing. Tap the shift to fix its punches." };
  }

  // A stat-holiday flag is a decision: does the holiday pay count or not.
  let outcome = null;
  let note = reason;
  if (kind === "decide") {
    outcome = body.outcome === "counts" || body.outcome === "not" ? body.outcome : null;
    if (!outcome) return { ok: false, error: "Pick Counts or Doesn't count." };
    note = reason || (outcome === "counts" ? "Counts" : "Doesn't count");
  } else if (!reason) {
    return { ok: false, error: "Say why it's fine, for the record." };
  }

  await env.DB.prepare(
    `INSERT INTO timesheet_flag_dismissals (employee_id, flag_key, reason, outcome, dismissed_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (employee_id, flag_key) DO UPDATE SET
       reason = excluded.reason, outcome = excluded.outcome,
       dismissed_by = excluded.dismissed_by, dismissed_at = CURRENT_TIMESTAMP`
  ).bind(employeeId, key, note, outcome, auth.user.id).run();

  return { ok: true };
}

export async function handleUndismissFlag(request, env) {
  const auth = await requireUser(request, env, "manage_users");
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);
  await env.DB.prepare(
    `DELETE FROM timesheet_flag_dismissals WHERE employee_id = ? AND flag_key = ?`
  ).bind(Number(body.employee_id), String(body.flag_key || "")).run();

  return { ok: true };
}

/**
 * The approved period a set of punch stamps would touch, if any — the clock
 * fix refuses to move punches in or out of approved hours.
 */
export async function approvedPeriodTouching(db, employeeId, stamps) {
  const starts = [...new Set(stamps.filter(Boolean).map(s => payPeriodFor(torontoParts(s).date).start))];
  if (!starts.length) return null;

  return db.prepare(
    `SELECT period_start, period_end FROM timesheet_approvals
     WHERE employee_id = ? AND unlocked_at IS NULL
       AND period_start IN (${starts.map(() => "?").join(",")})
     LIMIT 1`
  ).bind(employeeId, ...starts).first();
}

/* ---------- Staff: their own flags ---------- */

/**
 * The flags on your own hours that you can answer, for this period and the
 * last — the one being paid next. Approved periods are closed, and flags the
 * boss already cleared aren't asked about.
 */
async function ownOpenFlags(db, employeeId, now) {
  const current = payPeriodFor(torontoParts(now).date);
  const out = [];

  for (const period of [stepPeriod(current, -1), current]) {
    const { people } = await loadPeriod(db, period, now, employeeId);
    const me = people.find(p => p.id === employeeId);
    if (!me || me.approval) continue;

    for (const f of me.flags) {
      if (f.dismissed || !STAFF_FLAG_TYPES.includes(f.type)) continue;
      const anchor = f.key.slice(f.key.indexOf(":") + 1);
      const shift = me.shifts.find(s => s.in_at === anchor) || null;
      const noShow = f.type === "no_show" ? me.no_shows.find(n => `no_show:${n.id}` === f.key) : null;
      out.push({
        key: f.key,
        type: f.type,
        label: f.label,
        date: f.date,
        period,
        shift: shift ? { in_at: shift.in_at, out_at: shift.out_at, breaks: shift.breaks } : null,
        scheduled: noShow ? { title: noShow.title, starts_at: noShow.starts_at, ends_at: noShow.ends_at } : null,
        response: f.response || null
      });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export async function handleMyFlags(request, env) {
  const auth = await requireUser(request, env, "clock");
  if (!auth.ok) return auth;
  return { ok: true, flags: await ownOpenFlags(env.DB, auth.user.id, nowUtcStamp()) };
}

const UTC_STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * A staff member's answer to a flag on their own hours. They only explain;
 * the punches are the boss's to change. A time is kept only where it's what
 * the boss would type in: a missing clock-out or break end, or the real
 * clock-out behind a 16-hour shift.
 */
export async function handleRespondToFlag(request, env) {
  const auth = await requireUser(request, env, "clock");
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);
  const key = String(body.flag_key || "");
  const note = optionalText(body.note);
  if (!note) return { ok: false, error: "Say what happened." };
  if (note.length > 500) return { ok: false, error: "Keep it under 500 characters." };

  const open = await ownOpenFlags(env.DB, auth.user.id, nowUtcStamp());
  const target = open.find(f => f.key === key);
  if (!target) return { ok: false, error: "That one's already been sorted out. Reload to see what's left." };

  let suggested = null;
  if (["no_clock_out", "open_break", "long_shift"].includes(target.type) && body.suggested_at) {
    suggested = String(body.suggested_at);
    if (!UTC_STAMP.test(suggested)) return { ok: false, error: "That time didn't look right." };
    if (target.shift && suggested <= target.shift.in_at) {
      return { ok: false, error: "That time is before you clocked in." };
    }
  }

  await env.DB.prepare(
    `INSERT INTO timesheet_flag_responses (employee_id, flag_key, note, suggested_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (employee_id, flag_key) DO UPDATE SET
       note = excluded.note, suggested_at = excluded.suggested_at, created_at = CURRENT_TIMESTAMP`
  ).bind(auth.user.id, key, note, suggested).run();

  return { ok: true };
}
