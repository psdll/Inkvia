import { getMediaDeliveryMode } from "@/lib/media-delivery/settings";
import { isWanVideoModel } from "@/lib/wan-models";
import { validateWanMediaSet } from "@/lib/wan-media-policy";
import { createHash } from "node:crypto";
import { File as NodeFile } from "node:buffer";
import type { Prisma } from "@prisma/client";
import fs from "fs-extra";
import path from "path";
import prisma from "@/lib/prisma";
import { resolvePublicPath } from "@/lib/public-path";
import { saveBufferFile, saveRemoteFile } from "@/lib/storage";
import { classifyUploadMime, validateUploadFile, type UploadKind } from "@/lib/upload-validation";
import { assertUploadDiskWatermark } from "@/lib/upload-limits";
import {
  resolveLocalUploadPathForExternalApiWithRelay,
  resolveLocalUploadPathForExternalApiWithRelayBuffer,
} from "@/lib/external-assets";
import { deleteOssObjects } from "@/lib/oss";
import {
  canSoftDeleteToolMedia,
  isToolMediaLocalPath,
  toolMediaRetentionDeadline,
} from "@/lib/tool-media/lifecycle";
import {
  getSeedanceMediaPolicy,
  validateSeedanceMediaFile,
  type SeedanceMediaIssue,
  type SeedanceMediaProbe,
} from "@/lib/seedance-media-policy";
import {
  getMiniMaxH3UploadContract,
  validateMiniMaxH3MediaFile,
} from "@/lib/minimax-h3-media-policy";
import {
  mergeStoredMediaProbe,
  probeLocalMedia,
  readStoredMediaProbe,
  resolveLocalUploadPath,
} from "@/lib/tool-media/media-probe";

const TOOL_MEDIA_STORAGE_PROFILES = {
  tool: {
    folder: "imports",
    relayFolder: "tool-input-relay",
  },
  batch: {
    folder: "batch_imports",
    relayFolder: "batch-input-relay",
  },
} as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ToolMediaStorageProfile = keyof typeof TOOL_MEDIA_STORAGE_PROFILES;

export type ToolMediaUploadMetadata = {
  batchId?: string;
  batchMode?: string;
  productLibraryItemId?: number;
  productLibraryRequestKey?: string;
};

type ToolMediaUploadOptions = {
  ownerUserId: number;
  draftSessionId: string;
  storageProfile?: ToolMediaStorageProfile;
  metadata?: ToolMediaUploadMetadata;
  mediaId?: string;
  modelId?: string;
  allowedKinds?: UploadKind[];
  maxBytes?: Partial<Record<UploadKind, number>>;
  allowedMimeTypes?: string[];
  allowedAudioMimeTypes?: string[];
};

export class ToolMediaServiceError extends Error {
  status: number;
  code?: string;
  issues?: SeedanceMediaIssue[];

  constructor(
    message: string,
    status = 400,
    details: { code?: string; issues?: SeedanceMediaIssue[] } = {},
  ) {
    super(message);
    this.name = "ToolMediaServiceError";
    this.status = status;
    this.code = details.code;
    this.issues = details.issues;
  }
}

function scopedMetadataWhere(draftSessionId: string) {
  return [
    { metadata: { path: ["origin"], equals: "tool_input" } },
    { metadata: { path: ["draftSessionId"], equals: draftSessionId } },
  ];
}

function normalizedDeclaredMime(file: File) {
  return String(file.type || "").toLowerCase().split(";", 1)[0].trim();
}

function localUploadDiskPath(localPath: string) {
  const normalized = String(localPath || "").replaceAll("\\", "/");
  if (!isToolMediaLocalPath(normalized)) return "";
  const configuredRoot = String(process.env.UPLOADS_DIR || "").trim();
  const uploadsRoot = path.resolve(configuredRoot || resolvePublicPath("uploads"));
  const relative = normalized.replace(/^\/uploads\//, "");
  const absolute = path.resolve(uploadsRoot, relative);
  const relation = path.relative(uploadsRoot, absolute);
  if (!relation || relation === "." || relation.startsWith("..") || path.isAbsolute(relation)) return "";
  return absolute;
}

async function cleanupNewCopies(localPath: string, objectKey: string | null) {
  const cleanupTasks: Promise<unknown>[] = [];
  if (objectKey) cleanupTasks.push(deleteOssObjects([objectKey]));
  const diskPath = localUploadDiskPath(localPath);
  if (diskPath) cleanupTasks.push(fs.remove(diskPath));
  await Promise.allSettled(cleanupTasks);
}

export async function uploadToolMedia(input: ToolMediaUploadOptions & {
  file: File;
}) {
  const storageProfile = input.storageProfile || "tool";
  const profile = TOOL_MEDIA_STORAGE_PROFILES[storageProfile];
  const mediaId = normalizeRequestedMediaId(input.mediaId);
  const declaredMime = normalizedDeclaredMime(input.file);
  if (
    classifyUploadMime(declaredMime) === "audio"
    && input.allowedAudioMimeTypes?.length
    && !input.allowedAudioMimeTypes.includes(declaredMime)
  ) {
    throw new ToolMediaServiceError(`不支持的文件类型：${declaredMime || "未知"}`);
  }
  const validation = await validateUploadFile(
    input.file,
    input.allowedKinds ?? ["image", "video"],
    input.maxBytes,
    input.allowedMimeTypes,
  );
  if (!validation.ok || !validation.kind) {
    throw new ToolMediaServiceError(validation.error || "文件校验失败");
  }
  const buffer = Buffer.from(await input.file.arrayBuffer());
  const uploadFingerprint = createHash("sha256").update(buffer).digest("hex");
  const existing = await findRequestedMedia(mediaId);
  if (existing) {
    if (!existingUploadMatches({
      row: existing,
      ownerUserId: input.ownerUserId,
      draftSessionId: input.draftSessionId,
      storageProfile,
      uploadMetadata: input.metadata,
      file: input.file,
      kind: validation.kind,
      uploadFingerprint,
    })) {
      throw new ToolMediaServiceError("素材上传请求标识已被其他请求使用", 409);
    }
    return reusedUploadResult(existing);
  }

  await assertUploadDiskWatermark([input.file], {
    label: storageProfile === "batch" ? "Batch media upload" : "Tool media upload",
  });

  const now = new Date();
  const localPath = await saveBufferFile(
    buffer,
    profile.folder,
    { contentType: declaredMime },
  );
  let relayObjectKey: string | null = null;
  let mediaProbe: SeedanceMediaProbe | undefined;

  try {
    const seedancePolicy = input.modelId ? getSeedanceMediaPolicy(input.modelId) : null;
    const miniMaxContract = input.modelId ? getMiniMaxH3UploadContract(input.modelId) : null;
    if (
      input.modelId
      && (seedancePolicy || miniMaxContract || isWanVideoModel(input.modelId))
      && (!seedancePolicy || process.env.SEEDANCE_MEDIA_VALIDATION_DISABLED !== "1")
    ) {
      const diskPath = localUploadDiskPath(localPath);
      if (!diskPath) {
        throw new ToolMediaServiceError(
          "服务器无法定位已上传素材，请稍后重试。",
          500,
          { code: "MEDIA_PROBE_PATH_INVALID" },
        );
      }
      mediaProbe = await probeLocalMedia({
        localPath: diskPath,
        kind: validation.kind,
        fileName: input.file.name,
        declaredMime,
      });
      const issues = isWanVideoModel(input.modelId)
        ? validateWanMediaSet({ media: [{ fileName: input.file.name, byteSize: input.file.size, probe: mediaProbe }] })
        : miniMaxContract
        ? validateMiniMaxH3MediaFile({
            fileName: input.file.name,
            byteSize: input.file.size,
            probe: mediaProbe,
          })
        : validateSeedanceMediaFile({
            modelId: input.modelId,
            fileName: input.file.name,
            byteSize: input.file.size,
            probe: mediaProbe,
          });
      if (issues.length > 0) {
        throw new ToolMediaServiceError(
          `${input.file.name || "素材"} 不符合当前${miniMaxContract ? " MiniMax-H3 系列" : " Seedance"}模型要求：${issues[0].message}`,
          400,
          { code: miniMaxContract ? "MINIMAX_H3_MEDIA_INVALID" : "SEEDANCE_MEDIA_INVALID", issues },
        );
      }
    }

    // With platform hosting on, nothing is pushed to Aliyun OSS at upload time: the generation
    // step hands the file to the platform's own hosting, or relays it through OSS only if needed.
    const external = await getMediaDeliveryMode() === "platform"
      ? { url: localPath, objectKey: null as string | null }
      : storageProfile === "batch"
      ? await resolveLocalUploadPathForExternalApiWithRelayBuffer(
          localPath,
          profile.relayFolder,
          buffer,
          declaredMime || undefined,
        )
      : await resolveLocalUploadPathForExternalApiWithRelay(
          localPath,
          profile.relayFolder,
        );
    relayObjectKey = external.objectKey;
    if (!external.url) {
      throw new ToolMediaServiceError("无法生成可供模型访问的素材 URL", 503);
    }
    const createdAt = now.toISOString();
    const baseMetadata = storageProfile === "batch"
      ? {
          origin: "tool_input",
          workspace: "batch",
          batchId: String(input.metadata?.batchId || "").trim() || undefined,
          batchMode: String(input.metadata?.batchMode || "").trim() || undefined,
          productLibraryItemId: Number.isSafeInteger(input.metadata?.productLibraryItemId)
            && Number(input.metadata?.productLibraryItemId) > 0
            ? Number(input.metadata?.productLibraryItemId)
            : undefined,
          productLibraryRequestKey: String(
            input.metadata?.productLibraryRequestKey || "",
          ).trim() || undefined,
          draftSessionId: input.draftSessionId,
          uploadFingerprint,
          createdAt,
        }
      : {
          origin: "tool_input",
          draftSessionId: input.draftSessionId,
          uploadFingerprint,
          createdAt,
        };
    const created = await prisma.mediaAsset.create({
      data: {
        ...(mediaId ? { id: mediaId } : {}),
        ownerUserId: input.ownerUserId,
        kind: validation.kind,
        status: "ready",
        originalName: input.file.name || null,
        declaredMime: declaredMime || null,
        detectedMime: mediaProbe?.detectedMime ?? null,
        sizeBytes: BigInt(input.file.size),
        storageProvider: "local",
        originalKey: localPath,
        publicUrl: null,
        variants: relayObjectKey
          ? { relay: { objectKey: relayObjectKey, createdAt } }
          : {},
        metadata: (mediaProbe ? mergeStoredMediaProbe(baseMetadata, mediaProbe) : baseMetadata) as Prisma.InputJsonValue,
        retentionUntil: toolMediaRetentionDeadline("draft", now),
      },
      select: { id: true, status: true },
    });

    return {
      mediaId: created.id,
      localPreviewUrl: localPath,
      modelUrl: external.url,
      status: created.status,
      kind: validation.kind,
      ...(mediaProbe ? { probe: mediaProbe } : {}),
    };
  } catch (error) {
    await cleanupNewCopies(localPath, relayObjectKey);
    if (mediaId && isUniqueConstraintError(error)) {
      const concurrent = await findRequestedMedia(mediaId);
      if (concurrent && existingUploadMatches({
        row: concurrent,
        ownerUserId: input.ownerUserId,
        draftSessionId: input.draftSessionId,
        storageProfile,
        uploadMetadata: input.metadata,
        file: input.file,
        kind: validation.kind,
        uploadFingerprint,
      })) {
        return reusedUploadResult(concurrent);
      }
    }
    throw error;
  }
}

function sourceLocalUploadPath(sourceUrl: string) {
  const normalized = String(sourceUrl || "").trim().replaceAll("\\", "/");
  const withoutSuffix = normalized.split(/[?#]/, 1)[0] || "";
  if (withoutSuffix.startsWith("/uploads/")) return withoutSuffix;
  if (withoutSuffix.startsWith("uploads/")) return `/${withoutSuffix}`;
  return "";
}

function sourceFileName(sourceUrl: string, localPath: string) {
  let candidate = sourceLocalUploadPath(sourceUrl);
  if (!candidate) {
    try {
      candidate = new URL(sourceUrl).pathname;
    } catch {}
  }
  const original = path.basename(candidate || "");
  const fallback = path.basename(localPath);
  try {
    return decodeURIComponent(path.extname(original) ? original : fallback) || fallback;
  } catch {
    return path.extname(original) ? original : fallback;
  }
}

function sourceDeclaredMime(localPath: string) {
  const extension = path.extname(localPath).toLowerCase();
  const byExtension: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
  };
  return byExtension[extension] || "";
}

export async function uploadToolMediaFromSource(
  input: ToolMediaUploadOptions & { sourceUrl: string },
) {
  const sourceUrl = String(input.sourceUrl || "").trim();
  if (!sourceUrl) throw new ToolMediaServiceError("素材来源地址无效");

  let temporaryLocalPath = "";
  let localPath = sourceLocalUploadPath(sourceUrl);
  if (!localPath) {
    if (!/^https?:\/\//i.test(sourceUrl) && !sourceUrl.startsWith("data:")) {
      throw new ToolMediaServiceError("素材来源地址无效");
    }
    temporaryLocalPath = await saveRemoteFile(
      sourceUrl,
      "imports",
      sourceUrl.startsWith("data:"),
    );
    localPath = temporaryLocalPath;
  }

  const diskPath = resolveLocalUploadPath(localPath);
  try {
    const buffer = await fs.readFile(diskPath);
    const declaredMime = sourceDeclaredMime(localPath);
    if (!declaredMime) {
      throw new ToolMediaServiceError("无法识别拖入素材的文件类型");
    }
    const file = new NodeFile(
      [buffer],
      sourceFileName(sourceUrl, localPath),
      { type: declaredMime },
    ) as unknown as File;
    const { sourceUrl: _sourceUrl, ...uploadOptions } = input;
    const result = await uploadToolMedia({
      ...uploadOptions,
      file,
    });
    return { ...result, sizeBytes: file.size };
  } finally {
    if (temporaryLocalPath) {
      await fs.remove(diskPath).catch(() => undefined);
    }
  }
}

export async function listToolMediaDrafts(input: {
  ownerUserId: number;
  draftSessionId: string;
  mediaIds?: string[];
}) {
  const mediaIds = Array.from(new Set(input.mediaIds || []));
  const rows = await prisma.mediaAsset.findMany({
    where: mediaIds.length
      ? {
          ownerUserId: input.ownerUserId,
          status: "ready",
          purgedAt: null,
          OR: [
            { AND: scopedMetadataWhere(input.draftSessionId) },
            { id: { in: mediaIds } },
          ],
        }
      : {
          ownerUserId: input.ownerUserId,
          status: "ready",
          AND: scopedMetadataWhere(input.draftSessionId),
        },
    select: {
      id: true,
      kind: true,
      status: true,
      originalName: true,
      declaredMime: true,
      sizeBytes: true,
      originalKey: true,
      metadata: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((row) => ({
    mediaId: row.id,
    kind: row.kind,
    status: row.status,
    originalName: row.originalName,
    mimeType: row.declaredMime,
    sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
    localPreviewUrl: row.originalKey,
    ...(readStoredMediaProbe(row.metadata) ? { probe: readStoredMediaProbe(row.metadata) } : {}),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function releaseToolMedia(input: {
  ownerUserId: number;
  draftSessionId: string;
  mediaIds: string[];
}) {
  const mediaIds = Array.from(new Set(input.mediaIds));
  if (!mediaIds.length) return { releasedCount: 0 };

  const scopedWhere = {
    ownerUserId: input.ownerUserId,
    status: "ready",
    AND: scopedMetadataWhere(input.draftSessionId),
  };
  const candidates = await prisma.mediaAsset.findMany({
    where: {
      id: { in: mediaIds },
      ...scopedWhere,
    },
    select: {
      id: true,
      status: true,
      metadata: true,
      _count: { select: { generationInputs: true } },
    },
  });
  const releasableIds = candidates
    .filter((candidate) =>
      canSoftDeleteToolMedia({
        metadata: candidate.metadata,
        status: candidate.status,
        generationInputCount: candidate._count.generationInputs,
      }),
    )
    .map((candidate) => candidate.id);

  if (!releasableIds.length) return { releasedCount: 0 };

  const now = new Date();
  const updated = await prisma.mediaAsset.updateMany({
    where: {
      id: { in: releasableIds },
      ...scopedWhere,
      workspaceDraftMedia: { none: {} },
      batchMedia: { none: {} },
      liveVideoBatchItems: { none: {} },
      generationInputs: { none: {} },
      references: { none: {} },
      runOutputs: { none: {} },
    },
    data: {
      status: "soft_deleted",
      softDeletedAt: now,
      retentionUntil: toolMediaRetentionDeadline("release", now),
    },
  });
  return { releasedCount: updated.count };
}

function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2002");
}

function normalizeRequestedMediaId(value: unknown) {
  if (value === undefined || value === null || value === "") return "";
  const mediaId = String(value).trim().toLowerCase();
  if (!UUID_RE.test(mediaId)) {
    throw new ToolMediaServiceError("素材上传请求标识无效", 400);
  }
  return mediaId;
}

function mediaMetadata(row: { metadata?: unknown }) {
  return row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : {};
}

function existingUploadMatches(input: {
  row: any;
  ownerUserId: number;
  draftSessionId: string;
  storageProfile: ToolMediaStorageProfile;
  uploadMetadata?: ToolMediaUploadMetadata;
  file: File;
  kind: string;
  uploadFingerprint: string;
}) {
  const metadata = mediaMetadata(input.row);
  const expectedBatchId = String(input.uploadMetadata?.batchId || "").trim();
  const expectedBatchMode = String(input.uploadMetadata?.batchMode || "").trim();
  const expectedProductLibraryItemId = Number(
    input.uploadMetadata?.productLibraryItemId || 0,
  );
  const expectedProductLibraryRequestKey = String(
    input.uploadMetadata?.productLibraryRequestKey || "",
  ).trim();
  return input.row.ownerUserId === input.ownerUserId
    && input.row.status === "ready"
    && !input.row.purgedAt
    && input.row.kind === input.kind
    && metadata.origin === "tool_input"
    && metadata.draftSessionId === input.draftSessionId
    && metadata.uploadFingerprint === input.uploadFingerprint
    && (input.storageProfile === "batch"
      ? metadata.workspace === "batch" && metadata.batchId === expectedBatchId
      : metadata.workspace !== "batch")
    && (!expectedBatchMode || metadata.batchMode === expectedBatchMode)
    && (!expectedProductLibraryItemId
      || metadata.productLibraryItemId === expectedProductLibraryItemId)
    && (!expectedProductLibraryRequestKey
      || metadata.productLibraryRequestKey === expectedProductLibraryRequestKey)
    && String(input.row.originalName || "") === String(input.file.name || "")
    && String(input.row.declaredMime || "") === normalizedDeclaredMime(input.file)
    && Number(input.row.sizeBytes) === input.file.size;
}

async function findRequestedMedia(mediaId: string) {
  if (!mediaId) return null;
  return prisma.mediaAsset.findUnique({
    where: { id: mediaId },
    select: {
      id: true,
      ownerUserId: true,
      kind: true,
      status: true,
      originalName: true,
      declaredMime: true,
      sizeBytes: true,
      originalKey: true,
      metadata: true,
      purgedAt: true,
    },
  });
}

function reusedUploadResult(row: any) {
  const probe = readStoredMediaProbe(row.metadata);
  return {
    mediaId: row.id,
    localPreviewUrl: row.originalKey,
    modelUrl: row.originalKey,
    status: row.status,
    kind: row.kind,
    ...(probe ? { probe } : {}),
  };
}

export async function releaseOwnedUnreferencedToolMedia(input: {
  ownerUserId: number;
  mediaIds: string[];
}) {
  const mediaIds = Array.from(new Set(input.mediaIds));
  if (!mediaIds.length) return { releasedCount: 0 };

  const originWhere = { metadata: { path: ["origin"], equals: "tool_input" } };
  const candidates = await prisma.mediaAsset.findMany({
    where: {
      id: { in: mediaIds },
      ownerUserId: input.ownerUserId,
      status: "ready",
      ...originWhere,
    },
    select: {
      id: true,
      status: true,
      metadata: true,
      _count: { select: { generationInputs: true } },
    },
  });
  const releasableIds = candidates
    .filter((candidate) => canSoftDeleteToolMedia({
      metadata: candidate.metadata,
      status: candidate.status,
      generationInputCount: candidate._count.generationInputs,
    }))
    .map((candidate) => candidate.id);
  if (!releasableIds.length) return { releasedCount: 0 };

  const now = new Date();
  const updated = await prisma.mediaAsset.updateMany({
    where: {
      id: { in: releasableIds },
      ownerUserId: input.ownerUserId,
      status: "ready",
      ...originWhere,
      workspaceDraftMedia: { none: {} },
      batchMedia: { none: {} },
      liveVideoBatchItems: { none: {} },
      generationInputs: { none: {} },
      references: { none: {} },
      runOutputs: { none: {} },
    },
    data: {
      status: "soft_deleted",
      softDeletedAt: now,
      retentionUntil: toolMediaRetentionDeadline("release", now),
    },
  });
  return { releasedCount: updated.count };
}
