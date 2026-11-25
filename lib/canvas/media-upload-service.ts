import "server-only";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import Busboy from "busboy";
import { Prisma, type PrismaClient } from "@prisma/client";
import { canvasMediaRetentionDeadline } from "@/lib/canvas/media-lifecycle";
import { validateCanvasMediaProbe, type CanvasMediaProbe } from "@/lib/canvas/media-security";
import { resolveLocalUploadDirectory, saveLocalFile } from "@/lib/storage";
import {
  canvasUploadByteLimit,
  canvasUploadTooLargeMessage,
  classifyUploadMime,
  validateUploadMagic,
  type UploadKind,
} from "@/lib/upload-validation";
import { canvasMetrics } from "@/lib/canvas/observability";
import { buildCanvasImportStorageFolder } from "@/lib/canvas/import-storage-path";
import { probeCanvasMediaPooled } from "@/lib/canvas/media-probe-pool";
import { prepareCanvasPreviews } from "@/lib/canvas/prepare-previews";

export class CanvasMediaUploadError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly assetId?: string,
  ) {
    super(message);
    this.name = "CanvasMediaUploadError";
  }
}

export async function probeCanvasMedia(filePath: string, kind: UploadKind): Promise<CanvasMediaProbe> {
  return probeCanvasMediaPooled(filePath, kind);
}

export type SecureCanvasMediaUploadResult = {
  mediaId: string;
  status: "ready";
  kind: UploadKind;
  name: string;
  size: number;
  url: string;
  variants: {
    original: {
      mediaId: string;
      url: string;
      mimeType?: string;
      width?: number;
      height?: number;
    };
  };
};

export async function persistCanvasMediaStream(
  client: PrismaClient,
  input: {
    ownerUserId: number;
    stream: NodeJS.ReadableStream;
    originalName: string;
    declaredMime: string;
    kind: UploadKind;
  },
): Promise<SecureCanvasMediaUploadResult> {
  const assetId = crypto.randomUUID();
  const createdAt = new Date();
  const owner = await client.$queryRaw<Array<{ username: string | null }>>(Prisma.sql`
    SELECT "username" FROM "User" WHERE "id" = ${input.ownerUserId} LIMIT 1
  `);
  const storageFolder = buildCanvasImportStorageFolder(
    owner[0]?.username || "",
    input.ownerUserId,
    createdAt,
  );
  const storageDir = resolveLocalUploadDirectory(storageFolder);
  const temporary = path.join(storageDir, `.${assetId}.${crypto.randomUUID()}.part`);
  try {
    await fs.mkdir(storageDir, { recursive: true, mode: 0o755 });
    const hash = crypto.createHash("sha256");
    const headChunks: Buffer[] = [];
    let headBytes = 0;
    let size = 0;
    const limit = canvasUploadByteLimit(input.kind);
    const inspector = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > limit) {
          callback(new CanvasMediaUploadError("MEDIA_FILE_TOO_LARGE", canvasUploadTooLargeMessage(input.kind), assetId));
          return;
        }
        hash.update(chunk);
        if (headBytes < 16) {
          const slice = chunk.subarray(0, Math.min(chunk.length, 16 - headBytes));
          headChunks.push(slice);
          headBytes += slice.length;
        }
        callback(null, chunk);
      },
    });
    await pipeline(input.stream, inspector, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
    if ((input.stream as { truncated?: boolean }).truncated) {
      throw new CanvasMediaUploadError("MEDIA_FILE_TOO_LARGE", canvasUploadTooLargeMessage(input.kind), assetId);
    }
    if (size <= 0) throw new CanvasMediaUploadError("MEDIA_FILE_EMPTY", "请选择有效的文件", assetId);
    const magic = validateUploadMagic(Buffer.concat(headChunks), input.kind);
    if (!magic.ok) throw new CanvasMediaUploadError("MEDIA_MAGIC_INVALID", magic.error || "文件内容无法识别", assetId);
    const checksum = hash.digest("hex");
    const processingStartedAt = Date.now();
    const probe = await probeCanvasMedia(temporary, input.kind);
    const violations = validateCanvasMediaProbe(probe, size);
    if (violations.length) {
      throw new CanvasMediaUploadError(
        violations[0],
        `media security limits exceeded: ${violations.join(", ")}`,
        assetId,
      );
    }
    const detectedMime = probe.detectedMime || input.declaredMime || undefined;
    const url = await saveLocalFile(temporary, storageFolder, {
      contentType: detectedMime,
      fallbackExt: input.kind === "video" ? "mp4" : input.kind === "audio" ? "mp3" : "png",
      stableKey: checksum,
      dateSubdirectory: false,
      consumeSource: true,
      publicReadable: true,
    });
    const variants = {
      original: {
        mediaId: assetId,
        url,
        mimeType: detectedMime,
        width: probe.width,
        height: probe.height,
      },
    };
    const inserted = await client.$executeRaw(Prisma.sql`
      INSERT INTO "MediaAsset" (
        "id", "ownerUserId", "kind", "status", "originalName", "declaredMime",
        "detectedMime", "sizeBytes", "checksumSha256", "storageProvider",
        "originalKey", "publicUrl", "variants", "metadata", "retentionUntil",
        "createdAt", "updatedAt"
      ) VALUES (
        ${assetId}::uuid, ${input.ownerUserId}, ${input.kind}, 'ready',
        ${input.originalName.slice(0, 512)}, ${input.declaredMime.slice(0, 128)},
        ${detectedMime || null}, ${BigInt(size)}, ${checksum}, 'local',
        ${url}, ${url}, ${JSON.stringify(variants)}::jsonb,
        ${JSON.stringify(probe)}::jsonb,
        ${canvasMediaRetentionDeadline("soft_deleted", createdAt)},
        ${createdAt}, CURRENT_TIMESTAMP
      )
    `);
    if (inserted !== 1) throw new Error("media asset record was not created");
    if (input.kind !== "audio") await prepareCanvasPreviews(url).catch(() => undefined);
    canvasMetrics.observe("canvas_media_processing_duration_ms", Date.now() - processingStartedAt);
    return {
      mediaId: assetId,
      status: "ready",
      kind: input.kind,
      name: input.originalName,
      size,
      url,
      variants,
    };
  } catch (error: any) {
    const code = error instanceof CanvasMediaUploadError ? error.code : "MEDIA_PROCESSING_FAILED";
    const message = String(error?.message || "media processing failed").slice(0, 4_000);
    throw new CanvasMediaUploadError(code, message, assetId);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function streamCanvasMediaUpload(
  client: PrismaClient,
  input: { ownerUserId: number; request: Request },
): Promise<SecureCanvasMediaUploadResult> {
  if (!input.request.body) throw new CanvasMediaUploadError("MEDIA_UPLOAD_BODY_REQUIRED", "请选择文件");
  const contentType = String(input.request.headers.get("content-type") || "");
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new CanvasMediaUploadError("MEDIA_UPLOAD_MULTIPART_REQUIRED", "上传请求格式错误");
  }
  const parser = Busboy({
    headers: Object.fromEntries(input.request.headers.entries()),
    limits: { files: 1, fields: 0, parts: 1, fileSize: canvasUploadByteLimit("video") },
  });
  let upload: Promise<SecureCanvasMediaUploadResult> | null = null;
  let fileCount = 0;
  parser.on("file", (fieldName, file, info) => {
    fileCount += 1;
    if (fieldName !== "file" || fileCount > 1) {
      file.resume();
      return;
    }
    const kind = classifyUploadMime(info.mimeType);
    if (!kind) {
      file.resume();
      upload = Promise.reject(new CanvasMediaUploadError("MEDIA_TYPE_UNSUPPORTED", `不支持的文件类型：${info.mimeType || "未知"}`));
      return;
    }
    upload = persistCanvasMediaStream(client, {
      ownerUserId: input.ownerUserId,
      stream: file,
      originalName: info.filename || "upload",
      declaredMime: info.mimeType,
      kind,
    });
  });
  await pipeline(Readable.fromWeb(input.request.body as any), parser);
  if (!upload) throw new CanvasMediaUploadError("MEDIA_FILE_REQUIRED", "请选择文件");
  return upload;
}
