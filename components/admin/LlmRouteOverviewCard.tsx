"use client";
import { UiText, useUiLocale } from "@/i18n/ui";


import { formatUiDate } from "@/i18n/format";
import * as React from "react";
import { Loader2, RefreshCw, Route } from "lucide-react";

type RouteCandidate = {
  providerId: string;
  providerName: string;
  modelId: string;
};

type RouteScenario = {
  id: string;
  label: string;
  allowOverride: boolean;
  visual: boolean;
  candidates: RouteCandidate[];
  configured: { providerId: string; modelId: string } | null;
  effective: {
    providerId?: string;
    providerName?: string;
    modelId?: string;
    source?: string;
    status: string;
  };
  lastCall: null | {
    providerId: string | null;
    modelId: string | null;
    routeSource: string | null;
    status: string;
    createdAt: string;
  };
};

export function LlmRouteOverviewCard() {
  const { error: uiError, label: uiLabel, text, locale } = useUiLocale();
  const [scenarios, setScenarios] = React.useState<RouteScenario[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/llm-routes", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.error || `HTTP ${response.status}`);
      setScenarios(Array.isArray(payload.scenarios) ? payload.scenarios : []);
    } catch (reason: any) {
      setError(String(reason?.message || reason));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    const handleRoutesChanged = () => void load();
    window.addEventListener("llm-routes-changed", handleRoutesChanged);
    return () => window.removeEventListener("llm-routes-changed", handleRoutesChanged);
  }, [load]);

  return (
    <section className="rounded-3xl border border-[var(--border)] bg-[var(--panel-bg)] p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-[var(--app-fg)]">
            <Route className="h-4 w-4" /><UiText id="admin.mf6d02879fe32" /></h3>
          <p className="mt-2 text-[12px] text-[var(--app-muted)]"><UiText id="admin.m9eca0c0c911f" /></p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-4 text-[13px] text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}<UiText id="admin.maee887434131" /></button>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-600 dark:text-red-400">
          {uiError(error)}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {scenarios.map((scenario) => {
          const configuredName = providerName(scenario, scenario.configured?.providerId);
          const lastCall = scenario.lastCall;
          return (
            <article key={scenario.id} className="rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-[13px] font-semibold text-[var(--app-fg)]">{uiLabel(scenario.label)}</div>
                  <div className="mt-1 text-[11px] text-[var(--app-muted)]">
                    {scenario.visual ? <UiText id="admin.m7632a4ed4896" /> : <UiText id="admin.mdd81861811e5" />}
                    {scenario.allowOverride ? <UiText id="admin.m28d49b5483d2" /> : ""}
                  </div>
                </div>
                <span className={[
                  "rounded-lg border px-2 py-1 text-[11px]",
                  scenario.effective?.status === "ready"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                ].join(" ")}>
                  {uiLabel(routeStatusLabel(scenario.effective?.status))}
                </span>
              </div>

              <dl className="mt-4 space-y-3 text-[12px]">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--input-bg)] p-3">
                  <dt className="text-[11px] text-[var(--app-muted)]"><UiText id="admin.mbc1db58f605d" /></dt>
                  <dd className="mt-1 text-[var(--app-fg)]">
                    {scenario.configured
                      ? `${configuredName || scenario.configured.providerId} / ${scenario.configured.modelId}`
                      : <UiText id="admin.m80a57e03f071" />}
                  </dd>
                  <dd className="mt-1 text-[11px] text-[var(--app-muted)]"><UiText id="admin.m04f2b844522a" />{scenario.effective?.providerName || scenario.effective?.providerId || <UiText id="admin.m484d55613910" />}
                    {scenario.effective?.modelId ? ` / ${scenario.effective.modelId}` : ""}
                    {` · ${uiLabel(routeSourceLabel(scenario.effective?.source))}`}
                  </dd>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--input-bg)] p-3">
                  <dt className="text-[11px] text-[var(--app-muted)]"><UiText id="admin.mc24f87e26083" /></dt>
                  <dd className="mt-1 text-[var(--app-fg)]">
                    {lastCall ? `${providerName(scenario, lastCall.providerId) || lastCall.providerId || text("providersDynamic.m7c991e8e560c")} / ${lastCall.modelId || text("providersDynamic.m0a9156766e0a")}` : <UiText id="admin.m46ca86da52b3" />}
                  </dd>
                  {lastCall ? (
                    <dd className="mt-1 text-[11px] text-[var(--app-muted)]">
                      {uiLabel(routeSourceLabel(lastCall.routeSource))} · {uiLabel(routeStatusLabel(lastCall.status))} · {formatRouteTime(lastCall.createdAt, locale, text)}
                    </dd>
                  ) : null}
                </div>
              </dl>
            </article>
          );
        })}
      </div>

      {!loading && !error && scenarios.length === 0 ? (
        <div className="mt-4 rounded-xl border border-[var(--border)] px-3 py-4 text-center text-[12px] text-[var(--app-muted)]"><UiText id="admin.m939f48c024a7" /></div>
      ) : null}
    </section>
  );
}

function providerName(scenario: RouteScenario, providerId?: string | null) {
  if (!providerId) return "";
  return scenario.candidates.find((candidate) => candidate.providerId === providerId)?.providerName || "";
}

function routeSourceLabel(source?: string | null) {
  const labels: Record<string, string> = {
    configured: "后台默认",
    "node-override": "节点覆盖",
  };
  return source ? labels[source] || source : "无来源";
}

function routeStatusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    ready: "可用",
    success: "成功",
    error: "失败",
    "missing-binding": "未配置",
    "provider-disabled": "平台已禁用",
    "missing-key": "缺少 API Key",
    "model-disabled": "模型未启用",
    "unsupported-capability": "模型能力不匹配",
    "unsupported-protocol": "协议不支持",
    "invalid-endpoint": "endpoint 无效",
  };
  return status ? labels[status] || status : "未知状态";
}

function formatRouteTime(value: string | null | undefined, locale: ReturnType<typeof useUiLocale>["locale"], text: ReturnType<typeof useUiLocale>["text"]) {
  if (!value) return text("providersDynamic.m25b3cd0f059c");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? text("providersDynamic.m25b9d2b50be9") : formatUiDate(locale, date, { dateStyle: "medium", timeStyle: "medium", hour12: false }, () => date.toLocaleString("zh-CN", { hour12: false }));
}
