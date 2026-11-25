"use client";
import { UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { BookOpen } from "lucide-react";
import { fetchJsonOnce } from "@/lib/client/inflight-json";

// 系统设置 → 教程文档链接 section
// 完全自管 state：mount 时加载、保存时调用 API、广播事件给侧边栏。
export default function TutorialDocSection() {
  const { error: uiError } = useUiLocale();
  const [url, setUrl] = React.useState("");
  const [saved, setSaved] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setErr(null);
      setLoading(true);
      try {
        const { ok, json } = await fetchJsonOnce<any>("/api/admin/settings/tutorial-doc")
          .catch(() => ({ ok: false, json: null }));
        if (!ok) {
          setErr(String(json?.error || "读取失败"));
          return;
        }
        const next = String(json?.url || "");
        if (cancelled) return;
        setUrl(next);
        setSaved(next);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = React.useCallback(async () => {
    const next = String(url || "").trim();
    setErr(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/tutorial-doc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: next }),
      }).catch(() => null);
      if (!res) {
        setErr("网络错误");
        return;
      }
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        setErr(String(json?.error || "保存失败"));
        return;
      }
      const persisted = String(json?.url || "");
      setUrl(persisted);
      setSaved(persisted);
      // 侧边栏“文档”链接监听此事件以同步显示
      window.dispatchEvent(new CustomEvent("settings:tutorial-doc-url", { detail: { url: persisted } }));
    } finally {
      setSaving(false);
    }
  }, [url]);

  const trimmed = String(url || "").trim();
  const isDirty = trimmed !== String(saved || "").trim();

  return (
    <div id="sys-tutorial" className="scroll-mt-28 rounded-3xl border border-white/10 bg-[var(--panel-bg)]/92 p-6 shadow-sm">
      <h3 className="text-[15px] font-semibold text-[var(--app-fg)] flex items-center gap-2 mb-2">
        <BookOpen className="h-4 w-4" /><UiText id="admin.m226e6c449893" /></h3>
      <p className="text-[12px] text-[var(--app-muted)] mb-4"><UiText id="admin.m311ed32679d2" /></p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <BookOpen className="h-4 w-4 text-[var(--app-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            disabled={loading}
            className="h-10 w-full pl-9 pr-3 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-[13px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        <button
          type="button"
          onClick={() => setUrl("")}
          disabled={!url || loading || saving}
          className="h-10 px-4 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] text-[13px] text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:opacity-50 transition"
        ><UiText id="admin.m1ef3de06b32e" /></button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={loading || saving || !isDirty}
          className="h-10 px-4 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] text-[13px] text-[var(--app-fg)] hover:bg-[var(--panel-3)] disabled:opacity-50 transition"
        >
          {saving ? <UiText id="admin.mff509c9ba052" /> : <UiText id="admin.m6e584e3d5ce6" />}
        </button>
        <button
          type="button"
          onClick={() => {
            if (trimmed) window.open(trimmed, "_blank", "noopener,noreferrer");
          }}
          disabled={!trimmed || loading}
          className="h-10 px-4 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] text-[13px] text-[var(--app-fg)] hover:bg-[var(--panel-3)] disabled:opacity-50 transition"
        ><UiText id="admin.m91a453b03495" /></button>
      </div>
      {err && <div className="mt-3 text-[12px] text-rose-500">{uiError(err)}</div>}
    </div>
  );
}
