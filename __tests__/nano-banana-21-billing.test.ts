import { expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {}, prisma: {} }));
import { upsertUsageLedgerForGeneration } from "@/lib/billing-ledger";
import { NANO_BANANA_21_PRICE_RULES } from "@/lib/billing/nano-banana-21-pricing";
const run = (provider: string, params: any, usage: any) => {
  const rules = NANO_BANANA_21_PRICE_RULES.filter(r => r.provider === provider).map((r, id) => ({ ...r, id, isActive: true, effectiveFrom: new Date("2026-10-13") }));
  const db = { billingPriceRule: { findMany: vi.fn(async () => rules) }, usageLedger: { upsert: vi.fn(async ({ create }) => create) }, appSetting: { findUnique: vi.fn(async () => ({ value: JSON.stringify({ mode: "observe", rates: [{ id: "discount", provider: "apimart", currency: "CREDIT", rate: "0.7", effectiveFrom: "2026-01-01" }] }) })) } };
  return upsertUsageLedgerForGeneration({ id: 1, userId: "7", authUserId: 7, type: "image_edit", source: "tool", model: rules[0].model, externalProvider: provider, externalTaskId: "test", status: "success", templateData: JSON.stringify({ ...params, providerUsage: usage }), createdAt: new Date("2026-10-13T05:00:00Z"), finishedAt: new Date(), prompt: "photo", errorMsg: null }, db);
};
it.each([["1K", 0.14], ["2K", 0.21], ["4K", 0.315]])("Kie %s uses platform list price at 7 CNY/USD", async (resolution, amount) => {
  const ledger = await run("kie", { resolution }, null);
  expect(ledger.costStatus).toBe("priced"); expect(ledger.currency).toBe("CNY"); expect(Number(ledger.amount)).toBe(amount);
});
it("OpenRouter converts actual USD exactly once, without adding reference tariffs", async () => {
  const ledger = await run("openrouter", {}, { usage: { cost: 0.1 } });
  expect(ledger.costStatus).toBe("priced"); expect(ledger.currency).toBe("CNY"); expect(Number(ledger.amount)).toBe(0.7);
});
it("APIMart charges official token tariffs including thinking, ignoring membership cost", async () => {
  const ledger = await run("apimart", {}, { cost: 0.01, credits_cost: 0.1, usage: { input_tokens_details: { text_tokens: 1000, image_tokens: 1000 }, output_tokens_details: { text_tokens: 1000, image_tokens: 1000 } } });
  expect(ledger.costStatus).toBe("priced"); expect(ledger.currency).toBe("CNY"); expect(Number(ledger.amount)).toBe(0.2835);
});
it("APIMart does not replace missing tokens with membership charge or estimated image prices", async () => {
  const ledger = await run("apimart", { resolution: "4K" }, { cost: 0.01, credits_cost: 0.1 });
  expect(ledger.costStatus).toBe("missing_usage"); expect(Number(ledger.amount)).toBe(0);
});
