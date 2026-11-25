"use client";

import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { AtomicPageReveal } from "@/components/layout/atomic-page-reveal";
import { createPortal } from "react-dom";
import { Check, CheckSquare, ChevronDown, HardDrive, Image as ImageIcon, Music2, RefreshCw, Square, Trash2, UploadCloud, Video, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MediaLightbox } from "@/components/ui/media-lightbox";
import { ResilientImage } from "@/components/ui/resilient-image";
import { buildMediaOriginalUrl, buildMediaPreviewCandidates, buildMediaProxyUrl, isVideoMediaUrl } from "@/lib/media-url";
import { MEDIA_LIBRARY_UNGROUPED } from "@/lib/media-library";

type AdminSharedMediaItem = {
  id: number;
  scope: "shared";
  kind: "image" | "video" | "audio";
  groupName?: string | null;
  title: string;
  fileUrl: string;
  thumbnailUrl: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  tags?: string[];
  createdAt: string;
  canDelete: boolean;
};

type AdminSharedMediaResponse = {
  items?: AdminSharedMediaItem[];
  groups?: string[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  } | null;
  error?: string;
};

type AdminDeletePayload =
  | { mode: "ids"; ids: number[] }
  | { mode: "group"; groupName: string; kind: "all" | "image" | "video" | "audio" }
  | { mode: "filtered"; groupName: string; kind: "all" | "image" | "video" | "audio"; q: string };

type UploadProgressItem = {
  id: string;
  fileName: string;
  file: File;
  loadedBytes: number;
  totalBytes: number;
  percent: number;
  status: "waiting" | "uploading" | "success" | "error";
  message?: string;
};

type PendingUploadItem = {
  id: string;
  file: File;
  previewUrl: string;
  kind: "image" | "video" | "audio" | "file";
};

function formatFileSize(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let idx = 0;
  while (v >= 1024 && idx < units.length - 1) {
    v /= 1024;
    idx += 1;
  }
  return `${v >= 100 || idx === 0 ? Math.round(v) : v.toFixed(1)} ${units[idx]}`;
}

function getPendingUploadKind(file: File): PendingUploadItem["kind"] {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

function dateKey(s: string | null) {
  if (!s) return "未记录日期";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "未记录日期";
  const yyyy = d.getFullYear();
  const mm = `${d.getMonth() + 1}`.padStart(2, "0");
  const dd = `${d.getDate()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dayLabel(key: string) {
  if (key === "未记录日期") return "";
  const d = new Date(`${key}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const targetStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((targetStart - todayStart) / 86400000);
  if (diffDays === 0) return "今天";
  if (diffDays === -1) return "昨天";
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return weekdays[d.getDay()] || "";
}

function fmtTime(s: string | null) {
  if (!s) return "-";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const yyyy = d.getFullYear();
  const mm = `${d.getMonth() + 1}`.padStart(2, "0");
  const dd = `${d.getDate()}`.padStart(2, "0");
  const hh = `${d.getHours()}`.padStart(2, "0");
  const mi = `${d.getMinutes()}`.padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

function pickPreviewCandidates(item: AdminSharedMediaItem) {
  if (item.kind === "audio") return [];
  if (item.kind === "video" && item.thumbnailUrl && !isVideoMediaUrl(item.thumbnailUrl)) {
    const posterCandidates = buildMediaPreviewCandidates(item.thumbnailUrl, {
      width: 360,
      height: 200,
      mode: "cover",
    });
    return Array.from(new Set(posterCandidates.map((url) => buildMediaProxyUrl(url) || url)));
  }
  const candidates = buildMediaPreviewCandidates(item.thumbnailUrl || item.fileUrl || "", {
    width: 360,
    height: 480,
    mode: item.kind === "image" ? "contain" : "cover",
  });
  return Array.from(new Set(candidates.map((url) => buildMediaProxyUrl(url) || url)));
}

function pickRawUrl(item: AdminSharedMediaItem) {
  return buildMediaOriginalUrl(item.fileUrl || item.thumbnailUrl || "");
}

function pickProxyUrl(item: AdminSharedMediaItem) {
  const raw = pickRawUrl(item);
  return buildMediaProxyUrl(raw) || raw;
}

const ADMIN_MEDIA_PAGE_SIZE = 48;

const DEFAULT_PAGINATION = {
  page: 1,
  pageSize: ADMIN_MEDIA_PAGE_SIZE,
  total: 0,
  totalPages: 1,
  hasMore: false,
};

function StatChip({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      className={[
        "hidden items-center gap-1.5 rounded-lg border px-2.5 py-1.5 sm:flex",
        accent
          ? "border-blue-500/20 bg-blue-500/10 text-blue-500"
          : "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)]",
      ].join(" ")}
    >
      <span className="text-[11px] text-[var(--app-muted)]">{label}</span>
      <span className="text-[13px] font-semibold">{value}</span>
    </div>
  );
}

function CategoryTabBtn({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={[
        "h-7 max-w-[140px] truncate rounded-full px-3 text-[12px] transition",
        active
          ? "bg-blue-500/12 text-blue-500 ring-1 ring-blue-500/25"
          : "text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function ProductBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-white/20 bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">
      {children}
    </span>
  );
}

type GroupComboboxProps = {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
  ariaLabel: string;
  compact?: boolean;
  className?: string;
  emptyLabel?: string;
  emptyHelper?: string;
};

function GroupCombobox({
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
  compact = false,
  className = "",
  emptyLabel = "不指定分类",
  emptyHelper = "清空当前选择",
}: GroupComboboxProps) {
  const { label: uiLabel } = useUiLocale();
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const skipOpenOnFocusRef = React.useRef(false);
  const listId = React.useId();
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties>({
    position: "fixed",
    left: 0,
    top: 0,
    width: 0,
    maxHeight: 280,
    zIndex: 120,
  });

  const normalizedOptions = React.useMemo(() => {
    return Array.from(new Set(options.map((item) => item.trim()).filter(Boolean)));
  }, [options]);

  const keyword = value.trim().toLowerCase();
  const matchedOptions = React.useMemo(() => {
    if (!keyword) return normalizedOptions;
    return normalizedOptions.filter((item) => item.toLowerCase().includes(keyword));
  }, [keyword, normalizedOptions]);

  const showCreateOption = Boolean(value.trim()) && !normalizedOptions.some((item) => item.toLowerCase() === keyword);
  const menuItems = React.useMemo(() => {
    const next = [
      {
        key: "__empty__",
        value: "",
        label: emptyLabel,
        helper: emptyHelper,
        isCreate: false,
      },
      ...matchedOptions.map((item) => ({
      key: item,
      value: item,
      label: item,
      helper: "选择已有分类",
      isCreate: false,
      })),
    ];
    if (showCreateOption) {
      next.unshift({
        key: `__create__${value.trim()}`,
        value: value.trim(),
        label: `使用“${value.trim()}”`,
        helper: "新建并使用这个分类名",
        isCreate: true,
      });
    }
    return next;
  }, [emptyHelper, emptyLabel, matchedOptions, showCreateOption, value]);

  React.useEffect(() => {
    if (!open) return;
    const updateMenuPosition = () => {
      const input = inputRef.current;
      if (!input) return;
      const rect = input.getBoundingClientRect();
      const viewportH = window.innerHeight || 0;
      const viewportW = window.innerWidth || 0;
      const padding = 12;
      const gap = 8;
      const desiredHeight = Math.min(280, Math.max(120, menuItems.length * 52 + 16));
      const below = Math.max(0, viewportH - rect.bottom - padding - gap);
      const above = Math.max(0, rect.top - padding - gap);
      const placeAbove = below < 180 && above > below;
      const maxHeight = Math.max(100, Math.min(desiredHeight, placeAbove ? above : below || desiredHeight));
      const width = Math.min(Math.max(rect.width, compact ? 220 : 280), viewportW - padding * 2);
      const left = Math.min(
        Math.max(padding, rect.left),
        Math.max(padding, viewportW - width - padding)
      );
      setMenuStyle(
        placeAbove
          ? {
              position: "fixed",
              left,
              bottom: Math.max(padding, viewportH - rect.top + gap),
              width,
              maxHeight,
              zIndex: 120,
            }
          : {
              position: "fixed",
              left,
              top: Math.min(viewportH - padding, rect.bottom + gap),
              width,
              maxHeight,
              zIndex: 120,
            }
      );
    };

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [compact, menuItems.length, open]);

  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
  }, [open, value]);

  React.useEffect(() => {
    if (!open) return;
    setActiveIndex((prev) => Math.min(prev, Math.max(menuItems.length - 1, 0)));
  }, [menuItems.length, open]);

  React.useEffect(() => {
    if (!open) return;
    const activeItem = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    activeItem?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const commitValue = React.useCallback(
    (nextValue: string) => {
      onChange(nextValue);
      setOpen(false);
      queueMicrotask(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(nextValue.length, nextValue.length);
      });
    },
    [onChange]
  );

  const clearValue = React.useCallback(() => {
    onChange("");
    setOpen(false);
    skipOpenOnFocusRef.current = true;
    queueMicrotask(() => inputRef.current?.focus());
  }, [onChange]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex((prev) => Math.min(prev + 1, Math.max(menuItems.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (event.key === "Enter" && open && menuItems[activeIndex]) {
      event.preventDefault();
      commitValue(menuItems[activeIndex].value);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={["relative min-w-0", className].filter(Boolean).join(" ")}>
      <div
        className={[
          "flex items-center rounded-xl border border-[var(--border)] bg-[var(--input-bg)] transition",
          "shadow-[var(--shadow-2)] hover:bg-[var(--panel-2)] focus-within:border-blue-500/30 focus-within:ring-2 focus-within:ring-blue-500/20",
          compact ? "h-10 px-2" : "h-11 px-3",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (skipOpenOnFocusRef.current) {
              skipOpenOnFocusRef.current = false;
              return;
            }
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          placeholder={placeholder}
          className={[
            "w-full min-w-0 bg-transparent outline-none placeholder:text-[var(--app-muted)]",
            compact ? "text-[12px] text-[var(--app-fg)]" : "text-[13px] text-[var(--app-fg)]",
          ].join(" ")}
        />
        {value.trim() ? (
          <UiProps ids={{"aria-label":["admin.m5eb6612ff02b"],"title":["admin.m5eb6612ff02b"]}}><button
            type="button"
            onClick={clearValue}
            className={[
              "ml-2 inline-flex shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]",
              compact ? "h-7 w-7" : "h-8 w-8",
            ].join(" ")}
            aria-label="admin.m5eb6612ff02b"
            title="admin.m5eb6612ff02b"
          >
            <X className="h-3.5 w-3.5" />
          </button></UiProps>
        ) : null}
        <UiProps ids={{"aria-label":["admin.mcdf7ff2b4c1e","admin.m737ee0287dea"]}}><button
          type="button"
          onClick={() => {
            setOpen((prev) => {
              const next = !prev;
              if (next) {
                queueMicrotask(() => inputRef.current?.focus());
              } else {
                skipOpenOnFocusRef.current = true;
                queueMicrotask(() => {
                  inputRef.current?.blur();
                });
              }
              return next;
            });
          }}
          className={[
            "ml-2 inline-flex shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]",
            compact ? "h-7 w-7" : "h-8 w-8",
          ].join(" ")}
          aria-label={open ? "admin.mcdf7ff2b4c1e" : "admin.m737ee0287dea"}
        >
          <ChevronDown className={["h-4 w-4 transition-transform", open ? "rotate-180" : ""].join(" ")} />
        </button></UiProps>
      </div>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              style={menuStyle}
              className="select-dropdown-panel app-dropdown-panel overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)]"
            >
              <div className="max-h-[inherit] overflow-y-auto overscroll-contain p-2">
                {menuItems.length ? (
                  menuItems.map((item, index) => {
                    const isActive = index === activeIndex;
                    const isSelected = item.value === value.trim() || item.value === value;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        data-index={index}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => commitValue(item.value)}
                        className={[
                          "flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors outline-none",
                          isSelected
                            ? "border-blue-500/25 bg-blue-500/10 text-[var(--app-fg)]"
                            : isActive
                              ? "border-[var(--border-2)] bg-[var(--panel-3)] text-[var(--app-fg)]"
                              : "border-transparent text-[var(--app-muted)] hover:border-[var(--border)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]",
                        ].join(" ")}
                      >
                        <span
                          className={[
                            "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                            isSelected || item.isCreate
                              ? "border-blue-500/20 bg-blue-500/10 text-blue-500"
                              : "border-[var(--border)] bg-[var(--input-bg)] text-transparent",
                          ].join(" ")}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium">{uiLabel(item.label)}</span>
                          <span className="mt-0.5 block truncate text-[10px] text-[var(--app-muted)]">{item.helper}</span>
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-xl bg-[var(--panel-2)] px-3 py-3 text-[12px] text-[var(--app-muted)]"><UiText id="admin.m9721d8473d0b" /></div>
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

export default function AdminMaterialsPage() {
  const { label: tLabel } = useUiLocale();
  const { error: uiError } = useUiLocale();
  const uploadInputRef = React.useRef<HTMLInputElement | null>(null);
  const [items, setItems] = React.useState<AdminSharedMediaItem[]>([]);
  const [groups, setGroups] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = React.useState(false);
  const [uploadBusy, setUploadBusy] = React.useState(false);
  const [uploadMessage, setUploadMessage] = React.useState<string | null>(null);
  const [uploadProgressItems, setUploadProgressItems] = React.useState<UploadProgressItem[]>([]);
  const [pendingUploadItems, setPendingUploadItems] = React.useState<PendingUploadItem[]>([]);
  const [uploadDragActive, setUploadDragActive] = React.useState(false);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [groupDraft, setGroupDraft] = React.useState("");
  const [groupFilter, setGroupFilter] = React.useState<string>("all");
  const [pagination, setPagination] = React.useState(DEFAULT_PAGINATION);
  const [error, setError] = React.useState<string | null>(null);
  const [deleteSelectedOpen, setDeleteSelectedOpen] = React.useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = React.useState(false);
  const [selectionMode, setSelectionMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<number[]>([]);
  const [zoomOpen, setZoomOpen] = React.useState(false);
  const [zoomSrc, setZoomSrc] = React.useState<string | null>(null);
  const [zoomKind, setZoomKind] = React.useState<"image" | "video">("image");
  const selectedIdsRef = React.useRef<number[]>([]);
  const pendingUploadItemsRef = React.useRef<PendingUploadItem[]>([]);
  const lastSelectedIdRef = React.useRef<number | null>(null);
  const dragSelectingRef = React.useRef(false);
  const dragSelectionModeRef = React.useRef<"select" | "deselect" | null>(null);
  const clearTimerRef = React.useRef<number | null>(null);
  const messageTimerRef = React.useRef<number | null>(null);
  const gridRef = React.useRef<HTMLDivElement | null>(null);
  const cardRefs = React.useRef<Record<number, HTMLElement | null>>({});
  const boxSelectingRef = React.useRef(false);
  const boxSelectionBaseRef = React.useRef<number[]>([]);
  const boxSelectionOriginRef = React.useRef<{ x: number; y: number } | null>(null);
  const [selectionBox, setSelectionBox] = React.useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const fetchItems = React.useCallback(async (page = 1, mode: "replace" | "append" = "replace") => {
    if (mode === "replace") setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const url = new URL("/api/admin/media-library", window.location.origin);
      url.searchParams.set("page", String(page));
      url.searchParams.set("pageSize", String(ADMIN_MEDIA_PAGE_SIZE));
      url.searchParams.set("kind", "all");
      if (groupFilter !== "all") url.searchParams.set("groupName", groupFilter);
      const res = await fetch(url.toString(), { cache: "no-store" }).catch(() => null);
      const json = (await res?.json().catch(() => null)) as AdminSharedMediaResponse | null;
      if (!res || !res.ok) {
        if (mode === "replace") {
          setItems([]);
          setPagination(DEFAULT_PAGINATION);
        }
        setError(json?.error || "加载产品素材失败");
        return;
      }
      let next = Array.isArray(json?.items) ? json!.items : [];
      next = [...next].sort((a, b) => {
        const ta = new Date(a.createdAt).getTime();
        const tb = new Date(b.createdAt).getTime();
        return tb - ta;
      });
      setItems((current) => {
        if (mode === "replace") return next;
        const merged = new Map(current.map((item) => [item.id, item]));
        for (const item of next) merged.set(item.id, item);
        return Array.from(merged.values()).sort((a, b) => {
          const ta = new Date(a.createdAt).getTime();
          const tb = new Date(b.createdAt).getTime();
          return tb - ta;
        });
      });
      setGroups(Array.isArray(json?.groups) ? json!.groups.filter(Boolean) : []);
      setPagination({
        page: Math.max(1, Number(json?.pagination?.page) || 1),
        pageSize: Math.max(1, Number(json?.pagination?.pageSize) || next.length || 1),
        total: Math.max(0, Number(json?.pagination?.total) || 0),
        totalPages: Math.max(1, Number(json?.pagination?.totalPages) || 1),
        hasMore: Boolean(json?.pagination?.hasMore),
      });
    } finally {
      if (mode === "replace") setLoading(false);
      else setLoadingMore(false);
      setHasLoadedOnce(true);
    }
  }, [groupFilter]);

  React.useEffect(() => {
    void fetchItems(1, "replace");
  }, [fetchItems]);

  React.useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => items.some((item) => item.id === id)));
  }, [items]);

  React.useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (selectedIdsRef.current.length === 0) return;
      setSelectedIds([]);
      dragSelectingRef.current = false;
      dragSelectionModeRef.current = null;
      boxSelectingRef.current = false;
      boxSelectionOriginRef.current = null;
      boxSelectionBaseRef.current = [];
      setSelectionBox(null);
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const openPreview = React.useCallback((item: AdminSharedMediaItem) => {
    const raw = pickRawUrl(item);
    if (!raw) return;
    setZoomSrc(raw);
                    setZoomKind(item.kind === "video" || isVideoMediaUrl(raw) ? "video" : "image");
    setZoomOpen(true);
  }, []);

  const clearSelection = React.useCallback(() => {
    setSelectedIds([]);
    lastSelectedIdRef.current = null;
    dragSelectingRef.current = false;
    dragSelectionModeRef.current = null;
    boxSelectingRef.current = false;
    boxSelectionOriginRef.current = null;
    boxSelectionBaseRef.current = [];
    setSelectionBox(null);
  }, []);

  const enterSelectionMode = React.useCallback(() => {
    clearSelection();
    setSelectionMode(true);
  }, [clearSelection]);

  const exitSelectionMode = React.useCallback(() => {
    clearSelection();
    setSelectionMode(false);
  }, [clearSelection]);

  const runAdminDelete = React.useCallback(async (payload: AdminDeletePayload, fallbackMessage: string) => {
    setError(null);
    const res = await fetch("/api/admin/media-library/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { error?: string; count?: number } | null;
    if (!res || !res.ok) {
      setError(json?.error || fallbackMessage);
      return false;
    }
    clearSelection();
    setSelectionMode(false);
    setUploadMessage(`已删除 ${Math.max(0, Number(json?.count) || 0)} 个产品素材`);
    await fetchItems();
    return true;
  }, [clearSelection, fetchItems]);

  const removeSelectedItems = React.useCallback(async () => {
    if (!selectedIds.length) return;
    await runAdminDelete({ mode: "ids", ids: selectedIds }, "删除选中素材失败");
  }, [runAdminDelete, selectedIds]);

  const toggleSelected = React.useCallback((id: number) => {
    lastSelectedIdRef.current = id;
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((itemId) => itemId !== id) : [...prev, id]));
  }, []);

  const selectRangeTo = React.useCallback((id: number) => {
    const anchorId = lastSelectedIdRef.current;
    const orderedIds = items.map((item) => item.id);
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
    startDragSelection(id);
  }, [selectRangeTo, startDragSelection, toggleSelected]);

  const handleGridPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    boxSelectingRef.current = true;
    boxSelectionOriginRef.current = { x, y };
    boxSelectionBaseRef.current = event.ctrlKey || event.metaKey ? selectedIdsRef.current : [];
    setSelectionBox({ left: x, top: y, width: 0, height: 0 });
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
    const currentIds = items.map((item) => item.id);
    setSelectedIds((prev) => {
      const allSelected = currentIds.length > 0 && currentIds.every((id) => prev.includes(id));
      return allSelected ? prev.filter((id) => !currentIds.includes(id)) : Array.from(new Set([...prev, ...currentIds]));
    });
  }, [items]);

  const toggleSelectedGroup = React.useCallback((groupIds: number[]) => {
    if (!groupIds.length) return;
    setSelectedIds((prev) => {
      const allSelected = groupIds.every((id) => prev.includes(id));
      if (allSelected) return prev.filter((id) => !groupIds.includes(id));
      return Array.from(new Set([...prev, ...groupIds]));
    });
    lastSelectedIdRef.current = groupIds[groupIds.length - 1] ?? null;
  }, []);

  const getNormalizedUploadGroup = React.useCallback(() => {
    return groupDraft.trim() || (groupFilter !== "all" && groupFilter !== MEDIA_LIBRARY_UNGROUPED ? groupFilter : "");
  }, [groupDraft, groupFilter]);

  const revokePendingUploadItems = React.useCallback((itemsToRevoke: PendingUploadItem[]) => {
    for (const item of itemsToRevoke) {
      URL.revokeObjectURL(item.previewUrl);
    }
  }, []);

  const stageUploadFiles = React.useCallback((files: FileList | File[] | null) => {
    const list = files ? Array.from(files).filter((file) => /^(image|video|audio)\//.test(file.type)) : [];
    if (!list.length) {
      setError("请选择图片、视频或音频素材");
      return;
    }
    setError(null);
    setUploadMessage(null);
    const stamp = Date.now();
    const nextItems = list.map((file, index) => ({
      id: `${stamp}-${index}-${file.name}`,
      file,
      previewUrl: URL.createObjectURL(file),
      kind: getPendingUploadKind(file),
    }));
    setPendingUploadItems((prev) => [...prev, ...nextItems]);
  }, []);

  const removePendingUploadItem = React.useCallback((id: string) => {
    setPendingUploadItems((prev) => {
      const removed = prev.filter((item) => item.id === id);
      revokePendingUploadItems(removed);
      return prev.filter((item) => item.id !== id);
    });
  }, [revokePendingUploadItems]);

  const clearPendingUploadItems = React.useCallback(() => {
    setPendingUploadItems((prev) => {
      revokePendingUploadItems(prev);
      return [];
    });
  }, [revokePendingUploadItems]);

  React.useEffect(() => {
    pendingUploadItemsRef.current = pendingUploadItems;
  }, [pendingUploadItems]);

  React.useEffect(() => {
    return () => {
      revokePendingUploadItems(pendingUploadItemsRef.current);
    };
  }, [revokePendingUploadItems]);

  const isUploadFileDrag = (event: React.DragEvent) => {
    return Array.from(event.dataTransfer?.types || []).includes("Files");
  };

  const updateUploadProgressItem = React.useCallback((id: string, patch: Partial<UploadProgressItem>) => {
    setUploadProgressItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }, []);

  const uploadSingleSharedMaterial = React.useCallback(
    (file: File, normalizedGroup: string, id: string) =>
      new Promise<void>((resolve, reject) => {
        const form = new FormData();
        form.set("file", file);
        if (normalizedGroup) form.set("groupName", normalizedGroup);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/admin/media-library/upload");
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
          const json = xhr.response as { error?: string } | null;
          if (xhr.status >= 200 && xhr.status < 300) {
            updateUploadProgressItem(id, {
              status: "success",
              loadedBytes: file.size,
              totalBytes: file.size,
              percent: 100,
              message: "上传完成",
            });
            resolve();
            return;
          }
          const errorMessage = json?.error || "上传产品素材失败";
          updateUploadProgressItem(id, {
            status: "error",
            message: errorMessage,
          });
          reject(new Error(errorMessage));
        };

        xhr.onerror = () => {
          const errorMessage = "上传产品素材失败";
          updateUploadProgressItem(id, {
            status: "error",
            message: errorMessage,
          });
          reject(new Error(errorMessage));
        };

        updateUploadProgressItem(id, {
          status: "uploading",
          loadedBytes: 0,
          totalBytes: file.size,
          percent: 0,
          message: "上传中",
        });
        xhr.send(form);
      }),
    [updateUploadProgressItem]
  );

  const clearUploadProgress = React.useCallback(() => {
    if (clearTimerRef.current) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    setUploadProgressItems([]);
  }, []);

  const uploadSharedMaterials = React.useCallback(async (files: FileList | File[] | null): Promise<File[]> => {
    const list = files ? Array.from(files) : [];
    if (!list.length) return [];
    setUploadBusy(true);
    setUploadMessage(null);
    setError(null);
    let failedFiles: File[] = [];
    try {
      const normalizedGroup = getNormalizedUploadGroup();
      const nextProgressItems: UploadProgressItem[] = list.map((file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        fileName: file.name,
        file,
        loadedBytes: 0,
        totalBytes: file.size,
        percent: 0,
        status: "waiting",
      }));
      setUploadProgressItems(nextProgressItems);

      let successCount = 0;
      const failedMessages: string[] = [];
      for (let index = 0; index < nextProgressItems.length; index += 1) {
        const item = nextProgressItems[index];
        const file = list[index];
        if (!file) continue;
        try {
          await uploadSingleSharedMaterial(file, normalizedGroup, item.id);
          successCount += 1;
        } catch (uploadError: any) {
          failedFiles.push(file);
          failedMessages.push(`${file.name}: ${uploadError?.message || "上传失败"}`);
        }
      }

      if (successCount === list.length) {
        setUploadMessage(`已上传 ${successCount} 个产品素材`);
      } else if (successCount > 0) {
        setUploadMessage(`已上传 ${successCount}/${list.length} 个产品素材，部分失败`);
        setError(failedMessages.join("；"));
      } else {
        throw new Error(failedMessages[0] || "上传产品素材失败");
      }

      await fetchItems();
      return failedFiles;
    } catch (error: any) {
      setUploadMessage(error?.message || "上传产品素材失败");
      return failedFiles.length ? failedFiles : list;
    } finally {
      setUploadBusy(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }, [fetchItems, getNormalizedUploadGroup, uploadSingleSharedMaterial]);

  const confirmPendingUpload = React.useCallback(async () => {
    const stagedItems = pendingUploadItemsRef.current;
    if (!stagedItems.length || uploadBusy) return;
    const failedFiles = await uploadSharedMaterials(stagedItems.map((item) => item.file));
    if (!failedFiles.length) setUploadOpen(false);
    setPendingUploadItems((prev) => {
      const failedSet = new Set(failedFiles);
      const uploadedItems = prev.filter((item) => !failedSet.has(item.file));
      revokePendingUploadItems(uploadedItems);
      return prev.filter((item) => failedSet.has(item.file));
    });
  }, [revokePendingUploadItems, uploadBusy, uploadSharedMaterials]);

  React.useEffect(() => {
    if (clearTimerRef.current) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    if (!uploadProgressItems.length) return;
    const allFinished = uploadProgressItems.every((item) => item.status === "success" || item.status === "error");
    if (!allFinished) return;
    clearTimerRef.current = window.setTimeout(() => {
      clearUploadProgress();
    }, 6000);
    return () => {
      if (clearTimerRef.current) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
    };
  }, [clearUploadProgress, uploadProgressItems]);

  React.useEffect(() => {
    if (messageTimerRef.current) {
      window.clearTimeout(messageTimerRef.current);
      messageTimerRef.current = null;
    }
    if (!uploadMessage) return;
    messageTimerRef.current = window.setTimeout(() => {
      setUploadMessage(null);
      messageTimerRef.current = null;
    }, 3000);
    return () => {
      if (messageTimerRef.current) {
        window.clearTimeout(messageTimerRef.current);
        messageTimerRef.current = null;
      }
    };
  }, [uploadMessage]);

  const uploadSummary = React.useMemo(() => {
    const totalCount = uploadProgressItems.length;
    const successCount = uploadProgressItems.filter((item) => item.status === "success").length;
    const errorCount = uploadProgressItems.filter((item) => item.status === "error").length;
    const activeCount = uploadProgressItems.filter((item) => item.status === "uploading" || item.status === "waiting").length;
    const totalBytes = uploadProgressItems.reduce((sum, item) => sum + item.totalBytes, 0);
    const loadedBytes = uploadProgressItems.reduce((sum, item) => {
      if (item.status === "success" || item.status === "error") return sum + item.totalBytes;
      return sum + item.loadedBytes;
    }, 0);
    const percent = totalBytes > 0 ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100)) : 0;
    return {
      totalCount,
      successCount,
      errorCount,
      activeCount,
      loadedBytes,
      totalBytes,
      percent,
      completedCount: successCount + errorCount,
    };
  }, [uploadProgressItems]);

  const groupedItems = React.useMemo(() => {
    const map = new Map<string, AdminSharedMediaItem[]>();
    for (const item of items) {
      const key = item.groupName?.trim() || "未分类";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    const orderedEntries: Array<[string, AdminSharedMediaItem[]]> = [];
    for (const group of groups) {
      const key = group.trim();
      const groupItems = map.get(key);
      if (key && groupItems) {
        orderedEntries.push([key, groupItems]);
        map.delete(key);
      }
    }
    for (const [key, groupItems] of Array.from(map.entries())) {
      if (key !== "未分类") orderedEntries.push([key, groupItems]);
    }
    const ungroupedItems = map.get("未分类");
    if (ungroupedItems) orderedEntries.push(["未分类", ungroupedItems]);
    return orderedEntries;
  }, [groups, items]);
  const eagerItemIds = React.useMemo(() => new Set(items.slice(0, 12).map((item) => item.id)), [items]);
  const hasActiveFilters = groupFilter !== "all";
  const currentPageAllSelected = items.length > 0 && items.every((item) => selectedIds.includes(item.id));

  return (
    <AtomicPageReveal ready={hasLoadedOnce}>
    <main className="flex-1 min-h-0 overflow-auto smooth-scroll bg-[var(--app-bg)]">
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        multiple
        className="hidden"
        onChange={(e) => {
          stageUploadFiles(e.target.files);
          setUploadOpen(true);
          e.currentTarget.value = "";
        }}
      />

      <div className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--app-bg)]/95 px-5 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <HardDrive className="h-4 w-4 shrink-0 text-blue-500" />
                <h1 className="text-[15px] font-semibold tracking-tight"><UiText id="admin.m235ee467d774" /></h1>
                <span className="hidden text-[12px] text-[var(--app-muted)] sm:inline"><UiText id="admin.m6e4e508c052e" /></span>
              </div>
              <p className="hidden text-[11px] leading-5 text-[var(--app-muted)] sm:block"><UiText id="admin.m8db97fba9d5f" /></p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <UiProps ids={{"label":["admin.me8dc871a7fde"]}}><StatChip label="admin.me8dc871a7fde" value={pagination.total} /></UiProps>
            <UiProps ids={{"label":["admin.m7ecf1cde6486"]}}><StatChip label="admin.m7ecf1cde6486" value={selectedIds.length} accent /></UiProps>
            <UiProps ids={{"label":["admin.m515559957fd3"]}}><StatChip label="admin.m515559957fd3" value={groups.length} /></UiProps>
            <button
              type="button"
              onClick={() => {
                if (selectionMode) exitSelectionMode();
                else enterSelectionMode();
              }}
              disabled={!items.length && !selectionMode}
              className={[
                "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-medium transition disabled:pointer-events-none disabled:opacity-45",
                selectionMode
                  ? "border-blue-500/30 bg-blue-500/10 text-blue-500"
                  : "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] hover:bg-[var(--panel-2)]",
              ].join(" ")}
            >
              {selectionMode ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
              {selectionMode ? <UiText id="admin.m4fbb4458eb2a" /> : <UiText id="admin.m461e085d5ca2" />}
            </button>
            {selectionMode ? (
              <>
                <button
                  type="button"
                  disabled={!items.length}
                  onClick={toggleSelectAllCurrentPage}
                  className="inline-flex h-8 items-center rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-3 text-[12px] font-medium text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:pointer-events-none disabled:opacity-45"
                >
                  {currentPageAllSelected ? <UiText id="admin.m530a2306a03a" /> : <UiText id="admin.mbd082d9acb40" />}
                </button>
                <button
                  type="button"
                  disabled={!selectedIds.length}
                  onClick={() => setDeleteSelectedOpen(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 text-[12px] font-medium text-rose-600 transition hover:bg-rose-500/15 disabled:pointer-events-none disabled:opacity-45"
                >
                  <Trash2 className="h-3.5 w-3.5" /><UiText id="admin.m807c2df791b8" />{selectedIds.length}
                </button>
              </>
            ) : null}
            <button
              type="button"
              disabled={!pagination.total}
              onClick={() => setDeleteAllOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-rose-600 px-3 text-[12px] font-medium text-white shadow-sm transition hover:bg-rose-500 disabled:pointer-events-none disabled:opacity-45"
            >
              <Trash2 className="h-3.5 w-3.5" /><UiText id="admin.m5e7a0a48bf35" /></button>
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-500 px-3 text-[12px] font-medium text-white shadow-sm transition hover:bg-blue-600"
            >
              <UploadCloud className="h-3.5 w-3.5" /><UiText id="admin.m493ee58f81f5" /></button>
            <UiProps ids={{"title":["admin.maee887434131"]}}><button
              type="button"
              onClick={() => void fetchItems()}
              title="admin.maee887434131"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)]"
            >
              <RefreshCw className={["h-3.5 w-3.5", loading ? "animate-spin" : ""].join(" ")} />
            </button></UiProps>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <UiProps ids={{"label":["admin.m5c55a67935af"]}}><CategoryTabBtn
              active={groupFilter === "all"}
              label="admin.m5c55a67935af"
              onClick={() => {
                setGroupFilter("all");
              }}
            /></UiProps>
            {groups.map((group) => (
              <CategoryTabBtn
                key={group}
                active={groupFilter === group}
                label={group}
                onClick={() => {
                  setGroupFilter(group);
                  setGroupDraft(group);
                }}
              />
            ))}
            <UiProps ids={{"label":["admin.m54b89f901274"]}}><CategoryTabBtn
              active={groupFilter === MEDIA_LIBRARY_UNGROUPED}
              label="admin.m54b89f901274"
              onClick={() => {
                setGroupFilter(MEDIA_LIBRARY_UNGROUPED);
              }}
            /></UiProps>
          </div>
        </div>
      </div>

      <div className="w-full px-5 py-5">
        {error ? (
          <div className="mb-4 rounded-lg border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-[13px] text-rose-500">
            {uiError(error)}
          </div>
        ) : null}
        {uploadMessage ? (
          <div className={`mb-4 rounded-lg border px-4 py-3 text-[13px] ${uploadMessage.includes("失败") ? "border-rose-500/25 bg-rose-500/10 text-rose-500" : "border-blue-500/25 bg-blue-500/10 text-blue-500"}`}>
            {uploadMessage}
          </div>
        ) : null}
        {loading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-bg)]">
                <div className="aspect-[3/4] animate-pulse bg-[var(--panel-2)]" />
              </div>
            ))}
          </div>
        ) : items.length ? (
          <div ref={gridRef} className="relative space-y-5" onPointerDown={selectionMode ? handleGridPointerDown : undefined}>
            {selectionBox ? (
              <div
                className="pointer-events-none absolute z-30 rounded-xl border border-blue-500/60 bg-blue-500/10"
                style={{
                  left: selectionBox.left,
                  top: selectionBox.top,
                  width: selectionBox.width,
                  height: selectionBox.height,
                }}
              />
            ) : null}
            {groupedItems.map(([groupName, groupItems]) => {
              const groupIds = groupItems.map((item) => item.id);
              const groupAllSelected = groupIds.length > 0 && groupIds.every((id) => selectedIds.includes(id));
              const groupSomeSelected = groupIds.some((id) => selectedIds.includes(id));
              return (
                <section key={groupName} className="space-y-3">
                  <div className="flex items-center gap-2.5">
                    {selectionMode ? (
                      <button
                        type="button"
                        onClick={() => toggleSelectedGroup(groupIds)}
                        className={[
                          "inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-left transition",
                          groupAllSelected
                            ? "border-blue-500/35 bg-blue-500/10 text-blue-500"
                            : groupSomeSelected
                              ? "border-blue-500/25 bg-blue-500/5 text-[var(--app-fg)]"
                              : "border-transparent text-[var(--app-fg)] hover:border-[var(--border)] hover:bg-[var(--panel-2)]",
                        ].join(" ")}
                        aria-label={groupAllSelected ? `取消选择${groupName}分组` : `选择${groupName}分组`}
                      >
                        {groupAllSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                        <span className="text-[13px] font-semibold">{groupName}</span>
                        <span className="text-[11px] text-[var(--app-muted)]">{groupItems.length}<UiText id="admin.me9e0fdc242b4" /></span>
                      </button>
                    ) : (
                      <>
                        <span className="text-[13px] font-semibold text-[var(--app-fg)]">{groupName}</span>
                        <span className="text-[11px] text-[var(--app-muted)]">{groupItems.length}<UiText id="admin.me9e0fdc242b4" /></span>
                      </>
                    )}
                    <span className="h-px flex-1 bg-[var(--border)]" />
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
                    {groupItems.map((item) => {
                      const previewCandidates = pickPreviewCandidates(item);
                      const previewSrc = previewCandidates[0] || "";
                      const rawSrc = pickRawUrl(item);
                      const proxySrc = pickProxyUrl(item);
                      const isAudio = item.kind === "audio";
                      const isVideo = !isAudio && (item.kind === "video" || isVideoMediaUrl(rawSrc));
                      const videoPosterOnly = isVideo && previewSrc && !isVideoMediaUrl(previewSrc);
                      const selected = selectedIds.includes(item.id);
                      return (
                        <article
                          key={item.id}
                          ref={(node) => {
                            cardRefs.current[item.id] = node;
                          }}
                          className={[
                            "group flex h-full flex-col overflow-hidden rounded-xl border bg-[var(--panel-2)] transition hover:shadow-md",
                            selected ? "border-blue-500 ring-2 ring-blue-500/35" : "border-[var(--border)]",
                          ].join(" ")}
                          onPointerDown={selectionMode ? (event) => handleCardSelectPointerDown(event, item.id) : undefined}
                          onPointerEnter={() => {
                            if (!selectionMode) return;
                            if (!dragSelectingRef.current || !dragSelectionModeRef.current) return;
                            applyDraggedSelection(item.id, dragSelectionModeRef.current);
                          }}
                        >
                          <div className="relative aspect-[3/4] shrink-0 bg-[var(--input-bg)]">
                            <button
                              type="button"
                              data-no-select="true"
                              onClick={selectionMode ? () => toggleSelected(item.id) : () => openPreview(item)}
                              className="block h-full w-full overflow-hidden text-left"
                            >
                              {isAudio ? (
                                <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-3">
                                  <div className="inline-flex items-center gap-1 rounded-md bg-black/55 px-2 py-1 text-[10px] text-white">
                                    <Music2 className="h-3.5 w-3.5" /><UiText id="admin.m9aff128e00ac" /></div>
                                  <audio controls className="w-full" src={proxySrc || rawSrc || item.fileUrl}><UiText id="admin.m785699793650" /></audio>
                                </div>
                              ) : previewSrc ? (
                                isVideo && !videoPosterOnly ? (
                                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-black/35 text-white/70">
                                    <Video className="h-8 w-8" />
                                    <span className="text-[11px]"><UiText id="admin.m05608cc41def" /></span>
                                  </div>
                                ) : (
                                  <div className="relative h-full w-full">
                                    <ResilientImage
                                      candidates={previewCandidates}
                                      alt={item.title}
                                      className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                                      draggable={false}
                                      loading={eagerItemIds.has(item.id) ? "eager" : "lazy"}
                                      decoding="async"
                                      fetchPriority={eagerItemIds.has(item.id) ? "high" : "auto"}
                                    />
                                    {isVideo ? (
                                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white shadow-lg">
                                          <Video className="h-5 w-5" />
                                        </span>
                                      </div>
                                    ) : null}
                                  </div>
                                )
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-[12px] text-[var(--app-muted)]"><UiText id="admin.mb47d3f110db7" /></div>
                              )}
                            </button>
                            {selectionMode ? (
                              <UiProps ids={{"aria-label":["admin.m31762df00df4","admin.m1ec8b306f4c8"]}}><button
                                type="button"
                                data-no-select="true"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleSelected(item.id);
                                }}
                                className={[
                                  "absolute right-2 top-2 z-20 inline-flex h-8 w-8 items-center justify-center rounded-lg border backdrop-blur-sm transition",
                                  selected
                                    ? "border-blue-500 bg-blue-500 text-white shadow-sm"
                                    : "border-white/50 bg-black/30 text-white hover:bg-black/45",
                                ].join(" ")}
                                aria-label={selected ? "admin.m31762df00df4" : "admin.m1ec8b306f4c8"}
                              >
                                {selected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                              </button></UiProps>
                            ) : null}
                            <div className="absolute left-2 top-2 flex items-center gap-1">
                              <ProductBadge>
                                {isAudio ? <Music2 className="mr-1 h-3 w-3" /> : isVideo ? <Video className="mr-1 h-3 w-3" /> : <ImageIcon className="mr-1 h-3 w-3" />}
                                {isAudio ? <UiText id="admin.m296c632ec857" /> : isVideo ? <UiText id="admin.mc20f7618d330" /> : <UiText id="admin.md24c10d37db0" />}
                              </ProductBadge>
                            </div>
                            {item.groupName?.trim() ? (
                              <div className={["absolute right-2", selectionMode ? "top-11" : "top-2"].join(" ")}>
                                <ProductBadge>{item.groupName.trim()}</ProductBadge>
                              </div>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
            {pagination.hasMore ? (
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void fetchItems(pagination.page + 1, "append")}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-4 text-[12px] font-medium text-[var(--app-fg)] transition hover:bg-[var(--panel-2)] disabled:pointer-events-none disabled:opacity-50"
                >
                  <RefreshCw className={["h-3.5 w-3.5", loadingMore ? "animate-spin" : ""].join(" ")} />
                  {loadingMore ? <UiText id="admin.m9dc0825fba54" /> : <UiText id="admin.maf90a08fec8e" />}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

      </div>

      {uploadOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          onMouseDown={() => {
            if (!uploadBusy) setUploadOpen(false);
          }}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-black/[0.08] bg-[#fbfbfd] shadow-[0_30px_90px_-30px_rgba(15,15,25,0.45)] dark:border-white/[0.08] dark:bg-[#1c1c1e]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
              <div className="flex items-center gap-2">
                <UploadCloud className="h-[18px] w-[18px] text-blue-500" />
                <span className="text-[15px] font-semibold"><UiText id="admin.m493ee58f81f5" /></span>
              </div>
              <UiProps ids={{"aria-label":["admin.meadcacc3a8da"]}}><button
                type="button"
                disabled={uploadBusy}
                onClick={() => setUploadOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] disabled:opacity-40"
                aria-label="admin.meadcacc3a8da"
              >
                <X className="h-4 w-4" />
              </button></UiProps>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wide text-[var(--app-muted)]"><UiText id="admin.m93ebfedea8e0" /></label>
                <div className="mt-1.5">
                  <UiProps ids={{"placeholder":["admin.ma940d6519754"]}}><GroupCombobox
                    value={groupDraft}
                    onChange={setGroupDraft}
                    options={groups}
                    placeholder="admin.ma940d6519754"
                    ariaLabel={tLabel("上传分组")}
                    emptyLabel="不指定分组"
                    emptyHelper="上传时不自动归类"
                  /></UiProps>
                </div>
              </div>

              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (!uploadBusy) uploadInputRef.current?.click();
                }}
                onKeyDown={(event) => {
                  if (uploadBusy) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    uploadInputRef.current?.click();
                  }
                }}
                onDragEnter={(event) => {
                  if (!isUploadFileDrag(event)) return;
                  event.preventDefault();
                  setUploadDragActive(true);
                }}
                onDragOver={(event) => {
                  if (!isUploadFileDrag(event)) return;
                  event.preventDefault();
                  setUploadDragActive(true);
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDragLeave={(event) => {
                  if (!isUploadFileDrag(event)) return;
                  event.preventDefault();
                  setUploadDragActive(false);
                }}
                onDrop={(event) => {
                  if (!isUploadFileDrag(event)) return;
                  event.preventDefault();
                  setUploadDragActive(false);
                  stageUploadFiles(event.dataTransfer.files);
                }}
                className={[
                  "group mt-5 flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3 transition",
                  uploadDragActive
                    ? "border-blue-500/60 bg-blue-500/10"
                    : "border-[var(--border)] bg-[var(--app-bg)] hover:border-blue-500/40 hover:bg-blue-500/5",
                  uploadBusy ? "pointer-events-none opacity-60" : "",
                ].join(" ")}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-2)] transition group-hover:border-blue-500/30 group-hover:bg-blue-500/10">
                  <UploadCloud className="h-[18px] w-[18px] text-[var(--app-muted)] transition group-hover:text-blue-500" />
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">
                    {pendingUploadItems.length
                      ? <UiText id="admin.mac88babab779" values={{v0: String(pendingUploadItems.length)}} />
                      : uploadDragActive
                        ? <UiText id="admin.mc57e1ab5dc60" />
                        : <UiText id="admin.m98a19a06aa64" />}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--app-muted)]"><UiText id="admin.m5fba1c387d28" /></div>
                </div>
              </div>

              {pendingUploadItems.length ? (
                <div className="mt-4 max-h-72 space-y-1 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-2">
                  <div className="flex items-center justify-between px-1 pb-1 text-[11px] text-[var(--app-muted)]">
                    <span><UiText id="admin.mb34bae3dcfcb" />{pendingUploadItems.length}<UiText id="admin.m7aaf96ad52e0" /></span>
                    <button
                      type="button"
                      disabled={uploadBusy}
                      onClick={clearPendingUploadItems}
                      className="underline-offset-2 transition hover:text-rose-500 hover:underline disabled:opacity-50"
                    ><UiText id="admin.mb730d8da2058" /></button>
                  </div>
                  {pendingUploadItems.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 rounded-md px-1 py-1 hover:bg-[var(--panel-2)]">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--panel-2)]">
                        {item.kind === "image" ? (
                          <ResilientImage candidates={[item.previewUrl]} alt={item.file.name} className="h-full w-full object-cover" />
                        ) : item.kind === "video" ? (
                          <video src={item.previewUrl} className="h-full w-full object-cover" muted playsInline />
                        ) : item.kind === "audio" ? (
                          <Music2 className="h-5 w-5 text-[var(--app-muted)]" />
                        ) : (
                          <UploadCloud className="h-5 w-5 text-[var(--app-muted)]" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium text-[var(--app-fg)]" title={item.file.name}>
                          {item.file.name}
                        </div>
                        <div className="mt-0.5 text-[11px] text-[var(--app-muted)]">{formatFileSize(item.file.size)}</div>
                      </div>
                      <button
                        type="button"
                        disabled={uploadBusy}
                        onClick={() => removePendingUploadItem(item.id)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--app-muted)] transition hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)] disabled:opacity-50"
                        aria-label={tLabel(`移除 ${item.file.name}`)}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="space-y-3 border-t border-[var(--border)] px-6 py-4">
              {uploadProgressItems.length ? (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <span className="font-medium text-[var(--app-fg)]"><UiText id="admin.m5125e69392bc" />{uploadSummary.completedCount}/{uploadSummary.totalCount}
                    </span>
                    <span className="text-[var(--app-muted)]">
                      {uploadSummary.percent}<UiText id="admin.m0fef95b62f51" />{uploadSummary.successCount}<UiText id="admin.m3f52690b5a30" />{uploadSummary.errorCount}
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--border)]">
                    <div
                      className={[
                        "h-full rounded-full transition-all",
                        uploadSummary.errorCount > 0 && uploadSummary.activeCount === 0 ? "bg-rose-500" : "bg-blue-500",
                      ].join(" ")}
                      style={{ width: `${Math.max(uploadSummary.percent, uploadSummary.activeCount ? 4 : 0)}%` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between gap-2 text-[10px] text-[var(--app-muted)]">
                    <span>{formatFileSize(uploadSummary.loadedBytes)} / {formatFileSize(uploadSummary.totalBytes)}</span>
                    <span>{uploadSummary.activeCount ? <UiText id="admin.m4342d63e83c7" /> : <UiText id="admin.mba00b37ee336" />}</span>
                  </div>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[11px] text-[var(--app-muted)]">
                  {pendingUploadItems.length ? <UiText id="admin.m4f4b49368739" values={{v0: String(pendingUploadItems.length)}} /> : <UiText id="admin.mde583a9b303f" />}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={uploadBusy}
                    onClick={() => setUploadOpen(false)}
                    className="h-9 rounded-lg border border-[var(--border)] px-4 text-[13px] text-[var(--app-muted)] transition hover:bg-[var(--panel-2)] disabled:opacity-50"
                  ><UiText id="admin.m2cd0f3be8738" /></button>
                  <button
                    type="button"
                    disabled={!pendingUploadItems.length || uploadBusy}
                    onClick={() => void confirmPendingUpload()}
                    className="inline-flex h-9 min-w-[112px] items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 text-[13px] font-medium text-white transition hover:bg-blue-600 disabled:opacity-50"
                  >
                    <UploadCloud className="h-4 w-4" />
                    {uploadBusy ? <UiText id="admin.m593470c32d44" /> : <UiText id="admin.mfb30daa8cf9f" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <UiProps ids={{"title":["admin.m51128779677f"]}}><MediaLightbox
        open={zoomOpen}
        src={zoomSrc}
        kind={zoomKind}
        title="admin.m51128779677f"
        onClose={() => {
          setZoomOpen(false);
          setZoomSrc(null);
        }}
      /></UiProps>
      <UiProps ids={{"title":["admin.mdc14806f64e9"],"confirmText":["admin.m640bd9d7d912"],"cancelText":["admin.m2cd0f3be8738"]}}><ConfirmDialog
        open={deleteSelectedOpen}
        title="admin.mdc14806f64e9"
        description={selectedIds.length ? `当前已选 ${selectedIds.length} 张素材。确认后会同步删除本地存储中的对应文件，且不可恢复。` : ""}
        confirmText="admin.m640bd9d7d912"
        cancelText="admin.m2cd0f3be8738"
        danger
        onClose={() => setDeleteSelectedOpen(false)}
        onConfirm={removeSelectedItems}
      /></UiProps>
      <UiProps ids={{"title":["admin.m73456ed522ab"],"confirmText":["admin.m89edda06872b"],"cancelText":["admin.m2cd0f3be8738"]}}><ConfirmDialog
        open={deleteAllOpen}
        title="admin.m73456ed522ab"
        description={
          hasActiveFilters
            ? `将删除当前筛选条件下的 ${pagination.total} 个产品素材。确认后会同步删除本地存储中的对应文件，且不可恢复。`
            : `将删除全部 ${pagination.total} 个产品素材。确认后会同步删除本地存储中的对应文件，且不可恢复。`
        }
        confirmText="admin.m89edda06872b"
        cancelText="admin.m2cd0f3be8738"
        danger
        onClose={() => setDeleteAllOpen(false)}
        onConfirm={async () => {
          await runAdminDelete(
            { mode: "filtered", groupName: groupFilter, kind: "all", q: "" },
            "删除全部产品素材失败"
          );
          setDeleteAllOpen(false);
        }}
      /></UiProps>
    </main>
    </AtomicPageReveal>
  );
}
