import {
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
} from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

type Environment = Record<string, string | undefined>;
type NodeSdkConfig = NonNullable<ConstructorParameters<typeof NodeSDK>[0]>;
type NodeSdkLike = Pick<NodeSDK, "start" | "shutdown">;

type StartNodeTracingOptions = {
  env?: Environment;
  sdkFactory?: (config: NodeSdkConfig) => NodeSdkLike;
  shutdownTimeoutMs?: number;
};

export type PersistedTraceContext = {
  traceparent: string;
};

const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const SAFE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const SAFE_VERSION_PATTERN = /^[a-z0-9][a-z0-9._+-]{0,63}$/i;
const ALLOWED_SPAN_ATTRIBUTES = new Set([
  "worker.role",
  "operation.type",
  "provider.name",
  "ai.model",
  "release.version",
  "result.status",
]);
const TRACING_STATE = Symbol.for("inkvia.monitoring.node-tracing");

type TracingState = {
  stop: () => Promise<boolean>;
};

function tracingGlobal() {
  return globalThis as typeof globalThis & {
    [TRACING_STATE]?: TracingState;
  };
}

function safeName(value: string, fallback: string) {
  const normalized = String(value || "").trim();
  return SAFE_NAME_PATTERN.test(normalized) ? normalized : fallback;
}

function safeVersion(value: string | undefined) {
  const normalized = String(value || "").trim();
  return SAFE_VERSION_PATTERN.test(normalized) ? normalized : "unknown";
}

function safeEnvironment(value: string | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["development", "test", "staging", "production", "local"].includes(normalized)
    ? normalized
    : "unknown";
}

function traceEndpoint(env: Environment) {
  const raw = String(
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
      || env.OTEL_EXPORTER_OTLP_ENDPOINT
      || "http://127.0.0.1:4318/v1/traces",
  ).trim();
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function createTracingResourceAttributes(serviceName: string, env: Environment = process.env) {
  return {
    [ATTR_SERVICE_NAME]: safeName(serviceName, "inkvia-node"),
    [ATTR_SERVICE_NAMESPACE]: "inkvia",
    [ATTR_SERVICE_VERSION]: safeVersion(env.APP_VERSION || env.npm_package_version),
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: safeEnvironment(
      env.DEPLOYMENT_ENVIRONMENT || env.NODE_ENV,
    ),
  };
}

export function sanitizeMonitoringSpanAttributes(
  input: Record<string, unknown>,
): Attributes {
  const output: Attributes = {};
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED_SPAN_ATTRIBUTES.has(key)) continue;
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      output[key] = value;
      continue;
    }
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (!normalized || normalized.length > 128 || /[\r\n\u0000-\u001f]/.test(normalized)) {
      continue;
    }
    output[key] = normalized;
  }
  return output;
}

export function injectTraceContext(
  source: Context = ROOT_CONTEXT,
): PersistedTraceContext | null {
  const spanContext = trace.getSpanContext(source);
  if (!spanContext || !trace.isSpanContextValid(spanContext)) return null;
  const flags = (spanContext.traceFlags & 0xff).toString(16).padStart(2, "0");
  return {
    traceparent: `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`,
  };
}

export function extractTraceContext(value: unknown): Context | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const traceparent = (value as Record<string, unknown>).traceparent;
  if (typeof traceparent !== "string") return null;
  const match = TRACEPARENT_PATTERN.exec(traceparent.trim().toLowerCase());
  if (!match) return null;
  const [, traceId, spanId, rawFlags] = match;
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return null;
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId,
    spanId,
    traceFlags: Number.parseInt(rawFlags, 16) & 0x01,
    isRemote: true,
  });
}

export async function shutdownWithTimeout(
  shutdown: () => Promise<void>,
  timeoutMs: number,
) {
  const boundedTimeout = Math.max(1, Math.min(Math.floor(timeoutMs), 30_000));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(shutdown).then(() => true, () => false),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), boundedTimeout);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function startNodeTracing(
  serviceName: string,
  options: StartNodeTracingOptions = {},
) {
  const env = options.env || process.env;
  if (env.MONITORING_TRACING_ENABLED !== "1") {
    return async () => true;
  }

  const state = tracingGlobal()[TRACING_STATE];
  if (state) return state.stop;

  const endpoint = traceEndpoint(env);
  if (!endpoint) {
    console.warn("[monitoring] OpenTelemetry endpoint is invalid; tracing is disabled");
    return async () => false;
  }

  try {
    const sdkFactory = options.sdkFactory || ((config: NodeSdkConfig) => new NodeSDK(config));
    const sdk = sdkFactory({
      resource: resourceFromAttributes(createTracingResourceAttributes(serviceName, env)),
      traceExporter: new OTLPTraceExporter({
        url: endpoint,
        timeoutMillis: 5_000,
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          "@opentelemetry/instrumentation-fs": { enabled: false },
          "@opentelemetry/instrumentation-http": { enabled: false },
          "@opentelemetry/instrumentation-undici": { enabled: false },
          "@opentelemetry/instrumentation-openai": { enabled: false },
        }),
      ],
    });
    sdk.start();

    let shutdownPromise: Promise<boolean> | null = null;
    const stop = () => {
      shutdownPromise ||= shutdownWithTimeout(
        () => sdk.shutdown(),
        options.shutdownTimeoutMs || 5_000,
      );
      return shutdownPromise;
    };
    tracingGlobal()[TRACING_STATE] = { stop };
    return stop;
  } catch (error) {
    console.warn(
      "[monitoring] OpenTelemetry initialization failed; application startup will continue",
      error instanceof Error ? error.message : "unknown error",
    );
    return async () => false;
  }
}

export async function withMonitoringSpan<T>(
  name: string,
  attributes: Record<string, unknown>,
  operation: () => Promise<T>,
) {
  const safeSpanName = safeName(name, "monitoring.operation");
  return trace.getTracer("inkvia-monitoring").startActiveSpan(
    safeSpanName,
    { attributes: sanitizeMonitoringSpanAttributes(attributes) },
    async (span) => {
      try {
        const result = await operation();
        span.setAttribute("result.status", "success");
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.setAttribute("result.status", "failed");
        span.setStatus({ code: SpanStatusCode.ERROR, message: "operation failed" });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
