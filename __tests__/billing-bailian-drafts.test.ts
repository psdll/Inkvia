import {describe,it,expect,vi} from "vitest";
import fs from "node:fs";
vi.mock("@/lib/prisma",()=>({default:{},prisma:{}}));
import {upsertUsageLedgerForGeneration} from "@/lib/billing-ledger";
import {parseDraftFile} from "@/lib/billing/drafts";
const drafts=parseDraftFile(JSON.parse(fs.readFileSync("__tests__/fixtures/billing/bailian-cny-price-drafts-20260922.json","utf8")));
async function settle(model:string,params:any){
 const d=drafts.find(d=>d.model===model)!;
 const rules=d.rows.filter(r=>r.price!=="").map((r,i)=>({id:i+1,provider:"bailian",model,module:d.module,unitType:r.unitType,unitPrice:r.price,currency:"CNY",matchConditions:r.conditions,effectiveFrom:new Date("2026-01-01"),effectiveTo:null,isActive:true,priority:100}));
 return upsertUsageLedgerForGeneration({id:99,userId:"7",authUserId:7,source:"tool",prompt:"test",externalTaskId:null,errorMsg:null,finishedAt:new Date(),createdAt:new Date("2026-09-22"),model,externalProvider:"bailian",status:"success",type:d.module==="image"?"image_edit":"video_gen",templateData:JSON.stringify({model,...params})},{billingPriceRule:{findMany:async()=>rules},usageLedger:{upsert:async({create}:any)=>create}});
}
describe("Bailian standard price drafts",()=>{
 it.each([["qwen-image-3.0","1K",0.22],["qwen-image-3.0","2K",0.22],["qwen-image-3.0-pro","1K",0.29],["qwen-image-3.0-pro","2K",0.54]])("prices %s %s plus every input image",async(providerModel,resolution,amount)=>{
  const result=await settle("qwen-image-3.0",{providerModel,resolution,bailianQwenImage:{request:{input:{messages:[{content:[{image:"https://example.test/1"},{image:"https://example.test/2"},{text:"test"}]}]}}}});
  expect(result.costStatus).toBe("priced");expect(result.amount.toNumber()).toBe(amount);
 });
 it("keeps unknown Pro automatic resolution unpriced",async()=>{
  const result=await settle("qwen-image-3.0",{providerModel:"qwen-image-3.0-pro",resolution:"auto"});
  expect(result.costStatus).toBe("unpriced");
 });
 it("Wan adds actual input and output seconds at the standard price",async()=>{
  const result=await settle("wan3.0-video",{resolution:"720p",duration:30,providerUsage:{output_video_duration:5,input_video_duration:3}});
  expect(result.unitCount.toNumber()).toBe(8);expect(result.amount.toNumber()).toBe(4.8);
 });
 it("uses console cache rates instead of generic discount multipliers",()=>{
  const price=(model:string,unit:string)=>drafts.find(d=>d.model===model)!.rows.find(r=>r.unitType===unit)!.price;
  expect(price("qwen3.8-max","cached_million_token")).toBe("1.5");
  expect(price("qwen3.8-flash","cached_million_token")).toBe("0.1");
  expect(price("qwen3.8-flash","cache_creation_million_token")).toBe("1.25");
 });
});
