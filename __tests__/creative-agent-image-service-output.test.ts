import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({rows:[] as any[],updates:[] as any[],generate:vi.fn(),save:vi.fn(),billing:vi.fn(),usage:vi.fn(),sources:new Map<string,string[]>(),capture:vi.fn()}));
vi.mock('@/lib/prisma',()=>{const generation={
 create:vi.fn(async({data}:any)=>{const row={id:mocks.rows.length+1,createdAt:new Date(),updatedAt:new Date(),localPath:null,...data};mocks.rows.push(row);return structuredClone(row);}),
 updateMany:vi.fn(async({where,data}:any)=>{const row=mocks.rows.find(r=>r.id===where.id);if(!row)return {count:0};
   if(where.status && (typeof where.status==='string'?row.status!==where.status:!where.status.in.includes(row.status)))return {count:0};
   if(where.updatedAt && row.updatedAt.getTime()!==where.updatedAt.getTime())return {count:0};
   if(where.templateData && (typeof where.templateData==='string'?row.templateData!==where.templateData:!row.templateData.includes(where.templateData.contains)))return {count:0};
   Object.assign(row,data);return {count:1};}),
 update:vi.fn(async({where,data}:any)=>{mocks.updates.push(data);return Object.assign(mocks.rows.find(r=>r.id===where.id),data);}),
 count:vi.fn(async({where}:any)=>mocks.rows.filter(r=>r.externalTaskId===where.externalTaskId).length),
 findFirst:vi.fn(async({where}:any)=>mocks.rows.find(r=>where.id?r.id===where.id&&r.localPath==null:r.externalTaskId===where.externalTaskId&&r.localPath===where.localPath)),
 findUnique:vi.fn(async({where}:any)=>mocks.rows.find(r=>r.id===where.id)),
 };const prisma={generation,$transaction:(fn:any)=>fn({generation})};return {prisma,default:prisma};});
vi.mock('@/lib/google-ai-studio-image',async(original)=>({...await original<any>(),googleAiStudioGenerateImage:mocks.generate}));
vi.mock('@/lib/tuzi-image',()=>({tuziGenerateImage:mocks.generate}));
vi.mock('@/lib/storage',()=>({saveRemoteFile:mocks.save,saveRemoteFileWithHash:async(...args:any[])=>{const localPath=await mocks.save(...args);return {localPath,hash:localPath};}}));
vi.mock('@/lib/generation/agent-output-recovery',()=>({captureGenerationImageOutputs:mocks.capture,readGenerationImageOutputs:async(_id:number,key:string)=>mocks.sources.get(key),removeGenerationImageOutputs:async(_id:number,key:string)=>{mocks.sources.delete(key);}}));
vi.mock('@/lib/generation-display-assets',()=>({createGenerationDisplayAssetPatch:async()=>({})}));
vi.mock('@/lib/billing/admission',()=>({assertBillingReady:vi.fn()}));
vi.mock('@/lib/billing-ledger',()=>({upsertUsageLedgerForGenerationId:mocks.billing,upsertUsageLedgerForGeneration:mocks.billing}));
vi.mock('@/lib/billing/usage-persistence',()=>({persistGenerationProviderUsage:mocks.usage}));
vi.mock('@/lib/runtime-generation-budget',()=>({reserveRuntimeGeneration:vi.fn()}));
vi.mock('@/lib/generation/request-key-idempotency',()=>({runGenerationRequestIdempotently:({execute}:any)=>execute(),isGenerationRequestKeyConflict:()=>false}));
vi.mock('@/lib/generation/input-snapshot',()=>({snapshotLibraryInputs:async()=>[]}));
vi.mock('@/lib/providers/registry',()=>({getRegisteredProviders:async()=>[]}));
vi.mock('@/lib/providers/model-availability',()=>({isProviderModelEnabled:()=>true}));
vi.mock('@/lib/admin-asset-feed',()=>({upsertAdminAssetFeedForGenerationId:vi.fn(async()=>undefined),upsertAdminAssetFeedForRows:vi.fn(async()=>undefined)}));
vi.mock('@/lib/maintenance',()=>({runGenerationCompletionCreate:(fn:any)=>fn()}));
vi.mock('@/lib/logger',()=>({Logger:{api:vi.fn(),generation:vi.fn()}}));
vi.mock('@/lib/tool-media/generation-inputs',async()=>({
 inspectToolMediaInputs:async()=>[],resolveOrderedGenerationInputs:()=>[],buildToolMediaLogMetadata:()=>({}),ToolMediaInputError:class extends Error{},
 createGenerationWithToolMedia:async({createGeneration}:any)=>({generation:await createGeneration((await import('@/lib/prisma')).prisma,[]),inputs:[]}),
}));
vi.mock('@/lib/image-edit-models',async(original)=>({...await original<any>(),isImageEditModelVisible:async()=>true}));
import { createImageGeneration } from '@/lib/generation/image-service';
beforeEach(()=>{mocks.rows.length=0;mocks.updates.length=0;mocks.sources.clear();vi.clearAllMocks();mocks.capture.mockImplementation(async(id:number,sources:string[])=>{const key=id+"-private";mocks.sources.set(key,sources);return key;});mocks.generate.mockResolvedValue({images:['https://fake.test/a.png','https://fake.test/b.png'],raw:{usage:{total_tokens:9}}});mocks.save.mockImplementation(async(url:string)=>'/uploads/'+url.split('/').at(-1));mocks.billing.mockResolvedValue(undefined);mocks.usage.mockImplementation(async(record:any,usage:any)=>({...JSON.parse(record.templateData),providerUsage:usage}));});
it('the real synchronous service preserves unexpected outputs before clipping and retains parent-only usage billing',async()=>{
 await createImageGeneration({authUserId:7,canvasId:1,source:'canvas',model:'gpt-image-2-tuzi',prompt:'one image',aspectRatio:'1:1',resolution:'1K',agentOutputContract:{version:2,receiptId:'r',maxReturned:1}});
 await vi.waitFor(()=>expect(mocks.rows[0].status).toBe('success'));
 expect(mocks.generate).toHaveBeenCalledTimes(1);
 expect(mocks.rows).toHaveLength(2);
 expect(JSON.parse(mocks.rows[0].templateData)).toMatchObject({agentOutputObservation:{rawReturned:2,uniqueOutputs:2,savedOutputs:2},savedOutputs:[{localPath:'/uploads/a.png'},{localPath:'/uploads/b.png'}]});
 expect(JSON.parse(mocks.rows[1].templateData).billing).toMatchObject({billable:false,parentGenerationId:1});
 expect(mocks.save).toHaveBeenCalledTimes(2);
 expect(mocks.updates.filter(data=>data.status==='success')).toHaveLength(0);
});
it('legacy synchronous execution preserves its original one-output behavior',async()=>{
 await createImageGeneration({authUserId:7,source:'canvas',model:'gpt-image-2-tuzi',prompt:'one image',aspectRatio:'1:1',resolution:'1K'});
 await vi.waitFor(()=>expect(mocks.rows[0].status).toBe('success'));
 expect(mocks.rows).toHaveLength(1);expect(mocks.save).toHaveBeenCalledTimes(1);
});

it.each([0,1])('actual service recovers item %i without another generation or billing identity',async(failedIndex)=>{
 const sources=['https://fake.test/a.png?signature=private-a','data:image/png;base64,Yg==','https://fake.test/c.png'];
 mocks.generate.mockResolvedValue({images:sources,raw:{usage:{total_tokens:9}}});
 let failed=false;
 mocks.save.mockImplementation(async(url:string)=>{const index=sources.indexOf(url);if(index===failedIndex&&!failed){failed=true;throw new Error('transient storage failure');}return '/uploads/'+index+'.png';});
 await createImageGeneration({authUserId:7,canvasId:1,source:'canvas',model:'gpt-image-2-tuzi',prompt:'one image',aspectRatio:'1:1',resolution:'1K',agentOutputContract:{version:2,receiptId:'r',maxReturned:1}});
 await vi.waitFor(()=>expect(JSON.parse(mocks.rows[0].templateData).agentOutputRecovery?.items.filter((x:any)=>x.state==='failed')).toHaveLength(1));
 await vi.waitFor(()=>expect(mocks.rows[0].status).toBe('running'));
 expect(mocks.save).toHaveBeenCalledTimes(3);
 const partial=JSON.parse(mocks.rows[0].templateData);
 expect(partial.agentOutputObservation).toMatchObject({rawReturned:3,savedOutputs:2});
 expect([...mocks.sources.values()]).toEqual([sources]);
 expect(mocks.rows[0].templateData).not.toMatch(/private-a|data:image/);
 const {finalizeGeneration}=await import('@/lib/generation/finalize');
 expect(await finalizeGeneration(1)).toBe('done');
 expect(await finalizeGeneration(1)).toBe('skipped');
 expect(mocks.generate).toHaveBeenCalledTimes(1);
 expect(mocks.save).toHaveBeenCalledTimes(4);
 expect(mocks.rows).toHaveLength(3);
 expect(mocks.rows[0].status).toBe('success');
 expect(JSON.parse(mocks.rows[0].templateData).agentOutputObservation.savedOutputs).toBe(3);
 for(const row of mocks.rows.slice(1))expect(JSON.parse(row.templateData).billing).toMatchObject({billable:false,parentGenerationId:1});
 expect(mocks.sources.size).toBe(0);
 expect(mocks.usage).toHaveBeenCalledTimes(1);
 expect(mocks.usage.mock.calls[0][0].id).toBe(1);
 expect(mocks.billing.mock.calls.filter(([row])=>typeof row==='object'&&row.id===1&&row.status==='success')).toHaveLength(1);
});

it('Google completed output capture failure retains usage and reports local saving without re-dispatch (injected RangeError)',async()=>{
 mocks.generate.mockResolvedValue({images:['data:image/png;base64,Yg=='],raw:{usageMetadata:{totalTokenCount:1421}}});
 const actualUsage=await vi.importActual<typeof import('@/lib/billing/usage-persistence')>('@/lib/billing/usage-persistence');
 mocks.usage.mockImplementation(actualUsage.persistGenerationProviderUsage);
 mocks.capture.mockRejectedValue(new RangeError('Maximum call stack size exceeded'));
 await createImageGeneration({authUserId:7,canvasId:1,source:'canvas',model:'gemini-3-pro-image',prompt:'one image',aspectRatio:'1:1',resolution:'2K',agentOutputContract:{version:2,receiptId:'r',maxReturned:1}});
 await vi.waitFor(()=>expect(mocks.rows[0].status).toBe('failed'));
 expect(mocks.generate).toHaveBeenCalledTimes(1);expect(mocks.capture).toHaveBeenCalledTimes(1);expect(mocks.save).not.toHaveBeenCalled();
 expect(mocks.rows).toHaveLength(1);expect(mocks.rows[0].localPath).toBeNull();
 expect(JSON.parse(mocks.rows[0].templateData)).toMatchObject({providerUsage:{usageMetadata:{totalTokenCount:1421}},usageCapture:{state:'received',providerCompleted:true}});
 expect(JSON.parse(mocks.rows[0].templateData).agentOutputRecovery).toBeUndefined();
 expect(mocks.rows[0].errorMsg).toContain('上游平台已完成生成');
 expect(mocks.rows[0].errorMsg).toContain('保存');
 expect(mocks.rows[0].errorMsg).not.toMatch(/输入数量|减少输入|未计费/);
 expect(mocks.rows[0].errorMsg).toContain('Maximum call stack size exceeded');
 const {Logger}=await import('@/lib/logger');
 expect(Logger.generation).toHaveBeenCalledWith('task_failed',expect.stringContaining('result saving failed'), 'error', 1, expect.objectContaining({phase:'output_save',providerCompleted:true,error:'Maximum call stack size exceeded'}),'7');
});
it('Google provider rejection remains a provider failure, without pretending output was returned',async()=>{
 mocks.generate.mockRejectedValue(new Error('content policy rejected'));
 await createImageGeneration({authUserId:7,canvasId:1,source:'canvas',model:'gemini-3-pro-image',prompt:'one image',aspectRatio:'1:1',resolution:'2K',agentOutputContract:{version:2,receiptId:'r',maxReturned:1}});
 await vi.waitFor(()=>expect(mocks.rows[0].status).toBe('failed'));
 expect(mocks.rows[0].errorMsg).toContain('审核');
 expect(mocks.rows[0].errorMsg).not.toContain('已完成生成');
 expect(mocks.capture).not.toHaveBeenCalled();expect(mocks.usage).not.toHaveBeenCalled();expect(mocks.generate).toHaveBeenCalledTimes(1);
});
