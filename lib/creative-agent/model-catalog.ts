import "server-only";
import { getLlmThinkingCapabilities, normalizeLlmThinkingLevel } from "@/lib/llm-routing/reasoning";
import { getRegisteredProviders } from "@/lib/providers/registry";
import {
  readProxySettingRaw,
  resolveProviderProxyFromRaw,
} from "@/lib/providers/proxy-config";
import {
  resolveLlmRouteFromProviders,
  attachLlmEgressDecision,
} from "@/lib/llm-routing/resolver";
import { getLlmModelModalities } from "@/lib/llm-routing/model-modalities";
import { CHAT_CONTEXT_WINDOWS } from "./v3/model-profiles";

/** 对话模型的上下文窗口：部署配置优先，其次是已知模型表；都没有时不显示 */
function chatContextWindow(modelId: string) {
  try {
    const configured = JSON.parse(process.env.INKVIA_AGENT_CONTEXT_LIMITS || "{}")[modelId]?.contextWindow;
    if (Number.isSafeInteger(configured) && configured > 0) return configured as number;
  } catch { /* 配置格式错误时退回已知值 */ }
  return CHAT_CONTEXT_WINDOWS[modelId];
}
import { getLlmModelVisibility, isLlmModelVisible, getLlmModelDisplayNames, getLlmModelDisplayName } from "@/lib/llm-routing/visibility";
import { getEffectiveCreativeMediaCatalog } from "./effective-media-catalog";
import { getImageModelParams } from "@/lib/generation/image-model-params";
import { resolveCreativeAgentPreferences } from "./preferences";
import type { CreativeAgentInputOptions } from "./contracts";
import type { ProviderConfig } from "@/lib/providers/types";
import { CreativeAgentError } from "./errors";

export async function resolveCreativeAgentModel(
  model?: CreativeAgentInputOptions["model"],
) {
  if (!model) return { status: "missing-binding" as const };
  const [providers, rawProxy, visibility] = await Promise.all([getRegisteredProviders(), readProxySettingRaw(), getLlmModelVisibility(true)]);
  return resolveRegisteredModel(model, providers, rawProxy, visibility);
}

function resolveRegisteredModel(
  model: NonNullable<CreativeAgentInputOptions["model"]>,
  providers: ProviderConfig[],
  rawProxy: string | null,
  visibility: Record<string, boolean>,
) {
  const proxyStatusByProviderId = Object.fromEntries(
    providers
      .filter((p) => p.egressMode === "proxy")
      .map((p) => [p.id, resolveProviderProxyFromRaw(p.id, rawProxy).status]),
  );
  // Agent requests always use the conversation's explicit model selection.
  const provider = providers.find((item) => item.id === model.providerId);
  if (
    !provider ||
    provider.enabled === false ||
    !provider.chatModels.includes(model.modelId) ||
    !isLlmModelVisible(visibility, model.providerId, model.modelId)
  )
    return { status: "model-disabled" as const };
  const result = resolveLlmRouteFromProviders({
    scenarioId: "agent.chat",
    binding: model,
    providers,
    proxyStatusByProviderId,
  });
  return result.status === "ready"
    ? {
        ...result,
        route: attachLlmEgressDecision(
          { ...result.route, source: "node-override" },
          providers,
          rawProxy,
        ),
      }
    : result;
}
export function creativeAgentSupportsVision(
  providerId: string,
  modelId: string,
) {
  return (
    getLlmModelModalities(providerId, modelId)?.input.includes("image") === true
  );
}
export async function getCreativeAgentChatModels() {
  const [providers, rawProxy, visibility, displayNames] = await Promise.all([getRegisteredProviders(), readProxySettingRaw(), getLlmModelVisibility(true), getLlmModelDisplayNames()]);
  const chat = [];
  for (const provider of providers)
    for (const modelId of provider.chatModels) {
      const resolved = resolveRegisteredModel({
        providerId: provider.id,
        modelId,
      }, providers, rawProxy, visibility);
      if (
        resolved.status === "ready" &&
        resolved.route.protocol === "openai-chat"
      )
        chat.push({
          providerId: provider.id,
          modelId,
          label: `${provider.name} · ${getLlmModelDisplayName(displayNames, provider.id, modelId)}`,
          supportsVision: creativeAgentSupportsVision(provider.id, modelId),
          ...(chatContextWindow(modelId) ? { contextWindow: chatContextWindow(modelId) } : {}),
          ...getLlmThinkingCapabilities(resolved.route),
        });
    }
  return chat;
}

export async function getCreativeAgentModelCatalog() {
  const [chat, media] = await Promise.all([getCreativeAgentChatModels(), getEffectiveCreativeMediaCatalog()]);
  return {
    chat,
    image: media.image.filter(model => model.qualification.available).map(({ id, label, params, variants }) => ({ id, label, params, ...(variants ? { gptImage25Variants: variants.map(({ mode, label }) => ({ mode, label })) } : {}) })),
    video: media.video.filter(model => model.qualification.available).map(({ aliases: _aliases, qualification: _qualification, ...params }) => ({ id: params.id, label: params.label, params })),
  };
}

export async function validateCreativeAgentOptions(
  input: CreativeAgentInputOptions,
  options: { deferMedia?: boolean } = {},
) {
  if (!input.model) throw new CreativeAgentError("MODEL_REQUIRED", "请先在创作偏好中选择推理模型", 400);
  const resolved = await resolveCreativeAgentModel(input.model);
  if (resolved.status !== "ready" || resolved.route.protocol !== "openai-chat")
    throw new CreativeAgentError(
      "MODEL_UNAVAILABLE",
      "所选 Agent 对话模型当前不可用",
      400,
    );
  if (!getLlmThinkingCapabilities(resolved.route).thinkingLevels.includes(normalizeLlmThinkingLevel(input.thinkingLevel)))
    throw new CreativeAgentError(
      "THINKING_UNSUPPORTED",
      "当前配置未声明可用的思考等级",
      400,
    );
  const preferences = resolveCreativeAgentPreferences(input.preferences);
  if (!options.deferMedia && (preferences.image || preferences.video)) {
    const catalog = await getCreativeAgentModelCatalog();
    const supportedOption = (value: string | undefined, options: { value: string; disabled?: boolean }[]) => value === undefined || options.some(option => option.value === value && !option.disabled);
    for (const mediaType of ["image", "video"] as const) {
      const preference = preferences[mediaType];
      if (!preference) continue;
      const candidates = catalog[mediaType].filter(model => preference.mode === "auto" || model.id === preference.model);
      if (!candidates.length) throw new CreativeAgentError("MEDIA_MODEL_UNAVAILABLE", "所选生成模型当前不可用，请查询 generation_models 并调整创作偏好。", 400);
      const supported = mediaType === "image"
        ? catalog.image.filter(model => candidates.some(candidate => candidate.id === model.id)).some(model => {
            const params = preferences.image!.params;
            if (!params) return true;
            const config = getImageModelParams(model.id, params.resolution, params.aspectRatio);
            return supportedOption(params.aspectRatio, config.aspectRatios) && supportedOption(params.resolution, config.resolutions) && supportedOption(params.quality, config.qualities) && supportedOption(params.background, config.backgrounds ?? []);
          })
        : catalog.video.filter(model => candidates.some(candidate => candidate.id === model.id)).some(model => {
            const params = preferences.video!.params;
            if (!params) return true;
            const config = model.params;
            return (params.ratio === undefined || (config.supportedRatios ?? ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]).includes(params.ratio))
              && (params.resolution === undefined || config.supportedResolutions.includes(params.resolution as never))
              && (params.duration === undefined || (params.duration >= config.minDurationSeconds && params.duration <= config.maxDurationSeconds && (!config.durationOptions || config.durationOptions.includes(params.duration))))
              && (params.generateAudio !== true || config.supportsGenerateAudio);
          });
      if (!supported) throw new CreativeAgentError("MEDIA_PARAMS_INVALID", `当前可用${mediaType === "image" ? "图片" : "视频"}模型无法满足固定参数，请查询 generation_models 并调整冲突的偏好；不会自动降低规格。`, 400);
    }
  }
  return resolved.route;
}
