// 统一配置读取。
//
// 取代旧的 lib/env.ts —— 旧实现每次取值都遍历多个目录、读盘解析 .env.local，
// 属于性能与安全反模式。Next.js 启动时已原生把 .env.local 加载进 process.env，
// 这里直接读取即可，无需再读盘。

function str(name: string, fallback = ""): string {
  return String(process.env[name] ?? fallback).trim();
}

function csv(name: string): string[] {
  const raw = str(name);
  return raw
    ? raw.split(",").map((v) => v.trim()).filter(Boolean)
    : [];
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

// ── KIE (图片编辑) ────────────────────────────────────────
export function getKieImageEditModel(): string {
  return str("KIE_IMAGE_EDIT_MODEL", "nano-banana-pro");
}

// ── KIE LLM (claude-opus-4-7 / gemini-3.1-pro) ───────────────────────
// API Key 与接口地址统一由管理员 API 配置页中的 KIE 平台提供。
//
// 模型 → endpoint 映射在 lib/llm/kie-provider.ts 内部按 model id 自动 dispatch:
//   - claude-*       → POST {base}/claude/v1/messages (Anthropic 原生)
//   - 其他(gemini-*) → POST {base}/{model-id}/v1/chat/completions (OpenAI 兼容)
// 默认候选(env 缺失时用这个 fallback 列表):
const KIE_DEFAULT_JSON_MODELS = ["gemini-3.1-pro", "claude-opus-4-7"];
const KIE_DEFAULT_VISION_MODELS = ["gemini-3.1-pro"];

/** OCR 视觉:只用支持视觉的模型 */
export function getKieLlmOcrModels(): string[] {
  return uniq([...csv("KIE_LLM_OCR_MODELS"), ...KIE_DEFAULT_VISION_MODELS]);
}
/** 图片提示词生成(基于已有图描述,可能用视觉) */
export function getKieLlmAgentPromptModels(): string[] {
  return uniq([...csv("KIE_LLM_AGENT_PROMPT_MODELS"), ...KIE_DEFAULT_JSON_MODELS]);
}

// ── Volcengine Ark ───────────────────────────────────────────────────
export function getVolcengineArkBaseUrl(): string {
  return str("VOLCENGINE_ARK_BASE_URL", "https://ark.cn-beijing.volces.com");
}
export function getVolcengineAgentChatModel(): string {
  return str("VOLCENGINE_AGENT_CHAT_MODEL", "doubao-pro-32k-240615");
}
export function getVolcengineAgentMemoryModel(): string {
  return str("VOLCENGINE_AGENT_MEMORY_MODEL", getVolcengineAgentChatModel());
}

// APIMart (GPT-Image-2 official async image generation)
export function getApimartBaseUrl(): string {
  return str("APIMART_BASE_URL", "https://api.apimart.ai/v1");
}
export function getApimartImageModel(): string {
  return str("APIMART_IMAGE_MODEL", "gpt-image-2-official");
}

// Jiekou / HighwayAPI (GPT-Image-2 premium image generation)
export function getJiekouBaseUrl(): string {
  return str("JIEKOU_BASE_URL", "https://api.highwayapi.ai");
}
