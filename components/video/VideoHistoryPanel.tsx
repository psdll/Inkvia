"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { ChevronDown, Image as ImageIcon, Info, Loader2, X } from "lucide-react";
import { normalizeMediaUrl } from "@/lib/media-url";
import { UnifiedHistoryPanel, type UnifiedHistoryPanelHandle } from "@/components/history/unified-history-panel";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AppVideoPlayer } from "@/components/ui/app-video-player";
import { FrostedSelect } from "@/components/ui/frosted-select";
import { MediaImage } from "@/components/ui/media-image";
import { friendlyErrorPrimaryText } from "@/lib/error-friendly";

type VideoHistoryPanelProps = {
  historyRef: React.RefObject<UnifiedHistoryPanelHandle>;
  historyFocusId: string | null;
  setHistoryFocusId: (id: string | null) => void;
  setHistoryCount: (count: number) => void;
  userId?: string;
};

type VideoHistoryItem = {
  id: string;
  type: string;
  status: string;
  localPath: string | null;
  errorMsg?: string | null;
  createdAt: string;
  finishedAt?: string | null;
  model?: string | null;
  prompt?: string | null;
  params?: Record<string, unknown> | null;
};

type TimeRangeFilter = "all" | "1d" | "7d" | "15d";
type TypeFilter = "all" | "video";
type VideoHistoryCacheEntry = {
  items: VideoHistoryItem[];
  fetchedAt: number;
};

const VIDEO_HISTORY_CACHE_TTL_MS = 30 * 1000;
const videoHistoryCache = new Map<string, VideoHistoryCacheEntry>();
const TIME_RANGE_OPTIONS = [
  { value: "1d", message: "createDynamic.md5f5a7a01073" },
  { value: "7d", message: "createDynamic.mfc7b29c29f1e" },
  { value: "15d", message: "createDynamic.m29aaed012645" },
  { value: "all", message: "createDynamic.mb28e2113fe3a" },
];
const TYPE_FILTER_OPTIONS = [
  { value: "all", message: "createDynamic.m267c4a7a86dd" },
  { value: "video", message: "createDynamic.m89174fe72eee" },
];

function getVideoHistoryCacheKey(userId: string) {
  return `video_history_cache_v2_${userId}`;
}

function readStoredVideoHistoryCache(userId: string): VideoHistoryCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(getVideoHistoryCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<VideoHistoryCacheEntry> | null;
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return {
      items: parsed.items as VideoHistoryItem[],
      fetchedAt: Number(parsed.fetchedAt) || 0,
    };
  } catch {
    return null;
  }
}

function writeStoredVideoHistoryCache(userId: string, entry: VideoHistoryCacheEntry) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(getVideoHistoryCacheKey(userId), JSON.stringify(entry));
  } catch {}
}

function getRangeCutoff(timeRange: TimeRangeFilter) {
  if (timeRange === "all") return 0;
  const now = new Date();
  if (timeRange === "1d") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  const days = timeRange === "7d" ? 7 : 15;
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function statusText(status: string, text: ReturnType<typeof useUiLocale>["text"]) {
  const v = String(status || "").toLowerCase();
  if (v === "success") return text("createDynamic.mf28461bb49c8");
  if (v === "running") return text("createDynamic.m969ef41f7e5b");
  if (v === "queued" || v === "pending" || v === "submitted" || v === "processing") return text("createDynamic.md6f766f2adf5");
  if (v === "failed") return text("createDynamic.m28384d7afd2e");
  if (v === "cancelled") return text("createDynamic.ma37778f17c5f");
  if (v === "expired") return text("createDynamic.m2fe0e3339ac4");
  return status || text("createDynamic.m4d8c1c5b4283");
}

function statusClass(status: string) {
  const v = String(status || "").toLowerCase();
  if (v === "success") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700";
  if (v === "running" || v === "queued" || v === "pending" || v === "submitted" || v === "processing") {
    return "border-blue-500/20 bg-blue-500/10 text-blue-700";
  }
  return "border-rose-500/20 bg-rose-500/10 text-rose-700";
}

function formatTime(value: string | null | undefined, locale: string) {
  if (!value) return "";
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleString(locale === "en" ? "en" : undefined);
}

function buildSummary(item: VideoHistoryItem) {
  const parts = [
    String(item.model || "").trim(),
    item.params && typeof item.params === "object" ? String((item.params as any).ratio || "").trim() : "",
    item.params && typeof item.params === "object" ? String((item.params as any).resolution || "").trim() : "",
    item.params && typeof item.params === "object" ? String((item.params as any).duration || "").trim() : ""
  ].filter(Boolean);
  return parts.join(" | ");
}

function getInputPreviewUrl(item: VideoHistoryItem) {
  const params = item.params && typeof item.params === "object" ? (item.params as any) : null;
  const direct = normalizeMediaUrl(params?.inputPreviewUrl || "");
  if (direct) return direct;
  const inputMedia = Array.isArray(params?.inputMedia) ? params.inputMedia : [];
  const firstImage = inputMedia.find((entry: any) => String(entry?.type || "") === "image");
  return normalizeMediaUrl(firstImage?.url || "");
}

function getDetailRows(item: VideoHistoryItem, text: ReturnType<typeof useUiLocale>["text"], locale: string) {
  const params = item.params && typeof item.params === "object" ? (item.params as any) : null;
  const duration = params?.duration ? `${params.duration}s` : "-";
  return [
    { label: text("createDynamic.mf66a521fb530"), value: String(params?.ratio || "16:9") },
    { label: text("createDynamic.mb92421822c21"), value: String(params?.resolution || "-") },
    { label: text("createDynamic.m47b2d56f0bf9"), value: String(params?.inputMode || "-") },
    { label: text("createDynamic.m4e0221b19771"), value: duration },
    { label: text("createDynamic.m5c04175c4536"), value: formatTime(item.finishedAt || item.createdAt, locale) || "-" },
    { label: text("createDynamic.mc98e118e0a43"), value: String(item.model || "Seedance 2.0") }
  ];
}

type StoryboardFrame = {
  time: number;
  url: string;
};

function VideoStoryboardStrip({
  src,
  onSelect
}: {
  src: string;
  onSelect?: (time: number) => void;
}) {
  const [frames, setFrames] = React.useState<StoryboardFrame[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    let objectUrls: string[] = [];
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.src = src;

    async function captureFrames() {
      try {
        await new Promise<void>((resolve, reject) => {
          const onLoaded = () => {
            cleanup();
            resolve();
          };
          const onError = () => {
            cleanup();
            reject(new Error("load video failed"));
          };
          const cleanup = () => {
            video.removeEventListener("loadedmetadata", onLoaded);
            video.removeEventListener("error", onError);
          };
          video.addEventListener("loadedmetadata", onLoaded);
          video.addEventListener("error", onError);
        });

        const duration = Number(video.duration || 0);
        const width = Math.max(1, video.videoWidth || 0);
        const height = Math.max(1, video.videoHeight || 0);
        if (!duration || !width || !height || !ctx) {
          if (!cancelled) setFrames([]);
          return;
        }

        const frameCount = Math.min(10, Math.max(6, Math.round(duration) + 2));
        const targetWidth = 112;
        const targetHeight = Math.max(1, Math.round((targetWidth * height) / width));
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const nextFrames: StoryboardFrame[] = [];
        for (let i = 0; i < frameCount; i += 1) {
          const rawTime = (duration * i) / Math.max(1, frameCount - 1);
          const safeTime = Math.min(duration - 0.05, Math.max(0, rawTime));
          await new Promise<void>((resolve) => {
            const onSeeked = () => {
              video.removeEventListener("seeked", onSeeked);
              resolve();
            };
            video.addEventListener("seeked", onSeeked);
            video.currentTime = safeTime;
          });
          if (cancelled) return;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), "image/jpeg", 0.72));
          if (!blob) continue;
          const url = URL.createObjectURL(blob);
          objectUrls.push(url);
          nextFrames.push({ time: safeTime, url });
        }

        if (!cancelled) setFrames(nextFrames);
      } catch {
        if (!cancelled) setFrames([]);
      }
    }

    void captureFrames();

    return () => {
      cancelled = true;
      video.pause();
      video.removeAttribute("src");
      video.load();
      for (const url of objectUrls) URL.revokeObjectURL(url);
      objectUrls = [];
    };
  }, [src]);

  if (!frames.length) return null;

  return (
    <div className="rounded-2xl border border-[var(--border)]/80 bg-[var(--panel-2)]/65 px-2 py-2">
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {frames.map((frame, index) => (
          <button
            key={`${frame.time}_${index}`}
            type="button"
            onClick={() => onSelect?.(frame.time)}
            className="group relative h-10 w-[68px] shrink-0 overflow-hidden rounded-lg border border-[var(--border)]/70 bg-[var(--panel-bg)] transition hover:border-[var(--app-muted)]/60"
            title={`${frame.time.toFixed(1)}s`}
          >
            <img src={frame.url} alt="" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-1 py-0.5 text-left text-[9px] text-white">
              {frame.time.toFixed(1)}s
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function VideoHistoryPanel({
  historyRef,
  historyFocusId,
  setHistoryFocusId,
  setHistoryCount,
  userId: userIdProp = ""
}: VideoHistoryPanelProps) {
  const { text, locale, error: localizeError } = useUiLocale();
  const { user } = useAuth();
  const videoRefs = React.useRef<Record<string, HTMLVideoElement | null>>({});
  const [userId, setUserId] = React.useState(userIdProp || "");
  const [timeRange, setTimeRange] = React.useState<TimeRangeFilter>("1d");
  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>("all");
  const [items, setItems] = React.useState<VideoHistoryItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [taskOpen, setTaskOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null);
  const [detailOpenId, setDetailOpenId] = React.useState<string | null>(null);
  const [expandedPromptId, setExpandedPromptId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (userIdProp) setUserId(userIdProp);
  }, [userIdProp]);

  React.useEffect(() => {
    if (userIdProp) return;
    setUserId(user?.id ? String(user.id) : "");
  }, [user?.id, userIdProp]);

  React.useEffect(() => {
    if (userId) return;
    setItems([]);
    setHistoryCount(0);
  }, [setHistoryCount, userId]);

  const loadVideoHistory = React.useCallback(async () => {
    if (!userId) return;
    const cached = videoHistoryCache.get(userId) || readStoredVideoHistoryCache(userId);
    if (cached) {
      videoHistoryCache.set(userId, cached);
      setItems((prev) => (prev.length ? prev : cached.items));
      const hasRunning = cached.items.some((item) => {
        const v = String(item.status || "").toLowerCase();
        return v === "running" || v === "queued" || v === "pending" || v === "submitted" || v === "processing";
      });
      if (Date.now() - cached.fetchedAt < VIDEO_HISTORY_CACHE_TTL_MS && !hasRunning) return;
    }
    setLoading(!cached && items.length === 0);
    try {
      const url = new URL("/api/history", window.location.origin);
      url.searchParams.set("userId", userId);
      url.searchParams.set("type", "video_gen");
      url.searchParams.set("status", "all");
      url.searchParams.set("withOutput", "0");
      url.searchParams.set("take", "200");
      const res = await fetch(url.toString());
      if (!res.ok) return;
      const json = (await res.json().catch(() => null)) as any;
      const raw = Array.isArray(json?.items) ? (json.items as VideoHistoryItem[]) : [];
      const nextItems: VideoHistoryItem[] = raw.map((x: any) => ({
        id: String(x.id),
        type: String(x.type || ""),
        status: String(x.status || ""),
        localPath: x.localPath ? String(x.localPath) : null,
        errorMsg: x.errorMsg ? String(x.errorMsg) : null,
        createdAt: String(x.createdAt || ""),
        finishedAt: x.finishedAt ? String(x.finishedAt) : null,
        model: x.model ? String(x.model) : null,
        prompt: x.prompt ? String(x.prompt) : null,
        params: x.params && typeof x.params === "object" ? x.params : null
      }));
      setItems(nextItems);
      const entry = { items: nextItems, fetchedAt: Date.now() };
      videoHistoryCache.set(userId, entry);
      writeStoredVideoHistoryCache(userId, entry);
    } finally {
      setLoading(false);
    }
  }, [items.length, userId]);

  React.useEffect(() => {
    if (!userId) return;
    void loadVideoHistory();
    const t = window.setInterval(() => void loadVideoHistory(), 2000);
    return () => window.clearInterval(t);
  }, [loadVideoHistory, userId]);

  const visibleItems = React.useMemo(() => {
    const rangeCutoff = getRangeCutoff(timeRange);
    return items.filter((item) => {
      if (typeFilter === "video" && item.type !== "video_gen" && item.type !== "video_generate") return false;
      if (!rangeCutoff) return true;
      const keyTime = new Date(String(item.finishedAt || item.createdAt || "")).getTime();
      if (!keyTime) return false;
      return keyTime >= rangeCutoff;
    });
  }, [items, timeRange, typeFilter]);

  React.useEffect(() => {
    setHistoryCount(visibleItems.length);
  }, [setHistoryCount, visibleItems.length]);

  const inProgressItems = React.useMemo(
    () =>
      items.filter((item) => {
        const v = String(item.status || "").toLowerCase();
        return v === "running" || v === "queued" || v === "pending" || v === "submitted" || v === "processing";
      }),
    [items]
  );

  const openItem = React.useCallback(
    (id: string) => {
      setHistoryFocusId(id);
    },
    [setHistoryFocusId]
  );

  const openVideoInNewTab = React.useCallback((item: VideoHistoryItem) => {
    if (!item.localPath) return;
    window.open(item.localPath, "_blank", "noopener,noreferrer");
  }, []);

  const downloadVideo = React.useCallback((item: VideoHistoryItem) => {
    if (!item.localPath) return;
    const a = document.createElement("a");
    a.href = item.localPath;
    a.download = "";
    a.rel = "noreferrer";
    a.click();
  }, []);

  const deleteOne = React.useCallback(async () => {
    if (!userId || !pendingDeleteId) return;
    const res = await fetch("/api/history/cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, action: "delete_single", generationId: pendingDeleteId })
    });
    await res.json().catch(() => null);
    setPendingDeleteId(null);
    await loadVideoHistory();
    historyRef.current?.reload();
  }, [historyRef, loadVideoHistory, pendingDeleteId, userId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="sr-only">
        <UnifiedHistoryPanel
          ref={historyRef}
          defaultType="all"
          focusId={historyFocusId}
          userId={userId}
          onItemCountChange={setHistoryCount}
        />
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-b border-[var(--border)] px-4 py-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setTaskOpen((prev) => !prev)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-xs text-[var(--app-fg)] transition hover:bg-[var(--panel-3)]"
          ><UiText id="video.mb341b84a7388" />{inProgressItems.length > 0 ? <span className="h-2 w-2 rounded-full bg-amber-400" /> : null}
            <ChevronDown className={["h-3.5 w-3.5 transition", taskOpen ? "rotate-180" : ""].join(" ")} />
          </button>
          {taskOpen ? (
            <div className="task-progress-popover absolute right-0 top-full z-40 mt-2 w-[320px] rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)]">
              <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
                <div className="text-sm font-medium text-[var(--app-fg)]"><UiText id="video.mfccd86db2a9d" /></div>
                <button
                  type="button"
                  onClick={() => setTaskOpen(false)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="max-h-[320px] overflow-y-auto p-2">
                {items.length ? (
                  <div className="space-y-2">
                    {items.slice(0, 20).map((item) => (
                      <button
                        key={`task_${item.id}`}
                        type="button"
                        onClick={() => {
                          openItem(item.id);
                          setTaskOpen(false);
                        }}
                        className="task-progress-item flex w-full items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-2 text-left transition hover:bg-[var(--panel-3)]"
                      >
                        <div className={["mt-0.5 rounded-full border px-2 py-0.5 text-[10px]", statusClass(item.status)].join(" ")}>
                          {statusText(item.status, text)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-[var(--app-fg)]">{item.prompt || <UiText id="video.mfccd86db2a9d" />}</div>
                          <div className="mt-1 text-[10px] text-[var(--app-muted)]">{formatTime(item.createdAt, locale)}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="py-10 text-center text-xs text-[var(--app-muted)]"><UiText id="video.me393f849bfa1" /></div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <FrostedSelect
          value={timeRange}
          onChange={(value) => setTimeRange(value as TimeRangeFilter)}
          options={TIME_RANGE_OPTIONS.map(({ value, message }) => ({ value, label: text(message) }))}
          className="w-[108px]"
          ariaLabel={text("createDynamic.m07eb730af899")}
          showLeading={false}
          compact
          side="bottom"
        />

        <FrostedSelect
          value={typeFilter}
          onChange={(value) => setTypeFilter(value as TypeFilter)}
          options={TYPE_FILTER_OPTIONS.map(({ value, message }) => ({ value, label: text(message) }))}
          className="w-[108px]"
          ariaLabel={text("createDynamic.m21517c09a6e0")}
          showLeading={false}
          compact
          side="bottom"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-8">
        {loading && !visibleItems.length ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--app-muted)]" />
          </div>
        ) : visibleItems.length ? (
          <div className="flex w-full flex-col items-center gap-10 pb-8">
            {visibleItems.map((item) => {
              const active = historyFocusId === item.id;
              const isVideo = Boolean(item.localPath);
              const inputPreviewUrl = getInputPreviewUrl(item);
              const detailRows = getDetailRows(item, text, locale);
              const detailOpen = detailOpenId === item.id;
              const promptExpanded = expandedPromptId === item.id;
              return (
                <div
                  key={item.id}
                  className={[
                    "relative w-full max-w-[720px] px-1 transition",
                    active ? "text-[var(--app-fg)]" : "text-[var(--app-fg)]"
                  ].join(" ")}
                >
                  {detailOpen ? (
                    <div className="absolute left-[calc(100%+16px)] top-10 z-30 hidden w-[220px] rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-3 shadow-[var(--shadow)] xl:block">
                      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
                        {detailRows.map((row) => (
                          <React.Fragment key={`${item.id}_${row.label}`}>
                            <div className="text-[var(--app-muted)]">{row.label}</div>
                            <div className="truncate text-right text-[var(--app-fg)]">{row.value}</div>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div className="mt-0.5 h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-[var(--border)]/80 bg-[var(--panel-2)] shadow-sm">
                          {inputPreviewUrl ? (
                            <MediaImage src={inputPreviewUrl} alt="" className="h-full w-full object-cover" previewSize={{ width: 320, height: 320 }} />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[var(--app-muted)]">
                              <ImageIcon className="h-4.5 w-4.5" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1 pt-0.5">
                          <div className="space-y-1">
                            <button
                              type="button"
                              onClick={() => setExpandedPromptId(promptExpanded ? null : item.id)}
                              className="block w-full text-left text-[12px] font-medium leading-5.5 text-[var(--app-fg)] sm:text-[13px]"
                              style={
                                promptExpanded
                                  ? undefined
                                  : {
                                      display: "-webkit-box",
                                      WebkitLineClamp: 2,
                                      WebkitBoxOrient: "vertical",
                                      overflow: "hidden"
                                    }
                              }
                            >
                              {item.prompt || <UiText id="video.mfccd86db2a9d" />}
                            </button>
                            <div className="flex flex-wrap items-center gap-x-2 text-[10px] font-medium text-[var(--app-muted)] sm:text-[11px]">
                              <span>{buildSummary(item) || <UiText id="video.m9e642334fcb9" />}</span>
                              <button
                                type="button"
                                onClick={() => setDetailOpenId(detailOpen ? null : item.id)}
                                className="inline-flex items-center gap-1 text-[var(--app-muted)] transition hover:text-[var(--app-fg)]"
                              >
                                <Info className="h-3.5 w-3.5" /><UiText id="video.m1932da4d4dba" /></button>
                            </div>
                          </div>
                        </div>
                      </div>
                      <span className={["shrink-0 rounded-full border px-2 py-0.5 text-[10px]", statusClass(item.status)].join(" ")}>
                        {statusText(item.status, text)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[10px] font-medium text-[var(--app-muted)] sm:text-[11px]">
                      <span className="truncate">{formatTime(item.finishedAt || item.createdAt, locale)}</span>
                    </div>

                    <div className="relative aspect-[16/9] w-full max-w-[380px] overflow-hidden rounded-2xl bg-[var(--panel-2)] sm:max-w-[430px] lg:max-w-[500px]">
                      {isVideo ? (
                        <AppVideoPlayer
                          src={item.localPath || ""}
                          ref={(node) => {
                            videoRefs.current[item.id] = node;
                          }}
                          className="h-full w-full object-contain"
                          containerClassName="h-full w-full"
                          playsInline
                          preload="metadata"
                          onClick={() => openItem(item.id)}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-sm text-[var(--app-muted)]">
                          {statusText(item.status, text)}
                        </div>
                      )}
                    </div>

                    {detailOpen ? (
                      <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-3 xl:hidden">
                        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
                          {detailRows.map((row) => (
                            <React.Fragment key={`${item.id}_mobile_${row.label}`}>
                              <div className="text-[var(--app-muted)]">{row.label}</div>
                              <div className="truncate text-right text-[var(--app-fg)]">{row.value}</div>
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {item.errorMsg ? (
                      <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-700">
                        {friendlyErrorPrimaryText(item.errorMsg)}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          openItem(item.id);
                          openVideoInNewTab(item);
                        }}
                        className="inline-flex h-7 items-center rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[11px] text-[var(--app-fg)] transition hover:bg-[var(--panel-3)]"
                      ><UiText id="video.m7c4b06e07cb4" /></button>
                      {item.localPath ? (
                        <button
                          type="button"
                          onClick={() => downloadVideo(item)}
                          className="inline-flex h-7 items-center rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[11px] text-[var(--app-fg)] transition hover:bg-[var(--panel-3)]"
                        ><UiText id="video.m4673a2306165" /></button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          setPendingDeleteId(item.id);
                          setDeleteOpen(true);
                        }}
                        className="ml-auto inline-flex h-7 items-center rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[11px] text-[var(--app-fg)] transition hover:bg-[var(--panel-3)]"
                      ><UiText id="video.m6135d4159e89" /></button>
                    </div>

                    {detailOpen && item.localPath ? (
                      <VideoStoryboardStrip
                        src={item.localPath}
                        onSelect={(time) => {
                          const video = videoRefs.current[item.id];
                          if (!video) return;
                          video.currentTime = time;
                          video.pause();
                          openItem(item.id);
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="text-sm font-medium text-[var(--app-fg)]"><UiText id="video.me323432e2572" /></div>
            <div className="mt-2 text-xs text-[var(--app-muted)]"><UiText id="video.m5b97b422819e" /></div>
          </div>
        )}
      </div>

      <UiProps ids={{"title":["video.m503dc1ce2c48"],"description":["video.m71d82875cbed"],"confirmText":["video.m6135d4159e89"]}}><ConfirmDialog
        open={deleteOpen}
        title="video.m503dc1ce2c48"
        description="video.m71d82875cbed"
        danger
        confirmText="video.m6135d4159e89"
        onConfirm={deleteOne}
        onClose={() => {
          setDeleteOpen(false);
          setPendingDeleteId(null);
        }}
      /></UiProps>
    </div>
  );
}
