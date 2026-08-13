import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src";
import { matchPath, getCookie, optionalText, requiredText, BadRequest } from "../src/lib/http.js";
import { roleOutranks, isValidRole } from "../src/lib/permissions.js";
import { optionalUrl } from "../src/routes/conventions.js";
import { pairClockEvents } from "../src/routes/clock.js";
import { segmentsFor, buildRoster, liveStatusFromEvents } from "../src/routes/dashboard.js";
import { parseAvatarDataUri, avatarUrlFor } from "../src/routes/staff.js";
import { mergeIntervals, coverageGaps, toMinutes } from "../src/routes/schedule.js";

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
    ["GET", "/api/clock-status"]
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
