"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { NodeToolbar, Position, useStore } from "@xyflow/react";
import { Check, ChevronDown, ChevronRight, Clapperboard, Film, Keyboard, Loader2, Magnet, Repeat, Scissors, X } from "lucide-react";
import { adjustVideoClipRange, loadVideoClipTimeline, trimCanvasVideo, type CanvasVideoClip, type VideoClipHandle, type VideoClipRange } from "@/lib/canvas/video-clip";
import { CanvasVideoFrameContext } from "./CanvasVideoFrameControls";
import { useCanvasReadOnly } from "./CanvasReadOnlyContext";
import { CanvasVideoCropMenuItem } from "./CanvasVideoCrop";

const ClipContext = React.createContext<{ editing: boolean; open: () => void } | null>(null);
export const useCanvasVideoClip = () => React.useContext(ClipContext);

export function CanvasVideoClipProvider({ nodeId, src, selected, onExport, children }: {
  nodeId: string; src: string; selected: boolean; onExport?: (clip: CanvasVideoClip) => Promise<void>; children: React.ReactNode;
}) {
  const { text, label: uiLabel, error: uiError } = useUiLocale();
  const readOnly = useCanvasReadOnly();
  const frame = React.useContext(CanvasVideoFrameContext);
  const [editing, setEditing] = React.useState(false);
  const [range, setRange] = React.useState<VideoClipRange | null>(null);
  const [thumbnails, setThumbnails] = React.useState<string[]>([]);
  const [snap, setSnap] = React.useState(false);
  const [loop, setLoop] = React.useState(true);
  const [tooltip, setTooltip] = React.useState<string | null>(null);
  const [help, setHelp] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [error, setError] = React.useState("");
  const [time, setTime] = React.useState(0);
  const timeline = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ handle: VideoClipHandle; x: number; range: VideoClipRange; width: number } | null>(null);
  const pending = React.useRef<AbortController | null>(null);
  const rangeRef = React.useRef(range); rangeRef.current = range;
  const loopRef = React.useRef(loop); loopRef.current = loop;
  const close = () => { if (pending.current) return; setEditing(false); setHelp(false); frame?.videoRef.current?.pause(); };
  React.useEffect(() => () => { pending.current?.abort(); }, []);
  React.useEffect(() => { if (!selected && !busy) { setEditing(false); setHelp(false); } }, [selected, busy]);
  React.useEffect(() => {
    if (!editing) return;
    const controller = new AbortController();
    setTooltip(null);
    setRange(null); setThumbnails([]); setError("");
    void loadVideoClipTimeline(src, controller.signal, (url, index) => setThumbnails(current => { const next = [...current]; next[index] = url; return next; }))
      .then(duration => { if (!controller.signal.aborted) setRange({ start: 0, end: duration / 3, duration }); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : text("workspaceFollowup.m1def6748cc42")); });
    return () => { controller.abort(); frame?.videoRef.current?.pause(); };
  }, [editing, src, frame?.videoRef]);
  React.useEffect(() => {
    if (!editing || !range) return;
    let id = 0;
    let started = false;
    const tick = () => {
      const video = frame?.videoRef.current;
      const current = rangeRef.current;
      if (video && current && video.readyState >= 2) {
        if (!started) { started = true; video.currentTime = current.start; void video.play().catch(() => {}); }
        if (loopRef.current && (!video.paused || video.ended) && video.currentTime >= current.end) {
          video.currentTime = current.start; void video.play().catch(() => {});
        }
        setTime(previous => Math.abs(previous - video.currentTime) > .02 ? video.currentTime : previous);
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [editing, Boolean(range), frame?.videoRef]);
  const apply = (next: VideoClipRange, handle: VideoClipHandle) => {
    setRange(next);
    const video = frame?.videoRef.current;
    if (video && video.readyState >= 1) video.currentTime = handle === "end" ? Math.max(next.start, next.end - .001) : next.start;
  };
  const generate = async () => {
    if (!range || !onExport || readOnly || pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setProgress(0); setError(""); frame?.videoRef.current?.pause();
    try {
      const clip = await trimCanvasVideo(src, range.start, range.end, setProgress, controller.signal);
      controller.signal.throwIfAborted();
      await onExport(clip);
      if (!controller.signal.aborted) { setEditing(false); setHelp(false); }
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : text("workspaceFollowup.m5c61b6de542a")); }
    finally { pending.current = null; if (!controller.signal.aborted) setBusy(false); }
  };
  React.useEffect(() => {
    if (!editing) return;
    const keydown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest?.("input, textarea, [contenteditable=true]")) return;
      const key = event.key.toLowerCase();
      if (!["arrowleft", "arrowright", "arrowup", "arrowdown", "i", "o", " ", "escape", "enter"].includes(key)) return;
      event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
      if (busy) return;
      if (key === "escape") { if (help) setHelp(false); else close(); return; }
      if (key === "enter") { void generate(); return; }
      const video = frame?.videoRef.current;
      if (key === " " && video && range) {
        if (video.paused) { if (loop && (video.currentTime < range.start || video.currentTime >= range.end)) video.currentTime = range.start; void video.play().catch(() => {}); }
        else video.pause();
      }
      if (!range) return;
      const step = event.shiftKey ? .01 : snap || event.metaKey || event.ctrlKey ? 1 : .1;
      if (key === "arrowleft" || key === "arrowright") {
        const focusedHandle = (event.target as HTMLElement)?.dataset?.clipHandle as VideoClipHandle | undefined;
        const handle = focusedHandle || "move";
        apply(adjustVideoClipRange(range, handle, key === "arrowleft" ? -step : step, snap && !event.shiftKey), handle);
      }
      if (key === "arrowup" || key === "arrowdown") apply(adjustVideoClipRange(range, "end", key === "arrowup" ? step : -step, snap && !event.shiftKey), "end");
      if ((key === "i" || key === "o") && video) { const handle = key === "i" ? "start" : "end"; apply(adjustVideoClipRange(range, handle, video.currentTime - range[handle], snap && !event.shiftKey), handle); }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  });
  const position = useStore(state => {
    const node = state.nodeLookup.get(nodeId);
    const absolute = node?.internals?.positionAbsolute;
    if (!node || !absolute) return { left: 16, top: 16, width: 900 };
    const [x, y, zoom] = state.transform;
    const width = Math.max(280, Math.min(900, state.width - 32));
    const center = x + (absolute.x + (node.measured.width || 350) / 2) * zoom;
    return { width, left: Math.max(16, Math.min(center - width / 2, state.width - width - 16)), top: Math.max(16, Math.min(y + (absolute.y + (node.measured.height || 200)) * zoom + 18, state.height - 100)) };
  }, (a, b) => a.left === b.left && a.top === b.top && a.width === b.width);
  const value = React.useMemo(() => ({ editing, open: () => { if (!readOnly && onExport) { setEditing(true); setHelp(false); } } }), [editing, readOnly, onExport]);
  return <ClipContext.Provider value={value}>{children}{editing && <NodeToolbar nodeId={nodeId} isVisible position={Position.Bottom}
    style={{ width: position.width, transform: `translate(${position.left}px, ${position.top}px)` }}
    data-canvas-video-clip-editor className="nodrag nopan nowheel canvas-video-clip-toolbar" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    {help && <UiProps ids={{"aria-label":["canvas.mb7ab621a56c2"]}}><div role="dialog" aria-label="canvas.mb7ab621a56c2" className="canvas-video-clip-help"><header><strong><UiText id="canvas.mee2638183d3e" /></strong><UiProps ids={{"aria-label":["canvas.m6d6f363fd7de"]}}><button aria-label="canvas.m6d6f363fd7de" onClick={() => setHelp(false)}><X size={16} /></button></UiProps></header><dl>{[
      ["移动选区", "← / →"], ["精确模式", "按住 Shift"], ["扩展 / 收缩选区", "↑ / ↓"], ["快速调整", "⌘ / Ctrl + ↑ / ↓"], ["设置入点 / 出点", "I / O"], ["播放 / 暂停", "Space"], ["退出", "Esc"], ["确认剪辑", "Enter"],
    ].map(([label, keys]) => <div key={label}><dt>{uiLabel(label)}</dt><dd>{keys}</dd></div>)}</dl></div></UiProps>}
    <UiProps ids={{"aria-label":["canvas.m939e9aedf89e"]}}><button type="button" aria-label="canvas.m939e9aedf89e" disabled={busy} onClick={close}><X size={20} /></button></UiProps>
    <span className="canvas-material-toolbar-separator" />
    <UiProps ids={{"aria-label":["canvas.mb7ab621a56c2"]}}><button type="button" aria-label="canvas.mb7ab621a56c2" aria-pressed={help} onClick={() => setHelp(current => !current)}><Keyboard size={20} /></button></UiProps>
    <UiProps ids={{"aria-label":["canvas.me44f6a7746b0"]}}><div ref={timeline} className="canvas-video-clip-timeline" aria-label="canvas.me44f6a7746b0"
      onPointerMove={event => { const active = drag.current; if (active && !busy) apply(adjustVideoClipRange(active.range, active.handle, (event.clientX - active.x) / active.width * active.range.duration, snap && !event.shiftKey), active.handle); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <div className="canvas-video-clip-thumbnails">{Array.from({ length: 12 }, (_, i) => thumbnails[i] ? <img key={i} src={thumbnails[i]} alt="" draggable={false} /> : <span key={i} />)}</div>
      {!range && !error && <span className="canvas-video-clip-loading"><Loader2 className="animate-spin" size={18} /><UiText id="canvas.m42e36567c4f4" /></span>}
      {range && <>
        <div className="canvas-video-clip-mask" style={{ left: 0, width: `${range.start / range.duration * 100}%` }} />
        <div className="canvas-video-clip-mask" style={{ right: 0, width: `${(range.duration - range.end) / range.duration * 100}%` }} />
        <div className="canvas-video-clip-selection" style={{ left: `${range.start / range.duration * 100}%`, width: `${(range.end - range.start) / range.duration * 100}%` }}
          onPointerDown={event => { if (busy) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { handle: "move", x: event.clientX, range, width: timeline.current!.getBoundingClientRect().width }; }}>
          <span className="canvas-video-clip-duration">{(range.end - range.start).toFixed(2)} s</span>
          {(["start", "end"] as const).map(handle => <UiProps key={handle} ids={{"aria-label":["canvas.mb757469ac806","canvas.mf0302ba619a1"]}}><div  data-clip-handle={handle} role="slider" tabIndex={busy ? -1 : 0} aria-label={handle === "start" ? "canvas.mb757469ac806" : "canvas.mf0302ba619a1"} aria-valuemin={handle === "start" ? 0 : range.start + .01} aria-valuemax={handle === "start" ? range.end - .01 : range.duration} aria-valuenow={range[handle]} aria-valuetext={`${range[handle].toFixed(2)} 秒`} className={`canvas-video-clip-handle ${handle}`}

            onPointerDown={event => { if (busy) return; event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { handle, x: event.clientX, range, width: timeline.current!.getBoundingClientRect().width }; }} /></UiProps>)}
        </div>
        <span className="canvas-video-clip-playhead" style={{ left: `${Math.min(100, time / range.duration * 100)}%` }} />
      </>}
    </div></UiProps>
    {([
      { key: "snap", label: text("workspaceFollowup.mab451d5e9c15"), active: snap, Icon: Magnet, toggle: () => setSnap(current => !current) },
      { key: "loop", label: text("workspaceFollowup.m5d7f9158d41f"), active: loop, Icon: Repeat, toggle: () => setLoop(current => !current) },
    ]).map(({ key, label, active, Icon, toggle }) => <button key={key} type="button" className="canvas-video-clip-toggle"
      aria-label={`${active ? text("workspaceFollowup.m3fd47edce45b") : text("workspaceFollowup.m8da97ddda990")}${label}`} aria-pressed={active} disabled={busy}
      data-canvas-tooltip={`${active ? text("workspaceFollowup.m3fd47edce45b") : text("workspaceFollowup.m8da97ddda990")}${label}`} data-tooltip-open={tooltip === key}
      onPointerEnter={() => setTooltip(key)} onPointerLeave={() => setTooltip(null)} onFocus={() => setTooltip(key)} onBlur={() => setTooltip(null)}
      onClick={() => { toggle(); setTooltip(key); }}>
      <Icon size={20}>{!active && <g data-disabled-slash><path d="m3 3 18 18" stroke="var(--panel-bg)" strokeWidth={5} /><path d="m3 3 18 18" /></g>}</Icon>
    </button>)}
    <UiProps ids={{"aria-label":["canvas.m926d0d69e326"]}}><button type="button" className="canvas-video-clip-confirm" aria-label="canvas.m926d0d69e326" disabled={busy || !range} onClick={() => { void generate(); }}>{busy ? <span>{Math.round(progress * 100)}%</span> : <Check size={25} />}</button></UiProps>
    {error && <div role="alert" className="canvas-video-clip-error">{uiError(error)}{!range && <button onClick={() => { setEditing(false); }}><UiText id="canvas.m2b45e04e0b01" /></button>}</div>}
  </NodeToolbar>}</ClipContext.Provider>;
}

export type CanvasVideoBreakdownOption = { providerId: string; modelId: string; label: string };

/** 逐帧拉片 menu: trim, crop and the AI shot breakdown with a model choice. */
export function CanvasVideoClipButton({ breakdown }: {
  breakdown?: { models: readonly CanvasVideoBreakdownOption[]; onStart: (model: CanvasVideoBreakdownOption) => void };
} = {}) {
  const clip = useCanvasVideoClip();
  const readOnly = useCanvasReadOnly();
  const [menu, setMenu] = React.useState(false);
  const [models, setModels] = React.useState(false);
  React.useEffect(() => { if (!menu) setModels(false); }, [menu]);
  const root = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!menu) return;
    const close = (event: Event) => { if (!root.current?.contains(event.target as Node)) setMenu(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(false); };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("focusin", close);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", close, true); window.removeEventListener("focusin", close); window.removeEventListener("keydown", escape); };
  }, [menu]);
  if (!clip || readOnly) return null;
  return <div ref={root} className="relative"><UiProps ids={{"aria-label":["canvas.md41f3dc4304e"]}}><button type="button" className="canvas-material-toolbar-item" aria-label="canvas.md41f3dc4304e" aria-expanded={menu} onClick={() => setMenu(current => !current)}><Film size={16} /><UiText id="canvas.md41f3dc4304e" /><ChevronDown size={12} /></button></UiProps>
    {menu && <div className={`absolute left-0 top-full z-10 mt-2 flex ${models ? "w-64" : "w-40"} flex-col rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-1 shadow-lg`}>
      <button type="button" className="canvas-material-toolbar-item w-full !justify-start" onClick={() => { setMenu(false); clip.open(); }}><Scissors size={16} /><UiText id="canvas.m33a2543df255" /></button>
      <CanvasVideoCropMenuItem onSelect={() => setMenu(false)} />
      {breakdown && <>
        <div role="separator" className="mx-1.5 my-1 border-t border-[var(--border)]" />
        <UiProps ids={{"title":["canvas.mf055b9a29775"]}}><button type="button" data-canvas-breakdown-menu className="canvas-material-toolbar-item w-full !justify-start" aria-expanded={models}
          title="canvas.mf055b9a29775" onClick={() => setModels(current => !current)}>
          <Clapperboard size={16} /><UiText id="canvas.m7652051e04f0" /><ChevronRight size={12} className={`ml-auto transition-transform ${models ? "rotate-90" : ""}`} />
        </button></UiProps>
        {models && <UiProps ids={{"aria-label":["canvas.maaa2af1a9d04"]}}><div className="flex flex-col gap-0.5 px-1 pb-1" role="menu" aria-label="canvas.maaa2af1a9d04">
          <p className="px-2 pb-1 pt-0.5 text-[11px] text-[var(--app-muted)]">{breakdown.models.length ? <UiText id="canvas.ma535cd3f8052" /> : <UiText id="canvas.m6c84718c6265" />}</p>
          {breakdown.models.map((model, index) => <button key={`${model.providerId}:${model.modelId}`} type="button" role="menuitem" data-canvas-breakdown-model={model.modelId}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-[var(--app-fg)] hover:bg-[var(--panel-2)]"
            onClick={() => { setMenu(false); breakdown.onStart(model); }}>
            <span className="min-w-0 flex-1 truncate">{model.label}</span>
            {index === 0 && <span className="shrink-0 rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-[10px] text-[var(--app-muted)]"><UiText id="canvas.m1452deafc6d9" /></span>}
          </button>)}
        </div></UiProps>}
      </>}
    </div>}
  </div>;
}
