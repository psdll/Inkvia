import { Prisma, type PrismaClient } from "@prisma/client";
import { deleteOssObjects } from "@/lib/oss";

type RelayClaim = {
  id: string;
  objectKey: string;
};

async function claimRelayAssets(
  client: PrismaClient,
  input: { workerId: string; limit: number; now: Date; leaseUntil: Date },
) {
  return client.$transaction((tx) => tx.$queryRaw<RelayClaim[]>(Prisma.sql`
    WITH candidate AS (
      SELECT asset."id", asset."variants"->'relay'->>'objectKey' AS "objectKey"
      FROM "MediaAsset" asset
      WHERE asset."metadata"->>'origin' = 'tool_input'
        AND COALESCE(asset."variants"->'relay'->>'objectKey', '') <> ''
        AND (asset."leaseUntil" IS NULL OR asset."leaseUntil" <= ${input.now})
        AND EXISTS (
          SELECT 1
          FROM "GenerationInputMedia" linked
          WHERE linked."mediaId" = asset."id"
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "GenerationInputMedia" linked
          JOIN "Generation" generation ON generation."id" = linked."generationId"
          WHERE linked."mediaId" = asset."id"
            AND NOT (
              generation."status" IN ('success', 'failed')
              AND generation."finishedAt" IS NOT NULL
            )
        )
        AND (
          SELECT MAX(generation."finishedAt")
          FROM "GenerationInputMedia" linked
          JOIN "Generation" generation ON generation."id" = linked."generationId"
          WHERE linked."mediaId" = asset."id"
        ) <= ${input.now} - INTERVAL '30 minutes'
      ORDER BY asset."updatedAt" ASC
      LIMIT ${input.limit}
      FOR UPDATE OF asset SKIP LOCKED
    )
    UPDATE "MediaAsset" asset
    SET "leaseOwner" = ${input.workerId}, "leaseUntil" = ${input.leaseUntil},
        "updatedAt" = CURRENT_TIMESTAMP
    FROM candidate
    WHERE asset."id" = candidate."id"
    RETURNING asset."id"::text AS "id", candidate."objectKey"
  `), {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 5_000,
    timeout: 15_000,
  });
}

async function purgeClaimedRelay(
  client: PrismaClient,
  input: { claim: RelayClaim; workerId: string; now: Date },
) {
  return client.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<RelayClaim[]>(Prisma.sql`
      SELECT asset."id"::text AS "id", asset."variants"->'relay'->>'objectKey' AS "objectKey"
      FROM "MediaAsset" asset
      WHERE asset."id" = ${input.claim.id}::uuid
        AND asset."leaseOwner" = ${input.workerId}
        AND asset."metadata"->>'origin' = 'tool_input'
        AND asset."variants"->'relay'->>'objectKey' = ${input.claim.objectKey}
        AND EXISTS (
          SELECT 1
          FROM "GenerationInputMedia" linked
          WHERE linked."mediaId" = asset."id"
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "GenerationInputMedia" linked
          JOIN "Generation" generation ON generation."id" = linked."generationId"
          WHERE linked."mediaId" = asset."id"
            AND NOT (
              generation."status" IN ('success', 'failed')
              AND generation."finishedAt" IS NOT NULL
            )
        )
        AND (
          SELECT MAX(generation."finishedAt")
          FROM "GenerationInputMedia" linked
          JOIN "Generation" generation ON generation."id" = linked."generationId"
          WHERE linked."mediaId" = asset."id"
        ) <= ${input.now} - INTERVAL '30 minutes'
      FOR UPDATE OF asset
    `);
    if (!locked[0]) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "MediaAsset"
        SET "leaseOwner" = NULL, "leaseUntil" = NULL, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${input.claim.id}::uuid AND "leaseOwner" = ${input.workerId}
      `);
      return false;
    }

    await deleteOssObjects([input.claim.objectKey]);
    const updated = await tx.$executeRaw(Prisma.sql`
      UPDATE "MediaAsset"
      SET "variants" = "variants" - 'relay', "metadata" = "metadata" - 'relay',
          "leaseOwner" = NULL, "leaseUntil" = NULL, "failureCode" = NULL,
          "failureMessage" = NULL, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${input.claim.id}::uuid
        AND "leaseOwner" = ${input.workerId}
        AND "variants"->'relay'->>'objectKey' = ${input.claim.objectKey}
    `);
    return updated === 1;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 5_000,
    timeout: 60_000,
  });
}

export async function runToolMediaRelayMaintenanceBatch(
  client: PrismaClient,
  input: { workerId: string; limit?: number; now?: Date },
) {
  const now = input.now || new Date();
  const limit = Math.min(Math.max(Math.floor(input.limit || 25), 1), 100);
  const leaseUntil = new Date(now.getTime() + 5 * 60_000);
  const claims = await claimRelayAssets(client, {
    workerId: input.workerId,
    limit,
    now,
    leaseUntil,
  });
  let purged = 0;
  let failed = 0;
  for (const claim of claims) {
    try {
      if (await purgeClaimedRelay(client, { claim, workerId: input.workerId, now })) {
        purged += 1;
      }
    } catch (error: any) {
      failed += 1;
      await client.$executeRaw(Prisma.sql`
        UPDATE "MediaAsset"
        SET "failureCode" = 'TOOL_MEDIA_RELAY_DELETE_FAILED',
            "failureMessage" = ${String(error?.message || error).slice(0, 4_000)},
            "leaseUntil" = ${leaseUntil}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${claim.id}::uuid AND "leaseOwner" = ${input.workerId}
      `).catch(() => undefined);
    }
  }
  return { claimed: claims.length, purged, failed };
}
