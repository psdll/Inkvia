import type { UiLocale } from "./locale";

function intlLocale(locale: UiLocale) {
  return locale === "en" ? "en-US" : "zh-CN";
}

export function formatUiNumber(locale: UiLocale, value: number | bigint, options?: Intl.NumberFormatOptions, chinese?: () => string) {
  if (locale === "zh-CN" && chinese) return chinese();
  return new Intl.NumberFormat(intlLocale(locale), options).format(value);
}

export function formatUiDate(locale: UiLocale, value: string | number | Date, options?: Intl.DateTimeFormatOptions, chinese?: () => string) {
  if (locale === "zh-CN" && chinese) return chinese();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(intlLocale(locale), options).format(date);
}

export function formatUiRelativeTime(locale: UiLocale, value: number, unit: Intl.RelativeTimeFormatUnit, chinese?: () => string) {
  if (locale === "zh-CN" && chinese) return chinese();
  return new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" }).format(value, unit);
}
