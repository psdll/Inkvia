import {expect,it,vi} from 'vitest';
vi.mock('@/lib/prisma',()=>({default:{appSetting:{findUnique:async()=>null}}}));
const mocks=vi.hoisted(()=>({begin:vi.fn(async()=>({id:1})),finish:vi.fn(async()=>{})}));
vi.mock('@/lib/providers/transport',()=>({resolveProviderRequestContext:async()=>({provider:{name:'audit',baseUrl:'https://audit.invalid/v1',apiKey:'synthetic-key'},decision:{providerId:'audit'}}),fetchWithProviderEgress:async()=>new Response(JSON.stringify({choices:[{message:{content:'ok'}}],usage:{prompt_tokens:10,completion_tokens:5}}),{headers:{'content-type':'application/json'}})}));
vi.mock('@/lib/billing/llm',()=>({beginLlmCost:mocks.begin,finishLlmCost:mocks.finish}));
vi.mock('@/lib/canvas/llm-media',()=>({buildCanvasLlmContent:async()=>''}));
vi.mock('@/lib/llm-routing/resolver',()=>({resolveLlmRoute:vi.fn()}));
vi.mock('@/lib/llm-routing/gateway',()=>({callLlmForScenario:vi.fn()}));
import {canvasLlmChat} from '@/lib/canvas/llm';
it('preserves the owner when metering a canvas worker LLM call',async()=>{
 await canvasLlmChat({providerId:'audit',model:'audit-model',prompt:'audit',authUserId:42} as any);
 expect(mocks.begin).toHaveBeenCalledWith(expect.objectContaining({authUserId:42}));
});
