import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/providers/registry", () => ({
  getRegisteredProviders: async () => [],
}));
import { getBillingCatalog } from "@/lib/billing/catalog";
import { GPT_IMAGE_2_OFFICIAL_DEFAULT_PRICE_RULES } from "@/lib/gpt-image-2-official-pricing";
describe("GPT-Image-2 model price matrix", () => {
  it("keeps retired reAPI models out of configuration even when their historical tariffs exist", async () => {
    const db = {
      billingPriceRule: { findMany: async () => GPT_IMAGE_2_OFFICIAL_DEFAULT_PRICE_RULES },
      usageLedger: { groupBy: async () => [] },
    };
    const models = await getBillingCatalog(
      { mode: "observe", rates: [], revision: 0 },
      new Date("2026-09-22"),
      db,
    );
    expect(GPT_IMAGE_2_OFFICIAL_DEFAULT_PRICE_RULES.length).toBeGreaterThan(0);
    expect(models.length).toBeGreaterThan(0);
    expect(models.filter(m => m.provider === "reapi").map(m => m.model)).not.toContain("gpt-image-2-official-reapi");
    expect(models.filter(m => m.provider === "reapi").map(m => m.model)).not.toContain("gpt-image-2-official");
  });
});
