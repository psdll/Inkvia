import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { collectMediaRefs, deleteStoredMediaRefs } from "@/lib/media-cleanup";
import { canvasMetrics } from "@/lib/canvas/observability";
import { deleteOssObjects } from "@/lib/oss";
import { isToolInputMedia } from "@/lib/tool-media/lifecycle";

type ClaimedMediaAsset = {
  id: string;
  storageProvider: string;
  originalKey: string | null;
  publicUrl: string | null;
  variants: unknown;
  metadata: unknown;
};

function toolRelayObjectKey(variants: unknown) {
  if (!variants || typeof variants !== "object" || !("relay" in variants)) return "";
  const relay = variants.relay;
  if (!relay || typeof relay !== "object" || !("objectKey" in relay)) return "";
  return String(relay.objectKey || "").trim();
}

async function claimGcAssets(
  client: PrismaClient,
  input: { workerId: string; limit: number; leaseUntil: Date; now: Date },
): Promise<ClaimedMediaAsset[]> {
  // Prisma DateTime columns store UTC without a zone. Bind UTC timestamp values
  // explicitly so a non-UTC database session cannot shorten the retention window.
  return client.$transaction((tx) => tx.$queryRaw<ClaimedMediaAsset[]>(Prisma.sql`
    WITH candidate AS (
      SELECT "id" FROM "MediaAsset"
      WHERE "referenceCount" = 0
        AND NOT EXISTS (
          SELECT 1 FROM "GenerationInputMedia" input
          WHERE input."mediaId" = "MediaAsset"."id"
        )
        AND NOT EXISTS (
          SELECT 1 FROM "CanvasUndoMediaHold" hold
          WHERE hold."mediaId" = "MediaAsset"."id"
            AND hold."expiresAt" > ${input.now.toISOString()}::timestamp
        )
        AND (
          ("status" IN ('initiated', 'failed', 'soft_deleted', 'ready') AND "retentionUntil" <= ${input.now.toISOString()}::timestamp)
          OR ("status" = 'purging' AND ("leaseUntil" IS NULL OR "leaseUntil" <= ${input.now.toISOString()}::timestamp))
        )
      ORDER BY "retentionUntil" ASC NULLS LAST, "createdAt" ASC
      LIMIT ${input.limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "MediaAsset" asset
    SET "status" = 'purging', "leaseOwner" = ${input.workerId}, "leaseUntil" = ${input.leaseUntil.toISOString()}::timestamp,
        "attempts" = "attempts" + 1, "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    FROM candidate
    WHERE asset."id" = candidate."id"
    RETURNING asset."id"::text AS "id", asset."storageProvider", asset."originalKey",
              asset."publicUrl", asset."variants", asset."metadata"
  `), {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 5000,
    timeout: 15000,
  });
}

export async function runCanvasMediaGcBatch(
  client: PrismaClient,
  input: { workerId: string; limit?: number; now?: Date },
) {
  const now = input.now ?? new Date();
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 25), 1), 100);
  const leaseUntil = new Date(now.getTime() + 5 * 60_000);
  const assets = await claimGcAssets(client, { workerId: input.workerId, limit, leaseUntil, now });
  let purged = 0;
  let failed = 0;
  for (const asset of assets) {
    try {
      const relayKey = isToolInputMedia(asset.metadata) ? toolRelayObjectKey(asset.variants) : "";
      if (relayKey) await deleteOssObjects([relayKey]);
      if (asset.storageProvider === "oss") {
        const keys = [asset.originalKey].filter((value): value is string => Boolean(value));
        if (keys.length) await deleteOssObjects(keys);
      }
      const refs = new Set<string>();
      if (asset.storageProvider !== "oss") collectMediaRefs(asset.originalKey, refs);
      collectMediaRefs(asset.publicUrl, refs);
      collectMediaRefs(asset.variants, refs);
      const cleanup = await deleteStoredMediaRefs([...refs], {
        canonicalGenerationOutputs: true,
        canonicalGenerationMediaIds: [asset.id],
        localOnly: asset.storageProvider === "local",
      });
      if (cleanup.ossError || cleanup.failedOssKeys.length || cleanup.skippedProtectedRefsCount) {
        throw new Error(cleanup.ossError || "media object remains protected or failed to delete");
      }
      const updated = await client.$executeRaw(Prisma.sql`
        UPDATE "MediaAsset"
        SET "status" = 'purged', "originalKey" = NULL, "publicUrl" = NULL,
            "variants" = '{}'::jsonb, "metadata" = jsonb_build_object('purgedBy', ${input.workerId}),
            "leaseOwner" = NULL, "leaseUntil" = NULL, "purgedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
            "failureCode" = NULL, "failureMessage" = NULL, "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        WHERE "id" = ${asset.id}::uuid AND "status" = 'purging' AND "leaseOwner" = ${input.workerId}
          AND "referenceCount" = 0
          AND NOT EXISTS (
            SELECT 1 FROM "GenerationInputMedia" input
            WHERE input."mediaId" = "MediaAsset"."id"
          )
          AND NOT EXISTS (
            SELECT 1 FROM "CanvasUndoMediaHold" hold
            WHERE hold."mediaId" = "MediaAsset"."id"
              AND hold."expiresAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
          )
      `);
      if (updated === 1) purged += 1;
    } catch (error: any) {
      failed += 1;
      await client.$executeRaw(Prisma.sql`
        UPDATE "MediaAsset"
        SET "failureCode" = 'MEDIA_GC_FAILED', "failureMessage" = ${String(error?.message || error).slice(0, 4_000)},
            "leaseUntil" = ${new Date(Date.now() + 5 * 60_000).toISOString()}::timestamp,
            "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        WHERE "id" = ${asset.id}::uuid AND "status" = 'purging' AND "leaseOwner" = ${input.workerId}
      `).catch(() => undefined);
    }
  }
  canvasMetrics.increment("canvas_media_gc_failure_total", failed);
  return { claimed: assets.length, purged, failed };
}
