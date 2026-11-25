// LLM 入口工厂。业务代码只 import 这里。
//
// 设计:
//   - chatStream / chatJson 主路径走 kie.ai
//   - kie.ai 整体失败(全部模型不可用 / 网络全断 / 鉴权失败)→ 自动 fallback 到火山 Ark
//   - 调用方只需要拿候选 model 列表(从 lib/config 的 getKieLlm*Models 拿)
//
// 错误信息组装规则(吸取 plan F 节教训):
//   - 401/403 → 单一明确错误:"kie.ai key 不可用"
//   - 全部模型 not supported → "所有 kie.ai 模型不可用,已切到备用"
//   - 火山也失败 → 只显示火山那条错,不拼 kie.ai 一长串

import * as KieProvider from "@/lib/llm/kie-provider";
import * as VolcProvider from "@/lib/llm/volcengine-provider";
import type {
  ChatJsonResult,
  ChatMessage,
  ChatStreamResult,
  LlmChatOptions,
} from "@/lib/llm/provider";
import { LlmRequestError } from "@/lib/llm/errors";

export type {
  ChatMessage,
  ChatMessagePart,
  ChatRole,
  ChatStreamChunk,
  ChatStreamResult,
  ChatJsonResult,
  LlmChatOptions,
} from "@/lib/llm/provider";
export {
  getPublicLegacyLlmFailure,
  LlmRequestError,
  redactLlmErrorText,
} from "@/lib/llm/errors";

function isAuthFailure(err: unknown): boolean {
  if (err instanceof LlmRequestError) {
    return err.info.status === 401 || err.info.status === 403;
  }
  return false;
}

/** Agent 主聊天等流式场景。 */
export async function chatStream(
  messages: ChatMessage[],
  options: LlmChatOptions,
): Promise<ChatStreamResult> {
  try {
    return await KieProvider.chatStream(messages, options);
  } catch (kieErr) {
    if (isAuthFailure(kieErr)) {
      // 鉴权失败,继续走火山没意义(用户改 key 就好),抛出明确错误
      throw kieErr;
    }
    // 其他错误(模型不可用 / 网络 / 限速)→ 火山兜底
    try {
      return await VolcProvider.chatStream(messages, options);
    } catch (volcErr: any) {
      if (volcErr instanceof LlmRequestError) throw volcErr;
      throw new Error("模型暂不可用，请稍后重试");
    }
  }
}

/** JSON 场景(记忆提取、会话摘要、关键词、图片提示词)。 */
export async function chatJson(
  messages: ChatMessage[],
  options: LlmChatOptions,
): Promise<ChatJsonResult> {
  try {
    return await KieProvider.chatJson(messages, options);
  } catch (kieErr) {
    if (isAuthFailure(kieErr)) throw kieErr;
    try {
      return await VolcProvider.chatJson(messages, options);
    } catch (volcErr: any) {
      if (volcErr instanceof LlmRequestError) throw volcErr;
      throw new Error("JSON 模型暂不可用，请稍后重试");
    }
  }
}

/** 视觉(OCR / 图像理解)。火山豆包文本模型不支持视觉,所以视觉路径不做兜底,
 *  直接抛 kie.ai 的错让上层处理。 */
export async function chatVision(
  messages: ChatMessage[],
  options: LlmChatOptions,
): Promise<ChatJsonResult> {
  return KieProvider.chatJson(messages, options);
}
