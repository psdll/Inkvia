import { UiText } from "@/i18n/ui";
import Link from "next/link";

// 404 页面
export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: 40,
        background: "var(--app-bg)",
        color: "var(--app-fg)",
      }}
    >
      <div style={{ fontSize: 56, fontWeight: 800, letterSpacing: "-2px" }}>404</div>
      <p style={{ fontSize: 14, color: "var(--app-muted)" }}><UiText id="common.m3088a2a81bec" /></p>
      <Link
        href="/"
        style={{
          marginTop: 8,
          padding: "9px 22px",
          borderRadius: 999,
          background: "var(--primary-bg, #6d5cdf)",
          color: "#fff",
          fontSize: 13,
          textDecoration: "none",
        }}
      ><UiText id="common.md66f4359dae3" /></Link>
    </div>
  );
}
