import { createGuardedPrismaClient } from "./lib/runtime-isolation.cjs";
import { PrismaClient } from "@prisma/client";
import { buildAdminWorkFeedProjectionCtes } from "../lib/admin-work-feed-projection-sql.mjs";

if (!process.argv.includes("--apply")) {
  throw new Error("refusing read-model backfill without --apply");
}

const prisma = createGuardedPrismaClient();
const batchSize = 1_000;
const backfillVersion = 2;
const backfillStateKey = "admin_read_model_backfill_state_v2";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withWorkerLease(work, options = {}) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const transactionOptions = { maxWait: 30_000, timeout: options.timeout || 60_000 };
    if (options.isolationLevel) transactionOptions.isolationLevel = options.isolationLevel;
    const leased = await prisma.$transaction(async (tx) => {
      const leaseRows = await tx.$queryRawUnsafe(
        `SELECT pg_try_advisory_xact_lock(hashtextextended('admin-work-feed-event-worker', 0)) AS acquired`,
      );
      if (leaseRows?.[0]?.acquired !== true) return { acquired: false };
      return { acquired: true, value: await work(tx) };
    }, transactionOptions);
    if (leased.acquired) return leased.value;
    await delay(250);
  }
  throw new Error("worker lease is already held");
}

try {
  const snapshot = await withWorkerLease(async (tx) => {
    const [highWaterRows, eventHighWaterRows, stateRow] = await Promise.all([
      tx.$queryRawUnsafe(`SELECT COALESCE(MAX("id"), 0)::int AS id FROM "Generation"`),
      tx.$queryRawUnsafe(`SELECT COALESCE(MAX("id"), 0)::int AS id FROM "AdminEvent"`),
      tx.appSetting.findUnique({ where: { key: backfillStateKey } }),
    ]);
    let state = {};
    try { state = JSON.parse(String(stateRow?.value || "{}")); } catch {}
    return {
      highWater: Math.max(0, Number(highWaterRows?.[0]?.id) || 0),
      eventHighWater: Math.max(0, Number(eventHighWaterRows?.[0]?.id) || 0),
      cursor: Number(state?.version) === backfillVersion ? Math.max(0, Number(state?.cursor) || 0) : 0,
    };
  });
  const highWater = snapshot.highWater;
  const eventHighWater = snapshot.eventHighWater;
  let cursor = Math.min(highWater, snapshot.cursor);
  let workFeedRows = 0;
  const batchProjectionCtes = buildAdminWorkFeedProjectionCtes(
    `SELECT generation.*
     FROM "Generation" AS generation
     WHERE generation."id" > $1 AND generation."id" <= $2
     ORDER BY generation."id" ASC
     LIMIT $3`,
    { prefix: "work_feed_batch", finalName: "batch" },
  );
  while (cursor < highWater) {
    const batch = await withWorkerLease(async (tx) => {
      const rows = await tx.$queryRawUnsafe(
      `WITH ${batchProjectionCtes}, applied AS (
         INSERT INTO "AdminWorkFeed" (
         "generationId", "sourceEventId", "userId", "authUserId", "type", "status", "source",
         "provider", "model", "mediaKind", "thumbUrl", "previewUrl", "displayUrl", "posterUrl",
         "sizeBytes", "sizeBytes64", "errorCode", "errorMsg",
         "createdAt", "finishedAt", "updatedAt", "deletedAt"
         )
         SELECT batch."id", 0, batch."userId", batch."authUserId", batch."type",
                batch."status", batch."source", batch."externalProvider", batch."model",
                batch."projectedMediaKind", batch."projectedThumbUrl", batch."projectedPreviewUrl",
                batch."projectedDisplayUrl", batch."projectedPosterUrl", batch."sizeBytes",
                batch."sizeBytes"::bigint, batch."projectedErrorCode", batch."errorMsg",
                batch."createdAt", batch."finishedAt", batch."updatedAt", NULL
         FROM batch
         ON CONFLICT ("generationId") DO UPDATE SET
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
           "deletedAt" = NULL
         WHERE "AdminWorkFeed"."sourceEventId" = 0
           AND (("AdminWorkFeed"."userId", "AdminWorkFeed"."authUserId", "AdminWorkFeed"."type",
                "AdminWorkFeed"."status", "AdminWorkFeed"."source", "AdminWorkFeed"."provider",
                "AdminWorkFeed"."model", "AdminWorkFeed"."mediaKind", "AdminWorkFeed"."thumbUrl",
                "AdminWorkFeed"."previewUrl", "AdminWorkFeed"."displayUrl", "AdminWorkFeed"."posterUrl",
                "AdminWorkFeed"."sizeBytes64", "AdminWorkFeed"."errorCode", "AdminWorkFeed"."errorMsg",
                "AdminWorkFeed"."createdAt", "AdminWorkFeed"."finishedAt",
                "AdminWorkFeed"."updatedAt", "AdminWorkFeed"."deletedAt")
               IS DISTINCT FROM
               (EXCLUDED."userId", EXCLUDED."authUserId", EXCLUDED."type", EXCLUDED."status",
                EXCLUDED."source", EXCLUDED."provider", EXCLUDED."model", EXCLUDED."mediaKind",
                EXCLUDED."thumbUrl", EXCLUDED."previewUrl", EXCLUDED."displayUrl", EXCLUDED."posterUrl",
                EXCLUDED."sizeBytes64", EXCLUDED."errorCode", EXCLUDED."errorMsg", EXCLUDED."createdAt",
                EXCLUDED."finishedAt", EXCLUDED."updatedAt", NULL))
         RETURNING "generationId"
       )
       SELECT COALESCE((SELECT MAX("id") FROM batch), $1)::int AS cursor,
              (SELECT COUNT(*)::int FROM applied) AS rows`,
      cursor,
      highWater,
        batchSize,
      );
      const nextCursor = Math.max(cursor, Number(rows?.[0]?.cursor) || cursor);
      await tx.appSetting.upsert({
        where: { key: backfillStateKey },
        create: {
          key: backfillStateKey,
          value: JSON.stringify({ version: backfillVersion, cursor: nextCursor, highWater, eventHighWater, completed: false }),
        },
        update: {
          value: JSON.stringify({ version: backfillVersion, cursor: nextCursor, highWater, eventHighWater, completed: false }),
        },
      });
      return rows;
    });
    const nextCursor = Math.max(cursor, Number(batch?.[0]?.cursor) || cursor);
    if (nextCursor <= cursor) throw new Error(`read-model backfill made no progress after ${cursor}`);
    workFeedRows += Math.max(0, Number(batch?.[0]?.rows) || 0);
    cursor = nextCursor;
  }

  const finalProjectionCtes = buildAdminWorkFeedProjectionCtes(
    `SELECT generation.* FROM "Generation" AS generation`,
    { prefix: "work_feed_final", finalName: "source" },
  );
  const result = await withWorkerLease(async (tx) => {
    const marker = new Date();
    const finalRows = await tx.$queryRawUnsafe(
      `WITH ${finalProjectionCtes}, applied AS (
         INSERT INTO "AdminWorkFeed" (
           "generationId", "sourceEventId", "userId", "authUserId", "type", "status", "source",
           "provider", "model", "mediaKind", "thumbUrl", "previewUrl", "displayUrl", "posterUrl",
           "sizeBytes", "sizeBytes64", "errorCode", "errorMsg",
           "createdAt", "finishedAt", "updatedAt", "deletedAt"
         )
         SELECT source."id", 0, source."userId", source."authUserId", source."type", source."status",
                source."source", source."externalProvider", source."model", source."projectedMediaKind",
                source."projectedThumbUrl", source."projectedPreviewUrl", source."projectedDisplayUrl",
                source."projectedPosterUrl", source."sizeBytes", source."sizeBytes"::bigint,
                source."projectedErrorCode", source."errorMsg", source."createdAt", source."finishedAt",
                source."updatedAt", NULL
         FROM source
         ON CONFLICT ("generationId") DO UPDATE SET
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
           "deletedAt" = NULL
         WHERE ("AdminWorkFeed"."userId", "AdminWorkFeed"."authUserId", "AdminWorkFeed"."type",
                "AdminWorkFeed"."status", "AdminWorkFeed"."source", "AdminWorkFeed"."provider",
                "AdminWorkFeed"."model", "AdminWorkFeed"."mediaKind", "AdminWorkFeed"."thumbUrl",
                "AdminWorkFeed"."previewUrl", "AdminWorkFeed"."displayUrl", "AdminWorkFeed"."posterUrl",
                "AdminWorkFeed"."sizeBytes64", "AdminWorkFeed"."errorCode", "AdminWorkFeed"."errorMsg",
                "AdminWorkFeed"."createdAt", "AdminWorkFeed"."finishedAt", "AdminWorkFeed"."updatedAt",
                "AdminWorkFeed"."deletedAt")
               IS DISTINCT FROM
               (EXCLUDED."userId", EXCLUDED."authUserId", EXCLUDED."type", EXCLUDED."status",
                EXCLUDED."source", EXCLUDED."provider", EXCLUDED."model", EXCLUDED."mediaKind",
                EXCLUDED."thumbUrl", EXCLUDED."previewUrl", EXCLUDED."displayUrl", EXCLUDED."posterUrl",
                EXCLUDED."sizeBytes64", EXCLUDED."errorCode", EXCLUDED."errorMsg", EXCLUDED."createdAt",
                EXCLUDED."finishedAt", EXCLUDED."updatedAt", NULL)
         RETURNING "generationId"
       )
       SELECT COUNT(*)::int AS rows FROM applied`,
    );
    workFeedRows += Math.max(0, Number(finalRows?.[0]?.rows) || 0);
    await tx.$executeRawUnsafe(
      `UPDATE "AdminWorkFeed" AS feed
       SET "status" = 'deleted', "deletedAt" = $1, "updatedAt" = $1
       WHERE feed."deletedAt" IS NULL
         AND NOT EXISTS (SELECT 1 FROM "Generation" WHERE "Generation"."id" = feed."generationId")`,
      marker,
    );
    await tx.$executeRawUnsafe(
      `WITH latest_event AS (
         SELECT "entityId"::int AS "generationId", MAX("id")::int AS "sourceEventId"
         FROM "AdminEvent"
         WHERE "id" <= $1 AND "entityType" = 'generation' AND "entityId" ~ '^[0-9]+$'
         GROUP BY "entityId"
       )
       UPDATE "AdminWorkFeed" AS feed
       SET "sourceEventId" = GREATEST(feed."sourceEventId", latest_event."sourceEventId")
       FROM latest_event
       WHERE feed."generationId" = latest_event."generationId"
         AND feed."sourceEventId" < latest_event."sourceEventId"`,
      eventHighWater,
    );
    await tx.$queryRawUnsafe(
      `WITH identity_links AS (
         SELECT "userId", MIN("authUserId")::int AS "linkedAuthUserId"
         FROM "AdminWorkFeed"
         WHERE "deletedAt" IS NULL AND "authUserId" IS NOT NULL
         GROUP BY "userId" HAVING COUNT(DISTINCT "authUserId") = 1
       ), normalized AS (
         SELECT feed.*, COALESCE(feed."authUserId", identity_links."linkedAuthUserId") AS "effectiveAuthUserId"
         FROM "AdminWorkFeed" AS feed
         LEFT JOIN identity_links ON identity_links."userId" = feed."userId"
         WHERE feed."deletedAt" IS NULL
       ), expected AS MATERIALIZED (
         SELECT
           to_char("createdAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') || '|' ||
             CASE WHEN "effectiveAuthUserId" IS NULL THEN 'guest:' || "userId"
                  ELSE 'auth:' || "effectiveAuthUserId"::text END AS "bucketKey",
           to_char("createdAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS "day",
           "effectiveAuthUserId" AS "authUserId",
           CASE WHEN "effectiveAuthUserId" IS NULL THEN "userId" ELSE "effectiveAuthUserId"::text END AS "userId",
           COUNT(*)::int AS "generationCount",
           COUNT(*) FILTER (WHERE "type" <> 'import' AND "status" = 'success')::int AS "successCount",
           COUNT(*) FILTER (WHERE "type" <> 'import' AND "status" = 'failed')::int AS "failedCount",
           COUNT(*) FILTER (WHERE "type" <> 'import' AND lower("type") LIKE '%image%')::int AS "imageCount",
           COUNT(*) FILTER (WHERE "type" <> 'import' AND lower("type") LIKE '%video%')::int AS "videoCount",
           COUNT(*) FILTER (WHERE "type" <> 'import' AND lower("type") LIKE '%face%')::int AS "faceCount",
           COUNT(*) FILTER (WHERE "type" <> 'import' AND lower("type") NOT LIKE '%image%' AND lower("type") NOT LIKE '%video%' AND lower("type") NOT LIKE '%face%')::int AS "otherCount",
           COALESCE(SUM("sizeBytes64"), 0)::bigint AS "storageBytes"
         FROM normalized GROUP BY 1, 2, "effectiveAuthUserId", 4
       ), daily_upsert AS (
         INSERT INTO "AnalyticsDailyByUser" (
           "bucketKey", "day", "authUserId", "userId", "generationCount", "successCount", "failedCount",
           "imageCount", "videoCount", "faceCount", "otherCount", "storageBytes", "updatedAt"
         ) SELECT "bucketKey", "day", "authUserId", "userId", "generationCount", "successCount", "failedCount",
                  "imageCount", "videoCount", "faceCount", "otherCount", "storageBytes", $1
           FROM expected
         ON CONFLICT ("bucketKey") DO UPDATE SET
           "day" = EXCLUDED."day", "authUserId" = EXCLUDED."authUserId", "userId" = EXCLUDED."userId",
           "generationCount" = EXCLUDED."generationCount", "successCount" = EXCLUDED."successCount",
           "failedCount" = EXCLUDED."failedCount", "imageCount" = EXCLUDED."imageCount",
           "videoCount" = EXCLUDED."videoCount", "faceCount" = EXCLUDED."faceCount",
           "otherCount" = EXCLUDED."otherCount", "storageBytes" = EXCLUDED."storageBytes", "updatedAt" = EXCLUDED."updatedAt"
         WHERE ("AnalyticsDailyByUser"."day", "AnalyticsDailyByUser"."authUserId", "AnalyticsDailyByUser"."userId",
                "AnalyticsDailyByUser"."generationCount", "AnalyticsDailyByUser"."successCount",
                "AnalyticsDailyByUser"."failedCount", "AnalyticsDailyByUser"."imageCount",
                "AnalyticsDailyByUser"."videoCount", "AnalyticsDailyByUser"."faceCount",
                "AnalyticsDailyByUser"."otherCount", "AnalyticsDailyByUser"."storageBytes")
               IS DISTINCT FROM
               (EXCLUDED."day", EXCLUDED."authUserId", EXCLUDED."userId", EXCLUDED."generationCount",
                EXCLUDED."successCount", EXCLUDED."failedCount", EXCLUDED."imageCount", EXCLUDED."videoCount",
                EXCLUDED."faceCount", EXCLUDED."otherCount", EXCLUDED."storageBytes")
         RETURNING "bucketKey"
       ), daily_deleted AS (
         DELETE FROM "AnalyticsDailyByUser" AS daily
         WHERE NOT EXISTS (SELECT 1 FROM expected WHERE expected."bucketKey" = daily."bucketKey")
         RETURNING daily."bucketKey"
       )
       SELECT (SELECT COUNT(*)::int FROM daily_upsert) AS upserted,
              (SELECT COUNT(*)::int FROM daily_deleted) AS deleted`,
      marker,
    );
    const summaryRows = await tx.$executeRawUnsafe(
      `WITH identity_links AS (
         SELECT "userId", MIN("authUserId")::int AS "linkedAuthUserId"
         FROM "AdminWorkFeed" WHERE "deletedAt" IS NULL AND "authUserId" IS NOT NULL
         GROUP BY "userId" HAVING COUNT(DISTINCT "authUserId") = 1
       ), normalized AS (
         SELECT feed.*, COALESCE(feed."authUserId", identity_links."linkedAuthUserId") AS "effectiveAuthUserId"
         FROM "AdminWorkFeed" AS feed
         LEFT JOIN identity_links ON identity_links."userId" = feed."userId"
         WHERE feed."deletedAt" IS NULL
       ), generated AS (
         SELECT
           CASE WHEN "effectiveAuthUserId" IS NULL THEN 'guest:' || "userId"
                ELSE 'auth:' || "effectiveAuthUserId"::text END AS "adminKey",
           CASE WHEN "effectiveAuthUserId" IS NULL THEN "userId"
                ELSE "effectiveAuthUserId"::text END AS "userId",
           "effectiveAuthUserId" AS "authUserId",
           COUNT(*)::int AS "totalTaskCount",
           COUNT(*) FILTER (WHERE "status" = 'success')::int AS "successTaskCount",
           COUNT(*) FILTER (WHERE "status" = 'failed')::int AS "failedTaskCount",
           COUNT(*) FILTER (WHERE "type" <> 'import')::int AS "assetCount",
           COALESCE(SUM("sizeBytes64"), 0)::bigint AS "storageBytes",
           COUNT(*) FILTER (
             WHERE to_char("createdAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') =
                   to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')
           )::int AS "todayTaskCount",
           COUNT(*) FILTER (
             WHERE to_char("createdAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') >=
                   to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai') - INTERVAL '6 days', 'YYYY-MM-DD')
           )::int AS "last7TaskCount",
           COUNT(*) FILTER (
             WHERE to_char("createdAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') >=
                   to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai') - INTERVAL '29 days', 'YYYY-MM-DD')
           )::int AS "last30TaskCount",
           COUNT(*) FILTER (
             WHERE "type" <> 'import' AND "status" = 'success'
               AND to_char("createdAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') >=
                   to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai') - INTERVAL '29 days', 'YYYY-MM-DD')
           )::int AS "successCount30d",
           COUNT(*) FILTER (
             WHERE "type" <> 'import' AND "status" = 'failed'
               AND to_char("createdAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') >=
                   to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai') - INTERVAL '29 days', 'YYYY-MM-DD')
           )::int AS "failedCount30d",
           MAX("createdAt") AS "lastActiveAt",
           jsonb_agg(DISTINCT "userId") AS "linkedUserIds"
         FROM normalized GROUP BY 1, 2, "effectiveAuthUserId"
       ), summary_rows AS (
         SELECT generated."adminKey", generated."userId", generated."authUserId", users."username",
                generated."lastActiveAt", generated."todayTaskCount", generated."last7TaskCount",
                generated."last30TaskCount", generated."totalTaskCount", generated."successTaskCount",
                generated."failedTaskCount",
                CASE WHEN generated."successCount30d" + generated."failedCount30d" > 0
                     THEN (ROUND(1000.0 * generated."successCount30d" /
                                (generated."successCount30d" + generated."failedCount30d")) / 10.0)::double precision
                     ELSE 0::double precision END AS "successRate30d",
                generated."failedCount30d", generated."storageBytes", generated."assetCount",
                GREATEST(1, jsonb_array_length(generated."linkedUserIds"))::int AS "deviceCount",
                generated."linkedUserIds"
         FROM generated LEFT JOIN "User" AS users ON users."id" = generated."authUserId"
         UNION ALL
         SELECT 'auth:' || users."id"::text, users."id"::text, users."id", users."username",
                users."createdAt", 0, 0, 0, 0, 0, 0, 0::double precision, 0, 0::bigint, 0, 1,
                jsonb_build_array(users."id"::text)
         FROM "User" AS users
         WHERE NOT EXISTS (SELECT 1 FROM generated WHERE generated."adminKey" = 'auth:' || users."id"::text)
       )
       INSERT INTO "AdminUserSummary" (
         "adminKey", "userId", "authUserId", "username", "lastActiveAt", "todayTaskCount",
         "last7TaskCount", "last30TaskCount", "totalTaskCount", "successTaskCount", "failedTaskCount",
         "successRate30d", "failedCount30d", "storageBytes", "assetCount", "deviceCount", "linkedUserIds",
         "updatedAt", "createdAt"
       )
       SELECT "adminKey", "userId", "authUserId", "username", "lastActiveAt", "todayTaskCount",
              "last7TaskCount", "last30TaskCount", "totalTaskCount", "successTaskCount", "failedTaskCount",
              "successRate30d", "failedCount30d", "storageBytes", "assetCount", "deviceCount", "linkedUserIds",
              $1, $1
       FROM summary_rows
       ON CONFLICT ("adminKey") DO UPDATE SET
         "userId" = EXCLUDED."userId",
         "authUserId" = EXCLUDED."authUserId",
         "username" = EXCLUDED."username",
         "lastActiveAt" = EXCLUDED."lastActiveAt",
         "todayTaskCount" = EXCLUDED."todayTaskCount",
         "last7TaskCount" = EXCLUDED."last7TaskCount",
         "last30TaskCount" = EXCLUDED."last30TaskCount",
         "totalTaskCount" = EXCLUDED."totalTaskCount",
         "successTaskCount" = EXCLUDED."successTaskCount",
         "failedTaskCount" = EXCLUDED."failedTaskCount",
         "successRate30d" = EXCLUDED."successRate30d",
         "failedCount30d" = EXCLUDED."failedCount30d",
         "storageBytes" = EXCLUDED."storageBytes",
         "assetCount" = EXCLUDED."assetCount",
         "deviceCount" = EXCLUDED."deviceCount",
         "linkedUserIds" = EXCLUDED."linkedUserIds",
         "deletedAt" = NULL,
         "updatedAt" = EXCLUDED."updatedAt"
       WHERE ("AdminUserSummary"."userId", "AdminUserSummary"."authUserId", "AdminUserSummary"."username",
              "AdminUserSummary"."lastActiveAt", "AdminUserSummary"."todayTaskCount", "AdminUserSummary"."last7TaskCount",
              "AdminUserSummary"."last30TaskCount", "AdminUserSummary"."totalTaskCount",
              "AdminUserSummary"."successTaskCount", "AdminUserSummary"."failedTaskCount",
              "AdminUserSummary"."successRate30d", "AdminUserSummary"."failedCount30d",
              "AdminUserSummary"."storageBytes", "AdminUserSummary"."assetCount", "AdminUserSummary"."deviceCount",
              "AdminUserSummary"."linkedUserIds", "AdminUserSummary"."deletedAt")
             IS DISTINCT FROM
             (EXCLUDED."userId", EXCLUDED."authUserId", EXCLUDED."username", EXCLUDED."lastActiveAt",
              EXCLUDED."todayTaskCount", EXCLUDED."last7TaskCount", EXCLUDED."last30TaskCount",
              EXCLUDED."totalTaskCount", EXCLUDED."successTaskCount", EXCLUDED."failedTaskCount",
              EXCLUDED."successRate30d", EXCLUDED."failedCount30d", EXCLUDED."storageBytes", EXCLUDED."assetCount",
              EXCLUDED."deviceCount", EXCLUDED."linkedUserIds", NULL)`,
      marker,
    );
    await tx.$executeRawUnsafe(
      `WITH identity_links AS (
         SELECT "userId", MIN("authUserId")::int AS "linkedAuthUserId"
         FROM "AdminWorkFeed" WHERE "deletedAt" IS NULL AND "authUserId" IS NOT NULL
         GROUP BY "userId" HAVING COUNT(DISTINCT "authUserId") = 1
       ), active_keys AS (
         SELECT DISTINCT CASE
           WHEN COALESCE(feed."authUserId", identity_links."linkedAuthUserId") IS NULL
             THEN 'guest:' || feed."userId"
           ELSE 'auth:' || COALESCE(feed."authUserId", identity_links."linkedAuthUserId")::text
         END AS "adminKey"
         FROM "AdminWorkFeed" AS feed
         LEFT JOIN identity_links ON identity_links."userId" = feed."userId"
         WHERE feed."deletedAt" IS NULL
         UNION
         SELECT 'auth:' || "id"::text FROM "User"
       )
       UPDATE "AdminUserSummary" AS summary
       SET "deletedAt" = $1, "lastActiveAt" = NULL,
           "todayTaskCount" = 0, "last7TaskCount" = 0, "last30TaskCount" = 0,
           "totalTaskCount" = 0, "successTaskCount" = 0, "failedTaskCount" = 0,
           "successRate30d" = 0, "failedCount30d" = 0, "storageBytes" = 0,
           "assetCount" = 0, "materialCount" = 0, "modelCost30d" = 0, "updatedAt" = $1
       WHERE summary."deletedAt" IS NULL
         AND NOT EXISTS (SELECT 1 FROM active_keys WHERE active_keys."adminKey" = summary."adminKey")`,
      marker,
    );
    const workFeedDiffRows = await tx.$queryRawUnsafe(
      `WITH ${finalProjectionCtes}
       SELECT COUNT(*)::bigint AS count
       FROM source
       FULL OUTER JOIN "AdminWorkFeed" AS feed ON feed."generationId" = source."id"
       WHERE (source."id" IS NULL AND feed."deletedAt" IS NULL)
          OR (source."id" IS NOT NULL AND (
            feed."generationId" IS NULL OR feed."deletedAt" IS NOT NULL
            OR feed."userId" IS DISTINCT FROM source."userId"
            OR feed."authUserId" IS DISTINCT FROM source."authUserId"
            OR feed."type" IS DISTINCT FROM source."type"
            OR feed."status" IS DISTINCT FROM source."status"
            OR feed."source" IS DISTINCT FROM source."source"
            OR feed."provider" IS DISTINCT FROM source."externalProvider"
            OR feed."model" IS DISTINCT FROM source."model"
            OR feed."mediaKind" IS DISTINCT FROM source."projectedMediaKind"
            OR feed."thumbUrl" IS DISTINCT FROM source."projectedThumbUrl"
            OR feed."previewUrl" IS DISTINCT FROM source."projectedPreviewUrl"
            OR feed."displayUrl" IS DISTINCT FROM source."projectedDisplayUrl"
            OR feed."posterUrl" IS DISTINCT FROM source."projectedPosterUrl"
            OR feed."errorCode" IS DISTINCT FROM source."projectedErrorCode"
            OR feed."errorMsg" IS DISTINCT FROM source."errorMsg"
            OR feed."createdAt" IS DISTINCT FROM source."createdAt"
            OR feed."finishedAt" IS DISTINCT FROM source."finishedAt"
            OR feed."updatedAt" IS DISTINCT FROM source."updatedAt"
            OR COALESCE(feed."sizeBytes64", 0) IS DISTINCT FROM COALESCE(source."sizeBytes", 0)
          ))`,
    );
    const workFeedDiff = Number(workFeedDiffRows?.[0]?.count || 0);
    if (workFeedDiff !== 0) throw new Error(`work-feed backfill diff is ${workFeedDiff}`);

    const summaryDiffRows = await tx.$queryRawUnsafe(
      `WITH identity_links AS (
         SELECT "userId", MIN("authUserId")::int AS "linkedAuthUserId"
         FROM "Generation" WHERE "authUserId" IS NOT NULL
         GROUP BY "userId" HAVING COUNT(DISTINCT "authUserId") = 1
       ), normalized AS (
         SELECT generation.*,
                COALESCE(generation."authUserId", identity_links."linkedAuthUserId") AS "effectiveAuthUserId"
         FROM "Generation" AS generation
         LEFT JOIN identity_links ON identity_links."userId" = generation."userId"
       ), generated AS (
         SELECT
           CASE WHEN "effectiveAuthUserId" IS NULL THEN 'guest:' || "userId"
                ELSE 'auth:' || "effectiveAuthUserId"::text END AS "adminKey",
           CASE WHEN "effectiveAuthUserId" IS NULL THEN "userId"
                ELSE "effectiveAuthUserId"::text END AS "userId",
           "effectiveAuthUserId" AS "authUserId",
           COUNT(*)::int AS "totalTaskCount",
           COUNT(*) FILTER (WHERE "status" = 'success')::int AS "successTaskCount",
           COUNT(*) FILTER (WHERE "status" = 'failed')::int AS "failedTaskCount",
           COUNT(*) FILTER (WHERE "type" <> 'import')::int AS "assetCount",
           COALESCE(SUM("sizeBytes"), 0)::bigint AS "storageBytes",
           COUNT(*) FILTER (
             WHERE to_char("createdAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') =
                   to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')
           )::int AS "todayTaskCount",
           COUNT(*) FILTER (
             WHERE to_char("createdAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') >=
                   to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai') - INTERVAL '6 days', 'YYYY-MM-DD')
           )::int AS "last7TaskCount",
           COUNT(*) FILTER (
             WHERE to_char("createdAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') >=
                   to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai') - INTERVAL '29 days', 'YYYY-MM-DD')
           )::int AS "last30TaskCount",
           COUNT(*) FILTER (
             WHERE "type" <> 'import' AND "status" = 'success'
               AND to_char("createdAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') >=
                   to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai') - INTERVAL '29 days', 'YYYY-MM-DD')
           )::int AS "successCount30d",
           COUNT(*) FILTER (
             WHERE "type" <> 'import' AND "status" = 'failed'
               AND to_char("createdAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') >=
                   to_char((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai') - INTERVAL '29 days', 'YYYY-MM-DD')
           )::int AS "failedCount30d",
           MAX("createdAt") AS "lastActiveAt",
           jsonb_agg(DISTINCT "userId") AS "linkedUserIds"
         FROM normalized GROUP BY 1, 2, "effectiveAuthUserId"
       ), expected AS (
         SELECT generated."adminKey", generated."userId", generated."authUserId", users."username",
                generated."lastActiveAt", generated."todayTaskCount", generated."last7TaskCount",
                generated."last30TaskCount", generated."totalTaskCount", generated."successTaskCount",
                generated."failedTaskCount",
                CASE WHEN generated."successCount30d" + generated."failedCount30d" > 0
                     THEN (ROUND(1000.0 * generated."successCount30d" /
                                (generated."successCount30d" + generated."failedCount30d")) / 10.0)::double precision
                     ELSE 0::double precision END AS "successRate30d",
                generated."failedCount30d", generated."storageBytes", generated."assetCount",
                GREATEST(1, jsonb_array_length(generated."linkedUserIds"))::int AS "deviceCount",
                generated."linkedUserIds"
         FROM generated LEFT JOIN "User" AS users ON users."id" = generated."authUserId"
         UNION ALL
         SELECT 'auth:' || users."id"::text, users."id"::text, users."id", users."username",
                users."createdAt", 0, 0, 0, 0, 0, 0, 0::double precision, 0, 0::bigint, 0, 1,
                jsonb_build_array(users."id"::text)
         FROM "User" AS users
         WHERE NOT EXISTS (SELECT 1 FROM generated WHERE generated."adminKey" = 'auth:' || users."id"::text)
       ), active_summary AS (
         SELECT * FROM "AdminUserSummary" WHERE "deletedAt" IS NULL
       )
       SELECT COUNT(*)::bigint AS count
       FROM expected
       FULL OUTER JOIN active_summary AS summary ON summary."adminKey" = expected."adminKey"
       WHERE expected."adminKey" IS NULL OR summary."adminKey" IS NULL
          OR summary."userId" IS DISTINCT FROM expected."userId"
          OR summary."authUserId" IS DISTINCT FROM expected."authUserId"
          OR summary."username" IS DISTINCT FROM expected."username"
          OR summary."todayTaskCount" IS DISTINCT FROM expected."todayTaskCount"
          OR summary."last7TaskCount" IS DISTINCT FROM expected."last7TaskCount"
          OR summary."last30TaskCount" IS DISTINCT FROM expected."last30TaskCount"
          OR summary."totalTaskCount" IS DISTINCT FROM expected."totalTaskCount"
          OR summary."successTaskCount" IS DISTINCT FROM expected."successTaskCount"
          OR summary."failedTaskCount" IS DISTINCT FROM expected."failedTaskCount"
          OR summary."successRate30d" IS DISTINCT FROM expected."successRate30d"
          OR summary."failedCount30d" IS DISTINCT FROM expected."failedCount30d"
          OR summary."assetCount" IS DISTINCT FROM expected."assetCount"
          OR summary."storageBytes" IS DISTINCT FROM expected."storageBytes"
          OR summary."lastActiveAt" IS DISTINCT FROM expected."lastActiveAt"
          OR summary."deviceCount" IS DISTINCT FROM expected."deviceCount"
          OR NOT (
            COALESCE(summary."linkedUserIds", '[]'::jsonb) @> expected."linkedUserIds"
            AND expected."linkedUserIds" @> COALESCE(summary."linkedUserIds", '[]'::jsonb)
          )`,
    );
    const summaryDiff = Number(summaryDiffRows?.[0]?.count || 0);
    if (summaryDiff !== 0) throw new Error(`user-summary backfill diff is ${summaryDiff}`);

    await tx.$executeRawUnsafe(
      `UPDATE "AdminEvent"
       SET "status" = 'done', "processedAt" = COALESCE("processedAt", $2),
           "lockedAt" = NULL, "lockedBy" = NULL, "lastError" = NULL
       WHERE "id" <= $1 AND "status" <> 'done'`,
      eventHighWater,
      marker,
    );

    const checkedAt = marker.toISOString();
    const previous = await tx.appSetting.findUnique({ where: { key: "admin_read_model_diff" } });
    let zeroSince = checkedAt;
    try {
      const snapshot = JSON.parse(String(previous?.value || ""));
      if (snapshot?.count === 0 && typeof snapshot?.zeroSince === "string") zeroSince = snapshot.zeroSince;
    } catch {}
    await tx.appSetting.upsert({
      where: { key: "admin_read_model_diff" },
      create: { key: "admin_read_model_diff", value: JSON.stringify({ count: 0, checkedAt, zeroSince }) },
      update: { value: JSON.stringify({ count: 0, checkedAt, zeroSince }) },
    });
    await tx.appSetting.upsert({
      where: { key: "admin_user_summary_read_model_diff" },
      create: { key: "admin_user_summary_read_model_diff", value: JSON.stringify({ count: 0, checkedAt }) },
      update: { value: JSON.stringify({ count: 0, checkedAt }) },
    });
    await tx.appSetting.upsert({
      where: { key: "admin_user_summary_backfill_complete" },
      create: {
        key: "admin_user_summary_backfill_complete",
        value: JSON.stringify({ version: 1, completedAt: checkedAt }),
      },
      update: { value: JSON.stringify({ version: 1, completedAt: checkedAt }) },
    });
    await tx.appSetting.upsert({
      where: { key: backfillStateKey },
      create: {
        key: backfillStateKey,
        value: JSON.stringify({ version: backfillVersion, cursor: highWater, highWater, eventHighWater, completed: true, completedAt: checkedAt }),
      },
      update: {
        value: JSON.stringify({ version: backfillVersion, cursor: highWater, highWater, eventHighWater, completed: true, completedAt: checkedAt }),
      },
    });
    return { workFeedRows, summaryRows, workFeedDiff, summaryDiff, highWater, eventHighWater, checkedAt };
  }, { timeout: 30 * 60_000, isolationLevel: "RepeatableRead" });
  console.log(JSON.stringify(result));
} finally {
  await prisma.$disconnect();
}
