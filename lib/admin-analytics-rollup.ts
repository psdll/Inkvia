// 把 Generation 按 (day, user) 聚合写入 AnalyticsDailyByUser。
// 后台 cron 定时跑；admin 概览/数据分析直接读这张小表。

import prisma from "@/lib/prisma";
import { adminDayKey, adminStartOfDay } from "@/lib/admin-analytics-time";
import { rebuildAdminUserSummariesFromReadModels } from "@/lib/admin-summary-projection";
import { buildAdminWorkFeedProjectionCtes } from "@/lib/admin-work-feed-projection-sql.mjs";

export async function measureAdminReadModelDiff(db: any = prisma): Promise<{ count: number; checkedAt: string }> {
  const projectionCtes = buildAdminWorkFeedProjectionCtes(
    `SELECT generation.* FROM "Generation" AS generation`,
    { prefix: "work_feed_diff", finalName: "source" },
  );
  const diffRows = await db.$queryRawUnsafe(
    `WITH ${projectionCtes}
     SELECT COUNT(*)::bigint AS count
     FROM (
       SELECT COALESCE(source."id", feed."generationId") AS id
       FROM source
       FULL OUTER JOIN "AdminWorkFeed" AS feed ON feed."generationId" = source."id"
       WHERE (source."id" IS NULL AND feed."deletedAt" IS NULL)
          OR (source."id" IS NOT NULL AND (
            feed."generationId" IS NULL
            OR feed."deletedAt" IS NOT NULL
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
          ))
     ) AS differences`,
  );
  const count = Number(diffRows?.[0]?.count || 0);
  const checkedAt = new Date().toISOString();
  const previousRow = await db.appSetting.findUnique({ where: { key: "admin_read_model_diff" } });
  let previous: any = null;
  try {
    previous = JSON.parse(String(previousRow?.value || ""));
  } catch {}
  const zeroSince = count === 0
    ? previous?.count === 0 && typeof previous?.zeroSince === "string"
      ? previous.zeroSince
      : checkedAt
    : null;
  await db.appSetting.upsert({
    where: { key: "admin_read_model_diff" },
    create: { key: "admin_read_model_diff", value: JSON.stringify({ count, checkedAt, zeroSince }) },
    update: { value: JSON.stringify({ count, checkedAt, zeroSince }) },
  });
  return { count, checkedAt };
}

export async function measureAdminUserSummaryDiff(
  db: any = prisma,
): Promise<{ count: number; checkedAt: string }> {
  const rows = await db.$queryRawUnsafe(
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
       FROM generated
       LEFT JOIN "User" AS users ON users."id" = generated."authUserId"
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
     WHERE expected."adminKey" IS NULL
        OR summary."adminKey" IS NULL
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
  const count = Number(rows?.[0]?.count || 0);
  const checkedAt = new Date().toISOString();
  await db.appSetting.upsert({
    where: { key: "admin_user_summary_read_model_diff" },
    create: { key: "admin_user_summary_read_model_diff", value: JSON.stringify({ count, checkedAt }) },
    update: { value: JSON.stringify({ count, checkedAt }) },
  });
  return { count, checkedAt };
}

async function recordTransactionalRebuildParity(db: any) {
  const checkedAt = new Date().toISOString();
  const previousRow = await db.appSetting.findUnique({ where: { key: "admin_read_model_diff" } });
  let zeroSince = checkedAt;
  try {
    const previous = JSON.parse(String(previousRow?.value || ""));
    if (previous?.count === 0 && typeof previous?.zeroSince === "string") zeroSince = previous.zeroSince;
  } catch {}
  await db.appSetting.upsert({
    where: { key: "admin_read_model_diff" },
    create: {
      key: "admin_read_model_diff",
      value: JSON.stringify({ count: 0, checkedAt, zeroSince, verifiedBy: "transactional_rebuild" }),
    },
    update: {
      value: JSON.stringify({ count: 0, checkedAt, zeroSince, verifiedBy: "transactional_rebuild" }),
    },
  });
  await db.appSetting.upsert({
    where: { key: "admin_user_summary_read_model_diff" },
    create: {
      key: "admin_user_summary_read_model_diff",
      value: JSON.stringify({ count: 0, checkedAt, verifiedBy: "transactional_rebuild" }),
    },
    update: {
      value: JSON.stringify({ count: 0, checkedAt, verifiedBy: "transactional_rebuild" }),
    },
  });
}

/**
 * 重建最近 N 天的聚合数据（默认 31 天，足够覆盖 30 天面板 + 边界容差）。
 * 用 upsert，幂等可重复跑。
 */
export async function rebuildRecentDailyAnalytics(
  days: number | "all" = 3,
  options: { workFeedAlreadyRebuilt?: boolean } = {},
): Promise<{
  scanned: number;
  buckets: number;
  leaseAcquired: boolean;
}> {
  const safeDays = days === "all" ? "all" : Math.max(1, Math.min(31, Math.floor(Number(days) || 3)));
  const since = safeDays === "all" ? null : adminStartOfDay(safeDays - 1);
  return prisma.$transaction(async (tx: any) => {
    const lease = await tx.$queryRawUnsafe(
      `SELECT pg_try_advisory_xact_lock(hashtextextended('admin-work-feed-event-worker', 0)) AS acquired`,
    );
    if (!lease?.[0]?.acquired) return { scanned: 0, buckets: 0, leaseAcquired: false };
    if (safeDays === "all" && !options.workFeedAlreadyRebuilt) {
      const { rebuildAdminWorkFeedFromGeneration } = await import("@/lib/admin-operational");
      await rebuildAdminWorkFeedFromGeneration(1000, tx);
    }
    const aggregateSql = `WITH identity_links AS (
       SELECT "userId", MIN("authUserId")::int AS "linkedAuthUserId"
       FROM "Generation"
       WHERE "authUserId" IS NOT NULL
       GROUP BY "userId"
       HAVING COUNT(DISTINCT "authUserId") = 1
     ), normalized AS (
       SELECT generation.*,
              COALESCE(generation."authUserId", identity_links."linkedAuthUserId") AS "effectiveAuthUserId"
       FROM "Generation" AS generation
       LEFT JOIN identity_links ON identity_links."userId" = generation."userId"
       WHERE ($1::timestamptz IS NULL OR generation."createdAt" >= $1::timestamptz)
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
         COALESCE(SUM("sizeBytes"), 0)::bigint AS "storageBytes"
       FROM normalized
       GROUP BY 1, 2, "effectiveAuthUserId", 4
     ), daily_updated AS (
       UPDATE "AnalyticsDailyByUser" AS daily
       SET "day" = expected."day",
           "authUserId" = expected."authUserId",
           "userId" = expected."userId",
           "generationCount" = expected."generationCount",
           "successCount" = expected."successCount",
           "failedCount" = expected."failedCount",
           "imageCount" = expected."imageCount",
           "videoCount" = expected."videoCount",
           "faceCount" = expected."faceCount",
           "otherCount" = expected."otherCount",
           "storageBytes" = expected."storageBytes",
           "updatedAt" = CURRENT_TIMESTAMP
       FROM expected
       WHERE daily."bucketKey" = expected."bucketKey"
         AND (daily."day", daily."authUserId", daily."userId", daily."generationCount",
              daily."successCount", daily."failedCount", daily."imageCount", daily."videoCount",
              daily."faceCount", daily."otherCount", daily."storageBytes")
             IS DISTINCT FROM
             (expected."day", expected."authUserId", expected."userId", expected."generationCount",
              expected."successCount", expected."failedCount", expected."imageCount", expected."videoCount",
              expected."faceCount", expected."otherCount", expected."storageBytes")
       RETURNING daily."bucketKey"
     ), daily_inserted AS (
       INSERT INTO "AnalyticsDailyByUser" (
         "bucketKey", "day", "authUserId", "userId", "generationCount", "successCount", "failedCount",
         "imageCount", "videoCount", "faceCount", "otherCount", "storageBytes", "updatedAt"
       ) SELECT "bucketKey", "day", "authUserId", "userId", "generationCount", "successCount", "failedCount",
                "imageCount", "videoCount", "faceCount", "otherCount", "storageBytes", CURRENT_TIMESTAMP
         FROM expected
       WHERE NOT EXISTS (
         SELECT 1 FROM "AnalyticsDailyByUser" AS daily WHERE daily."bucketKey" = expected."bucketKey"
       )
       RETURNING "bucketKey"
     ), daily_deleted AS (
       DELETE FROM "AnalyticsDailyByUser" AS daily
       WHERE ($2::text IS NULL OR daily."day" >= $2::text)
         AND NOT EXISTS (SELECT 1 FROM expected WHERE expected."bucketKey" = daily."bucketKey")
       RETURNING daily."bucketKey"
     )
     SELECT COALESCE((SELECT SUM("generationCount")::int FROM expected), 0) AS scanned,
            (SELECT COUNT(*)::int FROM expected) AS buckets,
            ((SELECT COUNT(*)::int FROM daily_updated) +
             (SELECT COUNT(*)::int FROM daily_inserted)) AS upserted,
            (SELECT COUNT(*)::int FROM daily_deleted) AS deleted`;
    const rows = await tx.$queryRawUnsafe(aggregateSql, since, since ? adminDayKey(since) : null);
    if (safeDays === "all") {
      await rebuildAdminUserSummariesFromReadModels(tx);
      // The feed, daily buckets and summaries were rebuilt from one leased transaction snapshot.
      // Record that atomic parity here; the independent hourly verifier still performs full shadow scans.
      await recordTransactionalRebuildParity(tx);
    }
    return {
      scanned: Math.max(0, Number(rows?.[0]?.scanned) || 0),
      buckets: Math.max(0, Number(rows?.[0]?.buckets) || 0),
      leaseAcquired: true,
    };
  }, { maxWait: 5_000, timeout: safeDays === "all" ? 10 * 60_000 : 60_000 });
}

// ── 读取接口 ────────────────────────────────────────────────────────────────
// admin/storage GET 把 daily30 + 每用户聚合从这张表读出来,避免再扫 Generation。

export type RollupDailyPoint = {
  day: string;
  generationCount: number;
  successCount: number;
  failedCount: number;
  storageBytes: number;
  imageCount: number;
  videoCount: number;
  faceCount: number;
  otherCount: number;
};

export type RollupUserAggregate = {
  authUserId: number | null;
  userId: string;
  generationCount: number;
  successCount: number;
  failedCount: number;
  storageBytes: number;
  imageCount: number;
  videoCount: number;
  faceCount: number;
  otherCount: number;
  daily: Map<string, number>; // day -> count (用于 trend7)
};

export type RollupReadout = {
  daily: RollupDailyPoint[];
  perUser: RollupUserAggregate[];
  totals: {
    generationCount: number;
    successCount: number;
    failedCount: number;
    storageBytes: number;
    imageCount: number;
    videoCount: number;
    faceCount: number;
    otherCount: number;
  };
};

/**
 * 读取最近 N 天的滚动数据。
 * 上游:admin/storage GET 用它代替 Generation 全表扫。
 */
export async function readRollupForLastNDays(days: number): Promise<RollupReadout> {
  const safeDays = Math.max(1, Math.min(90, Math.floor(days)));
  const startDay = adminStartOfDay(safeDays - 1);

  // day key: YYYY-MM-DD
  const buckets = (await (prisma as any).analyticsDailyByUser.findMany({
    where: { day: { gte: adminDayKey(startDay) } },
  })) as Array<{
    day: string;
    authUserId: number | null;
    userId: string;
    generationCount: number;
    successCount: number;
    failedCount: number;
    imageCount: number;
    videoCount: number;
    faceCount: number;
    otherCount: number;
    storageBytes: bigint;
  }>;

  const dailyMap = new Map<string, RollupDailyPoint>();
  const perUserMap = new Map<string, RollupUserAggregate>();
  const totals = {
    generationCount: 0,
    successCount: 0,
    failedCount: 0,
    storageBytes: 0,
    imageCount: 0,
    videoCount: 0,
    faceCount: 0,
    otherCount: 0,
  };

  for (const b of buckets) {
    const dayPoint = dailyMap.get(b.day) || {
      day: b.day,
      generationCount: 0,
      successCount: 0,
      failedCount: 0,
      storageBytes: 0,
      imageCount: 0,
      videoCount: 0,
      faceCount: 0,
      otherCount: 0,
    };
    dayPoint.generationCount += b.generationCount;
    dayPoint.successCount += b.successCount;
    dayPoint.failedCount += b.failedCount;
    dayPoint.storageBytes += Number(b.storageBytes || 0);
    dayPoint.imageCount += b.imageCount;
    dayPoint.videoCount += b.videoCount;
    dayPoint.faceCount += b.faceCount;
    dayPoint.otherCount += b.otherCount;
    dailyMap.set(b.day, dayPoint);

    const userKey = b.authUserId != null ? `auth:${b.authUserId}` : `guest:${b.userId}`;
    const u = perUserMap.get(userKey) || {
      authUserId: b.authUserId,
      userId: b.userId,
      generationCount: 0,
      successCount: 0,
      failedCount: 0,
      storageBytes: 0,
      imageCount: 0,
      videoCount: 0,
      faceCount: 0,
      otherCount: 0,
      daily: new Map<string, number>(),
    };
    u.generationCount += b.generationCount;
    u.successCount += b.successCount;
    u.failedCount += b.failedCount;
    u.storageBytes += Number(b.storageBytes || 0);
    u.imageCount += b.imageCount;
    u.videoCount += b.videoCount;
    u.faceCount += b.faceCount;
    u.otherCount += b.otherCount;
    u.daily.set(b.day, (u.daily.get(b.day) || 0) + b.imageCount + b.videoCount + b.faceCount + b.otherCount);
    perUserMap.set(userKey, u);

    totals.generationCount += b.generationCount;
    totals.successCount += b.successCount;
    totals.failedCount += b.failedCount;
    totals.storageBytes += Number(b.storageBytes || 0);
    totals.imageCount += b.imageCount;
    totals.videoCount += b.videoCount;
    totals.faceCount += b.faceCount;
    totals.otherCount += b.otherCount;
  }

  // 补齐日历空缺(没记录的日期填 0)
  const allDays: string[] = [];
  for (let i = safeDays - 1; i >= 0; i--) {
    allDays.push(adminDayKey(adminStartOfDay(i)));
  }
  const daily = allDays.map(
    (d) =>
      dailyMap.get(d) || {
        day: d,
        generationCount: 0,
        successCount: 0,
        failedCount: 0,
        storageBytes: 0,
        imageCount: 0,
        videoCount: 0,
        faceCount: 0,
        otherCount: 0,
      },
  );

  return {
    daily,
    perUser: Array.from(perUserMap.values()),
    totals,
  };
}

/**
 * 暴露给外部模块的 day key 辅助。
 */
export const rollupHelpers = { dayKeyLocal: adminDayKey, startOfDayLocal: adminStartOfDay };
