export type FriendlyErrorCode =
  | "BILLING_OVERDUE"
  | "RATE_LIMIT"
  | "AUTH_DENIED"
  | "MODEL_UNAVAILABLE"
  | "CONTENT_REJECTED"
  | "TASK_NOT_FOUND"
  | "INPUT_LIMIT"
  | "VALIDATION"
  | "RESULT_DOWNLOAD_FAILED"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "SUBMISSION_UNKNOWN"
  | "UNKNOWN";

export type FriendlyError = {
  title: string;
  message: string;
  action: string;
  raw: string;
  requestId: string | null;
  code: FriendlyErrorCode;
};

export type PublicFriendlyError = Omit<FriendlyError, "raw">;

export const FRIENDLY_ERROR_GUIDE: Array<{
  code: FriendlyErrorCode;
  trigger: string;
  message: string;
  action: string;
}> = [
  {
    code: "BILLING_OVERDUE",
    trigger: "exhausted balance / top up balance / overdue balance / insufficient balance / billing / user is locked / 欠费 / 余额不足",
    message: "当前 API 账号余额不足或已被平台锁定，暂时无法生成。",
    action: "请到对应平台充值，或更换可用 API Key 后重试。"
  },
  {
    code: "RATE_LIMIT",
    trigger: "rate limit / too many requests / 429 / 请求过于频繁",
    message: "当前请求过于频繁，服务暂时限流。",
    action: "请稍后再试。"
  },
  {
    code: "AUTH_DENIED",
    trigger: "unauthorized / forbidden / access permissions / 401 / 403",
    message: "当前账号没有调用该能力的权限。",
    action: "请检查账号权限、密钥配置或模型开通状态。"
  },
  {
    code: "MODEL_UNAVAILABLE",
    trigger: "model not found / model unavailable / model disabled / model not enabled / 模型未开通 / 模型不可用",
    message: "当前模型不可用或账号未开通该模型。",
    action: "请切换模型，或确认平台账号已开通该模型。"
  },
  {
    code: "CONTENT_REJECTED",
    trigger: "content policy / moderation / safety / sensitive / 内容审核 / 敏感内容",
    message: "生成内容未通过平台审核。",
    action: "请调整提示词或输入素材后重试。"
  },
  {
    code: "TASK_NOT_FOUND",
    trigger: "not found / not exist / 404 / 不存在 / 已过期",
    message: "任务不存在或已过期。",
    action: "请重新提交任务。"
  },
  {
    code: "INPUT_LIMIT",
    trigger: "input/reference count limit / 输入素材数量限制",
    message: "输入数量超出当前模型限制。",
    action: "请减少输入数量后重试。"
  },
  {
    code: "VALIDATION",
    trigger: "validation / unprocessable / literal_error / invalid / 422",
    message: "请求参数不符合接口要求。",
    action: "请检查参数后重试。"
  },
  {
    code: "RESULT_DOWNLOAD_FAILED",
    trigger: "远程结果已返回，但下载保存失败",
    message: "上游平台已完成生成，但服务器保存结果文件失败。",
    action: "请先核对上游调用记录并联系管理员恢复结果文件，避免立即重复提交；如持续出现，请检查服务器存储及到结果文件地址的网络链路。"
  },
  {
    code: "NETWORK_ERROR",
    trigger: "ETIMEDOUT / ECONNRESET / ECONNREFUSED / Provider request failed / Provider request timed out",
    message: "服务器连接上游平台超时或中断，暂时无法确认任务结果。",
    action: "请先核对已有任务状态，避免重复提交；如持续出现，请联系管理员检查服务器到上游平台的网络链路。"
  },
  {
    code: "TIMEOUT",
    trigger: "timeout / timed out / 超时",
    message: "任务处理超时。",
    action: "请稍后重试。"
  },
  {
    code: "SUBMISSION_UNKNOWN",
    trigger: "提交结果未知 / upstream may have completed",
    message: "请求已提交，但响应连接中断，提交结果未知；上游可能已完成并计费。",
    action: "请先核对上游调用记录，避免立即重试或重复计费。"
  },
  {
    code: "UNKNOWN",
    trigger: "未命中规则（回退）",
    message: "生成失败，可能是上游平台返回异常。",
    action: "请稍后重试；如多次失败请联系管理员。"
  }
];

const RAW_MARKER = "\n\n[原始错误]\n";
const RID_MARKER = "\n[请求ID] ";
const ACTION_MARKER = "\n[建议] ";
const UNKNOWN_MESSAGE = "生成失败，可能是上游平台返回异常。";
const UNKNOWN_ACTION = "请稍后重试；如多次失败请联系管理员。";
const unknownErrorHits = new Map<string, number>();

function textOf(value: unknown) {
  return String(value || "").trim();
}

function firstMatch(raw: string, re: RegExp) {
  const m = raw.match(re);
  return m?.[1] ? String(m[1]).trim() : "";
}

function hasChineseText(value: string) {
  return /[\u4e00-\u9fa5]/.test(value);
}

function looksLikeRawEnglishError(value: string) {
  if (!value || hasChineseText(value)) return false;
  return /[a-z]/i.test(value);
}

function errorSignature(raw: string) {
  const normalized = textOf(raw)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/[a-f0-9]{16,}/g, "<id>")
    .replace(/\d{4,}/g, "<number>")
    .replace(/\s+/g, " ")
    .slice(0, 240);
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return `unknown_${Math.abs(hash).toString(36)}`;
}

function friendlyFromGuide(raw: string, code: FriendlyErrorCode, requestId: string | null): FriendlyError {
  const found = FRIENDLY_ERROR_GUIDE.find((item) => item.code === code);
  return {
    title: code === "BILLING_OVERDUE"
      ? "余额不足"
      : code === "RATE_LIMIT"
        ? "请求过于频繁"
        : code === "AUTH_DENIED"
          ? "权限不足"
          : code === "MODEL_UNAVAILABLE"
            ? "模型不可用"
            : code === "CONTENT_REJECTED"
              ? "内容未通过审核"
              : code === "TASK_NOT_FOUND"
                ? "任务不存在"
                : code === "INPUT_LIMIT"
                  ? "输入超出上限"
                  : code === "VALIDATION"
                    ? "参数不符合要求"
                    : code === "RESULT_DOWNLOAD_FAILED"
                      ? "结果保存失败"
                      : code === "NETWORK_ERROR"
                        ? "上游连接失败"
                        : code === "TIMEOUT"
                          ? "处理超时"
                          : code === "SUBMISSION_UNKNOWN"
                            ? "结果待确认"
                            : "任务失败",
    message: found?.message || UNKNOWN_MESSAGE,
    action: found?.action || UNKNOWN_ACTION,
    raw,
    requestId,
    code
  };
}

export function extractRequestId(raw: string) {
  const source = textOf(raw);
  if (!source) return null;
  return (
    firstMatch(source, /request[\s_-]*id[:\s]+([a-zA-Z0-9-]{8,})/i) ||
    firstMatch(source, /req(?:uest)?[\s_-]*id[:\s]+([a-zA-Z0-9-]{8,})/i) ||
    firstMatch(source, /\b([a-f0-9]{24,})\b/i) ||
    null
  );
}

/** Midjourney 上游参数错误里带着具体原因（如 “--no 后不能有 clothes”），直接展示出来，而不是通用的“参数不符合要求”。 */
function midjourneyParameterDetail(raw: string) {
  const blocked = raw.match(/--no\s*后不能有\s*([^\s，,。元]+)/);
  if (blocked) return {
    message: `Midjourney 拒绝了“不要出现”（--no）里的「${blocked[1]}」。`,
    action: "“不要衣服”这类写法会被当成裸露要求直接拒绝。请删掉这个词，或写成具体款式（例如 plain black shirt）后重试；本次已自动退款。",
  };
  const tooLong = raw.match(/提示词过长[\s\S]*?(\d{3,})\s*字符/);
  if (tooLong) return {
    message: `Midjourney 提示词太长被拒绝：这次正文、“不要出现”和参数一共 ${tooLong[1]} 个字符。`,
    action: "请精简提示词后重试（约 2000 字符以内的都能成功），可以只保留人物、服装、场景、光线等关键描述；本次已自动退款。",
  };
  const detail = raw.match(/CustomParse[\s\S]*?(?:消息|message)\s*=\s*([\s\S]+?)\s*(?:元数据|metadata)\s*=/i)?.[1]?.trim();
  return detail ? { message: `Midjourney 参数被拒绝：${detail}`, action: "请按提示修改参数后重试；本次已自动退款。" } : null;
}

function buildFriendly(rawInput: string, code: FriendlyErrorCode): FriendlyError {
  const raw = textOf(rawInput);
  const requestId = extractRequestId(raw);
  const midjourney = code === "VALIDATION" ? midjourneyParameterDetail(raw) : null;
  if (midjourney) return { title: "参数需要调整", ...midjourney, raw, requestId, code };
  if (code !== "UNKNOWN") {
    return friendlyFromGuide(raw, code, requestId);
  }
  const fallback = raw || "任务失败，请稍后重试";
  const hasChinese = hasChineseText(fallback);
  return {
    title: "任务失败",
    message: fallback,
    action: hasChinese ? "请根据提示处理后重试。" : UNKNOWN_ACTION,
    raw: fallback,
    requestId,
    code
  };
}

function inferCode(rawInput: string): FriendlyErrorCode {
  const raw = textOf(rawInput);
  const lower = raw.toLowerCase();
  if (!raw) return "UNKNOWN";
  if (/unrecognized\s+keys?/i.test(raw)) return "VALIDATION";
  if (/远程结果已返回，但下载保存失败/i.test(raw)) return "RESULT_DOWNLOAD_FAILED";
  if (/exhausted\s+balance|top\s+up\s+(your\s+)?balance|insufficient\s+(balance|funds|credits)|overdue|billing|user\s+is\s+locked|欠费|余额不足|账户余额|充值/.test(lower)) return "BILLING_OVERDUE";
  if (/rate limit|too many requests|请求过于频繁|\b429\b/i.test(raw)) return "RATE_LIMIT";
  if (/model\s+(not\s+found|unavailable|disabled|not\s+enabled|not\s+support|does\s+not\s+exist)|unknown\s+model|模型(未开通|不可用|不存在|已关闭)/i.test(raw)) return "MODEL_UNAVAILABLE";
  if (/content\s+policy|moderation|safety|sensitive|blocked\s+by\s+policy|violate|审核|敏感|违规|安全策略/i.test(raw)) return "CONTENT_REJECTED";
  if (/unauthorized|forbidden|access permissions|permission denied|无权限|未授权|\b401\b|\b403\b/i.test(raw)) return "AUTH_DENIED";
  if (/not[\s_-]*found|not[\s_-]*exist|不存在|已过期|\b404\b/i.test(raw)) return "TASK_NOT_FOUND";
  if (/最多支持\s*\d+\s*[张个条段份]\s*(?:参考)?(?:图|视频|音频|素材|文件)|(?:输入|参考)(?:图片|图像|素材|文件)?数量.{0,12}(?:超出|超过|上限)/i.test(raw)
    || /too many inputs?\b|(?:at most|max(?:imum)? support)\s+\d+\s+(?:input |reference )?(?:images?|videos?|audios?|media|files?)\b|(?:input|reference)(?: images?| videos?| audios?| media| files?)? (?:count|number|quantity).{0,24}exceed|(?:input|reference) limit exceeded/i.test(raw)) return "INPUT_LIMIT";
  if (/validation|unprocessable|literal_error|input should|invalid|参数不正确|参数错误|\b422\b/i.test(raw)) return "VALIDATION";
  if (/\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|UND_ERR_[A-Z_]+)\b|socket hang up|fetch failed|provider request timed out/i.test(raw)
    || /^provider request failed(?:\s*\([A-Z0-9_]+\))?$/i.test(raw)) return "NETWORK_ERROR";
  if (/timeout|timed out|超时/i.test(raw)) return "TIMEOUT";
  if (/提交结果未知|upstream may have completed/i.test(raw)) return "SUBMISSION_UNKNOWN";
  return "UNKNOWN";
}

export function toFriendlyError(rawInput: unknown): FriendlyError {
  const raw = sanitizeProviderErrorText(rawInput, [], "任务失败，请稍后重试");
  const code = inferCode(raw);
  return buildFriendly(raw, code);
}

export function formatFriendlyMessageForStorage(f: FriendlyError) {
  const top = [f.message, `${ACTION_MARKER}${f.action}`, f.requestId ? `${RID_MARKER}${f.requestId}` : ""].filter(Boolean).join("\n");
  const safeRaw = sanitizeProviderErrorText(f.raw || f.message, [], f.message);
  return `${top}${RAW_MARKER}${safeRaw}`;
}

export function toPublicFriendlyError(f: FriendlyError): PublicFriendlyError {
  return {
    title: f.title,
    message: sanitizeProviderErrorText(f.message, [], "任务失败，请稍后重试。"),
    action: sanitizeProviderErrorText(f.action, [], "请稍后重试。"),
    requestId: f.requestId,
    code: f.code,
  };
}

export function friendlyErrorPrimaryText(value: unknown) {
  const parsed = parseFriendlyMessageFromStorage(value);
  return parsed.message;
}

/** Correct the known historical mismatch without changing other raw display strings. */
export function friendlyErrorDisplayText(value: string) {
  const parsed = parseFriendlyMessageFromStorage(value);
  return "legacyDisplayCorrection" in parsed ? parsed.message : value;
}

export function unknownFriendlyErrorLogMeta(
  f: FriendlyError,
  context: { provider?: string | null; model?: string | null; status?: number | string | null } = {}
) {
  if (f.code !== "UNKNOWN") return null;
  const signature = errorSignature(f.raw);
  const count = (unknownErrorHits.get(signature) || 0) + 1;
  unknownErrorHits.set(signature, count);
  return {
    friendlyErrorCode: f.code,
    signature,
    occurrenceCount: count,
    summary: sanitizeProviderErrorText(f.raw, [], "未知错误").slice(0, 500),
    provider: context.provider || null,
    model: context.model || null,
    status: context.status || null
  };
}

export function parseFriendlyMessageFromStorage(value: unknown) {
  const text = textOf(value);
  if (!text) {
    return {
      title: "任务失败",
      message: "任务失败，请稍后重试。",
      action: "",
      requestId: null as string | null,
      raw: ""
    };
  }
  const rawIndex = text.indexOf(RAW_MARKER);
  const head = rawIndex >= 0 ? text.slice(0, rawIndex) : text;
  const raw = sanitizeProviderErrorText(
    rawIndex >= 0 ? text.slice(rawIndex + RAW_MARKER.length).trim() : text,
    [],
    "任务失败，请稍后重试",
  );
  const action = firstMatch(head, /\[建议\]\s*(.+)/);
  const requestId = firstMatch(head, /\[请求ID\]\s*([^\n]+)/) || extractRequestId(raw);
  const cleanedHead = head
    .replace(/\n?\[建议\]\s*.+/g, "")
    .replace(/\n?\[请求ID\]\s*.+/g, "")
    .trim();
  if (rawIndex >= 0 && cleanedHead === "输入数量超出当前模型限制。"
    && /(?:^|[=:]\s*|\n)(?:RangeError:\s*)?Maximum call stack size exceeded(?:[.\s]|$)/i.test(raw)) {
    return {
      title: "任务失败",
      message: "任务处理时发生内部错误，请联系管理员核对结果。",
      action: "",
      requestId: requestId || null,
      raw,
      legacyDisplayCorrection: true as const,
    };
  }
  if (rawIndex < 0 && looksLikeRawEnglishError(text)) {
    const friendly = toFriendlyError(text);
    return {
      title: friendly.title,
      message: friendly.message,
      action: friendly.action,
      requestId: friendly.requestId,
      raw: friendly.raw
    };
  }
  const primaryMessage = cleanedHead === UNKNOWN_MESSAGE && raw && raw !== cleanedHead
    ? raw
    : cleanedHead || "任务失败，请稍后重试。";
  return {
    title: "任务失败",
    message: primaryMessage,
    action: action || "",
    requestId: requestId || null,
    raw
  };
}

export function normalizeApiFriendlyError(payload: any, fallback = "任务失败，请稍后重试。") {
  const fromApi = payload?.friendlyError;
  if (fromApi && typeof fromApi === "object") {
    const raw = sanitizeProviderErrorText(
      textOf(fromApi.raw) || textOf(payload?.error) || textOf(fromApi.message) || fallback,
      [],
      fallback,
    );
    const message = textOf(fromApi.message) || toFriendlyError(raw).message || fallback;
    return {
      title: textOf(fromApi.title) || "任务失败",
      message,
      action: textOf(fromApi.action),
      requestId: textOf(fromApi.requestId) || null,
      raw
    };
  }
  const fromError = textOf(payload?.error);
  const parsed = parseFriendlyMessageFromStorage(fromError);
  if (parsed.message) return parsed;
  return {
    title: "任务失败",
    message: fallback,
    action: "",
    requestId: null as string | null,
    raw: sanitizeProviderErrorText(fromError || fallback, [], fallback)
  };
}
import { sanitizeProviderErrorText } from "@/lib/providers/error-safety";
