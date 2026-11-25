import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {}, prisma: {} }));

import { AICOMING_MERCHANT_DEFAULT_PRICE_RULES } from "@/lib/aicoming-merchant-pricing";
import { upsertUsageLedgerForGeneration } from "@/lib/billing-ledger";
import {
  MINIMAX_H3_DEFAULT_PRICE_RULES,
  MINIMAX_H3_EXCESS_IMAGE_PRICE,
  MINIMAX_H3_FREE_IMAGE_COUNT,
  MINIMAX_H3_MAX_DEFAULT_PRICE_RULES,
} from "@/lib/minimax-pricing";

function generation(providerUsage: Record<string, number>, resolution = "2k") {
  return {
    id: 821,
    userId: "7",
    authUserId: 7,
    type: "video_gen",
    source: "tool",
    prompt: "test",
    templateData: JSON.stringify({
      model: "minimax-h3",
      providerModel: "MiniMax-H3",
      resolution,
      duration: 8,
      providerUsage,
    }),
    model: "minimax-h3",
    status: "success",
    requestKey: "billing-821",
    externalProvider: "minimax",
    externalTaskId: "task-821",
    errorMsg: null,
    createdAt: new Date("2026-08-21T00:00:00.000Z"),
    finishedAt: new Date("2026-08-21T00:01:00.000Z"),
  };
}

function database() {
  const priceRules = MINIMAX_H3_DEFAULT_PRICE_RULES.map((rule, index) => ({
    ...rule,
    id: index + 1,
    effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
    effectiveTo: null,
  }));
  return {
    billingPriceRule: { findMany: vi.fn(async () => priceRules) },
    usageLedger: { upsert: vi.fn(async ({ create }) => create) },
  };
}

function maxGeneration(providerUsage: Record<string, number>, resolution = "480p") {
  return {
    ...generation(providerUsage, resolution),
    id: 822,
    requestKey: "billing-822",
    externalTaskId: "task-822",
    model: "minimax-h3-max",
    templateData: JSON.stringify({
      model: "minimax-h3-max",
      providerModel: "MiniMax-H3-Max",
      resolution,
      duration: 8,
      providerUsage,
    }),
  };
}

function maxDatabase() {
  const priceRules = MINIMAX_H3_MAX_DEFAULT_PRICE_RULES.map((rule, index) => ({
    ...rule,
    id: index + 101,
    effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
    effectiveTo: null,
  }));
  return {
    billingPriceRule: { findMany: vi.fn(async () => priceRules) },
    usageLedger: { upsert: vi.fn(async ({ create }) => create) },
  };
}

describe("official MiniMax-H3 billing", () => {
  it("declares the official output-second rules and removes legacy H3 defaults from AIComing", () => {
    expect(MINIMAX_H3_DEFAULT_PRICE_RULES).toEqual([
      expect.objectContaining({
        provider: "minimax",
        model: "minimax-h3",
        unitType: "second",
        unitPrice: 0.5,
        matchConditions: { resolution: "768p" },
      }),
      expect.objectContaining({
        provider: "minimax",
        model: "minimax-h3",
        unitType: "second",
        unitPrice: 0.8,
        matchConditions: { resolution: "2k" },
      }),
    ]);
    expect(MINIMAX_H3_FREE_IMAGE_COUNT).toBe(5);
    expect(MINIMAX_H3_EXCESS_IMAGE_PRICE).toBe(0.2);
    expect(AICOMING_MERCHANT_DEFAULT_PRICE_RULES.some((rule) => rule.model.includes("minimax-h3"))).toBe(false);
  });

  it("uses provider output/input seconds and charges only images beyond the first five", async () => {
    const ledger = await upsertUsageLedgerForGeneration(generation({
      output_seconds: 5,
      input_seconds: 3,
      input_image_count: 6,
      input_audio_seconds: 10,
    }), database());

    expect(ledger.unitCount.toNumber()).toBe(5);
    expect(ledger.unitPrice.toNumber()).toBe(0.8);
    expect(ledger.amount.toNumber()).toBeCloseTo(6.6, 8);
    expect(ledger.pricingSnapshot.additiveCharges).toEqual({
      inputVideoSeconds: 3,
      inputVideoUnitPrice: 0.8,
      inputVideoAmount: 2.4,
      inputImageCount: 6,
      freeImageCount: 5,
      billableImageCount: 1,
      imageUnitPrice: 0.2,
      imageAmount: 0.2,
    });
  });

  it("falls back to requested output duration while keeping up to five input images free", async () => {
    const ledger = await upsertUsageLedgerForGeneration(generation({
      input_seconds: 0,
      input_image_count: 5,
    }, "768p"), database());

    expect(ledger.unitCount.toNumber()).toBe(8);
    expect(ledger.amount.toNumber()).toBe(4);
    expect(ledger.pricingSnapshot).not.toHaveProperty("additiveCharges");
  });

  it("prices H3 Max by reported output seconds without input-image surcharges", async () => {
    const ledger = await upsertUsageLedgerForGeneration(maxGeneration({
      output_seconds: 5,
      input_image_count: 2,
    }), maxDatabase());

    expect(ledger.unitCount.toNumber()).toBe(5);
    expect(ledger.unitPrice.toNumber()).toBe(0.33);
    expect(ledger.amount.toNumber()).toBeCloseTo(1.65, 8);
    expect(ledger.pricingSnapshot).not.toHaveProperty("additiveCharges");
  });
});
