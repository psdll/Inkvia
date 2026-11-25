import {
  normalizePromptInput,
  parsePromptPublicId,
  type PromptPresetInput,
} from "@/lib/prompt-presets/contracts";
import { PromptPresetRepositoryError } from "@/lib/prompt-presets/repository";

const FORBIDDEN_CLIENT_FIELDS = ["userId", "authUserId", "scope"] as const;

export class PromptPresetRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptPresetRequestError";
  }
}

export function promptJson(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

export function promptError(message: string, status: number): Response {
  return promptJson({ error: message }, status);
}

export function promptApiError(error: unknown): Response {
  if (error instanceof PromptPresetRequestError) {
    return promptError(error.message, 400);
  }
  if (error instanceof PromptPresetRepositoryError) {
    const status = {
      invalid: 400,
      "not-found": 404,
      conflict: 409,
    }[error.code];
    return promptError(error.message, status);
  }
  return promptError("提示词服务暂时不可用", 500);
}

export function assertNoForbiddenPromptQuery(req: Request): void {
  const query = new URL(req.url).searchParams;
  const forbidden = FORBIDDEN_CLIENT_FIELDS.find((field) => query.has(field));
  if (forbidden) {
    throw new PromptPresetRequestError(`不接受客户端字段 ${forbidden}`);
  }
}

function findForbiddenPromptField(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findForbiddenPromptField(item);
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
    const nested = findForbiddenPromptField(nestedValue);
    if (nested) return nested;
  }
  return undefined;
}

export function assertNoForbiddenPromptFields(value: unknown): void {
  const forbidden = findForbiddenPromptField(value);
  if (forbidden) {
    throw new PromptPresetRequestError(`不接受客户端字段 ${forbidden}`);
  }
}

export async function readPromptJson(
  req: Request,
): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await req.json();
  } catch {
    throw new PromptPresetRequestError("请求 JSON 格式无效");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PromptPresetRequestError("请求正文必须是 JSON 对象");
  }
  const body = value as Record<string, unknown>;
  assertNoForbiddenPromptFields(body);
  return body;
}

export async function readOptionalPromptJson(
  req: Request,
): Promise<Record<string, unknown>> {
  if (req.body === null) return {};
  return readPromptJson(req);
}

export function normalizePromptValue(value: unknown): PromptPresetInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PromptPresetRequestError("value 必须是提示词对象");
  }
  try {
    return normalizePromptInput(value as PromptPresetInput);
  } catch (error) {
    throw new PromptPresetRequestError(
      error instanceof Error ? error.message : "提示词格式无效",
    );
  }
}

export function requireExpectedRevision(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new PromptPresetRequestError("expectedRevision 必须是正整数");
  }
  return Number(value);
}

export function optionalExpectedRevision(value: unknown): number | undefined {
  return value === undefined ? undefined : requireExpectedRevision(value);
}

export function requirePromptPublicId(value: string): string {
  try {
    parsePromptPublicId(value);
    return value;
  } catch (error) {
    throw new PromptPresetRequestError(
      error instanceof Error ? error.message : "无效的提示词公开 ID",
    );
  }
}
