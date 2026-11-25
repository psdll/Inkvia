import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRawUnsafe: mocks.query,
    appSetting: {
      findUnique: mocks.findUnique,
      findMany: mocks.findMany,
    },
  },
}));

vi.mock("@/lib/admin-observability", () => ({
  getAdminMetricSnapshot: () => ({ latencies: {}, caches: {} }),
}));

vi.mock("@/lib/thumbnail-cache", () => ({
  thumbnailCache: {
    getMetrics: () => ({ hits: 0, misses: 0, queueLength: 0 }),
  },
}));

vi.mock("@/lib/canvas/observability", () => ({
  canvasMetrics: { formatPrometheus: () => "" },
}));

import { GET } from "@/app/api/internal/admin-metrics/route";

describe("internal admin metrics", () => {
  beforeEach(() => {
    process.env.INTERNAL_METRICS_TOKEN = "test-token";
    mocks.query.mockReset()
      .mockResolvedValueOnce([{
        backlog_count: BigInt(0),
        oldest_at: null,
        exhausted_count: BigInt(0),
      }])
      .mockResolvedValueOnce([{
        queue_length: BigInt(0),
        oldest_wait_ms: 0,
        submission_unknown: BigInt(0),
        projection_mismatch: BigInt(0),
      }])
      .mockResolvedValueOnce([{
        compaction_backlog: BigInt(0),
        snapshot_bytes: BigInt(0),
        media_gc_backlog: BigInt(0),
      }])
      .mockResolvedValueOnce([{
        used_connections: BigInt(0),
        max_connections: 100,
      }]);
    mocks.findUnique.mockReset().mockResolvedValue(null);
    mocks.findMany.mockReset().mockResolvedValue([]);
  });

  it("exports raw Web process memory gauges", async () => {
    const response = await GET(new Request(
      "http://localhost/api/internal/admin-metrics",
      { headers: { authorization: "Bearer test-token" } },
    ) as any);
    const text = await response.text();

    expect(response.status).toBe(200);
    for (const name of [
      "inkvia_web_heap_used_bytes",
      "inkvia_web_heap_limit_bytes",
      "inkvia_web_resident_memory_bytes",
    ]) {
      expect(text).toContain(`# TYPE ${name} gauge`);
      const value = Number(text.match(new RegExp(`^${name} (\\d+)$`, "m"))?.[1]);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });
});
