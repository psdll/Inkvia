import { describe, expect, it, vi } from 'vitest';
import { mergeTurnRequirements } from '@/lib/creative-agent/matching-contracts';
import { verifyContinuation } from '@/lib/creative-agent/continuation';
import fixture from './fixtures/creative-agent-evidence-errors.json';
const live=fixture.calls[0].arguments.facts[0];
const merge=(facts:unknown[],text=fixture.text)=>mergeTurnRequirements(undefined,undefined,{facts},[{kind:'message',sourceId:live.source.sourceId,text}]);
describe('actionable evidence diagnostics without relaxed validation',()=>{
 it('identifies the real exclusive-end mismatch and accepts only corrected or omitted offsets',()=>{
  expect(fixture.text.indexOf(live.source.quote)).toBe(59);expect(live.source.quote.length).toBe(18);
  expect(()=>merge([live])).toThrow(/facts\[0\].*intent.*source.start\/end.*quote.*省略/);
  expect(merge([{...live,source:{...live.source,end:77}}]).facts[0].source).toMatchObject({start:59,end:77,quote:live.source.quote});
  const {start,end,...source}=live.source;
  expect(merge([{...live,source}]).facts[0].source).toMatchObject({start:59,end:77,quote:live.source.quote});
 });
 it('distinguishes identity, missing quote and duplicate quote without echoing source text',()=>{
  expect(()=>merge([{...live,source:{...live.source,sourceId:'foreign'}}])).toThrow(/facts\[0\].*sourceId.*本轮/);
  expect(()=>merge([{...live,source:{...live.source,quote:'PRIVATE_FABRICATION'}}])).toThrow(/source.quote.*逐字/);
  try{merge([{...live,source:{...live.source,quote:'PRIVATE_FABRICATION'}}]);}catch(error){expect(String(error)).not.toContain('PRIVATE_FABRICATION');}
  expect(()=>merge([{...live,source:{kind:'message',sourceId:live.source.sourceId,quote:live.source.quote}}],live.source.quote+'；'+live.source.quote)).toThrow(/source.start\/end.*多次/);
 });
 it('locates a later mistyped source ID without claiming all earlier or later facts are repaired',()=>{
  const {start,end,...source}=live.source;
  const valid={...live,source};
  expect(()=>merge([...Array.from({length:5},()=>valid),{...valid,source:{...source,sourceId:source.sourceId+'8'}}])).toThrow(/facts\[5\].*intent.*sourceId/);
 });
 it('uses UTF-16 offsets including surrogate pairs and never silently drops a supplied wrong bound',()=>{
  const text='😀'+live.source.quote,source={kind:'message',sourceId:live.source.sourceId,quote:live.source.quote};
  expect(merge([{...live,source}],text).facts[0].source).toMatchObject({start:2,end:20});
  for(const bounds of [{start:1,end:19},{start:2,end:21},{end:21}])expect(()=>merge([{...live,source:{...source,...bounds}}],text)).toThrow(/source.start\/end/);
 });
 it.each(['generation.finalOutputs','generation.initialCalls','generation.totalCalls'])('does not promote strict output total to %s',field=>{
  const fact=fixture.calls[0].arguments.facts.find(item=>item.field===field)!;
  expect(()=>merge([fact])).toThrow(/facts\[0\].*数量来源未明确授权/);
 });
 it('identifies an invented inherited scalar and points to verified continuation',()=>{
  const text='背景改成米色，其他不变';
  expect(()=>merge([{field:'image.params.resolution',value:'2K',strength:'hard',source:{kind:'message',sourceId:live.source.sourceId,quote:text}}],text)).toThrow(/facts\[0\].*image.params.resolution.*continuation/);
 });
 it('explains the actual earlier generation action requirement without probing other provenance',async()=>{
  const text='背景改成米色，其他不变';const source=vi.fn(async()=>undefined),generations=vi.fn(),bind=vi.fn();
  await expect(verifyContinuation({id:'new',input:{messageId:'m',text,selection:{references:[]}}} as any,{directive:{kind:'message',sourceId:'m',quote:text},targets:[{sourceActionId:'wrong-audit-id',reference:{nodeId:'n',semanticHash:'a'.repeat(64)}}]},{source,generations,bind,latestRun:vi.fn()})).rejects.toThrow(/continuation.targets.*sourceActionId.*image_generate.*generation_plan/);
  expect(source).toHaveBeenCalledWith('wrong-audit-id');expect(generations).not.toHaveBeenCalled();expect(bind).not.toHaveBeenCalled();
 });
});
