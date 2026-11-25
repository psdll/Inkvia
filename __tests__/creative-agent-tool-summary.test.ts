import { describe, expect, it } from 'vitest';
import { creativeToolPresentation } from '@/lib/creative-agent/tool-presentation';
import { applyAgentEvents, emptyAgentState } from '@/components/creative-agent/state';
const plan={steps:[{role:'final',status:'ready',receipt:{request:{prompt:'PRIVATE_PROMPT'},price:999}},{role:'final',status:'blocked'},{role:'intermediate',status:'unavailable'}],definition:{task:'PRIVATE_TASK'},totals:{plannedCalls:9,maxReturned:99}};
const cases:[string,Record<string,unknown>,string[]][]=[
 ['generation.plan',{plan},['3 个步骤','最终产物 2 步','中间产物 1 步','1 步就绪','1 步等待依赖','1 步暂无可用方案','不会提交生成']],
 ['generation.requirements',{requirements:{facts:[{field:'image.quantity',value:3,source:{quote:'PRIVATE_QUOTE'}},{field:'image.quantity',value:2},{field:'image.params.aspectRatio'}],conflicts:['image.quantity']}},['2 个字段','1 项冲突','未授权生成']],
 ['generation.models',{image:[{id:'one',price:999},{id:'two'}],video:[{id:'v',privateData:'PRIVATE_CATALOG'}]},['2 个图片条目','1 个视频条目','不代表已调用']],
 ['model.guidance',{model:'visible-model',title:'真实写作资料',profileId:'profile',promptGuidance:['PRIVATE_GUIDANCE'],currentCapabilities:{price:999}},['visible-model','真实写作资料','写作参考']],
 ['history.read',{total:7,matches:[{text:'PRIVATE_HISTORY'},{text:'PRIVATE_HISTORY'}],nextOffset:2},['7 条相关历史','返回 2 条']],
 ['project.progress',{progress:{stage:'script',nextAction:'PRIVATE_PLAN',questions:[]}},['已更新本对话的创作进度','共享采用版本']],
 ['canvas.create',{nodeIds:['a','b'],revision:'3'},['创建 2 个画布节点']],
 ['canvas.patch',{nodeIds:['a'],revision:'4',canUndo:true},['更新 1 个画布节点']],
 ['canvas.focus',{nodeIds:['a'],focus:true},['定位 1 个画布节点']],
];
describe('deterministic tool result summaries',()=>{
 it.each(cases)('projects actual %s results without exposing source content or inventing output', (name,result,parts)=>{
  const detail=creativeToolPresentation(name,result);
  for(const part of parts)expect(detail.message).toContain(part);
  expect(JSON.stringify(detail)).not.toMatch(/PRIVATE_|999|99 份|9 次/);
  expect(creativeToolPresentation(name,detail)).toEqual(detail);
  const view=applyAgentEvents(emptyAgentState(),[{sequence:1,runId:'r',type:'tool.completed',createdAt:'2026-10-16',payload:{actionId:'a',name,status:'success',detail}}],{id:'r',sessionId:'s',canvasId:1,status:'running',createdAt:'2026-10-16',updatedAt:'2026-10-16'});
  expect(view.tools[0].detail).toBe(detail.message);expect(view.tools[0].status).toBe('completed');
 });
 it.each(['error','failed','unknown','cancelled','canceled','waiting','waiting_decision','pending','running'])('does not summarize %s as successful preparation',status=>{
  for(const [name,result] of cases)expect(creativeToolPresentation(name,{...result,status}).message).toBeUndefined();
 });
 it.each([{receiptState:'unknown'},{cancelled:true},{revisionRequested:true},{error:'actual failure'}])('keeps non-success flags ahead of success-shaped data: %j',flags=>{
  for(const [name,result] of cases)expect(creativeToolPresentation(name,{...result,...flags}).message).toBeUndefined();
 });
 it.each(cases)('keeps an existing %s explanation and avoids zero-count guesses', (name,result)=>{
  expect(creativeToolPresentation(name,{...result,message:'实际返回的说明'}).message).toBe('实际返回的说明');
  expect(creativeToolPresentation(name,{}).message).toBeUndefined();
 });
 it('reports a genuinely empty catalogue and missing specialist guidance precisely',()=>{
  expect(creativeToolPresentation('generation.models',{image:[],video:[]}).message).toContain('0 个图片条目、0 个视频条目');
  expect(creativeToolPresentation('model.guidance',{model:'visible',title:'尚无专项资料',profileId:null}).message).toContain('尚无专项资料');
  expect(creativeToolPresentation('generation.plan',{plan:{steps:[{role:'final'}]}}).message).toBeUndefined();
  expect(creativeToolPresentation('generation.models',{image:[]}).message).toBeUndefined();
 });
});
