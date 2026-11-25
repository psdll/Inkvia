import type { RoleSkillDetail } from "@/lib/role-skills/contracts";
import { normalizeSkillWorkspace } from "@/lib/role-skills/skill-workspace";

export async function buildSkillWorkspaceArchive(skill: RoleSkillDetail) {
  const workspace = normalizeSkillWorkspace(skill.workspace, skill.content);
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const path of workspace.directories) zip.folder(path);
  for (const file of workspace.files) zip.file(file.path, file.content);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const name = skill.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").trim() || "skill";
  return { blob, filename: `${name}.zip` };
}

export async function downloadSkillWorkspace(skill: RoleSkillDetail) {
  const { blob, filename } = await buildSkillWorkspaceArchive(skill);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
