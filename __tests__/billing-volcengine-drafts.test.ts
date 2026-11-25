import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
vi.mock("@/lib/prisma", () => ({ default: {}, prisma: {} }));
import { upsertUsageLedgerForGeneration } from "@/lib/billing-ledger";
import { parseDraftFile } from "@/lib/billing/drafts";
import { mapSeedreamSize } from "@/lib/image-edit-helpers";
const drafts = parseDraftFile(JSON.parse(fs.readFileSync("__tests__/fixtures/billing/volcengine-cny-price-drafts-20260922.json", "utf8")));
async function settle(model: string, params: any, omitInputPrice = false) {
  const draft = drafts.find(d => d.model === model)!;
  const rules = draft.rows.filter(r => r.price && (!omitInputPrice || r.unitType !== "additional_input_image")).map((r,i) => ({
    id:i+1, provider:"volcengine",model,module:draft.module,unitType:r.unitType,unitPrice:r.price,currency:"CNY",matchConditions:r.conditions,
    effectiveFrom:new Date("2026-01-01"),effectiveTo:null,isActive:true,priority:100,
  }));
  return upsertUsageLedgerForGeneration({id:88,userId:"7",authUserId:7,source:"tool",prompt:"test",externalTaskId:null,errorMsg:null,finishedAt:new Date(),createdAt:new Date("2026-09-22"),model,externalProvider:"volcengine",status:"success",type:draft.module === "image" ? "image_edit":"video_gen",templateData:JSON.stringify({model,...params})}, {
    billingPriceRule:{findMany:async()=>rules}, usageLedger:{upsert:async({create}:any)=>create},
  });
}
describe("Volcengine verified price drafts", () => {
  it.each([["720p","image",70],["720p","video",42],["1080p","image",77],["1080p","video",46]])("prices Seedance 2.5 %s with %s", async (resolution,kind,amount) => {
    const result = await settle("doubao-seedance-2-5-260628",{resolution,referenceAssets:[{kind,url:"https://example.test/asset"}],usage:{completion_tokens:1000000}});
    expect(result.amount.toNumber()).toBe(amount);
  });
  it.each([[0,0.3],[1,0.3],[3,0.34]])("charges Seedream Pro with %s input images",async(count,amount)=>{
    const result=await settle("doubao-seedream-5.0-pro",{resolution:"1K",seedream:{imageInputCount:count}});
    expect(result.costStatus).toBe("priced");
    expect(result.amount.toNumber()).toBe(amount);
  });
  it("does not mark incomplete input pricing as settled",async()=>{
    const result=await settle("doubao-seedream-5.0-pro",{resolution:"2K",seedream:{imageInputCount:3}},true);
    expect(result.costStatus).toBe("unpriced");
  });
  it("fixed image sizes stay on the quoted side of 2.61 million pixels",()=>{
    for(const resolution of ["1K","2K"]) for(const ratio of ["1:1","3:4","4:3","16:9","9:16","3:2","2:3","21:9"]) {
      const [w,h]=mapSeedreamSize(ratio,resolution,"doubao-seedream-5.0-pro").split("x").map(Number);
      expect(w*h<=2610000).toBe(resolution==="1K");
    }
  });
  it("only includes the eight supported Volcengine models",()=>{
    expect(drafts).toHaveLength(8);
    expect(drafts.some(d => ["doubao-seedance-1-0-pro-250528", "doubao-seedance-1-5-pro-251215"].includes(d.model))).toBe(false);
  });
});
