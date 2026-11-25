export type ModelFailureSourceRow = {
  model: string | null;
  status: string;
  createdAt: Date | string;
  type?: string;
  count?: number;
};

export type ModelFailureModel = {
  model: string;
  failedCount: number;
  completedCount: number;
  failureRate: number;
};

export type ModelFailurePeriod = {
  key: "today" | "last3Days" | "last7Days";
  label: string;
  failedCount: number;
  completedCount: number;
  failureRate: number;
  models: ModelFailureModel[];
};

function startOfLocalDay(value: Date) {
  const start = new Date(value);
  start.setHours(0, 0, 0, 0);
  return start;
}

function subtractLocalDays(value: Date, days: number) {
  const start = startOfLocalDay(value);
  start.setDate(start.getDate() - days);
  return start;
}

function failureRate(failedCount: number, completedCount: number) {
  return completedCount > 0 ? Math.round((failedCount / completedCount) * 100) : 0;
}

export function getModelFailureWindowStart(now: Date) {
  return subtractLocalDays(now, 6);
}

export function buildModelFailurePeriods(rows: ModelFailureSourceRow[], now = new Date()): ModelFailurePeriod[] {
  const periodDefinitions = [
    { key: "today" as const, label: "今天", start: startOfLocalDay(now) },
    { key: "last3Days" as const, label: "近 3 天", start: subtractLocalDays(now, 2) },
    { key: "last7Days" as const, label: "近 7 天", start: getModelFailureWindowStart(now) },
  ];
  const nowMs = now.getTime();

  return periodDefinitions.map((period) => {
    const models = new Map<string, { failedCount: number; completedCount: number }>();

    for (const row of rows) {
      if (row.type === "import" || (row.status !== "success" && row.status !== "failed")) continue;
      const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
      const createdAtMs = createdAt.getTime();
      if (!Number.isFinite(createdAtMs) || createdAtMs < period.start.getTime() || createdAtMs > nowMs) continue;

      const model = String(row.model || "").trim() || "未标注";
      const current = models.get(model) || { failedCount: 0, completedCount: 0 };
      const count = row.count ?? 1;
      current.completedCount += count;
      if (row.status === "failed") current.failedCount += count;
      models.set(model, current);
    }

    const modelRows = Array.from(models, ([model, counts]) => ({
      model,
      failedCount: counts.failedCount,
      completedCount: counts.completedCount,
      failureRate: failureRate(counts.failedCount, counts.completedCount),
    })).sort(
      (a, b) =>
        b.failureRate - a.failureRate ||
        b.completedCount - a.completedCount ||
        a.model.localeCompare(b.model, "zh-CN")
    );
    const failedCount = modelRows.reduce((sum, row) => sum + row.failedCount, 0);
    const completedCount = modelRows.reduce((sum, row) => sum + row.completedCount, 0);

    return {
      key: period.key,
      label: period.label,
      failedCount,
      completedCount,
      failureRate: failureRate(failedCount, completedCount),
      models: modelRows,
    };
  });
}
