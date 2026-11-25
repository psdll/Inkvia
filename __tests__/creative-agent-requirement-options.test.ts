vi.mock('@/lib/creative-agent/canvas-tools', () => ({ readCreativeAgentCanvas: async () => ({ revision: '1', nodes: [], edgeIds: [] }) }));
import { expect, it, vi } from 'vitest';
vi.mock('@/lib/prisma', () => ({ default: {}, prisma: {} }));
vi.mock('@/lib/creative-agent/access', () => ({ requireCreativeAgentEnabled: vi.fn(), requireCreativeAgentCanvas: vi.fn() }));
vi.mock('@/lib/maintenance', () => ({ assertDurableWorkAdmission: vi.fn() }));
vi.mock('@/lib/creative-agent/effective-media-catalog', async original => ({ ...await original<typeof import('@/lib/creative-agent/effective-media-catalog')>(), getEffectiveCreativeMediaCatalog: vi.fn() }));
import { getEffectiveCreativeMediaCatalog } from '@/lib/creative-agent/effective-media-catalog';
import { getImageModelParams } from '@/lib/generation/image-model-params';
import { CreativeAgentStore } from '@/lib/creative-agent/store';
import { createCreativeTools } from '@/lib/creative-agent/tools';
import { matchMediaCandidates } from '@/lib/creative-agent/matching';
it('records literal Chinese option evidence through the real tool/store path, then selects canonical parameters', async () => {
 const id = 'gpt-image-2.5-sunburst-openrouter';
 const catalog: any = { version: 1, fingerprint: 'f', image: [{ id, label: 'model', params: getImageModelParams(id), aliases: [id], qualification: { available: true, reasons: [], entitlement: 'unverified', providerId: 'openrouter', adapterId: id, routeConfigFingerprint: 'f' } }], video: [], unavailable: [] };
 vi.mocked(getEffectiveCreativeMediaCatalog).mockResolvedValue(catalog);
 const row: any = { id: 'r', session_id: 's', actor_user_id: 1, canvas_id: 2, status: 'running', epoch: 1, lease_expires_at: new Date(Date.now()+60000), input: { text: '透明背景，高质量', messageId: 'm', matchingPolicyVersion: 2 }, created_at: new Date(), updated_at: new Date() };
 const tx = { $queryRawUnsafe: vi.fn(async (sql: string) => sql.includes('CreativeAgentRun') ? [row] : []), $executeRawUnsafe: vi.fn(async (sql: string, ...values: any[]) => { if (sql.startsWith('UPDATE "CreativeAgentRun" SET input=')) row.input = JSON.parse(values[1]); return 1; }) };
 const store = new CreativeAgentStore({ ...tx, $transaction: async (fn: any) => fn(tx) } as any);
 const run = await store.getRun('r');
 const tool = createCreativeTools(run, store, vi.fn()).find(t => t.name === 'generation_requirements')!;
 const facts = [['background','transparent'],['quality','high']].map(([key,value]) => ({ field: 'image.params.'+key, value, strength: 'hard', source: { kind: 'message', sourceId: 'm', quote: row.input.text } }));
 await tool.execute('one', { facts });
 expect(row.input.requirements.effectivePreferences.image.params).toEqual({ background: 'transparent', quality: 'high' });
 const match = matchMediaCandidates({ mediaType: 'image', request: { prompt: 'chair' }, catalog, references: [], requirements: row.input.requirements });
 expect(match.selected?.request.params).toMatchObject({ background: 'transparent', quality: 'high' });
 row.input = { text: '不要透明背景', messageId: 'm', matchingPolicyVersion: 2 };
 const deniedRun = await store.getRun('r');
 const denied = createCreativeTools(deniedRun, store, vi.fn()).find(t => t.name === 'generation_requirements')!;
 await expect(denied.execute('two', { facts: [{ ...facts[0], source: { ...facts[0].source, quote: row.input.text } }] })).rejects.toMatchObject({ code: 'invalid_requirement_source' });
});

it.each(['image_generate', 'generation_plan'])('records only the rejected parameter through %s and permits its typed clarification', async toolName => {
 const { prepareCreativeAgentMedia } = await import('@/lib/creative-agent/media-broker');
 const id = 'nano-banana-pro';
 const catalog: any = { image: [{ id, label: id, params: getImageModelParams(id), qualification: { available: true, reasons: [], providerId: 'kie', adapterId: id, routeConfigFingerprint: 'f', entitlement: 'unverified' } }], video: [], unavailable: [] };
 vi.mocked(getEffectiveCreativeMediaCatalog).mockResolvedValue(catalog);
 const row: any = { id: 'r', session_id: 's', actor_user_id: 1, canvas_id: 2, status: 'running', epoch: 1, lease_expires_at: new Date(Date.now()+60000), input: {
   text: '8K', messageId: 'm', matchingPolicyVersion: 2, selection: { nodeIds: [], edgeIds: [], references: [] },
   preferences: { image: { mode: 'auto', params: { resolution: '8K' } } },
 }, created_at: new Date(), updated_at: new Date() };
 const tx = { $queryRawUnsafe: vi.fn(async (sql: string) => sql.includes('CreativeAgentRun') ? [row] : []), $executeRawUnsafe: vi.fn(async (sql: string, ...values: any[]) => { if (sql.startsWith('UPDATE "CreativeAgentRun" SET input=')) row.input = JSON.parse(values[1]); return 1; }) };
 const store = new CreativeAgentStore({ ...tx, $transaction: async (fn: any) => fn(tx) } as any);
 vi.spyOn(store,'claimAction').mockImplementation(async input => ({ ...input, id: input.actionId, state: 'claimed', claimed: true, result: null }));
 vi.spyOn(store,'completeAction').mockResolvedValue({} as any);
 const ask = vi.spyOn(store,'ask').mockImplementation(async (_run, actionId, prompt) => ({ ...prompt, id: 'd', actionId, runId: 'r', proposalHash: 'h', state: 'pending', answer: null } as any));
 vi.spyOn(store,'defer').mockResolvedValue(true);
 const run = await store.getRun('r'); const execute = vi.fn();
 const tools = createCreativeTools(run, store, execute, input => prepareCreativeAgentMedia(input, { catalog: async () => catalog, readCanvas: async () => ({ revision: '1', nodes: [], edgeIds: [] }) } as any));
 const call = tools.find(t => t.name === toolName)!;
 if (toolName === 'image_generate') await expect(call.execute('bad', { prompt: 'x' })).rejects.toMatchObject({ code: 'MEDIA_PARAMS_INVALID' });
 else await expect(call.execute('bad', { steps: [{ id: 'final', role: 'final', mediaType: 'image', prompt: 'x' }] })).resolves.toMatchObject({ details: { result: { plan: { steps: [{ status: 'unavailable' }] } } } });
 expect(row.input.requirements.unavailable).toEqual(['image.params.resolution']);
 const question = tools.find(t => t.name === 'user_ask')!;
 const field = (requirement: string) => ({ id: requirement.replaceAll('.', '_'), title: requirement, type: 'text', semantic: { purpose: 'unavailable_requirement', requirement, unresolvedId: requirement, revision: 0 } });
 await expect(question.execute('clarify', { title: '调整参数', question: '请调整不支持的参数', fields: [field('image.params.resolution'), field('image.modelChoice'), field('image.params.quality')] })).rejects.toMatchObject({ code: 'run_deferred' });
 expect(ask.mock.calls[0][2].fields?.map(f => f.semantic?.requirement)).toEqual(['image.params.resolution']);
 expect(execute).not.toHaveBeenCalled();
});
