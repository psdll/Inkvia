"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Brush, Maximize2, Music4, Pause, Play, Trash2, Upload } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { AppVideoPlayer } from "@/components/ui/app-video-player";
import { MediaLightbox } from "@/components/ui/media-lightbox";
import { MediaImage } from "@/components/ui/media-image";
import { VideoPosterPreview } from "@/components/ui/video-poster-preview";
import dynamic from "next/dynamic";

const ImageEditorModal = dynamic(() => import("@/components/canvas/ImageEditorModal"), { ssr: false });
import { buildMediaOriginalUrl, buildMediaProxyUrl } from "@/lib/media-url";
import { insertMediaItem, swapMediaItems } from "@/lib/media-item-order";
import {
  MEDIA_LIBRARY_DRAG_ITEMS_TYPE,
  readMediaLibraryDragItems,
} from "@/lib/media-library-drag";
import {
  createPendingToolMediaItem,
  createPendingToolMediaReplacement,
  retryToolMediaUpload,
  type ToolMediaClientItem,
} from "@/lib/tool-media/client-draft";

export type MultiUploadItem = ToolMediaClientItem;

type ReorderTarget = { index: number; placement: "before" | "after" | "swap" };

function getCardReorderTarget(card: HTMLElement, clientX: number): ReorderTarget {
  const rect = card.getBoundingClientRect();
  const offset = (clientX - rect.left) / rect.width;
  return {
    index: Number(card.dataset.uploadReplaceIndex),
    placement: offset < 0.25 ? "before" : offset > 0.75 ? "after" : "swap",
  };
}

export type MultiUploadDropzoneProps = {
  title: string;
  desc?: string;
  accept: string;
  items: MultiUploadItem[];
  onItemsChange: (items: MultiUploadItem[]) => void;
  className?: string;
  maxFiles?: number;
  previewSize?: "square" | "video";
  audioPlayback?: boolean;
  pickLabel?: string;
  toolbarLeading?: React.ReactNode;
  showClearAll?: boolean;
  showPickButton?: boolean;
  replaceOnItemDrop?: boolean;
  disabled?: boolean;
  staticVideoPreviews?: boolean;
};

function clampItems(items: MultiUploadItem[], maxFiles: number | undefined) {
  if (!maxFiles || maxFiles <= 0) return items;
  return items.slice(0, maxFiles);
}

export function appendMultiUploadItems(
  items: MultiUploadItem[],
  additions: MultiUploadItem[],
  maxFiles: number | undefined,
  disabled = false,
  insertionIndex = items.length,
) {
  if (disabled || !additions.length) return null;
  const available = maxFiles && maxFiles > 0 ? Math.max(0, maxFiles - items.length) : additions.length;
  const accepted = additions.slice(0, available);
  if (!accepted.length) return null;
  const index = Math.max(0, Math.min(items.length, insertionIndex));
  return [...items.slice(0, index), ...accepted, ...items.slice(index)];
}

export function replaceMultiUploadItem(
  items: MultiUploadItem[],
  index: number,
  item: MultiUploadItem,
  maxFiles: number | undefined,
  disabled = false,
) {
  if (
    disabled ||
    index < 0 ||
    index >= items.length ||
    items[index]?.replacement
  ) {
    return null;
  }
  const next = items.slice();
  next[index] = item.file
    ? createPendingToolMediaReplacement(items[index], item.file, item)
    : item;
  return clampItems(next, maxFiles);
}

export function getToolMediaUploadStatusLabel(item: MultiUploadItem) {
  if (item.uploadState === "queued") return "等待上传";
  if (item.uploadState === "uploading") return "正在上传";
  if (item.uploadState === "verifying") return "正在确认";
  if (item.uploadState === "ready") return "";
  if (item.uploadState === "failed" || item.uploadError) return "上传未完成";
  if (item.url) return "";
  if (item.file) return "正在上传";
  return "";
}

function guessKindFromFile(file: File | null) {
  if (!file) return "image" as const;
  if (file.type.startsWith("video/")) return "video" as const;
  if (file.type.startsWith("audio/")) return "audio" as const;
  const name = file.name.toLowerCase();
  if (/\.(mp4|mov|webm|mkv|m4v)$/i.test(name)) return "video" as const;
  if (/\.(mp3|wav|aac|ogg|flac|m4a)$/i.test(name)) return "audio" as const;
  return "image" as const;
}

function normalizeDroppedUrl(raw: string) {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (text === "null" || text === "undefined") return "";
  const safeText = text.replaceAll("\\", "/");
  const unwrapProxy = (value: string) => {
    if (typeof window === "undefined") return value;
    try {
      const u = new URL(value, window.location.origin);
      if (u.origin === window.location.origin && u.pathname === "/api/media-proxy") {
        const source = String(u.searchParams.get("url") || "").trim();
        if (source) return source;
      }
      return value;
    } catch {
      return value;
    }
  };
  const unwrapped = unwrapProxy(safeText);
  if (unwrapped.startsWith("/uploads/")) return unwrapped;
  if (unwrapped.startsWith("uploads/")) return `/${unwrapped}`;
  if (typeof window === "undefined") return unwrapped;
  try {
    const u = new URL(unwrapped, window.location.origin);
    if (u.origin === window.location.origin && u.pathname.startsWith("/uploads/")) {
      return `${u.pathname}${u.search}${u.hash}`;
    }
    return u.toString();
  } catch {
    return unwrapped;
  }
}

function normalizePreviewUrl(raw: string | null | undefined) {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (text === "null" || text === "undefined") return "";
  const safeText = text.replaceAll("\\", "/");
  const unwrapProxy = (value: string) => {
    if (typeof window === "undefined") return value;
    try {
      const u = new URL(value, window.location.origin);
      if (u.origin === window.location.origin && u.pathname === "/api/media-proxy") {
        const source = String(u.searchParams.get("url") || "").trim();
        if (source) return source;
      }
      return value;
    } catch {
      return value;
    }
  };
  const unwrapped = unwrapProxy(safeText);
  if (unwrapped.startsWith("/uploads/")) return unwrapped;
  if (unwrapped.startsWith("uploads/")) return `/${unwrapped}`;
  if (typeof window === "undefined") return unwrapped;
  try {
    const u = new URL(unwrapped, window.location.origin);
    if (u.origin === window.location.origin && u.pathname.startsWith("/uploads/")) {
      return `${u.pathname}${u.search}${u.hash}`;
    }
    return u.toString();
  } catch {
    return unwrapped;
  }
}

function looksLikeVideoUrl(src: string) {
  const s = String(src || "").toLowerCase();
  return /\.(mp4|mov|webm|mkv|m4v)(\?|#|$)/i.test(s);
}

function looksLikeAudioUrl(src: string) {
  const s = String(src || "").toLowerCase();
  return /\.(mp3|wav|aac|ogg|flac|m4a)(\?|#|$)/i.test(s);
}

function guessKind(item: MultiUploadItem | undefined, src: string | null) {
  const fromFile = guessKindFromFile(item?.file || null);
  if (item?.file) return fromFile;
  if (looksLikeVideoUrl(src || "")) return "video" as const;
  if (looksLikeAudioUrl(src || "")) return "audio" as const;
  return fromFile;
}

function CompactAudioPlayback({ src }: { src: string }) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = React.useState(false);

  const togglePlayback = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setPlaying(false));
      return;
    }
    audio.pause();
  };

  return (
    <div className="flex items-center justify-center">
      <audio
        ref={audioRef}
        data-upload-audio-player
        src={src}
        preload="metadata"
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      ><UiText id="common.m785699793650" /></audio>
      <UiProps ids={{"aria-label":["common.m4e3a621c0ad3","common.m3cc14feed625"],"title":["common.m4e3a621c0ad3","common.m3cc14feed625"]}}><button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={togglePlayback}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] transition hover:bg-[var(--panel-3)]"
        aria-label={playing ? "common.m4e3a621c0ad3" : "common.m3cc14feed625"}
        title={playing ? "common.m4e3a621c0ad3" : "common.m3cc14feed625"}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-px" />}
      </button></UiProps>
    </div>
  );
}

export function MultiUploadDropzone({
  title,
  desc,
  accept,
  items,
  onItemsChange,
  className,
  maxFiles,
  previewSize = "video",
  audioPlayback = false,
  pickLabel,
  toolbarLeading,
  showClearAll = true,
  showPickButton = true,
  replaceOnItemDrop = false,
  disabled = false,
  staticVideoPreviews = false,
}: MultiUploadDropzoneProps) {
  const { text, error: localizeError } = useUiLocale();
  const statusMessages: Record<string, string> = { "等待上传": "createDynamic.m09c31e898e5f", "正在上传": "createDynamic.macad4927ac1c", "正在确认": "createDynamic.ma3f78c1aaa43", "上传未完成": "createDynamic.m19e1f44297bd" };
  const { user, openLoginModal } = useAuth();
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const galleryRef = React.useRef<HTMLDivElement | null>(null);
  const dragCounterRef = React.useRef(0);
  const suppressPreviewClickRef = React.useRef(false);
  const pointerDragRef = React.useRef<{
    pointerId: number;
    sourceIndex: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [reorderDragging, setReorderDragging] = React.useState(false);
  const [reorderTarget, setReorderTarget] = React.useState<ReorderTarget | null>(null);
  const [replaceDragIndex, setReplaceDragIndex] = React.useState<number | null>(null);
  const [appendDragActive, setAppendDragActive] = React.useState(false);
  const [previewIndex, setPreviewIndex] = React.useState<number | null>(null);
  const [objectUrls, setObjectUrls] = React.useState<string[]>([]);
  const [failedPreviewSrcs, setFailedPreviewSrcs] = React.useState<Set<string>>(() => new Set());
  const [paintEditorOpen, setPaintEditorOpen] = React.useState(false);
  const [paintIndex, setPaintIndex] = React.useState<number | null>(null);

  const visualItems = React.useMemo(() => clampItems(items, maxFiles), [items, maxFiles]);

  const getPointerReorderTarget = (clientX: number, clientY: number, hitElement?: EventTarget | null) => {
    const gallery = galleryRef.current;
    if (!gallery) return null;
    const element = hitElement ?? document.elementFromPoint(clientX, clientY);
    if (!(element instanceof Element) || !gallery.contains(element)) return null;
    if (element.closest("[data-upload-append-slot]")) return null;
    let card = element.closest<HTMLElement>("[data-upload-replace-index]");
    // Gaps between cards are valid insertion targets too, including wrapped rows.
    if (!card) {
      let nearestDistance = Infinity;
      for (const candidate of gallery.querySelectorAll<HTMLElement>("[data-upload-replace-index]")) {
        const rect = candidate.getBoundingClientRect();
        const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
        const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
        const distance = dx * dx + dy * dy;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          card = candidate;
        }
      }
      if (card) {
        const rect = card.getBoundingClientRect();
        if (clientY < rect.top || clientY > rect.bottom) {
          return { index: Number(card.dataset.uploadReplaceIndex), placement: clientY < rect.top ? "before" : "after" } as ReorderTarget;
        }
      }
    }
    return card ? getCardReorderTarget(card, clientX) : null;
  };

  React.useEffect(() => {
    const urls = visualItems.map((it) => (it.file ? URL.createObjectURL(it.file) : null));
    setObjectUrls(urls.map((u) => u || ""));
    return () => {
      for (const u of urls) if (u) URL.revokeObjectURL(u);
    };
  }, [visualItems]);

  const getSrc = (idx: number) => {
    const it = visualItems[idx];
    if (!it) return null;
    const normalizedUrl = normalizePreviewUrl(it.url);
    const originalUrl = buildMediaOriginalUrl(normalizedUrl || it.url || "");
    const renderUrl = buildMediaProxyUrl(originalUrl || normalizedUrl || "");
    if (renderUrl && failedPreviewSrcs.has(renderUrl) && objectUrls[idx]) return objectUrls[idx];
    return renderUrl || objectUrls[idx] || null;
  };

  const ensureCanUpload = React.useCallback(() => {
    if (disabled) return false;
    if (user) return true;
    openLoginModal();
    return false;
  }, [disabled, openLoginModal, user]);

  const pick = () => {
    if (!ensureCanUpload()) return;
    inputRef.current?.click();
  };

  const appendFromFileList = (files: FileList | null | undefined, insertionIndex?: number) => {
    if (!ensureCanUpload()) return;
    if (!files || files.length === 0) return;
    const next = appendMultiUploadItems(
      items,
      Array.from(files, (file) => createPendingToolMediaItem(file)),
      maxFiles,
      disabled,
      insertionIndex,
    );
    if (!next) return;
    onItemsChange(next);
    if (inputRef.current) inputRef.current.value = "";
  };

  const isFileDrag = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer?.types || []);
    return types.includes("Files");
  };

  const isInternalItemDrag = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer?.types || []);
    return types.includes("application/x-multi-upload-item-index");
  };

  const isUrlDrag = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer?.types || []);
    return (
      types.includes(MEDIA_LIBRARY_DRAG_ITEMS_TYPE) ||
      types.includes("application/x-media-library-url") ||
      types.includes("application/x-history-image-url") ||
      types.includes("application/x-history-media-url") ||
      types.includes("application/x-local-upload-path") ||
      types.includes("text/uri-list") ||
      types.includes("text/plain")
    );
  };

  const isSupportedDrag = (e: React.DragEvent) =>
    !disabled && (isFileDrag(e) || isUrlDrag(e) || isInternalItemDrag(e));

  const isUrlAccepted = (src: string) => {
    const specs = accept
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    if (!specs.length || specs.includes("*/*")) return true;
    const isVideo = looksLikeVideoUrl(src);
    const isAudio = looksLikeAudioUrl(src);
    const hasImageRule = specs.some((s) => s.startsWith("image/"));
    const hasVideoRule = specs.some((s) => s.startsWith("video/"));
    const hasAudioRule = specs.some((s) => s.startsWith("audio/"));
    if (isVideo) return hasVideoRule;
    if (isAudio) return hasAudioRule;
    return hasImageRule || !hasVideoRule;
  };

  const appendFromUrls = (sources: string[], insertionIndex?: number) => {
    if (!ensureCanUpload()) return;
    const additions = sources.flatMap((src) => {
      const normalized = normalizeDroppedUrl(src);
      return normalized && isUrlAccepted(normalized)
        ? [{ file: null, url: normalized }]
        : [];
    });
    if (!additions.length) return false;
    const next = appendMultiUploadItems(
      items,
      additions,
      maxFiles,
      disabled,
      insertionIndex,
    );
    if (!next) return false;
    onItemsChange(next);
    if (inputRef.current) inputRef.current.value = "";
    return true;
  };

  const appendFromUrl = (src: string, insertionIndex?: number) => appendFromUrls([src], insertionIndex);

  const getUrlFromDataTransfer = (dataTransfer: DataTransfer) => {
    const mediaLibraryUrl = dataTransfer.getData("application/x-media-library-url");
    if (mediaLibraryUrl) return mediaLibraryUrl;

    const localPath = dataTransfer.getData("application/x-local-upload-path");
    if (localPath) return localPath;

    const media = dataTransfer.getData("application/x-history-media-url");
    if (media) return media;

    const custom = dataTransfer.getData("application/x-history-image-url");
    if (custom) return custom;

    const uriList = dataTransfer.getData("text/uri-list");
    if (uriList) {
      const first = uriList
        .split(/\r?\n/)
        .map((x) => x.trim())
        .find((x) => x && !x.startsWith("#"));
      if (first) return first;
    }

    return dataTransfer.getData("text/plain");
  };

  const appendFromDataTransfer = (e: React.DragEvent, insertionIndex?: number) => {
    const libraryItems = readMediaLibraryDragItems(e.dataTransfer);
    if (libraryItems.length) {
      appendFromUrls(libraryItems.map((item) => item.url), insertionIndex);
      return true;
    }
    const droppedUrl = getUrlFromDataTransfer(e.dataTransfer);
    if (droppedUrl) {
      appendFromUrl(droppedUrl, insertionIndex);
      return true;
    }
    return false;
  };

  const replaceAt = (idx: number, item: MultiUploadItem) => {
    if (!ensureCanUpload()) return false;
    const next = replaceMultiUploadItem(
      items,
      idx,
      item,
      maxFiles,
      disabled,
    );
    if (!next) return false;
    onItemsChange(next);
    if (inputRef.current) inputRef.current.value = "";
    return true;
  };

  const reorderItems = (sourceIdx: number, target: ReorderTarget) => {
    if (disabled) return false;
    const next = target.placement === "swap"
      ? swapMediaItems(items, sourceIdx, target.index)
      : insertMediaItem(items, sourceIdx, target.index, target.placement);
    if (next === items) return false;
    onItemsChange(clampItems(next, maxFiles));
    return true;
  };

  const finishPointerDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    shouldReorder: boolean,
  ) => {
    const pointerDrag = pointerDragRef.current;
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
    const target = getPointerReorderTarget(event.clientX, event.clientY);
    pointerDragRef.current = null;
    setReorderDragging(false);
    setReorderTarget(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (shouldReorder && target) {
      reorderItems(pointerDrag.sourceIndex, target);
    }
    window.setTimeout(() => {
      suppressPreviewClickRef.current = false;
    }, 0);
  };

  const replaceFromDataTransfer = (idx: number, e: React.DragEvent) => {
    const target = getCardReorderTarget(e.currentTarget as HTMLElement, e.clientX);
    const sourceIndexText = e.dataTransfer.getData("application/x-multi-upload-item-index");
    if (sourceIndexText) {
      const sourceIdx = Number(sourceIndexText);
      if (!Number.isInteger(sourceIdx)) return false;
      return reorderItems(sourceIdx, target);
    }

    if (target.placement !== "swap") {
      const insertionIndex = target.index + (target.placement === "after" ? 1 : 0);
      if (isFileDrag(e)) {
        appendFromFileList(e.dataTransfer.files, insertionIndex);
        return true;
      }
      return appendFromDataTransfer(e, insertionIndex);
    }

    if (isFileDrag(e)) {
      const file = e.dataTransfer.files?.[0];
      if (!file) return false;
      return replaceAt(idx, { file, url: null });
    }

    const libraryItems = readMediaLibraryDragItems(e.dataTransfer);
    if (libraryItems.length > 1) {
      return appendFromUrls(libraryItems.map((item) => item.url));
    }

    const droppedUrl = getUrlFromDataTransfer(e.dataTransfer);
    if (!droppedUrl) return false;
    const normalized = normalizeDroppedUrl(droppedUrl);
    if (!normalized || !isUrlAccepted(normalized)) return false;
    return replaceAt(idx, { file: null, url: normalized });
  };

  const retryAt = (idx: number) => {
    if (disabled) return;
    const current = items[idx];
    if (!current) return;
    const retried = retryToolMediaUpload(current);
    if (retried === current) return;
    const next = items.slice();
    next[idx] = retried;
    onItemsChange(next);
  };

  const removeAt = (idx: number) => {
    const next = items.slice();
    next.splice(idx, 1);
    onItemsChange(next);
  };

  const clearAll = () => {
    onItemsChange([]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const openPaint = (idx: number) => {
    if (disabled || visualItems[idx]?.replacement) return;
    const src = getSrc(idx);
    if (!src) return;
    const kind = guessKind(visualItems[idx], src);
    if (kind !== "image") return;
    setPaintIndex(idx);
    setPaintEditorOpen(true);
  };

  const count = visualItems.length;
  const hasPreview = count > 0;
  const isSingle = count === 1;
  const canAppendItem = !maxFiles || maxFiles <= 0 || count < maxFiles;
  const showAppendDropSlot = !disabled && replaceOnItemDrop && hasPreview && dragging && canAppendItem && count < 9;
  const layoutCount = showAppendDropSlot ? count + 1 : count;

  const isReplaceDropTarget = (target: EventTarget | null) => {
    if (disabled || !replaceOnItemDrop || !hasPreview || !(target instanceof HTMLElement)) return false;
    return Boolean(target.closest("[data-upload-replace-index]"));
  };

  const previewBase = [
    "relative w-full cursor-pointer overflow-hidden rounded-xl",
    previewSize === "square" ? "h-[clamp(180px,30dvh,280px)]" : "h-[clamp(180px,28dvh,260px)]"
  ].join(" ");

  const overlay = hasPreview
    ? dragging
      ? "pointer-events-none absolute inset-0 border-2 border-dashed border-blue-500/70 bg-transparent transition-all duration-200"
      : null
    : [
        "absolute inset-0 border-2 border-dashed border-[var(--border-2)] bg-[var(--panel-2)] flex flex-col items-center justify-center gap-4 transition-all duration-300",
        dragging ? "border-blue-500/60 bg-[var(--panel-3)]" : "group-hover:border-blue-500/45 group-hover:bg-[var(--panel-3)]"
      ].join(" ");

  const gridClass =
    layoutCount === 1
      ? "grid grid-cols-1 grid-rows-1 gap-2 h-full w-full"
      : layoutCount === 2
        ? "grid grid-cols-2 gap-2 h-full w-full"
        : layoutCount <= 4
          ? "grid grid-cols-2 grid-rows-2 gap-2 h-full w-full"
          : "grid grid-cols-3 gap-2 h-full w-full auto-rows-[96px] overflow-y-auto";

  const visibleItemCount = count;
  const fitClass = count === 1 ? "object-contain" : "object-cover";
  const previewableItems = visualItems.flatMap((item, itemIndex) => {
    const src = getSrc(itemIndex);
    const kind = guessKind(item, src);
    return src && kind !== "audio"
      ? [{ itemIndex, src, kind: kind as "image" | "video" }]
      : [];
  });
  const activePreviewIndex =
    previewIndex === null || previewableItems.length === 0
      ? null
      : Math.min(previewIndex, previewableItems.length - 1);
  const activePreview =
    activePreviewIndex === null ? null : previewableItems[activePreviewIndex];

  React.useEffect(() => {
    if (previewIndex === null) return;
    if (previewableItems.length === 0) {
      setPreviewIndex(null);
      return;
    }
    if (previewIndex >= previewableItems.length) {
      setPreviewIndex(previewableItems.length - 1);
    }
  }, [previewIndex, previewableItems.length]);

  const openZoom = (itemIndex: number) => {
    const nextPreviewIndex = previewableItems.findIndex(
      (entry) => entry.itemIndex === itemIndex,
    );
    if (nextPreviewIndex < 0) return;
    setPreviewIndex(nextPreviewIndex);
  };
  const getPaintSrc = (idx: number | null) => {
    if (idx == null) return null;
    const it = visualItems[idx];
    if (!it) return null;
    if (it.url) return buildMediaOriginalUrl(it.url) || getSrc(idx);
    return getSrc(idx);
  };


  return (
    <>
      <div className={["flex flex-col group", className || ""].join(" ")}>
        <div className="flex justify-between items-center mb-3 gap-2">
          <span className="text-xs font-bold text-[var(--app-muted)] tracking-wider">{title}</span>
          {showPickButton || (hasPreview && showClearAll) ? (
            <div className="flex items-center gap-1.5">
              {toolbarLeading}
              {showPickButton ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    pick();
                  }}
                  disabled={disabled}
                  className="h-7 px-2.5 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-50 transition flex items-center justify-center gap-1.5 shadow-[var(--shadow-2)]"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span className="text-[11px]">{pickLabel ?? text("createDynamic.m9f0d4e4656ee")}</span>
                </button>
              ) : null}
              {hasPreview && showClearAll ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    clearAll();
                  }}
                  className="h-7 px-2.5 rounded-xl border border-rose-500/30 bg-[var(--panel-bg)] text-rose-700 hover:bg-rose-500/10 transition flex items-center justify-center gap-1.5 shadow-[var(--shadow-2)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="text-[11px]"><UiText id="common.m1b590914091c" /></span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div
          className={previewBase}
          role={hasPreview || disabled ? undefined : "button"}
          tabIndex={hasPreview || disabled ? undefined : 0}
          onClick={hasPreview || disabled ? undefined : pick}
          onKeyDown={
            hasPreview || disabled
              ? undefined
              : (e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  pick();
                }
          }
          onDragEnterCapture={(e) => {
            if (!isSupportedDrag(e)) return;
            e.preventDefault();
            dragCounterRef.current += 1;
            setDragging(true);
          }}
          onDragOverCapture={(e) => {
            if (!isSupportedDrag(e)) return;
            e.preventDefault();
            try {
              e.dataTransfer.dropEffect = "copy";
            } catch {}
            setDragging(true);
            if (replaceOnItemDrop && !isInternalItemDrag(e)) {
              const target = getPointerReorderTarget(e.clientX, e.clientY, e.target);
              setReorderTarget(target?.placement === "swap" ? null : target);
              setReplaceDragIndex(target?.placement === "swap" ? target.index : null);
            }
          }}
          onDragLeaveCapture={(e) => {
            if (!isSupportedDrag(e)) return;
            e.preventDefault();
            dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
            if (dragCounterRef.current === 0) {
              setDragging(false);
              setReplaceDragIndex(null);
              setReorderTarget(null);
              setAppendDragActive(false);
            }
          }}
          onDropCapture={(e) => {
            if (!isSupportedDrag(e)) return;
            if (isReplaceDropTarget(e.target)) return;
            e.preventDefault();
            const target = replaceOnItemDrop ? getPointerReorderTarget(e.clientX, e.clientY, e.target) : null;
            const insertionIndex = target && target.placement !== "swap"
              ? target.index + (target.placement === "after" ? 1 : 0) : undefined;
            dragCounterRef.current = 0;
            setDragging(false);
            setReplaceDragIndex(null);
            setReorderTarget(null);
            setAppendDragActive(false);
            if (isFileDrag(e)) {
              appendFromFileList(e.dataTransfer.files, insertionIndex);
              return;
            }
            appendFromDataTransfer(e, insertionIndex);
          }}
        >
          {hasPreview ? (
            <div className="absolute inset-0 bg-[var(--input-bg)] p-2">
              <div
                ref={galleryRef}
                data-upload-gallery
                className={[
                  gridClass,
                  replaceOnItemDrop && reorderDragging ? "overscroll-contain" : "",
                ].join(" ")}
                onWheel={(event) => {
                  if (!replaceOnItemDrop || !reorderDragging) return;
                  if (event.currentTarget.scrollHeight <= event.currentTarget.clientHeight) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.scrollTop += event.deltaY;
                }}
                onScroll={() => {
                  const drag = pointerDragRef.current;
                  if (drag) setReorderTarget(getPointerReorderTarget(drag.clientX, drag.clientY));
                }}
              >
                {Array.from({ length: visibleItemCount }).map((_, i) => {
                  const src = getSrc(i);
                  const isThreeMain = count === 3 && !showAppendDropSlot && i === 0;
                  const isReplaceDragTarget = replaceDragIndex === i;
                  const dropPlacement = reorderTarget?.index === i ? reorderTarget.placement : null;
                  const kind = guessKind(visualItems[i], src);
                  const uploadError = String(visualItems[i]?.uploadError || "").trim();
                  const uploadStatus = getToolMediaUploadStatusLabel(visualItems[i]);
                  return (
                     <div
                       key={i}
                       data-upload-replace-index={i}
                       data-upload-reorder-placement={dropPlacement ?? undefined}
                       className={[
                        "upload-preview-card group/upload-item relative overflow-hidden rounded-lg bg-[var(--panel-bg)] border border-[var(--border)]",
                        isSingle ? "flex items-center justify-center" : "",
                        replaceOnItemDrop ? "touch-none select-none cursor-grab active:cursor-grabbing" : kind !== "audio" ? "cursor-zoom-in" : "",
                        isReplaceDragTarget ? "ring-2 ring-blue-500/80 border-blue-500/80" : "",
                        dropPlacement === "swap" ? "ring-2 ring-[var(--primary-bg)]" : "",
                        uploadError ? "ring-2 ring-red-500/60 border-red-500/70" : "",
                        isThreeMain ? "row-span-2" : ""
                      ].join(" ")}
                      onClick={!replaceOnItemDrop && kind !== "audio" ? () => {
                        if (suppressPreviewClickRef.current) return;
                        openZoom(i);
                      } : undefined}
                           onPointerDown={(event) => {
                             if (!replaceOnItemDrop || disabled || event.button !== 0) return;
                             if ((event.target as Element).closest("button, input, textarea, select, audio, video[controls], [role=button]")) return;
                             event.preventDefault();
                             event.stopPropagation();
                             suppressPreviewClickRef.current = true;
                             pointerDragRef.current = {
                               pointerId: event.pointerId,
                               sourceIndex: i,
                               clientX: event.clientX,
                               clientY: event.clientY,
                             };
                             event.currentTarget.setPointerCapture(event.pointerId);
                             setReorderDragging(true);
                             setReorderTarget(null);
                           }}
                           onPointerMove={(event) => {
                             const pointerDrag = pointerDragRef.current;
                             if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;
                             event.preventDefault();
                             event.stopPropagation();
                             pointerDrag.clientX = event.clientX;
                             pointerDrag.clientY = event.clientY;
                             setReorderTarget(getPointerReorderTarget(event.clientX, event.clientY));
                           }}
                           onPointerUp={(event) => {
                             event.preventDefault();
                             event.stopPropagation();
                             finishPointerDrag(event, true);
                           }}
                           onPointerCancel={(event) => {
                             event.preventDefault();
                             event.stopPropagation();
                             finishPointerDrag(event, false);
                           }}
                           onLostPointerCapture={(event) => finishPointerDrag(event, false)}
                       onDragEnter={(e) => {
                        if (!replaceOnItemDrop || !isSupportedDrag(e)) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const target = getCardReorderTarget(e.currentTarget, e.clientX);
                        setReplaceDragIndex(!isInternalItemDrag(e) && target.placement === "swap" ? i : null);
                        setReorderTarget(isInternalItemDrag(e) || target.placement !== "swap" ? target : null);
                        setAppendDragActive(false);
                      }}
                      onDragOver={(e) => {
                        if (!replaceOnItemDrop || !isSupportedDrag(e)) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const target = getCardReorderTarget(e.currentTarget, e.clientX);
                        setReplaceDragIndex(!isInternalItemDrag(e) && target.placement === "swap" ? i : null);
                        setReorderTarget(isInternalItemDrag(e) || target.placement !== "swap" ? target : null);
                        setAppendDragActive(false);
                        try {
                          e.dataTransfer.dropEffect = isInternalItemDrag(e) ? "move" : "copy";
                        } catch {}
                      }}
                      onDragLeave={(e) => {
                        if (!replaceOnItemDrop || !isSupportedDrag(e)) return;
                        const related = e.relatedTarget;
                        if (related instanceof Node && e.currentTarget.contains(related)) return;
                        setReplaceDragIndex((current) => (current === i ? null : current));
                        setReorderTarget((current) => (current?.index === i ? null : current));
                      }}
                      onDrop={(e) => {
                        if (!replaceOnItemDrop || !isSupportedDrag(e)) return;
                        e.preventDefault();
                        e.stopPropagation();
                        dragCounterRef.current = 0;
                        setDragging(false);
                        setReplaceDragIndex(null);
                        setReorderTarget(null);
                        replaceFromDataTransfer(i, e);
                      }}
                    >
                      {src ? (
                        kind === "video" ? (
                          staticVideoPreviews ? (
                            <VideoPosterPreview
                              videoSrc={src}
                              posterSrc={typeof visualItems[i]?.thumbnailUrl === "string" ? visualItems[i].thumbnailUrl : null}
                              className={["h-full w-full", fitClass].join(" ")}
                            />
                          ) : isSingle ? (
                            <AppVideoPlayer
                              src={src}
                              className="media-fit"
                              containerClassName="h-full w-full"
                               compact
                               showCenterControl={false}
                               playOnSurfaceClick={false}
                               playsInline
                              preload="metadata"
                            />
                          ) : (
                            <video
                              data-upload-video-preview
                              src={src}
                              className={["h-full w-full", fitClass].join(" ")}
                              muted
                              playsInline
                              preload="metadata"
                              tabIndex={-1}
                            />
                          )
                        ) : kind === "audio" ? (
                           <div className={["flex h-full w-full flex-col items-center justify-center gap-2 bg-[var(--panel-2)] text-[var(--app-fg)]", isSingle ? "" : "px-3"].join(" ")}>
                             <Music4 className="h-8 w-8 opacity-80" />
                             <span className="max-w-full truncate text-xs">{visualItems[i]?.file?.name || <UiText id="common.m9aff128e00ac" />}</span>
                             {audioPlayback ? (
                               <CompactAudioPlayback src={src} />
                             ) : null}
                           </div>
                        ) : (
                          <MediaImage
                            src={src}
                            alt={title}
                            previewSize={{ width: isSingle ? 600 : 300 }}
                            original={src.startsWith("blob:") || src.startsWith("data:")}
                            decoding="async"
                            className={isSingle ? "media-fit" : ["h-full w-full", fitClass].join(" ")}
                            draggable={false}
                            onError={() => {
                              if (!objectUrls[i] || src === objectUrls[i]) return;
                              setFailedPreviewSrcs((prev) => {
                                if (prev.has(src)) return prev;
                                const next = new Set(prev);
                                next.add(src);
                                return next;
                              });
                            }}
                          />
                        )
                      ) : null}

                      {replaceOnItemDrop && kind !== "audio" ? (
                         <UiProps ids={{"title":["common.m5d41d912535d"]}}><button
                           data-upload-preview-button
                           type="button"
                           className="opacity-0 pointer-events-none group-hover/upload-item:opacity-100 group-hover/upload-item:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto transition-opacity absolute left-2 top-2 z-20 inline-flex h-7 w-7 select-none items-center justify-center rounded-md bg-black/55 text-white disabled:cursor-not-allowed disabled:opacity-60"
                          aria-label={text("createDynamic.m019360990193", { index: i + 1 })}
                          title="common.m5d41d912535d"
                          disabled={disabled}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            openZoom(i);
                          }}

                          >
                            <Maximize2 className="h-3.5 w-3.5" />
                          </button></UiProps>
                      ) : null}

                      {uploadStatus ? (
                        <div className="absolute right-2 top-2 rounded-md bg-black/55 px-2 py-1 text-[10px] text-white">
                          {statusMessages[uploadStatus] ? text(statusMessages[uploadStatus]) : uploadStatus}
                        </div>
                      ) : null}

                      {uploadError ? (
                        <div
                          className="absolute inset-x-2 bottom-9 z-10 flex items-center justify-between gap-2 rounded-md border border-red-400/35 bg-red-950/85 px-2 py-1.5 text-[11px] font-medium text-red-100 shadow-sm"
                          title={localizeError(uploadError)}
                        >
                          <span className="min-w-0 truncate"><UiText id="common.m19e1f44297bd" /></span>
                          <button
                            type="button"
                            className="shrink-0 rounded-md border border-red-200/35 bg-white/10 px-2 py-0.5 text-[10px] text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={disabled || !(visualItems[i]?.file instanceof File)}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              retryAt(i);
                            }}
                          ><UiText id="common.mb8784c8dd563" /></button>
                        </div>
                      ) : null}

                      {kind === "image" ? (
                        <div data-upload-paint-action className="absolute bottom-1.5 right-1.5 flex items-center gap-1 opacity-0 pointer-events-none group-hover/upload-item:opacity-100 group-hover/upload-item:pointer-events-auto transition-opacity">
                          <UiProps ids={{"aria-label":["common.mde8e908b2d58"]}}><button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openPaint(i);
                            }}
                             className="h-6 px-2 rounded-md border border-[var(--border)] bg-[var(--panel-bg)]/90 text-[var(--app-fg)] hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-50 transition inline-flex items-center justify-center gap-1 shadow-[var(--shadow-2)]"
                             aria-label="common.mde8e908b2d58"
                             disabled={disabled || Boolean(visualItems[i]?.replacement)}
                          >
                            <Brush className="h-3 w-3" />
                            <span className="text-[10px] leading-none"><UiText id="common.m2bf1abb22ec6" /></span>
                          </button></UiProps>
                        </div>
                      ) : null}

                      <div
                        data-upload-card-actions
                        className="absolute top-2 right-2 flex items-center gap-2 opacity-0 pointer-events-none group-hover/upload-item:opacity-100 group-hover/upload-item:pointer-events-auto transition"
                      >
                        <UiProps ids={{"aria-label":["common.m2f9daa828907"]}}><button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            removeAt(i);
                          }}
                          className="h-7 w-7 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] hover:bg-[var(--panel-2)] transition flex items-center justify-center shadow-[var(--shadow-2)]"
                          aria-label="common.m2f9daa828907"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button></UiProps>
                      </div>
                      {dropPlacement ? (
                        <div className="pointer-events-none absolute inset-0 z-30">
                          {dropPlacement !== "swap" ? (
                            <div className={`absolute bottom-1 top-1 w-1 rounded-full bg-[var(--primary-bg)] ${dropPlacement === "before" ? "left-0" : "right-0"}`} />
                          ) : null}
                          <span className="absolute inset-x-1 bottom-1 rounded-md bg-[var(--primary-bg)] px-1 py-1 text-center text-[10px] font-medium text-[var(--primary-fg)]">
                            {dropPlacement === "before" ? <UiText id="common.ma7b0824ceccb" /> : dropPlacement === "after" ? <UiText id="common.mcf65445306a6" /> : <UiText id="common.mdf81ac72a022" />}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {showAppendDropSlot ? (
                  <div
                    data-upload-append-slot
                    className={[
                      "relative flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-[var(--panel-bg)] text-[var(--app-muted)] transition",
                      appendDragActive ? "border-blue-500/80 ring-2 ring-blue-500/35 text-blue-700" : "border-[var(--border)]"
                    ].join(" ")}
                    onDragEnter={(e) => {
                      if (!isSupportedDrag(e)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setReplaceDragIndex(null);
                      setReorderTarget(null);
                      setAppendDragActive(true);
                    }}
                    onDragOver={(e) => {
                      if (!isSupportedDrag(e)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setReplaceDragIndex(null);
                      setReorderTarget(null);
                      setAppendDragActive(true);
                      try {
                        e.dataTransfer.dropEffect = "copy";
                      } catch {}
                    }}
                    onDragLeave={(e) => {
                      if (!isSupportedDrag(e)) return;
                      const related = e.relatedTarget;
                      if (related instanceof Node && e.currentTarget.contains(related)) return;
                      setAppendDragActive(false);
                    }}
                  >
                    <Upload className="h-5 w-5" />
                    <span className="text-xs"><UiText id="common.mdd238b25f84f" /></span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className={overlay ?? undefined}>
              <div className="w-16 h-16 bg-[var(--panel-bg)] rounded-full flex items-center justify-center shadow-[var(--shadow-2)] border border-[var(--border)] group-hover:scale-110 transition-transform">
                <Upload className="w-6 h-6 text-[var(--app-muted)] group-hover:text-blue-600" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-[var(--app-fg)]"><UiText id="common.maadd89aae1ed" /></p>
                {desc ? <p className="text-xs text-[var(--app-muted)]">{desc}</p> : null}
              </div>
            </div>
          )}

          {hasPreview && dragging ? <div className={overlay as string} /> : null}

          <input ref={inputRef} type="file" multiple className="hidden" accept={accept} disabled={disabled} onChange={(e) => appendFromFileList(e.target.files)} />
        </div>
      </div>

      <MediaLightbox
        open={activePreviewIndex !== null && Boolean(activePreview)}
        src={activePreview?.src || null}
        kind={activePreview?.kind || "image"}
        title={title}
        layout="floating"
        counter={
          activePreviewIndex === null
            ? undefined
            : `${activePreviewIndex + 1}/${previewableItems.length}`
        }
        counterAlwaysVisible
        dots={
          activePreviewIndex !== null && previewableItems.length > 1
            ? { count: previewableItems.length, activeIndex: activePreviewIndex }
            : undefined
        }
        hasPrev={activePreviewIndex !== null && activePreviewIndex > 0}
        hasNext={
          activePreviewIndex !== null &&
          activePreviewIndex < previewableItems.length - 1
        }
        onPrev={() =>
          setPreviewIndex((current) =>
            current === null ? null : Math.max(0, current - 1),
          )
        }
        onNext={() =>
          setPreviewIndex((current) =>
            current === null
              ? null
              : Math.min(previewableItems.length - 1, current + 1),
          )
        }
        onClose={() => setPreviewIndex(null)}
      />
      {paintEditorOpen && getPaintSrc(paintIndex) ? (
        <ImageEditorModal
          imageUrl={getPaintSrc(paintIndex)!}
          initialMode="brush"
          onClose={() => {
            setPaintEditorOpen(false);
            setPaintIndex(null);
          }}
          onResult={() => {}}
          onFilesResult={(files) => {
            if (disabled || paintIndex == null || !items[paintIndex] || items[paintIndex].replacement) {
              throw new Error("当前素材无法编辑，请关闭后重新打开");
            }
            if (!files.length) return;
            if (maxFiles && maxFiles > 0 && items.length - 1 + files.length > maxFiles) {
              throw new Error(`最多支持 ${maxFiles} 张参考图，请减少切分数量或移除其他参考图`);
            }
            const current = items[paintIndex];
            const backup = String(current.paintOriginalUrl || current.url || getSrc(paintIndex) || "");
            const replacements = [
              createPendingToolMediaReplacement(current, files[0], { paintOriginalUrl: backup || null }),
              ...files.slice(1).map((file) => createPendingToolMediaItem(file)),
            ];
            const next = items.slice();
            next.splice(paintIndex, 1, ...replacements);
            onItemsChange(next);
          }}
        />
      ) : null}
    </>
  );
}
