import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  releaseOwnedUnreferencedToolMedia,
  releaseToolMedia,
  uploadToolMedia,
} from "@/lib/tool-media/service";
import {
  TOOL_WORKSPACE_DRAFT_PAYLOAD_MAX_BYTES,
  ToolWorkspaceDraftError,
  type ToolWorkspaceMediaInput,
  type ToolWorkspaceMediaSlot,
  type ToolWorkspaceTool,
  getToolWorkspaceMediaLimit,
  normalizeToolWorkspaceTool,
} from "@/lib/tool-workspace-draft/contracts";

const db = prisma as any;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DRAFT_INCLUDE = {
  media: {
    include: { media: true },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  },
} as const;

function versionConflict() {
  return new ToolWorkspaceDraftError(
    "草稿已在其他页面更新，请刷新后重试",
    409,
    "TOOL_WORKSPACE_DRAFT_VERSION_CONFLICT",
  );
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function normalizeExpectedVersion(value: unknown) {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 0) {
    throw new ToolWorkspaceDraftError(
      "草稿版本无效",
      400,
      "TOOL_WORKSPACE_DRAFT_VERSION_INVALID",
    );
  }
  return version;
}

function normalizeUploadRequestKey(value: unknown) {
  const requestKey = String(value || "").trim().toLowerCase();
  if (!UUID_RE.test(requestKey)) {
    throw new ToolWorkspaceDraftError(
      "素材上传请求标识无效",
      400,
      "TOOL_WORKSPACE_UPLOAD_REQUEST_KEY_INVALID",
    );
  }
  return requestKey;
}

function normalizePayload(value: unknown, tool: ToolWorkspaceTool) {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ToolWorkspaceDraftError(
      "草稿内容不是有效 JSON",
      400,
      "TOOL_WORKSPACE_PAYLOAD_INVALID",
    );
  }
  if (!serialized || typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ToolWorkspaceDraftError(
      "草稿内容格式无效",
      400,
      "TOOL_WORKSPACE_PAYLOAD_INVALID",
    );
  }
  if (Buffer.byteLength(serialized, "utf8") > TOOL_WORKSPACE_DRAFT_PAYLOAD_MAX_BYTES) {
    throw new ToolWorkspaceDraftError(
      "草稿内容超过 64 KiB",
      413,
      "TOOL_WORKSPACE_PAYLOAD_TOO_LARGE",
    );
  }
  const payload = JSON.parse(serialized) as Record<string, unknown>;
  const schemaVersion = Number(payload.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new ToolWorkspaceDraftError(
      "草稿结构版本无效",
      400,
      "TOOL_WORKSPACE_PAYLOAD_INVALID",
    );
  }
  if (payload.tool !== tool || typeof payload.state !== "object" || payload.state === null || Array.isArray(payload.state)) {
    throw new ToolWorkspaceDraftError(
      "草稿内容与工具不匹配",
      400,
      "TOOL_WORKSPACE_PAYLOAD_INVALID",
    );
  }
  return { payload, schemaVersion };
}

function normalizeSlot(value: unknown): ToolWorkspaceMediaSlot | null {
  if (value === undefined || value === null || value === "") return null;
  if (value === "first" || value === "last") return value;
  throw new ToolWorkspaceDraftError(
    "素材位置无效",
    400,
    "TOOL_WORKSPACE_MEDIA_SLOT_INVALID",
  );
}

function normalizeMediaInputs(value: ToolWorkspaceMediaInput[], tool: ToolWorkspaceTool) {
  if (!Array.isArray(value)) {
    throw new ToolWorkspaceDraftError(
      "素材列表格式无效",
      400,
      "TOOL_WORKSPACE_MEDIA_INVALID",
    );
  }
  const mediaLimit = getToolWorkspaceMediaLimit(tool);
  if (mediaLimit !== null && value.length > mediaLimit) {
    throw new ToolWorkspaceDraftError(
      `单个分组最多上传 ${mediaLimit} 张图片`,
      400,
      "TOOL_WORKSPACE_MEDIA_LIMIT",
    );
  }
  const positions = new Set<number>();
  const slots = new Set<string>();
  const normalized = value.map((item) => {
    const mediaId = String(item?.mediaId || "").trim();
    const position = Number(item?.position);
    const slot = normalizeSlot(item?.slot);
    if (!UUID_RE.test(mediaId) || !Number.isInteger(position) || position < 0 || positions.has(position)) {
      throw new ToolWorkspaceDraftError(
        "素材列表格式无效",
        400,
        "TOOL_WORKSPACE_MEDIA_INVALID",
      );
    }
    if (tool !== "video" && slot !== null) {
      throw new ToolWorkspaceDraftError(
        "图片工具不支持首尾帧位置",
        400,
        "TOOL_WORKSPACE_MEDIA_SLOT_INVALID",
      );
    }
    if (slot && slots.has(slot)) {
      throw new ToolWorkspaceDraftError(
        "首尾帧位置不能重复",
        400,
        "TOOL_WORKSPACE_MEDIA_SLOT_INVALID",
      );
    }
    positions.add(position);
    if (slot) slots.add(slot);
    return { mediaId, position, slot };
  });
  return normalized.sort((a, b) => a.position - b.position);
}

async function assertOwnedMedia(tx: any, authUserId: number, media: Array<{ mediaId: string }>) {
  const mediaIds = Array.from(new Set(media.map((item) => item.mediaId)));
  if (!mediaIds.length) return;
  const ownedCount = await tx.mediaAsset.count({
    where: {
      id: { in: mediaIds },
      ownerUserId: authUserId,
      status: "ready",
      purgedAt: null,
    },
  });
  if (ownedCount !== mediaIds.length) {
    throw new ToolWorkspaceDraftError(
      "素材不存在或无权使用",
      403,
      "TOOL_WORKSPACE_MEDIA_FORBIDDEN",
    );
  }
}

function serializeMediaRelation(row: any) {
  return {
    relationId: String(row.id),
    mediaId: row.mediaId,
    position: Number(row.position),
    slot: row.slot === "first" || row.slot === "last" ? row.slot : null,
    kind: row.media?.kind || null,
    status: row.media?.status || null,
    originalName: row.media?.originalName || null,
    mimeType: row.media?.declaredMime || null,
    sizeBytes: row.media?.sizeBytes === null || row.media?.sizeBytes === undefined
      ? null
      : Number(row.media.sizeBytes),
    localPreviewUrl: row.media?.originalKey || null,
    createdAt: row.media?.createdAt instanceof Date
      ? row.media.createdAt.toISOString()
      : String(row.media?.createdAt || row.createdAt || ""),
  };
}

function serializeDraft(row: any) {
  if (!row) return null;
  const media = Array.isArray(row.media)
    ? [...row.media]
        .sort((a, b) => Number(a.position) - Number(b.position) || Number(a.id - b.id))
        .map(serializeMediaRelation)
    : [];
  return {
    id: row.id,
    tool: row.tool as ToolWorkspaceTool,
    schemaVersion: Number(row.schemaVersion),
    payload: row.payload,
    version: Number(row.version),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    media,
  };
}

async function releaseDetachedMedia(input: {
  authUserId: number;
  mediaIds: string[];
}) {
  const mediaIds = Array.from(new Set(input.mediaIds.filter(Boolean)));
  if (!mediaIds.length) return 0;
  const released = await releaseOwnedUnreferencedToolMedia({
    ownerUserId: input.authUserId,
    mediaIds,
  });
  return Number(released.releasedCount || 0);
}

export async function getToolWorkspaceDraft(input: {
  authUserId: number;
  tool: ToolWorkspaceTool | string;
}) {
  const tool = normalizeToolWorkspaceTool(input.tool);
  const row = await db.toolWorkspaceDraft.findUnique({
    where: { authUserId_tool: { authUserId: input.authUserId, tool } },
    include: DRAFT_INCLUDE,
  });
  return serializeDraft(row);
}

export async function saveToolWorkspaceDraft(input: {
  authUserId: number;
  tool: ToolWorkspaceTool | string;
  expectedVersion: number;
  payload: unknown;
  media?: ToolWorkspaceMediaInput[];
}) {
  const tool = normalizeToolWorkspaceTool(input.tool);
  const expectedVersion = normalizeExpectedVersion(input.expectedVersion);
  const normalizedPayload = normalizePayload(input.payload, tool);
  const media = input.media === undefined ? undefined : normalizeMediaInputs(input.media, tool);
  let removedMediaIds: string[] = [];

  try {
    const row = await db.$transaction(async (tx: any) => {
      const existing = await tx.toolWorkspaceDraft.findUnique({
        where: { authUserId_tool: { authUserId: input.authUserId, tool } },
        include: DRAFT_INCLUDE,
      });

      if (expectedVersion === 0) {
        if (existing) throw versionConflict();
        if (media) await assertOwnedMedia(tx, input.authUserId, media);
        const created = await tx.toolWorkspaceDraft.create({
          data: {
            authUserId: input.authUserId,
            tool,
            schemaVersion: normalizedPayload.schemaVersion,
            payload: normalizedPayload.payload,
            version: 1,
            ...(media?.length
              ? {
                  media: {
                    create: media.map((item) => ({
                      mediaId: item.mediaId,
                      position: item.position,
                      slot: item.slot,
                    })),
                  },
                }
              : {}),
          },
          include: DRAFT_INCLUDE,
        });
        if (media?.length) {
          await tx.mediaAsset.updateMany({
            where: { id: { in: Array.from(new Set(media.map((item) => item.mediaId))) }, ownerUserId: input.authUserId },
            data: { retentionUntil: null },
          });
        }
        return created;
      }

      if (!existing) throw versionConflict();
      if (media) await assertOwnedMedia(tx, input.authUserId, media);
      const updated = await tx.toolWorkspaceDraft.updateMany({
        where: {
          id: existing.id,
          authUserId: input.authUserId,
          version: expectedVersion,
        },
        data: {
          schemaVersion: normalizedPayload.schemaVersion,
          payload: normalizedPayload.payload,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw versionConflict();

      if (media) {
        const previous = await tx.toolWorkspaceDraftMedia.findMany({
          where: { draftId: existing.id },
          select: { mediaId: true },
        });
        await tx.toolWorkspaceDraftMedia.deleteMany({ where: { draftId: existing.id } });
        if (media.length) {
          await tx.toolWorkspaceDraftMedia.createMany({
            data: media.map((item) => ({
              draftId: existing.id,
              mediaId: item.mediaId,
              position: item.position,
              slot: item.slot,
            })),
          });
          await tx.mediaAsset.updateMany({
            where: { id: { in: Array.from(new Set(media.map((item) => item.mediaId))) }, ownerUserId: input.authUserId },
            data: { retentionUntil: null },
          });
        }
        const kept = new Set(media.map((item) => item.mediaId));
        removedMediaIds = previous.map((item: { mediaId: string }) => item.mediaId).filter((id: string) => !kept.has(id));
      }

      return tx.toolWorkspaceDraft.findUnique({
        where: { id: existing.id },
        include: DRAFT_INCLUDE,
      });
    });

    if (!row) throw versionConflict();
    await releaseDetachedMedia({
      authUserId: input.authUserId,
      mediaIds: removedMediaIds,
    });
    return serializeDraft(row)!;
  } catch (error) {
    if (isUniqueConstraintError(error)) throw versionConflict();
    throw error;
  }
}

async function getOrCreateToolWorkspaceDraft(authUserId: number, tool: ToolWorkspaceTool) {
  const existing = await db.toolWorkspaceDraft.findUnique({
    where: { authUserId_tool: { authUserId, tool } },
  });
  if (existing) return existing;
  try {
    return await db.toolWorkspaceDraft.create({
      data: {
        authUserId,
        tool,
        schemaVersion: 1,
        payload: { schemaVersion: 1, tool, state: {} },
        version: 1,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const concurrent = await db.toolWorkspaceDraft.findUnique({
      where: { authUserId_tool: { authUserId, tool } },
    });
    if (!concurrent) throw error;
    return concurrent;
  }
}

export async function uploadAndAttachToolWorkspaceMedia(input: {
  authUserId: number;
  tool: ToolWorkspaceTool | string;
  file: File;
  slot?: ToolWorkspaceMediaSlot | null;
  requestKey?: string;
}) {
  const tool = normalizeToolWorkspaceTool(input.tool);
  const slot = normalizeSlot(input.slot);
  const requestKey = input.requestKey ? normalizeUploadRequestKey(input.requestKey) : "";
  if (tool !== "video" && slot !== null) {
    throw new ToolWorkspaceDraftError(
      "图片工具不支持首尾帧位置",
      400,
      "TOOL_WORKSPACE_MEDIA_SLOT_INVALID",
    );
  }
  const draft = await getOrCreateToolWorkspaceDraft(input.authUserId, tool);
  const mediaLimit = getToolWorkspaceMediaLimit(tool);
  const uploaded = await uploadToolMedia({
    ownerUserId: input.authUserId,
    draftSessionId: draft.id,
    file: input.file,
    ...(requestKey ? { mediaId: requestKey } : {}),
  });

  try {
    const result = await db.$transaction(async (tx: any) => {
      await tx.$executeRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`tool-workspace-upload:${draft.id}`}, 0)
        )
      `);
      if (requestKey) {
        const existingRelation = await tx.toolWorkspaceDraftMedia.findFirst({
          where: { draftId: draft.id, mediaId: requestKey },
          include: {
            media: true,
            draft: { select: { version: true } },
          },
        });
        if (existingRelation) {
          if (normalizeSlot(existingRelation.slot) !== slot) {
            throw new ToolWorkspaceDraftError(
              "素材上传请求标识已用于其他素材位置",
              409,
              "TOOL_WORKSPACE_UPLOAD_REQUEST_KEY_CONFLICT",
            );
          }
          return {
            relation: existingRelation,
            version: Number(existingRelation.draft?.version ?? draft.version),
            replacedMediaIds: [] as string[],
          };
        }
      }
      if (mediaLimit !== null) {
        const currentCount = await tx.toolWorkspaceDraftMedia.count({
          where: { draftId: draft.id },
        });
        if (currentCount >= mediaLimit) {
          throw new ToolWorkspaceDraftError(
            `单个分组最多上传 ${mediaLimit} 张图片`,
            400,
            "TOOL_WORKSPACE_MEDIA_LIMIT",
          );
        }
      }
      const replaced = slot
        ? await tx.toolWorkspaceDraftMedia.findMany({
            where: { draftId: draft.id, slot },
            select: { id: true, mediaId: true, position: true },
          })
        : [];
      const last = await tx.toolWorkspaceDraftMedia.findFirst({
        where: { draftId: draft.id },
        orderBy: [{ position: "desc" }, { id: "desc" }],
        select: { position: true },
      });
      const position = replaced.length
        ? Math.min(...replaced.map((item: { position: number }) => Number(item.position)))
        : Number(last?.position ?? -1) + 1;
      if (replaced.length) {
        await tx.toolWorkspaceDraftMedia.deleteMany({
          where: { id: { in: replaced.map((item: { id: bigint }) => item.id) }, draftId: draft.id },
        });
      }
      const relation = await tx.toolWorkspaceDraftMedia.create({
        data: {
          draftId: draft.id,
          mediaId: uploaded.mediaId,
          position,
          slot,
        },
        include: { media: true },
      });
      await tx.mediaAsset.updateMany({
        where: { id: uploaded.mediaId, ownerUserId: input.authUserId },
        data: { retentionUntil: null },
      });
      const updated = await tx.toolWorkspaceDraft.update({
        where: { id: draft.id },
        data: { version: { increment: 1 } },
        select: { version: true },
      });
      return {
        relation,
        version: Number(updated.version),
        replacedMediaIds: replaced.map((item: { mediaId: string }) => item.mediaId),
      };
    });
    await releaseDetachedMedia({
      authUserId: input.authUserId,
      mediaIds: result.replacedMediaIds,
    });
    return {
      relation: serializeMediaRelation(result.relation),
      version: result.version,
    };
  } catch (error) {
    if (!requestKey) {
      await releaseToolMedia({
        ownerUserId: input.authUserId,
        draftSessionId: draft.id,
        mediaIds: [uploaded.mediaId],
      }).catch(() => null);
    }
    throw error;
  }
}

export async function getToolWorkspaceMediaUploadStatus(input: {
  authUserId: number;
  tool: ToolWorkspaceTool | string;
  requestKey: string;
}) {
  const tool = normalizeToolWorkspaceTool(input.tool);
  const requestKey = normalizeUploadRequestKey(input.requestKey);
  const draft = await db.toolWorkspaceDraft.findUnique({
    where: { authUserId_tool: { authUserId: input.authUserId, tool } },
    select: { id: true, version: true },
  });
  if (!draft) return { uploadState: "pending" as const };

  const relation = await db.toolWorkspaceDraftMedia.findFirst({
    where: { draftId: draft.id, mediaId: requestKey },
    include: { media: true },
  });
  if (relation?.media?.status === "ready") {
    return {
      uploadState: "ready" as const,
      relation: serializeMediaRelation(relation),
      version: Number(draft.version),
    };
  }
  if (relation?.media?.status === "failed") {
    return {
      uploadState: "failed" as const,
      error: "素材上传未完成，请重试",
    };
  }

  const asset = await db.mediaAsset.findFirst({
    where: {
      id: requestKey,
      ownerUserId: input.authUserId,
      purgedAt: null,
      AND: [
        { metadata: { path: ["origin"], equals: "tool_input" } },
        { metadata: { path: ["draftSessionId"], equals: draft.id } },
      ],
    },
    select: { status: true },
  });
  if (asset?.status === "failed") {
    return {
      uploadState: "failed" as const,
      error: "素材上传未完成，请重试",
    };
  }
  return { uploadState: "pending" as const };
}

export async function detachToolWorkspaceMedia(input: {
  authUserId: number;
  tool: ToolWorkspaceTool | string;
  relationId: bigint;
}) {
  const tool = normalizeToolWorkspaceTool(input.tool);
  const relation = await db.toolWorkspaceDraftMedia.findFirst({
    where: {
      id: input.relationId,
      draft: { authUserId: input.authUserId, tool },
    },
    include: { draft: true },
  });
  if (!relation) {
    throw new ToolWorkspaceDraftError(
      "素材不存在",
      404,
      "TOOL_WORKSPACE_MEDIA_NOT_FOUND",
    );
  }
  const version = await db.$transaction(async (tx: any) => {
    await tx.toolWorkspaceDraftMedia.deleteMany({
      where: { id: relation.id, draftId: relation.draftId },
    });
    const updated = await tx.toolWorkspaceDraft.update({
      where: { id: relation.draftId },
      data: { version: { increment: 1 } },
      select: { version: true },
    });
    return Number(updated.version);
  });
  const releasedCount = await releaseDetachedMedia({
    authUserId: input.authUserId,
    mediaIds: [relation.mediaId],
  });
  return { detached: true, released: releasedCount > 0, version };
}
