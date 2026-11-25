import { cookies } from "next/headers";
import { LOCALE_COOKIE, normalizeUiLocale } from "./locale";
import zh from "@/messages/zh-CN.json";
import en from "@/messages/en.json";
import { formatUiError } from "./source-messages";

function requestLocale() {
  try { return normalizeUiLocale(cookies().get(LOCALE_COOKIE)?.value); }
  catch { return "zh-CN"; }
}

export function apiMessage(id: keyof (typeof zh)["errors"]) {
  return requestLocale() === "en" ? en.errors[id] : zh.errors[id];
}

export function apiErrorMessage<T>(value: T): T | string {
  const locale = requestLocale();
  return locale === "en" && typeof value === "string" && value ? formatUiError(locale, value) : value;
}
