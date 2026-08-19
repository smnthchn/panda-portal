import { readJsonBody, optionalText, requiredText, BadRequest } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { roleOutranks } from "../lib/permissions.js";
import { listDriveFiles } from "../lib/google.js";

const CHECKLIST_AUDIENCES = ["all", "staff", "boss"];

// "all" means everyone including volunteers.
function audienceToRole(audience) {
  return audience === "all" ? "volunteer" : audience;
}

function slugify(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "convention";
}

async function uniqueSlug(db, name, ignoreId = null) {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;

  // Small team, small table — a lookup per attempt is fine.
  for (;;) {
    const clash = await db.prepare(
      `SELECT id FROM conventions WHERE slug = ? AND id IS NOT ?`
    ).bind(candidate, ignoreId).first();

    if (!clash) return candidate;

    candidate = `${base}-${suffix++}`;
  }
}

/** upcoming | active | past, worked out from the dates rather than kept by hand. */
function phaseOf(convention, today) {
  if (convention.ends_on && convention.ends_on < today) return "past";
  if (convention.starts_on && convention.starts_on > today) return "upcoming";
  if (convention.starts_on || convention.ends_on) return "active";
  return "upcoming";
}

/**
 * Whether an event is hidden from someone without manage_conventions.
 *
 * Two reasons: it isn't published yet, or it's over. A finished show is the
 * boss's record — the history next year's plan is built from — not something
 * the floor needs in their list.
 *
 * The date test matches phaseOf()'s, so the list and the phase badge can't
 * disagree about whether a show is over, and an event with no end date is
 * never past.
 */
export function hiddenFromStaff(convention, today) {
  if (!convention) return true;
  if (!convention.is_published) return true;
  return Boolean(convention.ends_on && convention.ends_on < today);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function assertDate(value, fieldName) {
  const text = optionalText(value);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new BadRequest(`${fieldName} must be a date like 2026-09-14.`);
  }
  return text;
}

function requiredDate(value, fieldName) {
  const date = assertDate(value, fieldName);
  if (!date) throw new BadRequest(`${fieldName} is required.`);
  return date;
}

function optionalTime(value, fieldName) {
  const text = optionalText(value);
  if (!text) return null;
  if (!/^\d{2}:\d{2}$/.test(text)) {
    throw new BadRequest(`${fieldName} must be a time like 09:30.`);
  }
  return text;
}

function assertTime(value, fieldName) {
  const text = optionalTime(requiredText(value, fieldName), fieldName);
  return text;
}

/**
 * Link fields end up as hrefs, so only http(s) is allowed through — a pasted
 * "javascript:" URL would otherwise run when someone clicks it.
 */
export function optionalUrl(value, fieldName) {
  const text = optionalText(value);
  if (!text) return null;

  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new BadRequest(`${fieldName} must be a full link, starting with https://`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new BadRequest(`${fieldName} must be an http or https link.`);
  }

  return parsed.toString();
}

/** Shared by create and update: the optional link and load-in fields. */
function linkAndLoadInFields(body) {
  const loadInStart = optionalTime(body.load_in_start, "Load-in start");
  const loadInEnd = optionalTime(body.load_in_end, "Load-in end");

  if (loadInStart && loadInEnd && loadInEnd <= loadInStart) {
    throw new BadRequest("The load-in window's end time must be after its start time.");
  }

  return {
    mapUrl: optionalUrl(body.map_url, "Google Maps link"),
    parkingMapUrl: optionalUrl(body.parking_map_url, "Parking map link"),
    websiteUrl: optionalUrl(body.website_url, "Official site URL"),
    loadInStart,
    loadInEnd
  };
}

export async function handleConventionList(request, env) {
  const auth = await requireUser(request, env, "conventions");
  if (!auth.ok) return auth;

  const canManage = auth.user.permissions.manage_conventions;
  const today = todayIso();

  const rows = await env.DB.prepare(
    `SELECT c.*,
            (SELECT COUNT(*) FROM convention_shifts s
              WHERE s.convention_id = c.id AND s.employee_id = ?) AS my_shift_count
     FROM conventions c
     ORDER BY COALESCE(c.starts_on, '9999-12-31') ASC`
  ).bind(auth.user.id).all();

  // Filtered here rather than in the query so the list and the detail apply
  // one rule from one place. There are a handful of events, so the cost of
  // reading them all and dropping some is nothing against the cost of two
  // copies of this rule drifting apart.
  const conventions = (rows.results || [])
    .filter(row => canManage || !hiddenFromStaff(row, today))
    .map(row => ({
    ...row,
    is_published: row.is_published === 1,
    phase: phaseOf(row, today)
  }));

  return { ok: true, conventions, canManage };
}

export async function handleConventionDetail(request, env, slug) {
  const auth = await requireUser(request, env, "conventions");
  if (!auth.ok) return auth;

  const canManage = auth.user.permissions.manage_conventions;

  const convention = await env.DB.prepare(
    `SELECT * FROM conventions WHERE slug = ?`
  ).bind(slug).first();

  // Hiding it from the list is only half of it — the URL survives in history
  // and in anything anyone shared. Same wording either way: a hidden thing
  // shouldn't confirm it exists.
  if (!convention || (!canManage && hiddenFromStaff(convention, todayIso()))) {
    return { ok: false, error: "Convention not found." };
  }

  const [shiftRows, checklistRows, itemRows, dayRows] = await Promise.all([
    env.DB.prepare(
      `SELECT s.*, e.full_name AS employee_name
       FROM convention_shifts s
       LEFT JOIN employees e ON e.id = s.employee_id
       WHERE s.convention_id = ?
       ORDER BY s.shift_date ASC, s.starts_at ASC`
    ).bind(convention.id).all(),
    env.DB.prepare(
      `SELECT * FROM convention_checklists
       WHERE convention_id = ?
       ORDER BY sort_order ASC, id ASC`
    ).bind(convention.id).all(),
    env.DB.prepare(
      `SELECT i.*, e.full_name AS done_by_name
       FROM convention_checklist_items i
       LEFT JOIN convention_checklists cl ON cl.id = i.checklist_id
       LEFT JOIN employees e ON e.id = i.done_by
       WHERE cl.convention_id = ?
       ORDER BY i.sort_order ASC, i.id ASC`
    ).bind(convention.id).all(),
    env.DB.prepare(
      `SELECT * FROM convention_days
       WHERE convention_id = ?
       ORDER BY day_date ASC`
    ).bind(convention.id).all()
  ]);

  const itemsByChecklist = {};
  for (const item of itemRows.results || []) {
    itemsByChecklist[item.checklist_id] ??= [];
    itemsByChecklist[item.checklist_id].push({
      id: item.id,
      label: item.label,
      done: Boolean(item.done_at),
      done_by_name: item.done_by_name,
      done_at: item.done_at
    });
  }

  const checklists = (checklistRows.results || [])
    .filter(list => roleOutranks(auth.user.role, audienceToRole(list.visible_to)))
    .map(list => ({
      id: list.id,
      name: list.name,
      visible_to: list.visible_to,
      items: itemsByChecklist[list.id] || []
    }));

  const shifts = (shiftRows.results || []).map(shift => ({
    ...shift,
    is_mine: shift.employee_id === auth.user.id
  }));

  let documents = [];
  let documentsError = null;
  if (convention.drive_folder_id) {
    try {
      documents = await listDriveFiles(convention.drive_folder_id, env);
    } catch (err) {
      documentsError = err.message;
    }
  }

  let assignable = [];
  if (canManage) {
    const people = await env.DB.prepare(
      `SELECT id, full_name, role FROM employees
       WHERE is_active = 1
       ORDER BY full_name ASC`
    ).all();
    assignable = people.results || [];
  }

  return {
    ok: true,
    canManage,
    currentUserId: auth.user.id,
    convention: {
      ...convention,
      is_published: convention.is_published === 1,
      phase: phaseOf(convention, todayIso())
    },
    shifts,
    myShifts: shifts.filter(s => s.is_mine),
    days: dayRows.results || [],
    checklists,
    documents,
    documentsError,
    assignable
  };
}

export async function handleCreateConvention(request, env) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);
  const name = requiredText(body.name, "Name");
  const links = linkAndLoadInFields(body);

  const result = await env.DB.prepare(
    `INSERT INTO conventions
       (name, slug, venue, address, map_url, parking_map_url, website_url,
        starts_on, ends_on, setup_on, store_close_on, load_in_start, load_in_end,
        booth_number, notes, drive_folder_id, booth_layout_file_id,
        venue_map_file_id, is_published)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    name,
    await uniqueSlug(env.DB, name),
    optionalText(body.venue),
    optionalText(body.address),
    links.mapUrl,
    links.parkingMapUrl,
    links.websiteUrl,
    assertDate(body.starts_on, "Start date"),
    assertDate(body.ends_on, "End date"),
    assertDate(body.setup_on, "Setup date"),
    assertDate(body.store_close_on, "Store close date"),
    links.loadInStart,
    links.loadInEnd,
    optionalText(body.booth_number),
    optionalText(body.notes),
    optionalText(body.drive_folder_id),
    optionalText(body.booth_layout_file_id),
    optionalText(body.venue_map_file_id),
    body.is_published === false ? 0 : 1
  ).run();

  const created = await env.DB.prepare(
    `SELECT slug FROM conventions WHERE id = ?`
  ).bind(result.meta.last_row_id).first();

  return { ok: true, slug: created?.slug };
}

export async function handleUpdateConvention(request, env, conventionId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const id = Number(conventionId);
  const body = await readJsonBody(request);

  const existing = await env.DB.prepare(
    `SELECT id, name, slug FROM conventions WHERE id = ?`
  ).bind(id).first();

  if (!existing) {
    throw new BadRequest("That convention no longer exists.");
  }

  const name = optionalText(body.name) || existing.name;
  const slug = name === existing.name ? existing.slug : await uniqueSlug(env.DB, name, id);
  const links = linkAndLoadInFields(body);

  await env.DB.prepare(
    `UPDATE conventions
     SET name = ?, slug = ?, venue = ?, address = ?, map_url = ?,
         parking_map_url = ?, website_url = ?,
         starts_on = ?, ends_on = ?, setup_on = ?, store_close_on = ?,
         load_in_start = ?, load_in_end = ?,
         booth_number = ?, notes = ?, drive_folder_id = ?, booth_layout_file_id = ?,
         venue_map_file_id = ?, is_published = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(
    name,
    slug,
    optionalText(body.venue),
    optionalText(body.address),
    links.mapUrl,
    links.parkingMapUrl,
    links.websiteUrl,
    assertDate(body.starts_on, "Start date"),
    assertDate(body.ends_on, "End date"),
    assertDate(body.setup_on, "Setup date"),
    assertDate(body.store_close_on, "Store close date"),
    links.loadInStart,
    links.loadInEnd,
    optionalText(body.booth_number),
    optionalText(body.notes),
    optionalText(body.drive_folder_id),
    optionalText(body.booth_layout_file_id),
    optionalText(body.venue_map_file_id),
    body.is_published === false ? 0 : 1,
    id
  ).run();

  return { ok: true, slug };
}

export async function handleDeleteConvention(request, env, conventionId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const id = Number(conventionId);

  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM convention_checklist_items
       WHERE checklist_id IN (SELECT id FROM convention_checklists WHERE convention_id = ?)`
    ).bind(id),
    env.DB.prepare(`DELETE FROM convention_checklists WHERE convention_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM convention_shifts WHERE convention_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM convention_days WHERE convention_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM conventions WHERE id = ?`).bind(id)
  ]);

  return { ok: true };
}

/**
 * Validates a day's windows. Regular hours need both ends. Early access and
 * setup are start-only — early access runs until doors open, and setup is just
 * a "be there from" time — so their end columns are always NULL now.
 */
function dayWindows(body) {
  const regularStart = optionalTime(body.regular_start, "Regular start");
  const regularEnd = optionalTime(body.regular_end, "Regular end");

  if (Boolean(regularStart) !== Boolean(regularEnd)) {
    throw new BadRequest("Regular hours need both a start and an end time.");
  }

  if (regularStart && regularEnd <= regularStart) {
    throw new BadRequest("Regular hours must end after they start.");
  }

  const earlyStart = optionalTime(body.early_start, "Early access start");

  if (earlyStart && regularStart && earlyStart >= regularStart) {
    throw new BadRequest("Early access has to start before regular hours open.");
  }

  return {
    setup_start: optionalTime(body.setup_start, "Setup start"),
    setup_end: null,
    early_start: earlyStart,
    early_end: null,
    regular_start: regularStart,
    regular_end: regularEnd
  };
}

/** Creates a day, or replaces the hours on one already saved for that date. */
export async function handleSaveConventionDay(request, env, conventionId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);
  const dayDate = requiredDate(body.day_date, "Day");
  const w = dayWindows(body);

  await env.DB.prepare(
    `INSERT INTO convention_days
       (convention_id, day_date, setup_start, setup_end,
        early_start, early_end, regular_start, regular_end, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (convention_id, day_date) DO UPDATE SET
       setup_start = excluded.setup_start,
       setup_end = excluded.setup_end,
       early_start = excluded.early_start,
       early_end = excluded.early_end,
       regular_start = excluded.regular_start,
       regular_end = excluded.regular_end,
       notes = excluded.notes`
  ).bind(
    Number(conventionId),
    dayDate,
    w.setup_start,
    w.setup_end,
    w.early_start,
    w.early_end,
    w.regular_start,
    w.regular_end,
    optionalText(body.notes)
  ).run();

  return { ok: true };
}

export async function handleDeleteConventionDay(request, env, dayId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  await env.DB.prepare(`DELETE FROM convention_days WHERE id = ?`)
    .bind(Number(dayId)).run();

  return { ok: true };
}

export async function handleCreateShift(request, env, conventionId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);
  const startsAt = assertTime(body.starts_at, "Start time");
  const endsAt = assertTime(body.ends_at, "End time");

  if (endsAt <= startsAt) {
    throw new BadRequest("The shift's end time must be after its start time.");
  }

  const employeeId = body.employee_id ? Number(body.employee_id) : null;
  const { minutes, count } = breakAllotment(body);

  await env.DB.prepare(
    `INSERT INTO convention_shifts
       (convention_id, employee_id, title, shift_date, starts_at, ends_at, notes,
        break_allotment_minutes, break_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    Number(conventionId),
    employeeId,
    requiredText(body.title, "Shift name"),
    requiredDate(body.shift_date, "Shift date"),
    startsAt,
    endsAt,
    optionalText(body.notes),
    minutes,
    count
  ).run();

  return { ok: true };
}

/** Break allotment: 0–240 minutes, taken as one break or two. */
function breakAllotment(body) {
  const raw = Number(body.break_allotment_minutes);
  const minutes = Number.isFinite(raw) ? Math.max(0, Math.min(240, Math.round(raw))) : 0;
  const count = Number(body.break_count) === 2 ? 2 : 1;
  return { minutes, count };
}

/**
 * Sets a shift's break allotment. This is the only place it's set — the
 * staff battery reads what's saved here. apply_to_day pushes the same
 * allotment to every other shift that day, so a six-shift day is one edit.
 */
export async function handleSetShiftBreak(request, env, shiftId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);
  const { minutes, count } = breakAllotment(body);

  const shift = await env.DB.prepare(
    `SELECT id, convention_id, shift_date FROM convention_shifts WHERE id = ?`
  ).bind(Number(shiftId)).first();

  if (!shift) {
    return { ok: false, error: "That shift no longer exists." };
  }

  if (body.apply_to_day) {
    await env.DB.prepare(
      `UPDATE convention_shifts
       SET break_allotment_minutes = ?, break_count = ?
       WHERE convention_id = ? AND shift_date = ?`
    ).bind(minutes, count, shift.convention_id, shift.shift_date).run();
  } else {
    await env.DB.prepare(
      `UPDATE convention_shifts
       SET break_allotment_minutes = ?, break_count = ?
       WHERE id = ?`
    ).bind(minutes, count, shift.id).run();
  }

  return { ok: true };
}

export async function handleDeleteShift(request, env, shiftId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  await env.DB.prepare(`DELETE FROM convention_shifts WHERE id = ?`)
    .bind(Number(shiftId)).run();

  return { ok: true };
}

export async function handleCreateChecklist(request, env, conventionId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);
  const visibleTo = optionalText(body.visible_to) || "all";

  if (!CHECKLIST_AUDIENCES.includes(visibleTo)) {
    throw new BadRequest("Unknown checklist audience.");
  }

  await env.DB.prepare(
    `INSERT INTO convention_checklists (convention_id, name, visible_to, sort_order)
     VALUES (?, ?, ?, COALESCE(
       (SELECT MAX(sort_order) + 1 FROM convention_checklists WHERE convention_id = ?), 0))`
  ).bind(Number(conventionId), requiredText(body.name, "Checklist name"), visibleTo, Number(conventionId)).run();

  return { ok: true };
}

export async function handleDeleteChecklist(request, env, checklistId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const id = Number(checklistId);

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM convention_checklist_items WHERE checklist_id = ?`).bind(id),
    env.DB.prepare(`DELETE FROM convention_checklists WHERE id = ?`).bind(id)
  ]);

  return { ok: true };
}

export async function handleCreateChecklistItem(request, env, checklistId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  const body = await readJsonBody(request);
  const id = Number(checklistId);

  await env.DB.prepare(
    `INSERT INTO convention_checklist_items (checklist_id, label, sort_order)
     VALUES (?, ?, COALESCE(
       (SELECT MAX(sort_order) + 1 FROM convention_checklist_items WHERE checklist_id = ?), 0))`
  ).bind(id, requiredText(body.label, "Item"), id).run();

  return { ok: true };
}

export async function handleDeleteChecklistItem(request, env, itemId) {
  const auth = await requireUser(request, env, "manage_conventions");
  if (!auth.ok) return auth;

  await env.DB.prepare(`DELETE FROM convention_checklist_items WHERE id = ?`)
    .bind(Number(itemId)).run();

  return { ok: true };
}

/** Anyone who can see the checklist can tick its items off. */
export async function handleToggleChecklistItem(request, env, itemId) {
  const auth = await requireUser(request, env, "conventions");
  if (!auth.ok) return auth;

  const id = Number(itemId);

  const item = await env.DB.prepare(
    `SELECT i.id, i.done_at, cl.visible_to
     FROM convention_checklist_items i
     JOIN convention_checklists cl ON cl.id = i.checklist_id
     WHERE i.id = ?`
  ).bind(id).first();

  if (!item) {
    throw new BadRequest("That checklist item no longer exists.");
  }

  if (!roleOutranks(auth.user.role, audienceToRole(item.visible_to))) {
    return { ok: false, error: "You do not have access to this checklist." };
  }

  const body = await readJsonBody(request);
  const shouldBeDone = body.done === undefined ? !item.done_at : body.done === true;

  if (shouldBeDone) {
    await env.DB.prepare(
      `UPDATE convention_checklist_items
       SET done_by = ?, done_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(auth.user.id, id).run();
  } else {
    await env.DB.prepare(
      `UPDATE convention_checklist_items
       SET done_by = NULL, done_at = NULL
       WHERE id = ?`
    ).bind(id).run();
  }

  return { ok: true, done: shouldBeDone };
}
