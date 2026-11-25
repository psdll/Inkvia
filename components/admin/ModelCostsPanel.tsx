"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";

import { ProviderSidebar } from "@/components/admin/ProviderSidebar";
import { sortAdminProviders } from "@/lib/providers/order";
import * as React from "react";
import { fetchJsonOnce } from "@/lib/client/inflight-json";
import { ChevronDown } from "lucide-react";
import { useAdminPageSelection } from "@/components/admin/useAdminPageSelection";
import { useSearchParams } from "next/navigation";
import { FrostedSelect } from "@/components/ui/frosted-select";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { tariffLabel } from "@/lib/billing/apimart-pricing";
import BillingDraftsPanel from "./BillingDraftsPanel";
import BillingPriceList from "./BillingPriceList";
import MonthlyBillingPanel from "./MonthlyBillingPanel";
import type { BillingModel } from "@/lib/billing/catalog";
import { batchDrafts, batchRateDrafts } from "@/lib/billing/batch-drafts";

const field =
  "h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--app-fg)]";
const button =
  "rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50";
const primary =
  "rounded-lg bg-[var(--primary-bg)] px-4 py-2 text-sm text-[var(--primary-fg)] disabled:opacity-50";
const today = () =>
  new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const categories = [
  { value: "", label: "全部类型" },
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
  { value: "agent", label: "对话 / Agent" },
  { value: "face", label: "人脸" },
];
type EditRow = {
  conditions: Record<string, unknown>;
  unitType: string;
  label: string;
  price: string;
};
function conditionLabel(c: Record<string, unknown>) {
  const names: Record<string, string> = {
    resolution: "分辨率",
    quality: "画质",
    aspectRatio: "比例",
    duration: "时长",
    generateAudio: "音频",
    inputContainsVideo: "视频输入",
    inputContainsReferenceMedia: "参考素材",
  };
  return (
    Object.entries(c)
      .map(([k, v]) => k === "maxMode" ? (v === true || v === "true" ? "Max 模式" : "普通模式") : `${names[k] || k} ${String(v)}`)
      .join(" / ") || "全部参数同价"
  );
}
function getRows(model: BillingModel): EditRow[] {
  const rows = new Map<string, EditRow>();
  for (const slot of model.slots) {
    const conditions = slot.rule?.matchConditions || slot.conditions;
    const unitType = slot.rule?.unitType || slot.unitType;
    const key = `${unitType}|${JSON.stringify(conditions)}`;
    rows.set(key, {
      conditions,
      unitType,
      label:
        slot.unitType.endsWith("_million_token") ||
        model.module === "agent" ||
        ["input_second", "excess_image"].includes(unitType)
          ? slot.label
          : conditionLabel(conditions),
      price: slot.rule ? String(slot.rule.unitPrice) : "",
    });
  }
  return [...rows.values()];
}

export default function ModelCostsPanel({
  refreshSignal,
  active = true,
}: { refreshSignal?: number; active?: boolean } = {}) {
  const { label: tLabel } = useUiLocale();
  const { error: uiError, label: uiLabel, locale: uiLocale } = useUiLocale();
  const searchParams = useSearchParams();
  const [tab, setTab] = useAdminPageSelection<string>(
    "model-costs-tab",
    "prices",
  );
  const [data, setData] = React.useState<any>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [preferredProvider, setProvider] = React.useState("");
  const [missingOnly, setMissingOnly] = React.useState(false);
  const [selected, setSelected] = React.useState<BillingModel | null>(null);
  const [draftId, setDraftId] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<EditRow[]>([]);
  const [currency, setCurrency] = React.useState("CNY");
  const [effectiveDate, setEffectiveDate] = React.useState(today);
  const [notes, setNotes] = React.useState("");
  const [samePrice, setSamePrice] = React.useState("");
  const [batchOpen, setBatchOpen] = React.useState(false);
  const [batchDate, setBatchDate] = React.useState("");
  const [batchProvider, setBatchProvider] = React.useState("");
  const batchPlan = batchDrafts(data?.settings.drafts || [], batchProvider, data?.models || []);
  const ratePlan = batchRateDrafts(data?.settings.rateDrafts || [], batchProvider, data?.models || []);
  const [rateDraftId, setRateDraftId] = React.useState<string | null>(null);
  const [rateForm, setRateForm] = React.useState({
    provider: "",
    currency: "USD",
    rate: "",
    effectiveDate: today(),
    notes: "",
  });
  const load = React.useCallback(async () => {
    const { ok, json: j } = await fetchJsonOnce<any>("/api/admin/billing/catalog");
    if (!ok) throw new Error(j?.error || "读取失败");
    setData(j);
    return j;
  }, []);
  React.useEffect(() => {
    let active = true;
    setBusy(true);
    load()
      .catch((e) => {
        if (active) setMessage(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [load]);
  const models: BillingModel[] = data?.models || [];
  const editorBaseline = React.useRef("");
  const selectModel = React.useCallback(
    (m: BillingModel, chosenDraft?: any) => {
      const draft =
        chosenDraft !== undefined ? chosenDraft :
        (!m.complete
          ? [...(data?.settings.drafts || [])]
              .reverse()
              .find(
                (d: any) => d.provider === m.provider && d.model === m.model,
              )
          : null);
      const editRows = draft
        ? draft.rows.map((r: any) => ({
            ...r,
            label: [tariffLabel(r.conditions), data.units[r.unitType]]
              .filter(Boolean)
              .join(" / "),
          }))
        : getRows(m);
      const editCurrency =
        draft?.currency || m.slots.find((s) => s.rule)?.rule?.currency || "CNY";
      const editDate = draft ? "" : today(),
        editNotes = draft?.notes || "";
      setProvider(m.provider);
      setCategory("");
      setSamePrice("");
      setDraftId(draft?.id || null);
      editorBaseline.current = JSON.stringify([
        editRows,
        editCurrency,
        editDate,
        editNotes,
      ]);
      setSelected(m);
      setRows(editRows);
      setCurrency(editCurrency);
      setEffectiveDate(editDate);
      setNotes(editNotes);
      setMessage("");
    },
    [data?.settings.drafts, data?.units],
  );
  const prefill = searchParams?.get("prefillModel");
  const consumedPrefill = React.useRef("");
  React.useEffect(() => {
    const p = searchParams?.get("prefillProvider");
    const key = `${p}|${prefill}`;
    if (!prefill || key === consumedPrefill.current) return;
    const m = (data?.models || []).find(
      (m: BillingModel) => m.model === prefill && (!p || p === m.provider),
    );
    if (m) {
      consumedPrefill.current = key;
      selectModel(m);
    }
  }, [data, prefill, searchParams, selectModel]);
  const post = async (body: any) => {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/admin/billing/catalog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, revision: data.settings.revision }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "保存失败");
      if (body.action === "previewImport") return j;
      await load();
      setMessage(j.published
        ? `已统一设置 ${j.published.models} 个模型、${j.published.rows} 条价格规则、${j.published.rates || 0} 条换算记录的生效日期。未录入项保持原样。${j.published.conflicts.length ? `另有 ${j.published.conflicts.length} 项存在多个版本，已跳过。` : ""}`
          + (j.published.unavailable?.length ? `已跳过已删除或目录不匹配的模型：${j.published.unavailable.join("、")}，原草稿保留。` : "")
        : j.importReport ? "导入完成，结果如下。草稿尚未生效。" : "已保存。历史版本与已计价账单保持不变。");
      return j;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const providers = sortAdminProviders([
    ...new Map(
      models.map((m) => [
        m.provider,
        { id: m.provider, value: m.provider, label: m.providerName, sortOrder: m.providerSortOrder },
      ]),
    ).values(),
  ]);
  const provider = providers.some((p) => p.value === preferredProvider)
    ? preferredProvider
    : providers[0]?.value || "";
  const providerModels = models.filter((m) => m.provider === provider);
  const providerLabel =
    providers.find((p) => p.value === provider)?.label || "供应商";
  const filtered = models.filter(
    (m) =>
      (!category || m.module === category) &&
      (!provider || m.provider === provider) &&
      (!missingOnly || !m.complete) &&
      `${m.label} ${m.model} ${m.providerName}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const missing = rows.filter((r) => r.price.trim() === "").length;
  const [ratesOpen, setRatesOpen] = React.useState(false);
  const [modeOpen, setModeOpen] = React.useState(false);
  const [draftsOpen, setDraftsOpen] = React.useState(false);
  const [discardTarget, setDiscardTarget] = React.useState<
    "price" | "rate" | null
  >(null);
  const rateBaseline = React.useRef("");
  const editorDirty =
    !!selected &&
    JSON.stringify([rows, currency, effectiveDate, notes]) !==
      editorBaseline.current;
  const rateDirty =
    ratesOpen && JSON.stringify(rateForm) !== rateBaseline.current;
  const blockers = models.filter((m) => m.enabled && !m.complete);
  const invalidPrices = rows.some(
    (r) =>
      r.price.trim() !== "" &&
      (!Number.isFinite(Number(r.price)) || Number(r.price) < 0),
  );
  const priceReady =
    rows.length > 0 && missing === 0 && !invalidPrices && !!effectiveDate;
  const refreshSeen = React.useRef(refreshSignal);
  React.useEffect(() => {
    if (refreshSeen.current === refreshSignal) return;
    refreshSeen.current = refreshSignal;
    if (!active || busy) return;
    if (selected || ratesOpen || modeOpen || draftsOpen) {
      setMessage("请先完成或关闭当前编辑面板，再刷新。");
      return;
    }
    if (tab === "monthly") return;
    setBusy(true);
    void load()
      .catch((e) => setMessage(e.message))
      .finally(() => setBusy(false));
  }, [
    refreshSignal,
    active,
    busy,
    selected,
    ratesOpen,
    modeOpen,
    draftsOpen,
    tab,
    load,
  ]);
  const closePrice = () => {
    if (busy) return;
    if (editorDirty) setDiscardTarget("price");
    else setSelected(null);
  };
  const closeRate = () => {
    if (busy) return;
    if (rateDirty) setDiscardTarget("rate");
    else setRatesOpen(false);
  };
  const openRates = () => {
    setRateDraftId(null);
    const form = {
      provider,
      currency: "USD",
      rate: "",
      effectiveDate: today(),
      notes: "",
    };
    setRateForm(form);
    rateBaseline.current = JSON.stringify(form);
    setMessage("");
    setRatesOpen(true);
  };
  const hasDraft = (model: BillingModel) =>
    data?.settings.drafts?.some(
      (d: any) => d.provider === model.provider && d.model === model.model,
    );
  const priceSummary = (model: BillingModel) => {
    const priced = model.slots.filter((slot) => slot.rule);
    if (!priced.length)
      return data.settings.drafts?.some(
        (d: any) => d.provider === model.provider && d.model === model.model,
      )
        ? "草稿已录入，待设置生效日期"
        : "未配置";
    const values = new Set(
      priced.map((slot) =>
        [slot.rule.currency, slot.rule.unitPrice, slot.rule.unitType].join("|"),
      ),
    );
    if (values.size > 1) return "多档价格";
    const rule = priced[0].rule;
    return (
      (priced.length < model.slots.length ? "部分档位 · " : "") +
      rule.currency +
      " " +
      rule.unitPrice +
      " / " +
      (data?.units?.[rule.unitType] || rule.unitType)
    );
  };
  const draftsPanel = data && <BillingDraftsPanel
    embedded
    drafts={data.settings.drafts || []}
    rateDrafts={data.settings.rateDrafts || []}
    models={models}
    units={data.units}
    onPublish={() => { setMessage(""); setDraftsOpen(false); setBatchProvider(""); setBatchDate(""); setBatchOpen(true); }}
    onEditRate={(rate) => {
      const form = { provider: rate.provider, currency: rate.currency, rate: rate.rate, effectiveDate: "", notes: rate.notes };
      setRateDraftId(rate.id); setRateForm(form); rateBaseline.current = JSON.stringify(form);
      setMessage(""); setDraftsOpen(false); setRatesOpen(true);
    }}
    busy={busy}
    post={post}
    onEdit={(draft) => {
      const model = models.find((model) => model.provider === draft.provider && model.model === draft.model);
      if (model) selectModel(model, draft);
    }}
  />;
  const header = (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <h3 className="whitespace-nowrap text-lg font-semibold leading-7"><UiText id="admin.mac02af9bcc7c" /></h3>
        <UiProps ids={{"aria-label":["admin.m582cabb33cbd"]}}><nav aria-label="admin.m582cabb33cbd" className="flex items-center gap-5">
          {[
            { id: "prices", name: "模型价格" },
            { id: "monthly", name: "月度消耗" },
            { id: "price-list", name: "价格清单" },
          ].map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={tab === item.id}
              onClick={() => setTab(item.id)}
              className={[
                "whitespace-nowrap border-b-2 py-2 text-[15px] font-medium leading-6",
                tab === item.id
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-[var(--app-muted)]",
              ].join(" ")}
            >
              {item.name}
            </button>
          ))}
        </nav></UiProps>
        {data && tab === "prices" && (
          <span
            className="text-xs text-[var(--app-muted)]"
            title={tLabel(`全局 ${models.length} 个模型，价格完整 ${models.filter((m) => m.complete).length} 个`)}
          >
            {models.length}<UiText id="admin.m94b8382c372c" />{" "}
            {models.filter((m) => !m.complete).length}
          </span>
        )}
      </div>
      {tab === "prices" && (
        <div className="flex flex-wrap items-center gap-2">
          <UiProps ids={{"aria-label":["admin.m93a8734cce30"],"placeholder":["admin.maa0d175b7499"]}}><input
            className="h-8 w-72 max-w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 text-xs"
            aria-label="admin.m93a8734cce30"
            placeholder="admin.maa0d175b7499"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          /></UiProps>
          <FrostedSelect
            showLeading={false}
            compact
            ariaLabel={tLabel("价格状态")}
            value={missingOnly ? "missing" : "all"}
            onChange={(v) => setMissingOnly(v === "missing")}
            options={[
              { value: "all", label: tLabel("全部价格状态") },
              { value: "missing", label: tLabel("只看待补齐") },
            ]}
          />
        </div>
      )}
    </header>
  );
  return (
    <div
      className="flex min-h-0 flex-col gap-2 text-[13px] text-[var(--app-fg)] lg:h-full"
      style={{
        fontFamily:
          '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
      }}
    >
      {tab !== "monthly" && (tab !== "price-list" || !data) && header}
      {message && !selected && !ratesOpen && !modeOpen && !draftsOpen && (
        <div
          role="status"
          className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-2 text-xs"
        >
          {uiError(message)}
        </div>
      )}
      {tab === "monthly" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <MonthlyBillingPanel
            header={header}
            refreshSignal={active ? refreshSignal : undefined}
          />
        </div>
      ) : !data ? (
        <p role="status">
          {busy ? <UiText id="admin.m52e06f6e7be3" /> : <UiText id="admin.m358e6f3764f9" />}
        </p>
      ) : tab === "price-list" ? (
        <BillingPriceList header={header} models={models} drafts={data.settings.drafts || []} units={data.units} busy={busy}
          onManageDrafts={() => { setMessage(""); setDraftsOpen(true); }}
          onEditModel={(model) => selectModel(model, null)} onEditDraft={selectModel} />
      ) : (
        <>
          <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[164px_minmax(0,1fr)]">
            <UiProps ids={{"label":["admin.m6a214b66cf40"]}}><ProviderSidebar label="admin.m6a214b66cf40" selectedId={provider}
              onSelect={id => { setProvider(id); setCategory(""); setSearch(""); }}
              items={providers.map(p => ({ id: p.value, name: p.label, count: models.filter(m => m.provider === p.value).length }))} /></UiProps>
            <section
              aria-label={providerLabel + "价格列表"}
              className="flex min-h-0 min-w-0 flex-col gap-2"
            >
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 border-b border-[var(--border)]">
                <UiProps ids={{"aria-label":["admin.m472d8c1b1d03"]}}><nav
                  aria-label="admin.m472d8c1b1d03"
                  className="flex shrink-0 flex-wrap gap-4"
                >
                  {categories
                    .filter(
                      (c) =>
                        !c.value ||
                        providerModels.some((m) => m.module === c.value),
                    )
                    .map((c) => (
                      <button
                        type="button"
                        key={c.value}
                        aria-pressed={category === c.value}
                        onClick={() => setCategory(c.value)}
                        className={[
                          "border-b-2 py-2 text-xs",
                          category === c.value
                            ? "border-blue-500 text-blue-400"
                            : "border-transparent text-[var(--app-muted)]",
                        ].join(" ")}
                      >
                        {c.label}{" "}
                        <span className="ml-1 text-[var(--app-muted)]">
                          {
                            providerModels.filter(
                              (m) => !c.value || m.module === c.value,
                            ).length
                          }
                        </span>
                      </button>
                    ))}
                </nav></UiProps>
                <div className="flex flex-wrap items-center gap-3 py-1 text-xs">
                  <button
                    type="button"
                    className="text-[var(--app-muted)]"
                    onClick={() => {
                      setMessage("");
                      setModeOpen(true);
                    }}
                  >
                    {data.settings.mode === "strict" ? <UiText id="admin.m5523411a17e9" /> : <UiText id="admin.me4c2a1d0de0b" />}{" "}<UiText id="admin.m2c89e660fc4d" /></button>
                  <button
                    type="button"
                    className="text-blue-400"
                    onClick={openRates}
                  ><UiText id="admin.m8cce88206c01" /></button>
                  <UiProps ids={{"title":["admin.m678f7b163328"]}}><a
                    className="text-blue-400"
                    href="/api/admin/billing/catalog?export=all"
                    download
                    title="admin.m678f7b163328"
                  ><UiText id="admin.mc59e082d57aa" /></a></UiProps>
                  <button
                    type="button"
                    className="text-blue-400"
                    onClick={() => {
                      setMessage("");
                      setDraftsOpen(true);
                    }}
                  ><UiText id="admin.m24bf4eee48e7" />{data.settings.drafts?.length
                      ? <UiText id="admin.m9cf072f58183" values={{v0: String(data.settings.drafts.length)}} />
                      : ""}
                  </button>
                  <button type="button" className="text-blue-400 disabled:opacity-50" disabled={busy || (!data.settings.drafts?.some((d: any) => d.rows.some((r: any) => r.price !== "")) && !data.settings.rateDrafts?.length)}
                    onClick={() => { setMessage(""); setBatchDate(""); setBatchProvider(""); setBatchOpen(true); }}><UiText id="admin.mb6e557953b78" /></button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--panel-bg)]">
                <table className="w-full min-w-[670px] text-left text-[13px]">
                  <thead className="sticky top-0 z-10 bg-[var(--panel-2)] text-xs text-[var(--app-muted)]">
                    <tr>
                      {[
                        "模型",
                        "当前价格",
                        "调用状态",
                        "价格完整性",
                        "操作",
                      ].map((label) => (
                        <th className="px-4 py-3 font-normal" key={label}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((m) => (
                      <tr
                        key={m.key}
                        className="border-t border-[var(--border)]"
                      >
                        <td className="px-4 py-3">
                          <div>{m.label}</div>
                          <div className="mt-1 text-xs text-[var(--app-muted)]">
                            {
                              categories.find((c) => c.value === m.module)
                                ?.label
                            }
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">{priceSummary(m)}</td>
                        <td className="px-4 py-3 text-xs text-[var(--app-muted)]">
                          {m.historical
                            ? <UiText id="admin.mb78075463e32" />
                            : m.enabled
                              ? <UiText id="admin.mdfb802238b38" />
                              : <UiText id="admin.mf95ea7f4c063" />}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {m.complete
                            ? <UiText id="admin.m8396e0840a47" />
                            : hasDraft(m)
                              ? <UiText id="admin.m0c82616bb429" />
                              : "待补齐 " +
                                m.slots.filter((s) => s.missing).length +
                                " 个档位"}
                          {!m.complete && !hasDraft(m) && (
                            <div className="mt-1 text-[var(--app-muted)]">
                              {[
                                ...new Set(
                                  m.slots.map((s) => s.missing).filter(Boolean),
                                ),
                              ].join("、")}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            className="whitespace-nowrap text-blue-400 disabled:opacity-50"
                            disabled={busy}
                            onClick={() => selectModel(m)}
                          >
                            {m.complete
                              ? <UiText id="admin.mdefe67af9a02" />
                              : hasDraft(m)
                                ? <UiText id="admin.m71cfbac9051d" />
                                : <UiText id="admin.m5d23b4eb3d5f" />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filtered.length && (
                  <p className="py-14 text-center text-sm text-[var(--app-muted)]"><UiText id="admin.m0db661e953f3" /></p>
                )}
              </div>
            </section>
          </div>
        </>
      )}
      {data && (
        <UiProps ids={{"title":["admin.mb6e557953b78"],"confirmText":["admin.m1256881513bc"]}}><ConfirmDialog open={batchOpen} title="admin.mb6e557953b78" confirmText="admin.m1256881513bc"
          confirmDisabled={busy || !batchDate || (!batchPlan.ready.length && !ratePlan.ready.length)}
          onClose={() => { if (!busy) setBatchOpen(false); }}
          onConfirm={async () => { if (await post({ action: "publishDrafts", provider: batchProvider, effectiveDate: batchDate })) setBatchOpen(false); return false; }}>
          <fieldset disabled={busy} className="space-y-4">
            <div className="text-sm"><UiText id="admin.m5c076770c413" /><FrostedSelect value={batchProvider} onChange={setBatchProvider}
                options={[{ value: "", label: tLabel("全部平台的已录入草稿") }, ...Array.from(new Set(models.map(m => m.provider))).map(p => ({ value: p, label: models.find(m => m.provider === p)?.providerName || p }))]} />
            </div>
            <div className="text-sm"><UiText id="admin.m8e146a2402cb" /><DateRangePicker single ariaLabel={tLabel("批量价格生效日期")} from={batchDate} to="" onFromChange={setBatchDate} onToChange={() => {}} />
            </div>
            <p className="text-sm"><UiText id="admin.m2b8178bde875" />{batchPlan.ready.length}<UiText id="admin.m4a3e44738be3" />{batchPlan.rowCount}<UiText id="admin.mde020e25c426" />{ratePlan.ready.length}<UiText id="admin.ma98f4e791919" /></p>
            <p className="text-xs text-[var(--app-muted)]"><UiText id="admin.m5c8a40e320fa" /></p>
            {batchPlan.conflicts.length > 0 && <p className="text-sm"><UiText id="admin.m73bc71fdad6f" />{batchPlan.conflicts.join("、")}</p>}
            {ratePlan.conflicts.length > 0 && <p className="text-sm"><UiText id="admin.me9b8a8c0a842" />{ratePlan.conflicts.join("、")}</p>}
            {batchPlan.unavailable.length > 0 && <p className="text-sm"><UiText id="admin.m2d4069e73ec4" />{batchPlan.unavailable.join("、")}</p>}
            {message && <p role="alert" className="text-sm">{uiError(message)}</p>}
          </fieldset>
        </ConfirmDialog></UiProps>
      )}
      {data && (
        <UiProps ids={{"title":["admin.m56d1f0202b06"],"confirmText":["admin.m61f035aec29c","admin.mc0b3fbff51cc"],"cancelText":["admin.m2cd0f3be8738"]}}><ConfirmDialog
          open={draftsOpen || !!selected}
          placement="right"
          focusPanelOnOpen
          title={
            selected
              ? selected.label + " · " + selected.providerName
              : "admin.m56d1f0202b06"
          }
          confirmText={selected ? "admin.m61f035aec29c" : "admin.mc0b3fbff51cc"}
          showCancel={!!selected}
          cancelText="admin.m2cd0f3be8738"
          confirmDisabled={busy || (!!selected && !priceReady)}
          onClose={() => {
            if (selected) closePrice();
            else if (!busy) setDraftsOpen(false);
          }}
          onConfirm={async () => {
            if (!selected) {
              setDraftsOpen(false);
              return false;
            }
            if (
              await post({
                action: "prices",
                draftId,
                provider: selected.provider,
                model: selected.model,
                module: selected.module,
                label: selected.label,
                currency,
                effectiveDate,
                notes,
                rows,
              })
            )
              setSelected(null);
            return false;
          }}
        >
          {selected ? (
            <fieldset disabled={busy} className="min-w-0 space-y-4">
              <p className="text-xs text-[var(--app-muted)]"><UiText id="admin.m2cc8dd712666" /></p>
              {message && (
                <p role="status" className="text-sm">
                  {uiError(message)}
                </p>
              )}{" "}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs"><UiText id="admin.m2f5cbab11476" /><FrostedSelect
                    showLeading={false}
                    ariaLabel={tLabel("价格币种")}
                    value={currency}
                    onChange={setCurrency}
                    options={[
                      { value: "CNY", label: tLabel("人民币") },
                      { value: "USD", label: tLabel("美元") },
                      { value: "EUR", label: tLabel("欧元") },
                      { value: "HKD", label: tLabel("港币") },
                      { value: "CREDIT", label: tLabel("积分") },
                    ]}
                  />
                </label>
                <div className="text-xs"><UiText id="admin.mc728162f60af" /><DateRangePicker
                    single
                    ariaLabel={tLabel("价格生效日期")}
                    from={effectiveDate}
                    to=""
                    onFromChange={setEffectiveDate}
                    onToChange={() => {}}
                  />
                </div>
                <div className="text-xs sm:col-span-2">
                  <div className="mb-1"><UiText id="admin.m787884fceae9" /></div>
                  <details key={selected.key} className="group rounded-lg border border-[var(--border)] bg-[var(--input-bg)]">
                    <UiProps ids={{"aria-label":["admin.m9f2d858b844e"]}}><summary aria-label="admin.m9f2d858b844e" className="flex h-10 cursor-pointer list-none items-center gap-3 px-3 text-sm hover:bg-[var(--panel-2)] [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0 flex-1 truncate text-[var(--app-muted)]">{notes || <UiText id="admin.m376d6c8728c3" />}</span>
                      <ChevronDown size={15} aria-hidden="true" className="shrink-0 text-[var(--app-muted)] transition-transform group-open:rotate-180" />
                    </summary></UiProps>
                    <div className="border-t border-[var(--border)] p-3">
                      <UiProps ids={{"aria-label":["admin.m787884fceae9"],"placeholder":["admin.m26fe90ca3fb9"]}}><textarea
                        aria-label="admin.m787884fceae9"
                        className="min-h-32 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--input-bg)] p-3 text-sm leading-6 text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary-bg)]"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="admin.m26fe90ca3fb9"
                      /></UiProps>
                    </div>
                  </details>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <UiProps ids={{"aria-label":["admin.m854b53e2dcc9"],"placeholder":["admin.m7666a42d2a2a"]}}><input
                  className={`${field} max-w-36`}
                  aria-label="admin.m854b53e2dcc9"
                  placeholder="admin.m7666a42d2a2a"
                  type="number"
                  min="0"
                  step="0.000001"
                  value={samePrice}
                  onChange={(e) => setSamePrice(e.target.value)}
                /></UiProps>
                <button
                  className={button}
                  disabled={samePrice === ""}
                  onClick={() =>
                    setRows(rows.map((r) => ({ ...r, price: samePrice })))
                  }
                ><UiText id="admin.ma7af2306ff40" /></button>
                {!rows.some((r) => r.unitType.endsWith("_million_token")) &&
                  selected.module !== "agent" &&
                  selected.model !== "minimax-h3" && (
                    <button
                      className={button}
                      disabled={samePrice === ""}
                      onClick={() =>
                        setRows([
                          {
                            conditions: {},
                            label: "全部参数同价（已确认）",
                            unitType: rows[0]?.unitType || "image",
                            price: samePrice,
                          },
                        ])
                      }
                    ><UiText id="admin.mc60a94478de1" /></button>
                  )}
                <button
                  className={button}
                  onClick={() => setRows(getRows(selected))}
                ><UiText id="admin.m0321d1ae566b" /></button>
              </div>
              {!rows.some((r) => r.unitType.endsWith("_million_token")) &&
                selected.module !== "agent" &&
                selected.model !== "minimax-h3" && (
                  <label className="block max-w-xs text-xs"><UiText id="admin.mac4ad86510d9" /><FrostedSelect
                      showLeading={false}
                      ariaLabel={tLabel("模型计费单位")}
                      value={rows[0]?.unitType || "request"}
                      onChange={(v) =>
                        setRows(rows.map((row) => ({ ...row, unitType: v })))
                      }
                      options={(selected.module === "image"
                        ? ["image", "request"]
                        : selected.module === "audio"
                          ? ["second", "request", "ten_thousand_character"]
                          : selected.module === "video"
                            ? ["video", "second", "minute", "million_token", "request"]
                            : ["request", "image"]
                      ).map((value) => ({
                        value,
                        label: String(data.units[value]),
                      }))}
                    />
                  </label>
                )}
              <div className="space-y-3">
                {rows.map((r, i) => (
                  <div
                    key={i}
                    className="grid items-center gap-2 border-b border-[var(--border)] pb-2 sm:grid-cols-[minmax(0,1fr)_100px_150px]"
                  >
                    <div className="text-xs">{r.label}</div>
                    <span className="text-xs">{data.units[r.unitType]}</span>
                    <label className="flex items-center gap-2 text-xs">
                      <UiProps ids={{"placeholder":["admin.mca8611d8d1b3"]}}><input
                        aria-label={tLabel(`${r.label}价格`)}
                        className={field}
                        type="number"
                        min="0"
                        step="0.000001"
                        value={r.price}
                        placeholder="admin.mca8611d8d1b3"
                        onChange={(e) =>
                          setRows(
                            rows.map((row, n) =>
                              n === i ? { ...row, price: e.target.value } : row,
                            ),
                          )
                        }
                      /></UiProps>
                      {currency}
                    </label>
                  </div>
                ))}
              </div>
              <details>
                <summary className="cursor-pointer text-sm"><UiText id="admin.m3ef872ddb263" />{selected.rules.length}<UiText id="admin.m6fb2840d568a" /></summary>
                <div className="mt-3 max-h-64 space-y-2 overflow-y-auto text-xs">
                  {selected.rules.map((r: any) => (
                    <div key={r.id}>
                      {uiLabel(conditionLabel(r.matchConditions || {}))} · {r.currency}{" "}
                      {r.unitPrice} / {data.units[r.unitType]} ·{" "}
                      {new Date(r.effectiveFrom).toLocaleString(uiLocale === "en" ? "en-US" : "zh-CN", {
                        timeZone: "Asia/Shanghai",
                      })}{" "}<UiText id="admin.m65edbf9f1c67" />{" "}
                      {r.effectiveTo
                        ? new Date(r.effectiveTo).toLocaleString(uiLocale === "en" ? "en-US" : "zh-CN", {
                            timeZone: "Asia/Shanghai",
                          })
                        : <UiText id="admin.mc9804277773f" />}{" "}
                      · {r.notes}
                    </div>
                  ))}
                </div>
              </details>
            </fieldset>
          ) : (
            <>
              {message && (
                <div role="status" className="text-xs text-[var(--app-muted)]">
                  {uiError(message)}
                </div>
              )}
              {draftsPanel}
            </>
          )}
        </ConfirmDialog></UiProps>
      )}
      {data && (
        <UiProps ids={{"title":["admin.md87f39770873"],"confirmText":["admin.mb808df144f29"]}}><ConfirmDialog
          open={ratesOpen}
          placement="right"
          focusPanelOnOpen
          title="admin.md87f39770873"
          confirmText="admin.mb808df144f29"
          onClose={closeRate}
          confirmDisabled={
            busy ||
            !rateForm.provider ||
            !rateForm.effectiveDate ||
            !Number.isFinite(Number(rateForm.rate)) ||
            Number(rateForm.rate) <= 0
          }
          onConfirm={async () => {
            if (await post({ action: "rate", rateDraftId, ...rateForm }))
              setRatesOpen(false);
            return false;
          }}
        >
          <fieldset disabled={busy} className="min-w-0 space-y-4">
            {message && (
              <p role="status" className="text-sm">
                {uiError(message)}
              </p>
            )}{" "}
            <p className="my-3 text-xs text-[var(--app-muted)]"><UiText id="admin.mdbb7f4304b62" /></p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs"><UiText id="admin.m033ed5945254" /><FrostedSelect
                  showLeading={false}
                  ariaLabel={tLabel("换算供应商")}
                  value={rateForm.provider}
                  onChange={(v) => setRateForm({ ...rateForm, provider: v })}
                  options={providers}
                />
              </label>
              <label className="text-xs"><UiText id="admin.m9677f386bdcd" /><FrostedSelect
                  showLeading={false}
                  ariaLabel={tLabel("换算币种")}
                  value={rateForm.currency}
                  onChange={(v) => setRateForm({ ...rateForm, currency: v })}
                  options={[
                    { value: "USD", label: tLabel("美元 USD") },
                    { value: "EUR", label: tLabel("欧元 EUR") },
                    { value: "HKD", label: tLabel("港币 HKD") },
                    { value: "CREDIT", label: tLabel("积分") },
                  ]}
                />
              </label>
              <label className="text-xs"><UiText id="admin.ma0fc16cb523e" /><input
                  className={field}
                  type="number"
                  min="0"
                  step="0.000001"
                  value={rateForm.rate}
                  onChange={(e) =>
                    setRateForm({ ...rateForm, rate: e.target.value })
                  }
                />
              </label>
              <div className="text-xs"><UiText id="admin.mff40ff0ee1f0" /><DateRangePicker
                  single
                  ariaLabel={tLabel("换算生效日期")}
                  from={rateForm.effectiveDate}
                  to=""
                  onToChange={() => {}}
                  onFromChange={(value) =>
                    setRateForm({
                      ...rateForm,
                      effectiveDate: value,
                    })
                  }
                />
              </div>
            </div>
            <UiProps ids={{"aria-label":["admin.m985e7360410c"],"placeholder":["admin.m1b8c4d690303"]}}><input
              aria-label="admin.m985e7360410c"
              className={`${field} my-3`}
              placeholder="admin.m1b8c4d690303"
              value={rateForm.notes}
              onChange={(e) =>
                setRateForm({ ...rateForm, notes: e.target.value })
              }
            /></UiProps>
            <div className="mt-4 space-y-2 text-xs">
              <p className="text-[var(--app-muted)]"><UiText id="admin.ma5b1e4db05ad" /></p>
              {!data.settings.rates.some(
                (r: any) => r.provider === rateForm.provider,
              ) && <p><UiText id="admin.m9c9d2af9f03e" /></p>}
              {[...data.settings.rates]
                .filter((r: any) => r.provider === rateForm.provider)
                .reverse()
                .map((r: any) => (
                  <div key={r.id}>
                    {providers.find((p) => p.value === r.provider)?.label ||
                      r.provider}{" "}
                    · 1 {r.currency} = ¥{r.rate} ·{" "}
                    {new Date(r.effectiveFrom).toLocaleDateString(uiLocale === "en" ? "en-US" : "zh-CN", {
                      timeZone: "Asia/Shanghai",
                    })}{" "}<UiText id="admin.m058fae8f8f5f" />{r.notes}
                  </div>
                ))}
            </div>
          </fieldset>
        </ConfirmDialog></UiProps>
      )}
      {data && (
        <UiProps ids={{"title":["admin.mae36636749b0"],"confirmText":["admin.m8b4061675a5d","admin.mc535253ff2d9"]}}><ConfirmDialog
          open={modeOpen}
          placement="right"
          focusPanelOnOpen
          title="admin.mae36636749b0"
          confirmText={
            data.settings.mode === "strict"
              ? "admin.m8b4061675a5d"
              : "admin.mc535253ff2d9"
          }
          confirmDisabled={
            busy || (data.settings.mode !== "strict" && blockers.length > 0)
          }
          onClose={() => {
            if (!busy) setModeOpen(false);
          }}
          onConfirm={async () => {
            if (
              await post({
                action: "mode",
                mode: data.settings.mode === "strict" ? "observe" : "strict",
              })
            )
              setModeOpen(false);
            return false;
          }}
        >
          <div className="space-y-4 text-sm">
            <p><UiText id="admin.m5e8e9f2bcd2e" /></p>
            <p><UiText id="admin.m660648805666" />{data.settings.mode === "strict" ? <UiText id="admin.m5523411a17e9" /> : <UiText id="admin.me4c2a1d0de0b" />}{" "}
              ·{" "}
              {blockers.length
                ? "有 " + blockers.length + " 个启用模型待补齐"
                : <UiText id="admin.me1de3ceac64b" />}
            </p>
            {message && <p role="status">{uiError(message)}</p>}
            {blockers.map((m) => (
              <div key={m.key} className="border-b border-[var(--border)] py-3">
                <div>
                  {m.providerName} · {m.label}
                </div>
                <div className="mt-1 text-xs text-[var(--app-muted)]">
                  {[
                    ...new Set(m.slots.map((s) => s.missing).filter(Boolean)),
                  ].join("、")}
                </div>
              </div>
            ))}
            <p className="text-xs text-[var(--app-muted)]"><UiText id="admin.m3790eabeb339" /></p>
          </div>
        </ConfirmDialog></UiProps>
      )}
      <UiProps ids={{"title":["admin.m46c8da8a29de"],"description":["admin.m7e60c7943aaf"],"confirmText":["admin.m9b7824cefa1e"],"cancelText":["admin.mfd4b9e3b6c68"]}}><ConfirmDialog
        open={discardTarget !== null}
        title="admin.m46c8da8a29de"
        description="admin.m7e60c7943aaf"
        confirmText="admin.m9b7824cefa1e"
        cancelText="admin.mfd4b9e3b6c68"
        onClose={() => setDiscardTarget(null)}
        onConfirm={() => {
          if (discardTarget === "price") setSelected(null);
          else setRatesOpen(false);
          setDiscardTarget(null);
        }}
      /></UiProps>
    </div>
  );
}
