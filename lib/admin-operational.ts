import crypto from "crypto";
import fs from "fs-extra";
import path from "node:path";
import prisma from "@/lib/prisma";
import {
  collectComparableGenerationLocalPathRefs,
  deleteStoredMediaRefs,
} from "@/lib/media-cleanup";
import { adminDayKey, adminStartOfDay } from "@/lib/admin-analytics-time";
import { getGenerationDisplayFields } from "@/lib/generation-display-assets";
import { buildAdminWorkFeedProjectionCtes } from "@/lib/admin-work-feed-projection-sql.mjs";
import { isVideoMediaUrl, normalizeMediaUrl } from "@/lib/media-url";
import { resolvePublicPath } from "@/lib/public-path";
import { tombstoneAdminUserSummary } from "@/lib/admin-user-summary-read-model";
import {
  applyAdminSummaryProjection,
  workFeedRowFromDeleteEvent,
} from "@/lib/admin-summary-projection";

type JsonRecord = Record<string, any>;

export const ADMIN_EVENT_RETRY_DELAYS_MS = [
  5_000,
  15_000,
  60_000,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  3 * 60 * 60_000,
] as const;

export function getAdminEventRetryDelay(attempt: number) {
  const index = Math.max(0, Math.min(ADMIN_EVENT_RETRY_DELAYS_MS.length - 1, Math.floor(attempt) - 1));
  return ADMIN_EVENT_RETRY_DELAYS_MS[index];
}

export function canApplyAdminWorkEvent(currentSourceEventId: number, incomingSourceEventId: number) {
  return Math.max(0, Math.floor(incomingSourceEventId)) > Math.max(0, Math.floor(currentSourceEventId));
}

function generationUploadDiskPath(localPath: unknown) {
  const normalized = String(localPath || "").trim().replaceAll("\\", "/").split(/[?#]/)[0] || "";
  if (!normalized.startsWith("/uploads/")) return "";
  const uploadsRoot = path.resolve(String(process.env.UPLOADS_DIR || "").trim() || resolvePublicPath("uploads"));
  const diskPath = path.resolve(uploadsRoot, normalized.slice("/uploads/".length));
  const relative = path.relative(uploadsRoot, diskPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return diskPath;
}

async function hydrateGenerationSizeBytes(row: any, db: any) {
  if (Math.max(0, Number(row?.sizeBytes) || 0) > 0) return row;
  const diskPath = generationUploadDiskPath(row?.localPath);
  if (!diskPath) return row;
  const stat = await fs.stat(diskPath).catch(() => null);
  const sizeBytes = stat?.isFile() ? Math.max(0, Number(stat.size) || 0) : 0;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > 2_147_483_647) return row;
  const updated = await db.generation.update({
    where: { id: Number(row.id) },
    data: { sizeBytes },
  });
  return { ...row, ...(updated || {}), sizeBytes };
}

const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 200;
const ADMIN_JOB_TYPES = new Set([
  "rebuild_read_models",
  "scan_storage",
  "generate_thumbnails",
  "reindex_local_uploads",
  "export_user",
  "import_user",
  "purge_user",
  "cleanup_orphans",
]);

function dbTable(db: any, name: string) {
  return db[name];
}

function table(name: string) {
  return dbTable(prisma as any, name);
}

export function safeAdminLimit(raw: string | null | undefined, fallback = DEFAULT_LIMIT) {
  const n = Math.floor(Number(raw || fallback));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_LIMIT, Math.max(1, n));
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toDate(value: string | null | undefined, endOfDay = false) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T${endOfDay ? "23:59:59.999" : "00:00:00"}+08:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function encodeCursor(payload: JsonRecord | null | undefined) {
  if (!payload) return null;
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(raw: string | null | undefined) {
  const value = String(raw || "").trim();
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as JsonRecord) : null;
  } catch {
    return null;
  }
}

function decimalToNumber(value: unknown) {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function bigintToNumber(value: unknown) {
  if (typeof value === "bigint") return Number(value);
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function adminKeyFor(userId: string, authUserId?: number | null) {
  return typeof authUserId === "number" ? `auth:${authUserId}` : `guest:${userId}`;
}

function modelBucketKey(day: string, userId: string | null, authUserId: number | null, provider: string, model: string, module: string) {
  const userPart = typeof authUserId === "number" ? `auth:${authUserId}` : `guest:${userId || "unknown"}`;
  return [day, userPart, provider || "--", model || "--", module || "--"].join("|");
}

function mediaKindFromUrl(url: string, fallback?: string | null) {
  const f = String(fallback || "").toLowerCase();
  if (f.startsWith("video")) return "video";
  if (f.startsWith("image")) return "image";
  return isVideoMediaUrl(url) ? "video" : "image";
}

function normalizeNullableUrl(value: unknown) {
  return normalizeMediaUrl(String(value || "").trim()) || null;
}

function parseMaybeJson(raw: unknown): JsonRecord | null {
  if (!raw) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as JsonRecord;
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sanitizeJson(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export async function writeAdminAuditLog(params: {
  operator?: string | null;
  action: string;
  targetType: string;
  targetId?: string | number | null;
  before?: unknown;
  after?: unknown;
  req?: { headers?: { get(name: string): string | null } } | null;
}) {
  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    ip = (params.req?.headers?.get("x-forwarded-for") || "").split(",")[0].trim() || params.req?.headers?.get("x-real-ip") || null;
    userAgent = params.req?.headers?.get("user-agent") || null;
  } catch {}
  await table("adminAuditLog").create({
    data: {
      operator: params.operator || null,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId == null ? null : String(params.targetId),
      before: params.before == null ? undefined : params.before,
      after: params.after == null ? undefined : params.after,
      ip,
      userAgent,
    },
  });
}

export async function enqueueAdminEvent(params: {
  eventType: string;
  entityType: string;
  entityId: string | number;
  userId?: string | null;
  authUserId?: number | null;
  payload?: unknown;
  occurredAt?: Date;
}) {
  return table("adminEvent").create({
    data: {
      eventType: params.eventType,
      entityType: params.entityType,
      entityId: String(params.entityId),
      userId: params.userId || null,
      authUserId: typeof params.authUserId === "number" ? params.authUserId : null,
      payload: sanitizeJson(params.payload),
      occurredAt: params.occurredAt || new Date(),
    },
  });
}

async function upsertAdminWorkFeedForGeneration(
  row: any,
  sourceEventId = 0,
  db: any = prisma,
  forceFromSource = false,
) {
  const display = getGenerationDisplayFields({
    type: row.type,
    localPath: row.localPath,
    templateData: row.templateData,
  });
  const data = {
    generationId: Number(row.id),
    sourceEventId: Math.max(0, Math.floor(Number(sourceEventId) || 0)),
    userId: String(row.userId || "legacy"),
    authUserId: typeof row.authUserId === "number" ? row.authUserId : null,
    type: String(row.type || "unknown"),
    status: String(row.status || "unknown"),
    source: String(row.source || "tool"),
    provider: row.externalProvider || null,
    model: row.model || null,
    mediaKind: display.displayKind,
    thumbUrl: display.thumbUrl || null,
    previewUrl: display.previewUrl || null,
    displayUrl: display.displayUrl || null,
    posterUrl: display.posterUrl || null,
    sizeBytes: typeof row.sizeBytes === "number" && row.sizeBytes <= 2_147_483_647 ? row.sizeBytes : null,
    sizeBytes64: typeof row.sizeBytes === "bigint"
      ? row.sizeBytes
      : typeof row.sizeBytes === "number" && Number.isFinite(row.sizeBytes)
        ? BigInt(Math.max(0, Math.floor(row.sizeBytes)))
        : null,
    errorCode: parseMaybeJson(row.templateData)?.errorCode || null,
    errorMsg: row.errorMsg || null,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt || null,
    updatedAt: row.updatedAt || row.createdAt,
    deletedAt: null,
  };
  const appliedRows = await db.$queryRawUnsafe(
    `INSERT INTO "AdminWorkFeed" (
       "generationId", "sourceEventId", "userId", "authUserId", "type", "status", "source",
       "provider", "model", "mediaKind", "thumbUrl", "previewUrl", "displayUrl", "posterUrl",
       "sizeBytes", "sizeBytes64", "errorCode", "errorMsg", "createdAt", "finishedAt", "updatedAt", "deletedAt"
     )
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
            generation."createdAt", generation."finishedAt", generation."updatedAt", $19
     FROM "Generation" AS generation
     WHERE generation."id" = $1
     ON CONFLICT ("generationId") DO UPDATE SET
       "sourceEventId" = ${forceFromSource
         ? 'GREATEST("AdminWorkFeed"."sourceEventId", EXCLUDED."sourceEventId")'
         : 'EXCLUDED."sourceEventId"'},
       "userId" = EXCLUDED."userId",
       "authUserId" = EXCLUDED."authUserId",
       "type" = EXCLUDED."type",
       "status" = EXCLUDED."status",
       "source" = EXCLUDED."source",
       "provider" = EXCLUDED."provider",
       "model" = EXCLUDED."model",
       "mediaKind" = EXCLUDED."mediaKind",
       "thumbUrl" = EXCLUDED."thumbUrl",
       "previewUrl" = EXCLUDED."previewUrl",
       "displayUrl" = EXCLUDED."displayUrl",
       "posterUrl" = EXCLUDED."posterUrl",
       "sizeBytes" = EXCLUDED."sizeBytes",
       "sizeBytes64" = EXCLUDED."sizeBytes64",
       "errorCode" = EXCLUDED."errorCode",
       "errorMsg" = EXCLUDED."errorMsg",
       "createdAt" = EXCLUDED."createdAt",
       "finishedAt" = EXCLUDED."finishedAt",
       "updatedAt" = EXCLUDED."updatedAt",
       "deletedAt" = EXCLUDED."deletedAt"
     ${forceFromSource ? "" : 'WHERE "AdminWorkFeed"."sourceEventId" < EXCLUDED."sourceEventId"'}
     RETURNING "generationId"`,
    data.generationId,
    data.sourceEventId,
    data.userId,
    data.authUserId,
    data.type,
    data.status,
    data.source,
    data.provider,
    data.model,
    data.mediaKind,
    data.thumbUrl,
    data.previewUrl,
    data.displayUrl,
    data.posterUrl,
    data.sizeBytes,
    data.sizeBytes64,
    data.errorCode,
    data.errorMsg,
    data.deletedAt,
  );
  return { data, applied: appliedRows.length > 0 };
}

async function writeAdminWorkFeedTombstone(event: any, previous: any, db: any) {
  const generationId = Number(event.entityId);
  const sourceEventId = Math.max(0, Math.floor(Number(event.id) || 0));
  const changedAt = event.occurredAt instanceof Date ? event.occurredAt : new Date(event.occurredAt || Date.now());
  const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
  const data = {
    generationId,
    sourceEventId,
    userId: String(previous?.userId || payload.userId || event.userId || "legacy"),
    authUserId: typeof previous?.authUserId === "number"
      ? previous.authUserId
      : typeof payload.authUserId === "number"
        ? payload.authUserId
        : typeof event.authUserId === "number"
          ? event.authUserId
          : null,
    type: String(previous?.type || payload.type || "unknown"),
    status: "deleted",
    source: String(previous?.source || payload.source || "event"),
    mediaKind: String(previous?.mediaKind || "image"),
    sizeBytes64: previous?.sizeBytes64 ?? BigInt(Math.max(0, Math.floor(Number(payload.sizeBytes) || 0))),
    createdAt: previous?.createdAt || (payload.createdAt ? new Date(payload.createdAt) : changedAt),
    updatedAt: changedAt,
    deletedAt: changedAt,
  };
  const appliedRows = await db.$queryRawUnsafe(
    `INSERT INTO "AdminWorkFeed" (
       "generationId", "sourceEventId", "userId", "authUserId", "type", "status", "source",
       "mediaKind", "sizeBytes64", "createdAt", "updatedAt", "deletedAt"
     ) VALUES ($1, $2, $3, $4, $5, 'deleted', $6, $7, $8, $9, $10, $10)
     ON CONFLICT ("generationId") DO UPDATE SET
       "sourceEventId" = EXCLUDED."sourceEventId",
       "status" = EXCLUDED."status",
       "updatedAt" = EXCLUDED."updatedAt",
       "deletedAt" = EXCLUDED."deletedAt"
     WHERE "AdminWorkFeed"."sourceEventId" < EXCLUDED."sourceEventId"
     RETURNING "generationId"`,
    data.generationId,
    data.sourceEventId,
    data.userId,
    data.authUserId,
    data.type,
    data.source,
    data.mediaKind,
    data.sizeBytes64,
    data.createdAt,
    data.updatedAt,
  );
  return { data, applied: appliedRows.length > 0 };
}

export async function rebuildAdminWorkFeedFromGeneration(_batchSize = 1000, db: any = prisma) {
  const projectionCtes = buildAdminWorkFeedProjectionCtes(
    `SELECT generation.* FROM "Generation" AS generation`,
    { prefix: "work_feed_rebuild", finalName: "source" },
  );
  const rows = await db.$queryRawUnsafe(
    `WITH ${projectionCtes}, updated AS (
       UPDATE "AdminWorkFeed" AS feed
       SET "userId" = source."userId",
           "authUserId" = source."authUserId",
           "type" = source."type",
           "status" = source."status",
           "source" = source."source",
           "provider" = source."externalProvider",
           "model" = source."model",
           "mediaKind" = source."projectedMediaKind",
           "thumbUrl" = source."projectedThumbUrl",
           "previewUrl" = source."projectedPreviewUrl",
           "displayUrl" = source."projectedDisplayUrl",
           "posterUrl" = source."projectedPosterUrl",
           "sizeBytes" = source."sizeBytes",
           "sizeBytes64" = source."sizeBytes"::bigint,
           "errorCode" = source."projectedErrorCode",
           "errorMsg" = source."errorMsg",
           "createdAt" = source."createdAt",
           "finishedAt" = source."finishedAt",
           "updatedAt" = source."updatedAt",
           "deletedAt" = NULL
       FROM source
       WHERE feed."generationId" = source."id"
         AND (feed."userId", feed."authUserId", feed."type", feed."status", feed."source",
              feed."provider", feed."model", feed."mediaKind", feed."thumbUrl", feed."previewUrl",
              feed."displayUrl", feed."posterUrl", feed."sizeBytes", feed."sizeBytes64", feed."errorCode",
              feed."errorMsg", feed."createdAt", feed."finishedAt", feed."updatedAt", feed."deletedAt")
             IS DISTINCT FROM
             (source."userId", source."authUserId", source."type", source."status", source."source",
              source."externalProvider", source."model", source."projectedMediaKind", source."projectedThumbUrl",
              source."projectedPreviewUrl", source."projectedDisplayUrl", source."projectedPosterUrl",
              source."sizeBytes", source."sizeBytes"::bigint, source."projectedErrorCode", source."errorMsg",
              source."createdAt", source."finishedAt", source."updatedAt", NULL)
       RETURNING feed."generationId"
     ), inserted AS (
       INSERT INTO "AdminWorkFeed" (
         "generationId", "sourceEventId", "userId", "authUserId", "type", "status", "source",
         "provider", "model", "mediaKind", "thumbUrl", "previewUrl", "displayUrl", "posterUrl",
         "sizeBytes", "sizeBytes64", "errorCode", "errorMsg",
         "createdAt", "finishedAt", "updatedAt", "deletedAt"
       )
       SELECT source."id", 0, source."userId", source."authUserId", source."type", source."status", source."source",
              source."externalProvider", source."model", source."projectedMediaKind",
              source."projectedThumbUrl", source."projectedPreviewUrl", source."projectedDisplayUrl",
              source."projectedPosterUrl", source."sizeBytes", source."sizeBytes"::bigint,
               source."projectedErrorCode", source."errorMsg",
               source."createdAt", source."finishedAt", source."updatedAt", NULL
       FROM source
       WHERE NOT EXISTS (
         SELECT 1 FROM "AdminWorkFeed" AS feed WHERE feed."generationId" = source."id"
       )
       RETURNING "generationId"
     ), tombstoned AS (
       UPDATE "AdminWorkFeed" AS feed
       SET "status" = 'deleted', "deletedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
       WHERE feed."deletedAt" IS NULL
         AND NOT EXISTS (SELECT 1 FROM source WHERE source."id" = feed."generationId")
       RETURNING feed."generationId"
     )
     SELECT (SELECT COUNT(*)::int FROM source) AS scanned,
            ((SELECT COUNT(*)::int FROM updated) + (SELECT COUNT(*)::int FROM inserted)) AS applied,
            (SELECT COUNT(*)::int FROM tombstoned) AS tombstoned`,
  );
  return Math.max(0, Number(rows?.[0]?.scanned) || 0);
}

function mediaCatalogData(input: {
  mediaId: string;
  sourceType: string;
  sourceId: string | number;
  userId?: string | null;
  authUserId?: number | null;
  category?: string | null;
  mimeType?: string | null;
  mediaKind: string;
  fileUrl: string;
  thumbUrl?: string | null;
  previewUrl?: string | null;
  sizeBytes?: number | null;
  storageProvider?: string | null;
  storageKey?: string | null;
  selectedAt?: Date | string | null;
  archiveStatus?: string | null;
  deletedAt?: Date | string | null;
  createdAt?: Date | string | null;
}) {
  return {
    mediaId: input.mediaId,
    sourceType: input.sourceType,
    sourceId: String(input.sourceId),
    userId: input.userId || null,
    authUserId: typeof input.authUserId === "number" ? input.authUserId : null,
    category: input.category || null,
    mimeType: input.mimeType || null,
    mediaKind: input.mediaKind,
    fileUrl: input.fileUrl,
    thumbUrl: input.thumbUrl || null,
    previewUrl: input.previewUrl || null,
    sizeBytes: typeof input.sizeBytes === "number" ? input.sizeBytes : null,
    storageProvider: input.storageProvider || (input.fileUrl.startsWith("/uploads/") ? "local" : input.fileUrl ? "remote" : null),
    storageKey: input.storageKey || input.fileUrl,
    selectedAt: input.selectedAt ? new Date(input.selectedAt) : null,
    archiveStatus: input.archiveStatus || "active",
    deletedAt: input.deletedAt ? new Date(input.deletedAt) : null,
    createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
  };
}

async function upsertMediaCatalog(data: ReturnType<typeof mediaCatalogData>) {
  await table("adminMediaCatalog").upsert({
    where: { mediaId: data.mediaId },
    create: data,
    update: data,
  });
}

async function rebuildAdminMediaCatalog(batchSize = 1000) {
  let count = 0;
  const feeds = await table("adminWorkFeed").findMany({
    where: { deletedAt: null },
    orderBy: { generationId: "asc" },
    take: 50000,
  });
  for (const feed of feeds) {
    const fileUrl = normalizeNullableUrl(feed.thumbUrl || feed.previewUrl || feed.displayUrl || feed.posterUrl);
    if (!fileUrl) continue;
    await upsertMediaCatalog(
      mediaCatalogData({
        mediaId: `generation:${feed.generationId}`,
        sourceType: "generation",
        sourceId: feed.generationId,
        userId: feed.userId,
        authUserId: feed.authUserId,
        category: feed.type,
        mediaKind: feed.mediaKind,
        fileUrl,
        thumbUrl: feed.thumbUrl,
        previewUrl: feed.previewUrl || feed.displayUrl,
        sizeBytes: feed.sizeBytes,
        createdAt: feed.createdAt,
        archiveStatus: feed.status === "deleted" ? "deleted" : "active",
      })
    );
    count += 1;
  }

  let materialCursor = 0;
  for (;;) {
    const rows = await prisma.materialAsset.findMany({
      where: { id: { gt: materialCursor } },
      orderBy: { id: "asc" },
      take: batchSize,
      select: {
        id: true,
        category: true,
        imageUrl: true,
        thumbnailUrl: true,
        previewUrl: true,
        mimeType: true,
        sizeBytes: true,
        selectedByUserId: true,
        selectedAt: true,
        isDeleted: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!rows.length) break;
    for (const row of rows) {
      const fileUrl = normalizeNullableUrl(row.previewUrl || row.thumbnailUrl || row.imageUrl);
      if (!fileUrl) continue;
      await upsertMediaCatalog(
        mediaCatalogData({
          mediaId: `material:${row.id}`,
          sourceType: "material_asset",
          sourceId: row.id,
          userId: typeof row.selectedByUserId === "number" ? String(row.selectedByUserId) : null,
          authUserId: row.selectedByUserId,
          category: row.category,
          mimeType: row.mimeType,
          mediaKind: mediaKindFromUrl(fileUrl, row.mimeType),
          fileUrl,
          thumbUrl: row.thumbnailUrl,
          previewUrl: row.previewUrl,
          sizeBytes: row.sizeBytes,
          selectedAt: row.selectedAt,
          archiveStatus: row.isDeleted ? "deleted" : "active",
          deletedAt: row.isDeleted ? row.updatedAt : null,
          createdAt: row.createdAt,
        })
      );
      count += 1;
    }
    materialCursor = rows[rows.length - 1].id;
    if (rows.length < batchSize) break;
  }

  let libraryCursor = 0;
  for (;;) {
    const rows = await prisma.mediaLibraryItem.findMany({
      where: { id: { gt: libraryCursor } },
      orderBy: { id: "asc" },
      take: batchSize,
      select: {
        id: true,
        scope: true,
        kind: true,
        groupName: true,
        fileUrl: true,
        thumbnailUrl: true,
        mimeType: true,
        sizeBytes: true,
        ownerUserId: true,
        isDeleted: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!rows.length) break;
    for (const row of rows) {
      const fileUrl = normalizeNullableUrl(row.thumbnailUrl || row.fileUrl);
      if (!fileUrl) continue;
      await upsertMediaCatalog(
        mediaCatalogData({
          mediaId: `media_library:${row.id}`,
          sourceType: "media_library",
          sourceId: row.id,
          userId: typeof row.ownerUserId === "number" ? String(row.ownerUserId) : null,
          authUserId: row.ownerUserId,
          category: row.groupName || row.scope,
          mimeType: row.mimeType,
          mediaKind: mediaKindFromUrl(fileUrl, row.kind || row.mimeType),
          fileUrl,
          thumbUrl: row.thumbnailUrl,
          previewUrl: row.thumbnailUrl || row.fileUrl,
          sizeBytes: row.sizeBytes,
          archiveStatus: row.isDeleted ? "deleted" : "active",
          deletedAt: row.isDeleted ? row.updatedAt : null,
          createdAt: row.createdAt,
        })
      );
      count += 1;
    }
    libraryCursor = rows[rows.length - 1].id;
    if (rows.length < batchSize) break;
  }

  return count;
}

async function rebuildAdminModelUsageDaily(batchSize = 3000) {
  const buckets = new Map<string, any>();
  let cursor = 0;
  let scanned = 0;
  for (;;) {
    const rows = await prisma.usageLedger.findMany({
      where: { id: { gt: cursor } },
      orderBy: { id: "asc" },
      take: batchSize,
      select: {
        id: true,
        userId: true,
        authUserId: true,
        externalProvider: true,
        model: true,
        module: true,
        status: true,
        amount: true,
        currency: true,
        usageSnapshot: true,
        occurredAt: true,
      },
    });
    if (!rows.length) break;
    for (const row of rows) {
      const day = adminDayKey(row.occurredAt);
      if (!day) continue;
      const provider = String(row.externalProvider || "unknown");
      const model = String(row.model || "unknown");
      const moduleName = String(row.module || "unknown");
      const key = modelBucketKey(day, row.userId, row.authUserId, provider, model, moduleName);
      const usage = sanitizeJson(row.usageSnapshot);
      const bucket = buckets.get(key) || {
        bucketKey: key,
        day,
        authUserId: row.authUserId,
        userId: row.userId,
        provider,
        model,
        module: moduleName,
        requestCount: 0,
        successCount: 0,
        failedCount: 0,
        amount: 0,
        currency: row.currency || "CNY",
        inputTokens: 0,
        outputTokens: 0,
        avgLatencyMs: 0,
        latencyTotal: 0,
        latencyCount: 0,
      };
      bucket.requestCount += 1;
      if (String(row.status).toLowerCase() === "success") bucket.successCount += 1;
      if (String(row.status).toLowerCase() === "failed") bucket.failedCount += 1;
      bucket.amount += decimalToNumber(row.amount);
      bucket.inputTokens += Math.max(0, Number(usage.inputTokens || usage.prompt_tokens || 0) || 0);
      bucket.outputTokens += Math.max(0, Number(usage.outputTokens || usage.completion_tokens || 0) || 0);
      const latency = Math.max(0, Number(usage.latencyMs || 0) || 0);
      if (latency) {
        bucket.latencyTotal += latency;
        bucket.latencyCount += 1;
      }
      buckets.set(key, bucket);
    }
    scanned += rows.length;
    cursor = rows[rows.length - 1].id;
    if (rows.length < batchSize) break;
  }
  for (const raw of buckets.values()) {
    const { latencyTotal, latencyCount, ...bucket } = raw;
    bucket.avgLatencyMs = latencyCount ? Math.round(latencyTotal / latencyCount) : 0;
    await table("adminModelUsageDaily").upsert({
      where: { bucketKey: bucket.bucketKey },
      create: bucket,
      update: {
        requestCount: bucket.requestCount,
        successCount: bucket.successCount,
        failedCount: bucket.failedCount,
        amount: bucket.amount,
        currency: bucket.currency,
        inputTokens: bucket.inputTokens,
        outputTokens: bucket.outputTokens,
        avgLatencyMs: bucket.avgLatencyMs,
      },
    });
  }
  return { scanned, buckets: buckets.size };
}

export async function rebuildAdminReadModels(input?: { batchSize?: number }) {
  const batchSize = Math.max(100, Math.min(5000, Math.floor(Number(input?.batchSize || 1000))));
  const startedAt = Date.now();
  const workFeed = await rebuildAdminWorkFeedFromGeneration(batchSize);
  const mediaCatalog = await rebuildAdminMediaCatalog(batchSize);
  const modelUsage = await rebuildAdminModelUsageDaily(batchSize);
  const { rebuildRecentDailyAnalytics } = await import("@/lib/admin-analytics-rollup");
  const dailyAnalytics = await rebuildRecentDailyAnalytics("all", { workFeedAlreadyRebuilt: true });
  return {
    workFeed,
    mediaCatalog,
    dailyStats: { disabled: true },
    dailyAnalytics,
    modelUsage,
    userSummary: { users: await table("adminUserSummary").count() },
    durationMs: Date.now() - startedAt,
  };
}

export async function processAdminEvents(
  limit = 100,
  dependencies: { db?: any; workerId?: string } = {},
) {
  const db = dependencies.db || prisma;
  const workerId = String(dependencies.workerId || `${process.pid}:${crypto.randomUUID()}`);
  const take = Math.max(1, Math.min(100, Math.floor(Number(limit) || 100)));
  return db.$transaction(async (tx: any) => {
    const leaseRows = await tx.$queryRawUnsafe(
      `SELECT pg_try_advisory_xact_lock(hashtextextended('admin-work-feed-event-worker', 0)) AS acquired`,
    );
    const leaseAcquired = Boolean(leaseRows?.[0]?.acquired);
    if (!leaseAcquired) return { leaseAcquired: false, claimed: 0, processed: 0, failed: 0 };

    const events = await tx.$queryRawUnsafe(
      `WITH claimable AS (
         SELECT "id"
         FROM "AdminEvent"
         WHERE (
           "status" IN ('pending', 'failed')
           OR (
             "status" = 'processing'
             AND ("lockedAt" IS NULL OR "lockedAt" < CURRENT_TIMESTAMP - INTERVAL '5 minutes')
           )
         )
           AND NOT ("eventType" = 'media_cleanup_retry' AND "entityType" = 'media_cleanup')
           AND "availableAt" <= CURRENT_TIMESTAMP
           AND "attempts" < 8
         ORDER BY "id" ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE "AdminEvent" AS event
       SET "status" = 'processing',
           "attempts" = event."attempts" + 1,
           "lockedAt" = CURRENT_TIMESTAMP,
           "lockedBy" = $2,
           "lastError" = NULL
       FROM claimable
       WHERE event."id" = claimable."id"
       RETURNING event.*`,
      take,
      workerId,
    );
    if (!events.length) return { leaseAcquired: true, claimed: 0, processed: 0, failed: 0 };

    let processed = 0;
    let failed = 0;
    let updatedGenerations = 0;
    for (const event of [...events].sort((a: any, b: any) => Number(a.id) - Number(b.id))) {
      const savepoint = `admin_event_${Math.max(0, Math.floor(Number(event.id) || 0))}`;
      await tx.$executeRawUnsafe(`SAVEPOINT "${savepoint}"`);
      try {
        if (event.entityType === "generation" && /^\d+$/.test(String(event.entityId))) {
          const previous = await tx.adminWorkFeed.findUnique({
            where: { generationId: Number(event.entityId) },
          });
          if (event.eventType === "generation.delete" || event.eventType === "generation_deleted") {
            const result = await writeAdminWorkFeedTombstone(event, previous, tx);
            if (result.applied) {
              await applyAdminSummaryProjection(tx, previous || workFeedRowFromDeleteEvent(event), result.data);
              updatedGenerations += 1;
            }
          } else {
            const sourceRow = await tx.generation.findUnique({ where: { id: Number(event.entityId) } });
            if (sourceRow) {
              const row = await hydrateGenerationSizeBytes(sourceRow, tx);
              const result = await upsertAdminWorkFeedForGeneration(row, Number(event.id), tx);
              if (result.applied) {
                await applyAdminSummaryProjection(tx, previous, result.data);
                updatedGenerations += 1;
              }
            }
          }
        } else if (event.entityType === "user" && event.eventType === "user_deleted") {
          const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
          await tombstoneAdminUserSummary({
            userId: String(event.userId || event.entityId || ""),
            authUserId: typeof event.authUserId === "number" ? event.authUserId : null,
            linkedGuestUserIds: Array.isArray((payload as any).linkedGuestUserIds)
              ? (payload as any).linkedGuestUserIds
              : Array.isArray((payload as any).linkedUserIds)
                ? (payload as any).linkedUserIds
                : [],
            deletedAt: event.occurredAt instanceof Date
              ? event.occurredAt
              : new Date(event.occurredAt || Date.now()),
          }, tx);
        }
        await tx.adminEvent.update({
          where: { id: Number(event.id) },
          data: {
            status: "done",
            processedAt: new Date(),
            lockedAt: null,
            lockedBy: null,
            lastError: null,
          },
        });
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT "${savepoint}"`);
        processed += 1;
      } catch (error) {
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT "${savepoint}"`);
        const attempts = Math.max(1, Math.floor(Number(event.attempts) || 1));
        const availableAt = new Date(Date.now() + getAdminEventRetryDelay(attempts));
        await tx.adminEvent.update({
          where: { id: Number(event.id) },
          data: {
            status: "failed",
            availableAt,
            lockedAt: null,
            lockedBy: null,
            lastError: String((error as Error)?.message || error).slice(0, 2_000),
          },
        });
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT "${savepoint}"`);
        failed += 1;
      }
    }
    return { leaseAcquired: true, claimed: events.length, processed, failed, updatedGenerations };
  }, { maxWait: 5_000, timeout: 60_000 });
}

export async function processMediaCleanupRetryEvents(
  limit = 25,
  dependencies: { db?: any; workerId?: string } = {},
) {
  const db = dependencies.db || prisma;
  const workerId = String(dependencies.workerId || `${process.pid}:${crypto.randomUUID()}`);
  const take = Math.max(1, Math.min(50, Math.floor(Number(limit) || 25)));
  const claimed = await db.$transaction(async (tx: any) => {
    const leaseRows = await tx.$queryRawUnsafe(
      `SELECT pg_try_advisory_xact_lock(hashtextextended('media-cleanup-retry-worker', 0)) AS acquired`,
    );
    if (!leaseRows?.[0]?.acquired) return null;
    return tx.$queryRawUnsafe(
      `WITH claimable AS (
         SELECT "id"
         FROM "AdminEvent"
         WHERE "eventType" = 'media_cleanup_retry'
           AND "entityType" = 'media_cleanup'
           AND (
             "status" IN ('pending', 'failed')
             OR (
               "status" = 'processing'
               AND ("lockedAt" IS NULL OR "lockedAt" < CURRENT_TIMESTAMP - INTERVAL '15 minutes')
             )
           )
           AND "availableAt" <= CURRENT_TIMESTAMP
           AND "attempts" < 8
         ORDER BY "id" ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE "AdminEvent" AS event
       SET "status" = 'processing',
           "attempts" = event."attempts" + 1,
           "lockedAt" = CURRENT_TIMESTAMP,
           "lockedBy" = $2,
           "lastError" = NULL
       FROM claimable
       WHERE event."id" = claimable."id"
       RETURNING event.*`,
      take,
      workerId,
    );
  }, { maxWait: 5_000, timeout: 15_000 });
  if (claimed === null) return { leaseAcquired: false, claimed: 0, processed: 0, failed: 0 };

  let processed = 0;
  let failed = 0;
  for (const event of claimed) {
    try {
      const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
      const refs = Array.isArray((payload as any).refs)
        ? [...new Set((payload as any).refs.map((ref: unknown) => String(ref || "").trim()).filter(Boolean))]
        : [];
      if (!refs.length) throw new Error("media cleanup retry has no refs");
      const protectedGenerationRefs = await collectComparableGenerationLocalPathRefs(refs);
      const canonicalGenerationMediaIds = Array.isArray((payload as any).canonicalGenerationMediaIds)
        ? (payload as any).canonicalGenerationMediaIds.map((value: unknown) => String(value || "").trim()).filter(Boolean)
        : [];
      const cleanup = await deleteStoredMediaRefs(refs, {
        canonicalGenerationOutputs: true,
        canonicalGenerationMediaIds,
        protectedGenerationComparableRefs: protectedGenerationRefs,
      });
      if (cleanup.ossError || cleanup.failedOssKeys.length || (cleanup.failedLocalFiles?.length || 0)) {
        throw new Error(cleanup.ossError || "media cleanup retry failed");
      }
      await db.adminEvent.update({
        where: { id: Number(event.id) },
        data: {
          status: "done",
          processedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        },
      });
      processed += 1;
    } catch (error) {
      const attempts = Math.max(1, Math.floor(Number(event.attempts) || 1));
      await db.adminEvent.update({
        where: { id: Number(event.id) },
        data: {
          status: "failed",
          availableAt: new Date(Date.now() + getAdminEventRetryDelay(attempts)),
          lockedAt: null,
          lockedBy: null,
          lastError: String((error as Error)?.message || error).slice(0, 2_000),
        },
      });
      failed += 1;
    }
  }
  return { leaseAcquired: true, claimed: claimed.length, processed, failed };
}

export async function createAdminJob(params: { type: string; payload?: unknown; operator?: string | null }) {
  const type = String(params.type || "").trim();
  if (!ADMIN_JOB_TYPES.has(type)) throw new Error("不支持的任务类型");
  const jobId = crypto.randomUUID();
  const job = await table("adminJob").create({
    data: {
      jobId,
      type,
      operator: params.operator || null,
      payload: sanitizeJson(params.payload),
    },
  });
  void runAdminJob(jobId).catch(() => null);
  return serializeAdminJob(job);
}

async function recordAdminStorageSnapshot() {
  const { scanStorageCategories } = await import("@/lib/admin-storage-scan");
  const snapshot = await scanStorageCategories();
  const snapshotAt = new Date(snapshot.scannedAt);
  const updatedAt = new Date();
  const rows: JsonRecord[] = [
    {
      snapshotAt,
      scope: "summary",
      pathKey: "uploads",
      authUserId: null,
      fileCount: snapshot.totalFiles,
      totalBytes: snapshot.totalBytes,
      largestFileBytes: 0,
      updatedAt,
    },
    ...snapshot.categories.map((category) => ({
      snapshotAt,
      scope: category.source || "local",
      pathKey: category.folder,
      authUserId: null,
      fileCount: category.files,
      totalBytes: category.bytes,
      largestFileBytes: 0,
      updatedAt,
    })),
  ];

  const stack = [...snapshot.uploadsTree];
  while (stack.length) {
    const node = stack.pop() as {
      relativePath: string;
      files: number;
      bytes: number;
      children?: unknown[];
    };
    rows.push({
      snapshotAt,
      scope: "uploads_tree",
      pathKey: node.relativePath,
      authUserId: null,
      fileCount: node.files,
      totalBytes: node.bytes,
      largestFileBytes: 0,
      updatedAt,
    });
    for (const child of node.children || []) stack.push(child as any);
  }

  for (let i = 0; i < rows.length; i += 500) {
    await table("adminStorageSnapshot").createMany({ data: rows.slice(i, i + 500) });
  }

  return {
    snapshotAt: snapshotAt.toISOString(),
    totalFiles: snapshot.totalFiles,
    totalBytes: snapshot.totalBytes,
    categoryCount: snapshot.categories.length,
    rowCount: rows.length,
  };
}

export async function runAdminJob(jobId: string) {
  const job = await table("adminJob").findUnique({ where: { jobId } });
  if (!job || job.status !== "queued") return null;
  await table("adminJob").update({
    where: { jobId },
    data: { status: "running", startedAt: new Date(), stage: "start", progress: 5 },
  });
  try {
    let result: JsonRecord = {};
    if (job.type === "rebuild_read_models") {
      await table("adminJob").update({ where: { jobId }, data: { stage: "rebuild_read_models", progress: 20 } });
      result = await rebuildAdminReadModels({ batchSize: Number(job.payload?.batchSize || 1000) });
    } else if (job.type === "scan_storage") {
      await table("adminJob").update({ where: { jobId }, data: { stage: "snapshot", progress: 60 } });
      result = await recordAdminStorageSnapshot();
    } else {
      result = { message: "任务已登记，具体执行器将在后续迭代接入。", type: job.type };
    }
    const next = await table("adminJob").update({
      where: { jobId },
      data: { status: "done", progress: 100, stage: "done", result, finishedAt: new Date() },
    });
    return serializeAdminJob(next);
  } catch (error) {
    const next = await table("adminJob").update({
      where: { jobId },
      data: {
        status: "failed",
        error: error instanceof Error ? error.message : "任务执行失败",
        finishedAt: new Date(),
      },
    });
    return serializeAdminJob(next);
  }
}

function serializeAdminJob(row: any) {
  return {
    jobId: row.jobId,
    type: row.type,
    status: row.status,
    progress: row.progress,
    stage: row.stage || null,
    operator: row.operator || null,
    payload: row.payload || {},
    result: row.result || null,
    error: row.error || null,
    createdAt: toIso(row.createdAt),
    startedAt: toIso(row.startedAt),
    updatedAt: toIso(row.updatedAt),
    finishedAt: toIso(row.finishedAt),
    expiresAt: toIso(row.expiresAt),
  };
}

function makeDateIdCursor(row: any, dateField = "createdAt", idField = "generationId") {
  if (!row) return null;
  return encodeCursor({ t: toIso(row[dateField]), id: row[idField] });
}

function beforeDateIdWhere(cursor: JsonRecord | null, dateField = "createdAt", idField = "generationId") {
  if (!cursor?.t || cursor.id == null) return {};
  const date = new Date(String(cursor.t));
  if (Number.isNaN(date.getTime())) return {};
  const id = cursor.id;
  return { OR: [{ [dateField]: { lt: date } }, { AND: [{ [dateField]: date }, { [idField]: { lt: id } }] }] };
}

export async function listAdminV2Users(input: { q?: string | null; cursor?: string | null; limit?: number; sort?: string | null }) {
  const limit = safeAdminLimit(String(input.limit || ""));
  const sort = String(input.sort || "lastActiveAt");
  const cursor = decodeCursor(input.cursor);
  const q = String(input.q || "").trim();
  const orderField =
    sort === "storageBytes"
      ? "storageBytes"
      : sort === "last30TaskCount"
        ? "last30TaskCount"
        : sort === "failedRate"
          ? "failedCount30d"
          : sort === "updatedAt"
            ? "updatedAt"
            : "lastActiveAt";
  const where: any = {};
  if (q) where.OR = [{ userId: { contains: q, mode: "insensitive" } }, { username: { contains: q, mode: "insensitive" } }, { adminKey: { contains: q, mode: "insensitive" } }];
  if (cursor?.v != null && cursor?.id) {
    where.AND = [
      ...(where.AND || []),
      { OR: [{ [orderField]: { lt: cursor.v } }, { AND: [{ [orderField]: cursor.v }, { adminKey: { gt: String(cursor.id) } }] }] },
    ];
  }
  const rows = await table("adminUserSummary").findMany({
    where,
    orderBy: [{ [orderField]: "desc" }, { adminKey: "asc" }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(serializeUserSummary),
    nextCursor: rows.length > limit && last ? encodeCursor({ v: last[orderField], id: last.adminKey }) : null,
    serverTime: new Date().toISOString(),
  };
}

function serializeUserSummary(row: any) {
  return {
    adminKey: row.adminKey,
    userId: row.userId,
    authUserId: row.authUserId,
    username: row.username,
    lastActiveAt: toIso(row.lastActiveAt),
    todayTaskCount: row.todayTaskCount,
    last7TaskCount: row.last7TaskCount,
    last30TaskCount: row.last30TaskCount,
    totalTaskCount: row.totalTaskCount,
    successRate30d: row.successRate30d,
    failedCount30d: row.failedCount30d,
    storageBytes: bigintToNumber(row.storageBytes),
    assetCount: row.assetCount,
    materialCount: row.materialCount,
    modelCost30d: decimalToNumber(row.modelCost30d),
    deviceCount: row.deviceCount,
    updatedAt: toIso(row.updatedAt),
  };
}

async function resolveAdminKeyScope(adminKey: string) {
  const summary = await table("adminUserSummary").findUnique({ where: { adminKey } });
  if (summary) return summary;
  const raw = String(adminKey || "");
  if (raw.startsWith("auth:")) {
    const id = Number(raw.slice(5));
    if (Number.isFinite(id)) return { adminKey: raw, userId: String(id), authUserId: id, username: null };
  }
  if (raw.startsWith("guest:")) return { adminKey: raw, userId: raw.slice(6), authUserId: null, username: null };
  return { adminKey: raw, userId: raw, authUserId: /^\d+$/.test(raw) ? Number(raw) : null, username: null };
}

export async function getAdminV2UserOverview(adminKey: string) {
  const scope = await resolveAdminKeyScope(adminKey);
  const summary = await table("adminUserSummary").findUnique({ where: { adminKey: scope.adminKey } });
  const daily = await table("adminDailyStats").findMany({
    where: typeof scope.authUserId === "number" ? { authUserId: scope.authUserId } : { userId: scope.userId },
    orderBy: { day: "desc" },
    take: 30,
  });
  const modelUsage = await table("adminModelUsageDaily").findMany({
    where: typeof scope.authUserId === "number" ? { authUserId: scope.authUserId } : { userId: scope.userId },
    orderBy: { day: "desc" },
    take: 100,
  });
  return {
    summary: summary ? serializeUserSummary(summary) : null,
    daily: daily.reverse().map(serializeDailyStats),
    modelUsage: modelUsage.map(serializeModelUsage),
    serverTime: new Date().toISOString(),
  };
}

export async function listAdminV2Works(adminKey: string, input: { type?: string | null; status?: string | null; model?: string | null; from?: string | null; to?: string | null; cursor?: string | null; limit?: number }) {
  const scope = await resolveAdminKeyScope(adminKey);
  const limit = safeAdminLimit(String(input.limit || ""));
  const cursor = decodeCursor(input.cursor);
  const where: any = { deletedAt: null };
  if (typeof scope.authUserId === "number") where.authUserId = scope.authUserId;
  else where.userId = scope.userId;
  if (input.type && input.type !== "all") where.type = input.type;
  if (input.status && input.status !== "all") where.status = input.status;
  if (input.model && input.model !== "all") where.model = input.model;
  const createdAt: any = {};
  const from = toDate(input.from);
  const to = toDate(input.to, true);
  if (from) createdAt.gte = from;
  if (to) createdAt.lte = to;
  if (Object.keys(createdAt).length) where.createdAt = createdAt;
  const cursorWhere = beforeDateIdWhere(cursor);
  if (Object.keys(cursorWhere).length) where.AND = [...(where.AND || []), cursorWhere];
  const rows = await table("adminWorkFeed").findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { generationId: "desc" }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  return {
    items: page.map(serializeWorkFeed),
    nextCursor: rows.length > limit ? makeDateIdCursor(page[page.length - 1]) : null,
    serverTime: new Date().toISOString(),
  };
}

function serializeWorkFeed(row: any) {
  return {
    generationId: row.generationId,
    userId: row.userId,
    authUserId: row.authUserId,
    type: row.type,
    status: row.status,
    source: row.source,
    provider: row.provider,
    model: row.model,
    mediaKind: row.mediaKind,
    thumbUrl: row.thumbUrl,
    previewUrl: row.previewUrl,
    displayUrl: row.displayUrl,
    posterUrl: row.posterUrl,
    sizeBytes: row.sizeBytes || 0,
    errorCode: row.errorCode,
    errorMsg: row.errorMsg,
    createdAt: toIso(row.createdAt),
    finishedAt: toIso(row.finishedAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export async function listAdminV2Media(adminKey: string, input: { sourceType?: string | null; category?: string | null; archiveStatus?: string | null; from?: string | null; to?: string | null; cursor?: string | null; limit?: number }) {
  const scope = await resolveAdminKeyScope(adminKey);
  const limit = safeAdminLimit(String(input.limit || ""));
  const cursor = decodeCursor(input.cursor);
  const where: any = {};
  if (typeof scope.authUserId === "number") where.authUserId = scope.authUserId;
  else where.userId = scope.userId;
  if (input.sourceType && input.sourceType !== "all") where.sourceType = input.sourceType;
  if (input.category && input.category !== "all") where.category = input.category;
  where.archiveStatus = input.archiveStatus && input.archiveStatus !== "all" ? input.archiveStatus : "active";
  const createdAt: any = {};
  const from = toDate(input.from);
  const to = toDate(input.to, true);
  if (from) createdAt.gte = from;
  if (to) createdAt.lte = to;
  if (Object.keys(createdAt).length) where.createdAt = createdAt;
  const cursorWhere = beforeDateIdWhere(cursor, "createdAt", "mediaId");
  if (Object.keys(cursorWhere).length) where.AND = [...(where.AND || []), cursorWhere];
  const rows = await table("adminMediaCatalog").findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { mediaId: "desc" }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  return {
    items: page.map(serializeMediaCatalog),
    nextCursor: rows.length > limit ? makeDateIdCursor(page[page.length - 1], "createdAt", "mediaId") : null,
    serverTime: new Date().toISOString(),
  };
}

function serializeMediaCatalog(row: any) {
  return {
    mediaId: row.mediaId,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    userId: row.userId,
    authUserId: row.authUserId,
    category: row.category,
    mimeType: row.mimeType,
    mediaKind: row.mediaKind,
    fileUrl: row.fileUrl,
    thumbUrl: row.thumbUrl,
    previewUrl: row.previewUrl,
    width: row.width,
    height: row.height,
    sizeBytes: row.sizeBytes || 0,
    storageProvider: row.storageProvider,
    selectedAt: toIso(row.selectedAt),
    archiveStatus: row.archiveStatus,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export async function getAdminV2DailyAnalytics(input: { from?: string | null; to?: string | null; groupBy?: string | null }) {
  const from = toDate(input.from) || adminStartOfDay(29);
  const to = toDate(input.to, true) || new Date();
  const groupBy = String(input.groupBy || "day");
  const rows = await table("adminDailyStats").findMany({
    where: { day: { gte: adminDayKey(from), lte: adminDayKey(to) } },
    orderBy: [{ day: "asc" }],
  });
  const map = new Map<string, any>();
  for (const row of rows) {
    const key = groupBy === "user" ? row.authUserId ? `auth:${row.authUserId}` : `guest:${row.userId}` : row.day;
    const current = map.get(key) || {
      key,
      day: groupBy === "day" ? row.day : null,
      userId: groupBy === "user" ? row.userId : null,
      authUserId: groupBy === "user" ? row.authUserId : null,
      taskCount: 0,
      successCount: 0,
      failedCount: 0,
      uploadCount: 0,
      outputCount: 0,
      storageBytesDelta: 0,
      totalStorageBytes: 0,
      assetCount: 0,
    };
    current.taskCount += row.taskCount;
    current.successCount += row.successCount;
    current.failedCount += row.failedCount;
    current.uploadCount += row.uploadCount;
    current.outputCount += row.outputCount;
    current.storageBytesDelta += bigintToNumber(row.storageBytesDelta);
    current.totalStorageBytes += bigintToNumber(row.totalStorageBytes);
    current.assetCount += row.assetCount;
    map.set(key, current);
  }
  return { items: Array.from(map.values()), serverTime: new Date().toISOString() };
}

function serializeDailyStats(row: any) {
  return {
    day: row.day,
    userId: row.userId,
    authUserId: row.authUserId,
    taskCount: row.taskCount,
    successCount: row.successCount,
    failedCount: row.failedCount,
    uploadCount: row.uploadCount,
    outputCount: row.outputCount,
    storageBytesDelta: bigintToNumber(row.storageBytesDelta),
    totalStorageBytes: bigintToNumber(row.totalStorageBytes),
    assetCount: row.assetCount,
    updatedAt: toIso(row.updatedAt),
  };
}

export async function getAdminV2ModelAnalytics(input: { from?: string | null; to?: string | null; provider?: string | null; model?: string | null; userId?: string | null }) {
  const from = toDate(input.from) || adminStartOfDay(29);
  const to = toDate(input.to, true) || new Date();
  const where: any = { day: { gte: adminDayKey(from), lte: adminDayKey(to) } };
  if (input.provider) where.provider = input.provider;
  if (input.model) where.model = input.model;
  if (input.userId) {
    const raw = String(input.userId);
    if (/^\d+$/.test(raw)) where.authUserId = Number(raw);
    else where.userId = raw;
  }
  const rows = await table("adminModelUsageDaily").findMany({
    where,
    orderBy: [{ day: "desc" }, { amount: "desc" }],
    take: 500,
  });
  return { items: rows.map(serializeModelUsage), serverTime: new Date().toISOString() };
}

function serializeModelUsage(row: any) {
  return {
    day: row.day,
    userId: row.userId,
    authUserId: row.authUserId,
    provider: row.provider,
    model: row.model,
    module: row.module,
    requestCount: row.requestCount,
    successCount: row.successCount,
    failedCount: row.failedCount,
    amount: decimalToNumber(row.amount),
    currency: row.currency,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    avgLatencyMs: row.avgLatencyMs,
    updatedAt: toIso(row.updatedAt),
  };
}

export async function listAdminV2StorageSnapshots(input: { from?: string | null; to?: string | null; scope?: string | null; pathKey?: string | null; limit?: number }) {
  const where: any = {};
  const snapshotAt: any = {};
  const from = toDate(input.from);
  const to = toDate(input.to, true);
  if (from) snapshotAt.gte = from;
  if (to) snapshotAt.lte = to;
  if (Object.keys(snapshotAt).length) where.snapshotAt = snapshotAt;
  if (input.scope) where.scope = input.scope;
  if (input.pathKey) where.pathKey = input.pathKey;
  const rows = await table("adminStorageSnapshot").findMany({
    where,
    orderBy: [{ snapshotAt: "desc" }, { id: "desc" }],
    take: safeAdminLimit(String(input.limit || ""), 100),
  });
  return {
    items: rows.map((row: any) => ({
      id: row.id,
      snapshotAt: toIso(row.snapshotAt),
      scope: row.scope,
      pathKey: row.pathKey,
      authUserId: row.authUserId,
      fileCount: row.fileCount,
      totalBytes: bigintToNumber(row.totalBytes),
      largestFileBytes: bigintToNumber(row.largestFileBytes),
      updatedAt: toIso(row.updatedAt),
    })),
    serverTime: new Date().toISOString(),
  };
}

export async function getAdminJob(jobId: string) {
  const row = await table("adminJob").findUnique({ where: { jobId } });
  return row ? serializeAdminJob(row) : null;
}

export async function listAdminJobs(input: { type?: string | null; status?: string | null; limit?: number }) {
  const where: any = {};
  if (input.type) where.type = input.type;
  if (input.status) where.status = input.status;
  const rows = await table("adminJob").findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    take: safeAdminLimit(String(input.limit || ""), 50),
  });
  return {
    items: rows.map(serializeAdminJob),
    serverTime: new Date().toISOString(),
  };
}

export async function listAdminAuditLogs(input: { operator?: string | null; action?: string | null; targetType?: string | null; from?: string | null; to?: string | null; cursor?: string | null; limit?: number }) {
  const limit = safeAdminLimit(String(input.limit || ""));
  const cursor = decodeCursor(input.cursor);
  const where: any = {};
  if (input.operator) where.operator = input.operator;
  if (input.action) where.action = input.action;
  if (input.targetType) where.targetType = input.targetType;
  const createdAt: any = {};
  const from = toDate(input.from);
  const to = toDate(input.to, true);
  if (from) createdAt.gte = from;
  if (to) createdAt.lte = to;
  if (Object.keys(createdAt).length) where.createdAt = createdAt;
  const cursorWhere = beforeDateIdWhere(cursor, "createdAt", "id");
  if (Object.keys(cursorWhere).length) where.AND = [...(where.AND || []), cursorWhere];
  const rows = await table("adminAuditLog").findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  return {
    items: page.map((row: any) => ({
      id: row.id,
      operator: row.operator,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      before: row.before || null,
      after: row.after || null,
      ip: row.ip,
      userAgent: row.userAgent,
      createdAt: toIso(row.createdAt),
    })),
    nextCursor: rows.length > limit ? makeDateIdCursor(page[page.length - 1], "createdAt", "id") : null,
    serverTime: new Date().toISOString(),
  };
}
