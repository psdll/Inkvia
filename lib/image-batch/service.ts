import { isSeedream55Model } from "@/lib/volcengine-seedream-55";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  IMAGE_BATCH_LIMITS,
  isGroupedImageBatchMode,
  splitBatchPrompts,
} from "@/lib/image-batch/contracts";
import { validateBatchGroupDownloadName } from "@/lib/image-batch/group-download-name";
import {
  PromptSegmentParseError,
  parsePromptSegmentsV1,
} from "@/lib/image-batch/prompt-segments";
import { releaseToolMedia, uploadToolMedia } from "@/lib/tool-media/service";
import { toolMediaRetentionDeadline } from "@/lib/tool-media/lifecycle";
import { pruneImageBatchOrphanedSuccessItems } from "@/lib/generation-deletion";
import {
  BatchProductLibraryError,
  importBatchProductLibrarySnapshot,
  releaseBatchWorkspaceReference,
} from "@/lib/batch-product-library/service";
import {
  BATCH_UPLOAD_CONCURRENCY,
  mapWithConcurrency,
} from "@/lib/batch-upload/concurrency";
import { generationSkillMetadata } from "@/lib/generation/skill-metadata";

const db = prisma as any;
const BATCH_MODES = new Set(["style_replication", "multi_prompt"]);
const MEDIA_ROLES = new Set(["product", "reference", "additional_reference"]);
const ACTIVE_BATCH_STATUSES = new Set([
  "queued",
  "submitting",
  "running",
  "waiting_provider",
  "processing",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ownedBatchInclude = {
  groups: {
    where: { hiddenAt: null },
    orderBy: { position: "asc" },
  },
  items: {
    where: {
      OR: [
        { groupId: null },
        { group: { hiddenAt: null } },
      ],
    },
    orderBy: { position: "asc" },
    include: {
      media: {
        orderBy: [{ role: "asc" }, { position: "asc" }],
        include: { media: true },
      },
      outputs: {
        orderBy: [{ slotIndex: "asc" }, { attempt: "desc" }],
        include: {
          generation: {
            select: {
              id: true,
              status: true,
              localPath: true,
              model: true,
              errorMsg: true,
              finishedAt: true,
              updatedAt: true,
            },
          },
        },
      },
    },
  },
  media: {
    orderBy: [{ role: "asc" }, { position: "asc" }],
    include: { media: true },
  },
} as const;

const historyGroupInclude = {
  batch: {
    select: {
      id: true,
      mode: true,
      status: true,
      sharedSettings: true,
      version: true,
      submittedAt: true,
      finishedAt: true,
      updatedAt: true,
    },
  },
  items: {
    orderBy: { position: "asc" },
    include: {
      media: {
        orderBy: [{ role: "asc" }, { position: "asc" }],
        include: { media: true },
      },
      outputs: {
        orderBy: [{ attempt: "desc" }],
        take: 1,
        include: {
          generation: {
            select: {
              id: true,
              status: true,
              localPath: true,
              model: true,
              errorMsg: true,
              finishedAt: true,
              updatedAt: true,
            },
          },
        },
      },
    },
  },
} as const;

async function nextImageBatchGroupSequence(tx: any, authUserId: number) {
  if (typeof tx.$executeRawUnsafe === "function") {
    await tx.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock($1::integer, $2::integer)",
      1229080391,
      authUserId,
    );
  }
  if (typeof tx.imageBatchGroup.aggregate !== "function") return 1;
  const [aggregate, legacyCount] = await Promise.all([
    tx.imageBatchGroup.aggregate({
      where: { authUserId },
      _max: { sequence: true },
    }),
    typeof tx.imageBatchGroup.count === "function"
      ? tx.imageBatchGroup.count({
          where: {
            authUserId: null,
            batch: { authUserId },
          },
        })
      : 0,
  ]);
  return Math.max(
    Number(aggregate?._max?.sequence || 0),
    Number(legacyCount || 0),
  ) + 1;
}

export class ImageBatchServiceError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "BATCH_INVALID") {
    super(message);
    this.name = "ImageBatchServiceError";
    this.status = status;
    this.code = code;
  }
}

function cleanName(value: unknown, fallback: string) {
  const name = String(value || "").trim() || fallback;
  if (name.length > IMAGE_BATCH_LIMITS.maxNameLength) {
    throw new ImageBatchServiceError("名称不能超过 120 个字符", 400, "BATCH_NAME_TOO_LONG");
  }
  return name;
}

function normalizeMode(value: unknown) {
  const mode = String(value || "style_replication").trim();
  if (!BATCH_MODES.has(mode)) {
    throw new ImageBatchServiceError("批次模式无效", 400, "BATCH_MODE_INVALID");
  }
  return mode;
}

function normalizeSettings(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function assertBatchEditable(batch: { status?: unknown }) {
  if (ACTIVE_BATCH_STATUSES.has(String(batch.status || "").toLowerCase())) {
    throw new ImageBatchServiceError(
      "批次正在执行，暂时不能修改",
      409,
      "BATCH_ALREADY_RUNNING",
    );
  }
}

export async function createImageBatch(input: {
  authUserId: number;
  name?: unknown;
  mode?: unknown;
  cloneFromBatchId?: unknown;
}) {
  const cloneFromBatchId = String(input.cloneFromBatchId || "").trim();
  return db.$transaction(async (tx: any) => {
    const source = cloneFromBatchId
      ? await tx.imageBatch.findFirst({
          where: {
            id: cloneFromBatchId,
            authUserId: input.authUserId,
            deletedAt: null,
          },
          include: {
            media: {
              where: { itemId: null },
              orderBy: [{ role: "asc" }, { position: "asc" }],
            },
          },
        })
      : null;
    const batch = await tx.imageBatch.create({
      data: {
        authUserId: input.authUserId,
        name: cleanName(input.name, "新建图片批次"),
        mode: normalizeMode(input.mode || source?.mode),
        status: "draft",
        sharedPrompt: String(source?.sharedPrompt || ""),
        sharedSettings: source?.sharedSettings || { schemaVersion: 1 },
        version: 1,
      },
    });
    if (source?.media?.length) {
      await tx.imageBatchMedia.createMany({
        data: source.media.map((relation: any) => ({
          batchId: batch.id,
          itemId: null,
          mediaId: relation.mediaId,
          role: relation.role,
          position: relation.position,
        })),
      });
    }
    return tx.imageBatch.findUnique({
      where: { id: batch.id },
      include: ownedBatchInclude,
    });
  });
}

export async function listImageBatches(authUserId: number) {
  return db.imageBatch.findMany({
    where: { authUserId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: {
      id: true,
      name: true,
      mode: true,
      status: true,
      version: true,
      submittedAt: true,
      finishedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { groups: true, items: true, outputs: true } },
    },
  });
}

export async function getOrCreateImageBatchTemplate(input: {
  authUserId: number;
  mode: unknown;
}) {
  const mode = normalizeMode(input.mode);
  return db.$transaction(async (tx: any) => {
    if (typeof tx.$executeRawUnsafe === "function") {
      await tx.$executeRawUnsafe(
        "SELECT pg_advisory_xact_lock($1::integer, $2::integer)",
        mode === "multi_prompt" ? 1229080393 : 1229080392,
        input.authUserId,
      );
    }
    const where = {
      authUserId: input.authUserId,
      mode,
      deletedAt: null,
      groups: { none: {} },
      items: { none: {} },
    };
    const existing = await tx.imageBatch.findFirst({
      where,
      orderBy: [
        { updatedAt: "desc" },
        { createdAt: "desc" },
      ],
      include: ownedBatchInclude,
    });
    if (existing) return existing;

    const created = await tx.imageBatch.create({
      data: {
        authUserId: input.authUserId,
        name: "新建图片批次",
        mode,
        status: "draft",
        sharedPrompt: "",
        sharedSettings: { schemaVersion: 1 },
        version: 1,
      },
    });
    return tx.imageBatch.findUnique({
      where: { id: created.id },
      include: ownedBatchInclude,
    });
  });
}

export async function getOwnedImageBatch(batchId: string, authUserId: number) {
  const batch = await db.imageBatch.findFirst({
    where: { id: batchId, authUserId, deletedAt: null },
    include: ownedBatchInclude,
  });
  if (!batch) {
    throw new ImageBatchServiceError("批次不存在", 404, "BATCH_NOT_FOUND");
  }
  return batch;
}

async function getEditableImageBatchSummary(batchId: string, authUserId: number) {
  const batch = await db.imageBatch.findFirst({
    where: { id: batchId, authUserId, deletedAt: null },
    select: { id: true, mode: true, status: true, version: true },
  });
  if (!batch) {
    throw new ImageBatchServiceError("批次不存在", 404, "BATCH_NOT_FOUND");
  }
  assertBatchEditable(batch);
  return batch;
}

export async function assertBatchMediaUploadCapacity(input: {
  authUserId: number;
  batchId: string;
  role: string;
  itemId?: string | null;
  fileCount: number;
}) {
  const batch = await getEditableImageBatchSummary(input.batchId, input.authUserId);
  if (
    !isGroupedImageBatchMode(batch.mode)
    || input.itemId
    || input.role !== "product"
  ) return batch;

  const productCount = await db.imageBatchMedia.count({
    where: { batchId: input.batchId, itemId: null, role: "product" },
  });
  if (productCount + input.fileCount > IMAGE_BATCH_LIMITS.maxStyleProductImages) {
    throw new ImageBatchServiceError(
      `统一参考批量复刻最多上传 ${IMAGE_BATCH_LIMITS.maxStyleProductImages} 张产品图`,
      400,
      "BATCH_PRODUCT_IMAGE_LIMIT",
    );
  }
  return batch;
}

type BatchItemChange = {
  op?: unknown;
  itemId?: unknown;
  patch?: Record<string, unknown> | null;
};

type BatchGroupChange = {
  groupId?: unknown;
  name?: unknown;
};

function hasActiveLatestItemOutput(item: {
  outputs?: Array<{ slotIndex?: unknown; attempt?: unknown; status?: unknown }>;
}) {
  const latestBySlot = new Map<string, { attempt: number; status: unknown }>();
  for (const output of item.outputs || []) {
    const slot = String(output.slotIndex ?? 0);
    const attempt = Number(output.attempt || 0);
    const current = latestBySlot.get(slot);
    if (!current || attempt > current.attempt) {
      latestBySlot.set(slot, { attempt, status: output.status });
    }
  }
  return Array.from(latestBySlot.values()).some((output) => (
    ACTIVE_BATCH_STATUSES.has(String(output.status || "").toLowerCase())
  ));
}

function isInactiveItemPromptUpdate(input: {
  batch: { status?: unknown; items?: Array<{
    id?: unknown;
    outputs?: Array<{ slotIndex?: unknown; attempt?: unknown; status?: unknown }>;
  }> };
  patch: Record<string, unknown>;
  itemChanges: BatchItemChange[];
}) {
  if (!ACTIVE_BATCH_STATUSES.has(String(input.batch.status || "").toLowerCase())) return false;
  if (Object.keys(input.patch).length || !input.itemChanges.length) return false;
  const items = new Map(
    (input.batch.items || []).map((item) => [String(item.id || ""), item]),
  );
  return input.itemChanges.every((change) => {
    if (String(change.op || "update") !== "update") return false;
    const patchKeys = Object.keys(change.patch || {});
    if (patchKeys.length !== 1 || patchKeys[0] !== "prompt") return false;
    const item = items.get(String(change.itemId || ""));
    return Boolean(item && !hasActiveLatestItemOutput(item));
  });
}

export async function updateImageBatchDraft(input: {
  authUserId: number;
  batchId: string;
  expectedVersion: number;
  batch?: Record<string, unknown> | null;
  itemChanges?: BatchItemChange[];
  groupChanges?: BatchGroupChange[];
}) {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new ImageBatchServiceError("expectedVersion 无效", 400, "BATCH_VERSION_INVALID");
  }
  const ownedBatch = await getOwnedImageBatch(input.batchId, input.authUserId);
  const patch = input.batch || {};
  const itemChanges = input.itemChanges || [];
  const groupChanges = input.groupChanges || [];
  const isGroupNameOnlyUpdate = Object.keys(patch).length === 0
    && itemChanges.length === 0
    && groupChanges.length > 0;
  const inactiveItemPromptUpdate = isInactiveItemPromptUpdate({
    batch: ownedBatch,
    patch,
    itemChanges,
  });
  if (!isGroupNameOnlyUpdate && !inactiveItemPromptUpdate) assertBatchEditable(ownedBatch);
  const data: Record<string, unknown> = { version: { increment: 1 } };
  const generationKeys = new Set(["prompt", "includeSharedPrompt", "overrides"]);
  const hasGenerationItemChanges = itemChanges.some((change) => {
    if (String(change.op || "update") === "delete") return true;
    return Object.keys(change.patch || {}).some((key) => generationKeys.has(key));
  });
  if (hasGenerationItemChanges && !inactiveItemPromptUpdate) {
    data.status = "draft";
    data.finishedAt = null;
  }
  if ("name" in patch) data.name = cleanName(patch.name, "未命名批次");
  if ("mode" in patch) data.mode = normalizeMode(patch.mode);
  if ("sharedPrompt" in patch) data.sharedPrompt = String(patch.sharedPrompt || "").trim();
  if ("sharedSettings" in patch) {
    data.sharedSettings = { schemaVersion: 1, ...normalizeSettings(patch.sharedSettings) };
  }

  return db.$transaction(async (tx: any) => {
    const updated = await tx.imageBatch.updateMany({
      where: {
        id: input.batchId,
        authUserId: input.authUserId,
        deletedAt: null,
        version: input.expectedVersion,
      },
      data,
    });
    if (!updated.count) {
      throw new ImageBatchServiceError(
        "批次已在其他页面更新，请刷新后重试",
        409,
        "BATCH_VERSION_CONFLICT",
      );
    }

    for (const change of itemChanges) {
      const itemId = String(change.itemId || "").trim();
      const op = String(change.op || "update").trim();
      if (!itemId) continue;
      if (op === "delete") {
        await tx.imageBatchItem.deleteMany({
          where: { id: itemId, batchId: input.batchId },
        });
        continue;
      }
      const itemPatch = change.patch || {};
      const itemData: Record<string, unknown> = {};
      const changesGenerationInput = Object.keys(itemPatch).some((key) => generationKeys.has(key));
      if ("name" in itemPatch) itemData.name = cleanName(itemPatch.name, "未命名任务");
      if ("prompt" in itemPatch) itemData.prompt = String(itemPatch.prompt || "").trim();
      if ("includeSharedPrompt" in itemPatch) itemData.includeSharedPrompt = Boolean(itemPatch.includeSharedPrompt);
      if ("overrides" in itemPatch) itemData.overrides = normalizeSettings(itemPatch.overrides);
      if (changesGenerationInput) itemData.status = "draft";
      if (Object.keys(itemData).length) {
        await tx.imageBatchItem.updateMany({
          where: { id: itemId, batchId: input.batchId },
          data: itemData,
        });
      }
    }

    for (const change of groupChanges) {
      const groupId = String(change.groupId || "").trim();
      if (!groupId) continue;
      const rawName = String(change.name ?? "");
      const groupNameError = validateBatchGroupDownloadName(rawName);
      if (groupNameError) {
        throw new ImageBatchServiceError(
          groupNameError,
          400,
          "BATCH_GROUP_NAME_INVALID",
        );
      }
      const name = rawName;
      if (groupId === "legacy") {
        const existing = await tx.imageBatchGroup.findFirst({
          where: { batchId: input.batchId, position: 0 },
          select: { id: true },
        });
        const sequence = existing
          ? null
          : await nextImageBatchGroupSequence(tx, input.authUserId);
        const group = existing || await tx.imageBatchGroup.create({
          data: {
            authUserId: input.authUserId,
            batchId: input.batchId,
            position: 0,
            sequence,
            name,
          },
          select: { id: true },
        });
        if (existing) {
          await tx.imageBatchGroup.updateMany({
            where: { id: group.id, batchId: input.batchId },
            data: { name },
          });
        }
        await tx.imageBatchItem.updateMany({
          where: { batchId: input.batchId, groupId: null },
          data: { groupId: group.id },
        });
        continue;
      }
      await tx.imageBatchGroup.updateMany({
        where: { id: groupId, batchId: input.batchId },
        data: { name },
      });
    }
    return { version: input.expectedVersion + 1 };
  });
}

export async function createBatchItems(input: {
  authUserId: number;
  batchId: string;
  items: Array<{ name?: unknown; prompt?: unknown; overrides?: unknown; outputCount?: unknown }>;
}) {
  assertBatchEditable(await getOwnedImageBatch(input.batchId, input.authUserId));
  const existingCount = await db.imageBatchItem.count({ where: { batchId: input.batchId } });
  if (existingCount + input.items.length > IMAGE_BATCH_LIMITS.maxItems) {
    throw new ImageBatchServiceError("每个批次最多 50 个任务", 400, "BATCH_ITEM_LIMIT");
  }
  const tail = await db.imageBatchItem.findMany({
    where: { batchId: input.batchId },
    orderBy: { position: "desc" },
    take: 1,
    select: { position: true },
  });
  const start = Number(tail[0]?.position ?? -1) + 1;
  await db.imageBatchItem.createMany({
    data: input.items.map((item, index) => ({
      batchId: input.batchId,
      position: start + index,
      name: cleanName(item.name, `任务 ${String(start + index + 1).padStart(2, "0")}`),
      prompt: String(item.prompt || "").trim(),
      includeSharedPrompt: true,
      overrides: normalizeSettings(item.overrides),
      outputCount: 1,
      status: "draft",
    })),
  });
  return getOwnedImageBatch(input.batchId, input.authUserId);
}

export async function createStyleReplicationGroups(input: {
  authUserId: number;
  batchId: string;
}) {
  await db.$transaction(async (tx: any) => {
    const batch = await tx.imageBatch.findFirst({
      where: {
        id: input.batchId,
        authUserId: input.authUserId,
        deletedAt: null,
      },
      include: {
        media: {
          where: { itemId: null },
          orderBy: [{ role: "asc" }, { position: "asc" }],
        },
        _count: { select: { items: true } },
      },
    });
    if (!batch) {
      throw new ImageBatchServiceError("批次不存在", 404, "BATCH_NOT_FOUND");
    }
    if (batch.mode !== "style_replication") {
      throw new ImageBatchServiceError(
        "当前模式不支持按产品图生成分组",
        400,
        "BATCH_GROUP_MODE_INVALID",
      );
    }
    assertBatchEditable(batch);

    const products = batch.media.filter((entry: any) => entry.role === "product");
    const references = batch.media.filter((entry: any) => entry.role === "reference");
    const taskProducts = products.length ? products : [null];
    const prompt = String(batch.sharedPrompt || "").trim();
    const settings = normalizeSettings(batch.sharedSettings);
    if (!prompt && !(isSeedream55Model(settings.model) && (settings.seedream55 as { layerDecomposition?: boolean })?.layerDecomposition)) {
      throw new ImageBatchServiceError("请填写统一提示词", 400, "BATCH_PROMPT_REQUIRED");
    }
    if (!String(settings.model || "").trim()) {
      throw new ImageBatchServiceError("请选择模型", 400, "BATCH_MODEL_REQUIRED");
    }
    const existingCount = Number(batch._count?.items || 0);
    if (existingCount + taskProducts.length > IMAGE_BATCH_LIMITS.maxItems) {
      throw new ImageBatchServiceError(
        `生成后将超过每批次 ${IMAGE_BATCH_LIMITS.maxItems} 个任务的上限`,
        400,
        "BATCH_ITEM_LIMIT",
      );
    }

    const tail = await tx.imageBatchItem.findMany({
      where: { batchId: input.batchId },
      orderBy: { position: "desc" },
      take: 1,
      select: { position: true },
    });
    const start = Number(tail[0]?.position ?? -1) + 1;
    const groupTail = await tx.imageBatchGroup.findMany({
      where: { batchId: input.batchId },
      orderBy: { position: "desc" },
      take: 1,
      select: { position: true },
    });
    const groupPosition = groupTail.length
      ? Number(groupTail[0].position) + 1
      : existingCount > 0
        ? 1
        : 0;
    const groupSequence = await nextImageBatchGroupSequence(tx, input.authUserId);
    const group = await tx.imageBatchGroup.create({
      data: {
        authUserId: input.authUserId,
        batchId: input.batchId,
        position: groupPosition,
        sequence: groupSequence,
        name: `分组#${groupSequence}`,
      },
      select: { id: true },
    });
    for (let index = 0; index < taskProducts.length; index += 1) {
      const position = start + index;
      const item = await tx.imageBatchItem.create({
        data: {
          batchId: input.batchId,
          groupId: group.id,
          position,
          name: `产品任务 ${String(position + 1).padStart(2, "0")}`,
          prompt,
          includeSharedPrompt: false,
          overrides: { schemaVersion: 1, ...settings },
          outputCount: 1,
          status: "draft",
        },
        select: { id: true },
      });
      const itemMedia = [
        ...(taskProducts[index]
          ? [{
              batchId: input.batchId,
              itemId: item.id,
              mediaId: taskProducts[index].mediaId,
              role: "product",
              position: 0,
            }]
          : []),
        ...references.map((reference: any, referenceIndex: number) => ({
          batchId: input.batchId,
          itemId: item.id,
          mediaId: reference.mediaId,
          role: "reference",
          position: referenceIndex,
        })),
      ];
      if (itemMedia.length) {
        await tx.imageBatchMedia.createMany({ data: itemMedia });
      }
    }
    await tx.imageBatch.update({
      where: { id: input.batchId },
      data: {
        status: "draft",
        finishedAt: null,
        version: { increment: 1 },
      },
    });
  });
  return getOwnedImageBatch(input.batchId, input.authUserId);
}

export async function createDetachedStyleReplicationGroup(input: {
  authUserId: number;
  templateBatchId: string;
  sharedPrompt?: unknown;
  sharedSettings?: unknown;
}) {
  return db.$transaction(async (tx: any) => {
    const template = await tx.imageBatch.findFirst({
      where: {
        id: input.templateBatchId,
        authUserId: input.authUserId,
        deletedAt: null,
      },
      include: {
        media: {
          where: { itemId: null },
          orderBy: [{ role: "asc" }, { position: "asc" }],
        },
      },
    });
    if (!template) {
      throw new ImageBatchServiceError("批次不存在", 404, "BATCH_NOT_FOUND");
    }
    if (template.mode !== "style_replication") {
      throw new ImageBatchServiceError(
        "当前模式不支持按产品图生成分组",
        400,
        "BATCH_GROUP_MODE_INVALID",
      );
    }
    assertBatchEditable(template);

    const products = template.media.filter((entry: any) => entry.role === "product");
    const references = template.media.filter((entry: any) => entry.role === "reference");
    const taskProducts = products.length ? products : [null];
    const prompt = String(
      input.sharedPrompt === undefined ? template.sharedPrompt : input.sharedPrompt,
    ).trim();
    const settings = normalizeSettings(
      input.sharedSettings === undefined ? template.sharedSettings : input.sharedSettings,
    );
    if (products.length > IMAGE_BATCH_LIMITS.maxStyleProductImages) {
      throw new ImageBatchServiceError(
        `每组最多 ${IMAGE_BATCH_LIMITS.maxStyleProductImages} 张产品图`,
        400,
        "BATCH_PRODUCT_LIMIT",
      );
    }
    if (!prompt && !(isSeedream55Model(settings.model) && (settings.seedream55 as { layerDecomposition?: boolean })?.layerDecomposition)) {
      throw new ImageBatchServiceError("请填写统一提示词", 400, "BATCH_PROMPT_REQUIRED");
    }
    if (!String(settings.model || "").trim()) {
      throw new ImageBatchServiceError("请选择模型", 400, "BATCH_MODEL_REQUIRED");
    }

    const sequence = await nextImageBatchGroupSequence(tx, input.authUserId);
    const name = `分组#${sequence}`;
    const historyBatch = await tx.imageBatch.create({
      data: {
        authUserId: input.authUserId,
        name,
        mode: "style_replication",
        status: "draft",
        sharedPrompt: prompt,
        sharedSettings: { schemaVersion: 1, ...settings },
        version: 1,
      },
      select: { id: true },
    });
    const group = await tx.imageBatchGroup.create({
      data: {
        authUserId: input.authUserId,
        batchId: historyBatch.id,
        position: 0,
        sequence,
        name,
      },
      select: { id: true },
    });
    const items = taskProducts.map((product: any, index: number) => ({
      id: randomUUID(),
      batchId: historyBatch.id,
      groupId: group.id,
      position: index,
      name: `产品任务 ${String(index + 1).padStart(2, "0")}`,
      prompt,
      includeSharedPrompt: false,
      overrides: { schemaVersion: 1, ...settings },
      outputCount: 1,
      status: "draft",
      product,
    }));
    await tx.imageBatchItem.createMany({
      data: items.map(({ product: _product, ...item }: any) => item),
    });
    const itemMedia = items.flatMap((item: any) => [
      ...(item.product
        ? [{
            batchId: historyBatch.id,
            itemId: item.id,
            mediaId: item.product.mediaId,
            role: "product",
            position: 0,
          }]
        : []),
      ...references.map((reference: any, referenceIndex: number) => ({
        batchId: historyBatch.id,
        itemId: item.id,
        mediaId: reference.mediaId,
        role: "reference",
        position: referenceIndex,
      })),
    ]);
    if (itemMedia.length) {
      await tx.imageBatchMedia.createMany({ data: itemMedia });
    }
    const templateUpdate = await tx.imageBatch.update({
      where: { id: template.id },
      data: {
        sharedPrompt: prompt,
        sharedSettings: { schemaVersion: 1, ...settings },
        version: { increment: 1 },
      },
      select: { version: true },
    });
    const createdGroup = await tx.imageBatchGroup.findUnique({
      where: { id: group.id },
      include: historyGroupInclude,
    });
    return {
      group: createdGroup,
      templateVersion: templateUpdate.version,
    };
  });
}

export async function createDetachedSegmentedPromptGroup(input: {
  authUserId: number;
  templateBatchId: string;
  requestKey?: unknown;
  sharedPrompt: unknown;
  sharedSettings: unknown;
  generatedPrompt: unknown;
  skill?: unknown;
  mediaSnapshots: unknown;
}) {
  const requestKey = String(input.requestKey || "").trim();
  if (requestKey && !UUID_PATTERN.test(requestKey)) {
    throw new ImageBatchServiceError(
      "续跑请求标识无效",
      400,
      "BATCH_REQUEST_KEY_INVALID",
    );
  }
  try {
    return await db.$transaction(async (tx: any) => {
      if (requestKey) {
        const existingGroup = await tx.imageBatchGroup.findFirst({
          where: {
            authUserId: input.authUserId,
            batchId: requestKey,
          },
          include: historyGroupInclude,
        });
        if (existingGroup) return { group: existingGroup };
      }
      const mediaSnapshots = Array.isArray(input.mediaSnapshots)
        ? input.mediaSnapshots.map((entry: any) => ({
            mediaId: String(entry?.mediaId || "").trim(),
            position: Number(entry?.position),
          })).sort((left, right) => left.position - right.position)
        : [];
      if (
        mediaSnapshots.length > IMAGE_BATCH_LIMITS.maxStyleProductImages
        || mediaSnapshots.some((entry, index) => (
          !entry.mediaId
          || !Number.isInteger(entry.position)
          || entry.position !== index
        ))
        || new Set(mediaSnapshots.map((entry) => entry.mediaId)).size !== mediaSnapshots.length
      ) {
        throw new ImageBatchServiceError(
          "素材快照无效，请重新生成",
          400,
          "BATCH_MEDIA_SNAPSHOT_INVALID",
        );
      }
      const template = await tx.imageBatch.findFirst({
        where: {
          id: input.templateBatchId,
          authUserId: input.authUserId,
          deletedAt: null,
        },
      });
      if (!template) {
        throw new ImageBatchServiceError("批次不存在", 404, "BATCH_NOT_FOUND");
      }
      if (template.mode !== "multi_prompt") {
        throw new ImageBatchServiceError(
          "当前模式不支持生成分段提示词",
          400,
          "BATCH_SEGMENTED_MODE_INVALID",
        );
      }
      assertBatchEditable(template);

      if (mediaSnapshots.length) {
        const mediaIds = mediaSnapshots.map((entry) => entry.mediaId);
        const assets = await tx.mediaAsset.findMany({
          where: {
            id: { in: mediaIds },
            ownerUserId: input.authUserId,
            purgedAt: null,
            status: { in: ["ready", "soft_deleted"] },
          },
          select: { id: true, status: true },
        });
        if (assets.length !== mediaSnapshots.length) {
          throw new ImageBatchServiceError(
            "素材快照无效，请重新生成",
            400,
            "BATCH_MEDIA_SNAPSHOT_INVALID",
          );
        }
        await tx.mediaAsset.updateMany({
          where: {
            id: { in: mediaIds },
            ownerUserId: input.authUserId,
            purgedAt: null,
            status: { in: ["ready", "soft_deleted"] },
          },
          data: {
            status: "ready",
            softDeletedAt: null,
            retentionUntil: null,
          },
        });
      }

      const segments = parsePromptSegmentsV1(input.generatedPrompt);
      const sharedPrompt = String(input.sharedPrompt || "").trim();
      const settings = normalizeSettings(input.sharedSettings);
      if (!String(settings.model || "").trim()) {
        throw new ImageBatchServiceError("请选择模型", 400, "BATCH_MODEL_REQUIRED");
      }

      const sequence = await nextImageBatchGroupSequence(tx, input.authUserId);
      const groupName = `分组#${sequence}`;
      const historyBatch = await tx.imageBatch.create({
        data: {
          ...(requestKey ? { id: requestKey } : {}),
          authUserId: input.authUserId,
          name: groupName,
          mode: "multi_prompt",
          status: "draft",
          sharedPrompt,
          sharedSettings: {
            schemaVersion: 1,
            ...settings,
            ...(sharedPrompt ? { skillUserPrompt: sharedPrompt } : {}),
            ...generationSkillMetadata(input.skill),
          },
          version: 1,
        },
        select: { id: true },
      });
      const group = await tx.imageBatchGroup.create({
        data: {
          authUserId: input.authUserId,
          batchId: historyBatch.id,
          position: 0,
          sequence,
          name: groupName,
        },
        select: { id: true },
      });
      const items = segments.map((segment, index) => ({
        id: randomUUID(),
        batchId: historyBatch.id,
        groupId: group.id,
        position: index,
        name: cleanName(segment.name, `提示词${segment.index}`),
        prompt: segment.prompt,
        includeSharedPrompt: false,
        overrides: { schemaVersion: 1, ...settings },
        outputCount: 1,
        status: "draft",
      }));
      await tx.imageBatchItem.createMany({ data: items });

      const itemMedia = items.flatMap((item) => mediaSnapshots.map(
        (snapshot) => ({
          batchId: historyBatch.id,
          itemId: item.id,
          mediaId: snapshot.mediaId,
          role: "product",
          position: snapshot.position,
        }),
      ));
      if (itemMedia.length) {
        await tx.imageBatchMedia.createMany({ data: itemMedia });
      }

      const createdGroup = await tx.imageBatchGroup.findUnique({
        where: { id: group.id },
        include: historyGroupInclude,
      });
      return {
        group: createdGroup,
      };
    });
  } catch (error) {
    if (requestKey && (error as { code?: unknown })?.code === "P2002") {
      const existingGroup = await db.imageBatchGroup.findFirst({
        where: {
          authUserId: input.authUserId,
          batchId: requestKey,
        },
        include: historyGroupInclude,
      });
      if (existingGroup) return { group: existingGroup };
    }
    if (error instanceof PromptSegmentParseError) {
      throw new ImageBatchServiceError(error.message, 400, error.code);
    }
    throw error;
  }
}

type ImageBatchGroupCursor = {
  createdAt: string;
  id: string;
};

function encodeImageBatchGroupCursor(group: { createdAt: Date; id: string }) {
  return Buffer.from(JSON.stringify({
    createdAt: group.createdAt.toISOString(),
    id: group.id,
  }), "utf8").toString("base64url");
}

function decodeImageBatchGroupCursor(value: unknown): ImageBatchGroupCursor | null {
  const encoded = String(value || "").trim();
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const createdAt = String(parsed?.createdAt || "");
    const id = String(parsed?.id || "");
    if (!id || !Number.isFinite(new Date(createdAt).getTime())) throw new Error("invalid");
    return { createdAt, id };
  } catch {
    throw new ImageBatchServiceError("历史记录游标无效", 400, "BATCH_HISTORY_CURSOR_INVALID");
  }
}

export async function listImageBatchGroups(input: {
  authUserId: number;
  mode?: unknown;
  cursor?: unknown;
  take?: unknown;
}) {
  const mode = normalizeMode(input.mode || "style_replication");
  const take = Math.max(1, Math.min(5, Number(input.take) || 2));
  const cursor = decodeImageBatchGroupCursor(input.cursor);
  const cursorDate = cursor ? new Date(cursor.createdAt) : null;
  const groups = await db.imageBatchGroup.findMany({
    where: {
      hiddenAt: null,
      batch: {
        authUserId: input.authUserId,
        deletedAt: null,
        mode,
      },
      AND: [
        {
          OR: [
            { authUserId: input.authUserId },
            { authUserId: null },
          ],
        },
        ...(cursor && cursorDate
          ? [{
            OR: [
              { createdAt: { lt: cursorDate } },
              { createdAt: cursorDate, id: { lt: cursor.id } },
            ],
          }]
          : []),
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    include: historyGroupInclude,
  });
  const hasMore = groups.length > take;
  const rawPage = hasMore ? groups.slice(0, take) : groups;
  const page = rawPage
    .map((group: any) => ({
      ...group,
      items: pruneImageBatchOrphanedSuccessItems(group.items || []),
    }))
    .filter((group: any) => group.items.length > 0);
  return {
    groups: page,
    hasMore,
    nextCursor: hasMore && rawPage.length
      ? encodeImageBatchGroupCursor(rawPage[rawPage.length - 1])
      : null,
  };
}

export async function listImageBatchGroupStatuses(input: {
  authUserId: number;
  batchIds?: unknown;
}) {
  const batchIds = Array.from(new Set(
    String(input.batchIds || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  )).slice(0, 20);
  if (!batchIds.length) return [];
  return db.imageBatchGroup.findMany({
    where: {
      batchId: { in: batchIds },
      hiddenAt: null,
      OR: [
        { authUserId: input.authUserId },
        { authUserId: null },
      ],
      batch: {
        authUserId: input.authUserId,
        deletedAt: null,
      },
    },
    select: {
      id: true,
      batchId: true,
      batch: {
        select: {
          status: true,
          version: true,
          submittedAt: true,
          finishedAt: true,
          updatedAt: true,
        },
      },
    },
  });
}

export async function getImageBatchGroupHistory(input: {
  authUserId: number;
  batchId: string;
  groupId: string;
}) {
  const group = await db.imageBatchGroup.findFirst({
    where: {
      id: input.groupId,
      batchId: input.batchId,
      hiddenAt: null,
      OR: [
        { authUserId: input.authUserId },
        { authUserId: null },
      ],
      batch: {
        authUserId: input.authUserId,
        deletedAt: null,
      },
    },
    include: historyGroupInclude,
  });
  if (!group) {
    throw new ImageBatchServiceError("分组不存在", 404, "BATCH_GROUP_NOT_FOUND");
  }
  return {
    ...group,
    items: pruneImageBatchOrphanedSuccessItems(group.items || []),
  };
}

export async function hideImageBatchGroup(input: {
  authUserId: number;
  batchId: string;
  groupId: string;
}) {
  return db.$transaction(async (tx: any) => {
    const group = await tx.imageBatchGroup.findFirst({
      where: {
        id: input.groupId,
        batchId: input.batchId,
        hiddenAt: null,
        OR: [
          { authUserId: input.authUserId },
          { authUserId: null },
        ],
        batch: { authUserId: input.authUserId, deletedAt: null },
      },
      include: { batch: { select: { status: true } } },
    });
    if (!group) {
      throw new ImageBatchServiceError("分组不存在", 404, "BATCH_GROUP_NOT_FOUND");
    }
    assertBatchEditable(group.batch);
    await tx.imageBatchGroup.update({
      where: { id: group.id },
      data: { hiddenAt: new Date() },
    });
    await tx.imageBatch.update({
      where: { id: group.batchId },
      data: { version: { increment: 1 } },
    });
    return { hidden: true };
  });
}

export async function applyBatchPrompts(input: {
  authUserId: number;
  batchId: string;
  prompts: unknown[];
}) {
  const prompts = input.prompts.map((prompt) => String(prompt || "").trim()).filter(Boolean);
  if (!prompts.length) {
    throw new ImageBatchServiceError("没有可创建的提示词", 400, "BATCH_PROMPTS_EMPTY");
  }
  return createBatchItems({
    authUserId: input.authUserId,
    batchId: input.batchId,
    items: prompts.map((prompt, index) => ({
      name: `提示词任务 ${String(index + 1).padStart(2, "0")}`,
      prompt,
    })),
  });
}

export function previewBatchPrompts(value: unknown) {
  const prompts = splitBatchPrompts(value);
  if (prompts.length > IMAGE_BATCH_LIMITS.maxItems) {
    throw new ImageBatchServiceError(
      `每次最多拆分 ${IMAGE_BATCH_LIMITS.maxItems} 个任务`,
      400,
      "BATCH_ITEM_LIMIT",
    );
  }
  return prompts;
}

export async function reorderBatchItems(input: {
  authUserId: number;
  batchId: string;
  itemIds: string[];
}) {
  assertBatchEditable(await getOwnedImageBatch(input.batchId, input.authUserId));
  const unique = Array.from(new Set(input.itemIds.map((id) => String(id || "").trim()).filter(Boolean)));
  await db.$transaction(
    unique.map((id, position) => db.imageBatchItem.updateMany({
      where: { id, batchId: input.batchId },
      data: { position },
    })),
  );
  return getOwnedImageBatch(input.batchId, input.authUserId);
}

function imageBatchWorkspaceSourceId(batchId: string) {
  return `image_batch:${batchId}`;
}

async function releaseImageBatchWorkspaceReference(
  tx: any,
  batchId: string,
  mediaId: string,
) {
  return releaseBatchWorkspaceReference(tx, {
    mediaId,
    sourceId: imageBatchWorkspaceSourceId(batchId),
    hasBusinessReference: async () => (await tx.imageBatchMedia.count({
      where: { batchId, mediaId },
    })) > 0,
  });
}

export async function importImageBatchProductLibraryMedia(input: {
  authUserId: number;
  batchId: string;
  productLibraryItemId: number;
  requestKey: string;
  itemId?: string | null;
  role: "product" | "reference";
}) {
  if (input.role !== "product" && input.role !== "reference") {
    throw new ImageBatchServiceError("素材角色无效", 400, "BATCH_MEDIA_ROLE_INVALID");
  }
  const batch = await getEditableImageBatchSummary(input.batchId, input.authUserId);
  if (input.itemId) {
    const item = await db.imageBatchItem.findFirst({
      where: { id: input.itemId, batchId: input.batchId },
      select: { id: true },
    });
    if (!item) throw new ImageBatchServiceError("任务不存在", 404, "BATCH_ITEM_NOT_FOUND");
  }
  try {
    const imported = await importBatchProductLibrarySnapshot({
      authUserId: input.authUserId,
      batchId: input.batchId,
      productLibraryItemId: input.productLibraryItemId,
      requestKey: input.requestKey,
      adapter: {
        modeKey: "image_batch",
        sourceId: imageBatchWorkspaceSourceId(input.batchId),
        hasBusinessReference: async (tx: any, mediaId: string) => (
          await tx.imageBatchMedia.count({
            where: { batchId: input.batchId, mediaId },
          })
        ) > 0,
        attach: async (tx: any, mediaId: string) => {
          const lockKey = `${input.batchId}:${input.itemId || "shared"}:${input.role}`;
          await tx.$queryRaw(Prisma.sql`
            SELECT pg_advisory_xact_lock(
              hashtext('image_batch_media'),
              hashtext(${lockKey})
            )::text
          `);
          const existing = await tx.imageBatchMedia.findFirst({
            where: {
              batchId: input.batchId,
              itemId: input.itemId || null,
              role: input.role,
              mediaId,
            },
            include: { media: true },
          });
          if (existing) {
            return {
              value: {
                relation: existing,
                version: batch.version,
                replacedMediaIds: [] as string[],
              },
              reused: true,
            };
          }
          if (isGroupedImageBatchMode(batch.mode) && !input.itemId && input.role === "product") {
            const productCount = await tx.imageBatchMedia.count({
              where: { batchId: input.batchId, itemId: null, role: "product" },
            });
            if (productCount >= IMAGE_BATCH_LIMITS.maxStyleProductImages) {
              throw new ImageBatchServiceError(
                `统一参考批量复刻最多上传 ${IMAGE_BATCH_LIMITS.maxStyleProductImages} 张产品图`,
                400,
                "BATCH_PRODUCT_IMAGE_LIMIT",
              );
            }
          }

          const replacesExistingProduct = input.role === "product"
            && Boolean(input.itemId)
            && batch.mode !== "multi_prompt";
          const replaced = replacesExistingProduct
            ? await tx.imageBatchMedia.findMany({
                where: {
                  batchId: input.batchId,
                  itemId: input.itemId || null,
                  role: "product",
                },
                select: { mediaId: true },
              })
            : [];
          if (replacesExistingProduct) {
            await tx.imageBatchMedia.deleteMany({
              where: {
                batchId: input.batchId,
                itemId: input.itemId || null,
                role: "product",
              },
            });
          }
          const lastRelation = await tx.imageBatchMedia.findFirst({
            where: {
              batchId: input.batchId,
              itemId: input.itemId || null,
              role: input.role,
            },
            orderBy: [{ position: "desc" }, { id: "desc" }],
            select: { position: true },
          });
          const created = await tx.imageBatchMedia.create({
            data: {
              batchId: input.batchId,
              itemId: input.itemId || null,
              mediaId,
              role: input.role,
              position: Number(lastRelation?.position ?? -1) + 1,
            },
            include: { media: true },
          });
          for (const replacedMediaId of Array.from(new Set<string>(
            replaced.map((relation: { mediaId: string }) => relation.mediaId),
          ))) {
            await releaseImageBatchWorkspaceReference(tx, input.batchId, replacedMediaId);
          }
          if (input.itemId) {
            await tx.imageBatchItem.update({
              where: { id: input.itemId },
              data: { status: "draft" },
            });
          }
          const updatedBatch = await tx.imageBatch.update({
            where: { id: input.batchId },
            data: input.itemId
              ? {
                  status: "draft",
                  finishedAt: null,
                  version: { increment: 1 },
                }
              : { version: { increment: 1 } },
            select: { version: true },
          });
          return {
            value: {
              relation: created,
              version: updatedBatch.version,
              replacedMediaIds: replaced.map((relation: { mediaId: string }) => relation.mediaId),
            },
            reused: false,
          };
        },
      },
    });
    await releaseBatchMediaIfUnreferenced(
      imported.value.replacedMediaIds,
      input.authUserId,
    );
    return {
      relation: imported.value.relation,
      version: imported.value.version,
    };
  } catch (error) {
    if (error instanceof BatchProductLibraryError) {
      throw new ImageBatchServiceError(error.message, error.status, error.code);
    }
    throw error;
  }
}

export async function uploadAndAttachBatchMediaFiles(input: {
  authUserId: number;
  batchId: string;
  draftSessionId: string;
  files: File[];
  itemId?: string | null;
  role: string;
}) {
  if (!input.files.length) {
    throw new ImageBatchServiceError("请选择图片", 400, "BATCH_MEDIA_FILE_REQUIRED");
  }
  if (!MEDIA_ROLES.has(input.role)) {
    throw new ImageBatchServiceError("素材角色无效", 400, "BATCH_MEDIA_ROLE_INVALID");
  }
  const batch = await assertBatchMediaUploadCapacity({
    authUserId: input.authUserId,
    batchId: input.batchId,
    role: input.role,
    itemId: input.itemId,
    fileCount: input.files.length,
  });
  if (input.itemId) {
    const item = await db.imageBatchItem.findFirst({
      where: { id: input.itemId, batchId: input.batchId },
      select: { id: true },
    });
    if (!item) throw new ImageBatchServiceError("任务不存在", 404, "BATCH_ITEM_NOT_FOUND");
  }
  const replacesExistingProduct = input.role === "product"
    && Boolean(input.itemId)
    && batch.mode !== "multi_prompt";
  if (replacesExistingProduct && input.files.length > 1) {
    throw new ImageBatchServiceError(
      "单个任务每次只能替换一张产品图",
      400,
      "BATCH_PRODUCT_REPLACEMENT_LIMIT",
    );
  }

  const completedMediaIds: string[] = [];
  let uploaded: Awaited<ReturnType<typeof uploadToolMedia>>[];
  try {
    uploaded = await mapWithConcurrency(
      input.files,
      BATCH_UPLOAD_CONCURRENCY,
      async (file) => {
        try {
          const result = await uploadToolMedia({
            ownerUserId: input.authUserId,
            draftSessionId: input.draftSessionId,
            file,
            storageProfile: "batch",
            metadata: { batchId: input.batchId },
          });
          completedMediaIds.push(result.mediaId);
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : "上传失败";
          throw new Error(`${file.name}：${message}`);
        }
      },
    );
  } catch (error) {
    if (completedMediaIds.length) {
      await releaseToolMedia({
        ownerUserId: input.authUserId,
        draftSessionId: input.draftSessionId,
        mediaIds: completedMediaIds,
      }).catch(() => null);
    }
    throw error;
  }

  let result: {
    created: any[];
    replaced: Array<{ mediaId: string }>;
    version: number;
  };
  try {
    result = await db.$transaction(async (tx: any) => {
      const lockKey = `${input.batchId}:${input.itemId || "shared"}:${input.role}`;
      await tx.$queryRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(
          hashtext('image_batch_media'),
          hashtext(${lockKey})
        )::text
      `);
      const replaced = replacesExistingProduct
        ? await tx.imageBatchMedia.findMany({
            where: { batchId: input.batchId, itemId: input.itemId || null, role: "product" },
            select: { mediaId: true },
          })
        : [];
      if (replacesExistingProduct) {
        await tx.imageBatchMedia.deleteMany({
          where: { batchId: input.batchId, itemId: input.itemId || null, role: "product" },
        });
      }
      const lastRelation = await tx.imageBatchMedia.findFirst({
        where: { batchId: input.batchId, itemId: input.itemId || null, role: input.role },
        orderBy: [{ position: "desc" }, { id: "desc" }],
        select: { position: true },
      });
      const position = Number(lastRelation?.position ?? -1) + 1;
      if (
        isGroupedImageBatchMode(batch.mode)
        && !input.itemId
        && input.role === "product"
        && position + uploaded.length > IMAGE_BATCH_LIMITS.maxStyleProductImages
      ) {
        throw new ImageBatchServiceError(
          `统一参考批量复刻最多上传 ${IMAGE_BATCH_LIMITS.maxStyleProductImages} 张产品图`,
          400,
          "BATCH_PRODUCT_IMAGE_LIMIT",
        );
      }
      const created = [];
      for (const [index, media] of uploaded.entries()) {
        created.push(await tx.imageBatchMedia.create({
          data: {
            batchId: input.batchId,
            itemId: input.itemId || null,
            mediaId: media.mediaId,
            role: input.role,
            position: position + index,
          },
          include: { media: true },
        }));
      }
      for (const replacedMediaId of Array.from(new Set<string>(
        replaced.map((relation: { mediaId: string }) => relation.mediaId),
      ))) {
        await releaseImageBatchWorkspaceReference(tx, input.batchId, replacedMediaId);
      }
      await tx.mediaAsset.updateMany({
        where: {
          id: { in: uploaded.map((media) => media.mediaId) },
          ownerUserId: input.authUserId,
        },
        data: { retentionUntil: null },
      });
      if (input.itemId) {
        await tx.imageBatchItem.update({
          where: { id: input.itemId },
          data: { status: "draft" },
        });
        const updatedBatch = await tx.imageBatch.update({
          where: { id: input.batchId },
          data: {
            status: "draft",
            finishedAt: null,
            version: { increment: 1 },
          },
          select: { version: true },
        });
        return { created, replaced, version: updatedBatch.version };
      }
      const updatedBatch = await tx.imageBatch.update({
        where: { id: input.batchId },
        data: { version: { increment: 1 } },
        select: { version: true },
      });
      return { created, replaced, version: updatedBatch.version };
    });
  } catch (error) {
    await releaseToolMedia({
      ownerUserId: input.authUserId,
      draftSessionId: input.draftSessionId,
      mediaIds: uploaded.map((media) => media.mediaId),
    }).catch(() => null);
    throw error;
  }
  await releaseBatchMediaIfUnreferenced(
    result.replaced.map((relation) => relation.mediaId),
    input.authUserId,
  );
  return { relations: result.created, version: result.version };
}

export async function uploadAndAttachBatchMedia(input: {
  authUserId: number;
  batchId: string;
  draftSessionId: string;
  file: File;
  itemId?: string | null;
  role: string;
}) {
  const result = await uploadAndAttachBatchMediaFiles({
    ...input,
    files: [input.file],
  });
  return { relation: result.relations[0], version: result.version };
}

async function releaseBatchMediaIfUnreferenced(mediaIds: string[], authUserId: number) {
  const uniqueMediaIds = Array.from(new Set(mediaIds.filter(Boolean)));
  if (!uniqueMediaIds.length) return 0;
  const now = new Date();
  const result = await db.mediaAsset.updateMany({
    where: {
      id: { in: uniqueMediaIds },
      ownerUserId: authUserId,
      status: "ready",
      purgedAt: null,
      batchMedia: { none: {} },
      liveVideoBatchItems: { none: {} },
      generationInputs: { none: {} },
      references: { none: {} },
      runOutputs: { none: {} },
      AND: [
        { metadata: { path: ["origin"], equals: "tool_input" } },
        { metadata: { path: ["workspace"], equals: "batch" } },
      ],
    },
    data: {
      status: "soft_deleted",
      softDeletedAt: now,
      retentionUntil: toolMediaRetentionDeadline("release", now),
      leaseOwner: null,
      leaseUntil: null,
    },
  });
  return Number(result.count || 0);
}

export async function detachBatchMedia(input: {
  authUserId: number;
  batchId: string;
  relationId: bigint;
}) {
  const relation = await db.imageBatchMedia.findFirst({
    where: {
      id: input.relationId,
      batchId: input.batchId,
      batch: { authUserId: input.authUserId, deletedAt: null },
    },
    include: {
      batch: { select: { status: true, version: true } },
    },
  });
  if (!relation) throw new ImageBatchServiceError("素材不存在", 404, "BATCH_MEDIA_NOT_FOUND");
  assertBatchEditable(relation.batch);

  const version = await db.$transaction(async (tx: any) => {
    await tx.imageBatchMedia.deleteMany({ where: { id: relation.id, batchId: input.batchId } });
    await releaseImageBatchWorkspaceReference(tx, input.batchId, relation.mediaId);
    if (relation.itemId) {
      await tx.imageBatchItem.update({
        where: { id: relation.itemId },
        data: { status: "draft" },
      });
    }
    const updatedBatch = await tx.imageBatch.update({
      where: { id: input.batchId },
      data: relation.itemId
        ? {
            status: "draft",
            finishedAt: null,
            version: { increment: 1 },
          }
        : { version: { increment: 1 } },
      select: { version: true },
    });
    return updatedBatch.version;
  });
  const releasedCount = await releaseBatchMediaIfUnreferenced(
    [relation.mediaId],
    input.authUserId,
  );
  return { detached: true, released: releasedCount > 0, version };
}

export async function detachSharedBatchMediaByRole(input: {
  authUserId: number;
  batchId: string;
  role: "product" | "reference";
}) {
  const batch = await getEditableImageBatchSummary(input.batchId, input.authUserId);
  const relations = await db.imageBatchMedia.findMany({
    where: {
      batchId: input.batchId,
      itemId: null,
      role: input.role,
      batch: { authUserId: input.authUserId, deletedAt: null },
    },
    select: { id: true, mediaId: true },
  });
  if (!relations.length) {
    return { detachedCount: 0, releasedCount: 0, version: batch.version };
  }

  const version = await db.$transaction(async (tx: any) => {
    await tx.imageBatchMedia.deleteMany({
      where: {
        id: { in: relations.map((relation: any) => relation.id) },
        batchId: input.batchId,
      },
    });
    for (const mediaId of Array.from(new Set<string>(
      relations.map((relation: { mediaId: string }) => relation.mediaId),
    ))) {
      await releaseImageBatchWorkspaceReference(tx, input.batchId, mediaId);
    }
    const updatedBatch = await tx.imageBatch.update({
      where: { id: input.batchId },
      data: { version: { increment: 1 } },
      select: { version: true },
    });
    return updatedBatch.version;
  });

  const releasedCount = await releaseBatchMediaIfUnreferenced(
    relations.map((relation: { mediaId: string }) => relation.mediaId),
    input.authUserId,
  );
  return { detachedCount: relations.length, releasedCount, version };
}

export async function softDeleteImageBatch(batchId: string, authUserId: number) {
  await getOwnedImageBatch(batchId, authUserId);
  const relations = await db.imageBatchMedia.findMany({
    where: { batchId },
    include: { media: true },
  });
  const now = new Date();
  await db.$transaction(async (tx: any) => {
    await tx.imageBatchMedia.deleteMany({ where: { batchId } });
    for (const mediaId of Array.from(new Set<string>(
      relations.map((relation: { mediaId: string }) => relation.mediaId),
    ))) {
      await releaseImageBatchWorkspaceReference(tx, batchId, mediaId);
    }
    await tx.imageBatch.updateMany({
      where: { id: batchId, authUserId, deletedAt: null },
      data: { deletedAt: now, status: "deleted" },
    });
  });
  for (const relation of relations) {
    const refs = await db.imageBatchMedia.count({ where: { mediaId: relation.mediaId } });
    const generationRefs = await db.generationInputMedia.count({ where: { mediaId: relation.mediaId } });
    const metadata = relation.media?.metadata as Record<string, unknown> | null;
    const draftSessionId = String(metadata?.draftSessionId || "").trim();
    if (!refs && !generationRefs && draftSessionId) {
      await releaseToolMedia({ ownerUserId: authUserId, draftSessionId, mediaIds: [relation.mediaId] });
    }
  }
  return { deleted: true };
}
