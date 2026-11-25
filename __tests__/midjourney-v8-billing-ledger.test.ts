import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {}, prisma: {} }));

import { upsertUsageLedgerForGeneration } from "@/lib/billing-ledger";
import { APIMART_QUOTES } from "@/lib/billing/apimart-pricing";
import { decimal } from "@/lib/billing/money";

function generation(id: number, billing: Record<string, unknown>, provider = "reapi") {
  return {
    id,
    userId: "7",
    authUserId: 7,
    type: "image_edit",
    source: "tool",
    prompt: "test",
    templateData: JSON.stringify({
      model: `midjourney-v8-${provider}`,
      providerModel: "midjourney",
      outputCount: 4,
      billing,
    }),
    model: `midjourney-v8-${provider}`,
    status: "success",
    requestKey: `midjourney-billing-${id}`,
    externalProvider: provider,
    externalTaskId: "mj-task-82",
    errorMsg: null,
    createdAt: new Date("2026-08-29T00:00:00.000Z"),
    finishedAt: new Date("2026-08-29T00:01:00.000Z"),
  };
}

describe.each(["reapi", "apimart"])("%s Midjourney V8.2 fixed-four billing", (provider) => {
  it.each([["relax", 0.364], ["fast", 0.448], ["turbo", 0.805]])("prices %s once for all four outputs", async (speed, price) => {
    const rules = [["relax", 0.364], ["fast", 0.448], ["turbo", 0.805]].map(([mode, amount], i) => ({
      id: i + 1, provider, model: `midjourney-v8-${provider}`, module: "image",
      unitType: "request", unitPrice: amount, currency: "CNY", isActive: true,
      effectiveFrom: new Date("2026-01-01"), effectiveTo: null, priority: 100,
      matchConditions: { speed: mode },
    }));
    const db = {
      billingPriceRule: { findMany: vi.fn(async () => rules) },
      usageLedger: { upsert: vi.fn(async ({ create }) => create) },
    };
    const item = generation(823, { unitType: "request" }, provider);
    item.templateData = JSON.stringify({ ...JSON.parse(item.templateData), midjourneyV8: { speed } });
    const result = await upsertUsageLedgerForGeneration(item, db);
    expect(result.costStatus).toBe("priced");
    expect(result.unitCount.toNumber()).toBe(1);
    expect(result.amount.toNumber()).toBe(price);
  });
  it("counts the parent as one request and generated child rows as non-billable", async () => {
    const db = {
      billingPriceRule: { findMany: vi.fn(async () => []) },
      usageLedger: { upsert: vi.fn(async ({ create }) => create) },
    };

    const parent = await upsertUsageLedgerForGeneration(generation(821, {
      unitType: "request",
      childBillable: false,
    }, provider), db);
    const child = await upsertUsageLedgerForGeneration(generation(822, {
      unitType: "request",
      childBillable: false,
      billable: false,
    }, provider), db);

    expect(parent).toMatchObject({
      unitType: "request",
      billable: true,
      costStatus: "unpriced",
    });
    expect(parent.unitCount.toNumber()).toBe(1);
    expect(child).toMatchObject({
      unitType: "request",
      billable: false,
      costStatus: "non_billable",
    });
    expect(child.unitCount.toNumber()).toBe(0);
  });
});

describe("APIMART Midjourney official action pricing", () => {
  it.each([
    ["imagine", "relax", "0.3941"], ["edits", "relax", "0.4816"],
    ["imagine", "fast", "0.4816"], ["edits", "fast", "0.4816"],
    ["imagine", "turbo", "0.875"], ["edits", "turbo", "0.875"],
  ])("charges %s / %s once, including all four outputs", async (action, speed, amount) => {
    const rules = APIMART_QUOTES["midjourney-v8-apimart"].map((q, id) => ({
      id, provider: "apimart", model: "midjourney-v8-apimart", module: "image",
      unitType: q.unitType, unitPrice: decimal(q.credits).mul("0.7"), currency: "CNY",
      matchConditions: q.conditions, isActive: true, priority: 100,
      effectiveFrom: new Date("2026-01-01"), effectiveTo: null,
    }));
    const db = {
      billingPriceRule: { findMany: async () => rules },
      usageLedger: { upsert: async ({ create }: any) => create },
    };
    const item = generation(824, { unitType: "request" }, "apimart");
    item.templateData = JSON.stringify({ ...JSON.parse(item.templateData), midjourneyV8: { action, speed } });
    const result = await upsertUsageLedgerForGeneration(item, db);
    expect(result.costStatus).toBe("priced");
    expect(result.unitCount.toString()).toBe("1");
    expect(result.amount.toString()).toBe(amount);
  });
});
