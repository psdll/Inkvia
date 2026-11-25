"use client";

import { UiText } from "@/i18n/ui";


import * as React from "react";
import { Check, ChevronDown, FileImage, Music2, PlayCircle, Trash2, X } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { useAutoPaginate } from "@/hooks/use-auto-paginate";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { AssetSourceSelect } from "@/components/ui/asset-source-select";
import { ScrollToTopButton } from "@/components/ui/scroll-to-top-button";
import { ResilientImage } from "@/components/ui/resilient-image";
import { VideoBadge } from "@/components/ui/hover-preview-video";
import { subscribeMaterialPreview } from "@/lib/client/material-preview-queue";
import { getWarmParams } from "@/lib/image-cache-config";
import { buildMediaPreviewCandidates, buildMediaProxyUrl, isAudioMediaUrl, normalizeMediaUrl } from "@/lib/media-url";
import { isImagePath } from "@/lib/admin-utils";
import { loadAllFailedWorkIds } from "@/components/admin/admin-user-works-state";
import { applyAssetSourceFilterSearchParams, type AssetSourceFilterValue } from "@/lib/assets/source-filter";
import { friendlyErrorPrimaryText } from "@/lib/error-friendly";

export type WorksItem = {
  id: number;
  type: string;
  status: string;
  createdAt: string;
  finishedAt?: string | null;
  localPath?: string | null;
  displayUrl?: string | null;
  previewUrl?: string | null;
  posterUrl?: string | null;
  thumbUrl?: string | null;
  displayKind?: "image" | "video" | "audio";
  outputPaths?: string[];
  errorMsg?: string | null;
};

export type WorksTypeFilter = "all" | "face_swap" | "image_edit" | "video" | "audio" | "import";
export type WorksSourceFilter = AssetSourceFilterValue;

type UserWorksPanelProps = {
  dateFrom: string; dateTo: string;
  setDateFrom: (value: string) => void; setDateTo: (value: string) => void;
  cleanupMode?: boolean;
  onOpenUnreferencedImports: () => void;
  typeFilter: WorksTypeFilter;
  setTypeFilter: (f: WorksTypeFilter) => void;
  sourceFilter: WorksSourceFilter;
  setSourceFilter: (f: WorksSourceFilter) => void;
  items: WorksItem[];
  filteredItems: WorksItem[];
  isSearching: boolean;
  currentFilterTotal: number;
  hasMore: boolean;
  currentPage: number;
  onLoadPage: (page: number) => Promise<boolean>;
  inspirationMessage: string | null;
  inspirationBusyById: Record<number, boolean>;
  activeUser: { adminKey: string; userId: string; authUserId?: number | null } | null;
  onPushToInspiration?: (id: number) => void;
  onDetail: (item: WorksItem) => void;
  onRequestDeleteGeneration: (id: number, type: string) => void;
  onRequestBulkDeleteImports: (count: number) => void;
  onRequestBulkDeleteGenerations: (ids: number[]) => void;
  // 父组件批量删除完成后递增此值，本组件据此清空已选并退出多选模式
  bulkDeleteResetSignal?: number;
};

const FILTER_OPTIONS: Array<{ key: WorksTypeFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "face_swap", label: "人脸替换" },
  { key: "image_edit", label: "图片编辑" },
  { key: "video", label: "视频生成" },
  { key: "audio", label: "音频生成" },
  { key: "import", label: "导入未引用的素材" },
];

const ADMIN_WORKS_CARD_MIN_WIDTH = 150;
const ADMIN_WORKS_GRID_GAP = 8;

type WorksVirtualRow = {
  key: string;
  label: string;
  groupItems: WorksItem[];
  items: WorksItem[];
  isGroupFirst: boolean;
  addGroupGap: boolean;
};

function getVirtualRowKey(_index: number, row: WorksVirtualRow) {
  return row.key;
}

function getWorksMediaCandidates(item: WorksItem) {
  const outputs = Array.isArray(item.outputPaths)
    ? item.outputPaths.map((path) => normalizeMediaUrl(path)).filter(Boolean)
    : [];
  const local = normalizeMediaUrl(item.localPath || "");
  return Array.from(new Set([...outputs, local].filter(Boolean)));
}

function getPrimaryWorksMediaSrc(item: WorksItem) {
  return getWorksMediaCandidates(item)[0] || "";
}

function getWorksImageCandidates(item: WorksItem) {
  return getWorksMediaCandidates(item).filter((src) => isImagePath(src));
}

function isWorksVideo(item: WorksItem) {
  return item.displayKind === "video" || item.type === "video_gen" || item.type === "video_generate";
}

function getWorksDisplayCandidates(item: WorksItem) {
  const display = [item.posterUrl, item.previewUrl, item.displayUrl]
    .map((src) => normalizeMediaUrl(src || ""))
    .filter((src) => src && isImagePath(src));
  const images = getWorksImageCandidates(item);
  return Array.from(new Set([...display, ...images]));
}

function getWorksGridCandidates(item: WorksItem, width = 300) {
  const out: string[] = [];
  const thumb = normalizeMediaUrl(item.thumbUrl || "");
  if (thumb && isImagePath(thumb)) {
    if (thumb.startsWith("/uploads/")) out.push(...buildMediaPreviewCandidates(thumb, { width }));
    else out.push(buildMediaProxyUrl(thumb) || thumb);
  }
  for (const raw of getWorksDisplayCandidates(item)) {
    if (raw.startsWith("/uploads/")) out.push(`/api/thumb?src=${encodeURIComponent(raw)}&w=${width}`);
    out.push(buildMediaProxyUrl(raw) || raw);
  }
  // Older imported videos may not have a stored poster. Generate/cache a small
  // server-side cover; never mount many movie decoders as a grid fallback.
  const media = getPrimaryWorksMediaSrc(item);
  if (!out.length && isWorksVideo(item) && media.startsWith("/uploads/")) {
    out.push(`/api/thumb?src=${encodeURIComponent(media)}&w=${width}&poster=1`);
  }
  return Array.from(new Set(out.filter(Boolean)));
}


export default function UserWorksPanel({
  cleanupMode = false,
  onOpenUnreferencedImports,
  typeFilter,
  setTypeFilter,
  sourceFilter,
  setSourceFilter,
  items: _items,
  filteredItems,
  isSearching,
  currentFilterTotal,
  hasMore,
  currentPage,
  onLoadPage,
  inspirationMessage,
  inspirationBusyById,
  activeUser,
  onPushToInspiration,
  onDetail,
  onRequestDeleteGeneration,
  onRequestBulkDeleteGenerations,
  bulkDeleteResetSignal,
  dateFrom, dateTo, setDateFrom, setDateTo,
}: UserWorksPanelProps) {
  const [manualSelectionMode, setSelectionMode] = React.useState(false);
  const selectionMode = cleanupMode || manualSelectionMode;
  const previousBulkDeleteResetSignal = React.useRef(bulkDeleteResetSignal);
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(() => new Set());
  const [allFailedIds, setAllFailedIds] = React.useState<Set<number>>(() => new Set());
  const [selectingFailed, setSelectingFailed] = React.useState(false);
  const [selectFailedError, setSelectFailedError] = React.useState(false);
  const [selectingAll, setSelectingAll] = React.useState(false);
  const [selectAllError, setSelectAllError] = React.useState(false);
  const [didSelectAll, setDidSelectAll] = React.useState(false);
  const canCancelAll = didSelectAll && selectedIds.size > 0;
  const selectAllRequest = React.useRef<AbortController | null>(null);
  React.useEffect(() => {
    setSelectingAll(false);
    setSelectAllError(false);
    setDidSelectAll(false);
    return () => { selectAllRequest.current?.abort(); };
  }, [activeUser?.adminKey, typeFilter, sourceFilter, dateFrom, dateTo, selectionMode, bulkDeleteResetSignal]);

  const selectAllImports = async () => {
    if (!activeUser || selectingAll) return;
    const controller = new AbortController();
    selectAllRequest.current?.abort();
    selectAllRequest.current = controller;
    setSelectingAll(true);
    setSelectAllError(false);
    try {
      const params = new URLSearchParams({ adminKey: activeUser.adminKey, typeFilter: "import", idsOnly: "1" });
      applyAssetSourceFilterSearchParams(params, sourceFilter);
      if (dateFrom) params.set("from", new Date(`${dateFrom}T00:00:00`).toISOString());
      if (dateTo) params.set("to", new Date(`${dateTo}T23:59:59.999`).toISOString());
      const response = await fetch(`/api/admin/user/works?${params}`);
      if (!response.ok) throw new Error("Selection failed");
      const data = await response.json();
      if (data.scopeKey !== activeUser.adminKey || !Array.isArray(data.ids)) throw new Error("Invalid selection");
      if (!controller.signal.aborted) {
        setSelectedIds(new Set<number>(data.ids));
        setDidSelectAll(true);
      }
    } catch {
      if (!controller.signal.aborted) setSelectAllError(true);
    } finally {
      if (!controller.signal.aborted) setSelectingAll(false);
    }
  };
  // 虚拟化网格的有界高度（测量网格区到视口底部）
  const gridViewportRef = React.useRef<HTMLDivElement | null>(null);
  const [gridScrollParent, setGridScrollParent] = React.useState<HTMLDivElement | null>(null);
  const [gridHeight, setGridHeight] = React.useState(640);
  const [gridColumnCount, setGridColumnCount] = React.useState(1);
  const [gridThumbnailWidth, setGridThumbnailWidth] = React.useState(300);
  const typeMenuRef = React.useRef<HTMLDivElement | null>(null);
  const [typeMenuOpen, setTypeMenuOpen] = React.useState(false);
  const currentTypeLabel = FILTER_OPTIONS.find((option) => option.key === typeFilter)?.label || FILTER_OPTIONS[0].label;
  const [visibleRange, setVisibleRange] = React.useState({ startIndex: 0, endIndex: 0 });
  const [scrollDirection, setScrollDirection] = React.useState(1);
  const scrollTopRef = React.useRef(0);
  const previewSubscriptions = React.useRef(new Map<string, ReturnType<typeof subscribeMaterialPreview>>());
  const setGridViewportNode = React.useCallback((node: HTMLDivElement | null) => {
    gridViewportRef.current = node;
    setGridScrollParent(node);
  }, []);


  // SW 注册已集中到 components/system/service-worker-registration.tsx

  // 用户主动"退出多选"或删除完成后才清空；分页/搜索/筛选时保留选择，支持跨页累计删除
  React.useEffect(() => {
    if (bulkDeleteResetSignal === undefined || previousBulkDeleteResetSignal.current === bulkDeleteResetSignal) return;
    previousBulkDeleteResetSignal.current = bulkDeleteResetSignal;
    setSelectedIds(new Set());
    setAllFailedIds(new Set());
    setSelectFailedError(false);
    setSelectionMode(false);
  }, [bulkDeleteResetSignal]);

  React.useEffect(() => {
    if (!typeMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (typeMenuRef.current?.contains(target)) return;
      setTypeMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTypeMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [typeMenuOpen]);

  const exitSelectionMode = React.useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setAllFailedIds(new Set());
    setSelectFailedError(false);
  }, []);

  const toggleSelect = React.useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 按上传时间在已加载数据内筛选（范围同原"选择当天"）
  const dateFilteredItems = filteredItems;

  // 资产按"自然日"分组展示（最新日期在前），与「资产」一致。
  // dateFilteredItems 已按时间倒序，Map 保持插入顺序 → 日期倒序、组内倒序。
  const dateGroups = React.useMemo(() => {
    const groups = new Map<string, { day: string; label: string; items: WorksItem[] }>();
    for (const g of dateFilteredItems) {
      const d = new Date(g.createdAt);
      const valid = !Number.isNaN(d.getTime());
      const day = valid
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
        : "unknown";
      const label = valid ? day : "未知日期";
      const grp = groups.get(day) || { day, label, items: [] as WorksItem[] };
      grp.items.push(g);
      groups.set(day, grp);
    }
    return Array.from(groups.values());
  }, [dateFilteredItems]);

  const virtualRows = React.useMemo<WorksVirtualRow[]>(() => dateGroups.flatMap((group, groupIndex) => {
    const rows: WorksVirtualRow[] = [];
    for (let start = 0; start < group.items.length; start += gridColumnCount) {
      const isLastChunk = start + gridColumnCount >= group.items.length;
      rows.push({
        key: `${group.day}:${start}`,
        label: group.label,
        groupItems: group.items,
        items: group.items.slice(start, start + gridColumnCount),
        isGroupFirst: start === 0,
        addGroupGap: isLastChunk && groupIndex < dateGroups.length - 1,
      });
    }
    return rows;
  }), [dateGroups, gridColumnCount]);

  const pagination = useAutoPaginate({
    scrollRef: gridViewportRef,
    enabled: Boolean(gridScrollParent && dateFilteredItems.length),
    hasMore,
    currentPage,
    loadPage: onLoadPage,
    resetKey: `${activeUser?.adminKey}|${typeFilter}|${sourceFilter}|${dateFrom}|${dateTo}`,
    // Data must arrive before the thumbnail lookahead window reaches this batch.
    preloadPx: Math.min(4800, Math.max(1800, gridHeight * 3)),
    minScrollableScreens: 1.5,
    onScrollFrame: ({ scrollTop }) => {
      const delta = scrollTop - scrollTopRef.current;
      scrollTopRef.current = scrollTop;
      if (delta) setScrollDirection(delta > 0 ? 1 : -1);
    },
  });

  // 绘制前测量滚动区与列数，避免首帧先按单列渲染再跳成多列。
  React.useLayoutEffect(() => {
    const el = gridViewportRef.current;
    if (!el) return;
    const measure = () => {
      setGridHeight(Math.max(360, window.innerHeight - el.getBoundingClientRect().top - 24));
      const columns = Math.max(1, Math.floor((el.clientWidth + ADMIN_WORKS_GRID_GAP) / (ADMIN_WORKS_CARD_MIN_WIDTH + ADMIN_WORKS_GRID_GAP)));
      setGridColumnCount(columns);
      const cardWidth = (el.clientWidth - (columns - 1) * ADMIN_WORKS_GRID_GAP) / columns;
      setGridThumbnailWidth(cardWidth * Math.min(window.devicePixelRatio || 1, 2) > 450 ? 600 : 300);
    };
    measure();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resizeObserver?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [dateFilteredItems.length]);

  React.useEffect(() => {
    const params = getWarmParams("admin-works");
    const subscriptions = previewSubscriptions.current;
    if (!params) {
      subscriptions.forEach(cancel => cancel());
      subscriptions.clear();
      return;
    }
    // rangeChanged includes Virtuoso's rendered buffer. Warm AFTER that buffer,
    // not the last already-mounted row. The queue limits downloads to six.
    const limit = Math.min(64, params.limit, gridColumnCount * Math.ceil(gridHeight / 170) * 2);
    const rowCount = Math.ceil(limit / gridColumnCount);
    const aheadRows = scrollDirection > 0
      ? virtualRows.slice(visibleRange.endIndex + 1, visibleRange.endIndex + 1 + rowCount)
      : virtualRows.slice(Math.max(0, visibleRange.startIndex - rowCount), visibleRange.startIndex).reverse();
    const candidatesForRows = (rows: WorksVirtualRow[]) => rows.flatMap(row => row.items)
      .filter(item => item.status !== "failed" && item.displayKind !== "audio" && item.type !== "audio_gen")
      .map(item => getWorksGridCandidates(item, gridThumbnailWidth)).filter(group => group.length);
    const ahead = candidatesForRows(aheadRows).slice(0, limit);
    const retained = new Set(candidatesForRows(virtualRows.slice(visibleRange.startIndex, visibleRange.endIndex + 1))
      .concat(ahead).map(group => group.join("|")));
    for (const [key, cancel] of subscriptions) {
      if (!retained.has(key)) { cancel(); subscriptions.delete(key); }
    }
    ahead.forEach((candidates, index) => {
      const key = candidates.join("|");
      const existing = subscriptions.get(key);
      if (existing) existing.setPriority(limit - index);
      else subscriptions.set(key, subscribeMaterialPreview(candidates, limit - index, () => {}));
    });
    // Keep overlapping requests alive when the range or next data batch changes.
  }, [virtualRows, visibleRange, gridColumnCount, gridHeight, gridThumbnailWidth, scrollDirection]);

  React.useEffect(() => () => {
    previewSubscriptions.current.forEach(cancel => cancel());
    previewSubscriptions.current.clear();
  }, []);

  const visibleIds = React.useMemo(() => dateFilteredItems.map((g) => g.id), [dateFilteredItems]);
  const visibleFailedIds = React.useMemo(() => dateFilteredItems.filter((g) => g.status === "failed").map((g) => g.id), [dateFilteredItems]);
  const selectedFailedIds = React.useMemo(
    () => Array.from(allFailedIds.size ? allFailedIds : new Set(visibleFailedIds)).filter((id) => selectedIds.has(id)),
    [allFailedIds, selectedIds, visibleFailedIds],
  );
  const enterSelectionMode = React.useCallback(() => {
    setSelectedIds(new Set());
    setAllFailedIds(new Set());
    setSelectFailedError(false);
    setSelectionMode(true);
  }, []);

  const selectAllFailed = React.useCallback(async () => {
    if (!activeUser?.adminKey || selectingFailed) return;
    setSelectingFailed(true);
    setSelectFailedError(false);
    try {
      const ids = await loadAllFailedWorkIds(activeUser.adminKey);
      setAllFailedIds(new Set(ids));
      setSelectedIds(new Set(ids));
    } catch {
      setSelectFailedError(true);
    } finally {
      setSelectingFailed(false);
    }
  }, [activeUser?.adminKey, selectingFailed]);

  const toggleGroupSelect = React.useCallback((ids: number[]) => {
    setSelectedIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      const next = new Set(prev);
      ids.forEach((id) => {
        if (allSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  }, []);

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-t-xl border-b border-white/10 bg-[var(--panel-bg)] px-3 py-1.5 sm:px-4">
        <div ref={typeMenuRef} className="relative flex items-center gap-1">
          <span className="text-[10px] text-[var(--app-muted)]"><UiText id="admin.m515559957fd3" /></span>
          <button
            type="button"
            onClick={() => setTypeMenuOpen((open) => !open)}
            className="inline-flex h-7 w-[120px] items-center justify-between gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2 text-[10px] text-[var(--app-fg)] shadow-[var(--shadow-2)] outline-none transition hover:bg-[var(--panel-2)] focus-visible:border-[var(--border-2)]"
          >
            <span className="truncate">{currentTypeLabel}</span>
            <ChevronDown className={["h-3.5 w-3.5 shrink-0 text-[var(--app-muted)] transition-transform", typeMenuOpen ? "rotate-180" : ""].join(" ")} />
          </button>
          {typeMenuOpen ? (
            <div className="app-dropdown-panel absolute left-[28px] top-[32px] z-40 w-[148px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-1 shadow-[0_18px_40px_-20px_rgba(0,0,0,0.65)]">
              {FILTER_OPTIONS.map(({ key, label }) => {
                const active = typeFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      exitSelectionMode();
                      setTypeFilter(key);
                      setTypeMenuOpen(false);
                    }}
                    className={[
                      "flex h-7 w-full items-center justify-between gap-1.5 rounded-lg px-2 text-left text-[10px] transition",
                      active
                        ? "bg-[var(--panel-2)] text-[var(--app-fg)]"
                        : "text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]",
                    ].join(" ")}
                  >
                    <span className="truncate">{label}</span>
                    {active ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        {/* 按上传时间筛选（代替原"选择当天"：选某天 → 列表只剩那天 → 全选） */}
        <div className="flex items-center gap-1">
          <DateRangePicker from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} />
        </div>
        <AssetSourceSelect
          value={sourceFilter}
          onChange={setSourceFilter}
          disabled={typeFilter === "import"}
          compact
          className="w-[166px]"
          buttonClassName="!h-7 !rounded-lg !px-2 !text-[10px]"
        />
        <div className="ml-auto flex items-center gap-2">
          {selectionMode ? (
            <div className="flex items-center gap-2">
              {activeUser ? (
                <button
                  type="button"
                  disabled={selectingAll || (typeFilter === "import" && !canCancelAll && currentFilterTotal <= 0)}
                  onClick={() => {
                    if (typeFilter !== "import") {
                      onOpenUnreferencedImports();
                      return;
                    }
                    if (canCancelAll) {
                      setSelectedIds(new Set());
                      setDidSelectAll(false);
                      return;
                    }
                    void selectAllImports();
                  }}
                  className="inline-flex h-8 w-[128px] shrink-0 justify-center whitespace-nowrap items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 text-[11px] font-medium text-rose-700 shadow-[var(--shadow-2)] transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {typeFilter === "import" ? (selectingAll ? <UiText id="admin.m07b9d2a60922" /> : selectAllError ? <UiText id="admin.m614b1f034564" /> : canCancelAll ? <UiText id="admin.m2cd0f3be8738" /> : <UiText id="admin.m5c55a67935af" />) : <UiText id="admin.m681c4a54aa99" />}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void selectAllFailed()}
                disabled={!activeUser?.adminKey || selectingFailed}
                className="inline-flex h-8 w-[128px] shrink-0 justify-center whitespace-nowrap items-center gap-1.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 text-[11px] font-medium text-amber-600 shadow-[var(--shadow-2)] transition hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-45 dark:text-amber-300"
              >
                {selectingFailed
                  ? <UiText id="admin.m07b9d2a60922" />
                  : selectFailedError
                    ? <UiText id="admin.m614b1f034564" />
                    : <UiText id="admin.m50f26fa59752" values={{v0: String(selectedFailedIds.length ? ` (${selectedFailedIds.length})` : "")}} />}
              </button>
              <button
                type="button"
                onClick={() => onRequestBulkDeleteGenerations(Array.from(selectedIds))}
                disabled={selectedIds.size === 0 || selectingAll}
                className="inline-flex h-8 w-[112px] shrink-0 justify-center whitespace-nowrap items-center gap-1.5 rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 text-[11px] font-medium text-rose-600 shadow-[var(--shadow-2)] transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-45 dark:text-rose-300"
              >
                <Trash2 className="h-3.5 w-3.5" /><UiText id="admin.m2f9daa828907" />{selectedIds.size ? ` (${selectedIds.size})` : ""}
              </button>
              {!cleanupMode ? (
              <button
                type="button"
                onClick={exitSelectionMode}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[11px] font-medium text-[var(--app-fg)] shadow-[var(--shadow-2)] transition hover:bg-[var(--panel-2)]"
              >
                <X className="h-3.5 w-3.5" /><UiText id="admin.m74966e20df2e" /></button>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={enterSelectionMode}
              disabled={visibleIds.length === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[11px] font-medium text-[var(--app-fg)] shadow-[var(--shadow-2)] transition hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Check className="h-3.5 w-3.5" /><UiText id="admin.m9ab296886086" /></button>
          )}
        </div>
      </div>

      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
      {onPushToInspiration && inspirationMessage ? (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-700 dark:text-emerald-300">
          {inspirationMessage}
        </div>
      ) : null}

      {dateFilteredItems.length ? (
        <>
          <div
            ref={setGridViewportNode}
            data-admin-works-scroll
            style={{ height: gridHeight }}
            className="overflow-y-auto pr-1"
            onScroll={pagination.onScroll}
          >
          {gridScrollParent ? (
            <Virtuoso
              customScrollParent={gridScrollParent}
              data={virtualRows}
              computeItemKey={getVirtualRowKey}
              increaseViewportBy={{ top: 300, bottom: 600 }}
              rangeChanged={setVisibleRange}
              totalListHeightChanged={pagination.onScroll}
              itemContent={(_index, row) => (
            <section className={["space-y-2.5", row.addGroupGap ? "pb-6" : "pb-2"].join(" ")}>
              {row.isGroupFirst ? (
              <div className="flex items-center gap-2 px-0.5">
                {selectionMode ? (
                  <button
                    type="button"
                    onClick={() => toggleGroupSelect(row.groupItems.map((item) => item.id))}
                    className={[
                      "flex h-4 w-4 items-center justify-center rounded border transition",
                      row.groupItems.every((item) => selectedIds.has(item.id))
                        ? "border-[var(--primary-bg)] bg-[var(--primary-bg)] text-[var(--primary-fg)]"
                        : row.groupItems.some((item) => selectedIds.has(item.id))
                          ? "border-[var(--primary-bg)] bg-[var(--primary-bg)]/25 text-[var(--primary-bg)]"
                          : "border-[var(--border)] bg-[var(--input-bg)] text-transparent hover:border-[var(--border-2)]",
                    ].join(" ")}
                    aria-label={`选择 ${row.label}`}
                  >
                    <Check className="h-3 w-3" />
                  </button>
                ) : null}
                <h3 className="text-[13px] font-semibold text-[var(--app-fg)]">{row.label}</h3>
                <span className="inline-flex h-5 items-center rounded-full border border-[var(--border)] bg-[var(--panel-2)] px-2 text-[11px] text-[var(--app-muted)]">{row.groupItems.length}<UiText id="admin.mf9d529eacdf3" /></span>
              </div>
              ) : null}
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: `repeat(${gridColumnCount}, minmax(0, 1fr))` }}
              >
                {row.items.map((g) => {
                    const isVideo = isWorksVideo(g);
                    const isAudio = g.type === "audio_gen" || g.displayKind === "audio" || isAudioMediaUrl(g.localPath);
                    const isSelected = selectedIds.has(g.id);
                    const onCardClick = selectionMode ? () => toggleSelect(g.id) : () => onDetail(g);

                    // 失败任务：保持时间顺序留在原位，但弱化展示——虚线淡红格，不再画成与成功资产一样的实心大方格
                    if (g.status === "failed") {
                      const failTime = new Date(g.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
                      const failureReason = g.errorMsg ? friendlyErrorPrimaryText(g.errorMsg) : "未记录失败原因";
                      return (
                        <div
                          key={g.id}
                          data-admin-work-id={g.id}
                          onClick={onCardClick}
                          className={[
                            "group relative aspect-square rounded-2xl border border-dashed overflow-hidden flex flex-col items-center justify-center text-center px-2 transition",
                            selectionMode ? "cursor-pointer" : "",
                            isSelected
                              ? "border-rose-500 ring-2 ring-rose-500/40 bg-rose-500/10"
                              : "border-rose-500/25 bg-rose-500/[0.04] hover:bg-rose-500/[0.08]",
                          ].join(" ")}
                        >
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-300">
                            <X className="h-4 w-4" />
                          </span>
                          <div className="mt-1.5 text-[11px] font-medium text-rose-600/90 dark:text-rose-300/90">{isAudio ? <UiText id="admin.m296c632ec857" /> : isVideo ? <UiText id="admin.mc20f7618d330" /> : <UiText id="admin.md24c10d37db0" />}<UiText id="admin.m470f92db3d64" /></div>
                          <div
                            className="mt-1 line-clamp-2 w-full break-words text-[10px] leading-4 text-rose-600/75 dark:text-rose-300/75"
                          >
                            {failureReason}
                          </div>
                          <div className="mt-0.5 text-[10px] text-rose-600/55 dark:text-rose-300/55">ID {g.id} · {failTime}</div>
                          {selectionMode ? (
                            <div
                              className={[
                                "absolute top-2 left-2 h-5 w-5 rounded-md border-2 flex items-center justify-center shadow-md transition",
                                isSelected ? "bg-rose-500 border-rose-500 text-white" : "bg-white/60 dark:bg-black/40 border-rose-500/60 text-transparent",
                              ].join(" ")}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </div>
                          ) : false && (
                            <div className="absolute inset-x-0 bottom-0 p-2 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button type="button" onClick={() => onDetail(g)} className="h-6 px-2.5 rounded-lg bg-rose-500/10 text-rose-700 dark:text-rose-300 text-[11px] font-medium hover:bg-rose-500/20 transition"><UiText id="admin.m979a332955c8" /></button>
                              <button
                                type="button"
                                onClick={() => onRequestDeleteGeneration(g.id, g.type)}
                                className="h-6 w-6 rounded-lg bg-rose-500/10 text-rose-700 dark:text-rose-300 flex items-center justify-center hover:bg-rose-500/20 transition"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    }

                    const mediaSrc = getPrimaryWorksMediaSrc(g);
                    const imageCandidates = getWorksGridCandidates(g, gridThumbnailWidth);
                    return (
                      <div
                        key={g.id}
                        data-admin-work-id={g.id}
                        onClick={onCardClick}
                        className={[
                          "group group/media relative aspect-square rounded-2xl bg-[var(--panel-bg)] border overflow-hidden flex flex-col transition",
                          selectionMode ? "cursor-pointer" : "",
                          isSelected ? "border-rose-500 ring-2 ring-rose-500/40" : "border-[var(--border)]",
                        ].join(" ")}
                      >
                        <div className="relative flex-1 bg-black/20 flex items-center justify-center overflow-hidden">
                          {isAudio ? (
                            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[var(--panel-bg)] text-[var(--app-muted)]">
                              <Music2 className="h-8 w-8" />
                              <span className="text-xs">{g.status === "success" ? <UiText id="admin.m296c632ec857" /> : <UiText id="admin.m273088e5b422" />}</span>
                            </div>
                          ) : mediaSrc || imageCandidates.length ? (
                            imageCandidates.length ? (
                              <ResilientImage
                                candidates={imageCandidates}
                                alt=""
                                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                loading="eager"
                                decoding="async"
                                fetchPriority="auto"
                                warmOnLoad={false}
                              />
                            ) : (
                              <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-black/35 text-white/70">
                                <PlayCircle className="h-8 w-8" />
                                <span className="text-[11px]"><UiText id="admin.m05608cc41def" /></span>
                              </div>
                            )
                           ) : (
                             <FileImage className="h-6 w-6 text-white/20" />
                           )}
                          {isVideo ? (
                            <VideoBadge />
                          ) : null}
                          {isVideo ? (
                             <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--overlay)] opacity-0 group-hover/media:opacity-100 transition-opacity">
                               <div className="h-16 w-16 rounded-full bg-[var(--panel-bg)]/90 border border-[var(--border)] flex items-center justify-center">
                                 <div className="ml-1 w-0 h-0 border-l-[16px] border-l-[var(--app-fg)] border-y-[10px] border-y-transparent" />
                               </div>
                             </div>
                           ) : null}
                           {isVideo ? (
                             <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-1 text-[10px] font-medium text-white/90 backdrop-blur">
                              <PlayCircle className="h-3 w-3" /><UiText id="admin.mc20f7618d330" /></div>
                          ) : null}
                          <div className="absolute top-2 right-2">
                            {g.status === "success" && <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />}
                            {g.status === "failed" && <div className="h-2 w-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]" />}
                            {(g.status === "pending" || g.status === "processing") && <div className="h-2 w-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)] animate-pulse" />}
                          </div>
                          {selectionMode ? (
                            <div
                              className={[
                                "absolute top-2 left-2 h-5 w-5 rounded-md border-2 flex items-center justify-center shadow-md transition",
                                isSelected ? "bg-rose-500 border-rose-500 text-white" : "bg-black/40 border-white/80 text-transparent",
                              ].join(" ")}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </div>
                          ) : null}
                        </div>
                        <div className="absolute inset-x-0 top-0 p-2 bg-gradient-to-b from-black/60 to-transparent flex justify-between items-start pointer-events-none">
                          <div className={["text-[10px] text-white/90 drop-shadow-md", selectionMode ? "pl-7" : ""].join(" ")}>
                            <div>{new Date(g.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</div>
                            <div className="mt-0.5 text-white/80">ID: {g.id}</div>
                            {g.finishedAt && g.finishedAt !== g.createdAt && (
                              <div className="text-white/60 mt-0.5"><UiText id="admin.md9cea8fc7615" />{new Date(g.finishedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                              </div>
                            )}
                          </div>
                        </div>
                        {false && (
                          <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-between gap-2">
                            <button type="button" onClick={() => onDetail(g)} className="h-7 px-3 rounded-lg bg-white/10 backdrop-blur text-white text-[11px] font-medium hover:bg-white/20 transition"><UiText id="admin.m979a332955c8" /></button>
                            <div className="flex items-center gap-2">
                              {onPushToInspiration && <button
                                type="button"
                                disabled={Boolean(inspirationBusyById[g.id])}
                                onClick={() => onPushToInspiration?.(g.id)}
                                className="h-7 px-2.5 rounded-lg bg-violet-600/85 backdrop-blur text-white text-[11px] font-medium hover:bg-violet-500 transition disabled:opacity-70"
                              >
                                {inspirationBusyById[g.id] ? <UiText id="admin.mce1c9d61565f" /> : <UiText id="admin.m024e9ad72a65" />}
                              </button>}
                              <button
                                type="button"
                                onClick={() => onRequestDeleteGeneration(g.id, g.type)}
                                className="h-7 w-7 rounded-lg bg-rose-600/80 backdrop-blur text-white flex items-center justify-center hover:bg-rose-500 transition"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </section>
              )}
            />
          ) : null}
          <div role="status" className="flex min-h-12 items-center justify-center gap-3 text-xs text-[var(--app-muted)]">
            {pagination.failedAppendPage != null ? <>
              <span><UiText id="admin.m05908d4ebd0a" /></span>
              <button className="underline" onClick={() => void pagination.retryAppend()}><UiText id="admin.m8924c7887461" /></button>
            </> : pagination.appendInFlight ? <UiText id="admin.m935a1a456500" /> : hasMore
              ? <UiText id="admin.m119d98814dd4" values={{v0: String(dateFilteredItems.length)}} />
              : <UiText id="admin.m24b5d9c87328" values={{v0: String(dateFilteredItems.length)}} />}
          </div>
          </div>
          <ScrollToTopButton scrollContainerRef={gridViewportRef} />
        </>
      ) : (
        <div className="py-10 text-center text-[13px] text-[var(--app-muted)]">
          {isSearching ? <UiText id="admin.mae3f76e04bf0" /> : (dateFrom || dateTo ? <UiText id="admin.m2243913c6781" /> : <UiText id="admin.m4ff8de9eaafb" />)}
        </div>
      )}
      </div>
    </div>
  );
}
