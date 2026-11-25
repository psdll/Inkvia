import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import type { AdminUserScope } from '@/lib/admin-user-scope';
import { buildModelFailurePeriods } from '@/lib/admin-model-failure';
import type { AdminUserStorageSummary } from '@/lib/admin-user-storage-summary';
import { adminModelCallSource } from './model-call-source';

function generationScope(scope: AdminUserScope) {
  const guests = scope.linkedGuestUserIds.length ? Prisma.sql`"userId" IN (${Prisma.join(scope.linkedGuestUserIds)})` : Prisma.sql`FALSE`;
  return scope.authUserId == null
    ? Prisma.sql`("authUserId" IS NULL AND "userId"=${scope.requestedUserId})`
    : Prisma.sql`("authUserId"=${scope.authUserId} OR ("authUserId" IS NULL AND ${guests}))`;
}

export async function loadAdminAnalysisTrends(scope: AdminUserScope, now: Date, db = prisma) {
  const since = new Date(now); since.setDate(since.getDate()-29); since.setHours(0,0,0,0);
  const dailySince = new Date(now); dailySince.setDate(dailySince.getDate()-13); dailySince.setHours(0,0,0,0);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const uid = scope.logWhere.userId as string | { in?: string[] };
  const logIds = typeof uid === 'string' ? [uid] : uid?.in || [];
  const [days, activity, logs, modelDays] = await Promise.all([
    db.$queryRaw<Array<{day:string;model:string|null;type:string;status:string;count:bigint}>>(Prisma.sql`
      SELECT to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day,
        model, type, status, COUNT(*) AS count FROM "Generation"
      WHERE ${generationScope(scope)} AND "createdAt">=${dailySince} AND "createdAt"<=${now}
      GROUP BY day, model, type, status`),
    db.$queryRaw<Array<{count:bigint}>>(Prisma.sql`SELECT COUNT(DISTINCT "createdAt"::date) AS count FROM "Generation" WHERE ${generationScope(scope)}`),
    db.$queryRaw<Array<{day:string;category:string;level:string;count:bigint}>>(Prisma.sql`
      SELECT to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day,
        category, level, COUNT(*) AS count FROM "Log"
      WHERE ${logIds.length ? Prisma.sql`"userId" IN (${Prisma.join(logIds)})` : Prisma.sql`FALSE`} AND "createdAt">=${since}
      GROUP BY day, category, level`),
    db.$queryRaw<Array<{day:string;model:string|null;type:string;status:string;count:bigint}>>(Prisma.sql`
      SELECT to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day,
        model, type, status, COUNT(*) AS count FROM ${adminModelCallSource(scope)}
      WHERE "createdAt">=${dailySince} AND "createdAt"<=${now} AND status IN ('success', 'failed')
      GROUP BY day, model, type, status`),
  ]);
  const daily14: Record<string,number> = {};
  for (const row of days) daily14[row.day]=(daily14[row.day]||0)+Number(row.count);
  const dailyByCategory: Record<string,Record<string,number>> = {};
  for (const row of logs) {
    for (const key of [(['user_action','generation','api'].includes(row.category.trim()) ? row.category.trim() : ''), (['warning','error'].includes(row.level) ? row.level : '')].filter(Boolean)) {
      const series=dailyByCategory[key] ||= {}; series[row.day]=(series[row.day]||0)+Number(row.count);
    }
  }
  return {daily14,activeDays:Number(activity[0]?.count||0),dailyByCategory,
    modelFailurePeriods:buildModelFailurePeriods(modelDays.map(row=>({...row,createdAt:new Date(`${row.day}T00:00:00`),count:Number(row.count)})),now)};
}

export async function loadAdminStorageSummary(scope: AdminUserScope, db = prisma): Promise<AdminUserStorageSummary> {
  const [row] = await db.$queryRaw<AdminUserStorageSummary[]>(Prisma.sql`
    WITH source AS (
      SELECT id, 0 AS priority, CASE WHEN type='import' THEN 'uploaded' ELSE 'generated' END AS category,
        "localPath" AS path, COALESCE("sizeBytes",0) AS size FROM "Generation" WHERE ${generationScope(scope)} AND "localPath" IS NOT NULL
      UNION ALL SELECT id,1,'privateLibrary',"ossUrl",COALESCE("sizeBytes",0) FROM "MediaLibraryItem" WHERE "ownerUserId"=${scope.authUserId} AND NOT "isDeleted"
      UNION ALL SELECT id,2,'privateLibrary',"thumbnailUrl",0 FROM "MediaLibraryItem" WHERE "ownerUserId"=${scope.authUserId} AND NOT "isDeleted"
      UNION ALL SELECT id,3,'privateLibrary',"coverUrl",0 FROM "UserRoleSkill" WHERE "authUserId"=${scope.authUserId}
    ), normalized AS (
      SELECT *, regexp_replace(regexp_replace(split_part(split_part(replace(btrim(path),chr(92),'/'), '?',1),'#',1), '/{2,}', '/', 'g'), '^uploads/', '/uploads/') AS local_path FROM source
    ), files AS (
      SELECT local_path, (array_agg(category ORDER BY priority,id))[1] AS category, GREATEST(MAX(size),0)::float8 AS size
      FROM normalized WHERE local_path LIKE '/uploads/%' GROUP BY local_path
    )
    SELECT COALESCE(SUM(size),0)::float8 AS "totalBytes",
      COALESCE(SUM(size) FILTER (WHERE category='generated'),0)::float8 AS "generatedBytes",
      COALESCE(SUM(size) FILTER (WHERE category='uploaded'),0)::float8 AS "uploadedBytes",
      COALESCE(SUM(size) FILTER (WHERE category='privateLibrary'),0)::float8 AS "privateLibraryBytes",
      COUNT(*)::int AS "fileCount", (COUNT(*) FILTER (WHERE size>0))::int AS "verifiedFiles",
      (COUNT(*) FILTER (WHERE size<=0))::int AS "unverifiedFiles",
      COALESCE(ROUND((AVG(size) FILTER (WHERE size>0))::numeric),0)::float8 AS "averageFileBytes",
      COALESCE(MAX(size),0)::float8 AS "largestFileBytes" FROM files
  `);
  return row;
}
