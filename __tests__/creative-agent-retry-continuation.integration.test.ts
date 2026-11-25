import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { CreativeAgentStore } from '@/lib/creative-agent/store';
import { createCreativeTools } from '@/lib/creative-agent/tools';
import { executeCreativeAgentMediaTool, executeCreativeAgentMediaRetry } from '@/lib/creative-agent/media-broker';
import { hash, type MessageInput, type Run } from '@/lib/creative-agent/store-types';
import { generationAllowance } from '@/lib/creative-agent/quantity';
import { getImageModelParams } from '@/lib/generation/image-model-params';
import { applyCanvasOperations } from '@/lib/canvas/operations';
import { createEmptyCanvasDocumentV2 } from '@/lib/canvas/document';
// Only transport/media I/O is injected: actions, approvals, plans, ledgers and
// Generation rows use the isolated PostgreSQL store and production broker.
const io = vi.hoisted(() => ({ nodes: [] as any[], create: vi.fn(), revision: 0 }));
vi.mock('@/lib/creative-agent/access', () => ({ requireCreativeAgentEnabled: vi.fn(), requireCreativeAgentCanvas: vi.fn() }));
vi.mock('@/lib/creative-agent/effective-media-catalog', () => ({ getEffectiveCreativeMediaCatalog: async () => ({ image: [{ id:'gpt-image-2-openrouter',label:'Fixture',params:getImageModelParams('gpt-image-2-openrouter'),qualification:{available:true,reasons:[],entitlement:'unverified',providerId:'openrouter',adapterId:'gpt-image-2-openrouter',routeConfigFingerprint:'fixture'} }],video:[] }) }));
vi.mock('@/lib/creative-agent/canvas-tools', async original => ({ ...await original<any>(), readCreativeAgentCanvas: async () => ({revision:String(io.revision),nodes:io.nodes,edgeIds:[]}) }));
vi.mock('@/lib/creative-agent/reference-facts', () => ({ bindCreativeReferenceFacts: async (_input:any,_node:any,ref:any) => ({...ref,facts:{state:'verified',kind:'image',contentVersion:'b'.repeat(64),width:1024,height:1024}}) }));
vi.mock('@/lib/generation/image-service', () => ({ createImageGeneration: io.create }));
vi.mock('@/lib/generation/video-service', () => ({ createVideoGeneration: vi.fn(() => { throw new Error('Unexpected video'); }) }));
vi.mock('@/lib/generation/finalize', () => ({ finalizeGeneration: vi.fn(), recoverStaleProcessingGeneration: vi.fn() }));
vi.mock('@/lib/creative-agent/media-output', () => ({ readCreativeAgentMediaSize: async () => undefined }));
vi.mock('@/lib/canvas/generation-media', () => ({ getOrCreateGenerationMediaAsset: async (_client:any,row:any) => ({mediaId:randomUUID(),url:row.localPath}) }));
vi.mock('@/lib/canvas/mutation-service', () => ({ submitCanvasMutation: async ({input,actorUserId,canvasId}:any) => { io.nodes=applyCanvasOperations({...createEmptyCanvasDocumentV2(),nodes:io.nodes},input.operations).nodes; const revision=++io.revision; await prisma.canvasMutation.create({data:{actorUserId,canvasId,clientMutationId:input.clientMutationId,clientSequence:0,baseRevision:BigInt(input.baseRevision),revision:BigInt(revision),protocolVersion:1,payloadHash:hash(input),operations:input.operations,touchedPaths:[]}}); return {revision:String(revision)}; } }));
const store = new CreativeAgentStore(prisma);
let actorUserId:number,canvasId:number;
const generationIds:number[]=[];
const selection={nodeIds:[],edgeIds:[],references:[]};
async function start(text:string,overrides:Partial<MessageInput>={}) {
 const queued=await store.enqueue({actorUserId,canvasId,messageId:randomUUID(),text,baseRevision:'0',selection,...overrides});
 const run=await store.claimRun('retry-continuation',60_000);expect(run?.id).toBe(queued.run.id);return run!;
}
const tool=(run:Run,name:string,owner=store)=>createCreativeTools(run,owner,executeCreativeAgentMediaTool).find(t=>t.name===name)!;
describe.skipIf(process.env.CREATIVE_AGENT_DB_TEST!=='1')('durable authorized retry continuation',()=>{
 beforeAll(async()=>{actorUserId=(await prisma.user.create({data:{username:'retry-'+randomUUID(),password:'fixture-only'}})).id;});
 beforeEach(async()=>{
  canvasId=(await prisma.canvas.create({data:{authUserId:actorUserId,title:'Retry continuation fixture'}})).id;io.nodes=[];io.revision=0;io.create.mockReset();
  io.create.mockImplementation(async(request:any)=>{
   const retry=io.create.mock.calls.length>1;
   const row=await prisma.generation.create({data:{authUserId:actorUserId,canvasId,source:'agent',type:'image_edit',model:request.model,prompt:request.prompt,requestKey:request.requestKey,status:retry?'success':'failed',errorMsg:retry?null:'429 Too Many Requests',localPath:retry?'/uploads/retry-success.png':null,templateData:JSON.stringify(request)}});
   generationIds.push(row.id);
   return {generationId:row.id,status:row.status};
  });
 });
 afterAll(async()=>{if(actorUserId){await prisma.generation.deleteMany({where:{id:{in:generationIds}}});await prisma.canvasMutation.deleteMany({where:{actorUserId}});await prisma.user.delete({where:{id:actorUserId}});}await prisma.$disconnect();});
 it.each(['valid','forged-parent','foreign-parent','unrelated-parent','forged-output','forged-retry-key','changed-params','changed-contract'])('uses the successful retry own durable output after restart: %s',async scenario=>{
  let run=await start('生成一张海报，允许重试1次',{preferences:{image:{mode:'auto',params:{aspectRatio:'1:1',resolution:'2K'}}}});
  try {
   await tool(run,'generation_requirements').execute('retry-limit',{facts:[{field:'generation.retryCalls',value:1,strength:'hard',source:{kind:'message',sourceId:run.input.messageId,quote:'允许重试1次'}}]});
   const args={prompt:'海报',references:[]};
   await expect(tool(run,'image_generate').execute('original',args)).rejects.toMatchObject({code:'run_deferred'});
   const decision=await prisma.creativeAgentDecision.findFirstOrThrow({where:{runId:run.id}});
   await store.answerDecision(decision.id,actorUserId,randomUUID(),decision.proposalHash,'approve');
   run=(await store.claimRun('retry-approved',60_000))!;
   await tool(run,'image_generate').execute('original',args)
   const parent=await store.getAction(decision.actionId),saved=parent.result as any,failedId=saved.generationIds[0];
   expect((await prisma.generation.findUniqueOrThrow({where:{id:failedId}})).status).toBe('failed');
   const retried=await executeCreativeAgentMediaRetry({actorUserId,canvasId,runId:run.id,epoch:run.epoch,actionId:parent.id,kind:'image.generate',args:saved.mediaRequest.args},failedId);
   expect(retried).toMatchObject({status:'success',retryOfGenerationId:failedId});expect(io.create).toHaveBeenCalledTimes(2);
   const child=await prisma.creativeAgentAction.findFirstOrThrow({where:{runId:run.id,id:{not:parent.id},kind:'image.generate'}});
   const node=io.nodes[0],batch=node.data.task.batches.at(-1),output=batch.outputs[0];
   const reference={nodeId:node.id,semanticHash:hash({id:node.id,data:node.data}),batchId:batch.id,outputId:output.id,generationId:output.generationId};
   await store.finish(run.id,run.epoch,'completed');
   const prior=run;
   run=await start('只改这一张背景为米色，其他不变',{sessionId:prior.sessionId,preferences:{image:{mode:'auto',params:{aspectRatio:'16:9',resolution:'1K'}}}});
   if(scenario==='forged-parent')await prisma.creativeAgentAction.update({where:{id:child.id},data:{result:{...child.result as any,retryParentActionId:randomUUID()}}});
   if(scenario==='foreign-parent')await prisma.creativeAgentAction.update({where:{id:parent.id},data:{canvasId:canvasId+100000}});
   if(scenario==='unrelated-parent'){
    const unrelated=await prisma.creativeAgentAction.create({data:{id:randomUUID(),runId:prior.id,actorUserId,canvasId,epoch:prior.epoch,kind:'image.generate',inputHash:parent.inputHash,state:'succeeded',result:{...saved,generationIds:[]}}});
    await prisma.creativeAgentAction.update({where:{id:child.id},data:{result:{...child.result as any,retryParentActionId:unrelated.id}}});
   }
   if(scenario==='forged-output'){
    const unrelated=await prisma.generation.create({data:{authUserId:actorUserId,canvasId,source:'agent',type:'image_edit',model:saved.mediaRequest.args.model,prompt:'unrelated',status:'success',localPath:'/uploads/retry-success.png',templateData:JSON.stringify({...saved.mediaRequest.args.params,agentOutputContract:{receiptId:saved.selectionReceipt.id}})}});
    generationIds.push(unrelated.id);
    await prisma.creativeAgentAction.update({where:{id:child.id},data:{result:{...child.result as any,generationIds:[unrelated.id]}}});
   }
   if(scenario==='forged-retry-key')await prisma.generation.update({where:{id:Number(retried!.generationId)},data:{requestKey:randomUUID()}});
   if(scenario==='changed-params'||scenario==='changed-contract'){
    const row=await prisma.generation.findUniqueOrThrow({where:{id:Number(retried!.generationId)}}),data=JSON.parse(row.templateData!);
    if(scenario==='changed-params')data.aspectRatio='16:9';else data.agentOutputContract.receiptId='forged';
    await prisma.generation.update({where:{id:row.id},data:{templateData:JSON.stringify(data)}});
   }
   const restarted=new CreativeAgentStore(prisma),current=await restarted.getRun(run.id);
   const bind={facts:[],continuation:{directive:{kind:'message',sourceId:run.input.messageId,quote:run.input.text},targets:[{sourceActionId:child.id,reference}]}};
   if(scenario!=='valid')await expect(tool(current,'generation_requirements',restarted).execute('continue',bind)).rejects.toBeDefined();
   else {
    await tool(current,'generation_requirements',restarted).execute('continue',bind);
    const restored=await restarted.getRun(run.id);
    expect(restored.input.requirements!.continuation!.targets[0]).toMatchObject({sourceActionId:child.id,generationId:retried!.generationId,params:{aspectRatio:'1:1',resolution:'2K'}});
    expect(generationAllowance(restored.input)).toMatchObject({finalOutputs:1,initialCalls:1,retryCalls:0});expect(restored.input.quantityLedger).toBeUndefined();
    await expect(tool(restored,'image_generate',restarted).execute('edit',{prompt:run.input.text,references:[reference]})).rejects.toMatchObject({code:'run_deferred'});
    const next=await prisma.creativeAgentDecision.findFirstOrThrow({where:{runId:run.id}});
    expect(next.binding).toMatchObject({retryLimit:0,limits:{finalOutputs:1,retryCalls:0}});
    expect((await restarted.getDecision(next.id)).media!.params).toMatchObject({aspectRatio:'1:1',resolution:'2K',count:1});expect(io.create).toHaveBeenCalledTimes(2);
   }
  }finally{if(run)await store.control(run.id,actorUserId,randomUUID(),'stop');}
 });
});
