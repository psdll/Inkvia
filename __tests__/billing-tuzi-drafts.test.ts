import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/billing/settings", () => ({ readBillingSettings: async () => ({ rates: [] }) }));
import { TUZI_IMAGE_QUOTES } from "@/lib/billing/tuzi-pricing";
import { upsertUsageLedgerForGeneration } from "@/lib/billing-ledger";
const usage = {
  input_tokens: 3000, output_tokens: 500,
  input_tokens_details: { text_tokens: 1000, image_tokens: 2000, cached_tokens: 300,
    cached_tokens_details: { text_tokens: 100, image_tokens: 200 } },
};
async function settle(providerUsage: any) {
  const model = "gpt-image-2-tuzi";
  const rules = TUZI_IMAGE_QUOTES[model].map((q, i) => ({ id: i+1, model, provider: "tuzi", module:"image", unitType:q.unitType, unitPrice:q.cny, currency:"CNY", matchConditions:{}, isActive:true, effectiveFrom:new Date("2026-01-01"), effectiveTo:null }));
  return upsertUsageLedgerForGeneration({ id: 55, source:"tool", prompt:"test", externalTaskId:null, errorMsg:null, finishedAt:new Date("2026-09-22"), userId:"7", authUserId:7, type:"image_edit", model, status:"success", externalProvider:"tuzi", createdAt:new Date("2026-09-22"), templateData:JSON.stringify({model, providerUsage}) }, {
    billingPriceRule: {findMany:async()=>rules}, usageLedger:{upsert:async({create}:any)=>create},
  });
}
describe("Tuzi official group CNY pricing", () => {
  it("subtracts cache hits, uses actual image tokens and avoids a second currency conversion", async () => {
    const result = await settle({usage});
    expect(result.externalProvider).toBe("tuzi");
    expect(result.costStatus).toBe("priced");
    expect(result.amount).toBe("0.24097500");
    expect(result.pricingSnapshot.conversion.amountCny).toBe("0.24097500");
  });
  it("keeps missing usage unknown", async () => {
    const result = await settle({});
    expect(result.costStatus).toBe("missing_usage");
    expect(result.pricingSnapshot.conversion.amountCny).toBeNull();
  });
  it("does not guess a combined cache allocation", async () => {
    const result = await settle({usage:{...usage,input_tokens_details:{text_tokens:1000,image_tokens:2000,cached_tokens:300}}});
    expect(result.costStatus).toBe("missing_usage");
  });
});
