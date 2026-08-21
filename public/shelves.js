/* Shelf plan — the booth prep tool that replaced the spreadsheet.

   Two surfaces: the grid (every field edits in place) and the to-scale booth
   map. Stage ticks are the hot path — several people tick boxes at once
   during setup — so each one is its own small write and the UI updates
   optimistically rather than waiting for a round trip. */

let shelfData = null;
let shelfView = "grid";        // grid | map
let shelfFilter = "all";       // all | left
let shelfSelected = null;      // position id
let signsMode = false;
let arrangeMode = false;
let openSignageFor = null;
let openBoardsFor = null;       // which row's Boards strip is open
let openShelfFor = null;        // which row's section/remove strip is open
let newGroupingFor = null;      // which row's strip is showing the new-family form
let personSelected = null;      // which person circle is selected on the map
let openGroupingsFor = null;    // which row's product strip is open
let viewingPhoto = null;        // photo id, shown full size
let viewingBoard = null;        // { positionId, face }, shown full size
let pickingArtFor = null;       // { positionId, face } while the picker is open
let shelfDetailFor = null;      // phone: which unit is opened up, tier by tier
let openTierFor = null;         // phone: which tier of it is expanded
let movingGrouping = null;      // phone: { groupingId } while picking a tier to move to

/* The design draws the booth at 31px per foot. That's 502px wide, which a
   phone can't show and can't be pinch-zoomed inside the app, so the scale
   shrinks to whatever fits the column. Never scales up past the design. */
const DESIGN_PX_PER_FOOT = 31;
let pxPerFoot = DESIGN_PX_PER_FOOT;

function measureScale() {
  const boothWidth = shelfData?.booth?.width || 16;
  const available = (pageArea()?.clientWidth || 0) - 6;   // 3px border each side

  // The detail panel sits beside the map on a wide screen, so leave it room.
  const forMap = available > 900 ? Math.min(available - 320, 640) : available;

  pxPerFoot = Math.max(9, Math.min(DESIGN_PX_PER_FOOT, forMap / boothWidth));
  return pxPerFoot;
}

/**
 * The plan and the booth map are two pages, not two tabs: the map is what
 * you send someone ("look at where C5 is"), and a refresh on it should come
 * back to it rather than to the grid. `view` is null on a reload, which
 * leaves whichever of the two you were on alone.
 */
async function renderShelfPlan(slug, pushState = true, view = null) {
  if (view) shelfView = view;
  if (pushState) pushPageState(shelfPlanPage(), { slug });

  const data = await api(`/api/conventions/${encodeURIComponent(slug)}/shelf-plan`);

  if (!data.ok) {
    renderError(data.error || "Could not load the shelf plan");
    return;
  }

  shelfData = data;

  if (!data.positions.some(p => p.id === shelfSelected)) {
    shelfSelected = data.positions[0]?.id || null;
  }

  drawShelfPlan();
}

/** Which of the two pages the current view belongs to. */
function shelfPlanPage() {
  return shelfView === "map" ? "booth-map" : "shelf-plan";
}

/** The grid is a spreadsheet; a phone gets a list of units instead. */
function onPhone() {
  return window.matchMedia("(max-width: 800px)").matches;
}

function drawShelfPlan() {
  const { positions } = shelfData;

  // The preview is parked on <body>, so a redraw would otherwise leave it
  // floating over a row that no longer exists.
  hideBoardPreview();

  if (!positions.length) {
    drawEmptyShelfPlan();
    return;
  }

  const list = onPhone();

  pageArea().innerHTML = `
    ${shelfHeader()}
    ${shelfView === "map"
      ? boothMap()
      : list
        ? (shelfDetailFor ? shelfDetail() : shelfList())
        : shelfGrid()}

    <input type="file" id="shelfPhotoInput" style="display:none;"
           accept="image/png,image/jpeg,image/webp" capture="environment">

    ${pickingArtFor ? artworkPicker() : ""}
    ${viewingPhoto ? photoLightbox() : ""}
    ${viewingBoard ? boardLightbox() : ""}
  `;

  markActiveNav("conventions", { wide: !list });

  // A full-screen overlay covers the page but doesn't stop it scrolling
  // underneath, which leaves a scrollbar down the side of a picture that is
  // supposed to be the whole screen.
  document.documentElement.classList.toggle(
    "overlay-open",
    Boolean(viewingPhoto || viewingBoard || pickingArtFor)
  );

  watchShelfWidth();
  wireShelfPlan();
}

/** Before there's a plan: start from the standard booth, or last show's. */
function drawEmptyShelfPlan() {
  const { convention, copyFrom, canManage } = shelfData;

  pageArea().innerHTML = `
    <div class="title-row">
      <button class="back-tile" id="shelfBackBtn">‹</button>
      <div style="flex:1;">
        <h2 style="margin:0;">Booth Plan</h2>
        <div class="meta">${esc(convention.name)}</div>
      </div>
    </div>

    <div class="card">
      <h3>No booth plan yet</h3>
      <p style="margin:0 0 12px; font-size:13px; line-height:1.5;">
        A booth plan lists every shelving unit — what's on it, what signage it
        needs, and how far through prep it is. Start from the standard 31-unit
        booth, or carry forward a previous show's plan and adjust it.
      </p>
      <p class="form-error" id="shelfError"></p>
      ${canManage ? `
        <div class="button-row" style="margin:0;">
          <button id="startFromTemplateBtn">Start from the standard booth</button>
        </div>
        ${copyFrom.length ? `
          <div class="inline-form" style="margin-top:10px;">
            <select id="copyPlanFrom">
              ${copyFrom.map(c => `
                <option value="${esc(c.slug)}">${esc(c.name)} — ${c.positions} units</option>
              `).join("")}
            </select>
            <button class="btn-quiet" id="startFromCopyBtn">Carry forward</button>
          </div>
        ` : ""}
      ` : `<p class="empty-state">A boss hasn't set up the booth plan yet.</p>`}
    </div>
  `;

  markActiveNav("conventions", { wide: true });

  document.getElementById("shelfBackBtn").onclick = () => openConvention(convention.slug);

  const start = (body) => async () => {
    const result = await apiSend(
      `/api/conventions/${encodeURIComponent(convention.slug)}/shelf-plan`,
      "POST",
      body
    );

    if (!result.ok) {
      showFormError("shelfError", result.error || "Could not start that plan.");
      return;
    }

    await renderShelfPlan(convention.slug, false);
  };

  document.getElementById("startFromTemplateBtn")?.addEventListener("click", start({}));
  document.getElementById("startFromCopyBtn")?.addEventListener("click", () =>
    start({ from_slug: document.getElementById("copyPlanFrom").value })()
  );
}

function shelfHeader() {
  const { convention, positions, totals, booth } = shelfData;
  const left = positions.reduce((sum, p) =>
    sum + p.stages.filter((done, stage) => !done && stageApplies(p, stage)).length, 0);

  return `
    <div class="title-row">
      <button class="back-tile" id="shelfBackBtn">‹</button>
      <div class="screen-title">
        <div class="kicker-line">
          ${esc(convention.name.toUpperCase())}${convention.booth_number ? ` · BOOTH ${esc(convention.booth_number)}` : ""}
          · ${booth.width}′ × ${booth.depth}′
        </div>
        <h2>Booth Plan</h2>
        <div class="meta">
          ${positions.length} positions ·
          ${left ? `${left} boxes left to tick` : "everything ticked"}
        </div>
      </div>
      <div class="button-row" style="margin:0;">
        <button class="${shelfView === "grid" && shelfFilter === "all" ? "" : "btn-quiet"}" data-shelf-view="grid-all">All shelves</button>
        <button class="${shelfView === "grid" && shelfFilter === "left" ? "" : "btn-quiet"}" data-shelf-view="grid-left">Still to do</button>
        <button class="${shelfView === "map" ? "" : "btn-quiet"}" data-shelf-view="map">Booth map</button>
      </div>
    </div>

    <div class="stage-batteries">
      ${totals.map(total => stageBattery(total)).join("")}
    </div>

    <p class="form-error" id="shelfError"></p>
  `;
}

function stageBattery({ label, done, total }) {
  const colour = total && done === total
    ? "var(--go-text)"
    : done === 0 ? "var(--alert)" : "var(--text)";

  return `
    <div class="stage-battery">
      <div class="stage-battery-head">
        <span>${esc(label)}</span>
        <span style="color:${colour};">${done} / ${total}</span>
      </div>
      <div class="stage-battery-cells">
        ${Array.from({ length: total }, (_, i) =>
          `<span class="${i < done ? "on" : ""}"></span>`
        ).join("")}
      </div>
    </div>
  `;
}

/** Boards only applies where the shelf actually needs signage. */
function stageApplies(position, stage) {
  return stage === 4 ? position.signage.length > 0 : true;
}

/* ---------- The grid ---------- */

function shelfGrid() {
  const { positions, stages, canManage } = shelfData;

  const shown = shelfFilter === "left"
    ? positions.filter(p => p.stages.some((done, stage) => !done && stageApplies(p, stage)))
    : positions;

  if (!shown.length) {
    return `<div class="card"><p class="empty-state">Everything is ticked. The booth is ready.</p></div>`;
  }

  const walls = [];
  for (const position of shown) {
    const last = walls[walls.length - 1];
    if (last && last.wall === position.wall) last.positions.push(position);
    else walls.push({ wall: position.wall, note: position.wall_note, positions: [position] });
  }

  return `
    <div class="card stripped shelf-grid-card">
      <div class="shelf-grid-head">
        <span class="col-shelf">SHELF</span>
        <span class="col-product">PRODUCT</span>
        <span class="col-type">TYPE</span>
        <span class="col-signage">SIGNAGE NEEDED</span>
        <span class="col-board">BOARDS</span>
        ${shelfData.totals.map(t => `
          <span class="col-stage">${esc(t.label)}<em>${t.done} / ${t.total}</em></span>
        `).join("")}
      </div>

      ${walls.map(group => `
        <div class="shelf-wall-row">
          ${esc(group.wall)}
          ${group.note ? `<span class="meta"> — ${esc(group.note)}</span>` : ""}
        </div>
        ${group.positions.map(shelfRow).join("")}
      `).join("")}

      ${canManage ? `
        <div class="shelf-grid-foot">
          <div class="inline-form" style="margin:0;">
            <input type="text" id="newPositionCode" placeholder="S2" style="width:90px;">
            <select id="newPositionWall">
              ${shelfData.walls.map(wall => `<option value="${esc(wall)}">${esc(wall)}</option>`).join("")}
            </select>
            <button class="btn-quiet add-shelf" id="addPositionBtn">+ Add a shelf</button>
          </div>
        </div>
      ` : ""}
    </div>
  `;
}

/**
 * A row. Staff tick boxes and nothing else — the plan itself is the boss's,
 * so for everyone else the editable fields render as plain text rather than
 * as controls that would be refused by the server anyway.
 */
function shelfRow(position) {
  const applicable = position.stages.filter((_, stage) => stageApplies(position, stage));
  const complete = applicable.every(Boolean);
  const canEdit = shelfData.canManage;

  return `
    <div class="shelf-row${complete ? " done" : ""}" data-row="${position.id}">
      <span class="col-shelf">
        ${canEdit
          ? `<button class="shelf-code" data-shelf="${position.id}"
                     title="Rename it, move it to another section, or remove it">${esc(position.code)}</button>`
          : esc(position.code)}
      </span>

      <span class="col-product">
        ${canEdit
          ? `<button class="boards-cell" data-groupings="${position.id}">
              ${position.groupings.length
                ? position.groupings.map(g => groupingChip(g, position.layout)).join("")
                : `<span class="cell-add">+</span>`}
            </button>`
          : `<span class="boards-cell static">
              ${position.groupings.length
                ? position.groupings.map(g => groupingChip(g, position.layout)).join("")
                : `<span class="meta">—</span>`}
            </span>`}
      </span>

      <span class="col-type">
        ${canEdit
          ? `<select class="type-pill" data-field="unit_type" data-position="${position.id}">
              ${shelfData.unitTypes.map(type => `
                <option value="${esc(type)}" ${type === position.unit_type ? "selected" : ""}>${esc(type)}</option>
              `).join("")}
            </select>`
          : `<span class="type-pill static">${esc(position.unit_type || "—")}</span>`}
      </span>

      <span class="col-signage">
        ${canEdit
          ? `<button class="signage-cell" data-signage="${position.id}">
              ${position.signage.length
                ? position.signage.map(code => signageTag(code)).join("")
                : `<span class="cell-add">+</span>`}
            </button>`
          : `<span class="signage-cell static">
              ${position.signage.length
                ? position.signage.map(code => signageTag(code)).join("")
                : `<span class="meta">—</span>`}
            </span>`}
      </span>

      <span class="col-board">
        ${canEdit
          ? `<button class="boards-cell" data-boards="${position.id}">
              ${position.boards.length
                ? position.boards.map(boardName).join("")
                : `<span class="cell-add">+</span>`}
            </button>`
          : `<span class="boards-cell static">
              ${position.boards.length
                ? position.boards.map(boardName).join("")
                : `<span class="meta">—</span>`}
            </span>`}
      </span>

      ${position.stages.map((done, stage) => `
        <span class="col-stage">${stageBox(position, stage, done)}</span>
      `).join("")}
    </div>

    ${openSignageFor === position.id ? signageStrip(position) : ""}
    ${openBoardsFor === position.id ? boardsStrip(position) : ""}
    ${openShelfFor === position.id ? shelfStrip(position) : ""}
    ${openGroupingsFor === position.id ? groupingsStrip(position) : ""}
  `;
}

/**
 * A family on a shelf, with how deep each of its SKUs is faced and — once
 * it's standing somewhere — the guide for how many pieces it fits here.
 *
 * The guide is Sam's number for what one tier fits, times the tiers the
 * family actually has. Nothing is computed from box or shelf sizes any more —
 * that math never matched the floor.
 */
function groupingChip(grouping, layout = null) {
  const shown = layout?.families?.find(f => f.id === grouping.id);
  const offTier = layout?.offTier?.find(f => f.id === grouping.id);

  const tail = offTier
    ? `<em>· ${offTier.placement === "side" ? "on the side" : "up top"}</em>`
    : shown && shown.placed && shown.guide
      ? `<em>×${grouping.facings} · ~${shown.guide}</em>`
      : `<em>×${grouping.facings}</em>`;

  const unplaced = shown && !shown.placed;

  return `
    <span class="grouping-chip${unplaced ? " unplaced" : ""}"
          title="${esc(grouping.name)} · ${grouping.facings} per SKU${
            shown && shown.placed && shown.guide
              ? ` · fits about ${shown.guide} here (${shown.guidePerTier} a tier)`
              : ""}${
            shown?.pool ? ` · ${shown.pool} in stock` : ""}${
            unplaced ? " · not on a tier yet" : ""}">
      ${esc(grouping.name)}${tail}
    </span>
  `;
}

/** Tier 1 is the top one, so a range reads the way the shelf is looked at. */
function tierRange(tiers) {
  if (!tiers.length) return "not placed";
  const runs = [];
  for (const tier of tiers) {
    const last = runs[runs.length - 1];
    if (last && tier === last[1] + 1) last[1] = tier;
    else runs.push([tier, tier]);
  }
  return runs.map(([from, to]) => from === to ? `T${from}` : `T${from}–T${to}`).join(", ");
}

/**
 * Which tiers a family stands on.
 *
 * Toggles rather than a range, because a family skips tiers on purpose: small
 * easy-to-pocket stock is kept in the top three or four so nobody is bending
 * over an open bag.
 */
function tierToggles(position, grouping) {
  const on = new Set(
    (position.layout?.tiers || [])
      .filter(t => t.families.some(f => f.id === grouping.id))
      .map(t => t.tier)
  );

  if (!position.tier_count) {
    return `<span class="meta">This unit has no tiers.</span>`;
  }

  return `
    <span class="tier-toggles">
      ${Array.from({ length: position.tier_count }, (_, i) => i + 1).map(tier => `
        <button class="tier-toggle${on.has(tier) ? " on" : ""}"
                data-tier-toggle="${position.id}" data-grouping="${grouping.id}"
                data-tier="${tier}"
                title="${on.has(tier) ? "Take it off" : "Put it on"} tier ${tier}">T${tier}</button>
      `).join("")}
    </span>
  `;
}

/**
 * Choosing what stands on a shelf.
 *
 * The families come from the store's library — one rack is HG Universal
 * Century at every show, and only the depth changes. Facings is that dial:
 * 3 or 4 at Anime North, 1 or 2 at Fan Expo. The library is edited from
 * here too — the add list ends in "+ New grouping…", and the ✎ renames a
 * family everywhere it appears, since this strip is the only place the
 * library surfaces.
 */
function groupingsStrip(position) {
  const onShelf = new Map(position.groupings.map(g => [g.id, g]));

  return `
    <div class="signage-strip groupings-strip">
      ${position.groupings.map(g => {
        const offTier = position.layout?.offTier.find(f => f.id === g.id);
        const shown = position.layout?.families.find(f => f.id === g.id);

        return `
        <span class="board-slot">
          <span class="grouping-chip on">${esc(g.name)}</span>
          <button class="board-slot-clear" data-grouping-rename="${g.id}"
                  data-name="${esc(g.name)}"
                  title="Rename this family — everywhere it appears">✎</button>

          ${offTier ? `
            <span class="tier-note">
              ${offTier.placement === "side"
                ? "Zip-tied to the side — no tier of its own."
                : "Goes up top, on the shelves rather than in them."}
              ${offTier.pool ? `<em>${offTier.pool} in stock</em>` : ""}
            </span>
          ` : `
            <label class="facings">
              <span class="board-slot-face">PER SKU</span>
              <input type="number" min="1" max="12" value="${g.facings}"
                     data-facings="${position.id}" data-grouping="${g.id}">
            </label>

            <label class="facings" title="How many pieces one tier fits. Changes it for the family everywhere.">
              <span class="board-slot-face">PER TIER</span>
              <input type="number" min="1" max="999" value="${g.guide_pieces ?? ""}"
                     placeholder="—" data-guide="${g.id}">
            </label>

            <span class="tier-pick">
              <span class="board-slot-face">TIERS</span>
              ${tierToggles(position, g)}
            </span>

            <span class="tier-note">
              ${shown && shown.placed
                ? shown.guide
                  ? `Fits about <strong>${shown.guide}</strong> here · ${tierRange(shown.tiers)}${shown.pool ? ` · ${shown.pool} in stock` : ""}`
                  : `${tierRange(shown.tiers)} — no guide set for this family yet.`
                : `<span class="unplaced-note">Not on a tier yet.</span>`}
            </span>
          `}

          <button class="board-slot-clear" data-grouping-remove="${position.id}"
                  data-grouping="${g.id}" title="Take it off this shelf">×</button>
        </span>
      `;}).join("")}

      <label class="facings tier-count-field">
        <span class="board-slot-face">TIERS ON THIS UNIT</span>
        <input type="number" min="0" max="12" value="${position.tier_count ?? 0}"
               data-tier-count="${position.id}">
      </label>

      ${newGroupingFor === position.id ? `
        <span class="board-slot">
          <input type="text" id="newGroupingName" placeholder="Family name" style="width:160px;">
          <label class="facings" title="Optional: pieces one tier fits">
            <span class="board-slot-face">PER TIER</span>
            <input type="number" id="newGroupingGuide" min="1" max="999" placeholder="—">
          </label>
          <button class="btn-quiet" id="createGroupingBtn">Add</button>
        </span>
      ` : `
        <select data-grouping-add="${position.id}">
          <option value="">+ Add a grouping…</option>
          ${shelfData.groupings
            .filter(g => !onShelf.has(g.id))
            .map(g => `<option value="${g.id}">${esc(g.name)}</option>`)
            .join("")}
          <option value="__new">+ New grouping…</option>
        </select>
      `}

      <button class="btn-quiet" id="closeGroupingsBtn"
              style="border:none; background:none; padding:6px 8px;">Save</button>
    </div>
  `;
}

/**
 * A shelf's name, which section it's in, and the way to remove it.
 *
 * Unlike the signage and boards strips, this one waits for Save. Moving a
 * shelf takes its row out from under you and re-sorts the grid around it, so
 * doing that the instant the list changes is startling — and there's no
 * undo. Pick the section, look at it, then commit.
 */
function shelfStrip(position) {
  return `
    <div class="signage-strip shelf-strip">
      <span class="board-slot-face">NAME</span>
      <input type="text" data-shelf-code="${position.id}" value="${esc(position.code)}"
             maxlength="12" style="width:76px;">

      <span class="board-slot-face">SECTION</span>
      <select data-wall="${position.id}">
        ${shelfData.walls.map(wall => `
          <option value="${esc(wall)}" ${wall === position.wall ? "selected" : ""}>${esc(wall)}</option>
        `).join("")}
      </select>

      <label class="checkbox-label" title="Draws in the cream fill on the map, like the cash desk">
        <input type="checkbox" data-shelf-kind ${position.kind === "other" ? "checked" : ""}>
        Not a selling shelf
      </label>

      <button class="btn-danger" data-delete-shelf="${position.id}">Remove ${esc(position.code)}</button>

      <button class="btn-quiet" id="closeShelfBtn"
              style="border:none; background:none; padding:6px 8px;">Save</button>
    </div>
  `;
}

/**
 * A board in the grid: its name, with the artwork on hover. The name is what
 * you read down the column; the picture is what you check when the name isn't
 * enough, and a row of thumbnails at cell size would be neither.
 */
function boardName(board) {
  return `
    <span class="board-name-cell" data-preview="${esc(board.image_url || "")}"
          title="${esc(board.face.toUpperCase())}">${esc(board.name)}</span>
  `;
}

/** A unit's boards as one line of names, for the places that aren't a cell. */
function boardNameList(position) {
  return position.boards.map(board => board.name).join(" & ");
}

/*
 * The preview floats in fixed coordinates rather than sitting inside the row:
 * the grid scrolls sideways in a clipping box, so a popover in the row would
 * be cut off at the card's edge.
 */
let boardPreview = null;

function showBoardPreview(anchor, url) {
  if (!url) return;

  if (!boardPreview) {
    boardPreview = document.createElement("div");
    boardPreview.className = "board-preview";
    document.body.appendChild(boardPreview);
  }

  boardPreview.innerHTML = `<img src="${esc(url)}" alt="">`;

  const box = anchor.getBoundingClientRect();
  const width = 210;
  const height = 150;

  boardPreview.style.left = `${Math.min(Math.max(8, box.left), window.innerWidth - width - 8)}px`;
  boardPreview.style.top = box.top > height + 16
    ? `${box.top - height - 10}px`
    : `${box.bottom + 10}px`;
  boardPreview.style.display = "block";
}

function hideBoardPreview() {
  if (boardPreview) boardPreview.style.display = "none";
}

/**
 * Choosing this unit's boards, in a strip under its row — the same shape as
 * the signage editor, because it's the same job: open the cell, set it, done.
 *
 * A face gets its picture from the Resources library rather than an upload
 * here: the same board hangs again at the next show, so it's the store's, not
 * this event's. Its name comes from the library entry too — rename it once in
 * Resources and it's renamed on every shelf at every show.
 */
function boardsStrip(position) {
  const byFace = new Map(position.boards.map(board => [board.face, board]));

  return `
    <div class="signage-strip boards-strip">
      ${BOARD_FACES.map(face => {
        const board = byFace.get(face);

        return `
          <span class="board-slot">
            <span class="board-slot-face">${face.toUpperCase()}</span>
            ${board
              ? `<button class="board-slot-name" data-board-pick="${position.id}" data-face="${face}"
                         data-preview="${esc(board.image_url || "")}"
                         title="Choose a different one">${esc(board.name)}</button>
                <button class="board-slot-clear" data-board-clear="${position.id}" data-face="${face}"
                        title="Take it off this face">×</button>`
              : `<button class="cell-add" data-board-pick="${position.id}" data-face="${face}"
                         title="Choose the ${face} board">+</button>`}
          </span>
        `;
      }).join("")}

      <button class="btn-quiet" id="closeBoardsBtn"
              style="border:none; background:none; padding:6px 8px;">Save</button>
    </div>
  `;
}

function stageBox(position, stage, done) {
  if (!stageApplies(position, stage)) {
    return `<span class="stage-box na" title="No signage needed">–</span>`;
  }

  return `
    <button class="stage-box${done ? " on" : ""}"
            data-stage-position="${position.id}" data-stage="${stage}">${done ? "✓" : ""}</button>
  `;
}

function signageTag(code) {
  const tag = shelfData.signage[code];
  if (!tag) return "";
  return `<span class="sig-tag" style="background:${tag.bg}; color:${tag.fg};">${esc(tag.label)}</span>`;
}

function signageStrip(position) {
  return `
    <div class="signage-strip">
      ${shelfData.signageKeys.map(code => {
        const on = position.signage.includes(code);
        return `
          <button class="sig-toggle${on ? " on" : ""}" data-sig-toggle="${code}" data-position="${position.id}"
                  style="${on ? `background:${shelfData.signage[code].bg}; color:${shelfData.signage[code].fg};` : ""}">
            ${esc(shelfData.signage[code].label)}
          </button>
        `;
      }).join("")}
      <button class="btn-quiet" id="closeSignageBtn" style="border:none; background:none; padding:6px 8px;">Save</button>
    </div>
  `;
}

/**
 * The phone surface: one card per unit with its five boxes spelled out.
 * This is what someone standing at the booth actually needs — the grid's
 * columns only make sense when you can see all of them at once.
 */
function shelfList() {
  const { positions, stages } = shelfData;

  const shown = shelfFilter === "left"
    ? positions.filter(p => p.stages.some((done, stage) => !done && stageApplies(p, stage)))
    : positions;

  if (!shown.length) {
    return `<div class="card"><p class="empty-state">Everything is ticked. The booth is ready.</p></div>`;
  }

  const walls = [];
  for (const position of shown) {
    const last = walls[walls.length - 1];
    if (last && last.wall === position.wall) last.positions.push(position);
    else walls.push({ wall: position.wall, positions: [position] });
  }

  return walls.map(group => `
    <div class="shelf-list-wall">${esc(group.wall)}</div>
    ${group.positions.map(position => {
      const applicable = position.stages.filter((_, stage) => stageApplies(position, stage));
      const complete = applicable.every(Boolean);

      return `
        <div class="card shelf-list-card${complete ? " done" : ""}">
          <div class="shelf-list-head">
            <button class="shelf-list-code" data-open-shelf="${position.id}"
                    title="Open this unit tier by tier">${esc(position.code)}</button>
            <div style="flex:1; min-width:0;">
              <div class="shelf-list-groupings">
                ${position.groupings.length
                  ? position.groupings.map(g => groupingChip(g, position.layout)).join("")
                  : `<span class="meta">Nothing on this one yet</span>`}
              </div>
              <div class="meta">${esc(position.unit_type || "")}${
                position.boards.length ? ` · ${esc(boardNameList(position))}` : ""
              }</div>
            </div>
          </div>

          ${position.signage.length
            ? `<div class="badge-row" style="margin:8px 0 0;">${position.signage.map(signageTag).join("")}</div>`
            : ""}

          <div class="shelf-list-stages">
            ${position.stages.map((done, stage) => `
              <div class="shelf-list-stage">
                ${stageBox(position, stage, done)}
                <span>${esc(stages[stage])}</span>
              </div>
            `).join("")}
          </div>

          ${photosBlock(position)}
        </div>
      `;
    }).join("")}
  `).join("");
}

/* ---------- One unit, tier by tier (the phone screen) ---------- */

/**
 * The store floor's view of a single unit.
 *
 * The grid is the boss's working tool; this is what someone holds while they
 * are standing in front of the shelf, so it leads with where the prep is at
 * and then goes down the tiers in the order the eye does — T1 at the top.
 *
 * It's a state of the plan rather than its own page. The booth map earned a
 * URL because it is the thing you send someone ("look at where C5 is"); a
 * shelf's tiers are a drill-down you come back out of.
 */
function shelfDetail() {
  const position = shelfData.positions.find(p => p.id === shelfDetailFor);
  if (!position) {
    shelfDetailFor = null;
    return shelfList();
  }

  const { stages, canManage } = shelfData;
  const layout = position.layout || { tiers: [], families: [], offTier: [] };
  const guideTotal = layout.families.reduce((sum, f) => sum + (f.placed && f.guide ? f.guide : 0), 0);
  const notes = stageNotes(position);

  return `
    <div class="card shelf-detail-card">
      <div class="shelf-detail-band">
        <span class="pill pill-paper">${esc(position.wall)}</span>
        <div class="shelf-detail-code">${esc(position.code)}</div>
        <div class="shelf-detail-sub">
          ${esc(position.unit_type || "Unit")} ·
          ${position.tier_count} tier${position.tier_count === 1 ? "" : "s"}${
          guideTotal ? ` · fits ~${guideTotal} pcs` : ""}
        </div>
      </div>

      <div class="strip">WHERE THIS SHELF IS AT</div>
      <div class="shelf-detail-stages">
        ${position.stages.map((done, stage) => `
          <div class="shelf-detail-stage">
            ${stageBox(position, stage, done)}
            <div>
              <div class="shelf-detail-stage-name">${esc(stages[stage])}</div>
              ${notes[stage] ? `<div class="meta">${esc(notes[stage])}</div>` : ""}
            </div>
          </div>
        `).join("")}
      </div>

      ${position.signage.length
        ? ""
        : `<div class="note-card">This shelf needs no signage, so there is no
             Boards box to tick — it drops out of the count rather than sitting
             there unticked.</div>`}

      ${layout.offTier.length ? `
        <div class="note-card">
          ${layout.offTier.map(f => `
            <div><strong>${esc(f.name)}</strong> —
            ${f.placement === "side"
              ? "zip-tied to the side of this unit, not on a tier"
              : "goes up top, on the shelves rather than in them"}${
              f.pool ? ` · ${f.pool} in stock` : ""}</div>
          `).join("")}
        </div>
      ` : ""}

      <div class="strip">TIERS</div>
      ${layout.tiers.length
        ? layout.tiers.map(tier => tierRow(position, tier, canManage)).join("")
        : `<p class="empty-state">This unit has no tiers — it isn't a shelf.</p>`}
    </div>
  `;
}

/**
 * A note per stage, so a tick means something specific rather than being the
 * fifth identical checkbox down the card.
 */
function stageNotes(position) {
  const families = position.layout?.families.filter(f => f.placed) || [];
  const guideTotal = families.reduce((sum, f) => sum + (f.guide || 0), 0);

  return [
    position.tier_count ? `built as ${position.tier_count} tiers` : "",
    families.length
      ? `${families.map(f => f.name).join(", ")}${guideTotal ? ` — fits ~${guideTotal} pcs` : ""}`
      : "nothing placed on it yet",
    "",
    "scan at the shelf",
    position.signage.length
      ? position.boards.length
        ? position.boards.map(b => b.name).join(" & ")
        : "no artwork picked yet"
      : ""
  ];
}

/**
 * One tier: who stands on it, and the controls once opened.
 *
 * Tapping the row opens it rather than navigating, so the tiers above and
 * below stay on screen — the question being answered is usually "which tier
 * does this go on", which needs the neighbours visible.
 */
function tierRow(position, tier, canManage) {
  const open = openTierFor === tier.tier;
  const onShelf = position.groupings.filter(g =>
    (g.placement || "tier") === "tier" && !tier.families.some(f => f.id === g.id));

  return `
    <div class="tier-row${open ? " open" : ""}">
      <button class="tier-row-head" data-open-tier="${tier.tier}">
        <span class="tier-row-name">T${tier.tier}</span>
        <span class="tier-row-families">
          ${tier.families.length
            ? esc(tier.families.map(f => f.name).join(" + "))
            : `<span class="meta">—</span>`}
        </span>
        <span class="tier-row-count">
          <em>${Math.round(tier.heightIn)}″</em>
        </span>
      </button>

      ${open ? `
        <div class="tier-open">
          ${tier.families.length
            ? tier.families.map(f => `
                <span class="grouping-chip on">
                  ${canManage
                    ? `<button class="chip-name" data-move-grouping="${f.id}"
                               title="Move it to another tier">${esc(f.name)}</button>`
                    : esc(f.name)}
                  ${canManage ? `
                    <button class="chip-clear" data-off-tier="${f.id}" data-tier="${tier.tier}"
                            title="Take it off this tier">×</button>
                  ` : ""}
                </span>
              `).join("")
            : `<span class="meta">Nothing on this tier.</span>`}

          ${canManage && movingGrouping ? `
            <div class="tier-move">
              <span class="board-slot-face">MOVE TO</span>
              ${position.layout.tiers
                .filter(t => t.tier !== tier.tier)
                .map(t => `
                  <button class="tier-toggle" data-move-to="${t.tier}">T${t.tier}</button>
                `).join("")}
              <button class="btn-quiet" data-move-cancel="1">Cancel</button>
            </div>
          ` : ""}

          ${canManage && !movingGrouping ? `
            <div class="tier-actions">
              ${onShelf.length ? `
                <select data-add-to-tier="${tier.tier}">
                  <option value="">+ Group…</option>
                  ${onShelf.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join("")}
                </select>
              ` : ""}
              ${tier.families.length ? `
                <button class="btn-quiet" data-clear-tier="${tier.tier}">Clear tier</button>
              ` : ""}
            </div>
          ` : ""}
        </div>
      ` : ""}
    </div>
  `;
}

/* ---------- The booth map ---------- */

function boothMap() {
  const { positions, booth, conflicts } = shelfData;
  const selected = positions.find(p => p.id === shelfSelected);
  const selectedPerson = (shelfData.people || []).find(p => p.id === personSelected);

  measureScale();

  return `
    <div class="booth-layout">
      <div class="booth-map-column">
        <div class="button-row" style="margin:0 0 10px;">
          <button class="${signsMode ? "" : "btn-quiet"}" id="signsModeBtn">Signs</button>
          ${shelfData.canManage && !onPhone() ? `
            <button class="${arrangeMode ? "" : "btn-quiet"}" id="arrangeModeBtn">Arrange</button>
            ${arrangeMode ? `<button class="btn-danger" id="resetArrangeBtn">Reset all</button>` : ""}
          ` : ""}
        </div>
        ${arrangeMode ? `
          <p class="meta" style="margin:-4px 0 10px;">
            Drag a unit, or select one and nudge it with the arrow keys —
            1″ a press, 6″ with Shift.
          </p>
          <div class="inline-form" style="margin:0 0 8px;">
            <span class="board-slot-face">UNIT</span>
            <input type="text" id="mapNewCode" placeholder="S2" maxlength="12" style="width:90px;">
            <select id="mapNewWall">
              ${shelfData.walls.map(wall => `<option value="${esc(wall)}">${esc(wall)}</option>`).join("")}
            </select>
            <button class="btn-quiet add-shelf" id="mapAddBtn">+ Add a unit</button>
          </div>
          <div class="inline-form" style="margin:0 0 10px;">
            <span class="board-slot-face">PERSON</span>
            <input type="text" id="mapPersonName" placeholder="Entrance" maxlength="24" style="width:110px;">
            <button class="btn-quiet add-shelf" id="mapAddPersonBtn">+ Add a person</button>
          </div>
        ` : ""}

        <div class="booth-ruler">← ${booth.width} FT →</div>
        <div class="booth-scroll">
        <div class="booth-frame" id="boothFrame"
             style="width:${booth.width * pxPerFoot + 6}px; height:${booth.depth * pxPerFoot + 6}px;">
          <div class="booth-guide v" style="left:${(booth.width / 2) * pxPerFoot}px;"></div>
          <div class="booth-guide h" style="top:${(booth.depth / 3) * pxPerFoot}px;"></div>
          <div class="booth-guide h" style="top:${(booth.depth * 2 / 3) * pxPerFoot}px;"></div>
          ${positions.map(boothBlock).join("")}
          ${(shelfData.people || []).map(personDot).join("")}
          ${arrangeMode && selected ? gapRulers(selected.geometry, selected.id) : ""}
        </div>
        </div>
      </div>

      <div class="booth-panel">
        ${selectedPerson ? personCard(selectedPerson) : ""}
        ${selected ? selectedPositionCard(selected) : ""}
        ${conflicts.length ? conflictsCard(conflicts) : ""}
        ${signsMode ? signsList() : ""}
      </div>
    </div>
  `;
}

/**
 * A person on the floor. The five standing spots — entrance, stager, cashier,
 * aisle coverage — are part of the plan the same way the shelves are, so
 * they're placed on the same map.
 */
function personDot(person) {
  const size = (shelfData.personFeet || 1.5) * pxPerFoot;
  const initials = person.label
    .split(/\s+/)
    .map(word => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return `
    <div class="booth-person${person.id === personSelected ? " selected" : ""}${arrangeMode ? " draggable" : ""}"
         data-person="${person.id}" title="${esc(person.label)}"
         style="left:${person.x * pxPerFoot}px; top:${person.y * pxPerFoot}px;
                width:${size}px; height:${size}px;">
      ${esc(initials)}
    </div>
  `;
}

/**
 * Gap rulers: from each side of the unit being arranged, a dashed line to the
 * first thing that side would hit — another unit, or the booth edge — with
 * the gap in inches on it. The aisles are the checkout flow, so the number a
 * move is changing is the whole point of the move.
 */
function gapRulers(geometry, excludeId) {
  const booth = shelfData.booth;
  const g = geometry;
  const others = shelfData.positions
    .filter(p => p.id !== excludeId)
    .map(p => p.geometry);

  const inches = (feet) => `${Math.round(feet * 12)}″`;
  const out = [];

  // For each direction: every unit whose band overlaps ours, keyed by the
  // edge facing us and the middle of the shared band, where the line looks
  // anchored to both. Nearest wins; no unit means the booth edge.
  const nearest = (hits, start) => {
    let best = null;
    for (const hit of hits) {
      if (hit.near < start - 1 / 24) continue;
      if (!best || hit.near < best.near) best = hit;
    }
    return best;
  };

  const bandMid = (o, lo, hi, loKey, sizeKey) =>
    (Math.max(lo, o[loKey]) + Math.min(hi, o[loKey] + o[sizeKey])) / 2;

  const vBand = others.filter(o => Math.min(g.y + g.h, o.y + o.h) - Math.max(g.y, o.y) > 0);
  const hBand = others.filter(o => Math.min(g.x + g.w, o.x + o.w) - Math.max(g.x, o.x) > 0);

  // A gap that rounds to no inches at all is a unit sitting flush against
  // its neighbour — visible on its own, so no ruler. This also swallows the
  // hair-negative distances float rounding gives two touching edges.
  const worthDrawing = (dist) => Math.round(dist * 12) >= 1;

  // Right
  let start = g.x + g.w;
  let best = nearest(vBand.map(o => ({ near: o.x, mid: bandMid(o, g.y, g.y + g.h, "y", "h") })), start);
  let dist = best ? best.near - start : booth.width - start;
  if (worthDrawing(dist)) out.push(hRuler(start, best ? best.mid : g.y + g.h / 2, dist, inches(dist)));

  // Left
  best = nearest(vBand.map(o => ({ near: g.x - (o.x + o.w), mid: bandMid(o, g.y, g.y + g.h, "y", "h") })), 0);
  dist = best ? best.near : g.x;
  if (worthDrawing(dist)) out.push(hRuler(g.x - dist, best ? best.mid : g.y + g.h / 2, dist, inches(dist)));

  // Down
  start = g.y + g.h;
  best = nearest(hBand.map(o => ({ near: o.y, mid: bandMid(o, g.x, g.x + g.w, "x", "w") })), start);
  dist = best ? best.near - start : booth.depth - start;
  if (worthDrawing(dist)) out.push(vRuler(best ? best.mid : g.x + g.w / 2, start, dist, inches(dist)));

  // Up
  best = nearest(hBand.map(o => ({ near: g.y - (o.y + o.h), mid: bandMid(o, g.x, g.x + g.w, "x", "w") })), 0);
  dist = best ? best.near : g.y;
  if (worthDrawing(dist)) out.push(vRuler(best ? best.mid : g.x + g.w / 2, g.y - dist, dist, inches(dist)));

  return out.join("");
}

function hRuler(xFeet, yFeet, wFeet, text) {
  return `<div class="gap-ruler h" style="left:${xFeet * pxPerFoot}px; top:${yFeet * pxPerFoot}px;
               width:${Math.max(wFeet * pxPerFoot, 0)}px;"><span>${text}</span></div>`;
}

function vRuler(xFeet, yFeet, hFeet, text) {
  return `<div class="gap-ruler v" style="left:${xFeet * pxPerFoot}px; top:${yFeet * pxPerFoot}px;
               height:${Math.max(hFeet * pxPerFoot, 0)}px;"><span>${text}</span></div>`;
}

/** Redraws the rulers alone, so a drag can update them without a full draw. */
function renderGapRulers(geometry, excludeId) {
  const frame = document.getElementById("boothFrame");
  if (!frame) return;

  frame.querySelectorAll(".gap-ruler").forEach(el => el.remove());
  if (geometry) frame.insertAdjacentHTML("beforeend", gapRulers(geometry, excludeId));
}

function personCard(person) {
  return `
    <div class="card stripped">
      <div class="strip brand">ON THE FLOOR</div>
      <div class="card-body">
        <div class="panel-code">${esc(person.label)}</div>
        <div class="meta">
          ${Math.round(person.x * 12)}″ from the left · ${Math.round(person.y * 12)}″ down
        </div>
        ${arrangeMode ? `
          <div class="inline-form" style="margin-top:10px;">
            <input type="text" id="personLabelInput" value="${esc(person.label)}" maxlength="24" style="width:140px;">
            <button class="btn-quiet" id="personRenameBtn">Rename</button>
            <button class="btn-danger" id="personRemoveBtn">Remove</button>
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

function boothBlock(position) {
  const { geometry } = position;
  const conflicted = shelfData.conflicts.some(c => c.codes.includes(position.code));
  const applicable = position.stages.filter((_, stage) => stageApplies(position, stage));
  const doneCount = position.stages.filter((done, stage) => done && stageApplies(position, stage)).length;

  const state = doneCount === applicable.length ? "done" : doneCount === 0 ? "fresh" : "part";
  const wide = geometry.w > geometry.h;

  return `
    <div class="booth-block ${state} ${position.kind}${conflicted ? " conflict" : ""}${position.id === shelfSelected ? " selected" : ""}${arrangeMode ? " draggable" : ""}"
         data-block="${position.id}"
         style="left:${geometry.x * pxPerFoot}px; top:${geometry.y * pxPerFoot}px;
                width:${geometry.w * pxPerFoot}px; height:${geometry.h * pxPerFoot}px;">
      ${signSpines(position)}
      <div class="block-head${wide ? " wide" : ""}">
        <span class="block-id">${esc(position.code)}</span>
        ${signsMode ? "" : `
          <span class="block-dots">
            ${position.stages.map((done, stage) => `
              <span class="${!stageApplies(position, stage) ? "na" : done ? "on" : ""}"></span>
            `).join("")}
          </span>
        `}
      </div>
      <div class="block-label">
        ${signsMode
          ? (position.boards.length ? esc(boardNameList(position)) : `<span style="color:var(--muted);">—</span>`)
          : esc(position.groupings.map(g => g.name).join(" + "))}
      </div>
    </div>
  `;
}

/**
 * A bar on the face a board stands on. Back goes on the long face nearer the
 * booth edge, side on the nearer short end, front on the opposite long face.
 */
function signSpines(position) {
  const faces = position.boards;
  if (!faces.length) return "";

  const { geometry } = position;
  const booth = shelfData.booth;
  const vertical = geometry.h >= geometry.w;

  // Which side of the unit is nearer the outside of the booth.
  const nearLeft = geometry.x < booth.width - (geometry.x + geometry.w);
  const nearTop = geometry.y < booth.depth - (geometry.y + geometry.h);

  const clearsOnly = position.signage.length > 0 &&
    position.signage.every(code => code === "fc" || code === "sc");
  const colour = clearsOnly ? "var(--cool)" : "var(--warm)";

  const edges = {
    back: vertical ? (nearLeft ? "left" : "right") : (nearTop ? "top" : "bottom"),
    side: vertical ? (nearTop ? "top" : "bottom") : (nearLeft ? "left" : "right"),
    front: vertical ? (nearLeft ? "right" : "left") : (nearTop ? "bottom" : "top")
  };

  return faces
    .filter(face => edges[face.face])
    .map(face => `<span class="spine ${edges[face.face]}" style="background:${colour};"></span>`)
    .join("");
}

function selectedPositionCard(position) {
  const { geometry } = position;
  const inches = (feet) => Math.round(feet * 12);

  return `
    <div class="card stripped">
      <div class="strip brand">
        ${esc(position.wall)}
        <span class="strip-side">${inches(geometry.w)}″ × ${inches(geometry.h)}″ · ${esc(position.unit_type)}</span>
      </div>
      <div class="card-body">
        <div class="panel-head">
          <div style="min-width:0;">
            <div class="panel-code">${esc(position.code)}</div>
            <div class="shelf-list-groupings">
              ${position.groupings.length
                ? position.groupings.map(g => groupingChip(g, position.layout)).join("")
                : `<span class="meta">Nothing on this one yet</span>`}
            </div>
          </div>
          ${position.signage.length
            ? `<div class="badge-row" style="margin:0; justify-content:flex-end;">
                ${position.signage.map(signageTag).join("")}
              </div>`
            : `<span class="meta">No signage</span>`}
        </div>

        <div class="panel-stages">
          ${position.stages.map((done, stage) => `
            <div class="panel-stage">
              ${stageBox(position, stage, done)}
              <span class="meta">${esc(shelfData.stages[stage])}</span>
            </div>
          `).join("")}
        </div>

        ${boardsBlock(position)}
        ${photosBlock(position)}

        ${arrangeMode ? `
          <div class="meta" style="margin-top:10px;">NAME</div>
          <div class="inline-form" style="margin:2px 0 10px;">
            <input type="text" id="arrangeCodeInput" value="${esc(position.code)}" maxlength="12" style="width:90px;">
            <button class="btn-quiet" id="arrangeRenameBtn">Rename</button>
          </div>
          <div class="nudge-grid">
            <div>
              <div class="meta">FROM LEFT</div>
              <div class="inline-form" style="margin:2px 0 0;">
                <button class="btn-quiet" data-nudge="x" data-by="-0.5">−6″</button>
                <span style="font-family:'Fredoka',sans-serif; font-weight:600;">${inches(geometry.x)}″</span>
                <button class="btn-quiet" data-nudge="x" data-by="0.5">+6″</button>
              </div>
            </div>
            <div>
              <div class="meta">FROM TOP</div>
              <div class="inline-form" style="margin:2px 0 0;">
                <button class="btn-quiet" data-nudge="y" data-by="-0.5">−6″</button>
                <span style="font-family:'Fredoka',sans-serif; font-weight:600;">${inches(geometry.y)}″</span>
                <button class="btn-quiet" data-nudge="y" data-by="0.5">+6″</button>
              </div>
            </div>
          </div>
          <div class="button-row">
            <button class="btn-quiet" id="turnBlockBtn">Turn 90°</button>
            ${position.moved ? `<button class="btn-quiet" id="resetBlockBtn">Reset this one</button>` : ""}
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

/* ---------- Boards and photos on a unit ---------- */

const BOARD_FACES = ["back", "side", "front"];

/**
 * The boards on this unit, and the artwork that goes on each face.
 *
 * Read-only: the map is for reading the booth, and choosing artwork happens
 * in the grid's Boards column, where you can run down all 31 units in one
 * pass rather than selecting them one at a time.
 */
function boardsBlock(position) {
  if (!position.boards.length) {
    return `<p class="meta" style="margin:8px 0 0;">No boards on this one.</p>`;
  }

  return `
    <div class="board-strip">
      ${position.boards.map(board => `
        <div class="board-item">
          <div class="board-item-head">
            <span class="pill" style="font-size:10px;">${esc(board.face.toUpperCase())}</span>
            <span style="font-size:13px;">${esc(board.name)}</span>
          </div>

          ${board.image_url
            ? `<button class="board-art" data-board-view="${position.id}:${esc(board.face)}"
                       title="See ${esc(board.name)} full size">
                <img src="${esc(board.image_url)}" alt="${esc(board.name)}" loading="lazy" decoding="async">
              </button>`
            : `<div class="board-art empty">
                <span class="meta">No artwork yet</span>
              </div>`}
        </div>
      `).join("")}
    </div>
  `;
}

/** A board at a size you can actually read the print on. */
function boardLightbox() {
  const position = shelfData.positions.find(p => p.id === viewingBoard.positionId);
  const board = position?.boards.find(b => b.face === viewingBoard.face);

  if (!board?.image_url) return "";

  return `
    <div class="lightbox" id="boardLightbox">
      <div class="lightbox-controls">
        <button class="lightbox-close" id="closeBoardLightboxBtn" aria-label="Close"
                title="${esc(position.code)} · ${esc(board.face.toUpperCase())} · ${esc(board.name)}">×</button>
      </div>
      <img src="${esc(board.image_url)}" alt="${esc(board.name)}">
    </div>
  `;
}

/**
 * How this shelf was merchandised, photographed at the store before it was
 * packed — the thing you rebuild from once the boxes are at the venue.
 *
 * Anyone who can see the plan can add one: merchandising and packing is the
 * floor's job, and a photo that had to wait for the boss wouldn't get taken.
 */
function photosBlock(position) {
  return `
    <div class="shelf-photos">
      <div class="shelf-photos-head">
        <span class="kicker">HOW IT WAS PACKED</span>
        <label class="btn-quiet shelf-photo-add" for="shelfPhotoInput"
               style="font-size:11.5px; padding:5px 9px; --depress: 0px;"
               data-photo-for="${position.id}">
          ${position.photos.length ? "Add another" : "Add a photo"}
        </label>
      </div>

      ${position.photos.length
        ? `<div class="shelf-photo-strip">
            ${position.photos.map(photo => `
              <button class="shelf-photo" data-photo-view="${photo.id}"
                      title="${esc(photo.taken_by_name || "")}">
                <img src="${esc(photo.image_url)}" alt="" loading="lazy" decoding="async">
              </button>
            `).join("")}
          </div>`
        : `<p class="meta" style="margin:4px 0 0;">
            No photo of this one yet. Shoot it while it's merchandised and it's
            what you rebuild from at the venue.
          </p>`}
    </div>
  `;
}

/**
 * Picking which library image is the board on a face. The library is the
 * store's, uploaded on the Resources screen — this only chooses from it, so
 * the same artwork can be on a shelf at two different shows.
 */
function artworkPicker() {
  const { resources } = shelfData;
  const position = shelfData.positions.find(p => p.id === pickingArtFor.positionId);

  return `
    <div class="lightbox" id="artworkPicker">
      <div class="lightbox-bar">
        <span>${esc(position?.code || "")} · ${esc(pickingArtFor.face.toUpperCase())} board</span>
        <button class="btn-quiet" id="closePickerBtn">Close</button>
      </div>

      <div class="picker-body">
        ${resources.length
          ? `<div class="resource-grid">
              ${resources.map(resource => `
                <button class="card resource-tile pickable" data-pick-resource="${resource.id}">
                  <div class="resource-art">
                    <img src="${esc(resource.image_url)}" alt="${esc(resource.name)}"
                         loading="lazy" decoding="async">
                  </div>
                  <div class="resource-name">${esc(resource.name)}</div>
                </button>
              `).join("")}
            </div>`
          : `<div class="card">
              <p class="empty-state">
                Nothing in the library yet. Upload board artwork under
                Events → Resources and it'll be here for every show.
              </p>
            </div>`}
      </div>
    </div>
  `;
}

/** A photo big enough to actually read a shelf off. */
function photoLightbox() {
  const photo = shelfData.positions
    .flatMap(p => p.photos.map(ph => ({ ...ph, position: p })))
    .find(ph => ph.id === viewingPhoto);

  if (!photo) return "";

  return `
    <div class="lightbox" id="photoLightbox">
      <div class="lightbox-controls">
        ${shelfData.canManage
          ? `<button class="btn-danger" data-photo-delete="${photo.id}">Delete</button>`
          : ""}
        <button class="lightbox-close" id="closeLightboxBtn" aria-label="Close"
                title="${esc(photo.position.code)}${photo.taken_by_name ? ` · ${esc(photo.taken_by_name)}` : ""}">×</button>
      </div>
      <img src="${esc(photo.image_url)}" alt="">
    </div>
  `;
}

function conflictsCard(conflicts) {
  return `
    <div class="card" style="border-color:var(--alert);">
      <h3 style="color:var(--alert);">${conflicts.length} problem${conflicts.length === 1 ? "" : "s"} with the layout</h3>
      ${conflicts.map(c => `<div style="font-size:13px; padding:3px 0;">${esc(c.message)}</div>`).join("")}
    </div>
  `;
}

function signsList() {
  const withBoards = shelfData.positions.filter(p => p.boards.length);

  return `
    <div class="card stripped">
      <div class="strip">SIGNS TO INSTALL<span class="strip-side">${withBoards.length}</span></div>
      <div class="card-body">
        ${withBoards.map(position => `
          <div class="sign-row" data-block="${position.id}">
            <span style="font-family:'Fredoka',sans-serif; font-weight:600; width:44px;">${esc(position.code)}</span>
            ${position.boards[0]?.image_url
              ? `<span class="sign-thumb"><img src="${esc(position.boards[0].image_url)}" alt="" loading="lazy" decoding="async"></span>`
              : ""}
            <span style="flex:1; font-size:13px;">
              ${esc(boardNameList(position))}
              <div class="meta">${position.boards.map(b => b.face.toUpperCase()).join(" + ")}</div>
            </span>
            ${position.stages[4]
              ? `<span style="color:var(--go-text); font-weight:600; font-size:12px;">✓ up</span>`
              : ""}
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

/* ---------- Wiring ---------- */

function wireShelfPlan() {
  const slug = shelfData.convention.slug;
  const reload = () => renderShelfPlan(slug, false);

  // Back comes out of a unit before it leaves the plan, so the drill-down
  // behaves like the drill-down it is.
  document.getElementById("shelfBackBtn").onclick = () => {
    if (shelfDetailFor) {
      shelfDetailFor = null;
      openTierFor = null;
      movingGrouping = null;
      drawShelfPlan();
      return;
    }
    openConvention(slug);
  };

  document.querySelectorAll("[data-open-shelf]").forEach(button => {
    button.onclick = () => {
      shelfDetailFor = Number(button.dataset.openShelf);
      openTierFor = null;
      movingGrouping = null;
      drawShelfPlan();
    };
  });

  document.querySelectorAll("[data-open-tier]").forEach(button => {
    button.onclick = () => {
      const tier = Number(button.dataset.openTier);
      openTierFor = openTierFor === tier ? null : tier;
      movingGrouping = null;
      drawShelfPlan();
    };
  });

  // Picking a family to move only arms the move; the tier it lands on is the
  // next tap, and until then nothing has been written.
  document.querySelectorAll("[data-move-grouping]").forEach(button => {
    button.onclick = () => {
      movingGrouping = Number(button.dataset.moveGrouping);
      drawShelfPlan();
    };
  });

  document.querySelector("[data-move-cancel]")?.addEventListener("click", () => {
    movingGrouping = null;
    drawShelfPlan();
  });

  document.querySelectorAll("[data-move-to]").forEach(button => {
    button.onclick = async () => {
      const to = Number(button.dataset.moveTo);
      const result = await apiSend(`/api/shelf-positions/${shelfDetailFor}/tier`, "PUT", {
        grouping_id: movingGrouping,
        from: openTierFor,
        to
      });

      if (!result.ok) {
        showFormError("shelfError", result.error || "Could not move that.");
        return;
      }

      // Follow it: the tier it landed on is the one you want to look at.
      movingGrouping = null;
      openTierFor = to;
      await reload();
    };
  });

  document.querySelectorAll("[data-off-tier]").forEach(button => {
    button.onclick = async () => {
      const result = await apiSend(`/api/shelf-positions/${shelfDetailFor}/tier`, "PUT", {
        grouping_id: Number(button.dataset.offTier),
        tier_index: Number(button.dataset.tier),
        on: false
      });

      if (!result.ok) {
        showFormError("shelfError", result.error || "Could not save that.");
        return;
      }

      await reload();
    };
  });

  document.querySelectorAll("[data-add-to-tier]").forEach(select => {
    select.onchange = async () => {
      if (!select.value) return;

      const result = await apiSend(`/api/shelf-positions/${shelfDetailFor}/tier`, "PUT", {
        grouping_id: Number(select.value),
        tier_index: Number(select.dataset.addToTier),
        on: true
      });

      if (!result.ok) {
        showFormError("shelfError", result.error || "Could not save that.");
        return;
      }

      await reload();
    };
  });

  document.querySelectorAll("[data-clear-tier]").forEach(button => {
    button.onclick = async () => {
      const result = await apiSend(`/api/shelf-positions/${shelfDetailFor}/tier`, "PUT", {
        clear_tier: Number(button.dataset.clearTier)
      });

      if (!result.ok) {
        showFormError("shelfError", result.error || "Could not save that.");
        return;
      }

      await reload();
    };
  });

  document.querySelectorAll("[data-shelf-view]").forEach(btn => {
    btn.onclick = () => {
      const value = btn.dataset.shelfView;
      shelfView = value === "map" ? "map" : "grid";
      if (value === "grid-all") shelfFilter = "all";
      if (value === "grid-left") shelfFilter = "left";

      // Crossing between the plan and the map changes the page, so the URL
      // follows and Back takes you where you came from.
      pushPageState(shelfPlanPage(), { slug });
      drawShelfPlan();
    };
  });

  // Stage ticks update on screen first: several people are ticking at once
  // and waiting for a round trip each time makes the tool feel broken.
  document.querySelectorAll("[data-stage-position]").forEach(box => {
    box.onclick = async () => {
      const id = Number(box.dataset.stagePosition);
      const stage = Number(box.dataset.stage);
      const position = shelfData.positions.find(p => p.id === id);
      const next = !position.stages[stage];

      position.stages[stage] = next;
      shelfData.totals = recomputeTotals();
      drawShelfPlan();

      const result = await apiSend(`/api/shelf-positions/${id}/stage`, "POST", { stage, done: next });
      if (!result.ok) {
        showFormError("shelfError", result.error || "Could not save that tick.");
        await reload();
      }
    };
  });

  document.querySelectorAll("[data-field]").forEach(input => {
    input.onchange = async () => {
      const id = Number(input.dataset.position);
      const result = await apiSend(`/api/shelf-positions/${id}`, "PATCH", {
        [input.dataset.field]: input.value
      });

      if (!result.ok) {
        showFormError("shelfError", result.error || "Could not save that.");
        return;
      }

      await reload();
    };
  });

  // One strip open at a time: two of them under one row would push the grid
  // around while you were reading it.
  document.querySelectorAll("[data-signage]").forEach(cell => {
    cell.onclick = () => {
      const id = Number(cell.dataset.signage);
      openSignageFor = openSignageFor === id ? null : id;
      openBoardsFor = null;
      drawShelfPlan();
    };
  });

  document.getElementById("closeSignageBtn")?.addEventListener("click", () => {
    openSignageFor = null;
    drawShelfPlan();
  });

  document.querySelectorAll("[data-boards]").forEach(cell => {
    cell.onclick = () => {
      const id = Number(cell.dataset.boards);
      openBoardsFor = openBoardsFor === id ? null : id;
      openSignageFor = null;
      openShelfFor = null;
      drawShelfPlan();
    };
  });

  document.getElementById("closeBoardsBtn")?.addEventListener("click", () => {
    openBoardsFor = null;
    drawShelfPlan();
  });

  document.querySelectorAll("[data-shelf]").forEach(cell => {
    cell.onclick = () => {
      const id = Number(cell.dataset.shelf);
      openShelfFor = openShelfFor === id ? null : id;
      openSignageFor = null;
      openBoardsFor = null;
      openGroupingsFor = null;
      drawShelfPlan();
    };
  });

  document.querySelectorAll("[data-groupings]").forEach(cell => {
    cell.onclick = () => {
      const id = Number(cell.dataset.groupings);
      openGroupingsFor = openGroupingsFor === id ? null : id;
      openSignageFor = null;
      openBoardsFor = null;
      openShelfFor = null;
      drawShelfPlan();
    };
  });

  document.getElementById("closeGroupingsBtn")?.addEventListener("click", () => {
    openGroupingsFor = null;
    newGroupingFor = null;
    drawShelfPlan();
  });

  document.querySelectorAll("[data-grouping-add]").forEach(select => {
    select.onchange = async () => {
      if (!select.value) return;

      if (select.value === "__new") {
        newGroupingFor = Number(select.dataset.groupingAdd);
        drawShelfPlan();
        return;
      }

      const result = await apiSend(`/api/shelf-positions/${select.dataset.groupingAdd}/grouping`, "PUT", {
        grouping_id: Number(select.value)
      });

      if (!result.ok) {
        showFormError("shelfError", result.error || "Could not put that on the shelf.");
        return;
      }

      await reload();
    };
  });

  // A brand-new family goes straight onto the shelf it was typed on — that's
  // why you were adding it.
  document.getElementById("createGroupingBtn")?.addEventListener("click", async () => {
    const positionId = newGroupingFor;
    const name = document.getElementById("newGroupingName")?.value.trim();
    const guide = Number(document.getElementById("newGroupingGuide")?.value) || null;
    if (!name) return;

    const created = await apiSend("/api/groupings", "POST", { name, guide_pieces: guide });

    if (!created.ok) {
      showFormError("shelfError", created.error || "Could not add that family.");
      return;
    }

    if (created.id) {
      const assigned = await apiSend(`/api/shelf-positions/${positionId}/grouping`, "PUT", {
        grouping_id: created.id
      });

      if (!assigned.ok) {
        showFormError("shelfError", assigned.error || "Added the family, but could not put it on the shelf.");
      }
    }

    newGroupingFor = null;
    await reload();
  });

  // The guide belongs to the family, so typing it on one shelf sets it
  // everywhere — same as a rename.
  document.querySelectorAll("[data-guide]").forEach(input => {
    input.onchange = async () => {
      const result = await apiSend(`/api/groupings/${input.dataset.guide}`, "PATCH", {
        guide_pieces: Number(input.value) || null
      });

      if (!result.ok) {
        showFormError("shelfError", result.error || "Could not save that guide.");
        return;
      }

      await reload();
    };
  });

  document.querySelectorAll("[data-grouping-rename]").forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const name = prompt("Rename this family — it changes everywhere it appears:", btn.dataset.name);
      if (!name || !name.trim() || name.trim() === btn.dataset.name) return;

      const result = await apiSend(`/api/groupings/${btn.dataset.groupingRename}`, "PATCH", {
        name: name.trim()
      });

      if (!result.ok) {
        showFormError("shelfError", result.error || "Could not rename that.");
        return;
      }

      await reload();
    };
  });

  document.querySelectorAll("[data-grouping-remove]").forEach(btn => {
    btn.onclick = async () => {
      const result = await apiSend(`/api/shelf-positions/${btn.dataset.groupingRemove}/grouping`, "PUT", {
        grouping_id: Number(btn.dataset.grouping),
        remove: true
      });

      if (!result.ok) {
        showFormError("shelfError", result.error || "Could not take that off.");
        return;
      }

      await reload();
    };
  });

  // Facings save on change rather than on Save: the number is the thing you
  // came here to set, and it shows on the chip the moment it lands.
  document.querySelectorAll("[data-facings]").forEach(input => {
    input.onchange = async () => {
      const result = await apiSend(`/api/shelf-positions/${input.dataset.facings}/grouping`, "PUT", {
        grouping_id: Number(input.dataset.grouping),
        facings: Number(input.value)
      });

      if (!result.ok) {
        showFormError("shelfError", result.error || "Could not save that.");
        return;
      }

      await reload();
    };
  });

  // Putting a family on a tier is a stage tick by another name — small, and
  // several people do it at once — so it's written optimistically and only
  // reloaded if the write is refused.
  document.querySelectorAll("[data-tier-toggle]").forEach(button => {
    button.onclick = async () => {
      const on = button.classList.contains("on");
      button.classList.toggle("on", !on);

      const result = await apiSend(`/api/shelf-positions/${button.dataset.tierToggle}/tier`, "PUT", {
        grouping_id: Number(button.dataset.grouping),
        tier_index: Number(button.dataset.tier),
        on: !on
      });

      if (!result.ok) {
        showFormError("shelfError", result.error || "Could not save that.");
      }

      // The counts on every other tier move with this one, so redraw either
      // way — the optimistic flip is only there to keep the click instant.
      await reload();
    };
  });

  // How the unit is built. Dropping tiers takes whatever stood on them, which
  // is why this reloads rather than patching the row in place.
  document.querySelectorAll("[data-tier-count]").forEach(input => {
    input.onchange = async () => {
      const result = await apiSend(`/api/shelf-positions/${input.dataset.tierCount}/tiers`, "PUT", {
        tier_count: Number(input.value)
      });

      if (!result.ok) {
        showFormError("shelfError", result.error || "Could not save that.");
        return;
      }

      await reload();
    };
  });

  // Save is what moves or renames the shelf. Filling the boxes in does
  // nothing on its own; walking away from the strip leaves the shelf exactly
  // as it was.
  document.getElementById("closeShelfBtn")?.addEventListener("click", async () => {
    const select = document.querySelector("[data-wall]");
    const codeInput = document.querySelector("[data-shelf-code]");
    const kindBox = document.querySelector("[data-shelf-kind]");
    const position = shelfData.positions.find(p => p.id === openShelfFor);

    const patch = {};
    if (position && select && select.value !== position.wall) patch.wall = select.value;
    const code = codeInput?.value.trim();
    if (position && code && code !== position.code) patch.code = code;
    const kind = kindBox?.checked ? "other" : "shelf";
    if (position && kindBox && kind !== position.kind) patch.kind = kind;

    if (!position || !Object.keys(patch).length) {
      openShelfFor = null;
      drawShelfPlan();
      return;
    }

    const result = await apiSend(`/api/shelf-positions/${position.id}`, "PATCH", patch);

    if (!result.ok) {
      showFormError("shelfError", result.error || "Could not save that shelf.");
      return;
    }

    openShelfFor = null;
    await reload();
  });

  document.querySelectorAll("[data-delete-shelf]").forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.deleteShelf);
      const position = shelfData.positions.find(p => p.id === id);

      if (!confirm(`Remove ${position?.code} from the booth? Its ticks, boards, photos and shelf layout go with it.`)) {
        return;
      }

      const result = await apiSend(`/api/shelf-positions/${id}`, "DELETE");

      if (!result.ok) {
        showFormError("shelfError", result.error || "Could not remove that shelf.");
        return;
      }

      openShelfFor = null;
      await reload();
    };
  });

  document.querySelectorAll("[data-sig-toggle]").forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.position);
      const code = btn.dataset.sigToggle;
      const position = shelfData.positions.find(p => p.id === id);
      const next = position.signage.includes(code)
        ? position.signage.filter(c => c !== code)
        : [...position.signage, code];

      const result = await apiSend(`/api/shelf-positions/${id}`, "PATCH", { signage: next });
      if (!result.ok) {
        showFormError("shelfError", result.error || "Could not save that.");
        return;
      }

      await reload();
    };
  });

  const addBtn = document.getElementById("addPositionBtn");
  if (addBtn) {
    addBtn.onclick = async () => {
      const code = document.getElementById("newPositionCode").value;
      const wall = document.getElementById("newPositionWall").value;
      const result = await apiSend(`/api/conventions/${encodeURIComponent(slug)}/shelf-positions`, "POST", { code, wall });

      if (!result.ok) {
        showFormError("shelfError", result.error || "Could not add that.");
        return;
      }

      await reload();
    };
  }

  wireBoardArt(reload);
  wireShelfPhotos(reload);
  wireBoothMap(slug, reload);
}

/** Choosing, and clearing, the library image on a board face. */
function wireBoardArt(reload) {
  document.querySelectorAll("[data-board-pick]").forEach(tile => {
    tile.onclick = (e) => {
      e.stopPropagation();
      pickingArtFor = {
        positionId: Number(tile.dataset.boardPick),
        face: tile.dataset.face
      };
      drawShelfPlan();
    };
  });

  document.getElementById("closePickerBtn")?.addEventListener("click", () => {
    pickingArtFor = null;
    drawShelfPlan();
  });

  document.querySelectorAll("[data-pick-resource]").forEach(btn => {
    btn.onclick = async () => {
      const { positionId, face } = pickingArtFor;

      const result = await apiSend(`/api/shelf-positions/${positionId}/board-art`, "PUT", {
        face,
        resource_id: Number(btn.dataset.pickResource)
      });

      if (!result.ok) {
        showFormError("shelfError", result.error || "Could not put that on the shelf.");
        return;
      }

      pickingArtFor = null;
      await reload();
    };
  });

  document.querySelectorAll("[data-board-view]").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const [positionId, face] = btn.dataset.boardView.split(":");
      viewingBoard = { positionId: Number(positionId), face };
      drawShelfPlan();
    };
  });

  document.getElementById("closeBoardLightboxBtn")?.addEventListener("click", () => {
    viewingBoard = null;
    drawShelfPlan();
  });

  document.querySelectorAll("[data-preview]").forEach(el => {
    el.onmouseenter = () => showBoardPreview(el, el.dataset.preview);
    el.onmouseleave = hideBoardPreview;
  });

  document.querySelectorAll("[data-board-clear]").forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();

      const result = await apiSend(`/api/shelf-positions/${btn.dataset.boardClear}/board-art`, "PUT", {
        face: btn.dataset.face,
        resource_id: null
      });

      if (!result.ok) {
        showFormError("shelfError", result.error || "Could not clear that.");
        return;
      }

      await reload();
    };
  });
}

/**
 * Merchandising photos. One hidden input serves every shelf — the label that
 * opened it writes which position it was for onto the input, since the file
 * dialog can't carry it back any other way.
 */
function wireShelfPhotos(reload) {
  const picker = document.getElementById("shelfPhotoInput");
  if (!picker) return;

  document.querySelectorAll("[data-photo-for]").forEach(label => {
    label.onclick = (e) => {
      e.stopPropagation();
      picker.dataset.forPosition = label.dataset.photoFor;
    };
  });

  picker.onchange = async () => {
    const file = picker.files?.[0];
    const positionId = picker.dataset.forPosition;
    picker.value = "";
    if (!file || !positionId) return;

    showFormError("shelfError", "");

    const code = shelfData.positions.find(p => p.id === Number(positionId))?.code || "";

    await guard(async () => {
      // Bigger than a board: you have to be able to read a spine off it in a
      // hall, not just recognise the shelf. Which is also why it's worth a
      // bar — this is a megabyte going out over the venue's wifi.
      showUploadBar(`Getting the ${code} photo ready…`);
      const image = await readImageScaled(file, 1600);

      const result = await apiUpload(`/api/shelf-positions/${positionId}/photos`, "POST", { image },
        sent => showUploadBar(`Uploading the ${code} photo`, sent));

      if (!result.ok) {
        showFormError("shelfError", result.error || "Could not save that photo.");
        return;
      }

      showUploadBar("Saving…");
      await reload();
    }, err => showFormError("shelfError", err.message));

    hideUploadBar();
  };

  document.querySelectorAll("[data-photo-view]").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      viewingPhoto = Number(btn.dataset.photoView);
      drawShelfPlan();
    };
  });

  document.getElementById("closeLightboxBtn")?.addEventListener("click", () => {
    viewingPhoto = null;
    drawShelfPlan();
  });

  document.querySelectorAll("[data-photo-delete]").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("Delete this photo?")) return;

      const result = await apiSend(`/api/shelf-photos/${btn.dataset.photoDelete}`, "DELETE");

      if (!result.ok) {
        showFormError("shelfError", result.error || "Could not delete that.");
        return;
      }

      viewingPhoto = null;
      await reload();
    };
  });
}

function recomputeTotals() {
  return shelfData.stages.map((label, stage) => {
    const applicable = shelfData.positions.filter(p => stageApplies(p, stage));
    return {
      stage,
      label,
      done: applicable.filter(p => p.stages[stage]).length,
      total: applicable.length
    };
  });
}

function wireBoothMap(slug, reload) {
  document.getElementById("signsModeBtn")?.addEventListener("click", () => {
    signsMode = !signsMode;
    drawShelfPlan();
  });

  document.getElementById("arrangeModeBtn")?.addEventListener("click", () => {
    arrangeMode = !arrangeMode;
    drawShelfPlan();
  });

  document.getElementById("resetArrangeBtn")?.addEventListener("click", async () => {
    await apiSend(`/api/conventions/${encodeURIComponent(slug)}/shelf-reset`, "POST", {});
    await reload();
  });

  document.querySelectorAll("[data-block]").forEach(block => {
    block.onclick = () => {
      shelfSelected = Number(block.dataset.block);
      personSelected = null;
      drawShelfPlan();
    };
  });

  document.querySelectorAll("[data-person]").forEach(dot => {
    dot.onclick = () => {
      personSelected = Number(dot.dataset.person);
      shelfSelected = null;
      drawShelfPlan();
    };
  });

  document.querySelectorAll("[data-nudge]").forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const position = shelfData.positions.find(p => p.id === shelfSelected);
      const axis = btn.dataset.nudge;

      const result = await apiSend(`/api/shelf-positions/${position.id}/geometry`, "PUT", {
        ...position.geometry,
        [axis]: position.geometry[axis] + Number(btn.dataset.by)
      });

      if (!result.ok) {
        showFormError("shelfError", result.error || "Could not move that.");
        return;
      }

      await reload();
    };
  });

  document.getElementById("turnBlockBtn")?.addEventListener("click", async () => {
    const position = shelfData.positions.find(p => p.id === shelfSelected);
    await apiSend(`/api/shelf-positions/${position.id}/geometry`, "PUT", {
      ...position.geometry,
      w: position.geometry.h,
      h: position.geometry.w
    });
    await reload();
  });

  document.getElementById("resetBlockBtn")?.addEventListener("click", async () => {
    await apiSend(`/api/shelf-positions/${shelfSelected}/geometry`, "PUT", { reset: true });
    await reload();
  });

  document.getElementById("arrangeRenameBtn")?.addEventListener("click", async () => {
    const input = document.getElementById("arrangeCodeInput");
    const position = shelfData.positions.find(p => p.id === shelfSelected);
    const code = input?.value.trim();
    if (!position || !code || code === position.code) return;

    const result = await apiSend(`/api/shelf-positions/${position.id}`, "PATCH", { code });

    if (!result.ok) {
      showFormError("shelfError", result.error || "Could not rename that.");
      return;
    }

    await reload();
  });

  // A new unit lands in the top-left corner, selected, ready to drag home.
  document.getElementById("mapAddBtn")?.addEventListener("click", async () => {
    const code = document.getElementById("mapNewCode").value;
    const wall = document.getElementById("mapNewWall").value;
    const result = await apiSend(`/api/conventions/${encodeURIComponent(slug)}/shelf-positions`, "POST", { code, wall });

    if (!result.ok) {
      showFormError("shelfError", result.error || "Could not add that.");
      return;
    }

    await reload();

    const added = shelfData.positions.find(p => p.code === code.trim());
    if (added) {
      shelfSelected = added.id;
      personSelected = null;
      drawShelfPlan();
    }
  });

  // A new person lands in the top-left corner too, selected, ready to drag
  // to their spot.
  document.getElementById("mapAddPersonBtn")?.addEventListener("click", async () => {
    const label = document.getElementById("mapPersonName")?.value.trim();

    // Saying nothing here read as the button being broken.
    if (!label) {
      showFormError("shelfError", "Type a name or a job first — Entrance, Cash, or whoever it is.");
      return;
    }

    showFormError("shelfError", "");

    const result = await apiSend(`/api/conventions/${encodeURIComponent(slug)}/booth-people`, "POST", { label });

    if (!result.ok) {
      showFormError("shelfError", result.error || "Could not add them.");
      return;
    }

    await reload();

    if (result.id) {
      personSelected = result.id;
      shelfSelected = null;
      drawShelfPlan();
    }
  });

  document.getElementById("personRenameBtn")?.addEventListener("click", async () => {
    const label = document.getElementById("personLabelInput")?.value.trim();
    if (!label) return;

    const result = await apiSend(`/api/booth-people/${personSelected}`, "PUT", { label });

    if (!result.ok) {
      showFormError("shelfError", result.error || "Could not rename them.");
      return;
    }

    await reload();
  });

  document.getElementById("personRemoveBtn")?.addEventListener("click", async () => {
    const result = await apiSend(`/api/booth-people/${personSelected}`, "DELETE");

    if (!result.ok) {
      showFormError("shelfError", result.error || "Could not remove them.");
      return;
    }

    personSelected = null;
    await reload();
  });

  wireArrowNudging(reload);
  if (arrangeMode) wireDragging(reload);
}

/* Arrow keys in Arrange mode. The block moves on screen immediately and the
   save is debounced, so holding a key slides the unit rather than firing a
   write per press. One listener, replaced on every draw. */
let arrowHandler = null;
let pendingNudge = null;

function wireArrowNudging(reload) {
  if (arrowHandler) {
    window.removeEventListener("keydown", arrowHandler);
    arrowHandler = null;
  }

  if (!arrangeMode || !shelfData.canManage) return;

  const AXES = {
    ArrowLeft: ["x", -1], ArrowRight: ["x", 1],
    ArrowUp: ["y", -1], ArrowDown: ["y", 1]
  };

  arrowHandler = (event) => {
    const axis = AXES[event.key];
    if (!axis) return;

    // Don't hijack the arrows while someone is in a text box.
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

    const position = shelfData.positions.find(p => p.id === shelfSelected);
    if (!position) return;

    event.preventDefault();

    const [key, direction] = axis;
    const step = (event.shiftKey ? 6 : 1) / 12;
    position.geometry[key] = Math.round((position.geometry[key] + direction * step) * 12) / 12;

    const block = document.querySelector(`.booth-block[data-block="${position.id}"]`);
    if (block) {
      block.style.left = `${position.geometry.x * pxPerFoot}px`;
      block.style.top = `${position.geometry.y * pxPerFoot}px`;
    }

    renderGapRulers(position.geometry, position.id);

    clearTimeout(pendingNudge);
    pendingNudge = setTimeout(async () => {
      const result = await apiSend(
        `/api/shelf-positions/${position.id}/geometry`,
        "PUT",
        position.geometry
      );

      if (!result.ok) showFormError("shelfError", result.error || "Could not move that.");
      await reload();
    }, 350);
  };

  window.addEventListener("keydown", arrowHandler);
}

/** Dragging in Arrange mode. Snapped to the inch by the server. */
function wireDragging(reload) {
  const frame = document.getElementById("boothFrame");
  if (!frame) return;

  document.querySelectorAll(".booth-block.draggable").forEach(block => {
    block.onpointerdown = (event) => {
      event.preventDefault();
      const id = Number(block.dataset.block);
      const position = shelfData.positions.find(p => p.id === id);
      const startX = event.clientX;
      const startY = event.clientY;
      const origin = { ...position.geometry };

      block.setPointerCapture(event.pointerId);
      block.classList.add("dragging");

      const move = (e) => {
        const dx = (e.clientX - startX) / pxPerFoot;
        const dy = (e.clientY - startY) / pxPerFoot;
        block.style.left = `${(origin.x + dx) * pxPerFoot}px`;
        block.style.top = `${(origin.y + dy) * pxPerFoot}px`;
        renderGapRulers({ ...origin, x: origin.x + dx, y: origin.y + dy }, id);
      };

      const up = async (e) => {
        block.releasePointerCapture(event.pointerId);
        block.classList.remove("dragging");
        block.onpointermove = null;
        block.onpointerup = null;

        const dx = (e.clientX - startX) / pxPerFoot;
        const dy = (e.clientY - startY) / pxPerFoot;

        if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) {
          shelfSelected = id;
          drawShelfPlan();
          return;
        }

        await apiSend(`/api/shelf-positions/${id}/geometry`, "PUT", {
          ...origin,
          x: origin.x + dx,
          y: origin.y + dy
        });

        shelfSelected = id;
        await reload();
      };

      block.onpointermove = move;
      block.onpointerup = up;
    };
  });

  document.querySelectorAll(".booth-person.draggable").forEach(dot => {
    dot.onpointerdown = (event) => {
      event.preventDefault();
      const id = Number(dot.dataset.person);
      const person = (shelfData.people || []).find(p => p.id === id);
      const startX = event.clientX;
      const startY = event.clientY;
      const origin = { x: person.x, y: person.y };

      dot.setPointerCapture(event.pointerId);
      dot.classList.add("dragging");

      dot.onpointermove = (e) => {
        const dx = (e.clientX - startX) / pxPerFoot;
        const dy = (e.clientY - startY) / pxPerFoot;
        dot.style.left = `${(origin.x + dx) * pxPerFoot}px`;
        dot.style.top = `${(origin.y + dy) * pxPerFoot}px`;
      };

      dot.onpointerup = async (e) => {
        dot.releasePointerCapture(event.pointerId);
        dot.classList.remove("dragging");
        dot.onpointermove = null;
        dot.onpointerup = null;

        const dx = (e.clientX - startX) / pxPerFoot;
        const dy = (e.clientY - startY) / pxPerFoot;

        if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) {
          personSelected = id;
          shelfSelected = null;
          drawShelfPlan();
          return;
        }

        const result = await apiSend(`/api/booth-people/${id}`, "PUT", {
          x: origin.x + dx,
          y: origin.y + dy
        });

        if (!result.ok) showFormError("shelfError", result.error || "Could not move them.");

        personSelected = id;
        await reload();
      };
    };
  });
}

/*
 * The plan redraws when its column changes width: the grid and the phone list
 * swap at the breakpoint, and the map is drawn at whatever scale fits. A
 * ResizeObserver on the column catches every cause — window resize, rotation,
 * the sidebar appearing — where a window listener misses some of them.
 */
let lastDrawnWidth = 0;
let rescaleTimer = null;

const shelfResizeObserver = new ResizeObserver(entries => {
  if (!shelfData) return;
  if (!document.querySelector(".shelf-row, .shelf-list-card, .booth-frame")) return;

  const width = Math.round(entries[0].contentRect.width);
  if (Math.abs(width - lastDrawnWidth) < 8) return;

  lastDrawnWidth = width;
  clearTimeout(rescaleTimer);
  rescaleTimer = setTimeout(drawShelfPlan, 100);
});

function watchShelfWidth() {
  const area = pageArea();
  if (!area) return;

  lastDrawnWidth = Math.round(area.clientWidth);
  shelfResizeObserver.disconnect();
  shelfResizeObserver.observe(area);
}

window.renderShelfPlan = renderShelfPlan;
