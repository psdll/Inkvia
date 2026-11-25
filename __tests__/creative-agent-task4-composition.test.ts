import {describe,it,expect} from 'vitest';
import {mergeTurnRequirements} from '@/lib/creative-agent/matching-contracts';
import {generationAllowance} from '@/lib/creative-agent/quantity';
function merge(text:string, values:{value:number;quote:string;field?:string}[], previous?:ReturnType<typeof mergeTurnRequirements>) {
 return mergeTurnRequirements(undefined,previous,{facts:values.map(({value,quote,field='image.quantity'})=>({field,value,strength:'hard',source:{kind:'message',sourceId:'m',quote}}))},[{kind:'message',sourceId:'m',text}]);
}
describe('bounded quantity composition',()=>{
 it.each(['两张蓝色海报和一张红色海报','2张蓝色海报与1张红色海报','两张蓝色海报+一张红色海报','两张蓝色海报以及一张红色海报'])('adds only independent explicit groups: %s',text=>{
  const first=text.startsWith('2')?'2张蓝色海报':'两张蓝色海报',second=text.includes('1张')?'1张红色海报':'一张红色海报';
  const state=merge(text,[{value:2,quote:first},{value:1,quote:second}]);
  expect(state.conflicts).toEqual([]);expect(generationAllowance({requirements:state}).finalOutputs).toBe(3);
 });
 it('does not duplicate the allowance when facts are replayed through JSON persistence',()=>{
  const text='两张蓝色海报和一张红色海报';const facts=[{value:2,quote:'两张蓝色海报'},{value:1,quote:'一张红色海报'}];
  const first=merge(text,facts);const next=merge(text,facts,JSON.parse(JSON.stringify(first)));
  expect(generationAllowance({requirements:next}).finalOutputs).toBe(3);expect(next.revision).toBe(first.revision);
 });
 it.each(['两张蓝色海报或一张红色海报','两张蓝色海报，一张红色海报'])('does not infer addition from alternatives/unclear relation: %s',text=>{
  const state=merge(text,[{value:2,quote:'两张蓝色海报'},{value:1,quote:'一张红色海报'}]);expect(state.conflicts).toContain('image.quantity');expect(()=>generationAllowance({requirements:state})).toThrow();
 });
 it('does not authorize a denied second group',()=>expect(()=>merge('两张蓝色海报和一张红色海报不要生成',[{value:2,quote:'两张蓝色海报'},{value:1,quote:'一张红色海报'}])).toThrow());
 it('a correction replaces the earlier group sum',()=>{
  const text='两张蓝色海报和一张红色海报，改为一张海报';
  const first=merge(text,[{value:2,quote:'两张蓝色海报'},{value:1,quote:'一张红色海报'}]);
  const revised=merge(text,[{value:1,quote:'一张海报'}],first);expect(generationAllowance({requirements:revised}).finalOutputs).toBe(1);
 });
 it('an explicit final count replaces groups without adding twice',()=>{
  const state=merge('最终三张，两张蓝色海报和一张红色海报',[{value:3,quote:'最终三张',field:'generation.finalOutputs'},{value:2,quote:'两张蓝色海报'},{value:1,quote:'一张红色海报'}]);expect(generationAllowance({requirements:state}).finalOutputs).toBe(3);
 });
 it('does not permit tool-provided arithmetic to masquerade as literal evidence',()=>expect(()=>merge('两张蓝色海报和一张红色海报',[{value:3,quote:'两张蓝色海报和一张红色海报'}])).toThrow());
});
it('advances the requirement revision when another same-count group is grounded later',()=>{
 const text='两张蓝色海报和两张红色海报';
 const first=merge(text,[{value:2,quote:'两张蓝色海报'}]);
 const next=merge(text,[{value:2,quote:'两张红色海报'}],first);
 expect(generationAllowance({requirements:next}).finalOutputs).toBe(4);expect(next.revision).toBeGreaterThan(first.revision);
});
