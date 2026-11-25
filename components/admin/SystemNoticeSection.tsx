"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Link2, Megaphone } from "lucide-react";
import { fetchJsonOnce } from "@/lib/client/inflight-json";

// 系统设置 → 全站通知 section。
// 完全自管 state：mount 时加载、保存时调用 API、广播事件给全站通知条。

function toDatetimeLocalValue(raw: string | null | undefined) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

function toIsoFromDatetimeLocal(raw: string | null | undefined) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

type NoticeConfig = {
  enabled: boolean;
  text: string;
  href: string;
  startAt: string;
  endAt: string;
};

const EMPTY_CONFIG: NoticeConfig = { enabled: false, text: "", href: "", startAt: "", endAt: "" };

export default function SystemNoticeSection() {
  const { error: uiError } = useUiLocale();
  const [enabled, setEnabled] = React.useState(false);
  const [text, setText] = React.useState("");
  const [href, setHref] = React.useState("");
  const [startAt, setStartAt] = React.useState("");
  const [endAt, setEndAt] = React.useState("");
  const [saved, setSaved] = React.useState<NoticeConfig>(EMPTY_CONFIG);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setErr(null);
      setLoading(true);
      try {
        const { ok, json } = await fetchJsonOnce<any>("/api/admin/settings/system-notice")
          .catch(() => ({ ok: false, json: null }));
        if (!ok) {
          setErr(String(json?.error || "读取失败"));
          return;
        }
        const next: NoticeConfig = {
          enabled: Boolean(json?.config?.enabled),
          text: String(json?.config?.text || ""),
          href: String(json?.config?.href || ""),
          startAt: toDatetimeLocalValue(json?.config?.startAt),
          endAt: toDatetimeLocalValue(json?.config?.endAt),
        };
        if (cancelled) return;
        setEnabled(next.enabled);
        setText(next.text);
        setHref(next.href);
        setStartAt(next.startAt);
        setEndAt(next.endAt);
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
    const startAtIso = toIsoFromDatetimeLocal(startAt);
    const endAtIso = toIsoFromDatetimeLocal(endAt);
    if (startAt && !startAtIso) {
      setErr("开始时间格式无效");
      return;
    }
    if (endAt && !endAtIso) {
      setErr("结束时间格式无效");
      return;
    }
    if (startAtIso && endAtIso && new Date(startAtIso).getTime() > new Date(endAtIso).getTime()) {
      setErr("结束时间不能早于开始时间");
      return;
    }
    const payload = {
      enabled: Boolean(enabled),
      text: String(text || "").trim(),
      href: String(href || "").trim(),
      startAt: startAtIso,
      endAt: endAtIso,
    };
    if (payload.enabled && !payload.text) {
      setErr("启用通知时，内容不能为空");
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/system-notice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: payload }),
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
      const next: NoticeConfig = {
        enabled: Boolean(json?.config?.enabled),
        text: String(json?.config?.text || ""),
        href: String(json?.config?.href || ""),
        startAt: toDatetimeLocalValue(json?.config?.startAt),
        endAt: toDatetimeLocalValue(json?.config?.endAt),
      };
      setEnabled(next.enabled);
      setText(next.text);
      setHref(next.href);
      setStartAt(next.startAt);
      setEndAt(next.endAt);
      setSaved(next);
      // 全站通知条监听此事件以同步显示
      window.dispatchEvent(new CustomEvent("settings:system-notice", { detail: { config: next } }));
    } finally {
      setSaving(false);
    }
  }, [enabled, endAt, href, startAt, text]);

  const isDirty =
    enabled !== saved.enabled ||
    String(text || "").trim() !== String(saved.text || "").trim() ||
    String(href || "").trim() !== String(saved.href || "").trim() ||
    String(startAt || "").trim() !== String(saved.startAt || "").trim() ||
    String(endAt || "").trim() !== String(saved.endAt || "").trim();

  return (
    <div id="sys-notice" className="scroll-mt-28 rounded-3xl border border-white/10 bg-[var(--panel-bg)]/92 p-6 shadow-sm">
      <h3 className="text-[15px] font-semibold text-[var(--app-fg)] flex items-center gap-2 mb-2">
        <Megaphone className="h-4 w-4 text-indigo-400" /><UiText id="admin.me661a61765bc" /></h3>
      <p className="text-[12px] text-[var(--app-muted)] mb-4"><UiText id="admin.m53271d0bed73" /></p>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2">
          <div className="text-[12px] text-[var(--app-fg)]"><UiText id="admin.m73e369d51df3" /></div>
          <UiProps ids={{"aria-label":["admin.m398456fbab06"]}}><button
            type="button"
            onClick={() => setEnabled((prev) => !prev)}
            disabled={loading || saving}
            className={[
              "h-7 w-14 rounded-full border transition relative disabled:opacity-50",
              enabled
                ? "border-blue-500/30 bg-blue-500/20"
                : "border-[var(--border)] bg-[var(--panel-bg)]",
            ].join(" ")}
            aria-label="admin.m398456fbab06"
          >
            <span
              className={[
                "absolute top-[2px] h-5 w-5 rounded-full bg-white shadow transition",
                enabled ? "left-[30px]" : "left-[2px]",
              ].join(" ")}
            />
          </button></UiProps>
        </div>
        <div className="relative">
          <Megaphone className="h-4 w-4 text-[var(--app-muted)] absolute left-3 top-3.5" />
          <UiProps ids={{"placeholder":["admin.mcbc8efdb9988"]}}><textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 180))}
            placeholder="admin.mcbc8efdb9988"
            disabled={loading}
            rows={3}
            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-[13px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
          /></UiProps>
          <div className="mt-1 text-right text-[11px] text-[var(--app-muted)]">{text.length}/180</div>
        </div>
        <div className="relative">
          <Link2 className="h-4 w-4 text-[var(--app-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
          <UiProps ids={{"placeholder":["admin.m5fa37a44859f"]}}><input
            value={href}
            onChange={(e) => setHref(e.target.value)}
            placeholder="admin.m5fa37a44859f"
            disabled={loading}
            className="h-10 w-full pl-9 pr-3 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-[13px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20"
          /></UiProps>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2">
            <div className="mb-1 text-[11px] text-[var(--app-muted)]"><UiText id="admin.md72a834c2faa" /></div>
            <input
              type="datetime-local"
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              disabled={loading}
              className="h-9 w-full bg-transparent text-[13px] text-[var(--app-fg)] outline-none"
            />
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2">
            <div className="mb-1 text-[11px] text-[var(--app-muted)]"><UiText id="admin.mb54c6cf051fb" /></div>
            <input
              type="datetime-local"
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
              disabled={loading}
              className="h-9 w-full bg-transparent text-[13px] text-[var(--app-fg)] outline-none"
            />
          </div>
        </div>
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2">
          <div className="text-[11px] text-amber-700 mb-1"><UiText id="admin.m6e6ede3c9a37" /></div>
          <div className="flex items-center justify-center gap-2 text-[12px] text-amber-900">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <Megaphone className="h-3 w-3" />
            </span>
            <span className="truncate font-medium">
              {String(text || "").trim() || <UiText id="admin.mec942de69da3" />}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setEnabled(false);
              setText("");
              setHref("");
              setStartAt("");
              setEndAt("");
            }}
            disabled={loading || saving}
            className="h-10 px-4 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] text-[13px] text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:opacity-50 transition"
          ><UiText id="admin.m1ef3de06b32e" /></button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={loading || saving || !isDirty}
            className="h-10 px-4 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] text-[13px] text-[var(--app-fg)] hover:bg-[var(--panel-3)] disabled:opacity-50 transition"
          >
            {saving ? <UiText id="admin.mff509c9ba052" /> : <UiText id="admin.m624443f9a88b" />}
          </button>
        </div>
      </div>
      {err && <div className="mt-3 text-[12px] text-rose-500">{uiError(err)}</div>}
    </div>
  );
}
