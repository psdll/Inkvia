import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/prisma', () => ({ default: {}, prisma: {} }));
vi.mock('@/lib/providers/registry', () => ({ getRegisteredProviders: vi.fn() }));
vi.mock('@/lib/image-edit-models', () => ({ getVisibleImageEditModels: vi.fn(), getVisibleToolboxModels: vi.fn() }));
import { getRegisteredProviders } from '@/lib/providers/registry';
import { getVisibleImageEditModels, getVisibleToolboxModels } from '@/lib/image-edit-models';
import { getVideoModelSpec } from '@/lib/sora2';
import { TOOLBOX_MODEL_DEFINITIONS } from '@/lib/toolbox-models';

async function capabilityModule() {
  const file = '../lib/creative-agent/effective-media-catalog';
  return import(file).catch(() => ({})) as Promise<Record<string, any>>;
}
describe('effective server media capabilities', () => {
  it('shares administrator effective video values and returns qualification without secrets', async () => {
    const definition = TOOLBOX_MODEL_DEFINITIONS.find(m => m.category === 'video' && m.id === 'doubao-seedance-2-5-260628')!;
    expect(definition).toBeDefined();
    vi.mocked(getRegisteredProviders).mockResolvedValue([{ id: definition.provider, enabled: true, apiKey: 'private-secret', videoModels: definition.upstreamModelIds ?? [definition.upstreamModelId ?? definition.id], imageModels: [], chatModels: [], modelProtocols: {}, protocol: 'volcengine', baseUrl: 'https://example.test', egressMode: 'direct', name: 'provider', sortOrder: 0 }]);
    vi.mocked(getVisibleImageEditModels).mockResolvedValue([]);
    vi.mocked(getVisibleToolboxModels).mockResolvedValue([{ ...definition, supportedResolutions: ['480p'], maxDurationSeconds: 15 }]);
    const { getEffectiveCreativeMediaCatalog } = await capabilityModule();
    expect(getEffectiveCreativeMediaCatalog).toBeTypeOf('function');
    const catalog = await getEffectiveCreativeMediaCatalog();
    const model = catalog.video.find((m: any) => m.id === definition.id);
    expect(model).toMatchObject({ supportedResolutions: ['480p'], maxDurationSeconds: 15, qualification: { available: true, entitlement: 'unverified' } });
    expect(JSON.stringify(catalog)).not.toContain('private-secret');
    expect(getVideoModelSpec(definition.id).maxDurationSeconds).not.toBe(15);
  });
  it('retains disabled and missing-key exclusions without claiming support for unknown IDs', async () => {
    vi.mocked(getRegisteredProviders).mockResolvedValue([]);
    vi.mocked(getVisibleImageEditModels).mockResolvedValue([{ id: 'unregistered-new-name', label: 'Perfect model' }] as any);
    vi.mocked(getVisibleToolboxModels).mockResolvedValue([]);
    const { getEffectiveCreativeMediaCatalog } = await capabilityModule();
    expect(getEffectiveCreativeMediaCatalog).toBeTypeOf('function');
    const catalog = await getEffectiveCreativeMediaCatalog();
    expect(catalog.image.find((m: any) => m.id === 'unregistered-new-name')).toBeUndefined();
    expect(catalog.unavailable.length).toBeGreaterThan(0);
    expect(catalog.unavailable[0].reasons.length).toBeGreaterThan(0);
  });
});
