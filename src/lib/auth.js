import { getCookie } from "./http.js";
import { loadEffectivePermissions } from "./permissions.js";

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const SESSION_COOKIE = "session_id";
const SESSION_DAYS = 7;

// Module scope, so it survives between requests on a warm isolate.
let jwksCache = { keys: null, expiresAt: 0 };

async function fetchGoogleJwks() {
  const res = await fetch(GOOGLE_JWKS_URL);

  if (!res.ok) {
    throw new Error("Could not reach Google's token signing keys.");
  }

  const data = await res.json();
  const maxAge = /max-age=(\d+)/.exec(res.headers.get("cache-control") || "");
  const ttlMs = maxAge ? Number(maxAge[1]) * 1000 : 60 * 60 * 1000;

  jwksCache = { keys: data.keys || [], expiresAt: Date.now() + ttlMs };
  return jwksCache.keys;
}

async function getGoogleJwks({ force = false } = {}) {
  if (!force && jwksCache.keys && Date.now() < jwksCache.expiresAt) {
    return jwksCache.keys;
  }
  return fetchGoogleJwks();
}

function base64UrlToBytes(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function decodeJwtSegment(segment) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
}

/**
 * Verifies a Google Sign-In credential properly: RS256 signature against
 * Google's published keys, then issuer, audience and expiry.
 *
 * Throws on anything suspect. Returns the token payload on success.
 */
export async function verifyGoogleIdToken(token, clientId) {
  if (!clientId) {
    throw new Error("GOOGLE_CLIENT_ID is not configured on the worker.");
  }

  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed Google token.");
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  let header;
  try {
    header = decodeJwtSegment(headerB64);
  } catch {
    throw new Error("Malformed Google token.");
  }

  if (header.alg !== "RS256") {
    throw new Error("Unexpected token signing algorithm.");
  }

  let keys = await getGoogleJwks();
  let jwk = keys.find(k => k.kid === header.kid);

  // Google rotates keys; a miss usually means our cache is stale.
  if (!jwk) {
    keys = await getGoogleJwks({ force: true });
    jwk = keys.find(k => k.kid === header.kid);
  }

  if (!jwk) {
    throw new Error("Google token was signed with an unrecognised key.");
  }

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const signatureValid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(signatureB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  );

  if (!signatureValid) {
    throw new Error("Google token signature is invalid.");
  }

  const payload = decodeJwtSegment(payloadB64);
  const now = Math.floor(Date.now() / 1000);
  const SKEW = 60;

  if (!GOOGLE_ISSUERS.includes(payload.iss)) {
    throw new Error("Google token has an unexpected issuer.");
  }

  if (payload.aud !== clientId) {
    throw new Error("Google token was issued for a different app.");
  }

  if (typeof payload.exp !== "number" || payload.exp + SKEW <= now) {
    throw new Error("Google token has expired.");
  }

  if (typeof payload.iat === "number" && payload.iat - SKEW > now) {
    throw new Error("Google token is not valid yet.");
  }

  if (!payload.sub || !payload.email) {
    throw new Error("Google token is missing account details.");
  }

  if (payload.email_verified === false) {
    throw new Error("This Google account has no verified email address.");
  }

  return payload;
}

export async function createSession(db, employeeId) {
  const sessionId = crypto.randomUUID();

  // datetime() keeps expires_at in the same format the expiry check compares
  // against. Storing an ISO string here would break that comparison.
  await db.prepare(
    `INSERT INTO sessions (id, employee_id, expires_at)
     VALUES (?, ?, datetime('now', ?))`
  ).bind(sessionId, employeeId, `+${SESSION_DAYS} days`).run();

  return sessionId;
}

export function sessionCookie(sessionId) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function getSessionId(request) {
  return getCookie(request, SESSION_COOKIE);
}

export async function deleteSession(db, sessionId) {
  await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run();
}

/**
 * Resolves the signed-in user, or null. Enforces session expiry, active status
 * and the portal_access permission.
 */
export async function getCurrentUser(request, env) {
  const sessionId = getSessionId(request);
  if (!sessionId) return null;

  const row = await env.DB.prepare(
    `SELECT e.id, e.full_name, e.email, e.role, e.google_drive_folder_id
     FROM sessions s
     JOIN employees e ON e.id = s.employee_id
     WHERE s.id = ? AND s.expires_at > datetime('now') AND e.is_active = 1`
  ).bind(sessionId).first();

  if (!row) return null;

  const { permissions } = await loadEffectivePermissions(env.DB, row.id, row.role);
  if (!permissions.portal_access) return null;

  return { ...row, permissions };
}

/**
 * For handlers that return a plain object. Returns {ok:false} in the same shape
 * the front end already expects.
 */
export async function requireUser(request, env, permission = null) {
  const user = await getCurrentUser(request, env);

  if (!user) {
    return { ok: false, error: "Not logged in" };
  }

  if (permission && !user.permissions[permission]) {
    return { ok: false, error: "You do not have access to this." };
  }

  return { ok: true, user };
}
