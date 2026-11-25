import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {}, prisma: {} }));

import { upsertUsageLedgerForGeneration } from "@/lib/billing-ledger";

const priceRules = [
  {
    id: 1,
    provider: "volcengine",
    model: "doubao-seedance-2-5-260628",
    module: "video",
    unitType: "million_token",
    unitPrice: 70,
    currency: "CNY",
    priority: 30,
    matchConditions: { inputContainsReferenceMedia: "false" },
    effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
    effectiveTo: null,
  },
  {
    id: 2,
    provider: "volcengine",
    model: "doubao-seedance-2-5-260628",
    module: "video",
    unitType: "million_token",
    unitPrice: 42,
    currency: "CNY",
    priority: 30,
    matchConditions: { inputContainsReferenceMedia: "true" },
    effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
    effectiveTo: null,
  },
];

function generation(referenceAssets: Array<{ kind: string; url: string }>) {
  return {
    id: 625,
    userId: "7",
    authUserId: 7,
    type: "video_gen",
    source: "tool",
    prompt: "test",
    templateData: JSON.stringify({
      model: "doubao-seedance-2-5-260628",
      duration: 5,
      usage: { completion_tokens: 1_000_000 },
      referenceAssets,
      imagePaths: referenceAssets.map((item) => item.url),
    }),
    model: "doubao-seedance-2-5-260628",
    status: "success",
    requestKey: "billing-625",
    externalProvider: "volcengine",
    externalTaskId: "task-625",
    errorMsg: null,
    createdAt: new Date("2026-08-18T00:00:00.000Z"),
    finishedAt: new Date("2026-08-18T00:01:00.000Z"),
  };
}

async function price(referenceAssets: Array<{ kind: string; url: string }>) {
  const db = {
    billingPriceRule: { findMany: vi.fn(async () => priceRules) },
    usageLedger: { upsert: vi.fn(async ({ create }) => create) },
  };
  return upsertUsageLedgerForGeneration(generation(referenceAssets), db);
}

describe("Seedance 2.5 official token pricing", () => {
  it("uses 70 CNY per million tokens without image/video references", async () => {
    const textOnly = await price([]);
    const audioOnly = await price([{ kind: "audio", url: "/uploads/reference.mp3" }]);

    expect(textOnly.unitPrice.toNumber()).toBe(70);
    expect(audioOnly.unitPrice.toNumber()).toBe(70);
  });

  it.each(["image", "video"])("uses 42 CNY per million tokens with a %s reference", async (kind) => {
    const ledger = await price([{ kind, url: kind === "image" ? "/uploads/reference.png" : "/uploads/reference.mp4" }]);

    expect(ledger.unitPrice.toNumber()).toBe(42);
    expect(ledger.amount.toNumber()).toBe(42);
    expect(ledger.usageSnapshot.pricingContext).toMatchObject({
      inputContainsReferenceMedia: "true",
    });
  });
});
