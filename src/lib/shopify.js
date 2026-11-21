/**
 * The "Panda Portal" Shopify app, client-credentials grant. The token lasts a
 * day; it's kept in module scope so a warm isolate doesn't ask for a new one
 * on every request.
 *
 * There is no test store: local dev talks to the live store, so everything
 * here is a read.
 */

const API_VERSION = "2026-10";

let tokenCache = { token: null, expiresAt: 0 };

function shopDomain(env) {
  return String(env.SHOPIFY_SHOP || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

export function shopifyConfigured(env) {
  return Boolean(env.SHOPIFY_SHOP && env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET);
}

async function accessToken(env) {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;

  const res = await fetch(`https://${shopDomain(env)}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.SHOPIFY_CLIENT_ID,
      client_secret: env.SHOPIFY_CLIENT_SECRET,
      grant_type: "client_credentials"
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Shopify would not give the portal a token (${res.status}).`);
  }

  // Renew five minutes early rather than find out mid-request.
  const lifetimeMs = (Number(data.expires_in) || 3600) * 1000;
  tokenCache = { token: data.access_token, expiresAt: Date.now() + lifetimeMs - 5 * 60 * 1000 };
  return tokenCache.token;
}

/** Runs one Admin GraphQL query and returns its `data`. Throws on any error. */
export async function shopifyGraphql(env, query, variables = {}) {
  if (!shopifyConfigured(env)) {
    throw new Error("Shopify isn't set up on this server.");
  }

  const token = await accessToken(env);
  const res = await fetch(`https://${shopDomain(env)}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables })
  });

  // A token Shopify no longer accepts: forget it so the next call asks again.
  if (res.status === 401) tokenCache = { token: null, expiresAt: 0 };

  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors) {
    const detail = body.errors ? JSON.stringify(body.errors).slice(0, 300) : `status ${res.status}`;
    throw new Error(`Shopify query failed: ${detail}`);
  }

  return body.data;
}
