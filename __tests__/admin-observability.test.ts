import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getAdminMetricSnapshot,
  observeAdminLatency,
  recordAdminCacheResult,
  resetAdminMetricsForTests,
} from "@/lib/admin-observability";

describe("admin rollout observability", () => {
  beforeEach(() => resetAdminMetricsForTests());

  it("reports API and query p50/p95/p99 plus cache hit ratios", () => {
    for (let value = 1; value <= 100; value += 1) observeAdminLatency("works_api", value);
    observeAdminLatency("works_query", 25);
    recordAdminCacheResult("summary", "hit");
    recordAdminCacheResult("summary", "miss");
    recordAdminCacheResult("summary", "hit");

    const snapshot = getAdminMetricSnapshot();
    expect(snapshot.latencies.works_api).toEqual(expect.objectContaining({ p50: 50, p95: 95, p99: 99 }));
    expect(snapshot.latencies.works_query).toEqual(expect.objectContaining({ p95: 25 }));
    expect(snapshot.caches.summary).toEqual({ hits: 2, misses: 1, hitRate: 2 / 3 });
  });

  it("ships the four required alert thresholds", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "config/monitoring/admin-rollout-alerts.yml"), "utf8");
    expect(source).toContain("AdminWorksApiP95High");
    expect(source).toContain("for: 5m");
    expect(source).toMatch(/admin_works_api_latency_ms\{quantile="0\.95"\}\s*>\s*500/);
    expect(source).toMatch(/admin_event_oldest_age_seconds\s*>\s*30/);
    expect(source).toMatch(/admin_read_model_diff_count\s*>\s*0/);
    expect(source).toMatch(/admin_worker_heartbeat_age_seconds\s*>\s*120/);
  });
});
