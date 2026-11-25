import { isSeedream55Model } from "@/lib/volcengine-seedream-55";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  IMAGE_BATCH_LIMITS,
  aggregateBatchStatus,
  combineBatchPrompt,
  mergeBatchSettings,
  normalizeImageBatchMode,
  type ImageBatchMode,
} from "@/lib/image-batch/contracts";
import { ImageBatchServiceError } from "@/lib/image-batch/service";
import { assertDurableWorkAdmission } from "@/lib/maintenance";
import {
  normalizeGenerationSkillSnapshot,
  type GenerationSkillSnapshot,
} from "@/lib/generation/skill-metadata";

const db = prisma as any;
const ACTIVE_RETRY_OUTPUT_STATUSES = new Set([
  "queued",
  "submitting",
  "waiting_provider",
  "running",
  "processing",
]);

export type BatchSnapshotMedia = {
  mediaId: string;
  role: string;
  itemId: string | null;
  position: number;
};

export type ImageBatchRequestSnapshot = {
  schemaVersion: 1;
  source: "batch";
  batchId: string;
  itemId: string;
  mode?: ImageBatchMode;
  prompt: string;
  userPrompt?: string;
  skill?: GenerationSkillSnapshot;
  model: string;
  aspectRatio?: string;
  resolution?: string;
  customSize?: string;
  quality?: string;
  gptImage25Mode?: string;
  background?: string;
  googleThinkingLevel?: string;
  googleSearchMode?: string;
  moderation?: string;
  outputFormat?: string;
  gifSize?: string;
  frameCount?: number;
  frameDurationMs?: number; seedream55?: import("@/lib/apimart-seedream-55").Seedream55Settings;
  outputCompression?: number;
  n?: number;
  seed?: number;
  enableWebSearch?: boolean;
  maskUrl?: string;
  seedreamOutputMode?: "single" | "group";
  seedreamOutputCount?: number;
  seedreamWebSearch?: boolean;
  toolMediaIds: string[];
  batchIndex: number;
  taskCount: number;
  batchSubmittedAt: string;
};

function settingsObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function selectedRoleMedia(
  media: BatchSnapshotMedia[],
  itemId: string,
  role: string,
) {
  const itemMedia = media.filter((entry) => entry.itemId === itemId && entry.role === role);
  const selected = itemMedia.length
    ? itemMedia
    : media.filter((entry) => entry.itemId === null && entry.role === role);
  return selected.sort((a, b) => a.position - b.position).map((entry) => entry.mediaId);
}

export function buildBatchRequestSnapshot(input: {
  batch: {
    id: string;
    mode?: unknown;
    sharedPrompt: unknown;
    sharedSettings: unknown;
  };
  item: {
    id: string;
    prompt: unknown;
    includeSharedPrompt: boolean;
    overrides: unknown;
  };
  media: BatchSnapshotMedia[];
  batchIndex: number;
  taskCount: number;
  batchSubmittedAt: string;
}): ImageBatchRequestSnapshot {
  const settings = mergeBatchSettings(
    settingsObject(input.batch.sharedSettings),
    settingsObject(input.item.overrides),
  );
  const model = String(settings.model || "").trim();
  const mode = normalizeImageBatchMode(input.batch.mode);
  const userPrompt = mode === "multi_prompt"
    ? String(settings.skillUserPrompt || "").trim()
    : "";
  const skill = mode === "multi_prompt"
    ? normalizeGenerationSkillSnapshot(settings.skill)
    : null;
  const toolMediaIds = [
    ...selectedRoleMedia(input.media, input.item.id, "reference"),
    ...selectedRoleMedia(input.media, input.item.id, "product"),
    ...selectedRoleMedia(input.media, input.item.id, "additional_reference"),
  ];
  return {
    schemaVersion: 1,
    source: "batch",
    batchId: input.batch.id,
    itemId: input.item.id,
    mode,
    prompt: combineBatchPrompt(
      input.batch.sharedPrompt,
      input.item.prompt,
      input.item.includeSharedPrompt,
    ),
    ...(userPrompt ? { userPrompt } : {}),
    ...(skill ? { skill } : {}),
    model,
    ...(settings.aspectRatio ? { aspectRatio: String(settings.aspectRatio) } : {}),
    ...(settings.resolution ? { resolution: String(settings.resolution) } : {}),
    ...(settings.customSize ? { customSize: String(settings.customSize) } : {}),
    ...(settings.quality ? { quality: String(settings.quality) } : {}),
    ...(settings.gptImage25Mode ? { gptImage25Mode: String(settings.gptImage25Mode) } : {}),
    ...(settings.googleThinkingLevel ? { googleThinkingLevel: String(settings.googleThinkingLevel) } : {}),
    ...(settings.googleSearchMode ? { googleSearchMode: String(settings.googleSearchMode) } : {}),
    ...(settings.background ? { background: String(settings.background) } : {}),
    ...(settings.moderation ? { moderation: String(settings.moderation) } : {}),
    ...(settings.outputFormat ? { outputFormat: String(settings.outputFormat) } : {}),
    ...(settings.gifSize ? { gifSize: String(settings.gifSize) } : {}),
    ...(settings.frameCount !== undefined ? { frameCount: Number(settings.frameCount) } : {}),
    ...(settings.seedream55 ? { seedream55: settings.seedream55 as import("@/lib/apimart-seedream-55").Seedream55Settings } : {}),
    ...(settings.frameDurationMs !== undefined ? { frameDurationMs: Number(settings.frameDurationMs) } : {}),
    ...(Number.isFinite(Number(settings.outputCompression))
      ? { outputCompression: Number(settings.outputCompression) }
      : {}),
    ...(Number.isInteger(Number(settings.n)) ? { n: Number(settings.n) } : {}),
    ...(Number.isInteger(Number(settings.seed)) ? { seed: Number(settings.seed) } : {}),
    ...(typeof settings.enableWebSearch === "boolean"
      ? { enableWebSearch: settings.enableWebSearch }
      : {}),
    ...(settings.maskUrl ? { maskUrl: String(settings.maskUrl) } : {}),
    ...(settings.seedreamOutputMode === "single" || settings.seedreamOutputMode === "group"
      ? { seedreamOutputMode: settings.seedreamOutputMode }
      : {}),
    ...(Number.isInteger(Number(settings.seedreamOutputCount))
      ? { seedreamOutputCount: Number(settings.seedreamOutputCount) }
      : {}),
    ...(typeof settings.seedreamWebSearch === "boolean"
      ? { seedreamWebSearch: settings.seedreamWebSearch }
      : {}),
    toolMediaIds,
    batchIndex: input.batchIndex,
    taskCount: input.taskCount,
    batchSubmittedAt: input.batchSubmittedAt,
  };
}

export function stableBatchRequestKey(outputId: string, attempt: number) {
  const bytes = createHash("sha256")
    .update(`inkvia:image-batch:${outputId}:${attempt}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function submissionKey(value: unknown) {
  const key = String(value || "").trim();
  if (!key || key.length > 128) {
    throw new ImageBatchServiceError("Idempotency-Key 无效", 400, "BATCH_IDEMPOTENCY_KEY_INVALID");
  }
  return key;
}

export async function submitImageBatch(input: {
  authUserId: number;
  batchId: string;
  idempotencyKey: string;
  itemIds?: string[];
}) {
  await assertDurableWorkAdmission();
  const key = submissionKey(input.idempotencyKey);
  return db.$transaction(async (tx: any) => {
    const batch = await tx.imageBatch.findFirst({
      where: { id: input.batchId, authUserId: input.authUserId, deletedAt: null },
      include: {
        items: { orderBy: { position: "asc" } },
        media: { orderBy: [{ role: "asc" }, { position: "asc" }] },
        outputs: {
          select: {
            id: true,
            itemId: true,
            slotIndex: true,
            attempt: true,
            status: true,
          },
        },
      },
    });
    if (!batch) throw new ImageBatchServiceError("批次不存在", 404, "BATCH_NOT_FOUND");
    if (batch.lastSubmissionKey === key && batch.outputs.length) {
      return { batchId: batch.id, status: batch.status, outputCount: batch.outputs.length, reused: true };
    }
    const requestedItemIds = input.itemIds?.length ? new Set(input.itemIds) : null;
    const targetHasActiveOutput = batch.outputs.some((output: any) => (
      ACTIVE_RETRY_OUTPUT_STATUSES.has(String(output.status || "").toLowerCase())
      && (!requestedItemIds || requestedItemIds.has(output.itemId))
    ));
    if (targetHasActiveOutput) {
      throw new ImageBatchServiceError("批次正在执行", 409, "BATCH_ALREADY_RUNNING");
    }
    if (!batch.items.length) throw new ImageBatchServiceError("请先添加任务", 400, "BATCH_ITEMS_EMPTY");
    if (batch.items.length > IMAGE_BATCH_LIMITS.maxItems) {
      throw new ImageBatchServiceError("每个批次最多 50 个任务", 400, "BATCH_ITEM_LIMIT");
    }
    const targetItems = batch.items.filter((item: any) => (
      requestedItemIds ? requestedItemIds.has(item.id) : item.status === "draft"
    ));
    if (!targetItems.length) {
      throw new ImageBatchServiceError(
        "没有新增或已修改的待生成任务",
        400,
        "BATCH_NO_DRAFT_ITEMS",
      );
    }
    const outputCount = targetItems.length;
    if (outputCount > IMAGE_BATCH_LIMITS.maxOutputs) {
      throw new ImageBatchServiceError("每次提交最多 100 个输出", 400, "BATCH_OUTPUT_LIMIT");
    }
    const submittedAt = new Date();
    const submittedAtIso = submittedAt.toISOString();
    const outputRows: any[] = [];
    let batchIndex = 0;
    for (const item of targetItems) {
      const snapshot = buildBatchRequestSnapshot({
        batch,
        item,
        media: batch.media,
        batchIndex: batchIndex + 1,
        taskCount: outputCount,
        batchSubmittedAt: submittedAtIso,
      });
      if (!snapshot.prompt && !(isSeedream55Model(snapshot.model) && snapshot.seedream55?.layerDecomposition)) {
        throw new ImageBatchServiceError(`${item.name} 缺少提示词`, 400, "BATCH_PROMPT_REQUIRED");
      }
      if (!snapshot.model) {
        throw new ImageBatchServiceError(`${item.name} 缺少模型`, 400, "BATCH_MODEL_REQUIRED");
      }
      const id = randomUUID();
      const slotIndex = 0;
      const previousAttempt = batch.outputs.reduce(
        (maximum: number, output: any) => (
          output.itemId === item.id && output.slotIndex === slotIndex
            ? Math.max(maximum, Number(output.attempt) || 0)
            : maximum
        ),
        0,
      );
      const attempt = previousAttempt + 1;
      const outputSnapshot = { ...snapshot, batchIndex: batchIndex + 1 };
      outputRows.push({
        id,
        batchId: batch.id,
        itemId: item.id,
        slotIndex,
        attempt,
        status: "queued",
        requestKey: stableBatchRequestKey(id, attempt),
        requestSnapshot: outputSnapshot,
        nextPollAt: submittedAt,
      });
      batchIndex += 1;
    }
    const itemSnapshotRows = outputRows.map((row) => Prisma.sql`
      (${row.itemId}::uuid, ${JSON.stringify(row.requestSnapshot)}::jsonb)
    `);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "ImageBatchItem" AS item
      SET
        "status" = 'queued',
        "lastSubmittedSnapshot" = submitted.snapshot,
        "updatedAt" = NOW()
      FROM (VALUES ${Prisma.join(itemSnapshotRows)}) AS submitted(id, snapshot)
      WHERE item."id" = submitted.id
    `);
    await tx.imageBatchOutput.createMany({ data: outputRows });
    await tx.imageBatch.update({
      where: { id: batch.id },
      data: {
        status: "queued",
        submittedAt,
        finishedAt: null,
        lastSubmissionKey: key,
        version: { increment: 1 },
      },
    });
    return { batchId: batch.id, status: "queued", outputCount: outputRows.length, reused: false };
  });
}

export async function retryFailedBatchOutputs(input: {
  authUserId: number;
  batchId: string;
  itemIds?: string[];
}) {
  await assertDurableWorkAdmission();
  const itemIds = Array.from(new Set(
    (input.itemIds || []).map((id) => String(id || "").trim()).filter(Boolean),
  ));
  return db.$transaction(async (tx: any) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(
        hashtext('image_batch_retry'),
        hashtext(${input.batchId})
      )::text
    `);
    const batch = await tx.imageBatch.findFirst({
      where: { id: input.batchId, authUserId: input.authUserId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!batch) throw new ImageBatchServiceError("批次不存在", 404, "BATCH_NOT_FOUND");

    const outputs = await tx.imageBatchOutput.findMany({
      where: {
        batchId: input.batchId,
        ...(itemIds.length ? { itemId: { in: itemIds } } : {}),
      },
      orderBy: [
        { itemId: "asc" },
        { slotIndex: "asc" },
        { attempt: "desc" },
      ],
    });
    const latestBySlot = new Map<string, any>();
    for (const output of outputs) {
      const slot = `${output.itemId}:${output.slotIndex}`;
      if (!latestBySlot.has(slot)) latestBySlot.set(slot, output);
    }
    const latestOutputs = Array.from(latestBySlot.values());
    const retryable = latestOutputs.filter((output) => output.status === "failed");
    const reusedCount = latestOutputs.filter((output) => (
      ACTIVE_RETRY_OUTPUT_STATUSES.has(String(output.status || "").toLowerCase())
    )).length;
    const now = new Date();
    const rows = retryable.map((output) => {
      const id = randomUUID();
      const attempt = output.attempt + 1;
      return {
        id,
        batchId: output.batchId,
        itemId: output.itemId,
        slotIndex: output.slotIndex,
        attempt,
        status: "queued",
        requestKey: stableBatchRequestKey(id, attempt),
        requestSnapshot: output.requestSnapshot,
        nextPollAt: now,
      };
    });
    if (rows.length) {
      const queuedItemIds = Array.from(new Set(rows.map((row) => row.itemId)));
      await tx.imageBatchOutput.createMany({ data: rows });
      await tx.imageBatchItem.updateMany({
        where: { id: { in: queuedItemIds }, batchId: input.batchId },
        data: { status: "queued" },
      });
      await tx.imageBatch.update({
        where: { id: input.batchId },
        data: { status: "queued", finishedAt: null },
      });
    }
    return { retryCount: rows.length, reusedCount };
  });
}

export async function cancelQueuedBatchOutputs(input: { authUserId: number; batchId: string }) {
  const batch = await db.imageBatch.findFirst({
    where: { id: input.batchId, authUserId: input.authUserId, deletedAt: null },
    select: { id: true },
  });
  if (!batch) throw new ImageBatchServiceError("批次不存在", 404, "BATCH_NOT_FOUND");
  const now = new Date();
  const cancelled = await db.imageBatchOutput.updateMany({
    where: { batchId: input.batchId, status: "queued" },
    data: { status: "cancelled", finishedAt: now, leaseOwner: null, leaseUntil: null },
  });
  return { cancelledCount: cancelled.count };
}

export async function cancelBatchItemOutputs(input: {
  authUserId: number;
  batchId: string;
  itemId: string;
}) {
  const batch = await db.imageBatch.findFirst({
    where: { id: input.batchId, authUserId: input.authUserId, deletedAt: null },
    select: { id: true },
  });
  if (!batch) throw new ImageBatchServiceError("批次不存在", 404, "BATCH_NOT_FOUND");
  const item = await db.imageBatchItem.findFirst({
    where: { id: input.itemId, batchId: input.batchId },
    select: { id: true },
  });
  if (!item) throw new ImageBatchServiceError("任务不存在", 404, "BATCH_ITEM_NOT_FOUND");

  return db.$transaction(async (tx: any) => {
    const now = new Date();
    const cancelled = await tx.imageBatchOutput.updateMany({
      where: {
        batchId: input.batchId,
        itemId: input.itemId,
        status: {
          in: ["queued", "submitting", "waiting_provider", "running", "processing"],
        },
      },
      data: {
        status: "cancelled",
        errorCode: "USER_CANCELLED",
        errorMessage: "用户取消任务",
        finishedAt: now,
        nextPollAt: null,
        leaseOwner: null,
        leaseUntil: null,
      },
    });

    const rows = await tx.imageBatchOutput.findMany({
      where: { batchId: input.batchId },
      orderBy: [{ itemId: "asc" }, { slotIndex: "asc" }, { attempt: "desc" }],
      select: { itemId: true, slotIndex: true, status: true },
    });
    const latest = new Map<string, { itemId: string; status: string }>();
    for (const row of rows) {
      const key = `${row.itemId}:${row.slotIndex}`;
      if (!latest.has(key)) latest.set(key, row);
    }
    const latestRows = Array.from(latest.values());
    const itemStatus = aggregateBatchStatus(
      latestRows
        .filter((row) => row.itemId === input.itemId)
        .map((row) => row.status),
    );
    const batchStatus = aggregateBatchStatus(latestRows.map((row) => row.status));
    const batchTerminal = ["success", "failed", "partial_success", "cancelled"]
      .includes(batchStatus);

    await tx.imageBatchItem.update({
      where: { id: input.itemId },
      data: { status: itemStatus },
    });
    await tx.imageBatch.update({
      where: { id: input.batchId },
      data: { status: batchStatus, finishedAt: batchTerminal ? now : null },
    });

    return {
      cancelledCount: cancelled.count,
      itemStatus,
      batchStatus,
    };
  });
}
