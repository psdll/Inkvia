import {
  sanitizeProviderErrorFields,
  sanitizeProviderErrorText,
} from "@/lib/providers/error-safety";

type ProviderFailureContext = {
  httpStatus: number | null;
  code: string | null;
  requestId: string | null;
  message: string;
  payload: unknown;
};

type ProviderFailureCarrier = Error & {
  __providerFailureContext?: ProviderFailureContext;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function positiveStatus(value: unknown) {
  const status = Number(value || 0);
  return Number.isInteger(status) && status > 0 ? status : null;
}

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function payloadCode(value: unknown) {
  const data = record(value);
  const nested = record(data?.error);
  return (
    clean(nested?.code || data?.code || data?.error_code || data?.errorCode) ||
    null
  );
}

function payloadMessage(value: unknown) {
  const data = record(value);
  const nested = record(data?.error);
  const nestedMessage = clean(
    nested?.message || nested?.msg || nested?.detail || nested?.reason,
  );
  if (nestedMessage) return nestedMessage;
  const topLevel = clean(
    data?.message || data?.msg || data?.detail || data?.reason,
  );
  if (topLevel) return topLevel;
  return typeof data?.error === "string" ? clean(data.error) : "";
}

function payloadRequestId(value: unknown) {
  const data = record(value);
  const nested = record(data?.error);
  return (
    clean(
      nested?.request_id ||
        nested?.requestId ||
        data?.request_id ||
        data?.requestId ||
        data?.requestID ||
        data?.trace_id ||
        data?.traceId,
    ) || null
  );
}

function requestIdFromText(value: string) {
  const match = value.match(
    /(?:request|req|trace)[\s_-]*id[:=\s]+([a-zA-Z0-9_-]{6,})/i,
  );
  return match?.[1] || null;
}

function safePayload(value: unknown) {
  if (value === undefined || value === null) return null;
  return sanitizeProviderErrorFields(value, []);
}

function readProviderFailure(
  error: unknown,
  fallback: string,
): ProviderFailureContext {
  if (typeof error === "string") {
    const message = sanitizeProviderErrorText(error, [], fallback);
    return {
      httpStatus: null,
      code: null,
      requestId: requestIdFromText(message),
      message,
      payload: null,
    };
  }

  const source = record(error);
  const carried = source?.__providerFailureContext as
    ProviderFailureContext | undefined;
  if (carried) return carried;

  const response = record(source?.response);
  const payload = safePayload(
    response?.data ?? source?.providerPayload ?? source?.payload,
  );
  const sourceMessage = clean(source?.message) || fallback;
  const message = sanitizeProviderErrorText(
    payloadMessage(payload) || sourceMessage,
    [],
    fallback,
  );
  const code =
    clean(source?.providerCode || payloadCode(payload) || source?.code) || null;
  const requestId = payloadRequestId(payload) || requestIdFromText(message);

  return {
    httpStatus: positiveStatus(
      response?.status ?? source?.statusCode ?? source?.status,
    ),
    code: code ? sanitizeProviderErrorText(code, [], "") || null : null,
    requestId: requestId
      ? sanitizeProviderErrorText(requestId, [], "") || null
      : null,
    message,
    payload,
  };
}

function payloadJson(value: unknown) {
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export function providerFailureText(error: unknown, fallback = "生成失败") {
  const detail = readProviderFailure(error, fallback);
  const parts = [
    detail.httpStatus ? `HTTP ${detail.httpStatus}` : "",
    detail.code ? `code=${detail.code}` : "",
    detail.requestId ? `requestId=${detail.requestId}` : "",
    `message=${detail.message}`,
    detail.payload ? `payload=${payloadJson(detail.payload)}` : "",
  ].filter(Boolean);

  return sanitizeProviderErrorText(parts.join(" | "), [], fallback);
}

export function attachProviderFailureContext<T extends Error>(
  target: T,
  source: unknown,
): T {
  Object.defineProperty(target, "__providerFailureContext", {
    configurable: true,
    enumerable: false,
    value: readProviderFailure(source, target.message || "生成失败"),
  });
  return target;
}
