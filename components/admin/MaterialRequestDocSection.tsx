"use client";
import { UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { FileText } from "lucide-react";

const DEFAULT_TEXT = "欢迎有需要的同事进行下载使用素材，需要做什么样的可以写文档说明";

export default function MaterialRequestDocSection() {
  const { error: uiError } = useUiLocale();
  const [text, setText] = React.useState(DEFAULT_TEXT);
  const [savedText, setSavedText] = React.useState(DEFAULT_TEXT);
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
        const res = await fetch("/api/admin/settings/material-request-doc", { cache: "no-store" }).catch(() => null);
        if (!res) {
          setErr("网络错误");
          return;
        }
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) {
          setErr(String(json?.error || "读取失败"));
          return;
        }
        const next = String(json?.url || "");
        const nextText = String(json?.text || DEFAULT_TEXT);
        if (cancelled) return;
        setUrl(next);
        setSaved(next);
        setText(nextText);
        setSavedText(nextText);
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
    const nextText = String(text || "").trim() || DEFAULT_TEXT;
    setErr(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/material-request-doc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: next, text: nextText }),
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
      const persistedText = String(json?.text || DEFAULT_TEXT);
      setUrl(persisted);
      setSaved(persisted);
      setText(persistedText);
      setSavedText(persistedText);
    } finally {
      setSaving(false);
    }
  }, [text, url]);

  const trimmed = String(url || "").trim();
  const trimmedText = String(text || "").trim() || DEFAULT_TEXT;
  const isDirty = trimmed !== String(saved || "").trim() || trimmedText !== String(savedText || "").trim();

  return (
    <div className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--panel-2)]/70 p-4">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-[var(--app-fg)]">
        <FileText className="h-4 w-4 text-emerald-500" /><UiText id="admin.m11ab4a7f473f" /></div>
      <div className="mb-3">
        <label className="mb-1.5 block text-[12px] font-medium text-[var(--app-muted)]"><UiText id="admin.m7b653220c53d" /></label>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={DEFAULT_TEXT}
          disabled={loading}
          maxLength={180}
          className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 text-[13px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <FileText className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--app-muted)]" />
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://..."
            disabled={loading}
            className="h-10 w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] pl-9 pr-3 text-[13px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        <button
          type="button"
          onClick={() => setUrl("")}
          disabled={!url || loading || saving}
          className="h-10 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 text-[13px] text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:opacity-50"
        ><UiText id="admin.m1ef3de06b32e" /></button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={loading || saving || !isDirty}
          className="h-10 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 text-[13px] text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:opacity-50"
        >
          {saving ? <UiText id="admin.m917b1c1f18d0" /> : <UiText id="admin.m6e584e3d5ce6" />}
        </button>
        <button
          type="button"
          onClick={() => {
            if (trimmed) window.open(trimmed, "_blank", "noopener,noreferrer");
          }}
          disabled={!trimmed || loading}
          className="h-10 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 text-[13px] text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:opacity-50"
        ><UiText id="admin.m91a453b03495" /></button>
      </div>
      <p className="mt-2 text-[12px] text-[var(--app-muted)]"><UiText id="admin.m3ce3dbd86b31" /></p>
      {err ? <div className="mt-3 text-[12px] text-rose-500">{uiError(err)}</div> : null}
    </div>
  );
}
