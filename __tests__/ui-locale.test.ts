/** @vitest-environment jsdom */
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const localeCookie = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: () => ({ get: (key: string) => key === "INKVIA_LOCALE" ? { value: localeCookie.value } : undefined }),
}));
import { normalizeUiLocale } from "@/i18n/locale";
import { apiMessage } from "@/i18n/api-message";
import { UiLocaleProvider, UiProps, UiText } from "@/i18n/ui";
import { LanguageSetting } from "@/components/settings/language-setting";
import zh from "@/messages/zh-CN.json";
import en from "@/messages/en.json";

describe("interface localization", () => {
  it("validates the cookie and defaults to Simplified Chinese", () => {
    expect(normalizeUiLocale(undefined)).toBe("zh-CN");
    expect(normalizeUiLocale("../unsafe")).toBe("zh-CN");
    expect(normalizeUiLocale("en")).toBe("en");
  });

  it("matches every catalog key and rejects blank translations", () => {
    const keys = (dictionary: Record<string, Record<string, string>>) => Object.entries(dictionary)
      .flatMap(([group, messages]) => Object.entries(messages).filter(([, value]) => value.trim()).map(([name]) => group + "." + name)).sort();
    expect(keys(zh)).toEqual(keys(en));
    expect(keys(zh).length).toBeGreaterThan(3800);
  });

  it("uses the request locale for errors", () => {
    const key = Object.keys(zh.errors)[0] as keyof typeof zh.errors;
    try {
      localeCookie.value = "en";
      expect(apiMessage(key)).toBe(en.errors[key]);
      localeCookie.value = undefined;
      expect(apiMessage(key)).toBe(zh.errors[key]);
    } finally { localeCookie.value = undefined; }
  });

  it("switches UI text and labels while preserving user input", () => {
    const panel = (locale: "zh-CN" | "en", messages: typeof zh | typeof en) => renderToStaticMarkup(createElement(
      UiLocaleProvider, { locale, messages, children: [
        createElement(UiText, { key: "caption", id: "settings.language" }),
        createElement(UiProps, {
          key: "input", ids: { "aria-label": ["settings.language"] },
          children: createElement("input", { "aria-label": "settings.language", defaultValue: "我的草稿" }),
        }),
      ] },
    ));
    expect(panel("en", en)).toContain('aria-label="Language"');
    expect(panel("zh-CN", zh)).toContain('aria-label="语言"');
    expect(panel("en", en)).toContain('value="我的草稿"');
  });

  it("applies a language choice in the current document and keeps the mounted draft", () => {
    const previousLanguage = document.documentElement.lang;
    const previousTitle = document.title;
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    flushSync(() => root.render(createElement(UiLocaleProvider, { locale: "zh-CN", messages: zh, children: [
      createElement(LanguageSetting, { key: "language" }),
      createElement("textarea", { key: "draft", "aria-label": "draft" }),
    ] })));
    try {
      const languageButton = (name: string) => [...container.querySelectorAll("button")].find(button => button.textContent === name)!;
      const draft = container.querySelector("textarea")!;
      draft.value = "我的中文原稿";
      flushSync(() => languageButton("English").click());
      expect(document.cookie).toContain("INKVIA_LOCALE=en");
      expect(document.documentElement.lang).toBe("en");
      expect(container.querySelector("h2")?.textContent).toBe("Language");
      expect(container.querySelector("textarea")).toBe(draft);
      expect(draft.value).toBe("我的中文原稿");
      flushSync(() => languageButton("简体中文").click());
      expect(container.querySelector("h2")?.textContent).toBe("语言");
      expect(draft.value).toBe("我的中文原稿");
    } finally {
      flushSync(() => root.unmount());
      container.remove();
      document.cookie = "INKVIA_LOCALE=; Path=/; Max-Age=0";
      document.documentElement.lang = previousLanguage;
      document.title = previousTitle;
    }
  });
});
