"use client";
import { UiText, UiProps } from "@/i18n/ui";


import * as React from "react";
import { Download, RefreshCw, Search, Video } from "lucide-react";
import { normalizeMediaUrl } from "@/lib/media-url";
import { adminDisplayName, fmtTime, isVideoPath } from "@/lib/admin-utils";
import { MediaImage } from "@/components/ui/media-image";
import { RowsSkeleton } from "@/components/ui/skeleton";
import { fetchJsonOnce } from "@/lib/client/inflight-json";

type FeedbackCenterItem = {
  id: number;
  createdAt: string;
  userId: string;
  username: string | null;
  level: string;
  feedbackType: string;
  content: string;
  attachments: string[];
  adminReply?: string | null;
  repliedAt?: string | null;
  repliedBy?: string | null;
  replyStatus?: string;
};

export type FeedbackCenterPanelHandle = {
  /** 供父级在删除等外部操作完成后触发列表重载 */
  refresh: () => Promise<void>;
};

type FeedbackCenterPanelProps = {
  /** 点击附件缩略图时，调用父级的灯箱 */
  openDetailZoom: (src: string) => void;
  /** 请求删除某条反馈（父级会弹出确认弹窗并执行实际删除） */
  onRequestDeleteFeedback: (id: number) => void;
  /** 当某条反馈被回复成功后通知父级（例如刷新当前用户数据） */
  onReplied?: () => void;
};

const FeedbackCenterPanel = React.forwardRef<FeedbackCenterPanelHandle, FeedbackCenterPanelProps>(
  function FeedbackCenterPanel({ openDetailZoom, onRequestDeleteFeedback, onReplied }, ref) {
    const [items, setItems] = React.useState<FeedbackCenterItem[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [loadError, setLoadError] = React.useState<string | null>(null);
    // 骨架屏只在首次加载显示；之后刷新原地更新，不再白屏
    const [initialLoaded, setInitialLoaded] = React.useState(false);
    const [q, setQ] = React.useState("");
    const [typeFilter, setTypeFilter] = React.useState<"all" | "bug" | "complaint" | "idea">("all");
    const [replyDraftById, setReplyDraftById] = React.useState<Record<number, string>>({});
    const [replyBusyById, setReplyBusyById] = React.useState<Record<number, boolean>>({});

    const load = React.useCallback(async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const result = await fetchJsonOnce<{ items?: FeedbackCenterItem[]; error?: string }>("/api/admin/feedback/list?take=500");
        if (!result.ok) throw new Error(result.json?.error || "反馈加载失败，请重试");
        const json = result.json;
        if (!Array.isArray(json?.items)) throw new Error("反馈数据不完整，请重试");
        setItems(json.items);
        setInitialLoaded(true);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "反馈加载失败，请重试");
      } finally {
        setLoading(false);
      }
    }, []);

    React.useImperativeHandle(ref, () => ({ refresh: load }), [load]);

    React.useEffect(() => {
      void load();
    }, [load]);

    const filteredItems = React.useMemo(() => {
      const keyword = q.trim().toLowerCase();
      return items.filter((x) => {
        if (typeFilter !== "all" && x.feedbackType !== typeFilter) return false;
        if (!keyword) return true;
        const target = `${x.username || ""} ${x.userId || ""} ${x.content || ""} ${x.adminReply || ""}`.toLowerCase();
        return target.includes(keyword);
      });
    }, [items, q, typeFilter]);

    const renderAttachments = React.useCallback(
      (attachments: string[], keyPrefix: string) => {
        const entries = attachments
          .map((url, idx) => ({ raw: String(url || "").trim(), idx }))
          .map(({ raw, idx }) => ({ idx, raw, src: normalizeMediaUrl(raw) }))
          .filter((x) => !!x.src);
        if (!entries.length) return null;

        return (
          <div className="mt-2 space-y-2">
            <div className="text-[11px] text-[var(--app-muted)]"><UiText id="admin.m03663e5f0f18" /></div>
            <div className="flex flex-wrap gap-2">
              {entries.map(({ idx, raw, src }) => {
                const isVideo = isVideoPath(src);
                return (
                  <div
                    key={`${keyPrefix}_${idx}`}
                    className="w-[88px] rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-1.5 space-y-1.5"
                  >
                    <button
                      type="button"
                      onClick={() => openDetailZoom(src)}
                      className="block w-full overflow-hidden rounded-lg border border-[var(--border)] bg-black/20"
                      title={`查看附件${idx + 1}`}
                    >
                      {isVideo ? (
                        <div className="flex h-[72px] w-full flex-col items-center justify-center gap-1 bg-black/35 text-white/70">
                          <Video className="h-5 w-5" />
                          <span className="text-[10px]"><UiText id="admin.mc20f7618d330" /></span>
                        </div>
                      ) : (
                        <MediaImage src={src} alt={`附件${idx + 1}`} className="h-[72px] w-full object-cover" previewSize={{ width: 240, height: 180 }} />
                      )}
                    </button>
                    <a
                      href={raw || src}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-7 items-center justify-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[11px] text-[var(--app-fg)] hover:bg-[var(--panel-3)]"
                    >
                      <Download className="h-3 w-3" /><UiText id="admin.mc8d7aa3a3745" /></a>
                  </div>
                );
              })}
            </div>
          </div>
        );
      },
      [openDetailZoom]
    );

    return (
      <div className="w-full space-y-6">
        <div className="rounded-3xl border border-white/10 bg-[var(--panel-bg)]/92 p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[15px] font-semibold text-[var(--app-fg)]"><UiText id="admin.mcf0a9c0246ca" /></div>
              <div className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.mcfa61e4e6512" /></div>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              aria-busy={loading}
              className="h-9 px-3 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] text-[13px] text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] transition flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              {loading ? <UiText id="admin.m7f3c8312816f" /> : <UiText id="admin.maee887434131" />}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[260px] flex-1 max-w-[420px]">
              <Search className="h-4 w-4 text-[var(--app-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
              <UiProps ids={{"placeholder":["admin.mbf8d5983e69d"]}}><input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="admin.mbf8d5983e69d"
                className="h-10 w-full pl-9 pr-3 rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-[13px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20"
              /></UiProps>
            </div>
            <div className="flex bg-[var(--input-bg)] p-1 rounded-xl border border-[var(--border)]">
              {[
                { key: "all", label: "全部" },
                { key: "bug", label: "Bug" },
                { key: "complaint", label: "吐槽" },
                { key: "idea", label: "想法" },
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTypeFilter(t.key as "all" | "bug" | "complaint" | "idea")}
                  className={[
                    "h-8 px-3 rounded-lg text-[12px] transition",
                    typeFilter === t.key
                      ? "bg-[var(--panel-2)] text-[var(--app-fg)] shadow-sm"
                      : "text-[var(--app-muted)] hover:text-[var(--app-fg)]",
                  ].join(" ")}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loadError ? (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-400">
            <span>{loadError}{initialLoaded ? <UiText id="admin.mdd78254cf341" /> : ""}</span>
            <button type="button" onClick={() => void load()} disabled={loading} className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[var(--app-fg)]"><UiText id="admin.mb8784c8dd563" /></button>
          </div>
        ) : null}
        <div aria-busy={loading} className="rounded-3xl border border-white/10 bg-[var(--panel-bg)]/94 p-5 shadow-sm min-h-[420px]">
          {!initialLoaded && loading ? (
            <RowsSkeleton rows={6} />
          ) : !initialLoaded ? (
            <div className="py-12 text-center text-[13px] text-[var(--app-muted)]"><UiText id="admin.mee20741870d4" /></div>
          ) : filteredItems.length ? (
            <div className="space-y-3">
              {filteredItems.map((f) => (
                <div key={f.id} className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] px-2 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-400">
                        {f.feedbackType === "bug"
                          ? <UiText id="admin.m67d0cc6e04f3" />
                          : f.feedbackType === "complaint"
                            ? <UiText id="admin.m682970410ff7" />
                            : f.feedbackType === "idea"
                              ? <UiText id="admin.meba3a7fc6658" />
                              : f.feedbackType}
                      </span>
                      <span className="text-[11px] text-[var(--app-muted)]">{fmtTime(f.createdAt)}</span>
                      <span className="text-[11px] text-[var(--app-muted)]"><UiText id="admin.m1a78d1d50196" />{adminDisplayName(f)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRequestDeleteFeedback(f.id)}
                      className="h-7 px-2.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-[11px] hover:bg-rose-500 hover:text-white transition dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400"
                    ><UiText id="admin.m8e30c529c03c" /></button>
                  </div>
                  <div className="mt-2 text-[13px] text-[var(--app-fg)] whitespace-pre-wrap break-words">
                    {f.content || "-"}
                  </div>
                  {f.adminReply ? (
                    <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-500/25 dark:bg-emerald-500/10">
                      <div className="text-[11px] text-emerald-700 dark:text-emerald-400"><UiText id="admin.mec45c65beadb" />{f.repliedBy ? `（${f.repliedBy}）` : ""}
                        {f.repliedAt ? ` · ${fmtTime(f.repliedAt)}` : ""}
                      </div>
                      <div className="mt-1 text-[12px] text-[var(--app-fg)] whitespace-pre-wrap break-words">
                        {f.adminReply}
                      </div>
                    </div>
                  ) : null}
                  {Array.isArray(f.attachments) && f.attachments.length > 0
                    ? renderAttachments(f.attachments, `feedback_center_${f.id}`)
                    : null}
                  <div className="mt-3 space-y-2">
                    <UiProps ids={{"placeholder":["admin.m9a1d91c07ae0"]}}><textarea
                      value={replyDraftById[f.id] ?? f.adminReply ?? ""}
                      onChange={(e) =>
                        setReplyDraftById((prev) => ({
                          ...prev,
                          [f.id]: e.target.value.slice(0, 1000),
                        }))
                      }
                      placeholder="admin.m9a1d91c07ae0"
                      className="w-full min-h-[72px] rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-[12px] text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20"
                    /></UiProps>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] text-[var(--app-muted)]">
                        {(replyDraftById[f.id] ?? f.adminReply ?? "").length}/1000
                      </div>
                      <button
                        type="button"
                        disabled={
                          !!replyBusyById[f.id] ||
                          (replyDraftById[f.id] ?? f.adminReply ?? "").trim().length < 2
                        }
                        onClick={async () => {
                          const reply = String(replyDraftById[f.id] ?? f.adminReply ?? "").trim();
                          if (reply.length < 2) return;
                          setReplyBusyById((prev) => ({ ...prev, [f.id]: true }));
                          try {
                            const res = await fetch("/api/admin/feedback", {
                              method: "PATCH",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({ id: f.id, reply }),
                            }).catch(() => null);
                            if (!res || !res.ok) return;
                            await load();
                            onReplied?.();
                          } finally {
                            setReplyBusyById((prev) => ({ ...prev, [f.id]: false }));
                          }
                        }}
                        className="h-8 px-3 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-[11px] hover:bg-blue-500 hover:text-white transition disabled:opacity-50 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-400"
                      >
                        {replyBusyById[f.id] ? <UiText id="admin.mc07989931a02" /> : f.adminReply ? <UiText id="admin.mf039b4b1bad7" /> : <UiText id="admin.m6f6b402f6492" />}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-[13px] text-[var(--app-muted)]">{loadError ? <UiText id="admin.m9ab86c9db0e7" /> : q.trim() || typeFilter !== "all" ? <UiText id="admin.m395eef3d7ac3" /> : <UiText id="admin.md463fae35be4" />}</div>
          )}
        </div>
      </div>
    );
  }
);

export default FeedbackCenterPanel;

export function FeedbackCenterPanelEntry({ panelRef, ...props }: FeedbackCenterPanelProps & { panelRef: React.Ref<FeedbackCenterPanelHandle> }) {
  return <FeedbackCenterPanel {...props} ref={panelRef} />;
}
