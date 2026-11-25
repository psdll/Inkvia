import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/billing/settings', () => ({ getBillingSettings: () => { throw new Error('price reader forbidden'); } }));
vi.mock('@/lib/billing/catalog', () => ({ getBillingCatalog: () => { throw new Error('price reader forbidden'); } }));
import { getImageModelParams } from '@/lib/generation/image-model-params';
import { getVideoModelSpec, SEEDANCE_25_MODEL_ID } from '@/lib/sora2';
import { MIDJOURNEY_V8_MODEL_ID } from '@/lib/midjourney-v8';
const qualification = { available: true, reasons: [], entitlement: 'unverified', providerId: 'kie', adapterId: 'test', routeConfigFingerprint: 'config-a' };
const image = (id: string) => ({ id, label: id, params: getImageModelParams(id), aliases: [id], qualification: { ...qualification, adapterId: id } });
const catalog = () => ({ version: 1, fingerprint: 'catalog-a', image: [image('nano-banana-pro'), image(MIDJOURNEY_V8_MODEL_ID)], video: [{ ...getVideoModelSpec(SEEDANCE_25_MODEL_ID), aliases: [SEEDANCE_25_MODEL_ID], qualification }], unavailable: [] });
async function matching() { const file = '../lib/creative-agent/matching'; return import(file).catch(() => ({})) as Promise<Record<string, any>>; }
describe('capability-only dynamic matching', () => {
  it('ignores the assistant model suggestion, deterministically chooses qualified current candidates and never reads prices', async () => {
    const { matchMediaCandidates } = await matching(); expect(matchMediaCandidates).toBeTypeOf('function');
    const request = { mediaType: 'image', request: { model: 'made-up', prompt: 'x'.repeat(20000), params: { count: 1 } }, preferences: { image: { mode: 'auto' } }, references: [], catalog: catalog() };
    const first = matchMediaCandidates(request);
    expect(first.selected).toBeDefined(); expect(first.selected.request.prompt).toHaveLength(20000);
    const second = matchMediaCandidates({ ...request, catalog: { ...request.catalog, image: [...request.catalog.image].reverse(), price: 999 } });
    expect(second.selected.request).toEqual(first.selected.request);
  });
  it('does not silently replace an unavailable explicit choice or use an arbitrary alias', async () => {
    const { matchMediaCandidates } = await matching(); expect(matchMediaCandidates).toBeTypeOf('function');
    const result = matchMediaCandidates({ mediaType: 'image', request: { prompt: 'test' }, preferences: { image: { mode: 'explicit', unresolvedAlias: 'Best Nano' } }, references: [], catalog: catalog() });
    expect(result.selected).toBeUndefined(); expect(result.exclusions).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'MODEL_ALIAS_UNRESOLVED' })]));
  });
  it('excludes fixed-four and unknown output bounds from strict-one rather than treating calls as files', async () => {
    const { matchMediaCandidates } = await matching(); expect(matchMediaCandidates).toBeTypeOf('function');
    const result = matchMediaCandidates({ mediaType: 'image', request: { prompt: 'test' }, outputConstraint: { exact: 1 }, references: [], catalog: catalog() });
    expect(result.selected).toBeUndefined(); expect(result.exclusions.map((e: any) => e.code)).toContain('OUTPUT_COUNT_UNSUPPORTED');
  });
  it('rejects native Draft and validates linked sizes before issuing a receipt', async () => {
    const { matchMediaCandidates } = await matching(); expect(matchMediaCandidates).toBeTypeOf('function');
    expect(matchMediaCandidates({ mediaType: 'image', request: { prompt: 'test', previewMode: 'draft' }, references: [], catalog: catalog() }).selected).toBeUndefined();
    const c = catalog(); c.image = [image('gpt-image-2-jiekou')];
    const invalid = matchMediaCandidates({ mediaType: 'image', request: { prompt: 'test', params: { resolution: '4K', aspectRatio: '1:1' } }, references: [], catalog: c });
    expect(invalid.selected).toBeUndefined();
  });
  it('keeps explicit hard video duration and ratio from being overwritten by adapter normalization', async () => {
    const { matchMediaCandidates } = await matching(); expect(matchMediaCandidates).toBeTypeOf('function');
    const result = matchMediaCandidates({ mediaType: 'video', request: { prompt: 'edit', params: { inputMode: 'multimodal', ratio: '16:9', duration: 10 } }, references: [{ nodeId: 'ref', semanticHash: 'a'.repeat(64), kind: 'video', url: '/uploads/ref.mp4', facts: { state: 'verified', contentVersion: 'b'.repeat(64), kind: 'video' } }], catalog: catalog() });
    expect(result.selected).toBeUndefined(); expect(result.exclusions.map((e: any) => e.code)).toContain('NORMALIZATION_CONFLICT');
  });
});

it('uses only visible GPT2.5 variants and never silently selects a hidden mode', async () => {
 const { matchMediaCandidates } = await matching(); expect(matchMediaCandidates).toBeTypeOf('function');
 const c: any = catalog(); c.image = [{ ...image('gpt-image-2.5-reapi'), variants: [{ mode: 'sunburst', label: 'Visible pro', selectionId: 'gpt-image-2.5-reapi:pro' }] }];
 const result = matchMediaCandidates({ mediaType: 'image', request: { prompt: 'x' }, references: [], catalog: c });
 expect(result.selected?.request.params.gptImage25Mode).toBe('sunburst');
 const hidden = matchMediaCandidates({ mediaType: 'image', request: { prompt: 'x', params: { gptImage25Mode: 'flare' } }, references: [], catalog: c });
 expect(hidden.selected).toBeUndefined();
});

it('keeps a visible model disabled after provider/admin changes even for a saved explicit ID', async () => {
 const { matchMediaCandidates } = await matching(); const c = catalog();
 c.image[0].qualification.available = false; c.image[0].qualification.reasons = ['ADMIN_HIDDEN'] as any;
 const result = matchMediaCandidates({ mediaType: 'image', request: { prompt: 'x' }, preferences: { image: { mode: 'explicit', model: c.image[0].id } }, references: [], catalog: c });
 expect(result.selected).toBeUndefined(); expect(result.exclusions[0]).toMatchObject({ code: 'MEDIA_MODEL_UNAVAILABLE', message: 'ADMIN_HIDDEN' });
});

it('does not admit a static-only Gemini spec absent from the current adapter catalog', async () => {
 const { matchMediaCandidates } = await matching(); const c: any = catalog(); c.video = [{ ...getVideoModelSpec('gemini-omni-video'), qualification: { ...qualification, providerId: 'kie', adapterId: 'gemini-omni-video' } }];
 const ref = (kind: string, i: number) => ({ nodeId: 'n'+i, semanticHash: 'a'.repeat(64), kind, url: '/uploads/'+i+'.png', facts: { state: 'verified', kind, contentVersion: 'b'.repeat(64), detectedMime: kind+'/x', sizeBytes: 1000 } });
 const input = { mediaType: 'video', request: { prompt: 'x', params: { inputMode: 'multimodal' } }, catalog: c, references: [ref('image',0),ref('video',1)] };
 const result = matchMediaCandidates(input); expect(result.selected).toBeUndefined(); expect(result.exclusions[0].code).toBe('ADAPTER_UNSUPPORTED');
 expect(matchMediaCandidates({ ...input, references: [...Array.from({length:6},(_,i)=>ref('image',i)),ref('video',6)] }).selected).toBeUndefined();
});

it('uses a supported concrete default for MiniMax text and rejects controls the actual route cannot execute', async () => {
 const { matchMediaCandidates } = await matching(); const c: any = catalog(); c.video = [{ ...getVideoModelSpec('minimax-h3'), qualification: { ...qualification, providerId: 'minimax', adapterId: 'minimax-h3' } }];
 const input = { mediaType: 'video', request: { prompt: 'x', params: { inputMode: 'text_to_video' } }, catalog: c, references: [] };
 expect(matchMediaCandidates(input).selected?.request.params.ratio).toBe('21:9');
 expect(matchMediaCandidates({ ...input, request: { ...input.request, params: { ...input.request.params, ratio: '16:9', seed: 1 } } }).selected).toBeUndefined();
});

it('compares task priorities only using current same-condition evidence, otherwise deterministic tie breaks', async () => {
 const { matchMediaCandidates } = await matching(); const c = catalog(); c.image = [image('nano-banana-pro'),image('gpt-image-2-apimart')];
 const make = (modelId: string, value: number) => ({ version: 1, id: modelId, modelId, providerId: modelId === 'nano-banana-pro' ? 'kie' : 'apimart', task: 'product', metric: 'quality', value, higherIsBetter: true, sampleCount: 5, measuredAt: '2026-10-01T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z', source: 'local evaluation', cohort: 'same-test', params: { aspectRatio: '1:1', resolution: '2K' }, referenceKinds: [] });
 const request = { mediaType: 'image', request: { prompt: 'product', params: { aspectRatio: '1:1', resolution: '2K' } }, references: [], catalog: c, task: 'product', priorities: ['quality'], now: '2026-10-16T00:00:00Z', evidence: [make('nano-banana-pro', 0.9),make('gpt-image-2-apimart',0.5)] };
 expect(matchMediaCandidates(request).selected?.request.model).toBe('nano-banana-pro');
 expect(matchMediaCandidates({ ...request, now: '2026-12-01T00:00:00Z' }).selected?.request.model).toBe('gpt-image-2-apimart');
});


it('does not reapply an old soft value after the latest user answer replaces it', async () => {
 const { mergeTurnRequirements } = await import('@/lib/creative-agent/matching-contracts');
 const { matchMediaCandidates } = await matching(); const c: any = catalog(); c.image = [image('nano-banana-pro')];
 const fact = (value: string, sourceId: string) => ({ field: 'image.params.resolution', value, strength: 'soft', source: { kind: 'answer', sourceId, quote: value } });
 const old = mergeTurnRequirements(undefined, undefined, { facts: [fact('2K', 'a')] }, [{ kind: 'answer', sourceId: 'a', text: '2K', order: 1 }]);
 const requirements = mergeTurnRequirements(undefined, old, { facts: [fact('8K', 'b')] }, [{ kind: 'answer', sourceId: 'b', text: '8K', order: 2 }]);
 const result = matchMediaCandidates({ mediaType: 'image', request: { prompt: 'x' }, references: [], catalog: c, requirements });
 expect(result.selected?.reasons.join()).not.toContain('满足 1 项软偏好');
});
it('rejects mode parameters on models that do not expose them', async () => {
 const { matchMediaCandidates } = await matching(); const c = catalog(); c.image = [image('nano-banana-pro')];
 expect(matchMediaCandidates({ mediaType: 'image', request: { prompt: 'x', params: { gptImage25Mode: 'flare' } }, catalog: c, references: [] }).selected).toBeUndefined();
});

it('uses the exact provider builder count contract for GPT2.5 while ordinary quantity remains distinct from strict total', async () => {
 const { matchMediaCandidates } = await matching();
 const { mergeTurnRequirements } = await import('@/lib/creative-agent/matching-contracts');
 const c: any = catalog(); c.image.push({ ...image('gpt-image-2.5-reapi'), variants: [{ mode: 'flare', label: 'fast', selectionId: 'gpt-image-2.5-reapi:fast' }] });
 const requirements = mergeTurnRequirements(undefined, undefined, { facts: [{ field: 'image.quantity', value: 1, strength: 'hard', source: { kind: 'message', sourceId: 'm', quote: '1' } }] }, [{ kind: 'message', sourceId: 'm', text: '只要1张' }]);
 const result = matchMediaCandidates({ mediaType: 'image', request: { prompt: 'x' }, references: [], catalog: c, requirements, outputConstraint: { max: 1 } });
 expect(result.selected?.request.model).toBe('gpt-image-2.5-reapi');
 expect(result.selected?.output).toMatchObject({ calls: 1, maxReturned: 1, expectedReturned: 1, basis: 'provider_request_n' });
 expect(result.exclusions.map((e: any) => e.code)).toContain('OUTPUT_COUNT_UNSUPPORTED');
 expect(matchMediaCandidates({ mediaType: 'image', request: { prompt: 'x', params: { count: 2 } }, references: [], catalog: c, outputConstraint: { max: 1 } }).selected).toBeUndefined();
});

it('keeps currently visible Seedream Pro normal single-image contracts eligible for strict one without trusting local slicing', async () => {
 const { matchMediaCandidates } = await matching();
 const c: any = catalog(); c.image = [image('doubao-seedream-5.0-pro')];
 const result = matchMediaCandidates({ mediaType: 'image', request: { prompt: 'x' }, references: [], catalog: c, outputConstraint: { max: 1 } });
 expect(result.selected?.output).toMatchObject({ maxReturned: 1, expectedReturned: 1, basis: 'provider_single_image_operation' });
});

it('uses OpenRouter Images count contracts without applying them to native Google', async () => {
 const { matchMediaCandidates } = await matching();
 const c: any = catalog(); c.image = [image('gpt-image-2.5-sunburst-openrouter'),image('gpt-image-2-openrouter'),image('gpt-image-2.5-flare-openrouter')];
 const result = matchMediaCandidates({ mediaType: 'image', request: { prompt: 'x' }, references: [], catalog: c, outputConstraint: { max: 1 } });
 expect(result.selected?.output).toMatchObject({ maxReturned: 1, expectedReturned: 1 }); expect(result.selected?.output.exactReturned).toBeUndefined(); expect(result.exclusions).toEqual([]);
 c.image = [image('gemini-nano-banana-2.1')];
 expect(matchMediaCandidates({ mediaType: 'image', request: { prompt: 'x' }, references: [], catalog: c, outputConstraint: { max: 1 } }).selected).toBeUndefined();
});

it('normalizes KIE GPT image defaults but rejects a hard size that the actual adapter would downgrade', async () => {
 const { matchMediaCandidates } = await matching(); const c: any = catalog(); c.image = [image('gpt-image-2')];
 const input = { mediaType: 'image', request: { prompt: 'x' }, references: [], catalog: c };
 expect(matchMediaCandidates(input).selected?.request.params).toMatchObject({ aspectRatio: 'auto', resolution: '1K' });
 expect(matchMediaCandidates({ ...input, request: { prompt: 'x', params: { aspectRatio: '1:1', resolution: '4K' } } }).selected).toBeUndefined();
});

it.each(['minimax-h3','minimax-h3-max','wan3.0-video'])('uses the declared single-video operation for %s', async id => {
 const { matchMediaCandidates } = await matching(); const c: any = catalog(); c.video = [{ ...getVideoModelSpec(id), qualification }];
 const result = matchMediaCandidates({ mediaType: 'video', request: { prompt: 'x', params: { inputMode: 'text_to_video' } }, catalog: c, references: [], outputConstraint: { max: 1 } });
 expect(result.selected?.output).toMatchObject({ expectedReturned: 1, maxReturned: 1, minReturned: 0 });
});

it('combines compatible soft parameters instead of satisfying only one field at a time', async () => {
 const { mergeTurnRequirements } = await import('@/lib/creative-agent/matching-contracts');
 const { matchMediaCandidates } = await matching(); const c: any = catalog(); c.image = [image('nano-banana-pro')];
 const facts = [['resolution','4K'],['aspectRatio','16:9']].map(([key,value]) => ({ field: 'image.params.' + key, value, strength: 'soft', source: { kind: 'message', sourceId: 'm', quote: value } }));
 const requirements = mergeTurnRequirements(undefined, undefined, { facts }, [{ kind: 'message', sourceId: 'm', text: '4K 16:9' }]);
 const result = matchMediaCandidates({ mediaType: 'image', request: { prompt: 'x' }, references: [], catalog: c, requirements });
 expect(result.selected?.request.params).toMatchObject({ resolution: '4K', aspectRatio: '16:9' });
 expect(result.selected?.reasons.join()).toContain('满足 2 项软偏好');
});
