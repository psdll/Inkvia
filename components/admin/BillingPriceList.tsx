"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { FrostedSelect } from "@/components/ui/frosted-select";
import type { BillingModel } from "@/lib/billing/catalog";
import type { PriceDraft } from "@/lib/billing/drafts";
import { sortAdminProviders } from "@/lib/providers/order";
import { buildPriceSheets, filterSheetEntries, priceSheetEntries, priceCellVariants, type SheetPrice } from "./billing-price-sheet";
import { priceConditionLabel } from "./billing-price-display";
import styles from "./BillingPriceList.module.css";

const control = "inline-flex h-7 shrink-0 items-center rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2 text-[11px] hover:bg-[var(--panel-2)] disabled:opacity-50";
const modules: Record<string, string> = { image: "图片", video: "视频", agent: "对话 / Agent", audio: "音频", face: "人脸" };
const currencyLabel = (currency: string) => currency === "CREDIT" ? "积分" : currency || "币种待设置";
const cellClass = "border-b border-r border-[var(--border)] px-2 py-1.5 last:border-r-0";

function priceDescription(entry: SheetPrice) {
  const status = entry.draft ? (entry.catalogModel ? "待生效草稿" : "草稿 · 未接入") : entry.price == null ? "未配置" : "当前生效";
  const date = entry.effectiveFrom ? new Date(entry.effectiveFrom).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "";
  return [...new Set([entry.label, priceConditionLabel(entry.conditions), status, entry.price == null ? "" : entry.price === "" ? "未填写" : `${currencyLabel(entry.currency)} ${entry.price}`, entry.missing, date && `生效日期 ${date}`].filter(Boolean))].join(" · ");
}

function compactCondition(label: string) {
  const threshold = (value: string) => Number(value) % 1000 === 0 ? `${Number(value) / 1000}k` : value;
  return label.replace(/上游模型 gpt-image-2\.5-flare/g, "Flare").replace(/上游模型 gpt-image-2\.5-sunburst/g, "Sunburst")
    .replace(/上游模型 qwen-image-3\.0-pro/g, "Pro").replace(/上游模型 qwen-image-3\.0/g, "标准")
    .replace(/高峰（北京时间工作日 09–12、14–18，节假日除外）/g, "高峰")
    .replace(/空闲（其余时段、周末及节假日）/g, "空闲")
    .replace(/北京时间 /g, "").replace(/输入不超过 (\d+) token/g, (_, value) => `≤${threshold(value)}`).replace(/输入超过 (\d+) token/g, (_, value) => `>${threshold(value)}`)
    .replace(/08:00–22:00/g, "日间").replace(/22:00–次日08:00/g, "夜间")
    .replace(/有参考视频（输入\+输出总秒数）/g, "含视频·输入+输出秒数");
}

export default function BillingPriceList({ header, models, drafts, units, busy, onManageDrafts, onEditModel, onEditDraft }: {
  header?: React.ReactNode;
  models: BillingModel[];
  drafts: PriceDraft[];
  units: Record<string, string>;
  busy: boolean;
  onManageDrafts: () => void;
  onEditModel: (model: BillingModel) => void;
  onEditDraft: (model: BillingModel, draft: PriceDraft) => void;
}) {
  const { label: tLabel } = useUiLocale();
  const { label: uiLabel } = useUiLocale();
  const [search, setSearch] = React.useState("");
  const [provider, setProvider] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [capacity, setCapacity] = React.useState(8);
  const viewport = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const element = viewport.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setCapacity(Math.max(4, Math.floor((entry.contentRect.width - 180) / 116)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const entries = React.useMemo(() => priceSheetEntries(models, drafts), [models, drafts]);
  const providers = React.useMemo(() => sortAdminProviders([...new Map(entries.map((entry) => [entry.provider, {
    id: entry.provider, value: entry.provider, label: entry.providerName, sortOrder: entry.providerSortOrder,
  }])).values()]), [entries]);
  const filtered = React.useMemo(() => filterSheetEntries(entries, search, provider, status), [entries, search, provider, status]);
  const sheets = React.useMemo(() => buildPriceSheets(filtered, units, capacity), [filtered, units, capacity]);
  const modelCount = new Set(filtered.map((entry) => entry.modelKey)).size;
  const draftCount = new Set(filtered.flatMap((entry) => entry.draft ? [entry.draft.id] : [])).size;

  function edit(entry: SheetPrice) {
    if (!entry.catalogModel) return;
    if (entry.draft) onEditDraft(entry.catalogModel, entry.draft);
    else onEditModel(entry.catalogModel);
  }

  return <UiProps ids={{"aria-label":["admin.m155a85302114"]}}><section aria-label="admin.m155a85302114" className={`${styles.sheet} flex min-h-0 min-w-0 flex-1 flex-col gap-2`}>
    <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2">
      {header}
      <div className="flex min-w-0 flex-1 basis-[400px] flex-wrap items-center gap-1.5">
        <UiProps ids={{"aria-label":["admin.mfe6f1164a431"],"placeholder":["admin.m48e5005beed4"]}}><input aria-label="admin.mfe6f1164a431" placeholder="admin.m48e5005beed4" value={search} onChange={(event) => setSearch(event.target.value)}
          className="h-7 w-48 max-w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2 text-[11px] text-[var(--app-fg)]" /></UiProps>
        <FrostedSelect compact buttonClassName="!h-7 !rounded-lg" showLeading={false} ariaLabel={tLabel("清单供应商")} value={provider} onChange={setProvider}
          options={[{ value: "", label: tLabel("全部供应商") }, ...providers]} />
        <FrostedSelect compact buttonClassName="!h-7 !rounded-lg" showLeading={false} ariaLabel={tLabel("清单价格状态")} value={status} onChange={setStatus}
          options={[{ value: "all", label: tLabel("全部状态") }, { value: "current", label: tLabel("有当前价格") }, { value: "draft", label: tLabel("有草稿") }, { value: "missing", label: tLabel("待补齐") }]} />
        <span role="status" className="whitespace-nowrap text-[11px] text-[var(--app-muted)]">{modelCount}<UiText id="admin.m74b2be2ffbcf" />{draftCount}<UiText id="admin.mff66c9f4be44" /></span>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <UiProps ids={{"title":["admin.m51b8acab35bb"]}}><a href="/api/admin/billing/catalog?export=migration" download className={control} title="admin.m51b8acab35bb"><UiText id="admin.m03f536afbe9c" /></a></UiProps>
        <UiProps ids={{"title":["admin.meb39db89ae54"]}}><a href="/api/admin/billing/catalog?export=all" download className={control} title="admin.meb39db89ae54"><UiText id="admin.md97210c26098" /></a></UiProps>
        <button type="button" className={control} disabled={busy} onClick={onManageDrafts}><UiText id="admin.md2597253f5f4" /></button>
      </div>
    </div>
    <div className="flex shrink-0 flex-wrap gap-x-5 gap-y-1 text-[11px] text-[var(--app-muted)]">
      <span><UiText id="admin.m68ecfb11849e" /><span className={styles.draft}><UiText id="admin.m0ec533a0aeef" /></span></span>
      <span><UiText id="admin.meee59cbb8b0f" /></span>
      <span><UiText id="admin.ma0f69a1b69c9" /></span>
    </div>
    <UiProps ids={{"aria-label":["admin.me173e7d27e68"]}}><div ref={viewport} aria-label="admin.me173e7d27e68" className="min-h-0 min-w-0 flex-1 space-y-4 overflow-auto pb-1">
      {sheets.map((sheet) => {
        const providerGroups: { key: string; label: string; count: number }[] = [];
        for (const column of sheet.columns) {
          const previous = providerGroups[providerGroups.length - 1];
          if (previous?.key === column.provider) previous.count++;
          else providerGroups.push({ key: column.provider, label: column.providerName, count: 1 });
        }
        const title = `${modules[sheet.module] || sheet.module} · ${currencyLabel(sheet.currency)} · ${units[sheet.unit] || sheet.unit || "计费单位待设置"}`;
        return <section key={sheet.key} aria-label={title} className="rounded-lg border border-[var(--border)]">
          <div className={`${styles.groupHeading} flex items-center justify-between gap-3 rounded-t-lg px-3 py-1.5`}>
            <h3 className="text-xs font-medium">{title}</h3><span className="shrink-0 text-[11px] text-[var(--app-muted)]">{sheet.columns.length}<UiText id="admin.m5ad00154b569" /></span>
          </div>
          <div className="overflow-x-auto rounded-b-lg">
            <table aria-label={title} className="w-full table-fixed border-separate border-spacing-0 text-right text-xs leading-4" style={{ minWidth: 180 + sheet.columns.length * 116 }}>
              <colgroup><col style={{ width: 180 }} />{sheet.columns.map((column) => <col key={column.modelKey} />)}</colgroup>
              <thead className="bg-[var(--panel-2)]">
                <tr>
                  <th scope="col" rowSpan={2} className={`${cellClass} sticky left-0 z-10 bg-[var(--panel-2)] text-left font-normal text-[var(--app-muted)]`}><UiText id="admin.m4f96376b64ae" /></th>
                  {providerGroups.map((group) => <th key={group.key} scope="colgroup" colSpan={group.count} className={`${cellClass} text-center text-[11px] font-normal text-[var(--app-muted)]`}>{uiLabel(group.label)}</th>)}
                </tr>
                <tr>{sheet.columns.map((column) => <th key={column.modelKey} scope="col" className={`${cellClass} align-top text-center font-medium`}>
                  <button type="button" className={`${styles.model} w-full break-words text-[var(--app-fg)] disabled:cursor-default [overflow-wrap:anywhere]`} disabled={busy || !column.catalogModel}
                    title={`${column.label}（${column.model}）`} aria-label={tLabel(`编辑 ${column.label}`)} onClick={() => { if (column.catalogModel) onEditModel(column.catalogModel); }}>{uiLabel(column.label)}</button>
                  {!column.catalogModel && <span className={`${styles.draft} mt-1 block text-[11px] font-normal`}><UiText id="admin.maf33de3507b4" /></span>}
                </th>)}</tr>
              </thead>
              <tbody>{sheet.rows.map((row) => <tr key={row.key} className="group">
                <th scope="row" className={`${cellClass} sticky left-0 z-10 break-words bg-[var(--panel-2)] text-left text-[11px] font-normal text-[var(--app-muted)] [overflow-wrap:anywhere]`}>{uiLabel(row.label)}</th>
                {sheet.columns.map((column) => {
                  const prices = row.cells.get(column.modelKey) || [];
                  const variants = priceCellVariants(prices);
                  return <td key={column.modelKey} className={`${cellClass} bg-[var(--panel-bg)] align-middle tabular-nums group-hover:bg-[var(--panel-2)]`}>
                    {!prices.length ? <span className="text-[var(--app-muted)]">—</span> : <div className="space-y-1">
                      {variants.map((variant, variantIndex) => {
                        const pending = variant.prices.filter((entry) => entry.draft);
                        return <div key={variantIndex} className="flex flex-wrap items-baseline justify-end gap-x-1 gap-y-0.5">
                          {variant.label && <span title={variant.label} className="break-words text-[11px] leading-4 text-[var(--app-muted)] [overflow-wrap:anywhere]">{compactCondition(variant.label)}</span>}
                      {variant.prices.map((entry, index) => <React.Fragment key={entry.key}>
                        {index > 0 && <span aria-hidden="true" className="text-[var(--app-muted)]">/</span>}
                        <button type="button" aria-label={priceDescription(entry)} title={[priceDescription(entry), entry.draft?.notes].filter(Boolean).join("\n")} disabled={busy || !entry.catalogModel} onClick={() => edit(entry)}
                          className={`break-all text-right hover:underline disabled:cursor-default ${entry.draft ? styles.draft : entry.price == null ? "text-[var(--app-muted)]" : "font-medium"}`}>
                          {entry.draft && (!variant.prices.some((price) => !price.draft) || pending.length > 1) && <span className="mr-1 text-[11px]"><UiText id="admin.m2a2fd29bd27a" />{pending.length > 1 ? pending.indexOf(entry) + 1 : ""}</span>}
                          {entry.price == null ? <UiText id="admin.mf65711a17954" /> : entry.price === "" ? <UiText id="admin.m64747fab2c8f" /> : entry.price}
                          {entry.price != null && entry.price !== "" && entry.missing && <span className={`${styles.draft} ml-1 text-[11px]`}>{entry.missing}</span>}
                        </button>
                      </React.Fragment>)}
                        </div>;
                      })}
                    </div>}
                  </td>;
                })}
              </tr>)}</tbody>
            </table>
          </div>
          {sheet.unit === "million_token" && sheet.columns.some(column => column.provider === "openrouter") && <p className="border-t border-[var(--border)] px-3 py-1 text-[11px] text-[var(--app-muted)]"><UiText id="admin.ma90d92eeb29e" /></p>}
          {sheet.rows.some((row) => [...row.cells.values()].flat().some((entry) => ["inputBand", "minimaxInputBand"].some((key) => key in entry.conditions))) && <p className="border-t border-[var(--border)] px-3 py-1 text-[11px] text-[var(--app-muted)]">≤ / &gt; 档位按输入 token 数区分，k = 1,000。</p>}
          {sheet.rows.some((row) => [...row.cells.values()].flat().some((entry) => "timeBand" in entry.conditions)) && <p className="border-t border-[var(--border)] px-3 py-1 text-[11px] text-[var(--app-muted)]"><UiText id="admin.mdcb0932024bf" /></p>}
          {sheet.rows.some((row) => [...row.cells.values()].flat().some((entry) => "deepseekTimeBand" in entry.conditions)) && <p className="border-t border-[var(--border)] px-3 py-1 text-[11px] text-[var(--app-muted)]"><UiText id="admin.m732a9ef8107f" /></p>}
        </section>;
      })}
      {!sheets.length && <p className="py-12 text-center text-sm text-[var(--app-muted)]"><UiText id="admin.m0e5d8ae3bf0b" /></p>}
    </div></UiProps>
  </section></UiProps>;
}
