import type { ProviderConfig } from "@/lib/providers/types";

type DisplayModel = {
  id: string;
  provider: string;
  category: string;
  modelId?: string;
  upstreamModelId?: string;
  upstreamModelIds?: string[];
};

export function getReadOnlyProviderModels(providers: ProviderConfig[], displayed: DisplayModel[]) {
  return providers.flatMap(provider => ([
    ["image", provider.imageModels],
    ["video", provider.videoModels],
    ["audio", provider.audioModels],
  ] as const).flatMap(([category, ids]) => [...new Set(ids || [])]
    .filter(modelId => !displayed.some(model => model.provider === provider.id && model.category === category
      && [model.id, model.modelId, model.upstreamModelId, ...(model.upstreamModelIds || [])].includes(modelId)))
    .map(modelId => ({
      id: `api:${JSON.stringify([provider.id, category, modelId])}`,
      modelId,
      label: modelId,
      provider: provider.id,
      providerName: provider.name,
      category,
      visibilityControl: false as const,
    }))));
}
