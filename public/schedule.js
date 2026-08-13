/* Schedule builder — a convention's shifts, one day at a time.
   The question it answers on every screen: is the booth covered for the
   whole time the doors are open? */

let scheduleData = null;
let scheduleDay = null;
let editingShiftId = null;
let addingShift = false;

async function renderSchedule(slug, pushState = true) {
  if (pushState) pushPageState("schedule", { slug });

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
      editingShiftId === shift.id ? shiftEditor(shift) : shiftCard(shift)
    ).join("")}

    ${addingShift ? shiftEditor(null) : `
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

function shiftCard(shift) {
  const person = shift.employee_id
    ? { name: shift.employee_name, avatar_url: shift.avatar_url }
    : null;

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
    </div>
  `;
}

/** The inline editor. A null shift means we're adding a new one. */
function shiftEditor(shift) {
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
            ${staff.map(person => `
              <option value="${person.id}" ${shift?.employee_id === person.id ? "selected" : ""}>
                ${esc(person.full_name)}
              </option>
            `).join("")}
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

      const result = await apiSend(`/api/conventions/${scheduleData.convention.id}/copy-day`, "POST", {
        from_date: scheduleDay,
        to_date: document.getElementById("copyTarget").value
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

window.renderSchedule = renderSchedule;
