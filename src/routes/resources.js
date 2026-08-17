import { readJsonBody, requiredText, BadRequest } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { parseImageDataUri, imageResponse, imageUrlFor } from "../lib/images.js";

/**
 * Resources — the store's own library of images, reached from Events.
 *
 * Board artwork mostly: a board is a physical printed sign the store owns and
 * hangs again at the next show, so the picture of it belongs to the store
 * rather than to one event. Upload it once here and assign it to a shelf on
 * any event's booth plan.
 */

// The browser fits the longest edge to 1400px before uploading. D1 caps a row
// at 2MB and base64 inflates by a third, so this leaves plenty of headroom.
export const MAX_RESOURCE_BYTES = 800 * 1024;

export function resourceUrl(row) {
  return imageUrlFor(`/api/resource-image/${row.id}`, row.updated_at);
}

/**
 * The library. Deliberately never selects the image column — pictures come
 * from their own url, so a list of forty boards isn't forty pictures of JSON.
 */
export async function loadResources(db) {
  const rows = await db.prepare(
    `SELECT r.id, r.name, r.updated_at, e.full_name AS uploaded_by_name,
            (SELECT COUNT(*) FROM shelf_board_art a WHERE a.resource_id = r.id) AS assigned_count
     FROM resources r
     LEFT JOIN employees e ON e.id = r.uploaded_by
     ORDER BY r.name COLLATE NOCASE ASC`
  ).all();

  return (rows.results || []).map(row => ({
    id: row.id,
    name: row.name,
    updated_at: row.updated_at,
    uploaded_by_name: row.uploaded_by_name,
    assigned_count: row.assigned_count,
    image_url: resourceUrl(row)
  }));
}

export async function handleResources(request, env) {
  const auth = await requireUser(request, env, "conventions");
  if (!auth.ok) return auth;

  return {
    ok: true,
    canManage: Boolean(auth.user.permissions.manage_conventions),
    resources: await loadResources(env.DB)
  };
}

/** Anyone signed in can see the artwork; nobody else can. */
export async function handleGetResourceImage(request, env, resourceId) {
  const auth = await requireUser(request, env);
  if (!auth.ok) return new Response("Not found", { status: 404 });

  const row = await env.DB.prepare(
    `SELECT image FROM resources WHERE id = ?`
  ).bind(Number(resourceId)).first();

  if (!row?.image) return new Response("Not found", { status: 404 });

  return imageResponse(row.image, MAX_RESOURCE_BYTES);
}

export async function handleCreateResource(request, env) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);
  const name = requiredText(body.name, "Name");
  const { mimeType, base64 } = parseImageDataUri(body.image, MAX_RESOURCE_BYTES);

  // Store a string rebuilt from the validated parts rather than the raw input.
  const result = await env.DB.prepare(
    `INSERT INTO resources (name, image, uploaded_by) VALUES (?, ?, ?)`
  ).bind(name, `data:${mimeType};base64,${base64}`, auth.user.id).run();

  return { ok: true, id: result.meta?.last_row_id };
}

/** Rename, or replace the picture without disturbing what it's assigned to. */
export async function handleUpdateResource(request, env, resourceId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const id = Number(resourceId);
  const body = await readJsonBody(request);

  const existing = await env.DB.prepare(
    `SELECT id FROM resources WHERE id = ?`
  ).bind(id).first();

  if (!existing) return { ok: false, error: "That file is no longer in the library." };

  const updates = [];
  const values = [];

  if (body.name !== undefined) {
    updates.push("name = ?");
    values.push(requiredText(body.name, "Name"));
  }

  if (body.image !== undefined) {
    const { mimeType, base64 } = parseImageDataUri(body.image, MAX_RESOURCE_BYTES);
    updates.push("image = ?");
    values.push(`data:${mimeType};base64,${base64}`);
  }

  if (!updates.length) return { ok: true };

  await env.DB.prepare(
    `UPDATE resources SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(...values, id).run();

  return { ok: true };
}

/**
 * Deleting takes it off every shelf it was on, across every event. Said out
 * loud in the confirmation rather than discovered at the booth.
 */
export async function handleDeleteResource(request, env, resourceId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const id = Number(resourceId);

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM shelf_board_art WHERE resource_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM resources WHERE id = ?`).bind(id)
  ]);

  return { ok: true };
}
