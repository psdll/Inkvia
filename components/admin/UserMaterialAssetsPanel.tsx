"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Archive, ChevronDown, Clock, FileImage, RotateCcw, XCircle } from "lucide-react";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { MediaLightbox } from "@/components/ui/media-lightbox";
import { ResilientImage } from "@/components/ui/resilient-image";
import { buildMediaOriginalUrl, buildMediaPreviewCandidates, buildMediaProxyUrl, isVideoMediaUrl } from "@/lib/media-url";
import { fmtTime } from "@/lib/admin-utils";

type MaterialMediaItem = {
  id: string;
  originalUrl: string;
  thumbnailUrl?: string | null;
  previewUrl?: string | null;
  mime?: string | null;
  size?: number | null;
};

type MaterialAssetCurrent = {
  id: number;
  category: string | null;
  title: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  previewUrl?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  mediaCount?: number;
  selectedMediaId?: string | null;
  mediaItems?: MaterialMediaItem[];
  creatorName?: string | null;
  selectedByUserId?: number | null;
  selectedByUsername?: string | null;
  selectedAt?: string | null;
  downloadCount?: number;
};

type MaterialAssetEvent = {
  id: number;
  assetId: number;
  username: string;
  action: string;
  reason?: string | null;
  operatorUsername?: string | null;
  selectedMediaId?: string | null;
  selectedMediaUrl?: string | null;
  occurredAt?: string | null;
  asset?: {
    id: number;
    category: string | null;
    title: string;
    imageUrl: string;
    thumbnailUrl: string | null;
    previewUrl?: string | null;
    mimeType?: string | null;
    sizeBytes?: number | null;
    mediaCount?: number;
    selectedMediaId?: string | null;
    mediaItems?: MaterialMediaItem[];
    creatorName?: string | null;
    isDeleted?: boolean;
    isSelected?: boolean;
    selectedByUserId?: number | null;
    selectedByUsername?: string | null;
  } | null;
};

type Props = {
  data?: {
    categories?: Array<{ key: string; label: string; count: number }>;
    current?: MaterialAssetCurrent[];
    archived?: MaterialAssetCurrent[];
    events?: MaterialAssetEvent[];
    stats?: {
      currentSelected: number;
      selects: number;
      cancelRequests: number;
      releases: number;
      archived?: number;
      eventTotal?: number;
    };
    pagination?: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
      hasMore: boolean;
    };
    archivedPagination?: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
      hasMore: boolean;
      loaded?: boolean;
    };
    eventsPagination?: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
      hasMore: boolean;
      loaded?: boolean;
      action?: string;
      allTotal?: number;
    };
  } | null;
  categoryFilter: string;
  setCategoryFilter: React.Dispatch<React.SetStateAction<string>>;
  selectedFrom: string;
  setSelectedFrom: React.Dispatch<React.SetStateAction<string>>;
  selectedTo: string;
  setSelectedTo: React.Dispatch<React.SetStateAction<string>>;
  pageSize: number;
  setPageSize: React.Dispatch<React.SetStateAction<number>>;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  archivedOpen: boolean;
  setArchivedOpen: React.Dispatch<React.SetStateAction<boolean>>;
  archivedPageSize: number;
  setArchivedPageSize: React.Dispatch<React.SetStateAction<number>>;
  setArchivedPage: React.Dispatch<React.SetStateAction<number>>;
  eventsOpen: boolean;
  setEventsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  eventsPageSize: number;
  setEventsPageSize: React.Dispatch<React.SetStateAction<number>>;
  setEventsPage: React.Dispatch<React.SetStateAction<number>>;
  eventsAction: "all" | "select" | "cancel_request" | "release";
  setEventsAction: React.Dispatch<React.SetStateAction<"all" | "select" | "cancel_request" | "release">>;
  onReleaseAsset?: (assetId: number) => Promise<void> | void;
};

type MaterialAssetEventAsset = NonNullable<MaterialAssetEvent["asset"]>;

type LightboxAsset = {
  id: number;
  title: string;
  category: string | null;
  imageUrl?: string | null;
  thumbnailUrl?: string | null;
  previewUrl?: string | null;
  mimeType?: string | null;
  selectedAt?: string | null;
  downloadCount?: number | null;
  sizeBytes?: number | null;
  mediaCount?: number;
  selectedMediaId?: string | null;
  mediaItems?: MaterialMediaItem[];
  creatorName?: string | null;
  selectedByUsername?: string | null;
  eventCount?: number | null;
  latestAt?: string | null;
  username?: string | null;
};

function previewCandidates(asset: { imageUrl?: string | null; thumbnailUrl?: string | null; previewUrl?: string | null }) {
  const raw = asset.previewUrl || asset.thumbnailUrl || asset.imageUrl || "";
  return buildMediaPreviewCandidates(raw, { width: 220, height: 220, mode: "cover" }).map((url) => buildMediaProxyUrl(url) || url);
}

function previewOriginalUrl(asset: { imageUrl?: string | null; thumbnailUrl?: string | null; previewUrl?: string | null }) {
  const raw = asset.previewUrl || asset.imageUrl || asset.thumbnailUrl || "";
  return buildMediaOriginalUrl(raw);
}

function mediaItemsForAsset(asset: LightboxAsset | MaterialAssetCurrent | MaterialAssetEventAsset): MaterialMediaItem[] {
  if (Array.isArray(asset.mediaItems) && asset.mediaItems.length) return asset.mediaItems;
  const originalUrl = asset.imageUrl || asset.previewUrl || asset.thumbnailUrl || "";
  if (!originalUrl) return [];
  return [{
    id: asset.selectedMediaId || `asset_${asset.id}_cover`,
    originalUrl,
    thumbnailUrl: asset.thumbnailUrl || null,
    previewUrl: asset.previewUrl || null,
    mime: asset.mimeType || null,
    size: asset.sizeBytes || null,
  }];
}

function previewCandidatesForMedia(media: MaterialMediaItem, size = 220) {
  const rawCandidates = [media.previewUrl, media.thumbnailUrl, media.originalUrl].filter(Boolean);
  return Array.from(
    new Set(
      rawCandidates
        .flatMap((raw) => buildMediaPreviewCandidates(raw, { width: size, height: size, mode: "cover" }))
        .map((url) => buildMediaProxyUrl(url) || url)
        .filter(Boolean)
    )
  );
}

function originalUrlForMedia(media: MaterialMediaItem) {
  return buildMediaOriginalUrl(media.originalUrl || media.previewUrl || media.thumbnailUrl || "");
}

function isVideoMediaItem(media?: MaterialMediaItem | null, asset?: { mimeType?: string | null }) {
  return Boolean(
    String(media?.mime || asset?.mimeType || "").toLowerCase().startsWith("video/") ||
      isVideoMediaUrl(media?.originalUrl || media?.previewUrl || media?.thumbnailUrl || "")
  );
}

function isVideoAsset(asset: { mimeType?: string | null; imageUrl?: string | null; previewUrl?: string | null; thumbnailUrl?: string | null }) {
  return Boolean(
    String(asset.mimeType || "").toLowerCase().startsWith("video/") ||
      isVideoMediaUrl(asset.imageUrl || asset.previewUrl || asset.thumbnailUrl || "")
  );
}

function hasImageCover(asset: { imageUrl?: string | null; thumbnailUrl?: string | null; previewUrl?: string | null; mimeType?: string | null }) {
  return Boolean(asset.previewUrl || asset.thumbnailUrl || (!isVideoAsset(asset) && asset.imageUrl));
}

function formatSize(n?: number | null) {
  const value = Number(n || 0);
  if (!Number.isFinite(value) || value <= 0) return "-";
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

function eventAsset(event: MaterialAssetEvent): MaterialAssetEventAsset {
  return event.asset ? { ...event.asset, selectedMediaId: event.asset.selectedMediaId || (event as any).selectedMediaId || null } : {
    id: event.assetId,
    category: null,
    title: `素材 #${event.assetId}`,
    imageUrl: "",
    thumbnailUrl: null,
    previewUrl: null,
    mimeType: null,
    sizeBytes: null,
    mediaCount: 1,
    selectedMediaId: null,
    mediaItems: [],
    creatorName: null,
    isDeleted: false,
    isSelected: false,
    selectedByUserId: null,
    selectedByUsername: null,
  };
}

// 已归档清单按挑选时间(selectedAt)的自然月分组，月份倒序
function groupMaterialAssetsByMonth(assets: MaterialAssetCurrent[]) {
  const map = new Map<string, MaterialAssetCurrent[]>();
  for (const asset of assets) {
    const date = new Date(asset.selectedAt || "");
    const key = Number.isNaN(date.getTime())
      ? "unknown"
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const list = map.get(key);
    if (list) list.push(asset);
    else map.set(key, [asset]);
  }
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, list]) => ({
      key,
      label: key === "unknown" ? "未知时间" : `${key.slice(0, 4)}年${Number(key.slice(5, 7))}月`,
      assets: list,
    }));
}

// 当前挑选清单按挑选时间(selectedAt)的自然日分组，日期倒序
function groupMaterialAssetsByDay(assets: MaterialAssetCurrent[]) {
  const map = new Map<string, MaterialAssetCurrent[]>();
  for (const asset of assets) {
    const date = new Date(asset.selectedAt || "");
    const key = Number.isNaN(date.getTime())
      ? "unknown"
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const list = map.get(key);
    if (list) list.push(asset);
    else map.set(key, [asset]);
  }
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, list]) => ({
      key,
      label: key === "unknown" ? "未知日期" : key,
      assets: list,
    }));
}

function actionLabel(action: string) {
  if (action === "select") return "挑选";
  if (action === "cancel_request") return "取消申请";
  if (action === "release") return "重新上架";
  return action || "记录";
}

function actionClass(action: string) {
  if (action === "select") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
  if (action === "cancel_request") return "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300";
  if (action === "release") return "border-[var(--primary-bg)]/25 bg-[color-mix(in_srgb,var(--primary-bg)_10%,transparent)] text-[var(--primary-bg)] dark:text-[var(--primary-fg)]";
  return "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)]";
}

function MaterialAssetCover({
  asset,
  compact = false,
  loading = "lazy",
}: {
  asset: LightboxAsset | MaterialAssetCurrent | MaterialAssetEventAsset;
  compact?: boolean;
  loading?: "eager" | "lazy";
}) {
  const video = isVideoAsset(asset);
  const count = Math.max(1, Number(asset.mediaCount || 1));
  const badge = count > 1 ? "系列图" : video ? (compact ? "▶" : "视频") : "";
  return (
    <>
      {hasImageCover(asset) ? (
        <ResilientImage
          candidates={previewCandidates(asset)}
          alt={asset.title}
          className="h-full w-full object-cover"
          loading={loading}
          fetchPriority="auto"
          cacheInMemory={compact}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[var(--panel-3)] text-[11px] font-medium text-[var(--app-muted)]"><UiText id="admin.mc20f7618d330" /></div>
      )}
      {badge ? (
        <span
          className={[
            "absolute rounded bg-black/60 font-medium text-white",
            compact ? "right-0.5 top-0.5 px-1 text-[8px]" : "right-1.5 top-1.5 border border-white/20 px-1.5 py-0.5 text-[10px]",
          ].join(" ")}
        >
          {badge}
        </span>
      ) : null}
    </>
  );
}


export default function UserMaterialAssetsPanel({
  data,
  categoryFilter,
  setCategoryFilter,
  selectedFrom,
  setSelectedFrom,
  selectedTo,
  setSelectedTo,
  pageSize,
  setPageSize,
  setPage,
  archivedOpen,
  setArchivedOpen,
  archivedPageSize,
  setArchivedPageSize,
  setArchivedPage,
  eventsOpen,
  setEventsOpen,
  eventsPageSize,
  setEventsPageSize,
  setEventsPage,
  eventsAction,
  setEventsAction,
}: Props) {
  const { label: uiLabel } = useUiLocale();
  const current = React.useMemo(() => (Array.isArray(data?.current) ? data.current : []), [data]);
  const archived = React.useMemo(() => (Array.isArray(data?.archived) ? data.archived : []), [data]);
  const events = React.useMemo(() => (Array.isArray(data?.events) ? data.events : []), [data]);
  const pagination = data?.pagination || { page: 1, pageSize, total: current.length, totalPages: 1, hasMore: false };
  const stats = data?.stats || { currentSelected: current.length, selects: 0, cancelRequests: 0, releases: 0, archived: archived.length };
  const archivedTotal = Math.max(0, Number(data?.archivedPagination?.total ?? stats.archived ?? archived.length));
  const archivedPagination = data?.archivedPagination || {
    page: 1,
    pageSize: archivedPageSize,
    total: archivedTotal,
    totalPages: Math.max(1, Math.ceil(archivedTotal / archivedPageSize)),
    hasMore: false,
    loaded: false,
  };
  const eventTotal = Math.max(0, Number(data?.eventsPagination?.allTotal ?? stats.eventTotal ?? stats.selects + stats.cancelRequests + stats.releases));
  const eventsPagination = data?.eventsPagination || {
    page: 1,
    pageSize: eventsPageSize,
    total: eventTotal,
    totalPages: Math.max(1, Math.ceil(eventTotal / eventsPageSize)),
    hasMore: false,
    loaded: false,
    action: eventsAction,
    allTotal: eventTotal,
  };
  const currentGroups = React.useMemo(() => groupMaterialAssetsByDay(current), [current]);
  const archivedGroups = React.useMemo(() => groupMaterialAssetsByMonth(archived), [archived]);
  const categoryOptions = React.useMemo(() => {
    const fromPayload = Array.isArray(data?.categories) ? data.categories : [];
    if (fromPayload.length) return fromPayload;
    const map = new Map<string, { key: string; label: string; count: number }>();
    for (const asset of current) {
      const label = asset.category?.trim() || "未分类";
      const key = asset.category?.trim() || "__uncategorized";
      const item = map.get(key) || { key, label, count: 0 };
      item.count += 1;
      map.set(key, item);
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
  }, [current, data?.categories]);
  const hasCurrentFilters = categoryFilter !== "all" || Boolean(selectedFrom || selectedTo);
  const categoryMenuRef = React.useRef<HTMLDivElement | null>(null);
  const [categoryMenuOpen, setCategoryMenuOpen] = React.useState(false);
  const currentCategoryLabel = categoryFilter === "all"
    ? "全部"
    : categoryOptions.find((option) => option.key === categoryFilter)?.label || "全部";
  React.useEffect(() => {
    if (!categoryMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (categoryMenuRef.current?.contains(target)) return;
      setCategoryMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCategoryMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [categoryMenuOpen]);
  React.useEffect(() => {
    setPage((prev) => (prev > pagination.totalPages ? Math.max(1, pagination.totalPages) : prev));
  }, [pagination.totalPages, setPage]);
  React.useEffect(() => {
    setArchivedPage((prev) => (prev > archivedPagination.totalPages ? Math.max(1, archivedPagination.totalPages) : prev));
  }, [archivedPagination.totalPages, setArchivedPage]);
  React.useEffect(() => {
    setEventsPage((prev) => (prev > eventsPagination.totalPages ? Math.max(1, eventsPagination.totalPages) : prev));
  }, [eventsPagination.totalPages, setEventsPage]);
  const [expandedGroups, setExpandedGroups] = React.useState<Set<number>>(new Set());
  const toggleGroup = React.useCallback((assetId: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }, []);
  const [lightbox, setLightbox] = React.useState<{ open: boolean; mediaIndex: number; title: string; asset: LightboxAsset | null }>({
    open: false,
    mediaIndex: 0,
    title: "",
    asset: null,
  });
  const mediaCacheRef = React.useRef<Map<number, MaterialMediaItem[]>>(new Map());
  const lightboxAssetIdRef = React.useRef<number | null>(null);
  const [detailLoadingAssetId, setDetailLoadingAssetId] = React.useState<number | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);

  React.useEffect(() => {
    lightboxAssetIdRef.current = lightbox.open ? lightbox.asset?.id ?? null : null;
  }, [lightbox.asset?.id, lightbox.open]);

  const mergeLightboxMediaItems = React.useCallback((assetId: number, mediaItems: MaterialMediaItem[]) => {
    if (!mediaItems.length) return;
    setLightbox((prev) => {
      if (prev.asset?.id !== assetId) return prev;
      const selectedIndex = prev.asset.selectedMediaId
        ? mediaItems.findIndex((media) => media.id === prev.asset?.selectedMediaId)
        : -1;
      const mediaIndex = selectedIndex >= 0 ? selectedIndex : Math.min(prev.mediaIndex, Math.max(0, mediaItems.length - 1));
      return {
        ...prev,
        mediaIndex,
        asset: {
          ...prev.asset,
          mediaItems,
        },
      };
    });
  }, []);

  const loadAssetDetail = React.useCallback(async (assetId: number) => {
    const cached = mediaCacheRef.current.get(assetId);
    setDetailError(null);
    if (cached) {
      mergeLightboxMediaItems(assetId, cached);
      return;
    }
    setDetailLoadingAssetId(assetId);
    try {
      const res = await fetch(`/api/admin/material-assets/${assetId}`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as { item?: { mediaItems?: MaterialMediaItem[] }; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "系列图详情加载失败");
      const mediaItems = Array.isArray(json?.item?.mediaItems) ? json.item.mediaItems : [];
      if (mediaItems.length) {
        mediaCacheRef.current.set(assetId, mediaItems);
        mergeLightboxMediaItems(assetId, mediaItems);
      }
    } catch (error) {
      if (lightboxAssetIdRef.current === assetId) {
        setDetailError(error instanceof Error ? error.message : "系列图详情加载失败");
      }
    } finally {
      setDetailLoadingAssetId((current) => (current === assetId ? null : current));
    }
  }, [mergeLightboxMediaItems]);

  const openLightbox = React.useCallback((asset: LightboxAsset) => {
    const mediaItems = mediaItemsForAsset(asset);
    const selectedIndex = mediaItems.findIndex((media) => media.id === asset.selectedMediaId);
    const mediaIndex = selectedIndex >= 0 ? selectedIndex : 0;
    const src = mediaItems[mediaIndex] ? originalUrlForMedia(mediaItems[mediaIndex]) : previewOriginalUrl(asset);
    if (!src) return;
    setDetailError(null);
    setLightbox({ open: true, mediaIndex, title: asset.title || "", asset });
    if (Number(asset.mediaCount || 1) > 1) void loadAssetDetail(asset.id);
  }, [loadAssetDetail]);

  const lightboxMediaItems = React.useMemo(() => (lightbox.asset ? mediaItemsForAsset(lightbox.asset) : []), [lightbox.asset]);
  const lightboxMediaIndex = Math.min(lightbox.mediaIndex, Math.max(0, lightboxMediaItems.length - 1));
  const lightboxMedia = lightboxMediaItems[lightboxMediaIndex] || null;
  const lightboxSrc = lightboxMedia ? originalUrlForMedia(lightboxMedia) : lightbox.asset ? previewOriginalUrl(lightbox.asset) : null;
  const lightboxKind: "image" | "video" = isVideoMediaItem(lightboxMedia, lightbox.asset || undefined) ? "video" : "image";
  const pageStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const pageEnd = Math.min(pagination.total, pagination.page * pagination.pageSize);
  const archivedPageStart = archivedPagination.total === 0 ? 0 : (archivedPagination.page - 1) * archivedPagination.pageSize + 1;
  const archivedPageEnd = Math.min(archivedPagination.total, archivedPagination.page * archivedPagination.pageSize);
  const archivedLoaded = Boolean(archivedPagination.loaded);
  const eventsPageStart = eventsPagination.total === 0 ? 0 : (eventsPagination.page - 1) * eventsPagination.pageSize + 1;
  const eventsPageEnd = Math.min(eventsPagination.total, eventsPagination.page * eventsPagination.pageSize);
  const eventsLoaded = Boolean(eventsPagination.loaded);

  const summaryStats = [
    { label: "当前挑选", value: stats.currentSelected },
    { label: "挑选记录", value: stats.selects },
    { label: "取消申请", value: stats.cancelRequests },
    { label: "已重新上架", value: stats.releases },
    { label: "日志", value: eventTotal },
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div ref={categoryMenuRef} className="relative flex items-center gap-1">
            <span className="text-[10px] text-[var(--app-muted)]"><UiText id="admin.m515559957fd3" /></span>
            <button
              type="button"
              onClick={() => setCategoryMenuOpen((open) => !open)}
              className="inline-flex h-7 w-[120px] items-center justify-between gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2 text-[10px] text-[var(--app-fg)] shadow-[var(--shadow-2)] outline-none transition hover:bg-[var(--panel-2)] focus-visible:border-[var(--border-2)]"
            >
              <span className="truncate">{currentCategoryLabel}</span>
              <ChevronDown className={["h-3.5 w-3.5 shrink-0 text-[var(--app-muted)] transition-transform", categoryMenuOpen ? "rotate-180" : ""].join(" ")} />
            </button>
            {categoryMenuOpen ? (
              <div className="app-dropdown-panel absolute left-[28px] top-[32px] z-40 w-[168px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-1 shadow-[0_18px_40px_-20px_rgba(0,0,0,0.65)]">
                {[{ key: "all", label: "全部", count: stats.currentSelected }, ...categoryOptions].map((option) => {
                  const active = categoryFilter === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => {
                        setCategoryFilter(option.key);
                        setPage(() => 1);
                        setCategoryMenuOpen(false);
                      }}
                      className={[
                        "flex h-8 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-left text-[11px] transition",
                        active ? "bg-blue-500/12 text-blue-600 dark:text-blue-300" : "text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]",
                      ].join(" ")}
                    >
                      <span className="min-w-0 truncate">{uiLabel(option.label)}</span>
                      <span className="shrink-0 text-[10px] opacity-70">{option.count}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <DateRangePicker
            from={selectedFrom}
            to={selectedTo}
            onFromChange={(value) => {
              setSelectedFrom(value);
              setPage(() => 1);
            }}
            onToChange={(value) => {
              setSelectedTo(value);
              setPage(() => 1);
            }}
            />
          {hasCurrentFilters ? (
            <button
              type="button"
              onClick={() => {
                setCategoryFilter("all");
                setSelectedFrom("");
                setSelectedTo("");
                setPage(() => 1);
              }}
              className="h-8 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[11px] text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
            ><UiText id="admin.m1ef3de06b32e" /></button>
          ) : null}
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--app-fg)]">
            <FileImage className="h-4 w-4 text-emerald-500" /><UiText id="admin.m6780226941c9" /></div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2 py-1">
              {summaryStats.map((item) => (
                <div key={item.label} className="flex items-baseline gap-1 text-[11px]">
                  <span className="text-[var(--app-muted)]">{uiLabel(item.label)}</span>
                  <span className="font-semibold tabular-nums text-[var(--app-fg)]">{item.value}</span>
                </div>
              ))}
            </div>
            <div className="flex rounded-lg border border-[var(--border)] bg-[var(--input-bg)] p-0.5">
              {[20, 50, 100].map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => {
                    setPageSize(size);
                    setPage(() => 1);
                  }}
                  className={[
                    "h-6 rounded-md px-2.5 text-[11px] transition",
                    pageSize === size
                      ? "bg-[var(--panel-2)] text-[var(--app-fg)] shadow-sm"
                      : "text-[var(--app-muted)] hover:text-[var(--app-fg)]",
                  ].join(" ")}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        </div>
        {current.length ? (
          <div className="space-y-4">
            {currentGroups.map((group) => (
              <div key={group.key}>
                <div className="mb-2 flex items-center gap-2 border-b border-[var(--border)] pb-1.5 text-[12px] font-medium text-[var(--app-fg)]">
                  <span>{uiLabel(group.label)}</span>
                  <span className="text-[11px] font-normal text-[var(--app-muted)]">{group.assets.length}<UiText id="admin.m7aaf96ad52e0" /></span>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
                  {group.assets.map((asset) => (
                    <div key={asset.id} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-2)]">
                      <UiProps ids={{"title":["admin.m771c680268c7"]}}><button
                        type="button"
                        onClick={() => openLightbox(asset)}
                        className="relative block aspect-square w-full overflow-hidden bg-[var(--input-bg)] text-left"
                        title="admin.m771c680268c7"
                      >
                        <MaterialAssetCover asset={asset} loading="eager" />
                      </button></UiProps>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--border)] py-8 text-center text-sm text-[var(--app-muted)]">
            {hasCurrentFilters ? <UiText id="admin.m285b1337e064" /> : <UiText id="admin.m3e91312d4c2f" />}
          </div>
        )}
        {pagination.total > 0 ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-4">
            <div className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m2428420e407f" /><span className="font-semibold tabular-nums text-[var(--app-fg)]">{pagination.total}</span><UiText id="admin.m31d3e3ac0cf2" /><span className="font-semibold tabular-nums text-[var(--app-fg)]">{pageStart}-{pageEnd}</span><UiText id="admin.m3a77f9290d86" /><span className="font-semibold tabular-nums text-[var(--app-fg)]">{pagination.pageSize}</span><UiText id="admin.m7aaf96ad52e0" /></div>
            <div className="flex items-center gap-2">
              <button type="button" disabled={pagination.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="h-8 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[12px] text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:opacity-50"><UiText id="admin.mc9b9ae7a6144" /></button>
              <button type="button" disabled={!pagination.hasMore} onClick={() => setPage((p) => p + 1)} className="h-8 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[12px] text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:opacity-50"><UiText id="admin.m8a8542f69648" /></button>
            </div>
          </div>
        ) : null}
      </section>

      {archivedTotal > 0 ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setArchivedOpen((prev) => !prev)}
              className="flex items-center gap-2 text-left text-sm font-semibold text-[var(--app-fg)] transition hover:text-violet-500"
            >
              <Archive className="h-4 w-4 text-violet-500" /><UiText id="admin.m5abc7b6734cd" /><ChevronDown className={["h-3.5 w-3.5 text-[var(--app-muted)] transition", archivedOpen ? "rotate-180" : ""].join(" ")} />
            </button>
            {archivedOpen ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m2428420e407f" /><span className="font-semibold tabular-nums text-[var(--app-fg)]">{archivedPagination.total}</span><UiText id="admin.m31d3e3ac0cf2" /><span className="font-semibold tabular-nums text-[var(--app-fg)]">{archivedPageStart}-{archivedPageEnd}</span><UiText id="admin.m7aaf96ad52e0" /></div>
                <div className="flex rounded-lg border border-[var(--border)] bg-[var(--input-bg)] p-0.5">
                  {[20, 50, 100].map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => {
                        setArchivedPageSize(size);
                        setArchivedPage(() => 1);
                      }}
                      className={[
                        "h-6 rounded-md px-2.5 text-[11px] transition",
                        archivedPageSize === size
                          ? "bg-[var(--panel-2)] text-[var(--app-fg)] shadow-sm"
                          : "text-[var(--app-muted)] hover:text-[var(--app-fg)]",
                      ].join(" ")}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m2428420e407f" /><span className="font-semibold tabular-nums text-[var(--app-fg)]">{archivedTotal}</span><UiText id="admin.m0e5037aabee8" /></div>
            )}
          </div>
          {archivedOpen ? (
            archivedLoaded ? (
              <div className="space-y-4">
                {archivedGroups.map((group) => (
                  <div key={group.key}>
                    <div className="mb-2 flex items-center gap-2 border-b border-[var(--border)] pb-1.5 text-[12px] font-medium text-[var(--app-fg)]">
                      <span>{uiLabel(group.label)}</span>
                      <span className="text-[11px] font-normal text-[var(--app-muted)]">{group.assets.length}<UiText id="admin.m7aaf96ad52e0" /></span>
                    </div>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
                      {group.assets.map((asset) => (
                        <div key={asset.id} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-2)]">
                          <UiProps ids={{"title":["admin.m771c680268c7"]}}><button
                            type="button"
                            onClick={() => openLightbox(asset)}
                            className="relative block aspect-square w-full overflow-hidden bg-[var(--input-bg)] text-left"
                            title="admin.m771c680268c7"
                          >
                            <MaterialAssetCover asset={asset} loading="eager" />
                          </button></UiProps>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-4">
                  <div className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m528ceff6a741" /><span className="font-semibold tabular-nums text-[var(--app-fg)]">{archivedPagination.pageSize}</span><UiText id="admin.m7aaf96ad52e0" /></div>
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={archivedPagination.page <= 1} onClick={() => setArchivedPage((p) => Math.max(1, p - 1))} className="h-8 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[12px] text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:opacity-50"><UiText id="admin.mc9b9ae7a6144" /></button>
                    <button type="button" disabled={!archivedPagination.hasMore} onClick={() => setArchivedPage((p) => p + 1)} className="h-8 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[12px] text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:opacity-50"><UiText id="admin.m8a8542f69648" /></button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--border)] py-8 text-center text-sm text-[var(--app-muted)]"><UiText id="admin.m1315c434fe37" /></div>
            )
          ) : null}
        </section>
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setEventsOpen((prev) => !prev)}
            className="flex items-center gap-2 text-left text-sm font-semibold text-[var(--app-fg)] transition hover:text-blue-500"
          >
            <Clock className="h-4 w-4 text-blue-500" /><UiText id="admin.m807516faae2e" /><ChevronDown className={["h-3.5 w-3.5 text-[var(--app-muted)] transition", eventsOpen ? "rotate-180" : ""].join(" ")} />
          </button>
          {eventsOpen ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m2428420e407f" /><span className="font-semibold tabular-nums text-[var(--app-fg)]">{eventsPagination.total}</span><UiText id="admin.mbfa3dc2750ac" /><span className="font-semibold tabular-nums text-[var(--app-fg)]">{eventsPageStart}-{eventsPageEnd}</span><UiText id="admin.m6fb2840d568a" /></div>
              <div className="flex rounded-lg border border-[var(--border)] bg-[var(--input-bg)] p-0.5">
                {[
                  { key: "all", label: "全部" },
                  { key: "select", label: "挑选" },
                  { key: "cancel_request", label: "取消" },
                  { key: "release", label: "上架" },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setEventsAction(item.key as "all" | "select" | "cancel_request" | "release");
                      setEventsPage(() => 1);
                    }}
                    className={[
                      "h-6 rounded-md px-2.5 text-[11px] transition",
                      eventsAction === item.key
                        ? "bg-[var(--panel-2)] text-[var(--app-fg)] shadow-sm"
                        : "text-[var(--app-muted)] hover:text-[var(--app-fg)]",
                    ].join(" ")}
                  >
                    {uiLabel(item.label)}
                  </button>
                ))}
              </div>
              <div className="flex rounded-lg border border-[var(--border)] bg-[var(--input-bg)] p-0.5">
                {[20, 50, 100].map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => {
                      setEventsPageSize(size);
                      setEventsPage(() => 1);
                    }}
                    className={[
                      "h-6 rounded-md px-2.5 text-[11px] transition",
                      eventsPageSize === size
                        ? "bg-[var(--panel-2)] text-[var(--app-fg)] shadow-sm"
                        : "text-[var(--app-muted)] hover:text-[var(--app-fg)]",
                    ].join(" ")}
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m2428420e407f" /><span className="font-semibold tabular-nums text-[var(--app-fg)]">{eventTotal}</span><UiText id="admin.mf6608d07f803" /></div>
          )}
        </div>
        {eventsOpen ? (
          eventsLoaded ? (
            events.length ? (
              <div className="overflow-hidden rounded-xl border border-[var(--border)]">
                <div className="overflow-x-auto">
                  <div className="min-w-[920px]">
                    <div className="grid grid-cols-[150px_86px_minmax(250px,1fr)_86px_110px_120px_70px] gap-2 border-b border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[11px] font-medium text-[var(--app-muted)]">
                      <div><UiText id="admin.m8b6ff498515b" /></div>
                      <div><UiText id="admin.mbe37d84119d6" /></div>
                      <div><UiText id="admin.m9af69965f173" /></div>
                      <div>ID</div>
                      <div><UiText id="admin.m0d0e1a86b3aa" /></div>
                      <div><UiText id="admin.m9689906e74a1" /></div>
                      <div className="text-right"><UiText id="admin.m979a332955c8" /></div>
                    </div>
                    <div className="divide-y divide-[var(--border)] bg-[var(--panel-bg)]">
                      {events.map((event) => {
                        const asset = eventAsset(event);
                        const expanded = expandedGroups.has(event.id);
                        return (
                          <div key={event.id}>
                            <div className="grid grid-cols-[150px_86px_minmax(250px,1fr)_86px_110px_120px_70px] items-center gap-2 px-3 py-2 text-[12px]">
                              <div className="tabular-nums text-[var(--app-muted)]">{fmtTime(event.occurredAt || "")}</div>
                              <div>
                                <span className={["inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium", actionClass(event.action)].join(" ")}>
                                  {event.action === "cancel_request" ? <XCircle className="h-3 w-3" /> : event.action === "release" ? <RotateCcw className="h-3 w-3" /> : null}
                                  {uiLabel(actionLabel(event.action))}
                                </span>
                              </div>
                              <div className="flex min-w-0 items-center gap-2">
                                <UiProps ids={{"title":["admin.m771c680268c7"]}}><button
                                  type="button"
                                  onClick={() => openLightbox({
                                    ...asset,
                                    eventCount: 1,
                                    latestAt: event.occurredAt || null,
                                    username: event.username || null,
                                  })}
                                  className="relative h-8 w-8 shrink-0 overflow-hidden rounded-md bg-[var(--input-bg)]"
                                  title="admin.m771c680268c7"
                                >
                                  <MaterialAssetCover asset={asset} compact />
                                </button></UiProps>
                                <div className="min-w-0">
                                  <div className="truncate font-medium text-[var(--app-fg)]">{asset.title}</div>
                                  <div className="truncate text-[10px] text-[var(--app-muted)]">{asset.category || <UiText id="admin.m54b89f901274" />}</div>
                                </div>
                              </div>
                              <div className="tabular-nums text-[var(--app-muted)]">{event.assetId}</div>
                              <div className="truncate text-[var(--app-muted)]" title={event.username}>{event.username || "-"}</div>
                              <div className="truncate text-[var(--app-muted)]" title={event.operatorUsername || ""}>{event.operatorUsername || "-"}</div>
                              <div className="text-right">
                                <button
                                  type="button"
                                  onClick={() => toggleGroup(event.id)}
                                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 text-[11px] text-[var(--app-fg)] transition hover:bg-[var(--input-bg)]"
                                ><UiText id="admin.m979a332955c8" /><ChevronDown className={["h-3 w-3 transition", expanded ? "rotate-180" : ""].join(" ")} />
                                </button>
                              </div>
                            </div>
                            {expanded ? (
                              <div className="grid grid-cols-[150px_1fr] gap-2 border-t border-[var(--border)] bg-[var(--panel-2)]/60 px-3 py-2 text-[11px]">
                                <div className="text-[var(--app-muted)]"><UiText id="admin.mdaede9881787" /></div>
                                <div className="break-words text-[var(--app-fg)]">{event.reason || "-"}</div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-3 py-3">
                  <div className="text-[12px] text-[var(--app-muted)]"><UiText id="admin.m528ceff6a741" /><span className="font-semibold tabular-nums text-[var(--app-fg)]">{eventsPagination.pageSize}</span><UiText id="admin.m6fb2840d568a" /></div>
                  <div className="flex items-center gap-2">
                    <button type="button" disabled={eventsPagination.page <= 1} onClick={() => setEventsPage((p) => Math.max(1, p - 1))} className="h-8 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[12px] text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:opacity-50"><UiText id="admin.mc9b9ae7a6144" /></button>
                    <button type="button" disabled={!eventsPagination.hasMore} onClick={() => setEventsPage((p) => p + 1)} className="h-8 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[12px] text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:opacity-50"><UiText id="admin.m8a8542f69648" /></button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--border)] py-8 text-center text-sm text-[var(--app-muted)]"><UiText id="admin.m67c4227ae79e" /></div>
            )
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--border)] py-8 text-center text-sm text-[var(--app-muted)]"><UiText id="admin.m9fb0dea50fd7" /></div>
          )
        ) : null}
      </section>
      <MediaLightbox
        open={lightbox.open}
        src={lightboxSrc}
        kind={lightboxKind}
        title={lightboxMediaItems.length > 1 ? `${lightbox.title} · ${lightboxMediaIndex + 1}/${lightboxMediaItems.length}` : lightbox.title}
        dots={lightboxMediaItems.length > 1 ? { count: lightboxMediaItems.length, activeIndex: lightboxMediaIndex } : undefined}
        details={lightbox.asset ? (
          <MaterialAssetLightboxDetails
            asset={lightbox.asset}
            mediaItems={lightboxMediaItems}
            activeMediaIndex={lightboxMediaIndex}
            onSelectMedia={(mediaIndex) => setLightbox((prev) => ({ ...prev, mediaIndex }))}
            loading={detailLoadingAssetId === lightbox.asset.id}
            error={detailError}
            onRetry={() => void loadAssetDetail(lightbox.asset!.id)}
          />
        ) : null}
        onClose={() => setLightbox((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
}

function MaterialAssetLightboxDetails({
  asset,
  mediaItems,
  activeMediaIndex,
  onSelectMedia,
  loading,
  error,
  onRetry,
}: {
  asset: LightboxAsset;
  mediaItems: MaterialMediaItem[];
  activeMediaIndex: number;
  onSelectMedia: (index: number) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const { label: tLabel } = useUiLocale();
  const { error: uiError } = useUiLocale();
  const rows: Array<[string, string]> = [
    ["标题", asset.title || "-"],
    ["ID", String(asset.id)],
    ["作者", asset.creatorName || "-"],
    ["挑选人", asset.selectedByUsername || asset.username || "-"],
    ["分类", asset.category || "未分类"],
    ["系列图张数", String(asset.mediaCount || mediaItems.length || 1)],
  ];

  if (asset.selectedAt) rows.push(["挑选时间", fmtTime(asset.selectedAt)]);
  if (asset.latestAt && !asset.selectedAt) rows.push(["最近记录", fmtTime(asset.latestAt)]);
  if (asset.username) rows.push(["用户", asset.username]);
  if (typeof asset.downloadCount === "number") rows.push(["下载次数", String(asset.downloadCount || 0)]);
  if (asset.sizeBytes) rows.push(["文件大小", formatSize(asset.sizeBytes)]);
  if (asset.eventCount) rows.push(["记录数", String(asset.eventCount)]);

  return (
    <div className="space-y-4 text-[13px]">
      <div>
        <div className="text-sm font-semibold text-[var(--app-fg)]"><UiText id="admin.m9713e97b9941" /></div>
        <div className="mt-1 break-words text-[12px] leading-5 text-[var(--app-muted)]">{asset.title || <UiText id="admin.me08240ff3cf2" values={{v0: String(asset.id)}} />}</div>
      </div>
      {loading ? (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-[12px] text-blue-600 dark:text-blue-300"><UiText id="admin.m0868ba72b983" /></div>
      ) : null}
      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
          <span className="min-w-0">{uiError(error)}</span>
          <button type="button" onClick={onRetry} className="shrink-0 rounded-md border border-amber-500/25 px-2 py-1 text-[11px] transition hover:bg-amber-500/10"><UiText id="admin.mb8784c8dd563" /></button>
        </div>
      ) : null}
      {mediaItems.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {mediaItems.map((media, index) => {
            const active = index === activeMediaIndex;
            return (
              <button
                key={media.id}
                type="button"
                onClick={() => onSelectMedia(index)}
                className={[
                  "relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border bg-[var(--panel-2)] transition",
                  active ? "border-blue-500 ring-2 ring-blue-500/25" : "border-[var(--border)] hover:border-blue-400/70",
                ].join(" ")}
                title={tLabel(`查看第 ${index + 1} 张`)}
              >
                {media.previewUrl || media.thumbnailUrl || !isVideoMediaItem(media, asset) ? (
                  <ResilientImage candidates={previewCandidatesForMedia(media, 160)} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[var(--panel-3)] text-[10px] font-medium text-[var(--app-muted)]"><UiText id="admin.mc20f7618d330" /></div>
                )}
                <span className={["absolute left-1 top-1 rounded px-1.5 py-0.5 text-[10px] text-white", active ? "bg-blue-500" : "bg-black/55"].join(" ")}>
                  {isVideoMediaItem(media, asset) ? <UiText id="admin.mc20f7618d330" /> : index + 1}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-3 border-b border-[var(--border)] pb-2 last:border-b-0">
            <span className="shrink-0 text-[var(--app-muted)]">{label}</span>
            <span className="min-w-0 break-words text-right text-[var(--app-fg)]">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
