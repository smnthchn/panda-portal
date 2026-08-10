import { json, matchPath, BadRequest } from "./lib/http.js";
import { handleMe, handleLogin, handleLogout } from "./routes/session.js";
import { handleKnowledgeBase, handleMyFolder, handleDocContent } from "./routes/knowledge.js";
import { handleClockStatus, handleClockEvent } from "./routes/clock.js";
import {
  handleAdminUsers,
  handleCreateUser,
  handleUpdateUser,
  handleSetUserPermission,
  handleSetRolePermission
} from "./routes/admin.js";
import {
  handleConventionList,
  handleConventionDetail,
  handleCreateConvention,
  handleUpdateConvention,
  handleDeleteConvention,
  handleSaveConventionDay,
  handleDeleteConventionDay,
  handleCreateShift,
  handleDeleteShift,
  handleCreateChecklist,
  handleDeleteChecklist,
  handleCreateChecklistItem,
  handleDeleteChecklistItem,
  handleToggleChecklistItem
} from "./routes/conventions.js";

/**
 * [method, path pattern, handler, options]
 *
 * Handlers receive (request, env, param) where param is the single path
 * parameter, if the pattern has one. Handlers return a plain object which gets
 * JSON-encoded, unless raw:true, in which case they return a Response.
 */
const ROUTES = [
  ["GET", "/api/me", handleMe, { raw: true }],
  ["POST", "/api/login", handleLogin, { raw: true }],
  ["POST", "/api/logout", handleLogout, { raw: true }],

  ["GET", "/api/knowledge-base", handleKnowledgeBase],
  ["GET", "/api/my-folder", handleMyFolder],
  ["GET", "/api/doc-content", handleDocContent],

  ["GET", "/api/clock-status", handleClockStatus],
  ["POST", "/api/clock-in", (req, env) => handleClockEvent(req, env, "clock_in")],
  ["POST", "/api/clock-out", (req, env) => handleClockEvent(req, env, "clock_out")],
  ["POST", "/api/break-start", (req, env) => handleClockEvent(req, env, "break_start")],
  ["POST", "/api/break-end", (req, env) => handleClockEvent(req, env, "break_end")],

  ["GET", "/api/admin/users", handleAdminUsers],
  ["POST", "/api/admin/users", handleCreateUser],
  ["PATCH", "/api/admin/users/:id", handleUpdateUser],
  ["PUT", "/api/admin/users/:id/permissions", handleSetUserPermission],
  ["PUT", "/api/admin/role-permissions", handleSetRolePermission],

  ["GET", "/api/conventions", handleConventionList],
  ["POST", "/api/conventions", handleCreateConvention],
  ["GET", "/api/conventions/:slug", handleConventionDetail],
  ["PATCH", "/api/conventions/:id", handleUpdateConvention],
  ["DELETE", "/api/conventions/:id", handleDeleteConvention],

  ["POST", "/api/conventions/:id/days", handleSaveConventionDay],
  ["DELETE", "/api/convention-days/:id", handleDeleteConventionDay],

  ["POST", "/api/conventions/:id/shifts", handleCreateShift],
  ["DELETE", "/api/convention-shifts/:id", handleDeleteShift],

  ["POST", "/api/conventions/:id/checklists", handleCreateChecklist],
  ["DELETE", "/api/convention-checklists/:id", handleDeleteChecklist],

  ["POST", "/api/convention-checklists/:id/items", handleCreateChecklistItem],
  ["DELETE", "/api/convention-checklist-items/:id", handleDeleteChecklistItem],
  ["POST", "/api/convention-checklist-items/:id/toggle", handleToggleChecklistItem]
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    for (const [method, pattern, handler, options = {}] of ROUTES) {
      if (request.method !== method) continue;

      const params = matchPath(url.pathname, pattern);
      if (!params) continue;

      const param = Object.values(params)[0];

      try {
        const result = await handler(request, env, param);
        return options.raw ? result : json(result);
      } catch (err) {
        if (err instanceof BadRequest) {
          return json({ ok: false, error: err.message }, 400);
        }

        console.error(`${method} ${url.pathname} failed`, err);
        return json({ ok: false, error: err.message || "Something went wrong." }, 500);
      }
    }

    return json({ ok: false, error: "Not found" }, 404);
  }
};
