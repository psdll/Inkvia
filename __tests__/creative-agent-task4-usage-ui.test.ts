import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {AgentUsage} from '@/components/creative-agent/AgentUsage';
import {summarizeLlmAttempts} from '@/lib/creative-agent/call-metrics';
describe('truthful existing usage entry',()=>{
 it('distinguishes missing, explicit zero, pending intents, title and retained-branch usage',()=>{
  const summary=summarizeLlmAttempts([{callId:'a',runId:'r',purpose:'main',providerId:'p',modelId:'m',status:'succeeded',timing:{startedAt:'s',dispatchedAt:'s'},usage:{inputTokens:0,outputTokens:0}},{callId:'b',runId:'r',purpose:'main',providerId:'p',modelId:'m',status:'unknown',timing:{startedAt:'s',dispatchedAt:'s'},usage:{}},{callId:'c',runId:'r',purpose:'title',providerId:'p',modelId:'m',status:'prepared',timing:{startedAt:'s',intentAt:'s'},usage:{}}]);
  const html=renderToStaticMarkup(React.createElement(AgentUsage,{scopes:{currentRun:summary,currentBranch:{inputTokens:9,outputTokens:4,cachedInputTokens:0,reportedCalls:1,missingCalls:1},allAttempts:{...summary,legacyUnverifiedCalls:1,titleCoverage:'linked-calls-only'}}}));
  // 没有返回的用量显示“未返回”，不当成 0；面板只保留数据，不放大段说明
  expect(html).toContain('部分未返回');expect(html).toContain('调用 2 次');expect(html).not.toContain('可见文字速度');expect(html).not.toContain('较早的对话会自动精简');
 });
 it('上下文窗口：显示已用 / 总量与占比，没有窗口信息时只显示已用',()=>{
  const usage={inputTokens:113141,outputTokens:2602,cachedInputTokens:72000,reportedCalls:12,missingCalls:0,latestContextTokens:15200};
  const html=renderToStaticMarkup(React.createElement(AgentUsage,{usage,contextWindow:1_048_576,modelLabel:'Doubao-Seed-Evolving'}));
  expect(html).toContain('15.2k / 1M（1%）');expect(html).toContain('Doubao-Seed-Evolving');
  expect(html).toContain('113k');expect(html).toContain('2.6k');expect(html).toContain('缓存 64%');
  const bare=renderToStaticMarkup(React.createElement(AgentUsage,{usage}));
  expect(bare).toContain('15.2k');expect(bare).not.toContain('（');
 });
});
