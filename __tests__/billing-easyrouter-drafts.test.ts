import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
vi.mock("@/lib/prisma", () => ({ default: {} }));
import { EASYROUTER_QUOTES } from "@/lib/billing/easyrouter-pricing";
import { selectTokenPrices } from "@/lib/billing/llm";
import { tokenCharges } from "@/lib/billing/money";
import { parseDraftFile } from "@/lib/billing/drafts";
const prices = (model: string, tokens: number) => selectTokenPrices(
  EASYROUTER_QUOTES[model].filter(q => q.price !== "").map(q => ({ unitType: q.unitType, unitPrice: q.price, matchConditions: q.conditions })),
  "2026-09-22T10:00:00+08:00", tokens,
);
describe("EasyRouter CNY purchase prices", () => {
  it("switches every quoted GPT tariff only above the input threshold", () => {
    expect(prices("gpt-5.5",272000)).toEqual({ input_million_token:"35", output_million_token:"210", cached_million_token:"3.5" });
    expect(prices("gpt-5.5",272001)).toEqual({ input_million_token:"70", output_million_token:"315", cached_million_token:"7" });
  });
  it("does not count cache hits twice or convert CNY again", () => {
    expect(tokenCharges({inputTokens:100000,outputTokens:10000,cachedInputTokens:50000},prices("gpt-5.5",100000))?.amount).toBe("4.02500000");
    expect(tokenCharges({inputTokens:1000000,outputTokens:100000,cachedInputTokens:500000},prices("gemini-3-flash-preview",1000000))?.amount).toBe("4.02500000");
  });
  it("keeps unknown cache writes unpriced and exports only these two models", () => {
    expect(tokenCharges({inputTokens:100,outputTokens:10,cacheCreationInputTokens:10},prices("gpt-5.5",100))).toBeNull();
    const drafts = parseDraftFile(JSON.parse(fs.readFileSync("__tests__/fixtures/billing/easyrouter-cny-price-drafts-20260922.json","utf8")));
    expect(drafts.map(d=>d.model).sort()).toEqual(["gemini-3-flash-preview","gpt-5.5"]);
    expect(drafts.every(d=>d.currency==="CNY" && d.provider==="easyrouter")).toBe(true);
    expect(drafts.flatMap(d=>d.rows).filter(r=>r.price!=="")).toHaveLength(9);
  });
});
