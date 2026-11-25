import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {}, prisma: {} }));

import { upsertUsageLedgerForGeneration } from "@/lib/billing-ledger";
import { APIMART_GPT_IMAGE_25_MODEL_ID, APIMART_GPT_IMAGE_25_UPSTREAM_MODELS } from "@/lib/apimart-gpt-image-25";

describe("APIMart GPT Image 2.5 billing identity", () => {
  it.each(["flare", "sunburst"] as const)("keeps %s identity and quality in the ledger without borrowing 2.0 prices", async (mode) => {
    const providerModel = APIMART_GPT_IMAGE_25_UPSTREAM_MODELS[mode];
    const db = {
      billingPriceRule: { findMany: vi.fn(async () => []) },
      usageLedger: { upsert: vi.fn(async ({ create }) => create) },
    };
    const ledger = await upsertUsageLedgerForGeneration({
      id: 251, userId: "7", authUserId: 7, type: "image_edit", source: "tool", prompt: "photo",
      templateData: JSON.stringify({ model: APIMART_GPT_IMAGE_25_MODEL_ID, providerModel, gptImage25Mode: mode, quality: "max", resolution: "4K", aspectRatio: "16:9", outputCount: 1 }),
      model: APIMART_GPT_IMAGE_25_MODEL_ID, status: "success", requestKey: "billing-251",
      externalProvider: "apimart", externalTaskId: "task-251", errorMsg: null,
      createdAt: new Date("2026-09-09T00:00:00Z"), finishedAt: new Date("2026-09-09T00:01:00Z"),
    }, db);
    expect(db.billingPriceRule.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ model: { in: [APIMART_GPT_IMAGE_25_MODEL_ID, providerModel] } }),
    }));
    expect(ledger).toMatchObject({ externalProvider: "apimart", model: APIMART_GPT_IMAGE_25_MODEL_ID, providerModel, costStatus: "unpriced", pricingSnapshot: null });
    expect(ledger.unitCount.toNumber()).toBe(1);
    expect(ledger.usageSnapshot.pricingContext).toMatchObject({ quality: "max", resolution: "4K", outputCount: "1" });
    expect(ledger.requestSnapshot.params.gptImage25Mode).toBe(mode);
  });
});
