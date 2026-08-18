/* Schedule builder — a convention's shifts, one day at a time.
   The question it answers on every screen: is the booth covered for the
   whole time the doors are open? */

let scheduleData = null;
let scheduleDay = null;
let editingShiftId = null;
let addingShift = false;

async function renderSchedule(slug, pushState = true) {
  if (pushState) pushPageState("convention-schedule", { slug });

  const data = await api(`/api/conventions/${encodeURIComponent(slug)}/schedule`);

  if (!data.ok) {
    renderError(data.error || "Could not load that schedule");
    return;
  }

  scheduleData = data;

  // Keep the day you were on across a save; otherwise open on the first day
  // that needs attention, else the first day.
  if (!data.days.some(d => d.date === scheduleDay)) {
    const needsWork = data.days.find(d => d.gaps.length || d.unassigned || !d.shifts.length);
    scheduleDay = (needsWork || data.days[0])?.date || null;
  }

  drawSchedule();
}

function drawSchedule() {
  const { convention, days } = scheduleData;
  const day = days.find(d => d.date === scheduleDay);

  pageArea().innerHTML = `
    <div class="title-row">
      <button class="back-tile" id="scheduleBackBtn">‹</button>
      <div style="flex:1;">
        <h2 style="margin:0;">Build schedule</h2>
        <div class="meta">
          ${esc(convention.name)}${convention.booth_number ? ` · Booth ${esc(convention.booth_number)}` : ""}
        </div>
      </div>
    </div>

    ${days.length ? `
      <div class="day-tabs">
        ${days.map(d => dayTab(d)).join("")}
      </div>

      ${day ? daySection(day) : ""}
    ` : `
      <div class="card">
        <p class="empty-state">
          This event has no dates yet. Set its start and end dates first and the
          days will show up here.
        </p>
      </div>
    `}
  `;

  markActiveNav("conventions", { wide: true });
  wireSchedule();
}

/** A day tab: weekday, date, and how many are on. Amber when nobody is. */
function dayTab(day) {
  const d = new Date(`${day.date}T00:00:00`);
  const selected = day.date === scheduleDay;
  const empty = !day.shifts.length;

  return `
    <button class="day-tab${selected ? " on" : ""}${empty ? " empty" : ""}" data-day="${esc(day.date)}">
      ${esc(d.toLocaleDateString(undefined, { weekday: "short" }))}
      <span class="day-tab-date">${d.getDate()}</span>
      <span class="day-tab-count">${empty ? "none" : `${day.shifts.length} on`}</span>
    </button>
  `;
}

/** The summary strip: hall hours, what's covered, and any holes in it. */
function coverageCard(day) {
  const hall = day.hall;

  if (!hall || !hall.regular_start) {
    return `
      <div class="card cool">
        <h3 style="color:var(--cool-text);">No hours set for this day</h3>
        <p style="margin:0; font-size:12.5px; line-height:1.45;">
          Add the hall's opening hours on the event page and this will tell you
          whether the booth is covered for all of them.
        </p>
      </div>
    `;
  }

  const chip = day.gaps.length
    ? `<span class="pill pill-warm">${day.gaps.length} gap${day.gaps.length === 1 ? "" : "s"}</span>`
    : day.shifts.length
      ? `<span class="pill pill-go">NO GAPS</span>`
      : `<span class="pill pill-warm">NOBODY ON</span>`;

  return `
    <div class="card cool" style="display:flex; align-items:flex-start; gap:10px;">
      <div style="flex:1;">
        <div style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:11.5px; letter-spacing:0.06em; color:var(--cool-text);">
          HALL ${esc(formatTime(hall.regular_start))} – ${esc(formatTime(hall.regular_end))}
        </div>
        <div style="font-size:11.5px; color:var(--cool-text); margin-top:2px;">
          ${day.covered
            ? `Booth covered ${esc(formatTime(day.covered.from))} – ${esc(formatTime(day.covered.to))}`
            : "Nobody on the booth yet"}
        </div>
        ${day.gaps.length ? `
          <div style="font-size:11.5px; color:var(--cool-text); margin-top:6px;">
            ${day.gaps.map(gap =>
              `Uncovered ${esc(formatTime(gap.from))} – ${esc(formatTime(gap.to))}`
            ).join("<br>")}
          </div>
        ` : ""}
      </div>
      ${chip}
    </div>
  `;
}

function daySection(day) {
  const otherDays = scheduleData.days.filter(d => d.date !== day.date);

  return `
    ${coverageCard(day)}

    ${day.shifts.map(shift =>
      editingShiftId === shift.id ? shiftEditor(shift, day) : shiftCard(shift, day)
    ).join("")}

    ${addingShift ? shiftEditor(null, day) : `
      <button class="btn-dashed" id="addShiftBtn" style="width:100%; margin-bottom:13px;">
        + Add shift
      </button>
    `}

    <p class="form-error" id="scheduleError"></p>

    ${day.shifts.length && otherDays.length ? `
      <div class="card stripped">
        <div class="strip">COPY THIS DAY</div>
        <div class="card-body">
          <div class="inline-form">
            <select id="copyTarget">
              ${otherDays.map(d => `
                <option value="${esc(d.date)}">
                  ${esc(formatDate(d.date))}${d.shifts.length ? ` — has ${d.shifts.length} already` : ""}
                </option>
              `).join("")}
            </select>
            <button class="btn-quiet" id="copyDayBtn">Copy</button>
          </div>
          <p class="meta" style="margin:6px 0 0;">
            Copies everyone on this day, with their times and breaks, onto a day
            that's still empty.
          </p>
        </div>
      </div>
    ` : ""}
  `;
}

function shiftCard(shift, day) {
  const person = shift.employee_id
    ? { name: shift.employee_name, avatar_url: shift.avatar_url }
    : null;

  // Someone can be put on a shift they said they can't do — a boss may have
  // asked them. It's flagged, not blocked.
  const clash = shift.employee_id ? day?.unavailable?.[shift.employee_id] : null;

  return `
    <div class="card shift-card" data-edit-shift="${shift.id}">
      <div style="display:flex; align-items:center; gap:10px;">
        ${person
          ? avatarHtml(person, "mid")
          : `<div class="avatar mid" style="border-style:dashed;">?</div>`}
        <div style="flex:1; min-width:0;">
          <div style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:13.5px;">
            ${person ? esc(person.name) : "Unassigned"}
            ${shift.employee_role === "volunteer" ? `<span class="meta"> · volunteer</span>` : ""}
          </div>
          <div class="meta">${esc(shift.title)}</div>
        </div>
        <div style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:15px;">
          ${esc(formatTime(shift.starts_at))}–${esc(formatTime(shift.ends_at))}
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:7px; border-top:2px solid var(--track); margin-top:9px; padding-top:9px;">
        <span style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:10.5px; letter-spacing:0.06em; color:var(--muted);">BREAK</span>
        <span style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:12.5px; color:var(--brand-text);">
          ${shift.break_allotment_minutes
            ? esc(breakBasisText(shift.break_allotment_minutes, shift.break_count))
            : "None"}
        </span>
        <span style="margin-left:auto; font-family:'Fredoka',sans-serif; font-size:15px; color:var(--muted);">›</span>
      </div>
      ${clash ? `
        <div class="note-block" style="margin-top:9px;">
          ${esc(shift.employee_name)} is ${esc(clash.reason)}.
        </div>
      ` : ""}
    </div>
  `;
}

/** The inline editor. A null shift means we're adding a new one. */
function shiftEditor(shift, day) {
  const { staff } = scheduleData;
  const minutes = shift ? shift.break_allotment_minutes : 30;
  const count = shift ? shift.break_count : 1;

  return `
    <div class="card" style="border-style:dashed;">
      <h3>${shift ? "Edit shift" : "New shift"}</h3>

      <div class="form-grid" style="margin:0;">
        <label>Who
          <select id="shiftWho">
            <option value="">Unassigned</option>
            ${staff.map(person => {
              const clash = day.unavailable?.[person.id];
              return `
                <option value="${person.id}" ${shift?.employee_id === person.id ? "selected" : ""}>
                  ${esc(person.full_name)}${clash ? ` — ${esc(clash.reason)}` : ""}
                </option>
              `;
            }).join("")}
          </select>
        </label>
        <label>What
          <input type="text" id="shiftWhat" value="${esc(shift?.title || "Booth")}" placeholder="Booth">
        </label>
        <label>Start <input type="time" id="shiftFrom" value="${esc(shift?.starts_at || suggestedStart())}"></label>
        <label>End <input type="time" id="shiftTo" value="${esc(shift?.ends_at || suggestedEnd())}"></label>
        <label>Break minutes
          <input type="number" id="shiftBreakMins" value="${minutes}" min="0" max="240">
        </label>
        <label>Split into
          <select id="shiftBreakCount">
            <option value="1" ${count === 1 ? "selected" : ""}>One break</option>
            <option value="2" ${count === 2 ? "selected" : ""}>Two breaks</option>
          </select>
        </label>
      </div>

      <div class="button-row">
        <button id="saveShiftBtn" style="flex:1;">${shift ? "Save shift" : "Add shift"}</button>
        <button class="btn-quiet" id="cancelShiftBtn">Cancel</button>
        ${shift ? `<button class="btn-danger" id="deleteShiftBtn">Remove</button>` : ""}
      </div>
    </div>
  `;
}

/** A new shift starts when the doors do, so most days need no retyping. */
function suggestedStart() {
  const day = scheduleData.days.find(d => d.date === scheduleDay);
  return day?.hall?.setup_start || day?.hall?.regular_start || "10:00";
}

function suggestedEnd() {
  const day = scheduleData.days.find(d => d.date === scheduleDay);
  return day?.hall?.regular_end || "18:00";
}

function wireSchedule() {
  const slug = scheduleData.convention.slug;
  const reload = () => renderSchedule(slug, false);

  document.getElementById("scheduleBackBtn").onclick = () => openConvention(slug);

  document.querySelectorAll("[data-day]").forEach(tab => {
    tab.onclick = () => {
      scheduleDay = tab.dataset.day;
      editingShiftId = null;
      addingShift = false;
      drawSchedule();
    };
  });

  document.querySelectorAll("[data-edit-shift]").forEach(card => {
    card.onclick = () => {
      editingShiftId = Number(card.dataset.editShift);
      addingShift = false;
      drawSchedule();
    };
  });

  const addBtn = document.getElementById("addShiftBtn");
  if (addBtn) {
    addBtn.onclick = () => {
      addingShift = true;
      editingShiftId = null;
      drawSchedule();
    };
  }

  const cancelBtn = document.getElementById("cancelShiftBtn");
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      editingShiftId = null;
      addingShift = false;
      drawSchedule();
    };
  }

  const saveBtn = document.getElementById("saveShiftBtn");
  if (saveBtn) {
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;

      const payload = {
        employee_id: document.getElementById("shiftWho").value || null,
        title: document.getElementById("shiftWhat").value,
        shift_date: scheduleDay,
        starts_at: document.getElementById("shiftFrom").value,
        ends_at: document.getElementById("shiftTo").value,
        break_allotment_minutes: Number(document.getElementById("shiftBreakMins").value) || 0,
        break_count: Number(document.getElementById("shiftBreakCount").value) || 1
      };

      const result = editingShiftId
        ? await apiSend(`/api/convention-shifts/${editingShiftId}`, "PATCH", payload)
        : await apiSend(`/api/conventions/${scheduleData.convention.id}/shifts`, "POST", payload);

      saveBtn.disabled = false;

      if (!result.ok) {
        showFormError("scheduleError", result.error || "Could not save that shift.");
        return;
      }

      editingShiftId = null;
      addingShift = false;
      await reload();
    };
  }

  const deleteBtn = document.getElementById("deleteShiftBtn");
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      await apiSend(`/api/convention-shifts/${editingShiftId}`, "DELETE");
      editingShiftId = null;
      await reload();
    };
  }

  const copyBtn = document.getElementById("copyDayBtn");
  if (copyBtn) {
    copyBtn.onclick = async () => {
      copyBtn.disabled = true;

      const result = await apiSend("/api/schedule/copy-day", "POST", {
        from_date: scheduleDay,
        to_date: document.getElementById("copyTarget").value,
        convention_id: scheduleData.convention.id
      });

      copyBtn.disabled = false;

      if (!result.ok) {
        showFormError("scheduleError", result.error || "Could not copy that day.");
        return;
      }

      scheduleDay = document.getElementById("copyTarget").value;
      await reload();
    };
  }
}

/* ---------- The store week ---------- */

let storeData = null;
let storeWeek = null;
let storeDay = null;
let editingStoreShift = null;
let addingStoreShift = false;
let editingStoreHours = false;
let editingHoliday = null;
// Open/Closed is a pair of buttons rather than a checkbox, so the choice has to
// live somewhere between clicking it and saving.
let holidayDraft = { is_closed: true, opens_at: "", closes_at: "" };

// The week is the default because it's the one a store actually runs on; the
// rest are the same screen over a longer range.
let storeSpan = "week";
let storeAnchor = null;
let storeCustomDays = 10;

const SPAN_LABELS = [
  ["day", "Day"],
  ["week", "Week"],
  ["2week", "2 weeks"],
  ["month", "Month"],
  ["custom", "Custom"]
];

async function renderStoreSchedule(anchor = null, pushState = true) {
  if (pushState) pushPageState("schedule");

  if (anchor) storeAnchor = anchor;

  const params = new URLSearchParams({ span: storeSpan, today: todayLocal() });
  if (storeAnchor) params.set("from", storeAnchor);
  if (storeSpan === "custom") params.set("days", String(storeCustomDays));

  const data = await api(`/api/schedule/store?${params}`);

  if (!data.ok) {
    renderError(data.error || "Could not load the schedule");
    return;
  }

  storeData = data;
  storeWeek = data.week_start;
  storeAnchor = data.range_start;

  // The day being edited below has to be one the range actually covers, or the
  // detail card would be describing a day that isn't on screen.
  const inRange = data.days.filter(d => d.in_range);
  if (!inRange.some(d => d.date === storeDay)) {
    const today = todayLocal();
    storeDay = inRange.some(d => d.date === today) ? today : inRange[0]?.date || null;
  }

  drawStoreSchedule();
}

function rangeLabel() {
  if (storeData.range_start === storeData.range_end) return formatDate(storeData.range_start);
  return `${formatDate(storeData.range_start)} – ${formatDate(storeData.range_end)}`;
}

/**
 * Day, Week, 2 weeks and Month are all the same view over a different number of
 * days, so they're one row of pills rather than four screens. Custom exposes
 * the number the others are setting behind the scenes.
 */
function spanControl() {
  return `
    <div class="span-picker">
      ${SPAN_LABELS.map(([value, label]) => `
        <button class="span-pill${storeSpan === value ? " on" : ""}" data-span="${value}">
          ${esc(label)}
        </button>
      `).join("")}
      ${storeSpan === "custom" ? `
        <span class="span-days">
          <input type="number" id="storeCustomDays" value="${storeCustomDays}" min="1" max="62">
          <span class="meta">days</span>
        </span>
      ` : ""}
    </div>
  `;
}

function drawStoreSchedule() {
  const day = storeData.days.find(d => d.date === storeDay);

  pageArea().innerHTML = `
    <div class="page-header">
      <h2>Schedule</h2>
      <p>Who's on in the store</p>
    </div>

    ${spanControl()}

    <div class="inline-form" style="margin:0 0 13px; align-items:center;">
      <button class="btn-quiet" id="prevWeekBtn">‹</button>
      <div style="flex:1; text-align:center; font-family:'Fredoka',sans-serif; font-weight:600; font-size:14px;">
        ${esc(rangeLabel())}
      </div>
      <button class="btn-quiet" id="nextWeekBtn">›</button>
    </div>

    ${storeData.weeks.map(rotaTable).join("")}

    ${copyWeekCard()}

    ${day ? storeDaySection(day) : ""}

    ${storeHoursCard()}
  `;

  markActiveNav("schedule", { wide: true });
  wireStoreSchedule();
}

/**
 * The wall chart: one table per Monday-to-Sunday week, a column per day and a
 * row per person on that week. The seven columns are there whatever the range
 * is, so a fortnight's two tables line up under each other and a Wednesday
 * reads as a Wednesday in both.
 *
 * It scrolls sideways inside its own card on a narrow screen rather than
 * pushing the page wide, with the name column pinned so a row stays readable
 * once you've scrolled off it.
 */
function rotaTable(week) {
  const selectedDay = storeDay;

  const head = week.days.map(d => {
    const date = new Date(`${d.date}T00:00:00`);
    const state = !d.in_range ? "out"
      : d.closed ? "shut"
        : d.gaps ? "gap"
          : d.on ? "ok" : "bare";

    return `
      <th class="rota-day rota-${state}${d.date === selectedDay ? " on" : ""}"
          ${d.in_range ? `data-rota-day="${esc(d.date)}"` : ""}>
        <span class="rota-dow">${esc(date.toLocaleDateString(undefined, { weekday: "short" }))}</span>
        <span class="rota-date">${date.getDate()}</span>
        ${d.holiday ? `<span class="rota-flag">${esc(d.holiday.name)}</span>` : ""}
        <span class="rota-note">${
          !d.in_range ? "" : d.closed ? "closed" : d.gaps ? `${d.gaps} gap${d.gaps === 1 ? "" : "s"}` : d.on ? "covered" : "nobody"
        }</span>
      </th>
    `;
  }).join("");

  const body = week.rows.length
    ? week.rows.map(row => `
        <tr>
          <th class="rota-who">
            ${avatarHtml({ name: row.name, avatar_url: row.avatar_url }, "small")}
            <span>${esc(row.name)}</span>
          </th>
          ${week.days.map(d => {
            const shifts = row.cells[d.date] || [];
            return `
              <td class="rota-cell${d.in_range ? "" : " rota-out"}">
                ${shifts.map(s => `
                  <span class="rota-shift${s.convention_name ? " at-event" : ""}"
                        ${s.convention_name ? "" : `data-rota-shift="${s.id}" data-rota-shift-day="${esc(d.date)}"`}
                        title="${esc(s.convention_name || s.title || "")}">
                    ${esc(compactTime(s.starts_at))}–${esc(compactTime(s.ends_at))}
                    ${s.convention_name ? `<span class="rota-at">${esc(s.convention_name)}</span>` : ""}
                  </span>
                `).join("")}
              </td>
            `;
          }).join("")}
        </tr>
      `).join("")
    : `<tr><td class="rota-empty" colspan="8">Nobody on this week yet.</td></tr>`;

  return `
    <div class="card stripped rota-card">
      <div class="strip">
        WEEK OF ${esc(formatDate(week.week_start)).toUpperCase()}
        <span class="strip-side">${week.rows.filter(r => r.employee_id).length} on</span>
      </div>
      <div class="rota-scroll">
        <table class="rota">
          <thead><tr><th class="rota-corner"></th>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>
  `;
}

/** "11:30" -> "11:30", "19:30" -> "7:30" — the chart has no room for AM/PM. */
function compactTime(hhmm) {
  if (!/^\d{2}:\d{2}$/.test(hhmm || "")) return hhmm || "";
  const [h, m] = hhmm.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")}`;
}

/**
 * Most weeks are last week again. Offered only on an empty week — once anyone
 * is on, filling from last week would be doubling up, and the server refuses
 * it anyway.
 */
function copyWeekCard() {
  // "Last week" only means something when a week is what you're looking at.
  if (storeData.span !== "week") return "";
  if (storeData.week_shifts > 0 || !storeData.prev_week_shifts) return "";

  return `
    <div class="card stripped">
      <div class="strip">
        NOBODY ON THIS WEEK
        <span class="strip-side">${storeData.prev_week_shifts} last week</span>
      </div>
      <div class="card-body">
        <p class="meta" style="margin:0 0 10px;">
          Copy last week's ${storeData.prev_week_shifts}
          shift${storeData.prev_week_shifts === 1 ? "" : "s"} across —
          same people, same times, each on the same weekday.
        </p>
        <p class="form-error" id="copyWeekError"></p>
        <button id="copyWeekBtn" style="width:100%;">Fill from last week</button>
      </div>
    </div>
  `;
}


/**
 * A holiday on the week, and the one question it asks: are we open? Undecided
 * is amber, because an unanswered holiday is the thing that catches you out —
 * the schedule says so rather than quietly assuming the usual hours.
 */
function holidayCard(day) {
  const holiday = day.holiday;
  if (!holiday) return "";

  if (editingHoliday === day.date) {
    return `
      <div class="card stripped">
        <div class="strip">${esc(holiday.name.toUpperCase())}</div>
        <div class="card-body">
          <div class="button-row" style="margin-bottom:10px;">
            <button id="holidayClosedBtn" class="${holidayDraft.is_closed ? "" : "btn-quiet"}"
                    style="flex:1;">Closed</button>
            <button id="holidayOpenBtn" class="${holidayDraft.is_closed ? "btn-quiet" : ""}"
                    style="flex:1;">Open</button>
          </div>

          ${holidayDraft.is_closed ? "" : `
            <p class="meta" style="margin:0 0 8px;">
              Shorter hours than usual? Fill both in. Leave them blank to open the
              normal ${esc(day.weekday_name)} hours.
            </p>

            <div class="inline-form" style="margin-bottom:10px;">
              <input type="time" id="holidayOpens" value="${esc(holidayDraft.opens_at || "")}">
              <input type="time" id="holidayCloses" value="${esc(holidayDraft.closes_at || "")}">
            </div>
          `}

          <p class="form-error" id="holidayError"></p>

          <div class="button-row">
            <button id="saveHolidayBtn" style="flex:1;">Save</button>
            <button class="btn-quiet" id="cancelHolidayBtn">Cancel</button>
            ${holiday.decided ? `<button class="btn-danger" id="clearHolidayBtn">Undecide</button>` : ""}
          </div>
        </div>
      </div>
    `;
  }

  const answer = !holiday.decided
    ? `<span class="pill pill-warm">OPEN?</span>`
    : holiday.is_closed
      ? `<span class="pill pill-warm">CLOSED</span>`
      : `<span class="pill pill-go">OPEN</span>`;

  const detail = !holiday.decided
    ? "Nobody's said whether the store opens. Until then it's on the usual hours."
    : holiday.is_closed
      ? "Store closed — nothing to cover."
      : holiday.opens_at
        ? `Open ${formatTime(holiday.opens_at)} – ${formatTime(holiday.closes_at)}, instead of the usual.`
        : "Open as usual.";

  return `
    <div class="card ${holiday.decided ? "cool" : "note"}"
         style="display:flex; align-items:flex-start; gap:10px;">
      <div style="flex:1;">
        <div style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:11.5px; letter-spacing:0.06em;">
          ${esc(holiday.name.toUpperCase())}${holiday.statutory ? "" : " · OBSERVED"}
        </div>
        <div style="font-size:11.5px; margin-top:2px;">${esc(detail)}</div>
      </div>
      ${answer}
      <button class="btn-quiet" id="editHolidayBtn"
              style="font-size:11.5px; padding:5px 9px; border-bottom-width:2px;">
        ${holiday.decided ? "Change" : "Decide"}
      </button>
    </div>
  `;
}

function storeDaySection(day) {
  const otherDays = storeData.days.filter(d => d.date !== day.date && !d.closed);

  return `
    ${holidayCard(day)}

    ${storeCoverageCard(day)}

    ${day.event_shifts.length ? `
      <div class="card stripped">
        <div class="strip">
          AT AN EVENT
          <span class="strip-side">${day.event_shifts.length}</span>
        </div>
        <div class="card-body">
          ${day.event_shifts.map(shift => `
            <div class="roster-row">
              ${avatarHtml({ name: shift.employee_name, avatar_url: shift.avatar_url }, "small")}
              <div style="flex:1;">
                <div style="font-size:13px;">${esc(shift.employee_name || "Unassigned")}</div>
                <div class="meta">${esc(shift.convention_name)} · ${esc(shift.title)}</div>
              </div>
              <span class="meta">${esc(formatTime(shift.starts_at))}–${esc(formatTime(shift.ends_at))}</span>
            </div>
          `).join("")}
          <p class="meta" style="margin:8px 0 0;">
            These belong to the event — build them on its own page.
          </p>
        </div>
      </div>
    ` : ""}

    ${day.shifts.map(shift =>
      editingStoreShift === shift.id ? storeShiftEditor(shift, day) : shiftCard(shift, day)
    ).join("")}

    ${addingStoreShift ? storeShiftEditor(null, day) : `
      <button class="btn-dashed" id="addStoreShiftBtn" style="width:100%; margin-bottom:13px;">
        + Add shift
      </button>
    `}

    <p class="form-error" id="storeError"></p>

    ${day.shifts.length && otherDays.length ? `
      <div class="card stripped">
        <div class="strip">COPY THIS DAY</div>
        <div class="card-body">
          <div class="inline-form">
            <select id="storeCopyTarget">
              ${otherDays.map(d => `
                <option value="${esc(d.date)}">
                  ${esc(formatDate(d.date))}${d.shifts.length ? ` — has ${d.shifts.length} already` : ""}
                </option>
              `).join("")}
            </select>
            <button class="btn-quiet" id="storeCopyBtn">Copy</button>
          </div>
        </div>
      </div>
    ` : ""}
  `;
}

function storeCoverageCard(day) {
  // A holiday closure already said so in its own card; don't say it twice.
  if (day.closed_for_holiday) return "";

  if (day.closed) {
    return `
      <div class="card cool">
        <h3 style="color:var(--cool-text);">Closed on ${esc(day.weekday_name)}s</h3>
        <p style="margin:0; font-size:12.5px;">Nothing to cover. Change it in the store's hours below.</p>
      </div>
    `;
  }

  if (!day.hours) {
    return `
      <div class="card cool">
        <h3 style="color:var(--cool-text);">No hours set for ${esc(day.weekday_name)}s</h3>
        <p style="margin:0; font-size:12.5px;">
          Set the store's usual hours below and this will tell you whether
          the day is covered.
        </p>
      </div>
    `;
  }

  const chip = day.gaps.length
    ? `<span class="pill pill-warm">${day.gaps.length} gap${day.gaps.length === 1 ? "" : "s"}</span>`
    : day.shifts.length
      ? `<span class="pill pill-go">NO GAPS</span>`
      : `<span class="pill pill-warm">NOBODY ON</span>`;

  return `
    <div class="card cool" style="display:flex; align-items:flex-start; gap:10px;">
      <div style="flex:1;">
        <div style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:11.5px; letter-spacing:0.06em; color:var(--cool-text);">
          STORE ${esc(formatTime(day.hours.opens_at))} – ${esc(formatTime(day.hours.closes_at))}
        </div>
        <div style="font-size:11.5px; color:var(--cool-text); margin-top:2px;">
          ${day.covered
            ? `Covered ${esc(formatTime(day.covered.from))} – ${esc(formatTime(day.covered.to))}`
            : "Nobody on yet"}
        </div>
        ${day.gaps.length ? `
          <div style="font-size:11.5px; color:var(--cool-text); margin-top:6px;">
            ${day.gaps.map(gap =>
              `Uncovered ${esc(formatTime(gap.from))} – ${esc(formatTime(gap.to))}`
            ).join("<br>")}
          </div>
        ` : ""}
      </div>
      ${chip}
    </div>
  `;
}

/**
 * A store shift runs half an hour either side of the door — someone has to open
 * the till before the first customer and cash out after the last one. Derived
 * from the day's own hours rather than typed in, so a change to the store's
 * week moves every default with it, and a day on short holiday hours gets a
 * shift that fits them.
 */
const SHIFT_PAD_MINUTES = 30;

function shiftTime(hhmm, pad) {
  if (!/^\d{2}:\d{2}$/.test(hhmm || "")) return null;
  const [h, m] = hhmm.split(":").map(Number);
  const total = Math.min(Math.max(h * 60 + m + pad, 0), 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function storeShiftEditor(shift, day) {
  const { staff } = storeData;
  const minutes = shift ? shift.break_allotment_minutes : 30;
  const count = shift ? shift.break_count : 1;
  const defaultFrom = shiftTime(day.hours?.opens_at, -SHIFT_PAD_MINUTES) || "11:30";
  const defaultTo = shiftTime(day.hours?.closes_at, SHIFT_PAD_MINUTES) || "19:30";

  return `
    <div class="card" style="border-style:dashed;">
      <h3>${shift ? "Edit shift" : "New shift"}</h3>

      <div class="form-grid" style="margin:0;">
        <label>Who
          <select id="storeWho">
            <option value="">Unassigned</option>
            ${staff.map(person => {
              const clash = day.unavailable?.[person.id];
              return `
                <option value="${person.id}" ${shift?.employee_id === person.id ? "selected" : ""}>
                  ${esc(person.full_name)}${clash ? ` — ${esc(clash.reason)}` : ""}
                </option>
              `;
            }).join("")}
          </select>
        </label>
        <label>What
          <input type="text" id="storeWhat" value="${esc(shift?.title || "Store floor")}" placeholder="Store floor">
        </label>
        <label>Start
          <input type="time" id="storeFrom" value="${esc(shift?.starts_at || defaultFrom)}">
        </label>
        <label>End
          <input type="time" id="storeTo" value="${esc(shift?.ends_at || defaultTo)}">
        </label>
        <label>Break minutes
          <input type="number" id="storeBreakMins" value="${minutes}" min="0" max="240">
        </label>
        <label>Split into
          <select id="storeBreakCount">
            <option value="1" ${count === 1 ? "selected" : ""}>One break</option>
            <option value="2" ${count === 2 ? "selected" : ""}>Two breaks</option>
          </select>
        </label>
      </div>

      <div class="button-row">
        <button id="saveStoreShiftBtn" style="flex:1;">${shift ? "Save shift" : "Add shift"}</button>
        <button class="btn-quiet" id="cancelStoreShiftBtn">Cancel</button>
        ${shift ? `<button class="btn-danger" id="deleteStoreShiftBtn">Remove</button>` : ""}
      </div>
    </div>
  `;
}

/** The store's usual week — set once, drives every week's coverage check. */
function storeHoursCard() {
  if (!editingStoreHours) {
    const summary = storeData.store_hours.map(row =>
      row.is_closed || !row.opens_at
        ? `${row.name.slice(0, 3)} closed`
        : `${row.name.slice(0, 3)} ${formatTime(row.opens_at)}–${formatTime(row.closes_at)}`
    );

    return `
      <div class="card stripped">
        <div class="strip">
          STORE HOURS
          <button class="btn-quiet strip-side" id="editHoursBtn"
                  style="font-size:11.5px; padding:5px 9px; border-bottom-width:2px;">Edit</button>
        </div>
        <div class="card-body">
          <div class="meta" style="line-height:1.7;">${summary.map(esc).join("<br>")}</div>
        </div>
      </div>
    `;
  }

  return `
    <div class="card stripped">
      <div class="strip">STORE HOURS</div>
      <div class="card-body">
        ${storeData.store_hours.map(row => `
          <div class="inline-form" style="margin-bottom:8px;">
            <span style="width:78px; flex:none; font-family:'Fredoka',sans-serif; font-weight:600; font-size:12.5px;">
              ${esc(row.name)}
            </span>
            <input type="time" data-opens="${row.weekday}" value="${esc(row.opens_at)}" ${row.is_closed ? "disabled" : ""}>
            <input type="time" data-closes="${row.weekday}" value="${esc(row.closes_at)}" ${row.is_closed ? "disabled" : ""}>
            <label class="meta" style="display:flex; align-items:center; gap:5px; white-space:nowrap;">
              <input type="checkbox" data-closed="${row.weekday}" ${row.is_closed ? "checked" : ""}> Closed
            </label>
          </div>
        `).join("")}
        <p class="form-error" id="hoursError"></p>
        <div class="button-row">
          <button id="saveHoursBtn" style="flex:1;">Save hours</button>
          <button class="btn-quiet" id="cancelHoursBtn">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function wireStoreSchedule() {
  const reload = () => renderStoreSchedule(storeWeek, false);

  document.getElementById("prevWeekBtn").onclick = () => {
    storeDay = null;
    renderStoreSchedule(storeData.prev_from, false);
  };

  document.getElementById("nextWeekBtn").onclick = () => {
    storeDay = null;
    renderStoreSchedule(storeData.next_from, false);
  };

  document.querySelectorAll("[data-span]").forEach(pill => {
    pill.onclick = () => {
      // Keep the day you were looking at as the anchor, so switching from Week
      // to Month lands on the month you were already in rather than today's.
      storeSpan = pill.dataset.span;
      editingStoreShift = null;
      addingStoreShift = false;
      editingHoliday = null;
      renderStoreSchedule(storeDay || storeData.range_start, false);
    };
  });

  const customDays = document.getElementById("storeCustomDays");
  if (customDays) {
    customDays.onchange = () => {
      storeCustomDays = Math.min(Math.max(Number(customDays.value) || 7, 1), 62);
      renderStoreSchedule(storeData.range_start, false);
    };
  }

  const pickDay = date => {
    storeDay = date;
    editingStoreShift = null;
    addingStoreShift = false;
    editingHoliday = null;
    drawStoreSchedule();
  };

  document.querySelectorAll("[data-rota-day]").forEach(cell => {
    cell.onclick = () => pickDay(cell.dataset.rotaDay);
  });

  // Tapping a shift in the chart opens that shift, not just its day — the chart
  // is where you spot the wrong time, so it should be where you fix it.
  document.querySelectorAll("[data-rota-shift]").forEach(cell => {
    cell.onclick = event => {
      event.stopPropagation();
      storeDay = cell.dataset.rotaShiftDay;
      editingStoreShift = Number(cell.dataset.rotaShift);
      addingStoreShift = false;
      editingHoliday = null;
      drawStoreSchedule();
    };
  });

  const copyWeekBtn = document.getElementById("copyWeekBtn");
  if (copyWeekBtn) {
    copyWeekBtn.onclick = async () => {
      copyWeekBtn.disabled = true;

      const result = await apiSend("/api/schedule/copy-week", "POST", {
        from_week: storeData.prev_week,
        to_week: storeData.week_start
      });

      copyWeekBtn.disabled = false;

      if (!result.ok) {
        showFormError("copyWeekError", result.error || "Could not copy last week.");
        return;
      }

      await reload();
    };
  }

  document.querySelectorAll("[data-edit-shift]").forEach(card => {
    card.onclick = () => {
      editingStoreShift = Number(card.dataset.editShift);
      addingStoreShift = false;
      drawStoreSchedule();
    };
  });

  const addBtn = document.getElementById("addStoreShiftBtn");
  if (addBtn) {
    addBtn.onclick = () => {
      addingStoreShift = true;
      editingStoreShift = null;
      drawStoreSchedule();
    };
  }

  const cancelBtn = document.getElementById("cancelStoreShiftBtn");
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      editingStoreShift = null;
      addingStoreShift = false;
      drawStoreSchedule();
    };
  }

  const saveBtn = document.getElementById("saveStoreShiftBtn");
  if (saveBtn) {
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;

      const payload = {
        employee_id: document.getElementById("storeWho").value || null,
        title: document.getElementById("storeWhat").value,
        shift_date: storeDay,
        starts_at: document.getElementById("storeFrom").value,
        ends_at: document.getElementById("storeTo").value,
        break_allotment_minutes: Number(document.getElementById("storeBreakMins").value) || 0,
        break_count: Number(document.getElementById("storeBreakCount").value) || 1
      };

      const result = editingStoreShift
        ? await apiSend(`/api/convention-shifts/${editingStoreShift}`, "PATCH", payload)
        : await apiSend("/api/shifts", "POST", payload);

      saveBtn.disabled = false;

      if (!result.ok) {
        showFormError("storeError", result.error || "Could not save that shift.");
        return;
      }

      editingStoreShift = null;
      addingStoreShift = false;
      await reload();
    };
  }

  const deleteBtn = document.getElementById("deleteStoreShiftBtn");
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      await apiSend(`/api/convention-shifts/${editingStoreShift}`, "DELETE");
      editingStoreShift = null;
      await reload();
    };
  }

  const copyBtn = document.getElementById("storeCopyBtn");
  if (copyBtn) {
    copyBtn.onclick = async () => {
      copyBtn.disabled = true;
      const target = document.getElementById("storeCopyTarget").value;

      const result = await apiSend("/api/schedule/copy-day", "POST", {
        from_date: storeDay,
        to_date: target,
        convention_id: null
      });

      copyBtn.disabled = false;

      if (!result.ok) {
        showFormError("storeError", result.error || "Could not copy that day.");
        return;
      }

      storeDay = target;
      await reload();
    };
  }

  const editHoliday = document.getElementById("editHolidayBtn");
  if (editHoliday) {
    editHoliday.onclick = () => {
      const holiday = storeData.days.find(d => d.date === storeDay)?.holiday;
      editingHoliday = storeDay;
      holidayDraft = {
        // An undecided holiday opens on Closed, which is the answer most of them get.
        is_closed: holiday?.decided ? holiday.is_closed : true,
        opens_at: holiday?.opens_at || "",
        closes_at: holiday?.closes_at || ""
      };
      drawStoreSchedule();
    };
  }

  const cancelHoliday = document.getElementById("cancelHolidayBtn");
  if (cancelHoliday) {
    cancelHoliday.onclick = () => {
      editingHoliday = null;
      drawStoreSchedule();
    };
  }

  // Switching to Closed keeps any short hours already typed, in case it was a slip.
  for (const [id, closed] of [["holidayClosedBtn", true], ["holidayOpenBtn", false]]) {
    const button = document.getElementById(id);
    if (!button) continue;

    button.onclick = () => {
      if (!closed) {
        holidayDraft.opens_at = document.getElementById("holidayOpens")?.value || holidayDraft.opens_at;
        holidayDraft.closes_at = document.getElementById("holidayCloses")?.value || holidayDraft.closes_at;
      }
      holidayDraft.is_closed = closed;
      drawStoreSchedule();
    };
  }

  const saveHoliday = document.getElementById("saveHolidayBtn");
  if (saveHoliday) {
    saveHoliday.onclick = async () => {
      saveHoliday.disabled = true;

      const result = await apiSend("/api/schedule/holiday", "PUT", {
        holiday_date: editingHoliday,
        is_closed: holidayDraft.is_closed,
        opens_at: document.getElementById("holidayOpens")?.value || null,
        closes_at: document.getElementById("holidayCloses")?.value || null
      });

      saveHoliday.disabled = false;

      if (!result.ok) {
        showFormError("holidayError", result.error || "Could not save that.");
        return;
      }

      editingHoliday = null;
      await reload();
    };
  }

  const clearHoliday = document.getElementById("clearHolidayBtn");
  if (clearHoliday) {
    clearHoliday.onclick = async () => {
      await apiSend("/api/schedule/holiday", "PUT", {
        holiday_date: editingHoliday,
        clear: true
      });
      editingHoliday = null;
      await reload();
    };
  }

  const editHours = document.getElementById("editHoursBtn");
  if (editHours) {
    editHours.onclick = () => {
      editingStoreHours = true;
      drawStoreSchedule();
    };
  }

  const cancelHours = document.getElementById("cancelHoursBtn");
  if (cancelHours) {
    cancelHours.onclick = () => {
      editingStoreHours = false;
      drawStoreSchedule();
    };
  }

  // Ticking Closed greys that day's times rather than leaving stale ones on.
  document.querySelectorAll("[data-closed]").forEach(box => {
    box.onchange = () => {
      const weekday = box.dataset.closed;
      for (const attr of ["opens", "closes"]) {
        const input = document.querySelector(`[data-${attr}="${weekday}"]`);
        input.disabled = box.checked;
      }
    };
  });

  const saveHours = document.getElementById("saveHoursBtn");
  if (saveHours) {
    saveHours.onclick = async () => {
      saveHours.disabled = true;

      const hours = storeData.store_hours.map(row => ({
        weekday: row.weekday,
        opens_at: document.querySelector(`[data-opens="${row.weekday}"]`).value,
        closes_at: document.querySelector(`[data-closes="${row.weekday}"]`).value,
        is_closed: document.querySelector(`[data-closed="${row.weekday}"]`).checked
      }));

      const result = await apiSend("/api/schedule/store-hours", "PUT", { hours });
      saveHours.disabled = false;

      if (!result.ok) {
        showFormError("hoursError", result.error || "Could not save those hours.");
        return;
      }

      editingStoreHours = false;
      await reload();
    };
  }
}

window.renderSchedule = renderSchedule;
window.renderStoreSchedule = renderStoreSchedule;
