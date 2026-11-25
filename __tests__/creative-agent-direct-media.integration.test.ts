import preparationFixture from './fixtures/creative-agent-preparation-status.json';
import {withCreativeDebug,type TraceWrite} from '@/lib/creative-agent/debug-trace';
import quantityErrorsFixture from './fixtures/creative-agent-quantity-errors.json';
import wideQuantityFixture from './fixtures/creative-agent-wide-quantity-evidence.json';
import {advancePersistedPlan} from '@/lib/creative-agent/plan-runtime';
import * as planning from '@/lib/creative-agent/generation-plan';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import prisma from '@/lib/prisma';
import {CreativeAgentStore} from '@/lib/creative-agent/store';
import {createCreativeTools} from '@/lib/creative-agent/tools';
import {prepareCreativeAgentMedia,executeCreativeAgentMediaTool,claimCreativeAgentMediaApproval} from '@/lib/creative-agent/media-broker';
import {getImageModelParams} from '@/lib/generation/image-model-params';
vi.mock('@/lib/creative-agent/access',()=>({requireCreativeAgentEnabled:vi.fn(),requireCreativeAgentCanvas:vi.fn()}));
const store=new CreativeAgentStore(prisma);let actorUserId:number;
async function setup(text:string,legacy=false,preferences:any={image:{mode:'auto',params:{resolution:'4K',aspectRatio:'16:9'}}}){
 const canvasId=(await prisma.canvas.create({data:{authUserId:actorUserId,title:'direct auth fixture'}})).id;
 const queued=await store.enqueue({actorUserId,canvasId,messageId:randomUUID(),text,baseRevision:'0',selection:{nodeIds:[],edgeIds:[],references:[]},preferences});
 const run=(await store.claimRun('direct-auth',60000))!;expect(run.id).toBe(queued.run.id);
 if(legacy){delete run.input.mediaAuthorizationVersion;await prisma.creativeAgentRun.update({where:{id:run.id},data:{input:run.input as any}});}
 const provider=vi.fn(async(request:any)=>{const row=await prisma.generation.create({data:{authUserId:actorUserId,canvasId,source:'agent',type:'image_edit',model:request.model,prompt:request.prompt,requestKey:request.requestKey,status:'running',templateData:JSON.stringify(request)}});return {generationId:row.id,status:'running' as const};});
 const catalog={image:[{id:'gpt-image-2-openrouter',label:'Fixture image',params:{...getImageModelParams('gpt-image-2-openrouter'),defaultQuality:''},qualification:{available:true,reasons:[],entitlement:'unverified',providerId:'openrouter',adapterId:'gpt-image-2-openrouter',routeConfigFingerprint:'fixture'}}],video:[]};
 const deps:any={readCanvas:async()=>({revision:'0',nodes:[],edgeIds:[]}),catalog:async()=>catalog,claimApproval:claimCreativeAgentMediaApproval,createImage:provider,createVideo:vi.fn(),findGeneration:async(q:any)=>prisma.generation.findFirst({where:q}),beforeDispatch:async(i:any)=>store.assertFence(i.runId,i.epoch),markDispatchStarted:async(i:any,key:string)=>store.transitionGenerationStep({...run,epoch:i.epoch},key,'started'),finalize:vi.fn(),attach:vi.fn()};
 const call=(args:any,intercept?:(input:any)=>Promise<void>)=>createCreativeTools(run,store,async input=>{await intercept?.(input);return executeCreativeAgentMediaTool(input,deps);},input=>prepareCreativeAgentMedia(input,deps)).find(t=>t.name==='image_generate')!.execute(randomUUID(),args);
 return {run,provider,catalog,deps,call,fact:(field:string,value:unknown,quote:string)=>({field,value,strength:'hard',source:{kind:'message',sourceId:run.input.messageId,quote}}),close:()=>store.control(run.id,actorUserId,randomUUID(),'stop').catch(()=>undefined)};
}
describe.skipIf(process.env.CREATIVE_AGENT_DB_TEST!=='1')('trusted direct media authorization with actual store and broker',()=>{
 beforeAll(async()=>{actorUserId=(await prisma.user.create({data:{username:`direct-${randomUUID()}`,password:'fixture'}})).id;});
 afterAll(async()=>{if(actorUserId)await prisma.user.delete({where:{id:actorUserId}});await prisma.$disconnect();});
 it('directly dispatches the exact temporary user specification once, with a durable distinct authorization and no approval card',async()=>{
  const f=await setup('生成一张2K、3:4海报，模型智能匹配');try{
   const args={prompt:'poster brief',facts:[f.fact('image.quantity',1,'一张'),f.fact('image.params.resolution','2K','2K'),f.fact('image.params.aspectRatio','3:4','3:4')]};
   const first=await f.call(args);await f.call(args);
   expect(f.provider).toHaveBeenCalledTimes(1);expect(f.provider.mock.calls[0][0]).toMatchObject({resolution:'2K',aspectRatio:'3:4'});
   expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id}})).toBe(0);
   const saved=await store.getRun(f.run.id);expect(saved.input.quantityLedger?.reservations).toHaveLength(1);
   expect((first.details as any).result.mediaRequest.authorization).toMatchObject({version:1,runId:f.run.id,mediaType:'image'});
  }finally{await f.close();}
 });
 it('dispatches a selected-skill natural request using exact fixed preferences and unchanged source offsets',async()=>{
  const text='/skill:personal:21 需要一张背景图，什么都可以';
  const f=await setup(text,false,{image:{mode:'explicit',model:'gpt-image-2-openrouter',params:{resolution:'2K',aspectRatio:'3:4'}}});
  try{await f.call({prompt:'background',facts:[f.fact('image.quantity',1,'一张背景图')]});expect(f.provider).toHaveBeenCalledTimes(1);expect(f.provider.mock.calls[0][0]).toMatchObject({model:'gpt-image-2-openrouter',resolution:'2K',aspectRatio:'3:4'});expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id}})).toBe(0);const saved=await store.getRun(f.run.id);expect(saved.input.text).toBe(text);const source=saved.input.requirements?.facts.find(f=>f.field==='image.quantity')?.source;expect(source).toMatchObject({quote:'一张背景图',start:text.indexOf('一张背景图'),sourceId:f.run.input.messageId});}finally{await f.close();}
 });
 it.each(["/skill:personal:21","/skill:personal:21 不要生成图片","/skill:personal:21 只准备图片方案，不要生成","/skill:personal:21 生成图片有什么限制？","/skill:personal:0 生成一张图片","想要一张图片的提示词。","需要一张图片的提示词！","生成一张图片，但不要生成。","暂不考虑生成图片", "我不打算生成图片", "尚未决定生成图片", "我没准备让你生成图片", "生成一张图片需要哪些参数？", "生成图片有什么限制？", "生成图片用什么格式", "生成图片支持透明背景吗？", "What parameters do I need to generate an image?", "Which settings are used to create a photo?",'请不要帮我生成一张图片','不要为我生成图片','I do not want you to generate an image','生成一张图片需要多少钱？','> 生成一张图片','只准备图片方案，不要生成','模型智能匹配','解释“生成一张图片”这句话'])('never turns untrusted or prepare-only text into a media dispatch: %s',async text=>{
  const f=await setup(text);try{await expect(f.call({prompt:'brief'})).rejects.toMatchObject({code:'MEDIA_AUTHORIZATION_REQUIRED'});expect(f.provider).not.toHaveBeenCalled();expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id}})).toBe(0);}finally{await f.close();}
 });
 it.each(['生成一个家庭背景','需要一个办公室场景','需要一张背景图，什么都可以','我现在需要一张家庭背景图','我上传了一张产品图，现在需要升成一个家庭背景图'])('accepts natural current generation without a repeated confirmation: %s',async text=>{
  const f=await setup(text);try{const quote=text==='生成一个家庭背景'?'一个家庭背景':text==='需要一个办公室场景'?'一个办公室场景':text.includes('一个')?'一个家庭背景图':text.includes('家庭')?'一张家庭背景图':'一张背景图';await f.call({prompt:'background',facts:[f.fact('image.quantity',1,quote)]});expect(f.provider).toHaveBeenCalledTimes(1);expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id}})).toBe(0);}finally{await f.close();}
 });
 it.each(['forged-proof','changed-revision','changed-message','legacy-marker','changed-binding','expired-binding'])('broker rechecks trusted authorization under the action lock: %s',async scenario=>{
  const f=await setup('生成一张图片');try{await expect(f.call({prompt:'brief'},async input=>{
   if(scenario==='forged-proof')input.mediaAuthorization.sourceHash='forged';
   if(scenario==='changed-binding')input.mediaAuthorization.bindingHash='forged';
   if(scenario==='expired-binding')input.matching.execution.expiresAt='2000-01-01T00:00:00Z';
   if(['changed-revision','changed-message','legacy-marker'].includes(scenario)){const saved=await store.getRun(f.run.id);if(scenario==='changed-revision')saved.input.revision=1;if(scenario==='changed-message')saved.input.text='不要生成图片';if(scenario==='legacy-marker')delete saved.input.mediaAuthorizationVersion;await prisma.creativeAgentRun.update({where:{id:f.run.id},data:{input:saved.input as any}});}
  })).rejects.toBeDefined();expect(f.provider).not.toHaveBeenCalled();expect((await store.getRun(f.run.id)).input.quantityLedger?.reservations??[]).toHaveLength(0);}finally{await f.close();}
 });
 it('rejects a forged quantity quote without falling back or asking a media approval',async()=>{const f=await setup('生成一张图片');try{await expect(f.call({prompt:'brief',facts:[f.fact('image.quantity',3,'三张图片')]})).rejects.toMatchObject({code:'invalid_requirement_source'});expect(f.provider).not.toHaveBeenCalled();expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id}})).toBe(0);}finally{await f.close();}});
 it('keeps an uncertain dispatch reserved and never resubmits it',async()=>{const f=await setup('生成一张图片');try{f.provider.mockRejectedValue(new Error('transport lost after dispatch'));await expect(f.call({prompt:'brief'})).rejects.toMatchObject({code:'MEDIA_DISPATCH_UNKNOWN'});await expect(store.control(f.run.id,actorUserId,randomUUID(),'resume')).rejects.toMatchObject({code:'action_outcome_unknown'});await expect(f.call({prompt:'brief'})).rejects.toMatchObject({code:'stale_epoch'});expect(f.provider).toHaveBeenCalledTimes(1);expect((await store.getRun(f.run.id)).input.quantityLedger?.reservations).toHaveLength(1);const snapshot=await store.snapshot(actorUserId,f.run.canvasId,f.run.sessionId);const row=('activity' in snapshot?snapshot.activity:[]).find(row=>row.event.payload.name==='image.generate');expect(row?.event.payload.detail).toMatchObject({receiptState:'unknown',code:'MEDIA_DISPATCH_UNKNOWN'});expect(row?.event.payload.detail).not.toHaveProperty('dispatched',false);}finally{await f.close();}});
 it('R22 retains actual rejected arguments beside a corrected successful attempt and matching inspector evidence',async()=>{const f=await setup(preparationFixture.text,false,{image:{mode:'auto',params:{resolution:'2K',aspectRatio:'3:4'}}});const traces:TraceWrite[]=[];try{const calls=structuredClone(preparationFixture.calls);for(const call of calls)for(const fact of call.arguments.facts)fact.source.sourceId=f.run.input.messageId;await expect(withCreativeDebug({runId:f.run.id,actorUserId,canvasId:f.run.canvasId,epoch:f.run.epoch},()=>f.call(calls[0].arguments),async row=>{traces.push(row);})).rejects.toMatchObject({code:'invalid_requirement_source'});expect(traces.find(row=>row.type==='tool.failed')).toMatchObject({title:'准备图片生成 · 未通过（未提交）',detail:{phase:'preflight',dispatched:false,code:'invalid_requirement_source'}});await f.call(calls[1].arguments);expect(f.provider).toHaveBeenCalledTimes(1);const snapshot=await store.snapshot(actorUserId,f.run.canvasId,f.run.sessionId);const activity=('activity' in snapshot?snapshot.activity:[]).filter(row=>row.event.payload.name==='image.generate');expect(activity).toHaveLength(2);expect(activity.filter(row=>row.event.payload.status==='error')).toHaveLength(1);expect(activity.find(row=>row.event.payload.status==='error')?.event.payload.detail).toMatchObject({phase:'preflight',dispatched:false,code:'invalid_requirement_source'});expect(activity.filter(row=>row.event.payload.status==='success')).toHaveLength(1);}finally{await f.close();}});
 it.each(['facts','authorization'])('R22 persists an unsubmitted preparation rejection for %s',async scenario=>{const f=await setup(scenario==='facts'?'生成一张图片':'只准备图片方案');try{const args={prompt:'brief',...(scenario==='facts'?{facts:[f.fact('generation.initialCalls',1,'一张图片')]}:{})};await expect(f.call(args)).rejects.toMatchObject({code:scenario==='facts'?'invalid_requirement_source':'MEDIA_AUTHORIZATION_REQUIRED'});const snapshot=await new CreativeAgentStore(prisma).snapshot(actorUserId,f.run.canvasId,f.run.sessionId);const activity=('activity' in snapshot?snapshot.activity:[]).filter(row=>row.event.payload.name==='image.generate');expect(activity).toHaveLength(1);expect(activity[0].event.payload).toMatchObject({status:'error',detail:{phase:'preflight',dispatched:false,code:scenario==='facts'?'invalid_requirement_source':'MEDIA_AUTHORIZATION_REQUIRED'}});expect(f.provider).not.toHaveBeenCalled();}finally{await f.close();}});
 it('R22 records known broker rejection before dispatch without a generation failure',async()=>{const f=await setup('生成一张图片');try{f.deps.beforeDispatch=async()=>{throw new Error('changed before submit');};await expect(f.call({prompt:'brief'})).rejects.toMatchObject({code:'MEDIA_NOT_DISPATCHED'});expect(f.provider).not.toHaveBeenCalled();const snapshot=await store.snapshot(actorUserId,f.run.canvasId,f.run.sessionId);const row=('activity' in snapshot?snapshot.activity:[]).find(row=>row.event.payload.name==='image.generate');expect(row?.event.payload.detail).toMatchObject({phase:'preflight',dispatched:false,code:'MEDIA_NOT_DISPATCHED'});}finally{await f.close();}});
 it('R22 never labels a partially submitted batch as unsubmitted',async()=>{const f=await setup('生成两张图片');try{f.deps.beforeDispatch=async()=>{if(f.provider.mock.calls.length===1)throw new Error('before second dispatch');};await expect(f.call({prompt:'two',params:{count:2},facts:[f.fact('image.quantity',2,'两张图片')]})).rejects.toMatchObject({code:'MEDIA_NOT_DISPATCHED'});expect(f.provider).toHaveBeenCalledTimes(1);const snapshot=await store.snapshot(actorUserId,f.run.canvasId,f.run.sessionId);const row=('activity' in snapshot?snapshot.activity:[]).find(row=>row.event.payload.name==='image.generate');expect(row?.event.payload.detail).toMatchObject({dispatchState:'partial'});expect(row?.event.payload.detail).not.toHaveProperty('dispatched',false);}finally{await f.close();}});
 it('R21 dispatches exact parameters accompanying a counted delivery phrase',async()=>{const f=await setup('一张家庭背景图，16:9，2K');try{await f.call({prompt:'family background',facts:[f.fact('image.quantity',1,'一张家庭背景图'),f.fact('image.params.aspectRatio','16:9','16:9'),f.fact('image.params.resolution','2K','2K')]});expect(f.provider).toHaveBeenCalledTimes(1);expect(f.provider.mock.calls[0][0]).toMatchObject({resolution:'2K',aspectRatio:'16:9'});expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id}})).toBe(0);}finally{await f.close();}});
 it.each(["一张我已经拍摄的照片", "一张明天再画的图片", "一张等审批后再画的图片", "一张我刚画的图片", "一张待分析的图片", "一张需要分析的图片", "一张仅供分析的图片", "一张待分析图片", "一张明天再画图片", "一张我刚画图片", "一张用来分析的图片", "一张正在拍摄的照片"])('R21R1 rejects non-current or analysis modifiers before dispatch: %s',async text=>{const f=await setup(text);try{await expect(f.call({prompt:'background'})).rejects.toMatchObject({code:'MEDIA_AUTHORIZATION_REQUIRED'});expect(f.provider).not.toHaveBeenCalled();expect((await store.getRun(f.run.id)).input.quantityLedger?.reservations??[]).toHaveLength(0);expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id}})).toBe(0);}finally{await f.close();}});
 it.each(['auto','explicit'] as const)('R21 executes a selected-skill counted background directly with %s preferences and no references',async mode=>{
  const f=await setup('/skill:personal:21 一张家庭背景图',false,{image:{mode,...(mode==='explicit'?{model:'gpt-image-2-openrouter'}:{}),params:{resolution:'2K'}}});
  try{const args={prompt:'A lived-in family room background',facts:[f.fact('image.quantity',1,'一张家庭背景图')]};await f.call(args);expect(f.provider).toHaveBeenCalledTimes(1);expect(f.provider.mock.calls[0][0]).toMatchObject({model:'gpt-image-2-openrouter',resolution:'2K'});expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id}})).toBe(0);const current=await store.getRun(f.run.id);expect(Object.values(current.input.generationPlans!)[0].plan.steps[0].receipt?.request.references).toEqual([]);await f.call(args);expect(f.provider).toHaveBeenCalledTimes(1);}finally{await f.close();}
 });
 it.each(['已有一张图片','一张已上传的图片','一张图片？','一张图片的提示词','一张图片，但不要图片','一张图片，等我确认后生成'])('R21 never dispatches a non-request counted phrase: %s',async text=>{
  const f=await setup(text);try{await expect(f.call({prompt:'background'})).rejects.toMatchObject({code:'MEDIA_AUTHORIZATION_REQUIRED'});expect(f.provider).not.toHaveBeenCalled();expect((await store.getRun(f.run.id)).input.quantityLedger?.reservations??[]).toHaveLength(0);}finally{await f.close();}
 });
 it.each(['两张森林风景图片','两张家庭背景图，不要文字'])('R21 requires the full counted batch rather than authorizing a one-output shortcut: %s',async text=>{const f=await setup(text);try{await expect(f.call({prompt:'forest'})).rejects.toMatchObject({code:'GENERATION_PLAN_INCOMPLETE'});expect(f.provider).not.toHaveBeenCalled();}finally{await f.close();}});
 it('reports all live fact errors atomically without persisting valid partial facts',async()=>{
  const f=await setup(quantityErrorsFixture.text,false,{image:{mode:'auto'}});
  try{
   const before=await store.getRun(f.run.id);const args=structuredClone(quantityErrorsFixture.calls[0].arguments);args.facts.forEach(fact=>fact.source.sourceId=f.run.input.messageId);
   let failure:unknown;try{await createCreativeTools(f.run,store,vi.fn()).find(t=>t.name==='generation_plan')!.execute('all-fact-errors',args);}catch(error){failure=error;}
   expect(failure).toMatchObject({code:'invalid_requirement_source'});expect(String(failure)).toContain('facts[1] (image.quantity)');expect(String(failure)).toContain('facts[2] (generation.finalOutputs)');
   const after=await store.getRun(f.run.id);expect(after.input.requirements).toEqual(before.input.requirements);expect(after.input.effectivePreferences).toEqual(before.input.effectivePreferences);expect(after.input.generationPlans).toEqual(before.input.generationPlans);
   expect(f.provider).not.toHaveBeenCalled();expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id}})).toBe(0);expect(after.input.quantityLedger?.reservations??[]).toHaveLength(0);
  }finally{await f.close();}
 });
 it('prepares all actual wide-quote plan steps without media dispatch or dropping quantity facts',async()=>{
  const f=await setup(wideQuantityFixture.text,false,{image:{mode:'auto'}});const original=planning.createCreativeGenerationPlan;
  const planSpy=vi.spyOn(planning,'createCreativeGenerationPlan').mockImplementation(input=>original(input,f.deps));
  try{
   const args=structuredClone(wideQuantityFixture.calls[2].arguments);args.facts.forEach(fact=>fact.source.sourceId=f.run.input.messageId);
   const result=await createCreativeTools(f.run,store,vi.fn()).find(t=>t.name==='generation_plan')!.execute('wide-quote-plan',args);
   const current=await store.getRun(f.run.id);const saved=current.input.generationPlans?.[(result.details as any).actionId];
   expect(saved?.plan.steps.map(step=>step.status)).toEqual(['ready','ready','ready']);
   expect(current.input.requirements?.facts.find(fact=>fact.field==='generation.totalOutputs')).toMatchObject({value:3,source:{quote:args.facts[1].source.quote,valueStart:wideQuantityFixture.text.indexOf('三张')}});
   expect(current.input.requirements?.facts.find(fact=>fact.field==='intent')?.value).toBe('prepare');
   expect(f.provider).not.toHaveBeenCalled();expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id}})).toBe(0);expect(current.input.quantityLedger?.reservations??[]).toHaveLength(0);
  }finally{planSpy.mockRestore();await f.close();}
 });
 it.each(['生成三张海报中的一张','生成一张包含三张海报的拼贴'])('executes only the requested single subset or composite output: %s',async text=>{
  const f=await setup(text);try{
   const args={prompt:'single requested result',params:{count:1},...(text.includes('中的')?{facts:[f.fact('image.quantity',1,'一张')]}:{})};
   await f.call(args);expect(f.provider).toHaveBeenCalledTimes(1);expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id}})).toBe(0);expect((await store.getRun(f.run.id)).input.quantityLedger?.reservations).toHaveLength(1);await f.call(args);expect(f.provider).toHaveBeenCalledTimes(1);
  }finally{await f.close();}
 });
 it('executes a single output after a saved current final-output answer reduces the original image batch',async()=>{
  const f=await setup('生成两张图片');try{
   const tool=createCreativeTools(f.run,store,vi.fn()).find(t=>t.name==='user_ask')!;
   await expect(tool.execute('final-count',{title:'最终数量',question:'最终需要几张图片？',fields:[{id:'final',title:'最终图片数量',type:'number',required:true,semantic:{purpose:'missing_input',requirement:'generation.finalOutputs',unresolvedId:'final-count',revision:0}}]})).rejects.toMatchObject({code:'run_deferred'});
   const decision=await prisma.creativeAgentDecision.findFirstOrThrow({where:{runId:f.run.id}});await store.answerDecision(decision.id,actorUserId,randomUUID(),decision.proposalHash,{values:{final:1}});
   const resumed=await store.claimRun('final-count-answer',60000);expect(resumed?.id).toBe(f.run.id);Object.assign(f.run,resumed);
   await f.call({prompt:'one final image',facts:[{field:'generation.finalOutputs',value:1,strength:'hard',source:{kind:'answer',sourceId:decision.id,fieldId:'final',channel:'values',quote:'1'}}]});
   expect(f.provider).toHaveBeenCalledTimes(1);expect((await store.getRun(f.run.id)).input.quantityLedger?.reservations).toHaveLength(1);expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id,state:'pending'}})).toBe(0);
  }finally{await f.close();}
 });
 it('rejects the actual one-call subset of a two-poster request, then persists and advances the complete corrected plan',async()=>{
  const text='生成两张极简几何海报：一张米色，一张灰蓝色，各用一个圆形构图，不要文字。都是1:1、2K，不要参考图或试版，模型智能匹配。';
  const f=await setup(text);const original=planning.createCreativeGenerationPlan;const planSpy=vi.spyOn(planning,'createCreativeGenerationPlan').mockImplementation(input=>original(input,f.deps));
  try{
   const facts=[f.fact('intent','generate','生成两张极简几何海报'),f.fact('image.modelChoice',{mode:'auto'},'模型智能匹配'),f.fact('image.params.aspectRatio','1:1','都是1:1'),f.fact('image.params.resolution','2K','2K'),f.fact('image.quantity',1,'一张米色')];
   await expect(f.call({prompt:'beige circle poster',params:{count:1,resolution:'2K',aspectRatio:'1:1'},facts})).rejects.toMatchObject({code:'GENERATION_PLAN_INCOMPLETE'});
   expect(f.provider).not.toHaveBeenCalled();expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id}})).toBe(0);expect((await store.getRun(f.run.id)).input.quantityLedger?.reservations??[]).toHaveLength(0);
   const planned=await createCreativeTools(f.run,store,vi.fn()).find(t=>t.name==='generation_plan')!.execute('complete-two',{facts:[f.fact('image.quantity',1,'一张米色'),f.fact('image.quantity',1,'一张灰蓝色')],steps:['beige','blue'].map(id=>({id,role:'final',mediaType:'image',prompt:id+' circle poster',params:{count:1},references:[],dependsOn:[]}))});
   const actionId=(planned.details as any).actionId;await f.call({plan:{actionId,stepId:'beige'}});expect(f.provider).toHaveBeenCalledTimes(1);
   const actions=await store.actionReceipts(f.run.id);const first=actions.find(a=>a.kind==='image.generate')!.result as any;
   const observe=(id:number)=>({generationId:id,status:'success',revision:'1',outputs:[{url:'https://fixture.invalid/'+id}],nodeIds:['node-'+id]});
   const firstObservation=observe(first.generationId);
   const dependencies={store,executeStep:async(_run:any,id:string,stepId:string)=>f.call({plan:{actionId:id,stepId}})};
   expect(await advancePersistedPlan(f.run,[firstObservation],dependencies)).toBe('dispatched');expect(f.provider).toHaveBeenCalledTimes(2);
   expect(await advancePersistedPlan(f.run,[firstObservation],dependencies)).toBe('waiting');expect(f.provider).toHaveBeenCalledTimes(2);
   const media=(await store.actionReceipts(f.run.id)).filter(a=>a.kind==='image.generate');expect(media).toHaveLength(2);
   expect(await advancePersistedPlan(f.run,media.map(a=>observe((a.result as any).generationId)),dependencies)).toBe('complete');
   await f.call({plan:{actionId,stepId:'blue'}});expect(f.provider).toHaveBeenCalledTimes(2);expect((await store.getRun(f.run.id)).input.quantityLedger?.reservations).toHaveLength(2);
  }finally{planSpy.mockRestore();await f.close();}
 });
 it('executes both authorized plan steps without repeated prompt, and never silently adds a third output',async()=>{
  const f=await setup('生成两张图片，不要参考图');const original=planning.createCreativeGenerationPlan;const planSpy=vi.spyOn(planning,'createCreativeGenerationPlan').mockImplementation(input=>original(input,f.deps));
  try{
   const planned=await createCreativeTools(f.run,store,vi.fn()).find(t=>t.name==='generation_plan')!.execute('two-plan',{facts:[f.fact('image.quantity',2,'两张图片')],steps:['a','b'].map(id=>({id,role:'final',mediaType:'image',prompt:id,params:{count:1},references:[],dependsOn:[]}))});
   const actionId=(planned.details as any).actionId;
   await f.call({plan:{actionId,stepId:'a'}});await f.call({plan:{actionId,stepId:'b'}});
   expect(f.provider).toHaveBeenCalledTimes(2);expect(f.provider.mock.calls.map(call=>call[0].prompt)).toEqual(['a','b']);expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id}})).toBe(0);
   await expect(f.call({prompt:'third'})).rejects.toMatchObject({code:'GENERATION_PLAN_INCOMPLETE'});expect(f.provider).toHaveBeenCalledTimes(2);expect((await store.getRun(f.run.id)).input.quantityLedger?.reservations).toHaveLength(2);
   await expect(f.call({plan:{actionId,stepId:'a'},prompt:'changed'})).rejects.toMatchObject({code:'SELECTION_RECEIPT_STALE'});expect(f.provider).toHaveBeenCalledTimes(2);
  }finally{planSpy.mockRestore();await f.close();}
 });
 it('does not convert the number of uploaded inputs into direct output authority',async()=>{const f=await setup('我上传三张产品图，现在需要一张背景图');try{await expect(f.call({prompt:'background',facts:[f.fact('image.quantity',3,'三张产品图')]})).rejects.toMatchObject({code:'MEDIA_AUTHORIZATION_REQUIRED'});expect(f.provider).not.toHaveBeenCalled();}finally{await f.close();}});
 it('keeps a historical run on its existing explicit approval path',async()=>{
  const f=await setup('生成一张图片',true);try{await expect(f.call({prompt:'brief'})).rejects.toMatchObject({code:'run_deferred'});expect(f.provider).not.toHaveBeenCalled();expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id,state:'pending'}})).toBe(1);}finally{await f.close();}
 });
});
