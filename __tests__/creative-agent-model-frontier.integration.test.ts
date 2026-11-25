import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const io=vi.hoisted(()=>({resolve:vi.fn(),fetch:vi.fn(),begin:vi.fn(),finish:vi.fn()}));
vi.mock('@/lib/creative-agent/access',()=>({requireCreativeAgentEnabled:vi.fn(),requireCreativeAgentCanvas:vi.fn()}));
vi.mock('@/lib/maintenance',async importOriginal=>({...await importOriginal<typeof import('@/lib/maintenance')>(),assertDurableWorkAdmission:vi.fn(),backgroundJobsAllowed:()=>true}));
vi.mock('@/lib/creative-agent/model-catalog',()=>({resolveCreativeAgentModel:io.resolve,creativeAgentSupportsVision:()=>true}));
vi.mock('@/lib/providers/transport',()=>({fetchWithProviderEgress:io.fetch}));
vi.mock('@/lib/billing/llm',()=>({beginLlmCost:io.begin,finishLlmCost:io.finish}));
vi.mock('@/lib/creative-agent/debug-store',()=>({appendDebugEvent:vi.fn(),pruneDebugRecords:vi.fn()}));
vi.mock('@/lib/creative-agent/media-delivery',()=>({reconcileCreativeAgentMedia:vi.fn(async()=>0)}));
import prisma from '@/lib/prisma';
import {creativeAgentStore as store} from '@/lib/creative-agent/store';
import {createCreativeAgentModelStream} from '@/lib/creative-agent/llm-broker';
import {runCreativeAgent} from '@/lib/creative-agent/runner';
import {runCreativeAgentWorkerTick} from '@/lib/creative-agent/worker';
import {hash,type Run} from '@/lib/creative-agent/store-types';
const route={scenarioId:'agent.chat',providerId:'fixture',providerName:'fixture',modelId:'fixture-model',protocol:'openai-chat',source:'configured',status:'ready',url:'http://not-used.invalid/chat',apiKey:'fixture',timeoutMs:10000,egressDecision:{providerId:'fixture',mode:'direct'}};
const selected={providerId:'fixture',modelId:'fixture-model'};
const enabled=process.env.CREATIVE_AGENT_DB_TEST==='1';
let actorUserId:number,canvasId:number;
const scope=(run:Run)=>({actorUserId,canvasId,runId:run.id,epoch:run.epoch,options:run.input});
const context=(run:Run)=>({systemPrompt:'R10 system fixture',messages:[{role:'user' as const,content:run.input.text,timestamp:Date.parse(run.createdAt)}],tools:[{name:'canvas_read',description:'R10 tool description',parameters:{type:'object',properties:{}}}] as any});
async function started(){const queued=await store.enqueue({actorUserId,canvasId,messageId:randomUUID(),text:'只写正文',baseRevision:'0',selection:{nodeIds:[],edgeIds:[],references:[]},model:selected});const run=await store.claimRun('frontier-first',60000);expect(run?.id).toBe(queued.run.id);return run!;}
async function call(run:Run,ctx=context(run)){const model=await createCreativeAgentModelStream(scope(run));return model.stream(model.model,ctx).result();}
async function reclaim(run:Run){await prisma.creativeAgentRun.update({where:{id:run.id},data:{leaseExpiresAt:new Date(Date.now()-1000)}});await store.recoverExpired();await store.control(run.id,actorUserId,randomUUID(),'resume');const newer=await store.claimRun('frontier-next',60000);expect(newer?.id).toBe(run.id);return newer!;}
async function stop(run:Run){const current=await store.getRun(run.id);if(!['completed','failed','stopped'].includes(current.status))await store.control(run.id,actorUserId,randomUUID(),'stop');}

describe.skipIf(!enabled)('durable model frontier across host code versions (injected provider, real PG)',()=>{
 beforeAll(async()=>{actorUserId=(await prisma.user.create({data:{username:'model-frontier-'+randomUUID(),password:'fixture-only'}})).id;});
 beforeEach(async()=>{
  vi.restoreAllMocks();io.resolve.mockReset().mockResolvedValue({status:'ready',route});io.fetch.mockReset().mockImplementation(async()=>Response.json({choices:[{message:{content:'saved answer',reasoning_details:[{type:'reasoning.text',text:'saved thinking',signature:'original-signature'}],encrypted_content:'original-encrypted'},finish_reason:'stop'}],usage:{prompt_tokens:11,completion_tokens:7,total_tokens:18}}));
  io.begin.mockReset().mockImplementation(async(input:any,tx:any)=>({...(await tx.usageLedger.create({data:{userId:String(actorUserId),authUserId:actorUserId,module:'llm',source:'agent.chat',model:input.model,status:'pending',unitType:'token'}})),snapshot:{}}));io.finish.mockReset().mockResolvedValue(undefined);
  canvasId=(await prisma.canvas.create({data:{authUserId:actorUserId,title:'frontier test',data:{schemaVersion:2,mode:'smart',nodes:[],edges:[],viewport:{x:0,y:0,zoom:1},settings:{snapToGrid:false,gridSize:20}}}})).id;
 });
 afterAll(async()=>{vi.restoreAllMocks();if(actorUserId){await prisma.usageLedger.deleteMany({where:{authUserId:actorUserId}});await prisma.user.delete({where:{id:actorUserId}});}await prisma.$disconnect();});
 it.each([false,true])('replays successful receipt after transcript write failure into a new worker (hidden=%s)',async hidden=>{
  const run=await started(),model=await createCreativeAgentModelStream(scope(run));
  const save=store.saveTranscript.bind(store);const saveSpy=vi.spyOn(store,'saveTranscript').mockImplementation(async(id,epoch,messages)=>{if(messages.some((m:any)=>m.role==='assistant'))throw new Error('injected transcript commit failure');return save(id,epoch,messages);});
  const finishSpy=vi.spyOn(store,'finish').mockResolvedValue(undefined); // process dies before runner can record its terminal state
  await expect(runCreativeAgent(run,{store,model:model.model,tools:[],stream:(m,ctx,options)=>model.stream(m,{...ctx,systemPrompt:'R10 system fixture',tools:context(run).tools},options)})).rejects.toThrow();
  saveSpy.mockRestore();finishSpy.mockRestore();
  const journal=await store.actionReceipts(run.id);expect(journal).toHaveLength(1);expect(journal[0].state).toBe('succeeded');
  expect((await store.getTranscript(run.sessionId)).at(-1)).toMatchObject({role:'user'});
  const oldBody=JSON.parse(io.fetch.mock.calls[0][2].body);expect(oldBody.messages[0].content).toBe('R10 system fixture');
  await prisma.creativeAgentRun.update({where:{id:run.id},data:{leaseExpiresAt:new Date(Date.now()-1000)}});await store.recoverExpired();await store.control(run.id,actorUserId,randomUUID(),'resume');
  if(hidden)io.resolve.mockResolvedValue({status:'model-disabled'});
  await runCreativeAgentWorkerTick();
  for(let i=0;i<400;i++){if(['completed','failed'].includes((await store.getRun(run.id)).status))break;await new Promise(r=>setTimeout(r,10));}
  expect(await store.getRun(run.id)).toMatchObject({status:'completed',error:null});
  expect(io.fetch).toHaveBeenCalledOnce();expect(io.begin).toHaveBeenCalledOnce();expect(io.finish).toHaveBeenCalledOnce();
  expect(await store.actionReceipts(run.id)).toHaveLength(1);
  expect((await store.getTranscript(run.sessionId)).at(-1)).toEqual(journal[0].result);
  expect(journal[0].result).toMatchObject({creativeEncryptedContent:'original-encrypted',creativeReasoningDetails:[{signature:'original-signature'}],creativeUsage:{callId:journal[0].id}});
  expect(await prisma.usageLedger.count({where:{authUserId:actorUserId,requestKey:journal[0].id}})).toBe(1);
 });
 it('same-code replay and host tools changes keep identity; an advanced full transcript dispatches exactly once',async()=>{
  let run=await started();const first=await call(run);expect(first.stopReason).toBe('stop');run=await reclaim(run);
  const changed={...context(run),systemPrompt:'R11 system',tools:[{name:'new_host_tool',description:'new schema',parameters:{type:'object'}}] as any};
  expect(await call(run,changed)).toEqual(first);expect(await call(run,changed)).toEqual(first);expect(io.fetch).toHaveBeenCalledOnce();
  const advanced:any={...changed,messages:[...changed.messages,first,{role:'user',content:'继续第二步',timestamp:Date.parse(run.createdAt)+1}]};
  expect((await call(run,advanced)).stopReason).toBe('stop');expect(io.fetch).toHaveBeenCalledTimes(2);
  expect(await call(run,advanced)).toMatchObject({stopReason:'stop'});expect(io.begin).toHaveBeenCalledTimes(2);await stop(run);
 });
 it('does not dispatch a changed-code call after an unknown mapped receipt',async()=>{
  const run=await started();io.fetch.mockRejectedValueOnce(new Error('connection lost after submission'));expect((await call(run)).stopReason).toBe('error');
  const changed={...context(run),systemPrompt:'new system'};expect((await call(run,changed)).stopReason).toBe('error');expect(io.fetch).toHaveBeenCalledOnce();expect(io.begin).toHaveBeenCalledOnce();expect((await store.actionReceipts(run.id))[0].state).toBe('unknown');await stop(run);
 });
 it.each(['succeeded','unknown','ambiguous'] as const)('fails closed for unproven legacy %s journals without a frontier map',async state=>{
  const run=await started();
  for(let i=0;i<(state==='ambiguous'?2:1);i++){
   const actionId=randomUUID();await store.claimAction({...scope(run),actionId,kind:'model.chat',inputHash:hash('old-body-'+i)});
   await store.completeAction(actionId,{runId:run.id,epoch:run.epoch,state:state==='unknown'?'unknown':'succeeded',result:{role:'assistant',api:'openai-completions',provider:selected.providerId,model:selected.modelId,content:[{type:'text',text:'old'}],stopReason:'stop'}});
  }
  expect((await call(run,{...context(run),systemPrompt:'R11 body'})).stopReason).toBe('error');expect(io.fetch).not.toHaveBeenCalled();expect(io.begin).not.toHaveBeenCalled();await stop(run);
 });
 it('persists the original body hash and keeps generic input conflicts strict',async()=>{
  const run=await started();await call(run);const saved=(await store.actionReceipts(run.id))[0];
  const original=await store.getAction(saved.id);const body=JSON.parse(io.fetch.mock.calls[0][2].body);
  expect(original.inputHash).toBe(hash({provider:selected.providerId,model:selected.modelId,body}));
  expect(Object.values((await store.getRun(run.id)).input.modelFrontiers!)).toEqual([{actionId:saved.id,inputHash:original.inputHash}]);
  await call(run,{...context(run),systemPrompt:'changed host system',tools:[]});
  expect((await store.getAction(saved.id)).inputHash).toBe(original.inputHash);
  await expect(store.claimAction({...scope(run),actionId:saved.id,kind:'model.chat',inputHash:hash('changed')})).rejects.toMatchObject({code:'action_id_conflict'});
  expect(io.fetch).toHaveBeenCalledOnce();await stop(run);
 });
 it('dispatches the next paired tool step once, retaining original tool identity on replay',async()=>{
  const run=await started();io.fetch.mockResolvedValueOnce(Response.json({choices:[{message:{content:null,tool_calls:[{id:'original-tool-id',type:'function',function:{name:'canvas_read',arguments:'{}'}}]},finish_reason:'tool_calls'}]}));
  const first=await call(run);expect(first.stopReason).toBe('toolUse');
  const changed={...context(run),systemPrompt:'replacement',tools:[{...context(run).tools[0],description:'new host description'}]};
  expect(await call(run,changed)).toEqual(first);
  const next:any={...changed,messages:[...changed.messages,first,{role:'toolResult',toolCallId:'original-tool-id',toolName:'canvas_read',content:[{type:'text',text:'empty canvas'}],isError:false,timestamp:2}]};
  const second=await call(run,next);expect(second.stopReason).toBe('stop');expect(await call(run,next)).toEqual(second);expect(io.fetch).toHaveBeenCalledTimes(2);expect(io.begin).toHaveBeenCalledTimes(2);await stop(run);
 });
 it('permits legacy continuation only when the exact prior result is already consumed',async()=>{
  const run=await started(),actionId=randomUUID();const result={role:'assistant',api:'openai-completions',provider:selected.providerId,model:selected.modelId,content:[{type:'text',text:'old'}],stopReason:'stop',creativeUsage:{callId:actionId}};
  await store.claimAction({...scope(run),actionId,kind:'model.chat',inputHash:hash('legacy')});await store.completeAction(actionId,{runId:run.id,epoch:run.epoch,state:'succeeded',result});
  const forged:any={...context(run),messages:[...context(run).messages,{...result,content:[{type:'text',text:'changed'}]}]};
  expect((await call(run,forged)).stopReason).toBe('error');expect(io.fetch).not.toHaveBeenCalled();
  expect((await call(run,{...context(run),messages:[...context(run).messages,result]} as any)).stopReason).toBe('stop');expect(io.fetch).toHaveBeenCalledOnce();await stop(run);
 });
 it('blocks a new frontier while a prior mapped claim is still in flight',async()=>{
  const run=await started();let release!:(response:Response)=>void;let entered!:()=>void;const reached=new Promise<void>(resolve=>{entered=resolve;});
  io.fetch.mockImplementationOnce(()=>{entered();return new Promise<Response>(resolve=>{release=resolve;});});
  const first=call(run);await reached;
  const other:any={...context(run),messages:[{...context(run).messages[0],content:'different frontier'}]};
  expect((await call(run,other)).stopReason).toBe('error');expect((await call(run,{...context(run),systemPrompt:'new code'})).stopReason).toBe('error');expect(io.fetch).toHaveBeenCalledOnce();
  release(Response.json({choices:[{message:{content:'done'},finish_reason:'stop'}]}));await first;await stop(run);
 });
 it('adds direct authorization only to fresh enqueue; duplicate and revise do not upgrade a legacy run',async()=>{
  const run=await started();expect(run.input.mediaAuthorizationVersion).toBe(1);
  const {mediaAuthorizationVersion:_version,...legacy}=run.input;await prisma.creativeAgentRun.update({where:{id:run.id},data:{input:legacy as any}});
  const duplicate=await store.enqueue(legacy);expect(duplicate.duplicate).toBe(true);expect(duplicate.run.input.mediaAuthorizationVersion).toBeUndefined();
  await store.reviseMessage(actorUserId,canvasId,{runId:run.id,messageId:run.input.messageId,requestId:randomUUID(),expectedText:run.input.text,text:'new legacy revision'});
  expect((await store.getRun(run.id)).input.mediaAuthorizationVersion).toBeUndefined();await stop(run);
 });
 it('retains stale epoch and scope fencing before any frontier replay or dispatch',async()=>{
  const old=await started();await call(old);const current=await reclaim(old);
  expect((await call(old)).stopReason).toBe('error');
  const wrong=await createCreativeAgentModelStream({...scope(current),canvasId:canvasId+1});expect((await wrong.stream(wrong.model,context(current)).result()).stopReason).toBe('error');expect(io.fetch).toHaveBeenCalledOnce();
  await store.reviseMessage(actorUserId,canvasId,{runId:current.id,messageId:current.input.messageId,requestId:randomUUID(),expectedText:current.input.text,text:'新的文字要求'});
  const next=(await store.claimRun('revised-frontier',60000))!;expect(next.input.revision).toBe(1);expect((await call(next)).stopReason).toBe('stop');expect(io.fetch).toHaveBeenCalledTimes(2);await stop(next);
 });
});
