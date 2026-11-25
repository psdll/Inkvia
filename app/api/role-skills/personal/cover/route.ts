import {
  deleteRoleSkillCoverIfUnreferenced,
  requirePersonalRoleSkillCoverUrl,
  ROLE_SKILL_COVER_MAX_BYTES,
  RoleSkillCoverError,
  saveRoleSkillCover,
} from "@/lib/role-skills/cover-storage";
import {
  readRoleSkillJson,
  roleSkillApiError,
  roleSkillAuthError,
  roleSkillError,
  roleSkillJson,
} from "@/lib/role-skills/http";
import { getUserId } from "@/lib/server-auth";
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

export async function POST(req: Request) {
  const authUserId = await getUserId(req);
  if (!authUserId) return roleSkillAuthError();

  try {
    assertRequestContentLengthUnderLimit(req, ROLE_SKILL_COVER_MAX_BYTES + 1024 * 1024);
    const form = await req.formData();
    const entries = form.getAll("file");
    if (entries.length !== 1 || !isFileLike(entries[0])) {
      throw new RoleSkillCoverError("请选择一张有效的技能封面");
    }
    const coverUrl = await saveRoleSkillCover({
      file: entries[0],
      scope: "personal",
      authUserId,
    });
    return roleSkillJson({ success: true, coverUrl }, 201);
  } catch (error) {
    return coverError(error);
  }
}

export async function DELETE(req: Request) {
  const authUserId = await getUserId(req);
  if (!authUserId) return roleSkillAuthError();

  try {
    const body = await readRoleSkillJson(req);
    const coverUrl = requirePersonalRoleSkillCoverUrl(body.coverUrl, authUserId);
    const result = await deleteRoleSkillCoverIfUnreferenced(coverUrl);
    return roleSkillJson({ success: true, ...result });
  } catch (error) {
    return coverError(error);
  }
}
