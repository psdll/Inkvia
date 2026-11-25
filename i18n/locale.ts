export const LOCALE_COOKIE = "INKVIA_LOCALE";
export type UiLocale = "zh-CN" | "en";

export function normalizeUiLocale(value: string | undefined): UiLocale {
  return value === "en" ? "en" : "zh-CN";
}
