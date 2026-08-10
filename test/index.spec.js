import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src";
import { matchPath, getCookie, optionalText, requiredText, BadRequest } from "../src/lib/http.js";
import { roleOutranks, isValidRole } from "../src/lib/permissions.js";

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
