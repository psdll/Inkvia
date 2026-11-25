"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { createPortal } from "react-dom";
import { Brush, Eraser, RotateCcw, Trash2, X } from "lucide-react";

type Point = { x: number; y: number };
type Stroke = { tool: "brush" | "eraser"; color: string; size: number; points: Point[] };
const BRUSH_MIN = 4;
const BRUSH_MAX = 180;
const TRANSPARENT_BLUE = "rgba(59,130,246,0.35)";

export type ImagePaintEditorProps = {
  open: boolean;
  src: string | null;
  title?: string;
  onClose: () => void;
  onApply: (file: File) => void;
  canRestoreOriginal?: boolean;
  onRestoreOriginal?: () => void;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function fitSize(width: number, height: number, maxW: number, maxH: number) {
  if (!width || !height) return { width: maxW, height: maxH };
  const ratio = Math.min(maxW / width, maxH / height, 1);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio))
  };
}

function resolveCanvasSafeImageSrc(raw: string) {
  const src = String(raw || "").trim();
  if (!src) return "";
  if (src.startsWith("/") || src.startsWith("blob:") || src.startsWith("data:")) return src;
  if (typeof window === "undefined") return src;
  try {
    const parsed = new URL(src, window.location.origin);
    if (parsed.origin === window.location.origin) return parsed.toString();
    return `/api/media-proxy?url=${encodeURIComponent(parsed.toString())}`;
  } catch {
    return src;
  }
}

export function ImagePaintEditor({
  open,
  src,
  title,
  onClose,
  onApply,
  canRestoreOriginal = false,
  onRestoreOriginal
}: ImagePaintEditorProps) {
  const { error: localizeError } = useUiLocale();
  const [mounted, setMounted] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [color, setColor] = React.useState("#ff3b30");
  const [useTransparentBlue, setUseTransparentBlue] = React.useState(false);
  const [size, setSize] = React.useState(22);
  const [activeTool, setActiveTool] = React.useState<"brush" | "eraser" | null>(null);
  const [strokes, setStrokes] = React.useState<Stroke[]>([]);
  const [drawing, setDrawing] = React.useState(false);
  const [panning, setPanning] = React.useState(false);
  const [canvasSize, setCanvasSize] = React.useState({ width: 0, height: 0 });
  const [viewScale, setViewScale] = React.useState(1);
  const [viewTx, setViewTx] = React.useState(0);
  const [viewTy, setViewTy] = React.useState(0);
  const [entered, setEntered] = React.useState(false);
  const [brushCursor, setBrushCursor] = React.useState<{ x: number; y: number; visible: boolean }>({
    x: 0,
    y: 0,
    visible: false
  });

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const imageRef = React.useRef<HTMLImageElement | null>(null);
  const currentStrokeRef = React.useRef<Stroke | null>(null);
  const panRef = React.useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  React.useEffect(() => setMounted(true), []);

  const changeBrushSize = React.useCallback(
    (nextRaw: number) => {
      const next = clamp(Math.round(nextRaw), BRUSH_MIN, BRUSH_MAX);
      setSize(next);
    },
    []
  );

  const drawScene = React.useCallback(
    (allStrokes: Stroke[], activeStroke: Stroke | null = null) => {
      const canvas = canvasRef.current;
      const image = imageRef.current;
      if (!canvas || !image) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      const overlay = document.createElement("canvas");
      overlay.width = canvas.width;
      overlay.height = canvas.height;
      const octx = overlay.getContext("2d");
      if (!octx) return;

      const renderStroke = (target: CanvasRenderingContext2D, stroke: Stroke, scaleX = 1, scaleY = 1) => {
        if (!stroke.points.length) return;
        target.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
        target.strokeStyle = stroke.tool === "eraser" ? "rgba(0,0,0,1)" : stroke.color;
        target.lineCap = "round";
        target.lineJoin = "round";
        target.lineWidth = Math.max(1, stroke.size * ((scaleX + scaleY) / 2));
        target.beginPath();
        target.moveTo(stroke.points[0]!.x * scaleX, stroke.points[0]!.y * scaleY);
        for (let i = 1; i < stroke.points.length; i += 1) {
          const p = stroke.points[i]!;
          target.lineTo(p.x * scaleX, p.y * scaleY);
        }
        target.stroke();
      };

      for (const s of allStrokes) renderStroke(octx, s);
      if (activeStroke) renderStroke(octx, activeStroke);
      octx.globalCompositeOperation = "source-over";
      ctx.drawImage(overlay, 0, 0);
    },
    []
  );

  React.useEffect(() => {
    if (!open || !src) return;
    setError(null);
    setLoading(true);
    setActiveTool(null);
    setUseTransparentBlue(false);
    setStrokes([]);
    setDrawing(false);
    setPanning(false);
    setViewScale(1);
    setViewTx(0);
    setViewTy(0);
    setBrushCursor({ x: 0, y: 0, visible: false });
    currentStrokeRef.current = null;
    panRef.current = null;

    let cancelled = false;
    const image = new Image();
    image.decoding = "async";

    const finish = () => {
      if (cancelled) return;
      imageRef.current = image;
      const maxW = Math.max(420, window.innerWidth - 96);
      const maxH = Math.max(280, window.innerHeight - 210);
      const fitted = fitSize(image.naturalWidth || image.width, image.naturalHeight || image.height, maxW, maxH);
      setCanvasSize(fitted);
      setLoading(false);
    };

    const assignAndLoad = (url: string) => {
      image.onload = finish;
      image.onerror = () => {
        if (!cancelled) {
          setError("图片加载失败，暂时无法涂抹编辑");
          setLoading(false);
        }
      };
      image.src = url;
    };
    assignAndLoad(resolveCanvasSafeImageSrc(src));

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [open, src]);

  React.useEffect(() => {
    if (activeTool) return;
    setBrushCursor((prev) => ({ ...prev, visible: false }));
  }, [activeTool]);

  React.useEffect(() => {
    if (!open) return;
    setEntered(false);
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  React.useEffect(() => {
    if (!open || loading) return;
    drawScene(strokes, currentStrokeRef.current);
  }, [drawScene, loading, open, strokes, canvasSize.width, canvasSize.height]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / Math.max(0.01, viewScale), 0, canvas.width);
    const y = clamp((e.clientY - rect.top) / Math.max(0.01, viewScale), 0, canvas.height);
    return { x, y };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (loading || saving) return;
    const viewport = viewportRef.current;
    if (viewport) {
      const rect = viewport.getBoundingClientRect();
      setBrushCursor({
        x: clamp(e.clientX - rect.left, 0, rect.width),
        y: clamp(e.clientY - rect.top, 0, rect.height),
        visible: Boolean(activeTool)
      });
    }
    if (!activeTool) {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      setPanning(true);
      panRef.current = { x: e.clientX, y: e.clientY, tx: viewTx, ty: viewTy };
      return;
    }
    const p = pointFromEvent(e);
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrawing(true);
    const strokeColor = useTransparentBlue ? TRANSPARENT_BLUE : color;
    currentStrokeRef.current = { tool: activeTool, color: strokeColor, size, points: [p, p] };
    drawScene(strokes, currentStrokeRef.current);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const viewport = viewportRef.current;
    if (viewport && activeTool) {
      const rect = viewport.getBoundingClientRect();
      setBrushCursor({
        x: clamp(e.clientX - rect.left, 0, rect.width),
        y: clamp(e.clientY - rect.top, 0, rect.height),
        visible: true
      });
    }
    if (!activeTool && panning && panRef.current) {
      e.preventDefault();
      e.stopPropagation();
      const dx = e.clientX - panRef.current.x;
      const dy = e.clientY - panRef.current.y;
      setViewTx(panRef.current.tx + dx);
      setViewTy(panRef.current.ty + dy);
      return;
    }
    if (!drawing || !currentStrokeRef.current) return;
    const p = pointFromEvent(e);
    if (!p) return;
    currentStrokeRef.current.points.push(p);
    drawScene(strokes, currentStrokeRef.current);
  };

  const finishStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeTool && panning) {
      e.preventDefault();
      e.stopPropagation();
      setPanning(false);
      panRef.current = null;
      return;
    }
    if (!drawing) return;
    e.preventDefault();
    e.stopPropagation();
    setDrawing(false);
    const current = currentStrokeRef.current;
    if (!current || current.points.length < 2) {
      currentStrokeRef.current = null;
      drawScene(strokes, null);
      return;
    }
    currentStrokeRef.current = null;
    setStrokes((prev) => [...prev, current]);
  };

  const clearStrokes = () => setStrokes([]);
  const undoStroke = () => setStrokes((prev) => prev.slice(0, -1));

  const applyPaint = async () => {
    if (!imageRef.current || !canvasSize.width || !canvasSize.height) return;
    setSaving(true);
    setError(null);
    try {
      const base = imageRef.current;
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = base.naturalWidth || base.width;
      exportCanvas.height = base.naturalHeight || base.height;
      const ctx = exportCanvas.getContext("2d");
      if (!ctx) throw new Error("无法导出编辑结果");

      ctx.drawImage(base, 0, 0, exportCanvas.width, exportCanvas.height);
      const scaleX = exportCanvas.width / canvasSize.width;
      const scaleY = exportCanvas.height / canvasSize.height;

      const overlay = document.createElement("canvas");
      overlay.width = exportCanvas.width;
      overlay.height = exportCanvas.height;
      const octx = overlay.getContext("2d");
      if (!octx) throw new Error("无法导出编辑结果");

      for (const s of strokes) {
        if (!s.points.length) continue;
        octx.globalCompositeOperation = s.tool === "eraser" ? "destination-out" : "source-over";
        octx.strokeStyle = s.tool === "eraser" ? "rgba(0,0,0,1)" : s.color;
        octx.lineCap = "round";
        octx.lineJoin = "round";
        octx.lineWidth = Math.max(1, s.size * ((scaleX + scaleY) / 2));
        octx.beginPath();
        octx.moveTo(s.points[0]!.x * scaleX, s.points[0]!.y * scaleY);
        for (let i = 1; i < s.points.length; i += 1) {
          const p = s.points[i]!;
          octx.lineTo(p.x * scaleX, p.y * scaleY);
        }
        octx.stroke();
      }
      octx.globalCompositeOperation = "source-over";
      ctx.drawImage(overlay, 0, 0);

      const blob = await new Promise<Blob>((resolve, reject) => {
        exportCanvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("导出失败，请重试"))),
          "image/png",
          1
        );
      });
      const file = new File([blob], `painted-${Date.now()}.png`, { type: "image/png" });
      onApply(file);
    } catch (e: any) {
      setError(String(e?.message || "保存涂抹结果失败"));
    } finally {
      setSaving(false);
    }
  };

  const modal =
    open && src ? (
      <div className="fixed inset-0 z-[130]">
        <div
          className={[
            "absolute inset-0 bg-[var(--overlay)] transition-opacity duration-200",
            entered ? "opacity-100" : "opacity-0"
          ].join(" ")}
          onClick={onClose}
        />
        <div className="absolute inset-0 p-4 lg:p-6 flex items-center justify-center">
          <div
            className={[
              "solid-panel-surface w-full max-w-[1200px] max-h-[calc(100dvh-2rem)] rounded-[24px] border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)] overflow-hidden transition-all duration-200",
              entered ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
            ].join(" ")}
          >
            <div className="h-[56px] px-4 flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--panel-2)]">
              <div className="min-w-0 truncate text-sm font-semibold text-[var(--app-fg)]">
                {title || <UiText id="common.m714a92f6b37e" />}
              </div>
              <UiProps ids={{"aria-label":["common.m3fd47edce45b"]}}><button
                type="button"
                onClick={onClose}
                className="h-9 w-9 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] transition flex items-center justify-center"
                aria-label="common.m3fd47edce45b"
              >
                <X className="h-4 w-4" />
              </button></UiProps>
            </div>
            <div className="p-3 border-b border-[var(--border)] bg-[var(--panel-bg)] flex flex-wrap items-center gap-1.5">
              <div className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-0.5">
                <button
                  type="button"
                  onClick={() => setActiveTool((prev) => (prev === "brush" ? null : "brush"))}
                  className={[
                    "h-7 px-2.5 rounded-md text-[11px] inline-flex items-center gap-1 border transition",
                    activeTool === "brush"
                      ? "bg-blue-500/12 text-blue-700 border border-blue-500/30"
                      : "text-[var(--app-muted)] border-transparent hover:text-[var(--app-fg)]"
                  ].join(" ")}
                >
                  <Brush className="h-3 w-3" /><UiText id="common.m1b1433027862" /></button>
                <button
                  type="button"
                  onClick={() => setActiveTool((prev) => (prev === "eraser" ? null : "eraser"))}
                  className={[
                    "h-7 px-2.5 rounded-md text-[11px] inline-flex items-center gap-1 border transition",
                    activeTool === "eraser"
                      ? "bg-blue-500/12 text-blue-700 border border-blue-500/30"
                      : "text-[var(--app-muted)] border-transparent hover:text-[var(--app-fg)]"
                  ].join(" ")}
                >
                  <Eraser className="h-3 w-3" /><UiText id="common.m05cf56410be3" /></button>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2 py-1.5 bg-[var(--panel-2)]">
                <Brush className="h-3.5 w-3.5 text-[var(--app-muted)]" />
                <span className="text-[11px] text-[var(--app-muted)]"><UiText id="common.m070a8016fcc3" /></span>
                <input
                  type="color"
                  value={color}
                  onChange={(e) => {
                    setColor(e.target.value);
                    setUseTransparentBlue(false);
                  }}
                  disabled={!activeTool || activeTool === "eraser"}
                  className="h-6 w-8 cursor-pointer rounded border border-[var(--border)] bg-[var(--panel-bg)]"
                />
                <button
                  type="button"
                  onClick={() => setUseTransparentBlue((v) => !v)}
                  disabled={!activeTool || activeTool === "eraser"}
                  className={[
                    "h-6 px-2 rounded border text-[10px] transition",
                    useTransparentBlue
                      ? "border-blue-500/50 bg-blue-500/15 text-blue-700"
                      : "border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-muted)] hover:text-[var(--app-fg)]"
                  ].join(" ")}
                ><UiText id="common.m2fc3f394a011" /></button>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2 py-1.5 bg-[var(--panel-2)]">
                <span className="text-[11px] text-[var(--app-muted)]">{activeTool === "eraser" ? <UiText id="common.m05cf56410be3" /> : <UiText id="common.m1b1433027862" />}</span>
                <input
                  type="range"
                  min={BRUSH_MIN}
                  max={BRUSH_MAX}
                  value={size}
                  onChange={(e) => changeBrushSize(Number(e.target.value) || 4)}
                  disabled={!activeTool}
                />
                <span className="text-[11px] text-[var(--app-fg)] w-8 text-right">{size}</span>
              </div>
              <div className="text-[11px] text-[var(--app-muted)] px-2 py-1 rounded-lg border border-[var(--border)] bg-[var(--panel-2)]">
                {activeTool ? <UiText id="common.mfbe64b655c26" /> : <UiText id="common.m5cd838fd87f7" />}
              </div>
              <button
                type="button"
                onClick={undoStroke}
                disabled={!strokes.length || saving}
                className="h-8 px-2.5 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[11px] text-[var(--app-fg)] hover:bg-[var(--panel-2)] disabled:opacity-50 disabled:pointer-events-none transition inline-flex items-center gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" /><UiText id="common.m926a50b98ece" /></button>
              <button
                type="button"
                onClick={clearStrokes}
                disabled={!strokes.length || saving}
                className="h-8 px-2.5 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[11px] text-[var(--app-fg)] hover:bg-[var(--panel-2)] disabled:opacity-50 disabled:pointer-events-none transition inline-flex items-center gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" /><UiText id="common.m1ef3de06b32e" /></button>
              <button
                type="button"
                onClick={() => {
                  if (!canRestoreOriginal || !onRestoreOriginal) return;
                  setStrokes([]);
                  setActiveTool(null);
                  setViewScale(1);
                  setViewTx(0);
                  setViewTy(0);
                  onRestoreOriginal();
                }}
                disabled={!canRestoreOriginal || saving || loading}
                className="h-8 px-2.5 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[11px] text-[var(--app-fg)] hover:bg-[var(--panel-2)] disabled:opacity-50 disabled:pointer-events-none transition inline-flex items-center gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" /><UiText id="common.me0534b8a4e46" /></button>
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setViewScale(1);
                    setViewTx(0);
                    setViewTy(0);
                  }}
                  disabled={saving}
                  className="h-8 px-2.5 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[11px] text-[var(--app-fg)] hover:bg-[var(--panel-2)] disabled:opacity-50 disabled:pointer-events-none transition"
                ><UiText id="common.mcb5d682bac3d" /></button>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  className="h-8 px-2.5 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[11px] text-[var(--app-fg)] hover:bg-[var(--panel-2)] disabled:opacity-50 disabled:pointer-events-none transition"
                ><UiText id="common.m2cd0f3be8738" /></button>
                <button
                  type="button"
                  onClick={() => void applyPaint()}
                  disabled={loading || saving}
                  className="h-8 px-2.5 rounded-lg bg-[var(--primary-bg)] text-[var(--primary-fg)] text-[11px] font-medium hover:bg-[var(--primary-hover)] disabled:opacity-50 disabled:pointer-events-none transition"
                >
                  {saving ? <UiText id="common.m917b1c1f18d0" /> : <UiText id="common.m4012b6acea5c" />}
                </button>
              </div>
            </div>
            <div className="relative p-4 bg-[var(--input-bg)] min-h-[320px] flex items-center justify-center overflow-hidden">
              {loading ? (
                <div className="text-sm text-[var(--app-muted)]"><UiText id="common.m6516c79bcbb9" /></div>
              ) : error ? (
                <div className="text-sm text-rose-700">{localizeError(error)}</div>
              ) : (
                <div
                  ref={viewportRef}
                  className="relative overflow-visible rounded-lg"
                  style={{ width: `${canvasSize.width}px`, height: `${canvasSize.height}px` }}
                >
                  <canvas
                    ref={canvasRef}
                    width={canvasSize.width}
                    height={canvasSize.height}
                    className={[
                      "absolute left-0 top-0 touch-none",
                      activeTool ? "cursor-none" : panning ? "cursor-grabbing" : "cursor-grab"
                    ].join(" ")}
                    style={{
                      transform: `translate(${viewTx}px, ${viewTy}px) scale(${viewScale})`,
                      transformOrigin: "0 0"
                    }}
                    onPointerEnter={(e) => {
                      if (!activeTool) return;
                      const viewport = viewportRef.current;
                      if (!viewport) return;
                      const rect = viewport.getBoundingClientRect();
                      setBrushCursor({
                        x: clamp(e.clientX - rect.left, 0, rect.width),
                        y: clamp(e.clientY - rect.top, 0, rect.height),
                        visible: true
                      });
                    }}
                    onWheel={(e) => {
                      if (activeTool && e.ctrlKey) {
                        e.preventDefault();
                        e.stopPropagation();
                        const direction = e.deltaY < 0 ? 1 : -1;
                        const step = e.shiftKey ? 6 : 3;
                        changeBrushSize(size + direction * step);
                        return;
                      }
                      if (activeTool) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const viewport = viewportRef.current;
                      if (!viewport) return;
                      const rect = viewport.getBoundingClientRect();
                      const x = clamp(e.clientX - rect.left, 0, rect.width);
                      const y = clamp(e.clientY - rect.top, 0, rect.height);
                      const currentScale = viewScale;
                      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.91;
                      const nextScale = clamp(currentScale * zoomFactor, 0.35, 5);
                      const imgX = (x - viewTx) / currentScale;
                      const imgY = (y - viewTy) / currentScale;
                      const nextTx = x - imgX * nextScale;
                      const nextTy = y - imgY * nextScale;
                      setViewScale(nextScale);
                      setViewTx(nextTx);
                      setViewTy(nextTy);
                    }}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={finishStroke}
                    onPointerLeave={(e) => {
                      finishStroke(e);
                      setBrushCursor((prev) => ({ ...prev, visible: false }));
                    }}
                    onPointerCancel={(e) => {
                      finishStroke(e);
                      setBrushCursor((prev) => ({ ...prev, visible: false }));
                    }}
                  />
                  {activeTool && brushCursor.visible ? (
                    <div
                      className={[
                        "pointer-events-none absolute z-20 rounded-full shadow-[0_0_0_1px_rgba(255,255,255,0.35)_inset]",
                        activeTool === "eraser"
                          ? "border border-white/90 bg-white/10 border-dashed"
                          : "border border-blue-500/85 bg-blue-400/15"
                      ].join(" ")}
                      style={{
                        left: `${brushCursor.x}px`,
                        top: `${brushCursor.y}px`,
                        width: `${Math.max(6, Math.round(size * viewScale))}px`,
                        height: `${Math.max(6, Math.round(size * viewScale))}px`,
                        transform: "translate(-50%, -50%)"
                      }}
                    />
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    ) : null;

  if (!mounted) return null;
  return modal ? createPortal(modal, document.body) : null;
}
