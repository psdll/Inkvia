import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {} }));
import { upsertUsageLedgerForGeneration } from "@/lib/billing-ledger";

describe("Seed Audio original-duration billing", () => {
  it.each([[30,0.5],[90,1.5],[1.5,0.025]])("prices %s original seconds at 1 CNY/minute",async(seconds,amount)=>{
    const db={billingPriceRule:{findMany:async()=>[{id:2,unitType:"minute",unitPrice:1,currency:"CNY",priority:50,matchConditions:null}]},usageLedger:{upsert:async({create}:any)=>create}};
    const result=await upsertUsageLedgerForGeneration({id:901,userId:"29",authUserId:29,type:"audio_gen",source:"canvas",prompt:"test",model:"seed-audio-1.0",status:"success",externalProvider:"volcengine-speech",externalTaskId:null,errorMsg:null,createdAt:new Date(),finishedAt:new Date(),templateData:JSON.stringify({model:"seed-audio-1.0",providerUsage:{original_duration:seconds,duration:seconds/2}})},db);
    expect(result.costStatus).toBe("priced");
    expect(result.unitType).toBe("minute");
    expect(Number(result.amount)).toBe(amount);
  });
  it.each([true, false])("uses original_duration with an administrator price rule present=%s", async (priced) => {
    const db = { billingPriceRule: { findMany: vi.fn(async () => priced ? [{ id: 1, provider: "volcengine-speech", model: "seed-audio-1.0", module: "audio", unitType: "second", unitPrice: 0.005, currency: "CNY", priority: 50, matchConditions: null }] : []) }, usageLedger: { upsert: vi.fn(async ({ create }) => create) } };
    const record = { id: 900, userId: "29", authUserId: 29, type: "audio_gen", source: "canvas", prompt: "雨声", model: "seed-audio-1.0", status: "success", requestKey: "seed-billing", externalProvider: "volcengine-speech", externalTaskId: null, errorMsg: null, createdAt: new Date(), finishedAt: new Date(), templateData: JSON.stringify({ model: "seed-audio-1.0", duration: 15, durationSeconds: 15, providerUsage: { original_duration: 30, duration: 15 }, billing: { unitType: "second" } }) };
    const result = await upsertUsageLedgerForGeneration(record, db as any);
    expect(result).toMatchObject({ unitType: "second", costStatus: priced ? "priced" : "unpriced" });
    expect(Number(result.unitCount)).toBe(30);
    if (priced) expect(Number(result.amount)).toBe(0.15);
  });
});
