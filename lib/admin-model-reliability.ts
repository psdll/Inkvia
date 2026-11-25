import { parseFriendlyMessageFromStorage } from "@/lib/error-friendly";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const RAW_ERROR_MARKER = "[原始错误]";

export type AdminModelReliabilitySourceRow = {
  externalProvider: string | null;
  model: string | null;
  type: string;
  status: string;
  errorMsg: string | null;
  createdAt: Date | string;
};

export type AdminModelReliabilityPeriodKey =
  "today" | "last3Days" | "last7Days";

type ReliabilitySeriesPoint = {
  key: string;
  label: string;
  failedCount: number;
  completedCount: number;
  failureRate: number | null;
};

type ReliabilityModelRow = {
  provider: string;
  model: string;
  failedCount: number;
  completedCount: number;
  failureRate: number | null;
};

type ReliabilityErrorRow = {
  provider: string;
  rawError: string;
  count: number;
  models: string[];
};

export type AdminModelReliabilityPeriod = {
  key: AdminModelReliabilityPeriodKey;
  label: string;
  failedCount: number;
  completedCount: number;
  failureRate: number;
  unavailableRawErrorCount: number;
  series: ReliabilitySeriesPoint[];
  models: ReliabilityModelRow[];
  errors: ReliabilityErrorRow[];
};

export type AdminModelReliability = {
  generatedAt: string;
  periods: AdminModelReliabilityPeriod[];
};

function shiftedDate(value: Date) {
  return new Date(value.getTime() + SHANGHAI_OFFSET_MS);
}

function shanghaiDayKey(value: Date) {
  return shiftedDate(value).toISOString().slice(0, 10);
}

function shanghaiHour(value: Date) {
  return shiftedDate(value).getUTCHours();
}

function dayStartMs(day: string) {
  return Date.parse(`${day}T00:00:00+08:00`);
}

function addDays(day: string, amount: number) {
  const value = new Date(dayStartMs(day) + amount * 24 * 60 * 60 * 1000);
  return shanghaiDayKey(value);
}

function recentDayKeys(now: Date, count: number) {
  const today = shanghaiDayKey(now);
  return Array.from({ length: count }, (_, index) =>
    addDays(today, index - (count - 1)),
  );
}

function roundRate(failedCount: number, completedCount: number) {
  if (!completedCount) return 0;
  return Math.round((failedCount / completedCount) * 1000) / 10;
}

function modelIdentity(row: AdminModelReliabilitySourceRow) {
  return {
    provider: String(row.externalProvider || "").trim() || "未标注平台",
    model: String(row.model || "").trim() || "未标注模型",
  };
}

function modelKey(provider: string, model: string) {
  return `${provider}\u0000${model}`;
}

function rawProviderError(errorMsg: string | null) {
  const stored = String(errorMsg || "");
  if (!stored.includes(RAW_ERROR_MARKER)) return null;
  const raw = parseFriendlyMessageFromStorage(stored).raw.trim();
  return raw || null;
}

function periodSeries(
  key: AdminModelReliabilityPeriodKey,
  now: Date,
  rows: Array<AdminModelReliabilitySourceRow & { createdAtMs: number }>,
): ReliabilitySeriesPoint[] {
  if (key === "today") {
    const today = shanghaiDayKey(now);
    return Array.from({ length: shanghaiHour(now) + 1 }, (_, hour) => {
      const matching = rows.filter(
        (row) =>
          shanghaiDayKey(new Date(row.createdAtMs)) === today &&
          shanghaiHour(new Date(row.createdAtMs)) === hour,
      );
      const failedCount = matching.filter(
        (row) => row.status === "failed",
      ).length;
      const completedCount = matching.length;
      return {
        key: `${today}T${String(hour).padStart(2, "0")}`,
        label: `${String(hour).padStart(2, "0")}:00`,
        failedCount,
        completedCount,
        failureRate: completedCount
          ? roundRate(failedCount, completedCount)
          : null,
      };
    });
  }

  const days = recentDayKeys(now, key === "last3Days" ? 3 : 7);
  return days.map((day) => {
    const matching = rows.filter(
      (row) => shanghaiDayKey(new Date(row.createdAtMs)) === day,
    );
    const failedCount = matching.filter(
      (row) => row.status === "failed",
    ).length;
    const completedCount = matching.length;
    return {
      key: day,
      label: `${day.slice(5, 7)}/${day.slice(8, 10)}`,
      failedCount,
      completedCount,
      failureRate: completedCount
        ? roundRate(failedCount, completedCount)
        : null,
    };
  });
}

export function getAdminModelReliabilityWindowStart(now = new Date()) {
  return new Date(dayStartMs(recentDayKeys(now, 7)[0]));
}

export function buildAdminModelReliability(
  sourceRows: AdminModelReliabilitySourceRow[],
  now = new Date(),
): AdminModelReliability {
  const nowMs = now.getTime();
  const windowStartMs = getAdminModelReliabilityWindowStart(now).getTime();
  const rows = sourceRows
    .map((row) => ({
      ...row,
      type: String(row.type || "").toLowerCase(),
      status: String(row.status || "").toLowerCase(),
      createdAtMs:
        row.createdAt instanceof Date
          ? row.createdAt.getTime()
          : new Date(row.createdAt).getTime(),
    }))
    .filter(
      (row) =>
        row.type !== "import" &&
        (row.status === "success" || row.status === "failed") &&
        Number.isFinite(row.createdAtMs) &&
        row.createdAtMs >= windowStartMs &&
        row.createdAtMs <= nowMs,
    );

  const allModels = new Map<string, { provider: string; model: string }>();
  for (const row of rows) {
    const identity = modelIdentity(row);
    allModels.set(modelKey(identity.provider, identity.model), identity);
  }

  const periodDefinitions: Array<{
    key: AdminModelReliabilityPeriodKey;
    label: string;
    startMs: number;
  }> = [
    {
      key: "today",
      label: "今天",
      startMs: dayStartMs(recentDayKeys(now, 1)[0]),
    },
    {
      key: "last3Days",
      label: "近 3 天",
      startMs: dayStartMs(recentDayKeys(now, 3)[0]),
    },
    { key: "last7Days", label: "近 7 天", startMs: windowStartMs },
  ];

  const periods = periodDefinitions.map(
    (definition): AdminModelReliabilityPeriod => {
      const periodRows = rows.filter(
        (row) => row.createdAtMs >= definition.startMs,
      );
      const modelCounts = new Map<
        string,
        {
          provider: string;
          model: string;
          failedCount: number;
          completedCount: number;
        }
      >();
      for (const identity of allModels.values()) {
        modelCounts.set(modelKey(identity.provider, identity.model), {
          ...identity,
          failedCount: 0,
          completedCount: 0,
        });
      }

      const errorCounts = new Map<
        string,
        {
          provider: string;
          rawError: string;
          count: number;
          models: Set<string>;
        }
      >();
      let unavailableRawErrorCount = 0;
      for (const row of periodRows) {
        const identity = modelIdentity(row);
        const counts = modelCounts.get(
          modelKey(identity.provider, identity.model),
        )!;
        counts.completedCount += 1;
        if (row.status !== "failed") continue;
        counts.failedCount += 1;

        const rawError = rawProviderError(row.errorMsg);
        if (!rawError) {
          unavailableRawErrorCount += 1;
          continue;
        }
        const key = `${identity.provider}\u0000${rawError}`;
        const error = errorCounts.get(key) || {
          provider: identity.provider,
          rawError,
          count: 0,
          models: new Set<string>(),
        };
        error.count += 1;
        error.models.add(identity.model);
        errorCounts.set(key, error);
      }

      const models = Array.from(
        modelCounts.values(),
        (row): ReliabilityModelRow => ({
          ...row,
          failureRate: row.completedCount
            ? roundRate(row.failedCount, row.completedCount)
            : null,
        }),
      ).sort((left, right) => {
        if (left.failureRate === null && right.failureRate !== null) return 1;
        if (left.failureRate !== null && right.failureRate === null) return -1;
        return (
          (right.failureRate || 0) - (left.failureRate || 0) ||
          right.completedCount - left.completedCount ||
          left.provider.localeCompare(right.provider, "zh-CN") ||
          left.model.localeCompare(right.model, "zh-CN")
        );
      });
      const errors = Array.from(
        errorCounts.values(),
        (row): ReliabilityErrorRow => ({
          provider: row.provider,
          rawError: row.rawError,
          count: row.count,
          models: Array.from(row.models).sort((left, right) =>
            left.localeCompare(right, "zh-CN"),
          ),
        }),
      ).sort(
        (left, right) =>
          right.count - left.count ||
          left.provider.localeCompare(right.provider, "zh-CN") ||
          left.rawError.localeCompare(right.rawError, "zh-CN"),
      );
      const failedCount = periodRows.filter(
        (row) => row.status === "failed",
      ).length;
      const completedCount = periodRows.length;

      return {
        key: definition.key,
        label: definition.label,
        failedCount,
        completedCount,
        failureRate: roundRate(failedCount, completedCount),
        unavailableRawErrorCount,
        series: periodSeries(definition.key, now, periodRows),
        models,
        errors,
      };
    },
  );

  return { generatedAt: now.toISOString(), periods };
}
