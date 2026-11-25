import { adminDayKey } from "@/lib/admin-analytics-time";

type AdminWorkFeedRow = {
  generationId: number;
  userId: string;
  authUserId: number | null;
  type: string;
  status: string;
  createdAt: Date | string;
  sizeBytes64?: bigint | number | null;
  sizeBytes?: number | null;
  deletedAt?: Date | string | null;
};

type NumericContribution = {
  totalTaskCount: number;
  successTaskCount: number;
  failedTaskCount: number;
  assetCount: number;
  storageBytes: bigint;
  generationCount: number;
  successCount: number;
  failedCount: number;
  imageCount: number;
  videoCount: number;
  faceCount: number;
  otherCount: number;
};

export type AdminWorkContribution = NumericContribution & {
  adminKey: string;
  userId: string;
  authUserId: number | null;
  linkedUserId: string;
  day: string;
  bucketKey: string;
};

type ContributionDiff = {
  summaries: Map<string, AdminWorkContribution>;
  daily: Map<string, AdminWorkContribution>;
};

const numericKeys: Array<keyof NumericContribution> = [
  "totalTaskCount",
  "successTaskCount",
  "failedTaskCount",
  "assetCount",
  "storageBytes",
  "generationCount",
  "successCount",
  "failedCount",
  "imageCount",
  "videoCount",
  "faceCount",
  "otherCount",
];

function typeKey(type: string): "image" | "video" | "face" | "other" {
  const value = String(type || "").toLowerCase();
  if (value.includes("video")) return "video";
  if (value.includes("face")) return "face";
  if (value.includes("image")) return "image";
  return "other";
}

function zeroLike(base: Omit<AdminWorkContribution, keyof NumericContribution>): AdminWorkContribution {
  return {
    ...base,
    totalTaskCount: 0,
    successTaskCount: 0,
    failedTaskCount: 0,
    assetCount: 0,
    storageBytes: BigInt(0),
    generationCount: 0,
    successCount: 0,
    failedCount: 0,
    imageCount: 0,
    videoCount: 0,
    faceCount: 0,
    otherCount: 0,
  };
}

export function getAdminWorkFeedContribution(row: AdminWorkFeedRow | null | undefined): AdminWorkContribution | null {
  if (!row || row.deletedAt) return null;
  const linkedUserId = String(row.userId || "legacy");
  const authUserId = typeof row.authUserId === "number" ? row.authUserId : null;
  const adminKey = authUserId == null ? `guest:${linkedUserId}` : `auth:${authUserId}`;
  const userId = authUserId == null ? linkedUserId : String(authUserId);
  const day = adminDayKey(row.createdAt);
  if (!day) return null;
  const status = String(row.status || "").toLowerCase();
  const isImport = String(row.type || "").toLowerCase() === "import";
  const kind = typeKey(row.type);
  const storageBytes = typeof row.sizeBytes64 === "bigint"
    ? row.sizeBytes64
    : BigInt(Math.max(0, Math.floor(Number(row.sizeBytes64 ?? row.sizeBytes) || 0)));
  return {
    ...zeroLike({ adminKey, userId, authUserId, linkedUserId, day, bucketKey: `${day}|${adminKey}` }),
    totalTaskCount: 1,
    successTaskCount: status === "success" ? 1 : 0,
    failedTaskCount: status === "failed" ? 1 : 0,
    assetCount: isImport ? 0 : 1,
    storageBytes,
    generationCount: 1,
    successCount: !isImport && status === "success" ? 1 : 0,
    failedCount: !isImport && status === "failed" ? 1 : 0,
    imageCount: !isImport && kind === "image" ? 1 : 0,
    videoCount: !isImport && kind === "video" ? 1 : 0,
    faceCount: !isImport && kind === "face" ? 1 : 0,
    otherCount: !isImport && kind === "other" ? 1 : 0,
  };
}

function addContribution(
  map: Map<string, AdminWorkContribution>,
  key: string,
  contribution: AdminWorkContribution,
  multiplier: 1 | -1,
) {
  const current = map.get(key) || zeroLike({
    adminKey: contribution.adminKey,
    userId: contribution.userId,
    authUserId: contribution.authUserId,
    linkedUserId: contribution.linkedUserId,
    day: contribution.day,
    bucketKey: contribution.bucketKey,
  });
  for (const field of numericKeys) {
    if (field === "storageBytes") {
      current.storageBytes += contribution.storageBytes * BigInt(multiplier);
    } else {
      (current[field] as number) += (contribution[field] as number) * multiplier;
    }
  }
  map.set(key, current);
}

function rekeyContribution(
  contribution: AdminWorkContribution,
  authUserId: number,
): AdminWorkContribution {
  const adminKey = `auth:${authUserId}`;
  return {
    ...contribution,
    adminKey,
    userId: String(authUserId),
    authUserId,
    bucketKey: `${contribution.day}|${adminKey}`,
  };
}

async function findUniqueLinkedAuthUserId(tx: any, linkedUserId: string): Promise<number | null> {
  const links = await tx.adminWorkFeed.findMany({
    where: {
      userId: linkedUserId,
      authUserId: { not: null },
      deletedAt: null,
    },
    distinct: ["authUserId"],
    orderBy: [{ authUserId: "asc" }],
    take: 2,
    select: { authUserId: true },
  });
  return links.length === 1 && typeof links[0]?.authUserId === "number"
    ? links[0].authUserId
    : null;
}

async function resolveContributionIdentity(tx: any, contribution: AdminWorkContribution | null) {
  if (!contribution || contribution.authUserId != null) return contribution;
  const authUserId = await findUniqueLinkedAuthUserId(tx, contribution.linkedUserId);
  return typeof authUserId === "number"
    ? rekeyContribution(contribution, authUserId)
    : contribution;
}

function diffContributions(
  previous: AdminWorkContribution | null,
  next: AdminWorkContribution | null,
): ContributionDiff {
  const summaries = new Map<string, AdminWorkContribution>();
  const daily = new Map<string, AdminWorkContribution>();
  if (previous) {
    addContribution(summaries, previous.adminKey, previous, -1);
    addContribution(daily, previous.bucketKey, previous, -1);
  }
  if (next) {
    addContribution(summaries, next.adminKey, next, 1);
    addContribution(daily, next.bucketKey, next, 1);
  }
  return { summaries, daily };
}

export function diffAdminWorkContributions(
  previousRow: AdminWorkFeedRow | null | undefined,
  nextRow: AdminWorkFeedRow | null | undefined,
): ContributionDiff {
  const previous = getAdminWorkFeedContribution(previousRow);
  const next = getAdminWorkFeedContribution(nextRow);
  const summaries = new Map<string, AdminWorkContribution>();
  const daily = new Map<string, AdminWorkContribution>();
  if (previous) {
    addContribution(summaries, previous.adminKey, previous, -1);
    addContribution(daily, previous.bucketKey, previous, -1);
  }
  if (next) {
    addContribution(summaries, next.adminKey, next, 1);
    addContribution(daily, next.bucketKey, next, 1);
  }
  return { summaries, daily };
}

function recentDayKeys() {
  const days: string[] = [];
  const now = Date.now();
  for (let offset = 30; offset >= 0; offset -= 1) {
    days.push(adminDayKey(new Date(now - offset * 24 * 60 * 60 * 1000)));
  }
  return days;
}

async function refreshSummaryWindow(tx: any, contribution: AdminWorkContribution) {
  const days = recentDayKeys();
  const dailyRows = await tx.analyticsDailyByUser.findMany({
    where: contribution.authUserId == null
      ? { authUserId: null, userId: contribution.userId, day: { gte: days[0] } }
      : { authUserId: contribution.authUserId, day: { gte: days[0] } },
    orderBy: { day: "asc" },
    take: 31,
  });
  const byDay = new Map<string, any>(dailyRows.map((row: any) => [String(row.day), row]));
  const sum = (start: number, field: string) => days.slice(start).reduce(
    (total, day) => total + Math.max(0, Number(byDay.get(day)?.[field]) || 0),
    0,
  );
  const todayTaskCount = sum(30, "generationCount");
  const last7TaskCount = sum(24, "generationCount");
  const last30TaskCount = sum(1, "generationCount");
  const success30 = sum(1, "successCount");
  const failedCount30d = sum(1, "failedCount");
  const settled30 = success30 + failedCount30d;

  const linkedRows = contribution.authUserId == null
    ? [{ userId: contribution.userId }]
    : await tx.adminWorkFeed.findMany({
        where: { authUserId: contribution.authUserId, deletedAt: null },
        select: { userId: true },
        distinct: ["userId"],
      });
  const linkedUserIds = Array.from(new Set(
    [contribution.linkedUserId, ...linkedRows.map((row: any) => String(row.userId || ""))].filter(Boolean),
  )).sort();
  const scopeWhere = contribution.authUserId == null
    ? { authUserId: null, userId: contribution.userId, deletedAt: null }
    : {
        deletedAt: null,
        OR: [
          { authUserId: contribution.authUserId },
          { authUserId: null, userId: { in: linkedUserIds } },
        ],
      };
  const [active, user] = await Promise.all([
    tx.adminWorkFeed.aggregate({ where: scopeWhere, _max: { createdAt: true } }),
    contribution.authUserId == null
      ? Promise.resolve(null)
      : tx.user.findUnique({ where: { id: contribution.authUserId }, select: { username: true } }),
  ]);
  await tx.$executeRawUnsafe(
    `UPDATE "AdminUserSummary"
     SET "username" = $2,
         "lastActiveAt" = $3,
         "todayTaskCount" = $4,
         "last7TaskCount" = $5,
         "last30TaskCount" = $6,
         "successRate30d" = $7,
         "failedCount30d" = $8,
         "deviceCount" = $9,
         "linkedUserIds" = $10::jsonb,
         "updatedAt" = CURRENT_TIMESTAMP
     WHERE "adminKey" = $1`,
    contribution.adminKey,
    user?.username || null,
    active?._max?.createdAt || null,
    todayTaskCount,
    last7TaskCount,
    last30TaskCount,
    settled30 ? Math.round((success30 / settled30) * 1000) / 10 : 0,
    failedCount30d,
    Math.max(1, linkedUserIds.length),
    JSON.stringify(linkedUserIds),
  );
}

function isActiveAuthenticatedRow(row: AdminWorkFeedRow | null | undefined, linkedUserId: string) {
  return Boolean(
    row
    && !row.deletedAt
    && row.userId === linkedUserId
    && typeof row.authUserId === "number",
  );
}

function authenticatedMembership(row: AdminWorkFeedRow | null | undefined) {
  if (!row || row.deletedAt || typeof row.authUserId !== "number") return null;
  return `${String(row.userId || "").trim()}\u0000${row.authUserId}`;
}

async function findIdentityMappingTransition(
  tx: any,
  previousRow: AdminWorkFeedRow | null | undefined,
  nextRow: AdminWorkFeedRow | null | undefined,
) {
  if (authenticatedMembership(previousRow) === authenticatedMembership(nextRow)) {
    return { changed: false, linkedUserIds: [], authUserIds: [] };
  }
  const linkedUserIds = Array.from(new Set(
    [previousRow?.userId, nextRow?.userId].map((value) => String(value || "").trim()).filter(Boolean),
  ));
  const affectedAuthUserIds = new Set<number>();
  let changed = false;
  for (const linkedUserId of linkedUserIds) {
    const rows = await tx.$queryRawUnsafe(
      `SELECT "authUserId", COUNT(*)::int AS count
       FROM "AdminWorkFeed"
       WHERE "userId" = $1 AND "authUserId" IS NOT NULL AND "deletedAt" IS NULL
       GROUP BY "authUserId"`,
      linkedUserId,
    );
    const currentCounts = new Map<number, number>();
    for (const row of rows) {
      const authUserId = Number(row.authUserId);
      const count = Math.max(0, Number(row.count) || 0);
      if (Number.isSafeInteger(authUserId) && authUserId > 0 && count > 0) {
        currentCounts.set(authUserId, count);
        affectedAuthUserIds.add(authUserId);
      }
    }
    const previousCounts = new Map(currentCounts);
    if (isActiveAuthenticatedRow(nextRow, linkedUserId)) {
      const authUserId = nextRow!.authUserId!;
      const count = Math.max(0, (previousCounts.get(authUserId) || 0) - 1);
      if (count) previousCounts.set(authUserId, count);
      else previousCounts.delete(authUserId);
      affectedAuthUserIds.add(authUserId);
    }
    if (isActiveAuthenticatedRow(previousRow, linkedUserId)) {
      const authUserId = previousRow!.authUserId!;
      previousCounts.set(authUserId, (previousCounts.get(authUserId) || 0) + 1);
      affectedAuthUserIds.add(authUserId);
    }
    const currentIds = Array.from(currentCounts.keys()).sort((a, b) => a - b);
    const previousIds = Array.from(previousCounts.keys()).sort((a, b) => a - b);
    if (currentIds.length !== previousIds.length || currentIds.some((id, index) => id !== previousIds[index])) {
      changed = true;
    }
  }
  return { changed, linkedUserIds, authUserIds: Array.from(affectedAuthUserIds).sort((a, b) => a - b) };
}

async function rebuildIdentityDailyBuckets(
  tx: any,
  linkedUserIds: string[],
  authUserIds: number[],
) {
  return tx.$queryRawUnsafe(
    `WITH scope_users AS MATERIALIZED (
       SELECT unnest($2::text[]) AS "userId"
       UNION
       SELECT DISTINCT "userId"
       FROM "AdminWorkFeed"
       WHERE "deletedAt" IS NULL AND "authUserId" = ANY($1::int[])
     ), identity_links AS (
       SELECT feed."userId", MIN(feed."authUserId")::int AS "linkedAuthUserId"
       FROM "AdminWorkFeed" AS feed
       JOIN scope_users ON scope_users."userId" = feed."userId"
       WHERE feed."deletedAt" IS NULL AND feed."authUserId" IS NOT NULL
       GROUP BY feed."userId"
       HAVING COUNT(DISTINCT feed."authUserId") = 1
     ), normalized AS (
       SELECT feed.*, COALESCE(feed."authUserId", identity_links."linkedAuthUserId") AS "effectiveAuthUserId"
       FROM "AdminWorkFeed" AS feed
       JOIN scope_users ON scope_users."userId" = feed."userId"
       LEFT JOIN identity_links ON identity_links."userId" = feed."userId"
       WHERE feed."deletedAt" IS NULL
         AND (feed."authUserId" IS NULL OR feed."authUserId" = ANY($1::int[]))
     ), expected AS MATERIALIZED (
       SELECT
         to_char("createdAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') || '|' ||
           CASE WHEN "effectiveAuthUserId" IS NULL THEN 'guest:' || "userId"
                ELSE 'auth:' || "effectiveAuthUserId"::text END AS "bucketKey",
         to_char("createdAt" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS day,
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
       FROM normalized
       GROUP BY 1, 2, "effectiveAuthUserId", 4
     ), upserted AS (
       INSERT INTO "AnalyticsDailyByUser" (
         "bucketKey", "day", "authUserId", "userId", "generationCount", "successCount", "failedCount",
         "imageCount", "videoCount", "faceCount", "otherCount", "storageBytes", "updatedAt"
       ) SELECT "bucketKey", day, "authUserId", "userId", "generationCount", "successCount", "failedCount",
                "imageCount", "videoCount", "faceCount", "otherCount", "storageBytes", CURRENT_TIMESTAMP
         FROM expected
       ON CONFLICT ("bucketKey") DO UPDATE SET
         "day" = EXCLUDED."day", "authUserId" = EXCLUDED."authUserId", "userId" = EXCLUDED."userId",
         "generationCount" = EXCLUDED."generationCount", "successCount" = EXCLUDED."successCount",
         "failedCount" = EXCLUDED."failedCount", "imageCount" = EXCLUDED."imageCount",
         "videoCount" = EXCLUDED."videoCount", "faceCount" = EXCLUDED."faceCount",
         "otherCount" = EXCLUDED."otherCount", "storageBytes" = EXCLUDED."storageBytes",
         "updatedAt" = CURRENT_TIMESTAMP
       RETURNING "bucketKey"
     ), deleted AS (
       DELETE FROM "AnalyticsDailyByUser" AS daily
       WHERE (daily."authUserId" = ANY($1::int[])
              OR (daily."authUserId" IS NULL AND EXISTS (
                SELECT 1 FROM scope_users WHERE scope_users."userId" = daily."userId"
              )))
         AND NOT EXISTS (SELECT 1 FROM expected WHERE expected."bucketKey" = daily."bucketKey")
       RETURNING daily."bucketKey"
     )
     SELECT (SELECT COUNT(*)::int FROM upserted) AS upserted,
            (SELECT COUNT(*)::int FROM deleted) AS deleted`,
    authUserIds,
    linkedUserIds,
  );
}

async function rebuildIdentitySummaries(
  tx: any,
  linkedUserIds: string[],
  authUserIds: number[],
) {
  return tx.$queryRawUnsafe(
    `WITH scope_users AS MATERIALIZED (
       SELECT unnest($2::text[]) AS "userId"
       UNION
       SELECT DISTINCT "userId"
       FROM "AdminWorkFeed"
       WHERE "deletedAt" IS NULL AND "authUserId" = ANY($1::int[])
     ), identity_links AS (
       SELECT feed."userId", MIN(feed."authUserId")::int AS "linkedAuthUserId"
       FROM "AdminWorkFeed" AS feed
       JOIN scope_users ON scope_users."userId" = feed."userId"
       WHERE feed."deletedAt" IS NULL AND feed."authUserId" IS NOT NULL
       GROUP BY feed."userId"
       HAVING COUNT(DISTINCT feed."authUserId") = 1
     ), normalized AS (
       SELECT feed.*, COALESCE(feed."authUserId", identity_links."linkedAuthUserId") AS "effectiveAuthUserId"
       FROM "AdminWorkFeed" AS feed
       JOIN scope_users ON scope_users."userId" = feed."userId"
       LEFT JOIN identity_links ON identity_links."userId" = feed."userId"
       WHERE feed."deletedAt" IS NULL
         AND (feed."authUserId" IS NULL OR feed."authUserId" = ANY($1::int[]))
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
       FROM normalized
       GROUP BY 1, 2, "effectiveAuthUserId"
     ), expected AS MATERIALIZED (
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
       WHERE users."id" = ANY($1::int[])
         AND NOT EXISTS (SELECT 1 FROM generated WHERE generated."adminKey" = 'auth:' || users."id"::text)
      ), updated AS (
        UPDATE "AdminUserSummary" AS summary
        SET "userId" = expected."userId",
            "authUserId" = expected."authUserId",
            "username" = expected."username",
            "lastActiveAt" = expected."lastActiveAt",
            "todayTaskCount" = expected."todayTaskCount",
            "last7TaskCount" = expected."last7TaskCount",
            "last30TaskCount" = expected."last30TaskCount",
            "totalTaskCount" = expected."totalTaskCount",
            "successTaskCount" = expected."successTaskCount",
            "failedTaskCount" = expected."failedTaskCount",
            "successRate30d" = expected."successRate30d",
            "failedCount30d" = expected."failedCount30d",
            "storageBytes" = expected."storageBytes",
            "assetCount" = expected."assetCount",
            "deviceCount" = expected."deviceCount",
            "linkedUserIds" = expected."linkedUserIds",
            "deletedAt" = NULL,
            "updatedAt" = CURRENT_TIMESTAMP
        FROM expected
        WHERE summary."adminKey" = expected."adminKey"
          AND (summary."userId", summary."authUserId", summary."username", summary."lastActiveAt",
               summary."todayTaskCount", summary."last7TaskCount", summary."last30TaskCount",
               summary."totalTaskCount", summary."successTaskCount", summary."failedTaskCount",
               summary."successRate30d", summary."failedCount30d", summary."storageBytes",
               summary."assetCount", summary."deviceCount", summary."linkedUserIds", summary."deletedAt")
              IS DISTINCT FROM
              (expected."userId", expected."authUserId", expected."username", expected."lastActiveAt",
               expected."todayTaskCount", expected."last7TaskCount", expected."last30TaskCount",
               expected."totalTaskCount", expected."successTaskCount", expected."failedTaskCount",
               expected."successRate30d", expected."failedCount30d", expected."storageBytes",
               expected."assetCount", expected."deviceCount", expected."linkedUserIds", NULL)
        RETURNING summary."adminKey"
      ), inserted AS (
        INSERT INTO "AdminUserSummary" (
         "adminKey", "userId", "authUserId", "username", "lastActiveAt", "todayTaskCount",
         "last7TaskCount", "last30TaskCount", "totalTaskCount", "successTaskCount", "failedTaskCount",
         "successRate30d", "failedCount30d", "storageBytes", "assetCount", "deviceCount", "linkedUserIds",
         "updatedAt", "createdAt"
       ) SELECT "adminKey", "userId", "authUserId", "username", "lastActiveAt", "todayTaskCount",
                "last7TaskCount", "last30TaskCount", "totalTaskCount", "successTaskCount", "failedTaskCount",
                 "successRate30d", "failedCount30d", "storageBytes", "assetCount", "deviceCount", "linkedUserIds",
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          FROM expected
        WHERE NOT EXISTS (
          SELECT 1 FROM "AdminUserSummary" AS summary WHERE summary."adminKey" = expected."adminKey"
        )
        RETURNING "adminKey"
     ), tombstoned AS (
       UPDATE "AdminUserSummary" AS summary
       SET "deletedAt" = CURRENT_TIMESTAMP, "lastActiveAt" = NULL,
           "todayTaskCount" = 0, "last7TaskCount" = 0, "last30TaskCount" = 0,
           "totalTaskCount" = 0, "successTaskCount" = 0, "failedTaskCount" = 0,
           "successRate30d" = 0, "failedCount30d" = 0, "storageBytes" = 0,
           "assetCount" = 0, "materialCount" = 0, "modelCost30d" = 0,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE summary."deletedAt" IS NULL
         AND (summary."authUserId" = ANY($1::int[])
              OR (summary."authUserId" IS NULL AND EXISTS (
                SELECT 1 FROM scope_users WHERE scope_users."userId" = summary."userId"
              )))
         AND NOT EXISTS (SELECT 1 FROM expected WHERE expected."adminKey" = summary."adminKey")
       RETURNING summary."adminKey"
      )
      SELECT (SELECT COUNT(*)::int FROM expected) AS users,
             ((SELECT COUNT(*)::int FROM updated) + (SELECT COUNT(*)::int FROM inserted)) AS upserted,
            (SELECT COUNT(*)::int FROM tombstoned) AS tombstoned`,
    authUserIds,
    linkedUserIds,
  );
}

export async function applyAdminSummaryProjection(
  tx: any,
  previousRow: AdminWorkFeedRow | null | undefined,
  nextRow: AdminWorkFeedRow | null | undefined,
) {
  const identityTransition = await findIdentityMappingTransition(tx, previousRow, nextRow);
  if (identityTransition.changed) {
    await rebuildIdentityDailyBuckets(tx, identityTransition.linkedUserIds, identityTransition.authUserIds);
    await rebuildIdentitySummaries(tx, identityTransition.linkedUserIds, identityTransition.authUserIds);
    return {
      affectedAdminKeys: [
        ...identityTransition.authUserIds.map((authUserId) => `auth:${authUserId}`),
        ...identityTransition.linkedUserIds.map((linkedUserId) => `guest:${linkedUserId}`),
      ],
    };
  }
  const previous = await resolveContributionIdentity(tx, getAdminWorkFeedContribution(previousRow));
  const next = await resolveContributionIdentity(tx, getAdminWorkFeedContribution(nextRow));
  const diff = diffContributions(previous, next);
  for (const delta of diff.daily.values()) {
    await tx.$executeRawUnsafe(
      `INSERT INTO "AnalyticsDailyByUser" (
         "bucketKey", "day", "authUserId", "userId", "generationCount", "successCount", "failedCount",
         "imageCount", "videoCount", "faceCount", "otherCount", "storageBytes", "updatedAt"
       ) VALUES (
         $1, $2, $3, $4, GREATEST(0, $5), GREATEST(0, $6), GREATEST(0, $7),
         GREATEST(0, $8), GREATEST(0, $9), GREATEST(0, $10), GREATEST(0, $11), GREATEST(0, $12::bigint), CURRENT_TIMESTAMP
       )
       ON CONFLICT ("bucketKey") DO UPDATE SET
         "generationCount" = GREATEST(0, "AnalyticsDailyByUser"."generationCount" + $5),
         "successCount" = GREATEST(0, "AnalyticsDailyByUser"."successCount" + $6),
         "failedCount" = GREATEST(0, "AnalyticsDailyByUser"."failedCount" + $7),
         "imageCount" = GREATEST(0, "AnalyticsDailyByUser"."imageCount" + $8),
         "videoCount" = GREATEST(0, "AnalyticsDailyByUser"."videoCount" + $9),
         "faceCount" = GREATEST(0, "AnalyticsDailyByUser"."faceCount" + $10),
         "otherCount" = GREATEST(0, "AnalyticsDailyByUser"."otherCount" + $11),
         "storageBytes" = GREATEST(0, "AnalyticsDailyByUser"."storageBytes" + $12::bigint),
         "updatedAt" = CURRENT_TIMESTAMP`,
      delta.bucketKey,
      delta.day,
      delta.authUserId,
      delta.userId,
      delta.generationCount,
      delta.successCount,
      delta.failedCount,
      delta.imageCount,
      delta.videoCount,
      delta.faceCount,
      delta.otherCount,
      delta.storageBytes,
    );
  }

  for (const delta of diff.summaries.values()) {
    await tx.$executeRawUnsafe(
      `INSERT INTO "AdminUserSummary" (
         "adminKey", "userId", "authUserId", "totalTaskCount", "successTaskCount", "failedTaskCount",
         "storageBytes", "assetCount", "deviceCount", "linkedUserIds", "updatedAt", "createdAt"
       ) VALUES (
         $1, $2, $3, GREATEST(0, $4), GREATEST(0, $5), GREATEST(0, $6),
         GREATEST(0, $7::bigint), GREATEST(0, $8), 1, $9::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       )
       ON CONFLICT ("adminKey") DO UPDATE SET
         "totalTaskCount" = GREATEST(0, "AdminUserSummary"."totalTaskCount" + $4),
         "successTaskCount" = GREATEST(0, "AdminUserSummary"."successTaskCount" + $5),
         "failedTaskCount" = GREATEST(0, "AdminUserSummary"."failedTaskCount" + $6),
         "storageBytes" = GREATEST(0, "AdminUserSummary"."storageBytes" + $7::bigint),
         "assetCount" = GREATEST(0, "AdminUserSummary"."assetCount" + $8),
         "deletedAt" = NULL,
         "updatedAt" = CURRENT_TIMESTAMP`,
      delta.adminKey,
      delta.userId,
      delta.authUserId,
      delta.totalTaskCount,
      delta.successTaskCount,
      delta.failedTaskCount,
      delta.storageBytes,
      delta.assetCount,
      JSON.stringify([delta.linkedUserId]),
    );
    await refreshSummaryWindow(tx, delta);
  }
  if (next?.authUserId != null) {
    await refreshSummaryWindow(tx, next);
  }
  return { affectedAdminKeys: Array.from(diff.summaries.keys()) };
}

export async function rebuildAdminUserSummariesFromReadModels(db: any) {
  const [authRows, linkedRows, activeSummaryRows] = await Promise.all([
    db.user.findMany({ select: { id: true } }),
    db.adminWorkFeed.findMany({
      where: { deletedAt: null },
      select: { userId: true },
      distinct: ["userId"],
    }),
    db.adminUserSummary.findMany({
      where: { deletedAt: null },
      select: { userId: true, authUserId: true },
    }),
  ]);
  const authUserIds = Array.from(new Set<number>(
    [...authRows.map((row: any) => row.id), ...activeSummaryRows.map((row: any) => row.authUserId)]
      .map((id: any) => Number(id))
      .filter((id: number) => Number.isSafeInteger(id) && id > 0),
  ));
  const linkedUserIds = Array.from(new Set<string>(
    [
      ...linkedRows.map((row: any) => row.userId),
      ...activeSummaryRows.filter((row: any) => row.authUserId == null).map((row: any) => row.userId),
    ].map((value: any) => String(value || "").trim()).filter((value: string) => Boolean(value)),
  ));
  const result = await rebuildIdentitySummaries(db, linkedUserIds, authUserIds);
  return { users: Math.max(0, Number(result?.[0]?.users) || 0) };

}

export function workFeedRowFromDeleteEvent(event: any): AdminWorkFeedRow | null {
  const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
  const generationId = Number(event?.entityId || payload.generationId);
  const createdAt = payload.createdAt ? new Date(payload.createdAt) : null;
  if (!Number.isSafeInteger(generationId) || !createdAt || Number.isNaN(createdAt.getTime())) return null;
  return {
    generationId,
    userId: String(payload.userId || event.userId || "legacy"),
    authUserId: typeof payload.authUserId === "number"
      ? payload.authUserId
      : typeof event.authUserId === "number"
        ? event.authUserId
        : null,
    type: String(payload.type || "unknown"),
    status: String(payload.status || "unknown"),
    createdAt,
    sizeBytes64: BigInt(Math.max(0, Math.floor(Number(payload.sizeBytes) || 0))),
    deletedAt: null,
  };
}
