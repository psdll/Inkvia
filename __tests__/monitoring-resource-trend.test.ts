import { describe, expect, it } from "vitest";
import { buildResourceTrend } from "@/lib/monitoring/resource-trend";

describe("resource trend scale and missing samples", () => {
  it("keeps a small percentage change small and uses actual sample times", () => {
    const result = buildResourceTrend([
      { timestamp: 90_000, value: 8 },
      { timestamp: 0, value: 7 },
      { timestamp: 30_000, value: 7.5 },
    ]);
    expect(result.segments[0].path).toBe("M 0.00 93.00 L 100.00 92.50 L 300.00 92.00");
  });

  it("leaves a gap across missed scrapes and invalid readings", () => {
    const values = [20, 21, NaN, 22, 23];
    const result = buildResourceTrend(values.map((value, i) => ({ timestamp: i * 60_000, value })));
    expect(result.segments).toHaveLength(2);
    const missing = buildResourceTrend([0, 60_000, 240_000, 300_000].map((timestamp) => ({ timestamp, value: 20 })));
    expect(missing.segments).toHaveLength(2);
  });

  it("accepts the coarser query interval and does not invent a line for one sample", () => {
    expect(buildResourceTrend([{ timestamp: 0, value: 20 }, { timestamp: 300_000, value: 30 }], 300_000).segments).toHaveLength(1);
    expect(buildResourceTrend([{ timestamp: 0, value: 0 }]).segments).toEqual([]);
    expect(buildResourceTrend([{ timestamp: 0, value: -1 }, { timestamp: 60_000, value: 101 }]).segments).toEqual([]);
  });
});
