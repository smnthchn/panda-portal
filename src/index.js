import { json, matchPath, BadRequest } from "./lib/http.js";
import { handleMe, handleLogin, handleLogout, handleSetTheme } from "./routes/session.js";
import { handleDashboard } from "./routes/dashboard.js";
import {
  handleResources,
  handleGetResourceImage,
  handleCreateResource,
  handleUpdateResource,
  handleDeleteResource
} from "./routes/resources.js";
import {
  handleShelfPlan,
  handleStartShelfPlan,
  handleToggleStage,
  handleUpdatePosition,
  handleMovePosition,
  handleResetArrangement,
  handleAddPosition,
  handleDeletePosition,
  handleAssignBoardArt,
  handleGetShelfPhoto,
  handleAddShelfPhoto,
  handleDeleteShelfPhoto
} from "./routes/shelves.js";
import {
  handleMyAvailability,
  handleSaveMyAvailability,
  handleSaveStaffAvailability,
  handleRequestTimeOff,
  handleDeleteTimeOff,
  handleDecideTimeOff,
  handlePendingTimeOff
} from "./routes/availability.js";
import {
  handleScheduleView,
  handleUpdateShift,
  handleCopyDay,
  handleCreateShiftAnywhere,
  handleStoreSchedule,
  handleSaveStoreHours
} from "./routes/schedule.js";
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

  ["GET", "/api/my-availability", handleMyAvailability],
  ["PUT", "/api/my-availability", handleSaveMyAvailability],
  ["POST", "/api/time-off", handleRequestTimeOff],
  ["DELETE", "/api/time-off/:id", handleDeleteTimeOff],
  ["PUT", "/api/time-off/:id/decision", handleDecideTimeOff],
  ["GET", "/api/admin/time-off", handlePendingTimeOff],
  ["PUT", "/api/admin/staff/:id/availability", handleSaveStaffAvailability],

  ["GET", "/api/schedule/store", handleStoreSchedule],
  ["PUT", "/api/schedule/store-hours", handleSaveStoreHours],
  ["POST", "/api/schedule/copy-day", handleCopyDay],
  ["POST", "/api/shifts", handleCreateShiftAnywhere],

  ["GET", "/api/conventions/:slug/shelf-plan", handleShelfPlan],
  ["POST", "/api/conventions/:slug/shelf-plan", handleStartShelfPlan],
  ["POST", "/api/conventions/:slug/shelf-positions", handleAddPosition],
  ["POST", "/api/conventions/:slug/shelf-reset", handleResetArrangement],
  ["POST", "/api/shelf-positions/:id/stage", handleToggleStage],
  ["PATCH", "/api/shelf-positions/:id", handleUpdatePosition],
  ["PUT", "/api/shelf-positions/:id/geometry", handleMovePosition],
  ["DELETE", "/api/shelf-positions/:id", handleDeletePosition],

  ["PUT", "/api/shelf-positions/:id/board-art", handleAssignBoardArt],
  ["POST", "/api/shelf-positions/:id/photos", handleAddShelfPhoto],
  ["GET", "/api/shelf-photo/:id", handleGetShelfPhoto, { raw: true }],
  ["DELETE", "/api/shelf-photos/:id", handleDeleteShelfPhoto],

  ["GET", "/api/resources", handleResources],
  ["POST", "/api/resources", handleCreateResource],
  ["GET", "/api/resource-image/:id", handleGetResourceImage, { raw: true }],
  ["PATCH", "/api/resources/:id", handleUpdateResource],
  ["DELETE", "/api/resources/:id", handleDeleteResource],

  ["GET", "/api/conventions/:slug/schedule", handleScheduleView],

  ["POST", "/api/conventions/:id/shifts", handleCreateShift],
  ["PATCH", "/api/convention-shifts/:id", handleUpdateShift],
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
