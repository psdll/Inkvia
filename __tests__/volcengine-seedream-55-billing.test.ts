import { expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({default:{},prisma:{}}));
import { upsertUsageLedgerForGeneration } from "@/lib/billing-ledger";
import { VOLC_SEEDREAM_55_PRICE_RULES } from "@/lib/volcengine-seedream-55-pricing";
import { VOLC_SEEDREAM_55_MODEL } from "@/lib/volcengine-seedream-55";
it.each([{tier:"low",inputs:1,expected:0.18},{tier:"high",inputs:0,expected:0.23},{tier:"low",inputs:10,expected:0.63}])("charges output tier and only this output's input share: %j",async ({tier,inputs,expected})=>{
  const db={billingPriceRule:{findMany:vi.fn(async()=>VOLC_SEEDREAM_55_PRICE_RULES.map((r,i)=>({...r,id:i+1,effectiveFrom:new Date("2026-11-01")})))},appSetting:{findUnique:vi.fn(async()=>null)},usageLedger:{upsert:vi.fn(async({create})=>create)}};
  const ledger=await upsertUsageLedgerForGeneration({id:801,prompt:"",externalTaskId:"task-801",errorMsg:null,userId:"7",authUserId:7,type:"image_edit",source:"tool",model:VOLC_SEEDREAM_55_MODEL,status:"success",externalProvider:"volcengine",createdAt:new Date("2026-11-10"),finishedAt:new Date(),templateData:JSON.stringify({seedream55PixelTier:tier,resolution:"2K",imageInputCount:inputs,outputCount:1})},db);
  expect(ledger.amount.toNumber()).toBeCloseTo(expected,8);
  expect(ledger.currency).toBe("CNY");
  if(inputs) expect(ledger.pricingSnapshot.additiveCharges).toMatchObject({inputImageCount:inputs,freeImageCount:0,billableImageCount:inputs,imageUnitPrice:0.05});
});
