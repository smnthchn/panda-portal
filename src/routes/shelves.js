import { readJsonBody, optionalText, BadRequest } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
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

export function boardFaces(position) {
  const names = String(position.board_name || "")
    .split("&")
    .map(name => name.trim())
    .filter(Boolean);

  const faces = ["back", "side", "front"];
  return names.map((name, i) => ({ face: faces[i] || "extra", name }));
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
  const [positionRows, flagRows] = await Promise.all([
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
    ).bind(conventionId).all()
  ]);

  const flagsByPosition = new Map();
  for (const flag of flagRows.results || []) {
    if (!flagsByPosition.has(flag.position_id)) {
      flagsByPosition.set(flag.position_id, new Set());
    }
    flagsByPosition.get(flag.position_id).add(flag.stage);
  }

  return (positionRows.results || []).map(row => {
    const ticked = flagsByPosition.get(row.id) || new Set();

    return {
      id: row.id,
      code: row.code,
      wall: row.wall,
      wall_note: row.wall_note,
      product: row.product || "",
      unit_type: row.unit_type || "",
      signage: signageList(row.signage),
      board_name: row.board_name || "",
      boards: boardFaces(row),
      kind: row.kind,
      geometry: effectiveGeometry(row),
      baseline: { x: row.x, y: row.y, w: row.w, h: row.h },
      moved: row.move_x !== null,
      stages: STAGES.map((_, stage) => ticked.has(stage))
    };
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
    totals: stageTotals(positions),
    conflicts: layoutConflicts(positions),
    copyFrom: others.results || []
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

export async function handleUpdatePosition(request, env, positionId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const id = Number(positionId);
  const body = await readJsonBody(request);

  const position = await env.DB.prepare(
    `SELECT id FROM shelf_positions WHERE id = ?`
  ).bind(id).first();

  if (!position) return { ok: false, error: "That position no longer exists." };

  const updates = [];
  const values = [];

  if (body.product !== undefined) {
    updates.push("product = ?");
    values.push(optionalText(body.product) || "");
  }

  if (body.board_name !== undefined) {
    updates.push("board_name = ?");
    values.push(optionalText(body.board_name) || "");
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

  await env.DB.prepare(
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

  return { ok: true };
}

export async function handleDeletePosition(request, env, positionId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const id = Number(positionId);

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM shelf_stage_flags WHERE position_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM shelf_positions WHERE id = ?`).bind(id)
  ]);

  return { ok: true };
}
