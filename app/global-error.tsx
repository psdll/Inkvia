"use client";
import { UiLocaleProvider, UiText } from "@/i18n/ui";
import { LOCALE_COOKIE, normalizeUiLocale, type UiLocale } from "@/i18n/locale";
import zh from "@/messages/zh-CN.json";
import en from "@/messages/en.json";


import { useEffect, useState } from "react";

// 全局错误边界：根布局自身渲染失败时的兜底。必须自带 <html>/<body>。
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [locale, setLocale] = useState<UiLocale>("zh-CN");
  useEffect(() => {
    const entry = document.cookie.split(";").map(cookie => cookie.trim()).find(cookie => cookie.startsWith(`${LOCALE_COOKIE}=`));
    setLocale(normalizeUiLocale(entry?.slice(LOCALE_COOKIE.length + 1)));
  }, []);
  useEffect(() => {
    console.error("[global error]", error);
  }, [error]);

  return (
    <html lang={locale}>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          fontFamily: "system-ui, sans-serif",
          background: "#f3f3f7",
          color: "#1a1a2e",
        }}
      >
        <UiLocaleProvider locale={locale} messages={locale === "en" ? en : zh}>
        <div style={{ fontSize: 48 }}>⚠️</div>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}><UiText id="common.m2c6530de716c" /></h2>
        <p style={{ fontSize: 13, color: "#6a6a80" }}><UiText id="common.m068c6f293154" /></p>
        <button
          onClick={reset}
          style={{
            padding: "9px 22px",
            borderRadius: 999,
            border: "none",
            background: "#0e0e18",
            color: "#fff",
            fontSize: 13,
            cursor: "pointer",
          }}
        ><UiText id="common.mb8784c8dd563" /></button>
        </UiLocaleProvider>
      </body>
    </html>
  );
}
