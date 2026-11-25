// LLM Provider 统一抽象。
//
// 业务代码只通过这层调模型,不直接接触 OpenAI / Anthropic / Volcengine 各自的请求结构。
// Provider 内部负责把不同协议(chat.completions / Anthropic /v1/messages 等)归一化为
// 这里定义的 ChatMessage / ChatStreamChunk / ChatJsonResult。

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessagePart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: ChatRole;
  content: string | ChatMessagePart[];
  /** assistant 消息可能携带模型上一轮决定的工具调用。回灌循环里要带上这个字段。 */
  toolCalls?: ToolCallRequest[];
  /** role="tool" 的工具结果消息要带上对应的 tool_call id,模型才能 match。 */
  toolCallId?: string;
}

/** 归一化后的流式增量。所有 provider 都吐这种结构。 */
export interface ChatStreamChunk {
  delta?: string;
  finishReason?: string;
  /** 模型决定调用工具时,会在流结束前发出一组 toolCalls。
   *  各 provider 内部已经把流式片段拼成完整结构,业务方拿到时 arguments 已经是合法 JSON 字符串。 */
  toolCalls?: ToolCallRequest[];
}

/** 模型生成的工具调用请求(归一化跨 provider 的形式)。 */
export interface ToolCallRequest {
  id: string;
  name: string;
  /** JSON 字符串(arguments 也叫 input)。业务方负责 JSON.parse + zod 校验。 */
  arguments: string;
}

/** 工具的 JSON Schema 定义(就是 OpenAI tools[].function 的 parameters / Anthropic tools[].input_schema)。 */
export interface ToolSchema {
  name: string;
  description: string;
  /** JSON Schema 对象。用 OpenAI 风格("type":"object", properties, required)。
   *  KieProvider 会自动转成 OpenAI/Anthropic 各自接受的字段名。 */
  parameters: Record<string, unknown>;
}

export interface ChatStreamResult {
  model: string;
  chunks: AsyncIterable<ChatStreamChunk>;
}

export interface ChatJsonResult {
  model: string;
  /** 模型返回的 assistant 原始文本(可能是 JSON 字符串,也可能是普通 markdown 包裹的 JSON) */
  raw: string;
  /** raw 尝试 JSON.parse 后的值;失败为 null */
  value: unknown;
}

export interface LlmChatOptions {
  /** 候选模型列表,按顺序尝试,前一个不可用就退到下一个 */
  models: string[];
  temperature?: number;
  maxTokens?: number;
  /** OpenAI 风格 JSON mode,Anthropic 不支持;不支持时 provider 内部用 prompt 强制 + 容错解析 */
  responseFormat?: "json_object";
  /** 提供工具时,模型可能在响应里返回 toolCalls(详见 ChatStreamChunk.toolCalls)。 */
  tools?: ToolSchema[];
}

/** 在多轮工具调用循环里,把上一轮的工具结果回灌时使用的消息体。
 *  对 OpenAI/Chat Completions 风格: role="tool", tool_call_id, content(string)
 *  对 Anthropic 原生:               role="user", content=[{type:"tool_result", tool_use_id, content}]
 *  Provider 内部按自家协议组装。业务层只构造这个 normalized 形式。 */
export interface ToolResultMessage {
  role: "tool";
  toolCallId: string;
  toolName: string;
  /** JSON.stringify 后的工具返回值。失败时这里塞错误描述,模型会自己决定要不要换路径。 */
  content: string;
}
