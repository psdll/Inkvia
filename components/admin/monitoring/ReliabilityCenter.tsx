"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import {
  Bot,
  Boxes,
  CircleDollarSign,
  Gauge,
  GitCompareArrows,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

import { DateRangePicker } from "@/components/ui/date-range-picker";
import { FrostedSelect } from "@/components/ui/frosted-select";

import { useRefreshFeedback } from "./useRefreshFeedback";

type CostPayload = {
  currency: string;
  actualAmount: number;
  estimatedAmount: number;
  pricedCount: number;
  estimatedCount: number;
  unpricedCount: number;
  freeCount: number;
  failedCount: number;
  totalRecords: number;
  truncated: boolean;
};

type ProviderPayload = {
  providers: Array<{
    provider: string;
    sampleSize: number;
    successRate: number;
    failureCount: number;
    avgLatencyMs: number;
    confidence: "sufficient" | "insufficient";
    score: number | null;
  }>;
};

type CapacityPayload = {
  usedBytes: number;
  capacityBytes: number;
  usedPercent: number;
  growthBytesPerDay: number | null;
  daysToFull: number | null;
  confidence: "insufficient" | "medium" | "high";
  sampleDays: number;
  samples: Array<{ day: string; totalBytes: number }>;
};

type DeploymentPayload = {
  records: Array<{
    jobId: string;
    fromVersion: string | null;
    toVersion: string | null;
    startedAt: string;
    finishedAt: string | null;
    status: string;
    failedPhase: string | null;
    errorCode: string | null;
    rollbackOutcome: string | null;
  }>;
  comparison: {
    confidence: "sufficient" | "insufficient";
    failureRateBefore: number | null;
    failureRateAfter: number | null;
    failureRateDelta: number | null;
    latencyDeltaPercent: number | null;
  };
};

function ymd(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: currency || "CNY",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function bytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index >= 3 ? 1 : 0)} ${units[index]}`;
}

function EvidenceCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "primary",
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof CircleDollarSign;
  tone?: "primary" | "warning" | "muted";
}) {
  const toneClass = tone === "warning"
    ? "border-amber-500/25 bg-amber-500/10 text-amber-600"
    : tone === "muted"
      ? "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)]"
      : "border-[color-mix(in_srgb,var(--primary-bg)_25%,transparent)] bg-[color-mix(in_srgb,var(--primary-bg)_10%,transparent)] text-[var(--primary-bg)]";
  return (
    <article className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 shadow-sm">
      <div className={`flex h-8 w-8 items-center justify-center rounded-lg border ${toneClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="mt-4 text-[11px] font-medium text-[var(--app-muted)]">{label}</div>
      <div className="mt-1 font-mono text-[22px] font-semibold text-[var(--app-fg)]">{value}</div>
      <div className="mt-2 text-[10px] leading-4 text-[var(--app-muted)]">{detail}</div>
    </article>
  );
}

export function ReliabilityCenter() {
  const { label: tLabel } = useUiLocale();
  const { error: uiError } = useUiLocale();
  const [range, setRange] = React.useState("30");
  const [from, setFrom] = React.useState(ymd(-29));
  const [to, setTo] = React.useState(ymd());
  const [costs, setCosts] = React.useState<CostPayload | null>(null);
  const [providers, setProviders] = React.useState<ProviderPayload | null>(null);
  const [capacity, setCapacity] = React.useState<CapacityPayload | null>(null);
  const [deployments, setDeployments] = React.useState<DeploymentPayload | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const controllerRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    if (range === "custom") return;
    const days = Math.max(7, Math.min(90, Number(range) || 30));
    setFrom(ymd(-(days - 1)));
    setTo(ymd());
  }, [range]);

  const load = React.useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ from, to }).toString();
      const endpoints = [
        `/api/admin/monitoring/v1/costs?${query}`,
        `/api/admin/monitoring/v1/providers?${query}`,
        `/api/admin/monitoring/v1/capacity?${query}`,
        "/api/admin/monitoring/v1/deployments",
      ];
      const payloads = await Promise.all(endpoints.map(async (endpoint) => {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "可靠性数据查询失败");
        return payload;
      }));
      setCosts(payloads[0]);
      setProviders(payloads[1]);
      setCapacity(payloads[2]);
      setDeployments(payloads[3]);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "可靠性数据查询失败");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [from, to]);
  const { refreshing, runRefresh } = useRefreshFeedback(load);
  const refreshPending = loading || refreshing;

  React.useEffect(() => {
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  const comparison = deployments?.comparison;
  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-[14px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m9992bb8af9e8" /></h2>
          <p className="mt-1 text-[11px] text-[var(--app-muted)]"><UiText id="admin.m9b46de5e5821" /></p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <FrostedSelect
            value={range}
            onChange={setRange}
            ariaLabel={tLabel("可靠性时间范围")}
            compact
            side="bottom"
            options={[
              { value: "7", label: tLabel("最近 7 天") },
              { value: "30", label: tLabel("最近 30 天") },
              { value: "90", label: tLabel("最近 90 天") },
              { value: "custom", label: tLabel("自定义") },
            ]}
          />
          <DateRangePicker from={from} to={to} onFromChange={(value) => { setRange("custom"); setFrom(value); }} onToChange={(value) => { setRange("custom"); setTo(value); }} />
          <button type="button" onClick={() => void runRefresh()} disabled={refreshPending} aria-busy={refreshPending} className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[10px] text-[var(--app-muted)] hover:bg-[var(--panel-2)] disabled:cursor-wait">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshPending ? "animate-spin" : ""}`} />{refreshPending ? <UiText id="admin.m7f3c8312816f" /> : <UiText id="admin.maee887434131" />}
          </button>
        </div>
      </section>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[11px] text-rose-600">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />{uiError(error)}
        </div>
      ) : null}

      <section>
        <div className="mb-3">
          <h3 className="text-[13px] font-semibold text-[var(--app-fg)]"><UiText id="admin.mfdebd46821d6" /></h3>
          <p className="mt-1 text-[10px] text-[var(--app-muted)]"><UiText id="admin.mab1c945a7ede" /></p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <UiProps ids={{"label":["admin.m3e68fcfe1831"]}}><EvidenceCard icon={CircleDollarSign} label="admin.m3e68fcfe1831" value={costs ? money(costs.actualAmount, costs.currency) : "—"} detail={`${costs?.pricedCount || 0} 条已定价记录`} /></UiProps>
          <UiProps ids={{"label":["admin.m7712439ae067"]}}><EvidenceCard icon={Gauge} label="admin.m7712439ae067" value={costs ? money(costs.estimatedAmount, costs.currency) : "—"} detail={`${costs?.estimatedCount || 0} 条估算记录`} tone="muted" /></UiProps>
          <UiProps ids={{"label":["admin.m0e4f5c0f3e9e"]}}><EvidenceCard icon={TriangleAlert} label="admin.m0e4f5c0f3e9e" value={String(costs?.unpricedCount ?? "—")} detail="需先补充价格规则，不能计入真实成本" tone={costs?.unpricedCount ? "warning" : "muted"} /></UiProps>
          <UiProps ids={{"label":["admin.m4da9d82778e6"]}}><EvidenceCard icon={Bot} label="admin.m4da9d82778e6" value={String(costs?.totalRecords ?? "—")} detail={costs?.truncated ? "数据量较大，结果已按上限截断" : `${costs?.freeCount || 0} 条免费或不计费`} tone="muted" /></UiProps>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-[var(--primary-bg)]" />
          <h3 className="text-[13px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m3b193b55a231" /></h3>
        </div>
        <div className="mt-4 space-y-3">
          {!providers?.providers.length ? (
            <div className="py-8 text-center text-[11px] text-[var(--app-muted)]"><UiText id="admin.me3f1eef1e58f" /></div>
          ) : providers.providers.map((provider) => (
            <div key={provider.provider} className="grid items-center gap-3 rounded-xl border border-[var(--border)] p-3 md:grid-cols-[150px_1fr_100px_120px]">
              <div>
                <div className="truncate text-[11px] font-semibold text-[var(--app-fg)]">{provider.provider}</div>
                <div className="mt-1 text-[10px] text-[var(--app-muted)]">{provider.sampleSize}<UiText id="admin.m36dc86abeb86" /></div>
              </div>
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--panel-2)]">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, provider.successRate))}%` }} />
                </div>
                <div className="mt-1 text-[10px] text-[var(--app-muted)]"><UiText id="admin.m1357d7666f7b" />{provider.successRate.toFixed(1)}%</div>
              </div>
              <div className="font-mono text-[11px] text-[var(--app-fg)]">{provider.avgLatencyMs} ms</div>
              <div className="text-right text-[10px]">
                {provider.confidence === "insufficient"
                  ? <span className="text-amber-600"><UiText id="admin.m78e0b7c07773" /></span>
                  : <span className="font-semibold text-[var(--primary-bg)]"><UiText id="admin.m1f21c32045a0" />{provider.score}</span>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        <article className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Boxes className="h-4 w-4 text-[var(--primary-bg)]" />
            <h3 className="text-[13px] font-semibold text-[var(--app-fg)]"><UiText id="admin.mca367d74342b" /></h3>
          </div>
          <div className="mt-4 flex items-end justify-between gap-4">
            <div>
              <div className="font-mono text-[24px] font-semibold text-[var(--app-fg)]">{capacity ? `${capacity.usedPercent.toFixed(1)}%` : "—"}</div>
              <div className="mt-1 text-[10px] text-[var(--app-muted)]">{capacity ? `${bytes(capacity.usedBytes)} / ${bytes(capacity.capacityBytes)}` : <UiText id="admin.m5628d8ab742b" />}</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] font-semibold text-[var(--app-fg)]">
                {!capacity
                  ? <UiText id="admin.m5628d8ab742b" />
                  : capacity.confidence === "insufficient"
                    ? <UiText id="admin.m84c6e0168ac5" />
                    : capacity.daysToFull === null
                      ? <UiText id="admin.mf414b05d4893" />
                      : <UiText id="admin.m32f42f7cf531" values={{v0: String(capacity.daysToFull)}} />}
              </div>
              <div className="mt-1 text-[10px] text-[var(--app-muted)]">{capacity?.sampleDays || 0}<UiText id="admin.mb724a6a481a9" /></div>
            </div>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--panel-2)]">
            <div className={`h-full rounded-full ${Number(capacity?.usedPercent || 0) >= 85 ? "bg-rose-500" : Number(capacity?.usedPercent || 0) >= 70 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.max(0, Math.min(100, capacity?.usedPercent || 0))}%` }} />
          </div>
          <p className="mt-3 text-[10px] leading-4 text-[var(--app-muted)]"><UiText id="admin.mfd12946605ef" /></p>
        </article>

        <article className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <GitCompareArrows className="h-4 w-4 text-[var(--primary-bg)]" />
              <h3 className="text-[13px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m7ad7295abd20" /></h3>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-[var(--panel-2)] p-3">
              <div className="text-[10px] text-[var(--app-muted)]"><UiText id="admin.m4975a5f62a2b" /></div>
              <div className="mt-1 font-mono text-[18px] font-semibold text-[var(--app-fg)]">{comparison?.failureRateBefore === null || comparison?.failureRateBefore === undefined ? "—" : `${comparison.failureRateBefore}%`}</div>
            </div>
            <div className="rounded-xl bg-[var(--panel-2)] p-3">
              <div className="text-[10px] text-[var(--app-muted)]"><UiText id="admin.m12bece5b5a97" /></div>
              <div className="mt-1 font-mono text-[18px] font-semibold text-[var(--app-fg)]">{comparison?.failureRateAfter === null || comparison?.failureRateAfter === undefined ? "—" : `${comparison.failureRateAfter}%`}</div>
            </div>
          </div>
          <div className="mt-3 text-[11px] text-[var(--app-muted)]">
            {comparison?.confidence === "sufficient"
              ? <UiText id="admin.m7907ba854444" values={{v0: String(comparison.failureRateDelta! > 0 ? "+" : ""), v1: String(comparison.failureRateDelta)}} />
              : <UiText id="admin.m94067e672a80" />}
          </div>
          <div className="mt-3 max-h-28 space-y-1 overflow-y-auto border-t border-[var(--border)] pt-3">
            {!deployments?.records.length ? (
              <div className="text-[10px] text-[var(--app-muted)]"><UiText id="admin.mf3208952b99f" /></div>
            ) : deployments.records.slice(0, 5).map((record) => (
              <div key={record.jobId} className="flex items-center justify-between gap-3 text-[10px]">
                <span className="truncate text-[var(--app-fg)]">{record.fromVersion || <UiText id="admin.m4d8c1c5b4283" />} → {record.toVersion || <UiText id="admin.m4d8c1c5b4283" />}</span>
                <span className={record.status.toUpperCase() === "SUCCESS" ? "text-emerald-600" : "text-amber-600"}>{record.status}</span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
