import { readJsonBody, requiredText, optionalText, BadRequest } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";

/**
 * Groupings — the product families that go on a shelf.
 *
 * One rack is HG Universal Century, one is Gundam SEED, one is Girls. The
 * family belongs to the store and outlives any show; what changes per show is
 * which shelf carries it and how deep each SKU is faced there.
 */

/** Two spellings of one family shouldn't become two rows. */
export function groupingKey(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** How many of one box stand across a 49.5" tier, by how wide the box is. */
export const BOX_CLASSES = {
  small: { label: "Small", perTier: 6 },
  medium: { label: "Medium", perTier: 4 },
  large: { label: "Large", perTier: 3 },
  oversize: { label: "Oversize", perTier: 2 }
};

export async function loadGroupings(db) {
  const rows = await db.prepare(
    `SELECT g.*,
            (SELECT COUNT(*) FROM shelf_groupings sg WHERE sg.grouping_id = g.id) AS shelf_count
     FROM groupings g
     ORDER BY g.sort_order ASC, g.name ASC`
  ).all();

  return (rows.results || []).map(row => ({
    id: row.id,
    name: row.name,
    shopify_query: row.shopify_query,
    box_class: row.box_class,
    notes: row.notes,
    shelf_count: row.shelf_count
  }));
}

export async function handleGroupings(request, env) {
  const auth = await requireUser(request, env, "conventions");
  if (!auth.ok) return auth;

  return {
    ok: true,
    canManage: Boolean(auth.user.permissions.manage_conventions),
    boxClasses: BOX_CLASSES,
    groupings: await loadGroupings(env.DB)
  };
}

export async function handleCreateGrouping(request, env) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);
  const name = requiredText(body.name, "Name");
  const key = groupingKey(name);

  const clash = await env.DB.prepare(
    `SELECT id FROM groupings WHERE name_key = ?`
  ).bind(key).first();

  if (clash) return { ok: false, error: `There's already a grouping called ${name}.` };

  const last = await env.DB.prepare(`SELECT MAX(sort_order) AS n FROM groupings`).first();

  await env.DB.prepare(
    `INSERT INTO groupings (name, name_key, shopify_query, box_class, notes, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    name,
    key,
    optionalText(body.shopify_query),
    BOX_CLASSES[body.box_class] ? body.box_class : "medium",
    optionalText(body.notes),
    (last?.n ?? -1) + 1
  ).run();

  return { ok: true };
}

export async function handleUpdateGrouping(request, env, groupingId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const id = Number(groupingId);
  const body = await readJsonBody(request);

  const existing = await env.DB.prepare(
    `SELECT id FROM groupings WHERE id = ?`
  ).bind(id).first();

  if (!existing) return { ok: false, error: "That grouping no longer exists." };

  const updates = [];
  const values = [];

  if (body.name !== undefined) {
    const name = requiredText(body.name, "Name");
    updates.push("name = ?", "name_key = ?");
    values.push(name, groupingKey(name));
  }

  if (body.shopify_query !== undefined) {
    updates.push("shopify_query = ?");
    values.push(optionalText(body.shopify_query));
  }

  if (body.box_class !== undefined) {
    if (!BOX_CLASSES[body.box_class]) throw new BadRequest("Unknown box size.");
    updates.push("box_class = ?");
    values.push(body.box_class);
  }

  if (body.notes !== undefined) {
    updates.push("notes = ?");
    values.push(optionalText(body.notes));
  }

  if (!updates.length) return { ok: true };

  await env.DB.prepare(
    `UPDATE groupings SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(...values, id).run();

  return { ok: true };
}

/** Deleting takes it off every shelf at every show, so say how many first. */
export async function handleDeleteGrouping(request, env, groupingId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const id = Number(groupingId);

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM shelf_groupings WHERE grouping_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM groupings WHERE id = ?`).bind(id)
  ]);

  return { ok: true };
}

/**
 * Puts a family on a shelf, or takes it off. `facings` is the per-SKU depth
 * at this show — the dial that drops from 3 or 4 at Anime North to 1 or 2 at
 * Fan Expo.
 */
export async function handleAssignGrouping(request, env, positionId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const id = Number(positionId);
  const body = await readJsonBody(request);

  const position = await env.DB.prepare(
    `SELECT id FROM shelf_positions WHERE id = ?`
  ).bind(id).first();

  if (!position) return { ok: false, error: "That position no longer exists." };

  if (body.grouping_id === null) {
    await env.DB.prepare(
      `DELETE FROM shelf_groupings WHERE position_id = ?`
    ).bind(id).run();

    return { ok: true };
  }

  const groupingId = Number(body.grouping_id);

  const grouping = await env.DB.prepare(
    `SELECT id FROM groupings WHERE id = ?`
  ).bind(groupingId).first();

  if (!grouping) return { ok: false, error: "That grouping no longer exists." };

  if (body.remove === true) {
    await env.DB.prepare(
      `DELETE FROM shelf_groupings WHERE position_id = ? AND grouping_id = ?`
    ).bind(id, groupingId).run();

    return { ok: true };
  }

  const facings = Number.isFinite(Number(body.facings))
    ? Math.max(1, Math.min(12, Math.round(Number(body.facings))))
    : 2;

  await env.DB.prepare(
    `INSERT INTO shelf_groupings (position_id, grouping_id, facings)
     VALUES (?, ?, ?)
     ON CONFLICT (position_id, grouping_id) DO UPDATE SET facings = excluded.facings`
  ).bind(id, groupingId, facings).run();

  return { ok: true };
}
