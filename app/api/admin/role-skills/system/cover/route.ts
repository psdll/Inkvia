import type { NextRequest } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import {
  deleteRoleSkillCoverIfUnreferenced,
  requireSystemRoleSkillCoverUrl,
  ROLE_SKILL_COVER_MAX_BYTES,
  RoleSkillCoverError,
  saveRoleSkillCover,
} from "@/lib/role-skills/cover-storage";
import {
  readRoleSkillJson,
  roleSkillApiError,
  roleSkillError,
  roleSkillJson,
} from "@/lib/role-skills/http";
import { assertRequestContentLengthUnderLimit } from "@/lib/upload-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isFileLike(value: unknown): value is File {
  const file = value as File | null;
  return Boolean(
    file
    && typeof file.name === "string"
    && typeof file.type === "string"
    && typeof file.size === "number"
    && file.size > 0
    && typeof file.arrayBuffer === "function"
    && typeof file.slice === "function",
  );
}

function coverError(error: unknown) {
  if (error instanceof RoleSkillCoverError) {
    return roleSkillError("SKILL_COVER_INVALID", error.message, error.status);
  }
  return roleSkillApiError(error);
}

function requireAdmin(req: Request) {
  const auth = requireAdminRequest(req as NextRequest);
  if (!auth.ok) {
    return roleSkillError("ADMIN_AUTH_REQUIRED", auth.error, 401);
  }
  return null;
}

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    assertRequestContentLengthUnderLimit(req, ROLE_SKILL_COVER_MAX_BYTES + 1024 * 1024);
    const form = await req.formData();
    const entries = form.getAll("file");
    if (entries.length !== 1 || !isFileLike(entries[0])) {
      throw new RoleSkillCoverError("请选择一张有效的技能封面");
    }
    const coverUrl = await saveRoleSkillCover({ file: entries[0], scope: "system" });
    return roleSkillJson({ success: true, coverUrl }, 201);
  } catch (error) {
    return coverError(error);
  }
}

export async function DELETE(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const body = await readRoleSkillJson(req);
    const coverUrl = requireSystemRoleSkillCoverUrl(body.coverUrl);
    const result = await deleteRoleSkillCoverIfUnreferenced(coverUrl);
    return roleSkillJson({ success: true, ...result });
  } catch (error) {
    return coverError(error);
  }
}
