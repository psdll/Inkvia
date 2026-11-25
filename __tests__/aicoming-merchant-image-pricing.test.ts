import { describe, expect, it } from "vitest";
import {
  AICOMING_HAIYA_GPT_IMAGE_2_PRICE_RULES,
  AICOMING_MERCHANT_IMAGE_DEFAULT_PRICE_RULES,
} from "@/lib/aicoming-merchant-pricing";

describe("AIComing merchant image default price snapshots", () => {
  it("uses the merchant CNY image prices while preserving the existing model identity", () => {
    expect(AICOMING_HAIYA_GPT_IMAGE_2_PRICE_RULES.map((rule) => ({
      resolution: rule.matchConditions.resolution,
      unitPrice: rule.unitPrice,
    }))).toEqual([
      { resolution: "1K", unitPrice: 0.04 },
      { resolution: "2K", unitPrice: 0.05 },
      { resolution: "4K", unitPrice: 0.15 },
    ]);
    for (const rule of AICOMING_HAIYA_GPT_IMAGE_2_PRICE_RULES) {
      expect(rule).toMatchObject({
        provider: "aicoming-haiya",
        model: "gpt-image-2-aicoming-haiya",
        displayName: "GPT-Image-2（hai）",
        currency: "CNY",
        unitType: "image",
      });
    }
    expect(AICOMING_MERCHANT_IMAGE_DEFAULT_PRICE_RULES).toHaveLength(9);
  });
});
