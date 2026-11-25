import {it,expect} from 'vitest';
import {creativeToolPresentation} from '@/lib/creative-agent/tool-presentation';
import {applyAgentEvents,emptyAgentState,restoreAgentSnapshot} from '@/components/creative-agent/state';
import {buildTurnCopyText} from '@/components/creative-agent/turn-result';
const run:any={id:'r',sessionId:'s',canvasId:1,status:'completed',createdAt:'2026-01-01',updatedAt:'2026-01-01'};
function event(detail:any,name='image.generate',id='a'):any{return {sequence:1,runId:'r',createdAt:run.createdAt,type:'tool.completed',payload:{actionId:id,name,title:name==='video.generate'?'生成视频':'生成图片',status:'error',detail}};}
it.each(['image.generate','video.generate'])('R22 preserves typed preflight evidence across SSE, snapshot and JSON for %s',name=>{
 const detail={status:'error',phase:'preflight',dispatched:false,code:'invalid_requirement_source',message:'来源不明确'};
 const projected=creativeToolPresentation(name,detail);expect(projected).toEqual(detail);
 const e=event(detail,name);const live=applyAgentEvents(emptyAgentState(),[e],run);
 const refreshed=restoreAgentSnapshot(JSON.parse(JSON.stringify({sessionId:'s',run:{...run,id:'later'},messages:[],latestSequence:1,activity:[{run,event:{...e,payload:{...e.payload,detail:projected}}}]})));
 for(const view of [live,refreshed])expect(view.tools[0]).toMatchObject({title:name==='image.generate'?'准备图片生成':'准备视频生成',status:'failed',outcomeLabel:'未通过（未提交）',detail:'来源不明确'});
});
it.each([
 [{status:'error',phase:'preflight',dispatched:false,receiptState:'unknown'},'结果待核实'],
 [{status:'error',dispatchState:'partial',phase:'preflight',dispatched:false},'部分已提交，后续准备未通过'],
 [{status:'failed',generationId:12},'生成失败'],
 [{status:'failed'},'操作未完成'],
 [{status:'failed',generationId:12,phase:'preflight',dispatched:false},'生成失败'],
 [{status:'error',generationId:12,phase:'preflight',dispatched:false},'已提交，操作未完成'],
 [{status:'error'},'操作未完成'],
 [{status:'error',phase:'admission',dispatched:false},'操作未完成'],
 [{status:'error',cancelled:true},'已取消'],
 [{status:'error',revisionRequested:true},'已要求修改'],
])('R22 outcome evidence takes precedence without inventing no-dispatch: %j',(detail,label)=>{
 const view=applyAgentEvents(emptyAgentState(),[event(detail)],run);expect(view.tools[0].outcomeLabel).toBe(label);expect(view.tools[0].title).toBe('生成图片');
});
it('R22 counts only actual media outcomes while preserving independent preparation attempts',()=>{
 const errors=[event({phase:'preflight',dispatched:false,message:'来源错误'},'image.generate','a'),{...event({phase:'preflight',dispatched:false,message:'意图缺失'},'image.generate','b'),sequence:2}];
 const view=applyAgentEvents(emptyAgentState(),errors,run);view.media=[{runId:'r',generationId:12,mediaType:'image',status:'success',outputs:[{url:'/a.png',nodeId:'n'}],nodeIds:['n']} as any];
 expect(view.tools).toHaveLength(2);expect(buildTurnCopyText(view,'r','https://test.invalid')).toContain('1 项成功');expect(buildTurnCopyText(view,'r','https://test.invalid')).not.toContain('项失败');
});

it('R22 keeps an actual deferred approval waiting rather than rejecting preparation',()=>{const view=applyAgentEvents(emptyAgentState(),[event({status:'waiting',code:'run_deferred'})],{...run,status:'waiting_decision'});expect(view.tools[0]).toMatchObject({status:'running',outcomeLabel:'等待确认'});expect(view.tools[0].title).toBe('生成图片');});
