"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { ChevronLeft, ChevronRight, Download, Minus, Music2, Plus, X } from "lucide-react";
import { AppVideoPlayer } from "@/components/ui/app-video-player";
import type { CanvasHistoryReference } from "@/lib/assets/canvas-history";

export type HistoryPreviewMedia = CanvasHistoryReference & { posterUrl?: string | null };

function ZoomableHistoryImage({ item }: { item: HistoryPreviewMedia }) {
  const viewport = React.useRef<HTMLDivElement>(null);
  const [view, setView] = React.useState({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = React.useState(false);
  const drag = React.useRef<{ id: number; x: number; y: number } | null>(null);
  const zoom = React.useCallback((factor: number, point = { x: 0, y: 0 }) => {
    setView(previous => {
      const scale = Math.min(5, Math.max(0.25, previous.scale * factor));
      const ratio = scale / previous.scale;
      return { scale, x: scale <= 1 ? 0 : point.x - (point.x - previous.x) * ratio, y: scale <= 1 ? 0 : point.y - (point.y - previous.y) * ratio };
    });
  }, []);
  React.useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      zoom(Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.002), { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [zoom]);
  const endDrag = () => { drag.current = null; setDragging(false); };
  return <>
    <div ref={viewport} className="history-lightbox-image-viewport" style={{ cursor: view.scale > 1 ? dragging ? "grabbing" : "grab" : "default" }}
      onPointerDown={event => {
        if (event.button !== 0 || view.scale <= 1) return;
        event.preventDefault();
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={event => {
        const previous = drag.current;
        if (!previous || previous.id !== event.pointerId) return;
        const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        setView(value => ({ ...value, x: value.x + dx, y: value.y + dy }));
      }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); endDrag(); }}
      onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
      <UiProps ids={{"alt":["canvas.mba8b49f3fd10"]}}><img src={item.url} alt={item.name || "canvas.mba8b49f3fd10"} draggable={false} className="history-lightbox-image" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} /></UiProps>
    </div>
    <UiProps ids={{"aria-label":["canvas.m37dc6e6be541"]}}><div className="history-lightbox-zoom" role="group" aria-label="canvas.m37dc6e6be541">
      <UiProps ids={{"aria-label":["canvas.mc655cffc7e83"]}}><button type="button" aria-label="canvas.mc655cffc7e83" disabled={view.scale <= 0.25} onClick={() => zoom(1 / 1.2)}><Minus size={16} /></button></UiProps>
      <UiProps ids={{"aria-label":["canvas.m7d03a54d5c94"],"title":["canvas.mb6076dbe0c27"]}}><button type="button" aria-label="canvas.m7d03a54d5c94" title="canvas.mb6076dbe0c27" onClick={() => setView({ scale: 1, x: 0, y: 0 })}>{Math.round(view.scale * 100)}%</button></UiProps>
      <UiProps ids={{"aria-label":["canvas.mc4189466c4c4"]}}><button type="button" aria-label="canvas.mc4189466c4c4" disabled={view.scale >= 5} onClick={() => zoom(1.2)}><Plus size={16} /></button></UiProps>
    </div></UiProps>
  </>;
}

export default function CanvasHistoryMediaPreview({ items, initialIndex, onClose, onDownload }: {
  items: HistoryPreviewMedia[];
  initialIndex: number;
  onClose: () => void;
  onDownload: (item: HistoryPreviewMedia) => void;
}) {
  const { text } = useUiLocale();
  const [index, setIndex] = React.useState(initialIndex);
  const root = React.useRef<HTMLDivElement>(null);
  const current = items[index];
  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => previous?.focus({ preventScroll: true });
  }, []);
  const move = React.useCallback((direction: number) => {
    setIndex(value => (value + direction + items.length) % items.length);
  }, [items.length]);
  React.useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.target instanceof Element && event.target.closest("input,textarea,audio,[data-app-video-player]")) return;
      if (items.length > 1 && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault(); event.stopPropagation(); move(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [items.length, move, onClose]);
  if (!current) return null;
  const label = { image: text("workspaceFollowup.md24c10d37db0"), video: text("workspaceFollowup.mc20f7618d330"), audio: text("workspaceFollowup.m296c632ec857") }[current.kind];
  return <div ref={root} role="dialog" aria-modal="true" aria-label={text("workspaceFollowup.m4c116c1cbf8d", { v0: label })} tabIndex={-1} className="history-media-lightbox"
    onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key !== "Tab") return;
      const buttons = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), video, audio, [tabindex="0"]') ?? []).filter(item => item.getClientRects().length);
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root.current)) { event.preventDefault(); first?.focus(); }
    }}>
    <button type="button" className="history-lightbox-close" aria-label={text("workspaceFollowup.m9edf9fd012ff", { v0: label })} onClick={onClose}><X size={24} /></button>
    <div className="history-lightbox-player">
      {current.kind === "video" ? <AppVideoPlayer key={current.url} src={current.url} poster={current.posterUrl || undefined} autoPlay controlPreset="canvasPreview" className="h-full w-full object-contain" containerClassName="h-full w-full bg-transparent" />
        : current.kind === "audio" ? <div className="history-lightbox-audio"><Music2 size={64} /><span>{current.name || <UiText id="canvas.m296c632ec857" />}</span><audio key={current.url} src={current.url} controls autoPlay preload="metadata" /></div>
        : <ZoomableHistoryImage key={`${index}:${current.url}`} item={current} />}
    </div>
    {items.length > 1 && <>
      <button type="button" className="history-lightbox-previous" aria-label={text("workspaceFollowup.m7df8e3d17f5d", { v0: label })} onClick={() => move(-1)}><ChevronLeft size={30} /></button>
      <button type="button" className="history-lightbox-next" aria-label={text("workspaceFollowup.md63b4ab54902", { v0: label })} onClick={() => move(1)}><ChevronRight size={30} /></button>
    </>}
    <div className="history-lightbox-footer"><span>{index + 1} / {items.length}</span><button type="button" onClick={() => onDownload(current)}><Download size={16} /><UiText id="canvas.m4673a2306165" /></button></div>
  </div>;
}
