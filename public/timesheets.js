/* ---------- Timesheets (boss) ---------- */

/*
 * Pay periods, flags, approval and the Excel export. The server decides the
 * period, which shifts are in it and what's flagged (in Toronto time), because
 * approval locks it — this file only draws the answer and sends decisions back.
 *
 * Uses shiftRow(), timeOf() and openFixEditor() from app.js; this file loads
 * first but only calls them at run time.
 */

let tsDate = null;      // any date inside the period being shown; null = today's
let tsData = null;      // the last /api/admin/timesheets answer
let teamFixList = [];   // row index -> the shift its fix editor opens
const tsCollapsed = new Set(); // people folded down to their totals; kept across redraws
let tsDetails = [];     // row index -> the notes and flag details shown when it's tapped

const TS_STATUS = {
  approved: { label: "APPROVED", cls: "pill-go" },
  ready: { label: "READY", cls: "pill-paper" },
  flagged: { label: "NEEDS A LOOK", cls: "pill-warm" },
  changed: { label: "CHANGED", cls: "pill-late" }
};

/** "Sep 16 – 30, 2026", or across a year end in full. */
function periodLabel(period) {
  const s = new Date(`${period.start}T00:00:00`);
  const e = new Date(`${period.end}T00:00:00`);
  const month = d => d.toLocaleDateString(undefined, { month: "short" });
  return `${month(s)} ${s.getDate()} – ${e.getDate()}, ${e.getFullYear()}`;
}

const hoursDecimal = minutes => Math.round((minutes / 60) * 100) / 100;

function renderTimesheets(history) {
  const ownShifts = history.ok ? history.shifts : [];

  pageArea().innerHTML = `
    <div class="page-header">
      <h2>Timesheets</h2>
      <p>Pay periods run the 1st to the 15th and the 16th to month end</p>
    </div>

    <div class="inline-form" style="margin:0 0 13px; align-items:center;">
      <button class="btn-quiet" id="tsPrevBtn">‹</button>
      <div id="tsPeriodLabel" style="flex:1; text-align:center; font-family:'Fredoka',sans-serif; font-weight:600; font-size:14px;">…</div>
      <button class="btn-quiet" id="tsNextBtn">›</button>
    </div>

    <div id="tsSummary"></div>
    <p class="form-error" id="reportError"></p>
    <div id="reportArea"><p class="meta">Loading…</p></div>

    ${ownShifts.length ? myHoursCard(ownShifts) : ""}
  `;

  markActiveNav("clock", { wide: true });

  document.getElementById("tsPrevBtn").onclick = () => {
    if (!tsData) return;
    tsDate = tsData.previous.start;
    guard(loadTeamHours);
  };
  document.getElementById("tsNextBtn").onclick = () => {
    if (!tsData) return;
    tsDate = tsData.next.start;
    guard(loadTeamHours);
  };

  guard(loadTeamHours);
}

/** Loads and draws the period. Named for the fix editor, which calls it after a save. */
async function loadTeamHours() {
  showFormError("reportError", "");
  const query = tsDate ? `?date=${encodeURIComponent(tsDate)}` : "";
  const result = await api(`/api/admin/timesheets${query}`);

  if (!result.ok) {
    showFormError("reportError", result.error || "Could not load the timesheets.");
    return;
  }

  tsData = result;
  tsDate = result.period.start;
  drawTimesheets();
}

function drawTimesheets() {
  const { period, people, today, stat_holidays: stats } = tsData;
  const isCurrent = today >= period.start && today <= period.end;

  document.getElementById("tsPeriodLabel").innerHTML =
    `${esc(periodLabel(period))}${isCurrent ? ` <span class="meta">· this period</span>` : ""}`;

  const count = status => people.filter(p => p.status === status).length;
  const ready = count("ready");
  const flagged = count("flagged");
  const totalMinutes = people.reduce((sum, p) => sum + p.total_minutes, 0);

  document.getElementById("tsSummary").innerHTML = `
    <div class="card stripped">
      <div class="strip">THIS PERIOD<span class="strip-side">${esc(formatMinutes(totalMinutes))} total</span></div>
      <div class="card-body">
        <div class="badge-row">
          <span class="pill pill-go">${count("approved")} APPROVED</span>
          <span class="pill pill-paper">${ready} READY</span>
          ${flagged ? `<span class="pill pill-paper">${tsFlagIcon("Has flags")} ${flagged} FLAGGED</span>` : ""}
          ${count("changed") ? `<span class="pill pill-late">${count("changed")} CHANGED</span>` : ""}
        </div>
        ${stats.length ? `<p class="meta">Stat holiday${stats.length > 1 ? "s" : ""}: ${stats.map(h => `${esc(h.name)} (${esc(formatDate(h.date))})`).join(", ")}. Hours worked on ${stats.length > 1 ? "them" : "it"} are counted separately in the export.</p>` : ""}
        ${isCurrent ? `<p class="meta">This period is still running. Approve once everyone's last shift is in.</p>` : ""}
        <div class="button-row">
          <button class="btn-go" id="tsApproveAllBtn" ${ready ? "" : "disabled"}>Approve everyone ready${ready ? ` (${ready})` : ""}</button>
          <button class="btn-quiet" id="tsExportBtn" ${people.length ? "" : "disabled"}>Export to Excel</button>
          ${people.length ? `<button class="btn-quiet" id="tsCollapseAllBtn">${people.every(p => tsCollapsed.has(p.id)) ? "Show all shifts" : "Totals only"}</button>` : ""}
        </div>
        <p class="form-error" id="tsSummaryError"></p>
      </div>
    </div>
  `;

  teamFixList = [];
  tsDetails = [];

  document.getElementById("reportArea").innerHTML = people.length
    ? `
      <div class="card ts-card">
        <div class="ts-scroll">
          <table class="ts-table">
            <thead>
              <tr><th>Date</th><th>Shift</th><th>Break</th><th class="ts-num">Hours</th><th></th></tr>
            </thead>
            ${people.map(personRows).join("")}
            ${grandTotalRow(people)}
          </table>
        </div>
      </div>
      <p class="meta">Tap a shift to see its notes and fix its punches. Tick a row once you've looked at it, so you can stop and pick up where you left off; ticking a red row marks it fine. Approve all ticks everything for that person. Tap a name to fold them down to their total.</p>`
    : `<p class="empty-state">Nobody worked or was scheduled in this period.</p>`;

  wireTimesheets();
}

/* Row icons, drawn at the end of each row. */
const tsFlagIcon = title => `<span class="ts-ico ts-ico-flag" title="${esc(title)}">!</span>`;
const TS_NOTE_ICON = `<span class="ts-ico ts-ico-note" title="Has a note"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.5h10a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H7l-3.5 3v-3H3A1.5 1.5 0 0 1 1.5 10V4A1.5 1.5 0 0 1 3 2.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></span>`;
const TS_CHECK_SVG = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** "Thu, Sep 17": the period already says the year. */
function tsDay(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** An open flag is one still to deal with; a running shift isn't a problem. */
const isOpenFlag = f => !f.dismissed && f.type !== "working";

/** The server sends a no-show's shift id rather than its words; its times are already in the row. */
function flagDetail(person, f) {
  if (f.type === "holiday_check") {
    return (f.detail || "").replace(/\d{4}-\d{2}-\d{2}/g, d => formatDate(d));
  }
  if (f.type !== "no_show") return f.detail || "";
  const shift = person.no_shows.find(n => `no_show:${n.id}` === f.key);
  return shift ? shift.title : "";
}

/** What the staff member said about a flag, and their time as a one-tap fix. */
function responseHtml(person, f) {
  const r = f.response;
  if (!r) return "";
  const first = person.full_name.split(" ")[0];
  const time = r.suggested_at ? ` · says ${f.type === "open_break" ? "the break ended" : "they left"} at ${timeOf(r.suggested_at)}` : "";
  // Only a flag still to be fixed gets the button, and only on hours that can be edited.
  const canUse = r.suggested_at && !f.dismissed && !person.approval
    && ["no_clock_out", "open_break", "long_shift"].includes(f.type);
  return `
    <div class="ts-item">
      <span>💬 ${esc(first)}: “${esc(r.note)}”${esc(time)}</span>
      ${canUse ? `<button class="btn-go ts-mini" data-use-time="${esc(f.key)}" data-person="${person.id}">Use ${esc(timeOf(r.suggested_at))}</button>` : ""}
    </div>
  `;
}

/** One flag in a row's detail, opened by tapping the row. */
function flagDetailHtml(person, f) {
  if (f.type === "working") return `<div class="ts-item meta">Still clocked in. Can't approve until they clock out.</div>`;
  const detail = flagDetail(person, f);
  if (f.dismissed) {
    const label = f.kind === "decide"
      ? `${f.label.replace(": may not qualify", "")}: ${f.dismissed.outcome === "counts" ? "counts" : "doesn't count"}`
      : f.label;
    const undo = f.kind === "decide" && !person.approval
      ? `<button class="btn-quiet ts-mini" data-undismiss="${esc(f.key)}" data-person="${person.id}">Undo</button>`
      : "";
    return `
      <div class="ts-item ts-item-done">
        <span>✓ ${esc(label)}${detail ? ` · ${esc(detail)}` : ""} <span class="meta">(${esc(f.dismissed.reason)}, ${esc(f.dismissed.by)})</span></span>
        ${undo}
      </div>
      ${responseHtml(person, f)}
    `;
  }
  const actions = f.kind === "decide" && !person.approval
    ? `<button class="btn-go ts-mini" data-decide="counts" data-key="${esc(f.key)}" data-person="${person.id}">Counts</button>
       <button class="btn-quiet ts-mini" data-decide="not" data-key="${esc(f.key)}" data-person="${person.id}">Doesn't count</button>`
    : "";
  return `
    <div class="ts-item">
      <span>${tsFlagIcon(f.label)}<strong>${esc(f.label)}</strong>${detail ? ` <span class="meta">· ${esc(detail)}</span>` : ""}</span>
      ${actions}
    </div>
    ${responseHtml(person, f)}
  `;
}

/**
 * Staff answers about a shift whose flag has since been fixed. An answer on a
 * flag that's still open already shows on the flag, so it isn't repeated.
 */
function staffNotes(person, shift) {
  const openKeys = new Set(person.flags.map(f => f.key));
  return shift.staff_notes.filter(n => !openKeys.has(`${n.flag_type}:${shift.in_at}`));
}

/** Why a row can't be ticked yet; the server holds the same rule (tickBlocker()). */
function tickBlocker(flags) {
  const open = flags.filter(f => !f.dismissed);
  if (open.some(f => f.kind === "fix")) return "Fix the punches first";
  if (open.some(f => f.kind === "wait")) return "Still clocked in";
  if (open.some(f => f.kind === "decide")) return "Decide Counts or Doesn't count first";
  return null;
}

/**
 * The icons at the end of a row: a red ! while a flag is open, a note when
 * there's something written down, and the tick. The tick is the boss's
 * bookmark, "I've looked at this one", saved so a review can be paused and
 * picked up again; ticking a flagged row also marks its flags fine.
 */
function rowIcons(person, flags, hasNote, rowKey) {
  const open = flags.filter(isOpenFlag);
  const ticked = person.ticks[rowKey];
  const blocked = !ticked && tickBlocker(flags);
  const title = person.approval
    ? "Approved"
    : ticked
      ? `Ticked by ${ticked.by}. Tap to untick.`
      : blocked || (open.length ? "Tick to mark it fine" : "Tick when you've looked at it");
  return `
    <td class="ts-icons">
      ${open.length ? tsFlagIcon(open.map(f => f.label).join(", ")) : ""}
      ${hasNote ? TS_NOTE_ICON : ""}
      <button class="ts-check${ticked ? " on" : ""}" data-tick="${person.id}" data-row="${esc(rowKey)}"
        title="${esc(title)}" ${person.approval || blocked ? "disabled" : ""}>${TS_CHECK_SVG}</button>
    </td>
  `;
}

/**
 * One row: light red while it has a flag to deal with. Its notes and flag
 * details are kept in tsDetails and shown when the row is tapped.
 */
function tsRow({ person, date, flags, cells, fixIndex, detail, hasNote, rowKey }) {
  const open = flags.some(isOpenFlag);
  const detailIndex = tsDetails.push(detail) - 1;
  const cls = [open ? "ts-flagged" : "", fixIndex !== null || detail ? "row-fix" : ""].filter(Boolean).join(" ");
  return `
    <tr class="ts-shift ${cls}" data-detail="${detailIndex}" ${fixIndex !== null ? `data-fix="${fixIndex}"` : ""}>
      <td class="ts-date">${esc(tsDay(date))}</td>
      ${cells}
      ${rowIcons(person, flags, hasNote, rowKey)}
    </tr>
  `;
}

/**
 * One person: a name row, a row per shift (plus no-shows and holiday checks,
 * in date order), and their totals. Folded, only the totals row shows.
 */
function personRows(person) {
  const status = TS_STATUS[person.status];
  const locked = person.status === "approved" || person.status === "changed";
  const open = person.flags.some(isOpenFlag);
  const collapsed = tsCollapsed.has(person.id);
  const first = person.full_name.split(" ")[0];

  const items = [];

  for (const shift of person.shifts) {
    const notes = staffNotes(person, shift);
    const hasNote = notes.length > 0 || shift.flags.some(f => f.response || (f.dismissed && f.dismissed.reason !== "Checked"));
    const detail = [
      ...shift.flags.map(f => flagDetailHtml(person, f)),
      ...notes.map(n => `<div class="ts-item">💬 ${esc(first)}: “${esc(n.note)}”${n.suggested_at ? ` (said ${esc(timeOf(n.suggested_at))})` : ""}</div>`),
      shift.stat_holiday ? `<div class="ts-item meta">${esc(shift.stat_holiday)}: worked the holiday, so these are premium pay hours.</div>` : "",
      shift.fixes.length ? `<div class="ts-item meta">Corrections: ${esc(shift.fixes.join("; "))}</div>` : ""
    ].join("");

    // A running shift isn't a mistake to fix, and approved hours are locked.
    const working = shift.flags.some(f => f.type === "working");
    let fixIndex = null;
    if (!working && !locked) {
      teamFixList.push({ employee_id: person.id, in_at: shift.in_at, out_at: shift.out_at, breaks: shift.breaks || [], flags: shift.flags, detailHtml: detail });
      fixIndex = teamFixList.length - 1;
    }
    const time = shift.out_at
      ? `${timeOf(shift.in_at)} – ${timeOf(shift.out_at)}`
      : `${timeOf(shift.in_at)} –`;
    const hours = shift.out_at
      ? formatMinutes(shift.net_minutes)
      : working ? "Working" : "No clock-out";
    items.push({
      sort: shift.in_at,
      html: tsRow({
        person,
        date: shift.date,
        flags: shift.flags,
        fixIndex,
        detail,
        hasNote,
        rowKey: `shift:${shift.in_at}`,
        cells: `
          <td>${esc(time)}</td>
          <td>${shift.break_minutes ? esc(formatMinutes(shift.break_minutes)) : ""}</td>
          <td class="ts-num">${esc(hours)}</td>
        `
      })
    });
  }

  for (const n of person.no_shows) {
    const found = person.flags.find(x => x.key === `no_show:${n.id}`);
    const f = found ? { ...found, label: "No punches" } : null;
    items.push({
      sort: `${n.date} ${n.starts_at}`,
      html: tsRow({
        person,
        date: n.date,
        flags: f ? [f] : [],
        fixIndex: null,
        detail: f ? flagDetailHtml(person, f) : "",
        hasNote: !!(f && (f.response || (f.dismissed && f.dismissed.reason !== "Checked"))),
        rowKey: `no_show:${n.id}`,
        cells: `
          <td class="meta">${esc(formatTime(n.starts_at))} – ${esc(formatTime(n.ends_at))} scheduled</td>
          <td></td>
          <td class="ts-num">0h</td>
        `
      })
    });
  }

  for (const f of person.flags.filter(x => x.type === "holiday_check")) {
    items.push({
      sort: `${f.date} 99`,
      html: tsRow({
        person,
        date: f.date,
        flags: [f],
        fixIndex: null,
        detail: flagDetailHtml(person, f),
        hasNote: false,
        rowKey: `holiday:${f.date}`,
        cells: `<td colspan="3" class="meta">Stat holiday: does it count?</td>`
      })
    });
  }

  items.sort((a, b) => a.sort.localeCompare(b.sort));

  const chevron = `<span class="ts-chevron">${collapsed ? "▸" : "▾"}</span>`;
  // Approved hours that moved underneath the approval are said on the name row.
  const changed = person.flags.filter(f => f.type === "changed");
  const approvedBy = person.approval ? `Approved by ${person.approval.by}, ${formatDateTime(person.approval.at)}` : "";
  const pill = person.status === "flagged"
    ? ""
    : `<span class="pill ${status.cls}"${approvedBy ? ` title="${esc(approvedBy)}"` : ""}>${status.label}</span>`;

  const nameRow = `
    <tr class="ts-name-row" data-toggle="${person.id}">
      <td colspan="5">
        ${chevron}<strong>${esc(person.full_name)}</strong>
        <span class="meta">· ${esc(person.role)}</span>
        <span class="ts-badge">${pill}</span>
        ${changed.map(f => `<div class="ts-item meta">${esc(f.detail || f.label)}</div>`).join("")}
      </td>
    </tr>
  `;

  const action = person.approval
    ? `<button class="btn-quiet ts-mini" data-unlock="${person.id}" title="${esc(approvedBy)}">Unlock</button>`
    : `<button class="btn-go ts-mini" data-approve="${person.id}" ${person.flags.some(f => !f.dismissed && f.kind !== "check") ? `disabled title="Sort out the red rows without a tick first"` : ""}>Approve all</button>`;

  const totalRow = `
    <tr class="ts-total-row" data-toggle="${person.id}">
      <td colspan="2">
        ${collapsed ? `${chevron}<strong>${esc(person.full_name)}</strong>` : `<strong>${esc(first)}'s total</strong>`}
        <span class="meta">· ${person.days_worked} day${person.days_worked === 1 ? "" : "s"}</span>
        ${collapsed ? ` ${pill}` : ""}
        ${breakdownHtml(person)}
        <p class="form-error" id="tsError${person.id}"></p>
      </td>
      <td>${person.break_minutes ? esc(formatMinutes(person.break_minutes)) : ""}</td>
      <td class="ts-num">${esc(formatMinutes(person.total_minutes))}</td>
      <td class="ts-icons">${collapsed && open ? tsFlagIcon("Has flags") : ""}${action}</td>
    </tr>
  `;

  return `
    <tbody class="ts-group${collapsed ? " ts-collapsed" : ""}">
      ${collapsed ? "" : nameRow + items.map(i => i.html).join("")}
      ${totalRow}
    </tbody>
  `;
}

/** The hours that make up a person's total, when there's more than worked time. */
function breakdownHtml(person) {
  const lines = [];
  if (person.premium_minutes || person.holidays.length) {
    lines.push(`Regular ${formatMinutes(person.regular_minutes)}`);
    if (person.premium_minutes) lines.push(`premium pay (worked the holiday) ${formatMinutes(person.premium_minutes)}`);
    if (person.holiday_minutes) lines.push(`stat holiday ${formatMinutes(person.holiday_minutes)}`);
  }
  const holidays = person.holidays.map(h => {
    const state = { counts: "", held: " · held until you decide", not: " · doesn't count" }[h.status];
    return `${h.name}: ${formatMinutes(h.minutes)} stat holiday hours (${formatMinutes(h.lookback_minutes)} worked ${formatDate(h.window_start)} to ${formatDate(h.window_end)}, ÷ 20)${state}`;
  });
  if (!lines.length && !holidays.length) return "";
  return `
    ${lines.length ? `<div class="ts-item meta">${esc(lines.join(" · "))}</div>` : ""}
    ${holidays.map(h => `<div class="ts-item meta">${esc(h)}</div>`).join("")}
  `;
}

/** Everyone together, at the foot of the table. */
function grandTotalRow(people) {
  const sum = key => people.reduce((s, p) => s + p[key], 0);
  const premium = sum("premium_minutes");
  const holiday = sum("holiday_minutes");
  const parts = [`Regular ${formatMinutes(sum("regular_minutes"))}`];
  if (premium) parts.push(`premium pay ${formatMinutes(premium)}`);
  if (holiday) parts.push(`stat holiday ${formatMinutes(holiday)}`);
  const days = sum("days_worked");
  return `
    <tfoot>
      <tr class="ts-grand-row">
        <td colspan="2">
          <strong>Everyone</strong> <span class="meta">· ${people.length} ${people.length === 1 ? "person" : "people"}, ${days} day${days === 1 ? "" : "s"}</span>
          ${premium || holiday ? `<div class="ts-item meta">${esc(parts.join(" · "))}</div>` : ""}
        </td>
        <td>${sum("break_minutes") ? esc(formatMinutes(sum("break_minutes"))) : ""}</td>
        <td class="ts-num">${esc(formatMinutes(sum("total_minutes")))}</td>
        <td></td>
      </tr>
    </tfoot>
  `;
}

/** A row that can't be edited (locked, running, a no-show) still opens its notes. */
function openDetailRow(tr, html) {
  document.getElementById("fixEditorRow")?.remove();
  const row = document.createElement("tr");
  row.id = "fixEditorRow";
  row.innerHTML = `<td colspan="${tr.children.length}"><div class="ts-detail">${html}</div></td>`;
  tr.after(row);
}

/**
 * One listener on the whole table, because a row's detail (and the buttons
 * in it) is drawn after the table, when the row is tapped.
 */
function wireTimesheets() {
  const period = tsData.period;
  const area = document.getElementById("reportArea");

  const act = async (btn, path, body, errorId) => {
    btn.disabled = true;
    const result = await apiSend(path, "POST", body);
    if (!result.ok) {
      btn.disabled = false;
      showFormError(errorId, result.error || "That didn't save.");
      return false;
    }
    return true;
  };

  area.onclick = e => {
    const btn = e.target.closest("button");
    if (btn) {
      const person = Number(btn.dataset.person || btn.dataset.tick || btn.dataset.approve || btn.dataset.unlock);
      const errorId = `tsError${person}`;

      if (btn.dataset.tick) {
        guard(async () => {
          if (await act(btn, "/api/admin/timesheets/tick", {
            period_start: period.start, employee_id: person, row_key: btn.dataset.row, on: !btn.classList.contains("on")
          }, errorId)) await loadTeamHours();
        });
      } else if (btn.dataset.approve) {
        // Approve all ticks every row, and marks any look-at-it flags fine.
        const who = tsData.people.find(p => p.id === person);
        const flagged = who.flags.filter(f => !f.dismissed && f.kind === "check").length;
        if (flagged && !confirm(`Approve all of ${who.full_name.split(" ")[0]}'s hours? This ticks every row and marks ${flagged} flag${flagged === 1 ? "" : "s"} as fine.`)) return;
        guard(async () => {
          if (await act(btn, "/api/admin/timesheets/approve", { period_start: period.start, employee_id: person, approve_all: true }, errorId)) await loadTeamHours();
        });
      } else if (btn.dataset.unlock) {
        if (!confirm("Unlock these hours? The approval stays in the log, and you'll need to approve again.")) return;
        guard(async () => {
          if (await act(btn, "/api/admin/timesheets/unlock", { period_start: period.start, employee_id: person }, errorId)) await loadTeamHours();
        });
      } else if (btn.dataset.decide) {
        guard(async () => {
          if (await act(btn, "/api/admin/timesheets/dismiss",
            { employee_id: person, flag_key: btn.dataset.key, outcome: btn.dataset.decide }, errorId)) await loadTeamHours();
        });
      } else if (btn.dataset.undismiss) {
        guard(async () => {
          if (await act(btn, "/api/admin/timesheets/undismiss", { employee_id: person, flag_key: btn.dataset.undismiss }, errorId)) await loadTeamHours();
        });
      } else if (btn.dataset.useTime) {
        // "Use 7:30 PM" refills the shift's fix editor with their time;
        // saving it is still the boss's tap.
        const key = btn.dataset.useTime;
        const anchor = key.slice(key.indexOf(":") + 1);
        const index = teamFixList.findIndex(s => s.employee_id === person && s.in_at === anchor);
        const row = area.querySelector(`tr[data-fix="${index}"]`);
        if (index < 0 || !row) return;
        const at = teamFixList[index].flags.find(f => f.key === key)?.response?.suggested_at;
        const shift = { ...teamFixList[index] };
        if (key.startsWith("open_break:")) shift.suggested_break_end = at;
        else shift.suggested_out = at;
        openFixEditor(row, shift);
      }
      return;
    }
    if (e.target.closest("input, select, #fixEditorRow")) return;

    // Tapping a name (or a folded total) folds that person down to their total.
    const toggle = e.target.closest("tr[data-toggle]");
    if (toggle) {
      const id = Number(toggle.dataset.toggle);
      if (tsCollapsed.has(id)) tsCollapsed.delete(id);
      else tsCollapsed.add(id);
      drawTimesheets();
      return;
    }

    // Tapping a row opens its notes (and its punches, when they can be
    // fixed); tapping it again closes them.
    const tr = e.target.closest("tr[data-detail]");
    if (!tr) return;
    const open = document.getElementById("fixEditorRow");
    if (open && open.previousElementSibling === tr) {
      open.remove();
      return;
    }
    if (tr.dataset.fix !== undefined) openFixEditor(tr, teamFixList[Number(tr.dataset.fix)]);
    else if (tsDetails[Number(tr.dataset.detail)]) openDetailRow(tr, tsDetails[Number(tr.dataset.detail)]);
  };

  const collapseAll = document.getElementById("tsCollapseAllBtn");
  if (collapseAll) {
    collapseAll.onclick = () => {
      const everyone = tsData.people.map(p => p.id);
      if (everyone.every(id => tsCollapsed.has(id))) everyone.forEach(id => tsCollapsed.delete(id));
      else everyone.forEach(id => tsCollapsed.add(id));
      drawTimesheets();
    };
  }

  const approveAll = document.getElementById("tsApproveAllBtn");
  approveAll.onclick = () => guard(async () => {
    approveAll.disabled = true;
    const result = await apiSend("/api/admin/timesheets/approve", "POST", { period_start: period.start, all_ready: true });
    if (!result.ok) {
      approveAll.disabled = false;
      showFormError("tsSummaryError", result.error || "Couldn't approve.");
      return;
    }
    await loadTeamHours();
  });

  const exportBtn = document.getElementById("tsExportBtn");
  exportBtn.onclick = () => guard(async () => {
    exportBtn.disabled = true;
    exportBtn.textContent = "Building…";
    try {
      await exportTimesheets();
    } catch (err) {
      showFormError("tsSummaryError", `Export failed: ${err.message}`);
    }
    exportBtn.disabled = false;
    exportBtn.textContent = "Export to Excel";
  });
}

/* ---------- Excel export ---------- */

const SHEETJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";

/** SheetJS is only fetched when someone actually exports. */
function loadSheetJs() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SHEETJS_URL;
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error("couldn't load the spreadsheet library. Check the connection and try again."));
    document.head.appendChild(script);
  });
}

function flagText(f) {
  const said = f.response ? ` [staff: "${f.response.note}"${f.response.suggested_at ? `, ${timeOf(f.response.suggested_at)}` : ""}]` : "";
  return (f.dismissed ? `${f.label} (OK: ${f.dismissed.reason}, ${f.dismissed.by})` : `${f.label} (OPEN)`) + said;
}

/**
 * One workbook per period, for Sam's own records — not an import file.
 * Summary (a row per person, with a total), Shifts (every punch and fix),
 * Log (every approve and unlock). Hours are decimal numbers so Excel can sum
 * them; stat-holiday hours are inside the total and also on their own.
 */
async function exportTimesheets() {
  const XLSX = await loadSheetJs();
  const { period, people, log } = tsData;
  const statusText = p => ({ approved: "Approved", ready: "Not approved", flagged: "Not approved (open flags)", changed: "Changed since approved" })[p.status];
  // Hours are regular + premium pay (worked on the holiday) + stat holiday
  // hours (lookback / 20) = total. Nothing is counted twice.

  const summary = people.map(p => ({
    "Name": p.full_name,
    "Role": p.role,
    "Status": statusText(p),
    "Approved by": p.approval ? p.approval.by : "",
    "Approved at": p.approval ? formatDateTime(p.approval.at) : "",
    "Days worked": p.days_worked,
    "Regular hours": hoursDecimal(p.regular_minutes),
    "Stat Holiday Premium Pay Hours": hoursDecimal(p.premium_minutes),
    "Stat Holiday Hours": hoursDecimal(p.holiday_minutes),
    "Total hours": hoursDecimal(p.total_minutes),
    "Break hours (unpaid)": hoursDecimal(p.break_minutes),
    "Stat holiday calculation": p.holidays.map(h =>
      `${h.name}: ${hoursDecimal(h.lookback_minutes)}h worked ${h.window_start} to ${h.window_end} / 20 = ${hoursDecimal(h.minutes)}h` +
      ({ counts: "", held: " (HELD, not decided)", not: " (does not count)" })[h.status]).join("; "),
    "Open flags": p.open_flags,
    "Cleared flags": p.flags.filter(f => f.dismissed).map(flagText).join("; ")
  }));
  const sum = key => hoursDecimal(people.reduce((s, p) => s + p[key], 0));
  summary.push({
    "Name": "TOTAL",
    "Days worked": people.reduce((s, p) => s + p.days_worked, 0),
    "Regular hours": sum("regular_minutes"),
    "Stat Holiday Premium Pay Hours": sum("premium_minutes"),
    "Stat Holiday Hours": sum("holiday_minutes"),
    "Total hours": sum("total_minutes"),
    "Break hours (unpaid)": sum("break_minutes")
  });

  const shifts = [];
  for (const p of people) {
    for (const s of p.shifts) {
      shifts.push({
        "Name": p.full_name,
        "Date": s.date,
        "Day": new Date(`${s.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" }),
        "Clock in": timeOf(s.in_at),
        "Clock out": s.out_at ? timeOf(s.out_at) : "",
        "Breaks": (s.breaks || []).map(b => `${timeOf(b.start_at)}–${b.end_at ? timeOf(b.end_at) : "?"}`).join(", "),
        "Break minutes": s.out_at ? s.break_minutes : "",
        "Hours": s.net_minutes === null ? "" : hoursDecimal(s.net_minutes),
        "Stat holiday": s.stat_holiday || "",
        "Scheduled": s.scheduled ? `${s.scheduled.title} ${formatTime(s.scheduled.starts_at)}–${formatTime(s.scheduled.ends_at)}` : "Not scheduled",
        "Event": s.scheduled?.convention || "",
        "Fixes": s.fixes.join("; "),
        "Staff note": s.staff_notes.map(n => `${n.note}${n.suggested_at ? ` (said ${timeOf(n.suggested_at)})` : ""}`).join("; "),
        "Flags": s.flags.map(flagText).join("; ")
      });
    }
    for (const n of p.no_shows) {
      const f = p.flags.find(x => x.key === `no_show:${n.id}`);
      shifts.push({
        "Name": p.full_name,
        "Date": n.date,
        "Day": new Date(`${n.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" }),
        "Hours": 0,
        "Scheduled": `${n.title} ${formatTime(n.starts_at)}–${formatTime(n.ends_at)}`,
        "Flags": f ? flagText(f) : "Scheduled, no punches"
      });
    }
  }
  shifts.sort((a, b) => a.Name.localeCompare(b.Name) || a.Date.localeCompare(b.Date));

  // Oldest first, so an approve, unlock and re-approve read as a story.
  const events = log.flatMap(row => [
    { at: row.approved_at, person: row.full_name, action: "Approved", by: row.approved_by, hours: hoursDecimal(row.net_minutes) },
    ...(row.unlocked_at ? [{ at: row.unlocked_at, person: row.full_name, action: "Unlocked", by: row.unlocked_by, hours: "" }] : [])
  ]).sort((a, b) => a.at.localeCompare(b.at));
  const logRows = events.map(e => ({ "When": formatDateTime(e.at), "Person": e.person, "Action": e.action, "By": e.by, "Hours": e.hours }));
  logRows.push({ "When": formatDateTime(new Date().toISOString()), "Person": "", "Action": "Exported", "By": state.user?.full_name || "", "Hours": "" });

  // Columns in a fixed order: json_to_sheet otherwise takes them from the
  // first row, and a no-show row (fewer fields) first scrambles the sheet.
  const sheet = (rows, widths, header) => {
    const ws = XLSX.utils.json_to_sheet(rows, header ? { header } : undefined);
    ws["!cols"] = widths.map(wch => ({ wch }));
    return ws;
  };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(summary, [22, 10, 24, 14, 22, 12, 12, 16, 14, 12, 14, 50, 10, 50],
    ["Name", "Role", "Status", "Approved by", "Approved at", "Days worked", "Regular hours",
     "Stat Holiday Premium Pay Hours", "Stat Holiday Hours", "Total hours", "Break hours (unpaid)",
     "Stat holiday calculation", "Open flags", "Cleared flags"]), "Summary");
  XLSX.utils.book_append_sheet(wb, sheet(shifts, [22, 11, 6, 10, 10, 26, 8, 8, 16, 30, 20, 20, 40, 50],
    ["Name", "Date", "Day", "Clock in", "Clock out", "Breaks", "Break minutes", "Hours", "Stat holiday",
     "Scheduled", "Event", "Fixes", "Staff note", "Flags"]), "Shifts");
  XLSX.utils.book_append_sheet(wb, sheet(logRows, [24, 22, 12, 22, 8]), "Log");

  XLSX.writeFile(wb, `Panda timesheets ${period.start} to ${period.end}.xlsx`);
}

/* ---------- Staff: flags on your own hours ---------- */

const MY_FLAG_WORDS = {
  no_clock_out: { title: "You didn't clock out", ask: "What time did you leave?", example: "forgot to clock out" },
  open_break: { title: "Your break never ended", ask: "What time did your break end?", example: "forgot to end my break" },
  long_shift: { title: "Your shift shows over 16 hours", ask: "Forgot to clock out? What time did you leave?", example: "forgot to clock out" },
  missed_break: { title: "No break on this shift", ask: null, example: "too busy to take one" },
  no_show: { title: "You were scheduled but didn't clock in", ask: null, example: "called in sick" }
};

/**
 * The card on a staff member's Clock page. They answer; the boss fixes. It
 * only appears when there's something to answer.
 */
function myFlagsCard(flags) {
  if (!flags.length) return "";
  return `
    <div class="card stripped">
      <div class="strip">CHECK YOUR HOURS</div>
      <div class="card-body">
        <p class="meta">Something on your hours needs a quick answer before they are approved.</p>
        <ul class="ts-flags">
          ${flags.map(myFlagHtml).join("")}
        </ul>
      </div>
    </div>
  `;
}

function myFlagHtml(f) {
  const words = MY_FLAG_WORDS[f.type];
  const when = f.shift
    ? `${formatDate(f.date)} · clocked in ${timeOf(f.shift.in_at)}${f.shift.out_at ? `, out ${timeOf(f.shift.out_at)}` : ""}`
    : f.scheduled
      ? `${formatDate(f.date)} · ${f.scheduled.title}, ${formatTime(f.scheduled.starts_at)} – ${formatTime(f.scheduled.ends_at)}`
      : formatDate(f.date);
  const r = f.response;
  // A plain time box: the answer is to the minute, and the date is the shift's.
  const suggested = r?.suggested_at ? new Date(r.suggested_at.replace(" ", "T") + "Z") : null;
  const timeValue = suggested
    ? `${String(suggested.getHours()).padStart(2, "0")}:${String(suggested.getMinutes()).padStart(2, "0")}`
    : "";

  return `
    <li class="ts-flag ts-my-flag" data-my-flag="${esc(f.key)}">
      <span>⚠ ${esc(words.title)}</span>
      <span class="meta">${esc(when)}</span>
      ${r ? `<span class="ts-response">✓ Sent: “${esc(r.note)}”${suggested ? ` · ${esc(timeOf(r.suggested_at))}` : ""}. You can change it below.</span>` : ""}
      <div class="ts-answer">
        ${words.ask ? `<label>${esc(words.ask)} <input type="time" data-my-time value="${esc(timeValue)}"></label>` : ""}
        <label>What happened? <input type="text" data-my-note maxlength="500" value="${esc(r?.note || "")}" placeholder="e.g. ${esc(words.example)}"></label>
        <button class="btn-go" data-my-send>${r ? "Update" : "Send"}</button>
        <p class="form-error" data-my-error></p>
      </div>
    </li>
  `;
}

function wireMyFlags(flags, onDone) {
  document.querySelectorAll("[data-my-flag]").forEach(li => {
    const f = flags.find(x => x.key === li.dataset.myFlag);
    const send = li.querySelector("[data-my-send]");
    const error = li.querySelector("[data-my-error]");

    send.onclick = () => guard(async () => {
      const note = li.querySelector("[data-my-note]").value.trim();
      const timeInput = li.querySelector("[data-my-time]");
      let suggested_at = null;

      if (timeInput && timeInput.value && f.shift) {
        // The time is on the shift's own date; earlier than the clock-in
        // means they worked past midnight.
        const inAt = new Date(f.shift.in_at.replace(" ", "T") + "Z");
        const at = new Date(`${f.date}T${timeInput.value}`);
        if (at <= inAt) at.setDate(at.getDate() + 1);
        suggested_at = at.toISOString().slice(0, 19).replace("T", " ");
      }

      if (!note) {
        showFormError(error, "Say what happened, even just a few words.");
        return;
      }

      send.disabled = true;
      const result = await apiSend("/api/my-timesheet-flags/respond", "POST", { flag_key: f.key, note, suggested_at });
      if (!result.ok) {
        send.disabled = false;
        showFormError(error, result.error || "That didn't send.");
        return;
      }
      await onDone();
    });
  });
}
