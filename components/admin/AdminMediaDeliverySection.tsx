"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { fetchJsonOnce } from "@/lib/client/inflight-json";
import { AlertTriangle, Check, Loader2, Share2 } from "lucide-react";
import {
  LLM_INLINE_IMAGE_PLATFORMS,
  MEDIA_DELIVERY_PLATFORMS,
  type MediaDeliveryMethod,
  type MediaDeliveryMode,
  type MediaKind,
} from "@/lib/media-delivery/catalog";

type Snapshot = {
  mode: MediaDeliveryMode;
  updatedAt: string | null;
  ossReady: boolean;
  pinnedByEnv?: boolean;
  enabledPlatformIds: string[];
};

const MODES: Array<{ value: MediaDeliveryMode; title: string; badge?: string; body: string }> = [
  {
    value: "platform",
    title: "优先走各平台自带的临时图床",
    badge: "推荐",
    body: "有临时上传或支持 Base64 的平台，直接用平台自己的方式接收参考素材，不占用阿里云 OSS。平台没有自带方案、或平台上传临时失败时，自动改走阿里云 OSS。",
  },
  {
    value: "oss",
    title: "全部走阿里云 OSS",
    body: "所有参考素材都先上传到本项目的阿里云 OSS，再把链接交给模型平台。适合想统一使用自己的图床，或某个平台的临时上传不稳定时切换使用。",
  },
];

const KINDS: Array<{ kind: MediaKind; label: string }> = [
  { kind: "image", label: "图片" },
  { kind: "video", label: "视频" },
  { kind: "audio", label: "音频" },
];

const METHOD_LABEL: Record<MediaDeliveryMethod, string> = {
  "platform-upload": "平台自带图床",
  "inline-base64": "Base64 直传",
  "local-inline": "直接读取本地",
  oss: "阿里云 OSS",
};

function MethodBadge({ method, forceOss }: { method?: MediaDeliveryMethod; forceOss: boolean }) {
  const { label: uiLabel } = useUiLocale();
  if (!method) return <span className="text-[11px] text-[var(--app-muted)]">—</span>;
  const effective: MediaDeliveryMethod = forceOss && (method === "platform-upload" || method === "inline-base64") ? "oss" : method;
  const tone = effective === "oss"
    ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  return (
    <span className={`inline-flex whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] ${tone}`}>
      {uiLabel(METHOD_LABEL[effective])}
    </span>
  );
}

export default function AdminMediaDeliverySection() {
  const { label: uiLabel, locale: uiLocale, error: uiError } = useUiLocale();
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null);
  const [saving, setSaving] = React.useState<MediaDeliveryMode | null>(null);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let alive = true;
    fetchJsonOnce<{ success: boolean; error?: string } & Snapshot>("/api/admin/settings/media-delivery")
      .then(({ ok, json: data }) => {
        if (!alive) return;
        if (ok && data?.success) setSnapshot(data);
        else setError(data?.error || "读取素材发送方式失败");
      })
      .catch(() => alive && setError("读取素材发送方式失败"));
    return () => { alive = false; };
  }, []);

  const choose = async (mode: MediaDeliveryMode) => {
    if (saving || snapshot?.mode === mode) return;
    setSaving(mode);
    setError("");
    try {
      const response = await fetch("/api/admin/settings/media-delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) throw new Error(data?.error || "保存失败");
      setSnapshot(data);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setSaving(null);
    }
  };

  const mode = snapshot?.mode;
  const forceOss = mode === "oss";
  const enabled = new Set(snapshot?.enabledPlatformIds || []);
  const llmNames = MEDIA_DELIVERY_PLATFORMS.filter((entry) => LLM_INLINE_IMAGE_PLATFORMS.includes(entry.id)).map((entry) => entry.name.replace(/（.*）/, ""));

  return (
    <section
      id="sys-media-delivery"
      className="scroll-mt-28 rounded-3xl border border-[var(--border)] bg-[var(--panel-bg)] p-6 shadow-sm"
    >
      <h3 className="flex items-center gap-2 text-[15px] font-semibold text-[var(--app-fg)]">
        <Share2 className="h-4 w-4 text-[var(--primary-bg)]" /><UiText id="admin.mffe7f5f97e00" /></h3>
      <p className="mt-2 text-[12px] leading-5 text-[var(--app-muted)]"><UiText id="admin.m4b05075cb690" /></p>

      <UiProps ids={{"aria-label":["admin.m6768a5c8b84f"]}}><div role="radiogroup" aria-label="admin.m6768a5c8b84f" className="mt-4 grid gap-3 md:grid-cols-2">
        {MODES.map((option) => {
          const selected = mode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!snapshot || Boolean(saving) || snapshot.pinnedByEnv}
              onClick={() => void choose(option.value)}
              className={`relative rounded-2xl border p-4 text-left transition ${selected
                ? "border-[var(--primary-bg)] bg-[color-mix(in_srgb,var(--primary-bg)_8%,transparent)]"
                : "border-[var(--border)] bg-[var(--panel-2)] hover:border-[var(--border-2)]"} disabled:cursor-not-allowed`}
            >
              <div className="flex items-center gap-2 pr-6 text-[13px] font-semibold text-[var(--app-fg)]">
                {uiLabel(option.title)}
                {option.badge ? <span className="rounded-md bg-[var(--primary-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--primary-fg)]">{uiLabel(option.badge)}</span> : null}
              </div>
              <p className="mt-2 text-[12px] leading-5 text-[var(--app-muted)]">{uiLabel(option.body)}</p>
              <span className="absolute right-4 top-4 text-[var(--primary-bg)]">
                {saving === option.value ? <Loader2 className="h-4 w-4 animate-spin" /> : selected ? <Check className="h-4 w-4" /> : null}
              </span>
            </button>
          );
        })}
      </div></UiProps>

      <p className="mt-2 text-[11px] text-[var(--app-muted)]"><UiText id="admin.m9fa051bb3287" />{snapshot?.updatedAt ? <UiText id="admin.mdb9dfd3092e4" values={{v0: String(new Date(snapshot.updatedAt).toLocaleString(uiLocale === "en" ? "en-US" : "zh-CN"))}} /> : ""}
      </p>
      {snapshot?.pinnedByEnv ? <p className="mt-2 text-[12px] text-amber-600 dark:text-amber-300"><UiText id="admin.m11cec2303b24" /></p> : null}
      {error ? <p role="alert" className="mt-2 text-[12px] text-red-500">{uiError(error)}</p> : null}
      {snapshot && !snapshot.ossReady ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] leading-5 text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><UiText id="admin.m8ca2c3a2257d" /></div>
      ) : null}

      <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[13px] font-semibold text-[var(--app-fg)]"><UiText id="admin.m4622d477e2c0" /></div>
          <div className="text-[11px] text-[var(--app-muted)]">
            {forceOss ? <UiText id="admin.m564a200567e8" /> : <UiText id="admin.ma994715e5f35" />}
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-[12px]">
            <thead>
              <tr className="text-[11px] text-[var(--app-muted)]">
                <th className="border-b border-[var(--border)] py-2 pr-3 font-medium"><UiText id="admin.m910887705c7a" /></th>
                {KINDS.map((item) => <th key={item.kind} className="border-b border-[var(--border)] px-2 py-2 font-medium">{uiLabel(item.label)}</th>)}
                <th className="border-b border-[var(--border)] py-2 pl-2 font-medium"><UiText id="admin.m4262c45dc797" /></th>
              </tr>
            </thead>
            <tbody>
              {MEDIA_DELIVERY_PLATFORMS.map((entry) => (
                <tr key={entry.id} className="align-top">
                  <td className="border-b border-[var(--border)] py-2.5 pr-3">
                    <div className="font-medium text-[var(--app-fg)]">{entry.name}</div>
                    <div className="mt-0.5 text-[11px] text-[var(--app-muted)]">
                      {snapshot ? (enabled.has(entry.id) ? <UiText id="admin.mdfb802238b38" /> : <UiText id="admin.mf95ea7f4c063" />) : ""}
                      {entry.retention && !forceOss ? `${snapshot ? " · " : ""}${uiLabel(entry.retention)}` : ""}
                    </div>
                  </td>
                  {KINDS.map((item) => (
                    <td key={item.kind} className="border-b border-[var(--border)] px-2 py-2.5">
                      <MethodBadge method={entry.methods[item.kind]} forceOss={forceOss} />
                    </td>
                  ))}
                  <td className="border-b border-[var(--border)] py-2.5 pl-2 leading-5 text-[var(--app-muted)]">{uiLabel(entry.note)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-3 space-y-1.5 text-[11px] leading-5 text-[var(--app-muted)]">
          <li><UiText id="admin.m41a8f0625695" />{llmNames.join(uiLocale === "en" ? ", " : "、")}<UiText id="admin.m8896c4ae3496" /></li>
          <li><UiText id="admin.m00cba15fdaad" /></li>
          <li><UiText id="admin.m4a986b9577c3" /></li>
          <li><UiText id="admin.m07c8a48de479" /></li>
        </ul>
      </div>
    </section>
  );
}
