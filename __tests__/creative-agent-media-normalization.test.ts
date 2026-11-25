import { describe, expect, it } from 'vitest';
import { SEEDANCE_25_MODEL_ID } from '@/lib/sora2';
async function normalization() {
  const file = '../lib/generation/video-input-capabilities';
  return import(file).catch(() => ({})) as Promise<Record<string, any>>;
}
describe('shared execution video combination rules', () => {
  it('normalizes Seedance reference-video auto mode before a receipt is issued', async () => {
    const { normalizeVideoCombination } = await normalization();
    expect(normalizeVideoCombination).toBeTypeOf('function');
    expect(normalizeVideoCombination({ model: SEEDANCE_25_MODEL_ID, inputMode: 'multimodal', ratio: '16:9', duration: 10 }, [{ kind: 'video' }])).toMatchObject({ ratio: 'adaptive', duration: -1, omniReferenceTaskType: 'auto' });
  });
  it('validates adaptive first-frame combinations with the same provider rule as dispatch', async () => {
    const { validateVideoResolvedInputs } = await normalization();
    expect(validateVideoResolvedInputs).toBeTypeOf('function');
    expect(() => validateVideoResolvedInputs({ model: SEEDANCE_25_MODEL_ID, inputMode: 'first_frame', ratio: '16:9', inputs: [] })).toThrow('自适应');
    expect(() => validateVideoResolvedInputs({ model: SEEDANCE_25_MODEL_ID, inputMode: 'first_frame', ratio: 'adaptive', inputs: [] })).not.toThrow();
  });
});

describe('image execution route identity', () => {
  async function identity() { const file = '../lib/generation/image-route-identity'; return import(file).catch(() => ({})) as Promise<Record<string, any>>; }
  it('resolves existing KIE input and Qwen quality variants, independent of display names', async () => {
    const { imageProviderSnapshotModel } = await identity();
    expect(imageProviderSnapshotModel).toBeTypeOf('function');
    expect(imageProviderSnapshotModel({ model: 'gpt-image-2', referenceCount: 0 })).toBe('gpt-image-2-text-to-image');
    expect(imageProviderSnapshotModel({ model: 'gpt-image-2', referenceCount: 1 })).toBe('gpt-image-2-image-to-image');
    expect(imageProviderSnapshotModel({ model: 'qwen-image-3.0', quality: 'pro', aspectRatio: '1:1', resolution: '2K' })).toContain('pro');
  });
  it('uses the existing GPT2.5 builder to identify mode variants', async () => {
    const { imageProviderSnapshotModel } = await identity();
    expect(imageProviderSnapshotModel).toBeTypeOf('function');
    expect(imageProviderSnapshotModel({ model: 'gpt-image-2.5-reapi', gptImage25Mode: 'sunburst', aspectRatio: '1:1', resolution: '2K', quality: 'medium' })).toBe('gpt-image-2.5-sunburst-official');
  });
});

it('retains the real Gemini weighted-input validator without promoting a static spec into availability', async () => {
 const { validateVideoResolvedInputs } = await normalization();
 const media = (kind: string) => ({ kind, localPath: 'https://media.test/x', position: 0, mediaId: 'm', fileName: 'x' });
 expect(() => validateVideoResolvedInputs({ model: 'gemini-omni-video', inputMode: 'multimodal', inputs: [media('image'),media('video')] })).not.toThrow();
 expect(() => validateVideoResolvedInputs({ model: 'gemini-omni-video', inputMode: 'multimodal', inputs: [...Array.from({length:6},()=>media('image')),media('video')] })).toThrow('配额');
});
