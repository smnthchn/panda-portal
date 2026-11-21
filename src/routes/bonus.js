import { readJsonBody, BadRequest } from "../lib/http.js";
import { requireUser } from "../lib/auth.js";
import { shopifyGraphql } from "../lib/shopify.js";

/**
 * Sales bonus (docs/bonus-plan.md).
 *
 * A goal is a Monday-to-Friday week or a weekend of in-store sales at the
 * Markham location. Meeting it pays a set amount, and every further step of
 * sales pays a little more; the total is split evenly between the people on
 * that kind of goal. Staff see their own goal and how sales are going. Only
 * the boss sees last year's sales, which the goals were worked out from.
 */

/** The store. Shopify's other two POS locations are the warehouse and events. */
const MARKHAM_LOCATION_ID = "3164241943";

const KINDS = ["weekday", "weekend"];

/** A week in progress is re-read from Shopify once it's this old. */
const LIVE_MAX_AGE_SECONDS = 100;

/** A finished week still changes when something is refunded, just rarely. */
const DONE_MAX_AGE_SECONDS = 60 * 60;

/** Shopify reads allowed in one page load, so a cold boss page can't run long. */
const MAX_REFRESHES = 4;

const torontoFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23"
});

function torontoPartsOf(date) {
  const parts = Object.fromEntries(torontoFormat.formatToParts(date).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** Today's date in Toronto, where the store is. The worker itself runs UTC. */
export function todayToronto(now = new Date()) {
  return torontoPartsOf(now).date;
}

/**
 * Midnight at the start of a Toronto day, as a stamp Shopify can search on.
 * Toronto is UTC-5 in winter and UTC-4 in summer, so both are tried and the
 * one that really lands on midnight of that day wins.
 */
export function torontoMidnight(isoDate) {
  for (const offset of ["-05:00", "-04:00"]) {
    const stamp = `${isoDate}T00:00:00${offset}`;
    const parts = torontoPartsOf(new Date(stamp));
    if (parts.date === isoDate && parts.hour === 0) return stamp;
  }
  return `${isoDate}T00:00:00-05:00`;
}

export function nextDay(isoDate) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Where a goal stands against today: not started, running, or finished. */
export function blockStatus(block, today) {
  if (today < block.starts_on) return "upcoming";
  if (today > block.ends_on) return "done";
  return "live";
}

function moneyCents(set) {
  const amount = Number(set?.shopMoney?.amount);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

/**
 * What one order adds to the sales total, in cents: before tax, after
 * discounts, and after anything that took money back off it.
 *
 * Shopify's current subtotal already drops for a returned or refunded item
 * and for a voided order. It misses two things, which are handled here:
 * an order cancelled without a refund still shows its full amount, and money
 * refunded with no item returned (a price adjustment) doesn't lower it. That
 * refund includes tax, so only its before-tax share comes off.
 */
export function orderNetCents(order) {
  if (!order || order.test || order.cancelledAt) return 0;

  const subtotal = moneyCents(order.currentSubtotalPriceSet);
  const total = moneyCents(order.currentTotalPriceSet);

  let moneyOnly = 0;
  for (const refund of order.refunds || []) {
    const hasItems = (refund.refundLineItems?.nodes || []).length > 0;
    if (!hasItems) moneyOnly += moneyCents(refund.totalRefundedSet);
  }

  if (!moneyOnly) return subtotal;

  const beforeTaxShare = total > 0 ? Math.min(1, subtotal / total) : 1;
  return Math.max(0, subtotal - Math.round(moneyOnly * beforeTaxShare));
}

/**
 * The bonus a sales figure earns against one goal.
 *
 * Below the goal nothing is paid. At the goal the base is paid, and each full
 * step past it adds the step bonus. The total is split evenly between the
 * people sharing the goal.
 */
export function bonusFor(block, salesCents, people = 1) {
  const goal = block.goal_cents;
  const nothing = {
    met: false, steps: 0, total_cents: 0, each_cents: 0, to_goal_cents: null, to_next_cents: null
  };

  if (!goal || salesCents === null || salesCents === undefined) return nothing;
  if (salesCents < goal) return { ...nothing, to_goal_cents: goal - salesCents };

  const over = salesCents - goal;
  const stepSize = block.step_size_cents > 0 ? block.step_size_cents : 0;
  const steps = stepSize ? Math.floor(over / stepSize) : 0;
  const total = block.base_cents + steps * (block.step_bonus_cents || 0);

  return {
    met: true,
    steps,
    total_cents: total,
    each_cents: Math.round(total / Math.max(1, people)),
    to_goal_cents: 0,
    to_next_cents: stepSize && block.step_bonus_cents > 0 ? stepSize - (over % stepSize) : null
  };
}

const ORDERS_QUERY = `
  query BonusOrders($q: String!, $after: String) {
    orders(first: 100, query: $q, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        test
        cancelledAt
        currentSubtotalPriceSet { shopMoney { amount } }
        currentTotalPriceSet { shopMoney { amount } }
        refunds {
          totalRefundedSet { shopMoney { amount } }
          refundLineItems(first: 1) { nodes { id } }
        }
      }
    }
  }
`;

/**
 * The search for one goal's orders. The dates must be quoted: without the
 * quotes Shopify reads the end stamp as a whole day and returns two days.
 */
export function ordersSearch(block) {
  const start = torontoMidnight(block.starts_on);
  const end = torontoMidnight(nextDay(block.ends_on));
  return `created_at:>='${start}' created_at:<'${end}' source_name:pos location_id:${MARKHAM_LOCATION_ID}`;
}

async function fetchSalesCents(env, block) {
  const q = ordersSearch(block);
  let after = null;
  let cents = 0;

  // A December week is a few hundred orders; twenty pages is far past that
  // and stops a bad cursor from looping.
  for (let page = 0; page < 20; page++) {
    const data = await shopifyGraphql(env, ORDERS_QUERY, { q, after });
    for (const order of data.orders.nodes) cents += orderNetCents(order);
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }

  return cents;
}

function ageSeconds(stamp, now) {
  if (!stamp) return Infinity;
  const ms = Date.parse(stamp.replace(" ", "T") + "Z");
  return Number.isFinite(ms) ? (now.getTime() - ms) / 1000 : Infinity;
}

/**
 * Sales so far for one goal, read from Shopify only when the kept figure has
 * gone stale. `budget` counts the Shopify reads left for this page load. If
 * Shopify can't be reached the last figure is returned, marked stale, so the
 * page still draws.
 */
async function salesFor(env, block, today, now, budget) {
  const status = blockStatus(block, today);
  if (status === "upcoming") return { cents: null, checked_at: null, stale: false };

  const maxAge = status === "live" ? LIVE_MAX_AGE_SECONDS : DONE_MAX_AGE_SECONDS;
  const fresh = block.sales_cents !== null && ageSeconds(block.sales_checked_at, now) < maxAge;

  if (fresh || budget.left <= 0) {
    return { cents: block.sales_cents, checked_at: block.sales_checked_at, stale: !fresh };
  }

  budget.left -= 1;

  try {
    const cents = await fetchSalesCents(env, block);
    const stamp = now.toISOString().slice(0, 19).replace("T", " ");
    await env.DB.prepare(
      `UPDATE bonus_blocks SET sales_cents = ?, sales_checked_at = ? WHERE id = ?`
    ).bind(cents, stamp, block.id).run();
    return { cents, checked_at: stamp, stale: false };
  } catch (err) {
    console.error(`Sales bonus: could not read sales for block ${block.id}`, err);
    return { cents: block.sales_cents, checked_at: block.sales_checked_at, stale: true };
  }
}

async function loadPeople(db) {
  const rows = await db.prepare(
    `SELECT bp.kind, e.id, e.full_name
     FROM bonus_people bp
     JOIN employees e ON e.id = bp.employee_id
     WHERE e.is_active = 1
     ORDER BY e.full_name`
  ).all();

  const byKind = { weekday: [], weekend: [] };
  for (const row of rows.results || []) {
    byKind[row.kind]?.push({ id: row.id, full_name: row.full_name });
  }
  return byKind;
}

async function loadBlocks(db) {
  const rows = await db.prepare(`SELECT * FROM bonus_blocks ORDER BY starts_on`).all();
  return rows.results || [];
}

/** Every date a goal covers, first to last. */
export function blockDays(block) {
  const days = [];
  for (let day = block.starts_on; day <= block.ends_on && days.length < 31; day = nextDay(day)) {
    days.push(day);
  }
  return days;
}

/**
 * Who gets what. A person only shares in a bonus for the days they worked,
 * so the bonus is cut into equal daily parts and each day's part goes to
 * whoever worked that day. A day nobody on the goal worked isn't paid.
 *
 * Everyone is taken to have worked unless the boss has unticked them, so
 * `absentByDay` holds only the exceptions: Map(day -> Set(employee id)).
 */
export function sharesFor(block, totalCents, people, absentByDay = new Map()) {
  const days = blockDays(block);
  const perDay = days.length ? totalCents / days.length : 0;
  const owed = new Map(people.map(person => [person.id, { cents: 0, days_worked: 0 }]));
  let unpaid = 0;

  for (const day of days) {
    const absent = absentByDay.get(day) || new Set();
    const workers = people.filter(person => !absent.has(person.id));

    if (!workers.length) {
      unpaid += perDay;
      continue;
    }

    for (const worker of workers) {
      const entry = owed.get(worker.id);
      entry.cents += perDay / workers.length;
      entry.days_worked += 1;
    }
  }

  return {
    shares: people.map(person => ({
      id: person.id,
      full_name: person.full_name,
      cents: Math.round(owed.get(person.id).cents),
      days_worked: owed.get(person.id).days_worked
    })),
    unpaid_cents: Math.round(unpaid)
  };
}

/** The boss's unticks: Map(block id -> Map(day -> Set(employee id))). */
async function loadAbsences(db) {
  const rows = await db.prepare(`SELECT block_id, day, employee_id FROM bonus_absences`).all();
  const byBlock = new Map();

  for (const row of rows.results || []) {
    if (!byBlock.has(row.block_id)) byBlock.set(row.block_id, new Map());
    const byDay = byBlock.get(row.block_id);
    if (!byDay.has(row.day)) byDay.set(row.day, new Set());
    byDay.get(row.day).add(row.employee_id);
  }

  return byBlock;
}

/**
 * What anyone on the goal may see. Last year's sales are deliberately absent,
 * and so is who else was or wasn't in: a person sees only their own share.
 */
function staffView(block, sales, status, people, absentByDay, viewerId = null) {
  const bonus = bonusFor(block, sales.cents, people.length);
  const split = sharesFor(block, bonus.total_cents, people, absentByDay);
  const mine = viewerId === null ? null : split.shares.find(share => share.id === viewerId) || null;

  return {
    id: block.id,
    kind: block.kind,
    starts_on: block.starts_on,
    ends_on: block.ends_on,
    status,
    goal_cents: block.goal_cents,
    base_cents: block.base_cents,
    step_size_cents: block.step_size_cents,
    step_bonus_cents: block.step_bonus_cents,
    sales_cents: sales.cents,
    sales_checked_at: sales.checked_at,
    sales_stale: sales.stale,
    days: blockDays(block).length,
    people: people.length,
    bonus,
    my_cents: mine ? mine.cents : null,
    my_days_worked: mine ? mine.days_worked : null
  };
}

/**
 * GET /api/bonus — the signed-in person's own goals. For each kind they're
 * on: the goal running now (or the next one coming), and the last finished
 * one so Monday still shows how the weekend ended.
 */
export async function handleMyBonus(request, env) {
  const auth = await requireUser(request, env);
  if (!auth.ok) return auth;

  const people = await loadPeople(env.DB);
  const myKinds = KINDS.filter(kind => people[kind].some(person => person.id === auth.user.id));
  if (!myKinds.length) return { ok: true, cards: [] };

  const now = new Date();
  const today = todayToronto(now);
  const blocks = await loadBlocks(env.DB);
  const absences = await loadAbsences(env.DB);
  const budget = { left: MAX_REFRESHES };
  const cards = [];
  const me = auth.user.id;

  for (const kind of myKinds) {
    const mine = blocks.filter(block => block.kind === kind);
    const current = mine.find(block => blockStatus(block, today) === "live")
      || mine.find(block => blockStatus(block, today) === "upcoming");
    const last = mine.filter(block => blockStatus(block, today) === "done").pop();

    const card = { kind, current: null, last: null };

    if (current) {
      const sales = await salesFor(env, current, today, now, budget);
      card.current = staffView(
        current, sales, blockStatus(current, today), people[kind], absences.get(current.id), me
      );
    }

    if (last) {
      const sales = await salesFor(env, last, today, now, budget);
      card.last = staffView(last, sales, "done", people[kind], absences.get(last.id), me);
    }

    if (card.current || card.last) cards.push(card);
  }

  return { ok: true, cards };
}

function requireBoss(auth) {
  if (!auth.ok) return auth;
  if (auth.user.role !== "boss") return { ok: false, error: "You do not have access to this." };
  return null;
}

/**
 * GET /api/admin/bonus — every goal, with last year's sales beside it, sales
 * so far and what it has earned. Boss only.
 */
export async function handleBonusAdmin(request, env) {
  const auth = await requireUser(request, env);
  const denied = requireBoss(auth);
  if (denied) return denied;

  const now = new Date();
  const today = todayToronto(now);
  const people = await loadPeople(env.DB);
  const blocks = await loadBlocks(env.DB);
  const absences = await loadAbsences(env.DB);
  const budget = { left: MAX_REFRESHES };

  // The running goals first, so they're the ones that get a fresh read when
  // the budget is short.
  const order = [...blocks].sort((a, b) =>
    Number(blockStatus(b, today) === "live") - Number(blockStatus(a, today) === "live")
  );

  const salesById = new Map();
  for (const block of order) {
    salesById.set(block.id, await salesFor(env, block, today, now, budget));
  }

  const staff = await env.DB.prepare(
    `SELECT id, full_name FROM employees WHERE is_active = 1 ORDER BY full_name`
  ).all();

  return {
    ok: true,
    today,
    people,
    staff: staff.results || [],
    blocks: blocks.map(block => {
      const absentByDay = absences.get(block.id) || new Map();
      const view = staffView(
        block, salesById.get(block.id), blockStatus(block, today), people[block.kind], absentByDay
      );
      const split = sharesFor(block, view.bonus.total_cents, people[block.kind], absentByDay);

      return {
        ...view,
        last_year_cents: block.last_year_cents,
        day_list: blockDays(block),
        absent: Object.fromEntries([...absentByDay].map(([day, ids]) => [day, [...ids]])),
        shares: split.shares,
        unpaid_cents: split.unpaid_cents
      };
    })
  };
}

/**
 * PUT /api/admin/bonus/blocks/:id/attendance — say whether one person worked
 * one day of a goal. Everyone counts as having worked until unticked, so only
 * the unticks are stored. Boss only. Body: { day, employee_id, worked }.
 */
export async function handleSetBonusAttendance(request, env, id) {
  const auth = await requireUser(request, env);
  const denied = requireBoss(auth);
  if (denied) return denied;

  const block = await env.DB.prepare(`SELECT * FROM bonus_blocks WHERE id = ?`).bind(Number(id)).first();
  if (!block) throw new BadRequest("That goal doesn't exist.");

  const body = await readJsonBody(request);
  const day = String(body.day || "");
  const employeeId = Number(body.employee_id);

  if (!blockDays(block).includes(day)) throw new BadRequest("That day isn't part of this goal.");

  const people = await loadPeople(env.DB);
  if (!people[block.kind].some(person => person.id === employeeId)) {
    throw new BadRequest("That person isn't on this goal.");
  }

  if (body.worked) {
    await env.DB.prepare(
      `DELETE FROM bonus_absences WHERE block_id = ? AND day = ? AND employee_id = ?`
    ).bind(block.id, day, employeeId).run();
  } else {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO bonus_absences (block_id, day, employee_id, marked_by)
       VALUES (?, ?, ?, ?)`
    ).bind(block.id, day, employeeId, auth.user.id).run();
  }

  return { ok: true };
}

/** A dollar amount typed into a form -> cents. Blank is null; junk is refused. */
export function dollarsToCents(value, fieldName) {
  if (value === undefined || value === null || String(value).trim() === "") return null;

  const amount = Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) {
    throw new BadRequest(`${fieldName} needs to be an amount in dollars.`);
  }

  return Math.round(amount * 100);
}

/**
 * PUT /api/admin/bonus/blocks/:id — change one goal's numbers. A blank goal
 * means "not set yet". Boss only.
 */
export async function handleUpdateBonusBlock(request, env, id) {
  const auth = await requireUser(request, env);
  const denied = requireBoss(auth);
  if (denied) return denied;

  const block = await env.DB.prepare(`SELECT * FROM bonus_blocks WHERE id = ?`).bind(Number(id)).first();
  if (!block) throw new BadRequest("That goal doesn't exist.");

  const body = await readJsonBody(request);

  const goal = "goal" in body ? dollarsToCents(body.goal, "The goal") : block.goal_cents;
  const base = "base" in body ? dollarsToCents(body.base, "What it pays") : block.base_cents;
  const stepSize = "step_size" in body ? dollarsToCents(body.step_size, "The step") : block.step_size_cents;
  const stepBonus = "step_bonus" in body ? dollarsToCents(body.step_bonus, "The step bonus") : block.step_bonus_cents;

  if (base === null) throw new BadRequest("What it pays can't be blank. Use 0 for nothing.");

  await env.DB.prepare(
    `UPDATE bonus_blocks
     SET goal_cents = ?, base_cents = ?, step_size_cents = ?, step_bonus_cents = ?,
         updated_by = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(goal, base, stepSize ?? 0, stepBonus ?? 0, auth.user.id, block.id).run();

  return { ok: true };
}

/**
 * PUT /api/admin/bonus/people — who shares one kind of goal. Boss only.
 * Body: { kind, employee_ids }.
 */
export async function handleSetBonusPeople(request, env) {
  const auth = await requireUser(request, env);
  const denied = requireBoss(auth);
  if (denied) return denied;

  const body = await readJsonBody(request);
  if (!KINDS.includes(body.kind)) throw new BadRequest("Pick weekdays or weekends.");

  const ids = Array.isArray(body.employee_ids)
    ? [...new Set(body.employee_ids.map(Number).filter(Number.isInteger))]
    : [];

  const statements = [
    env.DB.prepare(`DELETE FROM bonus_people WHERE kind = ?`).bind(body.kind),
    ...ids.map(employeeId =>
      env.DB.prepare(
        `INSERT INTO bonus_people (kind, employee_id)
         SELECT ?, id FROM employees WHERE id = ? AND is_active = 1`
      ).bind(body.kind, employeeId)
    )
  ];

  await env.DB.batch(statements);
  return { ok: true };
}
