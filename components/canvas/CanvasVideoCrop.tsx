"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { NodeToolbar, Position } from "@xyflow/react";
import { ArrowUp, Crop, Loader2, X } from "lucide-react";
import { cropCanvasVideo, type CanvasVideoClip } from "@/lib/canvas/video-clip";
import { initialVideoCrop, adjustVideoCrop, type VideoCrop, type VideoCropHandle } from "@/lib/canvas/video-crop";
import { CanvasVideoFrameContext } from "./CanvasVideoFrameControls";
import { useCanvasReadOnly } from "./CanvasReadOnlyContext";

const CropContext = React.createContext<{ editing: boolean; busy: boolean; crop: VideoCrop | null; open: () => void; change: (crop: VideoCrop) => void } | null>(null);
export const useCanvasVideoCrop = () => React.useContext(CropContext);

export function CanvasVideoCropProvider({ nodeId, src, selected, onExport, children }: {
  nodeId: string; src: string; selected: boolean; onExport?: (clip: CanvasVideoClip) => Promise<void>; children: React.ReactNode;
}) {
  const { text, error: uiError } = useUiLocale();
  const frame = React.useContext(CanvasVideoFrameContext);
  const readOnly = useCanvasReadOnly();
  const [editing, setEditing] = React.useState(false);
  const [crop, setCrop] = React.useState<VideoCrop | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [error, setError] = React.useState("");
  const pending = React.useRef<AbortController | null>(null);
  const close = () => { if (!pending.current) setEditing(false); };
  React.useEffect(() => () => pending.current?.abort(), []);
  React.useEffect(() => { if (!selected && !busy) setEditing(false); }, [selected, busy]);
  React.useEffect(() => {
    if (!editing) return;
    setCrop(null); setError("");
    let raf = 0;
    const deadline = Date.now() + 20000;
    const prepare = () => {
      const video = frame?.videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth >= 2 && video.videoHeight >= 2) {
        video.pause(); setCrop(initialVideoCrop(video.videoWidth, video.videoHeight)); return;
      }
      if (Date.now() > deadline) { setError(text("workspaceFollowup.mb1a1e44ad805")); return; }
      raf = requestAnimationFrame(prepare);
    };
    raf = requestAnimationFrame(prepare);
    return () => cancelAnimationFrame(raf);
  }, [editing, src, frame?.videoRef]);
  const generate = async () => {
    if (!crop || !onExport || readOnly || pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setProgress(0); setError("");
    try {
      const clip = await cropCanvasVideo(src, crop, setProgress, controller.signal);
      controller.signal.throwIfAborted(); await onExport(clip);
      if (!controller.signal.aborted) setEditing(false);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : text("workspaceFollowup.me17c1e9ea2cc")); }
    finally { pending.current = null; if (!controller.signal.aborted) setBusy(false); }
  };
  React.useEffect(() => {
    if (!editing) return;
    const keydown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest?.("input, textarea, [contenteditable=true]")) return;
      if (!["Escape", "Enter", " ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (busy) return;
      if (event.key === "Escape") close();
      if (event.key === "Enter") void generate();
      if (crop && event.key.startsWith("Arrow")) {
        const step = event.shiftKey ? 10 : 1;
        setCrop(adjustVideoCrop(crop, "move", event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0));
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  });
  const value = React.useMemo(() => ({ editing, busy, crop, open: () => { if (!readOnly && onExport) setEditing(true); }, change: setCrop }), [editing, busy, crop, readOnly, onExport]);
  return <CropContext.Provider value={value}>{children}{editing && <NodeToolbar nodeId={nodeId} isVisible position={Position.Bottom} offset={18}
    data-canvas-video-clip-editor className="canvas-video-crop-toolbar nodrag nopan nowheel" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <UiProps ids={{"aria-label":["canvas.mfafaf5224a88"]}}><button aria-label="canvas.mfafaf5224a88" disabled={busy} onClick={close}><X size={18} /></button></UiProps>
    <span aria-live="polite">{crop ? `${crop.width} × ${crop.height}` : <UiText id="canvas.m570d05e59b13" />}</span>
    <UiProps ids={{"aria-label":["canvas.m5ce47ebff378"]}}><button aria-label="canvas.m5ce47ebff378" disabled={!crop || busy} className="canvas-video-crop-confirm" onClick={() => void generate()}>{busy ? `${Math.round(progress * 100)}%` : <ArrowUp size={18} />}</button></UiProps>
    {error && <div role="alert" className="canvas-video-clip-error">{uiError(error)}</div>}
  </NodeToolbar>}</CropContext.Provider>;
}

export function CanvasVideoCropMenuItem({ onSelect }: { onSelect: () => void }) {
  const context = useCanvasVideoCrop();
  const readOnly = useCanvasReadOnly();
  if (!context || readOnly) return null;
  return <button type="button" className="canvas-material-toolbar-item w-full !justify-start" onClick={() => { onSelect(); context.open(); }}><Crop size={16} /><UiText id="canvas.m5c3382d8f846" /></button>;
}

const handles: { id: VideoCropHandle; label: string; x: number; y: number }[] = [
  { id: "nw", label: "左上", x: 0, y: 0 }, { id: "n", label: "上", x: 50, y: 0 }, { id: "ne", label: "右上", x: 100, y: 0 },
  { id: "w", label: "左", x: 0, y: 50 }, { id: "e", label: "右", x: 100, y: 50 },
  { id: "sw", label: "左下", x: 0, y: 100 }, { id: "s", label: "下", x: 50, y: 100 }, { id: "se", label: "右下", x: 100, y: 100 },
];
export function CanvasVideoCropOverlay({ override, label = "视频裁切选区" }: { override?: { editing: boolean; busy: boolean; crop: VideoCrop | null; change: (crop: VideoCrop) => void }; label?: string } = {}) {
  const { text } = useUiLocale();
  const inherited = useCanvasVideoCrop();
  const context = override || inherited;
  const root = React.useRef<HTMLDivElement>(null);
  const bounds = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const drag = React.useRef<{ handle: VideoCropHandle; crop: VideoCrop; x: number; y: number; scaleX: number; scaleY: number } | null>(null);
  React.useEffect(() => {
    if (!context?.editing || !root.current) return;
    const element = root.current;
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    update(); const observer = new ResizeObserver(update); observer.observe(element);
    return () => observer.disconnect();
  }, [context?.editing]);
  if (!context?.editing) return null;
  const { crop, busy, change } = context;
  const scale = crop ? Math.min(size.width / crop.sourceWidth, size.height / crop.sourceHeight) : 0;
  const begin = (event: React.PointerEvent<HTMLElement>, handle: VideoCropHandle) => {
    event.preventDefault(); event.stopPropagation(); if (!crop || busy) return;
    const rect = bounds.current!.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { handle, crop, x: event.clientX, y: event.clientY, scaleX: crop.sourceWidth / rect.width, scaleY: crop.sourceHeight / rect.height };
  };
  return <div ref={root} className="canvas-video-crop-overlay nodrag nopan nowheel" onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}
    onPointerMove={event => { const active = drag.current; if (active && !busy) change(adjustVideoCrop(active.crop, active.handle, (event.clientX - active.x) * active.scaleX, (event.clientY - active.y) * active.scaleY)); }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
    {crop ? <div ref={bounds} className="canvas-video-crop-bounds" style={{ width: crop.sourceWidth * scale, height: crop.sourceHeight * scale }}>
      <div aria-label={label} className="canvas-video-crop-selection" style={{ left: `${crop.left / crop.sourceWidth * 100}%`, top: `${crop.top / crop.sourceHeight * 100}%`, width: `${crop.width / crop.sourceWidth * 100}%`, height: `${crop.height / crop.sourceHeight * 100}%` }} onPointerDown={event => begin(event, "move")}>
        <span className="canvas-video-crop-size">{crop.width} × {crop.height}</span>
        {[1, 2].map(index => <React.Fragment key={index}><i className="vertical" style={{ left: `${index / 3 * 100}%` }} /><i className="horizontal" style={{ top: `${index / 3 * 100}%` }} /></React.Fragment>)}
        {handles.map(handle => <button key={handle.id} type="button" aria-label={text("workspaceFollowup.md170d0d542e5", { v0: handle.label })} disabled={busy} className="canvas-video-crop-handle" style={{ left: `${handle.x}%`, top: `${handle.y}%`, cursor: `${handle.id}-resize` }} onPointerDown={event => begin(event, handle.id)} />)}
      </div>
    </div> : <Loader2 className="animate-spin" size={24} />}
  </div>;
}
