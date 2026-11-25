import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import type { AdminUserScope } from "@/lib/admin-user-scope";

export function adminCallUserScope(scope?: AdminUserScope) {
  if (!scope) return Prisma.sql`TRUE`;
  const guests = scope.linkedGuestUserIds.length
    ? Prisma.sql`"userId" IN (${Prisma.join(scope.linkedGuestUserIds)})`
    : Prisma.sql`FALSE`;
  return scope.authUserId == null
    ? Prisma.sql`("authUserId" IS NULL AND "userId" = ${scope.requestedUserId})`
    : Prisma.sql`("authUserId" = ${scope.authUserId} OR ("authUserId" IS NULL AND ${guests}))`;
}

// Media tasks already have a Generation row. LLMs and other standalone API
// calls live in UsageLedger; include them without counting linked calls twice.
export function adminModelCallSource(scope?: AdminUserScope) {
  const owner = adminCallUserScope(scope);
  return Prisma.sql`(
    SELECT "userId", "authUserId", "externalProvider", model, type, status,
      "errorMsg", "createdAt" FROM "Generation"
    WHERE type <> 'import' AND ${owner}
    UNION ALL
    SELECT "userId", "authUserId", "externalProvider", model, module AS type, status,
      NULL::text AS "errorMsg", "occurredAt" AS "createdAt" FROM "UsageLedger"
    WHERE "generationId" IS NULL AND "unitType" <> 'storage_item' AND ${owner}
  ) AS model_calls`;
}

export type AdminModelUsageRow = {
  day: string;
  authUserId: number | null;
  userId: string | null;
  model: string;
  requestCount: number;
  successCount: number;
  failedCount: number;
};

export async function loadAdminModelUsageRows(since: Date, now = new Date(), db = prisma) {
  return db.$queryRaw<AdminModelUsageRow[]>(Prisma.sql`
    SELECT to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS day,
      "authUserId", "userId", COALESCE(NULLIF(btrim(model), ''), '未标注模型') AS model,
      COUNT(*)::int AS "requestCount",
      (COUNT(*) FILTER (WHERE status = 'success'))::int AS "successCount",
      (COUNT(*) FILTER (WHERE status = 'failed'))::int AS "failedCount"
    FROM ${adminModelCallSource()}
    WHERE "createdAt" >= ${since} AND "createdAt" <= ${now}
    GROUP BY day, "authUserId", "userId", model`);
}

export async function loadAdminUserModelCounts(scope: AdminUserScope, db = prisma) {
  const rows = await db.$queryRaw<Array<{ model: string | null; count: number }>>(Prisma.sql`
    SELECT model, COUNT(*)::int AS count FROM ${adminModelCallSource(scope)} GROUP BY model`);
  return rows.map(row => ({ model: row.model, _count: { _all: row.count } }));
}
