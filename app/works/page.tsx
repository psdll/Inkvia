"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";

import { isSeedream55Model } from "@/lib/volcengine-seedream-55";

import * as React from "react";
import { WorksLoading, WorksGridSkeleton } from "@/components/works/works-loading";
import { supportsGptImage25Background } from "@/lib/gpt-image-25-models";
import { Check, Copy, Download, Grid2X2, Grid3X3, ArrowDownWideNarrow, ArrowUpWideNarrow, RefreshCw, Image as ImageIcon, ListChecks, Loader2, Music2, Trash2 } from "lucide-react";
import { Virtuoso, type Components, type StateSnapshot, type VirtuosoHandle } from "react-virtuoso";
import { MediaLightbox } from "@/components/ui/media-lightbox";
import { ResilientImage } from "@/components/ui/resilient-image";
import { HoverPreviewVideo } from "@/components/ui/hover-preview-video";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StableAssetGrid } from "@/components/works/stable-asset-grid";
import { DateGroupCheckbox } from "@/components/ui/date-group-checkbox";
import { AssetSourceSelect } from "@/components/ui/asset-source-select";
import { ScrollToTopButton } from "@/components/ui/scroll-to-top-button";
import { AutoHideScrollbar } from "@/components/ui/auto-hide-scrollbar";
import { AtomicPageReveal } from "@/components/layout/atomic-page-reveal";
import { WorkDetailModal, type WorkDetailItem } from "@/components/works/work-detail-modal";
import { useAuth } from '@/components/auth/AuthProvider'
import { useDesktopMode } from "@/components/system/desktop-mode";
import { useLogger } from "@/hooks/use-logger";
import { useRouter } from "next/navigation";
import { getMediaUrlExtension, isVideoMediaUrl, isAudioMediaUrl, normalizeMediaUrl } from "@/lib/media-url";
import { isKnownDeletedGenerationId, publishGenerationDeleted, subscribeGenerationDeleted } from "@/lib/generation-deletion-events";
import {
  applyAssetSourceFilterSearchParams,
  type AssetSourceFilterValue,
} from "@/lib/assets/source-filter";
import {
  commitVideoTemplateToStudio,
  getVideoTemplateModeLabel,
  getVideoTemplateReferenceRule,
  prepareVideoTemplateForStudio,
  resolveVideoTemplateInputMode,
  sanitizeVideoTemplatePrompt
} from "@/lib/video-template-reuse";
import { getWorkThumbnailCandidates, takeWorksEntry, clearWorksEntry } from "@/lib/client/works-entry";
import { writeEphemeralToolTemplate } from "@/lib/ephemeral-input-draft";

type AssetItem = {
  id: number;
  type: string;
  source?: string | null;
  status: string;
  prompt: string | null;
  localPath: string | null;
  createdAt: string;
  finishedAt?: string | null;
  model?: string | null;
  externalProvider?: string | null;
  externalTaskId?: string | null;
  params?: Record<string, any> | null;
  inputImages?: string[];
  outputPaths?: string[];
  displayUrl?: string | null;
  previewUrl?: string | null;
  posterUrl?: string | null;
  thumbUrl?: string | null;
  detailPending?: boolean;
  displayKind?: "image" | "video" | "audio";
  inspirationTemplateId?: number | null;
  inspirationSourceGenerationId?: number | null;
};

type TimeFilter = "1d" | "3d" | "7d" | "15d" | "30d" | "all";
type WorksCacheEntry = {
  items: AssetItem[];
  fetchedAt: number;
  nextCursor?: string | null;
  hasMore?: boolean;
  total?: number | null;
  scrollTop?: number;
  snapshot?: StateSnapshot;
  layout?: string;
};

const WORKS_PAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const WORKS_PAGE_SIZE = 60;
const WORKS_REFRESH_SPIN_MS = 600;
const worksPageCache = new Map<string, WorksCacheEntry>();
const worksMediaCountsCache = new Map<string, Record<string, number>>();
const WORKS_MEDIA_COUNTS_PREFIX = "works-media-counts-v1:";
function readMediaCounts(key: string): Record<string, number> {
  const cached = worksMediaCountsCache.get(key);
  if (cached) return cached;
  try {
    const stored = JSON.parse(sessionStorage.getItem(WORKS_MEDIA_COUNTS_PREFIX + key) || "{}");
    const counts: Record<string, number> = {};
    for (const kind of ["all", "image", "video", "audio"]) {
      if (typeof stored?.[kind] === "number" && Number.isFinite(stored[kind]) && stored[kind] >= 0) counts[kind] = stored[kind];
    }
    worksMediaCountsCache.set(key, counts);
    return counts;
  } catch { return {}; }
}
const worksPreferences = new Map<string, { type: "all" | "image" | "face_swap" | "image_edit" | "video" | "audio" | "other"; time: TimeFilter; source: AssetSourceFilterValue }>();
const worksStorageTimers = new Map<string, ReturnType<typeof setTimeout>>();
if (typeof window !== "undefined") window.addEventListener("auth:logout", () => {
  for (const key of worksPageCache.keys()) clearWorksCacheForUser(key.split("|")[0]);
  worksPreferences.clear();
  worksMediaCountsCache.clear();
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(WORKS_MEDIA_COUNTS_PREFIX)) sessionStorage.removeItem(key);
  } catch {}
});
const INSPIRATION_CARD_CACHE_PREFIX = "inspiration_template_cards_v1_";
const INSPIRATION_CARD_CACHE_INVALIDATED_AT_KEY = "inspiration_template_cards_invalidated_at_v1";
const INSPIRATION_CARD_CACHE_CATEGORIES = ["all", "image", "video", "face"];

function invalidateHomeInspirationCache() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(INSPIRATION_CARD_CACHE_INVALIDATED_AT_KEY, String(Date.now()));
    INSPIRATION_CARD_CACHE_CATEGORIES.forEach((category) => {
      window.localStorage.removeItem(`${INSPIRATION_CARD_CACHE_PREFIX}${category}`);
    });
    window.dispatchEvent(new Event("inspiration-template-cards:invalidate"));
  } catch {}
}

function getWorksCacheKey(
  userId: string,
  typeFilter = "all",
  timeFilter: TimeFilter = "all",
  sourceFilter: AssetSourceFilterValue = "creation",
  q = ""
) {
  return `${userId}|generated|${typeFilter}|${timeFilter}|${sourceFilter}|${q}`;
}

function getWorksStorageKey(
  userId: string,
  typeFilter = "all",
  timeFilter: TimeFilter = "all",
  sourceFilter: AssetSourceFilterValue = "creation",
  q = ""
) {
  return `works_page_cache_v7_${userId}_generated_${typeFilter}_${timeFilter}_${sourceFilter}_${q}`;
}

function readStoredWorksCache(
  userId: string,
  typeFilter = "all",
  timeFilter: TimeFilter = "all",
  sourceFilter: AssetSourceFilterValue = "creation",
  q = ""
): WorksCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(getWorksStorageKey(userId, typeFilter, timeFilter, sourceFilter, q));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorksCacheEntry> | null;
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return {
      items: normalizeWorksItems(parsed.items as AssetItem[]),
      scrollTop: Math.max(0, Number(parsed.scrollTop) || 0),
      snapshot: parsed.snapshot,
      layout: parsed.layout,
      fetchedAt: Number(parsed.fetchedAt) || 0,
      nextCursor: typeof parsed.nextCursor === "string" ? parsed.nextCursor : null,
      hasMore: !!parsed.hasMore,
      total: typeof parsed.total === "number" ? parsed.total : null
    };
  } catch {
    return null;
  }
}

function writeStoredWorksCache(
  userId: string,
  typeFilterOrEntry: string | WorksCacheEntry,
  timeFilter: TimeFilter = "all",
  entry?: WorksCacheEntry,
  sourceFilter: AssetSourceFilterValue = "creation",
  q = ""
) {
  if (typeof window === "undefined") return;
  const nextEntry = typeof typeFilterOrEntry === "string" ? entry : typeFilterOrEntry;
  const typeFilter = typeof typeFilterOrEntry === "string" ? typeFilterOrEntry : "all";
  if (!nextEntry) return;
  const storageKey = getWorksStorageKey(userId, typeFilter, timeFilter, sourceFilter, q);
  const pending = worksStorageTimers.get(storageKey);
  if (pending) clearTimeout(pending);
  // Avoid serializing a growing gallery inside the scroll/update handler.
  worksStorageTimers.set(storageKey, setTimeout(() => {
    worksStorageTimers.delete(storageKey);
    try {
      if (nextEntry.items.length <= 600) sessionStorage.setItem(storageKey, JSON.stringify(nextEntry));
      else sessionStorage.removeItem(storageKey);
    } catch {}
  }, 800));
  while (worksPageCache.size > 4) {
    const oldest = worksPageCache.keys().next().value!;
    worksPageCache.delete(oldest);
  }
}

function clearWorksCacheForUser(userId: string) {
  clearWorksEntry();
  for (const [key, timer] of worksStorageTimers) {
    if (key.startsWith(`works_page_cache_v7_${userId}_`)) { clearTimeout(timer); worksStorageTimers.delete(key); }
  }
  const memoryPrefix = `${userId}|generated|`;
  for (const key of Array.from(worksPageCache.keys())) {
    if (key.startsWith(memoryPrefix)) worksPageCache.delete(key);
  }

  if (typeof window === "undefined") return;
  const storagePrefixes = [
    `works_page_cache_v5_${userId}_generated_`,
    `works_page_cache_v7_${userId}_generated_`,
  ];
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key && storagePrefixes.some((prefix) => key.startsWith(prefix))) sessionStorage.removeItem(key);
    }
  } catch {}
}

function inferKind(localPath: string | null): "image" | "video" | "audio" {
  return isAudioMediaUrl(localPath) ? "audio" : isVideoMediaUrl(localPath) ? "video" : "image";
}

function getWorkDisplayCandidates(item: AssetItem) {
  return getWorkThumbnailCandidates(item);
}

function normalizeWorkInputImages(rawImages: unknown) {
  const images = Array.isArray(rawImages)
    ? rawImages
        .map((p: any) => normalizeMediaUrl(p))
        .filter((p: string) => Boolean(p) && !p.startsWith("asset://"))
    : [];
  return Array.from(new Set(images));
}

function normalizeWorksItems(list: AssetItem[]): AssetItem[] {
  return list.filter((x) => !isKnownDeletedGenerationId(x.id)).map((x) => ({
    id: Number(x.id),
    type: String(x.type || ""),
    source: x.source ? String(x.source) : "tool",
    status: String(x.status || ""),
    prompt: x.prompt ? String(x.prompt) : null,
    localPath: x.localPath ? normalizeMediaUrl(x.localPath) : null,
    createdAt: String(x.createdAt || ""),
    finishedAt: x.finishedAt ? String(x.finishedAt) : null,
    model: x.model ? String(x.model) : null,
    externalProvider: x.externalProvider ? String(x.externalProvider) : null,
    externalTaskId: x.externalTaskId ? String(x.externalTaskId) : null,
    params: x.params && typeof x.params === "object" ? (x.params as any) : null,
    inputImages: normalizeWorkInputImages((x as any).inputImages),
    outputPaths: Array.isArray((x as any).outputPaths) ? (x as any).outputPaths.map((p: any) => normalizeMediaUrl(p)).filter(Boolean) : [],
    displayUrl: x.displayUrl ? normalizeMediaUrl(x.displayUrl) : null,
    previewUrl: x.previewUrl ? normalizeMediaUrl(x.previewUrl) : null,
    posterUrl: x.posterUrl ? normalizeMediaUrl(x.posterUrl) : null,
    thumbUrl: x.thumbUrl ? normalizeMediaUrl(x.thumbUrl) : null,
    detailPending: !!x.detailPending,
    inspirationTemplateId: x.inspirationTemplateId ?? null,
    inspirationSourceGenerationId: x.inspirationSourceGenerationId ?? null,
    displayKind: x.type === "audio_gen" || x.displayKind === "audio" ? "audio" : x.displayKind === "video" ? "video" : inferKind(x.localPath)
  }));
}

function typeLabel(t: string) {
  if (t === "face_swap") return "人脸";
  if (t === "image_edit") return "图片";
  if (t === "video_gen" || t === "video_generate") return "视频";
  if (t === "audio_gen") return "音频";
  return t || "未知";
}

function formatName(item: AssetItem, text: ReturnType<typeof useUiLocale>["text"]) {
  const p = (item.prompt || "").trim();
  if (p) return p.length > 42 ? `${p.slice(0, 42)}…` : p;
  const lp = item.localPath || "";
  const parts = lp.split("/");
  const name = parts[parts.length - 1] || text("workspaceFollowup.m5f45bb826b16");
  return name;
}

function getWorkDate(item: AssetItem) {
  const raw = String(item.createdAt || item.finishedAt || "");
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getWorkDateGroupKey(item: AssetItem) {
  const date = getWorkDate(item);
  if (!date) return "unknown";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function getWorkDateGroupLabel(item: AssetItem, locale: string, text: ReturnType<typeof useUiLocale>["text"]) {
  const date = getWorkDate(item);
  if (!date) return text("workspaceFollowup.ma3f1cde9f177");
  if (locale === "en") return date.toLocaleDateString("en-US", { dateStyle: "medium" });
  return getWorkDateGroupKey(item);
}

type AssetDateGroup = { key: string; label: string; items: AssetItem[] };

type VirtualAssetRow = {
  key: string;
  groupKey: string;
  groupLabel: string | null;
  groupCount: number;
  items: AssetItem[];
  firstGroup: boolean;
};

type AssetVirtuosoContext = { footer: React.ReactNode };

function AssetVirtuosoFooter({ context }: { context: AssetVirtuosoContext }) {
  return <>{context.footer}</>;
}

const ASSET_VIRTUOSO_COMPONENTS: Components<VirtualAssetRow, AssetVirtuosoContext> = {
  Footer: AssetVirtuosoFooter,
};

function groupWorksByDate(list: AssetItem[], locale: string, text: ReturnType<typeof useUiLocale>["text"]): AssetDateGroup[] {
  const groups: AssetDateGroup[] = [];
  const byKey = new Map<string, AssetDateGroup>();
  for (const item of list) {
    const key = getWorkDateGroupKey(item);
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: getWorkDateGroupLabel(item, locale, text), items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

function getAssetGridColumnCount(width: number, tileSize = 144) {
  return Math.max(1, Math.floor((width + 10) / (tileSize + 10)));
}

function buildVirtualAssetRows(groups: AssetDateGroup[], columnCount: number): VirtualAssetRow[] {
  const rows: VirtualAssetRow[] = [];
  const safeColumnCount = Math.max(1, columnCount);
  groups.forEach((group, groupIndex) => {
    for (let start = 0; start < group.items.length; start += safeColumnCount) {
      rows.push({
        key: `${group.key}:${start}`,
        groupKey: group.key,
        groupLabel: start === 0 ? group.label : null,
        groupCount: group.items.length,
        items: group.items.slice(start, start + safeColumnCount),
        firstGroup: groupIndex === 0,
      });
    }
  });
  return rows;
}

function sanitizePrompt(prompt: string | null) {
  return sanitizeVideoTemplatePrompt(prompt);
}

function getAssetPreviewGridClass(count: number) {
  if (count <= 1) return "flex justify-center";
  if (count === 2) return "grid grid-cols-2 gap-3";
  if (count === 3) return "grid grid-cols-3 gap-2";
  if (count === 4) return "grid grid-cols-2 gap-2";
  return "grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2";
}

function getAssetPreviewCardClass(count: number, kind: "image" | "video") {
  if (count <= 1) {
    return kind === "video"
      ? "block w-full max-w-[420px] rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--app-bg)]"
      : "block w-full max-w-[360px] rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--app-bg)]";
  }
  if (count === 2) {
    return "block w-full rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--app-bg)]";
  }
  return "block rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--app-bg)]";
}

function getAssetPreviewMediaClass(count: number, kind: "image" | "video") {
  if (count <= 1) {
    return kind === "video" ? "w-full h-[360px] object-contain bg-black" : "w-full h-[320px] object-contain";
  }
  if (count === 2) {
    return kind === "video" ? "w-full h-[260px] object-contain bg-black" : "w-full h-[240px] object-contain";
  }
  return kind === "video" ? "w-full aspect-video object-contain bg-black" : "w-full aspect-square object-cover";
}

const PARAM_LABEL_MAP: Record<string, string> = {
  type: "类型",
  taskType: "任务类型",
  inputMode: "输入模式",
  model: "模型",
  aspectRatio: "宽高比",
  resolution: "分辨率",
  outputSize: "输出尺寸",
  similarity: "相似度",
  intensity: "强度",
  duration: "时长",
  nFrames: "帧数",
  imageCount: "输入数量",
  imagePaths: "输入图片URL",
  inputPublicUrls: "输入图片URL",
  image_urls: "输入图片URL",
  mediaPath: "输入素材URL",
  inputUrl: "输入素材URL",
  inputPreviewUrl: "输入预览公网URL",
  outputPath: "输出结果URL",
  outputPaths: "输出结果URL",
  output_images: "输出结果URL",
  resultUrls: "输出结果URL",
  source: "来源",
  provider: "提供方",
  externalTaskId: "任务ID",
  "seedream.outputMode": "出图模式",
  "seedream.outputCount": "系列图张数",
  "seedream.sequential": "顺序生成",
  "seedream.webSearch": "联网搜索"
};

const HIDDEN_PARAM_KEYS = new Set([
  "imagepaths",
  "inputpaths",
  "localinputpath",
  "mediapath",
  "facepath",
  "targetpath",
  "sourcepath",
  "filepath",
  "fileurls",
  "outputpath"
]);

function shouldHideParamPath(path: string) {
  const raw = String(path || "").trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  const tail = lower.split(".").pop() || lower;
  if (HIDDEN_PARAM_KEYS.has(tail)) return true;
  // 路径类字段默认不展示，避免本地路径污染参数面板
  if (tail.endsWith("path") && tail !== "outputpaths") return true;
  return false;
}

function getWorkModeInfo(item: AssetItem) {
  const p = item.params || {};
  if (item.type === "video_gen" || item.type === "video_generate") {
    const mode = resolveVideoTemplateInputMode(item);
    const rule = getVideoTemplateReferenceRule(mode);
    return {
      modeLabel: getVideoTemplateModeLabel(mode),
      requirement: rule.requiredCountText,
      acceptedTypes: rule.acceptedTypesText,
      uploadTitle: "参考素材",
      emptyText: rule.requiresReference ? "该模式需要参考素材，但当前没有保留可直接展示的素材记录" : "该模式为文生视频，无需上传参考素材"
    };
  }
  if (item.type === "face_swap") {
    const mode = String(p.mode || "swap").trim();
    if (mode === "defect" || mode === "swap_defect") {
      return {
        modeLabel: mode === "defect" ? "添加瑕疵" : "换脸并添加瑕疵",
        requirement: "至少需要 1 张图片",
        acceptedTypes: "仅图片",
        uploadTitle: "输入素材",
        emptyText: "该模式需要上传图片素材，但当前没有保留可直接展示的素材记录"
      };
    }
    return {
      modeLabel: "人脸替换",
      requirement: "需要参考脸和目标底图各 1 张",
      acceptedTypes: "仅图片",
      uploadTitle: "输入素材",
      emptyText: "该模式需要上传图片素材，但当前没有保留可直接展示的素材记录"
    };
  }
  if (item.type === "image_edit") {
    const imageCount = Array.isArray(p.imagePaths) ? p.imagePaths.length : Array.isArray(item.inputImages) ? item.inputImages.length : 0;
    return {
      modeLabel: imageCount > 0 ? "图生图/图片编辑" : "文生图",
      requirement: imageCount > 0 ? `需要 ${imageCount} 张参考图片` : "无需上传参考图片",
      acceptedTypes: imageCount > 0 ? "仅图片" : "无需参考图片",
      uploadTitle: "输入素材",
      emptyText: imageCount > 0 ? "该模式需要上传图片素材，但当前没有保留可直接展示的素材记录" : "该模式为文生图，无需上传参考图片"
    };
  }
  return {
    modeLabel: "-",
    requirement: "-",
    acceptedTypes: "-",
    uploadTitle: "输入素材",
    emptyText: "无上传素材记录"
  };
}

function formatParamLabel(path: string) {
  if (PARAM_LABEL_MAP[path]) return PARAM_LABEL_MAP[path];
  const raw = path.split(".").pop() || path;
  return PARAM_LABEL_MAP[raw] || raw;
}

function formatParamValue(v: any) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const primitive = v.every((x) => x === null || ["string", "number", "boolean"].includes(typeof x));
    if (primitive) return v.map((x) => String(x)).join("、");
    return JSON.stringify(v);
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function collectParamEntries(
  value: any,
  path: string,
  push: (label: string, value: string) => void
) {
  if (shouldHideParamPath(path)) return;
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    const s = formatParamValue(value);
    if (s) push(formatParamLabel(path), s);
    return;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (!keys.length) return;
    for (const key of keys) {
      const next = path ? `${path}.${key}` : key;
      collectParamEntries((value as any)[key], next, push);
    }
    return;
  }
  const s = formatParamValue(value);
  if (s) push(formatParamLabel(path), s);
}

function buildParamEntries(item: AssetItem) {
  const p = item.params || {};
  const model = item.model || p.model;
  const modeInfo = getWorkModeInfo(item);
  const outputUrls = Array.from(
    new Set(
      (Array.isArray(item.outputPaths) ? item.outputPaths : [])
        .map((x) => normalizeMediaUrl(x))
        .filter(Boolean)
    )
  );
  const outputUrlText = outputUrls.join("、");
  const entries: { label: string; value: string }[] = [];
  const seen = new Set<string>();
  const push = (label: string, value: any) => {
    if (value === null || value === undefined) return;
    const s = String(value).trim();
    if (!s) return;
    if (seen.has(label)) return;
    seen.add(label);
    entries.push({ label, value: s });
  };

  push("类型", typeLabel(item.type));
  push("使用模式", modeInfo.modeLabel);
  push("素材要求", modeInfo.requirement);
  push("素材类型", modeInfo.acceptedTypes);
  push("模型", model);
  push("宽高比", p.aspectRatio);
  push("分辨率", p.resolution);
  push("输出尺寸", p.outputSize);
  push("相似度", p.similarity);
  push("强度", p.intensity);
  push("时长", p.duration);
  push("帧数", p.nFrames);
  push("输入数量", p.imageCount);
  push("任务ID", item.externalTaskId);
  push("输出图片URL", outputUrlText);
  collectParamEntries(p, "", push);
  return entries;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {}
}

function buildParamsJson(item: AssetItem) {
  const combined: Record<string, any> = {
    id: item.id,
    type: item.type,
    createdAt: item.createdAt,
    finishedAt: item.finishedAt ?? null,
    model: item.model ?? null,
    externalTaskId: item.externalTaskId ?? null,
    prompt: sanitizePrompt(item.prompt) || null,
    params: item.params ?? null,
    inputImages: Array.isArray(item.inputImages) ? item.inputImages : [],
    outputPaths: Array.isArray(item.outputPaths) ? item.outputPaths : []
  };
  return JSON.stringify(combined, null, 2);
}

async function copyToClipboard(item: AssetItem) {
  const url = String(item.localPath || "");
  if (!url) return;
  try {
    const kind = inferKind(url);
    const canWriteFile = kind === "image" && typeof (window as any).ClipboardItem !== "undefined" && !!navigator.clipboard?.write;
    if (canWriteFile) {
      const res = await fetch(url);
      const blob = await res.blob();
      const ClipboardItemCtor = (window as any).ClipboardItem;
      await navigator.clipboard.write([new ClipboardItemCtor({ [blob.type || "image/png"]: blob })]);
    } else {
      await navigator.clipboard.writeText(url);
    }
  } catch {
    try {
      await navigator.clipboard.writeText(url);
    } catch {}
  }
}

function buildDownloadTargets(item: AssetItem) {
  const paths = Array.isArray(item.outputPaths) ? item.outputPaths.map((x) => normalizeMediaUrl(x)).filter(Boolean) : [];
  if (paths.length > 1) return Array.from(new Set(paths));
  const single = normalizeMediaUrl(item.localPath || "");
  return single ? [single] : [];
}

function buildInputDownloadTargets(item: AssetItem) {
  return Array.from(
    new Set(
      (Array.isArray(item.inputImages) ? item.inputImages : [])
        .map((x) => normalizeMediaUrl(x))
        .filter(Boolean)
    )
  );
}

function getWorkCardKey(item: Pick<AssetItem, "id" | "type" | "externalTaskId">) {
  const taskId = String(item.externalTaskId || "").trim();
  return taskId ? `${String(item.type || "")}:${taskId}` : `id:${String(item.id)}`;
}

function mergeParamsPreferFilled(current: Record<string, any> | null | undefined, incoming: Record<string, any> | null | undefined) {
  if (!current && !incoming) return null;
  if (!current) return incoming ? { ...incoming } : null;
  if (!incoming) return { ...current };
  const out: Record<string, any> = { ...current };
  for (const [key, nextVal] of Object.entries(incoming)) {
    const prevVal = out[key];
    const nextMeaningful =
      nextVal !== null &&
      nextVal !== undefined &&
      (typeof nextVal !== "string" || nextVal.trim().length > 0) &&
      (!Array.isArray(nextVal) || nextVal.length > 0);
    if (!nextMeaningful) continue;
    if (prevVal && typeof prevVal === "object" && !Array.isArray(prevVal) && nextVal && typeof nextVal === "object" && !Array.isArray(nextVal)) {
      out[key] = mergeParamsPreferFilled(prevVal as Record<string, any>, nextVal as Record<string, any>) || prevVal;
    } else if (
      prevVal === null ||
      prevVal === undefined ||
      (typeof prevVal === "string" && !prevVal.trim()) ||
      (Array.isArray(prevVal) && !prevVal.length)
    ) {
      out[key] = nextVal;
    }
  }
  return out;
}

function mergeWorkItem(current: AssetItem, incoming: AssetItem) {
  const currentTs = new Date(String(current.createdAt || "")).getTime() || 0;
  const incomingTs = new Date(String(incoming.createdAt || "")).getTime() || 0;
  const head = incomingTs > currentTs ? incoming : current;
  return {
    ...current,
    ...head,
    params: mergeParamsPreferFilled(current.params, incoming.params),
    inputImages: Array.from(new Set([...(current.inputImages || []), ...(incoming.inputImages || [])].filter(Boolean))),
    outputPaths: Array.from(new Set([...(current.outputPaths || []), ...(incoming.outputPaths || [])].filter(Boolean))),
  };
}

function mergeWorksList(current: AssetItem[], incoming: AssetItem[]) {
  const byKey = new Map<string, AssetItem>();
  for (const item of current) byKey.set(getWorkCardKey(item), item);
  for (const item of incoming) {
    const key = getWorkCardKey(item);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeWorkItem(existing, item) : item);
  }
  return Array.from(byKey.values()).sort((a, b) => {
    const delta = new Date(String(b.createdAt || 0)).getTime() - new Date(String(a.createdAt || 0)).getTime();
    return delta || Number(b.id || 0) - Number(a.id || 0);
  });
}

function triggerDownload(url: string, filename?: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "";
  a.rel = "noreferrer";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function buildDownloadFilename(prefix: string, id: number | string, idx: number, url: string) {
  return `${prefix}_${id}_${idx + 1}.${getMediaUrlExtension(url, "bin")}`;
}

export default function WorksPage() {
  const { text, locale, error: localizeError, label: uiLabel } = useUiLocale();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth()
  const desktopMode = useDesktopMode();
  const userId = user?.id ? String(user.id) : "";
  const [loading, setLoading] = React.useState(false);
  const [hasSettledInitialLoad, setHasSettledInitialLoad] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [view, setView] = React.useState<"grid" | "list">("grid");
  const [tileSize, setTileSize] = React.useState(144);
  const [order, setOrder] = React.useState<"desc" | "asc">("desc");
  const orderCacheKey = order === "asc" ? "asc" : "";
  const [batch, setBatch] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [batchBusy, setBatchBusy] = React.useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = React.useState(false);
  const [countsRevision, setCountsRevision] = React.useState(0);
  React.useEffect(() => {
    try { const value = Number(localStorage.getItem("works-tile-size")); if (value >= 96 && value <= 224) setTileSize(value); } catch {}
  }, []);
  const toggleSelected = (id: number) => setSelected(current => {
    const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const [typeFilter, setTypeFilter] = React.useState<"all" | "image" | "face_swap" | "image_edit" | "video" | "audio" | "other">(() => worksPreferences.get(userId)?.type || "all");
  const timeFilter: TimeFilter = "all";
  const [sourceFilter, setSourceFilter] = React.useState<AssetSourceFilterValue>(() => worksPreferences.get(userId)?.source || "creation");
  const mediaCountsKey = `${userId}|${sourceFilter}|${timeFilter}`;
  const [mediaCountsState, setMediaCountsState] = React.useState(() => ({ key: mediaCountsKey, values: readMediaCounts(mediaCountsKey) }));
  const mediaCounts = mediaCountsState.key === mediaCountsKey ? mediaCountsState.values : readMediaCounts(mediaCountsKey);
  const [items, setItems] = React.useState<AssetItem[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [loadMoreError, setLoadMoreError] = React.useState<string | null>(null);
  const [total, setTotal] = React.useState<number | null>(null);
  const [active, setActive] = React.useState<AssetItem | null>(null);
  const [zoomOpen, setZoomOpen] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<number | null>(null);
  const [appliedId, setAppliedId] = React.useState<number | null>(null);
  const [applyingId, setApplyingId] = React.useState<number | null>(null);
  const [inlineNotice, setInlineNotice] = React.useState<string | null>(null);
  const applyInFlightRef = React.useRef<Map<number, Promise<void>>>(new Map());
  const noticeTimerRef = React.useRef<number | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [detailItem, setDetailItem] = React.useState<AssetItem | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<AssetItem | null>(null);
  const [inspirationDeleteTarget, setInspirationDeleteTarget] = React.useState<AssetItem | null>(null);
  const [canUploadInspirationTemplate, setCanUploadInspirationTemplate] = React.useState(false);
  const [inspirationBusyId, setInspirationBusyId] = React.useState<number | null>(null);
  const virtuosoRef = React.useRef<VirtuosoHandle>(null);
  const [restoredSnapshot, setRestoredSnapshot] = React.useState<StateSnapshot | undefined>();
  const restoreScrollRef = React.useRef<number | null>(null);
  const resetScrollOnLoadRef = React.useRef(false);
  const scrollPositionRef = React.useRef(0);
  const moreAbortRef = React.useRef<AbortController | null>(null);
  const requestVersionRef = React.useRef(0);
  const detailRequestsRef = React.useRef(new Map<number, Promise<AssetItem>>());
  const detailIdRef = React.useRef<number | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [pendingHead, setPendingHead] = React.useState<AssetItem[]>([]);
  const [viewportHeight, setViewportHeight] = React.useState(900);
  const scrollSampleRef = React.useRef({ top: 0, at: 0, fast: false, direction: 1 });
  const [renderedRange, setRenderedRange] = React.useState({ startIndex: 0, endIndex: 0 });
  const requestAbortRef = React.useRef<AbortController | null>(null);
  const activeRequestKeyRef = React.useRef("");
  const scrollRootRef = React.useRef<HTMLDivElement | null>(null);
  const itemsRef = React.useRef<AssetItem[]>([]);
  const assetGridMeasureRef = React.useRef<HTMLDivElement | null>(null);
  const [scrollRootElement, setScrollRootElement] = React.useState<HTMLDivElement | null>(null);
  const [assetGridColumnCount, setAssetGridColumnCount] = React.useState(() => getAssetGridColumnCount(typeof window === "undefined" ? 1200 : window.innerWidth - 116));

  const setScrollRootNode = React.useCallback((node: HTMLDivElement | null) => {
    scrollRootRef.current = node;
    setScrollRootElement(node);
    if (node) setViewportHeight(node.clientHeight || 900);
  }, []);

  React.useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  React.useLayoutEffect(() => {
    if (view !== "grid") return;
    const element = assetGridMeasureRef.current;
    if (!element) return;
    const update = () => setAssetGridColumnCount(getAssetGridColumnCount(element.clientWidth, tileSize));
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasSettledInitialLoad, view, tileSize]);

  const { logAction } = useLogger();


  React.useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  const showInlineNotice = React.useCallback((text: string) => {
    const next = String(text || "").trim();
    if (!next) return;
    setInlineNotice(next);
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setInlineNotice(null);
      noticeTimerRef.current = null;
    }, 3500);
  }, []);

  const pushStudioVideoNotice = React.useCallback(
    (text: string) => {
      const next = String(text || "").trim();
      if (!next || !userId) return;
      try {
        localStorage.setItem(`studio_video_notice_v1_${userId}`, next);
      } catch {}
    },
    [userId]
  );

  React.useEffect(() => {
    if (userId) worksPreferences.set(userId, { type: typeFilter, time: timeFilter, source: sourceFilter });
  }, [userId, typeFilter, timeFilter, sourceFilter]);

  React.useEffect(() => subscribeGenerationDeleted((ids) => {
    if (!userId) return;
    const deleted = new Set(ids);
    clearWorksCacheForUser(userId);
    itemsRef.current = itemsRef.current.filter(item => !deleted.has(Number(item.id)));
    setItems((current) => current.filter((item) => !deleted.has(Number(item.id))));
    setActive((current) => current && deleted.has(Number(current.id)) ? null : current);
    setTotal(null);
  }), [userId]);

  React.useEffect(() => {
    if (!authLoading && !user) setHasSettledInitialLoad(true);
  }, [authLoading, user]);

  // 记录页面访问
  React.useEffect(() => {
    if (userId) {
      logAction("page_view", "用户访问了资产页面", { page: "/works" });
    }
  }, [userId, logAction]);

  React.useEffect(() => {
    if (userId) return;
    setItems([]);
    setCursor(null);
    setHasMore(false);
    setLoadingMore(false);
    setLoadMoreError(null);
    setTotal(null);
    setActive(null);
    setLoading(false);
    setError(null);
  }, [userId]);

  React.useEffect(() => {
    if (!userId) return;
    try {
      const saved = localStorage.getItem(`works_view_v1_${userId}`);
      if (saved === "grid" || saved === "list") setView(saved);
    } catch {}
  }, [userId]);

  React.useEffect(() => {
    let cancelled = false;
    if (desktopMode || !userId) {
      setCanUploadInspirationTemplate(false);
      return;
    }
    const loadPermission = async () => {
      try {
        const res = await fetch("/api/inspiration-templates/upload-permission", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as any;
        if (!cancelled) setCanUploadInspirationTemplate(Boolean(res.ok && json?.allowed));
      } catch {
        if (!cancelled) setCanUploadInspirationTemplate(false);
      }
    };
    void loadPermission();
    return () => {
      cancelled = true;
    };
  }, [desktopMode, userId]);

  React.useEffect(() => {
    if (!userId) return;
    try {
      localStorage.setItem(`works_view_v1_${userId}`, view);
    } catch {}
  }, [userId, view]);

  const legacyLoad = React.useCallback(async (options: { force?: boolean } = {}) => {
    if (!userId) return;
    const cacheKey = getWorksCacheKey(userId);
    const rawCached = worksPageCache.get(cacheKey) || readStoredWorksCache(userId);
    const cached = rawCached ? { ...rawCached, items: normalizeWorksItems(rawCached.items) } : null;
    if (cached && !options.force) {
      worksPageCache.set(cacheKey, cached);
      setItems(cached.items);
      setLoading(false);
      setError(null);
      if (Date.now() - cached.fetchedAt < WORKS_PAGE_CACHE_TTL_MS) return;
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const url = new URL("/api/assets", window.location.origin);
      url.searchParams.set("userId", userId);
      url.searchParams.set("tab", "generated");
      url.searchParams.set("source", "creation");
      const res = await fetch(url.toString());
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || "加载失败");
      const list = Array.isArray(json?.items) ? (json.items as AssetItem[]) : [];
      const normalized = normalizeWorksItems(list);
      const entry = { items: normalized, fetchedAt: Date.now() };
      worksPageCache.set(cacheKey, entry);
      writeStoredWorksCache(userId, entry);
      setItems(normalized);
    } catch (e: any) {
      setError(e?.message || text("workspaceFollowup.md1d044826a45"));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const requestKey = React.useMemo(
    () => (userId ? getWorksCacheKey(userId, typeFilter, timeFilter, sourceFilter, orderCacheKey) : ""),
    [sourceFilter, timeFilter, typeFilter, userId, orderCacheKey]
  );

  const buildAssetsUrl = React.useCallback(
    (options: { cursor?: string | null; count?: boolean } = {}) => {
      const url = new URL("/api/assets", window.location.origin);
      url.searchParams.set("userId", userId);
      url.searchParams.set("tab", "generated");
      url.searchParams.set("take", String(WORKS_PAGE_SIZE));
      url.searchParams.set("view", "cards");
      applyAssetSourceFilterSearchParams(url.searchParams, sourceFilter);
      url.searchParams.set("type", typeFilter);
      url.searchParams.set("order", order);
      if (options.cursor) url.searchParams.set("cursor", options.cursor);
      if (options.count) url.searchParams.set("count", "1");
      return url;
    },
    [sourceFilter, timeFilter, typeFilter, userId, orderCacheKey]
  );

  React.useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    setMediaCountsState({ key: mediaCountsKey, values: readMediaCounts(mediaCountsKey) });
    void Promise.all(["all", "image", "video", "audio"].map(async kind => {
      const url = buildAssetsUrl({ count: true }); url.searchParams.set("type", kind);
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      if (!controller.signal.aborted && typeof data.total === "number" && Number.isFinite(data.total) && data.total >= 0) {
        const values = { ...readMediaCounts(mediaCountsKey), [kind]: data.total };
        worksMediaCountsCache.set(mediaCountsKey, values);
        try { sessionStorage.setItem(WORKS_MEDIA_COUNTS_PREFIX + mediaCountsKey, JSON.stringify(values)); } catch {}
        setMediaCountsState({ key: mediaCountsKey, values });
      }
    })).catch(() => {});
    return () => controller.abort();
  // Media counts are independent of the selected media type and sort direction.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, sourceFilter, timeFilter, countsRevision, mediaCountsKey]);

  const load = React.useCallback(async (options: { force?: boolean; background?: boolean } = {}) => {
    if (!userId || !requestKey) return;
    if (options.force) setCountsRevision(value => value + 1);
    const refreshStartedAt = options.force && !options.background ? Date.now() : null;
    requestAbortRef.current?.abort();
    moreAbortRef.current?.abort();
    moreAbortRef.current = null;
    const version = ++requestVersionRef.current;
    const controller = new AbortController();
    requestAbortRef.current = controller;
    activeRequestKeyRef.current = requestKey;
    const isCurrent = () => !controller.signal.aborted && version === requestVersionRef.current && activeRequestKeyRef.current === requestKey;
    setError(null);
    setLoadMoreError(null);
    setLoadingMore(false);
    if (!options.background) setPendingHead([]);
    const resetScroll = resetScrollOnLoadRef.current;
    resetScrollOnLoadRef.current = false;
    if (resetScroll) {
      restoreScrollRef.current = 0;
      scrollPositionRef.current = 0;
      setRestoredSnapshot(undefined);
      scrollRootRef.current?.scrollTo({ top: 0 });
    }
    const rawCached = !options.force ? worksPageCache.get(requestKey) || readStoredWorksCache(userId, typeFilter, timeFilter, sourceFilter, orderCacheKey) : null;
    const cached = rawCached ? { ...rawCached, items: normalizeWorksItems(rawCached.items) } : null;
    if (cached) {
      worksPageCache.set(requestKey, cached);
      itemsRef.current = cached.items;
      setItems(cached.items);
      setCursor(cached.nextCursor || null);
      setHasMore(!!cached.hasMore);
      setTotal(cached.total ?? null);
      restoreScrollRef.current = resetScroll ? 0 : cached.scrollTop || 0;
      scrollPositionRef.current = resetScroll ? 0 : cached.scrollTop || 0;
      const layout = `${view}:${assetGridMeasureRef.current?.clientWidth || 0}:${tileSize}`;
      setRestoredSnapshot(!resetScroll && cached.layout === layout ? cached.snapshot : undefined);
      setLoading(false);
      setHasSettledInitialLoad(true);
    } else if (!options.force) {
      itemsRef.current = [];
      setItems([]);
      setTotal(null);
      setCursor(null);
      setHasMore(false);
      setRestoredSnapshot(undefined);
      scrollPositionRef.current = 0;
      scrollRootRef.current?.scrollTo({ top: 0 });
      setLoading(true);
    } else if (!options.background) setLoading(true);

    // Controllers invalidate results only: aborting fetch also rejects response
    // clones owned by browser inspectors. Stale results still fail isCurrent().
    // A slow or failed aggregate must never hold back usable cards.
    void fetch(buildAssetsUrl({ count: true }).toString(), { cache: "no-store" })
      .then(async response => response.ok ? response.json() : null)
      .then(json => {
        if (!isCurrent() || typeof json?.total !== "number") return;
        setTotal(json.total);
        const entry = worksPageCache.get(requestKey);
        if (entry) { entry.total = json.total; writeStoredWorksCache(userId, typeFilter, timeFilter, entry, sourceFilter, orderCacheKey); }
      }).catch(() => {});
    try {
      const result = await takeWorksEntry(buildAssetsUrl().toString(), userId, controller.signal, !!options.force);
      if (!isCurrent()) return;
      if (!result.ok) throw new Error(result.json?.error || "加载失败");
      const pageJson = result.json;
      const normalized = normalizeWorksItems(Array.isArray(pageJson?.items) ? pageJson.items : []);
      const existing = itemsRef.current;
      const existingKeys = new Set(existing.map(getWorkCardKey));
      const newItems = normalized.filter(item => !existingKeys.has(getWorkCardKey(item)));
      const deferNew = existing.length > 0 && scrollPositionRef.current > 100 && (options.background || !!cached);
      if (deferNew && newItems.length) setPendingHead(newItems);
      let refreshedItems = normalized;
      if (existing.length) refreshedItems = mergeWorksList(existing, deferNew ? normalized.filter(item => existingKeys.has(getWorkCardKey(item))) : normalized);
      const currentCache = worksPageCache.get(requestKey);
      // Refreshing the head must not reset the tail cursor after browsing multiple pages.
      const preserveTail = existing.length > 0 && !!currentCache;
      const refreshedCursor = preserveTail ? currentCache.nextCursor || null : pageJson?.nextCursor || null;
      const refreshedHasMore = preserveTail ? !!currentCache.hasMore : !!pageJson?.hasMore;
      const entry: WorksCacheEntry = { ...currentCache, items: refreshedItems, fetchedAt: Date.now(), nextCursor: refreshedCursor, hasMore: refreshedHasMore };
      worksPageCache.set(requestKey, entry);
      writeStoredWorksCache(userId, typeFilter, timeFilter, entry, sourceFilter, orderCacheKey);
      itemsRef.current = refreshedItems;
      setItems(refreshedItems);
      setCursor(refreshedCursor);
      setHasMore(refreshedHasMore);
    } catch (e: any) {
      if (isCurrent()) setError(e?.message || text("workspaceFollowup.md1d044826a45"));
    } finally {
      if (refreshStartedAt !== null) {
        const remainingSpinMs = WORKS_REFRESH_SPIN_MS - (Date.now() - refreshStartedAt);
        if (remainingSpinMs > 0) await new Promise<void>(resolve => window.setTimeout(resolve, remainingSpinMs));
      }
      if (isCurrent()) { setLoading(false); setHasSettledInitialLoad(true); }
    }
  // View/geometry is read only when restoring, and must not trigger a data reload.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildAssetsUrl, requestKey, sourceFilter, timeFilter, typeFilter, userId]);

  const loadMore = React.useCallback(async () => {
    if (!userId || !requestKey || !cursor || !hasMore || moreAbortRef.current || requestKey !== activeRequestKeyRef.current) return;
    const version = requestVersionRef.current;
    const controller = new AbortController();
    moreAbortRef.current = controller;
    const isCurrent = () => !controller.signal.aborted && version === requestVersionRef.current && activeRequestKeyRef.current === requestKey;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const res = await fetch(buildAssetsUrl({ cursor }).toString(), { cache: "no-store" });
      const json = await res.json();
      if (!isCurrent()) return;
      if (!res.ok) throw new Error(json?.error || "加载失败");
      const normalized = normalizeWorksItems(Array.isArray(json?.items) ? json.items : []);
      const nextCursor = typeof json?.nextCursor === "string" ? json.nextCursor : null;
      const nextHasMore = !!json?.hasMore && nextCursor !== cursor;
      const merged = mergeWorksList(itemsRef.current, normalized);
      const entry: WorksCacheEntry = { ...worksPageCache.get(requestKey), items: merged, fetchedAt: Date.now(), nextCursor, hasMore: nextHasMore };
      worksPageCache.set(requestKey, entry);
      writeStoredWorksCache(userId, typeFilter, timeFilter, entry, sourceFilter, orderCacheKey);
      itemsRef.current = merged;
      setItems(merged);
      setCursor(nextCursor);
      setHasMore(nextHasMore);
    } catch (e: any) {
      if (isCurrent()) setLoadMoreError(e?.message || text("workspaceFollowup.md1d044826a45"));
    } finally {
      if (moreAbortRef.current === controller) { moreAbortRef.current = null; setLoadingMore(false); }
    }
  }, [buildAssetsUrl, cursor, hasMore, requestKey, sourceFilter, timeFilter, typeFilter, userId]);

  React.useLayoutEffect(() => {
    if (!userId) return;
    void load();
    return () => { requestAbortRef.current?.abort(); moreAbortRef.current?.abort(); activeRequestKeyRef.current = ""; };
  }, [load, userId]);

  React.useEffect(() => {
    if (!userId) return;
    const onRefresh = () => { void load({ force: true, background: true }); };
    const onVisible = () => { if (document.visibilityState === "visible") onRefresh(); };
    window.addEventListener("works:refresh", onRefresh);
    window.addEventListener("focus", onRefresh);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(onVisible, 30000);
    return () => { clearInterval(timer); window.removeEventListener("works:refresh", onRefresh); window.removeEventListener("focus", onRefresh); document.removeEventListener("visibilitychange", onVisible); };
  }, [load, userId]);

  const displayItems = React.useMemo(() => [...items].sort((a, b) => {
    const delta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id - b.id;
    return order === "asc" ? delta : -delta;
  }), [items, order]);
  const selectedItems = items.filter(item => selected.has(item.id));
  React.useEffect(() => { setSelected(new Set()); }, [requestKey]);
  const displayGroups = React.useMemo(() => groupWorksByDate(displayItems, locale, text), [displayItems, locale, text]);
  const virtualAssetRows = React.useMemo(
    () => buildVirtualAssetRows(displayGroups, view === "grid" ? assetGridColumnCount : 1),
    [assetGridColumnCount, displayGroups, view]
  );

  React.useLayoutEffect(() => {
    const target = restoreScrollRef.current;
    if (target === null || !scrollRootElement || !virtualAssetRows.length) return;
    const frame = requestAnimationFrame(() => {
      scrollRootElement.scrollTop = target;
      scrollPositionRef.current = target;
      restoreScrollRef.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollRootElement, virtualAssetRows]);

  const rememberScroll = React.useCallback(() => {
    const entry = worksPageCache.get(requestKey);
    if (!entry) return;
    entry.scrollTop = scrollPositionRef.current;
    entry.layout = `${view}:${assetGridMeasureRef.current?.clientWidth || 0}:${tileSize}`;
    virtuosoRef.current?.getState(snapshot => { entry.snapshot = snapshot; });
    writeStoredWorksCache(userId, typeFilter, timeFilter, entry, sourceFilter, orderCacheKey);
  }, [requestKey, sourceFilter, timeFilter, typeFilter, userId, view, tileSize, orderCacheKey]);
  React.useLayoutEffect(() => () => rememberScroll(), [rememberScroll]);

  React.useEffect(() => {
    // rangeChanged already includes the rendered buffer; do not decode another
    // several screens of images beyond it. Only fetch the next metadata page.
    if (!loading && !loadingMore && !loadMoreError && virtualAssetRows.length - renderedRange.endIndex <= 3) void loadMore();
  }, [virtualAssetRows.length, renderedRange.endIndex, loading, loadingMore, loadMoreError, loadMore]);

  const detailOwnerRef = React.useRef(userId);
  detailOwnerRef.current = userId;
  React.useEffect(() => {
    detailRequestsRef.current.clear();
    setDetailItem(null); setDetailOpen(false);
  }, [userId]);
  const ensureWorkDetails = React.useCallback(async (item: AssetItem): Promise<AssetItem> => {
    if (!item.detailPending) return item;
    const loaded = itemsRef.current.find(current => current.id === item.id && !current.detailPending);
    if (loaded) return loaded;
    const pending = detailRequestsRef.current.get(item.id);
    if (pending) return pending;
    const request = (async () => {
      const response = await fetch(`/api/assets?detailId=${item.id}&source=all`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json.item) throw new Error(json.error || "详情加载失败，请重试");
      if (detailOwnerRef.current !== userId || isKnownDeletedGenerationId(item.id)) throw new Error("资产已失效");
      const full = normalizeWorksItems([{ ...json.item, detailPending: false }])[0];
      const entry = worksPageCache.get(requestKey);
      const patch = (current: AssetItem) => getWorkCardKey(current) === getWorkCardKey(item) ? full : current;
      if (activeRequestKeyRef.current === requestKey) {
        const next = itemsRef.current.map(patch);
        itemsRef.current = next;
        setItems(next);
      }
      if (entry) { entry.items = entry.items.map(patch); writeStoredWorksCache(userId, typeFilter, timeFilter, entry, sourceFilter, orderCacheKey); }
      setDetailItem(current => current?.id === item.id ? full : current);
      return full;
    })();
    detailRequestsRef.current.set(item.id, request);
    try { return await request; }
    finally { if (detailRequestsRef.current.get(item.id) === request) detailRequestsRef.current.delete(item.id); }
  }, [requestKey, sourceFilter, timeFilter, typeFilter, userId]);
  const detailWarmTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelDetailWarm = React.useCallback(() => { if (detailWarmTimer.current) clearTimeout(detailWarmTimer.current); }, []);
  const warmDetail = React.useCallback((item: AssetItem) => {
    cancelDetailWarm();
    detailWarmTimer.current = setTimeout(() => { void ensureWorkDetails(item).catch(() => {}); }, 150);
  }, [cancelDetailWarm, ensureWorkDetails]);
  React.useEffect(() => cancelDetailWarm, [cancelDetailWarm]);

  const deleteOne = React.useCallback(
    async (id: number) => {
      if (!userId) return;
      const target = items.find((x) => x.id === id) || null;
      const res = await fetch(`/api/assets/${encodeURIComponent(String(id))}?userId=${encodeURIComponent(userId)}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as any;
      if (!res.ok) throw new Error(json?.error || "删除失败");
      publishGenerationDeleted([id]);
      logAction("delete_output", "用户删除素材", {
        id,
        taskType: target?.type || "unknown",
        model: target?.model || null,
        sourcePage: "/works"
      });
      setItems((prev) => {
        const next = prev.filter((x) => x.id !== id);
        clearWorksCacheForUser(userId);
        return next;
      });
      setTotal((prev) => (typeof prev === "number" ? Math.max(prev - 1, 0) : prev));
      setCountsRevision(value => value + 1);
    },
    [items, logAction, userId]
  );

  const openDetail = React.useCallback((item: AssetItem) => {
    detailIdRef.current = item.id;
    setDetailItem(item);
    setDetailOpen(true);
    setDetailError(null);
    void ensureWorkDetails(item).catch(error => { if (detailIdRef.current === item.id) setDetailError(error.message); });
    if (desktopMode || !userId || item.type === "audio_gen" || item.displayKind === "audio") return;
    void (async () => {
      try {
        const res = await fetch(`/api/inspiration-templates/from-generation?generationId=${encodeURIComponent(String(item.id))}`, {
          cache: "no-store",
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok || !json?.success) return;
        const templateId = Number(json?.data?.templateId || 0);
        const sourceGenerationId = Number(json?.data?.sourceGenerationId || 0);
        setItems((prev) => {
          const next = prev.map((current) =>
            current.id === item.id
              ? {
                  ...current,
                  inspirationTemplateId: templateId > 0 ? templateId : null,
                  inspirationSourceGenerationId: sourceGenerationId > 0 ? sourceGenerationId : null,
                }
              : current
          );
          if (requestKey) {
            const currentCache = worksPageCache.get(requestKey);
            if (currentCache) {
              const entry = { ...currentCache, items: next };
              worksPageCache.set(requestKey, entry);
              writeStoredWorksCache(userId, typeFilter, timeFilter, entry, sourceFilter, orderCacheKey);
            }
          }
          return next;
        });
        setDetailItem((prev) =>
          prev && prev.id === item.id
            ? {
                ...prev,
                inspirationTemplateId: templateId > 0 ? templateId : null,
                inspirationSourceGenerationId: sourceGenerationId > 0 ? sourceGenerationId : null,
              }
            : prev
        );
      } catch {}
    })();
  }, [desktopMode, ensureWorkDetails, requestKey, sourceFilter, timeFilter, typeFilter, userId]);

  const closeDetail = React.useCallback(() => {
    detailIdRef.current = null;
    setDetailOpen(false);
  }, []);

  const downloadWork = React.useCallback(
    async (item: AssetItem) => {
      try { item = await ensureWorkDetails(item); }
      catch (error: any) { showInlineNotice(error.message); return; }
      const targets = buildDownloadTargets(item);
      if (!targets.length) return;
      if (targets.length === 1) {
        triggerDownload(targets[0]);
        logAction("download_output", "用户下载结果素材", {
          taskType: item.type,
          model: item.model || null,
          id: item.id,
          path: targets[0],
          mode: "single",
          sourcePage: "/works"
        });
        return;
      }
      targets.forEach((url, idx) => {
        window.setTimeout(() => triggerDownload(url, buildDownloadFilename("work", item.id, idx, url)), idx * 120);
      });
      logAction("download_output", "用户下载结果素材", {
        taskType: item.type,
        model: item.model || null,
        id: item.id,
        count: targets.length,
        mode: "group",
        sourcePage: "/works"
      });
    },
    [ensureWorkDetails, showInlineNotice, logAction]
  );

  const downloadInputImages = React.useCallback(
    async (item: AssetItem) => {
      try { item = await ensureWorkDetails(item); }
      catch (error: any) { showInlineNotice(error.message); return; }
      const targets = buildInputDownloadTargets(item);
      if (!targets.length) return;
      if (targets.length === 1) {
        triggerDownload(targets[0]);
        logAction("download_output", "用户下载输入素材", {
          taskType: item.type,
          model: item.model || null,
          id: item.id,
          path: targets[0],
          mode: "single_input",
          sourcePage: "/works"
        });
        return;
      }
      targets.forEach((url, idx) => {
        window.setTimeout(() => triggerDownload(url, buildDownloadFilename("input", item.id, idx, url)), idx * 120);
      });
      logAction("download_output", "用户下载输入素材", {
        taskType: item.type,
        model: item.model || null,
        id: item.id,
        count: targets.length,
        mode: "group_input",
        sourcePage: "/works"
      });
    },
    [ensureWorkDetails, showInlineNotice, logAction]
  );

  const applyTemplate = React.useCallback(
    async (item: AssetItem) => {
      if (!userId) return;
      const inFlight = applyInFlightRef.current.get(item.id);
      if (inFlight) {
        await inFlight;
        return;
      }
      setApplyingId(item.id);
      const task = (async () => {
      item = await ensureWorkDetails(item);
      const p = item.params || {};
      const inputImages = Array.isArray(item.inputImages) ? item.inputImages.filter(Boolean) : [];
      const prompt = sanitizePrompt(item.prompt);

      if (item.type === "face_swap") { return; } else if (item.type === "image_edit") {
        try {
          const model = String(p.model || item.model || "nano-banana-2");
          const isSeedream =
            model === "doubao-seedream-5.0-pro" || model === "doubao-seedream-5.0-lite" || model === "doubao-seedream-4.5" || model === "doubao-seedream-4.0";
          const isSeedreamPro = model === "doubao-seedream-5.0-pro";
          const seedream = p.seedream && typeof p.seedream === "object" ? (p.seedream as Record<string, any>) : null;
          const seedreamOutputMode = !isSeedreamPro && seedream?.outputMode === "group" ? "group" : "single";
          const seedreamOutputCount = String(seedream?.outputCount || "4");
          const seedreamWebSearch = !isSeedreamPro && seedream?.webSearch ? "on" : "off";
          writeEphemeralToolTemplate("image", userId, {
            prompt,
            model,
            aspectRatio: String(p.aspectRatio || "1:1"),
            resolution: String(p.resolution || (isSeedream ? "2K" : "1K")),
            seedreamOutputMode,
            seedreamOutputCount,
            seedreamWebSearch,
            googleThinkingLevel: p.googleThinkingLevel,
            googleSearchMode: p.googleSearchMode,
            gifSize: p.gifSize, frameCount: p.frameCount, frameDurationMs: p.frameDurationMs, seedream55: p.seedream55,
            ...(isSeedream55Model(model) ? { officialBackground: p.background || "auto", customSize: p.customSize } : {}),
            officialOutputFormat: p.outputFormat || p.apimart?.outputFormat || "png",
            gptImage25Mode: p.gptImage25Mode || p.reapiGptImage25?.mode || p.aicomingGptImage25?.mode || p.apimart?.mode || "flare",
            ...(supportsGptImage25Background(model) ? {
              officialBackground: p.background || p.apimart?.background || "auto",
              officialOutputFormat: p.outputFormat || p.apimart?.outputFormat || "png",
            } : {}),
            officialQuality:
              p.quality === "standard" || p.quality === "pro" || p.quality === "xhigh" || p.quality === "max" || p.quality === "low" || p.quality === "medium" || p.quality === "high" ? p.quality : "auto",
            officialModeration: "low",
            inputMedia: Array.isArray(p.inputMedia) ? p.inputMedia : [],
            imagePaths: Array.isArray(p.imagePaths) ? p.imagePaths : inputImages
          });
          localStorage.setItem("studio_last_tool_v1", "image");
          router.push("/studio?tool=image");
        } catch {}
      } else if (item.type === "video_gen" || item.type === "video_generate") {
        try {
          const { payload, notice, deferred } = await prepareVideoTemplateForStudio(userId, item, { timeoutMs: 1200 });
          commitVideoTemplateToStudio(userId, payload);
          if (notice) {
            showInlineNotice(notice);
            pushStudioVideoNotice(notice);
          }
          if (deferred) {
            void deferred.then(({ payload: finalizedPayload }) => {
              commitVideoTemplateToStudio(userId, finalizedPayload);
            });
          }
          router.push("/studio?tool=video");
        } catch {}
      }
      setAppliedId(item.id);
      window.setTimeout(() => setAppliedId((prev) => (prev === item.id ? null : prev)), 1200);
      })()
        .catch((error: any) => { showInlineNotice(error?.message || "套用失败，请重试"); })
        .finally(() => {
          applyInFlightRef.current.delete(item.id);
          setApplyingId((prev) => (prev === item.id ? null : prev));
        });
      applyInFlightRef.current.set(item.id, task);
      await task;
    },
    [ensureWorkDetails, pushStudioVideoNotice, router, showInlineNotice, userId]
  );

  const updateInspirationTemplateState = React.useCallback((assetId: number, templateId: number | null) => {
    setItems((prev) => {
      const next = prev.map((item) =>
        item.id === assetId
          ? { ...item, inspirationTemplateId: templateId, inspirationSourceGenerationId: templateId ? item.id : null }
          : item
      );
      if (requestKey) {
        const current = worksPageCache.get(requestKey);
        if (current) {
          const entry = { ...current, items: next };
          worksPageCache.set(requestKey, entry);
          if (userId) writeStoredWorksCache(userId, typeFilter, timeFilter, entry, sourceFilter, orderCacheKey);
        }
      }
      return next;
    });
    setDetailItem((prev) =>
      prev && prev.id === assetId
        ? { ...prev, inspirationTemplateId: templateId, inspirationSourceGenerationId: templateId ? prev.id : null }
        : prev
    );
  }, [requestKey, sourceFilter, timeFilter, typeFilter, userId]);

  const uploadInspirationTemplate = React.useCallback(
    async (item: AssetItem) => {
      if (!canUploadInspirationTemplate || inspirationBusyId) return;
      setInspirationBusyId(item.id);
      try {
        const res = await fetch("/api/inspiration-templates/from-generation", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ generationId: item.id }),
        });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok || !json?.success) throw new Error(json?.error || "上传灵感失败");
        const templateId = Number(json?.data?.id || 0);
        if (templateId > 0) updateInspirationTemplateState(item.id, templateId);
        invalidateHomeInspirationCache();
        showInlineNotice(json?.alreadyExists ? "该资产已传过灵感" : "已上传到灵感模板");
      } catch (e: any) {
        showInlineNotice(e?.message || "上传灵感失败");
      } finally {
        setInspirationBusyId((prev) => (prev === item.id ? null : prev));
      }
    },
    [canUploadInspirationTemplate, inspirationBusyId, showInlineNotice, updateInspirationTemplateState]
  );

  const deleteInspirationTemplate = React.useCallback(
    async (item: AssetItem) => {
      const templateId = Number(item.inspirationTemplateId || 0);
      if (!templateId || inspirationBusyId) return;
      setInspirationBusyId(item.id);
      try {
        const res = await fetch(`/api/inspiration-templates/${encodeURIComponent(String(templateId))}`, { method: "DELETE" });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok || !json?.success) throw new Error(json?.error || "删除灵感失败");
        updateInspirationTemplateState(item.id, null);
        setInspirationDeleteTarget(null);
        showInlineNotice("已删除灵感模板");
      } catch (e: any) {
        showInlineNotice(e?.message || "删除灵感失败");
      } finally {
        setInspirationBusyId((prev) => (prev === item.id ? null : prev));
      }
    },
    [inspirationBusyId, showInlineNotice, updateInspirationTemplateState]
  );

  const detailModalItem = detailItem
    ? ({
        ...detailItem,
        outputPaths: Array.isArray(detailItem.outputPaths) && detailItem.outputPaths.length
          ? detailItem.outputPaths
          : detailItem.localPath
            ? [detailItem.localPath]
            : []
      } as WorkDetailItem)
    : null;

  const handleContentScroll = React.useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const el = event.currentTarget;
      const now = performance.now();
      const previous = scrollSampleRef.current;
      const delta = el.scrollTop - previous.top;
      scrollPositionRef.current = el.scrollTop;
      if (now - previous.at > 100) {
        scrollSampleRef.current = { top: el.scrollTop, at: now, fast: Math.abs(delta) / Math.max(1, now - previous.at) > 2, direction: delta >= 0 ? 1 : -1 };
        rememberScroll();
      }
      const entry = worksPageCache.get(requestKey);
      if (entry) entry.scrollTop = el.scrollTop;
      const lookahead = el.clientHeight * (scrollSampleRef.current.fast ? 4 : 3);
      if (el.scrollHeight - el.scrollTop - el.clientHeight < lookahead && !loadMoreError) void loadMore();
    }, [loadMore, loadMoreError, rememberScroll, requestKey]
  );

  const loadFooter = (
    <div className="flex min-h-12 items-center justify-center py-4 text-xs text-[var(--app-muted)]">
      {loadingMore ? (
        <span className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /><UiText id="works.m1ff990d6627c" /></span>
      ) : loadMoreError ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          className="h-8 px-3 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] hover:bg-[var(--panel-3)] transition"
        ><UiText id="works.m4421bcd0ad93" /></button>
      ) : !hasMore && displayItems.length > 0 ? (
        <span><UiText id="works.mb6e1b952653b" /></span>
      ) : null}
    </div>
  );

  // 登录态尚未校验完成时显示加载占位，避免匿名空状态短暂闪烁。
  if (authLoading) {
    return (
      <AtomicPageReveal ready={!authLoading && hasSettledInitialLoad}>
      <WorksLoading tileSize={tileSize} />
      </AtomicPageReveal>
    )
  }

  const toolbarButton = "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 transition-colors hover:bg-[var(--input-bg)] hover:text-[var(--app-fg)] disabled:opacity-40 aria-pressed:bg-[var(--input-bg)] aria-pressed:text-[var(--app-fg)]";
  const toolbarIconButton = `${toolbarButton} w-7 justify-center !px-0`;
  return (
    <AtomicPageReveal ready={!authLoading && hasSettledInitialLoad}>
    <div className="relative flex-1 min-h-0 overflow-hidden flex flex-col bg-[var(--works-page-bg)]">
      <div ref={setScrollRootNode} id="works-asset-list" onScroll={handleContentScroll} className="auto-hide-scroll-area flex-1 min-h-0 overflow-y-auto">
      <div className="sticky top-0 z-20 bg-[var(--works-page-bg)] px-6">
        <div className="-mx-6 flex min-h-16 items-center gap-3 border-b border-[var(--border)] px-6 py-3">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--app-fg)]"><UiText id="works.m5f45bb826b16" /></h1>
          <span className="text-xs tabular-nums text-[var(--app-muted)]">{total ?? displayItems.length}<UiText id="works.mf9d529eacdf3" /></span>
        </div>
        <div className="flex min-h-16 flex-wrap items-center gap-4 py-3 text-sm">
          <AssetSourceSelect value={sourceFilter} onChange={setSourceFilter} disabled={batchBusy} compact variant="toolbar" />
          <span className="h-4 border-l border-[var(--border)]" />
          <UiProps ids={{"aria-label":["works.mc7da197eeb31"]}}><div className="flex items-center gap-3" aria-label="works.mc7da197eeb31">
            {([{ key: "all", label: text("workspaceFollowup.m5c55a67935af") }, { key: "image", label: text("workspaceFollowup.md24c10d37db0") }, { key: "video", label: text("workspaceFollowup.mc20f7618d330") }, { key: "audio", label: text("workspaceFollowup.m296c632ec857") }] as const).map(option => <button type="button" key={option.key} disabled={batchBusy} aria-pressed={typeFilter === option.key} onClick={() => setTypeFilter(option.key)} className={`flex items-center gap-1.5 rounded-md px-1 py-1.5 ${typeFilter === option.key ? "font-semibold text-[var(--app-fg)]" : "text-[var(--app-muted)] hover:text-[var(--app-fg)]"}`}>{option.label}<span className="rounded bg-[var(--panel-2)] px-1 text-[11px] font-normal tabular-nums">{mediaCounts[option.key] ?? "—"}</span></button>)}
          </div></UiProps>
          <div className="ml-auto flex flex-wrap items-center gap-0.5 rounded-[11px] border border-[var(--border)] bg-[var(--panel-2)] p-[3px] text-[var(--app-muted)]">
            <UiProps ids={{"aria-label":["works.ma272ef8652c4"]}}><button type="button" aria-label="works.ma272ef8652c4" disabled={loading || batchBusy} onClick={() => void load({ force: true })} className={toolbarIconButton}><RefreshCw size={15} className={loading ? "animate-[spin_600ms_linear_infinite]" : ""} /></button></UiProps>
            <button type="button" disabled={batchBusy} onClick={() => { resetScrollOnLoadRef.current = true; setOrder(order === "desc" ? "asc" : "desc"); }} className={toolbarButton}>{order === "desc" ? <ArrowDownWideNarrow size={16} /> : <ArrowUpWideNarrow size={16} />}{order === "desc" ? <UiText id="works.m21039f948d40" /> : <UiText id="works.maef8a3f8db51" />}</button>
            <span className="mx-0.5 h-3.5 border-l border-[var(--border)]" />
            <div className="flex h-7 items-center gap-2 px-2">
              <Grid3X3 size={15} />
              <UiProps ids={{"aria-label":["works.m1e6d0649327b"]}}><input aria-label="works.m1e6d0649327b" type="range" min={96} max={224} step={16} value={tileSize} className="h-1 w-20 accent-[var(--app-fg)]" onChange={event => { const size = Number(event.target.value); setTileSize(size); setRestoredSnapshot(undefined); try { localStorage.setItem("works-tile-size", String(size)); } catch {} }} /></UiProps>
              <Grid2X2 size={15} />
            </div>
            <UiProps ids={{"aria-label":["works.md56220435194","works.ma35441db5cd1"]}}><button type="button" aria-label={view === "grid" ? "works.md56220435194" : "works.ma35441db5cd1"} className={`${toolbarIconButton}`} onClick={() => setView(view === "grid" ? "list" : "grid")}>{view === "grid" ? <ListChecks size={15} /> : <ImageIcon size={15} />}</button></UiProps>
            <span className="mx-0.5 h-3.5 border-l border-[var(--border)]" />
            <button type="button" aria-pressed={batch} disabled={batchBusy} onClick={() => { setBatch(!batch); setSelected(new Set()); }} className={toolbarButton}><ListChecks size={16} />{batch ? <UiText id="works.m571e8b9e66f2" /> : <UiText id="works.m10c9416459ad" />}</button>
          </div>
        </div>
        {batch && <div className="flex flex-wrap items-center gap-4 border-t border-[var(--border)] py-3 text-sm text-[var(--app-muted)]">
          <span><UiText id="works.m52c963128eab" />{selectedItems.length}</span>
          <button type="button" disabled={!selectedItems.length || batchBusy} className="flex items-center gap-1.5 disabled:opacity-40" onClick={async () => { setBatchBusy(true); try { for (const item of selectedItems) await downloadWork(item); } finally { setBatchBusy(false); } }}><Download size={15} /><UiText id="works.m4673a2306165" /></button>
          <button type="button" disabled={!selectedItems.length || batchBusy} className="flex items-center gap-1.5 disabled:opacity-40" onClick={() => setBatchDeleteOpen(true)}><Trash2 size={15} /><UiText id="works.m2f9daa828907" /></button>
        </div>}
      </div>

      <div className="px-6 py-6">
        {error ? <button type="button" className="text-sm text-rose-300 mb-4" onClick={() => void load({ force: true })}>{localizeError(error)}<UiText id="works.m0132b3ca821c" /></button> : null}
        {!items.length && !error && (loading || !hasSettledInitialLoad) ? <WorksGridSkeleton tileSize={tileSize} /> : null}
        {!loading && !error && hasSettledInitialLoad && !items.length ? <div className="py-8 text-sm text-[var(--app-muted)]"><UiText id="works.m3c687e1603a1" /></div> : null}
        {pendingHead.length ? <button type="button" className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-4 py-2 text-sm shadow-[var(--shadow-2)]" onClick={() => {
          const next = mergeWorksList(itemsRef.current, pendingHead);
          itemsRef.current = next; setItems(next); setPendingHead([]);
          const entry = worksPageCache.get(requestKey);
          if (entry) { entry.items = next; entry.scrollTop = 0; }
          scrollPositionRef.current = 0;
          scrollRootRef.current?.scrollTo({ top: 0 });
        }}><UiText id="works.ma6815db95ff5" />{pendingHead.length}<UiText id="works.mb304ac0da903" /></button> : null}

        <div ref={assetGridMeasureRef}>
          {scrollRootElement && hasSettledInitialLoad ? (
            view === "grid" ? <StableAssetGrid
              rows={virtualAssetRows}
              columns={assetGridColumnCount}
              scrollParent={scrollRootElement}
              onRangeChanged={setRenderedRange}
              footer={loadFooter}
              renderHeading={row => (                    <div className="mb-3 flex items-center gap-1.5">
                      {batch && <DateGroupCheckbox date={row.groupLabel!} ids={displayGroups.find(group => group.key === row.groupKey)?.items.map(item => item.id) || []} selected={selected} onChange={setSelected} disabled={batchBusy || loading} />}
                      <h2 className="text-sm font-semibold text-[var(--app-fg)]">{row.groupLabel}</h2>
                      <span className="text-[11px] font-normal tabular-nums leading-none text-[var(--app-muted)]">
                        {row.groupCount}{<UiText id="works.m49ccde43a154" />}
                      </span>
                    </div>)}
              renderItem={(it, rowIndex) => {
                const kind = it.displayKind || inferKind(it.localPath);
                        const displayCandidates = getWorkDisplayCandidates(it);
                        return (
                          <div key={getWorkCardKey(it)} className="group relative leading-none">
                            {batch && <input type="checkbox" aria-label={text("workspaceFollowup.m68c98b32b61d", { v0: it.id })} checked={selected.has(it.id)} disabled={batchBusy} onChange={() => toggleSelected(it.id)} className="absolute right-2 top-2 z-10 h-4 w-4 accent-[var(--app-fg)]" />}
                            <UiProps ids={{"aria-label":["works.m7414ce2cf09f"]}}><button
                              type="button"
                              onPointerEnter={() => warmDetail(it)}
                              onPointerLeave={cancelDetailWarm}
                              onFocus={() => warmDetail(it)}
                              onBlur={cancelDetailWarm}
                              onClick={() => { if (!batchBusy) batch ? toggleSelected(it.id) : openDetail(it); }}
                              className="relative block w-full aspect-square overflow-hidden rounded-lg text-left group/media"
                              aria-label="works.m7414ce2cf09f"
                            >
                              {it.localPath ? (
                                kind === "audio" ? (
                                  <div className="flex h-full w-full flex-col items-center justify-center gap-3 border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] rounded-lg">
                                    <Music2 className="h-10 w-10" />
                                    <span className="text-sm"><UiText id="works.m296c632ec857" /></span>
                                  </div>
                                ) : kind === "video" ? (
                                  <>
                                    <HoverPreviewVideo
                                      src={it.localPath}
                                      eager={rowIndex < 3}
                                      deferFallback
                                      posterSrc={displayCandidates[0]}
                                      posterCandidates={displayCandidates}
                                      className="block h-full w-full object-cover"
                                    />
                                    <div className="absolute inset-0 flex items-center justify-center bg-[var(--overlay)] opacity-0 group-hover/media:opacity-100 transition-opacity">
                                      <div className="h-16 w-16 rounded-full bg-[var(--panel-bg)]/90 border border-[var(--border)] flex items-center justify-center">
                                        <div className="ml-1 w-0 h-0 border-l-[16px] border-l-[var(--app-fg)] border-y-[10px] border-y-transparent" />
                                      </div>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <ResilientImage
                                      candidates={displayCandidates}
                                      alt=""
                                      className="block h-full w-full object-cover"
                                      draggable={false}
                                      loading={rowIndex < 3 ? "eager" : "lazy"}
                                      decoding="async"
                                      fetchPriority={rowIndex < 2 ? "high" : "auto"}
                                      cacheInMemory={false}
                                      warmOnLoad={false}
                                    />
                                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-[var(--overlay)] via-transparent to-transparent" />
                                  </>
                                )
                              ) : null}
                            </button></UiProps>
                          </div>
                        );
              }}
            /> :
            <Virtuoso<VirtualAssetRow, AssetVirtuosoContext>
              key={`${requestKey}:${view}`}
              ref={virtuosoRef}
              restoreStateFrom={restoredSnapshot}
              rangeChanged={range => setRenderedRange(current => current.startIndex === range.startIndex && current.endIndex === range.endIndex ? current : range)}
              data={virtualAssetRows}
              customScrollParent={scrollRootElement}
              computeItemKey={(_, row) => row.key}
              increaseViewportBy={{ top: Math.min(480, viewportHeight), bottom: Math.min(960, viewportHeight) }}
              overscan={320}
              endReached={() => void loadMore()}
              components={ASSET_VIRTUOSO_COMPONENTS}
              context={{ footer: loadFooter }}
              itemContent={(rowIndex, row) => (
                <section className={row.groupLabel && !row.firstGroup ? "pt-8" : ""}>
                  {row.groupLabel ? (
                    <div className="mb-3 flex items-center gap-1.5">
                      {batch && <DateGroupCheckbox date={row.groupLabel!} ids={displayGroups.find(group => group.key === row.groupKey)?.items.map(item => item.id) || []} selected={selected} onChange={setSelected} disabled={batchBusy || loading} />}
                      <h2 className="text-sm font-semibold text-[var(--app-fg)]">{row.groupLabel}</h2>
                      <span className="text-[11px] font-normal tabular-nums leading-none text-[var(--app-muted)]">
                        {row.groupCount}{<UiText id="works.m49ccde43a154" />}
                      </span>
                    </div>
                  ) : null}

                  {(
                    <div className="space-y-3 pb-3">
                      {row.items.map((it) => {
                        const kind = it.displayKind || inferKind(it.localPath);
                        const title = formatName(it, text);
                        const displayCandidates = getWorkDisplayCandidates(it);
                        return (
                          <div
                            key={getWorkCardKey(it)}
                            className="rounded-[22px] border border-[var(--border)] bg-[var(--panel-bg)] hover:bg-[var(--panel-2)] transition shadow-[var(--shadow-2)] p-3 flex items-center gap-3"
                          >
                            {batch && <input type="checkbox" aria-label={text("workspaceFollowup.m68c98b32b61d", { v0: it.id })} checked={selected.has(it.id)} disabled={batchBusy} onChange={() => toggleSelected(it.id)} />}
                            <UiProps ids={{"aria-label":["works.md0a4006a26b6"]}}><button
                              type="button"
                              onClick={() => {
                                setActive(it);
                                setZoomOpen(true);
                              }}
                              className="h-16 w-28 shrink-0 rounded-2xl overflow-hidden border border-[var(--border)] bg-[var(--input-bg)] flex items-center justify-center relative group/thumb"
                              aria-label="works.md0a4006a26b6"
                            >
                              {it.localPath ? (
                                kind === "audio" ? (
                                  <Music2 className="h-7 w-7 text-[var(--app-muted)]" />
                                ) : kind === "video" ? (
                                  <>
                                    {displayCandidates.length ? (
                                      <ResilientImage
                                        candidates={displayCandidates}
                                        alt=""
                                        className="block h-full w-full object-cover"
                                        draggable={false}
                                        loading={rowIndex < 3 ? "eager" : "lazy"}
                                        decoding="async"
                                        fetchPriority={rowIndex < 2 ? "high" : "auto"}
                                        cacheInMemory={false}
                                        warmOnLoad={false}
                                      />
                                    ) : (
                                      <HoverPreviewVideo
                                        src={it.localPath}
                                        deferFallback
                                        eager={rowIndex < 3}
                                        posterSrc={displayCandidates[0]}
                                        posterCandidates={displayCandidates}
                                        className="block h-full w-full object-cover"
                                      />
                                    )}
                                    <div className="absolute inset-0 flex items-center justify-center bg-[var(--overlay)] opacity-0 group-hover/thumb:opacity-100 transition-opacity">
                                      <div className="ml-0.5 w-0 h-0 border-l-[8px] border-l-[var(--app-fg)] border-y-[5px] border-y-transparent" />
                                    </div>
                                  </>
                                ) : (
                                  <ResilientImage
                                    candidates={displayCandidates}
                                    alt=""
                                    className="block h-full w-full object-cover"
                                    draggable={false}
                                    loading={rowIndex < 3 ? "eager" : "lazy"}
                                    decoding="async"
                                    fetchPriority={rowIndex < 2 ? "high" : "auto"}
                                    cacheInMemory={false}
                                    warmOnLoad={false}
                                  />
                                )
                              ) : null}
                            </button></UiProps>
                            <div className="min-w-0 flex-1">
                              <button
                                type="button"
                                onPointerEnter={() => warmDetail(it)}
                              onPointerLeave={cancelDetailWarm}
                              onFocus={() => warmDetail(it)}
                              onBlur={cancelDetailWarm}
                              onClick={() => { if (!batchBusy) batch ? toggleSelected(it.id) : openDetail(it); }}
                                className="text-sm text-[var(--app-fg)] font-medium whitespace-normal break-words text-left"
                                title={title}
                              >
                                {title}
                              </button>
                              <div className="mt-1 text-xs font-medium text-[var(--app-muted)] flex items-center gap-2">
                                <span>{it.createdAt ? new Date(it.createdAt).toLocaleString(locale === "en" ? "en-US" : undefined, locale === "en" ? { dateStyle: "medium", timeStyle: "short" } : undefined) : ""}</span>
                                <span className="ml-auto">ID: {it.id}</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => void downloadWork(it)}
                              className="h-9 px-3 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] text-sm font-medium text-[var(--app-fg)] hover:bg-[var(--panel-3)] transition flex items-center gap-2"
                            >
                              <Download className="h-4 w-4" /><UiText id="works.m4673a2306165" /></button>
                            {kind !== "audio" && it.type !== "face_swap" ? <button
                              type="button"
                              onClick={() => applyTemplate(it)}
                              disabled={applyingId === it.id}
                              className="h-9 px-3 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] text-sm font-medium text-[var(--app-fg)] hover:bg-[var(--panel-3)] disabled:opacity-60 disabled:pointer-events-none transition flex items-center gap-2"
                            >
                              {applyingId === it.id ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin" /><UiText id="works.m66d5dd404721" /></>
                              ) : appliedId === it.id ? <UiText id="works.mc0edb04e0855" /> : <UiText id="works.mbffa36c49a3a" />}
                            </button> : null}
                            <button
                              type="button"
                              onClick={() => {
                                void copyToClipboard(it).finally(() => {
                                  setCopiedId(it.id);
                                  window.setTimeout(() => setCopiedId((prev) => (prev === it.id ? null : prev)), 1200);
                                });
                              }}
                              className="h-9 px-3 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] text-sm font-medium text-[var(--app-fg)] hover:bg-[var(--panel-3)] transition flex items-center gap-2"
                            >
                              <Copy className="h-4 w-4" />
                              {copiedId === it.id ? <UiText id="works.m8f6f8d979c98" /> : <UiText id="works.m63d90d977348" />}
                            </button>
                            <button
                              type="button"
                              onPointerEnter={() => warmDetail(it)}
                              onPointerLeave={cancelDetailWarm}
                              onFocus={() => warmDetail(it)}
                              onBlur={cancelDetailWarm}
                              onClick={() => { if (!batchBusy) batch ? toggleSelected(it.id) : openDetail(it); }}
                              className="h-9 px-3 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] text-sm font-medium text-[var(--app-fg)] hover:bg-[var(--panel-3)] transition flex items-center gap-2"
                            ><UiText id="works.m979a332955c8" /></button>
                            <UiProps ids={{"aria-label":["works.m2f9daa828907"]}}><button
                              type="button"
                              onClick={() => void deleteOne(it.id)}
                              className="h-9 w-9 rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-700 hover:bg-rose-500/15 transition flex items-center justify-center"
                              aria-label="works.m2f9daa828907"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button></UiProps>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}
            />
          ) : null}
        </div>
      </div>
      </div>

      <ScrollToTopButton scrollContainerRef={scrollRootRef} />
      <AutoHideScrollbar scrollRef={scrollRootRef} />

      <MediaLightbox
        open={zoomOpen}
        src={active?.localPath || null}
        kind={active?.localPath ? inferKind(active.localPath) : "image"}
        title={active ? formatName(active, text) : ""}
        onClose={() => setZoomOpen(false)}
      />
      <WorkDetailModal
        parameterView="asset"
        open={detailOpen && !!detailModalItem}
        item={detailModalItem}
        detailsLoading={!!detailItem?.detailPending && !detailError}
        detailsError={detailError ? localizeError(detailError) : detailError}
        onRetryDetails={() => { if (detailItem) { setDetailError(null); void ensureWorkDetails(detailItem).catch(error => setDetailError(error.message)); } }}
        onClose={closeDetail}
        onDownloadInput={(it) => void downloadInputImages(it as AssetItem)}
        onDownloadOutput={(it) => {
          void downloadWork(it as AssetItem);
        }}
        onApplyTemplate={(it) => {
          void applyTemplate(it as AssetItem);
        }}
        onUploadInspiration={!desktopMode && (canUploadInspirationTemplate || Boolean(detailModalItem?.inspirationTemplateId)) ? (it) => {
          void uploadInspirationTemplate(it as AssetItem);
        } : undefined}
        onDeleteInspiration={desktopMode ? undefined : (it) => {
          setInspirationDeleteTarget(it as AssetItem);
        }}
        onDelete={(it) => {
          setDeleteTarget(it as AssetItem);
        }}
        applying={!!detailModalItem && applyingId === detailModalItem.id}
        applied={!!detailModalItem && appliedId === detailModalItem.id}
        uploadingInspiration={!!detailModalItem && inspirationBusyId === detailModalItem.id}
        inspirationUploaded={!!detailModalItem && Boolean(detailModalItem.inspirationTemplateId)}
      />
      <UiProps ids={{"title":["works.md57eace24d78"],"confirmText":["works.m2f9daa828907"]}}><ConfirmDialog open={batchDeleteOpen} title="works.md57eace24d78" description={text("workspaceFollowup.m549070537b37", { v0: selectedItems.length })} danger confirmText="works.m2f9daa828907" confirmDisabled={batchBusy || !selectedItems.length} onClose={() => { if (!batchBusy) setBatchDeleteOpen(false); }} onConfirm={async () => {
        setBatchBusy(true);
        try {
          for (const item of selectedItems) { await deleteOne(item.id); setSelected(current => { const next = new Set(current); next.delete(item.id); return next; }); }
          setBatchDeleteOpen(false); await load({ force: true });
        } catch (cause: any) { showInlineNotice(cause?.message || "删除失败，请重试"); return false; }
        finally { setBatchBusy(false); }
      }} /></UiProps>
      <UiProps ids={{"title":["works.mf42f9bdb21af"],"confirmText":["works.ma3ea3c17b401"],"cancelText":["works.m2cd0f3be8738"]}}><ConfirmDialog
        open={!!deleteTarget}
        title="works.mf42f9bdb21af"
        description={deleteTarget ? text("workspaceFollowup.m70e3596b6ac6", { v0: formatName(deleteTarget, text) }) : ""}
        confirmText="works.ma3ea3c17b401"
        cancelText="works.m2cd0f3be8738"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await deleteOne(deleteTarget.id);
            setDeleteTarget(null);
            closeDetail();
          } catch {
            showInlineNotice("删除失败，请稍后重试");
            return false;
          }
        }}
      /></UiProps>
      {!desktopMode && <UiProps ids={{"title":["works.mcf8e138d386d"],"confirmText":["works.ma3ea3c17b401"],"cancelText":["works.m2cd0f3be8738"]}}><ConfirmDialog
        open={!!inspirationDeleteTarget}
        title="works.mcf8e138d386d"
        description={inspirationDeleteTarget ? text("workspaceFollowup.m775280db9968", { v0: formatName(inspirationDeleteTarget, text) }) : ""}
        confirmText="works.ma3ea3c17b401"
        cancelText="works.m2cd0f3be8738"
        danger
        onClose={() => setInspirationDeleteTarget(null)}
        onConfirm={async () => {
          if (!inspirationDeleteTarget) return;
          await deleteInspirationTemplate(inspirationDeleteTarget);
        }}
      /></UiProps>}
      {inlineNotice ? (
        <div className="pointer-events-none fixed left-1/2 top-5 z-[120] -translate-x-1/2 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)]/95 px-3 py-2 text-xs text-[var(--app-fg)] shadow-[var(--shadow-2)] backdrop-blur-sm">
          {uiLabel(inlineNotice)}
        </div>
      ) : null}
    </div>
    </AtomicPageReveal>
  );
}
