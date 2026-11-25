import { fetchWithLlmBilling } from "@/lib/billing/metered-fetch";
// kie.ai Responses API Provider —— 处理 gpt-5-5 / codex 系列模型。
//
// 协议背景(P0 + Responses 探针实测):
//   - Endpoint:    POST https://api.kie.ai/codex/v1/responses
//   - 请求体:      { model, input: "string" 或 [{role, content}], max_output_tokens, stream }
//   - 响应:        **强制 SSE 流式**,即使 stream=false 也返回 SSE(无法走纯 JSON 模式)
//   - 流式事件:    response.created / response.in_progress / response.output_item.added /
//                  response.content_part.added / response.output_text.delta (N×) /
//                  response.output_text.done / response.content_part.done /
//                  response.output_item.done / response.completed
//   - 文本增量字段: response.output_text.delta 的 data.delta(字符串)
//   - 完整文本字段: response.output_text.done 的 data.text(字符串)
//
// ⚠️ 重要警告:kie.ai 的 gpt-5-5 实际是 **Codex 编程 Agent**,带写死的 system prompt
//    "You are Codex, a coding agent based on GPT-5."。它不适合做内容运营聊天。
//    管理员选择此模型前应该明白这一点。
//
// 接口契约与 kie-provider.ts 一致:都暴露 chatStream / chatJson,返回 ChatStreamResult / ChatJsonResult。

import type {
  ChatJsonResult,
  ChatMessage,
  ChatStreamChunk,
  ChatStreamResult,
  LlmChatOptions,
} from "@/lib/llm/provider";
import {
  isAuthError,
  isModelNotUsable,
  LlmRequestError,
  parseLlmError,
  redactLlmErrorText,
} from "@/lib/llm/errors";
import { providerErrorSensitiveValues } from "@/lib/providers/error-safety";
import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import { resolveProviderRequestContext } from "@/lib/providers/transport";

const PROVIDER = "kie.ai:codex";

function buildEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/codex/v1/responses`;
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "User-Agent": "inkvia/1.0 (+server)",
  };
}

/** 把通用 ChatMessage[] 转成 Responses API 的 input。
 *  Responses API 的 input 可以是字符串(单条 prompt)或 [{role, content}] 数组。
 *  我们这里始终用数组形式,把 system 和其他消息都塞进去。 */
function toResponsesInput(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }
    // 多模态/数组形式:Responses API 也接受 content 数组,字段名 `output_text`/`input_text`
    // 这里保守起见,把数组里 text 部分拼成字符串(Codex 模型不需要图像输入)
    const text = m.content
      .filter((p) => p.type === "text")
      .map((p) => (p as { type: "text"; text: string }).text)
      .join("\n");
    return { role: m.role, content: text };
  });
}

function buildBody(messages: ChatMessage[], options: LlmChatOptions, model: string) {
  return {
    model,
    input: toResponsesInput(messages),
    ...(options.maxTokens !== undefined ? { max_output_tokens: options.maxTokens } : { max_output_tokens: 4096 }),
    stream: true, // Responses API 强制走流式,我们也始终启用
  };
}

function parseResponsesEvent(block: string): ChatStreamChunk | null {
  const dataLines: string[] = [];
  let eventName = "message";
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  const dataRaw = dataLines.join("\n");
  if (!dataRaw) return null;

  try {
    const data = JSON.parse(dataRaw);
    const type = String(data?.type || eventName);
    if (type === "response.output_text.delta") {
      const delta = String(data?.delta || "");
      return delta ? { delta } : null;
    }
    if (type === "response.completed") {
      return {
        finishReason: String(
          data?.response?.status || data?.response?.incomplete_details?.reason || "stop",
        ),
      };
    }
  } catch {
    /* 忽略无法解析的事件 */
  }
  return null;
}

/** 把原始 SSE 字节流转成归一化的 ChatStreamChunk。 */
async function* parseResponsesStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatStreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // 兼容 LF 与 CRLF，并允许事件被拆到任意字节块。
    while (true) {
      const separator = /\r?\n\r?\n/.exec(buffer);
      if (!separator || separator.index === undefined) break;
      const idx = separator.index;
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + separator[0].length);
      const parsed = parseResponsesEvent(block);
      if (parsed) yield parsed;
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const parsed = parseResponsesEvent(buffer);
    if (parsed) yield parsed;
  }
}

/** kie.ai 业务错误检测(HTTP 200 但 body 是 {"code":XXX,"msg":"...","data":null} 的形态)。 */
function detectKieBusinessError(
  rawBody: string,
  model: string,
  sensitiveValues: readonly string[],
) {
  try {
    const j = JSON.parse(rawBody);
    if (j && typeof j.code === "number" && j.code >= 400) {
      return parseLlmError(PROVIDER, j.code, rawBody, model, sensitiveValues);
    }
  } catch {
    /* SSE 文本就不会是合法 JSON,正常 */
  }
  return null;
}

// ──────────────────────────────────────── 主入口 ────────────────────────────────────────

export async function chatStream(
  messages: ChatMessage[],
  options: LlmChatOptions,
): Promise<ChatStreamResult> {
  if (!options.models?.length) {
    throw new Error("chatStream 需要至少一个候选模型");
  }
  const context = await resolveProviderRequestContext("kie");
  const apiKey = resolvedProviderApiKey(context.provider);
  const decision = context.decision;
  const errors: string[] = [];

  for (const model of options.models) {
    const endpoint = buildEndpoint(context.provider.baseUrl);
    const sensitiveValues = providerErrorSensitiveValues(decision, apiKey, endpoint);
    let response: Response;
    try {
      response = await fetchWithLlmBilling(decision, endpoint, {
        method: "POST",
        headers: buildHeaders(apiKey),
        body: JSON.stringify(buildBody(messages, options, model)),
      });
    } catch (e: any) {
      errors.push(`${model}: 网络错误 ${redactLlmErrorText(e?.message || e, sensitiveValues)}`);
      continue;
    }

    if (!response.ok || !response.body) {
      const raw = await response.text().catch(() => "");
      const err = parseLlmError(PROVIDER, response.status, raw, model, sensitiveValues);
      if (isAuthError(err)) throw new LlmRequestError(err);
      if (isModelNotUsable(err)) {
        errors.push(`${model}: ${err.message}`);
        continue;
      }
      // 业务错误码也判一遍
      const biz = detectKieBusinessError(raw, model, sensitiveValues);
      if (biz) {
        if (isAuthError(biz)) throw new LlmRequestError(biz);
        if (isModelNotUsable(biz)) {
          errors.push(`${model}: ${biz.message}`);
          continue;
        }
        throw new LlmRequestError(biz);
      }
      throw new LlmRequestError(err);
    }

    // 注意:Responses API 总是返回 SSE,所以不做 Content-Type 二次判别,直接交给 parser。
    return { model, chunks: parseResponsesStream(response.body) };
  }

  throw new Error(`所有 kie.ai Responses 候选模型都不可用: ${errors.join("; ")}`);
}

/** chatJson:Responses API 强制流式,所以这里内部跑流然后累积成 raw,再尝试 JSON.parse。 */
export async function chatJson(
  messages: ChatMessage[],
  options: LlmChatOptions,
): Promise<ChatJsonResult> {
  const streamResult = await chatStream(messages, options);
  let raw = "";
  for await (const chunk of streamResult.chunks) {
    if (chunk.delta) raw += chunk.delta;
  }
  return { model: streamResult.model, raw, value: extractFirstJsonObject(raw) };
}

function extractFirstJsonObject(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    /* 继续找第一个 {} 块 */
  }
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
