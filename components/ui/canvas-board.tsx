"use client";
import { UiProps, UiText } from "@/i18n/ui";


import * as React from "react";
import { ChevronDown, Download, Grid3X3, Loader2, Minus, Plus, RotateCcw, X } from "lucide-react";
import { ImageResolution, type ImageDimensions } from "@/components/ui/image-resolution";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

type CanvasBoardProps = {
  src: string;
  downloadSrc?: string;
  originalSrc?: string;
  dimensions?: ImageDimensions | null;
  secondarySrc?: string | null;
  alt?: string;
  className?: string;
  onOpenLightbox?: () => void;
  fitMode?: "contain" | "cover";
  showLoadingIndicator?: boolean;
  allowGridSplit?: boolean;
  preview?: React.ReactNode;
};

type GridViewMode = "single" | "custom";
type GridRect = { row: number; col: number; x: number; y: number; w: number; h: number };

const GRID_PRESETS = [
  [1, 2],
  [2, 1],
  [2, 2],
  [2, 3],
  [3, 2],
  [3, 3]
] as const;
const GRID_LINE_MAX = 20;
const GRID_GAP_MAX = 240;
const MIN_CANVAS_ZOOM = 0.05;
const MAX_CANVAS_ZOOM = 6;

function buildGridRects(width: number, height: number, rows: number, cols: number, gap: number): GridRect[] {
  const safeRows = clamp(Math.round(rows), 1, GRID_LINE_MAX + 1);
  const safeCols = clamp(Math.round(cols), 1, GRID_LINE_MAX + 1);
  const halfGap = clamp(Math.round(gap), 0, GRID_GAP_MAX) / 2;
  const rects: GridRect[] = [];

  for (let row = 0; row < safeRows; row++) {
    const topLine = (row * height) / safeRows;
    const bottomLine = ((row + 1) * height) / safeRows;
    const y1 = Math.round(row === 0 ? 0 : topLine + halfGap);
    const y2 = Math.round(row === safeRows - 1 ? height : bottomLine - halfGap);
    for (let col = 0; col < safeCols; col++) {
      const leftLine = (col * width) / safeCols;
      const rightLine = ((col + 1) * width) / safeCols;
      const x1 = Math.round(col === 0 ? 0 : leftLine + halfGap);
      const x2 = Math.round(col === safeCols - 1 ? width : rightLine - halfGap);
      if (x2 > x1 && y2 > y1) rects.push({ row, col, x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    }
  }

  return rects;
}

export function CanvasBoard({
  src,
  downloadSrc,
  originalSrc,
  dimensions,
  secondarySrc,
  alt,
  className,
  onOpenLightbox,
  fitMode = "contain",
  showLoadingIndicator = true,
  allowGridSplit = true,
  preview,
}: CanvasBoardProps) {
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const img2Ref = React.useRef<HTMLImageElement | null>(null);
  const transformedRef = React.useRef<HTMLDivElement | null>(null);
  const primaryWrapRef = React.useRef<HTMLDivElement | null>(null);
  const secondaryWrapRef = React.useRef<HTMLDivElement | null>(null);
  const toolbarRef = React.useRef<HTMLDivElement | null>(null);
  const draggingRef = React.useRef(false);
  const dragStartRef = React.useRef<{
    x: number;
    y: number;
    sceneTx: number;
    sceneTy: number;
    primaryTx: number;
    primaryTy: number;
    secondaryTx: number;
    secondaryTy: number;
    target: "primary" | "secondary" | null;
  } | null>(null);

  const [fitScale, setFitScale] = React.useState(1);
  const [scale, setScale] = React.useState(1);
  const [tx, setTx] = React.useState(0);
  const [ty, setTy] = React.useState(0);
  const [selectedTarget, setSelectedTarget] = React.useState<"primary" | "secondary" | null>(null);
  const [toolbarPos, setToolbarPos] = React.useState<{ left: number; top: number } | null>(null);
  const [viewMode, setViewMode] = React.useState<GridViewMode>("single");
  const [primaryNatural, setPrimaryNatural] = React.useState<{ w: number; h: number }>({ w: 1, h: 1 });
  const [gridLoading, setGridLoading] = React.useState(false);
  const [gridMenuOpen, setGridMenuOpen] = React.useState(false);
  const [customGridOpen, setCustomGridOpen] = React.useState(false);
  const [customRows, setCustomRows] = React.useState(3);
  const [customCols, setCustomCols] = React.useState(3);
  const [gridGap, setGridGap] = React.useState(0);
  const [gridTiles, setGridTiles] = React.useState<
    | null
    | {
        mode: GridViewMode;
        rows: number;
        cols: number;
        gap: number;
        tiles: Array<{ r: number; c: number; url: string; filename: string }>;
      }
  >(null);
  const gridJobRef = React.useRef(0);
  const buildCanvasSource = React.useCallback((raw: string | null | undefined) => {
    const s = String(raw || "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) {
      return `/api/media-proxy?url=${encodeURIComponent(s)}`;
    }
    return s;
  }, []);
  const [primaryRenderSrc, setPrimaryRenderSrc] = React.useState(() => buildCanvasSource(src));
  const [originalRequested, setOriginalRequested] = React.useState(false);
  const [showingOriginal, setShowingOriginal] = React.useState(false);
  const [secondaryRenderSrc, setSecondaryRenderSrc] = React.useState(() => buildCanvasSource(secondarySrc || ""));
  const [primaryLoadState, setPrimaryLoadState] = React.useState<{
    src: string;
    status: "loaded" | "failed";
  } | null>(null);
  const primaryReady = primaryLoadState?.src === src && primaryLoadState.status === "loaded";
  const primaryFailed = primaryLoadState?.src === src && primaryLoadState.status === "failed";

  React.useEffect(() => {
    setPrimaryRenderSrc(buildCanvasSource(src));
    setOriginalRequested(false);
    setShowingOriginal(false);
  }, [buildCanvasSource, originalSrc, src]);

  React.useEffect(() => {
    if (!originalRequested || !primaryReady || showingOriginal) return;
    const nextOriginalSrc = buildCanvasSource(originalSrc);
    if (!nextOriginalSrc || nextOriginalSrc === buildCanvasSource(src)) return;

    let cancelled = false;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (cancelled) return;
      setPrimaryRenderSrc(nextOriginalSrc);
      setShowingOriginal(true);
    };
    image.onerror = () => {
      if (!cancelled) setOriginalRequested(false);
    };
    image.src = nextOriginalSrc;

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [buildCanvasSource, originalRequested, originalSrc, primaryReady, showingOriginal, src]);

  React.useEffect(() => {
    setSecondaryRenderSrc(buildCanvasSource(secondarySrc || ""));
  }, [buildCanvasSource, secondarySrc]);

  const triggerDownload = React.useCallback((url: string, filename: string) => {
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "image.png";
      a.rel = "noreferrer";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {}
  }, []);

  const primaryDownloadSrc = downloadSrc || src;
  const primaryFilename = React.useMemo(() => {
    const raw = String(primaryDownloadSrc || "").trim();
    if (!raw) return "image.png";
    const fallback = raw.split("/").pop() || "image.png";
    try {
      const u = new URL(raw, typeof window !== "undefined" ? window.location.origin : "http://localhost");
      const base = u.pathname.split("/").pop() || fallback;
      return base || "image.png";
    } catch {
      return fallback || "image.png";
    }
  }, [primaryDownloadSrc]);

  const overlayScale = React.useMemo(() => {
    const v = fitScale * scale;
    if (!v || !Number.isFinite(v)) return 1;
    return clamp(1 / v, 1 / MAX_CANVAS_ZOOM, 1 / MIN_CANVAS_ZOOM);
  }, [fitScale, scale]);

  const [primaryLayer, setPrimaryLayer] = React.useState<{ tx: number; ty: number; scale: number }>({
    tx: 0,
    ty: 0,
    scale: 1
  });
  const [secondaryLayer, setSecondaryLayer] = React.useState<{ tx: number; ty: number; scale: number }>({
    tx: 0,
    ty: 0,
    scale: 1
  });

  const applyFit = React.useCallback(() => {
    const wrap = wrapRef.current;
    const img = imgRef.current;
    if (!wrap || !img || !img.naturalWidth || !img.naturalHeight) return;
    const rect = wrap.getBoundingClientRect();
    const iw = img.naturalWidth || 1;
    const ih = img.naturalHeight || 1;
    const iw2 = secondarySrc ? img2Ref.current?.naturalWidth || 1 : 0;
    const ih2 = secondarySrc ? img2Ref.current?.naturalHeight || 1 : 0;
    const margin = 0;
    const maxW = Math.max(1, rect.width - margin);
    // Keep room above the fitted image for its resolution label.
    const maxH = Math.max(1, rect.height - 56);
    const gap = secondarySrc ? 24 : 0;
    const combinedW = iw + (secondarySrc ? gap + iw2 : 0);
    const combinedH = Math.max(ih, secondarySrc ? ih2 : 0);
    const isCover = fitMode === "cover" && !secondarySrc;
    const nextFit = clamp(
      isCover ? Math.max(maxW / combinedW, maxH / combinedH) : Math.min(maxW / combinedW, maxH / combinedH),
      0.05,
      6
    );
    setFitScale(nextFit);
    setScale(1);
    setTx(0);
    setTy(0);

    if (secondarySrc) {
      const secondaryBaseX = -(iw + gap) / 2;
      const primaryBaseX = (iw2 + gap) / 2;
      setSecondaryLayer({ tx: secondaryBaseX, ty: 0, scale: 1 });
      setPrimaryLayer({ tx: primaryBaseX, ty: 0, scale: 1 });
    } else {
      setPrimaryLayer({ tx: 0, ty: 0, scale: 1 });
      setSecondaryLayer({ tx: 0, ty: 0, scale: 1 });
    }
  }, [fitMode, secondarySrc]);

  const fitView = React.useCallback(() => {
    applyFit();
    setScale(1);
  }, [applyFit]);

  const zoomDisplay = Math.round(clamp(fitScale * scale, MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM) * 100);

  const requestOriginal = React.useCallback(() => {
    if (!originalSrc || originalSrc === src) return;
    setOriginalRequested(true);
  }, [originalSrc, src]);

  const zoomBy = React.useCallback(
    (ratio: number) => {
      if (ratio > 1) requestOriginal();
      const nextOverall = clamp((fitScale * scale) * ratio, MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM);
      const next = fitScale ? nextOverall / fitScale : nextOverall;
      setScale(next);
    },
    [fitScale, requestOriginal, scale]
  );

  const updateToolbarPos = React.useCallback(() => {
    if (!selectedTarget) return;
    const wrap = wrapRef.current;
    const target = selectedTarget === "primary" ? primaryWrapRef.current : secondaryWrapRef.current;
    if (!wrap || !target) return;
    const wrapRect = wrap.getBoundingClientRect();
    const imgRect = target.getBoundingClientRect();
    const toolRect = toolbarRef.current?.getBoundingClientRect();
    const toolW = toolRect?.width || 44;
    const toolH = toolRect?.height || 44;
    const gap = 10;

    let left = imgRect.left - wrapRect.left + imgRect.width / 2 - toolW / 2;
    left = clamp(left, 8, Math.max(8, wrapRect.width - toolW - 8));

    let top = imgRect.top - wrapRect.top - toolH - gap;
    if (top < 8) top = imgRect.bottom - wrapRect.top + gap;
    top = clamp(top, 8, Math.max(8, wrapRect.height - toolH - 8));

    setToolbarPos({ left, top });
  }, [selectedTarget]);

  React.useEffect(() => {
    setFitScale(1);
    setScale(1);
    setTx(0);
    setTy(0);
    setSelectedTarget(null);
    setToolbarPos(null);
    setViewMode("single");
    setGridMenuOpen(false);
    setCustomGridOpen(false);
    setGridLoading(false);
    setGridTiles((prev) => {
      if (prev?.tiles?.length) {
        for (const t of prev.tiles) URL.revokeObjectURL(t.url);
      }
      return null;
    });
    setPrimaryLayer({ tx: 0, ty: 0, scale: 1 });
    setSecondaryLayer({ tx: 0, ty: 0, scale: 1 });
    draggingRef.current = false;
    dragStartRef.current = null;
  }, [secondarySrc, src]);

  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => applyFit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [applyFit]);

  React.useEffect(() => {
    if (!gridMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (toolbarRef.current?.contains(target)) return;
      setGridMenuOpen(false);
      setCustomGridOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [gridMenuOpen]);

  const onPrimaryLoad = () => {
    const img = imgRef.current;
    setPrimaryLoadState({ src, status: "loaded" });
    if (showingOriginal) return;
    if (img) setPrimaryNatural({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    applyFit();
  };

  const onPrimaryError = () => {
    if (showingOriginal) {
      setShowingOriginal(false);
      setPrimaryRenderSrc(buildCanvasSource(src));
      return;
    }
    if (primaryRenderSrc !== src) {
      setPrimaryRenderSrc(src);
      return;
    }
    setPrimaryLoadState({ src, status: "failed" });
  };

  const onSecondaryLoad = () => {
    applyFit();
  };

  const gridSpec = React.useMemo(() => {
    if (allowGridSplit && viewMode === "custom") {
      return { rows: clamp(Math.round(customRows), 1, GRID_LINE_MAX + 1), cols: clamp(Math.round(customCols), 1, GRID_LINE_MAX + 1) };
    }
    return null;
  }, [allowGridSplit, customCols, customRows, viewMode]);

  const gridRects = React.useMemo(() => {
    if (!gridSpec) return [] as GridRect[];
    return buildGridRects(primaryNatural.w, primaryNatural.h, gridSpec.rows, gridSpec.cols, gridGap);
  }, [gridGap, gridSpec, primaryNatural.h, primaryNatural.w]);

  const gridGuideLines = React.useMemo(() => {
    if (!gridSpec) return [] as Array<{ type: "h" | "v"; pos: number }>;
    const lines: Array<{ type: "h" | "v"; pos: number }> = [];
    const pushLine = (type: "h" | "v", pos: number) => {
      const size = type === "h" ? primaryNatural.h : primaryNatural.w;
      lines.push({ type, pos: clamp(pos, 0, size) });
    };
    const pushWithGap = (type: "h" | "v", pos: number) => {
      const halfGap = clamp(Math.round(gridGap), 0, GRID_GAP_MAX) / 2;
      if (halfGap > 0) {
        pushLine(type, pos - halfGap);
        pushLine(type, pos + halfGap);
      } else {
        pushLine(type, pos);
      }
    };

    for (let col = 1; col < gridSpec.cols; col++) pushWithGap("v", (col * primaryNatural.w) / gridSpec.cols);
    for (let row = 1; row < gridSpec.rows; row++) pushWithGap("h", (row * primaryNatural.h) / gridSpec.rows);
    return lines;
  }, [gridGap, gridSpec, primaryNatural.h, primaryNatural.w]);

  const downloadGridTile = React.useCallback(
    async (r: number, c: number) => {
      const spec = gridSpec;
      if (!spec) return;
      const existing = gridTiles?.tiles.find((tile) => tile.r === r && tile.c === c) || null;
      if (existing) {
        triggerDownload(existing.url, existing.filename);
        return;
      }
      const img = imgRef.current;
      if (!img || !img.naturalWidth || !img.naturalHeight) {
        triggerDownload(primaryDownloadSrc, primaryFilename);
        return;
      }
      try {
        const W = img.naturalWidth;
        const H = img.naturalHeight;
        const rect = buildGridRects(W, H, spec.rows, spec.cols, gridGap).find((item) => item.row === r && item.col === c);
        if (!rect) return;
        const sx = rect.x;
        const sy = rect.y;
        const sw = rect.w;
        const sh = rect.h;
        const w = Math.max(1, Math.floor(sw));
        const h = Math.max(1, Math.floor(sh));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          triggerDownload(primaryDownloadSrc, primaryFilename);
          return;
        }
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
        if (!blob) {
          triggerDownload(primaryDownloadSrc, primaryFilename);
          return;
        }
        const url = URL.createObjectURL(blob);
        const filename = `crop_${spec.rows}x${spec.cols}_r${r + 1}c${c + 1}.png`;
        triggerDownload(url, filename);
        window.setTimeout(() => URL.revokeObjectURL(url), 1200);
      } catch {
        triggerDownload(primaryDownloadSrc, primaryFilename);
      }
    },
    [gridGap, gridSpec, gridTiles, primaryDownloadSrc, primaryFilename, triggerDownload]
  );

  React.useEffect(() => {
    if (!gridSpec) {
      setGridLoading(false);
      setGridTiles((prev) => {
        if (prev?.tiles?.length) {
          for (const t of prev.tiles) URL.revokeObjectURL(t.url);
        }
        return null;
      });
      return;
    }
    if (secondarySrc) return;
    const img = imgRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) return;
    const rows = gridSpec.rows;
    const cols = gridSpec.cols;
    const rects = buildGridRects(img.naturalWidth || 1, img.naturalHeight || 1, rows, cols, gridGap);
    const job = ++gridJobRef.current;
    setGridLoading(true);
    setGridTiles((prev) => {
      if (prev?.tiles?.length) {
        for (const t of prev.tiles) URL.revokeObjectURL(t.url);
      }
      return null;
    });

    const run = async () => {
      const toBlobUrl = async (sx: number, sy: number, sw: number, sh: number) => {
        const w = Math.max(1, Math.floor(sw));
        const h = Math.max(1, Math.floor(sh));
        const draw = async () => {
          if (typeof (globalThis as any).OffscreenCanvas !== "undefined") {
            const c = new (globalThis as any).OffscreenCanvas(w, h) as OffscreenCanvas;
            const ctx = c.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
            if (!ctx) return null;
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
            const blob = await c.convertToBlob({ type: "image/png" }).catch(() => null);
            return blob;
          }
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const ctx = c.getContext("2d");
          if (!ctx) return null;
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
          const blob = await new Promise<Blob | null>((resolve) => c.toBlob((b) => resolve(b), "image/png"));
          return blob;
        };
        const blob = await draw();
        if (!blob) return null;
        return URL.createObjectURL(blob);
      };

      const out: Array<{ r: number; c: number; url: string; filename: string }> = [];

      for (const rect of rects) {
        if (gridJobRef.current !== job) return;
        const url = await toBlobUrl(rect.x, rect.y, rect.w, rect.h);
        if (!url) continue;
        const filename = `crop_${rows}x${cols}_r${rect.row + 1}c${rect.col + 1}.png`;
        out.push({ r: rect.row, c: rect.col, url, filename });
        await new Promise((res) => setTimeout(res, 0));
      }
      if (gridJobRef.current !== job) return;
      setGridTiles({ mode: viewMode, rows, cols, gap: gridGap, tiles: out });
      setGridLoading(false);
    };

    void run().catch(() => {
      if (gridJobRef.current !== job) return;
      setGridLoading(false);
      setGridTiles(null);
    });
  }, [gridGap, gridSpec, secondarySrc, viewMode]);

  React.useEffect(() => {
    return () => {
      setGridTiles((prev) => {
        if (prev?.tiles?.length) {
          for (const t of prev.tiles) URL.revokeObjectURL(t.url);
        }
        return null;
      });
    };
  }, []);

  React.useLayoutEffect(() => {
    updateToolbarPos();
  }, [fitScale, primaryLayer, scale, secondaryLayer, tx, ty, selectedTarget, updateToolbarPos]);

  const onPointerDown = (e: React.PointerEvent) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (e.button !== 0) return;
    e.preventDefault();
    wrap.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    let target: "primary" | "secondary" | null = null;
    const pRect = primaryWrapRef.current?.getBoundingClientRect();
    const sRect = secondaryWrapRef.current?.getBoundingClientRect();
    if (pRect && e.clientX >= pRect.left && e.clientX <= pRect.right && e.clientY >= pRect.top && e.clientY <= pRect.bottom) target = "primary";
    if (
      sRect &&
      e.clientX >= sRect.left &&
      e.clientX <= sRect.right &&
      e.clientY >= sRect.top &&
      e.clientY <= sRect.bottom
    )
      target = "secondary";

    if (!secondarySrc) target = pRect ? "primary" : null;
    setSelectedTarget(target);
    if (!target) setToolbarPos(null);

    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      sceneTx: tx,
      sceneTy: ty,
      primaryTx: primaryLayer.tx,
      primaryTy: primaryLayer.ty,
      secondaryTx: secondaryLayer.tx,
      secondaryTy: secondaryLayer.ty,
      target
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current || !dragStartRef.current) return;
    e.preventDefault();
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    if (secondarySrc && dragStartRef.current.target === "primary") {
      setPrimaryLayer((prev) => ({ ...prev, tx: dragStartRef.current!.primaryTx + dx, ty: dragStartRef.current!.primaryTy + dy }));
      return;
    }
    if (secondarySrc && dragStartRef.current.target === "secondary") {
      setSecondaryLayer((prev) => ({
        ...prev,
        tx: dragStartRef.current!.secondaryTx + dx,
        ty: dragStartRef.current!.secondaryTy + dy
      }));
      return;
    }
    setTx(dragStartRef.current.sceneTx + dx);
    setTy(dragStartRef.current.sceneTy + dy);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (!draggingRef.current) return;
    e.preventDefault();
    draggingRef.current = false;
    dragStartRef.current = null;
    try {
      wrap.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (secondarySrc && selectedTarget) {
      const sceneScale = fitScale * scale;
      const sx = e.clientX - rect.left - rect.width / 2 - tx;
      const sy = e.clientY - rect.top - rect.height / 2 - ty;
      const ux = sceneScale ? sx / sceneScale : sx;
      const uy = sceneScale ? sy / sceneScale : sy;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      if (selectedTarget === "primary") {
        setPrimaryLayer((prev) => {
          const nextScale = clamp(prev.scale * delta, 0.2, 6);
          const ratio = nextScale / prev.scale;
          const px = ux - prev.tx;
          const py = uy - prev.ty;
          return { ...prev, scale: nextScale, tx: prev.tx - px * (ratio - 1), ty: prev.ty - py * (ratio - 1) };
        });
        return;
      }
      if (selectedTarget === "secondary") {
        setSecondaryLayer((prev) => {
          const nextScale = clamp(prev.scale * delta, 0.2, 6);
          const ratio = nextScale / prev.scale;
          const px = ux - prev.tx;
          const py = uy - prev.ty;
          return { ...prev, scale: nextScale, tx: prev.tx - px * (ratio - 1), ty: prev.ty - py * (ratio - 1) };
        });
        return;
      }
    }

    if (e.deltaY < 0) requestOriginal();
    const px = e.clientX - rect.left - rect.width / 2 - tx;
    const py = e.clientY - rect.top - rect.height / 2 - ty;
    const nextOverall = clamp((fitScale * scale) * (e.deltaY > 0 ? 0.9 : 1.1), MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM);
    const nextScale = fitScale ? nextOverall / fitScale : nextOverall;
    const ratio = nextScale / scale;
    setScale(nextScale);
    setTx(tx - px * (ratio - 1));
    setTy(ty - py * (ratio - 1));
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const renderGridOverlay = () => {
    if (!gridSpec) return null;
    return (
      <div className="pointer-events-none absolute inset-0">
        {gridGuideLines.map((line, index) => (
          <div
            key={`${line.type}${index}`}
            className={[
              "absolute bg-black/70 shadow-[0_0_0_1px_rgba(255,255,255,0.55),0_0_6px_rgba(0,0,0,0.45)]",
              line.type === "v" ? "top-0 h-full w-[2px]" : "left-0 h-[2px] w-full"
            ].join(" ")}
            style={line.type === "v" ? { left: line.pos } : { top: line.pos }}
          />
        ))}
        {gridRects.map((rect) => (
          <UiProps key={`${rect.row}_${rect.col}`} ids={{"aria-label":["common.m4673a2306165"],"title":["common.m4673a2306165"]}}><button

            type="button"
            className="pointer-events-auto absolute h-12 w-12 rounded-2xl bg-[var(--panel-bg)]/95 text-[var(--app-fg)] shadow-[var(--shadow-2)] border border-[var(--border)] hover:bg-[var(--panel-2)] transition flex items-center justify-center dark:border-[#d8d8e4] dark:bg-[#f2f2f7] dark:text-[#0e0e18] dark:hover:bg-[#e0e0ea]"
            aria-label="common.m4673a2306165"
            title="common.m4673a2306165"
            style={{
              left: clamp(rect.x + rect.w - 56, rect.x + 4, Math.max(rect.x + 4, primaryNatural.w - 56)),
              top: rect.y + 8,
              transform: `scale(${overlayScale})`,
              transformOrigin: "top right"
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void downloadGridTile(rect.row, rect.col);
            }}
          >
            <Download className="h-8 w-8" />
          </button></UiProps>
        ))}
        {gridLoading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--overlay)]">
            <div className="h-10 w-10 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)]/80 backdrop-blur-xl flex items-center justify-center text-[var(--app-fg)]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div
      ref={wrapRef}
      className={[
        "relative h-full w-full overflow-hidden select-none bg-[var(--input-bg)]",
        draggingRef.current ? "cursor-grabbing" : "cursor-grab",
        className || ""
      ].join(" ")}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      {allowGridSplit && selectedTarget ? (
        <div
          ref={toolbarRef}
          className="absolute z-10 rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-1.5 py-1.5 flex items-center gap-1 shadow-[var(--shadow-2)]"
          style={{ left: toolbarPos?.left ?? 12, top: toolbarPos?.top ?? 12 }}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <div className="relative">
            <div className="flex items-center gap-1">
              <UiProps ids={{"title":["common.m4495f2311546","common.m7902a782e7c1"]}}><button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (secondarySrc) return;
                setGridMenuOpen((prev) => !prev);
                setCustomGridOpen(false);
              }}
              disabled={Boolean(secondarySrc)}
              className={[
                "h-9 rounded-xl transition flex items-center justify-center gap-2 px-3",
                viewMode !== "single"
                  ? "bg-[var(--panel-3)] text-[var(--app-fg)]"
                  : "bg-[var(--panel-2)] text-[var(--app-muted)] hover:text-[var(--app-fg)] hover:bg-[var(--panel-3)]",
                secondarySrc ? "opacity-40 pointer-events-none" : ""
              ].join(" ")}
              title={secondarySrc ? "common.m4495f2311546" : "common.m7902a782e7c1"}
            >
              <Grid3X3 className="h-4 w-4" />
              <span className="text-xs"><UiText id="common.m7902a782e7c1" /></span>
              <ChevronDown className={["h-3.5 w-3.5 transition", gridMenuOpen ? "rotate-180" : ""].join(" ")} />
              </button></UiProps>
              {viewMode !== "single" ? (
                <UiProps ids={{"title":["common.m3c9fa235d4b1"]}}><button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setViewMode("single");
                    setGridMenuOpen(false);
                    setCustomGridOpen(false);
                  }}
                  className="h-9 rounded-xl bg-rose-500/10 px-3 text-[var(--app-fg)] transition hover:bg-rose-500/15 border border-rose-500/20 flex items-center justify-center gap-1.5"
                  title="common.m3c9fa235d4b1"
                >
                  <X className="h-3.5 w-3.5" />
                  <span className="text-xs"><UiText id="common.m131cb1c79feb" /></span>
                </button></UiProps>
              ) : null}
            </div>

            {gridMenuOpen ? (
              <div className="absolute left-0 top-full z-20 mt-2 min-w-[620px] rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] p-2 shadow-[var(--shadow-2)] dark:bg-[#262626]">
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel-2)]/55 p-2 text-xs text-[var(--app-muted)]">
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode("custom");
                      setCustomGridOpen(false);
                    }}
                    className={[
                      "h-9 rounded-full border px-3 font-semibold transition",
                      !customGridOpen
                        ? "border-[var(--app-fg)]/20 bg-[var(--app-fg)] text-[var(--panel-bg)] dark:text-[#262626]"
                        : "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] hover:bg-[var(--panel-3)]"
                    ].join(" ")}
                  ><UiText id="common.m7902a782e7c1" /></button>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomGridOpen((prev) => !prev);
                      setViewMode("custom");
                    }}
                    className={[
                      "h-9 rounded-full border px-3 font-semibold transition",
                      customGridOpen
                        ? "border-[var(--app-fg)]/20 bg-[var(--app-fg)] text-[var(--panel-bg)] dark:text-[#262626]"
                        : "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] hover:bg-[var(--panel-3)]"
                    ].join(" ")}
                  ><UiText id="common.m4eafa9e925b3" /></button>
                  <span className="ml-1 text-[11px]"><UiText id="common.mf1de1e2621de" /></span>
                  {GRID_PRESETS.map(([presetRows, presetCols]) => {
                    const active = viewMode === "custom" && customRows === presetRows && customCols === presetCols;
                    return (
                      <button
                        key={`${presetRows}x${presetCols}`}
                        type="button"
                        onClick={() => {
                          setCustomRows(presetRows);
                          setCustomCols(presetCols);
                          setViewMode("custom");
                          setCustomGridOpen(false);
                        }}
                        className={[
                          "h-8 rounded-full border px-3 font-semibold transition",
                          active
                            ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                            : "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] hover:bg-[var(--panel-3)]"
                        ].join(" ")}
                      >
                        {presetRows}×{presetCols}
                      </button>
                    );
                  })}
                  <label className="ml-1 flex items-center gap-1 text-[var(--app-fg)]">
                    <span><UiText id="common.mefdbcb13014e" /></span>
                    <input
                      type="number"
                      min={0}
                      max={GRID_LINE_MAX}
                      value={Math.max(0, customRows - 1)}
                      onChange={(e) => {
                        setCustomRows(clamp(Math.round(Number(e.target.value) || 0), 0, GRID_LINE_MAX) + 1);
                        setViewMode("custom");
                        setCustomGridOpen(true);
                      }}
                      className="h-8 w-16 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2 text-[var(--app-fg)] outline-none"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-[var(--app-fg)]">
                    <span><UiText id="common.m30fe8742e4ef" /></span>
                    <input
                      type="number"
                      min={0}
                      max={GRID_LINE_MAX}
                      value={Math.max(0, customCols - 1)}
                      onChange={(e) => {
                        setCustomCols(clamp(Math.round(Number(e.target.value) || 0), 0, GRID_LINE_MAX) + 1);
                        setViewMode("custom");
                        setCustomGridOpen(true);
                      }}
                      className="h-8 w-16 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-2 text-[var(--app-fg)] outline-none"
                    />
                  </label>
                  <label className="flex min-w-[220px] flex-1 items-center gap-2 text-[var(--app-fg)]">
                    <span><UiText id="common.m1b0a7572eb4d" /></span>
                    <input
                      type="range"
                      min={0}
                      max={GRID_GAP_MAX}
                      step={1}
                      value={gridGap}
                      onChange={(e) => {
                        setGridGap(clamp(Math.round(Number(e.target.value) || 0), 0, GRID_GAP_MAX));
                        setViewMode("custom");
                      }}
                      className="min-w-24 flex-1"
                    />
                    <span className="min-w-10 rounded-full bg-[var(--panel-bg)] px-2 py-1 text-center font-semibold text-[var(--app-fg)]">{gridGap}</span>
                  </label>
                  <span className="whitespace-nowrap rounded-full bg-[var(--panel-bg)] px-3 py-1.5 text-[var(--app-fg)]"><UiText id="common.mef4d9a9781be" />{gridSpec ? gridRects.length : customRows * customCols}<UiText id="common.me9e0fdc242b4" /></span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {!primaryReady && preview ? (
        <div data-canvas-image-preview className="pointer-events-none absolute inset-0 py-7">
          {preview}
        </div>
      ) : null}

      {primaryReady || preview || (!primaryFailed && !showLoadingIndicator) ? null : (
        <div
          data-canvas-image-loading="true"
          className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-[var(--app-muted)]"
          role="status"
          aria-live="polite"
        >
          {primaryFailed ? (
            <span className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)]/80 px-3 py-2 text-xs shadow-[var(--shadow-2)] backdrop-blur-sm"><UiText id="common.md41b4607b05c" /></span>
          ) : (
            <>
              <Loader2 className="h-5 w-5 animate-spin text-[var(--primary-bg)]" aria-hidden="true" />
              <span className="text-xs"><UiText id="common.mf304d7c01963" /></span>
            </>
          )}
        </div>
      )}

      <div
        className="absolute right-3 bottom-3 z-20"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)]/80 backdrop-blur-xl shadow-[var(--shadow-2)] p-1 flex items-center gap-1">
          <UiProps ids={{"aria-label":["common.m290f68030501"]}}><button
            type="button"
            onClick={() => zoomBy(1 / 1.1)}
            className="h-9 w-9 rounded-xl bg-[var(--panel-2)]/80 text-[var(--app-muted)] hover:text-[var(--app-fg)] hover:bg-[var(--panel-3)] transition flex items-center justify-center"
            aria-label="common.m290f68030501"
          >
            <Minus className="h-4 w-4" />
          </button></UiProps>
          <div className="h-9 px-2.5 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] text-xs text-[var(--app-fg)] flex items-center min-w-[64px] justify-center">
            {zoomDisplay}%
          </div>
          <UiProps ids={{"aria-label":["common.m80f8fbcfa011"]}}><button
            type="button"
            onClick={() => zoomBy(1.1)}
            className="h-9 w-9 rounded-xl bg-[var(--panel-2)]/80 text-[var(--app-muted)] hover:text-[var(--app-fg)] hover:bg-[var(--panel-3)] transition flex items-center justify-center"
            aria-label="common.m80f8fbcfa011"
          >
            <Plus className="h-4 w-4" />
          </button></UiProps>
          <UiProps ids={{"aria-label":["common.m72891f7a3b1e"]}}><button
            type="button"
            onClick={fitView}
            className="h-9 w-9 rounded-xl bg-[var(--panel-2)]/80 text-[var(--app-muted)] hover:text-[var(--app-fg)] hover:bg-[var(--panel-3)] transition flex items-center justify-center"
            aria-label="common.m72891f7a3b1e"
          >
            <RotateCcw className="h-4 w-4" />
          </button></UiProps>
        </div>
      </div>

      <div
        className={[
          "absolute inset-0 flex items-center",
          "justify-center"
        ].join(" ")}
      >
        <div
          ref={transformedRef}
          className={[
            preview ? "" : "transition-opacity duration-150",
            primaryReady ? "opacity-100" : "pointer-events-none opacity-0"
          ].join(" ")}
          style={{ transform: `translate3d(${tx}px, ${ty}px, 0) scale(${fitScale * scale})` }}
        >
          {secondarySrc ? (
            <div className="relative">
              <div
                ref={secondaryWrapRef}
                style={{ transform: `translate3d(${secondaryLayer.tx}px, ${secondaryLayer.ty}px, 0) scale(${secondaryLayer.scale})` }}
                className="relative inline-block"
              >
                <ImageResolution
                  src={secondarySrc}
                  className="absolute bottom-full right-0 pb-2"
                  style={{ transform: `scale(${overlayScale / secondaryLayer.scale})`, transformOrigin: "bottom right" }}
                />
                <img
                  ref={img2Ref}
                  src={secondaryRenderSrc}
                  alt=""
                  draggable={false}
                  onLoad={onSecondaryLoad}
                  onError={() => {
                    // 代理异常时回退原地址，保证右侧预览不空白。
                    if (secondarySrc && secondaryRenderSrc !== secondarySrc) setSecondaryRenderSrc(secondarySrc);
                  }}
                  className="max-w-none max-h-none pointer-events-none"
                />
              </div>
              <div
                ref={primaryWrapRef}
                style={{ transform: `translate3d(${primaryLayer.tx}px, ${primaryLayer.ty}px, 0) scale(${primaryLayer.scale})` }}
                className="group relative inline-block"
              >
                <ImageResolution
                  src={originalSrc || primaryDownloadSrc}
                  dimensions={dimensions}
                  className="absolute bottom-full right-0 pb-2"
                  style={{ transform: `scale(${overlayScale / primaryLayer.scale})`, transformOrigin: "bottom right" }}
                />
                <img
                  ref={imgRef}
                  src={primaryRenderSrc}
                  alt={alt || ""}
                  draggable={false}
                  onLoad={onPrimaryLoad}
                  onError={onPrimaryError}
                  style={showingOriginal ? { width: primaryNatural.w, height: primaryNatural.h } : undefined}
                  className="max-w-none max-h-none pointer-events-none"
                />
                {primaryReady && !gridSpec ? (
                  <UiProps ids={{"aria-label":["common.m4673a2306165"],"title":["common.m4673a2306165"]}}><button
                    type="button"
                    className="pointer-events-none absolute right-1.5 top-1.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md bg-black/45 text-white/80 opacity-0 transition-opacity hover:text-white focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
                    aria-label="common.m4673a2306165"
                    title="common.m4673a2306165"
                    style={{ transform: `scale(${overlayScale})`, transformOrigin: "top right" }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      triggerDownload(primaryDownloadSrc, primaryFilename);
                    }}
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  </button></UiProps>
                ) : null}
                {renderGridOverlay()}
              </div>
            </div>
          ) : (
            <div
              ref={primaryWrapRef}
              className="group relative inline-block"
            >
              <ImageResolution
                src={originalSrc || primaryDownloadSrc}
                dimensions={dimensions}
                className="absolute bottom-full right-0 pb-2"
                style={{ transform: `scale(${overlayScale})`, transformOrigin: "bottom right" }}
              />
              <img
                ref={imgRef}
                src={primaryRenderSrc}
                alt={alt || ""}
                draggable={false}
                onLoad={onPrimaryLoad}
                onError={onPrimaryError}
                style={showingOriginal ? { width: primaryNatural.w, height: primaryNatural.h } : undefined}
                className="max-w-none max-h-none pointer-events-none"
              />
              {primaryReady && !gridSpec ? (
                <UiProps ids={{"aria-label":["common.m4673a2306165"],"title":["common.m4673a2306165"]}}><button
                  type="button"
                  className="pointer-events-none absolute right-1.5 top-1.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md bg-black/45 text-white/80 opacity-0 transition-opacity hover:text-white focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
                  aria-label="common.m4673a2306165"
                  title="common.m4673a2306165"
                  style={{ transform: `scale(${overlayScale})`, transformOrigin: "top right" }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    triggerDownload(primaryDownloadSrc, primaryFilename);
                  }}
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                </button></UiProps>
              ) : null}
              {renderGridOverlay()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
