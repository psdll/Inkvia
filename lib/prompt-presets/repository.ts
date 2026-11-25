import type { BuiltinPromptPreset, PromptPreset } from "@prisma/client";

import prisma from "@/lib/prisma";
import {
  normalizePromptInput,
  parsePromptPublicId,
  toPromptPublicId,
  type PromptPresetDto,
  type PromptPresetInput,
} from "@/lib/prompt-presets/contracts";

export type PromptPresetRepositoryErrorCode = "invalid" | "not-found" | "conflict";

export class PromptPresetRepositoryError extends Error {
  constructor(
    public readonly code: PromptPresetRepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PromptPresetRepositoryError";
  }
}

function invalid(message: string): PromptPresetRepositoryError {
  return new PromptPresetRepositoryError("invalid", message);
}

function notFound(): PromptPresetRepositoryError {
  return new PromptPresetRepositoryError("not-found", "提示词不存在");
}

function conflict(): PromptPresetRepositoryError {
  return new PromptPresetRepositoryError("conflict", "提示词已被其他操作修改");
}

function normalizeValue(value: PromptPresetInput): PromptPresetInput {
  try {
    return normalizePromptInput(value);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : "无效的提示词");
  }
}

function parsePublicId(publicId: string) {
  try {
    return parsePromptPublicId(publicId);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : "无效的提示词公开 ID");
  }
}

function assertExpectedRevision(expectedRevision: number): void {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw invalid("expectedRevision 必须是正整数");
  }
}

function toCustomDto(row: PromptPreset): PromptPresetDto {
  return {
    id: toPromptPublicId("custom", row.id),
    name: row.name,
    category: row.category,
    content: row.content,
    source: "custom",
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toBuiltinDto(row: BuiltinPromptPreset): PromptPresetDto {
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

function comparePromptDtos(left: PromptPresetDto, right: PromptPresetDto): number {
  const updatedAtDifference = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  return updatedAtDifference || left.id.localeCompare(right.id);
}

export async function listEffectivePromptPresets(input: {
  authUserId: number;
}): Promise<PromptPresetDto[]> {
  const [customs, builtins] = await Promise.all([
    prisma.promptPreset.findMany({
      where: {
        authUserId: input.authUserId,
        deletedAt: null,
      },
    }),
    prisma.builtinPromptPreset.findMany({
      where: {
        deletedAt: null,
        deletions: {
          none: {
            authUserId: input.authUserId,
          },
        },
      },
    }),
  ]);

  return [
    ...customs.map(toCustomDto),
    ...builtins.map(toBuiltinDto),
  ].sort(comparePromptDtos);
}

export async function createCustomPrompt(input: {
  authUserId: number;
  value: PromptPresetInput;
}): Promise<PromptPresetDto> {
  const value = normalizeValue(input.value);
  const created = await prisma.promptPreset.create({
    data: {
      authUserId: input.authUserId,
      ...value,
    },
  });
  return toCustomDto(created);
}

export async function updatePromptForUser(input: {
  authUserId: number;
  publicId: string;
  expectedRevision: number;
  value: PromptPresetInput;
}): Promise<PromptPresetDto> {
  assertExpectedRevision(input.expectedRevision);
  const { source, id } = parsePublicId(input.publicId);
  const value = normalizeValue(input.value);

  if (source === "builtin") {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "BuiltinPromptPreset"
        WHERE "id" = ${id}
        FOR UPDATE
      `;
      const builtin = await tx.builtinPromptPreset.findFirst({
        where: {
          id,
          deletedAt: null,
        },
      });
      if (!builtin) throw notFound();
      if (builtin.revision !== input.expectedRevision) throw conflict();

      const custom = await tx.promptPreset.create({
        data: {
          authUserId: input.authUserId,
          ...value,
        },
      });
      await tx.userBuiltinPromptDeletion.upsert({
        where: {
          authUserId_builtinPromptPresetId: {
            authUserId: input.authUserId,
            builtinPromptPresetId: builtin.id,
          },
        },
        create: {
          authUserId: input.authUserId,
          builtinPromptPresetId: builtin.id,
        },
        update: {},
      });

      return toCustomDto(custom);
    });
  }

  const [updated] = await prisma.promptPreset.updateManyAndReturn({
    where: {
      id,
      authUserId: input.authUserId,
      deletedAt: null,
      revision: input.expectedRevision,
    },
    data: {
      ...value,
      revision: {
        increment: 1,
      },
    },
  });
  if (updated) return toCustomDto(updated);

  const existing = await prisma.promptPreset.findFirst({
    where: {
      id,
      authUserId: input.authUserId,
      deletedAt: null,
    },
  });
  if (!existing) throw notFound();
  throw conflict();
}

export async function deletePromptForUser(input: {
  authUserId: number;
  publicId: string;
  expectedRevision?: number;
}): Promise<void> {
  const { source, id } = parsePublicId(input.publicId);

  if (source === "builtin") {
    if (input.expectedRevision !== undefined) {
      assertExpectedRevision(input.expectedRevision);
    }

    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id"
        FROM "BuiltinPromptPreset"
        WHERE "id" = ${id}
        FOR UPDATE
      `;
      const builtin = await tx.builtinPromptPreset.findFirst({
        where: {
          id,
          deletedAt: null,
        },
      });
      if (!builtin) throw notFound();
      if (
        input.expectedRevision !== undefined
        && builtin.revision !== input.expectedRevision
      ) {
        throw conflict();
      }

      await tx.userBuiltinPromptDeletion.upsert({
        where: {
          authUserId_builtinPromptPresetId: {
            authUserId: input.authUserId,
            builtinPromptPresetId: builtin.id,
          },
        },
        create: {
          authUserId: input.authUserId,
          builtinPromptPresetId: builtin.id,
        },
        update: {},
      });
    });
  }

  if (input.expectedRevision === undefined) {
    throw invalid("删除自定义提示词需要 expectedRevision");
  }
  assertExpectedRevision(input.expectedRevision);

  const deleted = await prisma.promptPreset.updateManyAndReturn({
    where: {
      id,
      authUserId: input.authUserId,
      deletedAt: null,
      revision: input.expectedRevision,
    },
    data: {
      deletedAt: new Date(),
      revision: {
        increment: 1,
      },
    },
  });
  if (deleted.length === 1) return;

  const existing = await prisma.promptPreset.findFirst({
    where: {
      id,
      authUserId: input.authUserId,
      deletedAt: null,
    },
  });
  if (!existing) throw notFound();
  throw conflict();
}
