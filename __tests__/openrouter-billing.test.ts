import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {}, prisma: {} }));
import { upsertUsageLedgerForGeneration } from "@/lib/billing-ledger";
import { DEFAULT_PRICE_RULES } from "@/lib/billing/default-prices";

describe("OpenRouter reported USD billing", () => {
  it.each([0.13, 0, undefined, -1, "0.13"])("accounts for reported cost %s without inventing usage", async (cost) => {
    const rule = DEFAULT_PRICE_RULES.find(r => r.provider === "openrouter" && r.currency === "USD")!;
    const db = {
      billingPriceRule: { findMany: vi.fn(async () => [{ ...rule, id: 1, effectiveFrom: new Date("2026-01-01"), isActive: true }]) },
      usageLedger: { upsert: vi.fn(async ({ create }) => create) },
      appSetting: { findUnique: vi.fn(async () => ({ value: JSON.stringify({ mode: "observe", rates: [{ id: "test-rate", provider: "openrouter", currency: "USD", rate: "7", effectiveFrom: "2026-01-01", notes: "test" }] }) })) },
    };
    const ledger = await upsertUsageLedgerForGeneration({
      id: 1, userId: "7", authUserId: 7, type: "image_edit", source: "tool", prompt: "test",
      model: rule.model, externalProvider: "openrouter", externalTaskId: "1", status: "success",
      templateData: JSON.stringify({ providerUsage: { usage: { cost } } }),
      createdAt: new Date("2026-09-24"), finishedAt: new Date("2026-09-24"), errorMsg: null,
    }, db);
    const valid = typeof cost === "number" && cost >= 0;
    expect(ledger.costStatus).toBe(valid ? "priced" : "missing_usage");
    expect(Number(ledger.amount)).toBe(valid ? cost : 0);
    expect(ledger.currency).toBe("USD");
  });
});


it("settles a CNY draft tariff at seven yuan per reported dollar without double conversion", async () => {
  const rule = { ...DEFAULT_PRICE_RULES.find(r => r.provider === "openrouter" && r.currency === "USD")!, currency: "CNY", unitPrice: 7, id: 1, effectiveFrom: new Date("2026-01-01"), isActive: true };
  // Higher-priority reference prices must never replace or supplement usage.cost.
  const references = ["text_input_million_token", "image_input_million_token", "image_output_million_token"].map((unitType, i) => ({ ...rule, id: i + 2, priority: 999, unitType, unitPrice: [35, 56, 210][i] }));
  const db = { billingPriceRule: { findMany: vi.fn(async () => [...references, rule]) }, usageLedger: { upsert: vi.fn(async ({ create }) => create) }, appSetting: { findUnique: vi.fn(async () => null) } };
  const result = await upsertUsageLedgerForGeneration({ id: 1, userId: "7", authUserId: 7, type: "image_edit", source: "tool", prompt: "test", model: rule.model, externalProvider: "openrouter", externalTaskId: "1", status: "success", templateData: JSON.stringify({ providerUsage: { usage: { cost: 0.13 } } }), createdAt: new Date("2026-09-24"), finishedAt: new Date("2026-09-24"), errorMsg: null }, db);
  expect(result.currency).toBe("CNY");
  expect(Number(result.amount)).toBe(0.91);
  expect(result.pricingSnapshot.conversion.amountCny).toBe("0.91000000");
  expect(result.costStatus).toBe("priced");
});

it("does not estimate a charge from reference tariffs when the settlement rule is missing", async () => {
  const rule = { ...DEFAULT_PRICE_RULES.find(r => r.provider === "openrouter" && r.currency === "USD")!, unitType: "image_output_million_token", unitPrice: 210, currency: "CNY", id: 1, effectiveFrom: new Date("2026-01-01"), isActive: true };
  const db = { billingPriceRule: { findMany: vi.fn(async () => [rule]) }, usageLedger: { upsert: vi.fn(async ({ create }) => create) }, appSetting: { findUnique: vi.fn(async () => null) } };
  const result = await upsertUsageLedgerForGeneration({ id: 1, userId: "7", authUserId: 7, type: "image_edit", source: "tool", prompt: "test", externalTaskId: "1", errorMsg: null, model: rule.model, externalProvider: "openrouter", status: "success", templateData: JSON.stringify({ providerUsage: { usage: { cost: 0.13 } } }), createdAt: new Date("2026-09-30"), finishedAt: new Date("2026-09-30") }, db);
  expect(result.costStatus).toBe("unpriced");
  expect(Number(result.amount)).toBe(0);
});
