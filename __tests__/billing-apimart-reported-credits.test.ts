import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/prisma', () => ({ default: {} }));
import { recordMediaTokenCost } from '@/lib/billing/media-token';
import { APIMART_QUOTES } from '@/lib/billing/apimart-pricing';

async function calculate(variant = 'gpt-image-2.5-flare', rateDate = '2026-08-01', usage: any = { credits_cost: 0.21076 }, includeRate = true, model = 'gpt-image-2.5-apimart') {
  const rules = APIMART_QUOTES[model].map((q, id) => ({ id, unitType:q.unitType, unitPrice:Number(q.credits)*0.7, currency:'CNY', matchConditions:q.conditions, isActive:true, effectiveFrom:new Date('2026-08-01') }));
  const db = {
    appSetting:{findUnique:async()=>({value:JSON.stringify({mode:'observe',revision:1,rates:includeRate?[{id:'credit-v1',provider:'apimart',currency:'CREDIT',rate:'0.7',effectiveFrom:rateDate,notes:'confirmed purchase basis'}]:[]})})},
    usageLedger:{upsert:async({create}:any)=>create},
  };
  return recordMediaTokenCost({id:1,model,externalProvider:'apimart',createdAt:new Date('2026-09-01'),status:'completed'}, {providerUsage:usage}, {providerModel:variant}, rules, db);
}
describe('APIMART historical reported credits',()=>{
  it.each(['gpt-image-2.5-flare','gpt-image-2.5-sunburst'])('values %s using actual credits and snapshots the historical basis',async variant=>{
    const row=await calculate(variant);
    expect(row.costStatus).toBe('priced');
    expect(row.amount).toBe('0.14753200');
    expect(row.currency).toBe('CNY');
    expect(row.providerModel).toBe(variant);
    expect(row.pricingSnapshot.creditConversion?.id).toBe('credit-v1');
    expect(row.usageSnapshot).toEqual({credits_cost:0.21076});
  });
  it('does not guess a rate or apply a future rate',async()=>{
    expect((await calculate(undefined,undefined,undefined,false)).costStatus).toBe('missing_usage');
    expect((await calculate(undefined,'2026-10-01')).costStatus).toBe('missing_usage');
  });
  it('rejects absent, negative, or nonnumeric credits',async()=>{
    for(const credits_cost of [undefined,null,-1,'0.2',NaN]) expect((await calculate(undefined,undefined,{credits_cost})).costStatus).toBe('missing_usage');
  });
  it('prefers complete token usage over reported credits',async()=>{
    const row=await calculate(undefined,undefined,{credits_cost:99,usage:{input_tokens_details:{text_tokens:1000,image_tokens:0},output_tokens_details:{image_tokens:1000}}});
    expect(row.amount).toBe('0.24500000');
    expect(row.unitType).toBe('media_token');
  });
  it.each(['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'])('prices %s by its own five token dimensions', async variant => {
    const model = 'gpt-image-2.6-apimart';
    expect(APIMART_QUOTES[model]?.filter(q => q.conditions.providerModel === variant).map(q => q.credits))
      .toEqual(['50', '12.5', '80', '20', '300']);
    const row = await calculate(variant, undefined, {
      credits_cost: 99,
      usage: { input_tokens_details: { text_tokens: 1000, image_tokens: 2000 }, output_tokens_details: { image_tokens: 1000 } },
    }, true, model);
    expect(row).toMatchObject({ costStatus: 'priced', providerModel: variant, currency: 'CNY', amount: '0.35700000' });
  });
});
