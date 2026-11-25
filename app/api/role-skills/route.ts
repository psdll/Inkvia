import {
  assertNoForbiddenRoleSkillQuery,
  roleSkillApiError,
  roleSkillAuthError,
  roleSkillJson,
} from "@/lib/role-skills/http";
import { listRoleSkillsForUser } from "@/lib/role-skills/repository";
import { getUserId } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const authUserId = await getUserId(req);
  if (!authUserId) return roleSkillAuthError();

  try {
    assertNoForbiddenRoleSkillQuery(req);
    const skills = await listRoleSkillsForUser({ authUserId });
    return roleSkillJson({ success: true, skills });
  } catch (error) {
    return roleSkillApiError(error);
  }
}
