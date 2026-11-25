import type { BillingModel } from "@/lib/billing/catalog";
import type { PriceDraft } from "@/lib/billing/drafts";
import { sortAdminProviders } from "@/lib/providers/order";
import { priceConditionLabel } from "./billing-price-display";

export type SheetPrice = {
  key: string;
  modelKey: string;
  provider: string;
  providerName: string;
  providerSortOrder?: number;
  label: string;
  model: string;
  module: string;
  conditions: Record<string, unknown>;
  unitType: string;
  currency: string;
  price: string | null;
  missing?: string;
  effectiveFrom?: string;
  draft?: PriceDraft;
  catalogModel?: BillingModel;
};

const modelKey = (value: { provider: string; model: string }) => JSON.stringify([value.provider, value.model]);
const unitFamily = (unit: string) => unit.endsWith("million_token") ? "million_token" : unit;
const normalizedValue = (value: unknown) => String(value).trim().toLowerCase();
function conditionsKey(conditions: Record<string, unknown>) {
  return JSON.stringify(Object.entries(conditions).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [
    key, Array.isArray(value) ? [...new Set(value.map(normalizedValue))].sort() : normalizedValue(value),
  ]));
}

// Catalog slots already represent concrete parameter combinations. Expand small
// draft ranges to align with those slots; retain larger ranges intact, never drop them.
function draftConditions(conditions: Record<string, unknown>) {
  const size = Object.values(conditions).reduce<number>((count, value) => count * (Array.isArray(value) ? value.length : 1), 1);
  if (size > 256 || size === 0) return [conditions];
  return Object.entries(conditions).reduce<Record<string, unknown>[]>((rows, [key, value]) =>
    rows.flatMap((row) => (Array.isArray(value) ? [...new Set(value.map(normalizedValue))] : [value]).map((item) => ({ ...row, [key]: item }))), [{}]);
}

export function priceSheetEntries(models: BillingModel[], drafts: PriceDraft[]): SheetPrice[] {
  const entries: SheetPrice[] = [];
  const catalog = new Map(models.map((model) => [modelKey(model), model]));
  const providers = new Map(models.map((model) => [model.provider, model]));
  const draftsByModel = new Map<string, PriceDraft[]>();
  for (const draft of drafts) {
    const key = modelKey(draft);
    draftsByModel.set(key, [...(draftsByModel.get(key) || []), draft]);
  }
  for (const model of models) {
    const seen = new Set<string>();
    const slots = model.slots.length ? model.slots : [{ key: "unconfigured", conditions: {}, unitType: "", rule: null, missing: "缺价格" }];
    for (const slot of slots) {
      const unitType = slot.rule?.unitType || slot.unitType;
      const currencies = new Set([
        ...model.slots.filter((item) => item.rule && unitFamily(item.rule.unitType || item.unitType) === unitFamily(unitType)).map((item) => item.rule.currency),
        ...(draftsByModel.get(modelKey(model)) || []).filter((draft) => draft.rows.some((row) => unitFamily(row.unitType) === unitFamily(unitType))).map((draft) => draft.currency),
      ]);
      // One rule may cover dozens of catalog slots. Show its actual tariff once.
      const conditions = slot.rule?.matchConditions || slot.conditions;
      const identity = JSON.stringify([unitType, conditionsKey(conditions), slot.rule?.currency, slot.rule?.unitPrice, slot.rule?.effectiveFrom, slot.missing]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      draftConditions(conditions).forEach((concrete, index) => entries.push({
        key: `current:${model.key}:${slot.key}:${index}`, modelKey: modelKey(model), provider: model.provider,
        providerName: model.providerName, label: model.label, model: model.model, module: model.module,
        providerSortOrder: model.providerSortOrder,
        conditions: concrete, unitType,
        currency: slot.rule?.currency || (currencies.size === 1 ? [...currencies][0] : ""),
        price: slot.rule ? String(slot.rule.unitPrice) : null,
        missing: slot.missing || (!slot.rule ? "缺价格" : undefined),
        effectiveFrom: slot.rule?.effectiveFrom, catalogModel: model,
      }));
    }
  }
  for (const draft of drafts) {
    const model = catalog.get(modelKey(draft));
    draft.rows.forEach((row, index) => draftConditions(row.conditions).forEach((conditions, conditionIndex) => entries.push({
      key: `draft:${draft.id}:${index}:${conditionIndex}`, modelKey: modelKey(draft), provider: draft.provider,
      providerName: providers.get(draft.provider)?.providerName || draft.provider, label: model?.label || draft.label,
      providerSortOrder: providers.get(draft.provider)?.providerSortOrder,
      model: draft.model, module: model?.module || draft.module, conditions, unitType: row.unitType,
      currency: draft.currency, price: row.price, missing: row.price === "" ? "未填写" : undefined,
      draft, catalogModel: model,
    })));
  }
  return entries;
}

export type PriceSheetRow = { key: string; label: string; cells: Map<string, SheetPrice[]> };
export type PriceSheet = {
  key: string;
  module: string;
  currency: string;
  unit: string;
  columns: SheetPrice[];
  rows: PriceSheetRow[];
};

export function filterSheetEntries(entries: SheetPrice[], search: string, provider: string, status: string) {
  const query = search.trim().toLowerCase();
  const candidates = new Map<string, SheetPrice[]>();
  for (const entry of entries) {
    if (provider && provider !== entry.provider) continue;
    candidates.set(entry.modelKey, [...(candidates.get(entry.modelKey) || []), entry]);
  }
  // Select models, retaining their full current/draft context for comparison.
  return [...candidates.values()].filter((prices) =>
    prices.some((entry) => [entry.provider, entry.providerName, entry.label, entry.model, priceConditionLabel(entry.conditions)].some((value) => value.toLowerCase().includes(query)))
    && (status === "all" || prices.some((entry) => status === "draft" ? !!entry.draft : status === "missing" ? !!entry.missing : !entry.draft && entry.price != null)),
  ).flat();
}

function rowConditions(entry: SheetPrice) {
  return Object.fromEntries(Object.entries(entry.conditions).filter(([key]) => ["resolution", "duration"].includes(key)));
}

export function cellConditions(entry: SheetPrice) {
  const shared = rowConditions(entry);
  const local = Object.fromEntries(Object.entries(entry.conditions).filter(([key]) => !(key in shared)));
  return Object.keys(local).length ? priceConditionLabel(local) : "";
}

export function priceCellVariants(prices: SheetPrice[]) {
  const variants = new Map<string, { conditions: Record<string, unknown>; prices: SheetPrice[] }>();
  for (const price of prices) {
    const key = conditionsKey(price.conditions);
    if (!variants.has(key)) variants.set(key, { conditions: price.conditions, prices: [] });
    variants.get(key)!.prices.push(price);
  }
  let result = [...variants.values()];
  const axes = [...new Set(prices.flatMap((price) => Object.keys(price.conditions)))].filter((key) => !["resolution", "duration"].includes(key));
  // Merge only equal prices that differ on a single axis. This preserves the
  // exact parameter space (including holes), and never combines draft versions.
  for (const axis of axes) {
    const merged = new Map<string, typeof result[number]>();
    for (const variant of result) {
      const rest = Object.fromEntries(Object.entries(variant.conditions).filter(([key]) => key !== axis));
      const signature = variant.prices.map((price) => [price.price, price.currency, price.missing, price.effectiveFrom, price.draft?.id || "current"]);
      const key = JSON.stringify([axis in variant.conditions, conditionsKey(rest), signature]);
      const existing = merged.get(key);
      if (existing && axis in variant.conditions) {
        const values = [...new Map([existing.conditions[axis], variant.conditions[axis]].flat().map((value) => [normalizedValue(value), value])).values()];
        existing.conditions = { ...existing.conditions, [axis]: values.length === 1 ? values[0] : values };
      } else merged.set(key, { conditions: { ...variant.conditions }, prices: variant.prices });
    }
    result = [...merged.values()];
  }
  return result.map((variant) => ({
    label: cellConditions({ ...variant.prices[0], conditions: variant.conditions }),
    prices: variant.prices.map((price) => ({ ...price, conditions: variant.conditions })),
  }));
}

function rowLabel(entry: SheetPrice, units: Record<string, string>) {
  const condition = priceConditionLabel(rowConditions(entry));
  if (unitFamily(entry.unitType) !== "million_token") return condition;
  const metric = (units[entry.unitType] || entry.unitType).replace(/^每百万/, "").replace(/\s*token$/, "").trim() || "用量";
  return Object.keys(rowConditions(entry)).length ? `${metric} · ${condition}` : metric;
}

export function buildPriceSheets(entries: SheetPrice[], units: Record<string, string>, capacity: number): PriceSheet[] {
  const providerOrder = sortAdminProviders([...new Map(entries.map((entry) => [entry.provider, {
    id: entry.provider, sortOrder: entry.providerSortOrder,
  }])).values()]).map((provider) => provider.id);
  const groups = new Map<string, SheetPrice[]>();
  for (const entry of entries) {
    const key = JSON.stringify([entry.module, unitFamily(entry.unitType), entry.currency]);
    groups.set(key, [...(groups.get(key) || []), entry]);
  }
  const sheets: PriceSheet[] = [];
  const limit = Math.max(1, Math.floor(capacity));
  const moduleOrder = ["agent", "image", "video", "audio", "face"];
  const sortedGroups = [...groups].sort(([, a], [, b]) => moduleOrder.indexOf(a[0].module) - moduleOrder.indexOf(b[0].module) || Number(!a[0].currency) - Number(!b[0].currency));
  for (const [groupKey, prices] of sortedGroups) {
    const columns = [...new Map(prices.map((entry) => [entry.modelKey, entry])).values()];
    columns.sort((a, b) => providerOrder.indexOf(a.provider) - providerOrder.indexOf(b.provider));
    for (let offset = 0; offset < columns.length; offset += limit) {
      const batch = columns.slice(offset, offset + limit);
      const keys = new Set(batch.map((entry) => entry.modelKey));
      const rows = new Map<string, PriceSheetRow>();
      for (const entry of prices) {
        if (!keys.has(entry.modelKey)) continue;
        const key = JSON.stringify([entry.unitType, conditionsKey(rowConditions(entry))]);
        if (!rows.has(key)) rows.set(key, { key, label: rowLabel(entry, units), cells: new Map() });
        const row = rows.get(key)!;
        row.cells.set(entry.modelKey, [...(row.cells.get(entry.modelKey) || []), entry]);
      }
      sheets.push({ key: `${groupKey}:${offset}`, module: prices[0].module, currency: prices[0].currency,
        unit: unitFamily(prices[0].unitType), columns: batch, rows: [...rows.values()] });
    }
  }
  return sheets;
}
