import {
  assertNoForbiddenRoleSkillQuery,
  requireRoleSkillPublicId,
  roleSkillApiError,
  roleSkillAuthError,
  roleSkillJson,
} from "@/lib/role-skills/http";
import { getSystemRoleSkillForUser } from "@/lib/role-skills/repository";
import { getUserId } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { skillId: string } };

export async function GET(req: Request, { params }: Context) {
  const authUserId = await getUserId(req);
  if (!authUserId) return roleSkillAuthError();

  try {
    assertNoForbiddenRoleSkillQuery(req);
    const publicId = requireRoleSkillPublicId(params.skillId, "system");
    const skill = await getSystemRoleSkillForUser(publicId);
    return roleSkillJson({ success: true, skill });
  } catch (error) {
    return roleSkillApiError(error);
  }
}
