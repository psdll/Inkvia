"use client";
import { UiText } from "@/i18n/ui";


import { useEffect } from "react";

// 路由段错误边界：捕获页面渲染期的未处理异常，避免整页白屏。
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[page error]", error);
  }, [error]);

  function handleRetry() {
    // Lazy imports cache rejected promises; reset alone rethrows the same error.
    if (error.name === "ChunkLoadError" || /Loading chunk .+ failed/i.test(error.message)) {
      window.location.reload();
      return;
    }
    reset();
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 40,
        background: "var(--app-bg)",
        color: "var(--app-fg)",
      }}
    >
      <div style={{ fontSize: 48 }}>⚠️</div>
      <h2 style={{ fontSize: 18, fontWeight: 700 }}><UiText id="common.m04c5b3971130" /></h2>
      <p style={{ fontSize: 13, color: "var(--app-muted)", textAlign: "center", maxWidth: 420 }}><UiText id="common.m417a59e600bb" /></p>
      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <button
          onClick={handleRetry}
          style={{
            padding: "9px 22px",
            borderRadius: 999,
            border: "1px solid var(--border)",
            background: "var(--panel-bg)",
            color: "var(--app-fg)",
            fontSize: 13,
            cursor: "pointer",
          }}
        ><UiText id="common.mb8784c8dd563" /></button>
        {/* A full navigation also replaces a failed client runtime. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          style={{
            padding: "9px 22px",
            borderRadius: 999,
            background: "var(--primary-bg, #6d5cdf)",
            color: "#fff",
            fontSize: 13,
            textDecoration: "none",
          }}
        ><UiText id="common.md66f4359dae3" /></a>
      </div>
    </div>
  );
}
