import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src";
import { matchPath, getCookie, optionalText, requiredText, BadRequest } from "../src/lib/http.js";
import { roleOutranks, isValidRole, ROLES, ROLE_LABELS } from "../src/lib/permissions.js";
import { optionalUrl, hiddenFromStaff } from "../src/routes/conventions.js";
import { pairClockEvents } from "../src/routes/clock.js";
import { segmentsFor, buildRoster, liveStatusFromEvents } from "../src/routes/dashboard.js";
import { parseAvatarDataUri, avatarUrlFor } from "../src/routes/staff.js";
import { mergeIntervals, coverageGaps, toMinutes, resolveSpan, rotaWeeks, scheduleDates } from "../src/routes/schedule.js";
import { ontarioHolidays, holidaysBetween, holidayOn, easterSunday } from "../src/lib/holidays.js";
import { fullWeek, availabilityConflict } from "../src/routes/availability.js";
import {
  tierHeights,
  tierCapacity,
  positionCapacity,
  tierWidthIn,
  BOX_WIDTH_IN
} from "../src/lib/capacity.js";
import {
  layoutConflicts,
  effectiveGeometry,
  stageTotals,
  stageApplies,
  boardFaces,
  sectionOrder,
  signageList
} from "../src/routes/shelves.js";
import { templatePositions, BOOTH_FEET } from "../src/lib/booth-template.js";
import { parseImageDataUri, imageUrlFor } from "../src/lib/images.js";

function request(path, method = "GET", headers = {}) {
  return new Request(`http://example.com${path}`, { method, headers });
}

async function call(req) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe("matchPath", () => {
  it("captures a path parameter", () => {
    expect(matchPath("/api/admin/users/12", "/api/admin/users/:id")).toEqual({ id: "12" });
  });

  it("does not match a different length", () => {
    expect(matchPath("/api/admin/users", "/api/admin/users/:id")).toBeNull();
  });

  it("does not let a parameter swallow a nested literal route", () => {
    expect(matchPath("/api/conventions/anime-north/shifts", "/api/conventions/:slug")).toBeNull();
  });

  it("decodes encoded parameters", () => {
    expect(matchPath("/api/conventions/anime%20north", "/api/conventions/:slug"))
      .toEqual({ slug: "anime north" });
  });
});

describe("getCookie", () => {
  it("reads one cookie out of several", () => {
    const req = request("/", "GET", { Cookie: "foo=1; session_id=abc-123; bar=2" });
    expect(getCookie(req, "session_id")).toBe("abc-123");
  });

  it("does not match on a prefix", () => {
    const req = request("/", "GET", { Cookie: "not_session_id=nope" });
    expect(getCookie(req, "session_id")).toBeNull();
  });

  it("returns null when there are no cookies", () => {
    expect(getCookie(request("/"), "session_id")).toBeNull();
  });
});

describe("field helpers", () => {
  it("treats blank strings as absent", () => {
    expect(optionalText("   ")).toBeNull();
    expect(optionalText(undefined)).toBeNull();
    expect(optionalText("  hi ")).toBe("hi");
  });

  it("rejects missing required fields", () => {
    expect(() => requiredText("", "Email")).toThrow(BadRequest);
  });
});

describe("role ranking", () => {
  it("lets higher roles see lower-role content", () => {
    expect(roleOutranks("boss", "staff")).toBe(true);
    expect(roleOutranks("boss", "volunteer")).toBe(true);
    expect(roleOutranks("staff", "volunteer")).toBe(true);
  });

  it("does not let lower roles see higher-role content", () => {
    expect(roleOutranks("staff", "boss")).toBe(false);
    expect(roleOutranks("volunteer", "staff")).toBe(false);
  });

  it("rejects unknown roles", () => {
    expect(isValidRole("manager")).toBe(false);
    expect(roleOutranks("manager", "staff")).toBe(false);
  });

  it("knows seasonal staff", () => {
    expect(isValidRole("seasonal")).toBe(true);
    expect(ROLES).toContain("seasonal");
    expect(ROLE_LABELS.seasonal).toBe("Seasonal Staff");
  });

  it("lets seasonal staff reach everything staff reach", () => {
    // The point of the role is who's seasonal, not a lower tier of access —
    // a staff-only checklist or document is theirs to read too.
    expect(roleOutranks("seasonal", "staff")).toBe(true);
    expect(roleOutranks("seasonal", "volunteer")).toBe(true);
    expect(roleOutranks("staff", "seasonal")).toBe(true);
  });

  it("keeps seasonal staff out of boss-only content", () => {
    expect(roleOutranks("seasonal", "boss")).toBe(false);
  });

  it("still ranks volunteers below seasonal staff", () => {
    expect(roleOutranks("volunteer", "seasonal")).toBe(false);
  });
});

describe("link fields", () => {
  // These values become hrefs, so anything but http(s) has to be rejected.
  it.each([
    "javascript:alert(document.cookie)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///C:/Windows/system.ini",
    "not a url at all"
  ])("rejects %s", (value) => {
    expect(() => optionalUrl(value, "Link")).toThrow(BadRequest);
  });

  it("accepts ordinary http and https links", () => {
    expect(optionalUrl("https://maps.app.goo.gl/abc123", "Link")).toBe("https://maps.app.goo.gl/abc123");
    expect(optionalUrl("http://example.com/floorplan.pdf", "Link")).toBe("http://example.com/floorplan.pdf");
  });

  it("treats a blank link as absent rather than invalid", () => {
    expect(optionalUrl("", "Link")).toBeNull();
    expect(optionalUrl("   ", "Link")).toBeNull();
    expect(optionalUrl(undefined, "Link")).toBeNull();
  });
});

describe("clock event pairing", () => {
  const ev = (type, at) => ({ event_type: type, created_at: at });

  it("pairs a shift and deducts its breaks", () => {
    const shifts = pairClockEvents([
      ev("clock_in", "2026-08-10 14:00:00"),
      ev("break_start", "2026-08-10 17:00:00"),
      ev("break_end", "2026-08-10 17:30:00"),
      ev("break_start", "2026-08-10 19:00:00"),
      ev("break_end", "2026-08-10 19:15:00"),
      ev("clock_out", "2026-08-10 22:00:00")
    ]);

    expect(shifts).toEqual([{
      in_at: "2026-08-10 14:00:00",
      out_at: "2026-08-10 22:00:00",
      break_minutes: 45,
      net_minutes: 435
    }]);
  });

  it("leaves a shift with no clock-out open and uncounted", () => {
    const shifts = pairClockEvents([ev("clock_in", "2026-08-10 14:00:00")]);
    expect(shifts).toHaveLength(1);
    expect(shifts[0].out_at).toBeNull();
    expect(shifts[0].net_minutes).toBeNull();
  });

  it("closes a forgotten shift as incomplete when the next clock-in arrives", () => {
    const shifts = pairClockEvents([
      ev("clock_in", "2026-08-10 14:00:00"),
      ev("clock_in", "2026-08-11 09:00:00"),
      ev("clock_out", "2026-08-11 17:00:00")
    ]);

    expect(shifts).toHaveLength(2);
    expect(shifts[0].out_at).toBeNull();
    expect(shifts[0].net_minutes).toBeNull();
    expect(shifts[1].net_minutes).toBe(480);
  });

  it("ignores stray events before any clock-in", () => {
    const shifts = pairClockEvents([
      ev("break_end", "2026-08-10 10:00:00"),
      ev("clock_out", "2026-08-10 11:00:00"),
      ev("clock_in", "2026-08-10 12:00:00"),
      ev("clock_out", "2026-08-10 13:00:00")
    ]);

    expect(shifts).toHaveLength(1);
    expect(shifts[0].net_minutes).toBe(60);
  });

  it("runs an unclosed break until clock-out", () => {
    const shifts = pairClockEvents([
      ev("clock_in", "2026-08-10 09:00:00"),
      ev("break_start", "2026-08-10 12:00:00"),
      ev("clock_out", "2026-08-10 13:00:00")
    ]);

    expect(shifts[0].break_minutes).toBe(60);
    expect(shifts[0].net_minutes).toBe(180);
  });

  it("pairs by timestamp, not insertion order, so a fixed-up clock-out lands in its shift", () => {
    const shifts = pairClockEvents([
      ev("clock_in", "2026-08-10 14:00:00"),
      ev("clock_in", "2026-08-11 14:00:00"),
      ev("clock_out", "2026-08-11 22:00:00"),
      ev("clock_out", "2026-08-10 22:00:00") // the fix, inserted a day later
    ]);

    expect(shifts.map(s => s.net_minutes)).toEqual([480, 480]);
  });

  it("keeps separate shifts on the same day separate", () => {
    const shifts = pairClockEvents([
      ev("clock_in", "2026-08-10 09:00:00"),
      ev("clock_out", "2026-08-10 12:00:00"),
      ev("clock_in", "2026-08-10 16:00:00"),
      ev("clock_out", "2026-08-10 20:00:00")
    ]);

    expect(shifts.map(s => s.net_minutes)).toEqual([180, 240]);
  });
});

describe("hall hours segments", () => {
  it("lays setup, early access and open out proportionally", () => {
    const layout = segmentsFor({
      setup_start: "08:00", early_start: "09:00",
      regular_start: "10:00", regular_end: "19:00"
    });

    // 8:00–19:00 is 11 hours: 1h setup, 1h early, 9h open.
    expect(layout.span_start).toBe(480);
    expect(layout.span_end).toBe(1140);
    expect(layout.segments.map(s => s.kind)).toEqual(["set", "vip", "open"]);
    expect(layout.segments.map(s => Math.round(s.width))).toEqual([9, 9, 82]);
  });

  it("is just the open block when there's no setup or early access", () => {
    const layout = segmentsFor({ regular_start: "10:00", regular_end: "17:00" });
    expect(layout.segments).toHaveLength(1);
    expect(layout.segments[0].width).toBe(100);
    expect(layout.span_start).toBe(600);
  });

  it("returns null for a day with no usable regular hours", () => {
    expect(segmentsFor({ setup_start: "08:00" })).toBeNull();
    expect(segmentsFor({ regular_start: "18:00", regular_end: "10:00" })).toBeNull();
    expect(segmentsFor(null)).toBeNull();
  });

  it("ignores an early access that isn't before doors", () => {
    const layout = segmentsFor({ early_start: "10:00", regular_start: "10:00", regular_end: "17:00" });
    expect(layout.segments.map(s => s.kind)).toEqual(["open"]);
  });
});

describe("live clock status from the punch log", () => {
  const ev = (type) => ({ event_type: type, created_at: "2026-08-13 15:00:00" });

  it("reads the state off the last punch", () => {
    expect(liveStatusFromEvents([ev("clock_in")])).toBe("in");
    expect(liveStatusFromEvents([ev("clock_in"), ev("break_start")])).toBe("break");
    expect(liveStatusFromEvents([ev("clock_in"), ev("break_start"), ev("break_end")])).toBe("in");
    expect(liveStatusFromEvents([ev("clock_in"), ev("clock_out")])).toBe("out");
  });

  it("treats no punches as out", () => {
    expect(liveStatusFromEvents([])).toBe("out");
    expect(liveStatusFromEvents(undefined)).toBe("out");
  });
});

describe("today's roster", () => {
  const shift = (id, name, starts, ends) => ({
    employee_id: id, employee_name: name, employee_role: "staff",
    title: "Booth", starts_at: starts, ends_at: ends, convention_name: "Fan Expo"
  });

  const people = (entries) => new Map(entries.map(([id, name]) =>
    [id, { id, full_name: name, role: "staff" }]
  ));

  const punch = (type) => ({ event_type: type, created_at: "2026-08-13 15:00:00" });
  const noOpenShift = () => null;
  const NOON = 12 * 60;

  it("flags someone whose shift started but who never clocked in", () => {
    const roster = buildRoster(
      [shift(1, "Marcus Kwan", "10:00", "18:00")],
      new Map(),
      people([[1, "Marcus Kwan"]]),
      noOpenShift,
      NOON
    );

    expect(roster[0].status).toBe("late");
    expect(roster[0].initials).toBe("MK");
  });

  it("calls it a no-show once the shift they skipped has finished", () => {
    const roster = buildRoster(
      [shift(1, "Marcus Kwan", "07:00", "11:00")],
      new Map(),
      people([[1, "Marcus Kwan"]]),
      noOpenShift,
      NOON
    );

    expect(roster[0].status).toBe("missed");
  });

  it("does not call someone late before their shift starts", () => {
    const roster = buildRoster(
      [shift(1, "Marcus Kwan", "15:00", "20:00")],
      new Map(),
      people([[1, "Marcus Kwan"]]),
      noOpenShift,
      NOON
    );

    expect(roster[0].status).toBe("upcoming");
  });

  it("reports in and break from each person's punches", () => {
    const roster = buildRoster(
      [shift(1, "Ann Lee", "09:00", "17:00"), shift(2, "Bo Ng", "09:00", "17:00")],
      new Map([[1, [punch("clock_in")]], [2, [punch("clock_in"), punch("break_start")]]]),
      people([[1, "Ann Lee"], [2, "Bo Ng"]]),
      noOpenShift,
      NOON
    );

    expect(roster.map(p => p.status)).toEqual(["in", "break"]);
    expect(roster.every(p => p.clocked_in)).toBe(true);
  });

  it("counts someone who already clocked out as done, not late", () => {
    const roster = buildRoster(
      [shift(1, "Ann Lee", "07:00", "11:00")],
      new Map([[1, [punch("clock_in"), punch("clock_out")]]]),
      people([[1, "Ann Lee"]]),
      noOpenShift,
      NOON
    );

    expect(roster[0].status).toBe("done");
  });

  // On a store day nobody has a shift, because shifts only exist against
  // conventions — but the boss still needs to see who's in.
  it("includes someone who clocked in with no shift on the books", () => {
    const roster = buildRoster(
      [],
      new Map([[7, [punch("clock_in")]]]),
      people([[7, "Jenna Tran"]]),
      noOpenShift,
      NOON
    );

    expect(roster).toHaveLength(1);
    expect(roster[0].name).toBe("Jenna Tran");
    expect(roster[0].starts_at).toBeNull();
    expect(roster[0].status).toBe("in");
  });

  it("orders by shift start, with the unscheduled last", () => {
    const roster = buildRoster(
      [shift(1, "Late Start", "15:00", "20:00"), shift(2, "Early Start", "09:00", "17:00")],
      new Map([[9, [punch("clock_in")]]]),
      people([[1, "Late Start"], [2, "Early Start"], [9, "No Shift"]]),
      noOpenShift,
      NOON
    );

    expect(roster.map(p => p.name)).toEqual(["Early Start", "Late Start", "No Shift"]);
  });
});

describe("avatar uploads", () => {
  // "AAAA" is 3 valid base64 bytes — enough to stand in for image data.
  const tiny = (mime) => `data:${mime};base64,AAAA`;

  it("accepts the image types the browser can produce", () => {
    for (const mime of ["image/webp", "image/png", "image/jpeg"]) {
      expect(parseAvatarDataUri(tiny(mime)).mimeType).toBe(mime);
    }
  });

  // The stored string ends up in an <img src>, so an SVG would be a script
  // execution route dressed up as a picture.
  it("refuses svg and other non-image types", () => {
    expect(() => parseAvatarDataUri(tiny("image/svg+xml"))).toThrow(BadRequest);
    expect(() => parseAvatarDataUri(tiny("text/html"))).toThrow(BadRequest);
  });

  it("refuses anything that isn't a base64 data uri", () => {
    expect(() => parseAvatarDataUri("https://example.com/face.png")).toThrow(BadRequest);
    expect(() => parseAvatarDataUri("data:image/png,notbase64")).toThrow(BadRequest);
    expect(() => parseAvatarDataUri("")).toThrow(BadRequest);
    expect(() => parseAvatarDataUri(null)).toThrow(BadRequest);
  });

  it("refuses an image past the size cap", () => {
    const huge = `data:image/png;base64,${"A".repeat(600 * 1024)}`;
    expect(() => parseAvatarDataUri(huge)).toThrow(BadRequest);
  });

  it("measures decoded size rather than string length", () => {
    // 8 base64 chars with two pad chars carry 4 bytes.
    expect(parseAvatarDataUri("data:image/png;base64,AAAAAA==").bytes).toBe(4);
  });

  it("cache-busts the url on the person's last edit", () => {
    expect(avatarUrlFor(4, "2026-08-13 17:20:05")).toBe("/api/avatar/4?v=20260813172005");
    expect(avatarUrlFor(4, null)).toBe("/api/avatar/4?v=");
  });
});

describe("booth coverage", () => {
  const shift = (starts_at, ends_at) => ({ starts_at, ends_at });
  const hall = (open, close) => [toMinutes(open), toMinutes(close)];

  it("merges overlapping and touching shifts into one stretch", () => {
    expect(mergeIntervals([
      shift("10:00", "14:00"),
      shift("13:00", "18:00"),
      shift("18:00", "20:00")
    ])).toEqual([{ start: 600, end: 1200 }]);
  });

  it("keeps a genuine break in cover as two stretches", () => {
    expect(mergeIntervals([shift("10:00", "12:00"), shift("14:00", "18:00")]))
      .toEqual([{ start: 600, end: 720 }, { start: 840, end: 1080 }]);
  });

  it("finds a hole in the middle of the day", () => {
    const gaps = coverageGaps(
      [shift("10:00", "12:00"), shift("14:00", "19:00")],
      ...hall("10:00", "19:00")
    );
    expect(gaps).toEqual([{ from: "12:00", to: "14:00" }]);
  });

  // The two that actually bite: nobody there when the doors open, and
  // everyone gone before they close.
  it("flags a late start and an early finish", () => {
    expect(coverageGaps([shift("11:00", "17:00")], ...hall("10:00", "19:00")))
      .toEqual([{ from: "10:00", to: "11:00" }, { from: "17:00", to: "19:00" }]);
  });

  it("reports no gaps when the day is covered end to end", () => {
    expect(coverageGaps(
      [shift("10:00", "15:00"), shift("15:00", "19:00")],
      ...hall("10:00", "19:00")
    )).toEqual([]);
  });

  it("ignores cover outside hall hours rather than counting it", () => {
    // Setup from 08:00 doesn't help once the doors open at 10:00.
    expect(coverageGaps([shift("08:00", "10:00")], ...hall("10:00", "19:00")))
      .toEqual([{ from: "10:00", to: "19:00" }]);
  });

  it("counts an empty day as entirely uncovered", () => {
    expect(coverageGaps([], ...hall("10:00", "19:00")))
      .toEqual([{ from: "10:00", to: "19:00" }]);
  });

  it("says nothing when there are no hall hours to compare against", () => {
    expect(coverageGaps([shift("10:00", "18:00")], null, null)).toEqual([]);
  });

  it("drops a backwards or unparseable shift instead of inverting the maths", () => {
    expect(mergeIntervals([shift("18:00", "10:00"), shift("bad", "12:00")])).toEqual([]);
  });
});

describe("schedule spans", () => {
  // 2026-09-16 is a Wednesday, which is the interesting case: the week presets
  // have to snap back to Monday from it.
  const wednesday = "2026-09-16";
  const span = (span, extra = {}) => resolveSpan({ span, today: wednesday, ...extra });

  it("snaps a week and a fortnight back to Monday", () => {
    expect(span("week")).toMatchObject({ from: "2026-09-14", to: "2026-09-20", days: 7 });
    expect(span("2week")).toMatchObject({ from: "2026-09-14", to: "2026-09-27", days: 14 });
  });

  it("steps a week at a time, staying on Mondays", () => {
    expect(span("week")).toMatchObject({ prev_from: "2026-09-07", next_from: "2026-09-21" });
  });

  it("treats a month as the calendar month rather than thirty days", () => {
    expect(span("month")).toMatchObject({ from: "2026-09-01", to: "2026-09-30", days: 30 });
    // February is the one that catches a fixed count out.
    expect(resolveSpan({ span: "month", today: "2028-02-10" }))
      .toMatchObject({ from: "2028-02-01", to: "2028-02-29", days: 29 });
  });

  it("steps a month to the next month, not forward thirty days", () => {
    expect(resolveSpan({ span: "month", today: "2026-01-31" }))
      .toMatchObject({ prev_from: "2025-12-01", next_from: "2026-02-01" });
  });

  it("starts a custom range where you pointed it and steps by its own length", () => {
    expect(span("custom", { from: wednesday, days: 10 }))
      .toMatchObject({ from: wednesday, to: "2026-09-25", days: 10, prev_from: "2026-09-06" });
  });

  it("clamps a silly custom count instead of building a two-year grid", () => {
    expect(span("custom", { from: wednesday, days: 900 }).days).toBe(62);
    expect(span("custom", { from: wednesday, days: 0 }).days).toBe(1);
  });

  it("falls back to the week for an unknown span", () => {
    expect(span("fortnightly").span).toBe("week");
    expect(span(undefined).span).toBe("week");
  });

  it("defaults a single day to the day itself", () => {
    expect(span("day")).toMatchObject({ from: wednesday, to: wednesday, days: 1 });
  });
});

describe("the rota grid", () => {
  const day = (date, overrides = {}) => ({
    date,
    weekday_name: "Monday",
    in_range: true,
    closed: false,
    closed_for_holiday: false,
    holiday: null,
    hours: { opens_at: "12:00", closes_at: "19:00" },
    gaps: [],
    shifts: [],
    event_shifts: [],
    ...overrides
  });

  const worked = (employeeId, name, starts = "11:30", ends = "19:30", shiftId = employeeId) => ({
    id: shiftId, employee_id: employeeId, employee_name: name, avatar_url: null,
    employee_role: "staff", starts_at: starts, ends_at: ends, title: "Store floor"
  });

  // A fortnight, Monday 2026-09-14 through Sunday 2026-09-27.
  const fortnight = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 8, 14 + i)).toISOString().slice(0, 10);
    return day(d);
  });

  it("cuts the range into Monday-to-Sunday blocks of seven", () => {
    const weeks = rotaWeeks(fortnight);
    expect(weeks).toHaveLength(2);
    expect(weeks.map(w => w.week_start)).toEqual(["2026-09-14", "2026-09-21"]);
    expect(weeks[0].days).toHaveLength(7);
  });

  it("gives a person a row only in the week they actually work", () => {
    const days = fortnight.map((d, i) => (i === 1 ? { ...d, shifts: [worked(4, "Kevin")] } : d));
    const weeks = rotaWeeks(days);

    expect(weeks[0].rows.map(r => r.name)).toEqual(["Kevin"]);
    expect(weeks[1].rows).toEqual([]);
    expect(weeks[0].rows[0].cells["2026-09-15"]).toHaveLength(1);
  });

  it("keeps a padded-out column in place but empty", () => {
    const days = fortnight.map((d, i) =>
      i === 0 ? { ...d, in_range: false, shifts: [worked(4, "Kevin")] } : d
    );
    const weeks = rotaWeeks(days);

    // The Monday column still exists, so the two tables line up...
    expect(weeks[0].days[0].date).toBe("2026-09-14");
    expect(weeks[0].days[0].in_range).toBe(false);
    // ...but its shift is not on the chart.
    expect(weeks[0].rows).toEqual([]);
  });

  it("stacks two shifts on one person's day in the same cell", () => {
    const days = fortnight.map((d, i) =>
      i === 0 ? { ...d, shifts: [worked(4, "Kevin", "11:30", "15:00", 71), worked(4, "Kevin", "16:00", "19:30", 72)] } : d
    );
    expect(rotaWeeks(days)[0].rows[0].cells["2026-09-14"]).toHaveLength(2);
  });

  it("sorts people by name and drops unassigned to the bottom", () => {
    const days = fortnight.map((d, i) => i === 0 ? {
      ...d,
      shifts: [
        { ...worked(0, null), id: 1, employee_id: null, employee_name: null },
        worked(4, "Kevin"),
        worked(3, "Ada")
      ]
    } : d);

    expect(rotaWeeks(days)[0].rows.map(r => r.name)).toEqual(["Ada", "Kevin", "Unassigned"]);
  });

  it("carries an event shift onto the chart, tagged with its show", () => {
    const days = fortnight.map((d, i) => i === 0 ? {
      ...d,
      event_shifts: [{ ...worked(4, "Kevin"), convention_name: "Fan Expo" }]
    } : d);

    expect(rotaWeeks(days)[0].rows[0].cells["2026-09-14"][0].convention_name).toBe("Fan Expo");
  });
});

describe("Ontario holidays", () => {
  const on = (year, name) => ontarioHolidays(year).find(h => h.name === name)?.date;
  const weekdayOf = isoDate => new Date(`${isoDate}T00:00:00Z`).getUTCDay();

  it("puts Family Day on February's third Monday", () => {
    expect(on(2026, "Family Day")).toBe("2026-02-16");
    expect(on(2027, "Family Day")).toBe("2027-02-15");
  });

  it("puts Victoria Day on the Monday on or before May 24", () => {
    expect(on(2026, "Victoria Day")).toBe("2026-05-18");
    // 2027's May 24 is itself a Monday, which the 'on or before' has to keep.
    expect(on(2027, "Victoria Day")).toBe("2027-05-24");
  });

  it("puts Thanksgiving on October's second Monday", () => {
    expect(on(2026, "Thanksgiving")).toBe("2026-10-12");
  });

  it("lands every moveable holiday on a Monday except Good Friday", () => {
    for (const holiday of ontarioHolidays(2026)) {
      if (["New Year's Day", "Canada Day", "Christmas Day", "Boxing Day"].includes(holiday.name)) continue;
      expect(weekdayOf(holiday.date)).toBe(holiday.name === "Good Friday" ? 5 : 1);
    }
  });

  it("derives Good Friday from Easter", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(on(2026, "Good Friday")).toBe("2026-04-03");
    expect(easterSunday(2027)).toBe("2027-03-28");
    expect(on(2027, "Good Friday")).toBe("2027-03-26");
  });

  it("marks the August civic holiday as observed rather than statutory", () => {
    const civic = ontarioHolidays(2026).find(h => h.name === "Civic Holiday");
    expect(civic.statutory).toBe(false);
    expect(ontarioHolidays(2026).filter(h => h.statutory)).toHaveLength(9);
  });

  it("spans both years when a week straddles New Year", () => {
    const dates = holidaysBetween("2026-12-28", "2027-01-03").map(h => h.date);
    expect(dates).toEqual(["2027-01-01"]);
    expect(holidaysBetween("2026-12-21", "2027-01-03").map(h => h.date))
      .toEqual(["2026-12-25", "2026-12-26", "2027-01-01"]);
  });

  it("finds nothing on an ordinary day", () => {
    expect(holidayOn("2026-03-11")).toBeNull();
    expect(holidayOn("2026-12-25").name).toBe("Christmas Day");
  });
});

describe("availability", () => {
  // Thursday 13 August 2026 is weekday 4.
  const THURSDAY = { date: "2026-08-13", weekday: 4 };

  it("treats a day nobody has spoken about as fully available", () => {
    const week = fullWeek([]);
    expect(week).toHaveLength(7);
    expect(week.every(day => day.is_available)).toBe(true);
    expect(availabilityConflict(week, [], THURSDAY)).toBeNull();
  });

  it("flags a weekday someone said they can't work", () => {
    const week = fullWeek([{ weekday: 4, is_available: 0, earliest: null, latest: null }]);
    expect(availabilityConflict(week, [], THURSDAY)).toEqual({
      level: "clash",
      reason: "not available Thursdays"
    });
  });

  it("flags a shift starting before someone's earliest", () => {
    const week = fullWeek([{ weekday: 4, is_available: 1, earliest: "17:00", latest: null }]);
    expect(availabilityConflict(week, [], { ...THURSDAY, startsAt: "11:00" }))
      .toEqual({ level: "warn", reason: "not before 17:00 on Thursdays" });

    expect(availabilityConflict(week, [], { ...THURSDAY, startsAt: "18:00" })).toBeNull();
  });

  it("flags a shift running past someone's latest", () => {
    const week = fullWeek([{ weekday: 4, is_available: 1, earliest: null, latest: "15:00" }]);
    expect(availabilityConflict(week, [], { ...THURSDAY, endsAt: "19:00" }))
      .toEqual({ level: "warn", reason: "not after 15:00 on Thursdays" });
  });

  // Approved time off beats the weekly pattern — it's the more specific answer.
  it("treats approved time off covering the day as a clash", () => {
    const timeOff = [{ starts_on: "2026-08-10", ends_on: "2026-08-17", status: "approved" }];
    expect(availabilityConflict(fullWeek([]), timeOff, THURSDAY))
      .toEqual({ level: "clash", reason: "on approved time off" });
  });

  it("mentions a pending request without calling it a clash", () => {
    const timeOff = [{ starts_on: "2026-08-13", ends_on: "2026-08-13", status: "pending" }];
    expect(availabilityConflict(fullWeek([]), timeOff, THURSDAY))
      .toEqual({ level: "warn", reason: "has time off pending" });
  });

  it("ignores time off that doesn't cover the day", () => {
    const timeOff = [{ starts_on: "2026-08-01", ends_on: "2026-08-12", status: "approved" }];
    expect(availabilityConflict(fullWeek([]), timeOff, THURSDAY)).toBeNull();
  });
});

describe("shelf capacity", () => {
  const unit = (over = {}) => ({ tier_count: 4, usable_height_in: 72, w: 50 / 12, h: 20 / 12, ...over });
  const family = (over = {}) => ({
    id: 1, name: "HG Universal Century", box_class: "medium",
    box_height_in: 12.5, facings: 2, sku_count: 79, placement: "tier", ...over
  });
  const onEveryTier = (id, count) =>
    Array.from({ length: count }, (_, i) => ({ grouping_id: id, tier_index: i + 1 }));

  it("measures a tier across the unit's long side, whichever way it is turned", () => {
    expect(tierWidthIn({ w: 50 / 12, h: 20 / 12 })).toBeCloseTo(50);
    expect(tierWidthIn({ w: 20 / 12, h: 50 / 12 })).toBeCloseTo(50);
  });

  it("splits the usable height evenly when nothing says otherwise", () => {
    expect(tierHeights(unit())).toEqual([18, 18, 18, 18]);
  });

  it("gives the rest of the height to the tiers that didn't speak", () => {
    // A blind-box unit: four short tiers over two taller ones at the bottom.
    const heights = tierHeights(unit({ tier_count: 6 }), [
      { tier_index: 5, height_in: 16 },
      { tier_index: 6, height_in: 16 }
    ]);
    expect(heights).toEqual([10, 10, 10, 10, 16, 16]);
    expect(heights.reduce((a, b) => a + b)).toBe(72);
  });

  it("counts how many SKUs face out across a tier at the chosen facings", () => {
    // 50" tier, medium boxes at 12.375" each, two facings per SKU: two SKUs.
    const tier = tierCapacity(50, 18, [family()]);
    expect(tier.families[0].skus).toBe(2);
    expect(tier.holds).toBe(2);
    expect(tier.over).toBe(false);
  });

  it("shows fewer SKUs as facings go up, which is the dial between shows", () => {
    const deep = tierCapacity(50, 18, [family({ facings: 4 })]);
    const shallow = tierCapacity(50, 18, [family({ facings: 1 })]);
    expect(deep.families[0].skus).toBe(1);
    expect(shallow.families[0].skus).toBe(4);
  });

  it("splits a tier evenly between two families sharing it", () => {
    const tier = tierCapacity(50, 18, [family(), family({ id: 2, name: "Real Grade" })]);
    expect(tier.families.map(f => f.skus)).toEqual([1, 1]);
  });

  it("calls a tier over capacity when a family can't show even one SKU", () => {
    const tier = tierCapacity(50, 18, [
      family({ box_class: "oversize", facings: 2 }),
      family({ id: 2, name: "Plush", box_class: "oversize", facings: 2 })
    ]);
    expect(tier.over).toBe(true);
    expect(tier.families.every(f => f.skus === 0)).toBe(true);
  });

  it("won't stand a box taller than the tier it's on", () => {
    const tier = tierCapacity(50, 10, [family({ box_height_in: 16 })]);
    expect(tier.families[0].tooTall).toBe(true);
    expect(tier.families[0].skus).toBe(0);
    expect(tier.over).toBe(true);
  });

  it("reports what a family shows against the pool it's picked from", () => {
    const plan = positionCapacity(unit(), [family()], onEveryTier(1, 4));
    expect(plan.holds).toBe(8);
    expect(plan.families[0]).toMatchObject({ shows: 8, pool: 79, placed: true, tiers: [1, 2, 3, 4] });
  });

  it("lets a family skip the tiers it shouldn't be on", () => {
    // Blind boxes ride the top tiers, out of reach of an open bag.
    const plan = positionCapacity(
      unit({ tier_count: 6 }),
      [family({ box_class: "small", box_height_in: 4, facings: 3 })],
      [1, 2, 3].map(t => ({ grouping_id: 1, tier_index: t }))
    );
    expect(plan.families[0].tiers).toEqual([1, 2, 3]);
    expect(plan.tiers[3].holds).toBe(0);
    expect(plan.tiers[3].over).toBe(false);
  });

  it("says a family assigned to the unit but to no tier is unplaced", () => {
    const plan = positionCapacity(unit(), [family()], []);
    expect(plan.families[0]).toMatchObject({ placed: false, shows: 0 });
  });

  it("keeps tools and up tops out of the tiers and asks for a number instead", () => {
    const plan = positionCapacity(unit(), [
      family(),
      family({ id: 2, name: "Tools", placement: "side", sku_count: 176 })
    ], onEveryTier(1, 4));

    expect(plan.families.map(f => f.name)).toEqual(["HG Universal Century"]);
    expect(plan.offTier).toEqual([
      { id: 2, name: "Tools", placement: "side", pool: 176 }
    ]);
  });

  it("has no capacity at all for a unit that isn't a shelf", () => {
    const plan = positionCapacity(unit({ tier_count: 0 }), [family()], []);
    expect(plan.tiers).toEqual([]);
    expect(plan.holds).toBe(0);
  });

  it("keeps the box widths a division of the tier they were written against", () => {
    expect(BOX_WIDTH_IN.small * 6).toBeCloseTo(49.5);
    expect(BOX_WIDTH_IN.medium * 4).toBeCloseTo(49.5);
    expect(BOX_WIDTH_IN.large * 3).toBeCloseTo(49.5);
    expect(BOX_WIDTH_IN.oversize * 2).toBeCloseTo(49.5);
  });
});

describe("booth layout", () => {
  const at = (code, x, y, w, h) => ({ code, x, y, w, h, move_x: null, move_y: null, move_w: null, move_h: null });

  it("uses an arrange override in place of the baseline", () => {
    expect(effectiveGeometry({ x: 1, y: 2, w: 3, h: 4, move_x: 9, move_y: null, move_w: null, move_h: null }))
      .toEqual({ x: 9, y: 2, w: 3, h: 4 });
  });

  it("finds nothing wrong with the shipped booth template", () => {
    const positions = templatePositions().map(p => ({ ...p, move_x: null, move_y: null, move_w: null, move_h: null }));
    expect(positions).toHaveLength(31);
    expect(layoutConflicts(positions, BOOTH_FEET)).toEqual([]);
  });

  // The template shipped with an older set of labels: no S2, and an O5
  // standing in the middle of the centre island.
  it("labels the booth the way the floor plan does", () => {
    const codes = templatePositions().map(p => p.code);

    expect(codes).toContain("S2");
    expect(codes).toContain("C5");
    expect(codes).toContain("C6");
    expect(codes).not.toContain("O3");
    expect(codes).not.toContain("O4");
    expect(codes).not.toContain("O5");
    expect(new Set(codes).size).toBe(codes.length);
  });

  // The grid groups by runs of the same section, so the template has to list
  // each section together or it opens a second heading further down.
  it("keeps each section in one run", () => {
    const seen = [];
    for (const { wall } of templatePositions()) {
      if (seen[seen.length - 1] !== wall) seen.push(wall);
    }

    expect(seen).toEqual([...new Set(seen)]);
    expect(seen).toEqual([
      "SOUTH WALL", "EAST WALL", "NORTH WALL", "WEST WALL", "CENTER", "OVERSTOCK & OTHER"
    ]);
  });

  // The API hands this function positions that have already been mapped to a
  // `geometry` object. Reading the raw columns instead found no conflicts at
  // all — an invalid plan looked perfectly valid.
  it("reads geometry off a mapped position, not just a raw row", () => {
    const mapped = [
      { code: "E1", geometry: { x: 0, y: 0.5, w: 1.6667, h: 4.1667 } },
      { code: "E2", geometry: { x: 0, y: 4.1667, w: 1.6667, h: 4.1667 } }
    ];

    expect(effectiveGeometry(mapped[0])).toEqual({ x: 0, y: 0.5, w: 1.6667, h: 4.1667 });
    expect(layoutConflicts(mapped)[0].message).toBe("E1 and E2 overlap by 6″");
  });

  it("reports an overlap in inches", () => {
    const conflicts = layoutConflicts([at("E7", 0, 25, 1.6667, 3.1667), at("N1", 0, 28, 3.1667, 1.6667)]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].message).toBe("E7 and N1 overlap by 2″");
  });

  // Units stand right up against each other; a shared edge is not an overlap.
  it("does not call a shared edge an overlap", () => {
    expect(layoutConflicts([at("A", 0, 0, 2, 2), at("B", 2, 0, 2, 2)])).toEqual([]);
  });

  it("reports a unit hanging off the footprint", () => {
    const conflicts = layoutConflicts([at("W9", 15, 0, 2, 2)], BOOTH_FEET);
    expect(conflicts[0].message).toBe("W9 runs 12″ off the booth");
  });

  // A board is whatever has been assigned to the face, called whatever the
  // library calls it — there's no second name on the plan to drift out of
  // step with the picture.
  it("names a board from the library entry assigned to it", () => {
    const art = new Map([
      ["back", { id: 3, name: "Space board", image_url: "/api/resource-image/3?v=20260817" }],
      ["side", { id: 8, name: "Plush corner", image_url: "/api/resource-image/8?v=1" }]
    ]);

    expect(boardFaces(art)).toEqual([
      { face: "back", name: "Space board", resource_id: 3, image_url: "/api/resource-image/3?v=20260817" },
      { face: "side", name: "Plush corner", resource_id: 8, image_url: "/api/resource-image/8?v=1" }
    ]);
  });

  it("reports the faces in board order, whatever order they were assigned", () => {
    const art = new Map([
      ["front", { id: 2, name: "Front", image_url: "/f" }],
      ["back", { id: 1, name: "Back", image_url: "/b" }]
    ]);

    expect(boardFaces(art).map(f => f.face)).toEqual(["back", "front"]);
  });

  it("has no boards on a shelf nothing is assigned to", () => {
    expect(boardFaces(new Map())).toEqual([]);
    expect(boardFaces()).toEqual([]);
  });
});

// The grid groups by runs of the same wall, not by wall, so a shelf that
// changed section without changing place would open a second heading of its
// own at the bottom instead of joining the section already there.
describe("moving a shelf between sections", () => {
  const plan = () => [
    { id: 1, wall: "ENTRANCE" },
    { id: 2, wall: "EAST WALL" },
    { id: 3, wall: "EAST WALL" },
    { id: 4, wall: "OVERSTOCK & OTHER" }
  ];

  it("puts the shelf after the last one already in its section", () => {
    // S2 was added to Overstock and has just been set to ENTRANCE.
    const rows = plan();
    rows[3].wall = "ENTRANCE";

    expect(sectionOrder(rows, 4).map(r => r.id)).toEqual([1, 4, 2, 3]);
  });

  it("leaves the order alone when the shelf is already in place", () => {
    expect(sectionOrder(plan(), 3).map(r => r.id)).toEqual([1, 2, 3, 4]);
  });

  it("puts the first shelf of a new section at the end", () => {
    const rows = plan();
    rows[0].wall = "NORTH WALL";

    expect(sectionOrder(rows, 1).map(r => r.id)).toEqual([2, 3, 4, 1]);
  });

  it("does nothing for a shelf that isn't in the plan", () => {
    expect(sectionOrder(plan(), 99).map(r => r.id)).toEqual([1, 2, 3, 4]);
  });

  it("keeps only real signage codes", () => {
    expect(signageList("bc, fb, nonsense")).toEqual(["bc", "fb"]);
    expect(signageList(null)).toEqual([]);
  });

  // A shelf needing no signage has no boards to put up, so it must not drag
  // the Boards denominator up — it should read 1 / 2, never 1 / 3.
  it("leaves a shelf with no signage out of the Boards count entirely", () => {
    const positions = [
      { signage: "bc", stages: [true, true, true, true, true] },
      { signage: "fb", stages: [true, true, true, true, false] },
      { signage: "", stages: [true, true, true, true, false] }
    ];

    const totals = stageTotals(positions);
    expect(totals[0]).toMatchObject({ label: "SIZED", done: 3, total: 3 });
    expect(totals[4]).toMatchObject({ label: "BOARDS", done: 1, total: 2 });
    expect(stageApplies(positions[2], 4)).toBe(false);
    expect(stageApplies(positions[2], 0)).toBe(true);
  });
});

describe("stored pictures", () => {
  // Board artwork and shelf photos are banners and camera shots, not square
  // faces, so they go through the same guard as an avatar with their own caps.
  it("refuses anything that isn't a plain base64 image", () => {
    const tiny = (mime) => `data:${mime};base64,AAAA`;

    expect(parseImageDataUri(tiny("image/png"), 1000).mimeType).toBe("image/png");
    expect(() => parseImageDataUri(tiny("image/svg+xml"), 1000)).toThrow(BadRequest);
    expect(() => parseImageDataUri(tiny("text/html"), 1000)).toThrow(BadRequest);
    expect(() => parseImageDataUri("https://example.com/board.png", 1000)).toThrow(BadRequest);
  });

  it("stamps the url so a replacement isn't served from cache", () => {
    expect(imageUrlFor("/api/resource-image/7", "2026-08-17 09:15:00")).toBe(
      "/api/resource-image/7?v=20260817091500"
    );
  });

  it("holds each kind of picture to its own size cap", () => {
    const bigger = `data:image/png;base64,${"A".repeat(700 * 1024)}`;

    // ~525KB decoded: past an avatar's 400KB cap, inside a resource's 800KB.
    expect(() => parseImageDataUri(bigger, 400 * 1024)).toThrow(BadRequest);
    expect(parseImageDataUri(bigger, 800 * 1024).mimeType).toBe("image/png");
  });
});

describe("what staff can see of an event", () => {
  const event = (over = {}) => ({ is_published: 1, starts_on: "2026-08-27", ends_on: "2026-08-30", ...over });
  const DURING = "2026-08-28";
  const AFTER = "2026-09-01";
  const BEFORE = "2026-08-01";

  it("shows a published event that hasn't happened yet", () => {
    expect(hiddenFromStaff(event(), BEFORE)).toBe(false);
  });

  it("shows a published event while it's on", () => {
    expect(hiddenFromStaff(event(), DURING)).toBe(false);
  });

  it("shows it on its own last day, not the morning after", () => {
    expect(hiddenFromStaff(event(), "2026-08-30")).toBe(false);
    expect(hiddenFromStaff(event(), "2026-08-31")).toBe(true);
  });

  it("hides a show that's over", () => {
    expect(hiddenFromStaff(event(), AFTER)).toBe(true);
  });

  it("hides a draft whatever the date", () => {
    expect(hiddenFromStaff(event({ is_published: 0 }), BEFORE)).toBe(true);
    expect(hiddenFromStaff(event({ is_published: 0 }), DURING)).toBe(true);
  });

  // phaseOf() calls a dateless event upcoming rather than past, and this has to
  // agree with it or an event would vanish from the list while still claiming
  // to be upcoming on the card.
  it("never treats an event with no end date as over", () => {
    expect(hiddenFromStaff(event({ starts_on: null, ends_on: null }), AFTER)).toBe(false);
    expect(hiddenFromStaff(event({ ends_on: null }), AFTER)).toBe(false);
  });

  it("hides nothing that doesn't exist", () => {
    expect(hiddenFromStaff(null, DURING)).toBe(true);
    expect(hiddenFromStaff(undefined, DURING)).toBe(true);
  });
});

describe("which days an event's builder offers", () => {
  // Fan Expo 2026: store shuts Monday to pack, load-in Wednesday, doors Thu–Sun.
  const fanExpo = {
    store_close_on: "2026-08-24",
    setup_on: "2026-08-26",
    starts_on: "2026-08-27",
    ends_on: "2026-08-30"
  };

  it("offers the packing day the store closes for", () => {
    expect(scheduleDates(fanExpo, [])).toContain("2026-08-24");
  });

  it("leaves no holes between the first day and the last", () => {
    const days = scheduleDates(fanExpo, []);
    expect(days).toEqual([
      "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27",
      "2026-08-28", "2026-08-29", "2026-08-30"
    ]);
  });

  it("stretches to reach a shift outside the run", () => {
    // A tear-down shift the Monday after doors close.
    const days = scheduleDates(fanExpo, ["2026-08-31"]);
    expect(days[days.length - 1]).toBe("2026-08-31");
    expect(days).toContain("2026-08-24");
  });

  it("still works for an event with nothing but a start date", () => {
    expect(scheduleDates({ starts_on: "2026-05-22" }, [])).toEqual(["2026-05-22"]);
  });

  it("offers nothing when there are no dates at all", () => {
    expect(scheduleDates({}, [])).toEqual([]);
  });

  // A mistyped year would otherwise loop for years of tabs.
  it("stops rather than spinning on a typo'd date", () => {
    const days = scheduleDates({ starts_on: "2026-08-27", ends_on: "2126-08-30" }, []);
    expect(days.length).toBe(400);
  });
});

describe("api routing", () => {
  it("returns 404 JSON for an unknown api path", async () => {
    const response = await call(request("/api/nope"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "Not found" });
  });

  // Staff records carry phone numbers and notes, so an anonymous caller must
  // never get past the door — and the routes must actually be wired up.
  it("guards the staff endpoints behind a login", async () => {
    for (const [path, method] of [
      ["/api/admin/staff", "GET"],
      ["/api/admin/staff/1", "GET"],
      ["/api/admin/staff/1", "PATCH"],
      ["/api/convention-shifts/1/assign", "PUT"]
    ]) {
      const response = await call(request(path, method));
      expect(response.status, `${method} ${path}`).toBe(200);
      expect(await response.json(), `${method} ${path}`).toEqual({
        ok: false,
        error: "Not logged in"
      });
    }
  });

  it("does not let the staff id swallow a nested route", () => {
    expect(matchPath("/api/admin/staff", "/api/admin/staff/:id")).toBeNull();
    expect(matchPath("/api/admin/staff/12", "/api/admin/staff/:id")).toEqual({ id: "12" });
  });

  it("returns 404 when the path matches but the method does not", async () => {
    const response = await call(request("/api/login", "GET"));
    expect(response.status).toBe(404);
  });
});

describe("authentication gate", () => {
  const protectedRoutes = [
    ["GET", "/api/admin/users"],
    ["GET", "/api/conventions"],
    ["GET", "/api/knowledge-base"],
    ["GET", "/api/my-folder"],
    ["GET", "/api/clock-status"],
    ["GET", "/api/schedule/store"],
    ["POST", "/api/schedule/copy-week"],
    ["PUT", "/api/schedule/holiday"],
    ["GET", "/api/resources"],
    ["POST", "/api/resources"],
    ["DELETE", "/api/resources/1"],
    ["PUT", "/api/shelf-positions/1/board-art"],
    ["POST", "/api/shelf-positions/1/photos"],
    ["DELETE", "/api/shelf-photos/1"]
  ];

  it.each(protectedRoutes)("refuses %s %s without a session", async (method, path) => {
    const response = await call(request(path, method));
    expect(await response.json()).toEqual({ ok: false, error: "Not logged in" });
  });

  it("refuses a login with a forged, unsigned credential", async () => {
    const forged = [
      btoa(JSON.stringify({ alg: "none", typ: "JWT" })),
      btoa(JSON.stringify({ sub: "1", email: "samantha@pandahobby.ca", email_verified: true })),
      ""
    ].join(".");

    const response = await call(
      new Request("http://example.com/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: forged })
      })
    );

    expect(response.status).toBe(401);
    expect((await response.json()).ok).toBe(false);
  });
});
