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
 * Where a sales figure stands against one goal.
 *
 * Below the goal nothing is paid. Once it's met, everyone who worked a day of
 * it gets the day rate for each of their days (see sharesFor), and each full
 * step past the goal adds the step bonus to a pot they share. `extra_cents`
 * is that pot.
 */
export function bonusFor(block, salesCents) {
  const goal = block.goal_cents;
  const nothing = {
    met: false, steps: 0, extra_cents: 0, to_goal_cents: null, to_next_cents: null
  };

  if (!goal || salesCents === null || salesCents === undefined) return nothing;
  if (salesCents < goal) return { ...nothing, to_goal_cents: goal - salesCents };

  const over = salesCents - goal;
  const stepSize = block.step_size_cents > 0 ? block.step_size_cents : 0;
  const steps = stepSize ? Math.floor(over / stepSize) : 0;

  return {
    met: true,
    steps,
    extra_cents: steps * (block.step_bonus_cents || 0),
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
 * Who worked each day of a goal: Map(day -> [{ id, full_name, extra }]).
 *
 * The people on the goal's list are taken to have worked every day unless the
 * boss has unticked them (`absentByDay`: Map(day -> Set(employee id))). Anyone
 * else the boss has added for a day is an extra (`extrasByDay`:
 * Map(day -> [{ id, full_name }])), such as weekend staff helping on a
 * weekday sale day.
 */
export function workersByDay(block, people, absentByDay = new Map(), extrasByDay = new Map()) {
  const byDay = new Map();

  for (const day of blockDays(block)) {
    const absent = absentByDay.get(day) || new Set();
    const regulars = people
      .filter(person => !absent.has(person.id))
      .map(person => ({ id: person.id, full_name: person.full_name, extra: false }));
    const extras = (extrasByDay.get(day) || [])
      .filter(person => !people.some(regular => regular.id === person.id))
      .map(person => ({ id: person.id, full_name: person.full_name, extra: true }));

    byDay.set(day, [...regulars, ...extras]);
  }

  return byDay;
}

/**
 * Who gets what when a goal is met (Sam, 2026-11-21).
 *
 *  - Everyone gets the day rate for each day they worked. It is one amount
 *    per person, the same on any day, and it is not split: two people on a
 *    day both get it.
 *  - The extra pot (the steps past the goal) IS shared, by days worked: five
 *    days and one day make sixths.
 *
 * Nothing is paid on a goal that wasn't met. `days_worked` is filled in
 * either way, so a card can say what someone stands to earn.
 */
export function sharesFor(block, workers, bonus) {
  const byId = new Map();
  let personDays = 0;

  for (const day of blockDays(block)) {
    for (const worker of workers.get(day) || []) {
      if (!byId.has(worker.id)) {
        byId.set(worker.id, { id: worker.id, full_name: worker.full_name, days_worked: 0 });
      }
      byId.get(worker.id).days_worked += 1;
      personDays += 1;
    }
  }

  const rate = block.day_rate_cents || 0;
  const pot = bonus.met ? bonus.extra_cents || 0 : 0;

  const shares = [...byId.values()].map(person => {
    const base = bonus.met ? rate * person.days_worked : 0;
    const extra = personDays ? Math.round((pot * person.days_worked) / personDays) : 0;
    return { ...person, base_cents: base, extra_cents: extra, cents: base + extra };
  });

  return {
    shares,
    person_days: personDays,
    total_cents: shares.reduce((sum, share) => sum + share.cents, 0)
  };
}

/** Rows of (block, day, employee) -> Map(block id -> Map(day -> value)). */
function groupByBlockAndDay(rows, add) {
  const byBlock = new Map();

  for (const row of rows) {
    if (!byBlock.has(row.block_id)) byBlock.set(row.block_id, new Map());
    add(byBlock.get(row.block_id), row);
  }

  return byBlock;
}

/** The boss's unticks: Map(block id -> Map(day -> Set(employee id))). */
async function loadAbsences(db) {
  const rows = await db.prepare(`SELECT block_id, day, employee_id FROM bonus_absences`).all();

  return groupByBlockAndDay(rows.results || [], (byDay, row) => {
    if (!byDay.has(row.day)) byDay.set(row.day, new Set());
    byDay.get(row.day).add(row.employee_id);
  });
}

/** People added to a single day: Map(block id -> Map(day -> [{ id, full_name }])). */
async function loadExtras(db) {
  const rows = await db.prepare(
    `SELECT x.block_id, x.day, e.id, e.full_name
     FROM bonus_extra_days x
     JOIN employees e ON e.id = x.employee_id
     WHERE e.is_active = 1
     ORDER BY e.full_name`
  ).all();

  return groupByBlockAndDay(rows.results || [], (byDay, row) => {
    if (!byDay.has(row.day)) byDay.set(row.day, []);
    byDay.get(row.day).push({ id: row.id, full_name: row.full_name });
  });
}

/**
 * One goal as a card shows it. Last year's sales are deliberately absent, and
 * so is who else was or wasn't in.
 *
 * Every `my_` figure is the viewer's own: what they've earned, what meeting
 * the goal pays them, and what one more step adds for them. Someone who
 * didn't work the goal (the boss, looking at what staff see) gets the figures
 * of whoever worked it most, as the typical case.
 */
function staffView(block, sales, status, workers, viewerId = null) {
  const bonus = bonusFor(block, sales.cents);
  const split = sharesFor(block, workers, bonus);
  const mine = viewerId === null ? null : split.shares.find(share => share.id === viewerId) || null;

  const typical = [...split.shares].sort((a, b) => b.days_worked - a.days_worked)[0] || null;
  const shown = mine || typical;
  const days = shown ? shown.days_worked : 0;
  const stepPart = split.person_days
    ? Math.round(((block.step_bonus_cents || 0) * days) / split.person_days)
    : 0;

  return {
    id: block.id,
    kind: block.kind,
    starts_on: block.starts_on,
    ends_on: block.ends_on,
    status,
    goal_cents: block.goal_cents,
    day_rate_cents: block.day_rate_cents,
    step_size_cents: block.step_size_cents,
    step_bonus_cents: block.step_bonus_cents,
    sales_cents: sales.cents,
    sales_checked_at: sales.checked_at,
    sales_stale: sales.stale,
    bonus,
    total_cents: split.total_cents,
    on_goal: Boolean(mine),
    my_cents: shown ? shown.cents : 0,
    my_base_cents: (block.day_rate_cents || 0) * days,
    my_step_cents: stepPart,
    my_days_worked: mine ? mine.days_worked : null
  };
}

/**
 * Staff are only ever told their own amount, never a total that gets split
 * (Sam, 2026-11-21): a total makes people think it's all theirs. So the
 * totals don't leave the server for anyone but the boss.
 */
function ownAmountsOnly(view) {
  const { step_bonus_cents, total_cents, ...rest } = view;
  const { extra_cents, ...bonus } = view.bonus;
  return { ...rest, bonus };
}

/**
 * A finished goal, for staff: whether it was met and what they earned, and
 * nothing about the sales that were done (Sam, 2026-11-21).
 */
function resultOnly(view) {
  const own = ownAmountsOnly(view);
  const { sales_cents, sales_checked_at, sales_stale, ...rest } = own;
  return { ...rest, bonus: { met: own.bonus.met } };
}

/**
 * GET /api/bonus — the signed-in person's own goals. For each kind they're
 * on: the goal running now (or the next one coming), and the last finished
 * one so Monday still shows how the weekend ended.
 */
export async function handleMyBonus(request, env) {
  const auth = await requireUser(request, env);
  if (!auth.ok) return auth;

  // The boss sees every goal the way staff see it, tree and all, so they
  // know what's on their team's screens. They work no days, so they get no
  // amount of their own.
  const isBoss = auth.user.role === "boss";
  const me = auth.user.id;

  const people = await loadPeople(env.DB);
  const absences = await loadAbsences(env.DB);
  const extras = await loadExtras(env.DB);
  const blocks = await loadBlocks(env.DB);
  const now = new Date();
  const today = todayToronto(now);
  const budget = { left: MAX_REFRESHES };
  const cards = [];

  const workersOf = block =>
    workersByDay(block, people[block.kind], absences.get(block.id), extras.get(block.id));
  const workedIn = block =>
    Boolean(block) && [...workersOf(block).values()].some(list => list.some(worker => worker.id === me));

  for (const kind of KINDS) {
    const ofKind = blocks.filter(block => block.kind === kind);
    const current = ofKind.find(block => blockStatus(block, today) === "live")
      || ofKind.find(block => blockStatus(block, today) === "upcoming");
    const last = ofKind.filter(block => blockStatus(block, today) === "done").pop();

    // Someone helping out on a goal that isn't usually theirs sees it only
    // while they're down for one of its days.
    const onList = people[kind].some(person => person.id === me);
    const showCurrent = Boolean(current) && (isBoss || onList || workedIn(current));
    const showLast = Boolean(last) && (isBoss || onList || workedIn(last));

    const card = { kind, current: null, last: null };

    if (showCurrent) {
      const sales = await salesFor(env, current, today, now, budget);
      card.current = staffView(current, sales, blockStatus(current, today), workersOf(current), me);
    }

    if (showLast) {
      const sales = await salesFor(env, last, today, now, budget);
      card.last = staffView(last, sales, "done", workersOf(last), me);
    }

    if (!isBoss) {
      if (card.current) card.current = ownAmountsOnly(card.current);
      if (card.last) card.last = resultOnly(card.last);
    }

    if (card.current || card.last) cards.push(card);
  }

  return { ok: true, cards, can_manage: isBoss };
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
  const extras = await loadExtras(env.DB);
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

  // Everyone who can earn a bonus. The boss can't, so isn't offered.
  const staff = await env.DB.prepare(
    `SELECT id, full_name FROM employees
     WHERE is_active = 1 AND role != 'boss'
     ORDER BY full_name`
  ).all();

  return {
    ok: true,
    today,
    people,
    staff: staff.results || [],
    blocks: blocks.map(block => {
      const absentByDay = absences.get(block.id) || new Map();
      const workers = workersByDay(block, people[block.kind], absentByDay, extras.get(block.id));
      const view = staffView(block, salesById.get(block.id), blockStatus(block, today), workers);
      const split = sharesFor(block, workers, view.bonus);

      return {
        ...view,
        last_year_cents: block.last_year_cents,
        // Each day: the goal's regulars with whether they're ticked, then
        // anyone added for that day alone.
        days: blockDays(block).map(day => ({
          day,
          people: [
            ...people[block.kind].map(person => ({
              id: person.id,
              full_name: person.full_name,
              extra: false,
              worked: !(absentByDay.get(day)?.has(person.id))
            })),
            ...(workers.get(day) || [])
              .filter(worker => worker.extra)
              .map(worker => ({ id: worker.id, full_name: worker.full_name, extra: true, worked: true }))
          ]
        })),
        shares: split.shares
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
  const regular = people[block.kind].some(person => person.id === employeeId);

  // One of the goal's regulars: ticked by default, so store the untick.
  if (regular) {
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

  // Anyone else is being added for this day alone, or taken off it again.
  const employee = await env.DB.prepare(
    `SELECT id, role FROM employees WHERE id = ? AND is_active = 1`
  ).bind(employeeId).first();

  if (!employee || employee.role === "boss") throw new BadRequest("Pick a staff member.");

  if (body.worked) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO bonus_extra_days (block_id, day, employee_id, marked_by)
       VALUES (?, ?, ?, ?)`
    ).bind(block.id, day, employeeId, auth.user.id).run();
  } else {
    await env.DB.prepare(
      `DELETE FROM bonus_extra_days WHERE block_id = ? AND day = ? AND employee_id = ?`
    ).bind(block.id, day, employeeId).run();
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
  const dayRate = "day_rate" in body ? dollarsToCents(body.day_rate, "The pay per day") : block.day_rate_cents;
  const stepSize = "step_size" in body ? dollarsToCents(body.step_size, "The step") : block.step_size_cents;
  const stepBonus = "step_bonus" in body ? dollarsToCents(body.step_bonus, "The step bonus") : block.step_bonus_cents;

  if (dayRate === null) throw new BadRequest("The pay per day can't be blank. Use 0 for nothing.");

  await env.DB.prepare(
    `UPDATE bonus_blocks
     SET goal_cents = ?, day_rate_cents = ?, step_size_cents = ?, step_bonus_cents = ?,
         updated_by = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(goal, dayRate, stepSize ?? 0, stepBonus ?? 0, auth.user.id, block.id).run();

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
