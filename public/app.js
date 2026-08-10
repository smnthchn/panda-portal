/* Portal shell, login, and the Knowledge Base / My Folder / Clock views. */

function getStatusClass(status) {
  if (status === "in") return "status-badge status-in";
  if (status === "break") return "status-badge status-break";
  return "status-badge status-out";
}

function showLoadingScreen() {
  document.getElementById("app").innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <h1 style="visibility:hidden; margin:0;">Panda Portal</h1>
      </div>
    </div>
  `;
}

function closeMobileMenu() {
  document.getElementById("sidebar")?.classList.remove("mobile-open");
  document.getElementById("mobileMenuOverlay")?.classList.remove("show");
}

function openMobileMenu() {
  document.getElementById("sidebar")?.classList.add("mobile-open");
  document.getElementById("mobileMenuOverlay")?.classList.add("show");
}

function attachMobileMenuHandlers() {
  const toggle = document.getElementById("mobileMenuToggle");
  const overlay = document.getElementById("mobileMenuOverlay");

  if (toggle) {
    toggle.onclick = () => {
      const sidebar = document.getElementById("sidebar");
      if (sidebar && sidebar.classList.contains("mobile-open")) closeMobileMenu();
      else openMobileMenu();
    };
  }

  if (overlay) overlay.onclick = () => closeMobileMenu();
}

function renderLogin(clientId = "") {
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
  { id: "navDashboard", label: "Dashboard", permission: null, view: () => renderDashboard(state.user) },
  { id: "navConventions", label: "Conventions", permission: "conventions", view: () => renderConventions() },
  { id: "navKnowledgeBase", label: "Knowledge Base", permission: "knowledge_base", view: () => renderKnowledgeBase() },
  { id: "navMyFolder", label: "My Folder", permission: "employee_folder", view: () => renderMyFolder() },
  { id: "navClock", label: "Clock", permission: "clock", view: () => renderClock() },
  { id: "navUsers", label: "Users & Roles", permission: "manage_users", view: () => renderUsersRoles() }
];

function visibleNavItems() {
  return NAV_ITEMS.filter(item => !item.permission || can(item.permission));
}

function renderShell(user) {
  state.user = user;
  const items = visibleNavItems();

  document.getElementById("app").innerHTML = `
    <div class="portal-shell">
      <div id="mobileMenuOverlay" class="mobile-menu-overlay"></div>

      <aside class="sidebar" id="sidebar">
        <h1>Panda Portal</h1>
        <nav>
          ${items.map(item => `<a href="#" id="${item.id}">${esc(item.label)}</a>`).join("")}
          <a href="#" id="navLogout">Logout</a>
        </nav>
      </aside>

      <main class="main">
        <div class="mobile-topbar">
          <button id="mobileMenuToggle" class="hamburger-btn" aria-label="Open menu">☰</button>
          <div class="mobile-topbar-title">Panda Portal</div>
        </div>
        <div id="pageArea"></div>
      </main>
    </div>
  `;

  attachMobileMenuHandlers();

  for (const item of items) {
    document.getElementById(item.id).onclick = (e) => {
      e.preventDefault();
      closeMobileMenu();
      guard(item.view);
    };
  }

  document.getElementById("navLogout").onclick = async (e) => {
    e.preventDefault();
    closeMobileMenu();
    await api("/api/logout", { method: "POST" });
    state.user = null;
    await loadApp();
  };

  renderDashboard(user, false);
}

/* ---------- Dashboard ---------- */

const DASHBOARD_CARDS = [
  {
    permission: "conventions",
    title: "Conventions",
    body: "Schedules, booth layout, checklists and event details.",
    view: () => renderConventions()
  },
  {
    permission: "knowledge_base",
    title: "Knowledge Base",
    body: "View SOPs, docs, and internal reference materials.",
    view: () => renderKnowledgeBase()
  },
  {
    permission: "employee_folder",
    title: "My Folder",
    body: "Open your employee folder and personal internal files.",
    view: () => renderMyFolder()
  },
  {
    permission: "clock",
    title: "Clock",
    body: "Clock in, clock out, and check your current status.",
    view: () => renderClock()
  },
  {
    permission: "manage_users",
    title: "Users & Roles",
    body: "Add people and control what each role can see.",
    view: () => renderUsersRoles()
  }
];

function renderDashboard(user, pushState = true) {
  if (pushState) pushPageState("dashboard");

  const cards = DASHBOARD_CARDS.filter(card => can(card.permission));

  pageArea().innerHTML = `
    <div class="page-header">
      <h2>Welcome, ${esc(user.full_name)}</h2>
      <p>${esc(roleDisplayName(user.role))} • ${esc(user.email)}</p>
    </div>

    <div class="card-grid">
      ${cards.map((card, i) => `
        <div class="action-card">
          <h3>${esc(card.title)}</h3>
          <p>${esc(card.body)}</p>
          <button data-dash="${i}">Open</button>
        </div>
      `).join("")}
    </div>
  `;

  document.querySelectorAll("[data-dash]").forEach(btn => {
    btn.onclick = () => guard(cards[Number(btn.dataset.dash)].view);
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

  const crumbs = [{ label: "Knowledge Base" }];

  pageArea().innerHTML = `
    ${setBreadcrumb(crumbs)}

    <div class="page-header">
      <h2>Knowledge Base</h2>
      <p>Internal documents and SOP folders</p>
    </div>

    ${data.sections.length
      ? data.sections.map(section => `
          <div class="card">
            <h3>${esc(section.name)}</h3>
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
        `).join("")
      : `<div class="card"><p class="empty-state">No sections are shared with your role yet.</p></div>`}
  `;

  attachBreadcrumb(crumbs);

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

  const crumbs = [{ label: "My Folder" }];

  pageArea().innerHTML = `
    ${setBreadcrumb(crumbs)}

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

  attachBreadcrumb(crumbs);

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
  const crumbs = [{ label: origin.label, view: back }];
  if (origin.section) crumbs.push({ label: origin.section });

  pageArea().innerHTML = `
    ${setBreadcrumb(crumbs)}

    <div class="page-header">
      <h2>${esc(data.title || name)}</h2>
      <p>Read only document view</p>
    </div>

    <div class="button-row" style="margin-bottom:16px;">
      <button id="docBackBtn">← Back</button>
    </div>

    <div class="card doc-viewer">${data.html}</div>
  `;

  attachBreadcrumb(crumbs);
  document.getElementById("docBackBtn").onclick = () => guard(back);
}

/* ---------- Clock ---------- */

const CLOCK_ACTIONS = {
  out: [{ label: "Clock In", path: "/api/clock-in" }],
  in: [
    { label: "Start Break", path: "/api/break-start" },
    { label: "Clock Out", path: "/api/clock-out" }
  ],
  break: [{ label: "End Break", path: "/api/break-end" }]
};

async function renderClock(pushState = true) {
  if (pushState) pushPageState("clock");

  const data = await api("/api/clock-status");

  if (!data.ok) {
    renderError(data.error || "Could not load clock status");
    return;
  }

  const status = data.profile?.clock_user_status || "out";
  const actions = CLOCK_ACTIONS[status] || [];
  const crumbs = [{ label: "Clock" }];

  const lastEventText = data.last_event
    ? `${data.last_event.event_type.replace("_", " ")} at ${formatDateTime(data.last_event.created_at)}`
    : "No clock activity yet";

  pageArea().innerHTML = `
    ${setBreadcrumb(crumbs)}

    <div class="page-header">
      <h2>Clock</h2>
      <p>Clock status and actions</p>
    </div>

    <div class="card">
      <p><strong>Name:</strong> ${esc(data.employee.full_name)}</p>
      <p><strong>Role:</strong> ${esc(roleDisplayName(data.employee.role))}</p>
      <p><strong>Status:</strong> <span class="${getStatusClass(status)}">${esc(status)}</span></p>
      <p><strong>Last Event:</strong> ${esc(lastEventText)}</p>

      <div class="button-row">
        ${actions.length
          ? actions.map((a, i) => `<button data-clock="${i}">${esc(a.label)}</button>`).join("")
          : `<p class="empty-state">Unknown clock status: ${esc(status)}</p>`}
      </div>
      <p class="form-error" id="clockError"></p>
    </div>
  `;

  attachBreadcrumb(crumbs);

  document.querySelectorAll("[data-clock]").forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      const result = await apiSend(actions[Number(btn.dataset.clock)].path, "POST");

      if (!result.ok) {
        showFormError("clockError", result.error || "That didn't work.");
        btn.disabled = false;
        return;
      }

      await renderClock(false);
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

const POPSTATE_VIEWS = {
  dashboard: () => renderDashboard(state.user, false),
  conventions: () => renderConventions(false),
  convention: (s) => openConvention(s.slug, false),
  "knowledge-base": () => renderKnowledgeBase(false),
  "my-folder": () => renderMyFolder(false),
  clock: () => renderClock(false),
  "users-roles": () => renderUsersRoles(false),
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

showLoadingScreen();
loadApp();
