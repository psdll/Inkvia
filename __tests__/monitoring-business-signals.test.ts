import { describe, expect, it } from "vitest";

import { buildBusinessSignalModels } from "@/lib/monitoring/business-signal-view-model";

const NOW = Date.parse("2026-08-14T08:00:00.000Z");

describe("monitoring business signal models", () => {
  it("formats the five production signals without inventing thresholds", () => {
    const models = buildBusinessSignalModels({
      mode: "production",
      historySupported: true,
      evidenceAvailable: true,
      checkedAt: NOW,
      series: {
        "web.http.rate": [{ timestamp: NOW - 1_000, value: 12.34 }],
        "web.http.error.rate": [{ timestamp: NOW - 1_000, value: 1.25 }],
        "web.http.p95": [{ timestamp: NOW - 1_000, value: 0.42 }],
        "worker.queue.length": [{ timestamp: NOW - 1_000, value: 245 }],
        "worker.oldest.seconds": [{ timestamp: NOW - 1_000, value: 95 }],
      },
      errors: {},
    });

    expect(models.map((model) => model.valueLabel)).toEqual([
      "12.34 次/秒",
      "1.25%",
      "420 毫秒",
      "245",
      "1.6 分钟",
    ]);
    expect(models.every((model) => model.state === "available")).toBe(true);
  });

  it("distinguishes local unsupported, missing, and invalid data from zero", () => {
    const local = buildBusinessSignalModels({
      mode: "local-light",
      historySupported: false,
      evidenceAvailable: true,
      checkedAt: NOW,
      series: {},
      errors: {},
    });
    const production = buildBusinessSignalModels({
      mode: "production",
      historySupported: true,
      evidenceAvailable: true,
      checkedAt: NOW,
      series: { "web.http.error.rate": [{ timestamp: NOW - 1_000, value: 101 }] },
      errors: {},
    });

    expect(local.every((model) => model.valueLabel === "—" && model.state === "unsupported")).toBe(true);
    expect(local[0].statusLabel).toBe("线上监控接入后可用");
    expect(production[0]).toMatchObject({ valueLabel: "—", state: "unavailable", statusLabel: "暂无样本" });
    expect(production[1]).toMatchObject({ valueLabel: "—", state: "unavailable", statusLabel: "采集值异常" });
  });

  it("preserves the last value and labels failed or stale evidence", () => {
    const failed = buildBusinessSignalModels({
      mode: "production",
      historySupported: true,
      evidenceAvailable: true,
      checkedAt: NOW,
      series: { "web.http.rate": [{ timestamp: NOW - 1_000, value: 4 }] },
      errors: { "web.http.rate": "Prometheus 查询失败 (503)" },
    });
    const stale = buildBusinessSignalModels({
      mode: "production",
      historySupported: true,
      evidenceAvailable: false,
      checkedAt: NOW,
      series: { "web.http.rate": [{ timestamp: NOW - 1_000, value: 4 }] },
      errors: {},
    });

    expect(failed[0]).toMatchObject({ valueLabel: "4.00 次/秒", state: "error", statusLabel: "刷新失败" });
    expect(failed[0].detail).toContain("上次成功数据");
    expect(stale[0]).toMatchObject({ valueLabel: "4.00 次/秒", state: "stale", statusLabel: "数据已过期" });
  });
});
