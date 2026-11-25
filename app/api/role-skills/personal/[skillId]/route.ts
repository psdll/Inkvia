import {
  assertNoForbiddenRoleSkillQuery,
  normalizePersonalRoleSkillValue,
  readRoleSkillJson,
  requireExpectedRevision,
  requireRoleSkillPublicId,
  roleSkillApiError,
  roleSkillAuthError,
  roleSkillJson,
} from "@/lib/role-skills/http";
import {
  deletePersonalRoleSkill,
  getPersonalRoleSkill,
  updatePersonalRoleSkill,
} from "@/lib/role-skills/repository";
import { deleteRoleSkillCoverIfUnreferenced } from "@/lib/role-skills/cover-storage";
import { getUserId } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { skillId: string } };

async function cleanupCover(coverUrl: string | null | undefined) {
  if (!coverUrl) return;
  await deleteRoleSkillCoverIfUnreferenced(coverUrl).catch((error) => {
    console.warn("[role-skill] failed to clean personal cover", error);
  });
}

export async function GET(req: Request, { params }: Context) {
  const authUserId = await getUserId(req);
  if (!authUserId) return roleSkillAuthError();

  try {
    assertNoForbiddenRoleSkillQuery(req);
    const publicId = requireRoleSkillPublicId(params.skillId, "personal");
    const skill = await getPersonalRoleSkill({ authUserId, publicId });
    return roleSkillJson({ success: true, skill });
  } catch (error) {
    return roleSkillApiError(error);
  }
}

export async function PATCH(req: Request, { params }: Context) {
  const authUserId = await getUserId(req);
  if (!authUserId) return roleSkillAuthError();

  try {
    assertNoForbiddenRoleSkillQuery(req);
    const publicId = requireRoleSkillPublicId(params.skillId, "personal");
    const body = await readRoleSkillJson(req);
    const previous = await getPersonalRoleSkill({ authUserId, publicId });
    const skill = await updatePersonalRoleSkill({
      authUserId,
      publicId,
      expectedRevision: requireExpectedRevision(body.expectedRevision),
      value: normalizePersonalRoleSkillValue(body),
    });
    if (previous.coverUrl && previous.coverUrl !== skill.coverUrl) {
      await cleanupCover(previous.coverUrl);
    }
    return roleSkillJson({ success: true, skill });
  } catch (error) {
    return roleSkillApiError(error);
  }
}

export async function DELETE(req: Request, { params }: Context) {
  const authUserId = await getUserId(req);
  if (!authUserId) return roleSkillAuthError();

  try {
    assertNoForbiddenRoleSkillQuery(req);
    const publicId = requireRoleSkillPublicId(params.skillId, "personal");
    const body = await readRoleSkillJson(req);
    const deleted = await deletePersonalRoleSkill({
      authUserId,
      publicId,
      expectedRevision: requireExpectedRevision(body.expectedRevision),
    });
    await cleanupCover(deleted.coverUrl);
    return roleSkillJson({ success: true });
  } catch (error) {
    return roleSkillApiError(error);
  }
}
