import { Prisma } from "@prisma/client";

export const BILLING_TIMEZONE = "Asia/Shanghai";
export type ExchangeRate = {
  id: string;
  provider: string;
  currency: string;
  rate: string;
  effectiveFrom: string;
  notes: string;
};
export type BillingSettings = {
  drafts?: import("./drafts").PriceDraft[];
  rateDrafts?: ExchangeRate[];
  mode: "observe" | "strict";
  rates: ExchangeRate[];
  revision: number;
};
export const BILLING_SETTING_KEY = "billing-cost-settings-v1";
export const EMPTY_BILLING_SETTINGS: BillingSettings = {
  mode: "observe",
  rates: [],
  revision: 0,
};

export function decimal(value: unknown) {
  return new Prisma.Decimal(String(value ?? 0));
}
export function billingDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("请填写生效日期（北京时间）");
  const date = new Date(`${value}T00:00:00+08:00`);
  if (!Number.isFinite(date.getTime()) || shanghaiDay(date) !== value)
    throw new Error("生效日期无效");
  return date;
}
export function shanghaiDay(value: Date | string) {
  return new Date(new Date(value).getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 10);
}
export function billingMonth(value: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error("月份无效");
  const start = billingDate(`${value}-01`);
  const [year, month] = value.split("-").map(Number);
  const end = new Date(Date.UTC(year, month, 1) - 8 * 3600000);
  const keys: string[] = [];
  for (let time = +start; time < +end; time += 86400000)
    keys.push(shanghaiDay(new Date(time)));
  return { start, end, keys };
}
export function resolveExchangeRate(
  rates: ExchangeRate[],
  provider: string,
  currency: string,
  at: Date,
) {
  if (currency === "CNY") return { id: "CNY", rate: "1", effectiveFrom: null };
  return (
    rates
      .filter(
        (r) =>
          r.provider === provider &&
          r.currency === currency &&
          +new Date(r.effectiveFrom) <= +at,
      )
      .sort(
        (a, b) => +new Date(b.effectiveFrom) - +new Date(a.effectiveFrom),
      )[0] ?? null
  );
}
export function convertToCny(amount: unknown, rate: { rate: string } | null) {
  return rate
    ? decimal(amount).mul(rate.rate).toDecimalPlaces(8).toFixed(8)
    : null;
}
export function validatePrice(value: unknown, label = "价格") {
  if (
    value === "" ||
    value === null ||
    value === undefined ||
    !/^(\d+)(\.\d{1,6})?$/.test(String(value))
  )
    throw new Error(`${label}必须填写非负数，最多 6 位小数；免费请明确填 0`);
  const result = decimal(value);
  if (!result.isFinite() || result.gte("1000000000000"))
    throw new Error(`${label}超出范围`);
  return result.toString();
}
export function activeAt(
  rule: {
    isActive: boolean;
    effectiveFrom: Date | string;
    effectiveTo?: Date | string | null;
  },
  at: Date,
) {
  return (
    rule.isActive &&
    +new Date(rule.effectiveFrom) <= +at &&
    (!rule.effectiveTo || +new Date(rule.effectiveTo) > +at)
  );
}
export function matches(conditions: unknown, context: Record<string, unknown>) {
  if (
    !conditions ||
    typeof conditions !== "object" ||
    Array.isArray(conditions)
  )
    return true;
  const normalized = (v: unknown) =>
    String(v ?? "")
      .trim()
      .toLowerCase();
  return Object.entries(conditions).every(([key, value]) =>
    (Array.isArray(value) ? value : [value]).some(
      (v) => normalized(v) === normalized(context[key]),
    ),
  );
}
export function conditionKey(conditions: unknown) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries((conditions || {}) as object).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    ),
  );
}

export type TokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
};
export function tokenCharges(
  usage: TokenUsage | null | undefined,
  prices: Record<string, unknown>,
) {
  if (!usage || usage.inputTokens == null || usage.outputTokens == null)
    return null;
  const cached = usage.cachedInputTokens ?? 0;
  const created = usage.cacheCreationInputTokens ?? 0;
  const counts: Record<string, number> = {
    input_million_token: usage.inputTokens - cached - created,
    output_million_token: usage.outputTokens,
    cached_million_token: cached,
    cache_creation_million_token: created,
  };
  if (Object.values(counts).some((n) => !Number.isSafeInteger(n) || n < 0))
    return null;
  const items = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([unitType, count]) => {
      if (prices[unitType] == null) return null;
      return {
        unitType,
        tokens: count,
        unitPrice: String(prices[unitType]),
        amount: decimal(count)
          .div(1000000)
          .mul(decimal(prices[unitType]))
          .toFixed(8),
      };
    });
  if (items.some((i) => i === null)) return null;
  return {
    items,
    amount: items.reduce((sum, i) => sum.add(i!.amount), decimal(0)).toFixed(8),
  };
}
