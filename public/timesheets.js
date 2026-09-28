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
  const totalMinutes = people.reduce((sum, p) => sum + p.total_minutes, 0);

  document.getElementById("tsSummary").innerHTML = `
    <div class="card stripped">
      <div class="strip">THIS PERIOD<span class="strip-side">${esc(formatMinutes(totalMinutes))} total</span></div>
      <div class="card-body">
        <div class="badge-row">
          <span class="pill pill-go">${count("approved")} APPROVED</span>
          <span class="pill pill-paper">${ready} READY</span>
          <span class="pill pill-warm">${count("flagged") + count("changed")} NEED A LOOK</span>
        </div>
        ${stats.length ? `<p class="meta">Stat holiday${stats.length > 1 ? "s" : ""}: ${stats.map(h => `${esc(h.name)} (${esc(formatDate(h.date))})`).join(", ")}. Hours worked on ${stats.length > 1 ? "them" : "it"} are counted separately in the export.</p>` : ""}
        ${isCurrent ? `<p class="meta">This period is still running. Approve once everyone's last shift is in.</p>` : ""}
        <div class="button-row">
          <button class="btn-go" id="tsApproveAllBtn" ${ready ? "" : "disabled"}>Approve everyone ready${ready ? ` (${ready})` : ""}</button>
          <button class="btn-quiet" id="tsExportBtn" ${people.length ? "" : "disabled"}>Export to Excel</button>
        </div>
        <p class="form-error" id="tsSummaryError"></p>
      </div>
    </div>
  `;

  teamFixList = [];
  const blocks = people.map(personBlock);

  document.getElementById("reportArea").innerHTML = blocks.length
    ? `<div class="people-grid">${blocks.join("")}</div>
       <p class="meta">Tap a shift to fix its punches: clock-in, breaks, clock-out, or add a missed break. Corrections are stamped with your name.</p>`
    : `<p class="empty-state">Nobody worked or was scheduled in this period.</p>`;

  wireTimesheets();
}

/** The server sends a no-show's shift rather than its words; times read 12-hour here like everywhere else. */
function flagDetail(person, f) {
  if (f.type === "holiday_check") {
    return (f.detail || "").replace(/\d{4}-\d{2}-\d{2}/g, d => formatDate(d));
  }
  if (f.type !== "no_show") return f.detail || "";
  const shift = person.no_shows.find(n => `no_show:${n.id}` === f.key);
  return shift ? `${shift.title}, ${formatTime(shift.starts_at)} – ${formatTime(shift.ends_at)}` : "";
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
    <span class="ts-response">
      💬 ${esc(first)}: “${esc(r.note)}”${esc(time)}
      ${canUse ? `<button class="btn-go ts-mini" data-use-time="${esc(f.key)}" data-person="${person.id}">Use ${esc(timeOf(r.suggested_at))}</button>` : ""}
    </span>
  `;
}

function flagHtml(person, f) {
  const when = f.date ? `${esc(formatDate(f.date))} · ` : "";
  if (f.dismissed) {
    const label = f.kind === "decide"
      ? `${f.label.replace(": may not qualify", "")}: ${f.dismissed.outcome === "counts" ? "counts" : "doesn't count"}`
      : f.label;
    return `
      <li class="ts-flag ts-flag-done">
        <span>✓ ${esc(label)}</span>
        <span class="meta">${when}${esc(f.dismissed.reason)} (${esc(f.dismissed.by)})</span>
        ${person.approval ? "" : `<button class="btn-quiet ts-mini" data-undismiss="${esc(f.key)}" data-person="${person.id}">Undo</button>`}
        ${responseHtml(person, f)}
      </li>
    `;
  }
  const actions = f.kind === "check"
    ? `<button class="btn-quiet ts-mini" data-dismiss="${esc(f.key)}" data-person="${person.id}">It's fine</button>`
    : f.kind === "decide" && !person.approval
      ? `<button class="btn-go ts-mini" data-decide="counts" data-key="${esc(f.key)}" data-person="${person.id}">Counts</button>
         <button class="btn-quiet ts-mini" data-decide="not" data-key="${esc(f.key)}" data-person="${person.id}">Doesn't count</button>`
      : "";
  return `
    <li class="ts-flag">
      <span>⚠ ${esc(f.label)}</span>
      <span class="meta">${when}${esc(flagDetail(person, f))}</span>
      ${actions}
      ${responseHtml(person, f)}
    </li>
  `;
}

/**
 * Staff answers about shifts whose flag has since been fixed. An answer on a
 * flag that's still open already shows on the flag, so it isn't repeated.
 */
function staffNotesHtml(person) {
  const openKeys = new Set(person.flags.map(f => f.key));
  const first = person.full_name.split(" ")[0];
  const notes = person.shifts.flatMap(s => s.staff_notes
    .filter(n => !openKeys.has(`${n.flag_type}:${s.in_at}`))
    .map(n => ({ ...n, date: s.date })));
  if (!notes.length) return "";
  return notes.map(n => `
    <p class="meta ts-note">💬 ${esc(formatDate(n.date))} · ${esc(first)}: “${esc(n.note)}”${n.suggested_at ? ` (said ${esc(timeOf(n.suggested_at))})` : ""}</p>
  `).join("");
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
    ${lines.length ? `<p class="meta">${esc(lines.join(" · "))}</p>` : ""}
    ${holidays.map(h => `<p class="meta">${esc(h)}</p>`).join("")}
  `;
}

function personBlock(person) {
  const status = TS_STATUS[person.status];
  const locked = person.status === "approved" || person.status === "changed";

  const rows = person.shifts.map(shift => {
    // A running shift isn't a mistake to fix, and approved hours are locked.
    const working = shift.flags.some(f => f.type === "working");
    if (working || locked) return shiftRow(shift, null);
    teamFixList.push({ employee_id: person.id, in_at: shift.in_at, out_at: shift.out_at, breaks: shift.breaks || [], flags: shift.flags });
    return shiftRow(shift, teamFixList.length - 1);
  }).join("");

  // Open flags first; the ones already cleared stay visible, for the record.
  const flags = [...person.flags].sort((a, b) =>
    Number(!!a.dismissed) - Number(!!b.dismissed) || (a.date || "").localeCompare(b.date || ""));

  const footer = person.approval
    ? `
      <p class="meta">
        Approved by ${esc(person.approval.by)}, ${esc(formatDateTime(person.approval.at))}
        · ${esc(formatMinutes(person.approval.net_minutes))}
      </p>
      <button class="btn-quiet ts-mini" data-unlock="${person.id}">Unlock to make changes</button>
    `
    : `<button class="btn-go" data-approve="${person.id}" ${person.status === "ready" ? "" : "disabled"}>Approve ${esc(person.full_name.split(" ")[0])}'s hours</button>`;

  return `
    <div class="person-block ts-person">
      <h4>
        ${esc(person.full_name)} <span class="meta">· ${esc(formatMinutes(person.total_minutes))}</span>
        <span class="pill ${status.cls}" style="float:right;">${status.label}</span>
      </h4>
      ${flags.length ? `<ul class="ts-flags">${flags.map(f => flagHtml(person, f)).join("")}</ul>` : ""}
      ${rows ? `<table class="hours-table"><tbody>${rows}</tbody></table>` : ""}
      ${staffNotesHtml(person)}
      ${breakdownHtml(person)}
      <div class="ts-footer">${footer}</div>
      <p class="form-error" id="tsError${person.id}"></p>
    </div>
  `;
}

function wireTimesheets() {
  const period = tsData.period;

  // The row is the control: tapping a shift opens its punches for editing,
  // tapping it again closes them.
  document.querySelectorAll("tr[data-fix]").forEach(tr => {
    tr.onclick = () => {
      const editor = document.getElementById("fixEditorRow");
      if (editor && editor.previousElementSibling === tr) {
        editor.remove();
        return;
      }
      openFixEditor(tr, teamFixList[Number(tr.dataset.fix)]);
    };
  });

  const act = async (btn, path, body, errorId) => {
    btn.disabled = true;
    const result = await apiSend(path, "POST", body);
    if (!result.ok) {
      btn.disabled = false;
      showFormError(errorId, result.error || "That didn't save.");
      return;
    }
    await loadTeamHours();
  };

  document.querySelectorAll("[data-approve]").forEach(btn => {
    btn.onclick = () => guard(() => act(btn, "/api/admin/timesheets/approve",
      { period_start: period.start, employee_id: Number(btn.dataset.approve) }, `tsError${btn.dataset.approve}`));
  });

  document.querySelectorAll("[data-unlock]").forEach(btn => {
    btn.onclick = () => {
      if (!confirm("Unlock these hours? The approval stays in the log, and you'll need to approve again.")) return;
      guard(() => act(btn, "/api/admin/timesheets/unlock",
        { period_start: period.start, employee_id: Number(btn.dataset.unlock) }, `tsError${btn.dataset.unlock}`));
    };
  });

  document.querySelectorAll("[data-decide]").forEach(btn => {
    btn.onclick = () => guard(() => act(btn, "/api/admin/timesheets/dismiss",
      { employee_id: Number(btn.dataset.person), flag_key: btn.dataset.key, outcome: btn.dataset.decide },
      `tsError${btn.dataset.person}`));
  });

  // "Use 7:30 PM" opens the shift's fix editor with their time filled in;
  // saving it is still the boss's tap.
  document.querySelectorAll("[data-use-time]").forEach(btn => {
    btn.onclick = () => {
      const key = btn.dataset.useTime;
      const anchor = key.slice(key.indexOf(":") + 1);
      const index = teamFixList.findIndex(s => s.employee_id === Number(btn.dataset.person) && s.in_at === anchor);
      const row = document.querySelector(`tr[data-fix="${index}"]`);
      if (index < 0 || !row) return;
      const flagged = teamFixList[index].flags.find(f => f.key === key);
      const at = flagged?.response?.suggested_at;
      const shift = { ...teamFixList[index] };
      if (key.startsWith("open_break:")) shift.suggested_break_end = at;
      else shift.suggested_out = at;
      openFixEditor(row, shift);
      row.nextElementSibling?.scrollIntoView({ block: "center", behavior: "smooth" });
    };
  });

  document.querySelectorAll("[data-undismiss]").forEach(btn => {
    btn.onclick = () => guard(() => act(btn, "/api/admin/timesheets/undismiss",
      { employee_id: Number(btn.dataset.person), flag_key: btn.dataset.undismiss }, `tsError${btn.dataset.person}`));
  });

  // "It's fine" asks why, in place, rather than a browser prompt.
  document.querySelectorAll("[data-dismiss]").forEach(btn => {
    btn.onclick = () => {
      const li = btn.closest("li");
      if (li.querySelector(".ts-reason")) return;
      const form = document.createElement("div");
      form.className = "inline-form ts-reason";
      form.innerHTML = `
        <input type="text" placeholder="Why it's fine, e.g. called in sick" maxlength="200">
        <button class="btn-go ts-mini">Save</button>
      `;
      li.appendChild(form);
      const input = form.querySelector("input");
      const save = form.querySelector("button");
      input.focus();
      const submit = () => guard(() => act(save, "/api/admin/timesheets/dismiss",
        { employee_id: Number(btn.dataset.person), flag_key: btn.dataset.dismiss, reason: input.value },
        `tsError${btn.dataset.person}`));
      save.onclick = submit;
      input.onkeydown = e => { if (e.key === "Enter") submit(); };
    };
  });

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
