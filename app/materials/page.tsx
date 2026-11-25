"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { MaterialSkeleton } from "@/components/materials/materials-loading";
import { MaterialTools } from "@/components/settings/material-tools";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  Image as ImageIcon,
  Lightbulb,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  Search,
  Tag,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppVideoPlayer } from "@/components/ui/app-video-player";
import { HoverPreviewVideo } from "@/components/ui/hover-preview-video";
import { subscribeMaterialPreview } from "@/lib/client/material-preview-queue";
import { hasLoadedResilientImageCandidates, ResilientImage } from "@/components/ui/resilient-image";
import { materialCardImageCandidates as cardImageCandidates, materialCardVideoPosterCandidates as cardVideoPosterCandidates } from "@/lib/material-card-preview";
import { buildMediaOriginalUrl, buildMediaProxyUrl, isVideoMediaUrl } from "@/lib/media-url";
import { MATERIAL_ASSET_UNCATEGORIZED } from "@/lib/material-assets";
import { MATERIAL_STATUS_STORAGE_KEY, normalizeMaterialStatus, readSavedMaterialStatus, type MaterialStatus } from "@/lib/material-status";
import { useAutoPaginate } from "@/hooks/use-auto-paginate";
import { takeMaterialsEntry } from "@/lib/client/materials-entry";
import { fetchJsonOnce } from "@/lib/client/inflight-json";
import { ScrollToTopButton } from "@/components/ui/scroll-to-top-button";
import { AtomicPageReveal } from "@/components/layout/atomic-page-reveal";
import { AutoHideScrollbar } from "@/components/ui/auto-hide-scrollbar";

type SelectedBy = {
  id: number;
  username: string;
  selectedAt: string | null;
  selectedMediaId?: string | null;
};

type DownloadRecord = {
  id: number;
  userId: number;
  username: string;
  downloadedAt: string;
};

type MaterialMediaItem = {
  id: string;
  originalUrl: string;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  mime: string | null;
  size: number | null;
  width?: number | null;
  height?: number | null;
};

type MaterialItem = {
  id: number;
  displayKey?: string;
  displayMediaId?: string | null;
  displayMediaIndex?: number;
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
  tags?: string[];
  creatorName?: string | null;
  inspiration?: string | null;
  createdAt: string;
  selectedBy?: SelectedBy | null;
  isSelected?: boolean;
  isSelectedByMe?: boolean;
  downloadCount?: number;
  recentDownloads?: DownloadRecord[];
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  nextCursor?: string | null;
};

type MaterialStats = {
  total: number;
  selected: number;
  available: number;
  unselected: number;
};

type StatusFilter = MaterialStatus;
type TimeFilter = "all" | "1d" | "1w" | "1m" | "1y";
type MediaKindFilter = "all" | "single" | "series";
type ModelGroup = {
  category: string;
  models: string[];
};
type MaterialsCacheEntry = {
  items: MaterialItem[];
  pagination: Pagination;
  stats: MaterialStats;
  fetchedAt: number;
  scrollTop?: number;
};

const STATUS_OPTIONS: Array<{ key: StatusFilter; label: string; helper: string }> = [
  { key: "all", label: "createDynamic.m7970c42596b5", helper: "createDynamic.ma83eb6a49d10" },
  { key: "available", label: "createDynamic.me41cedbd64d9", helper: "createDynamic.m60811fb8fd18" },
  { key: "selected", label: "createDynamic.m255711c802de", helper: "createDynamic.m2c8d0b13f5bc" },
  { key: "mine", label: "createDynamic.mcd721198e176", helper: "createDynamic.m8ae075dd9b7c" },
];
const TIME_OPTIONS: Array<{ key: TimeFilter; label: string }> = [
  { key: "all", label: "createDynamic.m5c55a67935af" },
  { key: "1d", label: "createDynamic.m7abd0228507e" },
  { key: "1w", label: "createDynamic.ma7929bb96e7a" },
  { key: "1m", label: "createDynamic.m4a28f80e0107" },
  { key: "1y", label: "createDynamic.m68de169ae926" },
];
const MEDIA_KIND_OPTIONS: Array<{ key: MediaKindFilter; label: string }> = [
  { key: "all", label: "createDynamic.m5c55a67935af" },
  { key: "single", label: "createDynamic.me71b76b45a24" },
  { key: "series", label: "createDynamic.m9bbfefa108cf" },
];

const PAGE_SIZE = 24;
const MATERIALS_SIDEBAR_REFRESH_KEY = "materials_sidebar_refresh_requested_v1";
const MATERIALS_MASONRY_MIN_COLUMN_WIDTH = 240;
const MATERIALS_MASONRY_GAP = 3;
// 卡片下方"灵感"块的预估高度（标题行 + 截断 2 行正文 + 内边距），用于瀑布流测高
const INSPIRATION_BLOCK_HEIGHT = 86;
const INSPIRATION_PLACEHOLDER_TEXT = "用于统一素材卡片高度，保留约三十字灵感空间。";
const EMPTY_MATERIAL_STATS: MaterialStats = { total: 0, selected: 0, available: 0, unselected: 0 };
const materialsPageCache = new Map<string, MaterialsCacheEntry>();
const materialsViewCache = new Map<string, { category: string; modelName: string; status: StatusFilter; timeFilter: TimeFilter; mediaKindFilter: MediaKindFilter; q: string }>();
const materialAspectRatioCache = new Map<string, number>();
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

function getMaterialsCacheKey(
  userId: string,
  status: StatusFilter,
  activeGroup: string,
  activeModelName: string,
  q: string,
  timeFilter: TimeFilter,
  mediaKindFilter: MediaKindFilter
) {
  return JSON.stringify([userId, status, activeGroup, activeModelName, q.trim(), timeFilter, mediaKindFilter]);
}

function dateFromForTimeFilter(timeFilter: TimeFilter): string {
  if (timeFilter === "all") return "";
  const date = new Date();
  if (timeFilter === "1d") date.setDate(date.getDate() - 1);
  else if (timeFilter === "1w") date.setDate(date.getDate() - 7);
  else if (timeFilter === "1m") date.setMonth(date.getMonth() - 1);
  else if (timeFilter === "1y") date.setFullYear(date.getFullYear() - 1);
  return date.toISOString();
}

function getMaterialsStorageKey(cacheKey: string) {
  return `materials_page_cache_v6_${cacheKey}`;
}

function readStoredMaterialsCache(cacheKey: string): MaterialsCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(getMaterialsStorageKey(cacheKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MaterialsCacheEntry> | null;
    if (!parsed || !Array.isArray(parsed.items) || !parsed.pagination) return null;
    return {
      items: parsed.items as MaterialItem[],
      pagination: parsed.pagination as Pagination,
      stats: normalizeMaterialStats(parsed.stats),
      fetchedAt: Number(parsed.fetchedAt) || 0,
      scrollTop: Number(parsed.scrollTop) || 0,
    };
  } catch {
    return null;
  }
}

function normalizeMaterialStats(raw: unknown): MaterialStats {
  const stats = raw && typeof raw === "object" ? raw as Partial<MaterialStats> : {};
  return {
    total: Math.max(0, Number(stats.total) || 0),
    selected: Math.max(0, Number(stats.selected) || 0),
    available: Math.max(0, Number(stats.available) || 0),
    unselected: Math.max(0, Number(stats.unselected) || 0),
  };
}

function writeStoredMaterialsCache(cacheKey: string, entry: MaterialsCacheEntry) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(getMaterialsStorageKey(cacheKey), JSON.stringify(entry));
  } catch {}
}

function readStatusFilterFromLocation(): StatusFilter {
  if (typeof window === "undefined") return "all";
  const urlStatus = new URLSearchParams(window.location.search).get("status");
  return urlStatus ? normalizeMaterialStatus(urlStatus) : readSavedMaterialStatus();
}

function writeStatusFilter(status: StatusFilter) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (status === "all") url.searchParams.delete("status");
  else url.searchParams.set("status", status);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  try {
    window.localStorage?.setItem(MATERIAL_STATUS_STORAGE_KEY, status);
  } catch {
    /* URL state is enough when localStorage is unavailable. */
  }
}

function formatTime(raw: string | null | undefined, locale: string) {
  if (!raw) return "-";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSize(n: number | null | undefined, locale: string) {
  const size = Number(n || 0);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (locale === "en") {
    const megabytes = size >= 1024 * 1024;
    const digits = megabytes && size <= 10 * 1024 * 1024 ? 1 : 0;
    const value = megabytes ? size / (1024 * 1024) : Math.max(1, Math.round(size / 1024));
    return `${new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)} ${megabytes ? "MB" : "KB"}`;
  }
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(size > 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

// 我已挑选：按挑选时间的自然月分组，月份倒序，包含全部历史。
function groupItemsByMonth(items: MaterialItem[], text: ReturnType<typeof useUiLocale>["text"], locale: string): Array<{ key: string; label: string; items: MaterialItem[] }> {
  const map = new Map<string, MaterialItem[]>();
  for (const item of items) {
    const raw = item.selectedBy?.selectedAt || item.createdAt;
    const date = new Date(raw);
    const key = Number.isNaN(date.getTime())
      ? "unknown"
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, list]) => {
      const label = key === "unknown"
        ? text("createDynamic.m65c9b80829a8")
        : locale === "en"
          ? new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", timeZone: "UTC" }).format(new Date(key + "-01T00:00:00Z"))
          : `${key.slice(0, 4)}年${Number(key.slice(5, 7))}月`;
      return { key, label, items: list };
    });
}

function getMaterialAspectRatioStorageKey(key: string) {
  return `material_asset_aspect_ratio_v1_${key}`;
}

function readStoredMaterialAspectRatio(key: string) {
  if (typeof window === "undefined") return null;
  try {
    const value = Number(sessionStorage.getItem(getMaterialAspectRatioStorageKey(key)));
    return Number.isFinite(value) && value > 0.2 && value < 6 ? value : null;
  } catch {
    return null;
  }
}

function rememberMaterialAspectRatio(key: string, width: number, height: number) {
  if (!key || width <= 0 || height <= 0) return;
  const ratio = clamp(width / height, 0.25, 4);
  materialAspectRatioCache.set(key, ratio);
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(getMaterialAspectRatioStorageKey(key), String(ratio));
  } catch {}
}

function getMaterialAspectRatio(item: MaterialItem) {
  const key = materialDisplayKey(item);
  const width = Number(item.previewWidth);
  const height = Number(item.previewHeight);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    const ratio = clamp(width / height, 0.25, 4);
    materialAspectRatioCache.set(key, ratio);
    return ratio;
  }
  return materialAspectRatioCache.get(key) || readStoredMaterialAspectRatio(key) || 1;
}

function originalUrl(item: MaterialItem) {
  const raw = buildMediaOriginalUrl(item.imageUrl || item.previewUrl || item.thumbnailUrl || "");
  return buildMediaProxyUrl(raw) || raw;
}

function originalMediaCandidates(item: MaterialItem) {
  return Array.from(
    new Set(
      [item.imageUrl, item.previewUrl, item.thumbnailUrl]
        .map((raw) => buildMediaOriginalUrl(raw))
        .map((url) => buildMediaProxyUrl(url) || url)
        .filter(Boolean)
    )
  );
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

function displayMediaItem(item: MaterialItem) {
  if (!item.displayMediaId) return null;
  return materialMediaItems(item).find((media) => media.id === item.displayMediaId) || null;
}

function materialDisplayKey(item: MaterialItem) {
  return item.displayKey || String(item.id);
}

function materialMediaOriginalUrl(media: MaterialMediaItem) {
  const raw = buildMediaOriginalUrl(media.originalUrl || media.previewUrl || media.thumbnailUrl || "");
  return buildMediaProxyUrl(raw) || raw;
}

function isMaterialVideo(item: MaterialItem, src?: string | null) {
  return Boolean(
    String(item.mimeType || "").toLowerCase().startsWith("video/") ||
      isVideoMediaUrl(src || item.imageUrl || item.previewUrl || item.thumbnailUrl || "")
  );
}

const MATERIAL_IMAGE_MIN_SCALE = 0.25;
const MATERIAL_IMAGE_MAX_SCALE = 6;

function downloadFile(url: string, title: string) {
  if (!url) return;
  const a = document.createElement("a");
  a.href = url;
  a.download = title || "";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export default function MaterialsPage() {
  const { error: localizeError, text, locale } = useUiLocale();
  const statusOptions = STATUS_OPTIONS.map(option => ({ ...option, label: text(option.label), helper: text(option.helper) }));
  const timeOptions = TIME_OPTIONS.map(option => ({ ...option, label: text(option.label) }));
  const mediaKindOptions = MEDIA_KIND_OPTIONS.map(option => ({ ...option, label: text(option.label) }));
  const { user, loading: authLoading, openLoginModal } = useAuth();
  const [items, setItems] = React.useState<MaterialItem[]>([]);
  const [groups, setGroups] = React.useState<string[]>([]);
  const [hasUngrouped, setHasUngrouped] = React.useState(false);
  const [modelGroups, setModelGroups] = React.useState<ModelGroup[]>([]);
  const [categoryFilter, setCategoryFilter] = React.useState({ category: "all", modelName: "" });
  const { category: activeGroup, modelName: activeModelName } = categoryFilter;
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const [timeFilter, setTimeFilter] = React.useState<TimeFilter>("all");
  const [mediaKindFilter, setMediaKindFilter] = React.useState<MediaKindFilter>("all");
  const [statusReady, setStatusReady] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [debouncedQ, setDebouncedQ] = React.useState("");
  const [pagination, setPagination] = React.useState<Pagination>({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1, hasMore: false });
  const [resolvedItemsKey, setResolvedItemsKey] = React.useState("");
  const [replaceInFlight, setReplaceInFlight] = React.useState<{ generation: number; cacheKey: string } | null>(null);
  const [materialStats, setMaterialStats] = React.useState<MaterialStats>(EMPTY_MATERIAL_STATS);
  const [loading, setLoading] = React.useState(true);
  // 首次加载完成后置 true。后续切换分类/状态/搜索时仅静默重取，不再切回骨架，
  // 避免画面在 skeleton ⇄ 内容/空态 间反复跳动。
  const [hasLoadedOnce, setHasLoadedOnce] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [manualRefreshing, setManualRefreshing] = React.useState(false);
  const [error, setError] = React.useState("");
  const [activeItem, setActiveItem] = React.useState<MaterialItem | null>(null);
  const [busyIds, setBusyIds] = React.useState<Set<number>>(() => new Set());
  const busyIdsRef = React.useRef(new Set<number>());
  const selectionVersionsRef = React.useRef(new Map<number, number>());
  const selectingRef = React.useRef(new Set<number>());
  const [message, setMessage] = React.useState("");
  const [hasNewMaterials, setHasNewMaterials] = React.useState(false);
  const paginationRef = React.useRef(pagination);
  paginationRef.current = pagination;
  const listUrlRef = React.useRef("");
  const fetchedAtRef = React.useRef(0);
  const restoreScrollRef = React.useRef<number | null>(null);
  const [scrollAhead, setScrollAhead] = React.useState(2400);
  const scrollMotionRef = React.useRef({ top: 0, at: 0, direction: 1 });
  const scrollAreaRef = React.useRef<HTMLDivElement | null>(null);
  const groupsRequestGenerationRef = React.useRef(0);
  const itemsRequestGenerationRef = React.useRef(0);
  const currentItemsKeyRef = React.useRef("");
  const resolvedItemsKeyRef = React.useRef("");
  const replaceInFlightRef = React.useRef<typeof replaceInFlight>(null);

  React.useEffect(() => {
    resolvedItemsKeyRef.current = resolvedItemsKey;
  }, [resolvedItemsKey]);

  const handleCategoryChange = React.useCallback((category: string) => {
    setCategoryFilter({ category, modelName: "" });
  }, []);

  const handleModelChange = React.useCallback((category: string, modelName: string) => {
    setCategoryFilter((current) =>
      current.category === category && current.modelName === modelName
        ? { category, modelName: "" }
        : { category, modelName }
    );
  }, []);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      if (q.trim() && !debouncedQ) {
        setStatus("all");
        setTimeFilter("all");
        setMediaKindFilter("all");
        setCategoryFilter({ category: "all", modelName: "" });
      }
      setDebouncedQ(q.trim());
    }, 220);
    return () => window.clearTimeout(timer);
  }, [q]);

  useIsomorphicLayoutEffect(() => {
    if (authLoading) return;
    const view = materialsViewCache.get(String(user?.id || "guest"));
    setCategoryFilter({ category: view?.category || "all", modelName: view?.modelName || "" });
    setTimeFilter(view?.timeFilter || "all");
    setMediaKindFilter(view?.mediaKindFilter || "all");
    setQ(view?.q || ""); setDebouncedQ(view?.q || "");
    setStatus(new URLSearchParams(window.location.search).has("status") ? readStatusFilterFromLocation() : view?.status || readStatusFilterFromLocation());
    setItems([]); setHasLoadedOnce(false); setLoading(true);
    setStatusReady(true);
  }, [authLoading, user?.id]);

  React.useEffect(() => {
    if (!statusReady) return;
    writeStatusFilter(status);
  }, [status, statusReady]);

  React.useEffect(() => {
    if (authLoading || user) return;
    if (status === "mine") setStatus("all");
  }, [authLoading, status, user]);

  React.useEffect(() => {
    if (statusReady) materialsViewCache.set(String(user?.id || "guest"), { category: activeGroup, modelName: activeModelName, status, timeFilter, mediaKindFilter, q: debouncedQ });
  }, [statusReady, user?.id, activeGroup, activeModelName, debouncedQ, mediaKindFilter, status, timeFilter]);

  React.useEffect(() => {
    const onPopState = () => {
      const urlStatus = new URLSearchParams(window.location.search).get("status");
      setStatus(normalizeMaterialStatus(urlStatus));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const fetchGroups = React.useCallback(async () => {
    const generation = ++groupsRequestGenerationRef.current;
    try {
      const result = await fetchJsonOnce("/api/material-assets/categories");
      const json = result.json as { categories?: unknown; modelGroups?: unknown; hasUngrouped?: boolean } | null;
      if (!result.ok || !json || !Array.isArray(json.categories) || !Array.isArray(json.modelGroups)) return false;

      const nextCategories = Array.from(new Set(json.categories.flatMap((value) => {
        if (typeof value !== "string") return [];
        const category = value.trim();
        return category ? [category] : [];
      })));
      const validCategories = new Set(nextCategories);
      const modelsByCategory = new Map<string, string[]>();

      for (const value of json.modelGroups) {
        if (!value || typeof value !== "object") continue;
        const rawGroup = value as { category?: unknown; models?: unknown };
        if (typeof rawGroup.category !== "string" || !Array.isArray(rawGroup.models)) continue;
        const category = rawGroup.category.trim();
        if (!category || !validCategories.has(category)) continue;
        const models = rawGroup.models.flatMap((model) => {
          if (typeof model !== "string") return [];
          const modelName = model.trim();
          return modelName ? [modelName] : [];
        });
        if (!models.length) continue;
        modelsByCategory.set(category, Array.from(new Set([...(modelsByCategory.get(category) || []), ...models])));
      }

      const nextModelGroups = nextCategories.flatMap((category) => {
        const models = modelsByCategory.get(category);
        return models?.length ? [{ category, models }] : [];
      });
      if (generation !== groupsRequestGenerationRef.current) return false;

      // 只展示接口返回的「真正有素材」的分类，不再用 DEFAULT_GROUPS 兜底——
      // 没上传过素材的分类（如「美容仪」0 素材）不应出现在品类按钮里。
      setGroups(nextCategories);
      setHasUngrouped(Boolean(json.hasUngrouped));
      setModelGroups(nextModelGroups);
      setCategoryFilter((current) => {
        if (current.category !== "all" && (current.category === "ungrouped" ? !json.hasUngrouped : !validCategories.has(current.category))) {
          return { category: "all", modelName: "" };
        }
        if (!current.modelName) return current;
        const currentGroup = nextModelGroups.find((group) => group.category === current.category);
        return currentGroup?.models.includes(current.modelName) ? current : { ...current, modelName: "" };
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  const currentCacheKey = React.useMemo(() => {
    if (!statusReady) return "";
    return getMaterialsCacheKey(user ? String(user.id) : "guest", status, activeGroup, activeModelName, debouncedQ, timeFilter, mediaKindFilter);
  }, [activeGroup, activeModelName, debouncedQ, mediaKindFilter, status, statusReady, timeFilter, user]);

  useIsomorphicLayoutEffect(() => {
    if (currentItemsKeyRef.current === currentCacheKey) return;
    currentItemsKeyRef.current = currentCacheKey;
    itemsRequestGenerationRef.current += 1;
    restoreScrollRef.current = 0;
    setHasNewMaterials(false);
  }, [currentCacheKey]);

  useIsomorphicLayoutEffect(() => {
    if (!currentCacheKey || hasLoadedOnce) return;
    const cached = materialsPageCache.get(currentCacheKey) || readStoredMaterialsCache(currentCacheKey);
    if (!cached) return;
    materialsPageCache.set(currentCacheKey, cached);
    setItems(status === "available" ? cached.items.filter(item => !item.isSelected) : cached.items);
    setPagination(cached.pagination);
    setResolvedItemsKey(currentCacheKey);
    setMaterialStats(normalizeMaterialStats(cached.stats));
    restoreScrollRef.current = cached.scrollTop || 0;
    fetchedAtRef.current = cached.fetchedAt;
    setLoading(false);
    setHasLoadedOnce(true);
  }, [currentCacheKey, hasLoadedOnce, status]);

  const fetchItems = React.useCallback(
    async (page = 1, mode: "replace" | "append" = "replace", options?: { bypassCache?: boolean }) => {
      if (!statusReady) return false;
      const cacheKey = getMaterialsCacheKey(
        user ? String(user.id) : "guest",
        status,
        activeGroup,
        activeModelName,
        debouncedQ,
        timeFilter,
        mediaKindFilter
      );
      if (cacheKey !== currentItemsKeyRef.current) return true;
      if (
        mode === "append" &&
        (resolvedItemsKeyRef.current !== cacheKey || replaceInFlightRef.current?.cacheKey === cacheKey)
      ) {
        return false;
      }
      if (mode === "replace") itemsRequestGenerationRef.current += 1;
      const generation = itemsRequestGenerationRef.current;
      const isCurrentRequest = () =>
        generation === itemsRequestGenerationRef.current && cacheKey === currentItemsKeyRef.current;
      const releaseReplaceLock = () => {
        if (mode !== "replace") return;
        const owner = replaceInFlightRef.current;
        if (!owner || owner.generation !== generation || owner.cacheKey !== cacheKey) return;
        replaceInFlightRef.current = null;
        setReplaceInFlight((current) =>
          current?.generation === generation && current.cacheKey === cacheKey ? null : current
        );
      };

      if (mode === "replace") {
        const owner = { generation, cacheKey };
        replaceInFlightRef.current = owner;
        setReplaceInFlight(owner);
        setRefreshing((current) => isCurrentRequest() ? false : current);
      }

      // 登录态尚未校验完成时先别下结论：保持 loading 骨架，等 authLoading 结束后再判断是否已登录，
      // 避免刷新瞬间 user 还是 null 而误闪“请先登录”。
      if (authLoading) {
        releaseReplaceLock();
        return false;
      }
      const params = new URLSearchParams({
        view: "cards",
        page: String(page),
        pageSize: String(PAGE_SIZE),
        status,
      });
      if (debouncedQ) params.set("q", debouncedQ);
      if (activeModelName) {
        params.set("category", activeGroup);
        params.set("modelName", activeModelName);
      } else if (activeGroup === "ungrouped") params.set("category", MATERIAL_ASSET_UNCATEGORIZED);
      else if (activeGroup !== "all") params.set("category", activeGroup);
      const dateFrom = dateFromForTimeFilter(timeFilter);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (mediaKindFilter !== "all") params.set("mediaKind", mediaKindFilter);
      const requestScope = user ? String(user.id) : "guest";
      const headParams = new URLSearchParams(params);
      headParams.set("page", "1");
      listUrlRef.current = `/api/material-assets?${headParams.toString()}`;
      if (mode === "append" && paginationRef.current.nextCursor) params.set("cursor", paginationRef.current.nextCursor);


      const cached = !options?.bypassCache && page === 1 && mode === "replace"
        ? materialsPageCache.get(cacheKey) || readStoredMaterialsCache(cacheKey)
        : null;
      if (cached && isCurrentRequest()) {
        materialsPageCache.set(cacheKey, cached);
        // Occupied cards stay in place while browsing, but leave the available view on re-entry.
        setItems((current) => isCurrentRequest() ? status === "available" ? cached.items.filter(item => !item.isSelected) : cached.items : current);
        setPagination((current) => isCurrentRequest() ? cached.pagination : current);
        setResolvedItemsKey((current) => isCurrentRequest() ? cacheKey : current);
        setMaterialStats((current) => isCurrentRequest() ? normalizeMaterialStats(cached.stats) : current);
        restoreScrollRef.current = cached.scrollTop || 0;
        fetchedAtRef.current = cached.fetchedAt;
        setLoading((current) => isCurrentRequest() ? false : current);
        setHasLoadedOnce((current) => isCurrentRequest() ? true : current);
        // Entry reconciliation refreshes availability and announces new cards;
        // it must not discard loaded pages or move a returning reader.
        releaseReplaceLock();
        return true;
      }
      if (!isCurrentRequest()) return true;
      if (mode === "replace") setLoading((current) => isCurrentRequest() ? !cached && !hasLoadedOnce : current);
      else setRefreshing((current) => isCurrentRequest() ? true : current);
      setError((current) => isCurrentRequest() ? "" : current);
      setMessage((current) => isCurrentRequest() ? "" : current);
      try {
        const result = await (page === 1 && !options?.bypassCache ? takeMaterialsEntry : fetchJsonOnce)(`/api/material-assets?${params.toString()}`, requestScope);
        if (!isCurrentRequest()) return true;
        const json = result.json as { items?: MaterialItem[]; pagination?: Pagination; stats?: MaterialStats; error?: string } | null;
        if (!isCurrentRequest()) return true;
        if (!result.ok) throw new Error(json?.error || "素材库加载失败");
        const nextItems = Array.isArray(json?.items) ? json!.items! : [];
        setItems((prev) => {
          if (!isCurrentRequest()) return prev;
          if (mode !== "append") return nextItems;
          const existing = new Set(prev.map(item => item.id));
          return [...prev, ...nextItems.filter(item => !existing.has(item.id))];
        });
        fetchedAtRef.current = Date.now();
        if (mode === "replace") restoreScrollRef.current = 0;
        const nextPagination = { ...paginationRef.current, ...(json?.pagination || { page, pageSize: PAGE_SIZE, hasMore: false }) };
        const nextStats = normalizeMaterialStats(json?.stats);
        setPagination((current) => isCurrentRequest() ? nextPagination : current);
        if (mode === "replace" && isCurrentRequest()) {
          setResolvedItemsKey((current) => isCurrentRequest() ? cacheKey : current);
        }
        if (json?.stats) setMaterialStats((current) => isCurrentRequest() ? nextStats : current);
        if (page === 1 && mode === "replace" && isCurrentRequest()) {
          const entry = { items: nextItems, pagination: nextPagination, stats: nextStats, fetchedAt: Date.now() };
          materialsPageCache.set(cacheKey, entry);
          writeStoredMaterialsCache(cacheKey, entry);
        }
        return true;
      } catch (err: any) {
        if (!isCurrentRequest()) return true;
        setError((current) => isCurrentRequest() ? String(err?.message || "素材库加载失败") : current);
        return false;
      } finally {
        releaseReplaceLock();
        if (isCurrentRequest()) {
          setLoading((current) => isCurrentRequest() ? false : current);
          setRefreshing((current) => isCurrentRequest() ? false : current);
          setHasLoadedOnce((current) => isCurrentRequest() ? true : current);
        }
      }
    },
    [activeGroup, activeModelName, authLoading, debouncedQ, hasLoadedOnce, mediaKindFilter, status, statusReady, timeFilter, user]
  );

  React.useEffect(() => {
    if (!currentCacheKey || resolvedItemsKey !== currentCacheKey || !hasLoadedOnce) return;
    const previous = materialsPageCache.get(currentCacheKey);
    materialsPageCache.set(currentCacheKey, { items, pagination, stats: materialStats, fetchedAt: fetchedAtRef.current || previous?.fetchedAt || 0, scrollTop: previous?.scrollTop || 0 });
    if (materialsPageCache.size > 8) materialsPageCache.delete(materialsPageCache.keys().next().value!);
  }, [currentCacheKey, resolvedItemsKey, hasLoadedOnce, items, pagination, materialStats]);

  useIsomorphicLayoutEffect(() => {
    const node = scrollAreaRef.current;
    if (!node || resolvedItemsKey !== currentCacheKey || restoreScrollRef.current === null) return;
    const top = restoreScrollRef.current;
    // The masonry measures its columns after mount; restore after that layout.
    const frame = requestAnimationFrame(() => {
      node.scrollTop = top;
      node.dispatchEvent(new Event("scroll"));
      restoreScrollRef.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [currentCacheKey, resolvedItemsKey, items]);

  useIsomorphicLayoutEffect(() => {
    const node = scrollAreaRef.current;
    return () => {
      const entry = materialsPageCache.get(currentCacheKey);
      if (!entry || !node) return;
      entry.scrollTop = node.scrollTop;
      if (entry.items.length <= 600) writeStoredMaterialsCache(currentCacheKey, entry);
    };
  }, [currentCacheKey]);

  const refreshItems = React.useCallback(async () => {
    if (manualRefreshing) return;
    setManualRefreshing(true);
    setHasNewMaterials(false);
    restoreScrollRef.current = 0;
    try {
      await Promise.all([
        fetchGroups(),
        fetchItems(1, "replace", { bypassCache: true }),
      ]);
    } finally {
      setManualRefreshing(false);
    }
  }, [fetchGroups, fetchItems, manualRefreshing]);

  React.useEffect(() => {
    const consumeSidebarRefreshRequest = () => {
      try {
        if (!window.sessionStorage.getItem(MATERIALS_SIDEBAR_REFRESH_KEY)) return false;
        window.sessionStorage.removeItem(MATERIALS_SIDEBAR_REFRESH_KEY);
        return true;
      } catch {
        return false;
      }
    };
    const handleSidebarRefresh = () => {
      consumeSidebarRefreshRequest();
      if (statusReady) void refreshItems();
    };

    window.addEventListener("materials:refresh", handleSidebarRefresh);
    if (statusReady && consumeSidebarRefreshRequest()) void refreshItems();
    return () => window.removeEventListener("materials:refresh", handleSidebarRefresh);
  }, [refreshItems, statusReady]);

  // Reconcile the bounded render window, not every page visited in this session.
  // Scrolling into a different window schedules a new check; selection remains atomic on the server.
  const itemsRef = React.useRef<MaterialItem[]>(items);
  const activeItemRef = React.useRef(activeItem);
  activeItemRef.current = activeItem;
  const selectionSyncRef = React.useRef<{ scope: string; controller: AbortController; promise: Promise<void> } | null>(null);
  const selectionSyncEpochRef = React.useRef(0);
  React.useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  React.useEffect(() => () => {
    selectionSyncEpochRef.current++;
    selectionSyncRef.current?.controller.abort();
  }, [currentCacheKey]);

  const syncSelectionState = React.useCallback(async (): Promise<void> => {
    if (!user) return;
    const key = currentItemsKeyRef.current;
    const epoch = selectionSyncEpochRef.current;
    const cards = Array.from(scrollAreaRef.current?.querySelectorAll<HTMLElement>("[data-material-id]") || []);
    const area = scrollAreaRef.current?.getBoundingClientRect();
    // Prioritize the actual screen if a very large monitor renders more than 200 buffered cards.
    const ranked = cards.map(card => ({ id: Number(card.dataset.materialId), top: card.getBoundingClientRect().top }));
    if (area) ranked.sort((a, b) => Math.abs(a.top - (area.top + area.height / 2)) - Math.abs(b.top - (area.top + area.height / 2)));
    const ids = Array.from(new Set([...(activeItemRef.current ? [activeItemRef.current.id] : []), ...ranked.map(card => card.id)]))
      .filter(id => id > 0 && !selectingRef.current.has(id)).slice(0, 200);
    if (!ids.length) return;
    const scope = `${key}:${ids.join(",")}`;
    const previous = selectionSyncRef.current;
    if (previous) {
      if (previous.scope === scope && !previous.controller.signal.aborted) return previous.promise;
      // Invalidate old results without cancelling a fetch cloned by extensions.
      // Keep one request in flight, then reconcile the latest visible window.
      previous.controller.abort();
      await previous.promise.catch(() => undefined);
      if (key === currentItemsKeyRef.current && epoch === selectionSyncEpochRef.current) return syncSelectionState();
      return;
    }
    const controller = new AbortController();
    const versions = new Map(ids.map(id => [id, selectionVersionsRef.current.get(id) || 0]));
    const promise = (async () => {
      const res = await fetch(`/api/material-assets/selection-state?ids=${ids.join(",")}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (controller.signal.aborted || key !== currentItemsKeyRef.current) return;
      const fresh: Array<Partial<MaterialItem> & { id: number }> = json.items || [];
      const freshMap = new Map(fresh.map(item => [item.id, item]));
      const patch = (item: MaterialItem) => {
        const next = freshMap.get(item.id);
        if (versions.get(item.id) !== (selectionVersionsRef.current.get(item.id) || 0)) return item;
        if (!next || (item.isSelected === next.isSelected && item.isSelectedByMe === next.isSelectedByMe &&
          item.selectedBy?.id === next.selectedBy?.id && item.selectedBy?.selectedAt === next.selectedBy?.selectedAt &&
          item.selectedMediaId === next.selectedMediaId && item.downloadCount === next.downloadCount)) return item;
        return { ...item, ...next };
      };
      const patchList = (list: MaterialItem[]) => {
        let next: MaterialItem[] | null = null;
        list.forEach((item, index) => {
          const updated = patch(item);
          if (updated !== item) { next ||= list.slice(); next[index] = updated; }
        });
        return next || list;
      };
      setItems(patchList);
      setActiveItem(prev => prev ? patch(prev) : prev);
      for (const [cacheKey, entry] of materialsPageCache) {
        if (JSON.parse(cacheKey)[0] !== String(user.id)) continue;
        const next = patchList(entry.items);
        if (next !== entry.items) materialsPageCache.set(cacheKey, { ...entry, items: next });
      }
    })();
    selectionSyncRef.current = { scope, controller, promise };
    try { await promise; } finally {
      if (selectionSyncRef.current?.controller === controller) selectionSyncRef.current = null;
    }
  }, [user]);

  const syncLibrary = React.useCallback(async (checkNew = true) => {
    const key = currentItemsKeyRef.current;
    const url = listUrlRef.current;
    const generation = itemsRequestGenerationRef.current;
    if (!url || !key || resolvedItemsKeyRef.current !== key) return;
    await Promise.allSettled([
      syncSelectionState(),
      (async () => {
        const [head, summary] = await Promise.all([
          checkNew ? fetchJsonOnce(url, String(user?.id || "guest")) : Promise.resolve(null),
          fetchJsonOnce(url.replace("view=cards", "view=summary"), String(user?.id || "guest")),
        ]);
        if (key !== currentItemsKeyRef.current) return;
        if (summary.ok) {
          const data = summary.json as { total: number; stats: MaterialStats };
          setMaterialStats(normalizeMaterialStats(data.stats));
          setPagination(prev => ({ ...prev, total: data.total, totalPages: Math.max(1, Math.ceil(data.total / PAGE_SIZE)) }));
        }
        if (!head?.ok || generation !== itemsRequestGenerationRef.current || replaceInFlightRef.current?.cacheKey === key) return;
        const data = head.json as { items: MaterialItem[]; pagination: Pagination };
        const known = new Set(itemsRef.current.map(item => item.id));
        const added = data.items.some(item => !known.has(item.id));
        void fetchGroups();
        if (!added) return;
        // Never insert cards above the user's reading position.
        if ((scrollAreaRef.current?.scrollTop || 0) < 40) {
          // An old cursor response must not append into this new snapshot.
          itemsRequestGenerationRef.current += 1;
          setRefreshing(false);
          setItems(data.items);
          setPagination(prev => ({ ...prev, ...data.pagination }));
          fetchedAtRef.current = Date.now();
          setHasNewMaterials(false);
        } else setHasNewMaterials(true);
      })(),
    ]);
  }, [fetchGroups, syncSelectionState, user?.id]);

  React.useEffect(() => { void fetchGroups(); }, [fetchGroups]);
  React.useEffect(() => { void fetchItems(1, "replace"); }, [fetchItems]);
  const syncRef = React.useRef(syncLibrary);
  syncRef.current = syncLibrary;
  React.useEffect(() => {
    if (!user && hasLoadedOnce && resolvedItemsKey === currentCacheKey) void syncLibrary(false);
  }, [user, hasLoadedOnce, currentCacheKey, resolvedItemsKey, syncLibrary]);
  React.useEffect(() => {
    if (!user || !hasLoadedOnce || resolvedItemsKey !== currentCacheKey) return;
    let stopped = false, running = false, pending = false, pendingHead = false;
    let latestId = "";
    const sync = async (checkNew = true) => {
      if (stopped || document.visibilityState === "hidden") return;
      if (running) { pending = true; pendingHead ||= checkNew; return; }
      running = true;
      try { await syncRef.current(checkNew); } finally {
        running = false;
        if (pending && !stopped) {
          const head = pendingHead; pending = false; pendingHead = false;
          void sync(head);
        }
      }
    };
    const onChanged = (event: MessageEvent) => {
      let id = "";
      try { id = String(JSON.parse(event.data).revision || "").split(":").pop() || ""; } catch {}
      const checkNew = !id || !latestId || latestId !== id;
      latestId = id;
      void sync(checkNew);
    };
    const onVisible = () => { void sync(); };
    const source = typeof EventSource !== "undefined" ? new EventSource("/api/material-assets/events") : null;
    source?.addEventListener("changed", onChanged as EventListener);
    // Reconcile on entry/reconnect, with a slow fallback for unavailable streams.
    void sync(false);
    const interval = window.setInterval(onVisible, 15000);
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; source?.close(); clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, [user?.id, hasLoadedOnce, currentCacheKey, resolvedItemsKey]);

  const updateItem = React.useCallback((id: number, patch: Partial<MaterialItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    setActiveItem((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
  }, []);

  const chooseMaterial = React.useCallback(
    async (item: MaterialItem, mediaId?: string | null) => {
      if (!user) {
        openLoginModal();
        return;
      }
      if (busyIdsRef.current.has(item.id)) return;
      busyIdsRef.current.add(item.id);
      setBusyIds(new Set(busyIdsRef.current));
      selectionVersionsRef.current.set(item.id, (selectionVersionsRef.current.get(item.id) || 0) + 1);
      selectingRef.current.add(item.id);
      setError("");
      let failed = false;
      try {
        const res = await fetch(`/api/material-assets/${item.id}/select`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mediaId: mediaId || null }),
        });
        const json = (await res.json().catch(() => null)) as { item?: { selectedBy?: SelectedBy | null; selectedMediaId?: string | null }; error?: string } | null;
        if (!res.ok) {
          const owner = (json as { selectedBy?: SelectedBy | null } | null)?.selectedBy;
          if (res.status === 409 && owner) updateItem(item.id, { isSelected: true, isSelectedByMe: owner.id === Number(user.id), selectedBy: owner, selectedMediaId: owner.selectedMediaId });
          throw new Error(json?.error || "挑选素材失败");
        }
        updateItem(item.id, {
          selectedBy: json?.item?.selectedBy || { id: Number(user.id), username: user.username, selectedAt: new Date().toISOString(), selectedMediaId: mediaId || null },
          selectedMediaId: json?.item?.selectedMediaId || mediaId || null,
          isSelected: true,
          isSelectedByMe: true,
        });
      } catch (err: any) {
        failed = true;
        setError(String(err?.message || "挑选素材失败"));
      } finally {
        selectingRef.current.delete(item.id);
        selectionVersionsRef.current.set(item.id, (selectionVersionsRef.current.get(item.id) || 0) + 1);
        busyIdsRef.current.delete(item.id);
        setBusyIds(new Set(busyIdsRef.current));
        if (failed) void syncSelectionState().catch(() => {});
      }
    },
    [syncSelectionState, openLoginModal, updateItem, user]
  );

  const recordAndDownload = React.useCallback(
    async (item: MaterialItem) => {
      if (!user) {
        openLoginModal();
        return;
      }
      if (!item.isSelectedByMe) {
        setError("请先挑选素材后再下载");
        return;
      }
      if (busyIdsRef.current.has(item.id)) return;
      busyIdsRef.current.add(item.id);
      setBusyIds(new Set(busyIdsRef.current));
      setError("");
      try {
        const res = await fetch(`/api/material-assets/${item.id}/download`, { method: "POST" });
        const json = (await res.json().catch(() => null)) as { download?: DownloadRecord; downloadUrl?: string; error?: string } | null;
        if (!res.ok) throw new Error(json?.error || "下载记录失败");
        if (json?.download) {
          updateItem(item.id, {
            downloadCount: Number(item.downloadCount || 0) + 1,
            recentDownloads: [json.download, ...(item.recentDownloads || [])].slice(0, 8),
          });
        }
        if (!json?.downloadUrl) throw new Error("下载地址生成失败");
        downloadFile(json.downloadUrl, "");
      } catch (err: any) {
        setError(String(err?.message || "下载失败"));
      } finally {
        busyIdsRef.current.delete(item.id);
        setBusyIds(new Set(busyIdsRef.current));
      }
    },
    [openLoginModal, updateItem, user]
  );

  // 稳定引用的卡片回调：页面在滚动期间每帧重渲染（autoPagination 快照），
  // 内联箭头会让 MaterialCard 的 memo 失效，这里统一 useCallback 化。
  const handleOpenItem = React.useCallback((item: MaterialItem) => {
    setActiveItem(item);
    const selectionVersion = selectionVersionsRef.current.get(item.id) || 0;
    fetch(`/api/material-assets/${item.id}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.item && selectionVersion === (selectionVersionsRef.current.get(item.id) || 0)) updateItem(item.id, json.item);
      })
      .catch(() => undefined);
  }, [updateItem]);
  const handleChooseItem = React.useCallback((item: MaterialItem) => void chooseMaterial(item, item.displayMediaId || undefined), [chooseMaterial]);
  const handleDownloadItem = React.useCallback((item: MaterialItem) => void recordAndDownload(item), [recordAndDownload]);

  // 系列图收成一张卡：列表直接用 items（一个组一条），不再按子图摊平；翻看/挑选具体某张在弹窗里完成
  const displayItems = items;
  const currentStatusMetricLabel =
    status === "available"
      ? text("createDynamic.me41cedbd64d9")
      : status === "selected"
      ? text("createDynamic.m02d936ef17f6")
      : status === "mine"
      ? text("createDynamic.mcd721198e176")
      : text("createDynamic.ma58d0d9d2ae6");
  const autoPagination = useAutoPaginate({
    scrollRef: scrollAreaRef,
    enabled: Boolean(
      statusReady &&
      hasLoadedOnce &&
      !loading &&
      !manualRefreshing &&
      resolvedItemsKey === currentCacheKey &&
      replaceInFlight?.cacheKey !== currentCacheKey
    ),
    hasMore: pagination.hasMore,
    currentPage: pagination.page,
    loadPage: (page) => fetchItems(page, "append"),
    resetKey: currentCacheKey,
    preloadPx: scrollAhead + 1200,
    onScrollFrame: snapshot => {
      const now = performance.now();
      const prev = scrollMotionRef.current;
      const delta = snapshot.scrollTop - prev.top;
      if (delta) {
        const speed = Math.abs(delta) / Math.max(16, now - prev.at);
        scrollMotionRef.current = { top: snapshot.scrollTop, at: now, direction: delta > 0 ? 1 : -1 };
        const distance = Math.ceil(Math.min(6000, Math.max(snapshot.viewportHeight * 2, speed * 1000)) / 600) * 600;
        setScrollAhead(current => current === distance ? current : distance);
      }
    },
  });

  React.useEffect(() => {
    if (!user || !hasLoadedOnce || resolvedItemsKey !== currentCacheKey) return;
    const timer = window.setTimeout(() => { void syncSelectionState().catch(() => {}); }, 200);
    return () => window.clearTimeout(timer);
  }, [autoPagination.scrollTop, items.length, activeItem?.id, user, hasLoadedOnce, resolvedItemsKey, currentCacheKey, syncSelectionState]);

  return (
    <AtomicPageReveal ready={statusReady && !authLoading && hasLoadedOnce}>
    <main className="min-w-0 flex-1 overflow-hidden bg-[var(--app-bg)] text-[var(--app-fg)]">
      <div className="flex h-full min-h-0">
        {/* ─── Sidebar ─────────────────────────────────────────────── */}
        <aside className="hidden">
          <div className="px-5 pb-4 pt-6">
            <div className="text-[14px] font-semibold leading-tight text-[var(--app-fg)]"><UiText id="materials.m89e906481e9f" /></div>
            <div className="mt-1 text-[11px] text-[var(--app-muted)]"><UiText id="materials.m36b9e54905cb" /></div>
          </div>

          <div className="px-3">
            <div className="px-2 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--app-muted)]"><UiText id="materials.m515559957fd3" /></div>
            <div className="space-y-0.5">
              <UiProps ids={{"label":["materials.ma1054434857f"]}}><CategoryButton active={activeGroup === "all"} label="materials.ma1054434857f" count={pagination.total} onClick={() => handleCategoryChange("all")} /></UiProps>
              {groups.map((group) => (
                <CategoryButton key={group} active={activeGroup === group} label={group} onClick={() => handleCategoryChange(group)} />
              ))}
              {hasUngrouped && <UiProps ids={{"label":["materials.m54b89f901274"]}}><CategoryButton active={activeGroup === "ungrouped"} label="materials.m54b89f901274" onClick={() => handleCategoryChange("ungrouped")} /></UiProps>}
            </div>
          </div>

          <div className="mt-auto px-3 pb-5 pt-4">
            <div className="rounded-xl border border-[var(--border)] bg-gradient-to-br from-indigo-500/[0.06] via-violet-500/[0.04] to-transparent p-3">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--app-fg)]">
                <Lock className="h-3.5 w-3.5 text-indigo-500" strokeWidth={2.4} /><UiText id="materials.mb2fba2c67e1b" /></div>
              <p className="mt-1.5 text-[11px] leading-[1.65] text-[var(--app-muted)]"><UiText id="materials.m03263348a345" /></p>
            </div>
          </div>
        </aside>

        <section className="relative flex min-w-0 max-w-full flex-1 flex-col overflow-x-hidden">
          {/* ─── 滚动容器：header 固定其内，内容从下方滚过呈半透明（与管理端一致）── */}
          <div
            ref={scrollAreaRef} data-materials-scroll
            id="materials-list"
            onScroll={autoPagination.onScroll}
            // The native scrollbar keeps its gutter when hidden to avoid masonry reflow.
            className="auto-hide-scroll-area min-h-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto"
          >
            {/* ─── Header：sticky 固定 + 半透明磨砂 ── */}
            <div className="sticky top-0 z-20 max-w-full border-b border-[var(--border)] bg-[var(--app-bg)]/95 px-6 pb-4 pt-5 backdrop-blur-sm sm:px-8 sm:pt-6">
            <div className="flex max-w-full flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-3">
                <h1 className="text-[20px] font-semibold leading-7 tracking-tight text-[var(--app-fg)]"><UiText id="materials.m89e906481e9f" /></h1>
                <MaterialTools />
              </div>

              <div className="flex min-w-0 items-center gap-2">
                <div className="relative w-full sm:w-[300px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--app-muted)]" />
                  <UiProps ids={{"placeholder":["materials.m415e463d1a8c"]}}><input
                    value={q}
                    onChange={(event) => setQ(event.target.value)}
                    placeholder="materials.m415e463d1a8c"
                    className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] pl-9 pr-3 text-[13px] text-[var(--app-fg)] placeholder:text-[var(--app-muted)] outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/15"
                  /></UiProps>
                </div>
                {hasNewMaterials ? <button type="button" onClick={() => void refreshItems()} className="shrink-0 rounded-lg bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-500"><UiText id="materials.m571ec0809a5c" /></button> : null}
                <UiProps ids={{"title":["materials.maee887434131"]}}><button
                  type="button"
                  onClick={() => void refreshItems()}
                  title="materials.maee887434131"
                  disabled={manualRefreshing}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] transition hover:border-[var(--border-2)] hover:bg-[var(--panel-2)]"
                >
                  <RefreshCw className={["h-3.5 w-3.5", loading || refreshing || manualRefreshing ? "animate-spin" : ""].join(" ")} />
                </button></UiProps>
              </div>
            </div>

            {debouncedQ ? <div className="mt-2 text-xs text-[var(--app-muted)]"><UiText id="materials.m4f8cba38cc0e" />{statusOptions.find(option => option.key === status)?.label}<UiText id="materials.m603dfce53727" />{activeGroup === "all" ? <UiText id="materials.ma1054434857f" /> : activeGroup === "ungrouped" ? <UiText id="materials.m54b89f901274" /> : activeGroup}{activeModelName ? ` · ${activeModelName}` : ""} · {timeOptions.find(option => option.key === timeFilter)?.label}<UiText id="materials.m8b6ff498515b" /></div> : null}

            {/* 移动端分类切换 */}
            <div className="mt-3 flex max-w-full items-center gap-2 overflow-x-auto overflow-y-hidden pb-0.5">
              <div className="flex shrink-0 items-center gap-1.5">
              <UiProps ids={{"label":["materials.m5c55a67935af"]}}><CategoryPill active={activeGroup === "all"} label="materials.m5c55a67935af" onClick={() => handleCategoryChange("all")} /></UiProps>
              {groups.map((group) => (
                <CategoryPill key={group} active={activeGroup === group} label={group} onClick={() => handleCategoryChange(group)} />
              ))}
              {hasUngrouped && <UiProps ids={{"label":["materials.m54b89f901274"]}}><CategoryPill active={activeGroup === "ungrouped"} label="materials.m54b89f901274" onClick={() => handleCategoryChange("ungrouped")} /></UiProps>}
            </div>


              <MaterialsFilterPanel
                status={status}
                statusOptions={statusOptions}
                timeFilter={timeFilter}
                timeOptions={timeOptions}
                mediaKindFilter={mediaKindFilter}
                mediaKindOptions={mediaKindOptions}
                activeGroup={activeGroup}
                activeModelName={activeModelName}
                modelGroups={modelGroups}
                onStatusChange={(key) => {
                  if (!user && key === "mine") {
                    openLoginModal();
                    return;
                  }
                  setStatus(key);
                }}
                onTimeChange={setTimeFilter}
                onMediaKindChange={setMediaKindFilter}
                onModelChange={handleModelChange}
                onClear={() => {
                  setStatus("all");
                  setTimeFilter("all");
                  setMediaKindFilter("all");
                  setCategoryFilter((current) => ({ ...current, modelName: "" }));
                }}
              />

              {/* 数据指标 */}
              <div className="ml-auto flex shrink-0 items-center gap-1 rounded-2xl border border-black/[0.08] bg-white/28 p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.5),_0_14px_34px_-26px_rgba(15,23,42,0.55)] backdrop-blur-xl dark:border-white/[0.16] dark:bg-white/[0.085] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),_0_14px_34px_-24px_rgba(0,0,0,0.8)]">
                {status === "all" ? (
                  <>
                    <UiProps ids={{"label":["materials.ma58d0d9d2ae6"]}}><Metric label="materials.ma58d0d9d2ae6" value={materialStats.total} /></UiProps>
                    <UiProps ids={{"label":["materials.m7ecf1cde6486"]}}><Metric label="materials.m7ecf1cde6486" value={materialStats.selected} /></UiProps>
                    <UiProps ids={{"label":["materials.m537352400c49"]}}><Metric label="materials.m537352400c49" value={materialStats.available} accent /></UiProps>
                    <UiProps ids={{"label":["materials.m3005eadbbbcd"]}}><Metric label="materials.m3005eadbbbcd" value={materialStats.unselected} /></UiProps>
                  </>
                ) : (
                  <Metric label={currentStatusMetricLabel} value={pagination.total} accent />
                )}
              </div>
            </div>
          </div>

          {error ? (
            <div className="mx-6 mt-4 rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-4 py-2.5 text-[13px] text-rose-500 sm:mx-8">
              {localizeError(error)}
            </div>
          ) : null}
          {message ? (
            <div className="mx-6 mt-4 rounded-lg border border-indigo-500/20 bg-indigo-500/[0.06] px-4 py-2.5 text-[13px] text-indigo-500 sm:mx-8">
              {message}
            </div>
          ) : null}

          <div className="max-w-full px-6 py-5 sm:px-8">
            {authLoading ? (
              // 登录态校验中：先显示骨架，刷新时不再误闪“请先登录”
              <MaterialSkeleton />
            ) : items.length === 0 && error ? (
              <div role="status" className="py-12 text-center text-sm text-[var(--app-muted)]">
                <p><UiText id="materials.m51208d442920" /></p>
                <button type="button" onClick={() => void refreshItems()} className="mt-3 rounded-lg border border-[var(--border)] px-4 py-2 text-[var(--app-fg)]"><UiText id="materials.m8924c7887461" /></button>
              </div>
            ) : items.length === 0 && (!statusReady || !hasLoadedOnce || resolvedItemsKey !== currentCacheKey || replaceInFlight?.cacheKey === currentCacheKey || q.trim() !== debouncedQ) ? (
              <MaterialSkeleton />
            ) : items.length === 0 ? (
              <UiProps ids={{"title":["materials.m8f7af3e1678b"]}}><EmptyState
                title="materials.m8f7af3e1678b"
                body={text("createDynamic.m7becd1c66867")}
              /></UiProps>
            ) : (
              <>
                {status === "mine" ? (
                  <div className="space-y-8">
                    {groupItemsByMonth(displayItems, text, locale).map((group) => (
                      <section key={group.key}>
                        <div className="mb-3 flex items-center gap-2 border-b border-[var(--border)] pb-2 text-sm font-semibold text-[var(--app-fg)]">
                          <span>{group.label}</span>
                          <span className="text-[12px] font-normal text-[var(--app-muted)]">{group.items.length}<UiText id="materials.m7aaf96ad52e0" /></span>
                        </div>
                        <VirtualMaterialMasonry
                          items={group.items}
                          scrollContainerRef={scrollAreaRef}
                          busyIds={busyIds}
                          isAuthenticated={Boolean(user)}
                          scrollTop={autoPagination.scrollTop}
                          viewportHeight={autoPagination.viewportHeight}
                          virtualized
                          onOpen={handleOpenItem}
                          onChoose={handleChooseItem}
                          onDownload={handleDownloadItem}
                        />
                      </section>
                    ))}
                  </div>
                ) : (
                  <VirtualMaterialMasonry
                    items={displayItems}
                    scrollContainerRef={scrollAreaRef}
                    busyIds={busyIds}
                    isAuthenticated={Boolean(user)}
                    scrollTop={autoPagination.scrollTop}
                    viewportHeight={autoPagination.viewportHeight}
                    virtualized
                    lookAhead={scrollAhead}
                    direction={scrollMotionRef.current.direction}
                    onOpen={handleOpenItem}
                    onChoose={handleChooseItem}
                    onDownload={handleDownloadItem}
                  />
                )}

                {autoPagination.failedAppendPage ? (
                  <div className="flex justify-center py-7">
                    <button
                      type="button"
                      onClick={() => void autoPagination.retryAppend()}
                      disabled={autoPagination.appendInFlight}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-5 text-sm text-[var(--app-fg)] transition hover:bg-[var(--panel-3)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {autoPagination.appendInFlight ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}<UiText id="materials.m8924c7887461" /></button>
                  </div>
                ) : autoPagination.appendInFlight ? (
                  <div className="flex justify-center py-7 text-[12px] text-[var(--app-muted)]">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /><UiText id="materials.mb3cb3861e481" /></div>
                ) : !pagination.hasMore && displayItems.length > 0 ? (
                  <div className="flex justify-center py-7 text-[12px] text-[var(--app-muted)]"><UiText id="materials.m785351be2b87" />{pagination.total}<UiText id="materials.me87a3e641223" /></div>
                ) : null}
              </>
            )}
          </div>
          </div>
          <AutoHideScrollbar scrollRef={scrollAreaRef} />
        </section>
      </div>

      <ScrollToTopButton scrollContainerRef={scrollAreaRef} />

      {activeItem ? (
        <MaterialDetail
          item={activeItem}
          busy={busyIds.has(activeItem.id)}
          isAuthenticated={Boolean(user)}
          onClose={() => setActiveItem(null)}
          onChoose={(mediaId) => void chooseMaterial(activeItem, mediaId)}
          onDownload={() => void recordAndDownload(activeItem)}
        />
      ) : null}

    </main>
    </AtomicPageReveal>
  );
}

function CategoryButton({ active, label, count, onClick }: { active: boolean; label: string; count?: number; onClick: () => void }) {
  const { locale } = useUiLocale();
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "group relative flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition",
        active
          ? "bg-[var(--panel-3)] font-medium text-[var(--app-fg)] shadow-[inset_0_0_0_1px_var(--border)]"
          : "text-[var(--app-muted)] hover:bg-[var(--panel-2)]/70 hover:text-[var(--app-fg)]",
      ].join(" ")}
    >
      {/* 左侧细高亮条 —— Linear / Vercel 风格 */}
      <span
        aria-hidden
        className={[
          "absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--app-fg)] transition-opacity",
          active ? "opacity-100" : "opacity-0",
        ].join(" ")}
      />
      <span className="truncate">{label}</span>
      {typeof count === "number" ? (
        <span
          className={[
            "ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-md px-1.5 font-mono text-[11px] tabular-nums transition",
            active
              ? "bg-[var(--app-bg)] text-[var(--app-fg)]"
              : "text-[var(--app-muted)] group-hover:text-[var(--app-fg)]",
          ].join(" ")}
        >
          {locale === "en" ? count.toLocaleString("en") : count}
        </span>
      ) : null}
    </button>
  );
}

function CategoryPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "relative h-7 shrink-0 overflow-hidden rounded-full border px-3 text-[12px] font-medium transition active:translate-y-px",
        active
          ? "border-black/[0.09] bg-slate-50/70 font-semibold text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),_inset_0_-1px_0_rgba(15,23,42,0.1),_0_10px_18px_-12px_rgba(15,23,42,0.75)] backdrop-blur-xl dark:border-[var(--primary-bg)] dark:bg-[var(--primary-bg)] dark:text-[var(--primary-fg)] dark:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary-bg)_38%,transparent),_0_0_16px_color-mix(in_srgb,var(--primary-bg)_30%,transparent)]"
          : "border-black/[0.07] bg-white/28 text-[var(--app-muted)] shadow-[inset_0_1px_0_rgba(255,255,255,0.42),_0_6px_14px_-14px_rgba(15,23,42,0.45)] backdrop-blur-lg hover:border-black/[0.12] hover:bg-white/45 hover:text-[var(--app-fg)] dark:border-white/[0.16] dark:bg-white/[0.075] dark:text-[var(--app-fg)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] dark:hover:bg-white/[0.12]",
      ].join(" ")}
    >
      <span className="relative z-[1]">{label}</span>
    </button>
  );
}

function MaterialsFilterPanel({
  status,
  statusOptions,
  timeFilter,
  timeOptions,
  mediaKindFilter,
  mediaKindOptions,
  activeGroup,
  activeModelName,
  modelGroups,
  onStatusChange,
  onTimeChange,
  onMediaKindChange,
  onModelChange,
  onClear,
}: {
  status: StatusFilter;
  statusOptions: Array<{ key: StatusFilter; label: string; helper: string }>;
  timeFilter: TimeFilter;
  timeOptions: Array<{ key: TimeFilter; label: string }>;
  mediaKindFilter: MediaKindFilter;
  mediaKindOptions: Array<{ key: MediaKindFilter; label: string }>;
  activeGroup: string;
  activeModelName: string;
  modelGroups: ModelGroup[];
  onStatusChange: (key: StatusFilter) => void;
  onTimeChange: (key: TimeFilter) => void;
  onMediaKindChange: (key: MediaKindFilter) => void;
  onModelChange: (category: string, modelName: string) => void;
  onClear: () => void;
}) {
  const { text } = useUiLocale();
  const [open, setOpen] = React.useState(false);
  const [panelPos, setPanelPos] = React.useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const btnRef = React.useRef<HTMLButtonElement | null>(null);
  const activeCount =
    (status !== "all" ? 1 : 0) +
    (timeFilter !== "all" ? 1 : 0) +
    (mediaKindFilter !== "all" ? 1 : 0) +
    (activeModelName ? 1 : 0);
  const isFiltered = activeCount > 0;
  const visibleModelGroups = activeGroup === "all"
    ? modelGroups
    : activeGroup === "ungrouped"
      ? []
      : modelGroups.filter((group) => group.category === activeGroup);
  const closeAndFocusTrigger = React.useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => btnRef.current?.focus());
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 16;
      const width = Math.min(480, window.innerWidth - margin * 2);
      const contentLeft = document.querySelector("main")?.getBoundingClientRect().left ?? margin;
      const minLeft = Math.max(margin, contentLeft);
      const maxLeft = window.innerWidth - width - margin;
      const left = Math.min(Math.max(minLeft, rect.left), maxLeft);
      const top = rect.bottom + 8;
      setPanelPos({ top, left, maxHeight: Math.max(0, window.innerHeight - top - margin) });
    };
    place();
    // 面板挂在 body 上（绕开筛选行的 overflow 裁剪），所以滚动/缩放时直接收起，避免错位。
    const close = () => setOpen(false);
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && document.getElementById("materials-filter-panel")?.contains(target)) return;
      close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (document.getElementById("materials-filter-panel")?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndFocusTrigger();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [closeAndFocusTrigger, open]);

  return (
    <>
      <UiProps ids={{"title":["materials.mb5f15473fdc0"]}}><button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="materials.mb5f15473fdc0"
        aria-expanded={open}
        aria-controls="materials-filter-panel"
        className={[
          "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium backdrop-blur-xl transition active:translate-y-px",
          isFiltered
            ? "border-indigo-300/[0.5] bg-indigo-100/[0.5] text-indigo-700 dark:border-indigo-300/[0.28] dark:bg-indigo-400/[0.14] dark:text-indigo-200"
            : "border-black/[0.09] bg-slate-50/70 text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),_0_8px_16px_-12px_rgba(15,23,42,0.55)] dark:border-white/[0.16] dark:bg-white/[0.08] dark:text-white",
        ].join(" ")}
      >
        <Filter className="h-3.5 w-3.5 opacity-70" />
        <span><UiText id="materials.mb5f15473fdc0" /></span>
        <ChevronDown className={["h-3.5 w-3.5 opacity-60 transition-transform", open ? "rotate-180" : ""].join(" ")} />
      </button></UiProps>
      {open && panelPos && typeof document !== "undefined"
        ? createPortal(
            <div
              id="materials-filter-panel"
              style={{ position: "fixed", top: panelPos.top, left: panelPos.left, maxHeight: panelPos.maxHeight, zIndex: 60 }}
              className="w-[min(480px,calc(100vw-32px))] overflow-y-auto overscroll-contain rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4 text-[var(--app-fg)] shadow-[0_22px_60px_-24px_rgba(15,23,42,0.62)] backdrop-blur-xl"
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-[13px] font-semibold text-[var(--app-fg)]"><UiText id="materials.mb5f15473fdc0" /></div>
                <button
                  type="button"
                  onClick={() => {
                    onClear();
                    closeAndFocusTrigger();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
                >
                  <RotateCcw className="h-3.5 w-3.5" /><UiText id="materials.m28154c1bae22" /></button>
              </div>

              <UiProps ids={{"title":["materials.m6320b4a8722a"]}}><FilterSection title="materials.m6320b4a8722a">
                {statusOptions.map((option) => (
                  <FilterOptionButton
                    key={option.key}
                    active={status === option.key}
                    label={option.label}
                    title={option.helper}
                    onClick={() => {
                      onStatusChange(option.key);
                      closeAndFocusTrigger();
                    }}
                  />
                ))}
              </FilterSection></UiProps>

              <UiProps ids={{"title":["materials.m8b6ff498515b"]}}><FilterSection title="materials.m8b6ff498515b">
                {timeOptions.map((option) => (
                  <FilterOptionButton
                    key={option.key}
                    active={timeFilter === option.key}
                    label={option.label}
                    onClick={() => {
                      onTimeChange(option.key);
                      closeAndFocusTrigger();
                    }}
                  />
                ))}
              </FilterSection></UiProps>

              <UiProps ids={{"title":["materials.m6fb59aaef611"]}}><FilterSection title="materials.m6fb59aaef611">
                {mediaKindOptions.map((option) => (
                  <FilterOptionButton
                    key={option.key}
                    active={mediaKindFilter === option.key}
                    label={option.label}
                    onClick={() => {
                      onMediaKindChange(option.key);
                      closeAndFocusTrigger();
                    }}
                  />
                ))}
              </FilterSection></UiProps>

              {visibleModelGroups.map((group) => (
                <FilterSection key={group.category} title={text("createDynamic.m6fdca938fcdc", { name: group.category })}>
                  {group.models.map((modelName) => (
                    <FilterOptionButton
                      key={JSON.stringify([group.category, modelName])}
                      active={activeGroup === group.category && activeModelName === modelName}
                      label={modelName}
                      title={modelName}
                      onClick={() => {
                        onModelChange(group.category, modelName);
                        closeAndFocusTrigger();
                      }}
                    />
                  ))}
                </FilterSection>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 last:mb-0">
      <div className="mb-2 text-[13px] font-semibold text-[var(--app-fg)]">{title}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function FilterOptionButton({
  active,
  label,
  title,
  onClick,
}: {
  active: boolean;
  label: string;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      aria-pressed={active}
      className={[
        "inline-flex h-8 max-w-full min-w-[58px] items-center justify-center gap-1.5 rounded-lg border px-3 text-[12px] font-medium transition",
        active
          ? "border-indigo-500/35 bg-indigo-500/[0.12] text-indigo-600 dark:border-indigo-300/[0.28] dark:bg-indigo-400/[0.14] dark:text-indigo-200"
          : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-fg)] hover:border-indigo-500/25 hover:bg-indigo-500/[0.08] dark:border-white/[0.14] dark:bg-white/[0.075] dark:hover:bg-white/[0.12]",
      ].join(" ")}
    >
      <span className="min-w-0 truncate">{label}</span>
      {active ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
    </button>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  const { locale } = useUiLocale();
  return (
    <div
      className={[
        "relative flex h-8 min-w-[70px] flex-col justify-center overflow-hidden rounded-xl border px-2.5 transition",
        accent
          ? "border-indigo-300/[0.42] bg-indigo-100/[0.42] text-indigo-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.45),_inset_0_-1px_0_rgba(67,56,202,0.12),_0_8px_18px_-14px_rgba(67,56,202,0.72)] backdrop-blur-xl dark:border-indigo-300/[0.24] dark:bg-indigo-400/[0.12] dark:text-indigo-200 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),_0_8px_18px_-14px_rgba(0,0,0,0.8)]"
          : "border-black/[0.07] bg-white/38 text-[var(--app-fg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.45),_inset_0_-1px_0_rgba(15,23,42,0.07),_0_8px_18px_-16px_rgba(15,23,42,0.58)] backdrop-blur-xl dark:border-white/[0.16] dark:bg-white/[0.095] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.07),_0_8px_18px_-16px_rgba(0,0,0,0.75)]",
      ].join(" ")}
    >
      <div className={["relative z-[1] text-[9.5px] font-semibold leading-none", accent ? "text-indigo-500 dark:text-indigo-300" : "text-[var(--app-muted)]"].join(" ")}>{label}</div>
      <div
        className={[
          "relative z-[1] mt-0.5 font-mono text-[14px] font-semibold leading-none tabular-nums",
          accent ? "text-indigo-600 dark:text-indigo-200" : "text-[var(--app-fg)]",
        ].join(" ")}
      >
        {locale === "en" ? value.toLocaleString("en") : value}
      </div>
    </div>
  );
}

function VirtualMaterialMasonry({
  items,
  scrollContainerRef,
  busyIds,
  isAuthenticated,
  scrollTop,
  viewportHeight,
  virtualized = true,
  lookAhead = 2400,
  direction = 1,
  onOpen,
  onChoose,
  onDownload,
}: {
  items: MaterialItem[];
  scrollContainerRef: React.RefObject<HTMLElement | null>;
  busyIds: ReadonlySet<number>;
  isAuthenticated: boolean;
  scrollTop: number;
  viewportHeight: number;
  virtualized?: boolean;
  lookAhead?: number;
  direction?: number;
  onOpen: (item: MaterialItem) => void;
  onChoose: (item: MaterialItem) => void;
  onDownload: (item: MaterialItem) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = React.useState(0);
  const [containerOffsetTop, setContainerOffsetTop] = React.useState(0);

  React.useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const update = () => {
      const nodeRect = node.getBoundingClientRect();
      const scrollNode = scrollContainerRef.current;
      setContainerWidth(nodeRect.width);
      if (!scrollNode) {
        setContainerOffsetTop(0);
        return;
      }
      const scrollRect = scrollNode.getBoundingClientRect();
      setContainerOffsetTop(scrollNode.scrollTop + nodeRect.top - scrollRect.top);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") update();
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    if (scrollContainerRef.current) observer.observe(scrollContainerRef.current);
    window.addEventListener("resize", update);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [scrollContainerRef]);

  const layoutRatios = React.useRef(new Map<string, number>());
  const stableRatio = (item: MaterialItem) => {
    const key = materialDisplayKey(item);
    if (!layoutRatios.current.has(key)) layoutRatios.current.set(key, getMaterialAspectRatio(item));
    return layoutRatios.current.get(key)!;
  };
  const layoutSignature = React.useMemo(
    () => items.map((item) => `${item.id}:${stableRatio(item).toFixed(4)}`).join("|"),
    [items]
  );
  const layoutItems = React.useMemo(() => items, [layoutSignature]);
  const itemById = React.useMemo(() => new Map(items.map((item) => [materialDisplayKey(item), item] as const)), [items]);

  const layout = React.useMemo(() => {
    const count = Math.max(
      1,
      Math.floor((containerWidth + MATERIALS_MASONRY_GAP) / (MATERIALS_MASONRY_MIN_COLUMN_WIDTH + MATERIALS_MASONRY_GAP))
    );
    const width = containerWidth > 0
      ? (containerWidth - MATERIALS_MASONRY_GAP * (count - 1)) / count
      : MATERIALS_MASONRY_MIN_COLUMN_WIDTH;
    const columnHeights = Array.from({ length: count }, () => 0);
    const cards: Array<{ key: string; id: number; index: number; left: number; top: number; width: number; height: number; aspectRatio: number }> = [];

    layoutItems.forEach((item, index) => {
      const shortestHeight = Math.min(...columnHeights);
      // 几像素的比例误差不应打乱近似齐平的一行，否则末行空位会落在中间。
      const target = columnHeights.findIndex(height => height <= shortestHeight + MATERIALS_MASONRY_GAP);
      const layoutAspectRatio = stableRatio(item);
      const height = Math.max(120, width / layoutAspectRatio) + INSPIRATION_BLOCK_HEIGHT;
      const top = columnHeights[target];
      cards.push({
        key: materialDisplayKey(item),
        id: item.id,
        index,
        left: target * (width + MATERIALS_MASONRY_GAP),
        top,
        width,
        height,
        aspectRatio: layoutAspectRatio,
      });
      columnHeights[target] += height + MATERIALS_MASONRY_GAP;
    });

    return {
      cards,
      height: Math.max(0, ...columnHeights) - MATERIALS_MASONRY_GAP,
    };
  }, [containerWidth, layoutItems]);

  // Retain one screen behind and prepare more cards in the direction of travel.
  const overscan = Math.max(900, viewportHeight);
  const bufferedAhead = Math.min(4800, Math.max(1800, lookAhead));
  // 滚动锚点按 300px 步进量化：多数滚动帧 visibleTop/Bottom 不变，visibleCards 引用保持稳定，
  // 配合 MaterialCard 的 memo 让滚动期间跳过几乎全部卡片重渲染（overscan 远大于步长，不会漏卡）。
  const SCROLL_QUANT = 300;
  const anchor = virtualized ? Math.floor((scrollTop - containerOffsetTop) / SCROLL_QUANT) * SCROLL_QUANT : 0;
  const visibleTop = virtualized ? anchor - (direction < 0 ? bufferedAhead : overscan) : Number.NEGATIVE_INFINITY;
  const visibleBottom = virtualized ? anchor + viewportHeight + (direction > 0 ? bufferedAhead : overscan) + SCROLL_QUANT : Number.POSITIVE_INFINITY;
  const visibleCards = React.useMemo(
    () => layout.cards.filter((card) => card.top + card.height >= visibleTop && card.top <= visibleBottom),
    [layout.cards, visibleBottom, visibleTop]
  );

  return (
    <div ref={containerRef} className="relative w-full max-w-full" style={{ height: `${Math.max(1, layout.height)}px` }}>
      {visibleCards.map(({ key, id, index, left, top, width, height, aspectRatio }) => {
        const item = itemById.get(key);
        if (!item) return null;
        return (
          <div key={key} className="absolute" style={{ left, top, width, height }}>
            <MaterialCard
              item={item}
              aspectRatio={aspectRatio}
              eager={top + height >= anchor && top <= anchor + viewportHeight}
              mediaEnabled={top + height >= anchor - (direction < 0 ? bufferedAhead : 600) && top <= anchor + viewportHeight + (direction > 0 ? bufferedAhead : 600)}
              mediaPriority={top + height >= anchor && top <= anchor + viewportHeight ? 100000
                : (direction > 0 ? top >= anchor + viewportHeight : top + height <= anchor) ? 50000 - Math.min(30000, Math.round(direction > 0 ? top - anchor - viewportHeight : anchor - top - height)) : 10000}
              busy={busyIds.has(id)}
              isAuthenticated={isAuthenticated}
              onOpen={onOpen}
              onChoose={onChoose}
              onDownload={onDownload}
            />
          </div>
        );
      })}
    </div>
  );
}

function MaterialCardImage({ item, eager, enabled, priority }: { item: MaterialItem; eager: boolean; enabled: boolean; priority: number }) {
  const candidates = cardImageCandidates(item);
  const signature = candidates.join("|");
  const [readyKey, setReadyKey] = React.useState("");
  const ready = readyKey === signature || hasLoadedResilientImageCandidates(candidates);
  const subscription = React.useRef<ReturnType<typeof subscribeMaterialPreview> | null>(null);
  React.useEffect(() => {
    if (!enabled || ready) return;
    const cancel = subscribeMaterialPreview(candidates, priority, () => setReadyKey(signature));
    subscription.current = cancel;
    return () => { cancel(); subscription.current = null; };
  }, [enabled, signature, ready]);
  React.useEffect(() => { subscription.current?.setPriority(priority); }, [priority]);
  if (!ready) return <div className="h-full w-full bg-[var(--panel-3)]" />;
  return <ResilientImage
    candidates={cardImageCandidates(item)} alt={item.title}
    loading="eager" fetchPriority={eager ? "high" : "auto"}
    className="block h-full w-full object-contain transition-transform duration-300 ease-out group-hover:scale-[1.04]"
    hideUntilLoaded warmOnLoad={false}
    onLoad={event => rememberMaterialAspectRatio(materialDisplayKey(item), event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
  />;
}

// memo + item 级回调：滚动期间 visibleCards 引用稳定（见 SCROLL_QUANT 量化）时，
// 素材状态和布局宽高比不变时，React 跳过整棵卡片子树的重渲染。
const MaterialCard = React.memo(function MaterialCard({
  item,
  aspectRatio,
  eager,
  mediaEnabled,
  mediaPriority,
  busy,
  isAuthenticated,
  onOpen,
  onChoose,
  onDownload,
}: {
  item: MaterialItem;
  aspectRatio: number;
  eager: boolean;
  mediaEnabled: boolean;
  mediaPriority: number;
  busy: boolean;
  isAuthenticated: boolean;
  onOpen: (item: MaterialItem) => void;
  onChoose: (item: MaterialItem) => void;
  onDownload: (item: MaterialItem) => void;
}) {
  const { text, locale } = useUiLocale();
  const lockedByOther = Boolean(item.isSelected && !item.isSelectedByMe);
  const canDownload = Boolean(isAuthenticated && item.isSelectedByMe);
  const selectionBadge = getSelectionBadge(item, text, locale);
  // 系列图：整圈描靛蓝边 + 角标同色，一眼区分单图
  const isGroup = (item.mediaCount || 1) > 1;
  const cardVideoSrc = originalUrl(item);
  const isVideo = isMaterialVideo(item, cardVideoSrc);
  const cardVideoPoster = isVideo ? cardVideoPosterCandidates(item)[0] : "";
  const inspiration = item.inspiration?.trim() || "";
  return (
    <article
      data-material-id={item.id}
      className={[
        "group relative w-full max-w-full overflow-hidden rounded-2xl bg-[var(--panel-2)] shadow-[0_1px_2px_rgba(15,15,25,0.06)] transition duration-200 hover:shadow-[0_16px_36px_-16px_rgba(15,15,25,0.45)]",
        isGroup ? "border-2 border-indigo-500" : "border border-[var(--border)]",
      ].join(" ")}
    >
      <div className="relative">
      {/* 图片本体：点击打开大图；hover 时轻微放大 */}
      <button
        type="button"
        aria-label={item.title}
        onClick={() => onOpen(item)}
        className="relative block w-full max-w-full overflow-hidden bg-[var(--panel-3)] text-left"
        style={{ aspectRatio }}
      >
        {isVideo ? (mediaEnabled ? (
          <HoverPreviewVideo
            src={cardVideoSrc}
            posterSrc={cardVideoPoster}
            className="block h-full w-full object-contain transition-transform duration-300 ease-out group-hover:scale-[1.04]"
            eager
            deferFallback
          />
        ) : <div className="h-full w-full bg-[var(--panel-3)]" />) : (
          <MaterialCardImage item={item} eager={eager} enabled={mediaEnabled} priority={mediaPriority} />
        )}
      </button>

      {/* 顶部状态角标：常驻可见，方便一眼看出占用情况 */}
      <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1.5">
        {selectionBadge ? (
          <Badge tone={item.isSelectedByMe ? "green" : "amber"} title={selectionBadge.title} className="max-w-[132px] truncate">
            {selectionBadge.label}
          </Badge>
        ) : (
          <Badge tone="available"><UiText id="materials.me41cedbd64d9" /></Badge>
        )}
      </div>
      {isGroup ? (
        <div className="pointer-events-none absolute right-2 top-2">
          <span className="inline-flex items-center rounded-lg border border-white/20 bg-indigo-500 px-2 py-1 text-[12px] font-medium leading-none text-white shadow-[0_1px_2px_rgba(15,15,25,0.08)]"><UiText id="materials.m9bbfefa108cf" /></span>
        </div>
      ) : null}

      {/* 底部悬浮操作条：默认隐藏，hover 才淡入；操作按钮浮在图片下方 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 translate-y-1.5 opacity-0 transition-all duration-200 ease-out group-hover:translate-y-0 group-hover:opacity-100">
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
        <div className="pointer-events-none relative flex items-center gap-1.5 p-2.5 group-hover:pointer-events-auto">
          <div className="flex shrink-0 items-center gap-1.5">
            {/* 挑选后不提供取消入口，需重新上架请联系管理员 */}
            {item.isSelectedByMe ? null : (
              <UiProps ids={{"title":["materials.mfcd35ef7ff58","materials.mfeda6c03d2c9","materials.m5a67f96e9e1c","materials.mb3d6ea099110"]}}><button
                type="button"
                onClick={() => (isGroup ? onOpen(item) : onChoose(item))}
                disabled={busy || !isAuthenticated || lockedByOther}
                title={lockedByOther ? "materials.mfcd35ef7ff58" : !isAuthenticated ? "materials.mfeda6c03d2c9" : isGroup ? "materials.m5a67f96e9e1c" : "materials.mb3d6ea099110"}
                className="inline-flex h-8 items-center justify-center rounded-lg bg-indigo-500 px-3.5 text-[12.5px] font-semibold text-white shadow-[0_4px_12px_-4px_rgba(99,102,241,0.7)] transition hover:bg-indigo-400 active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/60 disabled:shadow-none"
              >
                {lockedByOther ? <UiText id="materials.m6087d10e5aec" /> : !isAuthenticated ? <UiText id="materials.md1a5a063c7e4" /> : <UiText id="materials.mb3d6ea099110" />}
              </button></UiProps>
            )}
            <UiProps ids={{"title":["materials.m4673a2306165","materials.m39cdeb4c999d","materials.m455ec9f95eb8"]}}><button type="button" onClick={() => onDownload(item)} disabled={busy || !canDownload} title={isAuthenticated ? (canDownload ? "materials.m4673a2306165" : "materials.m39cdeb4c999d") : "materials.m455ec9f95eb8"} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/20 bg-white/15 px-3 text-[12.5px] font-medium text-white backdrop-blur-md transition hover:bg-white/25 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}<UiText id="materials.m4673a2306165" /></button></UiProps>
          </div>
        </div>
      </div>
      </div>
      <div className="border-t border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-2">
        <div className={inspiration ? "" : "invisible"} aria-hidden={!inspiration}>
          <div className="h-[70px] border-l-2 border-indigo-500/70 bg-[var(--app-bg)]/80 px-2.5 py-1.5">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold leading-none text-indigo-600 dark:text-indigo-300">
              <Lightbulb className="h-3.5 w-3.5 shrink-0" /><UiText id="materials.m674a5c6c5653" /></div>
            <p
              className="line-clamp-2 min-h-[38px] text-[13px] font-medium leading-[1.45] text-[var(--app-fg)]"
              style={{ fontFamily: '"PingFang SC", "Microsoft YaHei", system-ui, -apple-system, BlinkMacSystemFont, sans-serif' }}
            >
              {inspiration || INSPIRATION_PLACEHOLDER_TEXT}
            </p>
          </div>
        </div>
      </div>
    </article>
  );
});

function getSelectionBadge(item: MaterialItem, text: ReturnType<typeof useUiLocale>["text"], locale: string) {
  if (!item.isSelected) return null;
  const username = item.selectedBy?.username?.trim();
  const status = item.isSelectedByMe ? text("createDynamic.mcd721198e176") : text("createDynamic.m255711c802de");
  const label = username ? `${status}: ${username}` : status;
  const time = formatTime(item.selectedBy?.selectedAt, locale);
  return {
    label,
    title: username ? `${status}: ${username}${time ? ` (${time})` : ""}` : status,
  };
}

function Badge({
  children,
  tone = "default",
  title,
  className = "",
}: {
  children: React.ReactNode;
  tone?: "default" | "green" | "amber" | "available";
  title?: string;
  className?: string;
}) {
  const cls =
    tone === "available"
      ? "border-white/35 bg-black/28 text-white shadow-[0_8px_22px_-14px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.22)]"
      : tone === "green"
      ? "border-white/35 bg-black/34 text-white shadow-[0_8px_22px_-14px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.22)]"
      : tone === "amber"
        ? "border-white/30 bg-black/38 text-white/90 shadow-[0_8px_22px_-14px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.18)]"
        : "border-black/[0.08] bg-white/85 text-neutral-700";
  return (
    <span
      className={["inline-flex min-w-0 items-center rounded-lg border px-2 py-1 text-[12px] font-medium leading-none shadow-[0_1px_2px_rgba(15,15,25,0.08)] backdrop-blur", cls, className].join(" ")}
      title={title}
    >
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

function EmptyState({ title, body, actionLabel, onAction }: { title: string; body: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="flex min-h-[460px] items-center justify-center">
      <div className="max-w-[360px] text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] shadow-[0_4px_16px_-4px_rgba(15,15,25,0.08)]">
          <ImageIcon className="h-6 w-6" strokeWidth={1.75} />
        </div>
        <div className="mt-5 text-[15px] font-semibold text-[var(--app-fg)]">{title}</div>
        <p className="mt-1.5 text-[13px] leading-[1.65] text-[var(--app-muted)]">{body}</p>
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="mt-5 inline-flex h-9 items-center rounded-lg bg-gradient-to-b from-indigo-500 to-indigo-600 px-4 text-[13px] font-medium text-white shadow-[0_4px_12px_-2px_rgba(99,102,241,0.4),_inset_0_1px_0_rgba(255,255,255,0.18)] transition hover:from-indigo-600 hover:to-indigo-700"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}


function MaterialDetail({
  item,
  busy,
  isAuthenticated,
  onClose,
  onChoose,
  onDownload,
}: {
  item: MaterialItem;
  busy: boolean;
  isAuthenticated: boolean;
  onClose: () => void;
  onChoose: (mediaId?: string | null) => void;
  onDownload: () => void;
}) {
  const { text, locale } = useUiLocale();
  const lockedByOther = Boolean(item.isSelected && !item.isSelectedByMe);
  const canDownload = Boolean(isAuthenticated && item.isSelectedByMe);
  const mediaItems = React.useMemo(() => materialMediaItems(item), [item]);
  const initialMediaId = item.displayMediaId || item.selectedMediaId;
  const initialSelectedIndex = mediaItems.findIndex((media) => media.id === initialMediaId);
  const [currentIndex, setCurrentIndex] = React.useState(initialSelectedIndex >= 0 ? initialSelectedIndex : 0);
  const manuallyNavigatedRef = React.useRef(false);
  const currentMedia = mediaItems[Math.min(currentIndex, Math.max(0, mediaItems.length - 1))];
  const mediaCandidates = React.useMemo(
    () => currentMedia ? [materialMediaOriginalUrl(currentMedia)] : originalMediaCandidates(item),
    [currentMedia, item],
  );
  const originalSrc = mediaCandidates[0] || null;
  const isVideo = isMaterialVideo(item, originalSrc);
  const [videoAspectRatio, setVideoAspectRatio] = React.useState(3 / 4);
  const isWideVideo = isVideo && videoAspectRatio >= 4 / 3;
  const [scale, setScale] = React.useState(1);
  const [tx, setTx] = React.useState(0);
  const [ty, setTy] = React.useState(0);
  const [panning, setPanning] = React.useState(false);
  const panRef = React.useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const imgWrapRef = React.useRef<HTMLDivElement | null>(null);
  const mobileImgWrapRef = React.useRef<HTMLDivElement | null>(null);

  const resetTransform = React.useCallback(() => {
    setScale(1);
    setTx(0);
    setTy(0);
    setPanning(false);
    panRef.current = null;
  }, []);

  React.useEffect(() => {
    resetTransform();
  }, [item.id, currentIndex, resetTransform]);

  React.useEffect(() => {
    setVideoAspectRatio(3 / 4);
  }, [item.id, currentIndex, originalSrc]);

  React.useEffect(() => {
    manuallyNavigatedRef.current = false;
  }, [item.id]);

  React.useEffect(() => {
    if (manuallyNavigatedRef.current) return;
    const nextSelectedIndex = mediaItems.findIndex((media) => media.id === (item.displayMediaId || item.selectedMediaId));
    setCurrentIndex(nextSelectedIndex >= 0 ? nextSelectedIndex : 0);
  }, [item.id, item.displayMediaId, item.selectedMediaId, mediaItems]);

  React.useEffect(() => {
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevHtmlOverscrollBehavior = document.documentElement.style.overscrollBehavior;
    const prevOverflow = document.body.style.overflow;
    const prevOverscrollBehavior = document.body.style.overscrollBehavior;
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "contain";
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "contain";
    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.documentElement.style.overscrollBehavior = prevHtmlOverscrollBehavior;
      document.body.style.overflow = prevOverflow;
      document.body.style.overscrollBehavior = prevOverscrollBehavior;
    };
  }, []);

  React.useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!panning || !panRef.current) return;
      setTx(panRef.current.tx + event.clientX - panRef.current.x);
      setTy(panRef.current.ty + event.clientY - panRef.current.y);
    };
    const onUp = () => {
      if (!panning) return;
      setPanning(false);
      panRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [panning]);

  const zoomFromWheel = React.useCallback((wrap: HTMLDivElement | null, clientX: number, clientY: number, deltaY: number) => {
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const px = clientX - rect.left - rect.width / 2 - tx;
    const py = clientY - rect.top - rect.height / 2 - ty;
    const nextScale = clamp(scale * (deltaY > 0 ? 0.9 : 1.1), MATERIAL_IMAGE_MIN_SCALE, MATERIAL_IMAGE_MAX_SCALE);
    const ratio = nextScale / scale;
    setScale(nextScale);
    setTx(tx - px * (ratio - 1));
    setTy(ty - py * (ratio - 1));
  }, [resetTransform, scale, tx, ty]);

  React.useEffect(() => {
    if (isVideo) return;
    const wraps = [imgWrapRef.current, mobileImgWrapRef.current].filter((value): value is HTMLDivElement => Boolean(value));
    if (!wraps.length) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      zoomFromWheel(event.currentTarget as HTMLDivElement, event.clientX, event.clientY, event.deltaY);
    };
    wraps.forEach((wrap) => wrap.addEventListener("wheel", onWheel, { passive: false }));
    return () => wraps.forEach((wrap) => wrap.removeEventListener("wheel", onWheel));
  }, [isVideo, zoomFromWheel]);

  const onImageMouseDown = React.useCallback((event: React.MouseEvent) => {
    if (isVideo || scale === 1) return;
    event.preventDefault();
    setPanning(true);
    panRef.current = { x: event.clientX, y: event.clientY, tx, ty };
  }, [isVideo, scale, tx, ty]);

  const stepZoom = React.useCallback((direction: "in" | "out") => {
    const nextScale = clamp(scale * (direction === "in" ? 1.25 : 0.8), MATERIAL_IMAGE_MIN_SCALE, MATERIAL_IMAGE_MAX_SCALE);
    setScale(nextScale);
    if (nextScale === 1) {
      setTx(0);
      setTy(0);
      setPanning(false);
      panRef.current = null;
    }
  }, [scale]);

  // 系列图：上一张/下一张
  const hasPrev = mediaItems.length > 1 && currentIndex > 0;
  const hasNext = mediaItems.length > 1 && currentIndex < mediaItems.length - 1;
  const goPrev = React.useCallback(() => {
    manuallyNavigatedRef.current = true;
    setCurrentIndex((i) => Math.max(0, i - 1));
  }, []);
  const goNext = React.useCallback(
    () => {
      manuallyNavigatedRef.current = true;
      setCurrentIndex((i) => Math.min(mediaItems.length - 1, i + 1));
    },
    [mediaItems.length]
  );

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowLeft" && currentIndex > 0) {
        event.preventDefault();
        goPrev();
      } else if (event.key === "ArrowRight" && currentIndex < mediaItems.length - 1) {
        event.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mediaItems.length, currentIndex, goPrev, goNext, onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={item.title} className="fixed inset-0 z-[90] flex items-center justify-center bg-transparent p-6" onMouseDown={onClose}>
      <div
        className={[
          "mx-auto flex h-[86vh] max-h-[820px] w-full max-w-[calc(100vw-3rem)] overflow-hidden rounded-[22px] border border-white/15 bg-[#f6f6f8] shadow-[0_30px_90px_-36px_rgba(0,0,0,0.85)] dark:bg-[#0e0e16] md:w-fit",
          isWideVideo ? "md:h-[72vh] md:max-h-[680px]" : "",
        ].join(" ")}
        onMouseDown={(event) => event.stopPropagation()}
        style={isVideo ? ({ "--media-aspect": videoAspectRatio } as React.CSSProperties) : undefined}
      >
        <div
          ref={imgWrapRef}
          className={["group relative hidden h-full shrink-0 select-none items-center justify-center overflow-hidden bg-[#111214] p-0 dark:bg-transparent md:flex", isVideo ? "aspect-[var(--media-aspect)]" : "aspect-[3/4]", !isVideo && scale !== 1 ? "cursor-grab" : !isVideo ? "cursor-zoom-in" : "", panning ? "cursor-grabbing" : ""].join(" ")}
          onMouseDown={onImageMouseDown}
          onDoubleClick={resetTransform}
        >
          {isVideo ? null : <InlineImageZoomControls scale={scale} onZoomIn={() => stepZoom("in")} onZoomOut={() => stepZoom("out")} onReset={resetTransform} />}
          {mediaItems.length > 1 ? (
            <div className="pointer-events-none absolute right-3 top-3 z-20 rounded-full bg-black/55 px-2.5 py-1 text-[12px] font-medium leading-none text-white backdrop-blur-sm">
              {currentIndex + 1}/{mediaItems.length}
            </div>
          ) : null}
          {hasPrev ? (
            <UiProps ids={{"aria-label":["materials.mbcf200709dbc"]}}><button
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={goPrev}
              aria-label="materials.mbcf200709dbc"
              className="absolute left-4 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 text-white opacity-0 backdrop-blur-sm transition duration-150 hover:bg-black/50 group-hover:opacity-100"
            >
              <ChevronLeft className="h-4 w-4" />
            </button></UiProps>
          ) : null}
          {hasNext ? (
            <UiProps ids={{"aria-label":["materials.mdcd4eb027369"]}}><button
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={goNext}
              aria-label="materials.mdcd4eb027369"
              className="absolute right-4 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 text-white opacity-0 backdrop-blur-sm transition duration-150 hover:bg-black/50 group-hover:opacity-100"
            >
              <ChevronRight className="h-4 w-4" />
            </button></UiProps>
          ) : null}
          <MediaDots count={mediaItems.length} activeIndex={currentIndex} />
          <div className="flex min-h-full min-w-full items-center justify-center">
            {isVideo && originalSrc ? (
              <AppVideoPlayer
                src={originalSrc}
                className="h-full max-h-[calc(86vh-2rem)] w-full object-contain bg-black"
                containerClassName="h-full w-full"
                playsInline
                preload="metadata"
                onNaturalSize={({ ratio }) => {
                  if (Number.isFinite(ratio) && ratio > 0) setVideoAspectRatio(ratio);
                }}
              />
            ) : originalSrc ? (
              <ResilientImage
                candidates={mediaCandidates}
                cacheInMemory={false}
                alt={item.title}
                className="pointer-events-none h-full w-full object-contain"
                draggable={false}
                style={{
                  transform: scale !== 1 || tx !== 0 || ty !== 0 ? `translate3d(${tx}px, ${ty}px, 0) scale(${scale})` : undefined,
                  transformOrigin: "center",
                }}
              />
            ) : (
              <ResilientImage candidates={mediaCandidates} alt={item.title} className="h-full w-full object-contain" cacheInMemory={false} />
            )}
          </div>
        </div>
        <div className="flex h-full w-full flex-col border-l border-black/[0.08] bg-[#f7f7f9] dark:border-white/10 dark:bg-[#0e0e16] md:w-[300px]">
          <div className="flex items-center justify-between border-b border-black/[0.07] dark:border-white/10 px-5 py-4">
            <div className="min-w-0">
              <div className="line-clamp-1 text-[15px] font-semibold tracking-tight text-[#101114] dark:text-white/90">{item.title}</div>
              <div className="mt-1 text-xs text-[#6f7280] dark:text-white/45">{item.category || <UiText id="materials.m54b89f901274" />}</div>
            </div>
            <UiProps ids={{"aria-label":["materials.m543aa424a7c1"]}}><button type="button" aria-label="materials.m543aa424a7c1" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full text-[#666a78] dark:text-white/55 transition hover:bg-black/[0.06] dark:hover:bg-white/10 hover:text-[#111214] dark:hover:text-white">
              <X className="h-4 w-4" />
            </button></UiProps>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div
              ref={mobileImgWrapRef}
              className={["relative w-full select-none overflow-hidden rounded-2xl bg-[#111214] dark:bg-transparent md:hidden", isVideo ? "" : "aspect-[4/3]", !isVideo && scale !== 1 ? "cursor-grab" : !isVideo ? "cursor-zoom-in" : "", panning ? "cursor-grabbing" : ""].join(" ")}
              style={isVideo ? { aspectRatio: videoAspectRatio } : undefined}
              onMouseDown={onImageMouseDown}
              onDoubleClick={resetTransform}
            >
              {isVideo ? null : <InlineImageZoomControls scale={scale} onZoomIn={() => stepZoom("in")} onZoomOut={() => stepZoom("out")} onReset={resetTransform} compact />}
              {mediaItems.length > 1 ? (
                <div className="pointer-events-none absolute right-2 top-2 z-20 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium leading-none text-white backdrop-blur-sm">
                  {currentIndex + 1}/{mediaItems.length}
                </div>
              ) : null}
              {hasPrev ? (
                <UiProps ids={{"aria-label":["materials.mbcf200709dbc"]}}><button
                  type="button"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={goPrev}
                  aria-label="materials.mbcf200709dbc"
                  className="absolute left-2 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur transition hover:bg-black/65"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button></UiProps>
              ) : null}
              {hasNext ? (
                <UiProps ids={{"aria-label":["materials.mdcd4eb027369"]}}><button
                  type="button"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={goNext}
                  aria-label="materials.mdcd4eb027369"
                  className="absolute right-2 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur transition hover:bg-black/65"
                >
                  <ChevronRight className="h-4 w-4" />
                </button></UiProps>
              ) : null}
              <MediaDots count={mediaItems.length} activeIndex={currentIndex} compact />
              <div className="flex h-full min-h-full min-w-full items-center justify-center p-3">
                {isVideo && originalSrc ? (
                  <AppVideoPlayer
                    src={originalSrc}
                    className="h-full w-full object-contain bg-black"
                    containerClassName="h-full w-full"
                    compact
                    playsInline
                    preload="metadata"
                    onNaturalSize={({ ratio }) => {
                      if (Number.isFinite(ratio) && ratio > 0) setVideoAspectRatio(ratio);
                    }}
                  />
                ) : originalSrc ? (
                  <ResilientImage
                    candidates={mediaCandidates}
                    cacheInMemory={false}
                    alt={item.title}
                    className="pointer-events-none h-full w-full object-contain"
                    draggable={false}
                    style={{
                      transform: scale !== 1 || tx !== 0 || ty !== 0 ? `translate3d(${tx}px, ${ty}px, 0) scale(${scale})` : undefined,
                      transformOrigin: "center",
                    }}
                  />
                ) : (
                  <ResilientImage candidates={mediaCandidates} alt={item.title} className="h-full w-full object-contain" cacheInMemory={false} />
                )}
              </div>
            </div>

            {item.inspiration ? (
              <div className="mt-4 rounded-xl border-l-2 border-indigo-500/70 bg-[var(--app-bg)]/80 px-3 py-2.5">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold leading-none text-indigo-600 dark:text-indigo-300">
                  <Lightbulb className="h-3.5 w-3.5 shrink-0" /><UiText id="materials.m674a5c6c5653" /></div>
                <p
                  className="whitespace-pre-wrap text-[13px] font-medium leading-[1.55] text-[var(--app-fg)]"
                  style={{ fontFamily: '"PingFang SC", "Microsoft YaHei", system-ui, -apple-system, BlinkMacSystemFont, sans-serif' }}
                >
                  {item.inspiration}
                </p>
              </div>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-2.5">
              {/* 挑选后不提供取消入口，需重新上架请联系管理员 */}
              {item.isSelectedByMe ? null : (
                <UiProps ids={{"title":["materials.mfcd35ef7ff58","materials.mfeda6c03d2c9","materials.m23d3020ab174"]}}><button
                  type="button"
                  onClick={() => onChoose(currentMedia?.id || null)}
                  disabled={busy || !isAuthenticated || lockedByOther}
                  title={lockedByOther ? "materials.mfcd35ef7ff58" : !isAuthenticated ? "materials.mfeda6c03d2c9" : "materials.m23d3020ab174"}
                  className="h-10 rounded-xl bg-[#111214] dark:bg-white/15 text-sm font-medium text-white shadow-[0_10px_24px_-18px_rgba(0,0,0,0.9)] transition hover:bg-[#25262b] dark:hover:bg-white/25 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#dedfe5] dark:disabled:bg-white/10 disabled:text-[#8b8e9a] dark:disabled:text-white/30 disabled:shadow-none"
                >
                  {lockedByOther ? <UiText id="materials.m880d1e6e636a" /> : !isAuthenticated ? <UiText id="materials.md1a5a063c7e4" /> : <UiText id="materials.m23d3020ab174" />}
                </button></UiProps>
              )}
              <UiProps ids={{"title":["materials.m4673a2306165","materials.m39cdeb4c999d","materials.m455ec9f95eb8"]}}><button type="button" onClick={onDownload} disabled={busy || !canDownload} title={isAuthenticated ? (canDownload ? "materials.m4673a2306165" : "materials.m39cdeb4c999d") : "materials.m455ec9f95eb8"} className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-black/[0.08] dark:border-white/15 bg-white/70 dark:bg-white/10 text-sm font-medium text-[#20222a] dark:text-white/85 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition hover:bg-white dark:hover:bg-white/20 disabled:cursor-not-allowed disabled:text-[#9a9da8] dark:disabled:text-white/30 disabled:opacity-60 ${item.isSelectedByMe ? "col-span-2" : ""}`}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {(item.mediaCount || mediaItems.length) > 1 ? <UiText id="materials.m7891f1a432a1" /> : <UiText id="materials.m4673a2306165" />}
              </button></UiProps>
            </div>

            <UiProps ids={{"title":["materials.m20de1be53143"]}}><InfoBlock
              title="materials.m20de1be53143"
              icon={<CheckCircle2 className="h-4 w-4" />}
              rows={[
                [text("createDynamic.m6320b4a8722a"), item.selectedBy ? (item.isSelectedByMe ? text("createDynamic.mcd721198e176") : text("createDynamic.m255711c802de")) : text("createDynamic.m985f26820f3d")],
                [text("createDynamic.m98f72eb5fa2a"), item.selectedBy?.username || "-"],
                [text("createDynamic.m6bf55dc2a48c"), formatTime(item.selectedBy?.selectedAt, locale)],
                [text("createDynamic.mf4925fccfa90"), item.selectedMediaId ? text("createDynamic.mc884db58cb6a", { index: Math.max(1, mediaItems.findIndex((media) => media.id === item.selectedMediaId) + 1) }) : "-"],
              ]}
            /></UiProps>
            <UiProps ids={{"title":["materials.m2f3104ef7dc4"]}}><InfoBlock
              title="materials.m2f3104ef7dc4"
              icon={<Download className="h-4 w-4" />}
              rows={[
                [text("createDynamic.m93588c0a42ab"), text("createDynamic.me6c66976bb47", { count: locale === "en" ? Number(item.downloadCount || 0).toLocaleString("en") : item.downloadCount || 0 })],
                ...((item.recentDownloads || []).length
                  ? (item.recentDownloads || []).map((record) => [record.username, formatTime(record.downloadedAt, locale)] as [string, string])
                  : [[text("createDynamic.m144da3490d50"), "-"] as [string, string]]),
              ]}
            /></UiProps>
            <UiProps ids={{"title":["materials.m558fa81a3ae6"]}}><InfoBlock
              title="materials.m558fa81a3ae6"
              icon={<Tag className="h-4 w-4" />}
              rows={[
                [text("createDynamic.m515559957fd3"), item.category || text("createDynamic.m54b89f901274")],
                [text("createDynamic.m50db7447b966"), formatSize(item.sizeBytes, locale) || "-"],
                [text("createDynamic.mde89171538fd"), formatTime(item.createdAt, locale)],
              ]}
            /></UiProps>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoBlock({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: Array<[string, string]> }) {
  return (
    <section className="mt-4 rounded-2xl border border-black/[0.07] dark:border-white/10 bg-white/58 dark:bg-white/[0.08] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.035)]">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-[#15161c] dark:text-white/90">
        <span className="text-[#5d6472] dark:text-white/50">{icon}</span>
        {title}
      </div>
      <div className="mt-3 space-y-2">
        {rows.map(([label, value], index) => (
          <div key={`${label}-${index}`} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="shrink-0 text-[#777b87] dark:text-white/45">{label}</span>
            <span className="min-w-0 truncate text-right font-medium text-[#17181f] dark:text-white/90">{value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function MediaDots({ count, activeIndex, compact = false }: { count: number; activeIndex: number; compact?: boolean }) {
  if (count <= 1) return null;
  return (
    <div
      className={[
        "pointer-events-none absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center justify-center gap-1 rounded-full bg-black/15 px-1.5 py-1 backdrop-blur-[2px]",
        compact ? "bottom-3 gap-0.5 px-1 py-0.5" : "",
      ].join(" ")}
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, index) => (
        <span
          key={index}
          className={[
            "block rounded-full transition-all duration-200",
            compact ? "h-1 w-1" : "h-1.5 w-1.5",
            index === activeIndex ? "bg-white opacity-100" : "bg-white/50 opacity-75",
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
  compact = false,
}: {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={[
        "absolute left-3 top-3 z-10 flex items-center gap-0.5 rounded-lg border border-white/25 bg-white/12 p-0.5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),_0_8px_20px_-12px_rgba(0,0,0,0.7)] backdrop-blur-md",
        compact ? "scale-90 origin-top-left" : "",
      ].join(" ")}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <UiProps ids={{"aria-label":["materials.m290f68030501"]}}><button
        type="button"
        onClick={onZoomOut}
        disabled={scale <= MATERIAL_IMAGE_MIN_SCALE}
        className="flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="materials.m290f68030501"
      >
        <ZoomOut className="h-3 w-3" />
      </button></UiProps>
      <div className="min-w-[34px] text-center text-[10px] tabular-nums text-white/90">{Math.round(scale * 100)}%</div>
      <UiProps ids={{"aria-label":["materials.m80f8fbcfa011"]}}><button
        type="button"
        onClick={onZoomIn}
        disabled={scale >= MATERIAL_IMAGE_MAX_SCALE}
        className="flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="materials.m80f8fbcfa011"
      >
        <ZoomIn className="h-3 w-3" />
      </button></UiProps>
      <UiProps ids={{"aria-label":["materials.mddde08946298"]}}><button
        type="button"
        onClick={onReset}
        disabled={scale === 1}
        className="flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="materials.mddde08946298"
      >
        <RotateCcw className="h-3 w-3" />
      </button></UiProps>
    </div>
  );
}
