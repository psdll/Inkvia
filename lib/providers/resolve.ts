// resolveProvider —— 运行期取「某平台 / 某模型」的生效配置。
// API Key 只使用管理员 API 配置页保存的服务端凭据，不读取本地环境变量。

import "server-only";

import { getEffectiveProviders, toResolvedProvider } from "./registry";
import type { ProviderProtocol, ResolvedProvider } from "./types";

/** 按平台 id 解析。 */
export async function resolveProvider(id: string): Promise<ResolvedProvider | null> {
  const providers = await getEffectiveProviders();
  const found = providers.find((p) => p.id === id);
  return found ? toResolvedProvider(found) : null;
}

export function resolvedProviderApiKey(
  provider: ResolvedProvider | null,
): string {
  if (!provider) throw new Error("API Key 未配置，请在管理员 API 配置中保存");
  const apiKey = String(provider.apiKey || "").trim();
  if (!apiKey) throw new Error(`${provider.name} API Key 未配置，请在管理员 API 配置中保存`);
  return apiKey;
}

/** 按模型 id 反查它所属平台并解析。 */
export async function resolveProviderByModel(modelId: string): Promise<ResolvedProvider | null> {
  const providers = await getEffectiveProviders();
  const owner = providers.find(
    (p) =>
      p.imageModels?.includes(modelId) ||
      p.videoModels?.includes(modelId) ||
      p.audioModels?.includes(modelId) ||
      p.chatModels?.includes(modelId),
  );
  return owner ? toResolvedProvider(owner) : null;
}

/** 取某模型实际使用的协议：逐模型覆盖 > 平台全局协议。 */
export function resolveModelProtocol(provider: ResolvedProvider, modelId: string): ProviderProtocol {
  return provider.modelProtocols?.[modelId] ?? provider.protocol;
}
