import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {} }));
import { previewReconciliation } from "@/lib/billing/reconcile";
import { EMPTY_BILLING_SETTINGS } from "@/lib/billing/money";
import { monthlyReport } from "@/lib/billing/monthly";
import { upsertUsageLedgerForGeneration } from "@/lib/billing-ledger";

describe("deleted model accounting history", () => {
  it("reconciles a retired model with its historical CNY price without provider config or FX", async () => {
    const row = {
      id: 7, externalProvider: "reapi", model: "gpt-5.5", unitType: "token",
      occurredAt: new Date("2026-09-01T00:00:00Z"), updatedAt: new Date(),
      costStatus: "unpriced", usageSnapshot: { inputTokens: 1000000, outputTokens: 0 },
      amount: "0", currency: "CNY",
    };
    const rule = { id: 1, unitType: "input_million_token", unitPrice: "7",
      currency: "CNY", isActive: true, effectiveFrom: new Date("2026-01-01"),
      effectiveTo: new Date("2026-09-10"), matchConditions: {} };
    const db = {
      usageLedger: { findMany: vi.fn().mockResolvedValue([row]) },
      billingPriceRule: { findMany: vi.fn().mockResolvedValue([
        { ...rule, id: 2, unitPrice: "99", effectiveFrom: new Date("2026-09-10"), effectiveTo: null }, rule,
      ]) },
    };
    const preview = await previewReconciliation(db, {}, EMPTY_BILLING_SETTINGS);
    expect(preview.updates).toHaveLength(1);
    expect(preview.updates[0].after).toBe("7.00000000");
    expect(preview.updates[0].data.pricingSnapshot.conversion.rate).toBe("1");
    expect(row.costStatus).toBe("unpriced"); // Preview does not write.
    const settled = { ...row, ...preview.updates[0].data };
    const callbackDb = {
      usageLedger: { findUnique: vi.fn().mockResolvedValue(settled), upsert: vi.fn() },
      billingPriceRule: { findMany: vi.fn() },
    };
    expect(await upsertUsageLedgerForGeneration({ id: 7 } as any, callbackDb)).toBe(settled);
    expect(callbackDb.billingPriceRule.findMany).not.toHaveBeenCalled();
    expect(callbackDb.usageLedger.upsert).not.toHaveBeenCalled();
  });

  it("keeps retired-model amounts and pending calls in historical monthly totals", async () => {
    const base = {
      day: "2026-09-01", provider: "reapi", model: "gpt-5.5", module: "agent",
      source: "agent", currency: "CNY", unitType: "token", unitPrice: "7",
      rate: "1", rateId: "CNY", priceFrom: "2026-01-01", status: "success",
      count: 1, billableCount: 1, unitCount: "1000000",
    };
    const db = { $queryRaw: vi.fn().mockResolvedValue([
      { ...base, costStatus: "priced", pending: 0, amountCny: "7", originalAmount: "7" },
      { ...base, costStatus: "unpriced", pending: 1, amountCny: "0", originalAmount: "0" },
    ]) };
    const result = await monthlyReport({ month: "2026-09" }, db);
    expect(result.summary.totalAmount).toBe("7.00000000");
    expect(result.summary.pendingCount).toBe(1);
    expect(result.models[0]).toMatchObject({ model: "gpt-5.5", count: 2, pendingCount: 1 });
    expect(result.models[0].segments[0]).toMatchObject({ unitPrice: "7", rate: "1", priceFrom: "2026-01-01" });
  });
});
