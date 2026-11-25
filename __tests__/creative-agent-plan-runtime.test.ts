import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/prisma',()=>({default:{}}));
vi.mock('@/lib/creative-agent/access',()=>({requireCreativeAgentEnabled:vi.fn(),requireCreativeAgentCanvas:vi.fn()}));
vi.mock('@/lib/maintenance',()=>({assertDurableWorkAdmission:vi.fn()}));
async function runtime(){const file='../lib/creative-agent/plan-runtime';return import(file) as Promise<Record<string,any>>;}
const definition:any={steps:[{id:'a',role:'intermediate',mediaType:'image',prompt:'A',params:{count:1},references:[],dependsOn:[]},{id:'b',role:'final',mediaType:'image',prompt:'B unchanged full prompt',params:{count:1},references:[{stepId:'a',outputIndex:0}],dependsOn:[]}]};
const plan:any={version:1,definition,requirementsRevision:0,steps:[{id:'a',role:'intermediate',mediaType:'image',status:'ready',dependsOn:[],receipt:{id:'ra'}},{id:'b',role:'final',mediaType:'image',status:'blocked',dependsOn:['a'],missingOutputs:[{stepId:'a',outputIndex:0}]}]};
const run:any={id:'r',epoch:1,actorUserId:1,canvasId:2,input:{matchingPolicyVersion:2,generationPlans:{p:{id:'p',plan,expiresAt:'2099-01-01T00:00:00.000Z'}}}};
const actions:any[]=[{id:'a',kind:'image.generate',state:'succeeded',result:{generationIds:[10],mediaRequest:{matching:{execution:{planId:'p',stepId:'a'}}}}}];
describe('persisted dependency advancement',()=>{
 it('waits for real committed outputs and never invokes a model or guesses missing references',async()=>{
  const r=await runtime();expect(r.advancePersistedPlan).toBeTypeOf('function');
  const executeStep=vi.fn();const deps={store:{getRun:async()=>run,actionReceipts:async()=>actions,assertFence:vi.fn()},executeStep,readCanvas:vi.fn()};
  expect(await r.advancePersistedPlan(run,[],deps)).toBe('waiting');
  expect(await r.advancePersistedPlan(run,[{generationId:10,status:'success',outputs:[]}],deps)).toBe('waiting');
  expect(executeStep).not.toHaveBeenCalled();expect(deps.readCanvas).not.toHaveBeenCalled();
  await expect(r.advancePersistedPlan(run,[{generationId:10,status:'failed',outputs:[]}],deps)).rejects.toMatchObject({code:'PLAN_DEPENDENCY_FAILED'});
 });
 it('stops a dependent plan when the finalized step was cancelled instead of repeatedly replaying cancellation',async()=>{
  const r=await runtime(),executeStep=vi.fn();
  const journal=[...actions,{id:'b',kind:'image.generate',state:'succeeded',result:{cancelled:true,planExecution:{planId:'p',stepId:'b'}}}];
  await expect(r.advancePersistedPlan(run,[{generationId:10,status:'success',revision:'2',nodeIds:['n'],outputs:[{nodeId:'n',url:'/uploads/a.png'}]}],{store:{getRun:async()=>run,actionReceipts:async()=>journal,assertFence:vi.fn()},executeStep,readCanvas:vi.fn(async()=>({nodes:[],revision:'2'}))})).rejects.toMatchObject({code:'PLAN_STEP_CANCELLED'});
  expect(executeStep).not.toHaveBeenCalled();
 });
 it('binds actual node hash, persists a derived receipt and resumes the identical stable step once',async()=>{
  const r=await runtime();expect(r.advancePersistedPlan).toBeTypeOf('function');
  const current=structuredClone(run), journal=structuredClone(actions);
  const node:any={id:'real-node',type:'image',position:{x:0,y:0},data:{kind:'image',url:'/uploads/actual.png',mediaId:'media'}};
  const executeStep=vi.fn(async(_run:any,planId:string,stepId:string)=>{journal.push({id:'b',kind:'image.generate',state:'succeeded',result:{generationIds:[11],mediaRequest:{matching:{execution:{planId,stepId}}}}});});
  const finalize=vi.fn(async(input:any,_deps:any,bindings:any)=>({...plan,definition,steps:[plan.steps[0],{...plan.steps[1],status:'ready',receipt:{id:'rb',request:{model:'m',prompt:definition.steps[1].prompt,params:{count:1},references:bindings.a}}}]}));
  const deps={store:{getRun:async()=>current,actionReceipts:async()=>journal,assertFence:vi.fn(),saveGenerationPlan:async(_run:any,id:string,p:any)=>{current.input.generationPlans[id]={id,plan:p,expiresAt:'2099-01-01T00:00:00.000Z'};}},readCanvas:async()=>({nodes:[node],revision:'2'}),executeStep,finalize};
  const observed=[{generationId:10,status:'success',revision:'2',nodeIds:['real-node'],outputs:[{nodeId:'real-node',url:'/uploads/actual.png',generationId:10}]}];
  expect(await r.advancePersistedPlan(run,observed,deps)).toBe('dispatched');
  expect(finalize.mock.calls[0][0].args.steps[1].prompt).toBe(definition.steps[1].prompt);
  expect(finalize.mock.calls[0][2].a).toMatchObject([{nodeId:'real-node',mediaId:'media',semanticHash:expect.any(String)}]);
  expect(await r.advancePersistedPlan(run,observed,deps)).toBe('waiting');
  expect(executeStep).toHaveBeenCalledOnce();
  deps.readCanvas=async()=>({nodes:[],revision:'4'});
  expect(await r.advancePersistedPlan(run,[...observed,{generationId:11,status:'success',revision:'3',nodeIds:['b'],outputs:[{nodeId:'b',url:'/uploads/b.png'}]}],deps)).toBe('complete');
 });
});
it.each([
 ['failed',{code:'QUANTITY_LIMIT',message:'本轮额度已用完',rejectedBeforeDispatch:true},'QUANTITY_LIMIT'],
 ['failed',{message:'执行中断发生在提交之前',rejectedBeforeDispatch:true},'MEDIA_NOT_DISPATCHED'],
 ['claimed',{},'MEDIA_DISPATCH_UNKNOWN'],
 ['unknown',{},'MEDIA_DISPATCH_UNKNOWN'],
])('keeps %s execution certainty and the original cause',async(state,detail,code)=>{
 const r=await runtime(), executeStep=vi.fn();
 const journal=[{id:'a',kind:'image.generate',state,result:{...detail,planExecution:{planId:'p',stepId:'a'}}}];
 const result=r.advancePersistedPlan(run,[],{store:{getRun:async()=>run,actionReceipts:async()=>journal},executeStep});
 await expect(result).rejects.toMatchObject({code,...('message' in detail?{message:detail.message}:{})});
 expect(executeStep).not.toHaveBeenCalled();
});
