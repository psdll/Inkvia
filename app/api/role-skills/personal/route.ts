import {
  assertNoForbiddenRoleSkillQuery,
  normalizePersonalRoleSkillValue,
  readRoleSkillJson,
  roleSkillApiError,
  roleSkillAuthError,
  roleSkillJson,
} from "@/lib/role-skills/http";
import { createPersonalRoleSkill } from "@/lib/role-skills/repository";
import { getUserId } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const authUserId = await getUserId(req);
  if (!authUserId) return roleSkillAuthError();

  try {
    assertNoForbiddenRoleSkillQuery(req);
    const body = await readRoleSkillJson(req);
    const skill = await createPersonalRoleSkill({
      authUserId,
      value: normalizePersonalRoleSkillValue(body),
    });
    return roleSkillJson({ success: true, skill }, 201);
  } catch (error) {
    return roleSkillApiError(error);
  }
}
