/* Conventions — schedules, booth layout, checklists and event info. */

let detailData = null;
let managingConvention = false;

const PHASE_LABELS = {
  upcoming: "Upcoming",
  active: "Happening now",
  past: "Past"
};

async function renderConventions(pushState = true) {
  if (pushState) pushPageState("conventions");

  const data = await api("/api/conventions");

  if (!data.ok) {
    renderError(data.error || "Could not load conventions");
    return;
  }

  const current = data.conventions.filter(c => c.phase !== "past");
  const past = data.conventions.filter(c => c.phase === "past").reverse();
  const crumbs = [{ label: "Conventions" }];

  pageArea().innerHTML = `
    ${setBreadcrumb(crumbs)}

    <div class="page-header">
      <h2>Conventions</h2>
      <p>Schedules, booth info and checklists for each event</p>
    </div>

    ${data.canManage ? `
      <div class="button-row" style="margin-bottom:18px;">
        <button id="newConventionBtn">New convention</button>
      </div>
    ` : ""}

    ${current.length
      ? `<div class="card-grid">${current.map(conventionCard).join("")}</div>`
      : `<div class="card">
           <p class="empty-state">
             ${data.canManage
               ? "No conventions yet. Use “New convention” above to add your first event — dates, setup and load-in times, booth number, maps and checklists all live inside it."
               : "No upcoming conventions yet."}
           </p>
         </div>`}

    ${past.length ? `
      <div class="card">
        <h3>Past events</h3>
        <ul class="file-list">
          ${past.map(c => `
            <li>
              <a href="#" data-convention="${esc(c.slug)}">${esc(c.name)}</a>
              <span class="meta"> — ${esc(formatDateRange(c.starts_on, c.ends_on))}</span>
            </li>
          `).join("")}
        </ul>
      </div>
    ` : ""}
  `;

  attachBreadcrumb(crumbs);

  document.querySelectorAll("[data-convention]").forEach(el => {
    el.onclick = (e) => {
      e.preventDefault();
      openConvention(el.dataset.convention);
    };
  });

  const newBtn = document.getElementById("newConventionBtn");
  if (newBtn) newBtn.onclick = () => renderConventionForm(null);
}

function conventionCard(convention) {
  return `
    <div class="action-card">
      <div class="badge-row">
        <span class="phase-badge phase-${esc(convention.phase)}">${esc(PHASE_LABELS[convention.phase])}</span>
        ${convention.is_published ? "" : '<span class="phase-badge phase-draft">Draft</span>'}
      </div>
      <h3>${esc(convention.name)}</h3>
      <p>
        ${esc(formatDateRange(convention.starts_on, convention.ends_on))}
        ${convention.venue ? `<br>${esc(convention.venue)}` : ""}
        ${convention.booth_number ? `<br>Booth ${esc(convention.booth_number)}` : ""}
      </p>
      ${convention.my_shift_count
        ? `<p class="meta">You have ${convention.my_shift_count} shift${convention.my_shift_count === 1 ? "" : "s"}.</p>`
        : ""}
      <button data-convention="${esc(convention.slug)}">Open</button>
    </div>
  `;
}

async function openConvention(slug, pushState = true) {
  if (pushState) pushPageState("convention", { slug });

  const data = await api(`/api/conventions/${encodeURIComponent(slug)}`);

  if (!data.ok) {
    renderError(data.error || "Could not load that convention");
    return;
  }

  detailData = data;

  // Internal reloads (after saving a day, shift or checklist) pass pushState
  // false — keep the manage panel open so editing isn't interrupted. Arriving
  // at a convention fresh starts collapsed.
  if (pushState) managingConvention = false;

  drawConvention();
}

function drawConvention() {
  const { convention, canManage } = detailData;
  const crumbs = [
    { label: "Conventions", view: () => renderConventions() },
    { label: convention.name }
  ];

  pageArea().innerHTML = `
    ${setBreadcrumb(crumbs)}

    <div class="page-header">
      <div class="badge-row">
        <span class="phase-badge phase-${esc(convention.phase)}">${esc(PHASE_LABELS[convention.phase])}</span>
        ${convention.is_published ? "" : '<span class="phase-badge phase-draft">Draft</span>'}
      </div>
      <h2>${esc(convention.name)}</h2>
      <p>${esc(formatDateRange(convention.starts_on, convention.ends_on))}</p>
    </div>

    ${canManage ? `
      <div class="button-row" style="margin-bottom:18px;">
        <button class="btn-quiet" id="toggleManageBtn">
          ${managingConvention ? "Done editing" : "Edit this convention"}
        </button>
      </div>
    ` : ""}

    ${eventInfoCard()}
    ${hoursCard()}
    ${myShiftsCard()}
    ${scheduleCard()}
    ${driveEmbedCard("Booth layout", convention.booth_layout_file_id)}
    ${driveEmbedCard("Venue map", convention.venue_map_file_id)}
    ${checklistsSection()}
    ${documentsCard()}
    ${managingConvention ? manageSection() : ""}
  `;

  attachBreadcrumb(crumbs);
  wireConventionDetail();
}

/**
 * Where the address should point. A pasted Google Maps link wins; otherwise fall
 * back to a Maps search for the address text so it's always tappable on a phone.
 */
function addressHref(convention) {
  if (convention.map_url) return convention.map_url;
  if (!convention.address) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(convention.address)}`;
}

function externalLink(href, label) {
  return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
}

function eventInfoCard() {
  const { convention } = detailData;
  const mapHref = addressHref(convention);

  const loadIn = convention.load_in_start && convention.load_in_end
    ? `${formatTime(convention.load_in_start)} – ${formatTime(convention.load_in_end)}`
    : convention.load_in_start
      ? `from ${formatTime(convention.load_in_start)}`
      : null;

  // [label, plain text, optional pre-built HTML that replaces the text]
  const rows = [
    ["Dates", formatDateRange(convention.starts_on, convention.ends_on)],
    ["Setup", formatDate(convention.setup_on)],
    ["Load-in", loadIn],
    ["Store closed", formatDate(convention.store_close_on)],
    ["Venue", convention.venue],
    ["Address", convention.address, mapHref ? externalLink(mapHref, convention.address) : null],
    ["Booth", convention.booth_number]
  ].filter(([, value]) => value);

  return `
    <div class="card">
      <div class="card-head">
        <h3>Event info</h3>
        ${detailData.canManage
          ? `<button class="btn-quiet" data-edit-event="1">Edit event info</button>`
          : ""}
      </div>
      <dl class="info-list">
        ${rows.map(([label, value, html]) => `
          <dt>${esc(label)}</dt><dd>${html || esc(value)}</dd>
        `).join("")}
      </dl>
      ${convention.notes
        ? `<h4>Important notes</h4><p class="notes-block">${esc(convention.notes)}</p>`
        : ""}
    </div>
  `;
}

const DAY_WINDOWS = [
  { key: "setup", label: "Setup" },
  { key: "early", label: "Early access" },
  { key: "regular", label: "Regular" }
];

function windowText(day, key) {
  const start = day[`${key}_start`];
  const end = day[`${key}_end`];
  return start && end ? `${formatTime(start)} – ${formatTime(end)}` : null;
}

/**
 * Small "jump to the editor" button for a read-only card. The management forms
 * live at the bottom of the page, so each card that displays data links to the
 * form that fills it in.
 */
function manageJumpButton(anchorId, label) {
  if (!detailData.canManage) return "";
  return `<button class="btn-quiet" data-manage-jump="${esc(anchorId)}">${esc(label)}</button>`;
}

function hoursCard() {
  const { days } = detailData;

  if (!days.length) {
    return `
      <div class="card">
        <div class="card-head">
          <h3>Hours of operation</h3>
          ${manageJumpButton("dayFormHeading", "Add hours")}
        </div>
        <p class="empty-state">No daily hours set for this event yet.</p>
      </div>
    `;
  }

  return `
    <div class="card">
      <div class="card-head">
        <h3>Hours of operation</h3>
        ${manageJumpButton("dayFormHeading", "Edit hours")}
      </div>
      <div class="hours-grid">
        ${days.map(day => `
          <div class="hours-day">
            <h4>${esc(formatDate(day.day_date))}</h4>
            <dl class="info-list">
              ${DAY_WINDOWS.map(({ key, label }) => {
                const text = windowText(day, key);
                return text ? `<dt>${esc(label)}</dt><dd>${esc(text)}</dd>` : "";
              }).join("")}
            </dl>
            ${day.notes ? `<p class="meta">${esc(day.notes)}</p>` : ""}
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function shiftLine(shift, { showName }) {
  return `
    <li>
      <div class="shift-time">${esc(formatTime(shift.starts_at))} – ${esc(formatTime(shift.ends_at))}</div>
      <div>
        <strong>${esc(shift.title)}</strong>
        ${showName
          ? `<span class="meta"> — ${shift.employee_name ? esc(shift.employee_name) : "Unassigned"}</span>`
          : ""}
        ${shift.notes ? `<div class="meta">${esc(shift.notes)}</div>` : ""}
      </div>
    </li>
  `;
}

function myShiftsCard() {
  const { myShifts } = detailData;

  if (!myShifts.length) {
    return `
      <div class="card">
        <h3>Your shifts</h3>
        <p class="empty-state">You're not on the schedule for this event yet.</p>
      </div>
    `;
  }

  return `
    <div class="card">
      <h3>Your shifts</h3>
      ${groupShiftsByDate(myShifts).map(([date, shifts]) => `
        <h4>${esc(formatDate(date))}</h4>
        <ul class="shift-list">${shifts.map(s => shiftLine(s, { showName: false })).join("")}</ul>
      `).join("")}
    </div>
  `;
}

function scheduleCard() {
  const { shifts } = detailData;

  return `
    <div class="card">
      <div class="card-head">
        <h3>Full schedule</h3>
        ${manageJumpButton("shiftFormHeading", shifts.length ? "Edit shifts" : "Add shifts")}
      </div>
      ${shifts.length
        ? groupShiftsByDate(shifts).map(([date, dayShifts]) => `
            <h4>${esc(formatDate(date))}</h4>
            <ul class="shift-list">
              ${dayShifts.map(s => `
                <li class="${s.is_mine ? "shift-mine" : ""}">
                  <div class="shift-time">${esc(formatTime(s.starts_at))} – ${esc(formatTime(s.ends_at))}</div>
                  <div>
                    <strong>${esc(s.title)}</strong>
                    <span class="meta"> — ${s.employee_name ? esc(s.employee_name) : "Unassigned"}</span>
                    ${s.notes ? `<div class="meta">${esc(s.notes)}</div>` : ""}
                  </div>
                </li>
              `).join("")}
            </ul>
          `).join("")
        : `<p class="empty-state">No shifts scheduled yet.</p>`}
    </div>
  `;
}

function groupShiftsByDate(shifts) {
  const groups = new Map();

  for (const shift of shifts) {
    if (!groups.has(shift.shift_date)) groups.set(shift.shift_date, []);
    groups.get(shift.shift_date).push(shift);
  }

  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/** Embeds a Drive file (booth layout, venue map) as a preview with a direct link. */
function driveEmbedCard(title, rawFileId) {
  if (!rawFileId) return "";

  const fileId = encodeURIComponent(rawFileId);

  return `
    <div class="card">
      <h3>${esc(title)}</h3>
      <div class="layout-frame">
        <iframe src="https://drive.google.com/file/d/${fileId}/preview"
                title="${esc(title)}" allow="autoplay"></iframe>
      </div>
      <p class="meta">
        Can't see it? You may need access to the file in Drive —
        <a href="https://drive.google.com/file/d/${fileId}/view"
           target="_blank" rel="noopener noreferrer">open it directly</a>.
      </p>
    </div>
  `;
}

function checklistsSection() {
  const { checklists } = detailData;

  if (!checklists.length) {
    return `
      <div class="card">
        <div class="card-head">
          <h3>Checklists</h3>
          ${manageJumpButton("checklistFormHeading", "Add a checklist")}
        </div>
        <p class="empty-state">No checklists for this event yet.</p>
      </div>
    `;
  }

  return checklists.map(list => {
    const done = list.items.filter(i => i.done).length;

    return `
      <div class="card">
        <div class="card-head">
          <h3>${esc(list.name)}</h3>
          <span class="meta">${done} of ${list.items.length} done</span>
        </div>
        ${list.visible_to !== "all"
          ? `<p class="meta">Visible to ${esc(list.visible_to)} only</p>`
          : ""}
        ${list.items.length
          ? `<ul class="checklist">
              ${list.items.map(item => `
                <li>
                  <label>
                    <input type="checkbox" data-check-item="${item.id}" ${item.done ? "checked" : ""}>
                    <span class="${item.done ? "checked-label" : ""}">${esc(item.label)}</span>
                  </label>
                  ${item.done && item.done_by_name
                    ? `<div class="meta check-meta">${esc(item.done_by_name)} · ${esc(formatDateTime(item.done_at))}</div>`
                    : ""}
                </li>
              `).join("")}
            </ul>`
          : `<p class="empty-state">Nothing on this list yet.</p>`}
      </div>
    `;
  }).join("");
}

function documentsCard() {
  const { convention, documents, documentsError } = detailData;

  if (!convention.drive_folder_id) return "";

  return `
    <div class="card">
      <div class="card-head">
        <h3>Documents</h3>
        <a class="meta" target="_blank" rel="noopener"
           href="https://drive.google.com/drive/folders/${encodeURIComponent(convention.drive_folder_id)}">
          Open folder in Drive
        </a>
      </div>
      ${documentsError
        ? `<p class="empty-state">Could not load this folder: ${esc(documentsError)}</p>`
        : documents.length
          ? `<ul class="file-list">
              ${documents.map(file => `
                <li><a href="#" data-doc-id="${esc(file.id)}" data-doc-name="${esc(file.name)}">${esc(file.name)}</a></li>
              `).join("")}
            </ul>`
          : `<p class="empty-state">No documents in this folder yet.</p>`}
    </div>
  `;
}

function wireConventionDetail() {
  const editEvent = document.querySelector("[data-edit-event]");
  if (editEvent) editEvent.onclick = () => renderConventionForm(detailData.convention);

  // Opens the management area (if it isn't already) and scrolls to the form that
  // edits whichever card was clicked.
  document.querySelectorAll("[data-manage-jump]").forEach(btn => {
    btn.onclick = () => {
      const anchorId = btn.dataset.manageJump;

      if (!managingConvention) {
        managingConvention = true;
        drawConvention();
      }

      const anchor = document.getElementById(anchorId);
      anchor?.scrollIntoView({ behavior: "smooth", block: "center" });
      anchor?.classList.add("flash-target");
      setTimeout(() => anchor?.classList.remove("flash-target"), 1600);
    };
  });

  const toggle = document.getElementById("toggleManageBtn");
  if (toggle) {
    toggle.onclick = () => {
      managingConvention = !managingConvention;
      drawConvention();
    };
  }

  document.querySelectorAll("[data-check-item]").forEach(box => {
    box.onchange = async () => {
      const id = Number(box.dataset.checkItem);
      box.disabled = true;

      const result = await apiSend(`/api/convention-checklist-items/${id}/toggle`, "POST", {
        done: box.checked
      });

      box.disabled = false;

      if (!result.ok) {
        box.checked = !box.checked;
        alert(result.error || "Could not update that item.");
        return;
      }

      await openConvention(detailData.convention.slug, false);
    };
  });

  document.querySelectorAll("[data-doc-id]").forEach(link => {
    link.onclick = (e) => {
      e.preventDefault();
      openDoc(link.dataset.docId, link.dataset.docName, {
        kind: "convention",
        label: detailData.convention.name,
        slug: detailData.convention.slug
      });
    };
  });

  wireManageSection();
}

/* ---------- Management (boss only) ---------- */

/** Next date in the event's range that doesn't have hours saved yet. */
function nextUnsetDay() {
  const { convention, days } = detailData;
  if (!convention.starts_on) return "";

  const taken = new Set(days.map(d => d.day_date));
  const end = convention.ends_on || convention.starts_on;

  for (let d = new Date(`${convention.starts_on}T00:00:00`);
       d <= new Date(`${end}T00:00:00`);
       d.setDate(d.getDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (!taken.has(iso)) return iso;
  }

  return "";
}

function manageSection() {
  const { convention, assignable, shifts, checklists, days } = detailData;

  return `
    <div class="card manage-card">
      <h3>Hours of operation</h3>
      ${days.length
        ? `<ul class="file-list">
            ${days.map(day => `
              <li class="manage-row">
                <span>
                  <strong>${esc(formatDate(day.day_date))}</strong>
                  ${DAY_WINDOWS.map(({ key, label }) => {
                    const text = windowText(day, key);
                    return text ? ` · ${esc(label)} ${esc(text)}` : "";
                  }).join("")}
                </span>
                <span class="button-row">
                  <button class="btn-quiet" data-edit-day="${day.id}">Edit</button>
                  <button class="btn-danger" data-delete-day="${day.id}">Remove</button>
                </span>
              </li>
            `).join("")}
          </ul>`
        : `<p class="empty-state">No daily hours yet.</p>`}

      <div class="lookup-bar">
        <button class="btn-quiet" id="lookupHoursBtn">Look up hours</button>
        <span class="meta">
          Searches the web for ${esc(convention.name)}'s published hours — around 20
          seconds. Setup and load-in times are usually only in the exhibitor kit, so
          expect to fill those in yourself.
        </span>
      </div>
      <p class="form-error" id="lookupHoursError"></p>
      <div id="lookupHoursResult"></div>

      <h4 id="dayFormHeading">Add a day</h4>
      <p class="meta">
        Saving a date that already has hours replaces them. Setup start fills in
        automatically as one hour before the earliest opening time, and you can
        change it. Leave a window blank if it doesn't apply that day.
      </p>
      <div class="form-grid">
        <label>Date <input type="date" id="dayDate" value="${esc(nextUnsetDay())}"></label>
        <label>Early access start <input type="time" id="dayEarlyStart"></label>
        <label>Early access end <input type="time" id="dayEarlyEnd"></label>
        <label>Regular start <input type="time" id="dayRegularStart"></label>
        <label>Regular end <input type="time" id="dayRegularEnd"></label>
        <label>Setup start <input type="time" id="daySetupStart"></label>
        <label>Setup end <input type="time" id="daySetupEnd"></label>
        <label>Notes <input type="text" id="dayNotes" placeholder="Optional"></label>
      </div>
      <div class="button-row">
        <button id="saveDayBtn">Save day</button>
        <button class="btn-quiet" id="clearDayBtn">Clear</button>
      </div>
      <p class="form-error" id="dayError"></p>
    </div>

    <div class="card manage-card">
      <h3>Shifts</h3>
      ${shifts.length
        ? `<ul class="file-list">
            ${shifts.map(s => `
              <li class="manage-row">
                <span>
                  ${esc(formatDate(s.shift_date))} · ${esc(formatTime(s.starts_at))}–${esc(formatTime(s.ends_at))}
                  · <strong>${esc(s.title)}</strong>
                  · ${s.employee_name ? esc(s.employee_name) : "Unassigned"}
                </span>
                <button class="btn-danger" data-delete-shift="${s.id}">Remove</button>
              </li>
            `).join("")}
          </ul>`
        : `<p class="empty-state">No shifts yet.</p>`}

      <h4 id="shiftFormHeading">Add a shift</h4>
      <div class="form-grid">
        <label>What <input type="text" id="shiftTitle" placeholder="Booth setup"></label>
        <label>Who
          <select id="shiftEmployee">
            <option value="">Unassigned</option>
            ${assignable.map(p => `<option value="${p.id}">${esc(p.full_name)}</option>`).join("")}
          </select>
        </label>
        <label>Date <input type="date" id="shiftDate" value="${esc(convention.starts_on || "")}"></label>
        <label>Start <input type="time" id="shiftStart" value="09:00"></label>
        <label>End <input type="time" id="shiftEnd" value="17:00"></label>
        <label>Notes <input type="text" id="shiftNotes" placeholder="Optional"></label>
      </div>
      <div class="button-row"><button id="addShiftBtn">Add shift</button></div>
      <p class="form-error" id="shiftError"></p>
    </div>

    <div class="card manage-card">
      <h3>Checklists</h3>
      ${checklists.map(list => `
        <div class="manage-list">
          <div class="manage-row">
            <strong>${esc(list.name)}</strong>
            <button class="btn-danger" data-delete-checklist="${list.id}">Remove list</button>
          </div>
          <ul class="file-list">
            ${list.items.map(item => `
              <li class="manage-row">
                <span>${esc(item.label)}</span>
                <button class="btn-danger" data-delete-item="${item.id}">Remove</button>
              </li>
            `).join("")}
          </ul>
          <div class="inline-form">
            <input type="text" data-new-item-for="${list.id}" placeholder="Add an item">
            <button data-add-item="${list.id}">Add</button>
          </div>
        </div>
      `).join("")}

      <h4 id="checklistFormHeading">Add a checklist</h4>
      <div class="form-grid">
        <label>Name <input type="text" id="checklistName" placeholder="Pre-show packing"></label>
        <label>Visible to
          <select id="checklistVisibility">
            <option value="all">Everyone</option>
            <option value="staff">Staff and Boss</option>
            <option value="boss">Boss only</option>
          </select>
        </label>
      </div>
      <div class="button-row"><button id="addChecklistBtn">Add checklist</button></div>
      <p class="form-error" id="checklistError"></p>
    </div>

    <div class="card manage-card">
      <h3>This convention</h3>
      <p class="meta">
        “Edit event info” changes the name, venue, dates and links at the top of
        the page. Hours, shifts and checklists are edited in the boxes above.
      </p>
      <div class="button-row">
        <button id="editConventionBtn">Edit event info</button>
        <button class="btn-danger" id="deleteConventionBtn">Delete convention</button>
      </div>
    </div>
  `;
}

const DAY_FIELD_IDS = {
  day_date: "dayDate",
  setup_start: "daySetupStart",
  setup_end: "daySetupEnd",
  early_start: "dayEarlyStart",
  early_end: "dayEarlyEnd",
  regular_start: "dayRegularStart",
  regular_end: "dayRegularEnd",
  notes: "dayNotes"
};

function readDayForm() {
  const payload = {};
  for (const [field, id] of Object.entries(DAY_FIELD_IDS)) {
    payload[field] = document.getElementById(id).value;
  }
  return payload;
}

function fillDayForm(day) {
  for (const [field, id] of Object.entries(DAY_FIELD_IDS)) {
    document.getElementById(id).value = day?.[field] || "";
  }
}

/** "09:00" -> "08:00". Returns null if it would cross midnight. */
function oneHourEarlier(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h) || isNaN(m) || h < 1) return null;
  return `${String(h - 1).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

let suggestedDays = [];

/** Renders looked-up days for review. Each one loads into the form; nothing auto-saves. */
function drawSuggestedDays(suggestion) {
  suggestedDays = suggestion.days;

  document.getElementById("lookupHoursResult").innerHTML = `
    ${lookupSummary(suggestion)}
    ${suggestedDays.length
      ? `<ul class="file-list">
          ${suggestedDays.map((day, i) => `
            <li class="manage-row">
              <span>
                <strong>${esc(formatDate(day.day_date))}</strong>
                ${DAY_WINDOWS.map(({ key, label }) => {
                  const text = windowText(day, key);
                  return text ? ` · ${esc(label)} ${esc(text)}` : "";
                }).join("")}
                ${day.notes ? `<div class="meta">${esc(day.notes)}</div>` : ""}
              </span>
              <button class="btn-quiet" data-use-suggested="${i}">Load into form</button>
            </li>
          `).join("")}
        </ul>
        <p class="meta">
          Loading a day fills the form below — check it, add setup times if you have
          them, then press Save day.
        </p>`
      : `<p class="empty-state">No usable hours found. Enter them by hand below.</p>`}
  `;

  document.querySelectorAll("[data-use-suggested]").forEach(btn => {
    btn.onclick = () => {
      const day = suggestedDays[Number(btn.dataset.useSuggested)];
      fillDayForm(day);
      const heading = document.getElementById("dayFormHeading");
      heading.textContent = `Reviewing ${formatDate(day.day_date)}`;
      heading.scrollIntoView({ behavior: "smooth", block: "center" });
      heading.classList.add("flash-target");
      setTimeout(() => heading.classList.remove("flash-target"), 1600);
    };
  });
}

function wireDayForm(conventionId, reload) {
  const saveBtn = document.getElementById("saveDayBtn");
  if (!saveBtn) return;

  const lookupHoursBtn = document.getElementById("lookupHoursBtn");
  if (lookupHoursBtn) {
    lookupHoursBtn.onclick = () =>
      runLookup(detailData.convention.name, {
        button: lookupHoursBtn,
        errorId: "lookupHoursError",
        onResult: drawSuggestedDays
      });
  }

  const setupStart = document.getElementById("daySetupStart");
  const setupEnd = document.getElementById("daySetupEnd");

  // Setup runs the hour before doors, so derive it from whichever opening time
  // comes first — but never overwrite a value that's already been typed in.
  const suggestSetup = () => {
    const opens = [
      document.getElementById("dayEarlyStart").value,
      document.getElementById("dayRegularStart").value
    ].filter(Boolean).sort()[0];

    if (!opens) return;

    const hourBefore = oneHourEarlier(opens);
    if (!hourBefore) return;

    if (!setupStart.value) setupStart.value = hourBefore;
    if (!setupEnd.value) setupEnd.value = opens;
  };

  document.getElementById("dayEarlyStart").onchange = suggestSetup;
  document.getElementById("dayRegularStart").onchange = suggestSetup;

  document.getElementById("clearDayBtn").onclick = () => {
    fillDayForm(null);
    document.getElementById("dayDate").value = nextUnsetDay();
    showFormError("dayError", "");
  };

  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    const result = await apiSend(`/api/conventions/${conventionId}/days`, "POST", readDayForm());
    saveBtn.disabled = false;

    if (!result.ok) {
      showFormError("dayError", result.error || "Could not save that day.");
      return;
    }

    await reload();
  };

  document.querySelectorAll("[data-edit-day]").forEach(btn => {
    btn.onclick = () => {
      const day = detailData.days.find(d => d.id === Number(btn.dataset.editDay));
      fillDayForm(day);
      document.getElementById("dayFormHeading").textContent = `Editing ${formatDate(day.day_date)}`;
      document.getElementById("dayFormHeading").scrollIntoView({ behavior: "smooth", block: "center" });
    };
  });

  document.querySelectorAll("[data-delete-day]").forEach(btn => {
    btn.onclick = async () => {
      await apiSend(`/api/convention-days/${btn.dataset.deleteDay}`, "DELETE");
      await reload();
    };
  });
}

function wireManageSection() {
  if (!managingConvention) return;

  const conventionId = detailData.convention.id;
  const reload = () => openConvention(detailData.convention.slug, false);

  wireDayForm(conventionId, reload);

  const addShift = document.getElementById("addShiftBtn");
  if (addShift) {
    addShift.onclick = async () => {
      addShift.disabled = true;

      const result = await apiSend(`/api/conventions/${conventionId}/shifts`, "POST", {
        title: document.getElementById("shiftTitle").value,
        employee_id: document.getElementById("shiftEmployee").value || null,
        shift_date: document.getElementById("shiftDate").value,
        starts_at: document.getElementById("shiftStart").value,
        ends_at: document.getElementById("shiftEnd").value,
        notes: document.getElementById("shiftNotes").value
      });

      addShift.disabled = false;

      if (!result.ok) {
        showFormError("shiftError", result.error || "Could not add that shift.");
        return;
      }

      await reload();
    };
  }

  document.querySelectorAll("[data-delete-shift]").forEach(btn => {
    btn.onclick = async () => {
      await apiSend(`/api/convention-shifts/${btn.dataset.deleteShift}`, "DELETE");
      await reload();
    };
  });

  const addChecklist = document.getElementById("addChecklistBtn");
  if (addChecklist) {
    addChecklist.onclick = async () => {
      addChecklist.disabled = true;

      const result = await apiSend(`/api/conventions/${conventionId}/checklists`, "POST", {
        name: document.getElementById("checklistName").value,
        visible_to: document.getElementById("checklistVisibility").value
      });

      addChecklist.disabled = false;

      if (!result.ok) {
        showFormError("checklistError", result.error || "Could not add that checklist.");
        return;
      }

      await reload();
    };
  }

  document.querySelectorAll("[data-delete-checklist]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("Remove this checklist and everything on it?")) return;
      await apiSend(`/api/convention-checklists/${btn.dataset.deleteChecklist}`, "DELETE");
      await reload();
    };
  });

  document.querySelectorAll("[data-add-item]").forEach(btn => {
    btn.onclick = async () => {
      const listId = btn.dataset.addItem;
      const input = document.querySelector(`[data-new-item-for="${listId}"]`);

      const result = await apiSend(`/api/convention-checklists/${listId}/items`, "POST", {
        label: input.value
      });

      if (!result.ok) {
        showFormError("checklistError", result.error || "Could not add that item.");
        return;
      }

      await reload();
    };
  });

  document.querySelectorAll("[data-delete-item]").forEach(btn => {
    btn.onclick = async () => {
      await apiSend(`/api/convention-checklist-items/${btn.dataset.deleteItem}`, "DELETE");
      await reload();
    };
  });

  const editBtn = document.getElementById("editConventionBtn");
  if (editBtn) editBtn.onclick = () => renderConventionForm(detailData.convention);

  const deleteBtn = document.getElementById("deleteConventionBtn");
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      if (!confirm(`Delete "${detailData.convention.name}" and all of its shifts and checklists? This can't be undone.`)) {
        return;
      }

      const result = await apiSend(`/api/conventions/${conventionId}`, "DELETE");

      if (!result.ok) {
        alert(result.error || "Could not delete that convention.");
        return;
      }

      await renderConventions();
    };
  }
}

/* ---------- AI lookup ---------- */

const CONFIDENCE_LABELS = {
  high: "Found on the official site",
  medium: "Found, but check it",
  low: "Uncertain — verify everything"
};

/** Shared result panel: how confident it was, what it couldn't find, and sources. */
function lookupSummary(suggestion) {
  return `
    <div class="lookup-result">
      <div class="badge-row">
        <span class="phase-badge confidence-${esc(suggestion.confidence)}">
          ${esc(CONFIDENCE_LABELS[suggestion.confidence] || suggestion.confidence)}
        </span>
      </div>
      ${suggestion.notes ? `<p class="meta">${esc(suggestion.notes)}</p>` : ""}
      ${suggestion.event.website
        ? `<p class="meta">Official site: ${externalLink(suggestion.event.website, suggestion.event.website)}</p>`
        : ""}
      ${suggestion.sources.length
        ? `<p class="meta">Sources: ${suggestion.sources
            .map(s => externalLink(s.url, s.title || s.url))
            .join(" · ")}</p>`
        : ""}
    </div>
  `;
}

async function runLookup(name, { button, errorId, onResult }) {
  if (!name.trim()) {
    showFormError(errorId, "Enter the convention's name first.");
    return;
  }

  const originalLabel = button.textContent;
  button.disabled = true;
  showFormError(errorId, "");

  // A silent 20-second button reads as broken, so show it counting.
  const startedAt = Date.now();
  const tick = () => {
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    button.textContent = `Searching… ${seconds}s`;
  };
  tick();
  const ticker = setInterval(tick, 1000);

  let result;
  try {
    result = await apiSend("/api/convention-lookup", "POST", { name });
  } catch {
    // Usually the edge cutting off a search that ran past ~100 seconds.
    result = {
      ok: false,
      error: "The search took too long and was cut off. Obscure conventions are slower — try again, or enter the details by hand."
    };
  } finally {
    clearInterval(ticker);
    button.disabled = false;
    button.textContent = originalLabel;
  }

  if (!result.ok) {
    showFormError(errorId, result.error || "The lookup failed.");
    return;
  }

  if (!result.suggestion.found) {
    showFormError(errorId, "Couldn't identify that convention. Check the spelling, or add the year.");
    return;
  }

  onResult(result.suggestion);
}

function renderConventionForm(convention) {
  const editing = Boolean(convention);
  const crumbs = [
    { label: "Conventions", view: () => renderConventions() },
    { label: editing ? `Edit ${convention.name}` : "New convention" }
  ];

  pageArea().innerHTML = `
    ${setBreadcrumb(crumbs)}

    <div class="page-header">
      <h2>${editing ? "Edit convention" : "New convention"}</h2>
      <p>Event details shown to everyone who can see this convention</p>
    </div>

    <div class="card">
      <div class="lookup-bar">
        <button class="btn-quiet" id="lookupBtn">Look up details</button>
        <span class="meta">
          Type the convention's name, then let this search the web and fill in the
          blanks. Takes around 20 seconds. It only fills fields you've left empty,
          and never saves on its own — check everything before you do.
        </span>
      </div>
      <p class="form-error" id="lookupError"></p>
      <div id="lookupResult"></div>

      <div class="form-grid">
        <label>Name <input type="text" id="cName" value="${esc(convention?.name || "")}" placeholder="Anime North 2026"></label>
        <label>Venue <input type="text" id="cVenue" value="${esc(convention?.venue || "")}" placeholder="Toronto Congress Centre"></label>
        <label>Start date <input type="date" id="cStart" value="${esc(convention?.starts_on || "")}"></label>
        <label>End date <input type="date" id="cEnd" value="${esc(convention?.ends_on || "")}"></label>
        <label>Setup date <input type="date" id="cSetup" value="${esc(convention?.setup_on || "")}"></label>
        <label>Store close date <input type="date" id="cStoreClose" value="${esc(convention?.store_close_on || "")}"></label>
        <label>Load-in start <input type="time" id="cLoadInStart" value="${esc(convention?.load_in_start || "")}"></label>
        <label>Load-in end <input type="time" id="cLoadInEnd" value="${esc(convention?.load_in_end || "")}"></label>
        <label>Booth number <input type="text" id="cBooth" value="${esc(convention?.booth_number || "")}" placeholder="A-14"></label>
        <label>Address <input type="text" id="cAddress" value="${esc(convention?.address || "")}" placeholder="Optional"></label>
        <label>Google Maps link
          <input type="url" id="cMapUrl" value="${esc(convention?.map_url || "")}"
                 placeholder="Optional — links the address automatically if blank">
        </label>
        <label>Drive folder ID <input type="text" id="cFolder" value="${esc(convention?.drive_folder_id || "")}" placeholder="Optional"></label>
        <label>Booth layout file ID
          <input type="text" id="cLayout" value="${esc(convention?.booth_layout_file_id || "")}"
                 placeholder="Optional — Drive file ID">
        </label>
        <label>Venue map file ID
          <input type="text" id="cVenueMapFileId" value="${esc(convention?.venue_map_file_id || "")}"
                 placeholder="Optional — Drive file ID of the hall/floor plan">
        </label>
      </div>

      <label class="block-label">Important notes
        <textarea id="cNotes" rows="6" placeholder="Load-in times, parking, dress code, anything staff need to know">${esc(convention?.notes || "")}</textarea>
      </label>

      <label class="checkbox-label">
        <input type="checkbox" id="cPublished" ${convention?.is_published === false ? "" : "checked"}>
        Visible to staff and volunteers
      </label>

      <div class="button-row">
        <button id="saveConventionBtn">${editing ? "Save changes" : "Create convention"}</button>
        <button class="btn-quiet" id="cancelConventionBtn">Cancel</button>
      </div>
      <p class="form-error" id="conventionError"></p>
    </div>
  `;

  attachBreadcrumb(crumbs);

  const lookupBtn = document.getElementById("lookupBtn");
  lookupBtn.onclick = () =>
    runLookup(document.getElementById("cName").value, {
      button: lookupBtn,
      errorId: "lookupError",
      onResult: (suggestion) => {
        // Only fill blanks, so a lookup can't overwrite something you typed.
        const fills = [
          ["cName", suggestion.event.name],
          ["cVenue", suggestion.event.venue],
          ["cAddress", suggestion.event.address],
          ["cStart", suggestion.event.starts_on],
          ["cEnd", suggestion.event.ends_on]
        ];

        const filled = [];
        for (const [id, value] of fills) {
          const input = document.getElementById(id);
          if (value && !input.value) {
            input.value = value;
            input.classList.add("flash-target");
            setTimeout(() => input.classList.remove("flash-target"), 1600);
            filled.push(input.closest("label").firstChild.textContent.trim());
          }
        }

        document.getElementById("lookupResult").innerHTML = `
          ${lookupSummary(suggestion)}
          <p class="meta">
            ${filled.length
              ? `Filled in: ${esc(filled.join(", "))}.`
              : "Nothing to fill — those fields already have values."}
            ${suggestion.days.length
              ? ` Found hours for ${suggestion.days.length} day${suggestion.days.length === 1 ? "" : "s"} — save this convention first, then use “Look up hours” on its page.`
              : ""}
          </p>
        `;
      }
    });

  document.getElementById("cancelConventionBtn").onclick = () =>
    editing ? openConvention(convention.slug) : renderConventions();

  const saveBtn = document.getElementById("saveConventionBtn");
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;

    const payload = {
      name: document.getElementById("cName").value,
      venue: document.getElementById("cVenue").value,
      address: document.getElementById("cAddress").value,
      starts_on: document.getElementById("cStart").value,
      ends_on: document.getElementById("cEnd").value,
      setup_on: document.getElementById("cSetup").value,
      store_close_on: document.getElementById("cStoreClose").value,
      load_in_start: document.getElementById("cLoadInStart").value,
      load_in_end: document.getElementById("cLoadInEnd").value,
      map_url: document.getElementById("cMapUrl").value,
      venue_map_file_id: document.getElementById("cVenueMapFileId").value,
      booth_number: document.getElementById("cBooth").value,
      drive_folder_id: document.getElementById("cFolder").value,
      booth_layout_file_id: document.getElementById("cLayout").value,
      notes: document.getElementById("cNotes").value,
      is_published: document.getElementById("cPublished").checked
    };

    const result = editing
      ? await apiSend(`/api/conventions/${convention.id}`, "PATCH", payload)
      : await apiSend("/api/conventions", "POST", payload);

    saveBtn.disabled = false;

    if (!result.ok) {
      showFormError("conventionError", result.error || "Could not save that.");
      return;
    }

    await openConvention(result.slug);
  };
}

window.renderConventions = renderConventions;
window.openConvention = openConvention;
