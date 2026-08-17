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

/**
 * Same as apiSend, but says how far the body has got.
 *
 * XMLHttpRequest rather than fetch, which can't report upload progress. A
 * shelf photo is around a megabyte over a hall's wifi, and a button that just
 * sits there for ten seconds reads as broken.
 */
function apiUpload(path, method, body, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open(method, path);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/json");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };

    xhr.onerror = () =>
      reject(new Error("The upload didn't get through. Check the signal and try again."));

    xhr.onload = () => {
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch {
        reject(new Error(`Expected JSON but got: ${String(xhr.responseText).slice(0, 200)}`));
      }
    };

    xhr.send(JSON.stringify(body));
  });
}

/* One bar for every upload, pinned above the bottom nav so it stays visible
   whatever you'd scrolled to and whichever screen started the upload. */
let uploadBar = null;

/**
 * A null fraction means "working, but there's nothing to measure" — shrinking
 * the picture before it goes, or waiting on the write once all the bytes have
 * gone out. The bar animates instead of sitting at a number that isn't moving.
 */
function showUploadBar(label, fraction = null) {
  if (!uploadBar) {
    uploadBar = document.createElement("div");
    uploadBar.className = "upload-bar";
    document.body.appendChild(uploadBar);
  }

  const pending = fraction === null || fraction === undefined;
  const percent = pending ? 100 : Math.max(0, Math.min(100, Math.round(fraction * 100)));

  uploadBar.innerHTML = `
    <div class="upload-bar-head">
      <span>${esc(label)}</span>
      <span>${pending ? "" : `${percent}%`}</span>
    </div>
    <div class="upload-track${pending ? " pending" : ""}">
      <span style="width:${percent}%;"></span>
    </div>
  `;
}

function hideUploadBar() {
  uploadBar?.remove();
  uploadBar = null;
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
  resources: () => "/resources",
  convention: (d) => `/conventions/${encodeURIComponent(d.slug)}`,
  "convention-schedule": (d) => `/conventions/${encodeURIComponent(d.slug)}/schedule`,
  "shelf-plan": (d) => `/conventions/${encodeURIComponent(d.slug)}/shelf-plan`,
  "booth-map": (d) => `/conventions/${encodeURIComponent(d.slug)}/booth-map`,
  schedule: () => "/schedule",
  "schedule-store": () => "/schedule",
  "knowledge-base": () => "/knowledge-base",
  "my-folder": () => "/my-folder",
  clock: () => "/clock",
  availability: () => "/availability",
  staff: () => "/staff",
  "staff-member": (d) => `/staff/${encodeURIComponent(d.id)}`,
  "users-roles": () => "/users-roles",
  appearance: () => "/appearance",
  more: () => "/more",
  doc: (d) => `/doc/${encodeURIComponent(d.id)}`
};

/** The five palettes. Applied as a class on <body> from the user's record. */
const THEMES = [
  { id: "habbo", name: "Panda", blurb: "Teal and cream · the default", swatches: ["#17879B", "#F2B53B", "#5FD1A0"], ink: "#23324A" },
  { id: "mario", name: "Mushroom Kingdom", blurb: "Red, sky blue, coin yellow", swatches: ["#E03A2F", "#2A63C4", "#FBC01D"], ink: "#2B2118" },
  { id: "bubble", name: "Bubblegum", blurb: "Pink, lavender, mint", swatches: ["#F2799B", "#8E7BD6", "#5FCFA8"], ink: "#3A3350" },
  { id: "sherbet", name: "Sherbet", blurb: "Coral and turquoise", swatches: ["#FF7A59", "#2FB6A8", "#FFC94D"], ink: "#33261F" },
  { id: "arcade", name: "Arcade night", blurb: "Dark · easier in a dim hall", swatches: ["#2E2540", "#FF5C8A", "#5FE3C0"], ink: "#241C2E" }
];

function applyTheme(themeId) {
  const id = THEMES.some(t => t.id === themeId) ? themeId : "habbo";
  document.body.className = `theme-${id}`;
}

/** "MK" from "Marcus Kwan" — used on avatars. */
function initialsOf(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/**
 * A person's avatar: their own illustration if they have one, else their
 * initials. Same 2px-outlined circle either way, so a team with a mix of
 * both still lines up.
 */
function avatarHtml(person, extraClass = "") {
  const name = person?.name || person?.full_name || "";
  const initials = esc(person?.initials || initialsOf(name));
  const url = person?.avatar_url;

  if (!url) return `<div class="avatar ${extraClass}">${initials}</div>`;

  // The initials stay in the markup underneath the picture, so a picture that
  // fails to load leaves a proper avatar rather than a broken-image icon.
  // alt is empty for the same reason — the initials are already the label.
  return `<div class="avatar has-image ${extraClass}">
    <span>${initials}</span>
    <img src="${esc(url)}" alt="" decoding="async">
  </div>`;
}

/** A picked file, loaded far enough to draw. */
function loadPickedImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file isn't an image the browser can open."));
      img.onload = () => resolve(img);
      img.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

/** WebP where the browser can, so transparency survives; PNG where it can't. */
function canvasDataUri(canvas, quality) {
  const webp = canvas.toDataURL("image/webp", quality);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
}

/**
 * Shrinks a picked image to a square avatar in the browser, so what reaches
 * the server is a few kilobytes rather than a phone camera's several
 * megabytes. Crops to centre-cover and keeps transparency where the browser
 * supports WebP, which illustrations usually want.
 */
async function readImageAsAvatar(file, size = 256) {
  const img = await loadPickedImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  const scale = Math.max(size / img.width, size / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);

  return canvasDataUri(canvas, 0.9);
}

/**
 * Shrinks a picked image to fit inside a box, keeping its shape. Board
 * artwork is a banner rather than a square face, so cropping it to a square
 * the way an avatar is cropped would cut the sign in half.
 */
async function readImageScaled(file, maxEdge = 900) {
  const img = await loadPickedImage(file);

  // Never scale up: a small file stays small rather than being blown up into
  // a bigger one that carries no more detail.
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));

  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);

  return canvasDataUri(canvas, 0.82);
}

/** 95 -> "1h 35m", 40 -> "40m". */
function formatMinutes(total) {
  const mins = Math.max(0, Math.round(total));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** Today's date in the browser's own timezone, as YYYY-MM-DD. */
function todayLocal() {
  return new Date().toLocaleDateString("en-CA");
}

/**
 * The break battery: six cells that empty left to right, so the charge that's
 * left sits against the terminal nub. A two-break allotment gets a divider
 * down the middle marking the split.
 *
 * Cells are a proportion of the allotment, not a fixed ten minutes each —
 * on the design's 60-minute example that's the same ceil(left / 10), but a
 * 30-minute allotment still shows a full battery when nothing's been used.
 */
function batteryHtml(leftMinutes, totalMinutes, breakCount, { draining = false, mini = false } = {}) {
  const left = Math.max(0, leftMinutes);
  const cellsRemaining = totalMinutes > 0 ? Math.ceil((left / totalMinutes) * 6) : 0;
  const state = draining ? "draining" : "full";

  const cell = (i) =>
    `<div class="bcell ${i > 6 - cellsRemaining ? state : ""}"></div>`;

  const cells = [1, 2, 3]
    .map(cell)
    .concat(breakCount > 1 ? ['<div class="bdivider"></div>'] : [])
    .concat([4, 5, 6].map(cell))
    .join("");

  return `
    <div class="battery-row">
      <div class="battery${mini ? " mini" : ""}">${cells}</div>
      <div class="battery-nub"></div>
    </div>
  `;
}

/** "2 × 30 min" when the allotment is split, else "60 min". */
function breakBasisText(totalMinutes, breakCount) {
  return breakCount > 1
    ? `${breakCount} × ${Math.round(totalMinutes / breakCount)} min`
    : `${totalMinutes} min`;
}

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
