"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { X } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";

type FeedbackType = "bug" | "complaint" | "idea";

type FeedbackModalProps = {
  open: boolean;
  onClose: () => void;
  onRepliesSeen?: (latestReplyKey: string | null) => void;
};

const FEEDBACK_REPLIES_POLL_MS = 5000;

function feedbackFileKey(file: File) {
  return `${file.name}_${file.size}_${file.lastModified}`;
}

function isImageFile(file: File) {
  return String(file.type || "").toLowerCase().startsWith("image/");
}

function isVideoFile(file: File) {
  return String(file.type || "").toLowerCase().startsWith("video/");
}

export function FeedbackModal({ open, onClose, onRepliesSeen }: FeedbackModalProps) {
  const { label: uiLabel, error: uiError, locale: uiLocale } = useUiLocale();
  const { user } = useAuth();
  const [feedbackType, setFeedbackType] = React.useState<FeedbackType>("bug");
  const [feedbackContent, setFeedbackContent] = React.useState("");
  const [feedbackFiles, setFeedbackFiles] = React.useState<File[]>([]);
  const [feedbackFilePreviews, setFeedbackFilePreviews] = React.useState<Record<string, string>>({});
  const [feedbackSaving, setFeedbackSaving] = React.useState(false);
  const [feedbackErr, setFeedbackErr] = React.useState<string | null>(null);
  const [feedbackOk, setFeedbackOk] = React.useState<string | null>(null);
  const [repliesOpen, setRepliesOpen] = React.useState(false);
  const [feedbackReplies, setFeedbackReplies] = React.useState<
    Array<{
      id: number;
      createdAt: string;
      feedbackType: string;
      content: string;
      adminReply: string;
      repliedAt: string | null;
      repliedBy: string | null;
    }>
  >([]);
  const feedbackFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const feedbackMaxFiles = 10;
  const latestReplyKey = React.useMemo(() => {
    const first = feedbackReplies[0];
    if (!first) return null;
    return `${first.id}:${first.repliedAt || first.createdAt || ""}`;
  }, [feedbackReplies]);

  const formatFileSize = React.useCallback((size: number) => {
    const n = Math.max(0, Number(size) || 0);
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

  React.useEffect(() => {
    if (!open) return;
    setFeedbackErr(null);
    setFeedbackOk(null);
    setRepliesOpen(false);
  }, [open]);

  const loadFeedbackReplies = React.useCallback(async () => {
    if (!user) {
      setFeedbackReplies([]);
      return;
    }
    const res = await fetch(`/api/logs?action=feedback_submit&limit=100&ts=${Date.now()}`, {
      cache: "no-store",
      headers: {
        "cache-control": "no-cache",
        pragma: "no-cache",
      },
    }).catch(() => null);
    if (!res || !res.ok) return;
    const json = (await res.json().catch(() => null)) as any;
    const rows = Array.isArray(json?.data) ? json.data : [];
    const items = rows
      .map((r: any) => {
        const meta = r?.metadata && typeof r.metadata === "object" ? r.metadata : null;
        const adminReply = String(meta?.adminReply || "").trim();
        if (!adminReply) return null;
        return {
          id: Number(r?.id) || 0,
          createdAt: String(r?.createdAt || ""),
          feedbackType: String(meta?.feedbackType || "").trim() || "bug",
          content: String(meta?.content || r?.message || "").trim(),
          adminReply,
          repliedAt: String(meta?.repliedAt || "").trim() || null,
          repliedBy: String(meta?.repliedBy || "").trim() || null,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        const bt = new Date(b.repliedAt || b.createdAt || 0).getTime();
        const at = new Date(a.repliedAt || a.createdAt || 0).getTime();
        return bt - at;
      }) as Array<{
        id: number;
        createdAt: string;
        feedbackType: string;
        content: string;
        adminReply: string;
        repliedAt: string | null;
        repliedBy: string | null;
      }>;
    setFeedbackReplies(items);
  }, [user]);

  React.useEffect(() => {
    if (!open) return;
    void loadFeedbackReplies();
  }, [loadFeedbackReplies, open]);

  React.useEffect(() => {
    if (!open || !user) return;

    const timer = window.setInterval(() => {
      void loadFeedbackReplies();
    }, FEEDBACK_REPLIES_POLL_MS);

    const onFocus = () => {
      void loadFeedbackReplies();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [loadFeedbackReplies, open, user]);

  React.useEffect(() => {
    if (!repliesOpen) return;
    onRepliesSeen?.(latestReplyKey);
  }, [latestReplyKey, onRepliesSeen, repliesOpen]);

  const submitFeedback = React.useCallback(async () => {
    setFeedbackErr(null);
    setFeedbackOk(null);
    const content = feedbackContent.trim();
    if (content.length < 5) {
      setFeedbackErr("请至少填写 5 个字描述问题。");
      return;
    }
    setFeedbackSaving(true);
    try {
      const form = new FormData();
      form.append("feedbackType", feedbackType);
      form.append("content", content);
      for (const f of feedbackFiles.slice(0, feedbackMaxFiles)) form.append("attachments", f);
      const res = await fetch("/api/feedback", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedbackErr(String(json?.error || "提交失败，请稍后重试"));
        return;
      }
      setFeedbackOk("提交成功，管理员会查看并跟进。");
      setFeedbackContent("");
      setFeedbackFiles([]);
      setFeedbackType("bug");
      void loadFeedbackReplies();
    } catch {
      setFeedbackErr("网络异常，请稍后重试。");
    } finally {
      setFeedbackSaving(false);
    }
  }, [feedbackContent, feedbackFiles, feedbackType, loadFeedbackReplies]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !feedbackSaving && onClose()} />
      <div className="solid-panel-surface relative w-full max-w-xl rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <div>
            <h2 className="text-[16px] font-semibold text-[var(--app-fg)]"><UiText id="common.m0f7d68ecdcf6" /></h2>
          </div>
          <div className="flex items-center gap-2">
            {feedbackReplies.length > 0 ? (
              <button
                type="button"
                onClick={() => setRepliesOpen(true)}
                className="h-8 px-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-[12px] text-emerald-400 hover:bg-emerald-500/15"
              ><UiText id="common.m70485b5138ab" />{feedbackReplies.length}）
              </button>
            ) : null}
            <button type="button" onClick={() => !feedbackSaving && onClose()} className="h-8 w-8 rounded-lg hover:bg-[var(--panel-2)] text-[var(--app-muted)] flex items-center justify-center">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="space-y-2">
            <div className="text-[13px] font-medium text-[var(--app-fg)]"><UiText id="common.m43d4d6c8d4ca" /></div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: "bug", label: "提交 Bug" },
                { key: "complaint", label: "我要吐槽" },
                { key: "idea", label: "我有想法" },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setFeedbackType(item.key as FeedbackType)}
                  className={[
                    "h-10 rounded-xl border text-[12px] font-medium transition",
                    feedbackType === item.key
                      ? "border-blue-500/50 bg-blue-500/15 text-blue-400"
                      : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)] hover:text-[var(--app-fg)]"
                  ].join(" ")}
                >
                  {uiLabel(item.label)}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-[13px] font-medium text-[var(--app-fg)]"><UiText id="common.mdc2ba467fc7a" /></div>
            <UiProps ids={{"placeholder":["common.m5ee9e49b9f08"]}}><textarea
              value={feedbackContent}
              onChange={(e) => setFeedbackContent(e.target.value.slice(0, 1000))}
              placeholder="common.m5ee9e49b9f08"
              className="w-full min-h-[140px] rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-[13px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20"
            /></UiProps>
            <div className="text-right text-[11px] text-[var(--app-muted)]">{feedbackContent.length}/1000</div>
          </div>
          <div className="space-y-2">
            <div className="text-[13px] font-medium text-[var(--app-fg)]"><UiText id="common.md20acd2ed43c" /></div>
            <input
              ref={feedbackFileInputRef}
              type="file"
              multiple
              accept="image/*,video/*"
              onChange={(e) => {
                const picked = Array.from(e.target.files || []);
                setFeedbackFiles((prev) => {
                  const merged = [...prev];
                  for (const f of picked) {
                    const key = `${f.name}_${f.size}_${f.lastModified}`;
                    const exists = merged.some((x) => `${x.name}_${x.size}_${x.lastModified}` === key);
                    if (!exists) merged.push(f);
                    if (merged.length >= feedbackMaxFiles) break;
                  }
                  return merged.slice(0, feedbackMaxFiles);
                });
                if (feedbackFileInputRef.current) feedbackFileInputRef.current.value = "";
              }}
              className="hidden"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => feedbackFileInputRef.current?.click()}
                className="h-9 px-3 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] text-[12px] text-[var(--app-fg)] hover:bg-[var(--panel-3)]"
              ><UiText id="common.m822fb37dba29" /></button>
              <div className="text-[12px] text-[var(--app-muted)]">
                {feedbackFiles.length ? <UiText id="common.m969e3d375824" values={{v0: String(feedbackFiles.length)}} /> : <UiText id="common.mce2a58ab4ccf" />}
              </div>
            </div>
            <div className="text-[11px] text-[var(--app-muted)]"><UiText id="common.mf61e6a78cbb1" /></div>
            {!!feedbackFiles.length && (
              <div className="space-y-2">
                <div className="space-y-1">
                  {feedbackFiles.map((f, idx) => (
                    <div key={`${f.name}_${f.size}_${f.lastModified}`} className="h-8 px-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] flex items-center justify-between gap-2">
                      <div className="min-w-0 text-[11px] text-[var(--app-fg)] truncate">{idx + 1}. {f.name}</div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[10px] text-[var(--app-muted)]">{formatFileSize(f.size)}</span>
                        <button
                          type="button"
                          onClick={() => setFeedbackFiles((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-[10px] text-rose-400 hover:text-rose-300"
                        ><UiText id="common.m2f9daa828907" /></button>
                      </div>
                    </div>
                  ))}
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => setFeedbackFiles([])}
                    className="text-[11px] text-[var(--app-muted)] hover:text-[var(--app-fg)]"
                  ><UiText id="common.m5ad310b70484" /></button>
                </div>
              </div>
            )}
          </div>
          {feedbackErr && <div className="text-[12px] text-rose-500">{uiError(feedbackErr)}</div>}
          {feedbackOk && <div className="text-[12px] text-emerald-400">{uiLabel(feedbackOk)}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={feedbackSaving}
              onClick={onClose}
              className="h-9 px-4 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] text-[13px] text-[var(--app-fg)] hover:bg-[var(--panel-3)] disabled:opacity-50"
            ><UiText id="common.m2cd0f3be8738" /></button>
            <button
              type="button"
              disabled={feedbackSaving}
              onClick={() => void submitFeedback()}
              className="h-9 px-4 rounded-xl bg-blue-600 text-white text-[13px] font-medium hover:bg-blue-500 disabled:opacity-50"
            >
              {feedbackSaving ? <UiText id="common.m18931020ad52" /> : <UiText id="common.md351944c6050" />}
            </button>
          </div>
        </div>
        {repliesOpen ? (
          <div className="absolute inset-0 bg-[var(--panel-bg)]">
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <div className="text-[16px] font-semibold text-[var(--app-fg)]"><UiText id="common.mec45c65beadb" /></div>
              <button
                type="button"
                onClick={() => setRepliesOpen(false)}
                className="h-8 w-8 rounded-lg hover:bg-[var(--panel-2)] text-[var(--app-muted)] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 max-h-[70dvh] overflow-auto space-y-2">
              {feedbackReplies.slice(0, 10).map((item) => (
                <div key={item.id} className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-3 space-y-2">
                  <div className="text-[11px] text-emerald-400">
                    {item.feedbackType === "bug" ? <UiText id="common.m67d0cc6e04f3" /> : item.feedbackType === "complaint" ? <UiText id="common.m682970410ff7" /> : <UiText id="common.meba3a7fc6658" />}
                    {item.repliedBy ? ` · ${item.repliedBy}` : ""}
                    {item.repliedAt ? ` · ${new Date(item.repliedAt).toLocaleString(uiLocale === "en" ? "en-US" : "zh-CN")}` : ""}
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2">
                    <div className="text-[11px] text-[var(--app-muted)]"><UiText id="common.mee75a286bb3f" /></div>
                    <div className="text-[12px] text-[var(--app-fg)] whitespace-pre-wrap break-words">{item.content || "-"}</div>
                  </div>
                  <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2">
                    <div className="text-[11px] text-emerald-400"><UiText id="common.mec45c65beadb" /></div>
                    <div className="text-[12px] text-[var(--app-fg)] whitespace-pre-wrap break-words">{item.adminReply}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
