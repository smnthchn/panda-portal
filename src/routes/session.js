import { json, readJsonBody } from "../lib/http.js";
import {
  verifyGoogleIdToken,
  createSession,
  sessionCookie,
  clearedSessionCookie,
  getSessionId,
  deleteSession,
  getCurrentUser
} from "../lib/auth.js";
import { loadEffectivePermissions } from "../lib/permissions.js";

export async function handleMe(request, env) {
  const user = await getCurrentUser(request, env);

  if (!user) {
    return json({ ok: false, googleClientId: env.GOOGLE_CLIENT_ID });
  }

  return json({
    ok: true,
    user: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      theme_id: user.theme_id || "habbo",
      theme_colors: parseThemeColors(user.theme_colors),
      permissions: user.permissions
    }
  });
}

export const THEME_IDS = ["habbo", "mario", "bubble", "sherbet", "arcade", "custom"];

/** The three colours a custom profile is built from. */
export const THEME_COLOR_KEYS = ["brand", "warm", "paper"];
const HEX = /^#[0-9a-f]{6}$/i;

/** The stored JSON as {brand, warm, paper}, or null if absent or malformed. */
export function parseThemeColors(raw) {
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const colors = {};
    for (const key of THEME_COLOR_KEYS) {
      if (!HEX.test(parsed?.[key] || "")) return null;
      colors[key] = parsed[key].toLowerCase();
    }
    return colors;
  } catch {
    return null;
  }
}

/** Appearance: everyone picks their own, stored on the user not the device. */
export async function handleSetTheme(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return { ok: false, error: "Not logged in" };

  const body = await readJsonBody(request);

  if (!THEME_IDS.includes(body.theme_id)) {
    return { ok: false, error: "That isn't one of the themes." };
  }

  // The custom profile's colours ride along when it's being edited; picking
  // it with none saved yet is refused so the screen can't go blank.
  let colors = null;
  if (body.theme_colors !== undefined) {
    colors = parseThemeColors(body.theme_colors);
    if (!colors) return { ok: false, error: "Colours need to be six-digit hex, like #17879b." };
  }

  if (body.theme_id === "custom" && !colors && !parseThemeColors(user.theme_colors)) {
    return { ok: false, error: "Pick your three colours first." };
  }

  if (colors) {
    await env.DB.prepare(
      `UPDATE employees SET theme_id = ?, theme_colors = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(body.theme_id, JSON.stringify(colors), user.id).run();
  } else {
    await env.DB.prepare(
      `UPDATE employees SET theme_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(body.theme_id, user.id).run();
  }

  return { ok: true, theme_id: body.theme_id, theme_colors: colors || parseThemeColors(user.theme_colors) };
}

export async function handleLogin(request, env) {
  const body = await readJsonBody(request);

  if (!body.credential) {
    return json({ ok: false, error: "Missing credential" }, 400);
  }

  let googleUser;
  try {
    googleUser = await verifyGoogleIdToken(body.credential, env.GOOGLE_CLIENT_ID);
  } catch (err) {
    return json({ ok: false, error: err.message }, 401);
  }

  const email = String(googleUser.email).toLowerCase();

  const employee = await env.DB.prepare(
    `SELECT id, role FROM employees
     WHERE lower(email) = ? AND is_active = 1`
  ).bind(email).first();

  if (!employee) {
    return json({ ok: false, error: "This account is not approved." }, 403);
  }

  const { permissions } = await loadEffectivePermissions(env.DB, employee.id, employee.role);

  if (!permissions.portal_access) {
    return json({ ok: false, error: "This account is not approved." }, 403);
  }

  // Bind the Google account to the employee record on first successful sign-in.
  // If a different Google account already claimed this sub, that's a conflict
  // worth failing loudly on rather than silently reassigning.
  const subOwner = await env.DB.prepare(
    `SELECT id FROM employees WHERE google_sub = ?`
  ).bind(googleUser.sub).first();

  if (subOwner && subOwner.id !== employee.id) {
    return json({ ok: false, error: "This Google account is already linked to another user." }, 403);
  }

  await env.DB.prepare(
    `UPDATE employees
     SET google_sub = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(googleUser.sub, employee.id).run();

  const sessionId = await createSession(env.DB, employee.id);

  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(sessionId) });
}

export async function handleLogout(request, env) {
  const sessionId = getSessionId(request);

  if (sessionId) {
    await deleteSession(env.DB, sessionId);
  }

  return json({ ok: true }, 200, { "Set-Cookie": clearedSessionCookie() });
}
