"use client";

import { UiProps, UiText, useUiLocale } from "@/i18n/ui";

import * as React from "react";
import { NodeToolbar, Position } from "@xyflow/react";
import { CaptionsOff, ChevronDown, Check, X, SquareDashed, Undo2, Redo2, RotateCcw } from "lucide-react";
import { CanvasVideoFrameContext } from "./CanvasVideoFrameControls";
import { CanvasSubtitleRegionsOverlay } from "./CanvasSubtitleRegionsOverlay";
import { useCanvasReadOnly } from "./CanvasReadOnlyContext";
import type { VideoCrop } from "@/lib/canvas/video-crop";
import { MEDIAKIT_MAX_REGIONS } from "@/lib/volcengine-mediakit-models";
import type { SubtitleRemovalOptions } from "@/lib/canvas/subtitle-removal";

const Context = React.createContext<{ editing: boolean; crops: VideoCrop[]; change: (crops: VideoCrop[]) => void; drawing: boolean; setDrawing: (value: boolean) => void; open: (mode: "auto" | "region") => void; error: string } | null>(null);
export const useCanvasSubtitleRemoval = () => React.useContext(Context);

export function CanvasVideoSubtitleRemovalProvider({ nodeId, selected, onRemove, children }: {
  nodeId: string; selected: boolean; children: React.ReactNode;
  onRemove?: (options: SubtitleRemovalOptions, size: { width: number; height: number }) => Promise<void>;
}) {
  const { text } = useUiLocale();
  const frame = React.useContext(CanvasVideoFrameContext);
  const readOnly = useCanvasReadOnly();
  const [editing, setEditing] = React.useState(false);
  const [history, setHistory] = React.useState<VideoCrop[][]>([[]]);
  const [cursor, setCursor] = React.useState(0);
  const [drawing, setDrawing] = React.useState(false);
  const crops = history[cursor];
  const change = (next: VideoCrop[]) => {
    if (next.length > MEDIAKIT_MAX_REGIONS) return;
    if (JSON.stringify(next) === JSON.stringify(crops)) return;
    setHistory([...history.slice(0, cursor + 1), next]); setCursor(cursor + 1);
  };
  const undo = () => { setCursor(v => Math.max(0, v - 1)); setDrawing(false); };
  const redo = () => { setCursor(v => Math.min(history.length - 1, v + 1)); setDrawing(false); };
  const [error, setError] = React.useState("");
  const submitting = React.useRef(false);
  const submit = (options: SubtitleRemovalOptions) => {
    const video = frame?.videoRef.current;
    if (readOnly || !onRemove || submitting.current) return;
    if (!video || video.videoWidth < 2 || video.videoHeight < 2) { setError(text("workspaceFollowup.m1227c4c50582")); return; }
    submitting.current = true; setError(""); setEditing(false);
    // Only submit here. The durable canvas worker owns execution, not this panel.
    void onRemove(options, { width: video.videoWidth, height: video.videoHeight }).catch(reason => setError(reason instanceof Error ? reason.message : text("workspaceFollowup.m08731a5e4fa1")))
      .finally(() => { submitting.current = false; });
  };
  const open = (mode: "auto" | "region") => {
    if (readOnly || !onRemove) return;
    setError("");
    const video = frame?.videoRef.current;
    if (!video || video.videoWidth < 2 || video.videoHeight < 2) { setError(text("workspaceFollowup.m1227c4c50582")); return; }
    if (mode === "auto") { submit({ mode }); return; }
    video.pause();
    const w = video.videoWidth, h = video.videoHeight;
    setHistory([[{ left: Math.round(w * .05), top: Math.round(h * .75), width: Math.floor(w * .9), height: Math.floor(h * .2), sourceWidth: w, sourceHeight: h }]]); setCursor(0); setDrawing(false);
    setEditing(true);
  };
  React.useEffect(() => { if (!selected) setEditing(false); }, [selected]);
  const confirm = () => { if (crops.length) submit({ mode: "region", regions: crops.map(crop => ({ x: crop.left / crop.sourceWidth, y: crop.top / crop.sourceHeight, width: crop.width / crop.sourceWidth, height: crop.height / crop.sourceHeight })) }); };
  React.useEffect(() => {
    if (!editing) return;
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea,[contenteditable=true]")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault(); e.stopImmediatePropagation(); if (e.shiftKey) redo(); else undo(); return;
      }
      if (e.key !== "Escape" && e.key !== "Enter") return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.key === "Escape") setEditing(false); else confirm();
    };
    window.addEventListener("keydown", key, true); return () => window.removeEventListener("keydown", key, true);
  });
  return <Context.Provider value={{ editing, crops, change, drawing, setDrawing, open, error }}>{children}
    {editing && <NodeToolbar nodeId={nodeId} isVisible position={Position.Bottom} offset={18} className="canvas-video-crop-toolbar nodrag nopan nowheel" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <UiProps ids={{"aria-label":["canvas.mf516c1dfce5c"]}}><button aria-label="canvas.mf516c1dfce5c" onClick={() => setEditing(false)}><X size={18} /></button></UiProps>
      <span>{drawing ? <UiText id="canvas.m910827d11c05" /> : <UiText id="canvas.mbe69e63ab4a9" values={{v0: String(crops.length)}} />}</span>
      <UiProps ids={{"aria-label":["canvas.m9f12e0f3b6a0"]}}><button aria-label="canvas.m9f12e0f3b6a0" title={text("workspaceFollowup.m91896652b2c7", { v0: MEDIAKIT_MAX_REGIONS })} disabled={crops.length >= MEDIAKIT_MAX_REGIONS} aria-pressed={drawing} onClick={() => setDrawing(v => !v)}><SquareDashed size={18} /></button></UiProps>
      <UiProps ids={{"aria-label":["canvas.m65e0b2b78c2e"],"title":["canvas.m1585b630ef9e"]}}><button aria-label="canvas.m65e0b2b78c2e" title="canvas.m1585b630ef9e" disabled={cursor === 0} onClick={undo}><Undo2 size={18} /></button></UiProps>
      <UiProps ids={{"aria-label":["canvas.m36071695913a"],"title":["canvas.m99646d2308d2"]}}><button aria-label="canvas.m36071695913a" title="canvas.m99646d2308d2" disabled={cursor === history.length - 1} onClick={redo}><Redo2 size={18} /></button></UiProps>
      <UiProps ids={{"aria-label":["canvas.m6f30c4e6f180"],"title":["canvas.m6792e35b0942"]}}><button aria-label="canvas.m6f30c4e6f180" title="canvas.m6792e35b0942" disabled={!crops.length} onClick={() => { change([]); setDrawing(true); }}><RotateCcw size={18} /></button></UiProps>
      <UiProps ids={{"aria-label":["canvas.m9f0fb414463c"]}}><button aria-label="canvas.m9f0fb414463c" disabled={!crops.length} className="canvas-video-crop-confirm" onClick={confirm}><Check size={18} /></button></UiProps>
    </NodeToolbar>}
  </Context.Provider>;
}

export function CanvasVideoSubtitleRemovalButton() {
  const context = useCanvasSubtitleRemoval(), readOnly = useCanvasReadOnly();
  const [menu, setMenu] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!menu) return;
    const outside = (e: Event) => { if (!root.current?.contains(e.target as Node)) setMenu(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    window.addEventListener("pointerdown", outside, true); window.addEventListener("focusin", outside); window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", outside, true); window.removeEventListener("focusin", outside); window.removeEventListener("keydown", escape); };
  }, [menu]);
  if (!context || readOnly) return null;
  return <div ref={root} className="relative" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
    <UiProps ids={{"aria-label":["canvas.m12c82532d851"]}}><button type="button" aria-label="canvas.m12c82532d851" aria-expanded={menu} className="canvas-material-toolbar-item" onClick={() => setMenu(v => !v)}><CaptionsOff size={16} /><UiText id="canvas.m12c82532d851" /><ChevronDown size={12} /></button></UiProps>
    {menu && <div className="absolute left-0 top-full z-20 mt-2 flex w-40 flex-col rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-1 shadow-lg">
      {([["auto", "智能去字幕"], ["region", "框选去字幕"]] as const).map(([mode, label]) => <button key={mode} className="canvas-material-toolbar-item w-full !justify-start" onClick={() => { setMenu(false); context.open(mode); }}>{label}</button>)}
    </div>}
    {context.error && <div role="alert" className="absolute left-0 top-full z-20 mt-2 w-64 whitespace-normal rounded-xl bg-[var(--panel-bg)] p-3 text-xs">{context.error}</div>}
  </div>;
}
export function CanvasSubtitleRemovalOverlay() {
  const value = useCanvasSubtitleRemoval();
  return value?.editing ? <CanvasSubtitleRegionsOverlay crops={value.crops} onChange={value.change} drawing={value.drawing} onDrawn={() => value.setDrawing(false)} /> : null;
}
