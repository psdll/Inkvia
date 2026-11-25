import { createHash } from "node:crypto";
import { DRAFT_FORMAT, LEGACY_DRAFT_FORMAT, mergeDrafts, validateDraft, type PriceDraft } from "./drafts";
import { conditionKey, resolveExchangeRate, validatePrice, type BillingSettings, type ExchangeRate } from "./money";
import type { BillingModel } from "./catalog";
import { LEGACY_PRICE_BACKUP_FORMAT, MAX_PRICE_FILE_BYTES, MAX_PRICE_FILE_ENTRIES, PRICE_BACKUP_FORMAT, type PriceImportItem } from "./migration-contracts";

type CatalogModel = { provider: string; model: string; module: string; label: string; aliases?: string[] };

// A deployable snapshot, separate from the lossless archive. Catalog slots resolve
// priority and overlapping historical rules before prices cross environments.
export function exportCurrentPrices(settings: BillingSettings, catalog: BillingModel[], at = new Date()) {
  const drafts: PriceDraft[] = [];
  const rates = new Map<string, ExchangeRate>();
  const missing: { provider: string; model: string; slot: string; reason: string }[] = [];
  for (const model of catalog.filter(m => !m.historical)) {
    const groups = new Map<string, { rows: PriceDraft["rows"]; notes: Set<string>; keys: Set<string> }>();
    for (const slot of model.slots) {
      const rule = slot.rule;
      if (slot.missing) missing.push({ provider: model.provider, model: model.model, slot: slot.label, reason: slot.missing });
      if (!rule) continue;
      const currency = rule.currency;
      if (!groups.has(currency)) groups.set(currency, { rows: [], notes: new Set(), keys: new Set() });
      const group = groups.get(currency)!;
      const conditions = slot.conditions;
      const key = `${rule.unitType}|${conditionKey(conditions)}`;
      if (!group.keys.has(key)) {
        group.keys.add(key);
        group.rows.push({ unitType: rule.unitType, price: String(rule.unitPrice), conditions });
      }
      if (rule.notes) group.notes.add(String(rule.notes));
      if (currency !== "CNY") {
        const rate = resolveExchangeRate(settings.rates, model.provider, currency, at);
        if (rate && "provider" in rate) rates.set(`${model.provider}|${currency}`, rate);
      }
    }
    for (const [currency, group] of groups) drafts.push(validateDraft({
      provider: model.provider, model: model.model, module: model.module, label: model.label,
      currency, rows: group.rows, notes: [...group.notes].join("\n\n"),
    }));
  }
  return { format: PRICE_BACKUP_FORMAT, purpose: "current-price-migration", exportedAt: at.toISOString(),
    drafts, prices: [], rates: [...rates.values()], rateDrafts: [], missing };
}

export function exportAllPrices(settings: BillingSettings, rules: any[]) {
  return {
    format: PRICE_BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    drafts: settings.drafts || [],
    prices: rules.map((rule) => ({
      provider: rule.provider, model: rule.model, module: rule.module,
      displayName: rule.displayName, currency: rule.currency,
      unitType: rule.unitType, unitPrice: String(rule.unitPrice),
      matchConditions: rule.matchConditions, priority: rule.priority,
      isActive: rule.isActive, effectiveFrom: new Date(rule.effectiveFrom).toISOString(),
      effectiveTo: rule.effectiveTo ? new Date(rule.effectiveTo).toISOString() : null,
      notes: rule.notes,
    })),
    rates: settings.rates,
    rateDrafts: settings.rateDrafts || [],
  };
}

function readFile(input: any) {
  if (!input || ![DRAFT_FORMAT, LEGACY_DRAFT_FORMAT, PRICE_BACKUP_FORMAT, LEGACY_PRICE_BACKUP_FORMAT].includes(input.format))
    throw new Error("请选择价格导出文件，支持旧版草稿与完整价格文件");
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > MAX_PRICE_FILE_BYTES)
    throw new Error("价格文件不得超过 10 MB");
  const keys = input.format === DRAFT_FORMAT || input.format === LEGACY_DRAFT_FORMAT ? ["drafts"] : ["drafts", "prices", "rates", "rateDrafts"];
  for (const key of keys) {
    if (!Array.isArray(input[key])) throw new Error(`价格文件缺少 ${key} 列表`);
  }
  if (keys.reduce((sum, key) => sum + input[key].length, 0) > MAX_PRICE_FILE_ENTRIES)
    throw new Error("价格文件条目过多，请拆分后导入");
  return input;
}

function rateDraft(input: any): ExchangeRate {
  if (!input || typeof input.provider !== "string" || !input.provider.trim() || input.provider.length > 300
    || typeof input.currency !== "string" || !/^(?:[A-Z]{3}|CREDIT)$/.test(input.currency) || input.currency === "CNY"
    || typeof input.effectiveFrom !== "string" || !Number.isFinite(Date.parse(input.effectiveFrom))
    || (input.notes != null && (typeof input.notes !== "string" || input.notes.length > 10000)))
    throw new Error("换算记录无效");
  const rate = validatePrice(input.rate, "换算比例");
  if (Number(rate) <= 0) throw new Error("换算比例必须大于零");
  const value = { provider: input.provider.trim(), currency: input.currency, rate,
    effectiveFrom: new Date(input.effectiveFrom).toISOString(), notes: input.notes || "" };
  return { id: createHash("sha256").update(JSON.stringify(value)).digest("hex"), ...value };
}

export function planPriceImport(input: unknown, settings: BillingSettings, catalog: CatalogModel[], units: Record<string, string>) {
  const file = readFile(input);
  const items: PriceImportItem[] = [];
  const incoming: PriceDraft[] = [];
  const incomingRates: ExchangeRate[] = [];
  const knownDrafts = new Set((settings.drafts || []).map((draft) => draft.id));
  const knownRates = new Set([...(settings.rateDrafts || []), ...settings.rates].map((rate) => rateDraft(rate).id));
  const candidates: { kind: "draft" | "price"; value: any }[] = file.drafts.map((value: any) => ({ kind: "draft", value }));
  // Keep versions and source states separate; importing never activates historical prices.
  const versions = new Map<string, any>();
  for (const rule of file.prices || []) {
    if (!rule || typeof rule !== "object") {
      candidates.push({ kind: "price", value: rule });
      continue;
    }
    const sourceVersion = { effectiveFrom: rule.effectiveFrom, effectiveTo: rule.effectiveTo,
      isActive: rule.isActive, priority: rule.priority };
    const data = { provider: rule.provider, model: rule.model, module: rule.module,
      label: rule.displayName || rule.model, currency: rule.currency, notes: rule.notes || "", sourceVersion };
    const key = JSON.stringify(data);
    if (!versions.has(key)) versions.set(key, { ...data, rows: [] });
    versions.get(key).rows.push({ conditions: rule.matchConditions ?? {}, unitType: rule.unitType, price: rule.unitPrice });
  }
  for (const value of versions.values()) candidates.push({ kind: "price", value });
  for (const { kind, value } of candidates) {
    const item: PriceImportItem = { kind, provider: String(value?.provider || ""), model: String(value?.model || ""),
      label: String(value?.label || value?.model || "无法识别的价格"), status: "failed", reason: "", filledRows: 0, missingRows: 0 };
    items.push(item);
    try {
      let draft = validateDraft(value);
      item.filledRows = draft.rows.filter((row) => row.price !== "").length;
      item.missingRows = draft.rows.length - item.filledRows;
      item.sourceDate = draft.sourceVersion?.effectiveFrom;
      const model = catalog.find((model) => model.provider === draft.provider && model.module === draft.module
        && (model.model === draft.model || model.aliases?.includes(draft.model)));
      if (!model) {
        item.status = "skipped";
        item.reason = "目标环境未接入该模型或模型分类不匹配";
        continue;
      }
      item.model = model.model;
      if (draft.rows.some((row) => !Object.prototype.hasOwnProperty.call(units, row.unitType))) throw new Error("目标环境不支持该计费单位");
      if (model.model !== draft.model) draft = validateDraft({ ...draft, model: model.model,
        rows: draft.rows.map((row) => ({ ...row, conditions: { ...row.conditions, providerModel: draft.model } })) });
      if (knownDrafts.has(draft.id)) {
        item.status = "existing";
        item.reason = "相同草稿已存在，无需重复导入";
      } else {
        knownDrafts.add(draft.id);
        incoming.push(draft);
        item.status = "ready";
        item.reason = item.missingRows ? `保留 ${item.missingRows} 个未填写档位` : "保存为草稿，待设置生效日期";
      }
    } catch (error) {
      item.reason = error instanceof Error ? error.message : "价格内容无效";
    }
  }
  for (const value of [...(file.rates || []), ...(file.rateDrafts || [])]) {
    const item: PriceImportItem = { kind: "rate", provider: String(value?.provider || ""), model: "",
      label: `${String(value?.currency || "未知币种")} 换算`, status: "failed", reason: "", filledRows: 1, missingRows: 0 };
    items.push(item);
    try {
      const rate = rateDraft(value);
      item.sourceDate = rate.effectiveFrom;
      if (!catalog.some((model) => model.provider === rate.provider)) {
        item.status = "skipped";
        item.reason = "目标环境未接入该供应商";
      } else if (knownRates.has(rate.id)) {
        item.status = "existing";
        item.reason = "相同换算记录已存在";
      } else {
        knownRates.add(rate.id);
        incomingRates.push(rate);
        item.status = "ready";
        item.reason = `1 ${rate.currency} = ¥${rate.rate}，待设置生效日期`;
      }
    } catch (error) {
      item.reason = error instanceof Error ? error.message : "换算记录无效";
    }
  }
  return { drafts: mergeDrafts(settings.drafts || [], incoming),
    rateDrafts: [...(settings.rateDrafts || []), ...incomingRates], report: { items } };
}
