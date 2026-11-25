import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/billing/settings", () => ({ readBillingSettings: async () => ({ mode: "strict", rates: [] }) }));
import { DEEPSEEK_QUOTES, deepseekTimeBand } from "@/lib/billing/deepseek-pricing";
import { selectTokenPrices, beginLlmCost, finishLlmCost } from "@/lib/billing/llm";
import { tokenCharges } from "@/lib/billing/money";
import { openAiChatAdapter } from "@/lib/llm-routing/adapters/openai-chat";
afterEach(() => vi.useRealTimers());
const rules = (model: string) => DEEPSEEK_QUOTES[model].map((q, i) => ({ id: i + 1, unitType: q.unitType, unitPrice: q.price, matchConditions: q.conditions, currency: "CNY", effectiveFrom: new Date("2026-01-01"), effectiveTo: null, isActive: true }));
describe("DeepSeek CNY drafts and time tariffs", () => {
  it("reads the DeepSeek cache field in routed calls", () => {
    expect(openAiChatAdapter.readUsage?.({ usage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 70, prompt_cache_miss_tokens: 30 } })).toMatchObject({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 70 });
  });
  it.each([["08:59:59", "off_peak"], ["09:00:00", "peak"], ["11:59:59", "peak"], ["12:00:00", "off_peak"], ["13:59:59", "off_peak"], ["14:00:00", "peak"], ["17:59:59", "peak"], ["18:00:00", "off_peak"]])("matches Shanghai boundary %s", (time, expected) => {
    expect(deepseekTimeBand(`2026-09-22T${time}+08:00`)).toBe(expected);
  });
  it("treats holidays and makeup weekends as off-peak; unknown-year weekdays stay unknown", () => {
    for (const date of ["2026-09-25", "2026-10-01", "2026-10-07", "2026-09-20", "2026-10-10"])
      expect(deepseekTimeBand(`${date}T10:00:00+08:00`)).toBe("off_peak");
    expect(deepseekTimeBand("2027-01-04T10:00:00+08:00")).toBeUndefined();
    expect(selectTokenPrices(rules("deepseek-v4-pro"), "2027-01-04T10:00:00+08:00", 100)).toEqual({});
  });
  it("prices legacy Flash aliases equally and does not double charge cache hits", () => {
    const at = "2026-09-22T10:00:00+08:00";
    const usage = { inputTokens: 1000000, outputTokens: 100000, cachedInputTokens: 500000 };
    for (const model of ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"])
      expect(tokenCharges(usage, selectTokenPrices(rules(model), at, usage.inputTokens))?.amount).toBe("1.82000000");
    expect(tokenCharges(usage, selectTokenPrices(rules("deepseek-v4-pro"), at, usage.inputTokens))?.amount).toBe("7.35000000");
    expect(tokenCharges(usage, selectTokenPrices(rules("deepseek-v4-pro"), "2026-09-22T12:00:00+08:00", usage.inputTokens))?.amount).toBe("3.67500000");
  });
  it("settles with the original request time when the response crosses a tariff boundary", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-22T11:59:59+08:00"));
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { billingPriceRule: { findMany: async () => rules("deepseek-v4-pro") }, usageLedger: { create: async () => ({ id: 1 }), updateMany } };
    const call = await beginLlmCost({ provider: "deepseek", model: "deepseek-v4-pro", source: "test" }, db);
    vi.setSystemTime(new Date("2026-09-22T12:00:10+08:00"));
    await finishLlmCost(call, { inputTokens: 1000000, outputTokens: 100000, cachedInputTokens: 500000 }, true, db);
    expect(updateMany.mock.calls[1][0].data.costStatus).toBe("priced");
    expect(updateMany.mock.calls[1][0].data.pricingSnapshot.conversion.amountCny).toBe("7.35000000");
  });
});
