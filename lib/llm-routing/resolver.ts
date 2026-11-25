import "server-only";
import { isMiniMaxLlmModel } from "@/lib/minimax-llm-models";

import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getRegisteredProviders, toResolvedProvider } from "@/lib/providers/registry";
import { readProxySettingRaw, resolveProviderProxyFromRaw } from "@/lib/providers/proxy-config";
import { createProviderEgressDecision } from "@/lib/providers/transport";
import type { ProviderConfig } from "@/lib/providers/types";
import {
  reapiLlmModelSupportsScenario,
} from "@/lib/reapi-llm-models";
import { getLlmProtocolAdapter } from "./adapters/registry";
import { getLlmRouteBinding } from "./bindings";
import { getLlmScenario } from "./scenarios";
import type {
  LlmRouteBinding,
  LlmRouteResult,
  LlmRouteSource,
  LlmScenarioId,
  ResolvedLlmRoute,
} from "./types";

type ResolveInput = {
  scenarioId: LlmScenarioId;
  binding: LlmRouteBinding | null;
  providers: ProviderConfig[];
  override?: LlmRouteBinding | null;
  proxyStatusByProviderId?: Record<string, "ready" | "missing" | "invalid">;
};

function evaluateBinding(
  scenarioId: LlmScenarioId,
  binding: LlmRouteBinding,
  providers: ProviderConfig[],
  source: LlmRouteSource,
  proxyStatusByProviderId?: ResolveInput["proxyStatusByProviderId"],
): LlmRouteResult {
  const configured = providers.find((item) => item.id === binding.providerId);
  if (!configured) return { status: "missing-binding" };
  if (configured.enabled === false) return { status: "provider-disabled" };
  if (configured.configurationError === "invalid-egress") return { status: "invalid-proxy" };
  if (configured.egressMode === "proxy") {
    const proxyStatus = proxyStatusByProviderId?.[configured.id];
    if (proxyStatus === "invalid") return { status: "invalid-proxy" };
    if (proxyStatus !== "ready") return { status: "missing-proxy" };
  }
  const provider = toResolvedProvider(configured);
  if (!provider.chatModels.includes(binding.modelId)) return { status: "model-disabled" };
  if (
    provider.id === "reapi"
    && !reapiLlmModelSupportsScenario(binding.modelId, scenarioId)
  ) return { status: "unsupported-capability" };
  if (!provider.apiKey) return { status: "missing-key" };
  // The Agent streams native tool calls through MiniMax's OpenAI-compatible API.
  const protocol = isMiniMaxLlmModel(provider.id, binding.modelId)
    ? scenarioId === "agent.chat" ? "openai-chat" : "anthropic-messages"
    : provider.llmProtocol ?? "openai-chat";
  const adapter = getLlmProtocolAdapter(protocol);
  if (!adapter) return { status: "unsupported-protocol" };
  const endpoint = adapter.resolveEndpoint(provider, binding.modelId);
  if (!endpoint.ok) return { status: endpoint.reason };
  const scenario = getLlmScenario(scenarioId);
  return {
    status: "ready",
    route: {
      scenarioId,
      providerId: provider.id,
      providerName: provider.name,
      modelId: binding.modelId,
      protocol: adapter.protocol,
      source,
      status: "ready",
      url: endpoint.url,
      apiKey: provider.apiKey,
      timeoutMs: scenario.timeoutMs,
    },
  };
}

function resolveDefault(input: ResolveInput): LlmRouteResult {
  if (!input.binding) return { status: "missing-binding" };
  return evaluateBinding(
    input.scenarioId,
    input.binding,
    input.providers,
    "configured",
    input.proxyStatusByProviderId,
  );
}

export function resolveLlmRouteFromProviders(input: ResolveInput): LlmRouteResult {
  const scenario = getLlmScenario(input.scenarioId);
  if (scenario.allowOverride && input.override) {
    return evaluateBinding(
      input.scenarioId,
      input.override,
      input.providers,
      "node-override",
      input.proxyStatusByProviderId,
    );
  }
  return resolveDefault(input);
}

export function attachLlmEgressDecision(
  route: ResolvedLlmRoute,
  providers: ProviderConfig[],
  rawProxy: string | null,
): ResolvedLlmRoute {
  const provider = providers.find((item) => item.id === route.providerId);
  if (!provider || provider.enabled === false) {
    throw new Error("LLM provider is missing or disabled");
  }
  const proxy = provider.egressMode === "proxy"
    ? resolveProviderProxyFromRaw(provider.id, rawProxy)
    : undefined;
  const decision = Object.freeze(createProviderEgressDecision(provider, proxy));
  return Object.freeze({ ...route, egressDecision: decision });
}

export async function resolveLlmRoute(
  scenarioId: LlmScenarioId,
  override?: LlmRouteBinding | null,
): Promise<LlmRouteResult> {
  return prisma.$transaction(async (client) => {
    const [binding, providers] = await Promise.all([
      getLlmRouteBinding(scenarioId, client),
      getRegisteredProviders(client),
    ]);
    const rawProxy = providers.some((provider) => provider.egressMode === "proxy")
      ? await readProxySettingRaw(client)
      : null;
    const proxyStatusByProviderId = Object.fromEntries(providers
      .filter((provider) => provider.egressMode === "proxy")
      .map((provider) => [provider.id, resolveProviderProxyFromRaw(provider.id, rawProxy).status]));
    const result = resolveLlmRouteFromProviders({
      scenarioId,
      binding,
      providers,
      override,
      proxyStatusByProviderId,
    });
    return result.status === "ready"
      ? { ...result, route: attachLlmEgressDecision(result.route, providers, rawProxy) }
      : result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
