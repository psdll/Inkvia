"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";

import * as React from "react";
import { Download, Upload, ArrowRight, FileText } from "lucide-react";
import type { PriceDraft } from "@/lib/billing/drafts";
import type { ExchangeRate } from "@/lib/billing/money";
import type { BillingModel } from "@/lib/billing/catalog";
import { priceConditionLabel } from "./billing-price-display";
import { MAX_PRICE_FILE_BYTES, type BillingWriteResult, type PriceImportItem, type PriceImportReport } from "@/lib/billing/migration-contracts";
const button =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-xs transition-colors duration-150 hover:border-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-bg)] disabled:pointer-events-none disabled:opacity-50";
const statuses: [PriceImportItem["status"], string][] = [
  ["ready", "可导入"], ["imported", "已导入"], ["existing", "已存在"], ["skipped", "已跳过"], ["failed", "导入失败"],
];
const dateLabel = (date: string) => new Date(date).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
type PriceRow = {
  label: string;
  price: string | null;
  currency: string;
  unitType: string;
  effectiveFrom?: string;
  missing?: string;
};
function PriceRows({ rows, units, label }: { rows: PriceRow[]; units: Record<string, string>; label: string }) {
  const { label: uiLabel } = useUiLocale();
  return <table aria-label={label} className="mt-3 w-full table-fixed text-left text-xs leading-5">
    <thead className="text-[var(--app-muted)]"><tr>
      <th scope="col" className="w-1/2 py-2 pr-3 font-normal"><UiText id="admin.m848ad02417dd" /></th>
      <th scope="col" className="py-2 font-normal"><UiText id="admin.m719e22fa3515" /></th>
    </tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index} className="border-t border-[var(--border)] align-top">
      <td className="py-2 pr-3 [overflow-wrap:anywhere]">{uiLabel(row.label)}</td>
      <td className="py-2 [overflow-wrap:anywhere]">
        <p className="font-medium tabular-nums">{row.price == null ? <UiText id="admin.m80a57e03f071" /> : row.price === "" ? <UiText id="admin.m7f05190592e5" /> : `${row.currency === "CREDIT" ? "积分" : row.currency} ${row.price}`}</p>
        <p className="text-[var(--app-muted)]">{units[row.unitType] || row.unitType}</p>
        {row.effectiveFrom && <p className="text-[var(--app-muted)]">{uiLabel(dateLabel(row.effectiveFrom))}<UiText id="admin.m134e1b4963e0" /></p>}
        {row.missing && row.price != null && <p className="text-[var(--app-muted)]">{row.missing}</p>}
      </td>
    </tr>)}</tbody>
  </table>;
}
function itemSummary(items: PriceImportItem[]) {
  const prices = items.filter((item) => item.kind !== "rate");
  const models = new Set(prices.map((item) => `${item.provider}|${item.model}`)).size;
  const rates = items.length - prices.length;
  const rows = prices.reduce((sum, item) => sum + item.filledRows, 0);
  return [prices.length ? `${models} 个模型 · ${prices.length} 个价格版本 · ${rows} 条已填写规则` : "", rates ? `${rates} 条换算记录` : ""].filter(Boolean).join("；");
}
export default function BillingDraftsPanel({ drafts, rateDrafts = [], models, units = {}, busy, post, onEdit, onEditRate, onPublish, embedded = false }: {
  embedded?: boolean;
  drafts: PriceDraft[];
  rateDrafts?: ExchangeRate[];
  models: BillingModel[];
  units?: Record<string, string>;
  busy: boolean;
  post: (body: any) => Promise<BillingWriteResult | false>;
  onEdit: (draft: PriceDraft) => void;
  onEditRate: (rate: ExchangeRate) => void;
  onPublish: () => void;
}) {
  const { error: uiError, label: uiLabel } = useUiLocale();
  const [file, setFile] = React.useState<any>(null);
  const [error, setError] = React.useState("");
  const [report, setReport] = React.useState<PriceImportReport | null>(null);
  const [fileName, setFileName] = React.useState("");
  const [reading, setReading] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const locked = busy || reading;
  const providerLabel = (provider: string) => models.find((model) => model.provider === provider)?.providerName || provider;
  const draftModels = new Set(drafts.map((draft) => `${draft.provider}|${draft.model}`)).size;
  const filledModels = new Set(drafts.filter((draft) => draft.rows.some((row) => row.price !== "")).map((draft) => `${draft.provider}|${draft.model}`));
  const unrecorded = models.filter((model) => !model.rules.length && !filledModels.has(`${model.provider}|${model.model}`));
  const ready = report?.items.filter((item) => item.status === "ready") || [];
  const Container = embedded ? "div" : "details";
  return (
    <Container className={embedded ? "" : "shrink-0 rounded-xl border border-[var(--border)] p-3"}>
      {!embedded && <summary className="cursor-pointer"><UiText id="admin.m0b4f4ff96437" />{draftModels}<UiText id="admin.mcb8a86f94b5b" /></summary>}
      <div className="space-y-3 border-b border-[var(--border)] pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <a className={button} href="/api/admin/billing/catalog?export=all" download>
            <Download size={14} aria-hidden="true" /><UiText id="admin.md97210c26098" /></a>
          <UiProps ids={{"title":["admin.m5b6d2239dbe4"]}}><a className={button} href="/api/admin/billing/catalog?export=migration" download title="admin.m5b6d2239dbe4">
            <Download size={14} aria-hidden="true" /><UiText id="admin.m03f536afbe9c" /></a></UiProps>
          <button type="button" className={button} disabled={locked} onClick={() => fileInput.current?.click()}>
            <Upload size={14} aria-hidden="true" />{reading ? <UiText id="admin.m5460eab82252" /> : <UiText id="admin.mfa3ecfb7977f" />}
          </button>
          <UiProps ids={{"aria-label":["admin.mda8b81e1317b"]}}><input ref={fileInput} aria-label="admin.mda8b81e1317b" type="file" accept=".json,application/json" disabled={locked} className="hidden"
            onChange={async (e) => {
              const input = e.currentTarget;
              const selected = input.files?.[0];
              input.value = "";
              if (!selected) return;
              setFile(null); setReport(null); setError(""); setFileName(selected.name); setReading(true);
              try {
                if (selected.size > MAX_PRICE_FILE_BYTES) throw Error("价格文件不得超过 10 MB");
                const data = JSON.parse(await selected.text());
                const result = await post({ action: "previewImport", file: data });
                if (result && result.importReport) { setFile(data); setReport(result.importReport); }
              } catch (err) {
                setError(err instanceof SyntaxError ? "文件不是有效的 JSON，请选择导出的价格文件" : err instanceof Error ? err.message : "文件无效");
              } finally { setReading(false); }
            }} /></UiProps>
        </div>
        <p className="text-xs leading-6 text-[var(--app-muted)]"><UiText id="admin.mb26ca0c309bc" /></p>
        <p className="text-xs leading-6 text-[var(--app-muted)]"><UiText id="admin.me693689caaa4" /></p>
        <details className="text-xs text-[var(--app-muted)]">
          <summary className="cursor-pointer"><UiText id="admin.m86515fb5ebf9" /></summary>
          <p className="mt-2 leading-6"><UiText id="admin.mc9c77b63cd5f" /></p>
          <p className="mt-2 leading-6"><UiText id="admin.mcef14facb12c" /></p>
        </details>
      </div>
      {error && <p role="alert" className="mt-3 text-sm">{uiError(error)}</p>}
      {report && <UiProps ids={{"aria-label":["admin.m7f1a08e3a137","admin.me4039a1684cb"]}}><section aria-label={file ? "admin.m7f1a08e3a137" : "admin.me4039a1684cb"} className="mt-4 space-y-3 rounded-xl border border-[var(--border)] p-4">
        <h4 className="break-all text-sm font-medium">{file ? <UiText id="admin.m7f1a08e3a137" /> : <UiText id="admin.me4039a1684cb" />} · {fileName}</h4>
        {file?.purpose === "current-price-migration" && Array.isArray(file.missing) && file.missing.length > 0 && <p role="status" className="text-xs leading-6 text-[var(--app-muted)]"><UiText id="admin.m9dedc0056a22" />{file.missing.length}<UiText id="admin.m77cadb596c57" /></p>}
        <p className="text-xs leading-6 text-[var(--app-muted)]"><UiText id="admin.m04656c447ef6" />{new Set(report.items.map((item) => item.provider).filter(Boolean)).size}<UiText id="admin.mfc834770964e" />{itemSummary(report.items) || <UiText id="admin.m0481e26a39ce" />}</p>
        {statuses.map(([status, label]) => {
          const items = report.items.filter((item) => item.status === status);
          if (!items.length) return null;
          return <details key={status} className="rounded-lg border border-[var(--border)] p-3" open={status === "failed" || status === "skipped"}>
            <summary className="cursor-pointer text-xs leading-6"><span className="font-medium">{label}</span> · {itemSummary(items)}</summary>
            <ul className="mt-2 divide-y divide-[var(--border)]">
              {items.map((item, index) => <li key={index} className="py-2 text-xs leading-6 [overflow-wrap:anywhere]">
                <p>{uiLabel(providerLabel(item.provider))} · {uiLabel(item.label)}</p>
                {item.model && <p className="text-[var(--app-muted)]">{item.model}<UiText id="admin.m9373181311ef" />{item.filledRows}<UiText id="admin.m30d8fd895269" />{item.missingRows ? <UiText id="admin.mc64ffa0e6995" values={{v0: String(item.missingRows)}} /> : ""}</p>}
                {item.sourceDate && <p className="text-[var(--app-muted)]"><UiText id="admin.m6ee412a1fdbe" />{uiLabel(dateLabel(item.sourceDate))}</p>}
                <p className="text-[var(--app-muted)]">{uiLabel(item.reason)}</p>
              </li>)}
            </ul>
          </details>;
        })}
        {file && <div className="flex flex-wrap gap-2">
          <button className={button} disabled={locked || !ready.length} onClick={async () => {
            const result = await post({ action: "importDrafts", file });
            if (result && result.importReport) { setReport(result.importReport); setFile(null); }
          }}><UiText id="admin.m9e5f63316925" /></button>
          <button type="button" className={button} disabled={locked} onClick={() => { setFile(null); setReport(null); }}><UiText id="admin.m2cd0f3be8738" /></button>
        </div>}
      </section></UiProps>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div><h4 className="text-sm font-medium"><UiText id="admin.m67b01dc04975" /></h4>
          <p className="mt-1 text-xs text-[var(--app-muted)]">{draftModels}<UiText id="admin.m74b2be2ffbcf" />{drafts.length}<UiText id="admin.m9fba7be1f3b6" />{rateDrafts.length ? <UiText id="admin.m3084341f32d3" values={{v0: String(rateDrafts.length)}} /> : ""}</p></div>
        <button className={button} disabled={locked || (!filledModels.size && !rateDrafts.length)} onClick={onPublish}><UiText id="admin.m71cfbac9051d" /><ArrowRight size={14} aria-hidden="true" /></button>
      </div>
      <p className="mt-2 text-xs leading-6 text-[var(--app-muted)]"><UiText id="admin.med8cbce2cc23" /></p>
      <div className="mt-3 space-y-3">
        {!drafts.length && !rateDrafts.length && <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--app-muted)]">
          <FileText size={22} className="mx-auto mb-3" aria-hidden="true" /><UiText id="admin.mfe62eedc4f79" /></div>}
        {drafts.map((draft) => <div key={draft.id} className="min-w-0 rounded-xl border border-[var(--border)] p-4">
          <h4 className="break-words text-sm font-medium leading-6">{draft.label}</h4>
          <p className="mt-1 break-words text-xs leading-6 text-[var(--app-muted)]">{uiLabel(providerLabel(draft.provider))} · {draft.model} · {draft.currency}</p>
          <p className="text-xs leading-6 text-[var(--app-muted)]"><UiText id="admin.m8f3899a26798" />{draft.rows.filter((row) => row.price !== "").length}<UiText id="admin.m4a56b12627c1" />{draft.rows.filter((row) => row.price === "").length}<UiText id="admin.m30d8fd895269" /></p>
          <PriceRows label={`${providerLabel(draft.provider)} · ${draft.label}草稿价格`} units={units} rows={draft.rows.map((row) => ({
            label: priceConditionLabel(row.conditions),
            price: row.price, currency: draft.currency, unitType: row.unitType,
          }))} />
          {draft.sourceVersion && <p className="text-xs leading-6 text-[var(--app-muted)]"><UiText id="admin.m36b6d503dd76" />{uiLabel(dateLabel(draft.sourceVersion.effectiveFrom))}<UiText id="admin.m7c6024e432c5" />{draft.sourceVersion.effectiveTo ? <UiText id="admin.mc8144936fe46" values={{v0: String(dateLabel(draft.sourceVersion.effectiveTo))}} /> : ""}{!draft.sourceVersion.isActive ? <UiText id="admin.m5c09659ce632" /> : ""}</p>}
          {draft.notes && <details className="mt-2 text-xs text-[var(--app-muted)]"><summary className="cursor-pointer"><UiText id="admin.m5edb7be5bf23" /></summary><p className="mt-2 whitespace-pre-wrap break-words leading-6 [overflow-wrap:anywhere]">{draft.notes}</p></details>}
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
            <span className="text-xs text-[var(--app-muted)]">{models.some((model) => model.provider === draft.provider && model.model === draft.model) ? <UiText id="admin.m5e267c51bae1" /> : <UiText id="admin.m07415af2d3e7" />}</span>
            <button className={button} disabled={locked || !models.some((model) => model.provider === draft.provider && model.model === draft.model)} onClick={() => onEdit(draft)}><UiText id="admin.mf7aaacb04592" /><ArrowRight size={14} aria-hidden="true" /></button>
          </div>
        </div>)}
        {rateDrafts.map((rate) => <div key={rate.id} className="rounded-xl border border-[var(--border)] p-4 text-xs leading-6">
          <p>{uiLabel(providerLabel(rate.provider))} · 1 {rate.currency} = ¥{rate.rate}</p>
          <p className="text-[var(--app-muted)]"><UiText id="admin.m6ee412a1fdbe" />{uiLabel(dateLabel(rate.effectiveFrom))}<UiText id="admin.me6238e7e59bb" /></p>
          <button className={`${button} mt-2`} disabled={locked} onClick={() => onEditRate(rate)}><UiText id="admin.m25052c1f480a" /></button>
        </div>)}
      </div>
      <details className="mt-5 rounded-xl border border-[var(--border)] p-4 text-xs">
        <summary className="cursor-pointer"><UiText id="admin.m3f290124ec34" />{unrecorded.length}<UiText id="admin.m5ad00154b569" /></summary>
        <p className="mt-2 leading-6 text-[var(--app-muted)]"><UiText id="admin.mf3b74611670d" /></p>
        <ul className="mt-2 space-y-2">{unrecorded.map((model) => <li key={model.key} className="break-words">{model.providerName} · {model.label}（{model.model}）</li>)}</ul>
      </details>
    </Container>
  );
}
