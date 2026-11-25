import { UiProps, UiText } from "@/i18n/ui";
import * as React from 'react';
import type {CreativeAgentUsage,CreativeAgentUsageScopes} from '@/lib/creative-agent/usage';
import {formatTokens} from '@/lib/creative-agent/v3/model-profiles';
import styles from './canvas-agent.module.css';

type Totals={input?:number;output?:number;cached?:number;calls:number;missing:number;unknown:number;pending:number};

const tokens=(value:number|undefined)=>value===undefined?'未返回':formatTokens(value);
const exact=(value:number|undefined)=>value===undefined?undefined:`${value.toLocaleString('en-US')} tokens`;

/** 上下文占用：最近一次请求的输入与回复合计 / 模型上下文窗口 */
export function contextUsage(usage?:CreativeAgentUsage,scopes?:CreativeAgentUsageScopes,contextWindow?:number){
 const used=(scopes?.currentBranch??usage)?.latestContextTokens;
 return {used,percent:used!=null&&contextWindow?Math.min(100,used/contextWindow*100):undefined};
}

/** 输入框里的上下文占用圆环（与常见 AI 工具一致）；还没有数据时显示虚线圈 */
export function ContextRing({percent}:{percent?:number}){
 const radius=6.5,length=2*Math.PI*radius;
 return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className={styles.contextRing} data-level={percent==null?undefined:percent>=80?'high':percent>=50?'mid':'low'}>
  <circle cx="8" cy="8" r={radius} fill="none" strokeWidth="1.6" className={styles.contextRingTrack} strokeDasharray={percent==null?'2 2':undefined}/>
  {percent!=null&&<circle cx="8" cy="8" r={radius} fill="none" strokeWidth="1.6" strokeLinecap="round" className={styles.contextRingValue} strokeDasharray={`${Math.max(percent,1.5)/100*length} ${length}`} transform="rotate(-90 8 8)"/>}
 </svg>;
}

function sessionTotals(usage?:CreativeAgentUsage,scopes?:CreativeAgentUsageScopes):Totals|undefined{
 const all=scopes?.allAttempts;
 if(all) return {input:all.coverage.inputTokens?all.usage.inputTokens:undefined,output:all.coverage.outputTokens?all.usage.outputTokens:undefined,cached:all.coverage.cachedInputTokens?all.usage.cachedInputTokens:undefined,calls:all.calls,missing:all.missingCalls,unknown:all.unknownCalls,pending:all.pendingIntentCalls+(all.legacyUnverifiedCalls??0)};
 const branch=scopes?.currentBranch??usage;
 if(!branch) return undefined;
 return {input:branch.reportedCalls?branch.inputTokens:undefined,output:branch.reportedCalls?branch.outputTokens:undefined,cached:branch.reportedCalls?branch.cachedInputTokens:undefined,calls:branch.reportedCalls+branch.missingCalls,missing:branch.missingCalls,unknown:0,pending:0};
}

export function AgentUsage({usage,scopes,contextWindow,modelLabel}:{usage?:CreativeAgentUsage;scopes?:CreativeAgentUsageScopes;contextWindow?:number;modelLabel?:string}) {
 const branch=scopes?.currentBranch??usage;
 const {used,percent}=contextUsage(usage,scopes,contextWindow);
 const totals=sessionTotals(usage,scopes);
 const run=scopes?.currentRun.main;
 const cacheHit=totals?.input&&totals.cached!=null?totals.cached/totals.input*100:undefined;
 const sum=totals?.input!=null&&totals.output!=null?totals.input+totals.output:undefined;
 const level=percent==null?undefined:percent>=80?'high':percent>=50?'mid':'low';
 // 有调用没返回用量或结果待核实时，数字只是已知部分：在数字旁小字注明，不另起说明
 const partial=totals&&(totals.missing>0||totals.unknown>0||totals.pending>0)&&totals.input!=null?<UiProps ids={{"title":["common.m457b9c86e999"]}}><small title="common.m457b9c86e999"><UiText id="common.m75c774f21d5b" /></small></UiProps>:null;
 const meta=[`调用 ${totals?.calls??0} 次`,branch?.tokensPerSecond!=null&&`${branch.tokensPerSecond.toFixed(1)} tok/s`,run&&run.calls>0&&`本轮 ${tokens(run.coverage.inputTokens?run.usage.inputTokens:undefined)} / ${tokens(run.coverage.outputTokens?run.usage.outputTokens:undefined)}`].filter(Boolean).join(' · ');
 return <div className={styles.usage}>
  <UiProps ids={{"aria-label":["common.mbb074b86a98f"]}}><section aria-label="common.mbb074b86a98f">
   <div className={styles.usageRow}><span><UiText id="common.mbb074b86a98f" /></span><span title={exact(used)}>{used!=null?formatTokens(used):'—'}{contextWindow?` / ${formatTokens(contextWindow)}`:''}{percent!=null?`（${percent<1?'<1':Math.round(percent)}%）`:''}</span></div>
   <UiProps ids={{"aria-label":["common.mba08613d96b4"]}}><div className={styles.usageBar} role="meter" aria-label="common.mba08613d96b4" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent!=null?Math.round(percent):undefined}><span style={{width:`${percent??0}%`}} data-level={level}/></div></UiProps>
   {modelLabel&&<p className={styles.usageMeta}>{modelLabel}</p>}
  </section></UiProps>
  <UiProps ids={{"aria-label":["common.mfe559b048358"]}}><section aria-label="common.mfe559b048358">
   <p className={styles.usageTitle}><UiText id="common.mfe559b048358" />{partial}</p>
   <div className={styles.usageRow}><span><UiText id="common.m2087c777c06f" /></span><span title={exact(totals?.input)}>{tokens(totals?.input)}{cacheHit!=null&&<small><UiText id="common.mf23ed2828614" />{cacheHit.toFixed(0)}%</small>}</span></div>
   <div className={styles.usageRow}><span><UiText id="common.mfb04addb4c26" /></span><span title={exact(totals?.output)}>{tokens(totals?.output)}</span></div>
   <div className={styles.usageRow}><span><UiText id="common.me009c148d189" /></span><span title={exact(sum)}>{tokens(sum)}</span></div>
   <p className={styles.usageMeta}>{meta}</p>
  </section></UiProps>
 </div>;
}
