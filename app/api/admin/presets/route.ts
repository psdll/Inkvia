import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { BuiltinPromptPreset } from "@prisma/client";
import prisma from "@/lib/prisma";
import { requireAdminRequest } from "@/lib/admin-auth";
import {
  normalizePromptInput,
  parsePromptPublicId,
  toPromptPublicId,
  type PromptPresetDto,
} from "@/lib/prompt-presets/contracts";
import {
  assertNoForbiddenPromptQuery,
  promptApiError,
  promptError,
  promptJson,
  readPromptJson,
  requireExpectedRevision,
} from "@/lib/prompt-presets/http";
import {
  PromptPresetRepositoryError,
} from "@/lib/prompt-presets/repository";
import { ensureLegacyBuiltinPromptsMigrated } from "@/lib/prompt-presets/migration";
import { ensureCanvasPromptSeeds } from "@/lib/prompt-presets/builtin-seeds";
import { preparePromptPresetRead } from "@/lib/prompt-presets/read-preparation";

export const runtime = "nodejs";

function requireAdmin(req: Request) {
  const auth = requireAdminRequest(req as NextRequest);
  if (!auth.ok) return promptError(auth.error, 401);
  return null;
}

function invalid(message: string): never {
  throw new PromptPresetRepositoryError("invalid", message);
}

function parseBuiltinId(value: unknown) {
  if (typeof value !== "string") invalid("presetId 必须是公开内置 ID");
  try {
    const parsed = parsePromptPublicId(value);
    if (parsed.source !== "builtin") invalid("presetId 必须是公开内置 ID");
    return parsed.id;
  } catch (error) {
    invalid(error instanceof Error ? error.message : "presetId 无效");
  }
}

function normalizeBuiltinValue(body: Record<string, unknown>) {
  try {
    return normalizePromptInput({
      name: body.name as string,
      category: body.category as string,
      content: body.content as string,
    });
  } catch (error) {
    invalid(error instanceof Error ? error.message : "内置提示词无效");
  }
}

function toDto(row: BuiltinPromptPreset): PromptPresetDto {
  return {
    id: toPromptPublicId("builtin", row.id),
    name: row.name,
    category: row.category,
    content: row.content,
    source: "builtin",
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function findFailure(id: bigint): Promise<never> {
  const existing = await prisma.builtinPromptPreset.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!existing) {
    throw new PromptPresetRepositoryError("not-found", "内置提示词不存在");
  }
  throw new PromptPresetRepositoryError(
    "conflict",
    "内置提示词已被其他操作修改",
  );
}

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    assertNoForbiddenPromptQuery(req);
    await preparePromptPresetRead([
      {
        name: "legacy-builtin-migration",
        run: ensureLegacyBuiltinPromptsMigrated,
      },
      { name: "canvas-seeds", run: ensureCanvasPromptSeeds },
    ]);
    const rows = await prisma.builtinPromptPreset.findMany({
      where: { deletedAt: null },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    });
    return promptJson({ presets: rows.map(toDto) });
  } catch (error) {
    return promptApiError(error);
  }
}

export async function POST(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const body = await readPromptJson(req);
    const value = normalizeBuiltinValue(body);
    const created = await prisma.builtinPromptPreset.create({
      data: {
        key: `admin:${randomUUID()}`,
        ...value,
      },
    });
    return promptJson({ preset: toDto(created) }, 201);
  } catch (error) {
    return promptApiError(error);
  }
}

export async function PATCH(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const body = await readPromptJson(req);
    const id = parseBuiltinId(body.presetId);
    const expectedRevision = requireExpectedRevision(body.expectedRevision);
    const value = normalizeBuiltinValue(body);
    const [updated] = await prisma.builtinPromptPreset.updateManyAndReturn({
      where: {
        id,
        deletedAt: null,
        revision: expectedRevision,
      },
      data: {
        ...value,
        revision: { increment: 1 },
      },
    });
    if (!updated) return await findFailure(id);
    return promptJson({ preset: toDto(updated) });
  } catch (error) {
    return promptApiError(error);
  }
}

export async function DELETE(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  try {
    const body = await readPromptJson(req);
    const id = parseBuiltinId(body.presetId);
    const expectedRevision = requireExpectedRevision(body.expectedRevision);
    const [deleted] = await prisma.builtinPromptPreset.updateManyAndReturn({
      where: {
        id,
        deletedAt: null,
        revision: expectedRevision,
      },
      data: {
        deletedAt: new Date(),
        revision: { increment: 1 },
      },
    });
    if (!deleted) return await findFailure(id);
    return promptJson({ ok: true, preset: toDto(deleted) });
  } catch (error) {
    return promptApiError(error);
  }
}
