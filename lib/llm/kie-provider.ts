import { fetchWithLlmBilling } from "@/lib/billing/metered-fetch";
// kie.ai 统一 Provider。
//
// kie.ai 上不同模型走不同协议(P0 + Responses 探针实测):
//   - claude-*                       → POST /claude/v1/messages       (Anthropic 原生协议)
//   - gpt-* / codex-* / o1-* / o3-*  → POST /codex/v1/responses       (OpenAI Responses API,强制 SSE)
//   - 其他(gemini-* 等)             → POST /{model-id}/v1/chat/completions (OpenAI chat.completions)
//
// Provider 内部根据 model id 前缀自动 dispatch,业务层只看到统一的 ChatMessage[] / ChatStreamChunk 接口。
// Responses API 协议在独立的 kie-responses-provider.ts 里实现,本文件按前缀路由过去。
//
// P0 探针报告的几个关键事实:
//   - kie.ai 经常用 HTTP 200 包业务错误({"code":422,"msg":"The model is not supported","data":null})
//   - Cloudflare 对 Python urllib 直接 1010 拒绝,要给合法 User-Agent
//   - 限速 20 reqs/10s,触发后返回 {"code":429,"msg":"...frequency is too high..."}

import type {
  ChatJsonResult,
  ChatMessage,
  ChatMessagePart,
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
import * as KieResponses from "@/lib/llm/kie-responses-provider";
import { providerErrorSensitiveValues } from "@/lib/providers/error-safety";
import { resolvedProviderApiKey } from "@/lib/providers/resolve";
import { resolveProviderRequestContext } from "@/lib/providers/transport";

const PROVIDER = "kie.ai";

function isClaudeModel(model: string): boolean {
  return /^claude/i.test(model);
}

/** OpenAI Responses API 系列(gpt-5+ 在 kie.ai 上是 Codex agent,o1/o3 同理)。 */
function isResponsesApiModel(model: string): boolean {
  return /^(gpt-5|gpt-4\.5|codex|o1|o3|o4)/i.test(model);
}

function buildEndpoint(baseUrl: string, model: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (isClaudeModel(model)) return `${base}/claude/v1/messages`;
  return `${base}/${model}/v1/chat/completions`;
}

function buildHeaders(apiKey: string, stream: boolean): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: stream ? "text/event-stream" : "application/json",
    // Cloudflare 在 Node 默认 fetch UA 上偶尔会 1010,给一个明确客户端标识
    "User-Agent": "inkvia/1.0 (+server)",
  };
}

// ───────────────────────── 请求体构造 ─────────────────────────

function messagePartsToString(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is Extract<ChatMessagePart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

function buildAnthropicBody(
  messages: ChatMessage[],
  options: LlmChatOptions,
  model: string,
  stream: boolean,
) {
  // Anthropic /v1/messages:
  //   - system 单独放 body.system,不进 messages
  //   - assistant 消息携带 tool_calls 时,要展开为 content 数组 [{type:"text",text}, {type:"tool_use",id,name,input}]
  //   - 工具结果走 role="user" + content=[{type:"tool_result",tool_use_id,content}]
  const systemMsg = messages.find((m) => m.role === "system");
  const others = messages.filter((m) => m.role !== "system");
  return {
    model,
    max_tokens: options.maxTokens ?? 4096,
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    stream,
    ...(systemMsg ? { system: messagePartsToString(systemMsg.content) } : {}),
    messages: others.map(toAnthropicMessage),
    ...(options.tools && options.tools.length
      ? {
          tools: options.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
          })),
        }
      : {}),
  };
}

/** 把通用 ChatMessage 转换为 Anthropic message 形态(处理 tool_calls / tool_result)。 */
function toAnthropicMessage(m: ChatMessage): {
  role: string;
  content: unknown;
} {
  // role="tool" 是我们的归一化 — Anthropic 实际用 user + content[tool_result]
  if (m.role === "tool") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: m.toolCallId,
          content: typeof m.content === "string" ? m.content : messagePartsToString(m.content),
        },
      ],
    };
  }
  // assistant 带 tool_calls,展开为 [text, tool_use, ...] 数组
  if (m.role === "assistant" && m.toolCalls && m.toolCalls.length) {
    const parts: unknown[] = [];
    const text = typeof m.content === "string" ? m.content : messagePartsToString(m.content);
    if (text.trim()) parts.push({ type: "text", text });
    for (const call of m.toolCalls) {
      let input: unknown = {};
      try {
        input = call.arguments ? JSON.parse(call.arguments) : {};
      } catch {
        input = {};
      }
      parts.push({ type: "tool_use", id: call.id, name: call.name, input });
    }
    return { role: "assistant", content: parts };
  }
  return { role: m.role, content: m.content };
}

function buildOpenAiBody(
  messages: ChatMessage[],
  options: LlmChatOptions,
  model: string,
  stream: boolean,
) {
  return {
    model,
    messages: messages.map(toOpenAiMessage),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
    stream,
    ...(options.responseFormat === "json_object"
      ? { response_format: { type: "json_object" } }
      : {}),
    ...(options.tools && options.tools.length
      ? {
          tools: options.tools.map((t) => ({
            type: "function",
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          })),
        }
      : {}),
  };
}

/** OpenAI chat.completions 风格的 message。tool/tool_calls 字段命名跟 Anthropic 完全不同。 */
function toOpenAiMessage(m: ChatMessage): Record<string, unknown> {
  if (m.role === "tool") {
    return {
      role: "tool",
      tool_call_id: m.toolCallId,
      content: typeof m.content === "string" ? m.content : messagePartsToString(m.content),
    };
  }
  if (m.role === "assistant" && m.toolCalls && m.toolCalls.length) {
    return {
      role: "assistant",
      content: typeof m.content === "string" ? m.content : messagePartsToString(m.content),
      tool_calls: m.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  }
  return { role: m.role, content: m.content as any };
}

// ───────────────────────── 流式响应解析 ─────────────────────────

async function* parseAnthropicStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatStreamChunk> {
  // Anthropic 工具调用的流式协议:
  //   content_block_start (type=tool_use, id, name)
  //   content_block_delta (type=input_json_delta, partial_json="...")  ← 多次累加
  //   content_block_stop
  //   message_delta { stop_reason="tool_use" }
  // 我们在 stream 结束时一次性吐出完整的 toolCalls。
  type ToolBuilder = { id: string; name: string; argsBuffer: string };
  const toolBuilders = new Map<number, ToolBuilder>();
  let pendingFinishReason: string | undefined;

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
      if (!payload) continue;
      try {
        const j = JSON.parse(payload);
        const type = j.type;

        if (type === "content_block_start" && j.content_block?.type === "tool_use") {
          const idx = Number(j.index ?? toolBuilders.size);
          toolBuilders.set(idx, {
            id: String(j.content_block.id || `tool_${idx}`),
            name: String(j.content_block.name || ""),
            argsBuffer: "",
          });
          continue;
        }

        if (type === "content_block_delta") {
          if (j.delta?.type === "text_delta") {
            const text = String(j.delta.text || "");
            if (text) yield { delta: text };
          } else if (j.delta?.type === "input_json_delta") {
            const idx = Number(j.index ?? 0);
            const b = toolBuilders.get(idx);
            if (b) b.argsBuffer += String(j.delta.partial_json || "");
          }
          continue;
        }

        if (type === "message_delta" && j.delta?.stop_reason) {
          pendingFinishReason = String(j.delta.stop_reason);
          continue;
        }
        // message_start / content_block_stop / message_stop / ping 不产 delta
      } catch {
        /* 跳过无法解析的行 */
      }
    }
  }

  // 流结束:如果有工具调用一次性吐出
  if (toolBuilders.size > 0) {
    const calls = Array.from(toolBuilders.values()).map((b) => ({
      id: b.id,
      name: b.name,
      arguments: b.argsBuffer || "{}",
    }));
    yield { toolCalls: calls, finishReason: pendingFinishReason || "tool_use" };
  } else if (pendingFinishReason) {
    yield { finishReason: pendingFinishReason };
  }
}

async function* parseOpenAiStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatStreamChunk> {
  // OpenAI chat.completions 流式 tool_calls:
  //   delta.tool_calls = [{ index, id?, function: { name?, arguments? } }]
  //   arguments 是流式拼接的 JSON 字符串(每次 chunk 给一小段)
  //   id/name 通常只在第一个 chunk 有
  type ToolBuilder = { id: string; name: string; argsBuffer: string };
  const toolBuilders = new Map<number, ToolBuilder>();
  let pendingFinishReason: string | undefined;

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

        const delta = choice?.delta?.content ?? choice?.message?.content;
        if (delta) yield { delta: String(delta) };

        // tool_calls 累积
        const tcs = choice?.delta?.tool_calls || choice?.message?.tool_calls;
        if (Array.isArray(tcs)) {
          for (const tc of tcs) {
            const idx = Number(tc.index ?? 0);
            const b = toolBuilders.get(idx) || { id: "", name: "", argsBuffer: "" };
            if (tc.id) b.id = String(tc.id);
            if (tc.function?.name) b.name = String(tc.function.name);
            if (tc.function?.arguments) b.argsBuffer += String(tc.function.arguments);
            toolBuilders.set(idx, b);
          }
        }

        if (choice?.finish_reason) {
          pendingFinishReason = String(choice.finish_reason);
        }
      } catch {
        /* 跳过 */
      }
    }
  }

  if (toolBuilders.size > 0) {
    const calls = Array.from(toolBuilders.values()).map((b, i) => ({
      id: b.id || `call_${i}`,
      name: b.name,
      arguments: b.argsBuffer || "{}",
    }));
    yield { toolCalls: calls, finishReason: pendingFinishReason || "tool_calls" };
  } else if (pendingFinishReason) {
    yield { finishReason: pendingFinishReason };
  }
}

// ───────────────────────── kie.ai 200 包业务错误检测 ─────────────────────────

/** kie.ai 经常 HTTP 200 + body `{"code":422,"msg":"...","data":null}`。
 *  这个函数把这种业务错误转成 LlmErrorInfo,便于上层走同一套 fallback 逻辑。 */
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
    /* 非 JSON,不可能是业务错误结构 */
  }
  return null;
}

// ───────────────────────── 工具:JSON 容错解析 ─────────────────────────

function extractFirstJsonObject(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    /* 尝试找第一个完整 JSON 块 */
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

// ───────────────────────── 主入口 ─────────────────────────

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
    // Responses API 系列(gpt-5-5 / codex / o1 / o3)走独立 provider
    if (isResponsesApiModel(model)) {
      try {
        return await KieResponses.chatStream(messages, { ...options, models: [model] });
      } catch (e: any) {
        if (e instanceof LlmRequestError && (isAuthError(e.info) || !isModelNotUsable(e.info))) {
          throw e;
        }
        errors.push(`${model}: ${String(e?.message || e)}`);
        continue;
      }
    }

    const endpoint = buildEndpoint(context.provider.baseUrl, model);
    const sensitiveValues = providerErrorSensitiveValues(decision, apiKey, endpoint);
    const claude = isClaudeModel(model);
    const body = claude
      ? buildAnthropicBody(messages, options, model, true)
      : buildOpenAiBody(messages, options, model, true);

    let response: Response;
    try {
      response = await fetchWithLlmBilling(decision, endpoint, {
        method: "POST",
        headers: buildHeaders(apiKey, true),
        body: JSON.stringify(body),
      });
    } catch (e: any) {
      errors.push(`${model}: 网络错误 ${redactLlmErrorText(e?.message || e, sensitiveValues)}`);
      continue;
    }

    // HTTP 层错误
    if (!response.ok || !response.body) {
      const raw = await response.text().catch(() => "");
      const err = parseLlmError(PROVIDER, response.status, raw, model, sensitiveValues);
      if (isAuthError(err)) throw new LlmRequestError(err);
      if (isModelNotUsable(err)) {
        errors.push(`${model}: ${err.message}`);
        continue;
      }
      throw new LlmRequestError(err);
    }

    // HTTP 200 但 kie.ai 可能用 body 包业务错误。流式响应不能预读 body,
    // 否则会消耗掉 reader。我们通过 Content-Type 判断:真正的流是 text/event-stream,
    // 业务错误体一般 application/json。
    const ct = response.headers.get("content-type") || "";
    if (!ct.includes("event-stream") && ct.includes("json")) {
      const raw = await response.text().catch(() => "");
      const bizErr = detectKieBusinessError(raw, model, sensitiveValues);
      if (bizErr) {
        if (isAuthError(bizErr)) throw new LlmRequestError(bizErr);
        if (isModelNotUsable(bizErr)) {
          errors.push(`${model}: ${bizErr.message}`);
          continue;
        }
        throw new LlmRequestError(bizErr);
      }
      // 不是错误但也不是流?降级当非流式解析,把整段当一次 delta 吐出。
      const text = extractAssistantText(raw, claude);
      return {
        model,
        chunks: (async function* () {
          if (text) yield { delta: text };
        })(),
      };
    }

    const parser = claude ? parseAnthropicStream : parseOpenAiStream;
    return { model, chunks: parser(response.body) };
  }

  throw new Error(`所有 kie.ai 候选模型都不可用: ${errors.join("; ")}`);
}

export async function chatJson(
  messages: ChatMessage[],
  options: LlmChatOptions,
): Promise<ChatJsonResult> {
  if (!options.models?.length) {
    throw new Error("chatJson 需要至少一个候选模型");
  }
  const context = await resolveProviderRequestContext("kie");
  const apiKey = resolvedProviderApiKey(context.provider);
  const decision = context.decision;
  const errors: string[] = [];

  for (const model of options.models) {
    // Responses API 系列走独立 provider(内部跑流式后累积成 raw)
    if (isResponsesApiModel(model)) {
      try {
        return await KieResponses.chatJson(messages, { ...options, models: [model] });
      } catch (e: any) {
        if (e instanceof LlmRequestError && (isAuthError(e.info) || !isModelNotUsable(e.info))) {
          throw e;
        }
        errors.push(`${model}: ${String(e?.message || e)}`);
        continue;
      }
    }

    const endpoint = buildEndpoint(context.provider.baseUrl, model);
    const sensitiveValues = providerErrorSensitiveValues(decision, apiKey, endpoint);
    const claude = isClaudeModel(model);
    const body = claude
      ? buildAnthropicBody(messages, options, model, false)
      : buildOpenAiBody(messages, options, model, false);

    let response: Response;
    try {
      response = await fetchWithLlmBilling(decision, endpoint, {
        method: "POST",
        headers: buildHeaders(apiKey, false),
        body: JSON.stringify(body),
      });
    } catch (e: any) {
      errors.push(`${model}: 网络错误 ${redactLlmErrorText(e?.message || e, sensitiveValues)}`);
      continue;
    }

    const raw = await response.text();

    if (!response.ok) {
      const err = parseLlmError(PROVIDER, response.status, raw, model, sensitiveValues);
      if (isAuthError(err)) throw new LlmRequestError(err);
      if (isModelNotUsable(err)) {
        errors.push(`${model}: ${err.message}`);
        continue;
      }
      throw new LlmRequestError(err);
    }

    // HTTP 200 但可能是业务错误
    const bizErr = detectKieBusinessError(raw, model, sensitiveValues);
    if (bizErr) {
      if (isAuthError(bizErr)) throw new LlmRequestError(bizErr);
      if (isModelNotUsable(bizErr)) {
        errors.push(`${model}: ${bizErr.message}`);
        continue;
      }
      throw new LlmRequestError(bizErr);
    }

    const assistantText = extractAssistantText(raw, claude);
    return {
      model,
      raw: assistantText,
      value: extractFirstJsonObject(assistantText),
    };
  }

  throw new Error(`所有 kie.ai JSON 候选模型都不可用: ${errors.join("; ")}`);
}

/** 从原始响应里把 assistant 文本抠出来。Anthropic 是 content[].text,OpenAI 是 choices[0].message.content。 */
function extractAssistantText(raw: string, claude: boolean): string {
  try {
    const j = JSON.parse(raw);
    if (claude) {
      const blocks = Array.isArray(j?.content) ? j.content : [];
      return blocks
        .filter((b: any) => b?.type === "text")
        .map((b: any) => String(b.text || ""))
        .join("");
    }
    return String(j?.choices?.[0]?.message?.content || "");
  } catch {
    return "";
  }
}
