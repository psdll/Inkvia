import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildModelFailurePeriods,
  getModelFailureWindowStart,
} from "@/lib/admin-model-failure";

const now = new Date(2026, 6, 10, 12, 0, 0);
const routeSource = readFileSync(resolve(process.cwd(), "app/api/admin/user/route.ts"), "utf8");

describe("admin model failure analysis", () => {
  it("builds inclusive today, three-day, and seven-day periods", () => {
    const periods = buildModelFailurePeriods(
      [
        { model: "model-a", status: "failed", createdAt: new Date(2026, 6, 10, 1) },
        { model: "model-a", status: "success", createdAt: new Date(2026, 6, 10, 2) },
        { model: "model-b", status: "success", createdAt: new Date(2026, 6, 9, 2) },
        { model: "model-c", status: "failed", createdAt: new Date(2026, 6, 4, 0) },
      ],
      now
    );

    expect(periods.map((period) => period.key)).toEqual(["today", "last3Days", "last7Days"]);
    expect(periods[0]).toMatchObject({ failedCount: 1, completedCount: 2, failureRate: 50 });
    expect(periods[1]).toMatchObject({ failedCount: 1, completedCount: 3, failureRate: 33 });
    expect(periods[2]).toMatchObject({ failedCount: 2, completedCount: 4, failureRate: 50 });
  });

  it("excludes imports, non-terminal statuses, invalid timestamps, future rows, and rows before the window", () => {
    const periods = buildModelFailurePeriods(
      [
        { model: "kept", status: "success", createdAt: new Date(2026, 6, 10, 1) },
        { model: "ignored-import", status: "failed", type: "import", createdAt: new Date(2026, 6, 10, 2) },
        { model: "ignored-pending", status: "pending", createdAt: new Date(2026, 6, 10, 3) },
        { model: "ignored-cancelled", status: "cancelled", createdAt: new Date(2026, 6, 10, 4) },
        { model: "ignored-invalid", status: "failed", createdAt: "not-a-date" },
        { model: "ignored-future", status: "failed", createdAt: new Date(2026, 6, 10, 13) },
        { model: "ignored-old", status: "failed", createdAt: new Date(2026, 6, 3, 23, 59, 59) },
      ],
      now
    );

    expect(getModelFailureWindowStart(now)).toEqual(new Date(2026, 6, 4, 0, 0, 0, 0));
    expect(periods[2].completedCount).toBe(1);
    expect(periods[2].models.map((row) => row.model)).toEqual(["kept"]);
  });

  it("keeps zero-failure models and groups blank names under 未标注", () => {
    const periods = buildModelFailurePeriods(
      [
        { model: "healthy-model", status: "success", createdAt: new Date(2026, 6, 10, 1) },
        { model: " ", status: "failed", createdAt: new Date(2026, 6, 10, 2) },
        { model: null, status: "success", createdAt: new Date(2026, 6, 10, 3) },
      ],
      now
    );

    expect(periods[0].models).toContainEqual({
      model: "healthy-model",
      failedCount: 0,
      completedCount: 1,
      failureRate: 0,
    });
    expect(periods[0].models).toContainEqual({
      model: "未标注",
      failedCount: 1,
      completedCount: 2,
      failureRate: 50,
    });
  });

  it("sorts by failure rate, completed calls, and then model name", () => {
    const periods = buildModelFailurePeriods(
      [
        { model: "beta", status: "failed", createdAt: new Date(2026, 6, 10, 1) },
        { model: "beta", status: "success", createdAt: new Date(2026, 6, 10, 2) },
        { model: "alpha", status: "failed", createdAt: new Date(2026, 6, 10, 3) },
        { model: "alpha", status: "success", createdAt: new Date(2026, 6, 10, 4) },
        { model: "heavy", status: "failed", createdAt: new Date(2026, 6, 10, 5) },
        { model: "heavy", status: "success", createdAt: new Date(2026, 6, 10, 6) },
        { model: "heavy", status: "success", createdAt: new Date(2026, 6, 10, 7) },
        { model: "heavy", status: "success", createdAt: new Date(2026, 6, 10, 8) },
      ],
      now
    );

    expect(periods[0].models.map((row) => row.model)).toEqual(["alpha", "beta", "heavy"]);
  });

  it("derives model failure periods from scoped SQL aggregates", () => {
    const aggregateSource = readFileSync(resolve(process.cwd(), "lib/admin/analysis-aggregates.ts"), "utf8");
    expect(routeSource).toContain("loadAdminAnalysisTrends(scopeInfo, modelFailureNow)");
    expect(aggregateSource).toContain('WHERE ${generationScope(scope)}');
    expect(aggregateSource).toContain("GROUP BY day, model, type, status");
    expect(aggregateSource).toContain("modelFailurePeriods:buildModelFailurePeriods(modelDays.map(");
    expect(routeSource).toContain("modelFailurePeriods,");
  });
});
