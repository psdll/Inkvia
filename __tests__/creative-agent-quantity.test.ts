import { describe, expect, it } from 'vitest';
import { hash } from '@/lib/creative-agent/store-types';
import { mergeTurnRequirements } from '@/lib/creative-agent/matching-contracts';
async function quantities() { const file = '../lib/creative-agent/quantity'; return import(file).catch(() => ({})) as Promise<Record<string, any>>; }
const receipt: any = { id: 'receipt', requirementsRevision: 0, request: { model: 'm', prompt: 'p', params: {count:1}, references: [] }, output: {calls:1, expectedReturned:1, maxReturned:1}, referenceVersions: [] };
const plan: any = { version:1, definition:{steps:[{id:'s', role:'final', mediaType:'image', prompt:'p',params:{count:1},references:[],dependsOn:[]}]}, requirementsRevision:0, steps:[{id:'s',role:'final',receipt}] };
const initial: any = { matchingPolicyVersion:2, messageId:'msg', generationPlans: {p:{id:'p', plan, expiresAt:'2099-01-01T00:00:00.000Z'} } };
async function reservation(input = initial, changes: any = {}) { const q = await quantities(); expect(q.reserveGenerationQuantity).toBeTypeOf('function'); return q.reserveGenerationQuantity(input, {planId:'p',stepId:'s',receiptId:'receipt',actionId:'a',requestKeys:['k'],requestHash:hash(receipt.request), ...changes}); }
describe('one user turn quantity authority', () => {
 it.each(['生成两张图片','/skill:personal:21 需要两张海报','生成两张蓝色海报和一张红色海报'])('requires complete final output coverage rather than a subset: %s',async text=>{
  const q=await quantities();const input={...initial,text,mediaAuthorizationVersion:1,generationPlans:{p:{...initial.generationPlans.p,plan:{...plan,steps:[{...plan.steps[0],mediaType:'image'}]}}}};
  expect(()=>q.generationExecution(input,'p','s')).toThrow(/完整.*计划/);
 });
 it.each(['最多生成三张图片','生成一张图片或两张图片','不要生成两张图片，生成一张图片','解释“生成两张图片”','生成两张图片需要哪些参数？','上传两张参考图，生成一张图片','生成标题为“生成两张图片”的海报'])('does not turn limits alternatives references or discussion into a delivery minimum: %s',async text=>{
  const q=await quantities();expect(()=>q.generationExecution({...initial,text,mediaAuthorizationVersion:1},'p','s')).not.toThrow();
 });
 it.each(['生成三张海报中的一张','生成两张海报中的一张','从三张方案选一张','生成一张包含三张海报的拼贴','生成一张由三张海报组成的拼贴','生成两张海报中选出的一张'])('does not confuse a set or nested content with final delivered outputs: %s',async text=>{
  const q=await quantities();expect(()=>q.generationExecution({...initial,text,mediaAuthorizationVersion:1},'p','s')).not.toThrow();
 });
 it('counts all planned outputs rather than step count or only the current remaining step',async()=>{
  const q=await quantities();const text='生成两张图片';const requirements=mergeTurnRequirements(undefined,undefined,{facts:[{field:'image.quantity',value:2,strength:'hard',source:{kind:'message',sourceId:'msg',quote:'两张图片'}}]},[{kind:'message',sourceId:'msg',text}]);
  const two={...receipt,output:{calls:2,expectedReturned:2,maxReturned:2}};
  const input={...initial,text,mediaAuthorizationVersion:1,requirements,generationPlans:{p:{...initial.generationPlans.p,plan:{...plan,steps:[{...plan.steps[0],mediaType:'image',receipt:two}]}}}};
  expect(q.generationExecution(input,'p','s').limits.finalOutputs).toBe(2);
 });
 it.each(['correction','answer'])('keeps a validated current quantity reduction authoritative: %s',async kind=>{
  const q=await quantities();const text=kind==='correction'?'生成两张图片，改成一张图片':'生成两张图片';
  const source=kind==='correction'?{kind:'message',sourceId:'msg',quote:'一张图片'}:{kind:'answer',sourceId:'decision',fieldId:'count',channel:'notes',quote:'一张图片'};
  const requirements=mergeTurnRequirements(undefined,undefined,{facts:[{field:'image.quantity',value:1,strength:'hard',source}]},[{kind:'message',sourceId:'msg',text},...(kind==='answer'?[{kind:'answer' as const,sourceId:'decision',fieldId:'count',channel:'notes' as const,text:'一张图片'}]:[])]);
  expect(()=>q.generationExecution({...initial,text,mediaAuthorizationVersion:1,requirements},'p','s')).not.toThrow();
 });
 it.each(['生成两张图片','生成两条视频'])('uses the validated current final-output answer within an unambiguous media scope: %s',async text=>{
  const q=await quantities();const media=text.includes('视频')?'video':'image';const quote=media==='image'?'最终一张图片':'最终一条视频';
  const requirements=mergeTurnRequirements(undefined,undefined,{facts:[{field:'generation.finalOutputs',value:1,strength:'hard',source:{kind:'answer',sourceId:'d',fieldId:'final',channel:'notes',quote}}]},[{kind:'answer',sourceId:'d',fieldId:'final',channel:'notes',text:quote}]);
  const single={...initial,text,mediaAuthorizationVersion:1,requirements,generationPlans:{p:{...initial.generationPlans.p,plan:{...plan,steps:[{...plan.steps[0],mediaType:media}]}}}};
  expect(()=>q.generationExecution(single,'p','s')).not.toThrow();
 });
 it('does not allocate a global final-output answer arbitrarily between image and video requests',async()=>{
  const q=await quantities();const text='生成两张图片和一条视频';const quote='最终一份成品';
  const requirements=mergeTurnRequirements(undefined,undefined,{facts:[{field:'generation.finalOutputs',value:1,strength:'hard',source:{kind:'answer',sourceId:'d',fieldId:'final',channel:'notes',quote}}]},[{kind:'answer',sourceId:'d',fieldId:'final',channel:'notes',text:quote}]);
  expect(()=>q.generationExecution({...initial,text,mediaAuthorizationVersion:1,requirements},'p','s')).toThrow(/完整.*计划/);
 });
 it('defaults to one final, one initial call and no retry; replay is idempotent across plans', async () => {
  const q = await quantities(); expect(q.generationAllowance).toBeTypeOf('function');
  expect(q.generationAllowance(initial)).toEqual({finalOutputs:1, intermediateOutputs:0, initialCalls:1, retryCalls:0});
  const one = await reservation(); expect(one.quantityLedger.reservations).toHaveLength(1);
  expect(await reservation(one)).toEqual(one);
  await expect(reservation({...one,generationPlans:{...one.generationPlans,p2:{...initial.generationPlans.p,id:'p2'}}},{planId:'p2',actionId:'b',requestKeys:['k2']})).rejects.toMatchObject({code:'QUANTITY_LIMIT'});
  await expect(reservation(one,{actionId:'retry',requestKeys:['retry'],retryOf:'k'})).rejects.toMatchObject({code:'QUANTITY_LIMIT'});
 });
 it('uses a strict total as the final allowance when no separate final quantity was requested',async()=>{
  const q=await quantities();
  const requirements=mergeTurnRequirements(undefined,undefined,{facts:[{field:'generation.totalOutputs',value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:'总共只能三张'}}]},[{kind:'message',sourceId:'msg',text:'总共只能三张'}]);
  expect(q.generationAllowance({requirements})).toEqual({finalOutputs:3,intermediateOutputs:0,initialCalls:3,retryCalls:0,totalOutputs:3});
 });
 it('counts intermediate, initial and explicitly authorized retries against strict total', async () => {
  const q = await quantities(); expect(q.reserveGenerationQuantity).toBeTypeOf('function');
  const text = '最终 2 张，中间 1 张，总共最多 3 张，调用 3 次，重试 1 次';
  const facts = [['generation.finalOutputs',2,'最终 2 张'],['generation.intermediateOutputs',1,'中间 1 张'],['generation.totalOutputs',3,'总共最多 3 张'],['generation.initialCalls',3,'调用 3 次'],['generation.retryCalls',1,'重试 1 次']].map(([field,value,quote]) => ({field,value,strength:'hard',source:{kind:'message',sourceId:'msg',quote}}));
  const requirements = mergeTurnRequirements(undefined,undefined,{facts},[{kind:'message',sourceId:'msg',text}]);
  let state = {...initial,requirements,generationPlans:{p:{...initial.generationPlans.p,plan:{...plan, requirementsRevision:requirements.revision,steps:[{...plan.steps[0],receipt:{...receipt, requirementsRevision:requirements.revision}}]}}}};
  state.generationPlans.p.plan.steps = ['s','s2','s3','middle'].map(id=>({...state.generationPlans.p.plan.steps[0],id,role:id==='middle'?'intermediate':'final'}));
  for(let i=0;i<2;i++) state = q.reserveGenerationQuantity(state,{planId:'p',stepId:i?'s2':'s',receiptId:'receipt',actionId:`a${i}`,requestKeys:[`k${i}`],requestHash:hash(receipt.request)});
  await expect(reservation(state,{stepId:'s3',actionId:'third-final',requestKeys:['k3']})).rejects.toMatchObject({code:'QUANTITY_LIMIT'});
  state=q.reserveGenerationQuantity(state,{planId:'p',stepId:'middle',receiptId:'receipt',actionId:'middle',requestKeys:['km'],requestHash:hash(receipt.request)});
  await expect(reservation(state,{actionId:'retry',requestKeys:['kr'],retryOf:'k0'})).rejects.toMatchObject({code:'QUANTITY_LIMIT'});
 });
 it('cannot spend the same receipt step twice under a different action identity',async()=>{
  const one=await reservation();
  await expect(reservation(one,{actionId:'forged',requestKeys:['forged']})).rejects.toMatchObject({code:'QUANTITY_RESERVATION_CONFLICT'});
 });
 it('does not release dispatched uncertainty and freezes unexpected outputs idempotently', async () => {
  const q = await quantities(); expect(q.transitionGenerationReservation).toBeTypeOf('function');
  const state = await reservation();
  const started = q.transitionGenerationReservation(state,'k','started');
  expect(() => q.transitionGenerationReservation(started,'k','released')).toThrow();
  const observed = q.observeGenerationQuantity(started,'k',{generationId:9,rawReturned:2,uniqueOutputs:2,savedOutputs:2});
  expect(observed.quantityLedger.frozen).toBe(true);
  expect(q.observeGenerationQuantity(observed,'k',{generationId:9,rawReturned:2,uniqueOutputs:2,savedOutputs:2})).toEqual(observed);
  expect(q.transitionGenerationReservation(state,'k','released').quantityLedger.reservations[0].phase).toBe('released');
 });
 it('treats an unknown upper as uncertainty, freezes actual excess and refuses it under a strict total',async()=>{
  const q=await quantities(), input=structuredClone(initial);
  delete input.generationPlans.p.plan.steps[0].receipt.output.maxReturned;
  const reserved=await reservation(input);
  expect(q.observeGenerationQuantity(reserved,'k',{generationId:9,rawReturned:2,uniqueOutputs:2,savedOutputs:2}).quantityLedger.frozen).toBe(true);
  const requirements=mergeTurnRequirements(undefined,undefined,{facts:[{field:'generation.totalOutputs',value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:'总共只能三张'}}]},[{kind:'message',sourceId:'msg',text:'总共只能三张'}]);
  input.requirements=requirements;input.generationPlans.p.plan.requirementsRevision=requirements.revision;input.generationPlans.p.plan.steps[0].receipt.requirementsRevision=requirements.revision;
  await expect(reservation(input)).rejects.toMatchObject({code:'QUANTITY_LIMIT'});
 });
 it('refuses unknown upper bounds for strict total, stale receipts and forged quantity meaning', async () => {
  const q=await quantities(); expect(q.reserveGenerationQuantity).toBeTypeOf('function');
  await expect(reservation(initial,{receiptId:'other'})).rejects.toMatchObject({code:'SELECTION_RECEIPT_STALE'});
  await expect(reservation(initial,{requestHash:'other'})).rejects.toMatchObject({code:'SELECTION_RECEIPT_STALE'});
  expect(()=>mergeTurnRequirements(undefined,undefined,{facts:[{field:'generation.retryCalls',value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:'3张图片'}}]},[{kind:'message',sourceId:'msg',text:'3张图片'}])).toThrow();
 });
});
it.each([
 ['generation.totalOutputs',1,'只生成1张，不要额外参考图或备选方案',true],
 ['generation.totalOutputs',3,'总共只能三张',true],
 ['generation.finalOutputs',3,'只要三个最终版本',true],
 ['generation.totalOutputs',3,'只要三个最终版本',false],
 ['generation.retryCalls',3,'最终3张，可以重试1次',false],
 ['generation.intermediateOutputs',3,'最终3张，不要额外参考图',false],
 ['image.quantity',3,'3秒的视频',false],
 ['generation.totalCalls',3,'总共最多调用3次，包括重试',true],
 ['generation.intermediateOutputs',0,'不要额外参考图',true],
 ['generation.retryCalls',0,'不要重试',true],
])('validates the source meaning of %s=%s in %s', (field,value,text,valid)=>{
 const apply=()=>mergeTurnRequirements(undefined,undefined,{facts:[{field,value,strength:'hard',source:{kind:'message',sourceId:'msg',quote:text}}]},[{kind:'message',sourceId:'msg',text:String(text)}]);
 if(valid)expect(apply).not.toThrow();else expect(apply).toThrow();
});
it.each([
 ['生成3张图片','video.quantity',3,'生成3张图片'],
 ['只要1张成品，不要额外生成3张参考图','generation.intermediateOutputs',3,'3张参考图'],
 ['不要额外调用3次','generation.initialCalls',3,'调用3次'],
 ['生成3份素材','image.quantity',3,'3份素材'],
 ['生成3段视频','image.quantity',3,'3段视频'],
])('rejects quantity authority from the full trusted clause: %s', (text,field,value,quote)=>{
 expect(()=>mergeTurnRequirements(undefined,undefined,{facts:[{field,value,strength:'hard',source:{kind:'message',sourceId:'msg',quote}}]},[{kind:'message',sourceId:'msg',text}])).toThrow();
});
it('cannot add the same three images as both image and video allowances',()=>{
 const facts=['image.quantity','video.quantity'].map(field=>({field,value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:'生成3张图片'}}));
 expect(()=>mergeTurnRequirements(undefined,undefined,{facts},[{kind:'message',sourceId:'msg',text:'生成3张图片'}])).toThrow();
});
it('accepts separately evidenced media counts in one complete clause',async()=>{
 const text='生成3张图片和2段视频';
 const requirements=mergeTurnRequirements(undefined,undefined,{facts:[['image.quantity',3,'3张图片'],['video.quantity',2,'2段视频']].map(([field,value,quote])=>({field,value,strength:'hard',source:{kind:'message',sourceId:'msg',quote}}))},[{kind:'message',sourceId:'msg',text}]);
 expect((await quantities()).generationAllowance({requirements})).toMatchObject({finalOutputs:5,initialCalls:5});
});
it.each([
 ['3张参考图不要生成，只要1张成品','generation.intermediateOutputs',3,'3张参考图',false],
 ['3张参考图不要生成，只要1张成品','generation.intermediateOutputs',3,'3张参考图不要生成',false],
 ['生成3张参考图是不允许的','generation.intermediateOutputs',3,'3张参考图',false],
 ['生成3张参考图是不允许的','generation.intermediateOutputs',3,'生成3张参考图是不允许的',false],
 ['3张参考素材禁止制作','generation.intermediateOutputs',3,'3张参考素材',false],
 ['三张参考图不可以生成','generation.intermediateOutputs',3,'三张参考图',false],
 ['生成3张参考图是不被允许的','generation.intermediateOutputs',3,'3张参考图',false],
 ['3张图片一律不能生成','image.quantity',3,'3张图片',false],
 ['重试3次是不允许的','generation.retryCalls',3,'重试3次',false],
 ['调用3次不要执行','generation.initialCalls',3,'调用3次',false],
 ['不要额外生成3张参考图','generation.intermediateOutputs',3,'3张参考图',false],
 ['生成3张参考图不要水印','generation.intermediateOutputs',3,'3张参考图',true],
 ['生成3张参考图不要使用黑色背景','generation.intermediateOutputs',3,'3张参考图',true],
 ['生成3张参考图不要水印','generation.intermediateOutputs',0,'生成3张参考图不要水印',false],
 ['参考图不要生成','generation.intermediateOutputs',0,'参考图不要生成',true],
 ['重试是不允许的','generation.retryCalls',0,'重试是不允许的',true],
 ['不要额外参考图','generation.intermediateOutputs',0,'不要额外参考图',true],
 ['no intermediate outputs','generation.intermediateOutputs',0,'no intermediate outputs',true],
 ['no retries','generation.retryCalls',0,'no retries',true],
 ['中间0张不要水印','generation.intermediateOutputs',0,'中间0张不要水印',true],
])('resolves quantity denial from the whole clause: %s', (text,field,value,quote,allowed)=>{
 const apply=()=>mergeTurnRequirements(undefined,undefined,{facts:[{field,value,strength:'hard',source:{kind:'message',sourceId:'msg',quote}}]},[{kind:'message',sourceId:'msg',text}]);
 if(allowed)expect(apply).not.toThrow();else expect(apply).toThrow();
});
const quantityDenials = ['不要','不许','不可以','不被允许','不用','不能','不允许','禁止','无需','不需要','别','不再'];
const quantityDenialMatrix = quantityDenials.flatMap(denial => ['','额外'].flatMap(modifier => ['before','after'].flatMap(position => ['full','cropped'].map(quoteMode => {
 const clause=position==='before'?`${denial}${modifier}生成3张参考图`:`3张参考图${denial}${modifier}生成`;
 const text=clause+'，只要1张成品';
 return {denial,modifier,position,quoteMode,text,quote:quoteMode==='full'?text:'3张参考图'};
}))));
it.each(quantityDenialMatrix)('quantity denial matrix: $denial/$modifier/$position/$quoteMode',({text,quote})=>{
 expect(()=>mergeTurnRequirements(undefined,undefined,{facts:[{field:'generation.intermediateOutputs',value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote}}]},[{kind:'message',sourceId:'msg',text}])).toThrow();
});
it.each(quantityDenials.flatMap(denial=>['before','after'].map(position=>({denial,position,text:position==='before'?`${denial}生成参考图`:`参考图${denial}生成` }))))('zero uses the same denial scope: $denial/$position',({text})=>{
 const requirements=mergeTurnRequirements(undefined,undefined,{facts:[{field:'generation.intermediateOutputs',value:0,strength:'hard',source:{kind:'message',sourceId:'msg',quote:text}}]},[{kind:'message',sourceId:'msg',text}]);
 expect(requirements.facts[0].value).toBe(0);
});
it.each(['不要','不许有','不用','不能有','不允许有','不需要'].flatMap(denial=>['before','after'].flatMap(position=>['full','cropped'].map(quoteMode=>{
 const text=position==='before'?`生成${denial}水印的3张参考图`:`生成3张参考图${denial}水印`;
 return {denial,position,quoteMode,text,quote:quoteMode==='full'?text:'3张参考图'};
}))))('parameter denial leaves only explicit positive quantity: $denial/$position/$quoteMode',({text,quote})=>{
 const apply=(value:number)=>mergeTurnRequirements(undefined,undefined,{facts:[{field:'generation.intermediateOutputs',value,strength:'hard',source:{kind:'message',sourceId:'msg',quote}}]},[{kind:'message',sourceId:'msg',text}]);
 expect(apply(3).facts[0].value).toBe(3);
 expect(()=>apply(0)).toThrow();
});
it.each([
 ['不许调用3次','generation.initialCalls','调用3次'],
 ['调用3次不用执行','generation.initialCalls','调用3次'],
 ['不被允许重试3次','generation.retryCalls','重试3次'],
 ['重试3次不可以执行','generation.retryCalls','重试3次'],
])('shared execution scope also rejects %s',(text,field,quote)=>{
 expect(()=>mergeTurnRequirements(undefined,undefined,{facts:[{field,value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote}}]},[{kind:'message',sourceId:'msg',text}])).toThrow();
});
it.each([false,true])('does not add final/intermediate authority from the same trusted number (separate updates=%s)',sequential=>{
 const text='最终交付3张参考图',sources:any[]=[{kind:'message',sourceId:'msg',text}];
 const fact=(field:string,quote:string)=>({field,value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote}});
 const final=fact('generation.finalOutputs','最终交付3张参考图'),intermediate=fact('generation.intermediateOutputs','3张参考图');
 const previous=sequential?mergeTurnRequirements(undefined,undefined,{facts:[final]},sources):undefined;
 expect(()=>mergeTurnRequirements(undefined,previous,{facts:sequential?[intermediate]:[final,intermediate]},sources)).toThrow();
});
it.each([false,true])('independent trusted positions can authorize equal quantities (identical quotes=%s)',async identical=>{
 const text='交付3张成品，另外生成3张参考图';
 const facts=[['generation.finalOutputs','3张成品'],['generation.intermediateOutputs','3张参考图']].map(([field,phrase])=>({field,value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:identical?'3张':phrase,...(identical?{start:text.indexOf(phrase),end:text.indexOf(phrase)+2}:{})}}));
 const requirements=mergeTurnRequirements(undefined,undefined,{facts},[{kind:'message',sourceId:'msg',text}]);
 expect((await quantities()).generationAllowance({requirements})).toMatchObject({finalOutputs:3,intermediateOutputs:3,initialCalls:6});
 expect(new Set(requirements.facts.map(fact=>fact.source.valueStart)).size).toBe(2);
});
it('the allowance reader rejects previously stored duplicate additive evidence',async()=>{
 const text='最终交付3张参考图';
 const separate=['generation.finalOutputs','generation.intermediateOutputs'].map(field=>mergeTurnRequirements(undefined,undefined,{facts:[{field,value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:'3张参考图'}}]},[{kind:'message',sourceId:'msg',text}]));
 const requirements={...separate[0],facts:separate.flatMap(item=>item.facts)};
 const q=await quantities();
 expect(()=>q.generationAllowance({requirements})).toThrow();
});

// Every numeric occurrence must carry its own unit/object and role; equal values elsewhere are irrelevant.
const unrelatedQuantityNumbers = ['3厘米','3毫米','3秒','3分钟','3像素','3K'];
it.each(unrelatedQuantityNumbers)('does not borrow output semantics for a distinct parameter occurrence %s', async quote=>{
 const text=`最终交付3张参考图（参数${quote}）`;
 const fact=(field:string,quote:string)=>({field,value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote}});
 expect(()=>mergeTurnRequirements(undefined,undefined,{facts:[fact('generation.finalOutputs','3张参考图'),fact('generation.intermediateOutputs',quote)]},[{kind:'message',sourceId:'msg',text}])).toThrow();
});
it.each(['generation.finalOutputs','generation.intermediateOutputs','generation.totalOutputs','generation.initialCalls','generation.retryCalls','generation.totalCalls'])('binds %s to its own number, not another equal quantity', field=>{
 const text='最终交付3张参考图并总共生成3张且总共调用3次并重试3次（宽度3厘米）';
 expect(()=>mergeTurnRequirements(undefined,undefined,{facts:[{field,value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:'3厘米'}}]},[{kind:'message',sourceId:'msg',text}])).toThrow();
});
it.each([
 ['generation.finalOutputs','最终交付3张成品和3张参考图','3张参考图',false],
 ['generation.totalOutputs','总共3张成品和3张参考图','3张参考图',false],
 ['generation.totalCalls','总共调用3次和重试3次','重试3次',false],
 ['generation.intermediateOutputs','交付3张成品并另外生成3张参考图','3张参考图',true],
 ['generation.initialCalls','最终交付3张成品并调用3次','3次',true],
 ['generation.retryCalls','最终交付3张成品并重试3次','3次',true],
 ['generation.totalCalls','最终交付3张成品并总共最多调用3次','3次',true],
 ['generation.totalOutputs','最终交付3张成品并总共最多生成3张','总共最多生成3张',true],
 ['image.quantity','做3张蓝色海报','3张蓝色海报',true],
 ['image.quantity','做3张不要水印的蓝色海报','3张不要水印的蓝色海报',true],
 ['image.quantity','尺寸3厘米','3厘米',false],
 ['video.quantity','时长3秒','3秒',false],
 ['video.quantity','遵守3条要求','3条要求',false],
])('anchors %s in %s', (field,text,quote,allowed)=>{
 const apply=()=>mergeTurnRequirements(undefined,undefined,{facts:[{field,value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote}}]},[{kind:'message',sourceId:'msg',text}]);
 if(allowed)expect(apply).not.toThrow();else expect(apply).toThrow();
});
it('rejects old persisted borrowed numeric semantics on allowance read and subsequent merge',async()=>{
 const text='最终交付3张参考图（宽度3厘米）';
 const requirements=mergeTurnRequirements(undefined,undefined,{facts:[{field:'generation.finalOutputs',value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:'3张参考图'}}]},[{kind:'message',sourceId:'msg',text}]);
 const historical:any={...requirements,facts:[...requirements.facts,{field:'generation.intermediateOutputs',value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:'3厘米',start:12,end:15,valueStart:12,order:0,correction:false}}]};
 const q=await quantities();expect(()=>q.generationAllowance({requirements:historical})).toThrow(expect.objectContaining({code:'QUANTITY_SOURCE_INVALID'}));
 expect(()=>mergeTurnRequirements(undefined,historical,{facts:[{field:'image.params.aspectRatio',value:'1:1',strength:'hard',source:{kind:'message',sourceId:'next',quote:'1:1'}}]},[{kind:'message',sourceId:'next',text:'1:1'}])).toThrow();
});
it('retains new cropped quantities but invalidates unproven historical quotes after JSON reload',async()=>{
 const text='最终交付3张参考图';
 const requirements=mergeTurnRequirements(undefined,undefined,{facts:[{field:'generation.finalOutputs',value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:'3张'}}]},[{kind:'message',sourceId:'msg',text}]);
 const q=await quantities();expect(q.generationAllowance({requirements:JSON.parse(JSON.stringify(requirements))})).toMatchObject({finalOutputs:3,initialCalls:3});
 const historical:any={...requirements,facts:[{field:'generation.finalOutputs',value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:text,start:0,end:text.length,valueStart:4,order:0,correction:false}}]};
 expect(()=>q.generationAllowance({requirements:historical})).toThrow(expect.objectContaining({code:'QUANTITY_SOURCE_INVALID'}));
});
it.each([
 ['3张蓝色海报不要生成',false],['3张蓝色海报不被允许生成',false],
 ['3张蓝色海报不要水印',true],['3张不要水印的蓝色海报',true],
])('keeps execution and parameter negation scoped to a concrete media object: %s',(text,allowed)=>{
 const apply=()=>mergeTurnRequirements(undefined,undefined,{facts:[{field:'image.quantity',value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:'3张'}}]},[{kind:'message',sourceId:'msg',text}]);
 if(allowed)expect(apply).not.toThrow();else expect(apply).toThrow();
});
it.each(['3条要求提到视频','3条关于视频的要求','3张纸用于视频'])('does not find a media object beyond the actual count object: %s',text=>{
 expect(()=>mergeTurnRequirements(undefined,undefined,{facts:[{field:'video.quantity',value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:text}}]},[{kind:'message',sourceId:'msg',text}])).toThrow();
});
it('does not accept a caller-supplied quantity validation version as proof',()=>{
 expect(()=>mergeTurnRequirements(undefined,undefined,{facts:[{field:'generation.intermediateOutputs',value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:'3厘米',quantityEvidenceVersion:1}}]},[{kind:'message',sourceId:'msg',text:'最终交付3张参考图（宽度3厘米）'}])).toThrow();
});
it.each([['image.quantity','做3张最终图片'],['video.quantity','做3段成品视频']])('preserves explicit media qualifiers for %s', (field,text)=>{
 expect(()=>mergeTurnRequirements(undefined,undefined,{facts:[{field,value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:text}}]},[{kind:'message',sourceId:'msg',text}])).not.toThrow();
});

const compoundQuantityCases=[
 ['generation.finalOutputs','3张成品图片','不要生成','不要水印'],
 ['generation.intermediateOutputs','3张中间参考图片','不被允许生成','不要水印'],
 ['generation.totalOutputs','总共3张成品图片','不用生成','不要水印'],
 ['generation.initialCalls','3次初次调用','不要执行','不要改变模型'],
 ['generation.retryCalls','3次补试','不允许执行','不要改变模型'],
 ['generation.totalCalls','总共调用3次初次调用','不要执行','不要改变模型'],
] as const;
it.each(compoundQuantityCases)('shares full compound subject and negation scope for %s',(field,subject,denial,parameter)=>{
 for(const [tail,allowed] of [['',true],[denial,false],[parameter,true]] as const){
  const text=subject+tail;
  const apply=()=>mergeTurnRequirements(undefined,undefined,{facts:[{field,value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:subject}}]},[{kind:'message',sourceId:'msg',text}]);
  if(allowed)expect(apply).not.toThrow();else expect(apply).toThrow();
 }
});
it.each([
 ['generation.finalOutputs','最终交付3条要求',false],['generation.finalOutputs','最终交付3张成品图片',true],
 ['generation.totalOutputs','总共3条要求',false],['generation.intermediateOutputs','中间3条要求',false],
 ['generation.finalOutputs','最终交付3个要求',false],
])('requires a media output object for %s in %s',(field,text,allowed)=>{
 const apply=()=>mergeTurnRequirements(undefined,undefined,{facts:[{field,value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:text}}]},[{kind:'message',sourceId:'msg',text}]);
 if(allowed)expect(apply).not.toThrow();else expect(apply).toThrow();
});
it.each([undefined,1])('does not upgrade lossy historical quotes without the trusted source (version %s)',async quantityEvidenceVersion=>{
 const text='不许生成3张参考图，只要1张成品';
 const historical:any={version:1,revision:1,fieldRevisions:{},conflicts:[],effectivePreferences:{},facts:[{field:'generation.intermediateOutputs',value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:'3张参考图',start:4,end:9,valueStart:4,order:0,correction:false,...(quantityEvidenceVersion?{quantityEvidenceVersion}:{})}}]};
 const next={facts:[{field:'image.params.aspectRatio',value:'1:1',strength:'hard',source:{kind:'message',sourceId:'next',quote:'1:1'}}]};
 const q=await quantities();expect(()=>q.generationAllowance({requirements:historical})).toThrow(expect.objectContaining({code:'QUANTITY_SOURCE_INVALID'}));
 expect(()=>mergeTurnRequirements(undefined,historical,next,[{kind:'message',sourceId:'next',text:'1:1'}])).toThrow();
 expect(()=>mergeTurnRequirements(undefined,historical,next,[{kind:'message',sourceId:'next',text:'1:1'},{kind:'message',sourceId:'msg',text}])).toThrow();
});
it.each([undefined,1])('only upgrades historical positive quantities with full trusted source (version %s)',async quantityEvidenceVersion=>{
 const text='最终交付3张成品图片';
 const historical:any={version:1,revision:1,fieldRevisions:{},conflicts:[],effectivePreferences:{},facts:[{field:'generation.finalOutputs',value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:'3张成品图片',start:4,end:10,valueStart:4,order:0,correction:false,...(quantityEvidenceVersion?{quantityEvidenceVersion}:{})}}]};
 const q=await quantities();expect(()=>q.generationAllowance({requirements:historical})).toThrow(expect.objectContaining({code:'QUANTITY_SOURCE_INVALID'}));
 const updated=mergeTurnRequirements(undefined,historical,{facts:[{field:'image.params.aspectRatio',value:'1:1',strength:'hard',source:{kind:'message',sourceId:'next',quote:'1:1'}}]},[{kind:'message',sourceId:'next',text:'1:1'},{kind:'message',sourceId:'msg',text}]);
 expect(updated.facts[0].source.quantityEvidenceVersion).toBe(2);
 expect(q.generationAllowance({requirements:updated})).toMatchObject({finalOutputs:3,initialCalls:3});
});
it('stale quantity validation cannot grant fresh work but keeps observation and identical reservation',async()=>{
 const q=await quantities(),state=await reservation();
 const started=q.transitionGenerationReservation(state,'k','started');
 started.requirements={facts:[{field:'generation.finalOutputs',value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:'3张成品图片',quantityEvidenceVersion:1}}]};
 expect(q.observeGenerationQuantity(started,'k',{generationId:9,rawReturned:1,uniqueOutputs:1,savedOutputs:1}).quantityLedger.reservations[0].phase).toBe('started');
 expect(await reservation(started)).toEqual(started);
 await expect(reservation(started,{actionId:'fresh',requestKeys:['fresh']})).rejects.toMatchObject({code:'QUANTITY_SOURCE_INVALID'});
});
it('does not relocate an old numeric anchor while restoring its full trusted source',()=>{
 const text='最终交付3张参考图（宽度3厘米）';
 const old:any={version:1,revision:1,fieldRevisions:{},conflicts:[],effectivePreferences:{},facts:[{field:'generation.intermediateOutputs',value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:text,start:0,end:text.length,valueStart:12,quantityEvidenceVersion:1}}]};
 expect(()=>mergeTurnRequirements(undefined,old,{facts:[{field:'image.params.aspectRatio',value:'1:1',strength:'hard',source:{kind:'message',sourceId:'next',quote:'1:1'}}]},[{kind:'message',sourceId:'msg',text},{kind:'message',sourceId:'next',text:'1:1'}])).toThrow();
});
it.each([
 ['generation.finalOutputs','3张不要成品水印的图片'],
 ['generation.intermediateOutputs','3张不要参考水印的图片'],
])('does not derive %s from a parameter description inside the object', (field,text)=>{
 expect(()=>mergeTurnRequirements(undefined,undefined,{facts:[{field,value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:text}}]},[{kind:'message',sourceId:'msg',text}])).toThrow();
 expect(()=>mergeTurnRequirements(undefined,undefined,{facts:[{field:'image.quantity',value:3,strength:'hard',source:{kind:'message',sourceId:'msg',quote:text}}]},[{kind:'message',sourceId:'msg',text}])).not.toThrow();
});

describe('explicit-total comma enumeration and whole-plan confirmation scope',()=>{
 const state=(text:string,quotes:string[])=>mergeTurnRequirements(undefined,undefined,{facts:quotes.map(quote=>({field:'image.quantity',value:1,strength:'hard',source:{kind:'message',sourceId:'msg',quote}}))},[{kind:'message',sourceId:'msg',text}]);
 it('composes equal distinct list items only under a matching explicit total',async()=>{
  const q=await quantities();const requirements=state('生成两张极简几何海报：一张米色，一张灰蓝色。',['一张米色','一张灰蓝色']);
  expect(requirements.composedQuantities?.['image.quantity']?.value).toBe(2);
  expect(q.generationAllowance({requirements})).toEqual({finalOutputs:2,intermediateOutputs:0,initialCalls:2,retryCalls:0});
  expect(requirements.facts.map(f=>f.value)).toEqual([1,1]);
 });
 it.each([
  ['一张米色，一张灰蓝色。',['一张米色','一张灰蓝色']],
  ['生成三张海报：一张米色，一张灰蓝色。',['一张米色','一张灰蓝色']],
  ['生成两条视频：一张米色，一张灰蓝色。',['一张米色','一张灰蓝色']],
  ['有两个要求：一张米色，一张灰蓝色。',['一张米色','一张灰蓝色']],
  ['生成两张海报：一张米色海报，一幅米色图片。',['一张米色海报','一幅米色图片']],
  ['生成两张海报：一张米色，还是一张灰蓝色。',['一张米色','一张灰蓝色']],
  ['生成两张海报：一张米色。另一句：一张灰蓝色。',['一张米色','一张灰蓝色']],
 ])('does not turn unrelated or inconsistent commas into extra authority: %s',async(text,quotes)=>{
  const q=await quantities();const requirements=state(text as string,quotes as string[]);
  expect(requirements.composedQuantities?.['image.quantity']).toBeUndefined();expect(q.generationAllowance({requirements}).finalOutputs).toBe(1);
 });
 it('does not add repeated same-object mentions or repeated facts',async()=>{
  const text='生成两张海报：一张米色，一张米色。',quote='一张米色';
  const requirements=mergeTurnRequirements(undefined,undefined,{facts:[text.indexOf(quote),text.lastIndexOf(quote)].map(start=>({field:'image.quantity',value:1,strength:'hard',source:{kind:'message',sourceId:'msg',quote,start,end:start+quote.length}}))},[{kind:'message',sourceId:'msg',text}]);
  expect(requirements.composedQuantities?.['image.quantity']).toBeUndefined();
  const q=await quantities();expect(q.generationAllowance({requirements}).finalOutputs).toBe(1);
  expect(state('生成两张海报：一张米色，一张灰蓝色。',['一张米色','一张米色']).composedQuantities?.['image.quantity']).toBeUndefined();
 });
 it('rejects an over-budget whole plan before confirming its first affordable step',async()=>{
  const q=await quantities();const input=structuredClone(initial);input.generationPlans.p.plan.steps.push({...input.generationPlans.p.plan.steps[0],id:'s2'});
  input.generationPlans.p.plan.definition.steps.push({...input.generationPlans.p.plan.definition.steps[0],id:'s2'});
  expect(()=>q.generationExecution(input,'p','s')).toThrow(/整套方案.*数量/);
 });
});

it.each(['家庭背景图','深色几何图','绿色玻璃花瓶商品主图','透明水杯商品照片','折纸动物主题海报','金属机器人科普视频'])('accepts compound media noun modifiers without a product dictionary: %s',subject=>{
 const video=subject.endsWith('视频'),text=`生成一${video?'条':'张'}${subject}`;
 const state=mergeTurnRequirements(undefined,undefined,{facts:[{field:video?'video.quantity':'image.quantity',value:1,strength:'hard',source:{kind:'message',sourceId:'msg',quote:text}}]},[{kind:'message',sourceId:'msg',text}]);
 expect(state.facts[0].value).toBe(1);
});
it.each([
 ['image.quantity','生成一张玻璃花瓶商品主图是不允许的'],['image.quantity','不要生成一张玻璃花瓶商品主图'],
 ['image.quantity','一个圆形构图'],['generation.finalOutputs','一张玻璃花瓶参考图'],['generation.totalCalls','一张玻璃花瓶商品主图和三次调用'],
])('does not broaden compound object authorization: %s/%s',(field,text)=>{
 expect(()=>mergeTurnRequirements(undefined,undefined,{facts:[{field,value:1,strength:'hard',source:{kind:'message',sourceId:'msg',quote:text}}]},[{kind:'message',sourceId:'msg',text}])).toThrow();
});

it.each(['生成一个家庭背景','需要一个办公室场景'])('recognizes a directly requested static visual output without requiring 图: %s',text=>{const result=mergeTurnRequirements(undefined,undefined,{facts:[{field:'image.quantity',value:1,strength:'hard',source:{kind:'message',sourceId:'msg',quote:text}}]},[{kind:'message',sourceId:'msg',text}]);expect(result.facts[0].value).toBe(1);});
it.each(['生成一张图片，里面包含一个家庭背景','上传一个家庭背景','不要生成一个家庭背景'])('does not borrow component or input visual target counts: %s',text=>{expect(()=>mergeTurnRequirements(undefined,undefined,{facts:[{field:'image.quantity',value:1,strength:'hard',source:{kind:'message',sourceId:'msg',quote:'一个家庭背景'}}]},[{kind:'message',sourceId:'msg',text}])).toThrow();});
