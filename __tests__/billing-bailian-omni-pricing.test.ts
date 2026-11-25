import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/providers/registry", () => ({ getRegisteredProviders: async () => [{
  id: "bailian", name: "阿里云百炼", enabled: true, imageModels: [], videoModels: [], audioModels: [],
  chatModels: ["qwen3.8-omni-flash", "qwen3.8-flash"],
}] }));
vi.mock("@/lib/providers/model-availability", () => ({ isProviderModelEnabled: () => true }));
import { getBillingCatalog } from "@/lib/billing/catalog";
import { beginLlmCost, llmCostSettlement } from "@/lib/billing/llm";
import { readBillingSettings } from "@/lib/billing/settings";
import { validateDraft } from "@/lib/billing/drafts";
import { EMPTY_BILLING_SETTINGS } from "@/lib/billing/money";

const model = "qwen3.8-omni-flash";
const rules = Object.entries({ input_million_token: "0.8", output_million_token: "2.7", cached_million_token: "0.1" })
  .map(([unitType, unitPrice], id) => ({ id, provider: "bailian", model, module: "agent", unitType, unitPrice,
    currency: "CNY", isActive: true, priority: 100, matchConditions: {}, effectiveFrom: new Date("2026-08-01"), effectiveTo: null }));
const db = {
  billingPriceRule: { findMany: async () => rules },
  appSetting: { findUnique: async () => ({ value: JSON.stringify({ ...EMPTY_BILLING_SETTINGS, mode: "strict" }) }) },
  usageLedger: { create: async () => ({ id: 1 }) },
};

describe("Bailian Omni implicit cache pricing", () => {
  it("marks three published rates complete without requesting an unsupported cache-write price", async () => {
    const catalog = await getBillingCatalog(EMPTY_BILLING_SETTINGS, new Date(), db);
    const omni = catalog.find(m => m.provider === "bailian" && m.model === model)!;
    expect(omni.complete).toBe(true);
    expect(omni.slots.map(s => s.unitType)).toEqual(["input_million_token", "output_million_token", "cached_million_token"]);
    expect(catalog.find(m => m.provider === "bailian" && m.model === "qwen3.8-flash")!.slots.some(s => s.unitType === "cache_creation_million_token")).toBe(true);
  });
  it("allows strict billing and charges implicit cached tokens once", async () => {
    const call = await beginLlmCost({ provider: "bailian", model, source: "test" }, db);
    const result = llmCostSettlement(call.snapshot, { inputTokens: 1000000, outputTokens: 1000000, cachedInputTokens: 500000 });
    expect(result.costStatus).toBe("priced");
    expect(result.amount).toBe("3.15000000");
    await expect(beginLlmCost({ provider: "bailian", model, source: "test" }, {
      ...db, billingPriceRule: { findMany: async () => rules.slice(0, 2) },
    })).rejects.toThrow("尚未配齐");
  });
  it("removes only the empty legacy Omni cache-write placeholder from loaded drafts", async () => {
    const make = (provider: string, price: string, unitType = "cache_creation_million_token") => validateDraft({
      provider, model, module: "agent", currency: "CNY", rows: [{ unitType, price, conditions: {} }],
    });
    const keep = [make("other", ""), make("bailian", "1"), make("bailian", "", "cached_million_token")];
    const saved = { ...EMPTY_BILLING_SETTINGS, revision: 8, drafts: [make("bailian", ""), ...keep] };
    const result = await readBillingSettings({ appSetting: { findUnique: async () => ({ value: JSON.stringify(saved) }) } });
    expect(result).toEqual({ ...saved, drafts: keep });
    expect(saved.drafts).toHaveLength(4);
  });
});
