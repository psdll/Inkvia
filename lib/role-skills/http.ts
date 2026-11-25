import {
  parseRoleSkillPublicId,
  type PersonalRoleSkillInput,
  type RoleSkillInput,
  type RoleSkillMediaType,
  type RoleSkillSource,
  type RoleSkillWorkspace,
  type SystemRoleSkillInput,
} from "@/lib/role-skills/contracts";
import {
  RoleSkillRepositoryError,
} from "@/lib/role-skills/repository";

const FORBIDDEN_CLIENT_FIELDS = [
  "userId",
  "authUserId",
  "ownerUserId",
  "scope",
] as const;

export class RoleSkillRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoleSkillRequestError";
  }
}

export function roleSkillJson(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function roleSkillError(
  code: string,
  message: string,
  status: number,
): Response {
  return roleSkillJson({ success: false, code, error: message }, status);
}

export function roleSkillAuthError(message = "请先登录"): Response {
  return roleSkillError("AUTH_REQUIRED", message, 401);
}

export function roleSkillApiError(error: unknown): Response {
  if (error instanceof RoleSkillRequestError) {
    return roleSkillError("SKILL_INVALID", error.message, 400);
  }
  if (error instanceof RoleSkillRepositoryError) {
    const mapping = {
      invalid: [400, "SKILL_INVALID"],
      "not-found": [404, "SKILL_NOT_FOUND"],
      conflict: [409, "SKILL_REVISION_CONFLICT"],
      unavailable: [409, "SKILL_UNAVAILABLE"],
    } as const;
    const [status, code] = mapping[error.code];
    return roleSkillError(code, error.message, status);
  }
  return roleSkillError("SKILL_SERVICE_UNAVAILABLE", "技能服务暂时不可用", 500);
}

function findForbiddenField(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findForbiddenField(item);
      if (nested) return nested;
    }
    return undefined;
  }
  for (const [field, nestedValue] of Object.entries(value)) {
    if (
      FORBIDDEN_CLIENT_FIELDS.includes(
        field as (typeof FORBIDDEN_CLIENT_FIELDS)[number],
      )
    ) {
      return field;
    }
    const nested = findForbiddenField(nestedValue);
    if (nested) return nested;
  }
  return undefined;
}

function assertNoForbiddenFields(value: unknown): void {
  const forbidden = findForbiddenField(value);
  if (forbidden) {
    throw new RoleSkillRequestError(`不接受客户端字段 ${forbidden}`);
  }
}

export function assertNoForbiddenRoleSkillQuery(req: Request): void {
  const query = new URL(req.url).searchParams;
  const forbidden = FORBIDDEN_CLIENT_FIELDS.find((field) => query.has(field));
  if (forbidden) {
    throw new RoleSkillRequestError(`不接受客户端字段 ${forbidden}`);
  }
}

export async function readRoleSkillJson(
  req: Request,
): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await req.json();
  } catch {
    throw new RoleSkillRequestError("请求 JSON 格式无效");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RoleSkillRequestError("请求正文必须是 JSON 对象");
  }
  assertNoForbiddenFields(value);
  return value as Record<string, unknown>;
}

export async function readOptionalRoleSkillJson(
  req: Request,
): Promise<Record<string, unknown>> {
  if (req.body === null) return {};
  return readRoleSkillJson(req);
}

export function normalizeRoleSkillValue(
  body: Record<string, unknown>,
): RoleSkillInput {
  if (body.coverUrl !== undefined && body.coverUrl !== null && typeof body.coverUrl !== "string") {
    throw new RoleSkillRequestError("技能封面地址无效");
  }
  const coverUrl = typeof body.coverUrl === "string" ? body.coverUrl.trim() : "";
  return {
    name: body.name as string,
    summary: body.summary as string,
    category: body.category as string,
    coverUrl: coverUrl || null,
    content: body.content as string,
    usageScenario: body.usageScenario as string,
    usageGuide: body.usageGuide as string,
    workspace: body.workspace as RoleSkillWorkspace,
  };
}

export function normalizeSystemRoleSkillValue(
  body: Record<string, unknown>,
): SystemRoleSkillInput {
  return {
    ...normalizeRoleSkillValue(body),
    mediaType: body.mediaType as RoleSkillMediaType,
  };
}

export function normalizePersonalRoleSkillValue(
  body: Record<string, unknown>,
): PersonalRoleSkillInput {
  return {
    ...normalizeRoleSkillValue(body),
    mediaType: body.mediaType as RoleSkillMediaType,
  };
}

export function requireExpectedRevision(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new RoleSkillRequestError("expectedRevision 必须是正整数");
  }
  return Number(value);
}

export function requireRoleSkillPublicId(
  value: string,
  expectedSource?: RoleSkillSource,
): string {
  try {
    const parsed = parseRoleSkillPublicId(value);
    if (expectedSource && parsed.source !== expectedSource) {
      throw new Error(`技能 ID 必须属于 ${expectedSource}`);
    }
    return value;
  } catch (error) {
    throw new RoleSkillRequestError(
      error instanceof Error ? error.message : "技能 ID 无效",
    );
  }
}
