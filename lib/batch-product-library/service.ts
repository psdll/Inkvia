import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { Logger } from "@/lib/logger";
import { getOssObjectBufferByUrl } from "@/lib/oss";
import prisma from "@/lib/prisma";
import { resolvePublicPath } from "@/lib/public-path";
import { releaseToolMedia, uploadToolMedia } from "@/lib/tool-media/service";

const db = prisma as any;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const BATCH_WORKSPACE_REFERENCE_TYPE = "batch_workspace";

export class BatchProductLibraryError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "BATCH_PRODUCT_LIBRARY_INVALID") {
    super(message);
    this.name = "BatchProductLibraryError";
    this.status = status;
    this.code = code;
  }
}

export type BatchProductLibraryAdapter<TResult> = {
  modeKey: string;
  sourceId: string;
  attach(tx: any, mediaId: string): Promise<{ value: TResult; reused: boolean }>;
  hasBusinessReference(tx: any, mediaId: string): Promise<boolean>;
};

function normalizePositiveId(value: unknown) {
  const id = Math.floor(Number(value));
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new BatchProductLibraryError(
      "产品库素材 ID 无效",
      400,
      "PRODUCT_LIBRARY_ITEM_ID_INVALID",
    );
  }
  return id;
}

function normalizeRequestKey(value: unknown) {
  const requestKey = String(value || "").trim().toLowerCase();
  if (!UUID_RE.test(requestKey)) {
    throw new BatchProductLibraryError(
      "产品库导入请求标识无效",
      400,
      "PRODUCT_LIBRARY_REQUEST_KEY_INVALID",
    );
  }
  return requestKey;
}

function normalizeAdapterIdentity(input: {
  modeKey: unknown;
  sourceId: unknown;
  batchId: unknown;
}) {
  const modeKey = String(input.modeKey || "").trim();
  const sourceId = String(input.sourceId || "").trim();
  const batchId = String(input.batchId || "").trim();
  if (!modeKey || !sourceId || !batchId) {
    throw new BatchProductLibraryError(
      "批量工作区标识无效",
      400,
      "BATCH_WORKSPACE_IDENTITY_INVALID",
    );
  }
  return { modeKey, sourceId, batchId };
}

export function batchProductLibrarySnapshotMediaId(input: {
  authUserId: number;
  batchId: string;
  modeKey: string;
  requestKey: string;
}) {
  const digest = createHash("sha256")
    .update([
      "batch-product-library-v1",
      String(input.authUserId),
      input.modeKey,
      input.batchId,
      input.requestKey,
    ].join("|"))
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function localProductLibraryPath(raw: string) {
  const normalized = String(raw || "").trim().replaceAll("\\", "/");
  if (!normalized.startsWith("/uploads/")) return "";
  const configuredRoot = String(process.env.UPLOADS_DIR || "").trim();
  const uploadsRoot = path.resolve(configuredRoot || resolvePublicPath("uploads"));
  const relative = normalized
    .slice("/uploads/".length)
    .split("?", 1)[0]
    .split("#", 1)[0];
  const absolute = path.resolve(uploadsRoot, relative);
  const relation = path.relative(uploadsRoot, absolute);
  if (!relation || relation === "." || relation.startsWith("..") || path.isAbsolute(relation)) {
    throw new BatchProductLibraryError(
      "产品库原图路径无效",
      400,
      "PRODUCT_LIBRARY_SOURCE_INVALID",
    );
  }
  return absolute;
}

async function readProductLibrarySource(fileUrl: string) {
  const localPath = localProductLibraryPath(fileUrl);
  if (localPath) {
    try {
      return await fs.readFile(localPath);
    } catch {
      throw new BatchProductLibraryError(
        "产品库原图不可读取",
        409,
        "PRODUCT_LIBRARY_SOURCE_UNREADABLE",
      );
    }
  }
  const buffer = await getOssObjectBufferByUrl(fileUrl).catch(() => null);
  if (!buffer?.length) {
    throw new BatchProductLibraryError(
      "产品库原图不可读取",
      409,
      "PRODUCT_LIBRARY_SOURCE_UNREADABLE",
    );
  }
  return buffer;
}

function sourceFileName(item: { id: number; title?: string | null; fileUrl: string }) {
  const title = String(item.title || "").trim() || `product-library-${item.id}`;
  let sourcePath = String(item.fileUrl || "").trim();
  try {
    sourcePath = new URL(sourcePath).pathname;
  } catch {}
  const extension = path.extname(sourcePath.split("?", 1)[0].split("#", 1)[0]);
  return path.extname(title) || !extension ? title : `${title}${extension}`;
}

export async function syncMediaReferenceCount(tx: any, mediaIds: string[]) {
  const uniqueIds = Array.from(new Set(mediaIds.map((id) => String(id || "").trim()).filter(Boolean)));
  for (const mediaId of uniqueIds) {
    const referenceCount = await tx.mediaReference.count({ where: { mediaId } });
    await tx.mediaAsset.updateMany({
      where: { id: mediaId },
      data: { referenceCount },
    });
  }
}

export async function releaseBatchWorkspaceReference(tx: any, input: {
  mediaId: string;
  sourceId: string;
  hasBusinessReference: () => Promise<boolean>;
}) {
  if (await input.hasBusinessReference()) return false;
  const deleted = await tx.mediaReference.deleteMany({
    where: {
      mediaId: input.mediaId,
      sourceType: BATCH_WORKSPACE_REFERENCE_TYPE,
      sourceId: input.sourceId,
    },
  });
  await syncMediaReferenceCount(tx, [input.mediaId]);
  return Number(deleted.count || 0) > 0;
}

export async function importBatchProductLibrarySnapshot<TResult>(input: {
  authUserId: number;
  batchId: string;
  productLibraryItemId: number;
  requestKey: string;
  adapter: BatchProductLibraryAdapter<TResult>;
}): Promise<{ mediaId: string; value: TResult; reused: boolean }> {
  const productLibraryItemId = normalizePositiveId(input.productLibraryItemId);
  const requestKey = normalizeRequestKey(input.requestKey);
  const identity = normalizeAdapterIdentity({
    modeKey: input.adapter.modeKey,
    sourceId: input.adapter.sourceId,
    batchId: input.batchId,
  });
  const item = await db.mediaLibraryItem.findFirst({
    where: { id: productLibraryItemId, isDeleted: false },
  });
  if (!item) {
    throw new BatchProductLibraryError(
      "产品库素材不存在",
      404,
      "PRODUCT_LIBRARY_ITEM_NOT_FOUND",
    );
  }
  if (item.scope !== "shared" && !(item.scope === "private" && item.ownerUserId === input.authUserId)) {
    throw new BatchProductLibraryError(
      "无权使用该产品库素材",
      403,
      "PRODUCT_LIBRARY_FORBIDDEN",
    );
  }
  if (item.kind !== "image") {
    throw new BatchProductLibraryError(
      "批量只支持产品库图片",
      400,
      "PRODUCT_LIBRARY_IMAGE_REQUIRED",
    );
  }
  const fileUrl = String(item.fileUrl || "").trim();
  if (!fileUrl) {
    throw new BatchProductLibraryError(
      "产品库原图不可读取",
      409,
      "PRODUCT_LIBRARY_SOURCE_UNREADABLE",
    );
  }
  const buffer = await readProductLibrarySource(fileUrl);
  const mediaId = batchProductLibrarySnapshotMediaId({
    authUserId: input.authUserId,
    batchId: identity.batchId,
    modeKey: identity.modeKey,
    requestKey,
  });
  const draftSessionId = `batch-product-library:${requestKey}`;
  const uploaded = await uploadToolMedia({
    ownerUserId: input.authUserId,
    draftSessionId,
    file: new File([buffer], sourceFileName(item), {
      type: String(item.mimeType || "image/png").trim() || "image/png",
    }),
    mediaId,
    storageProfile: "batch",
    metadata: {
      batchId: identity.batchId,
      batchMode: identity.modeKey,
      productLibraryItemId,
      productLibraryRequestKey: requestKey,
    },
  });

  try {
    const attached = await db.$transaction(async (tx: any) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(
          hashtext('batch_product_library'),
          hashtext(${`${input.authUserId}:${identity.modeKey}:${identity.batchId}:${requestKey}`})
        )::text
      `);
      const relation = await input.adapter.attach(tx, uploaded.mediaId);
      await tx.mediaReference.upsert({
        where: {
          mediaId_sourceType_sourceId: {
            mediaId: uploaded.mediaId,
            sourceType: BATCH_WORKSPACE_REFERENCE_TYPE,
            sourceId: identity.sourceId,
          },
        },
        create: {
          mediaId: uploaded.mediaId,
          sourceType: BATCH_WORKSPACE_REFERENCE_TYPE,
          sourceId: identity.sourceId,
        },
        update: {},
      });
      await tx.mediaAsset.updateMany({
        where: { id: uploaded.mediaId, ownerUserId: input.authUserId },
        data: { retentionUntil: null },
      });
      await syncMediaReferenceCount(tx, [uploaded.mediaId]);
      return relation;
    });
    return {
      mediaId: uploaded.mediaId,
      value: attached.value,
      reused: attached.reused,
    };
  } catch (error) {
    try {
      await releaseToolMedia({
        ownerUserId: input.authUserId,
        draftSessionId,
        mediaIds: [uploaded.mediaId],
      });
    } catch (compensationError) {
      void Logger.error(
        "batch_product_library_compensation_failed",
        "批量产品库快照补偿清理失败",
        compensationError,
        {
          authUserId: input.authUserId,
          batchId: identity.batchId,
          modeKey: identity.modeKey,
          productLibraryItemId,
          requestKey,
          mediaId: uploaded.mediaId,
        },
      );
    }
    throw error;
  }
}
