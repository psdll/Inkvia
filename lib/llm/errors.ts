import { sanitizeProviderErrorText } from "@/lib/providers/error-safety";

// 跨平台的错误归一化。
//
// 替代旧的 lib/openrouter.ts 里 parseOpenRouterError / isModelNotUsable。
// 设计目标:
//  - 业务层只通过 LlmRequestError 知道"哪个平台、哪个模型、HTTP 状态、人话错误"
//  - kie.ai 会用 HTTP 200 包业务错误(`{"code":422,"msg":"The model is not supported"}`),
//    这种情况也走 parseLlmError 处理,把 code/msg 提取出来。

export interface LlmErrorInfo {
  provider: string;
  status: number;
  /** 业务错误码(kie.ai 的 code,或上游 error.code) */
  code?: string | number;
  message: string;
  model?: string;
}

export class LlmRequestError extends Error {
  readonly info: LlmErrorInfo;
  constructor(info: LlmErrorInfo) {
    super(`[${info.provider}${info.model ? `:${info.model}` : ""}] ${info.message}`);
    this.name = "LlmRequestError";
    this.info = info;
  }
}

/**
 * Provider error bodies are untrusted and may reflect request credentials or URLs.
 * Keep only bounded diagnostics that are safe to carry through Error, logs, or JSON.
 */
export function redactLlmErrorText(
  value: unknown,
  sensitiveValues: readonly string[] = [],
): string {
  return sanitizeProviderErrorText(value, sensitiveValues, "");
}

/** 解析任意 LLM 平台的错误响应体(JSON 或纯文本)。 */
export function parseLlmError(
  provider: string,
  status: number,
  rawBody: string,
  model?: string,
  sensitiveValues: readonly string[] = [],
): LlmErrorInfo {
  let message = rawBody || `${provider} HTTP ${status}`;
  let code: string | number | undefined;
  try {
    const j = JSON.parse(rawBody);
    // OpenAI / Anthropic 风格: { error: { message, code } }
    // kie.ai 风格: { code, msg, data }
    code = j?.error?.code ?? j?.code;
    const msg =
      j?.error?.message || j?.message || j?.msg || j?.error || rawBody;
    if (msg) message = String(msg).trim();
  } catch {
    /* 非 JSON 保持原样 */
  }
  const safeMessage = redactLlmErrorText(message, sensitiveValues) || `${provider} HTTP ${status}`;
  const safeCode = typeof code === "string"
    ? redactLlmErrorText(code, sensitiveValues)
    : typeof code === "number"
      ? code
      : undefined;
  return { provider, status, code: safeCode, message: safeMessage, model };
}

export type LegacyLlmErrorCategory = "auth" | "rate-limit" | "upstream" | "internal";

export interface PublicLegacyLlmFailure {
  status: number;
  message: string;
  category: LegacyLlmErrorCategory;
  logContext: {
    category: LegacyLlmErrorCategory;
    status: number;
    provider?: string;
  };
}

function safeProviderName(value: unknown): string | undefined {
  const provider = String(value || "").trim();
  return /^[a-z0-9._:-]{1,64}$/i.test(provider) ? provider : undefined;
}

/** Fixed public/log representation; never includes the upstream body or Error.message. */
export function getPublicLegacyLlmFailure(
  error: unknown,
  fallbackMessage = "LLM 调用失败，请稍后重试",
): PublicLegacyLlmFailure {
  if (!(error instanceof LlmRequestError)) {
    return {
      status: 502,
      message: fallbackMessage,
      category: "internal",
      logContext: { category: "internal", status: 502 },
    };
  }

  const upstreamStatus = Number.isFinite(error.info.status) ? Math.trunc(error.info.status) : 502;
  const provider = safeProviderName(error.info.provider);
  let status = 502;
  let message = "LLM 上游请求失败，请稍后重试";
  let category: LegacyLlmErrorCategory = "upstream";

  if (isAuthError(error.info)) {
    status = 502;
    message = "LLM 服务认证失败，请联系管理员检查配置";
    category = "auth";
  } else if (isRateLimited(error.info)) {
    status = 429;
    message = "LLM 服务繁忙，请稍后重试";
    category = "rate-limit";
  } else if (upstreamStatus >= 500) {
    message = "LLM 上游服务暂时不可用，请稍后重试";
  }

  return {
    status,
    message,
    category,
    logContext: {
      category,
      status: upstreamStatus,
      ...(provider ? { provider } : {}),
    },
  };
}

/** 判断这个错误是否表明"换一个模型可能就行"——用于 fallback 时跳过这个模型。 */
export function isModelNotUsable(err: LlmErrorInfo): boolean {
  if (err.status === 404) return true;
  const msg = String(err.message || "").toLowerCase();
  if (msg.includes("not supported")) return true;
  if (msg.includes("model not found")) return true;
  if (msg.includes("no such model")) return true;
  if (msg.includes("model is empty")) return true;
  if (msg.includes("not available")) return true;
  return false;
}

/** Auth/Key 失败,继续 fallback 没意义,直接抛。 */
export function isAuthError(err: LlmErrorInfo): boolean {
  if (err.status === 401 || err.status === 403) return true;
  const msg = String(err.message || "").toLowerCase();
  if (msg.includes("invalid api key")) return true;
  if (msg.includes("authentication")) return true;
  return false;
}

/** kie.ai 限速。可以等一下重试,但 fallback 列表里下一个模型也会被限,所以暂时也跳过。 */
export function isRateLimited(err: LlmErrorInfo): boolean {
  if (err.status === 429) return true;
  if (err.code === 429) return true;
  return String(err.message || "").toLowerCase().includes("rate limit");
}
