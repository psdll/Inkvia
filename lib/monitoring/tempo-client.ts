const SAFE_ATTRIBUTES = new Set([
  "service.name",
  "http.method",
  "http.route",
  "http.status_code",
  "db.system",
  "rpc.system",
  "rpc.service",
  "rpc.method",
  "error.type",
  "error.code",
  "gen_ai.system",
  "gen_ai.request.model",
  "deployment.environment",
  "service.version",
]);

export function normalizeTraceId(value: string) {
  const traceId = String(value || "").trim().toLowerCase();
  if (!/^(?:[a-f0-9]{16}|[a-f0-9]{32})$/.test(traceId)) {
    throw new Error("Trace ID 无效");
  }
  return traceId;
}

function attributeValue(value: any): string | number | boolean | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (typeof value.stringValue === "string") return value.stringValue.slice(0, 256);
  if (typeof value.boolValue === "boolean") return value.boolValue;
  if (typeof value.intValue === "number" || typeof value.intValue === "string") {
    const number = Number(value.intValue);
    return Number.isFinite(number) ? number : undefined;
  }
  if (typeof value.doubleValue === "number" && Number.isFinite(value.doubleValue)) {
    return value.doubleValue;
  }
  return undefined;
}

function safeAttributes(attributes: unknown) {
  if (!Array.isArray(attributes)) return {};
  return Object.fromEntries(attributes.flatMap((attribute: any) => {
    if (!SAFE_ATTRIBUTES.has(attribute?.key)) return [];
    const value = attributeValue(attribute?.value);
    return value === undefined ? [] : [[attribute.key, value]];
  }));
}

export function sanitizeTempoTrace(payload: any) {
  const spans = (Array.isArray(payload?.batches) ? payload.batches : []).flatMap((batch: any) => {
    const resourceAttributes = safeAttributes(batch?.resource?.attributes);
    const service = typeof resourceAttributes["service.name"] === "string"
      ? resourceAttributes["service.name"]
      : "unknown";
    const groups = Array.isArray(batch?.scopeSpans)
      ? batch.scopeSpans
      : Array.isArray(batch?.instrumentationLibrarySpans)
        ? batch.instrumentationLibrarySpans
        : [];
    return groups.flatMap((group: any) => (
      Array.isArray(group?.spans) ? group.spans : []
    )).slice(0, 2_000).map((span: any) => ({
      service,
      traceId: String(span?.traceId || ""),
      spanId: String(span?.spanId || ""),
      parentSpanId: String(span?.parentSpanId || ""),
      name: String(span?.name || "unnamed").slice(0, 256),
      startTimeUnixNano: String(span?.startTimeUnixNano || ""),
      endTimeUnixNano: String(span?.endTimeUnixNano || ""),
      status: span?.status?.code ?? null,
      attributes: safeAttributes(span?.attributes),
    }));
  });
  return { spans };
}

export async function getTraceById(input: {
  endpoint: string;
  traceId: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}) {
  const traceId = normalizeTraceId(input.traceId);
  const url = new URL(`/api/traces/${traceId}`, input.endpoint);
  const response = await (input.fetchImpl || fetch)(url.toString(), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(input.timeoutMs),
    cache: "no-store",
  });
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 8 * 1024 * 1024) throw new Error("Trace 响应过大");
  if (!response.ok) throw new Error(`Tempo 查询失败 (${response.status})`);
  try {
    return { traceId, ...sanitizeTempoTrace(JSON.parse(text)) };
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Tempo 返回了无效数据");
    throw error;
  }
}
