import { describe, expect, it } from 'vitest';
import { mergeTurnRequirements, validateRequirementEvidence } from '@/lib/creative-agent/matching-contracts';
import { generationAllowance } from '@/lib/creative-agent/quantity';
import fixture from './fixtures/creative-agent-wide-quantity-evidence.json';
const validate = (text: string, field='image.quantity', quote=text) => validateRequirementEvidence({field, value:3, strength:'hard', source:{kind:'message',sourceId:'m',quote}} as any,[{kind:'message',sourceId:'m',text}]);
describe('wide quantity evidence binds one semantic value in the actual source',()=>{
 it.each(['三个不同配色。总共只能生成三张','请准备一套简约折纸海报，三个不同配色。总共只能生成三张，不要额外参考图。'])('ignores unrelated equal-valued counts without changing the quoted evidence: %s',quote=>{
  const result=validate(fixture.text,'generation.totalOutputs',quote);
  expect(result.source.quote).toBe(quote);expect(result.source.start).toBe(fixture.text.indexOf(quote));expect(result.source.end).toBe(fixture.text.indexOf(quote)+quote.length);expect(result.source.valueStart).toBe(fixture.text.indexOf('三张'));
 });
 it.each([0,1])('rejects the independent wrong field in live call %s after resolving the valid image evidence',index=>{
  expect(()=>mergeTurnRequirements(undefined,undefined,{facts:fixture.calls[index].arguments.facts},[{kind:'message',sourceId:fixture.messageId,text:fixture.text}])).toThrow(/generation.totalOutputs/);
 });
 it('accepts the exact third live arguments while preserving strict limits and prepare intent',()=>{
  const args=fixture.calls[2].arguments;
  const requirements=mergeTurnRequirements(undefined,undefined,{facts:args.facts},[{kind:'message',sourceId:fixture.messageId,text:fixture.text}]);
  expect(requirements.facts.find(f=>f.field==='intent')?.value).toBe('prepare');
  expect(generationAllowance({requirements})).toEqual({finalOutputs:3,intermediateOutputs:0,initialCalls:3,retryCalls:0,totalOutputs:3});
 });
 it('still rejects the independent total-as-final error with a precise field remedy',()=>{
  expect(()=>validate(fixture.text,'generation.finalOutputs','总共只能生成三张')).toThrow(/generation.totalOutputs/);
 });
 it.each(['三种颜色。生成三张图片','价格3元。生成3张图片','不要生成三条视频。生成三张图片','不要生成三张图片。现在生成三张图片'])('selects the sole valid quantity in its own full trusted clause: %s',text=>{
  expect(validate(text).source.valueStart).toBe(text.lastIndexOf(text.includes('3张')?'3张':'三张'));
 });
 it.each(['三个配色。标题是“生成三张图片”','从三张海报中选一张，使用三种颜色','三种颜色。解释‘生成三张图片’','三种颜色。\n> 生成三张图片','生成三张红色图片和三张蓝色图片','生成三张图片。再生成三张图片','三个配色。不要生成三张图片','三种配色。三张图片不允许生成','三个配色。生成一张包含三张海报的拼贴','三个配色。从三张海报中选一张','价格3元。分辨率3K'])('rejects ambiguous or non-authorizing quantities: %s',text=>{
  expect(()=>validate(text)).toThrow();
 });
});
