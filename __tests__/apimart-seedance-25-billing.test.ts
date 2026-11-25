import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {}, prisma: {} }));
import { APIMART_QUOTES } from "@/lib/billing/apimart-pricing";
import { upsertUsageLedgerForGeneration } from "@/lib/billing-ledger";

const model = "seedance-2.5-apimart";
async function price(resolution: string, references: string[], tokens?: number, status = "success") {
  const rules = (APIMART_QUOTES[model] || []).map((q, id) => ({ id, provider: "apimart", model, module: "video", unitType: q.unitType, unitPrice: Number(q.credits) * 0.7, currency: "CNY", matchConditions: q.conditions, priority: 30, effectiveFrom: new Date("2026-01-01"), effectiveTo: null }));
  const db = { billingPriceRule: { findMany: vi.fn(async () => rules) }, usageLedger: { upsert: vi.fn(async ({ create }) => create) }, appSetting: { findUnique: vi.fn(async () => ({ value: JSON.stringify({ revision: 1, mode: "observe", rates: [{ id: "credit", provider: "apimart", currency: "CREDIT", rate: "0.7", effectiveFrom: "2026-01-01T00:00:00.000Z" }] }) })) } };
  return upsertUsageLedgerForGeneration({ id: 25, userId: "3", authUserId: 3, type: "video_gen", source: "tool", prompt: "test", model, status, externalProvider: "apimart", externalTaskId: "am-25", errorMsg: null, createdAt: new Date("2026-10-01"), finishedAt: new Date("2026-10-01"), templateData: JSON.stringify({ model, resolution, duration: -1, referenceAssets: references.map(kind=>({kind,url:`/uploads/ref.${kind === "video" ? "mp4" : "png"}`})), providerUsage: { usage: tokens === undefined ? null : { completion_tokens: tokens }, cost: 5.7, credits_cost: 57, actual_time: 300 } }) }, db);
}

describe("APIMart Seedance 2.5 original token prices", () => {
  it("records all six official price slots rather than per-second estimates or membership discounts", () => {
    expect(APIMART_QUOTES[model]).toEqual([
      { unitType: "million_token", credits: "125", conditions: { resolution: "480p", inputContainsVideo: "false" } },
      { unitType: "million_token", credits: "75", conditions: { resolution: "480p", inputContainsVideo: "true" } },
      { unitType: "million_token", credits: "125", conditions: { resolution: "720p", inputContainsVideo: "false" } },
      { unitType: "million_token", credits: "75", conditions: { resolution: "720p", inputContainsVideo: "true" } },
      { unitType: "million_token", credits: "137.5", conditions: { resolution: "1080p", inputContainsVideo: "false" } },
      { unitType: "million_token", credits: "82.1", conditions: { resolution: "1080p", inputContainsVideo: "true" } },
    ]);
  });
  it.each([
    ["480p", [], 87.5], ["720p", ["image"], 87.5], ["720p", ["audio"], 87.5],
    ["720p", ["video"], 52.5], ["1080p", [], 96.25], ["1080p", ["video"], 57.47],
  ])("prices %s with %j using nested actual tokens", async (resolution, refs, expected) => {
    const result = await price(resolution as string, refs as string[], 1_000_000);
    expect(result.costStatus).toBe("priced");
    expect(result.unitCount.toNumber()).toBe(1);
    expect(result.amount.toNumber()).toBeCloseTo(expected as number, 6);
  });
  it("does not mistake elapsed time or discounted credits for original-price usage", async () => {
    const result = await price("720p", ["video"]);
    expect(result.costStatus).toBe("missing_usage");
    expect(result.amount.toNumber()).toBe(0);
  });
  it("never charges a failed task even if upstream returned usage", async () => {
    const result = await price("720p", [], 1_000_000, "failed");
    expect(result.costStatus).toBe("failed");
    expect(result.amount.toNumber()).toBe(0);
  });
});
