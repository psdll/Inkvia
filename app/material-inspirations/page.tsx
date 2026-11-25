"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Lightbulb,
  Loader2,
  RefreshCw,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { useDesktopMode } from "@/components/system/desktop-mode";
import { AppVideoPlayer } from "@/components/ui/app-video-player";
import { HoverPreviewVideo } from "@/components/ui/hover-preview-video";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { ResilientImage, warmResilientImageCandidatesBatch } from "@/components/ui/resilient-image";
import { useAutoPaginate } from "@/hooks/use-auto-paginate";
import { getWarmParams } from "@/lib/image-cache-config";
import { buildMediaOriginalUrl, buildMediaPreviewCandidates, buildMediaProxyUrl, isVideoMediaUrl } from "@/lib/media-url";
import { MATERIAL_ASSET_UNCATEGORIZED } from "@/lib/material-assets";
import { AtomicPageReveal } from "@/components/layout/atomic-page-reveal";

type MaterialMediaItem = {
  id: string;
  originalUrl: string;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  mime: string | null;
  size: number | null;
};

type MaterialItem = {
  id: number;
  category: string | null;
  title: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  previewUrl?: string | null;
  previewWidth?: number | null;
  previewHeight?: number | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  mediaCount?: number;
  selectedMediaId?: string | null;
  mediaItems?: MaterialMediaItem[];
  creatorName?: string | null;
  inspiration?: string | null;
  createdAt: string;
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
};

type CacheEntry = {
  items: MaterialItem[];
  pagination: Pagination;
  fetchedAt: number;
};

type SaveState = "idle" | "saving" | "saved" | "error";

const PAGE_SIZE = 60;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_INSPIRATION_LEN = 500;
const PREVIEW_IMAGE_MIN_SCALE = 0.25;
const PREVIEW_IMAGE_MAX_SCALE = 6;
const CACHE_PREFIX = "material_inspirations_page_cache_v3";
const inspirationPageCache = new Map<string, CacheEntry>();
const aspectRatioCache = new Map<string, number>();

function localYmd(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const ASSET_WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function assetDayKey(raw?: string | null): string {
  if (!raw) return "未知";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "未知";
  return localYmd(d);
}

function dayHeaderParts(key: string, locale: string, text: ReturnType<typeof useUiLocale>["text"]): { date: string; rel: string } {
  if (!key || key === "未知") return { date: text("workspaceFollowup.ma3f1cde9f177"), rel: "" };
  const today = localYmd(new Date());
  const yesterday = localYmd(new Date(Date.now() - 86400000));
  const d = new Date(`${key}T00:00:00`);
  const weekday = Number.isNaN(d.getTime()) ? "" : ASSET_WEEKDAYS[d.getDay()];
  if (locale === "en") return {
    date: d.toLocaleDateString("en-US", { dateStyle: "medium" }),
    rel: key === today ? text("workspaceFollowup.md5f5a7a01073") : key === yesterday ? text("workspaceFollowup.m0c184871f658") : d.toLocaleDateString("en-US", { weekday: "short" }),
  };
  const rel = key === today ? "今天" : key === yesterday ? "昨天" : weekday;
  return { date: key, rel };
}

function materialCreatedTime(item: MaterialItem): number {
  const value = new Date(item.createdAt).getTime();
  return Number.isNaN(value) ? 0 : value;
}

function groupMaterialItemsByDay(items: MaterialItem[], locale: string, text: ReturnType<typeof useUiLocale>["text"]) {
  const grouped = new Map<string, MaterialItem[]>();
  const sorted = [...items].sort((a, b) => {
    const diff = materialCreatedTime(b) - materialCreatedTime(a);
    return diff || b.id - a.id;
  });
  for (const item of sorted) {
    const key = assetDayKey(item.createdAt);
    const list = grouped.get(key);
    if (list) list.push(item);
    else grouped.set(key, [item]);
  }

  let startIndex = 0;
  return Array.from(grouped.entries())
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([key, groupItems]) => {
      const header = dayHeaderParts(key, locale, text);
      const group = { key, ...header, items: groupItems, startIndex };
      startIndex += groupItems.length;
      return group;
    });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getCacheKey(userId: string, activeGroup: string, dateFrom: string, dateTo: string) {
  return `${userId}|${activeGroup}|${dateFrom}|${dateTo}`;
}

function getStorageKey(cacheKey: string) {
  return `${CACHE_PREFIX}_${encodeURIComponent(cacheKey)}`;
}

function normalizePagination(raw: Partial<Pagination> | undefined, fallbackPage = 1): Pagination {
  return {
    page: Math.max(1, Number(raw?.page) || fallbackPage),
    pageSize: Math.max(1, Number(raw?.pageSize) || PAGE_SIZE),
    total: Math.max(0, Number(raw?.total) || 0),
    totalPages: Math.max(1, Number(raw?.totalPages) || 1),
    hasMore: Boolean(raw?.hasMore),
  };
}

function readStoredCache(cacheKey: string): CacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(getStorageKey(cacheKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CacheEntry> | null;
    if (!parsed || !Array.isArray(parsed.items) || !parsed.pagination) return null;
    return {
      items: parsed.items as MaterialItem[],
      pagination: normalizePagination(parsed.pagination),
      fetchedAt: Number(parsed.fetchedAt) || 0,
    };
  } catch {
    return null;
  }
}

function writeStoredCache(cacheKey: string, entry: CacheEntry) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(getStorageKey(cacheKey), JSON.stringify(entry));
  } catch {}
}

function materialMediaItems(item: MaterialItem): MaterialMediaItem[] {
  if (Array.isArray(item.mediaItems) && item.mediaItems.length) return item.mediaItems;
  if (!item.imageUrl) return [];
  return [{
    id: item.selectedMediaId || `asset-${item.id}-cover`,
    originalUrl: item.imageUrl,
    thumbnailUrl: item.thumbnailUrl || null,
    previewUrl: item.previewUrl || null,
    mime: item.mimeType || null,
    size: item.sizeBytes || null,
  }];
}

function previewCandidates(item: MaterialItem, size = 600) {
  const raw = [item.previewUrl, item.imageUrl, item.thumbnailUrl].filter(Boolean);
  return Array.from(
    new Set(
      raw
        .flatMap((url) => buildMediaPreviewCandidates(url, { width: size, height: size, mode: "cover" }))
        .map((url) => buildMediaProxyUrl(url) || url)
        .filter(Boolean)
    )
  );
}

function cardImageCandidates(item: MaterialItem) {
  const sized = buildMediaPreviewCandidates(item.imageUrl, { width: 600, height: 600, mode: "cover" })
    .map((url) => buildMediaProxyUrl(url) || url)
    .filter(Boolean);
  return Array.from(new Set([...sized, ...previewCandidates(item, 600)]));
}

function materialMediaPreviewCandidates(media: MaterialMediaItem, size = 600) {
  return Array.from(
    new Set(
      [media.previewUrl, media.originalUrl, media.thumbnailUrl]
        .filter(Boolean)
        .flatMap((raw) => buildMediaPreviewCandidates(raw, { width: size, height: size, mode: "cover" }))
        .map((url) => buildMediaProxyUrl(url) || url)
        .filter(Boolean)
    )
  );
}

function originalUrl(item: MaterialItem) {
  const raw = buildMediaOriginalUrl(item.imageUrl || item.previewUrl || item.thumbnailUrl || "");
  return buildMediaProxyUrl(raw) || raw;
}

function mediaOriginalUrl(media: MaterialMediaItem) {
  const raw = buildMediaOriginalUrl(media.originalUrl || media.previewUrl || media.thumbnailUrl || "");
  return buildMediaProxyUrl(raw) || raw;
}

function isMaterialVideo(item: MaterialItem, src?: string | null) {
  return Boolean(
    String(item.mimeType || "").toLowerCase().startsWith("video/") ||
      isVideoMediaUrl(src || item.imageUrl || item.previewUrl || item.thumbnailUrl || "")
  );
}

function aspectStorageKey(id: number) {
  return `material_inspiration_aspect_ratio_v1_${id}`;
}

function readStoredAspectRatio(id: number) {
  if (typeof window === "undefined") return null;
  try {
    const value = Number(window.sessionStorage.getItem(aspectStorageKey(id)));
    return Number.isFinite(value) && value > 0.2 && value < 6 ? value : null;
  } catch {
    return null;
  }
}

function rememberAspectRatio(id: number, width: number, height: number) {
  if (!id || width <= 0 || height <= 0) return;
  const ratio = Math.min(4, Math.max(0.25, width / height));
  aspectRatioCache.set(String(id), ratio);
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(aspectStorageKey(id), String(ratio));
  } catch {}
}

function getAspectRatio(item: MaterialItem) {
  const width = Number(item.previewWidth);
  const height = Number(item.previewHeight);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    const ratio = Math.min(4, Math.max(0.25, width / height));
    aspectRatioCache.set(String(item.id), ratio);
    return ratio;
  }
  return aspectRatioCache.get(String(item.id)) || readStoredAspectRatio(item.id) || 1;
}

function warmPreviewBatch(list: MaterialItem[]) {
  if (!list.length) return;
  const params = getWarmParams("library");
  if (!params) return;
  const groups = list.map((item) => (isMaterialVideo(item) ? previewCandidates(item, 600) : cardImageCandidates(item)));
  warmResilientImageCandidatesBatch(groups, params);
}

function mergeUniqueById(current: MaterialItem[], incoming: MaterialItem[]) {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  })];
}

export default function MaterialInspirationsPage() {
  const { user, loading: authLoading, openLoginModal } = useAuth();
  const desktopMode = useDesktopMode();
  const [items, setItems] = React.useState<MaterialItem[]>([]);
  const [groups, setGroups] = React.useState<string[]>([]);
  const [activeGroup, setActiveGroup] = React.useState("all");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [pagination, setPagination] = React.useState<Pagination>({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1, hasMore: false });
  const [loading, setLoading] = React.useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = React.useState(false);
  const [manualRefreshing, setManualRefreshing] = React.useState(false);
  const [error, setError] = React.useState("");
  const [drafts, setDrafts] = React.useState<Record<number, string>>({});
  const [saveStates, setSaveStates] = React.useState<Record<number, SaveState>>({});
  const [saveErrors, setSaveErrors] = React.useState<Record<number, string>>({});
  const [previewItem, setPreviewItem] = React.useState<MaterialItem | null>(null);
  const scrollAreaRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    scrollAreaRef.current?.scrollTo({ top: 0 });
  }, [activeGroup, dateFrom, dateTo]);

  const syncDrafts = React.useCallback((nextItems: MaterialItem[], replace = false) => {
    setDrafts((prev) => {
      const next = replace ? {} : { ...prev };
      for (const item of nextItems) {
        if (next[item.id] === undefined) next[item.id] = item.inspiration || "";
      }
      return next;
    });
  }, []);

  const currentCacheKey = React.useMemo(() => {
    if (!user) return "";
    return getCacheKey(String(user.id), activeGroup, dateFrom, dateTo);
  }, [activeGroup, dateFrom, dateTo, user]);

  const applyCacheEntry = React.useCallback((entry: CacheEntry) => {
    setItems(entry.items);
    setPagination(entry.pagination);
    syncDrafts(entry.items, true);
    warmPreviewBatch(entry.items);
    setLoading(false);
    setHasLoadedOnce(true);
  }, [syncDrafts]);

  React.useEffect(() => {
    if (!currentCacheKey || hasLoadedOnce) return;
    const cached = inspirationPageCache.get(currentCacheKey) || readStoredCache(currentCacheKey);
    if (!cached) return;
    inspirationPageCache.set(currentCacheKey, cached);
    applyCacheEntry(cached);
  }, [applyCacheEntry, currentCacheKey, hasLoadedOnce]);

  const fetchGroups = React.useCallback(async () => {
    const res = await fetch("/api/material-assets/categories", { cache: "no-store" }).catch(() => null);
    if (!res || !res.ok) return;
    const json = (await res.json().catch(() => null)) as { categories?: string[] } | null;
    setGroups(Array.from(new Set((Array.isArray(json?.categories) ? json.categories : []).filter(Boolean))));
  }, []);

  const fetchItems = React.useCallback(
    async (page = 1, mode: "replace" | "append" = "replace", options?: { bypassCache?: boolean }) => {
      if (authLoading) return false;
      if (!user) {
        setLoading(false);
        setHasLoadedOnce(true);
        return false;
      }

      const cacheKey = getCacheKey(String(user.id), activeGroup, dateFrom, dateTo);
      const cached = page === 1 && mode === "replace" && !options?.bypassCache
        ? inspirationPageCache.get(cacheKey) || readStoredCache(cacheKey)
        : null;
      if (cached) {
        inspirationPageCache.set(cacheKey, cached);
        applyCacheEntry(cached);
        if (Date.now() - cached.fetchedAt < CACHE_TTL_MS) return true;
      }

      if (mode === "replace") setLoading(!cached && !hasLoadedOnce);
      setError("");

      const params = new URLSearchParams({
        mine: "1",
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (dateFrom) params.set("dateFrom", new Date(`${dateFrom}T00:00:00`).toISOString());
      if (dateTo) params.set("dateTo", new Date(`${dateTo}T23:59:59.999`).toISOString());
      if (activeGroup === "ungrouped") params.set("category", MATERIAL_ASSET_UNCATEGORIZED);
      else if (activeGroup !== "all") params.set("category", activeGroup);

      try {
        const res = await fetch(`/api/material-assets?${params.toString()}`, { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { items?: MaterialItem[]; pagination?: Partial<Pagination>; error?: string } | null;
        if (!res.ok) throw new Error(json?.error || "素材灵感加载失败");
        const nextItems = Array.isArray(json?.items) ? json.items : [];
        const nextPagination = normalizePagination(json?.pagination, page);
        warmPreviewBatch(nextItems);
        syncDrafts(nextItems, mode === "replace");
        setPagination(nextPagination);
        setItems((prev) => {
          const nextList = mode === "append" ? mergeUniqueById(prev, nextItems) : nextItems;
          if (page === 1 && mode === "replace") {
            const entry = { items: nextItems, pagination: nextPagination, fetchedAt: Date.now() };
            inspirationPageCache.set(cacheKey, entry);
            writeStoredCache(cacheKey, entry);
          }
          return nextList;
        });
        return true;
      } catch (err: any) {
        setError(String(err?.message || "素材灵感加载失败"));
        return false;
      } finally {
        setLoading(false);
        setHasLoadedOnce(true);
      }
    },
    [activeGroup, applyCacheEntry, authLoading, dateFrom, dateTo, hasLoadedOnce, syncDrafts, user]
  );

  React.useEffect(() => {
    void fetchGroups();
  }, [fetchGroups]);

  React.useEffect(() => {
    setHasLoadedOnce(false);
    setLoading(true);
    void fetchItems(1, "replace");
  }, [fetchItems]);

  const refreshItems = React.useCallback(async () => {
    if (manualRefreshing) return;
    setManualRefreshing(true);
    try {
      await Promise.all([
        fetchItems(1, "replace", { bypassCache: true }),
        new Promise((resolve) => window.setTimeout(resolve, 400)),
      ]);
    } finally {
      setManualRefreshing(false);
    }
  }, [fetchItems, manualRefreshing]);

  const updateItem = React.useCallback((id: number, patch: Partial<MaterialItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    setPreviewItem((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));

    if (!currentCacheKey) return;
    const cached = inspirationPageCache.get(currentCacheKey) || readStoredCache(currentCacheKey);
    if (!cached) return;
    const nextEntry = {
      ...cached,
      items: cached.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      fetchedAt: Date.now(),
    };
    inspirationPageCache.set(currentCacheKey, nextEntry);
    writeStoredCache(currentCacheKey, nextEntry);
  }, [currentCacheKey]);

  const saveInspiration = React.useCallback(async (item: MaterialItem) => {
    if (!user) {
      openLoginModal();
      return;
    }

    const rawDraft = drafts[item.id] ?? "";
    const nextText = rawDraft.slice(0, MAX_INSPIRATION_LEN);
    setSaveStates((prev) => ({ ...prev, [item.id]: "saving" }));
    setSaveErrors((prev) => ({ ...prev, [item.id]: "" }));

    try {
      const res = await fetch(`/api/material-assets/${item.id}/inspiration`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inspiration: nextText }),
      });
      const json = (await res.json().catch(() => null)) as { item?: { inspiration?: string | null }; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "保存灵感失败");
      const saved = json?.item?.inspiration ?? (nextText.trim() || null);
      updateItem(item.id, { inspiration: saved });
      setDrafts((prev) => ({ ...prev, [item.id]: saved || "" }));
      setSaveStates((prev) => ({ ...prev, [item.id]: "saved" }));
    } catch (err: any) {
      setSaveStates((prev) => ({ ...prev, [item.id]: "error" }));
      setSaveErrors((prev) => ({ ...prev, [item.id]: String(err?.message || "保存灵感失败") }));
    }
  }, [drafts, openLoginModal, updateItem, user]);

  const autoPagination = useAutoPaginate({
    scrollRef: scrollAreaRef,
    enabled: Boolean(user) && hasLoadedOnce && !loading,
    hasMore: pagination.hasMore,
    currentPage: pagination.page,
    loadPage: (page) => fetchItems(page, "append"),
  });
  const { text, locale, error: localizeError } = useUiLocale();
  const dayGroups = React.useMemo(() => groupMaterialItemsByDay(items, locale, text), [items, locale, text]);

  return (
    <AtomicPageReveal ready={!authLoading && (!user || hasLoadedOnce)}>
    <main
      ref={scrollAreaRef}
      onScroll={autoPagination.onScroll}
      className="min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto bg-[var(--app-bg)]"
    >
      <div className="w-full max-w-full px-3 py-4 sm:px-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <Link href="/settings" className="mb-3 inline-flex items-center gap-1.5 text-[12px] text-[var(--app-muted)] transition hover:text-[var(--app-fg)]">
              <ArrowLeft className="h-3.5 w-3.5" /><UiText id="common.md00bfe7c685c" /></Link>
            <div className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-indigo-500" />
              <h1 className="text-[20px] font-semibold tracking-tight text-[var(--app-fg)]"><UiText id="common.m1a72a426a282" /></h1>
            </div>
            <p className="mt-1 text-[13px] text-[var(--app-muted)]"><UiText id="common.m842eb67c2a76" /></p>
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
            <DateRangePicker from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} />
            <div className="flex min-w-0 max-w-full items-center gap-2 overflow-x-auto pb-0.5 sm:pb-0">
              <UiProps ids={{"label":["common.m5c55a67935af"]}}><FilterPill active={activeGroup === "all"} label="common.m5c55a67935af" onClick={() => setActiveGroup("all")} /></UiProps>
              {groups.map((group) => (
                <FilterPill key={group} active={activeGroup === group} label={group} onClick={() => setActiveGroup(group)} />
              ))}
              <UiProps ids={{"label":["common.m54b89f901274"]}}><FilterPill active={activeGroup === "ungrouped"} label="common.m54b89f901274" onClick={() => setActiveGroup("ungrouped")} /></UiProps>
              <span className="shrink-0 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[12px] text-[var(--app-muted)]"><UiText id="common.m2428420e407f" />{pagination.total}<UiText id="common.m6fb2840d568a" /></span>
            </div>
            <button
              type="button"
              onClick={() => void refreshItems()}
              disabled={manualRefreshing || authLoading}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[13px] text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:opacity-50"
            >
              <RefreshCw className={["h-4 w-4", manualRefreshing || loading ? "animate-spin" : ""].join(" ")} /><UiText id="common.maee887434131" /></button>
          </div>
        </div>

        {error ? (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/[0.06] px-4 py-2.5 text-[13px] text-rose-500">
            <AlertCircle className="h-4 w-4" />
            {localizeError(error)}
          </div>
        ) : null}

        {authLoading ? (
          <LoadingState />
        ) : !user ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-8 text-center shadow-[var(--shadow-2)]">
            <div className="text-[15px] font-semibold text-[var(--app-fg)]"><UiText id="common.m48144f96c150" /></div>
            <p className="mt-2 text-[13px] text-[var(--app-muted)]"><UiText id="common.m9a5d0a8c68dd" /></p>
            <button
              type="button"
              onClick={() => openLoginModal()}
              className="mt-5 inline-flex h-9 items-center justify-center rounded-xl bg-indigo-500 px-4 text-[13px] font-medium text-white transition hover:bg-indigo-400"
            >
              {desktopMode ? <UiText id="common.medd4000049f2" /> : <UiText id="common.md9a999a7c8e8" />}
            </button>
          </div>
        ) : loading && !hasLoadedOnce ? (
          <LoadingState />
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-10 text-center shadow-[var(--shadow-2)]">
            <ImageIcon className="mx-auto h-8 w-8 text-[var(--app-muted)]" />
            <div className="mt-3 text-[15px] font-semibold text-[var(--app-fg)]"><UiText id="common.m8f7af3e1678b" /></div>
            <p className="mt-2 text-[13px] text-[var(--app-muted)]"><UiText id="common.m8335dec4cd8a" /></p>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {dayGroups.map((group) => (
                <section key={group.key} className="min-w-0">
                  <div className="mb-2.5 flex items-center gap-2.5 border-b border-[var(--border)] pb-2">
                    <span className="text-[13px] font-semibold text-[var(--app-fg)]">{group.date}</span>
                    {group.rel ? (
                      <span className="rounded-md bg-[var(--panel-2)] px-1.5 py-0.5 text-[11px] text-[var(--app-muted)]">{group.rel}</span>
                    ) : null}
                    <span className="text-[11px] text-[var(--app-muted)]">{group.items.length}<UiText id="common.me9e0fdc242b4" /></span>
                  </div>
                  <div className="grid max-w-full grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-7 min-[1800px]:grid-cols-8">
                    {group.items.map((item, index) => (
                      <InspirationCard
                        key={item.id}
                        item={item}
                        eager={group.startIndex + index < 16}
                        draft={drafts[item.id] ?? item.inspiration ?? ""}
                        saveState={saveStates[item.id] || "idle"}
                        saveError={saveErrors[item.id] ? localizeError(saveErrors[item.id]) : ""}
                        onDraftChange={(value) => {
                          setDrafts((prev) => ({ ...prev, [item.id]: value.slice(0, MAX_INSPIRATION_LEN) }));
                          setSaveStates((prev) => ({ ...prev, [item.id]: "idle" }));
                        }}
                        onSave={() => void saveInspiration(item)}
                        onOpen={() => setPreviewItem(item)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>

            {autoPagination.failedAppendPage ? (
              <div className="flex justify-center py-7">
                <button
                  type="button"
                  onClick={() => void autoPagination.retryAppend()}
                  disabled={autoPagination.appendInFlight}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-5 text-sm text-[var(--app-fg)] transition hover:bg-[var(--panel-3)] disabled:opacity-60"
                >
                  {autoPagination.appendInFlight ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}<UiText id="common.m8924c7887461" /></button>
              </div>
            ) : autoPagination.appendInFlight ? (
              <div className="flex justify-center py-7 text-[12px] text-[var(--app-muted)]">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /><UiText id="common.mb3cb3861e481" /></div>
            ) : null}
          </>
        )}
      </div>

      {previewItem ? (
        <InspirationDetailModal
          item={previewItem}
          draft={drafts[previewItem.id] ?? previewItem.inspiration ?? ""}
          saveState={saveStates[previewItem.id] || "idle"}
          saveError={saveErrors[previewItem.id] ? localizeError(saveErrors[previewItem.id]) : ""}
          onDraftChange={(value) => {
            setDrafts((prev) => ({ ...prev, [previewItem.id]: value.slice(0, MAX_INSPIRATION_LEN) }));
            setSaveStates((prev) => ({ ...prev, [previewItem.id]: "idle" }));
          }}
          onSave={() => void saveInspiration(previewItem)}
          onClose={() => setPreviewItem(null)}
        />
      ) : null}
    </main>
    </AtomicPageReveal>
  );
}

function FilterPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "h-9 shrink-0 rounded-xl border px-3 text-[13px] transition",
        active
          ? "border-indigo-500/30 bg-indigo-500/15 text-indigo-500"
          : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)] hover:text-[var(--app-fg)]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function LoadingState() {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-7 min-[1800px]:grid-cols-8">
      {Array.from({ length: 12 }).map((_, index) => (
        <div key={index} className="h-[240px] animate-pulse rounded-xl border border-[var(--border)] bg-[var(--panel-bg)]" />
      ))}
    </div>
  );
}

function InspirationCard({
  item,
  eager,
  draft,
  saveState,
  saveError,
  onDraftChange,
  onSave,
  onOpen,
}: {
  item: MaterialItem;
  eager: boolean;
  draft: string;
  saveState: SaveState;
  saveError: string;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onOpen: () => void;
}) {
  const saved = item.inspiration || "";
  const dirty = draft !== saved;
  const saving = saveState === "saving";
  const cardVideoSrc = originalUrl(item);
  const isVideo = isMaterialVideo(item, cardVideoSrc);
  const poster = isVideo ? previewCandidates(item, 600).find((src) => !isVideoMediaUrl(src)) : "";
  const isGroup = (item.mediaCount || 1) > 1;

  return (
    <article className="min-w-0 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[0_1px_2px_rgba(15,15,25,0.06)]">
      <button
        type="button"
        onClick={onOpen}
        className="relative block w-full overflow-hidden bg-[var(--panel-3)] text-left"
        style={{ aspectRatio: getAspectRatio(item) }}
      >
        {isVideo ? (
          <HoverPreviewVideo
            src={cardVideoSrc}
            posterSrc={poster}
            className="block h-full w-full object-contain"
            eager={eager}
          />
        ) : (
          <ResilientImage
            candidates={cardImageCandidates(item)}
            alt={item.title}
            className="block h-full w-full object-contain transition-transform duration-300 hover:scale-[1.03]"
            loading="eager"
            fetchPriority={eager ? "high" : "auto"}
            onLoad={(event) => rememberAspectRatio(item.id, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
          />
        )}
        <div className="pointer-events-none absolute left-2 top-2 max-w-[calc(100%-1rem)] rounded-lg bg-black/35 px-2 py-1 text-[12px] font-medium text-white backdrop-blur">
          {item.category || <UiText id="common.m54b89f901274" />}
        </div>
        {isGroup ? (
          <div className="pointer-events-none absolute right-2 top-2 rounded-lg bg-indigo-500 px-2 py-1 text-[12px] font-medium text-white">
            {item.mediaCount}<UiText id="common.m4997434cc33f" /></div>
        ) : null}
      </button>

      <div className="min-w-0 space-y-1.5 p-2">
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-semibold text-[var(--app-fg)]" title={item.title}>{item.title}</div>
          <div className="mt-1 text-[11px] text-[var(--app-muted)]"><UiText id="common.m8dfc8e0bfadd" />{item.creatorName || "-"}
          </div>
        </div>
        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-[var(--app-muted)]">
            <Lightbulb className="h-3.5 w-3.5 text-indigo-500" /><UiText id="common.mbf16a5d1c865" /></span>
          <UiProps ids={{"placeholder":["common.m9c7bd5f1c070"]}}><textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            maxLength={MAX_INSPIRATION_LEN}
            rows={3}
            placeholder="common.m9c7bd5f1c070"
            className="h-[84px] w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2 py-1.5 text-[12px] leading-5 text-[var(--app-fg)] outline-none transition placeholder:text-[var(--app-muted)]/70 focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/15"
          /></UiProps>
        </label>
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[11px] text-[var(--app-muted)]">
            {saveState === "error" ? saveError : saveState === "saved" ? <UiText id="common.m1bd91a7d0c53" /> : dirty ? <UiText id="common.mf8b4e7548fbd" /> : <UiText id="common.m04062edb583b" />} · {draft.length}/{MAX_INSPIRATION_LEN}
          </span>
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || saving}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-indigo-500 px-2.5 text-[12px] font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-[var(--panel-3)] disabled:text-[var(--app-muted)]"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saveState === "saved" && !dirty ? <Check className="h-3.5 w-3.5" /> : null}<UiText id="common.ma3030bf8f16d" /></button>
        </div>
      </div>
    </article>
  );
}

function InspirationDetailModal({
  item,
  draft,
  saveState,
  saveError,
  onDraftChange,
  onSave,
  onClose,
}: {
  item: MaterialItem;
  draft: string;
  saveState: SaveState;
  saveError: string;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { text } = useUiLocale();
  const mediaItems = materialMediaItems(item);
  const [index, setIndex] = React.useState(0);
  const [scale, setScale] = React.useState(1);
  const [tx, setTx] = React.useState(0);
  const [ty, setTy] = React.useState(0);
  const [panning, setPanning] = React.useState(false);
  const panRef = React.useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const imageStageRef = React.useRef<HTMLDivElement | null>(null);
  const mobileImageStageRef = React.useRef<HTMLDivElement | null>(null);

  const current = mediaItems[index] || mediaItems[0] || null;
  const src = current ? mediaOriginalUrl(current) : originalUrl(item);
  const isVideo = current
    ? String(current.mime || "").toLowerCase().startsWith("video/") || isVideoMediaUrl(src)
    : isMaterialVideo(item, src);
  const imageCandidates = current ? materialMediaPreviewCandidates(current, 1800) : cardImageCandidates(item);
  const hasPrev = index > 0;
  const hasNext = index < mediaItems.length - 1;
  const dirty = draft !== (item.inspiration || "");
  const saving = saveState === "saving";

  const resetTransform = React.useCallback(() => {
    setScale(1);
    setTx(0);
    setTy(0);
    setPanning(false);
    panRef.current = null;
  }, []);

  const goPrev = React.useCallback(() => {
    setIndex((value) => Math.max(0, value - 1));
  }, []);

  const goNext = React.useCallback(() => {
    setIndex((value) => Math.min(mediaItems.length - 1, value + 1));
  }, [mediaItems.length]);

  const zoomAtPoint = React.useCallback(
    (stage: HTMLDivElement, clientX: number, clientY: number, nextScale: number) => {
      setScale((currentScale) => {
        const targetScale = clamp(nextScale, PREVIEW_IMAGE_MIN_SCALE, PREVIEW_IMAGE_MAX_SCALE);
        if (Math.abs(targetScale - 1) < 0.001) {
          setTx(0);
          setTy(0);
          return 1;
        }
        const rect = stage.getBoundingClientRect();
        const originX = clientX - rect.left - rect.width / 2;
        const originY = clientY - rect.top - rect.height / 2;
        const ratio = targetScale / currentScale;
        setTx((value) => originX - (originX - value) * ratio);
        setTy((value) => originY - (originY - value) * ratio);
        return targetScale;
      });
    },
    []
  );

  const stepZoom = React.useCallback(
    (direction: 1 | -1) => {
      const stage = imageStageRef.current || mobileImageStageRef.current;
      if (!stage || isVideo) return;
      const rect = stage.getBoundingClientRect();
      zoomAtPoint(stage, rect.left + rect.width / 2, rect.top + rect.height / 2, scale + direction * 0.25);
    },
    [isVideo, scale, zoomAtPoint]
  );

  const onStageMouseDown = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (isVideo || scale <= 1) return;
      event.preventDefault();
      setPanning(true);
      panRef.current = { x: event.clientX, y: event.clientY, tx, ty };
    },
    [isVideo, scale, tx, ty]
  );

  React.useEffect(() => {
    setIndex(0);
  }, [item.id]);

  React.useEffect(() => {
    resetTransform();
  }, [item.id, index, resetTransform]);

  React.useEffect(() => {
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "contain";
    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscroll;
    };
  }, []);

  React.useEffect(() => {
    if (!panning) return;
    const onMouseMove = (event: MouseEvent) => {
      const start = panRef.current;
      if (!start) return;
      setTx(start.tx + event.clientX - start.x);
      setTy(start.ty + event.clientY - start.y);
    };
    const onMouseUp = () => {
      setPanning(false);
      panRef.current = null;
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [panning]);

  React.useEffect(() => {
    if (isVideo) return;
    const stages = [imageStageRef.current, mobileImageStageRef.current].filter(Boolean) as HTMLDivElement[];
    const onWheel = (event: WheelEvent) => {
      const stage = event.currentTarget as HTMLDivElement;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.12 : 0.88;
      zoomAtPoint(stage, event.clientX, event.clientY, scale * factor);
    };
    stages.forEach((stage) => stage.addEventListener("wheel", onWheel, { passive: false }));
    return () => stages.forEach((stage) => stage.removeEventListener("wheel", onWheel));
  }, [isVideo, scale, zoomAtPoint]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const editing = tagName === "textarea" || tagName === "input" || target?.isContentEditable;
      if (event.key === "Escape") onClose();
      if (editing) return;
      if (event.key === "ArrowLeft" && hasPrev) goPrev();
      if (event.key === "ArrowRight" && hasNext) goNext();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goPrev, hasNext, hasPrev, onClose]);

  const renderImageStage = (stageRef: React.Ref<HTMLDivElement>, compact = false) => (
    <div
      ref={stageRef}
      className={[
        "group relative select-none overflow-hidden bg-[#111214]",
        compact ? "aspect-[4/3] w-full rounded-2xl md:hidden" : "hidden h-full aspect-[3/4] shrink-0 items-center justify-center md:flex",
        !isVideo && scale > 1 ? (panning ? "cursor-grabbing" : "cursor-grab") : "",
      ].join(" ")}
      onMouseDown={onStageMouseDown}
      onDoubleClick={resetTransform}
    >
      {mediaItems.length > 1 ? (
        <div className="absolute left-3 top-3 z-20 rounded-full bg-black/55 px-3 py-1 text-[12px] font-semibold text-white">
          {index + 1}/{mediaItems.length}
        </div>
      ) : null}
      {!isVideo ? (
        <InlineImageZoomControls
          scale={scale}
          onZoomIn={() => stepZoom(1)}
          onZoomOut={() => stepZoom(-1)}
          onReset={resetTransform}
        />
      ) : null}
      {hasPrev ? (
        <UiProps ids={{"aria-label":["common.mbcf200709dbc"]}}><button
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={goPrev}
          className="absolute left-3 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition hover:bg-black/65"
          aria-label="common.mbcf200709dbc"
        >
          <ChevronLeft className="h-5 w-5" />
        </button></UiProps>
      ) : null}
      {hasNext ? (
        <UiProps ids={{"aria-label":["common.mdcd4eb027369"]}}><button
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={goNext}
          className="absolute right-3 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition hover:bg-black/65"
          aria-label="common.mdcd4eb027369"
        >
          <ChevronRight className="h-5 w-5" />
        </button></UiProps>
      ) : null}
      {isVideo ? (
        <AppVideoPlayer
          src={src}
          className="h-full w-full bg-black object-contain"
          containerClassName="h-full w-full"
          playsInline
          preload="metadata"
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center"
          style={{
            transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
            transformOrigin: "center center",
          }}
        >
          <ResilientImage
            candidates={imageCandidates}
            alt={item.title}
            className="pointer-events-none h-full w-full object-contain"
            draggable={false}
            cacheInMemory={false}
          />
        </div>
      )}
      {mediaItems.length > 1 && !compact ? <MediaDots count={mediaItems.length} activeIndex={index} /> : null}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="flex h-[88vh] max-h-[860px] w-full max-w-[calc(100vw-2rem)] overflow-hidden rounded-[22px] border border-white/15 bg-[var(--panel-bg)] shadow-[0_30px_90px_-36px_rgba(0,0,0,0.9)] md:w-auto"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {renderImageStage(imageStageRef)}

        <aside className="flex h-full w-full min-w-0 flex-col border-[var(--border)] bg-[var(--panel-bg)] md:w-[320px] md:shrink-0 md:border-l">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold text-[var(--app-fg)]" title={item.title}>{item.title}</div>
              <div className="mt-1 text-[12px] text-[var(--app-muted)]">
                {item.category || <UiText id="common.m54b89f901274" />} · {mediaItems.length || 1}<UiText id="common.m4997434cc33f" /></div>
            </div>
            <UiProps ids={{"aria-label":["common.m3fd47edce45b"]}}><button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)] transition hover:text-[var(--app-fg)]"
              aria-label="common.m3fd47edce45b"
            >
              <X className="h-4 w-4" />
            </button></UiProps>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {renderImageStage(mobileImageStageRef, true)}

            {mediaItems.length > 1 ? (
              <div className="mb-4 mt-3 flex gap-2 overflow-x-auto pb-1">
                {mediaItems.map((media, mediaIndex) => (
                  <button
                    key={media.id || mediaIndex}
                    type="button"
                    onClick={() => setIndex(mediaIndex)}
                    className={[
                      "h-14 w-14 shrink-0 overflow-hidden rounded-xl border bg-[var(--panel-3)] transition",
                      mediaIndex === index ? "border-indigo-500 ring-2 ring-indigo-500/20" : "border-[var(--border)] opacity-75 hover:opacity-100",
                    ].join(" ")}
                    aria-label={text("workspaceFollowup.mc867f28dbd33", { v0: mediaIndex + 1 })}
                  >
                    <ResilientImage
                      candidates={materialMediaPreviewCandidates(media, 180)}
                      alt={`${item.title}-${mediaIndex + 1}`}
                      className="h-full w-full object-cover"
                      cacheInMemory={false}
                    />
                  </button>
                ))}
              </div>
            ) : null}

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-3 text-[12px] text-[var(--app-muted)]">
              <div className="truncate"><UiText id="common.m8dfc8e0bfadd" />{item.creatorName || "-"}</div>
              <div className="mt-1 truncate"><UiText id="common.mf5179cc50012" />{item.category || <UiText id="common.m54b89f901274" />}</div>
            </div>

            <label className="mt-4 block">
              <span className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-[var(--app-fg)]">
                <Lightbulb className="h-4 w-4 text-indigo-500" /><UiText id="common.mbf16a5d1c865" /></span>
              <UiProps ids={{"placeholder":["common.m9c7bd5f1c070"]}}><textarea
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                maxLength={MAX_INSPIRATION_LEN}
                placeholder="common.m9c7bd5f1c070"
                className="h-[220px] w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-[13px] leading-6 text-[var(--app-fg)] outline-none transition placeholder:text-[var(--app-muted)]/70 focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/15"
              /></UiProps>
            </label>
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3">
            <span className="min-w-0 truncate text-[12px] text-[var(--app-muted)]">
              {saveState === "error" ? saveError : saveState === "saved" && !dirty ? <UiText id="common.m1bd91a7d0c53" /> : dirty ? <UiText id="common.mf8b4e7548fbd" /> : <UiText id="common.m04062edb583b" />} · {draft.length}/{MAX_INSPIRATION_LEN}
            </span>
            <button
              type="button"
              onClick={onSave}
              disabled={!dirty || saving}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-indigo-500 px-4 text-[13px] font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-[var(--panel-3)] disabled:text-[var(--app-muted)]"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saveState === "saved" && !dirty ? <Check className="h-4 w-4" /> : null}<UiText id="common.ma3030bf8f16d" /></button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function MediaDots({ count, activeIndex }: { count: number; activeIndex: number }) {
  if (count <= 1) return null;
  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/35 px-2.5 py-2 backdrop-blur">
      {Array.from({ length: count }).map((_, index) => (
        <span
          key={index}
          className={[
            "h-1.5 w-1.5 rounded-full transition-colors",
            index === activeIndex ? "bg-white" : "bg-white/45",
          ].join(" ")}
        />
      ))}
    </div>
  );
}

function InlineImageZoomControls({
  scale,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  return (
    <div
      className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-full bg-black/45 p-1 text-white backdrop-blur"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <UiProps ids={{"aria-label":["common.m290f68030501"]}}><button
        type="button"
        onClick={onZoomOut}
        disabled={scale <= PREVIEW_IMAGE_MIN_SCALE}
        className="flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-white/15 disabled:opacity-40"
        aria-label="common.m290f68030501"
      >
        <ZoomOut className="h-4 w-4" />
      </button></UiProps>
      <UiProps ids={{"aria-label":["common.mddde08946298"]}}><button
        type="button"
        onClick={onReset}
        className="hidden h-8 items-center gap-1 rounded-full px-2 text-[12px] transition hover:bg-white/15 sm:flex"
        aria-label="common.mddde08946298"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        {Math.round(scale * 100)}%
      </button></UiProps>
      <UiProps ids={{"aria-label":["common.m80f8fbcfa011"]}}><button
        type="button"
        onClick={onZoomIn}
        disabled={scale >= PREVIEW_IMAGE_MAX_SCALE}
        className="flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-white/15 disabled:opacity-40"
        aria-label="common.m80f8fbcfa011"
      >
        <ZoomIn className="h-4 w-4" />
      </button></UiProps>
    </div>
  );
}
