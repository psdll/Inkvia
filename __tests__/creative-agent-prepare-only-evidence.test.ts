import { describe, expect, it, vi } from 'vitest';
import { validateToolArguments } from '@earendil-works/pi-ai';
import { createCreativeTools } from '@/lib/creative-agent/tools';
import { mergeTurnRequirements } from '@/lib/creative-agent/matching-contracts';
import { createCreativeGenerationPlan } from '@/lib/creative-agent/generation-plan';
import { getImageModelParams } from '@/lib/generation/image-model-params';
import { generationAllowance } from '@/lib/creative-agent/quantity';
import type { CreativeAgentStore } from '@/lib/creative-agent/store';
import type { Run } from '@/lib/creative-agent/store-types';
import fixture from './fixtures/creative-agent-prepare-only-evidence.json';
vi.mock('@/lib/creative-agent/access', () => ({ requireCreativeAgentEnabled: vi.fn(), requireCreativeAgentCanvas: vi.fn() }));
const tools = (direct = true) => createCreativeTools({ id: 'run', actorUserId: 1, canvasId: 1, epoch: 1, input: { matchingPolicyVersion: 2, ...(direct ? { mediaAuthorizationVersion: 1 } : {}) } } as Run, {} as CreativeAgentStore, vi.fn());
const source = (quote: string) => ({ kind: 'message', sourceId: fixture.messageId, quote });
const evidence = (text = fixture.text) => [{ kind: 'message' as const, sourceId: fixture.messageId, text }];
const corrected = () => ({ ...fixture.calls[0].arguments, facts: fixture.calls[0].arguments.facts.filter(f => f.field !== 'image.modelChoice').map(f => f.field === 'generation.finalOutputs' ? { ...f, field: 'generation.totalOutputs' } : f) });

describe('prepare-only live evidence and published guidance', () => {
 it('reproduces both real errors without relaxing evidence or strict totals', () => {
  const tool = tools().find(t => t.name === 'generation_plan')!;
  for (let index = 0; index < 2; index++) {
   const call = fixture.calls[index];
   expect(validateToolArguments(tool, { ...call, type: 'toolCall' })).toEqual(call.arguments);
   expect(() => mergeTurnRequirements(undefined, undefined, { facts: call.arguments.facts }, evidence())).toThrow(fixture.errors[index].message);
  }
  expect(fixture.calls[1].arguments.steps).toEqual(fixture.calls[0].arguments.steps);
  expect(fixture.calls[2].arguments.steps).toEqual(fixture.calls[0].arguments.steps);
 });
 it.each(['auto', 'explicit'] as const)('accepts the full corrected plan in one pass and keeps %s model choice', mode => {
  const args = corrected(), preferences = { image: mode === 'explicit' ? { mode, model: 'saved-fixed' } : { mode } };
  const tool = tools().find(t => t.name === 'generation_plan')!;
  expect(validateToolArguments(tool, { type: 'toolCall', id: 'corrected', name: tool.name, arguments: args })).toEqual(args);
  const requirements = mergeTurnRequirements(preferences, undefined, { facts: args.facts }, evidence());
  expect(requirements.effectivePreferences.image).toEqual(preferences.image.mode === 'explicit' ? { mode, model: 'saved-fixed', params: { resolution: '2K' } } : { mode, params: { resolution: '2K' } });
  expect(requirements.facts.find(f => f.field === 'intent')?.value).toBe('prepare');
  expect(generationAllowance({ requirements })).toEqual({ finalOutputs: 3, intermediateOutputs: 0, initialCalls: 3, retryCalls: 0, totalOutputs: 3 });
  expect(args.steps).toEqual(fixture.calls[0].arguments.steps);
 });
 it('prepares all three actual steps without dispatch and returns version-neutral execution limits', async () => {
  const args = corrected(), requirements = mergeTurnRequirements(undefined, undefined, { facts: args.facts }, evidence());
  const plan = await createCreativeGenerationPlan({ actorUserId: 1, canvasId: 1, runId: 'run', actionId: 'plan', epoch: 1, kind: 'generation.plan', args, matching: { policyVersion: 2, requirements, preferences: requirements.effectivePreferences } }, {
   catalog: async () => ({ image: [{ id: 'nano-banana-pro', label: 'image', params: getImageModelParams('nano-banana-pro'), qualification: { available: true, reasons: [], entitlement: 'unverified', providerId: 'kie', adapterId: 'nano-banana-pro', routeConfigFingerprint: 'test' } }], video: [] }),
   readCanvas: async () => ({ nodes: [], revision: '1', edgeIds: [] }),
  });
  expect(plan.steps.map(step => step.status)).toEqual(['ready', 'ready', 'ready']);
  expect(plan.totals).toMatchObject({ plannedCalls: 3, readyCalls: 3 });
  expect(plan.evidenceLimits.join(' ')).toContain('本计划不提交生成');
  expect(plan.evidenceLimits.join(' ')).toContain('当前运行的授权与数量约束');
  expect(plan.evidenceLimits.join(' ')).not.toContain('仍需准确生成确认');
 });
 it('still accepts explicit automatic delegation over a saved fixed model', () => {
  const text = '本次模型你来选';
  const requirements = mergeTurnRequirements({ image: { mode: 'explicit', model: 'saved-fixed' } }, undefined, { facts: [{ field: 'image.modelChoice', value: { mode: 'auto' }, strength: 'hard', source: source('你来选') }] }, evidence(text));
  expect(requirements.effectivePreferences.image.mode).toBe('auto');
 });
 it.each(['不要让我选模型', '无需再问我模型', '保留当前模型，不要再问模型', '不要自动选模型', '“你来选”是引用'])('does not turn interaction, negation or quotes into auto: %s', text => {
  const quote = text.includes('你来选') ? '你来选' : text;
  expect(() => mergeTurnRequirements(undefined, undefined, { facts: [{ field: 'image.modelChoice', value: { mode: 'auto' }, strength: 'hard', source: source(quote) }] }, evidence(text))).toThrow();
 });
 it('publishes the same compact fact semantics on every inline-fact tool', () => {
  for (const name of ['generation_plan', 'generation_requirements', 'image_generate', 'video_generate']) {
   const tool = tools().find(t => t.name === name)!;
   const description = (tool.parameters as any).properties.facts.items.description ?? '';
   expect(description).toContain('总共/总量/上限');
   expect(description).toContain('generation.totalOutputs');
   expect(description).toContain('不重复finalOutputs');
   expect(description).toContain('不填modelChoice');
   expect(description).toContain('沿用当前选择');
  }
 });
 it('keeps direct continuation and plan guidance consistent while retaining legacy approval', () => {
  console.info('R16 published tool JSON bytes', JSON.stringify(Object.fromEntries([true, false].map(direct => [direct ? 'direct' : 'legacy', Buffer.byteLength(JSON.stringify(tools(direct).map(({ name, description, parameters }) => ({ name, description, parameters }))))]))));
  for (const name of ['generation_plan', 'generation_requirements']) {
   const direct = tools().find(t => t.name === name)!.description;
   expect(direct).toContain('本轮明确执行');
   expect(direct).not.toMatch(/仍需.*审批|仍需新批准/);
   const legacy = tools(false).find(t => t.name === name)!.description;
   expect(legacy).toMatch(/仍需.*审批|仍需新批准/);
  }
 });
});
