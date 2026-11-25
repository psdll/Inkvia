import { createHash } from "node:crypto";
import { conditionKey, validatePrice } from "./money";
export type PriceDraft = {
  id: string;
  provider: string;
  model: string;
  module: string;
  label: string;
  currency: string;
  notes: string;
  sourceVersion?: {
    effectiveFrom: string;
    effectiveTo: string | null;
    isActive: boolean;
    priority: number;
  };
  rows: {
    conditions: Record<string, unknown>;
    unitType: string;
    price: string;
  }[];
};
export const DRAFT_FORMAT = "inkvia-price-drafts-v1";
// Draft files exported before the rename stay importable.
export const LEGACY_DRAFT_FORMAT = "ai-stools-price-drafts-v1";
export function validateDraft(input: any): PriceDraft {
  if (!input || typeof input !== "object") throw new Error("价格草稿无效");
  const text = (v: unknown, max = 300) => {
    if (typeof v !== "string" || v.length > max)
      throw new Error("草稿字段无效");
    return v.trim();
  };
  const provider = text(input.provider),
    model = text(input.model),
    billingModule = text(input.module),
    currency = text(input.currency);
  if (!provider || !model || !billingModule || !/^(?:[A-Z]{3}|CREDIT)$/.test(currency))
    throw new Error("草稿模型或币种无效");
  if (
    !Array.isArray(input.rows) ||
    !input.rows.length ||
    input.rows.length > 3000
  )
    throw new Error("草稿价格档位无效");
  const rows = input.rows
    .map((r: any) => {
      if (
        !r ||
        !r.conditions ||
        typeof r.conditions !== "object" ||
        Array.isArray(r.conditions)
      )
        throw new Error("草稿条件无效");
      for (const [key, value] of Object.entries(r.conditions)) {
        if (
          !/^[a-zA-Z][a-zA-Z0-9_]{0,60}$/.test(key) ||
          ["constructor", "prototype", "__proto__"].includes(key)
        )
          throw new Error("草稿条件字段无效");
        const values = Array.isArray(value) ? value : [value];
        if (
          !values.length ||
          values.length > 100 ||
          values.some(
            (v) =>
              !["string", "number", "boolean"].includes(typeof v) ||
              String(v).length > 300,
          )
        )
          throw new Error("草稿条件值无效");
      }
      return {
        conditions: JSON.parse(conditionKey(r.conditions)),
        unitType: text(r.unitType),
        price: r.price === "" ? "" : validatePrice(r.price),
      };
    })
    .sort((a: any, b: any) =>
      `${a.unitType}|${conditionKey(a.conditions)}`.localeCompare(
        `${b.unitType}|${conditionKey(b.conditions)}`,
      ),
    );
  let sourceVersion: PriceDraft["sourceVersion"];
  if (input.sourceVersion !== undefined) {
    const source = input.sourceVersion;
    const date = (value: unknown) => {
      if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
        throw new Error("来源价格日期无效");
      return new Date(value).toISOString();
    };
    if (!source || typeof source.isActive !== "boolean" || !Number.isInteger(source.priority))
      throw new Error("来源价格版本无效");
    sourceVersion = {
      effectiveFrom: date(source.effectiveFrom),
      effectiveTo: source.effectiveTo === null ? null : date(source.effectiveTo),
      isActive: source.isActive,
      priority: source.priority,
    };
    if (sourceVersion.effectiveTo && sourceVersion.effectiveTo <= sourceVersion.effectiveFrom)
      throw new Error("来源价格区间无效");
  }
  const data = {
    provider,
    model,
    module: billingModule,
    label: text(input.label || model),
    currency,
    notes: text(input.notes || "", 10000),
    rows,
    ...(sourceVersion ? { sourceVersion } : {}),
  };
  return {
    id: createHash("sha256").update(JSON.stringify(data)).digest("hex"),
    ...data,
  };
}
export function parseDraftFile(input: any): PriceDraft[] {
  if (
    (input?.format !== DRAFT_FORMAT && input?.format !== LEGACY_DRAFT_FORMAT) ||
    !Array.isArray(input.drafts) ||
    !input.drafts.length ||
    input.drafts.length > 100
  )
    throw new Error("请选择有效的价格草稿文件（最多 100 个模型）");
  if (JSON.stringify(input).length > 2_000_000)
    throw new Error("价格文件不得超过 2 MB");
  return input.drafts.map(validateDraft);
}
export function mergeDrafts(existing: PriceDraft[], incoming: PriceDraft[]) {
  return [
    ...new Map([...existing, ...incoming].map((d) => [d.id, d])).values(),
  ];
}
