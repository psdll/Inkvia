import type { NextRequest } from "next/server";
import { logAdminAction } from "@/lib/admin-audit";
import { requireAdminRequest } from "@/lib/admin-auth";
import type { RoleSkillStatus } from "@/lib/role-skills/contracts";
import { deleteRoleSkillCoverIfUnreferenced } from "@/lib/role-skills/cover-storage";
import { normalizeRoleSkillFeatureKeys } from "@/lib/role-skills/features";
import {
  getRoleSkillFeatureKeysForSkill,
  saveRoleSkillFeatureBindings,
} from "@/lib/role-skills/feature-bindings";
import {
  assertNoForbiddenRoleSkillQuery,
  normalizeSystemRoleSkillValue,
  readRoleSkillJson,
  requireExpectedRevision,
  requireRoleSkillPublicId,
  roleSkillApiError,
  roleSkillError,
  roleSkillJson,
} from "@/lib/role-skills/http";
import {
  deleteSystemRoleSkill,
  getSystemRoleSkillForAdmin,
  updateSystemRoleSkill,
} from "@/lib/role-skills/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: { skillId: string } };

async function cleanupCover(coverUrl: string | null | undefined) {
  if (!coverUrl) return;
  await deleteRoleSkillCoverIfUnreferenced(coverUrl).catch((error) => {
    console.warn("[role-skill] failed to clean system cover", error);
  });
}

function requireAdmin(req: Request) {
  const auth = requireAdminRequest(req as NextRequest);
  if (!auth.ok) {
    return {
      ok: false as const,
      response: roleSkillError("ADMIN_AUTH_REQUIRED", auth.error, 401),
    };
  }
  return { ok: true as const, username: auth.username };
}

export async function GET(req: Request, { params }: Context) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    assertNoForbiddenRoleSkillQuery(req);
    const publicId = requireRoleSkillPublicId(params.skillId, "system");
    const detail = await getSystemRoleSkillForAdmin(publicId);
    const featureKeys = await getRoleSkillFeatureKeysForSkill(publicId);
    const skill = { ...detail, featureKeys };
    return roleSkillJson({ success: true, skill });
  } catch (error) {
    return roleSkillApiError(error);
  }
}

export async function PATCH(req: Request, { params }: Context) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    assertNoForbiddenRoleSkillQuery(req);
    const publicId = requireRoleSkillPublicId(params.skillId, "system");
    const body = await readRoleSkillJson(req);
    const previous = await getSystemRoleSkillForAdmin(publicId);
    const updated = await updateSystemRoleSkill({
      publicId,
      expectedRevision: requireExpectedRevision(body.expectedRevision),
      value: normalizeSystemRoleSkillValue(body),
      status: body.status as RoleSkillStatus,
    });
    const featureKeys = normalizeRoleSkillFeatureKeys(body.featureKeys);
    await saveRoleSkillFeatureBindings(publicId, featureKeys);
    const skill = { ...updated, featureKeys };
    if (previous.coverUrl && previous.coverUrl !== updated.coverUrl) {
      await cleanupCover(previous.coverUrl);
    }
    await logAdminAction({
      admin: auth.username,
      action: "role_skill_system_update",
      message: `更新系统技能 ${skill.name}`,
      level: "success",
      metadata: { skillId: skill.id, revision: skill.revision, status: skill.status },
      req,
    });
    return roleSkillJson({ success: true, skill });
  } catch (error) {
    return roleSkillApiError(error);
  }
}

export async function DELETE(req: Request, { params }: Context) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    assertNoForbiddenRoleSkillQuery(req);
    const publicId = requireRoleSkillPublicId(params.skillId, "system");
    const body = await readRoleSkillJson(req);
    const skill = await deleteSystemRoleSkill({
      publicId,
      expectedRevision: requireExpectedRevision(body.expectedRevision),
    });
    await logAdminAction({
      admin: auth.username,
      action: "role_skill_system_delete",
      message: `删除系统技能 ${skill.name}`,
      level: "warning",
      metadata: { skillId: skill.id, revision: skill.revision, status: skill.status },
      req,
    });
    return roleSkillJson({ success: true, skill });
  } catch (error) {
    return roleSkillApiError(error);
  }
}
