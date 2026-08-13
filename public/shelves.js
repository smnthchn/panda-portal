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

const PX_PER_FOOT = 31;

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

function drawShelfPlan() {
  const { convention, positions, canManage } = shelfData;

  if (!positions.length) {
    drawEmptyShelfPlan();
    return;
  }

  pageArea().innerHTML = `
    ${shelfHeader()}
    ${shelfView === "grid" ? shelfGrid() : boothMap()}
  `;

  markActiveNav("conventions", { wide: true });
  wireShelfPlan();
}

/** Before there's a plan: start from the standard booth, or last show's. */
function drawEmptyShelfPlan() {
  const { convention, copyFrom, canManage } = shelfData;

  pageArea().innerHTML = `
    <div class="title-row">
      <button class="back-tile" id="shelfBackBtn">‹</button>
      <div style="flex:1;">
        <h2 style="margin:0;">Shelf plan</h2>
        <div class="meta">${esc(convention.name)}</div>
      </div>
    </div>

    <div class="card">
      <h3>No plan yet</h3>
      <p style="margin:0 0 12px; font-size:13px; line-height:1.5;">
        A plan lists every shelving unit in the booth — what's on it, what
        signage it needs, and how far through prep it is. Start from the
        standard 31-unit booth, or carry forward a previous show's plan and
        adjust it.
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
      <div style="flex:1;">
        <div class="meta" style="letter-spacing:0.08em;">
          ${esc(convention.name.toUpperCase())}${convention.booth_number ? ` · BOOTH ${esc(convention.booth_number)}` : ""}
          · ${booth.width}′ × ${booth.depth}′
        </div>
        <h2 style="margin:0;">Shelf plan</h2>
        <div class="meta">${positions.length} positions · ${left} boxes left to tick</div>
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
        <span class="col-board">BOARD NAME</span>
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
            <input type="text" id="newPositionCode" placeholder="E8" style="width:90px;">
            <button class="btn-dashed" id="addPositionBtn">+ Add a position</button>
          </div>
        </div>
      ` : ""}
    </div>
  `;
}

function shelfRow(position) {
  const applicable = position.stages.filter((_, stage) => stageApplies(position, stage));
  const complete = applicable.every(Boolean);

  return `
    <div class="shelf-row${complete ? " done" : ""}" data-row="${position.id}">
      <span class="col-shelf">${esc(position.code)}</span>

      <span class="col-product">
        <input class="cell-input" type="text" value="${esc(position.product)}"
               data-field="product" data-position="${position.id}" placeholder="—">
      </span>

      <span class="col-type">
        <select class="type-pill" data-field="unit_type" data-position="${position.id}">
          ${shelfData.unitTypes.map(type => `
            <option value="${esc(type)}" ${type === position.unit_type ? "selected" : ""}>${esc(type)}</option>
          `).join("")}
        </select>
      </span>

      <span class="col-signage">
        <button class="signage-cell" data-signage="${position.id}">
          ${position.signage.length
            ? position.signage.map(code => signageTag(code)).join("")
            : `<span class="signage-empty">+ SIGNAGE</span>`}
        </button>
      </span>

      <span class="col-board">
        <input class="cell-input" type="text" value="${esc(position.board_name)}"
               data-field="board_name" data-position="${position.id}" placeholder="—">
      </span>

      ${position.stages.map((done, stage) => `
        <span class="col-stage">${stageBox(position, stage, done)}</span>
      `).join("")}
    </div>

    ${openSignageFor === position.id ? signageStrip(position) : ""}
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
      <button class="btn-quiet" id="closeSignageBtn" style="border:none; background:none; padding:6px 8px;">Done</button>
    </div>
  `;
}

/* ---------- The booth map ---------- */

function boothMap() {
  const { positions, booth, conflicts } = shelfData;
  const selected = positions.find(p => p.id === shelfSelected);

  return `
    <div class="booth-layout">
      <div>
        <div class="button-row" style="margin:0 0 10px;">
          <button class="${signsMode ? "" : "btn-quiet"}" id="signsModeBtn">Signs</button>
          <button class="${arrangeMode ? "" : "btn-quiet"}" id="arrangeModeBtn">Arrange</button>
          ${arrangeMode ? `<button class="btn-danger" id="resetArrangeBtn">Reset all</button>` : ""}
        </div>

        <div class="booth-ruler">← ${booth.width} FT →</div>
        <div class="booth-frame" id="boothFrame"
             style="width:${booth.width * PX_PER_FOOT + 6}px; height:${booth.depth * PX_PER_FOOT + 6}px;">
          <div class="booth-guide v" style="left:${(booth.width / 2) * PX_PER_FOOT}px;"></div>
          <div class="booth-guide h" style="top:${(booth.depth / 3) * PX_PER_FOOT}px;"></div>
          <div class="booth-guide h" style="top:${(booth.depth * 2 / 3) * PX_PER_FOOT}px;"></div>
          ${positions.map(boothBlock).join("")}
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
         style="left:${geometry.x * PX_PER_FOOT}px; top:${geometry.y * PX_PER_FOOT}px;
                width:${geometry.w * PX_PER_FOOT}px; height:${geometry.h * PX_PER_FOOT}px;">
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
          ? (position.board_name ? esc(position.board_name) : `<span style="color:#B0A88F;">—</span>`)
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

        ${position.boards.length ? `
          <div style="margin:8px 0;">
            ${position.boards.map(board => `
              <div style="display:flex; gap:9px; align-items:center; padding:6px 0; border-bottom:2px solid var(--track);">
                <span class="pill" style="font-size:10px;">${esc(board.face.toUpperCase())}</span>
                <span style="flex:1; font-size:13px;">${esc(board.name)}</span>
              </div>
            `).join("")}
          </div>
        ` : ""}

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
            <span style="flex:1; font-size:13px;">
              ${esc(position.board_name)}
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

  document.querySelectorAll("[data-signage]").forEach(cell => {
    cell.onclick = () => {
      const id = Number(cell.dataset.signage);
      openSignageFor = openSignageFor === id ? null : id;
      drawShelfPlan();
    };
  });

  document.getElementById("closeSignageBtn")?.addEventListener("click", () => {
    openSignageFor = null;
    drawShelfPlan();
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
      const result = await apiSend(`/api/conventions/${encodeURIComponent(slug)}/shelf-positions`, "POST", { code });

      if (!result.ok) {
        showFormError("shelfError", result.error || "Could not add that.");
        return;
      }

      await reload();
    };
  }

  wireBoothMap(slug, reload);
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

  if (arrangeMode) wireDragging(reload);
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
        const dx = (e.clientX - startX) / PX_PER_FOOT;
        const dy = (e.clientY - startY) / PX_PER_FOOT;
        block.style.left = `${(origin.x + dx) * PX_PER_FOOT}px`;
        block.style.top = `${(origin.y + dy) * PX_PER_FOOT}px`;
      };

      const up = async (e) => {
        block.releasePointerCapture(event.pointerId);
        block.classList.remove("dragging");
        block.onpointermove = null;
        block.onpointerup = null;

        const dx = (e.clientX - startX) / PX_PER_FOOT;
        const dy = (e.clientY - startY) / PX_PER_FOOT;

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

window.renderShelfPlan = renderShelfPlan;
