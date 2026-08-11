import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src";
import { matchPath, getCookie, optionalText, requiredText, BadRequest } from "../src/lib/http.js";
import { roleOutranks, isValidRole } from "../src/lib/permissions.js";
import { optionalUrl, sanitizeSuggestion } from "../src/routes/conventions.js";

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

describe("AI lookup sanitizing", () => {
  // The model's output is untrusted: it reaches hrefs and the day form.
  const dirty = {
    found: true,
    confidence: "extremely sure",
    notes: "x".repeat(5000),
    event: {
      name: "Fan Expo 2026",
      venue: "MTCC",
      address: "255 Front St W",
      website: "javascript:alert(document.cookie)",
      starts_on: "August 27th",
      ends_on: "2026-08-30"
    },
    days: [
      { day_date: "2026-08-28", regular_start: "10:00", regular_end: "18:00", setup_start: "", setup_end: "", early_start: "", early_end: "", notes: "" },
      { day_date: "2026-08-27", regular_start: "10:00", regular_end: "18:00", setup_start: "25:99", setup_end: "09:00", early_start: "", early_end: "", notes: "" },
      { day_date: "2026-08-29", regular_start: "10:00", regular_end: "16:00", setup_start: "", setup_end: "", early_start: "18:00", early_end: "10:00", notes: "" },
      { day_date: "2026-08-30", regular_start: "18:00", regular_end: "10:00", setup_start: "", setup_end: "", early_start: "", early_end: "", notes: "" },
      { day_date: "not a date", regular_start: "10:00", regular_end: "18:00", setup_start: "", setup_end: "", early_start: "", early_end: "", notes: "" },
      { day_date: "2026-08-31", regular_start: "", regular_end: "", setup_start: "", setup_end: "", early_start: "", early_end: "", notes: "" }
    ],
    sources: [
      { title: "Official", url: "https://fanexpohq.com/hours" },
      { title: "Evil", url: "javascript:alert(1)" }
    ]
  };

  const clean = sanitizeSuggestion(dirty);

  it("strips a javascript: url from the website", () => {
    expect(clean.event.website).toBe("");
  });

  it("drops sources whose url is not http(s)", () => {
    expect(clean.sources).toEqual([{ title: "Official", url: "https://fanexpohq.com/hours" }]);
  });

  it("drops an unparseable date but keeps a valid one", () => {
    expect(clean.event.starts_on).toBe("");
    expect(clean.event.ends_on).toBe("2026-08-30");
  });

  // 08-30's only window was backwards, so after cleaning it has nothing to say
  // and is dropped along with the undated and hourless entries.
  it("drops days with no date, no hours, or only invalid hours", () => {
    expect(clean.days.map(d => d.day_date)).toEqual(["2026-08-27", "2026-08-28", "2026-08-29"]);
  });

  it("sorts days by date", () => {
    const dates = clean.days.map(d => d.day_date);
    expect([...dates].sort()).toEqual(dates);
  });

  it("drops a window with an out-of-range time", () => {
    const day = clean.days.find(d => d.day_date === "2026-08-27");
    expect(day.setup_start).toBe("");
    expect(day.setup_end).toBe("");
  });

  it("drops a backwards window but keeps the day's valid ones", () => {
    const day = clean.days.find(d => d.day_date === "2026-08-29");
    expect(day.early_start).toBe("");
    expect(day.early_end).toBe("");
    expect(day.regular_start).toBe("10:00");
    expect(day.regular_end).toBe("16:00");
  });

  it("falls back to low for an unrecognised confidence", () => {
    expect(clean.confidence).toBe("low");
  });

  it("caps runaway text", () => {
    expect(clean.notes.length).toBeLessThanOrEqual(600);
  });

  it("treats a junk payload as not found rather than throwing", () => {
    const empty = sanitizeSuggestion(null);
    expect(empty.found).toBe(false);
    expect(empty.days).toEqual([]);
    expect(empty.sources).toEqual([]);
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
