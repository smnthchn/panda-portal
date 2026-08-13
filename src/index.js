import { json, matchPath, BadRequest } from "./lib/http.js";
import { handleMe, handleLogin, handleLogout, handleSetTheme } from "./routes/session.js";
import { handleDashboard } from "./routes/dashboard.js";
import {
  handleStaffList,
  handleStaffDetail,
  handleUpdateStaff,
  handleAssignShift,
  handleGetAvatar,
  handleSetAvatar
} from "./routes/staff.js";
import { handleKnowledgeBase, handleMyFolder, handleDocContent } from "./routes/knowledge.js";
import {
  handleClockStatus,
  handleClockEvent,
  handleClockHistory,
  handleClockReport,
  handleClockFix
} from "./routes/clock.js";
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
  handleSetShiftBreak,
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
  ["PUT", "/api/theme", handleSetTheme],

  ["GET", "/api/dashboard", handleDashboard],

  ["GET", "/api/knowledge-base", handleKnowledgeBase],
  ["GET", "/api/my-folder", handleMyFolder],
  ["GET", "/api/doc-content", handleDocContent],

  ["GET", "/api/clock-status", handleClockStatus],
  ["GET", "/api/clock-history", handleClockHistory],
  ["GET", "/api/admin/clock-report", handleClockReport],
  ["POST", "/api/admin/clock-fix", handleClockFix],
  ["POST", "/api/clock-in", (req, env) => handleClockEvent(req, env, "clock_in")],
  ["POST", "/api/clock-out", (req, env) => handleClockEvent(req, env, "clock_out")],
  ["POST", "/api/break-start", (req, env) => handleClockEvent(req, env, "break_start")],
  ["POST", "/api/break-end", (req, env) => handleClockEvent(req, env, "break_end")],

  ["GET", "/api/avatar/:id", handleGetAvatar, { raw: true }],
  ["PUT", "/api/admin/staff/:id/avatar", handleSetAvatar],

  ["GET", "/api/admin/staff", handleStaffList],
  ["GET", "/api/admin/staff/:id", handleStaffDetail],
  ["PATCH", "/api/admin/staff/:id", handleUpdateStaff],
  ["PUT", "/api/convention-shifts/:id/assign", handleAssignShift],

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
  ["PUT", "/api/convention-shifts/:id/break", handleSetShiftBreak],

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
