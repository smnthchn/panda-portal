/* Resources — the store's own library of images, reached from Events.

   Board artwork, mostly: a board is a physical printed sign the store owns
   and hangs again at the next show, so the picture belongs to the store
   rather than to one event. Upload it once here, then assign it to a shelf on
   any event's booth plan. */

let resourceData = null;
let renamingResource = null;

async function renderResources(pushState = true) {
  if (pushState) pushPageState("resources");

  const data = await api("/api/resources");

  if (!data.ok) {
    renderError(data.error || "Could not load the resources");
    return;
  }

  resourceData = data;
  drawResources();
}

function drawResources() {
  const { resources, canManage } = resourceData;

  pageArea().innerHTML = `
    <div class="title-row">
      <button class="back-tile" id="resourcesBackBtn">‹</button>
      <div class="screen-title">
        <div class="kicker-line">EVENTS</div>
        <h2>Resources</h2>
        <div class="meta">
          ${resources.length
            ? `${resources.length} file${resources.length === 1 ? "" : "s"} · assign them to shelves on a booth plan`
            : "Board artwork and other pictures, shared across every event"}
        </div>
      </div>
      ${canManage ? `
        <div class="button-row" style="margin:0;">
          <button id="uploadResourceBtn">Upload</button>
        </div>
      ` : ""}
    </div>

    <p class="form-error" id="resourceError"></p>
    ${canManage ? `
      <input type="file" id="resourceInput" multiple style="display:none;"
             accept="image/png,image/jpeg,image/webp">
    ` : ""}

    ${resources.length
      ? `<div class="resource-grid">${resources.map(resourceTile).join("")}</div>`
      : `<div class="card">
          <p class="empty-state">
            ${canManage
              ? "Nothing in the library yet. Upload the artwork for a board and it'll be here for every show, not just this one."
              : "Nothing in the library yet."}
          </p>
        </div>`}
  `;

  markActiveNav("conventions", { wide: true });
  wireResources();
}

function resourceTile(resource) {
  const { canManage } = resourceData;
  const renaming = renamingResource === resource.id;

  return `
    <div class="card resource-tile">
      <div class="resource-art">
        <img src="${esc(resource.image_url)}" alt="${esc(resource.name)}"
             loading="lazy" decoding="async">
      </div>

      ${renaming
        ? `<div class="inline-form" style="margin:8px 0 0;">
            <input type="text" id="renameResourceInput" value="${esc(resource.name)}">
            <button data-resource-rename-save="${resource.id}">Save</button>
          </div>`
        : `<div class="resource-name">${esc(resource.name)}</div>`}

      <div class="meta">
        ${resource.assigned_count
          ? `on ${resource.assigned_count} shel${resource.assigned_count === 1 ? "f" : "ves"}`
          : "not on a shelf yet"}
      </div>

      ${canManage && !renaming ? `
        <div class="button-row" style="margin:8px 0 0;">
          <button class="btn-quiet" style="font-size:11.5px; padding:5px 9px; border-bottom-width:2px;"
                  data-resource-rename="${resource.id}">Rename</button>
          <button class="btn-quiet" style="font-size:11.5px; padding:5px 9px; border-bottom-width:2px;"
                  data-resource-replace="${resource.id}">Replace</button>
          <button class="btn-danger" style="font-size:11.5px; padding:5px 9px; border-bottom-width:2px;"
                  data-resource-delete="${resource.id}">Delete</button>
        </div>
      ` : ""}
    </div>
  `;
}

function wireResources() {
  document.getElementById("resourcesBackBtn").onclick = () => renderConventions();

  if (!resourceData.canManage) return;

  const picker = document.getElementById("resourceInput");

  // One picker for uploading and for replacing: which job it's doing rides on
  // the input, since the file dialog can't carry it back any other way.
  const openPicker = (replacing) => {
    picker.dataset.replacing = replacing || "";
    picker.multiple = !replacing;
    picker.click();
  };

  document.getElementById("uploadResourceBtn").onclick = () => openPicker(null);

  picker.onchange = async () => {
    const files = [...(picker.files || [])];
    const replacing = picker.dataset.replacing;
    picker.value = "";
    if (!files.length) return;

    showFormError("resourceError", "");

    await guard(async () => {
      if (replacing) {
        const name = resourceData.resources.find(r => r.id === Number(replacing))?.name || "picture";

        showUploadBar(`Getting ${name} ready…`);
        const image = await readImageScaled(files[0], 1400);

        const result = await apiUpload(`/api/resources/${replacing}`, "PATCH", { image },
          sent => showUploadBar(`Replacing ${name}`, sent));

        if (!result.ok) {
          showFormError("resourceError", result.error || "Could not replace that.");
          return;
        }
      } else {
        // Several at once: the boards for a show tend to arrive in one batch,
        // so the bar counts the whole batch rather than restarting per file.
        for (const [index, file] of files.entries()) {
          const name = fileBaseName(file.name);
          const of = files.length > 1 ? ` · ${index + 1} of ${files.length}` : "";
          const done = index / files.length;
          const share = 1 / files.length;

          showUploadBar(`Getting ${name} ready…${of}`);
          const image = await readImageScaled(file, 1400);

          const result = await apiUpload("/api/resources", "POST", { name, image },
            sent => showUploadBar(`Uploading ${name}${of}`, done + sent * share));

          if (!result.ok) {
            showFormError("resourceError", result.error || "Could not upload that.");
            break;
          }
        }
      }

      // The bytes are all out, but the row still has to be written and the
      // screen reloaded — so the bar keeps moving rather than freezing full.
      showUploadBar("Saving…");
      await renderResources(false);
    }, err => showFormError("resourceError", err.message));

    hideUploadBar();
  };

  document.querySelectorAll("[data-resource-replace]").forEach(btn => {
    btn.onclick = () => openPicker(btn.dataset.resourceReplace);
  });

  document.querySelectorAll("[data-resource-rename]").forEach(btn => {
    btn.onclick = () => {
      renamingResource = Number(btn.dataset.resourceRename);
      drawResources();
      document.getElementById("renameResourceInput")?.focus();
    };
  });

  document.querySelectorAll("[data-resource-rename-save]").forEach(btn => {
    btn.onclick = async () => {
      const result = await apiSend(`/api/resources/${btn.dataset.resourceRenameSave}`, "PATCH", {
        name: document.getElementById("renameResourceInput").value
      });

      if (!result.ok) {
        showFormError("resourceError", result.error || "Could not rename that.");
        return;
      }

      renamingResource = null;
      await renderResources(false);
    };
  });

  document.querySelectorAll("[data-resource-delete]").forEach(btn => {
    btn.onclick = async () => {
      const resource = resourceData.resources.find(r => r.id === Number(btn.dataset.resourceDelete));

      // Deleting reaches into every event this is on, so say so rather than
      // letting it be discovered at a booth.
      const warning = resource?.assigned_count
        ? `Delete “${resource.name}”? It comes off ${resource.assigned_count} shelf${resource.assigned_count === 1 ? "" : "s"} across every event using it.`
        : `Delete “${resource?.name}”?`;

      if (!confirm(warning)) return;

      const result = await apiSend(`/api/resources/${btn.dataset.resourceDelete}`, "DELETE");

      if (!result.ok) {
        showFormError("resourceError", result.error || "Could not delete that.");
        return;
      }

      await renderResources(false);
    };
  });
}

/** "gundam-back-board.png" -> "gundam back board", as a starting name. */
function fileBaseName(fileName) {
  return String(fileName || "file")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim() || "Untitled";
}

window.renderResources = renderResources;
