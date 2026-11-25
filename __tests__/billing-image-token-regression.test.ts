import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/prisma',()=>({default:{}}));
import { upsertUsageLedgerForGeneration } from '@/lib/billing-ledger';
import { GOOGLE_IMAGE_QUOTES } from '@/lib/billing/google-pricing';
import { TUZI_IMAGE_QUOTES } from '@/lib/billing/tuzi-pricing';
const generation=(provider:string,model:string)=>({id:1,userId:'1',authUserId:1,type:'image_edit',source:'test',prompt:'',model,status:'success',externalProvider:provider,externalTaskId:null,errorMsg:null,templateData:'{}',createdAt:new Date('2026-08-15'),finishedAt:new Date('2026-08-15')});
const dbFor=(quotes:any[])=>({billingPriceRule:{findMany:async()=>quotes.map((q,i)=>({id:i+1,unitType:q.unitType,unitPrice:q.cny || String(Number(q.usd)*7),currency:'CNY',isActive:true,matchConditions:{},effectiveFrom:new Date('2026-08-01'),effectiveTo:null}))},appSetting:{findUnique:async()=>null},usageLedger:{findUnique:async()=>null,upsert:async({create}:any)=>create}});
describe('image token tariffs cannot become a per-image charge',()=>{
 it.each([['google-ai-studio','gemini-3-pro-image',GOOGLE_IMAGE_QUOTES['gemini-3-pro-image']],['tuzi','gpt-image-2-tuzi',TUZI_IMAGE_QUOTES['gpt-image-2-tuzi']]])('keeps historical missing usage pending for %s',async(provider,model,quotes)=>{
  const row=await upsertUsageLedgerForGeneration(generation(provider as string,model as string),dbFor(quotes as any[]));
  expect(row.costStatus).toBe('missing_usage'); expect(Number(row.amount)).toBe(0);expect(row.pricingSnapshot.conversion.amountCny).toBeNull();
 });
 it('rejects split token tariffs even on an unknown image model',async()=>{
  const row=await upsertUsageLedgerForGeneration(generation('other','legacy-image'),dbFor([{unitType:'text_output_million_token',cny:'210'}]));
  expect(row.costStatus).toBe('unpriced');expect(Number(row.amount)).toBe(0);
 });
 it('uses actual token counts rather than one image',async()=>{
  const g=generation('google-ai-studio','gemini-3-pro-image');
  g.templateData=JSON.stringify({providerUsage:{usageMetadata:{promptTokenCount:1000,candidatesTokenCount:1120,candidatesTokensDetails:[{modality:'IMAGE',tokenCount:1120}]}}});
  const row=await upsertUsageLedgerForGeneration(g,dbFor(GOOGLE_IMAGE_QUOTES[g.model]));
  expect(row.costStatus).toBe('priced');expect(row.amount).toBe('0.95480000');
 });
});
