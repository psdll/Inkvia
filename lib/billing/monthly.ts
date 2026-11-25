import { Prisma } from "@prisma/client";
import { isGptImageVariantModel } from "@/lib/gpt-image-25-models";
import prisma from "@/lib/prisma";
import { billingDate, billingMonth, decimal, shanghaiDay } from "./money";

export type BillingScope = {
  month: string;
  dateFrom?: string;
  dateTo?: string;
  provider?: string;
  model?: string;
  providerModel?: string;
  identity?: { authUserId: number | null; userIds: string[] };
};
export function billingRange(scope: BillingScope) {
  if (!scope.dateFrom && !scope.dateTo) return billingMonth(scope.month);
  const start = billingDate(scope.dateFrom || "");
  const last = billingDate(scope.dateTo || "");
  if (+last < +start || +last - +start > 30 * 86400000) throw new Error("账单日期范围须为 1 至 31 天");
  const end = new Date(+last + 86400000);
  const keys: string[] = [];
  for (let time = +start; time < +end; time += 86400000) keys.push(shanghaiDay(new Date(time)));
  return { start, end, keys };
}
export const ledgerCnySql = Prisma.sql`CASE WHEN "costStatus" IN ('priced','free','non_billable') THEN
  COALESCE(("pricingSnapshot" #>> '{conversion,amountCny}')::numeric, CASE WHEN currency = 'CNY' THEN amount END)
END`;

export function billingWhere(scope: BillingScope) {
  const { start, end } = billingRange(scope);
  return {
    occurredAt: { gte: start, lt: end },
    ...(scope.provider ? { externalProvider: scope.provider } : {}),
    ...(scope.model ? { model: scope.model } : {}),
    ...(scope.providerModel !== undefined ? { providerModel: scope.providerModel || null } : {}),
    ...(scope.identity
      ? {
          OR: [
            {
              authUserId: scope.identity.authUserId,
              ...(scope.identity.authUserId === null
                ? { userId: { in: scope.identity.userIds } }
                : {}),
            },
            { authUserId: null, userId: { in: scope.identity.userIds } },
          ],
        }
      : {}),
  };
}
export function ledgerCny(row: any) {
  if (!["priced", "free", "non_billable"].includes(row.costStatus)) return null;
  return (
    row.pricingSnapshot?.conversion?.amountCny ??
    (row.currency === "CNY" ? String(row.amount) : null)
  );
}
export function ledgerView(row: any) {
  const conversion = row.pricingSnapshot?.conversion;
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    userId: row.userId,
    authUserId: row.authUserId,
    username: row.username,
    model: row.model,
    providerModel: row.providerModel,
    externalProvider: row.externalProvider,
    generationId: row.generationId,
    externalTaskId: row.externalTaskId,
    module: row.module,
    source: row.source,
    status: row.status,
    costStatus: row.costStatus,
    billable: row.billable,
    unitType: row.unitType,
    unitCount: String(row.unitCount),
    unitPrice: String(row.unitPrice),
    amount: conversion?.originalAmount ?? String(row.amount),
    currency: row.currency,
    amountCny: ledgerCny(row),
    conversion: conversion || null,
    pricingSnapshot: row.pricingSnapshot,
    usageSnapshot: row.usageSnapshot,
  };
}
export async function monthlyReport(scope: BillingScope, db: any = prisma) {
  const { start, end, keys } = billingRange(scope);
  const clauses = [
    Prisma.sql`"occurredAt" >= ${start} AND "occurredAt" < ${end}`,
  ];
  if (scope.provider)
    clauses.push(Prisma.sql`"externalProvider" = ${scope.provider}`);
  if (scope.model) clauses.push(Prisma.sql`"model" = ${scope.model}`);
  if (scope.providerModel !== undefined) clauses.push(scope.providerModel ? Prisma.sql`"providerModel" = ${scope.providerModel}` : Prisma.sql`"providerModel" IS NULL`);
  if (scope.identity) {
    const ids = scope.identity.userIds.length
      ? Prisma.sql`"userId" IN (${Prisma.join(scope.identity.userIds)})`
      : Prisma.sql`FALSE`;
    clauses.push(
      scope.identity.authUserId !== null
        ? Prisma.sql`("authUserId" = ${scope.identity.authUserId} OR ("authUserId" IS NULL AND ${ids}))`
        : Prisma.sql`("authUserId" IS NULL AND ${ids})`,
    );
  }
  // PostgreSQL aggregates the entire range; the paginated details never limit totals.
  const groups: any[] = await db.$queryRaw(Prisma.sql`
    WITH costs AS (
      SELECT *, to_char("occurredAt" + interval '8 hours', 'YYYY-MM-DD') AS day,
        COALESCE(("pricingSnapshot" #>> '{conversion,originalAmount}')::numeric, amount) AS original_amount,
        ${ledgerCnySql} AS cny,
        COALESCE("pricingSnapshot" #>> '{conversion,rate}', CASE WHEN currency = 'CNY' THEN '1' END) AS rate,
        "pricingSnapshot" #>> '{conversion,rateId}' AS rate_id,
        "pricingSnapshot" #>> '{effectiveFrom}' AS price_from
      FROM "UsageLedger" WHERE ${Prisma.join(clauses, " AND ")}
    ) SELECT day, "externalProvider" AS provider, model, "providerModel", module, source, currency, "unitType", "unitPrice", rate, rate_id AS "rateId", price_from AS "priceFrom", "costStatus", status,
      count(*)::integer AS count, count(*) FILTER (WHERE billable)::integer AS "billableCount",
      count(*) FILTER (WHERE cny IS NULL AND "costStatus" NOT IN ('failed','non_billable'))::integer AS pending,
      COALESCE(sum(cny),0)::text AS "amountCny", sum(original_amount)::text AS "originalAmount", sum("unitCount")::text AS "unitCount"
    FROM costs GROUP BY day, "externalProvider", model, "providerModel", module, source, currency, "unitType", "unitPrice", rate, rate_id, price_from, "costStatus", status
    ORDER BY day, "externalProvider", model
  `);
  const daily = new Map(
    keys.map((day) => [
      day,
      { day, amount: decimal(0), count: 0, billableCount: 0 },
    ]),
  );
  const models = new Map<string, any>();
  const modules = new Map<string, any>();
  const originalTotals = new Map<string, Prisma.Decimal>();
  let amount = decimal(0),
    ledgerCount = 0,
    billableCount = 0,
    failedCount = 0,
    unpricedCount = 0,
    missingUsageCount = 0,
    missingRateCount = 0,
    pendingCount = 0;
  for (const g of groups) {
    amount = amount.add(g.amountCny);
    ledgerCount += g.count;
    billableCount += g.billableCount;
    pendingCount += g.pending;
    if (g.status === "failed") failedCount += g.count;
    if (g.costStatus === "unpriced") unpricedCount += g.count;
    if (["missing_usage", "pending"].includes(g.costStatus))
      missingUsageCount += g.count;
    if (
      g.costStatus === "missing_rate" ||
      (g.costStatus === "priced" && g.pending)
    )
      missingRateCount += g.count;
    originalTotals.set(
      g.currency,
      (originalTotals.get(g.currency) || decimal(0)).add(g.originalAmount),
    );
    const day = daily.get(g.day)!;
    day.amount = day.amount.add(g.amountCny);
    day.count += g.count;
    day.billableCount += g.billableCount;
    const variant = isGptImageVariantModel(g.model) ? (g.providerModel || "") : undefined;
    const key = `${g.provider}|${g.model}|${variant ?? ""}`;
    const m = models.get(key) || {
      provider: g.provider,
      model: g.model,
      providerModel: variant,
      module: g.module,
      currency: "CNY",
      count: 0,
      success: 0,
      failed: 0,
      billableCount: 0,
      unpricedCount: 0,
      pendingCount: 0,
      unitType: "mixed",
      unitCount: 0,
      unitPrice: 0,
      amount: decimal(0),
      quantities: {} as Record<string, string>,
      segments: [],
    };
    m.count += g.count;
    m.billableCount += g.billableCount;
    m.pendingCount += g.pending;
    if (g.status === "success") m.success += g.count;
    if (g.status === "failed") m.failed += g.count;
    if (g.costStatus === "unpriced") m.unpricedCount += g.count;
    m.amount = m.amount.add(g.amountCny);
    m.quantities[g.unitType] = decimal(m.quantities[g.unitType] || 0)
      .add(g.unitCount)
      .toString();
    m.segments.push({ ...g, unitPrice: String(g.unitPrice) });
    models.set(key, m);
    const mod = modules.get(g.module) || {
      module: g.module,
      count: 0,
      amount: decimal(0),
      billableCount: 0,
    };
    mod.count += g.count;
    mod.billableCount += g.billableCount;
    mod.amount = mod.amount.add(g.amountCny);
    modules.set(g.module, mod);
  }
  return {
    range: {
      mode: scope.dateFrom ? "range" : "month",
      month: scope.month,
      start: start.toISOString(),
      end: end.toISOString(),
      timezone: "Asia/Shanghai",
    },
    summary: {
      totalAmount: amount.toFixed(8),
      currency: "CNY",
      ledgerCount,
      billableCount,
      nonBillableCount: ledgerCount - billableCount,
      failedCount,
      unpricedCount,
      missingUsageCount,
      missingRateCount,
      pendingCount,
      complete: pendingCount === 0,
      avgAmount: billableCount ? amount.div(billableCount).toFixed(8) : "0",
      originalTotals: Object.fromEntries(
        [...originalTotals].map(([k, v]) => [k, v.toFixed(8)]),
      ),
    },
    daily: [...daily.values()].map((d) => ({
      ...d,
      amount: d.amount.toFixed(8),
    })),
    models: [...models.values()]
      .map((m) => ({
        ...m,
        unitType:
          Object.keys(m.quantities).length === 1
            ? Object.keys(m.quantities)[0]
            : "mixed",
        unitCount:
          Object.keys(m.quantities).length === 1
            ? Object.values(m.quantities)[0]
            : 0,
        amount: m.amount.toFixed(8),
      }))
      .sort((a, b) => Number(b.amount) - Number(a.amount)),
    modules: [...modules.values()].map((m) => ({
      ...m,
      amount: m.amount.toFixed(8),
    })),
  };
}
export function currentBillingMonth() {
  return shanghaiDay(new Date()).slice(0, 7);
}
export function csvCell(value: unknown) {
  const str = String(value ?? "");
  return `"${(/^[=+@\-\t\r]/.test(str) ? "'" : "") + str.replaceAll('"', '""')}"`;
}
