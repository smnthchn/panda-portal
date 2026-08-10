import { requireUser } from "../lib/auth.js";
import { roleOutranks } from "../lib/permissions.js";
import { listDriveFiles, fetchGoogleDoc } from "../lib/google.js";

export async function handleKnowledgeBase(request, env) {
  const auth = await requireUser(request, env, "knowledge_base");
  if (!auth.ok) return auth;

  const sections = await env.DB.prepare(
    `SELECT * FROM knowledge_base_sections
     WHERE is_active = 1
     ORDER BY sort_order ASC`
  ).all();

  const visibleSections = (sections.results || []).filter(section =>
    roleOutranks(auth.user.role, section.allowed_role)
  );

  const output = [];
  for (const section of visibleSections) {
    output.push({
      name: section.name,
      files: await listDriveFiles(section.folder_id, env)
    });
  }

  return { ok: true, sections: output };
}

export async function handleMyFolder(request, env) {
  const auth = await requireUser(request, env, "employee_folder");
  if (!auth.ok) return auth;

  const folderId = auth.user.google_drive_folder_id;

  if (!folderId) {
    return { ok: false, error: "No folder assigned." };
  }

  return { ok: true, files: await listDriveFiles(folderId, env) };
}

export async function handleDocContent(request, env) {
  const auth = await requireUser(request, env);
  if (!auth.ok) return auth;

  const docId = new URL(request.url).searchParams.get("id");

  if (!docId) {
    return { ok: false, error: "Missing doc id" };
  }

  return fetchGoogleDoc(docId, env);
}
