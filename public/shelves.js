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
let viewingPhoto = null;        // photo id, shown full size
let pickingArtFor = null;       // { positionId, face } while the picker is open

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

async function renderShelfPlan(slug, pushState = true) {
  if (pushState) pushPageState("shelf-plan", { slug });

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
    ${shelfView === "map" ? boothMap() : list ? shelfList() : shelfGrid()}

    <input type="file" id="shelfPhotoInput" style="display:none;"
           accept="image/png,image/jpeg,image/webp" capture="environment">

    ${pickingArtFor ? artworkPicker() : ""}
    ${viewingPhoto ? photoLightbox() : ""}
  `;

  markActiveNav("conventions", { wide: !list });
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
  const colour = total && done === total ? "#1E8F68" : done === 0 ? "var(--alert)" : "var(--text)";

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
                     title="Move it to another section, or remove it">${esc(position.code)}</button>`
          : esc(position.code)}
      </span>

      <span class="col-product">
        ${canEdit
          ? `<input class="cell-input" type="text" value="${esc(position.product)}"
                    data-field="product" data-position="${position.id}" placeholder="—">`
          : `<span class="cell-static">${esc(position.product || "—")}</span>`}
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
  `;
}

/**
 * Which section a shelf is in, and the way to remove it.
 *
 * Unlike the signage and boards strips, this one waits for Save. Moving a
 * shelf takes its row out from under you and re-sorts the grid around it, so
 * doing that the instant the list changes is startling — and there's no
 * undo. Pick the section, look at it, then commit.
 */
function shelfStrip(position) {
  return `
    <div class="signage-strip shelf-strip">
      <span class="board-slot-face">SECTION</span>
      <select data-wall="${position.id}">
        ${shelfData.walls.map(wall => `
          <option value="${esc(wall)}" ${wall === position.wall ? "selected" : ""}>${esc(wall)}</option>
        `).join("")}
      </select>

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
            <span class="shelf-list-code">${esc(position.code)}</span>
            <div style="flex:1; min-width:0;">
              <div style="font-size:13px;">${esc(position.product || "—")}</div>
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

/* ---------- The booth map ---------- */

function boothMap() {
  const { positions, booth, conflicts } = shelfData;
  const selected = positions.find(p => p.id === shelfSelected);

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
        ` : ""}

        <div class="booth-ruler">← ${booth.width} FT →</div>
        <div class="booth-scroll">
        <div class="booth-frame" id="boothFrame"
             style="width:${booth.width * pxPerFoot + 6}px; height:${booth.depth * pxPerFoot + 6}px;">
          <div class="booth-guide v" style="left:${(booth.width / 2) * pxPerFoot}px;"></div>
          <div class="booth-guide h" style="top:${(booth.depth / 3) * pxPerFoot}px;"></div>
          <div class="booth-guide h" style="top:${(booth.depth * 2 / 3) * pxPerFoot}px;"></div>
          ${positions.map(boothBlock).join("")}
        </div>
        </div>
      </div>

      <div class="booth-panel">
        ${selected ? selectedPositionCard(selected) : ""}
        ${conflicts.length ? conflictsCard(conflicts) : ""}
        ${signsMode ? signsList() : glanceCard()}
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
          ? (position.boards.length ? esc(boardNameList(position)) : `<span style="color:#B0A88F;">—</span>`)
          : esc(position.product || "")}
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
  const colour = clearsOnly ? "#17879B" : "#F2B53B";

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
        <div style="font-family:'Fredoka',sans-serif; font-weight:600; font-size:24px;">${esc(position.code)}</div>
        <div class="meta" style="margin-bottom:10px;">${esc(position.product || "Nothing set")}</div>

        ${position.signage.length
          ? `<div class="badge-row">${position.signage.map(signageTag).join("")}</div>`
          : `<p class="meta">No signage needed.</p>`}

        ${boardsBlock(position)}
        ${photosBlock(position)}

        <div class="panel-stages">
          ${position.stages.map((done, stage) => `
            <div class="panel-stage">
              ${stageBox(position, stage, done)}
              <span class="meta">${esc(shelfData.stages[stage])}</span>
            </div>
          `).join("")}
        </div>

        ${arrangeMode ? `
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
    <div style="margin:8px 0;">
      ${position.boards.map(board => `
        <div class="board-row">
          <div class="board-row-head" style="margin-bottom:8px;">
            <span class="pill" style="font-size:10px;">${esc(board.face.toUpperCase())}</span>
            <span style="flex:1; font-size:13px;">${esc(board.name)}</span>
          </div>

          ${board.image_url
            ? `<div class="board-art" style="height:110px;">
                <img src="${esc(board.image_url)}" alt="${esc(board.name)}" loading="lazy" decoding="async">
              </div>`
            : `<div class="board-art empty" style="height:76px;">
                <span class="meta">No artwork yet</span>
              </div>`}
        </div>
      `).join("")}
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
               style="font-size:11.5px; padding:5px 9px; border-bottom-width:2px;"
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
      <div class="lightbox-bar">
        <span>${esc(photo.position.code)}${photo.taken_by_name ? ` · ${esc(photo.taken_by_name)}` : ""}</span>
        <div class="button-row" style="margin:0;">
          ${shelfData.canManage
            ? `<button class="btn-danger" data-photo-delete="${photo.id}">Delete</button>`
            : ""}
          <button class="btn-quiet" id="closeLightboxBtn">Close</button>
        </div>
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

function glanceCard() {
  return `
    <div class="card">
      <h3>At a glance</h3>
      <div class="stage-batteries compact">
        ${shelfData.totals.map(stageBattery).join("")}
      </div>
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
              ? `<span style="color:#1E8F68; font-weight:600; font-size:12px;">✓ up</span>`
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

  document.getElementById("shelfBackBtn").onclick = () => openConvention(slug);

  document.querySelectorAll("[data-shelf-view]").forEach(btn => {
    btn.onclick = () => {
      const value = btn.dataset.shelfView;
      shelfView = value === "map" ? "map" : "grid";
      if (value === "grid-all") shelfFilter = "all";
      if (value === "grid-left") shelfFilter = "left";
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
      drawShelfPlan();
    };
  });

  // Save is what moves the shelf. Choosing a section only fills the box in;
  // walking away from the strip leaves the shelf exactly where it was.
  document.getElementById("closeShelfBtn")?.addEventListener("click", async () => {
    const select = document.querySelector("[data-wall]");
    const position = shelfData.positions.find(p => p.id === openShelfFor);

    if (!select || !position || select.value === position.wall) {
      openShelfFor = null;
      drawShelfPlan();
      return;
    }

    const result = await apiSend(`/api/shelf-positions/${position.id}`, "PATCH", {
      wall: select.value
    });

    if (!result.ok) {
      showFormError("shelfError", result.error || "Could not move that shelf.");
      return;
    }

    openShelfFor = null;
    await reload();
  });

  document.querySelectorAll("[data-delete-shelf]").forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.deleteShelf);
      const position = shelfData.positions.find(p => p.id === id);

      if (!confirm(`Remove ${position?.code} from the booth? Its ticks, boards and photos go with it.`)) {
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
