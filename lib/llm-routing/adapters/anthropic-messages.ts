import { resolveLlmEndpoint } from "../endpoint";
import { buildLlmThinkingParams } from "../reasoning";
import type { LlmProtocolAdapter } from "./types";

function content(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((block) => {
    if (block?.type === "video_url") return { type: "video", source: { type: "url", url: block.video_url?.url } };
    if (block?.type !== "image_url") return block;
    const url = block.image_url?.url;
    if (typeof url !== "string") throw new Error("Invalid image URL");
    const data = /^data:(image\/(?:jpeg|png|gif|webp));base64,([\s\S]+)$/.exec(url);
    return {
      type: "image",
      source: data
        ? { type: "base64", media_type: data[1], data: data[2] }
        : { type: "url", url },
    };
  });
}

// MiniMax: https://platform.minimax.cn/docs/api-reference/text-anthropic-api
export const anthropicMessagesAdapter: LlmProtocolAdapter = {
  protocol: "anthropic-messages",
  resolveEndpoint(provider, modelId) {
    // Keep the saved host/path and credentials shared with MiniMax video/audio.
    const baseUrl = provider.baseUrl.replace(/\/+$/, "").replace(/\/(?:anthropic(?:\/v1)?|v1)$/, "");
    return resolveLlmEndpoint({ ...provider, baseUrl, llmProtocol: "openai-chat", llmEndpointTemplate: "anthropic/v1/messages" }, modelId);
  },
  buildRequest(route, messages, outputLimit, _stream, thinkingLevel) {
    const system = messages.filter((message) => message.role === "system")
      .flatMap((message) => typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : Array.isArray(message.content) ? message.content : []);
    return {
      url: route.url,
      init: {
        method: "POST",
        headers: { Authorization: `Bearer ${route.apiKey}`, "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: route.modelId,
          ...buildLlmThinkingParams(route, thinkingLevel),
          max_tokens: outputLimit?.tokens ?? 8192,
          stream: false,
          ...(system.length ? { system } : {}),
          messages: messages.filter((message) => message.role !== "system")
            .map((message) => ({ role: message.role, content: content(message.content) })),
        }),
      },
    };
  },
  readUsage(payload) {
    const usage = (payload as any)?.usage;
    if (!usage || typeof usage !== "object") return null;
    const token = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
    const input = token(usage.input_tokens);
    const output = token(usage.output_tokens);
    const cached = token(usage.cache_read_input_tokens);
    const created = token(usage.cache_creation_input_tokens);
    const inputTokens = input === null ? null : input + (cached ?? 0) + (created ?? 0);
    return { inputTokens, outputTokens: output,
      totalTokens: inputTokens !== null && output !== null ? inputTokens + output : null,
      ...(cached !== null ? { cachedInputTokens: cached } : {}),
      ...(created !== null ? { cacheCreationInputTokens: created } : {}) };
  },
  parseSuccess(payload, status) {
    const value = payload as any;
    const blocks = Array.isArray(value?.content) ? value.content : [];
    const text = blocks.filter((block: any) => block?.type === "text" && typeof block.text === "string")
      .map((block: any) => block.text).join("");
    if (!text || value?.error || (value?.stop_reason && value.stop_reason !== "end_turn" && value.stop_reason !== "stop_sequence")) {
      return { ok: false, failure: { kind: "invalid-response", message: "LLM response has no complete assistant text", status } };
    }
    return { ok: true, text };
  },
  classifyFailure(payload, status) {
    return { kind: "upstream", message: (payload as any)?.error?.message || `LLM upstream returned ${status}`, status };
  },
};
