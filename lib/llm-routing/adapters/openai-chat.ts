import { resolveLlmEndpoint } from "../endpoint";
import { buildLlmThinkingParams } from "../reasoning";
import { reapiLlmUsesJsonResponseFormat } from "@/lib/reapi-llm-models";
import { isMiniMaxLlmModel } from "@/lib/minimax-llm-models";
import { isBigModelGlm53 } from "@/lib/bigmodel-llm-models";
import type { LlmProtocolAdapter } from "./types";
import type { ResolvedLlmRoute, LlmChatMessage, LlmOutputLimit } from "../types";
import type { LlmThinkingInput } from "../reasoning";

function unwrap(payload: unknown) {
  if (payload && typeof payload === "object" && "code" in payload && "data" in payload) {
    const wrapper = payload as { code?: unknown; data?: unknown };
    if (![0, 200, "0", "200"].includes(wrapper.code as never)) {
      return { ok: false as const };
    }
    return { ok: true as const, payload: wrapper.data };
  }
  return { ok: true as const, payload };
}

function extractText(payload: unknown): string | null {
  const content = (payload as any)?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  return content
    .map((part) => typeof part === "string" ? part : typeof part?.text === "string" ? part.text : "")
    .join("");
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function errorDetails(payload: unknown) {
  const root = record(payload) || {};
  const data = record(root.data);
  const nested = record(data?.error) || data;
  const error = record(root.error) || nested || root;
  const firstText = (...values: unknown[]) => {
    const value = values.find((item) => typeof item === "string" && item.trim());
    return typeof value === "string" ? value : "";
  };
  return {
    code: firstText(error.code, root.code),
    type: firstText(error.type, root.type),
    param: firstText(error.param, root.param),
    message: firstText(error.message, data?.message, root.message),
  };
}

const REQUEST_SHAPE_MARKER = /(?:^|[_\s.\[\]-])(?:format|schema|payload|mime(?:_type)?|image_url|base64|encoding|encoded|data_url|content_type)(?:$|[_\s.\[\]-])/i;

function isUnsupportedImage(payload: unknown, status: number): boolean {
  if (status !== 200 && status !== 400 && status !== 422) return false;
  const details = errorDetails(payload);
  const structured = `${details.code} ${details.type} ${details.param}`.trim().toLowerCase();
  if (REQUEST_SHAPE_MARKER.test(structured)) return false;

  const structuredMentionsImage = /\b(?:image|vision)\b/i.test(structured.replaceAll("_", " "));
  const structuredCapability = (
    /(?:unsupported_(?:image|vision)|(?:image|vision)_not_supported|does_not_support_(?:image|vision))/i.test(structured)
    || (/unsupported[_\s-]+modality/i.test(structured) && structuredMentionsImage)
    || (/model[_\s-]*capability/i.test(structured) && structuredMentionsImage)
  );
  if (structuredCapability) return true;

  const message = details.message.toLowerCase();
  if (REQUEST_SHAPE_MARKER.test(message)) return false;
  return (
    /\b(?:this\s+|the\s+|selected\s+)?model\b.{0,80}\b(?:does\s+not|doesn't|cannot|can't)\s+(?:support|accept|process)\w*\b.{0,40}\b(?:image|vision)(?:\s+input)?s?\b/i.test(message)
    || /\b(?:image|vision)(?:\s+input)?s?\b.{0,50}\b(?:is|are)\s+(?:not\s+supported|unsupported)\b.{0,30}\b(?:by|for)\s+(?:this\s+|the\s+|selected\s+)?model\b/i.test(message)
    || /\b(?:this\s+|the\s+|selected\s+)?model\b.{0,50}\b(?:is\s+not|isn't)\s+(?:image|vision)[-\s]?capable\b/i.test(message)
  );
}

function classifyOpenAiChatFailure(payload: unknown, status: number) {
  const message = errorDetails(payload).message;
  if (/unable to download content from the provided url before the timeout/i.test(message)) {
    return { kind: "media-download" as const, message, status };
  }
  if (isUnsupportedImage(payload, status)) {
    return { kind: "unsupported-image" as const, message: "The selected model does not support image input", status };
  }
  return { kind: "upstream" as const, message: message || `LLM upstream returned ${status}`, status };
}

export function buildOpenAiChatBody(route: Pick<ResolvedLlmRoute, "providerId" | "modelId" | "protocol" | "scenarioId">, messages: LlmChatMessage[], outputLimit?: LlmOutputLimit, stream = false, thinkingLevel?: LlmThinkingInput) {
  const minimax = isMiniMaxLlmModel(route.providerId, route.modelId);
  const bigmodel = isBigModelGlm53(route.providerId, route.modelId);
  const responseFormat = route.providerId === "reapi"
    && route.scenarioId === "agent.chat"
    && reapiLlmUsesJsonResponseFormat(route.modelId)
    ? { response_format: { type: "json_object" } }
    : {};
  return { model: route.modelId, messages, stream, ...buildLlmThinkingParams(route, thinkingLevel), ...(minimax ? { reasoning_split: true } : {}), ...(route.scenarioId === "canvas.chat" && /^qwen.*omni/i.test(route.modelId) ? { modalities: ["text"] } : {}), ...(stream ? bigmodel ? { tool_stream: true } : { stream_options: { include_usage: true } } : {}), ...responseFormat, ...(outputLimit ? { [minimax ? "max_completion_tokens" : bigmodel ? "max_tokens" : outputLimit.parameter]: outputLimit.tokens } : {}) };
}

export const openAiChatAdapter: LlmProtocolAdapter = {
  protocol: "openai-chat",
  resolveEndpoint(provider, modelId) {
    if (!isMiniMaxLlmModel(provider.id, modelId)) return resolveLlmEndpoint(provider, modelId);
    // Use the saved host/path/key, including configs saved for the Anthropic endpoint.
    const baseUrl = provider.baseUrl.replace(/\/+$/, "").replace(/\/(?:anthropic(?:\/v1)?|v1)$/, "");
    return resolveLlmEndpoint({ ...provider, baseUrl, llmProtocol: "openai-chat", llmEndpointTemplate: "v1/chat/completions" }, modelId);
  },
  buildRequest(route, messages, outputLimit, stream = false, thinkingLevel) {
    return { url: route.url, init: { method: "POST", headers: { Authorization: `Bearer ${route.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(buildOpenAiChatBody(route, messages, outputLimit, stream, thinkingLevel)) } };
  },
  readUsage(payload) {
    const raw = unwrap(payload);
    const usage = raw.ok ? (raw.payload as any)?.usage : null;
    if (!usage || typeof usage !== "object") return null;
    const token = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
    return { inputTokens: token(usage.prompt_tokens), outputTokens: token(usage.completion_tokens), totalTokens: token(usage.total_tokens),
      ...(token(usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens) !== null ? { cachedInputTokens: token(usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens)! } : {}),
      ...(token(usage.completion_tokens_details?.reasoning_tokens) !== null ? { reasoningOutputTokens: token(usage.completion_tokens_details.reasoning_tokens)! } : {}) };
  },
  parseSuccess(payload, status) {
    const unwrapped = unwrap(payload);
    if (!unwrapped.ok) {
      return { ok: false, failure: classifyOpenAiChatFailure(payload, status) };
    }
    const text = extractText(unwrapped.payload);
    if (text === null) {
      return {
        ok: false,
        failure: { kind: "invalid-response", message: "LLM response has no assistant content", status },
      };
    }
    return { ok: true, text };
  },
  classifyFailure(payload, status) {
    return classifyOpenAiChatFailure(payload, status);
  },
};
