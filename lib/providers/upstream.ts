import "server-only";
import { isMiniMaxLlmModel } from "@/lib/minimax-llm-models";
import { resolveBailianLlmBaseUrl } from "@/lib/bailian-llm-models";

import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  buildProxyOverrideCandidate,
  readProxySettingRaw,
  resolveProviderProxyFromRaw,
  type ProxyOverrideAction,
} from "./proxy-config";
import { getRegisteredProviders, toResolvedProvider } from "./registry";
import {
  ProviderNetworkError,
  createProviderEgressDecision,
  fetchWithProviderEgress,
  type ProviderEgressDecision,
} from "./transport";
import type { ProviderEgressMode, ResolvedProvider } from "./types";

const REQUEST_TIMEOUT_MS = 15_000;

export type UpstreamTarget = {
  id?: string;
  baseUrl?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  egressMode?: ProviderEgressMode;
  proxyAction?: ProxyOverrideAction;
};

export type ResolvedDraftTarget = {
  provider: ResolvedProvider;
  decision: ProviderEgressDecision;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function validateBaseUrl(value: string): string {
  if (!value || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ProviderNetworkError("invalid-target", "Base URL 无效");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ProviderNetworkError("invalid-target", "Base URL 无效");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new ProviderNetworkError("invalid-target", "Base URL 无效");
  }
  return value.replace(/\/+$/, "");
}

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

export async function resolveDraftTarget(target: UpstreamTarget): Promise<ResolvedDraftTarget | null> {
  return prisma.$transaction(async (client) => {
  const id = clean(target.id);
  if (!id) return null;
  const registered = await getRegisteredProviders(client);
  const saved = registered.find((provider) => provider.id === id);
  if (!saved && !/^custom-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return null;

  const baseUrl = validateBaseUrl(clean(target.baseUrl) || clean(saved?.baseUrl));
  const modeValue = target.egressMode === undefined
    ? saved?.egressMode ?? "direct"
    : target.egressMode;
  if (modeValue !== "direct" && modeValue !== "proxy") {
    throw new ProviderNetworkError("invalid-egress", "平台出口配置无效");
  }
  const resolved = saved
    ? toResolvedProvider({ ...saved, baseUrl, egressMode: modeValue })
    : toResolvedProvider({
        id,
        name: id,
        protocol: "openai",
        baseUrl,
        egressMode: modeValue,
        allowLegacyFallback: false,
        llmProtocol: "openai-chat",
        llmEndpointTemplate: "chat/completions",
        imageModels: [],
        videoModels: [],
        chatModels: [],
        modelProtocols: {},
        enabled: true,
        sortOrder: 0,
      });
  const draftKey = clean(target.apiKey);
  const changedOrigin = Boolean(saved?.baseUrl && !sameOrigin(baseUrl, saved.baseUrl));
  const inheritedKey = changedOrigin ? "" : resolved.apiKey;
  const apiKey = target.clearApiKey === true ? "" : draftKey || inheritedKey;
  const provider: ResolvedProvider = { ...resolved, apiKey, hasKey: Boolean(apiKey) };
  delete provider.envKeyName;

  const currentProxyRaw = modeValue === "proxy" ? await readProxySettingRaw(client) : null;
  const candidateProxyRaw = modeValue === "proxy"
    ? buildProxyOverrideCandidate(currentProxyRaw, target.proxyAction ?? { action: "keep" })
    : null;
  const proxy = modeValue === "proxy"
    ? resolveProviderProxyFromRaw(id, candidateProxyRaw)
    : undefined;
  return { provider, decision: createProviderEgressDecision(provider, proxy) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Compatibility helper for existing server-side callers. */
export async function resolveTarget(target: UpstreamTarget): Promise<ResolvedProvider | null> {
  return (await resolveDraftTarget(target))?.provider ?? null;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export type ListModelsResult = {
  ok: boolean;
  status: number;
  message: string;
  wrapped: boolean;
  models: string[];
};

export function safeNetworkMessage(error: unknown): string {
  if (error instanceof ProviderNetworkError) {
    if (error.kind === "proxy-connect" && /407/.test(error.message)) return "代理认证失败（407）";
    if (error.kind === "missing-proxy") return "缺少代理配置";
    if (error.kind === "invalid-proxy" || error.kind === "invalid-egress") return "代理或出口配置无效";
    if (error.kind === "invalid-target") return "Base URL 无效";
  }
  const candidate = error as { name?: string; message?: string; code?: string; cause?: { code?: string } };
  const code = candidate?.code || candidate?.cause?.code || "";
  const message = String(candidate?.message || "");
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) return "TLS 连接失败";
  if (candidate?.name === "AbortError" || candidate?.name === "TimeoutError" || /timeout|timed out/i.test(message)) {
    return "线路测试超时";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DNS 解析失败";
  if (code === "ECONNREFUSED") return "连接被拒绝";
  if (/407/.test(message)) return "代理认证失败（407）";
  if (/certificate|tls|ssl/i.test(message)) return "TLS 连接失败";
  return "线路不可达";
}

export async function testProviderLine(target: ResolvedDraftTarget): Promise<{
  ok: boolean;
  status: number;
  message: string;
}> {
  try {
    const response = await fetchWithProviderEgress(target.decision, target.provider.baseUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => undefined);
    return { ok: true, status: response.status, message: `线路可达（HTTP ${response.status}）` };
  } catch (error) {
    return { ok: false, status: 0, message: safeNetworkMessage(error) };
  }
}

export async function listUpstreamModels(target: ResolvedDraftTarget): Promise<ListModelsResult> {
  const { provider, decision } = target;
  if (!provider.apiKey) {
    return { ok: false, status: 0, message: "未配置 API Key", wrapped: false, models: [] };
  }
  try {
    const modelListPath = provider.id === "minimax" ? "v1/models" : "models";
    const baseUrl = provider.id === "bailian" ? resolveBailianLlmBaseUrl(provider.baseUrl) : provider.baseUrl;
    const response = await fetchWithProviderEgress(decision, joinUrl(baseUrl, modelListPath), {
      method: "GET",
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const responseText = await response.text();
    let json: any = null;
    try {
      json = JSON.parse(responseText);
    } catch {
      // Non-JSON upstream response.
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: `上游返回 HTTP ${response.status}`,
        wrapped: false,
        models: [],
      };
    }
    const wrapped = Boolean(json && typeof json === "object" && "code" in json && "data" in json);
    const payload = wrapped ? json.data : json;
    const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    const models = list
      .map((model: any) => typeof model === "string" ? model : model?.id)
      .filter((model: unknown): model is string => typeof model === "string" && Boolean(model));
    return { ok: true, status: response.status, message: "成功", wrapped, models };
  } catch (error) {
    return { ok: false, status: 0, message: safeNetworkMessage(error), wrapped: false, models: [] };
  }
}

const VIDEO_HINTS = ["video", "veo", "kling", "sora", "seedance", "wan", "minimax", "hailuo", "ltx", "runway", "pika"];
const IMAGE_HINTS = ["image", "flux", "stable-diffusion", "nano-banana", "seedream", "gpt-image", "dall", "midjourney", "imagen", "qwen-image", "ideogram", "recraft", "sdxl"];

export function categorizeModels(
  models: string[],
  providerId?: string,
): { image: string[]; video: string[]; chat: string[] } {
  if (providerId === "deepseek") return { image: [], video: [], chat: [...models] };
  const image: string[] = [];
  const video: string[] = [];
  const chat: string[] = [];
  for (const id of models) {
    const lower = id.toLowerCase();
    if (isMiniMaxLlmModel(providerId ?? "", id)) chat.push(id);
    else if (VIDEO_HINTS.some((hint) => lower.includes(hint))) video.push(id);
    else if (IMAGE_HINTS.some((hint) => lower.includes(hint))) image.push(id);
    else chat.push(id);
  }
  return { image, video, chat };
}
