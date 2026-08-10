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
      : `<div class="card"><p class="empty-state">No upcoming conventions yet.</p></div>`}

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
  managingConvention = false;
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
    ${myShiftsCard()}
    ${scheduleCard()}
    ${boothLayoutCard()}
    ${checklistsSection()}
    ${documentsCard()}
    ${managingConvention ? manageSection() : ""}
  `;

  attachBreadcrumb(crumbs);
  wireConventionDetail();
}

function eventInfoCard() {
  const { convention } = detailData;

  const rows = [
    ["Dates", formatDateRange(convention.starts_on, convention.ends_on)],
    ["Setup", formatDate(convention.setup_on)],
    ["Store closed", formatDate(convention.store_close_on)],
    ["Venue", convention.venue],
    ["Address", convention.address],
    ["Booth", convention.booth_number]
  ].filter(([, value]) => value);

  return `
    <div class="card">
      <h3>Event info</h3>
      <dl class="info-list">
        ${rows.map(([label, value]) => `
          <dt>${esc(label)}</dt><dd>${esc(value)}</dd>
        `).join("")}
      </dl>
      ${convention.notes
        ? `<h4>Important notes</h4><p class="notes-block">${esc(convention.notes)}</p>`
        : ""}
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
      <h3>Full schedule</h3>
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

function boothLayoutCard() {
  const { convention } = detailData;

  if (!convention.booth_layout_file_id) return "";

  const fileId = encodeURIComponent(convention.booth_layout_file_id);

  return `
    <div class="card">
      <h3>Booth layout</h3>
      <div class="layout-frame">
        <iframe src="https://drive.google.com/file/d/${fileId}/preview"
                title="Booth layout" allow="autoplay"></iframe>
      </div>
      <p class="meta">
        Can't see it? You may need access to the file in Drive —
        <a href="https://drive.google.com/file/d/${fileId}/view" target="_blank" rel="noopener">open it directly</a>.
      </p>
    </div>
  `;
}

function checklistsSection() {
  const { checklists } = detailData;

  if (!checklists.length) {
    return `
      <div class="card">
        <h3>Checklists</h3>
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

function manageSection() {
  const { convention, assignable, shifts, checklists } = detailData;

  return `
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

      <h4>Add a shift</h4>
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

      <h4>Add a checklist</h4>
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
      <h3>Event details</h3>
      <div class="button-row">
        <button id="editConventionBtn">Edit event details</button>
        <button class="btn-danger" id="deleteConventionBtn">Delete convention</button>
      </div>
    </div>
  `;
}

function wireManageSection() {
  if (!managingConvention) return;

  const conventionId = detailData.convention.id;
  const reload = () => openConvention(detailData.convention.slug, false);

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
      <div class="form-grid">
        <label>Name <input type="text" id="cName" value="${esc(convention?.name || "")}" placeholder="Anime North 2026"></label>
        <label>Venue <input type="text" id="cVenue" value="${esc(convention?.venue || "")}" placeholder="Toronto Congress Centre"></label>
        <label>Start date <input type="date" id="cStart" value="${esc(convention?.starts_on || "")}"></label>
        <label>End date <input type="date" id="cEnd" value="${esc(convention?.ends_on || "")}"></label>
        <label>Setup date <input type="date" id="cSetup" value="${esc(convention?.setup_on || "")}"></label>
        <label>Store close date <input type="date" id="cStoreClose" value="${esc(convention?.store_close_on || "")}"></label>
        <label>Booth number <input type="text" id="cBooth" value="${esc(convention?.booth_number || "")}" placeholder="A-14"></label>
        <label>Address <input type="text" id="cAddress" value="${esc(convention?.address || "")}" placeholder="Optional"></label>
        <label>Drive folder ID <input type="text" id="cFolder" value="${esc(convention?.drive_folder_id || "")}" placeholder="Optional"></label>
        <label>Booth layout file ID <input type="text" id="cLayout" value="${esc(convention?.booth_layout_file_id || "")}" placeholder="Optional"></label>
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
