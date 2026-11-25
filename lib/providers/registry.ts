import { VOLC_SEEDREAM_55_UPSTREAM } from "@/lib/volcengine-seedream-55";
import { APIMART_SEEDREAM_55_UPSTREAM } from "@/lib/apimart-seedream-55";
import { KIE_NANO_BANANA_21_MODEL, APIMART_NANO_BANANA_21_UPSTREAM } from "@/lib/nano-banana-21-providers";
import { MEDIAKIT_PROVIDER, MEDIAKIT_SUBTITLE_MODEL, MEDIAKIT_BASE_URL } from "@/lib/volcengine-mediakit-models";
import { VOLC_ASR_MODEL_ID, VOLC_ASR_PROVIDER_ID } from "@/lib/volcengine-asr-models";
import { DOUBAO_SEED_EVOLVING_MODEL_ID } from "@/lib/volcengine-llm-models";
import { GOOGLE_NANO_BANANA_21_MODEL } from "@/lib/google-nano-banana-21";
// 供应商动态注册表 —— AppSetting 持久化 + 内建默认合并。
//
// 范式照搬 lib/agent/model-config.ts：DB(AppSetting) > 内建默认。
// 存储：AppSetting.key = 'providers.registry'，value = JSON(ProviderConfig[])。
// saved key 可随配置仅在服务端持久化；admin overview 永不返回明文。

import "server-only";

import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import {
  getApimartBaseUrl,
  getJiekouBaseUrl,
  getVolcengineArkBaseUrl,
} from "@/lib/config";
import {
  getProviderUpstreamModelId,
  AUDIO_MODEL_DEFINITIONS,
  IMAGE_EDIT_MODEL_DEFINITIONS,
  VIDEO_MODEL_DEFINITIONS,
  type ToolboxModelProvider,
} from "@/lib/toolbox-models";
import type { ProviderConfig, ProviderEgressMode, ProviderProtocol, ResolvedProvider } from "./types";
import { SEEDANCE_25_MODEL_ID, APIMART_SEEDANCE_25_UPSTREAM_MODEL } from "@/lib/sora2";
import { LEGACY_AICOMING_MINIMAX_H3_UPSTREAM_MODEL } from "@/lib/minimax-models";
import { APIMART_GPT_IMAGE_25_UPSTREAM_MODELS } from "@/lib/apimart-gpt-image-25";
import { APIMART_GPT_IMAGE_26_UPSTREAM_MODELS, APIMART_NANO_BANANA_PRO_UPSTREAM_MODEL } from "@/lib/apimart-image-models";
import { REAPI_LLM_MODELS } from "@/lib/reapi-llm-models";
import { isRetiredProviderModel } from "./retired-models";
import { sortAdminProviders } from "./order";
import { MINIMAX_LLM_MODELS } from "@/lib/minimax-llm-models";
import { BAILIAN_LLM_MODELS } from "@/lib/bailian-llm-models";
import { BIGMODEL_BASE_URL, BIGMODEL_LLM_MODELS } from "@/lib/bigmodel-llm-models";

export const SETTING_KEY_PROVIDERS = "providers.registry";
const LEGACY_REAPI_PROVIDER_ID = "custom-gpt-image-2-official";
const RETIRED_PROVIDER_IDS = new Set(["aicoming", "fal", "easyrouter", "runninghub"]);

export function isRetiredProviderId(providerId: unknown) {
  return RETIRED_PROVIDER_IDS.has(String(providerId || "").trim());
}

export class ProviderRegistryConfigurationError extends Error {
  constructor(message = "Provider registry configuration is invalid") {
    super(message);
    this.name = "ProviderRegistryConfigurationError";
  }
}

export type ProviderRegistryClient = Pick<Prisma.TransactionClient, "appSetting">;

type BuiltinMeta = {
  name: string;
  protocol: ProviderProtocol;
  baseUrl: () => string;
  envKeyName: string;
  egressMode: ProviderEgressMode;
  defaultEnabled?: boolean;
  websiteUrl?: string;
};

/** Earlier default names, upgraded to the current builtin name unless an admin renamed the platform. */
const LEGACY_BUILTIN_NAMES: Record<string, string[]> = {
  volcengine: ["火山引擎"],
  bailian: ["阿里云百炼"],
  bigmodel: ["智谱 BigModel"],
  "volcengine-speech": ["火山引擎语音"],
  [MEDIAKIT_PROVIDER]: ["火山引擎 AI MediaKit"],
};

// 内建平台元数据（baseUrl 用函数延迟取，确保读到当前 env）。
const BUILTIN_META: Record<string, BuiltinMeta> = {
  apimart: { name: "APIMART", protocol: "apimart", baseUrl: () => getApimartBaseUrl(), envKeyName: "APIMART_API_KEY", egressMode: "proxy", websiteUrl: "https://apimart.ai" },
  kie: { name: "KIE.AI", protocol: "openai", baseUrl: () => String(process.env.KIE_BASE_URL || "").trim() || "https://api.kie.ai", envKeyName: "KIE_API_KEY", egressMode: "direct", websiteUrl: "https://kie.ai" },
  jiekou: { name: "接口AI", protocol: "openai", baseUrl: () => getJiekouBaseUrl(), envKeyName: "JIEKOU_API_KEY", egressMode: "direct", websiteUrl: "https://highwayapi.ai" },
  volcengine: { name: "火山引擎官方", protocol: "volcengine", baseUrl: () => getVolcengineArkBaseUrl(), envKeyName: "VOLCENGINE_ARK_API_KEY", egressMode: "direct", websiteUrl: "https://console.volcengine.com/ark" },
  "google-ai-studio": { name: "Google AI Studio", protocol: "gemini", baseUrl: () => String(process.env.GOOGLE_AI_STUDIO_BASE_URL || "").trim() || "https://generativelanguage.googleapis.com", envKeyName: "GOOGLE_AI_STUDIO_API_KEY", egressMode: "proxy", websiteUrl: "https://aistudio.google.com" },
  reapi: { name: "reAPI", protocol: "openai", baseUrl: () => String(process.env.REAPI_BASE_URL || "").trim() || "https://reapi.ai/api/v1", envKeyName: "", egressMode: "direct", defaultEnabled: false, websiteUrl: "https://reapi.ai" },
  "aicoming-haiya": { name: "海牙科技（AIComing）", protocol: "openai", baseUrl: () => String(process.env.AICOMING_HAIYA_BASE_URL || "").trim() || "https://api.aicoming.top/v1", envKeyName: "", egressMode: "direct", defaultEnabled: false, websiteUrl: "https://aicoming.top" },
  minimax: { name: "MiniMax 官方", protocol: "openai", baseUrl: () => "https://api.minimaxi.com", envKeyName: "", egressMode: "direct", defaultEnabled: false, websiteUrl: "https://platform.minimaxi.com" },
  [MEDIAKIT_PROVIDER]: { name: "火山引擎 AI MediaKit 官方", protocol: "volcengine", baseUrl: () => MEDIAKIT_BASE_URL, envKeyName: "", egressMode: "direct", defaultEnabled: false, websiteUrl: "https://console.volcengine.com" },
  "volcengine-speech": { name: "火山引擎语音官方", protocol: "volcengine", baseUrl: () => "https://openspeech.bytedance.com", envKeyName: "", egressMode: "direct", defaultEnabled: false, websiteUrl: "https://console.volcengine.com/speech/app" },
  bailian: { name: "阿里云百炼官方", protocol: "openai", baseUrl: () => String(process.env.BAILIAN_BASE_URL || "").trim(), envKeyName: "", egressMode: "direct", defaultEnabled: false, websiteUrl: "https://bailian.console.aliyun.com" },
  tuzi: { name: "兔子 API", protocol: "openai", baseUrl: () => "https://api.tu-zi.com/v1", envKeyName: "", egressMode: "direct", defaultEnabled: false, websiteUrl: "https://api.tu-zi.com" },
  deepseek: { name: "DeepSeek 官方", protocol: "openai", baseUrl: () => "https://api.deepseek.com", envKeyName: "", egressMode: "direct", defaultEnabled: false, websiteUrl: "https://platform.deepseek.com" },
  bigmodel: { name: "智谱 BigModel 官方", protocol: "openai", baseUrl: () => BIGMODEL_BASE_URL, envKeyName: "", egressMode: "direct", defaultEnabled: false, websiteUrl: "https://open.bigmodel.cn" },
  "work-fisher": { name: "FisherAI", protocol: "openai", baseUrl: () => "https://api.work-fisher.com/v1", envKeyName: "", egressMode: "direct", defaultEnabled: false, websiteUrl: "https://api.work-fisher.com" },
  openrouter: { name: "OpenRouter", protocol: "openai", baseUrl: () => String(process.env.OPENROUTER_BASE_URL || "").trim() || "https://openrouter.ai/api/v1", envKeyName: "", egressMode: "proxy", defaultEnabled: false, websiteUrl: "https://openrouter.ai" },
};

function modelsByProvider(
  provider: ToolboxModelProvider,
  defs: { id: string; provider: string; upstreamModelId?: string; upstreamModelIds?: string[] }[],
): string[] {
  return defs
    .filter((m) => m.provider === provider)
    .flatMap((m) => m.upstreamModelIds ?? [m.upstreamModelId ?? m.id]);
}

function normalizeProviderModelIds(provider: ProviderConfig): ProviderConfig {
  const normalize = (models: string[]) => Array.from(new Set(
    models.map((modelId) => getProviderUpstreamModelId(provider.id,
      provider.id === "work-fisher" && modelId === "qwen-image-2.1"
        ? "qwen-image-global-2.1" : modelId)),
  ));
  return {
    ...provider,
    imageModels: normalize(provider.imageModels ?? []),
    videoModels: normalize(provider.videoModels ?? []),
    audioModels: normalize(provider.audioModels ?? []),
  };
}

/** 由现有写死目录(toolbox-models) + env 元数据派生的「内建供应商」基线。 */
export function getBuiltinProviders(): ProviderConfig[] {
  const ids = Object.keys(BUILTIN_META);
  return ids.map((id, index) => {
    const meta = BUILTIN_META[id];
    return {
      id,
      name: meta.name,
      protocol: meta.protocol,
      baseUrl: meta.baseUrl(),
      envKeyName: meta.envKeyName,
      egressMode: meta.egressMode,
      allowLegacyFallback: true,
      imageModels: modelsByProvider(id as ToolboxModelProvider, IMAGE_EDIT_MODEL_DEFINITIONS),
      videoModels: id === MEDIAKIT_PROVIDER ? [MEDIAKIT_SUBTITLE_MODEL] : modelsByProvider(id as ToolboxModelProvider, VIDEO_MODEL_DEFINITIONS),
      audioModels: modelsByProvider(id as ToolboxModelProvider, AUDIO_MODEL_DEFINITIONS),
      chatModels: id === "reapi" ? [...REAPI_LLM_MODELS]
        : id === "volcengine" ? [DOUBAO_SEED_EVOLVING_MODEL_ID]
        : id === "minimax" ? [...MINIMAX_LLM_MODELS]
        : id === "bigmodel" ? [...BIGMODEL_LLM_MODELS]
          : id === "bailian" ? [...BAILIAN_LLM_MODELS] : [],
      modelProtocols: {},
      ...(meta.websiteUrl ? { websiteUrl: meta.websiteUrl } : {}),
      enabled: meta.defaultEnabled !== false,
      sortOrder: index,
    } satisfies ProviderConfig;
  });
}

async function readSetting(key: string, client: ProviderRegistryClient = prisma): Promise<string | null> {
  const row = await client.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function writeSetting(key: string, value: string, client: ProviderRegistryClient = prisma): Promise<void> {
  await client.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

/** 读取 admin 保存的注册表（仅覆盖/新增项）。解析失败回空数组。 */
export async function getSavedProviders(client: ProviderRegistryClient = prisma): Promise<ProviderConfig[]> {
  const raw = await readSetting(SETTING_KEY_PROVIDERS, client);
  if (raw === null) return [];
  if (!raw.trim()) throw new ProviderRegistryConfigurationError();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new ProviderRegistryConfigurationError();
    const seen = new Set<string>();
    for (const item of parsed) {
      const id = item && typeof item === "object" && !Array.isArray(item)
        ? String((item as { id?: unknown }).id ?? "").trim()
        : "";
      if (!id || seen.has(id)) throw new ProviderRegistryConfigurationError();
      seen.add(id);
    }
    return parsed as ProviderConfig[];
  } catch {
    throw new ProviderRegistryConfigurationError();
  }
}

export async function saveProviders(
  list: ProviderConfig[],
  client: ProviderRegistryClient = prisma,
): Promise<void> {
  const activeProviders = (Array.isArray(list) ? list : [])
    .filter((provider) => !isRetiredProviderId(provider?.id))
    .map(removeLegacyAicomingMiniMaxH3)
    .map(removeRetiredModels);
  await writeSetting(SETTING_KEY_PROVIDERS, JSON.stringify(activeProviders), client);
}

function removeRetiredModels(provider: ProviderConfig): ProviderConfig {
  if (provider.id === "volcengine" || provider.id === "kie") {
    return {
      ...provider,
      ...(provider.id === "kie" ? { imageModels: (provider.imageModels ?? []).filter((id) => !isRetiredProviderModel(provider.id, id)) } : {}),
      videoModels: (provider.videoModels ?? []).filter((id) => !isRetiredProviderModel(provider.id, id)),
    };
  }
  if (provider.id === "jiekou") {
    return {
      ...provider,
      imageModels: (provider.imageModels ?? []).filter((id) => !isRetiredProviderModel(provider.id, id)),
    };
  }
  if (provider.id === "reapi" || provider.id === LEGACY_REAPI_PROVIDER_ID) {
    return {
      ...provider,
      imageModels: Array.from(new Set((provider.imageModels ?? [])
        .filter((id) => !isRetiredProviderModel(provider.id, id))
        .map((id) => id === "gpt-image-2.5-flare" || id === "gpt-image-2.5-sunburst" ? `${id}-official` : id))),
      chatModels: (provider.chatModels ?? []).filter((id) => !isRetiredProviderModel(provider.id, id)),
    };
  }
  return provider;
}

function removeLegacyAicomingMiniMaxH3(provider: ProviderConfig): ProviderConfig {
  if (provider.id !== "aicoming-haiya") return provider;
  const videoModels = (provider.videoModels ?? [])
    .filter((modelId) => modelId !== LEGACY_AICOMING_MINIMAX_H3_UPSTREAM_MODEL);
  return videoModels.length === (provider.videoModels ?? []).length
    ? provider
    : { ...provider, videoModels };
}

/** 实际生效的供应商列表：内建默认 ∪ admin 覆盖/新增（按 id 合并，saved 覆盖 builtin）。 */
export async function getRegisteredProviders(client: ProviderRegistryClient = prisma): Promise<ProviderConfig[]> {
  const saved = await getSavedProviders(client);
  return mergeSavedProvidersWithBuiltins(saved);
}

export function mergeSavedProvidersWithBuiltins(saved: ProviderConfig[]): ProviderConfig[] {
  const builtin = getBuiltinProviders();
  const byId = new Map<string, ProviderConfig>();
  // Keep configured positions stable; newly introduced builtins join the tail.
  const savedIds = new Set(saved.map(provider => provider?.id === LEGACY_REAPI_PROVIDER_ID ? "reapi" : provider?.id));
  let nextSort = Math.max(-1, ...builtin.map(p => p.sortOrder ?? 0), ...saved.map(p => p?.sortOrder ?? 0)) + 1;
  for (const p of builtin) byId.set(p.id, saved.length && !savedIds.has(p.id) ? { ...p, sortOrder: nextSort++ } : p);
  const hasCanonicalReapi = saved.some((provider) => provider?.id === "reapi");
  for (const p of saved) {
    if (!p || !p.id) continue;
    if (p.id === LEGACY_REAPI_PROVIDER_ID && hasCanonicalReapi) continue;
    const savedProvider = p.id === LEGACY_REAPI_PROVIDER_ID
      ? {
          ...p,
          id: "reapi",
          imageModels: Array.from(new Set([
            ...(byId.get("reapi")?.imageModels ?? []),
            ...(p.imageModels ?? []),
          ])),
        }
      : p;
    const normalizedProvider = removeRetiredModels(removeLegacyAicomingMiniMaxH3(normalizeProviderModelIds(savedProvider)));
    if (isRetiredProviderId(normalizedProvider.id)) continue;
    const base = byId.get(normalizedProvider.id);
    const rawMode = (normalizedProvider as { egressMode?: unknown }).egressMode;
    const missingMode = rawMode === undefined;
    const validMode = rawMode === "direct" || rawMode === "proxy";
    const merged = {
      ...(base || {}),
      ...normalizedProvider,
      ...(base && LEGACY_BUILTIN_NAMES[normalizedProvider.id]?.includes(normalizedProvider.name) ? { name: base.name } : {}),
      websiteUrl: normalizedProvider.websiteUrl || base?.websiteUrl,
      protocol: base?.protocol ?? "openai",
      envKeyName: base?.envKeyName ?? "",
      egressMode: validMode ? rawMode : (base?.egressMode ?? "direct"),
      allowLegacyFallback: Boolean(base),
      ...(!base ? {
        llmProtocol: "openai-chat" as const,
        llmEndpointTemplate: "chat/completions",
        imageModels: [],
        videoModels: [],
        audioModels: [],
        modelProtocols: {},
        imageRequestMode: undefined,
      } : {}),
      ...(!missingMode && !validMode ? { configurationError: "invalid-egress" as const } : {}),
    } as ProviderConfig;
    if (base && normalizedProvider.id === "google-ai-studio") {
      merged.imageModels = Array.from(new Set([...(normalizedProvider.imageModels ?? []), GOOGLE_NANO_BANANA_21_MODEL]));
    }
    // 新内置的语音识别模型：已保存过的火山语音配置里也要出现
    if (base && normalizedProvider.id === VOLC_ASR_PROVIDER_ID) {
      merged.audioModels = Array.from(new Set([...(normalizedProvider.audioModels ?? []), VOLC_ASR_MODEL_ID]));
    }
    if (base && normalizedProvider.id === "kie") {
      merged.imageModels = Array.from(new Set([...(normalizedProvider.imageModels ?? []), KIE_NANO_BANANA_21_MODEL]));
    }
    if (base && normalizedProvider.id === "openrouter") {
      merged.imageModels = Array.from(new Set([...(base.imageModels ?? []), ...(normalizedProvider.imageModels ?? [])]));
    }
    if (base && normalizedProvider.id === "reapi") {
      merged.imageModels = Array.from(new Set([
        ...(base.imageModels ?? []),
        ...(normalizedProvider.imageModels ?? []),
      ]));
      merged.chatModels = Array.from(new Set([
        ...(base.chatModels ?? []),
        ...(normalizedProvider.chatModels ?? []),
      ]));
    }
    if (base && normalizedProvider.id === "bailian") {
      merged.imageModels = Array.from(new Set([...(normalizedProvider.imageModels ?? []), "qwen-image-3.0", "qwen-image-3.0-pro"]));
    }
    if (base && normalizedProvider.id === "apimart") {
      merged.audioModels = Array.from(new Set([...(normalizedProvider.audioModels ?? []), "suno"]));
      merged.videoModels = Array.from(new Set([
        ...(normalizedProvider.videoModels ?? []),
        APIMART_SEEDANCE_25_UPSTREAM_MODEL,
      ]));
      merged.imageModels = Array.from(new Set([
        ...(normalizedProvider.imageModels ?? []),
        APIMART_SEEDREAM_55_UPSTREAM,
        APIMART_NANO_BANANA_PRO_UPSTREAM_MODEL,
        APIMART_NANO_BANANA_21_UPSTREAM,
        "midjourney",
        ...Object.values(APIMART_GPT_IMAGE_25_UPSTREAM_MODELS),
        ...Object.values(APIMART_GPT_IMAGE_26_UPSTREAM_MODELS),
      ]));
      merged.chatModels = Array.from(new Set([
        ...(base.chatModels ?? []),
        ...(normalizedProvider.chatModels ?? []),
      ]));
    }
    if (base && normalizedProvider.id === "aicoming-haiya") {
      merged.imageModels = Array.from(new Set([
        ...(base.imageModels ?? []),
        ...(normalizedProvider.imageModels ?? []),
      ]));
      merged.videoModels = Array.from(new Set([
        ...(base.videoModels ?? []),
        ...(normalizedProvider.videoModels ?? []),
      ])).filter((modelId) => modelId !== LEGACY_AICOMING_MINIMAX_H3_UPSTREAM_MODEL);
    }
    if (base && (normalizedProvider.id === "minimax" || normalizedProvider.id === "volcengine-speech" || normalizedProvider.id === MEDIAKIT_PROVIDER)) {
      merged.videoModels = Array.from(new Set([
        ...(base.videoModels ?? []),
        ...(normalizedProvider.videoModels ?? []),
      ]));
      merged.audioModels = Array.from(new Set([
        ...(base.audioModels ?? []),
        ...(normalizedProvider.audioModels ?? []),
      ]));
    }
    if (base && normalizedProvider.id === "bigmodel") {
      merged.chatModels = Array.from(new Set([
        ...(normalizedProvider.chatModels ?? []),
        ...BIGMODEL_LLM_MODELS,
      ]));
    }
    if (base && normalizedProvider.id === "minimax") {
      merged.chatModels = Array.from(new Set([
        ...(normalizedProvider.chatModels ?? []),
        ...MINIMAX_LLM_MODELS,
      ]));
    }
    if (base && normalizedProvider.id === "volcengine") {
      merged.imageModels = Array.from(new Set([...(normalizedProvider.imageModels ?? []), VOLC_SEEDREAM_55_UPSTREAM]));
      merged.chatModels = Array.from(new Set([
        ...(normalizedProvider.chatModels ?? []),
        DOUBAO_SEED_EVOLVING_MODEL_ID,
      ]));
      merged.videoModels = Array.from(new Set([
        ...(normalizedProvider.videoModels ?? []),
        SEEDANCE_25_MODEL_ID,
      ]));
    }
    if (missingMode || validMode) delete merged.configurationError;
    byId.set(normalizedProvider.id, merged);
  }
  return sortAdminProviders(Array.from(byId.values()));
}

export async function getEffectiveProviders(client: ProviderRegistryClient = prisma): Promise<ProviderConfig[]> {
  return (await getRegisteredProviders(client)).filter(
    (p) => p.enabled !== false && p.configurationError !== "invalid-egress",
  );
}

function cleanSecret(value: unknown): string {
  return String(value ?? "").trim();
}

export function maskApiKey(value: unknown): string {
  const secret = cleanSecret(value);
  if (!secret) return "";
  return secret.length <= 8 ? "••••••" : `••••••${secret.slice(-4)}`;
}

export function mergeProviderSecretsForSave(
  nextProviders: ProviderConfig[],
  existingProviders: ProviderConfig[],
): ProviderConfig[] {
  const existingById = new Map(existingProviders.map((provider) => [provider.id, provider]));
  return nextProviders.map((provider) => {
    const existing = existingById.get(provider.id);
    const nextKey = cleanSecret(provider.apiKey);
    const merged: ProviderConfig = { ...provider };
    delete merged.clearApiKey;

    if (provider.clearApiKey) {
      delete merged.apiKey;
      return merged;
    }
    if (nextKey) {
      merged.apiKey = nextKey;
      return merged;
    }
    if (existing?.apiKey) {
      merged.apiKey = existing.apiKey;
    } else {
      delete merged.apiKey;
    }
    return merged;
  });
}

export function mergeSingleProviderForSave(
  nextProvider: ProviderConfig,
  existingProviders: ProviderConfig[],
): ProviderConfig[] {
  const [mergedProvider] = mergeProviderSecretsForSave([nextProvider], existingProviders);
  const existingIndex = existingProviders.findIndex((provider) => provider.id === mergedProvider.id);
  if (existingIndex < 0) return [...existingProviders, mergedProvider];
  return existingProviders.map((provider, index) => index === existingIndex ? mergedProvider : provider);
}

export function buildProviderOverviewItem(
  provider: ProviderConfig,
  options: { builtin: boolean },
) {
  const savedKey = cleanSecret(provider.apiKey);
  const activeKey = savedKey;
  return {
    id: provider.id,
    name: provider.name,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    envKeyName: provider.envKeyName,
    egressMode: provider.egressMode,
    allowLegacyFallback: provider.allowLegacyFallback === true,
    configurationError: provider.configurationError,
    llmProtocol: provider.llmProtocol,
    llmEndpointTemplate: provider.llmEndpointTemplate,
    imageModels: Array.isArray(provider.imageModels) ? provider.imageModels : [],
    videoModels: Array.isArray(provider.videoModels) ? provider.videoModels : [],
    audioModels: Array.isArray(provider.audioModels) ? provider.audioModels : [],
    chatModels: Array.isArray(provider.chatModels) ? provider.chatModels : [],
    modelProtocols: provider.modelProtocols && typeof provider.modelProtocols === "object"
      ? provider.modelProtocols
      : {},
    imageRequestMode: provider.imageRequestMode,
    registerUrl: provider.registerUrl,
    websiteUrl: provider.websiteUrl,
    enabled: provider.enabled !== false,
    sortOrder: Number.isFinite(provider.sortOrder) ? provider.sortOrder : 0,
    hasKey: Boolean(activeKey),
    keyPreview: maskApiKey(activeKey),
    keySource: savedKey ? "saved" : "none",
    builtin: options.builtin,
  };
}

/** admin UI 视图：全部注册供应商（含 disabled，带 hasKey 但不含 Key 明文）。 */
export async function getProvidersOverview(client: ProviderRegistryClient = prisma) {
  const providers = await getRegisteredProviders(client);
  const builtinIds = new Set(getBuiltinProviders().map((p) => p.id));
  return {
    providers: providers.map((p) =>
      buildProviderOverviewItem(p, {
        builtin: builtinIds.has(p.id),
      })
    ),
  };
}

/** 内部：把 ProviderConfig 解析为运行期对象；API Key 只读取管理员保存值。供 resolve.ts 复用。 */
export function toResolvedProvider(config: ProviderConfig): ResolvedProvider {
  const apiKey = cleanSecret(config.apiKey);
  return {
    id: config.id,
    name: config.name,
    protocol: config.protocol,
    baseUrl: config.baseUrl,
    apiKey,
    hasKey: Boolean(apiKey),
    envKeyName: config.envKeyName || "",
    egressMode: config.egressMode,
    allowLegacyFallback: config.allowLegacyFallback !== false,
    configurationError: config.configurationError,
    llmProtocol: config.llmProtocol,
    llmEndpointTemplate: config.llmEndpointTemplate,
    imageModels: config.imageModels ?? [],
    videoModels: config.videoModels ?? [],
    audioModels: config.audioModels ?? [],
    chatModels: config.chatModels ?? [],
    modelProtocols: config.modelProtocols ?? {},
    imageRequestMode: config.imageRequestMode,
  };
}
