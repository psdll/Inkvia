import { fetchWithLlmBilling } from "@/lib/billing/metered-fetch";
// 火山 Ark Provider —— kie.ai 整体失败时的兜底。
//
// 协议:OpenAI chat.completions 兼容,POST {base}/api/v3/chat/completions
// 模型名:豆包系列(doubao-*)。env 没配的话用项目沿用的默认。
// 从原 lib/agent/model-client.ts 抽出,改造为符合 lib/llm/provider.ts 接口。

import {
  getVolcengineAgentChatModel,
  getVolcengineAgentMemoryModel,
  getVolcengineArkBaseUrl,
} from "@/lib/config";
import type {
  ChatJsonResult,
  ChatMessage,
  ChatStreamChunk,
  ChatStreamResult,
  LlmChatOptions,
} from "@/lib/llm/provider";
import { LlmRequestError, parseLlmError } from "@/lib/llm/errors";
import { providerErrorSensitiveValues } from "@/lib/providers/error-safety";
import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import {
  resolveProviderRequestContext,
} from "@/lib/providers/transport";

const PROVIDER = "volcengine";

function trimSlash(value: string) {
  return String(value || "").trim().replace(/\/+$/, "");
}

async function resolveVolcengineLlmEndpoint() {
  const context = await resolveProviderRequestContext("volcengine");
  const baseUrl = trimSlash(context.provider.baseUrl || getVolcengineArkBaseUrl());
  const apiKey = resolvedProviderApiKey(context.provider);
  return { apiKey, url: `${baseUrl}/api/v3/chat/completions`, decision: context.decision };
}

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function* parseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatStreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        const choice = j?.choices?.[0];
        const delta = choice?.delta?.content;
        if (delta) yield { delta: String(delta) };
        if (choice?.finish_reason) yield { finishReason: String(choice.finish_reason) };
      } catch {
        /* 跳过 */
      }
    }
  }
}

export async function chatStream(
  messages: ChatMessage[],
  options: LlmChatOptions,
): Promise<ChatStreamResult> {
  const { apiKey, url, decision } = await resolveVolcengineLlmEndpoint();
  const sensitiveValues = providerErrorSensitiveValues(decision, apiKey, url);
  // 火山兜底场景下,业务方传的 models 通常是 kie 模型名;这里完全忽略,直接用 env 配置的豆包模型。
  const model = options.models[0] || getVolcengineAgentChatModel();
  const useModel = model.startsWith("doubao-") ? model : getVolcengineAgentChatModel();

  const response = await fetchWithLlmBilling(decision, url, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      model: useModel,
      messages,
      temperature: options.temperature ?? 0.6,
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    const raw = await response.text().catch(() => "");
    throw new LlmRequestError(parseLlmError(PROVIDER, response.status, raw, useModel, sensitiveValues));
  }
  return { model: useModel, chunks: parseStream(response.body) };
}

export async function chatJson(
  messages: ChatMessage[],
  options: LlmChatOptions,
): Promise<ChatJsonResult> {
  const { apiKey, url, decision } = await resolveVolcengineLlmEndpoint();
  const sensitiveValues = providerErrorSensitiveValues(decision, apiKey, url);
  const model = options.models[0] || getVolcengineAgentMemoryModel();
  const useModel = model.startsWith("doubao-") ? model : getVolcengineAgentMemoryModel();

  const response = await fetchWithLlmBilling(decision, url, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      model: useModel,
      messages,
      temperature: options.temperature ?? 0.2,
      ...(options.responseFormat === "json_object"
        ? { response_format: { type: "json_object" } }
        : {}),
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new LlmRequestError(parseLlmError(PROVIDER, response.status, raw, useModel, sensitiveValues));
  }
  let assistantText = "";
  try {
    const j = JSON.parse(raw);
    assistantText = String(j?.choices?.[0]?.message?.content || "");
  } catch {
    assistantText = "";
  }

  let value: unknown = null;
  if (assistantText) {
    try {
      value = JSON.parse(assistantText);
    } catch {
      const start = assistantText.indexOf("{");
      if (start !== -1) {
        let depth = 0;
        for (let i = start; i < assistantText.length; i += 1) {
          if (assistantText[i] === "{") depth += 1;
          if (assistantText[i] === "}") {
            depth -= 1;
            if (depth === 0) {
              try {
                value = JSON.parse(assistantText.slice(start, i + 1));
              } catch {
                /* keep null */
              }
              break;
            }
          }
        }
      }
    }
  }

  return { model: useModel, raw: assistantText, value };
}
