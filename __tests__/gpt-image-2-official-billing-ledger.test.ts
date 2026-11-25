import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {}, prisma: {} }));

import { upsertUsageLedgerForGeneration } from "@/lib/billing-ledger";
import { REAPI_GPT_IMAGE_2_PRICE_RULES } from "@/lib/gpt-image-2-official-pricing";

function generation(input: {
  provider: "reapi";
  model: string;
  resolution: string;
  quality?: string;
  aspectRatio?: string;
}) {
  return {
    id: 501,
    userId: "7",
    authUserId: 7,
    type: "image_edit",
    source: "tool",
    prompt: "test",
    templateData: JSON.stringify({
      model: input.model,
      providerModel: "gpt-image-2-official",
      resolution: input.resolution,
      quality: input.quality,
      aspectRatio: input.aspectRatio,
      outputCount: 1,
    }),
    model: input.model,
    status: "success",
    requestKey: "billing-501",
    externalProvider: input.provider,
    externalTaskId: "task-501",
    errorMsg: null,
    createdAt: new Date("2026-08-14T00:00:00.000Z"),
    finishedAt: new Date("2026-08-14T00:01:00.000Z"),
  };
}

describe("GPT-Image-2 official usage ledger pricing", () => {
  it("matches the reAPI three-dimensional price snapshot", async () => {
    const db = {
      billingPriceRule: { findMany: vi.fn(async () => REAPI_GPT_IMAGE_2_PRICE_RULES) },
      usageLedger: { upsert: vi.fn(async ({ create }) => create) },
    };

    const ledger = await upsertUsageLedgerForGeneration(generation({
      provider: "reapi",
      model: "gpt-image-2-official-reapi",
      resolution: "4K",
      quality: "high",
      aspectRatio: "16:9",
    }), db);

    expect(ledger.costStatus).toBe("priced");
    expect(ledger.unitPrice.toNumber()).toBeCloseTo(6.86592, 8);
    expect(ledger.amount.toNumber()).toBeCloseTo(6.86592, 8);
  });

});
