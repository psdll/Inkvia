import type { NextRequest } from "next/server";
import { logAdminAction } from "@/lib/admin-audit";
import { requireAdminRequest } from "@/lib/admin-auth";
import type { RoleSkillStatus } from "@/lib/role-skills/contracts";
import { normalizeRoleSkillFeatureKeys } from "@/lib/role-skills/features";
import { saveRoleSkillFeatureBindings } from "@/lib/role-skills/feature-bindings";
import {
  assertNoForbiddenRoleSkillQuery,
  normalizeSystemRoleSkillValue,
  readRoleSkillJson,
  roleSkillApiError,
  roleSkillError,
  roleSkillJson,
} from "@/lib/role-skills/http";
import {
  createSystemRoleSkill,
  listSystemRoleSkillsForAdmin,
  purgeExpiredSystemRoleSkills,
} from "@/lib/role-skills/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(req: Request) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    assertNoForbiddenRoleSkillQuery(req);
    await purgeExpiredSystemRoleSkills({ limit: 100 });
    const includeDeleted = new URL(req.url).searchParams.get("includeDeleted") === "1";
    const skills = await listSystemRoleSkillsForAdmin({ includeDeleted });
    return roleSkillJson({ success: true, skills });
  } catch (error) {
    return roleSkillApiError(error);
  }
}

export async function POST(req: Request) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    assertNoForbiddenRoleSkillQuery(req);
    const body = await readRoleSkillJson(req);
    const created = await createSystemRoleSkill({
      value: normalizeSystemRoleSkillValue(body),
      status: body.status as RoleSkillStatus,
    });
    const featureKeys = normalizeRoleSkillFeatureKeys(body.featureKeys);
    await saveRoleSkillFeatureBindings(created.id, featureKeys);
    const skill = { ...created, featureKeys };
    await logAdminAction({
      admin: auth.username,
      action: "role_skill_system_create",
      message: `创建系统技能 ${skill.name}`,
      level: "success",
      metadata: { skillId: skill.id, revision: skill.revision, status: skill.status },
      req,
    });
    return roleSkillJson({ success: true, skill }, 201);
  } catch (error) {
    return roleSkillApiError(error);
  }
}
