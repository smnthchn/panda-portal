import { readJsonBody } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";

/**
 * Bring items — the SKU-level picking list, ticked off as stock is pulled.
 *
 * Anyone who can see the plan can tick: picking is the floor's job, the same
 * reasoning as shelf photos. A tick records who and when, and unticking is
 * allowed because mistakes get made with both hands full of boxes.
 */

export async function handleBringItems(request, env, slug) {
  const auth = await requireUser(request, env, "conventions");
  if (!auth.ok) return auth;

  const convention = await env.DB.prepare(
    `SELECT id FROM conventions WHERE slug = ?`
  ).bind(slug).first();

  if (!convention) return { ok: false, error: "Convention not found." };

  const grouping = Number(new URL(request.url).searchParams.get("grouping")) || null;

  const rows = await env.DB.prepare(
    `SELECT b.id, b.label, b.sku, b.title, b.qty, b.picked_at,
            e.full_name AS picked_by_name
     FROM bring_items b
     LEFT JOIN employees e ON e.id = b.picked_by
     WHERE b.convention_id = ?
       AND ${grouping ? "b.grouping_id = ?" : "b.grouping_id IS NULL"}
     ORDER BY b.label COLLATE NOCASE ASC, b.title COLLATE NOCASE ASC`
  ).bind(...(grouping ? [convention.id, grouping] : [convention.id])).all();

  return { ok: true, items: rows.results || [] };
}

export async function handlePickItem(request, env, itemId) {
  const auth = await requireUser(request, env, "conventions");
  if (!auth.ok) return auth;

  const id = Number(itemId);
  const body = await readJsonBody(request);

  const item = await env.DB.prepare(
    `SELECT id FROM bring_items WHERE id = ?`
  ).bind(id).first();

  if (!item) return { ok: false, error: "That item is no longer on the bring list." };

  if (body.picked === false) {
    await env.DB.prepare(
      `UPDATE bring_items SET picked_by = NULL, picked_at = NULL WHERE id = ?`
    ).bind(id).run();
  } else {
    await env.DB.prepare(
      `UPDATE bring_items SET picked_by = ?, picked_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(auth.user.id, id).run();
  }

  return { ok: true };
}

/** Per-family picked/total, cheap enough to ride the plan payload. */
export async function bringProgress(db, conventionId) {
  const rows = await db.prepare(
    `SELECT grouping_id, COUNT(*) AS total,
            SUM(CASE WHEN picked_at IS NULL THEN 0 ELSE 1 END) AS picked
     FROM bring_items WHERE convention_id = ? GROUP BY grouping_id`
  ).bind(conventionId).all();

  const progress = {};
  for (const row of rows.results || []) {
    progress[row.grouping_id ?? "other"] = { picked: row.picked, total: row.total };
  }
  return progress;
}
