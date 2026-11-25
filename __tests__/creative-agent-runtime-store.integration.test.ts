import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAssistantMessageEventStream, type AssistantMessage, type Model, type Api } from "@earendil-works/pi-ai";
import type { AgentMessage, StreamFn } from "@earendil-works/pi-agent-core";
import prisma from "@/lib/prisma";
import { CreativeAgentStore } from "@/lib/creative-agent/store";
import { CreativeAgentError } from "@/lib/creative-agent/errors";
import { hash, type MessageInput, type Run } from "@/lib/creative-agent/store-types";
import { createCreativeTools, creativeActionId } from "@/lib/creative-agent/tools";
import { runCreativeAgent, resumeCompletedCreativeAgentTurn, repairPendingToolResults } from "@/lib/creative-agent/runner";

// Explicitly injected local transport. These tests prove durable runtime behavior,
// not provider entitlement, creative quality, billing, or real generation success.
vi.mock("@/lib/creative-agent/access", () => ({ requireCreativeAgentEnabled: vi.fn(), requireCreativeAgentCanvas: vi.fn() }));
const enabled = process.env.CREATIVE_AGENT_DB_TEST === "1";
const store = new CreativeAgentStore(prisma);
let actorUserId: number;
let canvasId: number;
const selection = { nodeIds: [], edgeIds: [], references: [] };
function input(overrides: Partial<MessageInput> = {}): MessageInput { return { actorUserId, canvasId, messageId: randomUUID(), text: "创建故事大纲", baseRevision: "0", selection, ...overrides }; }
async function started(overrides: Partial<MessageInput> = {}) { const queued = await store.enqueue(input(overrides)); const run = await store.claimRun("test-worker", 60_000); // Historical approval/cancellation fixtures deliberately retain the pre-direct contract.
 expect(run?.id).toBe(queued.run.id); delete run!.input.mediaAuthorizationVersion; await prisma.creativeAgentRun.update({where:{id:run!.id},data:{input:run!.input as any}}); return run!; }
const model: Model<Api> = { id: "injected-test", name: "Injected test only", provider: "test", api: "openai-completions", baseUrl: "http://not-used.invalid", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage { return { role: "assistant", content, stopReason, api: model.api, model: model.id, provider: model.provider, timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }; }
function scripted(messages: AssistantMessage[]) { return vi.fn<StreamFn>(() => { const output = createAssistantMessageEventStream(); const message = messages.shift(); if (!message) throw new Error("unexpected model invocation"); queueMicrotask(() => { output.push({ type: "start", partial: message }); if (message.stopReason === "error" || message.stopReason === "aborted") output.push({ type: "error", reason: message.stopReason, error: message }); else output.push({ type: "done", reason: message.stopReason, message }); }); return output; }); }

async function reviewTransportFixture() {
  const catalog = await import("@/lib/creative-agent/model-catalog");
  const transport = await import("@/lib/providers/transport");
  const billing = await import("@/lib/billing/llm");
  const singleton = (await import("@/lib/creative-agent/store")).creativeAgentStore;
  const route: any = { scenarioId: "agent.chat", providerId: "test", providerName: "fixture", modelId: "injected-test", protocol: "openai-chat", source: "configured", status: "ready", url: "https://not-called.invalid", apiKey: "fixture", timeoutMs: 1000, egressDecision: { providerId: "test", mode: "direct" } };
  const resolve = vi.spyOn(catalog, "resolveCreativeAgentModel").mockResolvedValue({ status: "ready", route });
  const fetch = vi.spyOn(transport, "fetchWithProviderEgress").mockImplementation(async () => Response.json({ choices: [{ message: { content: "已保存的原始回答" }, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } }));
  const ledgerIds: number[] = [];
  const begin = vi.spyOn(billing, "beginLlmCost").mockImplementation(async (_input, tx) => {
    const ledger = await (tx ?? prisma).usageLedger.create({ data: { userId: "task5-review-fixture", authUserId: actorUserId, module: "llm", source: "agent.chat", model: "injected-test", status: "pending", unitType: "token" } });
    ledgerIds.push(ledger.id); return { id: ledger.id, snapshot: {} } as any;
  });
  const settle = vi.spyOn(billing, "finishLlmCost").mockResolvedValue(undefined as any);
  return { singleton, resolve, fetch, route, async restore() { resolve.mockRestore(); fetch.mockRestore(); begin.mockRestore(); settle.mockRestore(); await prisma.usageLedger.deleteMany({ where: { id: { in: ledgerIds } } }); } };
}

// Run only with the existing isolated p0 policy/env loaded; never connects by default.
describe.skipIf(!enabled)("creative Agent durable runtime in the existing Prisma database", () => {
  beforeAll(async () => { actorUserId = (await prisma.user.create({ data: { username: `creative-runtime-test-${randomUUID()}`, password: "not-a-login-fixture" } })).id; });
  beforeEach(async () => { canvasId = (await prisma.canvas.create({ data: { authUserId: actorUserId, title: "Creative runtime test fixture" } })).id; });
  afterAll(async () => { if (actorUserId) { await prisma.user.delete({ where: { id: actorUserId } }); expect(await prisma.creativeAgentSession.count({ where: { actorUserId } })).toBe(0); expect(await prisma.creativeAgentRequest.count({ where: { actorUserId } })).toBe(0); await prisma.$disconnect(); } });

  it("sends the host policy after an expanded long selected skill in the actual runner with one model call", async () => {
    const repository=await import('@/lib/role-skills/repository');
    const body='保持素材连续。先询问默认型号，引用内部阶段编号。\n'.repeat(2000);
    const read=vi.spyOn(repository,'readRoleSkillDocument').mockResolvedValue({id:'system:3',name:'Long workflow',source:'system',revision:5,primaryPath:'SKILL.md',path:'SKILL.md',files:['SKILL.md'],content:body} as any);
    const validate=vi.spyOn(repository,'assertRoleSkillRevision').mockResolvedValue(undefined as any);
    const run=await started({text:'/skill:system:3\n只做文字方案和完成摘要'});
    try {
      const stream=scripted([assistant([{type:'text',text:'已完成文字方案。'}])]);
      await runCreativeAgent(run,{store,model,stream,tools:createCreativeTools(run,store,vi.fn())});
      expect(stream).toHaveBeenCalledTimes(1);
      const context=stream.mock.calls[0][1];
      const user=context.messages.find(message=>message.role==='user')!;
      const text=typeof user.content==='string'?user.content:JSON.stringify(user.content);
      expect(text).toContain(body.trim());
      expect(text.indexOf('当前宿主执行约束')).toBeGreaterThan(text.indexOf('--- 技能正文结束 ---'));
      expect(text).toContain('普通回复和后续建议');expect(text).toContain('真实缺项');
      expect(text.lastIndexOf('只做文字方案和完成摘要')).toBeGreaterThan(text.indexOf('当前宿主执行约束'));
      expect(read).toHaveBeenCalledTimes(1);
    }finally{read.mockRestore();validate.mockRestore();const current=await store.getRun(run.id);if(current.status!=='completed')await store.control(run.id,actorUserId,randomUUID(),'stop');}
  });

  it.each(['auto','explicit'] as const)('keeps selected-skill host authority in the final system section across real review continuation (%s)', async mode => {
    const repository=await import('@/lib/role-skills/repository');
    const {creativeAgentChatMessages}=await import('@/lib/creative-agent/llm-stream');
    const {reviewCreativeArtifact}=await import('@/lib/creative-agent/artifact-review');
    const body='先确认目标模型。只交文字也在完成摘要列出下一轮模型确认前置条件。\n'.repeat(2000);
    const read=vi.spyOn(repository,'readRoleSkillDocument').mockResolvedValue({id:'system:3',name:'Long workflow',source:'system',revision:5,primaryPath:'SKILL.md',path:'SKILL.md',files:['SKILL.md'],content:body} as any);
    const validate=vi.spyOn(repository,'assertRoleSkillRevision').mockResolvedValue(undefined as any);
    const video=mode==='auto'?{mode:'auto' as const}:{mode:'explicit' as const,model:'saved-visible-model'};
    const run=await started({text:'/skill:system:3\n只做文字方案和完成摘要，不进入生成。',preferences:{video},thinkingLevel:'default'});
    try {
      const first=assistant([{type:'thinking',thinking:'完整供应商思考，不得删除。'},{type:'toolCall',id:'timeline',name:'artifact_review',arguments:{totalDuration:15,segments:[{id:'one',start:0,end:15,prompt:'文字分镜',references:[]}]}}],'toolUse');
      Object.assign(first,{creativeReasoningDetails:[{type:'reasoning.text',text:'完整结构化思考',signature:'fixture-signature'}],creativeEncryptedContent:'fixture-encrypted'});
      const stream=scripted([first,assistant([{type:'text',text:'已完成文字方案。'}])]);
      const execute=vi.fn(async request=>{expect(request.kind).toBe('artifact.review');return reviewCreativeArtifact(request.args,[]);});
      await runCreativeAgent(run,{store,model,stream,tools:createCreativeTools(run,store,execute),readProjectContext:async()=>({constraints:['fixture-project-context: 下轮先确认目标模型']})});
      expect(stream).toHaveBeenCalledTimes(2);expect(execute).toHaveBeenCalledTimes(1);
      for(const [,context] of stream.mock.calls){
        const wire=creativeAgentChatMessages(context,{providerId:model.provider,modelId:model.id});
        expect(wire[0].role).toBe('system');
        const system=String(wire[0].content), index=system.indexOf('本轮所选技能的系统执行边界');
        expect(index).toBeGreaterThan(system.indexOf('fixture-project-context'));
        const tail=system.slice(index);
        expect(tail).toContain('文字交付完成即结束');
        expect(tail).toContain('不得附加下一轮制作的待确认清单');
        expect(tail).toContain('只有用户要求下一步');
        expect(tail).toContain('按当前可用能力自动匹配');
        expect(tail).toContain('具体生成方案');
        expect(tail).toContain(JSON.stringify({image:{mode:'auto'},video}));
        const user=wire.find(message=>message.role==='user')!;
        expect(JSON.stringify(user.content)).toContain(body.trim().split('\n')[0]);
        const raw=context.messages.find(message=>message.role==='user')!;
        expect(typeof raw.content==='string'?raw.content:JSON.stringify(raw.content)).toContain(body.trim());
      }
      const secondWire=creativeAgentChatMessages(stream.mock.calls[1][1],{providerId:model.provider,modelId:model.id});
      expect(secondWire.find(message=>message.role==='assistant')).toMatchObject({reasoning_details:[{type:'reasoning.text',text:'完整结构化思考',signature:'fixture-signature'}],encrypted_content:'fixture-encrypted'});
      expect(stream.mock.calls[1][1].messages.find(message=>message.role==='assistant')).toMatchObject({content:expect.arrayContaining([{type:'thinking',thinking:'完整供应商思考，不得删除。'}])});
      expect(secondWire.some(message=>message.role==='tool'&&message.tool_call_id==='timeline')).toBe(true);
      expect((await store.getRun(run.id)).input.thinkingLevel).toBe('default');
      expect(read).toHaveBeenCalledTimes(1);expect(validate).toHaveBeenCalledTimes(2);
    }finally{read.mockRestore();validate.mockRestore();const current=await store.getRun(run.id);if(current.status!=='completed')await store.control(run.id,actorUserId,randomUUID(),'stop');}
  });

  it('keeps unselected-skill system assembly unchanged',async()=>{
    const {buildCreativeSystemPrompt}=await import('@/lib/creative-agent/skills');
    const run=await started({text:'只做文字方案。'});
    const stream=scripted([assistant([{type:'text',text:'文字方案。'}])]);
    const recovery=await store.getRecoveryContext(run), history=await store.getReferenceHistory(run);
    await runCreativeAgent(run,{store,model,stream,tools:createCreativeTools(run,store,vi.fn())});
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0][1].systemPrompt).toBe([buildCreativeSystemPrompt(await store.getRun(run.id)),recovery,history].filter(Boolean).join('\n\n'));
    expect(stream.mock.calls[0][1].systemPrompt).not.toContain('本轮所选技能的系统执行边界');
  });

  it.each(['main','reference','recovered','list','failed','mention','previous'] as const)('scopes system skill authority to real successful current-turn reads: %s',async scenario=>{
    const repository=await import('@/lib/role-skills/repository');
    const body='真实技能正文：先选默认型号。'.repeat(1000);
    const read=vi.spyOn(repository,'readRoleSkillDocument').mockResolvedValue({id:'system:3',name:'Workflow',source:'system',revision:5,primaryPath:'SKILL.md',path:scenario==='reference'?'references/example.md':'SKILL.md',files:['SKILL.md','references/example.md'],content:body} as any);
    const list=vi.spyOn(repository,'listRoleSkillsForUser').mockResolvedValue([{id:'system:3',name:'Workflow',source:'system',revision:5,summary:'method'}] as any);
    if(scenario==='failed')read.mockRejectedValue(new Error('fixture unavailable'));
    let run=await started({text:'只交文字。提及 skillOperator read 不表示已加载技能。'});
    const args={action:scenario==='list'?'list':'read',...(scenario==='list'?{}:{skillId:'system:3'}),...(scenario==='reference'?{path:'references/example.md',revision:5}:{})};
    const call=assistant([{type:'toolCall',id:'read-skill',name:'skillOperator',arguments:args}],'toolUse');
    try{
      if(scenario==='recovered'||scenario==='previous'){
        const result=await createCreativeTools(run,store,vi.fn()).find(t=>t.name==='skillOperator')!.execute('read-skill',args);
        await store.saveTranscript(run.id,run.epoch,[{role:'user',content:run.input.text,timestamp:Date.parse(run.createdAt)},call,...(scenario==='previous'?[{role:'toolResult' as const,toolCallId:'read-skill',toolName:'skillOperator',...result,isError:false,timestamp:Date.now()}]:[])]);
        if(scenario==='recovered'){
          await store.control(run.id,actorUserId,randomUUID(),'pause');await store.control(run.id,actorUserId,randomUUID(),'resume');run=(await store.claimRun('skill-read-recovered',60_000))!;
        }else{await store.finish(run.id,run.epoch,'completed');run=await started({sessionId:run.sessionId,text:'只回答新的普通问题，不使用之前技能。'});}
      }
      const stream=scripted([...(['recovered','mention','previous'].includes(scenario)?[]:[call]),assistant([{type:'text',text:'文字交付完成。'}])]);
      await runCreativeAgent(run,{store,model,stream,tools:createCreativeTools(run,store,vi.fn()),readProjectContext:async()=>({constraints:['end-of-project-context']})});
      const expected=['main','reference','recovered'].includes(scenario);
      const last=stream.mock.calls.at(-1)![1];
      const system=last.systemPrompt??'';
      expect(system.includes('本轮所选技能的系统执行边界')).toBe(expected);
      if(expected){
        expect(system.indexOf('本轮所选技能的系统执行边界')).toBeGreaterThan(system.indexOf('end-of-project-context'));
        expect(JSON.stringify(last.messages)).toContain(body);
        expect(read).toHaveBeenCalledTimes(1);
      }
      if(['main','reference','list','failed'].includes(scenario)){
        expect(stream).toHaveBeenCalledTimes(2);expect(stream.mock.calls[0][1].systemPrompt).not.toContain('本轮所选技能的系统执行边界');
      }else expect(stream).toHaveBeenCalledTimes(1);
      if(scenario==='mention')expect(read).not.toHaveBeenCalled();
    }finally{read.mockRestore();list.mockRestore();await store.control(run.id,actorUserId,randomUUID(),'stop').catch(()=>undefined);}
  });

  it('preserves conditional requirement schemas in the actual provider wire without coercion',async()=>{
    const {validateToolArguments}=await import('@earendil-works/pi-ai');
    const f=await reviewTransportFixture();const run=await started({model:{providerId:'test',modelId:'injected-test'}});
    try{
      const {createCreativeAgentModelStream}=await import('@/lib/creative-agent/llm-broker');
      const transport=await createCreativeAgentModelStream({...run,runId:run.id,options:run.input});
      const tools=createCreativeTools(run,store,vi.fn());
      await runCreativeAgent(run,{store,...transport,tools});
      expect(f.fetch).toHaveBeenCalledTimes(1);
      const body=JSON.parse(String(f.fetch.mock.calls[0][2]!.body));
      for(const name of ['generation_requirements','generation_plan']){
        const parameters=body.tools.find((t:any)=>t.function.name===name).function.parameters;
        expect(parameters).toEqual(JSON.parse(JSON.stringify(tools.find(t=>t.name===name)!.parameters)));
        expect(parameters.properties.facts.items.allOf).toHaveLength(7);
        const wireTool={...tools.find(t=>t.name===name)!,parameters};
        for(const [field,valid,invalid] of [['image.quantity',1,'1'],['video.params.generateAudio',false,'false'],['image.params.resolution','2K',2048]] as const){
          const args=(value:unknown)=>({facts:[{field,value,strength:'hard',source:{kind:'message',sourceId:'m',quote:'raw'}}],...(name==='generation_plan'?{steps:[{id:'s',role:'final',mediaType:'image',prompt:'brief',dependsOn:[]}]}:{})});
          expect(validateToolArguments(wireTool,{type:'toolCall',id:'wire',name,arguments:args(valid)}).facts[0].value).toBe(valid);
          expect(()=>validateToolArguments(wireTool,{type:'toolCall',id:'wire',name,arguments:args(invalid)})).toThrow();
        }
      }
    }finally{await store.control(run.id,actorUserId,randomUUID(),'stop').catch(()=>undefined);await f.restore();}
  });

  it('hands approved media repaired by a new actual worker to observation with zero additional main calls',async()=>{
    const {createEmptyCanvasDocumentV2}=await import('@/lib/canvas/document');
    await prisma.canvas.update({where:{id:canvasId},data:{data:createEmptyCanvasDocumentV2() as any}});
    const f=await reviewTransportFixture();
    const broker=await import('@/lib/creative-agent/media-broker'),canvas=await import('@/lib/creative-agent/canvas-tools'),delivery=await import('@/lib/creative-agent/media-delivery');
    const run=await started({text:'生成1张图片',model:{providerId:'test',modelId:'injected-test'},preferences:{image:{mode:'explicit',model:'test-image'}}});
    const args={model:'test-image',prompt:'蓝色马克杯',params:{count:1}};
    const prepare=vi.spyOn(broker,'prepareCreativeAgentMedia').mockImplementation(async request=>({title:'确认一张',question:'是否生成？',options:[{value:'approve',label:'确认'}],binding:{kind:'image.generate',argsHash:hash(request.args),units:1}}));
    let generationId:number|undefined;
    const execute=vi.spyOn(canvas,'executeCreativeAgentTool').mockImplementation(async request=>{
      expect(request.kind).toBe('image.generate');expect(request.mediaApproval).toBeDefined();
      const row=await prisma.generation.create({data:{authUserId:actorUserId,canvasId,source:'agent',type:'image_edit',model:'test-image',prompt:args.prompt,status:'running'}});
      generationId=row.id;return {generationId:row.id,status:'running'};
    });
    const reconcile=vi.spyOn(delivery,'reconcileCreativeAgentMedia').mockResolvedValue(0);
    const wait=vi.spyOn(broker,'waitForCreativeAgentMedia').mockImplementation(async(_input,options)=>{
      const row=await prisma.generation.findUniqueOrThrow({where:{id:generationId!}});
      const receipt={generationId:row.id,status:row.status,mediaType:'image',outputs:row.localPath?[{url:row.localPath}]:[],nodeIds:[]};
      await options.onProgress?.(receipt);
      return {pendingGenerationIds:row.status==='running'?[row.id]:[],generations:[receipt]};
    });
    const until=async(check:()=>Promise<boolean>)=>{for(let i=0;i<200;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('worker did not settle');};
    try{
      await runCreativeAgent(run,{store,model,stream:scripted([assistant([{type:'toolCall',id:'submit-image',name:'image_generate',arguments:args}],'toolUse')]),tools:createCreativeTools(run,store,request=>canvas.executeCreativeAgentTool(request),request=>broker.prepareCreativeAgentMedia(request))});
      const decision=await prisma.creativeAgentDecision.findFirstOrThrow({where:{runId:run.id}});
      expect((await store.getRun(run.id)).status).toBe('waiting_decision');expect(execute).not.toHaveBeenCalled();
      await store.answerDecision(decision.id,actorUserId,randomUUID(),decision.proposalHash,'approve');
      const {runCreativeAgentWorkerTick}=await import('@/lib/creative-agent/worker');
      await runCreativeAgentWorkerTick();await until(async()=>{const current=await store.getRun(run.id);return current.status==='failed'||current.status==='waiting_action'&&current.workerId===null;});
      const pending=await store.getRun(run.id);expect(pending.status).toBe('waiting_action');expect(pending.epoch).toBeGreaterThan(run.epoch);
      expect(execute).toHaveBeenCalledTimes(1);expect(wait).toHaveBeenCalledTimes(1);expect(f.fetch).not.toHaveBeenCalled();
      expect((await store.getTranscript(run.sessionId)).filter((message:any)=>message.role==='toolResult')).toMatchObject([{toolCallId:'submit-image',isError:false,details:{result:{generationId}}}]);
      await prisma.generation.update({where:{id:generationId!},data:{status:'success',localPath:'/uploads/local-worker-fixture.png'}});
      await prisma.creativeAgentRun.update({where:{id:run.id},data:{updatedAt:new Date(Date.now()-3000)}});
      f.resolve.mockResolvedValue({status:'model-disabled'});
      await runCreativeAgentWorkerTick();await until(async()=>['completed','failed'].includes((await store.getRun(run.id)).status));
      expect((await store.getRun(run.id)).status).toBe('completed');expect(execute).toHaveBeenCalledTimes(1);expect(f.fetch).not.toHaveBeenCalled();
      const snapshot=await store.snapshot(actorUserId,canvasId,run.sessionId);
      expect(snapshot.media).toMatchObject([{generationId,status:'success'}]);
      expect(snapshot.messages.some(message=>message.text.includes('1 项成功'))).toBe(true);
    }finally{prepare.mockRestore();execute.mockRestore();reconcile.mockRestore();wait.mockRestore();await store.control(run.id,actorUserId,randomUUID(),'stop').catch(()=>undefined);if(generationId)await prisma.generation.delete({where:{id:generationId}});await f.restore();}
  });

  it('continues cancelled media approval without treating it as a submitted batch',async()=>{
    const run=await started({text:'生成1张图片',preferences:{image:{mode:'explicit',model:'fixture-image'}}});
    const args={model:'fixture-image',prompt:'杯子'};
    const execute=vi.fn(),observe=vi.fn();
    const prepare=async(request:any)=>({title:'生成',question:'确认？',options:[{value:'approve',label:'确认'},{value:'cancel',label:'取消'}],binding:{kind:'image.generate',argsHash:hash(request.args),units:1}});
    await runCreativeAgent(run,{store,model,stream:scripted([assistant([{type:'toolCall',id:'cancel-media',name:'image_generate',arguments:args}],'toolUse')]),tools:createCreativeTools(run,store,execute,prepare)});
    const decision=await prisma.creativeAgentDecision.findFirstOrThrow({where:{runId:run.id}});
    await store.answerDecision(decision.id,actorUserId,randomUUID(),decision.proposalHash,'cancel');
    const resumed=(await store.claimRun('cancelled-media',60_000))!;
    const stream=scripted([assistant([{type:'text',text:'已取消本次生成。'}])]);
    await runCreativeAgent(resumed,{store,model,stream,tools:createCreativeTools(resumed,store,execute,prepare),awaitMedia:observe});
    expect(stream).not.toHaveBeenCalled();expect(execute).not.toHaveBeenCalled();expect(observe).not.toHaveBeenCalled();
    expect((await store.getRun(run.id)).status).toBe('completed');
    expect((await store.getDecision(decision.id)).answer).toBe('cancel');
  });

  it('does not let an old submitted batch swallow a new user status query',async()=>{
    const prior=await started();
    await store.saveTranscript(prior.id,prior.epoch,[{role:'user',content:prior.input.text,timestamp:Date.parse(prior.createdAt)},assistant([{type:'toolCall',id:'old-media',name:'image_generate',arguments:{prompt:'old'}}],'toolUse'),{role:'toolResult',toolCallId:'old-media',toolName:'image_generate',content:[{type:'text',text:'submitted'}],details:{result:{generationId:123}},isError:false,timestamp:Date.now()}]);
    await store.finish(prior.id,prior.epoch,'completed');
    const run=await started({sessionId:prior.sessionId,text:'查一下上次任务状态'});
    const stream=scripted([assistant([{type:'toolCall',id:'status-query',name:'generation_read',arguments:{generationId:123}}],'toolUse'),assistant([{type:'text',text:'查询结果已返回。'}])]);
    const execute=vi.fn(async request=>{expect(request.kind).toBe('generation.read');return {generationId:123,status:'running'};});
    await runCreativeAgent(run,{store,model,stream,tools:createCreativeTools(run,store,execute)});
    expect(stream).toHaveBeenCalledTimes(2);expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each(['resume','runner','worker'] as const)('does not complete a persisted current user from a previous-turn media batch: %s',async path=>{
    const {createEmptyCanvasDocumentV2}=await import('@/lib/canvas/document');
    await prisma.canvas.update({where:{id:canvasId},data:{data:createEmptyCanvasDocumentV2() as any}});
    const prior=await started();
    const old:AgentMessage[]=[{role:'user',content:prior.input.text,timestamp:Date.parse(prior.createdAt)},assistant([{type:'toolCall',id:'previous-media',name:'image_generate',arguments:{prompt:'old'}}],'toolUse'),{role:'toolResult',toolCallId:'previous-media',toolName:'image_generate',content:[{type:'text',text:'submitted'}],details:{result:{generationId:123}},isError:false,timestamp:Date.now()}];
    await store.saveTranscript(prior.id,prior.epoch,old);await store.finish(prior.id,prior.epoch,'completed');
    const run=await started({sessionId:prior.sessionId,text:'查一下上次任务状态',model:{providerId:'test',modelId:'injected-test'}});
    expect(Date.parse(run.createdAt)).toBeGreaterThan(Date.parse(prior.createdAt));
    // Real crash point: SDK's user message_end was saved before any current assistant.
    await store.saveTranscript(run.id,run.epoch,[...old,{role:'user',content:run.input.text,timestamp:Date.parse(run.createdAt)}]);
    const f=path==='worker'?await reviewTransportFixture():undefined;
    try{
      if(path==='resume'){
        expect(await resumeCompletedCreativeAgentTurn(run,{store})).toBe(false);
        expect((await store.getRun(run.id)).status).toBe('running');
      }else if(path==='runner'){
        const stream=scripted([assistant([{type:'text',text:'当前请求已处理。'}])]);
        await runCreativeAgent(run,{store,model,stream,tools:createCreativeTools(run,store,vi.fn())});
        expect(stream).toHaveBeenCalledTimes(1);
        expect((await store.snapshot(actorUserId,canvasId,run.sessionId)).messages.some(message=>message.text==='当前请求已处理。')).toBe(true);
      }else{
        await store.control(run.id,actorUserId,randomUUID(),'pause');await store.control(run.id,actorUserId,randomUUID(),'resume');
        const {runCreativeAgentWorkerTick}=await import('@/lib/creative-agent/worker');
        await runCreativeAgentWorkerTick();
        for(let i=0;i<200&&!['completed','failed'].includes((await store.getRun(run.id)).status);i++)await new Promise(resolve=>setTimeout(resolve,10));
        expect((await store.getRun(run.id)).status).toBe('completed');
        expect(f!.fetch).toHaveBeenCalledTimes(1);
        expect((await store.snapshot(actorUserId,canvasId,run.sessionId)).messages.some(message=>message.text==='已保存的原始回答')).toBe(true);
      }
    }finally{await store.control(run.id,actorUserId,randomUUID(),'stop').catch(()=>undefined);await f?.restore();}
  });

  it("atomically reserves the last allowance across plans and preserves immutable plans and uncertain calls after restart", async () => {
    const run = await started({text:"生成一张图片，质量 high"});
    const receipt: any = {id:'receipt', requirementsRevision:0, request:{model:'m',prompt:'p',params:{count:1},references:[]}, output:{calls:1,expectedReturned:1,maxReturned:1}};
    const plan: any = {version:1,definition:{steps:[{id:'s',role:'final',mediaType:'image',prompt:'p',params:{count:1},references:[],dependsOn:[]}]},requirementsRevision:0,steps:[{id:'s',role:'final',receipt}]};
    expect(store.saveGenerationPlan).toBeTypeOf('function');
    await store.saveGenerationPlan(run,'p1',plan);
    await store.saveGenerationPlan(run,'p2',plan);
    await expect(store.saveGenerationPlan(run,'p1',{...plan,definition:{steps:[]}})).rejects.toMatchObject({code:'PLAN_IMMUTABLE'});
    const request = (id:string) => ({planId:id,stepId:'s',receiptId:'receipt',actionId:id,requestKeys:[id],requestHash:hash(receipt.request)});
    await expect(store.reserveGenerationStep({...run,actorUserId:actorUserId+1},request('p1'))).rejects.toMatchObject({code:'run_not_found'});
    await expect(store.reserveGenerationStep({...run,canvasId:canvasId+1},request('p1'))).rejects.toMatchObject({code:'RUN_SCOPE_INVALID'});
    await expect(store.reserveGenerationStep(run,{...request('p1'),receiptId:'foreign'})).rejects.toMatchObject({code:'SELECTION_RECEIPT_STALE'});
    const results = await Promise.allSettled(['p1','p2'].map(id=>store.reserveGenerationStep(run,request(id))));
    expect(results.filter(item=>item.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(item=>item.status==='rejected')).toHaveLength(1);
    const saved = await new CreativeAgentStore(prisma).getRun(run.id);
    const key=saved.input.quantityLedger!.reservations[0].requestKey;
    await store.reserveGenerationStep(run,request(key));
    expect((await store.getRun(run.id)).input.quantityLedger!.reservations).toHaveLength(1);
    await store.transitionGenerationStep(run,key,'started');
    const requirements=await store.recordRequirements(run,{facts:[{field:'image.params.quality',value:'high',strength:'hard',source:{kind:'message',sourceId:run.input.messageId,quote:'high'}}]});
    const revised={...plan,requirementsRevision:requirements.revision,steps:[{...plan.steps[0],receipt:{...receipt,requirementsRevision:requirements.revision}}]};
    await store.saveGenerationPlan(run,'revised',revised);
    await expect(store.reserveGenerationStep(run,request('revised'))).rejects.toMatchObject({code:'QUANTITY_LIMIT'});
    expect((await store.getRun(run.id)).input.quantityLedger!.reservations).toHaveLength(1);

    await expect(store.transitionGenerationStep(run,key,'released')).rejects.toMatchObject({code:'QUANTITY_RESERVATION_CONFLICT'});
    await store.control(run.id,actorUserId,randomUUID(),'pause',run.epoch);
    await expect(store.reserveGenerationStep(run,request('p1'))).rejects.toMatchObject({code:'stale_epoch'});
    await store.observeGenerationOutput(run,key,{generationId:91,rawReturned:2,uniqueOutputs:2,savedOutputs:2});
    const after=await new CreativeAgentStore(prisma).getRun(run.id);
    expect(after.input.quantityLedger).toMatchObject({frozen:true,reservations:[{phase:'started',observation:{rawReturned:2}}]});
    expect(after.input.generationPlans!.p1.plan.definition).toEqual(plan.definition);
    await store.control(run.id,actorUserId,randomUUID(),'stop');
  });

  it("normal media tools persist their complete implicit plan and bind zero retries before asking", async () => {
    const run = await started();
    const receipt:any={version:1,id:'implicit',requirementsRevision:0,mediaType:'image',request:{model:'m',prompt:'p',params:{count:1},references:[]},output:{calls:1,minReturned:0,expectedReturned:1,maxReturned:1}};
    const execute=vi.fn();
    const prepare=vi.fn(async(request:any)=>({title:'Confirm',question:'Exact request',options:[{value:'approve',label:'Yes'}],binding:{kind:request.kind,argsHash:'bound',units:1,retryLimit:0,version:2 as const,...request.matching.execution},media:{mediaType:'image' as const,model:{id:'m',label:'M'},prompt:'p',params:{count:1},units:1,references:[],selectionReceipt:receipt}}));
    const tool=createCreativeTools(run,store,execute,prepare).find(t=>t.name==='image_generate')!;
    await expect(tool.execute('implicit',{prompt:'p'})).rejects.toMatchObject({code:'run_deferred'});
    const persisted=await store.getRun(run.id);
    expect(Object.values(persisted.input.generationPlans ?? {})).toHaveLength(1);
    const saved=Object.values(persisted.input.generationPlans!)[0];
    expect(saved.plan.definition.steps[0].prompt).toBe('p');
    const decision=(await prisma.creativeAgentDecision.findMany({where:{runId:run.id}}))[0];
    expect(decision.binding).toMatchObject({version:2,planId:saved.id,stepId:'single',receiptId:'implicit',limits:{initialCalls:1,retryCalls:0}});
    expect(execute).not.toHaveBeenCalled();
    await store.control(run.id,actorUserId,randomUUID(),'stop');
  });

  it.each(['reserved','started'] as const)("pause atomically releases only %s reservations whose provider call never started", async phase => {
    const run=await started();
    const requestArgs={model:'m',prompt:'p',params:{count:1},references:[]};
    const plan:any={version:1,definition:{steps:[]},requirementsRevision:0,steps:[{id:'s',role:'final',receipt:{id:'r',requirementsRevision:0,request:requestArgs,output:{calls:1,maxReturned:1,expectedReturned:1}}}]};
    await store.saveGenerationPlan(run,'plan',plan);
    await store.claimAction({...run,runId:run.id,actionId:'phase-'+run.id,kind:'image.generate',inputHash:hash(requestArgs)});
    await store.reserveGenerationStep(run,{planId:'plan',stepId:'s',receiptId:'r',requestHash:hash(requestArgs),actionId:'phase-'+run.id,requestKeys:['key-'+run.id]});
    if(phase==='started') await store.transitionGenerationStep(run,'key-'+run.id,'started');
    await store.control(run.id,actorUserId,randomUUID(),'pause');
    const saved=await store.getRun(run.id);
    expect(saved.input.quantityLedger!.reservations[0].phase).toBe(phase==='reserved'?'released':'started');
    expect((await store.getAction('phase-'+run.id)).state).toBe(phase==='reserved'?'failed':'unknown');
    if(phase==='started') await expect(store.control(run.id,actorUserId,randomUUID(),'resume')).rejects.toMatchObject({code:'action_outcome_unknown'});
    else await expect(store.control(run.id,actorUserId,randomUUID(),'resume')).resolves.toBeDefined();
    await store.control(run.id,actorUserId,randomUUID(),'stop');
  });

  it("serializes pause against dispatch-start and keeps the winning state after process recovery",async()=>{
    const run=await started(),actionId='race-'+run.id,key='key-'+run.id;
    const receipt:any={id:'r',requirementsRevision:0,request:{prompt:'p'},output:{calls:1,expectedReturned:1,maxReturned:1}};
    await store.saveGenerationPlan(run,'p',{version:1,definition:{steps:[]},requirementsRevision:0,steps:[{id:'s',role:'final',receipt}]} as any);
    await store.claimAction({...run,runId:run.id,actionId,kind:'image.generate',inputHash:hash(receipt.request)});
    await store.reserveGenerationStep(run,{planId:'p',stepId:'s',receiptId:'r',requestHash:hash(receipt.request),actionId,requestKeys:[key]});
    const results=await Promise.allSettled([store.transitionGenerationStep(run,key,'started'),store.control(run.id,actorUserId,randomUUID(),'pause')]);
    expect(results[1].status).toBe('fulfilled');
    const current=await new CreativeAgentStore(prisma).getRun(run.id),action=await store.getAction(actionId);
    expect(current.input.quantityLedger!.reservations[0].phase).toBe(results[0].status==='fulfilled'?'started':'released');
    expect(action.state).toBe(results[0].status==='fulfilled'?'unknown':'failed');
    await expect(store.transitionGenerationStep(run,key,'started')).rejects.toMatchObject({code:'stale_epoch'});
    await store.control(run.id,actorUserId,randomUUID(),'stop');
  });

  it("spends strict total three across final and intermediate steps and cannot hide a fourth retry",async()=>{
    const run=await started({text:'最终2张，中间1张，总共只能三张，允许重试1次'});
    const requirements=await store.recordRequirements(run,{facts:[['generation.finalOutputs',2,'最终2张'],['generation.intermediateOutputs',1,'中间1张'],['generation.totalOutputs',3,'总共只能三张'],['generation.retryCalls',1,'允许重试1次']].map(([field,value,quote])=>({field,value,strength:'hard',source:{kind:'message',sourceId:run.input.messageId,quote}}))});
    const receipt:any={id:'r',requirementsRevision:requirements.revision,request:{prompt:'p'},output:{calls:1,expectedReturned:1,maxReturned:1}};
    const plan:any={version:1,definition:{steps:[]},requirementsRevision:requirements.revision,steps:['final1','final2','middle'].map(id=>({id,role:id==='middle'?'intermediate':'final',receipt}))};
    await store.saveGenerationPlan(run,'p',plan);
    for(const stepId of ['final1','middle','final2']){
      await store.reserveGenerationStep(run,{planId:'p',stepId,receiptId:'r',requestHash:hash(receipt.request),actionId:stepId,requestKeys:[stepId]});
      await store.transitionGenerationStep(run,stepId,'started');
    }
    await expect(store.reserveGenerationStep(run,{planId:'p',stepId:'final1',receiptId:'r',requestHash:hash(receipt.request),actionId:'retry',requestKeys:['retry'],retryOf:'final1'})).rejects.toMatchObject({code:'QUANTITY_LIMIT'});
    expect((await store.getRun(run.id)).input.quantityLedger!.reservations).toHaveLength(3);
    await store.finish(run.id,run.epoch,'completed');
  });

  it("real broker approvals compete atomically in PostgreSQL and the losing plan calls no provider", async () => {
    const {prepareCreativeAgentMedia,executeCreativeAgentMediaTool,claimCreativeAgentMediaApproval}=await import('@/lib/creative-agent/media-broker');
    const {generationExecution}=await import('@/lib/creative-agent/quantity');
    const {getImageModelParams}=await import('@/lib/generation/image-model-params');
    const run=await started();const records=new Map<string,any>();
    const provider=vi.fn(async(request:any)=>{const row={id:records.size+900,authUserId:actorUserId,canvasId,source:'agent',type:'image_edit',model:request.model,requestKey:request.requestKey,status:'running',localPath:null,templateData:JSON.stringify(request)};records.set(request.requestKey,row);return {generationId:row.id,status:'running' as const,taskId:String(row.id)};});
    const deps:any={readCanvas:async()=>({nodes:[],revision:'0',edgeIds:[]}),catalog:async()=>({image:[{id:'gpt-image-2-openrouter',label:'GPT',params:getImageModelParams('gpt-image-2-openrouter'),qualification:{available:true,reasons:[],entitlement:'unverified',providerId:'openrouter',adapterId:'gpt-image-2-openrouter',routeConfigFingerprint:'a'}}],video:[]}),claimApproval:claimCreativeAgentMediaApproval,createImage:provider,createVideo:vi.fn(),findGeneration:async(q:any)=>records.get(q.requestKey)??null,finalize:vi.fn(),attach:vi.fn(),beforeDispatch:async(i:any)=>{await store.assertFence(i.runId,i.epoch);},markDispatchStarted:async(i:any,key:string)=>store.transitionGenerationStep({...run,epoch:i.epoch},key,'started'),releaseUnused:async(i:any,keys:string[])=>{for(const key of keys)await store.transitionGenerationStep({...run,epoch:i.epoch},key,'released');}};
    const requests:any[]=[];
    for(const id of ['first','second']) {
      const request:any={actorUserId,canvasId,runId:run.id,epoch:run.epoch,actionId:run.id+id,kind:'image.generate',args:{prompt:id,params:{count:1}},matching:{policyVersion:2}};
      const preliminary=await prepareCreativeAgentMedia(request,deps);const receipt=preliminary.media!.selectionReceipt!;
      request.args=receipt.request;request.matching.receipt=receipt;
      await store.saveGenerationPlan(run,id,{version:1,definition:{steps:[]},requirementsRevision:0,steps:[{id:'s',role:'final',mediaType:'image',dependsOn:[],status:'ready',receipt}],totals:{plannedCalls:1,readyCalls:1,unreadySteps:0,minReturned:0},evidenceLimits:[]});
      request.matching.execution=generationExecution((await store.getRun(run.id)).input,id,'s');
      const decision=await store.ask(run,request.actionId,await prepareCreativeAgentMedia(request,deps));
      await store.answerDecision(decision.id,actorUserId,randomUUID(),decision.proposalHash,'approve');
      request.mediaApproval={decisionId:decision.id,proposalHash:decision.proposalHash};
      await store.claimAction({...request,inputHash:hash(request.args)});requests.push(request);
    }
    const results=await Promise.allSettled(requests.map(request=>executeCreativeAgentMediaTool(request,deps)));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'QUANTITY_LIMIT'}});
    expect(provider).toHaveBeenCalledOnce();
    const ledger=(await store.getRun(run.id)).input.quantityLedger!;expect(ledger.reservations).toHaveLength(1);expect(ledger.reservations[0].phase).toBe('started');
    const winner=requests.find(request=>request.actionId===ledger.reservations[0].actionId)!;
    await executeCreativeAgentMediaTool(winner,deps);expect(provider).toHaveBeenCalledOnce();
    await store.control(run.id,actorUserId,randomUUID(),'stop');
  });

  it.each(['media-object','negated-intermediate','postposed-action','postposed-permission','permission-forbidden','permission-cannot','permission-disallowed','postposed-unneeded','shared-final-reference','borrowed-dimension','borrowed-duration','borrowed-resolution','compound-final-denial','nonmedia-final','historical-cropped','historical-marker1'] as const)('actual store/broker rejects excess authority from %s before provider dispatch',async scenario=>{
    const {prepareCreativeAgentMedia,executeCreativeAgentMediaTool,claimCreativeAgentMediaApproval}=await import('@/lib/creative-agent/media-broker');
    const {generationExecution}=await import('@/lib/creative-agent/quantity');
    const {getImageModelParams}=await import('@/lib/generation/image-model-params');
    const text={
      'media-object':'生成3张图片', 'negated-intermediate':'只要1张成品，不要额外生成3张参考图',
      'postposed-action':'3张参考图不要生成，只要1张成品', 'postposed-permission':'生成3张参考图是不允许的，只要1张成品',
      'permission-forbidden':'不许生成3张参考图，只要1张成品', 'permission-cannot':'不可以生成3张参考图，只要1张成品',
      'permission-disallowed':'不被允许生成3张参考图，只要1张成品', 'postposed-unneeded':'3张参考图不用生成，只要1张成品',
      'shared-final-reference':'最终交付3张参考图',
      'borrowed-dimension':'最终交付3张参考图（宽度3厘米）',
      'borrowed-duration':'最终交付3张参考图（时长3秒）',
      'borrowed-resolution':'最终交付3张参考图（分辨率3像素）',
      'compound-final-denial':'只要1张成品，3张成品图片不要生成', 'nonmedia-final':'只要1张成品，最终交付3条要求',
      'historical-cropped':'不许生成3张参考图，只要1张成品', 'historical-marker1':'不许生成3张参考图，只要1张成品',
    }[scenario];
    const hasFinalThree=scenario==='shared-final-reference'||scenario.startsWith('borrowed-');
    const rejectedFinal=scenario==='compound-final-denial'||scenario==='nonmedia-final';
    const historical=scenario.startsWith('historical-');
    const borrowedQuote=scenario==='compound-final-denial'?'3张成品图片':scenario==='nonmedia-final'?'最终交付3条要求':scenario==='borrowed-dimension'?'3厘米':scenario==='borrowed-duration'?'3秒':scenario==='borrowed-resolution'?'3像素':'3张参考图';
    const run=await started({text});
    const fact=(field:string,value:number,quote:string)=>({field,value,strength:'hard',source:{kind:'message',sourceId:run.input.messageId,quote}});
    if(scenario==='media-object'){
      await expect(store.recordRequirements(run,{facts:[fact('image.quantity',3,text),fact('video.quantity',3,text)]})).rejects.toMatchObject({code:'invalid_requirement_source'});
      run.input.requirements=await store.recordRequirements(run,{facts:[fact('image.quantity',3,text)]});
    }else{
      run.input.requirements=await store.recordRequirements(run,{facts:[fact('generation.finalOutputs',hasFinalThree?3:1,hasFinalThree?'3张参考图':'只要1张成品')]});
      await expect(store.recordRequirements(run,{facts:[fact(rejectedFinal?'generation.finalOutputs':'generation.intermediateOutputs',3,borrowedQuote)]})).rejects.toMatchObject({code:'invalid_requirement_source'});
    }
    const records=new Map<string,any>();
    const provider=vi.fn(async(request:any)=>{const row={id:records.size+1900,authUserId:actorUserId,canvasId,source:'agent',type:'image_edit',model:request.model,requestKey:request.requestKey,status:'running',localPath:null,templateData:JSON.stringify(request)};records.set(request.requestKey,row);return {generationId:row.id,status:'running' as const,taskId:String(row.id)};});
    const deps:any={readCanvas:async()=>({nodes:[],revision:'0',edgeIds:[]}),catalog:async()=>({image:[{id:'gpt-image-2-openrouter',label:'GPT',params:getImageModelParams('gpt-image-2-openrouter'),qualification:{available:true,reasons:[],entitlement:'unverified',providerId:'openrouter',adapterId:'gpt-image-2-openrouter',routeConfigFingerprint:'a'}}],video:[]}),claimApproval:claimCreativeAgentMediaApproval,createImage:provider,createVideo:vi.fn(),findGeneration:async(q:any)=>records.get(q.requestKey)??null,finalize:vi.fn(),attach:vi.fn(),beforeDispatch:async(i:any)=>{await store.assertFence(i.runId,i.epoch);},markDispatchStarted:async(i:any,key:string)=>store.transitionGenerationStep({...run,epoch:i.epoch},key,'started'),releaseUnused:async(i:any,keys:string[])=>{for(const key of keys)await store.transitionGenerationStep({...run,epoch:i.epoch},key,'released');}};
    if(historical){
      const quote='3张参考图',start=text.indexOf(quote);
      const legacy={...fact('generation.intermediateOutputs',3,quote),source:{kind:'message',sourceId:run.input.messageId,quote,start,end:start+quote.length,valueStart:start,order:0,correction:false,...(scenario==='historical-marker1'?{quantityEvidenceVersion:1}:{})}};
      const oldInput={...run.input,requirements:{...run.input.requirements!,facts:[...run.input.requirements!.facts,legacy]}};
      await prisma.creativeAgentRun.update({where:{id:run.id},data:{input:oldInput as any}});
      const restored=await new CreativeAgentStore(prisma).getRun(run.id);
      const fresh:any={actorUserId,canvasId,runId:run.id,epoch:run.epoch,actionId:run.id+'old-fresh',kind:'image.generate',args:{prompt:'fresh',params:{count:1}},matching:{policyVersion:2,requirements:restored.input.requirements}};
      await expect(prepareCreativeAgentMedia(fresh,deps)).rejects.toMatchObject({code:'QUANTITY_SOURCE_INVALID'});
      // An old dispatched row remains observable without re-authorizing generation.
      records.set('existing',{id:1999,authUserId:actorUserId,canvasId,source:'agent',type:'image_edit',model:'gpt-image-2-openrouter',requestKey:'existing',status:'running',localPath:null,templateData:'{}'});
      const reader={...deps,findGeneration:async(q:any)=>q.id===1999?records.get('existing'):records.get(q.requestKey)??null};
      await expect(executeCreativeAgentMediaTool({...fresh,kind:'generation.read',args:{generationId:1999}},reader)).resolves.toMatchObject({generationId:1999});
      const executor=vi.fn((request:any)=>executeCreativeAgentMediaTool(request,reader));
      const tools=createCreativeTools(restored,store,executor,(request:any)=>prepareCreativeAgentMedia(request,reader));
      await expect(tools.find(t=>t.name==='generation_read')!.execute('old-read',{generationId:1999})).resolves.toMatchObject({details:{result:{generationId:1999}}});
      for(const state of ['succeeded','claimed'] as const){
        const args={prompt:'old-'+state},requestHash=hash({args,requirementsRevision:restored.input.requirements!.revision});
        const actionId=creativeActionId(run.id,'image.generate',{matchingRequestHash:requestHash},'old-'+state);
        await store.claimAction({runId:run.id,epoch:run.epoch,actionId,actorUserId,canvasId,kind:'image.generate',inputHash:hash(args)});
        if(state==='succeeded')await store.completeAction(actionId,{runId:run.id,epoch:run.epoch,state:'succeeded',result:{generationIds:[1999],status:'running'}});
        const replay=tools.find(t=>t.name==='image_generate')!.execute('old-'+state,args);
        if(state==='succeeded')await expect(replay).resolves.toMatchObject({details:{result:{generationIds:[1999]}}});
        else await expect(replay).rejects.toMatchObject({code:'action_not_replayable'});
      }
      expect(executor).toHaveBeenCalledOnce(); // only the read, never a generation replay
      expect(provider).not.toHaveBeenCalled();
      expect((await store.getRun(run.id)).input.quantityLedger?.reservations??[]).toHaveLength(0);
      await store.control(run.id,actorUserId,randomUUID(),'stop');return;
    }
    const allowed=scenario==='media-object'||hasFinalThree?3:rejectedFinal?1:0;
    for(let index=0;index<=allowed;index++){
      const id='source-'+index;
      const request:any={actorUserId,canvasId,runId:run.id,epoch:run.epoch,actionId:run.id+id,kind:'image.generate',args:{prompt:id,params:{count:1}},matching:{policyVersion:2,requirements:run.input.requirements}};
      const preliminary=await prepareCreativeAgentMedia(request,deps);const receipt=preliminary.media!.selectionReceipt!;
      request.args=receipt.request;request.matching.receipt=receipt;
      await store.saveGenerationPlan(run,id,{version:1,definition:{steps:[]},requirementsRevision:run.input.requirements!.revision,steps:[{id:'s',role:scenario==='media-object'||rejectedFinal||hasFinalThree&&index<allowed?'final':'intermediate',mediaType:'image',dependsOn:[],status:'ready',receipt}],totals:{plannedCalls:1,readyCalls:1,unreadySteps:0,minReturned:0},evidenceLimits:[]});
      const executionState=(await store.getRun(run.id)).input;
      if(index===allowed){
        try{request.matching.execution=generationExecution(executionState,id,'s');}
        catch(error){expect(error).toMatchObject({code:'QUANTITY_LIMIT'});expect(provider).toHaveBeenCalledTimes(allowed);continue;}
      }else request.matching.execution=generationExecution(executionState,id,'s');
      const decision=await store.ask(run,request.actionId,await prepareCreativeAgentMedia(request,deps));
      await store.answerDecision(decision.id,actorUserId,randomUUID(),decision.proposalHash,'approve');
      request.mediaApproval={decisionId:decision.id,proposalHash:decision.proposalHash};
      await store.claimAction({...request,inputHash:hash(request.args)});
      if(index<allowed)await executeCreativeAgentMediaTool(request,deps);
      else await expect(executeCreativeAgentMediaTool(request,deps)).rejects.toMatchObject({code:'QUANTITY_LIMIT'});
    }
    expect(provider).toHaveBeenCalledTimes(allowed);
    expect((await new CreativeAgentStore(prisma).getRun(run.id)).input.quantityLedger?.reservations??[]).toHaveLength(allowed);
    await store.control(run.id,actorUserId,randomUUID(),'stop');
  });

  it.each(['failed','cancelled'] as const)('actual tools to runner retains known predispatch %s and original reason',async outcome=>{
    const {prepareCreativeAgentMedia,executeCreativeAgentMediaTool,claimCreativeAgentMediaApproval}=await import('@/lib/creative-agent/media-broker');
    const {getImageModelParams}=await import('@/lib/generation/image-model-params');
    let run=await started({text:'生成1张图片'});
    const provider=vi.fn(),startTask=vi.fn(async()=>{throw new Error('fixture task preparation rejected');});
    const deps:any={readCanvas:async()=>({nodes:[],revision:'0',edgeIds:[]}),catalog:async()=>({image:[{id:'gpt-image-2-openrouter',label:'GPT',params:getImageModelParams('gpt-image-2-openrouter'),qualification:{available:true,reasons:[],entitlement:'unverified',providerId:'openrouter',adapterId:'gpt-image-2-openrouter',routeConfigFingerprint:'a'}}],video:[]}),claimApproval:claimCreativeAgentMediaApproval,createImage:provider,createVideo:vi.fn(),findGeneration:async()=>null,finalize:vi.fn(),attach:vi.fn(),startTask,beforeDispatch:async(i:any)=>{await store.assertFence(i.runId,i.epoch);},markDispatchStarted:async(i:any,key:string)=>store.transitionGenerationStep({...run,epoch:i.epoch},key,'started'),releaseUnused:async(i:any,keys:string[])=>{for(const key of keys)await store.transitionGenerationStep({...run,epoch:i.epoch},key,'released');}};
    const invoke=()=>createCreativeTools(run,store,(i:any)=>executeCreativeAgentMediaTool(i,deps),(i:any)=>prepareCreativeAgentMedia(i,deps)).find(t=>t.name==='image_generate')!.execute('known-failure',{prompt:'one'});
    await expect(invoke()).rejects.toMatchObject({code:'run_deferred'});
    const decision=(await prisma.creativeAgentDecision.findMany({where:{runId:run.id,state:'pending'}}))[0];
    await store.answerDecision(decision.id,actorUserId,randomUUID(),decision.proposalHash,outcome==='failed'?'approve':'cancel');
    await prisma.creativeAgentRun.update({where:{id:run.id},data:{updatedAt:new Date(Date.now()-3000)}});
    run=(await store.claimRun('known-failure-resume',60000))!;
    if(outcome==='failed')await expect(invoke()).rejects.toMatchObject({code:'MEDIA_NOT_DISPATCHED'});
    else await invoke();
    const action=(await store.actionReceipts(run.id)).find(a=>a.kind==='image.generate')!;
    expect(action.result).toMatchObject(outcome==='failed'?{rejectedBeforeDispatch:true,code:'MEDIA_NOT_DISPATCHED'}:{cancelled:true});
    expect(provider).not.toHaveBeenCalled();
    expect(startTask).toHaveBeenCalledTimes(outcome==='failed'?1:0);
    await store.saveTranscript(run.id,run.epoch,[{role:'user',content:'Generate',timestamp:Date.parse(run.createdAt)},assistant([{type:'text',text:'Stopped before submission'}])]);
    const resumed=resumeCompletedCreativeAgentTurn(run,{store,awaitMedia:async()=>({pendingGenerationIds:[],generations:[]})});
    if(outcome==='failed')await expect(resumed).rejects.toMatchObject({code:'MEDIA_NOT_DISPATCHED',message:action.result!.message});
    else{await expect(resumed).resolves.toBe(true);expect((await store.getRun(run.id)).status).toBe('completed');expect((await store.getDecision(decision.id)).answer).toBe('cancel');}
    expect(provider).not.toHaveBeenCalled();
    if(outcome==='failed'){expect((await store.getRun(run.id)).input.quantityLedger!.reservations[0].phase).toBe('released');await store.control(run.id,actorUserId,randomUUID(),'stop');}
  });

  it.each(["approve","cancel"])("resumes a persisted dependent plan through worker completion without a model, preserving exact %s", async answer => {
    const {prepareCreativeAgentMedia,executeCreativeAgentMediaTool,claimCreativeAgentMediaApproval,waitForCreativeAgentMedia}=await import('@/lib/creative-agent/media-broker');
    const {createCreativeGenerationPlan}=await import('@/lib/creative-agent/generation-plan');
    const {advancePersistedPlan}=await import('@/lib/creative-agent/plan-runtime');
    const {getImageModelParams}=await import('@/lib/generation/image-model-params');
    let run=await started({text:'最终1张，中间1张'});const originalRunId=run.id;
    run.input.requirements=await store.recordRequirements(run,{facts:[['generation.finalOutputs','最终1张'],['generation.intermediateOutputs','中间1张']].map(([field,quote])=>({field,value:1,strength:'hard',source:{kind:'message',sourceId:run.input.messageId,quote}}))});
    const rows=new Map<string,any>(),nodes:any[]=[];
    const provider=vi.fn(async(request:any)=>{const row={id:rows.size+950,authUserId:actorUserId,canvasId,source:'agent',type:'image_edit',model:request.model,requestKey:request.requestKey,status:'running',localPath:null,templateData:JSON.stringify(request)};rows.set(request.requestKey,row);return {generationId:row.id,status:'running' as const,taskId:String(row.id)};});
    const deps:any={readCanvas:async()=>({nodes,revision:'1',edgeIds:[]}),catalog:async()=>({image:[{id:'gpt-image-2-openrouter',label:'GPT',params:getImageModelParams('gpt-image-2-openrouter'),qualification:{available:true,reasons:[],entitlement:'unverified',providerId:'openrouter',adapterId:'gpt-image-2-openrouter',routeConfigFingerprint:'a'}}],video:[]}),bindReference:async(_i:any,_n:any,ref:any)=>({...ref,facts:{state:'verified',kind:'image',contentVersion:'b'.repeat(64),width:1024,height:1024}}),claimApproval:claimCreativeAgentMediaApproval,createImage:provider,createVideo:vi.fn(),findGeneration:async(q:any)=>q.requestKey?rows.get(q.requestKey)??null:[...rows.values()].find(r=>r.id===q.id),finalize:vi.fn(),attach:vi.fn(),beforeDispatch:async(i:any)=>{await store.assertFence(i.runId,i.epoch);},markDispatchStarted:async(i:any,key:string)=>store.transitionGenerationStep({...run,epoch:i.epoch},key,'started'),releaseUnused:async(i:any,keys:string[])=>{for(const key of keys)await store.transitionGenerationStep({...run,epoch:i.epoch},key,'released');},syncTask:async(_i:any,row:any,outputs:any[])=>{if(!outputs.length)return null;const id='real-'+row.id;if(!nodes.some(n=>n.id===id))nodes.push({id,type:'image',position:{x:0,y:0},data:{kind:'image',url:row.localPath,mediaId:'media-'+row.id}});return {revision:'1',nodeIds:[id]};}};
    const request:any={actorUserId,canvasId,runId:run.id,epoch:run.epoch,actionId:'p',kind:'generation.plan',matching:{policyVersion:2,requirements:run.input.requirements},args:{steps:[{id:'a',role:'intermediate',mediaType:'image',prompt:'A'},{id:'b',role:'final',mediaType:'image',prompt:'B original prompt',references:[{stepId:'a',outputIndex:0}]}]}};
    await store.saveGenerationPlan(run,'p',await createCreativeGenerationPlan(request,deps));
    const execute=(i:any)=>executeCreativeAgentMediaTool(i,deps),prepare=(i:any)=>prepareCreativeAgentMedia(i,deps);
    const invoke=async(current:Run,planId:string,stepId:string)=>{const latest=await store.getRun(current.id);return createCreativeTools({...latest,epoch:current.epoch},store,execute,prepare).find(t=>t.name==='image_generate')!.execute('plan-step',{plan:{actionId:planId,stepId}});};
    const resume=()=>resumeCompletedCreativeAgentTurn(run,{store,awaitMedia:async(current,ids)=>waitForCreativeAgentMedia({actorUserId,canvasId,runId:current.id,epoch:current.epoch},{generationIds:ids,pollOnce:true,onCommitted:async()=>{}},deps),advancePlan:(current,observations)=>advancePersistedPlan(current,observations,{store,readCanvas:async()=>deps.readCanvas(),finalize:(i,_d,b)=>createCreativeGenerationPlan(i,deps,b),executeStep:invoke})});
    const reclaim=async()=>{await prisma.creativeAgentRun.update({where:{id:run.id},data:{updatedAt:new Date(Date.now()-3000)}});run=(await store.claimRun('dependency-resume',60000))!;expect(run.id).toBe(originalRunId);};
    await expect(invoke(run,'p','a')).rejects.toMatchObject({code:'run_deferred'});
    let decision=(await prisma.creativeAgentDecision.findMany({where:{runId:run.id,state:'pending'}}))[0];await store.answerDecision(decision.id,actorUserId,randomUUID(),decision.proposalHash,'approve');await reclaim();
    await invoke(run,'p','a');expect(provider).toHaveBeenCalledOnce();
    await store.saveTranscript(run.id,run.epoch,[{role:'user',content:'Generate',timestamp:Date.parse(run.createdAt)},assistant([{type:'text',text:'Submitted'}])]);
    expect(await resume()).toBe(true);expect((await store.getRun(run.id)).status).toBe('waiting_action');expect(provider).toHaveBeenCalledOnce();await reclaim();
    const first=[...rows.values()][0];first.status='success';first.localPath='/uploads/a.png';
    expect(await resume()).toBe(true);expect((await store.getRun(run.id)).status).toBe('waiting_decision');expect(provider).toHaveBeenCalledOnce();
    const partialSnapshot=await new CreativeAgentStore(prisma).snapshot(actorUserId,canvasId,run.sessionId);
    expect(partialSnapshot.run?.status).toBe('waiting_decision');
    const partialSummary=partialSnapshot.messages.find(message=>message.id===`${run.id}:media:completed`);
    expect(partialSummary?.text).toContain('已生成 1 张图片');expect(partialSummary?.text).not.toContain('本轮生成任务已结束');
    decision=(await prisma.creativeAgentDecision.findMany({where:{runId:run.id,state:'pending'}}))[0];expect(decision.binding).toMatchObject({stepId:'b',retryLimit:0});
    await store.answerDecision(decision.id,actorUserId,randomUUID(),decision.proposalHash,answer);await reclaim();
    if(answer==='cancel') {
      expect(await resume()).toBe(true);expect(provider).toHaveBeenCalledTimes(1);
      await reclaim();expect(await resume()).toBe(true);expect((await store.getRun(run.id)).status).toBe('completed');expect(provider).toHaveBeenCalledTimes(1);expect(await prisma.creativeAgentDecision.count({where:{runId:run.id,state:'pending'}})).toBe(0);
      expect((await store.getRun(run.id)).input.quantityLedger!.reservations).toHaveLength(1);
      return;
    }
    expect(await resume()).toBe(true);expect(provider).toHaveBeenCalledTimes(2);expect(provider.mock.calls[1][0].prompt).toBe('B original prompt');expect(provider.mock.calls[1][0].imagePaths).toEqual(['/uploads/a.png']);
    await reclaim();
    const latest=await store.getRun(run.id), bound=Object.values(latest.input.generationPlans!).find(p=>p.plan.rootPlanId==='p')!;
    const b=bound.plan.steps.find(step=>step.id==='b')!.receipt!;
    const recovered=await repairPendingToolResults([assistant([{type:'toolCall',id:'different-model-tool-call',name:'image_generate',arguments:{plan:{actionId:bound.id,stepId:'b'}}}], 'toolUse')],createCreativeTools(latest,store,execute,prepare));
    expect(recovered.at(-1)?.role).toBe('toolResult');expect(provider).toHaveBeenCalledTimes(2);
    const second=[...rows.values()][1];second.status='success';second.localPath='/uploads/b.png';
    expect(await resume()).toBe(true);expect((await store.getRun(run.id)).status).toBe('completed');expect(provider).toHaveBeenCalledTimes(2);
    expect((await store.getRun(run.id)).input.quantityLedger!.reservations).toHaveLength(2);
  });

  it("owns new matching snapshots after raw dedup and never upgrades a historical replay", async () => {
    const request = input({ preferences: { imageModel: "legacy-image" } });
    const queued = await store.enqueue(request);
    expect(queued.run.input).toMatchObject({ matchingPolicyVersion: 2, preferences: request.preferences, effectivePreferences: { image: { mode: "explicit", model: "legacy-image" }, video: { mode: "auto" } } });
    const before = await prisma.creativeAgentMessage.findUniqueOrThrow({ where: { id: request.messageId } });
    const historical = { ...queued.run.input }; delete historical.matchingPolicyVersion; delete historical.effectivePreferences;
    await prisma.creativeAgentRun.update({ where: { id: queued.run.id }, data: { input: historical as any } });
    const replay = await store.enqueue(request);
    expect(replay.duplicate).toBe(true); expect(replay.run.input.matchingPolicyVersion).toBeUndefined();
    expect((await store.findSubmission(request))?.run.input).toEqual(historical);
    expect((await prisma.creativeAgentMessage.findUniqueOrThrow({ where: { id: request.messageId } })).inputHash).toBe(before.inputHash);
    await expect(store.findSubmission({ ...request, preferences: { image: { mode: "auto" } } })).rejects.toMatchObject({ code: "message_id_conflict" });
    await store.control(queued.run.id, actorUserId, randomUUID(), "stop");
  });

  it("persists typed temporary requirements through normal tools and keeps defaults and exact approval boundaries", async () => {
    const run = await started({ text: "本次用 chosen-model，1:1", preferences: { image: { mode: "explicit", model: "default", params: { aspectRatio: "16:9" } } } });
    const execute = vi.fn();
    const tools = createCreativeTools(run, store, execute);
    const requirements = tools.find(tool => tool.name === "generation_requirements")!;
    const facts = [
      { field: "image.modelChoice", value: { mode: "explicit", model: "chosen-model" }, strength: "hard", source: { kind: "message", sourceId: run.input.messageId, start: 4, end: 16, quote: "chosen-model" } },
      { field: "image.params.aspectRatio", value: "1:1", strength: "hard", source: { kind: "message", sourceId: run.input.messageId, start: 17, end: 20, quote: "1:1" } },
    ];
    await requirements.execute("requirements", { facts });
    const restored = await new CreativeAgentStore(prisma).getRun(run.id);
    expect(restored.input.effectivePreferences?.image).toEqual({ mode: "explicit", model: "chosen-model", params: { aspectRatio: "1:1" } });
    expect(restored.input.preferences?.image?.model).toBe("default");
    expect(restored.input.requirements?.revision).toBe(1);
    await requirements.execute("requirements-replay", { facts });
    expect((await store.getRun(run.id)).input.requirements?.revision).toBe(1);
    const prepare = vi.fn(async (input: any) => ({ title: "生成确认", question: "确认？", options: [{ value: "approve", label: "确认" }], binding: { kind: "image.generate", argsHash: hash(input.args), units: 1 } }));
    const media = createCreativeTools(restored, store, execute, prepare).find(tool => tool.name === "image_generate")!;
    await expect(media.execute("media", { model: "chosen-model", prompt: "测试", params: { aspectRatio: "16:9" } })).rejects.toMatchObject({ code: "run_deferred" });
    expect(prepare.mock.calls[0][0].args.params.aspectRatio).toBe("1:1");
    expect(execute).not.toHaveBeenCalled();
    await store.control(run.id, actorUserId, randomUUID(), "stop");
  });

  it("uses only this run's semantic answer notes and rejects skipped, foreign and approval sources", async () => {
    const run = await started({ text: "制作图片", preferences: { image: { mode: "auto", params: { resolution: "1K" } } } });
    const prompt = { title: "冲突", question: "分辨率", options: [], fields: [{ id: "size", title: "分辨率", type: "text" as const, semantic: { purpose: "unavailable_requirement" as const, requirement: "image.params.resolution" as const, unresolvedId: "resolution", revision: 0 } }] };
    const decision = await store.ask(run, "notes-source", prompt);
    await store.answerDecision(decision.id, actorUserId, randomUUID(), decision.proposalHash, { values: {}, notes: { size: "本次 2K" } });
    const fact = { field: "image.params.resolution", value: "2K", strength: "hard", source: { kind: "answer", sourceId: decision.id, fieldId: "size", channel: "notes", start: 0, end: 5, quote: "本次 2K" } };
    expect((await store.recordRequirements(run, { facts: [fact] })).effectivePreferences.image.params?.resolution).toBe("2K");
    await expect(store.recordRequirements(run, { facts: [{ ...fact, field: "video.params.resolution" }] })).rejects.toMatchObject({ code: "invalid_requirement_source" });
    await expect(store.recordRequirements(run, { facts: [{ ...fact, source: { ...fact.source, sourceId: randomUUID() } }] })).rejects.toMatchObject({ code: "invalid_requirement_source" });
    const skipped = await store.ask(run, "skipped-source", prompt);
    await store.answerDecision(skipped.id, actorUserId, randomUUID(), skipped.proposalHash, { skipped: true });
    await expect(store.recordRequirements(run, { facts: [{ ...fact, source: { ...fact.source, sourceId: skipped.id } }] })).rejects.toMatchObject({ code: "invalid_requirement_source" });
    const approval = await store.ask(run, "approval-source", { title: "生成", question: "确认", options: [{ value: "approve", label: "2K" }], binding: { kind: "image.generate", argsHash: "x", units: 1 } });
    await store.answerDecision(approval.id, actorUserId, randomUUID(), approval.proposalHash, "approve");
    await expect(store.recordRequirements(run, { facts: [{ ...fact, source: { ...fact.source, sourceId: approval.id } }] })).rejects.toMatchObject({ code: "invalid_requirement_source" });
    await store.finish(run.id, run.epoch, "completed");
  });

  it("deduplicates skipped semantic questions after worker recovery even when IDs and wording change", async () => {
    const run = await started();
    const question = { title: "补充参考", question: "产品图在哪里？", fields: [{ id: "reference", title: "产品图", type: "text", semantic: { purpose: "missing_input", requirement: "references.product", unresolvedId: "product", revision: 0 } }] };
    const execute = vi.fn();
    const tool = createCreativeTools(run, store, execute).find(tool => tool.name === "user_ask")!;
    await expect(tool.execute("question", question)).rejects.toMatchObject({ code: "run_deferred" });
    const decision = (await store.getSemanticQuestions(run.id))[0];
    await store.answerDecision(decision.id, actorUserId, randomUUID(), decision.proposalHash, { skipped: true });
    const restored = (await store.claimRun("semantic-resume", 60000))!;
    const restoredTool = createCreativeTools(restored, store, execute).find(tool => tool.name === "user_ask")!;
    const output = await restoredTool.execute("changed-id", { ...question, question: "请重新提供", fields: [{ ...question.fields[0], id: "newId", semantic: { ...question.fields[0].semantic, unresolvedId: "new-id" } }] });
    expect(output.details).toMatchObject({ result: { suppressed: true, answers: [{ answer: { skipped: true } }] } });
    expect(await store.getSemanticQuestions(run.id)).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled();
    await store.finish(run.id, restored.epoch, "completed");
  });

  it("records broker rejection as evidence for an unavailable-requirement question without dispatch", async () => {
    const run = await started(); const execute = vi.fn();
    const tools = createCreativeTools(run, store, execute, async () => { throw new CreativeAgentError("MEDIA_MODEL_UNAVAILABLE", "当前路线关闭", 400); });
    await expect(tools.find(tool => tool.name === "image_generate")!.execute("bad-route", { model: "disabled", prompt: "产品图" })).rejects.toMatchObject({ code: "MEDIA_MODEL_UNAVAILABLE" });
    const restored = await store.getRun(run.id);
    expect(restored.input.requirements?.unavailable).toContain("image.modelChoice");
    const ask = createCreativeTools(restored, store, execute).find(tool => tool.name === "user_ask")!;
    await expect(ask.execute("necessary", { title: "路线不可用", question: "当前路线已关闭，是否允许调整要求？", fields: [{ id: "constraint", title: "允许调整要求", type: "text", semantic: { purpose: "unavailable_requirement", requirement: "image.modelChoice", unresolvedId: "model-route", revision: 0 } }] })).rejects.toMatchObject({ code: "run_deferred" });
    expect(execute).not.toHaveBeenCalled();
    await store.control(run.id, actorUserId, randomUUID(), "stop");
  });

  it.each(["image", "video"] as const)("round-trips %s broker rejection through leaf and parent questions into field overrides", async media => {
    const run = await started({ text: "按要求生成", preferences: { [media]: { mode: "auto", params: { resolution: "8K" } } } });
    const execute = vi.fn();
    const prepare = vi.fn(async (request: any) => {
      if (request.args.params.resolution === "8K") throw new CreativeAgentError("MEDIA_PARAMS_INVALID", "组合不可用", 400);
      return { title: "确认生成", question: "确认新参数", options: [{ value: "approve", label: "确认" }], binding: { kind: `${media}.generate`, argsHash: hash(request.args), units: 1 } };
    });
    const args = { model: "test-model", prompt: "产品", params: { resolution: "8K", ...(media === "video" ? { inputMode: "text_to_video" } : {}) } };
    const tools = createCreativeTools(run, store, execute, prepare);
    await expect(tools.find(tool => tool.name === `${media}_generate`)!.execute("unsupported", args)).rejects.toMatchObject({ code: "MEDIA_PARAMS_INVALID" });
    const field = `${media}.params.resolution`;
    const ask = tools.find(tool => tool.name === "user_ask")!;
    await expect(ask.execute("leaf", { title: "调整参数", question: "允许怎样调整分辨率？", fields: [{ id: "resolution", title: "分辨率", type: "text", semantic: { purpose: "unavailable_requirement", requirement: field, unresolvedId: "resolution", revision: 0 } }] })).rejects.toMatchObject({ code: "run_deferred" });
    const leaf = (await store.getSemanticQuestions(run.id))[0];
    await store.answerDecision(leaf.id, actorUserId, randomUUID(), leaf.proposalHash, { values: {}, notes: { resolution: "改为2K" } });
    const resumed = (await store.claimRun("leaf-answer", 60000))!;
    const requirements = createCreativeTools(resumed, store, execute, prepare).find(tool => tool.name === "generation_requirements")!;
    await requirements.execute("leaf-requirement", { facts: [{ field, value: "2K", strength: "hard", source: { kind: "answer", sourceId: leaf.id, fieldId: "resolution", channel: "notes", quote: "改为2K" } }] });
    // Previously stored broad parameter questions must also remain answerable,
    // but only for a parameter leaf in that same media family.
    const parent = await store.ask(resumed, `${run.id}:parent-parameter`, { title: "参数组合", question: "如何修改参数组合", options: [], fields: [{ id: "params", title: "参数", type: "text", semantic: { purpose: "unavailable_requirement", requirement: `${media}.params`, unresolvedId: "combination", revision: 1 } }] });
    await store.answerDecision(parent.id, actorUserId, randomUUID(), parent.proposalHash, { values: {}, notes: { params: "本次1K" } });
    const parentSource = { kind: "answer", sourceId: parent.id, fieldId: "params", channel: "notes", quote: "本次1K" };
    await requirements.execute("parent-requirement", { facts: [{ field, value: "1K", strength: "hard", source: parentSource }] });
    await expect(requirements.execute("foreign-leaf", { facts: [{ field: `${media === "image" ? "video" : "image"}.params.resolution`, value: "1K", strength: "hard", source: parentSource }] })).rejects.toMatchObject({ code: "invalid_requirement_source" });
    const restored = await store.getRun(run.id);
    expect(restored.input.effectivePreferences?.[media]?.params?.resolution).toBe("1K");
    expect(restored.input.preferences?.[media]?.params?.resolution).toBe("8K");
    await expect(createCreativeTools(restored, store, execute, prepare).find(tool => tool.name === `${media}_generate`)!.execute("new-plan", args)).rejects.toMatchObject({ code: "run_deferred" });
    expect(prepare.mock.calls.at(-1)![0].args.params.resolution).toBe("1K"); expect(execute).not.toHaveBeenCalled();
    await store.control(run.id, actorUserId, randomUUID(), "stop");
  });

  it.each(["不要随便选", "不要你来决定"])("rejects negative delegation %s through the normal tool without changing saved/effective models", async text => {
    const run = await started({ text, preferences: { image: { mode: "explicit", model: "chosen" } } });
    const execute = vi.fn(); const tool = createCreativeTools(run, store, execute).find(tool => tool.name === "generation_requirements")!;
    await expect(tool.execute("bad-auto", { facts: [{ field: "image.modelChoice", value: { mode: "auto" }, strength: "hard", source: { kind: "message", sourceId: run.input.messageId, quote: text } }] })).rejects.toMatchObject({ code: "invalid_requirement_source" });
    const restored = await store.getRun(run.id);
    expect(restored.input.effectivePreferences?.image?.model).toBe("chosen"); expect(restored.input.requirements).toBeUndefined();
    expect(execute).not.toHaveBeenCalled(); await store.finish(run.id, run.epoch, "completed");
  });

  it("feeds model-visible media revision provenance through the real loop into a new exact approval", async () => {
    const run = await started({ text: "生成产品图", preferences: { image: { mode: "explicit", model: "test-image", params: { resolution: "4K" } } } });
    const execute = vi.fn();
    const args = { model: "test-image", prompt: "产品", params: { count: 1 } };
    const prepare = async (request: any) => ({ title: "确认生成", question: "确认当前参数", options: [{ value: "approve", label: "确认" }], binding: { kind: "image.generate", argsHash: hash(request.args), units: 1 } });
    await runCreativeAgent(run, { store, model, stream: scripted([assistant([{ type: "toolCall", id: "initial-media", name: "image_generate", arguments: args }], "toolUse")]), tools: createCreativeTools(run, store, execute, prepare) });
    const approval = await prisma.creativeAgentDecision.findFirstOrThrow({ where: { runId: run.id } });
    await store.answerDecision(approval.id, actorUserId, randomUUID(), approval.proposalHash, { revision: "改为2K" });
    const resumed = (await store.claimRun("revision-loop", 60000))!;
    let step = 0;
    const stream = vi.fn<StreamFn>((_model, context) => {
      const output = createAssistantMessageEventStream();
      let response: AssistantMessage;
      if (step++ === 0) {
        const result = context.messages.at(-1)!;
        expect(result.role).toBe("toolResult");
        const text = "content" in result && Array.isArray(result.content) ? result.content.find(item => item.type === "text") : undefined;
        const body = JSON.parse(text && "text" in text ? text.text : "{}");
        expect(body.revisionSource).toEqual({ kind: "answer", sourceId: approval.id, channel: "revision", quote: "改为2K" });
        expect(body.decisionId).toBe(approval.id);
        response = assistant([{ type: "toolCall", id: "revision-fact", name: "generation_requirements", arguments: { facts: [{ field: "image.params.resolution", value: "2K", strength: "hard", source: body.revisionSource }] } }], "toolUse");
      } else response = assistant([{ type: "toolCall", id: "revised-media", name: "image_generate", arguments: args }], "toolUse");
      queueMicrotask(() => { output.push({ type: "start", partial: response }); output.push({ type: "done", reason: "toolUse", message: response }); });
      return output;
    });
    await runCreativeAgent(resumed, { store, model, stream, tools: createCreativeTools(resumed, store, execute, prepare) });
    expect(stream).toHaveBeenCalledTimes(2);
    const restored = await store.getRun(run.id);
    expect(restored.input.effectivePreferences?.image?.params?.resolution).toBe("2K");
    const decisions = await prisma.creativeAgentDecision.findMany({ where: { runId: run.id }, orderBy: { createdAt: "asc" } });
    expect(decisions).toHaveLength(2); expect(decisions[1].state).toBe("pending"); expect(decisions[1].proposalHash).not.toBe(approval.proposalHash);
    expect(execute).not.toHaveBeenCalled();
    const receipts = await store.actionReceipts(run.id);
    expect(receipts.some(receipt => (receipt.result as any)?.revisionSource?.sourceId === approval.id)).toBe(true);
    await store.control(run.id, actorUserId, randomUUID(), "stop");
  });

  it("atomically deduplicates original message requests, preserves resolved references, and enforces one writer", async () => {
    const request = input();
    const resolvedSelection = { ...selection, nodeIds: ["fixed-node"] };
    const results = await Promise.all([store.enqueue({ ...request, resolvedSelection }), store.enqueue({ ...request, resolvedSelection })]);
    expect(results.map(result => result.duplicate).sort()).toEqual([false, true]);
    expect(results[0].run.input.selection.nodeIds).toEqual(["fixed-node"]);
    expect((await store.findSubmission(request))?.run.id).toBe(results[0].run.id);
    await expect(store.findSubmission({ ...request, text: "changed" })).rejects.toMatchObject({ code: "message_id_conflict" });
    await expect(store.enqueue(input({ actorUserId: actorUserId + 1 }))).rejects.toMatchObject({ code: "canvas_busy" });
    await expect(store.getRun(results[0].run.id, actorUserId + 1)).rejects.toMatchObject({ status: 404 });
    await store.control(results[0].run.id, actorUserId, randomUUID(), "stop");
  });

  it("journals action results across store recreation and fences stale workers", async () => {
    const run = await started(); const request = { actorUserId, canvasId, runId: run.id, epoch: run.epoch, actionId: randomUUID(), kind: "canvas.create", inputHash: hash({ a: 1 }) };
    const claims = await Promise.all([store.claimAction(request), store.claimAction(request)]);
    expect(claims.filter(value => value.claimed)).toHaveLength(1);
    await store.completeAction(request.actionId, { runId: run.id, epoch: run.epoch, state: "succeeded", result: { nodeIds: ["real-id"] } });
    expect((await new CreativeAgentStore(prisma).getAction(request.actionId)).result).toEqual({ nodeIds: ["real-id"] });
    await store.control(run.id, actorUserId, randomUUID(), "pause");
    await expect(store.appendEvent(run.id, run.epoch, "text.delta", { delta: "late" })).rejects.toMatchObject({ code: "stale_epoch" });
    await store.control(run.id, actorUserId, randomUUID(), "resume");
    const resumed = (await store.claimRun("new-worker", 60000))!;
    expect((await store.claimAction({ ...request, epoch: resumed.epoch })).claimed).toBe(false);
    await store.finish(run.id, resumed.epoch, "completed");
  });

  it("marks expired dispatched actions unknown and forbids automatic resume", async () => {
    const run = await started(); const actionId = randomUUID();
    await store.claimAction({ actorUserId, canvasId, runId: run.id, epoch: run.epoch, actionId, kind: "image.generate", inputHash: "x" });
    await prisma.creativeAgentRun.update({ where: { id: run.id }, data: { leaseExpiresAt: new Date(0) } });
    await store.finish(run.id, run.epoch, "completed");
    expect((await store.getRun(run.id)).status).toBe("running");
    await store.recoverExpired();
    expect((await store.getAction(actionId)).state).toBe("unknown");
    await expect(store.control(run.id, actorUserId, randomUUID(), "resume")).rejects.toMatchObject({ code: "action_outcome_unknown" });
    await store.control(run.id, actorUserId, randomUUID(), "stop");
  });

  it("persists bound approvals across pause, rejects changes and serializes competing answers", async () => {
    const run = await started(); const actionId = randomUUID();
    const prompt = { title: "生成1张", question: "是否确认？", options: [{ value: "approve", label: "确认" }, { value: "cancel", label: "取消" }], binding: { kind: "image.generate", argsHash: "a".repeat(64), units: 1 } };
    const decision = await store.ask(run, actionId, prompt);
    await expect(store.ask(run, actionId, { ...prompt, question: "已改变的确认范围" })).rejects.toMatchObject({ code: "decision_changed" });
    await expect(store.ask(run, actionId, { ...prompt, binding: { ...prompt.binding, units: 2 } })).rejects.toMatchObject({ code: "decision_changed" });
    await store.control(run.id, actorUserId, randomUUID(), "pause");
    await store.control(run.id, actorUserId, randomUUID(), "resume");
    const resumed = (await store.claimRun("resumer", 60000))!;
    expect((await store.ask(resumed, actionId, prompt)).id).toBe(decision.id);
    const answers = await Promise.allSettled([store.answerDecision(decision.id, actorUserId, randomUUID(), decision.proposalHash, "approve"), store.answerDecision(decision.id, actorUserId, randomUUID(), decision.proposalHash, "cancel")]);
    expect(answers.filter(answer => answer.status === "fulfilled")).toHaveLength(1);
    expect((await store.getDecision(decision.id)).binding).toEqual(prompt.binding);
    expect(await store.actionReceipts(run.id)).toHaveLength(0);
    await store.finish(run.id, resumed.epoch, "completed");
  });

  it("executes the real pi loop with injected transport, persists tool calls before dispatch, and deduplicates mutations", async () => {
    const run = await started();
    const args = { nodes: [{ kind: "prompt", title: "大纲", text: "开端、发展、结局。" }] };
    const execute = vi.fn(async () => { const transcript = await store.getTranscript(run.sessionId) as AgentMessage[]; expect(transcript.at(-1)?.role).toBe("assistant"); return { revision: "1", nodeIds: ["node-fixed"] }; });
    const tools = createCreativeTools(run, store, execute);
    const stream = scripted([assistant([{ type: "toolCall", id: "call-1", name: "canvas_create", arguments: args }], "toolUse"), assistant([{ type: "toolCall", id: "call-2", name: "canvas_create", arguments: args }], "toolUse"), assistant([{ type: "text", text: "已保存故事大纲。" }])]);
    await runCreativeAgent(run, { store, model, stream, tools });
    expect(execute).toHaveBeenCalledTimes(1); expect(stream).toHaveBeenCalledTimes(3);
    expect((await store.getRun(run.id)).status).toBe("completed");
    expect((await store.snapshot(actorUserId, canvasId)).messages.map(message => message.role)).toEqual(["user", "assistant"]);
    expect((await store.events(run.id, actorUserId, 0)).events.some(event => event.type === "canvas.committed")).toBe(true);
  });

  it("resumes a committed assistant tool call from its durable receipt without redispatch", async () => {
    const run = await started(); const args = { nodes: [{ kind: "prompt", title: "已有成果" }] }; const callId = "persisted-call";
    const messages: AgentMessage[] = [{ role: "user", content: run.input.text, timestamp: Date.parse(run.createdAt) }, assistant([{ type: "toolCall", id: callId, name: "canvas_create", arguments: args }], "toolUse")];
    await store.saveTranscript(run.id, run.epoch, messages);
    const actionId = creativeActionId(run.id, "canvas.create", args, callId);
    await store.claimAction({ actorUserId, canvasId, runId: run.id, epoch: run.epoch, actionId, kind: "canvas.create", inputHash: hash(args) });
    await store.completeAction(actionId, { runId: run.id, epoch: run.epoch, state: "succeeded", result: { revision: "1", nodeIds: ["existing"] } });
    await store.control(run.id, actorUserId, randomUUID(), "pause"); await store.control(run.id, actorUserId, randomUUID(), "resume");
    const resumed = (await store.claimRun("restored", 60000))!; const execute = vi.fn(); const stream = scripted([assistant([{ type: "text", text: "已恢复并核对成果。" }])]);
    await runCreativeAgent(resumed, { store, model, stream, tools: createCreativeTools(resumed, store, execute) });
    expect(execute).not.toHaveBeenCalled(); expect(stream).toHaveBeenCalledTimes(1);
  });

  it("waits for persisted media approval before claiming or dispatching and replays only the receipt", async () => {
    const run = await started({ preferences: { imageModel: "test-image" } }); const args = { model: "test-image", prompt: "一只猫", params: { count: 1 } };
    const execute = vi.fn(async () => ({ generationId: 12, status: "running" }));
    const prepare = vi.fn(async () => ({ title: "确认1次生成", question: "生成1张图片？", options: [{ value: "approve", label: "确认" }, { value: "cancel", label: "取消" }], binding: { kind: "image.generate", argsHash: hash(args), units: 1 } }));
    const tool = createCreativeTools(run, store, execute, prepare).find(tool => tool.name === "image_generate")!;
    await expect(tool.execute("image-call", args)).rejects.toMatchObject({ code: "run_deferred" });
    expect((await store.getRun(run.id)).workerId).toBeNull();
    expect(execute).not.toHaveBeenCalled(); expect(await store.actionReceipts(run.id)).toHaveLength(0);
    const decision = await prisma.creativeAgentDecision.findFirstOrThrow({ where: { runId: run.id } });
    await store.answerDecision(decision.id, actorUserId, randomUUID(), decision.proposalHash, "approve");
    expect((await store.getRun(run.id)).status).toBe("queued");
    const resumed = (await store.claimRun("resumed-media", 60000))!;
    const resumedTool = createCreativeTools(resumed, store, execute, prepare).find(tool => tool.name === "image_generate")!;
    await resumedTool.execute("image-call", args);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ mediaApproval: { decisionId: decision.id, proposalHash: decision.proposalHash } }));
    await resumedTool.execute("repeat-call", args);
    expect(execute).toHaveBeenCalledTimes(1); expect(prepare).toHaveBeenCalledTimes(2);
    await store.finish(run.id, resumed.epoch, "completed");
  });

  it("never dispatches a cancelled media proposal", async () => {
    const run = await started({ preferences: { videoModel: "mock" } }); const execute = vi.fn();
    const prepare = async () => ({ title: "取消测试", question: "生成？", options: [{ value: "approve", label: "确认" }, { value: "cancel", label: "取消" }], binding: { kind: "video.generate", argsHash: "x", units: 1 } });
    const tool = createCreativeTools(run, store, execute, prepare).find(tool => tool.name === "video_generate")!;
    const args = { model: "mock", prompt: "text", params: { inputMode: "text_to_video" } };
    await expect(tool.execute("cancel-call", args)).rejects.toMatchObject({ code: "run_deferred" });
    const decision = await prisma.creativeAgentDecision.findFirstOrThrow({ where: { runId: run.id } });
    await store.answerDecision(decision.id, actorUserId, randomUUID(), decision.proposalHash, "cancel");
    const resumed = (await store.claimRun("resumed-cancel", 60000))!;
    const resumedTool = createCreativeTools(resumed, store, execute, prepare).find(tool => tool.name === "video_generate")!;
    expect((await resumedTool.execute("cancel-call", args)).details).toMatchObject({ result: { cancelled: true } }); expect(execute).not.toHaveBeenCalled();
    await store.finish(run.id, resumed.epoch, "completed");
  });

  it("truthfully fails a truncated model response", async () => {
    const run = await started(); const stream = scripted([assistant([{ type: "text", text: "半段" }], "length")]);
    await expect(runCreativeAgent(run, { store, model, stream, tools: [] })).rejects.toMatchObject({ code: "MODEL_INCOMPLETE" });
    expect((await store.getRun(run.id)).status).toBe("failed");
  });

  it("recovers failed task inputs, answers and receipts across retries without crossing a completed turn or session", async () => {
    const old = await started({ text: "第一集写64个分镜，使用已有角色" });
    const question = await store.ask(old, "recovery-question", { title: "范围", question: "先做什么？", options: [{ value: "script", label: "只写分镜" }] });
    await store.answerDecision(question.id, actorUserId, randomUUID(), question.proposalHash, "script");
    const action = { actorUserId, canvasId, runId: old.id, epoch: old.epoch, kind: "canvas.create", actionId: randomUUID(), inputHash: "saved-script" };
    await store.claimAction(action);
    await store.completeAction(action.actionId, { runId: old.id, epoch: old.epoch, state: "succeeded", result: { nodeIds: ["saved-node"], revision: "3" } });
    await store.claimAction({ ...action, actionId: randomUUID(), kind: "image.generate", inputHash: "unconfirmed-image" });
    await store.saveAssistant(old.id, old.epoch, "recovery-progress", "前32个镜头已保存，继续后半部分");
    await store.finish(old.id, old.epoch, "failed", "模型超时");

    await prisma.creativeAgentRun.update({where:{id:old.id},data:{input:{...old.input,generationPlans:{saved:{id:"saved",plan:{definition:{steps:[{prompt:"完整不可猜原文"}]}}}},quantityLedger:{version:1,reservations:[{requestKey:"spent-key",phase:"started"}]}}}});
    const retry = await started({ sessionId: old.sessionId, text: "继续上面的任务" });
    const recovered = await store.getRecoveryContext(retry);
    for (const text of ["第一集写64个分镜", "只写分镜", "script", "saved-node", "前32个镜头", "unknown", "image.generate"]) expect(recovered).toContain(text);
    expect(recovered).toContain("完整不可猜原文");
    expect(recovered).toContain("spent-key");
    expect(recovered).toContain("成功操作不要重做");
    expect(recovered).toContain("以当前消息为准");
    expect(await store.getRecoveryContext({ ...retry, actorUserId: actorUserId + 1 })).toBe("");
    expect(await store.getRecoveryContext({ ...retry, sessionId: randomUUID() })).toBe("");
    expect(await store.getRecoveryContext({ ...retry, canvasId: canvasId + 1 })).toBe("");
    await store.finish(retry.id, retry.epoch, "failed", "网络中断");
    const again = await started({ sessionId: old.sessionId, text: "继续中断的任务" });
    expect(await store.getRecoveryContext(again)).toContain("第一集写64个分镜");
    expect(await store.getRecoveryContext(again)).toContain("继续上面的任务");
    await store.finish(again.id, again.epoch, "completed");
    const next = await started({ sessionId: old.sessionId, text: "新的任务" });
    expect(await store.getRecoveryContext(next)).toBe("");
    await store.finish(next.id, next.epoch, "completed");
  });

  it("cascades canvas deletion through the new runtime including control receipts", async () => {
    const run = await started(); const requestId = randomUUID();
    await store.control(run.id, actorUserId, requestId, "stop");
    expect(await prisma.creativeAgentRequest.count({ where: { id: requestId } })).toBe(1);
    await prisma.canvas.delete({ where: { id: canvasId } });
    expect(await prisma.creativeAgentRun.count({ where: { id: run.id } })).toBe(0);
    expect(await prisma.creativeAgentRequest.count({ where: { id: requestId } })).toBe(0);
  });

  it("does not execute an abandoned previous run's pending tool when a new message starts", async () => {
    const old = await started();
    await store.saveTranscript(old.id, old.epoch, [{ role: "user", content: old.input.text, timestamp: Date.parse(old.createdAt) }, assistant([{ type: "toolCall", id: "abandoned", name: "canvas_create", arguments: { nodes: [{ kind: "prompt", title: "旧任务" }] } }], "toolUse")]);
    await store.control(old.id, actorUserId, randomUUID(), "stop");
    const run = await started({ sessionId: old.sessionId, text: "只讨论不要创建" });
    const execute = vi.fn();
    await runCreativeAgent(run, { store, model, stream: scripted([assistant([{ type: "text", text: "讨论方案。" }])]), tools: createCreativeTools(run, store, execute) });
    expect(execute).not.toHaveBeenCalled();
  });

  it("yields the real pi loop at a pending decision and resumes the exact saved tool call", async () => {
    const run = await started(); delete run.input.matchingPolicyVersion; delete run.input.effectivePreferences;
    await prisma.creativeAgentRun.update({ where: { id: run.id }, data: { input: run.input as any } });
    const args = { title: "选择风格", question: "采用哪个风格？", options: [{ value: "a", label: "写实" }, { value: "b", label: "动画" }] };
    const stream = scripted([assistant([{ type: "toolCall", id: "durable-question", name: "user_ask", arguments: args }], "toolUse")]);
    const execute = vi.fn();
    await runCreativeAgent(run, { store, model, stream, tools: createCreativeTools(run, store, execute) });
    expect(stream).toHaveBeenCalledTimes(1);
    expect(await store.getRun(run.id)).toMatchObject({ status: "waiting_decision", workerId: null, leaseExpiresAt: null });
    const transcript = await store.getTranscript(run.sessionId) as AgentMessage[];
    expect(transcript.at(-1)?.role).toBe("assistant");
    expect(transcript.filter(message => message.role === "toolResult")).toHaveLength(0);
    const decision = await prisma.creativeAgentDecision.findFirstOrThrow({ where: { runId: run.id } });
    await store.answerDecision(decision.id, actorUserId, randomUUID(), decision.proposalHash, "a");
    const resumed = (await store.claimRun("answered-worker", 60000))!;
    const afterAnswer = scripted([assistant([{ type: "text", text: "采用写实风格。" }])]);
    await runCreativeAgent(resumed, { store, model, stream: afterAnswer, tools: createCreativeTools(resumed, store, execute) });
    expect((await store.getRun(run.id)).status).toBe("completed");
    expect(afterAnswer).toHaveBeenCalledTimes(1); expect(execute).not.toHaveBeenCalled();
    expect(await prisma.creativeAgentDecision.count({ where: { runId: run.id } })).toBe(1);
  });

  it("does not let waiting users monopolize worker slots and fairly reclaims scheduled media observation", async () => {
    const waiting: Run[] = [];
    for (let i = 0; i < 2; i++) {
      canvasId = (await prisma.canvas.create({ data: { authUserId: actorUserId, title: "Waiting fixture" } })).id;
      const run = await started();
      await store.ask(run, randomUUID(), { title: "选择", question: "确定？", options: [{ value: "yes", label: "是" }] });
      await store.defer(run.id, run.epoch, "waiting_decision"); waiting.push(run);
    }
    canvasId = (await prisma.canvas.create({ data: { authUserId: actorUserId, title: "Media waiting fixture" } })).id;
    const mediaRun = await started(); await store.waitForActions(mediaRun.id, mediaRun.epoch); await store.defer(mediaRun.id, mediaRun.epoch, "waiting_action");
    canvasId = (await prisma.canvas.create({ data: { authUserId: actorUserId, title: "Fresh work fixture" } })).id;
    const fresh = await started(); await store.finish(fresh.id, fresh.epoch, "completed");
    await prisma.creativeAgentRun.update({ where: { id: mediaRun.id }, data: { updatedAt: new Date(Date.now() - 5000) } });
    const observation = (await store.claimRun("media-observer", 60000))!;
    expect(observation.id).toBe(mediaRun.id); expect(observation.epoch).toBeGreaterThan(mediaRun.epoch);
    await store.finish(observation.id, observation.epoch, "completed");
    for (const run of waiting) await store.control(run.id, actorUserId, randomUUID(), "stop");
  });

  it("does not lose an answer arriving between ask and durable yield", async () => {
    const run = await started();
    const decision = await store.ask(run, "fast-answer", { title: "确认", question: "继续？", options: [{ value: "yes", label: "继续" }] });
    await store.answerDecision(decision.id, actorUserId, randomUUID(), decision.proposalHash, "yes");
    expect(await store.defer(run.id, run.epoch, "waiting_decision")).toBe(false);
    expect(await store.getRun(run.id)).toMatchObject({ status: "running", epoch: run.epoch, workerId: "test-worker" });
    await store.finish(run.id, run.epoch, "completed");
  });

  it("emits a generated canvas commit once across repeated polling while remaining recoverable", async () => {
    const run = await started(); const commit = { generationId: 12, revision: "3", nodeIds: ["output"] };
    await Promise.all([store.commitGenerationEvent(run.id, run.epoch, commit), store.commitGenerationEvent(run.id, run.epoch, commit)]);
    expect((await store.events(run.id, actorUserId, 0)).events.filter(event => event.type === "canvas.committed")).toHaveLength(1);
    await store.finish(run.id, run.epoch, "completed");
  });
  it("Task5 preserves late usage after revising an original message without altering the new branch", async () => {
    const run = await started();
    const titleClaim = await store.claimSessionTitle(actorUserId, canvasId, run.sessionId);
    const callId = randomUUID();
    await store.claimAction({ ...run, runId: run.id, actionId: callId, kind: "model.chat", inputHash: hash("old body") });
    const attempt = { callId, runId: run.id, purpose: "main" as const, providerId: "fixture", modelId: "same-model", status: "dispatched" as const, usage: {}, timing: { startedAt: new Date().toISOString(), dispatchedAt: new Date().toISOString() } };
    await store.saveLlmAttempt({ ...run, runId: run.id }, attempt);
    await store.saveTranscript(run.id, run.epoch, [{ role: "user", content: run.input.text, timestamp: Date.parse(run.createdAt) }, assistant([{ type: "text", text: "old branch" }])]);
    await store.reviseMessage(actorUserId, canvasId, { runId: run.id, messageId: run.input.messageId, requestId: randomUUID(), expectedText: run.input.text, text: "只修改结尾" });
    const revised = await store.getRun(run.id);
    await store.finishSessionTitle(run.sessionId, titleClaim!.claimId, titleClaim!.messageId, "迟到的旧分支标题");
    expect((await store.getSession(actorUserId, canvasId, run.sessionId)).title).not.toBe("迟到的旧分支标题");
    const late = { ...attempt, status: "unknown" as const, usage: { inputTokens: 100, outputTokens: 40, reasoningOutputTokens: 30 } };
    await store.saveLlmAttempt({ ...run, runId: run.id }, late); await store.saveLlmAttempt({ ...run, runId: run.id }, late);
    await store.saveLlmAttempt({ ...run, runId: run.id }, { ...late, callId: randomUUID(), purpose: "title", status: "succeeded", usage: { inputTokens: 11, outputTokens: 2 } });
    await expect(store.completeAction(callId, { runId: run.id, epoch: run.epoch, state: "succeeded", result: { text: "late wrong text" } })).rejects.toThrow();
    const restored = new CreativeAgentStore(prisma);
    const snapshot = await restored.snapshot(actorUserId, canvasId, run.sessionId);
    expect(snapshot.usageScopes).toMatchObject({ allAttempts: { calls: 2, usage: { inputTokens: 111, outputTokens: 42, reasoningOutputTokens: 30 }, title: { calls: 1, usage: { inputTokens: 11, outputTokens: 2 } } }, currentRun: { calls: 2 }, currentBranch: { reportedCalls: 0 } });
    expect(snapshot.messages.map(m => m.text)).toEqual(["只修改结尾"]);
    expect(await restored.getRun(run.id)).toMatchObject({ epoch: revised.epoch, status: "queued" });
    expect(await restored.getTranscript(run.sessionId)).toEqual([]);
    const resumed = (await restored.claimRun("test-late-usage", 60000))!;
    expect(await restored.claimAction({ ...resumed, runId: run.id, actionId: callId, kind: "model.chat", inputHash: hash("old body") })).toMatchObject({ claimed: false });
    await store.control(run.id, actorUserId, randomUUID(), "stop");
  });
  it("Task5 titles are claimed once across five minor followups and manual renames win late completion", async () => {
    const run = await started();
    const first = await store.claimSessionTitle(actorUserId, canvasId, run.sessionId);
    expect(first).toMatchObject({ runId: run.id, messageId: run.input.messageId });
    await store.finishSessionTitle(run.sessionId, first!.claimId, first!.messageId, "杯子短片方案");
    await store.finish(run.id, run.epoch, "completed");
    for (let index = 0; index < 5; index++) {
      const next = await started({ sessionId: run.sessionId, text: `调整第${index + 1}处措辞` });
      expect(await store.claimSessionTitle(actorUserId, canvasId, run.sessionId)).toBeNull();
      await store.finish(next.id, next.epoch, "completed");
    }
    await store.renameSession(actorUserId, canvasId, run.sessionId, "我命名的方案");
    await store.finishSessionTitle(run.sessionId, first!.claimId, first!.messageId, "迟到旧标题");
    expect(await store.getSession(actorUserId, canvasId, run.sessionId)).toMatchObject({ title: "我命名的方案", titleSource: "manual" });
  });

  it("Task5 a no-topic title does not consume the first substantive topic or retry the same greeting", async () => {
    const greeting = await started({ text: "你好" });
    const first = (await store.claimSessionTitle(actorUserId, canvasId, greeting.sessionId))!;
    await store.finishSessionTitle(greeting.sessionId, first.claimId, first.messageId, "创作对话");
    expect(await store.claimSessionTitle(actorUserId, canvasId, greeting.sessionId)).toBeNull();
    await store.finish(greeting.id, greeting.epoch, "completed");
    const topic = await started({ sessionId: greeting.sessionId, text: "写一个杯子广告文案" });
    const second = await store.claimSessionTitle(actorUserId, canvasId, greeting.sessionId);
    expect(second).toMatchObject({ runId: topic.id, messageId: topic.input.messageId });
    await store.finishSessionTitle(greeting.sessionId, second!.claimId, second!.messageId, "杯子广告文案");
    expect(await store.claimSessionTitle(actorUserId, canvasId, greeting.sessionId)).toBeNull();
    await store.finish(topic.id, topic.epoch, "completed");
  });

  it("Task5 a completed title metric does not leave a false unknown action blocking resume", async () => {
    const run = await started();
    const attempt = { callId: randomUUID(), runId: run.id, purpose: "title" as const, providerId: "fixture", modelId: "same-model", status: "succeeded" as const, usage: { inputTokens: 10, outputTokens: 2 }, timing: { startedAt: new Date().toISOString(), dispatchedAt: new Date().toISOString() } };
    await store.saveLlmAttempt({ ...run, runId: run.id }, attempt);
    await store.control(run.id, actorUserId, randomUUID(), "pause");
    await expect(store.control(run.id, actorUserId, randomUUID(), "resume")).resolves.toMatchObject({ run: { id: run.id, status: "queued" } });
    await store.control(run.id, actorUserId, randomUUID(), "stop");
  });

  it("Task5 preserves trusted legacy action usage after revision and exposes unverified coverage", async () => {
    const run = await started();
    const knownId = randomUUID(), unknownId = randomUUID(), missingId = randomUUID();
    await store.claimAction({ ...run, runId: run.id, actionId: knownId, kind: "model.chat", inputHash: hash("legacy") });
    const legacy = { ...assistant([{ type: "text", text: "legacy" }]), usage: { input: 10, output: 3, cacheRead: 2, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, creativeUsage: { reported: true } };
    await store.completeAction(knownId, { runId: run.id, epoch: run.epoch, state: "succeeded", result: legacy });
    await store.claimAction({ ...run, runId: run.id, actionId: unknownId, kind: "model.chat", inputHash: hash("legacy-uncertain") });
    await store.claimAction({ ...run, runId: run.id, actionId: missingId, kind: "model.chat", inputHash: hash("legacy-missing") });
    await store.completeAction(missingId, { runId: run.id, epoch: run.epoch, state: "succeeded", result: { creativeUsage: { reported: true } } });
    await store.saveTranscript(run.id, run.epoch, [legacy]);
    await store.reviseMessage(actorUserId, canvasId, { runId: run.id, messageId: run.input.messageId, requestId: randomUUID(), expectedText: run.input.text, text: "修改结尾" });
    const snapshot = await new CreativeAgentStore(prisma).snapshot(actorUserId, canvasId, run.sessionId);
    expect(snapshot.usageScopes?.allAttempts).toMatchObject({ calls: 2, reportedCalls: 1, missingCalls: 1, usage: { inputTokens: 12, outputTokens: 3 }, coverage: { inputTokens: 1, outputTokens: 1 }, legacyUnverifiedCalls: 1, titleCoverage: "linked-calls-only" });
    await store.control(run.id, actorUserId, randomUUID(), "stop");
  });

  it("I1 auxiliary unknown titles never block main resume or enter irreversible recovery context", async () => {
    const run = await started(); const titleId = randomUUID();
    await store.claimSessionTitle(actorUserId, canvasId, run.sessionId);
    await store.saveLlmAttempt({ ...run, runId: run.id }, { callId: titleId, runId: run.id, purpose: "title", providerId: "fixture", modelId: "model", status: "unknown", usage: { inputTokens: 10 }, timing: { startedAt: new Date().toISOString(), dispatchedAt: new Date().toISOString() } });
    await store.control(run.id, actorUserId, randomUUID(), "pause");
    await expect(store.control(run.id, actorUserId, randomUUID(), "resume")).resolves.toMatchObject({ run: { status: "queued" } });
    expect((await store.getAction(titleId)).state).toBe("unknown");
    expect(await store.claimSessionTitle(actorUserId, canvasId, run.sessionId)).toBeNull();
    const resumed = (await store.claimRun("title-only-recovery", 60000))!;
    await store.claimAction({ ...resumed, runId: run.id, actionId: randomUUID(), kind: "model.chat", inputHash: hash("uncertain-main") });
    await store.control(run.id, actorUserId, randomUUID(), "pause");
    await expect(store.control(run.id, actorUserId, randomUUID(), "resume")).rejects.toMatchObject({ code: "action_outcome_unknown" });
    await store.control(run.id, actorUserId, randomUUID(), "stop");
    const next = await started({ sessionId: run.sessionId });
    expect(await store.getRecoveryContext(next)).not.toContain(titleId);
    expect((await store.snapshot(actorUserId, canvasId, run.sessionId)).usageScopes?.allAttempts.title).toMatchObject({ calls: 1, unknownCalls: 1, usage: { inputTokens: 10 } });
    await store.control(next.id, actorUserId, randomUUID(), "stop");
  });

  it("I4 actual store revision during final main preparation rejects transport", async () => {
    const f = await reviewTransportFixture(); const run = await started({ model: { providerId: "test", modelId: "injected-test" } });
    try {
      let reads = 0;
      f.resolve.mockImplementation(async () => { if (++reads === 3) await store.reviseMessage(actorUserId, canvasId, { runId: run.id, messageId: run.input.messageId, requestId: randomUUID(), expectedText: run.input.text, text: "改成新要求" }); return { status: "ready", route: f.route }; });
      const { createCreativeAgentModelStream } = await import("@/lib/creative-agent/llm-broker");
      const stream = await createCreativeAgentModelStream({ ...run, runId: run.id, options: run.input });
      expect((await stream.stream(stream.model, { messages: [{ role: "user", content: run.input.text, timestamp: Date.parse(run.createdAt) }] }).result()).stopReason).toBe("error");
      expect(f.fetch).not.toHaveBeenCalled();
      for (let n = 0; n < 100 && (await store.snapshot(actorUserId, canvasId, run.sessionId)).usageScopes?.allAttempts.pendingIntentCalls; n++) await new Promise(r => setTimeout(r, 5));
      const snapshot = await store.snapshot(actorUserId, canvasId, run.sessionId);
      expect(snapshot.run).toMatchObject({ status: "queued" });
      expect(snapshot.usageScopes?.allAttempts).toMatchObject({ calls: 0, pendingIntentCalls: 0 });
    } finally { await store.control(run.id, actorUserId, randomUUID(), "stop"); await f.restore(); }
  });
  it.each(["rename", "revise"])("I4 actual title claim invalidated by %s cannot dispatch", async change => {
    const f = await reviewTransportFixture(); const run = await started({ model: { providerId: "test", modelId: "injected-test" } });
    try {
      let reads = 0;
      f.resolve.mockImplementation(async () => {
        if (++reads === 3) {
          if (change === "rename") await store.renameSession(actorUserId, canvasId, run.sessionId, "手工名称");
          else await store.reviseMessage(actorUserId, canvasId, { runId: run.id, messageId: run.input.messageId, requestId: randomUUID(), expectedText: run.input.text, text: "修改要求" });
        }
        return { status: "ready", route: f.route };
      });
      const { generateCreativeAgentSessionTitle } = await import("@/lib/creative-agent/session-title");
      await generateCreativeAgentSessionTitle(actorUserId, canvasId, run.sessionId);
      expect(f.fetch).not.toHaveBeenCalled();
      expect((await store.snapshot(actorUserId, canvasId, run.sessionId)).usageScopes?.allAttempts).toMatchObject({ calls: 0, pendingIntentCalls: 0 });
      if (change === "rename") expect((await store.getSession(actorUserId, canvasId, run.sessionId)).title).toBe("手工名称");
    } finally { await store.control(run.id, actorUserId, randomUUID(), "stop"); await f.restore(); }
  });
  it("I5 actual worker startup replays a succeeded journal after a transcript-write crash with the model now hidden", async () => {
    const { createEmptyCanvasDocumentV2 } = await import("@/lib/canvas/document");
    await prisma.canvas.update({ where: { id: canvasId }, data: { data: createEmptyCanvasDocumentV2() as any } });
    const f = await reviewTransportFixture(); const { run: queued } = await store.enqueue(input({ model: { providerId: "test", modelId: "injected-test" } }));
    const savedTranscript = f.singleton.saveTranscript.bind(f.singleton);
    let lostTranscript = false, failedWorker = false; let crashMessage: unknown;
    const transcript = vi.spyOn(f.singleton, "saveTranscript").mockImplementation(async (id, epoch, messages) => { if (messages.some((m: any) => m.role === "assistant")) { lostTranscript = true; crashMessage = messages.at(-1); throw new Error("simulated process loss before transcript persistence"); } return savedTranscript(id, epoch, messages); });
    const finish = vi.spyOn(f.singleton, "finish").mockImplementation(async () => { failedWorker = true; });
    const until = async (test: () => Promise<boolean>) => { for (let n = 0; n < 200; n++) { if (await test()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error("worker did not settle"); };
    try {
      const { runCreativeAgentWorkerTick } = await import("@/lib/creative-agent/worker");
      await runCreativeAgentWorkerTick();
      await until(async () => lostTranscript && failedWorker);
      await new Promise(r => setTimeout(r, 20));
      expect((await store.actionReceipts(queued.id)).filter(a => a.kind === "model.chat"), JSON.stringify(crashMessage)).toMatchObject([{ state: "succeeded" }]);
      expect((await store.getTranscript(queued.sessionId)).some((m: any) => m.role === "assistant")).toBe(false);
      transcript.mockRestore(); finish.mockRestore();
      await prisma.creativeAgentRun.update({ where: { id: queued.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
      await store.recoverExpired();
      f.resolve.mockResolvedValue({ status: "model-disabled" }); f.fetch.mockClear();
      await store.control(queued.id, actorUserId, randomUUID(), "resume");
      await runCreativeAgentWorkerTick();
      await until(async () => ["completed", "failed"].includes((await store.getRun(queued.id)).status));
      expect((await store.getRun(queued.id)).status).toBe("completed");
      expect(f.fetch).not.toHaveBeenCalled();
      expect((await store.getTranscript(queued.sessionId)).filter((m: any) => m.role === "assistant")).toMatchObject([{ content: [{ type: "text", text: "已保存的原始回答" }] }]);
      expect((await store.actionReceipts(queued.id)).filter(a => a.kind === "model.chat")).toHaveLength(1);
      const next = await store.enqueue(input({ sessionId: queued.sessionId, text: "真正的新要求", model: { providerId: "test", modelId: "injected-test" } }));
      await runCreativeAgentWorkerTick();
      await until(async () => (await store.getRun(next.run.id)).status === "failed");
      expect(f.fetch).not.toHaveBeenCalled();
    } finally { transcript.mockRestore(); finish.mockRestore(); await store.control(queued.id, actorUserId, randomUUID(), "stop").catch(() => undefined); await f.restore(); }
  });

  it("I2 a known HTTP title rejection remains a failed receipt rather than unknown", async () => {
    const f = await reviewTransportFixture(); const run = await started({ model: { providerId: "test", modelId: "injected-test" } });
    try {
      f.fetch.mockResolvedValue(Response.json({ error: { message: "fixture rejected" }, usage: { prompt_tokens: 11, completion_tokens: 0 } }, { status: 401 }));
      await (await import("@/lib/creative-agent/session-title")).generateCreativeAgentSessionTitle(actorUserId, canvasId, run.sessionId);
      expect((await store.actionReceipts(run.id)).filter(a => a.kind === "model.title")).toMatchObject([{ state: "failed", result: { creativeAttempt: { status: "failed", usage: { inputTokens: 11, outputTokens: 0 } } } }]);
      expect(await store.claimSessionTitle(actorUserId, canvasId, run.sessionId)).toBeNull();
    } finally { await store.control(run.id, actorUserId, randomUUID(), "stop"); await f.restore(); }
  });

  it.each(["late-revision", "title-write-failure"])("I3/I4 already dispatched title retains actual usage after %s", async failure => {
    const f = await reviewTransportFixture(); const run = await started({ model: { providerId: "test", modelId: "injected-test" } });
    const apply = failure === "title-write-failure" ? vi.spyOn(f.singleton, "finishSessionTitle").mockRejectedValue(new Error("injected application write failure")) : undefined;
    try {
      f.fetch.mockImplementation(async () => {
        if (failure === "late-revision") await store.reviseMessage(actorUserId, canvasId, { runId: run.id, messageId: run.input.messageId, requestId: randomUUID(), expectedText: run.input.text, text: "新分支要求" });
        return Response.json({ choices: [{ message: { content: '{"title":"旧标题"}' } }], usage: { prompt_tokens: 11, completion_tokens: 7, completion_tokens_details: { reasoning_tokens: 6 } } });
      });
      const { generateCreativeAgentSessionTitle } = await import("@/lib/creative-agent/session-title");
      await generateCreativeAgentSessionTitle(actorUserId, canvasId, run.sessionId);
      expect((await store.getSession(actorUserId, canvasId, run.sessionId)).title).not.toBe("旧标题");
      expect((await store.actionReceipts(run.id)).filter(a => a.kind === "model.title")).toMatchObject([{ state: "succeeded", result: { creativeAttempt: { status: "succeeded", usage: { inputTokens: 11, outputTokens: 7, reasoningOutputTokens: 6 } } } }]);
      expect((await store.snapshot(actorUserId, canvasId, run.sessionId)).usageScopes?.allAttempts.title).toMatchObject({ calls: 1, reportedCalls: 1, usage: { inputTokens: 11, outputTokens: 7 } });
      await generateCreativeAgentSessionTitle(actorUserId, canvasId, run.sessionId);
      expect(f.fetch).toHaveBeenCalledOnce();
      if (failure === "late-revision") expect(await store.getRun(run.id)).toMatchObject({ status: "queued" });
    } finally { apply?.mockRestore(); await store.control(run.id, actorUserId, randomUUID(), "stop"); await f.restore(); }
  });

});
