"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";

import * as React from "react";
import { fetchJsonOnce } from "@/lib/client/inflight-json";
import { getGptImage25ModelLabel, isGptImageVariantModel } from "@/lib/gpt-image-25-models";
import { APIMART_GPT_IMAGE_26_UPSTREAM_MODELS } from "@/lib/apimart-image-models";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { FrostedSelect } from "@/components/ui/frosted-select";
import { previewAll, applyAll, type ReconcilePlan } from "@/lib/billing/reconcile-all";
import { isRetiredProviderModel } from "@/lib/providers/retired-models";
import { sortAdminProviders } from "@/lib/providers/order";
import type { BillingDateRange } from "./UserBillingTrend";

const box = "rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-4";
const inputClass =
  "h-7 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2 text-[var(--app-fg)]";
const button =
  "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-[var(--border)] px-3 py-2 text-xs transition-colors hover:bg-[var(--panel-2)] disabled:opacity-50 disabled:pointer-events-none";
const money = (value: unknown) =>
  Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
const labels: Record<string, string> = {
  image: "张",
  second: "秒",
  video: "条",
  request: "次",
  million_token: "百万 token",
  ten_thousand_character: "万字符",
  token: "token",
  media_token: "图像 token（分项）",
};
const states: Record<string, string> = {
  priced: "已计价",
  unpriced: "缺价格",
  missing_usage: "缺用量",
  missing_rate: "缺汇率",
  pending: "等待用量",
  failed: "失败未计费",
  non_billable: "不计费",
  free: "免费",
};
export default function MonthlyBillingPanel({
  header,
  user,
  refreshSignal,
  initialRange,
}: {
  header?: React.ReactNode;
  user?: { userId: string; authUserId?: number | null };
  refreshSignal?: number;
  initialRange?: BillingDateRange;
}) {
  const { label: tLabel } = useUiLocale();
  const { error: uiError, label: uiLabel, locale: uiLocale } = useUiLocale();
  const [month, setMonth] = React.useState(() =>
    initialRange?.dateTo.slice(0, 7) || new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7),
  );
  const [dateRange, setDateRange] = React.useState(initialRange);
  const rangeLabel = dateRange ? `${dateRange.dateFrom} 至 ${dateRange.dateTo}` : month;
  const [provider, setProvider] = React.useState("");

  const [page, setPage] = React.useState(1);
  const [payload, setPayload] = React.useState<any>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [revision, reload] = React.useReducer((x) => x + 1, 0);
  const [catalog, setCatalog] = React.useState<any[]>([]);
  const [preview, setPreview] = React.useState<any>(null);
  const [reconciling, setReconciling] = React.useState(false);
  const [plan, setPlan] = React.useState<ReconcilePlan | null>(null);
  const [progress, setProgress] = React.useState("");
  const [reconcileError, setReconcileError] = React.useState("");
  const reconcileLock = React.useRef(false);
  const params = React.useMemo(() => {
    const p = new URLSearchParams({ month, includeLedgers: "0" });
    if (dateRange) { p.set("dateFrom", dateRange.dateFrom); p.set("dateTo", dateRange.dateTo); }
    if (provider) p.set("provider", provider);

    if (user?.userId) p.set("userId", user.userId);
    if (user?.authUserId) p.set("authUserId", String(user.authUserId));
    return p;
  }, [month, dateRange, provider, user?.userId, user?.authUserId]);
  React.useEffect(() => {
    setPreview(null);
    setPlan(null);
  }, [month, dateRange, provider, user?.userId, user?.authUserId]);
  const reconcile = async (action: "preview" | "apply") => {
    if (reconcileLock.current) return;
    reconcileLock.current = true;
    setReconciling(true);
    setReconcileError("");
    let updated = 0;
    const request = async (step: "preview" | "apply", cursor: number, digest?: string) => {
      const r = await fetch("/api/admin/billing/reconcile", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(params), action: step, cursor, digest }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "核算失败");
      return j;
    };
    try {
      if (action === "preview") {
        setPlan(null);
        setPreview(null);
        setProgress("正在检查全部待核算记录…");
        const next = await previewAll(request, n => setProgress(`已检查 ${n} 条，继续检查剩余记录…`));
        const items = next.batches.flatMap(b => b.preview.items);
        setPlan(next);
        setPreview({ scanned: next.scanned, items,
          amountCny: next.batches.reduce((sum, b) => sum + Number(b.preview.amountCny), 0) });
        setProgress("");
      } else {
        if (!plan) throw new Error("请先重新预览全部记录");
        const total = plan.batches.reduce((sum, b) => sum + b.preview.items.length, 0);
        setProgress(`正在补算 0 / ${total} 条，请保持页面打开…`);
        await applyAll(request, plan, n => { updated = n; setProgress(`已补算 ${n} / ${total} 条，请保持页面打开…`); });
        setPreview((value: any) => ({ ...value, applied: true }));
        setProgress(`处理完成，已补算 ${updated} 条。`);
        setPlan(null);
        reload();
      }
    } catch (e) {
      setPlan(null);
      setProgress("");
      setReconcileError(`${e instanceof Error ? e.message : "核算失败"}${action === "apply" ? `。已确认完成 ${updated} 条，其余尚未确认；请重新预览，已计价记录不会重复补算。` : ""}`);
      if (action === "apply") reload();
    } finally {
      reconcileLock.current = false;
      setReconciling(false);
    }
  };
  React.useEffect(() => {
    const abort = new AbortController();
    fetchJsonOnce<any>("/api/admin/billing/catalog")
      .then(({ ok, json }) => { if (ok && !abort.signal.aborted) setCatalog(json?.models || []); })
      .catch(() => {});
    return () => abort.abort();
  }, []);
  React.useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setPayload(null);
    fetchJsonOnce<any>(`/api/admin/billing/monthly?${params}`)
      .then(({ ok, json: j }) => {
        if (!ok) throw new Error(j?.error || "读取失败");
        if (!abort.signal.aborted) setPayload(j);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [params, revision, refreshSignal]);
  const change = (fn: () => void) => {
    fn();
    setPage(1);
  };
  const providers = sortAdminProviders([
    ...new Map(
      catalog.map((m) => [
        m.provider,
        { id: m.provider, value: m.provider, label: m.providerName, sortOrder: m.providerSortOrder },
      ]),
    ).values(),
  ]);
  const summary = payload?.summary;
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [sort, setSort] = React.useState("count");
  const [drawer, setDrawer] = React.useState<
    "details" | "totals" | "reconcile" | "more" | null
  >(null);
  const [detailModel, setDetailModel] = React.useState<any>(null);
  const [detailPayload, setDetailPayload] = React.useState<any>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [detailError, setDetailError] = React.useState("");
  const [historicalPrices, setHistoricalPrices] = React.useState<any[]>([]);
  const [priceHistoryError, setPriceHistoryError] = React.useState("");
  const [priceHistoryLoading, setPriceHistoryLoading] = React.useState(false);
  React.useEffect(() => {
    setHistoricalPrices([]);
    setPriceHistoryError("");
    if (drawer !== "details" || !detailModel) return;
    const abort = new AbortController();
    const query = new URLSearchParams({ provider: detailModel.provider || "" });
    for (const model of new Set([detailModel.model, ...(detailModel.aliases || [])])) {
      query.append("model", String(model));
    }
    setPriceHistoryLoading(true);
    fetch(`/api/admin/billing/prices?${query}`, { signal: abort.signal, cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "历史价格读取失败");
        if (!abort.signal.aborted) setHistoricalPrices((j.rules || []).filter((r: any) => !detailModel.providerModel || !r.matchConditions?.providerModel || r.matchConditions.providerModel === detailModel.providerModel));
      })
      .catch((e) => { if (!abort.signal.aborted) setPriceHistoryError(e.message); })
      .finally(() => { if (!abort.signal.aborted) setPriceHistoryLoading(false); });
    return () => abort.abort();
  }, [drawer, detailModel]);
  React.useEffect(() => {
    if (drawer !== "details") return;
    const abort = new AbortController();
    const query = new URLSearchParams(params);
    query.delete("includeLedgers");
    query.set("page", String(page));
    if (detailModel) {
      query.set("provider", detailModel.provider);
      query.set("model", detailModel.model);
      if (detailModel.providerModel !== undefined) query.set("providerModel", detailModel.providerModel);
    }
    setDetailLoading(true);
    setDetailError("");
    setDetailPayload(null);
    fetch(`/api/admin/billing/monthly?${query}`, {
      signal: abort.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw Error(j.error || "读取失败");
        if (!abort.signal.aborted) setDetailPayload(j);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setDetailError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setDetailLoading(false);
      });
    return () => abort.abort();
  }, [drawer, detailModel, page, params, revision, refreshSignal]);
  const modelName = (m: any) => {
    const label = catalog.find((c) => c.provider === m.provider && c.model === m.model)?.label || m.model;
    if (!isGptImageVariantModel(m.model)) return label;
    if (m.providerModel === "gpt-image-2.5-flare" || m.providerModel === APIMART_GPT_IMAGE_26_UPSTREAM_MODELS.flare) return getGptImage25ModelLabel(m.model, label, "flare");
    if (m.providerModel === "gpt-image-2.5-sunburst" || m.providerModel === APIMART_GPT_IMAGE_26_UPSTREAM_MODELS.sunburst) return getGptImage25ModelLabel(m.model, label, "sunburst");
    return `${label} · 模式未记录`;
  };
  const historyLabel = (m: any) =>
    isRetiredProviderModel(m.provider || "", m.model) ? "已删除" :
    catalog.length && !catalog.some((c) => c.provider === m.provider &&
      (c.model === m.model || c.aliases?.includes(m.model))) ? "历史模型" : "";
  const providerName = (id: string) =>
    providers.find((p) => p.value === id)?.label || id || "未标注";
  const visibleModels = (payload?.models || [])
    .filter(
      (m: any) =>
        `${modelName(m)} ${m.model}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()) &&
        (status === "all" ||
          (status === "pending" ? m.pendingCount > 0 : !m.pendingCount)),
    )
    .sort((a: any, b: any) => Number(b[sort]) - Number(a[sort]));
  const openDetails = (m: any = null) => {
    setDetailModel(m ? { ...m, aliases: catalog.find((c) => c.provider === m.provider &&
      (c.model === m.model || c.aliases?.includes(m.model)))?.aliases || [] } : null);
    setPage(1);
    setDrawer("details");
  };
  const shiftMonth = (offset: number) => {
    const [y, m] = month.split("-").map(Number);
    const next = new Date(y, m - 1 + offset, 1);
    change(() =>
      setMonth(
        `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`,
      ),
    );
  };
  const exportParams = new URLSearchParams(params);
  exportParams.delete("includeLedgers");
  return (
    <div className="flex min-h-0 flex-col gap-3 text-[13px] text-[var(--app-fg)] lg:h-full">
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2">
        {header}
        <div className="flex min-w-0 flex-1 basis-[580px] flex-wrap items-center gap-1.5">
          {dateRange ? <div className="flex items-center gap-2 text-xs"><span>{rangeLabel}<UiText id="admin.m5eb76ad8840e" /></span><button className={button} onClick={() => change(() => setDateRange(undefined))}><UiText id="admin.m40e2413f9256" /></button></div> : <UiProps ids={{"aria-label":["admin.m802b9f9d9551"]}}><div
            className="flex items-center gap-1"
            aria-label="admin.m802b9f9d9551"
          >
            <UiProps ids={{"aria-label":["admin.mf9e727223456"]}}><button
              className={`${button} !h-7 !w-7 !p-0`}
              aria-label="admin.mf9e727223456"
              onClick={() => shiftMonth(-1)}
            >
              <ChevronLeft size={14} />
            </button></UiProps>
            <FrostedSelect
              compact
              buttonClassName="!h-7 !rounded-lg"
              showLeading={false}
              ariaLabel={tLabel("账单年份")}
              menuWidth={128}
              menuClassName="[&_[role=option]_span]:!whitespace-nowrap"
              value={month.slice(0, 4)}
              onChange={(v) => change(() => setMonth(v + month.slice(4)))}
              options={Array.from({ length: 21 }, (_, i) =>
                String(Number(month.slice(0, 4)) - 10 + i),
              ).map((v) => ({ value: v, label: v + "年" }))}
            />
            <FrostedSelect
              compact
              buttonClassName="!h-7 !rounded-lg"
              showLeading={false}
              ariaLabel={tLabel("账单月份")}
              menuWidth={96}
              menuClassName="[&_[role=option]_span]:!whitespace-nowrap"
              value={month.slice(5)}
              onChange={(v) => change(() => setMonth(month.slice(0, 5) + v))}
              options={Array.from({ length: 12 }, (_, i) => ({
                value: String(i + 1).padStart(2, "0"),
                label: tLabel(`${i + 1}月`),
              }))}
            />
            <UiProps ids={{"aria-label":["admin.m3e0b634699d4"]}}><button
              className={`${button} !h-7 !w-7 !p-0`}
              aria-label="admin.m3e0b634699d4"
              onClick={() => shiftMonth(1)}
            >
              <ChevronRight size={14} />
            </button></UiProps>
          </div></UiProps>}
          <FrostedSelect
            compact
            buttonClassName="!h-7 !rounded-lg"
            showLeading={false}
            ariaLabel={tLabel("供应商筛选")}
            value={provider}
            onChange={(v) => change(() => setProvider(v))}
            options={[{ value: "", label: tLabel("全部供应商") }, ...providers]}
          />
          <UiProps ids={{"aria-label":["admin.m93a8734cce30"],"placeholder":["admin.md9c7a110575a"]}}><input
            className={`${inputClass} w-44 max-w-full text-[11px]`}
            aria-label="admin.m93a8734cce30"
            placeholder="admin.md9c7a110575a"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          /></UiProps>
          <FrostedSelect
            compact
            buttonClassName="!h-7 !rounded-lg"
            showLeading={false}
            ariaLabel={tLabel("核算状态")}
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: tLabel("全部核算状态") },
              { value: "pending", label: tLabel("有待核算") },
              { value: "complete", label: tLabel("核算完整") },
            ]}
          />
        </div>
        <button
          className={`${button} ml-auto`}
          onClick={() => setDrawer("more")}
        ><UiText id="admin.m38844b135cf7" /></button>
      </div>
      {error && (
        <p role="alert" className="text-sm">
          {uiError(error)}
        </p>
      )}
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-[var(--border)] pb-3 text-xs text-[var(--app-muted)]">
        <span><UiText id="admin.m28a39e5809be" />{" "}
          <strong className="ml-2 text-lg font-medium text-[var(--app-fg)]">
            {summary ? `¥${money(summary.totalAmount)}` : "—"}
          </strong>
        </span>
        <span><UiText id="admin.m653b123c956d" />{" "}
          <span className="text-[var(--app-fg)]">
            {summary?.ledgerCount ?? "—"}
          </span>{" "}<UiText id="admin.m172fb7e67b9b" /></span>
        <button
          className="hover:text-[var(--app-fg)]"
          disabled={!summary}
          onClick={() => setDrawer("totals")}
        ><UiText id="admin.m0f0661f77653" />{summary?.pendingCount ?? "—"}<UiText id="admin.m155e7541e04b" /></button>
        {!!summary?.pendingCount && <span><UiText id="admin.mbffb80c83be8" /></span>}
        {loading && <span role="status"><UiText id="admin.m21bd738e0d71" /></span>}
      </div>
      <div className="flex shrink-0 items-center justify-between text-xs text-[var(--app-muted)]">
        <span><UiText id="admin.mbd75c68d5cd0" />{visibleModels.length}<UiText id="admin.mf9d529eacdf3" /></span>
        <div className="flex gap-3">
          {[
            { key: "count", label: "按调用次数" },
            { key: "amount", label: "按金额" },
            { key: "pendingCount", label: "按待核算" },
          ].map((x) => (
            <button
              key={x.key}
              aria-pressed={sort === x.key}
              className={sort === x.key ? "text-blue-400" : ""}
              onClick={() => setSort(x.key)}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--panel-bg)]">
        <table className="w-full min-w-[650px] text-left text-[13px]">
          <thead className="sticky top-0 bg-[var(--panel-2)] text-xs text-[var(--app-muted)]">
            <tr>
              {[
                "模型",
                "供应商",
                "调用次数",
                "已计价金额",
                "待核算",
                "操作",
              ].map((t) => (
                <th key={t} className="px-4 py-3 font-normal">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleModels.map((m: any) => (
              <tr
                key={`${m.provider}|${m.model}|${m.providerModel ?? ""}`}
                className="border-t border-[var(--border)]"
              >
                <td className="px-4 py-4">{modelName(m)}{historyLabel(m) && (
                  <span className="ml-2 text-xs text-[var(--app-muted)]">{uiLabel(historyLabel(m))}</span>
                )}</td>
                <td className="px-4 py-4 text-[var(--app-muted)]">
                  {providerName(m.provider)}
                </td>
                <td className="px-4 py-4 tabular-nums">{m.count}</td>
                <td className="px-4 py-4 tabular-nums">¥{money(m.amount)}</td>
                <td className="px-4 py-4">
                  {m.pendingCount ? <UiText id="admin.m9ada3f6c5bfa" values={{v0: String(m.pendingCount)}} /> : <UiText id="admin.m8396e0840a47" />}
                </td>
                <td className="px-4 py-4">
                  <button
                    className="whitespace-nowrap text-blue-400 hover:underline"
                    onClick={() => openDetails(m)}
                  ><UiText id="admin.m47f3546e26de" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !visibleModels.length && (
          <p className="py-14 text-center text-[var(--app-muted)]">
            {error ? <UiText id="admin.m639b9fd76d7c" /> : <UiText id="admin.m6edc181160a4" />}
          </p>
        )}
      </div>
      <UiProps ids={{"title":["admin.md00bfaacc9b1","admin.m7bdfbdb36fcc","admin.mb6a2f6a49c22","admin.m9f07d2ce4115"],"confirmText":["admin.m3fd47edce45b"]}}><ConfirmDialog
        open={drawer !== null}
        placement="right"
        focusPanelOnOpen
        title={
          drawer === "details"
            ? detailModel
              ? modelName(detailModel) + " · 调用明细"
              : "admin.md00bfaacc9b1"
            : drawer === "totals"
              ? "admin.m7bdfbdb36fcc"
              : drawer === "reconcile"
                ? "admin.mb6a2f6a49c22"
                : "admin.m9f07d2ce4115"
        }
        confirmText="admin.m3fd47edce45b"
        showCancel={false}
        confirmDisabled={reconciling}
        onClose={() => {
          if (!reconciling) setDrawer(null);
        }}
        onConfirm={() => {
          setDrawer(null);
        }}
      >
        {drawer === "more" && (
          <div className="space-y-4 text-sm">
            <p className="text-xs leading-6 text-[var(--app-muted)]"><UiText id="admin.m77ed48da3ae3" />{rangeLabel} ·{" "}
              {provider ? providerName(provider) : <UiText id="admin.me7ef96324139" />} ·{" "}
              {user?.userId || <UiText id="admin.m481acd77ffd5" />}<UiText id="admin.mbe92e89e5f6c" /></p>
            <div className="flex flex-wrap gap-2">
              <a
                className={button}
                href={`/api/admin/billing/monthly?${exportParams}&export=details`}
              ><UiText id="admin.m65a84c7e602a" /></a>
              <button className={button} onClick={() => openDetails()}><UiText id="admin.m3ce60632bc3b" /></button>
              <button
                className={button}
                disabled={loading}
                onClick={() => {
                  setDrawer("reconcile");
                  void reconcile("preview");
                }}
              ><UiText id="admin.mb6a2f6a49c22" /></button>
              <button className={button} disabled={loading} onClick={reload}><UiText id="admin.m0468ee76ee3d" /></button>
            </div>
            <details className="border-t border-[var(--border)] pt-4">
              <summary className="cursor-pointer"><UiText id="admin.ma0bf45c7ca6a" /></summary>
              <p className="mt-3 text-xs leading-6 text-[var(--app-muted)]"><UiText id="admin.m02fdb6d38708" /></p>
            </details>
          </div>
        )}
        {drawer === "totals" && summary && (
          <div className="space-y-5 text-sm">
            <p><UiText id="admin.md624ec469def" /><strong>¥{money(summary.totalAmount)}</strong>
            </p>
            <p className="text-xs text-[var(--app-muted)]"><UiText id="admin.me05106d26d7c" />{summary.pendingCount > 0
                ? <UiText id="admin.mc882a33a8eb3" />
                : <UiText id="admin.mc9d94df946b7" />}
            </p>
            <div className={box}>
              {[
                ["缺价格", summary.unpricedCount],
                ["缺用量", summary.missingUsageCount],
                ["缺汇率", summary.missingRateCount],
                ["待核算合计", summary.pendingCount],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between py-2">
                  <span>{label}</span>
                  <span>{value}<UiText id="admin.mf81526efce19" /></span>
                </div>
              ))}
            </div>
            <div>
              <h4><UiText id="admin.mce67a5b7af27" /></h4>
              <p className="my-2 text-xs text-[var(--app-muted)]"><UiText id="admin.m30c227227ebc" /></p>
              {Object.entries(summary.originalTotals).map(
                ([currency, value]) => (
                  <div
                    key={currency}
                    className="flex justify-between border-b border-[var(--border)] py-3"
                  >
                    <span>{currency}</span>
                    <span>{money(value)}</span>
                  </div>
                ),
              )}
            </div>
          </div>
        )}
        {drawer === "reconcile" && (
          <div className="space-y-3">
            {progress && <p role="status">{progress}</p>}
            {reconcileError && <p role="alert">{reconcileError}</p>}
            {preview && (
              <div className={box}>
                <p className="text-sm"><UiText id="admin.m68e3b9fa8867" />{preview.scanned}<UiText id="admin.mf41397aa76a7" />{preview.items.length}{" "}<UiText id="admin.mb90214acc987" />{money(preview.amountCny)}<UiText id="admin.mc318b7480555" /></p>
                <div className="my-3 max-h-36 overflow-y-auto text-xs">
                  {!preview.items.length && <p className="leading-6 text-[var(--app-muted)]"><UiText id="admin.m184b4016174e" /></p>}
                  {preview.items.map((r: any) => (
                    <div key={r.id}>
                      #{r.id} · {modelName(r)} · ¥{money(r.before)} → ¥
                      {money(r.after)}
                    </div>
                  ))}
                </div>
                <div className="flex gap-3">
                  {preview.applied ? (
                    <span className="text-sm"><UiText id="admin.mefe0bc946244" /></span>
                  ) : (
                    <button
                      className={button}
                      disabled={reconciling || !plan || !preview.items.length}
                      onClick={() => void reconcile("apply")}
                    ><UiText id="admin.mb21358d9c333" />{preview.items.length}<UiText id="admin.m6fb2840d568a" /></button>
                  )}
                  {!plan && !preview.applied && <button className={button} disabled={reconciling} onClick={() => void reconcile("preview")}><UiText id="admin.mcdaeab4f1b67" /></button>}
                  <p className="text-xs text-[var(--app-muted)]">{preview.scanned - preview.items.length}<UiText id="admin.mf0481ca1768a" /></p>
                  <button
                    className={button}
                    disabled={reconciling}
                    onClick={() => setDrawer("more")}
                  ><UiText id="admin.m572cf45ba436" /></button>
                </div>
              </div>
            )}
          </div>
        )}
        {drawer === "details" && (
          <div className="space-y-4">
            {detailModel && (
              <p className="text-xs text-[var(--app-muted)]">
                {providerName(detailModel.provider)} · {rangeLabel} ·{" "}
                {detailModel.count}<UiText id="admin.mfd9371d58a34" />{detailModel.pendingCount}<UiText id="admin.ma5c39498f953" /></p>
            )}
            {detailLoading && <p role="status"><UiText id="admin.m95d3aba17314" /></p>}
            {detailError && <p role="alert">{detailError}</p>}
            {detailModel && (
              <details className={box}>
                <summary className="cursor-pointer text-sm"><UiText id="admin.m936af0570fa6" />{historicalPrices.length}<UiText id="admin.m844d524dbcea" /></summary>
                <p className="mt-3 text-xs leading-6 text-[var(--app-muted)]">
                  {historyLabel(detailModel) ? <UiText id="admin.ma92245acd2cd" values={{v0: String(historyLabel(detailModel))}} /> : ""}<UiText id="admin.m2c6dfe174236" /></p>
                {priceHistoryLoading && <p className="mt-3 text-xs"><UiText id="admin.m5f01a27005f9" /></p>}
                {priceHistoryError && <p role="alert" className="mt-3 text-xs">{priceHistoryError}</p>}
                {!priceHistoryLoading && !priceHistoryError && !historicalPrices.length && (
                  <p className="mt-3 text-xs text-[var(--app-muted)]"><UiText id="admin.m4993b4f13f4d" /></p>
                )}
                {historicalPrices.map((r) => (
                  <div key={r.id} className="mt-3 border-t border-[var(--border)] pt-3 text-xs leading-6">
                    <div>{r.currency} {money(r.unitPrice)} / {labels[r.unitType] || r.unitType}</div>
                    <div className="text-[var(--app-muted)]">
                      {new Date(r.effectiveFrom).toLocaleDateString(uiLocale === "en" ? "en-US" : "zh-CN", { timeZone: "Asia/Shanghai" })}
                      {<UiText id="admin.m8727f227e2c6" />}{r.effectiveTo ? new Date(r.effectiveTo).toLocaleDateString(uiLocale === "en" ? "en-US" : "zh-CN", { timeZone: "Asia/Shanghai" }) + "（不含）" : <UiText id="admin.m6c9892af289d" />}
                    </div>
                    {!!Object.keys(r.matchConditions || {}).length && <div className="break-words"><UiText id="admin.mb3b27d1a8421" />{JSON.stringify(r.matchConditions)}</div>}
                  </div>
                ))}
              </details>
            )}
            {(detailPayload?.models || []).map((m: any) => (
              <details key={`${m.provider}|${m.model}|${m.providerModel ?? ""}`} className={box}>
                <summary className="cursor-pointer text-sm">
                  {modelName(m)}<UiText id="admin.m59268a3c5fa5" /></summary>
                <div className="mt-3 space-y-3">
                  {Object.entries(m.quantities).map(([unit, count]) => (
                    <span key={unit} className="mr-3 text-xs">
                      {String(count)} {labels[unit] || unit}
                    </span>
                  ))}
                  {m.segments.map((s: any, i: number) => (
                    <div
                      key={i}
                      className="border-t border-[var(--border)] pt-3 text-xs leading-6"
                    >
                      <div>
                        {s.day} · {states[s.costStatus] || s.costStatus}
                      </div>
                      <div>
                        {s.unitCount} {labels[s.unitType] || s.unitType} ·{" "}
                        {s.pending ? <UiText id="admin.m6d4c0c6eae2b" /> : `¥${money(s.amountCny)}`}
                      </div>
                      <div className="text-[var(--app-muted)]">
                        {["token", "media_token"].includes(s.unitType)
                          ? <UiText id="admin.m7affc4abab3c" />
                          : <UiText id="admin.md4d185089310" values={{v0: String(s.currency), v1: String(s.unitPrice)}} />}{" "}<UiText id="admin.m6a05bb3c1721" />{money(s.originalAmount)}<UiText id="admin.m4dba99fb1338" />{" "}
                        {s.rate || <UiText id="admin.m27a2f331a4b0" />}
                      </div>
                      <div className="text-[var(--app-muted)]"><UiText id="admin.m029a3c742583" />{s.priceFrom || <UiText id="admin.mb0385cfe4b42" />}<UiText id="admin.m6afa7520813a" />{" "}
                        {s.rateId || "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            ))}
            {(detailPayload?.ledgers || []).map((r: any) => (
              <div key={r.id} className={box}>
                <div className="flex justify-between gap-3 text-sm">
                  <span className="break-all">{modelName({ ...r, provider: r.externalProvider })}</span>
                  <span className="shrink-0">
                    {r.amountCny === null ? <UiText id="admin.m6d4c0c6eae2b" /> : `¥${money(r.amountCny)}`}
                  </span>
                </div>
                <div className="mt-2 text-xs leading-6 text-[var(--app-muted)]">
                  {new Date(r.occurredAt).toLocaleString(uiLocale === "en" ? "en-US" : "zh-CN", {
                    timeZone: "Asia/Shanghai",
                  })}{" "}
                  · {r.username || r.userId}
                  <br />
                  {states[r.costStatus] || r.costStatus} · {r.currency}{" "}
                  {money(r.amount)}<UiText id="admin.m4dba99fb1338" />{" "}
                  {r.conversion?.rate || (r.currency === "CNY" ? "1" : "—")}
                </div>
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer"><UiText id="admin.m4c8d51fb240e" /></summary>
                  <pre className="mt-2 whitespace-pre-wrap break-all">
                    {JSON.stringify(
                      { 计价: r.pricingSnapshot, 用量: r.usageSnapshot },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </div>
            ))}
            {detailPayload && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <button
                  className={button}
                  disabled={page <= 1 || detailLoading}
                  onClick={() => setPage((p) => p - 1)}
                ><UiText id="admin.mc9b9ae7a6144" /></button>
                <span>
                  {page} / {Math.max(1, detailPayload.pagination.totalPages)}<UiText id="admin.mf9810f5dff30" />{detailPayload.pagination.total}<UiText id="admin.m6fb2840d568a" /></span>
                <button
                  className={button}
                  disabled={!detailPayload.pagination.hasMore || detailLoading}
                  onClick={() => setPage((p) => p + 1)}
                ><UiText id="admin.m8a8542f69648" /></button>
              </div>
            )}
          </div>
        )}
      </ConfirmDialog></UiProps>
    </div>
  );
}
