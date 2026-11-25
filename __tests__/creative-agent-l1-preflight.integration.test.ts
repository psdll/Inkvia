import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { CreativeAgentStore } from '@/lib/creative-agent/store';
import { createCreativeTools, creativeActionId, type ToolExecutionInput } from '@/lib/creative-agent/tools';
import { generationAllowance } from '@/lib/creative-agent/quantity';
import { prepareCreativeAgentMedia } from '@/lib/creative-agent/media-broker';
import * as planning from '@/lib/creative-agent/generation-plan';
import { getImageModelParams } from '@/lib/generation/image-model-params';
import { withCreativeDebug, type TraceWrite } from '@/lib/creative-agent/debug-trace';
import { applyAgentEvents, emptyAgentState } from '@/components/creative-agent/state';
import fixture from './fixtures/creative-agent-l1-preflight.json';
import evidenceFixture from './fixtures/creative-agent-evidence-errors.json';
import commaFixture from './fixtures/creative-agent-comma-plan.json';
import overrideFixture from './fixtures/creative-agent-inline-override.json';
import { hash } from '@/lib/creative-agent/store-types';
import { CreativeAgentError } from '@/lib/creative-agent/errors';
import * as effectiveCatalog from '@/lib/creative-agent/effective-media-catalog';
import { getVideoModelSpec } from '@/lib/sora2';
import { WAN_VIDEO_MODEL_ID } from '@/lib/wan-models';
vi.mock('@/lib/creative-agent/access',()=>({requireCreativeAgentEnabled:vi.fn(),requireCreativeAgentCanvas:vi.fn()}));
const store=new CreativeAgentStore(prisma);
let actorUserId:number;
async function setup(text=fixture.text,preferences?:any){
 const canvasId=(await prisma.canvas.create({data:{authUserId:actorUserId,title:'L1 preflight test'}})).id;
 const queued=await store.enqueue({actorUserId,canvasId,messageId:randomUUID(),text,preferences,baseRevision:'0',selection:{nodeIds:[],edgeIds:[],references:[]}});
 let run=(await store.claimRun('l1-preflight-test',60_000))!;expect(run.id).toBe(queued.run.id);
 // Retain historical approval fixtures; new direct behavior has its own real broker suite.
 delete run.input.mediaAuthorizationVersion; await prisma.creativeAgentRun.update({where:{id:run.id},data:{input:run.input as any}});
 const catalog={image:[{id:'gpt-image-2-openrouter',label:'Fixture visible image',params:{...getImageModelParams('gpt-image-2-openrouter'),defaultQuality:''},qualification:{available:true,reasons:[],entitlement:'unverified',providerId:'openrouter',adapterId:'gpt-image-2-openrouter',routeConfigFingerprint:'fixture'}}],video:[]};
 const deps:any={readCanvas:async()=>({revision:'0',nodes:[],edgeIds:[]}),catalog:async()=>catalog};
 const original=planning.createCreativeGenerationPlan;
 const plan=vi.spyOn(planning,'createCreativeGenerationPlan').mockImplementation(input=>original(input,deps));
 const dispatch=vi.fn(async(_input:ToolExecutionInput)=>({generationId:123,status:'running'}));
 const traces:TraceWrite[]=[];
 const args=(value:any)=>{const copy=structuredClone(value);for(const fact of copy.facts??[])fact.source.sourceId=run.input.messageId;return copy;};
 const call=(name:string,raw:any,id:string=randomUUID())=>withCreativeDebug({runId:run.id,actorUserId,canvasId,epoch:run.epoch},()=>createCreativeTools(run,store,dispatch,input=>prepareCreativeAgentMedia(input,deps)).find(t=>t.name===name)!.execute(id,raw),async row=>{traces.push(row);});
 return {get run(){return run;},catalog,dispatch,traces,args,call,async ready(which=fixture.plan){const result=await call('generation_plan',args(which));const data=result.details as any;return {planId:data.actionId,receipt:data.result.plan.steps[0].receipt};},async approve(answer:any='approve'){const decision=await prisma.creativeAgentDecision.findFirstOrThrow({where:{runId:run.id,state:'pending'}});await store.answerDecision(decision.id,actorUserId,randomUUID(),decision.proposalHash,answer);run=(await store.claimRun('l1-approved-test',60_000))!;},async close(){plan.mockRestore();await store.control(run.id,actorUserId,randomUUID(),'stop').catch(()=>undefined);}};
}
async function assertPreflight(f:Awaited<ReturnType<typeof setup>>,callId:string,name:string){
 const snapshot=await new CreativeAgentStore(prisma).snapshot(actorUserId,f.run.canvasId,f.run.sessionId);
 if(!('activity' in snapshot))throw new Error('missing activity');
 const item=snapshot.activity.find(item=>item.event.payload.name===name&&item.event.payload.toolCallId===callId);
 expect(item?.event.payload).toMatchObject({status:'error',startedSequence:expect.any(Number),detail:{phase:'preflight',dispatched:false,code:expect.any(String)}});
 expect(snapshot.activity.filter(item=>item.event.payload.toolCallId===callId)).toHaveLength(1);
 expect(f.traces.find(row=>row.type==='tool.failed'&&row.summary?.toolCallId===callId)).toMatchObject({status:'error',detail:{phase:'preflight',dispatched:false,code:expect.any(String)}});
 expect(f.dispatch).not.toHaveBeenCalled();
 expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id}})).toBe(0);
 expect((await store.getRun(f.run.id)).input.quantityLedger?.reservations??[]).toHaveLength(0);
}
describe.skipIf(process.env.CREATIVE_AGENT_DB_TEST!=='1')('L1 real tool preflight contracts and durable activity',()=>{
 beforeAll(async()=>{actorUserId=(await prisma.user.create({data:{username:`l1-preflight-${randomUUID()}`,password:'fixture'}})).id;});
 afterAll(async()=>{if(actorUserId)await prisma.user.delete({where:{id:actorUserId}});await prisma.$disconnect();});
 it.each(overrideFixture.calls)('accepts the complete live temporary override via plan and direct inline: $id',async sample=>{
  for(const name of ['generation_plan','image_generate']){
   const f=await setup(overrideFixture.text,{image:{mode:'auto',params:{resolution:'4K',aspectRatio:'16:9'}}});try{
    const plan=f.args(sample.arguments),args=name==='generation_plan'?plan:{...plan.steps[0],facts:plan.facts};
    if(name==='image_generate'){delete args.id;delete args.role;delete args.mediaType;await expect(f.call(name,args)).rejects.toMatchObject({code:'run_deferred'});}
    else await f.call(name,args);
    const saved=await store.getRun(f.run.id);expect(saved.input.requirements?.facts).toHaveLength(5);
    expect(saved.input.effectivePreferences?.image?.params).toEqual({resolution:'2K',aspectRatio:'3:4'});
    expect(Object.values(saved.input.generationPlans!)[0].plan.steps[0].receipt?.request.params).toMatchObject({resolution:'2K',aspectRatio:'3:4',count:1});expect(f.dispatch).not.toHaveBeenCalled();
   }finally{await f.close();}
  }
 });
 it('requires correcting conflicting fallback params instead of silently using saved defaults after invalid facts',async()=>{
  const f=await setup(overrideFixture.text,{image:{mode:'auto',params:{resolution:'4K',aspectRatio:'16:9'}}});try{
   const invalid=f.args(overrideFixture.calls[0].arguments);invalid.facts[1].source.quote='invented';
   await expect(f.call('generation_plan',invalid)).rejects.toBeDefined();
   await expect(f.call('image_generate',{prompt:'green vase',params:{resolution:'2K',aspectRatio:'3:4'}},'fallback-conflict')).rejects.toMatchObject({code:'requirement_conflict'});
   await assertPreflight(f,'fallback-conflict','image.generate');
  }finally{await f.close();}
 });
 it('records direct inline current requirements before exact approval and replays without duplicate work',async()=>{
  const f=await setup('生成一张2K、3:4海报',{image:{mode:'auto',params:{resolution:'4K',aspectRatio:'16:9'}}});try{
   const facts=[['image.params.resolution','2K','2K'],['image.params.aspectRatio','3:4','3:4'],['image.quantity',1,'一张']].map(([field,value,quote])=>({field,value,strength:'hard',source:{kind:'message',sourceId:f.run.input.messageId,quote}}));
   const args={prompt:'极简海报',facts};
   await expect(f.call('image_generate',args,'inline')).rejects.toMatchObject({code:'run_deferred'});
   let saved=await store.getRun(f.run.id);const revision=saved.input.requirements!.revision;
   const receipt=Object.values(saved.input.generationPlans!)[0].plan.steps[0].receipt!;
   expect(receipt.request.params).toMatchObject({resolution:'2K',aspectRatio:'3:4',count:1});
   expect(saved.input.preferences?.image?.params).toEqual({resolution:'4K',aspectRatio:'16:9'});
   const decision=await prisma.creativeAgentDecision.findFirstOrThrow({where:{runId:f.run.id,state:'pending'}});
   expect(decision.binding).toMatchObject({limits:{finalOutputs:1,initialCalls:1,retryCalls:0}});expect(f.dispatch).not.toHaveBeenCalled();
   await f.approve();await f.call('image_generate',args,'resume');await f.call('image_generate',args,'replay');
   saved=await store.getRun(f.run.id);expect(saved.input.requirements!.revision).toBe(revision);
   expect(f.dispatch).toHaveBeenCalledTimes(1);expect(f.dispatch.mock.calls[0][0].args).toEqual(receipt.request);
   expect(f.dispatch.mock.calls[0][0].args).not.toHaveProperty('facts');expect(f.dispatch.mock.calls[0][0].args).not.toHaveProperty('continuation');
   expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id}})).toBe(1);
  }finally{await f.close();}
 });
 it.each(['quote','quantity','strict'])('rejects unsafe direct inline requirements before approval: %s',async scenario=>{
  const f=await setup('生成一张图片，总共只能生成一张');try{
   const fact={field:scenario==='strict'?'generation.totalOutputs':'image.quantity',value:scenario==='quantity'?2:1,strength:'hard',source:{kind:'message',sourceId:f.run.input.messageId,quote:scenario==='quote'?'用户没说的话':scenario==='strict'?'总共只能生成一张':'一张图片'}};
   await expect(f.call('image_generate',{prompt:'brief',facts:[fact],params:{count:scenario==='strict'?2:1}},'bad-inline')).rejects.toBeDefined();
   await assertPreflight(f,'bad-inline','image.generate');
  }finally{await f.close();}
 });
 it('replays the exact successful historical default-normalized action before applying the new conflict guard',async()=>{
  const f=await setup('生成一张图片',{image:{mode:'auto',params:{resolution:'4K',aspectRatio:'16:9'}}});
  const catalogRead=vi.spyOn(effectiveCatalog,'getEffectiveCreativeMediaCatalog').mockRejectedValue(new Error('historical catalog withdrawn'));try{
   delete f.run.input.mediaAuthorizationVersion;await prisma.creativeAgentRun.update({where:{id:f.run.id},data:{input:f.run.input as any}});
   f.catalog.image=[];
   const raw={prompt:'historical brief',params:{resolution:'2K',aspectRatio:'3:4'}};
   const effective={...raw,params:{resolution:'4K',aspectRatio:'16:9'}};
   const requestHash=hash({args:effective,requirementsRevision:0});
   const actionId=creativeActionId(f.run.id,'image.generate',{matchingRequestHash:requestHash},'old');
   const actual={...effective,model:'gpt-image-2-openrouter',params:{...effective.params,count:1,quality:''},references:[]};
   await store.claimAction({...f.run,runId:f.run.id,actionId,kind:'image.generate',inputHash:hash(actual)});
   await store.completeAction(actionId,{runId:f.run.id,epoch:f.run.epoch,state:'succeeded',result:{generationId:12,status:'success',matchingReplay:{requestHash,args:actual}}});
   const result=await f.call('image_generate',raw,'historical-replay');
   expect((result.details as any).result).toMatchObject({generationId:12,status:'success',matchingReplay:{args:actual}});
   expect(f.dispatch).not.toHaveBeenCalled();expect(catalogRead).not.toHaveBeenCalled();expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id}})).toBe(0);
  }finally{catalogRead.mockRestore();await f.close();}
 });
 it('keeps an inline approved unknown outcome fenced against replay',async()=>{
  const f=await setup('生成一张图片');try{
   const args={prompt:'brief',facts:[{field:'image.quantity',value:1,strength:'hard',source:{kind:'message',sourceId:f.run.input.messageId,quote:'一张图片'}}]};
   await expect(f.call('image_generate',args)).rejects.toMatchObject({code:'run_deferred'});await f.approve();
   f.dispatch.mockImplementationOnce(async()=>{throw new CreativeAgentError('MEDIA_DISPATCH_UNKNOWN','uncertain');});
   await expect(f.call('image_generate',args)).rejects.toMatchObject({code:'MEDIA_DISPATCH_UNKNOWN'});
   const action=await prisma.creativeAgentAction.findFirstOrThrow({where:{runId:f.run.id,kind:'image.generate'}});expect(action.state).toBe('unknown');
   await expect(f.call('image_generate',args)).rejects.toBeDefined();expect(f.dispatch).toHaveBeenCalledTimes(1);
  }finally{await f.close();}
 });
 it.each(['cancel','revision'])('does not dispatch inline requirements on an exact approval %s answer',async answer=>{
  const f=await setup('生成一张图片');try{
   const args={prompt:'brief',facts:[{field:'image.quantity',value:1,strength:'hard',source:{kind:'message',sourceId:f.run.input.messageId,quote:'一张图片'}}]};
   await expect(f.call('image_generate',args)).rejects.toMatchObject({code:'run_deferred'});await f.approve(answer==='cancel'?'cancel':{revision:'背景改为米色'});
   const result=await f.call('image_generate',args);expect((result.details as any).result).toMatchObject(answer==='cancel'?{cancelled:true}:{revision:'背景改为米色'});expect(f.dispatch).not.toHaveBeenCalled();
  }finally{await f.close();}
 });
 it('accepts equivalent current catalog labels without changing the exact effective parameters',async()=>{
  const f=await setup('生成一张图片',{image:{mode:'auto',params:{resolution:'2K',aspectRatio:'3:4',quality:''}}});
  const catalog=structuredClone(f.catalog);catalog.image[0].params.resolutions=catalog.image[0].params.resolutions.map(option=>option.value==='2K'?{...option,label:'两千分辨率'}:option);
  const read=vi.spyOn(effectiveCatalog,'getEffectiveCreativeMediaCatalog').mockResolvedValue(catalog as any);
  try{
   await expect(f.call('image_generate',{prompt:'brief',params:{resolution:'两千分辨率',aspectRatio:'3:4'}})).rejects.toMatchObject({code:'run_deferred'});
   const saved=await store.getRun(f.run.id);expect(Object.values(saved.input.generationPlans!)[0].plan.steps[0].receipt?.request.params).toMatchObject({resolution:'2K',aspectRatio:'3:4',quality:''});expect(f.dispatch).not.toHaveBeenCalled();
  }finally{read.mockRestore();await f.close();}
 });
 it.each(['inline','plan'])('uses the same trusted shortcut for video, retaining numeric and boolean parameters: %s',async mode=>{
  const f=await setup('生成一条视频',{video:{mode:'auto',params:{duration:2,generateAudio:false}}});try{
   (f.catalog.video as any[]).push({...getVideoModelSpec(WAN_VIDEO_MODEL_ID),qualification:{available:true,reasons:[],entitlement:'unverified',providerId:'bailian',adapterId:WAN_VIDEO_MODEL_ID,routeConfigFingerprint:'fixture'}});
   const facts=[{field:'video.quantity',value:1,strength:'hard',source:{kind:'message',sourceId:f.run.input.messageId,quote:'一条视频'}}];
   let args:any={prompt:'slow rotating object',params:{inputMode:'text_to_video',duration:2,generateAudio:false},facts};
   if(mode==='plan'){
    const prepared=await f.call('generation_plan',{facts,steps:[{id:'v',role:'final',mediaType:'video',prompt:args.prompt,params:args.params}]});args={plan:{actionId:(prepared.details as any).actionId,stepId:'v'}};
   }
   await expect(f.call('video_generate',args)).rejects.toMatchObject({code:'run_deferred'});
   const saved=await store.getRun(f.run.id),receipt=Object.values(saved.input.generationPlans!)[0].plan.steps[0].receipt!;
   expect(receipt.request.params).toMatchObject({duration:2,generateAudio:false,inputMode:'text_to_video'});expect(f.dispatch).not.toHaveBeenCalled();
   await f.approve();await f.call('video_generate',args);expect(f.dispatch.mock.calls[0][0].args).toEqual(receipt.request);expect(f.dispatch).toHaveBeenCalledTimes(1);
  }finally{await f.close();}
 });
 it('executes a receipt-only plan reference, retaining explicit mismatch guards',async()=>{
  const f=await setup();try{
   const {planId,receipt}=await f.ready();const plan={actionId:planId,stepId:fixture.plan.steps[0].id};
   for(const extra of [{prompt:'different'},{params:{...receipt.request.params,resolution:'4K'}},{references:[{nodeId:'fake',semanticHash:'a'.repeat(64)}]}])await expect(f.call('image_generate',{plan,...extra})).rejects.toMatchObject({code:'SELECTION_RECEIPT_STALE'});
   await expect(f.call('image_generate',{plan})).rejects.toMatchObject({code:'run_deferred'});expect(f.dispatch).not.toHaveBeenCalled();
   await f.approve();await f.call('image_generate',{plan});expect(f.dispatch.mock.calls[0][0].args).toEqual(receipt.request);
   await expect(f.call('image_generate',{plan,prompt:'different after approval'})).rejects.toMatchObject({code:'SELECTION_RECEIPT_STALE'});expect(f.dispatch).toHaveBeenCalledTimes(1);
  }finally{await f.close();}
 });
 it.each(evidenceFixture.calls)('explains live source offset failures for $name, preserves authority, and accepts exact source repair',async sample=>{
  const f=await setup(evidenceFixture.text);try{
   const original=f.args(sample.arguments);
   await expect(f.call(sample.name,original,'bad-offset')).rejects.toThrow(/facts\[0\].*intent.*source.start\/end.*quote/);
   if(sample.name==='generation_plan')await assertPreflight(f,'bad-offset','generation.plan');
   else {
    const snapshot=await store.snapshot(actorUserId,f.run.canvasId,f.run.sessionId);
    if(!('activity' in snapshot))throw new Error('missing activity');
    expect(snapshot.activity.find(item=>item.event.payload.toolCallId==='bad-offset')?.event.payload).toMatchObject({status:'error',detail:{message:expect.stringContaining('source.start/end')}});
   }
   expect((await store.getRun(f.run.id)).input.requirements).toBeUndefined();
   const corrected=structuredClone(original);corrected.facts[0].source.end=77;
   await expect(f.call(sample.name,corrected,'bad-role')).rejects.toThrow(/facts\[2\].*generation.finalOutputs.*数量来源未明确授权/);
   expect((await store.getRun(f.run.id)).input.requirements).toBeUndefined();
   // Check just the original intent fact after repairing its source; this is not
   // acceptance of the still-invalid full plan or its fabricated call authority.
   const intent=structuredClone(corrected.facts[0]);delete intent.source.start;delete intent.source.end;
   await f.call('generation_requirements',{facts:[intent]},'fixed-source');
   expect((await store.getRun(f.run.id)).input.requirements?.facts[0].source).toMatchObject({start:59,end:77,quote:intent.source.quote});
   expect(f.dispatch).not.toHaveBeenCalled();expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id}})).toBe(0);
  }finally{await f.close();}
 });
 it('corrects a fabricated combined literal into independently quoted quantities and three final steps',async()=>{
  const text='生成咖啡店开业中文海报，两张蓝色和一张红色，三种不同构图，均为1:1、2K。';
  const f=await setup(text);try{
   const fact=(value:number,quote:string)=>({field:'image.quantity',value,strength:'hard',source:{kind:'message',sourceId:f.run.input.messageId,quote}});
   const steps=[1,2,3].map(index=>({...fixture.plan.steps[0],id:`poster-${index}`}));
   await expect(f.call('generation_plan',{facts:[fact(3,'两张蓝色和一张红色')],steps},'fabricated-total')).rejects.toThrow(/facts\[0\].*image.quantity.*分项/);
   await expect(f.call('generation_plan',{facts:[{...fact(3,'两张蓝色和一张红色，三种不同构图'),field:'generation.finalOutputs'}],steps},'wrong-three')).rejects.toThrow(/facts\[0\].*generation.finalOutputs/);
   const result=await f.call('generation_plan',{facts:[fact(2,'两张蓝色'),fact(1,'一张红色')],steps},'composed');
   const run=await store.getRun(f.run.id);
   expect(run.input.requirements?.facts.map(item=>item.value)).toEqual([2,1]);expect(run.input.requirements?.conflicts).toEqual([]);
   expect(run.input.requirements?.composedQuantities?.['image.quantity'].value).toBe(3);
   expect(generationAllowance(run.input)).toEqual({finalOutputs:3,intermediateOutputs:0,initialCalls:3,retryCalls:0});
   expect((result.details as any).result.plan.steps).toHaveLength(3);
   expect((result.details as any).result.plan.steps.every((step:any)=>step.role==='final'&&step.status==='ready')).toBe(true);
   expect(f.dispatch).not.toHaveBeenCalled();expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id}})).toBe(0);
  }finally{await f.close();}
 });
 it('keeps the real equal comma-list plan, both approval scopes, and durable reservations consistent',async()=>{
  const f=await setup(commaFixture.text);try{
   const result=await f.call('generation_plan',f.args(commaFixture.plan));const planId=(result.details as any).actionId;
   const saved=await store.getRun(f.run.id);expect(generationAllowance(saved.input)).toMatchObject({finalOutputs:2,initialCalls:2});
   expect(saved.input.requirements?.facts.filter(item=>item.field==='image.quantity').map(item=>item.value)).toEqual([1,1]);
   const steps=saved.input.generationPlans![planId].plan.steps;
   for(let index=0;index<2;index++){
    const step=steps[index],receipt=step.receipt!,args={...receipt.request,plan:{actionId:planId,stepId:step.id}};
    await expect(f.call('image_generate',args)).rejects.toMatchObject({code:'run_deferred'});
    const decision=await prisma.creativeAgentDecision.findFirstOrThrow({where:{runId:f.run.id,state:'pending'}});
    expect(decision.question).toContain('本轮交付 2 份');expect(decision.question).toContain('初次调用最多 2 次');
    expect((decision.binding as any).limits).toMatchObject({finalOutputs:2,initialCalls:2});
    await f.approve();const executed=await f.call('image_generate',args);expect(f.dispatch).toHaveBeenCalledTimes(index+1);
    const request={planId,stepId:step.id,receiptId:receipt.id,actionId:(executed.details as any).actionId,requestKeys:[`comma-key-${index}`],requestHash:hash(receipt.request)};
    await store.reserveGenerationStep(f.run,request);await store.transitionGenerationStep(f.run,request.requestKeys[0],'started');
    await store.reserveGenerationStep(f.run,request);await f.call('image_generate',args);
    expect(f.dispatch).toHaveBeenCalledTimes(index+1);expect((await store.getRun(f.run.id)).input.quantityLedger?.reservations).toHaveLength(index+1);
   }
   expect((await store.getRun(f.run.id)).input.quantityLedger?.reservations).toHaveLength(2);
  }finally{await f.close();}
 });
 it('does not ask approval for a whole plan exceeding verified quantity even when its first step fits',async()=>{
  const f=await setup('生成一张图片');try{
   const result=await f.call('generation_plan',{steps:[1,2].map(index=>({...fixture.plan.steps[0],id:`oversized-${index}`}))});
   const planId=(result.details as any).actionId,step=(result.details as any).result.plan.steps[0];
   await expect(f.call('image_generate',{...step.receipt.request,plan:{actionId:planId,stepId:step.id}},'oversized-plan')).rejects.toMatchObject({code:'QUANTITY_LIMIT'});
   await assertPreflight(f,'oversized-plan','image.generate');
  }finally{await f.close();}
 });
 it('explains a requirements audit ID is not a plan and durably exposes the rejected attempt',async()=>{
  const f=await setup();try{
   const requirements=await f.call('generation_requirements',f.args(fixture.requirements));
   const error=await f.call('image_generate',{...fixture.media,plan:{...fixture.media.plan,actionId:(requirements.details as any).actionId}},'wrong-plan').catch(error=>error);
   expect(error).toMatchObject({code:'SELECTION_RECEIPT_STALE'});expect(error.message).toContain('generation_plan');expect(error.message).toContain('省略 plan');
   await assertPreflight(f,'wrong-plan','image.generate');
   expect(await prisma.creativeAgentAction.count({where:{runId:f.run.id,kind:'image.generate'}})).toBe(0);
  }finally{await f.close();}
 });
 it('exposes invalid inline facts as preflight without turning ordinary outputs into call authority',async()=>{
  const f=await setup();try{
   await expect(f.call('generation_plan',f.args(fixture.invalidPlan),'invalid-facts')).rejects.toMatchObject({code:'invalid_requirement_source'});
   await assertPreflight(f,'invalid-facts','generation.plan');
   expect((await store.getRun(f.run.id)).input.requirements).toBeUndefined();
   expect(await prisma.creativeAgentAction.count({where:{runId:f.run.id}})).toBe(0);
  }finally{await f.close();}
 });
 it.each(['plan','offsetPlan'] as const)('keeps the complete real L1 facts and reuses empty defaults through approval: %s',async key=>{
  const f=await setup();try{
   const {planId,receipt}=await f.ready(fixture[key]);
   const state=await store.getRun(f.run.id);
   expect(state.input.requirements?.facts).toHaveLength(6);
   expect(generationAllowance(state.input)).toEqual({finalOutputs:1,intermediateOutputs:0,initialCalls:1,retryCalls:0});
   const both=state.input.requirements!.facts.filter(fact=>['image.quantity','generation.finalOutputs'].includes(fact.field));
   expect(both.map(fact=>fact.source.quote)).toEqual(['仅一张','仅一张']);
   expect(both[0].source.valueStart).toBe(both[1].source.valueStart);
   expect(receipt.request.params.quality).toBe('');
   const media={...fixture.media,plan:{...fixture.media.plan,actionId:planId}};
   await expect(f.call('image_generate',media)).rejects.toMatchObject({code:'run_deferred'});
   const pending=await store.snapshot(actorUserId,f.run.canvasId,f.run.sessionId);
   if(!('activity' in pending))throw new Error('missing pending activity');
   expect(pending.activity.find(item=>item.event.payload.name==='image.generate')?.event.payload.status).toBe('running');
   expect(f.dispatch).not.toHaveBeenCalled();await f.approve();
   await f.call('image_generate',media);
   expect(f.dispatch).toHaveBeenCalledTimes(1);expect(f.dispatch.mock.calls[0][0]).toMatchObject({args:receipt.request});
   const decisions=await prisma.creativeAgentDecision.findMany({where:{runId:f.run.id}});expect(decisions).toHaveLength(1);
  }finally{await f.close();}
 });
 it('keeps direct ordinary single-step preparation available without a plan round',async()=>{
  const f=await setup();try{
   await f.call('generation_requirements',f.args(fixture.requirements));
   const {plan:_plan,...media}=fixture.media;
   await expect(f.call('image_generate',media)).rejects.toMatchObject({code:'run_deferred'});
   expect(await prisma.creativeAgentAction.count({where:{runId:f.run.id,kind:'generation.plan'}})).toBe(0);
   expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id}})).toBe(1);expect(f.dispatch).not.toHaveBeenCalled();
  }finally{await f.close();}
 });
 it('persists a readable three-step prepared-plan summary without exposing its prompts or submitting media',async()=>{
  const f=await setup('准备3张图片方案，暂不生成');try{
   const args={...fixture.plan,facts:[{field:'image.quantity',value:3,strength:'hard',source:{kind:'message',sourceId:f.run.input.messageId,quote:'3张图片'}}],steps:[1,2,3].map(index=>({...fixture.plan.steps[0],id:`poster-${index}`}))};
   await f.call('generation_plan',args);
   for(let reload=0;reload<2;reload++){
    const snapshot=await new CreativeAgentStore(prisma).snapshot(actorUserId,f.run.canvasId,f.run.sessionId);
    if(!('activity' in snapshot))throw new Error('missing activity');
    const activity=snapshot.activity.filter(item=>item.event.payload.name==='generation.plan');expect(activity).toHaveLength(1);
    const detail=activity[0].event.payload.detail as any;
    expect(detail.message).toContain('3 个步骤');expect(detail.message).toContain('最终产物 3 步');expect(detail.message).toContain('3 步就绪');expect(detail.message).toContain('不会提交生成');
    expect(JSON.stringify(detail)).not.toContain(fixture.plan.steps[0].prompt);
   }
   expect(f.dispatch).not.toHaveBeenCalled();expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id}})).toBe(0);
  }finally{await f.close();}
 });
 it('retains distinct rejected attempts after the same plan succeeds and reloads without duplicates',async()=>{
  const f=await setup();try{
   const {planId}=await f.ready();
   const media={...fixture.media,plan:{...fixture.media.plan,actionId:planId}};
   for(const id of ['bad-first','bad-second'])await expect(f.call('image_generate',{...media,params:{...media.params,quality:'high'}},id)).rejects.toBeDefined();
   await expect(f.call('image_generate',media,'valid')).rejects.toMatchObject({code:'run_deferred'});
   await f.approve();await f.call('image_generate',media,'valid-recovered');
   for(let reload=0;reload<2;reload++){
    const snapshot=await new CreativeAgentStore(prisma).snapshot(actorUserId,f.run.canvasId,f.run.sessionId);
    if(!('activity' in snapshot))throw new Error('missing activity');
    const mediaEvents=snapshot.activity.filter(item=>item.event.payload.name==='image.generate');
    expect(mediaEvents).toHaveLength(3);
    expect(mediaEvents.filter(item=>item.event.payload.status==='error').map(item=>item.event.payload.toolCallId).sort()).toEqual(['bad-first','bad-second']);
    expect(mediaEvents.filter(item=>item.event.payload.status==='success')).toHaveLength(1);
    const view=applyAgentEvents(emptyAgentState(),mediaEvents.map(item=>item.event) as any,snapshot.run as any);
    expect(view.tools.filter(tool=>tool.status==='failed')).toHaveLength(2);
    expect(view.tools.filter(tool=>tool.status==='failed').every(tool=>Boolean(tool.detail)&&tool.outcomeLabel!=='结果待核实')).toBe(true);
   }
   expect(f.dispatch).toHaveBeenCalledTimes(1);
  }finally{await f.close();}
 });
 it.each(['quality','unknown','resolution','prompt','references','withdrawn'] as const)('rejects real receipt differences or withdrawn capabilities visibly: %s',async change=>{
  const f=await setup();try{
   const {planId,receipt}=await f.ready();
   const media:any={...fixture.media,params:{...receipt.request.params},plan:{...fixture.media.plan,actionId:planId}};
   if(change==='quality')media.params.quality='high';
   if(change==='unknown')media.params.unpublished='';
   if(change==='resolution')media.params.resolution='1K';
   if(change==='prompt')media.prompt+=' another object';
   if(change==='references')media.references=[{nodeId:'unknown',semanticHash:'a'.repeat(64)}];
   if(change==='withdrawn')f.catalog.image[0].params.resolutions=[];
   await expect(f.call('image_generate',media,'mismatch')).rejects.toBeDefined();
   await assertPreflight(f,'mismatch','image.generate');
   expect(await prisma.creativeAgentAction.count({where:{runId:f.run.id,kind:'image.generate'}})).toBe(0);
  }finally{await f.close();}
 });
 it.each(['generation.totalOutputs','generation.intermediateOutputs','generation.initialCalls','generation.retryCalls','generation.totalCalls'])('does not upgrade ordinary final quantity into %s',async field=>{
  const f=await setup();try{
   await expect(f.call('generation_requirements',{facts:[{...f.args(fixture.plan).facts.find((item:any)=>item.field==='generation.finalOutputs'),field}]})).rejects.toMatchObject({code:'invalid_requirement_source'});
  }finally{await f.close();}
 });
 it('does not equate an omitted quality with a nonempty receipt default',async()=>{
  const f=await setup();try{
   f.catalog.image[0].params.defaultQuality='high';f.catalog.image[0].params.qualities=[{value:'high',label:'High'}];
   const {planId,receipt}=await f.ready();expect(receipt.request.params.quality).toBe('high');
   await expect(f.call('image_generate',{...fixture.media,plan:{...fixture.media.plan,actionId:planId}},'nonempty-default')).rejects.toMatchObject({code:'SELECTION_RECEIPT_STALE'});
   await assertPreflight(f,'nonempty-default','image.generate');
  }finally{await f.close();}
 });
 it.each(['制作一张参考图','制作一张中间图片','总共生成一张图片'])('does not turn non-final source into final output authority: %s',async text=>{
  const f=await setup(text);try{
   await expect(f.call('generation_requirements',{facts:[{field:'generation.finalOutputs',value:1,strength:'hard',source:{kind:'message',sourceId:f.run.input.messageId,quote:text}}]})).rejects.toMatchObject({code:'invalid_requirement_source'});
  }finally{await f.close();}
 });
});
