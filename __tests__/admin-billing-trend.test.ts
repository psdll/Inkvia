import { afterAll, expect, it } from "vitest";
import { buildBillingTrendPeriods, loadAdminBillingTrend } from "@/lib/admin/billing-trend";
import { billingRange, billingWhere, monthlyReport } from "@/lib/billing/monthly";
import type { AdminUserScope } from "@/lib/admin-user-scope";

it("fills empty days across months, sums decimal costs, and keeps pending counts separate", () => {
  const result = buildBillingTrendPeriods([
    { key: "2026-09-30 23", amount: "0.1", pricedCount: 1, pendingCount: 2, count: 3 },
    { key: "2026-10-01 00", amount: "0.2", pricedCount: 1, pendingCount: 0, count: 1 },
  ], new Date("2026-09-30T16:30:00Z"));
  expect(result[0]).toMatchObject({ dateFrom: "2026-10-01", dateTo: "2026-10-01", amount: "0.20000000", pendingCount: 0 });
  expect(result[0].points).toHaveLength(1);
  expect(result[1]).toMatchObject({ dateFrom: "2026-09-29", amount: "0.30000000", dailyAverage: "0.10000000", pendingCount: 2 });
  expect(result[1].points[0]).toMatchObject({ amount: "0.00000000", count: 0 });
  expect(result[2].points).toHaveLength(7);
});

it("uses inclusive Shanghai dates for all bill queries and rejects invalid or unbounded ranges", () => {
  const range = { month: "2026-10", dateFrom: "2026-09-29", dateTo: "2026-10-01" };
  expect(billingRange(range).keys).toEqual(["2026-09-29", "2026-09-30", "2026-10-01"]);
  expect(billingWhere(range).occurredAt).toEqual({ gte: new Date("2026-09-28T16:00:00Z"), lt: new Date("2026-10-01T16:00:00Z") });
  for (const extra of [{ dateFrom: "2026-02-30" }, { dateFrom: "2026-10-02" }, { dateFrom: "2026-08-01" }, { dateTo: undefined }]) {
    expect(() => billingRange({ ...range, ...extra })).toThrow();
  }
});

let db: any;
afterAll(async () => { await db?.$disconnect(); });
const integration = process.env.RUN_P0_DB_TESTS === "1" ? it : it.skip;
integration("matches the bill's stored conversions and pending counts without including other users or failed charges", async () => {
  db = (await import("@/lib/prisma")).default;
  await db.$transaction(async (tx: any) => {
    await tx.$executeRaw`CREATE TEMP TABLE "UsageLedger" (
      "authUserId" int, "userId" text, "occurredAt" timestamp, "costStatus" text, currency text, amount numeric,
      "pricingSnapshot" jsonb, "externalProvider" text, model text, "providerModel" text, module text, source text,
      "unitType" text, "unitPrice" numeric, status text, billable boolean, "unitCount" numeric
    ) ON COMMIT DROP`;
    const now = new Date("2026-10-01T02:00:00Z");
    const at = new Date("2026-09-30T16:05:00Z");
    await tx.$executeRaw`INSERT INTO "UsageLedger" ("authUserId","userId","occurredAt","costStatus",currency,amount,"pricingSnapshot") VALUES
      (7,'device',${at},'priced','USD',2,'{"conversion":{"amountCny":"14.2"}}'),
      (NULL,'old',${at},'priced','CNY',0.1,NULL),
      (7,'device',${at},'priced','USD',99,NULL),
      (7,'device',${at},'unpriced','CNY',999,NULL),
      (7,'device',${at},'failed','CNY',999,NULL),
      (7,'device',${at},'free','CNY',0,NULL),
      (8,'old',${at},'priced','CNY',999,NULL)`;
    await tx.$executeRaw`UPDATE "UsageLedger" SET model='model',module='image',source='tool',"unitType"='image',"unitPrice"=1,status='success',billable=true,"unitCount"=1`;
    const scope: AdminUserScope = { requestedUserId: "7", authUserId: 7, linkedUserIds: ["old"], linkedGuestUserIds: ["old"], presetUserIds: [], generationWhere: {}, logWhere: {} };
    const [today] = await loadAdminBillingTrend(scope, now, tx);
    const report = await monthlyReport({ month: "2026-10", dateFrom: today.dateFrom, dateTo: today.dateTo, identity: { authUserId: 7, userIds: ["old"] } }, tx);
    expect(today).toMatchObject({ amount: "14.30000000", pricedCount: 3, pendingCount: 2, count: 6 });
    expect(today.amount).toBe(report.summary.totalAmount);
    expect(today.pendingCount).toBe(report.summary.pendingCount);
    const [guest] = await loadAdminBillingTrend({ ...scope, authUserId: null, requestedUserId: "old" }, now, tx);
    expect(guest).toMatchObject({ amount: "0.10000000", count: 1 });
  });
});
