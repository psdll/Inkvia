import {describe,it,expect} from 'vitest';
import {creativeToolPresentation} from '@/lib/creative-agent/tool-presentation';
import {applyAgentEvents,emptyAgentState} from '@/components/creative-agent/state';
const run:any={id:'r',sessionId:'s',canvasId:1,status:'running',createdAt:'2026-10-16',updatedAt:'2026-10-16'};
describe('safe actual activity projection',()=>{
 it('keeps verified skill identity across repeated snapshot projection without copying content',()=>{
  const raw={id:'system:2',name:'分镜工作流',revision:5,path:'SKILL.md',primaryPath:'SKILL.md',content:'SECRET BODY',files:['SKILL.md'],source:'system'};
  const once=creativeToolPresentation('skillOperator',raw);expect(once.activity).toMatchObject({category:'skill',skillId:'system:2',name:'分镜工作流',operation:'read',selectionOrigin:'agent',revision:5});expect(JSON.stringify(once)).not.toContain('SECRET BODY');expect(creativeToolPresentation('skillOperator',once)).toEqual(once);
 });
 it('distinguishes catalogue lookup from loading every listed skill',()=>{
  const detail=creativeToolPresentation('skillOperator',{skills:[{id:'system:2',name:'not loaded'}]});expect(detail.activity).toMatchObject({operation:'catalog'});expect(JSON.stringify(detail)).not.toContain('not loaded');expect(creativeToolPresentation('skillOperator',detail)).toEqual(detail);
 });
 it('does not invent an undefined historical skill name',()=>expect(JSON.stringify(creativeToolPresentation('skillOperator',{message:'已读取历史资料。'}))).not.toContain('undefined'));
 it('preserves unknown receipt evidence and the real activity identity in the event reducer',()=>{
  const activity={category:'skill',operation:'read',name:'故事工作流',skillId:'system:2',selectionOrigin:'agent',origin:'tool_call',purpose:'读取技能主文件'};
  const next=applyAgentEvents(emptyAgentState(),[{sequence:1,runId:'r',type:'tool.started',createdAt:'2026-10-16',payload:{actionId:'a',name:'skillOperator',activity}},{sequence:2,runId:'r',type:'tool.completed',createdAt:'2026-10-16',payload:{actionId:'a',name:'skillOperator',status:'error',detail:{message:'待核对',receiptState:'unknown',activity}}}],run);
  expect(next.tools).toHaveLength(1);expect(next.tools[0]).toMatchObject({activity,outcomeLabel:'结果待核实'});
 });
});

it('keeps absolute usage scopes across events instead of summing snapshot totals',()=>{
 const scopes:any={currentRun:{calls:2,pendingIntentCalls:1},currentBranch:{reportedCalls:2},allAttempts:{calls:5,legacyUnverifiedCalls:1}};
 const events:any=[1,2].map(sequence=>({sequence,runId:'r',type:'usage.updated',createdAt:'2026-10-16',payload:{usage:{inputTokens:20,outputTokens:3},usageScopes:scopes}}));
 const next=applyAgentEvents(emptyAgentState(),events,run);expect(next.usageScopes).toEqual(scopes);expect(next.usageScopes?.allAttempts.calls).toBe(5);
});

it('groups only adjacent actual skill reads, counts distinct skills and retains failed child state',async()=>{
 const {groupAgentActivities}=await import('@/components/creative-agent/activity-groups');
 const make=(id:string,skillId:string,status:any='completed'):any=>({id,runId:'r',status,title:id,nodeIds:[],activity:{category:'skill',skillId,operation:'read'}});
 const groups=groupAgentActivities([make('main','s1'),make('ref','s1'),make('failed','s2','failed'),{id:'canvas',name:'canvas.read',title:'读取画布',status:'completed',nodeIds:[]},make('later','s2'),{...make('other-run','s2'),runId:'r2'}]);
 expect(groups).toHaveLength(4);expect(groups[0]).toMatchObject({skillCount:2,label:'部分未完成'});expect(groups[0].tools).toHaveLength(3);expect(groups[1].skillCount).toBe(0);
});
it('unknown child does not become a completed group and catalogue is not a loaded skill',async()=>{
 const {groupAgentActivities}=await import('@/components/creative-agent/activity-groups');
 const skills:any=[{id:'a',runId:'r',status:'failed',outcomeLabel:'结果待核实',activity:{category:'skill',skillId:'s',operation:'read'}},{id:'catalog',runId:'r',status:'completed',activity:{category:'skill',operation:'catalog'}}];
 expect(groupAgentActivities(skills).map(group=>[group.skillCount,group.label])).toEqual([[1,'结果待核实'],[0,undefined]]);
});

it('carries actual plan unready count and known range without inventing an upper bound',async()=>{
 const {presentGenerationStep}=await import('@/lib/creative-agent/media-presentation');
 const summary=presentGenerationStep({output:{minReturned:0,maxReturned:1},reasons:[]} as any,{planId:'p',stepId:'a',limits:{}} as any,{definition:{steps:[{id:'a',params:{count:1}},{id:'b',params:{count:2}}]},steps:[{id:'a',role:'final'},{id:'b',role:'final'}],totals:{plannedCalls:3,unreadySteps:1,minReturned:0}} as any);
 expect(summary.wholePlan).toMatchObject({unreadySteps:1,minReturned:0,finalOutputs:3});expect(summary.wholePlan).not.toHaveProperty('maxReturned');
});
