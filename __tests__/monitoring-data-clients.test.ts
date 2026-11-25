import { describe, expect, it, vi } from "vitest";

import {
  metricQueryFor,
  queryPrometheusRange,
} from "@/lib/monitoring/prometheus-client";
import {
  buildSafeLogQuery,
  normalizeLogFilter,
  queryLokiLogs,
} from "@/lib/monitoring/loki-client";
import {
  normalizeTraceId,
  sanitizeTempoTrace,
} from "@/lib/monitoring/tempo-client";

describe("monitoring data clients", () => {
  it("maps public metric keys to fixed server-side PromQL templates", () => {
    expect(metricQueryFor("host.cpu.percent")).toContain("node_cpu_seconds_total");
    expect(metricQueryFor("web.heap.percent")).toBe(
      "100 * inkvia_web_heap_used_bytes / clamp_min(inkvia_web_heap_limit_bytes, 1)",
    );
    expect(() => metricQueryFor("up or vector(1)" as never)).toThrow("不支持的监控指标");
  });

  it("queries Prometheus with a fixed metric key and returns normalized series", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      status: "success",
      data: {
        resultType: "matrix",
        result: [{
          metric: { instance: "server-1", secret: "must-not-leak" },
          values: [[1_722_000_000, "12.5"], [1_722_000_060, "13.25"]],
        }],
      },
    }), { status: 200 }));

    const result = await queryPrometheusRange({
      endpoint: "http://127.0.0.1:9090",
      key: "host.cpu.percent",
      start: 1_722_000_000,
      end: 1_722_000_060,
      stepSeconds: 60,
      timeoutMs: 1_000,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const requestedUrl = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(requestedUrl.pathname).toBe("/api/v1/query_range");
    expect(requestedUrl.searchParams.get("query")).toBe(metricQueryFor("host.cpu.percent"));
    expect(result.series).toEqual([{
      labels: { instance: "server-1" },
      points: [
        { timestamp: 1_722_000_000_000, value: 12.5 },
        { timestamp: 1_722_000_060_000, value: 13.25 },
      ],
    }]);
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });

  it("builds Loki queries from bounded fields without accepting raw LogQL", () => {
    const filter = normalizeLogFilter({
      service: "web",
      level: "error",
      query: `{job=~".+"} | json`,
      limit: "200",
    });
    const query = buildSafeLogQuery(filter);

    expect(query).toContain('{service="web"}');
    expect(query).toContain('| level="error"');
    expect(query).toContain('|=');
    expect(query).not.toContain('{job=~".+"}');
  });

  it("normalizes Loki streams and exposes only approved labels", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      status: "success",
      data: {
        resultType: "streams",
        result: [{
          stream: { service: "web", level: "error", filename: "/secret/app.log" },
          values: [["1722000000000000000", "request failed"]],
        }],
      },
    }), { status: 200 }));

    const result = await queryLokiLogs({
      endpoint: "http://127.0.0.1:3100",
      filter: normalizeLogFilter({ service: "web", limit: "50" }),
      startNanoseconds: "1721999900000000000",
      endNanoseconds: "1722000100000000000",
      timeoutMs: 1_000,
      fetchImpl,
    });

    expect(result.entries).toEqual([{
      timestamp: 1_722_000_000_000,
      line: "request failed",
      labels: { service: "web", level: "error" },
    }]);
    expect(JSON.stringify(result)).not.toContain("/secret/app.log");
  });

  it("validates trace IDs and strips sensitive span attributes", () => {
    expect(normalizeTraceId("ABCDEF0123456789")).toBe("abcdef0123456789");
    expect(normalizeTraceId("abcdef0123456789abcdef0123456789"))
      .toBe("abcdef0123456789abcdef0123456789");
    expect(() => normalizeTraceId("../passwd")).toThrow("Trace ID");

    const sanitized = sanitizeTempoTrace({
      batches: [{
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "web" } },
            { key: "service.instance.id", value: { stringValue: "/srv/secret" } },
          ],
        },
        scopeSpans: [{
          spans: [{
            traceId: "abcdef0123456789",
            spanId: "0123456789abcdef",
            name: "POST /api/canvas",
            startTimeUnixNano: "1722000000000000000",
            endTimeUnixNano: "1722000000100000000",
            attributes: [
              { key: "http.method", value: { stringValue: "POST" } },
              { key: "http.route", value: { stringValue: "/api/canvas" } },
              { key: "gen_ai.prompt", value: { stringValue: "private prompt" } },
              { key: "db.statement", value: { stringValue: "select * from users" } },
              { key: "authorization", value: { stringValue: "Bearer secret" } },
            ],
          }],
        }],
      }],
    });

    expect(sanitized.spans).toEqual([expect.objectContaining({
      service: "web",
      traceId: "abcdef0123456789",
      attributes: {
        "http.method": "POST",
        "http.route": "/api/canvas",
      },
    })]);
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain("private prompt");
    expect(serialized).not.toContain("select * from users");
    expect(serialized).not.toContain("Bearer secret");
    expect(serialized).not.toContain("/srv/secret");
  });
});
