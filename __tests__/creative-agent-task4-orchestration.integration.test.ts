import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { CreativeAgentStore } from '@/lib/creative-agent/store';
import { createCreativeTools } from '@/lib/creative-agent/tools';
import { generationAllowance } from '@/lib/creative-agent/quantity';
import { hash, type MessageInput, type Run } from '@/lib/creative-agent/store-types';
import { prepareCreativeAgentMedia } from '@/lib/creative-agent/media-broker';
import { getImageModelParams } from '@/lib/generation/image-model-params';
import * as canvas from '@/lib/creative-agent/canvas-tools';
import * as references from '@/lib/creative-agent/reference-facts';
vi.mock('@/lib/creative-agent/access', () => ({ requireCreativeAgentEnabled: vi.fn(), requireCreativeAgentCanvas: vi.fn() }));
const enabled = process.env.CREATIVE_AGENT_DB_TEST === '1';
const store = new CreativeAgentStore(prisma);
let actorUserId: number, canvasId: number;
const selection = { nodeIds: [], edgeIds: [], references: [] };
async function start(text: string, overrides: Partial<MessageInput> = {}) {
  const queued = await store.enqueue({ actorUserId, canvasId, messageId: randomUUID(), text, baseRevision: '0', selection, ...overrides });
  const run = await store.claimRun('task4-fixture', 60_000); expect(run?.id).toBe(queued.run.id);
 // Historical continuation/approval fixtures keep their original server version.
 delete run!.input.mediaAuthorizationVersion; await prisma.creativeAgentRun.update({where:{id:run!.id},data:{input:run!.input as any}}); return run!;
}
const stop = (run:Run) => store.control(run.id,actorUserId,randomUUID(),'stop');
const tool = (run:Run,name:string) => createCreativeTools(run,store,vi.fn()).find(t=>t.name===name)!;
const fact = (run:Run,value:number,quote:string,field='image.quantity') => ({field,value,strength:'hard',source:{kind:'message',sourceId:run.input.messageId,quote}});
async function sourceFixture(count=1,text='背景改成米色，其他不变',selected=false) {
  const prior = await start('生成1:1、2K海报');
  const nodes:any[]=[]; const targets:any[]=[];const actions:string[]=[];const generationIds:number[]=[];
  for(let n=0;n<count;n++) {
    const request={model:'gpt-image-2-openrouter',prompt:`prior-${n}`,params:{count:1,aspectRatio:n===1?'16:9':'1:1',resolution:'2K'},references:[]};
    const receiptId=`source-receipt-${n}`;
    const generation=await prisma.generation.create({data:{authUserId:actorUserId,canvasId,source:'agent',type:'image_edit',prompt:request.prompt,model:request.model,status:'success',localPath:`/uploads/task4-${n}.png`,templateData:JSON.stringify({...request.params,agentOutputContract:{receiptId}})}});
    generationIds.push(generation.id);
    const node:any={id:`source-${n}`,type:'image',position:{x:0,y:0},data:{kind:'image',url:generation.localPath,mediaId:`asset-${n}`}};nodes.push(node);
    const reference={nodeId:node.id,semanticHash:hash({id:node.id,data:node.data}),mediaId:node.data.mediaId};
    const actionId=`task4-${randomUUID()}`;actions.push(actionId);
    await store.claimAction({actorUserId,canvasId,runId:prior.id,actionId,epoch:prior.epoch,kind:'image.generate',inputHash:hash(request)});
    await store.completeAction(actionId,{runId:prior.id,epoch:prior.epoch,state:'succeeded',result:{status:'success',generationId:generation.id,selectionReceipt:{id:receiptId,mediaType:'image',request},mediaRequest:{args:request},nodeIds:[node.id]}});
    targets.push({sourceActionId:actionId,reference});
  }
  await store.finish(prior.id,prior.epoch,'completed');
  const run=await start(text,{sessionId:prior.sessionId,preferences:{image:{mode:'auto',params:{aspectRatio:'16:9',resolution:'1K'}}},...(selected?{selection:{...selection,references:targets.map(t=>({...t.reference,canvasId,label:t.reference.nodeId,kind:'image'}))}}:{})});
  const read=vi.spyOn(canvas,'readCreativeAgentCanvas').mockImplementation(async()=>({revision:'1',nodes,edgeIds:[]}));
  const bind=vi.spyOn(references,'bindCreativeReferenceFacts').mockImplementation(async (_input,_node,ref)=>({...ref,facts:{state:'verified',kind:'image',contentVersion:'b'.repeat(64),width:1024,height:1024}}));
  const binding={facts:[],continuation:{directive:{kind:'message',sourceId:run.input.messageId,quote:run.input.text},targets}};
  const deps:any={readCanvas:async()=>({revision:'1',nodes,edgeIds:[]}),catalog:async()=>({image:[{id:'gpt-image-2-openrouter',label:'Current visible image model',params:getImageModelParams('gpt-image-2-openrouter'),qualification:{available:true,reasons:[],entitlement:'unverified',providerId:'openrouter',adapterId:'gpt-image-2-openrouter',routeConfigFingerprint:'fixture'}}],video:[]}),bindReference:bind};
  return {prior,run,nodes,targets,actions,generationIds,binding,deps,async close(){read.mockRestore();bind.mockRestore();await stop(run);}};
}
describe.skipIf(!enabled)('Task4 actual tools and durable requirement state',()=>{
 beforeAll(async()=>{actorUserId=(await prisma.user.create({data:{username:`task4-${randomUUID()}`,password:'fixture-only'}})).id;});
 beforeEach(async()=>{canvasId=(await prisma.canvas.create({data:{authUserId:actorUserId,title:'Task4 fixture'}})).id;});
 afterAll(async()=>{if(actorUserId)await prisma.user.delete({where:{id:actorUserId}});await prisma.$disconnect();});
 it('returns correctable L1 requirement format errors without recording or coercing authority',async()=>{
  const run=await start('做一张1:1、2K的蓝色马克杯商品主图，浅灰背景，不要文字，仅一张。模型你按能力匹配',{preferences:{image:{mode:'explicit',model:'saved-model'}}});
  try{
   const source=(quote:string)=>({kind:'message',sourceId:run.input.messageId,quote});
   const facts=[
    {field:'intent',value:'蓝色马克杯商品主图；浅灰背景；画面中不要任何文字',strength:'hard',source:source('做一张1:1、2K的蓝色马克杯商品主图，浅灰背景，不要文字，仅一张。')},
    {field:'image.modelChoice',value:{mode:'auto'},strength:'soft',source:source('模型你按能力匹配')},
    {field:'image.params.aspectRatio',value:'1:1',strength:'hard',source:source('1:1')},
    {field:'image.params.resolution',value:'2K',strength:'hard',source:source('2K')},
    {field:'image.params.background',value:'浅灰背景',strength:'hard',source:source('浅灰背景')},
    {field:'image.quantity',value:'1',strength:'hard',source:source('仅一张')},
   ];
   const error=await tool(run,'generation_requirements').execute('raw-live-invalid',{facts}).catch(error=>error);
   expect(error).toMatchObject({code:'invalid_requirement_format',status:400});
   expect(error.message).toContain('facts.0.value');expect(error.message).toContain('intent');expect(error.message).toContain('generate');
   expect(error.message).toContain('facts.5.value');expect(error.message).toContain('image.quantity');expect(error.message).toContain('number');
   expect(error.message).not.toContain('蓝色马克杯');
   expect((await store.getRun(run.id)).input.requirements).toBeUndefined();
   const corrected=facts.filter(f=>f.field!=='image.params.background').map(f=>({...f,strength:f.field==='image.modelChoice'?'hard':f.strength,value:f.field==='intent'?'generate':f.field==='image.quantity'?1:f.value}));
   await tool(run,'generation_requirements').execute('corrected',{facts:corrected});
   const restored=await new CreativeAgentStore(prisma).getRun(run.id);
   expect(restored.input.requirements?.facts).toHaveLength(5);
   expect(generationAllowance(restored.input)).toMatchObject({finalOutputs:1,initialCalls:1,retryCalls:0});
   expect(restored.input.effectivePreferences?.image?.params).toEqual({aspectRatio:'1:1',resolution:'2K'});
   expect(restored.input.effectivePreferences?.image?.mode).toBe('auto');
   expect(restored.input.preferences?.image?.model).toBe('saved-model');
   await expect(tool(restored,'generation_requirements').execute('still-no-string-authority',{facts:[facts[5]]})).rejects.toMatchObject({code:'invalid_requirement_format'});
   expect((await store.getRun(run.id)).input.requirements?.revision).toBe(restored.input.requirements?.revision);
   expect(await prisma.creativeAgentDecision.count({where:{runId:run.id}})).toBe(0);
  }finally{await stop(run);}
 });
 it.each(['不要模型你按能力匹配','引用：“模型你按能力匹配”，不是本轮要求','请解释“模型你按能力匹配”这句话'])('does not authorize quoted or negated capability delegation: %s',async text=>{
  const run=await start(text,{preferences:{image:{mode:'explicit',model:'saved-model'}}});
  try{
   await expect(tool(run,'generation_requirements').execute('not-delegation',{facts:[{field:'image.modelChoice',value:{mode:'auto'},strength:'hard',source:{kind:'message',sourceId:run.input.messageId,quote:'模型你按能力匹配'}}]})).rejects.toMatchObject({code:'invalid_requirement_source'});
   expect((await store.getRun(run.id)).input.effectivePreferences?.image?.model).toBe('saved-model');
  }finally{await stop(run);}
 });
 it.each([['“','”'],['‘','’'],['「','」'],['『','』'],['"','"'],["'","'"],['`','`']])('keeps quoted delegation out of authority across %s %s boundaries',async(open,close)=>{
  const phrase='模型你按能力匹配';
  const run=await start(`请解释${open}${phrase}${close}这句话`,{preferences:{image:{mode:'explicit',model:'saved-model'}}});
  try{
   for(const quote of [phrase,run.input.text])await expect(tool(run,'generation_requirements').execute('quoted-'+quote.length,{facts:[{field:'image.modelChoice',value:{mode:'auto'},strength:'hard',source:{kind:'message',sourceId:run.input.messageId,quote}}]})).rejects.toMatchObject({code:'invalid_requirement_source'});
   expect((await store.getRun(run.id)).input.effectivePreferences?.image?.model).toBe('saved-model');
   expect((await store.getRun(run.id)).input.requirements).toBeUndefined();
  }finally{await stop(run);}
 });
 it.each([['“','”'],['‘','’'],['「','」'],['『','』'],['"','"'],["'","'"],['`','`']])('accepts direct delegation outside an already closed %s %s quotation',async(open,close)=>{
  const phrase='模型你按能力匹配';
  const run=await start(`忽略${open}旧示例${close}。${phrase}`,{preferences:{image:{mode:'explicit',model:'saved-model'}}});
  try{
   await tool(run,'generation_requirements').execute('direct',{facts:[{field:'image.modelChoice',value:{mode:'auto'},strength:'hard',source:{kind:'message',sourceId:run.input.messageId,quote:phrase}}]});
   expect((await store.getRun(run.id)).input.effectivePreferences?.image?.mode).toBe('auto');
   expect((await store.getRun(run.id)).input.preferences?.image?.model).toBe('saved-model');
  }finally{await stop(run);}
 });
 it.each(["It's your choice; 模型你来按能力匹配，keep the user's style.",'It’s your choice; 模型你来按能力匹配，keep the user’s style.','模型你来按能力匹配'])('accepts direct optional-lai delegation without treating contractions as quotation: %s',async text=>{
  const run=await start(text,{preferences:{image:{mode:'explicit',model:'saved-model'}}});
  try{
   await tool(run,'generation_requirements').execute('contraction',{facts:[{field:'image.modelChoice',value:{mode:'auto'},strength:'hard',source:{kind:'message',sourceId:run.input.messageId,quote:'模型你来按能力匹配'}}]});
   expect((await store.getRun(run.id)).input.effectivePreferences?.image?.mode).toBe('auto');
   expect((await store.getRun(run.id)).input.preferences?.image?.model).toBe('saved-model');
  }finally{await stop(run);}
 });
 it('preserves a same-turn fixed-model conflict with capability delegation and grants no media approval',async()=>{
  const run=await start('使用 visible-model，模型你按能力匹配');try{
   await tool(run,'generation_requirements').execute('conflicting-delegation',{facts:[{field:'image.modelChoice',value:{mode:'explicit',model:'visible-model'},strength:'hard',source:{kind:'message',sourceId:run.input.messageId,quote:'visible-model'}},{field:'image.modelChoice',value:{mode:'auto'},strength:'hard',source:{kind:'message',sourceId:run.input.messageId,quote:'模型你按能力匹配'}}]});
   const current=await store.getRun(run.id);expect(current.input.requirements?.conflicts).toContain('image.modelChoice');
   expect(await prisma.creativeAgentDecision.count({where:{runId:run.id}})).toBe(0);
   expect(current.input.quantityLedger).toBeUndefined();
  }finally{await stop(run);}
 });
 it.each([
  ['做两张蓝色海报和一张红色海报，不要额外参考图','两张蓝色海报','一张红色海报'],
  ['做2张蓝色海报与1张红色海报','2张蓝色海报','1张红色海报'],
  ['制作两张横版图片以及一张竖版图片','两张横版图片','一张竖版图片'],
  ['需要两张黑白照片+一张彩色照片','两张黑白照片','一张彩色照片'],
 ])('composes independently grounded groups through tools/store: %s',async(text,a,b)=>{
  const run=await start(text);try{
   const facts=[fact(run,2,a),fact(run,1,b)];await tool(run,'generation_requirements').execute('composition',{facts});
   const restored=await new CreativeAgentStore(prisma).getRun(run.id);expect(restored.input.requirements?.conflicts).toEqual([]);expect(generationAllowance(restored.input)).toMatchObject({finalOutputs:3,intermediateOutputs:0,initialCalls:3,retryCalls:0});
   await tool(restored,'generation_requirements').execute('replay',{facts});expect(generationAllowance((await store.getRun(run.id)).input).finalOutputs).toBe(3);
  }finally{await stop(run);}
 });
 it.each([
  ['两张蓝色海报和一张红色海报',3,'两张蓝色海报和一张红色海报','generation.finalOutputs'],
  ['不要两张图片',2,'两张图片','image.quantity'],
  ['两张图片不生成',2,'两张图片','image.quantity'],
  ['两张参考图',2,'两张参考图','generation.retryCalls'],
  ['三条要求',3,'三条要求','image.quantity'],
 ])('rejects unsupported source at actual requirement tool: %s',async(text,count,quote,field)=>{
  const run=await start(String(text));try{await expect(tool(run,'generation_requirements').execute('bad',{facts:[fact(run,Number(count),String(quote),String(field))]})).rejects.toBeDefined();expect((await store.getRun(run.id)).input.quantityLedger).toBeUndefined();}finally{await stop(run);}
 });
 it('keeps alternatives conflicting and allows an actual typed answer to repair them',async()=>{
  const run=await start('两张图片或一张图片');try{
   await tool(run,'generation_requirements').execute('alternatives',{facts:[fact(run,2,'两张图片'),fact(run,1,'一张图片')]});
   let current=await store.getRun(run.id);expect(current.input.requirements?.conflicts).toContain('image.quantity');
   const decision=await store.ask(current,'count-choice',{title:'数量',question:'需要几张？',options:[],fields:[{id:'quantity',title:'图片数量',type:'number',required:true,semantic:{purpose:'hard_conflict',requirement:'image.quantity',unresolvedId:'count',revision:current.input.requirements!.revision}}]});
   await store.answerDecision(decision.id,actorUserId,randomUUID(),decision.proposalHash,{values:{quantity:1}});
   current=await store.getRun(run.id);
   await tool(current,'generation_requirements').execute('answer',{facts:[{field:'image.quantity',value:1,strength:'hard',source:{kind:'answer',sourceId:decision.id,fieldId:'quantity',channel:'values',quote:'1'}}]});
   expect(generationAllowance((await store.getRun(run.id)).input).finalOutputs).toBe(1);
  }finally{await stop(run);}
 });
 it.each([
  ['image.quantity','number',3,3], ['generation.finalOutputs','number',3,3],
  ['generation.retryCalls','number',0,0], ['generation.retryCalls','number',2,2], ['video.quantity','select','3',3],
  ['image.quantity','select','3',3], ['generation.finalOutputs','radio','3',3],
 ] as const)('round trips saved numeric semantics through tools and PostgreSQL: %s %s',async(field,type,value,count)=>{
  const run=await start('请补充本轮数量');try{
   await expect(tool(run,'user_ask').execute('quantity-question',{title:'数量',question:'请填写本轮数量',fields:[{id:'q',title:field==='image.quantity'?'图片数量':field==='video.quantity'?'视频数量':field==='generation.finalOutputs'?'最终成品数量':'重试次数',type,required:true,...(type==='select'||type==='radio'?{options:[{value:'3',label:field==='video.quantity'?'三条视频':'3'}]}:{}),semantic:{purpose:'missing_input',requirement:field,unresolvedId:field,revision:0}}]})).rejects.toMatchObject({code:'run_deferred'});
   const decision=await prisma.creativeAgentDecision.findFirstOrThrow({where:{runId:run.id}});
   await store.answerDecision(decision.id,actorUserId,randomUUID(),decision.proposalHash,{values:{q:value}});
   const resumed=await store.claimRun('numeric-answer',60_000);expect(resumed?.id).toBe(run.id);
   const source={kind:'answer',sourceId:decision.id,fieldId:'q',channel:'values',quote:String(value)};
   await tool(resumed!,'generation_requirements').execute('numeric-answer',{facts:[{field,value:count,strength:'hard',source}]});
   const restored=await new CreativeAgentStore(prisma).getRun(run.id);
   expect(restored.input.requirements!.facts[0]).toMatchObject({field,value:count,source:{...source,quantityEvidenceVersion:2}});
   expect(restored.input.requirements!.conflicts).toEqual([]);
   expect(generationAllowance(restored.input)).toMatchObject(field==='generation.retryCalls'?{finalOutputs:1,retryCalls:count}:{finalOutputs:count,initialCalls:count,retryCalls:0});
   await expect(tool(restored,'generation_requirements').execute('wrong-scope',{facts:[{field:field==='image.quantity'?'video.quantity':'image.quantity',value:3,strength:'hard',source}]})).rejects.toBeDefined();
  }finally{const current=await store.getRun(run.id);if(current.status!=='completed')await stop(current);}
 });
 it.each(['text','notes','skipped','skipped-field','unrelated','forged-semantic','wrong-value','foreign-run','approval'])('rejects untrusted scalar quantity evidence: %s',async scenario=>{
  const run=await start('数量待确认');try{
   const question={title:'数量',question:'需要几张？',options:[],fields:[{id:'q',title:'数量',type:scenario==='text'?'text' as const:'number' as const,semantic:{purpose:'missing_input' as const,requirement:scenario==='unrelated'?'video.quantity' as const:'image.quantity' as const,unresolvedId:'count',revision:0}}]};
   const decision=await store.ask(run,'q-'+run.id,question);
   await store.answerDecision(decision.id,actorUserId,randomUUID(),decision.proposalHash,scenario==='skipped'?{skipped:true}:scenario==='skipped-field'?{values:{},skippedFields:['q']}:scenario==='notes'?{values:{},notes:{q:'3'}}:{values:{q:scenario==='text'?'3':3}});
   if(scenario==='approval')await prisma.creativeAgentDecision.update({where:{id:decision.id},data:{binding:{kind:'image.generate'},answer:'approve'}});
   let source:any={kind:'answer',sourceId:decision.id,fieldId:'q',channel:scenario==='notes'?'notes':'values',quote:'3'};
   if(scenario==='forged-semantic')source.typedAnswer={requirement:'image.quantity',type:'number',value:3};
   if(scenario==='foreign-run'){await store.finish(run.id,run.epoch,'completed');const other=await start('另一个运行');try{await expect(tool(other,'generation_requirements').execute('foreign',{facts:[{field:'image.quantity',value:3,strength:'hard',source}]})).rejects.toBeDefined();}finally{await stop(other);}return;}
   await expect(tool(await store.getRun(run.id),'generation_requirements').execute('bad',{facts:[{field:'image.quantity',value:scenario==='wrong-value'?4:3,strength:'hard',source}]})).rejects.toBeDefined();
   expect(generationAllowance((await store.getRun(run.id)).input)).toMatchObject({finalOutputs:1,retryCalls:0});
  }finally{const current=await store.getRun(run.id);if(current.status!=='completed')await stop(current);}
 });
 it.each(['label-mismatch','opaque-label','number-unrelated-title','number-ambiguous-title'])('rejects scalar evidence whose visible quantity meaning disagrees with stored semantics: %s',async scenario=>{
  const run=await start('补充图片数量');try{
   const choice=scenario==='label-mismatch'||scenario==='opaque-label';
   const decision=await store.ask(run,'visible-count-'+run.id,{title:'数量',question:'请补充',options:[],fields:[{id:'q',title:choice?'图片数量':scenario==='number-unrelated-title'?'视频时长（秒）':'数量',type:choice?'select':'number',...(choice?{options:[{value:'3',label:scenario==='label-mismatch'?'一张图片':'普通方案'}]}:{}),semantic:{purpose:'missing_input',requirement:'image.quantity',unresolvedId:'count',revision:0}}]});
   await store.answerDecision(decision.id,actorUserId,randomUUID(),decision.proposalHash,{values:{q:choice?'3':3}});
   await expect(tool(await store.getRun(run.id),'generation_requirements').execute('visible-answer',{facts:[{field:'image.quantity',value:3,strength:'hard',source:{kind:'answer',sourceId:decision.id,fieldId:'q',channel:'values',quote:'3'}}]})).rejects.toBeDefined();
   expect(generationAllowance((await store.getRun(run.id)).input)).toMatchObject({finalOutputs:1,retryCalls:0});
  }finally{await stop(await store.getRun(run.id));}
 });
 it.each(['single-main-question','mixed-main','other-field'])('scopes visible numeric question context without borrowing other fields: %s',async scenario=>{
  const run=await start('补充数量');try{
   const fields:any[]=[{id:'q',title:'数量',type:'number',semantic:{purpose:'missing_input',requirement:'image.quantity',unresolvedId:'count',revision:0}}];
   if(scenario==='other-field')fields.push({id:'other',title:'图片数量',type:'text',semantic:{purpose:'missing_input',requirement:'image.quantity',unresolvedId:'other',revision:0}});
   const decision=await store.ask(run,'question-context-'+run.id,{title:'补充数量',question:scenario==='mixed-main'?'需要生成几张图片、几条视频？':'需要生成几张图片？',options:[],fields});
   await store.answerDecision(decision.id,actorUserId,randomUUID(),decision.proposalHash,{values:{q:3}});
   const currentRun=await store.getRun(run.id);
   const record=()=>tool(currentRun,'generation_requirements').execute('main-answer',{facts:[{field:'image.quantity',value:3,strength:'hard',source:{kind:'answer',sourceId:decision.id,fieldId:'q',channel:'values',quote:'3'}}]});
   if(scenario==='single-main-question'){
    await record();const current=await new CreativeAgentStore(prisma).getRun(run.id);
    expect(generationAllowance(current.input).finalOutputs).toBe(3);expect(current.input.requirements!.facts[0].source.quote).toBe('3');
   }else{await expect(record()).rejects.toBeDefined();expect(generationAllowance((await store.getRun(run.id)).input).finalOutputs).toBe(1);}
  }finally{await stop(await store.getRun(run.id));}
 });
 it.each([
  ['条','question',false],['段','question',false],['条','field',false],['段','field',false],
  ['条','question',true],['段','question',true],['条','field',true],['段','field',true],
 ] as const)('recognizes scoped video quantity classifiers in saved numeric questions: %s %s mixed=%s',async(unit,location,mixed)=>{
  const run=await start('补充视频设置');try{
   const wording=`需要几${unit}视频${mixed?'或几张图片':''}？`;
   const decision=await store.ask(run,'video-classifier-'+run.id,{title:'补充信息',question:location==='question'?wording:'请填写',options:[],fields:[{id:'q',title:location==='field'?wording:'填写',type:'number',semantic:{purpose:'missing_input',requirement:'video.quantity',unresolvedId:'video-count',revision:0}}]});
   await store.answerDecision(decision.id,actorUserId,randomUUID(),decision.proposalHash,{values:{q:3}});
   const current=await store.getRun(run.id),source={kind:'answer',sourceId:decision.id,fieldId:'q',channel:'values',quote:'3'};
   const record=()=>tool(current,'generation_requirements').execute('video-count',{facts:[{field:'video.quantity',value:3,strength:'hard',source}]});
   if(mixed){await expect(record()).rejects.toBeDefined();expect(generationAllowance((await store.getRun(run.id)).input).finalOutputs).toBe(1);}
   else{
    await record();const restored=await new CreativeAgentStore(prisma).getRun(run.id);
    expect(generationAllowance(restored.input)).toMatchObject({finalOutputs:3,initialCalls:3,retryCalls:0});
    expect(restored.input.requirements!.facts[0]).toMatchObject({field:'video.quantity',value:3,source});
   }
  }finally{await stop(await store.getRun(run.id));}
 });
 it.each(['我不打算修改图片，其他不变','尚未决定修改图片，其他不变','修改图片需要哪些条件，其他不变','这张图片很好看','今天辛苦了','我喜欢家庭背景','这是家庭背景','请不要帮我修改图片，其他不变'])('does not dispatch a comment or denied edit about a real prior result: %s',async text=>{
  const f=await sourceFixture(1,text);try{
   f.run.input.mediaAuthorizationVersion=1;await prisma.creativeAgentRun.update({where:{id:f.run.id},data:{input:f.run.input as any}});
   const execute=vi.fn();const media=createCreativeTools(f.run,store,execute,input=>prepareCreativeAgentMedia(input,f.deps)).find(t=>t.name==='image_generate')!;
   await expect(media.execute('non-directive',{prompt:text,references:[f.targets[0].reference],continuation:f.binding.continuation})).rejects.toBeDefined();
   expect(execute).not.toHaveBeenCalled();expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id}})).toBe(0);expect((await store.getRun(f.run.id)).input.quantityLedger?.reservations??[]).toHaveLength(0);
  }finally{await f.close();}
 });
 it.each(['背景改成米色，其他不变','家庭背景','家庭背景。','家庭背景！'])('directly executes verified continuation with inherited model and params: %s',async text=>{
  const f=await sourceFixture(1,text);try{
   f.run.input.mediaAuthorizationVersion=1;await prisma.creativeAgentRun.update({where:{id:f.run.id},data:{input:f.run.input as any}});
   const broker=await import('@/lib/creative-agent/media-broker');
   const provider=vi.fn(async(request:any)=>{const row=await prisma.generation.create({data:{authUserId:actorUserId,canvasId,source:'agent',type:'image_edit',model:request.model,prompt:request.prompt,requestKey:request.requestKey,status:'running',templateData:JSON.stringify(request)}});return {generationId:row.id,status:'running' as const};});
   const deps:any={...f.deps,claimApproval:broker.claimCreativeAgentMediaApproval,createImage:provider,createVideo:vi.fn(),findGeneration:async(q:any)=>prisma.generation.findFirst({where:q}),beforeDispatch:async(i:any)=>store.assertFence(i.runId,i.epoch),markDispatchStarted:async(i:any,key:string)=>store.transitionGenerationStep(f.run,key,'started'),finalize:vi.fn(),attach:vi.fn()};
   const media=createCreativeTools(f.run,store,input=>broker.executeCreativeAgentMediaTool(input,deps),input=>broker.prepareCreativeAgentMedia(input,deps)).find(t=>t.name==='image_generate')!;
   await media.execute('direct-continuation',{prompt:text,references:[f.targets[0].reference],continuation:f.binding.continuation});
   expect(provider).toHaveBeenCalledTimes(1);expect(provider.mock.calls[0][0]).toMatchObject({model:'gpt-image-2-openrouter',resolution:'2K',aspectRatio:'1:1'});expect(await prisma.creativeAgentDecision.count({where:{runId:f.run.id}})).toBe(0);expect((await store.getRun(f.run.id)).input.requirements?.continuation).toBeDefined();
  }finally{await f.close();}
 });
 it('binds continuation inline through the actual direct tool without restating inherited facts',async()=>{
  const f=await sourceFixture();try{
   const provider=vi.fn();const media=createCreativeTools(f.run,store,provider,input=>prepareCreativeAgentMedia(input,f.deps)).find(t=>t.name==='image_generate')!;
   await expect(media.execute('inline-edit',{prompt:f.run.input.text,references:[f.targets[0].reference],continuation:f.binding.continuation})).rejects.toMatchObject({code:'run_deferred'});
   const saved=await new CreativeAgentStore(prisma).getRun(f.run.id);
   expect(saved.input.requirements?.continuation).toBeDefined();expect(saved.input.requirements?.facts).toEqual([]);
   expect(Object.values(saved.input.generationPlans!)[0].plan.steps[0].receipt?.request.params).toMatchObject({aspectRatio:'1:1',resolution:'2K',count:1});
   expect(provider).not.toHaveBeenCalled();expect((await prisma.creativeAgentDecision.findFirstOrThrow({where:{runId:f.run.id}})).binding).toMatchObject({limits:{finalOutputs:1,retryCalls:0}});
  }finally{await f.close();}
 });
 it('preserves continuation after store recreation through actual matcher and exact confirmation',async()=>{
  const f=await sourceFixture();try{
   await tool(f.run,'generation_requirements').execute('bind',f.binding);const restored=await new CreativeAgentStore(prisma).getRun(f.run.id);
   const provider=vi.fn();const media=createCreativeTools(restored,store,provider,input=>prepareCreativeAgentMedia(input,f.deps)).find(t=>t.name==='image_generate')!;
   await expect(media.execute('edit',{prompt:f.run.input.text,references:[f.targets[0].reference]})).rejects.toMatchObject({code:'run_deferred'});
   const decisions=await prisma.creativeAgentDecision.findMany({where:{runId:f.run.id}});expect(decisions).toHaveLength(1);
   const saved=await store.getRun(f.run.id),plan=Object.values(saved.input.generationPlans!)[0];
   expect(plan.plan.steps[0].receipt?.request.params).toMatchObject({aspectRatio:'1:1',resolution:'2K',count:1});
   expect(decisions[0].binding).toMatchObject({version:2,limits:{finalOutputs:1,retryCalls:0}});expect(provider).not.toHaveBeenCalled();expect(saved.input.preferences?.image?.params).toEqual({aspectRatio:'16:9',resolution:'1K'});
  }finally{await f.close();}
 });
 it('uses saved defaults for an independent request despite prior successful results',async()=>{
  const f=await sourceFixture(1,'重新做一张海报');try{
   const prepare=vi.fn(async(_input:unknown)=>{throw new Error('fixture-stop');});await expect(createCreativeTools(f.run,store,vi.fn(),prepare).find(t=>t.name==='image_generate')!.execute('conflicting-independent',{prompt:f.run.input.text,params:{aspectRatio:'1:1',resolution:'2K'}})).rejects.toMatchObject({code:'requirement_conflict'});expect(prepare).not.toHaveBeenCalled();await expect(createCreativeTools(f.run,store,vi.fn(),prepare).find(t=>t.name==='image_generate')!.execute('independent',{prompt:f.run.input.text})).rejects.toMatchObject({code:'tool_interrupted'});
   expect(prepare.mock.calls[0][0]).toMatchObject({args:{params:{aspectRatio:'16:9',resolution:'1K'}}});expect((await store.getRun(f.run.id)).input.requirements?.continuation).toBeUndefined();
  }finally{await f.close();}
 });
 it('current explicit changes override only corresponding inherited fields',async()=>{
  const f=await sourceFixture(1,'背景改成米色，比例改成16:9，其他不变');try{
   await tool(f.run,'generation_requirements').execute('bind',f.binding);let current=await store.getRun(f.run.id);const revision=current.input.requirements!.revision;
   await tool(current,'generation_requirements').execute('override',{facts:[{field:'image.params.aspectRatio',value:'16:9',strength:'hard',source:{kind:'message',sourceId:f.run.input.messageId,quote:'16:9'}}]});current=await store.getRun(f.run.id);
   expect(current.input.requirements!.revision).toBeGreaterThan(revision);expect(current.input.effectivePreferences?.image?.params).toEqual({aspectRatio:'16:9',resolution:'2K'});expect(current.input.preferences?.image?.params?.resolution).toBe('1K');
  }finally{await f.close();}
 });
 it('keeps heterogeneous selected group parameters on separate actual matching steps',async()=>{
  const f=await sourceFixture(2,'这两张背景都改成米色，其他不变',true);try{
   await tool(f.run,'generation_requirements').execute('bind',f.binding);const current=await store.getRun(f.run.id);expect(generationAllowance(current.input)).toMatchObject({finalOutputs:2,initialCalls:2,retryCalls:0});
   for(let n=0;n<2;n++) {const prompt=await prepareCreativeAgentMedia({actorUserId,canvasId,runId:current.id,epoch:current.epoch,actionId:'step-'+n,kind:'image.generate',args:{prompt:'改背景',references:[f.targets[n].reference]},matching:{policyVersion:2,preferences:current.input.effectivePreferences,requirements:current.input.requirements}},f.deps);expect(prompt.media?.params).toMatchObject({aspectRatio:n===1?'16:9':'1:1',resolution:'2K'});}
  }finally{await f.close();}
 });
 it.each(['ambiguous','foreign-session','foreign-canvas','unknown-action','failed-action','pending-generation','missing-contract','changed-params','wrong-source','stale-node','forged-quote','fabricated-param','duplicate-target','old-retry'])('rejects unsupported continuation at durable boundary: %s',async scenario=>{
  const f=await sourceFixture(scenario==='ambiguous'?2:1);try{
   let binding:any=structuredClone(f.binding);
   if(scenario==='ambiguous')binding.continuation.targets=[binding.continuation.targets[0]];
   if(scenario==='foreign-session') {const session=await prisma.creativeAgentSession.create({data:{id:randomUUID(),actorUserId,canvasId,title:'foreign'}});await prisma.creativeAgentRun.update({where:{id:f.prior.id},data:{sessionId:session.id}});}
   if(scenario==='foreign-canvas')await prisma.creativeAgentAction.update({where:{id:f.actions[0]},data:{canvasId:canvasId+100000}});
   if(scenario==='unknown-action'||scenario==='failed-action')await prisma.creativeAgentAction.update({where:{id:f.actions[0]},data:{state:scenario==='unknown-action'?'unknown':'failed'}});
   if(scenario==='pending-generation')await prisma.generation.update({where:{id:f.generationIds[0]},data:{status:'running'}});
   if(scenario==='missing-contract')await prisma.generation.update({where:{id:f.generationIds[0]},data:{templateData:'{}'}});
   if(scenario==='changed-params')await prisma.generation.update({where:{id:f.generationIds[0]},data:{templateData:JSON.stringify({aspectRatio:'16:9',resolution:'2K',agentOutputContract:{receiptId:'source-receipt-0'}})}});
   if(scenario==='wrong-source')binding.continuation.targets[0].sourceActionId='not-found';
   if(scenario==='stale-node')f.nodes[0].data.url='/uploads/changed.png';
   if(scenario==='forged-quote')binding.continuation.directive.quote='原图2K，保持2K';
   if(scenario==='fabricated-param')binding.continuation.params={resolution:'4K'};
   if(scenario==='duplicate-target')binding.continuation.targets.push(binding.continuation.targets[0]);
   if(scenario==='old-retry')binding.continuation.retryCalls=5;
   await expect(tool(f.run,'generation_requirements').execute('bad-bind',binding)).rejects.toBeDefined();const saved=await store.getRun(f.run.id);expect(saved.input.requirements?.continuation).toBeUndefined();expect(saved.input.quantityLedger).toBeUndefined();
  }finally{await f.close();}
 });
 it('does not import an entire selected group when the current directive explicitly limits the edit to one',async()=>{
  const f=await sourceFixture(2,'只改第二张背景，其他不变',true);try{
   await expect(tool(f.run,'generation_requirements').execute('one-only',f.binding)).rejects.toBeDefined();expect((await store.getRun(f.run.id)).input.requirements?.continuation).toBeUndefined();
  }finally{await f.close();}
 });
 it('does not let a quoted substring erase the current single-target restriction',async()=>{
  const f=await sourceFixture(2,'只改第二张，背景改成米色，其他不变',true);try{
   f.binding.continuation.directive.quote='背景改成米色，其他不变';
   await expect(tool(f.run,'generation_requirements').execute('single-substring',f.binding)).rejects.toBeDefined();
  }finally{await f.close();}
 });
 it('rejects the same verified output spelled with and without optional mediaId',async()=>{
  const f=await sourceFixture(1,'背景改成米色，其他不变',true);try{
   const duplicate=structuredClone(f.binding.continuation.targets[0]);delete (duplicate.reference as any).mediaId;
   f.binding.continuation.targets.push(duplicate);
   await expect(tool(f.run,'generation_requirements').execute('duplicate-spelling',f.binding)).rejects.toBeDefined();
   const current=await store.getRun(f.run.id);expect(current.input.requirements?.continuation).toBeUndefined();expect(generationAllowance(current.input).finalOutputs).toBe(1);
  }finally{await f.close();}
 });
 it('retains actual failed skillOperator detail and started identity after store snapshot',async()=>{
  const run=await start('读取技能参考');try{
   await expect(tool(run,'skillOperator').execute('bad-skill',{action:'read',skillId:'missing',path:'references/story.md',revision:5})).rejects.toMatchObject({code:'SKILL_NOT_FOUND'});
   const snapshot=await new CreativeAgentStore(prisma).snapshot(actorUserId,canvasId,run.sessionId);
   if (!('activity' in snapshot)) throw new Error('Expected session activity');
   const event=snapshot.activity.find(item=>item.event.payload.name==='skillOperator')!.event;
   expect(event.payload.status).toBe('error');expect(event.payload.detail.message).toContain('请先查询技能目录');expect(event.payload.detail.message).not.toContain('已读取');
   expect(event.payload.detail.activity).toMatchObject({skillId:'missing',path:'references/story.md',revision:5,selectionOrigin:'agent'});
  }finally{await stop(run);}
 });
 it.each([['flare','fast','当前普通模式'],['sunburst','pro','当前高级模式']])('restores exact current variant confirmation from PostgreSQL: %s',async(mode,suffix,label)=>{
  const model='gpt-image-2.5-reapi';const run=await start('生成一张海报',{preferences:{image:{mode:'explicit',model:model+':'+suffix}}});try{
   const deps:any={readCanvas:async()=>({revision:'1',nodes:[],edgeIds:[]}),catalog:async()=>({image:[{id:model,label:'Base image',params:getImageModelParams(model),variants:[{mode:'flare',selectionId:model+':fast',label:'当前普通模式'},{mode:'sunburst',selectionId:model+':pro',label:'当前高级模式'}],qualification:{available:true,reasons:[],entitlement:'unverified',providerId:'reapi',adapterId:model,routeConfigFingerprint:'fixture'}}],video:[]})};
   const provider=vi.fn();await expect(createCreativeTools(run,store,provider,input=>prepareCreativeAgentMedia(input,deps)).find(t=>t.name==='image_generate')!.execute('variant',{prompt:'海报',references:[]})).rejects.toMatchObject({code:'run_deferred'});
   const saved=await prisma.creativeAgentDecision.findFirstOrThrow({where:{runId:run.id}});const restored=await new CreativeAgentStore(prisma).getDecision(saved.id);
   expect(restored.media?.model.label).toBe(label);expect(restored.media?.selectionReceipt?.request.params.gptImage25Mode).toBe(mode);expect(restored.media?.params.gptImage25Mode).toBe(mode);expect(provider).not.toHaveBeenCalled();
  }finally{await stop(run);}
 });
 it('restores actual skill provenance and failed outcomes with durable event ordering',async()=>{
  const run=await start('使用已选技能');try{
   const activity={category:'skill',operation:'prepared',selectionOrigin:'user',origin:'input_expansion',skillId:'selected-skill',name:'已选技能',revision:3,path:'skills/selected-skill/SKILL.md',purpose:'本轮创作'};
   await store.appendEvent(run.id,run.epoch,'tool.started',{actionId:'selected',name:'skillOperator',title:'加载技能',activity});
   await store.appendEvent(run.id,run.epoch,'tool.started',{actionId:'read',name:'canvas.read',title:'读取画布'});
   await store.appendEvent(run.id,run.epoch,'tool.completed',{actionId:'selected',name:'skillOperator',title:'加载技能',status:'failed',detail:{status:'error',message:'技能版本已变化',activity}});
   const snapshot=await new CreativeAgentStore(prisma).snapshot(actorUserId,canvasId,run.sessionId);
   if (!('activity' in snapshot)) throw new Error('Expected an existing session snapshot');
   const selected=snapshot.activity.find(item=>item.event.payload.actionId==='selected')!;
   expect(selected.event.payload).toMatchObject({status:'failed',startedSequence:expect.any(Number),detail:{activity:{selectionOrigin:'user',name:'已选技能',revision:3}}});
   expect(JSON.stringify(selected.event.payload.detail)).toContain('技能版本已变化');
   expect(selected.event.payload.startedSequence).toBeLessThan(snapshot.activity.find(item=>item.event.payload.actionId==='read')!.event.payload.startedSequence);
  }finally{await stop(run);}
 });
 it.each(['hidden-model','withdrawn-resolution','changed-content'])('rechecks current capability/content after continuation: %s',async scenario=>{
  const f=await sourceFixture();try{
   await tool(f.run,'generation_requirements').execute('bind',f.binding);const current=await store.getRun(f.run.id);
   const original=f.deps.catalog;f.deps.catalog=async()=>{const catalog=await original();if(scenario==='hidden-model')catalog.image=[];if(scenario==='withdrawn-resolution')catalog.image[0].params={...catalog.image[0].params,resolutions:catalog.image[0].params.resolutions.filter((v:any)=>v.value!=='2K')};return catalog;};
   if(scenario==='changed-content')f.deps.bindReference=async(_i:any,_n:any,ref:any)=>({...ref,facts:{state:'verified',kind:'image',contentVersion:'c'.repeat(64),width:1024,height:1024}});
   const provider=vi.fn();await expect(createCreativeTools(current,store,provider,input=>prepareCreativeAgentMedia(input,f.deps)).find(t=>t.name==='image_generate')!.execute('blocked',{prompt:current.input.text,references:[f.targets[0].reference]})).rejects.toBeDefined();expect(provider).not.toHaveBeenCalled();expect(await prisma.creativeAgentDecision.count({where:{runId:current.id}})).toBe(0);
  }finally{await f.close();}
 });
});
