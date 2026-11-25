import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { getProviderUpstreamModelId } from "@/lib/toolbox-models";
import { getBuiltinProviders, mergeSavedProvidersWithBuiltins } from "./registry";
import { isBuiltinProviderModel } from "./model-availability";
import type { ProviderConfig, ProviderEgressMode } from "./types";

export const PROVIDER_ADMIN_REVISION_KEYS = [
  "providers.registry",
  "providers.proxy",
  "llm_route.canvas.chat",
  "llm_route.image.role_prompt",
  "llm_route.agent.chat",
] as const;
export const SETTING_KEY_PROVIDER_REVISION = "providers.revision";
export const LEGACY_PROVIDER_REVISION = "legacy-v1";

type RevisionClient = {
  appSetting: {
    findUnique(args: { where: { key: string } }): Promise<{ value: string } | null>;
    upsert(args: {
      where: { key: string };
      create: { key: string; value: string };
      update: { value: string };
    }): Promise<unknown>;
  };
};

export async function readProviderAdminRevision(client: RevisionClient): Promise<string> {
  const row = await client.appSetting.findUnique({ where: { key: SETTING_KEY_PROVIDER_REVISION } });
  return text(row?.value) || LEGACY_PROVIDER_REVISION;
}

export async function rotateProviderAdminRevision(client: RevisionClient): Promise<string> {
  const revision = randomUUID();
  await client.appSetting.upsert({
    where: { key: SETTING_KEY_PROVIDER_REVISION },
    create: { key: SETTING_KEY_PROVIDER_REVISION, value: revision },
    update: { value: revision },
  });
  return revision;
}

export class ProviderAdminValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderAdminValidationError";
  }
}

export function computeProviderAdminRevision(
  values: Record<string, string | null | undefined>,
): string {
  const serialized = PROVIDER_ADMIN_REVISION_KEYS
    .map((key) => `${key.length}:${key}:${values[key] === undefined ? "<missing>" : JSON.stringify(values[key])}`)
    .join("|");
  return createHash("sha256").update(serialized).digest("hex");
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function modelList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value) {
    const model = text(item);
    if (!model || model.length > 256) continue;
    unique.add(model);
    if (unique.size >= 200) break;
  }
  return [...unique];
}

function providerModelList(providerId: string, value: unknown): string[] {
  return Array.from(new Set(modelList(value).map((modelId) => (
    getProviderUpstreamModelId(providerId, modelId)
  ))));
}

function egressMode(value: unknown, fallback: ProviderEgressMode): ProviderEgressMode {
  if (value === undefined) return fallback;
  if (value === "direct" || value === "proxy") return value;
  throw new ProviderAdminValidationError("平台出口只能是 direct 或 proxy");
}

function safeBaseUrl(value: unknown): string {
  const raw = text(value);
  if (!raw || raw.length > 2048 || /[\u0000-\u001f\u007f]/.test(raw)) {
    throw new ProviderAdminValidationError("Base URL 为空、过长或包含控制字符");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ProviderAdminValidationError("Base URL 格式无效");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ProviderAdminValidationError("Base URL 仅支持 HTTP/HTTPS");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ProviderAdminValidationError("Base URL 不能包含凭据、查询参数或片段");
  }
  return raw.replace(/\/+$/, "");
}

function origin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function finiteSort(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Platform homepage: empty clears it; otherwise a plain http(s) URL without credentials. */
function validateWebsiteUrl(value: unknown, id: string): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && raw.length <= 512) return url.toString();
  } catch {}
  throw new ProviderAdminValidationError(`平台 ${id || "(未命名)"} 的官网地址无效，请填写 http(s) 开头的网址`);
}

function validateName(value: unknown, id: string): string {
  const name = text(value);
  if (!name || name.length > 128) {
    throw new ProviderAdminValidationError(`平台 ${id || "(未命名)"} 的名称无效`);
  }
  return name;
}

function customIdIsValid(id: string): boolean {
  return id.length <= 64 && /^custom-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}

function sanitizeProviderAdminRows(
  input: unknown[],
  existingSaved: ProviderConfig[],
  requireCompleteCustomList: boolean,
): ProviderConfig[] {
  const builtin = new Map(getBuiltinProviders().map((provider) => [provider.id, provider]));
  const existing = new Map(existingSaved.filter(Boolean).map((provider) => [provider.id, provider]));
  const incomingIds = new Set<string>();

  if (requireCompleteCustomList) {
    for (const provider of existingSaved) {
      if (provider?.id && !builtin.has(provider.id)) incomingIds.add(provider.id);
    }
    for (const raw of input) {
      if (raw && typeof raw === "object") incomingIds.delete(text((raw as { id?: unknown }).id));
    }
    if (incomingIds.size > 0) {
      throw new ProviderAdminValidationError(`已保存的自定义平台只能停用，不能删除：${[...incomingIds].join(", ")}`);
    }
  }

  let nextCustomSort = Math.max(
    -1,
    ...mergeSavedProvidersWithBuiltins(existingSaved).map(provider => finiteSort(provider.sortOrder, -1)),
    ...existingSaved.map((provider) => finiteSort(provider?.sortOrder, -1)),
    ...input.map((raw) => raw && typeof raw === "object"
      ? finiteSort((raw as { sortOrder?: unknown }).sortOrder, -1)
      : -1),
  ) + 1;
  const result: ProviderConfig[] = [];
  const seen = new Set<string>();

  for (const rawValue of input) {
    if (!rawValue || typeof rawValue !== "object") {
      throw new ProviderAdminValidationError("平台配置必须是对象");
    }
    const raw = rawValue as Record<string, unknown>;
    const id = text(raw.id);
    if (!id || seen.has(id)) throw new ProviderAdminValidationError(`平台 ID 为空或重复：${id || "(空)"}`);
    seen.add(id);

    const builtinProvider = builtin.get(id);
    const existingProvider = existing.get(id);
    if (!builtinProvider && !existingProvider && !customIdIsValid(id)) {
      throw new ProviderAdminValidationError("新自定义平台 ID 必须匹配 custom-[a-z0-9-]，最长 64 个字符");
    }

    const mode = egressMode(raw.egressMode, builtinProvider?.egressMode ?? existingProvider?.egressMode ?? "direct");
    const apiKey = text(raw.apiKey);
    const nextBaseUrl = safeBaseUrl(raw.baseUrl ?? existingProvider?.baseUrl ?? builtinProvider?.baseUrl);
    const previousBaseUrl = text(existingProvider?.baseUrl ?? builtinProvider?.baseUrl);
    const originChanged = Boolean(previousBaseUrl && origin(previousBaseUrl) !== origin(nextBaseUrl));
    const existingSavedKey = text(existingProvider?.apiKey);
    const hadHiddenKey = Boolean(existingSavedKey);
    const disabling = raw.enabled === false;
    let clearApiKey = raw.clearApiKey === true;
    if (originChanged && hadHiddenKey && !apiKey && !clearApiKey && !disabling) {
      throw new ProviderAdminValidationError(
        `平台 ${id} 的 Base URL 已换到新域名，请重新输入 API Key 或明确清除 Key`,
      );
    }
    if (originChanged && hadHiddenKey && disabling && !apiKey) clearApiKey = true;

    if (builtinProvider) {
      const modelFields = [
        ["image", "imageModels"], ["video", "videoModels"],
        ["audio", "audioModels"], ["chat", "chatModels"],
      ] as const;
      for (const [kind, field] of modelFields) {
        if (raw[field] === undefined) continue;
        const nextModels = kind === "chat" ? modelList(raw[field]) : providerModelList(id, raw[field]);
        const previousModels = existingProvider?.[field] ?? [];
        const removedBuiltin = previousModels.find((model) => (
          isBuiltinProviderModel(id, kind, model)
          && !nextModels.includes(kind === "chat" ? model : getProviderUpstreamModelId(id, model))
        ));
        if (removedBuiltin) {
          throw new ProviderAdminValidationError(`内置模型 ${removedBuiltin} 不能移除，请在模型显示中管理可见性`);
        }
      }
      result.push({
        ...builtinProvider,
        id,
        name: validateName(raw.name ?? builtinProvider.name, id),
        protocol: builtinProvider.protocol,
        baseUrl: nextBaseUrl,
        envKeyName: builtinProvider.envKeyName || "",
        egressMode: mode,
        allowLegacyFallback: true,
        apiKey: apiKey || undefined,
        clearApiKey,
        llmProtocol: raw.llmProtocol === "openai-chat" ? "openai-chat" : undefined,
        llmEndpointTemplate: text(raw.llmEndpointTemplate) || undefined,
        imageModels: providerModelList(id, raw.imageModels ?? builtinProvider.imageModels),
        videoModels: providerModelList(id, raw.videoModels ?? builtinProvider.videoModels),
        audioModels: providerModelList(id, raw.audioModels ?? builtinProvider.audioModels),
        chatModels: modelList(raw.chatModels ?? builtinProvider.chatModels),
        modelProtocols: raw.modelProtocols && typeof raw.modelProtocols === "object"
          ? raw.modelProtocols as ProviderConfig["modelProtocols"]
          : {},
        imageRequestMode: raw.imageRequestMode === "openai" || raw.imageRequestMode === "openai-json"
          ? raw.imageRequestMode
          : undefined,
        registerUrl: builtinProvider.registerUrl,
        websiteUrl: raw.websiteUrl !== undefined
          ? validateWebsiteUrl(raw.websiteUrl, id)
          : existingProvider?.websiteUrl ?? builtinProvider.websiteUrl,
        enabled: raw.enabled !== false,
        sortOrder: finiteSort(raw.sortOrder, builtinProvider.sortOrder),
      });
      continue;
    }

    const isNew = !existingProvider;
    result.push({
      id,
      name: validateName(raw.name ?? existingProvider?.name, id),
      protocol: "openai",
      baseUrl: nextBaseUrl,
      envKeyName: "",
      egressMode: mode,
      allowLegacyFallback: false,
      apiKey: apiKey || undefined,
      clearApiKey,
      llmProtocol: "openai-chat",
      llmEndpointTemplate: "chat/completions",
      imageModels: [],
      videoModels: [],
      audioModels: [],
      chatModels: modelList(raw.chatModels ?? existingProvider?.chatModels),
      modelProtocols: {},
      websiteUrl: raw.websiteUrl !== undefined
        ? validateWebsiteUrl(raw.websiteUrl, id)
        : existingProvider?.websiteUrl,
      enabled: raw.enabled !== false,
      sortOrder: isNew ? nextCustomSort++ : finiteSort(raw.sortOrder, existingProvider.sortOrder),
    });
  }
  return result;
}

export function sanitizeProviderAdminInput(
  input: unknown[],
  existingSaved: ProviderConfig[],
): ProviderConfig[] {
  return sanitizeProviderAdminRows(input, existingSaved, true);
}

export function sanitizeSingleProviderAdminInput(
  value: unknown,
  existingSaved: ProviderConfig[],
): ProviderConfig {
  return sanitizeProviderAdminRows([value], existingSaved, false)[0];
}
