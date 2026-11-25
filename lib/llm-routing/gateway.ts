import { Logger } from "@/lib/logger";
import { beginLlmCost, finishLlmCost } from "@/lib/billing/llm";
import { fetchWithProviderEgress, ProviderNetworkError } from "@/lib/providers/transport";
import { getLlmProtocolAdapter } from "./adapters/registry";
import { getLlmScenario } from "./scenarios";
import { readChatStream, ChatStreamError, type LlmDelta } from './adapters/chat-stream';
import type { LlmChatMessage, LlmRouteSnapshot, ResolvedLlmRoute, LlmUsage, LlmOutputLimit } from "./types";

export type LlmGatewayErrorKind = "upstream" | "timeout" | "network" | "invalid-response" | "unsupported-image" | "media-download";

export class LlmGatewayError extends Error {
  usage?: LlmUsage | null;
  dispatched = false;
  rejected = false;
  constructor(
    public readonly kind: LlmGatewayErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "LlmGatewayError";
  }
}

export function getPublicLlmError(error: unknown): string {
  if (!(error instanceof LlmGatewayError)) return "LLM 调用失败，请稍后重试";
  if (error.kind === "unsupported-image") return "该模型不支持图片输入，请在 API 配置中更换模型。";
  if (error.kind === "media-download") return "LLM 无法及时读取参考图，请重新上传后重试";
  if (error.kind === "timeout") return "LLM 请求超时，请稍后重试";
  if (error.kind === "network") return "LLM 网络连接失败，请稍后重试";
  if (error.kind === "invalid-response") return "LLM 返回内容无效，请稍后重试";
  if (error.status === 403 && /额度不足|余额不足|insufficient\s+(?:quota|balance|credits?)|quota\s+(?:exceeded|exhausted)|billing/i.test(error.message)) {
    return "LLM 服务额度不足，请充值或选择其他平台模型。";
  }
  if (error.status === 401) return "LLM 服务认证失败，请联系管理员检查配置";
  if (error.status === 403) return "LLM 服务拒绝请求，请检查模型权限或选择其他平台模型。";
  if (error.status === 429) return "LLM 服务繁忙，请稍后重试";
  if (typeof error.status === "number" && error.status >= 500) return "LLM 上游服务暂时不可用，请稍后重试";
  return "LLM 上游请求失败，请稍后重试";
}

function redact(value: unknown, apiKey: string): string {
  const text = String(value ?? "LLM request failed");
  return apiKey ? text.split(apiKey).join("[redacted]") : text;
}

function errorStatus(kind: LlmGatewayErrorKind): string {
  return `${kind}-error`;
}

export type LlmCallResult = {
  text: string;
  route: LlmRouteSnapshot;
  durationMs: number;
  usage?: LlmUsage | null;
};

export type LlmCallOptions = {
  /** Final caller-owned eligibility check, including a fresh atomic route. */
  beforeDispatch?: () => Promise<ResolvedLlmRoute>;
  /** Last async fence after request construction; no network has started. */
  beforeTransport?: () => Promise<void>;
  onTransportStart?: () => void;
  requestKey?: string;
  onResponseHeaders?: () => void;
  onResponseBody?: () => void;
  thinkingLevel?: import("./reasoning").LlmThinkingInput;
  billingIdentity?: { userId?: string; authUserId?: number };
  logAction?: string;
  outputLimit?: LlmOutputLimit;
  onDelta?: (delta: LlmDelta) => Promise<void>;
  /** Caller cancellation, e.g. the user stopping a long canvas job; combined with the route timeout. */
  signal?: AbortSignal;
};

function toRouteSnapshot(route: ResolvedLlmRoute): LlmRouteSnapshot {
  return {
    scenarioId: route.scenarioId,
    providerId: route.providerId,
    providerName: route.providerName,
    modelId: route.modelId,
    protocol: route.protocol,
    source: route.source,
    status: route.status,
  };
}

export async function callLlmForScenario(
  route: ResolvedLlmRoute,
  messages: LlmChatMessage[],
  options: LlmCallOptions = {},
): Promise<LlmCallResult> {
  const startedAt = Date.now();
  const billingCall = await beginLlmCost({ provider: route.providerId, model: route.modelId, source: route.scenarioId, ...options.billingIdentity, ...(options.requestKey ? { requestKey: options.requestKey } : {}) });
  let callStatus = "success";
  let dispatched = false, rejected = false;
  let usage: LlmUsage | null | undefined;
  try {
    const adapter = getLlmProtocolAdapter(route.protocol);
    if (!adapter) throw new LlmGatewayError("invalid-response", "Unsupported LLM protocol");
    let response: Response;
    try {
      if (options.beforeDispatch) route = await options.beforeDispatch();
      if (!route.egressDecision || route.egressDecision.providerId !== route.providerId) {
        throw new ProviderNetworkError(
          "invalid-egress",
          "LLM route is missing its atomic network snapshot",
        );
      }
      const stream = route.protocol === 'openai-chat' && ((route.scenarioId === 'agent.chat' && Boolean(options.onDelta)) || (route.scenarioId === "canvas.chat" && /^qwen.*omni/i.test(route.modelId)));
      const request = adapter.buildRequest(route, messages, options.outputLimit, stream, options.thinkingLevel);
      await options.beforeTransport?.();
      options.onTransportStart?.();
      dispatched = true;
      response = await fetchWithProviderEgress(route.egressDecision, request.url, {
        ...request.init,
        signal: options.signal ? AbortSignal.any([AbortSignal.timeout(route.timeoutMs), options.signal]) : AbortSignal.timeout(route.timeoutMs),
      } as Parameters<typeof fetchWithProviderEgress>[2]);
      rejected = response.status >= 400 && response.status < 500 && response.status !== 408;
      options.onResponseHeaders?.();
    } catch (error: any) {
      const timedOut = error?.name === "AbortError" || error?.name === "TimeoutError" || /timeout|timed out|超时/i.test(String(error?.message));
      throw new LlmGatewayError(timedOut ? "timeout" : "network", redact(error?.message, route.apiKey));
    }

    let json: any;
    try {
      if (response.ok && route.protocol === 'openai-chat' && response.headers.get('content-type')?.includes('text/event-stream')) {
        json = await readChatStream(response, options.onDelta || (async () => {}));
      } else {
        json = JSON.parse(await response.text());
      }
    } catch (error) {
      if (error instanceof ChatStreamError) usage = adapter.readUsage?.({ usage: error.usagePayload });
      if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw new LlmGatewayError('timeout', 'LLM response timed out', response.status);
      throw new LlmGatewayError("invalid-response", "LLM response is not valid JSON", response.status);
    }
    options.onResponseBody?.();
    usage = adapter.readUsage?.(json);
    if (!response.ok) {
      const failure = adapter.classifyFailure(json, response.status);
      throw new LlmGatewayError(failure.kind, redact(failure.message, route.apiKey), failure.status);
    }
    const result = adapter.parseSuccess(json, response.status);
    if (!result.ok) {
      throw new LlmGatewayError(
        result.failure.kind,
        redact(result.failure.message, route.apiKey),
        result.failure.status,
      );
    }
    return { text: result.text, route: toRouteSnapshot(route), durationMs: Date.now() - startedAt, ...(usage ? { usage } : {}) };
  } catch (error) {
    const classified = error instanceof LlmGatewayError
      ? error
      : new LlmGatewayError("network", redact((error as any)?.message, route.apiKey));
    callStatus = errorStatus(classified.kind);
    classified.usage = usage; classified.dispatched = dispatched; classified.rejected = rejected;
    throw classified;
  } finally {
    // The pending row is durable before dispatch. A failed settlement remains visible for reconciliation.
    await finishLlmCost(billingCall, usage, callStatus === "success").catch(error => {
      console.error("[billing] LLM settlement pending", { ledgerId: billingCall.id, error });
    });
    const scenario = getLlmScenario(route.scenarioId);
    Logger.log({
      category: "api",
      action: options.logAction ?? scenario.logAction,
      level: callStatus === "success" ? "success" : "error",
      message: callStatus === "success" ? "LLM call succeeded" : "LLM call failed",
      metadata: {
        scenarioId: route.scenarioId,
        providerId: route.providerId,
        modelId: route.modelId,
        routeSource: route.source,
        status: callStatus,
        durationMs: Date.now() - startedAt,
      },
      duration: Date.now() - startedAt,
    });
  }
}

export async function callOpenAiChatCompletion(
  route: ResolvedLlmRoute,
  messages: LlmChatMessage[],
): Promise<string> {
  return (await callLlmForScenario(route, messages)).text;
}
