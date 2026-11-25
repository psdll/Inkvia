import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import type { AdminUserScope } from "@/lib/admin-user-scope";
import { billingDate, decimal, shanghaiDay } from "@/lib/billing/money";
import { ledgerCnySql } from "@/lib/billing/monthly";

export type BillingTrendPoint = { key: string; amount: string; pricedCount: number; pendingCount: number; count: number };
export type BillingTrendPeriod = {
  key: "today" | "last3Days" | "last7Days";
  label: string; dateFrom: string; dateTo: string; amount: string; dailyAverage: string;
  pendingCount: number; pricedCount: number; count: number; points: BillingTrendPoint[];
};

export function buildBillingTrendPeriods(rows: BillingTrendPoint[], now = new Date()): BillingTrendPeriod[] {
  const today = shanghaiDay(now);
  const dayStart = billingDate(today);
  const hour = new Date(+now + 8 * 3600000).getUTCHours();
  return ([1, 3, 7] as const).map(days => {
    const dateFrom = shanghaiDay(new Date(+dayStart - (days - 1) * 86400000));
    const keys = days === 1
      ? Array.from({ length: hour + 1 }, (_, h) => `${today} ${String(h).padStart(2, "0")}`)
      : Array.from({ length: days }, (_, d) => shanghaiDay(new Date(+billingDate(dateFrom) + d * 86400000)));
    const points = keys.map(key => {
      const matches = rows.filter(row => days === 1 ? row.key === key : row.key.slice(0, 10) === key);
      return { key, amount: matches.reduce((sum, row) => sum.add(row.amount), decimal(0)).toFixed(8),
        pricedCount: matches.reduce((sum, row) => sum + row.pricedCount, 0),
        pendingCount: matches.reduce((sum, row) => sum + row.pendingCount, 0),
        count: matches.reduce((sum, row) => sum + row.count, 0) };
    });
    const amount = points.reduce((sum, point) => sum.add(point.amount), decimal(0));
    return { key: days === 1 ? "today" : days === 3 ? "last3Days" : "last7Days", label: days === 1 ? "今天" : `近 ${days} 天`,
      dateFrom, dateTo: today, amount: amount.toFixed(8), dailyAverage: amount.div(days).toFixed(8), points,
      pendingCount: points.reduce((sum, p) => sum + p.pendingCount, 0),
      pricedCount: points.reduce((sum, p) => sum + p.pricedCount, 0), count: points.reduce((sum, p) => sum + p.count, 0) };
  });
}

export async function loadAdminBillingTrend(scope: AdminUserScope, now = new Date(), db = prisma) {
  const since = new Date(+billingDate(shanghaiDay(now)) - 6 * 86400000);
  const ids = scope.linkedGuestUserIds.length ? scope.linkedGuestUserIds : [scope.requestedUserId];
  const guest = Prisma.sql`("authUserId" IS NULL AND "userId" IN (${Prisma.join(ids)}))`;
  const identity = scope.authUserId === null ? guest : Prisma.sql`("authUserId" = ${scope.authUserId} OR ${guest})`;
  const rows = await db.$queryRaw<BillingTrendPoint[]>(Prisma.sql`
    WITH costs AS (
      SELECT "occurredAt", "costStatus", ${ledgerCnySql} AS cny FROM "UsageLedger"
      WHERE ${identity} AND "occurredAt" >= ${since} AND "occurredAt" <= ${now}
    ) SELECT to_char("occurredAt" + interval '8 hours', 'YYYY-MM-DD HH24') AS key,
      COALESCE(sum(cny),0)::text AS amount, count(*)::integer AS count,
      count(*) FILTER (WHERE cny IS NOT NULL AND "costStatus" IN ('priced','free'))::integer AS "pricedCount",
      count(*) FILTER (WHERE cny IS NULL AND "costStatus" NOT IN ('failed','non_billable'))::integer AS "pendingCount"
    FROM costs GROUP BY key ORDER BY key
  `);
  return buildBillingTrendPeriods(rows, now);
}
