"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { ChevronDown, Image as ImageIcon, Loader2, LogIn, Music2, Trash2, Upload, Video, X } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { HoverPreviewVideo } from "@/components/ui/hover-preview-video";
import { MediaLightbox } from "@/components/ui/media-lightbox";
import { ResilientImage, warmResilientImageCandidatesBatch } from "@/components/ui/resilient-image";
import { getWarmParams } from "@/lib/image-cache-config";
import { buildMediaOriginalUrl, buildMediaPreviewCandidates, buildMediaProxyUrl, isVideoMediaUrl, normalizeMediaUrl } from "@/lib/media-url";
import { MEDIA_LIBRARY_UNGROUPED } from "@/lib/media-library";
import { ProductFolderNavigation, ProductFolderPicker, updateProductFolders } from "@/components/media-library/product-folder-picker";
import type { ProductFolder } from "@/lib/media-library-folders";
import { openMediaLibraryPanel } from "@/lib/media-library-events";
import {
  getMediaLibraryDragSelection,
  resolveMediaLibraryModifierSelection,
  writeMediaLibraryDragItems,
} from "@/lib/media-library-drag";

type MediaLibraryScope = "shared" | "private";
type MediaLibraryKindFilter = "all" | "image" | "video";

type MediaLibraryViewer = {
  isAdmin: boolean;
  canUploadShared: boolean;
};

type MediaLibraryItem = {
  id: number;
  scope: MediaLibraryScope;
  kind: "image" | "video" | "audio";
  groupName?: string | null;
  title: string;
  fileUrl: string;
  thumbnailUrl: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  tags: string[];
  sortOrder: number;
  ownerUserId: number | null;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt?: string;
  canDelete: boolean;
};

type MediaLibraryResponse = {
  success?: boolean;
  viewer?: Partial<MediaLibraryViewer> | null;
  groups?: string[];
  hasUngrouped?: boolean;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  } | null;
  items?: MediaLibraryItem[];
  error?: string;
};

type UploadProgressItem = {
  id: string;
  fileName: string;
  file: File;
  folderId: string;
  loadedBytes: number;
  totalBytes: number;
  percent: number;
  status: "waiting" | "uploading" | "success" | "error";
  message?: string;
};

type MediaLibraryPanelProps = {
  open: boolean;
  onClose: () => void;
  keepMounted?: boolean;
};

const MEDIA_LIBRARY_PREFS_KEY = "media_library_panel_prefs_v1";
const MEDIA_LIBRARY_PAGE_SIZE = 5000;

const DEFAULT_VIEWER: MediaLibraryViewer = {
  isAdmin: false,
  canUploadShared: false,
};

const DEFAULT_PAGINATION = {
  page: 1,
  pageSize: MEDIA_LIBRARY_PAGE_SIZE,
  total: 0,
  totalPages: 1,
  hasMore: false,
};

type MediaLibraryPagination = typeof DEFAULT_PAGINATION;

type MediaLibraryListQuery = {
  scope: MediaLibraryScope;
  kind: MediaLibraryKindFilter;
  groupFilter: string;
  q: string;
  page: number;
  pageSize: number;
};

type MediaLibraryListCacheEntry = {
  viewer: MediaLibraryViewer;
  pagination: MediaLibraryPagination;
  items: MediaLibraryItem[];
  fetchedAt: number;
};

type MediaLibraryGroupsCacheEntry = {
  viewer: MediaLibraryViewer;
  groups: string[];
  hasUngrouped: boolean;
  fetchedAt: number;
};

const MEDIA_LIBRARY_PREFETCH_GROUP_LIMIT = 6;
const mediaLibraryListCache = new Map<string, MediaLibraryListCacheEntry>();
const mediaLibraryGroupsCache = new Map<string, MediaLibraryGroupsCacheEntry>();
const productFolderCache = new Map<string, { folders: ProductFolder[]; updatedAt: number }>();
const PRODUCT_FOLDER_CACHE_TTL = 30_000;
const mediaLibraryPrefetchingListKeys = new Set<string>();
const MEDIA_LIBRARY_MIN_HEIGHT = 28;
const MEDIA_LIBRARY_MIN_BOTTOM_PEEK = 0;
// 往上拉低于这个高度松手 → 自动收回顶部(收起)
const MEDIA_LIBRARY_COLLAPSE_THRESHOLD = 160;

function bytes(n: number, locale: string) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  if (locale === "en") {
    const digits = value >= 100 || index === 0 ? 0 : 1;
    return `${new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)} ${units[index]}`;
  }
  return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function pickPreviewCandidates(item: MediaLibraryItem) {
  if (item.kind === "audio") return [];
  if (item.kind === "video" && item.thumbnailUrl && !isVideoMediaUrl(item.thumbnailUrl)) {
    const posterCandidates = buildMediaPreviewCandidates(item.thumbnailUrl, {
      width: 1280,
      height: 720,
      mode: "cover",
    });
    return Array.from(new Set(posterCandidates.map((url) => buildMediaProxyUrl(url) || url)));
  }
  if (item.kind === "image") {
    // 网格只是 ~176px 小格子:显示用清晰缩略图(秒解码、省内存),原图仅作兜底。
    // 这样切到别的页面再回来打开面板,不必重新解码几 MB 原图 → 不再卡顿/像重载。
    // 注意:拖拽使用(dragStart)与灯箱看大图(pickMediaUrl)仍走原图,画质不受影响。
    const previews = buildMediaPreviewCandidates(item.fileUrl || item.thumbnailUrl || "", {
      width: 1280,
      height: 1280,
      mode: "cover",
    });
    const candidates = [item.thumbnailUrl || "", ...previews].filter(Boolean);
    return Array.from(new Set(candidates.map((url) => buildMediaProxyUrl(url) || url)));
  }
  const candidates = buildMediaPreviewCandidates(item.fileUrl || item.thumbnailUrl || "", {
    width: 1280,
    height: 720,
    mode: "cover",
  });
  return Array.from(new Set(candidates.map((url) => buildMediaProxyUrl(url) || url)));
}

function pickMediaUrl(item: MediaLibraryItem) {
  const raw = buildMediaOriginalUrl(item.fileUrl || item.thumbnailUrl || "");
  return buildMediaProxyUrl(raw) || raw;
}

function getMediaLibraryUserCacheId(user: unknown) {
  return String((user as any)?.id || "").trim() || "anonymous";
}

function getMediaLibraryListCacheKey(userId: string, query: MediaLibraryListQuery) {
  return [
    userId,
    query.scope,
    query.kind,
    query.groupFilter || "all",
    query.q.trim(),
    String(query.page),
    String(query.pageSize),
  ].join("|");
}

function getMediaLibraryGroupsCacheKey(userId: string, scope: MediaLibraryScope, kind: MediaLibraryKindFilter) {
  return [userId, scope, kind].join("|");
}

function buildMediaLibraryListParams(query: MediaLibraryListQuery) {
  const params = new URLSearchParams();
  params.set("scope", query.scope);
  params.set("kind", query.kind);
  if (query.groupFilter !== "all") params.set("groupName", query.groupFilter);
  if (query.q.trim()) params.set("q", query.q.trim());
  params.set("page", String(query.page));
  params.set("pageSize", String(query.pageSize));
  return params;
}

function buildMediaLibraryGroupsParams(scope: MediaLibraryScope, kind: MediaLibraryKindFilter) {
  const params = new URLSearchParams();
  params.set("scope", scope);
  params.set("kind", kind);
  return params;
}

function normalizeMediaLibraryViewer(json: MediaLibraryResponse | null | undefined): MediaLibraryViewer {
  return {
    isAdmin: Boolean(json?.viewer?.isAdmin),
    canUploadShared: Boolean(json?.viewer?.canUploadShared),
  };
}

function normalizeMediaLibraryPagination(json: MediaLibraryResponse | null | undefined, fallbackPageSize: number): MediaLibraryPagination {
  return {
    page: Math.max(1, Number(json?.pagination?.page) || 1),
    pageSize: Math.max(1, Number(json?.pagination?.pageSize) || fallbackPageSize),
    total: Math.max(0, Number(json?.pagination?.total) || 0),
    totalPages: Math.max(1, Number(json?.pagination?.totalPages) || 1),
    hasMore: Boolean(json?.pagination?.hasMore),
  };
}

export function MediaLibraryPanel({ open, onClose, keepMounted = false }: MediaLibraryPanelProps) {
  const { locale, text, error: localizeError } = useUiLocale();
  const { user, openLoginModal } = useAuth();
  const dataActive = open || keepMounted;
  const userStorageKey = React.useMemo(() => {
    const userId = String((user as any)?.id || "").trim();
    return userId ? `${MEDIA_LIBRARY_PREFS_KEY}:${userId}` : "";
  }, [user]);
  const [scope, setScope] = React.useState<MediaLibraryScope>("shared");
  const [kind, setKind] = React.useState<MediaLibraryKindFilter>("all");
  const [q, setQ] = React.useState("");
  const [viewer, setViewer] = React.useState<MediaLibraryViewer>(DEFAULT_VIEWER);
  const [pagination, setPagination] = React.useState(DEFAULT_PAGINATION);
  const [page, setPage] = React.useState(1);
  const [panelHeightPx, setPanelHeightPx] = React.useState(560);
  const [panelMaxHeightPx, setPanelMaxHeightPx] = React.useState(560);
  const [panelResizing, setPanelResizing] = React.useState(false);
  const [items, setItems] = React.useState<MediaLibraryItem[]>([]);
  const [groups, setGroups] = React.useState<string[]>([]);
  const [hasUngrouped, setHasUngrouped] = React.useState(false);
  const [groupFilter, setGroupFilter] = React.useState<string>("all");
  const [productFolders, setProductFoldersState] = React.useState<ProductFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = React.useState(false);
  const [foldersError, setFoldersError] = React.useState("");
  const [uploadFolderOpen, setUploadFolderOpen] = React.useState(false);
  const uploadFolderRef = React.useRef<string>(MEDIA_LIBRARY_UNGROUPED);
  const [prefsHydrated, setPrefsHydrated] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [uploadProgressItems, setUploadProgressItems] = React.useState<UploadProgressItem[]>([]);
  const [uploadProgressCollapsed, setUploadProgressCollapsed] = React.useState(false);
  const [uploadAutoClear, setUploadAutoClear] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<MediaLibraryItem | null>(null);
  const [moveTarget, setMoveTarget] = React.useState<MediaLibraryItem | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<number[]>([]);
  const [selectionMode, setSelectionMode] = React.useState(false);
  const [batchMoveOpen, setBatchMoveOpen] = React.useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = React.useState(false);
  const [lightbox, setLightbox] = React.useState<{ open: boolean; itemId: number | null; src: string | null; kind: "image" | "video"; title: string }>({
    open: false,
    itemId: null,
    src: null,
    kind: "image",
    title: "",
  });
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const collapseTimerRef = React.useRef<number | null>(null);
  const clearTimerRef = React.useRef<number | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const libraryDragActiveRef = React.useRef(false);
  const panelResizeRef = React.useRef<{ startY: number; startHeight: number } | null>(null);
  const resizeHeightRef = React.useRef<number | null>(null);
  const selectedIdsRef = React.useRef<number[]>([]);
  const lastSelectedIdRef = React.useRef<number | null>(null);
  const dragSelectingRef = React.useRef(false);
  const dragSelectionModeRef = React.useRef<"select" | "deselect" | null>(null);
  const gridRef = React.useRef<HTMLDivElement | null>(null);
  const scrollAreaRef = React.useRef<HTMLDivElement | null>(null);
  const cardRefs = React.useRef<Record<number, HTMLDivElement | null>>({});
  const listCacheRef = React.useRef(mediaLibraryListCache);
  const groupsCacheRef = React.useRef(mediaLibraryGroupsCache);
  const activeListKeyRef = React.useRef("");
  const listAbortRef = React.useRef<AbortController | null>(null);
  const groupsAbortRef = React.useRef<AbortController | null>(null);
  const prefetchingListKeysRef = React.useRef(mediaLibraryPrefetchingListKeys);
  const boxSelectingRef = React.useRef(false);
  const boxSelectionBaseRef = React.useRef<number[]>([]);
  const boxSelectionOriginRef = React.useRef<{ x: number; y: number } | null>(null);
  const [selectionBox, setSelectionBox] = React.useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const canUploadCurrentScope = scope === "private" ? Boolean(user) : false;
  const canManageCurrentScope = scope === "private";
  const userCacheId = React.useMemo(() => getMediaLibraryUserCacheId(user), [user]);
  const setProductFolders = React.useCallback((folders: ProductFolder[]) => {
    productFolderCache.set(userCacheId, { folders, updatedAt: Date.now() });
    if (productFolderCache.size > 20) productFolderCache.delete(productFolderCache.keys().next().value!);
    setProductFoldersState(folders);
    setFoldersLoading(false); setFoldersError("");
  }, [userCacheId]);
  React.useEffect(() => {
    const cached = productFolderCache.get(userCacheId);
    setProductFoldersState(cached?.folders || []);
    setFoldersLoading(false); setFoldersError("");
    if (!open || scope !== "private" || !user) return;
    if (cached && Date.now() - cached.updatedAt < PRODUCT_FOLDER_CACHE_TTL) return;
    const controller = new AbortController();
    setFoldersLoading(!cached);
    void fetch("/api/media-library/folders", { cache: "no-store", signal: controller.signal }).then(async response => {
      const payload = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(payload.error || "目录加载失败");
      // A mutation may have supplied newer folders while this request was pending.
      if (productFolderCache.get(userCacheId) !== cached) return;
      setProductFolders(payload.folders);
    }).catch(cause => { if (!controller.signal.aborted && !productFolderCache.has(userCacheId)) setFoldersError(cause.message || "目录加载失败"); })
      .finally(() => { if (!controller.signal.aborted) setFoldersLoading(false); });
    return () => controller.abort();
  }, [open, scope, userCacheId, setProductFolders]);
  const currentListQuery = React.useMemo<MediaLibraryListQuery>(
    () => ({
      scope,
      kind,
      groupFilter,
      q,
      page,
      pageSize: MEDIA_LIBRARY_PAGE_SIZE,
    }),
    [groupFilter, kind, page, q, scope]
  );

  // SW 注册已集中到 components/system/service-worker-registration.tsx，由 app/layout.tsx 顶层挂载

  React.useEffect(() => {
    if (!dataActive) {
      setPrefsHydrated(false);
      return;
    }
    if (!userStorageKey) {
      setPrefsHydrated(true);
      return;
    }
    try {
      const raw = window.localStorage.getItem(userStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<{
          scope: MediaLibraryScope;
          kind: MediaLibraryKindFilter;
          groupFilter: string;
          q: string;
          panelHeightPx: number;
        }>;
        if (parsed.scope === "shared" || parsed.scope === "private") setScope(parsed.scope);
        if (parsed.kind === "all" || parsed.kind === "image" || parsed.kind === "video") setKind(parsed.kind);
        if (typeof parsed.groupFilter === "string" && parsed.groupFilter.trim()) {
          setGroupFilter(parsed.groupFilter.trim());
        }
        if (typeof parsed.q === "string") setQ(parsed.q);
        if (Number.isFinite(parsed.panelHeightPx) && Number(parsed.panelHeightPx) >= MEDIA_LIBRARY_MIN_HEIGHT) {
          setPanelHeightPx(Math.round(Number(parsed.panelHeightPx)));
        }
      }
    } catch {}
    setPrefsHydrated(true);
  }, [dataActive, userStorageKey]);

  React.useEffect(() => {
    if (!open || !prefsHydrated || !userStorageKey) return;
    // 拖拽过程中高度在不断变小，不要把这些中间值（甚至收起阈值以下的极小值）写进 localStorage，
    // 否则收起后再展开会读回这个极小高度，看起来像“没展示出来”。只在拖拽结束后持久化最终高度。
    if (panelResizing) return;
    try {
      window.localStorage.setItem(
        userStorageKey,
        JSON.stringify({
          scope,
          kind,
          groupFilter,
          q,
          panelHeightPx,
        })
      );
    } catch {}
  }, [groupFilter, kind, open, panelHeightPx, panelResizing, prefsHydrated, q, scope, userStorageKey]);

  React.useEffect(() => {
    if (!open) return;
    const syncPanelBounds = () => {
      const hostHeight = hostRef.current?.getBoundingClientRect().height || window.innerHeight;
      const nextMaxHeight = Math.max(MEDIA_LIBRARY_MIN_HEIGHT, Math.round(hostHeight - MEDIA_LIBRARY_MIN_BOTTOM_PEEK));
      setPanelMaxHeightPx(nextMaxHeight);
      setPanelHeightPx((prev) => {
        const fallback = Math.min(Math.max(Math.round(hostHeight * 0.72), MEDIA_LIBRARY_MIN_HEIGHT), nextMaxHeight);
        const base = Number.isFinite(prev) && prev > 0 ? prev : fallback;
        return Math.min(Math.max(Math.round(base), MEDIA_LIBRARY_MIN_HEIGHT), nextMaxHeight);
      });
    };
    syncPanelBounds();
    window.addEventListener("resize", syncPanelBounds);
    return () => window.removeEventListener("resize", syncPanelBounds);
  }, [open]);

  React.useEffect(() => {
    if (!open || !panelResizing) return;
    const onPointerMove = (event: PointerEvent) => {
      const current = panelResizeRef.current;
      if (!current) return;
      const nextHeight = Math.min(
        Math.max(Math.round(current.startHeight + (event.clientY - current.startY)), MEDIA_LIBRARY_MIN_HEIGHT),
        panelMaxHeightPx
      );
      resizeHeightRef.current = nextHeight;
      setPanelHeightPx(nextHeight);
    };
    const stopResize = () => {
      setPanelResizing(false);
      panelResizeRef.current = null;
      const finalHeight = resizeHeightRef.current;
      resizeHeightRef.current = null;
      // 拉到阈值以下松手 → 自动收回顶部(收起);同时把高度复位到合适值,便于下次展开
      if (finalHeight != null && finalHeight < MEDIA_LIBRARY_COLLAPSE_THRESHOLD) {
        setPanelHeightPx(Math.max(MEDIA_LIBRARY_MIN_HEIGHT, Math.round(panelMaxHeightPx * 0.7)));
        onClose();
      }
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize, { once: true });
    window.addEventListener("pointercancel", stopResize, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, [open, panelMaxHeightPx, panelResizing]);

  const fetchMediaLibraryList = React.useCallback(
    async (query: MediaLibraryListQuery, signal?: AbortSignal): Promise<MediaLibraryListCacheEntry> => {
      const params = buildMediaLibraryListParams(query);
      const res = await fetch(`/api/media-library?${params.toString()}`, { signal }).catch((error) => {
        if ((error as any)?.name === "AbortError") throw error;
        return null;
      });

      if (!res) {
        throw new Error("素材库加载失败");
      }

      const json = (await res.json().catch(() => null)) as MediaLibraryResponse | null;
      if (!res.ok) {
        throw new Error(String(json?.error || "素材库加载失败"));
      }

      return {
        viewer: normalizeMediaLibraryViewer(json),
        pagination: normalizeMediaLibraryPagination(json, query.pageSize),
        items: Array.isArray(json?.items) ? json!.items : [],
        fetchedAt: Date.now(),
      };
    },
    []
  );

  const fetchMediaLibraryGroups = React.useCallback(
    async (signal?: AbortSignal): Promise<MediaLibraryGroupsCacheEntry> => {
      const params = buildMediaLibraryGroupsParams(scope, kind);
      const res = await fetch(`/api/media-library/groups?${params.toString()}`, { signal }).catch((error) => {
        if ((error as any)?.name === "AbortError") throw error;
        return null;
      });

      if (!res) {
        throw new Error("素材分类加载失败");
      }

      const json = (await res.json().catch(() => null)) as MediaLibraryResponse | null;
      if (!res.ok) {
        throw new Error(String(json?.error || "素材分类加载失败"));
      }

      return {
        viewer: normalizeMediaLibraryViewer(json),
        groups: Array.isArray(json?.groups) ? json.groups.filter(Boolean) : [],
        hasUngrouped: Boolean(json?.hasUngrouped),
        fetchedAt: Date.now(),
      };
    },
    [kind, scope]
  );

  const refreshGroups = React.useCallback(
    async (options: { force?: boolean } = {}) => {
      if (!dataActive || !prefsHydrated) return;
      // 共享库匿名可看；私有/全部仍需登录
      if (!user && scope !== "shared") return;

      const cacheKey = getMediaLibraryGroupsCacheKey(userCacheId, scope, kind);
      const cached = groupsCacheRef.current.get(cacheKey);
      if (cached && !options.force) {
        setViewer(cached.viewer);
        setGroups(cached.groups);
        setHasUngrouped(cached.hasUngrouped);
        setGroupFilter(current => current === "all" || (current === MEDIA_LIBRARY_UNGROUPED ? cached.hasUngrouped : cached.groups.includes(current)) ? current : "all");
        return;
      }

      groupsAbortRef.current?.abort();
      const controller = new AbortController();
      groupsAbortRef.current = controller;

      try {
        const next = await fetchMediaLibraryGroups(controller.signal);
        groupsCacheRef.current.set(cacheKey, next);
        if (groupsAbortRef.current !== controller) return;
        setViewer(next.viewer);
        setGroups(next.groups);
        setHasUngrouped(next.hasUngrouped);
        setGroupFilter(current => current === "all" || (current === MEDIA_LIBRARY_UNGROUPED ? next.hasUngrouped : next.groups.includes(current)) ? current : "all");
      } catch (error: any) {
        if (error?.name !== "AbortError") {
          setError((prev) => prev || String(error?.message || "素材分类加载失败"));
        }
      } finally {
        if (groupsAbortRef.current === controller) {
          groupsAbortRef.current = null;
        }
      }
    },
    [dataActive, fetchMediaLibraryGroups, kind, prefsHydrated, scope, user, userCacheId]
  );

  const refreshItems = React.useCallback(async (options: { force?: boolean; background?: boolean } = {}) => {
    if (!dataActive) return;
    if (!prefsHydrated) return;
    // 共享库匿名可看；私有/全部仍需登录
    if (!user && scope !== "shared") {
      setItems([]);
      setGroups([]);
      setHasUngrouped(false);
      setViewer(DEFAULT_VIEWER);
      setPagination(DEFAULT_PAGINATION);
      setLoading(false);
      setRefreshing(false);
      setError("请先登录后查看素材库");
      return;
    }

    const query = currentListQuery;
    const cacheKey = getMediaLibraryListCacheKey(userCacheId, query);
    activeListKeyRef.current = cacheKey;
    const cached = listCacheRef.current.get(cacheKey);

    if (cached && !options.force) {
      setViewer(cached.viewer);
      setPagination(cached.pagination);
      setItems(cached.items);
      setLoading(false);
      setError(null);
      setRefreshing(false);
      return;
    }

    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    setError(null);
    setLoading(!cached && !options.background);
    setRefreshing(Boolean(cached || options.background));

    try {
      const next = await fetchMediaLibraryList(query, controller.signal);
      listCacheRef.current.set(cacheKey, next);
      if (activeListKeyRef.current !== cacheKey) return;
      setViewer(next.viewer);
      setPagination(next.pagination);
      setItems(next.items);
      setError(null);
    } catch (error: any) {
      if (error?.name !== "AbortError" && activeListKeyRef.current === cacheKey) {
        if (!cached) {
          setItems([]);
          setPagination(DEFAULT_PAGINATION);
        }
        setError(String(error?.message || "素材库加载失败"));
      }
    } finally {
      if (listAbortRef.current === controller) {
        listAbortRef.current = null;
      }
      if (activeListKeyRef.current === cacheKey) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [currentListQuery, dataActive, fetchMediaLibraryList, prefsHydrated, user, userCacheId]);

  const prefetchGroupItems = React.useCallback(
    async (nextGroupFilter: string) => {
      if (!dataActive || !prefsHydrated || !user) return;
      if (q.trim()) return;

      const query: MediaLibraryListQuery = {
        scope,
        kind,
        groupFilter: nextGroupFilter,
        q: "",
        page: 1,
        pageSize: MEDIA_LIBRARY_PAGE_SIZE,
      };
      const cacheKey = getMediaLibraryListCacheKey(userCacheId, query);
      const cached = listCacheRef.current.get(cacheKey);
      if (cached) return;
      if (prefetchingListKeysRef.current.has(cacheKey)) return;

      prefetchingListKeysRef.current.add(cacheKey);
      try {
        const next = await fetchMediaLibraryList(query);
        listCacheRef.current.set(cacheKey, next);
      } catch {
        // Prefetch is best-effort; foreground requests surface errors.
      } finally {
        prefetchingListKeysRef.current.delete(cacheKey);
      }
    },
    [dataActive, fetchMediaLibraryList, kind, prefsHydrated, q, scope, user, userCacheId]
  );

  const invalidateMediaLibraryCache = React.useCallback(() => {
    listCacheRef.current.clear();
    groupsCacheRef.current.clear();
  }, []);

  const refreshAfterLibraryMutation = React.useCallback(async () => {
    invalidateMediaLibraryCache();
    await Promise.all([refreshGroups({ force: true }), refreshItems({ force: true })]);
  }, [invalidateMediaLibraryCache, refreshGroups, refreshItems]);

  React.useEffect(() => {
    if (!dataActive || !prefsHydrated) return;
    // 已有缓存：立刻渲染（无感打开，不等防抖）；无缓存：才走 180ms 防抖再拉取（避免快速切筛选/输入时狂发请求）
    const cacheKey = getMediaLibraryListCacheKey(userCacheId, currentListQuery);
    if (listCacheRef.current.has(cacheKey)) {
      void refreshGroups();
      void refreshItems();
      return;
    }
    const timer = window.setTimeout(() => {
      void refreshGroups();
      void refreshItems();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [currentListQuery, dataActive, prefsHydrated, refreshGroups, refreshItems, userCacheId]);

  React.useEffect(() => {
    if (dataActive) return;
    listAbortRef.current?.abort();
    groupsAbortRef.current?.abort();
    activeListKeyRef.current = "";
    setLoading(false);
    setRefreshing(false);
  }, [dataActive]);

  React.useEffect(() => {
    setPage(1);
  }, [groupFilter, kind, q, scope]);

  React.useEffect(() => {
    if (!dataActive || !prefsHydrated || !user || q.trim()) return;
    const preferredGroups = [groupFilter, "all", MEDIA_LIBRARY_UNGROUPED, ...groups]
      .map((item) => item.trim())
      .filter(Boolean);
    const uniqueGroups = Array.from(new Set(preferredGroups)).slice(0, MEDIA_LIBRARY_PREFETCH_GROUP_LIMIT);
    for (const nextGroup of uniqueGroups) {
      void prefetchGroupItems(nextGroup);
    }
  }, [dataActive, groupFilter, groups, prefetchGroupItems, prefsHydrated, q, user]);

  React.useEffect(() => {
    if (!dataActive) return;
    if (!items.length) return;
    const params = getWarmParams("library");
    if (!params) return;
    const candidateGroups = items
      .map((item) => pickPreviewCandidates(item))
      .filter((candidates) => candidates.length > 0);
    return warmResilientImageCandidatesBatch(candidateGroups, params);
  }, [dataActive, items]);

  React.useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  React.useEffect(() => {
    if (open) return;
    setSelectedIds([]);
    selectedIdsRef.current = [];
    lastSelectedIdRef.current = null;
  }, [open]);

  React.useEffect(() => {
    if (scope !== "private") {
      setSelectionMode(false);
      setSelectedIds([]);
      lastSelectedIdRef.current = null;
      setDeleteTarget(null);
      setMoveTarget(null);
      setBatchMoveOpen(false);
    }
  }, [scope]);

  React.useEffect(() => {
    setSelectedIds([]);
    lastSelectedIdRef.current = null;
    dragSelectingRef.current = false;
    dragSelectionModeRef.current = null;
    boxSelectingRef.current = false;
    boxSelectionOriginRef.current = null;
    boxSelectionBaseRef.current = [];
    setSelectionBox(null);
  }, [kind, groupFilter, q]);

  React.useEffect(() => {
    const stopDragSelecting = () => {
      dragSelectingRef.current = false;
      dragSelectionModeRef.current = null;
      boxSelectingRef.current = false;
      boxSelectionOriginRef.current = null;
      boxSelectionBaseRef.current = [];
      setSelectionBox(null);
    };
    window.addEventListener("pointerup", stopDragSelecting);
    window.addEventListener("pointercancel", stopDragSelecting);
    return () => {
      window.removeEventListener("pointerup", stopDragSelecting);
      window.removeEventListener("pointercancel", stopDragSelecting);
    };
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (lightbox.open) return;
      if (selectedIdsRef.current.length > 0) {
        setSelectedIds([]);
        lastSelectedIdRef.current = null;
        dragSelectingRef.current = false;
        dragSelectionModeRef.current = null;
        boxSelectingRef.current = false;
        boxSelectionOriginRef.current = null;
        boxSelectionBaseRef.current = [];
        setSelectionBox(null);
        event.preventDefault();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightbox.open, onClose, open]);

  React.useEffect(() => {
    if (!open) {
      libraryDragActiveRef.current = false;
      return;
    }
    const stopLibraryDrag = () => {
      libraryDragActiveRef.current = false;
    };
    window.addEventListener("dragend", stopLibraryDrag, true);
    window.addEventListener("drop", stopLibraryDrag, true);
    return () => {
      window.removeEventListener("dragend", stopLibraryDrag, true);
      window.removeEventListener("drop", stopLibraryDrag, true);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onDocumentPointerDown = (event: PointerEvent) => {
      if (libraryDragActiveRef.current) return;
      if (lightbox.open || deleteTarget || moveTarget || batchMoveOpen || batchDeleteOpen || uploadFolderOpen || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      const targetEl = target instanceof Element ? target : target.parentElement;
      if (targetEl?.closest("[data-product-library-trigger]")) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    return () => document.removeEventListener("pointerdown", onDocumentPointerDown, true);
  }, [batchDeleteOpen, batchMoveOpen, deleteTarget, lightbox.open, moveTarget, onClose, open, uploadFolderOpen]);

  const startUpload = React.useCallback(() => {
    if (!user) {
      openLoginModal(() => setUploadFolderOpen(true));
      return;
    }
    if (!canUploadCurrentScope) {
      setError(scope === "shared" ? "共享素材请前往管理员页面的系统设置上传" : "请先登录后上传素材");
      return;
    }
    setUploadFolderOpen(true);
  }, [canUploadCurrentScope, openLoginModal, scope, user]);

  const getNormalizedUploadGroup = React.useCallback(() => {
    return uploadFolderRef.current;
  }, []);

  const updateUploadProgressItem = React.useCallback((id: string, patch: Partial<UploadProgressItem>) => {
    setUploadProgressItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }, []);

  const uploadSingleMaterial = React.useCallback(
    (file: File, normalizedGroup: string, id: string) =>
      new Promise<void>((resolve, reject) => {
        const form = new FormData();
        form.set("scope", scope);
        form.set("file", file);
        form.set("folderId", normalizedGroup || MEDIA_LIBRARY_UNGROUPED);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/media-library/upload");
        xhr.responseType = "json";

        xhr.upload.onprogress = (event) => {
          const totalBytes = event.lengthComputable ? event.total : file.size;
          const loadedBytes = Math.min(event.loaded, totalBytes || file.size);
          const percent = totalBytes > 0 ? Math.min(99, Math.round((loadedBytes / totalBytes) * 100)) : 0;
          updateUploadProgressItem(id, {
            status: "uploading",
            loadedBytes,
            totalBytes: totalBytes || file.size,
            percent,
          });
        };

        xhr.onload = () => {
          const raw = xhr.response;
          const message =
            raw && typeof raw === "object" && "error" in raw && typeof raw.error === "string"
              ? raw.error
              : xhr.status >= 200 && xhr.status < 300
                ? undefined
                : "上传素材失败";
          if (xhr.status >= 200 && xhr.status < 300) {
            updateUploadProgressItem(id, {
              status: "success",
              loadedBytes: file.size,
              totalBytes: file.size,
              percent: 100,
              message: undefined,
            });
            resolve();
            return;
          }
          updateUploadProgressItem(id, {
            status: "error",
            percent: 100,
            loadedBytes: file.size,
            totalBytes: file.size,
            message,
          });
          reject(new Error(message || "上传素材失败"));
        };

        xhr.onerror = () => {
          updateUploadProgressItem(id, {
            status: "error",
            message: "上传失败，请检查网络后重试",
          });
          reject(new Error("上传失败，请检查网络后重试"));
        };

        xhr.onabort = () => {
          updateUploadProgressItem(id, {
            status: "error",
            message: "上传已取消",
          });
          reject(new Error("上传已取消"));
        };

        updateUploadProgressItem(id, {
          status: "uploading",
          loadedBytes: 0,
          totalBytes: file.size,
          percent: 0,
          message: undefined,
        });

        xhr.send(form);
      }),
    [scope, updateUploadProgressItem]
  );

  const clearUploadProgress = React.useCallback(() => {
    if (collapseTimerRef.current) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    if (clearTimerRef.current) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    setUploadProgressItems([]);
    setUploadProgressCollapsed(false);
  }, []);

  const retrySingleUpload = React.useCallback(
    async (itemId: string) => {
      const target = uploadProgressItems.find((item) => item.id === itemId);
      if (!target) return;
      setUploading(true);
      setError(null);
      setUploadProgressCollapsed(false);
      try {
        updateUploadProgressItem(itemId, {
          status: "waiting",
          percent: 0,
          loadedBytes: 0,
          totalBytes: target.file.size,
          message: undefined,
        });
        await uploadSingleMaterial(target.file, target.folderId, itemId);
        await refreshAfterLibraryMutation();
      } catch (retryError: any) {
        setError(retryError?.message || "重试上传失败");
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [getNormalizedUploadGroup, refreshAfterLibraryMutation, updateUploadProgressItem, uploadProgressItems, uploadSingleMaterial]
  );

  const retryFailedUploads = React.useCallback(async () => {
    const failedItems = uploadProgressItems.filter((item) => item.status === "error");
    if (!failedItems.length) return;
    setUploading(true);
    setError(null);
    setUploadProgressCollapsed(false);
    try {
      for (const item of failedItems) {
        updateUploadProgressItem(item.id, {
          status: "waiting",
          percent: 0,
          loadedBytes: 0,
          totalBytes: item.file.size,
          message: undefined,
        });
        try {
          await uploadSingleMaterial(item.file, item.folderId, item.id);
        } catch {}
      }
      await refreshAfterLibraryMutation();
    } catch (retryError: any) {
      setError(retryError?.message || "重试上传失败");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [getNormalizedUploadGroup, refreshAfterLibraryMutation, updateUploadProgressItem, uploadProgressItems, uploadSingleMaterial]);

  const uploadFiles = React.useCallback(async (files: FileList | null) => {
    const fileList = Array.from(files || []);
    if (!fileList.length) return;
    if (!user) {
      openLoginModal();
      return;
    }
    if (!canUploadCurrentScope) {
      setError(scope === "shared" ? "共享素材请前往管理员页面的系统设置上传" : "请先登录后上传素材");
      return;
    }

    setUploading(true);
    setError(null);
    setUploadProgressCollapsed(false);
    try {
      const normalizedGroup = getNormalizedUploadGroup();
      const nextProgressItems: UploadProgressItem[] = fileList.map((file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        fileName: file.name,
        file,
        folderId: normalizedGroup,
        loadedBytes: 0,
        totalBytes: file.size,
        percent: 0,
        status: "waiting",
      }));
      setUploadProgressItems(nextProgressItems);
      for (let index = 0; index < nextProgressItems.length; index += 1) {
        const item = nextProgressItems[index];
        const file = fileList[index];
        try {
          await uploadSingleMaterial(file, item.folderId, item.id);
        } catch {}
      }
      await refreshAfterLibraryMutation();
    } catch (uploadError: any) {
      setError(uploadError?.message || "上传素材失败");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [canUploadCurrentScope, getNormalizedUploadGroup, openLoginModal, refreshAfterLibraryMutation, scope, uploadSingleMaterial, user]);

  const uploadSummary = React.useMemo(() => {
    const totalCount = uploadProgressItems.length;
    const successCount = uploadProgressItems.filter((item) => item.status === "success").length;
    const errorCount = uploadProgressItems.filter((item) => item.status === "error").length;
    const activeCount = uploadProgressItems.filter((item) => item.status === "uploading" || item.status === "waiting").length;
    const totalBytes = uploadProgressItems.reduce((sum, item) => sum + item.totalBytes, 0);
    const loadedBytes = uploadProgressItems.reduce((sum, item) => {
      if (item.status === "success") return sum + item.totalBytes;
      return sum + Math.min(item.loadedBytes, item.totalBytes);
    }, 0);
    const completedCount = successCount + errorCount;
    const percent = totalBytes > 0 ? Math.round((loadedBytes / totalBytes) * 100) : 0;
    return {
      totalCount,
      successCount,
      errorCount,
      activeCount,
      completedCount,
      totalBytes,
      loadedBytes,
      percent,
    };
  }, [uploadProgressItems]);

  React.useEffect(() => {
    if (collapseTimerRef.current) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    if (!uploadProgressItems.length) return;
    const allFinished = uploadProgressItems.every((item) => item.status === "success" || item.status === "error");
    if (!allFinished) return;
    collapseTimerRef.current = window.setTimeout(() => {
      setUploadProgressCollapsed(true);
      collapseTimerRef.current = null;
    }, 1800);
    return () => {
      if (collapseTimerRef.current) {
        window.clearTimeout(collapseTimerRef.current);
        collapseTimerRef.current = null;
      }
    };
  }, [uploadProgressItems]);

  React.useEffect(() => {
    if (clearTimerRef.current) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    if (!uploadAutoClear || !uploadProgressItems.length) return;
    const allFinished = uploadProgressItems.every((item) => item.status === "success" || item.status === "error");
    if (!allFinished) return;
    clearTimerRef.current = window.setTimeout(() => {
      clearUploadProgress();
      clearTimerRef.current = null;
    }, 5000);
    return () => {
      if (clearTimerRef.current) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
    };
  }, [clearUploadProgress, uploadAutoClear, uploadProgressItems]);

  React.useEffect(() => {
    return () => {
      if (collapseTimerRef.current) window.clearTimeout(collapseTimerRef.current);
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
    };
  }, []);

  const removeItem = React.useCallback(async (item: MediaLibraryItem) => {
    if (!item.canDelete) return;
    setError(null);
    try {
      const result = await updateProductFolders({ operation: "deleteItems", itemIds: [item.id] });
      setProductFolders(result.folders);
      await refreshAfterLibraryMutation();
      return true;
    } catch (cause) { setError((cause as Error).message); return false; }
  }, [refreshAfterLibraryMutation]);

  const toggleSelected = React.useCallback((id: number) => {
    lastSelectedIdRef.current = id;
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((itemId) => itemId !== id) : [...prev, id]));
  }, []);

  const selectRangeTo = React.useCallback((id: number) => {
    const anchorId = lastSelectedIdRef.current;
    const orderedIds = items.filter((item) => item.canDelete).map((item) => item.id);
    if (!anchorId || !orderedIds.includes(anchorId)) {
      lastSelectedIdRef.current = id;
      setSelectedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      return;
    }
    const start = orderedIds.indexOf(anchorId);
    const end = orderedIds.indexOf(id);
    if (start < 0 || end < 0) return;
    const [from, to] = start < end ? [start, end] : [end, start];
    const range = orderedIds.slice(from, to + 1);
    setSelectedIds((prev) => Array.from(new Set([...prev, ...range])));
    lastSelectedIdRef.current = id;
  }, [items]);

  const applyDraggedSelection = React.useCallback((id: number, mode: "select" | "deselect") => {
    setSelectedIds((prev) => {
      const exists = prev.includes(id);
      if (mode === "select") return exists ? prev : [...prev, id];
      return exists ? prev.filter((itemId) => itemId !== id) : prev;
    });
  }, []);

  const startDragSelection = React.useCallback((id: number) => {
    const mode: "select" | "deselect" = selectedIdsRef.current.includes(id) ? "deselect" : "select";
    dragSelectingRef.current = true;
    dragSelectionModeRef.current = mode;
    lastSelectedIdRef.current = id;
    applyDraggedSelection(id, mode);
  }, [applyDraggedSelection]);

  const handleCardSelectPointerDown = React.useCallback((event: React.PointerEvent, id: number) => {
    if (!canManageCurrentScope || !selectionMode) return;
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-no-select='true']")) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey) {
      toggleSelected(id);
      return;
    }
    if (event.shiftKey) {
      selectRangeTo(id);
      return;
    }
    toggleSelected(id);
  }, [canManageCurrentScope, selectRangeTo, selectionMode, toggleSelected]);

  const handleGridPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    return;
  }, []);

  const updateBoxSelection = React.useCallback((clientX: number, clientY: number) => {
    const grid = gridRef.current;
    const origin = boxSelectionOriginRef.current;
    if (!grid || !origin) return;
    const gridRect = grid.getBoundingClientRect();
    const currentX = clientX - gridRect.left;
    const currentY = clientY - gridRect.top;
    const left = Math.min(origin.x, currentX);
    const top = Math.min(origin.y, currentY);
    const width = Math.abs(currentX - origin.x);
    const height = Math.abs(currentY - origin.y);
    setSelectionBox({ left, top, width, height });

    const selected = new Set<number>(boxSelectionBaseRef.current);
    Object.entries(cardRefs.current).forEach(([rawId, node]) => {
      if (!node) return;
      const id = Number(rawId);
      const rect = node.getBoundingClientRect();
      const relLeft = rect.left - gridRect.left;
      const relTop = rect.top - gridRect.top;
      const intersects =
        relLeft < left + width &&
        relLeft + rect.width > left &&
        relTop < top + height &&
        relTop + rect.height > top;
      if (intersects) selected.add(id);
    });
    setSelectedIds(Array.from(selected));
  }, []);

  React.useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!boxSelectingRef.current) return;
      updateBoxSelection(event.clientX, event.clientY);
    };
    window.addEventListener("pointermove", onPointerMove);
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, [updateBoxSelection]);

  const toggleSelectAllCurrentPage = React.useCallback(() => {
    const currentIds = items.filter((item) => item.canDelete).map((item) => item.id);
    setSelectedIds((prev) => {
      const allSelected = currentIds.length > 0 && currentIds.every((id) => prev.includes(id));
      return allSelected ? prev.filter((id) => !currentIds.includes(id)) : Array.from(new Set([...prev, ...currentIds]));
    });
  }, [items]);

  const removeSelectedItems = React.useCallback(async () => {
    if (!selectedIds.length) return false;
    setError(null);
    try {
      const result = await updateProductFolders({ operation: "deleteItems", itemIds: selectedIds });
      setProductFolders(result.folders); setSelectedIds([]);
      await refreshAfterLibraryMutation();
      return true;
    } catch (cause) { setError((cause as Error).message); return false; }
  }, [refreshAfterLibraryMutation, selectedIds]);

  const openPreview = React.useCallback((item: MediaLibraryItem) => {
    const src = pickMediaUrl(item);
    if (!src) return;
    setLightbox({
      open: true,
      itemId: item.id,
      src,
      // lightbox 仅支持 image/video；audio 兜底按 image 处理
      kind: item.kind === "video" ? "video" : "image",
      title: item.title,
    });
  }, []);

  const previewItems = React.useMemo(
    () => items.filter((item) => item.kind !== "audio" && Boolean(pickMediaUrl(item))),
    [items],
  );
  const previewIndex = previewItems.findIndex((item) => item.id === lightbox.itemId);
  const previousPreview = previewIndex > 0 ? previewItems[previewIndex - 1] : undefined;
  const nextPreview = previewIndex >= 0 ? previewItems[previewIndex + 1] : undefined;

  const handleModifierSelection = React.useCallback((event: React.MouseEvent, itemId: number) => {
    const usesModifier = event.ctrlKey || event.metaKey || event.shiftKey;
    if (!usesModifier) return false;
    event.preventDefault();
    event.stopPropagation();
    const next = resolveMediaLibraryModifierSelection({
      orderedIds: items.filter((item) => Boolean(pickMediaUrl(item))).map((item) => item.id),
      selectedIds: selectedIdsRef.current,
      clickedId: itemId,
      anchorId: lastSelectedIdRef.current,
      ctrlOrMeta: event.ctrlKey || event.metaKey,
      shift: event.shiftKey,
    });
    selectedIdsRef.current = next.selectedIds;
    lastSelectedIdRef.current = next.anchorId;
    setSelectedIds(next.selectedIds);
    return true;
  }, [items]);

  const drivePanelScroll = React.useCallback((deltaY: number) => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return false;
    if (scrollArea.scrollHeight <= scrollArea.clientHeight + 1) return false;
    const prevTop = scrollArea.scrollTop;
    scrollArea.scrollTop += deltaY;
    return Math.abs(scrollArea.scrollTop - prevTop) > 0.5;
  }, []);

  const handlePanelWheel = React.useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey) return;
    if (drivePanelScroll(event.deltaY)) {
      event.preventDefault();
    }
  }, [drivePanelScroll]);

  React.useEffect(() => {
    if (!open) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      const targetEl = event.target instanceof Element ? event.target : null;
      if (targetEl?.closest("[data-wheel-lock='true']")) return;
      const panel = panelRef.current;
      if (!panel) return;
      const target = event.target as Node | null;
      const withinPanel = target ? panel.contains(target) : false;
      if (!withinPanel) {
        const rect = panel.getBoundingClientRect();
        const insideBounds =
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom;
        if (!insideBounds) return;
      }
      if (drivePanelScroll(event.deltaY)) {
        event.preventDefault();
      }
    };
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => {
      window.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
    };
  }, [drivePanelScroll, open]);

  const pageLabelStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const pageLabelEnd = Math.min(pagination.total, pagination.page * pagination.pageSize);

  return (
    <>
      <div ref={hostRef} className="absolute inset-0 z-[40] min-h-0 isolate pointer-events-none">
        {open || keepMounted ? (
        <div
          ref={panelRef}
          className={[
            "absolute inset-x-0 top-0 min-h-0",
            open ? "visible pointer-events-auto" : "invisible pointer-events-none",
          ].join(" ")}
          style={{ height: `${panelHeightPx}px` }}
          aria-hidden={!open}
        >
          <div className="solid-panel-overlay absolute inset-0" onClick={onClose} />
          <section
            className="media-library-panel solid-panel-surface absolute inset-0 grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-none border border-[var(--border)] shadow-[var(--shadow)]"
          >
          <div className="flex shrink-0 flex-col gap-2.5 border-b border-[var(--border)] bg-[var(--panel-bg)] px-4 py-3">
            {/* ── 行1：库源（主导航）+ 操作 ───────────────── */}
            <div className="flex items-center justify-between gap-3">
              <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--panel-2)]/40 p-0.5">
                {(["shared", "private"] as const).map((value) => {
                  const active = scope === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => { if (value === scope) return; groupsAbortRef.current?.abort(); setScope(value); setGroupFilter("all"); setGroups([]); setHasUngrouped(false); }}
                      className={[
                        "h-7 shrink-0 rounded-md px-3.5 text-[12.5px] font-medium transition",
                        active
                          ? "bg-[var(--panel-bg)] text-[var(--app-fg)] shadow-[0_1px_2px_rgba(15,15,25,0.06),_0_0_0_1px_rgba(15,15,25,0.05)]"
                          : "text-[var(--app-muted)] hover:text-[var(--app-fg)]",
                      ].join(" ")}
                    >
                      {value === "shared" ? <UiText id="materials.m4d6a4bc105dd" /> : <UiText id="materials.m7f1d9dd04cd1" />}
                    </button>
                  );
                })}
              </div>
              <div className="ml-auto flex items-center gap-2">
                {scope === "private" ? (
                  <>
                    <div className="relative">
                    <UiProps ids={{"aria-label":["materials.m52e1460217f1"]}}><button
                      type="button"
                      onClick={startUpload}
                      disabled={uploading}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--panel-2)] px-3 text-[12.5px] font-medium text-[var(--app-fg)] transition hover:bg-[var(--panel-3)] disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="materials.m52e1460217f1"
                    >
                      {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}<UiText id="materials.m9e07e3c0532d" /></button></UiProps>
                      {uploadProgressItems.length ? (
                        <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-[340px] max-w-[calc(100vw-32px)] rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)]/98 px-3 py-2 shadow-2xl backdrop-blur">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[12px] font-medium text-[var(--app-fg)]"><UiText id="materials.me945619d6afd" /></div>
                            <div className="mt-0.5 text-[10px] text-[var(--app-muted)]"><UiText id="materials.ma15ed6518c6a" />{uploadSummary.successCount}<UiText id="materials.mf1228a422d51" />{uploadSummary.errorCount}<UiText id="materials.m942a728998bb" />{uploadSummary.activeCount}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {uploadSummary.errorCount > 0 ? (
                              <button
                                type="button"
                                onClick={() => void retryFailedUploads()}
                                disabled={uploading}
                                className="h-7 rounded-md border border-rose-500/20 bg-rose-500/10 px-2 text-[11px] text-rose-700 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-300"
                              ><UiText id="materials.mb8784c8dd563" /></button>
                            ) : null}
                            <button
                              type="button"
                              onClick={clearUploadProgress}
                              disabled={uploadSummary.activeCount > 0}
                              className="h-7 rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2 text-[11px] text-[var(--app-fg)] transition hover:bg-[var(--panel-3)] disabled:cursor-not-allowed disabled:opacity-50"
                            ><UiText id="materials.m1ef3de06b32e" /></button>
                            <button
                              type="button"
                              onClick={() => setUploadProgressCollapsed((prev) => !prev)}
                              className="h-7 rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2 text-[11px] text-[var(--app-fg)] transition hover:bg-[var(--panel-3)]"
                            >
                              {uploadProgressCollapsed ? <UiText id="materials.m00bd3960fea8" /> : <UiText id="materials.mafd4b783536b" />}
                            </button>
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
                          <div
                            className="h-full rounded-full bg-blue-500 transition-all"
                            style={{ width: `${Math.max(uploadSummary.percent, 4)}%` }}
                          />
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[var(--app-muted)]">
                          <span>{uploadSummary.completedCount}/{uploadSummary.totalCount}<UiText id="materials.m29d4a6a0c445" /></span>
                          <span>{bytes(uploadSummary.loadedBytes, locale)} / {bytes(uploadSummary.totalBytes, locale)}</span>
                        </div>
                        {!uploadProgressCollapsed ? (
                          <div className="mt-2 max-h-[280px] space-y-1.5 overflow-y-auto overscroll-contain border-t border-[var(--border)] pt-2 pr-1">
                            <label className="inline-flex items-center gap-1.5 text-[10px] text-[var(--app-muted)]">
                              <input
                                type="checkbox"
                                checked={uploadAutoClear}
                                onChange={(event) => setUploadAutoClear(event.target.checked)}
                                className="h-3 w-3 rounded border-[var(--border)]"
                              /><UiText id="materials.m8f2ed10f9b4d" /></label>
                            {uploadProgressItems.map((item) => (
                              <div key={item.id} className="rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="truncate text-[10px] text-[var(--app-fg)]" title={item.fileName}>
                                      {item.fileName}
                                    </div>
                                    <div className="mt-0.5 text-[10px] text-[var(--app-muted)]">
                                      {item.status === "success"
                                        ? <UiText id="materials.m52c6b886b559" />
                                        : item.status === "error"
                                          ? item.message || <UiText id="materials.m219481a6dde7" />
                                          : item.status === "uploading"
                                            ? `${item.percent}%`
                                            : <UiText id="materials.m09c31e898e5f" />}
                                    </div>
                                  </div>
                                  {item.status === "error" ? (
                                    <button
                                      type="button"
                                      onClick={() => void retrySingleUpload(item.id)}
                                      disabled={uploading}
                                      className="h-6 rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-2 text-[10px] text-[var(--app-fg)] transition hover:bg-[var(--panel-3)] disabled:cursor-not-allowed disabled:opacity-50"
                                    ><UiText id="materials.mb8784c8dd563" /></button>
                                  ) : (
                                    <span className="shrink-0 text-[10px] text-[var(--app-muted)]">{`${item.percent}%`}</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}
                <UiProps ids={{"aria-label":["materials.m22db7cca2e01"]}}><button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] transition hover:border-[var(--border-2)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
                  aria-label="materials.m22db7cca2e01"
                >
                  <X className="h-3.5 w-3.5" />
                </button></UiProps>
              </div>
            </div>

            {/* ── 行2：分类小药丸（可横向滚动） ──────────── */}
            {scope === "shared" ? <div className="-mx-1 overflow-x-auto px-1 pb-0.5">
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                {[
                  { key: "all", label: text("createDynamic.m5c55a67935af") },
                  ...(hasUngrouped ? [{ key: MEDIA_LIBRARY_UNGROUPED, label: text("createDynamic.m54b89f901274") }] : []),
                  ...groups.map((group) => ({ key: group, label: group })),
                ].map((option) => {
                  const active = groupFilter === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setGroupFilter(option.key)}
                      onMouseEnter={() => void prefetchGroupItems(option.key)}
                      onFocus={() => void prefetchGroupItems(option.key)}
                      className={[
                        "h-7 shrink-0 rounded-full border px-3 text-[12px] font-medium transition",
                        active
                          ? "border-transparent bg-[var(--panel-2)] text-[var(--app-fg)]"
                          : "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] hover:border-[var(--border-2)] hover:text-[var(--app-fg)]",
                      ].join(" ")}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div> : <><ProductFolderNavigation folders={productFolders} availableGroups={groups} hasUngrouped={hasUngrouped} current={groupFilter} onSelect={setGroupFilter} onChanged={async folders => { setProductFolders(folders); await refreshAfterLibraryMutation(); }} />{foldersError && <span role="alert" className="text-xs text-red-400">{localizeError(foldersError)}</span>}</>}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-[var(--app-muted)]">
                {pagination.total > 0 ? <UiText id="materials.m35eb03308f62" values={{v0: String(pageLabelStart), v1: String(pageLabelEnd), v2: String(pagination.total)}} /> : <UiText id="materials.m497c85690c4c" />}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canManageCurrentScope && selectedIds.length > 0 && <>
                  <span className="text-xs text-[var(--app-muted)]"><UiText id="materials.m52c963128eab" />{selectedIds.length}<UiText id="materials.mf9d529eacdf3" /></span>
                  <button
                    type="button"
                    onClick={toggleSelectAllCurrentPage}
                    className="h-8 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-xs text-[var(--app-fg)] transition hover:bg-[var(--panel-3)]"
                  >
                    {items.filter((item) => item.canDelete).length > 0 && items.filter((item) => item.canDelete).every((item) => selectedIds.includes(item.id)) ? <UiText id="materials.m876526020575" /> : <UiText id="materials.mbd082d9acb40" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedIds.length) return;
                      setBatchMoveOpen(true);
                    }}
                    disabled={!selectedIds.length}
                    className="h-8 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-xs text-[var(--app-fg)] transition hover:bg-[var(--panel-3)] disabled:opacity-50"
                  ><UiText id="materials.m1d756d34576f" /></button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedIds.length) return;
                      setBatchDeleteOpen(true);
                    }}
                    disabled={!selectedIds.length}
                    className="h-8 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 text-xs text-rose-700 transition hover:bg-rose-500/15 disabled:opacity-50 dark:text-rose-300"
                  ><UiText id="materials.m8fdd6605e1bd" />{selectedIds.length}）
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedIds([])}
                    className="h-8 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-xs text-[var(--app-fg)] transition hover:bg-[var(--panel-3)]"
                  ><UiText id="materials.m74966e20df2e" /></button>
                </>}
                {canManageCurrentScope ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectionMode((prev) => {
                        const next = !prev;
                        if (!next) {
                          setSelectedIds([]);
                          dragSelectingRef.current = false;
                          dragSelectionModeRef.current = null;
                          boxSelectingRef.current = false;
                          boxSelectionOriginRef.current = null;
                          boxSelectionBaseRef.current = [];
                          setSelectionBox(null);
                        }
                        return next;
                      });
                    }}
                    className={[
                      "h-8 rounded-lg border px-3 text-xs transition",
                      selectionMode
                        ? "border-blue-500/30 bg-blue-500/12 text-blue-500"
                        : "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] hover:bg-[var(--panel-3)]",
                    ].join(" ")}
                  >
                    {selectionMode ? <UiText id="materials.mc0b3fbff51cc" /> : <UiText id="materials.m461e085d5ca2" />}
                  </button>
                ) : null}
              </div>
            </div>

          </div>

          <div className="flex min-h-0 min-w-0">
          <UiProps ids={{"aria-label":["materials.mdf30a28b8a22"]}}><div
            ref={scrollAreaRef}
            className="media-library-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 touch-pan-y"
            onWheelCapture={handlePanelWheel}
            style={{ scrollbarGutter: "stable both-edges" }}
            tabIndex={0}
            aria-label="materials.mdf30a28b8a22"
          >
            {refreshing && !loading ? (
              <div className="pointer-events-none sticky top-0 z-30 mb-3 flex justify-end">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-1 text-[11px] text-[var(--app-muted)] shadow-[var(--shadow-1)]">
                  <Loader2 className="h-3 w-3 animate-spin" /><UiText id="materials.m30fa38552623" /></span>
              </div>
            ) : null}
            {!user && scope !== "shared" ? (
              <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel-2)] text-center">
                <div className="text-sm text-[var(--app-fg)]"><UiText id="materials.m2372f589c948" /></div>
                <button
                  type="button"
                  onClick={() => openLoginModal()}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 text-sm text-[var(--app-fg)] transition hover:bg-[var(--panel-3)]"
                >
                  <LogIn className="h-4 w-4" /><UiText id="materials.m19e976b023c8" /></button>
              </div>
            ) : loading ? (
              <div className="flex h-full min-h-[280px] items-center justify-center text-sm text-[var(--app-muted)]">
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /><UiText id="materials.m2d83e1ea11a0" /></span>
              </div>
            ) : items.length === 0 ? (
              <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel-bg)] text-center">
                <div className="text-sm text-[var(--app-fg)]"><UiText id="materials.m9405672c6bce" /></div>
                <div className="text-xs text-[var(--app-muted)]">
                  {scope === "shared" ? <UiText id="materials.mfb7c65e23be8" /> : <UiText id="materials.m8d773153b321" />}
                </div>
              </div>
            ) : (
              // 注意：此处用原生 CSS Grid 而非 VirtualizedMediaGrid——面板不分页，单次拉取当前筛选结果。
              // 同时还要兼容 pointerDown + 框选 + 拖拽等丰富交互（selectionBox / handleGridPointerDown）。
              // 如果素材量继续增长，可换成 <VirtualizedMediaGrid>，并把交互逻辑移到外层包装上。
              <div
                ref={gridRef}
                className="relative grid grid-cols-[repeat(auto-fill,minmax(136px,1fr))] gap-3"
                onPointerDown={handleGridPointerDown}
              >
                {selectionBox ? (
                  <div
                    className="pointer-events-none absolute z-20 rounded-xl border border-blue-500/60 bg-blue-500/10"
                    style={{
                      left: selectionBox.left,
                      top: selectionBox.top,
                      width: selectionBox.width,
                      height: selectionBox.height,
                    }}
                  />
                ) : null}
                {items.map((item, index) => {
                  const previewCandidates = pickPreviewCandidates(item);
                  const mediaUrl = pickMediaUrl(item);
                  const itemSelected = selectedIds.includes(item.id);
                  const showSelectionChip = itemSelected || (canManageCurrentScope && selectionMode && item.canDelete);
                  return (
                    <div
                      key={item.id}
                      ref={(node) => {
                        cardRefs.current[item.id] = node;
                      }}
                      className="media-library-card-button group group/library-item overflow-hidden rounded-xl leading-none transition"
                      onPointerDown={(event) => handleCardSelectPointerDown(event, item.id)}
                      onPointerEnter={() => {
                        if (!dragSelectingRef.current || !dragSelectionModeRef.current || !canManageCurrentScope || !item.canDelete) return;
                        applyDraggedSelection(item.id, dragSelectionModeRef.current);
                      }}
                    >
                      <div
                        className={[
                          "relative block aspect-[3/4] w-full overflow-hidden bg-transparent touch-pan-y",
                          itemSelected ? "ring-2 ring-inset ring-blue-500/80" : "",
                        ].join(" ")}
                        role="button"
                        tabIndex={0}
                        draggable={Boolean(mediaUrl)}
                        onDragStart={(event) => {
                          if (!mediaUrl) return;
                          libraryDragActiveRef.current = true;
                          const dragUrl = buildMediaOriginalUrl(item.fileUrl || item.thumbnailUrl || "") || mediaUrl;
                          try {
                            const dragItems = getMediaLibraryDragSelection(
                              items.map((candidate) => ({
                                id: candidate.id,
                                kind: candidate.kind,
                                url: buildMediaOriginalUrl(candidate.fileUrl || candidate.thumbnailUrl || "") || pickMediaUrl(candidate) || "",
                              })),
                              item.id,
                              selectedIdsRef.current,
                            );
                            writeMediaLibraryDragItems(event.dataTransfer, dragItems);
                            event.dataTransfer.setData("application/x-media-library-item-id", String(item.id));
                            event.dataTransfer.setData("application/x-media-library-url", dragUrl);
                            event.dataTransfer.setData("application/x-media-library-kind", item.kind);
                            event.dataTransfer.setData("text/uri-list", dragUrl);
                            event.dataTransfer.setData("text/plain", dragUrl);
                          } catch {}
                        }}
                        onDragEnd={() => {
                          libraryDragActiveRef.current = false;
                        }}
                        onClick={(event) => {
                          if (handleModifierSelection(event, item.id)) return;
                          if (canManageCurrentScope && selectionMode && item.canDelete) return;
                          openPreview(item);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          if (canManageCurrentScope && selectionMode && item.canDelete) {
                            toggleSelected(item.id);
                            return;
                          }
                          openPreview(item);
                        }}
                        data-no-select="true"
                      >
                        {showSelectionChip ? (
                          <label
                            data-no-select="true"
                            className="absolute left-2 bottom-2 z-10 inline-flex h-6 items-center gap-1 rounded-md border border-white/20 bg-black/55 px-1.5 text-[9px] text-white shadow-[0_1px_2px_rgba(0,0,0,0.45)]"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              toggleSelected(item.id);
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(item.id)}
                              onChange={() => {}}
                              className="h-3.5 w-3.5 rounded border-white/30 bg-transparent"
                            /><UiText id="materials.m7ecf1cde6486" /></label>
                        ) : null}
                        {canManageCurrentScope && item.canDelete ? (
                          <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
                            <button
                              data-no-select="true"
                              type="button"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setDeleteTarget(item);
                              }}
                              className="opacity-0 pointer-events-none group-hover/library-item:opacity-100 group-hover/library-item:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/20 bg-black/55 text-white transition hover:bg-black/65"
                              aria-label={text("createDynamic.maec67bfce5d5", { title: item.title })}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ) : null}
                        {item.kind === "audio" ? (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[var(--panel-2)] px-3">
                            <div className="inline-flex items-center gap-2 rounded-lg bg-black/40 px-3 py-1 text-xs text-white">
                              <Music2 className="h-4 w-4" /><UiText id="materials.m9aff128e00ac" /></div>
                            {mediaUrl ? (
                              <audio controls className="w-full" src={mediaUrl}><UiText id="materials.m785699793650" /></audio>
                            ) : null}
                          </div>
                        ) : item.kind === "video" && mediaUrl ? (
                            <>
                              <HoverPreviewVideo
                                src={mediaUrl}
                                posterSrc={previewCandidates.find((src) => !isVideoMediaUrl(src))}
                                className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.02]"
                                eager={index < 12}
                              />
                              <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-85 transition-opacity duration-200 group-hover:opacity-0">
                                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white shadow-lg">
                                  <Video className="h-5 w-5" />
                                </span>
                              </div>
                            </>
                        ) : previewCandidates.length ? (
                            <>
                              <ResilientImage
                                candidates={previewCandidates}
                                alt={item.title}
                                className="h-full w-full object-contain mix-blend-multiply transition-transform duration-200 group-hover:scale-[1.02] dark:mix-blend-normal"
                                draggable={false}
                                loading={index < 12 ? "eager" : "lazy"}
                                decoding="async"
                                fetchPriority={index < 8 ? "high" : "auto"}
                              />
                              {item.kind === "video" ? (
                                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white shadow-lg">
                                    <Video className="h-5 w-5" />
                                  </span>
                                </div>
                              ) : null}
                            </>
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-sm text-[var(--app-muted)]"><UiText id="materials.mb47d3f110db7" /></div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {error ? (
              <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">
                {localizeError(error)}
              </div>
            ) : null}

          </div></UiProps>

            <input
              ref={inputRef}
              type="file"
              accept="image/*,video/*,audio/*"
              multiple
              className="hidden"
              onChange={(event) => {
                void uploadFiles(event.target.files);
              }}
            />
          </div>
          </section>
          <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center pb-2">
            <UiProps ids={{"aria-label":["materials.m521e345ab848"],"title":["materials.m521e345ab848"]}}><button
              type="button"
              onPointerDown={(event) => {
                event.preventDefault();
                panelResizeRef.current = { startY: event.clientY, startHeight: panelHeightPx };
                setPanelResizing(true);
              }}
              className="media-library-resize-handle group inline-flex h-6 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-bg)]/96 px-3 shadow-[0_10px_24px_rgba(15,23,42,0.12)] transition hover:bg-[var(--panel-2)] touch-none cursor-row-resize"
              aria-label="materials.m521e345ab848"
              title="materials.m521e345ab848"
            >
              <span className="h-1.5 w-12 rounded-full bg-[var(--app-muted)]/35 transition group-hover:bg-[var(--app-fg)]/30" />
            </button></UiProps>
          </div>
        </div>
        ) : null}
        {!open ? (
          // 收起态:顶部常驻一个小手柄,点击下拉展开产品库;只占顶部一条,不挡下面的结果区与按钮
          <div className="absolute inset-x-0 top-0 z-20 flex justify-center pt-1 pointer-events-none">
            <UiProps ids={{"aria-label":["materials.mf1401f81bd9b"],"title":["materials.m590b603006a4"]}}><button
              type="button"
              onClick={() => openMediaLibraryPanel()}
              className="group pointer-events-auto inline-flex h-6 items-center justify-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--panel-bg)]/96 pl-2.5 pr-2 transition hover:bg-[var(--panel-2)] cursor-pointer"
              data-product-library-trigger
              aria-label="materials.mf1401f81bd9b"
              title="materials.m590b603006a4"
            >
              <span className="h-1.5 w-6 rounded-full bg-[var(--app-muted)]/40 transition group-hover:bg-[var(--app-fg)]/40" />
              <span className="text-[12px] font-medium leading-none text-[var(--app-fg)]"><UiText id="materials.mebc74bbb5143" /></span>
              <span className="text-[10px] leading-none text-[var(--app-muted)]"><UiText id="materials.m59c9e9c47dd3" /></span>
              <ChevronDown className="h-3.5 w-3.5 text-[var(--app-muted)] group-hover:text-[var(--app-fg)]" />
            </button></UiProps>
          </div>
        ) : null}
      </div>

      <MediaLightbox
        layout="floating"
        open={lightbox.open}
        src={lightbox.src}
        kind={lightbox.kind}
        title={lightbox.title}
        onPrev={previousPreview ? () => openPreview(previousPreview) : undefined}
        onNext={nextPreview ? () => openPreview(nextPreview) : undefined}
        hasPrev={Boolean(previousPreview)}
        hasNext={Boolean(nextPreview)}
        counter={previewIndex >= 0 ? `${previewIndex + 1} / ${previewItems.length}` : undefined}
        counterAlwaysVisible
        onClose={() => setLightbox({ open: false, itemId: null, src: null, kind: "image", title: "" })}
      />
      <UiProps ids={{"title":["materials.mbb657b83d9d6"],"confirmText":["materials.ma3ea3c17b401"],"cancelText":["materials.m2cd0f3be8738"]}}><ConfirmDialog
        open={canManageCurrentScope && !!deleteTarget}
        title="materials.mbb657b83d9d6"
        description={deleteTarget ? text("createDynamic.m1d872f64cd37", { title: deleteTarget.title || deleteTarget.id }) : ""}
        confirmText="materials.ma3ea3c17b401"
        cancelText="materials.m2cd0f3be8738"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          return await removeItem(deleteTarget);
        }}
      /></UiProps>
      <ProductFolderPicker open={uploadFolderOpen && open && scope === "private"} folders={productFolders} loading={foldersLoading} error={foldersError} onClose={() => setUploadFolderOpen(false)} onChanged={setProductFolders} onConfirm={id => {
        uploadFolderRef.current = id;
        setGroupFilter(id);
        setUploadFolderOpen(false);
        inputRef.current?.click();
      }} />
      <UiProps ids={{"title":["materials.m711c5507708d"],"confirmText":["materials.m327bc633f3d2"]}}><ProductFolderPicker open={canManageCurrentScope && (!!moveTarget || batchMoveOpen)} folders={productFolders} loading={foldersLoading} error={foldersError} title="materials.m711c5507708d" confirmText="materials.m327bc633f3d2" onClose={() => { setMoveTarget(null); setBatchMoveOpen(false); }} onChanged={setProductFolders} onConfirm={async id => {
        const result = await updateProductFolders({ operation: "moveItems", itemIds: moveTarget ? [moveTarget.id] : selectedIds, parentId: id });
        setProductFolders(result.folders);
        setMoveTarget(null); setBatchMoveOpen(false); setSelectedIds([]);
        setGroupFilter(id);
        await refreshAfterLibraryMutation();
      }} /></UiProps>
      <UiProps ids={{"title":["materials.m177a1652ab53"],"cancelText":["materials.m2cd0f3be8738"]}}><ConfirmDialog
        open={canManageCurrentScope && batchDeleteOpen}
        title="materials.m177a1652ab53"
        description={selectedIds.length ? text("createDynamic.mcd1ffcad8f3a", { count: selectedIds.length }) : ""}
        confirmText={text("createDynamic.m073b6b3db12b", { count: selectedIds.length })}
        cancelText="materials.m2cd0f3be8738"
        danger
        onClose={() => setBatchDeleteOpen(false)}
        onConfirm={removeSelectedItems}
      /></UiProps>
    </>
  );
}
