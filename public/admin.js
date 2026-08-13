/* Users & Roles — boss-only. */

let adminData = null;
let expandedUserId = null;

async function renderUsersRoles(pushState = true) {
  if (pushState) pushPageState("users-roles");

  const data = await api("/api/admin/users");

  if (!data.ok) {
    renderError(data.error || "Could not load users");
    return;
  }

  adminData = data;
  drawUsersRoles();
}

function drawUsersRoles() {
  pageArea().innerHTML = `
    <div class="page-header">
      <h2>Users &amp; Roles</h2>
      <p>Who can sign in, and what each person can see</p>
    </div>

    ${roleDefaultsCard()}
    ${peopleCard()}
    ${addPersonCard()}
  `;

  markActiveNav("users-roles");
  wireRoleDefaults();
  wirePeople();
  wireAddPerson();
}

function roleDefaultsCard() {
  const { roles, permissions, roleDefaults, lockedRolePermissions } = adminData;

  return `
    <div class="card">
      <h3>Role defaults</h3>
      <p class="meta">
        What each role can do out of the box. Individual people can be granted or
        denied anything below on the People list.
      </p>

      <div class="table-scroll">
        <table class="grid-table">
          <thead>
            <tr>
              <th>Permission</th>
              ${roles.map(r => `<th class="center">${esc(r.label)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${permissions.map(permission => `
              <tr>
                <td>${esc(permission.label)}</td>
                ${roles.map(role => {
                  const locked = (lockedRolePermissions[role.key] || []).includes(permission.key);
                  const checked = roleDefaults[role.key]?.[permission.key];
                  return `
                    <td class="center">
                      <input type="checkbox"
                             data-role-perm="${esc(role.key)}"
                             data-permission="${esc(permission.key)}"
                             ${checked ? "checked" : ""}
                             ${locked ? "disabled" : ""}
                             title="${locked ? "Always on for Boss" : ""}">
                    </td>
                  `;
                }).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <p class="form-error" id="roleDefaultsError"></p>
    </div>
  `;
}

function peopleCard() {
  const { users } = adminData;

  return `
    <div class="card">
      <h3>People</h3>

      <div class="table-scroll">
        <table class="grid-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th class="center">Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${users.map(user => personRow(user)).join("")}
          </tbody>
        </table>
      </div>
      <p class="form-error" id="peopleError"></p>
    </div>
  `;
}

function personRow(user) {
  const { roles, permissions } = adminData;
  const isSelf = user.id === adminData.currentUserId;
  const expanded = expandedUserId === user.id;

  const main = `
    <tr class="${user.is_active ? "" : "row-inactive"}">
      <td>
        <strong>${esc(user.full_name)}</strong>${isSelf ? ' <span class="pill">you</span>' : ""}
        <div class="meta">${esc(user.email)}</div>
      </td>
      <td>
        <select data-user-role="${user.id}" ${isSelf ? "disabled" : ""}>
          ${roles.map(r => `
            <option value="${esc(r.key)}" ${r.key === user.role ? "selected" : ""}>${esc(r.label)}</option>
          `).join("")}
        </select>
      </td>
      <td class="center">
        <input type="checkbox" data-user-active="${user.id}"
               ${user.is_active ? "checked" : ""} ${isSelf ? "disabled" : ""}>
      </td>
      <td class="right">
        <button class="btn-quiet" data-user-expand="${user.id}">
          ${expanded ? "Hide access" : "Access"}
        </button>
      </td>
    </tr>
  `;

  if (!expanded) return main;

  const detail = `
    <tr class="detail-row">
      <td colspan="4">
        <div class="detail-panel">
          <h4>${esc(user.full_name)}'s access</h4>
          <p class="meta">
            Leave a row on <em>Use role default</em> to follow the
            ${esc(roleLabel(user.role))} settings above. Anything else is an
            exception just for this person.
          </p>

          <div class="perm-rows">
            ${permissions.map(permission => {
              const override = user.overrides[permission.key];
              const value = override === undefined ? "inherit" : (override ? "allow" : "deny");
              const roleDefault = adminData.roleDefaults[user.role]?.[permission.key];

              return `
                <div class="perm-row">
                  <div>
                    <div>${esc(permission.label)}</div>
                    <div class="meta">Role default: ${roleDefault ? "allowed" : "not allowed"}</div>
                  </div>
                  <select data-user-perm="${user.id}" data-permission="${esc(permission.key)}">
                    <option value="inherit" ${value === "inherit" ? "selected" : ""}>Use role default</option>
                    <option value="allow" ${value === "allow" ? "selected" : ""}>Always allow</option>
                    <option value="deny" ${value === "deny" ? "selected" : ""}>Never allow</option>
                  </select>
                </div>
              `;
            }).join("")}
          </div>

          <h4>Details</h4>
          <div class="form-grid">
            <label>Full name
              <input type="text" data-user-field="full_name" data-user-id="${user.id}"
                     value="${esc(user.full_name)}">
            </label>
            <label>Location
              <input type="text" data-user-field="location" data-user-id="${user.id}"
                     value="${esc(user.location || "")}" placeholder="Optional">
            </label>
            <label>Google Drive folder ID
              <input type="text" data-user-field="google_drive_folder_id" data-user-id="${user.id}"
                     value="${esc(user.google_drive_folder_id || "")}" placeholder="Optional">
            </label>
          </div>
          <div class="button-row">
            <button data-user-save="${user.id}">Save details</button>
          </div>
        </div>
      </td>
    </tr>
  `;

  return main + detail;
}

function roleLabel(roleKey) {
  return adminData.roles.find(r => r.key === roleKey)?.label || roleKey;
}

function wireRoleDefaults() {
  document.querySelectorAll("[data-role-perm]").forEach(box => {
    box.onchange = async () => {
      const role = box.dataset.rolePerm;
      const permission = box.dataset.permission;
      const allowed = box.checked;

      box.disabled = true;
      const result = await apiSend("/api/admin/role-permissions", "PUT", { role, permission, allowed });
      box.disabled = false;

      if (!result.ok) {
        box.checked = !allowed;
        showFormError("roleDefaultsError", result.error || "Could not save that change.");
        return;
      }

      showFormError("roleDefaultsError", "");
      adminData.roleDefaults[role][permission] = allowed;
      await renderUsersRoles(false);
    };
  });
}

function wirePeople() {
  document.querySelectorAll("[data-user-expand]").forEach(btn => {
    btn.onclick = () => {
      const id = Number(btn.dataset.userExpand);
      expandedUserId = expandedUserId === id ? null : id;
      drawUsersRoles();
    };
  });

  document.querySelectorAll("[data-user-role]").forEach(select => {
    select.onchange = () => saveUser(Number(select.dataset.userRole), { role: select.value });
  });

  document.querySelectorAll("[data-user-active]").forEach(box => {
    box.onchange = () => saveUser(Number(box.dataset.userActive), { is_active: box.checked });
  });

  document.querySelectorAll("[data-user-perm]").forEach(select => {
    select.onchange = async () => {
      const id = Number(select.dataset.userPerm);
      const permission = select.dataset.permission;
      const allowed = select.value === "inherit" ? null : select.value === "allow";

      select.disabled = true;
      const result = await apiSend(`/api/admin/users/${id}/permissions`, "PUT", { permission, allowed });
      select.disabled = false;

      if (!result.ok) {
        showFormError("peopleError", result.error || "Could not save that change.");
        return;
      }

      showFormError("peopleError", "");
      await renderUsersRoles(false);
    };
  });

  document.querySelectorAll("[data-user-save]").forEach(btn => {
    btn.onclick = () => {
      const id = Number(btn.dataset.userSave);
      const fields = {};

      document.querySelectorAll(`[data-user-field][data-user-id="${id}"]`).forEach(input => {
        fields[input.dataset.userField] = input.value;
      });

      saveUser(id, fields);
    };
  });
}

async function saveUser(id, changes) {
  const result = await apiSend(`/api/admin/users/${id}`, "PATCH", changes);

  if (!result.ok) {
    showFormError("peopleError", result.error || "Could not save that change.");
    await renderUsersRoles(false);
    return;
  }

  showFormError("peopleError", "");
  await renderUsersRoles(false);
}

function addPersonCard() {
  const { roles } = adminData;

  return `
    <div class="card">
      <h3>Add someone</h3>
      <p class="meta">
        They'll be able to sign in with the Google account matching this email.
      </p>

      <div class="form-grid">
        <label>Email
          <input type="email" id="newUserEmail" placeholder="name@pandahobby.ca">
        </label>
        <label>Full name
          <input type="text" id="newUserName" placeholder="First Last">
        </label>
        <label>Role
          <select id="newUserRole">
            ${roles.map(r => `
              <option value="${esc(r.key)}" ${r.key === "volunteer" ? "selected" : ""}>${esc(r.label)}</option>
            `).join("")}
          </select>
        </label>
        <label>Google Drive folder ID
          <input type="text" id="newUserFolder" placeholder="Optional">
        </label>
      </div>

      <div class="button-row">
        <button id="addUserBtn">Add person</button>
      </div>
      <p class="form-error" id="addUserError"></p>
    </div>
  `;
}

function wireAddPerson() {
  const btn = document.getElementById("addUserBtn");
  if (!btn) return;

  btn.onclick = async () => {
    btn.disabled = true;

    const result = await apiSend("/api/admin/users", "POST", {
      email: document.getElementById("newUserEmail").value,
      full_name: document.getElementById("newUserName").value,
      role: document.getElementById("newUserRole").value,
      google_drive_folder_id: document.getElementById("newUserFolder").value
    });

    btn.disabled = false;

    if (!result.ok) {
      showFormError("addUserError", result.error || "Could not add that person.");
      return;
    }

    showFormError("addUserError", "");
    await renderUsersRoles(false);
  };
}

window.renderUsersRoles = renderUsersRoles;
