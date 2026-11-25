import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { readProxySettingRaw, resolveProviderProxyFromRaw } from "@/lib/providers/proxy-config";
import { getRegisteredProviders } from "@/lib/providers/registry";
import { createProviderEgressDecision } from "@/lib/providers/transport";
import type { ProviderConfig } from "@/lib/providers/types";
import { getLlmRouteBinding } from "./bindings";
import { callLlmForScenario, type LlmCallResult } from "./gateway";
import { attachLlmEgressDecision, resolveLlmRouteFromProviders } from "./resolver";
import { LLM_SCENARIOS } from "./scenarios";
import type {
  LlmChatMessage,
  LlmRouteResult,
  LlmRouteSnapshot,
  LlmScenarioId,
  ResolvedLlmRoute,
} from "./types";

// A valid 64x64 RGB image: Bailian rejects the former 1x1 probe because
// both dimensions must exceed 10 pixels, even on image-capable models.
const PROBE_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAoElEQVR4nO2SQQkAQRDDqqnqTmJkrYh7hIFCBSSh6cfpRSfoBNArdhfi7qITdALoFbsLcXfRCToB9Irdhbi76ASdAHrF7kLcXXSCTgC9Ynch7i46QSeAXrG7EHcXnaATQK/YXYi7i07QCaBX7C7E3UUn6ATQK3YX4u6iE3QC6BW7C3F30Qk6AfSK3YW4u+gEnQB6xe5C3F10gk4AveKfCz2B9SFanMQSPgAAAABJRU5ErkJggg==";

export class LlmAdminRequestError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "LlmAdminRequestError";
  }
}

export function isAdminLlmScenarioId(value: string): value is Exclude<LlmScenarioId, "agent.chat"> {
  return value !== "agent.chat" && Object.prototype.hasOwnProperty.call(LLM_SCENARIOS, value);
}

function snapshot(result: LlmRouteResult): LlmRouteSnapshot | { status: string } {
  if (result.status !== "ready") return { status: result.status };
  const { scenarioId, providerId, providerName, modelId, protocol, source, status } = result.route;
  return { scenarioId, providerId, providerName, modelId, protocol, source, status };
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function getLastCall(scenarioId: LlmScenarioId) {
  const row = await prisma.log.findFirst({
    where: { action: LLM_SCENARIOS[scenarioId].logAction },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      level: true,
      metadata: true,
      duration: true,
      createdAt: true,
    },
  });
  if (!row) return null;
  const metadata = parseMetadata(row.metadata);
  return {
    id: row.id,
    status: typeof metadata.status === "string" ? metadata.status : row.level,
    providerId: typeof metadata.providerId === "string" ? metadata.providerId : null,
    modelId: typeof metadata.modelId === "string" ? metadata.modelId : null,
    routeSource: typeof metadata.routeSource === "string" ? metadata.routeSource : null,
    durationMs: typeof metadata.durationMs === "number" ? metadata.durationMs : row.duration,
    createdAt: row.createdAt.toISOString(),
  };
}

function buildProxyStatuses(providers: ProviderConfig[], rawProxy: string | null) {
  return Object.fromEntries(providers
    .filter((provider) => provider.egressMode === "proxy")
    .map((provider) => [provider.id, resolveProviderProxyFromRaw(provider.id, rawProxy).status]));
}

async function loadNetworkContext(client: any = prisma) {
  const providers = await getRegisteredProviders(client);
  const rawProxy = await readProxySettingRaw(client);
  return { providers, rawProxy, proxyStatusByProviderId: buildProxyStatuses(providers, rawProxy) };
}

function buildCandidates(
  scenarioId: LlmScenarioId,
  providers: ProviderConfig[],
  proxyStatusByProviderId: Record<string, "ready" | "missing" | "invalid">,
) {
  return providers.flatMap((provider) => (provider.chatModels ?? []).map((modelId) => {
    const result = resolveLlmRouteFromProviders({
      scenarioId,
      binding: { providerId: provider.id, modelId },
      providers,
      proxyStatusByProviderId,
    });
    return {
      providerId: provider.id,
      providerName: provider.name,
      modelId,
      protocol: result.status === "ready" ? result.route.protocol : provider.llmProtocol ?? "openai-chat",
      status: result.status,
    };
  }));
}

export async function getAdminLlmRoutes() {
  const { providers, proxyStatusByProviderId } = await prisma.$transaction(
    async (client) => loadNetworkContext(client),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  const scenarioIds = Object.keys(LLM_SCENARIOS).filter(isAdminLlmScenarioId);
  const scenarios = await Promise.all(scenarioIds.map(async (scenarioId) => {
    const scenario = LLM_SCENARIOS[scenarioId];
    const [configured, lastCall] = await Promise.all([
      getLlmRouteBinding(scenarioId),
      getLastCall(scenarioId),
    ]);
    const effective = resolveLlmRouteFromProviders({
      scenarioId,
      binding: configured,
      providers,
      proxyStatusByProviderId,
    });
    return {
      id: scenario.id,
      label: scenario.label,
      allowOverride: scenario.allowOverride,
      visual: scenario.visual,
      candidates: buildCandidates(scenarioId, providers, proxyStatusByProviderId),
      configured: configured ? { providerId: configured.providerId, modelId: configured.modelId } : null,
      effective: snapshot(effective),
      lastCall,
    };
  }));
  return { scenarios };
}

function testMessages(scenarioId: LlmScenarioId): LlmChatMessage[] {
  if (scenarioId === "image.role_prompt") {
    return [{
      role: "user",
      content: [
        { type: "text", text: "Briefly confirm that you can inspect this test image." },
        { type: "image_url", image_url: { url: PROBE_PNG_DATA_URL } },
      ],
    }];
  }
  return [{ role: "user", content: "Reply with OK to confirm this route is available." }];
}

export async function testAdminLlmRoute(
  scenarioIdValue: string,
  body: unknown,
): Promise<{
  scenarioId: LlmScenarioId;
  providerId: string;
  modelId: string;
  networkRevision: string;
  result: LlmCallResult;
}> {
  const context = await prisma.$transaction(
    async (client) => loadNetworkContext(client),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  const resolvedRoute = validateAdminLlmRouteCandidate(
    scenarioIdValue,
    body,
    context.providers,
    context.proxyStatusByProviderId,
  );
  const networkRevision = computeLlmNetworkRevision(
    resolvedRoute,
    context.providers,
    context.rawProxy,
  );
  const executableRoute = attachLlmEgressDecision(
    resolvedRoute,
    context.providers,
    context.rawProxy,
  );
  const result = await callLlmForScenario(executableRoute, testMessages(executableRoute.scenarioId), {
    logAction: "llm_route_probe",
  });
  return {
    scenarioId: resolvedRoute.scenarioId,
    providerId: resolvedRoute.providerId,
    modelId: resolvedRoute.modelId,
    networkRevision,
    result,
  };
}

export function validateAdminLlmRouteCandidate(
  scenarioIdValue: string,
  body: unknown,
  providers: ProviderConfig[],
  proxyStatusByProviderId: Record<string, "ready" | "missing" | "invalid"> = {},
): ResolvedLlmRoute {
  if (!isAdminLlmScenarioId(scenarioIdValue)) {
    throw new LlmAdminRequestError("未知 LLM 场景");
  }
  const providerId = String((body as any)?.providerId ?? "").trim();
  const modelId = String((body as any)?.modelId ?? "").trim();
  if (!providerId || !modelId) {
    throw new LlmAdminRequestError("providerId 和 modelId 为必填项");
  }
  const provider = providers.find((item) => item.id === providerId);
  if (!provider) throw new LlmAdminRequestError("平台不存在");
  if (!(provider.chatModels ?? []).includes(modelId)) {
    throw new LlmAdminRequestError("模型不在平台 chatModels 中");
  }
  const resolved = resolveLlmRouteFromProviders({
    scenarioId: scenarioIdValue,
    binding: { providerId, modelId },
    providers,
    proxyStatusByProviderId,
  });
  if (resolved.status !== "ready") {
    throw new LlmAdminRequestError(`路由不可用：${resolved.status}`, 400, resolved.status);
  }
  return resolved.route;
}

export function computeLlmNetworkRevision(
  route: ResolvedLlmRoute,
  providers: ProviderConfig[],
  rawProxy: string | null,
): string {
  const provider = providers.find((item) => item.id === route.providerId);
  if (!provider) throw new LlmAdminRequestError("平台不存在", 400, "missing-binding");
  const proxy = provider.egressMode === "proxy"
    ? resolveProviderProxyFromRaw(provider.id, rawProxy)
    : undefined;
  const decision = createProviderEgressDecision(provider, proxy);
  const value = JSON.stringify({
    providerId: route.providerId,
    modelId: route.modelId,
    protocol: route.protocol,
    url: route.url,
    apiKey: route.apiKey,
    timeoutMs: route.timeoutMs,
    enabled: provider.enabled !== false,
    baseUrl: provider.baseUrl,
    egressMode: provider.egressMode,
    decisionMode: decision.mode,
    networkKey: decision.cacheKey,
  });
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export async function resolveAdminLlmNetworkRevision(
  scenarioIdValue: string,
  body: unknown,
  client: any,
): Promise<{ route: ResolvedLlmRoute; networkRevision: string }> {
  const context = await loadNetworkContext(client);
  const route = validateAdminLlmRouteCandidate(
    scenarioIdValue,
    body,
    context.providers,
    context.proxyStatusByProviderId,
  );
  return {
    route,
    networkRevision: computeLlmNetworkRevision(route, context.providers, context.rawProxy),
  };
}
