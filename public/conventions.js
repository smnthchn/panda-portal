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

  pageArea().innerHTML = `
    <div class="page-header">
      <h2>Events</h2>
      <p>Schedules, booth info and checklists for each event</p>
    </div>

    <div class="button-row" style="margin:0 0 14px;">
      ${data.canManage ? `<button id="newConventionBtn">New convention</button>` : ""}
      <button class="btn-quiet" id="resourcesBtn">Resources</button>
    </div>

    ${current.length
      ? current.map(conventionCard).join("")
      : `<div class="card">
           <p class="empty-state">
             ${data.canManage
               ? "No conventions yet. Use “New convention” above to add your first event — dates, setup and load-in times, booth number, maps and checklists all live inside it."
               : "No upcoming conventions yet."}
           </p>
         </div>`}

    ${past.length ? `
      <div class="card stripped">
        <div class="strip">PAST EVENTS</div>
        <div class="card-body">
          <ul class="file-list">
            ${past.map(c => `
              <li>
                <a href="#" data-convention="${esc(c.slug)}">${esc(c.name)}</a>
                <span class="meta"> — ${esc(formatDateRange(c.starts_on, c.ends_on))}</span>
              </li>
            `).join("")}
          </ul>
        </div>
      </div>
    ` : ""}
  `;

  markActiveNav("conventions");

  document.querySelectorAll("[data-convention]").forEach(el => {
    el.onclick = (e) => {
      e.preventDefault();
      openConvention(el.dataset.convention);
    };
  });

  const newBtn = document.getElementById("newConventionBtn");
  if (newBtn) newBtn.onclick = () => renderConventionForm(null);

  document.getElementById("resourcesBtn").onclick = () => renderResources();
}

function conventionCard(convention) {
  return `
    <div class="action-card" style="margin-bottom:13px;">
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
        ? `<p class="meta" style="margin:-6px 0 12px;">You have ${convention.my_shift_count} shift${convention.my_shift_count === 1 ? "" : "s"}.</p>`
        : ""}
      <button data-convention="${esc(convention.slug)}">Open</button>
    </div>
  `;
}

/** Days from today (local) to an ISO date. Negative once it's passed. */
function daysUntil(isoDate) {
  if (!isoDate) return null;
  const today = new Date(`${todayLocal()}T00:00:00`);
  const target = new Date(`${isoDate}T00:00:00`);
  return Math.round((target - today) / 86400000);
}

/** Which day of the run today is, 1-indexed, or null outside the event. */
function eventDayIndex(convention) {
  const from = daysUntil(convention.starts_on);
  if (from === null || from > 0) return null;
  const to = daysUntil(convention.ends_on || convention.starts_on);
  return to < 0 ? null : 1 - from;
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

/** Which plan the floor-plan card is showing. Client-side only. */
let activePlan = "venue";

/**
 * The hero band. Its fill and copy are the phase: counting down (amber),
 * live (brand), or wrapped (amber, centered and celebratory).
 */
function heroBand() {
  const { convention } = detailData;
  const away = daysUntil(convention.starts_on);
  const dayIndex = eventDayIndex(convention);
  const dayCount = (daysUntil(convention.ends_on || convention.starts_on) ?? 0) - (away ?? 0) + 1;

  if (convention.phase === "past") {
    return `
      <div class="hero-band warm center">
        <div style="display:flex; justify-content:center; gap:5px; margin-bottom:9px; font-size:15px;">
          <span>✦</span><span>✧</span><span>✦</span><span>✧</span><span>✦</span>
        </div>
        <h2 style="font-size:31px; letter-spacing:-0.02em; margin:0 0 5px;">Yay! We did it!</h2>
        <div class="hero-sub">
          ${esc(convention.name)} · ${dayCount} day${dayCount === 1 ? "" : "s"}, done
        </div>
      </div>
    `;
  }

  if (dayIndex) {
    const today = detailData.days.find(d => d.day_date === todayLocal());
    const doors = today && today.regular_start && today.regular_end
      ? `Doors ${formatTime(today.regular_start)} – ${formatTime(today.regular_end)}`
      : null;

    return `
      <div class="hero-band brand">
        <div class="badge-row" style="margin-bottom:5px;">
          <span class="pill pill-paper">HAPPENING NOW</span>
          <span style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:12px;">
            Day ${dayIndex} of ${dayCount}
          </span>
        </div>
        <h2 style="font-size:24px;">${esc(convention.name)}</h2>
        <div class="hero-sub">
          ${[doors, convention.booth_number ? `Booth ${convention.booth_number}` : null]
            .filter(Boolean).map(esc).join(" · ")}
        </div>
      </div>
    `;
  }

  return `
    <div class="hero-band warm">
      <div class="badge-row" style="margin-bottom:6px;">
        <span class="pill pill-ink">
          ${away === null ? "UPCOMING" : away === 0 ? "TODAY" : `IN ${away} DAY${away === 1 ? "" : "S"}`}
        </span>
        ${convention.is_published ? "" : '<span class="pill">DRAFT</span>'}
      </div>
      <h2>${esc(convention.name)}</h2>
      <div class="hero-sub">
        ${[
          formatDateRange(convention.starts_on, convention.ends_on),
          convention.venue,
          convention.booth_number ? `Booth ${convention.booth_number}` : null
        ].filter(Boolean).map(esc).join(" · ")}
      </div>
    </div>
  `;
}

/** Floorplan / Booth / Maps. The first two switch the plan card below. */
function pillRow() {
  const { convention } = detailData;
  const mapHref = addressHref(convention);

  // Booth Plan leads: during setup it's the thing everyone opens.
  const buttons = [
    `<button class="btn-pill off" id="boothPlanPill">Booth Plan</button>`
  ];

  if (convention.venue_map_file_id) {
    buttons.push(`<button class="btn-pill ${activePlan === "venue" ? "on" : "off"}" data-plan="venue">Floorplan</button>`);
  }
  if (convention.booth_layout_file_id) {
    buttons.push(`<button class="btn-pill ${activePlan === "booth" ? "on" : "off"}" data-plan="booth">Booth</button>`);
  }
  if (mapHref) {
    buttons.push(`<button class="btn-pill off" data-maps="${esc(mapHref)}">Maps</button>`);
  }

  return `<div style="display:flex; gap:7px; margin-bottom:13px; flex-wrap:wrap;">${buttons.join("")}</div>`;
}

/** Navy card listing the shifts you're on across the run. */
function myShiftsCard() {
  const { myShifts, convention } = detailData;
  const dayIndex = eventDayIndex(convention);

  if (!myShifts.length) {
    return `
      <div class="card">
        <h3>Your shifts</h3>
        <p class="empty-state">You're not on the schedule for this event yet.</p>
      </div>
    `;
  }

  // During the show, today's shift is the whole card.
  const todayShift = dayIndex ? myShifts.find(s => s.shift_date === todayLocal()) : null;

  if (todayShift) {
    const total = todayShift.break_allotment_minutes || 0;
    return `
      <div class="card navy">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
          <span class="kicker">YOUR SHIFT TODAY</span>
          ${startsInPill(todayShift)}
        </div>
        <div style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:27px; letter-spacing:-0.015em;">
          ${esc(formatTime(todayShift.starts_at))} – ${esc(formatTime(todayShift.ends_at))}
        </div>
        <div style="margin-top:3px; font-size:13px; opacity:0.75;">
          ${esc(todayShift.title)}${convention.booth_number ? ` · Booth ${esc(convention.booth_number)}` : ""}
        </div>
        ${total ? `
          <div style="display:flex; align-items:center; gap:9px; margin-top:12px;">
            ${batteryHtml(total, total, todayShift.break_count || 1, { mini: true })}
            <span style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:12.5px;">
              ${esc(breakBasisText(total, todayShift.break_count || 1))}
            </span>
            <button class="btn-ghost-go" style="margin-left:auto; padding:6px 11px; font-size:12.5px; border-radius:999px; border-bottom-width:2px;"
                    id="goToClockBtn">Clock ›</button>
          </div>
        ` : `
          <div style="margin-top:12px; display:flex;">
            <button class="btn-ghost-go" style="margin-left:auto; padding:6px 11px; font-size:12.5px; border-radius:999px; border-bottom-width:2px;"
                    id="goToClockBtn">Clock ›</button>
          </div>
        `}
      </div>
    `;
  }

  const dayCount = new Set(detailData.days.map(d => d.day_date)).size;

  return `
    <div class="card navy">
      <div class="kicker" style="margin-bottom:11px;">
        YOUR SHIFTS · ${myShifts.length}${dayCount ? ` OF ${dayCount} DAYS` : ""}
      </div>
      <div style="display:flex; flex-direction:column; gap:10px;">
        ${myShifts.map(shift => `
          <div style="display:flex; gap:11px; align-items:baseline;">
            <span style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:12.5px; color:var(--go); width:52px; flex:none;">
              ${esc(shortDayLabel(shift.shift_date))}
            </span>
            <span style="flex:1; font-size:13px;">
              ${esc(shift.title)} · ${esc(formatTime(shift.starts_at))} – ${esc(formatTime(shift.ends_at))}
              <span style="opacity:0.62;"> · ${shift.break_allotment_minutes
                ? esc(breakBasisText(shift.break_allotment_minutes, shift.break_count || 1)) + " break"
                : "no break"}</span>
            </span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

/** "STARTS IN 40 MIN" / "ON NOW" / "DONE" for today's shift. */
function startsInPill(shift) {
  const now = new Date();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = shift.starts_at.split(":").map(Number);
  const [eh, em] = shift.ends_at.split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;

  if (minutesNow >= end) return `<span class="pill">DONE</span>`;
  if (minutesNow >= start) return `<span class="pill pill-go">ON NOW</span>`;

  const away = start - minutesNow;
  return `<span class="pill pill-go">STARTS IN ${away < 60 ? `${away} MIN` : formatMinutes(away).toUpperCase()}</span>`;
}

/**
 * "Thu 27" — the fixed-width day column down the left of shift rows. Built
 * from parts rather than a combined format, whose order varies by locale.
 */
function shortDayLabel(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  if (isNaN(d)) return isoDate;
  return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${d.getDate()}`;
}

/**
 * Hours as a list before the show (you compare days) and as a bar during it
 * (you only need to know where you are in today).
 */
function hoursCard() {
  const { days, convention } = detailData;
  const dayIndex = eventDayIndex(convention);

  if (!days.length) {
    return `
      <div class="card stripped">
        <div class="strip">SHOW HOURS${manageJumpButton("dayFormHeading", "Add hours")}</div>
        <div class="card-body"><p class="empty-state">No daily hours set for this event yet.</p></div>
      </div>
    `;
  }

  const today = dayIndex ? days.find(d => d.day_date === todayLocal()) : null;

  if (today) {
    const layout = segmentLayout(today);
    return `
      <div class="card">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
          <span class="kicker" style="font-weight:600; font-size:11.5px; letter-spacing:0.06em; color:var(--muted);">
            TODAY ON THE FLOOR
          </span>
          <span style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:11.5px; color:var(--brand-text);">
            ${esc(doorsCountdown(today))}
          </span>
        </div>
        ${segbarHtml(layout, today)}
        ${today.notes ? `<div class="note-block" style="margin-top:11px;">${esc(today.notes)}</div>` : ""}
      </div>
    `;
  }

  return `
    <div class="card stripped">
      <div class="strip">SHOW HOURS${manageJumpButton("dayFormHeading", "Edit hours")}</div>
      <div class="card-body" style="padding-top:4px;">
        ${days.map((day, i) => `
          <div style="display:flex; align-items:baseline; gap:10px; padding:8px 0;
                      ${i < days.length - 1 ? "border-bottom:2px solid var(--track);" : ""}">
            <span style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:12.5px; color:var(--muted); width:52px; flex:none;">
              ${esc(shortDayLabel(day.day_date))}
            </span>
            <span style="flex:1; font-family:'Fredoka',sans-serif; font-weight:600; font-size:14px;">
              ${day.regular_start && day.regular_end
                ? `${esc(formatTime(day.regular_start))} – ${esc(formatTime(day.regular_end))}`
                : "—"}
            </span>
            ${day.early_start
              ? `<span class="pill pill-warm" style="font-size:10.5px; padding:3px 7px;">VIP ${esc(formatTime(day.early_start))}</span>`
              : ""}
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

/** Proportional widths for a day's setup / early / open segments. */
function segmentLayout(day) {
  const mins = (hhmm) => {
    const [h, m] = String(hhmm || "").split(":").map(Number);
    return Number.isFinite(h) ? h * 60 + m : null;
  };

  const open = mins(day.regular_start);
  const close = mins(day.regular_end);
  if (open === null || close === null || close <= open) return null;

  const early = mins(day.early_start);
  const setup = mins(day.setup_start);
  const spanStart = setup ?? early ?? open;
  const total = close - spanStart;
  if (total <= 0) return null;

  const segments = [];
  if (setup !== null && setup < (early ?? open)) {
    segments.push({ kind: "set", label: "SET", width: ((early ?? open) - setup) / total * 100 });
  }
  if (early !== null && early < open) {
    segments.push({ kind: "vip", label: "VIP", width: (open - early) / total * 100 });
  }
  segments.push({ kind: "open", label: "OPEN", width: (close - open) / total * 100 });

  return { segments, spanStart, spanEnd: close };
}

function segbarHtml(layout, day) {
  if (!layout) return "";

  const now = new Date();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const inside = minutesNow >= layout.spanStart && minutesNow <= layout.spanEnd;
  const pct = inside
    ? ((minutesNow - layout.spanStart) / (layout.spanEnd - layout.spanStart)) * 100
    : 0;

  const label = (minutes) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const suffix = h >= 12 ? "PM" : "AM";
    const hour = h % 12 === 0 ? 12 : h % 12;
    return m ? `${hour}:${String(m).padStart(2, "0")} ${suffix}` : `${hour} ${suffix}`;
  };

  return `
    <div class="segbar">
      ${layout.segments.map(seg => `
        <div class="seg ${esc(seg.kind)}" style="width:${seg.width.toFixed(1)}%;">
          ${seg.kind === "open"
            ? `OPEN ${esc(label(layout.spanEnd - (layout.spanEnd - layout.spanStart) * (seg.width / 100)))} – ${esc(label(layout.spanEnd))}`
            : esc(seg.label)}
        </div>
      `).join("")}
      ${inside ? `<div class="now-marker" style="left:${pct.toFixed(1)}%;"></div>` : ""}
    </div>
    <div class="segbar-scale">
      <span>${esc(label(layout.spanStart))}</span>
      <span>${esc(label(layout.spanEnd))}</span>
    </div>
  `;
}

/** "Doors in 1 h" / "Open now" / "Doors closed". */
function doorsCountdown(day) {
  const mins = (hhmm) => {
    const [h, m] = String(hhmm || "").split(":").map(Number);
    return Number.isFinite(h) ? h * 60 + m : null;
  };

  const open = mins(day.regular_start);
  const close = mins(day.regular_end);
  const now = new Date().getHours() * 60 + new Date().getMinutes();

  if (open === null) return "";
  if (now < open) return `Doors in ${formatMinutes(open - now)}`;
  if (close !== null && now > close) return "Doors closed";
  return "Open now";
}

/** The one plan image at a time, switched by the pill row. */
function planCard() {
  const { convention } = detailData;
  const fileId = activePlan === "booth"
    ? convention.booth_layout_file_id
    : convention.venue_map_file_id;

  if (!fileId) return "";

  const id = encodeURIComponent(fileId);

  return `
    <div class="card stripped">
      <div class="strip">
        ${activePlan === "booth" ? "BOOTH LAYOUT" : "VENUE FLOORPLAN"}
        ${convention.booth_number
          ? `<span class="strip-side" style="color:var(--brand-text);">Booth ${esc(convention.booth_number)}</span>`
          : ""}
      </div>
      <div class="card-body">
        <div class="layout-frame">
          <iframe src="https://drive.google.com/file/d/${id}/preview" title="Plan" allow="autoplay"></iframe>
        </div>
        <p class="meta" style="margin:8px 0 0;">
          ${activePlan === "booth"
            ? "Table plan — where singles, sealed and the till go."
            : "Hall level, our booth marked."}
          Can't see it?
          <a href="https://drive.google.com/file/d/${id}/view" target="_blank" rel="noopener noreferrer">open it directly</a>.
        </p>
      </div>
    </div>
  `;
}

/** Store closed / setup / load-in — in the order the week actually runs. */
function beforeTheShowCard() {
  const { convention } = detailData;

  const loadIn = convention.load_in_start && convention.load_in_end
    ? `${formatTime(convention.load_in_start)} – ${formatTime(convention.load_in_end)}`
    : convention.load_in_start
      ? `from ${formatTime(convention.load_in_start)}`
      : null;

  const rows = [
    ["Store closed", formatDate(convention.store_close_on)],
    ["Setup day", formatDate(convention.setup_on)],
    ["Load-in", loadIn]
  ].filter(([, value]) => value);

  if (!rows.length) return "";

  return `
    <div class="card">
      <div class="card-head">
        <h3>Before the show</h3>
        ${detailData.canManage ? `<button class="btn-quiet" data-edit-event="1">Edit</button>` : ""}
      </div>
      <dl class="info-list">
        ${rows.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join("")}
      </dl>
    </div>
  `;
}

/**
 * Last card in the scroll, deliberately: you look it up once, the night
 * before. Parking is a row with a state, not a sentence buried in notes.
 */
function gettingThereCard() {
  const { convention } = detailData;
  const mapHref = addressHref(convention);
  if (!mapHref && !convention.address) return "";

  return `
    <div class="card stripped">
      <div class="strip">GETTING THERE</div>
      <div>
        ${convention.address ? `
          <a href="${esc(mapHref)}" target="_blank" rel="noopener noreferrer"
             style="display:flex; align-items:center; gap:11px; padding:12px 13px; border-bottom:2px solid var(--track); text-decoration:none; color:inherit;">
            <div style="width:34px; height:34px; border:2px solid var(--ink); border-radius:10px; background:var(--cool-bg); color:var(--cool-text); display:flex; align-items:center; justify-content:center; font-family:'Fredoka',sans-serif; font-weight:600; font-size:15px; flex:none;">◎</div>
            <div style="flex:1;">
              <div style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:13.5px;">${esc(convention.address)}</div>
              <div class="meta">Open in Google Maps</div>
            </div>
            <span style="font-family:'Fredoka',sans-serif; font-size:15px; color:var(--muted);">›</span>
          </a>
        ` : ""}
        ${convention.parking_map_url ? `
          <a href="${esc(convention.parking_map_url)}" target="_blank" rel="noopener noreferrer"
             style="display:flex; align-items:center; gap:11px; padding:12px 13px; border-bottom:2px solid var(--track); text-decoration:none; color:inherit;">
            <div style="width:34px; height:34px; border:2px solid var(--ink); border-radius:10px; background:var(--go); color:var(--on-go); display:flex; align-items:center; justify-content:center; font-family:'Fredoka',sans-serif; font-weight:600; font-size:15px; flex:none;">P</div>
            <div style="flex:1;">
              <div style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:13.5px;">Where to park</div>
              <div class="meta">Open the parking map</div>
            </div>
            <span style="font-family:'Fredoka',sans-serif; font-size:15px; color:var(--muted);">›</span>
          </a>
        ` : ""}
        ${convention.website_url ? `
          <a href="${esc(convention.website_url)}" target="_blank" rel="noopener noreferrer"
             style="display:flex; align-items:center; gap:11px; padding:12px 13px; text-decoration:none; color:inherit;">
            <div style="width:34px; height:34px; border:2px solid var(--ink); border-radius:10px; background:var(--chip); color:var(--text); display:flex; align-items:center; justify-content:center; font-family:'Fredoka',sans-serif; font-weight:600; font-size:15px; flex:none;">▦</div>
            <div style="flex:1;">
              <div style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:13.5px;">Official site</div>
              <div class="meta">Hours, guests and floor plans</div>
            </div>
            <span style="font-family:'Fredoka',sans-serif; font-size:15px; color:var(--muted);">›</span>
          </a>
        ` : ""}
      </div>
    </div>
  `;
}

/** After the show: one number, a thank-you, and what's next. */
function afterCards() {
  const { myShifts } = detailData;

  const minutes = myShifts.reduce((sum, shift) => {
    const [sh, sm] = shift.starts_at.split(":").map(Number);
    const [eh, em] = shift.ends_at.split(":").map(Number);
    const worked = (eh * 60 + em) - (sh * 60 + sm) - (shift.break_allotment_minutes || 0);
    return sum + Math.max(0, worked);
  }, 0);

  return `
    ${minutes ? `
      <div class="card navy" style="text-align:center;">
        <div class="kicker">YOUR WEEKEND</div>
        <div style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:44px; letter-spacing:-0.03em; margin:6px 0 2px;">
          ${(minutes / 60).toFixed(1)}
        </div>
        <div style="font-size:14px; opacity:0.72;">hours on the booth</div>
      </div>
    ` : ""}

    <div class="card" style="text-align:center;">
      <p style="margin:0; font-size:13.5px;">
        Thank you for the long days. Rest up — the store is back to normal today.
      </p>
    </div>
  `;
}

function drawConvention() {
  const { convention, canManage } = detailData;
  const isPast = convention.phase === "past";
  const dayIndex = eventDayIndex(convention);

  pageArea().innerHTML = `
    <div class="title-row">
      <button class="back-tile" id="backToEvents">‹</button>
      <h2>Events</h2>
      ${canManage ? `
        <button class="btn-quiet" id="toggleManageBtn" style="font-size:12.5px; padding:7px 11px;">
          ${managingConvention ? "Done" : "Edit"}
        </button>
      ` : ""}
    </div>

    ${heroBand()}

    ${isPast ? `
      ${afterCards()}
      ${checklistsSection()}
      ${documentsCard()}
    ` : `
      ${pillRow()}
      ${myShiftsCard()}
      ${hoursCard()}
      ${planCard()}
      ${dayIndex ? "" : beforeTheShowCard()}
      ${scheduleCard()}
      ${checklistsSection()}
      ${documentsCard()}
      ${gettingThereCard()}
    `}

    ${managingConvention ? manageSection() : ""}
  `;

  markActiveNav("conventions");
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

/**
 * A day's windows as [label, text] display lines. Setup and early access are
 * start-only: setup is "be there from", and early access runs until doors
 * open, so its end is the regular start.
 */
function dayWindowTexts(day) {
  const lines = [];

  if (day.setup_start) {
    lines.push(["Setup", `from ${formatTime(day.setup_start)}`]);
  }

  if (day.early_start) {
    lines.push(["Early access", day.regular_start
      ? `${formatTime(day.early_start)} – ${formatTime(day.regular_start)}`
      : `from ${formatTime(day.early_start)}`]);
  }

  if (day.regular_start && day.regular_end) {
    lines.push(["Regular", `${formatTime(day.regular_start)} – ${formatTime(day.regular_end)}`]);
  }

  return lines;
}

/**
 * Small "jump to the editor" button for a read-only card. The management forms
 * live at the bottom of the page, so each card that displays data links to the
 * form that fills it in.
 */
function manageJumpButton(anchorId, label) {
  if (!detailData.canManage) return "";
  return `<button class="btn-quiet" style="font-size:11.5px; padding:5px 9px; border-bottom-width:2px;"
                  data-manage-jump="${esc(anchorId)}">${esc(label)}</button>`;
}

/** Everyone's shifts, grouped by day, with break allotments visible. */
function scheduleCard() {
  const { shifts, canManage } = detailData;

  return `
    <div class="card stripped">
      <div class="strip">
        FULL SCHEDULE
        ${canManage
          ? `<button class="btn-quiet" style="font-size:11.5px; padding:5px 9px; border-bottom-width:2px;"
                     id="buildScheduleBtn">${shifts.length ? "Build" : "Build schedule"}</button>`
          : ""}
      </div>
      <div class="card-body">
        ${shifts.length
          ? groupShiftsByDate(shifts).map(([date, dayShifts]) => `
              <h4 style="margin-top:10px;">${esc(formatDate(date))}</h4>
              <ul class="shift-list">
                ${dayShifts.map(s => `
                  <li class="${s.is_mine ? "shift-mine" : ""}">
                    <div class="shift-time">${esc(formatTime(s.starts_at))} – ${esc(formatTime(s.ends_at))}</div>
                    <div style="flex:1;">
                      <strong style="font-family:'Fredoka',sans-serif; font-size:13px;">${esc(s.title)}</strong>
                      <span class="meta"> — ${s.employee_name ? esc(s.employee_name) : "Unassigned"}</span>
                      <div class="meta">
                        Break ${s.break_allotment_minutes
                          ? esc(breakBasisText(s.break_allotment_minutes, s.break_count || 1))
                          : "not set"}
                        ${canManage ? `· <a href="#" data-shift-break="${s.id}">change</a>` : ""}
                      </div>
                    </div>
                  </li>
                `).join("")}
              </ul>
            `).join("")
          : `<p class="empty-state">No shifts scheduled yet.</p>`}
      </div>
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
      <div class="card stripped">
        <div class="strip">
          ${esc(list.name)}
          <span class="strip-side">${done} / ${list.items.length}</span>
        </div>
        <div class="card-body">
          ${list.items.length ? `
            <div class="cell-row">
              ${list.items.map(item => `<div class="cell${item.done ? " done" : ""}"></div>`).join("")}
            </div>
          ` : ""}
          ${list.visible_to !== "all"
            ? `<p class="meta" style="margin-top:0;">Visible to ${esc(list.visible_to)} only</p>`
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
      </div>
    `;
  }).join("");
}

function documentsCard() {
  const { convention, documents, documentsError } = detailData;

  if (!convention.drive_folder_id) return "";

  return `
    <div class="card stripped">
      <div class="strip">
        DOCUMENTS
        <a class="strip-side" target="_blank" rel="noopener"
           href="https://drive.google.com/drive/folders/${encodeURIComponent(convention.drive_folder_id)}">
          Open in Drive
        </a>
      </div>
      <div class="card-body">
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
    </div>
  `;
}

function wireConventionDetail() {
  const editEvent = document.querySelector("[data-edit-event]");
  if (editEvent) editEvent.onclick = () => renderConventionForm(detailData.convention);

  const back = document.getElementById("backToEvents");
  if (back) back.onclick = () => renderConventions();

  const clockBtn = document.getElementById("goToClockBtn");
  if (clockBtn) clockBtn.onclick = () => goToView("clock");

  const buildBtn = document.getElementById("buildScheduleBtn");
  if (buildBtn) buildBtn.onclick = () => renderSchedule(detailData.convention.slug);

  const boothPlan = document.getElementById("boothPlanPill");
  if (boothPlan) boothPlan.onclick = () => renderShelfPlan(detailData.convention.slug);

  // Floorplan / Booth switch the one plan card; Maps opens the address.
  document.querySelectorAll("[data-plan]").forEach(btn => {
    btn.onclick = () => {
      activePlan = btn.dataset.plan;
      drawConvention();
    };
  });

  document.querySelectorAll("[data-maps]").forEach(btn => {
    btn.onclick = () => window.open(btn.dataset.maps, "_blank", "noopener");
  });

  document.querySelectorAll("[data-shift-break]").forEach(link => {
    link.onclick = (e) => {
      e.preventDefault();
      const shift = detailData.shifts.find(s => s.id === Number(link.dataset.shiftBreak));
      if (shift) renderShiftBreakForm(shift);
    };
  });

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
                  ${dayWindowTexts(day).map(([label, text]) =>
                    ` · ${esc(label)} ${esc(text)}`
                  ).join("")}
                </span>
                <span class="button-row">
                  <button class="btn-quiet" data-edit-day="${day.id}">Edit</button>
                  <button class="btn-danger" data-delete-day="${day.id}">Remove</button>
                </span>
              </li>
            `).join("")}
          </ul>`
        : `<p class="empty-state">No daily hours yet.</p>`}

      ${suggestedDaysBlock()}

      <h4 id="dayFormHeading">Add a day</h4>
      <p class="meta">
        Saving a date that already has hours replaces them. Early access fills in
        automatically as an hour before doors and runs until they open; setup
        start fills in as an hour before that. Change either if the show differs,
        or clear what doesn't apply.
      </p>
      <div class="form-grid">
        <label>Date <input type="date" id="dayDate" value="${esc(nextUnsetDay())}"></label>
        <label>Regular start <input type="time" id="dayRegularStart"></label>
        <label>Regular end <input type="time" id="dayRegularEnd"></label>
        <label>Early access start <input type="time" id="dayEarlyStart"></label>
        <label>Setup start <input type="time" id="daySetupStart"></label>
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
                  <div class="meta">
                    Break ${s.break_allotment_minutes
                      ? esc(breakBasisText(s.break_allotment_minutes, s.break_count || 1))
                      : "not set"}
                    · <a href="#" data-shift-break="${s.id}">change</a>
                  </div>
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
        <label>Break minutes <input type="number" id="shiftBreakMinutes" value="0" min="0" max="240"></label>
        <label>Split into
          <select id="shiftBreakCount">
            <option value="1">One break</option>
            <option value="2">Two breaks</option>
          </select>
        </label>
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
  early_start: "dayEarlyStart",
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

/** The typical-hours list inside the hours editor. Part of every render. */
function suggestedDaysBlock() {
  const preset = presetFor(detailData.convention);
  const suggestions = suggestedDays();
  if (!suggestions.length) return "";

  return `
    <h4>Typical ${esc(preset.label)} hours</h4>
    <p class="meta">
      The hours ${esc(preset.label)} has published year after year, laid onto this
      event's dates. Double-check against
      ${externalLink(preset.website_url, "this year's site")} — setup and load-in
      times are only in the exhibitor kit, so fill those in yourself.
    </p>
    <ul class="file-list">
      ${suggestions.map((day, i) => `
        <li class="manage-row">
          <span>
            <strong>${esc(formatDate(day.day_date))}</strong>
            ${dayWindowTexts(day).map(([label, text]) =>
              ` · ${esc(label)} ${esc(text)}`
            ).join("")}
            ${day.notes ? `<div class="meta">${esc(day.notes)}</div>` : ""}
          </span>
          <button class="btn-quiet" data-use-suggested="${i}">Load into form</button>
        </li>
      `).join("")}
    </ul>
    <p class="meta">Loading a day fills the form below — check it, then press Save day.</p>
  `;
}

function wireDayForm(conventionId, reload) {
  const saveBtn = document.getElementById("saveDayBtn");
  if (!saveBtn) return;

  const suggestions = suggestedDays();
  document.querySelectorAll("[data-use-suggested]").forEach(btn => {
    btn.onclick = () => {
      const day = suggestions[Number(btn.dataset.useSuggested)];
      fillDayForm(day);
      const heading = document.getElementById("dayFormHeading");
      heading.textContent = `Reviewing ${formatDate(day.day_date)}`;
      heading.scrollIntoView({ behavior: "smooth", block: "center" });
      heading.classList.add("flash-target");
      setTimeout(() => heading.classList.remove("flash-target"), 1600);
    };
  });

  const earlyStart = document.getElementById("dayEarlyStart");
  const setupStart = document.getElementById("daySetupStart");

  // Early access opens an hour before doors, setup starts an hour before
  // that — filled automatically, but never overwriting something typed in.
  const suggestFromRegular = () => {
    const regular = document.getElementById("dayRegularStart").value;
    if (!regular) return;

    if (!earlyStart.value) {
      earlyStart.value = oneHourEarlier(regular) || "";
    }

    if (!setupStart.value) {
      setupStart.value = oneHourEarlier(earlyStart.value || regular) || "";
    }
  };

  document.getElementById("dayRegularStart").onchange = suggestFromRegular;
  document.getElementById("dayEarlyStart").onchange = suggestFromRegular;

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
        notes: document.getElementById("shiftNotes").value,
        break_allotment_minutes: Number(document.getElementById("shiftBreakMinutes").value) || 0,
        break_count: Number(document.getElementById("shiftBreakCount").value) || 1
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

/* ---------- Our shows ---------- */

/**
 * The shows Panda Hobby actually does: the venue details that never change,
 * and the hall hours each show has published year after year. Hours are keyed
 * by weekday (0 = Sunday) so they land on the right dates whatever this year's
 * dates turn out to be. Verify against the official site once the year's page
 * is up, and add a row here for a new show.
 */
const OUR_CONVENTIONS = [
  {
    label: "Anime North",
    match: "anime north",
    name: "Anime North",
    venue: "Toronto Congress Centre",
    address: "650 Dixon Road, Toronto, ON",
    website_url: "https://www.animenorth.com/",
    // Vendors Hall hours — the con itself runs later into the night.
    typicalHours: {
      5: { regular_start: "17:00", regular_end: "22:00" },
      6: { regular_start: "10:00", regular_end: "20:00" },
      0: { regular_start: "10:00", regular_end: "17:00" }
    }
  },
  {
    label: "Fan Expo Canada",
    match: "fan expo",
    name: "FAN EXPO Canada",
    venue: "Metro Toronto Convention Centre",
    address: "255 Front St W, Toronto, ON",
    website_url: "https://fanexpohq.com/fanexpocanada/",
    typicalHours: {
      4: {
        early_start: "14:00",
        regular_start: "16:00", regular_end: "21:00",
        notes: "2 PM preview for VIP, Ultimate and 4-Day pass holders."
      },
      5: { regular_start: "10:00", regular_end: "19:00" },
      6: { regular_start: "10:00", regular_end: "19:00" },
      0: { regular_start: "10:00", regular_end: "17:00" }
    }
  }
];

/** Matches a convention to its preset by name ("Anime North 2027" → Anime North). */
function presetFor(convention) {
  const name = (convention?.name || "").toLowerCase();
  return OUR_CONVENTIONS.find(preset => name.includes(preset.match)) || null;
}

/**
 * One suggested row per convention date that has no saved hours yet, laid out
 * from the preset's weekday pattern. Static data computed on every render, so
 * saving a day can't wipe it — unlike the AI lookup this replaced, which had
 * to be re-run after each save.
 */
function suggestedDays() {
  const { convention, days } = detailData;
  const preset = presetFor(convention);
  if (!preset || !convention.starts_on) return [];

  const taken = new Set(days.map(d => d.day_date));
  const end = convention.ends_on || convention.starts_on;
  const out = [];

  for (let d = new Date(`${convention.starts_on}T00:00:00`);
       d <= new Date(`${end}T00:00:00`);
       d.setDate(d.getDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const hours = preset.typicalHours[d.getDay()];
    if (!hours || taken.has(iso)) continue;

    // House rule unless the show publishes otherwise: early access opens an
    // hour before doors, setup starts an hour before that.
    const early = hours.early_start || oneHourEarlier(hours.regular_start || "") || "";
    const setup = hours.setup_start || oneHourEarlier(early || hours.regular_start || "") || "";

    out.push({ day_date: iso, notes: "", ...hours, early_start: early, setup_start: setup });
  }

  return out;
}

/** Which edit-form blocks are open. Links & Drive files stay folded away. */
let openFormBlocks = { basics: true, movein: true, links: false };

/** A collapsible white card with a chip strip carrying a – / + affordance. */
function formBlock(key, title, bodyHtml, hiddenCount = 0) {
  const open = openFormBlocks[key];
  return `
    <div class="card stripped" style="box-shadow:none; border-radius:14px;">
      <div class="strip" style="cursor:pointer;" data-block="${esc(key)}">
        ${esc(title)}
        <span class="strip-side" style="font-weight:600; font-size:13px;">
          ${open ? "–" : hiddenCount ? `+ ${hiddenCount}` : "+"}
        </span>
      </div>
      ${open ? `<div class="card-body">${bodyHtml}</div>` : ""}
    </div>
  `;
}

function renderConventionForm(convention) {
  const editing = Boolean(convention);
  const field = (id, label, type, value, placeholder = "") => `
    <label>${esc(label)}
      <input type="${type}" id="${id}" value="${esc(value || "")}" placeholder="${esc(placeholder)}">
    </label>
  `;

  pageArea().innerHTML = `
    <div class="title-row">
      <button class="back-tile" id="cancelTopBtn">‹</button>
      <div style="flex:1;">
        <h2 style="margin:0;">${editing ? `Edit ${esc(convention.name)}` : "New convention"}</h2>
        <div class="meta">Everyone who can see this event sees these details</div>
      </div>
    </div>

    <div class="card cool" style="border-radius:14px; box-shadow:none;">
      <h3 style="color:var(--cool-text);">Fill from a show you do</h3>
      <p style="margin:0 0 9px; font-size:11.5px; line-height:1.4; color:var(--cool-text);">
        Name, venue, address and site. Dates move every year, so set those yourself.
      </p>
      <div style="display:flex; gap:7px; flex-wrap:wrap;">
        ${OUR_CONVENTIONS.map((preset, i) => `
          <button class="btn-quiet" style="font-size:12.5px; padding:8px 12px; border-radius:10px;"
                  data-preset="${i}">${esc(preset.label)}</button>
        `).join("")}
      </div>
    </div>

    ${formBlock("basics", "THE BASICS", `
      ${field("cName", "Name", "text", convention?.name, "Fan Expo Canada")}
      <div class="form-grid" style="grid-template-columns:1.3fr 1fr; margin:10px 0 0;">
        ${field("cVenue", "Venue", "text", convention?.venue, "MTCC")}
        ${field("cBooth", "Booth", "text", convention?.booth_number, "1523")}
      </div>
      <div class="form-grid" style="grid-template-columns:1fr 1fr; margin:10px 0 0;">
        ${field("cStart", "Starts", "date", convention?.starts_on)}
        ${field("cEnd", "Ends", "date", convention?.ends_on)}
      </div>
      <div class="form-grid" style="grid-template-columns:1fr; margin:10px 0 0;">
        ${field("cAddress", "Address", "text", convention?.address, "255 Front St W, Toronto")}
      </div>
    `)}

    ${formBlock("movein", "MOVE-IN & STORE", `
      <div class="form-grid" style="grid-template-columns:1fr 1fr; margin:0;">
        ${field("cStoreClose", "Store closes", "date", convention?.store_close_on)}
        ${field("cSetup", "Setup day", "date", convention?.setup_on)}
      </div>
      <div style="margin-top:10px;">
        <span style="display:block; font-family:'Fredoka',sans-serif; font-weight:500; font-size:11px; letter-spacing:0.06em; text-transform:uppercase; color:var(--muted); margin-bottom:4px;">Load-in window</span>
        <div style="display:flex; align-items:center; gap:8px;">
          <input type="time" id="cLoadInStart" value="${esc(convention?.load_in_start || "")}">
          <span style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:13px; color:var(--muted);">to</span>
          <input type="time" id="cLoadInEnd" value="${esc(convention?.load_in_end || "")}">
        </div>
      </div>
      <label class="block-label" style="margin:10px 0 0;">Important notes
        <textarea id="cNotes" rows="3" placeholder="Parking, dress code, anything staff need to know">${esc(convention?.notes || "")}</textarea>
      </label>
    `)}

    ${formBlock("links", "LINKS & DRIVE FILES", `
      ${field("cWebsiteUrl", "Official site URL", "url", convention?.website_url, "This year's page")}
      <div class="form-grid" style="grid-template-columns:1fr; margin:10px 0 0;">
        ${field("cMapUrl", "Google Maps link", "url", convention?.map_url, "Optional — links the address if blank")}
        ${field("cParkingMapUrl", "Parking map link", "url", convention?.parking_map_url, "Where to actually park")}
        ${field("cFolder", "Drive folder ID", "text", convention?.drive_folder_id, "Optional")}
        ${field("cLayout", "Booth layout file ID", "text", convention?.booth_layout_file_id, "Optional")}
        ${field("cVenueMapFileId", "Venue map file ID", "text", convention?.venue_map_file_id, "Optional")}
      </div>
    `, 6)}

    <label class="checkbox-label">
      <input type="checkbox" id="cPublished" ${convention?.is_published === false ? "" : "checked"}>
      Visible to staff and volunteers
    </label>

    <p class="form-error" id="conventionError"></p>

    <div class="button-row">
      <button id="saveConventionBtn" style="flex:1;">${editing ? "Save changes" : "Create convention"}</button>
      <button class="btn-quiet" id="cancelConventionBtn">Cancel</button>
    </div>
  `;

  markActiveNav("conventions");

  // Collapsing keeps what's typed: re-render reads current values back in.
  document.querySelectorAll("[data-block]").forEach(strip => {
    strip.onclick = () => {
      const key = strip.dataset.block;
      const draft = readConventionForm();
      openFormBlocks[key] = !openFormBlocks[key];
      renderConventionForm({ ...(convention || {}), ...draft, id: convention?.id, slug: convention?.slug });
    };
  });

  const cancel = () => (editing ? openConvention(convention.slug) : renderConventions());
  document.getElementById("cancelTopBtn").onclick = cancel;
  document.getElementById("cancelConventionBtn").onclick = cancel;

  // Preset buttons: one per show we actually do. Only fills blanks, so a
  // preset can never overwrite something you typed.
  document.querySelectorAll("[data-preset]").forEach(btn => {
    btn.onclick = () => {
      const preset = OUR_CONVENTIONS[Number(btn.dataset.preset)];
      const fills = [
        ["cName", preset.name],
        ["cVenue", preset.venue],
        ["cAddress", preset.address],
        ["cWebsiteUrl", preset.website_url]
      ];

      for (const [id, value] of fills) {
        const input = document.getElementById(id);
        if (input && value && !input.value) {
          input.value = value;
          input.classList.add("flash-target");
          setTimeout(() => input.classList.remove("flash-target"), 1600);
        }
      }
    };
  });

  const saveBtn = document.getElementById("saveConventionBtn");
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;

    const payload = readConventionForm();
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

/* Reads whatever fields are currently on screen. A collapsed block's inputs
   aren't in the DOM, so its values come from the draft that was passed in. */
const CONVENTION_FIELD_IDS = {
  name: "cName",
  venue: "cVenue",
  address: "cAddress",
  starts_on: "cStart",
  ends_on: "cEnd",
  setup_on: "cSetup",
  store_close_on: "cStoreClose",
  load_in_start: "cLoadInStart",
  load_in_end: "cLoadInEnd",
  website_url: "cWebsiteUrl",
  map_url: "cMapUrl",
  parking_map_url: "cParkingMapUrl",
  venue_map_file_id: "cVenueMapFileId",
  booth_number: "cBooth",
  drive_folder_id: "cFolder",
  booth_layout_file_id: "cLayout",
  notes: "cNotes"
};

function readConventionForm() {
  const payload = {};

  for (const [field, id] of Object.entries(CONVENTION_FIELD_IDS)) {
    const el = document.getElementById(id);
    if (el) payload[field] = el.value;
  }

  const published = document.getElementById("cPublished");
  if (published) payload.is_published = published.checked;

  return payload;
}

/* ---------- Shift break allotment (boss) ---------- */

const BREAK_PRESETS = [30, 60, 90, 120];

/**
 * The only place break allotments are set — the staff battery reads what's
 * saved here. The preview block is the real battery component at the current
 * settings, so there's no guessing how a change reads on the floor.
 */
function renderShiftBreakForm(shift, draft = null) {
  const minutes = draft ? draft.minutes : (shift.break_allotment_minutes || 0);
  const breaks = draft ? draft.breaks : (shift.break_count || 1);
  const applyAll = draft ? draft.applyAll : false;

  const presetBtn = (value) => `
    <button style="flex:1; padding:10px 0; border-radius:11px; font-size:14px;
                   background:${minutes === value ? "var(--ink)" : "var(--surface)"};
                   color:${minutes === value ? "var(--paper)" : "var(--text)"};"
            data-preset-min="${value}">${value}</button>
  `;

  const splitBtn = (value, label) => `
    <button style="flex:1; padding:10px 0; border-radius:11px; font-size:13.5px;
                   background:${breaks === value ? "var(--ink)" : "var(--surface)"};
                   color:${breaks === value ? "var(--paper)" : "var(--text)"};"
            data-split="${value}">${label}</button>
  `;

  pageArea().innerHTML = `
    <div class="title-row">
      <button class="back-tile" id="breakBackBtn">‹</button>
      <div style="flex:1;">
        <h2 style="margin:0;">${esc(shift.employee_name || "Unassigned")} · ${esc(shortDayLabel(shift.shift_date))}</h2>
        <div class="meta">${esc(detailData.convention.name)} · ${esc(shift.title)}</div>
      </div>
    </div>

    <div class="card stripped">
      <div class="strip">SHIFT</div>
      <div class="card-body">
        <div style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:17px;">
          ${esc(formatTime(shift.starts_at))} – ${esc(formatTime(shift.ends_at))}
        </div>
      </div>
    </div>

    <div class="card stripped">
      <div class="strip">
        BREAK ALLOTMENT
        <span class="strip-side">${minutes} min total</span>
      </div>
      <div class="card-body">
        <span style="display:block; font-family:'Fredoka',sans-serif; font-weight:500; font-size:11px; letter-spacing:0.06em; text-transform:uppercase; color:var(--muted); margin-bottom:5px;">Total minutes</span>
        <div style="display:flex; gap:7px;">
          ${BREAK_PRESETS.map(presetBtn).join("")}
          <input type="number" id="breakMinutes" value="${minutes}" min="0" max="240"
                 style="width:78px; height:40px; border-radius:11px;">
        </div>

        <span style="display:block; font-family:'Fredoka',sans-serif; font-weight:500; font-size:11px; letter-spacing:0.06em; text-transform:uppercase; color:var(--muted); margin:12px 0 5px;">Split into</span>
        <div style="display:flex; gap:7px;">
          ${splitBtn(1, "One break")}
          ${splitBtn(2, "Two breaks")}
        </div>

        <div style="background:var(--cool-bg); border:2px solid var(--ink); border-radius:12px; padding:11px 12px; margin-top:12px;">
          <div style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:10.5px; letter-spacing:0.06em; color:var(--cool-text); margin-bottom:8px;">
            ${esc((shift.employee_name || "STAFF").split(" ")[0].toUpperCase())} SEES
          </div>
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:7px;">
            <span style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:11.5px; letter-spacing:0.06em; color:var(--cool-text);">BREAK LEFT TODAY</span>
            <span style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:13px; color:var(--cool-text);">
              ${esc(breakBasisText(minutes || 0, breaks))}
            </span>
          </div>
          ${batteryHtml(minutes, minutes, breaks)}
        </div>
      </div>
    </div>

    <label class="checkbox-label">
      <input type="checkbox" id="applyAllShifts" ${applyAll ? "checked" : ""}>
      Use this for every shift on ${esc(shortDayLabel(shift.shift_date))}
    </label>

    <p class="form-error" id="breakError"></p>

    <div class="button-row">
      <button id="saveBreakBtn" style="flex:1;">Save</button>
      <button class="btn-quiet" id="cancelBreakBtn">Cancel</button>
    </div>
  `;

  markActiveNav("conventions");

  const redraw = (changes) => renderShiftBreakForm(shift, {
    minutes, breaks, applyAll: document.getElementById("applyAllShifts").checked, ...changes
  });

  document.querySelectorAll("[data-preset-min]").forEach(btn => {
    btn.onclick = () => redraw({ minutes: Number(btn.dataset.presetMin) });
  });

  document.querySelectorAll("[data-split]").forEach(btn => {
    btn.onclick = () => redraw({ breaks: Number(btn.dataset.split) });
  });

  document.getElementById("breakMinutes").onchange = (e) => {
    const value = parseInt(e.target.value, 10);
    redraw({ minutes: isNaN(value) ? 0 : Math.max(0, Math.min(240, value)) });
  };

  const back = () => openConvention(detailData.convention.slug, false);
  document.getElementById("breakBackBtn").onclick = back;
  document.getElementById("cancelBreakBtn").onclick = back;

  const saveBtn = document.getElementById("saveBreakBtn");
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;

    const result = await apiSend(`/api/convention-shifts/${shift.id}/break`, "PUT", {
      break_allotment_minutes: minutes,
      break_count: breaks,
      apply_to_day: document.getElementById("applyAllShifts").checked
    });

    saveBtn.disabled = false;

    if (!result.ok) {
      showFormError("breakError", result.error || "Could not save that.");
      return;
    }

    await openConvention(detailData.convention.slug, false);
  };
}

window.renderConventions = renderConventions;
window.openConvention = openConvention;
