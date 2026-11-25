import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {}, prisma: {} }));
import { upsertUsageLedgerForGeneration } from "@/lib/billing-ledger";
import { SUNO_PRICE_RULES } from "@/lib/billing/suno-pricing";
import { SUNO_MODELS } from "@/lib/suno-models";
import { APIMART_QUOTES } from "@/lib/billing/apimart-pricing";
describe.each(SUNO_MODELS)("$label billing", ({ id: model }) => {
  it.each([false, true])("charges once for all songs, Max=%s", async maxMode => {
    const rules = SUNO_PRICE_RULES.filter(r => r.model === model).map((r,id) => ({ ...r, id, isActive: true, effectiveFrom: new Date("2026-01-01"), effectiveTo: null }));
    const db = { billingPriceRule: { findMany: vi.fn(async () => rules) }, usageLedger: { upsert: vi.fn(async ({create}) => create) } };
    const item = { id: 900, userId: "7", authUserId: 7, type: "audio_gen", source: "canvas", prompt: "歌曲", model, status: "success", requestKey: "suno-900", externalProvider: "apimart", externalTaskId: "suno-task", errorMsg: null, createdAt: new Date(), finishedAt: new Date(), templateData: JSON.stringify({ model, maxMode, outputCount: 3, billing: { unitType: "request", childBillable: false } }) };
    const parent = await upsertUsageLedgerForGeneration(item, db);
    expect(parent.costStatus).toBe("priced"); expect(parent.unitCount.toNumber()).toBe(1);
    expect(parent.amount.toNumber()).toBe(maxMode ? 0.875 : 0.4375);
    const child = await upsertUsageLedgerForGeneration({ ...item, id: 901, templateData: JSON.stringify({ model, maxMode, billing: { unitType: "request", billable: false, parentGenerationId: 900 } }) }, db);
    expect(child.costStatus).toBe("non_billable"); expect(child.unitCount.toNumber()).toBe(0);
    expect(APIMART_QUOTES[model]).toHaveLength(2);
  });
});
