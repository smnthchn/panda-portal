/* Sales bonus: the staff card on Home and the boss's Sales bonus page.
   The plan is docs/bonus-plan.md. */

/** How often an open screen asks again. The server keeps a figure for 100
 *  seconds, so this is what "at most two minutes behind" comes from. */
const BONUS_REFRESH_MS = 2 * 60 * 1000;

let bonusTimer = null;

/** 600000 -> "$6,000"; 7250 -> "$72.50". Cents only show when there are some. */
function bonusMoney(cents) {
  if (cents === null || cents === undefined) return "";
  const whole = cents % 100 === 0;
  return (cents / 100).toLocaleString("en-CA", {
    style: "currency",
    currency: "CAD",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2
  });
}

/** Sales are shown to the dollar; the cents are noise on a meter. */
function bonusSales(cents) {
  return bonusMoney(Math.round((cents || 0) / 100) * 100);
}

function bonusDay(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  return isNaN(d) ? isoDate : d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
}

function bonusRange(view) {
  return `${bonusDay(view.starts_on)} to ${bonusDay(view.ends_on)}`;
}

function bonusKindLabel(kind) {
  return kind === "weekend" ? "weekend" : "week";
}

/**
 * Staff are only ever told their own amount, never a total that gets split
 * (Sam, 2026-11-21): a total makes people think it's all theirs. Every
 * dollar figure on the card is the viewer's own, by the days they're down as
 * working. The boss, who's on no goal, sees the typical per-person figure.
 */
function bonusEarnedLabel(view, soFar) {
  if (view.on_goal) return soFar ? "Your bonus so far" : "Your bonus";
  return soFar ? "Bonus so far, each person" : "Bonus, each person";
}

function bonusFirstName(fullName) {
  return String(fullName || "").trim().split(/\s+/)[0] || "";
}

/**
 * The tree picture (public/bonus-tree.webp), measured once: its size, where
 * the colour starts (the foot of the trunk) and stops (just under the star),
 * and the centre of each bulb in the order the strings run down the tree.
 * A different picture needs these measured again.
 */
const BONUS_TREE = {
  src: "/bonus-tree.webp",
  w: 1172,
  h: 1367,
  // The picture's last few rows are a grey strip from a screenshot; stop above it.
  show: 1350,
  // Breathing room above the star and below the trunk (Sam, 2026-11-21).
  pad: 70,
  top: 205,
  bottom: 1320,
  star: [575, 110],
  bulbs: [
    [686, 346], [611, 401], [508, 446], [410, 460],
    [393, 580], [494, 620], [592, 651], [696, 666], [805, 661],
    [827, 755], [740, 804], [628, 844], [508, 870], [380, 874], [267, 849],
    [259, 999], [374, 1045], [494, 1077], [610, 1091], [725, 1089], [828, 1063], [920, 1020]
  ]
};

/** Lights per step past the goal: a $500 step is five $100 lights. */
const BONUS_LIGHTS_PER_STEP = 5;

/**
 * The meter: one picture of a Christmas tree, drawn three ways at once.
 *
 *  - Washed out everywhere, as the "not there yet" tree.
 *  - In full colour from the foot up to how far sales have got toward the
 *    goal. At the goal the whole picture is in colour, star included.
 *  - Each bulb washed back to white until sales pass it. Past the goal a
 *    bulb is one fifth of a step, so they come on one at a time.
 *
 * It sits on its own white panel in every theme, because the picture has a
 * white background.
 */
function bonusMeterHtml(view) {
  if (!view.goal_cents) return "";

  const T = BONUS_TREE;
  const id = `bonusTree${view.id}`;
  const sales = view.sales_cents || 0;
  const goal = view.goal_cents;
  const met = sales >= goal;
  const frac = Math.max(0, Math.min(1, sales / goal));
  const fillY = T.bottom - frac * (T.bottom - T.top);

  const lightWorth = view.step_size_cents > 0 ? view.step_size_cents / BONUS_LIGHTS_PER_STEP : 0;
  const lit = met && lightWorth ? Math.min(T.bulbs.length, Math.floor((sales - goal) / lightWorth)) : 0;
  const unlit = T.bulbs.slice(lit);

  // A mark every $1,000 up the side, or every $2,000 once the goal is big
  // enough that they'd crowd.
  const markEvery = goal > 800000 ? 200000 : 100000;
  const marks = [];
  for (let amount = markEvery; amount < goal - markEvery / 4; amount += markEvery) {
    const y = T.bottom - (amount / goal) * (T.bottom - T.top);
    marks.push(`
      <line x1="-24" y1="${y.toFixed(0)}" x2="70" y2="${y.toFixed(0)}" class="bonus-tree-tick" />
      <text x="-34" y="${(y + 15).toFixed(0)}" text-anchor="end"
            class="bonus-tree-mark${sales >= amount ? " passed" : ""}">${esc(bonusMoney(amount))}</text>
    `);
  }

  const image = (attrs) =>
    `<image href="${T.src}" x="0" y="0" width="${T.w}" height="${T.h}" ${attrs} />`;

  return `
    <svg class="bonus-tree" viewBox="-230 ${-T.pad} ${T.w + 230} ${T.show + 2 * T.pad}" role="img"
         aria-label="${esc(`${bonusSales(sales)} of a ${bonusMoney(goal)} goal`)}">
      <defs>
        <filter id="${id}Wash" color-interpolation-filters="sRGB">
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="linear" slope="0.45" intercept="0.55" />
            <feFuncG type="linear" slope="0.45" intercept="0.55" />
            <feFuncB type="linear" slope="0.45" intercept="0.55" />
          </feComponentTransfer>
        </filter>
        <filter id="${id}Bulb" color-interpolation-filters="sRGB">
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncR type="linear" slope="0.22" intercept="0.78" />
            <feFuncG type="linear" slope="0.22" intercept="0.78" />
            <feFuncB type="linear" slope="0.22" intercept="0.78" />
          </feComponentTransfer>
        </filter>
        <radialGradient id="${id}Soft">
          <stop offset="0.5" stop-color="#fff" />
          <stop offset="1" stop-color="#fff" stop-opacity="0" />
        </radialGradient>
        <radialGradient id="${id}Glow">
          <stop offset="0" stop-color="#FFD54F" stop-opacity="0.55" />
          <stop offset="1" stop-color="#FFD54F" stop-opacity="0" />
        </radialGradient>
        <clipPath id="${id}Fill">
          <rect x="0" y="${met ? 0 : fillY.toFixed(0)}" width="${T.w}" height="${T.h}" />
        </clipPath>
        <clipPath id="${id}Crop">
          <rect x="0" y="0" width="${T.w}" height="${T.show}" />
        </clipPath>
        <mask id="${id}Unlit" maskUnits="userSpaceOnUse" x="0" y="0" width="${T.w}" height="${T.h}">
          ${unlit.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="46" fill="url(#${id}Soft)" />`).join("")}
        </mask>
      </defs>

      <g clip-path="url(#${id}Crop)">
        ${image(`filter="url(#${id}Wash)"`)}
        ${sales > 0 ? image(`clip-path="url(#${id}Fill)"`) : ""}
        ${unlit.length ? image(`filter="url(#${id}Bulb)" mask="url(#${id}Unlit)"`) : ""}
      </g>
      ${met ? `<circle cx="${T.star[0]}" cy="${T.star[1]}" r="230" fill="url(#${id}Glow)" />` : ""}

      ${marks.join("")}
      <text x="${T.star[0] + 150}" y="${T.star[1] + 16}" class="bonus-tree-mark passed">Goal ${esc(bonusMoney(goal))}</text>
    </svg>
  `;
}

/** What the goal pays, in one sentence, for a goal that hasn't been met. */
function bonusRuleText(view) {
  // Someone unticked for every day of the goal has nothing to earn on it.
  if (view.on_goal && !view.my_base_cents) {
    return "You aren't down as working on these days, so this goal has no bonus for you.";
  }

  // Sam's wording (2026-11-21), in the tree's own terms. Both amounts are the
  // viewer's own.
  const base = `Fill the tree all the way to the star and receive a ${bonusMoney(view.my_base_cents)} bonus!`;
  const step = view.step_size_cents > 0 && view.my_step_cents > 0
    ? ` Then for every ${BONUS_LIGHTS_PER_STEP} Christmas lights you light up, you'll get an additional ${bonusMoney(view.my_step_cents)} bonus.`
    : "";
  return base + step;
}

/** The line under the meter: how far to the goal, or what's been earned. */
function bonusProgressText(view) {
  const bonus = view.bonus;

  if (!bonus.met) {
    return `${bonusSales(bonus.to_goal_cents)} to go to the goal.`;
  }

  const earned = `Goal met! ${bonusEarnedLabel(view, true)}: ${bonusMoney(view.my_cents)}.`;
  const next = bonus.to_next_cents && view.my_step_cents > 0
    ? ` ${bonusSales(bonus.to_next_cents)} more in sales adds another ${bonusMoney(view.my_step_cents)}.`
    : "";
  return earned + next;
}

function bonusCurrentHtml(view) {
  if (!view.goal_cents) {
    return `
      <div class="bonus-big">Goal not set yet</div>
      <div class="meta" style="margin-top:4px;">${esc(bonusRange(view))}. It will show here once it is set.</div>
    `;
  }

  if (view.status === "upcoming") {
    return `
      <div class="kicker bonus-kicker">NEXT GOAL · ${esc(bonusRange(view).toUpperCase())}</div>
      <div class="bonus-big">${esc(bonusMoney(view.goal_cents))}</div>
      <div class="meta" style="margin-top:4px;">in-store sales, before tax</div>
      ${bonusMeterHtml(view)}
      <div class="bonus-line">${esc(bonusRuleText(view))}</div>
    `;
  }

  return `
    <div class="kicker bonus-kicker">IN-STORE SALES SO FAR</div>
    <div class="bonus-big">${esc(bonusSales(view.sales_cents))}</div>
    ${bonusMeterHtml(view)}
    <div class="bonus-line${view.bonus.met ? " met" : ""}">${esc(bonusProgressText(view))}</div>
    ${view.bonus.met ? "" : `<div class="meta" style="margin-top:6px;">${esc(bonusRuleText(view))}</div>`}
    ${view.sales_stale ? `<div class="meta" style="margin-top:6px;">Couldn't reach Shopify just now. This is the last figure we had.</div>` : ""}
  `;
}

function bonusLastHtml(view) {
  if (!view.goal_cents || view.sales_cents === null) return "";

  const result = view.bonus.met
    ? `Goal met. ${bonusEarnedLabel(view, false)}: ${bonusMoney(view.my_cents)}.`
    : `Goal not met, ${bonusSales(view.bonus.to_goal_cents)} short.`;

  return `
    <div class="bonus-last">
      <b>Last ${esc(bonusKindLabel(view.kind))}</b> (${esc(bonusRange(view))}):
      ${esc(bonusSales(view.sales_cents))} of ${esc(bonusMoney(view.goal_cents))}. ${esc(result)}
    </div>
  `;
}

/**
 * One goal's card. `canManage` is the boss looking at what staff see: the
 * same card, plus a way through to the page where goals are set.
 */
function bonusCardHtml(card, canManage = false) {
  const current = card.current;
  const title = card.kind === "weekend" ? "WEEKEND SALES BONUS" : "WEEKDAY SALES BONUS";

  return `
    <div class="card stripped bonus-card">
      <div class="strip warm">
        ${title}
        ${current && current.status === "live" ? `<span class="strip-side">${esc(bonusRange(current))}</span>` : ""}
      </div>
      <div class="card-body">
        ${current ? bonusCurrentHtml(current) : `<div class="meta">No more goals coming up.</div>`}
        ${card.last ? bonusLastHtml(card.last) : ""}
        ${canManage ? `
          <div class="bonus-manage">
            <span class="meta">This is what staff on this goal see.</span>
            <button class="btn-quiet" data-bonus-manage>Goals and who worked</button>
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

/**
 * Fills the Home screen's bonus slot and keeps it fresh. People who aren't on
 * a goal get nothing back, so the slot stays empty and no timer starts.
 */
async function loadBonusSlot() {
  if (!document.getElementById("bonusSlot")) {
    clearInterval(bonusTimer);
    bonusTimer = null;
    return;
  }

  const data = await api("/api/bonus").catch(() => null);

  // The page may have been redrawn, or left, while that was in the air.
  const slot = document.getElementById("bonusSlot");
  if (!slot || !data?.ok) return;

  slot.innerHTML = data.cards.map(card => bonusCardHtml(card, data.can_manage)).join("");

  slot.querySelectorAll("[data-bonus-manage]").forEach(btn => {
    btn.onclick = () => goToView("sales-bonus");
  });

  if (data.cards.length && !bonusTimer) {
    bonusTimer = setInterval(loadBonusSlot, BONUS_REFRESH_MS);
  }
}

/* ---------- Boss: Sales bonus page ---------- */

let bonusAdminTimer = null;
let bonusAdminDirty = false;

function bonusStatusPill(status) {
  if (status === "live") return `<span class="pill pill-go">Running</span>`;
  if (status === "done") return `<span class="pill pill-ink">Finished</span>`;
  return `<span class="pill">Coming up</span>`;
}

/** Dollars for an input: "6000", or "" when there's no goal yet. */
function bonusInputValue(cents) {
  if (cents === null || cents === undefined) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/**
 * One tick box per person per day. Everyone starts ticked; the boss unticks
 * a day someone was off, and that day's share goes to whoever did work.
 */
function bonusWorkedCell(block, people) {
  if (!people.length) return `<span class="meta">Nobody on this goal</span>`;

  return block.day_list.map(day => {
    const away = block.absent[day] || [];
    const name = new Date(`${day}T00:00:00`).toLocaleDateString("en-CA", { weekday: "short" });

    return `
      <div class="bonus-day">
        <span class="bonus-day-name">${esc(name)}</span>
        ${people.map(person => `
          <label class="bonus-tick">
            <input type="checkbox" data-bonus-worked data-block="${block.id}"
                   data-day="${esc(day)}" data-person="${person.id}"
                   ${away.includes(person.id) ? "" : "checked"} />
            ${esc(bonusFirstName(person.full_name))}
          </label>
        `).join("")}
      </div>
    `;
  }).join("");
}

function bonusAdminRow(block, data) {
  const shares = block.shares.length > 1 || block.shares.some(share => share.cents !== block.bonus.total_cents)
    ? block.shares.map(share =>
        `<div class="meta">${esc(bonusFirstName(share.full_name))} ${esc(bonusMoney(share.cents))}</div>`
      ).join("")
    : "";
  const unpaid = block.unpaid_cents > 0
    ? `<div class="meta">${esc(bonusMoney(block.unpaid_cents))} not paid, nobody worked</div>`
    : "";
  const earned = block.bonus.met
    ? `${bonusMoney(block.bonus.total_cents)}${shares}${unpaid}`
    : block.status === "upcoming" || !block.goal_cents ? "" : "$0";

  return `
    <tr data-bonus-row="${block.id}">
      <td>
        <b>${esc(bonusRange(block))}</b>
        <div class="meta">${block.kind === "weekend" ? "Weekend" : "Weekdays"}</div>
      </td>
      <td>${bonusStatusPill(block.status)}</td>
      <td class="right">${block.last_year_cents === null ? "" : esc(bonusSales(block.last_year_cents))}</td>
      <td>
        <input class="bonus-input" inputmode="decimal" placeholder="Not set"
               data-bonus-goal value="${esc(bonusInputValue(block.goal_cents))}"
               aria-label="Goal for ${esc(bonusRange(block))}" />
      </td>
      <td>
        <input class="bonus-input" inputmode="decimal"
               data-bonus-base value="${esc(bonusInputValue(block.base_cents))}"
               aria-label="What ${esc(bonusRange(block))} pays" />
      </td>
      <td>${bonusWorkedCell(block, data.people[block.kind])}</td>
      <td class="right">${block.sales_cents === null ? "" : esc(bonusSales(block.sales_cents))}</td>
      <td class="right">${earned}</td>
      <td><button class="btn-quiet" data-bonus-save="${block.id}">Save</button></td>
    </tr>
  `;
}

function bonusPeopleCard(data) {
  const group = (kind, title) => `
    <div class="bonus-people-group" data-bonus-people="${kind}">
      <h4>${title}</h4>
      ${data.staff.map(person => `
        <label class="bonus-person">
          <input type="checkbox" value="${person.id}"
                 ${data.people[kind].some(p => p.id === person.id) ? "checked" : ""} />
          ${esc(person.full_name)}
        </label>
      `).join("")}
      <button class="btn-quiet" data-bonus-people-save="${kind}">Save</button>
    </div>
  `;

  return `
    <div class="card stripped">
      <div class="strip">WHO SHARES EACH GOAL</div>
      <div class="card-body">
        <p class="meta" style="margin-top:0;">The people ticked here are on the goal and see it on their Home screen. Each day's share goes to whoever worked that day.</p>
        <div class="bonus-people">
          ${group("weekday", "Monday to Friday")}
          ${group("weekend", "Saturday and Sunday")}
        </div>
      </div>
    </div>
  `;
}

async function renderSalesBonus(pushState = true) {
  if (pushState) pushPageState("sales-bonus");

  const data = await api("/api/admin/bonus");

  if (!data.ok) {
    renderError(data.error || "Could not load the sales bonus");
    return;
  }

  const first = data.blocks[0];
  const stepNote = first && first.step_size_cents > 0 && first.step_bonus_cents > 0
    ? `Past the goal, every extra ${bonusMoney(first.step_size_cents)} adds ${bonusMoney(first.step_bonus_cents)}.`
    : "";

  pageArea().innerHTML = `
    <div id="bonusAdmin">
      <div class="page-header">
        <h2>Sales bonus</h2>
        <p>In-store sales at Markham, before tax, after discounts and refunds.</p>
      </div>

      <div class="card stripped">
        <div class="strip warm">GOALS <span class="strip-side">Only you see 2025 sales</span></div>
        <div class="card-body">
          <div class="table-scroll">
            <table class="grid-table bonus-table">
              <thead>
                <tr>
                  <th>Dates</th>
                  <th></th>
                  <th class="right">2025 sales</th>
                  <th>Goal ($)</th>
                  <th>Pays ($)</th>
                  <th>Who worked</th>
                  <th class="right">Sales so far</th>
                  <th class="right">Bonus</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>${data.blocks.map(block => bonusAdminRow(block, data)).join("")}</tbody>
            </table>
          </div>
          <p class="meta">
            <b>Who worked:</b> everyone is ticked as working. Untick a day someone was off.
            That day's share then goes to whoever did work. It saves as you tick.
          </p>
          <p class="meta">
            "Pays" is the whole amount when the goal is met, before it is shared. ${esc(stepNote)}
            Leave a goal blank and staff see "Goal not set yet".
          </p>
          <div id="bonusAdminError" class="form-error" style="display:none;"></div>
        </div>
      </div>

      ${bonusPeopleCard(data)}
    </div>
  `;

  markActiveNav("sales-bonus", { wide: true });
  bonusAdminDirty = false;

  pageArea().querySelectorAll(".bonus-input, .bonus-person input").forEach(input => {
    input.oninput = () => { bonusAdminDirty = true; };
  });

  pageArea().querySelectorAll("[data-bonus-save]").forEach(btn => {
    btn.onclick = async () => {
      const row = btn.closest("[data-bonus-row]");
      btn.disabled = true;

      const result = await apiSend(`/api/admin/bonus/blocks/${btn.dataset.bonusSave}`, "PUT", {
        goal: row.querySelector("[data-bonus-goal]").value,
        base: row.querySelector("[data-bonus-base]").value
      });

      if (!result.ok) {
        showFormError("bonusAdminError", result.error || "That didn't save.");
        btn.disabled = false;
        return;
      }

      await renderSalesBonus(false);
    };
  });

  pageArea().querySelectorAll("[data-bonus-worked]").forEach(box => {
    box.onchange = async () => {
      box.disabled = true;

      const result = await apiSend(`/api/admin/bonus/blocks/${box.dataset.block}/attendance`, "PUT", {
        day: box.dataset.day,
        employee_id: Number(box.dataset.person),
        worked: box.checked
      });

      if (!result.ok) {
        box.checked = !box.checked;
        box.disabled = false;
        showFormError("bonusAdminError", result.error || "That didn't save.");
        return;
      }

      // A goal or pay being typed elsewhere on the page stays as it is; the
      // shares catch up on the next save or refresh.
      if (bonusAdminDirty) {
        box.disabled = false;
        return;
      }

      await renderSalesBonus(false);
    };
  });

  pageArea().querySelectorAll("[data-bonus-people-save]").forEach(btn => {
    btn.onclick = async () => {
      const kind = btn.dataset.bonusPeopleSave;
      const group = pageArea().querySelector(`[data-bonus-people="${kind}"]`);
      btn.disabled = true;

      const result = await apiSend("/api/admin/bonus/people", "PUT", {
        kind,
        employee_ids: [...group.querySelectorAll("input:checked")].map(input => Number(input.value))
      });

      if (!result.ok) {
        showFormError("bonusAdminError", result.error || "That didn't save.");
        btn.disabled = false;
        return;
      }

      await renderSalesBonus(false);
    };
  });

  // Keep the sales column moving, but never redraw over something half typed.
  if (!bonusAdminTimer) {
    bonusAdminTimer = setInterval(() => {
      if (!document.getElementById("bonusAdmin")) {
        clearInterval(bonusAdminTimer);
        bonusAdminTimer = null;
        return;
      }
      if (!bonusAdminDirty) guard(() => renderSalesBonus(false));
    }, BONUS_REFRESH_MS);
  }
}
