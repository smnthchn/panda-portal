import { readJsonBody, optionalText, BadRequest } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { parseImageDataUri, imageResponse, imageUrlFor } from "../lib/images.js";
import { resourceUrl, loadResources } from "./resources.js";
import { loadGroupings, BOX_CLASSES } from "./groupings.js";
import { positionCapacity, DEFAULT_USABLE_HEIGHT_IN } from "../lib/capacity.js";
import {
  templatePositions,
  BOOTH_FEET,
  STAGES,
  SIGNAGE,
  SIGNAGE_KEYS,
  UNIT_TYPES,
  WALLS
} from "../lib/booth-template.js";

/**
 * The booth shelf plan. Positions carry what stands where and what's on it;
 * stage flags carry how far through prep each one is.
 */

/**
 * Arrange overrides sit on top of the baseline rather than replacing it.
 *
 * Accepts either a raw database row or an already-mapped position carrying a
 * `geometry` object — the conflict check runs against both, and reading the
 * wrong shape would silently find no conflicts at all.
 */
export function effectiveGeometry(position) {
  if (position.geometry) return position.geometry;

  return {
    x: position.move_x ?? position.x,
    y: position.move_y ?? position.y,
    w: position.move_w ?? position.w,
    h: position.move_h ?? position.h
  };
}

const inches = (feet) => Math.round(feet * 12);

/**
 * Everything wrong with the current arrangement: a unit hanging off the
 * footprint, or two units occupying the same floor. Reported in inches
 * because that's how you'd fix it with a tape measure.
 *
 * An invalid plan must not be able to look valid, so this runs on every read.
 */
export function layoutConflicts(positions, booth = BOOTH_FEET) {
  const blocks = positions.map(p => ({ code: p.code, ...effectiveGeometry(p) }));
  const conflicts = [];

  for (const block of blocks) {
    const overRight = block.x + block.w - booth.width;
    const overBottom = block.y + block.h - booth.depth;

    if (block.x < 0 || block.y < 0) {
      conflicts.push({ codes: [block.code], message: `${block.code} sits outside the booth` });
    } else if (overRight > 0.001 || overBottom > 0.001) {
      const by = inches(Math.max(overRight, overBottom));
      conflicts.push({ codes: [block.code], message: `${block.code} runs ${by}″ off the booth` });
    }
  }

  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];

      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);

      // A shared edge isn't an overlap; units stand right against each other.
      if (overlapX > 0.001 && overlapY > 0.001) {
        const by = inches(Math.min(overlapX, overlapY));
        conflicts.push({
          codes: [a.code, b.code],
          message: `${a.code} and ${b.code} overlap by ${by}″`
        });
      }
    }
  }

  return conflicts;
}

/** Signage list -> the stage 'BOARDS' only applies where something is needed. */
export function signageList(value) {
  return String(value || "")
    .split(",")
    .map(code => code.trim())
    .filter(code => SIGNAGE_KEYS.includes(code));
}

/** The faces a unit's boards stand on, in the order the names are written. */
export const BOARD_FACES = ["back", "side", "front"];

/**
 * A unit's boards, one per face, in face order.
 *
 * **A board is whatever has been assigned to the face, and it's called
 * whatever the library calls it.** There is no separate name to keep in step:
 * rename it once in Resources and it's renamed on every shelf at every show,
 * and a board can't be named one thing on the plan and another on the picture
 * of it.
 *
 * `assigned` is a face -> resource map for this position.
 */
export function boardFaces(assigned = null) {
  if (!assigned) return [];

  return BOARD_FACES
    .filter(face => assigned.has(face))
    .map(face => {
      const art = assigned.get(face);
      return { face, name: art.name, resource_id: art.id, image_url: art.image_url };
    });
}

/**
 * Per-stage counts. A position needing no signage is not counted in the
 * BOARDS stage at all — neither in the numerator nor the denominator, so it
 * reads 7 / 20 rather than 7 / 31.
 */
export function stageTotals(positions) {
  return STAGES.map((label, stage) => {
    const applicable = positions.filter(p => stageApplies(p, stage));
    return {
      stage,
      label,
      done: applicable.filter(p => p.stages[stage]).length,
      total: applicable.length
    };
  });
}

export function stageApplies(position, stage) {
  if (stage === 4) return signageList(position.signage).length > 0;
  return true;
}

async function loadPlan(db, conventionId) {
  const [positionRows, flagRows, artRows, photoRows, groupingRows, tierRows, heightRows] =
    await Promise.all([
    db.prepare(
      `SELECT * FROM shelf_positions WHERE convention_id = ?
       ORDER BY sort_order ASC, id ASC`
    ).bind(conventionId).all(),

    db.prepare(
      `SELECT f.position_id, f.stage, f.done_at, e.full_name AS done_by_name
       FROM shelf_stage_flags f
       LEFT JOIN employees e ON e.id = f.done_by
       JOIN shelf_positions p ON p.id = f.position_id
       WHERE p.convention_id = ?`
    ).bind(conventionId).all(),

    db.prepare(
      `SELECT a.position_id, a.face, r.id, r.name, r.updated_at
       FROM shelf_board_art a
       JOIN resources r ON r.id = a.resource_id
       JOIN shelf_positions p ON p.id = a.position_id
       WHERE p.convention_id = ?`
    ).bind(conventionId).all(),

    db.prepare(
      `SELECT ph.id, ph.position_id, ph.created_at, e.full_name AS taken_by_name
       FROM shelf_photos ph
       LEFT JOIN employees e ON e.id = ph.taken_by
       JOIN shelf_positions p ON p.id = ph.position_id
       WHERE p.convention_id = ?
       ORDER BY ph.created_at ASC, ph.id ASC`
    ).bind(conventionId).all(),

    db.prepare(
      `SELECT sg.position_id, sg.facings, g.id, g.name, g.box_class,
              g.box_height_in, g.placement, g.sku_count
       FROM shelf_groupings sg
       JOIN groupings g ON g.id = sg.grouping_id
       JOIN shelf_positions p ON p.id = sg.position_id
       WHERE p.convention_id = ?
       ORDER BY sg.sort_order ASC, g.sort_order ASC`
    ).bind(conventionId).all(),

    db.prepare(
      `SELECT t.position_id, t.grouping_id, t.tier_index
       FROM shelf_grouping_tiers t
       JOIN shelf_positions p ON p.id = t.position_id
       WHERE p.convention_id = ?
       ORDER BY t.tier_index ASC`
    ).bind(conventionId).all(),

    db.prepare(
      `SELECT t.position_id, t.tier_index, t.height_in
       FROM shelf_tiers t
       JOIN shelf_positions p ON p.id = t.position_id
       WHERE p.convention_id = ?
       ORDER BY t.tier_index ASC`
    ).bind(conventionId).all()
  ]);

  const flagsByPosition = new Map();
  for (const flag of flagRows.results || []) {
    if (!flagsByPosition.has(flag.position_id)) {
      flagsByPosition.set(flag.position_id, new Set());
    }
    flagsByPosition.get(flag.position_id).add(flag.stage);
  }

  const artByPosition = new Map();
  for (const row of artRows.results || []) {
    if (!artByPosition.has(row.position_id)) artByPosition.set(row.position_id, new Map());
    artByPosition.get(row.position_id).set(row.face, {
      id: row.id,
      name: row.name,
      image_url: resourceUrl(row)
    });
  }

  const groupingsByPosition = new Map();
  for (const row of groupingRows.results || []) {
    if (!groupingsByPosition.has(row.position_id)) groupingsByPosition.set(row.position_id, []);
    groupingsByPosition.get(row.position_id).push({
      id: row.id,
      name: row.name,
      box_class: row.box_class,
      box_height_in: row.box_height_in,
      placement: row.placement || "tier",
      sku_count: row.sku_count,
      facings: row.facings
    });
  }

  const tiersByPosition = new Map();
  for (const row of tierRows.results || []) {
    if (!tiersByPosition.has(row.position_id)) tiersByPosition.set(row.position_id, []);
    tiersByPosition.get(row.position_id).push(row);
  }

  const heightsByPosition = new Map();
  for (const row of heightRows.results || []) {
    if (!heightsByPosition.has(row.position_id)) heightsByPosition.set(row.position_id, []);
    heightsByPosition.get(row.position_id).push(row);
  }

  const photosByPosition = new Map();
  for (const row of photoRows.results || []) {
    if (!photosByPosition.has(row.position_id)) photosByPosition.set(row.position_id, []);
    photosByPosition.get(row.position_id).push({
      id: row.id,
      created_at: row.created_at,
      taken_by_name: row.taken_by_name,
      image_url: imageUrlFor(`/api/shelf-photo/${row.id}`, row.created_at)
    });
  }

  return (positionRows.results || []).map(row => {
    const ticked = flagsByPosition.get(row.id) || new Set();
    const groupings = groupingsByPosition.get(row.id) || [];
    const geometry = effectiveGeometry(row);

    const position = {
      id: row.id,
      code: row.code,
      wall: row.wall,
      wall_note: row.wall_note,
      product: row.product || "",
      unit_type: row.unit_type || "",
      signage: signageList(row.signage),
      boards: boardFaces(artByPosition.get(row.id)),
      photos: photosByPosition.get(row.id) || [],
      groupings,
      tier_count: row.tier_count,
      usable_height_in: row.usable_height_in,
      kind: row.kind,
      geometry,
      baseline: { x: row.x, y: row.y, w: row.w, h: row.h },
      moved: row.move_x !== null,
      stages: STAGES.map((_, stage) => ticked.has(stage))
    };

    // Worked out here rather than in the browser, for the same reason the
    // roster decides its own statuses: the grid, the phone card and the map
    // all draw this, and they can't be allowed to disagree about it.
    position.capacity = positionCapacity(
      { tier_count: row.tier_count, usable_height_in: row.usable_height_in, ...geometry },
      groupings,
      tiersByPosition.get(row.id) || [],
      heightsByPosition.get(row.id) || []
    );

    return position;
  });
}

export async function handleShelfPlan(request, env, slug) {
  const auth = await requireUser(request, env, "conventions");
  if (!auth.ok) return auth;

  const convention = await env.DB.prepare(
    `SELECT id, name, slug, booth_number, is_published FROM conventions WHERE slug = ?`
  ).bind(slug).first();

  if (!convention) return { ok: false, error: "Convention not found." };

  const positions = await loadPlan(env.DB, convention.id);

  // Where a plan could be copied from, newest first.
  const others = await env.DB.prepare(
    `SELECT c.slug, c.name, COUNT(p.id) AS positions
     FROM conventions c
     JOIN shelf_positions p ON p.convention_id = c.id
     WHERE c.id != ?
     GROUP BY c.id
     ORDER BY c.starts_on DESC
     LIMIT 10`
  ).bind(convention.id).all();

  return {
    ok: true,
    convention,
    canManage: Boolean(auth.user.permissions.manage_conventions),
    booth: BOOTH_FEET,
    stages: STAGES,
    signage: SIGNAGE,
    signageKeys: SIGNAGE_KEYS,
    unitTypes: UNIT_TYPES,
    walls: WALLS,
    positions,
    people: await loadBoothPeople(env.DB, convention.id),
    personFeet: PERSON_FEET,
    totals: stageTotals(positions),
    conflicts: layoutConflicts(positions),
    copyFrom: others.results || [],

    // What the artwork and grouping pickers offer. Both libraries are
    // store-wide and small, so they ride along rather than costing a second
    // request per shelf.
    resources: await loadResources(env.DB),
    groupings: await loadGroupings(env.DB),
    boxClasses: BOX_CLASSES
  };
}

/** Starts a plan: the standard booth, or last show's plan carried forward. */
export async function handleStartShelfPlan(request, env, slug) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const convention = await env.DB.prepare(
    `SELECT id FROM conventions WHERE slug = ?`
  ).bind(slug).first();

  if (!convention) return { ok: false, error: "Convention not found." };

  const existing = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM shelf_positions WHERE convention_id = ?`
  ).bind(convention.id).first();

  if ((existing?.n || 0) > 0) {
    return { ok: false, error: "This event already has a shelf plan." };
  }

  const body = await readJsonBody(request);
  const fromSlug = optionalText(body.from_slug);
  let rows = templatePositions();
  let startedFrom = null;

  if (fromSlug) {
    const source = await env.DB.prepare(
      `SELECT id, name FROM conventions WHERE slug = ?`
    ).bind(fromSlug).first();

    if (!source) return { ok: false, error: "Couldn't find that event to copy from." };

    const sourceRows = await env.DB.prepare(
      `SELECT code, wall, wall_note, product, unit_type, signage, board_name, kind,
              sort_order, x, y, w, h, move_x, move_y, move_w, move_h
       FROM shelf_positions WHERE convention_id = ? ORDER BY sort_order ASC`
    ).bind(source.id).all();

    if (!(sourceRows.results || []).length) {
      return { ok: false, error: "That event has no shelf plan to copy." };
    }

    // Last show's arrangement becomes this show's baseline — you start from
    // where you ended up, not from where you'd planned to be.
    rows = (sourceRows.results || []).map(row => ({
      ...row,
      x: row.move_x ?? row.x,
      y: row.move_y ?? row.y,
      w: row.move_w ?? row.w,
      h: row.move_h ?? row.h
    }));

    startedFrom = source.name;
  }

  await env.DB.batch(rows.map(row =>
    env.DB.prepare(
      `INSERT INTO shelf_positions
         (convention_id, code, wall, wall_note, product, unit_type, signage,
          board_name, kind, sort_order, x, y, w, h)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      convention.id,
      row.code,
      row.wall,
      row.wall_note || null,
      row.product || "",
      row.unit_type || "",
      row.signage || "",
      row.board_name || "",
      row.kind || "shelf",
      row.sort_order,
      row.x, row.y, row.w, row.h
    )
  ));

  return { ok: true, started_from: startedFrom, positions: rows.length };
}

/**
 * One stage box. Its own endpoint and its own row so that several people
 * ticking boxes across the booth at the same time can't overwrite each other.
 */
export async function handleToggleStage(request, env, positionId) {
  const auth = await requireUser(request, env, "conventions");
  if (!auth.ok) return auth;

  const id = Number(positionId);
  const body = await readJsonBody(request);
  const stage = Number(body.stage);

  if (!Number.isInteger(stage) || stage < 0 || stage >= STAGES.length) {
    throw new BadRequest("That isn't one of the stages.");
  }

  const position = await env.DB.prepare(
    `SELECT id, signage FROM shelf_positions WHERE id = ?`
  ).bind(id).first();

  if (!position) return { ok: false, error: "That position no longer exists." };

  if (stage === 4 && signageList(position.signage).length === 0) {
    return { ok: false, error: "This shelf needs no signage, so there are no boards to put up." };
  }

  if (body.done === false) {
    await env.DB.prepare(
      `DELETE FROM shelf_stage_flags WHERE position_id = ? AND stage = ?`
    ).bind(id, stage).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO shelf_stage_flags (position_id, stage, done_by, done_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (position_id, stage) DO UPDATE SET
         done_by = excluded.done_by, done_at = CURRENT_TIMESTAMP`
    ).bind(id, stage, auth.user.id).run();
  }

  return { ok: true };
}

/**
 * Puts a shelf at the end of its section and renumbers the plan.
 *
 * The grid groups by *runs* of the same wall rather than by wall, so a shelf
 * whose section changed but whose place in the order didn't would open a
 * second EAST WALL heading at the bottom of the grid instead of joining the
 * one that's already there.
 */
export function sectionOrder(rows, movedId) {
  const moved = rows.find(row => row.id === movedId);
  if (!moved) return rows;

  const rest = rows.filter(row => row.id !== movedId);

  // After the last shelf already in that section; at the end if it's the
  // first one there.
  let at = rest.length;
  for (let i = rest.length - 1; i >= 0; i--) {
    if (rest[i].wall === moved.wall) {
      at = i + 1;
      break;
    }
  }

  rest.splice(at, 0, moved);
  return rest;
}

async function placeInSection(db, conventionId, positionId) {
  const rows = await db.prepare(
    `SELECT id, wall FROM shelf_positions WHERE convention_id = ?
     ORDER BY sort_order ASC, id ASC`
  ).bind(conventionId).all();

  const ordered = sectionOrder(rows.results || [], positionId);

  await db.batch(ordered.map((row, order) =>
    db.prepare(`UPDATE shelf_positions SET sort_order = ? WHERE id = ?`).bind(order, row.id)
  ));
}

export async function handleUpdatePosition(request, env, positionId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const id = Number(positionId);
  const body = await readJsonBody(request);

  const position = await env.DB.prepare(
    `SELECT id, convention_id, wall FROM shelf_positions WHERE id = ?`
  ).bind(id).first();

  if (!position) return { ok: false, error: "That position no longer exists." };

  const updates = [];
  const values = [];
  let movedSection = false;

  if (body.code !== undefined) {
    const code = optionalText(body.code);
    if (!code) throw new BadRequest("Give the position a short name, like E8.");

    const clash = await env.DB.prepare(
      `SELECT id FROM shelf_positions WHERE convention_id = ? AND code = ? AND id != ?`
    ).bind(position.convention_id, code, id).first();

    if (clash) return { ok: false, error: `There's already a ${code} in this booth.` };

    updates.push("code = ?");
    values.push(code);
  }

  if (body.wall !== undefined) {
    if (!WALLS.includes(body.wall)) throw new BadRequest("That isn't one of the booth's sections.");

    if (body.wall !== position.wall) {
      updates.push("wall = ?");
      values.push(body.wall);
      movedSection = true;
    }
  }

  if (body.product !== undefined) {
    updates.push("product = ?");
    values.push(optionalText(body.product) || "");
  }

  // "other" is the cream fill on the map — a unit that isn't a selling shelf,
  // like the cash desk or the A-frame.
  if (body.kind !== undefined) {
    updates.push("kind = ?");
    values.push(body.kind === "other" ? "other" : "shelf");
  }

  if (body.unit_type !== undefined) {
    const type = optionalText(body.unit_type) || "";
    if (type && !UNIT_TYPES.includes(type)) throw new BadRequest("Unknown unit type.");
    updates.push("unit_type = ?");
    values.push(type);
  }

  if (body.signage !== undefined) {
    const codes = (Array.isArray(body.signage) ? body.signage : [])
      .filter(code => SIGNAGE_KEYS.includes(code));

    updates.push("signage = ?");
    values.push(codes.join(","));

    // Dropping every signage need takes the Boards stage out of play, so an
    // old tick would otherwise sit there counting toward nothing.
    if (!codes.length) {
      await env.DB.prepare(
        `DELETE FROM shelf_stage_flags WHERE position_id = ? AND stage = 4`
      ).bind(id).run();
    }
  }

  if (!updates.length) return { ok: true };

  await env.DB.prepare(
    `UPDATE shelf_positions SET ${updates.join(", ")} WHERE id = ?`
  ).bind(...values, id).run();

  if (movedSection) await placeInSection(env.DB, position.convention_id, id);

  return { ok: true };
}

/** Arrange mode: a nudge or a drag, snapped to the inch by the caller. */
export async function handleMovePosition(request, env, positionId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const id = Number(positionId);
  const body = await readJsonBody(request);

  const position = await env.DB.prepare(
    `SELECT * FROM shelf_positions WHERE id = ?`
  ).bind(id).first();

  if (!position) return { ok: false, error: "That position no longer exists." };

  if (body.reset === true) {
    await env.DB.prepare(
      `UPDATE shelf_positions SET move_x = NULL, move_y = NULL, move_w = NULL, move_h = NULL
       WHERE id = ?`
    ).bind(id).run();

    return { ok: true };
  }

  const current = effectiveGeometry(position);
  const next = {
    x: Number.isFinite(Number(body.x)) ? Number(body.x) : current.x,
    y: Number.isFinite(Number(body.y)) ? Number(body.y) : current.y,
    w: Number.isFinite(Number(body.w)) ? Number(body.w) : current.w,
    h: Number.isFinite(Number(body.h)) ? Number(body.h) : current.h
  };

  // Snap to the inch and keep it on the floor. Overlaps are allowed through
  // and reported as conflicts — you often need to park a unit while shuffling.
  const snap = (feet) => Math.round(feet * 12) / 12;
  const w = Math.min(Math.max(snap(next.w), 1 / 12), BOOTH_FEET.width);
  const h = Math.min(Math.max(snap(next.h), 1 / 12), BOOTH_FEET.depth);

  await env.DB.prepare(
    `UPDATE shelf_positions SET move_x = ?, move_y = ?, move_w = ?, move_h = ? WHERE id = ?`
  ).bind(
    Math.min(Math.max(snap(next.x), 0), BOOTH_FEET.width - w),
    Math.min(Math.max(snap(next.y), 0), BOOTH_FEET.depth - h),
    w,
    h,
    id
  ).run();

  return { ok: true };
}

export async function handleResetArrangement(request, env, slug) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const convention = await env.DB.prepare(
    `SELECT id FROM conventions WHERE slug = ?`
  ).bind(slug).first();

  if (!convention) return { ok: false, error: "Convention not found." };

  await env.DB.prepare(
    `UPDATE shelf_positions
     SET move_x = NULL, move_y = NULL, move_w = NULL, move_h = NULL
     WHERE convention_id = ?`
  ).bind(convention.id).run();

  return { ok: true };
}

export async function handleAddPosition(request, env, slug) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const convention = await env.DB.prepare(
    `SELECT id FROM conventions WHERE slug = ?`
  ).bind(slug).first();

  if (!convention) return { ok: false, error: "Convention not found." };

  const body = await readJsonBody(request);
  const code = optionalText(body.code);

  if (!code) throw new BadRequest("Give the position a short name, like E8.");

  const clash = await env.DB.prepare(
    `SELECT id FROM shelf_positions WHERE convention_id = ? AND code = ?`
  ).bind(convention.id, code).first();

  if (clash) return { ok: false, error: `There's already a ${code} in this booth.` };

  const last = await env.DB.prepare(
    `SELECT MAX(sort_order) AS n FROM shelf_positions WHERE convention_id = ?`
  ).bind(convention.id).first();

  const added = await env.DB.prepare(
    `INSERT INTO shelf_positions
       (convention_id, code, wall, product, unit_type, signage, board_name, kind,
        sort_order, x, y, w, h)
     VALUES (?, ?, ?, '', ?, '', '', ?, ?, 0, 0, ?, ?)`
  ).bind(
    convention.id,
    code,
    WALLS.includes(body.wall) ? body.wall : "OVERSTOCK & OTHER",
    UNIT_TYPES.includes(body.unit_type) ? body.unit_type : "4 Tier",
    body.kind === "other" ? "other" : "shelf",
    (last?.n ?? -1) + 1,
    20 / 12,
    50 / 12
  ).run();

  // A new shelf belongs with the rest of its section, not on the end of the
  // grid under a second heading.
  await placeInSection(env.DB, convention.id, added.meta?.last_row_id);

  return { ok: true };
}

/* ---------- Board artwork ---------- */

/** Puts a library image on one face of one shelf, or takes it back off. */
export async function handleAssignBoardArt(request, env, positionId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const id = Number(positionId);
  const body = await readJsonBody(request);
  const face = String(body.face || "");

  if (!BOARD_FACES.includes(face)) {
    throw new BadRequest("A board stands on the back, the side or the front.");
  }

  const position = await env.DB.prepare(
    `SELECT id FROM shelf_positions WHERE id = ?`
  ).bind(id).first();

  if (!position) return { ok: false, error: "That position no longer exists." };

  if (body.resource_id === null) {
    await env.DB.prepare(
      `DELETE FROM shelf_board_art WHERE position_id = ? AND face = ?`
    ).bind(id, face).run();

    return { ok: true };
  }

  const resourceId = Number(body.resource_id);

  const resource = await env.DB.prepare(
    `SELECT id FROM resources WHERE id = ?`
  ).bind(resourceId).first();

  if (!resource) return { ok: false, error: "That file is no longer in the library." };

  await env.DB.prepare(
    `INSERT INTO shelf_board_art (position_id, face, resource_id, assigned_by, assigned_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (position_id, face) DO UPDATE SET
       resource_id = excluded.resource_id,
       assigned_by = excluded.assigned_by,
       assigned_at = CURRENT_TIMESTAMP`
  ).bind(id, face, resourceId, auth.user.id).run();

  return { ok: true };
}

/* ---------- Shelf photos ---------- */

// Shot on a phone at the store, so bigger than a board: you have to be able
// to read a spine off it at the venue. D1 caps a row at 2MB and base64
// inflates by a third, so this still leaves headroom.
const MAX_PHOTO_BYTES = 900 * 1024;

export async function handleGetShelfPhoto(request, env, photoId) {
  const auth = await requireUser(request, env);
  if (!auth.ok) return new Response("Not found", { status: 404 });

  const row = await env.DB.prepare(
    `SELECT image FROM shelf_photos WHERE id = ?`
  ).bind(Number(photoId)).first();

  if (!row?.image) return new Response("Not found", { status: 404 });

  return imageResponse(row.image, MAX_PHOTO_BYTES);
}

/**
 * A photo of the shelf as it was merchandised.
 *
 * Anyone who can see the plan can add one — merchandising and packing is the
 * floor's job, and a photo nobody could take until the boss was free would
 * not get taken. Deleting stays with the boss.
 */
export async function handleAddShelfPhoto(request, env, positionId) {
  const auth = await requireUser(request, env, "conventions");
  if (!auth.ok) return auth;

  const id = Number(positionId);
  const body = await readJsonBody(request);

  const position = await env.DB.prepare(
    `SELECT id FROM shelf_positions WHERE id = ?`
  ).bind(id).first();

  if (!position) return { ok: false, error: "That position no longer exists." };

  const { mimeType, base64 } = parseImageDataUri(body.image, MAX_PHOTO_BYTES);

  await env.DB.prepare(
    `INSERT INTO shelf_photos (position_id, image, taken_by) VALUES (?, ?, ?)`
  ).bind(id, `data:${mimeType};base64,${base64}`, auth.user.id).run();

  return { ok: true };
}

export async function handleDeleteShelfPhoto(request, env, photoId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  await env.DB.prepare(
    `DELETE FROM shelf_photos WHERE id = ?`
  ).bind(Number(photoId)).run();

  return { ok: true };
}

export async function handleDeletePosition(request, env, positionId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const id = Number(positionId);

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM shelf_stage_flags WHERE position_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM shelf_board_art WHERE position_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM shelf_photos WHERE position_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM shelf_grouping_tiers WHERE position_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM shelf_groupings WHERE position_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM shelf_tiers WHERE position_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM shelf_positions WHERE id = ?`).bind(id)
  ]);

  return { ok: true };
}

/* ---------- People on the map ---------- */

/** The circle's diameter in feet — roughly a standing person. */
export const PERSON_FEET = 1.5;

export async function loadBoothPeople(db, conventionId) {
  const rows = await db.prepare(
    `SELECT id, label, x, y FROM booth_people WHERE convention_id = ? ORDER BY id`
  ).bind(conventionId).all();

  return rows.results || [];
}

export async function handleAddBoothPerson(request, env, slug) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const convention = await env.DB.prepare(
    `SELECT id FROM conventions WHERE slug = ?`
  ).bind(slug).first();

  if (!convention) return { ok: false, error: "Convention not found." };

  const body = await readJsonBody(request);
  const label = optionalText(body.label);

  if (!label) throw new BadRequest("Give them a name or a job, like Entrance.");

  const added = await env.DB.prepare(
    `INSERT INTO booth_people (convention_id, label) VALUES (?, ?)`
  ).bind(convention.id, label).run();

  return { ok: true, id: added.meta?.last_row_id };
}

export async function handleUpdateBoothPerson(request, env, personId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const id = Number(personId);
  const body = await readJsonBody(request);

  const person = await env.DB.prepare(
    `SELECT id, label, x, y FROM booth_people WHERE id = ?`
  ).bind(id).first();

  if (!person) return { ok: false, error: "They're no longer on the map." };

  const label = body.label !== undefined ? optionalText(body.label) : person.label;
  if (!label) throw new BadRequest("Give them a name or a job, like Entrance.");

  // Snapped to the inch and kept on the floor, the same way a unit is.
  const snap = (feet) => Math.round(feet * 12) / 12;
  const x = Number.isFinite(Number(body.x))
    ? Math.min(Math.max(snap(Number(body.x)), 0), BOOTH_FEET.width - PERSON_FEET)
    : person.x;
  const y = Number.isFinite(Number(body.y))
    ? Math.min(Math.max(snap(Number(body.y)), 0), BOOTH_FEET.depth - PERSON_FEET)
    : person.y;

  await env.DB.prepare(
    `UPDATE booth_people SET label = ?, x = ?, y = ? WHERE id = ?`
  ).bind(label, x, y, id).run();

  return { ok: true };
}

export async function handleDeleteBoothPerson(request, env, personId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  await env.DB.prepare(
    `DELETE FROM booth_people WHERE id = ?`
  ).bind(Number(personId)).run();

  return { ok: true };
}

/**
 * How a unit is built: how many tiers, how tall the unit is, and any tier that
 * isn't the even split of that height.
 *
 * SIZED means the unit was physically assembled to its tier count, so this is
 * the number the floor works to. Shrinking it drops the tiers that no longer
 * exist along with anything standing on them — leaving a family placed on tier
 * 6 of a 4-tier unit would be a placement nothing can show.
 */
export async function handleUpdateTiers(request, env, positionId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const id = Number(positionId);
  const body = await readJsonBody(request);

  const position = await env.DB.prepare(
    `SELECT id, tier_count, usable_height_in FROM shelf_positions WHERE id = ?`
  ).bind(id).first();

  if (!position) return { ok: false, error: "That position no longer exists." };

  const tierCount = body.tier_count === undefined
    ? Number(position.tier_count)
    : Math.max(0, Math.min(12, Math.round(Number(body.tier_count)) || 0));

  const usableHeight = body.usable_height_in === undefined
    ? Number(position.usable_height_in)
    : Math.max(12, Math.min(120, Number(body.usable_height_in) || DEFAULT_USABLE_HEIGHT_IN));

  const writes = [
    env.DB.prepare(
      `UPDATE shelf_positions SET tier_count = ?, usable_height_in = ? WHERE id = ?`
    ).bind(tierCount, usableHeight, id)
  ];

  // Tiers that no longer exist take whatever stood on them with them.
  writes.push(
    env.DB.prepare(
      `DELETE FROM shelf_grouping_tiers WHERE position_id = ? AND tier_index > ?`
    ).bind(id, tierCount),
    env.DB.prepare(
      `DELETE FROM shelf_tiers WHERE position_id = ? AND tier_index > ?`
    ).bind(id, tierCount)
  );

  // Heights stay sparse: a row only where a tier isn't the even split, so a
  // blind-box unit is described by its two tall bottom tiers and nothing else.
  if (Array.isArray(body.heights)) {
    for (const row of body.heights) {
      const tier = Number(row.tier_index);
      if (!Number.isFinite(tier) || tier < 1 || tier > tierCount) continue;

      const height = Number(row.height_in);
      if (!height) {
        writes.push(env.DB.prepare(
          `DELETE FROM shelf_tiers WHERE position_id = ? AND tier_index = ?`
        ).bind(id, tier));
      } else {
        writes.push(env.DB.prepare(
          `INSERT INTO shelf_tiers (position_id, tier_index, height_in) VALUES (?, ?, ?)
           ON CONFLICT (position_id, tier_index) DO UPDATE SET height_in = excluded.height_in`
        ).bind(id, tier, Math.max(1, Math.min(48, height))));
      }
    }
  }

  await env.DB.batch(writes);

  return { ok: true };
}
