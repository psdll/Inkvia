import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/providers/registry", () => ({ getRegisteredProviders: async () => [{
  id: "bigmodel", name: "智谱 BigModel", enabled: true, imageModels: [], videoModels: [], audioModels: [],
  chatModels: ["glm-5.3", "glm-5.3-flash", "other-chat"],
}] }));
vi.mock("@/lib/providers/model-availability", () => ({ isProviderModelEnabled: () => true }));
import { getBillingCatalog } from "@/lib/billing/catalog";
import { beginLlmCost, llmCostSettlement } from "@/lib/billing/llm";
import { EMPTY_BILLING_SETTINGS } from "@/lib/billing/money";

const model = "glm-5.3";
const rules = Object.entries({ input_million_token: "8", output_million_token: "28", cached_million_token: "2" })
  .map(([unitType, unitPrice], id) => ({ id, provider: "bigmodel", model, module: "agent", unitType, unitPrice,
    currency: "CNY", isActive: true, priority: 100, matchConditions: {}, effectiveFrom: new Date("2026-08-01"), effectiveTo: null }));
const db = {
  billingPriceRule: { findMany: async () => rules },
  appSetting: { findUnique: async () => ({ value: JSON.stringify({ ...EMPTY_BILLING_SETTINGS, mode: "strict" }) }) },
  usageLedger: { create: async () => ({ id: 1 }) },
};

describe("BigModel implicit cache pricing", () => {
  it("marks three published rates complete without requesting an unsupported cache-write price", async () => {
    const catalog = await getBillingCatalog(EMPTY_BILLING_SETTINGS, new Date(), db);
    const evolving = catalog.find(m => m.provider === "bigmodel" && m.model === model)!;
    expect(evolving.complete).toBe(true);
    expect(catalog.find(m => m.model === "glm-5.3-flash")!.slots.map(s => s.unitType)).toEqual(["input_million_token", "output_million_token", "cached_million_token"]);
    expect(evolving.slots.map(s => s.unitType)).toEqual(["input_million_token", "output_million_token", "cached_million_token"]);
    expect(catalog.find(m => m.provider === "bigmodel" && m.model === "other-chat")!.slots.some(s => s.unitType === "cache_creation_million_token")).toBe(true);
  });
  it("allows strict billing and charges implicit cached tokens once", async () => {
    const call = await beginLlmCost({ provider: "bigmodel", model, source: "test" }, db);
    const result = llmCostSettlement(call.snapshot, { inputTokens: 1000000, outputTokens: 1000000, cachedInputTokens: 500000 });
    expect(result.costStatus).toBe("priced");
    expect(result.amount).toBe("33.00000000");
    await expect(beginLlmCost({ provider: "bigmodel", model, source: "test" }, {
      ...db, billingPriceRule: { findMany: async () => rules.slice(0, 2) },
    })).rejects.toThrow("尚未配齐");
  });
});
