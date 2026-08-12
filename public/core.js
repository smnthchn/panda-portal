/* Shared helpers used by app.js, admin.js and conventions.js. Loaded first. */

const state = {
  user: null
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    throw new Error(`Expected JSON but got: ${text.slice(0, 200)}`);
  }

  return res.json();
}

function apiSend(path, method, body) {
  return api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
}

/** Every piece of interpolated data goes through this before hitting innerHTML. */
function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function can(permission) {
  return Boolean(state.user?.permissions?.[permission]);
}

function formatDateTime(dt) {
  if (!dt) return "";
  // SQLite's CURRENT_TIMESTAMP is UTC but has no timezone marker.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dt)
    ? dt.replace(" ", "T") + "Z"
    : dt;
  const d = new Date(normalized);
  return isNaN(d) ? dt : d.toLocaleString();
}

/** "2026-09-14" -> "Mon, Sep 14, 2026", without drifting across timezones. */
function formatDate(isoDate) {
  if (!isoDate) return "";
  const d = new Date(`${isoDate}T00:00:00`);
  if (isNaN(d)) return isoDate;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

/** "09:30" -> "9:30 AM" */
function formatTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return hhmm;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatDateRange(startsOn, endsOn) {
  if (!startsOn && !endsOn) return "Dates not set";
  if (!endsOn || startsOn === endsOn) return formatDate(startsOn || endsOn);
  return `${formatDate(startsOn)} – ${formatDate(endsOn)}`;
}

/** Each view's canonical URL, so pages are linkable and survive refresh. */
const PAGE_URLS = {
  dashboard: () => "/",
  conventions: () => "/conventions",
  convention: (d) => `/conventions/${encodeURIComponent(d.slug)}`,
  "knowledge-base": () => "/knowledge-base",
  "my-folder": () => "/my-folder",
  clock: () => "/clock",
  "users-roles": () => "/users-roles",
  doc: (d) => `/doc/${encodeURIComponent(d.id)}`
};

function pushPageState(view, data = {}) {
  const url = PAGE_URLS[view] ? PAGE_URLS[view](data) : location.pathname;
  // Re-opening the page you're already on replaces the entry instead of
  // stacking a duplicate, so Back never needs two clicks to leave.
  if (url === location.pathname) history.replaceState({ view, ...data }, "", url);
  else history.pushState({ view, ...data }, "", url);
}

function setBreadcrumb(items) {
  return `
    <div class="meta breadcrumb">
      ${items.map((item, i) =>
        item.view
          ? `<a href="#" data-crumb="${i}">${esc(item.label)}</a>`
          : `<span>${esc(item.label)}</span>`
      ).join(" &gt; ")}
    </div>
  `;
}

/** Wires the links produced by setBreadcrumb to their navigation callbacks. */
function attachBreadcrumb(items) {
  document.querySelectorAll("[data-crumb]").forEach(link => {
    const item = items[Number(link.dataset.crumb)];
    if (!item?.view) return;
    link.onclick = (e) => {
      e.preventDefault();
      item.view();
    };
  });
}

function pageArea() {
  return document.getElementById("pageArea");
}

function renderError(message) {
  pageArea().innerHTML = `
    <div class="card">
      <h3>Something went wrong</h3>
      <p class="meta">${esc(message)}</p>
    </div>
  `;
}

/** Runs an action, showing its error message rather than throwing into the void. */
async function guard(fn, onError) {
  try {
    return await fn();
  } catch (err) {
    if (onError) onError(err);
    else renderError(err.message);
    return null;
  }
}

function showFormError(container, message) {
  const target = typeof container === "string" ? document.getElementById(container) : container;
  if (!target) return;
  target.textContent = message || "";
  target.style.display = message ? "block" : "none";
}
