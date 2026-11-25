import { expect, it, vi } from 'vitest';
import { prepareAgentImageRecovery } from '@/lib/generation/agent-output-observation';
it('privately captures the complete response before persisting any download state',async()=>{
 const sources=['https://provider.test/a?signature=secret','data:image/png;base64,Yg==','https://provider.test/c'];
 const capture=vi.fn(async()=> 'opaque-key');
 const persist=vi.fn(async state=>{expect(capture).toHaveBeenCalledWith(sources);expect(JSON.stringify(state)).not.toContain('secret');expect(JSON.stringify(state)).not.toContain('data:');});
 const result=await prepareAgentImageRecovery(sources,{}, {capture,persist});
 expect(result).toMatchObject({agentOutputObservation:{rawReturned:3,savedOutputs:0},agentOutputRecovery:{key:'opaque-key',items:[{outputIndex:0,state:'pending'},{outputIndex:1,state:'pending'},{outputIndex:2,state:'pending'}]}});
});
it('keeps raw return count separate from deduplicated recovery sources',async()=>{
 const capture=vi.fn(async()=> 'opaque-key');
 const result=await prepareAgentImageRecovery(['a','b','a'],{}, {capture,persist:async()=>{}});
 expect(capture).toHaveBeenCalledWith(['a','b']);expect(result.agentOutputObservation).toEqual({rawReturned:3,uniqueOutputs:2,savedOutputs:0});
});

it('preserves duplicate source indices when each returned image is a separately billed layer',async()=>{
 const capture=vi.fn(async()=> 'opaque-key');
 const result=await prepareAgentImageRecovery(['a','a'],{}, {preserveDuplicates:true,capture,persist:async()=>{}});
 expect(capture).toHaveBeenCalledWith(['a','a']);
 expect(result.agentOutputRecovery.items.map(x=>x.outputIndex)).toEqual([0,1]);
});
