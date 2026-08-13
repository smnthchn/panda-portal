/* Staff — the people: their details, their folder, and their shifts.
   Roles and permissions stay in Users & Roles; this is the person, not
   their login. */

let staffData = null;
let staffMember = null;

async function renderStaff(pushState = true) {
  if (pushState) pushPageState("staff");

  const data = await api("/api/admin/staff");

  if (!data.ok) {
    renderError(data.error || "Could not load staff");
    return;
  }

  staffData = data;
  const active = data.staff.filter(p => p.is_active);
  const inactive = data.staff.filter(p => !p.is_active);

  pageArea().innerHTML = `
    <div class="page-header">
      <h2>Staff</h2>
      <p>Everyone who works here — details, folders and shifts</p>
    </div>

    ${active.length
      ? `<div class="card-grid">${active.map(staffCard).join("")}</div>`
      : `<div class="card"><p class="empty-state">Nobody on the team yet.</p></div>`}

    ${inactive.length ? `
      <div class="card stripped">
        <div class="strip">NO LONGER ACTIVE<span class="strip-side">${inactive.length}</span></div>
        <div class="card-body">
          <ul class="file-list">
            ${inactive.map(person => `
              <li><a href="#" data-staff="${person.id}">${esc(person.full_name)}</a>
                <span class="meta"> — ${esc(roleDisplayName(person.role))}</span></li>
            `).join("")}
          </ul>
        </div>
      </div>
    ` : ""}

    <div class="card cool">
      <h3>Adding someone</h3>
      <p style="margin:0; font-size:12.5px; line-height:1.45;">
        New people are added on <a href="#" id="staffToUsers">Users &amp; Roles</a>,
        which is also where roles and access are set. Their details, folder and
        shifts are edited here.
      </p>
    </div>
  `;

  markActiveNav("staff", { wide: true });

  document.querySelectorAll("[data-staff]").forEach(el => {
    el.onclick = (e) => {
      e.preventDefault();
      openStaffMember(Number(el.dataset.staff));
    };
  });

  document.getElementById("staffToUsers").onclick = (e) => {
    e.preventDefault();
    goToView("users-roles");
  };
}

function staffCard(person) {
  const lines = [
    person.email,
    person.phone,
    person.location
  ].filter(Boolean);

  return `
    <div class="action-card" style="display:flex; gap:12px; align-items:flex-start;">
      ${avatarHtml(person)}
      <div style="flex:1; min-width:0;">
        <div class="badge-row" style="margin-bottom:4px;">
          <span class="pill">${esc(roleDisplayName(person.role))}</span>
          ${person.upcoming_shifts
            ? `<span class="pill pill-go">${person.upcoming_shifts} upcoming shift${person.upcoming_shifts === 1 ? "" : "s"}</span>`
            : ""}
          ${person.google_drive_folder_id ? "" : `<span class="pill">No folder</span>`}
        </div>
        <h3 style="margin:0 0 4px;">${esc(person.full_name)}</h3>
        <p style="margin:0 0 12px;">${lines.map(esc).join("<br>")}</p>
        <button data-staff="${person.id}">Open</button>
      </div>
    </div>
  `;
}

async function openStaffMember(id, pushState = true) {
  if (pushState) pushPageState("staff-member", { id });

  const data = await api(`/api/admin/staff/${id}`);

  if (!data.ok) {
    renderError(data.error || "Could not load that person");
    return;
  }

  staffMember = data;
  drawStaffMember();
}

function drawStaffMember() {
  const { person, shifts, openShifts, isSelf } = staffMember;
  const today = todayLocal();
  const upcoming = shifts.filter(s => s.shift_date >= today);
  const past = shifts.filter(s => s.shift_date < today);
  const upcomingTimeOff = staffMember.timeOff.filter(r => r.ends_on >= today);
  const pendingTimeOff = upcomingTimeOff.filter(r => r.status === "pending");

  pageArea().innerHTML = `
    <div class="title-row">
      <button class="back-tile" id="staffBackBtn">‹</button>
      <div style="flex:1;">
        <h2 style="margin:0;">${esc(person.full_name)}</h2>
        <div class="meta">
          ${esc(roleDisplayName(person.role))}${person.is_active ? "" : " · no longer active"}
        </div>
      </div>
    </div>

    <div class="card stripped">
      <div class="strip">
        AVATAR
        ${person.avatar_url ? `<button class="btn-danger strip-side" id="removeAvatarBtn">Remove</button>` : ""}
      </div>
      <div class="card-body" style="display:flex; align-items:center; gap:14px;">
        ${avatarHtml(person, "large")}
        <div style="flex:1;">
          <label class="btn-quiet" for="avatarInput"
                 style="display:inline-block; font-family:'Fredoka',sans-serif; font-weight:600;
                        font-size:14px; padding:10px 14px; border:2px solid var(--ink);
                        border-bottom-width:4px; border-radius:12px; cursor:pointer;">
            ${person.avatar_url ? "Replace picture" : "Upload picture"}
          </label>
          <input type="file" id="avatarInput" accept="image/png,image/jpeg,image/webp" style="display:none;">
          <p class="meta" style="margin:6px 0 0;">
            Their illustration, squared off and shrunk to 256px here in the
            browser before it's saved. PNG, JPEG or WebP.
          </p>
        </div>
      </div>
    </div>

    <div class="card stripped">
      <div class="strip">DETAILS</div>
      <div class="card-body">
        <div class="form-grid" style="margin:0;">
          <label>Full name <input type="text" id="sName" value="${esc(person.full_name)}"></label>
          <label>Phone <input type="tel" id="sPhone" value="${esc(person.phone || "")}" placeholder="Optional"></label>
          <label>Location <input type="text" id="sLocation" value="${esc(person.location || "")}" placeholder="Store, booth, remote…"></label>
          <label>Started <input type="date" id="sStarted" value="${esc(person.started_on || "")}"></label>
        </div>

        <label class="block-label" style="margin:10px 0 0;">Google account
          <input type="email" id="sEmail" value="${esc(person.email)}">
        </label>
        <p class="meta" style="margin:4px 0 0;">
          They sign in with this address, so it has to be the Google account they
          actually use.${isSelf ? " This is you — changing it changes your own login." : ""}
        </p>

        <label class="block-label" style="margin:12px 0 0;">Notes
          <textarea id="sNotes" rows="3" placeholder="Availability, emergency contact, anything worth remembering">${esc(person.notes || "")}</textarea>
        </label>
      </div>
    </div>

    <div class="card stripped">
      <div class="strip">
        THEIR FOLDER
        ${person.google_drive_folder_id
          ? `<a class="strip-side" target="_blank" rel="noopener"
                href="https://drive.google.com/drive/folders/${encodeURIComponent(person.google_drive_folder_id)}">Open in Drive</a>`
          : ""}
      </div>
      <div class="card-body">
        <label class="block-label" style="margin:0;">Google Drive folder ID
          <input type="text" id="sFolder" value="${esc(person.google_drive_folder_id || "")}"
                 placeholder="Paste the folder ID from its Drive URL">
        </label>
        <p class="meta" style="margin:6px 0 0;">
          This is the folder behind <strong>My Folder</strong> — whatever you put in
          it in Drive is what ${esc(person.full_name.split(" ")[0])} sees there:
          contracts, pay stubs, anything personal to them. Share the folder with
          their Google account in Drive as well, or it won't open for them.
        </p>
      </div>
    </div>

    <p class="form-error" id="staffError"></p>

    <div class="button-row" style="margin-bottom:14px;">
      <button id="saveStaffBtn" style="flex:1;">Save details</button>
      <button class="btn-quiet" id="staffAccessBtn">Role &amp; access</button>
    </div>

    <div class="card stripped">
      <div class="strip">THEIR USUAL WEEK</div>
      <div class="card-body">
        ${availabilityEditor(staffMember.availability)}
        <p class="form-error" id="staffAvailError"></p>
        <div class="button-row">
          <button id="saveStaffAvailBtn" style="flex:1;">Save their week</button>
        </div>
      </div>
    </div>

    <div class="card stripped">
      <div class="strip">
        TIME OFF
        ${pendingTimeOff.length ? `<span class="strip-side">${pendingTimeOff.length} to answer</span>` : ""}
      </div>
      <div class="card-body">
        ${upcomingTimeOff.length
          ? upcomingTimeOff.map(r => timeOffRow(r, { canDecide: true })).join("")
          : `<p class="empty-state">No time off booked.</p>`}
        <p class="form-error" id="staffTimeOffError"></p>
      </div>
    </div>

    <div class="card stripped">
      <div class="strip">
        SHIFTS
        <span class="strip-side">${upcoming.length} upcoming</span>
      </div>
      <div class="card-body">
        ${upcoming.length
          ? `<ul class="file-list">${upcoming.map(shiftRowHtml).join("")}</ul>`
          : `<p class="empty-state">No upcoming shifts.</p>`}

        ${openShifts.length ? `
          <h4>Put them on a shift</h4>
          <div class="inline-form">
            <select id="assignShiftSelect">
              ${openShifts.map(s => `
                <option value="${s.id}">
                  ${esc(formatDate(s.shift_date))} · ${esc(formatTime(s.starts_at))}–${esc(formatTime(s.ends_at))}
                  · ${esc(s.title)} (${esc(s.convention_name || "Store")})
                </option>
              `).join("")}
            </select>
            <button id="assignShiftBtn">Assign</button>
          </div>
          <p class="meta" style="margin:6px 0 0;">
            Unassigned shifts from Schedule and from every upcoming event.
          </p>
        ` : `
          <p class="meta">
            No unassigned shifts going spare. Build a week on Schedule, or a
            show on its own page, and they'll turn up here.
          </p>
        `}

        ${past.length ? `
          <h4>Earlier</h4>
          <ul class="file-list">${past.slice(0, 8).map(shiftRowHtml).join("")}</ul>
        ` : ""}
      </div>
    </div>
  `;

  markActiveNav("staff", { wide: true });
  wireStaffMember();
}

function shiftRowHtml(shift) {
  return `
    <li class="manage-row">
      <span>
        <strong style="font-family:'Fredoka',sans-serif; font-size:13px;">
          ${esc(formatDate(shift.shift_date))}
        </strong>
        <div class="meta">
          ${esc(shift.title)} · ${esc(shift.convention_name || "Store")} ·
          ${esc(formatTime(shift.starts_at))} – ${esc(formatTime(shift.ends_at))}
          ${shift.break_allotment_minutes
            ? ` · ${esc(breakBasisText(shift.break_allotment_minutes, shift.break_count || 1))} break`
            : ""}
        </div>
      </span>
      <button class="btn-danger" data-unassign="${shift.id}">Take off</button>
    </li>
  `;
}

async function saveAvatar(dataUri) {
  showFormError("staffError", "");

  const result = await apiSend(
    `/api/admin/staff/${staffMember.person.id}/avatar`,
    "PUT",
    { avatar: dataUri }
  );

  if (!result.ok) {
    showFormError("staffError", result.error || "Could not save that picture.");
    return;
  }

  await openStaffMember(staffMember.person.id, false);
}

function wireStaffMember() {
  document.getElementById("staffBackBtn").onclick = () => renderStaff();

  const reload = () => openStaffMember(staffMember.person.id, false);

  wireAvailabilityEditor();
  wireTimeOff("staffTimeOff", reload, "staffTimeOffError");

  document.getElementById("saveStaffAvailBtn").onclick = async () => {
    const result = await apiSend(
      `/api/admin/staff/${staffMember.person.id}/availability`,
      "PUT",
      { week: readAvailabilityEditor(staffMember.availability) }
    );

    if (!result.ok) {
      showFormError("staffAvailError", result.error || "Could not save that.");
      return;
    }

    await reload();
  };

  const avatarInput = document.getElementById("avatarInput");
  avatarInput.onchange = async () => {
    const file = avatarInput.files?.[0];
    if (!file) return;

    try {
      await saveAvatar(await readImageAsAvatar(file));
    } catch (err) {
      showFormError("staffError", err.message);
    }
  };

  const removeAvatar = document.getElementById("removeAvatarBtn");
  if (removeAvatar) {
    removeAvatar.onclick = () => guard(() => saveAvatar(null));
  }

  document.getElementById("staffAccessBtn").onclick = () => goToView("users-roles");

  const saveBtn = document.getElementById("saveStaffBtn");
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;

    const result = await apiSend(`/api/admin/staff/${staffMember.person.id}`, "PATCH", {
      full_name: document.getElementById("sName").value,
      email: document.getElementById("sEmail").value,
      phone: document.getElementById("sPhone").value,
      location: document.getElementById("sLocation").value,
      started_on: document.getElementById("sStarted").value,
      notes: document.getElementById("sNotes").value,
      google_drive_folder_id: document.getElementById("sFolder").value
    });

    saveBtn.disabled = false;

    if (!result.ok) {
      showFormError("staffError", result.error || "Could not save those details.");
      return;
    }

    await openStaffMember(staffMember.person.id, false);
  };

  const assignBtn = document.getElementById("assignShiftBtn");
  if (assignBtn) {
    assignBtn.onclick = async () => {
      const shiftId = document.getElementById("assignShiftSelect").value;
      assignBtn.disabled = true;

      const result = await apiSend(`/api/convention-shifts/${shiftId}/assign`, "PUT", {
        employee_id: staffMember.person.id
      });

      assignBtn.disabled = false;

      if (!result.ok) {
        showFormError("staffError", result.error || "Could not assign that shift.");
        return;
      }

      await openStaffMember(staffMember.person.id, false);
    };
  }

  document.querySelectorAll("[data-unassign]").forEach(btn => {
    btn.onclick = async () => {
      const result = await apiSend(`/api/convention-shifts/${btn.dataset.unassign}/assign`, "PUT", {
        employee_id: null
      });

      if (!result.ok) {
        showFormError("staffError", result.error || "Could not update that shift.");
        return;
      }

      await openStaffMember(staffMember.person.id, false);
    };
  });
}

window.renderStaff = renderStaff;
window.openStaffMember = openStaffMember;
