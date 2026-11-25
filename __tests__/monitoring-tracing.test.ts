import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";

import {
  createTracingResourceAttributes,
  extractTraceContext,
  injectTraceContext,
  sanitizeMonitoringSpanAttributes,
  shutdownWithTimeout,
  startNodeTracing,
} from "@/lib/monitoring/tracing";

describe("monitoring tracing", () => {
  it("loads the Node SDK only in the Next.js Node runtime", () => {
    const source = readFileSync(join(process.cwd(), "instrumentation.ts"), "utf8");

    expect(source).toContain('process.env.NEXT_RUNTIME === "nodejs"');
    expect(source).toContain('import("./instrumentation.node")');
    expect(source).toContain("getUploadsDir");
    expect(source).toContain("startBackgroundJobs");
    expect(source).toContain('process.env.NODE_ENV === "development"');
    expect(source).toContain('process.env.INKVIA_DEV_WEB_ONLY === "1"');
    expect(source).toContain("if (!isWebOnlyDevelopment)");
  });

  it("uses only reviewed resource and business span attributes", () => {
    expect(createTracingResourceAttributes("inkvia-web", {
      APP_VERSION: "7.2.0",
      DEPLOYMENT_ENVIRONMENT: "production",
      SECRET_TOKEN: "must-not-appear",
      USER_UPLOAD_PATH: "/private/file",
    })).toEqual({
      "service.name": "inkvia-web",
      "service.namespace": "inkvia",
      "service.version": "7.2.0",
      "deployment.environment.name": "production",
    });

    expect(sanitizeMonitoringSpanAttributes({
      "worker.role": "generation",
      "operation.type": "batch",
      prompt: "secret prompt",
      token: "secret token",
      path: "/private/file",
      userId: "123",
    })).toEqual({
      "worker.role": "generation",
      "operation.type": "batch",
    });
  });

  it("round-trips valid W3C traceparent and rejects persisted invalid context", () => {
    const sourceContext = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      traceFlags: 1,
      isRemote: false,
    });

    const persisted = injectTraceContext(sourceContext);
    expect(persisted).toEqual({
      traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
    });
    expect(trace.getSpanContext(extractTraceContext(persisted)!)).toMatchObject({
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      traceFlags: 1,
      isRemote: true,
    });

    for (const invalid of [
      null,
      {},
      { traceparent: "garbage" },
      { traceparent: "00-00000000000000000000000000000000-b7ad6b7169203331-01" },
      { traceparent: "00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01" },
      { traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-xx" },
    ]) {
      expect(extractTraceContext(invalid)).toBeNull();
    }
  });

  it("initializes the SDK once and uses allowlisted resource data", async () => {
    const start = vi.fn();
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const sdkFactory = vi.fn((_config: any) => ({ start, shutdown }));
    const env = {
      MONITORING_TRACING_ENABLED: "1",
      APP_VERSION: "7.2.0",
      DEPLOYMENT_ENVIRONMENT: "test",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://127.0.0.1:4318/v1/traces",
    };

    const stopA = startNodeTracing("inkvia-test", { env, sdkFactory });
    const stopB = startNodeTracing("inkvia-test", { env, sdkFactory });

    expect(stopA).toBe(stopB);
    expect(start).toHaveBeenCalledTimes(1);
    expect(sdkFactory).toHaveBeenCalledTimes(1);
    expect(sdkFactory.mock.calls[0][0].resource.attributes).toEqual({
      "service.name": "inkvia-test",
      "service.namespace": "inkvia",
      "service.version": "7.2.0",
      "deployment.environment.name": "test",
    });

    expect(await stopA()).toBe(true);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("bounds shutdown when an exporter never returns", async () => {
    const never = new Promise<void>(() => undefined);
    const started = Date.now();

    expect(await shutdownWithTimeout(() => never, 15)).toBe(false);
    expect(Date.now() - started).toBeLessThan(250);
  });

  it("starts tracing before Canvas Worker application modules and creates a safe batch span", () => {
    const source = readFileSync(join(process.cwd(), "scripts", "canvas-worker.ts"), "utf8");

    expect(source).toContain("startNodeTracing");
    expect(source).toContain("withMonitoringSpan");
    expect(source.indexOf("startNodeTracing")).toBeLessThan(source.indexOf('import("@/lib/prisma")'));
    expect(source).not.toContain('"prompt"');
    expect(source).not.toContain('"path"');
  });
});
