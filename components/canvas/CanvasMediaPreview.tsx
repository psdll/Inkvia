"use client";
import { UiProps } from "@/i18n/ui";


import * as React from "react";
import { ChevronLeft, ChevronRight, Minus, Music2, Plus, X } from "lucide-react";
import { AppVideoPlayer } from "@/components/ui/app-video-player";

export type CanvasPreviewItem = {
  id: string;
  url: string;
  kind: "image" | "video" | "audio";
  name?: string;
  prompt?: string;
  model?: string;
  sourceNodeId?: string;
  batchId?: string;
  outputId?: string;
};

type Props = {
  items: CanvasPreviewItem[];
  initialIndex?: number;
  onClose: () => void;
  onEdit?: (item: CanvasPreviewItem) => void;
  onSave?: (item: CanvasPreviewItem) => void;
  onRerun?: (item: CanvasPreviewItem) => void;
};

export default function CanvasMediaPreview({ items, initialIndex = 0, onClose }: Props) {
  const [index, setIndex] = React.useState(Math.min(Math.max(initialIndex, 0), Math.max(0, items.length - 1)));
  const current = items[index];
  const [imageScale, setImageScale] = React.useState(1);
  const [imageOffset, setImageOffset] = React.useState({ x: 0, y: 0 });
  const imageDragRef = React.useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const previewVideoRef = React.useRef<HTMLVideoElement | null>(null);

  const changeItem = React.useCallback((direction: number) => {
    if (items.length < 2) return;
    setIndex((value) => (value + direction + items.length) % items.length);
  }, [items.length]);

  const updateImageScale = React.useCallback((nextScale: number) => {
    const clampedScale = Math.min(4, Math.max(1, nextScale));
    setImageScale(clampedScale);
    if (clampedScale === 1) setImageOffset({ x: 0, y: 0 });
  }, []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") onClose();
      const target = event.target;
      if (target instanceof Element && target.closest("input,textarea,[contenteditable='true'],audio,[data-app-video-player]")) return;
      if (items.length > 1 && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        event.stopPropagation();
        changeItem(event.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (current?.kind !== "image") return;
      if (event.key === "+" || event.key === "=") updateImageScale(imageScale + 0.25);
      if (event.key === "-") updateImageScale(imageScale - 0.25);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [changeItem, current?.kind, imageScale, items.length, onClose, updateImageScale]);

  React.useEffect(() => {
    setImageScale(1);
    setImageOffset({ x: 0, y: 0 });
    imageDragRef.current = null;
  }, [current?.id, current?.url]);

  React.useEffect(() => {
    if (current?.kind !== "video") return;
    const video = previewVideoRef.current;
    if (!video) return;
    let cancelled = false;

    const startPreviewPlayback = async () => {
      video.currentTime = 0;
      try {
        await video.play();
      } catch {
        if (cancelled) return;
        video.muted = true;
        try {
          await video.play();
        } catch {
          // Keep the player visible so the user can still start it manually.
        }
      }
    };

    void startPreviewPlayback();
    return () => {
      cancelled = true;
      video.pause();
    };
  }, [current?.kind, current?.url]);

  if (!current) return null;

  const resetImageView = () => {
    setImageScale(1);
    setImageOffset({ x: 0, y: 0 });
    imageDragRef.current = null;
  };

  const handleImageWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (current.kind !== "image") return;
    if (event.target instanceof Element && event.target.closest("button")) return;
    event.preventDefault();
    updateImageScale(imageScale + (event.deltaY < 0 ? 0.25 : -0.25));
  };

  const startImageDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (current.kind !== "image" || imageScale === 1 || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    imageDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: imageOffset.x,
      originY: imageOffset.y,
    };
  };

  const moveImage = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = imageDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setImageOffset({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    });
  };

  const stopImageDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (imageDragRef.current?.pointerId !== event.pointerId) return;
    imageDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const title = current.name || (current.kind === "video" ? "视频预览" : current.kind === "audio" ? "音频预览" : "图片预览");

  return (
    <div data-canvas-media-preview className="fixed inset-0 z-[240] flex flex-col bg-black">
      <header className="flex h-[68px] shrink-0 items-center border-b border-white/10 px-7 text-white">
        <span className="min-w-0 truncate text-lg font-semibold">{title}</span>
        {items.length > 1 && <span className="ml-3 shrink-0 text-sm tabular-nums text-white/60">{index + 1} / {items.length}</span>}
        <UiProps ids={{"aria-label":["canvas.m1eb05d311508"]}}><button type="button" onClick={onClose} aria-label="canvas.m1eb05d311508" className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-lg text-white/60 transition-colors duration-200 hover:bg-white/10 hover:text-white"><X className="h-6 w-6" /></button></UiProps>
      </header>
      <div
        className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black ${current.kind === "image" && imageScale > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
        style={{ touchAction: current.kind === "image" ? "none" : undefined }}
        onWheel={handleImageWheel}
        onPointerDown={startImageDrag}
        onPointerMove={moveImage}
        onPointerUp={stopImageDrag}
        onPointerCancel={stopImageDrag}
        onDoubleClick={resetImageView}
      >
        {current.kind === "video" ? (
          <AppVideoPlayer ref={previewVideoRef} key={current.url} src={current.url} autoPlay controlPreset="canvasPreview" className="h-full w-full object-contain" containerClassName="h-full w-full bg-black" />
        ) : current.kind === "audio" ? (
          <div className="flex w-full max-w-2xl flex-col items-center gap-6 px-8 text-white"><Music2 className="h-14 w-14 text-white/55" /><audio key={current.url} src={current.url} controls autoPlay className="w-full" /></div>
        ) : (
          <UiProps ids={{"alt":["canvas.m31be538d80db"]}}><img src={current.url} alt={current.name || "canvas.m31be538d80db"} draggable={false} className="max-h-full max-w-full select-none object-contain transition-transform duration-200 ease-out" style={{ transform: `translate3d(${imageOffset.x}px, ${imageOffset.y}px, 0) scale(${imageScale})` }} /></UiProps>
        )}
        {items.length > 1 && <>
          <UiProps ids={{"aria-label":["canvas.mbcf200709dbc"],"title":["canvas.mf64ad2e5be18"]}}><button type="button" onClick={() => changeItem(-1)} aria-label="canvas.mbcf200709dbc" title="canvas.mf64ad2e5be18" className="absolute left-4 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white shadow-2xl transition-colors duration-200 hover:bg-white/15"><ChevronLeft className="h-6 w-6" /></button></UiProps>
          <UiProps ids={{"aria-label":["canvas.mdcd4eb027369"],"title":["canvas.m0513416a6b20"]}}><button type="button" onClick={() => changeItem(1)} aria-label="canvas.mdcd4eb027369" title="canvas.m0513416a6b20" className="absolute right-4 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white shadow-2xl transition-colors duration-200 hover:bg-white/15"><ChevronRight className="h-6 w-6" /></button></UiProps>
        </>}
        {current.kind === "image" ? (
          <div className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/15 bg-[rgb(24_24_24_/_60%)] p-1 text-white shadow-2xl backdrop-blur-lg">
            <UiProps ids={{"aria-label":["canvas.mc655cffc7e83"],"title":["canvas.m290f68030501"]}}><button type="button" onClick={() => updateImageScale(imageScale - 0.25)} disabled={imageScale <= 1} aria-label="canvas.mc655cffc7e83" title="canvas.m290f68030501" className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"><Minus className="h-4 w-4" /></button></UiProps>
            <span className="min-w-14 px-2 text-center text-xs tabular-nums">{Math.round(imageScale * 100)}%</span>
            <UiProps ids={{"aria-label":["canvas.mc4189466c4c4"],"title":["canvas.m80f8fbcfa011"]}}><button type="button" onClick={() => updateImageScale(imageScale + 0.25)} disabled={imageScale >= 4} aria-label="canvas.mc4189466c4c4" title="canvas.m80f8fbcfa011" className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"><Plus className="h-4 w-4" /></button></UiProps>
          </div>
        ) : null}
      </div>
    </div>
  );
}
