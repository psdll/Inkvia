import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/billing/settings", () => ({ readBillingSettings: async () => ({ mode: "strict", rates: [] }) }));
import { MINIMAX_M3_QUOTES } from "@/lib/billing/minimax-pricing";
import { selectTokenPrices, beginLlmCost, finishLlmCost } from "@/lib/billing/llm";
import { tokenCharges } from "@/lib/billing/money";
const rules = MINIMAX_M3_QUOTES.map((q, i) => ({ id: i + 1, unitType: q.unitType, unitPrice: q.price, matchConditions: q.conditions, currency: "CNY", effectiveFrom: new Date("2026-01-01"), effectiveTo: null, isActive: true }));
describe("MiniMax M3 standard CNY pricing", () => {
  it("selects the correct prices at the 512000 boundary", () => {
    expect(selectTokenPrices(rules, new Date(), 512000).input_million_token).toBe("4.2");
    expect(selectTokenPrices(rules, new Date(), 512001).input_million_token).toBe("8.4");
    expect(selectTokenPrices(rules, new Date(), undefined)).toEqual({});
  });
  it("counts cached input once and leaves unpublished cache writes unpriced", () => {
    const prices = selectTokenPrices(rules, new Date(), 600000);
    expect(tokenCharges({ inputTokens: 600000, outputTokens: 100000, cachedInputTokens: 100000 }, prices)?.amount).toBe("7.72800000");
    expect(tokenCharges({ inputTokens: 600000, outputTokens: 1, cacheCreationInputTokens: 1 }, prices)).toBeNull();
  });
  it("accepts all six prices in strict mode and settles with the captured long-input tier", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { billingPriceRule: { findMany: async () => structuredClone(rules) }, usageLedger: { create: async () => ({ id: 1 }), updateMany } };
    const call = await beginLlmCost({ provider: "minimax", model: "MiniMax-M3", source: "test" }, db);
    await finishLlmCost(call, { inputTokens: 600000, outputTokens: 100000, cachedInputTokens: 100000 }, true, db);
    expect(updateMany.mock.calls[1][0].data.costStatus).toBe("priced");
    expect(updateMany.mock.calls[1][0].data.amount).toBe("7.72800000");
    expect(updateMany.mock.calls[1][0].data.pricingSnapshot.conversion.amountCny).toBe("7.72800000");
  });
  it("rejects incomplete high-context tariffs in strict mode", async () => {
    await expect(beginLlmCost({ provider: "minimax", model: "MiniMax-M3", source: "test" }, { billingPriceRule: { findMany: async () => rules.slice(0, 3) } })).rejects.toThrow("尚未配齐");
  });
});
