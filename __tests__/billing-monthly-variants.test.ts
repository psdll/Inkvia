import { expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {} }));
import { monthlyReport, billingWhere } from "@/lib/billing/monthly";
it.each([
  ["apimart", "gpt-image-2.5-apimart"],
  ["aicoming-haiya", "gpt-image-2.5-aicoming-haiya"],
  ["reapi", "gpt-image-2.5-reapi"],
])("separates %s Fast and Pro amounts and counts without changing total costs", async (provider, model) => {
  const base = { day: "2026-09-01", provider, model, module: "image", source: "tool", currency: "CNY", unitType: "media_token", unitPrice: "0", rate: "1", rateId: "CNY", priceFrom: null, costStatus: "priced", status: "success", billableCount: 1, count: 1, pending: 0, unitCount: "10" };
  const db = { $queryRaw: vi.fn().mockResolvedValue([
    { ...base, providerModel: "gpt-image-2.5-flare", amountCny: "2", originalAmount: "2" },
    { ...base, providerModel: "gpt-image-2.5-sunburst", amountCny: "5", originalAmount: "5" },
  ]) };
  const result = await monthlyReport({ month: "2026-09" }, db);
  expect(result.models).toHaveLength(2);
  expect(result.models.find(m => m.providerModel === "gpt-image-2.5-flare")).toMatchObject({ count: 1, amount: "2.00000000" });
  expect(result.models.find(m => m.providerModel === "gpt-image-2.5-sunburst")).toMatchObject({ count: 1, amount: "5.00000000" });
  expect(result.summary.totalAmount).toBe("7.00000000");
  expect(billingWhere({ month: "2026-09", model: base.model, providerModel: "gpt-image-2.5-flare" })).toMatchObject({ providerModel: "gpt-image-2.5-flare" });
  expect(billingWhere({ month: "2026-09", model: base.model, providerModel: "" })).toMatchObject({ providerModel: null });
});
