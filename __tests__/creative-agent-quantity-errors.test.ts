import { describe, expect, it } from 'vitest';
import { mergeTurnRequirements } from '@/lib/creative-agent/matching-contracts';
import fixture from './fixtures/creative-agent-quantity-errors.json';
const evidence=[{kind:'message' as const,sourceId:fixture.messageId,text:fixture.text}];
const merge=(facts:unknown[])=>mergeTurnRequirements(undefined,undefined,{facts},evidence);
describe('atomic batched requirement evidence errors',()=>{
 it('reports both independent failures from the first actual live plan in one response',()=>{
  let error:unknown;try{merge(fixture.calls[0].arguments.facts);}catch(e){error=e;}
  expect(String(error)).toContain('facts[1] (image.quantity)');
  expect(String(error)).toContain('facts[2] (generation.finalOutputs)');
  expect(String(error)).toContain('generation.totalOutputs');
  expect(String(error)).toContain('无需额外填 generation.finalOutputs');
 });
 it('does not mutate saved requirements or preferences when good and bad facts are mixed',()=>{
  const preferences={image:{mode:'explicit' as const,model:'saved',params:{resolution:'4K'}}};
  const previous=mergeTurnRequirements(preferences,undefined,{facts:[fixture.calls[0].arguments.facts[0]]},evidence);
  const before=structuredClone({preferences,previous});
  expect(()=>mergeTurnRequirements(preferences,previous,{facts:fixture.calls[0].arguments.facts},evidence)).toThrow();
  expect({preferences,previous}).toEqual(before);
 });
 it('reports every independent source problem with its own index, without accepting partial facts',()=>{
  const facts=fixture.calls[0].arguments.facts.slice(0,3).map((f,i)=>i===0?{...f,source:{...f.source,sourceId:'foreign'}}:f);
  let error:unknown;try{merge(facts);}catch(e){error=e;}
  for(const [index,field] of ['intent','image.quantity','generation.finalOutputs'].entries())expect(String(error)).toContain(`facts[${index}] (${field})`);
 });
 it('preserves an explicit final-output constraint rather than suggesting it can be dropped',()=>{
  const text='最终两张图片，总共最多三张图片';
  const requirements=mergeTurnRequirements(undefined,undefined,{facts:[{field:'generation.finalOutputs',value:2,strength:'hard',source:{kind:'message',sourceId:'m',quote:'最终两张图片'}},{field:'generation.totalOutputs',value:3,strength:'hard',source:{kind:'message',sourceId:'m',quote:'总共最多三张图片'}}]},[{kind:'message',sourceId:'m',text}]);
  expect(requirements.facts.map(f=>[f.field,f.value])).toEqual([['generation.finalOutputs',2],['generation.totalOutputs',3]]);
 });
});
