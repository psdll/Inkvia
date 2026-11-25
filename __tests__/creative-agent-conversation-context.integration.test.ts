import { createAssistantMessageEventStream, type AssistantMessage, type Model, type Api } from "@earendil-works/pi-ai";
import { runCreativeAgent } from "@/lib/creative-agent/runner";
import { createCreativeTools } from "@/lib/creative-agent/tools";
import { prepareCreativeAgentMedia, executeCreativeAgentMediaTool, claimCreativeAgentMediaApproval } from "@/lib/creative-agent/media-broker";
import { getImageModelParams } from "@/lib/generation/image-model-params";
import { creativeAgentNodeHash } from "@/lib/creative-agent/canvas-tools";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { CreativeAgentStore } from "@/lib/creative-agent/store";
import { assertConversationReferenceVersions, emptyConversationContext, conversationMediaArgs } from "@/lib/creative-agent/conversation-context";
import { hash, type MessageInput } from "@/lib/creative-agent/store-types";
vi.mock("@/lib/creative-agent/access",()=>({requireCreativeAgentEnabled:vi.fn(),requireCreativeAgentCanvas:vi.fn()}));
const store=new CreativeAgentStore(prisma);
let actorUserId:number;
const refs=(canvasId:number)=>["1_80.png","1_103 拷贝.png","1_110 拷贝.png"].map((label,i)=>({canvasId,nodeId:`source-${i}`,label,kind:"image",semanticHash:String(i+1).repeat(64)}));
async function setup(){const canvasId=(await prisma.canvas.create({data:{authUserId:actorUserId,title:"R23 isolated"}})).id;const sessionId=randomUUID();await store.createSession(actorUserId,canvasId,sessionId);return {canvasId,sessionId};}
async function submit(scope:{canvasId:number;sessionId:string},overrides:Partial<MessageInput>={}){const input:MessageInput={actorUserId,...scope,messageId:randomUUID(),text:"需要一张海边背景图",baseRevision:"0",selection:{nodeIds:[],edgeIds:[],references:[]},...overrides};const accepted=await store.enqueue(input);const run=await store.claimRun("r23-test",60_000);expect(run?.id).toBe(accepted.run.id);return {input,run:run!,finish:()=>store.finish(run!.id,run!.epoch,"completed")};}
async function completeMedia(run:Awaited<ReturnType<typeof submit>>["run"],actionId:string,overrides:Record<string,unknown>={},state:"succeeded"|"unknown"="succeeded"){
 const references=conversationMediaArgs(run,{prompt:"同一产品海边"}).references??[];
 const result={status:"running",generationId:99,selectionReceipt:{referenceVersions:references.map((ref:any)=>({nodeId:ref.nodeId,contentVersion:"f".repeat(64)})),request:{model:"visible",prompt:"同一产品，高端海边，暖光",params:{resolution:"2K",aspectRatio:"3:4",count:1},references}},mediaRequest:{args:{prompt:"同一产品海边",references}},...overrides};
 await store.claimAction({...run,runId:run.id,actionId,kind:"image.generate",inputHash:hash(result)});
 await store.completeAction(actionId,{runId:run.id,epoch:run.epoch,state,result});return result;
}
describe.skipIf(process.env.CREATIVE_AGENT_DB_TEST!=="1")("R23 durable conversation context",()=>{
 beforeAll(async()=>{actorUserId=(await prisma.user.create({data:{username:`r23-${randomUUID()}`,password:"fixture"}})).id;});
 afterAll(async()=>{if(actorUserId)await prisma.user.delete({where:{id:actorUserId}});await prisma.$disconnect();});
 it("freezes skill and three source identities, keeps latest actual request separately, and isolates new sessions",async()=>{
  const scope=await setup();let turn=await submit(scope,{text:"一张家庭背景图",selectedSkillId:"personal:21"});expect(turn.run.input.text).toBe("一张家庭背景图");await turn.finish();
  const originals=refs(scope.canvasId);turn=await submit(scope,{text:"根据这三张图生成一个家庭背景图，需要高端的家庭",selection:{nodeIds:originals.map(r=>r.nodeId),edgeIds:[],references:originals}});expect(turn.run.input.conversationContext?.skillId).toBe("personal:21");await completeMedia(turn.run,"home");await turn.finish();
  turn=await submit(scope);expect(turn.run.input.conversationContext?.referenceAnchor?.references).toEqual(originals);expect(turn.run.input.conversationContext?.latestRequestActionId).toBe("home");expect(conversationMediaArgs(turn.run,{prompt:"同一产品在海边"}).references).toHaveLength(3);await completeMedia(turn.run,"sea");await turn.finish();
  turn=await submit(scope,{text:"换成夜景"});expect(turn.run.input.conversationContext?.latestRequestActionId).toBe("sea");expect(await store.getReferenceHistory(turn.run)).toContain("高端海边，暖光");expect((await store.getSession(actorUserId,scope.canvasId,scope.sessionId)).activeSkillId).toBe("personal:21");await turn.finish();
  const fresh=randomUUID();await store.createSession(actorUserId,scope.canvasId,fresh);const next=await submit({...scope,sessionId:fresh});expect(next.run.input.conversationContext).toEqual(emptyConversationContext());await next.finish();
 });
 it("keeps first frozen selection on duplicate messageId after later swap/clear and rejects changed intent",async()=>{
  const scope=await setup();const first=await submit(scope,{selectedSkillId:"personal:21"});await first.finish();
  const swap=await submit(scope,{selectedSkillId:"system:3"});await swap.finish();
  expect((await store.enqueue(first.input)).run.input.conversationContext?.skillId).toBe("personal:21");
  await expect(store.enqueue({...first.input,selectedSkillId:null})).rejects.toMatchObject({code:"message_id_conflict"});
  const clear=await submit(scope,{selectedSkillId:null});await clear.finish();const next=await submit(scope);expect(next.run.input.conversationContext?.skillId).toBeNull();await next.finish();
 });
 it("recovers only scoped legacy actual user commands/references once and clear tombstone wins",async()=>{
  const scope=await setup();const first=await submit(scope,{text:"/skill:personal:21 一张图",selection:{nodeIds:[],edgeIds:[],references:refs(scope.canvasId)}});await first.finish();
  await prisma.$executeRawUnsafe('UPDATE "CreativeAgentSession" SET creation_context=NULL,transcript=$2::jsonb WHERE id=$1',scope.sessionId,JSON.stringify([{role:"assistant",content:"/skill:system:999",timestamp:1}]));
  const recovery=await submit(scope);expect(recovery.run.input.conversationContext?.skillId).toBe("personal:21");expect(recovery.run.input.conversationContext?.referenceAnchor?.references).toHaveLength(3);await recovery.finish();
  const clear=await submit(scope,{selectedSkillId:null,referenceMode:"clear"});await clear.finish();const next=await submit(scope);expect(next.run.input.conversationContext).toEqual(emptyConversationContext());await next.finish();
 });
 it("pins prepared uploads once, rejects clear-with-refs, and replaces rather than accumulating old refs",async()=>{
  const scope=await setup();const old=await submit(scope,{selection:{nodeIds:[],edgeIds:[],references:refs(scope.canvasId)}});await old.finish();
  const fresh=await submit(scope,{attachments:[{id:randomUUID()}]});const replacement=[{...refs(scope.canvasId)[0],nodeId:"replacement"}];
  const prepared=await store.savePreparedReferences(fresh.run.id,fresh.run.epoch,{nodeIds:["replacement"],edgeIds:[],references:replacement},"1");expect(prepared.input.conversationContext?.referenceAnchor?.references).toEqual(replacement);await fresh.finish();
  const next=await submit(scope);expect(next.run.input.conversationContext?.referenceAnchor?.references).toEqual(replacement);await next.finish();
  await expect(store.enqueue({...next.input,messageId:randomUUID(),referenceMode:"clear",selection:{nodeIds:[],edgeIds:[],references:replacement}})).rejects.toMatchObject({code:"reference_selection_conflict"});
 });
 it("commits grounded no-product/new-subject clear and never revives product on subsequent turns",async()=>{
  const scope=await setup();const old=await submit(scope,{selection:{nodeIds:[],edgeIds:[],references:refs(scope.canvasId)}});await completeMedia(old.run,randomUUID());await old.finish();
  const clear=await submit(scope,{text:"不要产品，只要纯海景"});const source={kind:"message",sourceId:clear.input.messageId,quote:clear.input.text};
  await completeMedia(clear.run,"pure",{conversationSubject:{mode:"clear",source},selectionReceipt:{request:{model:"visible",prompt:"纯海景",params:{resolution:"2K"},references:[]}}});await clear.finish();
  const next=await submit(scope,{text:"换成夜景"});expect(next.run.input.conversationContext?.referenceAnchor).toBeNull();expect(next.run.input.conversationContext?.latestRequestActionId).toBe("pure");expect(conversationMediaArgs(next.run,{prompt:"夜景"}).references).toBeUndefined();await next.finish();
 });
 it("never promotes preflight/unknown plans; actual submitted failure remains latest request without retry",async()=>{
  const scope=await setup();const old=await submit(scope);await completeMedia(old.run,"proven");await old.finish();
  const rejected=await submit(scope);await completeMedia(rejected.run,"preflight",{generationId:undefined,rejectedBeforeDispatch:true});await rejected.finish();
  const unknown=await submit(scope);expect(unknown.run.input.conversationContext?.latestRequestActionId).toBe("proven");await completeMedia(unknown.run,"unknown",{},"unknown");await unknown.finish();
  const failed=await submit(scope);expect(failed.run.input.conversationContext?.latestRequestActionId).toBe("proven");await completeMedia(failed.run,"submitted-failed",{status:"failed"});await failed.finish();
  const next=await submit(scope);expect(next.run.input.conversationContext?.latestRequestActionId).toBe("submitted-failed");expect(await store.getReferenceHistory(next.run)).toContain('"receiptStatus":"failed"');await next.finish();
 });
 it("legacy home-source versions survive a newer sea request that omitted all references",async()=>{
  const scope=await setup();const originals=refs(scope.canvasId);const home=await submit(scope,{text:"/skill:personal:21 家庭背景",selection:{nodeIds:[],edgeIds:[],references:originals}});await completeMedia(home.run,"legacy-home");await home.finish();
  const sea=await submit(scope);await completeMedia(sea.run,"legacy-sea",{selectionReceipt:{referenceVersions:[],request:{model:"visible",prompt:"海边",params:{resolution:"2K"},references:[]}}});await sea.finish();
  await prisma.$executeRawUnsafe('UPDATE "CreativeAgentSession" SET creation_context=NULL WHERE id=$1',scope.sessionId);
  const night=await submit(scope,{text:"换成夜景"});expect(night.run.input.conversationContext?.latestRequestActionId).toBe("legacy-sea");expect(night.run.input.conversationContext?.referenceAnchor?.runId).toBe(home.run.id);expect(night.run.input.conversationContext?.referenceAnchor?.referenceVersions).toEqual(originals.map(ref=>({nodeId:ref.nodeId,contentVersion:"f".repeat(64)})));await night.finish();
 });
 it("binds all three inherited originals through real tools/broker with current fixed params, no question and no stale-node/content rebind",async()=>{
  const scope=await setup();let nodes:any[]=refs(scope.canvasId).map(ref=>({id:ref.nodeId,type:"image",position:{x:0,y:0},data:{kind:"image",url:`/uploads/${ref.nodeId}.png`,mediaId:ref.nodeId}}));
  const originals=refs(scope.canvasId).map((ref,i)=>({...ref,semanticHash:creativeAgentNodeHash(nodes[i]),mediaId:ref.nodeId}));
  const preferences:any={image:{mode:"explicit",model:"gpt-image-2-openrouter",params:{resolution:"2K",aspectRatio:"3:4"}}};
  let contentVersion="f".repeat(64);
  const provider=vi.fn(async(request:any)=>{const row=await prisma.generation.create({data:{authUserId:actorUserId,canvasId:scope.canvasId,source:"agent",type:"image_edit",model:request.model,prompt:request.prompt,requestKey:request.requestKey,status:"running",templateData:JSON.stringify(request)}});return {generationId:row.id,status:"running"};});
  const catalog={image:[{id:"gpt-image-2-openrouter",label:"Fixture visible image",params:{...getImageModelParams("gpt-image-2-openrouter"),defaultQuality:""},qualification:{available:true,reasons:[],entitlement:"unverified",providerId:"openrouter",adapterId:"gpt-image-2-openrouter",routeConfigFingerprint:"fixture"}}],video:[]};
  const deps:any={catalog:async()=>catalog,readCanvas:async()=>({revision:"0",nodes,edgeIds:[]}),bindReference:async(_i:any,_n:any,ref:any)=>({...ref,facts:{state:"verified",kind:"image",contentVersion,width:1024,height:1024,sizeBytes:1000,detectedMime:"image/png"}}),claimApproval:claimCreativeAgentMediaApproval,createImage:provider,findGeneration:async(q:any)=>prisma.generation.findFirst({where:q}),beforeDispatch:async(i:any)=>store.assertFence(i.runId,i.epoch),markDispatchStarted:async(i:any,key:string)=>store.transitionGenerationStep({id:i.runId,epoch:i.epoch,actorUserId,canvasId:scope.canvasId},key,"started"),finalize:vi.fn(),attach:vi.fn()};
  const call=(run:any,prompt:string)=>createCreativeTools(run,store,input=>executeCreativeAgentMediaTool(input,deps),input=>prepareCreativeAgentMedia(input,deps)).find(t=>t.name==="image_generate")!.execute(randomUUID(),{prompt});
  const home=await submit(scope,{text:"用这三张产品图生成一张高端家庭背景图",preferences,selection:{nodeIds:originals.map(ref=>ref.nodeId),edgeIds:[],references:originals}});await call(home.run,"三图同一产品，高端家庭，暖光");await home.finish();
  const sea=await submit(scope,{text:"需要一张海边背景图",preferences});await call(sea.run,"三图同一产品，保留外观和暖光，场景改成海边");await sea.finish();
  expect(provider).toHaveBeenCalledTimes(2);const actions=await store.actionReceipts(sea.run.id);const receipt=actions.find(action=>action.kind==="image.generate")!.result.selectionReceipt;
  expect(receipt.request.references.map((ref:any)=>ref.nodeId)).toEqual(originals.map(ref=>ref.nodeId));expect(receipt.request.params).toMatchObject({resolution:"2K",aspectRatio:"3:4",count:1});expect(receipt.request.model).toBe("gpt-image-2-openrouter");expect(await prisma.creativeAgentDecision.count({where:{runId:sea.run.id}})).toBe(0);
  const changed=await submit(scope,{text:"需要一张夜景背景图",preferences});nodes=nodes.slice(1);await expect(call(changed.run,"三图同产品夜景")).rejects.toMatchObject({code:"REFERENCE_CHANGED"});expect(provider).toHaveBeenCalledTimes(2);await changed.finish();
  nodes=originals.map(ref=>({id:ref.nodeId,type:"image",position:{x:0,y:0},data:{kind:"image",url:`/uploads/${ref.nodeId}.png`,mediaId:ref.nodeId}}));contentVersion="e".repeat(64);const contentChanged=await submit(scope,{text:"需要一张夜景背景图",preferences});await expect(call(contentChanged.run,"三图同产品夜景")).rejects.toMatchObject({code:"REFERENCE_CHANGED"});expect(provider).toHaveBeenCalledTimes(2);await contentChanged.finish();
 });
 it("retains latest request for unchanged selected sources and document-only attachments; explicit combine deduplicates",async()=>{
  const scope=await setup(),originals=refs(scope.canvasId);const first=await submit(scope,{selection:{nodeIds:[],edgeIds:[],references:originals}});await completeMedia(first.run,"retained-settings");await first.finish();
  const same=await submit(scope,{selection:{nodeIds:[],edgeIds:[],references:originals}});expect(same.run.input.conversationContext?.latestRequestActionId).toBe("retained-settings");await same.finish();
  const doc=await submit(scope,{attachments:[{id:randomUUID()}]});const prepared=await store.savePreparedReferences(doc.run.id,doc.run.epoch,{nodeIds:[],edgeIds:[],references:[]},"1");expect(prepared.input.conversationContext?.latestRequestActionId).toBe("retained-settings");expect(prepared.input.conversationContext?.referenceAnchor?.references).toEqual(originals);await doc.finish();
  const combine=await submit(scope,{referenceMode:"combine",selection:{nodeIds:[],edgeIds:[],references:[originals[0],{...originals[1],nodeId:"new-source"}]}});expect(combine.run.input.conversationContext?.referenceAnchor?.references).toHaveLength(4);expect(conversationMediaArgs(combine.run,{prompt:"合并产品"}).references).toHaveLength(4);await combine.finish();
 });
 it.each(["selection", "upload"] as const)("retains inherited content versions through %s combine and rejects changed originals before dispatch",async(mode)=>{
  const scope=await setup(),originals=refs(scope.canvasId).slice(0,1);
  const first=await submit(scope,{selection:{nodeIds:[],edgeIds:[],references:originals}});await completeMedia(first.run,randomUUID());await first.finish();
  const added={...refs(scope.canvasId)[1],nodeId:"new-source"};
  const combined=await submit(scope,{referenceMode:"combine",...(mode==="upload"?{attachments:[{id:randomUUID()}]}:{selection:{nodeIds:[added.nodeId],edgeIds:[],references:[added]}})});
  const current=mode==="upload"?await store.savePreparedReferences(combined.run.id,combined.run.epoch,{nodeIds:[added.nodeId],edgeIds:[],references:[added]},"1"):combined.run;
  const anchor=current.input.conversationContext!.referenceAnchor!;
  expect(anchor.references).toEqual([...originals,added]);
  const stored=await store.getRun(current.id);
  const changedReceipt={referenceVersions:[{nodeId:originals[0].nodeId,contentVersion:"e".repeat(64)},{nodeId:added.nodeId,contentVersion:"d".repeat(64)}]} as any;
  expect(()=>assertConversationReferenceVersions(stored,changedReceipt)).toThrowError(expect.objectContaining({code:"REFERENCE_CHANGED"}));
  expect(anchor.referenceVersions).toEqual([{nodeId:originals[0].nodeId,contentVersion:"f".repeat(64)}]);
  const execute=vi.fn(async()=>({})),prepare=vi.fn(async()=>({media:{selectionReceipt:changedReceipt}} as any));
  const tool=createCreativeTools(stored,store,execute,prepare).find(tool=>tool.name==="image_generate")!;
  await expect(tool.execute(randomUUID(),{prompt:"合并两个产品"})).rejects.toMatchObject({code:"REFERENCE_CHANGED"});
  expect(prepare).toHaveBeenCalledTimes(1);expect(execute).not.toHaveBeenCalled();
  expect(await store.actionReceipts(current.id)).toEqual([]);expect(await prisma.generation.count({where:{canvasId:scope.canvasId}})).toBe(0);await combined.finish();
  const next=await submit(scope);expect(next.run.input.conversationContext?.referenceAnchor?.referenceVersions).toEqual(anchor.referenceVersions);await next.finish();
 });
 it.each(["selection", "upload"] as const)("keeps intentional %s replacement unbound when the reference group changes",async(mode)=>{
  const scope=await setup(),originals=refs(scope.canvasId).slice(0,1);
  const first=await submit(scope,{selection:{nodeIds:[],edgeIds:[],references:originals}});await completeMedia(first.run,randomUUID());await first.finish();
  const replacements=[...originals,{...refs(scope.canvasId)[1],nodeId:"replacement"}];
  const replacement=await submit(scope,mode==="upload"?{attachments:[{id:randomUUID()}]}:{selection:{nodeIds:[],edgeIds:[],references:replacements}});
  const current=mode==="upload"?await store.savePreparedReferences(replacement.run.id,replacement.run.epoch,{nodeIds:[],edgeIds:[],references:replacements},"1"):replacement.run;
  expect(current.input.conversationContext?.referenceAnchor?.references).toEqual(replacements);
  expect(current.input.conversationContext?.referenceAnchor?.referenceVersions).toBeUndefined();
  expect(()=>assertConversationReferenceVersions(current,{referenceVersions:[{nodeId:originals[0].nodeId,contentVersion:"e".repeat(64)}]} as any)).not.toThrow();await replacement.finish();
 });
 it("refreshes same-run model context after grounded requirements clear without redispatch",async()=>{
  const scope=await setup();const original=await submit(scope,{selection:{nodeIds:[],edgeIds:[],references:refs(scope.canvasId)}});await completeMedia(original.run,randomUUID());await original.finish();
  const turn=await submit(scope,{text:"不要旧产品，只先准备纯背景方案，不生成"}),execute=vi.fn(async()=>({}));
  const model:Model<Api>={id:"offline",name:"offline",provider:"local",api:"openai-completions",baseUrl:"http://unused.invalid",reasoning:false,input:["text"],contextWindow:32000,maxTokens:100,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
  const contexts:string[]=[];
  const stream=vi.fn((_model,context)=>{
   contexts.push(context.systemPrompt);const first=contexts.length===1,output=createAssistantMessageEventStream();
   const message:AssistantMessage={role:"assistant",content:first?[{type:"toolCall",id:"grounded-clear",name:"generation_requirements",arguments:{facts:[],subject:{mode:"clear",source:{kind:"message",sourceId:turn.input.messageId,quote:turn.input.text}}}}]:[{type:"text",text:"纯背景方案已准备"}],api:model.api,provider:model.provider,model:model.id,stopReason:first?"toolUse":"stop",timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
   queueMicrotask(()=>{output.push({type:"start",partial:message});output.push({type:"done",reason:first?"toolUse":"stop",message});});return output;
  });
  await runCreativeAgent(turn.run,{store,model,stream,tools:createCreativeTools(turn.run,store,execute),advancePlan:async()=>"complete"});
  expect(stream).toHaveBeenCalledTimes(2);expect(execute).not.toHaveBeenCalled();
  expect(contexts[0]).toContain('"nodeId":"source-0"');expect(contexts[0]).toContain("同一产品，高端海边");
  expect(contexts[1]).not.toContain('"nodeId":"source-0"');expect(contexts[1]).not.toContain("同一产品，高端海边");expect(contexts[1]).not.toContain('"latestRequest":');expect(contexts[1]).toContain('"referenceAnchor":null');
  expect((await store.getRun(turn.run.id)).input.conversationContext).toEqual(emptyConversationContext());
  const completed=await prisma.creativeAgentEvent.findMany({where:{runId:turn.run.id,type:"tool.completed"}});
  expect(completed.map(event=>event.payload)).toEqual([expect.objectContaining({name:"generation.requirements",status:"success"})]);
  expect(await store.actionReceipts(turn.run.id)).toEqual([]);
  expect(await prisma.generation.count({where:{canvasId:scope.canvasId}})).toBe(0);
 });
 it("records explicit preparation-only subject clear through the requirements tool without dispatch or old-scene revival",async()=>{
  const scope=await setup();const first=await submit(scope,{selection:{nodeIds:[],edgeIds:[],references:refs(scope.canvasId)}});await completeMedia(first.run,"before-preparation-clear");await first.finish();
  const turn=await submit(scope,{text:"不要旧产品，只先准备纯背景方案，不生成"});const execute=vi.fn(async()=>({}));
  const tool=createCreativeTools(turn.run,store,execute).find(tool=>tool.name==="generation_requirements")!;
  await tool.execute(randomUUID(),{facts:[],subject:{mode:"clear",source:{kind:"message",sourceId:turn.input.messageId,quote:turn.input.text}}});
  expect(execute).not.toHaveBeenCalled();const current=await store.getRun(turn.run.id);expect(current.input.conversationContext?.referenceAnchor).toBeNull();expect(current.input.conversationContext?.latestRequestActionId).toBeNull();
  expect(await prisma.generation.count({where:{canvasId:scope.canvasId}})).toBe(0);await turn.finish();
  const next=await submit(scope,{text:"执行刚才的纯背景方案"});expect(conversationMediaArgs(next.run,{prompt:"纯背景"}).references).toBeUndefined();expect(await store.getConversationContext(next.run)).not.toContain("高端海边");await next.finish();
 });
 it("persists grounded plan scope without treating an unexecuted plan as latest submitted request",async()=>{
  const module=await import("@/lib/creative-agent/generation-plan"),build=module.createCreativeGenerationPlan;
  const planBuilder=vi.spyOn(module,"createCreativeGenerationPlan").mockImplementation(input=>build(input,{catalog:async()=>({image:[],video:[]}),readCanvas:async()=>({revision:"0",nodes:[],edgeIds:[]})} as any));
  try {
   const scope=await setup();const first=await submit(scope,{selection:{nodeIds:[],edgeIds:[],references:refs(scope.canvasId)}});await completeMedia(first.run,"before-plan-clear");await first.finish();
   const turn=await submit(scope,{text:"不要旧产品，只先准备纯背景方案，不生成"});const execute=vi.fn(async()=>({}));const tool=createCreativeTools(turn.run,store,execute).find(tool=>tool.name==="generation_plan")!;
   await tool.execute(randomUUID(),{subject:{mode:"clear",source:{kind:"message",sourceId:turn.input.messageId,quote:turn.input.text}},steps:[{id:"background",role:"final",mediaType:"image",prompt:"纯背景",params:{},references:[],dependsOn:[]}]});
   const current=await store.getRun(turn.run.id);expect(Object.keys(current.input.generationPlans??{})).toHaveLength(1);expect(current.input.conversationContext?.referenceAnchor).toBeNull();expect(current.input.conversationContext?.latestRequestActionId).toBeNull();expect(execute).not.toHaveBeenCalled();expect(await prisma.generation.count({where:{canvasId:scope.canvasId}})).toBe(0);await turn.finish();
   const next=await submit(scope,{text:"执行刚才方案"});expect(conversationMediaArgs(next.run,{prompt:"纯背景"}).references).toBeUndefined();await next.finish();
  } finally {planBuilder.mockRestore();}
 });
 it("scopes receipt pointers and sessions to actor/canvas instead of trusting an arbitrary action ID",async()=>{
  const a=await setup(),b=await setup();const first=await submit(a);await completeMedia(first.run,"other-canvas");await first.finish();
  const next=await submit(b);await expect(store.getConversationContext({...next.run,input:{...next.run.input,conversationContext:{...emptyConversationContext(),latestRequestActionId:"other-canvas"}}})).rejects.toMatchObject({code:"CONVERSATION_CONTEXT_INVALID"});await next.finish();
  await expect(store.enqueue({...first.input,messageId:randomUUID(),canvasId:b.canvasId})).rejects.toMatchObject({code:"session_not_found"});
 });
});
