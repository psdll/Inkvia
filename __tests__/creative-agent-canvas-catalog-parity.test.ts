import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/prisma', () => ({ default: {}, prisma: {} }));
vi.mock('@/lib/providers/proxy-config', () => ({ readProxySettingRaw: vi.fn(async () => null), resolveProviderProxyFromRaw: vi.fn() }));
vi.mock('@/lib/providers/registry', () => ({ getRegisteredProviders: vi.fn() }));
vi.mock('@/lib/image-edit-models', async original => ({ ...await original<typeof import('@/lib/image-edit-models')>(), getVisibleImageEditModels: vi.fn(), getVisibleToolboxModels: vi.fn() }));
vi.mock('@/lib/server-auth', () => ({ getUserId: vi.fn(async () => 1) }));
vi.mock('@/lib/admin-auth', () => ({ requireAdminRequest: vi.fn(() => ({ok:false})) }));
vi.mock('@/lib/llm-routing/visibility', () => ({ getLlmModelVisibility: vi.fn(async () => ({})), getLlmModelDisplayNames: vi.fn(async () => ({})), isLlmModelVisible: vi.fn(), getLlmModelDisplayName: vi.fn() }));
vi.mock('@/lib/llm-routing/resolver', () => ({ resolveLlmRoute: vi.fn(async () => ({status:'missing-binding'})), resolveLlmRouteFromProviders: vi.fn(), attachLlmEgressDecision: vi.fn() }));
import { getRegisteredProviders } from '@/lib/providers/registry';
import { getVisibleImageEditModels, getVisibleToolboxModels } from '@/lib/image-edit-models';
import { TOOLBOX_MODEL_DEFINITIONS } from '@/lib/toolbox-models';
import { getCreativeAgentModelCatalog } from '@/lib/creative-agent/model-catalog';
import { getEffectiveCreativeMediaCatalog } from '@/lib/creative-agent/effective-media-catalog';
import { GET } from '@/app/api/canvas/models/route';
import { NextRequest } from 'next/server';
import { matchMediaCandidates } from '@/lib/creative-agent/matching';

describe('Agent and canvas effective page surface', () => {
 it('uses the exact canvas reader, parameter overrides, and visible variant labels', async () => {
  const image = TOOLBOX_MODEL_DEFINITIONS.find(m => m.id === 'gpt-image-2.5-reapi')!;
  const video = TOOLBOX_MODEL_DEFINITIONS.find(m => m.id === 'doubao-seedance-2-5-260628')!;
  const provider = (definition: typeof image) => ({ id: definition.provider, name: definition.provider, enabled: true, apiKey: 'configured', egressMode: 'direct', baseUrl: 'https://example.test', protocol: 'openai-chat', modelProtocols: {}, chatModels: [], imageModels: definition.category === 'image' ? definition.upstreamModelIds ?? [definition.upstreamModelId ?? definition.id] : [], videoModels: definition.category === 'video' ? definition.upstreamModelIds ?? [definition.upstreamModelId ?? definition.id] : [], sortOrder: 0 });
  vi.mocked(getRegisteredProviders).mockResolvedValue([provider(image),provider(video)] as any);
  vi.mocked(getVisibleImageEditModels).mockResolvedValue([{ ...image, label: 'Visible image', gptImage25Variants: [{ mode: 'sunburst', label: 'Only pro' }] }] as any);
  vi.mocked(getVisibleToolboxModels).mockImplementation(async category => category === 'video' ? [{ ...video, supportedResolutions: ['480p'], minDurationSeconds: 5, maxDurationSeconds: 8, durationOptions: [5,8] }] as any : []);
  const page = await (await GET(new NextRequest('http://localhost/api/canvas/models'))).json();
  const agent = await getCreativeAgentModelCatalog();
  expect(agent.image.map(m => m.id)).toEqual(page.image.map((m: any) => m.id));
  expect(agent.image[0].params).toEqual(page.image[0].params);
  expect(agent.image[0].gptImage25Variants).toEqual(page.image[0].gptImage25Variants);
  expect(agent.video[0].params).toMatchObject({ supportedResolutions: page.video[0].supportedResolutions, minDurationSeconds: 5, maxDurationSeconds: 8, durationOptions: [5,8] });
  // A configured provider is insufficient once its page entry or mode disappears.
  vi.mocked(getVisibleImageEditModels).mockResolvedValue([]);
  const hidden = await getEffectiveCreativeMediaCatalog();
  expect(hidden.image).toEqual([]); expect(hidden.unavailable.find(m => m.id === image.id)?.reasons).toContain('ADMIN_HIDDEN');
  for (const explicit of [image.id, 'Only pro', 'gpt-image-2.5-reapi:pro']) {
   expect(matchMediaCandidates({ mediaType: 'image', request: { prompt: 'x' }, references: [], catalog: hidden, preferences: { image: { mode: 'explicit', model: explicit } } }).selected).toBeUndefined();
  }
  vi.mocked(getVisibleImageEditModels).mockResolvedValue([{ ...image, gptImage25Variants: [{ mode: 'flare', label: 'Only fast' }] }] as any);
  const enabled = await getEffectiveCreativeMediaCatalog();
  expect(enabled.image[0].qualification.available).toBe(true);
  expect(matchMediaCandidates({ mediaType: 'image', request: { model: 'gpt-image-2.5-reapi:pro', prompt: 'x' }, references: [], catalog: enabled }).selected?.request.params.gptImage25Mode).toBe('flare');
  expect(matchMediaCandidates({ mediaType: 'image', request: { prompt: 'x' }, references: [], catalog: enabled, preferences: { image: { mode: 'explicit', model: 'gpt-image-2.5-reapi:pro' } } }).selected).toBeUndefined();
 });
});
