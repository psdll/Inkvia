"use client";

import { cloneElement, createContext, useContext, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { createTranslator, NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import chinese from "@/messages/zh-CN.json";
import english from "@/messages/en.json";
import { LOCALE_COOKIE, type UiLocale } from "./locale";
import { formatUiError, formatUiLabel } from "./source-messages";

function translator(locale: UiLocale, messages: AbstractIntlMessages) {
  const t = createTranslator({ locale, messages });
  const raw = t.raw as (id: string) => string;
  return (id: string, values?: Record<string, string | number>) => {
    const message = raw(id);
    return values ? message.replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(values, key) ? String(values[key]) : match) : message;
  };
}

function createUiLocale(locale: UiLocale, messages: AbstractIntlMessages) {
  return {
    locale,
    text: translator(locale, messages),
    label: <T extends string | null | undefined>(source: T) => formatUiLabel(locale, source),
    error: (value: unknown, fallback?: string) => formatUiError(locale, value, fallback),
  };
}

const UiLocaleContext = createContext({ ...createUiLocale("zh-CN", chinese), setLanguage: (_value: UiLocale) => {} });

export function UiLocaleProvider({ locale, messages, children }: {
  locale: UiLocale;
  messages: AbstractIntlMessages;
  children: ReactNode;
}) {
  const [language, setLanguage] = useState(locale);
  const catalog = language === locale ? messages : language === "en" ? english : chinese;
  const context = useMemo(() => ({
    ...createUiLocale(language, catalog),
    setLanguage(value: UiLocale) {
      if (value === language) return;
      const next = value === "en" ? english : chinese;
      document.cookie = `${LOCALE_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      document.documentElement.lang = value;
      document.title = next.common.pageTitle;
      document.querySelector('meta[name="description"]')?.setAttribute("content", next.common.pageDescription);
      // Update the interface in place. Reloading a document discards its unsubmitted inputs.
      setLanguage(value);
    },
  }), [language, catalog]);
  return (
    <NextIntlClientProvider locale={language} messages={catalog}>
      <UiLocaleContext.Provider value={context}>
        {children}
      </UiLocaleContext.Provider>
    </NextIntlClientProvider>
  );
}

export function useUiLocale() {
  return useContext(UiLocaleContext);
}

export function UiText({ id, values }: { id: string; values?: Record<string, string | number> }) {
  return useUiLocale().text(id, values);
}

export function UiProps({ ids, children }: { ids: Record<string, string[]>; children: ReactElement }) {
  const { text } = useUiLocale();
  const translated: Record<string, string> = {};
  for (const [name, messages] of Object.entries(ids)) {
    const current = children.props[name];
    const id = messages.find(message => message === current);
    if (id) translated[name] = text(id);
  }
  return cloneElement(children, translated);
}
