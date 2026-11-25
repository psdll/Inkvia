import type { NextRequest } from "next/server";
import { logAdminAction } from "@/lib/admin-audit";
import { requireAdminRequest } from "@/lib/admin-auth";
import {
  assertNoForbiddenRoleSkillQuery,
  readRoleSkillJson,
  requireExpectedRevision,
  requireRoleSkillPublicId,
  roleSkillApiError,
  roleSkillError,
  roleSkillJson,
} from "@/lib/role-skills/http";
import {
  purgeExpiredSystemRoleSkills,
  restoreSystemRoleSkill,
} from "@/lib/role-skills/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { skillId: string } };

export async function POST(req: Request, { params }: Context) {
  const auth = requireAdminRequest(req as NextRequest);
  if (!auth.ok) return roleSkillError("ADMIN_AUTH_REQUIRED", auth.error, 401);

  try {
    assertNoForbiddenRoleSkillQuery(req);
    const publicId = requireRoleSkillPublicId(params.skillId, "system");
    const body = await readRoleSkillJson(req);
    await purgeExpiredSystemRoleSkills({ limit: 100 });
    const skill = await restoreSystemRoleSkill({
      publicId,
      expectedRevision: requireExpectedRevision(body.expectedRevision),
    });
    await logAdminAction({
      admin: auth.username,
      action: "role_skill_system_restore",
      message: `恢复系统技能 ${skill.name}`,
      level: "success",
      metadata: { skillId: skill.id, revision: skill.revision, status: skill.status },
      req,
    });
    return roleSkillJson({ success: true, skill });
  } catch (error) {
    return roleSkillApiError(error);
  }
}
