import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/billing/settings", () => ({ readBillingSettings: async () => ({ rates: [] }) }));
import { GOOGLE_IMAGE_QUOTES, googleImageTokenCounts } from "@/lib/billing/google-pricing";
import { recordMediaTokenCost } from "@/lib/billing/media-token";
import { decimal } from "@/lib/billing/money";
const usage = { promptTokenCount: 1000, candidatesTokenCount: 1220, thoughtsTokenCount: 50, candidatesTokensDetails: [{ modality: "TEXT", tokenCount: 100 }, { modality: "IMAGE", tokenCount: 1120 }] };
describe("Google image pricing", () => {
  it("includes thinking once and separates image output from text", () => {
    expect(googleImageTokenCounts(usage)).toEqual({ input_million_token: 1000, text_output_million_token: 150, image_output_million_token: 1120 });
  });
  it("prices real IMAGE-only details with residual response text and thinking once", () => {
    expect(googleImageTokenCounts({ promptTokenCount: 3, candidatesTokenCount: 1229,
      thoughtsTokenCount: 179, totalTokenCount: 1411,
      candidatesTokensDetails: [{ modality: "IMAGE", tokenCount: 1120 }] })).toEqual({
        input_million_token: 3, text_output_million_token: 288, image_output_million_token: 1120,
      });
  });
  it("rejects overcounts, contradictory totals and unsupported modalities", () => {
    const actual = { promptTokenCount: 3, candidatesTokenCount: 1229, thoughtsTokenCount: 179,
      totalTokenCount: 1411, candidatesTokensDetails: [{ modality: "IMAGE", tokenCount: 1120 }] };
    expect(googleImageTokenCounts({ ...actual, candidatesTokenCount: 1000 })).toBeNull();
    expect(googleImageTokenCounts({ ...actual, totalTokenCount: 1500 })).toBeNull();
    expect(googleImageTokenCounts({ ...actual, candidatesTokensDetails: [{ modality: "VIDEO", tokenCount: 1120 }] })).toBeNull();
  });
  it("leaves absent or inconsistent modality usage unknown", () => {
    expect(googleImageTokenCounts(null)).toBeNull();
    expect(googleImageTokenCounts({ ...usage, candidatesTokensDetails: undefined })).toBeNull();
    expect(googleImageTokenCounts({ ...usage, candidatesTokenCount: 2000 })).toBeNull();
    expect(googleImageTokenCounts({ ...usage, cachedContentTokenCount: 20 })).toBeNull();
  });
  it("converts all twelve USD rates exactly at 7 CNY/USD", () => {
    expect(Object.values(GOOGLE_IMAGE_QUOTES).flat().map((q) => decimal(q.usd).mul(7).toString())).toEqual(["3.5", "21", "420", "1.75", "10.5", "210", "14", "84", "840", "10.5", "52.5", "210"]);
  });
  it("settles one whole response in CNY without converting twice", async () => {
    const upsert = vi.fn(async (args) => args.create);
    const model = "gemini-3.1-flash-image";
    const rules = GOOGLE_IMAGE_QUOTES[model].map((q, i) => ({ id: i + 1, unitType: q.unitType, unitPrice: decimal(q.usd).mul(7).toString(), matchConditions: {}, currency: "CNY", isActive: true, effectiveFrom: new Date("2026-01-01"), effectiveTo: null }));
    const g = { id: 9, model, externalProvider: "google-ai-studio", status: "success", createdAt: new Date("2026-09-22") };
    const result = await recordMediaTokenCost(g, { providerUsage: { usageMetadata: usage } }, {}, rules, { usageLedger: { upsert } });
    expect(result.externalProvider).toBe("google-ai-studio");
    expect(result.costStatus).toBe("priced");
    expect(result.amount).toBe("0.47705000");
    expect(result.pricingSnapshot.conversion.amountCny).toBe("0.47705000");
    const missing = await recordMediaTokenCost(g, {}, {}, rules, { usageLedger: { upsert } });
    expect(missing.costStatus).toBe("missing_usage");
    expect(missing.pricingSnapshot.conversion.amountCny).toBeNull();
  });
});
