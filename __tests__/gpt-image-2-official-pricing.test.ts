import { describe, expect, it } from "vitest";

import {
  GPT_IMAGE_2_OFFICIAL_DEFAULT_PRICE_RULES,
  REAPI_GPT_IMAGE_2_PRICE_RULES,
} from "@/lib/gpt-image-2-official-pricing";

function findReapi(resolution: string, quality: string, aspectRatio: string) {
  return REAPI_GPT_IMAGE_2_PRICE_RULES.find((rule) => {
    const conditions = rule.matchConditions as Record<string, string>;
    return conditions.resolution === resolution
      && conditions.quality === quality
      && conditions.aspectRatio === aspectRatio;
  });
}

describe("GPT-Image-2 official default billing snapshots", () => {
  it("expands the reAPI aspect-ratio, resolution and quality price matrix in CNY", () => {
    expect(REAPI_GPT_IMAGE_2_PRICE_RULES).toHaveLength(105);
    expect(findReapi("1K", "low", "3:4")?.unitPrice).toBeCloseTo(0.144, 8);
    expect(findReapi("4K", "high", "16:9")?.unitPrice).toBeCloseTo(6.86592, 8);
  });

  it("bills reAPI auto ratio at the most expensive ratio for the same resolution and quality", () => {
    expect(findReapi("2K", "high", "auto")?.unitPrice).toBeCloseTo(5.56992, 8);
    expect(findReapi("4K", "high", "auto")?.unitPrice).toBeCloseTo(6.86592, 8);
  });

  it("contains only the reAPI official default price matrix", () => {
    expect(GPT_IMAGE_2_OFFICIAL_DEFAULT_PRICE_RULES).toHaveLength(105);
  });
});
