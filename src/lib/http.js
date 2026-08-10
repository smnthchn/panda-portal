export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers
    }
  });
}

/**
 * Matches a pathname against a pattern like "/api/admin/users/:id".
 * Returns the params object on a match, or null.
 */
export function matchPath(pathname, pattern) {
  const pathParts = pathname.split("/").filter(Boolean);
  const patternParts = pattern.split("/").filter(Boolean);

  if (pathParts.length !== patternParts.length) return null;

  const params = {};

  for (let i = 0; i < patternParts.length; i++) {
    const expected = patternParts[i];
    const actual = pathParts[i];

    if (expected.startsWith(":")) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }

  return params;
}

export function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie") || "";

  for (const c of cookieHeader.split(";")) {
    const trimmed = c.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }

  return null;
}

export async function readJsonBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

/** Trims a string field, returning null for blank/missing values. */
export function optionalText(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

export function requiredText(value, fieldName) {
  const text = optionalText(value);
  if (!text) throw new BadRequest(`${fieldName} is required.`);
  return text;
}

export class BadRequest extends Error {}
