import { describe, expect, it, vi } from 'vitest';
import { getImageModelParams } from '@/lib/generation/image-model-params';
const catalog = { image: [{ id: 'nano-banana-pro', label: 'image', params: getImageModelParams('nano-banana-pro'), qualification: { available: true, reasons: [], entitlement: 'unverified', providerId: 'kie', adapterId: 'nano-banana-pro', routeConfigFingerprint: 'a' } }], video: [] };
const base = { actorUserId: 1, canvasId: 2, runId: 'r', epoch: 1, actionId: 'a', kind: 'generation.plan', matching: { policyVersion: 2, preferences: { image: { mode: 'auto' } } } };
async function planner() { const file = '../lib/creative-agent/generation-plan'; return import(file).catch(() => ({})) as Promise<Record<string, any>>; }
describe('generation plan receipts', () => {
 it('records all final/intermediate steps and leaves future output references blocked without inventing nodes', async () => {
  const { createCreativeGenerationPlan } = await planner(); expect(createCreativeGenerationPlan).toBeTypeOf('function');
  const deps = { catalog: vi.fn(async () => catalog), readCanvas: vi.fn(async () => ({ nodes: [], revision: '1', edgeIds: [] })) };
  const plan = await createCreativeGenerationPlan({ ...base, args: { steps: [{ id: 'draft', role: 'intermediate', mediaType: 'image', prompt: 'draft', references: [], params: { count: 1 } }, { id: 'final', role: 'final', mediaType: 'image', prompt: 'final', references: [{ stepId: 'draft', outputIndex: 0 }], dependsOn: ['draft'], params: { count: 1 } }] } }, deps);
  expect(plan.steps).toMatchObject([{ id: 'draft', status: 'ready', receipt: { request: { model: 'nano-banana-pro' } } }, { id: 'final', status: 'blocked', missingOutputs: [{ stepId: 'draft', outputIndex: 0 }] }]);
  expect(plan.steps[1].receipt).toBeUndefined(); expect(plan.totals.plannedCalls).toBe(2); expect(plan.totals.unreadySteps).toBe(1);
  expect(JSON.stringify(plan)).not.toContain('semanticHash'); expect(deps.catalog).toHaveBeenCalledOnce();
 });
 it('rejects duplicate IDs and dependency cycles before doing reference I/O', async () => {
  const { createCreativeGenerationPlan } = await planner(); expect(createCreativeGenerationPlan).toBeTypeOf('function');
  const deps = { catalog: vi.fn(), readCanvas: vi.fn() };
  const steps = [{ id: 'a', role: 'final', mediaType: 'image', prompt: 'x', dependsOn: ['b'] }, { id: 'b', role: 'intermediate', mediaType: 'image', prompt: 'y', dependsOn: ['a'] }];
  await expect(createCreativeGenerationPlan({ ...base, args: { steps } }, deps)).rejects.toMatchObject({ code: 'PLAN_DEPENDENCY_INVALID' });
  expect(deps.readCanvas).not.toHaveBeenCalled();
 });
});

it('rejects caller-supplied comparative scores and validates blocked-step parameter shapes before I/O', async () => {
 const { createCreativeGenerationPlan } = await planner();
 const deps = { catalog: vi.fn(), readCanvas: vi.fn() };
 const steps = [{ id: 'a', role: 'intermediate', mediaType: 'image', prompt: 'x' }, { id: 'b', role: 'final', mediaType: 'video', prompt: 'x', params: { invented: true }, dependsOn: ['a'] }];
 await expect(createCreativeGenerationPlan({ ...base, args: { steps } }, deps)).rejects.toBeDefined();
 expect(deps.catalog).not.toHaveBeenCalled();
 await expect(createCreativeGenerationPlan({ ...base, args: { steps: [steps[0]], evidence: [{ quality: 90 }] } }, deps)).rejects.toBeDefined();
});
it('finalizes only real dependency outputs and probes a shared reference once across ready steps', async () => {
 const { createCreativeGenerationPlan } = await planner();
 const { creativeAgentNodeHash } = await import('@/lib/creative-agent/canvas-tools');
 const node: any = { id: 'real', type: 'image', position: {x:0,y:0}, data: { kind: 'image', url: '/uploads/ref.png', mediaId: 'm' } };
 const ref = { nodeId: node.id, semanticHash: creativeAgentNodeHash(node), mediaId: 'm' };
 const bindReference = vi.fn(async (_input: any, _node: any, reference: any) => ({ ...reference, facts: { state: 'verified', contentVersion: 'b'.repeat(64), kind: 'image', width: 1024, height: 1024 } }));
 const deps = { catalog: vi.fn(async () => catalog), readCanvas: vi.fn(async () => ({ nodes: [node], revision: '1', edgeIds: [] })), bindReference };
 const steps = [{ id: 'a', role: 'intermediate', mediaType: 'image', prompt: 'x' }, ...['b','c'].map(id => ({ id, role: 'final', mediaType: 'image', prompt: 'x', references: [{ stepId: 'a', outputIndex: 0 }] }))];
 const plan = await createCreativeGenerationPlan({ ...base, args: { steps } }, deps, { a: [ref] });
 expect(plan.steps.map((s: any) => s.status)).toEqual(['ready','ready','ready']);
 expect(plan.steps[1].receipt.request.references).toEqual([ref]);
 expect(bindReference).toHaveBeenCalledOnce(); expect(deps.catalog).toHaveBeenCalledOnce();
});
it('retains the entire immutable definition including blocked prompts outside transcript history', async () => {
 const { createCreativeGenerationPlan } = await planner();
 const definition = { steps: [{ id: 'a', role: 'intermediate', mediaType: 'image', prompt: 'original A', params: { count: 1 }, references: [], dependsOn: [] }, { id: 'b', role: 'final', mediaType: 'image', prompt: 'full original B', params: { count: 1 }, references: [{ stepId: 'a', outputIndex: 0 }], dependsOn: [] }] };
 const plan = await createCreativeGenerationPlan({ ...base, args: definition }, { catalog: async () => catalog, readCanvas: async () => ({ nodes: [], revision: '1', edgeIds: [] }) });
 expect(plan.definition).toEqual(definition);
 expect(plan.definition.steps[1].prompt).toBe('full original B');
});
