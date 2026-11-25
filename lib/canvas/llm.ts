import { buildCanvasLlmContent, type CanvasLlmMediaReference } from "./llm-media";
import { fetchWithLlmBilling } from "@/lib/billing/metered-fetch";
// 画布 LLM 对话 —— 复刻开源版（无限画布 gpt-chat / canvas-llm），走供应商注册表。
//
// 重要：这里【不】复用项目现有 Agent/UserMemory（用户反馈现有不好用且要求别动）。
// 直接对注册表里配置的平台发 OpenAI 兼容 /chat/completions；apimart 响应解包 {code,data}。

import {
  resolveProviderRequestContext,
} from "@/lib/providers/transport";
import { isMiniMaxLlmModel } from "@/lib/minimax-llm-models";
import { resolveLlmRoute } from "@/lib/llm-routing/resolver";
import { callLlmForScenario } from "@/lib/llm-routing/gateway";
import { getLlmModelVisibility, isLlmModelVisible } from "@/lib/llm-routing/visibility";

function joinUrl(base: string, path: string): string {
  return `${String(base).replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export type CanvasLlmInput = {
  authUserId: number;
  providerId: string;
  model: string;
  prompt: string;
  system?: string;
  thinkingLevel?: import("@/lib/llm-routing/reasoning").LlmThinkingLevel;
  mediaReferences?: CanvasLlmMediaReference[];
};

const REQUEST_TIMEOUT_MS = 120000;

/** 调用注册表中某平台的 LLM，返回助手文本。失败抛出可读错误。 */
export async function canvasLlmChat(input: CanvasLlmInput): Promise<string> {
  if (!isLlmModelVisible(await getLlmModelVisibility(), input.providerId, input.model)) {
    throw new Error("该文本模型已隐藏，请重新选择可用模型");
  }
  if ((input.thinkingLevel && input.thinkingLevel !== "default") || input.mediaReferences?.length || isMiniMaxLlmModel(input.providerId, input.model) || input.providerId === "bailian" || input.providerId === "volcengine" || input.providerId === "bigmodel") {
    const resolved = await resolveLlmRoute("canvas.chat", { providerId: input.providerId, modelId: input.model });
    if (resolved.status !== "ready") throw new Error(`${input.model} 尚未配置或启用`);
    const userContent = await buildCanvasLlmContent({ ...input, modelId: input.model });
    const messages: import("@/lib/llm-routing/types").LlmChatMessage[] = [];
    if (input.system?.trim()) messages.push({ role: "system", content: input.system.trim() });
    messages.push({ role: "user", content: userContent });
    return (await callLlmForScenario(resolved.route, messages, { billingIdentity: { authUserId: input.authUserId }, thinkingLevel: input.thinkingLevel })).text;
  }
  const { provider, decision } = await resolveProviderRequestContext(input.providerId);
  if (!provider.apiKey) throw new Error(`${provider.name} API Key 未配置，请在管理员 API 配置中保存`);

  const messages: { role: string; content: unknown }[] = [];
  if (input.system?.trim()) messages.push({ role: "system", content: input.system.trim() });
  messages.push({ role: "user", content: input.prompt });

  const url = joinUrl(provider.baseUrl, "chat/completions");
  const resp = await fetchWithLlmBilling(decision, url, {
    method: "POST",
    headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: input.model, messages }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, { authUserId: input.authUserId });

  const text = await resp.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON */
  }
  if (!resp.ok) {
    const msg = json?.error?.message || json?.message || `LLM 请求失败（${resp.status}）`;
    throw new Error(String(msg));
  }
  // apimart 把标准响应包在 {code,data} 里，检测到就解包
  const payload = json && typeof json === "object" && "code" in json && "data" in json ? json.data : json;
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    // 兼容部分平台 content 为分段数组
    return content.map((c: any) => (typeof c === "string" ? c : c?.text || "")).join("");
  }
  return "";
}
