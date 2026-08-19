/* Availability and time off.

   The same week editor serves two screens: your own on My availability, and
   anyone's on their Staff page. Whoever is looking, the shape is identical —
   only where it saves to changes. */

let myAvailability = null;

const TIME_OFF_STATUS = {
  pending: { label: "Waiting on a boss", pill: "pill-warm" },
  approved: { label: "Approved", pill: "pill-go" },
  declined: { label: "Declined", pill: "pill-late" }
};

/**
 * The seven-row week editor. `week` is the full seven days; a day that's
 * available with no times means "any time that day".
 */
function availabilityEditor(week) {
  return `
    ${week.map(day => `
      <div class="avail-row" data-weekday="${day.weekday}">
        <label class="avail-day">
          <input type="checkbox" data-avail-on="${day.weekday}" ${day.is_available ? "checked" : ""}>
          <span>${esc(day.name)}</span>
        </label>
        <div class="avail-times">
          ${timeSelect(`data-avail-from="${day.weekday}" ${day.is_available ? "" : "disabled"}`, day.earliest)}
          <span class="meta">to</span>
          ${timeSelect(`data-avail-to="${day.weekday}" ${day.is_available ? "" : "disabled"}`, day.latest)}
        </div>
      </div>
    `).join("")}
    <p class="meta" style="margin:8px 0 0;">
      Untick a day you can't work. Leave the times blank if any time that day
      is fine — they're only there for "not before" and "not after".
    </p>
  `;
}

/** Reads the editor back out. Returns the full week, so blanks mean blanks. */
function readAvailabilityEditor(week) {
  return week.map(day => ({
    weekday: day.weekday,
    is_available: document.querySelector(`[data-avail-on="${day.weekday}"]`).checked,
    earliest: document.querySelector(`[data-avail-from="${day.weekday}"]`).value,
    latest: document.querySelector(`[data-avail-to="${day.weekday}"]`).value
  }));
}

/** Ticking a day off greys its times rather than leaving stale ones behind. */
function wireAvailabilityEditor() {
  document.querySelectorAll("[data-avail-on]").forEach(box => {
    box.onchange = () => {
      const weekday = box.dataset.availOn;
      for (const attr of ["from", "to"]) {
        document.querySelector(`[data-avail-${attr}="${weekday}"]`).disabled = !box.checked;
      }
    };
  });
}

/** One time-off request as a row, with the actions the viewer is allowed. */
function timeOffRow(request, { canDecide }) {
  const status = TIME_OFF_STATUS[request.status] || TIME_OFF_STATUS.pending;
  const sameDay = request.starts_on === request.ends_on;

  return `
    <div class="card" style="margin-bottom:9px;">
      <div style="display:flex; align-items:flex-start; gap:10px;">
        <div style="flex:1;">
          <div style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:14px;">
            ${esc(formatDate(request.starts_on))}${sameDay ? "" : ` – ${esc(formatDate(request.ends_on))}`}
          </div>
          ${request.reason ? `<div class="meta">${esc(request.reason)}</div>` : ""}
          ${request.decided_by_name
            ? `<div class="meta">${esc(status.label)} by ${esc(request.decided_by_name)}</div>`
            : ""}
          ${request.decision_note ? `<div class="meta">“${esc(request.decision_note)}”</div>` : ""}
        </div>
        <span class="pill ${status.pill}">${esc(status.label)}</span>
      </div>

      <div class="button-row" style="margin-top:10px;">
        ${canDecide && request.status !== "approved"
          ? `<button class="btn-go" data-decide="${request.id}" data-status="approved">Approve</button>`
          : ""}
        ${canDecide && request.status !== "declined"
          ? `<button class="btn-quiet" data-decide="${request.id}" data-status="declined">Decline</button>`
          : ""}
        <button class="btn-danger" data-cancel-time-off="${request.id}">Remove</button>
      </div>
    </div>
  `;
}

function timeOffForm(idPrefix) {
  return `
    <h4>Ask for time off</h4>
    <div class="form-grid" style="margin:0;">
      <label>First day <input type="date" id="${idPrefix}From"></label>
      <label>Last day <input type="date" id="${idPrefix}To"></label>
      <label>Reason <input type="text" id="${idPrefix}Reason" placeholder="Optional"></label>
    </div>
    <div class="button-row">
      <button id="${idPrefix}Btn">Request</button>
    </div>
  `;
}

/* ---------- My availability ---------- */

async function renderMyAvailability(pushState = true) {
  if (pushState) pushPageState("availability");

  const data = await api("/api/my-availability");

  if (!data.ok) {
    renderError(data.error || "Could not load your availability");
    return;
  }

  myAvailability = data;
  const upcoming = data.timeOff.filter(r => r.ends_on >= todayLocal());
  const past = data.timeOff.filter(r => r.ends_on < todayLocal());
  const isBoss = can("manage_users");

  pageArea().innerHTML = `
    <div class="page-header">
      <h2>My availability</h2>
      <p>When you can work, and any time off</p>
    </div>

    <div class="card stripped">
      <div class="strip">YOUR USUAL WEEK</div>
      <div class="card-body">
        ${availabilityEditor(data.week)}
        <p class="form-error" id="availError"></p>
        <div class="button-row">
          <button id="saveAvailBtn" style="flex:1;">Save my week</button>
        </div>
      </div>
    </div>

    <div class="card stripped">
      <div class="strip">
        TIME OFF
        ${upcoming.length ? `<span class="strip-side">${upcoming.length} coming up</span>` : ""}
      </div>
      <div class="card-body">
        ${upcoming.length
          ? upcoming.map(r => timeOffRow(r, { canDecide: false })).join("")
          : `<p class="empty-state">No time off booked.</p>`}

        <p class="form-error" id="timeOffError"></p>
        ${timeOffForm("myTimeOff")}
        ${isBoss ? `
          <p class="meta" style="margin:6px 0 0;">
            Yours is approved as soon as you ask — you're the one who'd approve it.
          </p>
        ` : `
          <p class="meta" style="margin:6px 0 0;">
            A boss sees this and approves or declines it.
          </p>
        `}

        ${past.length ? `
          <h4>Earlier</h4>
          ${past.slice(0, 5).map(r => timeOffRow(r, { canDecide: false })).join("")}
        ` : ""}
      </div>
    </div>
  `;

  markActiveNav("availability");
  wireAvailabilityEditor();

  document.getElementById("saveAvailBtn").onclick = async () => {
    const result = await apiSend("/api/my-availability", "PUT", {
      week: readAvailabilityEditor(data.week)
    });

    if (!result.ok) {
      showFormError("availError", result.error || "Could not save that.");
      return;
    }

    await renderMyAvailability(false);
  };

  wireTimeOff("myTimeOff", () => renderMyAvailability(false));
}

/** Shared by both screens: the request form and the row buttons. */
function wireTimeOff(idPrefix, reload, errorId = "timeOffError") {
  const btn = document.getElementById(`${idPrefix}Btn`);

  if (btn) {
    btn.onclick = async () => {
      btn.disabled = true;

      const result = await apiSend("/api/time-off", "POST", {
        starts_on: document.getElementById(`${idPrefix}From`).value,
        ends_on: document.getElementById(`${idPrefix}To`).value,
        reason: document.getElementById(`${idPrefix}Reason`).value
      });

      btn.disabled = false;

      if (!result.ok) {
        showFormError(errorId, result.error || "Could not send that request.");
        return;
      }

      await reload();
    };
  }

  document.querySelectorAll("[data-decide]").forEach(button => {
    button.onclick = async () => {
      const result = await apiSend(`/api/time-off/${button.dataset.decide}/decision`, "PUT", {
        status: button.dataset.status
      });

      if (!result.ok) {
        showFormError(errorId, result.error || "Could not save that.");
        return;
      }

      await reload();
    };
  });

  document.querySelectorAll("[data-cancel-time-off]").forEach(button => {
    button.onclick = async () => {
      const result = await apiSend(`/api/time-off/${button.dataset.cancelTimeOff}`, "DELETE");

      if (!result.ok) {
        showFormError(errorId, result.error || "Could not remove that.");
        return;
      }

      await reload();
    };
  });
}

window.renderMyAvailability = renderMyAvailability;
