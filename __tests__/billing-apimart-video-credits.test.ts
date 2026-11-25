import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/prisma', () => ({ default: {} }));
import { upsertUsageLedgerForGeneration } from '@/lib/billing-ledger';
import { previewReconciliation } from '@/lib/billing/reconcile';

const settings = {mode:'observe' as const,revision:1,rates:[{id:'confirmed',provider:'apimart',currency:'CREDIT',rate:'0.7',effectiveFrom:'2026-08-01',notes:''}]};
function fixture({usage = { credits_cost:18.0264 } as any, rates = settings.rates, existing = null as any, provider = 'apimart'} = {}) {
  const generation = {id:1,userId:'test',authUserId:null,type:'video_gen',source:'canvas',prompt:'',model:'doubao-seedance-2.0-face',status:'success',externalProvider:provider,externalTaskId:'task',errorMsg:null,
    templateData:JSON.stringify({model:'doubao-seedance-2.0-face',duration:15,resolution:'720p',referenceAssets:[{kind:'video'}],providerUsage:usage}),createdAt:new Date('2026-09-14'),finishedAt:new Date('2026-09-14')};
  const rule = {id:203,provider,model:generation.model,unitType:'second',unitPrice:'0.9016',currency:'CNY',isActive:true,priority:100,matchConditions:{resolution:'720p',inputContainsVideo:'true'},effectiveFrom:new Date('2026-08-01'),effectiveTo:null};
  const db = {billingPriceRule:{findMany:async()=>[rule]},appSetting:{findUnique:async()=>({value:JSON.stringify({...settings,rates})})},usageLedger:{findUnique:async()=>existing,upsert:vi.fn(async({create}:any)=>create)}};
  return {generation,db};
}

describe('APIMART video reconciliation with reported credits',()=>{
  it('recovers missing reference duration from actual debit at the historical rate',async()=>{
    const {generation,db}=fixture();
    const row=await upsertUsageLedgerForGeneration(generation,db);
    expect(row.costStatus).toBe('priced');
    expect(row.unitType).toBe('credit');
    expect(String(row.unitCount)).toBe('18.0264');
    expect(String(row.amount)).toBe('12.61848');
    expect(row.pricingSnapshot).toMatchObject({basis:'provider_reported_credits',reportedCredits:'18.0264',creditConversion:{id:'confirmed'},conversion:{amountCny:'12.61848000'}});
    expect(row.usageSnapshot.providerUsage).toEqual({credits_cost:18.0264});
  });
  it('keeps unknown debits or missing, future and zero conversion rates pending',async()=>{
    const variants=[...([undefined,null,-1,'18',NaN].map(credits_cost=>({usage:{credits_cost}}))),{rates:[]},
      {rates:[{...settings.rates[0],effectiveFrom:'2026-10-01'}]}, {rates:[{...settings.rates[0],rate:'0'}]}];
    for(const options of variants){const {generation,db}=fixture(options);expect((await upsertUsageLedgerForGeneration(generation,db)).costStatus).toBe('missing_usage');}
  });
  it('accepts an explicit zero debit and never uses a different supplier rate',async()=>{
    const zero=fixture({usage:{credits_cost:0}});
    expect((await upsertUsageLedgerForGeneration(zero.generation,zero.db)).costStatus).toBe('priced');
    const wrong=fixture({rates:[{...settings.rates[0],provider:'another'}]});
    expect((await upsertUsageLedgerForGeneration(wrong.generation,wrong.db)).costStatus).toBe('missing_usage');
  });
  it('prefers complete duration billing and preserves already settled rows',async()=>{
    const complete=fixture({usage:{credits_cost:99,input_video_duration:5}});
    const row=await upsertUsageLedgerForGeneration(complete.generation,complete.db);
    expect(row.unitType).toBe('second');expect(String(row.amount)).toBe('18.032');
    const existing={costStatus:'priced',amount:'10'};
    const prior=fixture({existing});
    expect(await upsertUsageLedgerForGeneration(prior.generation,prior.db)).toBe(existing);
    expect(prior.db.usageLedger.upsert).not.toHaveBeenCalled();
  });
  it('uses the same calculator for reconciliation without writing during preview',async()=>{
    const {generation,db}=fixture();
    const row={id:10,generationId:1,model:generation.model,externalProvider:'apimart',unitType:'second',costStatus:'missing_usage',occurredAt:generation.createdAt,updatedAt:new Date('2026-09-14'),pricingSnapshot:{}};
    const preview=await previewReconciliation({...db,usageLedger:{...db.usageLedger,findMany:async()=>[row]},generation:{findUnique:async()=>generation}},{},settings);
    expect(preview.updates).toHaveLength(1);
    expect(preview.updates[0].after).toBe('12.61848000');
    expect(preview.updates[0].data.unitType).toBe('credit');
    expect(db.usageLedger.upsert).not.toHaveBeenCalled();
  });
});
