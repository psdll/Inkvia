import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ asset: null as any }));
vi.mock('@/lib/prisma', () => ({ default: { mediaAsset: { findFirst: vi.fn(async () => state.asset) }, generation: { findFirst: vi.fn(async () => null) } } }));
vi.mock('@/lib/creative-agent/reference-preparation', () => ({ resolvePreparedCreativeMedia: vi.fn(async () => null) }));
vi.mock('@/lib/creative-agent/media-files', () => ({ probeRuntimeMedia: vi.fn(async () => ({ state: 'verified', kind: 'image', contentVersion: 'b'.repeat(64), width: 1024, height: 1024, sizeBytes: 1000, detectedMime: 'image/png' })) }));
import { probeRuntimeMedia } from '@/lib/creative-agent/media-files';
async function bindings() { const file = '../lib/creative-agent/reference-facts'; return import(file).catch(() => ({})) as Promise<Record<string, any>>; }
describe('verified media reference facts', () => {
  it('checks asset scope and exact canonical content URL before probing', async () => {
    const { bindCreativeReferenceFacts } = await bindings(); expect(bindCreativeReferenceFacts).toBeTypeOf('function');
    const ref = { nodeId: 'n', semanticHash: 'a'.repeat(64), mediaId: 'm', kind: 'image', url: '/uploads/a.png' };
    const node = { id: 'n', data: { kind: 'image', mediaId: 'm', url: '/uploads/a.png' } };
    state.asset = { kind: 'image', publicUrl: '/uploads/other.png' };
    await expect(bindCreativeReferenceFacts({ actorUserId: 1, canvasId: 2 }, node, ref)).rejects.toMatchObject({ code: 'REFERENCE_NOT_VERIFIED' });
    expect(probeRuntimeMedia).not.toHaveBeenCalled();
    state.asset = { kind: 'image', publicUrl: ref.url };
    await expect(bindCreativeReferenceFacts({ actorUserId: 1, canvasId: 2 }, node, ref)).resolves.toMatchObject({ ...ref, facts: { state: 'verified', contentVersion: 'b'.repeat(64) } });
    expect(probeRuntimeMedia).toHaveBeenCalledOnce();
  });
});

it('hydrates ownership identity from the validated canvas node when optional IDs were omitted', async () => {
 const { bindCreativeReferenceFacts } = await bindings();
 state.asset = { kind: 'image', publicUrl: '/uploads/a.png' };
 const ref = { nodeId: 'n', semanticHash: 'a'.repeat(64), kind: 'image', url: '/uploads/a.png' };
 const node = { id: 'n', data: { kind: 'image', mediaId: 'm', url: ref.url } };
 await expect(bindCreativeReferenceFacts({ actorUserId: 1, canvasId: 2 }, node, ref)).resolves.toMatchObject({ facts: { state: 'verified' } });
});
