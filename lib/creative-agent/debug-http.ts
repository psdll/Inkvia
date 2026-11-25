import "server-only";
import { currentCreativeTrace, newDebugSpan, recordCreativeDebug, rememberDebugSecrets } from "./debug-trace";
import { debugSecretsFromHeaders } from "./debug-sanitize";

type DebugRequest = { url: string; method?: string; headers?: unknown; body?: unknown; providerId: string; mode: string };
const parsedBody = (body: unknown) => {
  if (typeof body === "string") { try { return JSON.parse(body); } catch { return body; } }
  if (body && typeof body === "object" && ("pipe" in body || Symbol.asyncIterator in body) && !("entries" in body)) return { __traceOmitted: true, reason: "流式请求体不消费，业务输入见父步骤" };
  return body;
};

export function startDebugHttp(request: DebugRequest) {
  const context = currentCreativeTrace();
  if (!context) return null;
  const headers = Array.isArray(request.headers) ? Object.fromEntries(request.headers) : request.headers;
  rememberDebugSecrets(debugSecretsFromHeaders(headers));
  const spanId = newDebugSpan("http"), start = performance.now();
  const method = (request.method || "GET").toUpperCase();
  const emit = (type: string, status: "running" | "success" | "error" | "unknown", title: string, summary: Record<string, unknown>, detail?: unknown) => recordCreativeDebug({ spanId, parentSpanId: context.spanId, category: "http", type, title, status, summary, detail });
  emit("http.dispatched", "running", `${method} · ${request.providerId}`, { method, url: request.url, providerId: request.providerId, egress: request.mode }, { url: request.url, method, headers, body: parsedBody(request.body), capture: "实际传输层请求，凭据已脱敏；multipart 边界和二进制不展开" });
  return {
    response(status: number, headers: unknown, body?: unknown) {
      emit("http.response", status >= 400 ? "error" : "success", `HTTP ${status}`, { httpStatus: status, elapsedMs: Math.round(performance.now() - start) }, { headers, ...(body === undefined ? {} : { body: parsedBody(body) }) });
    },
    error(error: unknown) {
      const value = (error ?? {}) as { name?: string; code?: string; response?: { status?: number; data?: unknown; headers?: unknown } };
      emit("http.error", value.response?.status ? "error" : "unknown", value.response?.status ? `HTTP ${value.response.status}` : "请求中断，远端执行结果未确认", { httpStatus: value.response?.status, elapsedMs: Math.round(performance.now() - start), code: value.code, errorType: value.name }, value.response ? { body: parsedBody(value.response.data), headers: value.response.headers } : undefined);
    },
    async readJson(response: Response) {
      if (!response.headers.get("content-type")?.includes("json") || !response.body) return;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        reader = response.clone().body!.getReader();
        let size = 0, raw = "", expired = false;
        const decoder = new TextDecoder();
        timer = setTimeout(() => { expired = true; void reader?.cancel().catch(() => undefined); }, 5000);
        while (!expired) {
          const part = await reader.read();
          size += part.value?.byteLength || 0;
          if (size > 2_000_000) { expired = true; break; }
          raw += decoder.decode(part.value, { stream: !part.done });
          if (part.done) break;
        }
        emit("http.body", response.ok ? "success" : "error", "接口响应正文", {}, expired ? { __traceOmitted: true, reason: "响应正文超时或超过 2 MB", size } : { body: parsedBody(raw) });
      } catch { emit("http.body.unavailable", "unknown", "响应正文未完整采集", { recordingGap: true }); }
      finally { clearTimeout(timer); void reader?.cancel().catch(() => undefined); }
    },
  };
}
