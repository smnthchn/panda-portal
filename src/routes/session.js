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
      permissions: user.permissions
    }
  });
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
