"use client";

import { UiProps, UiText, useUiLocale } from "@/i18n/ui";
import { formatUiDate } from "@/i18n/format";
import type { UiLocale } from "@/i18n/locale";


import * as React from "react";
import AdminActivityChart from "./AdminActivityChart";
import AdminActivityTable from "./AdminActivityTable";
import activityStyles from "./admin-activity.module.css";

import type {
  AdminModelReliability,
  AdminModelReliabilityPeriod,
  AdminModelReliabilityPeriodKey,
} from "@/lib/admin-model-reliability";

const EMPTY_RELIABILITY_PERIODS: AdminModelReliabilityPeriod[] = ([
  { key: "today", label: "今天" },
  { key: "last3Days", label: "近 3 天" },
  { key: "last7Days", label: "近 7 天" },
] as const).map((period) => ({
  ...period,
  failedCount: 0,
  completedCount: 0,
  failureRate: 0,
  unavailableRawErrorCount: 0,
  series: [],
  models: [],
  errors: [],
}));

function formatCount(value: number) {
  return Math.max(0, Number(value) || 0).toLocaleString("zh-CN");
}

function formatRate(value: number | null) {
  return value === null ? "—" : `${Number(value).toFixed(1)}%`;
}

function formatGeneratedAt(value: string, locale: UiLocale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale === "en" ? "en-US" : "zh-CN", {
    hour12: locale === "en",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  });
}

function FailureRateTrend({
  series,
  loading = false,
}: {
  series: AdminModelReliabilityPeriod["series"];
  loading?: boolean;
}) {
  const { label: tLabel, locale } = useUiLocale();
  const pointLabel = (point: AdminModelReliabilityPeriod["series"][number]) => {
    if (locale === "zh-CN") return point.label;
    if (/^\d{2}:\d{2}$/.test(point.label)) {
      return formatUiDate(locale, `1970-01-01T${point.label}:00Z`, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
    }
    return /^\d{4}-\d{2}-\d{2}$/.test(point.key)
      ? formatUiDate(locale, `${point.key}T00:00:00Z`, { month: "short", day: "numeric", timeZone: "UTC" })
      : point.label;
  };
  return <UiProps ids={{"title":["admin.mec16ab63cee7"],"emptyText":["admin.m61f1c40640f5","admin.m1ff64227818f"]}}><AdminActivityChart
    title="admin.mec16ab63cee7"
    points={series.map(point => ({ label: pointLabel(point), values: { rate: point.failureRate }, detail: tLabel(`失败 ${formatCount(point.failedCount)} / 完成 ${formatCount(point.completedCount)}`) }))}
    series={[{ key: "rate", label: tLabel("失败率"), color: "#8b5cf6" }]}
    initialType="line"
    formatValue={value => `${value.toFixed(1)}%`}
    showTotal={false}
    allowCumulative={false}
    emptyText={loading ? "admin.m61f1c40640f5" : "admin.m1ff64227818f"}
  /></UiProps>;
}

export default function ModelReliabilityPanel() {
  const { label: tLabel, error: uiError, locale } = useUiLocale();
  const [data, setData] = React.useState<AdminModelReliability | null>(null);
  const [activePeriodKey, setActivePeriodKey] =
    React.useState<AdminModelReliabilityPeriodKey>("today");
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/admin/model-reliability", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as
          AdminModelReliability | { error?: string } | null;
        if (!response.ok || !payload || !("periods" in payload)) {
          throw new Error(
            String(payload && "error" in payload ? payload.error : "读取失败"),
          );
        }
        setData(payload);
      } catch (reason) {
        if (controller.signal.aborted) return;
        setError(
          reason instanceof Error ? reason.message : "读取模型稳定性失败",
        );
      }
    })();
    return () => controller.abort();
  }, []);

  const periods = data?.periods.length ? data.periods : EMPTY_RELIABILITY_PERIODS;
  const activePeriod = periods.find((period) => period.key === activePeriodKey) || periods[0]!;

  return (
    <section
      className={activityStyles.reliability}
      aria-labelledby="model-reliability-heading"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3
            id="model-reliability-heading"
            className="text-[15px] font-semibold text-[var(--app-fg)]"
          ><UiText id="admin.m3eaac8d4920b" /></h3>
          <p className="mt-1 text-[12px] leading-5 text-[var(--app-muted)]"><UiText id="admin.mef722fc22cbb" /></p>
        </div>
        <span className="shrink-0 text-[11px] text-[var(--app-muted)]">
          {data?.generatedAt ? <UiText id="admin.mb854a2861a14" values={{v0: String(formatGeneratedAt(data.generatedAt, locale))}} /> : <UiText id="admin.m9e32f0176e7f" />}
        </span>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-[12px] text-amber-700 dark:text-amber-300"><UiText id="admin.mfa9a3b48eb35" />{uiError(error)}
        </div>
      ) : (
        <>
          <UiProps ids={{"aria-label":["admin.mc338a2edf457"]}}><div
            className="mt-4 grid grid-cols-1 gap-2.5 md:grid-cols-3"
            role="tablist"
            aria-label="admin.mc338a2edf457"
          >
            {periods.map((period) => {
              const active = period.key === activePeriod.key;
              return (
                <button
                  key={period.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActivePeriodKey(period.key)}
                  className={[
                    "rounded-xl border px-3.5 py-3 text-left transition-colors",
                    active
                      ? "border-[var(--primary-bg)] bg-[color-mix(in_srgb,var(--primary-bg)_10%,var(--panel-bg))]"
                      : "border-[var(--border)] bg-[var(--panel-2)]/45 hover:bg-[var(--panel-2)]",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[12px] font-medium text-[var(--app-fg)]">
                      {tLabel(period.label)}
                    </span>
                    <span className="text-[10px] text-[var(--app-muted)]"><UiText id="admin.m96cb3fe533e8" /></span>
                  </div>
                  <div className="mt-1.5 flex items-end justify-between gap-3">
                    <span className={`text-[24px] font-semibold leading-none tabular-nums ${data && period.failedCount > 0 ? "text-rose-600 dark:text-rose-400" : "text-[var(--app-fg)]"}`}>
                      {data && period.completedCount > 0 ? formatRate(period.failureRate) : "—"}
                    </span>
                    <span className="text-[11px] tabular-nums text-[var(--app-muted)]">
                      {data ? `${formatCount(period.failedCount)} / ${formatCount(period.completedCount)}` : "— / —"}
                    </span>
                  </div>
                  {data && period.completedCount === 0 ? <div className="mt-1 text-[11px] text-[var(--app-muted)]"><UiText id="admin.me30aa3f0d4ee" /></div> : null}
                </button>
              );
            })}
          </div></UiProps>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.75fr)]">
            <div className="min-w-0">
              <div className="mb-2 flex items-center justify-between text-[11px] text-[var(--app-muted)]">
                <span><UiText id="admin.ma18ac4463052" /></span><span>{tLabel(activePeriod.label)}</span>
              </div>
              <FailureRateTrend series={activePeriod.series} loading={!data} />
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)]/30 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[12px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m4f20b1f909cd" /></div>
                  <div className="mt-0.5 text-[10px] text-[var(--app-muted)]"><UiText id="admin.m1a0255c6a009" /></div>
                </div>
                <span className="text-[10px] text-[var(--app-muted)]">
                  Top {Math.min(6, activePeriod.errors.length)}
                </span>
              </div>
              <div className="mt-3 max-h-[250px] space-y-2 overflow-y-auto pr-1">
                {activePeriod.errors.slice(0, 6).map((item) => (
                  <details
                    key={`${item.provider}:${item.rawError}`}
                    className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2"
                  >
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-[11px] font-medium text-[var(--app-fg)]">
                          {item.provider}
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-rose-600 dark:text-rose-400">
                          {formatCount(item.count)}<UiText id="admin.mf81526efce19" /></span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-[var(--app-muted)]">
                        {item.rawError}
                      </div>
                    </summary>
                    <div className="mt-2 border-t border-[var(--border)] pt-2">
                      <div className="text-[10px] text-[var(--app-muted)]"><UiText id="admin.m61b04812df04" />{item.models.join("、") || <UiText id="admin.mc883b6ff45bd" />}
                      </div>
                      <pre className="mt-2 whitespace-pre-wrap break-all rounded-md bg-[var(--panel-2)] p-2 text-[10px] leading-4 text-[var(--app-fg)]">
                        {item.rawError}
                      </pre>
                    </div>
                  </details>
                ))}
                {!activePeriod.errors.length ? (
                  <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-6 text-center text-[11px] text-[var(--app-muted)]">
                    {data ? <UiText id="admin.m90ed7c0f15b4" /> : <UiText id="admin.md1bae3c1f2ee" />}
                  </div>
                ) : null}
              </div>
              {activePeriod.unavailableRawErrorCount > 0 ? (
                <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-[10px] leading-4 text-amber-700 dark:text-amber-300">
                  {formatCount(activePeriod.unavailableRawErrorCount)}{" "}<UiText id="admin.m47ae54d57431" /></div>
              ) : null}
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)]">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--panel-2)]/45 px-3 py-2.5">
              <div className="text-[12px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m557cbf1e0909" /></div>
              <div className="text-[10px] text-[var(--app-muted)]"><UiText id="admin.m4adb372d411e" /></div>
            </div>
            <div className="max-h-[340px] overflow-auto">
              <UiProps ids={{"label":["admin.m557cbf1e0909"]}}><AdminActivityTable
                label="admin.m557cbf1e0909"
                columns={[
                  { key: "provider", label: tLabel("平台") }, { key: "model", label: tLabel("模型") },
                  { key: "completed", label: tLabel("完成"), numeric: true }, { key: "failed", label: tLabel("失败"), numeric: true },
                  { key: "rate", label: tLabel("失败率"), numeric: true }, { key: "status", label: tLabel("状态") },
                ]}
                rows={activePeriod.models.map(item => ({ key: `${item.provider}:${item.model}`, cells: {
                  provider: { value: item.provider }, model: { value: item.model },
                  completed: { value: item.completedCount }, failed: { value: item.failedCount },
                  rate: { value: item.failureRate ?? -1, display: formatRate(item.failureRate) },
                  status: { value: item.completedCount ? "已统计" : "本周期无完成调用" },
                } }))}
              /></UiProps>
              {!activePeriod.models.length ? (
                <div className="px-4 py-8 text-center text-[12px] text-[var(--app-muted)]">
                  {data ? <UiText id="admin.m43e06fa399f6" /> : <UiText id="admin.m5a19a2f059b6" />}
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
