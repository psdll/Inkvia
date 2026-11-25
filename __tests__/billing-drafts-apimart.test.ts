import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {} }));
import {
  validateDraft,
  parseDraftFile,
  mergeDrafts,
  DRAFT_FORMAT,
} from "@/lib/billing/drafts";
import { APIMART_QUOTES, apimartContext } from "@/lib/billing/apimart-pricing";
import { selectTokenPrices } from "@/lib/billing/llm";
import { tokenCharges, decimal } from "@/lib/billing/money";
import {
  mediaTokenCounts,
  recordMediaTokenCost,
} from "@/lib/billing/media-token";
const draft = {
  provider: "apimart",
  model: "gpt-5.5",
  module: "agent",
  label: "GPT",
  currency: "CNY",
  notes: "700元/1000积分",
  rows: [
    {
      unitType: "input_million_token",
      price: "28",
      conditions: { inputBand: "up_to_272000" },
    },
  ],
};
describe("portable drafts and APIMART actual pricing", () => {
  it("records image token components in CNY and keeps missing usage unknown", async () => {
    const model = "gpt-image-2-apimart",
      at = new Date("2026-09-22T00:00:00Z");
    const rules = APIMART_QUOTES[model].map((q, i) => ({
      id: i + 1,
      unitType: q.unitType,
      unitPrice: decimal(q.credits).mul("0.7").toString(),
      currency: "CNY",
      isActive: true,
      effectiveFrom: new Date("2020-01-01"),
      matchConditions: q.conditions,
    }));
    const db = {
      appSetting: { findUnique: async () => null },
      usageLedger: { upsert: async ({ create }: any) => create },
    };
    const generation = {
      id: 1,
      model,
      status: "success",
      userId: "1",
      createdAt: at,
    };
    const row = await recordMediaTokenCost(
      generation,
      {
        providerUsage: {
          usage: {
            input_tokens_details: {
              text_tokens: 1000000,
              image_tokens: 1000000,
            },
            output_tokens_details: { image_tokens: 1000000 },
          },
        },
      },
      {},
      rules,
      db,
    );
    expect(row.amount).toBe("301.00000000");
    expect(row.costStatus).toBe("priced");
    expect(
      (
        await recordMediaTokenCost(
          generation,
          { providerUsage: {} },
          {},
          rules,
          db,
        )
      ).costStatus,
    ).toBe("missing_usage");
  });
  it("exports only draft content and deduplicates repeated imports", () => {
    const d = validateDraft({
      ...draft,
      effectiveDate: "2026-01-01",
      mode: "strict",
    });
    const imported = parseDraftFile({ format: DRAFT_FORMAT, drafts: [d] });
    expect(mergeDrafts([d], imported)).toHaveLength(1);
    expect(d).not.toHaveProperty("effectiveDate");
    expect(d).not.toHaveProperty("mode");
  });
  it("rejects malformed files and nested conditions", () => {
    expect(() =>
      parseDraftFile({ format: "other", drafts: [draft] }),
    ).toThrow();
    expect(() =>
      validateDraft({
        ...draft,
        rows: [
          { unitType: "input_million_token", price: "-1", conditions: {} },
        ],
      }),
    ).toThrow();
    expect(() =>
      validateDraft({
        ...draft,
        rows: [
          {
            unitType: "input_million_token",
            price: "1",
            conditions: { x: { y: 1 } },
          },
        ],
      }),
    ).toThrow();
  });
  it("preserves missing quotes instead of turning them into free", () => {
    expect(
      validateDraft({
        ...draft,
        rows: [{ unitType: "input_million_token", price: "", conditions: {} }],
      }).rows[0].price,
    ).toBe("");
  });
  it("converts official prices using the approved recharge basis", () => {
    expect(
      decimal(APIMART_QUOTES["gpt-image-2-apimart"][0].credits)
        .mul("0.7")
        .toString(),
    ).toBe("35");
    expect(decimal(APIMART_QUOTES["doubao-seedance-2.0-face"][0].credits).mul("0.7").toString()).toBe("0.868");
  });
  it("keeps the official DeepSeek price equal across peak and discounted off-peak periods", () => {
    const rules = APIMART_QUOTES["deepseek-v4.1-flash"].map(q => ({ unitType: q.unitType, unitPrice: q.credits, matchConditions: q.conditions }));
    const day = selectTokenPrices(rules, "2026-09-30T12:00:00+08:00", 1000);
    const night = selectTokenPrices(rules, "2026-09-30T23:00:00+08:00", 1000);
    expect(day).toEqual(night);
    expect(day.input_million_token).toBe("2.8571");
  });
  it("keeps explicit cache pricing separate and does not invent unsupported image tiers", () => {
    const qwen = APIMART_QUOTES["qwen3.8-27b"];
    expect(qwen.find(q => q.unitType === "explicit_cached_million_token")?.credits).toBe("0.4286");
    expect(qwen.find(q => q.unitType === "cached_million_token")?.credits).toBe("0.8571");
    expect(APIMART_QUOTES["gpt-image-2-apimart"].some(q => q.unitType === "text_output_million_token")).toBe(false);
    expect(APIMART_QUOTES["doubao-seedance-2.0-fast-face"].some(q => q.conditions.resolution === "1080p")).toBe(false);
  });
  it("uses the full input count to select the 272000 boundary", () => {
    const rules = APIMART_QUOTES["gpt-5.5"].map((q) => ({
      ...q,
      unitPrice: decimal(q.credits).mul("0.7"),
      matchConditions: q.conditions,
    }));
    expect(
      selectTokenPrices(rules, new Date(), 272000).input_million_token,
    ).toBe("35");
    expect(
      selectTokenPrices(rules, new Date(), 272001).input_million_token,
    ).toBe("70");
    expect(
      tokenCharges(
        {
          inputTokens: 300000,
          outputTokens: 100000,
          cachedInputTokens: 100000,
        },
        selectTokenPrices(rules, new Date(), 300000),
      )?.amount,
    ).toBe("46.20000000");
  });
  it("matches Shanghai peak and off-peak boundaries", () => {
    expect(apimartContext("2026-09-22T07:59:59+08:00", 1).timeBand).toBe(
      "off_peak",
    );
    expect(apimartContext("2026-09-22T08:00:00+08:00", 1).timeBand).toBe(
      "peak",
    );
    expect(apimartContext("2026-09-22T22:00:00+08:00", 1).timeBand).toBe(
      "off_peak",
    );
  });
  it("does not double-charge cached image/text input", () => {
    expect(
      mediaTokenCounts({
        input_tokens_details: {
          text_tokens: 100,
          image_tokens: 200,
          cached_tokens: 50,
          cached_tokens_details: { text_tokens: 20, image_tokens: 30 },
        },
        output_tokens_details: { image_tokens: 300 },
      }),
    ).toMatchObject({
      text_input_million_token: 80,
      image_input_million_token: 170,
      cached_text_input_million_token: 20,
      cached_image_input_million_token: 30,
      image_output_million_token: 300,
    });
    expect(
      mediaTokenCounts({
        input_tokens_details: {
          text_tokens: 100,
          image_tokens: 200,
          cached_tokens: 50,
        },
      }),
    ).toBeNull();
  });
});
