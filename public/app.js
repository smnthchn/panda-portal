/* Portal shell, login, dashboard, Knowledge Base / My Folder / Clock / Appearance. */

function showLoadingScreen() {
  document.getElementById("app").innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <h1 style="visibility:hidden; margin:0;">Panda Portal</h1>
      </div>
    </div>
  `;
}

function renderLogin(clientId = "") {
  applyTheme("habbo");

  document.getElementById("app").innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <h1>Panda Portal</h1>
        <p class="meta">Internal staff portal</p>
        <p>Please sign in with your approved Google account.</p>
        <div id="googleSignInButton" style="margin-top:16px;"></div>
      </div>
    </div>
  `;

  const tryRenderButton = () => {
    if (window.google?.accounts?.id && clientId) {
      google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredentialResponse
      });

      google.accounts.id.renderButton(
        document.getElementById("googleSignInButton"),
        { theme: "outline", size: "large" }
      );
      return true;
    }
    return false;
  };

  if (!tryRenderButton()) {
    let attempts = 0;
    const interval = setInterval(() => {
      if (tryRenderButton() || ++attempts > 50) clearInterval(interval);
    }, 100);
  }
}

/* ---------- Shell ---------- */

const NAV_ITEMS = [
  { id: "navDashboard", label: "Home", group: "Today", permission: null, view: "dashboard", nav: true },
  // The boss reads this page rather than punching it, so it's named for what
  // they use it for. Same screen, different job.
  { id: "navClock", label: "Clock", bossLabel: "Hours", group: "Today", permission: "clock", view: "clock", nav: true },
  { id: "navConventions", label: "Events", group: "Operations", permission: "conventions", view: "conventions", nav: true },
  { id: "navSchedule", label: "Schedule", group: "Operations", permission: "manage_conventions", view: "schedule" },
  { id: "navStaff", label: "Staff", group: "Operations", permission: "manage_users", view: "staff" },
  { id: "navKnowledgeBase", label: "Docs", group: "Reference", permission: "knowledge_base", view: "knowledge-base" },
  { id: "navMyFolder", label: "My Folder", group: "Reference", permission: "employee_folder", view: "my-folder" },
  { id: "navAvailability", label: "My availability", group: "Reference", permission: null, view: "availability" },
  { id: "navUsers", label: "Users & Roles", group: "Admin", permission: "manage_users", view: "users-roles" },
  { id: "navAppearance", label: "Appearance", group: "Admin", permission: null, view: "appearance" }
];

/* The phone's four-item bar. Everything else lives behind More, which is the
   only way to reach the sidebar-only screens when the sidebar is hidden. */
const BOTTOM_NAV = [
  { label: "Home", view: "dashboard", permission: null },
  { label: "Clock", bossLabel: "Hours", view: "clock", permission: "clock" },
  { label: "Events", view: "conventions", permission: "conventions" },
  { label: "More", view: "more", permission: null }
];

/* Nav entries for work that isn't built yet — shown greyed so the shape of
   the system is visible without pretending the screens exist. */
const NAV_STUBS = ["Inventory", "Purchasing"];

function visibleNavItems() {
  return NAV_ITEMS
    .filter(item => !item.permission || can(item.permission))
    .map(item => ({
      ...item,
      label: item.bossLabel && can("manage_users") ? item.bossLabel : item.label
    }));
}

function goToView(view) {
  const target = { view };
  pushPageState(view);
  guard(() => POPSTATE_VIEWS[view](target));
}

function renderShell(user) {
  state.user = user;
  applyTheme(user.theme_id);

  const items = visibleNavItems();
  const groups = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.name === item.group) last.items.push(item);
    else groups.push({ name: item.group, items: [item] });
  }

  document.getElementById("app").innerHTML = `
    <div class="portal-shell">
      <aside class="sidebar" id="sidebar">
        <h1><span class="app-tile">P</span> Panda Portal</h1>
        <nav>
          ${groups.map(group => `
            <div class="nav-group">${esc(group.name)}</div>
            ${group.items.map(item =>
              `<a href="#" id="${item.id}">${esc(
                item.label === "Home" ? "Dashboard" : item.label === "Hours" ? "Timesheets" : item.label
              )}</a>`
            ).join("")}
          `).join("")}
          <div class="nav-group">Not built yet</div>
          ${NAV_STUBS.map(label => `<div class="nav-stub">${esc(label)}</div>`).join("")}
        </nav>
        <a href="#" id="navLogout">Log out</a>
      </aside>

      <main class="main">
        <div class="page" id="pageArea"></div>
      </main>

      <nav class="bottom-nav" id="bottomNav">
        ${BOTTOM_NAV
          .filter(item => !item.permission || can(item.permission))
          .map(item => `
            <a href="#" data-bottom-nav="${esc(item.view)}">
              <div class="nav-dot"></div>${esc(
                item.bossLabel && can("manage_users") ? item.bossLabel : item.label
              )}
            </a>
          `).join("")}
      </nav>
    </div>
  `;

  for (const item of items) {
    document.getElementById(item.id).onclick = (e) => {
      e.preventDefault();
      goToView(item.view);
    };
  }

  document.querySelectorAll("[data-bottom-nav]").forEach(link => {
    link.onclick = (e) => {
      e.preventDefault();
      goToView(link.dataset.bottomNav);
    };
  });

  document.getElementById("navLogout").onclick = async (e) => {
    e.preventDefault();
    await api("/api/logout", { method: "POST" });
    state.user = null;
    await loadApp();
  };
}

/**
 * Marks the current view active in both navs, and sets the column width.
 * Every render calls this, so `wide` can't leak from the previous screen.
 */
function markActiveNav(view, { wide = false } = {}) {
  document.querySelectorAll("[data-bottom-nav]").forEach(link => {
    link.classList.toggle("active", link.dataset.bottomNav === view);
  });

  for (const item of NAV_ITEMS) {
    document.getElementById(item.id)?.classList.toggle("active", item.view === view);
  }

  pageArea().classList.toggle("wide", wide);
}

/* ---------- Dashboard ---------- */

/** "14:30" -> "2:30 PM". */
function hhmmToLabel(hhmm) {
  return formatTime(hhmm);
}

/** Short "2 PM" / "10:30 AM" for the ends of the hours bar. */
function shortTimeLabel(hhmm) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h)) return "";
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, "0")} ${suffix}` : `${hour} ${suffix}`;
}

function dashHeader(data) {
  return `
    <div class="dash-header">
      <div class="who">
        <div class="app-tile">P</div>
        <div>
          <div class="date">${esc(formatDate(data.today))}</div>
          <div class="meta">${esc(data.user.full_name.split(" ")[0])} · ${esc(roleDisplayName(data.user.role))}</div>
        </div>
      </div>
      ${avatarHtml(data.user)}
    </div>
  `;
}

function eventBand(data) {
  const { event } = data;
  return `
    <div class="event-band" data-open-event="${esc(event.slug)}">
      <span class="pill pill-ink">DAY ${event.day_index} OF ${event.day_count}</span>
      <span class="band-title">
        ${esc(event.name)}${event.booth_number ? ` · Booth ${esc(event.booth_number)}` : ""}
      </span>
    </div>
  `;
}

/** Elapsed time on the clock, from the punch that opened the shift. */
function elapsedSince(utcStamp) {
  if (!utcStamp) return "On the clock";
  const started = new Date(utcStamp.replace(" ", "T") + "Z");
  return formatMinutes((Date.now() - started.getTime()) / 60000);
}

function clockCard(data) {
  const { clock } = data;
  const onBreak = clock.status === "break";
  const clockedIn = clock.status === "in" || onBreak;

  if (!clockedIn) {
    return `
      <div class="card navy">
        <div class="kicker" style="color:var(--clock-sub);">NOT CLOCKED IN</div>
        <div style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:23px; margin:6px 0 13px;">
          ${data.my_shift ? "Ready when you are" : "Off today"}
        </div>
        <div class="button-row" style="margin:0;">
          <button class="btn-go" style="flex:1;" data-clock-action="/api/clock-in">Clock in</button>
        </div>
        <p class="form-error" id="clockError"></p>
      </div>
    `;
  }

  return `
    <div class="card navy${onBreak ? " on-break" : ""}"
         ${onBreak ? 'style="background:var(--warm-deep-bg,#5C4413); box-shadow:0 4px 0 #42300B;"' : ""}>
      <div class="kicker" style="color:${onBreak ? "var(--warm)" : "var(--go)"};">
        ${onBreak ? "ON BREAK" : "ON THE CLOCK"}
      </div>
      <div style="display:flex; align-items:baseline; justify-content:space-between; margin:6px 0 13px;">
        <div style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:23px; line-height:1.1;">
          ${onBreak ? "Break running" : esc(elapsedSince(clock.since))}
        </div>
        <div style="font-size:12px; color:${onBreak ? "#E4CE9B" : "var(--clock-sub)"};">
          Since ${esc(timeOf(clock.since))}
        </div>
      </div>
      <div class="button-row" style="margin:0;">
        <button class="btn-go" style="flex:1;" data-clock-action="/api/clock-out">Clock out</button>
        ${onBreak
          ? `<button class="btn-warm" data-clock-action="/api/break-end">End break</button>`
          : `<button class="btn-ghost-go" data-clock-action="/api/break-start">Start break</button>`}
      </div>
      <p class="form-error" id="clockError"></p>
    </div>
  `;
}

/**
 * Break battery. The allotment is set on the shift by the boss; what's left
 * is that minus what today's punches have already used.
 */
function breakBatteryCard(data) {
  const shift = data.my_shift;
  if (!shift || !shift.break_allotment_minutes) return "";

  const total = shift.break_allotment_minutes;
  const used = Math.round(data.clock.break_minutes_used || 0);
  const left = Math.max(0, total - used);
  const onBreak = data.clock.status === "break";
  const low = left <= 20;

  return `
    <div class="card">
      <div style="display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:9px;">
        <div>
          <div class="kicker" style="font-weight:600; font-size:11.5px; letter-spacing:0.06em; color:var(--muted);">
            BREAK LEFT TODAY
          </div>
          <div class="meta" style="margin-top:2px;">${esc(breakBasisText(total, shift.break_count))}</div>
        </div>
        <span style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:13px; color:${low ? "var(--alert)" : "var(--text)"};">
          ${esc(formatMinutes(left))} left
        </span>
      </div>
      ${batteryHtml(left, total, shift.break_count, { draining: onBreak })}
      <div class="meta" style="margin-top:8px;">
        ${onBreak
          ? "Draining now. Ends automatically at zero."
          : `${esc(formatMinutes(used))} of ${esc(formatMinutes(total))} used`}
      </div>
    </div>
  `;
}

function myShiftCard(data) {
  const shift = data.my_shift;

  if (!shift) {
    // The boss doesn't work shifts, so an empty personal card is just noise
    // on their screen — the roster below is what they came for.
    if (data.can_manage) return "";

    return `
      <div class="card stripped">
        <div class="strip brand">YOUR SHIFT</div>
        <div class="card-body"><p class="empty-state">You're not on the schedule today.</p></div>
      </div>
    `;
  }

  return `
    <div class="card stripped">
      <div class="strip brand">YOUR SHIFT</div>
      <div class="card-body" style="display:flex; align-items:center; gap:12px;">
        <div style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:17px;">
          ${esc(hhmmToLabel(shift.starts_at))} – ${esc(hhmmToLabel(shift.ends_at))}
        </div>
        <div class="meta" style="flex:1;">${esc(shift.title)}</div>
      </div>
    </div>
  `;
}

function hallHoursCard(data) {
  const { hall } = data;
  if (!hall || !hall.segments) return "";

  const showMetrics = data.can_manage && data.coverage;

  return `
    <div class="card stripped">
      <div class="strip cool">
        HALL OPEN TODAY
        <span class="strip-side">
          ${esc(shortTimeLabel(hall.regular_start))} – ${esc(shortTimeLabel(hall.regular_end))}
        </span>
      </div>
      <div class="card-body">
        <div class="segbar">
          ${hall.segments.map(seg => `
            <div class="seg ${esc(seg.kind)}" style="width:${seg.width.toFixed(1)}%;">
              ${seg.kind === "open"
                ? `OPEN ${esc(shortTimeLabel(hall.regular_start))} – ${esc(shortTimeLabel(hall.regular_end))}`
                : esc(seg.label)}
            </div>
          `).join("")}
          ${nowMarkerHtml(hall)}
        </div>
        <div class="segbar-scale">
          <span>${esc(shortTimeLabel(minutesToHhmm(hall.span_start)))}</span>
          <span>${esc(shortTimeLabel(minutesToHhmm(hall.span_end)))}</span>
        </div>

        ${showMetrics ? `
          <div style="margin-top:11px; display:flex; gap:16px; border-top:2px solid var(--track); padding-top:11px;">
            <div>
              <div class="meta" style="letter-spacing:0.07em;">BOOTH STAFFED</div>
              <div style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:16px;">
                ${esc(hhmmToLabel(data.coverage.from))} – ${esc(hhmmToLabel(data.coverage.to))}
              </div>
            </div>
            <div>
              <div class="meta" style="letter-spacing:0.07em;">SHIFTS TODAY</div>
              <div style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:16px;">${data.coverage.count}</div>
            </div>
          </div>
        ` : data.my_shift ? `
          <div style="margin-top:11px; display:flex; align-items:center; gap:10px; border-top:2px solid var(--track); padding-top:11px;">
            <span class="kicker" style="font-weight:600; font-size:11.5px; letter-spacing:0.06em; color:var(--muted);">YOUR SHIFT</span>
            <span style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:16px; margin-left:auto;">
              ${esc(hhmmToLabel(data.my_shift.starts_at))} – ${esc(hhmmToLabel(data.my_shift.ends_at))}
            </span>
          </div>
        ` : ""}

        ${hall.notes ? `<div class="note-block" style="margin-top:11px;">${esc(hall.notes)}</div>` : ""}
      </div>
    </div>
  `;
}

function minutesToHhmm(minutes) {
  if (!Number.isFinite(minutes)) return "";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** A 4px ink bar at the current time's position, if we're inside the day. */
function nowMarkerHtml(hall) {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < hall.span_start || minutes > hall.span_end) return "";

  const pct = ((minutes - hall.span_start) / (hall.span_end - hall.span_start)) * 100;
  return `<div class="now-marker" style="left:${pct.toFixed(1)}%;"></div>`;
}

/** The badge on a roster row. Late is the one worth a red pill. */
function rosterStatusPill(person) {
  if (person.status === "in") return `<span class="pill pill-go">IN</span>`;
  if (person.status === "break") return `<span class="pill pill-warm">BREAK</span>`;
  if (person.status === "late") return `<span class="pill pill-late">LATE</span>`;
  if (person.status === "missed") return `<span class="pill pill-late">NO SHOW</span>`;
  if (person.status === "done") return `<span class="pill">DONE</span>`;
  return `<span class="pill">${esc(shortTimeLabel(person.starts_at))}</span>`;
}

/** What a person's row says under their name. */
function rosterLine(person) {
  const when = person.starts_at
    ? `${hhmmToLabel(person.starts_at)} – ${hhmmToLabel(person.ends_at)}`
    : "No shift on the schedule";

  const what = [person.title, person.event_name].filter(Boolean).join(" · ");
  return what ? `${what} · ${when}` : when;
}

/**
 * Who's on today. The boss gets everyone with their times and live status —
 * including anyone who clocked in without a shift, which on a store day is
 * the whole team. Staff just see who else is around.
 */
function rosterCard(data) {
  const boss = data.can_manage;

  if (!boss && !data.roster.length) return "";

  const onNow = data.roster.filter(p => p.clocked_in).length;
  const scheduled = data.roster.filter(p => p.starts_at).length;

  return `
    <div class="card stripped">
      <div class="strip">
        ${boss ? "WHO'S ON TODAY" : data.day_type === "event" ? "AT THE BOOTH TODAY" : "ON WITH YOU"}
        <span class="strip-side">
          ${boss
            ? `${onNow} on now · ${scheduled} scheduled`
            : data.roster.length}
        </span>
      </div>
      <div class="card-body">
        ${data.roster.length ? data.roster.map(person => `
          <div class="roster-row${person.clocked_in ? "" : " later"}">
            ${avatarHtml(person, `small${person.clocked_in ? " present" : ""}`)}
            <div style="flex:1;">
              <div style="font-size:13px;">
                ${esc(person.name)}
                ${person.role === "volunteer" ? `<span class="meta"> · volunteer</span>` : ""}
              </div>
              ${boss ? `<div class="meta">${esc(rosterLine(person))}</div>` : ""}
            </div>
            ${boss
              ? rosterStatusPill(person)
              : `<span class="meta" style="color:${person.clocked_in ? "var(--brand-text)" : "var(--muted)"};">
                   ${person.clocked_in ? "now" : person.starts_at ? `from ${esc(shortTimeLabel(person.starts_at))}` : ""}
                 </span>`}
          </div>
        `).join("") : `
          <p class="empty-state">
            Nobody is scheduled today, and nobody has clocked in yet.
          </p>
          ${data.event ? `
            <p class="meta">
              Shifts are set on an event's page — open ${esc(data.event.name)} to build its schedule.
            </p>
          ` : ""}
        `}
      </div>
    </div>
  `;
}

/** The only forward-looking element on a store day. */
function upcomingNudge(data) {
  const { event } = data;
  if (!event || data.day_type === "event") return "";

  return `
    <div class="card" style="background:var(--note-bg); border-color:var(--ink); display:flex; align-items:center; gap:10px; cursor:pointer;"
         data-open-event="${esc(event.slug)}">
      <span style="width:10px; height:10px; border-radius:3px; background:var(--warm); flex:none;"></span>
      <div style="flex:1; font-size:13px; color:var(--note-text);">
        ${esc(event.name)} in ${event.days_away} day${event.days_away === 1 ? "" : "s"}
        <div class="meta" style="color:var(--note-text); opacity:0.8;">
          ${event.my_shift_count
            ? `You're on ${event.my_shift_count} shift${event.my_shift_count === 1 ? "" : "s"}`
            : "No shifts for you yet"}
        </div>
      </div>
      <span style="font-family:'Fredoka',sans-serif; font-size:15px; color:var(--note-text);">›</span>
    </div>
  `;
}

async function renderDashboard(user, pushState = true) {
  if (pushState) pushPageState("dashboard");

  const data = await api(`/api/dashboard?today=${encodeURIComponent(todayLocal())}`);

  if (!data.ok) {
    renderError(data.error || "Could not load your dashboard");
    return;
  }

  // The boss gets the floor, not a clock card.
  const showClock = data.clock && !data.can_manage;

  pageArea().innerHTML = `
    ${dashHeader(data)}
    ${data.day_type === "event" && data.event ? eventBand(data) : ""}
    ${showClock ? clockCard(data) : ""}
    ${showClock && data.day_type === "event" ? breakBatteryCard(data) : ""}
    ${data.day_type === "event" ? hallHoursCard(data) : myShiftCard(data)}
    ${rosterCard(data)}
    ${upcomingNudge(data)}
  `;

  markActiveNav("dashboard");
  wireClockButtons(() => renderDashboard(user, false));

  document.querySelectorAll("[data-open-event]").forEach(el => {
    el.onclick = () => openConvention(el.dataset.openEvent);
  });
}

/** Clock in / out / break buttons, wherever they appear. */
function wireClockButtons(reload) {
  document.querySelectorAll("[data-clock-action]").forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      const result = await apiSend(btn.dataset.clockAction, "POST");

      if (!result.ok) {
        showFormError("clockError", result.error || "That didn't work.");
        btn.disabled = false;
        return;
      }

      await reload();
    };
  });
}

function roleDisplayName(role) {
  return { boss: "Boss", staff: "Staff", volunteer: "Volunteer" }[role] || role;
}

/* ---------- Knowledge Base & My Folder ---------- */

async function renderKnowledgeBase(pushState = true) {
  if (pushState) pushPageState("knowledge-base");

  const data = await api("/api/knowledge-base");

  if (!data.ok) {
    renderError(data.error || "Could not load knowledge base");
    return;
  }

  pageArea().innerHTML = `
    <div class="page-header">
      <h2>Knowledge Base</h2>
      <p>Internal documents and SOP folders</p>
    </div>

    ${data.sections.length
      ? data.sections.map(section => `
          <div class="card stripped">
            <div class="strip">${esc(section.name)}</div>
            <div class="card-body">
              ${section.files.length
                ? `<ul class="file-list">
                    ${section.files.map(file => `
                      <li>
                        <a href="#" data-doc-id="${esc(file.id)}" data-doc-name="${esc(file.name)}"
                           data-section="${esc(section.name)}">${esc(file.name)}</a>
                      </li>
                    `).join("")}
                  </ul>`
                : `<p class="empty-state">No files in this section yet.</p>`}
            </div>
          </div>
        `).join("")
      : `<div class="card"><p class="empty-state">No sections are shared with your role yet.</p></div>`}
  `;

  markActiveNav("knowledge-base");

  document.querySelectorAll("[data-doc-id]").forEach(link => {
    link.onclick = (e) => {
      e.preventDefault();
      openDoc(link.dataset.docId, link.dataset.docName, {
        kind: "kb",
        label: "Knowledge Base",
        section: link.dataset.section
      });
    };
  });
}

async function renderMyFolder(pushState = true) {
  if (pushState) pushPageState("my-folder");

  const data = await api("/api/my-folder");

  if (!data.ok) {
    renderError(data.error || "Could not load folder");
    return;
  }

  pageArea().innerHTML = `
    <div class="page-header">
      <h2>My Folder</h2>
      <p>Your employee documents and assigned files</p>
    </div>

    <div class="card">
      ${data.files.length
        ? `<ul class="file-list">
            ${data.files.map(file => `
              <li><a href="#" data-doc-id="${esc(file.id)}" data-doc-name="${esc(file.name)}">${esc(file.name)}</a></li>
            `).join("")}
          </ul>`
        : `<p class="empty-state">No files in your folder yet.</p>`}
    </div>
  `;

  markActiveNav("my-folder");

  document.querySelectorAll("[data-doc-id]").forEach(link => {
    link.onclick = (e) => {
      e.preventDefault();
      openDoc(link.dataset.docId, link.dataset.docName, { kind: "folder", label: "My Folder" });
    };
  });
}

/**
 * origin describes where the reader came from, so the breadcrumb and Back
 * button lead somewhere sensible. It's plain data so it survives history state.
 */
function originView(origin) {
  if (origin?.kind === "folder") return () => renderMyFolder();
  if (origin?.kind === "convention") return () => openConvention(origin.slug);
  return () => renderKnowledgeBase();
}

async function openDoc(id, name, origin = { kind: "kb", label: "Knowledge Base" }, pushState = true) {
  if (pushState) pushPageState("doc", { id, name, origin });

  const data = await api(`/api/doc-content?id=${encodeURIComponent(id)}`);

  if (!data.ok) {
    renderError(data.error || "Failed to load document");
    return;
  }

  const back = originView(origin);

  pageArea().innerHTML = `
    <div class="title-row">
      <button class="back-tile" id="docBackBtn">‹</button>
      <h2>${esc(data.title || name)}</h2>
    </div>

    <div class="card doc-viewer">${data.html}</div>
  `;

  markActiveNav(origin?.kind === "folder" ? "my-folder" : "knowledge-base");
  document.getElementById("docBackBtn").onclick = () => guard(back);
}

/* ---------- Clock ---------- */

/** Local calendar date (YYYY-MM-DD) of a UTC "YYYY-MM-DD HH:MM:SS" timestamp. */
function localDateOf(dt) {
  return new Date(dt.replace(" ", "T") + "Z").toLocaleDateString("en-CA");
}

function timeOf(dt) {
  return new Date(dt.replace(" ", "T") + "Z")
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Monday of the week containing a local YYYY-MM-DD date. */
function weekStartOf(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toLocaleDateString("en-CA");
}

/**
 * One table row. fixIndex: undefined = no fix column at all (own hours),
 * null = fix column but no button (someone working right now), a number =
 * a Fix button wired to teamFixList[fixIndex].
 */
function shiftRow(shift, fixIndex) {
  const date = formatDate(localDateOf(shift.in_at));
  const fixCell = fixIndex === undefined
    ? ""
    : `<td class="fix-cell">${fixIndex === null
        ? ""
        : `<button class="btn-quiet" data-fix="${fixIndex}">Fix</button>`}</td>`;

  // No clock-out: today it means they're working right now; any earlier day
  // means someone forgot. Neither counts toward a total.
  if (!shift.out_at) {
    const working = localDateOf(shift.in_at) === todayLocal();
    return `
      <tr class="${working ? "" : "shift-incomplete"}">
        <td>${esc(date)}</td>
        <td>${esc(timeOf(shift.in_at))} –</td>
        <td></td>
        <td class="net-cell">${working ? "Still clocked in" : "No clock-out recorded"}</td>
        ${fixCell}
      </tr>
    `;
  }

  // 16+ hours is almost always a clock-out pressed the next morning.
  const long = shift.net_minutes >= 960;

  return `
    <tr class="${long ? "shift-long" : ""}">
      <td>${esc(date)}</td>
      <td>${esc(timeOf(shift.in_at))} – ${esc(timeOf(shift.out_at))}</td>
      <td>${shift.break_minutes ? `${esc(formatMinutes(shift.break_minutes))} break` : ""}</td>
      <td class="net-cell">${esc(formatMinutes(shift.net_minutes))}${long ? " — check this" : ""}</td>
      ${fixCell}
    </tr>
  `;
}

function myHoursCard(shifts) {
  if (!shifts.length) {
    return `
      <div class="card stripped">
        <div class="strip">YOUR HOURS</div>
        <div class="card-body">
          <p class="empty-state">Worked shifts will show up here once you've clocked in and out.</p>
        </div>
      </div>
    `;
  }

  // Newest week first, newest shift first inside it.
  const weeks = new Map();
  for (const shift of [...shifts].reverse()) {
    const week = weekStartOf(localDateOf(shift.in_at));
    if (!weeks.has(week)) weeks.set(week, []);
    weeks.get(week).push(shift);
  }

  return `
    <div class="card stripped">
      <div class="strip">YOUR HOURS<span class="strip-side">Last nine weeks</span></div>
      <div class="card-body">
        ${[...weeks.entries()].map(([week, rows]) => {
          const total = rows.reduce((sum, s) => sum + (s.net_minutes || 0), 0);
          return `
            <h4>Week of ${esc(formatDate(week))} <span class="meta">· ${esc(formatMinutes(total))}</span></h4>
            <table class="hours-table"><tbody>${rows.map(s => shiftRow(s)).join("")}</tbody></table>
          `;
        }).join("")}
        <p class="meta">Breaks deducted from the totals.</p>
      </div>
    </div>
  `;
}

function teamHoursCard() {
  const start = new Date();
  start.setDate(start.getDate() - 13);

  return `
    <div class="card stripped">
      <div class="strip">TEAM HOURS</div>
      <div class="card-body">
        <div class="inline-form report-range">
          <label>From <input type="date" id="reportFrom" value="${esc(start.toLocaleDateString("en-CA"))}"></label>
          <label>To <input type="date" id="reportTo" value="${esc(todayLocal())}"></label>
          <button id="loadReportBtn">Show</button>
        </div>
        <p class="form-error" id="reportError"></p>
        <div id="reportArea"><p class="meta">Loading…</p></div>
        <p class="meta">
          Fix a wrong or missing clock-out with a row's Fix button — the correction
          is stamped with your name in the punch log.
        </p>
      </div>
    </div>
  `;
}

let teamFixList = [];

async function loadTeamHours() {
  const from = document.getElementById("reportFrom").value;
  const to = document.getElementById("reportTo").value;
  showFormError("reportError", "");

  const result = await api(
    `/api/admin/clock-report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  );

  if (!result.ok) {
    showFormError("reportError", result.error || "Could not load the report.");
    return;
  }

  teamFixList = [];

  // The server sends a day of slack each side; trim to the exact local dates.
  const blocks = result.employees.map(person => {
    const shifts = person.shifts.filter(s => {
      const day = localDateOf(s.in_at);
      return day >= from && day <= to;
    });
    if (!shifts.length) return "";

    const total = shifts.reduce((sum, s) => sum + (s.net_minutes || 0), 0);
    const rows = [...shifts].reverse().map(shift => {
      // Someone working right now isn't a mistake to fix.
      const working = !shift.out_at && localDateOf(shift.in_at) === todayLocal();
      if (working) return shiftRow(shift, null);

      teamFixList.push({ employee_id: person.id, in_at: shift.in_at, out_at: shift.out_at });
      return shiftRow(shift, teamFixList.length - 1);
    }).join("");

    return `
      <div class="person-block">
        <h4>${esc(person.full_name)} <span class="meta">· ${esc(formatMinutes(total))}</span></h4>
        <table class="hours-table"><tbody>${rows}</tbody></table>
      </div>
    `;
  }).filter(Boolean);

  document.getElementById("reportArea").innerHTML = blocks.length
    ? `<div class="people-grid">${blocks.join("")}</div>`
    : `<p class="empty-state">No clock activity between those dates.</p>`;

  document.querySelectorAll("[data-fix]").forEach(btn => {
    btn.onclick = () => openFixEditor(btn.closest("tr"), teamFixList[Number(btn.dataset.fix)]);
  });
}

/** Date -> the browser-local "YYYY-MM-DDTHH:MM" a datetime-local input wants. */
function toLocalInput(d) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function asDate(dt) {
  return new Date(dt.replace(" ", "T") + "Z");
}

function openFixEditor(row, shift) {
  document.getElementById("fixEditorRow")?.remove();

  // Start from the recorded clock-out; if there isn't one, guess in + 8h.
  const initial = shift.out_at
    ? toLocalInput(asDate(shift.out_at))
    : toLocalInput(new Date(asDate(shift.in_at).getTime() + 8 * 3600 * 1000));

  const editor = document.createElement("tr");
  editor.id = "fixEditorRow";
  editor.innerHTML = `
    <td colspan="5">
      <div class="inline-form">
        <label>Clock-out <input type="datetime-local" id="fixOutInput" value="${esc(initial)}"></label>
        <button id="fixSaveBtn">Save</button>
        <button class="btn-quiet" id="fixCancelBtn">Cancel</button>
      </div>
      <p class="form-error" id="fixError"></p>
    </td>
  `;
  row.after(editor);

  document.getElementById("fixCancelBtn").onclick = () => editor.remove();

  document.getElementById("fixSaveBtn").onclick = async () => {
    const value = document.getElementById("fixOutInput").value;
    if (!value) {
      showFormError("fixError", "Pick the clock-out time.");
      return;
    }

    const saveBtn = document.getElementById("fixSaveBtn");
    saveBtn.disabled = true;

    const result = await apiSend("/api/admin/clock-fix", "POST", {
      employee_id: shift.employee_id,
      in_at: shift.in_at,
      out_at: new Date(value).toISOString().slice(0, 19).replace("T", " ")
    });

    if (!result.ok) {
      saveBtn.disabled = false;
      showFormError("fixError", result.error || "Could not save that fix.");
      return;
    }

    await loadTeamHours();
  };
}

/**
 * The boss doesn't punch a clock — they read everyone else's. So this page is
 * the timesheets for them: the team report first, and their own hours only if
 * they turn out to have punches of their own.
 */
function renderTimesheets(history) {
  const ownShifts = history.ok ? history.shifts : [];

  pageArea().innerHTML = `
    <div class="page-header">
      <h2>Timesheets</h2>
      <p>Everyone's hours, with breaks deducted</p>
    </div>

    ${teamHoursCard()}
    ${ownShifts.length ? myHoursCard(ownShifts) : ""}
  `;

  markActiveNav("clock", { wide: true });

  const loadReportBtn = document.getElementById("loadReportBtn");
  loadReportBtn.onclick = () => guard(loadTeamHours);
  guard(loadTeamHours);
}

async function renderClock(pushState = true) {
  if (pushState) pushPageState("clock");

  const [data, history] = await Promise.all([
    api("/api/clock-status"),
    api("/api/clock-history")
  ]);

  if (!data.ok) {
    renderError(data.error || "Could not load clock status");
    return;
  }

  if (can("manage_users")) {
    renderTimesheets(history);
    return;
  }

  const status = data.profile?.clock_user_status || "out";
  const onBreak = status === "break";
  const clockedIn = status === "in" || onBreak;

  const actions = {
    out: [{ label: "Clock in", path: "/api/clock-in", cls: "btn-go" }],
    in: [
      { label: "Clock out", path: "/api/clock-out", cls: "btn-go" },
      { label: "Start break", path: "/api/break-start", cls: "btn-ghost-go" }
    ],
    break: [
      { label: "Clock out", path: "/api/clock-out", cls: "btn-go" },
      { label: "End break", path: "/api/break-end", cls: "btn-warm" }
    ]
  }[status] || [];

  pageArea().innerHTML = `
    <div class="page-header">
      <h2>Clock</h2>
      <p>${esc(data.employee.full_name)} · ${esc(roleDisplayName(data.employee.role))}</p>
    </div>

    <div class="card navy" ${onBreak ? 'style="background:#5C4413; box-shadow:0 4px 0 #42300B;"' : ""}>
      <div class="kicker" style="color:${onBreak ? "var(--warm)" : clockedIn ? "var(--go)" : "var(--clock-sub)"};">
        ${onBreak ? "ON BREAK" : clockedIn ? "ON THE CLOCK" : "NOT CLOCKED IN"}
      </div>
      <div style="display:flex; align-items:baseline; justify-content:space-between; margin:6px 0 13px;">
        <div style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:23px; line-height:1.1;">
          ${onBreak ? "Break running" : clockedIn && data.last_event
            ? esc(elapsedSince(data.last_event.created_at))
            : "Off the clock"}
        </div>
        ${clockedIn && data.last_event
          ? `<div style="font-size:12px; color:${onBreak ? "#E4CE9B" : "var(--clock-sub)"};">
               Since ${esc(timeOf(data.last_event.created_at))}
             </div>`
          : data.last_event
            ? `<div style="font-size:12px; color:var(--clock-sub);">
                 Last out ${esc(timeOf(data.last_event.created_at))}
               </div>`
            : ""}
      </div>
      <div class="button-row" style="margin:0;">
        ${actions.map((a, i) => `
          <button class="${a.cls}" ${i === 0 ? 'style="flex:1;"' : ""} data-clock-action="${a.path}">${esc(a.label)}</button>
        `).join("")}
      </div>
      <p class="form-error" id="clockError"></p>
    </div>

    ${myHoursCard(history.ok ? history.shifts : [])}
  `;

  markActiveNav("clock");
  wireClockButtons(() => renderClock(false));
}

/* ---------- More (phone) ---------- */

/**
 * The phone bar only holds four items, so everything else lands here. On a
 * desktop these are all in the sidebar, but the sidebar is hidden on a phone
 * and without this screen those pages would be unreachable.
 */
function renderMore(pushState = true) {
  if (pushState) pushPageState("more");

  const items = visibleNavItems().filter(item =>
    !BOTTOM_NAV.some(nav => nav.view === item.view)
  );

  pageArea().innerHTML = `
    <div class="page-header">
      <h2>More</h2>
      <p>${esc(state.user.full_name)} · ${esc(roleDisplayName(state.user.role))}</p>
    </div>

    <div class="card stripped">
      <div class="strip">EVERYTHING ELSE</div>
      <div>
        ${items.map(item => `
          <a href="#" data-more="${esc(item.view)}"
             style="display:flex; align-items:center; gap:11px; padding:13px; border-bottom:2px solid var(--track); text-decoration:none; color:inherit;">
            <span style="flex:1; font-family:'Fredoka',sans-serif; font-weight:600; font-size:14px;">
              ${esc(item.label)}
            </span>
            <span style="font-family:'Fredoka',sans-serif; font-size:15px; color:var(--muted);">›</span>
          </a>
        `).join("")}
        <a href="#" id="moreLogout"
           style="display:flex; align-items:center; gap:11px; padding:13px; text-decoration:none; color:var(--alert);">
          <span style="flex:1; font-family:'Fredoka',sans-serif; font-weight:600; font-size:14px;">Log out</span>
        </a>
      </div>
    </div>
  `;

  markActiveNav("more");

  document.querySelectorAll("[data-more]").forEach(link => {
    link.onclick = (e) => {
      e.preventDefault();
      goToView(link.dataset.more);
    };
  });

  document.getElementById("moreLogout").onclick = async (e) => {
    e.preventDefault();
    await api("/api/logout", { method: "POST" });
    state.user = null;
    await loadApp();
  };
}

/* ---------- Appearance ---------- */

async function renderAppearance(pushState = true) {
  if (pushState) pushPageState("appearance");

  const current = state.user.theme_id || "habbo";

  pageArea().innerHTML = `
    <div class="page-header">
      <h2>Appearance</h2>
      <p>Just for you — nobody else sees your pick</p>
    </div>

    ${THEMES.map(theme => `
      <div class="theme-row" data-theme="${esc(theme.id)}">
        <div class="swatches">
          ${theme.swatches.map(color =>
            `<span class="swatch" style="background:${esc(color)}; border-color:${esc(theme.ink)};"></span>`
          ).join("")}
        </div>
        <div style="flex:1;">
          <div style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:14.5px;">${esc(theme.name)}</div>
          <div class="meta">${esc(theme.blurb)}</div>
        </div>
        <span class="picked${theme.id === current ? " on" : ""}">${theme.id === current ? "✓" : ""}</span>
      </div>
    `).join("")}

    <div class="card cool">
      <h3>One thing stays fixed</h3>
      <p style="margin:0; font-size:12.5px; line-height:1.45;">
        Green always means on the clock and red always means needs attention, in
        every theme. Only the decoration changes.
      </p>
    </div>
  `;

  markActiveNav("appearance");

  document.querySelectorAll("[data-theme]").forEach(row => {
    row.onclick = async () => {
      const themeId = row.dataset.theme;

      // Repaint immediately; the save is a formality that follows.
      applyTheme(themeId);
      state.user.theme_id = themeId;
      renderAppearance(false);

      const result = await apiSend("/api/theme", "PUT", { theme_id: themeId });
      if (!result.ok) alert(result.error || "Could not save that theme.");
    };
  });
}

/* ---------- Login & boot ---------- */

async function handleCredentialResponse(response) {
  try {
    const result = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ credential: response.credential })
    });

    if (result.ok) {
      await loadApp();
    } else {
      alert(result.error || "Login failed");
    }
  } catch (err) {
    alert("Login error: " + err.message);
  }
}

/** Maps a pathname back to a view state, for direct links and refreshes. */
function viewForPath(pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";

  const shelfPlan = path.match(/^\/conventions\/([^/]+)\/shelf-plan$/);
  if (shelfPlan) return { view: "shelf-plan", slug: decodeURIComponent(shelfPlan[1]) };

  const conventionSchedule = path.match(/^\/conventions\/([^/]+)\/schedule$/);
  if (conventionSchedule) {
    return { view: "convention-schedule", slug: decodeURIComponent(conventionSchedule[1]) };
  }

  const convention = path.match(/^\/conventions\/([^/]+)$/);
  if (convention) return { view: "convention", slug: decodeURIComponent(convention[1]) };

  const staff = path.match(/^\/staff\/(\d+)$/);
  if (staff) return { view: "staff-member", id: Number(staff[1]) };

  const doc = path.match(/^\/doc\/([^/]+)$/);
  if (doc) return { view: "doc", id: decodeURIComponent(doc[1]) };

  const flat = {
    "/": "dashboard",
    "/conventions": "conventions",
    "/resources": "resources",
    "/knowledge-base": "knowledge-base",
    "/my-folder": "my-folder",
    "/clock": "clock",
    "/schedule": "schedule",
    "/availability": "availability",
    "/staff": "staff",
    "/users-roles": "users-roles",
    "/appearance": "appearance",
    "/more": "more"
  };
  return { view: flat[path] || "dashboard" };
}

const POPSTATE_VIEWS = {
  dashboard: () => renderDashboard(state.user, false),
  conventions: () => renderConventions(false),
  resources: () => renderResources(false),
  convention: (s) => openConvention(s.slug, false),
  schedule: () => renderStoreSchedule(null, false),
  "convention-schedule": (s) => renderSchedule(s.slug, false),
  "shelf-plan": (s) => renderShelfPlan(s.slug, false),
  "knowledge-base": () => renderKnowledgeBase(false),
  "my-folder": () => renderMyFolder(false),
  clock: () => renderClock(false),
  availability: () => renderMyAvailability(false),
  staff: () => renderStaff(false),
  "staff-member": (s) => openStaffMember(s.id, false),
  "users-roles": () => renderUsersRoles(false),
  appearance: () => renderAppearance(false),
  more: () => renderMore(false),
  doc: (s) => openDoc(s.id, s.name, s.origin, false)
};

window.onpopstate = async (event) => {
  const view = POPSTATE_VIEWS[event.state?.view];
  if (!view) return;

  const me = await api("/api/me");

  if (!me.ok) {
    renderLogin(me.googleClientId || "");
    return;
  }

  state.user = me.user;
  await guard(() => view(event.state));
};

async function loadApp() {
  try {
    showLoadingScreen();

    const me = await api("/api/me");

    if (!me.ok) {
      renderLogin(me.googleClientId || "");
      return;
    }

    renderShell(me.user);

    // Land on whatever the URL says, so a refresh or shared link opens that
    // page rather than the dashboard. history.state wins when present — the
    // browser keeps it across refreshes and it can carry more than the URL
    // does (a doc's origin, for the breadcrumb).
    const target = POPSTATE_VIEWS[history.state?.view] ? history.state : viewForPath(location.pathname);
    history.replaceState(target, "", PAGE_URLS[target.view](target));
    guard(() => POPSTATE_VIEWS[target.view](target));
  } catch (err) {
    document.getElementById("app").innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <h1>Error</h1>
          <p>${esc(err.message)}</p>
        </div>
      </div>
    `;
  }
}

window.handleCredentialResponse = handleCredentialResponse;
window.openDoc = openDoc;
window.markActiveNav = markActiveNav;

showLoadingScreen();
loadApp();
