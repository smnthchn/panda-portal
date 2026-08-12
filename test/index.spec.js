import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src";
import { matchPath, getCookie, optionalText, requiredText, BadRequest } from "../src/lib/http.js";
import { roleOutranks, isValidRole } from "../src/lib/permissions.js";
import { optionalUrl } from "../src/routes/conventions.js";
import { pairClockEvents } from "../src/routes/clock.js";

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

describe("api routing", () => {
  it("returns 404 JSON for an unknown api path", async () => {
    const response = await call(request("/api/nope"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "Not found" });
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
