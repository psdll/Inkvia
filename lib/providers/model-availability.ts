import { MEDIAKIT_PROVIDER, MEDIAKIT_SUBTITLE_MODEL } from "@/lib/volcengine-mediakit-models";
import { REAPI_LLM_MODELS } from "@/lib/reapi-llm-models";
import { MINIMAX_LLM_MODELS } from "@/lib/minimax-llm-models";
import { BAILIAN_LLM_MODELS } from "@/lib/bailian-llm-models";
import { DOUBAO_SEED_EVOLVING_MODEL_ID } from "@/lib/volcengine-llm-models";
import { BIGMODEL_LLM_MODELS } from "@/lib/bigmodel-llm-models";
import {
  TOOLBOX_MODEL_DEFINITIONS,
  type ToolboxModelDefinition,
} from "@/lib/toolbox-models";
import { isMidjourneyV8Model } from "@/lib/midjourney-v8";
import { getLiveVideoBatchModelSpec } from "@/lib/live-video-batch/video-models";
import type { ProviderConfig } from "./types";
import { isRetiredProviderModel } from "./retired-models";

export type ProviderModelKind = "image" | "video" | "audio" | "chat";
type AdapterModelKind = Exclude<ProviderModelKind, "chat">;

export type ProviderModelCapability = {
  adapterBacked: boolean;
  usages: readonly string[];
};

const MODEL_KEYS: Record<ProviderModelKind, "imageModels" | "videoModels" | "audioModels" | "chatModels"> = {
  image: "imageModels",
  chat: "chatModels",
  video: "videoModels",
  audio: "audioModels",
};

export function hasConfiguredProviderModels(
  provider: Pick<ProviderConfig, "imageModels" | "videoModels" | "audioModels" | "chatModels">,
): boolean {
  return provider.imageModels.length > 0
    || provider.videoModels.length > 0
    || (provider.audioModels?.length ?? 0) > 0
    || provider.chatModels.length > 0;
}

function normalizeAdapterModelId(kind: AdapterModelKind, modelId: string) {
  if (kind === "image" && (modelId === "gpt-image-2-text-to-image" || modelId === "gpt-image-2-image-to-image")) {
    return "gpt-image-2";
  }
  return modelId;
}

function findAdapterModel(kind: AdapterModelKind, modelId: string): ToolboxModelDefinition | undefined {
  const normalizedModelId = normalizeAdapterModelId(kind, modelId);
  return TOOLBOX_MODEL_DEFINITIONS.find((model) => model.category === kind && model.id === normalizedModelId);
}

function findAdapterModelForProvider(
  providerId: string,
  kind: AdapterModelKind,
  modelId: string,
): ToolboxModelDefinition | undefined {
  const normalizedModelId = normalizeAdapterModelId(kind, modelId);
  return TOOLBOX_MODEL_DEFINITIONS.find((model) => (
    model.category === kind
    && model.provider === providerId
    && (
      model.id === normalizedModelId
      || model.upstreamModelId === normalizedModelId
      || model.upstreamModelIds?.includes(normalizedModelId)
    )
  ));
}

function getAdapterModelUsages(model: ToolboxModelDefinition): readonly string[] {
  if (model.category === "image") {
    return isMidjourneyV8Model(model.id)
      ? ["创作", "画布"]
      : ["创作", "批量", "画布"];
  }
  if (model.category === "video") {
    return getLiveVideoBatchModelSpec(model.id)
      ? ["创作", "批量", "画布"]
      : ["创作", "画布"];
  }
  if (model.purpose === "speech-recognition") return ["Agent 拆解视频"];
  if (model.category === "audio") return ["画布"];
  return [];
}

export function getProviderModelCapability(
  providerId: string,
  kind: ProviderModelKind,
  modelId: string,
): ProviderModelCapability {
  if (isRetiredProviderModel(providerId, modelId)) return { adapterBacked: false, usages: [] };
  if (providerId === MEDIAKIT_PROVIDER && kind === "video" && modelId === MEDIAKIT_SUBTITLE_MODEL) return { adapterBacked: true, usages: ["画布去字幕"] };
  if (kind === "chat") return { adapterBacked: true, usages: [] };
  const adapterModel = findAdapterModelForProvider(providerId, kind, modelId);
  return {
    adapterBacked: adapterModel !== undefined,
    usages: adapterModel ? getAdapterModelUsages(adapterModel) : [],
  };
}

export function isProviderModelEnabled(
  providers: ProviderConfig[],
  kind: ProviderModelKind,
  modelId: string,
): boolean {
  if (kind === "chat") {
    return providers.some((provider) => !isRetiredProviderModel(provider.id, modelId) && provider.enabled !== false && provider.chatModels.includes(modelId));
  }

  if (kind === "video" && modelId === MEDIAKIT_SUBTITLE_MODEL) return providers.some(p => p.id === MEDIAKIT_PROVIDER && p.enabled !== false && p.videoModels.includes(modelId));
  const definition = findAdapterModel(kind, modelId);
  if (!definition) return false;
  const requiredUpstreamModelIds = definition.upstreamModelIds
    ?? [definition.upstreamModelId ?? definition.id];

  return providers.some((provider) => (
    provider.id === definition.provider
    && provider.enabled !== false
    && requiredUpstreamModelIds.every((upstreamModelId) => (
      (provider[MODEL_KEYS[kind]] ?? []).includes(upstreamModelId)
    ))
  ));
}

export function filterEnabledAdapterModels(
  providers: ProviderConfig[],
  kind: AdapterModelKind,
): ToolboxModelDefinition[] {
  return TOOLBOX_MODEL_DEFINITIONS.filter((model) => (
    model.category === kind && isProviderModelEnabled(providers, kind, model.id)
  ));
}

/** Built-in integrations remain in the platform; fetched additions can be removed. */
export function isBuiltinProviderModel(providerId: string, kind: ProviderModelKind, modelId: string): boolean {
  if (providerId === MEDIAKIT_PROVIDER && kind === "video" && modelId === MEDIAKIT_SUBTITLE_MODEL) return true;
  if (kind !== "chat") return findAdapterModelForProvider(providerId, kind, modelId) !== undefined;
  const models: readonly string[] = providerId === "reapi" ? REAPI_LLM_MODELS
    : providerId === "volcengine" ? [DOUBAO_SEED_EVOLVING_MODEL_ID]
    : providerId === "minimax" ? MINIMAX_LLM_MODELS
    : providerId === "bigmodel" ? BIGMODEL_LLM_MODELS
    : providerId === "bailian" ? BAILIAN_LLM_MODELS : [];
  return models.includes(modelId);
}
