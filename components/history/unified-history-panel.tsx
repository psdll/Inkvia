"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";

import { isSeedream55Model } from "@/lib/volcengine-seedream-55";

import { Seedream55Result } from "@/components/image/seedream-55-result";
import { isGptImageVariantModel } from "@/lib/gpt-image-25-models";
import { GoogleGroundingSources } from "@/components/image/google-grounding-sources";

import { useModelDisplayNames } from "@/hooks/use-model-display-names";
import { resolveModelDisplayName } from "@/lib/model-display-name";

import * as React from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { Check, Copy, Download, FileAudio2, Info, Loader2, Pause, Play, RotateCcw, Trash2, X, Wand2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AppVideoPlayer } from "@/components/ui/app-video-player";
import { captureVideoFrame } from "@/lib/browser/video-frame-capture";
import { formatUiLabel } from "@/i18n/source-messages";
import type { UiLocale } from "@/i18n/locale";
import { VIDEO_FRAME_LABELS, type VideoFrameMode } from "@/lib/video-frame";
import { MediaLightbox } from "@/components/ui/media-lightbox";
import { VideoPosterPreview } from "@/components/ui/video-poster-preview";
import { CanvasBoard } from "@/components/ui/canvas-board";
import { ImageResolution, readImageDimensions } from "@/components/ui/image-resolution";
import { MediaImage } from "@/components/ui/media-image";
import { ResilientImage } from "@/components/ui/resilient-image";
import { HistoryThumbnailStrip, type HistoryThumbnailStripHandle } from "@/components/history/history-thumbnail-strip";
import { buildMediaOriginalUrl, inferMediaUrlKind, isVideoMediaUrl, normalizeMediaUrl } from "@/lib/media-url";
import {
  commitVideoTemplateToStudio,
  getVideoTemplateModeLabel,
  prepareVideoTemplateForStudio,
  resolveVideoTemplateInputMode
} from "@/lib/video-template-reuse";
import { friendlyErrorPrimaryText, parseFriendlyMessageFromStorage } from "@/lib/error-friendly";
import { writeEphemeralToolTemplate } from "@/lib/ephemeral-input-draft";
import { stripPromptAssetMentions } from "@/lib/prompt-rich-editor-content";
import {
  compareHistoryDisplayGroupItems,
  getHistoryDisplayGroupKey,
  getSubmissionBatchMetadata,
  getSubmissionTaskKey,
  isSameSubmissionBatchTask,
  shouldKeepSubmissionBatchPlaceholder,
  sortHistoryBySubmissionOrder,
} from "@/lib/history-batch-order";
import { fetchHistoryStatuses } from "@/lib/history/client";
import { appendHistoryPage, mergeHistoryFirstPage, parseHistoryPageCache, replaceById } from "@/lib/history/page-state";
import { jitterPollDelay, sameHistoryStatusSnapshot, type HistoryStatusRecord } from "@/lib/history/status";
import { isKnownDeletedGenerationId, subscribeGenerationDeleted } from "@/lib/generation-deletion-events";
import { getGenerationSkillDetailEntry } from "@/lib/generation/skill-metadata";

type GenerationRecord = {
  id: number;
  type: string;
  status: string;
  localPath: string | null;
  displayUrl?: string | null;
  previewUrl?: string | null;
  posterUrl?: string | null;
  displayKind?: "image" | "video";
  phase?: string | null;
  createdAt: string;
  finishedAt?: string | null;
  model?: string | null;
  prompt?: string | null;
  params?: Record<string, unknown> | null;
  externalTaskId?: string | null;
  requestKey?: string | null;
  errorMsg?: string | null;
};

type HistoryItem = {
  id: string;
  renderKey?: string;
  type: string;
  url: string;
  displayUrl?: string | null;
  previewUrl?: string | null;
  posterUrl?: string | null;
  displayKind?: "image" | "video";
  phase?: string | null;
  externalTaskId?: string | null;
  requestKey?: string | null;
  status: string;
  errorMsg?: string | null;
  createdAt: string;
  finishedAt: string | null;
  model?: string | null;
  prompt?: string | null;
  params?: Record<string, unknown> | null;
  isPending?: boolean; // 临时标记，用于乐观更新
  isClientFailure?: boolean;
  batchId?: string | null;
  batchIndex?: number | null;
  batchSize?: number | null;
  batchSubmittedAt?: string | null;
};

function renderFriendlyError(errorMsg: string | null | undefined, localizeError: ReturnType<typeof useUiLocale>["error"]) {
  const parsed = parseFriendlyMessageFromStorage(errorMsg || "");
  const hasRaw = parsed.raw && parsed.raw !== parsed.message;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-4 py-3 text-sm leading-relaxed text-[var(--app-muted)]">
      <div className="text-[var(--app-fg)]">{localizeError(parsed.message)}</div>
      {parsed.action ? <div className="mt-1 text-xs"><UiText id="common.m98f7c0340484" />{localizeError(parsed.action, "请稍后重试。")}</div> : null}
      {hasRaw || parsed.requestId ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs"><UiText id="common.mc8086a97926b" /></summary>
          <div className="mt-2 whitespace-pre-wrap break-all rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-2 text-xs">
            {parsed.requestId ? <div className="mb-1"><UiText id="common.mfa4449fd25e0" />{parsed.requestId}</div> : null}
            {hasRaw ? <div>{parsed.raw}</div> : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

type TimeRangeFilter = "all" | "1d" | "7d" | "15d";
type TypeFilter = "all" | "face_swap" | "image_edit" | "video";
type HistoryCacheEntry = {
  items: HistoryItem[];
  fetchedAt: number;
  nextCursor?: string | null;
  hasMore?: boolean;
};
type HistoryThumbItem = { item: HistoryItem; groupId: string; groupCount: number; groupItems: HistoryItem[] };

const HISTORY_CACHE_TTL_MS = 5 * 60 * 1000;
const PENDING_ITEM_MAX_AGE_MS = 10 * 60 * 1000;
const HISTORY_ACTIVE_POLL_MS = 2_000;
const HISTORY_SAVING_POLL_MS = 700;
const HISTORY_IDLE_POLL_MS = 15_000;
const HISTORY_THUMB_PREVIEW_SIZE = { width: 192, height: 192 } as const;
const historyCache = new Map<string, HistoryCacheEntry>();
function HistoryGeneratingIndicator({ size = "default", children }: { size?: "compact" | "default" | "thumbnail"; children?: React.ReactNode }) {
  return (
    <div className={`history-generating-indicator history-generating-indicator--${size}`}>
      <div className="history-generating-indicator__grid" aria-hidden="true" />
      <div className="history-generating-indicator__sweep" aria-hidden="true" />
      <div className="history-generating-indicator__corners" aria-hidden="true" />
      <div className="history-generating-indicator__content">
        <img className="history-generating-indicator__logo" src="/favicon.png" alt="" draggable={false} />
        {children ?? <span className="history-generating-indicator__label"><UiText id="common.m969ef41f7e5b" /></span>}
      </div>
    </div>
  );
}

type PendingHistoryMetadata = Pick<HistoryItem, "prompt" | "model" | "params">;

export type UnifiedHistoryPanelHandle = {
  exportAll: () => void;
  reload: () => void;
  addPendingItem: (type: string, requestKey?: string, metadata?: PendingHistoryMetadata) => string; // 返回临时ID
  addPendingItems: (input: { type: string; batchId: string; count: number; submittedAt?: string } & PendingHistoryMetadata) => string[];
  removePendingItem: (tempId: string) => void; // 失败/取消时显式清理临时项
  failPendingItem: (tempId: string, errorMsg: string) => void;
  resolvePendingItem: (tempId: string, realId: string) => void; // 成功后把占位项按 id 关联到真实任务（不依赖时钟）
};

function inferKind(src: string): "image" | "video" {
  return isVideoMediaUrl(src) ? "video" : "image";
}

function getHistoryDisplayUrl(item: Pick<HistoryItem, "type" | "phase" | "displayUrl" | "previewUrl" | "posterUrl" | "url">) {
  if (item.phase === "saving" && typeGroup(item.type) !== "video") return "";
  return normalizeMediaUrl(item.displayUrl || item.previewUrl || item.posterUrl || item.url || "");
}

function isHistoryVideo(item: HistoryItem) {
  return item.displayKind === "video" || typeGroup(item.type) === "video"
    || [item.url, item.previewUrl, item.displayUrl].some((url) => isVideoMediaUrl(url || ""));
}

function getHistoryVideoUrl(item: HistoryItem) {
  if (!isHistoryVideo(item)) return "";
  // The playable preview can arrive before localPath; displayUrl can be a poster.
  return [item.url, item.previewUrl, item.displayUrl]
    .map((url) => normalizeMediaUrl(url || ""))
    .find((url) => url && url !== item.posterUrl
      && !["image", "audio"].includes(inferMediaUrlKind(url))) || "";
}

function getHistoryVideoPoster(item: HistoryItem) {
  return normalizeMediaUrl(item.posterUrl || [item.displayUrl, item.previewUrl]
    .find((url) => url && inferMediaUrlKind(url) === "image") || "");
}

function isWaitingForImagePreview(item: Pick<HistoryItem, "type" | "phase">) {
  return item.phase === "saving" && typeGroup(item.type) !== "video";
}

function getHistoryStorageKey(userId: string) {
  return `studio_history_cache_v5_${userId}`;
}

function normalizeHistoryItems(items: HistoryItem[]): HistoryItem[] {
  const now = Date.now();
  return items
    .map<HistoryItem>((item) => ({
      ...item,
      id: String(item.id || ""),
      type: String(item.type || ""),
      url: normalizeMediaUrl(item.url || ""),
      displayUrl: item.displayUrl ? normalizeMediaUrl(item.displayUrl) : null,
      previewUrl: item.previewUrl ? normalizeMediaUrl(item.previewUrl) : null,
      posterUrl: item.posterUrl ? normalizeMediaUrl(item.posterUrl) : null,
      displayKind: item.displayKind === "video" ? "video" : "image",
      phase: item.phase ? String(item.phase) : null,
      status: String(item.status || ""),
      createdAt: String(item.createdAt || ""),
      finishedAt: item.finishedAt ? String(item.finishedAt) : null,
    }))
    .filter((item) => {
      if (isKnownDeletedGenerationId(item.id)) return false;
      if (!item.id) return false;
      if (!item.isPending) return true;
      const createdAt = new Date(item.createdAt || 0).getTime();
      return Number.isFinite(createdAt) && now - createdAt < PENDING_ITEM_MAX_AGE_MS;
    });
}

function mergeHistoryItem(previous: HistoryItem | undefined, incoming: HistoryItem): HistoryItem {
  if (!previous) return incoming;
  return {
    ...previous,
    ...incoming,
    url: incoming.url || previous.url,
    displayUrl: incoming.displayUrl || previous.displayUrl || null,
    previewUrl: incoming.previewUrl || previous.previewUrl || null,
    posterUrl: incoming.posterUrl || previous.posterUrl || null,
    displayKind: incoming.displayKind || previous.displayKind,
    phase: incoming.phase || previous.phase || null,
    finishedAt: incoming.finishedAt || previous.finishedAt || null,
    model: incoming.model || previous.model || null,
    prompt: incoming.prompt || previous.prompt || null,
    params: incoming.params || previous.params || null,
    isPending: Boolean(incoming.isPending),
  };
}

function mergeHistoryLists(previousItems: HistoryItem[], incomingItems: HistoryItem[]): HistoryItem[] {
  const previousById = new Map(previousItems.map((item) => [item.id, item]));
  const pendingItems = previousItems.filter((item) => item.isPending && getSubmissionTaskKey(item));
  return incomingItems.map((item) => {
    const matchingPending = pendingItems.find((pending) => isSameSubmissionBatchTask(pending, item));
    return mergeHistoryItem(previousById.get(item.id) || matchingPending, item);
  });
}

function toHistoryItem(record: GenerationRecord): HistoryItem {
  return {
    id: String(record.id),
    type: String(record.type || ""),
    url: normalizeMediaUrl(record.localPath || ""),
    displayUrl: normalizeMediaUrl(record.displayUrl || record.previewUrl || record.posterUrl || record.localPath || ""),
    previewUrl: record.previewUrl ? normalizeMediaUrl(record.previewUrl) : null,
    posterUrl: record.posterUrl ? normalizeMediaUrl(record.posterUrl) : null,
    displayKind: record.displayKind === "video" ? "video" : "image",
    phase: record.phase ? String(record.phase) : null,
    externalTaskId: record.externalTaskId ? String(record.externalTaskId) : null,
    requestKey: record.requestKey ? String(record.requestKey) : null,
    status: String(record.status || ""),
    errorMsg: record.errorMsg ? String(record.errorMsg) : null,
    createdAt: String(record.createdAt || ""),
    finishedAt: record.finishedAt ? String(record.finishedAt) : null,
    model: record.model ? String(record.model) : null,
    prompt: record.prompt ? String(record.prompt) : null,
    params: record.params && typeof record.params === "object" ? record.params : null,
  };
}

function toHistoryStatusItem(record: HistoryStatusRecord): HistoryItem {
  const url = normalizeMediaUrl(record.localPath || "");
  const displayUrl = normalizeMediaUrl(record.displayUrl || url);
  const type = String(record.type || "");
  return {
    id: String(record.id),
    type,
    url,
    displayUrl,
    previewUrl: record.displayUrl ? displayUrl : null,
    displayKind: type === "video_gen" || type === "video_generate" ? "video" : "image",
    phase: record.phase ? String(record.phase) : null,
    requestKey: record.requestKey ? String(record.requestKey) : null,
    status: String(record.status || ""),
    errorMsg: record.errorMsg ? String(record.errorMsg) : null,
    createdAt: String(record.createdAt || record.updatedAt || ""),
    finishedAt: null,
    batchId: record.batchId || null,
    batchIndex: record.batchIndex || null,
    batchSize: record.batchSize || null,
    batchSubmittedAt: record.batchSubmittedAt || null,
  };
}

function isVisibleHistoryItem(item: HistoryItem) {
  if (typeGroup(item.type) === "import") return false;
  if (item.status === "success" && item.url) return true;
  if (isInProgressStatus(item.status)) return true;
  return item.status === "failed" || item.status === "cancelled";
}

function readStoredHistoryCache(userId: string): HistoryCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(getHistoryStorageKey(userId));
    if (!raw) return null;
    const parsed = parseHistoryPageCache<HistoryItem>(JSON.parse(raw));
    if (!parsed) return null;
    return {
      ...parsed,
      items: normalizeHistoryItems(parsed.items),
    };
  } catch {
    return null;
  }
}

function writeStoredHistoryCache(userId: string, entry: HistoryCacheEntry) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      getHistoryStorageKey(userId),
      JSON.stringify({ ...entry, items: entry.items.filter((item) => !item.isPending) })
    );
  } catch {}
}

function typeLabel(item: Pick<HistoryItem, "type" | "model" | "params">, text: ReturnType<typeof useUiLocale>["text"]) {
  if (item.model === "video-frame") {
    const frame = item.params?.videoFrame as { mode?: unknown; time?: unknown } | undefined;
    if (frame?.mode === "first") return text("createDynamic.m0eee51419641");
    if (frame?.mode === "last") return text("createDynamic.m8a07f2e0a84c");
    const time = frame?.time;
    return typeof time === "number" && Number.isFinite(time) && time >= 0
      ? text("createDynamic.mfb6ba2fde152", { time: Number(time.toFixed(2)) })
      : text("createDynamic.mc95dc99afe57");
  }
  const t = item.type;
  if (t === "face_swap") return text("createDynamic.m5235f7494aaa");
  if (t === "image_edit") return text("createDynamic.md24c10d37db0");
  if (t === "video_gen" || t === "video_generate") return text("createDynamic.mc20f7618d330");
  return t || text("createDynamic.m4d8c1c5b4283");
}

function typeGroup(t: string) {
  if (t === "face_swap") return "face_swap";
  if (t === "image_edit") return "image_edit";
  if (t === "video_gen" || t === "video_generate") return "video";
  if (t === "import") return "import";
  return "other";
}

function isQuantitySeriesItem(item: HistoryItem) {
  return typeGroup(item.type) === "image_edit" && (getSubmissionBatchMetadata(item)?.size || 0) > 1;
}

function normalizeDragUrl(src: string) {
  const raw = normalizeMediaUrl(src);
  if (!raw) return "";
  if (typeof window === "undefined") return raw;
  try {
    return new URL(raw, window.location.origin).toString();
  } catch {
    return raw;
  }
}

function toLocalUploadPath(src: string) {
  const raw = normalizeMediaUrl(src);
  if (!raw) return "";
  if (typeof window === "undefined") return raw.startsWith("/uploads/") ? raw : "";
  try {
    const u = new URL(raw, window.location.origin);
    if (u.origin !== window.location.origin) return "";
    if (!u.pathname.startsWith("/uploads/")) return "";
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return raw.startsWith("/uploads/") ? raw : "";
  }
}

function normalizeTemplateMediaPath(value: unknown) {
  const normalized = normalizeMediaUrl(String(value || ""));
  if (!normalized) return "";
  return toLocalUploadPath(normalized) || normalized;
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

function buildMetaSummary(item: HistoryItem | null | undefined, names: Record<string, string>, text: ReturnType<typeof useUiLocale>["text"]) {
  if (!item) return { summary: "", full: "", promptPreview: "", metaParts: [] as string[] };
  const params = item.params && typeof item.params === "object" ? item.params : null;
  const prompt = item.model === "video-frame" ? typeLabel(item, text) : String(item.prompt || "").replace(/\s+/g, " ").trim();
  const model = item.model === "video-frame" ? text("createDynamic.ma1786994611b") : resolveModelDisplayName(item.model, names, params);
  const hiddenParamKey =
    /^(imagePaths?|image_urls?|inputPaths?|inputUrl|mediaPath|localInputPath|facePath|targetPath|fileUrls?|outputPaths?|resultUrls?|prompt|model|source|imageCount|nodeInfoList)$/i;
  const isAssetValue = (value: string) => /^https?:\/\//i.test(value) || value.startsWith("/uploads/");
  const preferredParamKeys =
    item.model === "nano-banana-pro"
      ? ["aspectRatio", "resolution"]
      : ["aspectRatio", "resolution", "duration", "mode", "outputSize", "similarity", "intensity", "ratio", "frames", "service_tier"];
  const normalizeValue = (value: unknown): string => {
    if (value == null) return "";
    if (typeof value === "string") {
      const v = value.trim();
      return v && !isAssetValue(v) ? v : "";
    }
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) {
      const parts = value
        .map((entry) => normalizeValue(entry))
        .filter(Boolean);
      return parts.length ? parts.join(" / ") : "";
    }
    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !hiddenParamKey.test(key))
        .map(([key, entry]) => {
          const rendered = normalizeValue(entry);
          return rendered ? `${key}:${rendered}` : "";
        })
        .filter(Boolean);
      return entries.length ? entries.join(", ") : "";
    }
    return "";
  };
  const paramValues = params
    ? preferredParamKeys
        .map((key) => normalizeValue((params as Record<string, unknown>)[key]))
        .filter(Boolean)
    : [];
  const metaParts = Array.from(new Set([model, ...paramValues].filter(Boolean)));
  const promptPreview = prompt.length > 28 ? `${prompt.slice(0, 28)}...` : prompt;
  const summaryParts = [promptPreview, ...metaParts].filter(Boolean);
  const fullParts = [prompt, ...metaParts].filter(Boolean);
  return {
    summary: summaryParts.join(" | "),
    full: fullParts.join("\n"),
    promptPreview,
    metaParts
  };
}

function formatHistoryTime(value: string | null | undefined, locale: string) {
  if (!value) return "";
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleString(locale === "en" ? "en" : undefined);
}

function videoStatusText(status: string, text: ReturnType<typeof useUiLocale>["text"]) {
  const v = String(status || "").toLowerCase();
  if (v === "success") return text("createDynamic.mf28461bb49c8");
  if (v === "running") return text("createDynamic.m969ef41f7e5b");
  if (v === "queued" || v === "pending" || v === "submitted" || v === "processing") return text("createDynamic.md6f766f2adf5");
  if (v === "failed") return text("createDynamic.m28384d7afd2e");
  if (v === "cancelled") return text("createDynamic.ma37778f17c5f");
  if (v === "expired") return text("createDynamic.m2fe0e3339ac4");
  return status || text("createDynamic.m4d8c1c5b4283");
}

function videoStatusClass(status: string) {
  const v = String(status || "").toLowerCase();
  if (v === "success") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700";
  if (v === "running" || v === "queued" || v === "pending" || v === "submitted" || v === "processing") {
    return "border-blue-500/20 bg-blue-500/10 text-blue-700";
  }
  return "border-rose-500/20 bg-rose-500/10 text-rose-700";
}

function isInProgressStatus(status: string) {
  const v = String(status || "").toLowerCase();
  return v === "running" || v === "queued" || v === "pending" || v === "submitted" || v === "processing";
}

type VideoInputAsset = {
  url: string;
  type: "image" | "video" | "audio";
  roleLabel: string;
};

type VideoPreviewAsset = Omit<VideoInputAsset, "type"> & {
  type: "image" | "video";
};

function toVideoInputAsset(entry: any, text: ReturnType<typeof useUiLocale>["text"]): VideoInputAsset | null {
  const url = normalizeMediaUrl(entry?.localPreviewUrl || entry?.previewUrl || entry?.url || "");
  if (!url || url.startsWith("asset://")) return null;
  const rawType = String(entry?.kind || entry?.type || "").trim().toLowerCase();
  if (rawType && !["image", "video", "audio"].includes(rawType)) return null;
  const type = rawType === "video" || rawType === "audio" ? rawType : "image";
  const role = String(entry?.role || "").trim();
  const roleLabel =
    role === "first_frame"
        ? text("createDynamic.m0eee51419641")
        : role === "last_frame"
          ? text("createDynamic.m8a07f2e0a84c")
          : role === "reference_video"
            ? text("createDynamic.m6ae00de796e0")
            : role === "reference_audio"
              ? text("createDynamic.m244b7fda3072")
              : role === "reference_image"
                ? text("createDynamic.me8a1ec993427")
                : type === "video"
                  ? text("createDynamic.m6ae00de796e0")
                  : type === "audio"
                    ? text("createDynamic.m244b7fda3072")
                    : text("createDynamic.me8a1ec993427");
  return { url, type, roleLabel };
}

function getVideoInputAssets(item: HistoryItem, text: ReturnType<typeof useUiLocale>["text"]): VideoInputAsset[] {
  const params = item.params && typeof item.params === "object" ? (item.params as any) : null;
  const referenceAssets = (Array.isArray(params?.referenceAssets) ? params.referenceAssets : [])
    .map((entry: unknown) => toVideoInputAsset(entry, text))
    .filter(Boolean) as VideoInputAsset[];
  if (referenceAssets.length) return referenceAssets;

  const inputMedia = Array.isArray(params?.inputMedia) ? params.inputMedia : [];
  const directAssets = inputMedia
    .map((entry: unknown) => toVideoInputAsset(entry, text))
    .filter(Boolean) as VideoInputAsset[];
  if (directAssets.length) return directAssets;

  const rawPaths = Array.isArray(params?.imagePaths) ? params.imagePaths : [];
  const normalized = rawPaths
    .map((entry: unknown) => (typeof entry === "string" ? normalizeMediaUrl(entry) : ""))
    .filter((url: string) => Boolean(url) && !url.startsWith("asset://"));
  const mode = resolveVideoTemplateInputMode(item);
  return normalized.map((url: string, index: number) => {
    const inferredKind = inferMediaUrlKind(url);
    return {
      url,
      type: inferredKind === "video" || inferredKind === "audio" ? inferredKind : "image",
      roleLabel:
        mode === "first_last_frame"
          ? index === 0
            ? text("createDynamic.m0eee51419641")
            : text("createDynamic.m8a07f2e0a84c")
          : mode === "first_frame"
            ? text("createDynamic.m0eee51419641")
            : inferredKind === "video"
              ? text("createDynamic.m6ae00de796e0")
              : inferredKind === "audio"
                ? text("createDynamic.m244b7fda3072")
                : text("createDynamic.me8a1ec993427")
    };
  });
}

function getVideoLastFrameUrl(item: HistoryItem) {
  const params = item.params && typeof item.params === "object" ? (item.params as any) : null;
  return normalizeMediaUrl(
    params?.lastFramePath ||
      params?.lastFrameUrl ||
      params?.apimartStatus?.data?.result?.last_frame_url ||
      params?.apimartStatus?.data?.result?.lastFrameUrl ||
      params?.apimartStatus?.result?.last_frame_url ||
      params?.apimartStatus?.result?.lastFrameUrl ||
      ""
  );
}

function buildVideoSummary(item: HistoryItem, names: Record<string, string>) {
  const parts = [
    resolveModelDisplayName(item.model, names, item.params),
    item.params && typeof item.params === "object" ? String((item.params as any).ratio || "").trim() : "",
    item.params && typeof item.params === "object" ? String((item.params as any).resolution || "").trim() : "",
    item.params && typeof item.params === "object" ? String((item.params as any).duration || "").trim() : ""
  ].filter(Boolean);
  return parts.join(" | ");
}

function parseAspectRatioValue(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  const pair = text.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)/);
  if (pair) {
    const width = Number(pair[1]);
    const height = Number(pair[2]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return width / height;
    }
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function getHistoryItemAspectRatio(
  item: HistoryItem,
  natural?: { width: number; height: number },
) {
  if (natural?.width && natural?.height) return natural.width / natural.height;
  const keepsRequestedFrame =
    isInProgressStatus(item.status) || item.status === "failed" || item.status === "cancelled";
  if (item.url || !keepsRequestedFrame) return 1;
  const params = item.params && typeof item.params === "object" ? (item.params as Record<string, unknown>) : null;
  return (
    parseAspectRatioValue(params?.aspectRatio) ||
    parseAspectRatioValue(params?.aspect_ratio) ||
    parseAspectRatioValue(params?.ratio) ||
    1
  );
}

function getVideoDetailRows(item: HistoryItem, names: Record<string, string>, text: ReturnType<typeof useUiLocale>["text"], locale: UiLocale) {
  const params = item.params && typeof item.params === "object" ? (item.params as any) : null;
  const duration = params?.duration ? `${params.duration}s` : "-";
  const mode = resolveVideoTemplateInputMode(item);
  const skillDetail = getGenerationSkillDetailEntry(params);
  return [
    { label: text("createDynamic.mf66a521fb530"), value: String(params?.ratio || "16:9") },
    { label: text("createDynamic.mb92421822c21"), value: String(params?.resolution || "-") },
    { label: text("createDynamic.m47b2d56f0bf9"), value: formatUiLabel(locale, getVideoTemplateModeLabel(mode)) },
    { label: text("createDynamic.m4e0221b19771"), value: duration },
    { label: text("createDynamic.m5c04175c4536"), value: formatHistoryTime(item.finishedAt || item.createdAt, locale) || "-" },
    { label: text("createDynamic.mc98e118e0a43"), value: resolveModelDisplayName(item.model || "Seedance 2.0", names, params) },
    ...(skillDetail ? [skillDetail] : [])
  ];
}

export function VideoInputAssetStrip({
  item,
  onOpen,
  staticVideoPreviews = false,
}: {
  item: HistoryItem;
  onOpen: (items: VideoPreviewAsset[], index: number) => void;
  staticVideoPreviews?: boolean;
}) {
  const { text } = useUiLocale();
  const assets = React.useMemo(() => getVideoInputAssets(item, text), [item, text]);
  const previewableAssets = React.useMemo(
    () => assets.filter((asset): asset is VideoPreviewAsset => asset.type !== "audio"),
    [assets],
  );
  const [playingAudioUrl, setPlayingAudioUrl] = React.useState<string | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  const toggleAudio = React.useCallback(async (url: string) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingAudioUrl === url && !audio.paused) {
      audio.pause();
      setPlayingAudioUrl(null);
      return;
    }
    try {
      audio.pause();
      audio.src = url;
      await audio.play();
      setPlayingAudioUrl(url);
    } catch {
      setPlayingAudioUrl(null);
    }
  }, [playingAudioUrl]);

  React.useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio?.pause();
    };
  }, []);

  if (!assets.length) return null;

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <audio
        ref={audioRef}
        className="hidden"
        onEnded={() => setPlayingAudioUrl(null)}
        onPause={() => {
          if (audioRef.current?.ended) return;
          setPlayingAudioUrl((current) => (current ? null : current));
        }}
      />
      <div
        className="flex min-w-0 max-w-full items-center gap-1.5 overflow-x-auto overscroll-x-contain pb-0.5 pr-1"
        style={{ maxWidth: "min(52vw, 520px)" }}
      >
        {assets.map((asset, index) => (
          <button
            key={`${asset.url}_${index}`}
            type="button"
            onClick={() => {
              if (asset.type === "audio") {
                void toggleAudio(asset.url);
                return;
              }
              const previewIndex = previewableAssets.findIndex((candidate) => candidate === asset);
              if (previewIndex >= 0) onOpen(previewableAssets, previewIndex);
            }}
            className="group relative h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded-md border border-[var(--border)] bg-[var(--panel-2)] text-left shadow-sm hover:border-[var(--border-2)]"
            title={`${asset.roleLabel} ${index + 1}/${assets.length}`}
          >
            {asset.type === "image" ? (
              <MediaImage src={asset.url} alt={asset.roleLabel} className="h-full w-full object-cover" />
            ) : asset.type === "video" ? (
              staticVideoPreviews ? (
                <VideoPosterPreview videoSrc={asset.url} className="h-full w-full" alt={asset.roleLabel} />
              ) : (
                <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[var(--panel-2)]">
                  <video
                    src={asset.url}
                    className="h-full w-full object-cover"
                    muted
                    playsInline
                    preload="metadata"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                    <Play className="ml-0.5 h-3.5 w-3.5 text-white" fill="currentColor" />
                  </div>
                </div>
              )
            ) : (
              <div className="relative flex h-full w-full items-center justify-center text-[var(--app-muted)]">
                <FileAudio2 className="h-4 w-4" />
                <div className="absolute inset-0 flex items-center justify-center bg-black/18">
                  {playingAudioUrl === asset.url ? (
                    <Pause className="h-3.5 w-3.5 text-white" />
                  ) : (
                    <Play className="ml-0.5 h-3.5 w-3.5 text-white" fill="currentColor" />
                  )}
                </div>
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function VideoTaskHeader({
  item,
  onOpen,
  onShowDetails,
  onCancel,
  onRegenerate,
  regenerating = false,
  staticVideoPreviews = false,
}: {
  item: HistoryItem;
  onOpen: (items: VideoPreviewAsset[], index: number) => void;
  onShowDetails: () => void;
  onCancel?: () => void;
  onRegenerate?: () => void;
  regenerating?: boolean;
  staticVideoPreviews?: boolean;
}) {
  const { text } = useUiLocale();
  const modelNames = useModelDisplayNames();
  return (
    <div className="flex items-start justify-between gap-2" data-video-task-header="shared">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="mt-0.5 shrink-0">
          <VideoInputAssetStrip item={item} onOpen={onOpen} staticVideoPreviews={staticVideoPreviews} />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <div
            className="text-left text-[12px] leading-5.5 text-[var(--app-fg)] sm:text-[13px]"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {item.prompt || <UiText id="common.mfccd86db2a9d" />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-[var(--app-muted)] sm:text-[11px]">
            <span>{buildVideoSummary(item, modelNames) || <UiText id="common.m9e642334fcb9" />}</span>
            <button
              type="button"
              onClick={onShowDetails}
              className="inline-flex items-center gap-1 text-[var(--app-muted)] transition hover:text-[var(--app-fg)]"
            >
              <Info className="h-3.5 w-3.5" /><UiText id="common.m1932da4d4dba" /></button>
            {onRegenerate ? (
              <button
                type="button"
                onClick={onRegenerate}
                disabled={regenerating}
                className="inline-flex items-center gap-1 text-[var(--app-muted)] transition hover:text-[var(--app-fg)] disabled:pointer-events-none disabled:opacity-60"
              >
                {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                {regenerating ? <UiText id="common.m66d5dd404721" /> : <UiText id="common.m3221a042ea36" />}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={["rounded-full border px-2 py-0.5 text-[10px]", videoStatusClass(item.status)].join(" ")}>
          {videoStatusText(item.status, text)}
        </span>
        {onCancel ? (
          <UiProps ids={{"aria-label":["common.mab7505b7c2a7"],"title":["common.mab7505b7c2a7"]}}><button
            type="button"
            onClick={onCancel}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-rose-500/25 bg-rose-500/10 px-2 text-[11px] font-medium text-rose-700 transition hover:bg-rose-500/15"
            aria-label="common.mab7505b7c2a7"
            title="common.mab7505b7c2a7"
          >
            <X className="h-3.5 w-3.5" /><UiText id="common.m2cd0f3be8738" /></button></UiProps>
        ) : null}
      </div>
    </div>
  );
}

function VideoTaskSurface({
  header,
  children,
  stageClassName = "border-[var(--border)] bg-[var(--panel-2)]",
  tail,
}: {
  header: React.ReactNode;
  children: React.ReactNode;
  stageClassName?: string;
  tail?: React.ReactNode;
}) {
  return (
    <div className="h-full w-full overflow-auto">
      <div className="flex min-h-full w-full items-center justify-center px-6 py-6">
        <div className="w-full max-w-[920px]">
          <div className="space-y-4">
            {header}
            <div
              data-video-result-stage="shared"
              className={[
                "relative aspect-[16/9] w-full max-w-[620px] overflow-hidden rounded-2xl border sm:max-w-[700px] lg:max-w-[800px]",
                stageClassName,
              ].join(" ")}
            >
              {children}
            </div>
            {tail}
          </div>
        </div>
      </div>
    </div>
  );
}

type UnifiedHistoryPanelProps = {
  defaultType?: string;
  focusId?: string | null;
  onItemCountChange?: (count: number) => void;
  onInitialReady?: () => void;
  userId?: string;
  floatingActions?: React.ReactNode;
  staticVideoPreviews?: boolean;
};

function UnifiedHistoryPanelInner(
  {
    focusId,
    onItemCountChange,
    onInitialReady,
    userId: userIdProp,
    floatingActions,
    staticVideoPreviews = false,
  }: UnifiedHistoryPanelProps,
  ref: React.ForwardedRef<UnifiedHistoryPanelHandle>
) {
  const { text, locale, error: localizeError, label: localizeLabel } = useUiLocale();
  const modelNames = useModelDisplayNames();
  const { user } = useAuth();
  const [userId, setUserId] = React.useState("");
  const [allItems, setAllItems] = React.useState<HistoryItem[]>([]);
  const allItemsRef = React.useRef<HistoryItem[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [zoomOpen, setZoomOpen] = React.useState(false);
  const [zoomSrc, setZoomSrc] = React.useState<string | null>(null);
  const [zoomKind, setZoomKind] = React.useState<"image" | "video">("image");
  const [referencePreview, setReferencePreview] = React.useState<{
    items: VideoPreviewAsset[];
    index: number;
  } | null>(null);
  const activeReferencePreview = referencePreview?.items[referencePreview.index] || null;
  const [groupResultPreview, setGroupResultPreview] = React.useState<{
    entries: Array<{ id: string; url: string }>;
    index: number;
  } | null>(null);
  const [groupGalleryOpen, setGroupGalleryOpen] = React.useState(false);
  const [groupGalleryId, setGroupGalleryId] = React.useState<string | null>(null);
  const [groupGalleryOffset, setGroupGalleryOffset] = React.useState({ x: 0, y: 0 });
  const groupGalleryDragRef = React.useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const groupGalleryDraggingRef = React.useRef(false);
  const thumbsScrollRef = React.useRef<HTMLElement | null>(null);
  const thumbnailStripRef = React.useRef<HistoryThumbnailStripHandle | null>(null);
  const lastScrolledFocusIdRef = React.useRef<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null);
  const [clearAllConfirmOpen, setClearAllConfirmOpen] = React.useState(false);
  const [metaPopoverOpen, setMetaPopoverOpen] = React.useState(false);
  const [metaHoverOpen, setMetaHoverOpen] = React.useState(false);
  const metaHoverTimerRef = React.useRef<number | null>(null);
  const [metaPopoverPosition, setMetaPopoverPosition] = React.useState<{ right: number; bottom: number; availableAbove: number } | null>(null);
  const [metaCopied, setMetaCopied] = React.useState(false);
  const [videoDetailOpen, setVideoDetailOpen] = React.useState(false);
  const [inlineNotice, setInlineNotice] = React.useState<string | null>(null);
  const [applyingVideoTemplateId, setApplyingVideoTemplateId] = React.useState<string | null>(null);
  const applyVideoTemplateInFlightRef = React.useRef<Map<string, Promise<void>>>(new Map());
  const noticeTimerRef = React.useRef<number | null>(null);
  const [hiddenIds, setHiddenIds] = React.useState<Set<string>>(new Set());
  const [timeRange, setTimeRange] = React.useState<TimeRangeFilter>("1d");
  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>("all");
  const lastCompletedCountRef = React.useRef(-1);
  const nextCursorRef = React.useRef<string | null>(null);
  const hasMoreRef = React.useRef(true);
  const [hasMorePages, setHasMorePages] = React.useState(true);
  const loadHistoryInFlightRef = React.useRef(false);
  const loadNextPageInFlightRef = React.useRef(false);
  const statusSnapshotRef = React.useRef<HistoryStatusRecord[]>([]);
  const topIdRef = React.useRef<string | null>(null);
  const userPinnedActiveRef = React.useRef(false);
  const [groupImageNaturalSize, setGroupImageNaturalSize] = React.useState<Record<string, { width: number; height: number }>>({});
  const metaPopoverRef = React.useRef<HTMLDivElement | null>(null);
  const metaPopoverPanelRef = React.useRef<HTMLDivElement | null>(null);
  const activeVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const [activeVideoReadyUrl, setActiveVideoReadyUrl] = React.useState("");
  const [frameCaptureBusy, setFrameCaptureBusy] = React.useState(false);
  const frameCaptureInFlightRef = React.useRef(false);

  const removeDeletedItems = React.useCallback((ids: number[]) => {
    if (!userId || !ids.length) return;
    const deleted = new Set(ids.map(String));
    const previous = allItemsRef.current;
    const next = previous.filter((item) => !deleted.has(item.id));
    if (next.length === previous.length) return;
    allItemsRef.current = next;
    setAllItems(next);
    setActiveId((current) => current && deleted.has(current) ? next[0]?.id || null : current);
    const entry = {
      items: next,
      fetchedAt: Date.now(),
      nextCursor: nextCursorRef.current,
      hasMore: hasMoreRef.current,
    };
    historyCache.set(userId, entry);
    writeStoredHistoryCache(userId, entry);
  }, [userId]);

  React.useEffect(() => subscribeGenerationDeleted(removeDeletedItems), [removeDeletedItems]);

  React.useEffect(() => {
    if (userIdProp) setUserId(userIdProp);
  }, [userIdProp]);

  React.useEffect(() => {
    if (userIdProp) return;
    setUserId(user?.id ? String(user.id) : "");
  }, [userIdProp, user?.id]);

  React.useEffect(() => {
    if (userId) return;
    setAllItems([]);
    setActiveId(null);
    onItemCountChange?.(0);
  }, [onItemCountChange, userId]);

  React.useEffect(() => {
    if (!userId) return;
    try {
      const raw = localStorage.getItem(`studio_history_hidden_v1_${userId}`);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const set = new Set<string>();
      for (const v of parsed) {
        const s = String(v || "");
        if (s) set.add(s);
      }
      setHiddenIds(set);
    } catch {}
  }, [userId]);

  React.useEffect(() => {
    if (!userId) return;
    const onFilterSync = (e: Event) => {
      const d = (e as CustomEvent<any>)?.detail || {};
      if (String(d.userId || "") !== userId) return;
      const t = d.timeRange as TimeRangeFilter | undefined;
      const tp = d.typeFilter as TypeFilter | undefined;
      if (t === "all" || t === "1d" || t === "7d" || t === "15d") setTimeRange(t);
      if (tp === "all" || tp === "face_swap" || tp === "image_edit" || tp === "video") setTypeFilter(tp);
    };
    window.addEventListener("studio:task-filters", onFilterSync as EventListener);
    return () => {
      window.removeEventListener("studio:task-filters", onFilterSync as EventListener);
    };
  }, [userId]);

  const persistHiddenIds = React.useCallback(
    (next: Set<string>) => {
      if (!userId) return;
      setHiddenIds(next);
      try {
        localStorage.setItem(`studio_history_hidden_v1_${userId}`, JSON.stringify(Array.from(next.values())));
      } catch {}
    },
    [userId]
  );

  React.useEffect(() => {
    allItemsRef.current = allItems;
  }, [allItems]);

  React.useEffect(() => {
    if (!userId) return;
    try {
      const rawCached = historyCache.get(userId) || readStoredHistoryCache(userId);
      const cached = rawCached ? { ...rawCached, items: normalizeHistoryItems(rawCached.items) } : null;
      if (cached?.items?.length) {
        historyCache.set(userId, cached);
        allItemsRef.current = cached.items;
        nextCursorRef.current = cached.nextCursor || null;
        hasMoreRef.current = cached.hasMore !== false;
        setHasMorePages(cached.hasMore !== false);
        setAllItems(cached.items);
      }
      const storedActive = localStorage.getItem(`history_active_v1_${userId}`);
      if (storedActive) setActiveId(storedActive);
    } catch {}
  }, [userId]);

  React.useEffect(() => {
    if (!userId) return;
    if (!activeId) return;
    try {
      localStorage.setItem(`history_active_v1_${userId}`, activeId);
    } catch {}
  }, [activeId, userId]);

  const requestHistoryPage = React.useCallback(async (cursor: string | null) => {
    const url = new URL("/api/history", window.location.origin);
    url.searchParams.set("take", "50");
    url.searchParams.set("status", "all");
    url.searchParams.set("withOutput", "0");
    url.searchParams.set("source", "tool");
    url.searchParams.set("excludeImport", "1");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url.toString(), { cache: "no-store" });
    if (!response.ok) throw new Error(`history page ${response.status}`);
    const body = (await response.json().catch(() => null)) as any;
    const records = Array.isArray(body?.items) ? (body.items as GenerationRecord[]) : [];
    return {
      items: records
        .filter((record) => !isKnownDeletedGenerationId(record.id))
        .map(toHistoryItem)
        .filter(isVisibleHistoryItem),
      hasMore: Boolean(body?.hasMore),
      nextCursor: typeof body?.nextCursor === "string" ? body.nextCursor : null,
    };
  }, []);

  const loadHistory = React.useCallback(
    async ({ force }: { force?: boolean } = {}) => {
      if (!userId) return;
      const rawCached = historyCache.get(userId) || readStoredHistoryCache(userId);
      const cached = rawCached ? { ...rawCached, items: normalizeHistoryItems(rawCached.items) } : null;
      if (cached && !force) {
        historyCache.set(userId, cached);
        nextCursorRef.current = cached.nextCursor || null;
        hasMoreRef.current = cached.hasMore !== false;
        setHasMorePages(cached.hasMore !== false);
        setAllItems((prev) => (prev.length ? prev : cached.items));
        const cacheIsFresh = Date.now() - cached.fetchedAt < HISTORY_CACHE_TTL_MS;
        const needsStatusRefresh = cached.items.some((item) => isInProgressStatus(item.status) || item.status === "failed");
        if (cacheIsFresh && !needsStatusRefresh && typeof cached.hasMore === "boolean") return;
      }
      // in-flight 防护：上一次请求未完成时，跳过本次轮询。
      // 否则慢网络下多个请求叠加，乱序返回会引起 allItems / activeId 来回跳动 → 视觉闪烁。
      if (loadHistoryInFlightRef.current && !force) return;
      loadHistoryInFlightRef.current = true;
      try {
        const page = await requestHistoryPage(null);
        const prevItems = allItemsRef.current;
        const fetched = page.items;
        const next = sortHistoryBySubmissionOrder(
          mergeHistoryFirstPage(mergeHistoryLists(prevItems, fetched), prevItems.filter((item) => !item.isPending))
        );

        // 关键：保留尚未被服务端确认的 pending 项。否则 POST 还在飞 / 服务端刚入库未及时返回时，
        // setAllItems(next) 会把 pending 抹掉，activeId 回落到旧的 topId，造成"正在生成 → 旧图闪一下 → 正在生成"的闪烁。
        const now = Date.now();
        const prevPending = prevItems.filter((item) => {
          if (!item.isPending) return false;
          const createdAt = new Date(item.createdAt || 0).getTime();
          return Number.isFinite(createdAt) && now - createdAt < PENDING_ITEM_MAX_AGE_MS;
        });
        const survivingPending = prevPending.filter((p) => {
          if (!getSubmissionTaskKey(p)) return true;
          return shouldKeepSubmissionBatchPlaceholder(p, next);
        });
        const merged = sortHistoryBySubmissionOrder(survivingPending.length ? [...survivingPending, ...next] : next);
        const newTopId = merged[0]?.id || null;
        const prevTopId = topIdRef.current;
        // ref 改写放到 setter 之外，避免 React 并发渲染下 updater 多次执行带来的非确定性
        topIdRef.current = newTopId;

        setAllItems((prev) => {
          if (prev.length !== merged.length) return merged;
          for (let i = 0; i < merged.length; i++) {
            const p = prev[i];
            const m = merged[i];
            if (!p || !m) return merged;
            if (p.id !== m.id || p.status !== m.status || p.url !== m.url || p.displayUrl !== m.displayUrl || p.isPending !== m.isPending ||
              p.prompt !== m.prompt || p.model !== m.model || p.params !== m.params || p.phase !== m.phase || p.renderKey !== m.renderKey) {
              return merged;
            }
          }
          return prev;
        });

        setActiveId((prevActive) => {
          const pendingActive = prevActive ? prevItems.find((item) => item.id === prevActive && item.isPending) : null;
          const resolvedActive = pendingActive
            ? merged.find((item) => !item.isPending && isSameSubmissionBatchTask(pendingActive, item))
            : null;
          if (resolvedActive) return resolvedActive.id;
          // 用户当前停留在一个 pending 项上，并且它还没被真实任务替换 → 不切走，避免闪到旧素材。
          // ensureHistoryItem 在拿到真实 generationId 后会显式 setActiveId(realId) 完成迁移。
          if (
            prevActive &&
            survivingPending.some((p) => p.id === prevActive)
          ) {
            return prevActive;
          }
          if (newTopId && newTopId !== prevTopId) {
            if (!userPinnedActiveRef.current && (prevActive == null || prevActive === prevTopId)) {
              return newTopId;
            }
          }
          if (prevActive && merged.some((it) => it.id === prevActive)) return prevActive;
          return newTopId;
        });
        allItemsRef.current = merged;
        nextCursorRef.current = page.nextCursor;
        hasMoreRef.current = page.hasMore;
        setHasMorePages(page.hasMore);
        const cacheEntry = { items: merged, fetchedAt: Date.now(), nextCursor: page.nextCursor, hasMore: page.hasMore };
        historyCache.set(userId, cacheEntry);
        writeStoredHistoryCache(userId, cacheEntry);
      } finally {
        loadHistoryInFlightRef.current = false;
      }
    },
    [requestHistoryPage, userId]
  );

  const loadNextPage = React.useCallback(async () => {
    if (!userId || !hasMoreRef.current || loadNextPageInFlightRef.current) return;
    const cursor = nextCursorRef.current;
    if (!cursor) return;
    loadNextPageInFlightRef.current = true;
    try {
      const page = await requestHistoryPage(cursor);
      const previous = allItemsRef.current;
      const merged = appendHistoryPage(previous, mergeHistoryLists(previous, page.items));
      allItemsRef.current = merged;
      nextCursorRef.current = page.nextCursor;
      hasMoreRef.current = page.hasMore;
      setHasMorePages(page.hasMore);
      if (merged !== previous) setAllItems(merged);
      const cacheEntry = { items: merged, fetchedAt: Date.now(), nextCursor: page.nextCursor, hasMore: page.hasMore };
      historyCache.set(userId, cacheEntry);
      writeStoredHistoryCache(userId, cacheEntry);
    } finally {
      loadNextPageInFlightRef.current = false;
    }
  }, [requestHistoryPage, userId]);

  // 加载历史记录（首次和主动刷新）
  React.useEffect(() => {
    if (!userId) {
      onInitialReady?.();
      return;
    }
    let cancelled = false;
    void loadHistory().finally(() => {
      if (!cancelled) onInitialReady?.();
    });
    return () => {
      cancelled = true;
    };
  }, [loadHistory, onInitialReady, userId]);

  const visibleItems = React.useMemo(() => {
    const rangeCutoff = getRangeCutoff(timeRange);
    return allItems.filter((x) => {
      if (hiddenIds.has(x.id)) return false;
      if (typeFilter !== "all") {
        const mt = String(x.type || "");
        if (typeFilter === "video") {
          if (!(mt === "video_gen" || mt === "video_generate")) return false;
        } else if (mt !== typeFilter) {
          return false;
        }
      }
      if (!rangeCutoff) return true;
      const keyTime = new Date(String(x.createdAt || "")).getTime();
      if (!keyTime) return false;
      return keyTime >= rangeCutoff;
    });
  }, [allItems, hiddenIds, timeRange, typeFilter]);

  React.useEffect(() => {
    onItemCountChange?.(visibleItems.length);
    setActiveId((prev) => {
      if (prev && visibleItems.some((it) => it.id === prev)) return prev;
      return visibleItems[0]?.id || null;
    });
  }, [onItemCountChange, visibleItems]);

  const requestHistoryItem = React.useCallback(async (id: string): Promise<HistoryItem | null> => {
    const url = new URL("/api/history", window.location.origin);
    url.searchParams.set("id", id);
    const response = await fetch(url.toString(), { cache: "no-store" });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`history item ${response.status}`);
    const body = (await response.json().catch(() => null)) as any;
    return body?.item ? toHistoryItem(body.item as GenerationRecord) : null;
  }, []);

  const applyHistoryItem = React.useCallback((incoming: HistoryItem) => {
    if (!userId || isKnownDeletedGenerationId(incoming.id)) return false;
    const previous = allItemsRef.current;
    const existing = previous.find((item) => item.id === incoming.id);
    const matchingPending = previous.find((item) => item.isPending && isSameSubmissionBatchTask(item, incoming));
    const mergedItem = mergeHistoryItem(existing || matchingPending, incoming);
    const resolvedItem = matchingPending
      ? { ...mergedItem, renderKey: matchingPending.renderKey || matchingPending.id }
      : mergedItem;
    const removedPending = Boolean(matchingPending && matchingPending.id !== resolvedItem.id);
    const replaced = replaceById(previous, resolvedItem);
    const next = existing && !removedPending
      ? replaced
      : sortHistoryBySubmissionOrder([
          resolvedItem,
          ...previous.filter((item) => item.id !== resolvedItem.id && item.id !== matchingPending?.id),
        ]);
    if (next === previous) return false;

    allItemsRef.current = next;
    setAllItems(next);
    if (matchingPending) setActiveId((active) => active === matchingPending.id ? resolvedItem.id : active);
    const cacheEntry = {
      items: next,
      fetchedAt: Date.now(),
      nextCursor: nextCursorRef.current,
      hasMore: hasMoreRef.current,
    };
    historyCache.set(userId, cacheEntry);
    writeStoredHistoryCache(userId, cacheEntry);
    return true;
  }, [userId]);

  const loadHistoryItem = React.useCallback(async (id: string) => {
    const item = await requestHistoryItem(id).catch(() => undefined);
    if (item === undefined) return false;
    if (!item) {
      removeDeletedItems([Number(id)]);
      return false;
    }
    applyHistoryItem(item);
    return true;
  }, [applyHistoryItem, removeDeletedItems, requestHistoryItem]);

  const captureHistoryVideoFrame = React.useCallback(async (item: HistoryItem, video: HTMLVideoElement, mode: VideoFrameMode) => {
    if (frameCaptureInFlightRef.current) return;
    frameCaptureInFlightRef.current = true;
    setFrameCaptureBusy(true);
    setInlineNotice(`正在截取${VIDEO_FRAME_LABELS[mode]}…`);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    try {
      const captured = await captureVideoFrame(video, mode);
      const form = new FormData();
      form.set("generationId", item.id);
      form.set("mode", mode);
      form.set("time", String(captured.time));
      form.set("requestKey", crypto.randomUUID());
      form.set("file", captured.file);
      const response = await fetch("/api/video-frames", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok || !body.success || !body.item?.localPath) throw new Error(body.error || "截帧保存失败，请重试");
      const saved = toHistoryItem(body.item as GenerationRecord);
      applyHistoryItem(saved);
      // A video-only filter would otherwise hide the newly captured image.
      setTypeFilter("all");
      userPinnedActiveRef.current = true;
      setActiveId(saved.id);
      setInlineNotice(`${VIDEO_FRAME_LABELS[mode]}已保存为图片`);
    } catch (error) {
      setInlineNotice(error instanceof Error ? error.message : "截帧失败，请重试");
    } finally {
      frameCaptureInFlightRef.current = false;
      setFrameCaptureBusy(false);
      noticeTimerRef.current = window.setTimeout(() => { setInlineNotice(null); noticeTimerRef.current = null; }, 5000);
    }
  }, [applyHistoryItem]);

  const ensureHistoryItem = React.useCallback(async (id: string) => {
    if (!userId || !id) return false;
    if (allItemsRef.current.some((item) => item.id === id)) return true;
    return loadHistoryItem(id);
  }, [loadHistoryItem, userId]);

  React.useEffect(() => {
    if (!userId) return;
    let disposed = false;
    let inFlight = false;
    let timer: number | null = null;

    const clearTimer = () => {
      if (timer == null) return;
      window.clearTimeout(timer);
      timer = null;
    };

    const schedule = (baseMs: number) => {
      clearTimer();
      if (disposed || document.visibilityState === "hidden") return;
      timer = window.setTimeout(() => void tick(), jitterPollDelay(baseMs));
    };

    const tick = async () => {
      if (disposed || document.visibilityState === "hidden" || inFlight) return;
      inFlight = true;
      const activeItems = allItemsRef.current.filter((item) => isInProgressStatus(item.status));
      const ids = activeItems
        .map((item) => Number(item.id))
        .filter((id) => Number.isSafeInteger(id) && id > 0);
      let nextDelay = ids.length
        ? activeItems.reduce(
            (delay, item) => item.phase === "saving" ? HISTORY_SAVING_POLL_MS : delay,
            HISTORY_ACTIVE_POLL_MS,
          )
        : HISTORY_IDLE_POLL_MS;
      try {
        if (ids.length) {
          const statuses = await fetchHistoryStatuses({ ids, source: "all" });
          if (disposed) return;
          nextDelay = statuses.some((status) => status.phase === "saving")
            ? HISTORY_SAVING_POLL_MS
            : HISTORY_ACTIVE_POLL_MS;
          const snapshotUnchanged = sameHistoryStatusSnapshot(statusSnapshotRef.current, statuses);
          statusSnapshotRef.current = statuses;
          const currentById = new Map(allItemsRef.current.map((item) => [item.id, item]));
          const changedStatuses = statuses.filter((status) => {
            const current = currentById.get(String(status.id));
            if (!current) return true;
            return (
              current.status !== status.status ||
              current.phase !== status.phase ||
              normalizeMediaUrl(current.url || "") !== normalizeMediaUrl(status.localPath || "") ||
              getHistoryDisplayUrl(current) !== normalizeMediaUrl(status.displayUrl || status.localPath || "") ||
              String(current.errorMsg || "") !== String(status.errorMsg || "")
            );
          });
          if (!snapshotUnchanged || changedStatuses.length) {
            await Promise.all(changedStatuses.map((status) => loadHistoryItem(String(status.id))));
          }
        } else {
          statusSnapshotRef.current = [];
          // Failed tasks can be repaired to success without changing completedCount.
          // Reconcile a bounded set at the idle cadence; keep selection and loaded pages.
          const failedIds = allItemsRef.current
            .filter((item) => item.status === "failed" && !item.isClientFailure)
            .map((item) => Number(item.id))
            .filter((id) => Number.isSafeInteger(id) && id > 0)
            .slice(0, 50);
          if (failedIds.length) {
            const repairedStatuses = await fetchHistoryStatuses({ ids: failedIds, source: "all" });
            if (disposed) return;
            await Promise.all(repairedStatuses
              .filter((status) => status.status !== "failed")
              .map((status) => loadHistoryItem(String(status.id))));
          }
          const response = await fetch("/api/history/summary", { cache: "no-store" });
          if (!response.ok) return;
          const body = (await response.json().catch(() => null)) as any;
          if (disposed) return;
          const inProgressCount = Math.max(0, Number(body?.inProgressCount || 0) || 0);
          if (inProgressCount > 0) {
            const discoveredStatuses = await fetchHistoryStatuses({ source: "tool", status: "in_progress" });
            if (disposed) return;
            const knownIds = new Set(allItemsRef.current.map((item) => item.id));
            const discoveredIds = discoveredStatuses
              .map((status) => String(status.id))
              .filter((id) => !knownIds.has(id));
            for (const status of discoveredStatuses) {
              applyHistoryItem(toHistoryStatusItem(status));
            }
            if (discoveredIds.length && !userPinnedActiveRef.current) {
              setActiveId(discoveredIds[0]);
            }
            if (discoveredStatuses.length) {
              nextDelay = discoveredStatuses.some((status) => status.phase === "saving")
                ? HISTORY_SAVING_POLL_MS
                : HISTORY_ACTIVE_POLL_MS;
            }
            await Promise.all(discoveredStatuses.map((status) => loadHistoryItem(String(status.id))));
          }
          const completedCount = Math.max(0, Number(body?.completedCount || 0) || 0);
          const previousCount = lastCompletedCountRef.current;
          lastCompletedCountRef.current = completedCount;
          if (previousCount !== -1 && completedCount > previousCount) {
            await loadHistory({ force: true });
          }
        }
      } catch {
        // A compact read failure leaves the current UI and cache untouched.
      } finally {
        inFlight = false;
        schedule(nextDelay);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearTimer();
        return;
      }
      void tick();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void tick();
    return () => {
      disposed = true;
      clearTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [applyHistoryItem, loadHistory, loadHistoryItem, userId]);

  React.useEffect(() => {
    if (!focusId) return;
    userPinnedActiveRef.current = false;
    let cancelled = false;
    void ensureHistoryItem(focusId).then((found) => {
      if (!cancelled && found) setActiveId(focusId);
    });
    return () => {
      cancelled = true;
    };
  }, [ensureHistoryItem, focusId]);

  const activeItem = React.useMemo(() => {
    if (!activeId) return null;
    return visibleItems.find((x) => x.id === activeId) || null;
  }, [activeId, visibleItems]);
  const activeMeta = React.useMemo(() => buildMetaSummary(activeItem, modelNames, text), [activeItem, modelNames, text]);

  React.useEffect(() => {
    setActiveVideoReadyUrl("");
  }, [activeItem?.url]);

  const updateMetaPopoverPosition = React.useCallback(() => {
    const anchor = metaPopoverRef.current;
    if (!anchor || typeof window === "undefined") return;
    const rect = anchor.getBoundingClientRect();
    setMetaPopoverPosition({
      right: Math.max(16, window.innerWidth - rect.right),
      bottom: Math.max(16, window.innerHeight - rect.top + 8),
      availableAbove: Math.max(120, rect.top - 24)
    });
  }, []);

  const clearMetaHoverTimer = React.useCallback(() => {
    if (metaHoverTimerRef.current !== null) {
      window.clearTimeout(metaHoverTimerRef.current);
      metaHoverTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    clearMetaHoverTimer();
    setMetaPopoverOpen(false);
    setMetaHoverOpen(false);
    setMetaPopoverPosition(null);
    setMetaCopied(false);
    setVideoDetailOpen(false);
    return clearMetaHoverTimer;
  }, [activeId, clearMetaHoverTimer]);

  React.useEffect(() => {
    if (!videoDetailOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setVideoDetailOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [videoDetailOpen]);

  React.useEffect(() => {
    if (!metaPopoverOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && metaPopoverRef.current?.contains(target)) return;
      if (target && metaPopoverPanelRef.current?.contains(target)) return;
      setMetaPopoverOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMetaPopoverOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [metaPopoverOpen]);

  React.useEffect(() => {
    if (!metaPopoverOpen && !metaHoverOpen) return;
    updateMetaPopoverPosition();
    const onUpdate = () => updateMetaPopoverPosition();
    window.addEventListener("resize", onUpdate);
    window.addEventListener("scroll", onUpdate, true);
    return () => {
      window.removeEventListener("resize", onUpdate);
      window.removeEventListener("scroll", onUpdate, true);
    };
  }, [metaHoverOpen, metaPopoverOpen, updateMetaPopoverPosition]);

  const activeGroupItems = React.useMemo(() => {
    if (!activeItem) return [] as HistoryItem[];
    const groupId = getHistoryDisplayGroupKey(activeItem);
    const quantitySeries = isQuantitySeriesItem(activeItem);
    return visibleItems
      .filter((x) => {
        if (getHistoryDisplayGroupKey(x) !== groupId) return false;
        if (quantitySeries) return typeGroup(x.type) === "image_edit";
        return !!x.url && inferKind(x.url) === "image";
      })
      .sort(compareHistoryDisplayGroupItems);
  }, [activeItem, visibleItems]);

  const activeGroupId = React.useMemo(() => {
    if (!activeItem) return null;
    return getHistoryDisplayGroupKey(activeItem);
  }, [activeItem]);

  const activeGroupGrid = React.useMemo(() => {
    const count = Math.max(1, activeGroupItems.length);
    const columns = count <= 2 ? count : count <= 4 ? 2 : count <= 9 ? 3 : 4;
    return { columns, rows: Math.ceil(count / columns) };
  }, [activeGroupItems.length]);

  const thumbItems = React.useMemo(() => {
    const imageGroups = new Map<string, HistoryItem[]>();
    visibleItems.forEach((it) => {
      const isImage = isQuantitySeriesItem(it) || (!!it.url && inferKind(it.url) === "image");
      if (!isImage) return;
      const gid = getHistoryDisplayGroupKey(it);
      const list = imageGroups.get(gid) || [];
      list.push(it);
      imageGroups.set(gid, list);
    });
    const grouped = new Set<string>();
    const list: HistoryThumbItem[] = [];
    visibleItems.forEach((it) => {
      const gid = getHistoryDisplayGroupKey(it);
      const isImage = isQuantitySeriesItem(it) || (!!it.url && inferKind(it.url) === "image");
      const groupItems = isImage ? [...(imageGroups.get(gid) || [it])].sort(compareHistoryDisplayGroupItems) : [it];
      const groupCount = isImage ? groupItems.length : 1;
      if (groupCount > 1) {
        if (grouped.has(gid)) return;
        grouped.add(gid);
      }
      list.push({ item: it, groupId: gid, groupCount, groupItems });
    });
    return list;
  }, [visibleItems]);

  React.useEffect(() => {
    if (!focusId) {
      lastScrolledFocusIdRef.current = null;
      return;
    }
    if (lastScrolledFocusIdRef.current === focusId) return;
    const index = thumbItems.findIndex((thumb) =>
      thumb.item.id === focusId || thumb.groupItems.some((item) => item.id === focusId)
    );
    if (index < 0) return;
    lastScrolledFocusIdRef.current = focusId;
    thumbnailStripRef.current?.scrollToIndex(index);
  }, [focusId, thumbItems]);

  const groupGalleryItems = React.useMemo(() => {
    if (!groupGalleryId) return [] as HistoryItem[];
    return allItems
      .filter((it) => {
        if (getHistoryDisplayGroupKey(it) !== groupGalleryId) return false;
        return isQuantitySeriesItem(it) || (!!it.url && inferKind(it.url) === "image");
      })
      .sort(compareHistoryDisplayGroupItems);
  }, [allItems, groupGalleryId]);

  React.useEffect(() => {
    if (!groupGalleryOpen) return;
    setGroupGalleryOffset({ x: 0, y: 0 });
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGroupGalleryOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [groupGalleryOpen]);

  React.useEffect(() => {
    if (!groupGalleryOpen) return;
    const onMove = (e: MouseEvent) => {
      const d = groupGalleryDragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      setGroupGalleryOffset({ x: d.baseX + dx, y: d.baseY + dy });
    };
    const onUp = () => {
      groupGalleryDragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [groupGalleryOpen]);

  const downloadByUrl = React.useCallback((url: string, filename: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "download";
    a.rel = "noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  const addPendingItem = React.useCallback((type: string, requestKey?: string, metadata?: PendingHistoryMetadata) => {
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const pendingItem: HistoryItem = {
      id: tempId,
      renderKey: tempId,
      type,
      requestKey: String(requestKey || "").trim() || null,
      prompt: metadata?.prompt || null,
      model: metadata?.model || null,
      params: metadata?.params || null,
      url: "",
      status: "running",
      createdAt: new Date().toISOString(),
      finishedAt: null,
      isPending: true
    };
    // 新任务提交后应优先展示进行中状态，避免仍停留在用户此前手动固定的旧记录上
    userPinnedActiveRef.current = false;
    setAllItems((prev) => {
      const next = sortHistoryBySubmissionOrder([pendingItem, ...prev]);
      allItemsRef.current = next;
      return next;
    });
    setActiveId(tempId);
    return tempId;
  }, []);

  const addPendingItems = React.useCallback((input: { type: string; batchId: string; count: number; submittedAt?: string } & PendingHistoryMetadata) => {
    const count = Math.max(1, Math.min(10, Math.floor(Number(input.count) || 1)));
    const createdAt = new Date().toISOString();
    const pendingItems = Array.from({ length: count }, (_, index): HistoryItem => {
      const tempId = `temp_${input.batchId}_${index + 1}_${Math.random().toString(36).slice(2, 9)}`;
      return {
        id: tempId,
        renderKey: tempId,
        type: input.type,
        prompt: input.prompt || null,
        model: input.model || null,
        url: "",
        status: "running",
        createdAt,
        finishedAt: null,
        params: input.params || null,
        isPending: true,
        batchId: input.batchId,
        batchIndex: index + 1,
        batchSize: count,
        batchSubmittedAt: input.submittedAt || createdAt,
      };
    });
    userPinnedActiveRef.current = false;
    setAllItems((prev) => {
      const next = sortHistoryBySubmissionOrder([...pendingItems, ...prev]);
      allItemsRef.current = next;
      return next;
    });
    setActiveId(pendingItems[0]?.id || null);
    return pendingItems.map((item) => item.id);
  }, []);

  const removePendingItem = React.useCallback((tempId: string) => {
    if (!tempId) return;
    setAllItems((prev) => {
      if (!prev.some((item) => item.id === tempId)) return prev;
      const next = prev.filter((item) => item.id !== tempId);
      allItemsRef.current = next;
      return next;
    });
    setActiveId((prev) => (prev === tempId ? null : prev));
  }, []);

  const failPendingItem = React.useCallback((tempId: string, errorMsg: string) => {
    if (!tempId) return;
    setAllItems((prev) => {
      const next = prev.map((item) =>
        item.id === tempId
          ? { ...item, status: "failed", errorMsg: errorMsg || "生成失败", finishedAt: new Date().toISOString(), isPending: false, isClientFailure: true }
          : item,
      );
      const ordered = sortHistoryBySubmissionOrder(next);
      allItemsRef.current = ordered;
      if (userId) historyCache.set(userId, { items: ordered, fetchedAt: Date.now(), nextCursor: nextCursorRef.current, hasMore: hasMoreRef.current });
      return ordered;
    });
  }, [userId]);

  // 提交成功后把乐观占位项与真实任务按 id 关联：原子地把占位项 id 换成真实 generationId。
  // 关键：彻底摆脱"按 createdAt 时间戳猜测占位项是否被取代"的旧逻辑——设备时钟比服务器快时
  // 那套判断会失效，导致占位项与真实任务并存（历史里显示两个，刷新才消失）。
  const resolvePendingItem = React.useCallback(
    (tempId: string, realId: string) => {
      if (!tempId || !realId) return;
      setAllItems((prev) => {
        const pendingItem = prev.find((item) => item.id === tempId);
        if (!pendingItem) return prev;
        const stableRenderKey = pendingItem.renderKey || pendingItem.id;
        // 真实项已被轮询提前拉进列表 → 直接丢掉占位项；否则把占位项原地改成真实 id（保持位置与“生成中”状态，无闪烁）。
        const realExists = prev.some((item) => item.id === realId);
        const next = realExists
          ? prev
              .filter((item) => item.id !== tempId)
              .map((item) => (item.id === realId ? { ...item, renderKey: stableRenderKey } : item))
          : prev.map((item) => (item.id === tempId ? { ...item, id: realId, isPending: false } : item));
        const ordered = sortHistoryBySubmissionOrder(next);
        allItemsRef.current = ordered;
        if (userId) historyCache.set(userId, { items: ordered, fetchedAt: Date.now(), nextCursor: nextCursorRef.current, hasMore: hasMoreRef.current });
        return ordered;
      });
      setActiveId((prev) => (prev === tempId ? realId : prev));
    },
    [userId]
  );

  React.useImperativeHandle(
    ref,
    () => ({
      exportAll: () => {
        for (const it of visibleItems) {
          const a = document.createElement("a");
          a.href = it.url;
          a.download = "";
          a.rel = "noopener";
          a.click();
        }
      },
      reload: () => {
        void loadHistory({ force: true });
      },
      addPendingItem,
      addPendingItems,
      removePendingItem,
      failPendingItem,
      resolvePendingItem
    }),
    [addPendingItem, addPendingItems, removePendingItem, failPendingItem, resolvePendingItem, loadHistory, visibleItems]
  );

  const startMediaDrag = React.useCallback((e: React.DragEvent, item: HistoryItem) => {
    if (!item.url) {
      e.preventDefault();
      return;
    }
    const fullUrl = normalizeDragUrl(item.url);
    if (!fullUrl) {
      e.preventDefault();
      return;
    }
    const localPath = toLocalUploadPath(fullUrl);
    try {
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("application/x-history-media-url", fullUrl);
      e.dataTransfer.setData("application/x-history-image-url", fullUrl);
      e.dataTransfer.setData("text/uri-list", fullUrl);
      e.dataTransfer.setData("text/plain", localPath || fullUrl);
      if (localPath) e.dataTransfer.setData("application/x-local-upload-path", localPath);
    } catch {}
  }, []);

  const deleteOne = async (id: string) => {
    if (!userId) return;
    const nextHidden = new Set(hiddenIds);
    nextHidden.add(id);
    persistHiddenIds(nextHidden);
    setAllItems((prev) => {
      const next = prev.filter((x) => x.id !== id);
      historyCache.set(userId, { items: next, fetchedAt: Date.now(), nextCursor: nextCursorRef.current, hasMore: hasMoreRef.current });
      setActiveId((prevActive) => {
        if (prevActive !== id) return prevActive;
        return next[0]?.id || null;
      });
      return next;
    });
  };

  const cancelOne = React.useCallback(
    async (item: HistoryItem) => {
      if (!userId) return;
      if (item.isPending || item.id.startsWith("temp_")) {
        removePendingItem(item.id);
        return;
      }
      try {
        const res = await fetch("/api/history/cleanup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, action: "cancel_single", generationId: item.id })
        });
        if (res.ok) {
          setAllItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, status: "cancelled", errorMsg: "用户取消", finishedAt: new Date().toISOString() } : x)));
        }
      } finally {
        await loadHistory({ force: true });
      }
    },
    [loadHistory, removePendingItem, userId]
  );

  const clearAllVisible = React.useCallback(async () => {
    if (!userId || !visibleItems.length) return;
    const visibleIdSet = new Set(visibleItems.map((item) => item.id));
    const nextHidden = new Set(hiddenIds);
    visibleIdSet.forEach((id) => nextHidden.add(id));
    persistHiddenIds(nextHidden);
    setAllItems((prev) => {
      const next = prev.filter((item) => !visibleIdSet.has(item.id));
      historyCache.set(userId, { items: next, fetchedAt: Date.now(), nextCursor: nextCursorRef.current, hasMore: hasMoreRef.current });
      setActiveId((prevActive) => {
        if (!prevActive || !visibleIdSet.has(prevActive)) return prevActive;
        return next[0]?.id || null;
      });
      return next;
    });
  }, [hiddenIds, persistHiddenIds, userId, visibleItems]);

  const applyTemplate = React.useCallback(
    async (item: HistoryItem) => {
      if (!userId || item.model === "video-frame") return;
      const inFlight = applyVideoTemplateInFlightRef.current.get(item.id);
      if (inFlight) {
        await inFlight;
        return;
      }
      setApplyingVideoTemplateId(item.id);
      const task = (async () => {
        try {
          const showNotice = (notice: string) => {
            if (!notice) return;
            setInlineNotice(notice);
            if (noticeTimerRef.current) {
              window.clearTimeout(noticeTimerRef.current);
            }
            noticeTimerRef.current = window.setTimeout(() => {
              setInlineNotice(null);
              noticeTimerRef.current = null;
            }, 3500);
          };
          const openTool = (tool: "image" | "video", eventName?: string) => {
            localStorage.setItem("studio_last_tool_v1", tool);
            if (typeof window === "undefined") return;
            window.dispatchEvent(new CustomEvent("studio:open-tool", { detail: { tool } }));
            if (eventName) {
              window.dispatchEvent(new CustomEvent(eventName, { detail: { userId, at: Date.now() } }));
            }
          };
          const params = item.params && typeof item.params === "object" ? (item.params as Record<string, any>) : {};

          if (item.type === "face_swap") { return; }

          if (item.type === "image_edit") {
            const model = String(params.model || item.model || "nano-banana-2");
            const isSeedream =
              model === "doubao-seedream-5.0-pro" || model === "doubao-seedream-5.0-lite" || model === "doubao-seedream-4.5" || model === "doubao-seedream-4.0";
            const isSeedreamPro = model === "doubao-seedream-5.0-pro";
            const seedream = params.seedream && typeof params.seedream === "object" ? params.seedream as Record<string, any> : null;
            const seedreamOutputMode = !isSeedreamPro && seedream?.outputMode === "group" ? "group" : "single";
            const seedreamOutputCount = String(seedream?.outputCount || "4");
            const seedreamWebSearch = !isSeedreamPro && seedream?.webSearch ? "on" : "off";
            const payload = {
              prompt: stripPromptAssetMentions(typeof item.prompt === "string" ? item.prompt : ""),
              model,
              aspectRatio: String(params.aspectRatio || "1:1"),
              resolution: String(params.resolution || (isSeedream ? "2K" : "1K")),
              googleThinkingLevel: params.googleThinkingLevel,
              googleSearchMode: params.googleSearchMode,
            gifSize: params.gifSize, frameCount: params.frameCount, frameDurationMs: params.frameDurationMs, seedream55: params.seedream55,
            ...(isSeedream55Model(model) ? { officialBackground: params.background || "auto", customSize: params.customSize } : {}),
            officialOutputFormat: params.outputFormat || params.apimart?.outputFormat || "png",
              outputQuantity: 1,
              ...(isGptImageVariantModel(model) ? { officialBackground: params.background || params.apimart?.background || "auto", officialOutputFormat: params.outputFormat || params.apimart?.outputFormat || "png", officialQuality: params.quality || params.apimart?.quality || "medium", gptImage25Mode: params.gptImage25Mode || params.reapiGptImage25?.mode || params.aicomingGptImage25?.mode || params.apimart?.mode || "flare" } : {}),
              ...(model === "qwen-image-3.0" ? { officialQuality: params.quality === "pro" ? "pro" : "standard" } : {}),
              seedreamOutputMode,
              seedreamOutputCount,
              seedreamWebSearch,
              inputMedia: Array.isArray(params.inputMedia) ? params.inputMedia : [],
              imagePaths: Array.isArray(params.imagePaths) ? params.imagePaths.map((entry) => normalizeTemplateMediaPath(entry)).filter(Boolean) : []
            };
            writeEphemeralToolTemplate("image", userId, payload);
            openTool("image", "studio:apply-image-template");
            return;
          }

          const { payload, notice, deferred } = await prepareVideoTemplateForStudio(userId, item, { timeoutMs: 1200 });
          commitVideoTemplateToStudio(userId, payload);
          showNotice(notice);
          if (deferred) {
            void deferred.then(({ payload: finalizedPayload }) => {
              commitVideoTemplateToStudio(userId, finalizedPayload);
            });
          }
        } catch {}
      })().finally(() => {
        applyVideoTemplateInFlightRef.current.delete(item.id);
        setApplyingVideoTemplateId((prev) => (prev === item.id ? null : prev));
      });
      applyVideoTemplateInFlightRef.current.set(item.id, task);
      await task;
    },
    [userId]
  );

  React.useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  const openZoom = React.useCallback((src: string, kind: "image" | "video") => {
    const normalized = normalizeMediaUrl(src);
    if (!normalized) return;
    setReferencePreview(null);
    setGroupResultPreview(null);
    setZoomSrc(normalized);
    setZoomKind(kind);
    setZoomOpen(true);
  }, []);

  const openReferenceZoom = React.useCallback(
    (items: VideoPreviewAsset[], index: number) => {
      if (!items.length || index < 0 || index >= items.length) return;
      setZoomSrc(null);
      setGroupResultPreview(null);
      setReferencePreview({ items, index });
      setZoomOpen(true);
    },
    [],
  );

  const openGroupResultPreview = React.useCallback((itemId: string) => {
    const entries = activeGroupItems.flatMap((item) => {
      const url = normalizeMediaUrl(item.url);
      return url ? [{ id: item.id, url }] : [];
    });
    const index = entries.findIndex((entry) => entry.id === itemId);
    if (index < 0) return;
    userPinnedActiveRef.current = true;
    setActiveId(itemId);
    setReferencePreview(null);
    setZoomSrc(null);
    setZoomKind("image");
    setGroupResultPreview({ entries, index });
    setZoomOpen(true);
  }, [activeGroupItems]);

  const metaHoverPortal =
    activeMeta.summary && metaHoverOpen && !metaPopoverOpen && metaPopoverPosition && typeof document !== "undefined"
      ? createPortal(
          <div
            className="history-meta-popover pointer-events-none fixed z-[120] max-w-[520px] rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--app-fg)] shadow-[var(--shadow-2)] whitespace-pre-wrap break-words select-text"
            style={{
              right: metaPopoverPosition.right,
              bottom: metaPopoverPosition.bottom,
              maxHeight: metaPopoverPosition.availableAbove,
              overflow: "auto"
            }}
          >
            {activeMeta.full}
          </div>,
          document.body
        )
      : null;

  const metaDetailPortal =
    activeMeta.summary && metaPopoverOpen && metaPopoverPosition && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={metaPopoverPanelRef}
            className="history-meta-popover fixed z-[121] w-[min(560px,calc(100vw-32px))] rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-2)]"
            style={{
              right: metaPopoverPosition.right,
              bottom: metaPopoverPosition.bottom,
              maxHeight: metaPopoverPosition.availableAbove,
              overflow: "hidden"
            }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
              <div className="text-[12px] font-medium text-[var(--app-fg)]"><UiText id="common.m979a332955c8" /></div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(activeMeta.full);
                      setMetaCopied(true);
                      window.setTimeout(() => setMetaCopied(false), 1200);
                    } catch {}
                  }}
                  className="h-7 px-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] text-[11px] text-[var(--app-fg)] hover:bg-[var(--panel-3)] transition flex items-center gap-1"
                >
                  {metaCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {metaCopied ? <UiText id="common.m8f6f8d979c98" /> : <UiText id="common.m63d90d977348" />}
                </button>
                <button
                  type="button"
                  onClick={() => setMetaPopoverOpen(false)}
                  className="h-7 w-7 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)] hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)] transition flex items-center justify-center"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="overflow-auto whitespace-pre-wrap break-words px-3 py-3 text-[12px] leading-6 text-[var(--app-fg)] select-text" style={{ maxHeight: Math.max(80, metaPopoverPosition.availableAbove - 44) }}>
              {activeMeta.full}
              <Seedream55Result output={activeItem?.params?.seedream55Output} />
              {activeItem?.params?.googleGrounding ? <div className="mt-3 whitespace-normal">
                <GoogleGroundingSources grounding={activeItem.params.googleGrounding as import("@/lib/google-image-settings").GoogleGrounding} />
              </div> : null}
            </div>
          </div>,
          document.body
        )
      : null;

  const videoDetailPortal =
    activeItem && typeGroup(activeItem.type) === "video" && videoDetailOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[122] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
            onMouseDown={() => setVideoDetailOpen(false)}
          >
            <UiProps ids={{"aria-label":["common.mcc6eaa9c948b"]}}><div
              role="dialog"
              aria-modal="true"
              aria-label="common.mcc6eaa9c948b"
              className="flex max-h-[min(760px,calc(100dvh-32px))] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-2)]"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-[var(--app-fg)]"><UiText id="common.m56b3909705f3" /></div>
                  <div className="mt-0.5 text-[11px] text-[var(--app-muted)]">
                    {formatHistoryTime(activeItem.finishedAt || activeItem.createdAt, locale)}
                  </div>
                </div>
                <UiProps ids={{"aria-label":["common.mff9ef2479af7"]}}><button
                  type="button"
                  onClick={() => setVideoDetailOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)] transition hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)]"
                  aria-label="common.mff9ef2479af7"
                >
                  <X className="h-4 w-4" />
                </button></UiProps>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden px-4 py-4">
                <section className="flex min-h-0 flex-1 flex-col">
                  <div className="mb-2 shrink-0 text-xs font-medium text-[var(--app-muted)]"><UiText id="common.m1ae0d6d3e41b" /></div>
                  <div
                    data-video-prompt-scroll="true"
                    className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 py-3 text-sm leading-6 text-[var(--app-fg)] select-text"
                  >
                    {activeItem.prompt || <UiText id="common.mfccd86db2a9d" />}
                  </div>
                </section>
                <section className="shrink-0">
                  <div className="mb-2 text-xs font-medium text-[var(--app-muted)]"><UiText id="common.m6abcd1436548" /></div>
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 py-3 text-xs">
                    {getVideoDetailRows(activeItem, modelNames, text, locale).map((row) => (
                      <React.Fragment key={`video_detail_${row.label}`}>
                        <div className="text-[var(--app-muted)]">{row.label}</div>
                        <div className="break-words text-right text-[var(--app-fg)]">{row.value}</div>
                      </React.Fragment>
                    ))}
                  </div>
                </section>
              </div>
            </div></UiProps>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="h-full min-h-0 flex flex-col gap-4">
      {metaHoverPortal}
      {metaDetailPortal}
      {videoDetailPortal}
      <div className="overflow-hidden flex-1 min-h-0">
        <div className={["h-full w-full relative", floatingActions ? "pt-14" : ""].join(" ")}>
          {floatingActions ? (
            <div className="absolute right-2 top-9 z-20 2xl:top-2">{floatingActions}</div>
          ) : null}
          {activeItem ? (
                <>
                  {(() => {
                    const isGenerating = isInProgressStatus(activeItem.status);
                    const isFailed = activeItem.status === "failed" || activeItem.status === "cancelled";
                    const activeDisplayUrl = getHistoryDisplayUrl(activeItem);
                    const hasOutput = !!activeItem.url;
                    const hasDisplayOutput = !!activeDisplayUrl;
                    const hasGroupDisplay = activeGroupItems.length > 1 && !!activeGroupId;
                    const silentlyWaitingForImagePreview = isWaitingForImagePreview(activeItem) && !hasDisplayOutput && !hasGroupDisplay;
                    const isVideoTask = isHistoryVideo(activeItem);
                    const generationStageText = activeItem.isPending ? text("createDynamic.m1f873c59010a") : text("createDynamic.m0744c58ad089");
                    return (
                      <>
                        {isGenerating && !hasDisplayOutput && !hasGroupDisplay ? (
                      silentlyWaitingForImagePreview ? null : isVideoTask ? (
                      <VideoTaskSurface
                        header={(
                          <VideoTaskHeader
                            item={activeItem}
                            onOpen={openReferenceZoom}
                            onShowDetails={() => setVideoDetailOpen(true)}
                            onCancel={() => {
                              void cancelOne(activeItem);
                            }}
                            staticVideoPreviews={staticVideoPreviews}
                          />
                        )}
                      >
                        <div className="absolute inset-0">
                          <HistoryGeneratingIndicator size="compact">
                            <div className="space-y-1 text-center">
                              <div className="text-sm font-medium text-[var(--app-fg)]">{generationStageText}</div>
                              <div className="text-xs text-[var(--app-muted)]"><UiText id="common.mab257695799a" /></div>
                            </div>
                          </HistoryGeneratingIndicator>
                        </div>
                      </VideoTaskSurface>
                      ) : (
                      <HistoryGeneratingIndicator>
                        {/* 文字提示 */}
                        <div className="relative text-center space-y-1.5">
                          <div className="text-[var(--app-fg)] text-sm font-medium">{generationStageText}</div>
                          <div className="text-[var(--app-muted)] text-xs"><UiText id="common.ma90bfe2cc66c" /></div>
                          <UiProps ids={{"aria-label":["common.m537d17f1c531"],"title":["common.m537d17f1c531"]}}><button
                            type="button"
                            onClick={() => {
                              void cancelOne(activeItem);
                            }}
                            className="mx-auto mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 text-xs font-medium text-rose-700 transition hover:bg-rose-500/15"
                            aria-label="common.m537d17f1c531"
                            title="common.m537d17f1c531"
                          >
                            <X className="h-3.5 w-3.5" /><UiText id="common.m2cd0f3be8738" /></button></UiProps>
                        </div>
                      </HistoryGeneratingIndicator>
                      )
                    ) : hasDisplayOutput || hasGroupDisplay ? (
                      <div className="w-full h-full min-w-0 min-h-0">
                        {isVideoTask ? (
                          (() => {
                            const lastFrameUrl = getVideoLastFrameUrl(activeItem);
                            const activeVideoUrl = getHistoryVideoUrl(activeItem);
                            const activePosterUrl = getHistoryVideoPoster(activeItem);
                            const activeVideoReady = !!activeVideoUrl && activeVideoReadyUrl === activeVideoUrl;
                            const tail = lastFrameUrl || activeItem.errorMsg ? (
                              <div className="space-y-3">
                                {lastFrameUrl ? (
                                  <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                      <div className="text-[11px] font-medium text-[var(--app-muted)]"><UiText id="common.m649b95620e6d" /></div>
                                      <button
                                        type="button"
                                        onClick={() => downloadByUrl(lastFrameUrl, "video-last-frame.png")}
                                        className="inline-flex h-6 items-center rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 text-[10px] text-[var(--app-fg)] transition hover:bg-[var(--panel-3)]"
                                      ><UiText id="common.m4673a2306165" /></button>
                                    </div>
                                    <UiProps ids={{"title":["common.m9c5e2777c5c9"]}}><button
                                      type="button"
                                      onClick={() => openZoom(lastFrameUrl, "image")}
                                      className="block w-full max-w-[80px] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--panel-2)] text-left transition hover:border-[var(--app-muted)]/50"
                                      title="common.m9c5e2777c5c9"
                                    >
                                      <UiProps ids={{"alt":["common.m649b95620e6d"]}}><MediaImage src={lastFrameUrl} alt="common.m649b95620e6d" className="h-[45px] w-full object-cover" /></UiProps>
                                    </button></UiProps>
                                  </div>
                                ) : null}
                                {activeItem.errorMsg ? (
                                  <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-700">
                                    {localizeError(friendlyErrorPrimaryText(activeItem.errorMsg))}
                                  </div>
                                ) : null}
                              </div>
                            ) : null;

                            return (
                              <VideoTaskSurface
                                header={(
                                  <VideoTaskHeader
                                    item={activeItem}
                                    onOpen={openReferenceZoom}
                                    onShowDetails={() => setVideoDetailOpen(true)}
                                    onRegenerate={() => {
                                      void applyTemplate(activeItem);
                                    }}
                                    regenerating={applyingVideoTemplateId === activeItem.id}
                                    staticVideoPreviews={staticVideoPreviews}
                                  />
                                )}
                                tail={tail}
                              >
                                {activePosterUrl ? (
                                  <MediaImage
                                    src={activePosterUrl}
                                    alt=""
                                    className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-2xl"
                                    loading="eager"
                                    fetchPriority="high"
                                  />
                                ) : null}
                                <div className="absolute inset-0 bg-[var(--panel-2)]/35" />
                                <div
                                  className="absolute inset-0 flex items-center justify-center"
                                  onMouseEnter={(event) => {
                                    if (frameCaptureInFlightRef.current || (event.target as HTMLElement).closest("[data-app-video-controls]")) return;
                                    const video = activeVideoRef.current;
                                    if (!video) return;
                                    video.currentTime = 0;
                                    void video.play().catch(() => undefined);
                                  }}
                                  onMouseLeave={() => {
                                    if (!frameCaptureInFlightRef.current) activeVideoRef.current?.pause();
                                  }}
                                >
                                  {!activeVideoReady ? (
                                    <div className="pointer-events-none absolute inset-0 z-10 h-full w-full">
                                      <VideoPosterPreview
                                        videoSrc={activeVideoUrl}
                                        posterSrc={activePosterUrl}
                                        alt=""
                                        fit="contain"
                                        showPlayIcon={false}
                                        background="player"
                                        className="h-full w-full"
                                      />
                                    </div>
                                  ) : null}
                                  {activeVideoUrl ? <AppVideoPlayer
                                    compact
                                    controlsOnHover
                                    ref={activeVideoRef}
                                    frameCaptureBusy={frameCaptureBusy}
                                    onCaptureFrame={activeItem.status === "success" && !activeItem.isPending
                                      ? (video, mode) => { void captureHistoryVideoFrame(activeItem, video, mode); }
                                      : undefined}
                                    crossOrigin="anonymous"
                                    src={activeVideoUrl}
                                    poster={activePosterUrl || undefined}
                                    className="h-full w-full object-contain"
                                    containerClassName="h-full w-full"
                                    muted={false}
                                    loop
                                    showCenterControl={false}
                                    playOnSurfaceClick
                                    playsInline
                                    preload="auto"
                                    data-video-ready={activeVideoReady ? "true" : "false"}
                                    onLoadedData={() => {
                                      setActiveVideoReadyUrl(activeVideoUrl);
                                    }}
                                    onCanPlay={() => {
                                      setActiveVideoReadyUrl(activeVideoUrl);
                                    }}
                                  /> : null}
                                </div>
                              </VideoTaskSurface>
                            );
                          })()
                        ) : hasGroupDisplay && activeGroupId ? (
                          <div className="relative h-full w-full overflow-hidden bg-[var(--input-bg)] p-3">
                            <div className="h-full w-full overflow-hidden">
                              <div
                                data-history-result-grid
                                className="grid h-full min-h-0 w-full gap-3"
                                style={{
                                  gridTemplateColumns: `repeat(${activeGroupGrid.columns}, minmax(0, 1fr))`,
                                  gridTemplateRows: `repeat(${activeGroupGrid.rows}, minmax(0, 1fr))`,
                                }}
                              >
                              {activeGroupItems.map((it, groupIndex) => {
                                const natural = groupImageNaturalSize[it.id];
                                const ratio = getHistoryItemAspectRatio(it, natural);
                                const groupDisplayUrl = getHistoryDisplayUrl(it);
                                const originalCandidates = Array.from(new Set([buildMediaOriginalUrl(it.url), it.url, groupDisplayUrl].filter(Boolean)));
                                const groupItemGenerating = isInProgressStatus(it.status);
                                const groupItemSilentlyWaitingForPreview = isWaitingForImagePreview(it) && !groupDisplayUrl;
                                const groupItemFailed = it.status === "failed" || it.status === "cancelled";
                                const failureReason = groupItemFailed
                                  ? it.errorMsg
                                    ? friendlyErrorPrimaryText(it.errorMsg)
                                    : text("createDynamic.m369f674efe55")
                                  : "";
                                const hasGroupOutput = !!it.url;
                                const hasGroupDisplayOutput = !!groupDisplayUrl;
                                return (
                                  <div
                                    key={it.renderKey || it.id}
                                    data-group-tile="1"
                                    className={[
                                      "group relative flex min-h-0 min-w-0 flex-col select-none rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-2)]",
                                      activeItem.id === it.id ? "ring-2 ring-blue-500/25" : ""
                                    ].join(" ")}
                                  >
                                    {hasGroupOutput ? (
                                      <div className="absolute right-2 top-9 z-30">
                                        <a
                                          href={it.url}
                                          download
                                          onClick={(e) => e.stopPropagation()}
                                          className="pointer-events-none inline-flex h-7 items-center rounded-lg border border-[var(--border)] bg-[var(--panel-bg)]/88 px-2 text-[10px] text-[var(--app-fg)] opacity-0 shadow-[var(--shadow-2)] backdrop-blur-xl transition-opacity focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
                                        ><UiText id="common.m4673a2306165" /></a>
                                      </div>
                                    ) : null}
                                    {hasGroupDisplayOutput ? (
                                      <div className="flex h-7 shrink-0 items-center justify-end px-2">
                                        <ImageResolution src={it.url} dimensions={readImageDimensions(it.params?.videoFrame)} />
                                      </div>
                                    ) : null}
                                    {hasGroupDisplayOutput ? (
                                      <button
                                        type="button"
                                        onClick={() => openGroupResultPreview(it.id)}
                                        className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden rounded-xl bg-[var(--input-bg)] p-2 text-left"
                                        aria-label={text("createDynamic.m5aac998affa1", { index: groupIndex + 1 })}
                                      >
                                        <ResilientImage
                                          candidates={originalCandidates}
                                          alt=""
                                          className="h-full w-full object-contain"
                                          onLoad={(e) => {
                                            const el = e.currentTarget;
                                            const w = Number(el.naturalWidth || 0);
                                            const h = Number(el.naturalHeight || 0);
                                            if (!w || !h) return;
                                            setGroupImageNaturalSize((prev) => {
                                              const curr = prev[it.id];
                                              if (curr && curr.width === w && curr.height === h) return prev;
                                              return { ...prev, [it.id]: { width: w, height: h } };
                                            });
                                          }}
                                        />
                                        <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/55 px-2 py-1 text-[10px] font-medium leading-none text-white backdrop-blur-sm">
                                          {groupIndex + 1}
                                        </span>
                                      </button>
                                    ) : groupItemSilentlyWaitingForPreview ? (
                                      <div
                                        className="h-full w-full rounded-xl bg-[var(--panel-2)]"
                                        style={{ aspectRatio: ratio }}
                                      />
                                    ) : groupItemGenerating && !groupDisplayUrl ? (
                                      <div
                                        className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-xl border border-blue-500/25 bg-[var(--panel-2)]"
                                        style={{ aspectRatio: ratio }}
                                      >
                                        <HistoryGeneratingIndicator size="compact" />
                                      </div>
                                    ) : groupItemFailed && !groupDisplayUrl ? (
                                      <div
                                        className="flex h-full w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-rose-500/25 bg-rose-500/5 px-3"
                                        style={{ aspectRatio: ratio }}
                                      >
                                        <X className="h-8 w-8 text-rose-500" />
                                        <span className="text-xs font-medium text-rose-600">
                                          {it.status === "cancelled" ? <UiText id="common.m6f96c2add214" /> : <UiText id="common.m470f92db3d64" />}
                                        </span>
                                        <span
                                          title={failureReason}
                                          className="line-clamp-3 max-w-full break-all text-center text-[11px] leading-4 text-rose-600/80"
                                        >
                                          {failureReason}
                                        </span>
                                      </div>
                                    ) : (
                                      <div className="flex h-full w-full items-center justify-center rounded-xl bg-[var(--panel-2)] text-xs text-[var(--app-muted)]"><UiText id="common.mb8a535c64b24" /></div>
                                    )}
                                  </div>
                                );
                              })}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <CanvasBoard
                            key={activeDisplayUrl}
                            src={activeDisplayUrl}
                            downloadSrc={activeItem.url}
                            originalSrc={activeItem.url}
                            dimensions={readImageDimensions(activeItem.params?.videoFrame)}
                            fitMode="contain"
                            showLoadingIndicator={false}
                            allowGridSplit={false}
                            preview={(
                              <MediaImage
                                src={activeDisplayUrl}
                                alt=""
                                className="h-full w-full object-contain"
                                previewSize={HISTORY_THUMB_PREVIEW_SIZE}
                                loading="eager"
                                fetchPriority="high"
                              />
                            )}
                            className="h-full w-full rounded-none"
                          />
                        )}
                      </div>
                    ) : isFailed ? (
                      isVideoTask ? (
                      <VideoTaskSurface
                        header={(
                          <VideoTaskHeader
                            item={activeItem}
                            onOpen={openReferenceZoom}
                            onShowDetails={() => setVideoDetailOpen(true)}
                            onRegenerate={() => {
                              void applyTemplate(activeItem);
                            }}
                            regenerating={applyingVideoTemplateId === activeItem.id}
                            staticVideoPreviews={staticVideoPreviews}
                          />
                        )}
                        stageClassName="border-rose-500/20 bg-rose-500/6"
                      >
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-6 text-center">
                                  <div className="relative h-20 w-20 flex items-center justify-center">
                                    <div className="relative h-16 w-16 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                                      <X className="h-8 w-8 text-rose-600" />
                                    </div>
                                  </div>
                                  <div className="space-y-2">
                                    <div className="text-base font-medium text-rose-700">
                                      {activeItem.status === "cancelled" ? <UiText id="common.m6f96c2add214" /> : <UiText id="common.m470f92db3d64" />}
                                    </div>
                                    {activeItem.errorMsg ? renderFriendlyError(activeItem.errorMsg, localizeError) : null}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void applyTemplate(activeItem);
                                    }}
                                    disabled={activeItem.type === "face_swap" || applyingVideoTemplateId === activeItem.id}
                                    className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 text-sm text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:pointer-events-none disabled:opacity-60"
                                  >
                                    {applyingVideoTemplateId === activeItem.id ? (
                                      <>
                                        <Loader2 className="h-4 w-4 animate-spin" /><UiText id="common.m66d5dd404721" /></>
                                    ) : (
                                      <>
                                        <Wand2 className="h-4 w-4" /><UiText id="common.m3221a042ea36" /></>
                                    )}
                                  </button>
                        </div>
                      </VideoTaskSurface>
                      ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-6 p-8">
                        {/* 失败图标 */}
                        <div className="relative h-24 w-24 flex items-center justify-center">
                          <div className="relative h-20 w-20 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                            <X className="h-10 w-10 text-rose-600" />
                          </div>
                        </div>

                        {/* 错误信息 */}
                        <div className="text-center space-y-3 max-w-md">
                          <div className="text-rose-200 text-base font-medium">
                            {activeItem.status === "cancelled" ? <UiText id="common.m6f96c2add214" /> : <UiText id="common.m470f92db3d64" />}
                          </div>
                          {activeItem.errorMsg ? renderFriendlyError(activeItem.errorMsg, localizeError) : null}
                          <div className="text-[var(--app-muted)] text-xs pt-2"><UiText id="common.m42058d4a24ea" /></div>
                          <div className="pt-2">
                            <button
                              type="button"
                              onClick={() => {
                                void applyTemplate(activeItem);
                              }}
                              disabled={applyingVideoTemplateId === activeItem.id}
                              className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 text-sm text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:pointer-events-none disabled:opacity-60"
                            >
                              {applyingVideoTemplateId === activeItem.id ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin" /><UiText id="common.m66d5dd404721" /></>
                              ) : (
                                <>
                                  <Wand2 className="h-4 w-4" /><UiText id="common.m3221a042ea36" /></>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                      )
                    ) : (
                      <div className="text-[var(--app-muted)] text-sm"><UiText id="common.mb8a535c64b24" /></div>
                    )}
                  </>
                );
              })()}
            </>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--app-muted)] text-sm text-center">
              <div className="text-[var(--app-fg)] font-medium"><UiText id="common.mbc5bb2654621" /></div>
              <div className="text-xs text-[var(--app-muted)] mt-2"><UiText id="common.ma1af6ef613c2" /></div>
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 overflow-x-auto rounded-2xl bg-[var(--panel-bg)] p-1.5 shadow-[var(--shadow-2)] sm:gap-2 sm:p-2">
        {activeItem?.model !== "video-frame" ? <button
          type="button"
          disabled={!activeItem || applyingVideoTemplateId === activeItem.id}
          onClick={() => {
            if (!activeItem) return;
            void applyTemplate(activeItem);
          }}
          className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-1.5 text-[11px] text-[var(--app-fg)] transition hover:bg-[var(--panel-3)] disabled:pointer-events-none disabled:opacity-60 sm:h-8 sm:gap-1.5 sm:px-2.5 sm:text-xs"
        >
          {activeItem && applyingVideoTemplateId === activeItem.id ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin sm:h-3.5 sm:w-3.5" /><UiText id="common.m35c25c9d4bfb" /></>
          ) : (
            <>
              <Wand2 className="h-3 w-3 sm:h-3.5 sm:w-3.5" /><UiText id="common.m3221a042ea36" /></>
          )}
        </button> : null}
        {activeItem && activeItem.url ? (
          <a
            // 本地就绪直接下载本地文件；saving 阶段走同源转发接口（跨域远程 URL 的 download 属性无效）
            href={activeItem.url}
            download
            className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-1.5 text-[11px] text-[var(--app-fg)] transition hover:bg-[var(--panel-3)] sm:h-8 sm:gap-1.5 sm:px-2.5 sm:text-xs"
          >
            <Download className="h-3 w-3 sm:h-3.5 sm:w-3.5" /><UiText id="common.m4673a2306165" /></a>
        ) : (
          <div className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-1.5 text-[11px] text-[var(--app-muted)] opacity-60 sm:h-8 sm:gap-1.5 sm:px-2.5 sm:text-xs">
            <Download className="h-3 w-3 sm:h-3.5 sm:w-3.5" /><UiText id="common.m4673a2306165" /></div>
        )}
        <button
          type="button"
          disabled={!visibleItems.length}
          onClick={() => setClearAllConfirmOpen(true)}
          className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-1.5 text-[11px] text-[var(--app-fg)] transition hover:bg-[var(--panel-3)] disabled:pointer-events-none disabled:opacity-50 sm:h-8 sm:gap-1.5 sm:px-2.5 sm:text-xs"
        >
          <Trash2 className="h-3 w-3 sm:h-3.5 sm:w-3.5" /><UiText id="common.m55f1033fab69" /></button>
        {activeMeta.summary ? (
          <div
            ref={metaPopoverRef}
            className="ml-auto min-w-0 relative group"
            onMouseEnter={() => {
              clearMetaHoverTimer();
              if (metaPopoverOpen) return;
              metaHoverTimerRef.current = window.setTimeout(() => {
                metaHoverTimerRef.current = null;
                updateMetaPopoverPosition();
                setMetaHoverOpen(true);
              }, 400);
            }}
            onMouseLeave={() => {
              clearMetaHoverTimer();
              setMetaHoverOpen(false);
            }}
            onFocus={() => {
              clearMetaHoverTimer();
              updateMetaPopoverPosition();
              setMetaHoverOpen(true);
            }}
            onBlur={(event) => {
              if (event.currentTarget.contains(event.relatedTarget)) return;
              clearMetaHoverTimer();
              setMetaHoverOpen(false);
            }}
          >
            <button
              type="button"
              onClick={() => {
                clearMetaHoverTimer();
                updateMetaPopoverPosition();
                setMetaHoverOpen(false);
                setMetaPopoverOpen((prev) => !prev);
              }}
              className="flex max-w-[720px] min-w-0 items-center justify-end gap-1 overflow-hidden px-1 text-right text-[11px] text-[var(--app-muted)] opacity-60 transition hover:opacity-100"
            >
              {activeMeta.promptPreview ? (
                <>
                  <span className="min-w-0 truncate">{activeMeta.promptPreview}</span>
                  {activeMeta.metaParts.length ? <span className="shrink-0">|</span> : null}
                </>
              ) : null}
              {activeMeta.metaParts.map((part, index) => (
                <React.Fragment key={`${part}_${index}`}>
                  {index > 0 ? <span className="shrink-0">|</span> : null}
                  <span className="shrink-0 whitespace-nowrap">{part}</span>
                </React.Fragment>
              ))}
            </button>
          </div>
        ) : null}
      </div>

      <div
        onWheel={(e) => {
          const el = thumbsScrollRef.current;
          if (!el) return;
          if (e.shiftKey) return;
          if (Math.abs(e.deltaY) < 1) return;
          el.scrollLeft += e.deltaY;
          e.preventDefault();
        }}
        className="shrink-0 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-2)] p-2 overflow-hidden"
      >
        {thumbItems.length ? (
          <HistoryThumbnailStrip
            ref={thumbnailStripRef}
            items={thumbItems}
            virtualizeThreshold={staticVideoPreviews ? 12 : undefined}
            getKey={(thumb) => thumb.groupCount > 1 ? `group_${thumb.groupId}` : (thumb.item.renderKey || thumb.item.id)}
            hasMore={hasMorePages}
            onEndReached={loadNextPage}
            onScrollerRef={(element) => {
              thumbsScrollRef.current = element;
            }}
            renderItem={(thumb) => {
              const it = thumb.item;
              const active = activeItem ? getHistoryDisplayGroupKey(activeItem) === thumb.groupId : it.id === activeId;
              const isGenerating = isInProgressStatus(it.status);
              const isFailed = it.status === "failed" || it.status === "cancelled";
              const hasOutput = !!it.url;
              const displayUrl = getHistoryDisplayUrl(it);
              const hasDisplayOutput = !!displayUrl;
              const silentlyWaitingForImagePreview = isWaitingForImagePreview(it) && !hasDisplayOutput;
              const displayIsImage = !!displayUrl && inferMediaUrlKind(displayUrl) === "image";
              const isVideo = isHistoryVideo(it);
              const videoUrl = isVideo ? getHistoryVideoUrl(it) : "";
              if (thumb.groupCount > 1) {
                return (
                  <div
                    key={`group_${thumb.groupId}`}
                    data-history-thumbnail={thumb.groupId}
                    className={[
                      "group/history-thumb relative flex-shrink-0 rounded-2xl border bg-[var(--panel-bg)] p-1 shadow-[var(--shadow-2)] !transition-none",
                      active
                        ? "border-blue-400/70 ring-2 ring-blue-400/20 shadow-[0_8px_18px_rgba(15,23,42,0.10)]"
                        : "border-[var(--border)] hover:border-[var(--border-2)]",
                      isFailed && !active ? "border-rose-500/30 ring-2 ring-rose-500/15" : ""
                    ].join(" ")}
                  >
                    <div className="flex gap-1">
                      {thumb.groupItems.map((groupItem, groupIndex) => {
                        const groupItemActive = groupItem.id === activeId;
                        const groupDisplayUrl = getHistoryDisplayUrl(groupItem);
                        const groupItemHasOutput = !!groupItem.url;
                        const groupItemGenerating = isInProgressStatus(groupItem.status);
                        const groupItemSilentlyWaitingForPreview = isWaitingForImagePreview(groupItem) && !groupDisplayUrl;
                        const groupItemFailed = groupItem.status === "failed" || groupItem.status === "cancelled";
                        return (
                          <div key={groupItem.renderKey || groupItem.id} className="group/history-result relative h-[60px] w-[60px] flex-shrink-0">
                            <UiProps ids={{"title":["common.m7f303e1edf11","common.m470f92db3d64","common.m969ef41f7e5b"]}}><button
                              type="button"
                              onClick={() => {
                                userPinnedActiveRef.current = true;
                                setActiveId(groupItem.id);
                              }}
                              onDoubleClick={() => {
                                if (!groupItem.url) return;
                                openZoom(groupItem.url, inferKind(groupItem.url));
                              }}
                              draggable={!!groupItem.url && inferKind(groupItem.url) === "image"}
                              onDragStart={(e) => startMediaDrag(e, groupItem)}
                              className={[
                                "group relative h-full w-full overflow-hidden rounded-xl border bg-[var(--panel-2)] !transition-none",
                                groupItemActive
                                  ? "border-blue-400/80 ring-2 ring-blue-400/25"
                                  : "border-[var(--border)] hover:border-blue-300/50",
                              ].join(" ")}
                              aria-label={text("createDynamic.m8a93a9f6737f", { index: groupIndex + 1 })}
                              title={groupItem.url ? "common.m7f303e1edf11" : groupItemFailed ? "common.m470f92db3d64" : "common.m969ef41f7e5b"}
                            >
                              {groupItemSilentlyWaitingForPreview ? null : groupItemGenerating && !groupDisplayUrl ? (
                                <HistoryGeneratingIndicator size="thumbnail" />
                              ) : groupItemFailed && !groupDisplayUrl ? (
                                <div className="flex h-full w-full items-center justify-center bg-rose-500/5">
                                  <X className="h-5 w-5 text-rose-500" />
                                </div>
                              ) : groupDisplayUrl ? (
                                staticVideoPreviews && inferKind(groupDisplayUrl) === "video" ? (
                                  <VideoPosterPreview videoSrc={groupDisplayUrl} posterSrc={it.posterUrl} className="h-full w-full" />
                                ) : (
                                  <MediaImage src={groupDisplayUrl} alt="" className="h-full w-full object-cover" previewSize={HISTORY_THUMB_PREVIEW_SIZE} />
                                )
                              ) : (
                                <div className="flex h-full w-full items-center justify-center bg-[var(--panel-2)] text-[9px] text-[var(--app-muted)]"><UiText id="common.mb8a535c64b24" /></div>
                              )}
                              <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100 bg-black/10" />
                              {groupItemActive ? (
                                <>
                                  <div className="absolute inset-0 rounded-xl border border-blue-300/70 pointer-events-none" />
                                  <div className="absolute inset-x-1 bottom-0.5 h-[3px] rounded-full bg-blue-400/80 pointer-events-none" />
                                </>
                              ) : null}
                            </button></UiProps>
                            {groupItemHasOutput && !groupItemGenerating && !groupItemFailed && groupItem.type !== "face_swap" && groupItem.model !== "video-frame" ? (
                              <UiProps ids={{"title":["common.m40124b1376a9"]}}><button
                                type="button"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  void applyTemplate(groupItem);
                                }}
                                disabled={applyingVideoTemplateId === groupItem.id}
                                className={[
                                  "opacity-0 pointer-events-none group-hover/history-result:opacity-100 group-hover/history-result:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto absolute bottom-1 right-1 z-10 flex h-4 w-4 items-center justify-center rounded-full border shadow-[0_4px_10px_rgba(15,23,42,0.16)] backdrop-blur-xl transition",
                                  applyingVideoTemplateId === groupItem.id
                                    ? "border-blue-300/40 bg-blue-500/10 text-blue-500/80"
                                    : "border-[var(--border)] bg-[var(--panel-bg)]/88 text-[var(--app-fg)] hover:border-blue-300/50 hover:bg-blue-500/10 hover:text-blue-600",
                                ].join(" ")}
                                aria-label={text("createDynamic.m157188a6c0a2", { index: groupIndex + 1 })}
                                title="common.m40124b1376a9"
                              >
                                {applyingVideoTemplateId === groupItem.id ? (
                                  <Loader2 className="h-[9px] w-[9px] animate-spin" />
                                ) : (
                                  <RotateCcw className="h-[9px] w-[9px]" />
                                )}
                              </button></UiProps>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    {active ? (
                      <div className="pointer-events-none absolute inset-0 rounded-2xl border border-blue-300/50" />
                    ) : null}
                    <div className="pointer-events-none absolute top-1 right-1 rounded-full border border-[var(--border)] bg-[var(--panel-bg)]/90 px-1.5 py-0.5 text-[10px] leading-none text-[var(--app-fg)] shadow-[0_4px_10px_rgba(15,23,42,0.10)] backdrop-blur-sm">
                      {thumb.groupCount}
                    </div>
                    <UiProps ids={{"aria-label":["common.m2f9daa828907"]}}><button
                      type="button"
                      onClick={() => {
                        setPendingDeleteId(it.id);
                        setDeleteConfirmOpen(true);
                      }}
                      className="opacity-0 pointer-events-none group-hover/history-thumb:opacity-100 group-hover/history-thumb:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto absolute -top-1 -right-2 h-5 w-5 after:absolute after:-inset-0.5 after:content-[''] rounded-full border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] hover:bg-[var(--panel-2)] transition flex items-center justify-center shadow-[var(--shadow-2)]"
                      aria-label="common.m2f9daa828907"
                    >
                      <X className="h-3 w-3" />
                    </button></UiProps>
                  </div>
                );
              }
              return (
                <div key={thumb.groupCount > 1 ? `group_${thumb.groupId}` : (it.renderKey || it.id)} data-history-thumbnail={thumb.groupId} className="group/history-thumb relative flex-shrink-0">
                  <UiProps ids={{"aria-label":["common.mdb8db0530432"]}}><button
                    type="button"
                    onClick={() => {
                      userPinnedActiveRef.current = true;
                      setActiveId(it.id);
                    }}
                    onDoubleClick={() => {
                      if (thumb.groupCount <= 1) return;
                      userPinnedActiveRef.current = true;
                      setActiveId(it.id);
                      setGroupGalleryId(thumb.groupId);
                      setGroupGalleryOpen(true);
                    }}
                    draggable={hasOutput && (inferKind(it.url) === "image" || inferKind(it.url) === "video")}
                    onDragStart={(e) => startMediaDrag(e, it)}
                    className={[
                      "block h-[60px] w-[60px] rounded-xl overflow-hidden border !transition-none relative",
                      active
                        ? "border-blue-400/70 bg-blue-500/[0.06] ring-2 ring-blue-400/20 shadow-[0_8px_18px_rgba(15,23,42,0.10)]"
                        : "border-[var(--border)] hover:border-[var(--border-2)]",
                      isGenerating && !active ? "border-blue-500/30 ring-2 ring-blue-500/15" : "",
                      isFailed && !active ? "border-rose-500/30 ring-2 ring-rose-500/15" : ""
                    ].join(" ")}
                    aria-label="common.mdb8db0530432"
                  >
                    {silentlyWaitingForImagePreview ? null : isGenerating && !hasDisplayOutput ? (
                      <HistoryGeneratingIndicator size="thumbnail" />
                    ) : hasDisplayOutput && isVideo ? (
                      <div className="relative h-full w-full group/video-thumb">
                        {staticVideoPreviews ? (
                          <VideoPosterPreview videoSrc={videoUrl} posterSrc={getHistoryVideoPoster(it)} className="h-full w-full" />
                        ) : displayIsImage ? (
                          <MediaImage src={displayUrl} alt="" className="h-full w-full object-cover" previewSize={HISTORY_THUMB_PREVIEW_SIZE} />
                        ) : (
                          <>
                            <video src={videoUrl} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                            {/*
                            视频
                            */}
                          </>
                        )}

                      </div>
                    ) : hasDisplayOutput ? (
                      <MediaImage src={displayUrl} alt="" className="h-full w-full object-cover" previewSize={HISTORY_THUMB_PREVIEW_SIZE} />
                    ) : isFailed ? (
                      <div className="h-full w-full bg-[var(--panel-2)] flex items-center justify-center relative overflow-hidden">
                        <div className="absolute inset-0 bg-rose-500/5" />
                        <div className="relative">
                          <X className="h-6 w-6 text-rose-300/80" />
                        </div>
                      </div>
                    ) : (
                      <div className="h-full w-full bg-[var(--panel-2)] flex items-center justify-center text-[var(--app-muted)] text-xs"><UiText id="common.mb47d3f110db7" /></div>
                    )}
                    {hasOutput && inferKind(it.url) === "video" ? (
                      <UiProps ids={{"aria-label":["common.mc20f7618d330"]}}><div aria-label="common.mc20f7618d330" className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-black/45 text-white">
                          <div className="ml-0.5 h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-white" />
                        </div>
                      </div></UiProps>
                    ) : null}
                    {active ? (
                      <>
                        <div className="absolute inset-0 border border-blue-300/70 rounded-xl pointer-events-none" />
                        <div className="absolute inset-x-2 bottom-0.5 h-[3px] rounded-full bg-blue-400/80 pointer-events-none" />
                      </>
                    ) : null}
                  </button></UiProps>
                  {thumb.groupCount > 1 ? (
                    <div className="absolute top-1 right-1 px-1.5 h-4 rounded-full border border-[var(--border)] bg-[var(--panel-bg)] text-[10px] text-[var(--app-fg)] flex items-center"><UiText id="common.mfbacae9df02d" />{thumb.groupCount}
                    </div>
                  ) : null}
                  {(!isGenerating && !isFailed && it.model !== "video-frame") || (isGenerating && !hasDisplayOutput && !silentlyWaitingForImagePreview) ? null : (
                  <div title={typeLabel(it, text)} className={[
                    "absolute bottom-1 left-1 rounded-full border backdrop-blur-xl font-medium flex items-center gap-1 shadow-lg transition-all",
                    it.model === "video-frame" ? "right-1 min-h-4 px-0.5 text-center text-[9px] leading-tight justify-center" : "px-1.5 h-4 text-[10px]",
                    isGenerating ? "border-blue-500/25 bg-blue-500/10 text-blue-700" :
                    isFailed ? "border-rose-500/25 bg-rose-500/10 text-rose-700" :
                    "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-fg)]"
                  ].join(" ")}>
                    {isGenerating && !silentlyWaitingForImagePreview ? <div className="h-1 w-1 rounded-full bg-blue-400 pulse-subtle" /> : null}
                    {isFailed && <div className="h-1 w-1 rounded-full bg-rose-400" />}
                    {isGenerating ? <UiText id="common.m1ad1463fe16f" /> : isFailed ? <UiText id="common.m28384d7afd2e" /> : thumb.groupCount > 1 ? <UiText id="common.m9bbfefa108cf" /> : typeLabel(it, text)}
                  </div>
                  )}
                  {hasOutput && !isGenerating && !isFailed && it.type !== "face_swap" && it.model !== "video-frame" ? (
                    <UiProps ids={{"aria-label":["common.m40124b1376a9"],"title":["common.m40124b1376a9"]}}><button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void applyTemplate(it);
                      }}
                      disabled={applyingVideoTemplateId === it.id}
                      className={[
                        "opacity-0 pointer-events-none group-hover/history-thumb:opacity-100 group-hover/history-thumb:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto absolute bottom-1 right-1 h-4 w-4 rounded-full border backdrop-blur-xl transition flex items-center justify-center shadow-[0_4px_10px_rgba(15,23,42,0.16)]",
                        applyingVideoTemplateId === it.id
                          ? "border-blue-300/40 bg-blue-500/10 text-blue-500/80"
                          : "border-[var(--border)] bg-[var(--panel-bg)]/88 text-[var(--app-fg)] hover:border-blue-300/50 hover:bg-blue-500/10 hover:text-blue-600"
                      ].join(" ")}
                      aria-label="common.m40124b1376a9"
                      title="common.m40124b1376a9"
                    >
                      {applyingVideoTemplateId === it.id ? (
                        <Loader2 className="h-[9px] w-[9px] animate-spin" />
                      ) : (
                        <RotateCcw className="h-[9px] w-[9px]" />
                      )}
                    </button></UiProps>
                  ) : null}
                  {isGenerating ? (
                    <UiProps ids={{"aria-label":["common.m537d17f1c531"],"title":["common.m537d17f1c531"]}}><button
                      type="button"
                      onClick={() => {
                        void cancelOne(it);
                      }}
                      className="opacity-0 pointer-events-none group-hover/history-thumb:opacity-100 group-hover/history-thumb:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto absolute -top-2 -right-2 h-5 w-5 rounded-full border border-rose-500/20 bg-rose-500/10 backdrop-blur text-rose-700 hover:bg-rose-500/15 transition flex items-center justify-center"
                      aria-label="common.m537d17f1c531"
                      title="common.m537d17f1c531"
                    >
                      <X className="h-[9px] w-[9px]" />
                    </button></UiProps>
                  ) : (
                    <UiProps ids={{"aria-label":["common.m2f9daa828907"]}}><button
                      type="button"
                      onClick={() => {
                        setPendingDeleteId(it.id);
                        setDeleteConfirmOpen(true);
                      }}
                      className="opacity-0 pointer-events-none group-hover/history-thumb:opacity-100 group-hover/history-thumb:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto absolute -top-2 -right-2 h-5 w-5 after:absolute after:-inset-0.5 after:content-[''] rounded-full border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] hover:bg-[var(--panel-2)] transition flex items-center justify-center shadow-[var(--shadow-2)]"
                      aria-label="common.m2f9daa828907"
                    >
                      <X className="h-3 w-3" />
                    </button></UiProps>
                  )}
                </div>
              );
            }}
          />
        ) : (
          <div className="h-20 px-4 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] flex items-center text-sm text-[var(--app-muted)] shadow-[var(--shadow-2)]"><UiText id="common.m8ed36e406ce0" /></div>
        )}
      </div>

      {groupGalleryOpen && groupGalleryItems.length ? (
        <div className="fixed inset-0 z-[110] pointer-events-none">
          <div className="absolute inset-0 bg-transparent" />
          <div className="absolute inset-0 p-4 lg:p-6 flex items-center justify-center">
            <div
              className="relative w-full max-w-[980px] max-h-[calc(100dvh-2rem)] rounded-[24px] border border-[var(--border)] bg-[var(--sidebar-bg)] shadow-[var(--shadow)] overflow-hidden flex flex-col pointer-events-auto"
              style={{ transform: `translate(${groupGalleryOffset.x}px, ${groupGalleryOffset.y}px)` }}
            >
              <div
                className="h-14 px-4 lg:px-5 flex items-center justify-between border-b border-[var(--border)] bg-[var(--panel-bg)] cursor-move select-none"
                onMouseDown={(e) => {
                  groupGalleryDragRef.current = {
                    startX: e.clientX,
                    startY: e.clientY,
                    baseX: groupGalleryOffset.x,
                    baseY: groupGalleryOffset.y
                  };
                }}
              >
                <div className="text-sm text-[var(--app-fg)] font-semibold"><UiText id="common.ma3842d64c6a1" />{groupGalleryItems.length}<UiText id="common.me9e0fdc242b4" /></div>
                <button
                  type="button"
                  onClick={() => setGroupGalleryOpen(false)}
                  className="h-9 w-9 rounded-xl border border-[var(--border)] bg-[var(--app-bg)] text-[var(--app-muted)] hover:text-[var(--app-fg)] hover:bg-[var(--panel-2)] transition flex items-center justify-center"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-auto p-4 lg:p-5 bg-[var(--input-bg)]">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 lg:gap-4">
                  {groupGalleryItems.map((it) => {
                    const originalUrl = normalizeMediaUrl(it.url);
                    const galleryItemGenerating = isInProgressStatus(it.status);
                    const galleryItemFailed = it.status === "failed" || it.status === "cancelled";
                    return (
                      <button
                        key={`group_gallery_${it.renderKey || it.id}`}
                        type="button"
                        draggable={!!originalUrl}
                        onDragStart={(e) => {
                          if (!originalUrl) return;
                          groupGalleryDraggingRef.current = true;
                          startMediaDrag(e, it);
                          window.setTimeout(() => {
                            groupGalleryDraggingRef.current = false;
                          }, 0);
                        }}
                        onClick={() => {
                          if (groupGalleryDraggingRef.current || !originalUrl) return;
                          setActiveId(it.id);
                          setZoomSrc(originalUrl);
                          setZoomKind(inferKind(originalUrl));
                          setZoomOpen(true);
                        }}
                        className="group relative rounded-2xl overflow-hidden border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow-2)]"
                      >
                        {galleryItemGenerating && !originalUrl ? (
                          <div className="flex aspect-square w-full flex-col items-center justify-center gap-3 bg-[var(--panel-2)]">
                            <HistoryGeneratingIndicator size="compact" />
                          </div>
                        ) : galleryItemFailed && !originalUrl ? (
                          <div className="flex aspect-square w-full flex-col items-center justify-center gap-3 bg-rose-500/5">
                            <X className="h-7 w-7 text-rose-500" />
                            <span className="text-xs text-rose-600"><UiText id="common.m470f92db3d64" /></span>
                          </div>
                        ) : originalUrl ? (
                          <>
                            <div className="flex h-7 items-center justify-end px-2">
                              <ImageResolution src={originalUrl} dimensions={readImageDimensions(it.params?.videoFrame)} />
                            </div>
                            <img src={originalUrl} alt="" className="w-full aspect-square object-cover transition-transform duration-300 group-hover:scale-[1.03]" draggable={false} loading="eager" decoding="async" />
                          </>
                        ) : (
                          <div className="flex aspect-square w-full items-center justify-center bg-[var(--panel-2)] text-xs text-[var(--app-muted)]"><UiText id="common.mb8a535c64b24" /></div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <UiProps ids={{"title":["common.m2ce6edaf49f2","common.m98d420309947"]}}><MediaLightbox
        open={zoomOpen}
        src={activeReferencePreview?.url || groupResultPreview?.entries[groupResultPreview.index]?.url || zoomSrc || activeItem?.url || null}
        kind={activeReferencePreview?.type || (groupResultPreview ? "image" : zoomSrc ? zoomKind : activeItem ? inferKind(activeItem.url) : "image")}
        title={referencePreview ? "common.m2ce6edaf49f2" : groupResultPreview ? "common.m98d420309947" : ""}
        layout={referencePreview || groupResultPreview ? "floating" : "content"}
        counter={referencePreview
          ? `${referencePreview.index + 1}/${referencePreview.items.length}`
          : groupResultPreview
            ? `${groupResultPreview.index + 1}/${groupResultPreview.entries.length}`
            : undefined}
        counterAlwaysVisible={Boolean(referencePreview || groupResultPreview)}
        dots={referencePreview && referencePreview.items.length > 1
          ? { count: referencePreview.items.length, activeIndex: referencePreview.index }
          : groupResultPreview && groupResultPreview.entries.length > 1
            ? { count: groupResultPreview.entries.length, activeIndex: groupResultPreview.index }
            : undefined}
        hasPrev={Boolean(
          referencePreview
            ? referencePreview.index > 0
            : groupResultPreview && groupResultPreview.index > 0,
        )}
        hasNext={Boolean(
          referencePreview
            ? referencePreview.index < referencePreview.items.length - 1
            : groupResultPreview && groupResultPreview.index < groupResultPreview.entries.length - 1,
        )}
        onPrev={groupResultPreview ? () => {
          setGroupResultPreview((current) => current
            ? { ...current, index: Math.max(0, current.index - 1) }
            : current);
        } : referencePreview ? () => {
          setReferencePreview((current) => current
            ? { ...current, index: Math.max(0, current.index - 1) }
            : current);
        } : undefined}
        onNext={groupResultPreview ? () => {
          setGroupResultPreview((current) => current
            ? { ...current, index: Math.min(current.entries.length - 1, current.index + 1) }
            : current);
        } : referencePreview ? () => {
          setReferencePreview((current) => current
            ? { ...current, index: Math.min(current.items.length - 1, current.index + 1) }
            : current);
        } : undefined}
        onClose={() => {
          setZoomOpen(false);
          setZoomSrc(null);
          setReferencePreview(null);
          setGroupResultPreview(null);
        }}
      /></UiProps>
      <UiProps ids={{"title":["common.m53ae9aa92de0"],"description":["common.m24ce8cacbbb5"],"confirmText":["common.m6135d4159e89"]}}><ConfirmDialog
        open={deleteConfirmOpen}
        title="common.m53ae9aa92de0"
        description="common.m24ce8cacbbb5"
        danger
        dimBackdrop={false}
        darkSolidSurface
        confirmText="common.m6135d4159e89"
        onConfirm={async () => {
          if (!pendingDeleteId) return;
          await deleteOne(pendingDeleteId);
          setPendingDeleteId(null);
        }}
        onClose={() => {
          setDeleteConfirmOpen(false);
          setPendingDeleteId(null);
        }}
      /></UiProps>
      <UiProps ids={{"title":["common.m51f27de322b9"],"description":["common.m983e1fe9e6b8"],"confirmText":["common.m55f1033fab69"]}}><ConfirmDialog
        open={clearAllConfirmOpen}
        title="common.m51f27de322b9"
        description="common.m983e1fe9e6b8"
        danger
        dimBackdrop={false}
        darkSolidSurface
        confirmText="common.m55f1033fab69"
        onConfirm={async () => {
          await clearAllVisible();
        }}
        onClose={() => {
          setClearAllConfirmOpen(false);
        }}
      /></UiProps>
      {inlineNotice ? (
        <div className="pointer-events-none fixed left-1/2 top-5 z-[120] -translate-x-1/2 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)]/95 px-3 py-2 text-xs text-[var(--app-fg)] shadow-[var(--shadow-2)] backdrop-blur-sm">
          {localizeError(localizeLabel(inlineNotice))}
        </div>
      ) : null}
    </div>
  );
}

export const UnifiedHistoryPanel = React.forwardRef<UnifiedHistoryPanelHandle, UnifiedHistoryPanelProps>(UnifiedHistoryPanelInner);
