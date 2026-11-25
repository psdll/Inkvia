import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { canvasTrashRetentionCutoff } from "@/lib/canvas/trash-retention-config";

type TrashCandidate = {
  id: number;
  authUserId: number;
};

type AffectedMedia = {
  mediaId: string;
};

export type CanvasTrashPurgeResult = {
  deletedCanvases: number;
  releasedMediaReferences: number;
  deletedUndoMediaHolds: number;
  affectedMediaAssets: number;
};

const EMPTY_RESULT: CanvasTrashPurgeResult = {
  deletedCanvases: 0,
  releasedMediaReferences: 0,
  deletedUndoMediaHolds: 0,
  affectedMediaAssets: 0,
};

export async function purgeExpiredCanvasTrashBatch(
  client: PrismaClient,
  input: { now?: Date; limit?: number } = {},
): Promise<CanvasTrashPurgeResult> {
  const now = input.now ?? new Date();
  const cutoff = canvasTrashRetentionCutoff(now);
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 20), 1), 100);

  return client.$transaction(async (tx) => {
    const candidates = await tx.$queryRaw<TrashCandidate[]>(Prisma.sql`
      SELECT "id", "authUserId"
      FROM "Canvas"
      WHERE "deletedAt" <= ${cutoff}
      ORDER BY "deletedAt" ASC, "id" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `);
    if (!candidates.length) return EMPTY_RESULT;

    const canvasIds = candidates.map((candidate) => candidate.id);
    const currentReferenceClauses = canvasIds.map((canvasId) => (
      Prisma.sql`reference."sourceId" LIKE ${`canvas:${canvasId}:node:%`}`
    ));
    const currentReferences = Prisma.join(currentReferenceClauses, " OR ");
    const affectedMedia = await tx.$queryRaw<AffectedMedia[]>(Prisma.sql`
      SELECT DISTINCT affected."mediaId"
      FROM (
        SELECT reference."mediaId"::text AS "mediaId"
        FROM "MediaReference" reference
        WHERE (
          reference."sourceType" = 'canvas_current'
          AND (${currentReferences})
        ) OR (
          reference."sourceType" = 'canvas_snapshot'
          AND reference."sourceId" IN (
            SELECT 'snapshot:' || snapshot."id"::text
            FROM "CanvasSnapshot" snapshot
            WHERE snapshot."canvasId" IN (${Prisma.join(canvasIds)})
          )
        )
        UNION
        SELECT output."mediaId"::text AS "mediaId"
        FROM "CanvasRunOutput" output
        JOIN "CanvasRunStep" step ON step."id" = output."runStepId"
        JOIN "CanvasRun" run ON run."id" = step."runId"
        WHERE run."canvasId" IN (${Prisma.join(canvasIds)})
          AND output."mediaId" IS NOT NULL
        UNION
        SELECT hold."mediaId"::text AS "mediaId"
        FROM "CanvasUndoMediaHold" hold
        WHERE hold."canvasId" IN (${Prisma.join(canvasIds)})
          AND hold."mediaId" IS NOT NULL
      ) affected
    `);
    const affectedMediaIds = [...new Set(
      affectedMedia.map((item) => item.mediaId.toLowerCase()),
    )];

    const releasedMediaReferences = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "MediaReference" reference
      WHERE (
        reference."sourceType" = 'canvas_current'
        AND (${currentReferences})
      ) OR (
        reference."sourceType" = 'canvas_snapshot'
        AND reference."sourceId" IN (
          SELECT 'snapshot:' || snapshot."id"::text
          FROM "CanvasSnapshot" snapshot
          WHERE snapshot."canvasId" IN (${Prisma.join(canvasIds)})
        )
      )
    `);
    const deletedUndoMediaHolds = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "CanvasUndoMediaHold"
      WHERE "canvasId" IN (${Prisma.join(canvasIds)})
    `);
    const deletedCanvases = await tx.$executeRaw(Prisma.sql`
      DELETE FROM "Canvas"
      WHERE "id" IN (${Prisma.join(canvasIds)})
        AND "deletedAt" <= ${cutoff}
    `);

    if (affectedMediaIds.length) {
      const mediaIds = Prisma.join(
        affectedMediaIds.map((mediaId) => Prisma.sql`${mediaId}::uuid`),
      );
      await tx.$executeRaw(Prisma.sql`
        UPDATE "MediaAsset" asset
        SET "referenceCount" = (
          SELECT COUNT(*)::integer
          FROM "MediaReference" reference
          WHERE reference."mediaId" = asset."id"
        ), "updatedAt" = CURRENT_TIMESTAMP
        WHERE asset."id" IN (${mediaIds})
      `);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "MediaAsset"
        SET "status" = 'soft_deleted',
          "retentionUntil" = CURRENT_TIMESTAMP,
          "softDeletedAt" = COALESCE("softDeletedAt", CURRENT_TIMESTAMP),
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" IN (${mediaIds})
          AND "referenceCount" = 0
          AND "status" IN ('ready', 'soft_deleted')
          AND NOT EXISTS (
            SELECT 1
            FROM "GenerationInputMedia" input
            WHERE input."mediaId" = "MediaAsset"."id"
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "ImageBatchMedia" batch
            WHERE batch."mediaId" = "MediaAsset"."id"
          )
      `);
    }

    return {
      deletedCanvases,
      releasedMediaReferences,
      deletedUndoMediaHolds,
      affectedMediaAssets: affectedMediaIds.length,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 5_000,
    timeout: 30_000,
  });
}
