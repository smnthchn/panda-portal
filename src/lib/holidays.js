/**
 * Ontario's public holidays, worked out rather than typed in — the store is in
 * Toronto and the list only moves with the calendar, so a table of dates would
 * be a thing to remember to refill every December.
 *
 * Eight of the nine are a fixed date or the nth weekday of a month. Good Friday
 * hangs off Easter, which needs the computus. The August civic holiday isn't
 * statutory in Ontario, but the street closes for it, so it's listed with
 * `statutory: false` rather than left out.
 *
 * Whether Panda Hobby is actually open on any of these is a decision, not a
 * fact about the calendar — that lives in `store_holidays`.
 */

const pad = n => String(n).padStart(2, "0");

function iso(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The nth given weekday of a month — (2026, 2, 1, 3) is February's third Monday. */
function nthWeekday(year, month, weekday, n) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return iso(year, month, 1 + offset + (n - 1) * 7);
}

/** The last given weekday on or before a date — Victoria Day is the Monday on or before May 24. */
function weekdayOnOrBefore(year, month, day, weekday) {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - weekday + 7) % 7));
  return d.toISOString().slice(0, 10);
}

/** Easter Sunday, by the anonymous Gregorian computus. */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

function daysBefore(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Every Ontario holiday in a calendar year, in date order. */
export function ontarioHolidays(year) {
  return [
    { date: iso(year, 1, 1), name: "New Year's Day", statutory: true },
    { date: nthWeekday(year, 2, 1, 3), name: "Family Day", statutory: true },
    { date: daysBefore(easterSunday(year), 2), name: "Good Friday", statutory: true },
    { date: weekdayOnOrBefore(year, 5, 24, 1), name: "Victoria Day", statutory: true },
    { date: iso(year, 7, 1), name: "Canada Day", statutory: true },
    { date: nthWeekday(year, 8, 1, 1), name: "Civic Holiday", statutory: false },
    { date: nthWeekday(year, 9, 1, 1), name: "Labour Day", statutory: true },
    { date: nthWeekday(year, 10, 1, 2), name: "Thanksgiving", statutory: true },
    { date: iso(year, 12, 25), name: "Christmas Day", statutory: true },
    { date: iso(year, 12, 26), name: "Boxing Day", statutory: true }
  ].sort((a, b) => a.date.localeCompare(b.date));
}

/** The holidays falling in a date range, inclusive. A week can straddle New Year. */
export function holidaysBetween(fromIso, toIso) {
  const fromYear = Number(fromIso.slice(0, 4));
  const toYear = Number(toIso.slice(0, 4));
  const out = [];

  for (let year = fromYear; year <= toYear; year++) {
    for (const holiday of ontarioHolidays(year)) {
      if (holiday.date >= fromIso && holiday.date <= toIso) out.push(holiday);
    }
  }

  return out;
}

/** The holiday on a given date, or null. */
export function holidayOn(isoDate) {
  return ontarioHolidays(Number(isoDate.slice(0, 4))).find(h => h.date === isoDate) || null;
}
